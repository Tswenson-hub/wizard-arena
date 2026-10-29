// Low-poly farmstead: ground, farmhouse, farmyard, goat pen, crop field, tractor, the altar and its
// blast site, trees, and prop mesh factories. Layout data lives in shared/map.js; this file only draws it.
// Farm pieces are procedural stand-ins until a Meshy model for them is loaded (see loadModels).
import * as THREE from 'three';
import * as C from '../shared/constants.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

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

// The painted sky (textures/sky.jpg, baked from Ty's Meshy panorama by tools/make-sky.py): an equirectangular
// background with the horizon at the middle row, its sunbeams rolled to the sun's bearing. The fog fades the
// hills and mountains into its horizon colour.
export const SKY = { horizon: 0x48d7f2, fog: 0x7cc9de };
export function buildWorld(scene) {
  scene.background = new THREE.Color(SKY.horizon);
  new THREE.TextureLoader().load('/textures/sky.jpg', (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    scene.background = tex;
  });
  scene.fog = new THREE.Fog(SKY.fog, 60, 175);

  // a cool blue sky light and warm sunbeams, as in the painting
  const hemi = new THREE.HemisphereLight(0xd6efff, 0x5a7a46, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe9c4, 2.3);
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

  // Packed-earth farmyard in front of the house, with paths to the door, the barn, the gate and the field,
  // and the old way south past the altar, through the archway into the meadow.
  const dirt = decal(0xb79c6c, 2), path = decal(0xa88d5e, 3);
  {
    const shape = new THREE.Shape();
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const k = 1 + Math.sin(a * 3) * 0.07 + Math.sin(a * 7 + 1) * 0.04;
      const x = Math.cos(a) * 12.5 * k, z = Math.sin(a) * 8.5 * k + 13;
      i ? shape.lineTo(x, -z) : shape.moveTo(x, -z);
    }
    const yard = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), dirt);
    yard.position.y = 0.05; yard.receiveShadow = true;
    scene.add(yard);
  }
  for (const [a, b, w] of PATHS) scene.add(groundStrip(a, b, w, path));
  // cobbles around the well
  const cobble = new THREE.Mesh(new THREE.RingGeometry(C.WELL.r + 0.1, C.WELL.r + 1.4, 14).rotateX(-Math.PI / 2), decal(0x8d9196, 4));
  cobble.position.set(C.WELL.x, 0.05, C.WELL.z); cobble.receiveShadow = true;
  scene.add(cobble);

  // Arena rim: a ring of low stones (procedural until the Meshy rocks load, see SCATTER).
  const rimMat = flat(0x7d8792);
  const rim = standin('rimStones', new THREE.Group(), { x: 0, z: 0 }, scene);
  for (let i = 0; i < 52; i++) {
    const a = (i / 52) * Math.PI * 2;
    const r = C.ARENA_RADIUS + 1.2;
    const s = 0.8 + Math.random() * 0.8;
    const stone = new THREE.Mesh(jitterGeometry(new THREE.DodecahedronGeometry(s, 0), 0.25), rimMat);
    stone.position.set(Math.cos(a) * r, s * 0.4, Math.sin(a) * r);
    stone.rotation.set(Math.random(), Math.random(), Math.random());
    stone.castShadow = stone.receiveShadow = true;
    rim.add(stone);
  }

  buildBlastSite(scene);
  buildHighGround(scene);
  buildRunePillars(scene);
  buildTrees(scene);
  buildPen(scene);
  buildField(scene);
  standin('tractor', makeTractor(), C.TRACTOR, scene);
  standin('well', makeWell(), C.WELL, scene);
  standin('cart', makeCart(), C.CART, scene);
  standin('archway', makeArchway(), C.ARCHWAY, scene);
  standin('obelisk', makeObelisk(), C.OBELISK, scene);
  standin('scarecrow', makeScarecrow(), C.SCARECROW, scene);
  standin('barn', makeBarn(), C.BARN, scene);
  standin('silo', makeSilo(), C.SILO, scene);
  for (const [x, z] of C.HAY_STACKS) standin('haystack', makeHayStack(), { x, z, yaw: Math.random() * Math.PI }, scene);
  // the silo's cracked footing, where it stood before the blast
  {
    const F = C.SILO_FOOTING, g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CircleGeometry(F.r + 0.3, 14).rotateX(-Math.PI / 2), decal(0x8d9196, 4)));
    for (let i = 0; i < 9; i++) {
      if (i === 2 || i === 3) continue;   // broken open on the side it fell toward
      const a = (i / 9) * Math.PI * 2, piece = box(1.2, 0.3 + (i % 3) * 0.08, 0.35, M.darkStone, Math.cos(a) * F.r, 0.15, Math.sin(a) * F.r);
      piece.rotation.y = -a + Math.PI / 2; g.add(piece);
    }
    standin('siloFooting', g, { x: F.x, z: F.z, yaw: C.SILO.yaw }, scene);
  }

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

// Paths: [from, to, width]. Drawn as ground strips; the grass keeps off them.
const PATHS = [
  [[0, 8], [0, C.FARMHOUSE.z - 4], 3.2],                        // the door
  [[8, 7.5], [C.PEN.x0 + 0.4, C.PEN.gateOut[1]], 2.6],          // the pen gate
  [[-10, 10], [C.FIELD.x1 + 0.3, 8.5], 2.4],                     // the field
  [[0, 8], [0, -C.ARENA_RADIUS + 2], 2.6],                       // south past the altar, through the arch
  [[9, 9.5], [14.6, 13.4], 2.6],                                 // the barn arch
  [[12.6, 22], [1.6, 20.6], 2.4],                                // the barn's side door to the house path
];

