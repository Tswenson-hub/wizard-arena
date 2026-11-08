// The castle courtyard (round 15): sky, light, the grass outside, and every placed kit piece, floor and deco from the
// layout (shared/map.js reads shared/layout.json), plus prop mesh factories. Layout data lives in map.js; this file
// only draws it. Kit pieces repeat dozens of times, so each kit model is one InstancedMesh per mesh it has, sharing one
// material set per kit: the KayKit castle pieces sample one 1024 palette atlas (models/castle/dungeon_texture.webp),
// the Quaternius village pieces small tiling base colours (models/village/*.webp).
import * as THREE from 'three';
import * as C from '../shared/constants.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as Q from './quality.js';   // round 20: the graphics tier (spells)

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

// ------------------------------------------------------------ quality tiers (round 20)
// quality.js (spells) owns the tier; world.js follows it (onQuality): the sun's shadow map (quality.js's shadowSize, and
// how far round the view it reaches) and the distance LODs (LOD_DIST, re-sorted by lodTick). Whether there
// are shadows at all and how many torch lights there are follow the tier we *booted* on (changing either recompiles every
// lit shader). In the game the shadow camera follows the view (see shadowFollow); the editor keeps one wide static shadow.
const SHADOW = { high: { half: 30, ahead: 12 }, normal: { half: 24, ahead: 10 }, low: { half: 20, ahead: 8 } };
const SUN_DIR = new THREE.Vector3(30, 50, 20).normalize(), SUN_DIST = 70;
let quality = Q.getTier();
let sun = null, followShadow = false;
Q.onQuality((tier) => { quality = tier; applyQuality(); });
function applyQuality() {
  if (!sun || !followShadow) return;
  const S = SHADOW[quality], size = Q.params(quality).shadowSize;
  sun.castShadow = Q.boot.shadows !== 'off';
  if (sun.shadow.mapSize.x !== size) {
    sun.shadow.mapSize.set(size, size);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  const c = sun.shadow.camera;
  c.left = -S.half; c.right = S.half; c.top = S.half; c.bottom = -S.half;
  c.near = SUN_DIST - 40; c.far = SUN_DIST + 40;
  c.updateProjectionMatrix();
}
// Centre the shadow box a little ahead of the camera, snapped to whole shadow-map texels in the light's frame so the
// shadow edges don't crawl as the view moves. Runs before each render (the scene's onBeforeRender, before the shadow pass).
const SUN_X = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), SUN_DIR).normalize();
const SUN_Y = new THREE.Vector3().crossVectors(SUN_DIR, SUN_X);
const _fwd = new THREE.Vector3(), _ctr = new THREE.Vector3();
function shadowFollow(camera) {
  const S = SHADOW[quality];
  if (!sun?.castShadow || !followShadow) return;
  camera.getWorldDirection(_fwd); _fwd.y = 0;
  if (_fwd.lengthSq() > 1e-6) _fwd.normalize();
  _ctr.setFromMatrixPosition(camera.matrixWorld).addScaledVector(_fwd, S.ahead).setY(0);
  const texel = 2 * S.half / sun.shadow.mapSize.x, a = _ctr.dot(SUN_X), b = _ctr.dot(SUN_Y);
  _ctr.addScaledVector(SUN_X, Math.round(a / texel) * texel - a).addScaledVector(SUN_Y, Math.round(b / texel) * texel - b);
  sun.target.position.copy(_ctr);
  sun.position.copy(_ctr).addScaledVector(SUN_DIR, SUN_DIST);
  sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
}

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
  sun = new THREE.DirectionalLight(0xffe9c4, 2.3);
  sun.position.copy(SUN_DIR).multiplyScalar(SUN_DIST);
  sun.castShadow = Q.boot.shadows !== 'off';   // (from the start: a light that stops casting later recompiles every lit shader)
  sun.shadow.mapSize.set(2048, 2048);
  // the editor's static shadow covers the castle and the trees round it; the game's follows the view (applyQuality)
  sun.shadow.camera.left = -42; sun.shadow.camera.right = 42;
  sun.shadow.camera.top = 42; sun.shadow.camera.bottom = -42;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 130;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  followShadow = false;

  // Ground: a big grid, flat inside the arena and rising into rolling hills outside it, all Ty's grass. The courtyard's
  // stone floor is drawn over it (layout 'floor' entries, see loadModels).
  // (round 20: its grid follows the boot tier; the hills are gentle and the fog takes their far side)
  const seg = { high: 72, normal: 48, low: 32 }[Q.boot.tier] ?? 48;
  const groundGeo = new THREE.PlaneGeometry(240, 240, seg, seg);
  groundGeo.rotateX(-Math.PI / 2);
  {
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)));
    groundGeo.computeVertexNormals();
  }
  const ground = new THREE.Mesh(groundGeo, grassGround());
  ground.receiveShadow = true;
  ground.userData.cat = 'ground';
  scene.add(ground);

  const vista = mountainVista();
  vista.userData.cat = 'mountains';
  scene.add(vista);
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
// Optimised copies (see tools/optimize-models.sh). `models` holds the ones other modules clone: the potion barrel and the
// prop pieces (by PROP_TYPES type).
export const models = { potion: null, props: {} };

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
// [x, z, yaw, height] per instance, by model: the low-poly *_far trees (about 1-1.6k triangles, sloppy-simplified) in a
// loose ring close round the castle (from the wall-walk they're 7 m and more away) and many more out on the hills. Round
// 20: each one past LOD_DIST.tree is drawn as an impostor (treeLod), which is nearly all of the hills' (they were 138k
// triangles as models).
const SCATTER = { pine_far: [], oak_far: [], birch_far: [] };
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
    if (!outside(x, z) || SCATTER.pine_far.concat(SCATTER.oak_far).some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 4.5)) continue;
    const kind = rnd() < 0.55 ? 'pine' : 'oak';
    SCATTER[kind + '_far'].push([x, z, rnd() * 6.3, TREE_H[kind] * (0.8 + rnd() * 0.45)]);
    n++;
  }
  for (let i = 0; i < (FT.count ?? 90); i++) {
    const a = rnd() * Math.PI * 2, r = C.ARENA_RADIUS + 12 + Math.pow(rnd(), 0.7) * 45, pick = rnd();
    const kind = pick < 0.55 ? 'pine' : pick < 0.8 ? 'oak' : 'birch';
    SCATTER[kind + '_far'].push([Math.cos(a) * r, Math.sin(a) * r, rnd() * 6.3, TREE_H[kind] * (0.8 + rnd() * 0.5)]);
  }
}

