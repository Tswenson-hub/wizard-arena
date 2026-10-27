// Low-poly farmstead: ground, farmhouse, courtyard, goat pen, crop field, tractor, rune pillars,
// trees, and prop mesh factories. Layout data lives in shared/map.js; this file only draws it.
// Farm pieces are procedural stand-ins until a Meshy model for them is loaded (see loadModels).
import * as THREE from 'three';
import * as C from '../shared/constants.js';

const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0.0, ...extra });
// Ground decals stacked on the floor: polygon offset instead of y gaps so they never z-fight.
const decal = (color, layer) => flat(color, { polygonOffset: true, polygonOffsetFactor: -layer, polygonOffsetUnits: -layer * 4 });

function jitterGeometry(geo, amount) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i,
      pos.getX(i) + (Math.random() - 0.5) * amount,
      pos.getY(i) + (Math.random() - 0.5) * amount,
      pos.getZ(i) + (Math.random() - 0.5) * amount);
  }
  geo.computeVertexNormals();
  return geo;
}

export function groundHeight(x, z) {
  const r = Math.hypot(x, z);
  const rise = Math.max(0, r - C.ARENA_RADIUS - 2);
  return rise > 0 ? rise * 0.3 + Math.sin(x * 0.35) * Math.cos(z * 0.3) * Math.min(1.5, rise * 0.3) : 0;
}

const shadowy = (o) => { o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; };
const box = (w, h, d, material, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); m.position.set(x, y, z); return m; };
const cyl = (rt, rb, h, seg, material, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material); m.position.set(x, y, z); return m; };
// A flat ground rectangle from (x0, z0) to (x1, z1).
function groundRect(x0, z0, x1, z1, material) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2), material);
  m.position.set((x0 + x1) / 2, 0.05, (z0 + z1) / 2); m.receiveShadow = true;
  return m;
}
// A ground strip from a to b, `w` wide (paths).
function groundStrip(a, b, w, material) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len).rotateX(-Math.PI / 2), material);
  m.position.set((a[0] + b[0]) / 2, 0.05, (a[1] + b[1]) / 2);
  m.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]);
  m.receiveShadow = true;
  return m;
}

const M = {
  wood: flat(0x8a6038), darkWood: flat(0x5e3f24), paleWood: flat(0xb08a5a),
  stone: flat(0x9aa0a6), darkStone: flat(0x6f767d), water: flat(0x4f8fc0, { roughness: 0.3 }),
  hay: flat(0xd9b45a), hayDark: flat(0xb8923e), red: flat(0xb8322a), darkRed: flat(0x8a2520),
  metal: flat(0x45484e, { metalness: 0.3, roughness: 0.6 }), tyre: flat(0x26272b), hub: flat(0xd8b23a),
  glass: flat(0x9ccbe0, { roughness: 0.2 }), roof: flat(0x6a4a3a), straw: flat(0xc9a95a),
  leaf: flat(0x4f9a3a), leafDark: flat(0x3d7f2f), tassel: flat(0xe0c25a), soilRidge: flat(0x5f4128),
  burlap: flat(0xc8a878), robe: flat(0x5a3a9a), hat: flat(0x3d2a7a), star: flat(0xffd85a, { emissive: 0x6a5010 }),
};

