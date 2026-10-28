// Map layout, shared by server and client: arena size, obstacles, props, goats and spawn points.
// Owned by the environment track; gameplay code reads it through constants.js (which re-exports it).
//
// The wizard's farmstead. +z is north. Standing in the farmyard facing the farmhouse (north),
// the goat pen is on your left (+x) and the crop field on your right (-x).
// In the middle of the map a stone altar marks where a spell went off: a scorched crater with the rune
// pillars, the archway, the obelisk, stones and the grain silo thrown outward from it.
//
//                 farmhouse (0, 26)
//      tractor, cart       farmyard + well       walk-through barn (14, 20.5)
//   crop field         altar + blast site (0, -7)          goat pen (gate faces the yard)
//   (-x)                                                    (+x)
//       felled silo       archway, south meadow       hay stacks
//                 obelisk
// Team modes: Ember spawns in the farmyard (north), Frost in the south meadow.

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

// ------------------------------------------------------------ the altar and the blast site
// A stone altar between the farmyard and the meadow, where a spell went off. Everything mystical on
// the map was thrown outward from it: a broken circle of floating rune pillars leaning away, two pillars
// knocked flat, the archway that framed the way south, stones tilted away from the centre, flat slabs
// flung farther out, and the obelisk thrown into the meadow. The grain silo that stood at the edge of the
// crater lies where the blast laid it down.
export const ALTAR = { x: 0, z: -7, r: 1.3, h: 1.1 };   // the slab: spells fly over it, you can't walk through it
// [x, z] at compass bearing `deg` (0 = north +z, 90 = east +x) and distance `d` from the altar.
export const fromAltar = (deg, d) => [ALTAR.x + Math.sin(deg * Math.PI / 180) * d, ALTAR.z + Math.cos(deg * Math.PI / 180) * d];
// Object3D yaw that turns a model's +z away from the altar.
export const awayYaw = (x, z) => Math.atan2(x - ALTAR.x, z - ALTAR.z);
// Radius of the scorched ground, for the client decal.
export const BLAST_RADIUS = 15;

// A grain silo knocked flat by the blast (models/silo.glb): 11 m of hard cover, 3.6 m tall, base toward the altar.
// In model space its body runs along x (-5.75..5.3, domed cap at +x), centred on z -0.25, radius 1.8.
const SILO_AT = fromAltar(225, 21.5);
export const SILO = { x: SILO_AT[0], z: SILO_AT[1], yaw: 3 * Math.PI / 4, height: 4 };
const SILO_BLOCKS = [-4, -2.7, -1.4, -0.1, 1.2, 2.5, 3.6].map(lx => place(SILO, [lx, -0.25]));
// Where it stood: a cracked stone footing just past its base.
export const SILO_FOOTING = (() => { const [x, z] = place(SILO, [-7.4, -0.25]); return { x, z, r: 1.9 }; })();

// Floating rune pillars (models/rune_pillar.glb, 6 m) with a purple crystal above: what is left of the
// circle round the altar, each leaning away from it. `r` is fitted to the rubble at the foot, `h` to where
// the stone stops blocking. They stand on the diagonals, so the north-south and east-west lanes stay open.
export const PILLAR_HEIGHT = 6;
export const PILLARS = [45, 135, 225, 315].map(deg => {
  const [x, z] = fromAltar(deg, 7.5);
  return { x, z, r: 0.9, h: 5, yaw: awayYaw(x, z), tilt: 0.11 };
});
// Two pillars of the circle lie where they fell: a broken stump and the shaft beside it, pointing away from
// the altar. Low enough to shoot over. [bearing, distance of the stump, length of the shaft]
export const FALLEN_PILLARS = [[100, 8.5, 5.4], [255, 8.5, 5.4]].map(([deg, d, len]) => {
  const [x, z] = fromAltar(deg, d);
  return { x, z, yaw: awayYaw(x, z), len };
});

// Mystical archway (models/archway.glb, 7.5 m) south of the altar, over the path into the meadow: you walk
// and shoot through it; only its two legs are solid. It faces away from the altar and leans a little.
// Model space at 6.5 m: legs at x -1.85 and 1.6, 1.8 m deep.
export const ARCHWAY = { x: -0.14, z: ALTAR.z - 10, yaw: Math.PI, height: 7.5, tilt: 0.06 };
const ARCH_LEGS = [[-1.85, -0.35], [-1.85, 0.35], [1.6, -0.35], [1.6, 0.35]].map(([lx, lz]) => place(ARCHWAY, [lx * 7.5 / 6.5, lz * 7.5 / 6.5]));
// The obelisk (models/obelisk.glb, 6 m), thrown farthest: it stuck in the meadow, leaning hard away from the
// altar, at the end of the furrow it ploughed.
const OBELISK_AT = fromAltar(200, 23);
export const OBELISK = { x: OBELISK_AT[0], z: OBELISK_AT[1], yaw: awayYaw(...OBELISK_AT), height: 6, r: 0.9, tilt: 0.3, sink: 0.35 };
export const OBELISK_FURROW = { from: fromAltar(200, 14.5), to: fromAltar(200, 22) };

