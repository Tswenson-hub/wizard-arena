// The castle courtyard (round 15): sky, light, the grass outside, and every placed kit piece, floor and deco from the
// layout (shared/map.js reads shared/layout.json), plus prop mesh factories. Layout data lives in map.js; this file
// only draws it. Kit pieces repeat dozens of times, so each kit model is one InstancedMesh per mesh it has, sharing one
// material set per kit: the KayKit castle pieces sample one 1024 palette atlas (models/castle/dungeon_texture.webp),
// the Quaternius village pieces small tiling base colours (models/village/*.webp).
import * as THREE from 'three';
import * as C from '../shared/constants.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0.0, ...extra });

export function groundHeight(x, z) {
  const r = Math.hypot(x, z);
  const rise = Math.max(0, r - C.ARENA_RADIUS - 2);
  return rise > 0 ? rise * 0.3 + Math.sin(x * 0.35) * Math.cos(z * 0.3) * Math.min(1.5, rise * 0.3) : 0;
}

// ------------------------------------------------------------ the grass outside the walls (Ty's tileable grass)
// Sampled in world space: 5 m to a tile, plus a second sample turned 34° at 13 m and low-frequency colour variation so
// the tiling doesn't show.
const GROUND_TEX = {};
function groundTexture(name) {
  if (GROUND_TEX[name]) return GROUND_TEX[name];
  const t = new THREE.TextureLoader().load(`./textures/ground/${name}.webp`);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return (GROUND_TEX[name] = t);
}
const NOISE_GLSL = `
  float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float gNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y); }`;
function worldPosVarying(sh) {
  sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying vec3 vGPos;\nvoid main() {')
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vGPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
}
export const GROUND_LOOK = { grassTile: 5, grassTile2: 13, tint: [0.8, 0.86, 0.72] };
function grassGround() {
  const m = new THREE.MeshStandardMaterial({ map: groundTexture('grass'), roughness: 0.95, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    worldPosVarying(sh);
    const [tr, tg, tb] = GROUND_LOOK.tint;
    sh.fragmentShader = sh.fragmentShader.replace('void main() {', `varying vec3 vGPos;${NOISE_GLSL}\nvoid main() {`)
      .replace('#include <map_fragment>', `
        vec2 gp = vGPos.xz;
        vec3 g1 = texture2D(map, gp / ${GROUND_LOOK.grassTile.toFixed(1)}).rgb;
        vec2 q = mat2(0.829, -0.559, 0.559, 0.829) * gp / ${GROUND_LOOK.grassTile2.toFixed(1)} + vec2(0.37, 0.71);
        vec3 g2 = texture2D(map, q).rgb;
        float n1 = gNoise(gp * 0.045), n2 = gNoise(gp * 0.13 + 7.3);
        vec3 g = mix(g1, g2, 0.25 + 0.35 * n1);
        g *= vec3(${tr}, ${tg}, ${tb}) * mix(vec3(0.86, 0.95, 0.82), vec3(1.06, 1.02, 1.08), n2);   // patches: drier, lusher
        float lum = dot(g, vec3(0.3, 0.59, 0.11));
        g = mix(vec3(lum), g, 0.82);                                     // a little less saturated than the raw tile
        diffuseColor.rgb *= g;`);
  };
  return m;
}

// The painted sky (textures/sky.jpg, baked from Ty's Meshy panorama by tools/make-sky.py): an equirectangular
// background with the horizon at the middle row, its sunbeams rolled to the sun's bearing. The fog fades the
// hills and mountains into its horizon colour.
export const SKY = { horizon: 0x48d7f2, fog: 0x7cc9de };
export function buildWorld(scene) {
  // a fresh build (the editor builds again after every change): scatter the trees outside the walls for this layout
  spinners.length = 0;
  computeScatter();
  scene.background = new THREE.Color(SKY.horizon);
  new THREE.TextureLoader().load('./textures/sky.jpg', (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    scene.background = tex;
  });
  scene.fog = new THREE.Fog(SKY.fog, 60, 175);

  // a cool blue sky light and warm sunbeams, as in the painting
  const hemi = new THREE.HemisphereLight(0xd6efff, 0x6a6a58, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe9c4, 2.3);
  sun.position.set(30, 50, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // covers the castle and the trees round it
  sun.shadow.camera.left = -42; sun.shadow.camera.right = 42;
  sun.shadow.camera.top = 42; sun.shadow.camera.bottom = -42;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 130;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);

  // Ground: a big grid, flat inside the arena and rising into rolling hills outside it, all Ty's grass. The courtyard's
  // stone floor is drawn over it (layout 'floor' entries, see loadModels).
  const groundGeo = new THREE.PlaneGeometry(240, 240, 72, 72);
  groundGeo.rotateX(-Math.PI / 2);
  {
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)));
    groundGeo.computeVertexNormals();
  }
  const ground = new THREE.Mesh(groundGeo, grassGround());
  ground.receiveShadow = true;
  scene.add(ground);

  scene.add(mountainVista());
  return { sun };
}

