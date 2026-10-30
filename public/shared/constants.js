// Shared between server and client. Keep this file dependency-free.
// Map layout (arena size, obstacles, props, goats, spawns) lives in map.js and is re-exported here.
import { COLLIDERS, ARENA_RADIUS, LOS_HEIGHT, surfaceBlocks, SURFACES } from './map.js';
import * as MAPNS from './map.js';   // (optional helpers, such as losVolumeBlocks, looked up by name)
import { WIZARDS, DEFAULT_WIZARD } from './wizards.js';
export * from './map.js';
export * from './wizards.js';

export const TICK_RATE = 60;          // server simulation Hz
export const SNAPSHOT_RATE = 20;      // server -> client state broadcast Hz

export const PLAYER_HEIGHT = 1.8;
export const PLAYER_RADIUS = 0.45;
export const HIT_CENTER_Y = 0.95;     // centre of the hit-sphere above feet
export const HIT_RADIUS = 0.75;
// Round 10 (Ty: "+30% for every spell, ultimate and thrown object"): every damage source is multiplied by this in
// server.js applyHit, so it's tuned in one place. Healing, shields (wall HP, stamina costs) and ult charge per hit are not.
// Goat, ram and Meteor Rain one-shots stay one-shots. D(n) is a blurb's number at this scale.
export const DAMAGE_SCALE = 1.3;
export const D = (n) => Math.round(n * DAMAGE_SCALE);
// Round 10: out of combat (no damage taken for `delay` s), health comes back at `rate` HP a second, up to full.
export const REGEN = { delay: 5, rate: 8 };
// Round 10: health potions at map.js HEAL_SPOTS: 35 HP on touch (only when hurt), back after 20 s.
export const POTION = { heal: 35, respawn: 20, radius: 0.9, height: 1.0 };
// Round 10: ledge grab. Jumping at an edge whose top is out of the jump's reach (but at most `reach` above its apex)
// pulls you up onto it in `time` s (cast-rooted). ledgeTarget is the one rule for client, server and bots.
export const LEDGE = { reach: 1.2, time: 0.45, rise: 0.3 };
// Round 10 (Ty): a thrown object (a prop, a potion barrel, hay, a goat) that hits an unblocked wizard knocks them down:
// flung back about 2 m, they fall (fall), lie there (down) and get up (getup), unable to move, act or shield throughout.
export const KNOCKDOWN = { kinds: ['prop', 'goat'], fall: 0.4, down: 0.8, getup: 0.4, fling: 24 };   // fling: m/s, decays to ~2 m
KNOCKDOWN.total = KNOCKDOWN.fall + KNOCKDOWN.down + KNOCKDOWN.getup;
import { surfaceHeight as _sh, STEP_UP as _step } from './map.js';
// From feet at p ([x, y, z]) facing dir ([x, z], unit), in a jump peaking at apexY: where we'd end up standing, or null.
export function ledgeTarget(p, dir, apexY) {
  const maxTop = apexY + LEDGE.reach;
  for (const d of [0.55, 0.8]) {
    const rx = p[0] + dir[0] * d, rz = p[2] + dir[1] * d;
    const top = _sh(rx, rz, maxTop - _step);              // the highest standable top there, no higher than maxTop
    if (!(top > p[1] + _step + 0.05) || top > maxTop) continue;
    const ix = p[0] + dir[0] * (d + 0.4), iz = p[2] + dir[1] * (d + 0.4);
    if (_sh(ix, iz, top) >= top - 0.05) return [ix, top, iz];   // room to stand a little way in
  }
  return null;
}
// Round 9: jump (Space) and crouch (C toggle, Ctrl hold).
// A jump is a fixed arc: `height` at the apex, `airTime` up and down (v0 = 4h/T, g = 8h/T²), steered at `airControl`
// of the ground acceleration. No casting for `castLock` s after take-off; then only the primary.
export const JUMP = { height: 1.45, airTime: 0.55 * Math.sqrt(1.45 / 1.1), airControl: 0.6, stamina: 10, castLock: 0.15 };   // round 10: 30% higher (1.1 -> 1.45 m, same gravity)
JUMP.v0 = 4 * JUMP.height / JUMP.airTime; JUMP.gravity = 8 * JUMP.height / JUMP.airTime ** 2;
export const jumpY = (e) => Math.max(0, JUMP.v0 * e - JUMP.gravity * e * e / 2);   // height above take-off, e s in
// Crouched: slow, and a smaller, lower hit sphere, so low cover (fences, crops, hay, table rocks) hides you.
export const CROUCH = { speed: 1.6, hitCenter: 0.5, hitRadius: 0.42 };   // top of the sphere 0.92 m: under a chest-high shot
export const hitCenterOf = (q) => (q?.crouch ? CROUCH.hitCenter : HIT_CENTER_Y);
export const hitRadiusOf = (q) => (q?.crouch ? CROUCH.hitRadius : HIT_RADIUS);

export const MOVE_SPEED = 3.6;        // m/s: the fastest walk (Gale); each wizard's own is wizards.js `speed` (Ty: normal movement is a walk)
export const CHARGE_MOVE_SPEED = MOVE_SPEED * 0.32;   // while winding up: the same fraction of a wizard's walk as before
export const BLOCK_MOVE_SPEED = MOVE_SPEED * 0.42;    // while blocking

export const MAX_HP = 100;
export const MAX_STAMINA = 100;
export const STAMINA_DRAIN_BLOCKING = 14;   // per second while holding block
export const STAMINA_REGEN = 22;            // per second when not blocking
export const STAMINA_REGEN_DELAY = 0.8;     // seconds after block released
export const BLOCK_CONE_DEG = 110;          // spells arriving inside this frontal cone are blockable
export const BLOCK_BREAK_STUN = 1.1;        // stun when stamina runs out mid-block

export const RESPAWN_TIME = 3.0;

