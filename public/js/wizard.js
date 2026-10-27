// A wizard in the scene: cloned skinned model, animation state machine, nameplate, colour ring.
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

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

function makeNameplate(name, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 56px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(name, 256, 64);
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.fillText(name, 256, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(2.4, 0.6, 1);
  sp.renderOrder = 10;
  return sp;
}

export class Wizard {
  constructor(info, scene, isLocal) {
    this.id = info.id; this.name = info.name; this.color = info.color; this.isLocal = isLocal;
    this.group = new THREE.Group();
    this.model = skeletonClone(baseModel);
    this.group.add(this.model);
    scene.add(this.group);

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const [k, clip] of Object.entries(clips)) {
      const a = this.mixer.clipAction(clip);
      a.enabled = true; a.setEffectiveWeight(0); a.play();
      this.actions[k] = a;
    }
    this.actions.idle.setLoop(THREE.LoopPingPong);
    this.actions.cast_fast.setLoop(THREE.LoopOnce); this.actions.cast_fast.clampWhenFinished = true;
    this.actions.cast_heavy.setLoop(THREE.LoopOnce); this.actions.cast_heavy.clampWhenFinished = true;
    this.actions.stun.setLoop(THREE.LoopOnce); this.actions.stun.clampWhenFinished = true;
    this.actions.dash.setLoop(THREE.LoopOnce); this.actions.dash.clampWhenFinished = true;

    this.current = null;
    this.oneShotUntil = 0;
    this.setBase('idle', 0);

    // colour ring at the feet
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.7, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: info.color, transparent: true, opacity: 0.75, depthWrite: false }));
    ring.position.y = 0.04;
    this.group.add(ring);
    this.ring = ring;

    // ward (block) bubble
    this.ward = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 1),
      new THREE.MeshBasicMaterial({ color: 0x7ad8ff, transparent: true, opacity: 0.0, wireframe: true, depthWrite: false }));
    this.ward.position.y = 1.0;
    this.group.add(this.ward);
    this.wardFill = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 1),
      new THREE.MeshBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.0, depthWrite: false, side: THREE.DoubleSide }));
    this.wardFill.position.y = 1.0;
    this.group.add(this.wardFill);

    // charge glow at the staff hand
    this.hand = this.model.getObjectByName('RightHand') || this.model;
    this.head = this.model.getObjectByName('Head') || this.model;
    this.chargeOrb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 1),
      new THREE.MeshBasicMaterial({ color: 0xff8a3c, transparent: true, opacity: 0.9 }));
    this.chargeOrb.visible = false;
    scene.add(this.chargeOrb);
    this.chargeLight = new THREE.PointLight(0xff7a2a, 0, 7);
    scene.add(this.chargeLight);

    this.nameplate = makeNameplate(info.name, info.color);
    this.nameplate.position.y = 2.25;
    this.nameplate.visible = !isLocal;
    this.group.add(this.nameplate);

    // remote health bar
    this.hpBar = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6, depthTest: false }));
    this.hpFill = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.09), new THREE.MeshBasicMaterial({ color: 0xff5c6a, depthTest: false }));
    this.hpBar.add(bg, this.hpFill);
    this.hpBar.position.y = 2.0;
    this.hpBar.renderOrder = 11; bg.renderOrder = 11; this.hpFill.renderOrder = 12;
    this.hpBar.visible = !isLocal;
    this.group.add(this.hpBar);

    // state mirrored from the server
    this.hp = 100; this.st = 100; this.blocking = false; this.charging = false; this.dead = false; this.stunned = false;
    this.carrying = null; this.kills = 0; this.deaths = 0;
    this.carryMesh = null;

    // interpolation targets for remote wizards
    this.targetPos = new THREE.Vector3(info.p[0], info.p[1], info.p[2]);
    this.group.position.copy(this.targetPos);
    this.targetYaw = info.yaw || 0;
    this.group.rotation.y = this.targetYaw;
    this.netAnim = 'idle';
    this.chargeT = 0;
    this.fadeT = 0;
    this.dissolve = 0;
  }

  // Looping base state.
  setBase(name, fade = 0.15) {
    if (this.current === name) return;
    const next = this.actions[name];
    if (!next) return;
    const prev = this.current ? this.actions[this.current] : null;
    this.current = name;
    next.reset();
    next.setEffectiveTimeScale(name === 'run' ? 1.35 : name === 'idle' ? 0.6 : name === 'block' ? 0.8 : 1);
    if (name === 'cast_heavy') next.setEffectiveTimeScale(1.5);
    next.setEffectiveWeight(1);
    if (prev) { prev.crossFadeTo(next, fade, false); }
    else next.fadeIn(fade);
  }

  // Short interrupt (cast, flinch, blink) that returns to the base state afterwards.
  oneShot(name, duration, timeScale = 1, startAt = 0) {
    const a = this.actions[name];
    if (!a) return;
    const prev = this.current ? this.actions[this.current] : null;
    a.reset(); a.time = startAt; a.setEffectiveTimeScale(timeScale); a.setEffectiveWeight(1);
    if (prev && prev !== a) prev.crossFadeTo(a, 0.08, false);
    else a.fadeIn(0.08);
    this.current = name;
    this.oneShotUntil = performance.now() / 1000 + duration;
  }

  inOneShot() { return performance.now() / 1000 < this.oneShotUntil; }

  // Decide the looping state from the mirrored server state + movement. Called every frame.
  updateAnimation(moving, dt) {
    if (this.dead) { this.setBase('stun', 0.1); }
    else if (!this.inOneShot()) {
      if (this.charging) this.setBase('cast_heavy', 0.1);
      else if (this.blocking) this.setBase('block');
      else if (moving) this.setBase('run');
      else this.setBase('idle', 0.25);
    }
    this.mixer.update(dt);

    // ward bubble
    const w = this.blocking && !this.dead ? 1 : 0;
    this.ward.material.opacity += (w * 0.55 - this.ward.material.opacity) * Math.min(1, dt * 14);
    this.wardFill.material.opacity += (w * 0.12 - this.wardFill.material.opacity) * Math.min(1, dt * 14);
    this.ward.rotation.y += dt * 0.8; this.ward.rotation.x += dt * 0.3;

    // charge orb follows the staff hand
    if (this.charging && !this.dead) {
      this.chargeT += dt;
      const hp = new THREE.Vector3(); this.hand.getWorldPosition(hp);
      this.chargeOrb.visible = true;
      this.chargeOrb.position.copy(hp);
      const s = 0.4 + Math.min(1.3, this.chargeT) * 1.2 + Math.sin(this.chargeT * 30) * 0.08;
      this.chargeOrb.scale.setScalar(s);
      this.chargeOrb.rotation.y += dt * 8;
      this.chargeLight.position.copy(hp);
      this.chargeLight.intensity = 2 + this.chargeT * 6;
    } else {
      this.chargeT = 0; this.chargeOrb.visible = false; this.chargeLight.intensity = 0;
    }

    // health bar
    this.hpFill.scale.x = Math.max(0.001, this.hp / 100);
    this.hpFill.position.x = -(1 - this.hp / 100) * 0.6;
    this.ring.material.opacity = this.dead ? 0.1 : 0.75;

    // carried prop sits above the head
    if (this.carryMesh) {
      this.carryMesh.position.set(0, 2.15 + Math.sin(performance.now() / 300) * 0.05, 0.1);
      this.carryMesh.rotation.y += dt * 1.5;
    }

    // death: sink into the ground
    const target = this.dead ? 1 : 0;
    this.dissolve += (target - this.dissolve) * Math.min(1, dt * (this.dead ? 1.2 : 8));
    this.model.position.y = -this.dissolve * 1.6;
    this.model.rotation.x = this.dissolve * 0.5;
  }

  // Smooth remote movement toward the latest snapshot.
  interpolate(dt) {
    const k = Math.min(1, dt * 14);
    this.group.position.lerp(this.targetPos, k);
    let d = this.targetYaw - this.group.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.group.rotation.y += d * k;
  }

  faceCamera(camera) {
    this.nameplate.quaternion.copy(camera.quaternion);
    this.hpBar.quaternion.copy(camera.quaternion);
  }

  setCarry(mesh) {
    if (this.carryMesh) { this.group.remove(this.carryMesh); this.carryMesh = null; }
    if (mesh) { this.carryMesh = mesh; this.group.add(mesh); }
  }

  dispose(scene) {
    scene.remove(this.group);
    scene.remove(this.chargeOrb);
    scene.remove(this.chargeLight);
  }
}