// Tree impostors: models/trees_impostor.webp (baked by tools/bake-impostors.py) has one square cell per *_far model,
// `span` tree heights a side with the tree's foot at its bottom middle, lit like the game and not tone mapped. A far tree
// is two crossed quads (4 triangles) sampling its cell, unlit (the bake carries the light), fogged, alpha-tested.
const IMPOSTOR = { cells: ['pine_far', 'oak_far', 'birch_far'], span: 1.15 };
let impostorMat = null;
function impostorMaterial() {
  if (impostorMat) return impostorMat;
  const t = new THREE.TextureLoader().load('./models/trees_impostor.webp');
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return (impostorMat = new THREE.MeshBasicMaterial({ map: t, color: 0xe2e2e2, alphaTest: 0.5, side: THREE.DoubleSide }));   // a shade under the bake: the models' shaded sides
}
// One tree impostor as an instance: the two crossed quads of `kind`'s cell, 1 unit = the tree's height (like instanced()'s
// normalised models, so a tree's instance matrix places its impostor too).
function impostorUnit(kind) {
  const s = IMPOSTOR.span, w = s / 2, u0 = kind / IMPOSTOR.cells.length, u1 = (kind + 1) / IMPOSTOR.cells.length;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, w, s, 0, -w, s, 0, 0, 0, -w, 0, 0, w, 0, s, w, 0, s, -w], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([u0, 0, u1, 0, u1, 1, u0, 1, u0, 0, u1, 0, u1, 1, u0, 1], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return geo;
}

