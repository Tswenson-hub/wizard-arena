// Map layout, shared by server and client: arena size, props, spawn points, heal spots and everything solid.
// Owned by the environment track; gameplay code reads it through constants.js (which re-exports it).
//
// Round 15: the castle courtyard. The map is built from kit pieces (KayKit Dungeon in public/models/castle, the
// Quaternius Medieval Village roofs, towers and balconies in public/models/village), each one a layout entry of kind
// 'kit'. Its colliders are the piece's box (from its bounding box, kit-models.js) or the parts listed in KIT_PARTS
// (stairs are ramps, wall-walk floors are decks, parapets are thin walls). +z is north. A stone courtyard inside a
// square curtain wall with a wall-walk round it, stair towers up to it, a gatehouse to the south and a hall with a
// balcony; grass, trees and the mountains outside. Nothing here names a particular piece of the castle: everything
// comes from layout.json, which Ty edits in the map editor (?edit=1).
import { KIT_MODELS } from './kit-models.js';
export { KIT_MODELS };

export const ARENA_RADIUS = 40;       // the outer bound (m): the castle's walls are the real boundary, well inside it

// Prop archetypes (Telekinesis lifts and throws them, Trapped Relic curses them). `r` is the collision radius, `h` the
// height used for the hit sphere; `model` is the kit piece drawn for it, fitted to `h`.
export const PROP_TYPES = {
  crate:   { r: 0.5,  h: 0.95, hp: 1, color: 0xb07a45, model: 'castle/box_small' },
  barrel:  { r: 0.45, h: 0.95, hp: 1, color: 0x8a5a3a, model: 'castle/barrel_small' },
  keg:     { r: 0.6,  h: 1.15, hp: 1, color: 0x9a6438, model: 'castle/keg' },
  chest:   { r: 0.6,  h: 0.95, hp: 1, color: 0xa0683a, model: 'castle/chest' },
  potion:  { r: 0.5,  h: 1.15, hp: 1, color: 0x9a5cff },   // Meshy potion barrel (models/potion.glb)
};

// Kit scale: KayKit model units to metres. The KayKit Mage's head tops out at 2.16 units and the characters agent
// scales it to 1.8 m, so the kit gets the same factor and its doorways keep their proportions next to the players
// (requests.md, round 15). Quaternius' 2 m grid is half of KayKit's 4, so it takes the same factor.
export const KIT_SCALE = 1.8 / 2.16;
export const KIT_GRID = 2 * KIT_SCALE;    // the editor's snap: half a KayKit tile (a wall is 4 units, a small tile 2)
export const kitScale = (model) => KIT_SCALE;

// Goats are gone (round 15). These stay, empty, only until the spells agent's commit stops reading them (server.js,
// main.js, server/goats.js, public/js/goats.js); then they go.
export const GOAT = { count: 0, radius: 0.6, hitY: 0.7, walkSpeed: 1.3, trotSpeed: 2.6, windup: 0.7, chargeSpeed: 12.5, chargeTime: 3.0, turnRate: 2.0,
  dizzyTime: 2.2, recoverTime: 1.2, blockCost: 50, blockKnockback: 7, rammableBelow: 1.0, throwSpeed: 24, throwGravity: 6, stumbleTime: 0.5,
  ramScale: 1.15, orbitRadius: 2.2, orbitLap: 1.5, orbitTime: 3.0, ramLife: 9 };
