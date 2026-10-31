// Wizard looks (characters track): the KayKit bodies, their clips, and the element look of a loadout.
// wizard.js asks for a body with makeWizardBody(loadout, { body }) and owns everything that happens to it in play.
//
// Round 15: every player is the KayKit Mage (Kay Lousberg, CC0), its robe, hat and cape tinted by the elements of the spells
// it carries; bots are the KayKit Skeletons, their eyes glowing in the element colour. All of them share KayKit's Rig_Medium
// skeleton, so one clip file (clips.glb, the Rig_Medium animation packs) drives every body by bone name with no retargeting.
// The models are built from Ty's packs by tools/build-characters.mjs (joined meshes, weapons under the hand slot, webp, meshopt).
// Clip keys are cut and retimed from those clips by the pick specs in spellanim.js.
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { WIZARDS, ELEMENTS, loadoutElements } from '../shared/constants.js';
import { SPELL_ANIMS, COMMON_ANIMS, SKELETON_ANIMS, legacyKey } from './spellanim.js';

// KayKit model units to metres: the head top (2.16 units) at 1.8 m. The environment agent scales the castle kit by the same
// factor (map.js KIT_SCALE), so doorways keep KayKit's proportions next to the bodies.
export const BODY_SCALE = 1.8 / 2.16;
const HEIGHT = 1.8;
// Heights on the scaled body (m), for wizard.js: the hat tip (the tallest point), and the head's middle.
export const BODY_TOP = 2.21, HEAD_Y = 1.55;

const DIR = './models/characters/';
export const BODY_KINDS = ['mage', 'skeleton_mage', 'skeleton_warrior', 'skeleton_rogue', 'skeleton_minion'];
export const SKELETON_KINDS = BODY_KINDS.slice(1);
const CLIPS_URL = DIR + 'clips.glb';

// The rig's bone names, by role (KayKit's Rig_Medium, with the dots the build replaces by underscores: three strips dots from
// node names). Nothing outside this map types a bone name: use bone(model, role) or these arrays.
export const BONES = {
  root: 'root', hips: 'hips', spine: 'spine', chest: 'chest', head: 'head',
  hand: 'handslot_r', handL: 'handslot_l', wrist: 'hand_r', wristL: 'hand_l',
  armR: 'upperarm_r', armL: 'upperarm_l',
  legs: ['upperleg_l', 'lowerleg_l', 'foot_l', 'toes_l', 'upperleg_r', 'lowerleg_r', 'foot_r', 'toes_r'],
  toes: ['toes_l', 'toes_r'],
  tip: 'tip',            // an empty node at the staff head (the weapon's far end on a skeleton), under the right hand slot
};
export const bone = (model, role) => model.getObjectByName(BONES[role]) || null;

const templates = {};    // kind -> { scene (unscaled, bind pose) }
const pool = {};         // KayKit clip name -> clip
let readyResolve;
const ready = new Promise(r => { readyResolve = r; });
// Resolves once makeWizardBody() can be called (select.js waits on it).
export const looksReady = () => ready;

// ---------------------------------------------------------------- the pick DSL (spellanim.js specs)
// A pick is 'Clip', ['Clip', from, to, duration?], or { clip, from, to, warp, yaw, reverse, flatY, pinXZ, bend } (see spellanim.js).

// Resample `clip` between two of its times onto a fresh 60 fps clip starting at 0 (every track kept: the compressed clips are
// sparse, and three's subclip drops tracks without a key in the range), optionally stretched to `duration`.
function cutClip(clip, key, from = 0, to = clip.duration, duration) {
  const len = Math.max(1 / 60, to - from), N = Math.max(2, Math.round(len * 60) + 1), out = duration ?? len;
  const tracks = clip.tracks.map(t => {
    const ip = t.createInterpolant(), w = t.getValueSize(), times = new Float32Array(N), vals = new Float32Array(N * w);
    for (let i = 0; i < N; i++) { times[i] = out * i / (N - 1); vals.set(ip.evaluate(from + len * i / (N - 1)), i * w); }
    return new t.constructor(t.name, times, vals);
  });
  return new THREE.AnimationClip(key, out, tracks);
}

// Retime a clip through piecewise-linear [[clipTime, newTime], ...] points, resampled at 60 fps. Two points with the same clip
// time hold that pose between their new times (a drawn-back strike held through a wind-up).
function warpClip(clip, key, points) {
  const end = points[points.length - 1][1], N = Math.max(2, Math.round(end * 60) + 1);
  const src = (t) => {
    for (let i = 1; i < points.length; i++) {
      const [a0, b0] = points[i - 1], [a1, b1] = points[i];
      if (t <= b1 || i === points.length - 1) return b1 > b0 ? a0 + (t - b0) * (a1 - a0) / (b1 - b0) : a1;
    }
    return t;
  };
  const tracks = clip.tracks.map(t => {
    const ip = t.createInterpolant(), w = t.getValueSize(), times = new Float32Array(N), vals = new Float32Array(N * w);
    for (let i = 0; i < N; i++) { times[i] = end * i / (N - 1); vals.set(ip.evaluate(src(times[i])), i * w); }
    return new t.constructor(t.name, times, vals);
  });
  return new THREE.AnimationClip(key, end, tracks);
}