export const SPELLS = {
  fast: {
    damage: 9,
    stun: 0.55,
    speed: 30,
    radius: 0.28,
    life: 1.8,
    cooldown: 0.45,
    staminaCost: 12,     // stamina removed from a blocking target
    knockback: 1.5,
  },
  heavy: {
    damage: 44,          // round 6: +15 %
    stun: 0.25,
    speed: 19,
    radius: 0.65,
    life: 3.0,
    cooldown: 1.2,
    chargeTime: 1.25,    // wind-up before the bolt leaves the hand
    staminaCost: 45,
    knockback: 6.5,
  },
  prop: {                // an environment object hurled with telekinesis
    damage: 22,
    stun: 0.4,
    speed: 24,
    radius: 0.55,
    life: 3.0,
    gravity: 6,
    staminaCost: 25,
    knockback: 4,
  },
  skim: {                // Glacial Skim: one of three ice shards skimming along the ground
    damage: 11,
    stun: 0,
    speed: 26,
    radius: 0.2,
    life: 0.85,
    staminaCost: 6,
    knockback: 0.6,
    height: 0.35,        // flight height; a wizard in the air is above it
    ultCharge: 0.7,      // Rime fills his ultimate fastest: Skim damage charges 30 % less
    slow: 0.35,          // movement slowed by this fraction...
    slowTime: 2,         // ...for this long (refreshed by a new hit, never stacked)
  },
  lash: {                // Sanguine Lash: a fast whip that pierces every wizard on its path
    damage: 12,
    stun: 0,
    speed: 28,
    radius: 0.35,
    life: 22 / 28,       // about 22 m
    staminaCost: 40,     // a ward facing the caster blocks it
    knockback: 0,        // a bound wizard doesn't move, knockback included
    bind: 1.25,          // rooted and silenced
  },
  fireball: {           // Cinder's primary: a big, hot, slower bolt
    damage: 18,          // round 10 (dense map, 1.3x scale): 20 had Cinder on top in 3 of 3 runs (23 kills / 9 deaths)
    finDamage: 26,       // the 3rd shot of the magazine
    stun: 0.55,
    speed: 24,
    radius: 0.45,
    life: 1.3,           // about 31 m
    cooldown: 0.5,
    staminaCost: 16,
    knockback: 2,
  },
  shear: {               // Gale's primary: a short wind blade, gone after about 8 m
    damage: 16,          // balance match at walking speed: 14 left Gale last (closing to 8 m takes a while now)
    stun: 0.45,
    speed: 30,
    radius: 0.85,        // wide: it's an arc of wind, not a bolt
    finRadius: 1.35,     // the 3rd shot: a wider crescent
    life: 8 / 30,
    cooldown: 0.42,
    staminaCost: 12,
    knockback: 3,
  },
  sling: {               // Jeb's primary: a sling stone; a hit calls a ram on the target
    damage: 7,
    stun: 0.45,
    speed: 32,
    radius: 0.22,
    life: 1.0,           // about 32 m
    cooldown: 0.4,
    staminaCost: 8,
    knockback: 1,
  },
  potion: {              // Embibe's primary: an arcing purple potion that shatters with a splash
    damage: 16,
    finDamage: 14,       // the 2nd throw hits a little softer, but stuns (the magazine's last)
    stun: 0.55,
    speed: 20,
    gravity: 9,
    radius: 0.3,
    life: 2.2,
    cooldown: 0.5,
    staminaCost: 14,
    knockback: 1.5,
    splash: 1.2,         // radius of the splash...
    splashMul: 0.5,      // ...at this share of the throw's damage
    range: 26,
  },
  toxic: {               // Toxic Flask: a lobbed green flask (a direct hit stings; the pool does the work)
    damage: 12,
    stun: 0.3,
    speed: 16,
    gravity: 12,
    radius: 0.32,
    life: 3,
    staminaCost: 10,
    knockback: 1,
    range: 18,
  },
  flaskstep: {           // Flask Step's potion: harmless, she teleports to where it lands
    damage: 0, stun: 0, knockback: 0, staminaCost: 0,
    speed: 16.3, gravity: 10, radius: 0.25, life: 4,   // about 26 m at best (a 45-degree lob); a true arc from her aim
    range: 26,
    lob: 0.2,            // rad added to her aim's elevation, so a level aim still lobs
    maxElev: 1.3,        // rad: steepest throw (high onto or over cover)
  },
  hex: {                 // Vesper's primary: a crimson glyph flying a curved path to the aim point
    damage: 11,
    stun: 0.55,
    speed: 22,           // along the curve
    radius: 0.3,
    life: 2,
    cooldown: 0.45,
    staminaCost: 12,
    knockback: 1.2,
    range: 28,           // aim points farther than this are pulled in
    side: 0.32,          // shots 1 and 2: the control point sits this fraction of the distance to the side...
    lob: 0.4,            // ...shot 3: this fraction above
  },
};

// Flask Step's throw: the launch direction from an aim direction (its elevation lifted by `lob`, capped at `maxElev`).
export function flaskLaunch(aim) {
  const F = SPELLS.flaskstep;
  const flat = Math.hypot(aim[0], aim[2]) || 1e-6;
  const elev = Math.max(-0.3, Math.min(F.maxElev, Math.atan2(aim[1], flat) + F.lob));
  return [aim[0] / flat * Math.cos(elev), Math.sin(elev), aim[2] / flat * Math.cos(elev)];
}
// The exact launch direction at `speed` that reaches `target` under `gravity`: the high arc if `high`, else the low
// one. Null when it's out of reach.
export function lobAt(origin, target, speed, gravity, high = false) {
  const dx = target[0] - origin[0], dz = target[2] - origin[2], x = Math.hypot(dx, dz) || 1e-6, y = target[1] - origin[1];
  const v2 = speed * speed, disc = v2 * v2 - gravity * (gravity * x * x + 2 * y * v2);
  if (disc < 0) return null;
  const th = Math.atan((v2 + (high ? 1 : -1) * Math.sqrt(disc)) / (gravity * x));
  return [dx / x * Math.cos(th), Math.sin(th), dz / x * Math.cos(th)];
}
// Where a Flask Step thrown from `origin` along `dir` comes down: it flies over fences and crops, and anything taller
// stops it (she then arrives just short of it). Returns { path: [[x,y,z]...], at: [x, 0, z], blocked }.
export function flaskPath(origin, dir) {
  const r = flaskFlight(origin, dir);
  r.at = flaskSettle(r.at);
  return r;
}
// Where she can stand near `at`: out of anything solid (fences and crops included), inside the arena. The server's
// arrival uses this too.
export function flaskSettle(at) {
  const to = at.slice();
  for (let k = 0; k < 3; k++) for (const c of COLLIDERS) {
    if (c.h < 0.5) continue;
    const dx = to[0] - c.x, dz = to[2] - c.z, d = Math.hypot(dx, dz);
    if (d < c.r + PLAYER_RADIUS && d > 1e-4) { const kk = (c.r + PLAYER_RADIUS - d) / d; to[0] += dx * kk; to[2] += dz * kk; }
  }
  const r = Math.hypot(to[0], to[2]);
  if (r > ARENA_RADIUS - 0.5) { to[0] *= (ARENA_RADIUS - 0.5) / r; to[2] *= (ARENA_RADIUS - 0.5) / r; }
  return to;
}
function flaskFlight(origin, dir) {
  const F = SPELLS.flaskstep, dt = 1 / 60;
  const p = origin.slice(), v = dir.map(c => c * F.speed), path = [p.slice()];
  for (let t = 0; t < F.life; t += dt) {
    v[1] -= F.gravity * dt;
    p[0] += v[0] * dt; p[1] += v[1] * dt; p[2] += v[2] * dt;
    if (path.length < 400 && Math.round(t / dt) % 3 === 0) path.push(p.slice());
    if (p[1] <= F.radius * 0.5 || Math.hypot(p[0], p[2]) > ARENA_RADIUS + 6) return { path, at: [p[0], 0, p[2]], blocked: false };
    for (const c of COLLIDERS) {
      if (c.h < LOS_HEIGHT || p[1] >= c.h || Math.hypot(p[0] - c.x, p[2] - c.z) >= c.r + F.radius) continue;
      const l = Math.hypot(v[0], v[2]) || 1;
      return { path, at: [p[0] - v[0] / l * 0.8, 0, p[2] - v[2] / l * 0.8], blocked: true };
    }
  }
  return { path, at: [p[0], 0, p[2]], blocked: false };
}