// Distant mountains (round 13): Ty's painted vista (textures/sky/mountain_vista.webp: the peaks and the mist band, the
// sky above them keyed to alpha so the painted skybox shows through) wrapped round the horizon on one open cylinder
// far past the hills, unlit, in one draw call. Mirrored tiles meet seamlessly; a smooth variation round the ring (a
// whole number of periods, so it closes) changes the peaks' height and tint so neighbouring tiles don't read as twins.
// The cylinder's foot hides behind the hills (they top out about 23 m up at the ground's edge, 120 m out); the haze
// toward its foot is the fog's colour. Turned so the paintings' warm, lit flank faces the sun.
const VISTA = { r: 160, y0: 24, h: 44, tiles: 6 };
function mountainVista() {
  const tex = new THREE.TextureLoader().load('./textures/sky/mountain_vista.webp');
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.MirroredRepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(VISTA.tiles, 1); tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uHaze = { value: new THREE.Color(SKY.fog) };
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `uniform vec3 uHaze;\nvoid main() {`)
      .replace('#include <map_fragment>', `
        float ring = vMapUv.x / ${VISTA.tiles.toFixed(1)} * 6.2831853;   // 0..2pi round the ring
        float k = 1.0 + 0.16 * (0.5 + 0.5 * sin(ring + 0.4)) + 0.08 * (0.5 + 0.5 * sin(ring * 5.0 + 1.1));
        vec2 vuv = vec2(vMapUv.x, vMapUv.y * k);                          // lower, squatter peaks in places
        if (vuv.y > 0.995) discard;
        vec4 texel = texture2D(map, vuv);
        texel.rgb *= vec3(1.0 + 0.05 * sin(ring * 2.0 + 2.0), 1.0 - 0.02 * sin(ring * 3.0), 1.0 + 0.04 * sin(ring * 2.0 + 0.5));
        texel.rgb = mix(texel.rgb, uHaze, 0.12 + 0.3 * (1.0 - smoothstep(0.0, 0.5, vMapUv.y)));
        texel.a *= smoothstep(0.0, 0.08, vMapUv.y);
        diffuseColor *= texel;`);
  };
  const geo = new THREE.CylinderGeometry(VISTA.r, VISTA.r, VISTA.h, 160, 1, true).translate(0, VISTA.y0 + VISTA.h / 2, 0);
  const m = new THREE.Mesh(geo, mat);
  m.rotation.y = 0.35;
  m.renderOrder = -1; m.frustumCulled = false;
  return m;
}

export const spinners = [];

// ------------------------------------------------------------ models
// Optimised copies (see tools/optimize-models.sh). `models` holds the ones other modules clone: the potion barrel, the
// prop pieces (by PROP_TYPES type) and, until the spells agent's rams.js lands, the goat body for goats.js.
export const models = { goat: null, potion: null, props: {} };

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

