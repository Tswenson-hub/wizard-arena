// Server-side AI wizards for practice.
// A bot is a normal player record with a `bot` brain attached. It moves itself (the server owns its
// position, the way a client owns its own) and acts only by calling handle() with the same messages
// a client sends, so every cooldown, stamina cost and rule applies to it unchanged.

import * as C from '../public/shared/constants.js';

export const BOT_LIMIT = 6;
const THINK_DT = 1 / 20;   // AI update rate

// Everything that separates an Easy bot from a Hard one.
const DIFFICULTY = {
  easy: {
    react: 0.45,        // seconds before it responds to something it sees
    aimErr: 7,          // degrees of random aim error
    lead: 0,            // fraction of target movement it leads
    dodge: 0.25,        // chance it tries to avoid an incoming threat
    blinkDodge: false,
    think: 1 / 1.5,     // seconds between offensive decisions
    speed: 0.8,         // fraction of full run speed
    range: [7, 13],     // preferred distance to its target
    aggression: 0.55,   // chance per decision to attack when it can
    tk: 0.06,           // chance per decision to lift a prop when one is handy
    punish: 0.25,       // chance it spots and punishes a meteor wind-up
    goatAware: false,   // checks for goats in its line of fire (Easy bots anger them by accident)
    fooled: 0.5,        // chance it goes after a Mirror Step decoy instead of the real wizard
    saveFinisher: 0,    // chance it holds the magazine's last (interrupting) shot for an enemy wind-up
    relicMemory: false, // stops re-lifting a prop that just blew up on it
  },
  normal: {
    react: 0.25, aimErr: 3.5, lead: 0.6, dodge: 0.6, blinkDodge: true,
    think: 1 / 3, speed: 0.95, range: [8, 14], aggression: 0.8, tk: 0.12, punish: 0.7, goatAware: true,
    fooled: 0.3, relicMemory: false, saveFinisher: 0.5,
  },
  hard: {
    react: 0.12, aimErr: 1.2, lead: 1, dodge: 0.9, blinkDodge: true,
    think: 1 / 6, speed: 1, range: [9, 15], aggression: 0.95, tk: 0.1, punish: 1, goatAware: true,
    fooled: 0.15, relicMemory: true, saveFinisher: 0.9,
  },
};

const CYC = C.SPELLBOOK.cyclone, SKY = C.SPELLBOOK.skyward, LASH = C.SPELLBOOK.sanguine_lash;
const BULWARK = C.SPELLBOOK.glacial_bulwark, SKIM = C.SPELLS.skim, RELIC = C.SPELLBOOK.trapped_relic, FROST = C.SPELLBOOK.frostfall;
const SMOKE = C.SPELLBOOK.smoke_screen;
let clouds = [];   // Smoke Screen clouds this tick: nobody sees into, out of or through them
const kit = (q) => C.kitOf(q.wizard);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (a, b) => a + Math.random() * (b - a);
const dist2D = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.75;   // ~N(0,1), cheap

export function createBot(difficulty) {
  return {
    difficulty,
    cfg: DIFFICULTY[difficulty] || DIFFICULTY.normal,
    slowFall: false,             // "holding E" during the current Skyward Flash
    acc: Math.random() * THINK_DT,
    vel: [0, 0],                 // movement velocity (x, z), includes knockback
    nextThink: 0,
    strafe: Math.random() < 0.5 ? 1 : -1, strafeUntil: 0,
    dodgeVec: null, dodgeUntil: 0,
    blockUntil: 0,
    chargeFireAt: 0,
    holdSince: 0,
    targetId: null, retargetAt: 0,
    threats: new Map(),          // projectile id -> { seenAt, react, handled, ignore }
    chargeSeen: new Map(),       // enemy id -> time we noticed their meteor wind-up
    lashFireAt: 0,               // our own Sanguine Lash: when to let it go
    decoyId: null,               // the Mirror Step decoy we were fooled into chasing
    seenDecoys: new Set(),
    burned: new Map(),           // prop id -> time a Trapped Relic blew up on us (Hard bots remember)
    nextCurse: 0,
    stuckT: 0, lastPos: null,
  };
}

// Knockback from hits (clients apply this to themselves; the server does it for bots).
export function botKnockback(p, dir, kb) {
  p.bot.vel[0] += dir[0] * kb;
  p.bot.vel[1] += dir[2] * kb;
}

// Smoke Screen: the server moves a bot through its backward dash (clients do this themselves).
export function botDash(p, dir, until) {
  p.bot.dash = { dir, until };
}

// A Trapped Relic went off as this bot lifted it.
export function botNoteRelic(p, propId, t) {
  if (p.bot.cfg.relicMemory) p.bot.burned.set(propId, t);
}

// Smoothed velocity estimates for every wizard, used to lead shots.
const tracks = new Map();   // id -> { p, v, t }
function trackVelocities(players, t) {
  for (const q of players.values()) {
    let tr = tracks.get(q.id);
    if (!tr) { tracks.set(q.id, { p: q.p.slice(), v: [0, 0], vy: 0, t }); continue; }
    const dt = t - tr.t;
    if (dt < 0.03) continue;
    let vx = (q.p[0] - tr.p[0]) / dt, vz = (q.p[2] - tr.p[2]) / dt;
    const sp = Math.hypot(vx, vz);
    if (sp > C.MOVE_SPEED * 1.6) { vx = 0; vz = 0; }   // a blink or respawn, not real movement
    tr.v[0] += (vx - tr.v[0]) * 0.45; tr.v[1] += (vz - tr.v[1]) * 0.45;
    // airborne wizards fall at a known rate; a launch or a landing isn't a fall
    let vy = (q.p[1] - tr.p[1]) / dt;
    if (vy > 0 || vy < -SKY.dropSpeed * 1.5 || q.p[1] < 0.05) vy = 0;
    tr.vy += (vy - tr.vy) * 0.5;
    tr.p = q.p.slice(); tr.t = t;
  }
  for (const id of tracks.keys()) if (!players.has(id)) tracks.delete(id);
}

export function updateBots(dt, world) {
  const t = world.now();
  clouds = [...(world.smokes?.values() || [])].filter(c => t < c.until);
  let any = false;
  for (const p of world.players.values()) {
    if (!p.bot) continue;
    any = true;
    moveBot(p, dt, world, t);
    p.bot.acc += dt;
    if (p.bot.acc >= THINK_DT) { p.bot.acc -= THINK_DT; if (!p.dead) think(p, world, t); }
  }
  if (any) trackVelocities(world.players, t);
}

// ---------------------------------------------------------------- perception helpers
const chest = (q) => [q.p[0], q.p[1] + C.HIT_CENTER_Y, q.p[2]];
const isStunned = (q, t) => q.stunUntil > t;
const canAct = (q, t) => !q.dead && !isStunned(q, t) && !(q.silenceUntil > t);
const rooted = (q, t) => q.rootUntil > t;
const airborne = (q, t) => q.flightUntil > t || q.p[1] > 0.05;
const cycloneWindingUp = (q) => q.cyclone && !q.cyclone.pulsed;
const mobilityReady = (me, t) => t >= me.cd.mobility && !airborne(me, t) && !rooted(me, t);
const veiled = (q, t) => q.veilUntil > t;
const veilReady = (me, t) => kit(me).guard === 'tempest_veil' && t >= me.cd.guard && !veiled(me, t);
const wallReady = (me, t) => kit(me).guard === 'glacial_bulwark' && t >= me.cd.guard && !airborne(me, t);
const busyCasting = (q) => q.charging || !!q.lash || cycloneWindingUp(q);
// the primary can fire now (cooldown, and the magazine isn't reloading)
const primaryReady = (me, t) => t >= me.cd.fast && !(me.reloadUntil > t) && me.ammo > 0;

