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
// Meshy names clips 'Armature|Running|baselayer'; match on the middle part too.
const findClip = (animations, names) => animations.find(a => names.some(n => a.name === n || a.name.split('|').includes(n)));
const asKey = (clip, key) => { const c = stripRootMotion(clip.clone()); c.name = key; return c; };
// No idle clip was provided; the opening second of the dash clip is a clean standing stance.
const idleFrom = (dash) => THREE.AnimationUtils.subclip(dash, 'idle', 6, 30, 30);

function clipsFrom(animations) {
  const out = {};
  for (const [key, names] of Object.entries(CLIP_NAMES)) {
    const clip = findClip(animations, names);
    if (!clip) return null;
    out[key] = asKey(clip, key);
  }
  out.idle = idleFrom(out.dash);
  return out;
}

// Per-wizard picks from a model's own clips, chosen by watching them (contact sheets in the hand-off).
// A string is a clip name; [name, from, to] is the part of a clip between two times (seconds), and
// [name, from, to, duration] also stretches that part to `duration` seconds. { clip, warp } retimes a clip
// through [[clipTime, newTime], ...] (piecewise linear), to land its key moment on the game's timing.
// main.js plays the casts from fixed offsets tuned to the base clips (spark: 0.25 s at 2.6x; meteor
// release: 1.9 s at 1.5x), so a pick must have its key moment at about the same time as the base clip.
// Keys without a pick come from the model's Meshy-named clips, or are retargeted from the base wizard.
const MODEL_CLIPS = {
  gale: {
    walk: 'Walking',
    cast_fast: 'mage_soell_cast',      // overhead flick thrown forward; same move and timing as the base spark cast
    cast_heavy: 'mage_soell_cast_1',   // gathers, then spreads the arms wide (spread from about 1.6 s: the release window)
    spin: ['Sweeping_Kick', 0.8, 1.7], // the low spinning sweep, for the Arcane Cyclone spin
  },
  rime: {
    walk: 'Walking',
    cast_fast: 'mage_soell_cast_4',            // arms flung out at 0.6-1.4 s: the spark/skim window
    cast_heavy: 'Charged_Spell_Cast_1',        // gathers to 1.4 s, then a wide push 1.75-3.1 s: the meteor release window
    // Fall2 is an airborne pose (knees up, arms out): Ty wants it for the Skyward Flash descent, not the stun.
    // Extra key: it settles into the pose over 1 s; play it LoopOnce + clamp so it holds for the whole descent.
    // stun: the base stun retargeted, which reads as a quick flinch.
    float: ['Fall2', 0, 0.67, 1.0],
    death: ['Strangled_and_Fall_Forward', 3.6, 7.3, 2.5],  // kneels and falls flat, squeezed to 2.5 s (respawn is 3 s); extra key
  },
  cinder: {
    walk: 'Walking',
    cast_fast: 'Right_Hand_Sword_Slash',       // a one-handed slash; the strike (0.7-0.96 s) lands in the spark window
    cast_heavy: 'Charged_Upward_Slash',        // gathers low, then slashes upward at 1.8-2.3 s: the meteor release window
    death: ['Fall_Dead_from_Abdominal_Injury', 0, 2.8, 2.4],  // hunches, kneels, flat by about 1.9 s; extra key
  },
  vesper: {
    walk: 'Walking',
    cast_fast: ['mage_soell_cast_5', 9.9, 11.36],     // the arm rises overhead, then flings forward and down (the spark window)
    death: 'Dead',                                     // staggers and lands flat by about 2.2 s
    // Sanguine Lash: extra key. The slash strikes at about 0.7-0.85 s; retimed so the crouched wind-up fills the
    // 1.5 s wind-up and the strike lands on the release, then the follow-through. Play it from the wind-up's start at 1x.
    lash: { clip: 'Right_Hand_Sword_Slash', warp: [[0, 0], [0.55, 1.3], [0.85, 1.55], [1.5, 2.1]] },
  },
};