export function buildWorld(scene) {
  scene.background = new THREE.Color(0x9fc8e8);
  scene.fog = new THREE.Fog(0x9fc8e8, 60, 175);

  const hemi = new THREE.HemisphereLight(0xdfefff, 0x5a7a46, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d8, 2.2);
  sun.position.set(30, 50, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // covers the whole arena plus the farmhouse roof and the rim
  sun.shadow.camera.left = -50; sun.shadow.camera.right = 50;
  sun.shadow.camera.top = 50; sun.shadow.camera.bottom = -50;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 130;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  // Ground: a big grid, flat inside the arena and rising into rolling hills outside it.
  const groundGeo = new THREE.PlaneGeometry(240, 240, 72, 72);
  groundGeo.rotateX(-Math.PI / 2);
  {
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, groundHeight(x, z));
    }
    groundGeo.computeVertexNormals();
  }
  const ground = new THREE.Mesh(groundGeo, flat(0x6fae55));
  ground.receiveShadow = true;
  scene.add(ground);

  // Meadow floor inside the rim, a little lusher than the hills.
  const floor = new THREE.Mesh(new THREE.CircleGeometry(C.ARENA_RADIUS + 0.5, 48).rotateX(-Math.PI / 2), decal(0x79b45c, 1));
  floor.position.y = 0.05; floor.receiveShadow = true;
  scene.add(floor);

  // Packed-earth courtyard in front of the house, with paths to the door, the gate and the field.
  const dirt = decal(0xb79c6c, 2), path = decal(0xa88d5e, 3);
  {
    const shape = new THREE.Shape();
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const r = 15 + Math.sin(a * 3) * 1.2 + Math.sin(a * 7 + 1) * 0.6;
      const x = Math.cos(a) * r, z = Math.sin(a) * r * 1.05 + 1;
      i ? shape.lineTo(x, -z) : shape.moveTo(x, -z);
    }
    const yard = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), dirt);
    yard.position.y = 0.05; yard.receiveShadow = true;
    scene.add(yard);
  }
  scene.add(groundStrip([0, 12], [0, C.FARMHOUSE.z - 4], 3.2, path));
  scene.add(groundStrip([11, C.PEN.gateOut[1]], [C.PEN.x0 + 0.5, C.PEN.gateOut[1]], 2.8, path));
  scene.add(groundStrip([-12, 4], [C.FIELD.x1 + 0.3, 3], 2.4, path));
  scene.add(groundStrip([0, -12], [0, -C.ARENA_RADIUS + 2], 2.6, path));
  // cobbles around the well
  const cobble = new THREE.Mesh(new THREE.RingGeometry(C.WELL.r + 0.1, C.WELL.r + 1.4, 14).rotateX(-Math.PI / 2), decal(0x8d9196, 4));
  cobble.position.set(C.WELL.x, 0.05, C.WELL.z); cobble.receiveShadow = true;
  scene.add(cobble);

  // Arena rim: a ring of low stones.
  const rimMat = flat(0x7d8792);
  for (let i = 0; i < 52; i++) {
    const a = (i / 52) * Math.PI * 2;
    const r = C.ARENA_RADIUS + 1.2;
    const s = 0.8 + Math.random() * 0.8;
    const stone = new THREE.Mesh(jitterGeometry(new THREE.DodecahedronGeometry(s, 0), 0.25), rimMat);
    stone.position.set(Math.cos(a) * r, s * 0.4, Math.sin(a) * r);
    stone.rotation.set(Math.random(), Math.random(), Math.random());
    stone.castShadow = stone.receiveShadow = true;
    scene.add(stone);
  }

  buildRunePillars(scene);
  buildTrees(scene);
  buildPen(scene);
  buildField(scene);
  standin('tractor', makeTractor(), C.TRACTOR, scene);
  standin('well', makeWell(), C.WELL, scene);
  standin('cart', makeCart(), C.CART, scene);
  standin('scarecrow', makeScarecrow(), C.SCARECROW, scene);
  for (const [x, z] of C.HAY_STACKS) standin('haystack', makeHayStack(), { x, z, yaw: Math.random() * Math.PI }, scene);

  // Scatter some tufts outside the arena for depth
  const tuftMat = flat(0x5d9a48);
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = C.ARENA_RADIUS + 4 + Math.random() * 40;
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.4 + Math.random() * 0.5, 0.6 + Math.random() * 0.8, 4), tuftMat);
    m.position.set(Math.cos(a) * r, groundHeight(Math.cos(a) * r, Math.sin(a) * r) + 0.2, Math.sin(a) * r);
    scene.add(m);
  }

  // Distant mountains
  const mtnMat = flat(0x6a7fa0);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + Math.random() * 0.2;
    const r = 86 + Math.random() * 14;
    const h = 20 + Math.random() * 24;
    const m = new THREE.Mesh(new THREE.ConeGeometry(14 + Math.random() * 10, h, 5), mtnMat);
    m.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r);
    scene.add(m);
  }

  return { sun };
}