// ------------------------------------------------------------ trees outside the walls (instanced scenery)
// Seeded so every client draws the same scatter.
function seeded(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
// [x, z, yaw, height] per instance, by model. Pines and oaks close round the castle, the *_far models (about 1-1.6k
// triangles, sloppy-simplified, no shadows) farther out and up the hills.
const SCATTER = { pine: [], oak: [], pine_far: [], oak_far: [], birch_far: [] };
const TREE_H = { pine: 9, oak: 7.5, birch: 8 };
// Recomputed by buildWorld() from the current layout (the editor rebuilds the world after every change).
function computeScatter() {
  for (const k in SCATTER) SCATTER[k].length = 0;
  const B = C.ARENA_BOUNDS, clear = 4;   // keep this far off the outer walls
  const outside = (x, z) => x < B.x0 - clear || x > B.x1 + clear || z < B.z0 - clear || z > B.z1 + clear;
  const FT = C.SCATTER_SETTINGS.farTrees || {}, rnd = seeded(FT.seed ?? 42);
  // a loose ring of full trees round the castle, seen from the wall-walk
  for (let i = 0, n = 0; n < (FT.near ?? 26) && i < 2000; i++) {
    const a = rnd() * Math.PI * 2, r = C.ARENA_RADIUS - 6 + rnd() * 16, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!outside(x, z) || SCATTER.pine.concat(SCATTER.oak).some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 4.5)) continue;
    const kind = rnd() < 0.55 ? 'pine' : 'oak';
    SCATTER[kind].push([x, z, rnd() * 6.3, TREE_H[kind] * (0.8 + rnd() * 0.45)]);
    n++;
  }
  for (let i = 0; i < (FT.count ?? 90); i++) {
    const a = rnd() * Math.PI * 2, r = C.ARENA_RADIUS + 12 + Math.pow(rnd(), 0.7) * 45, pick = rnd();
    const kind = pick < 0.55 ? 'pine' : pick < 0.8 ? 'oak' : 'birch';
    SCATTER[kind + '_far'].push([Math.cos(a) * r, Math.sin(a) * r, rnd() * 6.3, TREE_H[kind] * (0.8 + rnd() * 0.5)]);
  }
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

// ------------------------------------------------------------ kit pieces, floors and decos from the layout
// Kit materials: every castle piece samples the one palette atlas; village pieces are matched by their material's name
// (Quaternius' MI_* set) to small tiling base colours. A glTF texture's v runs down, so the atlas isn't flipped.
const kitTex = {};
function kitTexture(url, repeat = false) {
  if (kitTex[url]) return kitTex[url];
  const t = new THREE.TextureLoader().load(url);
  t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return (kitTex[url] = t);
}
const kitMats = {};
function kitMaterial(model, original) {
  const kit = model.split('/')[0];
  if (kit === 'castle') return kitMats.castle ??= new THREE.MeshStandardMaterial({ map: kitTexture('./models/castle/dungeon_texture.webp'), roughness: 0.7, metalness: 0 });
  const name = original?.name || 'default';
  return kitMats[`${kit}:${name}`] ??= (() => {
    const tex = VILLAGE_TEX[name];
    const m = new THREE.MeshStandardMaterial({ color: tex ? 0xffffff : (original?.color?.getHex?.() ?? 0xbbbbbb), roughness: 0.85, metalness: 0,
      side: original?.side ?? THREE.FrontSide, map: tex ? kitTexture(`./models/village/${tex}.webp`, true) : null });
    return m;
  })();
}
// Quaternius material name -> base colour texture in models/village (512 px webp)
const VILLAGE_TEX = {};
// A geometry with its node's transform baked in. Meshopt stores positions and normals as normalized integers with the
// scale on the node, so they're widened to floats first (baking into an int16 attribute would clamp it to -1..1).
function bakedGeometry(o) {
  const geo = o.geometry.clone();
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.attributes[name];
    if (a.array instanceof Float32Array && !a.isInterleavedBufferAttribute) continue;
    const f = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
    geo.setAttribute(name, new THREE.BufferAttribute(f, a.itemSize));
  }
  return geo.applyMatrix4(o.matrixWorld);
}
// Model -> its meshes as [geometry in model units, material], from one load (the editor's loader hands out clones).
const kitGeo = {};
function kitMeshes(model, gltf) {
  gltf.scene.updateMatrixWorld(true);
  const out = [];
  gltf.scene.traverse(o => { if (o.isMesh) out.push([bakedGeometry(o), kitMaterial(model, o.material)]); });
  return (kitGeo[model] = out);
}
const KIT_EMISSIVE = /torch_lit|torch_mounted|candle/;
// One InstancedMesh per mesh of `model` for the given placements { x, y, z, yaw, s }.
function kitInstances(model, meshes, items, { shadows = true } = {}) {
  const group = new THREE.Group(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3();
  for (const [geo, mat] of meshes) {
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach((it, i) => im.setMatrixAt(i, m.compose(p.set(it.x, it.y, it.z), q.setFromAxisAngle(up, it.yaw), s.setScalar(it.s))));
    im.castShadow = shadows; im.receiveShadow = true;
    im.computeBoundingSphere();
    im.userData.kit = model;
    group.add(im);
  }
  return group;
}
// A floor entry tiled with its model (and a sprinkle of `mix` models), every tile turned a random quarter.
function floorTiles(F) {
  const b = C.KIT_MODELS[F.model], s = C.kitScale(F.model);
  if (!b) return [];
  const tw = (b[1] - b[0]) * s, td = (b[5] - b[4]) * s, nx = Math.max(1, Math.round(F.w / tw)), nz = Math.max(1, Math.round(F.d / td));
  const rnd = seeded(F.seed * 7919 + 1), c = Math.cos(F.yaw), n = Math.sin(F.yaw), out = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const lx = (i + 0.5) * tw - nx * tw / 2, lz = (j + 0.5) * td - nz * td / 2;
    const pick = F.mix.length && rnd() < 0.14 ? F.mix[Math.floor(rnd() * F.mix.length)] : F.model;
    out.push({ model: pick, x: F.x + lx * c + lz * n, y: 0.002, z: F.z - lx * n + lz * c, yaw: F.yaw + Math.floor(rnd() * 4) * Math.PI / 2, s: C.kitScale(pick) });
  }
  return out;
}

