// Siege Keep (round 29): sky, light, the grass, and every placed kit piece, floor, brazier and deco from the layout (shared/map.js
// reads shared/layout-keep.json), plus prop mesh factories. Layout data lives in map.js; this file only draws it. Every piece is from
// the Kenney Castle Kit (models/keep, meshopt, no textures of their own) and draws with ONE material: models/keep/colormap.webp, the
// kit's palette in its warm-stone, red-roof variation. A flag or banner takes an element's colour by sampling another swatch of the
// same palette (its UVs are shifted, see tintGeometry), so tints cost no material and no shader program. The game merges the castle by
// material (a few draw calls); the editor keeps one InstancedMesh per piece model and rebuilds after every change.
import * as THREE from 'three';
import * as C from '../shared/constants.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as Q from './quality.js';   // round 20: the graphics tier (spells)

const flat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0.0, ...extra });

// ------------------------------------------------------------ maps (round 22): build, clear, preload, switch
// Everything this module puts in the scene is tagged (addW), so switchMap can take it out again and build the next map while the
// wizards, props and effects stay. GLBs are fetched once per page (glbs): preloadMap warms the next map's models in the background.
const addW = (scene, ...objs) => { for (const o of objs) o.userData.world = true; scene.add(...objs); };
const glbs = new Map();   // url -> Promise<gltf>
const loadGlb = (loader, url) => glbs.get(url) ?? glbs.set(url, new Promise((res, rej) => loader.load(url, res, undefined, (err) => { glbs.delete(url); rej(err); }))).get(url);
function clearWorld(scene) {
  const keep = new Set(Object.values(kitGeo).flat().map(([g]) => g));   // the kit geometries are cached for the next build
  for (const o of [...scene.children]) {
    if (!o.userData.world) continue;
    scene.remove(o);
    o.traverse(m => { if ((m.isMesh || m.isPoints || m.isSprite || m.isLine) && m.geometry && !keep.has(m.geometry)) m.geometry.dispose(); });
  }
  spinners.length = 0; torchLights.length = 0; flameItems.length = 0;
  for (const L of scene.userData.torchPool || []) { L.userData.base = 0; L.intensity = 0; }
  camGrid = null; followShadow = false;
  scene.onBeforeRender = () => {};
}
// The models a map's layout places (its kit pieces and decos), for preloading.
function mapModels(layout) {
  const out = new Set();
  for (const e of layout?.entries || []) {
    if (e.kind === 'kit' && e.model in C.KIT_MODELS) out.add(e.model);
    else if (e.kind === 'deco' && e.model) out.add(e.model);
  }
  return [...out];
}
// Fetch a map's layout and its models now, so a later switchMap to it is quick (nothing changes on screen).
export async function preloadMap(loader, name) {
  const M = await C.loadMap(name);
  loader.setMeshoptDecoder?.(MeshoptDecoder);
  await Promise.all(mapModels(M.layout).map(m => loadGlb(loader, `./models/${m}.glb`).catch(() => {})));
  return M;
}
// Take the current map's world out of the scene and build `name`'s in its place (the map data switches too: map.js setActiveMap).
// Resolves when the new world is loaded. Call it under a fade; the camera grid and torches are rebuilt for the new map.
export async function switchMap(loader, scene, name) {
  await C.loadMap(name);
  clearWorld(scene);
  C.setActiveMap(name);
  buildWorld(scene);
  await loadModels(loader, scene);
  return C.ACTIVE_MAP.name;
}

// The ground: flat inside the arena, rising into rolling hills from just past the arena's circle.
export function groundHeight(x, z) {
  const r = Math.hypot(x, z);
  const rise = Math.max(0, r - C.ARENA_RADIUS - 2);
  return rise > 0 ? rise * 0.3 + Math.sin(x * 0.35) * Math.cos(z * 0.3) * Math.min(1.5, rise * 0.3) : 0;
}

// ------------------------------------------------------------ the grass (Ty's tileable grass)
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
let skyTex = null;