// ------------------------------------------------------------ stand-ins
// Every farm piece is a group placed at {x, z, yaw}. When its Meshy model loads, swapModel()
// replaces the procedural children in place.
const standins = {};   // name -> [group]
function standin(name, obj, at, scene) {
  const g = new THREE.Group();
  g.add(shadowy(obj));
  g.position.set(at.x, -(at.sink || 0), at.z);
  // yaw, then a lean of `tilt` toward the model's +z (away from the altar for the blast pieces)
  g.rotation.set(at.tilt || 0, at.yaw || 0, 0, 'YXZ');
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
  for (const p of C.PILLARS) {
    // procedural stand-in until models/rune_pillar.glb loads
    const g = new THREE.Group();
    g.add(cyl(p.r * 0.7, p.r * 0.85, p.h, 7, pillarMat, 0, p.h / 2), cyl(p.r * 1.1, p.r * 1.2, 0.4, 7, pillarTop, 0, 0.2));
    g.add(cyl(p.r * 0.75, p.r * 0.78, 0.18, 7, runeMat, 0, p.h * 0.62));
    standin('pillar', g, p, scene);
    // the crystal floats over the top of the leaning pillar
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), runeMat), up = C.PILLAR_HEIGHT + 0.9;
    crystal.position.set(p.x + Math.sin(p.yaw) * Math.sin(p.tilt) * up, Math.cos(p.tilt) * up, p.z + Math.cos(p.yaw) * Math.sin(p.tilt) * up);
    scene.add(crystal);
    spinners.push(crystal);
  }
}
const runeMat = new THREE.MeshStandardMaterial({ color: 0x9d6bff, emissive: 0x6a35ff, emissiveIntensity: 1.2, flatShading: true });