export const spinners = [];

// ------------------------------------------------------------ stand-ins
// Every farm piece is a group placed at {x, z, yaw}. When its Meshy model loads, swapModel()
// replaces the procedural children in place.
const standins = {};   // name -> [group]
function standin(name, obj, at, scene) {
  const g = new THREE.Group();
  g.add(shadowy(obj));
  g.position.set(at.x, 0, at.z);
  g.rotation.y = at.yaw || 0;
  scene.add(g);
  (standins[name] ??= []).push(g);
  return g;
}
function swapModel(name, model) {
  for (const g of standins[name] || []) {
    g.clear();
    g.add(model.clone());
  }
}

function buildRunePillars(scene) {
  const pillarMat = flat(0xa9b0b8), pillarTop = flat(0x8d949c);
  const runeMat = new THREE.MeshStandardMaterial({ color: 0x9d6bff, emissive: 0x6a35ff, emissiveIntensity: 1.2, flatShading: true });
  for (const p of C.PILLARS) {
    const g = new THREE.Group();
    const body = cyl(p.r * 0.85, p.r, p.h, 7, pillarMat, 0, p.h / 2);
    const cap = cyl(p.r * 1.1, p.r * 0.85, 0.5, 7, pillarTop, 0, p.h + 0.25);
    const base = cyl(p.r * 1.15, p.r * 1.25, 0.4, 7, pillarTop, 0, 0.2);
    // glowing rune band
    const band = cyl(p.r * 0.93, p.r * 0.95, 0.18, 7, runeMat, 0, p.h * 0.62);
    g.add(body, cap, base, band);
    g.position.set(p.x, 0, p.z);
    g.rotation.y = Math.random() * Math.PI;
    scene.add(shadowy(g));
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), runeMat);
    crystal.position.set(p.x, p.h + 1.3, p.z);
    scene.add(crystal);
    spinners.push(crystal);
  }
}

function buildTrees(scene) {
  const trunkMat = flat(0x7a5230);
  const leafMats = [flat(0x3f8f4f), flat(0x4ea35a), flat(0x2f7a45)];
  for (const t of C.TREES) {
    const g = new THREE.Group();
    g.add(cyl(0.25, 0.4, 2.2, 6, trunkMat, 0, 1.1));
    let y = 2.0;
    for (let i = 0; i < 3; i++) {
      const r = 2.2 - i * 0.55;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, 2.2, 6), leafMats[i % leafMats.length]);
      cone.position.y = y + 1.1;
      g.add(cone);
      y += 1.3;
    }
    g.position.set(t.x, 0, t.z);
    g.rotation.y = Math.random() * Math.PI * 2;
    g.scale.setScalar(0.9 + Math.random() * 0.4);
    scene.add(shadowy(g));
  }
}

