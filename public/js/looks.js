// Wizard looks: loading the character models and building a skinned body for each wizard.
// Characters track. wizard.js asks for a body with makeWizardBody(wizardId) and owns everything
// that happens to it in play (animation state machine, spell visuals).
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { WIZARDS } from '../shared/wizards.js';

let baseModel = null;
let clips = {};

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

export function registerModel(gltf) {
  baseModel = gltf.scene;
  baseModel.traverse(o => {
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false;
      // The physical material from Meshy is heavier than we need.
      const old = o.material;
      o.material = new THREE.MeshStandardMaterial({ map: old.map, emissiveMap: old.emissiveMap, emissive: old.emissiveMap ? new THREE.Color(0xffffff) : new THREE.Color(0), emissiveIntensity: 0.35, roughness: 0.85, metalness: 0 });
    }
  });
  const byName = Object.fromEntries(gltf.animations.map(a => [a.name, stripRootMotion(a)]));
  clips = {
    run: byName.run,
    walk: byName.walk,
    block: byName.block,
    cast_fast: byName.cast_fast,
    cast_heavy: byName.cast_heavy,
    stun: byName.duck,
    dash: byName.dash,
    // No idle clip was provided; the opening second of the dash clip is a clean standing stance.
    idle: THREE.AnimationUtils.subclip(byName.dash, 'idle', 6, 30, 30),
  };
}

// Called once all models are loaded. Today every wizard shares the base model.
export function loadWizardModels(loader) { return Promise.resolve(); }

// A fresh skinned clone and the animation clips to drive it, for wizard `id`.
// Clips use the canonical names: run, walk, block, cast_fast, cast_heavy, stun, dash, idle.
export function makeWizardBody(id) {
  const look = WIZARDS[id];
  const model = skeletonClone(baseModel);
  if (look?.tint) model.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.lerp(new THREE.Color(look.tint), 0.55); } });
  return { model, clips };
}
