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
    fooled: 0.5,        // chance it goes after a Mirror Step decoy instead of the real wizard
    saveFinisher: 0,    // chance it holds the magazine's last (interrupting) shot for an enemy wind-up
    relicMemory: false, // stops re-lifting a prop that just blew up on it
    jump: 0.15,         // round 9: chance it hops a Glacial Skim volley at its feet
    crouch: 0,          // chance per check it crouches behind low cover when hurt
    airCast: 0.04,      // round 13: chance per attack decision it jumps first and casts from the air
    airJump: 0.2,       // round 13: chance it air-jumps out of a shot's way when it's up already
  },
  normal: {
    react: 0.25, aimErr: 3.5, lead: 0.6, dodge: 0.6, blinkDodge: true,
    think: 1 / 3, speed: 0.95, range: [8, 14], aggression: 0.8, tk: 0.12, punish: 0.7,
    fooled: 0.3, relicMemory: false, saveFinisher: 0.5, jump: 0.5, crouch: 0.5, airCast: 0.08, airJump: 0.5,
  },
  hard: {
    react: 0.12, aimErr: 1.2, lead: 1, dodge: 0.9, blinkDodge: true,
    think: 1 / 6, speed: 1, range: [9, 15], aggression: 0.95, tk: 0.1, punish: 1,
    fooled: 0.15, relicMemory: true, saveFinisher: 0.9, jump: 0.85, crouch: 0.8, airCast: 0.16, airJump: 0.8,
  },
};

const CYC = C.SPELLBOOK.cyclone, SKY = C.SPELLBOOK.skyward, LASH = C.SPELLBOOK.sanguine_lash;
const BULWARK = C.SPELLBOOK.glacial_bulwark, SKIM = C.SPELLS.skim, RELIC = C.SPELLBOOK.trapped_relic, FROST = C.SPELLBOOK.frostfall;
const SMOKE = C.SPELLBOOK.smoke_screen, ROLL = C.SPELLBOOK.roll;
const EYE = C.SPELLBOOK.eye_of_storm, CAGE = C.SPELLBOOK.night_cage, BLIZ = C.SPELLBOOK.blizzard, MRAIN = C.SPELLBOOK.meteor_rain;
const SHEAR = C.SPELLS.shear, HEX = C.SPELLS.hex, FIRE = C.SPELLS.fireball;
const SHEAR_RANGE = SHEAR.speed * SHEAR.life;
const SLING_S = C.SPELLS.sling, BRAM = C.SPELLBOOK.battering_ram, RGUARD = C.SPELLBOOK.ram_guard, RIDE = C.SPELLBOOK.ram_ride, STAMP = C.SPELLBOOK.stampede;
const guarded = (q, t) => q.ramGuardUntil > t;
const POTION = C.SPELLS.potion, TOXIC = C.SPELLS.toxic, TFLASK = C.SPELLBOOK.toxic_flask, SFLASK = C.SPELLBOOK.smoke_flask;
// An enemy Smoke Flask cloud on the line from `from` to `to`: the shot would vanish into it.
function smokeFlaskInWay(me, world, from, to) {
  for (const c of world.smokeFlasks?.values() || []) {
    if (!foeId(me, c.owner) || c.owner === me.id) continue;
    if (segDist(from, to, { x: c.x, z: c.z }) < SFLASK.radius) return true;
  }
  return false;
}   // Jeb's Ram Guard: shots at him are absorbed and charged back
let clouds = [];   // Smoke Screen clouds this tick: nobody sees into, out of or through them
let match = null;  // game modes (server/match.js): who is an enemy
let players = null;
// Game modes: may `a` hurt `b`? Bots never target, fear or dodge teammates.
const foe = (a, b) => !!a && !!b && a !== b && a.id !== b.id && (!match || match.isEnemy(a, b));
// The owner of something (a projectile, a meteor) is a foe, or gone (which still hurts).
const foeId = (me, id) => { const o = players?.get(id); return !o || foe(me, o); };
const kit = (q) => q.loadout;   // round 11: what it casts (C.sanitizeLoadout)
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (a, b) => a + Math.random() * (b - a);
const dist2D = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const clampAbs = (v, m) => Math.max(-m, Math.min(m, v));
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
    trapsSeen: new Map(),        // `${prop id}:${cursedAt}` -> whether we noticed that enemy trap's glyph (we keep clear)
    nextCurse: 0,
    stuckT: 0, lastPos: null,
  };
}

// Knockback from hits (clients apply this to themselves; the server does it for bots).
export function botKnockback(p, dir, kb) {
  p.bot.vel[0] += dir[0] * kb;
  p.bot.vel[1] += dir[2] * kb;
}

// Eye of the Storm drags this bot toward Gale at `v` (x, z m/s) until `until` (clients get it as eyePull).
export function botPull(p, v, until) {
  p.bot.pull = { v, until };
}

// Smoke Screen and Roll: the server moves a bot through its dash (clients do this themselves), at `speed` m/s.
export function botDash(p, dir, until, speed = SMOKE.distance / SMOKE.dashTime) {
  p.bot.dash = { dir, until, speed };
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
    if (sp > 13) { vx = 0; vz = 0; }   // a blink or respawn, not real movement (a Ram Ride gallop, 11 m/s, is)
    tr.v[0] += (vx - tr.v[0]) * 0.45; tr.v[1] += (vz - tr.v[1]) * 0.45;
    // airborne wizards fall at a known rate; a launch or a landing isn't a fall
    let vy = (q.p[1] - tr.p[1]) / dt;
    if (vy > 0 || vy < -SKY.dropSpeed * 1.5 || !airborne(q, t)) vy = 0;
    tr.vy += (vy - tr.vy) * 0.5;
    tr.p = q.p.slice(); tr.t = t;
  }
  for (const id of tracks.keys()) if (!players.has(id)) tracks.delete(id);
}