// A decoy seen as a target: shaped enough like a player for aiming and movement.
function decoyTarget(d, owner) {
  return {
    id: 'decoy' + d.id, decoy: d.id, p: d.p, yaw: d.yaw, vel: [d.dir[0] * C.speedOf(owner.wizard), d.dir[2] * C.speedOf(owner.wizard)],
    hp: owner.hp, st: owner.st, dead: false, flightUntil: 0, stunUntil: 0, blocking: false, charging: false, cyclone: null, lash: null,
  };
}

// Where to aim a projectile of `speed` (and `gravity`) so it meets `target`, leading by `lead`.
function aimAt(me, from, target, speed, gravity, cfg) {
  const tr = tracks.get(target.id);
  const v = tr ? tr.v : target.vel || [0, 0];
  const c = chest(target);
  // Solve |D + V t| = s t for the intercept time.
  const dx = c[0] - from[0], dz = c[2] - from[2];
  const a = v[0] * v[0] + v[1] * v[1] - speed * speed;
  const b = 2 * (dx * v[0] + dz * v[1]);
  const cc = dx * dx + dz * dz;
  let ti = Math.hypot(dx, dz) / speed;
  const disc = b * b - 4 * a * cc;
  if (Math.abs(a) > 1e-6 && disc >= 0) {
    const r1 = (-b - Math.sqrt(disc)) / (2 * a), r2 = (-b + Math.sqrt(disc)) / (2 * a);
    const best = Math.min(...[r1, r2].filter(r => r > 0));
    if (Number.isFinite(best)) ti = best;
  }
  const lead = cfg.lead * ti;
  // a falling target: predict its height, but it can't sink below the ground
  const vy = tr ? tr.vy : 0;
  let aim = [c[0] + v[0] * lead, Math.max(C.HIT_CENTER_Y, c[1] + vy * lead), c[2] + v[1] * lead];
  // keep a led point inside the arena
  const r = Math.hypot(aim[0], aim[2]);
  if (r > C.ARENA_RADIUS) { aim[0] *= C.ARENA_RADIUS / r; aim[2] *= C.ARENA_RADIUS / r; }
  let dir = gravity ? C.ballisticDir(from, aim, speed, gravity)
    : (() => { const d = [aim[0] - from[0], aim[1] - from[1], aim[2] - from[2]]; const l = Math.hypot(...d) || 1; return d.map(x => x / l); })();
  // human-ish error: rotate by a random yaw and pitch
  const ey = gauss() * cfg.aimErr * Math.PI / 180, ep = gauss() * cfg.aimErr * 0.4 * Math.PI / 180;
  const cy = Math.cos(ey), sy = Math.sin(ey);
  dir = [dir[0] * cy + dir[2] * sy, dir[1] + ep, -dir[0] * sy + dir[2] * cy];
  return dir;
}

// How an incoming projectile will pass us: time to closest approach and the miss distance then.
function threatOf(me, proj) {
  const c = chest(me);
  const rx = proj.p[0] - c[0], ry = proj.p[1] - c[1], rz = proj.p[2] - c[2];
  const vv = proj.v[0] ** 2 + proj.v[1] ** 2 + proj.v[2] ** 2 || 1;
  const tc = -(rx * proj.v[0] + ry * proj.v[1] + rz * proj.v[2]) / vv;
  if (tc <= 0) return null;
  const mx = rx + proj.v[0] * tc, my = ry + (proj.v[1] - proj.g * tc * 0.5) * tc, mz = rz + proj.v[2] * tc;
  return { tc, miss: Math.hypot(mx, my, mz) };
}

function yawTo(from, to) { return Math.atan2(to[0] - from[0], to[2] - from[2]); }

function hasLOS(a, b) { return !C.pillarBlocks(a, b, 0.25) && !C.smokeBlocks(a, b, clouds); }
const smokeHides = (a, b) => C.smokeBlocks(a, b, clouds);