function reverseClip(clip, key) {
  const c = clip.clone(); c.name = key;
  for (const t of c.tracks) {
    const n = t.times.length, w = t.getValueSize(), times = new Float32Array(n), vals = new Float32Array(t.values.length);
    for (let i = 0; i < n; i++) {
      times[i] = c.duration - t.times[n - 1 - i];
      vals.set(t.values.subarray((n - 1 - i) * w, (n - i) * w), i * w);
    }
    t.times = times; t.values = vals;
  }
  return c;
}

const hipsTrack = (t, what) => t.name === `${BONES.hips}.${what}`;
// The hips' rest position and the world up axis in the hips' parent space, on the unscaled template.
function hipsFrame(scene) {
  const hips = scene.getObjectByName(BONES.hips);
  scene.updateMatrixWorld(true);
  const up = new THREE.Vector3(0, 1, 0).applyMatrix3(new THREE.Matrix3().setFromMatrix4(hips.parent.matrixWorld.clone().invert()));
  return { hips, up };
}
// Hold the hips at their rest place, `dy` m (on the scaled body) above standing height, all through a clip: for moves performed
// in the air on a body the server already flies.
function flatHips(clip, scene, dy) {
  const { hips, up } = hipsFrame(scene);
  const p = hips.position.clone().addScaledVector(up, dy / BODY_SCALE);
  let has = false;
  for (const t of clip.tracks) if (hipsTrack(t, 'position')) { has = true; for (let i = 0; i < t.values.length; i += 3) p.toArray(t.values, i); }
  if (!has) clip.tracks.push(new THREE.VectorKeyframeTrack(`${BONES.hips}.position`, [0], p.toArray()));
  return clip;
}
// Hold the hips over their rest place but keep their rise and fall (a landing crouch, a take-off cut from a travelling clip).
function pinHipsXZ(clip, scene) {
  const { hips, up } = hipsFrame(scene);
  const rest = hips.position, v = new THREE.Vector3(), uu = up.lengthSq();
  for (const t of clip.tracks) if (hipsTrack(t, 'position')) for (let i = 0; i < t.values.length; i += 3) {
    const k = v.fromArray(t.values, i).sub(rest).dot(up) / uu;
    v.copy(up).multiplyScalar(k).add(rest).toArray(t.values, i);
  }
  return clip;
}
// Turn a whole clip `deg` degrees about the vertical (positive: to the body's left), through its hips tracks.
function yawClip(clip, scene, deg) {
  const hips = scene.getObjectByName(BONES.hips);
  scene.updateMatrixWorld(true);
  const P = hips.parent.getWorldQuaternion(new THREE.Quaternion()).premultiply(scene.getWorldQuaternion(new THREE.Quaternion()).invert());
  const R = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), deg * Math.PI / 180);
  const L = P.clone().invert().multiply(R).multiply(P);
  const q = new THREE.Quaternion(), v = new THREE.Vector3();
  let has = false;
  for (const t of clip.tracks) {
    if (hipsTrack(t, 'quaternion')) { has = true; for (let i = 0; i < t.values.length; i += 4) q.fromArray(t.values, i).premultiply(L).toArray(t.values, i); }
    if (hipsTrack(t, 'position')) for (let i = 0; i < t.values.length; i += 3) v.fromArray(t.values, i).applyQuaternion(L).toArray(t.values, i);
  }
  if (!has) clip.tracks.push(new THREE.QuaternionKeyframeTrack(`${BONES.hips}.quaternion`, [0], hips.quaternion.clone().premultiply(L).toArray()));
  return clip;
}

// Bend bones forward (deg about the body's side axis; negative: back) all through a clip: { spine: 20, chest: 15, head: -10 }
// (BONES roles), for a hunched stance laid over a clip.
function bendClip(clip, scene, bend) {
  scene.updateMatrixWorld(true);
  const sceneQ = scene.getWorldQuaternion(new THREE.Quaternion()).invert();
  for (const [role, deg] of Object.entries(bend)) {
    const b = scene.getObjectByName(BONES[role]);
    if (!b) continue;
    const P = b.parent.getWorldQuaternion(new THREE.Quaternion()).premultiply(sceneQ);
    const R = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), deg * Math.PI / 180);
    const L = P.clone().invert().multiply(R).multiply(P), q = new THREE.Quaternion();
    let tr = clip.tracks.find(t => t.name === `${b.name}.quaternion`);
    if (!tr) clip.tracks.push(tr = new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, [0], b.quaternion.toArray()));
    for (let i = 0; i < tr.values.length; i += 4) q.fromArray(tr.values, i).premultiply(L).toArray(tr.values, i);
  }
  return clip;
}