export function updateBots(dt, world) {
  const t = world.now();
  clouds = [...(world.smokes?.values() || [])].filter(c => t < c.until);
  match = world.match || null; players = world.players;
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
const chest = (q) => [q.p[0], q.p[1] + C.hitCenterOf(q), q.p[2]];   // (lower when crouched)
const isStunned = (q, t) => q.stunUntil > t;
const canAct = (q, t) => !q.dead && !isStunned(q, t) && !(q.silenceUntil > t);
const rooted = (q, t) => q.rootUntil > t;
const airborne = (q, t) => q.flightUntil > t || !!q.jump || !!q.hover || q.p[1] > C.surfaceHeight(q.p[0], q.p[2], q.p[1]) + 0.05;   // (standing on a platform isn't)
// Round 9: a jump the server will take (it checks the same and more)
const canJump = (q, t) => !q.jump && !q.grab && !airborne(q, t) && q.st >= C.JUMP.stamina + 15 && !q.blocking && !q.charging && !q.lash && !q.ramWind && !q.ultWind && !q.flaskWind
  && !q.ride && !q.eye && !q.mrain && !(q.rootUntil > t) && !(q.stunUntil > t);
// Round 13: the air jump (once per airtime, from any height it's at)
const canAirJump = (q, t) => airborne(q, t) && !(q.flightUntil > t) && !q.airJumped && !q.hover && !q.grab && q.st >= C.AIR_JUMP.stamina + 5 && !q.blocking && !q.charging
  && !q.lash && !q.ramWind && !q.ultWind && !q.flaskWind && !q.ride && !q.eye && !q.mrain && !q.mrainFall && !(q.rootUntil > t) && !(q.stunUntil > t) && !(q.airDashUntil > t);
// Round 9: the way up to a platform. A ramp whose high end reaches `destY` near `dest` ([x, z]): its foot, then up it.
// If that ramp starts on another piece (the ruin bridge between ledges), the way up to its foot first (one level).
const rampHigh = (s) => { const lz = (s.y1 >= s.y0 ? 1 : -1) * s.d / 2, c = Math.cos(s.yaw || 0), n = Math.sin(s.yaw || 0); return [s.x + lz * n, s.z + lz * c]; };
const onRamp = (me, s) => { const dx = me.p[0] - s.x, dz = me.p[2] - s.z, c = Math.cos(s.yaw || 0), n = Math.sin(s.yaw || 0); const lx = dx * c - dz * n, lz = dx * n + dz * c; return Math.abs(lx) <= s.w / 2 + 0.2 && Math.abs(lz) <= s.d / 2 + 0.2; };
function rampWaypoint(me, dest, destY, depth = 0) {
  const myFloor = C.surfaceHeight(me.p[0], me.p[2], me.p[1]);
  if (destY <= myFloor + C.STEP_UP + 0.1 || depth > 2) return null;   // (up to three hops: stairs, then a ladder, then a bridge)
  let best = null, bc = Infinity;
  for (const s of C.SURFACES) {
    if (s.kind !== 'ramp' || s.w < 0.7 || s.moveOnly && !s.ladder) continue;   // (rails and ropes are narrow ramps: not ways up)
    const hi = Math.max(s.y0, s.y1), lo = Math.min(s.y0, s.y1), top = rampHigh(s), foot = C.rampFoot(s);
    if (hi < destY - 0.3) continue;                               // doesn't get high enough
    const toDest = Math.hypot(top[0] - dest[0], top[1] - dest[1]);
    if (toDest > 7) continue;                                     // not the way to this spot
    const cost = Math.hypot(foot[0] - me.p[0], foot[1] - me.p[2]) + toDest + (lo > myFloor + C.STEP_UP ? 6 : 0);
    if (cost < bc) { bc = cost; best = { s, top, foot, lo }; }
  }
  if (!best) return null;
  if (onRamp(me, best.s) || (best.lo <= myFloor + C.STEP_UP && Math.hypot(best.foot[0] - me.p[0], best.foot[1] - me.p[2]) < 1.2)) return [best.top[0] + (best.top[0] - best.foot[0]) * 0.15, best.top[1] + (best.top[1] - best.foot[1]) * 0.15];   // up and over the top
  if (best.lo > myFloor + C.STEP_UP) return rampWaypoint(me, best.foot, best.lo, depth + 1) || best.foot;   // its foot is up on another piece
  return best.foot;
}

// a low collider (fence, crops, hay, a table rock) close by, roughly between us and `toward`
function lowCoverToward(me, toward) {
  const dx = toward[0] - me.p[0], dz = toward[2] - me.p[2], l = Math.hypot(dx, dz) || 1;
  for (const c of C.COLLIDERS) {
    if (c.h < 0.6 || c.h > 1.3) continue;
    const cx = c.x - me.p[0], cz = c.z - me.p[2], d = Math.hypot(cx, cz);
    if (d > c.r + 2 || d < 1e-3) continue;
    if ((cx * dx + cz * dz) / (d * l) > 0.3) return c;
  }
  return null;
}
const cycloneWindingUp = (q) => q.cyclone && !q.cyclone.pulsed;
// Round 13: Roll is a Utility (F) now; its charges' cooldown is cd.lift
const rollReady = (me, t) => kit(me).utility === 'roll' && t >= me.cd.lift && !(me.flightUntil > t) && !rooted(me, t) && !(me.rollUntil > t);
const mobilityReady = (me, t) => t >= me.cd.mobility && !(me.flightUntil > t) && !rooted(me, t);   // (round 13: in a jump too)
const veiled = (q, t) => q.veilUntil > t;
const shielded = (q, t) => q.protUntil > t;   // round 14: spawn protection (nothing lands for 1.5 s, or until they attack)
const veilReady = (me, t) => kit(me).guard === 'tempest_veil' && t >= me.cd.guard && !veiled(me, t);
const wallReady = (me, t) => kit(me).guard === 'glacial_bulwark' && t >= me.cd.guard;
const firewallReady = (me, t) => kit(me).guard === 'firewall' && t >= me.cd.guard;
const FIREWALL = C.SPELLBOOK.firewall;
// A Glacial Bulwark or a Firewall toward `toward` (both stop projectiles; only the Bulwark stops anything else).
function raiseFirewall(me, toward, act) {
  me.yaw = yawTo(me.p, toward);
  act({ t: 'firewall', yaw: me.yaw });
}
// winding something up that a well-timed interrupt stops (an ultimate's wind-up, and Meteor Rain's hover, included)
// Round 13 (server.js castRooted; the same rule): only the big wind-ups root (Meteor's charge, the Lash's and the Ram's
// wind-ups, an ultimate's wind-up, the Blizzard channel, a pull-up). Other casts slow (C.CAST_SLOW), as do Cyclone's and
// Flask Step's short wind-ups: bots strafe while they fire.
const castRootedBot = (q, t) => !(q.eye || q.ride || q.mrain || q.mrainFall)
  && (q.charging || !!q.lash || !!q.ramWind || !!q.grab || !!q.ultWind || !!q.blizz);
const castSlowedBot = (q, t) => t < (q.castSlowUntil || 0) || (!!q.cyclone && !q.cyclone.pulsed) || !!q.flaskWind;
// (a winding Jeb is a target to interrupt; so is anyone hanging in mid-air through a wind-up: q.hover)
const busyCasting = (q) => q.charging || !!q.lash || !!q.ramWind || cycloneWindingUp(q) || !!q.ultWind || !!q.hover || (!!q.mrain && q.mrain.phase !== 'dive');
// the primary can fire now (cooldown, and the magazine isn't reloading)
const primaryReady = (me, t) => t >= me.cd.fast && !(me.reloadUntil > t) && me.ammo > 0;

// A decoy seen as a target: shaped enough like a player for aiming and movement.
function decoyTarget(d, owner) {
  return {
    id: 'decoy' + d.id, decoy: d.id, p: d.p, yaw: d.yaw, vel: [d.dir[0] * C.speedOf(), d.dir[2] * C.speedOf()],
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
  let aim = [c[0] + v[0] * lead, Math.max(C.hitCenterOf(target), c[1] + vy * lead), c[2] + v[1] * lead];
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
  const knocked = [...world.players.values()].some(q => q.knockUntil > t + 0.5 && foe(me, q) && !q.dead && dist2D(me.p, q.p) < 20 && q.id !== b.targetId);
  if (t >= b.retargetAt || knocked || !world.players.get(b.targetId) || world.players.get(b.targetId).dead) {
    let best = null, bs = Infinity;
    for (const q of world.players.values()) {
      if (q === me || q.dead || !foe(me, q) || smokeHides(me.p, q.p)) continue;
      let s = dist2D(me.p, q.p) + q.hp * 0.06;
      if (q.id === me.lastHitBy) s -= 7;
      if (!q.bot) s -= 3;
      if (!hasLOS(me.p, q.p)) s += 6;
      if (q.knockUntil > t) s -= 10;   // round 10: knocked flat, a free punish
      if (shielded(q, t)) s += 12;     // just respawned: shoot someone else meanwhile
      if (s < bs) { bs = s; best = q; }
    }
    if (best?.id !== b.targetId) b.decoyId = null;
    b.targetId = best ? best.id : null;
    b.retargetAt = t + rand(1.5, 3);
  }
  if (b.targetId != null && !foe(me, world.players.get(b.targetId))) b.targetId = null;   // gone, or the intermission
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

  // ---- defence: a charging ram is the deadliest thing in the arena
  let reacted = false;
  for (const g of world.rams) {
    const key = 'ram' + g.id;
    if (g.state !== 'charge' || g.mode === 'mount' || g.owner === me.id || !foeId(me, g.owner)) { b.threats.delete(key); continue; }
    const vx = Math.sin(g.yaw) * C.RAM.chargeSpeed, vz = Math.cos(g.yaw) * C.RAM.chargeSpeed;
    const rx = g.x - me.p[0], rz = g.z - me.p[2];
    const tc = -(rx * vx + rz * vz) / (C.RAM.chargeSpeed ** 2);
    const miss = Math.hypot(rx + vx * tc, rz + vz * tc);
    const homing = g.target === me.id;
    if (tc <= 0 || tc > 1.7 || (!homing && miss > C.RAM.radius + C.PLAYER_RADIUS + 0.6)) continue;
    let rec = b.threats.get(key);
    if (!rec) { rec = newThreat(cfg, t); b.threats.set(key, rec); }
    b.ramDanger = t + 0.3;
    if (rec.handled || rec.ignore || reacted || t < rec.seenAt + rec.react) continue;
    rec.handled = true; reacted = true;
    respondRam(me, world, g, [vx, 0, vz], tc, t, act);
  }
  for (const id of b.threats.keys()) if (typeof id === 'number' && !world.projectiles.has(id)) b.threats.delete(id);
  for (const proj of world.projectiles.values()) {
    if (proj.owner === me.id || !foeId(me, proj.owner)) continue;   // a teammate's flies through us
    const th = threatOf(me, proj);
    // at a walk a sidestep takes a while: start judging a shot earlier than at the old run speed
    if (!th || th.tc > 2.4 || th.miss > C.HIT_RADIUS + proj.radius + 0.5) continue;
    let rec = b.threats.get(proj.id);
    if (!rec) { rec = newThreat(cfg, t); b.threats.set(proj.id, rec); }
    if (rec.handled || rec.ignore || reacted || t < rec.seenAt + rec.react) continue;
    rec.handled = true; reacted = true;
    respond(me, world, t, proj, th, act);
  }
  // an enemy spinning up a cyclone close by: get out of the radius (or up, out of reach)
  for (const q of world.players.values()) {
    const key = 'cyc' + q.id;
    if (q === me || q.dead || !foe(me, q) || !cycloneWindingUp(q) || airborne(me, t) || dist2D(me.p, q.p) > CYC.radius + 0.5) { b.threats.delete(key); continue; }
    let rec = b.threats.get(key);
    if (!rec) { rec = newThreat(cfg, t); b.threats.set(key, rec); }
    if (rec.handled || rec.ignore || reacted || t < rec.seenAt + rec.react) continue;
    rec.handled = true; reacted = true;
    respondCyclone(me, q, t, act);
  }
  // an enemy Sanguine Lash winding up, pointed at us: wall it, ward it, or step off the line as it fires
  for (const q of world.players.values()) {
    const key = 'lash' + q.id;
    if (q === me || q.dead || !q.lash || !foe(me, q)) { b.threats.delete(key); continue; }
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
    if (f.owner === me.id || !foeId(me, f.owner) || df > FROST.radius + 0.6) { b.threats.delete(key); continue; }
    let rec = b.threats.get(key);
    if (!rec) { rec = newThreat(cfg, t); b.threats.set(key, rec); }
    if (rec.handled || rec.ignore || t < rec.seenAt + rec.react) continue;
    rec.handled = true;
    respondFrostfall(me, f, df, t, act);
  }

  // ---- enemy ultimates: meteors falling, a tornado, a rune flare, a stampede lane
  reactToUltimates(me, world, t, act);
  reactToStampedes(me, world, t, act);

  // ---- maintain ongoing actions
  if (me.blocking && (t >= b.blockUntil || (me.st < 15 && !b.faceRam))) { act({ t: 'block', on: false }); b.faceRam = null; }
  if (!me.blocking) b.faceRam = null;
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
  if (me.mrain) return flyMeteorRain(me, world, t, act);
  if (me.blizz) return steerBlizzard(me, world, t);
  if (me.eye || me.ultWind || me.mrainFall || me.ride) return;   // our tornado, wind-up, fall or ram ride: nothing else (moveBot steers)

  // ---- our ultimate, when it's worth it
  if (b.ultFullAt == null && me.ult >= C.ULT_CHARGE.max) b.ultFullAt = t;
  if (me.ult < C.ULT_CHARGE.max) b.ultFullAt = null;
  if (free && b.ultFullAt != null && !me.blocking && !busyCasting(me) && !me.carrying && t >= (b.nextUltCheck || 0)) {
    b.nextUltCheck = t + cfg.think * rand(0.7, 1.3);
    if (Math.random() < cfg.aggression && tryUltimate(me, world, t, act, target)) return;
  }

  if (!free || !target || me.blocking || me.charging || me.cyclone || me.lash || t < (b.ramDanger || 0)) return;
  // a cast roots us: finish a dodge first, cast from where we mean to stand (a wind-up to punish is worth stopping for)
  if (t < b.dodgeUntil && !busyCasting(target)) return;
  const meAir = airborne(me, t);

  const carried = me.carrying ? world.props.get(me.carrying) : null;

  // a veiled Gale swallows everything for 3 s: don't waste shots, wait it out (movement backs off)
  if (veiled(target, t)) return;
  if (shielded(target, t)) return;   // spawn protection: hold fire (it ends the moment they attack)
  // a Ram Guard turns our shots into rams charging back at us: hold fire until it's gone
  if (guarded(target, t) && !target.decoy) return;

  // ---- punish a meteor, lash or cyclone wind-up with a spark (interrupts it)
  if (busyCasting(target) && los && d < 26) {
    if (!b.chargeSeen.has(target.id)) b.chargeSeen.set(target.id, { at: t, go: Math.random() < cfg.punish });
    const seen = b.chargeSeen.get(target.id);
    if (seen.go && t >= seen.at + cfg.react) {
      if (carried?.state === 'carried' && t >= me.cd.throw && throwLOS(me, target) && (!match || match.canThrow(me, carried) !== false)) return throwProp(me, target, act, cfg, world);
      if (!me.carrying && primaryReady(me, t)) return primary(me, target, act, cfg, world, t);   // shots 1–2, then the finisher
    }
  } else b.chargeSeen.delete(target.id);

  // ---- cyclone: spin as soon as they're inside the radius (a ward facing us blocks it, so
  // prefer them stunned, busy or turned away)
  const targetAir = airborne(target, t);
  if (K.power === 'cyclone' && t >= me.cd.power && !me.carrying && !targetAir && d < 4.5 && los) {
    const busy = isStunned(target, t) || busyCasting(target) || rooted(target, t);
    const warded = target.blocking && target.st > CYC.staminaCost && facing(target, me.p);
    if ((busy || !warded) && Math.random() < cfg.aggression * 0.3) { act({ t: 'cyclone' }); b.diveUntil = 0; return; }
  }

  if (t < b.nextThink) return;
  b.nextThink = t + cfg.think * rand(0.7, 1.3);

  // ---- holding a prop: throw when they're busy, or after a moment
  if (carried) {
    if (carried.state !== 'carried' || t < me.cd.throw) return;
    if (match && match.canThrow(me, carried) === false) return;   // a mode that forbids hurling it: keep holding it
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
    if (rollReady(me, t) && Math.random() < 0.3 * Math.max(cfg.dodge, 0.5)) return rollAway(me, away, act);
    if (canAirJump(me, t) && Math.random() < 0.3 * (cfg.airJump ?? 0)) return act({ t: 'jump', n: 2, y0: me.p[1] });   // round 13: up and away
    if (wallReady(me, t) && d > 3.5 && Math.random() < 0.4 * cfg.dodge) return raiseWall(me, target.p, act);
    if (K.mobility === 'ram_ride' && mobilityReady(me, t) && Math.random() < 0.35 * Math.max(cfg.dodge, 0.5)) return rideAway(me, away, act);
    if (K.mobility === 'flask_step' && mobilityReady(me, t) && Math.random() < 0.35 * Math.max(cfg.dodge, 0.5)) return flaskEscape(me, target, away, act);
  }

  if (Math.random() > cfg.aggression) return;

  // ---- Trapped Relic (traps only): with a trap to spare, or both far from the fight, curse a prop where they're likely to walk
  if (K.utility === 'trapped_relic' && t >= b.nextCurse && t >= me.cd.lift && !target.decoy) {
    b.nextCurse = t + rand(2, 4);
    const mine = [...world.props.values()].filter(pr => pr.cursedBy === me.id && pr.state === 'idle');
    if (mine.length < RELIC.traps || mine.every(pr => dist2D([pr.x, 0, pr.z], target.p) > 14)) {
      const prop = curseCandidate(me, target, world, mine);
      if (prop) { b.cursing = { prop: prop.id, at: t + RELIC.hold }; b.nextCurse = t + rand(4, 8); me.yaw = yawTo(me.p, [prop.x, 0, prop.z]); return; }
    }
  }
  const tk = K.utility === 'telekinesis';   // round 12: only Telekinesis lifts and throws

  // ---- telekinesis: grab a prop that's roughly between us and them
  if (tk && t >= me.cd.lift && Math.random() < cfg.tk) {
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
  // (Black Death blocks from every side, and every blocked shot charges her whip)
  const targetWarded = target.blocking && target.st > 30 && (facing(target, me.p) || !!C.SPELLBOOK[kit(target).guard]?.allSides);
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
      if (veilReady(me, t) && d > 4.5 && d < 9 && cfg.blinkDodge) { act({ t: 'veil' }); return; }   // the veil lasts 2 s: only from where she can close in
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
  } else if (K.power === 'toxic_flask' && powerReady && !targetAir && !me.carrying && d < TOXIC.range - 1) {
    // a pool where they stand: best on someone stuck, busy or in a group
    const stuck = targetStunned || rooted(target, t) || busyCasting(target) || target.slowUntil > t;
    const group = foesNear(me, world, target.p, TFLASK.radius, t, { ground: true }).length >= 2;
    if (stuck || group || Math.random() < 0.3) { lob(me, target, act, cfg, world, 'toxic', TOXIC); if (me.cd.power > t) return; }
  } else if (K.power === 'battering_ram' && powerReady && !targetAir && !me.carrying && d > 3 && d < C.RAM.chargeSpeed * BRAM.maxTime - 3) {
    // Battering Ram: a straight line the target can't easily leave (stuck, busy, slowed) or from close in; not into a ward
    const stuck = targetStunned || rooted(target, t) || busyCasting(target) || target.slowUntil > t;
    // round 14: no longer a one-shot (70 and a knockdown): best as a finisher, or to set one up from close in
    const finisher = target.hp <= C.D(BRAM.damage);
    if ((stuck || d < 9 || (finisher && Math.random() < 0.6) || Math.random() < 0.25) && !targetWarded && !veiled(target, t)) {
      const from = [me.p[0], 0.7, me.p[2]];
      const dir = aimAt(me, from, target, C.RAM.chargeSpeed, 0, cfg);
      if (!lowLineBlocked([me.p[0], 0.7, me.p[2]], [dir[0], 0, dir[2]], d, C.RAM.radius * 0.6)) {
        me.yaw = Math.atan2(dir[0], dir[2]);
        act({ t: 'ram', dir: [dir[0], 0, dir[2]] });
        return;
      }
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

  // Ram Ride: gallop straight at a close target for the shove, now and then
  if (K.mobility === 'ram_ride' && mobilityReady(me, t) && d > 4 && d < 18 && me.hp > 50 && Math.random() < 0.08 * cfg.aggression) {
    me.yaw = yawTo(me.p, target.p);
    b.rideGoal = [target.p[0], target.p[2]];   // ride through them, off on the far side
    act({ t: 'ride', yaw: me.yaw });
    return;
  }
  // Skyward Flash: sometimes take the high ground and rain sparks down.
  if (K.mobility === 'skyward' && cfg.blinkDodge && mobilityReady(me, t) && d > 7 && d < 18 && me.hp > 40 && Math.random() < 0.06) {
    act({ t: 'skyward' });
    return;
  }
  // Round 13: now and then hop first and fire from the air (the next decision, mid-jump); Hard bots more often
  if (fastReady && canJump(me, t) && d > 5 && Math.random() < (cfg.airCast ?? 0)) {
    act({ t: 'jump' });
    if (Math.random() < 0.4 * (cfg.airJump ?? 0)) b.ledgeAirJumpAt = t + C.JUMP.airTime * 0.45;   // and up again at the top
    return;
  }
  // The primary: the bread and butter. Against a raised ward sparks still drain stamina.
  if (fastReady && !savingFinisher && (!targetWarded || Math.random() < 0.5)) return primary(me, target, act, cfg, world, t);
}

// ---------------------------------------------------------------- ultimates
// Visible enemies (no smoke between us) within `r` of `at`, on the ground (`ground`) or anywhere.
function foesNear(me, world, at, r, t, { ground = false, sight = false } = {}) {
  return [...world.players.values()].filter(q => foe(me, q) && !q.dead && dist2D(q.p, at) < r && !smokeHides(me.p, q.p)
    && (!ground || !airborne(q, t)) && (!sight || !C.pillarBlocks(me.p, q.p, 0)));
}

// Fire the ultimate if the moment is right: clustered enemies, or (after holding a full charge for a while)
// a single good target. Returns true if cast.
function tryUltimate(me, world, t, act, target) {
  const b = me.bot, cfg = b.cfg, U = kit(me).ultimate;
  const patient = t - b.ultFullAt > 12;   // sitting on a full charge: settle for one target
  // every ultimate has a 1.3 s wind-up that an interrupt fizzles: don't pop one in the open while an enemy in sight
  // holds a loaded finisher or a prop ready to throw at us
  const exposed = [...world.players.values()].some(q => foe(me, q) && !q.dead && dist2D(q.p, me.p) < 24 && hasLOS(q.p, me.p)
    && ((q.ammo === 1 && !(q.reloadUntil > t)) || (q.carrying && world.props.get(q.carrying)?.state === 'carried')) && !busyCasting(q) && !isStunned(q, t));
  if (exposed && Math.random() < 0.85) return false;
  const lowHp = me.hp < 45;
  if (U === 'stampede') {
    // the lane (from us toward an enemy) that runs over the most grounded enemies
    let best = null, bn = 0;
    for (const q of foesNear(me, world, me.p, STAMP.length - 2, t, { ground: true })) {
      const dir = [q.p[0] - me.p[0], 0, q.p[2] - me.p[2]], l = Math.hypot(dir[0], dir[2]) || 1;
      const n = foesNear(me, world, me.p, STAMP.length, t, { ground: true }).filter(o => inLane(o.p, me.p, [dir[0] / l, 0, dir[2] / l], STAMP.width - 1, STAMP.length - 2)).length;
      const score = n + (rooted(q, t) || isStunned(q, t) || busyCasting(q) ? 0.6 : 0);
      if (score > bn) { bn = score; best = q; }
    }
    if (!best || !(bn >= 2 || (patient && bn >= 1) || (bn >= 1.6))) return false;
    me.yaw = yawTo(me.p, best.p);
    act({ t: 'ult', at: [best.p[0], best.p[2]] });
    return me.ult < C.ULT_CHARGE.max;
  }
  if (U === 'berserker_brew') {
    // drink when there's a fight to win: an enemy in reach and sight, and the health to use it
    if (!target || target.dead || dist2D(me.p, target.p) > 18 || !hasLOS(me.p, target.p) || me.hp < 40) return false;
    act({ t: 'ult' });
  } else if (U === 'meteor_rain') {
    // leap when someone is reachable: we'll pick the spot from up there
    if (airborne(me, t) || !foesNear(me, world, me.p, MRAIN.range - 2, t, { ground: true }).length) return false;
    b.mrainCommit = null;
    act({ t: 'ult' });
  } else if (U === 'blizzard') {
    // the facing that puts the most enemies in the cone
    if (airborne(me, t)) return false;
    const near = foesNear(me, world, me.p, BLIZ.range - 2, t, { sight: true });
    let bestYaw = null, bn = 0;
    for (const q of near) {
      const yaw = yawTo(me.p, q.p);
      const n = near.filter(o => Math.abs(Math.atan2(Math.sin(yawTo(me.p, o.p) - yaw), Math.cos(yawTo(me.p, o.p) - yaw))) < BLIZ.cone / 2 * Math.PI / 180 * 0.8).length;
      if (n > bn) { bn = n; bestYaw = yaw; }
    }
    if (bestYaw == null || !(bn >= 2 || (bn >= 1 && (patient || lowHp)))) return false;
    me.yaw = bestYaw;
    act({ t: 'ult' });
  } else if (U === 'eye_of_storm') {
    const n = foesNear(me, world, me.p, EYE.radius - 0.5, t, { ground: true }).length;
    if (!(n >= 2 || (n >= 1 && (patient || lowHp) && dist2D(me.p, target?.p || [1e9, 0, 1e9]) < 4.5))) return false;
    act({ t: 'ult' });
  } else if (U === 'night_cage') {
    // cage the most enemies we can (centred on them), or one weak or stuck target; we fight on inside with them
    let best = null, bn = 0;
    for (const q of foesNear(me, world, me.p, CAGE.range, t, { ground: true })) {
      const n = foesNear(me, world, q.p, CAGE.radius - 2, t, { ground: true });
      // it heals us and our teammates inside: a fight our side is in (and hurt) is worth more
      const mates = [...world.players.values()].filter(o => !o.dead && o !== me && !foe(me, o) && dist2D(o.p, q.p) < CAGE.radius - 1);
      const selfIn = dist2D(me.p, q.p) < CAGE.radius - 1;
      const healValue = mates.reduce((v, o) => v + (o.hp < 70 ? 0.6 : 0.3), 0) + (selfIn && me.hp < 70 ? 0.5 : 0);
      const score = n.length + (q.hp < 45 || rooted(q, t) || isStunned(q, t) ? 0.6 : 0) + healValue;
      if (score > bn) { bn = score; best = n; }
    }
    if (!best || !(bn >= 2 || (patient && bn >= 1)) || (me.hp < 30 && bn < 2)) return false;
    let x = 0, z = 0;
    for (const q of best) { x += q.p[0]; z += q.p[2]; }
    x /= best.length; z /= best.length;
    me.yaw = yawTo(me.p, [x, 0, z]);
    act({ t: 'ult', at: [x, z] });
  } else return false;
  return me.ult < C.ULT_CHARGE.max;
}

// Enemy ultimates: run from a tornado, get out of a Blizzard's cone (or behind cover), and clear out of the circle
// a hovering Meteor Rain is aiming at.
function reactToUltimates(me, world, t, act) {
  const b = me.bot, cfg = b.cfg, K = kit(me);
  if (me.eye || me.blizz || me.mrain) return;
  const run = C.speedOf() * cfg.speed * (me.slowUntil > t ? 1 - SKIM.slow : 1);
  const canMove = !rooted(me, t) && !isStunned(me, t);
  const mobOut = (dir) => {
    if (!cfg.blinkDodge || !canAct(me, t)) return false;
    if (rollReady(me, t)) rollAway(me, dir, act);   // (round 13: Roll is a Utility, ready apart from the mobility slot)
    else if (!mobilityReady(me, t)) { if (canAirJump(me, t)) act({ t: 'jump', n: 2, y0: me.p[1] }); else return false; }
    else if (K.mobility === 'mirror_step') mirrorStep(me, dir, act);
    else if (K.mobility === 'blink') blinkAway(me, dir, act);
    else if (K.mobility === 'smoke_screen') smokeAway(me, dir, act);
    else if (canAirJump(me, t)) act({ t: 'jump', n: 2, y0: me.p[1] });   // round 13: no dash: at least the air jump's hop
    else return false;
    return true;
  };
  const threat = (key) => { let rec = b.threats.get(key); if (!rec) { rec = newThreat(cfg, t); b.threats.set(key, rec); } return rec; };
  for (const k of b.threats.keys()) if (typeof k === 'string' && /^(eye|bliz|mrain)/.test(k) && t > (b.threats.get(k).until ?? Infinity)) b.threats.delete(k);

  for (const q of world.players.values()) {
    if (q === me || q.dead || !foe(me, q)) continue;
    // Eye of the Storm: keep well away from the tornado
    if (q.eye) {
      const rec = threat('eye' + q.id); rec.until = q.eye.until + 0.3;
      const d = dist2D(me.p, q.p);
      if (rec.ignore || t < rec.seenAt + rec.react || d > EYE.radius + 4) continue;
      const out = d > 0.05 ? [(me.p[0] - q.p[0]) / d, 0, (me.p[2] - q.p[2]) / d] : [1, 0, 0];
      if (d < EYE.radius + 0.5 && !rec.mob) {
        if (veilReady(me, t)) { act({ t: 'veil' }); rec.mob = true; }
        else if (K.mobility === 'skyward' && cfg.blinkDodge && mobilityReady(me, t) && canAct(me, t)) { act({ t: 'skyward' }); rec.mob = true; }
        else if (mobOut(out)) rec.mob = true;
      }
      if (canMove) { b.dodgeVec = [out[0], out[2]]; b.dodgeUntil = t + 0.25; }
    }
    // Blizzard: sideways out of the cone (it turns slowly), or behind cover; a Veil shrugs it off
    if (q.blizz || (q.ultWind?.U === 'blizzard')) {
      const yaw = q.blizz ? q.blizz.yaw : q.yaw;
      const dx = me.p[0] - q.p[0], dz = me.p[2] - q.p[2], d = Math.hypot(dx, dz);
      const off = Math.atan2(Math.sin(Math.atan2(dx, dz) - yaw), Math.cos(Math.atan2(dx, dz) - yaw));
      const rec = threat('bliz' + q.id); rec.until = t + 0.5;
      if (rec.ignore || t < rec.seenAt + rec.react || d > BLIZ.range + 2 || Math.abs(off) > BLIZ.cone / 2 * Math.PI / 180 + 0.25 || C.pillarBlocks(q.p, me.p, 0)) continue;
      if (veilReady(me, t) && q.blizz) { act({ t: 'veil' }); continue; }
      if (wallReady(me, t) && canAct(me, t) && d > BULWARK.dist + 0.6) { raiseWall(me, q.p, act); continue; }
      const side = Math.sign(off) || b.strafe;
      const out = [Math.sin(yaw + side * Math.PI / 2), 0, Math.cos(yaw + side * Math.PI / 2)];
      if (!rec.mob && mobOut(out)) { rec.mob = true; continue; }
      if (!canMove) continue;
      // the shorter way out: across the cone's edge on our side, unless cover is closer
      const cover = coverPoint(me, q);
      const to = cover && Math.hypot(cover[0] - me.p[0], cover[1] - me.p[2]) < 4 ? [cover[0] - me.p[0], cover[1] - me.p[2]] : [out[0], out[2]];
      const l = Math.hypot(to[0], to[1]) || 1;
      b.dodgeVec = [to[0] / l, to[1] / l]; b.dodgeUntil = t + 0.25;
    }
    // Meteor Rain: she shows where she's aiming; get out of that circle (she may switch, so keep watching)
    if (q.mrain && q.mrain.at) {
      const [cx, cz] = q.mrain.phase === 'dive' ? [q.mrain.diveTo[0], q.mrain.diveTo[2]] : q.mrain.at;
      const dc = Math.hypot(me.p[0] - cx, me.p[2] - cz);
      const rec = threat('mrain' + q.id); rec.until = t + 0.5;
      if (rec.ignore || t < rec.seenAt + rec.react || dc > MRAIN.radius + 2.5) continue;
      const out = dc > 0.05 ? [(me.p[0] - cx) / dc, 0, (me.p[2] - cz) / dc] : [Math.sin(me.yaw), 0, Math.cos(me.yaw)];
      if (veilReady(me, t) && q.mrain.phase === 'dive') { act({ t: 'veil' }); continue; }
      if (!rec.mob && dc < MRAIN.radius + 0.5 && mobOut(out)) { rec.mob = true; continue; }
      if (canMove) { b.dodgeVec = [out[0], out[2]]; b.dodgeUntil = t + 0.25; }
    }
    // (a Night Cage needs no reaction: the server keeps everyone on their side)
  }
}

const LASH_RANGE = C.SPELLS.lash.speed * C.SPELLS.lash.life;

// Meteor Rain, from up there: aim at the best target (where it will be by the time we land), and dive after a short
// look (sooner if they're stuck); the server dives on its own at the end of the hover.
function flyMeteorRain(me, world, t, act) {
  const b = me.bot, M = me.mrain;
  if (M.phase !== 'hover') return;
  b.mrainCommit ??= t + rand(0.6, 1.8);
  let best = null, bs = -Infinity;
  for (const q of world.players.values()) {
    if (!foe(me, q) || q.dead || airborne(q, t) || dist2D(q.p, [M.from[0], 0, M.from[1]]) > MRAIN.range) continue;
    const near = [...world.players.values()].filter(o => foe(me, o) && !o.dead && dist2D(o.p, q.p) < MRAIN.radius).length;
    const sc = near * 2 - q.hp * 0.02 + (rooted(q, t) || isStunned(q, t) ? 1.5 : 0);
    if (sc > bs) { bs = sc; best = q; }
  }
  if (!best) return;
  const tr = tracks.get(best.id), lead = (MRAIN.dive + 0.1) * b.cfg.lead;
  const at = [best.p[0] + (tr ? tr.v[0] : 0) * lead, best.p[2] + (tr ? tr.v[1] : 0) * lead];
  act({ t: 'mrainAim', at });
  if (t >= b.mrainCommit || rooted(best, t) || isStunned(best, t)) { b.mrainCommit = null; act({ t: 'mrainDive', at }); }
}
// Blizzard: keep the cone on the nearest enemies (the server turns it slowly toward our facing).
function steerBlizzard(me, world, t) {
  let best = null, bd = BLIZ.range + 3;
  for (const q of world.players.values()) if (foe(me, q) && !q.dead && !(q.frozenUntil > t) && dist2D(q.p, me.p) < bd && hasLOS(me.p, q.p)) { bd = dist2D(q.p, me.p); best = q; }
  if (best) me.yaw = yawTo(me.p, best.p);
}

// Is `p` inside the lane that starts at `from` and runs `len` along `dir`, `width` wide?
function inLane(p, from, dir, width, len) {
  const dx = p[0] - from[0], dz = p[2] - from[2];
  const along = dx * dir[0] + dz * dir[2], side = -dx * dir[2] + dz * dir[0];
  return along > -1 && along < len && Math.abs(side) < width / 2;
}
// Standing in an enemy Stampede lane: get out sideways (the nearer edge), or wall, veil, ward or flash out of it.
function reactToStampedes(me, world, t, act) {
  const b = me.bot, cfg = b.cfg, K = kit(me);
  for (const st of world.stampedes?.values() || []) {
    if (!foeId(me, st.owner)) continue;
    const key = 'stamp' + st.id;
    if (!inLane(me.p, st.p, st.dir, STAMP.width + 2 * C.PLAYER_RADIUS + 0.6, STAMP.length + 2)) { b.threats.delete(key); continue; }
    let rec = b.threats.get(key);
    if (!rec) { rec = newThreat(cfg, t); b.threats.set(key, rec); }
    if (rec.ignore || t < rec.seenAt + rec.react) continue;
    const dx = me.p[0] - st.p[0], dz = me.p[2] - st.p[2];
    const side = -dx * st.dir[2] + dz * st.dir[0];
    const s = Math.sign(side) || b.strafe;
    const out = [-st.dir[2] * s, 0, st.dir[0] * s];
    const need = STAMP.width / 2 + C.PLAYER_RADIUS + 0.6 - Math.abs(side);
    const time = st.at + (dx * st.dir[0] + dz * st.dir[2]) / C.RAM.chargeSpeed - t;   // until the first ram reaches us
    if (!rec.mob && need > time * C.speedOf() * cfg.speed) {
      rec.mob = true;
      if (veilReady(me, t)) { act({ t: 'veil' }); continue; }
      if (K.mobility === 'skyward' && cfg.blinkDodge && mobilityReady(me, t)) { act({ t: 'skyward' }); continue; }
      if (cfg.blinkDodge && rollReady(me, t) && canAct(me, t)) { rollAway(me, out, act); continue; }
      if (cfg.blinkDodge && mobilityReady(me, t) && canAct(me, t)) {
        if (K.mobility === 'blink') { blinkAway(me, out, act); continue; }
        if (K.mobility === 'mirror_step') { mirrorStep(me, out, act); continue; }
        if (K.mobility === 'smoke_screen') { smokeAway(me, out, act); continue; }
      }
    }
    if (rooted(me, t) || isStunned(me, t)) continue;
    b.dodgeVec = [out[0], out[2]]; b.dodgeUntil = t + 0.25;
  }
}

// Flask Step out of trouble: lob high over the nearest big cover (so it lands behind it, out of the enemy's sight),
// else a plain lob straight away. The landing is checked with the same path the server will fly.
function flaskEscape(me, threat, away, act) {
  const F = C.SPELLS.flaskstep, origin = [me.p[0], me.p[1] + 1.3, me.p[2]];
  let dir = null;
  // the nearest few spots behind big cover (as seen from the threat), 5 m to the throw's range away
  const spots = [];
  for (const pil of C.COLLIDERS) {
    if (pil.h < 2.5 || pil.r < 0.8) continue;
    const ax = pil.x - threat.p[0], az = pil.z - threat.p[2], al = Math.hypot(ax, az) || 1;
    const pt = [pil.x + ax / al * (pil.r + 1.3), pil.z + az / al * (pil.r + 1.3)];
    const dc = Math.hypot(pt[0] - me.p[0], pt[1] - me.p[2]);
    if (dc > 5 && dc < F.range - 2 && Math.hypot(pt[0], pt[1]) < C.ARENA_RADIUS - 2) spots.push({ pt, dc });
  }
  spots.sort((a, b) => a.dc - b.dc);
  for (const { pt } of spots.slice(0, 5)) {
    const d = C.lobAt(origin, [pt[0], 0, pt[1]], F.speed, F.gravity, true);
    if (!d) continue;
    const { at } = C.flaskPath(origin, d);
    // it has to come down where the threat can't see us
    if (Math.hypot(at[0] - pt[0], at[2] - pt[1]) < 2.5 && C.pillarBlocks(threat.p, at, 0)) { dir = d; break; }
  }
  if (!dir) {
    const dd = inward(me, away);
    dir = C.lobAt(origin, [me.p[0] + dd[0] * 14, 0, me.p[2] + dd[2] * 14], F.speed, F.gravity, false) || C.flaskLaunch([dd[0], 0, dd[2]]);
  }
  me.yaw = Math.atan2(dir[0], dir[2]);
  act({ t: 'flaskStep', dir });
}

// Ram Ride away from a threat (the ride goes where we face).
function rideAway(me, dir, act) {
  const d = inward(me, dir);
  me.yaw = Math.atan2(d[0], d[2]);
  me.bot.rideGoal = [me.p[0] + d[0] * 13, me.p[2] + d[2] * 13];   // far enough to be safe, then off
  act({ t: 'ride', yaw: me.yaw });
}
// An enemy Firewall between `from` and `to`: our shot would burn up in it.
function firewallInWay(me, world, from, to) {
  for (const w of world.firewalls?.values() || []) {
    if (!foeId(me, w.owner)) continue;
    const a = C.firewallLocal(w, from), b2 = C.firewallLocal(w, to);
    if (Math.sign(a.across) === Math.sign(b2.across)) continue;
    const k = a.across / (a.across - b2.across);
    if (Math.abs(a.along + (b2.along - a.along) * k) < FIREWALL.width / 2 + 0.4) return true;
  }
  return false;
}
const newThreat = (cfg, t) => ({ seenAt: t, react: cfg.react * rand(0.8, 1.3), handled: false, ignore: Math.random() > cfg.dodge });

// Our primary spell at the target: a spark, or a Glacial Skim fan along the ground.
function primary(me, target, act, cfg, world, t) {
  const P = kit(me).primary, d = dist2D(me.p, target.p);
  if (P === 'glacial_skim') return skim(me, target, act, cfg, world, t);
  if (P === 'hex_shards') return d < HEX.range ? hex(me, target, act, cfg, world) : undefined;
  if (P === 'gale_shear') return d < SHEAR_RANGE - 0.5 ? bolt(me, target, act, cfg, world, 'shear') : undefined;
  if (P === 'fireball') return d < FIRE.speed * FIRE.life - 2 ? bolt(me, target, act, cfg, world, 'fireball') : undefined;
  if (P === 'potion_toss') return d < POTION.range - 2 ? lob(me, target, act, cfg, world, 'cast', POTION, { kind: 'potion' }) : undefined;
  if (P === 'sling') return d < SLING_S.speed * SLING_S.life - 2 ? bolt(me, target, act, cfg, world, 'sling') : undefined;
  if (d < 28) return bolt(me, target, act, cfg, world, 'fast');
}

// A straight primary bolt: Spark, Fireball or Gale Shear.
function bolt(me, target, act, cfg, world, kind) {
  const spec = C.SPELLS[kind];
  const from = [me.p[0], me.p[1] + 1.3, me.p[2]];
  const dir = aimAt(me, from, target, spec.speed, 0, cfg);
  if (lineBlocked(from, dir, dist2D(me.p, target.p), Math.min(spec.radius, 0.5))) return;
  if (firewallInWay(me, world, from, target.p) || smokeFlaskInWay(me, world, from, target.p)) return;
  me.yaw = yawTo(me.p, target.p);
  act({ t: 'cast', kind, dir });
}

// A lobbed potion (Potion Toss, Toxic Flask) onto where the target will be.
function lob(me, target, act, cfg, world, msgType, spec, extra = {}) {
  const from = [me.p[0], me.p[1] + 1.3, me.p[2]];
  if (smokeFlaskInWay(me, world, from, target.p) || firewallInWay(me, world, from, target.p)) return;
  if (C.pillarBlocks(from, target.p, 0.2)) return;
  const dir = aimAt(me, from, target, spec.speed, spec.gravity, cfg);
  me.yaw = yawTo(me.p, target.p);
  act({ t: msgType, ...extra, dir, origin: from });
}

// Hex Shards curve in on the aim point, so the bot sends where the target will be (led by the curve's flight time).
// Curves bend around thin cover, so only the end of the flight needs to be clear.
function hex(me, target, act, cfg, world) {
  const from = [me.p[0], me.p[1] + 1.3, me.p[2]];
  const d = Math.hypot(target.p[0] - from[0], target.p[2] - from[2]);
  const dir = aimAt(me, from, target, HEX.speed / 1.15, 0, cfg);
  const to = [from[0] + dir[0] * d, Math.max(0.6, from[1] + dir[1] * d), from[2] + dir[2] * d];
  if (C.pillarBlocks([to[0] - dir[0] * 4, 0, to[2] - dir[2] * 4], to, 0.2) || firewallInWay(me, world, from, to)) return;
  me.yaw = yawTo(me.p, target.p);
  act({ t: 'cast', kind: 'hex', dir, target: to });
}

// The shards fly at ankle height, so anything in the air is out of reach and fences and crops are walls.
function skim(me, target, act, cfg, world, t) {
  const range = dist2D(me.p, target.p);
  if (airborne(target, t) || range > SKIM.speed * SKIM.life - 3) return;
  const from = [me.p[0], SKIM.height, me.p[2]];
  const dir = aimAt(me, from, target, SKIM.speed, 0, cfg);
  const flat = [dir[0], 0, dir[2]];
  if (lowLineBlocked(from, flat, range, SKIM.radius) || lineBlocked(from, flat, range, SKIM.radius) || firewallInWay(me, world, from, target.p)) return;
  me.yaw = yawTo(me.p, target.p);
  act({ t: 'cast', kind: 'skim', dir: flat });
}

function throwProp(me, target, act, cfg, world) {
  me.yaw = yawTo(me.p, target.p);
  const from = C.holdPoint(me.p, me.yaw);
  const dir = aimAt(me, from, target, C.SPELLS.prop.speed, C.SPELLS.prop.gravity, cfg);
  if (lineBlocked(from, dir, dist2D(from, target.p), C.SPELLS.prop.radius) || firewallInWay(me, world, from, target.p)) return;
  act({ t: 'throw', dir });   // already gravity-compensated, so no aim point for the server to re-solve
}

// Turn to a prop and hand `send` the aim ray at it (for a pickup or a curse).
function aimProp(me, prop, send) {
  const from = [me.p[0], me.p[1] + 1.3, me.p[2]];
  const c = [prop.x, C.PROP_TYPES[prop.type].h * 0.5, prop.z];
  me.yaw = yawTo(me.p, c);
  send(from, [c[0] - from[0], c[1] - from[1], c[2] - from[2]]);
}

// Would a shot along `dir` clip a pillar or tree within `range` metres?
function lineBlocked(from, dir, range, radius) {
  const l = Math.hypot(dir[0], dir[2]) || 1;
  // along the real aim (it may climb to a target on a platform); pillarBlocks adds body height to the ends, so take it off
  const to = [from[0] + dir[0] / l * range, from[1] + (dir[1] || 0) / l * range - 1.1, from[2] + dir[2] / l * range];
  return !!C.pillarBlocks([from[0], from[1] - 1.1, from[2]], to, radius + 0.15);
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
  return [...world.players.values()].some(q => q !== me && q.id !== target.id && !q.dead && foe(me, q) && !airborne(q, t)
    && segDist(me.p, end, { x: q.p[0], z: q.p[2] }) < 1 && dist2D(me.p, q.p) > 3);
}

// A ram is charging at us: flash up out of reach, spin it dizzy if the cyclone lands first, wall it
// off, ward facing it if we can afford it, else blink, mirror-step or dive aside.
function respondRam(me, world, g, vel, tc, t, act) {
  const b = me.bot, K = kit(me);
  if (me.charging) act({ t: 'chargeRelease', dir: [Math.sin(me.yaw), 0, Math.cos(me.yaw)] });   // abandon the meteor
  if (me.lash) act({ t: 'lashRelease', dir: [Math.sin(me.yaw), 0, Math.cos(me.yaw)] });          // and the lash
  if (!canAct(me, t) || airborne(me, t) || me.cyclone) return;
  if (K.mobility === 'skyward' && b.cfg.blinkDodge && mobilityReady(me, t)) return act({ t: 'skyward' });
  if (world.cycloneStopsRams && K.power === 'cyclone' && t >= me.cd.power && !me.carrying
      && tc > CYC.windup + 0.05 && tc * C.RAM.chargeSpeed < CYC.windup * C.RAM.chargeSpeed + CYC.radius) return act({ t: 'cyclone' });
  if (veiled(me, t)) return;   // it bounces off the veil
  if (veilReady(me, t)) return act({ t: 'veil' });
  if (wallReady(me, t) && Math.hypot(g.x - me.p[0], g.z - me.p[2]) > BULWARK.dist + 1.2) return raiseWall(me, [g.x, 0, g.z], act);
  if (C.isWard(K.guard) && me.st >= C.RAM.blockCost + 5) {
    me.yaw = Math.atan2(g.x - me.p[0], g.z - me.p[2]);
    act({ t: 'block', on: true });
    b.blockUntil = t + tc + 0.45;
    b.faceRam = g.id;
    return;
  }
  if (K.mobility === 'blink' && mobilityReady(me, t)) return blinkSideways(me, null, act, vel);
  if (K.mobility === 'mirror_step' && mobilityReady(me, t)) return mirrorStep(me, [-vel[2], 0, vel[0]], act);
  if (K.mobility === 'smoke_screen' && mobilityReady(me, t)) return smokeAway(me, [-vel[2] * b.strafe, 0, vel[0] * b.strafe], act);
  if (rollReady(me, t) && tc < 0.5) return rollAway(me, [-vel[2] * b.strafe, 0, vel[0] * b.strafe], act);
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

// A prop for a Trapped Relic, on a path the target is likely to take: between them and us (they come for us), by cover,
// a spawn or a heal spot; not right under their feet (they'd see it flare and step back) and not next to our other trap.
const HOT_SPOTS = [...(C.HEAL_SPOTS || []).map(h => [h.x, h.z]), ...C.SPAWN_POINTS.map(s => [s[0], s[2]])];
const TALL_COVER = C.COLLIDERS.filter(c => c.h >= C.LOS_HEIGHT);
function curseCandidate(me, target, world, mine = []) {
  let best = null, bs = Infinity;
  for (const prop of world.props.values()) {
    if (prop.state !== 'idle' || prop.cursedBy != null) continue;
    const pp = [prop.x, 0, prop.z];
    const dm = dist2D(me.p, pp), dt = dist2D(target.p, pp);
    if (dm > C.TK.range - 1 || dm < 3 || dt > 16 || dt < RELIC.trigger + 1 || !hasLOS(me.p, pp)) continue;
    if (mine.some(pr => Math.hypot(pr.x - prop.x, pr.z - prop.z) < 5)) continue;
    const lane = segDist(target.p, me.p, { x: prop.x, z: prop.z });
    const hot = Math.min(...HOT_SPOTS.map(h => Math.hypot(h[0] - prop.x, h[1] - prop.z)));
    const cover = TALL_COVER.some(c => Math.hypot(c.x - prop.x, c.z - prop.z) < c.r + 2);
    const score = lane + dt * 0.25 - (hot < 4 ? 3 : 0) - (cover ? 1.5 : 0);
    if (score < bs) { bs = score; best = prop; }
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

// Roll along `dir` (any way: it goes along the movement keys, so we keep facing the fight).
function rollAway(me, dir, act) {
  act({ t: 'roll', dir: inward(me, dir), yaw: me.yaw, from: me.p.slice() });
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
  if (C.isWard(K.guard) && need > left * C.speedOf() * cfg.speed && me.st >= CYC.staminaCost + 5 && !me.carrying && cfg.dodge > 0.8) {
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
  if (need > left * C.speedOf() * cfg.speed * (me.slowUntil > t ? 1 - SKIM.slow : 1) && cfg.blinkDodge && mobilityReady(me, t) && canAct(me, t)) {
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
  if (firewallReady(me, t) && d > FIREWALL.dist + 1.5) return 'fire';
  if (C.isWard(K.guard) && me.st >= C.SPELLS.lash.staminaCost * (C.SPELLBOOK[K.guard].hitCostMul ?? 1) + 5 && !me.carrying && !airborne(me, t)) return 'ward';
  if (me.bot.cfg.blinkDodge && mobilityReady(me, t) && K.mobility !== 'skyward') return 'whip';
  return 'side';
}
function runLashPlan(me, caster, rec, fireAt, d, t, act) {
  const b = me.bot;
  if (rec.plan === 'done' || rec.plan === 'whip' || !canAct(me, t)) return;
  if (rec.plan === 'wall') { if (wallReady(me, t)) raiseWall(me, caster.p, act); rec.plan = 'done'; return; }
  // the Firewall only lasts 2.5 s: raise it just before the whip flies
  if (rec.plan === 'fire') { if (t >= fireAt - 0.4) { if (firewallReady(me, t)) raiseFirewall(me, caster.p, act); rec.plan = 'done'; } return; }
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
  // Smoke Flask: a cloud at our feet swallows it (and anything else coming in for 2 s)
  if (K.guard === 'smoke_flask' && t >= me.cd.guard && th.tc > 0.1 && (big || proj.kind === 'prop' || me.hp < 70 || Math.random() < 0.35)) return act({ t: 'smokeFlask' });
  // Ram Guard: rams circle us and catch the shot (and charge whoever fired it)
  if (K.guard === 'ram_guard' && t >= me.cd.guard && th.tc > 0.12 && (big || proj.kind === 'prop' || me.hp < 70 || Math.random() < 0.3)) return act({ t: 'ramGuard' });
  // Firewall: burn it up in the air (always for the big ones, sometimes for anything when hurt)
  if (firewallReady(me, t) && projDist > FIREWALL.dist + 1 && th.tc > 0.1 && (big || proj.kind === 'prop' || (me.hp < 60 && Math.random() < 0.5))) {
    return raiseFirewall(me, [me.p[0] + incoming[0], 0, me.p[2] + incoming[2]], act);
  }
  if (big && wallReady(me, t) && projDist > BULWARK.dist + 1.2 && th.tc > 0.1) {
    return raiseWall(me, [me.p[0] + incoming[0], 0, me.p[2] + incoming[2]], act);
  }

  const canWard = C.isWard(K.guard) && me.st >= Math.min(spec.staminaCost * (C.SPELLBOOK[K.guard].hitCostMul ?? 1) + 5, 90) && !me.carrying && !airborne(me, t);
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
  // Round 13: already up: the air jump lifts us over a chest-high shot (and the skim volley below)
  if (canAirJump(me, t) && th.tc < 0.35 && th.tc > 0.06 && Math.random() < (cfg.airJump ?? 0)) return act({ t: 'jump', n: 2, y0: me.p[1] });
  // ...so hop them: a jump in the last moment clears the shards (they fly about 0.3 m up)
  if (proj.kind === 'skim' && th.tc < 0.4 && th.tc > 0.08 && canJump(me, t) && Math.random() < (cfg.jump ?? 0)) return act({ t: 'jump' });
  // Roll: inside its 0.25 s dodge window the shot passes through (and the roll carries us off its line anyway)
  if (rollReady(me, t) && th.tc < ROLL.immune && th.tc > 0.03 && Math.random() < 0.6 * cfg.dodge) return rollAway(me, [-proj.v[2] * b.strafe, 0, proj.v[0] * b.strafe], act);
  // Sparks, shards and thrown props: sidestep if there's time to clear the hit sphere, else ward.
  const clearTime = (C.HIT_RADIUS + proj.radius - th.miss + 0.3) / (C.speedOf() * cfg.speed);
  // Black Death heals on every block: when hurt, Vesper would rather soak it than dodge
  const soak = K.guard === 'black_death' && me.hp < 80 ? 0.3 : 0.65;
  if (th.tc > clearTime + 0.05 && Math.random() < soak) return sidestep();
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
    me.p[1] = Math.max(C.surfaceHeight(me.p[0], me.p[2], me.p[1]), me.p[1] - rate * dt);
  }

  // Smoke Screen / Roll dash: straight along it at dash speed, colliding as usual
  if (b.dash && t < b.dash.until && !stunned) {
    const v = b.dash.speed;
    b.vel = [b.dash.dir[0] * v, b.dash.dir[2] * v];
  } else b.dash = null;

  // Ram Ride: galloping straight along our facing (the server times the mount, the ride and the dismount)
  if (me.mrain || me.mrainFall) { b.vel = [0, 0]; me.anim = 'idle'; return; }   // Meteor Rain: the server flies her
  if (me.ride && t >= me.ride.rideAt && t < me.ride.dismountAt && !stunned) {
    // the heading turns toward the bot's facing at RIDE.turnRate, like a player's
    me.ride.heading ??= me.ride.yaw;
    me.ride.heading += clampAbs(Math.atan2(Math.sin(me.yaw - me.ride.heading), Math.cos(me.yaw - me.ride.heading)), RIDE.turnRate * dt);
    b.vel = [Math.sin(me.ride.heading) * RIDE.speed, Math.cos(me.ride.heading) * RIDE.speed];
    // ridden far enough (the target reached, or far enough away): get off early
    if (b.rideGoal) {
      me.yaw = Math.atan2(b.rideGoal[0] - me.p[0], b.rideGoal[1] - me.p[2]);
      if (Math.hypot(b.rideGoal[0] - me.p[0], b.rideGoal[1] - me.p[2]) < 2.5) { b.rideGoal = null; world.handle(me, { t: 'rideStop' }); }
    }
    me.p[0] += b.vel[0] * dt; me.p[2] += b.vel[1] * dt;
    for (const c of C.COLLIDERS) { const dx = me.p[0] - c.x, dz = me.p[2] - c.z, dd = Math.hypot(dx, dz); if (dd < c.r + C.PLAYER_RADIUS && dd > 1e-4) { const kk = (c.r + C.PLAYER_RADIUS - dd) / dd; me.p[0] += dx * kk; me.p[2] += dz * kk; } }
    const rr = Math.hypot(me.p[0], me.p[2]);
    if (rr > C.ARENA_RADIUS) { me.p[0] *= C.ARENA_RADIUS / rr; me.p[2] *= C.ARENA_RADIUS / rr; }
    me.anim = 'run';
    return;
  }
  if (me.ride) { b.vel = [0, 0]; me.anim = 'idle'; return; }   // getting on or off
  if (me.grab) { b.vel = [0, 0]; me.anim = 'idle'; return; }   // pulling up onto a ledge: the server moves us
  let wx = 0, wz = 0;
  const goal = potionGoal(me, world, t, target);
  if (b.dash) { /* the dash carries us */ }
  else if (!stunned) {
    if (t < b.dodgeUntil && b.dodgeVec) { wx = b.dodgeVec[0]; wz = b.dodgeVec[1]; }
    else if (goal && !me.eye) {
      // a potion we're walking to; fight from wherever we are on the way
      const gTop = C.surfaceTopAt(goal[0], goal[1]);
      const wp = gTop > 0.5 ? rampWaypoint(me, goal, gTop) : null;
      const gx = (wp ? wp[0] : goal[0]) - me.p[0], gz = (wp ? wp[1] : goal[1]) - me.p[2], gl = Math.hypot(gx, gz) || 1;
      wx = gx / gl; wz = gz / gl;
      if (target && !target.dead && hasLOS(me.p, target.p)) me.yaw = yawTo(me.p, target.p);
      else me.yaw = Math.atan2(wx, wz);
    }
    else if (target && !target.dead) {
      const dx = target.p[0] - me.p[0], dz = target.p[2] - me.p[2];
      const d = Math.hypot(dx, dz) || 1;
      const fx = dx / d, fz = dz / d;
      const los = hasLOS(me.p, target.p);
      const lowHp = me.hp < 25 && me.hp < target.hp;   // round 10: regen makes a retreat nearly free, so only when really low
      // Gale Shear only reaches 8 m: she fights up close
      const range = kit(me).primary === 'gale_shear' ? [2.5, 6] : cfg.range;
      const diving = t < (b.diveUntil || 0) && t >= me.cd.power && !me.carrying;
      let fwd = 0;
      if (me.eye) fwd = d > 1.2 ? 1 : 0;                 // the tornado goes for them
      else if (lowHp && los) {
        // retreat to the far side of the nearest pillar
        const cover = coverPoint(me, target);
        if (cover) { const cx = cover[0] - me.p[0], cz = cover[1] - me.p[2]; const cl = Math.hypot(cx, cz) || 1; wx = cx / cl; wz = cz / cl; }
        else fwd = -1;
      } else if (!los) fwd = d > 4 ? 1 : 0.3;            // round 10: hunt them down (regen undoes a fight that pauses)
      else if (diving) fwd = d > 3 ? 1 : 0;              // closing in for a cyclone
      else if (veiled(target, t)) fwd = d < 12 ? -1 : 0;  // a veiled Gale is coming: keep away until it drops
      else if (target.hp < 40 && d > range[0]) fwd = 1;  // round 10: press a hurt target before regen saves them
      else if (d > range[1]) fwd = 1;
      else if (d < range[0]) fwd = -0.8;
      if (t >= b.strafeUntil) { if (Math.random() < 0.6) b.strafe *= -1; b.strafeUntil = t + rand(0.5, 1.8) / (cfg.dodge + 0.4); }
      const strafe = diving ? 0.35 : los ? 0.9 : 1;
      if (!(lowHp && los && wx)) { wx = fx * fwd + fz * strafe * b.strafe; wz = fz * fwd - fx * strafe * b.strafe; }
      // round 10: an enemy holding something to throw, facing us: get off the line (sideways, toward our strafe side)
      const thrower = [...world.players.values()].find(q => foe(me, q) && !q.dead && q.carrying && dist2D(q.p, me.p) < 18
        && facingWithin(q, me.p, 25) && hasLOS(q.p, me.p));
      if (thrower && !me.eye) {
        const lx = me.p[0] - thrower.p[0], lz = me.p[2] - thrower.p[2], ll = Math.hypot(lx, lz) || 1;
        wx = -lz / ll * b.strafe + lx / ll * 0.2; wz = lx / ll * b.strafe + lz / ll * 0.2;
      }
      // the target is up on a platform: take the ramp (unless we can shoot them from here)
      if (!me.eye && !airborne(target, t)) {
        const wp = (!los || kit(me).primary === 'gale_shear' || d > range[1]) ? rampWaypoint(me, [target.p[0], target.p[2]], target.p[1]) : null;
        if (wp) { const px = wp[0] - me.p[0], pz = wp[1] - me.p[2], pl = Math.hypot(px, pz) || 1; wx = px / pl; wz = pz / pl; b.rampUntil = t + 0.5; }
        // just came up: keep going onto their platform instead of strafing off the stairs
        else if (t < (b.rampUntil || 0) + 1.5 && d > 1.8) { wx = fx; wz = fz; }
      }
      const fg = me.blocking && b.faceRam ? world.rams.find(g => g.id === b.faceRam) : null;
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
    // keep out of enemy poison pools
    for (const pl of world.pools?.values() || []) {
      if (!foeId(me, pl.owner) || pl.owner === me.id) continue;
      const dx = me.p[0] - pl.x, dz = me.p[2] - pl.z, dd = Math.hypot(dx, dz);
      if (dd < TFLASK.radius + 1) { const k = (TFLASK.radius + 1 - dd) * 1.2; wx += (dd > 0.05 ? dx / dd : 1) * k; wz += (dd > 0.05 ? dz / dd : 0) * k; }
    }
    // keep out of enemy Firewalls: walking through one burns
    for (const w of world.firewalls?.values() || []) {
      if (!foeId(me, w.owner)) continue;
      const l = C.firewallLocal(w, me.p);
      if (Math.abs(l.along) < FIREWALL.width / 2 + 0.8 && Math.abs(l.across) < 1.6) { const sgn = Math.sign(l.across) || 1; wx += Math.sin(w.yaw) * sgn * 2.5; wz += Math.cos(w.yaw) * sgn * 2.5; }
    }
    // keep clear of enemy Trapped Relics whose glyph we've noticed (within RELIC.seen; Hard bots always notice, and
    // remember one that blew up on them), so we don't walk into the trigger
    for (const pr of world.props.values()) {
      if (pr.state !== 'idle' || pr.cursedBy == null || pr.cursedBy === me.id || !foeId(me, pr.cursedBy)) continue;
      const dx = me.p[0] - pr.x, dz = me.p[2] - pr.z, dd = Math.hypot(dx, dz);
      if (dd > RELIC.seen) continue;
      const key = `${pr.id}:${pr.cursedAt}`;
      if (!b.trapsSeen.has(key)) b.trapsSeen.set(key, cfg.relicMemory || Math.random() < Math.max(0.4, cfg.dodge));
      if (!b.trapsSeen.get(key) && !(t - (b.burned.get(pr.id) ?? -Infinity) < 40)) continue;
      const keep = RELIC.trigger + 0.6;
      if (dd < keep + 0.8) { const k = (keep + 0.8 - dd) * 2.5; wx += (dd > 0.05 ? dx / dd : 1) * k; wz += (dd > 0.05 ? dz / dd : 0) * k; }
    }
    if (b.trapsSeen.size > 64) b.trapsSeen.clear();
    // keep off enemy ice walls: touching one freezes
    for (const c of C.COLLIDERS) {
      if (c.kind !== 'bulwark') continue;
      const w = world.walls.get(c.wall);
      if (!w || !foeId(me, w.owner)) continue;
      const dx = me.p[0] - c.x, dz = me.p[2] - c.z, dd = Math.hypot(dx, dz);
      if (dd < c.r + 1.6 && dd > 1e-3) { wx += dx / dd * 2.5; wz += dz / dd * 2.5; }
    }
    // keep off the edge
    const r = Math.hypot(me.p[0], me.p[2]);
    if (r > C.ARENA_RADIUS - 5) { wx -= me.p[0] / r * 1.5; wz -= me.p[2] / r * 1.5; }
  }
  const wl = Math.hypot(wx, wz);
  const run = C.speedOf();
  // Sprint: to reach a far objective spot or a far target, or to get away when hurt; a ward user under fire keeps its
  // stamina for the ward. A sprinting bot faces where it runs (the server only grants a forward sprint).
  {
    const tg = target && !target.dead ? target : null, dT = tg ? dist2D(me.p, tg.p) : 0;
    const far = goal ? Math.hypot(goal[0] - me.p[0], goal[1] - me.p[2]) > 6 : !!tg && (dT > (kit(me).primary === 'gale_shear' ? 7 : cfg.range[1] + 5) || (dT > 8 && !hasLOS(me.p, tg.p)));   // (sprint is free: close in on one we can't see)
    const fleeing = me.hp < 35 && !!tg && dT < 14;
    const threatened = [...b.threats.values()].some(r => !r.handled && !r.ignore) || t < (b.ramDanger || 0);
    const keep = false;   // round 10: sprint is free, nothing to save stamina for
    const want = (far || fleeing) && !keep && wl > 0.01 && !stunned && !flying && !me.blocking && !busyCasting(me) && !me.carrying && t >= b.dodgeUntil;
    if (want !== !!me.sprinting || (want && t - (me.sprintAt || 0) > 0.2)) world.handle(me, { t: 'sprint', on: want });
    if (me.sprinting && wl > 0.01) me.yaw = Math.atan2(wx, wz);
  }
  // Crouch behind low cover when hurt, facing the threat from behind it; up again when they close in or it's gone
  {
    const tg = target && !target.dead ? target : null;
    if (t >= (b.crouchCheckAt || 0)) {
      b.crouchCheckAt = t + 0.8;
      const want = !!tg && me.hp < 45 && dist2D(me.p, tg.p) > 7 && !me.jump && !flying && Math.random() < (cfg.crouch ?? 0) && !!lowCoverToward(me, tg.p);
      me.crouch = want;
      if (want) { me.sprinting && world.handle(me, { t: 'sprint', on: false }); b.crouchUntil = t + 1.5 + Math.random(); }
    }
    if (me.crouch && (t > (b.crouchUntil || 0) || !tg || dist2D(me.p, tg.p) < 6 || me.jump || flying)) me.crouch = false;
  }
  let speed = run * cfg.speed;
  if (me.sprinting) speed = C.sprintOf() * cfg.speed;
  if (me.eye) speed = run * EYE.speedMul;
  else if (me.blocking) speed = C.blockSpeedOf();
  else if (flying) speed = SKY.airSpeed;
  if (t < b.dodgeUntil && !flying) speed = Math.max(speed, run * 0.95);
  const upInAir = !flying && (!!me.jump || airborne(me, t));
  if (upInAir && me.jumpSpeed) speed = Math.max(speed, me.jumpSpeed * cfg.speed);   // round 13: a sprint-jump carries its speed
  if (me.crouch) speed = Math.min(speed, C.CROUCH.speed);
  if (me.slowUntil > t) speed *= 1 - SKIM.slow;
  if (castSlowedBot(me, t) && !flying) speed *= C.CAST_SLOW.mult;   // round 13: a cast slows, it doesn't stop
  if (rooted(me, t)) { speed = 0; b.vel = [0, 0]; }
  // a rooting wind-up: no translation (knockback still carries us); stop dead as it starts
  const castStop = castRootedBot(me, t);
  if (castStop) { speed = 0; if (!b.wasCastRooted) b.vel = [0, 0]; }
  b.wasCastRooted = castStop;
  if (wl > 0.01) speed = C.backpedalSpeed(speed, wx, wz, me.yaw);   // backpedalling is slower, like for players
  const tx = wl > 0.01 ? wx / wl * speed : 0, tz = wl > 0.01 ? wz / wl * speed : 0;
  // round 13: snappier (MOVE_ACCEL), with only a little drag in the air when not steering
  const k = Math.min(1, dt * (wl > 0.01 ? C.MOVE_ACCEL.accel : upInAir ? C.MOVE_ACCEL.airDrag : C.MOVE_ACCEL.stop));
  if (!b.dash) { b.vel[0] += (tx - b.vel[0]) * k; b.vel[1] += (tz - b.vel[1]) * k; }
  me.p[0] += b.vel[0] * dt; me.p[2] += b.vel[1] * dt;
  // dragged by an Eye of the Storm
  if (b.pull && t < b.pull.until && !rooted(me, t)) { me.p[0] += b.pull.v[0] * dt; me.p[2] += b.pull.v[1] * dt; }

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
  if (C.SURFACES.length) { const q = C.surfacePushOut(me.p[0], me.p[2], me.p[1], pr); me.p[0] = q[0]; me.p[2] = q[1]; }
  if (y < 1) for (const prop of world.props.values()) if (prop.state === 'idle') pushOut(prop.x, prop.z, C.PROP_TYPES[prop.type].r * 0.8);
  for (const q of world.players.values()) if (q !== me && !q.dead && Math.abs(q.p[1] - y) < C.PLAYER_HEIGHT) pushOut(q.p[0], q.p[2], pr);
  // (never a mount ram: it sits under its rider, and pushing out of it shoved the rider forward every tick)
  if (y < 1) for (const g of world.rams) if ( g.state !== 'charge' && g.state !== 'mount' && g.mode !== 'mount') pushOut(g.x, g.z, C.RAM.radius);
  const r = Math.hypot(me.p[0], me.p[2]);
  if (r > C.ARENA_RADIUS) { me.p[0] *= C.ARENA_RADIUS / r; me.p[2] *= C.ARENA_RADIUS / r; }

  // stuck against something: switch strafe direction
  if (b.lastPos && wl > 0.01 && dist2D(b.lastPos, me.p) < speed * dt * 0.25) {
    b.stuckT += dt;
    // stuck on something low (a fence, crops, hay): hop it
    if (b.stuckT > 0.25 && canJump(me, t) && lowCoverToward(me, [me.p[0] + wx, 0, me.p[2] + wz])) { world.handle(me, { t: 'jump' }); b.stuckT = 0; }
    // round 10: against a ledge we can grab (the server pulls us up mid-jump): jump at it
    else if (b.stuckT > 0.25 && canJump(me, t) && C.ledgeTarget(me.p, [wx / (wl || 1), wz / (wl || 1)], me.p[1] + C.JUMP.height)) { world.handle(me, { t: 'jump' }); b.stuckT = 0; }
    // round 13: a ledge only the air jump's apex reaches: jump, then the air jump at the top (below)
    else if (b.stuckT > 0.25 && canJump(me, t) && C.ledgeTarget(me.p, [wx / (wl || 1), wz / (wl || 1)], me.p[1] + C.JUMP.height + C.AIR_JUMP.height)) {
      world.handle(me, { t: 'jump' }); b.stuckT = 0; b.ledgeAirJumpAt = t + C.JUMP.airTime * 0.45;
    }
    else if (b.stuckT > 0.4) { b.strafe *= -1; b.stuckT = 0; }
  }
  else b.stuckT = 0;
  if (b.ledgeAirJumpAt && t >= b.ledgeAirJumpAt) { b.ledgeAirJumpAt = 0; if (canAirJump(me, t)) world.handle(me, { t: 'jump', n: 2, y0: me.p[1] }); }
  b.lastPos = me.p.slice();

  const moving = Math.hypot(b.vel[0], b.vel[1]) > 0.6;
  me.anim = me.charging || me.lash || cycloneWindingUp(me) ? 'charge' : me.blocking ? 'block' : moving ? 'run' : 'idle';
}

// Round 10: hurt, and a ready health potion near (one we can reach: its spot has a floor under it): go and drink it,
// unless the fight is right on top of us and we're not that low.
function potionGoal(me, world, t, target) {
  if (!world.potions?.length || me.hp >= 55 || me.eye || me.ride) return null;
  if (target && !target.dead && dist2D(me.p, target.p) < 6 && me.hp > 35) return null;
  let best = null, bd = 22;
  for (const pt of world.potions) {
    if (t < pt.readyAt) continue;
    const sp = pt.spot, y = sp.y;
    if (y > C.surfaceTopAt(sp.x, sp.z) + 0.3) continue;   // nothing to stand on there yet
    const d = Math.hypot(sp.x - me.p[0], sp.z - me.p[2]) + Math.max(0, y - me.p[1]) * 2;
    if (d < bd) { bd = d; best = [sp.x, sp.z]; }
  }
  return best;
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
