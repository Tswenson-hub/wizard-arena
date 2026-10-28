// Wizard looks: loading the character models and building a skinned body for each wizard.
// Characters track. wizard.js asks for a body with makeWizardBody(wizardId) and owns everything
// that happens to it in play (animation state machine, spell visuals).
//
// Until a wizard has a model of its own (WIZARDS[id].model), it wears the base wizard.glb with its
// robe recoloured towards WIZARDS[id].tint, plus a small attachment (FLAIR below). Attachments animate
// themselves in onBeforeRender, so nothing outside this file has to tick them.
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { WIZARDS } from '../shared/wizards.js';

const HEIGHT = 1.8;              // every body is normalised to this height, feet on y = 0

let baseModel = null;
let baseClips = {};
const models = {};               // wizard id -> { scene, clips, scale, offsetY } for wizards with their own model
let readyResolve;
const ready = new Promise(r => { readyResolve = r; });

// Resolves once makeWizardBody() can be called for every wizard (select.js waits on it).
export const looksReady = () => ready;

// Strip horizontal root motion from a clip so every animation plays in place.
function stripRootMotion(clip) {
  for (const track of clip.tracks) {
    if (track.name.endsWith('.position') && /Hips|Armature/.test(track.name)) {
      const v = track.values;
      for (let i = 0; i < v.length; i += 3) { v[i] = v[0]; v[i + 2] = v[2]; }
    }
  }
  return clip;
}

// Canonical clip set from a model's animations. Accepts our merged names (wizard.glb) and
// Meshy's export names, so a model exported with Meshy's animations works as is.
const CLIP_NAMES = {
  run: ['run', 'Running'], walk: ['walk', 'Walking'], block: ['block', 'Two_Handed_Parry'],
  cast_fast: ['cast_fast', 'mage_soell_cast'], cast_heavy: ['cast_heavy', 'Charged_Spell_Cast'],
  stun: ['duck', 'stun', 'Stand_Dodge_2'], dash: ['dash', 'Stand_Dodge_3'],
};
function clipsFrom(animations) {
  // Meshy names clips 'Armature|Running|baselayer'; match on the middle part too.
  const find = (names) => animations.find(a => names.some(n => a.name === n || a.name.split('|').includes(n)));
  const out = {};
  for (const [key, names] of Object.entries(CLIP_NAMES)) {
    const clip = find(names);
    if (!clip) return null;
    out[key] = stripRootMotion(clip.clone());
    out[key].name = key;
  }
  // No idle clip was provided; the opening second of the dash clip is a clean standing stance.
  out.idle = THREE.AnimationUtils.subclip(out.dash, 'idle', 6, 30, 30);
  return out;
}

function prepareMeshes(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false;
    // The physical material from Meshy is heavier than we need.
    const old = o.material;
    o.material = new THREE.MeshStandardMaterial({ map: old.map, emissiveMap: old.emissiveMap, emissive: old.emissiveMap ? new THREE.Color(0xffffff) : new THREE.Color(0), emissiveIntensity: 0.35, roughness: 0.85, metalness: 0 });
  });
}

export function registerModel(gltf) {
  baseModel = gltf.scene;
  prepareMeshes(baseModel);
  baseClips = clipsFrom(gltf.animations);
}

const boneNames = (root) => { const s = new Set(); root.traverse(o => { if (o.isBone) s.add(o.name); }); return s; };

