// Map layout, shared by server and client: arena size, obstacles, props, goats and spawn points.
// Owned by the environment track; gameplay code reads it through constants.js (which re-exports it).
//
// The wizard's farmstead, and what a spell did to it. +z is north. Standing in the farmyard facing the
// farmhouse (north), the goat pen is on your left (+x) and the old crop field (now meadow) on your right (-x).
// Round 12 tells one story from north to south:
//   the farm (z > +5)        farmhouse, barn, hay loft, leaning silo, goat pen, well, cart, tractor, scarecrow,
//                            hay, crates and barrels, the cart road, pines and oaks
//   the blast (z +5 .. -20)  the altar at (0, -7) where the spell went off: scorch, glowing cracks, blast stones,
//                            slabs and shards, the rune circle leaning outward, farm debris thrown out of the
//                            yard (the felled silo, a few crates and barrels, broken fence panels)
//   the magic land (z < -15) rune pillars, two archways, two obelisks, the ruin ledges, crystals and vases,
//                            birches and violet grass; the watchtower is a mage's lookout now
//
//                     farmhouse (0, 26)
//      tractor, cart       farmyard + well       walk-through barn (14, 20.5), hay loft, leaning silo
//   cart road                                             goat pen (gate faces the yard), pen rock
//   (-x)   ruin ledges     altar + blast site (0, -7)     felled silo        (+x)
//  watchtower   archway II, obelisk    archway, south meadow   ruin ledge, obelisk II, low plateau
// One mode (round 11): a four-player free for all; seven spawns round the rim (SPAWN_POINTS).

export const ARENA_RADIUS = 40;       // playable circle radius (m)