// ------------------------------------------------------------ the altar and the blast site
// Scorched, cracked ground round the altar, broken flagstones pushed outward, the split altar with its
// crystal, the two fallen pillars and the furrow the obelisk ploughed. Stones and slabs are instanced (SCATTER).
const ruinStone = flat(0x5d625b), ruinDark = flat(0x484c47), moss = flat(0x56703f);
function buildBlastSite(scene) {
  const A = C.ALTAR, R = C.BLAST_RADIUS;
  const rnd = seeded(11);
  // scorch: dark at the centre, rays of soot running outward, a ragged edge
  {
    const cv = document.createElement('canvas'); cv.width = cv.height = 512;
    const g = cv.getContext('2d'), c = 256;
    const grad = g.createRadialGradient(c, c, 0, c, c, c);
    grad.addColorStop(0, 'rgba(30,22,18,0.92)'); grad.addColorStop(0.3, 'rgba(44,32,24,0.82)');
    grad.addColorStop(0.6, 'rgba(62,48,34,0.55)'); grad.addColorStop(0.85, 'rgba(80,66,44,0.18)'); grad.addColorStop(1, 'rgba(80,66,44,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2, r0 = c * (0.2 + rnd() * 0.2), r1 = c * (0.65 + rnd() * 0.33), w = 0.02 + rnd() * 0.05;
      g.fillStyle = `rgba(28,20,16,${0.25 + rnd() * 0.3})`;
      g.beginPath(); g.moveTo(c + Math.cos(a - w) * r0, c + Math.sin(a - w) * r0);
      g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.lineTo(c + Math.cos(a + w) * r0, c + Math.sin(a + w) * r0); g.fill();
    }
    // cracks in the ground, dark
    g.strokeStyle = 'rgba(12,8,8,0.8)'; g.lineWidth = 2.5;
    for (let i = 0; i < 16; i++) crack(g, c, rnd, 0.12, 0.55 + rnd() * 0.3);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.CircleGeometry(R, 48).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -16 }));
    m.position.set(A.x, 0.05, A.z); m.receiveShadow = true;
    scene.add(m);
    // the brightest cracks still glow violet near the altar
    const cv2 = document.createElement('canvas'); cv2.width = cv2.height = 512;
    const g2 = cv2.getContext('2d');
    g2.strokeStyle = 'rgba(190,140,255,1)'; g2.shadowColor = 'rgba(140,80,255,1)'; g2.shadowBlur = 10; g2.lineWidth = 3;
    for (let i = 0; i < 11; i++) crack(g2, c, rnd, 0.2, 0.45 + rnd() * 0.4);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(R * 0.6, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -20 }));
    glow.position.set(A.x, 0.05, A.z);
    scene.add(glow);
  }
  // the furrow the obelisk ploughed: a scar of torn earth, widening toward where it stuck
  {
    const { from, to } = C.OBELISK_FURROW;
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]), shape = new THREE.Shape(), n = 10;
    const side = (k, sgn) => [sgn * (0.3 + k * 0.35) * (0.85 + rnd() * 0.3), k * len];
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(side(i / n, 1));
    for (let i = n; i >= 0; i--) pts.push(side(i / n, -1));
    pts.forEach(([x, y], i) => i ? shape.lineTo(x, -y) : shape.moveTo(x, -y));
    const scar = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), decal(0x5a3f28, 5));
    scar.position.set(from[0], 0.05, from[1]); scar.rotation.y = Math.atan2(to[0] - from[0], to[1] - from[1]);
    scar.receiveShadow = true; scene.add(scar);
  }
  // the altar: a low round dais, the split slab, a crystal over it
  const altar = new THREE.Group();
  altar.add(cyl(3.0, 3.15, 0.14, 10, ruinDark, 0, 0.07), cyl(2.15, 2.3, 0.16, 10, ruinStone, 0, 0.22));
  altar.add(box(1.9, 0.78, 1.1, ruinDark, 0, 0.68, 0));
  for (const s of [-1, 1]) {
    const half = box(1.17, 0.24, 1.45, ruinStone, s * 0.66, 1.18, 0);
    half.rotation.z = -s * 0.07; half.rotation.y = s * 0.04; altar.add(half);
    altar.add(box(0.06, 0.5, 0.7, runeMat, s * 0.96, 0.7, 0));             // runes on the ends
  }
  altar.add(box(0.1, 0.32, 1.38, runeMat, 0, 1.1, 0));                       // light through the split
  for (const z of [-0.56, 0.56]) altar.add(box(1.4, 0.06, 0.04, runeMat, 0, 0.75, z));
  standin('altar', altar, { x: A.x, z: A.z }, scene);
  const heart = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 0), runeMat);
  heart.scale.set(0.75, 1.6, 0.75); heart.position.set(A.x, 2.5, A.z);
  scene.add(heart); spinners.push(heart);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + 0.4, shard = new THREE.Mesh(new THREE.TetrahedronGeometry(0.16, 0), runeMat);
    shard.position.set(A.x + Math.cos(a) * 0.9, 1.9 + (i % 2) * 0.55, A.z + Math.sin(a) * 0.9);
    shard.rotation.set(a, a * 2, 0); scene.add(shard); spinners.push(shard);
  }
  // flagstones round the dais, heaved up and pushed outward
  const flags = new THREE.Group();
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + rnd() * 0.15, d = 3.5 + rnd() * 1.6 + (i % 3) * 0.4;
    const f = box(0.8 + rnd() * 0.4, 0.12, 0.55 + rnd() * 0.25, i % 4 ? ruinStone : ruinDark, Math.sin(a) * d, 0.04, Math.cos(a) * d);
    f.rotation.set(-0.08 - rnd() * 0.25, a, (rnd() - 0.5) * 0.2, 'YXZ');      // the inner edge lifted
    flags.add(f);
  }
  standin('flagstones', flags, { x: A.x, z: A.z }, scene);
  for (const f of C.FALLEN_PILLARS) standin('fallenPillar', makeFallenPillar(f.len), f, scene);
}
// A crack from near the centre outward, in canvas pixels (c = centre), with a branch or two.
function crack(g, c, rnd, r0, r1) {
  let a = rnd() * Math.PI * 2, r = c * r0;
  let x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
  g.beginPath(); g.moveTo(x, y);
  while (r < c * r1) {
    r += 8 + rnd() * 14; a += (rnd() - 0.5) * 0.35;
    x = c + Math.cos(a) * r; y = c + Math.sin(a) * r; g.lineTo(x, y);
    if (rnd() < 0.08) { g.moveTo(x, y); g.lineTo(x + Math.cos(a + 0.8) * 20, y + Math.sin(a + 0.8) * 20); g.moveTo(x, y); }
  }
  g.stroke();
}
// Model space: the broken stump at the origin, the shaft lying along +z in three drums.
function makeFallenPillar(len) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(jitterGeometry(new THREE.CylinderGeometry(0.62, 0.85, 1.15, 7, 2), 0.12), ruinDark).translateY(0.55));
  g.add(cyl(0.95, 1.05, 0.3, 7, ruinStone, 0, 0.15));
  for (let i = 0; i < 6; i++) {
    const a = i * 1.1, rubble = new THREE.Mesh(jitterGeometry(new THREE.DodecahedronGeometry(0.22 + (i % 3) * 0.08, 0), 0.08), ruinStone);
    rubble.position.set(Math.cos(a) * 1.15, 0.12, Math.sin(a) * 1.15 * 0.8 - 0.2); g.add(rubble);
  }
  const drums = [len * 0.36, len * 0.32, len * 0.26];
  let z = 1.05;
  drums.forEach((l, i) => {
    const d = new THREE.Group();
    d.add(cyl(0.48, 0.5, l, 7, i === 1 ? moss : ruinStone, 0, 0, 0), cyl(0.51, 0.51, 0.14, 7, runeMat, 0, l * 0.2, 0));
    d.rotation.set(Math.PI / 2, 0, (i - 1) * 0.25);
    d.position.set((i - 1) * 0.12, 0.46, z + l / 2);
    d.rotation.y = (i - 1) * 0.1;
    g.add(d); z += l + 0.12;
  });
  const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), runeMat);
  shard.position.set(0.5, 0.25, z + 0.4); shard.rotation.set(0.9, 0.3, 0.5); g.add(shard);
  return g;
}