// Load each wizard's own model (WIZARDS[id].model). A model that fails to load, or can't be
// animated, falls back to the recoloured base model with a console warning.
export async function loadWizardModels(loader) {
  const want = boneNames(baseModel);
  await Promise.all(Object.values(WIZARDS).filter(w => w.model).map(w =>
    loader.loadAsync(w.model).then(gltf => {
      const scene = gltf.scene;
      prepareMeshes(scene);
      const has = boneNames(scene);
      const sameRig = [...want].every(n => has.has(n));
      // Same skeleton as the base wizard: the base clips drive it by bone name. Otherwise it must bring its own.
      const clips = sameRig ? baseClips : clipsFrom(gltf.animations);
      if (!clips) throw new Error(`skeleton differs from wizard.glb and Meshy's clips are missing`);
      // Normalise: 1.8 m tall, feet on y = 0 (measured in the bind pose).
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene);
      const scale = HEIGHT / (box.max.y - box.min.y || HEIGHT);
      models[w.id] = { scene, clips, scale, offsetY: -box.min.y * scale };
    }).catch(err => console.warn(`[looks] ${w.id}: ${w.model} not used (${err?.message || err}); using the base model`))
  ));
  readyResolve();
}

// ---------------------------------------------------------------- stand-in recolour

// The base robe is a saturated red. Pixels that are red enough take the hue of the wizard's tint;
// blacks, greys and skin keep theirs, so the texture still reads.
const RECOLOR_GLSL = /* glsl */`
uniform vec3 uRobe;      // target hue (0..1), saturation scale, value scale
uniform vec3 uShade;     // multiplier for the rest of the texture (the dark cloth)
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
vec3 wa_recolor(vec3 lin) {
  vec3 s = pow(max(lin, vec3(0.0)), vec3(1.0 / 2.2));
  vec3 h = wa_hsv(s);
  float fromRed = abs(fract(h.x + 0.5) - 0.5);
  float w = smoothstep(0.22, 0.45, h.y) * (1.0 - smoothstep(0.05, 0.11, fromRed));
  vec3 robe = wa_rgb(vec3(uRobe.x, clamp(h.y * uRobe.y, 0.0, 1.0), clamp(h.z * uRobe.z, 0.0, 1.0)));
  vec3 rest = s * mix(uShade, vec3(1.0), smoothstep(0.35, 0.75, h.z));   // tint the darks, spare highlights and skin
  return pow(mix(rest, robe, w), vec3(2.2));
}
`;

// Robe hue/saturation/value from the wizard's tint, relative to the base red (s ≈ 0.85, v ≈ 0.6).
const STAND_IN = {
  // shade: tint for the black cloth; robe value scale tuned by eye against the picker and in game
  // hue: override the tint's hue (0..1) where the tint alone reads wrong on this texture
  gale: { hue: 0.775, shade: 0xa898d0, val: 1.3 },
  rime: { shade: 0xa8c8e0, val: 1.45, sat: 0.75 },
  vesper: { hue: 0.955, shade: 0x1e1618, val: 0.52, sat: 1.2 },
};

// A fresh material for one body: the source material, recoloured for stand-in wizards. Every body gets
// its own, so wizard.js can fade or tint one body (decoys, frost) without touching the others.
function bodyMaterial(id, src) {
  const m = src.clone();
  const tint = WIZARDS[id]?.tint;
  if (tint == null) return m;
  const cfg = STAND_IN[id] || {};
  const hsl = {}; new THREE.Color(tint).getHSL(hsl);
  const shade = new THREE.Color(cfg.shade ?? 0xffffff);
  const uRobe = { value: new THREE.Vector3(cfg.hue ?? hsl.h, cfg.sat ?? 1, cfg.val ?? 1) };
  const uShade = { value: new THREE.Vector3(shade.r, shade.g, shade.b) };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRobe = uRobe;
    sh.uniforms.uShade = uShade;
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', RECOLOR_GLSL + '\nvoid main() {')
      .replace('#include <map_fragment>', '#include <map_fragment>\n\tdiffuseColor.rgb = wa_recolor(diffuseColor.rgb);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance = wa_recolor(totalEmissiveRadiance);');
  };
  m.customProgramCacheKey = () => 'wa-recolor';
  return m;
}