// Blast stones (models/rock_jagged.glb): tall shards tilted away from the altar. [x, z, height, tilt]
// The model is about 0.65 x its height across, so the collider is r 0.33 h, shifted toward the lean.
export const BLAST_STONES = [
  [15, 11.5, 1.9, 0.3], [340, 12, 1.6, 0.35], [80, 12.5, 1.7, 0.3], [125, 13.5, 2.0, 0.3],
  [160, 14, 2.2, 0.28], [205, 14, 1.8, 0.32], [290, 12.5, 2.0, 0.3],
].map(([deg, d, h, tilt]) => [...fromAltar(deg, d), h, tilt]);
// Flat slabs (models/rock_table.glb) flung farther: low cover you shoot over. [x, z, yaw, height, tilt]
// Model space at 1.2 m tall: a round slab about 2.5 m across, centred on x -0.25.
export const TABLE_ROCKS = [[20, 14.5, 0.9, 0.15], [140, 16, 1.1, 0.18], [192, 17.5, 1.1, 0.15], [275, 15, 0.9, 0.2]]
  .map(([deg, d, h, tilt], i) => { const [x, z] = fromAltar(deg, d); return [x, z, (i * 2.1) % 6.3, h, tilt]; });

// ------------------------------------------------------------ farmyard pieces
export const WELL = { x: -4.5, z: 12.5, r: 1.25, h: 2.6 };
// Horse-drawn cart (models/horse_cart.glb, 2.6 m tall) parked by the house, shafts toward the yard.
// Model space: the bed is x -0.75..3.75 (wheels at z ±1.5), the shafts run off toward -x.
export const CART = { x: -9, z: 18, yaw: Math.PI, height: 2.6 };
const CART_BLOCKS = [0.4, 1.6, 2.8].map(lx => place(CART, [lx, 0]));
// Big round bales standing on end. [x, z] Three against the pen's yard-side fence, two drying in the
// south-east meadow.
export const HAY_STACKS = [[16.85, 4.0], [16.85, 5.7], [16.85, 7.4], [16.2, -23.2], [17.9, -23.2]];

// Meshy trees (models/pine|oak|birch.glb): oaks and birches round the farm and meadow, pines toward the
// hills. Trunk circles [dx, dz, r] in model space at the reference height, measured from a section at 1.5 m.
export const TREE_KINDS = {
  pine:  { h: 9,   trunk: [0.1, 0, 0.25] },
  oak:   { h: 7.5, trunk: [-0.25, 0.1, 1.0] },
  birch: { h: 8,   trunk: [0, -0.2, 0.25] },
};
// [kind, x, z, height]; yaw is fixed per tree (server and clients must agree on the trunk offsets).
export const TREES = [
  ['oak', 23, -18, 7], ['birch', -22, -17, 8.5], ['birch', -11, -35, 7.5], ['oak', 12, -32, 7.5],
  ['birch', 30, -21, 8], ['oak', -30, -19, 7.5], ['oak', -13, 31, 8], ['pine', 13, 32, 10],
  ['birch', 24, 22, 8.5], ['pine', -24, 23, 10.5], ['pine', -33, 8, 11], ['pine', 33.5, 14, 10],
].map(([kind, x, z, h], i) => {
  const k = TREE_KINDS[kind], s = h / k.h, yaw = (i * 2.39996) % (Math.PI * 2);
  const [cx, cz] = place({ x, z, yaw }, [k.trunk[0] * s, k.trunk[1] * s]);
  return { kind, x, z, h, yaw, cx, cz, r: Math.max(0.35, k.trunk[2] * s) };
});

