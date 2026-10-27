// Client-side goats: the Meshy goat model mirrored from server snapshots. The model has no rig, so
// grazing, trotting, rearing up, galloping and seeing stars are all done by moving the whole body.
import * as THREE from 'three';
import * as C from '../shared/constants.js';
import { models } from './world.js';

const starGeo = new THREE.OctahedronGeometry(0.07, 0);
const starMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });

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

export class GoatView {
  constructor(info, scene) {
    this.id = info.id;
    this.group = new THREE.Group();
    this.body = new THREE.Group();           // pitch / roll / bob happen here, about the hooves
    this.group.add(this.body);
    this.body.add(models.goat ? models.goat.clone() : new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 1.1), new THREE.MeshStandardMaterial({ color: 0xeeeeee })));
    this.alert = makeAlert(); this.alert.position.y = 2.0; this.alert.visible = false;
    this.group.add(this.alert);
    this.stars = new THREE.Group(); this.stars.position.set(0, 1.35, 0.45); this.stars.visible = false;
    for (let i = 0; i < 4; i++) this.stars.add(new THREE.Mesh(starGeo, starMat));
    this.group.add(this.stars);
    scene.add(this.group);

    this.target = new THREE.Vector3(info.p[0], 0, info.p[1]);
    this.group.position.copy(this.target);
    this.targetYaw = info.yaw; this.group.rotation.y = info.yaw;
    this.state = info.s; this.tgt = info.tgt; this.stateT = 0;
    this.phase = Math.random() * 10;
    this.dustT = 0; this.stepT = 0;
  }

  apply(s) {
    this.target.set(s.p[0], 0, s.p[1]);
    this.targetYaw = s.yaw;
    if (s.s !== this.state) { this.state = s.s; this.stateT = 0; }
    this.tgt = s.tgt;
  }

  update(dt, effects, sfx) {
    this.stateT += dt; this.phase += dt;
    const charging = this.state === 'charge';
    // dead-reckon a charge between snapshots so the goat doesn't lag behind the server
    if (charging) {
      this.target.x += Math.sin(this.targetYaw) * C.GOAT.chargeSpeed * dt;
      this.target.z += Math.cos(this.targetYaw) * C.GOAT.chargeSpeed * dt;
    }
    this.group.position.lerp(this.target, Math.min(1, dt * (charging ? 20 : 10)));
    let dy = Math.atan2(Math.sin(this.targetYaw - this.group.rotation.y), Math.cos(this.targetYaw - this.group.rotation.y));
    this.group.rotation.y += dy * Math.min(1, dt * 12);

    const b = this.body, t = this.phase;
    let pitch = 0, roll = 0, lift = 0, zOff = 0;
    switch (this.state) {
      case 'graze':   pitch = 0.22 + Math.sin(t * 1.3) * 0.05; break;          // nose down in the grass
      case 'wander':  lift = Math.abs(Math.sin(t * 7)) * 0.05; roll = Math.sin(t * 7) * 0.04; break;
      case 'windup': {
        // rear up on the hind legs, then stamp down
        const k = Math.min(1, this.stateT / C.GOAT.windup);
        pitch = -Math.sin(k * Math.PI) * 0.6; zOff = -Math.sin(k * Math.PI) * 0.25; lift = Math.sin(k * Math.PI) * 0.15;
        roll = Math.sin(t * 40) * 0.03;
        break;
      }
      case 'charge':  pitch = 0.18; lift = Math.abs(Math.sin(t * 20)) * 0.16; roll = Math.sin(t * 20) * 0.05; break;
      case 'dizzy':   roll = Math.sin(t * 5) * 0.2; pitch = Math.sin(t * 3.3) * 0.08; break;
      case 'recover': pitch = 0.1 + Math.sin(t * 6) * 0.03; break;                // panting
    }
    const k = Math.min(1, dt * 14);
    b.rotation.x += (pitch - b.rotation.x) * k;
    b.rotation.z += (roll - b.rotation.z) * k;
    b.position.y += (lift - b.position.y) * k;
    b.position.z += (zOff - b.position.z) * k;

    this.alert.visible = this.state === 'windup' || charging;
    if (this.alert.visible) this.alert.scale.setScalar(0.75 + Math.abs(Math.sin(t * 10)) * 0.2);
    this.stars.visible = this.state === 'dizzy';
    if (this.stars.visible) this.stars.children.forEach((s, i) => {
      const a = t * 4 + i * Math.PI / 2;
      s.position.set(Math.cos(a) * 0.35, Math.sin(t * 6 + i) * 0.05, Math.sin(a) * 0.35);
      s.rotation.y += dt * 6;
    });

    // dust and hoofbeats while galloping
    if (charging || this.state === 'windup') {
      this.dustT += dt;
      if (this.dustT > 0.05) { this.dustT = 0; effects.dust(this.group.position, charging ? 3 : 1); }
      this.stepT += dt;
      if (charging && this.stepT > 0.11) { this.stepT = 0; sfx.hoof(this.group.position); }
    }
  }

  dispose(scene) { scene.remove(this.group); }
}
