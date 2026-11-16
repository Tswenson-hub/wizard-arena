// Round 18: player saves on Supabase, linked to the CrazyGames user (docs/agents/round18-saves.md).
// A logged-in CrazyGames player's client sends { t: 'auth', token } (getUserToken, IN_GAME_AUTH); verifyCgToken checks it
// (RS256 against CrazyGames' JWKS, kid ingame-auth, exp), loadPlayer upserts the `players` row and returns the save and
// stats, writeSave keeps their loadouts and settings (validated, at most one write per 10 s per player, flushSave on
// disconnect) and recordRecap / recordMatch add a finished match through the record_match RPC. Guests and bots never get here.
// Round 19: getStats answers the stats panel's { t: 'stats' } (your stats, recent matches, the weekly and all-time boards).
// Secrets come only from the environment (SUPABASE_URL, SUPABASE_SECRET_KEY; optional CG_GAME_ID). With none set every
// call is a no-op that resolves to null, so local dev, the tests and the guest path behave exactly as before.
// Nothing here throws or blocks: a slow or down Supabase means a guest-like session (each request times out after 5 s).
// Talks to PostgREST with plain fetch (no supabase-js); `jose` is imported lazily, so a missing package is a disabled feature.
// Round 26: drop-off analytics (startSession / logEvent / endSession: the `events` table, batched, one insert per 5 s) and
// progression storage (loadProgress / writeProgress / mergeGuestProgress: the `player_progress` table, logged-in players only).
import { randomUUID } from 'node:crypto';
import * as C from '../public/shared/constants.js';

const JWKS_URL = 'https://userportal.crazygames.com/.well-known/jwks.json';
const KID = 'ingame-auth';
const TIMEOUT_MS = 5000;
export const SAVE_EVERY_MS = 10_000;     // at most one save write per player per 10 s
export const AUTH_EVERY_MS = 30_000;     // about one auth per socket per 30 s (after a burst of 2)
export const MAX_SAVE_BYTES = 4096;      // a sanitized save is about 600 bytes; the table allows 64 KB
const TEST = process.env.NODE_ENV === 'test';

const env = () => ({ url: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''), key: process.env.SUPABASE_SECRET_KEY || '' });
export const savesEnabled = () => { const e = env(); return !!(e.url && e.key); };
const log = (...a) => console.warn('[saves]', ...a);

// ---------------------------------------------------------------- the token
let jose = null, jwks = null, testJwks = null;
async function keys() {
  jose ??= await import('jose').catch(() => null);
  if (!jose) return null;
  if (TEST) {
    if (!testJwks && process.env.CG_TEST_JWKS) {   // the integration test's server: a JWKS as JSON (NODE_ENV=test only)
      try { testJwks = jose.createLocalJWKSet(JSON.parse(process.env.CG_TEST_JWKS)); } catch (e) { log('bad CG_TEST_JWKS', e.message); }
    }
    if (testJwks) return testJwks;
  }
  if (!savesEnabled()) return null;
  return (jwks ??= jose.createRemoteJWKSet(new URL(JWKS_URL), { timeoutDuration: TIMEOUT_MS }));   // (jose caches the keys)
}