// Initial prop placement: [type, x, z]. Every prop belongs somewhere; the relic's types (crate, barrel,
// pot, hay, potion) are split evenly between the north (Ember) and south (Frost) halves.
const SILO_ROW = [-3.2, -2.1, -1.0, 0.3, 1.4, 2.5].map(lx => place(SILO, [lx, -2.8]));   // along its south-east flank
export const PROP_SPAWNS = [
  // north: potion barrels flanking the farmhouse door, crates beside the cart, barrels by the barn,
  // a pot by the well, loose bales by the pen's hay stacks
  ['potion', -2.6, 20.6], ['potion', -3.7, 20.6], ['potion', 2.6, 20.6], ['potion', 3.7, 20.6],
  ['crate', -10.0, 19.8], ['crate', -11.2, 19.8],
  ['barrel', 10.4, 17.3], ['barrel', 10.4, 18.4],
  ['pot', -2.4, 12.2],
  ['hay', 15.6, 4.85], ['hay', 15.6, 6.55],
  // pumpkins along the field edge
  ['pumpkin', -16.8, -8], ['pumpkin', -16.8, -3], ['pumpkin', -16.8, 2], ['pumpkin', -16.8, 7],
  // the blast site: offering pots on the rim of the altar's dais, loose stones among the debris
  ['pot', ...fromAltar(220, 3.3)], ['pot', ...fromAltar(140, 3.3)],
  ['rock', ...fromAltar(30, 9.5)], ['rock', ...fromAltar(150, 10)], ['rock', ...fromAltar(215, 10)], ['rock', ...fromAltar(300, 9.5)],
  // south: the grain store lined up beside the felled silo, bales by the meadow hay stacks
  ['crate', ...SILO_ROW[0]], ['crate', ...SILO_ROW[1]], ['crate', ...SILO_ROW[2]], ['barrel', ...SILO_ROW[3]], ['barrel', ...SILO_ROW[4]], ['barrel', ...SILO_ROW[5]],
  ['hay', 15.6, -25.0], ['hay', 16.7, -25.0], ['hay', 17.8, -25.0], ['hay', 18.9, -25.0],
];

// Team modes: Ember spawns in the farmyard (north), Frost in the south meadow, about equally far from the altar.
export const TEAM_SPAWNS = {
  ember: [[4.5, 0, 10.5], [-8.5, 0, 8], [3, 0, 16.5], [-4, 0, 17], [8.5, 0, 14]],
  frost: [[5.5, 0, -26.5], [-3, 0, -30], [11, 0, -26], [-11, 0, -28], [0.5, 0, -31]],
};
// Free for all: both sides plus the flanks between the blast site and the field or the pen.
// Nobody spawns in the pen, the field or the house.
export const SPAWN_POINTS = [...TEAM_SPAWNS.ember, ...TEAM_SPAWNS.frost, [-13.5, 0, 1.5], [12.5, 0, 1.5]];


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
  ...TREES.map(t => ({ x: t.cx, z: t.cz, r: t.r, h: 6, kind: 'tree' })),
  ...HOUSE_BLOCKS.map(([dx, dz, r]) => ({ x: FARMHOUSE.x + dx, z: FARMHOUSE.z + dz, r, h: 9, kind: 'house' })),
  ...FENCE_POSTS.map(([x, z]) => ({ x, z, r: PEN.postR, h: PEN.postH, kind: 'fence' })),
  ...along({ ...SHELTER, yaw: SHELTER.yaw + Math.PI / 2 }, SHELTER.w - 1.6, 2, 1.25, 2.4, 'shelter'),   // spread along its width
  ...along(TROUGH, TROUGH.len - 0.9, 2, 0.5, 0.75, 'trough'),
  ...CROPS.map(([x, z]) => ({ x, z, r: 0.5, h: 0.9, kind: 'crop' })),
  { x: SCARECROW.x, z: SCARECROW.z, r: 0.35, h: 2.4, kind: 'scarecrow' },
  ...TRACTOR_BLOCKS.map(([k, r]) => ({ x: TRACTOR.x + Math.sin(TRACTOR.yaw) * k, z: TRACTOR.z + Math.cos(TRACTOR.yaw) * k, r, h: 3.0, kind: 'tractor' })),
  { x: WELL.x, z: WELL.z, r: WELL.r, h: WELL.h, kind: 'well' },
  ...CART_BLOCKS.map(([x, z]) => ({ x, z, r: 1.2, h: 2.0, kind: 'cart' })),
  ...ARCH_LEGS.map(([x, z]) => ({ x, z, r: 0.75, h: 7, kind: 'arch' })),
  // the obelisk leans away from the altar: the stone over its foot, then higher up, farther out
  ...[[0, 0.9, 2.2], [1.0, 0.7, 4.2], [1.6, 0.5, 5.4]].map(([k, r, h]) => ({ x: OBELISK.x + Math.sin(OBELISK.yaw) * k, z: OBELISK.z + Math.cos(OBELISK.yaw) * k, r, h, kind: 'obelisk' })),
  ...TABLE_ROCKS.map(([x, z, yaw, h]) => { const [cx, cz] = place({ x, z, yaw }, [-0.25 * h / 1.2, 0]); return { x: cx, z: cz, r: 1.25 * h / 1.2, h, kind: 'rock' }; }),
  ...BLAST_STONES.map(([x, z, h, tilt]) => { const k = Math.sin(tilt) * h * 0.35, a = awayYaw(x, z); return { x: x + Math.sin(a) * k, z: z + Math.cos(a) * k, r: 0.33 * h + 0.05, h: h * Math.cos(tilt), kind: 'stone' }; }),
  { x: ALTAR.x, z: ALTAR.z, r: ALTAR.r, h: ALTAR.h, kind: 'altar' },
  // fallen pillars: the stump, then the shaft lying beside it
  ...FALLEN_PILLARS.flatMap(f => [{ x: f.x, z: f.z, r: 0.8, h: 1.2, kind: 'ruin' },
    ...Array.from({ length: Math.ceil(f.len / 0.9) }, (_, i) => { const k = 1.2 + i * 0.9; return { x: f.x + Math.sin(f.yaw) * k, z: f.z + Math.cos(f.yaw) * k, r: 0.55, h: 1.0, kind: 'ruin' }; })]),
  ...HAY_STACKS.map(([x, z]) => ({ x, z, r: 0.85, h: 1.7, kind: 'hay' })),
  ...BARN_POSTS.map(([x, z]) => ({ x, z, r: 0.45, h: 4, kind: 'barn' })),
  ...SILO_BLOCKS.map(([x, z]) => ({ x, z, r: 1.8, h: 3.6, kind: 'silo' })),
];

