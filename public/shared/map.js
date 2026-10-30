// Map layout, shared by server and client: arena size, obstacles, props, goats and spawn points.
// Owned by the environment track; gameplay code reads it through constants.js (which re-exports it).
//
// The wizard's farmstead. +z is north. Standing in the farmyard facing the farmhouse (north),
// the goat pen is on your left (+x) and the old crop field (now meadow) on your right (-x).
// In the middle of the map a stone altar marks where a spell went off: a scorched crater with the rune
// pillars, the archway, the obelisk, stones and the grain silo thrown outward from it.
//
//                 farmhouse (0, 26)
//      tractor, cart       farmyard + well       walk-through barn (14, 20.5), hay loft, leaning silo
//   cart road          altar + blast site (0, -7)          goat pen (gate faces the yard), pen rock
//   (-x)   ruin ledges                                     (+x)
//  watchtower   felled silo   archway, south meadow   canopy fort   low plateau
//                 obelisk
// One mode (round 11): a four-player free for all; eight spawns round the rim (SPAWN_POINTS).

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
  // Jeb's summoned rams (goats.js summonRam): a 1.15x golden goat that never pens and vanishes once spent.
  ramScale: 1.15,
  orbitRadius: 2.2,     // Ram Guard: distance from Jeb
  orbitLap: 1.5,        // seconds per full lap
  orbitTime: 3.0,       // an orbiting ram that nobody shoots leaves after this
  ramLife: 9,           // hard timeout for any summoned ram (a mount without a dismount, a stuck charge)
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
// Round 10: a third of its old area (it was x 18..33, z -13..9); the freed ground is cover and high ground.
export const PEN = {
  x0: 18, x1: 28, z0: -8, z1: 3,
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

export const GOAT_SPAWNS = [[21.5, -5.5], [24, -1], [22.5, 1], [24.5, -6]];

// Inside the pen: a lean-to shelter against the back fence and a water trough by the gate.
export const SHELTER = { x: 26.6, z: -4.6, yaw: -Math.PI / 2, w: 4.2, d: 2.6 };
export const TROUGH = { x: 20.4, z: 1.0, yaw: Math.PI / 2, len: 2.0 };

// ------------------------------------------------------------ crop field (east, -x)
// Rows run north-south; walkable furrows between them. Each plant is a low collider: it blocks
// walking but spells fly over it.
export const FIELD = { x0: -33, x1: -18.4, z0: -11, z1: 10.5 };
// Round 10 took the crops out; round 11 took the annex that replaced them out too. FIELD stays as the old field's outline
// (meadow now: the scarecrow and the pumpkins along its edge remain).
export const CROP_ROWS = [];
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
// A pillar of the circle lies where it fell: a broken stump and the shaft beside it, pointing away from the
// altar (another fell across the west ruin ledges; see the high ground). Low enough to shoot over. [bearing, distance of the stump, length of the shaft]
export const FALLEN_PILLARS = [[100, 8.5, 5.4]].map(([deg, d, len]) => {
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
  [15, 11.5, 1.9, 0.3], [340, 12, 1.6, 0.35], [112, 16, 1.7, 0.3],   // (125° went in round 10: the canopy fort's west oak)   // 112°: the south-east edge of the Barn Passage zone
  [160, 14, 2.2, 0.28], [205, 14, 1.8, 0.32],   // (290° went in round 9: the west ruin ledge stands there)
].map(([deg, d, h, tilt]) => [...fromAltar(deg, d), h, tilt]);
// Flat slabs (models/rock_table.glb) flung farther: low cover you shoot over. [x, z, yaw, height, tilt]
// Model space at 1.2 m tall: a round slab about 2.5 m across, centred on x -0.25.
export const TABLE_ROCKS = [[20, 14.5, 0.9, 0.15], [140, 16, 1.1, 0.18], [192, 17.5, 1.1, 0.15], [275, 15, 0.9, 0.2]]
  .map(([deg, d, h, tilt], i) => { const [x, z] = fromAltar(deg, d); return [x, z, (i * 2.1) % 6.3, h, tilt]; });

// ------------------------------------------------------------ farmyard pieces
// The Meshy well (models/well.glb, 3.4 m): the stone ring is r 0.3 of its height; `h` reaches the roof, so the
// camera boom pulls in instead of ending up under it.
export const WELL = { x: -4.5, z: 12.5, r: 1.05, h: 3.4, height: 3.4, yaw: 0 };
// Horse-drawn cart (models/horse_cart.glb, 2.6 m tall) parked by the house, shafts toward the yard.
// Model space: the bed is x -0.75..3.75 (wheels at z ±1.5), the shafts run off toward -x.
export const CART = { x: -9, z: 18, yaw: Math.PI, height: 2.6 };
const CART_BLOCKS = [0.4, 1.6, 2.8].map(lx => place(CART, [lx, 0]));
// Big round bales standing on end. [x, z] Three against the pen's yard-side fence, two drying in the
// south-east meadow.
export const HAY_STACKS = [[16.85, 4.0], [16.85, 5.7], [16.85, 7.4], [16.2, -26.5], [17.9, -26.5]];

// Meshy trees (models/pine|oak|birch.glb): oaks and birches round the farm and meadow, pines toward the
// hills. Trunk circles [dx, dz, r] in model space at the reference height, measured from a section at 1.5 m.
export const TREE_KINDS = {
  pine:  { h: 9,   trunk: [0.1, 0, 0.25] },
  oak:   { h: 7.5, trunk: [-0.25, 0.1, 1.0] },
  birch: { h: 8,   trunk: [0, -0.2, 0.25] },
};
// [kind, x, z, height]; yaw is fixed per tree (server and clients must agree on the trunk offsets).
// The canopy fort's three big oaks (round 10), round its centre deck south-east of the altar.
export const FORT = { x: 15, z: -16, r: 5.5, oakH: 13, deck: 3.9, centre: 4.2, bearings: [60, 180, 300] };
export const FORT_OAKS = FORT.bearings.map(b => [FORT.x + Math.sin(b * Math.PI / 180) * FORT.r, FORT.z + Math.cos(b * Math.PI / 180) * FORT.r]);
export const TREES = [
  ['oak', 24.5, -11.5, 7], ['birch', -17.5, -34.5, 8.5], ['birch', -11, -35, 7.5], ['oak', 12, -32, 7.5],
  ['birch', 30, -21, 8], ['oak', -30, -19, 7.5], ['oak', -13, 31, 8], ['pine', 13, 32, 10],
  ['birch', 24.5, 27.5, 8.5], ['pine', -24, 23, 10.5], ['pine', -33, 8, 11], ['pine', 33.5, 14, 10],
  ...FORT_OAKS.map(([x, z]) => ['oak', x, z, FORT.oakH]),
].map(([kind, x, z, h], i) => {
  const k = TREE_KINDS[kind], s = h / k.h, yaw = (i * 2.39996) % (Math.PI * 2);
  const [cx, cz] = place({ x, z, yaw }, [k.trunk[0] * s, k.trunk[1] * s]);
  return { kind, x, z, h, yaw, cx, cz, r: Math.max(0.35, k.trunk[2] * s) };
});

// Initial prop placement: [type, x, z]. Every prop belongs somewhere; crates, barrels, pots, hay and potions
// are split between the north and south halves.
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
  ['hay', 15.6, -28.3], ['hay', 16.7, -28.3], ['hay', 17.8, -28.3], ['hay', 18.9, -28.3],
];

// Free for all (round 11): seven spawns round the rim, [x, 0, z, yaw facing the map centre], 17-36 m apart,
// none in sight of another at chest height, at least 14 m from every potion and at least 10 m from any perch
// that sees them. The barn, loft, pen and fort fill the east, so it gets one. Picked with /tmp/wa-environment/spawnsearch11.mjs (see the hand-off).
export const SPAWN_POINTS = [
  [8.5, 0, 30, -2.87],      // north, behind the farmhouse's east corner
  [-17, 0, 27, 2.58],       // north-west, past the tractor
  [-32, 0, 5.5, 1.74],      // west, the old field's far edge
  [-22, 0, -24, 0.74],      // south-west, beyond the felled silo
  [-6.5, 0, -32.5, 0.20],   // south, west of the archway lane
  [10.5, 0, -34.5, -0.30],  // south-east meadow, south of the canopy fort
  [33, 0, -7, -1.36],       // east, behind the pen
];


// ------------------------------------------------------------ walkable surfaces (platforms and ramps)
// High ground you can stand on: boxes (a flat top) and ramps (a top sloping along the piece's local +z).
//   { kind: 'box',  x, z, w, d, yaw, top,    name }   footprint w (local x) by d (local z)
//   { kind: 'ramp', x, z, w, d, yaw, y0, y1, name }   the top rises linearly from y0 at local z = -d/2 to y1 at +d/2
// yaw follows Object3D.rotation.y (local +z points along (sin yaw, cos yaw)). Options:
//   round: true      a circular footprint of diameter w (= d) instead of a rectangle (rock plateaus)
//   thick: t         only the slab from top - t to top is solid (a deck on posts, a bridge): you walk and shoot
//                    underneath it. Without it a piece is solid from the ground up.
//   moveOnly: true   blocks movement only: shots and line of sight pass through (ladders, railings)
//   ladder: true     a steep ramp standing in front of a ladder (for climbing animations; otherwise a ramp)
//   noStand: true    a thin wall (railing, parapet): never stood on, a wall to anyone whose feet are below its top
// A piece's sides are walls for anyone whose feet are more than STEP_UP below its top there (and whose body
// reaches its underside); shots and line of sight are blocked inside its solid part. Surfaces are not in
// COLLIDERS (those block at any height); every system asks the helpers below. Goats stay on the ground.
export const STEP_UP = 0.45;      // the highest rise a wizard steps onto without jumping
export const BODY_HEIGHT = 1.8;   // for walking under decks
export const SURFACES = [];       // filled in by the pieces further down
const sLocal = (s, x, z) => {
  const dx = x - s.x, dz = z - s.z, c = Math.cos(s.yaw || 0), n = Math.sin(s.yaw || 0);
  return [dx * c - dz * n, dx * n + dz * c];
};
const sWorld = (s, lx, lz) => {
  const c = Math.cos(s.yaw || 0), n = Math.sin(s.yaw || 0);
  return [s.x + lx * c + lz * n, s.z - lx * n + lz * c];
};
// The top of `s` at local z (no bounds check), and the bottom of its solid part.
const sTop = (s, lz) => s.kind === 'ramp' ? s.y0 + (s.y1 - s.y0) * Math.max(0, Math.min(1, lz / s.d + 0.5)) : s.top;
const sBottom = (s, lz) => s.thick ? sTop(s, lz) - s.thick : -1e9;
const sInside = (s, lx, lz, pad = 0) => s.round ? Math.hypot(lx, lz) <= s.w / 2 + pad : Math.abs(lx) <= s.w / 2 + pad && Math.abs(lz) <= s.d / 2 + pad;

// The highest solid top under (x, z) (ground 0), ignoring decks you could walk under at ground level.
export function surfaceTopAt(x, z) {
  let h = 0;
  for (const s of SURFACES) {
    const [lx, lz] = sLocal(s, x, z);
    if (sInside(s, lx, lz) && !(s.thick && sBottom(s, lz) > BODY_HEIGHT * 0.6)) h = Math.max(h, sTop(s, lz));
  }
  return h;
}
// Is the point (x, y, z) inside a piece's solid part? (`moveOnly` pieces count unless `shots` is true.)
export function surfaceSolidAt(x, y, z, shots = false) {
  for (const s of SURFACES) {
    if (shots && s.moveOnly) continue;
    const [lx, lz] = sLocal(s, x, z);
    if (sInside(s, lx, lz) && y < sTop(s, lz) && y > sBottom(s, lz)) return s;
  }
  return null;
}
// Where a wizard with feet at footY stands at (x, z): the highest top there that is at most STEP_UP above the
// feet (so you step up stairs and ramps, stay on what you stand on, and drop off edges), or 0 (the ground).
export function surfaceHeight(x, z, footY = 0) {
  let h = 0;
  for (const s of SURFACES) {
    const [lx, lz] = sLocal(s, x, z);
    if (s.noStand || !sInside(s, lx, lz)) continue;
    const t = sTop(s, lz);
    if (t <= footY + STEP_UP && t > h) h = t;
  }
  return h;
}
// Walls: push a circle (x, z, r) with feet at footY (and a body `height` tall) out of every piece whose top at
// the contact point is more than STEP_UP above the feet, unless the body passes wholly under a deck there.
// Returns [x, z] (unchanged if nothing is hit). Iterates a few times for corners between pieces.
export function surfacePushOut(x, z, footY, r, height = BODY_HEIGHT) {
  for (let it = 0; it < 3; it++) {
    let moved = false;
    for (const s of SURFACES) {
      const [lx, lz] = sLocal(s, x, z);
      if (!sInside(s, lx, lz, r)) continue;
      let nx, nz;
      if (s.round) {
        const R = s.w / 2, d = Math.hypot(lx, lz);
        if (sTop(s, 0) <= footY + STEP_UP || (s.thick && footY + height <= sBottom(s, 0))) continue;
        if (d >= R + r) continue;
        const k = d > 1e-6 ? (R + r) / d : 0;
        nx = d > 1e-6 ? lx * k : R + r; nz = d > 1e-6 ? lz * k : 0;
      } else {
        const cx = Math.max(-s.w / 2, Math.min(s.w / 2, lx)), cz = Math.max(-s.d / 2, Math.min(s.d / 2, lz));
        if (sTop(s, cz) <= footY + (s.noStand ? 0 : STEP_UP)) continue;   // low enough to step onto (a thin wall: to pass over)
        if (s.thick && footY + height <= sBottom(s, cz)) continue; // walking under a deck
        if (cx === lx && cz === lz) {
          // centre inside the footprint: out through the nearest side
          const ex = s.w / 2 - Math.abs(lx), ez = s.d / 2 - Math.abs(lz);
          if (ex < ez) { nx = Math.sign(lx || 1) * (s.w / 2 + r); nz = lz; } else { nx = lx; nz = Math.sign(lz || 1) * (s.d / 2 + r); }
        } else {
          const dx = lx - cx, dz = lz - cz, dd = Math.hypot(dx, dz);
          if (dd >= r) continue;
          nx = cx + dx / dd * r; nz = cz + dz / dd * r;
        }
      }
      [x, z] = sWorld(s, nx, nz); moved = true;
    }
    if (!moved) break;
  }
  return [x, z];
}
// The first point where the segment a -> b ([x, y, z] each) enters a piece's solid part (side, top, slope or
// underside), as { t (0..1 along the segment), p: [x, y, z], surface }, or null. For projectiles and line of
// sight; `moveOnly` pieces (ladders, railings) are ignored.
export function surfaceSegmentHit(a, b) {
  let best = null;
  for (const s of SURFACES) {
    if (s.moveOnly) continue;
    const [ax, az] = sLocal(s, a[0], a[2]), [bx, bz] = sLocal(s, b[0], b[2]);
    let t0 = 0, t1 = 1, ok = true;
    // the footprint in 2D: a slab pair, or a circle
    if (s.round) {
      const dx = bx - ax, dz = bz - az, A = dx * dx + dz * dz, B = 2 * (ax * dx + az * dz), Cc = ax * ax + az * az - (s.w / 2) ** 2;
      if (A < 1e-12) { if (Cc > 0) continue; }
      else {
        const disc = B * B - 4 * A * Cc;
        if (disc < 0) continue;
        const q = Math.sqrt(disc);
        t0 = Math.max(t0, (-B - q) / (2 * A)); t1 = Math.min(t1, (-B + q) / (2 * A));
        if (t0 > t1) continue;
      }
    } else {
      for (const [p0, d, lo, hi] of [[ax, bx - ax, -s.w / 2, s.w / 2], [az, bz - az, -s.d / 2, s.d / 2]]) {
        if (Math.abs(d) < 1e-12) { if (p0 < lo || p0 > hi) { ok = false; break; } continue; }
        let u0 = (lo - p0) / d, u1 = (hi - p0) / d;
        if (u0 > u1) [u0, u1] = [u1, u0];
        t0 = Math.max(t0, u0); t1 = Math.min(t1, u1);
        if (t0 > t1) { ok = false; break; }
      }
      if (!ok) continue;
    }
    // inside the footprint, height above the top and above the underside are both linear in t (a ramp's top is
    // linear in local z): keep the part where bottom < y < top
    for (const [f, sign] of [[(u) => (a[1] + (b[1] - a[1]) * u) - sTop(s, az + (bz - az) * u), -1],
                             ...(s.thick ? [[(u) => (a[1] + (b[1] - a[1]) * u) - sBottom(s, az + (bz - az) * u), 1]] : [])]) {
      // want sign * f(u) >= 0
      const g0 = sign * f(t0), g1 = sign * f(t1);
      if (g0 < 0 && g1 < 0) { ok = false; break; }
      if (g0 < 0) t0 = t0 + (t1 - t0) * (-g0) / (g1 - g0);
      else if (g1 < 0) t1 = t0 + (t1 - t0) * g0 / (g0 - g1);
    }
    if (!ok || t0 > t1) continue;
    // a ramp's top is only linear within its d span; the clamp at the ends is covered by the slab clip
    if (!best || t0 < best.t) best = { t: t0, surface: s, p: [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, a[2] + (b[2] - a[2]) * t0] };
  }
  return best;
}
export const surfaceBlocks = (a, b) => !!surfaceSegmentHit(a, b);
// Footprint corners in world space (for drawing, overlays, bots' ramp waypoints and the goats' routes); a round
// piece gives the corners of its bounding square.
export const surfaceCorners = (s) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, k]) => sWorld(s, i * s.w / 2, k * s.d / 2));
// The foot of a ramp (its low end's middle) in world space: where a bot heads to get onto the high ground.
export const rampFoot = (s) => sWorld(s, 0, (s.y1 >= s.y0 ? -1 : 1) * (s.d / 2 + 0.6));