// Vesper's Hex Shards: shot `i` (0, 1, 2 = the finisher) from `from` to the aim point `to` flies a quadratic Bézier
// whose control point is pulled left, right or up. The server and clients both use this, so the curve matches.
export function hexCurve(from, to, i) {
  const H = SPELLS.hex;
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const d = Math.hypot(dx, dy, dz) || 1, flat = Math.hypot(dx, dz) || 1;
  const side = [-dz / flat, 0, dx / flat];   // left of the flight, seen from the caster
  const mid = [from[0] + dx / 2, from[1] + dy / 2, from[2] + dz / 2];
  const off = Math.min(5, Math.max(1.2, d * H.side));
  const p1 = i === 2 ? [mid[0], mid[1] + Math.min(6, Math.max(1.5, d * H.lob)), mid[2]]
    : [mid[0] + side[0] * off * (i === 0 ? 1 : -1), mid[1], mid[2] + side[2] * off * (i === 0 ? 1 : -1)];
  // the curve's length is about the chord plus a little; the shard keeps a steady speed along it
  const len = d * (i === 2 ? 1.18 : 1.12);
  return { p0: from.slice(), p1, p2: to.slice(), dur: len / H.speed };
}
// Position and velocity on a hex curve `age` seconds in; past the end it flies straight on along the end tangent.
export function hexAt(c, age) {
  const s = Math.min(1, age / c.dur), u = 1 - s;
  const p = [0, 1, 2].map(k => u * u * c.p0[k] + 2 * u * s * c.p1[k] + s * s * c.p2[k]);
  const tan = [0, 1, 2].map(k => (2 * u * (c.p1[k] - c.p0[k]) + 2 * s * (c.p2[k] - c.p1[k])) / c.dur);
  if (age > c.dur) for (let k = 0; k < 3; k++) p[k] += tan[k] * (age - c.dur);
  return { p, v: tan };
}

// A goat hurled by telekinesis hits exactly like a thrown prop (Ty), it just doesn't break.
SPELLS.goat = { ...SPELLS.prop };

export const TELEPORT = {
  distance: 9,
  cooldown: 4.0,
};

// ---------------------------------------------------------------- spellbook
// Every spell, keyed by id. Each wizard (wizards.js) has a fixed kit of one spell per slot.
// Adding a spell = one entry here plus its handler on the server (server.js) and client (main.js).
// `short` is the ability bar label. `cooldown` is per slot.
export const SLOT_INFO = {
  primary:  { key: 'LMB',   label: 'Primary' },
  power:    { key: 'RMB',   label: 'Power' },
  mobility: { key: 'E',     label: 'Mobility' },
  guard:    { key: 'Space', label: 'Guard' },
  utility:  { key: 'F',     label: 'Utility' },
  ultimate: { key: 'Q',     label: 'Ultimate' },
};

// Ultimate charge (0–100 %, server-authoritative, kept through death, reset on use). Ultimates' own
// damage doesn't charge. Game modes add more through ctx.addUltCharge (the Sacred Relic: +2 %/s).
export const ULT_CHARGE = {
  max: 100,
  perDamage: 1 / 3,    // % per point of damage dealt to an enemy
  passive: 0.5,        // % per second while alive
  kill: 5,             // % per kill
  windup: 1.3,         // every ultimate: a readable 1.3 s cast first, interrupted like any wind-up...
  fizzleKeep: 50,      // ...and an interrupted one fizzles, keeping this much charge
};