// One clip for `key` from a pick spec, or null.
function pickClip(key, pick) {
  const spec = Array.isArray(pick) ? { clip: pick[0], from: pick[1], to: pick[2], duration: pick[3] } : typeof pick === 'object' ? pick : { clip: pick };
  const src = pool[spec.clip];
  if (!src) { console.warn(`[looks] no clip '${spec.clip}' for ${key}`); return null; }
  const scene = templates.mage.scene;
  const from = spec.from ?? 0, to = spec.to ?? src.duration;
  let out = cutClip(src, key, from, to, spec.warp ? undefined : spec.duration);
  if (spec.warp) out = warpClip(out, key, spec.warp.map(([a, b]) => [a - from, b]));
  if (spec.reverse) out = reverseClip(out, key);
  if (spec.flatY != null) flatHips(out, scene, spec.flatY);
  else if (spec.pinXZ) pinHipsXZ(out, scene);
  if (spec.yaw) yawClip(out, scene, spec.yaw);
  if (spec.bend) bendClip(out, scene, spec.bend);
  if (spec.loop) out.userData = { loop: true };
  return out;
}

// ---------------------------------------------------------------- measured clip data

// Natural ground speed of a walk/run cycle (m/s on the scaled body): the median speed of a planted foot (within 3 cm of its lowest
// point) relative to the hips. Stored as clip.userData.speed so wizard.js time-scales it to the real ground speed.
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
function measureSpeed(clip) {
  const body = skeletonClone(templates.mage.scene);
  const hips = body.getObjectByName(BONES.hips);
  const feet = BONES.toes.map(n => body.getObjectByName(n));
  const mixer = new THREE.AnimationMixer(body);
  mixer.clipAction(clip).play();
  const N = 90, dt = clip.duration / N, samples = feet.map(() => []);
  for (let i = 0; i <= N; i++) {
    mixer.setTime(Math.min(i * dt, clip.duration - 1e-4));
    body.updateMatrixWorld(true);
    hips.getWorldPosition(_a);
    feet.forEach((f, j) => { f.getWorldPosition(_b); samples[j].push([_b.y, _b.x - _a.x, _b.z - _a.z]); });
  }
  const speeds = [];
  for (const s of samples) {
    const low = Math.min(...s.map(q => q[0])) + 0.03 / BODY_SCALE;
    for (let i = 1; i < s.length; i++) if (s[i][0] < low && s[i - 1][0] < low) speeds.push(Math.hypot(s[i][1] - s[i - 1][1], s[i][2] - s[i - 1][2]) / dt * BODY_SCALE);
  }
  speeds.sort((x, y) => x - y);
  return speeds[Math.floor(speeds.length / 2)] || 0;
}
const GAIT_KEYS = ['run', 'walk', 'walk_fight', 'back', 'strafe_left', 'strafe_right', 'crouch_walk'];

// Knocked down by a thrown object: 'knockdown' is the fall of `fall` (a death clip) up to the moment the body lies flat, squeezed
// to KNOCK s; 'getup' is `rise` (Lie_StandUp), or the fall reversed. The flat moment: the head and hips within 6 cm of their lowest.
const KNOCK = 0.4;
function flatTime(clip) {
  const body = skeletonClone(templates.mage.scene);
  const head = body.getObjectByName(BONES.head), hips = body.getObjectByName(BONES.hips);
  const mixer = new THREE.AnimationMixer(body);
  const a = mixer.clipAction(clip); a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; a.play();
  const N = 90, samples = [];
  for (let i = 0; i <= N; i++) {
    const t = clip.duration * i / N;
    mixer.setTime(t); body.updateMatrixWorld(true);
    samples.push([t, head.getWorldPosition(_a).y, hips.getWorldPosition(_b).y]);
  }
  const minH = Math.min(...samples.map(q => q[1])), minP = Math.min(...samples.map(q => q[2]));
  const tol = 0.06 / BODY_SCALE;
  return samples.find(q => q[1] < minH + tol && q[2] < minP + tol)?.[0] ?? clip.duration;
}
function knockClips(fall, rise) {
  const flat = flatTime(fall);
  const down = cutClip(fall, 'knockdown', 0, flat, KNOCK);
  down.userData = { flatAt: +flat.toFixed(2) };
  return { knockdown: down, getup: rise ? (() => { const c = rise.clone(); c.name = 'getup'; return c; })() : reverseClip(down, 'getup') };
}

// ---------------------------------------------------------------- loading

function prepareMeshes(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false;
    const old = o.material;
    o.material = new THREE.MeshStandardMaterial({
      name: old.name, map: old.map, color: old.color, roughness: 0.75, metalness: 0,
      emissive: old.emissive, emissiveIntensity: old.emissive && old.emissive.getHex() ? 1 : 0,
    });
    if (old.map) old.map.anisotropy = 4;
  });
}