// ------------------------------------------------------------ the high ground (stand-ins for C.SURFACES)
// Drawn from the shared surface list, so what you see is what you stand on: boxes as solid blocks to their top,
// ramps as solid wedges. Each piece is a stand-in group ('surface:<name>') a Meshy model can replace later.
// A wedge from the ground up to a top sloping from y0 (local -z end) to y1 (+z end), w by d.
function wedgeGeometry(w, d, y0, y1) {
  const g = new THREE.BoxGeometry(w, 1, d).translate(0, 0.5, 0), pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0.5) pos.setY(i, Math.max(0.02, y0 + (y1 - y0) * (pos.getZ(i) / d + 0.5)));
  g.computeVertexNormals();
  return g;
}
const HG = {
  plank: flat(0x9a6b3f), plankDark: flat(0x6e4a2a), post: flat(0x5e3f24), hay: flat(0xd2ad55),
  ruin: flat(0x5d625b), ruinDark: flat(0x484c47), rock: flat(0x7d7f78), rockDark: flat(0x666a63),
  earth: flat(0x7a5a38), roadTop: decal(0xa88d5e, 3),
};
function buildHighGround(scene) {
  for (const sf of C.SURFACES) {
    const g = new THREE.Group(), ramp = sf.kind === 'ramp';
    const top = ramp ? Math.max(sf.y0, sf.y1) : sf.top;
    const solid = (mat, jitter = 0) => {
      const geo = ramp ? wedgeGeometry(sf.w, sf.d, sf.y0, sf.y1) : new THREE.BoxGeometry(sf.w, sf.top, sf.d).translate(0, sf.top / 2, 0);
      if (!jitter) return new THREE.Mesh(geo, mat);
      // weld the faces first so the roughening keeps the block closed; keep the footprint's outline exact at the base
      geo.deleteAttribute('normal'); geo.deleteAttribute('uv');
      const welded = mergeVertices(geo), pos = welded.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) < 0.05) continue;
        pos.setXYZ(i, pos.getX(i) + (Math.random() - 0.5) * jitter, Math.max(0.05, pos.getY(i) - Math.random() * jitter * 0.6), pos.getZ(i) + (Math.random() - 0.5) * jitter);
      }
      welded.computeVertexNormals();
      return new THREE.Mesh(welded, mat);
    };
    switch (sf.style) {
      case 'hay': {     // hay stacked up to a plank floor
        g.add(solid(HG.hay));
        g.add(box(sf.w + 0.1, 0.12, sf.d + 0.1, HG.plank, 0, top - 0.06, 0));
        for (const k of [-1, 1]) g.add(box(0.14, top, 0.14, HG.post, k * (sf.w / 2 - 0.08), top / 2, sf.d / 2 - 0.08));
        break;
      }
      case 'wood': {
        if (ramp) {      // stairs (or the loft's ladder): treads on two stringers
          const n = Math.max(4, Math.round(top / 0.28)), len = Math.hypot(sf.d, top);
          for (const k of [-1, 1]) {
            const str = box(0.1, 0.22, len, HG.post, k * (sf.w / 2 - 0.05), top / 2, 0);
            str.rotation.x = -Math.atan2(top, sf.d); g.add(str);
          }
          for (let i = 0; i < n; i++) {
            const u = (i + 0.5) / n;
            g.add(box(sf.w, 0.07, sf.d / n + 0.05, HG.plank, 0, sf.y0 + (sf.y1 - sf.y0) * u - 0.035, (u - 0.5) * sf.d));
          }
          // solid enough to read as blocking below, without hiding the treads
          const under = solid(HG.plankDark); under.scale.set(0.6, 0.98, 1); g.add(under);
        } else {         // the watchtower: four posts, a deck, a rail on three sides
          for (const [i, k] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.add(box(0.22, top + 1.1, 0.22, HG.post, i * (sf.w / 2 - 0.11), (top + 1.1) / 2, k * (sf.d / 2 - 0.11)));
          for (const [i, k] of [[-1, -1], [1, 1]]) { const br = box(0.1, top * 1.15, 0.1, HG.post, 0, top / 2, k * (sf.d / 2 - 0.11)); br.rotation.z = i * 0.62; g.add(br); }
          g.add(box(sf.w, 0.16, sf.d, HG.plank, 0, top - 0.08, 0));
          g.add(box(sf.w * 0.9, 0.06, sf.d * 0.9, HG.plankDark, 0, top * 0.45, 0));
          for (const [w, d, x, z] of [[sf.w, 0.08, 0, -sf.d / 2], [sf.w, 0.08, 0, sf.d / 2], [0.08, sf.d, -sf.w / 2, 0]]) g.add(box(w, 0.08, d, HG.plank, x, top + 0.95, z));
          // a pale shell so the box reads as solid ground for shots and movement below the deck
          const shell = solid(new THREE.MeshStandardMaterial({ color: 0x6e4a2a, transparent: true, opacity: 0.0, depthWrite: false }));
          g.add(shell);
        }
        break;
      }
      case 'stone':
        g.add(solid(HG.ruin, 0.08));
        // broken edge stones on top
        for (let i = 0; i < 5; i++) {
          const r = new THREE.Mesh(jitterGeometry(new THREE.DodecahedronGeometry(0.22 + (i % 3) * 0.08, 0), 0.06), HG.ruinDark);
          r.position.set((i / 4 - 0.5) * sf.w * 0.8, top + 0.08, (i % 2 ? 1 : -1) * sf.d * 0.38); g.add(r);
        }
        break;
      case 'pillar': {   // a toppled rune pillar lying from ledge to ledge, rubble wedged under it
        const rub = solid(HG.ruinDark, 0.1); rub.scale.set(0.85, 0.94, 1); g.add(rub);
        const len = Math.hypot(sf.d, sf.y1 - sf.y0), col = cyl(0.5, 0.5, len, 7, ruinStone, 0, (sf.y0 + sf.y1) / 2 - 0.1, 0);
        col.rotation.x = Math.PI / 2 - Math.atan2(sf.y1 - sf.y0, sf.d); g.add(col);
        for (const u of [-0.3, 0.15]) {
          const band = cyl(0.52, 0.52, 0.14, 7, runeMat, 0, (sf.y0 + sf.y1) / 2 - 0.1 + u * (sf.y1 - sf.y0), u * sf.d);
          band.rotation.x = col.rotation.x; g.add(band);
        }
        break;
      }
      case 'rock':
        g.add(solid(ramp ? HG.rockDark : HG.rock, ramp ? 0.12 : 0.18));
        break;
      case 'earth':
        g.add(solid(HG.earth, 0.05));
        { // the cart track on top
          const geo = ramp ? wedgeGeometry(sf.w * 0.6, sf.d, sf.y0 + 0.03, sf.y1 + 0.03) : new THREE.BoxGeometry(sf.w * 0.6, 0.03, sf.d).translate(0, sf.top + 0.015, 0);
          g.add(new THREE.Mesh(geo, HG.roadTop));
        }
        break;
      default:
        g.add(solid(HG.rock));
    }
    standin(`surface:${sf.name}`, g, sf, scene);
  }
}

