// Map layout, shared by server and client: arena size, obstacles, props, goats and spawn points.
// Owned by the environment track; gameplay code reads it through constants.js (which re-exports it).
//
// The wizard's farmstead. +z is north. Standing in the courtyard facing the farmhouse (north),
// the goat pen is on your left (+x) and the crop field on your right (-x).
//
//                 farmhouse (0, 26)
//      tractor                         walk-through barn (14, 20.5)
//   crop field      courtyard + well      goat pen (gate faces the courtyard)
//   (-x)            (0, 0)                (+x)
//       fallen silo     south meadow, trees

export const ARENA_RADIUS = 40;       // playable circle radius (m)

// Prop archetypes. `r` is the collision radius, `h` the height used for the hit sphere.
export const PROP_TYPES = {
  crate:   { r: 0.55, h: 1.1, hp: 1, color: 0xc08a4a },
  barrel:  { r: 0.5,  h: 1.2, hp: 1, color: 0x8a5a3a },
  pumpkin: { r: 0.45, h: 0.8, hp: 1, color: 0xf08a2a },
  rock:    { r: 0.6,  h: 1.0, hp: 1, color: 0x8d9299 },
  pot:     { r: 0.4,  h: 0.9, hp: 1, color: 0x6a8fd0 },
  potion:  { r: 0.5,  h: 1.15, hp: 1, color: 0x9a5cff },   // Meshy potion barrel (models/potion.glb)
  hay:     { r: 0.55, h: 0.9, hp: 1, color: 0xd9b45a },    // small round hay bale lying on its side
};

// Goats. They graze in the pen until a spell or thrown object hits one; then it rears up, leaps the
// fence and charges whoever hit it. A charge that connects is fatal unless the wizard wards facing
// the goat. Afterwards it trots back into the pen through the gate.
export const GOAT = {
  count: 4,
  radius: 0.6,          // body radius for collisions and hits
  hitY: 0.7,            // centre of the hit sphere above the ground
  walkSpeed: 1.3,
  trotSpeed: 2.6,       // heading home to the pen
  windup: 0.7,          // seconds rearing up before the charge
  chargeSpeed: 12.5,
  chargeTime: 3.0,      // longest a charge lasts
  turnRate: 2.0,        // rad/s of homing while charging: you can sidestep late or blink
  dizzyTime: 2.2,       // after hitting a pillar, tree or a ward
  recoverTime: 1.2,     // after a charge runs out
  blockCost: 50,        // stamina a ward spends stopping a goat
  blockKnockback: 7,
  rammableBelow: 1.0,   // wizards whose feet are higher than this (Skyward Flash) are passed under
  // Telekinesis: a lifted goat is hurled like a prop (SPELLS.prop speed / gravity) but never breaks.
  throwSpeed: 24,       // m/s along the aimed direction
  throwGravity: 6,      // m/s² (aim with ballisticDir(origin, target, throwSpeed, throwGravity))
  stumbleTime: 0.5,     // on its feet after a landing or a drop, before it carries on
};

// ------------------------------------------------------------ farmhouse
// The Meshy farmhouse (models/farmhouse.glb), front door facing the courtyard.
export const FARMHOUSE = { x: 0, z: 26, height: 11, yaw: Math.PI };
// Footprint as circles [dx, dz, r] from the house centre, fitted to the model's walls at this yaw
// (body x -4..5, z 22.5..30.5 in world space, plus the porch on the -x front corner).
const HOUSE_BLOCKS = [
  [3.3, -1.4, 2.2], [0.5, -1.4, 2.2], [-2.3, -1.4, 2.2],
  [3.3, 2.4, 2.2], [0.5, 2.4, 2.2], [-2.3, 2.4, 2.2],
  [-4.1, -2.8, 1.5],
];

// ------------------------------------------------------------ goat pen (west, +x)
// An axis-aligned fenced rectangle. The gate is a gap in the courtyard-facing side (x = x0).
export const PEN = {
  x0: 18, x1: 33, z0: -13, z1: 9,
  gate: { z0: -3.4, z1: -0.6 },
  postR: 0.25, postH: 0.7, postSpacing: 0.62,   // postH: spells fly over; aiming at a goat's body clears it
};
PEN.gateOut = [16.0, (PEN.gate.z0 + PEN.gate.z1) / 2];   // just outside the gate
PEN.gateIn = [19.8, (PEN.gate.z0 + PEN.gate.z1) / 2];    // just inside it
export const inPen = (x, z, margin = 0) =>
  x > PEN.x0 + margin && x < PEN.x1 - margin && z > PEN.z0 + margin && z < PEN.z1 - margin;

