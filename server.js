// Wizard Arena — authoritative game server.
// Clients own their own movement (position/yaw) and send inputs for everything else.
// The server owns combat: spells, projectiles, health, stamina, stuns, props and respawns.

import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as C from './public/shared/constants.js';
import { createBot, updateBots, botKnockback, BOT_LIMIT } from './server/bots.js';
import * as Goats from './server/goats.js';
const { createGoats, updateGoats, angerGoat, goatPublic } = Goats;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.get('/healthz', (req, res) => res.type('text').send('ok'));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
// three.js is served from node_modules so the game has no CDN dependency.
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three'), { maxAge: '7d' }));
const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer });

// ---------------------------------------------------------------- helpers
const now = () => performance.now() / 1000;
const rand = (a, b) => a + Math.random() * (b - a);
const len3 = (v) => Math.hypot(v[0], v[1], v[2]);
const norm3 = (v) => { const l = len3(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dist2D = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

let nextId = 1;
const players = new Map();   // id -> player
const sockets = new Map();   // id -> ws
const projectiles = new Map();
const props = new Map();
const goats = createGoats();
let nextProjId = 1;

// ---------------------------------------------------------------- props
C.PROP_SPAWNS.forEach(([type, x, z], i) => {
  const id = i + 1;
  props.set(id, { id, type, x, z, state: 'idle', carrier: null, respawnAt: 0, liftUntil: 0 });
});

function propPublic(p) {
  return { id: p.id, type: p.type, x: p.x, z: p.z, state: p.state, carrier: p.carrier };
}
const isHeld = (prop) => prop.state === 'lifting' || prop.state === 'carried';

// ---------------------------------------------------------------- players
function newPlayer(id, name, loadout = C.DEFAULT_LOADOUT) {
  const sp = C.SPAWN_POINTS[(id - 1) % C.SPAWN_POINTS.length];
  return {
    id, name,
    color: C.PLAYER_COLORS[(id - 1) % C.PLAYER_COLORS.length],
    p: [sp[0], 0, sp[2]], yaw: 0, anim: 'idle',
    hp: C.MAX_HP, st: C.MAX_STAMINA,
    blocking: false, blockReleasedAt: -10,
    stunUntil: 0, stunImmuneUntil: 0, dead: false, respawnAt: 0,
    kills: 0, deaths: 0,
    cd: { fast: 0, power: 0, mobility: 0, throw: 0 },   // per slot, whichever spell is in it
    loadout: C.sanitizeLoadout(loadout), pendingLoadout: null,
    charging: false, chargeStart: 0,
    cyclone: null,                // { start, pulseAt, endAt, pulsed } during an Arcane Cyclone
    flightStart: 0, flightUntil: 0,   // Skyward Flash window: y may exceed 0 only inside it
    carrying: null,
    lastHitBy: null,
    lastStateAt: 0,
  };
}

function playerPublic(p) {
  return {
    id: p.id, name: p.name, color: p.color,
    p: p.p, yaw: p.yaw, anim: p.anim,
    hp: Math.round(p.hp), st: Math.round(p.st),
    blocking: p.blocking, charging: p.charging,
    stun: p.stunUntil > now(), dead: p.dead,
    carrying: p.carrying, kills: p.kills, deaths: p.deaths,
    loadout: p.loadout,
    bot: p.bot ? p.bot.difficulty : undefined,
  };
}

const isStunned = (p) => p.stunUntil > now();
const canAct = (p) => !p.dead && !isStunned(p);
const isAirborne = (p) => p.flightUntil > now();
const CYCLONE = C.SPELLBOOK.cyclone, SKY = C.SPELLBOOK.skyward;

// ---------------------------------------------------------------- loadouts
// A slot that's mid-cast keeps its spell until the cast ends; the change waits in pendingLoadout.
const slotBusy = (p, slot) => slot === 'power' ? p.charging || !!p.cyclone : slot === 'mobility' ? isAirborne(p) : false;
function setLoadout(p, want) {
  const next = C.sanitizeLoadout(want, { ...p.loadout, ...p.pendingLoadout });
  const now_ = {}, later = {};
  for (const slot of Object.keys(next)) (slotBusy(p, slot) ? later : now_)[slot] = next[slot];
  p.pendingLoadout = Object.keys(later).length ? later : null;
  applyLoadout(p, now_);
}
function applyLoadout(p, part) {
  const merged = { ...p.loadout, ...part };
  if (Object.keys(merged).every(k => merged[k] === p.loadout[k])) return;
  p.loadout = merged;
  broadcast({ t: 'loadout', id: p.id, loadout: p.loadout });
}
function flushPendingLoadout(p) {
  if (!p.pendingLoadout) return;
  const ready = {}, still = {};
  for (const [slot, id] of Object.entries(p.pendingLoadout)) (slotBusy(p, slot) ? still : ready)[slot] = id;
  p.pendingLoadout = Object.keys(still).length ? still : null;
  applyLoadout(p, ready);
}

function send(id, msg) {
  const ws = sockets.get(id);
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}
function broadcast(msg) {
  const s = JSON.stringify(msg);
  for (const ws of wss.clients) if (ws.readyState === 1) ws.send(s);
}

// ---------------------------------------------------------------- combat
function spawnProjectile(owner, kind, origin, dir, propType = null) {
  const spec = C.SPELLS[kind];
  const d = norm3(dir);
  const id = nextProjId++;
  const proj = {
    id, kind, owner: owner.id, propType,
    p: [origin[0], origin[1], origin[2]],
    v: [d[0] * spec.speed, d[1] * spec.speed, d[2] * spec.speed],
    g: spec.gravity || 0,
    radius: spec.radius,
    born: now(), life: spec.life,
  };
  projectiles.set(id, proj);
  broadcast({ t: 'proj', id, kind, owner: owner.id, propType, p: proj.p, v: proj.v, g: proj.g, r: proj.radius, life: proj.life });
  return proj;
}

function endProjectile(proj, hit, extra = {}) {
  projectiles.delete(proj.id);
  if (proj.propId) {
    // A thrown prop shatters wherever it lands.
    const prop = props.get(proj.propId);
    if (prop) breakProp(prop, proj.p.slice());
  }
  broadcast({ t: 'projEnd', id: proj.id, hit, p: proj.p, ...extra });
}

// `proj` is a projectile, or anything shaped like one: { kind, owner, v } where v is the direction
// the hit travels (the Arcane Cyclone passes its outward push).
function applyHit(target, proj) {
  const spec = C.hitSpec(proj.kind);
  const attacker = players.get(proj.owner);
  const t = now();

  // Is the target blocking and facing the incoming projectile?
  let blocked = false;
  if (target.blocking && target.st > 0) {
    const fx = Math.sin(target.yaw), fz = Math.cos(target.yaw);         // facing vector
    const ix = -proj.v[0], iz = -proj.v[2];                              // direction towards the shooter
    const il = Math.hypot(ix, iz) || 1;
    const cos = (fx * ix + fz * iz) / il;
    blocked = cos >= Math.cos((C.BLOCK_CONE_DEG / 2) * Math.PI / 180);
  }

  let dmg = spec.damage;
  if (blocked) {
    const cost = spec.staminaCost;
    if (target.st >= cost) {
      target.st -= cost;
      dmg = 0;
    } else {
      // Block breaks: leftover damage leaks through, blocker is staggered.
      dmg = Math.round(dmg * (1 - target.st / cost) * 0.6);
      target.st = 0;
      target.blocking = false;
      target.blockReleasedAt = t;
      target.stunUntil = Math.max(target.stunUntil, t + C.BLOCK_BREAK_STUN);
      broadcast({ t: 'blockBreak', id: target.id });
    }
  } else {
    // Sparks can't chain-stun: once a spark stun ends there's a short window where sparks only sting.
    if (proj.kind !== 'fast' || t >= target.stunImmuneUntil) {
      target.stunUntil = Math.max(target.stunUntil, t + spec.stun);
      if (proj.kind === 'fast') target.stunImmuneUntil = target.stunUntil + C.SPARK_STUN_IMMUNITY;
    }
    // Being hit cancels a heavy wind-up or a cyclone that hasn't spun yet.
    if (target.charging) { target.charging = false; broadcast({ t: 'chargeCancel', id: target.id }); }
    cancelCyclone(target);
  }

  target.hp -= dmg;
  if (dmg > 0) target.lastHitBy = proj.owner;
  if (target.bot) botKnockback(target, norm3([proj.v[0], 0, proj.v[2]]), blocked ? spec.knockback * 0.3 : spec.knockback);

  broadcast({
    t: 'hit', target: target.id, attacker: proj.owner, kind: proj.kind, dmg, blocked,
    kb: blocked ? spec.knockback * 0.3 : spec.knockback, dir: norm3([proj.v[0], 0, proj.v[2]]),
  });

  if (target.hp <= 0 && !target.dead) killPlayer(target, attacker);
  return { dmg, blocked };
}

function killPlayer(target, attacker, cause = null) {
  target.dead = true;
  target.hp = 0;
  target.charging = false;
  cancelCyclone(target);
  target.flightUntil = 0; target.p[1] = 0;
  target.blocking = false;
  target.deaths++;
  target.respawnAt = now() + C.RESPAWN_TIME;
  if (target.carrying) dropProp(target, true);
  if (attacker && attacker.id !== target.id) attacker.kills++;
  broadcast({ t: 'death', id: target.id, killer: attacker ? attacker.id : null, cause });
}

function respawn(p) {
  const sp = C.SPAWN_POINTS[Math.floor(Math.random() * C.SPAWN_POINTS.length)];
  p.p = [sp[0] + rand(-1, 1), 0, sp[2] + rand(-1, 1)];
  p.hp = C.MAX_HP; p.st = C.MAX_STAMINA;
  p.dead = false; p.stunUntil = 0; p.blocking = false; p.charging = false; p.cyclone = null; p.flightUntil = 0;
  broadcast({ t: 'respawn', id: p.id, p: p.p });
}

function dropProp(p, destroy) {
  const prop = props.get(p.carrying);
  p.carrying = null;
  if (!prop) return;
  prop.carrier = null;
  if (destroy) {
    breakProp(prop, [p.p[0], 1, p.p[2]]);
  } else {
    const hp = C.holdPoint(p.p, p.yaw);
    prop.state = 'idle';
    prop.x = clamp(hp[0], -C.ARENA_RADIUS, C.ARENA_RADIUS); prop.z = clamp(hp[2], -C.ARENA_RADIUS, C.ARENA_RADIUS);
    broadcast({ t: 'prop', prop: propPublic(prop) });
  }
}

// ---------------------------------------------------------------- Arcane Cyclone
function cancelCyclone(p) {
  if (!p.cyclone || p.cyclone.pulsed) return;
  p.cyclone = null;
  broadcast({ t: 'cycloneCancel', id: p.id });
}

// The single damage pulse at the start of the spin.
function cyclonePulse(p) {
  const t = now();
  p.cyclone.pulsed = true;
  p.cd.power = t + CYCLONE.cooldown;
  const hits = [];
  for (const q of players.values()) {
    if (q === p || q.dead) continue;
    const d = dist2D(q.p, p.p);
    if (d > CYCLONE.radius + C.PLAYER_RADIUS || Math.abs(q.p[1] - p.p[1]) > CYCLONE.height) continue;
    const out = d > 0.01 ? [(q.p[0] - p.p[0]) / d, 0, (q.p[2] - p.p[2]) / d] : [Math.sin(q.yaw), 0, Math.cos(q.yaw)];
    const { dmg, blocked } = applyHit(q, { kind: 'cyclone', owner: p.id, v: out });
    hits.push({ id: q.id, dmg, blocked });
  }
  if (p.p[1] < 1) {
    for (const prop of props.values()) {
      if (prop.state !== 'idle') continue;
      if (dist2D(p.p, [prop.x, 0, prop.z]) < CYCLONE.radius + C.PROP_TYPES[prop.type].r) breakProp(prop, [prop.x, C.PROP_TYPES[prop.type].h * 0.5, prop.z]);
    }
    for (const g of goats) {
      if (Math.hypot(g.x - p.p[0], g.z - p.p[2]) > CYCLONE.radius + C.GOAT.radius) continue;
      // A goat already rearing or charging gets spun dizzy; any other goat is now angry at the caster.
      if (!Goats.dizzyGoat?.(g, goatCtx)) angerGoat(g, p.id, goatCtx);
    }
  }
  broadcast({ t: 'cyclonePulse', id: p.id, p: p.p, hits });
}

function breakProp(prop, at) {
  prop.state = 'broken';
  prop.carrier = null;
  prop.respawnAt = now() + C.PROP_RESPAWN_TIME;
  broadcast({ t: 'propBreak', id: prop.id, p: at });
}

// ---------------------------------------------------------------- simulation
function simulate(dt) {
  const t = now();
  updateBots(dt, world);
  updateGoats(goats, dt, goatCtx);

  for (const p of players.values()) {
    if (p.dead) {
      if (t >= p.respawnAt) respawn(p);
      continue;
    }
    // stamina
    if (p.blocking) {
      p.st -= C.STAMINA_DRAIN_BLOCKING * dt;
      if (p.st <= 0) {
        p.st = 0; p.blocking = false; p.blockReleasedAt = t;
        p.stunUntil = Math.max(p.stunUntil, t + C.BLOCK_BREAK_STUN * 0.6);
        broadcast({ t: 'blockBreak', id: p.id });
      }
    } else if (t - p.blockReleasedAt > C.STAMINA_REGEN_DELAY) {
      p.st = Math.min(C.MAX_STAMINA, p.st + C.STAMINA_REGEN * dt);
    }
    // a stun interrupts charging
    if (p.charging && isStunned(p)) { p.charging = false; broadcast({ t: 'chargeCancel', id: p.id }); }
    if (p.cyclone) {
      if (!p.cyclone.pulsed && isStunned(p)) cancelCyclone(p);
      else if (!p.cyclone.pulsed && t >= p.cyclone.pulseAt) cyclonePulse(p);
      else if (t >= p.cyclone.endAt) p.cyclone = null;
    }
    // Skyward Flash: the flight ends when the wizard reports touching down, or when time runs out
    if (p.flightUntil && (t >= p.flightUntil || (p.p[1] <= 0.01 && t > p.flightStart + 0.3))) { p.flightUntil = 0; p.p[1] = 0; }
    flushPendingLoadout(p);
  }

  // projectiles
  for (const proj of [...projectiles.values()]) {
    const age = t - proj.born;
    if (age > proj.life) { endProjectile(proj, false); continue; }
    proj.v[1] -= proj.g * dt;
    proj.p[0] += proj.v[0] * dt; proj.p[1] += proj.v[1] * dt; proj.p[2] += proj.v[2] * dt;

    // ground / arena bounds
    if (proj.p[1] <= proj.radius * 0.5 || proj.p[1] > 40 || Math.hypot(proj.p[0], proj.p[2]) > C.ARENA_RADIUS + 6) {
      proj.p[1] = Math.max(proj.p[1], 0.05);
      endProjectile(proj, true, { surface: 'ground' });
      continue;
    }
    // pillars
    let done = false;
    for (const c of C.COLLIDERS) {
      if (proj.p[1] < c.h && Math.hypot(proj.p[0] - c.x, proj.p[2] - c.z) < c.r + proj.radius) {
        endProjectile(proj, true, { surface: c.kind }); done = true; break;
      }
    }
    if (done) continue;

    // a prop held by telekinesis shields its holder (it takes the hit and shatters)
    for (const pl of players.values()) {
      if (pl.dead || !pl.carrying || pl.id === proj.owner) continue;
      const prop = props.get(pl.carrying);
      if (!prop || prop.state !== 'carried') continue;
      const hp = C.holdPoint(pl.p, pl.yaw);
      if (Math.hypot(proj.p[0] - hp[0], proj.p[1] - hp[1], proj.p[2] - hp[2]) < C.PROP_TYPES[prop.type].r + proj.radius) {
        pl.carrying = null;
        breakProp(prop, hp);
        endProjectile(proj, true, { surface: 'prop' });
        done = true; break;
      }
    }
    if (done) continue;

    // players
    for (const pl of players.values()) {
      if (pl.dead || pl.id === proj.owner) continue;
      const c = [pl.p[0], pl.p[1] + C.HIT_CENTER_Y, pl.p[2]];
      const d = Math.hypot(proj.p[0] - c[0], proj.p[1] - c[1], proj.p[2] - c[2]);
      if (d < C.HIT_RADIUS + proj.radius) {
        applyHit(pl, proj);
        endProjectile(proj, true, { surface: 'player', target: pl.id });
        done = true; break;
      }
    }
    if (done) continue;

    // goats: no damage, but now it's angry at whoever cast or threw this
    for (const g of goats) {
      if (Math.hypot(proj.p[0] - g.x, proj.p[1] - C.GOAT.hitY, proj.p[2] - g.z) < C.GOAT.radius + proj.radius) {
        angerGoat(g, proj.owner, goatCtx);
        endProjectile(proj, true, { surface: 'goat', goat: g.id });
        done = true; break;
      }
    }
    if (done) continue;

    // props (standing ones get destroyed)
    for (const prop of props.values()) {
      if (prop.state !== 'idle') continue;
      const pt = C.PROP_TYPES[prop.type];
      const d = Math.hypot(proj.p[0] - prop.x, proj.p[1] - pt.h * 0.5, proj.p[2] - prop.z);
      if (d < pt.r + proj.radius) {
        breakProp(prop, [prop.x, pt.h * 0.5, prop.z]);
        endProjectile(proj, true, { surface: 'prop' });
        done = true; break;
      }
    }
  }

  // prop respawns / lifts finishing
  for (const prop of props.values()) {
    if (prop.state === 'lifting' && t >= prop.liftUntil) {
      prop.state = 'carried';
      broadcast({ t: 'prop', prop: propPublic(prop) });
    }
    if (prop.state === 'broken' && t >= prop.respawnAt) {
      const occupied = [...players.values()].some(pl => !pl.dead && dist2D(pl.p, [prop.x, 0, prop.z]) < 1.5);
      if (occupied) { prop.respawnAt = t + 2; continue; }
      prop.state = 'idle';
      broadcast({ t: 'prop', prop: propPublic(prop) });
    }
  }
}

// ---------------------------------------------------------------- messages
function handle(p, msg) {
  const t = now();
  switch (msg.t) {
    case 'state': {
      if (p.dead) break;
      if (!Array.isArray(msg.p) || msg.p.length !== 3 || !msg.p.every(Number.isFinite)) break;
      // loose anti-cheat: clamp to arena and to a plausible speed
      const dt = Math.max(0.016, t - (p.lastStateAt || t));
      // Feet stay on the ground except inside a Skyward Flash, where the height may only fall
      // (never faster than a drop, never slower than the slowest hover).
      let y = 0;
      if (isAirborne(p)) {
        const e = t - p.flightStart;
        const ceil = clamp(SKY.height + 0.5 - Math.max(0, e - 0.3) * SKY.slowFallSpeed * 0.9, 0, SKY.maxHeight);
        const floor = clamp(p.p[1] - (SKY.dropSpeed * dt * 1.5 + 0.4), 0, ceil);
        y = clamp(msg.p[1], floor, ceil);
      }
      const np = [clamp(msg.p[0], -C.ARENA_RADIUS, C.ARENA_RADIUS), y, clamp(msg.p[2], -C.ARENA_RADIUS, C.ARENA_RADIUS)];
      const maxStep = (C.MOVE_SPEED + C.SPELLS.heavy.knockback + 2) * dt + 0.6;
      const d = dist2D(np, p.p);
      if (p.lastStateAt && d > maxStep && !p.justTeleported) {
        // Moving faster than any legitimate wizard can: let the server's copy catch up at the
        // maximum plausible speed instead of snapping (so a laggy-but-honest client converges).
        const k = maxStep / d;
        p.p = [p.p[0] + (np[0] - p.p[0]) * k, np[1], p.p[2] + (np[2] - p.p[2]) * k];
      } else {
        p.p = np;
      }
      p.justTeleported = false;
      p.lastStateAt = t;
      if (Number.isFinite(msg.yaw)) p.yaw = msg.yaw;
      if (typeof msg.anim === 'string' && msg.anim.length < 16) p.anim = msg.anim;
      break;
    }
    case 'block': {
      const on = !!msg.on;
      if (on && (!canAct(p) || p.st <= 2 || p.charging || p.cyclone || isAirborne(p))) break;
      if (p.blocking && !on) p.blockReleasedAt = t;
      p.blocking = on;
      break;
    }
    case 'cast': {
      if (!canAct(p) || p.blocking || p.charging || p.cyclone || p.carrying) break;
      if (msg.kind !== 'fast') break;
      if (t < p.cd.fast) break;
      p.cd.fast = t + C.SPELLS.fast.cooldown;
      const origin = sanitizeOrigin(p, msg.origin);
      spawnProjectile(p, 'fast', origin, sanitizeDir(msg.dir, p));
      break;
    }
    case 'chargeStart': {
      if (p.loadout.power !== 'meteor') break;
      if (!canAct(p) || p.blocking || p.charging || p.cyclone || p.carrying || isAirborne(p)) break;
      if (t < p.cd.power) break;
      p.charging = true; p.chargeStart = t;
      broadcast({ t: 'chargeStart', id: p.id });
      break;
    }
    case 'chargeRelease': {
      if (!p.charging) break;
      p.charging = false;
      if (!canAct(p)) { broadcast({ t: 'chargeCancel', id: p.id }); break; }
      if (t - p.chargeStart < C.SPELLS.heavy.chargeTime - 0.05) {
        broadcast({ t: 'chargeCancel', id: p.id });
        break;
      }
      p.cd.power = t + C.SPELLS.heavy.cooldown;
      const origin = sanitizeOrigin(p, msg.origin);
      spawnProjectile(p, 'heavy', origin, sanitizeDir(msg.dir, p));
      break;
    }
    case 'cyclone': {
      const ok = p.loadout.power === 'cyclone' && canAct(p) && !p.blocking && !p.charging && !p.cyclone
        && !p.carrying && !isAirborne(p) && t >= p.cd.power;
      // tell a refused caster, so its client drops the wind-up it predicted
      if (!ok) { if (!p.cyclone) send(p.id, { t: 'cycloneCancel', id: p.id }); break; }
      p.cyclone = { start: t, pulseAt: t + CYCLONE.windup, endAt: t + CYCLONE.windup + CYCLONE.spin, pulsed: false };
      broadcast({ t: 'cycloneStart', id: p.id, p: p.p });
      break;
    }
    case 'skyward': {
      // tell a refused flier, so its client comes back down from the flight it predicted
      if (p.loadout.mobility !== 'skyward' || !canAct(p) || p.charging || p.cyclone || isAirborne(p) || t < p.cd.mobility) {
        if (!isAirborne(p)) send(p.id, { t: 'skywardCancel', id: p.id });
        break;
      }
      p.cd.mobility = t + SKY.cooldown;
      p.flightStart = t; p.flightUntil = t + C.FLIGHT_MAX_TIME;
      p.p = [p.p[0], SKY.height, p.p[2]];
      if (p.blocking) { p.blocking = false; p.blockReleasedAt = t; }
      broadcast({ t: 'skyward', id: p.id, p: [p.p[0], 0, p.p[2]], top: SKY.height });
      break;
    }
    case 'loadout': {
      setLoadout(p, msg);
      break;
    }
    case 'teleport': {
      if (p.loadout.mobility !== 'blink') break;
      if (!canAct(p) || p.charging || p.cyclone) break;
      if (t < p.cd.mobility) break;
      const dir = sanitizeDir([msg.dir?.[0] ?? 0, 0, msg.dir?.[2] ?? 1], p);
      // The client predicts the same landing spot, so its next position report lines up.
      const from = Array.isArray(msg.from) && msg.from.length === 3 && msg.from.every(Number.isFinite) && dist2D(msg.from, p.p) < 3 ? msg.from : p.p;
      const to = C.computeTeleport(from, dir);
      p.cd.mobility = t + C.TELEPORT.cooldown;
      p.p = to; p.justTeleported = true;
      if (p.blocking) { p.blocking = false; p.blockReleasedAt = t; }
      broadcast({ t: 'tp', id: p.id, from, to });
      break;
    }
    case 'pickup': {
      if (!canAct(p) || p.carrying || p.charging || p.cyclone || p.blocking) break;
      const best = tkTarget(p, msg.aimOrigin, msg.aimDir);
      if (!best) break;
      best.state = 'lifting'; best.carrier = p.id; best.liftUntil = t + C.TK.liftTime;
      p.carrying = best.id;
      broadcast({ t: 'prop', prop: propPublic(best) });
      break;
    }
    case 'throw': {
      if (!canAct(p) || !p.carrying) break;
      if (t < p.cd.throw) break;
      const prop = props.get(p.carrying);
      if (prop && prop.state !== 'carried') break;   // still rising
      p.carrying = null;
      p.cd.throw = t + C.THROW_COOLDOWN;
      if (!prop) break;
      // The prop leaves the world as a standing object and becomes a projectile.
      prop.state = 'thrown'; prop.carrier = null;
      broadcast({ t: 'prop', prop: propPublic(prop) });
      const origin = C.holdPoint(p.p, p.yaw);
      const target = validVec(msg.target) && dist2D(msg.target, p.p) < 80 ? msg.target : null;
      const dir = target ? C.ballisticDir(origin, target, C.SPELLS.prop.speed, C.SPELLS.prop.gravity) : sanitizeDir(msg.dir, p);
      const proj = spawnProjectile(p, 'prop', origin, dir, prop.type);
      proj.propId = prop.id;
      break;
    }
    case 'drop': {
      if (!p.carrying) break;
      if (props.get(p.carrying)?.state === 'lifting') break;
      dropProp(p, false);
      break;
    }
    case 'addBot': {
      if (p.bot) break;
      const n = [...players.values()].filter(q => q.bot).length;
      if (n >= BOT_LIMIT) break;
      addBot(['easy', 'normal', 'hard'].includes(msg.difficulty) ? msg.difficulty : 'normal', msg.loadout);
      break;
    }
    case 'removeBots': {
      if (p.bot) break;
      for (const q of [...players.values()]) if (q.bot) removePlayer(q.id);
      break;
    }
  }
}

// ---------------------------------------------------------------- bots
// Bots are ordinary players without a socket. Their AI (server/bots.js) acts through handle(),
// so they obey exactly the same rules and cooldowns as everyone else.
const BOT_NAMES = ['Zaltar', 'Morgra', 'Ebonyx', 'Vexlith', 'Grimble', 'Oswin', 'Thistle', 'Pipsqueak', 'Quillon', 'Sorrow'];
// `loadout` (optional) pins some of its spells; anything missing or unknown is rolled at random.
function addBot(difficulty, loadout = null) {
  const id = nextId++;
  const taken = new Set([...players.values()].map(q => q.name));
  const name = BOT_NAMES.find(n => !taken.has(n)) || `Bot${id}`;
  const p = newPlayer(id, name);
  const sp = C.SPAWN_POINTS[Math.floor(Math.random() * C.SPAWN_POINTS.length)];
  p.p = [sp[0], 0, sp[2]];
  p.bot = createBot(difficulty);
  p.loadout = C.sanitizeLoadout(loadout, C.sanitizeLoadout(p.bot.loadout));
  players.set(id, p);
  broadcast({ t: 'joined', player: playerPublic(p) });
  console.log(`[+] bot ${name} (${difficulty}, ${p.loadout.power}/${p.loadout.mobility}) joined. ${players.size} online`);
}

function removePlayer(id) {
  const p = players.get(id);
  if (!p) return;
  if (p.carrying) dropProp(p, false);
  players.delete(id); sockets.delete(id);
  broadcast({ t: 'leave', id });
}

// cycloneStopsGoats: the goat module can knock a charging goat dizzy (bots then answer a charge with a cyclone)
const world = { players, props, projectiles, goats, handle, now, cycloneStopsGoats: !!Goats.dizzyGoat };
const goatCtx = {
  players, props, now, broadcast, breakProp, killPlayer,
  // humans apply goat knockback themselves from the goatRam message
  knockback: (p, dir, kb) => { if (p.bot) botKnockback(p, dir, kb); },
};

const validVec = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

// The idle prop a telekinesis cast grabs: the one closest to the aim ray within range and cone,
// else anything at point-blank range. Pillars block the line of sight.
function tkTarget(p, aimOrigin, aimDir) {
  const chest = [p.p[0], p.p[1] + 1.3, p.p[2]];
  const o = validVec(aimOrigin) && dist2D(aimOrigin, p.p) < 6 ? aimOrigin : chest;
  const dir = validVec(aimDir) && len3(aimDir) > 0.01 ? norm3(aimDir) : [Math.sin(p.yaw), 0, Math.cos(p.yaw)];
  const cone = C.TK.aimConeDeg * Math.PI / 180;
  let best = null, bestScore = -Infinity, near = null, nd = C.PICKUP_RANGE;
  for (const prop of props.values()) {
    if (prop.state !== 'idle') continue;
    const d2 = dist2D(p.p, [prop.x, 0, prop.z]);
    if (d2 < nd) { nd = d2; near = prop; }
    if (d2 > C.TK.range) continue;
    const c = [prop.x, C.PROP_TYPES[prop.type].h * 0.5, prop.z];
    const v = [c[0] - o[0], c[1] - o[1], c[2] - o[2]];
    const l = len3(v) || 1;
    const cos = (v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2]) / l;
    // the cone widens by the prop's apparent size, so big or close props are easier to catch
    if (Math.acos(clamp(cos, -1, 1)) - Math.atan2(C.PROP_TYPES[prop.type].r, l) > cone) continue;
    if (C.pillarBlocks(p.p, [prop.x, 0, prop.z], 0.1)) continue;
    const score = cos - l * 0.002;
    if (score > bestScore) { bestScore = score; best = prop; }
  }
  return best || near;
}

function sanitizeDir(d, p) {
  if (Array.isArray(d) && d.length === 3 && d.every(Number.isFinite) && len3(d) > 0.01) return norm3(d);
  return [Math.sin(p.yaw), 0, Math.cos(p.yaw)];
}
function sanitizeOrigin(p, o) {
  if (Array.isArray(o) && o.length === 3 && o.every(Number.isFinite) && dist2D(o, p.p) < 2.5 && o[1] > p.p[1] - 1 && o[1] < p.p[1] + 3) return o;
  return [p.p[0], p.p[1] + 1.3, p.p[2]];
}

// ---------------------------------------------------------------- network
wss.on('connection', (ws) => {
  let id = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    if (id === null) {
      // `node bot.js` manages bots without entering the arena itself
      if (msg.t === 'addBot' || msg.t === 'removeBots') { handle({ bot: null }, msg); return; }
      if (msg.t !== 'join') return;
      id = nextId++;
      const name = String(msg.name || 'Wizard').replace(/[^\w \-'!?.]/g, '').trim().slice(0, C.MAX_NAME_LEN) || `Wizard${id}`;
      const p = newPlayer(id, name, msg.loadout);
      players.set(id, p);
      sockets.set(id, ws);
      ws.send(JSON.stringify({
        t: 'welcome', id,
        players: [...players.values()].map(playerPublic),
        props: [...props.values()].map(propPublic),
        goats: goats.map(goatPublic),
        projectiles: [...projectiles.values()].map(pr => ({ id: pr.id, kind: pr.kind, owner: pr.owner, propType: pr.propType, p: pr.p, v: pr.v, g: pr.g, r: pr.radius, life: pr.life - (now() - pr.born) })),
      }));
      broadcast({ t: 'joined', player: playerPublic(p) });
      console.log(`[+] ${name} (#${id}) joined. ${players.size} online`);
      return;
    }
    const p = players.get(id);
    if (p) handle(p, msg);
  });

  ws.on('close', () => {
    if (id === null) return;
    removePlayer(id);
    // Nobody left to practise against the bots: clear them out.
    if (![...players.values()].some(q => !q.bot)) for (const q of [...players.values()]) removePlayer(q.id);
    console.log(`[-] #${id} left. ${players.size} online`);
  });
});

// heartbeat
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 15000);

// loops
let last = now();
setInterval(() => {
  const t = now();
  const dt = Math.min(0.1, t - last); last = t;
  simulate(dt);
}, 1000 / C.TICK_RATE);

setInterval(() => {
  if (players.size === 0) return;
  broadcast({ t: 'snap', time: now(), players: [...players.values()].map(playerPublic), goats: goats.map(goatPublic) });
}, 1000 / C.SNAPSHOT_RATE);

httpServer.listen(PORT, () => console.log(`Wizard Arena listening on http://localhost:${PORT}`));