// ---------------------------------------------------------------- decisions (20 Hz)
function think(me, world, t) {
  const b = me.bot, cfg = b.cfg;
  const act = (msg) => world.handle(me, msg);
  const free = canAct(me, t);
  const K = kit(me);

  // ---- target selection: who hurt us, who's weak, who's close; a small preference for humans
  // a target that vanished into smoke is lost: remember where, and pick someone we can see
  const cur = world.players.get(b.targetId);
  if (cur && !cur.dead && smokeHides(me.p, cur.p)) { b.lastSeen = cur.p.slice(); b.lastSeenUntil = t + 3; b.targetId = null; b.decoyId = null; }
  if (t >= b.retargetAt || !world.players.get(b.targetId) || world.players.get(b.targetId).dead) {
    let best = null, bs = Infinity;
    for (const q of world.players.values()) {
      if (q === me || q.dead || smokeHides(me.p, q.p)) continue;
      let s = dist2D(me.p, q.p) + q.hp * 0.06;
      if (q.id === me.lastHitBy) s -= 7;
      if (!q.bot) s -= 3;
      if (!hasLOS(me.p, q.p)) s += 6;
      if (s < bs) { bs = s; best = q; }
    }
    if (best?.id !== b.targetId) b.decoyId = null;
    b.targetId = best ? best.id : null;
    b.retargetAt = t + rand(1.5, 3);
  }
  let target = world.players.get(b.targetId) || null;

  // ---- Mirror Step: when our target splits three ways we may go after a decoy instead
  if (target) {
    const fresh = [...world.decoys.values()].filter(d => d.owner === target.id && !b.seenDecoys.has(d.id));
    if (fresh.length) {
      for (const d of fresh) b.seenDecoys.add(d.id);
      if (Math.random() < cfg.fooled) b.decoyId = pick(fresh).id;   // one roll per step
    }
  }
  for (const id of b.seenDecoys) if (!world.decoys.has(id)) b.seenDecoys.delete(id);
  if (b.decoyId) {
    const d = world.decoys.get(b.decoyId), o = d && world.players.get(d.owner);
    if (d && o) target = decoyTarget(d, o); else b.decoyId = null;
  }
  b.chase = target;
  const d = target ? dist2D(me.p, target.p) : Infinity;
  const los = target ? hasLOS(me.p, target.p) : false;

  // ---- defence: a charging goat is the deadliest thing in the arena
  let reacted = false;
  for (const g of world.goats) {
    const key = 'goat' + g.id;
    if (g.state !== 'charge') { b.threats.delete(key); continue; }
    const vx = Math.sin(g.yaw) * C.GOAT.chargeSpeed, vz = Math.cos(g.yaw) * C.GOAT.chargeSpeed;
    const rx = g.x - me.p[0], rz = g.z - me.p[2];
    const tc = -(rx * vx + rz * vz) / (C.GOAT.chargeSpeed ** 2);
    const miss = Math.hypot(rx + vx * tc, rz + vz * tc);
    const homing = g.target === me.id;
    if (tc <= 0 || tc > 1.2 || (!homing && miss > C.GOAT.radius + C.PLAYER_RADIUS + 0.6)) continue;
    let rec = b.threats.get(key);
    if (!rec) { rec = newThreat(cfg, t); b.threats.set(key, rec); }
    b.goatDanger = t + 0.3;
    if (rec.handled || rec.ignore || reacted || t < rec.seenAt + rec.react) continue;
    rec.handled = true; reacted = true;
    respondGoat(me, world, g, [vx, 0, vz], tc, t, act);
  }
  for (const id of b.threats.keys()) if (typeof id === 'number' && !world.projectiles.has(id)) b.threats.delete(id);
  // a hurled goat comes at us like a thrown prop
  const flyingGoats = world.goats.filter(g => g.state === 'flying' && g.thrower !== me.id).map(g => ({
    id: 'fg' + g.id, kind: 'prop', owner: g.thrower, radius: C.GOAT.radius, g: C.GOAT.throwGravity,
    p: [g.x, (g.y || 0) + C.GOAT.hitY, g.z], v: [g.vx || 0, g.vy || 0, g.vz || 0] }));
  for (const id of b.threats.keys()) if (typeof id === 'string' && id.startsWith('fg') && !flyingGoats.some(f => f.id === id)) b.threats.delete(id);
  for (const proj of [...world.projectiles.values(), ...flyingGoats]) {
    if (proj.owner === me.id) continue;
    const th = threatOf(me, proj);
    if (!th || th.tc > 1.6 || th.miss > C.HIT_RADIUS + proj.radius + 0.5) continue;
    let rec = b.threats.get(proj.id);
    if (!rec) { rec = newThreat(cfg, t); b.threats.set(proj.id, rec); }
    if (rec.handled || rec.ignore || reacted || t < rec.seenAt + rec.react) continue;
    rec.handled = true; reacted = true;
    respond(me, world, t, proj, th, act);
  }
  // an enemy spinning up a cyclone close by: get out of the radius (or up, out of reach)
  for (const q of world.players.values()) {
    const key = 'cyc' + q.id;
    if (q === me || q.dead || !cycloneWindingUp(q) || airborne(me, t) || dist2D(me.p, q.p) > CYC.radius + 0.5) { b.threats.delete(key); continue; }
    let rec = b.threats.get(key);
    if (!rec) { rec = newThreat(cfg, t); b.threats.set(key, rec); }
    if (rec.handled || rec.ignore || reacted || t < rec.seenAt + rec.react) continue;
    rec.handled = true; reacted = true;
    respondCyclone(me, q, t, act);
  }
  // an enemy Sanguine Lash winding up, pointed at us: wall it, ward it, or step off the line as it fires
  for (const q of world.players.values()) {
    const key = 'lash' + q.id;
    if (q === me || q.dead || !q.lash) { b.threats.delete(key); continue; }
    const dq = dist2D(me.p, q.p);
    if (dq > LASH_RANGE + 2 || !facingWithin(q, me.p, 25) || !hasLOS(q.p, me.p)) continue;
    let rec = b.threats.get(key);
    if (!rec) { rec = newThreat(cfg, t); b.threats.set(key, rec); }
    if (rec.ignore || t < rec.seenAt + rec.react) continue;
    if (!rec.plan) rec.plan = lashPlan(me, dq, t);
    runLashPlan(me, q, rec, q.lash.start + LASH.windup, dq, t, act);
  }

  // standing in a Frostfall shadow: walk out of the circle (or blink / flash / mirror out if there's no time)
  for (const k of b.threats.keys()) if (typeof k === 'string' && k.startsWith('frost') && !world.frostfalls?.has(+k.slice(5))) b.threats.delete(k);
  for (const f of world.frostfalls?.values() || []) {
    const key = 'frost' + f.id;
    const df = Math.hypot(me.p[0] - f.x, me.p[2] - f.z);
    if (f.owner === me.id || df > FROST.radius + 0.6) { b.threats.delete(key); continue; }
    let rec = b.threats.get(key);
    if (!rec) { rec = newThreat(cfg, t); b.threats.set(key, rec); }
    if (rec.handled || rec.ignore || t < rec.seenAt + rec.react) continue;
    rec.handled = true;
    respondFrostfall(me, f, df, t, act);
  }

  // ---- maintain ongoing actions
  if (me.blocking && (t >= b.blockUntil || (me.st < 15 && !b.faceGoat))) { act({ t: 'block', on: false }); b.faceGoat = null; }
  if (!me.blocking) b.faceGoat = null;
  if (me.charging && t >= b.chargeFireAt) {
    const from = [me.p[0], me.p[1] + 1.3, me.p[2]];
    const tgt = target && !target.dead ? target : null;
    act({ t: 'chargeRelease', dir: tgt ? aimAt(me, from, tgt, C.SPELLS.heavy.speed, 0, cfg) : [Math.sin(me.yaw), 0, Math.cos(me.yaw)] });
  }
  if (me.lash && t >= b.lashFireAt) {
    const from = [me.p[0], me.p[1] + 1.3, me.p[2]];
    const tgt = target && !target.dead ? target : null;
    if (tgt) me.yaw = yawTo(me.p, tgt.p);
    act({ t: 'lashRelease', dir: tgt ? aimAt(me, from, tgt, C.SPELLS.lash.speed, 0, cfg) : [Math.sin(me.yaw), 0, Math.cos(me.yaw)] });
  }
  // a curse being laid: like a player, the bot holds F on the prop for RELIC.hold seconds
  if (b.cursing) {
    const prop = world.props.get(b.cursing.prop);
    if (!free || me.carrying || me.blocking || prop?.state !== 'idle') b.cursing = null;
    else if (t >= b.cursing.at) { b.cursing = null; aimProp(me, prop, (from, dir) => act({ t: 'curse', aimOrigin: from, aimDir: dir })); }
    return;
  }
  if (!free || !target || me.blocking || me.charging || me.cyclone || me.lash || t < (b.goatDanger || 0)) return;
  const meAir = airborne(me, t);

  const carried = me.carrying ? world.props.get(me.carrying) : null;

  // a veiled Gale swallows everything for 3 s: don't waste shots, wait it out (movement backs off)
  if (veiled(target, t)) return;

  // ---- punish a meteor, lash or cyclone wind-up with a spark (interrupts it)
  if (busyCasting(target) && los && d < 26) {
    if (!b.chargeSeen.has(target.id)) b.chargeSeen.set(target.id, { at: t, go: Math.random() < cfg.punish });
    const seen = b.chargeSeen.get(target.id);
    if (seen.go && t >= seen.at + cfg.react) {
      if (carried?.state === 'carried' && t >= me.cd.throw && throwLOS(me, target)) return throwProp(me, target, act, cfg, world);
      if (!me.carrying && primaryReady(me, t)) return primary(me, target, act, cfg, world, t);   // shots 1–2, then the finisher
    }
  } else b.chargeSeen.delete(target.id);

  // ---- cyclone: spin as soon as they're inside the radius (a ward facing us blocks it, so
  // prefer them stunned, busy or turned away)
  const targetAir = airborne(target, t);
  if (K.power === 'cyclone' && t >= me.cd.power && !airborne(me, t) && !me.carrying && !targetAir && d < 4.5 && los) {
    const busy = isStunned(target, t) || busyCasting(target) || rooted(target, t);
    const warded = target.blocking && target.st > CYC.staminaCost && facing(target, me.p);
    if ((busy || !warded) && Math.random() < cfg.aggression * 0.3) { act({ t: 'cyclone' }); b.diveUntil = 0; return; }
  }

  if (t < b.nextThink) return;
  b.nextThink = t + cfg.think * rand(0.7, 1.3);

  // ---- holding a goat: hurl it at them (it hits like a thrown prop), or set it down if there's no shot
  if (me.carryingGoat) {
    const g = world.goats.find(x => x.id === me.carryingGoat);
    if (!g || g.state !== 'held' || t < me.cd.throw) return;
    if (!b.holdSince) b.holdSince = t;
    if (d < 18 && throwLOS(me, target)) {
      me.yaw = yawTo(me.p, target.p);
      const from = C.holdPoint(me.p, me.yaw);
      b.holdSince = 0;
      return act({ t: 'throw', dir: aimAt(me, from, target, C.GOAT.throwSpeed, C.GOAT.throwGravity, cfg) });
    }
    if (t - b.holdSince > 3) { b.holdSince = 0; act({ t: 'drop' }); }
    return;
  }

  // ---- holding a prop: throw when they're busy, or after a moment
  if (carried) {
    if (carried.state !== 'carried' || t < me.cd.throw) return;
    if (!b.holdSince) b.holdSince = t;
    const busy = busyCasting(target) || target.blocking || isStunned(target, t) || rooted(target, t);
    if (d < 22 && throwLOS(me, target) && (busy || t - b.holdSince > rand(0.4, 1.4))) { b.holdSince = 0; return throwProp(me, target, act, cfg, world); }
    return;
  }
  b.holdSince = 0;

  // ---- hurt and pressed: get away (Mirror Step, Blink) or wall them off (Glacial Bulwark)
  if (me.hp < 40 && d < 10 && los && !target.decoy) {
    const away = [me.p[0] - target.p[0], 0, me.p[2] - target.p[2]];
    if (K.mobility === 'mirror_step' && cfg.blinkDodge && mobilityReady(me, t) && Math.random() < 0.35 * cfg.dodge) return mirrorStep(me, away, act);
    if (K.mobility === 'blink' && cfg.blinkDodge && mobilityReady(me, t) && Math.random() < 0.35 * cfg.dodge) return blinkAway(me, away, act);
    if (K.mobility === 'smoke_screen' && mobilityReady(me, t) && Math.random() < 0.35 * Math.max(cfg.dodge, 0.5)) return smokeAway(me, away, act);
    if (wallReady(me, t) && d > 3.5 && Math.random() < 0.4 * cfg.dodge) return raiseWall(me, target.p, act);
  }

  if (Math.random() > cfg.aggression) return;

  // ---- Trapped Relic: curse a prop lying near the enemy, for them to pick up
  if (K.utility === 'trapped_relic' && t >= b.nextCurse && t >= me.cd.lift && !target.decoy) {
    b.nextCurse = t + rand(3, 6);
    const mine = [...world.props.values()].find(pr => pr.cursedBy === me.id);
    if (!mine || mine.state !== 'idle' || dist2D([mine.x, 0, mine.z], target.p) > 9) {
      const prop = curseCandidate(me, target, world);
      if (prop) { b.cursing = { prop: prop.id, at: t + RELIC.hold }; b.nextCurse = t + rand(8, 14); me.yaw = yawTo(me.p, [prop.x, 0, prop.z]); return; }
    }
  }

  // ---- telekinesis: Normal and Hard bots sometimes grab a calm goat close by to hurl at the target
  if (cfg.goatAware && !me.carrying && t >= me.cd.lift && d < 18 && Math.random() < cfg.tk * 0.5) {
    const g = world.goats.find(x => ['graze', 'wander', 'return', 'recover', 'dizzy', 'stumble'].includes(x.state) && !x.holder
      && Math.hypot(x.x - me.p[0], x.z - me.p[2]) < C.TK.range - 1 && hasLOS(me.p, [x.x, 0, x.z]));
    if (g) {
      const from = [me.p[0], me.p[1] + 1.3, me.p[2]];
      const c = [g.x, (g.y || 0) + C.GOAT.hitY, g.z];
      me.yaw = yawTo(me.p, c);
      act({ t: 'pickup', aimOrigin: from, aimDir: [c[0] - from[0], c[1] - from[1], c[2] - from[2]] });
      if (me.carryingGoat) return;
    }
  }

  // ---- telekinesis: grab a prop that's roughly between us and them
  if (t >= me.cd.lift && Math.random() < cfg.tk) {
    const prop = pickProp(me, target, world, t);
    if (prop) {
      aimProp(me, prop, (from, dir) => act({ t: 'pickup', aimOrigin: from, aimDir: dir }));
      if (me.carrying) return;
    }
  }

  if (!los) {
    // No shot: blink around the pillar sometimes, otherwise the movement code flanks.
    if (cfg.blinkDodge && K.mobility === 'blink' && mobilityReady(me, t) && Math.random() < 0.15) blinkSideways(me, target.p, act);
    return;
  }

  const targetStunned = isStunned(target, t);
  const targetWarded = target.blocking && target.st > 30 && facing(target, me.p);
  const powerReady = t >= me.cd.power && !meAir, fastReady = primaryReady(me, t);
  // the magazine's last shot is the one that interrupts: keep it for a wind-up (the punish check above fires it)
  const savingFinisher = me.ammo === 1 && !busyCasting(target) && (b.saveRoll ??= Math.random() < cfg.saveFinisher);
  if (me.ammo !== 1) b.saveRoll = undefined;

  if (K.power === 'meteor') {
    // Meteor: when they can't easily dodge or block it, or from long range with time to spare.
    const meteorWindow = targetStunned || rooted(target, t) || busyCasting(target) || (d > 13 && Math.random() < 0.35) || (!targetWarded && Math.random() < 0.18);
    if (powerReady && !targetAir && d > 5 && d < 24 && meteorWindow && !targetWarded) {
      act({ t: 'chargeStart' });
      if (me.charging) b.chargeFireAt = t + C.SPELLS.heavy.chargeTime + 0.02;
      return;
    }
  } else if (K.power === 'cyclone' && powerReady && !targetAir && !me.carrying) {
    // Cyclone ready: rush in to spin range (the check above fires it), behind a Tempest Veil if we have one
    if (d < 14 && !targetWarded && me.hp > 30 && Math.random() < cfg.aggression * 0.6) {
      b.diveUntil = t + 2.5;
      if (veilReady(me, t) && d > 4.5 && d < 11 && cfg.blinkDodge) { act({ t: 'veil' }); return; }
    }
  } else if (K.power === 'sanguine_lash' && powerReady && !targetAir && !me.carrying) {
    // Lash: best when they're stuck in place, or when it can pierce two of them
    const window = targetStunned || rooted(target, t) || busyCasting(target) || linedUp(me, target, world, t) || Math.random() < 0.2;
    if (d > 4 && d < LASH_RANGE - 2 && window && !targetWarded && !lineBlocked([me.p[0], 1.3, me.p[2]], [target.p[0] - me.p[0], 0, target.p[2] - me.p[2]], d, C.SPELLS.lash.radius)) {
      me.yaw = yawTo(me.p, target.p);
      act({ t: 'lashStart' });
      if (me.lash) b.lashFireAt = t + LASH.windup + 0.02;
      return;
    }
  } else if (K.power === 'frostfall' && t >= me.cd.power && !targetAir && !me.carrying && d < FROST.range) {
    // Rime can cast it during a Skyward Flash: sometimes go up first and drop it from above
    if (!meAir && K.mobility === 'skyward' && cfg.blinkDodge && mobilityReady(me, t) && d > 7 && Math.random() < 0.25) { act({ t: 'skyward' }); return; }
    // Frostfall: where a slowed, bound or stunned target will still be when the ice lands
    const stuck = rooted(target, t) || isStunned(target, t) || busyCasting(target);
    const slowed = target.slowUntil > t;
    if (stuck || (slowed && Math.random() < 0.6) || Math.random() < 0.1) {
      const at = frostfallAim(me, target, t, cfg);
      if (Math.hypot(at[0] - me.p[0], at[1] - me.p[2]) > FROST.radius + 0.8) {   // not on our own head
        me.yaw = yawTo(me.p, [at[0], 0, at[1]]);
        act({ t: 'frostfall', at });
        return;
      }
    }
  }

  // Skyward Flash: sometimes take the high ground and rain sparks down.
  if (K.mobility === 'skyward' && cfg.blinkDodge && mobilityReady(me, t) && d > 7 && d < 18 && me.hp > 40 && Math.random() < 0.06) {
    act({ t: 'skyward' });
    return;
  }
  // The primary: the bread and butter. Against a raised ward sparks still drain stamina.
  if (fastReady && !savingFinisher && (!targetWarded || Math.random() < 0.5)) return primary(me, target, act, cfg, world, t);
}