// ------------------------------------------------------------ distance LOD (round 20)
// A LOD set draws the same placements with two sets of InstancedMeshes: `hi` (the real model) and `lo` (a cheap stand-in:
// a kit piece's baked box, a tree's impostor). A placement is drawn hi while the camera is within the tier's distance of
// it (a metre of hysteresis), lo past that; high has no LOD. Re-sorted only when the camera has moved half a metre or the
// tier changed (lodTick, from the scene's onBeforeRender). An empty set is hidden, not drawn with no instances.
const LOD_DIST = { kit: { high: Infinity, normal: 15, low: 8 }, tree: { high: Infinity, normal: 26, low: 0 } };
const lodSets = [], lodAt = new THREE.Vector3(), _cam = new THREE.Vector3();
let lodTier = null;
function lodSet(kind, items, hi, lo, far = 1) {   // items: [{ x, z, m: instance Matrix4 }]; far: x the tier's distance
  for (const im of [...hi, ...lo]) { items.forEach((it, i) => im.setMatrixAt(i, it.m)); im.computeBoundingSphere(); }
  lodSets.push({ kind, items, hi, lo, far, near: new Uint8Array(items.length).fill(1) });
  lodTier = null;
}
function lodTick(camera) {
  if (!lodSets.length) return;
  _cam.setFromMatrixPosition(camera.matrixWorld).setY(0);
  if (lodTier === quality && _cam.distanceTo(lodAt) < 0.5) return;
  lodAt.copy(_cam); lodTier = quality;
  for (const S of lodSets) {
    const D = LOD_DIST[S.kind][quality] * S.far;
    let h = 0, l = 0;
    S.items.forEach((it, i) => {
      const d = Math.hypot(it.x - _cam.x, it.z - _cam.z), near = S.near[i] = !S.hi.length ? 0 : d < D - 1 ? 1 : d > D + 1 ? 0 : S.near[i];
      if (near) { for (const im of S.hi) im.setMatrixAt(h, it.m); h++; } else { for (const im of S.lo) im.setMatrixAt(l, it.m); l++; }
    });
    for (const im of S.hi) { im.count = h; im.visible = h > 0; im.instanceMatrix.needsUpdate = true; }
    for (const im of S.lo) { im.count = l; im.visible = l > 0; im.instanceMatrix.needsUpdate = true; }
  }
}
// Every tree outside the walls: its model near, its impostor past LOD_DIST.tree (all impostors on low).
function treeMatrix([x, z, yaw, h]) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, groundHeight(x, z) - 0.05 * h, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(h, h, h));
}
function treeLod(scene, name, group, items) {
  const hi = group ? [...group.children] : [], lo = [new THREE.InstancedMesh(impostorUnit(IMPOSTOR.cells.indexOf(name)), impostorMaterial(), items.length)];
  for (const im of [...hi, ...lo]) { im.userData.cat = 'trees'; scene.add(im); }
  lodSet('tree', items.map(it => ({ x: it[0], z: it[1], m: treeMatrix(it) })), hi, lo);
}
// Kit pieces (KIT_LOD.models): the real piece near, past LOD_DIST.kit a box of up to five quads textured with its own
// sides seen straight on (models/castle/kit_lod.webp + .json, baked by tools/bake-kit-lod.py), lit like the rest of the
// stone. Cut-out pieces (a balustrade's gaps, a banner's outline, a grate) keep their empty texels transparent, so the
// boxes are alpha-tested, and so are the near pieces (see kitHiMat): one shader program for both.
// Neither casts a shadow: these pieces cast theirs from their shadow proxies (see SHADOW_PROXY), floor tiles none.
// `far`: a model whose detail shows from further off switches that much later (a crack's depth reads at 20 m).
const KIT_LOD = { json: './models/castle/kit_lod.json', tex: './models/castle/kit_lod.webp', far: { 'castle/wall_cracked': 1.6 } };
let kitLodMat = null, kitHiMat = null;
function kitLodGeometry(faces) {
  const pos = [], nor = [], uv = [], idx = [];
  faces.forEach((f, k) => {
    pos.push(...f.pos); uv.push(...f.uv);
    for (let i = 0; i < 4; i++) nor.push(...f.normal);
    idx.push(4 * k, 4 * k + 1, 4 * k + 2, 4 * k, 4 * k + 2, 4 * k + 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}
function kitLod(scene, model, meshes, items, faces, { cat, solid }) {
  kitLodMat ??= new THREE.MeshStandardMaterial({ map: kitTexture(KIT_LOD.tex), roughness: 0.7, metalness: 0, alphaTest: 0.5 });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3();
  const mk = (geo, mat) => {
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    im.castShadow = false; im.receiveShadow = true; im.userData.cat = cat;
    scene.add(im);
    return im;
  };
  // the real piece near: the stone's settings, alpha-tested too (the palette is opaque, nothing is cut) so the near pieces
  // and their boxes share one shader program
  kitHiMat ??= new THREE.MeshStandardMaterial({ map: kitTexture('./models/castle/dungeon_texture.webp'), roughness: 0.7, metalness: 0, alphaTest: 0.5 });
  const hi = meshes.map(([geo]) => mk(geo, kitHiMat));
  if (solid) for (const im of hi) im.userData.cam = 'solid';   // (the camera grid is built before the first re-sort: every piece)
  lodSet('kit', items.map(it => ({ x: it.x, z: it.z, m: m.compose(p.set(it.x, it.y, it.z), q.setFromAxisAngle(up, it.yaw), s.setScalar(it.s)).clone() })),
    hi, [mk(kitLodGeometry(faces), kitLodMat)], KIT_LOD.far[model]);
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
// Torches: the warm texels of the palette (the flame) glow. Tinted pieces (a white banner in an element's colour): the
// near-white texels take the tint, the pole and fittings keep theirs.
const torchTime = { value: 0 };
function castleMaterial(kind, tint) {
  const m = new THREE.MeshStandardMaterial({ map: kitTexture('./models/castle/dungeon_texture.webp'), roughness: 0.7, metalness: 0 });
  if (kind === 'torch') {
    m.customProgramCacheKey = () => 'kit-torch';
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = torchTime;
      sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'uniform float uTime;\nfloat flameGlow = 0.0;\nvoid main() {')
        .replace('#include <map_fragment>', `#include <map_fragment>
          flameGlow = smoothstep(0.25, 0.5, diffuseColor.r - diffuseColor.b) * step(0.55, diffuseColor.r);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += diffuseColor.rgb * flameGlow * (1.6 + 0.35 * sin(uTime * 13.0) * sin(uTime * 7.3 + 1.0));`);
    };
  } else if (tint != null) {
    const c = new THREE.Color(tint);
    m.customProgramCacheKey = () => 'kit-tint';
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTint = { value: c };
      sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'uniform vec3 uTint;\nvoid main() {')
        .replace('#include <map_fragment>', `#include <map_fragment>
          float tLum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
          float tSat = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)) - min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
          diffuseColor.rgb = mix(diffuseColor.rgb, uTint * (0.35 + 0.75 * tLum), smoothstep(0.55, 0.75, tLum) * (1.0 - smoothstep(0.08, 0.2, tSat)));`);
    };
  }
  return m;
}
const KIT_TORCH = /torch/;
function kitMaterial(model, original, tint = null) {
  const kit = model.split('/')[0];
  if (kit === 'castle') {
    const kind = KIT_TORCH.test(model) ? 'torch' : tint != null ? `tint${tint}` : 'plain';
    return kitMats[`castle:${kind}`] ??= castleMaterial(kind === 'torch' ? 'torch' : 'plain', kind === 'torch' ? null : tint);
  }
  // Quaternius: its MI_* material names pick a 512 px tiling base colour (models/village/*.webp); every face both sides
  const name = original?.name || 'default';
  return kitMats[`${kit}:${name}`] ??= (() => {
    const V = VILLAGE_MAT[name] || {};
    return new THREE.MeshStandardMaterial({ color: V.color ?? 0xffffff, roughness: V.roughness ?? 0.88, metalness: V.metalness ?? 0, side: THREE.DoubleSide,
      map: V.tex ? kitTexture(`./models/village/${V.tex}.webp`, true) : null, alphaTest: V.alphaTest ?? 0, transparent: !!V.opacity, opacity: V.opacity ?? 1 });
  })();
}
// Quaternius material name -> how it's drawn (the pack's 2048 PBR base colours shrunk to 512 px webp, no other maps)
const VILLAGE_MAT = {
  MI_WoodTrim: { tex: 'woodtrim' }, MI_WoodTrim_Wear: { tex: 'woodtrim' }, MI_Plaster: { tex: 'plaster' }, MI_UnevenBrick: { tex: 'unevenbrick' },
  MI_RoundTiles: { tex: 'roundtiles' }, MI_RockTrim: { tex: 'rocktrim' }, MI_Brick: { tex: 'brick' },
  MI_Vine: { tex: 'vine', color: 0x4a8a2a, alphaTest: 0.5 }, MI_MetalOrnaments: { color: 0x3c3f46, metalness: 0.5, roughness: 0.5 },
  MI_WindowGlass: { color: 0x9cc8e0, opacity: 0.35, roughness: 0.2 },
};
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
  gltf.scene.traverse(o => { if (o.isMesh) out.push([bakedGeometry(o), o.material]); });
  return (kitGeo[model] = out);
}
// One InstancedMesh per mesh of `model` for the given placements { x, y, z, yaw, s }.
function kitInstances(model, meshes, items, { shadows = true, tint = null } = {}) {
  const group = new THREE.Group(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3();
  for (const [geo, original] of meshes) {
    const im = new THREE.InstancedMesh(geo, kitMaterial(model, original, tint), items.length);
    items.forEach((it, i) => im.setMatrixAt(i, m.compose(p.set(it.x, it.y, it.z), q.setFromAxisAngle(up, it.yaw), s.setScalar(it.s))));
    im.castShadow = shadows; im.receiveShadow = true;
    im.computeBoundingSphere();
    im.userData.kit = model;
    group.add(im);
  }
  return group;
}
// The game merges the castle instead: it never moves, so every piece sharing a material (and a shadow and camera
// setting) becomes one mesh, one draw call, about 20 for the whole castle instead of hundreds. The editor keeps the
// instances (it rebuilds after every change and moves what's dragged). Round 20: a big bucket (the castle's stone, the
// floor tiles) is split into a 2 x 2 grid of chunks over the map, so the view and the shadow camera skip the chunks they
// can't see (one mesh over the whole map was drawn whole from anywhere). Each bucket: { mat, shadows, solid, cat, tris,
// cells: Map(chunk -> geometries) }.
const MERGE_ATTRS = ['position', 'normal', 'uv'];
const CHUNKS = { n: 2, minTris: 15000 };   // buckets under minTris stay one mesh
let chunkOf = () => 0;
function chunkGrid(items) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const it of items) { x0 = Math.min(x0, it.x); x1 = Math.max(x1, it.x); z0 = Math.min(z0, it.z); z1 = Math.max(z1, it.z); }
  const w = (x1 - x0) / CHUNKS.n + 1e-3, d = (z1 - z0) / CHUNKS.n + 1e-3;
  chunkOf = (x, z) => Math.min(CHUNKS.n - 1, Math.max(0, Math.floor((x - x0) / w))) + CHUNKS.n * Math.min(CHUNKS.n - 1, Math.max(0, Math.floor((z - z0) / d)));
}
// Round 20: only the big pieces cast shadows (walls, decks, roofs, stairs, pillars, barriers); barrels, crates, boxes,
// columns, balconies, torches and banners don't.
function castsShadow(model) {
  if (/torch|banner/.test(model)) return false;
  const b = C.KIT_MODELS[model], s = C.kitScale(model);
  return !b || (b[3] - b[2]) * s >= 2 || Math.max(b[1] - b[0], b[5] - b[4]) * s >= 3;
}
const kitCat = (model, floor) => floor ? 'floors' : KIT_TORCH.test(model) ? 'torches' : model.split('/')[0];
// Round 20: the solid, box-shaped pieces (about 100k of the castle's 128k shadow-casting triangles: every brick of every
// wall) cast their shadow from their bounding box instead, 12 triangles a piece, all in one mesh that only the shadow
// pass sees (it writes no colour and no depth, so it's invisible). Each box is pulled in a little (SHADOW_PROXY.inset, never more than a
// quarter of a side) so a piece's own sunlit face is never inside its box. Pieces with openings (arches, open windows,
// gates, broken walls, stairs, roofs) keep their real shadows. Game only; the editor keeps the real ones.
const SHADOW_PROXY = { models: /^castle\/(wall|wall_cracked|wall_window_closed|wall_shelves|barrier|barrier_column|pillar|column|floor_tile_large)$/, inset: 0.1 };
let proxyMat = null;
function shadowProxyGeometry(model, items) {
  const b = C.KIT_MODELS[model], out = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3();
  for (const it of items) {
    const k = it.s, w = (b[1] - b[0]) * k, h = (b[3] - b[2]) * k, d = (b[5] - b[4]) * k, cut = (n) => Math.min(SHADOW_PROXY.inset, n / 4);
    const box = new THREE.BoxGeometry(w - 2 * cut(w), h - cut(h), d - 2 * cut(d));
    box.deleteAttribute('uv'); box.deleteAttribute('normal');
    box.translate((b[0] + b[1]) / 2 * k, b[2] * k + (h - cut(h)) / 2, (b[4] + b[5]) / 2 * k);
    out.push(box.applyMatrix4(m.compose(p.set(it.x, it.y, it.z), q.setFromAxisAngle(up, it.yaw), s.set(1, 1, 1))));
  }
  return out;
}
function shadowProxies(geos) {
  // the castle stone's own material type and settings (colour and depth writes aren't part of a shader program): no new program
  proxyMat ??= new THREE.MeshStandardMaterial({ map: kitTexture('./models/castle/dungeon_texture.webp'), roughness: 0.7, metalness: 0, colorWrite: false, depthWrite: false });
  const mesh = new THREE.Mesh(mergeGeometries(geos), proxyMat);
  for (const g of geos) g.dispose();
  mesh.castShadow = true; mesh.receiveShadow = false;
  mesh.userData.cat = 'castle';
  return mesh;
}
function bucketPieces(buckets, model, meshes, items, { shadows = true, tint = null, solid = true, cat = 'castle' } = {}) {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3();
  for (const [geo, original] of meshes) {
    const mat = kitMaterial(model, original, tint), key = `${mat.uuid}|${shadows}|${solid}|${cat}`;
    const b = buckets.get(key) || buckets.set(key, { mat, shadows, solid, cat, tris: 0, cells: new Map() }).get(key);
    const base = new THREE.BufferGeometry();
    for (const a of MERGE_ATTRS) {
      if (geo.attributes[a]) base.setAttribute(a, geo.attributes[a]);
      else base.setAttribute(a, new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * (a === 'uv' ? 2 : 3)), a === 'uv' ? 2 : 3));
    }
    if (geo.index) base.setIndex(geo.index);
    const flat = base.index ? base.toNonIndexed() : base;
    for (const it of items) {
      const cell = chunkOf(it.x, it.z), list = b.cells.get(cell) || b.cells.set(cell, []).get(cell);
      list.push(flat.clone().applyMatrix4(m.compose(p.set(it.x, it.y, it.z), q.setFromAxisAngle(up, it.yaw), s.setScalar(it.s))));
      b.tris += flat.attributes.position.count / 3;
    }
  }
}
function mergedPieces(buckets) {
  const group = new THREE.Group();
  for (const { mat, shadows, solid, cat, tris, cells } of buckets.values()) {
    const parts = tris < CHUNKS.minTris ? [[...cells.values()].flat()] : [...cells.values()];
    for (const geos of parts) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
      mesh.castShadow = shadows; mesh.receiveShadow = true;
      if (solid) mesh.userData.cam = 'solid';
      mesh.userData.cat = cat;
      group.add(mesh);
      for (const g of geos) g.dispose();
    }
  }
  return group;
}
// A floor entry tiled with its model and a sprinkle of `mix` models (mostly in its outer rings, by the walls), every tile
// turned a random quarter.
function floorTiles(F) {
  const b = C.KIT_MODELS[F.model], s = C.kitScale(F.model);
  if (!b) return [];
  const tw = (b[1] - b[0]) * s, td = (b[5] - b[4]) * s, nx = Math.max(1, Math.round(F.w / tw)), nz = Math.max(1, Math.round(F.d / td));
  const rnd = seeded(F.seed * 7919 + 1), c = Math.cos(F.yaw), n = Math.sin(F.yaw), out = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const lx = (i + 0.5) * tw - nx * tw / 2, lz = (j + 0.5) * td - nz * td / 2;
    const edge = Math.min(i, j, nx - 1 - i, nz - 1 - j) < 1.5;   // the outer two rings: worn, rocky, earthy
    const pick = F.mix.length && rnd() < (edge ? 0.38 : 0.05) ? F.mix[Math.floor(rnd() * F.mix.length)] : F.model;
    out.push({ model: pick, x: F.x + lx * c + lz * n, y: 0.002, z: F.z - lx * n + lz * c, yaw: F.yaw + Math.floor(rnd() * 4) * Math.PI / 2, s: C.kitScale(pick) });
  }
  return out;
}

