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
  jeb: {
    walk: 'Walking',
    cast_fast: ['mage_soell_cast_1', 0.3, 1.2],          // the sling: a gather, then the arms fling wide at about 0.54 s (the spark window)
    cast_heavy: 'Angry_Ground_Stomp_2',                // summoning the Battering Ram: a lunging stomp that lands at about 0.6-0.75 s
    block: 'Block1',                                    // Ram Guard: a held guarded stance
    // extra keys
    ult: ['Sword_Judgment', 0.2, 2.1, 1.1],             // the Stampede call: an arm-up leap at about 0.3 s, a ground slam at about 0.75 s
    death: ['Lie_Back_Leg_Swing', 0, 1.3],              // stumbles and falls flat on his back (the later kip-up is cut)
    ride: ['Cautious_Crouch_Walk_Left_inplace', 0.3, 0.42, 1.0],  // Ram Ride: a held wide-legged crouch (straddling the ram); clamp or ping-pong
  },
  vesper: {
    walk: 'Walking',
    cast_fast: ['mage_soell_cast_5', 9.9, 11.36],     // the arm rises overhead, then flings forward and down (the spark window)
    death: 'Dead',                                     // staggers and lands flat by about 2.2 s
    // Sanguine Lash: extra key. The slash strikes at about 0.7-0.85 s; retimed so the crouched wind-up fills the
    // 1.5 s wind-up and the strike lands on the release, then the follow-through. Play it from the wind-up's start at 1x.
    lash: { clip: 'Right_Hand_Sword_Slash', warp: [[0, 0], [0.55, 1.3], [0.85, 1.55], [1.5, 2.1]] },
  },
  // Embibe's own export (70 joints: the 66-bone rig plus four hood bones). Her clips have root motion and
  // start in a crouch; times below were read off contact sheets and hand traces (hand-off).
  embibe: {
    walk: 'Walking',
    // A relaxed stand (the drink clip's opening, before the arm lifts). The base idle's crossed fighting stance
    // reads as crumpled on her heavy boots; it isn't tearing, Gale has the same pose (legs-close.png).
    idle: ['Stand_and_Drink', 0.2, 1.9],
    // Potion Toss: the standing overhand throw; the release (hand overhead, then flung forward) is at about
    // 0.55 s, which is where main.js's cast_fast window (from 0.25 s at 2.6x) lands its key moment.
    cast_fast: ['Female_Crouch_Pick_Throw_Forward', 1.85, 3.6],
    // Toxic Flask: crouches, scoops the flask up from low behind her and lobs it overhead. Retimed to the
    // meteor convention: the gather fills 0-1.9 s and the lob peaks at 2.1 s (release window 1.9-2.7 s).
    cast_heavy: { clip: 'Crouch_Pull_and_Throw', from: 1.0, to: 4.6, warp: [[1.0, 0], [2.65, 1.8], [3.5, 2.1], [4.6, 2.9]] },
    // extra keys
    // Flask Step: the crouched charge, then the sidearm throw; the release lands at 0.6 s (the wind-up's end).
    flask_step: { clip: 'Crouch_Charge_and_Throw', from: 4.3, to: 5.7, warp: [[4.3, 0], [5.35, 0.6], [5.7, 0.85]] },
    // Flask Step's arrival: lands crouched and rises to standing.
    arrival: ['Female_Crouch_Pick_Throw_Forward', 3.45, 4.6, 0.8],
    // Berserker Brew: lifts the flask (left hand), at her lips by 0.55 s, head back at 1.15 s, lowered by 1.6 s.
    ult: { clip: 'Stand_and_Drink', from: 1.9, to: 5.9, warp: [[1.9, 0], [3.0, 0.55], [4.5, 1.15], [5.9, 1.6]] },
    death: 'dying_backwards',          // staggers back and lands flat by about 1.4 s (2.2 s)
  },
};