// Clips Ty picked from Cinder's export for EVERY wizard: used directly on Cinder and retargeted bone by bone
// onto the others (they are Mixamo-style rigs too). These override MODEL_CLIPS. 'run' stays each model's own
// Running (full speed); the fight walks are for slow movement (wind-ups, ward, slowed, backward).
// Natural speeds (planted foot, 1.8 m body) are in requests.md: time-scale each to ground speed / natural speed.
const SHARED_CLIPS = {
  from: 'cinder',
  keys: {
    walk_fight: 'Walk_Fight_Forward',          // extra key: a guarded walk forward, for slow movement (about 0.73 m/s at 1x)
    back: 'Walk_Fight_Back',                   // extra key: walking backward relative to facing (about 0.56 m/s at 1x)
    // extra keys for telekinesis and props
    tk_lift: { clip: 'mage_soell_cast_6', warp: [[0, 0], [0.7, 0.1], [1.2, 0.35], [2.3, 1.1]] },   // the arm rises overhead at 0.35 s (the lift), then settles
    tk_throw: { clip: 'mage_soell_cast_4', warp: [[0, 0], [0.45, 0.08], [0.65, 0.18], [2.2, 1.0]] }, // the arms fling out at 0.1-0.2 s (the release)
    hit_waist: ['Hit_Reaction_to_Waist', 0.2, 1.45, 0.75],   // doubles over and recovers in 0.75 s (hit by a thrown object)
  },
};

// Retime a clip through piecewise-linear [[clipTime, newTime], ...] points.
function warpClip(clip, key, points) {
  const c = clip.clone(); c.name = key;
  const map = (t) => {
    for (let i = 1; i < points.length; i++) {
      const [a0, b0] = points[i - 1], [a1, b1] = points[i];
      if (t <= a1 || i === points.length - 1) return b0 + (t - a0) * (b1 - b0) / (a1 - a0);
    }
    return t;
  };
  for (const tr of c.tracks) for (let i = 0; i < tr.times.length; i++) tr.times[i] = map(tr.times[i]);
  c.duration = points[points.length - 1][1];
  return c;
}

// Props a wizard's own model holds in its right hand. The model is scaled to `length` (m) along its long
// axis (y) and gripped `grip` m from its bottom end. It is fitted once, in the model's idle pose: upright,
// with its top leaning `lean` radians forward and `out` radians away from the body, then it follows the hand.
const PROPS = {
  rime: { url: '/models/wizards/rime-wand.glb', length: 1.5, grip: 0.6, lean: 0.12, out: 0.1 },
  vesper: { url: '/models/wizards/vesper-wand.glb', length: 1.5, grip: 0.6, lean: 0.12, out: 0.1 },
};

// Vesper's whips (Ty's models). The coil hangs flat on her left hip at all times; the straight whip is held by
// its handle (the gem end, +y) in her right fist and only shows during Sanguine Lash. body.setWhip('out' |
// 'coiled') swaps them (the wand hides while the whip is out); body.setWhipGlow(0..1) makes both glow crimson.
// Both are also on body.model.userData. Bodies without whips don't have them.
const WHIPS = {
  vesper: {
    coil: { url: '/models/wizards/vesper-whip-coil.glb', diameter: 0.34, out: 0.1, drop: 0.02, turn: 0.6 },
    whip: { url: '/models/wizards/vesper-whip.glb', length: 1.6, grip: 1.54, lean: -0.5, out: 0.15, thick: 1.6 },
  },
};
const WHIP_GLOW = new THREE.Color(0xff1a3a);

function subclipByTime(clip, key, from, to, duration) {
  const fps = 30;
  const c = THREE.AnimationUtils.subclip(clip, key, Math.round(from * fps), Math.round(to * fps), fps);
  if (duration) { const k = duration / c.duration; for (const t of c.tracks) t.scale(k); c.duration = duration; }
  return c;
}

// ---------------------------------------------------------------- retargeting base clips

