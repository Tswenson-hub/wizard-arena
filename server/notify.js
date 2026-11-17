// Round 23: Discord alerts when a real player is playing (so Ty can join them), and the admin key.
// Configuration is environment only: NOTIFY_WEBHOOK_URL (a Discord webhook), NOTIFY_THREAD_ID (optional: post into that thread),
// ADMIN_KEY (Ty's secret). Without a webhook every alert is a no-op; without ADMIN_KEY nobody is an admin.
//
// createNotifier(opts) -> { enabled, isAdmin(key), onHumanJoin(ev), onMatchEnd(ev), stats() }
//   onHumanJoin({ roomId, kind, legacy, map, humans: [{ name, admin, platform }], humansBefore, platform })
//     one post when a public room (or a private room someone made) gets its first human, none for bots or admins, nothing more for
//     that room within `roomGapMs` (10 min), at most one post per `minGapMs` (2 min) overall: a post held by that gap goes out when
//     the gap ends if the room still has a real player.
//   onMatchEnd({ roomId, kind, legacy, map, ranked: [{ name, bot, admin, kills }], seconds })
//     a short line for rooms with a real player in the match, one per room per `matchGapMs`.
// Posts are fire-and-forget fetches with a timeout; failures are logged, nothing waits on them. The key is never sent or logged.
import { timingSafeEqual } from 'node:crypto';

export const SITE_URL = 'https://wizard-arena-76od.onrender.com';

export function createNotifier({
  webhookUrl = process.env.NOTIFY_WEBHOOK_URL, threadId = process.env.NOTIFY_THREAD_ID, adminKey = process.env.ADMIN_KEY,
  fetchImpl = globalThis.fetch, now = Date.now, log = console, siteUrl = SITE_URL,
  minGapMs = 120000, roomGapMs = 600000, matchGapMs = 600000, timeoutMs = 5000, setTimer = setTimeout,
} = {}) {
  const enabled = typeof webhookUrl === 'string' && /^https?:\/\//.test(webhookUrl);
  const url = enabled ? (threadId ? `${webhookUrl}${webhookUrl.includes('?') ? '&' : '?'}thread_id=${encodeURIComponent(threadId)}` : webhookUrl) : null;
  const roomPostAt = new Map(), roomMatchAt = new Map();
  let lastPostAt = -Infinity, pendingTimer = null;
  const stats = { posts: 0, failures: 0, held: 0 };

  function isAdmin(key) {
    if (typeof adminKey !== 'string' || !adminKey || typeof key !== 'string' || !key) return false;
    const a = Buffer.from(adminKey), b = Buffer.from(key);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  function post(payload) {
    if (!enabled) return;
    stats.posts++;
    lastPostAt = now();
    let p;
    try {
      p = fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined });
    } catch (e) { stats.failures++; log.warn?.('[notify] post', e?.message || e); return; }
    Promise.resolve(p).then(r => { if (r && r.ok === false) { stats.failures++; log.warn?.(`[notify] webhook ${r.status}`); } })
      .catch(e => { stats.failures++; log.warn?.('[notify] post', e?.message || e); });
  }
  const sourceOf = (ev) => ev.legacy ? 'CrazyGames (the old build)' : ev.platform === 'crazygames' ? 'CrazyGames' : ev.platform === 'web' ? 'the website' : 'unknown';
  const names = (hs) => hs.map(h => h.name).filter(Boolean).join(', ') || '(no names yet)';
  function joinEmbed(ev) {
    const real = ev.humans.filter(h => !h.admin);
    const link = ev.legacy
      ? "They're on the old CrazyGames build: play at crazygames.com to meet them (our new client can't join legacy rooms)."
      : `[Join them](${siteUrl}/?room=${encodeURIComponent(ev.roomId)}&admin=1)`;
    return {
      embeds: [{
        title: '🧙 A player is in Wizard Arena',
        description: link,
        color: ev.legacy ? 0x8899aa : 0x7c5cff,
        fields: [
          { name: 'Room', value: `${ev.roomId}${ev.kind === 'private' ? ' (private)' : ''}${ev.legacy ? ' · legacy' : ''}`, inline: true },
          { name: 'Map', value: String(ev.map || '?'), inline: true },
          { name: 'Source', value: sourceOf(ev), inline: true },
          { name: `Humans (${real.length})`, value: names(real), inline: false },
        ],
        timestamp: new Date(now()).toISOString(),
      }],
    };
  }
  // A real player arrived in `roomId`: post when the room had no real player before, once per room per roomGapMs, within the overall gap.
  function onHumanJoin(ev) {
    if (!enabled || !ev || (ev.kind !== 'public' && ev.kind !== 'private')) return false;
    const real = (ev.humans || []).filter(h => !h.admin);
    if (!real.length) return false;                                   // only admins (Ty) in there: nothing
    const t = now();
    if ((ev.humansBefore ?? 0) > 0 && roomPostAt.has(ev.roomId)) return false;   // more joins into a live session: nothing
    if (t - (roomPostAt.get(ev.roomId) ?? -Infinity) < roomGapMs) return false;
    if (t - lastPostAt < minGapMs) {
      // held by the overall gap: one post when it ends, if the room still has a real player (ev.humansNow(), the live count)
      stats.held++;
      if (!pendingTimer) pendingTimer = setTimer(() => { pendingTimer = null; const live = ev.humansNow ? ev.humansNow() : real.length; if (live > 0) { roomPostAt.set(ev.roomId, now()); post(joinEmbed({ ...ev, humans: ev.humansList ? ev.humansList() : ev.humans })); } }, minGapMs - (t - lastPostAt) + 50);
      return false;
    }
    roomPostAt.set(ev.roomId, t);
    post(joinEmbed(ev));
    return true;
  }
  // A match ended with a real player in it: a short line, one per room per matchGapMs
  function onMatchEnd(ev) {
    if (!enabled || !ev || (ev.kind !== 'public' && ev.kind !== 'private')) return false;
    const ranked = ev.ranked || [], real = ranked.filter(p => !p.bot && !p.admin);
    if (!real.length) return false;
    const t = now();
    if (t - (roomMatchAt.get(ev.roomId) ?? -Infinity) < matchGapMs) return false;
    roomMatchAt.set(ev.roomId, t);
    const w = ranked[0];
    const line = `🏁 Match over in ${ev.roomId} (${ev.map || '?'}${ev.legacy ? ', legacy' : ''}, ${Math.round((ev.seconds || 0) / 60)} min): `
      + (w ? `**${w.name}** wins with ${w.kills} kill${w.kills === 1 ? '' : 's'}${w.bot ? ' (a bot)' : ''}` : 'no winner')
      + ` · real players: ${real.map(p => `${p.name} (${p.kills})`).join(', ')}`;
    post({ content: line });
    return true;
  }
  return { enabled, isAdmin, onHumanJoin, onMatchEnd, stats: () => ({ ...stats }), _url: () => url };
}