// Clips picked from one wizard's export for others (`to`, or every wizard): used directly on the source and
// retargeted bone by bone onto the others (they are all Mixamo-style rigs). These override MODEL_CLIPS.
// Cinder's set: 'run' stays each model's own Running (full speed); the fight walks are for slow movement (wind-ups,
// ward, slowed, backward). Natural speeds (planted foot, 1.8 m body) are in requests.md: time-scale each to
// ground speed / natural speed.
const SHARED_CLIPS = [{
  from: 'cinder',
  keys: {
    walk_fight: 'Walk_Fight_Forward',          // extra key: a guarded walk forward, for slow movement (about 0.73 m/s at 1x)
    back: 'Walk_Fight_Back',                   // extra key: walking backward relative to facing (about 0.56 m/s at 1x)
    // extra keys for telekinesis and props
    tk_lift: { clip: 'mage_soell_cast_6', warp: [[0, 0], [0.7, 0.1], [1.2, 0.35], [2.3, 1.1]] },   // the arm rises overhead at 0.35 s (the lift), then settles
    tk_throw: { clip: 'mage_soell_cast_4', warp: [[0, 0], [0.45, 0.08], [0.65, 0.18], [2.2, 1.0]] }, // the arms fling out at 0.1-0.2 s (the release)
    hit_waist: ['Hit_Reaction_to_Waist', 0.2, 1.45, 0.75],   // doubles over and recovers in 0.75 s (hit by a thrown object)
  },
}, {
  // Embibe's Triple_Combo_Attack cut into its three strikes, as optional per-shot primary clips. Each starts in
  // the pose the previous one ends in, strikes at 0.15 s and follows through; combo3 also recovers to the stance.
  // Turned 45 degrees to the left: the combo is performed from a bladed stance about 55 degrees off forward.
  // Play at 1x from 0 when the shot fires.
  from: 'embibe', to: ['embibe', 'gale'],
  keys: {
    combo1: { yaw: 45, clip: 'Triple_Combo_Attack', from: 0.3, to: 1.0, warp: [[0.3, 0], [0.75, 0.15], [1.0, 0.45]] },     // overhead claw rake, down and across
    combo2: { yaw: 45, clip: 'Triple_Combo_Attack', from: 1.0, to: 1.85, warp: [[1.0, 0], [1.5, 0.15], [1.85, 0.45]] },    // a turning backhand sweep
    combo3: { yaw: 45, clip: 'Triple_Combo_Attack', from: 1.85, to: 3.3, warp: [[1.85, 0], [2.3, 0.15], [2.6, 0.4], [3.3, 0.8]] },  // the high finisher, then back to the stance
  },
}, {
  from: 'embibe', to: ['gale'],
  keys: { death: 'dying_backwards' },        // Gale was the last hero who sank: staggers back, flat by about 1.4 s
}];

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
  // fitted mid-run (`pose`/`at`, the pose seen most) so the hook stays up while he runs
  jeb: { url: '/models/wizards/jeb-crook.glb', length: 1.75, grip: 0.85, lean: 0.1, out: 0.1, pose: 'run', at: 0.16 },
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