export const PEN = { x0: 1e4, x1: 1e4, z0: 1e4, z1: 1e4, gate: { z0: 1e4, z1: 1e4 }, gateOut: [1e4, 1e4], gateIn: [1e4, 1e4] };
export const FENCE_SEGMENTS = [], GOAT_SPAWNS = [], GOAT_DETOURS = [];
export const inPen = () => false;
export const fenceDistance = () => Infinity;

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
// COLLIDERS (those block at any height); every system asks the helpers below.
export const STEP_UP = 0.45;      // the highest rise a wizard steps onto without jumping
export const BODY_HEIGHT = 1.8;   // for walking under decks
export const SURFACES = [];       // filled in from the layout further down
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
export function surfaceTopAt(x, z, list = SURFACES) {
  let h = 0;
  for (const s of list) {
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
export function surfaceHeight(x, z, footY = 0, list = SURFACES) {
  let h = 0;
  for (const s of list) {
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
// Footprint corners in world space (for drawing, overlays and bots' ramp waypoints); a round
// piece gives the corners of its bounding square.
export const surfaceCorners = (s) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, k]) => sWorld(s, i * s.w / 2, k * s.d / 2));
// The foot of a ramp (its low end's middle) in world space: where a bot heads to get onto the high ground.
export const rampFoot = (s) => sWorld(s, 0, (s.y1 >= s.y0 ? -1 : 1) * (s.d / 2 + 0.6));
// ------------------------------------------------------------ the layout (round 13): layout.json is the map's data
// Every placed thing is one entry in public/shared/layout.json: { id, kind, model?, x, z, rotY?, scale?, ...kind fields }.
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
//   kit     a kit piece (`model` 'castle/wall', 'village/Roof_RoundTiles_4x4', ...) at KIT_SCALE x `scale`; `y` lifts it
//           (stacking: wall-walk floors, a wall on a wall); `solid: 0` makes it decoration only
//   floor   a rectangle of ground tiles (`model`, `w` x `d` m), drawn only: the ground is at 0 under it. `mix`: other tile
//           models sprinkled in ('castle/a,castle/b'), `seed` for where
//   block   an invisible box (`w` x `d`, from `y` up `h`): blocks movement only (an edge you can't walk or jump off),
//           unless `shots: 1` (blocks spells and sight too) or `stand: 1` (you can stand on its top)
//   deco    any other model from public/models fitted to `h` m, lifted by `y`; a round collider when `r` > 0 (`colH` tall)
//   prop    a throwable (PROP_TYPES `type`; its id is its index + 1 among the props), spawn (facing rotY), heal (named spot);
//           a spawn or heal spot stands on top of what's there unless its `y` says otherwise (under a deck, inside the hall)
//   bounds  the playable rectangle (`w` x `d`): blinks and thrown wizards are kept inside it (ARENA_BOUNDS)
export const LAYOUT_KINDS = {
  kit: ['model', 'y', 'solid'], floor: ['model', 'w', 'd', 'mix', 'seed'], block: ['w', 'd', 'y', 'h', 'shots', 'stand'],
  deco: ['model', 'h', 'y', 'r', 'colH'], prop: ['type'], spawn: ['y'], heal: ['name', 'y'], bounds: ['w', 'd'],
};
// Stable pretty JSON for layout.json: one entry per line, keys in a fixed order, numbers to 4 decimals (0.1 mm), so a
// moved asset is a one-line git diff.
const KEY_ORDER = ['id', 'kind', 'model', 'type', 'name', 'x', 'y', 'z', 'rotY', 'scale'];
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
// Checks a layout before it is saved: known kinds, finite numbers, unique ids, kit models that exist. Returns a list of
// problems (empty: fine).
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
    if (e.kind === 'kit' && !(e.model in KIT_MODELS)) bad.push(`${e.id}: unknown kit model ${e.model}`);
    if (e.kind === 'prop' && !(e.type in PROP_TYPES)) bad.push(`${e.id}: unknown prop type ${e.type}`);
    for (const k of ['x', 'z']) if (typeof e[k] !== 'number') bad.push(`${e.id}: ${k} missing`);
    finite(e, e.id || `entry ${i}`);
  });
  finite(L.scatter || {}, 'scatter');
  return bad;
}

// Model space -> world for a piece placed at {x, z, yaw} (same convention as Object3D.rotation.y).
const place = (o, [lx, lz]) => [o.x + lx * Math.cos(o.yaw) + lz * Math.sin(o.yaw), o.z - lx * Math.sin(o.yaw) + lz * Math.cos(o.yaw)];
const S_ = (e) => e.scale ?? 1;
export const LOS_HEIGHT = 1.6;