const LASH_RANGE = C.SPELLS.lash.speed * C.SPELLS.lash.life;
const newThreat = (cfg, t) => ({ seenAt: t, react: cfg.react * rand(0.8, 1.3), handled: false, ignore: Math.random() > cfg.dodge });

// Our primary spell at the target: a spark, or a Glacial Skim fan along the ground.
function primary(me, target, act, cfg, world, t) {
  if (kit(me).primary === 'glacial_skim') return skim(me, target, act, cfg, world, t);
  if (dist2D(me.p, target.p) < 28) return spark(me, target, act, cfg, world);
}

function spark(me, target, act, cfg, world) {
  const from = [me.p[0], me.p[1] + 1.3, me.p[2]];
  const dir = aimAt(me, from, target, C.SPELLS.fast.speed, 0, cfg);
  if (lineBlocked(from, dir, dist2D(me.p, target.p), C.SPELLS.fast.radius, cfg.goatAware && world.goats)) return;
  me.yaw = yawTo(me.p, target.p);
  act({ t: 'cast', kind: 'fast', dir });
}

// The shards fly at ankle height, so anything in the air is out of reach and fences and crops are walls.
function skim(me, target, act, cfg, world, t) {
  const range = dist2D(me.p, target.p);
  if (airborne(target, t) || range > SKIM.speed * SKIM.life - 3) return;
  const from = [me.p[0], SKIM.height, me.p[2]];
  const dir = aimAt(me, from, target, SKIM.speed, 0, cfg);
  const flat = [dir[0], 0, dir[2]];
  if (lowLineBlocked(from, flat, range, SKIM.radius) || lineBlocked(from, flat, range, SKIM.radius, cfg.goatAware && world.goats)) return;
  me.yaw = yawTo(me.p, target.p);
  act({ t: 'cast', kind: 'skim', dir: flat });
}