// ------------------------------------------------------------ goat pen
function buildPen(scene) {
  const P = C.PEN;
  scene.add(groundRect(P.x0, P.z0, P.x1, P.z1, decal(0xa8a060, 2)));
  // straw scattered in the pen
  for (let i = 0; i < 40; i++) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.6 + Math.random(), 0.4 + Math.random() * 0.6).rotateX(-Math.PI / 2), decal(0xd2b56a, 3));
    s.position.set(P.x0 + 1 + Math.random() * (P.x1 - P.x0 - 2), 0.05, P.z0 + 1 + Math.random() * (P.z1 - P.z0 - 2));
    s.rotation.y = Math.random() * Math.PI;
    scene.add(s);
  }

  // Pickets on every collider post along the fence segments, two rails per segment.
  const posts = [];
  for (const [a, b] of C.FENCE_SEGMENTS) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.ceil(len / P.postSpacing);
    for (let i = 0; i <= n; i++) posts.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
    for (const y of [0.36, 0.74]) {
      const rail = box(0.08, 0.12, len + 0.1, M.wood, (a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2);
      rail.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]);
      scene.add(shadowy(rail));
    }
  }
  const pickets = new THREE.InstancedMesh(new THREE.BoxGeometry(0.11, 0.92, 0.11).translate(0, 0.46, 0), M.paleWood, posts.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
  posts.forEach(([x, z], i) => {
    q.setFromEuler(e.set((Math.random() - 0.5) * 0.06, Math.random() * 0.5, (Math.random() - 0.5) * 0.06));
    pickets.setMatrixAt(i, m4.compose(v.set(x, 0, z), q, s.set(1, 0.9 + Math.random() * 0.15, 1)));
  });
  shadowy(pickets);
  scene.add(pickets);

  // Gate: two stout posts and the leaf standing open.
  for (const z of [P.gate.z0, P.gate.z1]) scene.add(shadowy(box(0.24, 1.3, 0.24, M.darkWood, P.x0, 0.65, z)));
  const leaf = new THREE.Group();
  const L = C.GATE_LEAF.len;
  for (const y of [0.25, 0.55, 0.85]) leaf.add(box(0.07, 0.12, L, M.wood, 0, y, L / 2));
  leaf.add(box(0.08, 0.95, 0.1, M.wood, 0, 0.5, L - 0.05));
  const brace = box(0.06, 0.1, Math.hypot(L, 0.6), M.wood, 0, 0.55, L / 2); brace.rotation.x = Math.atan2(0.6, L); leaf.add(brace);
  leaf.position.set(C.GATE_LEAF.hinge[0], 0, C.GATE_LEAF.hinge[1]);
  leaf.rotation.y = Math.atan2(C.GATE_LEAF.dir[0], C.GATE_LEAF.dir[1]);
  scene.add(shadowy(leaf));

  standin('shelter', makeShelter(), C.SHELTER, scene);
  standin('trough', makeTrough(), C.TROUGH, scene);
}

function makeShelter() {
  // Lean-to facing +z: open front, tall at the front, low at the back.
  const g = new THREE.Group(), w = C.SHELTER.w, d = C.SHELTER.d;
  for (const x of [-w / 2 + 0.1, w / 2 - 0.1]) {
    g.add(box(0.16, 2.4, 0.16, M.darkWood, x, 1.2, d / 2 - 0.1));
    g.add(box(0.16, 1.6, 0.16, M.darkWood, x, 0.8, -d / 2 + 0.1));
    g.add(box(0.1, 1.5, d - 0.2, M.wood, x, 0.85, 0));                   // side boards
  }
  g.add(box(w, 1.5, 0.1, M.wood, 0, 0.8, -d / 2 + 0.1));                   // back wall
  const roof = box(w + 0.4, 0.12, d + 0.6, M.roof, 0, 2.05, 0.1);
  roof.rotation.x = Math.atan2(0.85, d); g.add(roof);
  for (let i = 0; i < 3; i++) g.add(cyl(0.45, 0.5, 0.7, 9, M.hay, -1 + i * 0.95, 0.35, -0.5));   // hay inside
  return g;
}

function makeTrough() {
  const g = new THREE.Group(), L = C.TROUGH.len;
  g.add(box(0.9, 0.12, L, M.darkWood, 0, 0.18, 0));
  for (const x of [-0.42, 0.42]) g.add(box(0.08, 0.55, L, M.wood, x, 0.45, 0));
  for (const z of [-L / 2, L / 2]) g.add(box(0.9, 0.55, 0.08, M.wood, 0, 0.45, z));
  g.add(box(0.76, 0.05, L - 0.12, M.water, 0, 0.6, 0));
  for (const z of [-L / 2 + 0.25, L / 2 - 0.25]) for (const x of [-0.38, 0.38]) g.add(box(0.1, 0.2, 0.1, M.darkWood, x, 0.06, z));
  return g;
}