// ------------------------------------------------------------ kit pieces: their solid parts
// A kit piece's parts, in the model's own units (KayKit: a wall is x -2..2, z -0.5..0.5, 4 tall, its origin at the
// foot of its centre line), before KIT_SCALE, the entry's scale, yaw and lift:
//   { box: [x0, x1, z0, z1], y: [bottom, top] }               solid from bottom to top (a deck when bottom is above the
//                                                             entry's foot, so you walk under it)
//   { ramp: [x0, x1], lz: [low end, high end], y: [low, high] }  a slope (stairs); it may rise toward local -z
//   either with noStand: true (a parapet or a rail: never stood on, a wall to anyone below its top) or
//   moveOnly: true (blocks movement only; spells and sight pass)
// A model not listed here is solid inside its bounding box (KIT_MODELS); KIT_DECOR models have no parts at all. Parts
// that end up no higher than 0.12 m (a floor tile on the ground) are dropped: the ground is already there.
const KIT_DECOR = /(^|\/)(banner|torch|candle|Prop_Vine|Window|WindowShutters)/;
const stairsParts = (w, rail) => [
  { name: 'treads', ramp: [-w, w], lz: [4, 0], y: [0, 4] },
  ...(rail ? [{ name: 'rail-l', ramp: [-2.5, -w], lz: [4, 0], y: [1, 5.1], noStand: true }, { name: 'rail-r', ramp: [w, 2.5], lz: [4, 0], y: [1, 5.1], noStand: true }] : []),
];
export const KIT_PARTS = {
  // L and T walls: two boxes, not their bounding square
  'castle/wall_corner': [{ box: [-2, 0.5, -0.5, 0.5], y: [0, 4] }, { box: [-0.5, 0.5, 0.5, 2], y: [0, 4] }],
  'castle/wall_Tsplit': [{ box: [-2, 2, -0.5, 0.5], y: [0, 4] }, { box: [-0.5, 0.5, 0.5, 2], y: [0, 4] }],
  'castle/barrier_corner': [{ box: [-2, 0.39, -0.39, 0.39], y: [0, 1.4] }, { box: [-0.39, 0.39, 0.39, 2], y: [0, 1.4] }],
  // stairs rise toward -z from 0 at z 4 to 4 (a wall's height) at z 0, between rails or walls
  'castle/stairs': stairsParts(1.5, true),
  'castle/stairs_wide': [{ name: 'treads', ramp: [-2.5, 2.5], lz: [4, 0], y: [0, 4] },
    { name: 'rail-l', ramp: [-3.5, -2.5], lz: [4, 0], y: [1, 5.1], noStand: true }, { name: 'rail-r', ramp: [2.5, 3.5], lz: [4, 0], y: [1, 5.1], noStand: true }],
  'castle/stairs_walled': [{ name: 'treads', ramp: [-1.25, 1.25], lz: [4, 0], y: [0, 4] },
    { name: 'wall-l', box: [-2.5, -1.25, 0, 4], y: [0, 4] }, { name: 'wall-r', box: [1.25, 2.5, 0, 4], y: [0, 4] }],
  // rubble: a pile you can jump onto, a little lower than its peaks
  'castle/rubble_large': [{ box: [-3.6, 3.6, -1.3, 0.7], y: [0, 2.9] }],
  'castle/rubble_half': [{ box: [0, 3.6, -1.2, 0.6], y: [0, 2.9] }],
};
export function kitParts(model) {
  if (model in KIT_PARTS) return KIT_PARTS[model];
  const b = KIT_MODELS[model];
  if (!b || KIT_DECOR.test(model)) return [];
  return [{ box: [b[0], b[1], b[4], b[5]], y: [b[2], b[3]] }];
}
// Neighbouring pieces overlap by SEAM m, so a layout rounded to 0.1 mm leaves no crack to fall through between two tiles.
const SEAM = 0.01;
function buildKit(out, e) {
  const k = kitScale(e.model) * S_(e), y = e.y || 0, P = { x: e.x, z: e.z, yaw: e.rotY || 0 };
  out.KIT_PIECES.push({ id: e.id, model: e.model, x: e.x, y, z: e.z, yaw: P.yaw, s: k });
  if (e.solid === 0) return;
  kitParts(e.model).forEach((pt, i) => {
    const extra = { name: `${e.id}-${pt.name || i}`, piece: e.id, model: e.model, style: 'kit', ...(pt.noStand ? { noStand: true } : {}), ...(pt.moveOnly ? { moveOnly: true } : {}) };
    if (pt.box) {
      const [x0, x1, z0, z1] = pt.box, [cx, cz] = place(P, [(x0 + x1) / 2 * k, (z0 + z1) / 2 * k]);
      const top = y + pt.y[1] * k, bottom = y + pt.y[0] * k;
      if (top <= 0.12) return;
      const s = { kind: 'box', x: cx, z: cz, w: (x1 - x0) * k + SEAM, d: (z1 - z0) * k + SEAM, yaw: P.yaw, top, ...extra };
      if (bottom > 0.05) s.thick = top - bottom;
      out.SURFACES.push(s);
    } else if (pt.ramp) {
      const [x0, x1] = pt.ramp, [lzLo, lzHi] = pt.lz, [yLo, yHi] = pt.y, up = lzHi > lzLo;
      const [cx, cz] = place(P, [(x0 + x1) / 2 * k, (lzLo + lzHi) / 2 * k]);
      const s = { kind: 'ramp', x: cx, z: cz, w: (x1 - x0) * k + SEAM, d: Math.abs(lzHi - lzLo) * k, yaw: P.yaw + (up ? 0 : Math.PI), y0: y + yLo * k, y1: y + yHi * k, ...extra };
      if (y > 0.05) s.thick = yHi * k;   // stacked: solid down to the entry's foot at the high end
      out.SURFACES.push(s);
    }
  });
}