// Procedural trees, shown only until the Meshy trees load (they become instanced meshes, see SCATTER).
function buildTrees(scene) {
  const trunkMat = flat(0x7a5230);
  const leafMats = [flat(0x3f8f4f), flat(0x4ea35a), flat(0x2f7a45)];
  const all = standin('treeStandins', new THREE.Group(), { x: 0, z: 0 }, scene);
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
    g.rotation.y = t.yaw;
    g.scale.setScalar(t.h / 7);
    all.add(shadowy(g));
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

function makeArchway() {
  const g = new THREE.Group(), stone = flat(0x7f868c);
  for (const x of [-2.13, 1.85]) g.add(box(1.3, 6.2, 1.6, stone, x, 3.1, 0));
  g.add(box(5.6, 1.2, 1.6, stone, -0.14, 6.8, 0));
  g.add(box(0.5, 0.5, 1.65, runeMat, -0.14, 6.8, 0));
  return g;
}
function makeObelisk() {
  const g = new THREE.Group(), stone = flat(0x6f767d);
  g.add(cyl(0.45, 0.8, 5.4, 4, stone, 0, 2.7), cyl(0.0, 0.45, 0.6, 4, stone, 0, 5.7));
  g.add(box(0.12, 3, 0.9, runeMat, 0, 2.6, 0.2));
  return g;
}

// Stand-ins in model space (see C.BARN / C.SILO): long along x, arch at -x, side door in the +z wall.
function makeBarn() {
  const g = new THREE.Group();
  g.add(box(10.4, 3.4, 0.2, M.wood, -2.4, 1.7, -2.4), box(3.9, 3.4, 0.2, M.wood, 4.65, 1.7, -1.5));
  g.add(box(4.2, 3.4, 0.2, M.wood, -2.2, 1.7, 1.1), box(3.5, 3.4, 0.2, M.wood, 4.85, 1.7, 1.15));
  g.add(box(0.2, 3.4, 2.7, M.wood, 6.6, 1.7, -0.2));
  for (const s of [-1, 1]) {
    const roof = box(14.6, 0.15, 3.0, M.roof, -0.5, 4.6, -0.6 + s * 1.15);
    roof.rotation.x = s * 0.6; g.add(roof);
  }
  return g;
}
function makeSilo() {
  const g = new THREE.Group();
  const body = cyl(1.8, 1.8, 10.6, 16, M.metal, -0.2, 1.8, -0.25); body.rotation.z = Math.PI / 2; g.add(body);
  return g;
}

// ------------------------------------------------------------ Meshy models
// Optimised copies of the Meshy exports (see tools/optimize-models.sh). Each is a single textured
// mesh centred on the origin, about one unit tall, facing +z.
export const models = { goat: null, potion: null, farmhouse: null };

// Scale a model to `height` metres with its base on y = 0, centred on x/z, turned by `yaw` so it faces +z.
function fitModel(gltf, height, yaw = 0) {
  const root = gltf.scene;
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const bb = new THREE.Box3().setFromObject(root);
  const k = height / (bb.max.y - bb.min.y);
  root.scale.setScalar(k);
  root.position.set(-(bb.min.x + bb.max.x) / 2 * k, -bb.min.y * k, -(bb.min.z + bb.max.z) / 2 * k);
  const holder = new THREE.Group();
  holder.add(root);
  holder.rotation.y = yaw;
  return holder;
}

// ------------------------------------------------------------ instanced scenery
// Seeded so every client draws the same scatter.
function seeded(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
// [x, z, yaw, height] per instance, by model.
// Trees outside the arena use the *_far models (about 1-1.6k triangles, sloppy-simplified, no shadows).
const SCATTER = { pine: [], oak: [], birch: [], pine_far: [], oak_far: [], birch_far: [], rock_jagged: [], rock_table: [] };
const SCATTER_STANDINS = { pine: ['treeStandins'], rock_jagged: ['rimStones'] };
for (const t of C.TREES) SCATTER[t.kind].push([t.x, t.z, t.yaw, t.h]);
// Blast debris leans away from the altar: [x, z, yaw, height, tilt, yaw of the lean, sink]
for (const [x, z, yaw, h, tilt] of C.TABLE_ROCKS) SCATTER.rock_table.push([x, z, yaw, h, tilt, C.awayYaw(x, z), h * 0.12]);
for (const [x, z, h, tilt] of C.BLAST_STONES) SCATTER.rock_jagged.push([x, z, x * 3.1 + z, h, tilt, C.awayYaw(x, z), h * 0.1]);
for (const [x, z, yaw, h, tilt] of C.BLAST_SHARDS) SCATTER.rock_jagged.push([x, z, yaw, h, tilt, C.awayYaw(x, z), 0.06]);
{
  // the rim: jagged rocks with a table rock every fourth stone
  const rnd = seeded(7);
  for (let i = 0; i < 52; i++) {
    const a = (i / 52) * Math.PI * 2, r = C.ARENA_RADIUS + 1.2 + rnd() * 0.6;
    if (i % 4 === 2) SCATTER.rock_table.push([Math.cos(a) * r, Math.sin(a) * r, rnd() * 6.3, 0.7 + rnd() * 0.5]);
    else SCATTER.rock_jagged.push([Math.cos(a) * r, Math.sin(a) * r, rnd() * 6.3, 1.0 + rnd() * 1.1]);
  }
  // outside the arena: a few oaks and birches near the rim, pines thickening toward the hills
  const out = seeded(42);
  for (let i = 0; i < 90; i++) {
    const a = out() * Math.PI * 2, r = C.ARENA_RADIUS + 5 + Math.pow(out(), 0.7) * 45;
    const near = r < C.ARENA_RADIUS + 16, pick = out();
    const kind = near ? (pick < 0.4 ? 'oak' : pick < 0.75 ? 'birch' : 'pine') : (pick < 0.85 ? 'pine' : 'birch');
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    SCATTER[kind + '_far'].push([x, z, out() * 6.3, C.TREE_KINDS[kind].h * (0.8 + out() * 0.5)]);
  }
  for (let i = 0; i < 24; i++) {
    const a = out() * Math.PI * 2, r = C.ARENA_RADIUS + 4 + out() * 30;
    SCATTER[out() < 0.6 ? 'rock_jagged' : 'rock_table'].push([Math.cos(a) * r, Math.sin(a) * r, out() * 6.3, 0.8 + out() * 1.6]);
  }
}

// ------------------------------------------------------------ grass (cosmetic: no colliders, no LOS effect)
// Ty's Meshy tall-grass clump and clover tuft, scattered in natural clumps: thick along the pen fence, the crop
// field's edge, round trees and rocks, at the rim and in the south meadow; thin in the open; none on paths, the
// farmyard, the blast scorch, the siege circles, spawn spots, props or anything solid. Seeded, so every client
// draws the same. Each kind is split into 12 m chunks (InstancedMesh each), so the frustum and a distance check
// skip most of them; the vertex shader sways them and shrinks them into the ground between GRASS.fade[0] and [1].
// ?low (main.js's weak-GPU flag) keeps about a third of them and fades them nearer.
const LOW = typeof location !== 'undefined' && new URLSearchParams(location.search).has('low');
export const GRASS = {
  tall:   { count: LOW ? 220 : 640, h: [0.5, 0.95] },
  clover: { count: LOW ? 280 : 800, h: [0.18, 0.32] },
  fade: LOW ? [14, 22] : [20, 30],
  chunk: 12,
};
export const GRASS_ITEMS = { tall: [], clover: [] };   // [x, z, yaw, height, tint r, g, b]
{
  const rnd = seeded(91);
  const segDist = (x, z, [ax, az], [bx, bz]) => {
    const sx = bx - ax, sz = bz - az, k = Math.max(0, Math.min(1, ((x - ax) * sx + (z - az) * sz) / (sx * sx + sz * sz)));
    return Math.hypot(ax + sx * k - x, az + sz * k - z);
  };
  const spawns = [...C.SPAWN_POINTS, ...C.TEAM_SPAWNS.ember, ...C.TEAM_SPAWNS.frost, ...(C.SIEGE_SPAWNS ? [...C.SIEGE_SPAWNS.ember, ...C.SIEGE_SPAWNS.frost] : [])];
  const F = C.FIELD;
  const fieldDist = (x, z) => Math.hypot(Math.max(F.x0 - x, 0, x - F.x1), Math.max(F.z0 - z, 0, z - F.z1));
  const near = C.COLLIDERS.filter(c => ['tree', 'rock', 'stone', 'silo', 'obelisk', 'arch', 'pillar', 'ruin', 'scarecrow', 'hay'].includes(c.kind) && c.r > 0.3);
  const blocked = (x, z) => {
    const r = Math.hypot(x, z);
    if (r > C.ARENA_RADIUS + 4) return true;
    if (PATHS.some(([a, b, w]) => segDist(x, z, a, b) < w / 2 + 0.35)) return true;
    if ((x / 13) ** 2 + ((z - 13) / 9) ** 2 < 1) return true;                         // the farmyard
    if (Math.hypot(x - C.ALTAR.x, z - C.ALTAR.z) < C.BLAST_RADIUS - 1.5) return true;  // the scorch
    if ((C.SIEGE_ZONES || []).some(zn => Math.hypot(x - zn.x, z - zn.z) < zn.r + 0.5)) return true;
    if (spawns.some(([sx, , sz]) => Math.hypot(sx - x, sz - z) < 2.5)) return true;
    if (C.inPen(x, z, -0.4) || fieldDist(x, z) < 0.4) return true;                     // the pen floor and the crops
    if (C.PROP_SPAWNS.some(([, px, pz]) => Math.hypot(px - x, pz - z) < 1.0)) return true;
    if (Math.hypot(x - C.SILO_FOOTING.x, z - C.SILO_FOOTING.z) < C.SILO_FOOTING.r + 0.6) return true;
    if (Math.hypot(x - C.WELL.x, z - C.WELL.z) < C.WELL.r + 1.6) return true;
    if (C.SURFACES.some(sf => { const c = Math.cos(sf.yaw || 0), n = Math.sin(sf.yaw || 0), dx = x - sf.x, dz = z - sf.z; return Math.abs(dx * c - dz * n) < sf.w / 2 + 0.3 && Math.abs(dx * n + dz * c) < sf.d / 2 + 0.3; })) return true;   // the high ground
    return C.COLLIDERS.some(c => Math.hypot(c.x - x, c.z - z) < c.r + 0.2);
  };
  // How much grass wants to grow here (0 open meadow .. ~3 along a fence by a tree), and how much of it is tall.
  const want = (x, z) => {
    const r = Math.hypot(x, z);
    let w = 0.25, edge = 0;
    const fd = C.fenceDistance(x, z);
    if (fd < 2.6 && !C.inPen(x, z)) { w += 3 * (1 - fd / 2.6); edge = 1; }
    const fl = fieldDist(x, z);
    if (fl < 2.2) { w += 2.4 * (1 - fl / 2.2); edge = 1; }
    for (const c of near) {
      const d = Math.hypot(c.x - x, c.z - z) - c.r;
      if (d < 2.4) { w += 1.6 * (1 - d / 2.4); edge = Math.max(edge, 0.8); }
    }
    if (z < -16 && Math.hypot(x - C.ALTAR.x, z - C.ALTAR.z) > C.BLAST_RADIUS + 1) w += 1.1;    // the south meadow
    if (Math.hypot(x - C.ALTAR.x, z - C.ALTAR.z) < C.BLAST_RADIUS + 3) w *= 0.35;            // thin near the scorch
    if (r > C.ARENA_RADIUS - 3) { w = Math.min(w, 0.3) + 0.1; edge = 1; }                     // the rim: a fringe, not a band
    if (r > C.ARENA_RADIUS + 1.5) w *= 0.4;
    return [Math.min(w, 3), edge];
  };
  const left = { tall: GRASS.tall.count, clover: GRASS.clover.count };
  for (let tries = 0; tries < 60000 && (left.tall > 0 || left.clover > 0); tries++) {
    const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * (C.ARENA_RADIUS + 4);
    const cx = Math.cos(a) * rr, cz = Math.sin(a) * rr;
    if (blocked(cx, cz)) continue;
    const [w, edge] = want(cx, cz);
    if (rnd() * 3 > w) continue;
    // a clump: 2-6 plants round the centre; edges grow tall grass, open ground mostly clover
    const n = 3 + Math.floor(rnd() * 6), spread = 0.3 + rnd() * 0.5, pTall = 0.25 + 0.45 * edge;
    for (let i = 0; i < n; i++) {
      const kind = rnd() < pTall ? 'tall' : 'clover';
      if (left[kind] <= 0) continue;
      const g1 = rnd() + rnd() - 1, g2 = rnd() + rnd() - 1;
      const x = cx + g1 * spread * 1.4, z = cz + g2 * spread * 1.4;
      if (blocked(x, z)) continue;
      const [h0, h1] = GRASS[kind].h, h = (h0 + (h1 - h0) * rnd()) * (0.8 + 0.25 * Math.min(1, w / 2));
      // brighter than the texture (it reads dark against the lit meadow), a touch greener, a little yellow in some
      const v = 1.15 + rnd() * 0.3, warm = rnd() * 0.14;
      GRASS_ITEMS[kind].push([x, z, rnd() * 6.3, h, v * (0.92 + warm), v * (1.08 + warm * 0.5), v * (0.85 - warm * 0.4)]);
      left[kind]--;
    }
  }
}
const grassChunks = [];
const grassUniforms = { uTime: { value: 0 }, uFade: { value: new THREE.Vector2(...GRASS.fade) } };
function grassMeshes(gltf, items) {
  gltf.scene.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(gltf.scene), k = 1 / (bb.max.y - bb.min.y);
  const norm = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2));
  const parts = [];
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const mat = o.material.clone();
    mat.side = THREE.DoubleSide;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, grassUniforms);
      sh.vertexShader = sh.vertexShader
        .replace('void main() {', 'uniform float uTime;\nuniform vec2 uFade;\nvoid main() {')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 gp = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            float gh = clamp(transformed.y, 0.0, 1.2), gph = gp.x * 0.37 + gp.z * 0.29;
            transformed.x += sin(uTime * 1.6 + gph) * 0.07 * gh * gh;
            transformed.z += cos(uTime * 1.2 + gph * 1.3) * 0.05 * gh * gh;
            transformed *= 1.0 - smoothstep(uFade.x, uFade.y, distance(gp, cameraPosition));
          #endif`);
    };
    parts.push([o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(norm, o.matrixWorld)), mat]);
  });
  const cells = new Map();
  for (const it of items) {
    const key = `${Math.floor(it[0] / GRASS.chunk)},${Math.floor(it[1] / GRASS.chunk)}`;
    (cells.get(key) || cells.set(key, []).get(key)).push(it);
  }
  const group = new THREE.Group(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  for (const list of cells.values()) {
    const c = new THREE.Vector3();
    for (const [x, z] of list) c.x += x / list.length, c.z += z / list.length;
    const rad = Math.max(...list.map(([x, z]) => Math.hypot(x - c.x, z - c.z))) + 1;
    for (const [geo, mat] of parts) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(([x, z, yaw, h, r, g, b], i) => {
        im.setMatrixAt(i, m.compose(new THREE.Vector3(x, groundHeight(x, z) - 0.02, z), q.setFromAxisAngle(up, yaw), new THREE.Vector3(h, h, h)));
        im.setColorAt(i, col.setRGB(r, g, b));
      });
      im.castShadow = false; im.receiveShadow = true;
      im.computeBoundingSphere();
      grassChunks.push({ im, c, rad });
      group.add(im);
    }
  }
  return group;
}
// Sway clock and distance culling, once per frame from the scene itself (nothing outside this file ticks it).
function grassTick(camera) {
  grassUniforms.uTime.value = performance.now() / 1000;
  const far = GRASS.fade[1];
  for (const ch of grassChunks) ch.im.visible = camera.position.distanceTo(ch.c) - ch.rad < far;
}