// Embibe's potions (Ty's models, static). Each kind is fitted into both fists (hidden until
// body.holdPotion(kind, hand) shows it) and one hangs from her belt. `length` is the bottle's height (m) and
// `grip` how far up the fist closes on it. holdPotion('purple' | 'green' | null, 'right' | 'left'): the purple
// swirl is Potion Toss, the green crystal Toxic Flask; null empties both hands. Also on body.model.userData.
const POTIONS = {
  embibe: {
    kinds: {
      purple: { url: '/models/wizards/embibe-potion-purple.glb', length: 0.27, grip: 0.07, lean: 0, out: 0 },
      green: { url: '/models/wizards/embibe-potion-green.glb', length: 0.32, grip: 0.08, lean: 0, out: 0 },
    },
    // the left hand is the drinking hand (Berserker Brew): fitted at the drink's peak (hand above her face), the
    // neck tipped down to her mouth
    left: { pose: 'ult', at: 1.1, aim: ['Head', 0.11, 0.04] },
    belt: { kind: 'green', height: 0.17, side: -1, out: 0.07, drop: 0.06, front: 0.04 },   // side -1: her right hip
  },
};

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
  // play once and hold: a looping action wraps setTime(duration) back to the first frame, which made every
  // retargeted clip end in its opening pose (a retargeted death stood back up when clamped)
  const action = mixer.clipAction(clip); action.setLoop(THREE.LoopOnce); action.clampWhenFinished = true; action.play();
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
// `scene`: the model the clip belongs to (bind pose), for `yaw`.
function pickClip(id, animations, key, pick, scene) {
  const [name, from, to, duration] = Array.isArray(pick) ? pick : typeof pick === 'object' ? [pick.clip] : [pick];
  const clip = animations.find(a => a.name === name);
  if (!clip) { console.warn(`[looks] ${id}: no clip '${name}' for ${key}`); return null; }
  let out;
  if (pick.warp && pick.from != null) {    // { clip, from, to, warp }: the part between from and to, retimed (warp in clip times)
    const part = subclipByTime(clip, key, pick.from, pick.to);
    out = stripRootMotion(warpClip(part, key, pick.warp.map(([a, b]) => [a - pick.from, b])));
  } else out = pick.warp ? stripRootMotion(warpClip(clip, key, pick.warp))
    : from != null ? stripRootMotion(subclipByTime(clip, key, from, to, duration)) : asKey(clip, key);
  return pick.yaw ? yawClip(out, scene, pick.yaw) : out;
}

// Turn a whole clip `deg` degrees about the vertical (positive: to the body's left), through its Hips tracks.
// For clips performed from a bladed stance, so the body faces where the game aims it.
function yawClip(clip, scene, deg) {
  const hips = scene?.getObjectByName('Hips');
  if (!hips) return clip;
  scene.updateMatrixWorld(true);
  const P = hips.parent.getWorldQuaternion(new THREE.Quaternion()).premultiply(scene.getWorldQuaternion(new THREE.Quaternion()).invert());
  const R = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), deg * Math.PI / 180);
  const L = P.clone().invert().multiply(R).multiply(P);        // the turn, in the hips' parent space
  const q = new THREE.Quaternion(), v = new THREE.Vector3();
  for (const t of clip.tracks) {
    if (t.name === 'Hips.quaternion') for (let i = 0; i < t.values.length; i += 4) q.fromArray(t.values, i).premultiply(L).toArray(t.values, i);
    if (t.name === 'Hips.position') for (let i = 0; i < t.values.length; i += 3) v.fromArray(t.values, i).applyQuaternion(L).toArray(t.values, i);
  }
  return clip;
}

// Clip set for a model with its own skeleton: per-wizard picks, then Meshy-named clips, then the base
// clips retargeted (if the rig is one we can map), else null.
function ownClips(id, scene, animations) {
  const picks = MODEL_CLIPS[id] || {};
  const out = {};
  for (const [key, pick] of Object.entries(picks)) {
    const clip = pickClip(id, animations, key, pick, scene);
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
// template and its transform relative to the RightHand bone, or null. `cfg.pose`/`cfg.at` fit it in another clip/time.
function fitProp(cfg, propScene, scene, idle, modelScale) {
  const body = skeletonClone(scene);
  const mixer = new THREE.AnimationMixer(body);
  mixer.clipAction(idle).play(); mixer.setTime(cfg.at || 0);
  body.updateMatrixWorld(true);
  const side = cfg.hand === 'left' ? 'Left' : 'Right';
  const hand = body.getObjectByName(side + 'Hand');
  if (!hand) return null;
  // the fist: between the wrist and the middle-finger knuckle, if the rig has fingers
  const grip = new THREE.Vector3(), knuckle = new THREE.Vector3();
  hand.getWorldPosition(grip);
  const mid = body.getObjectByName(side + 'HandMiddle1');
  if (mid) grip.lerp(mid.getWorldPosition(knuckle), 0.5);
  // template: long axis on y, the grip point at the origin, `length` m long once the body is scaled
  prepareMeshes(propScene);
  propScene.traverse(o => { if (o.isMesh) o.castShadow = true; });
  const box = new THREE.Box3().setFromObject(propScene);
  const k = cfg.length / modelScale / (box.max.y - box.min.y);
  propScene.scale.set(k * (cfg.thick || 1), k, k * (cfg.thick || 1));   // `thick`: fatter than modelled, to read at range
  propScene.position.set(-(box.min.x + box.max.x) / 2 * k, -box.min.y * k - cfg.grip / modelScale, -(box.min.z + box.max.z) / 2 * k);
  const prop = new THREE.Group(); prop.name = 'heldProp'; prop.add(propScene);
  // upright, leaning forward (+z) and out to the body's side (right: -x); world here is the model's root space.
  // `aim`: [bone, forward m, up m] instead: the top points from the fist at that spot (a bottle at the lips).
  let q;
  if (cfg.aim) {
    const [bone, fwd, up] = cfg.aim;
    const at = body.getObjectByName(bone).getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, up / modelScale, fwd / modelScale));
    q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), at.sub(grip).normalize());
  } else q = new THREE.Quaternion().setFromEuler(new THREE.Euler(cfg.lean, 0, side === 'Left' ? -cfg.out : cfg.out));
  const want = new THREE.Matrix4().compose(grip, q, new THREE.Vector3(1, 1, 1));
  const local = new THREE.Matrix4().copy(hand.matrixWorld).invert().multiply(new THREE.Matrix4().copy(body.matrixWorld)).multiply(want);
  const t = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() };
  local.decompose(t.p, t.q, t.s);
  return { prop, t };
}