// ------------------------------------------------------------ the exports, rebuilt in place by applyLayout()
// KIT_PIECES: { id, model, x, y, z, yaw, s (metres per model unit) } for world.js; FLOORS: { id, model, x, z, w, d, yaw,
// mix, seed }; DECOS: editor-placed models; ARENA_BOUNDS: { x0, x1, z0, z1 } (the whole arena circle's square when the
// layout has no bounds entry).
export const SCATTER_SETTINGS = {}, ARENA_BOUNDS = {};
export const PROP_SPAWNS = [], SPAWN_POINTS = [], HEAL_SPOTS = [], COLLIDERS = [], LOS_VOLUMES = [], KIT_PIECES = [], FLOORS = [], DECOS = [];
// Keep a point inside ARENA_BOUNDS, `margin` m in from its edges (for blinks, thrown wizards, landings).
export function clampToArena(x, z, margin = 0.5) {
  const B = ARENA_BOUNDS;
  return [Math.max(B.x0 + margin, Math.min(B.x1 - margin, x)), Math.max(B.z0 + margin, Math.min(B.z1 - margin, z))];
}
export const insideArena = (x, z, margin = 0) => x > ARENA_BOUNDS.x0 + margin && x < ARENA_BOUNDS.x1 - margin && z > ARENA_BOUNDS.z0 + margin && z < ARENA_BOUNDS.z1 - margin;
// Does the segment a -> b ([x, y, z]) pass through a sight-only volume? None in the castle; kept for constants.js.
export function losVolumeBlocks(a, b) { return false; }

