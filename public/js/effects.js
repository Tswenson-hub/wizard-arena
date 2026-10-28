// Projectile visuals, particle bursts, debris, teleport flashes.
import * as THREE from 'three';
import * as C from '../shared/constants.js';
import { makePropMesh, makeFragments } from './world.js';

const SPELL_COLORS = { fast: 0x7ad8ff, heavy: 0xff7a2a, prop: 0xb48cff, skim: 0xbfeaff, lash: 0xff2a3c, fireball: 0xff6a1e, shear: 0xd8c8ff, hex: 0xff1f3d };
const HEX_SHAPES = [3, 4, 0];   // Hex Shards: a triangle, a diamond, then a crescent (0)
const BULWARK = C.SPELLBOOK.glacial_bulwark, FROST = C.SPELLBOOK.frostfall, SMOKE = C.SPELLBOOK.smoke_screen;
const CAGE = C.SPELLBOOK.night_cage;
const CATA = C.SPELLBOOK.cataclysm, EYE = C.SPELLBOOK.eye_of_storm, ZERO = C.SPELLBOOK.absolute_zero;
const realNow = () => performance.now() / 1000;

// A meteor's warning: a scorched shadow with a glowing ember rim, drawn once.
let emberShadowTex = null;
function emberShadowTexture() {
  if (emberShadowTex) return emberShadowTex;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(30,8,0,0.85)'); grad.addColorStop(0.7, 'rgba(50,14,0,0.6)');
  grad.addColorStop(0.88, 'rgba(255,120,30,0.65)'); grad.addColorStop(1, 'rgba(255,120,30,0)');
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  emberShadowTex = new THREE.CanvasTexture(c); emberShadowTex.colorSpace = THREE.SRGBColorSpace;
  return emberShadowTex;
}
// Cinder's Firewall: tongues of flame, white-hot at the base, drawn once and scrolled upward.
let fireTex = null;
function fireTexture() {
  if (fireTex) return fireTex;
  const W = 128, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  let seed = 9;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 40; i++) {
    const x = rnd() * W, w = 6 + rnd() * 14, top = H * (0.05 + rnd() * 0.5);
    const grad = g.createLinearGradient(0, H, 0, top);
    grad.addColorStop(0, 'rgba(255,240,180,0.9)'); grad.addColorStop(0.35, 'rgba(255,140,30,0.7)'); grad.addColorStop(1, 'rgba(255,40,0,0)');
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(x - w, H); g.quadraticCurveTo(x - w * 0.3, (H + top) / 2, x + (rnd() - 0.5) * 10, top); g.quadraticCurveTo(x + w * 0.3, (H + top) / 2, x + w, H); g.fill();
  }
  fireTex = new THREE.CanvasTexture(c); fireTex.colorSpace = THREE.SRGBColorSpace;
  fireTex.wrapS = fireTex.wrapT = THREE.RepeatWrapping;
  return fireTex;
}

// Eye of the Storm's funnel walls: soft diagonal streaks of wind, drawn once.
let windTex = null;
function windTexture() {
  if (windTex) return windTex;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  let seed = 3;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 34; i++) {
    const y = rnd() * S, w = 3 + rnd() * 6, a = 0.5 + rnd() * 0.5;
    const grad = g.createLinearGradient(0, 0, S, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.5, `rgba(255,255,255,${a})`); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.strokeStyle = grad; g.lineWidth = w;
    g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(S * 0.3, y - 30, S * 0.7, y + 30, S, y - 10); g.stroke();
  }
  windTex = new THREE.CanvasTexture(c); windTex.colorSpace = THREE.SRGBColorSpace;
  windTex.wrapS = windTex.wrapT = THREE.RepeatWrapping;
  return windTex;
}

