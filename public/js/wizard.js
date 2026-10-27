// A wizard in the scene: cloned skinned model, animation state machine, nameplate, colour ring.
import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import * as C from '../shared/constants.js';

// Shared telekinesis visuals: glowing motes along the beam and a shell around the held prop.
const TK_COLOR = 0xb48cff;
const moteGeo = new THREE.IcosahedronGeometry(1, 0);
const moteMat = new THREE.MeshBasicMaterial({ color: 0xd9c4ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
const shellMat = new THREE.MeshBasicMaterial({ color: TK_COLOR, transparent: true, opacity: 0.35, wireframe: true, blending: THREE.AdditiveBlending, depthWrite: false });
const BEAM_MOTES = 12;

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
    this.bot = info.bot || null;
    this.scene = scene;
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

    this.nameplate = makeNameplate(this.bot ? `${info.name} · ${this.bot}` : info.name, info.color);
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
    this.carry = null;           // { holder, liftFrom, t } while a prop floats beside us

    // telekinesis beam from the staff hand to the held prop
    this.beam = new THREE.Group();
    for (let i = 0; i < BEAM_MOTES; i++) this.beam.add(new THREE.Mesh(moteGeo, moteMat));
    this.beam.visible = false;
    scene.add(this.beam);

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

    this.updateCarry(dt);

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

  // Start (or stop, with null) holding a prop by telekinesis. `liftFrom` is where it rises from.
  setCarry(mesh, liftFrom = null) {
    if (this.carry) { this.scene.remove(this.carry.holder); this.carry = null; }
    this.carryMesh = mesh;
    this.beam.visible = false;
    if (!mesh) return;
    const type = mesh.userData.type;
    const spec = C.PROP_TYPES[type];
    const holder = new THREE.Group();
    mesh.position.y = -spec.h * 0.5;             // pivot at the prop's middle
    const shell = new THREE.Mesh(moteGeo, shellMat);
    shell.scale.setScalar(spec.r + 0.25);
    holder.add(mesh, shell);
    const start = liftFrom ? new THREE.Vector3(liftFrom[0], spec.h * 0.5, liftFrom[2]) : this.holdPoint();
    holder.position.copy(start);
    this.scene.add(holder);
    this.carry = { holder, shell, start, t: liftFrom ? 0 : 1, spin: new THREE.Vector3(Math.random() - 0.5, 1, Math.random() - 0.5).normalize() };
  }

  holdPoint() {
    const p = this.group.position;
    const hp = C.holdPoint([p.x, p.y, p.z], this.group.rotation.y);
    return new THREE.Vector3(hp[0], hp[1], hp[2]);
  }

  updateCarry(dt) {
    const c = this.carry;
    if (!c || this.dead) { this.beam.visible = false; if (c) c.holder.visible = !this.dead; return; }
    const now = performance.now() / 1000;
    c.t = Math.min(1, c.t + dt / C.TK.liftTime);
    const e = 1 - Math.pow(1 - c.t, 3);                         // ease-out
    const hold = this.holdPoint();
    hold.y += Math.sin(now * 2.6 + this.id) * 0.07;              // gentle bob
    if (c.t < 1) {
      // rise in an arc from where it stood
      c.holder.position.lerpVectors(c.start, hold, e);
      c.holder.position.y += Math.sin(e * Math.PI) * 0.6;
    } else c.holder.position.lerp(hold, Math.min(1, dt * 16));
    c.holder.rotateOnAxis(c.spin, dt * (c.t < 1 ? 6 : 0.9));
    c.shell.rotation.y += dt * 2; c.shell.rotation.x += dt * 1.3;
    c.shell.material.opacity = 0.25 + Math.sin(now * 6) * 0.08;

    // beam: motes along a curve from the staff hand to the prop, drifting outward
    const hand = new THREE.Vector3(); this.hand.getWorldPosition(hand);
    const to = c.holder.position;
    const mid = hand.clone().lerp(to, 0.5); mid.y += 0.35;
    this.beam.visible = true;
    this.beam.children.forEach((m, i) => {
      const k = ((i / BEAM_MOTES) + now * 1.4) % 1;
      const a = 1 - k;
      m.position.set(
        a * a * hand.x + 2 * a * k * mid.x + k * k * to.x,
        a * a * hand.y + 2 * a * k * mid.y + k * k * to.y,
        a * a * hand.z + 2 * a * k * mid.z + k * k * to.z);
      m.position.x += Math.sin(now * 9 + i * 1.7) * 0.05;
      m.position.y += Math.cos(now * 8 + i * 2.3) * 0.05;
      m.scale.setScalar(0.035 + Math.sin(k * Math.PI) * 0.045);
    });
  }

  dispose(scene) {
    this.setCarry(null);
    scene.remove(this.beam);
    scene.remove(this.group);
    scene.remove(this.chargeOrb);
    scene.remove(this.chargeLight);
  }
}