function throwProp(me, target, act, cfg, world) {
  me.yaw = yawTo(me.p, target.p);
  const from = C.holdPoint(me.p, me.yaw);
  const dir = aimAt(me, from, target, C.SPELLS.prop.speed, C.SPELLS.prop.gravity, cfg);
  if (lineBlocked(from, dir, dist2D(from, target.p), C.SPELLS.prop.radius, cfg.goatAware && world.goats)) return;
  act({ t: 'throw', dir });   // already gravity-compensated, so no aim point for the server to re-solve
}

// Turn to a prop and hand `send` the aim ray at it (for a pickup or a curse).
function aimProp(me, prop, send) {
  const from = [me.p[0], me.p[1] + 1.3, me.p[2]];
  const c = [prop.x, C.PROP_TYPES[prop.type].h * 0.5, prop.z];
  me.yaw = yawTo(me.p, c);
  send(from, [c[0] - from[0], c[1] - from[1], c[2] - from[2]]);
}

// Would a shot along `dir` clip a pillar or tree (or, if given, a goat) within `range` metres?
function lineBlocked(from, dir, range, radius, goats = null) {
  const l = Math.hypot(dir[0], dir[2]) || 1;
  const to = [from[0] + dir[0] / l * range, 0, from[2] + dir[2] / l * range];
  return !!C.pillarBlocks(from, to, radius + 0.15)
    || (goats || []).some(g => segDist(from, to, g) < C.GOAT.radius + radius + 0.3);
}
// The same for something skimming the ground: anything taller than it is in the way.
function lowLineBlocked(from, dir, range, radius) {
  const l = Math.hypot(dir[0], dir[2]) || 1;
  const to = [from[0] + dir[0] / l * range, 0, from[2] + dir[2] / l * range];
  return C.COLLIDERS.some(c => c.h > from[1] && segDist(from, to, c) < c.r + radius + 0.1);
}

// Another enemy close to the line from us through the target: a lash would pierce both.
function linedUp(me, target, world, t) {
  const dx = target.p[0] - me.p[0], dz = target.p[2] - me.p[2], l = Math.hypot(dx, dz) || 1;
  const end = [me.p[0] + dx / l * (LASH_RANGE - 1), 0, me.p[2] + dz / l * (LASH_RANGE - 1)];
  return [...world.players.values()].some(q => q !== me && q.id !== target.id && !q.dead && !airborne(q, t)
    && segDist(me.p, end, { x: q.p[0], z: q.p[2] }) < 1 && dist2D(me.p, q.p) > 3);
}

// A goat is charging at us: flash up out of reach, spin it dizzy if the cyclone lands first, wall it
// off, ward facing it if we can afford it, else blink, mirror-step or dive aside.
function respondGoat(me, world, g, vel, tc, t, act) {
  const b = me.bot, K = kit(me);
  if (me.charging) act({ t: 'chargeRelease', dir: [Math.sin(me.yaw), 0, Math.cos(me.yaw)] });   // abandon the meteor
  if (me.lash) act({ t: 'lashRelease', dir: [Math.sin(me.yaw), 0, Math.cos(me.yaw)] });          // and the lash
  if (!canAct(me, t) || airborne(me, t) || me.cyclone) return;
  if (K.mobility === 'skyward' && b.cfg.blinkDodge && mobilityReady(me, t)) return act({ t: 'skyward' });
  if (world.cycloneStopsGoats && K.power === 'cyclone' && t >= me.cd.power && !me.carrying
      && tc > CYC.windup + 0.05 && tc * C.GOAT.chargeSpeed < CYC.windup * C.GOAT.chargeSpeed + CYC.radius) return act({ t: 'cyclone' });
  if (veiled(me, t)) return;   // it bounces off the veil
  if (veilReady(me, t)) return act({ t: 'veil' });
  if (wallReady(me, t) && Math.hypot(g.x - me.p[0], g.z - me.p[2]) > BULWARK.dist + 1.2) return raiseWall(me, [g.x, 0, g.z], act);
  if (K.guard === 'ward' && me.st >= C.GOAT.blockCost + 5) {
    me.yaw = Math.atan2(g.x - me.p[0], g.z - me.p[2]);
    act({ t: 'block', on: true });
    b.blockUntil = t + tc + 0.45;
    b.faceGoat = g.id;
    return;
  }
  if (K.mobility === 'blink' && mobilityReady(me, t)) return blinkSideways(me, null, act, vel);
  if (K.mobility === 'mirror_step' && mobilityReady(me, t)) return mirrorStep(me, [-vel[2], 0, vel[0]], act);
  if (K.mobility === 'smoke_screen' && mobilityReady(me, t)) return smokeAway(me, [-vel[2] * b.strafe, 0, vel[0] * b.strafe], act);
  const l = Math.hypot(vel[0], vel[2]) || 1;
  b.dodgeVec = [-vel[2] / l * b.strafe, vel[0] / l * b.strafe];
  b.dodgeUntil = t + 0.6;
}