// ------------------------------------------------------------ the high ground (round 9): Ty's Meshy pieces
// Each piece is a model placed at { x, z, yaw, h (model height in m), sx / sz (horizontal stretch), y (lift) }
// plus the walkable surfaces fitted to it. Surface shapes are given in the model's own units (fitModel space: the
// model 1 tall, base at y 0, centred on x/z, before yaw and stretch), measured from top-down heightmaps and
// horizontal slices of each optimised glb (/tmp/wa-environment/heightmap.mjs, slices.mjs). Each perch has a way
// up, a counter (a second route, or cover against it) and overlooks no spawn point from closer than 15 m.
export const PIECE_MODELS = [];   // { model, x, z, yaw, h, sx, sz, y, id } for world.js to draw
export const PIECE_COLLIDERS = []; // extra circles (tower legs) merged into COLLIDERS below
function piece(id, model, at, parts) {
  const P = { model, id, x: at.x, z: at.z, yaw: at.yaw || 0, h: at.h, sx: at.sx || 1, sz: at.sz || 1, y: at.y || 0 };
  PIECE_MODELS.push({ ...P, yaw: at.modelYaw ?? P.yaw });   // modelYaw: the model turned differently from its surfaces' frame
  const kx = P.h * P.sx, kz = P.h * P.sz;
  const toWorld = (lx, lz) => place(P, [lx * kx, lz * kz]);
  parts.forEach((pt, i) => {
    const name = `${id}-${pt.name || i}`, extra = { name, piece: id, style: pt.style, ...(pt.style === 'rail' || pt.wall ? { noStand: true } : {}), ...(pt.opts || {}) };
    if (pt.box) {
      const [x0, x1, z0, z1] = pt.box, [cx, cz] = toWorld((x0 + x1) / 2, (z0 + z1) / 2);
      SURFACES.push({ kind: 'box', x: cx, z: cz, w: (x1 - x0) * kx, d: (z1 - z0) * kz, yaw: P.yaw, top: P.y + pt.top * P.h, ...extra });
    } else if (pt.disc) {
      const [cx, cz] = toWorld(0, 0);
      SURFACES.push({ kind: 'box', round: true, x: cx, z: cz, w: 2 * pt.disc * kx, d: 2 * pt.disc * kz, yaw: P.yaw, top: P.y + pt.top * P.h, ...extra });
    } else if (pt.ramp) {
      // ramp: [x0, x1] across, lz [low end, high end], y [low, high]; it may rise toward local -z
      const [x0, x1] = pt.ramp, [lzLo, lzHi] = pt.lz, [yLo, yHi] = pt.y, up = lzHi > lzLo;
      const [cx, cz] = toWorld((x0 + x1) / 2, (lzLo + lzHi) / 2);
      SURFACES.push({ kind: 'ramp', x: cx, z: cz, w: (x1 - x0) * kx, d: Math.abs(lzHi - lzLo) * kz, yaw: P.yaw + (up ? 0 : Math.PI),
        y0: P.y + yLo * P.h, y1: P.y + yHi * P.h, ...extra });
    }
  });
  return P;
}
{
  // ---- meadow rock plateaus (rock_plateau: a round flat top at 0.94, radius 0.73, near-vertical sides)
  // The low one (1.5 m) in the south-east meadow, reached by the stone ruin steps (ruin_steps: treads rising
  // toward -z to a 0.62 landing between two stone side walls). The hay stacks and the oak screen the south-east spawn.
  piece('plateau-low', 'rock_plateau', { x: 26.5, z: -22.5, yaw: 0.4, h: 1.6, sx: 1.5, sz: 1.5 }, [{ disc: 0.73, top: 0.94, style: 'rock' }]);
  piece('plateau-low-steps', 'ruin_steps', { x: 23.8, z: -22.5, yaw: -Math.PI / 2, h: 2.42 }, [
    { name: 'treads', ramp: [-0.18, 0.21], lz: [0.56, -0.3], y: [0.03, 0.62], style: 'stone' },
    { name: 'landing', box: [-0.18, 0.21, -0.56, -0.3], top: 0.62, style: 'stone' },
    { name: 'wall-l', ramp: [-0.38, -0.18], lz: [0.5, -0.1], y: [0.5, 0.95], style: 'stone', wall: true },
    { name: 'wall-r', ramp: [0.21, 0.4], lz: [0.5, -0.1], y: [0.36, 0.82], style: 'stone', wall: true },
  ]);
  // The high one (2.5 m) in the north-east meadow: since round 10 it's reached by plank bridges from the hay loft
  // and from the pen rock (below), both in view of the pen; the barn hides the farmyard spawns from it.
  piece('plateau-high', 'rock_plateau', { x: 29, z: 18.5, yaw: 1.1, h: 2.66, sx: 1.25, sz: 1.25 }, [{ disc: 0.73, top: 0.94, style: 'rock' }]);
  // ---- the hay loft by the barn's east wall (hay_loft: a 0.69 deck on posts, a hay stack on it, a steep ladder
  // down its +z side). The ladder faces the barn; under the deck is open. It looks south over the pen toward the
  // Barn Passage circle; the barn hides the farmyard spawns. Counter: one ladder up, nothing but the hay for cover.
  piece('loft', 'hay_loft', { x: 20.6, z: 21.5, yaw: -Math.PI / 2, h: 3.3 }, [
    { name: 'deck', box: [-0.43, 0.43, -0.67, 0.39], top: 0.69, opts: { thick: 0.3 }, style: 'wood' },
    { name: 'hay', box: [0.0, 0.31, -0.27, 0.1], top: 0.99, opts: { thick: 0.3 * 0.99 }, style: 'hay' },
    { name: 'ladder', ramp: [-0.34, -0.09], lz: [0.68, 0.39], y: [0, 0.69], opts: { moveOnly: true, ladder: true }, style: 'ladder' },
  ]);
  // ---- the watchtower by the crop field's south-west corner (wooden_watchtower: a 0.5 deck inside a 0.15-high
  // parapet, open on the ladder side, a roof from 0.75 on corner posts; a vertical ladder on its +z face). 8.5 m
  // tall: the deck is 4.25 m up and fits two wizards. The parapet stops you walking off but not spells; the roof
  // has no collider (nobody can reach it). Overlooks the Fallen Silo circle. Counter: one ladder, no cover.
  const TW = { x: -32.8, z: -14.8, yaw: Math.PI / 2, h: 8.5 };
  piece('tower', 'watchtower', TW, [
    { name: 'deck', box: [-0.186, 0.19, -0.172, 0.172], top: 0.5, opts: { thick: 0.35 }, style: 'wood' },
    // the parapet: cover for whoever holds the deck (it stops spells too), never stood on; a gap for the ladder
    // (local +z, east)
    { name: 'wall-n', box: [-0.186, 0.19, -0.172, -0.142], top: 0.65, opts: { thick: 0.15 * 8.5 }, style: 'plankwall', wall: true },
    { name: 'wall-w', box: [-0.186, -0.156, -0.142, 0.142], top: 0.65, opts: { thick: 0.15 * 8.5 }, style: 'plankwall', wall: true },
    { name: 'wall-e', box: [0.16, 0.19, -0.142, 0.142], top: 0.65, opts: { thick: 0.15 * 8.5 }, style: 'plankwall', wall: true },
    { name: 'wall-s1', box: [-0.186, -0.005, 0.142, 0.172], top: 0.65, opts: { thick: 0.15 * 8.5 }, style: 'plankwall', wall: true },
    { name: 'wall-s2', box: [0.135, 0.19, 0.142, 0.172], top: 0.65, opts: { thick: 0.15 * 8.5 }, style: 'plankwall', wall: true },
    { name: 'ladder', ramp: [0.0, 0.135], lz: [0.29, 0.172], y: [0, 0.5], opts: { moveOnly: true, ladder: true }, style: 'ladder' },
  ]);
  for (const [lx, lz] of [[-0.14, -0.13], [0.15, -0.13], [-0.14, 0.11], [0.15, 0.11]]) {
    const [x, z] = place(TW, [lx * TW.h, lz * TW.h]);
    PIECE_COLLIDERS.push({ x, z, r: 0.2, h: TW.h * 0.75, kind: 'tower' });
  }
  // ---- the ruin ledges on the altar's west rim: two stone platforms (ruin_platform: a 0.90 top, a low lip at
  // -z, built-in stairs down its +z side) at the same height, joined by the arched plank bridge (plank_bridge: a
  // deck arching from 0.33 at its ends to 0.58 mid-span, along local x; a rope across one end is visual only).
  // The stairs face away from the altar. They look over the Altar circle; the ring's west pillars and the blast
  // stones are cover, and each ledge has its own stairs plus the bridge, so neither is a dead end.
  const LEDGE_TOP = 2.0, LH = LEDGE_TOP / 0.9, LS = 0.8, BH = 2.6;   // 2.0: above a 1.45 m jump (+0.45 step-up) from the ground
  let [A, B] = [fromAltar(237, 11.6), fromAltar(273.3, 11.6)];
  let u = [(B[0] - A[0]) / Math.hypot(B[0] - A[0], B[1] - A[1]), (B[1] - A[1]) / Math.hypot(B[0] - A[0], B[1] - A[1])];
  const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  if (-u[1] * (mid[0] - ALTAR.x) + u[0] * (mid[1] - ALTAR.z) < 0) { [A, B] = [B, A]; u = [-u[0], -u[1]]; }   // stairs (+z) outward
  const LY = Math.atan2(-u[1], u[0]);
  const ledgeParts = [
    { name: 'top', box: [-0.88, 0.88, -1.1, 0.73], top: 0.9, style: 'stone' },
    { name: 'stairs', ramp: [-0.5, 0.5], lz: [1.25, 0.73], y: [0.0, 0.9], style: 'stone' },
  ];
  piece('ledge-a', 'ruin_platform', { x: A[0], z: A[1], yaw: LY, h: LH, sx: LS, sz: LS }, ledgeParts);
  piece('ledge-b', 'ruin_platform', { x: B[0], z: B[1], yaw: LY, h: LH, sx: LS, sz: LS }, ledgeParts);
  // the bridge's deck ends sit on the ledges (0.33 of its height = the ledge top), its posts just inside their edges
  const BY = LEDGE_TOP - 0.33 * BH;
  piece('bridge', 'plank_bridge', { x: mid[0], z: mid[1], yaw: LY + Math.PI / 2, modelYaw: LY, h: BH, y: BY }, [
    // along the bridge (model x) as two ramps a side, following the arch: ends 0.33, 0.47 at |x| 0.7, crest 0.58
    // (ramps run along their local z, so the model is turned a quarter: model x -> ramp z)
    ...[[-1.08, -0.7, 0.33, 0.47], [-0.7, 0.0, 0.47, 0.58], [1.08, 0.7, 0.33, 0.47], [0.7, 0.0, 0.47, 0.58]].map(([a0, a1, y0, y1], i) =>
      ({ name: `deck${i}`, ramp: [-0.42, 0.42], lz: [a0, a1], y: [y0, y1], opts: { thick: 0.3 }, style: 'wood' })),
    ...[[-1.08, 0.0, 0.33, 0.58], [1.08, 0.0, 0.33, 0.58]].flatMap(([a0, a1, y0, y1], i) => [-1, 1].map(side =>
      ({ name: `rope${i}${side}`, ramp: side < 0 ? [-0.52, -0.42] : [0.42, 0.52], lz: [a0, a1], y: [y0 + 0.36, y1 + 0.36], opts: { thick: 0.36 * BH, moveOnly: true }, style: 'rail' }))),
  ]);
  // ---- the raised cart road along the farmyard's west side: two earth embankments nose to nose (embankment: a
  // path rising toward -z from 0.05 to 0.90, flat for its last third, then a steep drop), 0.9 m at the crest.
  // The high route between the farmyard and the field side; the low route runs beside it.
  const roadParts = [
    { name: 'slope', ramp: [-0.8, 0.8], lz: [1.35, -0.85], y: [0.05, 0.9], style: 'earth' },
    { name: 'crest', box: [-0.8, 0.8, -1.5, -0.85], top: 0.9, style: 'earth' },
  ];
  piece('road-s', 'embankment', { x: -10.5, z: 2.62, yaw: Math.PI, h: 1.0, sx: 1.3, sz: 1.3 }, roadParts);
  piece('road-n', 'embankment', { x: -10.5, z: 6.38, yaw: 0, h: 1.0, sx: 1.3, sz: 1.3 }, roadParts);
}

