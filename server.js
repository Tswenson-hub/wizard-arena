// Wizard Arena — authoritative game server.
// Clients own their own movement (position/yaw) and send inputs for everything else.
// The server owns combat: spells, projectiles, health, stamina, stuns, props and respawns.

import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as C from './public/shared/constants.js';
import { createBot, updateBots, botKnockback, botNoteRelic, botDash, BOT_LIMIT } from './server/bots.js';
import * as Goats from './server/goats.js';
const { createGoats, updateGoats, angerGoat, goatPublic } = Goats;
// Throwable goats (goats.js, environment): called defensively so either side can land first
const goatTK = typeof Goats.liftGoat === 'function' && typeof Goats.throwGoat === 'function';
const goatById = (id) => goats.find(g => g.id === id);

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
const decoys = new Map();    // Mirror Step decoys: id -> { id, owner, p, dir, yaw, until }
const walls = new Map();     // Glacial Bulwark walls: id -> { id, owner, x, z, yaw, hp, until }
const frostfalls = new Map(); // Frostfall ice on its way down: id -> { id, owner, x, z, at }
const smokes = new Map();     // Smoke Screen clouds: id -> { id, owner, x, z, until }
let nextFxId = 1;            // ids for decoys and walls

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
function newPlayer(id, name, wizard = C.DEFAULT_WIZARD) {
  const sp = C.SPAWN_POINTS[(id - 1) % C.SPAWN_POINTS.length];
  if (!C.isWizard(wizard)) wizard = C.DEFAULT_WIZARD;
  return {
    id, name,
    wizard, pendingWizard: null,   // a switch waits here while a cast is in progress (or until respawn)
    color: C.WIZARDS[wizard].color,
    p: [sp[0], 0, sp[2]], yaw: 0, anim: 'idle',
    hp: C.MAX_HP, st: C.MAX_STAMINA,
    blocking: false, blockReleasedAt: -10,
    stunUntil: 0, stunImmuneUntil: 0, dead: false, respawnAt: 0,
    kills: 0, deaths: 0,
    cd: { fast: 0, power: 0, mobility: 0, guard: 0, throw: 0, lift: 0 },   // per slot, whichever spell is in it
    charging: false, chargeStart: 0,
    cyclone: null,                // { start, pulseAt, endAt, pulsed } during an Arcane Cyclone
    lash: null,                   // { start } during a Sanguine Lash wind-up
    slowUntil: 0,                 // Glacial Skim slow
    rootUntil: 0, silenceUntil: 0,   // Sanguine Lash bind (both), or a missed lash's recovery (root only)
    frozenUntil: 0,               // Frostfall: the bind above, shown as ice
    ammo: 3, reloadUntil: 0, lastShotAt: 0,   // primary magazine (constants: primaryMag)
    veilUntil: 0,                 // Tempest Veil: every hit is absorbed until then
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
    carrying: p.carrying, carryingGoat: p.carryingGoat || null, kills: p.kills, deaths: p.deaths,
    wizard: p.wizard, lashing: !!p.lash,
    veil: p.veilUntil > now(), liftCd: p.cd.lift > now() ? +(p.cd.lift - now()).toFixed(2) : 0,
    ammo: p.ammo, reload: p.reloadUntil > now() ? +(p.reloadUntil - now()).toFixed(2) : 0,
    slow: p.slowUntil > now(), bound: p.silenceUntil > now(), rooted: p.rootUntil > now(), frozen: p.frozenUntil > now(),
    bot: p.bot ? p.bot.difficulty : undefined,
  };
}

const isStunned = (p) => p.stunUntil > now();
const isBound = (p) => p.silenceUntil > now();     // no spells, ward or telekinesis
const isRooted = (p) => p.rootUntil > now();       // no movement, knockback included
const canAct = (p) => !p.dead && !isStunned(p) && !isBound(p);
const isAirborne = (p) => p.flightUntil > now();
const kit = (p) => C.kitOf(p.wizard);
const CYCLONE = C.SPELLBOOK.cyclone, SKY = C.SPELLBOOK.skyward, LASH = C.SPELLBOOK.sanguine_lash;
const MIRROR = C.SPELLBOOK.mirror_step, BULWARK = C.SPELLBOOK.glacial_bulwark, RELIC = C.SPELLBOOK.trapped_relic;
const SKIM = C.SPELLBOOK.glacial_skim, FROST = C.SPELLBOOK.frostfall, SMOKE = C.SPELLBOOK.smoke_screen, VEIL = C.SPELLBOOK.tempest_veil;
const isVeiled = (p) => p.veilUntil > now();
const holding = (p) => !!(p.carrying || p.carryingGoat);   // a prop or a goat floats beside us