export const SPELLBOOK = {
  spark: {
    id: 'spark', slot: 'primary', name: 'Spark', short: 'Spark',
    blurb: 'Quick bolts, 3 to a charge, then a reload. The 3rd stuns and breaks a wind-up.',
    cooldown: SPELLS.fast.cooldown,
    magazine: 3, reload: 1.5, idleReload: 2,   // see PRIMARY_MAGAZINE
  },
  glacial_skim: {
    id: 'glacial_skim', slot: 'primary', name: 'Glacial Skim', short: 'Skim',
    blurb: 'Three ice shards skim the ground and slow by 35% for 2 s. 3 volleys, then a reload; the 3rd breaks a wind-up.',
    shards: 3, spreadDeg: 6,
    cooldown: 0.6,
    magazine: 3, reload: 1.5, idleReload: 2,
  },
  fireball: {
    id: 'fireball', slot: 'primary', name: 'Fireball', short: 'Fireball',
    blurb: `Big, hot bolts, 3 to a charge, then a reload. ${D(18)} damage; the 3rd hits for ${D(26)}, stuns and breaks a wind-up.`,
    cooldown: SPELLS.fireball.cooldown,
    magazine: 3, reload: 1.5, idleReload: 2,
  },
  gale_shear: {
    id: 'gale_shear', slot: 'primary', name: 'Gale Shear', short: 'Shear',
    blurb: `A blade of wind out to 8 m (${D(16)} damage), 3 to a charge. The 3rd is a wide crescent that breaks a wind-up.`,
    cooldown: SPELLS.shear.cooldown,
    magazine: 3, reload: 1.5, idleReload: 2,
  },
  potion_toss: {
    id: 'potion_toss', slot: 'primary', name: 'Potion Toss', short: 'Potion',
    blurb: `Arcing potions, 2 to a belt, then a reload. ${D(16)} damage with a small splash; the 2nd hits for ${D(14)} and stuns.`,
    cooldown: SPELLS.potion.cooldown,
    magazine: 2, reload: 1.5, idleReload: 2,
  },
  toxic_flask: {
    id: 'toxic_flask', slot: 'power', name: 'Toxic Flask', short: 'Toxic',
    blurb: `Lob a flask (18 m): it shatters into a 3.5 m pool of poison for 5 s. ${D(12)} damage a second to enemies standing in it.`,
    radius: 3.5, life: 5,
    tick: 0.5, dps: 12,
    cooldown: 8,
  },
  flask_step: {
    id: 'flask_step', slot: 'mobility', name: 'Flask Step', short: 'Flask Step',
    blurb: 'A 0.6 s wind-up, then a potion lobbed along your aim (16 m): wherever it lands, you are there. Being hit during the wind-up stops it.',
    windup: 0.6,
    cooldown: 8,
  },
  smoke_flask: {
    id: 'smoke_flask', slot: 'guard', name: 'Smoke Flask', short: 'Smoke Flask',
    blurb: 'Tap: a flask smashed at your feet. Its purple smoke swallows every enemy projectile that enters it, from any side, for 2 s.',
    radius: 2.4, height: 3.2,
    life: 2,
    cooldown: 10,
  },
  sling: {
    id: 'sling', slot: 'primary', name: "Shepherd's Sling", short: 'Sling',
    blurb: 'Sling stones, 2 to a pouch. A hit calls the nearest calm goat to charge the target. The 2nd breaks a wind-up.',
    cooldown: SPELLS.sling.cooldown,
    magazine: 2, reload: 1.5, idleReload: 2,
    callRange: 22,       // a calm map goat this close to the target answers the call
    callLockout: 6,      // seconds before the same target can have another ram called on it (balance match: 3 was too many)
  },
  hex_shards: {
    id: 'hex_shards', slot: 'primary', name: 'Hex Shards', short: 'Hex',
    blurb: 'Crimson glyphs that curve in on the aim point: from the left, from the right, then a high lob that breaks a wind-up.',
    cooldown: SPELLS.hex.cooldown,
    magazine: 3, reload: 1.5, idleReload: 2,
  },
  meteor: {
    id: 'meteor', slot: 'power', name: 'Meteor', short: 'Meteor',
    blurb: '1.25 s wind-up, then a heavy fireball. Being hit cancels it.',
    cooldown: SPELLS.heavy.cooldown, windup: SPELLS.heavy.chargeTime,
  },
  cyclone: {
    id: 'cyclone', slot: 'power', name: 'Arcane Cyclone', short: 'Cyclone',
    blurb: 'Short wind-up, then spin: hits everyone within 5.5 m and flings them outward.',
    windup: 0.45,        // can't ward, move at CHARGE_MOVE_SPEED; being hit cancels it
    spin: 0.5,           // two full turns; the damage pulse fires at the start
    radius: 5.5,
    height: 2.5,         // vertical reach above/below the caster's feet (airborne wizards escape it)
    damage: 28,
    stun: 0.35,
    knockback: 6,        // m/s straight outward
    staminaCost: 35,     // a ward facing the caster blocks it for this much stamina
    cooldown: 5,
  },
  sanguine_lash: {
    id: 'sanguine_lash', slot: 'power', name: 'Sanguine Lash', short: 'Lash',
    blurb: '1.5 s wind-up, then a piercing whip: binds everyone it hits for 1.25 s. Miss and you are rooted.',
    windup: 1.5,         // can't ward, move at CHARGE_MOVE_SPEED; being hit cancels it
    missRoot: 1.0,       // the caster's recovery when the whip hits nobody
    cooldown: 13,
  },
  frostfall: {
    id: 'frostfall', slot: 'power', name: 'Frostfall', short: 'Frostfall',
    blurb: `Hold to aim a circle, release: 1.75 s later a block of ice crushes it. ${D(50)} damage and freezes 1.5 s. Wards don't help.`,
    radius: 3.2,         // the circle
    range: 24,           // farthest centre from the caster
    delay: 1.75,         // release to impact; everyone sees the shadow grow meanwhile
    fall: 0.5,           // the ice is visible falling for this long before impact
    castPose: 0.5,
    height: 2,           // wizards whose feet are higher than this are out of reach
    damage: 50,
    stun: 0,
    knockback: 0,
    bind: 1.5,           // frozen: rooted and silenced, like the lash's bind
    unblockable: true,   // it comes from above: wards and ice walls don't stop it
    airCast: true,       // the one power spell Rime can cast during a Skyward Flash
    cooldown: 14,
  },
  battering_ram: {
    id: 'battering_ram', slot: 'power', name: 'Battering Ram', short: 'Ram',
    blurb: 'Stomp for 0.8 s (a hit stops you), then a ram bursts out in front of you and charges dead straight along your aim. It flattens the first enemy it meets, unless a ward, wall or Veil stops it.',
    windup: 0.8,         // round 10 (Ty: too strong): a stomp and a ghost ram pawing the ground first; cast-rooted, interruptible
    interruptCd: 3,      // the cooldown an interrupted wind-up leaves
    spawnDist: 1.4,
    maxTime: 3,          // the charge runs at GOAT.chargeSpeed for at most this long
    cooldown: 12,        // balance match: 9 left Jeb on top (most of his kills were ram one-shots)
  },
  ram_ride: {
    id: 'ram_ride', slot: 'mobility', name: 'Ram Ride', short: 'Ride',
    blurb: 'Mount a ram and gallop up to 20 m (it turns slowly toward where you look); E, Space or a click gets off early. Riding into an enemy shoves them for 15.',
    mount: 0.4, dismount: 0.4,   // he can't act while getting on and off
    speed: 7, distance: 20,      // up to about 2.9 s (round 8: twice as long, but E, Space or a primary click dismounts early)
    turnRate: 1.5,               // rad/s: the ram's heading follows where you look, this fast at most
    height: 0.55,        // he sits this high on the ram (visual)
    cooldown: 8,
  },
  blink: {
    id: 'blink', slot: 'mobility', name: 'Blink', short: 'Blink',
    blurb: 'Teleport 9 m in the direction you face.',
    cooldown: TELEPORT.cooldown,
  },
  skyward: {
    id: 'skyward', slot: 'mobility', name: 'Skyward Flash', short: 'Skyward',
    blurb: 'Flash 7 m straight up and float down. Hold E to hover, C to drop.',
    height: 7,           // launch height (m)
    maxHeight: 8,        // the server never accepts a wizard higher than this
    floatTime: 2.8,      // after this the wizard drops
    fallSpeed: 2.5,      // m/s default descent
    slowFallSpeed: 1.2,  // m/s holding E
    dropSpeed: 6,        // m/s after C (crouch) or once floatTime runs out
    airSpeed: 4.5,       // horizontal steering speed while airborne
    cooldown: 6,         // from launch
  },
  mirror_step: {
    id: 'mirror_step', slot: 'mobility', name: 'Mirror Step', short: 'Mirror',
    blurb: 'Dash 7 m and split three ways: you take one path, two decoys run the others.',
    distance: 7,
    spreadDeg: 30,       // the side paths
    decoyTime: 2.5,      // decoys run this long at run speed, then fade
    cooldown: 7,
  },
  smoke_screen: {
    id: 'smoke_screen', slot: 'mobility', name: 'Smoke Screen', short: 'Smoke',
    blurb: 'Leap 6.5 m backwards, leaving a cloud of smoke for 5 s. Nobody outside can see who is inside it.',
    distance: 6.5,
    dashTime: 0.25,      // a fast dash, not a teleport: it collides like walking
    radius: 4,           // the cloud
    height: 3,
    life: 5,             // then it fades over `fade`
    fade: 1,
    cooldown: 8,
  },
  ward: {
    id: 'ward', slot: 'guard', name: 'Ward', short: 'Ward', ward: true,
    blurb: 'Hold to block spells from the front. Drains stamina fast.',
    cooldown: 0,
    drainMul: 2.5, hitCostMul: 2.5,   // round 6 (Ty: shields much shorter): about 3 s of holding from full
  },
  firewall: {
    id: 'firewall', slot: 'guard', name: 'Firewall', short: 'Firewall',
    blurb: 'Tap: a 5 m wall of flame rises ahead for 2.5 s. It burns up every enemy projectile and thrown object that crosses it. Walking through it burns.',
    dist: 2.5,           // in front of her, across her aim
    width: 5, height: 3,
    life: 2.5,
    thickness: 0.5,      // how close to its plane counts as touching it
    cooldown: 10,
  },
  black_death: {
    id: 'black_death', slot: 'guard', name: 'Black Death', short: 'Black Death', ward: true, allSides: true,
    blurb: 'Hold: a black shroud blocks spells from every side, for about 3 s of stamina. Each block heals you for 30% of the damage it absorbed and charges your next Lash.',
    cooldown: 0,
    drainMul: 2.5,          // stamina drains this much faster than the base ward rate (about 3 s from full)...
    hitCostMul: 2,          // ...and each blocked hit costs this much more (2.5 left Vesper last in the balance match)
    lashCdPerDamage: 0.1,   // each absorbed point cuts Sanguine Lash's cooldown by this (s)...
    bonusPerDamage: 0.5,    // ...and stores this much bonus damage for the next Lash...
    maxBonus: 14,           // ...up to this
    healPerDamage: 0.3,     // Ty: each blocked hit heals her this share of the damage it absorbed
  },
  tempest_veil: {
    id: 'tempest_veil', slot: 'guard', name: 'Tempest Veil', short: 'Veil',
    blurb: 'Tap: a wind bubble wraps you for 2 s and swallows every spell, from any side. Move and cast freely.',
    duration: 2,         // Ty: shields much shorter (was 3 s)
    cooldown: 10,        // from activation; it can't be refreshed while up
  },
  ram_guard: {
    id: 'ram_guard', slot: 'guard', name: 'Ram Guard', short: 'Ram Guard',
    blurb: 'Tap: 3 rams circle you for 3 s and take shots meant for you. Whoever hits one gets charged by it.',
    count: 3, radius: 2.2, lap: 1.5, life: 3,
    cooldown: 10,
  },
  glacial_bulwark: {
    id: 'glacial_bulwark', slot: 'guard', name: 'Glacial Bulwark', short: 'Bulwark',
    blurb: 'Tap to raise a 6 m ice wall ahead that blocks everything and freezes enemies who touch it. 5 s or 120 damage.',
    dist: 2.8, width: 6, height: 4,
    circles: 9, r: 0.4,   // collider chain
    life: 5, hp: 120,     // Ty: shields much shorter (was 10 s, 220)
    freeze: 1.5,          // an enemy touching it is frozen this long (Frostfall's freeze)...
    refreeze: 3,          // ...at most once per wall per enemy this often
    cooldown: 12,
  },
  telekinesis: {
    id: 'telekinesis', slot: 'utility', name: 'Telekinesis', short: 'Lift',
    blurb: 'Lift an object, then hurl it. It shields you while held.',
    cooldown: 0.6,       // lift to throw (THROW_COOLDOWN)
    liftCooldown: 3,     // after letting go of something (thrown, set down, knocked away), before the next lift
  },
  trapped_relic: {
    id: 'trapped_relic', slot: 'utility', name: 'Trapped Relic', short: 'Relic',
    blurb: 'Telekinesis, plus: hold F on an object to curse it. It explodes on the next enemy who lifts it.',
    hold: 0.5,           // seconds of holding F that curse instead of lift
    damage: 45, radius: 3.5,
    stun: 0.4,
    knockback: 7,
    staminaCost: 40,     // a ward facing the blast blocks it
    cooldown: 0.6,
    liftCooldown: 3,     // as telekinesis; laying a curse starts it too
  },

  // ---- ultimates (Q). `ult: true` hits never charge the ultimate. Each one cannot be cancelled once cast.
  meteor_rain: {
    id: 'meteor_rain', slot: 'ultimate', name: 'Meteor Rain', short: 'Meteor Rain', ult: true,
    blurb: 'Leap 12 m into the sky and hover up to 4 s, aiming a 4 m circle; Q or a click dives on it as a falling blaze. Everything in it, or in her path, dies. A hit that interrupts knocks her down.',
    height: 12,          // the leap
    rise: 0.5,           // seconds to get up there
    hover: 4,            // longest hover; then she dives on her last aim
    radius: 4,           // the landing circle
    range: 24,           // farthest landing from where she leapt
    dive: 0.6,
    pathRadius: 1.2,     // anyone this close to her dive path is caught too
  },
  meteor_rain_hit: {     // what the dive does to an enemy (a hit kind): death, unless a Tempest Veil absorbs it
    id: 'meteor_rain_hit', name: 'Meteor Rain', ult: true, damage: 1000, stun: 0, knockback: 6, staminaCost: 0, unblockable: true,
  },
  blizzard: {
    id: 'blizzard', slot: 'ultimate', name: 'Blizzard', short: 'Blizzard', ult: true,
    blurb: 'A 70° cone of snow, 14 m long, for 2.5 s (turn slowly to steer it): it pushes enemies back, chips 10 a second, and freezes anyone caught in it for 0.8 s. Walls block it; wards don\'t.',
    cone: 70, range: 14, height: 5,
    duration: 2.5,
    turnRate: 0.9,       // rad/s the cone follows his facing
    push: 3.2,           // m/s away from him
    freezeAfter: 0.8,    // seconds inside it (in total) before the freeze
    tick: 0.25,
  },
  blizzard_chip: {       // a Blizzard tick (a hit kind): 10 damage a second
    id: 'blizzard_chip', name: 'Blizzard', ult: true, damage: 2.5, stun: 0, knockback: 0, staminaCost: 0, unblockable: true, noInterrupt: true,
  },
  blizzard_freeze: {     // a Blizzard's freeze (a hit kind): Frostfall's ice block
    id: 'blizzard_freeze', name: 'Blizzard', ult: true, damage: 0, stun: 0, knockback: 0, staminaCost: 0, unblockable: true,
    bind: 2.5, freeze: true,
  },
  eye_of_storm: {
    id: 'eye_of_storm', slot: 'ultimate', name: 'Eye of the Storm', short: 'Eye', ult: true,
    blurb: `Become a tornado for 3 s: 1.3× speed, unstoppable, pulls enemies within 7 m in, ${D(8)} damage every 0.5 s, then flings them out.`,
    duration: 3,
    speedMul: 1.3,
    radius: 7,
    pull: 1.9,           // m/s inward on enemies inside the radius (below the 3 m/s walk, so they can still crawl out)
    tick: 0.5, damage: 8, stun: 0, knockback: 0, staminaCost: 10,   // a ward facing her soaks a tick for 10
    height: 3,           // vertical reach
  },
  firewall_burn: {       // walking through a Firewall (a hit kind)
    id: 'firewall_burn', name: 'Firewall', damage: 15, stun: 0, knockback: 0, staminaCost: 0, unblockable: true, noInterrupt: true,
  },
  potion_splash: {       // Potion Toss's splash around where it shattered (a hit kind)
    id: 'potion_splash', name: 'Potion Toss', damage: 8, stun: 0, knockback: 1, staminaCost: 6, noInterrupt: true,
  },
  toxic_pool: {          // standing in a Toxic Flask's pool (a hit kind): 12 a second, every 0.5 s
    id: 'toxic_pool', name: 'Toxic Flask', damage: 6, stun: 0, knockback: 0, staminaCost: 0, unblockable: true, noInterrupt: true,
  },
  ram_shove: {           // Ram Ride running into an enemy (a hit kind)
    id: 'ram_shove', name: 'Ram Ride', damage: 15, stun: 0.4, knockback: 8, staminaCost: 20,
  },
  bulwark_frost: {       // touching an enemy Glacial Bulwark (a hit kind)
    id: 'bulwark_frost', name: 'Glacial Bulwark', damage: 4, stun: 0, knockback: 0, staminaCost: 0, unblockable: true,
    bind: 1.5, freeze: true,
  },
  eye_burst: {           // the final fling (a hit kind, not a spell in a kit)
    id: 'eye_burst', name: 'Eye of the Storm', ult: true,
    damage: 15, stun: 0.6, knockback: 8, staminaCost: 30, launch: 2.2,   // launch: visual hop height (m)
  },
  stampede: {
    id: 'stampede', slot: 'ultimate', name: 'Stampede', short: 'Stampede', ult: true,
    blurb: 'Hold Q to aim a lane, release: after a 1 s rumble, 8 rams thunder down it (6 m wide, 28 m long). Each flattens the first enemy it meets.',
    width: 6, length: 28,
    telegraph: 1,
    rams: 8,
    spread: 2,           // first to last ram
    range: 28,           // the aim point only sets the lane's direction
    castPose: 0.7,
  },
  berserker_brew: {
    id: 'berserker_brew', slot: 'ultimate', name: 'Berserker Brew', short: 'Brew', ult: true,
    blurb: 'Drink it down: for 7 s your potions and pools hit 50% harder, and every cooldown (your reload too) is halved.',
    duration: 7,
    damageMul: 1.5,
    cooldownMul: 0.5,
    drink: 1.2,          // the drinking pose
  },
  night_cage: {
    id: 'night_cage', slot: 'ultimate', name: 'Night Cage', short: 'Cage', ult: true,
    blurb: 'Hold Q to aim, release: a 7 m ring of black spikes for 4 s. Enemies inside can\'t get out, enemies outside can\'t get in. It heals you and your teammates inside, 10 HP a second.',
    radius: 7,
    range: 24,
    duration: 4,
    flyOver: 3,          // a wizard higher than this (Skyward Flash) passes over the ring
    castPose: 0.6,
    heal: 10,            // Ty: HP a second for Vesper and her teammates standing inside (to max HP)
  },
};