// `cameraGrid: false` skips the camera blockers (the editor, which rebuilds the world after every change).
export function loadModels(loader, scene, { cameraGrid = true } = {}) {
  loader.setMeshoptDecoder?.(MeshoptDecoder);   // the map's models are meshopt-compressed (tools/optimize-models.sh)
  const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));
  const solid = (o) => { o.userData.cam = 'solid'; return o; };   // the camera boom stops at it (see cameraClearance)
  // every kit model the layout places (pieces and floor tiles), each loaded once
  const placed = new Map();   // model -> [{ x, y, z, yaw, s, floor }]
  const put = (model, it) => (placed.get(model) || placed.set(model, []).get(model)).push(it);
  for (const P of C.KIT_PIECES) put(P.model, P);
  for (const F of C.FLOORS) for (const t of floorTiles(F)) put(t.model, { ...t, floor: true });
  const propModels = Object.entries(C.PROP_TYPES).filter(([, T]) => T.model);
  return Promise.all([
    load('./models/ram.glb').then(g => { models.goat = fitModel(g, 1.25); }, () => {}),
    load('./models/potion.glb').then(g => { models.potion = fitModel(g, C.PROP_TYPES.potion.h); }, () => {}),
    ...propModels.map(([type, T]) => load(`./models/${T.model}.glb`).then(g => {
      for (const o of g.scene.children) o.traverse(m => { if (m.isMesh) m.material = kitMaterial(T.model, m.material); });
      models.props[type] = fitModel(g, T.h);
    }, () => {})),
    ...[...placed].map(([model, items]) => load(`./models/${model}.glb`).then(g => {
      const meshes = kitMeshes(model, g);
      const floors = items.filter(it => it.floor), pieces = items.filter(it => !it.floor);
      // ground tiles: no shadows cast, not in the camera grid; pieces: solid to the camera
      if (floors.length) scene.add(kitInstances(model, meshes, floors, { shadows: false }));
      if (pieces.length) scene.add((KIT_EMISSIVE.test(model) ? (x) => x : solid)(kitInstances(model, meshes, pieces)));
    }, (err) => console.warn(`kit model ${model} failed to load`, err))),
    // trees round the castle: one InstancedMesh per model; their canopies cut a hole between the camera and us
    ...Object.entries(SCATTER).filter(([, items]) => items.length).map(([name, items]) => load(`./models/${name}.glb`).then(g => {
      scene.add(instanced(g, items, !name.endsWith('_far')));
      if (!name.endsWith('_far')) seeThrough(g.scene);
    }, () => {})),
    // decoration placed in the map editor (layout kind 'deco'): any other model, fitted to its height
    ...[...new Set(C.DECOS.map(d => d.model))].map(name => load(`./models/${name}.glb`).then(g => {
      const unit = fitModel(g, 1), tree = TREE_MODEL.test(name);
      if (tree) seeThrough(g.scene);
      for (const d of C.DECOS.filter(q => q.model === name)) {
        const holder = new THREE.Group(); holder.add(unit.clone());
        if (!tree) solid(holder);
        holder.position.set(d.x, d.y, d.z); holder.rotation.y = d.yaw; holder.scale.setScalar(d.h);
        scene.add(holder);
      }
    }, () => {})),
  ]).then(() => {
    scene.onBeforeRender = () => cutawayTick();
    if (cameraGrid) buildCameraGrid(scene);
  });
}

