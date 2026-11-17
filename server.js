// Wizard Arena — authoritative game server.
// Round 17: the arena is split into rooms (server/room.js: each its own match, players, bots and props). This file keeps
// the sockets, matchmaking (public rooms, private rooms by code), the room and bot caps, cleanup and the tick loops.
// Clients own their own movement (position/yaw) and send inputs for everything else.
// The server owns combat: spells, projectiles, health, stamina, stuns, props and respawns.

import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as C from './public/shared/constants.js';
import { createRoom } from './server/room.js';
import * as Saves from './server/saves.js';
import { createNotifier } from './server/notify.js';   // round 23: Discord alerts when a real player is in, and the admin key (env only; no-ops without)
import { attach as attachNoobTube } from './vendor/noobtube/server/index.js';   // Noob Tube (separate game) on /nt, rooms in its own worker thread   // round 18: CrazyGames players' saves on Supabase (environment-owned; no-ops without keys)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
// round 17: the room count too (Render only needs the 200)
app.get('/healthz', (req, res) => res.type('text').send(`ok rooms=${rooms.size} humans=${totalHumans()} bots=${totalBots()}`));
(await import('./server/mapedit.js')).mountMapEdit(app, __dirname);   // the map editor: /?edit=1, saving only with MAP_EDIT=1 (environment)
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
// three.js is served from node_modules so the game has no CDN dependency.
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three'), { maxAge: '7d' }));
// Noob Tube (~/thoomp, packaged by its tools/sync-to-wizard-arena.mjs): the web client at /noobtube/, its game
// server on the /nt websocket path in a worker_thread (its ticks never block ours). NOOBTUBE=0 turns it off.
app.use('/noobtube', express.static(path.join(__dirname, 'vendor', 'noobtube', 'public'), { maxAge: '1h' }));
const httpServer = http.createServer(app);
const nt = process.env.NOOBTUBE === '0' ? null : attachNoobTube(httpServer, { path: '/nt' });
app.get('/nt/healthz', (req, res) => res.type('text').send(nt ? nt.healthz() : 'off'));
app.get('/nt/perf', (req, res) => res.json(nt ? nt.perf() : { off: true }));
// Upgrades are routed: /nt belongs to Noob Tube's own socket server, everything else is ours.
const wss = new WebSocketServer({ noServer: true });
httpServer.on('upgrade', (req, socket, head) => {
  if (nt?.claims(req)) return;
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

// ---------------------------------------------------------------- rooms (round 17)
// Public rooms: a plain join goes to the fullest public room with a free human seat (else a new one). Private rooms: made
// with { room: 'new' }, joined by their code; up to 4 humans, bots fill the empty seats. A room with no humans (and
// nobody watching) for ROOM_EMPTY_TTL s is deleted. Caps protect the instance: rooms and bots server-wide.
const MAX_ROOMS = +process.env.MAX_ROOMS || 40;
const MAX_BOTS = +process.env.MAX_BOTS || 90;
const ROOM_EMPTY_TTL = +process.env.ROOM_EMPTY_TTL || 60;
// Round 22: the protocol version a client sends with its join (`proto`). A join without it (the old CrazyGames build, which
// bundles its own layout and knows nothing of runes, pads or a second map) goes to a legacy room: the courtyard only, never shared
// with a current client. Round 24: three generations of client, each in rooms of its own (a private code of another generation is
// refused): 'legacy' (no proto), 'v22' (proto 22-23: the round-23 build pending at CrazyGames bundles the OLD Sky Ruins layout, so its
// rooms stay on the courtyard with runes, pads and the current pace, no rotation), 'current' (proto >= PROTO: the rebuilt Sky Ruins).
// Round 26: PROTO 26 (XP, challenges, cosmetics, emotes: new messages go only to 26+ players), but the rooms still split at 24:
// a 24 and a 26 client share 'current' rooms.
// Round 27: PROTO 27 (six wizards with fixed kits; Roll and Trapped Relic gone). The store build (proto 24-26: free loadouts, Roll and
// Relic) gets rooms of its own, 'v24', with its old rules (room.js: only 'current' rooms play kits). No 26 client ever shipped.
export const PROTO = 27;
export const CURRENT_FROM = 27;
export const V24_FROM = 24;
export const GENERATIONS = ['legacy', 'v22', 'v24', 'current'];
export const genOf = (msg) => !Number.isFinite(msg.proto) ? 'legacy' : msg.proto >= CURRENT_FROM ? 'current' : msg.proto >= V24_FROM ? 'v24' : 'v22';
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0 O 1 I L
const now = () => performance.now() / 1000;
const rooms = new Map();   // id ('public-3' or the private code) -> room
let nextPlayerId = 1, nextPublic = 1;
const allocId = () => nextPlayerId++;
const totalBots = () => { let n = 0; for (const r of rooms.values()) n += r.botCount(); return n; };
const totalHumans = () => { let n = 0; for (const r of rooms.values()) n += r.humanCount(); return n; };
const canAddBot = () => totalBots() < MAX_BOTS;
const notifier = createNotifier();
if (notifier.enabled) console.log('[notify] Discord alerts on');

// round 18: a finished match goes to the players' saves (guests and bots are skipped there; lab rooms aren't recorded).
// Round 23: and a short Discord line when a real player was in it (notify.js throttles it).
function onMatchEnd(list, { roomKind, seconds, roomId, map, legacy }) {
  if (roomKind !== 'public' && roomKind !== 'private') return;
  Saves.recordRecap(list, { roomKind, seconds }).catch(e => console.warn('[saves] recordRecap', e));
  try { notifier.onMatchEnd({ roomId, kind: roomKind, legacy, map, seconds, ranked: list.map(p => ({ name: p.name, bot: !!p.bot, admin: !!p.admin, kills: p.kills || 0 })) }); } catch (e) { console.warn('[notify] matchEnd', e); }
}
// round 23: a human joined a room (room.js, after the welcome): a Discord alert when a real player (not Ty) is the first one in
function onHumanJoin(ev) {
  try { notifier.onHumanJoin(ev); } catch (e) { console.warn('[notify] join', e); }
}
// round 26 (§1, §2): the drop-off events (Saves batches them off the loop) and a logged-in player's progress (one write per 10 s at most)
function logEvent(session, event, details, map) {
  if (!session || typeof Saves.logEvent !== 'function') return;
  try { Saves.logEvent(session, event, details, map); } catch (e) { console.warn('[events]', e); }
}
function saveProgress(p, row) {
  if (!p.account || typeof Saves.writeProgress !== 'function') return;
  try { Saves.writeProgress(p.account.playerId, row); } catch (e) { console.warn('[saves] progress', e); }
}
function makeRoom(kind, gen = 'current') {
  if (rooms.size >= MAX_ROOMS) return null;
  let id, code = null;
  if (kind === 'private') {
    do { code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join(''); } while (rooms.has(code));
    id = code;
  } else id = `${kind}-${nextPublic++}`;
  const room = createRoom({ id, kind, code, allocId, canAddBot, onMatchEnd, onHumanJoin, isAdmin: (k) => notifier.isAdmin(k), legacy: gen === 'legacy', gen,
    logEvent, saveProgress });   // round 26: the drop-off events and a logged-in player's progress (Saves, environment's)
  rooms.set(id, room);
  console.log(`[room] ${id} opened${gen !== 'current' ? ` (${gen})` : ''} (${rooms.size} rooms)`);
  return room;
}
// The fullest public room with a free seat (an empty one counts), else a new one. At the room cap: the emptiest public
// room even if full (the 5th human watches until a place opens), so a plain join always gets in somewhere. Round 22: only
// rooms of the joiner's generation (legacy, v22 or current). Ty: players should face each other over bots whenever possible, so other
// humans always win; a first visit only prefers the first map (the keep; the courtyard in older rooms) between rooms with the same number of humans.
const onCourtyard = (r) => r.map() === (r.homeMap?.() ?? 'courtyard') ? 0 : 1;   // (round 29: the generation's first map)
function publicRoom(gen = 'current', firstVisit = false) {
  const pub = [...rooms.values()].filter(r => r.kind === 'public' && r.gen === gen);
  const free = pub.filter(r => r.humanCount() < 4)
    .sort((a, b) => b.humanCount() - a.humanCount() || (firstVisit ? onCourtyard(a) - onCourtyard(b) : 0));
  return free[0] || makeRoom('public', gen) || pub.sort((a, b) => a.humanCount() - b.humanCount())[0] || null;
}
const cleanCode = (v) => String(v ?? '').trim().toUpperCase();
const ROOM_ERRORS = {
  unknown: (c) => `There's no room ${c}. You're in a public match instead.`,
  full: (c) => `Room ${c} is full. You're in a public match instead.`,
  busy: () => `The server is too busy for a new private room right now. You're in a public match instead.`,
  version: (c, gen, roomGen) => GENERATIONS.indexOf(gen) < GENERATIONS.indexOf(roomGen) ? `Room ${c} runs a newer version of the game: reload the page to join it. You're in a public match instead.`
    : `Room ${c} runs an older version of the game. You're in a public match instead.`,
};
// Where a join goes: { room, error } (error: a private room that couldn't be had; the player lands in a public room).
// Round 22 / 24: `gen` (the join's generation, genOf) keeps to rooms of that generation; `firstVisit` prefers the courtyard. Round 23: an admin (Ty, the
// join's verified key) may name a public room by its id ('public-3') and lands there when it has a free seat and is their kind;
// anyone else naming one gets today's public match.
function roomFor(want, gen = 'current', firstVisit = false, admin = false) {
  const code = cleanCode(want);
  let reason = null, roomGen = null;
  if (code === 'NEW') { const r = makeRoom('private', gen); if (r) return { room: r }; reason = 'busy'; }
  else if (admin && /^PUBLIC-\d+$/.test(code)) {
    const r = rooms.get(code.toLowerCase());
    if (r && r.kind === 'public' && r.gen === gen && r.humanCount() < 4) return { room: r };
    reason = !r || r.kind !== 'public' ? 'unknown' : r.gen !== gen ? 'version' : 'full';
    roomGen = r?.gen;
  }
  else if (code && code !== 'PUBLIC') {
    const r = rooms.get(code);
    if (!r || r.kind !== 'private') reason = 'unknown';
    else if (r.gen !== gen) { reason = 'version'; roomGen = r.gen; }
    else if (r.humanCount() >= 4) reason = 'full';
    else return { room: r };
  }
  const room = publicRoom(gen, firstVisit);
  return { room, error: reason && { code: code === 'NEW' ? null : code, reason, text: ROOM_ERRORS[reason](code, gen, roomGen) } };
}
// A socket that sends addBot / removeBots without joining (`node bot.js`, the balance tools): the room it names, else the
// busiest public room with humans in it, else a lab room of its own (bots only, nobody can join it).
function observerRoom(want) {
  const r = rooms.get(cleanCode(want));
  if (r) return r;
  const busy = [...rooms.values()].filter(q => q.kind === 'public' && q.humanCount() > 0).sort((a, b) => b.humanCount() - a.humanCount())[0];
  return busy || makeRoom('lab');
}
function cleanupRooms() {
  const t = now();
  for (const [id, r] of rooms) {
    if (r.humanCount() || r.observerCount() || r.emptySince == null || t - r.emptySince < ROOM_EMPTY_TTL) continue;
    r.close();
    rooms.delete(id);
    console.log(`[room] ${id} closed: empty for ${ROOM_EMPTY_TTL} s (${rooms.size} rooms)`);
  }
}

// ---------------------------------------------------------------- stats (round 19)
// { t: 'stats' } → { t: 'stats', me, recent, board, rank } from Saves.getStats (environment), or { t: 'stats', unavailable: true }.
// One per STATS_EVERY_MS per socket: an early request waits for its turn (repeats collapse into one), so a panel never hangs.
// An auth still being verified on this socket is waited for, so a logged-in player gets their own stats.
const STATS_EVERY_MS = +process.env.STATS_EVERY_MS || 5000;
function statsRequest(ws) {
  if (ws.statsQueued) return;
  const wait = Math.max(0, (ws.statsAt || 0) + STATS_EVERY_MS - Date.now());
  ws.statsQueued = true;
  setTimeout(() => {
    ws.statsQueued = false;
    ws.statsAt = Date.now();
    Promise.resolve(ws.authP).catch(() => {})
      .then(() => typeof Saves.getStats === 'function' ? Saves.getStats(ws.account?.playerId ?? null) : null)
      .catch(e => { console.warn('[saves] stats', e); return null; })
      .then(r => { if (ws.readyState === 1) ws.send(JSON.stringify(r ? { t: 'stats', ...r } : { t: 'stats', unavailable: true })); });
  }, wait);
}

// ---------------------------------------------------------------- network
wss.on('connection', (ws) => {
  let id = null, room = null, watching = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  // round 26: a logged-in player's progress, once both the auth and the join are in: the account's (Saves.loadProgress), with this
  // browser's guest progress merged into it the first time (Saves.mergeGuestProgress: once per account, environment's rule)
  const linkProgress = () => {
    if (!ws.account || id === null || ws.progressLinked || ws.progressLinking || typeof Saves.loadProgress !== 'function') return;
    ws.progressLinking = true;
    const pid = ws.account.playerId;
    Promise.resolve(Saves.loadProgress(pid)).then(async (prog) => {
      if (!prog) return;   // disabled or an error: they keep the guest's progress for this session
      const fresh = !!prog.fresh;   // (no progress row until now: the account's first login since round 26)
      const guest = room?.guestProgress(id);
      let merged = false;
      if (guest && !prog.guestMerged && typeof Saves.mergeGuestProgress === 'function') {
        const m = await Saves.mergeGuestProgress(pid, guest);
        if (m) { prog = m; merged = true; }
      }
      ws.progressLinked = true;
      ws.accountProgress = prog;
      // round 26b: an account that had played matches before its first round-26 login keeps every wizard (grandfathered). Only then:
      // later, matches > 0 may be matches played on the ladder.
      if (id !== null && ws.readyState === 1) room?.setProgress(id, prog, merged, { grandfather: fresh && ws.profileMatches > 0 });
    }).catch(e => console.warn('[saves] progress', e)).finally(() => { ws.progressLinking = false; });
  };

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    // round 18: a CrazyGames player's token (before or after the join; again on a refresh): their account, save and stats
    if (msg.t === 'auth') {
      if (typeof msg.token !== 'string' || !Saves.authAllowed(ws)) return;
      ws.authP = Saves.verifyCgToken(msg.token).then(cg => cg && Saves.loadPlayer(cg).then(acc => ({ cg, acc }))).then(r => {
        if (ws.readyState !== 1) return;
        if (!r?.acc) { ws.send(JSON.stringify({ t: 'profile', guest: true })); return; }
        ws.account = { playerId: r.acc.playerId, userId: r.cg.userId, username: r.cg.username };
        ws.profileMatches = +r.acc.stats?.matches || 0;   // round 26b: grandfathering
        const p = id !== null && room?.players.get(id);
        if (p) p.account = ws.account;
        ws.send(JSON.stringify({ t: 'profile', username: r.cg.username, save: r.acc.save, stats: r.acc.stats }));
        if (ws.session) try { Saves.setSessionUser?.(ws.session, r.cg.userId); } catch (e) { console.warn('[events]', e); }   // round 26
        linkProgress();
      }).catch(e => console.warn('[saves] auth', e));
      return;
    }
    if (msg.t === 'save') { if (ws.account) Saves.writeSave(ws.account.playerId, msg.data); return; }
    if (msg.t === 'stats') { statsRequest(ws); return; }   // round 19: the stats panel (before or after the join)
    // round 20: the round trip for the scoreboard. { t: 'ping', c, rtt } is answered at once with { t: 'pong', c }; `rtt` is the
    // client's own last measure (ms), shown to everyone in the match. At most two a second.
    if (msg.t === 'ping') {
      const t = Date.now();
      if (t - (ws.pingAt || 0) < 500) return;
      ws.pingAt = t;
      ws.send(JSON.stringify({ t: 'pong', c: msg.c }));
      const rtt = Number(msg.rtt), p = id !== null && room?.players.get(id);
      if (p && Number.isFinite(rtt) && rtt >= 0 && rtt < 10000) p.ping = Math.round(rtt);
      return;
    }

    if (id === null) {
      if (msg.t === 'addBot' || msg.t === 'removeBots') {
        if (!watching) { watching = observerRoom(msg.room); watching?.observe(ws); }
        watching?.observerMessage(msg);
        return;
      }
      if (msg.t === 'matchDebug') { watching?.observerMessage(msg); return; }   // round 26: the adaptive sim's lab room (MATCH_DEBUG only; room.js and match.js check)
      if (msg.t !== 'join') return;
      const gen = genOf(msg);   // round 22 / 24: no `proto` = the old CrazyGames build; 22-23 = the round-23 build (the courtyard only)
      const pick = roomFor(msg.room, gen, msg.firstVisit === true, notifier.isAdmin(msg.admin));   // (round 23: the admin key, never echoed or logged)
      room = pick.room;
      if (!room) { ws.send(JSON.stringify({ t: 'notice', text: 'The server is full. Try again in a minute.' })); ws.close(4001, 'full'); return; }
      if (watching) { watching.unobserve(ws); watching = null; }
      if (pick.error) { ws.send(JSON.stringify({ t: 'roomError', ...pick.error })); console.log(`[room] ${pick.error.reason} '${pick.error.code}': to ${room.id}`); }
      if (gen !== 'current') console.log(`[room] a ${gen} join (proto ${msg.proto ?? 'none'}) -> ${room.id}`);
      // round 26 (§1): the drop-off session, one per socket (environment's Saves.startSession logs session_start)
      if (!ws.session && typeof Saves.startSession === 'function') {
        const cgPlat = msg.platform === 'crazygames' || gen === 'legacy' || !!ws.account;
        try { ws.session = Saves.startSession({ anonId: typeof msg.anon === 'string' ? msg.anon : null, gen, platform: cgPlat ? 'crazygames' : 'web', first: msg.firstVisit === true, cg: cgPlat }) || null; }
        catch (e) { console.warn('[events]', e); }
        if (ws.session && ws.account) try { Saves.setSessionUser?.(ws.session, ws.account.userId); } catch {}
      }
      id = room.join(ws, msg, pick.error ? { roomError: pick.error } : {});
      linkProgress();
      return;
    }
    room.message(id, msg);
  });

  ws.on('close', () => {
    watching?.unobserve(ws);
    if (ws.account) Saves.flushSave(ws.account.playerId).catch(() => {});
    if (ws.account && typeof Saves.flushProgress === 'function') Promise.resolve(Saves.flushProgress(ws.account.playerId)).catch(() => {});   // round 26
    if (id === null) return;
    if (ws.session && typeof Saves.endSession === 'function') try { Saves.endSession(ws.session, room.playerState(id)); } catch (e) { console.warn('[events]', e); }   // round 26: the disconnect event
    room.leave(id);
  });
});