// ------------------------------------------------------------ quality tiers (round 20)
// quality.js (spells) owns the tier; world.js follows it (onQuality): the sun's shadow map (quality.js's shadowSize, and how far
// round the view it reaches). Whether there are shadows at all and how many torch lights there are follow the tier we *booted* on
// (changing either recompiles every lit shader). In the game the shadow camera follows the view (see shadowFollow); the editor keeps
// one wide static shadow.
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
  // a fresh build (the editor builds again after every change): scatter the scenery outside the field for this layout
  spinners.length = 0;
  computeScatter();
  if (skyTex) scene.background = skyTex;   // (round 22: the one texture for every build; a fresh one compiled another background program)
  else {
    scene.background = new THREE.Color(SKY.horizon);
    new THREE.TextureLoader().load('./textures/sky.jpg', (tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      scene.background = skyTex = tex;
    });
  }
  scene.fog = new THREE.Fog(SKY.fog, 60, 175);

  // a cool blue sky light and warm sunbeams, as in the painting. Round 22: the lights are made once per scene and kept through a
  // map switch (they aren't tagged world): a frame with fewer lights would recompile every lit shader, and again when they came back.
  if (!scene.userData.worldLights) {
    const hemi = new THREE.HemisphereLight(0xd6efff, 0x6a6a58, 1.15);
    const sunLight = new THREE.DirectionalLight(0xffe9c4, 2.3);
    scene.add(hemi, sunLight, sunLight.target);
    scene.userData.worldLights = { hemi, sun: sunLight };
  }
  sun = scene.userData.worldLights.sun;
  sun.position.copy(SUN_DIR).multiplyScalar(SUN_DIST); sun.target.position.set(0, 0, 0);
  sun.castShadow = Q.boot.shadows !== 'off';   // (from the start: a light that stops casting later recompiles every lit shader)
  sun.shadow.mapSize.set(2048, 2048);
  // the editor's static shadow covers the field and the trees round it; the game's follows the view (applyQuality)
  sun.shadow.camera.left = -42; sun.shadow.camera.right = 42;
  sun.shadow.camera.top = 42; sun.shadow.camera.bottom = -42;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 130;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  followShadow = false;

  // Ground: a big grid, flat inside the arena and rising into rolling hills outside it, all Ty's grass. The courtyard's paving and the
  // moat are drawn over it (layout 'floor' entries, see loadModels). (round 20: its grid follows the boot tier)
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
  ground.userData.cat = 'ground'; ground.userData.grass = true;
  addW(scene, ground);

  const vista = mountainVista();
  vista.userData.cat = 'mountains';
  addW(scene, vista);
  return { sun };
}

// Distant mountains (round 13): Ty's painted vista (textures/sky/mountain_vista.webp: the peaks and the mist band, the
// sky above them keyed to alpha so the painted skybox shows through) wrapped round the horizon on one open cylinder
// far past the hills, unlit, in one draw call. Mirrored tiles meet seamlessly; a smooth variation round the ring (a
// whole number of periods, so it closes) changes the peaks' height and tint so neighbouring tiles don't read as twins.
// The cylinder's foot hides behind the hills (they top out about 23 m up at the ground's edge, 120 m out); the haze
// toward its foot is the fog's colour. Turned so the paintings' warm, lit flank faces the sun.
const VISTA = { r: 160, y0: 24, h: 44, tiles: 6 };
function mountainVista(V = VISTA) {
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
  const geo = new THREE.CylinderGeometry(V.r, V.r, V.h, 160, 1, true).translate(0, V.y0 + V.h / 2, 0);
  const m = new THREE.Mesh(geo, mat);
  m.rotation.y = 0.35;
  m.renderOrder = -1; m.frustumCulled = false;
  return m;
}

export const spinners = [];

// ------------------------------------------------------------ the kit's one material and its palette
// models/keep/colormap.webp is Kenney's 512 px palette (variation a: warm stone, red roofs and accents, green trees). Every piece,
// floor, brazier, flame cone and the drawbridge's chains sample it; a glTF texture's v runs down, so it isn't flipped. TEXEL: the
// swatches this file samples directly, as uv. SWATCH: the palette's colour columns (32 px each, v 0.5..0.75), which a tint moves a
// flag's accent texels between.
const kitTex = {};
function kitTexture(url) {
  if (kitTex[url]) return kitTex[url];
  const t = new THREE.TextureLoader().load(url);
  t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = 4;
  return (kitTex[url] = t);
}
const PALETTE = './models/keep/colormap.webp';
const px = (x, y) => [(x + 0.5) / 512, (y + 0.5) / 512];
const TEXEL = { stone: px(136, 452), sand: px(424, 430), dirt: px(360, 499), water: px(360, 345), waterDeep: px(360, 378), iron: px(40, 420),
  ember: px(232, 300), flame: px(104, 268), wood: px(296, 470), white: px(208, 420) };