// ------------------------------------------------------------ round 10 pieces (round 11 kept the clean ones)
// Pieces in world coordinates (stand-ins drawn by world.js from their surfaces until Meshy models exist).
// Round 11 removed the farmhouse annex (deck, shed on posts, the shed-to-tower bridge, the covered walkway onto
// the cart road), the farmhouse porch and the loft gallery with its stairs and ladder.
const WS = (piece, name, extra) => SURFACES.push({ piece, name: `${piece}-${name}`, ...extra });
// a box with its centre, size, yaw and top; opts as for any surface
const boxW = (piece, name, x, z, w, d, yaw, top, opts = {}) => WS(piece, name, { kind: 'box', x, z, w, d, yaw, top, ...opts });
// a ramp from a = [x, z, y] up (or down) to b = [x, z, y], w wide
const rampW = (piece, name, a, b, w, opts = {}) => WS(piece, name, { kind: 'ramp', x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, w,
  d: Math.hypot(b[0] - a[0], b[1] - a[1]), yaw: Math.atan2(b[0] - a[0], b[1] - a[1]), y0: a[2], y1: b[2], ...opts });
// rails along both sides of a ramp or a bridge (never stood on, block walking off; low enough to shoot over)
const railsW = (piece, name, a, b, w, h = 1.0) => {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = (b[1] - a[1]) / L, nz = -(b[0] - a[0]) / L;
  for (const k of [-1, 1]) rampW(piece, `${name}-rail${k}`, [a[0] + nx * k * w / 2, a[1] + nz * k * w / 2, a[2] + h], [b[0] + nx * k * w / 2, b[1] + nz * k * w / 2, b[2] + h], 0.12,
    { thick: h, moveOnly: true, noStand: true, style: 'rail' });
};
// a wall standing on a deck or the ground: from `base` up `h`, never stood on, blocks spells (cover)
const wallW = (piece, name, x, z, w, d, yaw, base, h, style = 'plankwall') => boxW(piece, name, x, z, w, d, yaw, base + h, { thick: h, noStand: true, style });