// Fence edges as segments [[ax, az], [bx, bz]]; the gate side is split around the opening.
export const FENCE_SEGMENTS = [
  [[PEN.x0, PEN.z0], [PEN.x1, PEN.z0]],
  [[PEN.x1, PEN.z0], [PEN.x1, PEN.z1]],
  [[PEN.x1, PEN.z1], [PEN.x0, PEN.z1]],
  [[PEN.x0, PEN.z1], [PEN.x0, PEN.gate.z1]],
  [[PEN.x0, PEN.gate.z0], [PEN.x0, PEN.z0]],
];
// Posts along every segment, close enough that a 0.45 m wizard can't slip between them.
export const FENCE_POSTS = [];
for (const [a, b] of FENCE_SEGMENTS) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.ceil(len / PEN.postSpacing);
  for (let i = 0; i <= n; i++) {
    const x = a[0] + (b[0] - a[0]) * i / n, z = a[1] + (b[1] - a[1]) * i / n;
    if (!FENCE_POSTS.some(p => Math.hypot(p[0] - x, p[1] - z) < 0.05)) FENCE_POSTS.push([x, z]);
  }
}

// The gate leaf stands swung open outward from its hinge on the north gate post.
export const GATE_LEAF = { hinge: [PEN.x0, PEN.gate.z1], dir: [-0.16, 0.99], len: PEN.gate.z1 - PEN.gate.z0 };
for (let i = 1; i <= 4; i++) {
  const k = GATE_LEAF.len * i / 4;
  FENCE_POSTS.push([GATE_LEAF.hinge[0] + GATE_LEAF.dir[0] * k, GATE_LEAF.hinge[1] + GATE_LEAF.dir[1] * k]);
}

// Distance from (x, z) to the nearest fence (ignores the gate gap). Used for the goats' leap arc.
export function fenceDistance(x, z) {
  let best = Infinity;
  for (const [a, b] of FENCE_SEGMENTS) {
    const sx = b[0] - a[0], sz = b[1] - a[1];
    const k = Math.max(0, Math.min(1, ((x - a[0]) * sx + (z - a[1]) * sz) / (sx * sx + sz * sz)));
    best = Math.min(best, Math.hypot(a[0] + sx * k - x, a[1] + sz * k - z));
  }
  return best;
}

export const GOAT_SPAWNS = [[22.5, -8], [27, -3.5], [24, 3], [29.5, -9.5]];

// Inside the pen: a lean-to shelter against the back fence and a water trough by the gate.
export const SHELTER = { x: 31.2, z: 5.6, yaw: -Math.PI / 2, w: 4.2, d: 2.6 };
export const TROUGH = { x: 20.4, z: 5.2, yaw: 0, len: 2.0 };

// ------------------------------------------------------------ crop field (east, -x)
// Rows run north-south; walkable furrows between them. Each plant is a low collider: it blocks
// walking but spells fly over it.
export const FIELD = { x0: -33, x1: -18.4, z0: -11, z1: 10.5 };
export const CROP_ROWS = [-19, -21.6, -24.2, -26.8, -29.4, -32].map(x => ({ x, z0: -11, z1: 10 }));
export const CROPS = [];
for (const row of CROP_ROWS) {
  for (let z = row.z0; z <= row.z1 + 1e-6; z += 0.9) CROPS.push([row.x, z]);
}
export const SCARECROW = { x: -25.5, z: 11.6, yaw: Math.PI * 0.95 };

// ------------------------------------------------------------ farm machinery and courtyard
// Tractor parked between the field and the courtyard: hard cover.
export const TRACTOR = { x: -14.8, z: 13.2, yaw: 2.35, len: 4.3 };
// Footprint as circles [offset along its heading, r], fitted to the Meshy model: 4.3 m long,
// 2.5 m across the rear wheels, 2.0 m across the front.
const TRACTOR_BLOCKS = [[-1.15, 1.25], [0.3, 1.0], [1.45, 1.0]];
// Chain of points every `spacing` m along a polyline [[x, z], ...] (walls and fences made of circles).
function chain(line, spacing) {
  const out = [];
  for (let s = 1; s < line.length; s++) {
    const [a, b] = [line[s - 1], line[s]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / spacing));
    for (let i = s > 1 ? 1 : 0; i <= n; i++) out.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
  }
  return out;
}
// Model space -> world for a piece placed at {x, z, yaw} (same convention as Object3D.rotation.y).
const place = (o, [lx, lz]) => [o.x + lx * Math.cos(o.yaw) + lz * Math.sin(o.yaw), o.z - lx * Math.sin(o.yaw) + lz * Math.cos(o.yaw)];