// heartbeat
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 15000);

// round 20: tick profiling. How long each loop takes (every room's simulate; every room's snapshot, which serialises and
// sends), and how late the tick timer fires, over 10 s windows: GET /perf, and a log line with PERF_LOG=1. The target:
// a tick under 4 ms at 60 Hz on Render Standard with 4 rooms of 4.
const prof = { sim: [], snap: [], late: [], last: null };
const sum = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { n: s.length, avg: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3), p95: +at(0.95).toFixed(3), max: +s[s.length - 1].toFixed(3) };
};
setInterval(() => {
  prof.last = { at: new Date().toISOString(), rooms: rooms.size, humans: totalHumans(), bots: totalBots(),
    tickMs: sum(prof.sim), snapshotMs: sum(prof.snap), timerLateMs: sum(prof.late), heapMB: Math.round(process.memoryUsage().heapUsed / 1048576) };
  prof.sim.length = prof.snap.length = prof.late.length = 0;
  if (process.env.PERF_LOG) console.log('[perf]', JSON.stringify(prof.last));
}, 10000);
app.get('/perf', (req, res) => res.json(prof.last ?? { pending: 'the first 10 s window' }));

// loops: one tick for every room
let last = now();
setInterval(() => {
  const t = now();
  const dt = Math.min(0.1, t - last); last = t;
  prof.late.push(Math.max(0, (dt - 1 / C.TICK_RATE) * 1000));
  for (const r of rooms.values()) r.simulate(dt);
  prof.sim.push((now() - t) * 1000);
}, 1000 / C.TICK_RATE);
setInterval(() => { const t = now(); for (const r of rooms.values()) r.snapshot(); prof.snap.push((now() - t) * 1000); }, 1000 / C.SNAPSHOT_RATE);
setInterval(cleanupRooms, 1000);

// round 18: a deploy or restart writes the saves still waiting on their 10 s
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  if (stopping) process.exit(0);
  stopping = true;
  Promise.race([Saves.flushAllSaves(), new Promise(r => setTimeout(r, 3000))]).finally(() => process.exit(0));
});

httpServer.listen(PORT, () => console.log(`Wizard Arena listening on http://localhost:${PORT}`));
