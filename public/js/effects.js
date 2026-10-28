// Projectile visuals, particle bursts, debris, teleport flashes.
import * as THREE from 'three';
import * as C from '../shared/constants.js';
import { makePropMesh, makeFragments } from './world.js';

const SPELL_COLORS = { fast: 0x7ad8ff, heavy: 0xff7a2a, prop: 0xb48cff, skim: 0xbfeaff, lash: 0xff2a3c };
const BULWARK = C.SPELLBOOK.glacial_bulwark, FROST = C.SPELLBOOK.frostfall, SMOKE = C.SPELLBOOK.smoke_screen;

// Smoke Screen puff: a soft lumpy blob, drawn once.
let puffTex = null;
function puffTexture() {
  if (puffTex) return puffTex;
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  let seed = 5;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 14; i++) {
    const x = S / 2 + (rnd() - 0.5) * S * 0.4, y = S / 2 + (rnd() - 0.5) * S * 0.4, r = S * (0.18 + rnd() * 0.2);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, S, S);
  }
  puffTex = new THREE.CanvasTexture(c); puffTex.colorSpace = THREE.SRGBColorSpace;
  return puffTex;
}

// Frostfall's warning: a dark shadow with a frosty rim, drawn once.
let frostShadowTex = null;
function frostShadowTexture() {
  if (frostShadowTex) return frostShadowTex;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(10,20,40,0.85)'); grad.addColorStop(0.75, 'rgba(10,25,50,0.6)');
  grad.addColorStop(0.9, 'rgba(160,220,255,0.55)'); grad.addColorStop(1, 'rgba(160,220,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  // frost crystals around the rim
  g.strokeStyle = 'rgba(220,245,255,0.9)'; g.lineWidth = 3; g.translate(S / 2, S / 2);
  for (let i = 0; i < 24; i++) { g.rotate(Math.PI * 2 / 24); g.beginPath(); g.moveTo(0, -S * 0.43); g.lineTo(0, -S * 0.49); g.moveTo(-5, -S * 0.455); g.lineTo(5, -S * 0.455); g.stroke(); }
  frostShadowTex = new THREE.CanvasTexture(c); frostShadowTex.colorSpace = THREE.SRGBColorSpace;
  return frostShadowTex;
}

// Crack lines for the ice wall, generated once: each wall shows more of them as it takes damage.
const CRACKS = (() => {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out = [];
  for (let i = 0; i < 14; i++) {
    let x = (rnd() - 0.5) * BULWARK.width * 0.8, y = 0.3 + rnd() * (BULWARK.height - 0.6);
    const pts = [];
    for (let k = 0; k < 5; k++) {
      const nx = x + (rnd() - 0.5) * 0.7, ny = y + (rnd() - 0.5) * 0.7;
      pts.push(x, y, nx, ny); x = nx; y = ny;
    }
    out.push(pts);
  }
  return out;
})();

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
      // the finisher (last shot of the magazine) is bigger and burns gold, so it reads at a glance
      const core = new THREE.Mesh(this.sphereGeo, this.mat(msg.fin ? 0xfffbe8 : 0xffffff));
      core.scale.setScalar(msg.fin ? 0.24 : 0.16);
      const glow = new THREE.Mesh(this.sphereGeo, this.mat(msg.fin ? 0xffc94a : color, { opacity: msg.fin ? 0.7 : 0.55 }));
      glow.scale.setScalar(msg.fin ? 0.52 : 0.3);
      g.add(core, glow);
      if (msg.fin) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.04, 6, 20), this.mat(0xffe08a, { opacity: 0.8 })); g.add(ring); g.userData.shell = ring; }
      light = new THREE.PointLight(msg.fin ? 0xffc94a : color, msg.fin ? 7 : 3, msg.fin ? 9 : 6);
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
    } else if (msg.kind === 'skim') {
      // an ice shard: a stretched crystal pointing along its flight
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), this.mat(msg.fin ? 0xffffff : 0xe8f8ff));
      shard.scale.set(0.8, 0.8, 2.4).multiplyScalar(msg.fin ? 1.5 : 1);
      const glow = new THREE.Mesh(this.sphereGeo, this.mat(msg.fin ? 0x5cc8ff : 0x9adfff, { opacity: msg.fin ? 0.6 : 0.35 }));
      glow.scale.setScalar(msg.fin ? 0.42 : 0.24);
      g.add(shard, glow);
      g.lookAt(msg.v[0], 0, msg.v[2]);
      g.userData.aim = true;
    } else if (msg.kind === 'lash') {
      // the whip: a long blood-red streak with a bright tip
      const tip = new THREE.Mesh(this.sphereGeo, this.mat(0xffd0d4));
      tip.scale.setScalar(0.14);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.13, 2.6, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, -1.3),
        this.mat(0xff2a3c, { opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
      g.add(tip, body);
      light = new THREE.PointLight(0xff2a3c, 4, 7);
      g.add(light);
      g.userData.aimV = new THREE.Vector3(msg.v[0], msg.v[1], msg.v[2]);
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
      g: msg.g || 0, life: msg.life, age: 0, trail: 0, fin: !!msg.fin,
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
      else if (pr.kind === 'skim') this.burst(p, 0xdff6ff, 9, 3, 0.25, 4);
      else if (pr.kind === 'lash') this.burst(p, 0xff2a3c, 14, 4, 0.35);
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

  // ---------------------------------------------------------------- Sanguine Lash / Mirror Step / Bulwark / Relic
  // A bound wizard: a crimson snap where the whip caught them.
  bind(pos) {
    const p = new THREE.Vector3(pos[0], pos[1] + 1, pos[2]);
    this.burst(p, 0xff2a3c, 18, 4, 0.4, 0);
    this.burst(p, 0x5a0010, 10, 2, 0.5, 0);
  }

  // A decoy bursting (popped) or fading at the end of its run: smoke and glints in the owner's colour.
  decoyPuff(p, color, popped) {
    const pos = new THREE.Vector3(p[0], 1, p[2]);
    this.burst(pos, 0xd8c8e8, popped ? 22 : 12, popped ? 3.5 : 2, 0.55, -1.5);
    this.burst(pos, color, popped ? 12 : 6, 3, 0.3, 0);
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 1.9, 12, 1, true), this.mat(0xe8dcff, { opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    shell.position.copy(pos);
    this.scene.add(shell);
    this.particles.push({ mesh: shell, vel: new THREE.Vector3(0, 1.5, 0), life: 0, maxLife: popped ? 0.3 : 0.5, grav: 0, grow: 1.2, still: true });
  }

  // Mirror Step: a flash where the caster stood and a mirror shimmer at each of the three ends.
  mirror(from, ends) {
    this.burst(new THREE.Vector3(from[0], 1, from[2]), 0xff6a80, 18, 3.5, 0.4, -2);
    for (const e of ends) {
      const pos = new THREE.Vector3(e[0], 1, e[2]);
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.2), this.mat(0xffc8d8, { opacity: 0.55, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      pane.position.copy(pos);
      pane.rotation.y = Math.atan2(e[0] - from[0], e[2] - from[2]) + Math.PI / 2;
      this.scene.add(pane);
      this.particles.push({ mesh: pane, vel: new THREE.Vector3(), life: 0, maxLife: 0.35, grav: 0, growXZ: -2, still: true });
      this.burst(pos, 0xffc8d8, 8, 2.5, 0.3, -1);
    }
  }

  // Glacial Bulwark: an ice slab with crystals on top. Returns { group, setHp(hp) }.
  wall(w) {
    const g = new THREE.Group();
    g.position.set(w.x, 0, w.z);
    g.rotation.y = w.yaw;
    const iceMat = new THREE.MeshStandardMaterial({ color: 0xaee6ff, emissive: 0x3a8fc8, emissiveIntensity: 0.35, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.72 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(BULWARK.width, BULWARK.height, 0.5), iceMat);
    slab.position.y = BULWARK.height / 2;
    slab.castShadow = true;
    g.add(slab);
    // jagged crystals along the top and the edges
    let seed = w.id * 977 + 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 9; i++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.16 + rnd() * 0.12, 0.5 + rnd() * 0.7, 5), iceMat);
      c.position.set((i / 8 - 0.5) * BULWARK.width, BULWARK.height + 0.15, (rnd() - 0.5) * 0.3);
      c.rotation.z = (rnd() - 0.5) * 0.6;
      g.add(c);
    }
    for (const side of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.2, 5), iceMat);
      c.position.set(side * (BULWARK.width / 2 + 0.05), 0.5, 0); c.rotation.z = -side * 0.35;
      g.add(c);
    }
    // cracks on both faces, revealed as the wall takes damage
    const crackMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    const cracks = CRACKS.map(pts => {
      const geo = new THREE.BufferGeometry();
      // each segment twice: on the front face and on the back face
      const arr = [];
      for (let i = 0; i < pts.length; i += 4) for (const z of [0.26, -0.26]) arr.push(pts[i], pts[i + 1], z, pts[i + 2], pts[i + 3], z);
      geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      const l = new THREE.LineSegments(geo, crackMat);
      l.visible = false;
      g.add(l);
      return l;
    });
    g.scale.y = 0.05;
    this.scene.add(g);
    const pos = new THREE.Vector3(w.x, 0.3, w.z);
    for (let i = 0; i < 5; i++) this.dust(pos, 2);
    this.burst(pos.clone().setY(1), 0xdff6ff, 16, 3, 0.35, 2);
    const entry = {
      group: g, rise: 0,
      setHp: (hp) => {
        const k = 1 - Math.max(0, hp) / BULWARK.hp;
        cracks.forEach((c, i) => { c.visible = i < Math.round(k * cracks.length * 1.1); });
        iceMat.opacity = 0.72 - k * 0.2;
      },
    };
    entry.setHp(w.hp);
    (this.walls ??= new Set()).add(entry);
    return entry;
  }
  wallHit(entry, p) {
    this.burst(new THREE.Vector3(p[0], p[1], p[2]), 0xdff6ff, 8, 3, 0.25, 4);
  }
  wallShatter(entry, w) {
    this.walls?.delete(entry);
    this.scene.remove(entry.group);
    const rx = Math.cos(w.yaw), rz = -Math.sin(w.yaw);
    const shardMat = this.mat(0xc8eeff, { opacity: 0.9 });
    for (let i = 0; i < 34; i++) {
      const k = (Math.random() - 0.5) * BULWARK.width;
      const m = new THREE.Mesh(new THREE.TetrahedronGeometry(0.12 + Math.random() * 0.16, 0), shardMat);
      m.position.set(w.x + rx * k, 0.2 + Math.random() * BULWARK.height, w.z + rz * k);
      this.scene.add(m);
      this.debris.push({
        mesh: m, life: 0, maxLife: 1.4 + Math.random() * 0.8,
        vel: new THREE.Vector3((Math.random() - 0.5) * 5, 1 + Math.random() * 4, (Math.random() - 0.5) * 5),
        spin: new THREE.Vector3(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5),
      });
    }
    this.burst(new THREE.Vector3(w.x, 1.3, w.z), 0xe8f8ff, 26, 5, 0.4, 3);
  }

  // Trapped Relic: a crimson blast at the lifter's hold point.
  relicBlast(p, radius) {
    const pos = new THREE.Vector3(p[0], p[1], p[2]);
    this.burst(pos, 0xff2a3c, 40, 8, 0.7);
    this.burst(pos, 0x2a0008, 22, 4, 0.8);
    this.burst(pos, 0xffd0a0, 16, 6, 0.4, 2);
    const orb = new THREE.Mesh(this.sphereGeo, this.mat(0xff3048, { opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    orb.position.copy(pos); orb.scale.setScalar(0.5);
    this.scene.add(orb);
    this.particles.push({ mesh: orb, vel: new THREE.Vector3(), life: 0, maxLife: 0.3, grav: 0, grow: (radius - 0.5) / 0.3, still: true });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2),
      this.mat(0xff3048, { opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.set(p[0], 0.13, p[2]); ring.scale.setScalar(0.5);
    this.scene.add(ring);
    this.particles.push({ mesh: ring, vel: new THREE.Vector3(), life: 0, maxLife: 0.35, grav: 0, grow: (radius - 0.5) / 0.35, still: true });
  }

  // The faint red glyph over a prop we've cursed (only its curser ever sees it).
  curseGlyph() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.translate(64, 64); g.strokeStyle = '#ff6070'; g.lineWidth = 6; g.lineCap = 'round';
    g.shadowColor = '#ff2040'; g.shadowBlur = 10;
    g.beginPath(); g.arc(0, 0, 50, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(0, -36); g.lineTo(0, 36); g.moveTo(-26, -14); g.lineTo(0, 8); g.lineTo(26, -14); g.moveTo(-18, 26); g.lineTo(18, 26); g.stroke();
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false }));
    sp.scale.setScalar(0.7);
    sp.visible = false;
    this.scene.add(sp);
    return sp;
  }

  // ---------------------------------------------------------------- Smoke Screen
  // A dense grey-brown cloud of layered billboard puffs that drift and churn, a few ember-lit ones low
  // down, for `left` seconds, then a SMOKE.fade fade. Timed on the real clock.
  smoke(p, left) {
    const g = new THREE.Group();
    g.position.set(p[0], 0, p[2]);
    const puffs = [];
    const N = 34;
    for (let i = 0; i < N; i++) {
      const ember = i < 6;
      const shade = ember ? new THREE.Color(0xc0643a) : new THREE.Color().setHSL(0.07, 0.12 + Math.random() * 0.1, 0.32 + Math.random() * 0.16);
      const mat = new THREE.SpriteMaterial({ map: puffTexture(), color: shade, transparent: true, opacity: 0, depthWrite: false, rotation: Math.random() * Math.PI * 2 });
      const sp = new THREE.Sprite(mat);
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * SMOKE.radius * 0.8;
      const y = ember ? 0.4 + Math.random() * 0.5 : 0.5 + Math.random() * (SMOKE.height - 0.6);
      sp.position.set(Math.sin(a) * r, y, Math.cos(a) * r);
      const size = (ember ? 1.4 : 2.4) + Math.random() * 1.4;
      sp.scale.setScalar(size * 0.3);
      sp.renderOrder = 3;
      g.add(sp);
      puffs.push({ sp, size, base: sp.position.clone(), phase: Math.random() * 6.28, spin: (Math.random() - 0.5) * 0.6, alpha: ember ? 0.55 : 0.82 });
    }
    this.scene.add(g);
    const pos = new THREE.Vector3(p[0], 0.8, p[2]);
    this.burst(pos, 0x8a7a6a, 22, 4, 0.6, -1);
    this.burst(pos, 0xff8a3c, 12, 3, 0.25, -2);
    for (let i = 0; i < 6; i++) this.dust(pos, 2);
    const now = performance.now() / 1000;
    const e = { group: g, puffs, born: now, endAt: now + left, x: p[0], z: p[2] };
    (this.smokes ??= new Set()).add(e);
    return e;
  }

  // ---------------------------------------------------------------- Frostfall
  // The warning everyone sees: a shadow growing to the full circle with a pale frost ring, and the
  // block of ice dropping out of the sky for the last FROST.fall seconds. `left` = seconds to impact.
  frostfall(p, left) {
    const g = new THREE.Group();
    g.position.set(p[0], 0, p[2]);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: frostShadowTexture(), transparent: true, depthWrite: false }));
    shadow.position.y = 0.14; shadow.renderOrder = 2;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xbfeaff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.y = 0.15; ring.scale.setScalar(FROST.radius);
    const iceMat = new THREE.MeshStandardMaterial({ color: 0xcdefff, emissive: 0x3a8fc8, emissiveIntensity: 0.4, roughness: 0.15, flatShading: true, transparent: true, opacity: 0.9 });
    const ice = new THREE.Group();
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 0), iceMat);
    core.scale.set(1, 1.3, 1);
    ice.add(core);
    for (let i = 0; i < 7; i++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.6, 5), iceMat);
      const a = i / 7 * Math.PI * 2;
      sp.position.set(Math.sin(a) * 1.1, (i % 3 - 1) * 0.7, Math.cos(a) * 1.1);
      sp.rotation.set(Math.cos(a) * 1.3, 0, -Math.sin(a) * 1.3);
      ice.add(sp);
    }
    ice.visible = false; ice.castShadow = true;
    g.add(shadow, ring, ice);
    this.scene.add(g);
    // timed on the real clock, not the frame-clamped dt, so a slow machine still sees the ice land on time
    const e = { group: g, shadow, ring, ice, total: Math.max(left, 0.01), left, endAt: performance.now() / 1000 + left };
    (this.frosts ??= new Set()).add(e);
    return e;
  }
  frostfallImpact(e, p) {
    if (e) { this.frosts?.delete(e); this.scene.remove(e.group); }
    const pos = new THREE.Vector3(p[0], 0.6, p[2]);
    const shardMat = this.mat(0xd8f2ff, { opacity: 0.95 });
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(new THREE.TetrahedronGeometry(0.12 + Math.random() * 0.22, 0), shardMat);
      m.position.set(p[0] + (Math.random() - 0.5) * 2, 0.3 + Math.random() * 1.2, p[2] + (Math.random() - 0.5) * 2);
      this.scene.add(m);
      const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 6;
      this.debris.push({ mesh: m, life: 0, maxLife: 1.2 + Math.random() * 0.9,
        vel: new THREE.Vector3(Math.sin(a) * sp, 2 + Math.random() * 5, Math.cos(a) * sp),
        spin: new THREE.Vector3(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5) });
    }
    // mist: slow, rising, spreading
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(this.sphereGeo, this.mat(0xeef8ff, { opacity: 0.5, depthWrite: false }));
      const a = Math.random() * Math.PI * 2, r = Math.random() * FROST.radius;
      m.position.set(p[0] + Math.sin(a) * r, 0.3 + Math.random() * 0.6, p[2] + Math.cos(a) * r);
      m.scale.setScalar(0.4 + Math.random() * 0.5);
      this.scene.add(m);
      this.particles.push({ mesh: m, vel: new THREE.Vector3(Math.sin(a) * 1.5, 0.6 + Math.random(), Math.cos(a) * 1.5), life: 0, maxLife: 1 + Math.random() * 0.6, grav: 0, grow: 1.2 });
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64).rotateX(-Math.PI / 2),
      this.mat(0xdff6ff, { opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.set(p[0], 0.15, p[2]); ring.scale.setScalar(1);
    this.scene.add(ring);
    this.particles.push({ mesh: ring, vel: new THREE.Vector3(), life: 0, maxLife: 0.4, grav: 0, grow: (FROST.radius + 1.5) / 0.4, still: true });
    this.burst(pos, 0xffffff, 20, 6, 0.5, 4);
    for (let i = 0; i < 8; i++) this.dust(pos, 2);
  }
  // The caster's targeting circle while RMB is held.
  frostAim() {
    const g = new THREE.Group();
    const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.16, depthWrite: false }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xcdf0ff, transparent: true, opacity: 0.85, depthWrite: false }));
    fill.position.y = ring.position.y = 0.16;
    g.add(fill, ring);
    g.scale.setScalar(FROST.radius);
    g.visible = false;
    this.scene.add(g);
    return g;
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
      if (pr.group.userData.aimV) pr.group.lookAt(pr.pos.clone().add(pr.vel));
      if (pr.group.userData.spin) { const s = pr.group.userData.spin; pr.group.rotation.x += s.x * dt; pr.group.rotation.y += s.y * dt; pr.group.rotation.z += s.z * dt; }
      // trail
      pr.trail += dt;
      const interval = pr.kind === 'heavy' || pr.kind === 'lash' ? 0.025 : 0.035;
      if (pr.trail > interval) {
        pr.trail = 0;
        const m = new THREE.Mesh(this.sphereGeo, this.mat(pr.fin && pr.kind === 'fast' ? 0xffc94a : SPELL_COLORS[pr.kind], { opacity: pr.fin ? 0.7 : 0.5 }));
        m.position.copy(pr.pos);
        if (pr.kind === 'prop') m.position.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.6));
        m.scale.setScalar((pr.kind === 'heavy' ? 0.5 : pr.kind === 'prop' ? 0.14 : pr.kind === 'skim' ? 0.11 : pr.kind === 'lash' ? 0.13 : 0.2) * (pr.fin ? 1.8 : 1));
        this.scene.add(m);
        this.particles.push({ mesh: m, vel: new THREE.Vector3(), life: 0, maxLife: pr.kind === 'heavy' ? 0.4 : 0.25, grav: 0, shrink: true });
      }
    }

    // Frostfall warnings: the shadow grows over the delay, the ice drops in the last FROST.fall seconds
    for (const e of this.frosts || []) {
      e.left = e.endAt - performance.now() / 1000;
      const k = Math.min(1, 1 - Math.max(0, e.left) / e.total);
      e.shadow.scale.setScalar(FROST.radius * (0.25 + 0.75 * k));
      e.shadow.material.opacity = 0.45 + 0.55 * k;
      e.ring.material.opacity = 0.5 + 0.4 * Math.sin(this.clock * 12) * 0.5 + 0.2 * k;
      e.ring.rotation.y += dt * 0.5;
      if (e.left <= FROST.fall) {
        const f = Math.max(0, e.left) / FROST.fall;    // 1 -> 0
        e.ice.visible = true;
        e.ice.position.y = 1.4 + f * f * 18;
        e.ice.rotation.y += dt * 2;
      }
      if (e.left < -1) { this.frosts.delete(e); this.scene.remove(e.group); }   // lost the impact message
    }

    // smoke clouds: billow out, churn, then fade
    const tNow = performance.now() / 1000;
    for (const e of this.smokes || []) {
      const grow = Math.min(1, (tNow - e.born) / 0.35);
      const fade = Math.max(0, Math.min(1, (e.endAt + SMOKE.fade - tNow) / SMOKE.fade));
      if (fade <= 0) { this.smokes.delete(e); this.scene.remove(e.group); continue; }
      for (const q of e.puffs) {
        const w = tNow * 0.6 + q.phase;
        q.sp.position.set(q.base.x + Math.sin(w) * 0.35, q.base.y + Math.sin(w * 0.7) * 0.15 + (1 - fade) * 0.6, q.base.z + Math.cos(w * 0.8) * 0.35);
        q.sp.scale.setScalar(q.size * (0.3 + 0.7 * (1 - Math.pow(1 - grow, 3))) * (1 + (1 - fade) * 0.3));
        q.sp.material.rotation += q.spin * dt;
        q.sp.material.opacity = q.alpha * grow * fade;
      }
    }

    // walls rise out of the ground
    for (const w of this.walls || []) if (w.rise < 1) { w.rise = Math.min(1, w.rise + dt / 0.15); w.group.scale.y = 0.05 + 0.95 * (1 - Math.pow(1 - w.rise, 3)); }

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
