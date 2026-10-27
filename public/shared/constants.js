// Shared between server and client. Keep this file dependency-free.
// Map layout (arena size, obstacles, props, goats, spawns) lives in map.js and is re-exported here.
import { COLLIDERS, ARENA_RADIUS, LOS_HEIGHT } from './map.js';
export * from './map.js';

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
};

export const TELEPORT = {
  distance: 9,
  cooldown: 4.0,
};

// ---------------------------------------------------------------- spellbook
// Players choose which spell sits in each ability slot. Adding a spell = one entry here plus its
// handler on the server (server.js) and client (main.js). `cooldown` is per slot: swapping spells
// doesn't reset it.
export const LOADOUT_SLOTS = {
  primary:  { key: 'LMB', label: 'Primary' },
  power:    { key: 'RMB', label: 'Power' },
  mobility: { key: 'E',   label: 'Mobility' },
};

export const SPELLBOOK = {
  spark: {
    id: 'spark', slot: 'primary', name: 'Spark',
    blurb: 'Quick bolt. Low damage, briefly stuns.',
    cooldown: SPELLS.fast.cooldown,
  },
  meteor: {
    id: 'meteor', slot: 'power', name: 'Meteor',
    blurb: '1.25 s wind-up, then a heavy fireball. Being hit cancels it.',
    cooldown: SPELLS.heavy.cooldown, windup: SPELLS.heavy.chargeTime,
  },
  cyclone: {
    id: 'cyclone', slot: 'power', name: 'Arcane Cyclone',
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
  blink: {
    id: 'blink', slot: 'mobility', name: 'Blink',
    blurb: 'Teleport 9 m in the direction you face.',
    cooldown: TELEPORT.cooldown,
  },
  skyward: {
    id: 'skyward', slot: 'mobility', name: 'Skyward Flash',
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
};

export const DEFAULT_LOADOUT = { primary: 'spark', power: 'meteor', mobility: 'blink' };

// The spells a slot can hold, in display order.
export const spellsFor = (slot) => Object.values(SPELLBOOK).filter(s => s.slot === slot);

// A valid loadout built from `want`, falling back slot by slot to `base` for unknown ids.
export function sanitizeLoadout(want, base = DEFAULT_LOADOUT) {
  const out = { ...base };
  for (const slot of Object.keys(LOADOUT_SLOTS)) {
    const id = want?.[slot];
    if (typeof id === 'string' && Object.hasOwn(SPELLBOOK, id) && SPELLBOOK[id].slot === slot) out[slot] = id;
  }
  return out;
}

// Damage/stun/knockback/stamina spec for a `hit` kind: a projectile kind or a spellbook id.
export const hitSpec = (kind) => SPELLS[kind] || SPELLBOOK[kind];

// Longest a Skyward Flash can keep a wizard off the ground (float at the slowest rate, then drop).
export const FLIGHT_MAX_TIME = SPELLBOOK.skyward.floatTime + SPELLBOOK.skyward.maxHeight / SPELLBOOK.skyward.dropSpeed + 0.6;

export const PICKUP_RANGE = 2.6;      // grab the nearest prop at point-blank range, wherever you aim
export const THROW_COOLDOWN = 0.6;
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
export function computeTeleport(from, dir) {
  const l = Math.hypot(dir[0], dir[2]) || 1;
  const dx = dir[0] / l, dz = dir[2] / l;
  let to = [from[0] + dx * TELEPORT.distance, 0, from[2] + dz * TELEPORT.distance];
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