// Build every export from a layout into a fresh object (nothing global is touched).
export function buildMap(L) {
  const out = { SURFACES: [], KIT_PIECES: [], LOS_VOLUMES: [] };
  const of = (kind) => L.entries.filter(e => e.kind === kind);
  for (const e of L.entries) if (e.kind === 'kit' && e.model in KIT_MODELS) buildKit(out, e);
  for (const e of of('block')) {
    const k = S_(e), y = e.y || 0, h = (e.h ?? 3) * k;
    out.SURFACES.push({ kind: 'box', x: e.x, z: e.z, w: e.w * k, d: e.d * k, yaw: e.rotY || 0, top: y + h, ...(y > 0.05 ? { thick: h } : {}),
      name: e.id, piece: e.id, style: 'block', ...(e.shots ? {} : { moveOnly: true }), ...(e.stand ? {} : { noStand: true }) });
  }
  out.FLOORS = of('floor').map(e => ({ id: e.id, model: e.model, x: e.x, z: e.z, w: e.w * S_(e), d: e.d * S_(e), yaw: e.rotY || 0,
    mix: e.mix ? String(e.mix).split(',').map(s => s.trim()).filter(Boolean) : [], seed: e.seed ?? 1 }));
  const bo = of('bounds')[0];
  out.ARENA_BOUNDS = bo ? { x0: bo.x - bo.w / 2, x1: bo.x + bo.w / 2, z0: bo.z - bo.d / 2, z1: bo.z + bo.d / 2 }
    : { x0: -ARENA_RADIUS, x1: ARENA_RADIUS, z0: -ARENA_RADIUS, z1: ARENA_RADIUS };

  // props ([type, x, z]; a prop's id is its index + 1), spawns ([x, y, z, yaw facing into the fight]; y is where you stand
  // there: 0 in the courtyard and under a deck, the wall-walk's height up on it; an entry's own `y` wins) and heal spots
  // ({ id, x, z, y: on top of whatever is there })
  out.PROP_SPAWNS = of('prop').map(e => [e.type, e.x, e.z]);
  out.SPAWN_POINTS = of('spawn').map(e => [e.x, e.y ?? surfaceTopAt(e.x, e.z, out.SURFACES), e.z, e.rotY || 0]);
  out.HEAL_SPOTS = of('heal').map(e => { const { name: id, x, z } = e, y0 = e.y; return { id, x, z, get y() { return y0 ?? surfaceHeight(x, z, 99); } }; });
  out.SCATTER_SETTINGS = { ...(L.scatter || {}) };
  // decoration placed in the editor: any model, optionally solid
  out.DECOS = of('deco').map(e => ({ id: e.id, model: e.model, x: e.x, z: e.z, yaw: e.rotY || 0, h: (e.h || 2) * S_(e), y: e.y || 0,
    r: (e.r || 0) * S_(e), colH: (e.colH || e.h || 2) * S_(e) }));

  // Solid circles. Movement (players, bots) collides with all of them; projectiles pass over anything lower than their
  // height (`h`); line-of-sight checks only count colliders at least LOS_HEIGHT tall. The castle's pieces are SURFACES
  // (boxes and ramps); only round decos are circles.
  out.COLLIDERS = out.DECOS.filter(d => d.r > 0).map(d => ({ x: d.x, z: d.z, r: d.r, h: d.colH, kind: 'deco' }));
  return out;
}

// Rebuild every export from `L` in place: arrays keep their identity (emptied and refilled), objects are cleared and
// reassigned, so every module holding a reference sees the new layout.
const EXPORTS = { SCATTER_SETTINGS, ARENA_BOUNDS, PROP_SPAWNS, SPAWN_POINTS, HEAL_SPOTS, COLLIDERS, LOS_VOLUMES, KIT_PIECES, FLOORS, DECOS, SURFACES };
export function applyLayout(L) {
  const m = buildMap(L);
  for (const [k, target] of Object.entries(EXPORTS)) {
    const v = m[k];
    if (Array.isArray(target)) { target.length = 0; target.push(...v); }
    else { for (const q of Object.keys(target)) delete target[q]; Object.assign(target, v); }
  }
  if (L !== LAYOUT) { LAYOUT.entries = L.entries; LAYOUT.scatter = L.scatter; LAYOUT.version = L.version; }
}
applyLayout(LAYOUT);