export async function loadWizardModels() {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'), import('three/addons/libs/meshopt_decoder.module.js')]);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const clipsP = loader.loadAsync(CLIPS_URL).then(g => { for (const c of g.animations) pool[c.name] = c; });
  await Promise.all(BODY_KINDS.map(kind => loader.loadAsync(DIR + kind + '.glb').then(g => {
    prepareMeshes(g.scene);
    templates[kind] = { scene: g.scene };
  }).catch(err => console.warn(`[looks] ${kind}.glb not loaded (${err?.message || err})`))));
  await clipsP;
  if (!templates.mage) throw new Error('the Mage model did not load');
  readyResolve();
}

// For tools (contact sheets, timing traces): the KayKit clips by name, and a bare template.
export const poolClips = () => ({ ...pool });
export const __template = (kind = 'mage') => templates[kind]?.scene;

// ---------------------------------------------------------------- the element look

// Robe, hat, cape and staff gem: KayKit's atlas is flat colour swatches, so each part is a UV rectangle of mage_texture
// (u0, v0, u1, v1, glTF v down). The shader re-hues texels inside a rectangle and keeps their shading (the swatch gradient).
const REGIONS = {
  robe: [0, 0.25, 0.25, 0.5],          // the wide purple swatch: robe, sleeves and hat
  cape: [0.25, 0.25, 0.375, 0.5],      // the crimson swatch: the cape
  gem: [0.75, 0.5, 0.875, 0.75],       // the green swatch: the staff's gem and its pommel
};
// Per element: robe and cape as [hue 0..1, saturation, value scale] (value scales the swatch's own; 1 keeps it), the gem a colour.
// Tuned by eye in the builder and in game. Arcane keeps KayKit's own purple and crimson.
const ROBES = {
  arcane: { robe: null, cape: null },
  fire: { robe: [0.01, 0.78, 1.15], cape: [0.07, 0.85, 1.25] },
  wind: { robe: [0.78, 0.5, 1.35], cape: [0.5, 0.45, 1.4] },
  ice: { robe: [0.57, 0.55, 1.5], cape: [0.6, 0.35, 1.9] },
  dark: { robe: [0.0, 0.25, 0.42], cape: [0.98, 0.9, 0.95] },
  earth: { robe: [0.08, 0.5, 1.05], cape: [0.25, 0.4, 0.9] },
  acid: { robe: [0.27, 0.6, 1.0], cape: [0.78, 0.55, 1.0] },
};
const TINT_GLSL = /* glsl */`
uniform float uOn;
uniform vec3 uRobe, uCape, uGem;   // hue, sat, value scale (uRobe.y < 0: keep the texel); uGem: a colour
uniform vec4 uRobeR, uCapeR, uGemR;
vec3 wa_hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 wa_rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
bool wa_in(vec2 uv, vec4 r) { return uv.x >= r.x && uv.x < r.z && uv.y >= r.y && uv.y < r.w; }
vec3 wa_rehue(vec3 lin, vec3 t) {
  vec3 h = wa_hsv(pow(max(lin, vec3(0.0)), vec3(1.0 / 2.2)));
  return pow(wa_rgb(vec3(t.x, t.y, clamp(h.z * t.z, 0.0, 1.0))), vec3(2.2));
}
vec3 wa_tint(vec3 lin, vec2 uv) {
  if (uOn < 0.5) return lin;
  if (uRobe.y >= 0.0 && wa_in(uv, uRobeR)) return wa_rehue(lin, uRobe);
  if (uCape.y >= 0.0 && wa_in(uv, uCapeR)) return wa_rehue(lin, uCape);
  if (wa_in(uv, uGemR)) { float l = dot(lin, vec3(0.3, 0.55, 0.15)); return uGem * (0.35 + l * 2.2); }
  return lin;
}
`;
function tintMaterial(src, u) {
  const m = src.clone();
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', TINT_GLSL + '\nvoid main() {')
      .replace('#include <map_fragment>', '#include <map_fragment>\n\tdiffuseColor.rgb = wa_tint(diffuseColor.rgb, vMapUv);');
  };
  m.customProgramCacheKey = () => 'wa-kaykit-tint';
  return m;
}
const tintUniforms = () => ({
  uOn: { value: 1 }, uRobe: { value: new THREE.Vector3(0, -1, 1) }, uCape: { value: new THREE.Vector3(0, -1, 1) },
  uGem: { value: new THREE.Color() },
  uRobeR: { value: new THREE.Vector4(...REGIONS.robe) }, uCapeR: { value: new THREE.Vector4(...REGIONS.cape) }, uGemR: { value: new THREE.Vector4(...REGIONS.gem) },
});

// The look of a loadout: { main, second (or null), mix: [{ element, count }], color }.
export function lookOf(loadout) {
  const mix = loadoutElements(loadout || {});
  const main = mix[0]?.element || 'arcane';
  const second = mix.slice(1).find(e => e.count >= 2 && e.element !== 'arcane')?.element || null;
  return { main, second, mix, color: ELEMENTS[main].color };
}

