// Client-side rams (round 15, spells: the map goats are gone, and the summoned rams moved here from goats.js).
// The server simulates every ram (server.js summonRam): Ram Guard's orbit, the Battering Ram and Stampede charges,
// Ram Ride's mount and the Sling's call. Snapshots carry them as `rams`. The model has no rig, so rearing, galloping,
// leaning into the orbit and seeing stars are all done by moving the whole body. A ram is 1.15x, tinted gold, and
// appears and vanishes in a poof (poof(effects) / despawn(scene, effects), for ramSpawn / ramGone).
import * as THREE from 'three';
import * as C from '../shared/constants.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const R = C.RAM;
const ORBIT = C.SPELLBOOK.ram_guard;
const RAM_LENGTH = 1.25;   // the model's height in metres before RAM.ramScale (the goat body's fit)
const starGeo = new THREE.OctahedronGeometry(0.07, 0);
const starMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
const GOLD = new THREE.Color(0xffe7b0), GOLD_GLOW = new THREE.Color(0x5a3c00);

// The ram model: models/ram.glb (environment), falling back to the old goat.glb. Every view made before it
// arrives gets it swapped in.
let ramModel = null;
const waiting = new Set();
export function loadRamModel(loader) {
  loader.setMeshoptDecoder?.(MeshoptDecoder);
  const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));
  return load('./models/ram.glb').catch(() => load('./models/goat.glb')).then(g => {
    ramModel = fitModel(g, RAM_LENGTH);
    for (const v of waiting) v.setLook();
    waiting.clear();
  }).catch(() => {});   // no model: the box stand-in stays
}

function fitModel(gltf, height) {
  const root = gltf.scene;
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const bb = new THREE.Box3().setFromObject(root);
  const k = height / (bb.max.y - bb.min.y);
  root.scale.setScalar(k);
  root.position.set(-(bb.min.x + bb.max.x) / 2 * k, -bb.min.y * k, -(bb.min.z + bb.max.z) / 2 * k);
  const holder = new THREE.Group();
  holder.add(root);
  return holder;
}

// A summoned ram's look: every material cloned, tinted gold and glowing faintly.
function gild(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    o.material = (Array.isArray(o.material) ? o.material : [o.material]).map(m => {
      const c = m.clone();
      c.color?.multiply(GOLD);
      if (c.emissive) { c.emissive.copy(GOLD_GLOW); c.emissiveIntensity = 0.35; }
      return c;
    });
    if (o.material.length === 1) o.material = o.material[0];
  });
  return root;
}

function makeAlert() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 110px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 12; ctx.strokeStyle = '#2a0006'; ctx.strokeText('!', 64, 68);
  ctx.fillStyle = '#ff3b4e'; ctx.fillText('!', 64, 68);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.setScalar(0.8); sp.renderOrder = 10;
  return sp;
}

export class RamView {
  constructor(info, scene) {
    this.id = info.id;
    this.group = new THREE.Group();
    this.body = new THREE.Group();           // pitch / roll / bob happen here, about the hooves
    this.group.add(this.body);
    this.owner = info.owner ?? null;
    this.setLook();
    this.group.scale.setScalar(R.ramScale);
    this.moved = 0;                          // ground speed seen between snapshots (the mount's gallop)
    this.alert = makeAlert(); this.alert.position.y = 2.0; this.alert.visible = false;
    this.group.add(this.alert);
    this.stars = new THREE.Group(); this.stars.position.set(0, 1.35, 0.45); this.stars.visible = false;
    for (let i = 0; i < 4; i++) this.stars.add(new THREE.Mesh(starGeo, starMat));
    this.group.add(this.stars);
    scene.add(this.group);

    this.target = new THREE.Vector3(info.p[0], info.y || 0, info.p[1]);
    this.group.position.copy(this.target);
    this.targetYaw = info.yaw; this.group.rotation.y = info.yaw;
    this.state = info.s; this.tgt = info.tgt; this.mode = info.mode; this.stateT = 0;
    this.phase = Math.random() * 10;
    this.dustT = 0; this.stepT = 0;
  }