// Spark colour per wizard (a hot near-white core, this glow): brighter than the UI colours so it reads as fire.
export const BOLT_COLORS = { embibe: 0xa050e0, cinder: 0xff5a1e, gale: 0xb070ff, vesper: 0xff1f3d, rime: 0x7ad8ff };
export const boltColor = (wizard) => BOLT_COLORS[wizard] ?? 0x7ad8ff;

// Primary fire is a magazine: `magazine` shots (a Skim volley counts as one), then `reload` seconds.
// Pressing R, or `idleReload` seconds without firing, reloads a partial magazine. Only the last shot
// of a magazine (the "finisher") stuns and interrupts wind-ups; the others just do their damage.
export const primaryMag = (id) => SPELLBOOK[id] || SPELLBOOK.spark;
// The projectile kind each primary fires, and the kinds that follow the magazine rule (only the finisher interrupts).
export const PRIMARY_KIND = { spark: 'fast', glacial_skim: 'skim', fireball: 'fireball', gale_shear: 'shear', hex_shards: 'hex', sling: 'sling', potion_toss: 'potion' };
export const PRIMARY_KINDS = new Set(Object.values(PRIMARY_KIND));
// Ward-style guards (hold R, drain stamina): the Ward and Black Death.
export const isWard = (id) => !!SPELLBOOK[id]?.ward;
// Night Cage: keep `pos` (mutated) on its side of the ring. `inside` says which side it belongs to.
// Firewall geometry: where `p` sits relative to wall `w` ({ x, z, yaw }): `along` its length and `across` its plane.
export function firewallLocal(w, p) {
  const dx = p[0] - w.x, dz = p[2] - w.z;
  return { across: dx * Math.sin(w.yaw) + dz * Math.cos(w.yaw), along: dx * Math.cos(w.yaw) - dz * Math.sin(w.yaw) };
}
export function firewallCentre(p, yaw) {
  const F = SPELLBOOK.firewall;
  return [p[0] + Math.sin(yaw) * F.dist, p[2] + Math.cos(yaw) * F.dist];
}
export function cageClamp(pos, cage, inside) {
  const R = SPELLBOOK.night_cage.radius, pr = PLAYER_RADIUS;
  if ((pos[1] || 0) > SPELLBOOK.night_cage.flyOver) return false;
  const dx = pos[0] - cage.x, dz = pos[2] - cage.z, d = Math.hypot(dx, dz);
  if (inside && d > R - pr) { const k = (R - pr) / (d || 1); pos[0] = cage.x + dx * k; pos[2] = cage.z + dz * k; return true; }
  if (!inside && d < R + pr) { const k = (R + pr) / (d || 1e-3); pos[0] = cage.x + (d ? dx : 1e-3) * k; pos[2] = cage.z + dz * k; return true; }
  return false;
}