// Knee-high shards thrown out between the bigger pieces, thinning with distance (models/rock_jagged.glb).
// Seeded, so server and clients agree. [x, z, yaw, height, tilt]; they block walking, spells fly over.
export const BLAST_SHARDS = [];
{
  let seed = 23;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const yard = (x, z) => (x / 13) ** 2 + ((z - 13) / 9) ** 2 < 1;
  for (let n = 0, tries = 0; n < 26 && tries < 2000; tries++) {
    const deg = rnd() * 360, d = 6 + Math.pow(rnd(), 0.9) * 12, [x, z] = fromAltar(deg, d);
    const h = 0.45 + rnd() * 0.25 * (1.4 - d / 18), yaw = rnd() * 6.3, tilt = 0.35 + rnd() * 0.35;
    if (Math.hypot(x, z) > ARENA_RADIUS - 3 || yard(x, z) || inPen(x, z, -2.5) || (x < FIELD.x1 + 2 && z > FIELD.z0 - 2)) continue;
    if (Math.abs(x) < 2.2 && Math.abs(z - ALTAR.z) > 3.6) continue;                  // the path south
    if (Math.hypot(x - ALTAR.x, z - ALTAR.z) < 5.2) continue;                           // the dais and its flagstones
    if (COLLIDERS.some(c => Math.hypot(c.x - x, c.z - z) < c.r + 1.4)) continue;       // no snags between pieces
    if (BLAST_SHARDS.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 1.8)) continue;
    if (PROP_SPAWNS.some(([, px, pz]) => Math.hypot(px - x, pz - z) < 1.5)) continue;
    if ([...TEAM_SPAWNS.ember, ...TEAM_SPAWNS.frost, ...SPAWN_POINTS].some(([sx, , sz]) => Math.hypot(sx - x, sz - z) < 2)) continue;
    BLAST_SHARDS.push([x, z, yaw, h, tilt]);
    n++;
  }
  for (const [x, z, , h] of BLAST_SHARDS) COLLIDERS.push({ x, z, r: 0.25 * h + 0.05, h: h * 0.8, kind: 'stone' });
}

// Big solid pieces the goats walk around on their way home (world-space boxes around their colliders).
const boxOf = (kind, near = null) => {
  const cs = COLLIDERS.filter(c => c.kind === kind && (!near || Math.hypot(c.x - near.x, c.z - near.z) < near.len + 1.5));
  return { x0: Math.min(...cs.map(c => c.x - c.r)), x1: Math.max(...cs.map(c => c.x + c.r)),
           z0: Math.min(...cs.map(c => c.z - c.r)), z1: Math.max(...cs.map(c => c.z + c.r)) };
};
// The hay stacks against the pen's yard-side fence count as one box, with the loose bales beside them.
const PEN_HAY = (() => {
  const cs = [...COLLIDERS.filter(c => c.kind === 'hay' && c.x > PEN.x0 - 2 && c.z > PEN.z0),
    ...PROP_SPAWNS.filter(([t, x, z]) => t === 'hay' && x > PEN.x0 - 3 && z > PEN.z0).map(([, x, z]) => ({ x, z, r: PROP_TYPES.hay.r }))];
  return { x0: Math.min(...cs.map(c => c.x - c.r)), x1: PEN.x0, z0: Math.min(...cs.map(c => c.z - c.r)), z1: Math.max(...cs.map(c => c.z + c.r)) };
})();
// Each fallen pillar is a low wall a goat can't step round, so it gets a box too.
export const GOAT_DETOURS = [boxOf('barn'), boxOf('silo'), PEN_HAY, ...FALLEN_PILLARS.map(f => boxOf('ruin', f))];