let kitMat = null, flameMat = null;
const kitMaterial = () => kitMat ??= new THREE.MeshStandardMaterial({ map: kitTexture(PALETTE), roughness: 0.82, metalness: 0 });
// The flame cones: the palette's warm swatches, unlit and bright (a basic material: the one extra program the fires add)
const flameMaterial = () => flameMat ??= new THREE.MeshBasicMaterial({ map: kitTexture(PALETTE), color: 0xffe0b0 });
const texelUV = (geo, t) => { const a = geo.attributes.uv; for (let i = 0; i < a.count; i++) a.setXY(i, t[0], t[1]); return geo; };
// The element colours a tint names (layout `tint`, '#rrggbb'): the nearest of the palette's accent columns. A flag's accent texels
// sit in the red column (u 256..320 px, v 256..384 px); a tint moves them to the same rows of another column.
const SWATCH = { red: 256, yellow: 64, orange: 128, green: 0, blue: 320, purple: 384 };
const SWATCH_RGB = { red: [222, 67, 62], yellow: [255, 192, 68], orange: [255, 126, 68], green: [97, 203, 139], blue: [140, 180, 245], purple: [168, 120, 232] };
function swatchOf(tint) {
  if (tint == null) return null;
  if (String(tint) in SWATCH) return String(tint);
  const c = new THREE.Color(tint), rgb = [c.r * 255, c.g * 255, c.b * 255];
  let best = 'red', d = Infinity;
  for (const [k, v] of Object.entries(SWATCH_RGB)) { const e = v.reduce((s, q, i) => s + (q - rgb[i]) ** 2, 0); if (e < d) { d = e; best = k; } }
  return best;
}
function tintGeometry(geo, tint) {
  const sw = swatchOf(tint);
  if (!sw || sw === 'red') return geo;
  const g = geo.clone(), a = g.attributes.uv, du = (SWATCH[sw] - SWATCH.red) / 512;
  for (let i = 0; i < a.count; i++) {
    const u = a.getX(i), v = a.getY(i);
    if (u >= 256 / 512 && u < 320 / 512 && v >= 256 / 512 && v < 384 / 512) a.setX(i, u + du);
  }
  return g;
}

// ------------------------------------------------------------ the drawbridge (round 24; round 29: the Kenney bridge-draw model)
// map.js DRAWBRIDGES: the hinge, the slab's size and the direction it extends when down. The kit's drawbridge (planks between two
// kerbs, 1 unit long from its hinge at x 0 toward -x, 0.84 wide, 0.1 thick) stretched to the slab, pivoted at the hinge, and two
// chains from the gatehouse above the gate to its far corners. Nothing here knows the cycle: main.js calls setDrawbridgeAngle(id, a)
// every frame with the spells agent's drawbridgeAngle(matchTime) (0 down, pi/2 up).
const CHAIN_ANCHOR = { back: 0.25, up: 3.9 };
const DECK_Y = 0.03;   // the bridge-draw model's planks, over its foot (its kerbs reach 0.1)   // behind the hinge (toward the gate) and above it, at the slab's width
const drawbridges = new Map();   // id -> { pivot, chains: [{ mesh, from }], D }
function buildDrawbridges(scene, loader) {
  drawbridges.clear();
  const mat = kitMaterial();
  for (const D of C.DRAWBRIDGES || []) {
    const root = new THREE.Group(); root.position.set(D.x, D.y, D.z); root.rotation.y = D.yaw;   // local +z: the slab's direction when down
    const pivot = new THREE.Group(); root.add(pivot);
    // a plain plank slab until the model is in (and if it never loads)
    const stand = new THREE.Mesh(texelUV(new THREE.BoxGeometry(D.w, D.thick, D.d).translate(0, -D.thick / 2, D.d / 2), TEXEL.wood), mat);
    stand.castShadow = true; stand.receiveShadow = true; stand.userData.cat = 'keep';
    pivot.add(stand);
    loadGlb(loader, './models/keep/bridge-draw.glb').then(g => {
      const meshes = kitGeo['keep/bridge-draw'] || kitMeshes('keep/bridge-draw', g), b = C.KIT_MODELS['keep/bridge-draw'];
      const geo = mergeGeometries(meshes.map(([m]) => { const q = m.clone(); for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(k)) q.deleteAttribute(k); return q.index ? q.toNonIndexed() : q; }));
      // model: length along -x from the hinge, width along z, its top at y 0.1. Pivot frame: length along +z, its top at y 0.
      geo.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2));
      const sy = D.thick / (b[3] - b[2]);
      geo.applyMatrix4(new THREE.Matrix4().makeScale(D.w / (b[5] - b[4]), sy, D.d / (b[1] - b[0])));
      geo.translate(0, -DECK_Y * sy, 0);   // its planks at the hinge (the walked surface), the kerbs standing up from them
      const slab = new THREE.Mesh(geo, mat);
      slab.castShadow = true; slab.receiveShadow = true; slab.userData.cat = 'keep';
      pivot.remove(stand); stand.geometry.dispose(); pivot.add(slab);
    }, () => {});
    const chains = [-1, 1].map(sx => {
      const mesh = new THREE.Mesh(texelUV(new THREE.BoxGeometry(0.08, 0.08, 1), TEXEL.iron), mat);
      mesh.castShadow = false; mesh.userData.cat = 'keep'; root.add(mesh);
      return { mesh, from: new THREE.Vector3(sx * (D.w / 2 - 0.1), CHAIN_ANCHOR.up, -CHAIN_ANCHOR.back) };
    });
    addW(scene, root);
    drawbridges.set(D.id, { pivot, chains, D, angle: null });
    setDrawbridgeAngle(D.id, 0);
  }
}
const _to = new THREE.Vector3(), _mid = new THREE.Vector3();
export function setDrawbridgeAngle(id, a) {
  const B = drawbridges.get(id);
  if (!B || B.angle === a) return;
  B.angle = a; B.pivot.rotation.x = -a;   // the far end rises
  for (const ch of B.chains) {
    _to.set(ch.from.x, B.D.d * Math.sin(a) + 0.05, B.D.d * Math.cos(a) - 0.25);   // the slab's far corner (its kerb), in the root's frame
    _mid.addVectors(ch.from, _to).multiplyScalar(0.5);
    ch.mesh.position.copy(_mid); ch.mesh.lookAt(ch.mesh.parent.localToWorld(_to.clone())); ch.mesh.scale.z = ch.from.distanceTo(_to);
  }
}

