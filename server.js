// Wizard Arena — authoritative game server.
// Clients own their own movement (position/yaw) and send inputs for everything else.
// The server owns combat: spells, projectiles, health, stamina, stuns, props and respawns.

import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as C from './public/shared/constants.js';
import { createBot, updateBots, botKnockback, botNoteRelic, botDash, botPull, BOT_LIMIT } from './server/bots.js';
import * as Goats from './server/goats.js';
import { createMatch } from './server/match.js';
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
const strikes = new Map();    // Cataclysm meteors on their way down: id -> { id, owner, x, z, at }
const firewalls = new Map();  // Firewalls: id -> { id, owner, x, z, yaw, until, burned: Set }
const cages = new Map();      // Night Cages: id -> { id, owner, x, z, until, inside: Set, foes: Set }
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
    ammo: C.primaryMag(C.kitOf(wizard).primary).magazine, reloadUntil: 0, lastShotAt: 0,   // primary magazine (constants: primaryMag)
    veilUntil: 0,                 // Tempest Veil: every hit is absorbed until then
    ult: 0,                       // ultimate charge, 0–100 (C.ULT_CHARGE); kept through death
    eye: null,                    // Eye of the Storm: { until, nextTick, nextPull }
    zero: null,                   // Absolute Zero's flare: { at }
    flightStart: 0, flightUntil: 0,   // Skyward Flash window: y may exceed 0 only inside it
    carrying: null,
    lastHitBy: null,
    lastStateAt: 0,
  };
}