  // The gilded model (or a box until it has loaded).
  setLook() {
    if (this.look) this.body.remove(this.look);
    if (ramModel) this.look = gild(ramModel.clone());
    else { this.look = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 1.1), new THREE.MeshStandardMaterial({ color: 0xffe7b0 })); this.look.position.y = 0.45; waiting.add(this); }
    this.body.add(this.look);
  }

  apply(s) {
    this.moved = Math.hypot(s.p[0] - this.target.x, s.p[1] - this.target.z);
    this.target.set(s.p[0], s.y || 0, s.p[1]);
    this.targetYaw = s.yaw;
    if (s.s !== this.state) { this.state = s.s; this.stateT = 0; }
    this.tgt = s.tgt; this.mode = s.mode;
  }

  update(dt, effects, sfx) {
    this.stateT += dt; this.phase += dt;
    const charging = this.state === 'charge' && this.mode !== 'orbit' && this.mode !== 'mount';
    const orbit = this.mode === 'orbit', mount = this.mode === 'mount';
    // dead-reckon a charge between snapshots so the ram doesn't lag behind the server
    if (charging) {
      this.target.x += Math.sin(this.targetYaw) * R.chargeSpeed * dt;
      this.target.z += Math.cos(this.targetYaw) * R.chargeSpeed * dt;
    }
    // and an orbit: along the tangent, turning at the orbit's rate, so it runs a circle, not a polygon
    if (orbit) {
      const w = Math.PI * 2 / ORBIT.lap, v = w * ORBIT.radius;
      this.target.x += Math.sin(this.targetYaw) * v * dt; this.target.z += Math.cos(this.targetYaw) * v * dt;
      this.targetYaw += w * dt;
    }
    // a mount gallops while its rider moves (snapshot steps of more than a few cm)
    const galloping = charging || (mount && this.moved > 0.08);
    this.group.position.lerp(this.target, Math.min(1, dt * (mount ? 30 : charging || orbit ? 20 : 10)));
    const dy = Math.atan2(Math.sin(this.targetYaw - this.group.rotation.y), Math.cos(this.targetYaw - this.group.rotation.y));
    this.group.rotation.y += dy * Math.min(1, dt * 12);

    const b = this.body, t = this.phase;
    let pitch = 0, roll = 0, lift = 0, zOff = 0;
    if (orbit) { lift = Math.abs(Math.sin(t * 16)) * 0.12; roll = -0.12 + Math.sin(t * 16) * 0.04; pitch = 0.08; }   // leaning into the circle
    else if (mount) { if (galloping) { pitch = 0.1 + Math.sin(t * 18) * 0.12; lift = Math.abs(Math.sin(t * 18)) * 0.14; } else pitch = Math.sin(t * 2) * 0.03; }
    else switch (this.state) {
      case 'windup': {
        // rear up on the hind legs, then stamp down
        const k = Math.min(1, this.stateT / R.windup);
        pitch = -Math.sin(k * Math.PI) * 0.6; zOff = -Math.sin(k * Math.PI) * 0.25; lift = Math.sin(k * Math.PI) * 0.15;
        roll = Math.sin(t * 40) * 0.03;
        break;
      }
      case 'charge':  pitch = 0.18; lift = Math.abs(Math.sin(t * 20)) * 0.16; roll = Math.sin(t * 20) * 0.05; break;
      case 'dizzy':   roll = Math.sin(t * 5) * 0.2; pitch = Math.sin(t * 3.3) * 0.08; break;
      case 'recover': pitch = 0.1 + Math.sin(t * 6) * 0.03; break;                // panting
    }
    const k = Math.min(1, dt * (lift > 0.3 ? 30 : 14));
    b.rotation.x += (pitch - b.rotation.x) * k;
    b.rotation.z += (roll - b.rotation.z) * k;
    b.position.y += (lift - b.position.y) * k;
    b.position.z += (zOff - b.position.z) * k;

    // the '!' over a ram rearing to charge (a Sling's call) or homing on a shooter (a provoked guard ram)
    this.alert.visible = this.state === 'windup' || (charging && this.tgt != null);
    if (this.alert.visible) this.alert.scale.setScalar(0.75 + Math.abs(Math.sin(t * 10)) * 0.2);
    this.stars.visible = this.state === 'dizzy';
    if (this.stars.visible) this.stars.children.forEach((s, i) => {
      const a = t * 4 + i * Math.PI / 2;
      s.position.set(Math.cos(a) * 0.35, Math.sin(t * 6 + i) * 0.05, Math.sin(a) * 0.35);
      s.rotation.y += dt * 6;
    });

    // dust and hoofbeats while galloping
    if (galloping || orbit || this.state === 'windup') {
      this.dustT += dt;
      if (this.dustT > (orbit ? 0.12 : 0.05)) { this.dustT = 0; effects.dust(this.group.position, galloping ? 3 : 1); }
      this.stepT += dt;
      if (galloping && this.stepT > 0.16) { this.stepT = 0; sfx.hoof(this.group.position); }
    }
  }

  // A puff of golden dust where a ram appears or vanishes.
  poof(effects) {
    const p = this.group.position.clone().setY(0.6);
    effects.burst(p, 0xffe2a0, 24, 3.5, 0.7, 1.5);
    effects.burst(p, 0xfff6e0, 14, 2.4, 0.55, 0.5);
    effects.dust(this.group.position, 10);
  }
  despawn(scene, effects) {
    if (effects) this.poof(effects);
    this.dispose(scene);
  }

  dispose(scene) { scene.remove(this.group); waiting.delete(this); }
}