// ------------------------------------------------------------ crop field
// One instance per crop collider; trampled crops lie flat and stand back up after a while.
const crops = { mesh: null, tops: null, base: [], flatUntil: null, flatAmt: null, dirty: false, lastT: 0 };
function buildField(scene) {
  const F = C.FIELD;
  scene.add(groundRect(F.x0 - 0.6, F.z0 - 0.8, F.x1 + 0.6, F.z1 + 0.8, decal(0x7a5636, 2)));
  for (const row of C.CROP_ROWS) {
    const ridge = box(1.0, 0.18, row.z1 - row.z0 + 1.0, M.soilRidge, row.x, 0.06, (row.z0 + row.z1) / 2);
    ridge.receiveShadow = true; scene.add(ridge);
  }
  // corn-like plants: a leafy cone with a golden tassel
  const n = C.CROPS.length;
  crops.mesh = new THREE.InstancedMesh(jitterGeometry(new THREE.ConeGeometry(0.42, 1.0, 6, 2).translate(0, 0.5, 0), 0.08), M.leaf, n);
  crops.tops = new THREE.InstancedMesh(new THREE.ConeGeometry(0.12, 0.35, 4).translate(0, 1.12, 0), M.tassel, n);
  crops.flatUntil = new Float32Array(n); crops.flatAmt = new Float32Array(n);
  C.CROPS.forEach(([x, z], i) => {
    crops.base.push({ x: x + (Math.random() - 0.5) * 0.12, z: z + (Math.random() - 0.5) * 0.12, yaw: Math.random() * Math.PI * 2, s: 0.85 + Math.random() * 0.3 });
  });
  for (let i = 0; i < n; i++) setCrop(i, 0);
  shadowy(crops.mesh); crops.tops.castShadow = true;
  scene.add(crops.mesh, crops.tops);
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function setCrop(i, flatK) {
  const b = crops.base[i];
  _q.setFromEuler(_e.set(flatK * 1.35, b.yaw, 0, 'YXZ'));
  _m.compose(_v.set(b.x, 0.12, b.z), _q, _s.set(b.s, b.s * (1 - flatK * 0.3), b.s));
  crops.mesh.setMatrixAt(i, _m); crops.tops.setMatrixAt(i, _m);
  crops.dirty = true;
}

// Flatten crops within `r` of (x, z): a charging goat, an explosion. Visual only.
export function trampleCrops(x, z, r) {
  if (!crops.mesh || x > C.FIELD.x1 + r + 1 || x < C.FIELD.x0 - r - 1) return;
  const t = performance.now() / 1000;
  C.CROPS.forEach(([cx, cz], i) => {
    if (Math.hypot(cx - x, cz - z) < r) crops.flatUntil[i] = t + 9 + Math.random() * 4;
  });
}
// Animate flattening and regrowth. Safe to call several times per frame (uses wall time).
export function updateCrops() {
  if (!crops.mesh) return;
  const t = performance.now() / 1000, dt = Math.min(0.1, t - crops.lastT);
  if (dt <= 0) return;
  crops.lastT = t;
  for (let i = 0; i < crops.base.length; i++) {
    const want = t < crops.flatUntil[i] ? 1 : 0, cur = crops.flatAmt[i];
    if (cur === want) continue;
    const next = want ? Math.min(1, cur + dt * 8) : Math.max(0, cur - dt * 0.5);
    crops.flatAmt[i] = next; setCrop(i, next);
  }
  if (crops.dirty) { crops.mesh.instanceMatrix.needsUpdate = true; crops.tops.instanceMatrix.needsUpdate = true; crops.dirty = false; }
}

function makeScarecrow() {
  const g = new THREE.Group();
  g.add(cyl(0.06, 0.07, 2.3, 5, M.darkWood, 0, 1.15));
  g.add(box(1.6, 0.08, 0.08, M.darkWood, 0, 1.65, 0));
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.2, 7), M.robe); robe.position.y = 1.25; g.add(robe);
  for (const x of [-0.55, 0.55]) g.add(box(0.5, 0.22, 0.22, M.robe, x, 1.65, 0));
  for (const x of [-0.85, 0.85]) { const tuft = cyl(0.02, 0.09, 0.25, 5, M.straw, x, 1.65, 0); tuft.rotation.z = Math.sign(x) * Math.PI / 2; g.add(tuft); }
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 0), M.burlap); head.position.y = 2.1; g.add(head);
  const brim = cyl(0.42, 0.42, 0.04, 10, M.hat, 0, 2.27); g.add(brim);
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.7, 8), M.hat); hat.position.set(0, 2.62, -0.04); hat.rotation.x = -0.25; g.add(hat);
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), M.star); star.position.set(0, 2.5, 0.2); g.add(star);
  return g;
}