// Walk-through barn (models/barn.glb) by the pen's north-west corner. In model space it is long along x:
// a wide arch at -x, a 3 m side doorway in the +z wall (x 0..3) and a closed window wall at +x.
// Turned -90°, the arch opens south onto the courtyard and the side door west toward the house, so the
// way through is an L-shaped corridor, 2.5 m wide, with walls you can't shoot through.
export const BARN = { x: 14, z: 20.5, yaw: -Math.PI / 2, height: 7 };
// Wall lines in model space, from a raycast section of the model at 0.6 and 1.4 m.
const BARN_WALLS = [
  [[-7.6, -2.4], [2.75, -2.4], [2.75, -1.5], [6.6, -1.5], [6.6, 1.15], [3.1, 1.15]],   // south wall, end wall, north wall to the side door
  [[-0.1, 1.1], [-4.3, 1.05], [-5.5, 1.5], [-7.2, 3.2]],                                 // north wall from the side door, then the arch's open door leaf
  [[6.6, 1.15], [6.5, 2.5]],                                                              // the end wall's open door leaf
];
export const BARN_POSTS = BARN_WALLS.flatMap(line => chain(line, 0.6)).map(p => place(BARN, p));

// A grain silo lying on its side in the south-west meadow (models/silo.glb): 11 m of hard cover, 3.6 m tall.
// In model space its body runs along x (-5.75..5.3, domed cap at +x), centred on z -0.25, radius 1.8.
export const SILO = { x: -16, z: -27, yaw: 0.35, height: 4 };
const SILO_BLOCKS = [-4, -2.7, -1.4, -0.1, 1.2, 2.5, 3.6].map(lx => place(SILO, [lx, -0.25]));

export const WELL = { x: 0, z: 2, r: 1.25, h: 2.6 };
export const CART = { x: -4, z: -16, yaw: 0.5 };
// Big round bales standing on end: courtyard cover. [x, z]
export const HAY_STACKS = [[-6, 4], [-6.9, 5.4], [5.6, -5], [6.9, -5.6], [-14, -2], [13, 3.2], [13.6, 4.6]];

// Fixed obstacles in the arena (not pickable). Rune pillars with floating crystals.
export const PILLARS = [
  { x: 10, z: 9.5, r: 1.2, h: 5 },
  { x: -9, z: -11, r: 1.2, h: 5 },
  { x: 9.5, z: -12.5, r: 1.2, h: 5 },
  { x: 0, z: -25, r: 1.3, h: 5 },
];

export const TREES = [
  { x: 22, z: -20, r: 0.6 }, { x: -20, z: -20, r: 0.6 }, { x: -11, z: -33.5, r: 0.6 }, { x: 12, z: -31, r: 0.6 },
  { x: 30, z: -21, r: 0.6 }, { x: -30, z: -19, r: 0.6 }, { x: -13, z: 31, r: 0.6 }, { x: 13, z: 32, r: 0.6 },
  { x: 24, z: 22, r: 0.6 }, { x: -24, z: 23, r: 0.6 }, { x: 0, z: -36, r: 0.6 },
];

// Initial prop placement: [type, x, z]
export const PROP_SPAWNS = [
  // by the house: barrels, crates and the potion barrels
  ['crate', -7.5, 19.5], ['crate', -8.6, 18.4], ['crate', -6.4, 18.0], ['barrel', 7.4, 19.6], ['barrel', 8.6, 18.6],
  ['potion', 5.6, 19.2], ['potion', -4.8, 19.4], ['potion', 9.5, 16.5], ['potion', -10.5, 16.0],
  // pumpkins along the field edge
  ['pumpkin', -16.8, -8], ['pumpkin', -16.8, -3], ['pumpkin', -16.8, 2], ['pumpkin', -16.8, 7], ['pumpkin', -20.3, 11.5],
  // loose hay by the pen and the stacks
  ['hay', 15.8, 6.5], ['hay', 15.6, -7.5], ['hay', -4.4, 6.2], ['hay', 4.2, -7.0],
  // courtyard: pots around the well, a few crates and barrels
  ['pot', 2.4, 0], ['pot', -2.4, 0.8], ['pot', 1, 4.6], ['crate', 3, -12], ['barrel', -3, 11], ['barrel', 3.5, 12],
  // south meadow: rocks and a crate or two
  ['rock', 15, -18], ['rock', -15, -16], ['rock', 6, -29], ['rock', -7, -27], ['crate', 20, -26], ['crate', -24, -21.5],
  ['barrel', -0.5, -14], ['pumpkin', -6, -18.5],
];

