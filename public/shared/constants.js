// Shared between server and client. Keep this file dependency-free.
// Map layout (arena size, obstacles, props, spawns) lives in map.js and is re-exported here.
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
// Ram and Meteor Rain one-shots stay one-shots. D(n) is a blurb's number at this scale.
export const DAMAGE_SCALE = 1.36;   // round 15 (pacing on the castle): 1.3 left hard bots at 1.5 kills a minute
export const D = (n) => Math.round(n * DAMAGE_SCALE);
// Round 10: out of combat (no damage taken for `delay` s), health comes back at `rate` HP a second, up to full.
export const REGEN = { delay: 7, rate: 6 };   // round 14 (pacing): 5 s / 8 HP/s let most fights reset into full regen
// Round 10: health potions at map.js HEAL_SPOTS: 35 HP on touch (only when hurt), back after 20 s.
export const POTION = { heal: 35, respawn: 20, radius: 0.9, height: 1.0 };
// Round 10: ledge grab. Jumping at an edge whose top is out of the jump's reach (but at most `reach` above its apex)
// pulls you up onto it in `time` s (cast-rooted). ledgeTarget is the one rule for client, server and bots.
export const LEDGE = { reach: 1.2, time: 0.45, rise: 0.3 };
// Round 10 (Ty): a thrown object (a prop, a potion barrel, a crate) that hits an unblocked wizard knocks them down:
// flung back about 2 m, they fall (fall), lie there (down) and get up (getup), unable to move, act or shield throughout.
export const KNOCKDOWN = { kinds: ['prop', 'battering_ram', 'ram_charge'], fall: 0.4, down: 0.8, getup: 0.4, fling: 24 };   // fling: m/s, decays to ~2 m
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
// A jump is a fixed arc: `height` at the apex, `airTime` up and down (v0 = 4h/T, g = 8h/T²). Round 13: full air control
// (no cast lock any more: everything casts in the air), and `coyote` s of grace to jump after walking off an edge.
export const JUMP = { height: 1.45, airTime: 0.55 * Math.sqrt(1.45 / 1.1), airControl: 1.0, stamina: 10, coyote: 0.12 };   // round 10: 30% higher (1.1 -> 1.45 m, same gravity)
JUMP.v0 = 4 * JUMP.height / JUMP.airTime; JUMP.gravity = 8 * JUMP.height / JUMP.airTime ** 2;
export const jumpY = (e) => Math.max(0, JUMP.v0 * e - JUMP.gravity * e * e / 2);   // height above take-off, e s in
// Round 13: the double jump. Space while airborne (a jump, a fall off an edge, a drop after a dash): one fresh arc from
// the current height, `height` higher, same gravity. One per airtime; landing gives it back.
export const AIR_JUMP = { height: 1.2, stamina: 10 };
AIR_JUMP.v0 = Math.sqrt(2 * JUMP.gravity * AIR_JUMP.height);
// A jump record is { start, y0, n } (n 2 = the air jump). Its rise speed, apex and height e s in (server and client alike):
export const jumpV0 = (J) => (J?.n === 2 ? AIR_JUMP.v0 : JUMP.v0);
export const jumpApex = (J) => J.y0 + (J.n === 2 ? AIR_JUMP.height : JUMP.height);
export const jumpAt = (J, e) => J.y0 + jumpV0(J) * e - JUMP.gravity * e * e / 2;
// Round 13: snappier movement at the same top speeds. Velocity eases toward the wanted one at `accel` per second
// (`stop` when no key is held); in the air at accel × JUMP.airControl, with only `airDrag` when no key is held, so a
// sprint-jump carries its speed.
export const MOVE_ACCEL = { accel: 24, stop: 30, airDrag: 1.5 };
// Crouched: slow, and a smaller, lower hit sphere, so low cover (fences, crops, hay, table rocks) hides you.
export const CROUCH = { speed: 1.6, hitCenter: 0.5, hitRadius: 0.42 };   // top of the sphere 0.92 m: under a chest-high shot
export const hitCenterOf = (q) => (q?.crouch ? CROUCH.hitCenter : HIT_CENTER_Y);
export const hitRadiusOf = (q) => (q?.crouch ? CROUCH.hitRadius : HIT_RADIUS);

export const MOVE_SPEED = 3.0;        // m/s: everyone's walk (round 11: one generic wizard; Ty: normal movement is a walk)
export const CHARGE_MOVE_SPEED = MOVE_SPEED * 0.32;   // while winding up
export const BLOCK_MOVE_SPEED = MOVE_SPEED * 0.42;    // while blocking

export const MAX_HP = 100;
export const MAX_STAMINA = 100;
export const STAMINA_DRAIN_BLOCKING = 14;   // per second while holding block
export const STAMINA_REGEN = 22;            // per second when not blocking
export const STAMINA_REGEN_DELAY = 0.8;     // seconds after block released
export const BLOCK_CONE_DEG = 110;          // spells arriving inside this frontal cone are blockable
export const BLOCK_BREAK_STUN = 1.1;        // stun when stamina runs out mid-block

export const RESPAWN_TIME = 2.0;      // round 14 (pacing): was 3
// Round 14: after a respawn, `time` s of no damage taken (ends early when you cast an attack). The respawn picks the
// spawn farthest from enemies among those `min`–`max` m from the nearest one (else the 2nd-farthest overall).
export const SPAWN_PROTECT = { time: 1.5 };
export const SPAWN_CHOICE = { min: 18, max: 26 };   // the brief's 20–30 gave 29 m and 7.0 s to first damage on normal; this, 25 m and 6.1 s
// Round 14: every primary's magazine reloads in this long (was 1.5 s).
export const PRIMARY_RELOAD = 1.2;