// ------------------------------------------------------------ models
// `models` holds the ones other modules clone: the potion barrel and the prop pieces (by PROP_TYPES type).
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

// ------------------------------------------------------------ the scenery outside the field (instanced, seeded)
// Seeded so every client draws the same scatter. [x, z, yaw, height] per instance, by kit model: a loose line of rocks and small
// trees just outside the field's edge (it reads as the camp's boundary), a ring of trees past it, and many more out on the hills.
// Kenney's trees are about 200 triangles, so there's no impostor or distance LOD (round 20's were for 1-5k-triangle trees).
function seeded(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
const SCATTER = { 'keep/tree-large': [], 'keep/tree-small': [], 'keep/rocks-large': [], 'keep/rocks-small': [] };
const SCATTER_H = { 'keep/tree-large': 7.4, 'keep/tree-small': 5.4, 'keep/rocks-large': 1.6, 'keep/rocks-small': 1.3 };
// Recomputed by buildWorld() from the current layout (the editor rebuilds the world after every change).
function computeScatter() {
  for (const k in SCATTER) SCATTER[k].length = 0;
  const B = C.ARENA_BOUNDS, FT = C.SCATTER_SETTINGS.farTrees || {}, rnd = seeded(FT.seed ?? 42);
  const outside = (x, z, clear) => x < B.x0 - clear || x > B.x1 + clear || z < B.z0 - clear || z > B.z1 + clear;
  const put = (m, x, z, h) => SCATTER[m].push([x, z, rnd() * 6.3, h]);
  const near = (x, z, d) => Object.values(SCATTER).some(list => list.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < d));
  // the field's edge: every 3-5 m along the bounds, 1-3 m out, a rock or a small tree
  if (FT.edge ?? 1) for (const [ax, az, bx, bz] of [[B.x0, B.z0, B.x1, B.z0], [B.x1, B.z0, B.x1, B.z1], [B.x1, B.z1, B.x0, B.z1], [B.x0, B.z1, B.x0, B.z0]]) {
    const len = Math.hypot(bx - ax, bz - az), nx = (bz - az) / len, nz = -(bx - ax) / len;   // the outward normal (the loop runs anticlockwise)
    for (let t = 2 + rnd() * 2; t < len; t += 3 + rnd() * 2) {
      const out = 1.2 + rnd() * 2, x = ax + (bx - ax) * t / len + nx * out, z = az + (bz - az) * t / len + nz * out, pick = rnd();
      const m = pick < 0.45 ? 'keep/rocks-small' : pick < 0.65 ? 'keep/rocks-large' : 'keep/tree-small';
      put(m, x, z, SCATTER_H[m] * (0.7 + rnd() * 0.6));
    }
  }
  // a loose ring of full trees round the field, seen from the walls
  for (let i = 0, n = 0; n < (FT.near ?? 26) && i < 3000; i++) {
    const a = rnd() * Math.PI * 2, r = 36 + rnd() * 16, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!outside(x, z, 5) || near(x, z, 4.5)) continue;
    const m = rnd() < 0.6 ? 'keep/tree-large' : 'keep/tree-small';
    put(m, x, z, SCATTER_H[m] * (0.8 + rnd() * 0.5)); n++;
  }
  for (let i = 0; i < (FT.count ?? 90); i++) {
    const a = rnd() * Math.PI * 2, r = C.ARENA_RADIUS + 12 + Math.pow(rnd(), 0.7) * 45, pick = rnd();
    const m = pick < 0.55 ? 'keep/tree-large' : pick < 0.85 ? 'keep/tree-small' : 'keep/rocks-large';
    put(m, Math.cos(a) * r, Math.sin(a) * r, SCATTER_H[m] * (0.8 + rnd() * 0.6) * (m === 'keep/rocks-large' ? 2 : 1));
  }
}
// One InstancedMesh per mesh in the model, normalised to 1 m tall with its base on y = 0 (centred on x/z) and scaled to each
// instance's height, on the terrain. Drawn with the kit's material.
function instanced(model, meshes, items, shadows = true) {
  const b = C.KIT_MODELS[model], H = b ? b[3] - b[2] : 1;
  const norm = new THREE.Matrix4().makeScale(1 / H, 1 / H, 1 / H).multiply(new THREE.Matrix4().makeTranslation(b ? -(b[0] + b[1]) / 2 : 0, b ? -b[2] : 0, b ? -(b[4] + b[5]) / 2 : 0));
  const group = new THREE.Group(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const [geo] of meshes) {
    const im = new THREE.InstancedMesh(geo.clone().applyMatrix4(norm), kitMaterial(), items.length);
    items.forEach(([x, z, yaw, h], i) => im.setMatrixAt(i, m.compose(new THREE.Vector3(x, groundHeight(x, z) - 0.04 * h, z), q.setFromAxisAngle(up, yaw), new THREE.Vector3(h, h, h))));
    im.castShadow = shadows; im.receiveShadow = true;
    im.computeBoundingSphere();
    im.userData.cat = 'scenery';
    group.add(im);
  }
  return group;
}