// The prop launches from the hold point beside us, so check the line from there (with its width).
function throwLOS(me, target) {
  const from = C.holdPoint(me.p, yawTo(me.p, target.p));
  return !C.pillarBlocks(from, target.p, 0.7);
}
function segDist(a, b, c) {
  const sx = b[0] - a[0], sz = b[2] - a[2];
  const k = Math.max(0, Math.min(1, ((c.x - a[0]) * sx + (c.z - a[2]) * sz) / (sx * sx + sz * sz || 1)));
  return Math.hypot(a[0] + sx * k - c.x, a[2] + sz * k - c.z);
}

function facing(q, point) { return facingWithin(q, point, C.BLOCK_CONE_DEG / 2); }
function facingWithin(q, point, deg) {
  const fx = Math.sin(q.yaw), fz = Math.cos(q.yaw);
  const dx = point[0] - q.p[0], dz = point[2] - q.p[2];
  const l = Math.hypot(dx, dz) || 1;
  return (fx * dx + fz * dz) / l > Math.cos(deg * Math.PI / 180);
}

function pickProp(me, target, world, t) {
  let best = null, bs = Infinity;
  for (const prop of world.props.values()) {
    if (prop.state !== 'idle') continue;
    if (prop.cursedBy === me.id) continue;                                   // our own trap: leave it be
    if (t - (me.bot.burned.get(prop.id) ?? -Infinity) < 40) continue;      // it blew up on us (Hard bots)
    const pp = [prop.x, 0, prop.z];
    const d = dist2D(me.p, pp);
    if (d > Math.min(12, C.TK.range - 1) || !hasLOS(me.p, pp)) continue;
    // prefer props near us and not behind us relative to the target
    const s = d + dist2D(pp, target.p) * 0.3;
    if (s < bs) { bs = s; best = prop; }
  }
  return best;
}

// A prop for a Trapped Relic: one the target is likely to grab (close to them), that we can reach.
function curseCandidate(me, target, world) {
  let best = null, bs = Infinity;
  for (const prop of world.props.values()) {
    if (prop.state !== 'idle') continue;
    const pp = [prop.x, 0, prop.z];
    const dm = dist2D(me.p, pp), dt = dist2D(target.p, pp);
    if (dm > C.TK.range - 1 || dt > 8 || dm < 3 || !hasLOS(me.p, pp)) continue;
    if (dt < bs) { bs = dt; best = prop; }
  }
  return best;
}

// Teleport perpendicular to `away` (a point we want to get off the line of), picking the safer side.
function blinkSideways(me, awayFrom, act, along = null) {
  let ax, az;
  if (along) { ax = along[0]; az = along[2]; }
  else { ax = me.p[0] - awayFrom[0]; az = me.p[2] - awayFrom[2]; }
  const l = Math.hypot(ax, az) || 1;
  const sides = [[-az / l, 0, ax / l], [az / l, 0, -ax / l]];
  let best = sides[0], bs = -Infinity;
  for (const s of sides) {
    const to = C.computeTeleport(me.p, s);
    const score = -Math.hypot(to[0], to[2]) * 0.3 + dist2D(to, me.p);   // stay central, go the full distance
    if (score > bs) { bs = score; best = s; }
  }
  act({ t: 'teleport', dir: best, from: me.p.slice() });
  me.bot.vel = [0, 0];
}

// `dir` flattened, nudged toward the middle of the arena if it points outward near the rim.
function inward(me, dir) {
  let [dx, , dz] = dir;
  const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  const r = Math.hypot(me.p[0], me.p[2]);
  if (r > C.ARENA_RADIUS - 10 && (dx * me.p[0] + dz * me.p[2]) > 0) { dx -= me.p[0] / r; dz -= me.p[2] / r; }
  return [dx, 0, dz];
}
// Mirror Step along `dir`.
function mirrorStep(me, dir, act) {
  act({ t: 'mirror', dir: inward(me, dir), from: me.p.slice() });
  me.bot.vel = [0, 0];
}
// Blink along `dir` (the bot turns that way first: a blink goes where you face).
function blinkAway(me, dir, act) {
  const d = inward(me, dir);
  me.yaw = Math.atan2(d[0], d[2]);
  act({ t: 'teleport', dir: d, from: me.p.slice() });
  me.bot.vel = [0, 0];
}

// Smoke Screen: the dash goes backwards, so turn our back to where we want to go.
function smokeAway(me, dir, act) {
  const d = inward(me, dir);
  me.yaw = Math.atan2(-d[0], -d[2]);
  act({ t: 'smoke', yaw: me.yaw, from: me.p.slice() });
}

// Glacial Bulwark between us and `toward`.
function raiseWall(me, toward, act) {
  me.yaw = yawTo(me.p, toward);
  act({ t: 'bulwark', yaw: me.yaw });
}

// An enemy cyclone is winding up near us: flash up, blink or mirror clear, wall it off, or run out
// of the radius. Hard bots with stamina to spare turn and ward it instead when they can't get out in time.
function respondCyclone(me, caster, t, act) {
  const b = me.bot, cfg = b.cfg, K = kit(me);
  if (me.charging) act({ t: 'chargeRelease', dir: [Math.sin(me.yaw), 0, Math.cos(me.yaw)] });
  if (me.lash) act({ t: 'lashRelease', dir: [Math.sin(me.yaw), 0, Math.cos(me.yaw)] });
  if (!canAct(me, t) || me.cyclone) return;
  const left = caster.cyclone.pulseAt - t;
  const d = dist2D(me.p, caster.p);
  const need = CYC.radius + C.PLAYER_RADIUS + 0.4 - d;
  const away = [me.p[0] - caster.p[0], 0, me.p[2] - caster.p[2]];
  if (cfg.blinkDodge && mobilityReady(me, t)) {
    if (K.mobility === 'skyward') return act({ t: 'skyward' });
    if (K.mobility === 'mirror_step') return mirrorStep(me, away, act);
    if (K.mobility === 'smoke_screen') return smokeAway(me, away, act);
    return blinkSideways(me, caster.p, act, away);
  }
  if (veiled(me, t)) return;
  if (veilReady(me, t)) return act({ t: 'veil' });
  if (wallReady(me, t) && d > BULWARK.dist + 0.6) return raiseWall(me, caster.p, act);
  if (K.guard === 'ward' && need > left * C.speedOf(me.wizard) * cfg.speed && me.st >= CYC.staminaCost + 5 && !me.carrying && cfg.dodge > 0.8) {
    me.yaw = Math.atan2(caster.p[0] - me.p[0], caster.p[2] - me.p[2]);
    act({ t: 'block', on: true });
    b.blockUntil = caster.cyclone.pulseAt + 0.15;
    return;
  }
  const l = d || 1;
  b.dodgeVec = [away[0] / l, away[2] / l];
  b.dodgeUntil = caster.cyclone.pulseAt + 0.15;
}

// Where to drop a Frostfall on `target`: its position when the ice lands. It can't move while rooted or
// stunned, and only the free time after that counts. Aim error scales with difficulty.
function frostfallAim(me, target, t, cfg) {
  const tr = tracks.get(target.id);
  const v = tr ? tr.v : target.vel || [0, 0];
  const stuckFor = Math.max(target.rootUntil || 0, target.stunUntil || 0) - t;
  const free = Math.max(0, FROST.delay - Math.max(0, stuckFor)) * cfg.lead * 0.6;
  const err = cfg.aimErr * 0.12;
  return [target.p[0] + v[0] * free + gauss() * err, target.p[2] + v[1] * free + gauss() * err];
}