// ---- the silo and barn link: a silo leaning up to the hay loft from the north-east meadow, and a plank bridge
// from the loft to the high rock plateau. An elevated route from the pen side to the barn.
export const LEANING_SILO = { foot: [27.8, 24.5, 0.25], top: [22.7, 22.3, 2.28], r: 0.9 };
rampW('silo-lean', 'top', LEANING_SILO.foot, LEANING_SILO.top, 1.2, { style: 'silo' });   // its top is the walkway
{
  // the plank bridge from the loft's east edge to the high plateau (2.28 -> 2.5)
  const from = [22.81, 21.5], to = [29, 18.5], L = Math.hypot(to[0] - from[0], to[1] - from[1]), u = [(to[0] - from[0]) / L, (to[1] - from[1]) / L];
  const BH2 = 2.8, c = [from[0] + u[0] * 2.3, from[1] + u[1] * 2.3], yawU = Math.atan2(u[0], u[1]);
  piece('loft-bridge', 'plank_bridge', { x: c[0], z: c[1], yaw: yawU, modelYaw: yawU - Math.PI / 2, h: BH2, y: 2.28 - 0.33 * BH2 }, [
    ...[[-1.08, -0.7, 0.33, 0.47], [-0.7, 0.0, 0.47, 0.58], [1.08, 0.7, 0.33, 0.47], [0.7, 0.0, 0.47, 0.58]].map(([a0, a1, y0, y1], i) =>
      ({ name: `deck${i}`, ramp: [-0.42, 0.42], lz: [a0, a1], y: [y0, y1], opts: { thick: 0.3 }, style: 'wood' })),
    ...[[-1.08, 0.0, 0.33, 0.58], [1.08, 0.0, 0.33, 0.58]].flatMap(([a0, a1, y0, y1], i) => [-1, 1].map(side =>
      ({ name: `rope${i}${side}`, ramp: side < 0 ? [-0.52, -0.42] : [0.42, 0.52], lz: [a0, a1], y: [y0 + 0.36, y1 + 0.36], opts: { thick: 0.36 * BH2, moveOnly: true }, style: 'rail' }))),
  ]);
}