// Prop archetypes. `r` is the collision radius, `h` the height used for the hit sphere.
export const PROP_TYPES = {
  crate:   { r: 0.55, h: 1.1, hp: 1, color: 0xc08a4a },
  barrel:  { r: 0.5,  h: 1.2, hp: 1, color: 0x8a5a3a },
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
// ------------------------------------------------------------ the layout (round 13): layout.json is the map's data
// Every hand-placed thing is one entry in public/shared/layout.json: { id, kind, model?, x, z, rotY?, scale?, ...kind fields }.
// The map editor (?edit=1, docs/agents/map-editor.md) writes that file; this module turns it into the exports below
// (COLLIDERS, SURFACES, SPAWN_POINTS, ...), with every collider and surface defined relative to its entry, so it moves,
// turns and scales with it. The server reads the file synchronously at start; the browser fetches it (uncached) before
// anything builds. applyLayout() rebuilds every export in place (same arrays and objects), for the editor.
const IS_NODE = typeof process !== 'undefined' && !!process.versions?.node && typeof window === 'undefined';
export const LAYOUT_URL = new URL('./layout.json', import.meta.url);
async function readLayout() {
  if (IS_NODE) {
    const { readFileSync } = await import('node:fs');
    return JSON.parse(readFileSync(LAYOUT_URL, 'utf8'));
  }
  const res = await fetch(LAYOUT_URL, { cache: 'no-store' });
  return res.json();
}
export const LAYOUT = await readLayout();

// The kinds an entry may have, and the fields the editor shows for each (x, z, rotY and scale are common to all).
export const LAYOUT_KINDS = {
  altar: ['r', 'h'], farmhouse: [], pen: ['w', 'd', 'gateZ0', 'gateZ1'], haystack: [], scarecrow: [], tractor: [], barn: [], silo: [],
  pillar: ['tilt'], fallenPillar: ['len'], archway: ['height', 'tilt'], obelisk: ['height', 'r', 'tilt', 'sink'],
  blastStone: ['h', 'tilt'], tableRock: ['h', 'tilt'], well: [], cart: [], tree: ['model', 'h'],
  piece: ['model', 'h', 'sx', 'sz', 'y', 'modelYaw'], leanSilo: ['len', 'y0', 'y1', 'w', 'r'], wall: ['w', 'd', 'base', 'h', 'style'],
  prop: ['type'], spawn: [], heal: ['name'], cover: ['type', 'cluster', 'h'], fenceDebris: [], path: ['len', 'w'],
  // any model from public/models placed by the editor: `h` its height in m, `y` a lift; a collider when `r` > 0 (`colH` tall)
  deco: ['model', 'h', 'y', 'r', 'colH'],
};
// Stable pretty JSON for layout.json: one entry per line, keys in a fixed order, numbers to 4 decimals (0.1 mm), so a
// moved asset is a one-line git diff.
const KEY_ORDER = ['id', 'kind', 'model', 'type', 'name', 'piece', 'cluster', 'style', 'x', 'y', 'z', 'rotY', 'scale'];
const r4 = (v) => typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : Array.isArray(v) ? v.map(r4) : v && typeof v === 'object' ? sortKeys(v) : v;
function sortKeys(o) {
  const keys = Object.keys(o).sort((a, b) => (KEY_ORDER.indexOf(a) + 1 || 99) - (KEY_ORDER.indexOf(b) + 1 || 99) || (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(keys.map(k => [k, r4(o[k])]));
}
export function formatLayout(L) {
  const { entries, ...rest } = L;
  const head = Object.entries(sortKeys(rest)).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');
  return `{\n${head}\n  "entries": [\n${entries.map(e => '    ' + JSON.stringify(sortKeys(e))).join(',\n')}\n  ]\n}\n`;
}
// Checks a layout before it is saved: known kinds, finite numbers, unique ids. Returns a list of problems (empty: fine).
export function validateLayout(L) {
  const bad = [];
  if (!L || typeof L !== 'object' || !Array.isArray(L.entries)) return ['no entries array'];
  const ids = new Set();
  const finite = (v, path) => {
    if (typeof v === 'number') { if (!Number.isFinite(v)) bad.push(`${path} is not a finite number`); }
    else if (Array.isArray(v)) v.forEach((x, i) => finite(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) finite(x, `${path}.${k}`);
  };
  L.entries.forEach((e, i) => {
    if (!e || typeof e !== 'object') { bad.push(`entry ${i} is not an object`); return; }
    if (typeof e.id !== 'string' || !e.id) bad.push(`entry ${i} has no id`);
    else if (ids.has(e.id)) bad.push(`duplicate id ${e.id}`); else ids.add(e.id);
    if (!(e.kind in LAYOUT_KINDS)) bad.push(`${e.id}: unknown kind ${e.kind}`);
    for (const k of ['x', 'z']) if (typeof e[k] !== 'number') bad.push(`${e.id}: ${k} missing`);
    finite(e, e.id || `entry ${i}`);
  });
  finite(L.scatter || {}, 'scatter');
  return bad;
}

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
const S_ = (e) => e.scale ?? 1;

// ------------------------------------------------------------ fixed data (not placed: shapes, sizes, the old field)
// Farmhouse footprint as circles [dx, dz, r] from the house centre, fitted to the model's walls at yaw π (they turn with
// the entry's rotY from there): body x -4..5, z 22.5..30.5 at (0, 26), plus the porch on the -x front corner.
const HOUSE_BLOCKS = [
  [3.3, -1.4, 2.2], [0.5, -1.4, 2.2], [-2.3, -1.4, 2.2],
  [3.3, 2.4, 2.2], [0.5, 2.4, 2.2], [-2.3, 2.4, 2.2],
  [-4.1, -2.8, 1.5],
];
const HOUSE_YAW = Math.PI;
// The goat pen: an axis-aligned fenced rectangle, the gate a gap in its west side (x = x0); posts close enough that a
// 0.45 m wizard can't slip between them. postH: spells fly over; aiming at a goat's body clears it.
const PEN_POSTS = { postR: 0.25, postH: 0.7, postSpacing: 0.62 };
// The old crop field (meadow since round 10, with the scarecrow). Round 10 took the crops out.
export const FIELD = { x0: -33, x1: -18.4, z0: -11, z1: 10.5 };
export const CROP_ROWS = [];
// Tractor footprint as circles [offset along its heading, r], fitted to the Meshy model: 4.3 m long, 2.5 m across the
// rear wheels, 2.0 m across the front.
const TRACTOR_BLOCKS = [[-1.15, 1.25], [0.3, 1.0], [1.45, 1.0]];
// Walk-through barn (models/barn.glb): in model space it is long along x, a wide arch at -x, a 3 m side doorway in the
// +z wall (x 0..3) and a closed window wall at +x. Turned -90° the arch opens south onto the courtyard and the side
// door west toward the house: an L-shaped corridor, 2.5 m wide, with walls you can't shoot through. Wall lines in
// model space at its 7 m height, from a raycast section of the model at 0.6 and 1.4 m.
const BARN_HEIGHT = 7;
const BARN_WALLS = [
  [[-7.6, -2.4], [2.75, -2.4], [2.75, -1.5], [6.6, -1.5], [6.6, 1.15], [3.1, 1.15]],   // south wall, end wall, north wall to the side door
  [[-0.1, 1.1], [-4.3, 1.05], [-5.5, 1.5], [-7.2, 3.2]],                                 // north wall from the side door, then the arch's open door leaf
  [[6.6, 1.15], [6.5, 2.5]],                                                              // the end wall's open door leaf
];
// Round 13 (the double jump): the walls under the roof (model z -2.4..1.15) stand 6 m, so nobody clears the eaves (4.2 m,
// the ridge 5.7) from the hay loft's deck (apex 4.9) or its hay stack (5.9) and drops in through the roof. The open door
// leaves (z > 1.2) stay 4 m.
const BARN_MODEL_POSTS = BARN_WALLS.flatMap(line => chain(line, 0.6));
// The felled grain silo (models/silo.glb, 4 m model height): 11 m of hard cover, 3.6 m tall. In model space its body
// runs along x (-5.75..5.3, domed cap at +x), centred on z -0.25, radius 1.8.
const SILO_HEIGHT = 4;
// Rune pillars (models/rune_pillar.glb, 6 m) with a purple crystal above. `r` is fitted to the rubble at the foot, `h`
// to where the stone stops blocking.
export const PILLAR_HEIGHT = 6;
// The scorched ground round the altar, for the client decal.
export const BLAST_RADIUS = 15;
// The well (models/well.glb, 3.4 m): the stone ring is r 0.3 of its height; `h` reaches the roof, so the camera boom
// pulls in instead of ending up under it. The cart (models/horse_cart.glb, 2.6 m): the bed is x -0.75..3.75 in model
// space (wheels at z ±1.5), the shafts run off toward -x.
const WELL_SIZE = { r: 1.05, h: 3.4, height: 3.4 };
const CART_HEIGHT = 2.6;
// Meshy trees (models/pine|oak|birch.glb): trunk circles [dx, dz, r] in model space at the reference height, measured
// from a section at 1.5 m.
export const TREE_KINDS = {
  pine:  { h: 9,   trunk: [0.1, 0, 0.25] },
  oak:   { h: 7.5, trunk: [-0.25, 0.1, 1.0] },
  birch: { h: 8,   trunk: [0, -0.2, 0.25] },
};
// Cover clusters: each item is a layout entry of kind 'cover' tagged with its cluster (goats route round each
// cluster's box). type: hay | rock | pillar (hedge | wall | lowwall are unused).
export const COVER_SPEC = {
  hedge:   { r: 0.55, h: 1.9, spacing: 0.7 },
  wall:    { r: 0.45, h: 1.8, spacing: 0.6 },
  lowwall: { r: 0.4,  h: 1.0, spacing: 0.6 },   // waist-high: you shoot over it, crouch behind it
  hay:     { r: 0.85, h: 1.7 },
  rock:    { r: 0.36, h: 1 },                    // pts are [x, z, height]: r scales with it
  pillar:  { r: 0.75, h: 1 },                    // pts are [x, z, height]: rune_pillar.glb, the rubble at its foot inside r
};
export function coverColliders(cl) {
  const S = COVER_SPEC[cl.type], tag = { kind: 'cover', cluster: cl.id, type: cl.type };
  if (S.spacing) return cl.lines.flatMap(line => chain(line, S.spacing)).map(([x, z]) => ({ x, z, r: S.r, h: S.h, ...tag }));
  if (cl.type === 'rock') return cl.pts.map(([x, z, h]) => ({ x, z, r: S.r * h + 0.05, h: h * 0.95, ...tag }));
  if (cl.type === 'pillar') return cl.pts.map(([x, z, h]) => ({ x, z, r: S.r, h: h * 0.9, ...tag }));
  return cl.pts.map(([x, z]) => ({ x, z, r: S.r, h: S.h, ...tag }));
}
export const LOS_HEIGHT = 1.6;

// ------------------------------------------------------------ the high ground: Ty's Meshy pieces (round 9)
// A piece entry places a model { x, z, rotY (its surfaces' frame), h (model height in m), sx / sz (horizontal stretch),
// y (lift), modelYaw (the model turned differently from its surfaces' frame) }. Its walkable surfaces come from the
// model's parts below, given in the model's own units (fitModel space: the model 1 tall, base at y 0, centred on x/z,
// before yaw and stretch), measured from top-down heightmaps and horizontal slices of each optimised glb
// (/tmp/wa-environment/heightmap.mjs, slices.mjs). Each perch has a way up, a counter (a second route, or cover against
// it) and overlooks no spawn point from closer than 15 m.
//   ramp: [x0, x1] across, lz [low end, high end], y [low, high]; it may rise toward local -z
const bridgeParts = (P) => [
  // along the bridge (model x) as two ramps a side, following the arch: ends 0.33, 0.47 at |x| 0.7, crest 0.58
  // (ramps run along their local z, so the model is turned a quarter: model x -> ramp z)
  ...[[-1.08, -0.7, 0.33, 0.47], [-0.7, 0.0, 0.47, 0.58], [1.08, 0.7, 0.33, 0.47], [0.7, 0.0, 0.47, 0.58]].map(([a0, a1, y0, y1], i) =>
    ({ name: `deck${i}`, ramp: [-0.42, 0.42], lz: [a0, a1], y: [y0, y1], opts: { thick: 0.3 }, style: 'wood' })),
  // a rope along each side (visual only at one end; never stood on)
  ...[[-1.08, 0.0, 0.33, 0.58], [1.08, 0.0, 0.33, 0.58]].flatMap(([a0, a1, y0, y1], i) => [-1, 1].map(side =>
    ({ name: `rope${i}${side}`, ramp: side < 0 ? [-0.52, -0.42] : [0.42, 0.52], lz: [a0, a1], y: [y0 + 0.36, y1 + 0.36], opts: { thick: 0.36 * P.h, moveOnly: true }, style: 'rail' }))),
];
export const PIECE_PARTS = {
  // a round flat top at 0.94, radius 0.73, near-vertical sides
  rock_plateau: () => [{ disc: 0.73, top: 0.94, style: 'rock' }],
  // stone treads rising toward -z to a 0.62 landing between two stone side walls
  ruin_steps: () => [
    { name: 'treads', ramp: [-0.18, 0.21], lz: [0.56, -0.3], y: [0.03, 0.62], style: 'stone' },
    { name: 'landing', box: [-0.18, 0.21, -0.56, -0.3], top: 0.62, style: 'stone' },
    { name: 'wall-l', ramp: [-0.38, -0.18], lz: [0.5, -0.1], y: [0.5, 0.95], style: 'stone', wall: true },
    { name: 'wall-r', ramp: [0.21, 0.4], lz: [0.5, -0.1], y: [0.36, 0.82], style: 'stone', wall: true },
  ],
  // a 0.69 deck on posts, a hay stack on it, a steep ladder down its +z side; under the deck is open
  hay_loft: () => [
    { name: 'deck', box: [-0.43, 0.43, -0.67, 0.39], top: 0.69, opts: { thick: 0.3 }, style: 'wood' },
    { name: 'hay', box: [0.0, 0.31, -0.27, 0.1], top: 0.99, opts: { thick: 0.3 * 0.99 }, style: 'hay' },
    { name: 'ladder', ramp: [-0.34, -0.09], lz: [0.68, 0.39], y: [0, 0.69], opts: { moveOnly: true, ladder: true }, style: 'ladder' },
  ],
  // a 0.5 deck inside a 0.15-high parapet, open on the ladder side (local +z), a roof from 0.75 on corner posts (no
  // collider: nobody can reach it), a vertical ladder on its +z face. The parapet stops you walking off but not spells.
  watchtower: (P) => [
    { name: 'deck', box: [-0.186, 0.19, -0.172, 0.172], top: 0.5, opts: { thick: 0.35 }, style: 'wood' },
    { name: 'wall-n', box: [-0.186, 0.19, -0.172, -0.142], top: 0.65, opts: { thick: 0.15 * P.h }, style: 'plankwall', wall: true },
    { name: 'wall-w', box: [-0.186, -0.156, -0.142, 0.142], top: 0.65, opts: { thick: 0.15 * P.h }, style: 'plankwall', wall: true },
    { name: 'wall-e', box: [0.16, 0.19, -0.142, 0.142], top: 0.65, opts: { thick: 0.15 * P.h }, style: 'plankwall', wall: true },
    { name: 'wall-s1', box: [-0.186, -0.005, 0.142, 0.172], top: 0.65, opts: { thick: 0.15 * P.h }, style: 'plankwall', wall: true },
    { name: 'wall-s2', box: [0.135, 0.19, 0.142, 0.172], top: 0.65, opts: { thick: 0.15 * P.h }, style: 'plankwall', wall: true },
    { name: 'ladder', ramp: [0.0, 0.135], lz: [0.29, 0.172], y: [0, 0.5], opts: { moveOnly: true, ladder: true }, style: 'ladder' },
  ],
  // a 0.90 top, a low lip at -z, built-in stairs down its +z side
  ruin_platform: () => [
    { name: 'top', box: [-0.88, 0.88, -1.1, 0.73], top: 0.9, style: 'stone' },
    { name: 'stairs', ramp: [-0.5, 0.5], lz: [1.25, 0.73], y: [0.0, 0.9], style: 'stone' },
  ],
  // a deck arching from 0.33 at its ends to 0.58 mid-span, along model x
  plank_bridge: bridgeParts,
  // an earth embankment: a path rising toward -z from 0.05 to 0.90, flat for its last third, then a steep drop
  embankment: () => [
    { name: 'slope', ramp: [-0.8, 0.8], lz: [1.35, -0.85], y: [0.05, 0.9], style: 'earth' },
    { name: 'crest', box: [-0.8, 0.8, -1.5, -0.85], top: 0.9, style: 'earth' },
  ],
  // wooden farm stairs: treads rising toward -z from 0.08 to a 0.69 landing, a hand rail each side from 0.45 to 1.0
  wooden_stairs: () => [
    { name: 'treads', ramp: [-0.25, 0.25], lz: [0.74, -0.2], y: [0.08, 0.69], style: 'wood' },
    { name: 'landing', box: [-0.25, 0.25, -0.74, -0.2], top: 0.69, style: 'wood' },
    { name: 'rail-l', ramp: [-0.37, -0.25], lz: [0.7, -0.7], y: [0.45, 1.0], style: 'rail', opts: { moveOnly: true } },
    { name: 'rail-r', ramp: [0.25, 0.37], lz: [0.7, -0.7], y: [0.45, 1.0], style: 'rail', opts: { moveOnly: true } },
  ],
};
// Extra circles a piece's model needs (the watchtower's legs), in model units.
const PIECE_LEGS = { watchtower: { pts: [[-0.14, -0.13], [0.15, -0.13], [-0.14, 0.11], [0.15, 0.11]], r: 0.2, h: 0.75, kind: 'tower' } };
function buildPiece(out, e) {
  const k0 = S_(e);
  const P = { model: e.model, id: e.id, x: e.x, z: e.z, yaw: e.rotY || 0, h: e.h * k0, sx: e.sx || 1, sz: e.sz || 1, y: e.y || 0 };
  out.PIECE_MODELS.push({ ...P, yaw: e.modelYaw ?? P.yaw });
  const kx = P.h * P.sx, kz = P.h * P.sz;
  const toWorld = (lx, lz) => place(P, [lx * kx, lz * kz]);
  (PIECE_PARTS[e.model]?.(P) || []).forEach((pt, i) => {
    const name = `${e.id}-${pt.name || i}`, extra = { name, piece: e.id, style: pt.style, ...(pt.style === 'rail' || pt.wall ? { noStand: true } : {}), ...(pt.opts || {}) };
    if (pt.box) {
      const [x0, x1, z0, z1] = pt.box, [cx, cz] = toWorld((x0 + x1) / 2, (z0 + z1) / 2);
      out.SURFACES.push({ kind: 'box', x: cx, z: cz, w: (x1 - x0) * kx, d: (z1 - z0) * kz, yaw: P.yaw, top: P.y + pt.top * P.h, ...extra });
    } else if (pt.disc) {
      const [cx, cz] = toWorld(0, 0);
      out.SURFACES.push({ kind: 'box', round: true, x: cx, z: cz, w: 2 * pt.disc * kx, d: 2 * pt.disc * kz, yaw: P.yaw, top: P.y + pt.top * P.h, ...extra });
    } else if (pt.ramp) {
      const [x0, x1] = pt.ramp, [lzLo, lzHi] = pt.lz, [yLo, yHi] = pt.y, up = lzHi > lzLo;
      const [cx, cz] = toWorld((x0 + x1) / 2, (lzLo + lzHi) / 2);
      out.SURFACES.push({ kind: 'ramp', x: cx, z: cz, w: (x1 - x0) * kx, d: Math.abs(lzHi - lzLo) * kz, yaw: P.yaw + (up ? 0 : Math.PI),
        y0: P.y + yLo * P.h, y1: P.y + yHi * P.h, ...extra });
    }
  });
  const legs = PIECE_LEGS[e.model];
  if (legs) for (const [lx, lz] of legs.pts) {
    const [x, z] = place(P, [lx * P.h, lz * P.h]);
    out.PIECE_COLLIDERS.push({ x, z, r: legs.r, h: P.h * legs.h, kind: legs.kind });
  }
}

// ------------------------------------------------------------ the exports, rebuilt in place by applyLayout()
export const FARMHOUSE = {}, PEN = {}, GATE_LEAF = {}, SHELTER = {}, TROUGH = {}, SCARECROW = {}, TRACTOR = {}, BARN = {}, ALTAR = {},
  SILO = {}, ARCHWAY = {}, OBELISK = {}, OBELISK_FURROW = {}, WELL = {}, CART = {}, LEANING_SILO = {}, PEN_ROCK = {}, SCATTER_SETTINGS = {};
export const FENCE_SEGMENTS = [], FENCE_POSTS = [], GOAT_SPAWNS = [], CROPS = [], BARN_POSTS = [], BARN_POST_H = [], PILLARS = [],
  FALLEN_PILLARS = [], ARCHWAYS = [], OBELISKS = [], BLAST_STONES = [], TABLE_ROCKS = [], HAY_STACKS = [], TREES = [], PROP_SPAWNS = [],
  SPAWN_POINTS = [], LEDGE_SE = [], PIECE_MODELS = [], PIECE_COLLIDERS = [], LOS_VOLUMES = [], COVER_CLUSTERS = [], HEAL_SPOTS = [],
  COLLIDERS = [], BLAST_SHARDS = [], CRYSTALS = [], GOAT_DETOURS = [], FENCE_DEBRIS = [], PATHS = [], DECOS = [];

export const inPen = (x, z, margin = 0) =>
  x > PEN.x0 + margin && x < PEN.x1 - margin && z > PEN.z0 + margin && z < PEN.z1 - margin;
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
// [x, z] at compass bearing `deg` (0 = north +z, 90 = east +x) and distance `d` from the altar.
export const fromAltar = (deg, d) => [ALTAR.x + Math.sin(deg * Math.PI / 180) * d, ALTAR.z + Math.cos(deg * Math.PI / 180) * d];
// Object3D yaw that turns a model's +z away from the altar.
export const awayYaw = (x, z) => Math.atan2(x - ALTAR.x, z - ALTAR.z);
// Does the segment a -> b ([x, y, z]) pass through foliage (LOS_VOLUMES: { x, z, r, y0, y1 })? For line-of-sight checks
// only. Empty since round 12 took out the canopy fort.
export function losVolumeBlocks(a, b) {
  for (const v of LOS_VOLUMES) {
    const dx = b[0] - a[0], dz = b[2] - a[2], A = dx * dx + dz * dz;
    const k = A > 1e-9 ? Math.max(0, Math.min(1, ((v.x - a[0]) * dx + (v.z - a[2]) * dz) / A)) : 0;
    for (const t of [k, 0.25, 0.5, 0.75]) {
      const x = a[0] + dx * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + dz * t;
      if (y > v.y0 && y < v.y1 && Math.hypot(x - v.x, z - v.z) < v.r) return true;
    }
  }
  return false;
}

// Build every export from a layout into a fresh object (nothing global is touched).
export function buildMap(L) {
  const out = { SURFACES: [], PIECE_MODELS: [], PIECE_COLLIDERS: [], LOS_VOLUMES: [] };
  const of = (kind) => L.entries.filter(e => e.kind === kind);
  const one = (kind) => of(kind)[0];
  const WS = (piece, name, extra) => out.SURFACES.push({ piece, name: `${piece}-${name}`, ...extra });

  // the altar (everything bearing-based reads it through fromAltar/awayYaw, which use the exported ALTAR)
  const al = one('altar');
  out.ALTAR = { x: al.x, z: al.z, r: al.r * S_(al), h: al.h * S_(al) };
  const away = (x, z) => Math.atan2(x - out.ALTAR.x, z - out.ALTAR.z);

  // the farmhouse
  const fh = one('farmhouse');
  out.FARMHOUSE = { x: fh.x, z: fh.z, height: 11 * S_(fh), yaw: fh.rotY };
  // the goat pen
  const pe = one('pen'), pk = S_(pe), pw = pe.w * pk, pd = pe.d * pk;
  const PEN_ = { x0: pe.x - pw / 2, x1: pe.x + pw / 2, z0: pe.z - pd / 2, z1: pe.z + pd / 2, gate: {}, ...PEN_POSTS };
  PEN_.gate = { z0: PEN_.z0 + pe.gateZ0, z1: PEN_.z0 + pe.gateZ1 };
  PEN_.gateOut = [PEN_.x0 - 2, (PEN_.gate.z0 + PEN_.gate.z1) / 2];   // just outside the gate
  PEN_.gateIn = [PEN_.x0 + 1.8, (PEN_.gate.z0 + PEN_.gate.z1) / 2];  // just inside it
  out.PEN = PEN_;
  out.FENCE_SEGMENTS = [
    [[PEN_.x0, PEN_.z0], [PEN_.x1, PEN_.z0]],
    [[PEN_.x1, PEN_.z0], [PEN_.x1, PEN_.z1]],
    [[PEN_.x1, PEN_.z1], [PEN_.x0, PEN_.z1]],
    [[PEN_.x0, PEN_.z1], [PEN_.x0, PEN_.gate.z1]],
    [[PEN_.x0, PEN_.gate.z0], [PEN_.x0, PEN_.z0]],
  ];
  out.FENCE_POSTS = [];
  for (const [a, b] of out.FENCE_SEGMENTS) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.ceil(len / PEN_.postSpacing);
    for (let i = 0; i <= n; i++) {
      const x = a[0] + (b[0] - a[0]) * i / n, z = a[1] + (b[1] - a[1]) * i / n;
      if (!out.FENCE_POSTS.some(p => Math.hypot(p[0] - x, p[1] - z) < 0.05)) out.FENCE_POSTS.push([x, z]);
    }
  }
  // the gate leaf stands swung open outward from its hinge on the north gate post
  out.GATE_LEAF = { hinge: [PEN_.x0, PEN_.gate.z1], dir: [-0.16, 0.99], len: PEN_.gate.z1 - PEN_.gate.z0 };
  for (let i = 1; i <= 4; i++) {
    const k = out.GATE_LEAF.len * i / 4;
    out.FENCE_POSTS.push([out.GATE_LEAF.hinge[0] + out.GATE_LEAF.dir[0] * k, out.GATE_LEAF.hinge[1] + out.GATE_LEAF.dir[1] * k]);
  }
  out.GOAT_SPAWNS = pe.goats.map(([dx, dz]) => [PEN_.x0 + dx, PEN_.z0 + dz]);
  // inside the pen: a lean-to shelter against the back fence and a water trough by the gate
  out.SHELTER = { x: pe.x + pe.shelter.dx, z: pe.z + pe.shelter.dz, yaw: pe.shelter.yaw, w: pe.shelter.w, d: pe.shelter.d };
  out.TROUGH = { x: pe.x + pe.trough.dx, z: pe.z + pe.trough.dz, yaw: pe.trough.yaw, len: pe.trough.len };
  out.CROPS = [];
  for (const row of CROP_ROWS) for (let z = row.z0; z <= row.z1 + 1e-6; z += 0.9) out.CROPS.push([row.x, z]);
  out.HAY_STACKS = of('haystack').map(e => [e.x, e.z]);
  const sc = one('scarecrow'); out.SCARECROW = { x: sc.x, z: sc.z, yaw: sc.rotY };
  const tr = one('tractor'); out.TRACTOR = { x: tr.x, z: tr.z, yaw: tr.rotY, len: 4.3 * S_(tr) };
  // the barn
  const ba = one('barn'), bk = S_(ba);
  out.BARN = { x: ba.x, z: ba.z, yaw: ba.rotY, height: BARN_HEIGHT * bk };
  out.BARN_POSTS = BARN_MODEL_POSTS.map(([lx, lz]) => place(out.BARN, [lx * bk, lz * bk]));
  out.BARN_POST_H = BARN_MODEL_POSTS.map(([, lz]) => (lz <= 1.2 ? 6 : 4) * bk);
  // the felled silo
  const si = one('silo'), sk = S_(si);
  out.SILO = { x: si.x, z: si.z, yaw: si.rotY, height: SILO_HEIGHT * sk };
  const SILO_BLOCKS = [-4, -2.7, -1.4, -0.1, 1.2, 2.5, 3.6].map(lx => place(out.SILO, [lx * sk, -0.25 * sk]));
  // the rune circle, its fallen pillar, the archways and the obelisks
  out.PILLARS = of('pillar').map(e => ({ x: e.x, z: e.z, r: 0.9 * S_(e), h: 5 * S_(e), yaw: e.rotY, tilt: e.tilt }));
  out.FALLEN_PILLARS = of('fallenPillar').map(e => ({ x: e.x, z: e.z, yaw: e.rotY, len: e.len * S_(e) }));
  out.ARCHWAYS = of('archway').map(e => ({ x: e.x, z: e.z, yaw: e.rotY, height: e.height * S_(e), tilt: e.tilt }));
  out.ARCHWAY = out.ARCHWAYS[0];
  const ARCH_LEGS = out.ARCHWAYS.flatMap(A => [[-1.85, -0.35], [-1.85, 0.35], [1.6, -0.35], [1.6, 0.35]].map(([lx, lz]) => place(A, [lx * A.height / 6.5, lz * A.height / 6.5])));
  out.OBELISKS = of('obelisk').map(e => ({ x: e.x, z: e.z, yaw: e.rotY, height: e.height * S_(e), r: e.r * S_(e), tilt: e.tilt, sink: e.sink }));
  out.OBELISK = out.OBELISKS[0];
  const fur = of('obelisk').find(e => e.furrow)?.furrow;
  out.OBELISK_FURROW = fur ? { from: fur[0].slice(), to: fur[1].slice() } : { from: [0, 0], to: [0, 0] };
  // blast stones (rock_jagged, tilted away from the altar) and the flat slabs flung farther: [x, z, h, tilt] and
  // [x, z, yaw, h, tilt]
  out.BLAST_STONES = of('blastStone').map(e => [e.x, e.z, e.h * S_(e), e.tilt]);
  out.TABLE_ROCKS = of('tableRock').map(e => [e.x, e.z, e.rotY, e.h * S_(e), e.tilt]);
  // the well and the cart
  const we = one('well'), wk = S_(we);
  out.WELL = { x: we.x, z: we.z, r: WELL_SIZE.r * wk, h: WELL_SIZE.h * wk, height: WELL_SIZE.height * wk, yaw: we.rotY ?? 0 };
  const ca = one('cart'), ck = S_(ca);
  out.CART = { x: ca.x, z: ca.z, yaw: ca.rotY, height: CART_HEIGHT * ck };
  const CART_BLOCKS = [0.4, 1.6, 2.8].map(lx => place(out.CART, [lx * ck, 0]));
  // trees: yaw fixed per tree, so server and clients agree on the trunk offsets
  out.TREES = of('tree').map(e => {
    const k = TREE_KINDS[e.model], h = e.h * S_(e), s = h / k.h, yaw = e.rotY;
    const [cx, cz] = place({ x: e.x, z: e.z, yaw }, [k.trunk[0] * s, k.trunk[1] * s]);
    return { kind: e.model, x: e.x, z: e.z, h, yaw, cx, cz, r: Math.max(0.35, k.trunk[2] * s) };
  });

  // the high ground, in layout order: pieces, the leaning silo, and the walls standing on them (boulders, parapets)
  for (const e of L.entries) {
    if (e.kind === 'piece') buildPiece(out, e);
    else if (e.kind === 'leanSilo') {
      const L_ = e.len * S_(e), a = [e.x, e.z, e.y0], b = [e.x + Math.sin(e.rotY) * L_, e.z + Math.cos(e.rotY) * L_, e.y1];
      out.LEANING_SILO = { foot: a, top: b, r: e.r };
      WS(e.id, 'top', { kind: 'ramp', x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, w: e.w, d: Math.hypot(b[0] - a[0], b[1] - a[1]),
        yaw: Math.atan2(b[0] - a[0], b[1] - a[1]), y0: a[2], y1: b[2], style: 'silo' });
    } else if (e.kind === 'wall') {
      const k = S_(e);
      WS(e.piece, e.name, { kind: 'box', x: e.x, z: e.z, w: e.w * k, d: e.d * k, yaw: e.rotY, top: e.base + e.h * k, thick: e.h * k, noStand: true, style: e.style });
    }
  }
  out.LEANING_SILO ??= { foot: [0, 0, 0], top: [0, 0, 0], r: 0 };
  const pr = out.PIECE_MODELS.find(p => p.id === 'pen-rock');
  out.PEN_ROCK = pr ? { x: pr.x, z: pr.z } : { x: 0, z: 0 };
  const lc = out.PIECE_MODELS.find(p => p.id === 'ledge-c');
  out.LEDGE_SE = lc ? [lc.x, lc.z] : [0, 0];

  // props ([type, x, z]; a prop's id is its index + 1), spawns ([x, 0, z, yaw facing the map centre]) and heal spots
  out.PROP_SPAWNS = of('prop').map(e => [e.type, e.x, e.z]);
  out.SPAWN_POINTS = of('spawn').map(e => [e.x, 0, e.z, e.rotY]);
  out.HEAL_SPOTS = of('heal').map(e => { const { name: id, x, z } = e; return { id, x, z, get y() { return surfaceHeight(x, z, 99); } }; });
  // cover clusters, in the order their first item appears
  out.COVER_CLUSTERS = [];
  for (const e of of('cover')) {
    let cl = out.COVER_CLUSTERS.find(c => c.id === e.cluster);
    if (!cl) out.COVER_CLUSTERS.push(cl = { id: e.cluster, type: e.type, pts: [] });
    cl.pts.push(e.h !== undefined ? [e.x, e.z, e.h * S_(e)] : [e.x, e.z]);
  }
  // world.js's decoration: fence panels laid flat ([x, z, yaw]) and paths ([from, to, width])
  out.FENCE_DEBRIS = of('fenceDebris').map(e => [e.x, e.z, e.rotY]);
  out.PATHS = of('path').map(e => {
    const h = e.len * S_(e) / 2, dx = Math.sin(e.rotY) * h, dz = Math.cos(e.rotY) * h;
    return [[e.x - dx, e.z - dz], [e.x + dx, e.z + dz], e.w];
  });
  out.SCATTER_SETTINGS = { ...(L.scatter || {}) };
  // decoration placed in the editor: any model, optionally solid
  out.DECOS = of('deco').map(e => ({ id: e.id, model: e.model, x: e.x, z: e.z, yaw: e.rotY || 0, h: (e.h || 2) * S_(e), y: e.y || 0,
    r: (e.r || 0) * S_(e), colH: (e.colH || e.h || 2) * S_(e) }));

  // Everything solid, as circles. Movement (players, bots, goats) collides with all of them; projectiles pass over
  // anything lower than their height (`h`); line-of-sight checks (telekinesis, bot aiming, cover) only count colliders
  // at least LOS_HEIGHT tall.
  const along = (o, len, n, r, h, kind) => Array.from({ length: n }, (_, i) => {
    const k = n === 1 ? 0 : (i / (n - 1) - 0.5) * len;
    return { x: o.x + Math.sin(o.yaw) * k, z: o.z + Math.cos(o.yaw) * k, r, h, kind };
  });
  const fk = S_(fh), dYaw = fh.rotY - HOUSE_YAW;
  out.COLLIDERS = [
    ...out.PILLARS.map(p => ({ x: p.x, z: p.z, r: p.r, h: p.h, kind: 'pillar' })),
    ...out.TREES.map(t => ({ x: t.cx, z: t.cz, r: t.r, h: 6, kind: 'tree' })),
    ...HOUSE_BLOCKS.map(([dx, dz, r]) => {
      const [x, z] = place({ x: out.FARMHOUSE.x, z: out.FARMHOUSE.z, yaw: dYaw }, [dx * fk, dz * fk]);
      return { x, z, r: r * fk, h: 9 * fk, kind: 'house' };
    }),
    ...out.FENCE_POSTS.map(([x, z]) => ({ x, z, r: PEN_.postR, h: PEN_.postH, kind: 'fence' })),
    ...along({ ...out.SHELTER, yaw: out.SHELTER.yaw + Math.PI / 2 }, out.SHELTER.w - 1.6, 2, 1.25, 2.4, 'shelter'),   // spread along its width
    ...along(out.TROUGH, out.TROUGH.len - 0.9, 2, 0.5, 0.75, 'trough'),
    ...out.CROPS.map(([x, z]) => ({ x, z, r: 0.5, h: 0.9, kind: 'crop' })),
    { x: out.SCARECROW.x, z: out.SCARECROW.z, r: 0.35 * S_(sc), h: 2.4 * S_(sc), kind: 'scarecrow' },
    ...TRACTOR_BLOCKS.map(([k, r]) => ({ x: out.TRACTOR.x + Math.sin(out.TRACTOR.yaw) * k * S_(tr), z: out.TRACTOR.z + Math.cos(out.TRACTOR.yaw) * k * S_(tr), r: r * S_(tr), h: 3.0 * S_(tr), kind: 'tractor' })),
    { x: out.WELL.x, z: out.WELL.z, r: out.WELL.r, h: out.WELL.h, kind: 'well' },
    ...CART_BLOCKS.map(([x, z]) => ({ x, z, r: 1.2 * ck, h: 2.0 * ck, kind: 'cart' })),
    ...ARCH_LEGS.map(([x, z]) => ({ x, z, r: 0.75, h: 7, kind: 'arch' })),
    // an obelisk leans along its yaw: the stone over its foot, then higher up, farther out (the first leans 0.3)
    ...out.OBELISKS.flatMap(O => [[0, 0.9, 2.2], [1.0, 0.7, 4.2], [1.6, 0.5, 5.4]].map(([k, r, h]) => {
      const kk = k * O.tilt / 0.3, hh = h * O.height / 6;
      return { x: O.x + Math.sin(O.yaw) * kk, z: O.z + Math.cos(O.yaw) * kk, r, h: hh, kind: 'obelisk' };
    })),
    ...out.TABLE_ROCKS.map(([x, z, yaw, h]) => { const [cx, cz] = place({ x, z, yaw }, [-0.25 * h / 1.2, 0]); return { x: cx, z: cz, r: 1.25 * h / 1.2, h, kind: 'rock' }; }),
    ...out.BLAST_STONES.map(([x, z, h, tilt]) => { const k = Math.sin(tilt) * h * 0.35, a = away(x, z); return { x: x + Math.sin(a) * k, z: z + Math.cos(a) * k, r: 0.33 * h + 0.05, h: h * Math.cos(tilt), kind: 'stone' }; }),
    { x: out.ALTAR.x, z: out.ALTAR.z, r: out.ALTAR.r, h: out.ALTAR.h, kind: 'altar' },
    // fallen pillars: the rubble foot (0.42 of the length across, half buried), then the shaft lying away from it
    ...out.FALLEN_PILLARS.flatMap(f => [{ x: f.x + Math.sin(f.yaw) * 0.45, z: f.z + Math.cos(f.yaw) * 0.45, r: 1.0, h: 1.7, kind: 'ruin' },
      ...Array.from({ length: Math.ceil((f.len - 1.6) / 0.8) }, (_, i) => { const k = 1.6 + i * 0.8; return { x: f.x + Math.sin(f.yaw) * k, z: f.z + Math.cos(f.yaw) * k, r: 0.55, h: 1.1, kind: 'ruin' }; })]),
    ...out.HAY_STACKS.map(([x, z]) => ({ x, z, r: 0.85, h: 1.7, kind: 'hay' })),
    ...out.BARN_POSTS.map(([x, z], i) => ({ x, z, r: 0.45 * bk, h: out.BARN_POST_H[i], kind: 'barn' })),
    ...SILO_BLOCKS.map(([x, z]) => ({ x, z, r: 1.8 * sk, h: 3.6 * sk, kind: 'silo' })),
    ...out.PIECE_COLLIDERS,
    ...out.COVER_CLUSTERS.flatMap(coverColliders),
    ...out.DECOS.filter(d => d.r > 0).map(d => ({ x: d.x, z: d.z, r: d.r, h: d.colH, kind: 'deco' })),
  ];

  // Knee-high shards thrown out between the bigger pieces, thinning with distance (models/rock_jagged.glb). Seeded
  // (layout scatter.blastShards), so server and clients agree. [x, z, yaw, height, tilt]; they block walking, spells fly
  // over. They keep off paths, the yard, the pen, the old field, the dais and everything placed.
  const footClear = (x, z, pad) => out.SURFACES.some(sf => { const c = Math.cos(sf.yaw || 0), n = Math.sin(sf.yaw || 0), dx = x - sf.x, dz = z - sf.z; return Math.abs(dx * c - dz * n) < sf.w / 2 + pad && Math.abs(dx * n + dz * c) < sf.d / 2 + pad; });
  const inPen_ = (x, z, m) => x > PEN_.x0 + m && x < PEN_.x1 - m && z > PEN_.z0 + m && z < PEN_.z1 - m;
  const fromAl = (deg, d) => [out.ALTAR.x + Math.sin(deg * Math.PI / 180) * d, out.ALTAR.z + Math.cos(deg * Math.PI / 180) * d];
  out.BLAST_SHARDS = [];
  {
    const S = L.scatter?.blastShards || { seed: 23, count: 10 };
    let seed = S.seed;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const yard = (x, z) => (x / 13) ** 2 + ((z - 13) / 9) ** 2 < 1;
    for (let n = 0, tries = 0; n < S.count && tries < 2000; tries++) {
      const deg = rnd() * 360, d = 6 + Math.pow(rnd(), 0.9) * 12, [x, z] = fromAl(deg, d);
      const h = 0.45 + rnd() * 0.25 * (1.4 - d / 18), yaw = rnd() * 6.3, tilt = 0.35 + rnd() * 0.35;
      if (Math.hypot(x, z) > ARENA_RADIUS - 3 || yard(x, z) || inPen_(x, z, -2.5) || (x < FIELD.x1 + 2 && z > FIELD.z0 - 2)) continue;
      if (Math.abs(x) < 2.2 && Math.abs(z - out.ALTAR.z) > 3.6) continue;                  // the path south
      if (Math.hypot(x - out.ALTAR.x, z - out.ALTAR.z) < 5.2) continue;                   // the dais and its flagstones
      if (out.COLLIDERS.some(c => Math.hypot(c.x - x, c.z - z) < c.r + 1.4)) continue;     // no snags between pieces
      if (out.BLAST_SHARDS.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 1.8)) continue;
      if (footClear(x, z, 1.2)) continue;
      if (out.PROP_SPAWNS.some(([, px, pz]) => Math.hypot(px - x, pz - z) < 1.5)) continue;
      if (out.SPAWN_POINTS.some(([sx, , sz]) => Math.hypot(sx - x, sz - z) < 2)) continue;
      out.BLAST_SHARDS.push([x, z, yaw, h, tilt]);
      n++;
    }
    for (const [x, z, , h] of out.BLAST_SHARDS) out.COLLIDERS.push({ x, z, r: 0.25 * h + 0.05, h: h * 0.8, kind: 'stone' });
  }
  // Violet crystals grown out of the magic land (round 12): clusters knee to waist high. Seeded like the shards
  // (scatter.crystals). [x, z, yaw, size]; they block walking, spells fly over them.
  out.CRYSTALS = [];
  {
    const S = L.scatter?.crystals || { seed: 57, count: 14 };
    let seed = S.seed;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (let n = 0, tries = 0; n < S.count && tries < 4000; tries++) {
      const x = (rnd() * 2 - 1) * 36, z = -16 - rnd() * 22, size = 0.7 + rnd() * 0.5;
      if (Math.hypot(x, z) > ARENA_RADIUS - 2.5 || Math.hypot(x - out.ALTAR.x, z - out.ALTAR.z) < BLAST_RADIUS + 1) continue;
      if (Math.abs(x) < 2.4) continue;                                                        // the path south
      if (out.COLLIDERS.some(c => Math.hypot(c.x - x, c.z - z) < c.r + 1.6)) continue;
      if (out.CRYSTALS.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 4.5)) continue;
      if (footClear(x, z, 1.4)) continue;
      if (out.PROP_SPAWNS.some(([, px, pz]) => Math.hypot(px - x, pz - z) < 1.6)) continue;
      if (out.SPAWN_POINTS.some(([sx, , sz]) => Math.hypot(sx - x, sz - z) < 3)) continue;
      if (out.HEAL_SPOTS.some(h => Math.hypot(h.x - x, h.z - z) < 2.5)) continue;
      out.CRYSTALS.push([x, z, rnd() * 6.3, size]);
      n++;
    }
    for (const [x, z, , s] of out.CRYSTALS) out.COLLIDERS.push({ x, z, r: 0.5 * s, h: 1.1 * s, kind: 'crystal' });
  }

  // Big solid pieces the goats walk around on their way home (world-space boxes around their colliders).
  const boxOf = (kind, near = null) => {
    const cs = out.COLLIDERS.filter(c => (near?.cluster ? c.cluster === near.cluster : c.kind === kind && (!near || Math.hypot(c.x - near.x, c.z - near.z) < near.len + 1.5)));
    // (a cover cluster has no `cluster` field, only `id`, so its box comes out empty, ±Infinity, and goats ignore it:
    // kept as it was since round 11 by the layout migration; see the environment hand-off)
    return { x0: Math.min(...cs.map(c => c.x - c.r)), x1: Math.max(...cs.map(c => c.x + c.r)),
             z0: Math.min(...cs.map(c => c.z - c.r)), z1: Math.max(...cs.map(c => c.z + c.r)) };
  };
  // the hay stacks against the pen's yard-side fence count as one box, with the loose bales beside them
  const PEN_HAY = (() => {
    const cs = [...out.COLLIDERS.filter(c => c.kind === 'hay' && c.x > PEN_.x0 - 2 && c.z > PEN_.z0),
      ...out.PROP_SPAWNS.filter(([t, x, z]) => t === 'hay' && x > PEN_.x0 - 3 && z > PEN_.z0).map(([, x, z]) => ({ x, z, r: PROP_TYPES.hay.r }))];
    if (!cs.length) return { x0: PEN_.x0, x1: PEN_.x0, z0: PEN_.z0, z1: PEN_.z0 };
    return { x0: Math.min(...cs.map(c => c.x - c.r)), x1: PEN_.x0, z0: Math.min(...cs.map(c => c.z - c.r)), z1: Math.max(...cs.map(c => c.z + c.r)) };
  })();
  // each fallen pillar is a low wall a goat can't step round, so it gets a box too (the obelisks' and archways' circles
  // are small enough to slide round); platforms and ramps are routed round by their exact footprints in goats.js
  out.GOAT_DETOURS = [boxOf('barn'), boxOf('silo'), PEN_HAY, ...out.FALLEN_PILLARS.map(f => boxOf('ruin', f)), ...out.COVER_CLUSTERS.map(cl => boxOf('cover', cl))];
  return out;
}

// Rebuild every export from `L` in place: arrays keep their identity (emptied and refilled), objects are cleared and
// reassigned, so every module holding a reference sees the new layout. ARCHWAY and OBELISK stay the first entries of
// ARCHWAYS and OBELISKS.
const EXPORTS = { FARMHOUSE, PEN, GATE_LEAF, SHELTER, TROUGH, SCARECROW, TRACTOR, BARN, ALTAR, SILO, ARCHWAY, OBELISK, OBELISK_FURROW, WELL, CART,
  LEANING_SILO, PEN_ROCK, SCATTER_SETTINGS, FENCE_SEGMENTS, FENCE_POSTS, GOAT_SPAWNS, CROPS, BARN_POSTS, BARN_POST_H, PILLARS, FALLEN_PILLARS,
  ARCHWAYS, OBELISKS, BLAST_STONES, TABLE_ROCKS, HAY_STACKS, TREES, PROP_SPAWNS, SPAWN_POINTS, LEDGE_SE, PIECE_MODELS, PIECE_COLLIDERS,
  LOS_VOLUMES, COVER_CLUSTERS, HEAL_SPOTS, COLLIDERS, BLAST_SHARDS, CRYSTALS, GOAT_DETOURS, FENCE_DEBRIS, PATHS, DECOS, SURFACES };
export function applyLayout(L) {
  const m = buildMap(L);
  for (const [k, target] of Object.entries(EXPORTS)) {
    const v = m[k];
    if (Array.isArray(target)) { target.length = 0; target.push(...v); }
    else { for (const q of Object.keys(target)) delete target[q]; Object.assign(target, v); }
  }
  if (ARCHWAYS.length) ARCHWAYS[0] = ARCHWAY;
  if (OBELISKS.length) OBELISKS[0] = OBELISK;
  if (L !== LAYOUT) { LAYOUT.entries = L.entries; LAYOUT.scatter = L.scatter; LAYOUT.version = L.version; }
}
applyLayout(LAYOUT);