// Standing in a Frostfall shadow: walk straight out if there's time, else use mobility.
function respondFrostfall(me, f, df, t, act) {
  const b = me.bot, cfg = b.cfg, K = kit(me);
  if (!canAct(me, t) && rooted(me, t)) return;
  const left = f.at - t;
  if (veiled(me, t) && me.veilUntil > f.at + 0.05) return;
  if (veilReady(me, t) && left < C.SPELLBOOK.tempest_veil.duration - 0.2) return act({ t: 'veil' });
  const need = FROST.radius + C.PLAYER_RADIUS + 0.3 - df;
  const out = df > 0.05 ? [(me.p[0] - f.x) / df, 0, (me.p[2] - f.z) / df] : [Math.sin(me.yaw), 0, Math.cos(me.yaw)];
  if (need > left * C.speedOf(me.wizard) * cfg.speed * (me.slowUntil > t ? 1 - SKIM.slow : 1) && cfg.blinkDodge && mobilityReady(me, t) && canAct(me, t)) {
    if (K.mobility === 'skyward') return act({ t: 'skyward' });
    if (K.mobility === 'mirror_step') return mirrorStep(me, out, act);
    if (K.mobility === 'blink') return blinkAway(me, out, act);
    if (K.mobility === 'smoke_screen') return smokeAway(me, out, act);
  }
  if (me.charging || me.lash) act({ t: me.charging ? 'chargeRelease' : 'lashRelease', dir: [Math.sin(me.yaw), 0, Math.cos(me.yaw)] });
  b.dodgeVec = [out[0], out[2]];
  b.dodgeUntil = f.at + 0.1;
}

// How to meet a lash wind-up aimed at us. Mobility is saved for the whip itself (respond()), since
// moving before it fires only moves the aim.
function lashPlan(me, d, t) {
  const K = kit(me);
  if (wallReady(me, t) && d > BULWARK.dist + 1) return 'wall';
  if (K.guard === 'ward' && me.st >= C.SPELLS.lash.staminaCost + 15 && !me.carrying && !airborne(me, t)) return 'ward';
  if (me.bot.cfg.blinkDodge && mobilityReady(me, t) && K.mobility !== 'skyward') return 'whip';
  return 'side';
}
function runLashPlan(me, caster, rec, fireAt, d, t, act) {
  const b = me.bot;
  if (rec.plan === 'done' || rec.plan === 'whip' || !canAct(me, t)) return;
  if (rec.plan === 'wall') { if (wallReady(me, t)) raiseWall(me, caster.p, act); rec.plan = 'done'; return; }
  const travel = d / C.SPELLS.lash.speed;
  if (rec.plan === 'ward' && t >= fireAt - 0.3) {
    if (me.charging || me.lash || me.cyclone) return;
    me.yaw = yawTo(me.p, caster.p);
    act({ t: 'block', on: true });
    b.blockUntil = fireAt + travel + 0.3;
    rec.plan = 'done';
  } else if (rec.plan === 'side' && t >= fireAt - 0.06) {
    const dx = me.p[0] - caster.p[0], dz = me.p[2] - caster.p[2], l = Math.hypot(dx, dz) || 1;
    b.strafe = -b.strafe;   // break the pattern the caster has been leading
    b.dodgeVec = [-dz / l * b.strafe, dx / l * b.strafe];
    b.dodgeUntil = fireAt + travel + 0.25;
    rec.plan = 'done';
  }
}

// Use the mobility spell to get off a projectile's line: blink or mirror-step sideways, or flash straight up.
function evade(me, act, along) {
  const K = kit(me);
  if (K.mobility === 'skyward') return act({ t: 'skyward' });
  if (K.mobility === 'smoke_screen') return smokeAway(me, [-along[2] * me.bot.strafe, 0, along[0] * me.bot.strafe], act);
  if (K.mobility === 'mirror_step') return mirrorStep(me, [-along[2] * me.bot.strafe, 0, along[0] * me.bot.strafe], act);
  blinkSideways(me, null, act, along);
}

function respond(me, world, t, proj, th, act) {
  const b = me.bot, cfg = b.cfg, K = kit(me);
  const spec = C.SPELLS[proj.kind];
  const incoming = [-proj.v[0], 0, -proj.v[2]];
  const faceIt = () => { me.yaw = Math.atan2(incoming[0], incoming[2]); };
  const big = proj.kind === 'heavy' || proj.kind === 'lash';
  if (veiled(me, t)) return;   // nothing gets through the veil: keep casting

  // Mid wind-up we can't ward or move well; a smart bot abandons a cast that's about to be stuffed.
  if (me.charging || me.lash) {
    if (cfg.dodge < 0.5) return;
    act({ t: me.charging ? 'chargeRelease' : 'lashRelease', dir: [Math.sin(me.yaw), 0, Math.cos(me.yaw)] });   // too early: cancels
  }
  if (!canAct(me, t) || me.cyclone) return;

  // Glacial Bulwark: an ice wall in its path, if it's still far enough out to land behind the wall
  const projDist = Math.hypot(proj.p[0] - me.p[0], proj.p[2] - me.p[2]);
  if (veiled(me, t)) return;   // nothing gets through
  if (big && veilReady(me, t)) return act({ t: 'veil' });
  if (big && wallReady(me, t) && projDist > BULWARK.dist + 1.2 && th.tc > 0.1) {
    return raiseWall(me, [me.p[0] + incoming[0], 0, me.p[2] + incoming[2]], act);
  }

  const canWard = K.guard === 'ward' && me.st >= Math.min(spec.staminaCost + 5, 60) && !me.carrying && !airborne(me, t);
  const sidestep = () => {
    if (rooted(me, t)) return;
    const vx = proj.v[0], vz = proj.v[2];
    const l = Math.hypot(vx, vz) || 1;
    // perpendicular, toward the side we're already offset to
    const c = chest(me);
    const side = Math.sign((c[0] - proj.p[0]) * -vz / l + (c[2] - proj.p[2]) * vx / l) || b.strafe;
    b.dodgeVec = [-vz / l * side, vx / l * side];
    b.dodgeUntil = t + Math.min(0.6, th.tc + 0.15);
    b.strafe = side;
  };

  if (big) {
    if (cfg.blinkDodge && mobilityReady(me, t) && th.tc < 0.9) return evade(me, act, proj.v);
    if (canWard && th.tc < 0.7) { faceIt(); act({ t: 'block', on: true }); b.blockUntil = t + th.tc + 0.25; return; }
    return sidestep();
  }
  // Ice shards fly at ankle height: up in the air they can't reach us.
  if (proj.kind === 'skim' && airborne(me, t)) return;
  // Sparks, shards and thrown props: sidestep if there's time to clear the hit sphere, else ward.
  const clearTime = (C.HIT_RADIUS + proj.radius - th.miss + 0.3) / (C.speedOf(me.wizard) * cfg.speed);
  if (th.tc > clearTime + 0.05 && Math.random() < 0.65) return sidestep();
  if (canWard) { faceIt(); act({ t: 'block', on: true }); b.blockUntil = t + th.tc + 0.2; return; }
  sidestep();
}