// ---------------------------------------------------------------- wizard choice
// A switch applies at once if the player is alive and not mid-cast, else when the cast ends or at respawn.
const midCast = (p) => p.charging || !!p.cyclone || !!p.lash || isAirborne(p);
function requestWizard(p, id) {
  if (!C.isWizard(id)) return;
  p.pendingWizard = id === p.wizard ? null : id;
  flushPendingWizard(p);
}
function flushPendingWizard(p) {
  if (!p.pendingWizard || p.dead || midCast(p)) return;
  applyWizard(p, p.pendingWizard);
}
function applyWizard(p, id) {
  p.pendingWizard = null;
  if (id === p.wizard) return;
  p.wizard = id;
  p.color = C.WIZARDS[id].color;
  if (p.blocking && kit(p).guard !== 'ward') { p.blocking = false; p.blockReleasedAt = now(); }
  if (kit(p).utility !== 'trapped_relic') clearCurse(p);
  broadcast({ t: 'wizard', id: p.id, wizard: id, color: p.color });
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
function spawnProjectile(owner, kind, origin, dir, propType = null, fin = false) {
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
  if (kind === 'lash') { proj.pierce = true; proj.hitIds = new Set(); proj.landed = 0; }
  if (fin) proj.fin = true;
  projectiles.set(id, proj);
  broadcast({ t: 'proj', id, kind, owner: owner.id, propType, p: proj.p, v: proj.v, g: proj.g, r: proj.radius, life: proj.life, ...(fin ? { fin: true } : {}) });
  return proj;
}

function endProjectile(proj, hit, extra = {}) {
  projectiles.delete(proj.id);
  // A lash that bound nobody leaves its caster rooted in recovery.
  if (proj.kind === 'lash' && !proj.landed) {
    const caster = players.get(proj.owner);
    if (caster && !caster.dead) {
      caster.rootUntil = Math.max(caster.rootUntil, now() + LASH.missRoot);
      broadcast({ t: 'lashMiss', id: caster.id, root: LASH.missRoot });
    }
  }
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
  // primary fire only interrupts (stun, cancel) with the last shot of a magazine
  const interrupt = (proj.kind !== 'fast' && proj.kind !== 'skim') || !!proj.fin;
  const t = now();

  // Tempest Veil: swallowed whole, from any side. No damage, stun, slow, bind or knockback, and the
  // target's own cast carries on (that's the point: Gale dives in and spins).
  if (isVeiled(target)) {
    broadcast({ t: 'hit', target: target.id, attacker: proj.owner, kind: proj.kind, dmg: 0, blocked: true, veil: true, kb: 0, dir: norm3([proj.v[0], 0, proj.v[2]]), int: false });
    return { dmg: 0, blocked: true };
  }

  // Is the target blocking and facing the incoming projectile?
  let blocked = false;
  if (target.blocking && target.st > 0 && !spec.unblockable) {
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
  } else if (interrupt) {
    // Sparks can't chain-stun: once a spark stun ends there's a short window where sparks only sting.
    if (proj.kind !== 'fast' || t >= target.stunImmuneUntil) {
      target.stunUntil = Math.max(target.stunUntil, t + spec.stun);
      if (proj.kind === 'fast') target.stunImmuneUntil = target.stunUntil + C.SPARK_STUN_IMMUNITY;
    }
    // Being hit cancels a heavy wind-up, a lash wind-up, a cyclone that hasn't spun yet, and a lift
    if (target.charging) { target.charging = false; broadcast({ t: 'chargeCancel', id: target.id }); }
    cancelCyclone(target);
    cancelLash(target);
    const lifting = target.carrying && props.get(target.carrying);
    if (lifting && lifting.state === 'lifting') { target.carrying = null; lifting.state = 'idle'; lifting.carrier = null; lifting.trap = null; broadcast({ t: 'prop', prop: propPublic(lifting) }); }
  }
  if (!blocked) {
    // Glacial Skim slows (refreshed, never stacked); Sanguine Lash binds: rooted and silenced.
    if (spec.slow) target.slowUntil = t + spec.slowTime;
    if (spec.bind) {
      target.rootUntil = Math.max(target.rootUntil, t + spec.bind);
      target.silenceUntil = Math.max(target.silenceUntil, t + spec.bind);
      if (target.blocking) { target.blocking = false; target.blockReleasedAt = t; }
      if (proj.kind === 'frostfall') target.frozenUntil = t + spec.bind;
    }
  }

  target.hp -= dmg;
  if (dmg > 0) target.lastHitBy = proj.owner;
  const kb = isRooted(target) ? 0 : blocked ? spec.knockback * 0.3 : spec.knockback;
  if (target.bot && kb) botKnockback(target, norm3([proj.v[0], 0, proj.v[2]]), kb);

  broadcast({
    t: 'hit', target: target.id, attacker: proj.owner, kind: proj.kind, dmg, blocked,
    kb, dir: norm3([proj.v[0], 0, proj.v[2]]), int: interrupt,
    ...(!blocked && spec.slow ? { slow: spec.slowTime } : {}),
    ...(!blocked && spec.bind ? { bind: spec.bind } : {}),
  });

  if (target.hp <= 0 && !target.dead) killPlayer(target, attacker, proj.kind === 'goat' ? 'goated' : null);
  return { dmg, blocked };
}

function killPlayer(target, attacker, cause = null) {
  target.dead = true;
  target.hp = 0;
  target.charging = false;
  cancelCyclone(target);
  cancelLash(target);
  target.slowUntil = target.rootUntil = target.silenceUntil = target.frozenUntil = 0;
  if (target.veilUntil) { target.veilUntil = 0; broadcast({ t: 'veilEnd', id: target.id }); }
  for (const d of [...decoys.values()]) if (d.owner === target.id) endDecoy(d, false);
  target.flightUntil = 0; target.p[1] = 0;
  target.blocking = false;
  target.deaths++;
  target.respawnAt = now() + C.RESPAWN_TIME;
  if (target.carrying) dropProp(target, true);
  if (target.carryingGoat) { const g = goatById(target.carryingGoat); target.carryingGoat = null; if (g && g.holder === target.id) Goats.releaseGoat?.(g, goatCtx); }
  if (attacker && attacker.id !== target.id) attacker.kills++;
  broadcast({ t: 'death', id: target.id, killer: attacker ? attacker.id : null, cause });
}

function respawn(p) {
  const sp = C.SPAWN_POINTS[Math.floor(Math.random() * C.SPAWN_POINTS.length)];
  p.p = [sp[0] + rand(-1, 1), 0, sp[2] + rand(-1, 1)];
  p.hp = C.MAX_HP; p.st = C.MAX_STAMINA;
  p.dead = false; p.stunUntil = 0; p.blocking = false; p.charging = false; p.cyclone = null; p.lash = null; p.flightUntil = 0;
  p.slowUntil = p.rootUntil = p.silenceUntil = p.frozenUntil = 0;
  p.ammo = 3; p.reloadUntil = 0;
  if (p.pendingWizard) applyWizard(p, p.pendingWizard);
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
  const wallsHit = new Set();
  for (const q of players.values()) {
    if (q === p || q.dead) continue;
    const d = dist2D(q.p, p.p);
    if (d > CYCLONE.radius + C.PLAYER_RADIUS || Math.abs(q.p[1] - p.p[1]) > CYCLONE.height) continue;
    const wall = wallBetween(p.p, q.p);
    if (wall) { wallsHit.add(wall); continue; }
    const out = d > 0.01 ? [(q.p[0] - p.p[0]) / d, 0, (q.p[2] - p.p[2]) / d] : [Math.sin(q.yaw), 0, Math.cos(q.yaw)];
    const { dmg, blocked } = applyHit(q, { kind: 'cyclone', owner: p.id, v: out });
    hits.push({ id: q.id, dmg, blocked });
  }
  for (const id of wallsHit) damageWall(id, CYCLONE.damage);
  for (const d of [...decoys.values()]) if (d.owner !== p.id && dist2D(d.p, p.p) < CYCLONE.radius + C.PLAYER_RADIUS && p.p[1] < CYCLONE.height) endDecoy(d, true);
  if (p.p[1] < 1) {
    for (const prop of props.values()) {
      if (prop.state !== 'idle') continue;
      if (dist2D(p.p, [prop.x, 0, prop.z]) < CYCLONE.radius + C.PROP_TYPES[prop.type].r) breakProp(prop, [prop.x, C.PROP_TYPES[prop.type].h * 0.5, prop.z]);
    }
    for (const g of goats) {
      if (g.holder === p.id || Math.hypot(g.x - p.p[0], g.z - p.p[2]) > CYCLONE.radius + C.GOAT.radius) continue;
      // A goat already rearing or charging gets spun dizzy; any other goat is now angry at the caster.
      if (!Goats.dizzyGoat?.(g, goatCtx)) angerGoat(g, p.id, goatCtx);
    }
  }
  broadcast({ t: 'cyclonePulse', id: p.id, p: p.p, hits });
}

function breakProp(prop, at) {
  if (prop.cursedBy) { const c = players.get(prop.cursedBy); prop.cursedBy = null; if (c) send(c.id, { t: 'curse', id: null }); }
  prop.trap = null;
  prop.state = 'broken';
  prop.carrier = null;
  prop.respawnAt = now() + C.PROP_RESPAWN_TIME;
  broadcast({ t: 'propBreak', id: prop.id, p: at });
}

// ---------------------------------------------------------------- Sanguine Lash
function cancelLash(p) {
  if (!p.lash) return;
  p.lash = null;
  broadcast({ t: 'lashCancel', id: p.id });
}

// ---------------------------------------------------------------- Mirror Step decoys
// Decoys run straight along their path at run speed. To everyone else they are the caster.
const decoyPublic = (d) => ({ id: d.id, owner: d.owner, p: d.p, yaw: d.yaw });
function endDecoy(d, popped) {
  decoys.delete(d.id);
  broadcast({ t: 'decoyEnd', id: d.id, popped, p: d.p });
}
function updateDecoys(dt, t) {
  for (const d of [...decoys.values()]) {
    if (t >= d.until) { endDecoy(d, false); continue; }
    const sp = C.speedOf(players.get(d.owner)?.wizard);   // as fast as the caster runs
    d.p[0] += d.dir[0] * sp * dt; d.p[2] += d.dir[2] * sp * dt;
    for (const c of C.COLLIDERS) {
      const dx = d.p[0] - c.x, dz = d.p[2] - c.z, dd = Math.hypot(dx, dz);
      if (dd < c.r + C.PLAYER_RADIUS && dd > 1e-4) { const k = (c.r + C.PLAYER_RADIUS - dd) / dd; d.p[0] += dx * k; d.p[2] += dz * k; }
    }
    const r = Math.hypot(d.p[0], d.p[2]);
    if (r > C.ARENA_RADIUS) { d.p[0] *= C.ARENA_RADIUS / r; d.p[2] *= C.ARENA_RADIUS / r; }
    // a charging goat runs it down
    if (goats.some(g => g.state === 'charge' && Math.hypot(g.x - d.p[0], g.z - d.p[2]) < C.GOAT.radius + C.PLAYER_RADIUS + 0.25)) endDecoy(d, true);
  }
}
// The decoy (not owned by `ownerId`) a sphere at `pos` with radius `r` touches, if any.
function decoyAt(pos, r, ownerId) {
  for (const d of decoys.values()) {
    if (d.owner === ownerId) continue;
    if (Math.hypot(pos[0] - d.p[0], pos[1] - C.HIT_CENTER_Y, pos[2] - d.p[2]) < C.HIT_RADIUS + r) return d;
  }
  return null;
}

// ---------------------------------------------------------------- Glacial Bulwark walls
function wallPublic(w) { return { id: w.id, owner: w.owner, x: w.x, z: w.z, yaw: w.yaw, hp: w.hp }; }
function raiseWall(p, yaw) {
  const [x, z] = C.bulwarkCentre(p.p, yaw);
  const w = { id: nextFxId++, owner: p.id, x, z, yaw, hp: BULWARK.hp, until: now() + BULWARK.life };
  walls.set(w.id, w);
  C.addWallColliders(w.id, x, z, yaw);
  broadcast({ t: 'wallUp', wall: wallPublic(w) });
}
function wallDown(w, broken) {
  walls.delete(w.id);
  C.removeWallColliders(w.id);
  broadcast({ t: 'wallDown', id: w.id, broken });
}
function damageWall(id, dmg) {
  const w = walls.get(id);
  if (!w || !(dmg > 0)) return;
  w.hp -= dmg;
  if (w.hp <= 0) wallDown(w, true);
  else broadcast({ t: 'wallHit', id, hp: w.hp });
}
// Id of a standing wall that the 2D segment a→b crosses, or null.
function wallBetween(a, b) {
  const sx = b[0] - a[0], sz = b[2] - a[2], ll = sx * sx + sz * sz || 1;
  for (const c of C.COLLIDERS) {
    if (c.kind !== 'bulwark') continue;
    const k = clamp(((c.x - a[0]) * sx + (c.z - a[2]) * sz) / ll, 0, 1);
    if (Math.hypot(a[0] + sx * k - c.x, a[2] + sz * k - c.z) < c.r) return c.wall;
  }
  return null;
}

// ---------------------------------------------------------------- Frostfall
const smokePublic = (c) => ({ id: c.id, owner: c.owner, p: [c.x, 0, c.z], left: Math.max(0, c.until - now()) });
const frostPublic = (f) => ({ id: f.id, owner: f.owner, p: [f.x, 0, f.z], left: Math.max(0, f.at - now()) });
// The ice lands: everyone in the circle on (or near) the ground is crushed and frozen. Wards and walls
// don't help: it comes from above.
function frostfallImpact(f) {
  frostfalls.delete(f.id);
  const at = [f.x, 0, f.z];
  const hits = [];
  for (const q of players.values()) {
    if (q.dead || q.id === f.owner || q.p[1] > FROST.height || dist2D(q.p, at) > FROST.radius) continue;
    const dx = q.p[0] - f.x, dz = q.p[2] - f.z, l = Math.hypot(dx, dz);
    const { dmg } = applyHit(q, { kind: 'frostfall', owner: f.owner, v: l > 0.05 ? [dx / l, 0, dz / l] : [0, 0, 1] });
    hits.push({ id: q.id, dmg });
  }
  for (const d of [...decoys.values()]) if (d.owner !== f.owner && dist2D(d.p, at) < FROST.radius) endDecoy(d, true);
  for (const prop of props.values()) {
    if (prop.state !== 'idle') continue;
    if (dist2D(at, [prop.x, 0, prop.z]) < FROST.radius + C.PROP_TYPES[prop.type].r * 0.5) breakProp(prop, [prop.x, C.PROP_TYPES[prop.type].h * 0.5, prop.z]);
  }
  for (const g of goats) {
    if (g.holder === f.owner || Math.hypot(g.x - f.x, g.z - f.z) > FROST.radius + C.GOAT.radius * 0.5) continue;
    // a rearing or charging goat is knocked dizzy; any other goat is now angry at the caster
    if (!Goats.dizzyGoat?.(g, goatCtx)) angerGoat(g, f.owner, goatCtx);
  }
  broadcast({ t: 'frostfallHit', id: f.id, p: at, hits });
}

// ---------------------------------------------------------------- Trapped Relic
// One cursed prop per caster. The curse is known only to the server and the caster.
function clearCurse(p) {
  let had = false;
  for (const prop of props.values()) if (prop.cursedBy === p.id) { prop.cursedBy = null; had = true; }
  if (had) send(p.id, { t: 'curse', id: null });
}
// The cursed prop reached its lifter's hold point: it explodes there.
function relicBlast(prop, victim) {
  const curserId = prop.cursedBy;
  const at = C.holdPoint(victim.p, victim.yaw);
  if (victim.carrying === prop.id) victim.carrying = null;
  broadcast({ t: 'relicBlast', p: at, by: curserId, victim: victim.id });
  breakProp(prop, at);
  if (victim.bot) botNoteRelic(victim, prop.id, now());
  const hits = [];
  const wallsHit = new Set();
  for (const q of players.values()) {
    if (q.dead || q.id === curserId) continue;
    const c = [q.p[0], q.p[1] + C.HIT_CENTER_Y, q.p[2]];
    const d = Math.hypot(c[0] - at[0], c[1] - at[1], c[2] - at[2]);
    if (d > RELIC.radius + C.HIT_RADIUS * 0.5) continue;
    const wall = q !== victim && wallBetween(at, q.p);
    if (wall) { wallsHit.add(wall); continue; }
    const dx = q.p[0] - at[0], dz = q.p[2] - at[2], l = Math.hypot(dx, dz);
    const out = l > 0.05 ? [dx / l, 0, dz / l] : [-Math.sin(q.yaw), 0, -Math.cos(q.yaw)];
    const { dmg, blocked } = applyHit(q, { kind: 'trapped_relic', owner: curserId, v: out });
    hits.push({ id: q.id, dmg, blocked });
  }
  for (const id of wallsHit) damageWall(id, RELIC.damage);
  for (const d of [...decoys.values()]) if (Math.hypot(d.p[0] - at[0], d.p[2] - at[2]) < RELIC.radius) endDecoy(d, true);
  return hits;
}

// ---------------------------------------------------------------- simulation
function simulate(dt) {
  const t = now();
  updateBots(dt, world);
  updateGoats(goats, dt, goatCtx);
  updateDecoys(dt, t);
  for (const w of [...walls.values()]) if (t >= w.until) wallDown(w, true);
  for (const f of [...frostfalls.values()]) if (t >= f.at) frostfallImpact(f);
  for (const c of [...smokes.values()]) if (t >= c.until) smokes.delete(c.id);   // clients fade it on their own clock

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
    // a lash wind-up: a stun interrupts it, and one never released (lost client) lapses
    if (p.lash && (isStunned(p) || t > p.lash.start + LASH.windup + 1)) cancelLash(p);
    if (p.cyclone) {
      if (!p.cyclone.pulsed && isStunned(p)) cancelCyclone(p);
      else if (!p.cyclone.pulsed && t >= p.cyclone.pulseAt) cyclonePulse(p);
      else if (t >= p.cyclone.endAt) p.cyclone = null;
    }
    // Skyward Flash: the flight ends when the wizard reports touching down, or when time runs out
    if (p.flightUntil && (t >= p.flightUntil || (p.p[1] <= 0.01 && t > p.flightStart + 0.3))) { p.flightUntil = 0; p.p[1] = 0; }
    flushPendingWizard(p);
    // goats.js drops a held goat itself (holder dead, stunned or gone); forget it when it's no longer ours
    if (p.carryingGoat) { const g = goatById(p.carryingGoat); if (!g || g.state !== 'held' || g.holder !== p.id) p.carryingGoat = null; }
    // telekinesis: however we let go of something (thrown, set down, knocked away, dropped), the next lift waits
    const held = holding(p);
    if (p.wasHolding && !held) p.cd.lift = t + C.SPELLBOOK[kit(p).utility].liftCooldown;
    p.wasHolding = held;
    if (p.veilUntil && t >= p.veilUntil) { p.veilUntil = 0; broadcast({ t: 'veilEnd', id: p.id }); }
    // primary magazine: a finished reload refills it; a partial one reloads after idling
    const mag = C.primaryMag(kit(p).primary);
    if (p.reloadUntil && t >= p.reloadUntil) { p.ammo = mag.magazine; p.reloadUntil = 0; }
    else if (!p.reloadUntil && p.ammo > 0 && p.ammo < mag.magazine && t - p.lastShotAt > mag.idleReload) { p.ammo = 0; p.reloadUntil = t + mag.reload; }
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
    // pillars, trees, fences (for anything flying low enough), ice walls (which take the damage)
    let done = false;
    for (const c of C.COLLIDERS) {
      if (proj.p[1] < c.h && Math.hypot(proj.p[0] - c.x, proj.p[2] - c.z) < c.r + proj.radius) {
        endProjectile(proj, true, { surface: c.kind });
        if (c.kind === 'bulwark') damageWall(c.wall, C.SPELLS[proj.kind].damage);
        done = true; break;
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

    // goats: no damage, but a spell makes it angry at its caster. A goat in the air is hit at its height;
    // a held one takes the hit for its holder (it drops and charges the caster). Not by its own holder's shots.
    for (const g of goats) {
      if (g.holder && g.holder === proj.owner) continue;
      if (Math.hypot(proj.p[0] - g.x, proj.p[1] - ((g.y || 0) + C.GOAT.hitY), proj.p[2] - g.z) < C.GOAT.radius + proj.radius) {
        angerGoat(g, proj.owner, goatCtx);
        endProjectile(proj, true, { surface: 'goat', goat: g.id });
        done = true; break;
      }
    }
    if (done) continue;

    // players (a lash pierces: it hits each wizard on its path once, unless a ward stops it)
    for (const pl of players.values()) {
      if (pl.dead || pl.id === proj.owner) continue;
      if (proj.pierce && proj.hitIds.has(pl.id)) continue;
      const c = [pl.p[0], pl.p[1] + C.HIT_CENTER_Y, pl.p[2]];
      const d = Math.hypot(proj.p[0] - c[0], proj.p[1] - c[1], proj.p[2] - c[2]);
      if (d < C.HIT_RADIUS + proj.radius) {
        const { blocked } = applyHit(pl, proj);
        if (proj.pierce) {
          proj.hitIds.add(pl.id);
          if (!blocked) { proj.landed++; continue; }
        }
        endProjectile(proj, true, { surface: 'player', target: pl.id });
        done = true; break;
      }
    }
    if (done) continue;

    // decoys: one touch and they burst (projectiles stop on them; a lash cuts through)
    const dec = decoyAt(proj.p, proj.radius, proj.owner);
    if (dec) {
      endDecoy(dec, true);
      if (!proj.pierce) { endProjectile(proj, true, { surface: 'decoy' }); continue; }
    }

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
      // a Trapped Relic lifted by someone other than its curser explodes at their hold point
      const victim = prop.trap && players.get(prop.trap);
      if (victim && !victim.dead && victim.carrying === prop.id) { relicBlast(prop, victim); continue; }
      prop.trap = null;
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
      // bound or recovering from a missed lash: the wizard stays put (a slowed one is just slower,
      // which the speed check below already allows)
      if (isRooted(p)) { np[0] = p.p[0]; np[2] = p.p[2]; }
      const dashing = p.dashUntil > t;   // Smoke Screen's dash is much faster than running
      const d = dist2D(np, p.p);
      // the fastest this wizard can go this way: its run speed, the backpedal cap against its facing, or a dash
      const run = C.backpedalSpeed(C.speedOf(p.wizard), np[0] - p.p[0], np[2] - p.p[2], Number.isFinite(msg.yaw) ? msg.yaw : p.yaw);
      const maxStep = ((dashing ? SMOKE.distance / SMOKE.dashTime : run) + C.SPELLS.heavy.knockback + 2) * dt + 0.6;
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
      if (on && (kit(p).guard !== 'ward' || !canAct(p) || p.st <= 2 || p.charging || p.cyclone || p.lash || isAirborne(p))) break;
      if (p.blocking && !on) p.blockReleasedAt = t;
      p.blocking = on;
      break;
    }
    case 'cast': {
      if (!canAct(p) || p.blocking || p.charging || p.cyclone || p.lash || holding(p)) break;
      const primary = kit(p).primary;
      if (t < p.cd.fast || t < p.reloadUntil || p.ammo <= 0) break;   // reloading: refused
      const wanted = (msg.kind === 'fast' && primary === 'spark') || (msg.kind === 'skim' && primary === 'glacial_skim');
      if (!wanted) break;
      // the last round of the magazine is the finisher; firing it starts the reload
      const fin = p.ammo === 1;
      p.ammo--; p.lastShotAt = t;
      if (p.ammo === 0) p.reloadUntil = t + C.primaryMag(primary).reload;
      if (msg.kind === 'fast') {
        p.cd.fast = t + C.SPELLS.fast.cooldown;
        const origin = sanitizeOrigin(p, msg.origin);
        spawnProjectile(p, 'fast', origin, sanitizeDir(msg.dir, p), null, fin);
      } else {
        // three shards in a tight fan, skimming the ground just ahead of the caster's feet
        p.cd.fast = t + SKIM.cooldown;
        const d = sanitizeDir([msg.dir?.[0] ?? 0, 0, msg.dir?.[2] ?? 0], p);
        const base = Math.atan2(d[0], d[2]);
        for (let i = 0; i < SKIM.shards; i++) {
          const a = base + (i - (SKIM.shards - 1) / 2) * SKIM.spreadDeg * Math.PI / 180;
          const dir = [Math.sin(a), 0, Math.cos(a)];
          spawnProjectile(p, 'skim', [p.p[0] + dir[0] * 0.5, C.SPELLS.skim.height, p.p[2] + dir[2] * 0.5], dir, null, fin);
        }
      }
      break;
    }
    case 'chargeStart': {
      if (kit(p).power !== 'meteor') break;
      if (!canAct(p) || p.blocking || p.charging || p.cyclone || p.lash || holding(p) || isAirborne(p)) break;
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
      const ok = kit(p).power === 'cyclone' && canAct(p) && !p.blocking && !p.charging && !p.cyclone && !p.lash
        && !holding(p) && !isAirborne(p) && t >= p.cd.power;
      // tell a refused caster, so its client drops the wind-up it predicted
      if (!ok) { if (!p.cyclone) send(p.id, { t: 'cycloneCancel', id: p.id }); break; }
      p.cyclone = { start: t, pulseAt: t + CYCLONE.windup, endAt: t + CYCLONE.windup + CYCLONE.spin, pulsed: false };
      broadcast({ t: 'cycloneStart', id: p.id, p: p.p });
      break;
    }
    case 'lashStart': {
      const ok = kit(p).power === 'sanguine_lash' && canAct(p) && !p.blocking && !p.charging && !p.cyclone && !p.lash
        && !holding(p) && !isAirborne(p) && t >= p.cd.power;
      if (!ok) { if (!p.lash) send(p.id, { t: 'lashCancel', id: p.id }); break; }
      p.lash = { start: t };
      broadcast({ t: 'lashStart', id: p.id });
      break;
    }
    case 'lashRelease': {
      if (!p.lash) break;
      const early = t - p.lash.start < LASH.windup - 0.05;
      if (early || !canAct(p)) { cancelLash(p); break; }
      p.lash = null;
      p.cd.power = t + LASH.cooldown;
      spawnProjectile(p, 'lash', sanitizeOrigin(p, msg.origin), sanitizeDir(msg.dir, p));
      break;
    }
    case 'frostfall': {
      // the one power spell allowed during a Skyward Flash; range is measured flat from the caster
      if (kit(p).power !== 'frostfall' || !canAct(p) || p.blocking || p.charging || p.cyclone || p.lash || holding(p) || t < p.cd.power) break;
      if (!Array.isArray(msg.at) || msg.at.length < 2 || !Number.isFinite(msg.at[0]) || !Number.isFinite(msg.at[msg.at.length - 1])) break;
      let x = msg.at[0], z = msg.at[msg.at.length - 1];
      // at most `range` from the caster, inside the arena
      const d = Math.hypot(x - p.p[0], z - p.p[2]);
      if (d > FROST.range) { x = p.p[0] + (x - p.p[0]) * FROST.range / d; z = p.p[2] + (z - p.p[2]) * FROST.range / d; }
      const r = Math.hypot(x, z);
      if (r > C.ARENA_RADIUS) { x *= C.ARENA_RADIUS / r; z *= C.ARENA_RADIUS / r; }
      p.cd.power = t + FROST.cooldown;
      const f = { id: nextFxId++, owner: p.id, x, z, at: t + FROST.delay };
      frostfalls.set(f.id, f);
      broadcast({ t: 'frostfall', ...frostPublic(f) });
      break;
    }
    case 'smoke': {
      // Smoke Screen: a fast dash backwards (the client moves itself; the server lets it go that fast),
      // leaving a cloud where it started
      if (kit(p).mobility !== 'smoke_screen' || !canAct(p) || isRooted(p) || p.charging || p.cyclone || p.lash || isAirborne(p) || t < p.cd.mobility) break;
      const yaw = Number.isFinite(msg.yaw) ? msg.yaw : p.yaw;
      const from = validVec(msg.from) && dist2D(msg.from, p.p) < 3 ? [msg.from[0], 0, msg.from[2]] : p.p.slice();
      const dir = [-Math.sin(yaw), 0, -Math.cos(yaw)];
      p.cd.mobility = t + SMOKE.cooldown;
      p.dashUntil = t + SMOKE.dashTime + 0.35;
      if (p.blocking) { p.blocking = false; p.blockReleasedAt = t; }
      if (p.bot) botDash(p, dir, t + SMOKE.dashTime);
      const c = { id: nextFxId++, owner: p.id, x: from[0], z: from[2], until: t + SMOKE.life };
      smokes.set(c.id, c);
      broadcast({ t: 'smoke', ...smokePublic(c), dir });
      break;
    }
    case 'mirror': {
      if (kit(p).mobility !== 'mirror_step' || !canAct(p) || isRooted(p) || p.charging || p.cyclone || p.lash || isAirborne(p) || t < p.cd.mobility) break;
      const dir = sanitizeDir([msg.dir?.[0] ?? 0, 0, msg.dir?.[2] ?? 1], p);
      const from = Array.isArray(msg.from) && msg.from.length === 3 && msg.from.every(Number.isFinite) && dist2D(msg.from, p.p) < 3 ? [msg.from[0], 0, msg.from[2]] : p.p.slice();
      const paths = C.mirrorPaths(from, dir);
      const mine = Math.floor(Math.random() * paths.length);
      p.cd.mobility = t + MIRROR.cooldown;
      p.p = paths[mine].to; p.justTeleported = true;
      if (p.blocking) { p.blocking = false; p.blockReleasedAt = t; }
      // the caster keeps running along its path; each decoy runs along one of the others
      const out = [];
      paths.forEach((path, i) => {
        if (i === mine) return;
        const d = { id: nextFxId++, owner: p.id, p: path.to.slice(), dir: path.dir, yaw: Math.atan2(path.dir[0], path.dir[2]), until: t + MIRROR.decoyTime };
        decoys.set(d.id, d);
        out.push({ id: d.id, p: d.p, yaw: d.yaw });
      });
      broadcast({ t: 'mirror', id: p.id, from, to: p.p, yaw: Math.atan2(paths[mine].dir[0], paths[mine].dir[2]), decoys: out });
      break;
    }
    case 'veil': {
      if (kit(p).guard !== 'tempest_veil' || !canAct(p) || isVeiled(p) || t < p.cd.guard) break;
      p.cd.guard = t + VEIL.cooldown;
      p.veilUntil = t + VEIL.duration;
      broadcast({ t: 'veil', id: p.id, left: VEIL.duration });
      break;
    }
    case 'bulwark': {
      if (kit(p).guard !== 'glacial_bulwark' || !canAct(p) || p.charging || p.cyclone || p.lash || isAirborne(p) || t < p.cd.guard) break;
      p.cd.guard = t + BULWARK.cooldown;
      raiseWall(p, Number.isFinite(msg.yaw) ? msg.yaw : p.yaw);
      break;
    }
    case 'curse': {
      if (kit(p).utility !== 'trapped_relic' || !canAct(p) || holding(p) || p.blocking || t < p.cd.lift) break;
      const prop = tkTarget(p, msg.aimOrigin, msg.aimDir);
      if (!prop) break;
      clearCurse(p);
      prop.cursedBy = p.id;
      p.cd.lift = t + C.SPELLBOOK.trapped_relic.liftCooldown;
      send(p.id, { t: 'curse', id: prop.id });   // nobody else hears of it
      break;
    }
    case 'wizard': {
      requestWizard(p, msg.id);
      break;
    }
    case 'reload': {
      // R: reload a partial magazine
      if (p.dead || p.ammo >= C.primaryMag(kit(p).primary).magazine || t < p.reloadUntil) break;
      p.ammo = 0; p.reloadUntil = t + C.primaryMag(kit(p).primary).reload;
      break;
    }
    case 'skyward': {
      // tell a refused flier, so its client comes back down from the flight it predicted
      if (kit(p).mobility !== 'skyward' || !canAct(p) || p.charging || p.cyclone || p.lash || isAirborne(p) || t < p.cd.mobility) {
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
    case 'teleport': {
      if (kit(p).mobility !== 'blink') break;
      if (!canAct(p) || isRooted(p) || p.charging || p.cyclone || p.lash) break;
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
      if (!canAct(p) || holding(p) || p.charging || p.cyclone || p.lash || p.blocking || t < p.cd.lift) break;
      const best = tkTarget(p, msg.aimOrigin, msg.aimDir, goatTK);
      if (!best) break;
      if (best.goat) {
        // a goat: it floats at our hold point (goats.js places it each tick); lifting doesn't anger it
        if (Goats.liftGoat(best.goat, p.id, goatCtx) === false) break;
        p.carryingGoat = best.goat.id;
        broadcast({ t: 'goatLift', id: p.id, goat: best.goat.id });
        break;
      }
      // a Trapped Relic: its curser just lifts it (and the curse is gone); anyone else sets it off
      if (best.cursedBy === p.id) clearCurse(p);
      else if (best.cursedBy) best.trap = p.id;
      best.state = 'lifting'; best.carrier = p.id; best.liftUntil = t + C.TK.liftTime;
      p.carrying = best.id;
      broadcast({ t: 'prop', prop: propPublic(best) });
      break;
    }
    case 'throw': {
      if (!canAct(p) || t < p.cd.throw) break;
      if (p.carryingGoat) {
        // hurled like a prop (same speed and gravity); goats.js flies it, and calls goatHitPlayer on a hit
        const g = goatById(p.carryingGoat);
        p.carryingGoat = null;
        if (!g || g.state !== 'held' || g.holder !== p.id) break;
        p.cd.throw = t + C.THROW_COOLDOWN;
        const origin = C.holdPoint(p.p, p.yaw);
        const target = validVec(msg.target) && dist2D(msg.target, p.p) < 80 ? msg.target : null;
        const dir = target ? C.ballisticDir(origin, target, C.GOAT.throwSpeed, C.GOAT.throwGravity) : sanitizeDir(msg.dir, p);
        if (Goats.throwGoat(g, p.id, origin, dir, goatCtx) !== false) broadcast({ t: 'goatThrow', id: p.id, goat: g.id, p: origin });
        break;
      }
      if (!p.carrying) break;
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
      if (p.carryingGoat) { const g = goatById(p.carryingGoat); p.carryingGoat = null; if (g && g.holder === p.id) Goats.releaseGoat?.(g, goatCtx); break; }
      if (!p.carrying) break;
      if (props.get(p.carrying)?.state === 'lifting') break;
      dropProp(p, false);
      break;
    }
    case 'addBot': {
      if (p.bot) break;
      const n = [...players.values()].filter(q => q.bot).length;
      if (n >= BOT_LIMIT) break;
      addBot(['easy', 'normal', 'hard'].includes(msg.difficulty) ? msg.difficulty : 'normal', msg.wizard);
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
// `wizard` (optional) pins which wizard it plays; otherwise it picks one at random.
function addBot(difficulty, wizard = null) {
  const id = nextId++;
  const taken = new Set([...players.values()].map(q => q.name));
  const name = BOT_NAMES.find(n => !taken.has(n)) || `Bot${id}`;
  const ids = Object.keys(C.WIZARDS);
  const p = newPlayer(id, name, C.isWizard(wizard) ? wizard : ids[Math.floor(Math.random() * ids.length)]);
  const sp = C.SPAWN_POINTS[Math.floor(Math.random() * C.SPAWN_POINTS.length)];
  p.p = [sp[0], 0, sp[2]];
  p.bot = createBot(difficulty);
  players.set(id, p);
  broadcast({ t: 'joined', player: playerPublic(p) });
  console.log(`[+] bot ${name} (${difficulty}, ${p.wizard}) joined. ${players.size} online`);
}

function removePlayer(id) {
  const p = players.get(id);
  if (!p) return;
  if (p.carrying) dropProp(p, false);
  if (p.carryingGoat) { const g = goatById(p.carryingGoat); p.carryingGoat = null; if (g && g.holder === p.id) Goats.releaseGoat?.(g, goatCtx); }
  clearCurse(p);
  for (const d of [...decoys.values()]) if (d.owner === id) endDecoy(d, false);
  players.delete(id); sockets.delete(id);
  broadcast({ t: 'leave', id });
}

// cycloneStopsGoats: the goat module can knock a charging goat dizzy (bots then answer a charge with a cyclone)
const world = { players, props, projectiles, goats, decoys, walls, frostfalls, smokes, handle, now, cycloneStopsGoats: !!Goats.dizzyGoat };
const goatCtx = {
  players, props, now, broadcast, breakProp,
  // a Tempest Veil survives a ram (goats.js treats the veil as a ward once that request is in; this is the fallback)
  killPlayer: (p, attacker, cause) => { if (cause === 'goat' && isVeiled(p)) return; killPlayer(p, attacker, cause); },
  // humans apply goat knockback themselves from the goatRam message
  knockback: (p, dir, kb) => { if (p.bot) botKnockback(p, dir, kb); },
  // a hurled goat hits a wizard exactly like a thrown prop (kind 'goat'), credited to the thrower
  goatHitPlayer: (g, target, throwerId) => {
    if (target.dead) return;
    applyHit(target, { kind: 'goat', owner: throwerId, v: [g.vx || 0, g.vy || 0, g.vz || 0] });
  },
};

const validVec = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

// The idle prop a telekinesis cast grabs: the one closest to the aim ray within range and cone,
// else anything at point-blank range. Pillars block the line of sight.
// Props and (if `withGoats`) liftable goats compete: the one closest to the aim ray wins. A goat comes
// back as { goat }.
function tkTarget(p, aimOrigin, aimDir, withGoats = false) {
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
  if (withGoats) {
    for (const g of goats) {
      if (!Goats.canLift?.(g)) continue;
      const d2 = Math.hypot(g.x - p.p[0], g.z - p.p[2]);
      if (d2 < nd) { nd = d2; near = { goat: g }; }
      if (d2 > C.TK.range) continue;
      const v = [g.x - o[0], (g.y || 0) + C.GOAT.hitY - o[1], g.z - o[2]];
      const l = len3(v) || 1;
      const cos = (v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2]) / l;
      if (Math.acos(clamp(cos, -1, 1)) - Math.atan2(C.GOAT.radius, l) > cone) continue;
      if (C.pillarBlocks(p.p, [g.x, 0, g.z], 0.1)) continue;
      const score = cos - l * 0.002;
      if (score > bestScore) { bestScore = score; best = { goat: g }; }
    }
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
      const p = newPlayer(id, name, msg.wizard);
      players.set(id, p);
      sockets.set(id, ws);
      ws.send(JSON.stringify({
        t: 'welcome', id,
        players: [...players.values()].map(playerPublic),
        props: [...props.values()].map(propPublic),
        goats: goats.map(goatPublic),
        projectiles: [...projectiles.values()].map(pr => ({ id: pr.id, kind: pr.kind, owner: pr.owner, propType: pr.propType, p: pr.p, v: pr.v, g: pr.g, r: pr.radius, life: pr.life - (now() - pr.born) })),
        walls: [...walls.values()].map(wallPublic),
        frostfalls: [...frostfalls.values()].map(frostPublic),
        smokes: [...smokes.values()].map(smokePublic),
        decoys: [...decoys.values()].map(decoyPublic),
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
  broadcast({ t: 'snap', time: now(), players: [...players.values()].map(playerPublic), goats: goats.map(goatPublic), decoys: [...decoys.values()].map(decoyPublic) });
}, 1000 / C.SNAPSHOT_RATE);

httpServer.listen(PORT, () => console.log(`Wizard Arena listening on http://localhost:${PORT}`));