// One InstancedMesh per mesh in the model, normalised like fitModel (base on y = 0, centred on x/z,
// 1 m tall) and scaled to each instance's height. Sits on the terrain outside the flat arena.
function instanced(gltf, items, shadows = true) {
  gltf.scene.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(gltf.scene);
  const norm = new THREE.Matrix4().makeScale(1 / (bb.max.y - bb.min.y), 1 / (bb.max.y - bb.min.y), 1 / (bb.max.y - bb.min.y))
    .multiply(new THREE.Matrix4().makeTranslation(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2));
  const group = new THREE.Group(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(norm, o.matrixWorld));
    const im = new THREE.InstancedMesh(geo, o.material, items.length);
    items.forEach(([x, z, yaw, h, tilt = 0, lean = 0, sink = 0], i) => {
      // spin by `yaw`, then lean by `tilt` toward the bearing `lean` (no lean: just the yaw)
      q.setFromEuler(e.set(tilt, lean, 0, 'YXZ')).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw - lean));
      m.compose(new THREE.Vector3(x, groundHeight(x, z) - 0.05 * h - sink, z), q, new THREE.Vector3(h, h, h));
      im.setMatrixAt(i, m);
    });
    im.castShadow = shadows; im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  });
  return group;
}

// The Meshy landmarks glow cyan; the farm's magic is purple. Swap glowing cyan texels for violet and make them glow.
function purpleRunes(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    o.material.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader
        .replace('void main() {', 'float runeGlow = 0.0;\nvoid main() {')
        .replace('#include <map_fragment>', `#include <map_fragment>
          runeGlow = smoothstep(0.35, 0.7, diffuseColor.g + diffuseColor.b - 2.0 * diffuseColor.r) * step(0.3, diffuseColor.b);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.38, 1.0) * max(diffuseColor.g, diffuseColor.b), runeGlow);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += vec3(0.42, 0.2, 1.0) * runeGlow * 0.9;`);
    };
    o.material.needsUpdate = true;
  });
}