// The robe takes the dominant element; the cape the second one (when two or more spells share it), else the dominant's own cape.
function lookUniforms(look, u) {
  const r = ROBES[look.main] || ROBES.arcane, c = look.second ? ROBES[look.second] : r;
  u.uRobe.value.set(...(r.robe || [0, -1, 1]));
  u.uCape.value.set(...((look.second ? c.robe : r.cape) || [0, -1, 1]));
  u.uGem.value.setHex(ELEMENTS[look.main].bolt);
}

// ---------------------------------------------------------------- attachments (element auras)

let dotTex = null;
function dotTexture() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  dotTex.colorSpace = THREE.SRGBColorSpace;
  return dotTex;
}

// A handful of points animated analytically: place(i, t, pos) fills pos (model space) and returns alpha.
// One draw call per effect; the geometry is updated in onBeforeRender (one frame of lag is invisible).
function motes(count, { size, color, additive = true, place, tint }) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 4).fill(1), 4));
  if (tint) for (let i = 0, c = new THREE.Color(); i < count; i++) { c.setHex(tint(i)); geo.attributes.color.setXYZ(i, c.r, c.g, c.b); }
  const mat = new THREE.PointsMaterial({
    size, map: dotTexture(), color, vertexColors: true, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false; pts.renderOrder = 3;
  const p = new THREE.Vector3();
  pts.onBeforeRender = (renderer) => {
    // three sizes points by the whole canvas height; keep them right in a smaller viewport (the builder preview)
    renderer.getCurrentViewport(_vp); renderer.getDrawingBufferSize(_buf);
    mat.size = size * (_vp.w / (_buf.y || _vp.w || 1));
    const t = performance.now() / 1000;
    const pos = geo.attributes.position, col = geo.attributes.color;
    for (let i = 0; i < count; i++) {
      const a = place(i, t, p);
      pos.setXYZ(i, p.x, p.y, p.z); col.setW(i, a);
    }
    pos.needsUpdate = true; col.needsUpdate = true;
  };
  return pts;
}

const _vp = new THREE.Vector4(), _buf = new THREE.Vector2();
const fract = (x) => x - Math.floor(x);
const rand = (i, k) => fract(Math.sin(i * 127.1 + k * 311.7) * 43758.5453);

// Parent `obj` to a bone so that, in the bind pose, it sits at `pos` (metres, `model` space) with `quat`, whatever the bone's own
// scale and orientation are.
function attachToBone(model, boneName, obj, pos, quat = new THREE.Quaternion()) {
  const b = model.getObjectByName(boneName);
  if (!b) return false;
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const boneM = new THREE.Matrix4().multiplyMatrices(inv, b.matrixWorld);
  const want = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1));
  new THREE.Matrix4().copy(boneM).invert().multiply(want).decompose(obj.position, obj.quaternion, obj.scale);
  b.add(obj);
  return true;
}

// The position of `node` in `model`'s space, written into `out`.
const _m = new THREE.Matrix4();
function inModel(model, node, out) {
  node.getWorldPosition(out);
  return out.applyMatrix4(_m.copy(model.matrixWorld).invert());
}