// Fit the coiled whip flat against the left hip of `scene` (unscaled, rest pose): a disc of `diameter` m,
// `out` m outside the left thigh and `drop` m below the top of it, parented to the Hips bone so it rides the
// pelvis rather than swinging with the leg. Returns the template and its transform relative to Hips, or null.
// `cfg.height` instead of `diameter`: an upright object (a bottle) that tall, kept upright. `cfg.side` -1: the right hip.
function fitHip(cfg, coilScene, scene, modelScale) {
  const body = skeletonClone(scene);
  body.updateMatrixWorld(true);
  const hips = body.getObjectByName('Hips'), thigh = body.getObjectByName(cfg.side < 0 ? 'RightUpLeg' : 'LeftUpLeg');
  if (!hips || !thigh) return null;
  prepareMeshes(coilScene);
  const box = new THREE.Box3().setFromObject(coilScene);
  const k = cfg.height ? cfg.height / modelScale / (box.max.y - box.min.y)
    : cfg.diameter / modelScale / Math.max(box.max.x - box.min.x, box.max.y - box.min.y);
  coilScene.scale.setScalar(k);
  const c = box.getCenter(new THREE.Vector3());
  coilScene.position.set(-c.x * k, -c.y * k, -c.z * k);
  const prop = new THREE.Group(); prop.name = 'whipCoil'; prop.add(coilScene);
  const at = thigh.getWorldPosition(new THREE.Vector3());
  const side = Math.sign(at.x - hips.getWorldPosition(new THREE.Vector3()).x) || 1;
  at.x += side * cfg.out / modelScale; at.y -= cfg.drop / modelScale; at.z += (cfg.front || 0) / modelScale;
  // the disc's face (its z) turned to point out of the hip, `turn` rad back towards the front so it reads from both
  const q = cfg.height ? new THREE.Quaternion() : new THREE.Quaternion().setFromEuler(new THREE.Euler(0, side * (Math.PI / 2 - (cfg.turn || 0)), 0));
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
// from the source model (when both are Mixamo-style rigs). `loaded`: every loaded gltf by wizard id.
function sharedClips(id, scene, animations, loaded) {
  const out = {};
  const has = boneNames(scene);
  const mappable = Object.keys(MIXAMO_SAME).every(n => has.has(n));
  for (const set of SHARED_CLIPS) {
    if (set.to && !set.to.includes(id)) continue;
    const mine = id === set.from, source = loaded[set.from];
    if (!mine && (!source || !mappable)) continue;
    for (const [key, pick] of Object.entries(set.keys)) {
      const clip = pickClip(set.from, mine ? animations : source.animations, key, pick, mine ? scene : source.scene);
      if (clip) out[key] = mine ? clip : retargetClip(scene, clip, MIXAMO_SAME, source.scene);
    }
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
      if (!sameRig) clips = { ...clips, ...sharedClips(id, scene, gltf.animations, loaded) };
      for (const k of GAIT_KEYS) {
        const c = clips[k];
        if (!c) continue;
        c.userData ??= {};      // AnimationClip has no userData in three r170
        c.userData.speed ??= +measureSpeed(scene, c, scale).toFixed(2);
      }
      models[id] = { scene, clips, scale, offsetY: -box.min.y * scale };
      const cfg = PROPS[id];
      if (cfg) await loader.loadAsync(cfg.url).then(g => { models[id].prop = fitProp(cfg, g.scene, scene, clips[cfg.pose || 'idle'], scale); })
        .catch(err => console.warn(`[looks] ${id}: prop ${cfg.url} not used (${err?.message || err})`));
      const wh = WHIPS[id];
      if (wh) await Promise.all([loader.loadAsync(wh.coil.url), loader.loadAsync(wh.whip.url)]).then(([c, w]) => {
        models[id].whips = { coil: fitHip(wh.coil, c.scene, scene, scale), whip: fitProp(wh.whip, w.scene, scene, clips.idle, scale) };
      }).catch(err => console.warn(`[looks] ${id}: whips not used (${err?.message || err})`));
      const po = POTIONS[id];
      if (po) await Promise.all(Object.entries(po.kinds).map(([kind, cfg]) => loader.loadAsync(cfg.url).then(g => {
        const copies = [g.scene.clone(), g.scene.clone(), g.scene];   // fitting rescales its copy in place
        const hands = {};
        for (const hand of ['right', 'left']) {
          const fit = { ...cfg, hand, ...(hand === 'left' ? po.left : {}) };
          hands[hand] = fitProp(fit, copies.pop(), scene, clips[fit.pose || 'idle'], scale);
        }
        const belt = po.belt.kind === kind ? fitHip(po.belt, copies.pop(), scene, scale) : null;
        (models[id].potions ??= {})[kind] = { hands, belt };
      }))).catch(err => console.warn(`[looks] ${id}: potions not used (${err?.message || err})`));
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
// `tint(i)`: an optional colour per point (multiplied with `color`).
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
  // Embibe: toxic fumes, a few green and violet bubbles rising around her and popping at shoulder height.
  embibe(model) {
    model.add(motes(9, { size: 0.1, color: 0xffffff, place: (i, t, p) => {
      const k = fract(t * 0.32 + rand(i, 1));
      const a = rand(i, 2) * 6.283 + t * 0.5, r = 0.32 + rand(i, 3) * 0.25;
      p.set(Math.cos(a) * r + Math.sin(t * 2 + i) * 0.04, 0.5 + k * 1.1, Math.sin(a) * r);
      return Math.sin(k * Math.PI) * 0.85;
    }, tint: (i) => i % 3 ? 0x8cff4a : 0xb070ff }));
  },
};

// ---------------------------------------------------------------- bodies

// Base-colour gain for models whose texture is too dark to read in the arena light (Embibe's black leather and
// olive cloak came out as a silhouette next to the others; texture mean luma 52 vs 111-132).
const BRIGHTEN = { embibe: 1.45 };

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
    inner.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); if (BRIGHTEN[id]) o.material.color.setScalar(BRIGHTEN[id]); } });
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
    if (own.potions) {
      const held = [];   // [kind, hand, object]
      for (const [kind, { hands, belt }] of Object.entries(own.potions)) {
        for (const hand of ['right', 'left']) {
          const o = place(hands[hand], hand === 'right' ? 'RightHand' : 'LeftHand');
          if (o) { o.visible = false; held.push([kind, hand, o]); }
        }
        place(belt, 'Hips');
      }
      extra.holdPotion = (kind, hand = 'right') => {
        for (const [k, h, o] of held) if (h === hand || !kind) o.visible = k === kind && h === hand;
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