// Mixamo-style rigs (Meshy's "rig ready" export) to the base wizard's Meshy rig, after the
// 'mixamorig' prefix is stripped. Bones not listed keep their rest pose (fingers, head tips).
const MIXAMO_TO_BASE = {
  Hips: 'Hips', Spine: 'Spine02', Spine1: 'Spine01', Spine2: 'Spine', Neck: 'neck', Head: 'Head',
};
for (const side of ['Left', 'Right']) {
  for (const b of ['Shoulder', 'Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot', 'ToeBase']) MIXAMO_TO_BASE[side + b] = side + b;
}

// Root-relative world transforms of every node under `root`, as they are now.
function rootSpace(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const out = new Map();
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  root.traverse(o => {
    m.multiplyMatrices(inv, o.matrixWorld).decompose(p, q, s);
    out.set(o, { p: p.clone(), q: q.clone() });
  });
  return out;
}

// Mixamo-style rig to Mixamo-style rig: the same names.
const MIXAMO_SAME = Object.fromEntries(Object.keys(MIXAMO_TO_BASE).map(n => [n, n]));

// Retarget `clip` from `source` (the base wizard unless given; a model in its bind pose) onto `target`
// (likewise), bone by bone through `names` (target bone -> source bone). Each bone's rest pose is first
// lined up with the source's rest direction (so an A-pose and a T-pose agree), then follows the source
// bone's rotation from its rest. The hips also follow the source hips' movement, scaled to the target's size.
function retargetClip(target, clip, names, source = baseModel, fps = 30) {
  const src = skeletonClone(source);
  const srcBones = {}; src.traverse(o => { if (o.isBone) srcBones[o.name] = o; });
  const nodes = []; target.traverse(o => nodes.push(o));
  const pairs = new Map();
  for (const o of nodes) if (o.isBone && srcBones[names[o.name]]) pairs.set(o, srcBones[names[o.name]]);
  const tRest = rootSpace(target), sRest = rootSpace(src);

  // Rest alignment: rotate the target bone so it points along the base bone (towards the first mapped child).
  const align = new Map();
  const dir = (rest, a, b) => rest.get(b).p.clone().sub(rest.get(a).p).normalize();
  for (const o of nodes) {
    const sb = pairs.get(o);
    if (!sb) continue;
    const child = o.name === 'Hips' ? null : o.children.find(c => pairs.has(c));
    let r = new THREE.Quaternion();
    if (child) r.setFromUnitVectors(dir(tRest, o, child), dir(sRest, sb, pairs.get(child)));
    else if (align.has(o.parent)) r = align.get(o.parent).clone();     // hands, head: keep the parent's correction
    align.set(o, r);
  }
  const hipsT = nodes.find(o => o.name === 'Hips'), hipsS = srcBones.Hips;
  const heightRatio = hipsT && hipsS ? tRest.get(hipsT).p.y / sRest.get(hipsS).p.y : 1;

  const mixer = new THREE.AnimationMixer(src);
  mixer.clipAction(clip).play();
  const frames = Math.max(2, Math.round(clip.duration * fps) + 1);
  const times = new Float32Array(frames);
  const quats = new Map([...pairs.keys()].map(o => [o, new Float32Array(frames * 4)]));
  const hipPos = new Float32Array(frames * 3);
  const world = new Map(), dq = new THREE.Quaternion(), lq = new THREE.Quaternion(), wp = new THREE.Vector3();
  for (let f = 0; f < frames; f++) {
    const t = Math.min(clip.duration, f / fps);
    times[f] = t;
    mixer.setTime(t);
    const sNow = rootSpace(src);
    world.clear();
    for (const o of nodes) {
      if (o === target) { world.set(o, new THREE.Quaternion()); continue; }
      const parentQ = world.get(o.parent) || tRest.get(o.parent)?.q || new THREE.Quaternion();
      const sb = pairs.get(o);
      if (!sb) { world.set(o, parentQ.clone().multiply(o.quaternion)); continue; }
      // world now = (base bone's rotation since its rest) * (aligned target rest)
      dq.copy(sNow.get(sb).q).multiply(sRest.get(sb).q.clone().invert());
      const wq = dq.clone().multiply(align.get(o)).multiply(tRest.get(o).q);
      world.set(o, wq);
      lq.copy(parentQ).invert().multiply(wq);
      lq.toArray(quats.get(o), f * 4);
      if (o === hipsT) {
        // hips offset from rest, in root space, scaled; then into the hips' parent space
        wp.copy(sNow.get(sb).p).sub(sRest.get(sb).p).multiplyScalar(heightRatio).add(tRest.get(o).p);
        const par = tRest.get(o.parent);
        wp.sub(par.p).applyQuaternion(par.q.clone().invert());
        const ps = new THREE.Vector3(); o.parent.getWorldScale(ps); const rs = new THREE.Vector3(); target.getWorldScale(rs);
        wp.multiply(rs.divide(ps));
        wp.toArray(hipPos, f * 3);
      }
    }
  }
  const tracks = [...quats].map(([o, v]) => new THREE.QuaternionKeyframeTrack(`${o.name}.quaternion`, times, v));
  if (hipsT) tracks.push(new THREE.VectorKeyframeTrack(`${hipsT.name}.position`, times, hipPos));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

// ---------------------------------------------------------------- loading

function prepareMeshes(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false;
    // The physical material from Meshy is heavier than we need.
    const old = o.material;
    o.material = new THREE.MeshStandardMaterial({ map: old.map, normalMap: old.normalMap || null, emissiveMap: old.emissiveMap, emissive: old.emissiveMap ? new THREE.Color(0xffffff) : new THREE.Color(0), emissiveIntensity: 0.35, roughness: 0.85, metalness: 0 });
  });
}