// ------------------------------------------------------------ kit pieces, floors, braziers and decos from the layout
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
// What a piece is, for shadows, the camera and the editor's categories.
const isFlag = (model) => /\/flag/.test(model);
const isTree = (model) => /\/tree-(large|small)$/.test(model);
// Only the big pieces cast shadows (walls, towers, siege engines, rocks, trees); flags, gates and logs don't.
function castsShadow(model) {
  if (isFlag(model) || /gate|door|log|stud/.test(model)) return false;
  const b = C.KIT_MODELS[model], s = C.kitScale(model);
  return !b || (b[3] - b[2]) * s >= 1.5 || Math.max(b[1] - b[0], b[5] - b[4]) * s >= 2.5;
}
const kitCat = (model) => isFlag(model) ? 'flags' : /siege/.test(model) ? 'siege' : /tree|rocks|ground/.test(model) ? 'scenery' : 'keep';
// One InstancedMesh per mesh of `model` for the given placements { x, y, z, yaw, s } (the editor; a tint is its own set).
function kitInstances(model, meshes, items, { shadows = true, tint = null } = {}) {
  const group = new THREE.Group(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3();
  for (const [geo] of meshes) {
    const im = new THREE.InstancedMesh(tintGeometry(geo, tint), kitMaterial(), items.length);
    items.forEach((it, i) => im.setMatrixAt(i, m.compose(p.set(it.x, it.y, it.z), q.setFromAxisAngle(up, it.yaw), s.setScalar(it.s))));
    im.castShadow = shadows; im.receiveShadow = true;
    im.computeBoundingSphere();
    im.userData.kit = model;
    group.add(im);
  }
  return group;
}
// The game merges the castle instead: it never moves, so every piece with the same shadow and camera setting becomes one mesh (all
// share the one material), a handful of draw calls for the whole map. A big bucket is split into a 2 x 2 grid of chunks over the map,
// so the view and the shadow camera skip the chunks they can't see. Each bucket: { shadows, solid, cat, tris, cells: Map(chunk -> geometries) }.
const MERGE_ATTRS = ['position', 'normal', 'uv'];
const CHUNKS = { n: 2, minTris: 15000 };   // buckets under minTris stay one mesh
let chunkOf = () => 0;
function chunkGrid(items) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const it of items) { x0 = Math.min(x0, it.x); x1 = Math.max(x1, it.x); z0 = Math.min(z0, it.z); z1 = Math.max(z1, it.z); }
  const w = (x1 - x0) / CHUNKS.n + 1e-3, d = (z1 - z0) / CHUNKS.n + 1e-3;
  chunkOf = (x, z) => Math.min(CHUNKS.n - 1, Math.max(0, Math.floor((x - x0) / w))) + CHUNKS.n * Math.min(CHUNKS.n - 1, Math.max(0, Math.floor((z - z0) / d)));
}
function flatGeometry(geo) {
  const base = new THREE.BufferGeometry();
  for (const a of MERGE_ATTRS) {
    if (geo.attributes[a]) base.setAttribute(a, geo.attributes[a]);
    else base.setAttribute(a, new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * (a === 'uv' ? 2 : 3)), a === 'uv' ? 2 : 3));
  }
  if (geo.index) base.setIndex(geo.index);
  return base.index ? base.toNonIndexed() : base;
}
function bucketGeometries(buckets, geos, x, z, { shadows = true, solid = true, cat = 'keep' } = {}) {
  const key = `${shadows}|${solid}|${cat}`;
  const b = buckets.get(key) || buckets.set(key, { shadows, solid, cat, tris: 0, cells: new Map() }).get(key);
  const cell = chunkOf(x, z), list = b.cells.get(cell) || b.cells.set(cell, []).get(cell);
  for (const g of geos) { list.push(g); b.tris += g.attributes.position.count / 3; }
}
function bucketPieces(buckets, model, meshes, items, opts = {}) {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3();
  const flats = new Map();   // tint -> the model's flattened (and tinted) geometries
  for (const it of items) {
    const t = swatchOf(it.tint) ?? 'red';
    if (!flats.has(t)) flats.set(t, meshes.map(([geo]) => flatGeometry(tintGeometry(geo, t))));
    const mat4 = m.compose(p.set(it.x, it.y, it.z), q.setFromAxisAngle(up, it.yaw), s.setScalar(it.s));
    bucketGeometries(buckets, flats.get(t).map(g => g.clone().applyMatrix4(mat4)), it.x, it.z, opts);
  }
}
function mergedPieces(buckets) {
  const group = new THREE.Group();
  for (const { shadows, solid, cat, tris, cells } of buckets.values()) {
    const parts = tris < CHUNKS.minTris ? [[...cells.values()].flat()] : [...cells.values()];
    for (const geos of parts) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), kitMaterial());
      mesh.castShadow = shadows; mesh.receiveShadow = true;
      if (solid) mesh.userData.cam = 'solid';
      mesh.userData.cat = cat;
      group.add(mesh);
      for (const g of geos) g.dispose();
    }
  }
  return group;
}
// A floor entry with a `tone`: a flat paving in one palette colour, just over the grass (water a little lower than paving would
// be: it never overlaps any). Its edges carry a darker rim of the same tone, so the moat reads as water against the grass.
const TONE_Y = { stone: 0.03, sand: 0.03, dirt: 0.025, water: 0.02 };
function floorGeometries(F) {
  const t = TEXEL[F.tone] || TEXEL.stone, y = TONE_Y[F.tone] ?? 0.03, out = [];
  const plane = (w, d, lx, lz, tex, dy = 0) => {
    const g = texelUV(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), tex);
    g.translate(lx, y + dy, lz).rotateY(F.yaw).translate(F.x, 0, F.z);
    out.push(g);
  };
  plane(F.w, F.d, 0, 0, t);
  if (F.tone === 'water') {   // the banks: a deeper blue strip along the two long sides
    const rim = Math.min(0.6, Math.min(F.w, F.d) * 0.15), long = F.w >= F.d;
    for (const s of [-1, 1]) long ? plane(F.w, rim, 0, s * (F.d / 2 - rim / 2), TEXEL.waterDeep, 0.002) : plane(rim, F.d, s * (F.w / 2 - rim / 2), 0, TEXEL.waterDeep, 0.002);
  }
  return out;
}

