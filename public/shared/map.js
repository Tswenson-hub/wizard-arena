// Map layout, shared by server and client: arena size, obstacles, props, goats and spawn points.
// Owned by the environment track; gameplay code reads it through constants.js (which re-exports it).

export const ARENA_RADIUS = 34;       // playable circle radius (m)

// Prop archetypes. `r` is the collision radius, `h` the height used for the hit sphere.
export const PROP_TYPES = {
  crate:   { r: 0.55, h: 1.1, hp: 1, color: 0xc08a4a },
  barrel:  { r: 0.5,  h: 1.2, hp: 1, color: 0x8a5a3a },
  pumpkin: { r: 0.45, h: 0.8, hp: 1, color: 0xf08a2a },
  rock:    { r: 0.6,  h: 1.0, hp: 1, color: 0x8d9299 },
  pot:     { r: 0.4,  h: 0.9, hp: 1, color: 0x6a8fd0 },
  potion:  { r: 0.5,  h: 1.15, hp: 1, color: 0x9a5cff },   // Meshy potion barrel (models/potion.glb)
};

// Meadow goats. They graze until a spell or thrown object hits one; then it rears up and charges
// whoever hit it. A charge that connects is fatal unless the wizard wards facing the goat.
export const GOAT = {
  count: 4,
  radius: 0.6,          // body radius for collisions and hits
  hitY: 0.7,            // centre of the hit sphere above the ground
  walkSpeed: 1.3,
  windup: 0.7,          // seconds rearing up before the charge
  chargeSpeed: 12.5,
  chargeTime: 3.0,      // longest a charge lasts
  turnRate: 2.0,        // rad/s of homing while charging: you can sidestep late or blink
  dizzyTime: 2.2,       // after hitting a pillar, tree or a ward
  recoverTime: 1.2,     // after a charge runs out
  blockCost: 50,        // stamina a ward spends stopping a goat
  blockKnockback: 7,
};
export const GOAT_SPAWNS = [[9, -18], [-19, -6], [17, 15], [-9, 21]];

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
  ['potion', 7, -7], ['potion', -7, 7], ['potion', 26, -4], ['potion', -26, 4],
];

export const SPAWN_POINTS = [
  [10, 0, 10], [-10, 0, 10], [10, 0, -10], [-10, 0, -10],
  [0, 0, 15], [0, 0, -15], [15, 0, 0], [-15, 0, 0],
  [20, 0, 12], [-20, 0, -12], [20, 0, -12], [-20, 0, 12],
];


// Everything solid, as circles. Movement (players, bots, goats) collides with all of them;
// projectiles pass over anything lower than their height (`h`); line-of-sight checks
// (telekinesis, bot aiming, cover) only count colliders at least LOS_HEIGHT tall.
// Add new obstacles here (a fence is a chain of post circles) and every system picks them up.
export const LOS_HEIGHT = 1.6;
export const COLLIDERS = [
  ...PILLARS.map(p => ({ x: p.x, z: p.z, r: p.r, h: p.h, kind: 'pillar' })),
  ...TREES.map(t => ({ x: t.x, z: t.z, r: t.r, h: 6, kind: 'tree' })),
];