export function registerModel(gltf) {
  baseModel = gltf.scene;
  prepareMeshes(baseModel);
  baseClips = clipsFrom(gltf.animations);
}

const boneNames = (root) => { const s = new Set(); root.traverse(o => { if (o.isBone) s.add(o.name); }); return s; };

// One clip from `animations` for `key`, as a pick (see MODEL_CLIPS) describes it, or null.
function pickClip(id, animations, key, pick) {
  const [name, from, to, duration] = Array.isArray(pick) ? pick : typeof pick === 'object' ? [pick.clip] : [pick];
  const clip = animations.find(a => a.name === name);
  if (!clip) { console.warn(`[looks] ${id}: no clip '${name}' for ${key}`); return null; }
  return pick.warp ? stripRootMotion(warpClip(clip, key, pick.warp))
    : from != null ? stripRootMotion(subclipByTime(clip, key, from, to, duration)) : asKey(clip, key);
}

// Clip set for a model with its own skeleton: per-wizard picks, then Meshy-named clips, then the base
// clips retargeted (if the rig is one we can map), else null.
function ownClips(id, scene, animations) {
  const picks = MODEL_CLIPS[id] || {};
  const out = {};
  for (const [key, pick] of Object.entries(picks)) {
    const clip = pickClip(id, animations, key, pick);
    if (clip) out[key] = clip;
  }
  for (const [key, names] of Object.entries(CLIP_NAMES)) {
    if (out[key]) continue;
    const clip = findClip(animations, names);
    if (clip) out[key] = asKey(clip, key);
  }
  const has = boneNames(scene);
  const canRetarget = Object.keys(MIXAMO_TO_BASE).every(n => has.has(n));
  const missing = [...Object.keys(CLIP_NAMES), 'idle'].filter(k => !out[k]);
  if (missing.length && !canRetarget) return null;
  for (const key of missing) out[key] = retargetClip(scene, baseClips[key], MIXAMO_TO_BASE);
  return out;
}

