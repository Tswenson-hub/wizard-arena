// Shared between server and client. Keep this file dependency-free.

export const TICK_RATE = 60;          // server simulation Hz
export const SNAPSHOT_RATE = 20;      // server -> client state broadcast Hz

export const ARENA_RADIUS = 34;       // playable circle radius (m)
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
};

export const TELEPORT = {
  distance: 9,
  cooldown: 4.0,
};

export const PICKUP_RANGE = 2.6;      // grab the nearest prop at point-blank range, wherever you aim
export const THROW_COOLDOWN = 0.6;
export const SPARK_STUN_IMMUNITY = 0.6; // after a spark stun ends, further sparks don't re-stun for this long

// Telekinesis: aim at a prop and lift it from range; it floats beside you until thrown.
export const TK = {
  range: 16,
  aimConeDeg: 12,
  liftTime: 0.35,
  hold: { fwd: 1.25, side: -0.75, up: 1.75 },  // hold point relative to the caster (side < 0 = left)
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

// Does the 2D segment a→b pass through any pillar? (pillars are taller than anything thrown at them)
export function pillarBlocks(a, b, pad = 0) {
  const sx = b[0] - a[0], sz = b[2] - a[2];
  const ll = sx * sx + sz * sz || 1;
  for (const pil of PILLARS) {
    const k = Math.max(0, Math.min(1, ((pil.x - a[0]) * sx + (pil.z - a[2]) * sz) / ll));
    if (Math.hypot(a[0] + sx * k - pil.x, a[2] + sz * k - pil.z) < pil.r + pad) return pil;
  }
  return null;
}
export const PROP_RESPAWN_TIME = 18;

// Prop archetypes. `r` is the collision radius, `h` the height used for the hit sphere.
export const PROP_TYPES = {
  crate:   { r: 0.55, h: 1.1, hp: 1, color: 0xc08a4a },
  barrel:  { r: 0.5,  h: 1.2, hp: 1, color: 0x8a5a3a },
  pumpkin: { r: 0.45, h: 0.8, hp: 1, color: 0xf08a2a },
  rock:    { r: 0.6,  h: 1.0, hp: 1, color: 0x8d9299 },
  pot:     { r: 0.4,  h: 0.9, hp: 1, color: 0x6a8fd0 },
};

// Fixed obstacles in the arena (not pickable). Clients use these for movement collision,
// server uses them for projectile collision.
export const PILLARS = [
  { x: 0, z: 0, r: 1.6, h: 4.5 },
  { x: 14, z: 10, r: 1.1, h: 3.8 },
  { x: -14, z: 10, r: 1.1, h: 3.8 },
  { x: 14, z: -10, r: 1.1, h: 3.8 },
  { x: -14, z: -10, r: 1.1, h: 3.8 },
  { x: 0, z: 22, r: 1.3, h: 5 },
  { x: 0, z: -22, r: 1.3, h: 5 },
  { x: 24, z: 0, r: 1.3, h: 5 },
  { x: -24, z: 0, r: 1.3, h: 5 },
];

export const TREES = [
  { x: 20, z: 20, r: 0.6 }, { x: -21, z: 19, r: 0.6 }, { x: 22, z: -18, r: 0.6 }, { x: -19, z: -22, r: 0.6 },
  { x: 8, z: 27, r: 0.6 }, { x: -9, z: -28, r: 0.6 }, { x: 28, z: 9, r: 0.6 }, { x: -27, z: -7, r: 0.6 },
  { x: 29, z: -12, r: 0.6 }, { x: -30, z: 12, r: 0.6 }, { x: 12, z: -29, r: 0.6 }, { x: -13, z: 29, r: 0.6 },
];

// Initial prop placement: [type, x, z]
export const PROP_SPAWNS = [
  ['crate', 5, 5], ['crate', -5, 5], ['crate', 5, -5], ['crate', -5, -5],
  ['barrel', 9, 0], ['barrel', -9, 0], ['barrel', 0, 9], ['barrel', 0, -9],
  ['pumpkin', 12, 4], ['pumpkin', -12, -4], ['pumpkin', 4, -12], ['pumpkin', -4, 12],
  ['rock', 18, 0], ['rock', -18, 0], ['rock', 0, 16], ['rock', 0, -16],
  ['pot', 10, 14], ['pot', -10, -14], ['pot', 16, -5], ['pot', -16, 5],
  ['crate', 20, -6], ['crate', -20, 6], ['pumpkin', 6, 20], ['pumpkin', -6, -20],
  ['pot', 23, 14], ['pot', -23, -14], ['barrel', 15, -16], ['barrel', -15, 16],
];

export const SPAWN_POINTS = [
  [10, 0, 10], [-10, 0, 10], [10, 0, -10], [-10, 0, -10],
  [0, 0, 15], [0, 0, -15], [15, 0, 0], [-15, 0, 0],
  [20, 0, 12], [-20, 0, -12], [20, 0, -12], [-20, 0, 12],
];

export const PLAYER_COLORS = [
  0xff5c5c, 0x5cb8ff, 0x6ef08a, 0xffd25c, 0xd98cff, 0xff9d5c, 0x5cf0e0, 0xff7ad9,
];

export const MAX_NAME_LEN = 14;

// Where a blink lands. Used by the server (authoritative) and the client (prediction),
// so the two must agree exactly.
export function computeTeleport(from, dir) {
  const l = Math.hypot(dir[0], dir[2]) || 1;
  const dx = dir[0] / l, dz = dir[2] / l;
  let to = [from[0] + dx * TELEPORT.distance, 0, from[2] + dz * TELEPORT.distance];
  const r = Math.hypot(to[0], to[2]);
  if (r > ARENA_RADIUS - 1) { to[0] *= (ARENA_RADIUS - 1) / r; to[2] *= (ARENA_RADIUS - 1) / r; }
  for (const pil of PILLARS) {
    const d = Math.hypot(to[0] - pil.x, to[2] - pil.z);
    if (d < pil.r + PLAYER_RADIUS) {
      const push = (pil.r + PLAYER_RADIUS + 0.1) / (d || 1);
      to = [pil.x + (to[0] - pil.x) * push, 0, pil.z + (to[2] - pil.z) * push];
    }
  }
  return to;
}