// ---- the pen rock (round 10): stone ruin steps up onto a rock plateau (2.5 m) on ground the smaller pen gave
// back, bridged north to the high plateau, which is bridged on to the hay loft: one high route from the pen
// side over to the barn. The pen's hay stacks and the c10 outcrop are cover against it from the farmyard.
export const PEN_ROCK = { x: 30, z: 8.8 };
piece('pen-rock', 'rock_plateau', { x: PEN_ROCK.x, z: PEN_ROCK.z, yaw: 2.2, h: 2.66, sx: 1.4, sz: 1.4 }, [{ disc: 0.73, top: 0.94, style: 'rock' }]);
{
  const H = 2.5 / 0.62, r1 = 0.73 * 2.66 * 1.4, len = 1.123 * H;
  piece('pen-rock-steps', 'ruin_steps', { x: PEN_ROCK.x, z: PEN_ROCK.z - r1 - len / 2 + 0.45, yaw: Math.PI, h: H, sx: 0.7 }, [
    { name: 'treads', ramp: [-0.18, 0.21], lz: [0.56, -0.3], y: [0.03, 0.62], style: 'stone' },
    { name: 'landing', box: [-0.18, 0.21, -0.56, -0.3], top: 0.62, style: 'stone' },
    { name: 'wall-l', ramp: [-0.38, -0.18], lz: [0.5, -0.1], y: [0.5, 0.95], style: 'stone', wall: true },
    { name: 'wall-r', ramp: [0.21, 0.4], lz: [0.5, -0.1], y: [0.36, 0.82], style: 'stone', wall: true },
  ]);
  // the plank bridge north to the high plateau (2.5 -> 2.5)
  const to = [29, 18.5], d = Math.hypot(to[0] - PEN_ROCK.x, to[1] - PEN_ROCK.z), u = [(to[0] - PEN_ROCK.x) / d, (to[1] - PEN_ROCK.z) / d];
  const from = [PEN_ROCK.x + u[0] * r1, PEN_ROCK.z + u[1] * r1], BH2 = 2.8, c = [from[0] + u[0] * 2.3, from[1] + u[1] * 2.3], yawU = Math.atan2(u[0], u[1]);
  piece('rock-bridge', 'plank_bridge', { x: c[0], z: c[1], yaw: yawU, modelYaw: yawU - Math.PI / 2, h: BH2, y: 2.5 - 0.33 * BH2 }, [
    ...[[-1.08, -0.7, 0.33, 0.47], [-0.7, 0.0, 0.47, 0.58], [1.08, 0.7, 0.33, 0.47], [0.7, 0.0, 0.47, 0.58]].map(([a0, a1, y0, y1], i) =>
      ({ name: `deck${i}`, ramp: [-0.42, 0.42], lz: [a0, a1], y: [y0, y1], opts: { thick: 0.3 }, style: 'wood' })),
    ...[[-1.08, 0.0, 0.33, 0.58], [1.08, 0.0, 0.33, 0.58]].flatMap(([a0, a1, y0, y1], i) => [-1, 1].map(side =>
      ({ name: `rope${i}${side}`, ramp: side < 0 ? [-0.52, -0.42] : [0.42, 0.52], lz: [a0, a1], y: [y0 + 0.36, y1 + 0.36], opts: { thick: 0.36 * BH2, moveOnly: true }, style: 'rail' }))),
  ]);
}