// Fit a prop into the right hand of `scene` (unscaled, bind pose) posed with `idle`. Returns the prop
// template and its transform relative to the RightHand bone, or null.
function fitProp(cfg, propScene, scene, idle, modelScale) {
  const body = skeletonClone(scene);
  const mixer = new THREE.AnimationMixer(body);
  mixer.clipAction(idle).play(); mixer.setTime(0);
  body.updateMatrixWorld(true);
  const hand = body.getObjectByName('RightHand');
  if (!hand) return null;
  // the fist: between the wrist and the middle-finger knuckle, if the rig has fingers
  const grip = new THREE.Vector3(), knuckle = new THREE.Vector3();
  hand.getWorldPosition(grip);
  const mid = body.getObjectByName('RightHandMiddle1');
  if (mid) grip.lerp(mid.getWorldPosition(knuckle), 0.5);
  // template: long axis on y, the grip point at the origin, `length` m long once the body is scaled
  prepareMeshes(propScene);
  propScene.traverse(o => { if (o.isMesh) o.castShadow = true; });
  const box = new THREE.Box3().setFromObject(propScene);
  const k = cfg.length / modelScale / (box.max.y - box.min.y);
  propScene.scale.set(k * (cfg.thick || 1), k, k * (cfg.thick || 1));   // `thick`: fatter than modelled, to read at range
  propScene.position.set(-(box.min.x + box.max.x) / 2 * k, -box.min.y * k - cfg.grip / modelScale, -(box.min.z + box.max.z) / 2 * k);
  const prop = new THREE.Group(); prop.name = 'heldProp'; prop.add(propScene);
  // upright, leaning forward (+z) and out to the body's right (-x); world here is the model's root space
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(cfg.lean, 0, cfg.out));
  const want = new THREE.Matrix4().compose(grip, q, new THREE.Vector3(1, 1, 1));
  const local = new THREE.Matrix4().copy(hand.matrixWorld).invert().multiply(new THREE.Matrix4().copy(body.matrixWorld)).multiply(want);
  const t = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() };
  local.decompose(t.p, t.q, t.s);
  return { prop, t };
}

// Fit the coiled whip flat against the left hip of `scene` (unscaled, rest pose): a disc of `diameter` m,
// `out` m outside the left thigh and `drop` m below the top of it, parented to the Hips bone so it rides the
// pelvis rather than swinging with the leg. Returns the template and its transform relative to Hips, or null.
function fitHip(cfg, coilScene, scene, modelScale) {
  const body = skeletonClone(scene);
  body.updateMatrixWorld(true);
  const hips = body.getObjectByName('Hips'), thigh = body.getObjectByName('LeftUpLeg');
  if (!hips || !thigh) return null;
  prepareMeshes(coilScene);
  const box = new THREE.Box3().setFromObject(coilScene);
  const k = cfg.diameter / modelScale / Math.max(box.max.x - box.min.x, box.max.y - box.min.y);
  coilScene.scale.setScalar(k);
  const c = box.getCenter(new THREE.Vector3());
  coilScene.position.set(-c.x * k, -c.y * k, -c.z * k);
  const prop = new THREE.Group(); prop.name = 'whipCoil'; prop.add(coilScene);
  const at = thigh.getWorldPosition(new THREE.Vector3());
  const side = Math.sign(at.x - hips.getWorldPosition(new THREE.Vector3()).x) || 1;
  at.x += side * cfg.out / modelScale; at.y -= cfg.drop / modelScale;
  // the disc's face (its z) turned to point out of the hip, `turn` rad back towards the front so it reads from both
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, side * (Math.PI / 2 - (cfg.turn || 0)), 0));
  const want = new THREE.Matrix4().compose(at, q, new THREE.Vector3(1, 1, 1));
  const local = new THREE.Matrix4().copy(hips.matrixWorld).invert().multiply(new THREE.Matrix4().copy(body.matrixWorld)).multiply(want);
  const t = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() };
  local.decompose(t.p, t.q, t.s);
  return { prop, t };
}