// ------------------------------------------------------------ braziers, torches and their flames
// map.js BRAZIERS: a bowl on three legs (solid, a short post in COLLIDERS) or a pole torch, built from boxes and cylinders on the
// palette's iron and wood texels (no model); each fire is a flame cone (flameMaterial) and a glow (one Points draw call for all of
// them, flickering in its shader). Up to TORCH_LIGHTS of them (layout `light: 1` first, then the ones nearest the middle, at least
// 8 m apart) get a real point light.
const FIRE_AT = { bowl: 1.22, torch: 2.2 };   // the flame's height over the brazier's foot
function brazierGeometries(B) {
  const out = [], at = (g, tex) => { texelUV(g, tex); g.translate(B.x, B.y, B.z); out.push(g.index ? g.toNonIndexed() : g); };
  if (B.style === 'torch') {
    at(new THREE.CylinderGeometry(0.06, 0.08, 2.05, 6).translate(0, 1.02, 0), TEXEL.wood);
    at(new THREE.CylinderGeometry(0.16, 0.09, 0.18, 6).translate(0, 2.1, 0), TEXEL.iron);
    return out;
  }
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2, leg = new THREE.BoxGeometry(0.07, 1.05, 0.07);
    leg.rotateZ(0.16).rotateY(-a).translate(Math.cos(a) * 0.24, 0.52, Math.sin(a) * 0.24);
    at(leg, TEXEL.iron);
  }
  at(new THREE.CylinderGeometry(0.46, 0.26, 0.3, 8).translate(0, 1.05, 0), TEXEL.iron);
  at(new THREE.CylinderGeometry(0.38, 0.38, 0.06, 8).translate(0, 1.17, 0), TEXEL.ember);
  return out;
}
export const TORCH_LIGHTS = { high: 6, normal: 6, low: 0 }[Q.boot.tier] ?? 6;
const torchLights = [], flameItems = [];
const torchTime = { value: 0 };
let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,236,190,1)'); r.addColorStop(0.25, 'rgba(255,170,70,0.75)'); r.addColorStop(1, 'rgba(255,110,30,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return (glowTex = new THREE.CanvasTexture(c));
}
function addFires(scene, fires) {   // fires: [{ p: [x, y, z], light, big }]
  if (!fires.length) return;
  const pos = [];
  for (const f of fires) { pos.push(...f.p); flameItems.push(f); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ map: glowTexture(), size: 2.2, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffb060 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = torchTime;
    sh.vertexShader = sh.vertexShader.replace('void main() {', 'uniform float uTime;\nvoid main() {')
      .replace('gl_PointSize = size;', 'gl_PointSize = size * (0.85 + 0.15 * sin(uTime * 11.0 + position.x * 3.1 + position.z * 1.7) * sin(uTime * 6.7 + position.x));');
  };
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 5; pts.userData.cat = 'torches';
  addW(scene, pts);
  // the flames themselves: a few tongues per fire (a bowl's bigger), on the palette's yellow and orange
  const cones = [];
  for (const f of fires) {
    const n = f.big ? 4 : 1;
    for (let k = 0; k < n; k++) {
      const a = k / n * Math.PI * 2 + 0.4, rr = f.big ? 0.15 : 0, h = f.big ? 0.55 - 0.08 * k : 0.34;
      const c = new THREE.ConeGeometry(f.big ? 0.16 : 0.09, h, 6).translate(f.p[0] + Math.cos(a) * rr, f.p[1] - 0.08 + h / 2, f.p[2] + Math.sin(a) * rr);
      cones.push(texelUV(c.index ? c.toNonIndexed() : c, k % 2 ? TEXEL.ember : TEXEL.flame));
    }
  }
  const cone = new THREE.Mesh(mergeGeometries(cones), flameMaterial());
  for (const c of cones) c.dispose();
  cone.userData.cat = 'torches';
  addW(scene, cone);
  const pick = [...flameItems].sort((a, b) => (b.light - a.light) || (Math.hypot(a.p[0], a.p[2]) - Math.hypot(b.p[0], b.p[2])));
  const pool = scene.userData.torchPool ??= Array.from({ length: TORCH_LIGHTS }, (_, i) => { const L = new THREE.PointLight(0xff9a48, 0, 10, 1.6); L.userData.base = 0; L.userData.ph = i * 1.7; scene.add(L); return L; });
  const used = [];
  for (const fl of pick) {
    const at = new THREE.Vector3(fl.p[0], fl.p[1] + 0.4, fl.p[2]);
    if (used.length >= pool.length || used.some(l => l.position.distanceTo(at) < 8)) continue;
    const L = pool[used.length]; L.position.copy(at); L.userData.base = 7; L.intensity = 7;
    used.push(L);
  }
  torchLights.length = 0; torchLights.push(...used);
  for (const L of pool) if (!used.includes(L)) { L.userData.base = 0; L.intensity = 0; L.position.set(0, -50, 0); }
}
function torchTick() {
  const t = performance.now() / 1000;
  torchTime.value = t;
  for (const L of torchLights) L.intensity = L.userData.base * (0.82 + 0.1 * Math.sin(t * 9.0 + L.userData.ph) + 0.08 * Math.sin(t * 23.0 + L.userData.ph * 2.0));
}
// Rune circles (layout kind 'circle'): a glowing ring of runes on the floor, `r` m across, slowly pulsing, and a crystal hovering
// `h` m up over it, turning (the crystal on the palette's white texel, the halo carrying the glow).
function buildRunes(scene) {
  for (const R of C.RUNE_CIRCLES) {
    const g = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xa070ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8, forceSinglePass: true });
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
    const crystalGeo = texelUV(new THREE.OctahedronGeometry(0.55, 0).scale(0.75, 1.5, 0.75), TEXEL.white);
    const crystal = new THREE.Mesh(crystalGeo, kitMaterial());
    crystal.position.y = R.h; crystal.castShadow = true;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xb080ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.setScalar(3.6); halo.position.y = R.h;
    g.add(ring, crystal, halo); g.position.set(R.x, R.y || 0, R.z); g.userData.cat = 'runes';
    spinners.push(crystal);
    addW(scene, g);
  }
}