export const SPELLS = {
  fast: {
    damage: 12,          // round 14 (pacing): 9; even out the primaries' time to kill
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
    speed: 26,           // round 14: 19 (sidestepped at a walk from 25 m)
    radius: 0.65,
    life: 57 / 26,       // about 57 m
    cooldown: 4,         // round 14: 1.2
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
    damage: 9,           // round 14: 11 (three shards a volley: it led the primaries)
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
    damage: 16,          // round 14: 18 / 26 (round 10: 20 had Cinder on top in 3 of 3 runs)
    finDamage: 24,       // the 3rd shot of the magazine
    stun: 0.55,
    speed: 30,           // round 14: 24
    radius: 0.45,
    life: 31 / 30,       // about 31 m
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
    damage: 10,          // round 14: 7 (round 15: the card's mid value; a hit deals slingDamage(flown) instead)
    near: 6.6,           // round 15 (Ty: no ambient rams to aggro any more): at point blank (×1.36: 9)...
    far: 15.5,           // ...rising in a straight line to this at `farDist` m flown (×1.36: 21), and staying there
    farDist: 28,
    longShot: 18,        // flown this far: a "long" hit (the bigger number, the hit message's `long`)
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
    speed: 24,           // round 14: 20
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
    damage: 14,          // round 14: 11
    stun: 0.55,
    speed: 28,           // along the curve (round 14: 22)
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
  r.at = flaskSettle(r.at, dir);
  return r;
}
// Where she can stand near `at` (at[1]: the height it came down at): out of anything solid, inside the arena. The
// server's arrival uses this too.
export function flaskSettle(at, dir = null) {
  const to = at.slice();
  for (let k = 0; k < 3; k++) for (const c of COLLIDERS) {
    if (c.h < 0.5) continue;
    const dx = to[0] - c.x, dz = to[2] - c.z, d = Math.hypot(dx, dz);
    if (d < c.r + PLAYER_RADIUS && d > 1e-4) { const kk = (c.r + PLAYER_RADIUS - d) / d; to[0] += dx * kk; to[2] += dz * kk; }
  }
  const r = Math.hypot(to[0], to[2]);
  if (r > ARENA_RADIUS - 0.5) { to[0] *= (ARENA_RADIUS - 0.5) / r; to[2] *= (ARENA_RADIUS - 0.5) / r; }
  return landingSpot(to[0], to[2], Math.max(0, at[1] || 0), dir);
}
// Round 15 (the castle is SURFACES boxes, not collider circles): where a wizard arriving without walking there (a
// blink, a Mirror Step, a Flask Step) with feet at footY ends up near (x, z). Inside the castle walls; out of
// anything solid: on top of it when its top is within LAND_REACH above the feet (a blink into the rampart lands on
// the wall-walk), otherwise stepped back along `dir` ([x, z] or [x, y, z], the way it came) until clear. Returns
// [x, y, z] with y the standing height there (the same rule as walking: surfaceHeight).
export const LAND_REACH = 4;
export function landingSpot(x, z, footY = 0, dir = null) {
  if (MAPNS.clampToArena && MAPNS.ARENA_BOUNDS && Number.isFinite(MAPNS.ARENA_BOUNDS.x0)) [x, z] = MAPNS.clampToArena(x, z, PLAYER_RADIUS + 0.1);
  const solid = MAPNS.surfaceSolidAt, top = MAPNS.surfaceTopAt, push = MAPNS.surfacePushOut;
  if (!solid || !top) return [x, footY, z];
  const dl = dir ? Math.hypot(dir[0], dir.length === 3 ? dir[2] : dir[1]) || 1 : 1;
  const bx = dir ? -dir[0] / dl : 0, bz = dir ? -(dir.length === 3 ? dir[2] : dir[1]) / dl : 0;
  for (let k = 0; k < 30; k++) {
    if (!solid(x, footY + 0.5, z) && !solid(x, footY + 1.4, z)) {
      const y = _sh(x, z, footY);
      if (push) [x, z] = push(x, z, y, PLAYER_RADIUS);   // (not half inside a wall's edge)
      return [x, _sh(x, z, y), z];
    }
    const t = top(x, z);
    if (t <= footY + LAND_REACH && !solid(x, t + 0.5, z) && !solid(x, t + 1.4, z)) {
      if (push) [x, z] = push(x, z, t, PLAYER_RADIUS);
      return [x, _sh(x, z, t), z];
    }
    if (!dir) break;
    x += bx * 0.4; z += bz * 0.4;
  }
  return [x, footY, z];
}
function flaskFlight(origin, dir) {
  const F = SPELLS.flaskstep, dt = 1 / 60;
  const p = origin.slice(), v = dir.map(c => c * F.speed), path = [p.slice()];
  for (let t = 0; t < F.life; t += dt) {
    v[1] -= F.gravity * dt;
    p[0] += v[0] * dt; p[1] += v[1] * dt; p[2] += v[2] * dt;
    if (path.length < 400 && Math.round(t / dt) % 3 === 0) path.push(p.slice());
    if (p[1] <= F.radius * 0.5 || Math.hypot(p[0], p[2]) > ARENA_RADIUS + 6) return { path, at: [p[0], 0, p[2]], blocked: false };
    // round 15: the castle's boxes. Coming down onto a top: she lands there; into a side: she backs off it.
    const sh = MAPNS.surfaceSolidAt?.(p[0], p[1], p[2], true);
    if (sh) {
      const t = MAPNS.surfaceTopAt(p[0], p[2]), l = Math.hypot(v[0], v[2]) || 1;
      if (v[1] < 0 && p[1] > t - 0.6) return { path, at: [p[0], t, p[2]], blocked: false };
      return { path, at: [p[0] - v[0] / l * 0.8, p[1], p[2] - v[2] / l * 0.8], blocked: true };
    }
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

// Round 15: Shepherd's Sling hits harder the further the stone has flown (base damage, before DAMAGE_SCALE).
export const slingDamage = (flown) => { const S = SPELLS.sling; return S.near + (S.far - S.near) * Math.max(0, Math.min(1, flown / S.farDist)); };

// The summoned rams (Ram Guard, Battering Ram, Stampede, Ram Ride and the Sling's call): server.js simulates them.
// Round 15: these were map.js's GOAT numbers; the map goats are gone.
export const RAM = {
  radius: 0.6,          // body radius for collisions and hits
  hitY: 0.7,            // centre of the hit sphere above the ground
  windup: 0.7,          // a Sling's ram rears this long before it charges
  chargeSpeed: 12.5,
  chargeTime: 3.0,      // longest a charge lasts
  turnRate: 2.0,        // rad/s of homing (a provoked guard ram, a Sling's ram): you can sidestep late or blink
  dizzyTime: 2.2,       // after hitting a pillar, a wall or a ward
  recoverTime: 1.2,     // after a charge runs out
  blockCost: 50,        // stamina a ward spends stopping a ram
  blockKnockback: 7,
  rammableBelow: 1.0,   // wizards whose feet are higher than this (Skyward Flash, a wall-walk) are passed under
  ramScale: 1.15,       // (visual) the ram model's scale
};

export const TELEPORT = {
  distance: 9,
  cooldown: 4.0,
};

// ---------------------------------------------------------------- spellbook
// Every spell, keyed by id. A player's loadout picks one per slot (round 11; see the loadouts section at the end).
// Adding a spell = one entry here plus its handler on the server (server.js) and client (main.js).
// `short` is the ability bar label. `cooldown` is per slot.
export const SLOT_INFO = {
  primary:  { key: 'LMB',   label: 'Primary' },
  power:    { key: 'RMB',   label: 'Power' },
  mobility: { key: 'E',     label: 'Mobility' },
  guard:    { key: 'R',     label: 'Shield' },
  utility:  { key: 'F',     label: 'Utility' },
  ultimate: { key: 'Q',     label: 'Ultimate' },
};

// Ultimate charge (0–100 %, server-authoritative, kept through death, reset on use). Ultimates' own
// damage doesn't charge. Game modes add more through ctx.addUltCharge (the Sacred Relic: +2 %/s).
export const ULT_CHARGE = {
  max: 100,
  perDamage: 1 / 3,    // % per point of damage dealt to an enemy
  passive: 1.0,        // % per second while alive (round 14: 0.5)
  kill: 10,            // % per kill (round 14: 5): an ultimate about every 40 s
  windup: 1.3,         // every ultimate: a readable 1.3 s cast first, interrupted like any wind-up...
  fizzleKeep: 50,      // ...and an interrupted one fizzles, keeping this much charge
};

export const SPELLBOOK = {
  spark: {
    id: 'spark', slot: 'primary', name: 'Spark', short: 'Spark',
    blurb: 'Quick bolts, 3 to a charge, then a reload. The 3rd stuns and breaks a wind-up.',
    cooldown: SPELLS.fast.cooldown,
    magazine: 3, reload: PRIMARY_RELOAD, idleReload: 2,   // see PRIMARY_MAGAZINE
  },
  glacial_skim: {
    id: 'glacial_skim', slot: 'primary', name: 'Glacial Skim', short: 'Skim',
    blurb: 'Three ice shards skim the ground and slow by 35% for 2 s. 3 volleys, then a reload; the 3rd breaks a wind-up.',
    shards: 3, spreadDeg: 6,
    cooldown: 0.6,
    magazine: 3, reload: PRIMARY_RELOAD, idleReload: 2,
  },
  fireball: {
    id: 'fireball', slot: 'primary', name: 'Fireball', short: 'Fireball',
    blurb: `Big, hot bolts, 3 to a charge, then a reload. ${D(SPELLS.fireball.damage)} damage; the 3rd hits for ${D(SPELLS.fireball.finDamage)}, stuns and breaks a wind-up.`,
    cooldown: SPELLS.fireball.cooldown,
    magazine: 3, reload: PRIMARY_RELOAD, idleReload: 2,
  },
  gale_shear: {
    id: 'gale_shear', slot: 'primary', name: 'Gale Shear', short: 'Shear',
    blurb: `A blade of wind out to 8 m (${D(16)} damage), 3 to a charge. The 3rd is a wide crescent that breaks a wind-up.`,
    cooldown: SPELLS.shear.cooldown,
    magazine: 3, reload: PRIMARY_RELOAD, idleReload: 2,
  },
  potion_toss: {
    id: 'potion_toss', slot: 'primary', name: 'Potion Toss', short: 'Potion',
    blurb: `Arcing potions, 2 to a belt, then a reload. ${D(16)} damage with a small splash; the 2nd hits for ${D(14)} and stuns.`,
    cooldown: SPELLS.potion.cooldown,
    magazine: 2, reload: PRIMARY_RELOAD, idleReload: 2,
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
    blurb: `Sling stones, 2 to a pouch: more damage the further it flies (${D(SPELLS.sling.near)} up close, ${D(SPELLS.sling.far)} at ${SPELLS.sling.farDist} m). A hit calls a ram out of the ground beside the target to charge them. The 2nd breaks a wind-up.`,
    cooldown: SPELLS.sling.cooldown,
    magazine: 2, reload: PRIMARY_RELOAD, idleReload: 2,
    callDist: 7,         // round 15: the called ram appears this far from the target, off to one side
    callLockout: 6,      // seconds before the same target can have another ram called on it (balance match: 3 was too many)
  },
  hex_shards: {
    id: 'hex_shards', slot: 'primary', name: 'Hex Shards', short: 'Hex',
    blurb: 'Crimson glyphs that curve in on the aim point: from the left, from the right, then a high lob that breaks a wind-up.',
    cooldown: SPELLS.hex.cooldown,
    magazine: 3, reload: PRIMARY_RELOAD, idleReload: 2,
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
    cooldown: 9,         // round 14: 13
  },
  frostfall: {
    id: 'frostfall', slot: 'power', name: 'Frostfall', short: 'Frostfall',
    blurb: `Hold to aim a circle, release: 1.75 s later a block of ice crushes it. ${D(44)} damage and freezes 1.2 s. Wards don't help.`,
    radius: 3.2,         // the circle
    range: 24,           // farthest centre from the caster
    delay: 1.75,         // release to impact; everyone sees the shadow grow meanwhile
    fall: 0.5,           // the ice is visible falling for this long before impact
    castPose: 0.5,
    height: 2,           // wizards whose feet are higher than this are out of reach
    damage: 44,          // round 15: 50 (46% of Power's kills on normal)
    stun: 0,
    knockback: 0,
    bind: 1.2,           // frozen: rooted and silenced, like the lash's bind (round 15: 1.5)
    unblockable: true,   // it comes from above: wards and ice walls don't stop it
    airCast: true,       // the one power spell Rime can cast during a Skyward Flash
    cooldown: 10,        // round 14: 14
  },
  battering_ram: {
    id: 'battering_ram', slot: 'power', name: 'Battering Ram', short: 'Ram',
    blurb: `Stomp for 0.8 s (a hit stops you), then a ram bursts out in front of you and charges dead straight along your aim. The first enemy it meets takes ${D(54)} and is knocked flat, unless a ward, wall or Veil stops it.`,
    windup: 0.8,         // round 10 (Ty: too strong): a stomp and a ghost ram pawing the ground first; cast-rooted, interruptible
    interruptCd: 3,      // the cooldown an interrupted wind-up leaves
    spawnDist: 1.4,
    maxTime: 3,          // the charge runs at RAM.chargeSpeed for at most this long
    // round 14 (Ty): no longer a one-shot. What the charge does to an enemy (a hit kind, 'battering_ram'): D(54) = 70
    // and a knockdown (KNOCKDOWN.kinds). server.js ramHits already decided a ward, wall or Veil stopped it.
    damage: 54, stun: 0, knockback: 0, staminaCost: 0, unblockable: true,
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
    blurb: 'Hold: a black shroud blocks spells from every side, for about 3.5 s of stamina. Each block heals you for 30% of the damage it absorbed and charges your next Lash.',
    cooldown: 0,
    drainMul: 2.0,          // stamina drains this much faster than the base ward rate (about 3.6 s from full; round 14: 2.5, 2.9 s)...
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
    noRoot: true,        // no cast root: you keep moving (round 11: the spell's property, not Gale's)
    cooldown: 7,         // from activation; it can't be refreshed while up (round 14: 10)
  },
  ram_guard: {
    id: 'ram_guard', slot: 'guard', name: 'Ram Guard', short: 'Ram Guard',
    blurb: `Tap: 3 rams circle you for 3 s and take shots meant for you. Whoever hits one gets charged by it (${D(30)} and knocked flat).`,
    count: 3, radius: 2.2, lap: 1.5, life: 3,
    cooldown: 10,
  },
  glacial_bulwark: {
    id: 'glacial_bulwark', slot: 'guard', name: 'Glacial Bulwark', short: 'Bulwark',
    blurb: 'Tap to raise a 6 m ice wall ahead that blocks everything and freezes enemies who touch it. 5 s or 80 damage.',
    dist: 2.8, width: 6, height: 4,
    circles: 9, r: 0.4,   // collider chain
    life: 5, hp: 80,      // round 14: 120 (Ty: shields much shorter, was 10 s, 220)
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
    blurb: 'Curse an object. It explodes when an enemy comes near, lifts it or breaks it.',
    hold: 0.5,           // F on an object: this long to curse it (no lifting with Relic: only Telekinesis lifts)
    traps: 2,            // armed at once per caster; a third clears the oldest
    trigger: 1.8,        // an enemy this close (m, centre to centre) to a resting trap lights it
    fuse: 0.25,          // lit, it flares, then blows this long later
    seen: 6,             // enemies within this see the trap's glyph
    damage: 45, radius: 3.5,
    stun: 0.4,
    knockback: 7,
    staminaCost: 40,     // a ward facing the blast blocks it
    cooldown: 6,         // round 14: 3
    liftCooldown: 6,     // after each curse (p.cd.lift)
  },
  roll: {
    id: 'roll', slot: 'utility', name: 'Roll', short: 'Roll',   // round 13 (Ty): a Utility (F), no longer Mobility
    blurb: 'Roll 4.5 m the way you are moving (backwards if standing still). Projectiles pass through you for the first 0.25 s; area damage still lands. 2 charges.',
    distance: 4.5,
    dashTime: 0.35,      // a fast dash, not a teleport: it collides and steps up like walking
    immune: 0.25,        // from the start of the roll: projectiles pass through (areas, beams and rams still hit)
    charges: 2,          // each charge refills `cooldown` after it was spent
    cooldown: 3.5,
    liftCooldown: 3.5,   // (the F slot's cooldown: each charge's refill)
  },

  // ---- ultimates (Q). `ult: true` hits never charge the ultimate. Each one cannot be cancelled once cast.
  meteor_rain: {
    id: 'meteor_rain', slot: 'ultimate', name: 'Meteor Rain', short: 'Meteor Rain', ult: true,
    blurb: `Leap 12 m into the sky and hover up to 4 s, aiming a 4 m circle; Q or a click dives on it as a falling blaze. Everything within 2.4 m of the centre, or in your path, dies; the rest of the circle takes ${D(44)} at the kill ring, falling to ${D(30)} at its edge. A hit that interrupts knocks you down.`,
    height: 12,          // the leap
    rise: 0.5,           // seconds to get up there
    hover: 4,            // longest hover; then she dives on her last aim
    radius: 4,           // the landing circle (its outer edge: the splash)
    killRadius: 2.4,     // round 15 (Ty: it took 75% of Ultimate kills): only this inner circle kills; was the whole 4 m
    splash: [44, 30],    // base damage between the kill ring and the edge (×1.36: 60 at the ring, 41 at the edge)
    range: 24,           // farthest landing from where she leapt
    dive: 0.6,
    pathRadius: 1.2,     // anyone this close to her dive path is caught too
  },
  meteor_rain_hit: {     // what the dive does to an enemy (a hit kind): death, unless a Tempest Veil absorbs it
    id: 'meteor_rain_hit', name: 'Meteor Rain', ult: true, damage: 1000, stun: 0, knockback: 6, staminaCost: 0, unblockable: true,
  },
  meteor_rain_splash: {  // round 15: the landing circle outside the kill ring (a hit kind; the damage comes from MRAIN.splash)
    id: 'meteor_rain_splash', name: 'Meteor Rain', ult: true, damage: 44, stun: 0.4, knockback: 8, staminaCost: 0, unblockable: true,
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
  ram_charge: {          // round 15: a Sling's called ram or a provoked guard ram getting through (a hit kind): damage and a knockdown, no longer a kill
    id: 'ram_charge', name: 'a charging ram', damage: 30, stun: 0, knockback: 0, staminaCost: 0, unblockable: true,
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
    blurb: 'Hold Q to aim, release: a 7 m ring of black spikes for 4 s. Enemies inside can\'t get out, enemies outside can\'t get in. It heals you while you are inside, 10 HP a second.',
    radius: 7,
    range: 24,
    duration: 4,
    flyOver: 3,          // a wizard higher than this (Skyward Flash) passes over the ring
    castPose: 0.6,
    heal: 10,            // Ty: HP a second for Vesper and her teammates standing inside (to max HP)
  },
};


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

// Movement speeds (round 11: the same for everyone; the argument is ignored, kept so old call sites read the same).
export const speedOf = () => MOVE_SPEED;
// Round 13 (Ty: "most spells should be able to be cast while moving; only significant spells require rooting"): a cast
// slows the caster to `mult` of their speed for `time` s (a sprint carries on after it). Only the big wind-ups root:
// Meteor's charge, Sanguine Lash's and Battering Ram's wind-ups, an ultimate's wind-up, the Blizzard channel (and a
// ledge pull-up). Started in mid-air, those hang the caster at that height until they end (server.js startHover).
export const CAST_SLOW = { mult: 0.6, time: 0.3 };

// Sprint (Shift): a run at SPRINT.speed.
export const SPRINT = { speed: 5.5, drain: 0, restart: 0 };   // m/s default. Round 10 (Ty): unlimited, no stamina. Round 13: a cast no longer ends it
export const sprintOf = () => SPRINT.speed;
export const chargeSpeedOf = () => CHARGE_MOVE_SPEED;
export const blockSpeedOf = () => BLOCK_MOVE_SPEED;

// Backpedalling is slower: moving against the facing direction is capped at BACKPEDAL_SPEED, easing back to
// full speed as the direction turns sideways (strafing is full speed). (dx, dz) is the movement direction.
export const BACKPEDAL_SPEED = 2;    // walking backward (strafing goes at the forward speed)
export function backpedalSpeed(speed, dx, dz, yaw) {
  const l = Math.hypot(dx, dz);
  if (l < 1e-6) return speed;
  const back = -(dx * Math.sin(yaw) + dz * Math.cos(yaw)) / l;   // 1 = straight back, 0 = sideways
  return back > 0 ? speed - Math.max(0, speed - BACKPEDAL_SPEED) * back : speed;
}


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
// Round 15: where a cast leaves the staff head. Measured on the KayKit Mage: at a cast's release the orb is about 0.33 m to the
// body's right, 0.9 m up and 1.15 m ahead (at idle the staff is carried low, at the hip). The ahead part is held to 0.85 m so
// a shot never starts past a wall in front of the caster; if a wall is between the chest and that point, the chest it is.
export const STAFF_RELEASE = { side: -0.33, up: 0.95, fwd: 0.85 };
export function castPoint(p, yaw) {
  const R = STAFF_RELEASE, fx = Math.sin(yaw), fz = Math.cos(yaw), lx = Math.cos(yaw), lz = -Math.sin(yaw);   // forward; the body's +x (its left)
  const at = [p[0] + fx * R.fwd + lx * R.side, p[1] + R.up, p[2] + fz * R.fwd + lz * R.side];
  const chest = [p[0], p[1] + 1.1, p[2]];
  return MAPNS.surfaceSegmentHit?.(chest, at) ? [p[0], p[1] + 1.3, p[2]] : at;
}

// Round 15: [x, y, z], y the standing height there (landingSpot: on the castle's walls, never inside one).
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
  return landingSpot(to[0], to[2], Math.max(0, from[1] || 0), [dx, dz]);
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

// ---------------------------------------------------------------- loadouts (round 11: the spell builder)
// No heroes: every player is the same generic wizard (WALK_SPEED, SPRINT.speed, MAX_HP, one hitbox) with a free
// loadout, one SPELLBOOK spell per slot. The server keeps p.loadout (sanitizeLoadout) and p.voice; a change made in
// game waits in p.pendingLoadout until the next respawn. The builder UI reads SPELL_POOL, SPELL_INFO, PRESETS,
// COMBOS and the helpers below; the look (robe tint, aura) follows loadoutElements / dominantElement.
export const LOADOUT_SLOTS = ['primary', 'power', 'guard', 'mobility', 'utility', 'ultimate'];   // builder row order
export const WALK_SPEED = MOVE_SPEED;  // everyone walks at this (sprint: SPRINT.speed)

// The six elements. `color` is the UI and robe accent, `bolt` the brighter projectile/glow colour, `aura` the looks.js
// flair name (null: none). Arcane is the neutral one (Spark, Ward, Telekinesis).
export const ELEMENTS = {
  fire:   { id: 'fire',   name: 'Fire',   color: 0xff5c3c, bolt: 0xff5a1e, aura: 'ember' },
  wind:   { id: 'wind',   name: 'Wind',   color: 0xb46cff, bolt: 0xb070ff, aura: 'motes' },
  ice:    { id: 'ice',    name: 'Ice',    color: 0x7fd8ff, bolt: 0x7ad8ff, aura: 'frost' },
  dark:   { id: 'dark',   name: 'Blood',  color: 0xd8203c, bolt: 0xff1f3d, aura: 'smoke' },
  earth:  { id: 'earth',  name: 'Earth',  color: 0xc9a66b, bolt: 0xf0c060, aura: 'dust' },
  acid:   { id: 'acid',   name: 'Alchemy', color: 0x7fd34a, bolt: 0xa050e0, aura: 'drip' },
  arcane: { id: 'arcane', name: 'Arcane', color: 0x9ab8ff, bolt: 0x7ad8ff, aura: null },
};

// Builder card data for every pickable spell: its element, tags, and quick stats (strings, ready to show; '' = n/a).
// Tags: Projectile, Hitscan-like (fast and straight), Lob, Area, Wind-up, Interrupts, Slows, Roots, Stuns, Knockdown,
// Shield, Dash, Teleport, Mobility, Dodge, Summon, Heal, Channel (plus Combo, added by spellInfo when it has a combo partner).
const S_ = (n) => `${n} s`, M_ = (n) => `${n} m`;
export const SPELL_INFO = {
  // primaries (magazine; the last shot of a magazine is the finisher)
  spark:         { element: 'arcane', tags: ['Projectile', 'Hitscan-like', 'Interrupts'], damage: `${D(SPELLS.fast.damage)}`, cooldown: S_(SPELLS.fast.cooldown), range: M_(54), windup: '' },
  fireball:      { element: 'fire',   tags: ['Projectile', 'Interrupts'], damage: `${D(SPELLS.fireball.damage)} / ${D(SPELLS.fireball.finDamage)}`, cooldown: S_(SPELLS.fireball.cooldown), range: M_(Math.round(SPELLS.fireball.speed * SPELLS.fireball.life)), windup: '' },
  gale_shear:    { element: 'wind',   tags: ['Projectile', 'Hitscan-like', 'Interrupts'], damage: `${D(16)}`, cooldown: S_(0.42), range: M_(8), windup: '' },
  glacial_skim:  { element: 'ice',    tags: ['Projectile', 'Slows', 'Interrupts'], damage: `3 × ${D(SPELLS.skim.damage)}`, cooldown: S_(SPELLBOOK.glacial_skim.cooldown), range: M_(22), windup: '' },
  hex_shards:    { element: 'dark',   tags: ['Projectile', 'Interrupts'], damage: `${D(SPELLS.hex.damage)}`, cooldown: S_(SPELLS.hex.cooldown), range: M_(SPELLS.hex.range), windup: '' },
  sling:         { element: 'earth',  tags: ['Projectile', 'Hitscan-like', 'Summon', 'Interrupts'], damage: `${D(SPELLS.sling.near)}–${D(SPELLS.sling.far)} + ram`, cooldown: S_(SPELLS.sling.cooldown), range: M_(32), windup: '' },
  potion_toss:   { element: 'acid',   tags: ['Projectile', 'Lob', 'Area', 'Stuns'], damage: `${D(SPELLS.potion.damage)} / ${D(SPELLS.potion.finDamage)}`, cooldown: S_(SPELLS.potion.cooldown), range: M_(SPELLS.potion.range), windup: '' },
  // powers (RMB)
  meteor:        { element: 'fire',   tags: ['Projectile', 'Wind-up'], damage: `${D(SPELLS.heavy.damage)}`, cooldown: S_(SPELLS.heavy.cooldown), range: M_(Math.round(SPELLS.heavy.speed * SPELLS.heavy.life)), windup: S_(SPELLS.heavy.chargeTime) },
  cyclone:       { element: 'wind',   tags: ['Area', 'Wind-up', 'Stuns'], damage: `${D(28)}`, cooldown: S_(5), range: M_(5.5), windup: S_(0.45) },
  frostfall:     { element: 'ice',    tags: ['Area', 'Roots'], damage: `${D(SPELLBOOK.frostfall.damage)}`, cooldown: S_(SPELLBOOK.frostfall.cooldown), range: M_(SPELLBOOK.frostfall.range), windup: S_(1.75), duration: `freeze ${S_(SPELLBOOK.frostfall.bind)}` },
  sanguine_lash: { element: 'dark',   tags: ['Projectile', 'Wind-up', 'Roots'], damage: `${D(SPELLS.lash.damage)}`, cooldown: S_(SPELLBOOK.sanguine_lash.cooldown), range: M_(22), windup: S_(1.5), duration: 'bind 1.25 s' },
  battering_ram: { element: 'earth',  tags: ['Summon', 'Wind-up', 'Knockdown'], damage: `${D(SPELLBOOK.battering_ram.damage)}`, cooldown: S_(SPELLBOOK.battering_ram.cooldown), range: M_(36), windup: S_(SPELLBOOK.battering_ram.windup) },
  toxic_flask:   { element: 'acid',   tags: ['Lob', 'Area'], damage: `${D(12)} + ${D(12)}/s`, cooldown: S_(8), range: M_(18), windup: '', duration: S_(5) },
  // shields (R)
  ward:          { element: 'arcane', tags: ['Shield'], damage: '', cooldown: 'hold', range: '', windup: '', duration: 'about 3 s' },
  firewall:      { element: 'fire',   tags: ['Shield', 'Area'], damage: `${D(15)} to walk through`, cooldown: S_(10), range: M_(5), windup: '', duration: S_(2.5) },
  tempest_veil:  { element: 'wind',   tags: ['Shield'], damage: '', cooldown: S_(SPELLBOOK.tempest_veil.cooldown), range: '', windup: '', duration: S_(SPELLBOOK.tempest_veil.duration) },
  glacial_bulwark: { element: 'ice',  tags: ['Shield', 'Roots'], damage: '', cooldown: S_(12), range: M_(6), windup: '', duration: S_(5) },
  black_death:   { element: 'dark',   tags: ['Shield', 'Heal'], damage: '', cooldown: 'hold', range: '', windup: '', duration: 'about 3.5 s' },
  ram_guard:     { element: 'earth',  tags: ['Shield', 'Summon', 'Knockdown'], damage: `${D(SPELLBOOK.ram_charge.damage)}`, cooldown: S_(10), range: '', windup: '', duration: S_(3) },
  smoke_flask:   { element: 'acid',   tags: ['Shield', 'Area'], damage: '', cooldown: S_(10), range: M_(2.4), windup: '', duration: S_(2) },
  // mobility (E)
  smoke_screen:  { element: 'fire',   tags: ['Dash', 'Area'], damage: '', cooldown: S_(8), range: M_(6.5), windup: '', duration: 'cloud 5 s' },
  blink:         { element: 'wind',   tags: ['Teleport'], damage: '', cooldown: S_(4), range: M_(9), windup: '' },
  skyward:       { element: 'ice',    tags: ['Dash'], damage: '', cooldown: S_(6), range: M_(7), windup: '', duration: 'float 2.8 s' },
  mirror_step:   { element: 'dark',   tags: ['Dash'], damage: '', cooldown: S_(7), range: M_(7), windup: '', duration: 'decoys 2.5 s' },
  ram_ride:      { element: 'earth',  tags: ['Dash', 'Summon'], damage: `${D(15)}`, cooldown: S_(8), range: M_(20), windup: S_(0.4) },
  flask_step:    { element: 'acid',   tags: ['Teleport', 'Lob', 'Wind-up'], damage: '', cooldown: S_(8), range: M_(16), windup: S_(0.6) },
  // utility (F)
  telekinesis:   { element: 'arcane', tags: ['Knockdown'], damage: `${D(22)}`, cooldown: S_(3), range: M_(16), windup: '' },
  trapped_relic: { element: 'dark',   tags: ['Area', 'Stuns'], damage: `trap ${D(SPELLBOOK.trapped_relic.damage)}`, cooldown: S_(SPELLBOOK.trapped_relic.cooldown), range: M_(16), windup: '', duration: '2 traps' },
  roll:          { element: 'arcane', tags: ['Dash', 'Dodge'], damage: '', cooldown: '3.5 s × 2', range: M_(4.5), windup: '', duration: 'dodge 0.25 s' },
  // ultimates (Q, charged)
  meteor_rain:   { element: 'fire',   tags: ['Area', 'Wind-up'], damage: `kill ${M_(SPELLBOOK.meteor_rain.killRadius)} · ${D(SPELLBOOK.meteor_rain.splash[0])}–${D(SPELLBOOK.meteor_rain.splash[1])}`, cooldown: 'charge', range: M_(24), windup: S_(1.3) },
  eye_of_storm:  { element: 'wind',   tags: ['Area', 'Channel', 'Wind-up'], damage: `${D(8)} / 0.5 s`, cooldown: 'charge', range: M_(7), windup: S_(1.3), duration: S_(3) },
  blizzard:      { element: 'ice',    tags: ['Area', 'Channel', 'Roots', 'Wind-up'], damage: `${D(10)}/s`, cooldown: 'charge', range: M_(14), windup: S_(1.3), duration: S_(2.5) },
  night_cage:    { element: 'dark',   tags: ['Area', 'Heal', 'Wind-up'], damage: '', cooldown: 'charge', range: M_(24), windup: S_(1.3), duration: S_(4) },
  stampede:      { element: 'earth',  tags: ['Area', 'Summon', 'Wind-up'], damage: 'kill', cooldown: 'charge', range: M_(28), windup: S_(1.3) },
  berserker_brew: { element: 'acid',  tags: ['Wind-up'], damage: '×1.5 potions', cooldown: 'charge', range: '', windup: S_(1.3), duration: S_(7) },
};

// Everything pickable, per slot (SPELLBOOK order).
export const SPELL_POOL = Object.fromEntries(LOADOUT_SLOTS.map(slot =>
  [slot, Object.keys(SPELLBOOK).filter(id => SPELLBOOK[id].slot === slot && SPELL_INFO[id])]));

// Cross-spell synergies: each works for whoever has every spell in `spells` equipped (server.js checks `hasCombo`).
export const COMBOS = [
  { id: 'blood_lash', name: 'Blood Lash', spells: ['black_death', 'sanguine_lash'],
    text: 'Damage Black Death absorbs cuts the Lash\'s cooldown and charges its next hit (up to +14).' },
  { id: 'brew_potions', name: 'Hot Brew', spells: ['berserker_brew', 'potion_toss'],
    text: 'Under Berserker Brew, potions and their splash hit 50% harder.' },
  { id: 'brew_pools', name: 'Strong Brew', spells: ['berserker_brew', 'toxic_flask'],
    text: 'Under Berserker Brew, Toxic Flask and its pool hit 50% harder.' },
  { id: 'sky_frost', name: 'Hail from Above', spells: ['skyward', 'frostfall'],
    text: 'Frostfall can be cast mid-air during a Skyward Flash.' },
  { id: 'herd', name: 'Herd Call', spells: ['sling', 'ram_guard'],
    text: 'A Sling hit also sends one of your circling guard rams at the target.' },
];
export const hasCombo = (lo, comboId) => { const c = COMBOS.find(k => k.id === comboId); return !!(c && lo && c.spells.every(id => Object.values(lo).includes(id))); };
export const combosOf = (lo) => COMBOS.filter(c => hasCombo(lo, c.id));          // the combos a loadout has active
export const combosWith = (spellId) => COMBOS.filter(c => c.spells.includes(spellId));   // a card's "Combo" tag

// Card data for spell `id`: SPELLBOOK's name/short/blurb/slot plus SPELL_INFO, its element and colour, and combos.
export function spellInfo(id) {
  const S = SPELLBOOK[id], I = SPELL_INFO[id];
  if (!S || !I) return null;
  const combos = combosWith(id);
  return { id, slot: S.slot, name: S.name, short: S.short, blurb: S.blurb, ...I, duration: I.duration || '',
    color: ELEMENTS[I.element].color, combos, tags: combos.length ? [...I.tags, 'Combo'] : I.tags.slice() };
}

// Presets: the old heroes' kits by name, as one-click starting points (wizards.js `kit`).
export const PRESETS = Object.values(WIZARDS).map(w => ({ id: w.id, name: w.preset, hero: w.name, loadout: { ...w.kit } }));
export const DEFAULT_LOADOUT = { ...WIZARDS[DEFAULT_WIZARD].kit };

// A clean loadout from anything (a message, localStorage): every slot an id from SPELL_POOL[slot], else null.
// Nothing is filled in or guessed: a bogus loadout is rejected as a whole.
export function sanitizeLoadout(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  // round 13: Roll moved from Mobility (E) to Utility (F). An old loadout with it in mobility keeps it in utility if that
  // slot is free, and gets the default mobility spell.
  if (x.mobility === 'roll') {
    x = { ...x, mobility: DEFAULT_LOADOUT.mobility };
    if (!SPELL_POOL.utility.includes(x.utility)) x.utility = 'roll';
  }
  const out = {};
  for (const slot of LOADOUT_SLOTS) {
    const id = x[slot];
    if (typeof id !== 'string' || !SPELL_POOL[slot].includes(id)) return null;
    out[slot] = id;
  }
  return out;
}
export const sameLoadout = (a, b) => !!a && !!b && LOADOUT_SLOTS.every(s => a[s] === b[s]);
// A random full loadout. rnd: () => [0, 1).
export function randomLoadout(rnd = Math.random) {
  return Object.fromEntries(LOADOUT_SLOTS.map(slot => { const l = SPELL_POOL[slot]; return [slot, l[Math.floor(rnd() * l.length)]]; }));
}
// A bot's loadout: half the time an old hero preset, half the time fully random (round 11).
export const botLoadout = (rnd = Math.random) => rnd() < 0.5 ? { ...PRESETS[Math.floor(rnd() * PRESETS.length)].loadout } : randomLoadout(rnd);

// The element mix: [{ element, count }] most first (ties: the primary's, then the power's, ... first), arcane last.
export function loadoutElements(lo) {
  const n = new Map();
  for (const slot of LOADOUT_SLOTS) { const e = SPELL_INFO[lo?.[slot]]?.element; if (e) n.set(e, (n.get(e) || 0) + 1); }
  const order = LOADOUT_SLOTS.map(s => SPELL_INFO[lo?.[s]]?.element);
  return [...n].map(([element, count]) => ({ element, count }))
    .sort((a, b) => (a.element === 'arcane') - (b.element === 'arcane') || b.count - a.count || order.indexOf(a.element) - order.indexOf(b.element));
}
export const dominantElement = (lo) => loadoutElements(lo)[0]?.element || 'arcane';
// Ring, nameplate and UI accent of a loadout: its dominant element's colour.
export const loadoutColor = (lo) => ELEMENTS[dominantElement(lo)].color;
// A primary's projectile glow and finisher accent follow the primary's own element.
export const primaryElement = (lo) => SPELL_INFO[lo?.primary]?.element || 'arcane';
export const loadoutBolt = (lo) => ELEMENTS[primaryElement(lo)].bolt;

// Hurt and death voices: the builder's choice (audio.js has a grunt set for each).
export const VOICES = ['male', 'female'];
export const sanitizeVoice = (v) => VOICES.includes(v) ? v : 'male';