// Element auras: (host, body, k) adds to `host` (a group at the body's origin); `body` is the wrapper (metres); k is 1 for the
// dominant element and 0.5 for the second (fewer, fainter particles). Returns objects attached to bones.
const AURA = {
  fire(host, body, k) {
    const tip = bone(body, 'tip') || bone(body, 'hand');
    if (!tip) return;
    const h = new THREE.Vector3();
    if (k === 1) host.add(motes(1, { size: 0.5, color: 0xff7a2a, place: (i, t, p) => { inModel(body, tip, p); return 0.5 + 0.2 * Math.sin(t * 9) + 0.1 * Math.sin(t * 23); } }));
    host.add(motes(Math.round(8 * k), { size: 0.09, color: 0xffa040, place: (i, t, p) => {
      const q = fract(t * 0.9 + rand(i, 1));
      inModel(body, tip, h);
      p.set(h.x + (rand(i, 2) - 0.5) * 0.25 + Math.sin(t * 3 + i) * 0.05 * q, h.y + q * 0.7, h.z + (rand(i, 3) - 0.5) * 0.25);
      return (1 - q) * 0.95;
    } }));
  },
  wind(host, body, k) {
    const N = Math.round(10 * k), TRAIL = 4;
    host.add(motes(N * TRAIL, { size: 0.13, color: 0xc9a4ff, place: (j, t, p) => {
      const i = j % N, s = Math.floor(j / N);
      const sp = 1.8 + rand(i, 1) * 1.6, r = 0.55 + rand(i, 2) * 0.3;
      const a = (t - s * 0.045) * sp + rand(i, 3) * 6.283;
      p.set(Math.cos(a) * r, 0.2 + rand(i, 4) * 1.6 + Math.sin(t * 1.3 + i) * 0.15, Math.sin(a) * r);
      return (0.7 + 0.3 * Math.sin(t * 4 + i * 1.7)) * (1 - s / TRAIL);
    } }));
  },
  ice(host, body, k) {
    const out = [];
    if (k === 1) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xbfeaff, emissive: 0x2a6f9a, emissiveIntensity: 0.6, roughness: 0.25, metalness: 0.1, flatShading: true, transparent: true, opacity: 0.92 });
      const geo = new THREE.OctahedronGeometry(1, 0);
      for (const side of [1, -1]) {
        const cluster = new THREE.Group();
        for (const [x, y, z, len, tilt] of [[0, 0, 0, 0.17, 0.25], [0.05, -0.02, 0.05, 0.12, 0.7], [0.03, -0.02, -0.06, 0.11, -0.5], [-0.04, -0.01, 0.0, 0.09, -0.2]]) {
          const s = new THREE.Mesh(geo, mat);
          s.scale.set(0.035, len, 0.035); s.position.set(x * side, y + len * 0.6, z);
          s.rotation.set(tilt * 0.6, 0, -side * (0.35 + Math.abs(tilt) * 0.5)); s.castShadow = false;
          cluster.add(s);
        }
        // on KayKit's shoulders: the upper arm's root sits about 0.92 m up, 0.18 m out; the shards ride just above it
        if (attachToBone(body, side > 0 ? BONES.armL : BONES.armR, cluster, new THREE.Vector3(0.2 * side, 1.0, 0))) out.push(cluster);
      }
    }
    host.add(motes(Math.round(10 * k), { size: 0.07, color: 0xdff4ff, place: (i, t, p) => {
      const q = fract(t * 0.25 + rand(i, 1));
      const a = rand(i, 2) * 6.283 + t * 0.4, r = 0.45 + rand(i, 3) * 0.35;
      p.set(Math.cos(a) * r, 2.2 - q * 2.2, Math.sin(a) * r);
      return Math.sin(q * Math.PI) * 0.8;
    } }));
    return out;
  },
  dark(host, body, k) {
    host.add(motes(7, { size: 1.1, color: 0x8a0a22, place: (i, t, p) => {
      const a = i / 7 * 6.283 + t * 0.3;
      p.set(Math.cos(a) * 0.25, 0.35 + (i % 4) * 0.4, Math.sin(a) * 0.25);
      return (0.26 + 0.07 * Math.sin(t * 2 + i)) * k;
    } }));
    host.add(motes(Math.round(16 * k), { size: 0.45, color: 0x2a0410, additive: false, place: (i, t, p) => {
      const q = fract(t * 0.35 + rand(i, 1));
      const a = rand(i, 2) * 6.283 + q * 2.5, r = 0.4 + rand(i, 3) * 0.2 + q * 0.15;
      p.set(Math.cos(a) * r, 0.1 + q * 1.9, Math.sin(a) * r);
      return Math.sin(q * Math.PI) * 0.65;
    } }));
    host.add(motes(Math.round(8 * k), { size: 0.08, color: 0xff2a48, place: (i, t, p) => {
      const q = fract(t * 0.5 + rand(i, 1));
      const a = rand(i, 2) * 6.283 - t * 1.2, r = 0.5 + rand(i, 3) * 0.2;
      p.set(Math.cos(a) * r, 0.2 + q * 1.6, Math.sin(a) * r);
      return Math.sin(q * Math.PI);
    } }));
    if (k === 1) {
      const pool = new THREE.Mesh(new THREE.CircleGeometry(0.85, 32).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: dotTexture(), color: 0x5a0814, transparent: true, opacity: 0.7, depthWrite: false }));
      pool.position.y = 0.025; pool.renderOrder = 1;
      pool.onBeforeRender = () => { pool.material.opacity = 0.55 + 0.15 * Math.sin(performance.now() / 600); };
      host.add(pool);
    }
  },
  // earth: dust kicked up around the feet, a few pebbles hopping
  earth(host, body, k) {
    host.add(motes(Math.round(14 * k), { size: 0.38, color: 0x9a7a52, additive: false, place: (i, t, p) => {
      const q = fract(t * 0.4 + rand(i, 1));
      const a = rand(i, 2) * 6.283 + q * 1.2, r = 0.4 + rand(i, 3) * 0.3 + q * 0.35;
      p.set(Math.cos(a) * r, 0.05 + q * 0.55, Math.sin(a) * r);
      return Math.sin(q * Math.PI) * 0.5;
    } }));
    host.add(motes(Math.round(6 * k), { size: 0.07, color: 0xd8b880, place: (i, t, p) => {
      const q = fract(t * 0.8 + rand(i, 1));
      const a = rand(i, 2) * 6.283, r = 0.45 + rand(i, 3) * 0.3;
      p.set(Math.cos(a) * r, 4 * q * (1 - q) * 0.45, Math.sin(a) * r);
      return 0.9;
    } }));
  },
  // alchemy: green and violet bubbles rising and popping, and drops dripping from the hands
  acid(host, body, k) {
    host.add(motes(Math.round(9 * k), { size: 0.1, color: 0xffffff, place: (i, t, p) => {
      const q = fract(t * 0.32 + rand(i, 1));
      const a = rand(i, 2) * 6.283 + t * 0.5, r = 0.36 + rand(i, 3) * 0.25;
      p.set(Math.cos(a) * r + Math.sin(t * 2 + i) * 0.04, 0.5 + q * 1.1, Math.sin(a) * r);
      return Math.sin(q * Math.PI) * 0.85;
    }, tint: (i) => i % 3 ? 0x8cff4a : 0xb070ff }));
    const hands = [bone(body, 'hand'), bone(body, 'handL')].filter(Boolean);
    if (!hands.length) return;
    const h = new THREE.Vector3();
    host.add(motes(Math.round(6 * k), { size: 0.06, color: 0x9cff50, place: (i, t, p) => {
      const q = fract(t * 0.7 + rand(i, 1));
      inModel(body, hands[i % hands.length], h);
      p.set(h.x + (rand(i, 2) - 0.5) * 0.06, h.y - 0.05 - q * q * 0.9, h.z + (rand(i, 3) - 0.5) * 0.06);
      return (1 - q) * 0.9;
    } }));
  },
  // arcane (only when nothing else leads): pale blue motes circling the staff head
  arcane(host, body, k) {
    const tip = bone(body, 'tip') || bone(body, 'hand');
    if (!tip) return;
    const h = new THREE.Vector3();
    host.add(motes(Math.round(6 * k), { size: 0.08, color: 0xa8c8ff, place: (i, t, p) => {
      inModel(body, tip, h);
      const a = t * 2.2 + i / 6 * 6.283;
      p.set(h.x + Math.cos(a) * 0.18, h.y + Math.sin(t * 1.7 + i) * 0.1, h.z + Math.sin(a) * 0.18);
      return 0.7;
    } }));
  },
};