// ---------------------------------------------------------------- attachments ("flair")

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
function motes(count, { size, color, additive = true, place }) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 4).fill(1), 4));
  const mat = new THREE.PointsMaterial({
    size, map: dotTexture(), color, vertexColors: true, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false; pts.renderOrder = 3;
  const p = new THREE.Vector3();
  pts.onBeforeRender = () => {
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

const fract = (x) => x - Math.floor(x);
const rand = (i, k) => fract(Math.sin(i * 127.1 + k * 311.7) * 43758.5453);

// Parent `obj` to a bone so that, in the bind pose, it sits at `worldPos` (model space) with
// `worldQuat`, whatever the bone's own scale and orientation are (Meshy bones are in centimetres).
function attachToBone(model, boneName, obj, worldPos, worldQuat = new THREE.Quaternion()) {
  const bone = model.getObjectByName(boneName);
  if (!bone) return false;
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const boneM = new THREE.Matrix4().multiplyMatrices(inv, bone.matrixWorld);   // bone in model space
  const want = new THREE.Matrix4().compose(worldPos, worldQuat, new THREE.Vector3(1, 1, 1));
  new THREE.Matrix4().copy(boneM).invert().multiply(want).decompose(obj.position, obj.quaternion, obj.scale);
  bone.add(obj);
  return true;
}

// The position of `node` in `model`'s space, written into `out`.
const _m = new THREE.Matrix4();
function inModel(model, node, out) {
  node.getWorldPosition(out);
  return out.applyMatrix4(_m.copy(model.matrixWorld).invert());
}

const FLAIR = {
  // Cinder: an ember glow at the staff hand, sparks drifting up from it.
  cinder(model) {
    const hand = model.getObjectByName('RightHand');
    if (!hand) return;
    const h = new THREE.Vector3();
    const glow = motes(1, { size: 0.55, color: 0xff7a2a, place: (i, t, p) => {
      inModel(model, hand, p);
      return 0.55 + 0.2 * Math.sin(t * 9) + 0.1 * Math.sin(t * 23);
    } });
    const embers = motes(8, { size: 0.09, color: 0xffa040, place: (i, t, p) => {
      const k = fract(t * 0.9 + rand(i, 1));
      inModel(model, hand, h);
      p.set(h.x + (rand(i, 2) - 0.5) * 0.25 + Math.sin(t * 3 + i) * 0.05 * k, h.y + k * 0.7, h.z + (rand(i, 3) - 0.5) * 0.25);
      return (1 - k) * 0.95;
    } });
    model.add(glow, embers);
  },
  // Gale: violet motes swirling around the body at different heights and speeds, each with a short trail.
  gale(model) {
    const N = 10, TRAIL = 4;
    model.add(motes(N * TRAIL, { size: 0.13, color: 0xc9a4ff, place: (j, t, p) => {
      const i = j % N, k = Math.floor(j / N);                      // k = 0 is the head of the trail
      const sp = 1.8 + rand(i, 1) * 1.6, r = 0.5 + rand(i, 2) * 0.3;
      const a = (t - k * 0.045) * sp + rand(i, 3) * 6.283;
      p.set(Math.cos(a) * r, 0.2 + rand(i, 4) * 1.6 + Math.sin(t * 1.3 + i) * 0.15, Math.sin(a) * r);
      return (0.7 + 0.3 * Math.sin(t * 4 + i * 1.7)) * (1 - k / TRAIL);
    } }));
  },
  // Rime: clusters of frost shards on both shoulders, and a little snow falling around.
  rime(model) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xbfeaff, emissive: 0x2a6f9a, emissiveIntensity: 0.6, roughness: 0.25, metalness: 0.1, flatShading: true, transparent: true, opacity: 0.92 });
    const geo = new THREE.OctahedronGeometry(1, 0);
    for (const side of [1, -1]) {
      const cluster = new THREE.Group();
      for (const [x, y, z, len, tilt] of [[0, 0, 0, 0.17, 0.25], [0.05, -0.02, 0.05, 0.12, 0.7], [0.03, -0.02, -0.06, 0.11, -0.5], [-0.04, -0.01, 0.0, 0.09, -0.2]]) {
        const s = new THREE.Mesh(geo, mat);
        s.scale.set(0.035, len, 0.035);
        s.position.set(x * side, y + len * 0.6, z);
        s.rotation.set(tilt * 0.6, 0, -side * (0.35 + Math.abs(tilt) * 0.5));
        s.castShadow = false;
        cluster.add(s);
      }
      // the base model's shoulders sit about 1.4 m up, 0.2 m out
      attachToBone(model, side > 0 ? 'LeftArm' : 'RightArm', cluster, new THREE.Vector3(0.17 * side, 1.43, -0.02));
    }
    model.add(motes(10, { size: 0.07, color: 0xdff4ff, place: (i, t, p) => {
      const k = fract(t * 0.25 + rand(i, 1));
      const a = rand(i, 2) * 6.283 + t * 0.4, r = 0.4 + rand(i, 3) * 0.35;
      p.set(Math.cos(a) * r, 2.0 - k * 2.0, Math.sin(a) * r);
      return Math.sin(k * Math.PI) * 0.8;
    } }));
  },
  // Vesper: a dark crimson aura: smoky wisps rising in a spiral, a few blood-red sparks, a dark pool underfoot.
  vesper(model) {
    model.add(motes(7, { size: 1.1, color: 0x8a0a22, place: (i, t, p) => {   // faint crimson halo
      const a = i / 7 * 6.283 + t * 0.3;
      p.set(Math.cos(a) * 0.22, 0.35 + (i % 4) * 0.4, Math.sin(a) * 0.22);
      return 0.26 + 0.07 * Math.sin(t * 2 + i);
    } }));
    model.add(motes(16, { size: 0.45, color: 0x2a0410, additive: false, place: (i, t, p) => {
      const k = fract(t * 0.35 + rand(i, 1));
      const a = rand(i, 2) * 6.283 + k * 2.5, r = 0.35 + rand(i, 3) * 0.2 + k * 0.15;
      p.set(Math.cos(a) * r, 0.1 + k * 1.9, Math.sin(a) * r);
      return Math.sin(k * Math.PI) * 0.65;
    } }));
    model.add(motes(8, { size: 0.08, color: 0xff2a48, place: (i, t, p) => {
      const k = fract(t * 0.5 + rand(i, 1));
      const a = rand(i, 2) * 6.283 - t * 1.2, r = 0.45 + rand(i, 3) * 0.2;
      p.set(Math.cos(a) * r, 0.2 + k * 1.6, Math.sin(a) * r);
      return Math.sin(k * Math.PI);
    } }));
    const pool = new THREE.Mesh(new THREE.CircleGeometry(0.85, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: dotTexture(), color: 0x5a0814, transparent: true, opacity: 0.7, depthWrite: false }));
    pool.position.y = 0.025; pool.renderOrder = 1;
    pool.onBeforeRender = () => { pool.material.opacity = 0.55 + 0.15 * Math.sin(performance.now() / 600); };
    model.add(pool);
  },
};

// ---------------------------------------------------------------- bodies

// A fresh skinned clone and the animation clips to drive it, for wizard `id`.
// Clips use the canonical names: run, walk, block, cast_fast, cast_heavy, stun, dash, idle.
// `model` is a wrapper group: wizard.js may move/tilt it (death sink) without undoing the normalisation.
export function makeWizardBody(id) {
  const own = models[id];
  const model = new THREE.Group();
  model.name = 'wizardBody';
  let inner, clips;
  if (own) {
    inner = skeletonClone(own.scene);
    inner.scale.setScalar(own.scale);
    inner.position.y = own.offsetY;
    inner.traverse(o => { if (o.isMesh) o.material = o.material.clone(); });
    clips = own.clips;
  } else {
    inner = skeletonClone(baseModel);
    inner.traverse(o => { if (o.isMesh) o.material = bodyMaterial(id, o.material); });
    clips = baseClips;
  }
  model.add(inner);
  FLAIR[id]?.(model);
  return { model, clips };
}