// ---- the canopy fort: three big oaks round a centre deck south-east of the altar, a deck round each trunk,
// plank bridges to the centre, stairs up the south oak, ladders up the other two. The leaves block sight from
// above (LOS_VOLUMES); low plank walls and crates on the decks are cover. Contested from below on all sides.
export const LOS_VOLUMES = [];   // { x, z, r, y0, y1 }: blocks line of sight only (not movement, not spells)
{
  const F = FORT, C0 = [F.x, F.z];
  boxW('fort', 'centre', F.x, F.z, 3.6, 3.6, 0, F.centre, { thick: 0.35, style: 'deck' });
  wallW('fort', 'crate-a', F.x - 0.9, F.z + 0.9, 0.9, 0.9, 0.4, F.centre, 1.0, 'crate');
  wallW('fort', 'crate-b', F.x + 1.0, F.z - 0.8, 0.9, 0.9, 0.9, F.centre, 1.0, 'crate');
  F.bearings.forEach((b, i) => {
    const u = [Math.sin(b * Math.PI / 180), Math.cos(b * Math.PI / 180)];
    const t = TREES[TREES.length - F.bearings.length + i];
    const yaw = Math.atan2(u[0], u[1]), half = 2.8;
    boxW('fort', `oak${b}`, t.cx, t.cz, 2 * half, 2 * half, yaw, F.deck, { thick: 0.35, style: 'deck' });
    // low plank wall along the outer edge (cover), leaving the corners open
    wallW('fort', `oak${b}-wall`, t.cx + u[0] * (half - 0.12), t.cz + u[1] * (half - 0.12), 3.0, 0.24, yaw, F.deck, 1.0);
    // the bridge from the centre deck's edge to this oak's inner edge
    const tc = 1.8 / Math.max(Math.abs(u[0]), Math.abs(u[1]));
    const a = [C0[0] + u[0] * (tc - 0.3), C0[1] + u[1] * (tc - 0.3), F.centre], e = [t.cx - u[0] * (half - 0.3), t.cz - u[1] * (half - 0.3), F.deck];
    rampW('fort', `bridge${b}`, a, e, 1.3, { thick: 0.3, style: 'deck' });
    railsW('fort', `bridge${b}`, a, e, 1.3);
    // the way up from outside: stairs on the south oak, ladders on the others (from the outer edge, sideways)
    const side = [u[1], -u[0]], edge = [t.cx + side[0] * half, t.cz + side[1] * half];
    if (b === 180) rampW('fort', `stairs${b}`, [edge[0] + side[0] * 6.5, edge[1] + side[1] * 6.5, 0], [edge[0], edge[1], F.deck], 1.4, { style: 'stairs' });
    else rampW('fort', `ladder${b}`, [edge[0] + side[0] * 1.0, edge[1] + side[1] * 1.0, 0], [edge[0], edge[1], F.deck], 0.9, { moveOnly: true, ladder: true, style: 'ladder' });
    LOS_VOLUMES.push({ x: t.x, z: t.z, r: 0.45 * F.oakH, y0: 0.4 * F.oakH, y1: F.oakH });
  });
}
// Cover on the perches that had none: a boulder on each rock top, a broken-wall chunk on each ruin ledge's
// altar-facing edge (never stood on; they stop spells).
{
  for (const [id, dx, dz] of [['plateau-low', 0.8, 0.5], ['plateau-high', 1.2, 0.7], ['pen-rock', 1.0, 0.8]]) {
    const top = SURFACES.find(sf => sf.name === `${id}-0`);
    wallW(id, 'boulder', top.x + dx, top.z + dz, 1.0, 1.0, 0.5, top.top, 1.15, 'boulder');
  }
  for (const id of ['ledge-a', 'ledge-b']) {
    const top = SURFACES.find(sf => sf.name === `${id}-top`), d = Math.hypot(ALTAR.x - top.x, ALTAR.z - top.z);
    const u = [(ALTAR.x - top.x) / d, (ALTAR.z - top.z) / d];
    wallW(id, 'parapet', top.x + u[0] * 1.0, top.z + u[1] * 1.0, 1.8, 0.4, Math.atan2(u[1], -u[0]), top.top, 1.0, 'stone');
  }
}
// Does the segment a -> b ([x, y, z]) pass through foliage (LOS_VOLUMES)? For line-of-sight checks only.
export function losVolumeBlocks(a, b) {
  for (const v of LOS_VOLUMES) {
    const dx = b[0] - a[0], dz = b[2] - a[2], A = dx * dx + dz * dz;
    const k = A > 1e-9 ? Math.max(0, Math.min(1, ((v.x - a[0]) * dx + (v.z - a[2]) * dz) / A)) : 0;
    // sample the segment where it is closest and along it, inside the vertical band
    for (const t of [k, 0.25, 0.5, 0.75]) {
      const x = a[0] + dx * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + dz * t;
      if (y > v.y0 && y < v.y1 && Math.hypot(x - v.x, z - v.z) < v.r) return true;
    }
  }
  return false;
}