// ---------------------------------------------------------------- clip sets

// Clip sets per loadout and body: the shared COMMON_ANIMS, each equipped spell's own keys, the older shared key names (combo1..3,
// spin, lash, ult, ...) filled from the spells that have them, and SKELETON_ANIMS on skeleton bodies. Cached.
const pickCache = new Map();    // pick spec (JSON) -> clip, shared by every loadout
const clipSets = new Map();
let commonClips = null, skeletonClips = null;
function poolPick(key, pick) {
  const id = JSON.stringify(pick);
  let c = pickCache.get(id);
  if (!c) {
    c = pickClip(key, pick);
    if (!c) return null;
    pickCache.set(id, c);
  }
  if (c.name === key) return c;
  const k = c.clone(); k.name = key; k.userData = c.userData; return k;
}
const pickAll = (table) => {
  const out = {};
  for (const [key, pick] of Object.entries(table)) { const c = poolPick(key, pick); if (c) out[key] = c; }
  for (const k of GAIT_KEYS) { const c = out[k]; if (c) { c.userData ??= {}; c.userData.speed ??= +measureSpeed(c).toFixed(2); } }
  return out;
};
const KIT_ORDER = ['primary', 'power', 'mobility', 'guard', 'utility', 'ultimate'];
function genericClips(loadout = {}, kind = 'mage') {
  const skel = kind !== 'mage';
  const sig = KIT_ORDER.map(s => loadout[s] || '').join('|') + (skel ? '|skel' : '');
  if (clipSets.has(sig)) return clipSets.get(sig);
  if (!commonClips) {
    commonClips = pickAll(COMMON_ANIMS);
    Object.assign(commonClips, knockClips(pool.Death_A, pool.Lie_StandUp));   // falls on its back, gets up from its back
  }
  if (skel && !skeletonClips) skeletonClips = pickAll(SKELETON_ANIMS);
  const out = { ...commonClips, ...(skel ? skeletonClips : {}) };
  const spells = KIT_ORDER.map(s => loadout[s]).filter(id => SPELL_ANIMS[id]);
  for (const id of spells) for (const [key, pick] of Object.entries(SPELL_ANIMS[id].keys)) { const c = poolPick(key, pick); if (c) out[key] = c; }
  for (const name of ['combo1', 'combo2', 'combo3', 'spin', 'lash', 'ult', 'float', 'ride', 'flask_step', 'arrival']) {
    for (const id of spells) {
      const key = legacyKey(id, name);
      if (key && out[key] && key !== name) { const c = out[key].clone(); c.name = name; out[name] = c; break; }
    }
  }
  clipSets.set(sig, out);
  return out;
}
// The clip set for a loadout (the builder's preview plays a hovered spell from it).
export const clipsFor = (loadout, kind) => genericClips(loadout || {}, kind);

// ---------------------------------------------------------------- bodies

// The walking-staff grip (round 15): KayKit's hand slot holds a staff like a sword, so with the arm hanging (idle, walk, run) its
// head points forward and down. updateGrip(body, w) turns the grip so the staff stands upright beside the body, head up and leaning
// a little forward and out, its foot kept off the floor; w (0..1) blends it in. wizard.js and the builder preview call it after the
// mixer each frame, with w eased towards 1 in locomotion and towards 0 for casts (the KayKit cast poses aim the staff themselves).
const STAFF_UP = new THREE.Vector3(-0.58, 1, 0.3).normalize();   // in the body's frame: up, leaning out (-x: right) and forward
                                                                  // (+z), so the head clears the hat's brim