// The farm's crops are gone; goats.js still calls these until the spells agent's commit removes it.
export function trampleCrops() {}
export function updateCrops() {}

// ------------------------------------------------------------ camera blockers
// The third-person camera mustn't end up inside a Meshy model. Once the models are placed, the triangles of every model
// tagged solid (userData.cam: every kit piece except torches, the decos) are rasterised into a coarse world
// grid, and cameraClearance() walks the boom through it. Tree canopies aren't in it (the camera would keep snapping in
// near trees): their materials cut a dithered see-through hole around the line from the camera to us (cameraCutaway).
// Props move and stay out; round decos are COLLIDERS too, which main.js already checks.
const TREE_MODEL = /^(pine|oak|birch)/;
const CAM = { cell: 0.4, half: C.ARENA_RADIUS + 8, y0: -2, y1: 24, pad: 0.22, margin: 0.25 };
let camGrid = null;   // { cells: Uint8Array, n, ny }

function buildCameraGrid(scene) {
  const n = Math.ceil(2 * CAM.half / CAM.cell), ny = Math.ceil((CAM.y1 - CAM.y0) / CAM.cell);
  const cells = new Uint8Array(n * n * ny);
  const mark = (x, y, z) => {
    const i = Math.floor((x + CAM.half) / CAM.cell), k = Math.floor((z + CAM.half) / CAM.cell), j = Math.floor((y - CAM.y0) / CAM.cell);
    if (i >= 0 && i < n && k >= 0 && k < n && j >= 0 && j < ny) cells[(j * n + k) * n + i] = 1;
  };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), m = new THREE.Matrix4(), im = new THREE.Matrix4();
  const raster = (mesh, world) => {   // every triangle, sampled at least once per cell along its edges
    const pos = mesh.geometry.attributes.position, idx = mesh.geometry.index, tris = (idx ? idx.count : pos.count) / 3;
    const v = (t, out) => out.fromBufferAttribute(pos, idx ? idx.getX(t) : t).applyMatrix4(world);
    for (let t = 0; t < tris; t++) {
      v(3 * t, a); v(3 * t + 1, b); v(3 * t + 2, c);
      const steps = Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / CAM.cell);
      for (let u = 0; u <= steps; u++) for (let w = 0; w <= steps - u; w++) {
        const p = u / steps, q = w / steps, r = 1 - p - q;
        mark(a.x * r + b.x * p + c.x * q, a.y * r + b.y * p + c.y * q, a.z * r + b.z * p + c.z * q);
      }
    }
  };
  const walk = (o, on) => {
    on ||= o.userData.cam === 'solid';
    if (on && o.isMesh && o.geometry?.attributes.position) {
      if (o.isInstancedMesh) for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, im); raster(o, m.multiplyMatrices(o.matrixWorld, im)); }
      else raster(o, o.matrixWorld);
    }
    for (const ch of o.children) walk(ch, on);
  };
  const t0 = performance.now();
  scene.updateMatrixWorld(true);
  walk(scene, false);
  camGrid = { cells, n, ny, ms: Math.round(performance.now() - t0) };
}

function camSolid(x, y, z) {
  const { cells, n, ny } = camGrid;
  const i = Math.floor((x + CAM.half) / CAM.cell), k = Math.floor((z + CAM.half) / CAM.cell), j = Math.floor((y - CAM.y0) / CAM.cell);
  return i >= 0 && i < n && k >= 0 && k < n && j >= 0 && j < ny && cells[(j * n + k) * n + i] === 1;
}