// ---- cover clusters on open ground (round 11): rock outcrops (Meshy rock_jagged) out in the meadow and the
// blast site, hay and crate stacks in the farmyard. Twenty clusters, each at least 6 m from the next, set across
// the longest ground sight lines. Each becomes colliders of kind 'cover' tagged with its cluster (goats route
// round each cluster's box). type: hedge | wall | lowwall | hay | crates | rock (hedges and walls are unused).
export const COVER_CLUSTERS = [
  { id: 'c1', type: 'rock', pts: [[-18.1,4.9,2],[-19.3,5.8,2.7],[-20.8,6.2,2.4],[-22.2,6,1.8]] },
  { id: 'c2', type: 'hay', pts: [[-5.6,8.9],[-6.4,7.1],[-4.6,7.4]] },
  { id: 'c3', type: 'rock', pts: [[-19.8,-4.2,2],[-21.3,-3.9,2.7],[-22.8,-4.1,2.4],[-24,-4.9,1.8]] },
  { id: 'c4', type: 'rock', pts: [[7,-4,2],[5.8,-4.9,2.7],[5,-6.2,2.4],[4.8,-7.6,1.8]] },   // clear of the goats' lane to the gate (z -2) and the fallen pillar's detour corner
  { id: 'c5', type: 'crates', pts: [[4.5,11.4],[3.5,12.6],[4.7,13]] },
  { id: 'c6', type: 'rock', pts: [[-19.9,20.6,2],[-21.4,20.3,2.7],[-22.7,19.6,2.4],[-23.5,18.4,1.8]] },
  { id: 'c7', type: 'rock', pts: [[-5.5,-7,2.6],[-6.4,-8.8,2.2],[-4.8,-8.6,1.8]] },
  { id: 'c8', type: 'rock', pts: [[-29.8,0,2],[-31.3,0.2,2.7],[-32.8,-0.2,2.4],[-33.9,-1.1,1.8]] },
  { id: 'c9', type: 'hay', pts: [[-3.3,17.4],[-4.7,18.6]] },
  { id: 'c10', type: 'rock', pts: [[17.6,10.8,2],[16.2,10.4,2.7],[15,9.5,2.4],[14.2,8.3,1.8]] },
  { id: 'c11', type: 'rock', pts: [[-17,-11.6,2.6],[-18.8,-12.3,2.2],[-17.5,-13.2,1.8]] },
  { id: 'c12', type: 'rock', pts: [[-10.5,25.6,2],[-11.6,24.6,2.7],[-12.4,23.3,2.4],[-12.5,21.9,1.8]] },
  { id: 'c13', type: 'rock', pts: [[28.4,-13.6,2],[27.4,-14.8,2.7],[26.8,-16.2,2.4],[26.8,-17.6,1.8]] },   // turned north-south: goats from the south-east corner get round it
  { id: 'c14', type: 'rock', pts: [[-5.1,-28.3,2],[-5.5,-26.9,2.7],[-6.4,-25.6,2.4],[-7.6,-24.9,1.8]] },
  { id: 'c15', type: 'rock', pts: [[-24.5,-19.5,2],[-25.4,-18.4,2.7],[-26.7,-17.6,2.4],[-28.1,-17.4,1.8]] },
  { id: 'c16', type: 'rock', pts: [[5.8,-30.8,2],[4.5,-31.5,2.7],[3.5,-32.6,2.4],[3,-34,1.8]] },
  { id: 'c17', type: 'rock', pts: [[35.3,3.7,2],[34.3,2.6,2.7],[33.7,1.3,2.4],[33.7,-0.2,1.8]] },
  { id: 'c18', type: 'rock', pts: [[-27.9,11.7,2],[-29.3,12.1,2.7],[-30.8,11.9,2.4],[-32,11.2,1.8]] },
  { id: 'h1', type: 'rock', pts: [[-4.3,1.4,2.5],[-5.8,2.1,2.1],[-3.2,2.4,1.6]] },   // hand-placed: the yard-to-altar crossing, either side of the path
  { id: 'h2', type: 'rock', pts: [[4.7,1.5,2.4],[6.2,0.9,2]] },
];   // c*: /tmp/wa-environment/coverplace11.mjs against ground lines over 30 m, then gapfix.mjs (no 0-1 m snag gaps)
export const COVER_SPEC = {
  hedge:   { r: 0.55, h: 1.9, spacing: 0.7 },
  wall:    { r: 0.45, h: 1.8, spacing: 0.6 },
  lowwall: { r: 0.4,  h: 1.0, spacing: 0.6 },   // waist-high: you shoot over it, crouch behind it
  hay:     { r: 0.85, h: 1.7 },
  crates:  { r: 0.7,  h: 1.7 },
  rock:    { r: 0.36, h: 1 },                    // pts are [x, z, height]: r scales with it
};
export function coverColliders(cl) {
  const S = COVER_SPEC[cl.type], tag = { kind: 'cover', cluster: cl.id, type: cl.type };
  if (S.spacing) return cl.lines.flatMap(line => chain(line, S.spacing)).map(([x, z]) => ({ x, z, r: S.r, h: S.h, ...tag }));
  if (cl.type === 'rock') return cl.pts.map(([x, z, h]) => ({ x, z, r: S.r * h + 0.05, h: h * 0.95, ...tag }));
  return cl.pts.map(([x, z]) => ({ x, z, r: S.r, h: S.h, ...tag }));
}