// Natural ground speed of a walk/run cycle (m/s on the normalised body): the median speed of a planted foot
// (within 3 cm of its lowest point) relative to the hips. Stored as clip.userData.speed so the animation can be
// time-scaled to the real ground speed without the feet sliding. (Measured on each body's own clip objects.)
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
function measureSpeed(scene, clip, scale) {
  const body = skeletonClone(scene);
  const hips = body.getObjectByName('Hips');
  const feet = ['LeftToeBase', 'RightToeBase'].map(n => body.getObjectByName(n)).filter(Boolean);
  if (!hips || !feet.length) return 0;
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
    const low = Math.min(...s.map(q => q[0])) + 0.03 / scale;
    for (let i = 1; i < s.length; i++) if (s[i][0] < low && s[i - 1][0] < low) speeds.push(Math.hypot(s[i][1] - s[i - 1][1], s[i][2] - s[i - 1][2]) / dt * scale);
  }
  speeds.sort((x, y) => x - y);
  return speeds[Math.floor(speeds.length / 2)] || 0;
}
const GAIT_KEYS = ['run', 'walk', 'walk_fight', 'back'];

// SHARED_CLIPS for wizard `id`: picked from its own clips when it is the source, otherwise retargeted
// from the source model (when both are Mixamo-style rigs).
function sharedClips(id, scene, animations, source) {
  const out = {};
  const mine = id === SHARED_CLIPS.from;
  if (!mine && !source) return out;
  const has = boneNames(scene);
  if (!mine && !Object.keys(MIXAMO_SAME).every(n => has.has(n))) return out;
  for (const [key, pick] of Object.entries(SHARED_CLIPS.keys)) {
    const clip = pickClip(SHARED_CLIPS.from, mine ? animations : source.animations, key, pick);
    if (clip) out[key] = mine ? clip : retargetClip(scene, clip, MIXAMO_SAME, source.scene);
  }
  return out;
}