// How far along the segment from `from` (the wizard's head) to `to` (where the camera wants to be) it can go before it
// would be inside or within CAM.pad of a solid model, as a fraction 0..1 (1: nothing in the way). The pad applies from
// half a metre out (a post right beside the head shouldn't swallow the boom), and a head that is itself in a solid cell
// (brushing a deck's underside) skips that solid until the boom comes out of it.
export function cameraClearance(from, to) {
  if (!camGrid) return 1;
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, len = Math.hypot(dx, dy, dz);
  if (len < 1e-3) return 1;
  const P = CAM.pad, padded = (x, y, z) => camSolid(x, y, z) || camSolid(x + P, y, z) || camSolid(x - P, y, z)
    || camSolid(x, y + P, z) || camSolid(x, y - P, z) || camSolid(x, y, z + P) || camSolid(x, y, z - P);
  let free = !camSolid(from.x, from.y, from.z);
  for (let d = 0; d <= len + CAM.margin; d += 0.1) {
    const t = Math.min(d, len) / len, x = from.x + dx * t, y = from.y + dy * t, z = from.z + dz * t;
    if (!free) { free = !camSolid(x, y, z); continue; }
    if (d < 0.5 ? camSolid(x, y, z) : padded(x, y, z)) return Math.max(0, d - CAM.margin) / len;
  }
  return 1;
}

// Foliage see-through: the tree materials discard a dithered tube of fragments around the line from the camera to
// `target` (the wizard's head), widening toward the wizard. Call it every frame the over-the-shoulder camera is live;
// a frame without a call turns it off (cutawayTick, from the scene's onBeforeRender).
const cut = { uCutTarget: { value: new THREE.Vector3() }, uCutOn: { value: 0 }, fresh: false };
export function cameraCutaway(target) {
  if (!target) { cut.uCutOn.value = 0; return; }
  cut.uCutTarget.value.copy(target); cut.uCutOn.value = 1; cut.fresh = true;
}
function cutawayTick() {
  if (!cut.fresh) cut.uCutOn.value = 0;
  cut.fresh = false;
}
function seeThrough(root) {
  root.traverse(o => {
    if (!o.isMesh || o.material.userData.seeThrough) return;
    const mat = o.material;
    mat.userData.seeThrough = true;
    mat.customProgramCacheKey = () => 'see-through';
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uCutTarget = cut.uCutTarget; sh.uniforms.uCutOn = cut.uCutOn;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCutWorld;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          vec4 cutW = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            cutW = instanceMatrix * cutW;
          #endif
          vCutWorld = (modelMatrix * cutW).xyz;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCutWorld;\nuniform vec3 uCutTarget;\nuniform float uCutOn;')
        .replace('void main() {', `void main() {
          if (uCutOn > 0.5) {
            vec3 ab = uCutTarget - cameraPosition;
            float t = dot(vCutWorld - cameraPosition, ab) / max(dot(ab, ab), 1e-4);
            if (t > 0.0 && t < 0.98) {
              float r = mix(0.6, 1.3, t), d = length(vCutWorld - cameraPosition - ab * t);
              const float B[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
              ivec2 q = ivec2(mod(gl_FragCoord.xy, 4.0));   // 4x4 ordered dither: a soft rim, not a hard cut
              float bayer = (B[q.x + 4 * q.y] + 0.5) / 16.0;
              if (1.0 - smoothstep(0.55 * r, r, d) > bayer) discard;
            }
          }`);
    };
    mat.needsUpdate = true;
  });
}

// ------------------------------------------------------------ props
const propMats = {};
function mat(color) { return propMats[color] ??= flat(color); }

// A throwable prop: its kit piece (or the potion barrel) once loaded, a plain box or barrel until then.
export function makePropMesh(type) {
  const spec = C.PROP_TYPES[type] || C.PROP_TYPES.crate;
  const g = new THREE.Group();
  const model = type === 'potion' ? models.potion : models.props[type];
  if (model) g.add(model.clone());
  else {
    const round = type === 'barrel' || type === 'keg' || type === 'potion';
    const m = new THREE.Mesh(round ? new THREE.CylinderGeometry(spec.r * 0.9, spec.r * 0.9, spec.h, 10) : new THREE.BoxGeometry(spec.r * 1.8, spec.h, spec.r * 1.8), mat(spec.color));
    m.position.y = spec.h / 2; g.add(m);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.type = type;
  return g;
}

// Pieces thrown around when a prop breaks.
export function makeFragments(type, count = 8) {
  const spec = C.PROP_TYPES[type] || C.PROP_TYPES.crate;
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