// ------------------------------------------------------------ courtyard pieces
function makeTractor() {
  // Faces +z. About 4.2 m long, 2.3 m wide, 2.9 m to the cab roof.
  const g = new THREE.Group();
  g.add(box(1.0, 0.7, 3.4, M.red, 0, 1.0, 0.2));                          // chassis
  g.add(box(1.1, 0.75, 1.7, M.red, 0, 1.55, 1.0));                        // hood
  g.add(box(1.14, 0.1, 1.74, M.darkRed, 0, 1.95, 1.0));
  g.add(box(1.0, 0.6, 0.12, M.metal, 0, 1.4, 1.9));                       // grille
  g.add(cyl(0.07, 0.07, 1.1, 6, M.metal, 0.35, 2.4, 1.3));                 // exhaust
  g.add(cyl(0.1, 0.07, 0.15, 6, M.metal, 0.35, 2.98, 1.3));
  // cab
  for (const x of [-0.7, 0.7]) for (const z of [-1.3, -0.1]) g.add(box(0.08, 1.3, 0.08, M.metal, x, 2.15, z));
  g.add(box(1.7, 0.1, 1.5, M.red, 0, 2.85, -0.7));
  g.add(box(1.3, 0.85, 0.05, M.glass, 0, 2.2, -0.1));
  g.add(box(0.6, 0.12, 0.6, M.tyre, 0, 1.5, -0.8));                        // seat
  g.add(box(0.6, 0.6, 0.1, M.tyre, 0, 1.8, -1.1));
  const wheel = (r, w, x, z) => {
    const t = cyl(r, r, w, 14, M.tyre, x, r, z); t.rotation.z = Math.PI / 2; g.add(t);
    const h = cyl(r * 0.5, r * 0.5, w + 0.04, 10, M.hub, x, r, z); h.rotation.z = Math.PI / 2; g.add(h);
  };
  wheel(0.88, 0.5, -0.95, -0.9); wheel(0.88, 0.5, 0.95, -0.9);
  wheel(0.48, 0.32, -0.75, 1.45); wheel(0.48, 0.32, 0.75, 1.45);
  for (const x of [-0.95, 0.95]) g.add(box(0.6, 0.08, 1.4, M.red, x, 1.85, -0.9));   // mudguards
  return g;
}

