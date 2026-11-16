// Round 26: XP, levels and daily challenges on the server (docs/agents/round26-playtime.md §2). Spells agent.
// Every human has `p.prog` (C.sanitizeProgress's shape: the one shape for guests' localStorage and Supabase's player_progress)
// and `p.adapt` (the adaptive-difficulty state, client-held). The server works out every award from the match's own stats:
// a logged-in player's progress is saved (server.js → Saves.writeProgress); a guest's client stores what it's sent.
// The maths (levels, the XP table, the daily rotation, the rating) is constants.js's, shared with the client.
import * as C from '../public/shared/constants.js';

// A human's progress at the join: a guest's own (the join's `progress`), or a fresh one until an account's arrives.
export function initProgress(p, raw, { firstVisit = false, adapt = null } = {}) {
  p.prog = C.sanitizeProgress(raw);
  p.progAccount = false;
  p.adapt = C.sanitizeAdapt(adapt, firstVisit);
  p.challengeItems = [];   // challenges completed since the last match's award: [{ k: 'challenge', id, xp }]
}
// An account's progress (Saves.loadProgress / mergeGuestProgress) replaces the guest's.
export function setAccountProgress(p, raw) {
  p.prog = C.sanitizeProgress(raw);
  p.progAccount = true;
  p.challengeItems = [];
}
// A new UTC day: today's challenges (the XP and the first-win day stay)
function rollDay(p) {
  const day = C.dayKey();
  if (p.prog.challenges.day !== day) p.prog = C.sanitizeProgress({ ...p.prog, challenges: null }, day);
}
// A challenge counter moved (live matches only; room.js checks). Returns the challenges it moved: [{ id, text, n, goal, done, xp, newly }].
export function bump(p, stat, n = 1) {
  if (!p?.prog || p.bot || !(n > 0)) return [];
  rollDay(p);
  const out = [];
  for (const e of p.prog.challenges.list) {
    const c = C.DAILY_POOL.find(k => k.id === e.id);
    if (!c || c.stat !== stat || e.done) continue;
    const before = e.n;
    e.n = Math.min(e.goal, e.n + n);
    if (Math.floor(e.n) === Math.floor(before)) continue;
    e.n = Math.floor(e.n * 1000) / 1000;
    const newly = e.n >= e.goal;
    if (newly) {
      e.n = e.goal; e.done = true;
      p.prog.xp += c.xp;
      p.challengeItems.push({ k: 'challenge', id: c.id, xp: c.xp });
    }
    out.push({ id: e.id, text: c.text, n: Math.floor(e.n), goal: e.goal, done: e.done, xp: c.xp, newly });
  }
  return out;
}
// The match is over for a human who finished it: the end-of-match challenges, the match's XP, the rating. Returns
// { xp message, challenges moved }. `place` is 1-based among `of` fighters; `won`: first outright; `map`: the map's public id.
export function finishMatch(p, { place, of, won, map, kills = 0, deaths = 0 }) {
  rollDay(p);
  const lvBefore = C.levelForXp(p.prog.xp - p.challengeItems.reduce((s, i) => s + i.xp, 0));
  const moved = [
    ...bump(p, 'matches'),
    ...(place <= 3 && of > 1 ? bump(p, 'podiums') : []),
    ...(won ? bump(p, 'wins') : []),
    ...(won && map === 'sky' ? bump(p, 'winSky') : []),
  ];
  const day = C.dayKey();
  const firstWin = won && p.prog.firstWinDay !== day;
  if (firstWin) p.prog.firstWinDay = day;
  const mx = C.matchXp({ kills, place, won, firstWin });
  const items = [...mx.items, ...p.challengeItems];
  const gained = items.reduce((s, i) => s + i.xp, 0);
  const beforeXp = p.prog.xp - p.challengeItems.reduce((s, i) => s + i.xp, 0);
  p.challengeItems = [];
  p.prog.xp = Math.min(1e8, p.prog.xp + mx.total);
  const lvAfter = C.levelForXp(p.prog.xp);
  p.prog = C.sanitizeProgress(p.prog, day);   // (the level, the unlocks)
  const levelUps = [], unlocked = [];
  for (let L = lvBefore + 1; L <= lvAfter; L++) { levelUps.push(L); for (const u of C.UNLOCKS) if (u.level === L) unlocked.push(u); }
  p.adapt = C.adaptAfter(p.adapt, place, of, kills, deaths);
  return {
    msg: { t: 'xp', items, gained, before: { xp: beforeXp, ...C.levelInfo(beforeXp) }, progress: C.progressPublic(p.prog, p.progAccount), levelUps, unlocked, adapt: p.adapt },
    moved,
  };
}
// What Saves.writeProgress stores
export const progressRow = (p) => ({ ...p.prog, lastDailyReset: p.prog.challenges.day });
export const progressOf = (p) => C.progressPublic(p.prog, p.progAccount);