// ---------------------------------------------------------------- movement (every tick)
function moveBot(me, dt, world, t) {
  const b = me.bot, cfg = b.cfg;
  if (me.dead) { b.vel = [0, 0]; b.threats.clear(); return; }
  const target = b.chase && (b.chase.decoy ? world.decoys.has(b.chase.decoy) : b.chase.id === b.targetId) ? b.chase : world.players.get(b.targetId);
  const stunned = isStunned(me, t) || rooted(me, t);
  const flying = airborne(me, t);

  // Skyward Flash descent, the same physics a client runs: float (slowly, if "holding E"), then drop.
  if (flying) {
    if (b.flightStart !== me.flightStart) { b.flightStart = me.flightStart; b.slowFall = Math.random() < (cfg.lead > 0.5 ? 0.6 : 0.3); }
    const e = t - me.flightStart;
    const rate = e >= SKY.floatTime ? SKY.dropSpeed : b.slowFall ? SKY.slowFallSpeed : SKY.fallSpeed;
    me.p[1] = Math.max(0, me.p[1] - rate * dt);
  }

  // Smoke Screen dash: straight back at dash speed, colliding as usual
  if (b.dash && t < b.dash.until && !stunned) {
    const v = SMOKE.distance / SMOKE.dashTime;
    b.vel = [b.dash.dir[0] * v, b.dash.dir[2] * v];
  } else b.dash = null;

  let wx = 0, wz = 0;
  if (b.dash) { /* the dash carries us */ }
  else if (!stunned) {
    if (t < b.dodgeUntil && b.dodgeVec) { wx = b.dodgeVec[0]; wz = b.dodgeVec[1]; }
    else if (target && !target.dead) {
      const dx = target.p[0] - me.p[0], dz = target.p[2] - me.p[2];
      const d = Math.hypot(dx, dz) || 1;
      const fx = dx / d, fz = dz / d;
      const los = hasLOS(me.p, target.p);
      const lowHp = me.hp < 35 && me.hp < target.hp;
      const diving = t < (b.diveUntil || 0) && t >= me.cd.power && !me.carrying;
      let fwd = 0;
      if (lowHp && los) {
        // retreat to the far side of the nearest pillar
        const cover = coverPoint(me, target);
        if (cover) { const cx = cover[0] - me.p[0], cz = cover[1] - me.p[2]; const cl = Math.hypot(cx, cz) || 1; wx = cx / cl; wz = cz / cl; }
        else fwd = -1;
      } else if (!los) fwd = d > 6 ? 0.6 : 0;            // flank around the obstruction
      else if (diving) fwd = d > 3 ? 1 : 0;              // closing in for a cyclone
      else if (veiled(target, t)) fwd = d < 12 ? -1 : 0;  // a veiled Gale is coming: keep away until it drops
      else if (d > cfg.range[1]) fwd = 1;
      else if (d < cfg.range[0]) fwd = -0.8;
      if (t >= b.strafeUntil) { if (Math.random() < 0.6) b.strafe *= -1; b.strafeUntil = t + rand(0.5, 1.8) / (cfg.dodge + 0.4); }
      const strafe = diving ? 0.35 : los ? 0.9 : 1;
      if (!(lowHp && los && wx)) { wx = fx * fwd + fz * strafe * b.strafe; wz = fz * fwd - fx * strafe * b.strafe; }
      const fg = me.blocking && b.faceGoat ? world.goats.find(g => g.id === b.faceGoat) : null;
      if (fg) me.yaw = Math.atan2(fg.x - me.p[0], fg.z - me.p[2]);
      else if (!me.blocking) me.yaw = Math.atan2(fx, fz);
    } else if (b.lastSeen && t < b.lastSeenUntil && dist2D(me.p, b.lastSeen) > SMOKE.radius + 1) {
      // lost them in smoke: go toward where they were last seen (but not into the cloud)
      wx = b.lastSeen[0] - me.p[0]; wz = b.lastSeen[2] - me.p[2];
    } else {
      // nobody to fight: drift toward the middle
      wx = -me.p[0]; wz = -me.p[2];
      if (Math.hypot(wx, wz) < 6) { wx = 0; wz = 0; }
    }
    // keep off the edge
    const r = Math.hypot(me.p[0], me.p[2]);
    if (r > C.ARENA_RADIUS - 5) { wx -= me.p[0] / r * 1.5; wz -= me.p[2] / r * 1.5; }
  }
  const wl = Math.hypot(wx, wz);
  const run = C.speedOf(me.wizard);   // per wizard (wizards.js speed)
  let speed = run * cfg.speed;
  if (me.charging || me.cyclone || me.lash) speed = C.chargeSpeedOf(me.wizard);
  else if (me.blocking) speed = C.blockSpeedOf(me.wizard);
  else if (flying) speed = SKY.airSpeed;
  if (t < b.dodgeUntil && !me.cyclone && !flying && !me.charging && !me.lash) speed = Math.max(speed, run * 0.95);
  if (me.slowUntil > t) speed *= 1 - SKIM.slow;
  if (rooted(me, t)) { speed = 0; b.vel = [0, 0]; }
  if (wl > 0.01) speed = C.backpedalSpeed(speed, wx, wz, me.yaw);   // backpedalling is slower, like for players
  const tx = wl > 0.01 ? wx / wl * speed : 0, tz = wl > 0.01 ? wz / wl * speed : 0;
  const k = Math.min(1, dt * 12);
  if (!b.dash) { b.vel[0] += (tx - b.vel[0]) * k; b.vel[1] += (tz - b.vel[1]) * k; }
  me.p[0] += b.vel[0] * dt; me.p[2] += b.vel[1] * dt;

  // collisions, same as the client's
  const pr = C.PLAYER_RADIUS;
  const pushOut = (cx, cz, rr) => {
    const dx = me.p[0] - cx, dz = me.p[2] - cz;
    const dd = Math.hypot(dx, dz);
    if (dd < rr + pr && dd > 1e-4) { const kk = (rr + pr - dd) / dd; me.p[0] += dx * kk; me.p[2] += dz * kk; }
  };
  // airborne, we pass over anything lower than our feet
  const y = me.p[1];
  for (const c of C.COLLIDERS) if (y < c.h) pushOut(c.x, c.z, c.r);
  if (y < 1) for (const prop of world.props.values()) if (prop.state === 'idle') pushOut(prop.x, prop.z, C.PROP_TYPES[prop.type].r * 0.8);
  for (const q of world.players.values()) if (q !== me && !q.dead && Math.abs(q.p[1] - y) < C.PLAYER_HEIGHT) pushOut(q.p[0], q.p[2], pr);
  if (y < 1) for (const g of world.goats) if ((g.y || 0) < 0.5) pushOut(g.x, g.z, C.GOAT.radius);
  const r = Math.hypot(me.p[0], me.p[2]);
  if (r > C.ARENA_RADIUS) { me.p[0] *= C.ARENA_RADIUS / r; me.p[2] *= C.ARENA_RADIUS / r; }

  // stuck against something: switch strafe direction
  if (b.lastPos && wl > 0.01 && dist2D(b.lastPos, me.p) < speed * dt * 0.25) { b.stuckT += dt; if (b.stuckT > 0.4) { b.strafe *= -1; b.stuckT = 0; } }
  else b.stuckT = 0;
  b.lastPos = me.p.slice();

  const moving = Math.hypot(b.vel[0], b.vel[1]) > 0.6;
  me.anim = me.charging || me.lash || cycloneWindingUp(me) ? 'charge' : me.blocking ? 'block' : moving ? 'run' : 'idle';
}

function coverPoint(me, target) {
  let best = null, bd = Infinity;
  for (const pil of C.COLLIDERS) {
    if (pil.h < 2.5 || pil.r < 0.8) continue;   // cover means something big
    const ax = pil.x - target.p[0], az = pil.z - target.p[2];
    const al = Math.hypot(ax, az) || 1;
    const pt = [pil.x + ax / al * (pil.r + 1.3), pil.z + az / al * (pil.r + 1.3)];
    const d = Math.hypot(pt[0] - me.p[0], pt[1] - me.p[2]);
    if (d < bd && d < 18) { bd = d; best = pt; }
  }
  return best;
}