// Run speed of wizard `id` (wizards.js `speed`); wind-up and ward speeds scale with it.
export const speedOf = (id) => WIZARDS[id]?.speed ?? MOVE_SPEED;
// Casting roots the caster in place (Ty: "players should be stopped while casting a spell, unless it is a
// movement-based ability"). Turning and aiming still work. These are the short ones (seconds), each about as long as its
// cast pose up to the release; wind-ups, channels and held shields root for as long as they last.
export const CAST_ROOT = {
  primary: { fast: 0.28, fireball: 0.3, skim: 0.28, shear: 0.22, hex: 0.3, sling: 0.28, potion: 0.32 },
  heavyRelease: 0.3,   // Meteor leaving the hand (the charge before it is a wind-up)
  lashRelease: 0.3,
  frostfall: 0.5,      // Frostfall's cast pose
  toxic: 0.35, ram: 0.35,
  tapShield: 0.3,      // Firewall, Glacial Bulwark, Smoke Flask, Ram Guard (not Tempest Veil: Gale keeps moving)
  tk: 0.35,            // a telekinesis lift or throw gesture
  curse: 0.3,
};

// Sprint (Shift): a run at the wizard's `sprint` speed, paid from the same stamina as the ward.
export const SPRINT = { speed: 5.5, drain: 0, restart: 0 };   // m/s default. Round 10 (Ty): unlimited, no stamina (it still ends on a cast)
export const sprintOf = (id) => WIZARDS[id]?.sprint ?? SPRINT.speed;
export const chargeSpeedOf = (id) => speedOf(id) * CHARGE_MOVE_SPEED / MOVE_SPEED;
export const blockSpeedOf = (id) => speedOf(id) * BLOCK_MOVE_SPEED / MOVE_SPEED;