const STAFF_FOOT = 0.75;        // m from the grip down to the staff's foot
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _d = new THREE.Vector3(), _ax = new THREE.Vector3();
const _hp = new THREE.Vector3(), _sc = new THREE.Vector3(), _id = new THREE.Quaternion();
function updateGrip(body, w) {
  const g = body.grip;
  if (!g || !body.staff) return;
  if (w <= 0.001) { g.quaternion.identity(); g.position.set(0, 0, 0); return; }
  const hand = body.hand;
  hand.updateWorldMatrix(true, false);
  hand.getWorldQuaternion(_q);
  _d.copy(STAFF_UP).applyQuaternion(body.model.getWorldQuaternion(_q2));          // the wanted axis, in the world
  _ax.set(0, 1, 0).applyQuaternion(_q);                                            // the staff's axis with the plain grip
  _q2.setFromUnitVectors(_ax, _d);                                                 // the turn from one to the other (world)
  _qi.copy(_q).invert();
  _q2.premultiply(_qi).multiply(_q);                                               // that turn in the hand's frame
  g.quaternion.slerpQuaternions(_id, _q2, w);
  // slide the staff up through the hand when its foot would go through the floor
  hand.getWorldPosition(_hp); hand.getWorldScale(_sc);
  const body0 = body.model.parent ? body.model.parent.getWorldPosition(_ax).y : 0;
  const lift = Math.max(0, STAFF_FOOT * _d.y - (_hp.y - body0) + 0.03) * w;
  g.position.copy(_d).multiplyScalar(lift / (_sc.y || 1)).applyQuaternion(_qi);
}

// A skeleton kind for a bot, from any number or string (stable for the same seed).
export function botBody(seed) {
  let h = 0;
  for (const ch of String(seed ?? '')) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return SKELETON_KINDS[Math.abs(h) % SKELETON_KINDS.length];
}

// A body for a loadout. `body`: 'mage' (players) or a skeleton kind (bots). Returns
//   { model, clips, kind, look, loadout, setLook(loadout), hand, head, tip }
// `model` is a wrapper group (wizard.js moves and tilts it); the KayKit scene inside is scaled to metres. `hand` is the right hand
// slot, `tip` the staff head (Object3Ds: getWorldPosition). setLook re-tints and swaps the aura in place (the clips stay; make a
// new body when the loadout's spells change mid-game). An old hero id (string) wears that hero's old kit.
export function makeWizardBody(loadout = {}, { body: kind = 'mage' } = {}) {
  if (typeof loadout === 'string') loadout = WIZARDS[loadout]?.kit || {};
  if (!templates[kind]) kind = 'mage';
  const model = new THREE.Group();
  model.name = 'wizardBody';
  const inner = skeletonClone(templates[kind].scene);
  inner.scale.setScalar(BODY_SCALE);
  model.add(inner);
  const skel = kind !== 'mage';
  const u = tintUniforms();
  const glow = [];
  inner.traverse(o => {
    if (!o.isMesh) return;
    if (!skel) o.material = tintMaterial(o.material, u);
    else if (o.material.name === 'Glow') { o.material = o.material.clone(); glow.push(o.material); }
    else o.material = o.material.clone();     // every body owns its materials (wizard.js fades and ghosts them)
  });
  let aura = null, onBones = [];
  const body = {
    model, kind, loadout, look: null, clips: genericClips(loadout, kind),
    hand: bone(model, 'hand'), head: bone(model, 'head'), tip: bone(model, 'tip') || bone(model, 'hand'),
  };
  // The weapon (and its tip) sit in a `grip` group under the hand slot, so a staff can be swung upright (updateGrip).
  const slot = body.hand;
  if (slot) {
    const grip = new THREE.Group(); grip.name = 'grip';
    for (const c of [...slot.children]) if (!c.isBone) grip.add(c);
    slot.add(grip);
    body.grip = grip;
  }
  body.staff = kind === 'mage' || kind === 'skeleton_mage';
  body.updateGrip = (w) => updateGrip(body, w);
  body.setLook = (lo) => {
    body.loadout = lo || {};
    const look = body.look = lookOf(body.loadout);
    lookUniforms(look, u);
    // skeletons: the eyes burn in the element colour
    for (const m of glow) { m.color.setHex(0x000000); m.emissive.setHex(ELEMENTS[look.main].bolt); m.emissiveIntensity = 2.2; }
    if (aura) { model.remove(aura); aura.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); }
    for (const o of onBones) o.removeFromParent();
    aura = new THREE.Group(); aura.name = 'aura';
    onBones = [AURA[look.main]?.(aura, model, skel ? 0.5 : 1), look.second && AURA[look.second]?.(aura, model, 0.5)].flat().filter(Boolean);
    model.add(aura);
    model.userData.look = look;
  };
  body.setLook(loadout);
  return body;
}
export const makeGenericBody = (loadout) => makeWizardBody(loadout);