// Absolute Zero's rune: concentric rings, spokes and frost glyphs, drawn once.
let zeroRuneTex = null;
function zeroRuneTexture() {
  if (zeroRuneTex) return zeroRuneTex;
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.translate(S / 2, S / 2); g.strokeStyle = 'rgba(220,245,255,1)'; g.lineCap = 'round';
  for (const [r, w] of [[0.48, 6], [0.44, 2], [0.3, 4], [0.12, 3]]) { g.lineWidth = w; g.beginPath(); g.arc(0, 0, S * r, 0, Math.PI * 2); g.stroke(); }
  g.lineWidth = 3;
  for (let i = 0; i < 12; i++) {
    g.rotate(Math.PI / 6);
    g.beginPath(); g.moveTo(0, S * 0.12); g.lineTo(0, S * 0.44); g.stroke();
    // a little snowflake branch on each spoke
    g.beginPath(); g.moveTo(0, S * 0.36); g.lineTo(-S * 0.03, S * 0.4); g.moveTo(0, S * 0.36); g.lineTo(S * 0.03, S * 0.4); g.stroke();
  }
  zeroRuneTex = new THREE.CanvasTexture(c); zeroRuneTex.colorSpace = THREE.SRGBColorSpace;
  return zeroRuneTex;
}

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
    const color = msg.kind === 'fast' && msg.color !== undefined ? msg.color : SPELL_COLORS[msg.kind];
    let light = null;
    if (msg.kind === 'fast') {
      // in the caster's colour (msg.color) around a hot near-white core; the finisher (last shot of the
      // magazine) is bigger, brighter and ringed, so it reads at a glance
      const tint = new THREE.Color(color), hot = tint.clone().lerp(new THREE.Color(0xffffff), 0.5);
      const core = new THREE.Mesh(this.sphereGeo, this.mat(0xfff6ee));
      core.scale.setScalar(msg.fin ? 0.24 : 0.16);
      const glow = new THREE.Mesh(this.sphereGeo, this.mat(color, { opacity: msg.fin ? 0.75 : 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.setScalar(msg.fin ? 0.52 : 0.3);
      g.add(core, glow);
      if (msg.fin) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.04, 6, 20), this.mat(hot.getHex(), { opacity: 0.85 })); g.add(ring); g.userData.shell = ring; }
      light = new THREE.PointLight(color, msg.fin ? 7 : 3, msg.fin ? 9 : 6);
      g.add(light);
    } else if (msg.kind === 'fireball') {
      // Cinder's Fireball: a white-hot core in a fat flame shell, bigger again for the 3rd shot
      const k = msg.fin ? 1.45 : 1;
      const core = new THREE.Mesh(this.sphereGeo, this.mat(0xfff2c8));
      core.scale.setScalar(0.2 * k);
      const flame = new THREE.Mesh(this.sphereGeo, this.mat(0xff7a1e, { opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
      flame.scale.setScalar(0.42 * k);
      const outer = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6 * k, 0), this.mat(0xff3a0a, { opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      g.add(core, flame, outer);
      g.userData.shell = outer;
      if (msg.fin) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 6, 24), this.mat(0xffd080, { opacity: 0.85 })); g.add(ring); g.userData.ring = ring; }
      light = new THREE.PointLight(0xff6a1e, msg.fin ? 9 : 5, msg.fin ? 11 : 8);
      g.add(light);
    } else if (msg.kind === 'shear') {
      // Gale Shear: a thin crescent blade of wind, flat, swept along its flight; the 3rd is wider
      const R = msg.r || C.SPELLS.shear.radius;
      const blade = new THREE.Mesh(new THREE.RingGeometry(R * 0.78, R, 24, 1, Math.PI * 0.15, Math.PI * 0.7).rotateX(-Math.PI / 2).rotateY(-Math.PI / 2 - Math.PI * 0.5),
        this.mat(0xe8dcff, { opacity: msg.fin ? 0.9 : 0.7, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      const inner = new THREE.Mesh(new THREE.RingGeometry(R * 0.55, R * 0.8, 24, 1, Math.PI * 0.2, Math.PI * 0.6).rotateX(-Math.PI / 2).rotateY(-Math.PI),
        this.mat(0xa070ff, { opacity: 0.45, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      g.add(blade, inner);
      g.userData.aimV = new THREE.Vector3(msg.v[0], msg.v[1], msg.v[2]);
    } else if (msg.kind === 'hex') {
      // Vesper's Hex Shards: a spinning crimson glyph (triangle, diamond, crescent) with a dark core
      const shape = HEX_SHAPES[msg.curve?.shot ?? 0];
      const geo = shape ? new THREE.RingGeometry(0.2, 0.32, shape, 1) : new THREE.RingGeometry(0.22, 0.34, 16, 1, 0, Math.PI * 1.25);
      const glyph = new THREE.Mesh(geo, this.mat(0xff2a48, { side: THREE.DoubleSide, opacity: 0.95 }));
      const glow = new THREE.Mesh(this.sphereGeo, this.mat(0xff1f3d, { opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.setScalar(msg.fin ? 0.38 : 0.26);
      const dark = new THREE.Mesh(this.sphereGeo, this.mat(0x2a0008));
      dark.scale.setScalar(0.08);
      if (msg.fin) glyph.scale.setScalar(1.4);
      g.add(glyph, glow, dark);
      g.userData.glyph = glyph;
      light = new THREE.PointLight(0xff1f3d, msg.fin ? 4 : 2.2, 6);
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
      g: msg.g || 0, life: msg.life, age: 0, trail: 0, fin: !!msg.fin, color, curve: msg.curve || null,
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
      else if (pr.kind === 'fast') { this.burst(p, pr.color, pr.fin ? 22 : 14, pr.fin ? 5 : 4, pr.fin ? 0.5 : 0.4); if (pr.fin) this.burst(p, 0xffffff, 8, 3, 0.3, 0); }
      else if (pr.kind === 'skim') this.burst(p, 0xdff6ff, 9, 3, 0.25, 4);
      else if (pr.kind === 'lash') this.burst(p, 0xff2a3c, 14, 4, 0.35);
      else if (pr.kind === 'fireball') { this.burst(p, 0xff7a1e, pr.fin ? 30 : 20, pr.fin ? 6 : 5, pr.fin ? 0.7 : 0.55); this.burst(p, 0xffd080, 8, 3, 0.35, 0); }
      else if (pr.kind === 'shear') this.burst(p, 0xe8dcff, 12, 5, 0.3, 0);
      else if (pr.kind === 'hex') this.burst(p, 0xff1f3d, pr.fin ? 18 : 12, 4, 0.35);
      // thrown props shatter via the propBreak message
    } else {
      this.burst(p, pr.color ?? SPELL_COLORS[pr.kind] ?? 0xffffff, 6, 1.5, 0.3);
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

  blockFlash(pos, color = 0x9ae4ff) {
    const flash = new THREE.Mesh(new THREE.IcosahedronGeometry(1.3, 1), this.mat(color, { opacity: 0.6, wireframe: true }));
    flash.position.copy(pos);
    this.scene.add(flash);
    this.particles.push({ mesh: flash, vel: new THREE.Vector3(), life: 0, maxLife: 0.3, grav: 0, grow: 0.9 });
    this.burst(pos, color, 10, 3, 0.3, 0);
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

  // ---------------------------------------------------------------- Tempest Veil
  // A gust bursting outward when the veil goes up; a soft pop when it ends.
  veilGust(p) {
    const pos = new THREE.Vector3(p[0], 1, p[2]);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 6, 40).rotateX(Math.PI / 2),
      this.mat(0xe8dcff, { opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.copy(pos); ring.scale.setScalar(0.4);
    this.scene.add(ring);
    this.particles.push({ mesh: ring, vel: new THREE.Vector3(), life: 0, maxLife: 0.35, grav: 0, grow: 9, still: true });
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI * 2;
      const m = new THREE.Mesh(this.particleGeo, this.mat(i % 2 ? 0xffffff : 0xb98cff, { opacity: 1 }));
      m.position.set(p[0] + Math.sin(a) * 0.6, 0.3 + Math.random() * 1.6, p[2] + Math.cos(a) * 0.6);
      m.scale.setScalar(0.4);
      this.scene.add(m);
      this.particles.push({ mesh: m, vel: new THREE.Vector3(Math.sin(a) * 7 + Math.cos(a) * 3, 0.5, Math.cos(a) * 7 - Math.sin(a) * 3), life: 0, maxLife: 0.4, grav: 0, shrink: true });
    }
    for (let i = 0; i < 4; i++) this.dust(pos, 2);
  }
  veilPop(p) {
    const pos = new THREE.Vector3(p[0], 1, p[2]);
    this.burst(pos, 0xe8dcff, 16, 4, 0.3, 0);
    const shell = new THREE.Mesh(this.sphereGeo, this.mat(0xd8c8ff, { opacity: 0.5, depthWrite: false }));
    shell.position.copy(pos); shell.scale.setScalar(1.35);
    this.scene.add(shell);
    this.particles.push({ mesh: shell, vel: new THREE.Vector3(), life: 0, maxLife: 0.2, grav: 0, grow: 4, still: true });
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

  // ---------------------------------------------------------------- ultimates
  // Cinder's Cataclysm: the whole circle smoulders while the meteors fall.
  cataclysmZone(p, life) {
    const g = new THREE.Group();
    g.position.set(p[0], 0, p[2]);
    const fill = new THREE.Mesh(new THREE.CircleGeometry(CATA.radius, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff5a1e, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(CATA.radius - 0.25, CATA.radius, 96).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    fill.position.y = 0.13; ring.position.y = 0.15;
    g.add(fill, ring);
    this.scene.add(g);
    (this.zones ??= new Set()).add({ group: g, fill, ring, born: realNow(), endAt: realNow() + life });
  }
  // One meteor: its shadow appears CATA.warn before impact; the fireball drops in the last CATA.fall.
  meteorStrike(p, left) {
    const g = new THREE.Group();
    g.position.set(p[0], 0, p[2]);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: emberShadowTexture(), transparent: true, depthWrite: false }));
    shadow.position.y = 0.16; shadow.renderOrder = 2;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.y = 0.17; ring.scale.setScalar(CATA.impact);
    const rock = new THREE.Group();
    rock.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 1), new THREE.MeshBasicMaterial({ color: 0xffd08a })));
    rock.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 1), new THREE.MeshBasicMaterial({ color: 0xff5a1e, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })));
    const light = new THREE.PointLight(0xff7a2a, 0, 12);
    rock.add(light);
    rock.visible = false;
    g.add(shadow, ring, rock);
    g.visible = false;
    this.scene.add(g);
    const e = { group: g, shadow, ring, rock, light, landAt: realNow() + left, trail: 0, dir: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize() };
    (this.meteors ??= new Set()).add(e);
    return e;
  }
  meteorImpact(e, p) {
    if (e) { this.meteors?.delete(e); this.scene.remove(e.group); }
    const pos = new THREE.Vector3(p[0], 0.5, p[2]);
    this.burst(pos, 0xffb040, 26, 8, 0.6, 5);
    this.burst(pos.clone().setY(1), 0xff3a10, 16, 5, 0.8, 2);
    const rockMat = this.mat(0x3a2418, { opacity: 1 });
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.1 + Math.random() * 0.15, 0), i % 3 ? rockMat : this.mat(0xff7a2a, { opacity: 1 }));
      m.position.set(p[0] + (Math.random() - 0.5), 0.3, p[2] + (Math.random() - 0.5));
      this.scene.add(m);
      const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 6;
      this.debris.push({ mesh: m, life: 0, maxLife: 1 + Math.random() * 0.8, vel: new THREE.Vector3(Math.sin(a) * sp, 3 + Math.random() * 5, Math.cos(a) * sp),
        spin: new THREE.Vector3(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5) });
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2),
      this.mat(0xffa040, { opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.set(p[0], 0.18, p[2]);
    this.scene.add(ring);
    this.particles.push({ mesh: ring, vel: new THREE.Vector3(), life: 0, maxLife: 0.35, grav: 0, grow: (CATA.impact + 1) / 0.35, still: true });
    for (let i = 0; i < 6; i++) this.dust(pos, 3);
  }
  // The caster's targeting circle while Q is held (Cataclysm).
  cataAim(radius = CATA.radius, color = 0xff7a2a, rim = 0xffc080) {
    const g = new THREE.Group();
    const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false }));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1, 96).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: rim, transparent: true, opacity: 0.9, depthWrite: false }));
    fill.position.y = ring.position.y = 0.16;
    g.add(fill, ring);
    g.scale.setScalar(radius);
    g.visible = false;
    this.scene.add(g);
    return g;
  }

  // Gale's Eye of the Storm: a violet funnel of wind around her, a faint pull circle on the ground.
  // It follows `follow` (her group) until stopEye().
  eyeStorm(follow) {
    const g = new THREE.Group();
    const layers = [];
    for (let i = 0; i < 4; i++) {
      const h = 1.3, r0 = 0.7 + i * 0.55, r1 = 1.0 + i * 0.75;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h, 28, 1, true),
        new THREE.MeshBasicMaterial({ map: windTexture(), color: i % 2 ? 0xb48cff : 0x7a3cdf, transparent: true, opacity: 0.85 - i * 0.12, side: THREE.DoubleSide, depthWrite: false }));
      m.position.y = 0.35 + i * h * 0.95;
      g.add(m); layers.push(m);
    }
    const pullRing = new THREE.Mesh(new THREE.RingGeometry(EYE.radius - 0.15, EYE.radius, 96).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xc8a0ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    pullRing.position.y = 0.14;
    g.add(pullRing);
    this.scene.add(g);
    const e = { group: g, layers, pullRing, follow, mote: 0, born: realNow() };
    (this.eyes ??= new Set()).add(e);
    return e;
  }
  stopEye(e) { if (!e) return; this.eyes?.delete(e); this.scene.remove(e.group); }
  // The final fling: a burst of wind outward.
  eyeBurst(p) {
    this.cyclonePulse(p, EYE.radius);
    this.burst(new THREE.Vector3(p[0], p[1] + 1.5, p[2]), 0xe8dcff, 24, 7, 0.6, 1);
  }

  // Rime's Absolute Zero: a rune flares on the ground and a cold column rises for the wind-up.
  zeroFlare(p, left) {
    const g = new THREE.Group();
    g.position.set(p[0], 0, p[2]);
    const rune = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: zeroRuneTexture(), color: 0x9ae4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    rune.position.y = 0.15; rune.renderOrder = 2;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.55, 9, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x7fd0ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    column.position.y = 4.5;
    const light = new THREE.PointLight(0x9ae4ff, 0, 16);
    light.position.y = 1.5;
    g.add(rune, column, light);
    this.scene.add(g);
    const e = { group: g, rune, column, light, born: realNow(), total: Math.max(0.05, left) };
    (this.zeros ??= new Set()).add(e);
    return e;
  }
  zeroBlast(e, p) {
    if (e) { this.zeros?.delete(e); this.scene.remove(e.group); }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 96).rotateX(-Math.PI / 2),
      this.mat(0xdff6ff, { opacity: 0.95, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.set(p[0], 0.2, p[2]);
    this.scene.add(ring);
    this.particles.push({ mesh: ring, vel: new THREE.Vector3(), life: 0, maxLife: 0.45, grav: 0, grow: ZERO.radius / 0.45, still: true });
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 96).rotateX(-Math.PI / 2),
      this.mat(0x7fd0ff, { opacity: 0.6, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring2.position.set(p[0], 0.18, p[2]);
    this.scene.add(ring2);
    this.particles.push({ mesh: ring2, vel: new THREE.Vector3(), life: 0, maxLife: 0.6, grav: 0, grow: ZERO.radius / 0.6, still: true });
    // a freezing mist rolling out over the whole radius
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 2;
      const m = new THREE.Mesh(this.sphereGeo, this.mat(0xeef8ff, { opacity: 0.5, depthWrite: false }));
      m.position.set(p[0] + Math.sin(a) * r, 0.3 + Math.random() * 0.5, p[2] + Math.cos(a) * r);
      m.scale.setScalar(0.4 + Math.random() * 0.4);
      this.scene.add(m);
      const sp = ZERO.radius * (0.5 + Math.random() * 0.6);
      this.particles.push({ mesh: m, vel: new THREE.Vector3(Math.sin(a) * sp, 0.4 + Math.random() * 0.6, Math.cos(a) * sp), life: 0, maxLife: 0.8 + Math.random() * 0.4, grav: 0, grow: 1.4 });
    }
    const shardMat = this.mat(0xe8f8ff, { opacity: 0.95 });
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Mesh(new THREE.TetrahedronGeometry(0.1 + Math.random() * 0.2, 0), shardMat);
      const a = Math.random() * Math.PI * 2;
      m.position.set(p[0] + Math.sin(a) * 0.8, 0.5 + Math.random() * 1.5, p[2] + Math.cos(a) * 0.8);
      this.scene.add(m);
      const sp = 10 + Math.random() * 10;
      this.debris.push({ mesh: m, life: 0, maxLife: 0.7 + Math.random() * 0.5, vel: new THREE.Vector3(Math.sin(a) * sp, 1 + Math.random() * 3, Math.cos(a) * sp),
        spin: new THREE.Vector3(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5) });
    }
    this.burst(new THREE.Vector3(p[0], 1.2, p[2]), 0xffffff, 24, 8, 0.6, 2);
  }
  zeroCancel(e) { if (e) { this.zeros?.delete(e); this.scene.remove(e.group); } }

  // Vesper's Night Cage: a ring of jagged obsidian spikes rising out of the ground, and a dark wall shimmering up
  // from it. `left` = seconds it stands.
  nightCage(p, left) {
    const g = new THREE.Group();
    g.position.set(p[0], 0, p[2]);
    const obsidian = new THREE.MeshStandardMaterial({ color: 0x0c0810, emissive: 0x3a0010, emissiveIntensity: 0.6, roughness: 0.25, metalness: 0.4, flatShading: true });
    const spikes = new THREE.Group();
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const n = 44;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + rnd() * 0.05;
      const h = 0.9 + rnd() * 1.6;
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.22 + rnd() * 0.18, h, 4), obsidian);
      sp.position.set(Math.sin(a) * CAGE.radius, h / 2, Math.cos(a) * CAGE.radius);
      sp.rotation.set((rnd() - 0.5) * 0.5, rnd() * 3, (rnd() - 0.5) * 0.5);
      spikes.add(sp);
    }
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(CAGE.radius, CAGE.radius, 4, 72, 1, true),
      new THREE.MeshBasicMaterial({ map: windTexture(), color: 0x2a0a18, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    wall.position.y = 2;
    const ring = new THREE.Mesh(new THREE.RingGeometry(CAGE.radius - 0.35, CAGE.radius + 0.35, 96).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x050205, transparent: true, opacity: 0.85, depthWrite: false }));
    ring.position.y = 0.14;
    const glow = new THREE.Mesh(new THREE.RingGeometry(CAGE.radius - 0.05, CAGE.radius + 0.05, 96).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff1f3d, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.y = 0.16;
    g.add(ring, glow, spikes, wall);
    spikes.scale.y = 0.05; wall.scale.y = 0.05;
    this.scene.add(g);
    const e = { group: g, spikes, wall, glow, born: realNow(), endAt: realNow() + left };
    (this.cages ??= new Set()).add(e);
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; this.dust(new THREE.Vector3(p[0] + Math.sin(a) * CAGE.radius, 0.2, p[2] + Math.cos(a) * CAGE.radius), 1); }
    return e;
  }
  endCage(e) { if (e) e.endAt = Math.min(e.endAt, realNow()); }

  // Cinder's Firewall: a roaring curtain of flame across her aim (layered scrolling sheets, a glowing base, embers).
  firewall(w) {
    const F = C.SPELLBOOK.firewall;
    const g = new THREE.Group();
    g.position.set(w.x, 0, w.z);
    g.rotation.y = w.yaw;
    const sheets = [0, 1, 2].map(i => {
      const tex = fireTexture().clone(); tex.needsUpdate = true;
      tex.wrapT = THREE.ClampToEdgeWrapping;   // the tips fade out at the top; only the sideways sway scrolls
      tex.repeat.set(2.5 + i * 0.7, 1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(F.width + i * 0.3, F.height - i * 0.4),
        new THREE.MeshBasicMaterial({ map: tex, color: [0xffc070, 0xff7a2a, 0xff4a10][i], transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.position.set(0, (F.height - i * 0.4) / 2, (i - 1) * 0.18);
      g.add(m);
      return m;
    });
    const base = new THREE.Mesh(new THREE.PlaneGeometry(F.width + 0.6, 0.9).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff5a10, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    base.position.y = 0.12;
    const light = new THREE.PointLight(0xff6a1e, 10, 12);
    light.position.y = 1.4;
    g.add(base, light);
    this.scene.add(g);
    const e = { group: g, sheets, base, light, born: realNow(), endAt: realNow() + w.left, ember: 0 };
    (this.firewalls ??= new Set()).add(e);
    // the ignite: a burst along its length
    for (let i = -2; i <= 2; i++) {
      const p = new THREE.Vector3(w.x + Math.cos(w.yaw) * i, 0.6, w.z - Math.sin(w.yaw) * i);
      this.burst(p, i % 2 ? 0xffb040 : 0xff5a1e, 8, 4, 0.5, -2);
    }
    return e;
  }
  endFirewall(e) { if (e) e.endAt = Math.min(e.endAt, realNow()); }
  // A projectile burning up in a Firewall.
  burnUp(p) {
    const pos = new THREE.Vector3(p[0], p[1], p[2]);
    this.burst(pos, 0xff7a1e, 18, 5, 0.5, -3);
    this.burst(pos, 0xffd080, 8, 2, 0.3, -1);
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    this.clock += dt;
    for (const pr of this.projectiles.values()) {
      pr.age += dt;
      if (pr.curve) {
        // Hex Shards: the same Bézier the server flies
        const at = C.hexAt(pr.curve, pr.age);
        pr.pos.set(at.p[0], at.p[1], at.p[2]); pr.vel.set(at.v[0], at.v[1], at.v[2]);
        if (pr.group.userData.glyph) { pr.group.userData.glyph.rotation.z += dt * 9; pr.group.userData.glyph.lookAt(pr.group.position.clone().sub(pr.vel)); }
      } else {
        pr.vel.y -= pr.g * dt;
        pr.pos.addScaledVector(pr.vel, dt);
      }
      pr.group.position.copy(pr.pos);
      if (pr.group.userData.shell) { pr.group.userData.shell.rotation.x += dt * 6; pr.group.userData.shell.rotation.y += dt * 4; }
      if (pr.group.userData.aimV) pr.group.lookAt(pr.pos.clone().add(pr.vel));
      if (pr.group.userData.spin) { const s = pr.group.userData.spin; pr.group.rotation.x += s.x * dt; pr.group.rotation.y += s.y * dt; pr.group.rotation.z += s.z * dt; }
      // trail
      pr.trail += dt;
      if (pr.group.userData.ring) pr.group.userData.ring.rotation.y += dt * 8;
      const interval = pr.kind === 'heavy' || pr.kind === 'lash' || pr.kind === 'fireball' ? 0.025 : 0.035;
      if (pr.trail > interval) {
        pr.trail = 0;
        const m = new THREE.Mesh(this.sphereGeo, this.mat(pr.kind === 'fast' ? pr.color : SPELL_COLORS[pr.kind], { opacity: pr.fin ? 0.7 : 0.5 }));
        m.position.copy(pr.pos);
        if (pr.kind === 'prop') m.position.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.6));
        m.scale.setScalar((pr.kind === 'heavy' ? 0.5 : pr.kind === 'fireball' ? 0.3 : pr.kind === 'prop' ? 0.14 : pr.kind === 'skim' ? 0.11 : pr.kind === 'lash' ? 0.13 : pr.kind === 'shear' ? 0.16 : 0.2) * (pr.fin ? 1.6 : 1));
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

    // ultimates
    const rn = realNow();
    for (const z of this.zones || []) {
      const k = Math.min(1, (rn - z.born) / 0.3), fade = Math.max(0, Math.min(1, (z.endAt - rn) / 0.4));
      if (fade <= 0) { this.zones.delete(z); this.scene.remove(z.group); continue; }
      z.fill.material.opacity = (0.08 + Math.sin(this.clock * 5) * 0.03) * k * fade;
      z.ring.material.opacity = 0.8 * k * fade;
    }
    for (const e of this.meteors || []) {
      const left = e.landAt - rn;
      e.group.visible = left <= CATA.warn;
      if (!e.group.visible) continue;
      const k = 1 - Math.max(0, left) / CATA.warn;
      e.shadow.scale.setScalar(CATA.impact * (0.3 + 0.7 * k));
      e.shadow.material.opacity = 0.4 + 0.6 * k;
      e.ring.material.opacity = 0.5 + 0.4 * Math.sin(this.clock * 14) * 0.5 + 0.2 * k;
      if (left <= CATA.fall) {
        // falling in at an angle, trailing fire
        const f = Math.max(0, left) / CATA.fall;
        e.rock.visible = true;
        e.rock.position.set(e.dir.x * f * 8, 0.6 + f * f * 22, e.dir.z * f * 8);
        e.light.intensity = 4 + (1 - f) * 10;
        e.trail += dt;
        if (e.trail > 0.02) {
          e.trail = 0;
          const m = new THREE.Mesh(this.sphereGeo, this.mat(Math.random() < 0.5 ? 0xff7a2a : 0xffc060, { opacity: 0.6 }));
          m.position.copy(e.rock.position).add(e.group.position);
          m.scale.setScalar(0.5 + Math.random() * 0.3);
          this.scene.add(m);
          this.particles.push({ mesh: m, vel: new THREE.Vector3(0, 1, 0), life: 0, maxLife: 0.35, grav: 0, shrink: true });
        }
      }
      if (left < -1) { this.meteors.delete(e); this.scene.remove(e.group); }   // lost the impact message
    }
    for (const e of this.eyes || []) {
      if (e.follow) e.group.position.set(e.follow.position.x, e.follow.position.y, e.follow.position.z);
      e.layers.forEach((m, i) => { m.rotation.y += dt * (7 - i * 1.2); m.scale.x = m.scale.z = 1 + Math.sin(this.clock * 6 + i) * 0.06; });
      e.pullRing.rotation.y -= dt * 0.8;
      e.pullRing.material.opacity = 0.3 + Math.sin(this.clock * 8) * 0.15;
      // dust and leaves spiralling in toward the funnel
      e.mote += dt;
      while (e.mote > 0.02) {
        e.mote -= 0.02;
        const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * (EYE.radius - 2);
        const m = new THREE.Mesh(this.particleGeo, this.mat(Math.random() < 0.3 ? 0xb59a72 : 0xd8c0ff, { opacity: 0.9 }));
        m.position.set(e.group.position.x + Math.sin(a) * r, 0.2 + Math.random() * 2.5, e.group.position.z + Math.cos(a) * r);
        m.scale.setScalar(0.4 + Math.random() * 0.6);
        this.scene.add(m);
        const inx = -Math.sin(a), inz = -Math.cos(a);
        this.particles.push({ mesh: m, vel: new THREE.Vector3((inx * 0.6 + inz) * r * 1.6, 1.5, (inz * 0.6 - inx) * r * 1.6), life: 0, maxLife: 0.45, grav: -2, shrink: true });
      }
    }
    for (const e of this.firewalls || []) {
      const k = Math.min(1, (rn - e.born) / 0.2), fade = Math.max(0, Math.min(1, (e.endAt - rn) / 0.35));
      if (fade <= 0) { this.firewalls.delete(e); this.scene.remove(e.group); continue; }
      e.sheets.forEach((m, i) => {
        m.material.opacity = ([0.6, 0.55, 0.45][i] + Math.sin(this.clock * (19 + i * 6)) * 0.08) * k * fade;
        m.material.map.offset.x = this.clock * (0.15 + i * 0.1) * (i % 2 ? -1 : 1) + Math.sin(this.clock * 3 + i) * 0.04;
        m.scale.y = (0.3 + 0.7 * k) * (1 + Math.sin(this.clock * (13 + i * 4) + i * 2) * 0.1);
        m.position.y = m.geometry.parameters.height * m.scale.y / 2;
      });
      e.base.material.opacity = 0.6 * fade;
      e.light.intensity = (8 + Math.sin(this.clock * 23) * 3) * fade;
      // embers drifting up off the flames
      e.ember += dt;
      while (e.ember > 0.015) {
        e.ember -= 0.015;
        const F = C.SPELLBOOK.firewall, a = (Math.random() - 0.5) * F.width;
        const m = new THREE.Mesh(this.particleGeo, this.mat(Math.random() < 0.5 ? 0xffb040 : 0xff5a1e, { opacity: 1 }));
        const yaw = e.group.rotation.y;
        m.position.set(e.group.position.x + Math.cos(yaw) * a, 0.3 + Math.random() * 2.5, e.group.position.z - Math.sin(yaw) * a);
        m.scale.setScalar(0.3 + Math.random() * 0.4);
        this.scene.add(m);
        this.particles.push({ mesh: m, vel: new THREE.Vector3((Math.random() - 0.5) * 1.2, 2 + Math.random() * 2.5, (Math.random() - 0.5) * 1.2), life: 0, maxLife: 0.5 + Math.random() * 0.4, grav: -1, shrink: true });
      }
    }
    for (const e of this.cages || []) {
      const k = Math.min(1, (rn - e.born) / 0.35), fade = Math.max(0, Math.min(1, (e.endAt - rn) / 0.5 + 1));
      if (rn > e.endAt + 0.5) { this.cages.delete(e); this.scene.remove(e.group); continue; }
      const grow = 1 - Math.pow(1 - k, 3);
      e.spikes.scale.y = Math.max(0.05, grow * (rn > e.endAt ? fade : 1));
      e.wall.scale.y = Math.max(0.05, grow * (rn > e.endAt ? fade : 1));
      e.wall.material.opacity = (0.4 + Math.sin(this.clock * 3) * 0.12) * (rn > e.endAt ? fade : 1);
      e.wall.material.map.offset.y -= dt * 0.25;
      e.wall.rotation.y += dt * 0.15;
      e.glow.material.opacity = 0.5 + Math.sin(this.clock * 6) * 0.3;
    }
    for (const e of this.zeros || []) {
      const k = Math.min(1, (rn - e.born) / e.total);
      e.rune.scale.setScalar(Math.max(0.05, (1 - Math.pow(1 - k, 3)) * ZERO.radius));
      e.rune.rotation.y += dt * (0.6 + k * 2);
      e.rune.material.opacity = 0.35 + 0.6 * k + Math.sin(this.clock * 30) * 0.05 * k;
      e.column.material.opacity = 0.15 + 0.4 * k;
      e.column.scale.set(1 - k * 0.4, 0.2 + k * 0.8, 1 - k * 0.4);
      e.column.position.y = 4.5 * (0.2 + k * 0.8);
      // frost motes drawn in toward the rune's centre as it charges
      if (Math.random() < 0.7) {
        const a = Math.random() * Math.PI * 2, r = ZERO.radius * (0.4 + Math.random() * 0.6);
        const m = new THREE.Mesh(this.particleGeo, this.mat(0xe8f8ff, { opacity: 1 }));
        m.position.set(e.group.position.x + Math.sin(a) * r, 0.3 + Math.random() * 0.8, e.group.position.z + Math.cos(a) * r);
        this.scene.add(m);
        this.particles.push({ mesh: m, vel: new THREE.Vector3(-Math.sin(a) * r * 1.6, 1.5, -Math.cos(a) * r * 1.6), life: 0, maxLife: 0.5, grav: 0, shrink: true });
      }
      e.light.intensity = 2 + k * 14;
      if (rn - e.born > e.total + 1.5) { this.zeros.delete(e); this.scene.remove(e.group); }   // lost the blast message
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