// Farm pieces with a Meshy model: [stand-in name, url, height in metres, yaw that turns it to face +z].
// A model that fails to load leaves its procedural stand-in in place.
const FARM_MODELS = [
  ['tractor', '/models/tractor.glb', 3.0, Math.PI / 2],     // exported nose toward -x
  ['cart', '/models/horse_cart.glb', C.CART.height],          // model space as measured for its colliders in map.js
  ['pillar', '/models/rune_pillar.glb', C.PILLAR_HEIGHT, 0, true],
  ['archway', '/models/archway.glb', C.ARCHWAY.height, 0, true],
  ['obelisk', '/models/obelisk.glb', C.OBELISK.height, 0, true],
  ['scarecrow', '/models/scarecrow.glb', 2.4],
  ['barn', '/models/barn.glb', C.BARN.height],               // model space as measured for the colliders in map.js
  ['silo', '/models/silo.glb', C.SILO.height],
];

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
    ...FARM_MODELS.map(([name, url, h, yaw, runes]) => load(url).then(g => {
      if (runes) purpleRunes(g.scene);
      models[name] = fitModel(g, h, yaw); swapModel(name, models[name]);
    }, () => {})),
    // Trees and rocks repeat dozens of times: one InstancedMesh per model.
    ...Object.entries(SCATTER).map(([name, items]) => load(`/models/${name}.glb`).then(g => {
      scene.add(instanced(g, items, !name.endsWith('_far')));
      for (const s of SCATTER_STANDINS[name] || []) swapModel(s, new THREE.Group());
      if (name === 'rock_jagged') models.rockProp = fitModel({ scene: g.scene.clone() }, C.PROP_TYPES.rock.h);
    }, () => {})),
    // Grass: cosmetic clumps, chunked and instanced (see GRASS).
    ...['tall', 'clover'].map(kind => load(`/models/grass_${kind}.glb`).then(g => {
      scene.add(grassMeshes(g, GRASS_ITEMS[kind]));
      scene.onBeforeRender = (renderer, sc, camera) => grassTick(camera);
    }, () => {})),
    // One round bale, two sizes: the throwable prop and the big courtyard cover stacks.
    load('/models/hay.glb').then(g => {
      models.haystack = fitModel({ scene: g.scene.clone() }, 1.7);
      models.hay = fitModel(g, C.PROP_TYPES.hay.h);
      swapModel('haystack', models.haystack);
    }, () => {}),
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
      if (models.rockProp) { g.add(models.rockProp.clone()); break; }
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