// Nobody spawns in the pen, the field or the house.
export const SPAWN_POINTS = [
  [0, 0, -6], [6, 0, -19], [-6, 0, -20], [14, 0, -22], [-14, 0, -22], [0, 0, -32],
  [8, 0, 4], [-9, 0, 8], [-12, 0, -8], [13, 0, -6], [4, 0, 14], [-5, 0, 14.5],
];


// Everything solid, as circles. Movement (players, bots, goats) collides with all of them;
// projectiles pass over anything lower than their height (`h`); line-of-sight checks
// (telekinesis, bot aiming, cover) only count colliders at least LOS_HEIGHT tall.
// Add new obstacles here (a fence is a chain of post circles) and every system picks them up.
export const LOS_HEIGHT = 1.6;
const along = (o, len, n, r, h, kind) => Array.from({ length: n }, (_, i) => {
  const k = n === 1 ? 0 : (i / (n - 1) - 0.5) * len;
  return { x: o.x + Math.sin(o.yaw) * k, z: o.z + Math.cos(o.yaw) * k, r, h, kind };
});
export const COLLIDERS = [
  ...PILLARS.map(p => ({ x: p.x, z: p.z, r: p.r, h: p.h, kind: 'pillar' })),
  ...TREES.map(t => ({ x: t.x, z: t.z, r: t.r, h: 6, kind: 'tree' })),
  ...HOUSE_BLOCKS.map(([dx, dz, r]) => ({ x: FARMHOUSE.x + dx, z: FARMHOUSE.z + dz, r, h: 9, kind: 'house' })),
  ...FENCE_POSTS.map(([x, z]) => ({ x, z, r: PEN.postR, h: PEN.postH, kind: 'fence' })),
  ...along({ ...SHELTER, yaw: SHELTER.yaw + Math.PI / 2 }, SHELTER.w - 1.6, 2, 1.25, 2.4, 'shelter'),   // spread along its width
  ...along(TROUGH, TROUGH.len - 0.9, 2, 0.5, 0.75, 'trough'),
  ...CROPS.map(([x, z]) => ({ x, z, r: 0.5, h: 0.9, kind: 'crop' })),
  { x: SCARECROW.x, z: SCARECROW.z, r: 0.35, h: 2.4, kind: 'scarecrow' },
  ...TRACTOR_BLOCKS.map(([k, r]) => ({ x: TRACTOR.x + Math.sin(TRACTOR.yaw) * k, z: TRACTOR.z + Math.cos(TRACTOR.yaw) * k, r, h: 3.0, kind: 'tractor' })),
  { x: WELL.x, z: WELL.z, r: WELL.r, h: WELL.h, kind: 'well' },
  ...along(CART, 1.0, 2, 0.8, 1.7, 'cart'),
  ...HAY_STACKS.map(([x, z]) => ({ x, z, r: 0.85, h: 1.7, kind: 'hay' })),
  ...BARN_POSTS.map(([x, z]) => ({ x, z, r: 0.45, h: 4, kind: 'barn' })),
  ...SILO_BLOCKS.map(([x, z]) => ({ x, z, r: 1.8, h: 3.6, kind: 'silo' })),
];

// Big solid pieces the goats walk around on their way home (world-space boxes around their colliders).
const boxOf = (kind) => {
  const cs = COLLIDERS.filter(c => c.kind === kind);
  return { x0: Math.min(...cs.map(c => c.x - c.r)), x1: Math.max(...cs.map(c => c.x + c.r)),
           z0: Math.min(...cs.map(c => c.z - c.r)), z1: Math.max(...cs.map(c => c.z + c.r)) };
};
export const GOAT_DETOURS = [boxOf('barn'), boxOf('silo')];
