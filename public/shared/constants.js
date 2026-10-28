// Shared between server and client. Keep this file dependency-free.
// Map layout (arena size, obstacles, props, goats, spawns) lives in map.js and is re-exported here.
import { COLLIDERS, ARENA_RADIUS, LOS_HEIGHT } from './map.js';
import { WIZARDS, DEFAULT_WIZARD } from './wizards.js';
export * from './map.js';
export * from './wizards.js';

export const TICK_RATE = 60;          // server simulation Hz
export const SNAPSHOT_RATE = 20;      // server -> client state broadcast Hz

export const PLAYER_HEIGHT = 1.8;
export const PLAYER_RADIUS = 0.45;
export const HIT_CENTER_Y = 0.95;     // centre of the hit-sphere above feet
export const HIT_RADIUS = 0.75;

export const MOVE_SPEED = 6.2;        // m/s run speed
export const CHARGE_MOVE_SPEED = 2.0; // m/s while winding up the heavy spell
export const BLOCK_MOVE_SPEED = 2.6;  // m/s while blocking

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
    damage: 38,
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
};

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
    blurb: 'Hold to aim a circle, release: 1.75 s later a block of ice crushes it. 50 damage and freezes 1.5 s. Wards don\'t help.',
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
  blink: {
    id: 'blink', slot: 'mobility', name: 'Blink', short: 'Blink',
    blurb: 'Teleport 9 m in the direction you face.',
    cooldown: TELEPORT.cooldown,
  },
  skyward: {
    id: 'skyward', slot: 'mobility', name: 'Skyward Flash', short: 'Skyward',
    blurb: 'Flash 7 m straight up and float down. Hold E to hover, Space to drop.',
    height: 7,           // launch height (m)
    maxHeight: 8,        // the server never accepts a wizard higher than this
    floatTime: 2.8,      // after this the wizard drops
    fallSpeed: 2.5,      // m/s default descent
    slowFallSpeed: 1.2,  // m/s holding E
    dropSpeed: 6,        // m/s after Space or once floatTime runs out
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
    id: 'ward', slot: 'guard', name: 'Ward', short: 'Ward',
    blurb: 'Hold to block spells from the front. Drains stamina.',
    cooldown: 0,
  },
  tempest_veil: {
    id: 'tempest_veil', slot: 'guard', name: 'Tempest Veil', short: 'Veil',
    blurb: 'Tap: a wind bubble wraps you for 3 s and swallows every spell, from any side. Move and cast freely.',
    duration: 3,
    cooldown: 10,        // from activation; it can't be refreshed while up
  },
  glacial_bulwark: {
    id: 'glacial_bulwark', slot: 'guard', name: 'Glacial Bulwark', short: 'Bulwark',
    blurb: 'Tap to raise an ice wall ahead that blocks everything. 10 s or 120 damage.',
    dist: 2.5, width: 2.7, height: 2.7,
    circles: 5, r: 0.35,  // collider chain
    life: 10, hp: 120,
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
};

// Spark colour per wizard (a hot near-white core, this glow): brighter than the UI colours so it reads as fire.
export const BOLT_COLORS = { cinder: 0xff5a1e, gale: 0xb070ff, vesper: 0xff1f3d, rime: 0x7ad8ff };
export const boltColor = (wizard) => BOLT_COLORS[wizard] ?? 0x7ad8ff;

// Primary fire is a magazine: `magazine` shots (a Skim volley counts as one), then `reload` seconds.
// Pressing R, or `idleReload` seconds without firing, reloads a partial magazine. Only the last shot
// of a magazine (the "finisher") stuns and interrupts wind-ups; the others just do their damage.
export const primaryMag = (id) => SPELLBOOK[id] || SPELLBOOK.spark;

// Run speed of wizard `id` (wizards.js `speed`); wind-up and ward speeds scale with it.
export const speedOf = (id) => WIZARDS[id]?.speed ?? MOVE_SPEED;
export const chargeSpeedOf = (id) => speedOf(id) * CHARGE_MOVE_SPEED / MOVE_SPEED;
export const blockSpeedOf = (id) => speedOf(id) * BLOCK_MOVE_SPEED / MOVE_SPEED;

// Backpedalling is slower: moving against the facing direction is capped at BACKPEDAL_SPEED, easing back to
// full speed as the direction turns sideways (strafing is full speed). (dx, dz) is the movement direction.
export const BACKPEDAL_SPEED = 3;
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