// A CrazyGames IN_GAME_AUTH token → { userId, username } or null (bad signature, expired, wrong kid or game, disabled).
export async function verifyCgToken(token) {
  if (typeof token !== 'string' || token.length > 4096 || token.split('.').length !== 3) return null;
  try {
    const set = await keys();
    if (!set) return null;
    if (jose.decodeProtectedHeader(token).kid !== KID) return null;
    const { payload } = await jose.jwtVerify(token, set, { algorithms: ['RS256'], requiredClaims: ['exp'] });
    const gameId = process.env.CG_GAME_ID;
    if (gameId && String(payload.gameId) !== gameId) return null;
    const userId = typeof payload.userId === 'string' || typeof payload.userId === 'number' ? String(payload.userId) : '';
    if (!userId || userId.length > 128) return null;
    return { userId, username: cleanName(payload.username) || 'Wizard' };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- PostgREST
let fetchFn = (...a) => fetch(...a);
async function rest(path, { method = 'GET', body, prefer } = {}) {
  const { url, key } = env();
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetchFn(`${url}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${method} ${path.split('?')[0]}: ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// The verified user → { playerId, save, stats } (save: sanitized, or null if none yet; stats: the player_stats row or zeros),
// or null when disabled or on any error. Upserts `players` (username, last_seen) on cg_user_id.
export async function loadPlayer(cg) {
  if (!savesEnabled() || !cg?.userId) return null;
  try {
    const rows = await rest('players?on_conflict=cg_user_id&select=id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=representation',
      body: { cg_user_id: String(cg.userId), username: cleanName(cg.username) || 'Wizard', last_seen: new Date().toISOString() } });
    const playerId = rows?.[0]?.id;
    if (!playerId) return null;
    const [saves, stats] = await Promise.all([
      rest(`player_saves?player_id=eq.${playerId}&select=data`),
      rest(`player_stats?player_id=eq.${playerId}&select=matches,wins,podiums,kills,deaths,assists,damage,healing,potions,playtime_s`),
    ]);
    return { playerId, save: saves?.[0] ? sanitizeSave(saves[0].data) : null, stats: publicStats(stats?.[0]) };
  } catch (e) {
    log('loadPlayer', e.message);
    return null;
  }
}
const STAT_KEYS = ['matches', 'wins', 'podiums', 'kills', 'deaths', 'assists', 'damage', 'healing', 'potions', 'playtime_s'];
const publicStats = (r) => Object.fromEntries(STAT_KEYS.map(k => [k, Math.max(0, Number(r?.[k]) || 0)]));

// ---------------------------------------------------------------- the save
// The only shape stored: { v: 1, loadout, loadouts: [{ name, loadout }] (≤ 3), voice, settings: { volume, muted, bots, howto } }.
// Unknown keys are dropped, loadouts go through C.sanitizeLoadout (a bad one is dropped), strings are capped. Every key is
// optional, but a save replaces the whole stored object, so the client always sends all of it.
const MAX_SAVED = 3;   // (loadout-store.js MAX_SAVED)
const DIFFS = ['easy', 'normal', 'hard'];
export function sanitizeSave(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const out = { v: 1 };
  const lo = C.sanitizeLoadout(x.loadout);
  if (lo) out.loadout = lo;
  if (Array.isArray(x.loadouts)) {
    out.loadouts = x.loadouts.slice(0, 10).map(e => ({ name: cleanName(e?.name) || 'Custom', loadout: C.sanitizeLoadout(e?.loadout) }))
      .filter(e => e.loadout).slice(0, MAX_SAVED);
  }
  if (C.VOICES.includes(x.voice)) out.voice = x.voice;
  const s = x.settings;
  if (s && typeof s === 'object' && !Array.isArray(s)) {
    const st = {};
    if (Number.isFinite(s.volume)) st.volume = Math.round(Math.min(1, Math.max(0, s.volume)) * 100) / 100;
    if (typeof s.muted === 'boolean') st.muted = s.muted;
    if (DIFFS.includes(s.bots)) st.bots = s.bots;
    if (typeof s.howto === 'boolean') st.howto = s.howto;
    out.settings = st;
  }
  return JSON.stringify(out).length <= MAX_SAVE_BYTES ? out : null;
}
// A display name: no control characters, trimmed, at most 24 characters (as loadout-store.js names; `max` for event strings).
function cleanName(s, max = 24) {
  return typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, '').trim().slice(0, max) : '';
}

// playerId → { pending, timer, last, writing }
const queue = new Map();
// Queue the player's save: written at once if the last write was 10 s ago or more, else when the 10 s are up (the latest
// data wins). Returns the sanitized save (what the client should now consider stored), or null if rejected or disabled.
export function writeSave(playerId, data) {
  if (!savesEnabled() || !playerId) return null;
  const clean = sanitizeSave(data);
  if (!clean) return null;
  const q = queue.get(playerId) || { pending: null, timer: null, last: 0, writing: null };
  queue.set(playerId, q);
  q.pending = clean;
  if (!q.timer) {
    const wait = Math.max(0, q.last + SAVE_EVERY_MS - Date.now());
    q.timer = setTimeout(() => { q.timer = null; doWrite(playerId, q); }, wait);
    q.timer.unref?.();
  }
  return clean;
}
async function doWrite(playerId, q) {
  const data = q.pending;
  if (!data) return;
  q.pending = null; q.last = Date.now();
  const w = (async () => {
    try {
      await rest('player_saves?on_conflict=player_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
        body: { player_id: playerId, data, updated_at: new Date().toISOString() } });
    } catch (e) { log('writeSave', e.message); }
  })();
  q.writing = w;
  await w;
  if (q.writing === w) q.writing = null;   // (the entry stays until flushSave: it remembers when the last write was)
}
// On disconnect: write what's pending now (ignores the 10 s), and forget the player. Resolves when written.
export async function flushSave(playerId) {
  const q = queue.get(playerId);
  if (!q) return;
  if (q.timer) { clearTimeout(q.timer); q.timer = null; }
  if (q.pending) await doWrite(playerId, q);
  else if (q.writing) await q.writing;
  queue.delete(playerId);
}
// On shutdown (SIGTERM): every pending save, progress row and event.
export const flushAllSaves = () => Promise.all([...[...queue.keys()].map(flushSave), ...[...progress.keys()].map(flushProgress), flushEvents()]);

// ---------------------------------------------------------------- matches
const int = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
// One human's result → the record_match arguments (clamped; per-spell keys must be SPELLBOOK ids), or null if unusable.
export function sanitizeMatchRow(r) {
  if (!r || typeof r !== 'object') return null;
  const place = Math.round(Number(r.place));
  if (!(place >= 1 && place <= 64)) return null;
  const perSpell = {};
  if (r.perSpell && typeof r.perSpell === 'object') {
    for (const [id, v] of Object.entries(r.perSpell)) {
      if (!C.SPELLBOOK[id] || !v || typeof v !== 'object') continue;
      const e = { kills: int(v.kills, 500), damage: int(v.damage, 1e6), uses: int(v.uses, 1e5) };
      if (e.kills || e.damage || e.uses) perSpell[id] = e;
    }
  }
  return {
    p_room_kind: r.roomKind === 'private' ? 'private' : 'public',
    p_place: place, p_kills: int(r.kills, 500), p_deaths: int(r.deaths, 500), p_assists: int(r.assists, 500),
    p_damage: int(r.damage, 1e6), p_healing: int(r.healing, 1e6), p_potions: int(r.potions, 500),
    p_seconds: int(r.seconds, 3600), p_bots: int(r.bots, 64), p_per_spell: perSpell,
  };
}
// Adds one finished match to a verified player's stats (record_match: atomic, one call per human per match).
// Resolves true when stored, false when disabled, rejected or failed.
export async function recordMatch(playerId, row) {
  if (!savesEnabled() || !playerId) return false;
  const args = sanitizeMatchRow(row);
  if (!args) return false;
  try {
    await rest('rpc/record_match', { method: 'POST', body: { p_player: playerId, ...args } });
    return true;
  } catch (e) {
    log('recordMatch', e.message);
    return false;
  }
}
// The recap's hook: `list` is every fighter in place order (match.js recapOf's sorted list). Records each human with an
// account (p.account.playerId, set after a verified auth); bots are counted in `bots` but never recorded. Fire and forget.
// opts: { roomKind: 'public' | 'private', seconds: the match's live time }.
export function recordRecap(list, { roomKind = 'public', seconds = 0 } = {}) {
  if (!savesEnabled() || !Array.isArray(list)) return Promise.resolve([]);
  const bots = list.filter(p => p.bot).length;
  return Promise.all(list.map((p, i) => !p.bot && p.account?.playerId ? recordMatch(p.account.playerId, {
    roomKind, place: i + 1, kills: p.kills, deaths: p.deaths, assists: p.ms?.assists, damage: p.mDmg, healing: p.ms?.healed,
    potions: p.ms?.potions, seconds, bots, perSpell: p.ms?.perSpell,
  }) : false));
}

// ---------------------------------------------------------------- stats and leaderboard (round 19)
// The stats panel's { t: 'stats' } → getStats(ws.account?.playerId ?? null): { me, recent, board: { week, all }, rank: { week, all } },
// or null when disabled or on any error (server.js sends { t: 'stats', unavailable: true } then, and owns the 5 s rate limit).
// Every match counts (bots, private rooms: Ty, round 19).
// The boards (top 25 by wins, then kills; the week from Monday 00:00 UTC) come from the SQL functions leaderboard(period, lim)
// and player_rank(p_player, period) (docs/agents/requests.md, round 19) and are cached for 60 s; the player's own data is
// fetched on each ask. No ids go to the client: board rows are { rank, username, wins, kills, matches } (+ me: true on theirs).
export const BOARD_SIZE = 25;
export const BOARD_TTL_MS = 60_000;
const PERIODS = ['week', 'all'];
const num = (v) => Math.max(0, Number(v) || 0);

const boards = new Map();   // period → { at, rows } (rows keep player_id, server side only) | { pending }
function board(period, now = Date.now()) {
  const b = boards.get(period);
  if (b?.rows && now - b.at < BOARD_TTL_MS) return Promise.resolve(b.rows);
  if (b?.pending) return b.pending;
  const pending = rest('rpc/leaderboard', { method: 'POST', body: { period, lim: BOARD_SIZE } }).then(rows => {
    const clean = (Array.isArray(rows) ? rows : []).map(r => ({ rank: num(r.rank), playerId: r.player_id, username: cleanName(r.username) || 'Wizard',
      wins: num(r.wins), kills: num(r.kills), matches: num(r.matches) }));
    boards.set(period, { at: Date.now(), rows: clean });
    return clean;
  }, e => { boards.delete(period); throw e; });   // (an error isn't cached: the next ask tries again)
  boards.set(period, { ...b, pending });
  return pending;
}
// Both boards → { week, all } with the player ids (server side). Rejects on an error.
export const getBoards = () => Promise.all(PERIODS.map(p => board(p))).then(([week, all]) => ({ week, all }));

// The player's stats row → `me`: the totals plus winRate (0..1), kd, avgDamage (per match), playtime_s and topSpells
// (the 3 with the most kills, then damage: [{ id, kills, damage, uses }], known SPELLBOOK ids only).
export function derivedStats(row) {
  const s = publicStats(row);
  const topSpells = Object.entries(row?.per_spell && typeof row.per_spell === 'object' ? row.per_spell : {})
    .filter(([id, v]) => C.SPELLBOOK[id] && v && typeof v === 'object')
    .map(([id, v]) => ({ id, kills: num(v.kills), damage: num(v.damage), uses: num(v.uses) }))
    .filter(e => e.kills || e.damage || e.uses)
    .sort((a, b) => b.kills - a.kills || b.damage - a.damage || b.uses - a.uses || (a.id < b.id ? -1 : 1)).slice(0, 3);
  return { ...s, winRate: s.matches ? Math.round(s.wins / s.matches * 1000) / 1000 : 0,
    kd: Math.round(s.kills / Math.max(1, s.deaths) * 100) / 100, avgDamage: s.matches ? Math.round(s.damage / s.matches) : 0, topSpells };
}

// One player's own data → { me, recent, rank: { week, all } } (rank: { rank, wins, kills } or null when not on that board).
// Rejects on an error.
export async function playerStats(playerId) {
  const [stats, recent, week, all] = await Promise.all([
    rest(`player_stats?player_id=eq.${playerId}&select=${STAT_KEYS.join(',')},per_spell`),
    rest(`match_results?player_id=eq.${playerId}&select=place,kills,deaths,damage,room_kind,bots_in_match,created_at&order=created_at.desc&limit=10`),
    ...PERIODS.map(period => rest('rpc/player_rank', { method: 'POST', body: { p_player: playerId, period } })),
  ]);
  const rankOf = (rows) => { const r = Array.isArray(rows) ? rows[0] : rows; return r && num(r.rank) ? { rank: num(r.rank), wins: num(r.wins), kills: num(r.kills) } : null; };
  return {
    me: derivedStats(stats?.[0]),
    recent: (Array.isArray(recent) ? recent : []).map(r => ({ place: num(r.place), kills: num(r.kills), deaths: num(r.deaths), damage: num(r.damage),
      room: r.room_kind === 'private' ? 'private' : 'public', bots: num(r.bots_in_match), at: r.created_at })),
    rank: { week: rankOf(week), all: rankOf(all) },
  };
}

// The panel's whole answer. playerId: the asker's account (null for a guest: me null, recent [], rank nulls; the boards still
// shown). Resolves null when disabled or on any error; never rejects.
export async function getStats(playerId = null) {
  if (!savesEnabled()) return null;
  try {
    const [b, mine] = await Promise.all([getBoards(), playerId ? playerStats(playerId) : null]);
    const pub = (rows) => rows.map(r => ({ rank: r.rank, username: r.username, wins: r.wins, kills: r.kills, matches: r.matches,
      ...(playerId && r.playerId === playerId ? { me: true } : {}) }));
    return { me: mine?.me || null, recent: mine?.recent || [], board: { week: pub(b.week), all: pub(b.all) },
      rank: mine?.rank || { week: null, all: null } };
  } catch (e) {
    log('stats', e.message);
    return null;
  }
}

// ---------------------------------------------------------------- events (round 26, drop-off analytics)
// One session per human socket (bots and add-bots-only sockets get none). Rows go into one in-memory buffer, written as one
// bulk insert every EVENT_FLUSH_MS (at once when EVENT_BATCH are waiting), so nothing touches the network on the game loop.
// No IPs, emails or names: anon_id is the client's random id, cg_user_id only after a verified auth. EVENTS_OFF=1 turns it off.
export const EVENTS = ['session_start', 'join', 'first_kill', 'first_death', 'match_end', 'rematch_stay', 'menu_open', 'loadout_change',
  'idle_kick', 'disconnect'];
const EVENT_SET = new Set(EVENTS);
export const EVENT_FLUSH_MS = 5000;
export const EVENT_BATCH = 200;          // rows per insert (and the "write now" threshold)
export const EVENT_BUFFER_MAX = 2000;    // a down Supabase drops the oldest beyond this
const GENS = ['legacy', 'v22', 'v24', 'current'];   // (round 27: v24 = the proto 24-26 store build)
const ANON_RE = /^[A-Za-z0-9_-]{8,64}$/;
const DKEY_RE = /^[a-z][a-z0-9_]{0,23}$/;
const MAP_RE = /^[a-z0-9_-]{1,32}$/;
const eventsOn = () => savesEnabled() && process.env.EVENTS_OFF !== '1';

// A flat details object: ≤ 12 keys (lower case, digits, _; ≤ 24 chars); numbers (finite, 2 decimals), booleans, null, strings (≤ 48 chars). The rest dropped.
export function sanitizeDetails(d) {
  const out = {};
  if (!d || typeof d !== 'object' || Array.isArray(d)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(d)) {
    if (n >= 12) break;
    if (!DKEY_RE.test(k)) continue;
    if (typeof v === 'number') { if (!Number.isFinite(v)) continue; out[k] = Math.round(v * 100) / 100; }
    else if (typeof v === 'boolean' || v === null) out[k] = v;
    else if (typeof v === 'string') out[k] = cleanName(v, 48);
    else continue;
    n++;
  }
  return out;
}

// A new session → its handle (keep it on the socket). opts: { anonId, gen: 'legacy' | 'v22' | 'v24' | 'current', platform: 'crazygames' | 'web',
// first: first visit (client-told), cg: on CrazyGames }. Logs session_start. Works (as a no-op) when disabled.
export function startSession({ anonId, gen, platform, first, cg } = {}) {
  const s = { id: randomUUID(), anonId: typeof anonId === 'string' && ANON_RE.test(anonId) ? anonId : null, cgUserId: null,
    gen: GENS.includes(gen) ? gen : 'current', platform: platform === 'crazygames' ? 'crazygames' : 'web',
    start: Date.now(), joinedAt: 0, last: null, ended: false };
  logEvent(s, 'session_start', { platform: s.platform, first: !!first, cg: !!cg });
  return s;
}
// After a verified auth: the session's later events carry the CrazyGames user id.
export function setSessionUser(s, cgUserId) {
  if (s && (typeof cgUserId === 'string' || typeof cgUserId === 'number')) s.cgUserId = String(cgUserId).slice(0, 128) || null;
}

const evBuf = [];
const retried = new WeakSet();
let evTimer = null, evWriting = null;
// Queue one event (sync). Unknown events, ended or missing sessions are dropped. Returns true if queued.
export function logEvent(s, event, details = {}, map = null) {
  if (!s || s.ended || !EVENT_SET.has(event)) return false;
  if (event === 'join' && !s.joinedAt) s.joinedAt = Date.now();
  s.last = event;
  if (!eventsOn()) return false;
  evBuf.push({ created_at: new Date().toISOString(), session_id: s.id, anon_id: s.anonId, cg_user_id: s.cgUserId, gen: s.gen,
    platform: s.platform, event, map: typeof map === 'string' && MAP_RE.test(map) ? map : null, details: sanitizeDetails(details) });
  if (evBuf.length > EVENT_BUFFER_MAX) evBuf.splice(0, evBuf.length - EVENT_BUFFER_MAX);
  if (evBuf.length >= EVENT_BATCH) flushEvents();
  else if (!evTimer) { evTimer = setTimeout(flushEvents, EVENT_FLUSH_MS); evTimer.unref?.(); }
  return true;
}
// The socket closed: logs `disconnect` with { seconds (since the session started), joined_s (since the first join, null if never),
// last (the event before this one), ...details } (spells passes { state, kills, deaths, streak }). Later events are dropped.
export function endSession(s, details = {}) {
  if (!s || s.ended) return false;
  const now = Date.now();
  const d = { seconds: Math.round((now - s.start) / 1000), joined_s: s.joinedAt ? Math.round((now - s.joinedAt) / 1000) : null, last: s.last };
  for (const [k, v] of Object.entries(sanitizeDetails(details))) if (!(k in d) && Object.keys(d).length < 12) d[k] = v;
  const queued = logEvent(s, 'disconnect', d);
  s.ended = true;
  return queued;
}
// Write what's buffered (EVENT_BATCH rows per insert, one insert at a time). A failed batch is put back once, then dropped.
export async function flushEvents() {
  if (evTimer) { clearTimeout(evTimer); evTimer = null; }
  while (evWriting) await evWriting;
  if (!evBuf.length || !eventsOn()) return;
  evWriting = (async () => {
    while (evBuf.length) {
      const rows = evBuf.splice(0, EVENT_BATCH);
      try {
        await rest('events', { method: 'POST', prefer: 'return=minimal', body: rows });
      } catch (e) {
        log('events', e.message);
        const again = rows.filter(r => !retried.has(r));
        again.forEach(r => retried.add(r));
        if (again.length && evBuf.length + again.length <= EVENT_BUFFER_MAX) evBuf.unshift(...again);
        if (evBuf.length && !evTimer) { evTimer = setTimeout(flushEvents, EVENT_FLUSH_MS); evTimer.unref?.(); }
        break;
      }
    }
  })();
  try { await evWriting; } finally { evWriting = null; }
}

// ---------------------------------------------------------------- progress (round 26, XP, levels, unlocks, daily challenges)
// Logged-in players only; the XP maths and the challenge rules are spells' (constants.js / room.js): this stores and validates.
// One shared object per player on this server (two sockets of one player see the same one); written at most once per 10 s.
export const GUEST_XP_CAP = C.XP?.guestCap ?? 20_000;   // a guest's client-held XP merged into an account is capped (cosmetic only; spells' C.XP)
const ID_RE = /^[a-z0-9_-]{1,32}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_UNLOCKS = 64, MAX_SLOTS = 8, MAX_CHALLENGES = 6;
const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const date = (v) => typeof v === 'string' && DATE_RE.test(v.slice(0, 10)) ? v.slice(0, 10) : null;
const maxDate = (a, b) => (a && b ? (a > b ? a : b) : a || b || null);
function levelOf(xp, given) {
  const L = typeof C.levelForXp === 'function' ? C.levelForXp(xp) : undefined;
  const l = typeof L === 'number' ? L : L?.level;
  return Number.isFinite(l) ? Math.max(1, Math.min(1000, Math.round(l))) : Math.max(1, Math.min(1000, Math.round(Number(given) || 1)));
}
// Any progress-ish object (a row's camelCased fields, the client's guest progress) → the stored shape:
// { xp, level, unlocks: [id], equipped: { slot: id }, challenges: { day, list: [{ id, n, goal, done }] } | {}, lastDailyReset, firstWinDay }.
// The level comes from C.levelForXp(xp) when spells exports it, else the given one (clamped). null if not an object.
export function sanitizeProgress(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const xp = int(x.xp, 1e8);
  const unlocks = Array.isArray(x.unlocks) ? [...new Set(x.unlocks.filter(u => typeof u === 'string' && ID_RE.test(u)))].slice(0, MAX_UNLOCKS) : [];
  const equipped = {};
  if (x.equipped && typeof x.equipped === 'object' && !Array.isArray(x.equipped)) {
    for (const [k, v] of Object.entries(x.equipped)) {
      if (Object.keys(equipped).length >= MAX_SLOTS) break;
      if (ID_RE.test(k) && typeof v === 'string' && ID_RE.test(v)) equipped[k] = v;
    }
  }
  let challenges = {};
  const ch = x.challenges;
  if (ch && typeof ch === 'object' && date(ch.day) && Array.isArray(ch.list)) {
    challenges = { day: date(ch.day), list: ch.list.filter(c => c && typeof c.id === 'string' && ID_RE.test(c.id)).slice(0, MAX_CHALLENGES)
      .map(c => ({ id: c.id, n: int(c.n, 1e6), goal: int(c.goal, 1e6), done: c.done === true })) };
  }
  return { xp, level: levelOf(xp, x.level), unlocks, equipped, challenges, lastDailyReset: date(x.lastDailyReset), firstWinDay: date(x.firstWinDay) };
}
const fromRow = (r) => sanitizeProgress({ xp: r.xp, level: r.level, unlocks: r.unlocks, equipped: r.equipped, challenges: r.challenges,
  lastDailyReset: r.last_daily_reset, firstWinDay: r.first_win_day });

// playerId → { p (the shared object), loading, pending, timer, last, writing, mergedAt }
const progress = new Map();
const entryOf = (playerId) => {
  let e = progress.get(playerId);
  if (!e) progress.set(playerId, e = { p: null, loading: null, pending: false, timer: null, last: 0, writing: null, mergedAt: null });
  return e;
};
// → the player's progress { ...sanitizeProgress, guestMerged, fresh (no row yet) }, or null (disabled or an error: play as a guest).
export async function loadProgress(playerId) {
  if (!savesEnabled() || !playerId) return null;
  const e = entryOf(playerId);
  if (e.p) return e.p;
  e.loading ??= rest(`player_progress?player_id=eq.${playerId}&select=xp,level,unlocks,equipped,challenges,last_daily_reset,first_win_day,guest_merged_at`)
    .then(rows => {
      const r = Array.isArray(rows) ? rows[0] : null;
      if (!e.p) e.p = r ? { ...fromRow(r), guestMerged: !!r.guest_merged_at, fresh: false } : { ...sanitizeProgress({}), guestMerged: false, fresh: true };
      return e.p;
    }, err => { log('loadProgress', err.message); return null; })
    .finally(() => { e.loading = null; if (!e.p && !e.pending && !e.timer) progress.delete(playerId); });
  return e.loading;
}
// Store the player's progress (the whole object; sanitized; written at once if the last write was 10 s ago, else when they're up).
// Updates the shared object in place and returns it, or null if disabled or not an object.
export function writeProgress(playerId, data) {
  if (!savesEnabled() || !playerId) return null;
  const clean = sanitizeProgress(data);
  if (!clean) return null;
  const e = entryOf(playerId);
  if (e.p) Object.assign(e.p, clean, { fresh: false });
  else e.p = { ...clean, guestMerged: false, fresh: false };
  e.pending = true;
  if (!e.timer) {
    e.timer = setTimeout(() => { e.timer = null; writeProgressNow(playerId, e); }, Math.max(0, e.last + SAVE_EVERY_MS - Date.now()));
    e.timer.unref?.();
  }
  return e.p;
}
async function writeProgressNow(playerId, e) {
  if (!e.pending || !e.p) return;
  e.pending = false; e.last = Date.now();
  const p = e.p;
  const w = (async () => {
    try {
      await rest('player_progress?on_conflict=player_id', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
        body: { player_id: playerId, xp: p.xp, level: p.level, unlocks: p.unlocks, equipped: p.equipped, challenges: p.challenges,
          last_daily_reset: p.lastDailyReset, first_win_day: p.firstWinDay, updated_at: new Date().toISOString(),
          ...(e.mergedAt ? { guest_merged_at: e.mergedAt } : {}) } });   // (left out, an upsert keeps the stored guest_merged_at)
    } catch (err) { log('writeProgress', err.message); }
  })();
  e.writing = w;
  await w;
  if (e.writing === w) e.writing = null;
}
// The client's guest progress (localStorage) on login → the account's progress after merging it, once per account (guest_merged_at):
// XP = max(account, guest capped at GUEST_XP_CAP), unlocks = the union, equipped = the account's unless it has none, challenges =
// the account's if they're today's (UTC), else the guest's if theirs are, the dates the later of the two. Already merged → the
// account's progress unchanged (so the client can send its local progress on every login). null if disabled or on an error.
export async function mergeGuestProgress(playerId, guest, now = Date.now()) {
  const acc = await loadProgress(playerId);
  if (!acc) return null;
  if (acc.guestMerged) return acc;
  const g = sanitizeProgress(guest) || sanitizeProgress({});
  const today = utcDay(now);
  const merged = {
    xp: Math.max(acc.xp, Math.min(g.xp, GUEST_XP_CAP)),
    unlocks: [...new Set([...acc.unlocks, ...g.unlocks])],
    equipped: Object.keys(acc.equipped).length ? acc.equipped : g.equipped,
    challenges: acc.challenges.day === today || g.challenges.day !== today ? acc.challenges : g.challenges,
    lastDailyReset: maxDate(acc.lastDailyReset, g.lastDailyReset),
    firstWinDay: maxDate(acc.firstWinDay, g.firstWinDay),
    level: Math.max(acc.level, g.level),
  };
  const e = entryOf(playerId);
  e.mergedAt = new Date(now).toISOString();
  acc.guestMerged = true;
  return writeProgress(playerId, merged);
}
// On disconnect: write what's pending now (ignores the 10 s) and forget the player. Resolves when written.
export async function flushProgress(playerId) {
  const e = progress.get(playerId);
  if (!e) return;
  if (e.timer) { clearTimeout(e.timer); e.timer = null; }
  if (e.loading) await e.loading;
  if (e.pending) await writeProgressNow(playerId, e);
  else if (e.writing) await e.writing;
  progress.delete(playerId);
}

// ---------------------------------------------------------------- rate limit
// Per socket (or any object): a burst of 2 auths, then one per 30 s. authAllowed(ws) → true to go ahead.
const authBuckets = new WeakMap();
export function authAllowed(key, now = Date.now()) {
  const b = authBuckets.get(key) || { tokens: 2, at: now };
  b.tokens = Math.min(2, b.tokens + (now - b.at) / AUTH_EVERY_MS); b.at = now;
  authBuckets.set(key, b);
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

// ---------------------------------------------------------------- tests only (NODE_ENV=test)
export const _test = TEST ? {
  async useJwks(set) { jose ??= await import('jose'); testJwks = set ? jose.createLocalJWKSet(set) : null; },
  useFetch(fn) { fetchFn = fn || ((...a) => fetch(...a)); },
  reset() {
    for (const q of queue.values()) if (q.timer) clearTimeout(q.timer);
    for (const e of progress.values()) if (e.timer) clearTimeout(e.timer);
    if (evTimer) clearTimeout(evTimer);
    queue.clear(); boards.clear(); progress.clear(); evBuf.length = 0; evTimer = null;
  },
  queued: (id) => queue.get(id),
  progressEntry: (id) => progress.get(id),
  events: () => evBuf,
} : null;
