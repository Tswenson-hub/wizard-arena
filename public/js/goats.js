// Client-side goats: the Meshy goat model mirrored from server snapshots. The model has no rig, so
// grazing, trotting, rearing up, galloping, leaping the pen fence and seeing stars are all done by
// moving the whole body. The server ignores fence posts while a goat charges; the leap is drawn here.
// Telekinesis: a held goat floats at the snapshot's height, kicking (body wobble); a thrown one
// tumbles end over end along an arc extrapolated from the snapshot's velocity.
// Jeb's summoned rams (snapshot `summoned: true`) are 1.15x, tinted gold, appear and vanish in a poof
// (poof(effects) / despawn(scene, effects), for whoever handles ramSpawn / goatGone), gallop under their
// rider ('mount') and run circles round him ('orbit').
import * as THREE from 'three';
import * as C from '../shared/constants.js';
import { models, trampleCrops, updateCrops } from './world.js';

const LEAP_HALF = 1.5, LEAP_HEIGHT = 1.25;     // the hop starts 1.5 m before the fence and peaks 1.25 m up
const PEN_CX = (C.PEN.x0 + C.PEN.x1) / 2, PEN_CZ = (C.PEN.z0 + C.PEN.z1) / 2;
const starGeo = new THREE.OctahedronGeometry(0.07, 0);
const starMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });
const GOLD = new THREE.Color(0xffe7b0), GOLD_GLOW = new THREE.Color(0x5a3c00);

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

export class GoatView {
  constructor(info, scene) {
    this.id = info.id;
    this.group = new THREE.Group();
    this.body = new THREE.Group();           // pitch / roll / bob happen here, about the hooves
    this.spin = new THREE.Group();           // tumbling in flight, about the middle of the goat
    this.spin.position.y = C.GOAT.hitY;
    const mid = new THREE.Group(); mid.position.y = -C.GOAT.hitY;
    this.group.add(this.spin); this.spin.add(mid); mid.add(this.body);
    const look = models.goat ? models.goat.clone() : new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 1.1), new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
    this.summoned = !!info.summoned; this.owner = info.owner ?? null; this.team = info.team ?? null;
    this.body.add(this.summoned ? gild(look) : look);
    if (this.summoned) this.group.scale.setScalar(C.GOAT.ramScale);
    this.speed = info.speed || C.GOAT.chargeSpeed;
    this.orb = info.orb || [C.GOAT.orbitRadius, C.GOAT.orbitLap];   // orbit radius and lap time
    this.moved = 0;                          // ground speed seen between snapshots (the mount's gallop)
    this.alert = makeAlert(); this.alert.position.y = 2.0; this.alert.visible = false;
    this.group.add(this.alert);
    this.stars = new THREE.Group(); this.stars.position.set(0, 1.35, 0.45); this.stars.visible = false;
    for (let i = 0; i < 4; i++) this.stars.add(new THREE.Mesh(starGeo, starMat));
    this.group.add(this.stars);
    scene.add(this.group);