// `cameraGrid: false` skips the camera blockers (the editor, which rebuilds the world after every change); `merge` (on in
// the game) merges the kit pieces, see bucketPieces.
export function loadModels(loader, scene, { cameraGrid = true, merge = cameraGrid } = {}) {
  const buckets = new Map();
  const shadowsOn = Q.boot.shadows !== 'off';
  loader.setMeshoptDecoder?.(MeshoptDecoder);   // the map's models are meshopt-compressed (tools/optimize-models.sh)
  const load = (url) => loadGlb(loader, url);   // (round 22: fetched once per page; preloadMap warms the next map's)
  const solid = (o) => { o.userData.cam = 'solid'; return o; };   // the camera boom stops at it (see cameraClearance)
  // every kit model the layout places, each loaded once
  const placed = new Map();   // model -> [{ x, y, z, yaw, s, tint }]
  for (const P of C.KIT_PIECES) (placed.get(P.model) || placed.set(P.model, []).get(P.model)).push(P);
  chunkGrid([...placed.values()].flat().concat(C.FLOORS));
  torchLights.length = 0; flameItems.length = 0;
  buildRunes(scene);
  buildDrawbridges(scene, loader);
  // the floors (paving, the moat, the road) and the braziers: built here, merged with the castle in the game
  const floorGeos = C.FLOORS.filter(F => F.tone).map(F => [F, floorGeometries(F)]);
  const brazierGeos = (C.BRAZIERS || []).map(B => [B, brazierGeometries(B)]);
  if (merge) {
    for (const [F, geos] of floorGeos) bucketGeometries(buckets, geos, F.x, F.z, { shadows: false, solid: false, cat: 'floors' });
    for (const [B, geos] of brazierGeos) bucketGeometries(buckets, geos, B.x, B.z, { shadows: shadowsOn && B.style !== 'torch', solid: false, cat: 'torches' });
  } else {
    for (const [, geos] of [...floorGeos, ...brazierGeos]) { const m = new THREE.Mesh(mergeGeometries(geos), kitMaterial()); m.receiveShadow = true; m.userData.cat = 'floors'; for (const g of geos) g.dispose(); addW(scene, m); }
  }
  addFires(scene, (C.BRAZIERS || []).map(B => ({ p: [B.x, B.y + FIRE_AT[B.style], B.z], light: B.light, big: B.style !== 'torch' })));
  const propModels = Object.entries(C.PROP_TYPES).filter(([, T]) => T.model);
  return Promise.all([
    load('./models/potion.glb').then(g => { models.potion = fitModel(g, C.PROP_TYPES.potion.h); }, () => {}),
    ...propModels.map(([type, T]) => load(`./models/${T.model}.glb`).then(g => {
      for (const o of g.scene.children) o.traverse(m => { if (m.isMesh) m.material = propMaterial(); });
      models.props[type] = fitModel(g, T.h);
    }, () => {})),
    ...[...placed].map(([model, items]) => (kitGeo[model] ? Promise.resolve(null) : load(`./models/${model}.glb`)).then((g) => {
      const meshes = kitGeo[model] || kitMeshes(model, g);
      // flags, gates and the like cast no shadow; trees aren't solid to the camera (their canopies would keep snapping it in)
      const shadows = (shadowsOn || !merge) && castsShadow(model), cat = kitCat(model), camSolid = !isFlag(model) && !isTree(model);
      if (merge) bucketPieces(buckets, model, meshes, items, { shadows, solid: camSolid, cat });
      else for (const tint of new Set(items.map(it => it.tint ?? null))) {
        const inst = kitInstances(model, meshes, items.filter(it => (it.tint ?? null) === tint), { tint, shadows });
        addW(scene, camSolid ? solid(inst) : inst);
      }
    }, (err) => console.warn(`kit model ${model} failed to load`, err))),
    // the scenery outside the field: one InstancedMesh per model (they don't merge: hundreds of instances of a few hundred triangles)
    ...Object.entries(SCATTER).filter(([, items]) => items.length).map(([model, items]) => (kitGeo[model] ? Promise.resolve(null) : load(`./models/${model}.glb`)).then(g => {
      const grp = instanced(model, kitGeo[model] || kitMeshes(model, g), items, /tree/.test(model));
      addW(scene, grp);
    }, () => {})),
    // decoration placed in the map editor (layout kind 'deco'): any other model, fitted to its height
    ...[...new Set(C.DECOS.map(d => d.model))].map(name => load(`./models/${name}.glb`).then(g => {
      const unit = fitModel(g, 1);
      for (const d of C.DECOS.filter(q => q.model === name)) {
        const holder = new THREE.Group(); holder.add(unit.clone());
        solid(holder);
        holder.position.set(d.x, d.y, d.z); holder.rotation.y = d.yaw; holder.scale.setScalar(d.h);
        addW(scene, holder);
      }
    }, () => {})),
  ]).then(() => {
    if (merge) addW(scene, mergedPieces(buckets));
    followShadow = cameraGrid;   // the game's shadow follows the view; the editor's stays wide and static
    applyQuality();
    scene.onBeforeRender = (renderer, sc, camera) => { cutawayTick(); torchTick(); shadowFollow(camera); };
    if (cameraGrid) buildCameraGrid(scene);
  });
}
// The prop pieces (four KayKit models kept in models/keep/props/) sample their own small palette.
let propMat = null;
const propMaterial = () => propMat ??= (() => { const t = new THREE.TextureLoader().load('./models/keep/props/palette.webp'); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; return new THREE.MeshStandardMaterial({ map: t, roughness: 0.75, metalness: 0 }); })();

// ------------------------------------------------------------ camera blockers
// The third-person camera mustn't end up inside a wall. Once the models are placed, the triangles of every model tagged solid
// (userData.cam: every kit piece except flags and trees, the decos) are rasterised into a coarse world grid, and cameraClearance()
// walks the boom through it. Props move and stay out; round decos and braziers are COLLIDERS too, which main.js already checks.
const CAM = { cell: 0.4, half: C.ARENA_RADIUS + 8, y0: -2, y1: 30, pad: 0.22, margin: 0.25 };
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

// The over-the-shoulder camera's see-through (round 14): main.js calls cameraCutaway(target) every frame the camera is live. Round 29:
// nothing on the keep needs it (its trees aren't solid to the camera and stand out of the way), so it only keeps the call's contract.
let cutOn = false, cutFresh = false;
export function cameraCutaway(target) { cutOn = !!target; cutFresh = !!target; }
function cutawayTick() { if (!cutFresh) cutOn = false; cutFresh = false; }

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