// Backpedalling is slower: moving against the facing direction is capped at BACKPEDAL_SPEED, easing back to
// full speed as the direction turns sideways (strafing is full speed). (dx, dz) is the movement direction.
export const BACKPEDAL_SPEED = 2;    // walking backward (strafing goes at the forward speed)
export function backpedalSpeed(speed, dx, dz, yaw) {
  const l = Math.hypot(dx, dz);
  if (l < 1e-6) return speed;
  const back = -(dx * Math.sin(yaw) + dz * Math.cos(yaw)) / l;   // 1 = straight back, 0 = sideways
  return back > 0 ? speed - Math.max(0, speed - BACKPEDAL_SPEED) * back : speed;
}

// The kit (slot -> spell id) of wizard `id`, falling back to the default wizard.
export const kitOf = (id) => (WIZARDS[id] || WIZARDS[DEFAULT_WIZARD]).kit;

// Damage/stun/knockback/stamina spec for a `hit` kind: a projectile kind or a spellbook id.
export const hitSpec = (kind) => SPELLS[kind] || SPELLBOOK[kind];

// Longest a Skyward Flash can keep a wizard off the ground (float at the slowest rate, then drop).
export const FLIGHT_MAX_TIME = SPELLBOOK.skyward.floatTime + SPELLBOOK.skyward.maxHeight / SPELLBOOK.skyward.dropSpeed + 0.6;

export const PICKUP_RANGE = 2.6;      // grab the nearest prop at point-blank range, wherever you aim
export const THROW_COOLDOWN = SPELLBOOK.telekinesis.cooldown;
export const SPARK_STUN_IMMUNITY = 0.6; // after a spark stun ends, further sparks don't re-stun for this long

// Telekinesis: aim at a prop and lift it from range; it floats beside you until thrown.
export const TK = {
  range: 16,
  aimConeDeg: 12,
  liftTime: 0.35,
  hold: { fwd: 1.25, side: -0.75, up: 1.75 },  // relative to the caster; side < 0 is their right, clear of the crosshair
};