function makeWell() {
  const g = new THREE.Group(), r = C.WELL.r;
  const ring = new THREE.Mesh(jitterGeometry(new THREE.CylinderGeometry(r, r + 0.05, 0.95, 10, 2, true), 0.05), M.stone);
  ring.material.side = THREE.DoubleSide; ring.position.y = 0.47; g.add(ring);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(r - 0.05, 0.13, 5, 12).rotateX(Math.PI / 2), M.darkStone); lip.position.y = 0.95; g.add(lip);
  const water = new THREE.Mesh(new THREE.CircleGeometry(r - 0.1, 12).rotateX(-Math.PI / 2), M.water); water.position.y = 0.5; g.add(water);
  for (const x of [-r + 0.1, r - 0.1]) g.add(box(0.14, 2.3, 0.14, M.darkWood, x, 1.15, 0));
  for (const s of [-1, 1]) {
    const roof = box(1.3, 0.08, 2 * r + 0.8, M.roof, s * 0.55, 2.5, 0);
    roof.rotation.z = -s * 0.65; g.add(roof);
  }
  const axle = cyl(0.06, 0.06, 2 * r, 6, M.wood, 0, 1.85, 0); axle.rotation.z = Math.PI / 2; g.add(axle);
  g.add(cyl(0.004, 0.004, 0.9, 3, M.darkWood, 0, 1.4, 0));
  g.add(cyl(0.16, 0.13, 0.25, 7, M.wood, 0, 0.95, 0));                     // bucket
  return g;
}

function makeCart() {
  const g = new THREE.Group();
  g.add(box(1.4, 0.12, 2.2, M.wood, 0, 0.75, 0));
  for (const x of [-0.68, 0.68]) g.add(box(0.06, 0.4, 2.2, M.paleWood, x, 0.98, 0));
  for (const z of [-1.08, 1.08]) g.add(box(1.4, 0.4, 0.06, M.paleWood, 0, 0.98, z));
  for (const x of [-0.85, 0.85]) {
    const w = cyl(0.55, 0.55, 0.1, 10, M.darkWood, x, 0.55, -0.2); w.rotation.z = Math.PI / 2; g.add(w);
    g.add(box(0.06, 0.06, 1.3, M.wood, x * 0.5, 0.75, 1.7));               // handles
  }
  g.add(box(0.12, 0.6, 0.12, M.darkWood, 0, 0.35, 0.95));
  const pile = new THREE.Mesh(jitterGeometry(new THREE.DodecahedronGeometry(0.75, 0), 0.2), M.hay);
  pile.scale.set(0.9, 0.6, 1.3); pile.position.y = 1.25; g.add(pile);
  return g;
}

function makeHayStack() {
  const g = new THREE.Group();
  g.add(cyl(0.85, 0.85, 1.65, 12, M.hay, 0, 0.83, 0));
  g.add(cyl(0.8, 0.86, 0.08, 12, M.hayDark, 0, 1.66, 0));
  for (const y of [0.45, 1.2]) g.add(cyl(0.87, 0.87, 0.06, 12, M.hayDark, 0, y, 0));
  return g;
}

// ------------------------------------------------------------ Meshy models
// Optimised copies of the Meshy exports (see tools/optimize-models.sh). Each is a single textured
// mesh centred on the origin, about one unit tall, facing +z.
export const models = { goat: null, potion: null, farmhouse: null };

// Scale a model to `height` metres with its base on y = 0, centred on x/z.
function fitModel(gltf, height) {
  const root = gltf.scene;
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const bb = new THREE.Box3().setFromObject(root);
  const k = height / (bb.max.y - bb.min.y);
  root.scale.setScalar(k);
  root.position.set(-(bb.min.x + bb.max.x) / 2 * k, -bb.min.y * k, -(bb.min.z + bb.max.z) / 2 * k);
  const holder = new THREE.Group();
  holder.add(root);
  return holder;
}

// Farm pieces with a Meshy model: [stand-in name, url, height in metres]. A model that fails to load
// leaves its procedural stand-in in place.
const FARM_MODELS = [];