function playerPublic(p) {
  return {
    ...match.playerExtras(p),
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
    ult: Math.floor(p.ult), eye: !!p.eye, zero: !!p.zero, lashBonus: Math.round(p.lashBonus || 0),
    ride: p.ride ? (now() < p.ride.rideAt ? 'mount' : now() < p.ride.dismountAt ? 'ride' : 'dismount') : null,
    ramGuard: p.ramGuardUntil > now(),
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
const CATA = C.SPELLBOOK.cataclysm, EYE = C.SPELLBOOK.eye_of_storm, ZERO = C.SPELLBOOK.absolute_zero, CAGE = C.SPELLBOOK.night_cage;
// Eye of the Storm and Absolute Zero's flare can't be interrupted (no stun, cancel, bind, slow or knockback)
const unstoppable = (p) => !!p.eye || !!p.zero;
// May `a` hurt `b`? Game modes: no friendly fire. A missing owner (left the game) still hurts.
const enemies = (a, b) => !a || !b || (a.id !== b.id && match.isEnemy(a, b));
const enemyOf = (ownerId, q) => enemies(players.get(ownerId), q);

// ---------------------------------------------------------------- wizard choice
// A switch applies at once if the player is alive and not mid-cast, else when the cast ends or at respawn.
const midCast = (p) => p.charging || !!p.cyclone || !!p.lash || isAirborne(p) || unstoppable(p) || !!p.ride;
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
  if (p.blocking && !C.isWard(kit(p).guard)) { p.blocking = false; p.blockReleasedAt = now(); }
  if (kit(p).utility !== 'trapped_relic') clearCurse(p);
  p.ammo = C.primaryMag(kit(p).primary).magazine; p.reloadUntil = 0;   // a fresh pouch or magazine for the new primary
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
function spawnProjectile(owner, kind, origin, dir, propType = null, fin = false, curve = null) {
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
  if (fin) {
    proj.fin = true;
    if (spec.finDamage) proj.dmg = spec.finDamage;   // Fireball's 3rd shot hits harder
    if (spec.finRadius) proj.radius = spec.finRadius; // Gale Shear's 3rd is a wider crescent
  }
  if (curve) { proj.curve = curve; const s0 = C.hexAt(curve, 0); proj.v = s0.v; proj.shot = curve.shot; }
  projectiles.set(id, proj);
  broadcast({ t: 'proj', id, kind, owner: owner.id, propType, p: proj.p, v: proj.v, g: proj.g, r: proj.radius, life: proj.life,
    ...(fin ? { fin: true } : {}), ...(curve ? { curve } : {}) });
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
  // game modes: no friendly fire
  if (attacker && attacker !== target && !match.isEnemy(attacker, target)) return { dmg: 0, blocked: false, friendly: true };
  // primary fire only interrupts (stun, cancel) with the last shot of a magazine
  // (an ultimate's drain never interrupts; Gale's tornado and Rime's flare can't be interrupted)
  const steady = unstoppable(target);
  const interrupt = (!C.PRIMARY_KINDS.has(proj.kind) || !!proj.fin) && !spec.noInterrupt && !steady;
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
    // Black Death wraps her whole body: it blocks from every side
    blocked = !!C.SPELLBOOK[kit(target).guard]?.allSides || cos >= Math.cos((C.BLOCK_CONE_DEG / 2) * Math.PI / 180);
  }

  let dmg = proj.dmg ?? spec.damage;
  if (blocked) {
    const cost = spec.staminaCost * (C.SPELLBOOK[kit(target).guard]?.hitCostMul ?? 1);
    const full = dmg;
    if (target.st >= cost) {
      target.st -= cost;
      dmg = 0;
    } else {
      // Block breaks: leftover damage leaks through, blocker is staggered.
      dmg = Math.round(dmg * (1 - target.st / cost) * 0.6);
      target.st = 0;
      target.blocking = false;
      target.blockReleasedAt = t;
      if (!steady) target.stunUntil = Math.max(target.stunUntil, t + C.BLOCK_BREAK_STUN);
      broadcast({ t: 'blockBreak', id: target.id });
    }
    guardAbsorbed(target, attacker, full - dmg, t);
  } else if (interrupt) {
    // Sparks can't chain-stun: once a spark stun ends there's a short window where sparks only sting.
    const primaryShot = C.PRIMARY_KINDS.has(proj.kind);
    if (!primaryShot || t >= target.stunImmuneUntil) {
      target.stunUntil = Math.max(target.stunUntil, t + spec.stun);
      if (primaryShot) target.stunImmuneUntil = target.stunUntil + C.SPARK_STUN_IMMUNITY;
    }
    // Being hit cancels a heavy wind-up, a lash wind-up, a cyclone that hasn't spun yet, and a lift
    if (target.charging) { target.charging = false; broadcast({ t: 'chargeCancel', id: target.id }); }
    cancelCyclone(target);
    cancelLash(target);
    const lifting = target.carrying && props.get(target.carrying);
    if (lifting && lifting.state === 'lifting') { target.carrying = null; lifting.state = 'idle'; lifting.carrier = null; lifting.trap = null; broadcast({ t: 'prop', prop: propPublic(lifting) }); }
  }
  const freeze = !blocked && !steady && spec.bind && (proj.kind === 'frostfall' || spec.freeze);
  if (!blocked && !steady) {
    // Glacial Skim slows (refreshed, never stacked); Sanguine Lash binds: rooted and silenced.
    if (spec.slow) target.slowUntil = t + spec.slowTime;
    if (spec.bind) {
      target.rootUntil = Math.max(target.rootUntil, t + spec.bind);
      target.silenceUntil = Math.max(target.silenceUntil, t + spec.bind);
      if (target.blocking) { target.blocking = false; target.blockReleasedAt = t; }
      if (freeze) target.frozenUntil = t + spec.bind;   // Frostfall, Absolute Zero: the bind, shown as ice
    }
  }

  target.hp -= dmg;
  if (dmg > 0) {
    target.lastHitBy = proj.owner; match.onDamage(target, attacker, dmg);
    // damage dealt charges the attacker's ultimate (not an ultimate's own damage)
    if (attacker && attacker !== target && !spec.ult) addUltCharge(attacker, dmg * C.ULT_CHARGE.perDamage * (spec.ultCharge ?? 1));
  }
  const kb = isRooted(target) || steady ? 0 : blocked ? spec.knockback * 0.3 : spec.knockback;
  if (target.bot && kb) botKnockback(target, norm3([proj.v[0], 0, proj.v[2]]), kb);

  broadcast({
    t: 'hit', target: target.id, attacker: proj.owner, kind: proj.kind, dmg, blocked,
    kb, dir: norm3([proj.v[0], 0, proj.v[2]]), int: interrupt,
    ...(!blocked && spec.slow ? { slow: spec.slowTime } : {}),
    ...(!blocked && !steady && spec.bind ? { bind: spec.bind } : {}),
    ...(freeze ? { freeze: true } : {}),
    ...(!blocked && !steady && spec.launch ? { launch: spec.launch } : {}),
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
  endUltimates(target);
  endRide(target);
  if (target.veilUntil) { target.veilUntil = 0; broadcast({ t: 'veilEnd', id: target.id }); }
  for (const d of [...decoys.values()]) if (d.owner === target.id) endDecoy(d, false);
  target.flightUntil = 0; target.p[1] = 0;
  target.blocking = false;
  target.deaths++;
  target.respawnAt = now() + C.RESPAWN_TIME;
  if (target.carrying) dropProp(target, true);
  if (target.carryingGoat) { const g = goatById(target.carryingGoat); target.carryingGoat = null; if (g && g.holder === target.id) Goats.releaseGoat?.(g, goatCtx); }
  if (attacker && attacker.id !== target.id) { attacker.kills++; addUltCharge(attacker, C.ULT_CHARGE.kill); }
  match.onKill(target, attacker, cause);
  broadcast({ t: 'death', id: target.id, killer: attacker ? attacker.id : null, cause });
}

function respawn(p) {
  const sp = match.spawnPointFor(p) || C.SPAWN_POINTS[Math.floor(Math.random() * C.SPAWN_POINTS.length)];
  p.p = [sp[0] + rand(-1, 1), 0, sp[2] + rand(-1, 1)];
  p.hp = C.MAX_HP; p.st = C.MAX_STAMINA;
  p.dead = false; p.stunUntil = 0; p.blocking = false; p.charging = false; p.cyclone = null; p.lash = null; p.flightUntil = 0;
  p.slowUntil = p.rootUntil = p.silenceUntil = p.frozenUntil = 0;
  p.ammo = C.primaryMag(kit(p).primary).magazine; p.reloadUntil = 0;
  endUltimates(p);
  endRide(p);
  if (p.pendingWizard) applyWizard(p, p.pendingWizard);
  broadcast({ t: 'respawn', id: p.id, p: p.p });
}

function dropProp(p, destroy, reason = null) {
  const prop = props.get(p.carrying);
  p.carrying = null;
  if (!prop) return;
  match.onDrop(p, prop, reason || (destroy ? 'destroyed' : 'dropped'));
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

// A ward-style guard soaked `absorbed` damage. Black Death charges the next Sanguine Lash with it.
function guardAbsorbed(p, attacker, absorbed, t) {
  const G = kit(p).guard;
  if (G === 'black_death' && absorbed > 0) {
    const B = C.SPELLBOOK.black_death;
    if (kit(p).power === 'sanguine_lash' && p.cd.power > t) p.cd.power = Math.max(t, p.cd.power - absorbed * B.lashCdPerDamage);
    p.lashBonus = Math.min(B.maxBonus, (p.lashBonus || 0) + absorbed * B.bonusPerDamage);
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
    if (q === p || q.dead || !enemies(p, q)) continue;
    const d = dist2D(q.p, p.p);
    if (d > CYCLONE.radius + C.PLAYER_RADIUS || Math.abs(q.p[1] - p.p[1]) > CYCLONE.height) continue;
    const wall = wallBetween(p.p, q.p);
    if (wall) { wallsHit.add(wall); continue; }
    const out = d > 0.01 ? [(q.p[0] - p.p[0]) / d, 0, (q.p[2] - p.p[2]) / d] : [Math.sin(q.yaw), 0, Math.cos(q.yaw)];
    const { dmg, blocked } = applyHit(q, { kind: 'cyclone', owner: p.id, v: out });
    hits.push({ id: q.id, dmg, blocked });
  }
  for (const id of wallsHit) damageWall(id, CYCLONE.damage);
  for (const d of [...decoys.values()]) if (enemyOf(d.owner, p) && dist2D(d.p, p.p) < CYCLONE.radius + C.PLAYER_RADIUS && p.p[1] < CYCLONE.height) endDecoy(d, true);
  if (p.p[1] < 1) {
    for (const prop of props.values()) {
      if (prop.state !== 'idle') continue;
      if (dist2D(p.p, [prop.x, 0, prop.z]) < CYCLONE.radius + C.PROP_TYPES[prop.type].r) breakProp(prop, [prop.x, C.PROP_TYPES[prop.type].h * 0.5, prop.z]);
    }
    for (const g of allGoats()) {
      if (g.holder === p.id || g.owner === p.id || Math.hypot(g.x - p.p[0], g.z - p.p[2]) > CYCLONE.radius + C.GOAT.radius) continue;
      // A goat already rearing or charging gets spun dizzy; any other goat is now angry at the caster.
      stirGoat(g, p.id);
    }
  }
  broadcast({ t: 'cyclonePulse', id: p.id, p: p.p, hits });
}

function breakProp(prop, at) {
  match.onPropBroken(prop);
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
    if (d.owner === ownerId || !enemyOf(ownerId, players.get(d.owner))) continue;
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
// ---------------------------------------------------------------- Firewall
// Cinder's Firewall: a sheet of flame across her aim. It isn't solid: enemy projectiles (and thrown props) that cross it
// burn up, and an enemy walking through takes a burn once per wall.
const FIREWALL = C.SPELLBOOK.firewall;
const firewallPublic = (w) => ({ id: w.id, owner: w.owner, x: w.x, z: w.z, yaw: w.yaw, left: Math.max(0, w.until - now()) });
function raiseFirewall(p, yaw) {
  const [x, z] = C.firewallCentre(p.p, yaw);
  const w = { id: nextFxId++, owner: p.id, x, z, yaw, until: now() + FIREWALL.life, burned: new Set() };
  firewalls.set(w.id, w);
  broadcast({ t: 'firewall', ...firewallPublic(w) });
}
// The Firewall (of an enemy of `ownerId`) the segment a→b crosses, if any.
function firewallCrossed(ownerId, a, b, r) {
  for (const w of firewalls.values()) {
    if (!enemyOf(w.owner, players.get(ownerId))) continue;
    if (Math.max(a[1], b[1]) > FIREWALL.height + r && Math.min(a[1], b[1]) > FIREWALL.height + r) continue;
    const la = C.firewallLocal(w, a), lb = C.firewallLocal(w, b);
    const crosses = Math.sign(la.across) !== Math.sign(lb.across) || Math.abs(lb.across) < FIREWALL.thickness / 2 + r;
    if (!crosses) continue;
    // where it crosses the plane
    const k = la.across === lb.across ? 1 : Math.max(0, Math.min(1, la.across / (la.across - lb.across)));
    if (Math.abs(la.along + (lb.along - la.along) * k) < FIREWALL.width / 2 + r) return w;
  }
  return null;
}
function updateFirewalls(t) {
  for (const w of [...firewalls.values()]) {
    if (t >= w.until) { firewalls.delete(w.id); broadcast({ t: 'firewallEnd', id: w.id }); continue; }
    const owner = players.get(w.owner);
    for (const q of players.values()) {
      if (q.dead || w.burned.has(q.id) || !enemies(owner, q) || q.p[1] > FIREWALL.height) continue;
      const l = C.firewallLocal(w, q.p);
      // touching it, or having crossed it since the last tick (a position update can step right over the thin sheet)
      const side = Math.sign(l.across), prev = (w.side ??= new Map()).get(q.id);
      w.side.set(q.id, side);
      const crossed = prev !== undefined && prev !== side;
      if ((Math.abs(l.across) > FIREWALL.thickness / 2 + C.PLAYER_RADIUS && !crossed) || Math.abs(l.along) > FIREWALL.width / 2 + C.PLAYER_RADIUS) continue;
      w.burned.add(q.id);
      applyHit(q, { kind: 'firewall_burn', owner: w.owner, v: [Math.sin(w.yaw), 0, Math.cos(w.yaw)] });
    }
  }
}

// Glacial Bulwark: an enemy touching the wall is frozen (once per wall per enemy every BULWARK.refreeze s).
function bulwarkTouch(w, t) {
  const owner = players.get(w.owner);
  w.touched ??= new Map();
  for (const q of players.values()) {
    if (q.dead || q.id === w.owner || !enemies(owner, q) || q.p[1] > BULWARK.height) continue;
    if (t < (w.touched.get(q.id) ?? -Infinity) + BULWARK.refreeze) continue;
    const touching = C.COLLIDERS.some(c => c.wall === w.id && Math.hypot(q.p[0] - c.x, q.p[2] - c.z) < c.r + C.PLAYER_RADIUS + 0.15);
    if (!touching) continue;
    w.touched.set(q.id, t);
    const dx = q.p[0] - w.x, dz = q.p[2] - w.z, l = Math.hypot(dx, dz) || 1;
    applyHit(q, { kind: 'bulwark_frost', owner: w.owner, v: [dx / l, 0, dz / l] });
  }
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
    if (q.dead || q.id === f.owner || !enemyOf(f.owner, q) || q.p[1] > FROST.height || dist2D(q.p, at) > FROST.radius) continue;
    const dx = q.p[0] - f.x, dz = q.p[2] - f.z, l = Math.hypot(dx, dz);
    const { dmg } = applyHit(q, { kind: 'frostfall', owner: f.owner, v: l > 0.05 ? [dx / l, 0, dz / l] : [0, 0, 1] });
    hits.push({ id: q.id, dmg });
  }
  for (const d of [...decoys.values()]) if (d.owner !== f.owner && enemyOf(f.owner, players.get(d.owner)) && dist2D(d.p, at) < FROST.radius) endDecoy(d, true);
  for (const prop of props.values()) {
    if (prop.state !== 'idle') continue;
    if (dist2D(at, [prop.x, 0, prop.z]) < FROST.radius + C.PROP_TYPES[prop.type].r * 0.5) breakProp(prop, [prop.x, C.PROP_TYPES[prop.type].h * 0.5, prop.z]);
  }
  for (const g of allGoats()) {
    if (g.holder === f.owner || g.owner === f.owner || Math.hypot(g.x - f.x, g.z - f.z) > FROST.radius + C.GOAT.radius * 0.5) continue;
    // a rearing or charging goat is knocked dizzy; any other goat is now angry at the caster
    stirGoat(g, f.owner);
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
  broadcast({ t: 'relicBlast', p: at, by: curserId, victim: victim.id });
  if (victim.carrying === prop.id) victim.carrying = null;
  breakProp(prop, at);
  if (victim.bot) botNoteRelic(victim, prop.id, now());
  const hits = [];
  const wallsHit = new Set();
  for (const q of players.values()) {
    if (q.dead || q.id === curserId || !enemyOf(curserId, q)) continue;
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

// ---------------------------------------------------------------- Jeb's rams
// Summoned rams follow the goat contract (docs/agents/round7-jeb.md): server/goats.js (environment) owns them through
// summonRam / callRam once those exist. Until then (or if they're missing) this file runs a minimal stand-in with
// the same rules: a straight charge that one-shots the first enemy it meets unless a facing ward, a Veil or Black Death
// stops it (it goes dizzy), dizzy on colliders, never touching its owner or the owner's team, and despawning once
// it has recovered. Stand-in rams live in `rams`, not `goats`, and go out in snapshots alongside the goats.
const envRams = () => typeof Goats.summonRam === 'function';
const rams = [];
let nextRamId = 1000;
const G_ = C.GOAT;
const SLING = C.SPELLBOOK.sling, BRAM = C.SPELLBOOK.battering_ram, RGUARD = C.SPELLBOOK.ram_guard, RIDE = C.SPELLBOOK.ram_ride, STAMP = C.SPELLBOOK.stampede;
const ramPublic = (r) => ({ id: r.id, p: [+r.x.toFixed(2), +r.z.toFixed(2)], yaw: +r.yaw.toFixed(2), s: r.state === 'orbit' || r.state === 'mount' ? 'charge' : r.state,
  tgt: r.target, y: 0, holder: null, summoned: true, owner: r.owner, mode: r.mode });
// Everything goat-like spells interact with: the map goats and any stand-in rams.
const allGoats = () => rams.length ? [...goats, ...rams] : goats;
const findRam = (id) => rams.find(r => r.id === id) || goats.find(g => g.id === id);
// A spell stirs a goat: map goats go dizzy or get angry at the caster; summoned rams only go dizzy.
function stirGoat(g, casterId) {
  if (g.summoned) { if (g.state === 'charge' || g.state === 'windup') ramDizzy(g); return; }
  if (!Goats.dizzyGoat?.(g, goatCtx)) angerGoat(g, casterId, goatCtx);
}

// opts: { x, z, yaw, ownerId, mode: 'charge' | 'orbit' | 'mount', targetId?, speed?, maxTime?, angle? }
function summonRam(opts) {
  const owner = players.get(opts.ownerId);
  if (envRams()) {
    const g = Goats.summonRam({ ...opts, team: owner?.team ?? null }, goatCtx);
    if (g) broadcast({ t: 'ramSpawn', id: g.id, p: [g.x, 0, g.z], mode: opts.mode });
    return g;
  }
  const t = now();
  const r = { id: nextRamId++, summoned: true, owner: opts.ownerId, mode: opts.mode, x: opts.x, z: opts.z, yaw: opts.yaw ?? 0,
    state: opts.mode === 'charge' ? 'charge' : opts.mode, until: t + (opts.maxTime ?? G_.chargeTime), speed: opts.speed ?? G_.chargeSpeed,
    target: opts.targetId ?? null, angle: opts.angle ?? 0, hardUntil: t + 10, born: t };
  rams.push(r);
  broadcast({ t: 'ramSpawn', id: r.id, p: [r.x, 0, r.z], mode: r.mode });
  return r;
}
function despawnRam(r) {
  if (envRams() && !rams.includes(r)) { Goats.despawnRam?.(r, goatCtx); return; }
  const i = rams.indexOf(r);
  if (i < 0) return;
  rams.splice(i, 1);
  broadcast({ t: 'goatGone', id: r.id, p: [r.x, 0, r.z] });
}
function ramDizzy(r) {
  if (!rams.includes(r)) { Goats.dizzyGoat?.(r, goatCtx); return; }
  r.state = 'dizzy'; r.until = now() + G_.dizzyTime;
  broadcast({ t: 'goatBonk', id: r.id, p: [r.x, 0.8, r.z] });
}
// An orbiting ram took a shot from `shooterId`: it breaks orbit and charges the shooter (homing like a map goat).
function ramProvoked(r, shooterId) {
  if (!rams.includes(r)) { (Goats.ramHitByProjectile || ((g, id) => angerGoat(g, id, goatCtx)))(r, shooterId, goatCtx); return; }
  if (r.state !== 'orbit') return;
  r.mode = 'charge'; r.state = 'charge'; r.target = shooterId; r.until = now() + G_.chargeTime;
  const s = players.get(shooterId);
  if (s) r.yaw = Math.atan2(s.p[0] - r.x, s.p[2] - r.z);
  broadcast({ t: 'goatAngry', id: r.id, target: shooterId });
}
// The goat rule for a summoned ram meeting an enemy wizard.
function ramHits(r, p, t) {
  const dir = [Math.sin(r.yaw), 0, Math.cos(r.yaw)];
  const facing = p.blocking && p.st > 0 && (C.SPELLBOOK[kit(p).guard]?.allSides
    || (Math.sin(p.yaw) * -dir[0] + Math.cos(p.yaw) * -dir[2]) >= Math.cos((C.BLOCK_CONE_DEG / 2) * Math.PI / 180));
  if (isVeiled(p) || facing) {
    if (!isVeiled(p)) {
      const shattered = p.st < G_.blockCost;
      p.st = Math.max(0, p.st - G_.blockCost);
      if (shattered) { p.blocking = false; p.blockReleasedAt = t; p.stunUntil = Math.max(p.stunUntil, t + C.BLOCK_BREAK_STUN); broadcast({ t: 'blockBreak', id: p.id }); }
      if (p.bot) botKnockback(p, dir, G_.blockKnockback);
    }
    r.yaw += Math.PI; r.x -= dir[0] * 0.8; r.z -= dir[2] * 0.8;
    broadcast({ t: 'goatRam', id: r.id, target: p.id, blocked: true, veil: isVeiled(p), dir, p: [p.p[0], 1, p.p[2]] });
    ramDizzy(r);
    return;
  }
  broadcast({ t: 'goatRam', id: r.id, target: p.id, blocked: false, dir, p: [p.p[0], 1, p.p[2]] });
  const owner = players.get(r.owner);
  p.lastHitBy = owner ? owner.id : null;
  killPlayer(p, owner || null, 'ram');
  r.state = 'recover'; r.until = t + G_.recoverTime;
}
function updateRams(dt, t) {
  for (const r of [...rams]) {
    const owner = players.get(r.owner);
    if (t >= r.hardUntil) { despawnRam(r); continue; }
    if (r.state === 'orbit') {
      if (!owner || owner.dead || t >= r.until) { despawnRam(r); continue; }
      const a = r.angle + (t - r.born) * Math.PI * 2 / RGUARD.lap;
      r.x = owner.p[0] + Math.sin(a) * RGUARD.radius; r.z = owner.p[2] + Math.cos(a) * RGUARD.radius;
      r.yaw = a + Math.PI / 2;
      continue;
    }
    if (r.state === 'mount') { if (!owner || owner.dead || !owner.ride) despawnRam(r); continue; }   // placed by the ride
    if (r.state === 'dizzy' || r.state === 'recover') { if (t >= r.until) despawnRam(r); continue; }
    if (r.state !== 'charge') continue;
    // a provoked guard ram homes like a map goat; Battering Rams and Stampede rams run dead straight
    const tg = r.target != null && players.get(r.target);
    if (tg && !tg.dead) { const want = Math.atan2(tg.p[0] - r.x, tg.p[2] - r.z); let d = Math.atan2(Math.sin(want - r.yaw), Math.cos(want - r.yaw)); d = clamp(d, -G_.turnRate * dt, G_.turnRate * dt); r.yaw += d; }
    r.x += Math.sin(r.yaw) * r.speed * dt; r.z += Math.cos(r.yaw) * r.speed * dt;
    for (const prop of props.values()) if (prop.state === 'idle' && Math.hypot(prop.x - r.x, prop.z - r.z) < C.PROP_TYPES[prop.type].r + G_.radius) breakProp(prop, [prop.x, C.PROP_TYPES[prop.type].h * 0.5, prop.z]);
    let done = false;
    for (const q of players.values()) {
      if (q.dead || q.p[1] >= G_.rammableBelow || !enemies(owner, q) || q.id === r.owner) continue;
      if (Math.hypot(q.p[0] - r.x, q.p[2] - r.z) > G_.radius + C.PLAYER_RADIUS + 0.25) continue;
      ramHits(r, q, t); done = true; break;
    }
    if (done) continue;
    for (const o of C.COLLIDERS) {
      if (o.kind === 'fence' || o.kind === 'crop') continue;
      if (Math.hypot(o.x - r.x, o.z - r.z) < o.r + G_.radius) { ramDizzy(r); done = true; break; }
    }
    if (done) continue;
    // a charging ram runs over enemy decoys
    for (const d of [...decoys.values()]) if (enemyOf(r.owner, players.get(d.owner)) && Math.hypot(d.p[0] - r.x, d.p[2] - r.z) < G_.radius + C.PLAYER_RADIUS + 0.25) endDecoy(d, true);
    if (Math.hypot(r.x, r.z) > C.ARENA_RADIUS - 1 || t >= r.until) { r.state = 'recover'; r.until = t + G_.recoverTime; }
  }
}

// Shepherd's Sling: a hit calls the nearest calm map goat to charge the target, credited to the slinger.
const CALM = new Set(['graze', 'wander', 'return', 'stumble', 'recover']);
function callRamOn(target, slinger) {
  const t = now();
  slinger.slingLock ??= new Map();
  if (t < (slinger.slingLock.get(target.id) ?? 0)) return;
  let g = null;
  if (typeof Goats.callRam === 'function') g = Goats.callRam(target.id, slinger.id, target.p, SLING.callRange, goatCtx);
  else {
    let bd = SLING.callRange;
    for (const q of goats) {
      if (q.summoned || !CALM.has(q.state) || q.holder || (q.y || 0) > 0.05) continue;
      const d = Math.hypot(q.x - target.p[0], q.z - target.p[2]);
      if (d < bd) { bd = d; g = q; }
    }
    if (g) { angerGoat(g, target.id, goatCtx); g.angeredBy = slinger.id; }   // it charges the target; a kill is the slinger's
  }
  if (!g) return;
  slinger.slingLock.set(target.id, t + SLING.callLockout);
  broadcast({ t: 'ramCalled', goat: g.id, target: target.id, by: slinger.id });
}

// Ram Ride: mount (can't act), gallop forward along the rider's facing for RIDE.distance, dismount, the ram goes.
// Clients move themselves (the speed check allows the gallop); the server moves bots. An enemy in the way is shoved.
function startRide(p, yaw) {
  const t = now();
  const rideTime = RIDE.distance / RIDE.speed;
  p.ride = { start: t, rideAt: t + RIDE.mount, dismountAt: t + RIDE.mount + rideTime, endAt: t + RIDE.mount + rideTime + RIDE.dismount, yaw, shoved: new Set() };
  p.yaw = yaw;
  const r = summonRam({ x: p.p[0], z: p.p[2], yaw, ownerId: p.id, mode: 'mount', maxTime: RIDE.mount + RIDE.distance / RIDE.speed + RIDE.dismount + 1 });
  p.ride.ram = r?.id ?? null; p.ride.ramObj = r || null;   // (goats.js adds it to the array on its next update)
  p.rootUntil = Math.max(p.rootUntil, p.ride.rideAt);   // getting on
  if (p.blocking) { p.blocking = false; p.blockReleasedAt = t; }
  broadcast({ t: 'ride', id: p.id, yaw, ram: p.ride.ram, mount: RIDE.mount, ride: rideTime, dismount: RIDE.dismount });
}
const riding = (p) => !!p.ride;
const galloping = (p, t = now()) => !!p.ride && t >= p.ride.rideAt && t < p.ride.dismountAt;
function updateRide(p, t) {
  const R = p.ride;
  const ram = R.ramObj;
  if (ram) { ram.x = p.p[0]; ram.z = p.p[2]; ram.yaw = p.yaw; }
  if (t >= R.dismountAt && !R.off) { R.off = true; p.rootUntil = Math.max(p.rootUntil, R.endAt); }   // getting off
  if (galloping(p, t)) {
    for (const q of players.values()) {
      if (q === p || q.dead || R.shoved.has(q.id) || !enemies(p, q) || q.p[1] > 1) continue;
      if (dist2D(q.p, p.p) > C.PLAYER_RADIUS * 2 + G_.radius * 0.6) continue;
      R.shoved.add(q.id);
      const dx = q.p[0] - p.p[0], dz = q.p[2] - p.p[2], l = Math.hypot(dx, dz) || 1;
      applyHit(q, { kind: 'ram_shove', owner: p.id, v: [dx / l, 0, dz / l] });
    }
  }
  if (t >= R.endAt) endRide(p);
}
function endRide(p) {
  if (!p.ride) return;
  const ram = p.ride.ramObj;
  p.ride = null;
  if (ram) despawnRam(ram);
  broadcast({ t: 'rideEnd', id: p.id });
}

// Stampede: a lane from Jeb toward the aim point. After the telegraph, the rams pour down it one after another.
const stampedes = new Map();   // id -> { id, owner, p, dir, at, spawned, next }
function castStampede(p, at) {
  let dx = at[0] - p.p[0], dz = at[1] - p.p[2];
  let l = Math.hypot(dx, dz);
  if (l < 1) { dx = Math.sin(p.yaw); dz = Math.cos(p.yaw); l = 1; }
  const dir = [dx / l, 0, dz / l];
  const start = [p.p[0] - dir[0] * 1.5, 0, p.p[2] - dir[2] * 1.5];
  const st = { id: nextFxId++, owner: p.id, p: start, dir, at: now() + STAMP.telegraph, spawned: 0 };
  stampedes.set(st.id, st);
  p.yaw = Math.atan2(dir[0], dir[2]);
  broadcast({ t: 'stampede', id: st.id, owner: p.id, p: start, dir, left: STAMP.telegraph, width: STAMP.width, length: STAMP.length });
}
function updateStampedes(t) {
  for (const st of [...stampedes.values()]) {
    const due = Math.min(STAMP.rams, Math.floor((t - st.at) / (STAMP.spread / (STAMP.rams - 1))) + 1);
    while (t >= st.at && st.spawned < due) {
      const side = (Math.random() - 0.5) * (STAMP.width - 1.2), back = Math.random() * 1.5;
      const x = st.p[0] - st.dir[2] * side - st.dir[0] * back, z = st.p[2] + st.dir[0] * side - st.dir[2] * back;
      summonRam({ x, z, yaw: Math.atan2(st.dir[0], st.dir[2]), ownerId: st.owner, mode: 'charge', maxTime: (STAMP.length + back) / G_.chargeSpeed });
      st.spawned++;
    }
    if (st.spawned >= STAMP.rams) { stampedes.delete(st.id); broadcast({ t: 'stampedeEnd', id: st.id }); }
  }
}

// ---------------------------------------------------------------- ultimates (Q)
// Charge is server-authoritative (C.ULT_CHARGE): damage dealt, a passive trickle, kills, and whatever a game
// mode adds (match.js calls ctx.addUltCharge; a negative amount takes charge away, e.g. a reset).
function addUltCharge(p, pct) {
  if (!p || !Number.isFinite(pct)) return;
  p.ult = clamp(p.ult + pct, 0, C.ULT_CHARGE.max);
}
// An ultimate in progress ends early (death, respawn, a wizard switch). Cataclysm meteors already falling still land.
function endUltimates(p) {
  if (p.eye) { p.eye = null; broadcast({ t: 'eyeEnd', id: p.id }); }
  if (p.zero) { p.zero = null; broadcast({ t: 'zeroCancel', id: p.id }); }
}
const strikePublic = (s) => ({ id: s.id, p: [s.x, 0, s.z], left: Math.max(0, s.at - now()) });
// Everyone in sight of `from` (pillars, trees, buildings and ice walls block it).
const inSight = (from, q) => !C.pillarBlocks(from, q.p, 0);
const outward = (from, q) => { const dx = q.p[0] - from[0], dz = q.p[2] - from[2], l = Math.hypot(dx, dz); return l > 0.05 ? [dx / l, 0, dz / l] : [Math.sin(q.yaw), 0, Math.cos(q.yaw)]; };

// Spells and ultimates that crush an area break the props in it, pop enemy decoys and stir the goats.
function crushArea(ownerId, x, z, r) {
  const owner = players.get(ownerId);
  for (const d of [...decoys.values()]) if (d.owner !== ownerId && enemies(owner, players.get(d.owner)) && Math.hypot(d.p[0] - x, d.p[2] - z) < r) endDecoy(d, true);
  for (const prop of props.values()) {
    if (prop.state !== 'idle') continue;
    if (Math.hypot(prop.x - x, prop.z - z) < r + C.PROP_TYPES[prop.type].r * 0.5) breakProp(prop, [prop.x, C.PROP_TYPES[prop.type].h * 0.5, prop.z]);
  }
  for (const g of allGoats()) {
    if (g.holder === ownerId || g.owner === ownerId || Math.hypot(g.x - x, g.z - z) > r + C.GOAT.radius * 0.5) continue;
    stirGoat(g, ownerId);
  }
}

// Cinder, Cataclysm: meteors on random, spread-out spots inside the circle, landing one after another.
function castCataclysm(p, at) {
  const t = now();
  let [x, z] = at;
  const d = Math.hypot(x - p.p[0], z - p.p[2]);
  if (d > CATA.range) { x = p.p[0] + (x - p.p[0]) * CATA.range / d; z = p.p[2] + (z - p.p[2]) * CATA.range / d; }
  const r = Math.hypot(x, z);
  if (r > C.ARENA_RADIUS) { x *= C.ARENA_RADIUS / r; z *= C.ARENA_RADIUS / r; }
  const spots = [];
  for (let i = 0; i < CATA.meteors; i++) {
    let best = null, bestGap = -1;
    for (let k = 0; k < 12; k++) {   // the candidate farthest from the others: spread out, but random
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * (CATA.radius - CATA.impact * 0.5);
      const c = [x + Math.sin(a) * rr, z + Math.cos(a) * rr];
      const gap = Math.min(Infinity, ...spots.map(s => Math.hypot(s[0] - c[0], s[1] - c[1])));
      if (gap > bestGap) { bestGap = gap; best = c; }
    }
    spots.push(best);
  }
  const out = spots.map(([sx, sz], i) => {
    const s = { id: nextFxId++, owner: p.id, x: sx, z: sz, cx: x, cz: z, at: t + CATA.warn + i * CATA.spread / (CATA.meteors - 1) };
    strikes.set(s.id, s);
    return strikePublic(s);
  });
  broadcast({ t: 'cataclysm', id: p.id, p: [x, 0, z], strikes: out });
}
function meteorImpact(s) {
  strikes.delete(s.id);
  const at = [s.x, 0, s.z];
  const hits = [];
  for (const q of players.values()) {
    if (q.dead || q.id === s.owner || !enemyOf(s.owner, q) || q.p[1] > CATA.height || dist2D(q.p, at) > CATA.impact + C.PLAYER_RADIUS) continue;
    const { dmg } = applyHit(q, { kind: 'cataclysm', owner: s.owner, v: outward(at, q) });
    hits.push({ id: q.id, dmg });
  }
  crushArea(s.owner, s.x, s.z, CATA.impact);
  broadcast({ t: 'meteorHit', id: s.id, p: at, hits });
}

// Gale, Eye of the Storm: a tornado for EYE.duration. Ticks damage and pulls enemies in; the end flings them out.
function eyeVictims(p) {
  return [...players.values()].filter(q => q !== p && !q.dead && enemies(p, q)
    && dist2D(q.p, p.p) < EYE.radius + C.PLAYER_RADIUS && Math.abs(q.p[1] - p.p[1]) < EYE.height && !wallBetween(p.p, q.p));
}
function updateEye(p, t) {
  const e = p.eye;
  if (t >= e.nextPull) {
    // the pull: bots are moved by the server, clients move themselves along the vector they're sent
    e.nextPull = t + 0.1;
    const pulls = [];
    for (const q of eyeVictims(p)) {
      if (isVeiled(q) || isRooted(q)) continue;
      const dx = p.p[0] - q.p[0], dz = p.p[2] - q.p[2], l = Math.hypot(dx, dz);
      if (l < 1.2) continue;   // already in the eye
      const v = [dx / l * EYE.pull, dz / l * EYE.pull];
      q.pulledUntil = t + 0.3;
      if (q.bot) botPull(q, v, t + 0.15); else pulls.push({ id: q.id, v });
    }
    if (pulls.length) broadcast({ t: 'eyePull', id: p.id, pulls });
  }
  if (t >= e.nextTick && t < e.until) {
    e.nextTick += EYE.tick;
    const hits = [];
    for (const q of eyeVictims(p)) { const { dmg } = applyHit(q, { kind: 'eye_of_storm', owner: p.id, v: outward(p.p, q) }); hits.push({ id: q.id, dmg }); }
    crushArea(p.id, p.p[0], p.p[2], 2.2);
    if (hits.length) broadcast({ t: 'eyeTick', id: p.id, hits });
  }
  if (t >= e.until) {
    p.eye = null;
    const hits = [];
    for (const q of eyeVictims(p)) { const { dmg } = applyHit(q, { kind: 'eye_burst', owner: p.id, v: outward(p.p, q) }); hits.push({ id: q.id, dmg }); }
    crushArea(p.id, p.p[0], p.p[2], EYE.radius * 0.6);
    broadcast({ t: 'eyeBurst', id: p.id, p: p.p, hits });
    broadcast({ t: 'eyeEnd', id: p.id });
  }
}

// Rime, Absolute Zero: after the flare, everyone in sight within the radius is crushed and frozen.
function zeroBlast(p) {
  p.zero = null;
  const from = [p.p[0], p.p[1] + C.HIT_CENTER_Y, p.p[2]];
  const hits = [];
  for (const q of players.values()) {
    if (q === p || q.dead || !enemies(p, q)) continue;
    const c = [q.p[0], q.p[1] + C.HIT_CENTER_Y, q.p[2]];
    if (Math.hypot(c[0] - from[0], c[1] - from[1], c[2] - from[2]) > ZERO.radius + C.PLAYER_RADIUS || !inSight(p.p, q)) continue;
    const { dmg } = applyHit(q, { kind: 'absolute_zero', owner: p.id, v: outward(p.p, q) });
    hits.push({ id: q.id, dmg });
  }
  for (const d of [...decoys.values()]) if (enemyOf(p.id, players.get(d.owner)) && dist2D(d.p, p.p) < ZERO.radius && !C.pillarBlocks(p.p, d.p, 0)) endDecoy(d, true);
  for (const g of allGoats()) if (g.owner !== p.id && Math.hypot(g.x - p.p[0], g.z - p.p[2]) < ZERO.radius && !C.pillarBlocks(p.p, [g.x, 0, g.z], 0)) { if (g.summoned) stirGoat(g, p.id); else Goats.dizzyGoat?.(g, goatCtx); }
  broadcast({ t: 'zeroBlast', id: p.id, p: p.p, hits });
}

// Vesper, Night Cage: a ring that enemies can't cross for CAGE.duration. Those inside at the cast stay in; everyone
// else stays out. Vesper and her teammates cross freely; spells pass through. Flying over it (above CAGE.flyOver) is allowed.
const cagePublic = (c) => ({ id: c.id, owner: c.owner, p: [c.x, 0, c.z], left: Math.max(0, c.until - now()), inside: [...c.inside], foes: [...c.foes] });
function castNightCage(p, at) {
  let [x, z] = at;
  const d = Math.hypot(x - p.p[0], z - p.p[2]);
  if (d > CAGE.range) { x = p.p[0] + (x - p.p[0]) * CAGE.range / d; z = p.p[2] + (z - p.p[2]) * CAGE.range / d; }
  const r = Math.hypot(x, z);
  if (r > C.ARENA_RADIUS) { x *= C.ARENA_RADIUS / r; z *= C.ARENA_RADIUS / r; }
  const c = { id: nextFxId++, owner: p.id, x, z, until: now() + CAGE.duration, inside: new Set(), foes: new Set() };
  for (const q of players.values()) {
    if (q === p || !enemies(p, q)) continue;
    c.foes.add(q.id);
    if (!q.dead && Math.hypot(q.p[0] - x, q.p[2] - z) < CAGE.radius) c.inside.add(q.id);
  }
  cages.set(c.id, c);
  broadcast({ t: 'cage', ...cagePublic(c) });
}
// Keep `q` on its side of every enemy cage (after any move). Returns true if it was pushed back.
function cageKeep(q) {
  let moved = false;
  for (const c of cages.values()) {
    if (q.dead || !enemyOf(c.owner, q)) continue;
    if (q.p[1] > CAGE.flyOver) {
      // over the top: whichever side it comes down on is its side now
      const inNow = Math.hypot(q.p[0] - c.x, q.p[2] - c.z) < CAGE.radius;
      if (inNow !== c.inside.has(q.id)) { inNow ? c.inside.add(q.id) : c.inside.delete(q.id); broadcast({ t: 'cageSide', id: c.id, pid: q.id, inside: inNow }); }
      continue;
    }
    if (C.cageClamp(q.p, c, c.inside.has(q.id))) moved = true;
  }
  return moved;
}
function updateCages(t) {
  for (const c of [...cages.values()]) {
    if (t >= c.until) { cages.delete(c.id); broadcast({ t: 'cageEnd', id: c.id }); continue; }
    for (const q of players.values()) if (q.bot || q.p[1] > CAGE.flyOver) cageKeep(q);   // humans: in their state updates
  }
}

// Q: cast the wizard's ultimate. Needs a full charge; spends all of it.
function castUltimate(p, msg) {
  const t = now();
  const U = kit(p).ultimate;
  const free = canAct(p) && !p.charging && !p.cyclone && !p.lash && !holding(p) && !unstoppable(p);
  const refuse = () => send(p.id, { t: 'ultRefused' });
  if (!U || p.ult < C.ULT_CHARGE.max || !free || isAirborne(p)) return refuse();
  if (U === 'cataclysm') {
    if (!Array.isArray(msg.at) || msg.at.length < 2 || !Number.isFinite(msg.at[0]) || !Number.isFinite(msg.at[msg.at.length - 1])) return refuse();
    castCataclysm(p, [msg.at[0], msg.at[msg.at.length - 1]]);
  } else if (U === 'eye_of_storm') {
    p.eye = { until: t + EYE.duration, nextTick: t + EYE.tick * 0.5, nextPull: t };
    broadcast({ t: 'eyeStart', id: p.id, left: EYE.duration });
  } else if (U === 'absolute_zero') {
    p.zero = { at: t + ZERO.windup };
    p.rootUntil = Math.max(p.rootUntil, p.zero.at);
    broadcast({ t: 'zeroStart', id: p.id, p: p.p, left: ZERO.windup });
  } else if (U === 'stampede') {
    if (!Array.isArray(msg.at) || msg.at.length < 2 || !Number.isFinite(msg.at[0]) || !Number.isFinite(msg.at[msg.at.length - 1])) return refuse();
    castStampede(p, [msg.at[0], msg.at[msg.at.length - 1]]);
  } else if (U === 'night_cage') {
    if (!Array.isArray(msg.at) || msg.at.length < 2 || !Number.isFinite(msg.at[0]) || !Number.isFinite(msg.at[msg.at.length - 1])) return refuse();
    castNightCage(p, [msg.at[0], msg.at[msg.at.length - 1]]);
  } else return refuse();
  p.ult = 0;
  if (p.blocking) { p.blocking = false; p.blockReleasedAt = t; }
  broadcast({ t: 'ult', id: p.id, ult: U });
}

// ---------------------------------------------------------------- simulation
function simulate(dt) {
  const t = now();
  updateBots(dt, world);
  updateGoats(goats, dt, goatCtx);
  match.tick(dt);
  updateDecoys(dt, t);
  for (const w of [...walls.values()]) if (t >= w.until) wallDown(w, true);
  for (const f of [...frostfalls.values()]) if (t >= f.at) frostfallImpact(f);
  for (const c of [...smokes.values()]) if (t >= c.until) smokes.delete(c.id);   // clients fade it on their own clock
  for (const st of [...strikes.values()]) if (t >= st.at) meteorImpact(st);
  updateCages(t);
  updateFirewalls(t);
  updateRams(dt, t);
  updateStampedes(t);
  for (const w of walls.values()) bulwarkTouch(w, t);

  for (const p of players.values()) {
    if (p.dead) {
      if (t >= p.respawnAt) respawn(p);
      continue;
    }
    // ultimates: the passive charge, and whichever one is running
    p.ult = Math.min(C.ULT_CHARGE.max, p.ult + C.ULT_CHARGE.passive * dt);
    if (p.eye) updateEye(p, t);
    if (p.ride) updateRide(p, t);
    if (p.zero && t >= p.zero.at) zeroBlast(p);
    // stamina
    if (p.blocking) {
      p.st -= C.STAMINA_DRAIN_BLOCKING * (C.SPELLBOOK[kit(p).guard]?.drainMul ?? 1) * dt;
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
    const before = proj.p.slice();
    if (proj.curve) {
      // Hex Shards: along the Bézier the client draws too
      const at = C.hexAt(proj.curve, age);
      proj.p = at.p; proj.v = at.v;
    } else {
      proj.v[1] -= proj.g * dt;
      proj.p[0] += proj.v[0] * dt; proj.p[1] += proj.v[1] * dt; proj.p[2] += proj.v[2] * dt;
    }

    // an enemy Firewall burns it up
    if (firewalls.size && firewallCrossed(proj.owner, before, proj.p, Math.min(proj.radius, 0.6))) {
      endProjectile(proj, true, { surface: 'firewall' });
      continue;
    }
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
    const shooter = players.get(proj.owner);
    for (const pl of players.values()) {
      if (pl.dead || !pl.carrying || pl.id === proj.owner || !enemies(shooter, pl)) continue;
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
    for (const g of allGoats()) {
      if (g.holder && g.holder === proj.owner) continue;
      // Jeb's rams: a guard ram absorbs an enemy's shot and charges the shooter; other summoned rams let shots through
      if (g.summoned && (g.owner === proj.owner || !enemyOf(g.owner, shooter) || !(g.state === 'orbit' || g.mode === 'orbit'))) continue;
      // (a guard ram catches a little wider than its body: three of them have a whole circle to cover)
      const catchR = C.GOAT.radius + proj.radius + (g.summoned ? 0.35 : 0);
      if (Math.hypot(proj.p[0] - g.x, proj.p[1] - ((g.y || 0) + C.GOAT.hitY), proj.p[2] - g.z) < catchR) {
        if (g.summoned) ramProvoked(g, proj.owner);
        else angerGoat(g, proj.owner, goatCtx);
        endProjectile(proj, true, { surface: 'goat', goat: g.id });
        done = true; break;
      }
    }
    if (done) continue;

    // players (a lash pierces: it hits each wizard on its path once, unless a ward stops it)
    for (const pl of players.values()) {
      if (pl.dead || pl.id === proj.owner || !enemies(shooter, pl)) continue;   // teammates: it flies through
      if (proj.pierce && proj.hitIds.has(pl.id)) continue;
      const c = [pl.p[0], pl.p[1] + C.HIT_CENTER_Y, pl.p[2]];
      const d = Math.hypot(proj.p[0] - c[0], proj.p[1] - c[1], proj.p[2] - c[2]);
      if (d < C.HIT_RADIUS + proj.radius) {
        const { blocked, dmg: dealt } = applyHit(pl, proj);
        if (proj.kind === 'sling' && !blocked && dealt > 0 && shooter && !pl.dead) callRamOn(pl, shooter);   // Shepherd's Sling
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
// Gale's tornado and Rime's flare: nothing else can be cast meanwhile (Gale can still move).
const ULT_LOCKED = new Set(['ult', 'ram', 'ramGuard', 'ride', 'block', 'cast', 'chargeStart', 'cyclone', 'lashStart', 'frostfall', 'smoke', 'mirror', 'veil', 'bulwark', 'firewall', 'curse', 'skyward', 'teleport', 'pickup', 'throw', 'reload']);
function handle(p, msg) {
  const t = now();
  if ((unstoppable(p) || p.ride) && ULT_LOCKED.has(msg.t)) return;   // a tornado, a rune flare or a ram ride: nothing else
  switch (msg.t) {
    case 'ult': {
      castUltimate(p, msg);
      break;
    }
    case 'debugCharge': {
      // tests only (WA_DEBUG=1): a full ultimate charge
      if (process.env.WA_DEBUG) p.ult = C.ULT_CHARGE.max;
      break;
    }
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
      const run = C.backpedalSpeed(C.speedOf(p.wizard) * (p.eye ? EYE.speedMul : 1), np[0] - p.p[0], np[2] - p.p[2], Number.isFinite(msg.yaw) ? msg.yaw : p.yaw)
        + (p.pulledUntil > t ? EYE.pull : 0);   // dragged by an Eye of the Storm
      const maxStep = ((dashing ? SMOKE.distance / SMOKE.dashTime : galloping(p, t) ? RIDE.speed + 1 : run) + C.SPELLS.heavy.knockback + 2) * dt + 0.6;
      if (p.lastStateAt && d > maxStep && !p.justTeleported) {
        // Moving faster than any legitimate wizard can: let the server's copy catch up at the
        // maximum plausible speed instead of snapping (so a laggy-but-honest client converges).
        const k = maxStep / d;
        p.p = [p.p[0] + (np[0] - p.p[0]) * k, np[1], p.p[2] + (np[2] - p.p[2]) * k];
      } else {
        p.p = np;
      }
      cageKeep(p);   // a Night Cage: the client keeps itself on its side too; this is the check
      p.justTeleported = false;
      p.lastStateAt = t;
      if (Number.isFinite(msg.yaw)) p.yaw = msg.yaw;
      if (typeof msg.anim === 'string' && msg.anim.length < 16) p.anim = msg.anim;
      break;
    }
    case 'block': {
      const on = !!msg.on;
      if (on && (!C.isWard(kit(p).guard) || !canAct(p) || p.st <= 2 || p.charging || p.cyclone || p.lash || isAirborne(p))) break;
      if (p.blocking && !on) p.blockReleasedAt = t;
      p.blocking = on;
      break;
    }
    case 'cast': {
      if (!canAct(p) || p.blocking || p.charging || p.cyclone || p.lash || holding(p)) break;
      const primary = kit(p).primary, kind = C.PRIMARY_KIND[primary];
      if (t < p.cd.fast || t < p.reloadUntil || p.ammo <= 0) break;   // reloading: refused
      if (msg.kind !== kind) break;
      // the last round of the magazine is the finisher; firing it starts the reload
      const shot = C.primaryMag(primary).magazine - p.ammo;   // 0, 1, 2
      const fin = p.ammo === 1;
      p.ammo--; p.lastShotAt = t;
      if (p.ammo === 0) p.reloadUntil = t + C.primaryMag(primary).reload;
      p.cd.fast = t + C.SPELLBOOK[primary].cooldown;
      if (kind === 'skim') {
        // three shards in a tight fan, skimming the ground just ahead of the caster's feet
        const d = sanitizeDir([msg.dir?.[0] ?? 0, 0, msg.dir?.[2] ?? 0], p);
        const base = Math.atan2(d[0], d[2]);
        for (let i = 0; i < SKIM.shards; i++) {
          const a = base + (i - (SKIM.shards - 1) / 2) * SKIM.spreadDeg * Math.PI / 180;
          const dir = [Math.sin(a), 0, Math.cos(a)];
          spawnProjectile(p, 'skim', [p.p[0] + dir[0] * 0.5, C.SPELLS.skim.height, p.p[2] + dir[2] * 0.5], dir, null, fin);
        }
      } else if (kind === 'hex') {
        // a curved glyph to the aim point: from the left, from the right, then a lob
        const origin = sanitizeOrigin(p, msg.origin);
        const dir = sanitizeDir(msg.dir, p);
        let to = validVec(msg.target) ? msg.target.slice() : [origin[0] + dir[0] * 20, origin[1] + dir[1] * 20, origin[2] + dir[2] * 20];
        const H = C.SPELLS.hex;
        let dd = Math.hypot(to[0] - origin[0], to[1] - origin[1], to[2] - origin[2]);
        if (dd > H.range) { const k = H.range / dd; to = to.map((v, k2) => origin[k2] + (v - origin[k2]) * k); dd = H.range; }
        if (dd < 3) to = [origin[0] + dir[0] * 3, origin[1] + dir[1] * 3, origin[2] + dir[2] * 3];
        to[1] = Math.max(0.4, to[1]);
        const curve = { ...C.hexCurve(origin, to, shot), shot };
        spawnProjectile(p, 'hex', origin, dir, null, fin, curve);
      } else {
        spawnProjectile(p, kind, sanitizeOrigin(p, msg.origin), sanitizeDir(msg.dir, p), null, fin);
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
      const whip = spawnProjectile(p, 'lash', sanitizeOrigin(p, msg.origin), sanitizeDir(msg.dir, p));
      // what Black Death absorbed rides on this whip
      if (p.lashBonus) { whip.dmg = C.SPELLS.lash.damage + Math.round(p.lashBonus); p.lashBonus = 0; }
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
      cageKeep(p);
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
    case 'ram': {
      // Battering Ram: straight along the aim from just in front of Jeb
      if (kit(p).power !== 'battering_ram' || !canAct(p) || p.blocking || p.charging || p.cyclone || p.lash || holding(p) || isAirborne(p) || t < p.cd.power) break;
      const d = sanitizeDir([msg.dir?.[0] ?? 0, 0, msg.dir?.[2] ?? 0], p);
      const yaw = Math.atan2(d[0], d[2]);
      p.cd.power = t + BRAM.cooldown;
      p.yaw = yaw;
      summonRam({ x: p.p[0] + d[0] * BRAM.spawnDist, z: p.p[2] + d[2] * BRAM.spawnDist, yaw, ownerId: p.id, mode: 'charge', maxTime: BRAM.maxTime });
      broadcast({ t: 'batteringRam', id: p.id, yaw });
      break;
    }
    case 'ramGuard': {
      if (kit(p).guard !== 'ram_guard' || !canAct(p) || t < p.cd.guard) break;
      p.cd.guard = t + RGUARD.cooldown;
      p.ramGuardUntil = t + RGUARD.life;
      for (let i = 0; i < RGUARD.count; i++) {
        const a = i / RGUARD.count * Math.PI * 2;
        const r = summonRam({ x: p.p[0] + Math.sin(a) * RGUARD.radius, z: p.p[2] + Math.cos(a) * RGUARD.radius, yaw: a + Math.PI / 2, ownerId: p.id, mode: 'orbit', angle: a,
          radius: RGUARD.radius, lap: RGUARD.lap, maxTime: RGUARD.life });
        if (r && rams.includes(r)) r.until = t + RGUARD.life;
      }
      broadcast({ t: 'ramGuard', id: p.id, left: RGUARD.life });
      break;
    }
    case 'ride': {
      if (kit(p).mobility !== 'ram_ride' || !canAct(p) || isRooted(p) || p.charging || p.cyclone || p.lash || holding(p) || isAirborne(p) || t < p.cd.mobility) break;
      p.cd.mobility = t + RIDE.cooldown;
      startRide(p, Number.isFinite(msg.yaw) ? msg.yaw : p.yaw);
      break;
    }
    case 'firewall': {
      if (kit(p).guard !== 'firewall' || !canAct(p) || p.charging || p.cyclone || p.lash || isAirborne(p) || t < p.cd.guard) break;
      p.cd.guard = t + FIREWALL.cooldown;
      raiseFirewall(p, Number.isFinite(msg.yaw) ? msg.yaw : p.yaw);
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
      cageKeep(p);   // a blink can't cross a Night Cage (the client clamps its landing the same way)
      if (p.blocking) { p.blocking = false; p.blockReleasedAt = t; }
      broadcast({ t: 'tp', id: p.id, from, to: p.p });
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
      else if (best.cursedBy && enemyOf(best.cursedBy, p)) best.trap = p.id;   // a teammate's trap doesn't go off on us
      best.state = 'lifting'; best.carrier = p.id; best.liftUntil = t + C.TK.liftTime;
      p.carrying = best.id;
      broadcast({ t: 'prop', prop: propPublic(best) });
      match.onPickup(p, best);
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
      if (prop && !match.canThrow(p, prop)) { dropProp(p, false, 'released'); break; }   // a game mode may forbid hurling something (none does now)
      p.carrying = null;
      if (prop) match.onDrop(p, prop, 'thrown');
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
    default:
      match.handle(p, msg);
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
  match.onJoin(p);
  { const msp = match.spawnPointFor(p); if (msp) p.p = [msp[0], 0, msp[2]]; }
  broadcast({ t: 'joined', player: playerPublic(p) });
  console.log(`[+] bot ${name} (${difficulty}, ${p.wizard}) joined. ${players.size} online`);
}

function removePlayer(id) {
  const p = players.get(id);
  if (!p) return;
  match.onLeave(p);
  if (p.carrying) dropProp(p, false);
  if (p.carryingGoat) { const g = goatById(p.carryingGoat); p.carryingGoat = null; if (g && g.holder === p.id) Goats.releaseGoat?.(g, goatCtx); }
  clearCurse(p);
  for (const d of [...decoys.values()]) if (d.owner === id) endDecoy(d, false);
  players.delete(id); sockets.delete(id);
  broadcast({ t: 'leave', id });
}

// cycloneStopsGoats: the goat module can knock a charging goat dizzy (bots then answer a charge with a cyclone)
const world = { players, props, projectiles, goats, decoys, walls, frostfalls, smokes, strikes, cages, firewalls, rams, stampedes, handle, now, cycloneStopsGoats: !!Goats.dizzyGoat };
// Game modes (server/match.js, modes agent). addUltCharge is the spells agent's to implement.
const match = createMatch({
  players, props, now, broadcast, send, propPublic,
  addBot: (...a) => addBot(...a), removePlayer: (id) => removePlayer(id), respawn: (p) => respawn(p),
  addUltCharge: (p, pct) => addUltCharge(p, pct),
  resetUlt: (p) => { p.ult = 0; },
  // goats back in the pen, calm (nobody holds one any more)
  resetGoats: () => {
    for (const p of players.values()) p.carryingGoat = null;
    goats.splice(0, goats.length, ...createGoats());
  },
});
world.match = match;
const goatCtx = {
  players, props, now, broadcast, goats,
  isEnemy: (a, b) => enemies(a, b),   // Jeb's rams pass their owner and his team
  breakProp,
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
      if (g.summoned || !Goats.canLift?.(g)) continue;
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
      if (['easy', 'normal', 'hard'].includes(msg.difficulty)) p.botPref = msg.difficulty;   // team modes fill bots at this
      players.set(id, p);
      sockets.set(id, ws);
      match.onJoin(p);
      { const sp = match.spawnPointFor(p); if (sp) p.p = [sp[0], 0, sp[2]]; }
      ws.send(JSON.stringify({
        t: 'welcome', id,
        players: [...players.values()].map(playerPublic),
        props: [...props.values()].map(propPublic),
        goats: [...goats.map(goatPublic), ...rams.map(ramPublic)],
        stampedes: [...stampedes.values()].map(st => ({ id: st.id, owner: st.owner, p: st.p, dir: st.dir, left: Math.max(0, st.at - now()), width: STAMP.width, length: STAMP.length })),
        projectiles: [...projectiles.values()].map(pr => ({ id: pr.id, kind: pr.kind, owner: pr.owner, propType: pr.propType, p: pr.p, v: pr.v, g: pr.g, r: pr.radius, life: pr.life - (now() - pr.born) })),
        walls: [...walls.values()].map(wallPublic),
        frostfalls: [...frostfalls.values()].map(frostPublic),
        smokes: [...smokes.values()].map(smokePublic),
        strikes: [...strikes.values()].map(strikePublic),
        cages: [...cages.values()].map(cagePublic),
        firewalls: [...firewalls.values()].map(firewallPublic),
        decoys: [...decoys.values()].map(decoyPublic),
        ...match.welcomeExtras(p),
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
  broadcast({ t: 'snap', time: now(), players: [...players.values()].map(playerPublic), goats: rams.length ? [...goats.map(goatPublic), ...rams.map(ramPublic)] : goats.map(goatPublic), decoys: [...decoys.values()].map(decoyPublic), ...match.snapshotExtras() });
}, 1000 / C.SNAPSHOT_RATE);

httpServer.listen(PORT, () => console.log(`Wizard Arena listening on http://localhost:${PORT}`));