    this.target = new THREE.Vector3(info.p[0], info.y || 0, info.p[1]);
    this.vel = new THREE.Vector3();          // flight velocity, for extrapolating between snapshots
    this.bleatQueued = null;
    this.group.position.copy(this.target);
    this.targetYaw = info.yaw; this.group.rotation.y = info.yaw;
    this.state = info.s; this.tgt = info.tgt; this.stateT = 0;
    this.phase = Math.random() * 10;
    this.dustT = 0; this.stepT = 0;
  }

  apply(s) {
    if (this.summoned) this.moved = Math.hypot(s.p[0] - this.target.x, s.p[1] - this.target.z);
    this.speed = s.speed || C.GOAT.chargeSpeed;
    if (s.orb) this.orb = s.orb;
    this.target.set(s.p[0], s.y || 0, s.p[1]);
    if (s.s === 'flying' && s.v) this.vel.set(s.v[0], s.v[1], s.v[2]);
    this.targetYaw = s.yaw;
    if (s.s !== this.state) {
      if (s.s === 'held') this.bleatQueued = false;          // picked up: a startled bleat
      if (s.s === 'flying') this.bleatQueued = true;         // hurled: an indignant one
      this.state = s.s; this.stateT = 0;
    }
    this.tgt = s.tgt;
  }

  update(dt, effects, sfx) {
    this.stateT += dt; this.phase += dt;
    const charging = this.state === 'charge', orbit = this.state === 'orbit', mount = this.state === 'mount';
    // dead-reckon a charge between snapshots so the goat doesn't lag behind the server
    if (charging) {
      this.target.x += Math.sin(this.targetYaw) * this.speed * dt;
      this.target.z += Math.cos(this.targetYaw) * this.speed * dt;
    }
    // and an orbit: along the tangent, turning at the orbit's rate, so it runs a circle, not a polygon
    if (orbit) {
      const w = Math.PI * 2 / this.orb[1], v = w * this.orb[0];
      this.target.x += Math.sin(this.targetYaw) * v * dt; this.target.z += Math.cos(this.targetYaw) * v * dt;
      this.targetYaw += w * dt;
    }
    // a mount gallops while its rider moves (snapshot steps of more than a few cm)
    const galloping = charging || (mount && this.moved > 0.08);
    const flying = this.state === 'flying', held = this.state === 'held';
    if (flying) {
      this.target.addScaledVector(this.vel, dt);
      this.vel.y -= C.GOAT.throwGravity * dt;
      if (this.target.y < 0) this.target.y = 0;
    }
    this.group.position.lerp(this.target, Math.min(1, dt * (flying ? 30 : held ? 18 : mount ? 30 : charging || orbit ? 20 : 10)));
    if (this.bleatQueued !== null) { sfx.bleat?.(this.group.position, this.bleatQueued); this.bleatQueued = null; }
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
      case 'return':  lift = Math.abs(Math.sin(t * 10)) * 0.08; roll = Math.sin(t * 10) * 0.05; break;   // trotting home
      case 'orbit':   lift = Math.abs(Math.sin(t * 16)) * 0.12; roll = -0.12 + Math.sin(t * 16) * 0.04; pitch = 0.08; break;   // leaning into the circle
      case 'mount':   if (galloping) { pitch = 0.1 + Math.sin(t * 18) * 0.12; lift = Math.abs(Math.sin(t * 18)) * 0.14; } else pitch = Math.sin(t * 2) * 0.03; break;
      case 'held':    // legs kicking: a fast, uneven wobble of the whole body
        roll = Math.sin(t * 17) * 0.3 + Math.sin(t * 29) * 0.08; pitch = Math.sin(t * 11) * 0.25;
        lift = Math.abs(Math.sin(t * 23)) * 0.06;
        break;
      case 'flying':  roll = Math.sin(t * 21) * 0.25; break;
      case 'stumble': {   // back on its feet: a couple of staggering wobbles that die away
        const k = Math.max(0, 1 - this.stateT / C.GOAT.stumbleTime);
        roll = Math.sin(this.stateT * 22) * 0.22 * k; pitch = 0.12 * k; break;
      }
    }
    // end-over-end tumble in flight; afterwards roll on to the nearest upright
    if (flying) this.spin.rotation.x += dt * 9;
    else if (this.spin.rotation.x) {
      const up = Math.round(this.spin.rotation.x / (Math.PI * 2)) * Math.PI * 2;
      this.spin.rotation.x += (up - this.spin.rotation.x) * Math.min(1, dt * 14);
      if (Math.abs(up - this.spin.rotation.x) < 0.01) this.spin.rotation.x = 0;
    }
    // Leap over the pen fence: a hop arc centred on the fence line (the server lets charges through it).
    const p = this.group.position;
    if (this.state === 'charge' || this.state === 'return') {
      const fd = C.fenceDistance(p.x, p.z);
      if (fd < LEAP_HALF) {
        const k = fd / LEAP_HALF;
        lift = Math.max(lift, (1 - k * k) * LEAP_HEIGHT);
        // nose up on the way over, legs tucked
        const inside = C.inPen(p.x, p.z), goingOut = Math.sin(this.group.rotation.y) * (p.x - PEN_CX) + Math.cos(this.group.rotation.y) * (p.z - PEN_CZ) > 0;
        pitch = (inside === goingOut ? -0.45 : 0.35) * (1 - k);
      }
    }
    if (charging) { trampleCrops(p.x, p.z, 1.1); }
    updateCrops();
    const k = Math.min(1, dt * (lift > 0.3 ? 30 : 14));
    b.rotation.x += (pitch - b.rotation.x) * k;
    b.rotation.z += (roll - b.rotation.z) * k;
    b.position.y += (lift - b.position.y) * k;
    b.position.z += (zOff - b.position.z) * k;

    // summoned rams charge in herds: only a ram turning on a shooter gets the '!'
    this.alert.visible = this.state === 'windup' || (charging && !this.summoned);
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
      if (galloping && this.stepT > (this.summoned ? 0.16 : 0.11)) { this.stepT = 0; sfx.hoof(this.group.position); }
    }
  }

  // A puff of golden dust where a summoned ram appears or vanishes.
  poof(effects) {
    const p = this.group.position.clone().setY(0.6);
    effects.burst(p, 0xffe2a0, 24, 3.5, 0.7, 1.5);
    effects.burst(p, 0xfff6e0, 14, 2.4, 0.55, 0.5);
    effects.dust(this.group.position, 10);
  }
  // goatGone: poof, then remove. (Plain goats never go.)
  despawn(scene, effects) {
    if (effects) this.poof(effects);
    this.dispose(scene);
  }

  dispose(scene) { scene.remove(this.group); }
}