// ------------------------------------------------------------ torch flames and the rune circle
// Every torch's flame: an additive glow sprite (one Points draw call for all of them, flickering in its shader) and, for
// up to TORCH_LIGHTS of them (layout `light: 1` first, then the ones nearest the courtyard's middle, at least 8 m apart),
// a real point light. FLAME_AT: where the flame is in each torch model's own units.
const FLAME_UV = [994.5 / 1024, 596.5 / 1024];   // a warm yellow swatch of models/castle/dungeon_texture.webp
const CRYSTAL_UV = [90.5 / 1024, 262.5 / 1024];   // and a white one
const FLAME_AT = { 'castle/torch_mounted': [0, 0.58, 0.42], 'castle/torch_lit': [0, 0.62, 0], 'castle/torch': [0, 0.55, 0] };
// Round 20: every point light is shaded on every lit fragment, and the count can't change without recompiling, so it
// follows the tier we booted on: 6 on high and normal (4 lost the glow on the cracked wall's torches), none on low (the
// flames still glow).
export const TORCH_LIGHTS = { high: 6, normal: 6, low: 0 }[Q.boot.tier] ?? 6;
const torchLights = [], flameItems = [];
let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,236,190,1)'); r.addColorStop(0.25, 'rgba(255,170,70,0.75)'); r.addColorStop(1, 'rgba(255,110,30,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return (glowTex = new THREE.CanvasTexture(c));
}
function addTorchFlames(scene, model, items) {
  const f = FLAME_AT[model] || [0, 0.5, 0], pos = [];
  for (const it of items) {
    const c = Math.cos(it.yaw), n = Math.sin(it.yaw);
    const p = [it.x + (f[0] * c + f[2] * n) * it.s, it.y + f[1] * it.s, it.z + (-f[0] * n + f[2] * c) * it.s];
    pos.push(...p); flameItems.push({ p, light: !!it.light });
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ map: glowTexture(), size: 1.5, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffb060 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = torchTime;
    sh.vertexShader = sh.vertexShader.replace('void main() {', 'uniform float uTime;\nvoid main() {')
      .replace('gl_PointSize = size;', 'gl_PointSize = size * (0.85 + 0.15 * sin(uTime * 11.0 + position.x * 3.1 + position.z * 1.7) * sin(uTime * 6.7 + position.x));');
  };
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 5; pts.userData.cat = 'torches';
  scene.add(pts);
  // the flame itself (KayKit's mounted torch is an unlit holder): a small bright cone in each, one draw call. Round 20:
  // drawn with the torches' own material on a flame-coloured texel of the palette (FLAME_UV), which its shader makes
  // glow, so the cones need no shader program of their own.
  const cones = [];
  for (let i = 0; i < items.length; i++) {
    const c = new THREE.ConeGeometry(0.075, 0.3, 6).translate(pos[3 * i], pos[3 * i + 1] + 0.13, pos[3 * i + 2]);
    c.setAttribute('uv', new THREE.Float32BufferAttribute(Array.from({ length: c.attributes.position.count }, () => FLAME_UV).flat(), 2));
    cones.push(c.index ? c.toNonIndexed() : c);
  }
  const cone = new THREE.Mesh(mergeGeometries(cones), kitMaterial(model, null));
  for (const c of cones) c.dispose();
  cone.userData.cat = 'torches';
  scene.add(cone);
  const pick = [...flameItems].sort((a, b) => (b.light - a.light) || (Math.hypot(a.p[0], a.p[2]) - Math.hypot(b.p[0], b.p[2])));
  for (const fl of pick) {
    const at = new THREE.Vector3(...fl.p);
    if (torchLights.length >= TORCH_LIGHTS || torchLights.some(l => l.position.distanceTo(at) < 8)) continue;
    const L = new THREE.PointLight(0xff9a48, 6, 9, 1.6); L.position.copy(at); L.userData.base = 6; L.userData.ph = torchLights.length * 1.7;
    torchLights.push(L); scene.add(L);
  }
}
function torchTick() {
  const t = performance.now() / 1000;
  torchTime.value = t;
  for (const L of torchLights) L.intensity = L.userData.base * (0.82 + 0.1 * Math.sin(t * 9.0 + L.userData.ph) + 0.08 * Math.sin(t * 23.0 + L.userData.ph * 2.0));
}
// Rune circles (layout kind 'rune'): a glowing ring of runes on the floor, `r` m across, slowly pulsing, and a crystal
// hovering `h` m up over it, turning.
function buildRunes(scene) {
  for (const R of C.RUNES) {
    const g = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xa070ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    ringMat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = torchTime;
      sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying vec2 vRp;\nvoid main() {\n  vRp = position.xz;');
      sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'uniform float uTime;\nvarying vec2 vRp;\nvoid main() {')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float rr = length(vRp) / ${(R.r / 2).toFixed(3)}, a = atan(vRp.y, vRp.x);
          float band = smoothstep(0.86, 0.9, rr) * (1.0 - smoothstep(0.97, 1.0, rr)) + smoothstep(0.6, 0.63, rr) * (1.0 - smoothstep(0.66, 0.69, rr));
          float glyph = step(0.5, fract(a * 3.8197 + uTime * 0.05)) * step(0.7, rr) * (1.0 - step(0.84, rr)) * step(0.35, fract(rr * 9.0 + a * 1.9));
          diffuseColor.a *= (band + glyph * 0.8) * (0.7 + 0.3 * sin(uTime * 1.6));`);
    };
    const ring = new THREE.Mesh(new THREE.CircleGeometry(R.r / 2, 96).rotateX(-Math.PI / 2), ringMat);
    ring.position.y = 0.07;
    // (round 20: drawn with the castle stone's material type on a white texel of its palette, CRYSTAL_UV, instead of a
    // flat-shaded material of its own: one shader program fewer. A detail-0 octahedron's normals are already per face.)
    const crystalGeo = new THREE.OctahedronGeometry(0.55, 0).scale(0.75, 1.5, 0.75);
    crystalGeo.setAttribute('uv', new THREE.Float32BufferAttribute(Array.from({ length: crystalGeo.attributes.position.count }, () => CRYSTAL_UV).flat(), 2));
    const crystal = new THREE.Mesh(crystalGeo, new THREE.MeshStandardMaterial({ map: kitTexture('./models/castle/dungeon_texture.webp'), roughness: 0.25, metalness: 0,
      color: 0xc4a4ff, emissive: 0x7a40ff, emissiveIntensity: 1.4 }));
    crystal.position.y = R.h; crystal.castShadow = true;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xb080ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(3.2); halo.position.y = R.h;
    g.add(ring, crystal, halo); g.position.set(R.x, 0, R.z); g.userData.cat = 'runes';
    spinners.push(crystal);
    scene.add(g);
  }
}

// `cameraGrid: false` skips the camera blockers (the editor, which rebuilds the world after every change); `merge` (on in
// the game) merges the kit pieces by material, see bucketPieces.
export function loadModels(loader, scene, { cameraGrid = true, merge = cameraGrid } = {}) {
  const buckets = new Map(), proxyGeos = [];
  const shadowsOn = Q.boot.shadows !== 'off';
  loader.setMeshoptDecoder?.(MeshoptDecoder);   // the map's models are meshopt-compressed (tools/optimize-models.sh)
  const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));
  const solid = (o) => { o.userData.cam = 'solid'; return o; };   // the camera boom stops at it (see cameraClearance)
  // every kit model the layout places (pieces and floor tiles), each loaded once
  const placed = new Map();   // model -> [{ x, y, z, yaw, s, floor }]
  const put = (model, it) => (placed.get(model) || placed.set(model, []).get(model)).push(it);
  for (const P of C.KIT_PIECES) put(P.model, P);
  for (const F of C.FLOORS) for (const t of floorTiles(F)) put(t.model, { ...t, floor: true });
  chunkGrid([...placed.values()].flat());
  torchLights.length = 0; flameItems.length = 0;
  lodSets.length = 0;
  const lodData = merge ? fetch(KIT_LOD.json).then(r => r.json()).catch(() => null) : Promise.resolve(null);
  buildRunes(scene);
  const propModels = Object.entries(C.PROP_TYPES).filter(([, T]) => T.model);
  return Promise.all([
    load('./models/potion.glb').then(g => { models.potion = fitModel(g, C.PROP_TYPES.potion.h); }, () => {}),
    ...propModels.map(([type, T]) => load(`./models/${T.model}.glb`).then(g => {
      for (const o of g.scene.children) o.traverse(m => { if (m.isMesh) m.material = kitMaterial(T.model, m.material); });
      models.props[type] = fitModel(g, T.h);
    }, () => {})),
    ...[...placed].map(([model, items]) => Promise.all([load(`./models/${model}.glb`), lodData]).then(([g, lod]) => {
      const meshes = kitMeshes(model, g), faces = merge && lod?.models?.[model]?.faces;
      let floors = items.filter(it => it.floor), pieces = items.filter(it => !it.floor);
      // ground tiles: no shadows cast, not in the camera grid; pieces: solid to the camera, one set per tint (an
      // element-coloured banner); torches aren't solid to the camera and get a flame glow. A model with a baked far box
      // (KIT_LOD) is drawn by its LOD set instead of the merge (its tinted pieces, if any, still merge).
      if (faces && floors.length) { kitLod(scene, model, meshes, floors, faces, { cat: 'floors', solid: false }); floors = []; }
      if (floors.length) { if (merge) bucketPieces(buckets, model, meshes, floors, { shadows: false, solid: false, cat: 'floors' }); else scene.add(kitInstances(model, meshes, floors, { shadows: false })); }
      // (booted without shadows: no proxies, and casters merge with the rest, fewer draw calls)
      const proxy = merge && shadowsOn && pieces.length && castsShadow(model) && SHADOW_PROXY.models.test(model) && C.KIT_MODELS[model];
      if (proxy) proxyGeos.push(...shadowProxyGeometry(model, pieces));
      const shadows = (shadowsOn || !merge) && castsShadow(model) && !proxy, cat = kitCat(model, false);
      if (faces && !KIT_TORCH.test(model) && pieces.some(it => it.tint == null)) {
        kitLod(scene, model, meshes, pieces.filter(it => it.tint == null), faces, { cat, solid: true });
        pieces = pieces.filter(it => it.tint != null);
      }
      for (const tint of new Set(pieces.map(it => it.tint ?? null))) {
        const set = pieces.filter(it => (it.tint ?? null) === tint), torch = KIT_TORCH.test(model);
        if (merge) bucketPieces(buckets, model, meshes, set, { tint, solid: !torch, shadows, cat });
        else { const inst = kitInstances(model, meshes, set, { tint, shadows }); scene.add(torch ? inst : solid(inst)); }
      }
      if (KIT_TORCH.test(model) && pieces.length) addTorchFlames(scene, model, pieces);   // (torches never take the LOD)
    }, (err) => console.warn(`kit model ${model} failed to load`, err))),
    // the trees outside the walls: one InstancedMesh per model, impostors past LOD_DIST.tree (treeLod); booted on low,
    // impostors only (the models aren't even loaded)
    ...Object.entries(SCATTER).filter(([, items]) => items.length).map(([name, items]) => Q.boot.tier === 'low' && merge ? treeLod(scene, name, null, items) : load(`./models/${name}.glb`).then(g => {
      treeLod(scene, name, instanced(g, items, !name.endsWith('_far')), items);
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
    if (merge) scene.add(mergedPieces(buckets));
    if (proxyGeos.length) scene.add(shadowProxies(proxyGeos));
    followShadow = cameraGrid;   // the game's shadow follows the view; the editor's stays wide and static
    applyQuality();
    scene.onBeforeRender = (renderer, sc, camera) => { cutawayTick(); torchTick(); shadowFollow(camera); lodTick(camera); };
    if (cameraGrid) buildCameraGrid(scene);
  });
}

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
  // round 20: small, and a second draw call each in the shadow pass, so they cast shadows on high only
  g.traverse(o => { if (o.isMesh) { o.castShadow = quality === 'high'; o.receiveShadow = true; } });
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
    m.castShadow = quality === 'high';
    out.push(m);
  }
  return out;
}