// Load each wizard's own model (WIZARDS[id].model). A model that fails to load, or can't be
// animated, falls back to the recoloured base model with a console warning. All models load first,
// then the clips are built, because SHARED_CLIPS come from one model and are retargeted onto the others.
export async function loadWizardModels(loader) {
  const want = boneNames(baseModel);
  const loaded = {};
  await Promise.all(Object.values(WIZARDS).filter(w => w.model).map(w =>
    loader.loadAsync(w.model).then(gltf => {
      // Mixamo-style rigs name bones 'mixamorig:Hips' (three drops the colon); use the plain names, so
      // RightHand and Head are where wizard.js looks for them.
      gltf.scene.traverse(o => { o.name = o.name.replace(/^mixamorig:?/, ''); });
      for (const a of gltf.animations) for (const t of a.tracks) t.name = t.name.replace(/^mixamorig:?/, '');
      prepareMeshes(gltf.scene);
      loaded[w.id] = gltf;
    }).catch(err => console.warn(`[looks] ${w.id}: ${w.model} not loaded (${err?.message || err}); using the base model`))
  ));
  const source = loaded[SHARED_CLIPS.from];
  await Promise.all(Object.entries(loaded).map(async ([id, gltf]) => {
    try {
      const scene = gltf.scene;
      // Normalise: 1.8 m tall, feet on y = 0 (measured in the bind pose).
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene);
      const scale = HEIGHT / (box.max.y - box.min.y || HEIGHT);
      const has = boneNames(scene);
      const sameRig = [...want].every(n => has.has(n));
      // Same skeleton as the base wizard: the base clips drive it by bone name. Otherwise use its own.
      let clips = sameRig ? baseClips : ownClips(id, scene, gltf.animations);
      if (!clips) throw new Error(`skeleton differs from wizard.glb, Meshy's clips are missing and it can't be retargeted`);
      if (!sameRig) clips = { ...clips, ...sharedClips(id, scene, gltf.animations, source) };
      for (const k of GAIT_KEYS) {
        const c = clips[k];
        if (!c) continue;
        c.userData ??= {};      // AnimationClip has no userData in three r170
        c.userData.speed ??= +measureSpeed(scene, c, scale).toFixed(2);
      }
      models[id] = { scene, clips, scale, offsetY: -box.min.y * scale };
      const cfg = PROPS[id];
      if (cfg) await loader.loadAsync(cfg.url).then(g => { models[id].prop = fitProp(cfg, g.scene, scene, clips.idle, scale); })
        .catch(err => console.warn(`[looks] ${id}: prop ${cfg.url} not used (${err?.message || err})`));
      const wh = WHIPS[id];
      if (wh) await Promise.all([loader.loadAsync(wh.coil.url), loader.loadAsync(wh.whip.url)]).then(([c, w]) => {
        models[id].whips = { coil: fitHip(wh.coil, c.scene, scene, scale), whip: fitProp(wh.whip, w.scene, scene, clips.idle, scale) };
      }).catch(err => console.warn(`[looks] ${id}: whips not used (${err?.message || err})`));
    } catch (err) { console.warn(`[looks] ${id}: ${WIZARDS[id].model} not used (${err?.message || err}); using the base model`); }
  }));
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
  pts.onBeforeRender = (renderer) => {
    // three sizes points by the whole canvas height; keep them right in a smaller viewport (picker cards)
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
  rime(model, own) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xbfeaff, emissive: 0x2a6f9a, emissiveIntensity: 0.6, roughness: 0.25, metalness: 0.1, flatShading: true, transparent: true, opacity: 0.92 });
    const geo = new THREE.OctahedronGeometry(1, 0);
    for (const side of own ? [] : [1, -1]) {   // a real model brings its own pauldrons
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
  vesper(model, own) {
    model.add(motes(7, { size: 1.1, color: 0x8a0a22, place: (i, t, p) => {   // faint crimson halo
      const a = i / 7 * 6.283 + t * 0.3;
      p.set(Math.cos(a) * 0.22, 0.35 + (i % 4) * 0.4, Math.sin(a) * 0.22);
      return 0.26 + 0.07 * Math.sin(t * 2 + i);
    } }));
    // smoke wisps read as grey blotches next to a real model, so only the stand-in gets them
    if (!own) model.add(motes(16, { size: 0.45, color: 0x2a0410, additive: false, place: (i, t, p) => {
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
  const extra = {};
  if (own) {
    inner = skeletonClone(own.scene);
    inner.scale.setScalar(own.scale);
    inner.position.y = own.offsetY;
    inner.traverse(o => { if (o.isMesh) o.material = o.material.clone(); });
    clips = own.clips;
    const place = (fit, bone, ownMaterials) => {
      const node = inner.getObjectByName(bone);
      if (!fit || !node) return null;
      const o = fit.prop.clone();             // shares geometry, and materials unless this body needs its own
      if (ownMaterials) o.traverse(m => { if (m.isMesh) m.material = m.material.clone(); });
      o.position.copy(fit.t.p); o.quaternion.copy(fit.t.q); o.scale.copy(fit.t.s);
      node.add(o);
      return o;
    };
    const wand = place(own.prop, 'RightHand');
    if (own.whips) {
      const coil = place(own.whips.coil, 'Hips', true), whip = place(own.whips.whip, 'RightHand', true);
      if (whip) whip.visible = false;
      const mats = [];
      for (const o of [coil, whip]) o?.traverse(m => { if (m.isMesh) mats.push(m.material); });
      extra.setWhip = (mode) => {
        const out = mode === 'out';
        if (whip) whip.visible = out;
        if (coil) coil.visible = !out;
        if (wand) wand.visible = !out;
      };
      extra.setWhipGlow = (k) => {
        k = Math.max(0, Math.min(1, k || 0));
        for (const m of mats) { m.emissive.copy(WHIP_GLOW); m.emissiveIntensity = 1.6 * k; }
      };
    }
  } else {
    inner = skeletonClone(baseModel);
    inner.traverse(o => { if (o.isMesh) o.material = bodyMaterial(id, o.material); });
    clips = baseClips;
  }
  model.add(inner);
  FLAIR[id]?.(model, !!own);
  Object.assign(model.userData, extra);     // the same functions, for code that only keeps `model`
  return { model, clips, ...extra };
}
