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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
// round 17: the room count too (Render only needs the 200)
app.get('/healthz', (req, res) => res.type('text').send(`ok rooms=${rooms.size} humans=${totalHumans()} bots=${totalBots()}`));
(await import('./server/mapedit.js')).mountMapEdit(app, __dirname);   // the map editor: /?edit=1, saving only with MAP_EDIT=1 (environment)
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
// three.js is served from node_modules so the game has no CDN dependency.
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three'), { maxAge: '7d' }));
const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer });

// ---------------------------------------------------------------- rooms (round 17)
// Public rooms: a plain join goes to the fullest public room with a free human seat (else a new one). Private rooms: made
// with { room: 'new' }, joined by their code; up to 4 humans, bots fill the empty seats. A room with no humans (and
// nobody watching) for ROOM_EMPTY_TTL s is deleted. Caps protect the instance: rooms and bots server-wide.
const MAX_ROOMS = +process.env.MAX_ROOMS || 40;
const MAX_BOTS = +process.env.MAX_BOTS || 90;
const ROOM_EMPTY_TTL = +process.env.ROOM_EMPTY_TTL || 60;
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0 O 1 I L
const now = () => performance.now() / 1000;
const rooms = new Map();   // id ('public-3' or the private code) -> room
let nextPlayerId = 1, nextPublic = 1;
const allocId = () => nextPlayerId++;
const totalBots = () => { let n = 0; for (const r of rooms.values()) n += r.botCount(); return n; };
const totalHumans = () => { let n = 0; for (const r of rooms.values()) n += r.humanCount(); return n; };
const canAddBot = () => totalBots() < MAX_BOTS;

function makeRoom(kind) {
  if (rooms.size >= MAX_ROOMS) return null;
  let id, code = null;
  if (kind === 'private') {
    do { code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join(''); } while (rooms.has(code));
    id = code;
  } else id = `${kind}-${nextPublic++}`;
  const room = createRoom({ id, kind, code, allocId, canAddBot });
  rooms.set(id, room);
  console.log(`[room] ${id} opened (${rooms.size} rooms)`);
  return room;
}
// The fullest public room with a free seat (an empty one counts), else a new one. At the room cap: the emptiest public
// room even if full (the 5th human watches until a place opens), so a plain join always gets in somewhere.
function publicRoom() {
  const pub = [...rooms.values()].filter(r => r.kind === 'public');
  const free = pub.filter(r => r.humanCount() < 4).sort((a, b) => b.humanCount() - a.humanCount());
  return free[0] || makeRoom('public') || pub.sort((a, b) => a.humanCount() - b.humanCount())[0] || null;
}
const cleanCode = (v) => String(v ?? '').trim().toUpperCase();
const ROOM_ERRORS = {
  unknown: (c) => `There's no room ${c}. You're in a public match instead.`,
  full: (c) => `Room ${c} is full. You're in a public match instead.`,
  busy: () => `The server is too busy for a new private room right now. You're in a public match instead.`,
};
// Where a join goes: { room, error } (error: a private room that couldn't be had; the player lands in a public room)
function roomFor(want) {
  const code = cleanCode(want);
  let reason = null;
  if (code === 'NEW') { const r = makeRoom('private'); if (r) return { room: r }; reason = 'busy'; }
  else if (code && code !== 'PUBLIC') {
    const r = rooms.get(code);
    if (!r || r.kind !== 'private') reason = 'unknown';
    else if (r.humanCount() >= 4) reason = 'full';
    else return { room: r };
  }
  const room = publicRoom();
  return { room, error: reason && { code: code === 'NEW' ? null : code, reason, text: ROOM_ERRORS[reason](code) } };
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

// ---------------------------------------------------------------- network
wss.on('connection', (ws) => {
  let id = null, room = null, watching = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    if (id === null) {
      if (msg.t === 'addBot' || msg.t === 'removeBots') {
        if (!watching) { watching = observerRoom(msg.room); watching?.observe(ws); }
        watching?.observerMessage(msg);
        return;
      }
      if (msg.t !== 'join') return;
      const pick = roomFor(msg.room);
      room = pick.room;
      if (!room) { ws.send(JSON.stringify({ t: 'notice', text: 'The server is full. Try again in a minute.' })); ws.close(4001, 'full'); return; }
      if (watching) { watching.unobserve(ws); watching = null; }
      if (pick.error) { ws.send(JSON.stringify({ t: 'roomError', ...pick.error })); console.log(`[room] ${pick.error.reason} '${pick.error.code}': to ${room.id}`); }
      id = room.join(ws, msg, pick.error ? { roomError: pick.error } : {});
      return;
    }
    room.message(id, msg);
  });

  ws.on('close', () => {
    watching?.unobserve(ws);
    if (id === null) return;
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

// loops: one tick for every room
let last = now();
setInterval(() => {
  const t = now();
  const dt = Math.min(0.1, t - last); last = t;
  for (const r of rooms.values()) r.simulate(dt);
}, 1000 / C.TICK_RATE);
setInterval(() => { for (const r of rooms.values()) r.snapshot(); }, 1000 / C.SNAPSHOT_RATE);
setInterval(cleanupRooms, 1000);

httpServer.listen(PORT, () => console.log(`Wizard Arena listening on http://localhost:${PORT}`));