// ------------------------------------------------------------ health potions (round 10)
// Pickup spots for the spells side's healing flasks: on contested and high ground, every one at least 14 m from
// any spawn point. Round 11 dropped the high plateau's (8 m from the loft's) to make room for an east spawn. [id, x, z]; `y` is the walkable top there (the canopy fort's deck is
// CANOPY_DECK until its surfaces exist).
export const CANOPY_DECK = 4.0;
export const HEAL_SPOTS = [
  ['bridge', -10.6, -9.8],        // the plank bridge's crest between the ruin ledges, over the altar's west side
  ['canopy', 15, -16],            // the treetop fort's centre deck, south-east of the altar
  ['loft', 21.2, 21],             // the hay loft by the barn
  ['plateau-low', 26.5, -22.5],   // the low rock plateau, south-east meadow
  ['tower', -32.8, -14.8],        // the watchtower deck
].map(([id, x, z]) => ({ id, x, z, get y() { return surfaceHeight(x, z, 99) || (id === 'canopy' ? CANOPY_DECK : 0); } }));

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
  ...PIECE_COLLIDERS,
  ...COVER_CLUSTERS.flatMap(coverColliders),
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
    if (SURFACES.some(sf => { const c = Math.cos(sf.yaw || 0), n = Math.sin(sf.yaw || 0), dx = x - sf.x, dz = z - sf.z; return Math.abs(dx * c - dz * n) < sf.w / 2 + 1.2 && Math.abs(dx * n + dz * c) < sf.d / 2 + 1.2; })) continue;
    if (PROP_SPAWNS.some(([, px, pz]) => Math.hypot(px - x, pz - z) < 1.5)) continue;
    if (SPAWN_POINTS.some(([sx, , sz]) => Math.hypot(sx - x, sz - z) < 2)) continue;
    BLAST_SHARDS.push([x, z, yaw, h, tilt]);
    n++;
  }
  for (const [x, z, , h] of BLAST_SHARDS) COLLIDERS.push({ x, z, r: 0.25 * h + 0.05, h: h * 0.8, kind: 'stone' });
}

// Big solid pieces the goats walk around on their way home (world-space boxes around their colliders).
const boxOf = (kind, near = null) => {
  const cs = COLLIDERS.filter(c => (near?.cluster ? c.cluster === near.cluster : c.kind === kind && (!near || Math.hypot(c.x - near.x, c.z - near.z) < near.len + 1.5)));
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
// (Platforms and ramps are routed round by their exact footprints in goats.js, not by boxes.)
export const GOAT_DETOURS = [boxOf('barn'), boxOf('silo'), PEN_HAY, ...FALLEN_PILLARS.map(f => boxOf('ruin', f)), ...COVER_CLUSTERS.map(cl => boxOf('cover', cl))];   // each cover cluster too
