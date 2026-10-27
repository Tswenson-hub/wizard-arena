// Projectile visuals, particle bursts, debris, teleport flashes.
import * as THREE from 'three';
import * as C from '../shared/constants.js';
import { makePropMesh, makeFragments } from './world.js';

const SPELL_COLORS = { fast: 0x7ad8ff, heavy: 0xff7a2a, prop: 0xb48cff };

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.projectiles = new Map();
    this.particles = [];     // { mesh, vel, life, maxLife, grav, shrink }
    this.debris = [];
    this.clock = 0;

    this.particleGeo = new THREE.TetrahedronGeometry(0.12, 0);
    this.sphereGeo = new THREE.IcosahedronGeometry(1, 1);
    this.mats = {};
  }

  mat(color, extra = {}) {
    const key = color + JSON.stringify(extra);
    return this.mats[key] ??= new THREE.MeshBasicMaterial({ color, transparent: true, ...extra });
  }

  // ---------------------------------------------------------------- projectiles
  spawnProjectile(msg) {
    const g = new THREE.Group();
    const color = SPELL_COLORS[msg.kind];
    let light = null;
    if (msg.kind === 'fast') {
      const core = new THREE.Mesh(this.sphereGeo, this.mat(0xffffff));
      core.scale.setScalar(0.16);
      const glow = new THREE.Mesh(this.sphereGeo, this.mat(color, { opacity: 0.55 }));
      glow.scale.setScalar(0.3);
      g.add(core, glow);
      light = new THREE.PointLight(color, 3, 6);
      g.add(light);
    } else if (msg.kind === 'heavy') {
      const core = new THREE.Mesh(this.sphereGeo, this.mat(0xfff0c0));
      core.scale.setScalar(0.35);
      const glow = new THREE.Mesh(this.sphereGeo, this.mat(color, { opacity: 0.5 }));
      glow.scale.setScalar(0.7);
      const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9, 0), this.mat(0xffb060, { wireframe: true, opacity: 0.7 }));
      g.add(core, glow, shell);
      g.userData.shell = shell;
      light = new THREE.PointLight(color, 8, 12);
      g.add(light);
    } else {
      const mesh = makePropMesh(msg.propType);
      mesh.position.y = -C.PROP_TYPES[msg.propType].h * 0.5;
      g.add(mesh);
      const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(C.PROP_TYPES[msg.propType].r + 0.3, 0), this.mat(0xb48cff, { wireframe: true, opacity: 0.45 }));
      g.add(shell);
      g.userData.spin = new THREE.Vector3(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3);
    }
    g.position.set(msg.p[0], msg.p[1], msg.p[2]);
    this.scene.add(g);
    this.projectiles.set(msg.id, {
      id: msg.id, kind: msg.kind, group: g,
      pos: new THREE.Vector3(msg.p[0], msg.p[1], msg.p[2]),
      vel: new THREE.Vector3(msg.v[0], msg.v[1], msg.v[2]),
      g: msg.g || 0, life: msg.life, age: 0, trail: 0,
    });
  }

  endProjectile(msg) {
    const pr = this.projectiles.get(msg.id);
    if (!pr) return;
    this.projectiles.delete(msg.id);
    this.scene.remove(pr.group);
    const p = msg.p ? new THREE.Vector3(msg.p[0], msg.p[1], msg.p[2]) : pr.pos;
    if (msg.hit) {
      if (pr.kind === 'heavy') this.burst(p, 0xff7a2a, 34, 7, 0.8);
      else if (pr.kind === 'fast') this.burst(p, 0x7ad8ff, 14, 4, 0.4);
      // thrown props shatter via the propBreak message
    } else {
      this.burst(p, SPELL_COLORS[pr.kind] || 0xffffff, 6, 1.5, 0.3);
    }
  }

  // ---------------------------------------------------------------- particles
  burst(pos, color, count, speed, size = 0.5, grav = 6) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.particleGeo, this.mat(color, { opacity: 1 }));
      m.position.copy(pos);
      m.scale.setScalar(size * (0.6 + Math.random() * 0.8));
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize();
      this.scene.add(m);
      this.particles.push({ mesh: m, vel: dir.multiplyScalar(speed * (0.4 + Math.random() * 0.8)), life: 0, maxLife: 0.35 + Math.random() * 0.4, grav, shrink: true });
    }
    // flash sphere
    const flash = new THREE.Mesh(this.sphereGeo, this.mat(color, { opacity: 0.6 }));
    flash.position.copy(pos); flash.scale.setScalar(size * 0.8);
    this.scene.add(flash);
    this.particles.push({ mesh: flash, vel: new THREE.Vector3(), life: 0, maxLife: 0.22, grav: 0, grow: size * 6 });
  }

  // Kicked-up dirt at `pos` (a goat's hooves).
  dust(pos, count = 2) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.particleGeo, this.mat(0xb59a72, { opacity: 0.8 }));
      m.position.set(pos.x + (Math.random() - 0.5) * 0.6, 0.1, pos.z + (Math.random() - 0.5) * 0.6);
      m.scale.setScalar(0.6 + Math.random() * 0.9);
      this.scene.add(m);
      this.particles.push({ mesh: m, vel: new THREE.Vector3((Math.random() - 0.5) * 1.5, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 1.5), life: 0, maxLife: 0.5 + Math.random() * 0.3, grav: 3, shrink: true });
    }
  }

  // A goat ram: a big shockwave of dirt and stars.
  ram(pos, blocked) {
    const p = new THREE.Vector3(pos[0], pos[1], pos[2]);
    if (blocked) this.blockFlash(p);
    else { this.burst(p, 0xffe066, 24, 6, 0.5); this.burst(p, 0xb59a72, 20, 5, 0.6); }
    for (let i = 0; i < 10; i++) this.dust(p, 2);
  }

  blockFlash(pos) {
    const flash = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 1), this.mat(0x9ae4ff, { opacity: 0.6, wireframe: true }));
    flash.position.copy(pos);
    this.scene.add(flash);
    this.particles.push({ mesh: flash, vel: new THREE.Vector3(), life: 0, maxLife: 0.3, grav: 0, grow: 0.9 });
    this.burst(pos, 0x9ae4ff, 10, 3, 0.3, 0);
  }

  teleport(from, to) {
    for (const p of [from, to]) {
      const pos = new THREE.Vector3(p[0], p[1] + 1, p[2]);
      this.burst(pos, 0xb48cff, 20, 3.5, 0.45, -2);
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 2.4, 10, 1, true), this.mat(0xc8a8ff, { opacity: 0.6, side: THREE.DoubleSide }));
      pillar.position.copy(pos);
      this.scene.add(pillar);
      this.particles.push({ mesh: pillar, vel: new THREE.Vector3(0, 3, 0), life: 0, maxLife: 0.35, grav: 0, grow: 1.5 });
    }
  }

  // ---------------------------------------------------------------- spellbook
  // Arcane Cyclone pulse: a flat shockwave ring racing out to the radius, a low swirling wall and
  // motes flung outward.
  cyclonePulse(p, radius) {
    const pos = new THREE.Vector3(p[0], p[1], p[2]);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 64).rotateX(-Math.PI / 2),
      this.mat(0xc890ff, { opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.copy(pos).setY(p[1] + 0.12); ring.scale.setScalar(0.6);
    this.scene.add(ring);
    const life = 0.32;
    this.particles.push({ mesh: ring, vel: new THREE.Vector3(), life: 0, maxLife: life, grav: 0, grow: (radius - 0.6) / life, still: true });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.9, 0.8, 40, 1, true),
      this.mat(0x7a3cdf, { opacity: 0.3, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    wall.position.copy(pos).setY(p[1] + 0.4); wall.scale.setScalar(0.6);
    this.scene.add(wall);
    this.particles.push({ mesh: wall, vel: new THREE.Vector3(), life: 0, maxLife: life, grav: 0, growXZ: (radius - 0.6) / life, still: true, spinY: 9 });
    // motes: outward and around, like debris caught in the spin
    for (let i = 0; i < 36; i++) {
      const a = Math.random() * Math.PI * 2, sp = 7 + Math.random() * 9;
      const m = new THREE.Mesh(this.particleGeo, this.mat(i % 3 ? 0xc890ff : 0xffffff, { opacity: 1 }));
      m.position.set(pos.x + Math.sin(a) * 0.8, p[1] + 0.3 + Math.random() * 1.6, pos.z + Math.cos(a) * 0.8);
      m.scale.setScalar(0.35 + Math.random() * 0.5);
      this.scene.add(m);
      const vel = new THREE.Vector3(Math.sin(a) * sp + Math.cos(a) * sp * 0.6, 1 + Math.random() * 2.5, Math.cos(a) * sp - Math.sin(a) * sp * 0.6);
      this.particles.push({ mesh: m, vel, life: 0, maxLife: 0.35 + Math.random() * 0.25, grav: 3, shrink: true });
    }
    this.burst(pos.clone().setY(p[1] + 1), 0xb46cff, 10, 3, 0.5, 0);
  }

  // Skyward Flash launch: a light streak from the ground up to the wizard, a ring on the ground.
  skyward(p, top) {
    const base = new THREE.Vector3(p[0], 0, p[2]);
    const streak = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.45, top + 1.5, 10, 1, true),
      this.mat(0xd8b8ff, { opacity: 0.85, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    streak.position.copy(base).setY((top + 1.5) / 2);
    this.scene.add(streak);
    this.particles.push({ mesh: streak, vel: new THREE.Vector3(), life: 0, maxLife: 0.45, grav: 0, growXZ: -0.8, still: true });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, top + 1.5, 6, 1, true), this.mat(0xffffff, { opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
    core.position.copy(streak.position);
    this.scene.add(core);
    this.particles.push({ mesh: core, vel: new THREE.Vector3(), life: 0, maxLife: 0.3, grav: 0, still: true });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 40).rotateX(-Math.PI / 2),
      this.mat(0xc890ff, { opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.copy(base).setY(0.12); ring.scale.setScalar(0.5);
    this.scene.add(ring);
    this.particles.push({ mesh: ring, vel: new THREE.Vector3(), life: 0, maxLife: 0.5, grav: 0, grow: 6, still: true });
    this.burst(base.clone().setY(0.4), 0xb48cff, 14, 3, 0.4, -2);
    this.burst(base.clone().setY(top + 1), 0xe6d0ff, 12, 3, 0.35, 0);
    for (let i = 0; i < 4; i++) this.dust(base, 2);
  }

  // Touching down after a Skyward Flash.
  land(p) {
    const pos = new THREE.Vector3(p[0], 0, p[2]);
    for (let i = 0; i < 6; i++) this.dust(pos, 2);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32).rotateX(-Math.PI / 2), this.mat(0xb59a72, { opacity: 0.6, depthWrite: false }));
    ring.position.copy(pos).setY(0.12); ring.scale.setScalar(0.4);
    this.scene.add(ring);
    this.particles.push({ mesh: ring, vel: new THREE.Vector3(), life: 0, maxLife: 0.35, grav: 0, grow: 4, still: true });
  }

  death(pos) {
    const p = new THREE.Vector3(pos[0], pos[1] + 1, pos[2]);
    this.burst(p, 0xff3b4e, 30, 5, 0.5);
    this.burst(p, 0x2a0a10, 16, 2.5, 0.7);
  }

  propBreak(type, p) {
    const pos = new THREE.Vector3(p[0], p[1], p[2]);
    for (const frag of makeFragments(type, 9)) {
      frag.position.copy(pos);
      this.scene.add(frag);
      this.debris.push({
        mesh: frag, life: 0, maxLife: 2.2 + Math.random(),
        vel: new THREE.Vector3((Math.random() - 0.5) * 7, 3 + Math.random() * 5, (Math.random() - 0.5) * 7),
        spin: new THREE.Vector3(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5),
      });
    }
    this.burst(pos, C.PROP_TYPES[type].color, 8, 2.5, 0.3);
    if (type === 'hay') { this.burst(pos, 0xe8d27a, 22, 4.5, 0.35, 3); this.burst(pos, 0xc9a94a, 12, 2.5, 0.3, 1); }   // straw puff
    if (type === 'potion') { this.burst(pos, 0x5cf0b0, 22, 5, 0.45); this.burst(pos, 0xd98cff, 14, 3.5, 0.4, -1); }   // potion splash
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    this.clock += dt;
    for (const pr of this.projectiles.values()) {
      pr.age += dt;
      pr.vel.y -= pr.g * dt;
      pr.pos.addScaledVector(pr.vel, dt);
      pr.group.position.copy(pr.pos);
      if (pr.group.userData.shell) { pr.group.userData.shell.rotation.x += dt * 6; pr.group.userData.shell.rotation.y += dt * 4; }
      if (pr.group.userData.spin) { const s = pr.group.userData.spin; pr.group.rotation.x += s.x * dt; pr.group.rotation.y += s.y * dt; pr.group.rotation.z += s.z * dt; }
      // trail
      pr.trail += dt;
      const interval = pr.kind === 'heavy' ? 0.025 : 0.035;
      if (pr.trail > interval) {
        pr.trail = 0;
        const m = new THREE.Mesh(this.sphereGeo, this.mat(SPELL_COLORS[pr.kind], { opacity: 0.5 }));
        m.position.copy(pr.pos);
        if (pr.kind === 'prop') m.position.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.6));
        m.scale.setScalar(pr.kind === 'heavy' ? 0.5 : pr.kind === 'prop' ? 0.14 : 0.2);
        this.scene.add(m);
        this.particles.push({ mesh: m, vel: new THREE.Vector3(), life: 0, maxLife: pr.kind === 'heavy' ? 0.4 : 0.25, grav: 0, shrink: true });
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      const k = p.life / p.maxLife;
      if (k >= 1) { this.scene.remove(p.mesh); this.particles.splice(i, 1); continue; }
      p.vel.y -= (p.grav || 0) * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.grow) p.mesh.scale.addScalar(p.grow * dt);
      else if (p.growXZ) { p.mesh.scale.x = Math.max(0.01, p.mesh.scale.x + p.growXZ * dt); p.mesh.scale.z = Math.max(0.01, p.mesh.scale.z + p.growXZ * dt); }
      else if (p.shrink) p.mesh.scale.multiplyScalar(Math.max(0, 1 - dt * 3));
      if (p.spinY) p.mesh.rotation.y += dt * p.spinY;
      else if (!p.still) { p.mesh.rotation.x += dt * 5; p.mesh.rotation.y += dt * 7; }
      // materials are shared; per-particle opacity needs its own copy (cloned once, lazily)
      if (!p.ownMat) { p.mesh.material = p.mesh.material.clone(); p.ownMat = true; }
      p.mesh.material.opacity = (1 - k) * (p.grow || p.growXZ ? 0.6 : 1) * (p.still ? 1.4 : 1);
    }

    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life += dt;
      if (d.life > d.maxLife) { this.scene.remove(d.mesh); this.debris.splice(i, 1); continue; }
      d.vel.y -= 16 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      if (d.mesh.position.y < 0.08) { d.mesh.position.y = 0.08; d.vel.y *= -0.35; d.vel.x *= 0.7; d.vel.z *= 0.7; d.spin.multiplyScalar(0.5); }
      d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt; d.mesh.rotation.z += d.spin.z * dt;
      if (d.life > d.maxLife - 0.5) d.mesh.scale.multiplyScalar(Math.max(0, 1 - dt * 2));
    }
  }
}