// Where a carried prop floats for a wizard at `p` facing `yaw`.
export function holdPoint(p, yaw) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);       // forward
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);      // right
  return [p[0] + fx * TK.hold.fwd + rx * TK.hold.side, p[1] + TK.hold.up, p[2] + fz * TK.hold.fwd + rz * TK.hold.side];
}

// Launch direction for a projectile of `speed` under `gravity` so it passes through `target`.
// Straight-line travel time is close enough for the flat, fast arcs used here.
export function ballisticDir(origin, target, speed, gravity) {
  const dx = target[0] - origin[0], dy = target[1] - origin[1], dz = target[2] - origin[2];
  const t = Math.hypot(dx, dy, dz) / speed;
  const vx = dx / (t || 1), vy = dy / (t || 1) + 0.5 * gravity * t, vz = dz / (t || 1);
  const l = Math.hypot(vx, vy, vz) || 1;
  return [vx / l, vy / l, vz / l];
}

// Does the 2D segment a→b pass through anything tall enough to block a chest-height line
// (pillars, trees, buildings — not fences or crops)? Returns the collider or null.
export function pillarBlocks(a, b, pad = 0) {
  const sx = b[0] - a[0], sz = b[2] - a[2];
  const ll = sx * sx + sz * sz || 1;
  for (const c of COLLIDERS) {
    if (c.h < LOS_HEIGHT) continue;
    const k = Math.max(0, Math.min(1, ((c.x - a[0]) * sx + (c.z - a[2]) * sz) / ll));
    if (Math.hypot(a[0] + sx * k - c.x, a[2] + sz * k - c.z) < c.r + pad) return c;
  }
  // round 9: platforms and ramps, at body height above each end's feet (a ledge hides who's behind or under it)
  if (SURFACES?.length && surfaceBlocks?.([a[0], (a[1] || 0) + 1.1, a[2]], [b[0], (b[1] || 0) + 1.1, b[2]])) return { kind: 'surface', h: 99 };
  // round 10: sight-only volumes (the canopy fort's foliage): they hide, but don't stop movement or spells
  if (MAPNS.losVolumeBlocks?.([a[0], (a[1] || 0) + 1.1, a[2]], [b[0], (b[1] || 0) + 1.1, b[2]])) return { kind: 'foliage', h: 99 };
  return null;
}
export const PROP_RESPAWN_TIME = 18;

export const PLAYER_COLORS = [
  0xff5c5c, 0x5cb8ff, 0x6ef08a, 0xffd25c, 0xd98cff, 0xff9d5c, 0x5cf0e0, 0xff7ad9,
];

export const MAX_NAME_LEN = 14;

// Where a blink lands. Used by the server (authoritative) and the client (prediction),
// so the two must agree exactly.
export function computeTeleport(from, dir, distance = TELEPORT.distance) {
  const l = Math.hypot(dir[0], dir[2]) || 1;
  const dx = dir[0] / l, dz = dir[2] / l;
  let to = [from[0] + dx * distance, 0, from[2] + dz * distance];
  const r = Math.hypot(to[0], to[2]);
  if (r > ARENA_RADIUS - 1) { to[0] *= (ARENA_RADIUS - 1) / r; to[2] *= (ARENA_RADIUS - 1) / r; }
  for (const c of COLLIDERS) {
    const d = Math.hypot(to[0] - c.x, to[2] - c.z);
    if (d < c.r + PLAYER_RADIUS) {
      const push = (c.r + PLAYER_RADIUS + 0.1) / (d || 1);
      to = [c.x + (to[0] - c.x) * push, 0, c.z + (to[2] - c.z) * push];
    }
  }
  return to;
}

// Mirror Step: the three end points (centre, then the two side paths) and their directions.
export function mirrorPaths(from, dir) {
  const MS = SPELLBOOK.mirror_step;
  const base = Math.atan2(dir[0], dir[2]);
  return [0, -1, 1].map(k => {
    const a = base + k * MS.spreadDeg * Math.PI / 180;
    const d = [Math.sin(a), 0, Math.cos(a)];
    return { to: computeTeleport(from, d, MS.distance), dir: d };
  });
}

// Glacial Bulwark: the wall raised by a wizard at `p` facing `yaw`, as a chain of collider circles
// perpendicular to the aim. Server and clients build the same circles from { id, x, z, yaw }.
export function bulwarkCircles(id, x, z, yaw) {
  const B = SPELLBOOK.glacial_bulwark;
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const span = B.width - 2 * B.r;
  const out = [];
  for (let i = 0; i < B.circles; i++) {
    const k = (i / (B.circles - 1) - 0.5) * span;
    out.push({ x: x + rx * k, z: z + rz * k, r: B.r, h: B.height, kind: 'bulwark', wall: id });
  }
  return out;
}
export function bulwarkCentre(p, yaw) {
  const B = SPELLBOOK.glacial_bulwark;
  return [p[0] + Math.sin(yaw) * B.dist, p[2] + Math.cos(yaw) * B.dist];
}
// Add / remove a wall's circles in the shared collider list (everything collides against it).
export function addWallColliders(id, x, z, yaw) {
  removeWallColliders(id);
  COLLIDERS.push(...bulwarkCircles(id, x, z, yaw));
}
export function removeWallColliders(id) {
  for (let i = COLLIDERS.length - 1; i >= 0; i--) if (COLLIDERS[i].wall === id) COLLIDERS.splice(i, 1);
}

// Smoke Screen: does the 2D segment a→b pass through a smoke cloud (or start or end inside one)?
// Clouds are { x, z } with SPELLBOOK.smoke_screen.radius; anything above the cloud's top sees over it.
export function smokeBlocks(a, b, clouds) {
  const S = SPELLBOOK.smoke_screen;
  if ((a[1] || 0) > S.height && (b[1] || 0) > S.height) return false;
  const sx = b[0] - a[0], sz = b[2] - a[2], ll = sx * sx + sz * sz || 1;
  for (const c of clouds) {
    const k = Math.max(0, Math.min(1, ((c.x - a[0]) * sx + (c.z - a[2]) * sz) / ll));
    if (Math.hypot(a[0] + sx * k - c.x, a[2] + sz * k - c.z) < S.radius) return true;
  }
  return false;
}
export const inSmoke = (p, clouds) => (p[1] || 0) < SPELLBOOK.smoke_screen.height
  && clouds.some(c => Math.hypot(p[0] - c.x, p[2] - c.z) < SPELLBOOK.smoke_screen.radius);