export function loadModels(loader, scene) {
  const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));
  return Promise.all([
    load('/models/goat.glb').then(g => { models.goat = fitModel(g, 1.25); }),
    load('/models/potion.glb').then(g => { models.potion = fitModel(g, C.PROP_TYPES.potion.h); }),
    load('/models/farmhouse.glb').then(g => {
      // The wizard's farmhouse on the north side of the courtyard, front door facing the well.
      const house = fitModel(g, C.FARMHOUSE.height);
      house.position.set(C.FARMHOUSE.x, 0, C.FARMHOUSE.z);
      house.rotation.y = C.FARMHOUSE.yaw;
      house.traverse(o => { if (o.isMesh) o.receiveShadow = false; });
      scene.add(house);
      models.farmhouse = house;
    }),
    ...FARM_MODELS.map(([name, url, h]) => load(url).then(g => { models[name] = fitModel(g, h); swapModel(name, models[name]); }, () => {})),
  ]);
}

// ------------------------------------------------------------ props
const propMats = {};
function mat(color) { return propMats[color] ??= flat(color); }

export function makePropMesh(type) {
  const spec = C.PROP_TYPES[type];
  const g = new THREE.Group();
  let m;
  switch (type) {
    case 'crate': {
      m = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 1.0), mat(spec.color));
      m.position.y = 0.5;
      g.add(m);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.12, 1.06), mat(0x8a5f2e));
      edge.position.y = 0.5; g.add(edge);
      const edge2 = edge.clone(); edge2.rotation.z = Math.PI / 2; g.add(edge2);
      break;
    }
    case 'barrel': {
      m = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.15, 8), mat(spec.color));
      m.position.y = 0.575; g.add(m);
      for (const y of [0.25, 0.9]) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.1, 8), mat(0x4a4a52));
        band.position.y = y; g.add(band);
      }
      break;
    }
    case 'pumpkin': {
      m = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), mat(spec.color));
      m.scale.set(1, 0.75, 1); m.position.y = 0.38; g.add(m);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.3, 5), mat(0x5a8a3a));
      stem.position.y = 0.8; g.add(stem);
      break;
    }
    case 'rock': {
      m = new THREE.Mesh(jitterGeometry(new THREE.DodecahedronGeometry(0.6, 0), 0.2), mat(spec.color));
      m.position.y = 0.5; m.rotation.set(0.3, 0.6, 0.1); g.add(m);
      break;
    }
    case 'potion': {
      g.add(models.potion ? models.potion.clone() : new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, spec.h, 8), mat(spec.color)));
      if (!models.potion) g.children[0].position.y = spec.h / 2;
      break;
    }
    case 'hay': {
      // a small round bale lying on its side
      if (models.hay) { g.add(models.hay.clone()); break; }
      const r = spec.h / 2;
      m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.95, 12), mat(spec.color));
      m.rotation.z = Math.PI / 2; m.position.y = r; g.add(m);
      for (const x of [-0.25, 0.25]) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.02, r + 0.02, 0.05, 12), mat(0xb8923e));
        band.rotation.z = Math.PI / 2; band.position.set(x, r, 0); g.add(band);
      }
      break;
    }
    case 'pot': {
      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        pts.push(new THREE.Vector2(0.15 + Math.sin(t * Math.PI) * 0.32 + (t > 0.85 ? 0.05 : 0), t * 0.9));
      }
      m = new THREE.Mesh(new THREE.LatheGeometry(pts, 8), mat(spec.color));
      g.add(m);
      break;
    }
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.type = type;
  return g;
}

// Pieces thrown around when a prop breaks.
export function makeFragments(type, count = 8) {
  const spec = C.PROP_TYPES[type];
  const out = [];
  for (let i = 0; i < count; i++) {
    const s = 0.12 + Math.random() * 0.22;
    const geo = i % 2 ? new THREE.TetrahedronGeometry(s, 0) : new THREE.BoxGeometry(s, s, s);
    const m = new THREE.Mesh(geo, mat(spec.color));
    m.castShadow = true;
    out.push(m);
  }
  return out;
}
