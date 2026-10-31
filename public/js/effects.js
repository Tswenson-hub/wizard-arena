// Projectile visuals, particle bursts, debris, teleport flashes.
import * as THREE from 'three';
import * as C from '../shared/constants.js';
import { makePropMesh, makeFragments } from './world.js';
import { SpriteFX } from './sprites.js';

const SPELL_COLORS = { fast: 0x7ad8ff, heavy: 0xff7a2a, prop: 0xb48cff, skim: 0xbfeaff, lash: 0xff2a3c, fireball: 0xff6a1e, shear: 0xd8c8ff, hex: 0xff1f3d, sling: 0xd8c8a8, potion: 0xa050e0, toxic: 0x7fd34a, flaskstep: 0xc080ff };
const HEX_SHAPES = [3, 4, 0];   // Hex Shards: a triangle, a diamond, then a crescent (0)
const BULWARK = C.SPELLBOOK.glacial_bulwark, FROST = C.SPELLBOOK.frostfall, SMOKE = C.SPELLBOOK.smoke_screen;
const CAGE = C.SPELLBOOK.night_cage;
const EYE = C.SPELLBOOK.eye_of_storm, BLIZ = C.SPELLBOOK.blizzard, MRAIN = C.SPELLBOOK.meteor_rain;
const realNow = () => performance.now() / 1000;

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

// Smoke Screen and Smoke Flask puffs: Kenney's smoke sprites (public/textures/particles), one of three at random.
let smokeTexs = null;
function puffTexture() {
  smokeTexs ??= ['smoke_01', 'smoke_07', 'smoke_08'].map(n => { const t = new THREE.TextureLoader().load(`./textures/particles/${n}.png`); t.colorSpace = THREE.SRGBColorSpace; return t; });
  return smokeTexs[Math.floor(Math.random() * smokeTexs.length)];
}
// (the old canvas puff, kept as a fallback name)
let puffTex = null;
function canvasPuffTexture() {
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
  constructor(scene, { low = false } = {}) {
    this.scene = scene;
    this.low = low;
    this.sprites = new SpriteFX(scene, { low });   // textured, pooled, instanced particles (sprites.js)
    this.camera = null;                            // main.js sets it (smoke sorts back to front)
    this.projectiles = new Map();
    this.particles = [];     // { mesh, vel, life, maxLife, grav, shrink }
    this.debris = [];
    this.clock = 0;

    this.particleGeo = new THREE.TetrahedronGeometry(0.12, 0);
    this.sphereGeo = new THREE.IcosahedronGeometry(1, 1);
    this.mats = {};
  }

  // ---------------------------------------------------------------- sprite helpers
  S(name, o) { return this.sprites.spawn(name, o); }
  n(k) { return this.low ? Math.max(1, Math.round(k * 0.45)) : k; }   // ?low: fewer particles
  // Sparks flying out: streaks along their flight, a few twinkles.
  sparks(p, color, count, speed, size = 0.4, grav = 6) {
    const N = this.n(count);
    for (let i = 0; i < N; i++) {
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      if (i % 3 === 2) this.S('star_06', { p, v: d.multiplyScalar(0.6), grav: grav * 0.5, drag: 2, life: 0.3 + Math.random() * 0.35, size: [size * 1.4, size * 0.3], color, alpha: 1, spin: (Math.random() - 0.5) * 6 });
      else this.S('trace_01', { p, v: d, grav, drag: 1.5, life: 0.25 + Math.random() * 0.35, size: [size * 2.6, size * 1.2], aspect: 0.7, mode: 'streak', stretch: 0.09, color, alpha: 1 });
    }
  }
  // A bright flash: a soft glow and a star glint.
  flash(p, color, size = 1) {
    this.S('circle_05', { p, size: [size * 1.6, size * 3], life: 0.28, color, alpha: 0.7, fadeIn: 0.04 });
    this.S('star_09', { p, size: [size * 2.2, size * 0.8], life: 0.18, color: 0xffffff, alpha: 0.85, fadeIn: 0.02, rot: Math.random() * 6 });
  }
  // Flame tongues bursting from `p` (Fireball, Meteor, Firewall, Meteor Rain).
  fireBurst(p, s = 1, count = 7) {
    const cols = [0xffe6a0, 0xffa83a, 0xff6a1e];
    for (let i = 0, N = this.n(count); i < N; i++) {
      const a = Math.random() * Math.PI * 2, sp = (1 + Math.random() * 2.5) * s;
      this.S(['fire_01', 'fire_02', 'flame_01', 'flame_03'][i % 4], { p: [p.x + Math.sin(a) * 0.3 * s, p.y + Math.random() * 0.3 * s, p.z + Math.cos(a) * 0.3 * s],
        v: [Math.sin(a) * sp, 1.2 + Math.random() * 1.5 * s, Math.cos(a) * sp], drag: 2.5, grav: -1, life: 0.4 + Math.random() * 0.35,
        size: [0.7 * s, 1.8 * s], spin: (Math.random() - 0.5) * 3, color: cols[i % 3], alpha: 0.95, fadeIn: 0.05, add: false });   // alpha-blended: true orange over bright grass
    }
    this.S('circle_05', { p, size: [1.2 * s, 2.6 * s], life: 0.35, color: 0xff7a1e, alpha: 0.45 });   // the glow under it
  }
  // Rolling smoke (alpha-blended, sorted): heavy impacts, landings, prop breaks.
  smokeBurst(p, s = 1, count = 5, color = 0x4a4038, alpha = 0.5) {
    for (let i = 0, N = this.n(count); i < N; i++) {
      const a = Math.random() * Math.PI * 2, sp = (0.6 + Math.random() * 1.4) * s;
      this.S(['smoke_01', 'smoke_07', 'smoke_08'][i % 3], { p: [p.x + Math.sin(a) * 0.4 * s, p.y + Math.random() * 0.4, p.z + Math.cos(a) * 0.4 * s],
        v: [Math.sin(a) * sp, 0.6 + Math.random() * 0.8, Math.cos(a) * sp], drag: 1.4, life: 1.1 + Math.random() * 0.8,
        size: [0.8 * s, 2.4 * s], spin: (Math.random() - 0.5) * 0.8, color, alpha, add: false, fadeIn: 0.12 });
    }
  }
  // A burn mark on the ground that fades out at the end of its `life`.
  scorchDecal(p, r, life = 8, color = 0x140c08, alpha = 0.8) {
    return this.S(Math.random() < 0.5 ? 'scorch_01' : 'scorch_02', { p: [p.x ?? p[0], 0.035 + Math.random() * 0.01, p.z ?? p[2]], mode: 'flat', size: [r * 2, r * 2.1], life,
      color, alpha, add: false, fadeIn: 0.01, fadePow: 0.25 });
  }
  // A ring of smoke or dust spreading on the ground (landings, Meteor Rain).
  groundRing(p, r, color = 0x8a7a64, alpha = 0.55, life = 0.9) {
    this.S('smoke_10', { p: [p.x ?? p[0], 0.3, p.z ?? p[2]], mode: 'flat', size: [r * 0.4, r * 2.4], life, spin: 0.6, color, alpha, add: false, fadeIn: 0.05 });
  }
  // A cast's muzzle flash: a flame-shaped burst along the shot, in the shot's colour.
  muzzle(msg) {
    const v = new THREE.Vector3(msg.v[0], msg.v[1], msg.v[2]);
    if (v.lengthSq() < 1e-6) return;
    v.normalize();
    const color = msg.kind === 'fast' && msg.color !== undefined ? msg.color : SPELL_COLORS[msg.kind] ?? 0xffffff;
    const k = (msg.kind === 'heavy' ? 1.8 : msg.kind === 'fireball' ? 1.3 : msg.kind === 'skim' || msg.kind === 'sling' ? 0.7 : 1) * (msg.fin ? 1.35 : 1);
    const h = 0.75 * k;
    const p = new THREE.Vector3(msg.p[0], msg.p[1], msg.p[2]);
    this.S(Math.random() < 0.5 ? 'muzzle_01' : 'muzzle_02', { p: p.clone().addScaledVector(v, h * 0.5), mode: 'streak', axis: [v.x, v.y, v.z], size: [h * 0.55, h * 0.4], aspect: 1.8, life: 0.12, color, alpha: 1, fadeIn: 0.01 });
    this.S('light_03', { p, size: [0.8 * k, 0.3 * k], life: 0.13, color, alpha: 0.8, fadeIn: 0.01 });
  }
  // A melee-style arc: Gale Shear, the combo strikes, the Lash.
  slash(p, color = 0xffffff, size = 1, rot = Math.random() * Math.PI * 2) {
    const pos = p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2]);
    this.S('slash_01', { p: pos, size: [1.2 * size, 1.9 * size], life: 0.2, rot, spin: 3, color, alpha: 0.95, fadeIn: 0.02 });
    this.S('light_01', { p: pos, size: [0.8 * size, 1.2 * size], life: 0.15, color, alpha: 0.5, fadeIn: 0.02, optional: true });
  }
  // A hit on a body: a red flash and sparks.
  hitFlash(c, color = 0xff3b4e) {
    this.flash(c, color, 0.9);
    this.sparks(c, color, 10, 3.5, 0.35, 4);
  }
  // A full ultimate charge: motes rising round the wizard's feet in their colour, a soft ring now and then.
  ultGlow(pos, color) {
    const a = Math.random() * Math.PI * 2;
    this.S('star_06', { p: [pos.x + Math.sin(a) * 0.55, pos.y + 0.1 + Math.random() * 0.4, pos.z + Math.cos(a) * 0.55], v: [0, 1 + Math.random() * 0.8, 0],
      life: 0.8, size: [0.28, 0.06], color, alpha: 0.95, optional: true });
    if (Math.random() < 0.12) this.S('circle_02', { p: [pos.x, 0.1, pos.z], mode: 'flat', size: [0.6, 2.2], life: 0.9, color, alpha: 0.6 });
  }
  // Tempest Veil: wind twirling round Gale while it lasts. Returns the sprites (kill them when it ends).
  veilSwirl(follow, life) {
    return [
      this.S('twirl_01', { follow, offset: [0, 1, 0], size: 2.8, life, spin: 7, color: 0xe8dcff, alpha: 0.55, fadeIn: 0.1 }),
      this.S('twirl_02', { follow, offset: [0, 1.1, 0], size: 2.2, life, spin: -9, color: 0xb98cff, alpha: 0.5, fadeIn: 0.1 }),
    ];
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
    } else if (msg.kind === 'potion' || msg.kind === 'toxic' || msg.kind === 'flaskstep') {
      // Embibe's potions: a little bottle (purple swirl, green crystal, or a pale vial) with a glowing brew inside
      const liquid = msg.kind === 'toxic' ? 0x7fd34a : msg.kind === 'potion' ? 0xa050e0 : 0xd0a0ff;
      const s = msg.kind === 'flaskstep' ? 0.8 : msg.fin ? 1.3 : 1;
      const glass = new THREE.Mesh(new THREE.SphereGeometry(0.17 * s, 10, 8), new THREE.MeshStandardMaterial({ color: liquid, emissive: liquid, emissiveIntensity: 0.6, roughness: 0.2, transparent: true, opacity: 0.9 }));
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * s, 0.07 * s, 0.16 * s, 8), new THREE.MeshStandardMaterial({ color: msg.kind === 'toxic' ? 0x2a4a20 : 0x3a2050, roughness: 0.4 }));
      neck.position.y = 0.2 * s;
      const glow = new THREE.Mesh(this.sphereGeo, this.mat(liquid, { opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.scale.setScalar(0.32 * s);
      g.add(glass, neck, glow);
      g.userData.spin = new THREE.Vector3(7, 2, 5);
      light = new THREE.PointLight(liquid, msg.fin ? 4 : 2.5, 6);
      g.add(light);
    } else if (msg.kind === 'sling') {
      // Shepherd's Sling: a tumbling river stone with a pale streak; the 2nd shot is bigger, with a ring
      const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(msg.fin ? 0.17 : 0.12, 0), new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 0.9, flatShading: true }));
      g.add(stone);
      g.userData.spin = new THREE.Vector3(9, 6, 4);
      if (msg.fin) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.03, 6, 20), this.mat(0xffe0a0, { opacity: 0.8 })); g.add(ring); }
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
    // a soft textured glow riding on the projectile (and a ring on the big ones)
    const fk = msg.fin ? 1.3 : 1, coreSize = { fast: 0.8, fireball: 1.4, heavy: 2, hex: 0.9, lash: 0.8, potion: 0.7, toxic: 0.7, flaskstep: 0.6, skim: 0.5, shear: 0.9 }[msg.kind];
    const cores = [];
    if (coreSize) {
      cores.push(this.S('circle_05', { follow: g, size: coreSize * fk * 0.8, life: 60, color, alpha: 0.4, fadeIn: 0 }));
      if (msg.kind === 'heavy' || msg.kind === 'fireball' || msg.fin) cores.push(this.S('circle_02', { follow: g, size: coreSize * fk * 0.6, life: 60, spin: 3, color, alpha: 0.35, fadeIn: 0 }));
    }
    this.projectiles.set(msg.id, {
      id: msg.id, kind: msg.kind, group: g,
      pos: new THREE.Vector3(msg.p[0], msg.p[1], msg.p[2]),
      vel: new THREE.Vector3(msg.v[0], msg.v[1], msg.v[2]),
      g: msg.g || 0, life: msg.life, age: 0, trail: 0, fin: !!msg.fin, color, curve: msg.curve || null, cores,
    });
  }

  endProjectile(msg) {
    const pr = this.projectiles.get(msg.id);
    if (!pr) return;
    this.projectiles.delete(msg.id);
    this.scene.remove(pr.group);
    for (const c of pr.cores || []) if (c) c.dead = true;
    const p = msg.p ? new THREE.Vector3(msg.p[0], msg.p[1], msg.p[2]) : pr.pos;
    const low = p.y < 1.8;   // near the ground: leave a mark
    if (msg.hit) {
      if (pr.kind === 'heavy') {
        this.burst(p, 0xff7a2a, 34, 7, 0.8); this.fireBurst(p, 1.6, 10); this.smokeBurst(p, 1.5, 7, 0x3a3028, 0.55);
        if (low) { this.scorchDecal(p, 2.4); this.groundRing(p, 3, 0x6a5a4a); }
      }
      else if (pr.kind === 'fast') { this.burst(p, pr.color, pr.fin ? 22 : 14, pr.fin ? 5 : 4, pr.fin ? 0.5 : 0.4); this.S('magic_05', { p, size: [pr.fin ? 1.6 : 1.1, 0.2], life: 0.2, color: pr.color, alpha: 0.9 });
        this.S(Math.random() < 0.5 ? 'spark_01' : 'spark_02', { p, size: [pr.fin ? 1.5 : 1, 1.3], life: 0.16, color: pr.color, alpha: 1, fadeIn: 0.02 }); }   // a crackle
      else if (pr.kind === 'skim') { this.burst(p, 0xdff6ff, 9, 3, 0.25, 4); this.S('star_06', { p, size: [0.9, 0.2], life: 0.2, color: 0xe8fbff }); }
      else if (pr.kind === 'lash') { this.burst(p, 0xff2a3c, 14, 4, 0.35); this.slash(p, 0xff2a3c, 1.1); this.S('scratch_01', { p, size: [1.2, 1.6], life: 0.22, color: 0xff6070, alpha: 0.9 }); }
      else if (pr.kind === 'fireball') {
        this.burst(p, 0xff7a1e, pr.fin ? 30 : 20, pr.fin ? 6 : 5, pr.fin ? 0.7 : 0.55); this.fireBurst(p, pr.fin ? 1.2 : 0.85, pr.fin ? 8 : 5);
        this.smokeBurst(p, pr.fin ? 1 : 0.7, pr.fin ? 3 : 2, 0x4a3a30, 0.4);
        if (low) this.scorchDecal(p, pr.fin ? 1.2 : 0.8, 6);
      }
      else if (pr.kind === 'shear') { this.burst(p, 0xe8dcff, 12, 5, 0.3, 0); this.slash(p, 0xd8c8ff, pr.fin ? 1.4 : 1, Math.atan2(pr.vel.x, pr.vel.z)); }
      else if (pr.kind === 'hex') { this.burst(p, 0xff1f3d, pr.fin ? 18 : 12, 4, 0.35); this.S('magic_03', { p, size: [pr.fin ? 1.8 : 1.2, 0.3], life: 0.3, spin: 6, color: 0xff2a48, alpha: 0.9 }); }
      else if (pr.kind === 'toxic') { this.burst(p, 0x7fd34a, 18, 4, 0.4, 6); this.burst(p, 0xdfffb0, 6, 2, 0.25, 0); this.smokeBurst(p, 0.7, 3, 0x6a9a40, 0.35); }
      else if (pr.kind === 'flaskstep') this.burst(p, 0xc080ff, 10, 2, 0.3, 0);
      else if (pr.kind === 'sling') { this.burst(p, 0xb8a888, pr.fin ? 12 : 7, 3, 0.25, 8); this.dust(p, pr.fin ? 4 : 2); }
      // thrown props shatter via the propBreak message
    } else {
      this.burst(p, pr.color ?? SPELL_COLORS[pr.kind] ?? 0xffffff, 6, 1.5, 0.3);
    }
  }

  // ---------------------------------------------------------------- particles
  // Healing (Night Cage, Black Death's blocks): small crimson motes drifting up around the body, no flash.
  healShimmer(center) {
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.35 + Math.random() * 0.25;
      this.S(i ? 'star_06' : 'circle_05', { p: [center.x + Math.cos(a) * r, center.y - 0.7 + Math.random() * 1.2, center.z + Math.sin(a) * r], v: [0, 0.9 + Math.random() * 0.6, 0],
        life: 0.55 + Math.random() * 0.3, size: [i ? 0.3 : 0.22, 0.05], color: i ? 0xff3355 : 0xff8fa0, alpha: 0.95, spin: 2, optional: i === 1 });
    }
  }

  // The general-purpose burst (every caller in the game): sparks and twinkles in `color` with a flash; one or two
  // (`count` <= 2) are soft motes instead (auras, fumes, trails of embers).
  burst(pos, color, count, speed, size = 0.5, grav = 6) {
    if (count <= 2) {
      for (let i = 0; i < count; i++) {
        const d = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(speed * 0.6);
        this.S('circle_05', { p: pos, v: d, grav, life: 0.4 + Math.random() * 0.4, size: [size * 1.1, size * 0.25], color, alpha: 0.9, optional: true });
      }
      return;
    }
    this.sparks(pos, color, count, speed, size, grav);
    this.flash(pos, color, Math.min(2.2, size * 1.6));
  }

  // Kicked-up dirt at `pos` (hooves, landings, stampedes): clods and a puff of dust.
  dust(pos, count = 2) {
    for (let i = 0, N = this.n(count); i < N; i++) {
      const x = pos.x + (Math.random() - 0.5) * 0.6, z = pos.z + (Math.random() - 0.5) * 0.6;
      this.S(i % 2 ? 'dirt_01' : 'dirt_02', { p: [x, 0.15, z], v: [(Math.random() - 0.5) * 1.5, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 1.5], grav: 4, floor: 0.06,
        life: 0.55 + Math.random() * 0.3, size: [0.45 + Math.random() * 0.35, 0.75], spin: (Math.random() - 0.5) * 4, color: 0x8a6c48, alpha: 0.95, add: false });
      if (i % 2 === 0) this.S('smoke_07', { p: [x, 0.3, z], v: [(Math.random() - 0.5) * 0.6, 0.5, (Math.random() - 0.5) * 0.6], drag: 1, life: 0.8 + Math.random() * 0.4,
        size: [0.6, 1.8], spin: (Math.random() - 0.5), color: 0xb89c78, alpha: 0.45, add: false, optional: true });
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
    // the spin itself: twirls round her and on the ground, and motes flung outward and around
    this.S('twirl_01', { p: [pos.x, p[1] + 1, pos.z], size: [1.5, radius * 1.6], life: 0.38, spin: 16, color: 0xc890ff, alpha: 0.9, fadeIn: 0.05 });
    this.S('twirl_02', { p: [pos.x, p[1] + 0.2, pos.z], mode: 'flat', size: [1.2, radius * 2.2], life: 0.4, spin: -12, color: 0xe0c8ff, alpha: 0.8, fadeIn: 0.05 });
    for (let i = 0, N = this.n(30); i < N; i++) {
      const a = Math.random() * Math.PI * 2, sp = 7 + Math.random() * 9;
      this.S(i % 3 ? 'trace_01' : 'star_06', { p: [pos.x + Math.sin(a) * 0.8, p[1] + 0.3 + Math.random() * 1.6, pos.z + Math.cos(a) * 0.8],
        v: [Math.sin(a) * sp + Math.cos(a) * sp * 0.6, 1 + Math.random() * 2.5, Math.cos(a) * sp - Math.sin(a) * sp * 0.6], grav: 3, drag: 1,
        life: 0.35 + Math.random() * 0.25, size: [i % 3 ? 1 : 0.5, 0.3], aspect: i % 3 ? 0.6 : 1, mode: i % 3 ? 'streak' : 'face', stretch: 0.06, color: i % 3 ? 0xc890ff : 0xffffff });
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
    this.groundRing(pos, 1.6, 0x9a8a70, 0.5, 0.7);
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
    this.smokeBurst(pos, 0.8, 4, type === 'hay' ? 0xc8b078 : 0x8a7a6a, 0.45);
    this.dust(pos, 3);
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

  // Glacial Bulwark: Ty's Meshy ice wall (models/ice_wall.glb) stretched to the wall's size, with the procedural ice slab
  // and crystals standing in until it loads (or if it fails). Returns { group, setHp(hp) }.
  wall(w) {
    const g = new THREE.Group();
    g.position.set(w.x, 0, w.z);
    g.rotation.y = w.yaw;
    const iceMat = new THREE.MeshStandardMaterial({ color: 0xaee6ff, emissive: 0x3a8fc8, emissiveIntensity: 0.35, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.72 });
    const standIn = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.BoxGeometry(BULWARK.width, BULWARK.height, 0.5), iceMat);
    slab.position.y = BULWARK.height / 2;
    slab.castShadow = true;
    standIn.add(slab);
    g.add(standIn);
    // the model: loaded once, fitted to 1 m (base at y 0, centred), its material made frosty and see-through; each wall
    // gets a clone stretched to width x height (0.7 m thick: the collider stays the 0.5 m slab) with its own material
    this.iceWallModel ??= import('three/addons/loaders/GLTFLoader.js').then(({ GLTFLoader }) => new GLTFLoader().loadAsync('./models/ice_wall.glb')).then(gl => {
      const m = gl.scene, box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      m.position.set(-c.x, -box.min.y, -c.z);
      const unit = new THREE.Group(); unit.add(m); unit.userData.size = size;
      m.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true;
        Object.assign(o.material, { transparent: true, opacity: 0.92, roughness: 0.12, metalness: 0.05, emissive: new THREE.Color(0x2a78b8), emissiveIntensity: 0.3, depthWrite: true });
        o.material.color.multiplyScalar(1.15);
      });
      return unit;
    }).catch(() => null);
    let modelMats = null;
    this.iceWallModel.then(unit => {
      if (!unit || !g.parent) return;
      const s = unit.userData.size, ice = unit.clone();
      ice.scale.set(BULWARK.width * 1.04 / s.x, BULWARK.height / s.y, 0.7 / s.z);
      modelMats = [];
      ice.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); modelMats.push(o.material); } });
      g.remove(standIn); g.add(ice);
      for (const c of cracks) c.scale.z = 0.4 / 0.26;   // onto the thicker model's faces
      entry.setHp(entry.hp);
    });
    // jagged crystals along the top and the edges
    let seed = w.id * 977 + 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 9; i++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.16 + rnd() * 0.12, 0.5 + rnd() * 0.7, 5), iceMat);
      c.position.set((i / 8 - 0.5) * BULWARK.width, BULWARK.height + 0.15, (rnd() - 0.5) * 0.3);
      c.rotation.z = (rnd() - 0.5) * 0.6;
      standIn.add(c);
    }
    for (const side of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.2, 5), iceMat);
      c.position.set(side * (BULWARK.width / 2 + 0.05), 0.5, 0); c.rotation.z = -side * 0.35;
      standIn.add(c);
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
        entry.hp = hp;
        const k = 1 - Math.max(0, hp) / BULWARK.hp;
        cracks.forEach((c, i) => { c.visible = i < Math.round(k * cracks.length * 1.1); });
        iceMat.opacity = 0.72 - k * 0.2;
        // the model clouds over and thins as it cracks
        for (const m of modelMats || []) { m.opacity = 0.92 - k * 0.17; m.emissiveIntensity = 0.3 - k * 0.2; }
      },
    };
    entry.setHp(w.hp);
    entry.glint = 0;
    (this.walls ??= new Set()).add(entry);
    return entry;
  }
  wallHit(entry, p) {
    this.burst(new THREE.Vector3(p[0], p[1], p[2]), 0xdff6ff, 8, 3, 0.25, 4);
    this.S('window_04', { p, size: [1, 0.2], life: 0.25, color: 0xe8fbff, alpha: 0.9 });
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

  // Trapped Relic lit by an enemy close by: a crimson flare that tightens over the fuse, then the blast (relicBlast).
  relicFuse(p, fuse) {
    const pos = new THREE.Vector3(p[0], p[1], p[2]);
    this.burst(pos, 0xff2a3c, 18, 3, 0.35, 1.5);
    const orb = new THREE.Mesh(this.sphereGeo, this.mat(0xff5060, { opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    orb.position.copy(pos); orb.scale.setScalar(1.1);
    this.scene.add(orb);
    this.particles.push({ mesh: orb, vel: new THREE.Vector3(), life: 0, maxLife: fuse, grav: 0, grow: -0.8 / fuse, still: true });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2),
      this.mat(0xff3048, { opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.set(p[0], 0.12, p[2]); ring.scale.setScalar(1.8);
    this.scene.add(ring);
    this.particles.push({ mesh: ring, vel: new THREE.Vector3(), life: 0, maxLife: fuse, grav: 0, grow: -1.2 / fuse, still: true });
  }

  // The red glyph over a Trapped Relic: one we laid (always shown to us), or an enemy's we're close enough to see.
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
    for (let i = 0, N = this.n(16); i < N; i++) {
      const a = i / N * Math.PI * 2;
      this.S(i % 2 ? 'twirl_02' : 'trace_01', { p: [p[0] + Math.sin(a) * 0.6, 0.3 + Math.random() * 1.6, p[2] + Math.cos(a) * 0.6], v: [Math.sin(a) * 7 + Math.cos(a) * 3, 0.5, Math.cos(a) * 7 - Math.sin(a) * 3],
        drag: 2, life: 0.4, size: [i % 2 ? 0.7 : 1.1, 0.3], aspect: i % 2 ? 1 : 0.7, mode: i % 2 ? 'face' : 'streak', stretch: 0.06, spin: 8, color: i % 2 ? 0xffffff : 0xb98cff, alpha: 0.9 });
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
    e.rune = this.S('magic_01', { p: [p[0], 0.17, p[2]], mode: 'flat', size: [FROST.radius * 1.2, FROST.radius * 2], life: left + 0.1, spin: 1.2, color: 0xbfeaff, alpha: 0.75, fadeIn: 0.25, fadePow: 0.2 });
    (this.frosts ??= new Set()).add(e);
    return e;
  }
  frostfallImpact(e, p) {
    if (e) { this.frosts?.delete(e); this.scene.remove(e.group); if (e.rune) e.rune.dead = true; }
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
    for (let i = 0, N = this.n(18); i < N; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * FROST.radius;
      this.S(['smoke_01', 'smoke_07', 'smoke_08'][i % 3], { p: [p[0] + Math.sin(a) * r, 0.3 + Math.random() * 0.6, p[2] + Math.cos(a) * r], v: [Math.sin(a) * 1.5, 0.6 + Math.random(), Math.cos(a) * 1.5],
        drag: 0.8, life: 1 + Math.random() * 0.6, size: [1, 2.6], spin: (Math.random() - 0.5), color: 0xeef8ff, alpha: 0.55, add: false, fadeIn: 0.1 });
    }
    this.S('window_04', { p: pos, size: [2.5, 0.5], life: 0.3, color: 0xffffff, alpha: 0.9 });
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
  // An aim circle on the ground (Night Cage, Meteor Rain).
  cataAim(radius = MRAIN.radius, color = 0xff7a2a, rim = 0xffc080) {
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
    e.runes = [
      this.S('magic_02', { p: [p[0], 0.18, p[2]], mode: 'flat', size: [CAGE.radius * 1.2, CAGE.radius * 2], life: left + 0.5, spin: 0.35, color: 0xff1f3d, alpha: 0.55, fadeIn: 0.08, fadePow: 0.25 }),
      this.S('magic_01', { p: [p[0], 0.19, p[2]], mode: 'flat', size: [CAGE.radius * 0.6, CAGE.radius * 1.1], life: left + 0.5, spin: -0.6, color: 0xff5a70, alpha: 0.5, fadeIn: 0.1, fadePow: 0.25 }),
    ];
    (this.cages ??= new Set()).add(e);
    for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; this.dust(new THREE.Vector3(p[0] + Math.sin(a) * CAGE.radius, 0.2, p[2] + Math.cos(a) * CAGE.radius), 1); }
    return e;
  }
  endCage(e) { if (e) { e.endAt = Math.min(e.endAt, realNow()); for (const q of e.runes || []) if (q) q.life = Math.min(q.life, q.age + 0.5); } }

  // Cinder's Firewall: a roaring curtain of flame across her aim (layered scrolling sheets, a glowing base, embers).
  firewall(w) {
    const F = C.SPELLBOOK.firewall;
    const g = new THREE.Group();
    g.position.set(w.x, 0, w.z);
    g.rotation.y = w.yaw;
    // round 10 (Ty: "rough and boxy"): no sheets; a curtain of flame billboards spawned in update(), feathered at the
    // ends and the top, over a glowing base, with embers, sparks and smoke. Only the light lives in the group.
    const light = new THREE.PointLight(0xff6a1e, 10, 12);
    light.position.y = 1.4;
    g.add(light);
    this.scene.add(g);
    const along = [Math.cos(w.yaw), -Math.sin(w.yaw)];
    // the ground glow along the base: a few long-lived flat glows, tapered at the ends
    const glows = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 4 - 0.5) * F.width * 0.85, edge = Math.cos(Math.PI * a / (F.width * 1.1));
      glows.push(this.S('circle_05', { p: [w.x + along[0] * a, 0.06, w.z + along[1] * a], mode: 'flat', size: [0.5, 2.2 * edge + 0.6], life: w.left + 0.4, color: 0xff6a1e, alpha: 0.55 * edge + 0.15, fadeIn: 0.06, fadePow: 0.3 }));
    }
    const e = { group: g, light, glows, along, x: w.x, z: w.z, born: realNow(), endAt: realNow() + w.left, flame: 0, ember: 0, smoke: 0 };
    (this.firewalls ??= new Set()).add(e);
    // the ignite: a burst along its length
    for (let i = -2; i <= 2; i++) {
      const p = new THREE.Vector3(w.x + Math.cos(w.yaw) * i, 0.6, w.z - Math.sin(w.yaw) * i);
      this.burst(p, i % 2 ? 0xffb040 : 0xff5a1e, 8, 4, 0.5, -2);
      this.fireBurst(p, 0.9, 3);
    }
    this.scorchDecal({ x: w.x, z: w.z }, F.width * 0.45, w.left + 4, 0x1a0c06, 0.6);
    return e;
  }
  endFirewall(e) { if (e) { e.endAt = Math.min(e.endAt, realNow()); for (const q of e.glows || []) if (q) q.life = Math.min(q.life, q.age + 0.35); } }
  // A projectile burning up in a Firewall.
  burnUp(p) {
    const pos = new THREE.Vector3(p[0], p[1], p[2]);
    this.burst(pos, 0xff7a1e, 18, 5, 0.5, -3);
    this.burst(pos, 0xffd080, 8, 2, 0.3, -1);
    this.fireBurst(pos, 0.6, 3);
  }

  // ---------------------------------------------------------------- Jeb
  // A summoned ram appearing or vanishing: a puff of dust and golden motes.
  ramPoof(p) {
    const pos = new THREE.Vector3(p[0], 0.5, p[2]);
    for (let i = 0; i < 6; i++) this.dust(pos, 3);
    this.burst(pos.clone().setY(0.8), 0xe8d090, 10, 2.5, 0.35, -1);
  }
  // The Stampede lane: a marker on the ground and a wall of dust rising along it during the telegraph, then trampled
  // dust as the rams pass. Anchored at `p`, running `length` along `dir`.
  stampedeLane(p, dir, width, length, left) {
    const g = new THREE.Group();
    g.position.set(p[0], 0, p[2]);
    g.rotation.y = Math.atan2(dir[0], dir[2]);
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(width, length).rotateX(-Math.PI / 2).translate(0, 0, length / 2),
      new THREE.MeshBasicMaterial({ color: 0xc8902a, transparent: true, opacity: 0, depthWrite: false }));
    fill.position.y = 0.14;
    const edges = [-1, 1].map(sd => {
      const e = new THREE.Mesh(new THREE.PlaneGeometry(0.22, length).rotateX(-Math.PI / 2).translate(sd * width / 2, 0, length / 2),
        new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, opacity: 0, depthWrite: false }));
      e.position.y = 0.15; g.add(e); return e;
    });
    // chevrons pointing down the lane
    const chev = [];
    for (let i = 1; i < 7; i++) {
      const c = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.25, 3, 1, Math.PI / 2 - 0.9, 1.8).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0, depthWrite: false }));
      c.position.set(0, 0.16, i * length / 7); g.add(c); chev.push(c);
    }
    g.add(fill);
    this.scene.add(g);
    const e = { group: g, fill, edges, chev, born: realNow(), runAt: realNow() + left, endAt: realNow() + left + 3.2, width, length, dir, p, dust: 0 };
    (this.lanes ??= new Set()).add(e);
    return e;
  }
  // The caster's lane marker while Q is held (Stampede).
  laneAim(width, length) {
    const g = new THREE.Group();
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(width, length).rotateX(-Math.PI / 2).translate(0, 0, length / 2),
      new THREE.MeshBasicMaterial({ color: 0xc8902a, transparent: true, opacity: 0.14, depthWrite: false }));
    fill.position.y = 0.16;
    g.add(fill);
    for (const sd of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.PlaneGeometry(0.15, length).rotateX(-Math.PI / 2).translate(sd * width / 2, 0, length / 2),
        new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, opacity: 0.9, depthWrite: false }));
      e.position.y = 0.17; g.add(e);
    }
    g.visible = false;
    this.scene.add(g);
    return g;
  }

  // ---------------------------------------------------------------- ultimate wind-ups, Blizzard, Meteor Rain
  // Every ultimate's wind-up: a column of light in the wizard's colour and a ring tightening at their feet.
  ultTell(follow, left, color) {
    const g = new THREE.Group();
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.8, 4, 20, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    col.position.y = 2;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.y = 0.15;
    g.add(col, ring);
    this.scene.add(g);
    const rune = this.S('magic_01', { follow, offset: [0, 0.17, 0], mode: 'flat', size: [3.6, 1.8], life: left + 0.15, spin: 2.6, color, alpha: 0.9, fadeIn: 0.15 });
    const rune2 = this.S('magic_02', { follow, offset: [0, 0.18, 0], mode: 'flat', size: [1.4, 2.6], life: left + 0.15, spin: -1.8, color: 0xffffff, alpha: 0.5, fadeIn: 0.3 });
    (this.tells ??= new Set()).add({ group: g, col, ring, follow, born: realNow(), endAt: realNow() + left, color, runes: [rune, rune2] });
  }
  // An interrupted ultimate: the light bursts and scatters.
  ultFizzle(pos) {
    for (const e of this.tells || []) if (e.follow.position.distanceTo(pos) < 0.5) { this.tells.delete(e); this.scene.remove(e.group); for (const q of e.runes) if (q) q.dead = true; }
    this.burst(new THREE.Vector3(pos.x, pos.y + 1.2, pos.z), 0xffffff, 16, 4, 0.4, 2);
    this.burst(new THREE.Vector3(pos.x, pos.y + 1.2, pos.z), 0x888888, 10, 2, 0.5, -1);
  }
  // Rime's Blizzard: a dense, swirling cone of snow from his staff, with frost spreading on the ground under it.
  // It follows `w` and turns with w.blizz (the server's slowly-steered aim).
  blizzard(w, left) {
    const g = new THREE.Group();
    const half = BLIZ.cone / 2 * Math.PI / 180;
    const coneMat = new THREE.MeshBasicMaterial({ map: windTexture(), color: 0xf4fbff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    const mistMat = new THREE.MeshBasicMaterial({ color: 0xdcefff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    // a flattened cone: wide horizontally (the 70 degrees), a little less tall
    const cone = new THREE.Mesh(new THREE.ConeGeometry(Math.tan(half) * BLIZ.range, BLIZ.range, 32, 1, true).translate(0, -BLIZ.range / 2, 0).rotateX(-Math.PI / 2), coneMat);
    cone.scale.set(1, 0.3, 1); cone.position.y = 1.5;
    const mist = new THREE.Mesh(cone.geometry, mistMat);   // a pale body under the streaks, so the cone reads as a mass of snow
    mist.scale.set(0.92, 0.26, 0.98); mist.position.y = 1.5;
    // frost spreading on the ground under the cone (a sector pointing along +z, the cone's direction)
    const frost = new THREE.Mesh(new THREE.CircleGeometry(BLIZ.range, 40, Math.PI / 2 - half, half * 2).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xeaf8ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    frost.position.y = 0.13;
    g.add(mist, cone, frost);
    this.scene.add(g);
    const e = { group: g, cone, mist, frost, w, born: realNow(), endAt: realNow() + left, flake: 0 };
    (this.blizzards ??= new Set()).add(e);
    return e;
  }
  stopBlizzard(e) { if (e) e.endAt = Math.min(e.endAt, realNow()); }
  // Meteor Rain: the fiery launch (a column of flame and a shockwave), her flaming aura while up there, the blazing
  // dive, and the scorch she leaves.
  fireLaunch(p, top) {
    const streak = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.7, top + 2, 14, 1, true),
      this.mat(0xff7a1e, { opacity: 0.85, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    streak.position.set(p[0], (top + 2) / 2, p[2]);
    this.scene.add(streak);
    this.particles.push({ mesh: streak, vel: new THREE.Vector3(), life: 0, maxLife: 0.3, grav: 0, growXZ: -2, still: true });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2), this.mat(0xffa040, { opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.set(p[0], 0.15, p[2]);
    this.scene.add(ring);
    this.particles.push({ mesh: ring, vel: new THREE.Vector3(), life: 0, maxLife: 0.4, grav: 0, grow: 12, still: true });
    this.burst(new THREE.Vector3(p[0], 0.8, p[2]), 0xff5a1e, 30, 7, 0.6, -4);
    this.fireBurst(new THREE.Vector3(p[0], 0.5, p[2]), 1.5, 9);
    this.smokeBurst(new THREE.Vector3(p[0], 0.3, p[2]), 1.2, 5, 0x4a3a30, 0.45);
    for (let i = 0; i < 6; i++) this.dust(new THREE.Vector3(p[0], 0.2, p[2]), 3);
  }
  flameAura(follow) {
    const g = new THREE.Group();
    const shell = new THREE.Mesh(this.sphereGeo, this.mat(0xff6a1e, { opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
    shell.scale.set(1.1, 1.5, 1.1); shell.position.y = 1;
    const light = new THREE.PointLight(0xff6a1e, 8, 16);
    light.position.y = 1;
    g.add(shell, light);
    this.scene.add(g);
    const e = { group: g, shell, follow, ember: 0 };
    (this.auras ??= new Set()).add(e);
    return e;
  }
  stopAura(e) { if (e) { this.auras?.delete(e); this.scene.remove(e.group); if (e.eyes) this.scene.remove(e.eyes); } }
  blazeDive(from, to, left) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const len = a.distanceTo(b);
    const trail = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.9, len, 12, 1, true).translate(0, len / 2, 0).rotateX(Math.PI / 2),
      this.mat(0xff7a1e, { opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    trail.position.copy(b); trail.lookAt(a);
    this.scene.add(trail);
    this.particles.push({ mesh: trail, vel: new THREE.Vector3(), life: 0, maxLife: left + 0.35, grav: 0, still: true });
    for (let i = 0, N = this.n(24); i < N; i++) {
      const p = a.clone().lerp(b, Math.random());
      this.S(['fire_01', 'flame_01', 'fire_02'][i % 3], { p, v: [(Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2], drag: 2, life: 0.5 + Math.random() * 0.4,
        size: [1.2, 2.4], spin: (Math.random() - 0.5) * 3, color: i % 2 ? 0xffc050 : 0xff7a2a, alpha: 0.9, add: false });
    }
  }
  scorch(p, wall) {
    const pos = new THREE.Vector3(p[0], 0.6, p[2]);
    this.burst(pos, 0xff7a1e, 50, 10, 0.8, 4);
    this.burst(pos, 0xffd080, 20, 6, 0.5, 0);
    for (let i = 0; i < 10; i++) this.dust(pos, 3);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 64).rotateX(-Math.PI / 2), this.mat(0xffa040, { opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.set(p[0], 0.17, p[2]);
    this.scene.add(ring);
    this.particles.push({ mesh: ring, vel: new THREE.Vector3(), life: 0, maxLife: 0.45, grav: 0, grow: (MRAIN.radius + 2) / 0.45, still: true });
    this.fireBurst(pos, 2, 12);
    this.smokeBurst(pos.clone().setY(0.4), 2, 9, 0x3a3028, 0.55);
    this.groundRing(pos, MRAIN.radius + 1, 0x5a4a40, 0.6, 1.2);
    if (wall) return;
    // the scorch mark stays a while (8 s, fading)
    this.scorchDecal(pos, MRAIN.radius * 1.1, 8, 0x140804, 0.8);
  }

  // ---------------------------------------------------------------- Embibe
  // Flask Step's preview: a dotted arc along the throw and a ring where she'll arrive (main.js updates it each frame).
  flaskPreview() {
    const g = new THREE.Group();
    const dots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xd0a0ff, size: 0.18, transparent: true, opacity: 0.9, depthWrite: false }));
    dots.geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(400 * 3), 3));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xc080ff, transparent: true, opacity: 0.9, depthWrite: false }));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x6a3a9a, transparent: true, opacity: 0.35, depthWrite: false }));
    ring.position.y = fill.position.y = 0.16;
    const marker = new THREE.Group(); marker.add(ring, fill);
    g.add(dots, marker);
    g.visible = false; g.frustumCulled = false; dots.frustumCulled = false;
    this.scene.add(g);
    g.userData = { dots, marker };
    return g;
  }
  setFlaskPreview(g, path, at) {
    const { dots, marker } = g.userData, arr = dots.geometry.attributes.position.array;
    const n = Math.min(path.length, 400);
    for (let i = 0; i < n; i++) { arr[i * 3] = path[i][0]; arr[i * 3 + 1] = path[i][1]; arr[i * 3 + 2] = path[i][2]; }
    dots.geometry.setDrawRange(0, n);
    dots.geometry.attributes.position.needsUpdate = true;
    marker.position.set(at[0], 0, at[2]);
    marker.rotation.y += 0.05;
  }

  // Potion Toss shattering: glass shards and a purple splash ring the size of the splash.
  potionShatter(p, radius) {
    const pos = new THREE.Vector3(p[0], Math.max(0.2, p[1]), p[2]);
    this.burst(pos, 0xa050e0, 16, 4, 0.35, 8);
    this.burst(pos, 0xe8d0ff, 8, 3, 0.2, 10);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 32).rotateX(-Math.PI / 2), this.mat(0xb060ff, { opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.set(p[0], 0.15, p[2]);
    this.scene.add(ring);
    this.particles.push({ mesh: ring, vel: new THREE.Vector3(), life: 0, maxLife: 0.3, grav: 0, grow: radius / 0.3, still: true });
  }
  // Toxic Flask's pool: Ty's Meshy acid puddle model (the decal cut from its concept render, textures/fx/acid_puddle.webp,
  // while it loads) on the ground or the deck it landed on, a bright rim at the damage radius, bubbles and fumes. `left` = seconds it lasts.
  toxicPool(p, left) {
    const R = C.SPELLBOOK.toxic_flask.radius;
    const g = new THREE.Group();
    g.position.set(p[0], C.surfaceHeight(p[0], p[2], (p[1] || 0) + 0.3), p[2]);
    if (!this.acidTex) {
      this.acidTex = new THREE.TextureLoader().load('./textures/fx/acid_puddle.webp');
      this.acidTex.colorSpace = THREE.SRGBColorSpace; this.acidTex.anisotropy = 4;
    }
    // the texture's green body reaches about 0.3 of its width from the centre, its splashes 0.45: drawn 2.5 R across, the
    // liquid fills most of the rim and the splashes and the soaked soil run a little past it
    const liquid = new THREE.Mesh(new THREE.PlaneGeometry(R * 2.5, R * 2.5).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: this.acidTex, emissiveMap: this.acidTex, emissive: 0x9aff40, emissiveIntensity: 0.35, roughness: 0.25, metalness: 0.1,
        transparent: true, opacity: 0.8, alphaTest: 0.02, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    liquid.rotation.y = Math.random() * Math.PI * 2;
    liquid.position.y = 0.1; liquid.renderOrder = 1;
    // Ty's Meshy acid puddle (models/acid_puddle.glb, the broken vial in it) replaces the decal once loaded: 2.4 R across like
    // the decal, flattened to 0.45 of its scale so the vial lies low. It fades and pulses a green glow by itself.
    this.acidModel ??= import('three/addons/loaders/GLTFLoader.js').then(({ GLTFLoader }) => new GLTFLoader().loadAsync('./models/acid_puddle.glb')).then(gl => {
      const m = gl.scene, box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      m.position.set(-c.x, -box.min.y, -c.z);
      const unit = new THREE.Group(); unit.add(m); unit.userData.size = size;
      return unit;
    }).catch(() => null);
    this.acidModel.then(unit => {
      if (!unit || !g.parent) return;
      const s = unit.userData.size, k = R * 2.4 / Math.max(s.x, s.z), puddle = unit.clone();
      puddle.scale.set(k, k * 0.45, k); puddle.rotation.y = liquid.rotation.y; puddle.position.y = 0.02;
      puddle.traverse(o => {
        if (!o.isMesh) return;
        const mat = o.material = o.material.clone();
        Object.assign(mat, { emissive: new THREE.Color(0x7aff30), emissiveMap: mat.map, emissiveIntensity: 0.3 });
        o.castShadow = false; o.receiveShadow = true;
        o.onBeforeRender = () => {
          const rn = realNow(), fade = Math.max(0, Math.min(1, (e.endAt - rn) / 0.6));
          mat.transparent = fade < 0.999; mat.opacity = fade;
          mat.emissiveIntensity = 0.3 + 0.15 * Math.sin(rn * 3.2);
        };
      });
      liquid.visible = false;
      g.add(puddle);
    });
    const rim = new THREE.Mesh(new THREE.RingGeometry(R - 0.15, R, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xb8ff60, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    rim.position.y = 0.13;
    g.add(liquid, rim);
    g.scale.setScalar(0.2);
    this.scene.add(g);
    const e = { group: g, liquid, rim, born: realNow(), endAt: realNow() + left, bubble: 0, R };
    e.burn = this.scorchDecal({ x: p[0], z: p[2] }, R * 1.15, left + 5, 0x1a2a08, 0.7);   // the burn it leaves, fading after
    (this.pools ??= new Set()).add(e);
    this.burst(new THREE.Vector3(p[0], 0.5, p[2]), 0x7fd34a, 20, 5, 0.4, 6);
    return e;
  }
  endPool(e) { if (e) e.endAt = Math.min(e.endAt, realNow()); }
  // Flask Step: a burst of purple smoke where she left and where she arrives.
  flaskSmoke(p) {
    const pos = new THREE.Vector3(p[0], 0.8, p[2]);
    for (let i = 0, N = this.n(10); i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      this.S(['smoke_01', 'smoke_07', 'smoke_08'][i % 3], { p: [p[0] + (Math.random() - 0.5) * 0.8, 0.3 + Math.random() * 1.6, p[2] + (Math.random() - 0.5) * 0.8],
        v: [Math.sin(a) * 1.5, 0.8 + Math.random(), Math.cos(a) * 1.5], drag: 1.2, life: 0.8 + Math.random() * 0.4, size: [0.6, 1.8], spin: (Math.random() - 0.5),
        color: i % 2 ? 0x6a3a9a : 0xb080e0, alpha: 0.6, add: false, fadeIn: 0.1 });
    }
    this.burst(pos, 0xd0a0ff, 10, 3, 0.3, 0);
  }
  // Smoke Flask: a dense purple cloud (the Smoke Screen puffs, tinted) for `left` seconds.
  smokeFlask(p, left) {
    const SF = C.SPELLBOOK.smoke_flask;
    const g = new THREE.Group();
    g.position.set(p[0], 0, p[2]);
    const puffs = [];
    for (let i = 0; i < 18; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), color: i % 3 ? 0x7a4aaa : 0xb890e0, transparent: true, opacity: 0, depthWrite: false }));
      const a = Math.random() * Math.PI * 2, r = Math.random() * SF.radius * 0.8;
      const base = new THREE.Vector3(Math.sin(a) * r, 0.5 + Math.random() * (SF.height - 1), Math.cos(a) * r);
      sp.position.copy(base);
      g.add(sp);
      puffs.push({ sp, base, size: 1.6 + Math.random() * 1.4, phase: Math.random() * 6 });
    }
    this.scene.add(g);
    (this.flaskClouds ??= new Set()).add({ group: g, puffs, born: realNow(), endAt: realNow() + left });
    for (let i = 0; i < 6; i++) this.flaskSmoke([p[0] + (Math.random() - 0.5) * 2, 0, p[2] + (Math.random() - 0.5) * 2]);
  }
  // Berserker Brew: a green-purple aura with rising fumes, and two glowing eyes, following the wizard.
  brewAura(w, left) {
    const g = new THREE.Group();
    const shell = new THREE.Mesh(this.sphereGeo, this.mat(0x7fd34a, { opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
    shell.scale.set(0.9, 1.3, 0.9); shell.position.y = 1;
    const shell2 = new THREE.Mesh(this.sphereGeo, this.mat(0xa050e0, { opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
    shell2.scale.set(1.1, 1.45, 1.1); shell2.position.y = 1;
    const light = new THREE.PointLight(0x9a60e0, 5, 8); light.position.y = 1.2;
    g.add(shell, shell2, light);
    const eyes = new THREE.Group();
    for (const sx of [-0.05, 0.05]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 6), new THREE.MeshBasicMaterial({ color: 0xc8ff60 })); e.position.set(sx, 0.05, 0.1); eyes.add(e); }
    const eyeGlow = new THREE.Mesh(this.sphereGeo, this.mat(0xb8ff60, { opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    eyeGlow.scale.set(0.13, 0.05, 0.05); eyeGlow.position.set(0, 0.05, 0.1);
    eyes.add(eyeGlow);
    this.scene.add(g, eyes);
    const e = { group: g, eyes, shell, shell2, w, endAt: realNow() + left, fume: 0, brew: true };
    (this.auras ??= new Set()).add(e);
    return e;
  }

  // ---------------------------------------------------------------- update
  // A projectile's trail, one step: textured streaks, flames, smoke or motes by kind.
  trail(pr) {
    const p = pr.pos, v = pr.vel, fin = pr.fin ? 1.5 : 1, color = pr.kind === 'fast' ? pr.color : SPELL_COLORS[pr.kind];
    const jit = (r) => [p.x + (Math.random() - 0.5) * r, p.y + (Math.random() - 0.5) * r, p.z + (Math.random() - 0.5) * r];
    const ax = [v.x, v.y, v.z];
    switch (pr.kind) {
      case 'fast':
        this.S('trace_01', { p, mode: 'streak', axis: ax, size: [1.1 * fin, 0.5], aspect: 1.3, life: 0.22, color, alpha: 0.9 });
        this.S('circle_05', { p, size: [0.5 * fin, 0.1], life: 0.25, color, alpha: 0.55, optional: true });
        break;
      case 'fireball': case 'heavy': {
        const k = (pr.kind === 'heavy' ? 1.7 : 1) * fin;
        this.S(Math.random() < 0.5 ? 'fire_01' : 'flame_03', { p: jit(0.2 * k), v: [-v.x * 0.05, 0.6, -v.z * 0.05], life: 0.32, size: [0.75 * k, 0.25 * k], spin: (Math.random() - 0.5) * 4,
          color: Math.random() < 0.5 ? 0xffa040 : 0xffd080, alpha: 0.9, add: false });
        if (Math.random() < (pr.kind === 'heavy' ? 0.7 : 0.3)) this.S('smoke_08', { p: jit(0.3 * k), v: [0, 0.7, 0], drag: 1, life: 0.9, size: [0.4 * k, 1.3 * k], spin: (Math.random() - 0.5),
          color: 0x3a2a22, alpha: 0.4, add: false, fadeIn: 0.1, optional: true });
        if (pr.kind === 'heavy' && Math.random() < 0.4) this.S('trace_01', { p, v: [(Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3], grav: 6, life: 0.4, size: [0.9, 0.3], aspect: 0.8, mode: 'streak', stretch: 0.08, color: 0xffc060 });
        break;
      }
      case 'shear':
        this.S('trace_01', { p, mode: 'streak', axis: ax, size: [1.2 * fin, 0.5], aspect: 1.2, life: 0.2, color: 0xe8dcff, alpha: 0.8 });
        this.S('twirl_02', { p, size: [0.6 * fin, 1.2 * fin], life: 0.3, spin: 10, color: 0xa070ff, alpha: 0.45, optional: true });
        break;
      case 'hex':
        this.S('magic_05', { p, size: [0.5 * fin, 0.1], life: 0.3, spin: 4, color: 0xff1f3d, alpha: 0.8 });
        break;
      case 'skim':
        this.S('star_01', { p, size: [0.45 * fin, 0.08], life: 0.25, color: 0xcff2ff, alpha: 0.9, rot: 0 });
        break;
      case 'lash':
        this.S('trace_01', { p, mode: 'streak', axis: ax, size: [1.3, 0.6], aspect: 1.5, life: 0.25, color: 0xff2a3c, alpha: 0.9 });
        break;
      case 'potion': case 'toxic': case 'flaskstep':
        this.S(Math.random() < 0.7 ? 'circle_05' : 'magic_05', { p: jit(0.15), v: [(Math.random() - 0.5) * 0.4, 0.3, (Math.random() - 0.5) * 0.4], size: [0.35 * fin, 0.05], life: 0.45, spin: 3, color, alpha: 0.8 });
        break;
      case 'sling':
        this.S('dirt_02', { p, size: [0.22 * fin, 0.08], life: 0.3, color: 0x9a8a70, alpha: 0.6, add: false, optional: true });
        break;
      default:   // a thrown prop
        this.S('smoke_01', { p: jit(0.6), size: [0.5, 1], life: 0.45, spin: 1, color: 0xb48cff, alpha: 0.3, add: false, optional: true });
    }
  }

  update(dt) {
    this.clock += dt;
    this.sprites.update(dt, this.camera);
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
      const interval = (pr.kind === 'heavy' || pr.kind === 'lash' || pr.kind === 'fireball' ? 0.025 : 0.035) * (this.low ? 2 : 1);
      if (pr.trail > interval) { pr.trail = 0; this.trail(pr); }
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
        if (this.low && Math.random() < 0.55) continue;
        const inx = -Math.sin(a), inz = -Math.cos(a), dirt = Math.random() < 0.3;
        this.S(dirt ? 'dirt_02' : 'twirl_02', { p: [e.group.position.x + Math.sin(a) * r, 0.2 + Math.random() * 2.5, e.group.position.z + Math.cos(a) * r],
          v: [(inx * 0.6 + inz) * r * 1.6, 1.5, (inz * 0.6 - inx) * r * 1.6], grav: -2, life: 0.45, size: [dirt ? 0.35 : 0.8, 0.2], spin: 9,
          color: dirt ? 0x8a7050 : 0xd8c0ff, alpha: 0.85, add: !dirt });
      }
    }
    for (const e of this.pools || []) {
      const grow = Math.min(1, (rn - e.born) / 0.3), fade = Math.max(0, Math.min(1, (e.endAt - rn) / 0.6));
      if (fade <= 0) { this.pools.delete(e); this.scene.remove(e.group); continue; }
      e.group.scale.setScalar(0.2 + 0.8 * (1 - Math.pow(1 - grow, 3)));
      e.liquid.material.opacity = 0.8 * fade; e.rim.material.opacity = (0.5 + Math.sin(this.clock * 6) * 0.2) * fade;
      e.bubble += dt * 14;
      while (e.bubble > 1) {
        e.bubble -= 1;
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * e.R;
        if (this.low && Math.random() < 0.55) continue;
        this.S(Math.random() < 0.8 ? 'circle_02' : 'smoke_07', { p: [e.group.position.x + Math.sin(a) * r, 0.15, e.group.position.z + Math.cos(a) * r], v: [0, 0.6 + Math.random() * 0.8, 0],
          life: 0.5 + Math.random() * 0.5, size: [0.12, 0.35], color: Math.random() < 0.6 ? 0x9aff50 : 0x5aa030, alpha: 0.8 });
      }
    }
    for (const e of this.flaskClouds || []) {
      const grow = Math.min(1, (rn - e.born) / 0.25), fade = Math.max(0, Math.min(1, (e.endAt + 0.6 - rn) / 0.6));
      if (fade <= 0) { this.flaskClouds.delete(e); this.scene.remove(e.group); continue; }
      for (const q of e.puffs) {
        const w = rn * 0.9 + q.phase;
        q.sp.position.set(q.base.x + Math.sin(w) * 0.3, q.base.y + Math.sin(w * 0.7) * 0.15, q.base.z + Math.cos(w * 0.8) * 0.3);
        q.sp.scale.setScalar(q.size * (0.3 + 0.7 * grow));
        q.sp.material.rotation += dt * 0.6;
        q.sp.material.opacity = 0.75 * grow * fade;
      }
    }
    for (const e of this.tells || []) {
      const k = Math.min(1, (rn - e.born) / Math.max(0.05, e.endAt - e.born));
      if (rn > e.endAt + 0.15) { this.tells.delete(e); this.scene.remove(e.group); continue; }
      e.group.position.set(e.follow.position.x, e.follow.position.y, e.follow.position.z);
      e.col.material.opacity = 0.15 + 0.45 * k + Math.sin(this.clock * 20) * 0.05;
      e.col.scale.set(1 - k * 0.5, 0.5 + k * 0.6, 1 - k * 0.5);
      e.ring.scale.setScalar(Math.max(0.1, 3.5 * (1 - k) + 0.6));
      e.ring.material.opacity = 0.4 + 0.5 * k;
    }
    for (const e of this.blizzards || []) {
      const fade = Math.max(0, Math.min(1, (e.endAt - rn) / 0.4)), k = Math.min(1, (rn - e.born) / 0.25);
      if (fade <= 0 || !e.w.group.parent) { this.blizzards.delete(e); this.scene.remove(e.group); continue; }
      e.group.position.copy(e.w.group.position);
      if (e.w.blizz != null) e.group.rotation.y += Math.atan2(Math.sin(e.w.blizz - e.group.rotation.y), Math.cos(e.w.blizz - e.group.rotation.y)) * Math.min(1, dt * 10);
      else if (rn - e.born < 0.05) e.group.rotation.y = e.w.group.rotation.y;
      e.cone.material.opacity = 0.85 * k * fade;
      e.mist.material.opacity = (0.3 + Math.sin(this.clock * 7) * 0.05) * k * fade;
      e.cone.material.map.offset.x -= dt * 1.8;
      e.frost.material.opacity = Math.min(0.45, (rn - e.born) * 0.4) * fade;
      // snowflakes streaming down the cone
      e.flake += dt * 260;
      const yaw = e.group.rotation.y, half = BLIZ.cone / 2 * Math.PI / 180;
      while (e.flake > 1) {
        e.flake -= 1;
        const a = yaw + (Math.random() - 0.5) * 2 * half * 0.9, sp = 10 + Math.random() * 8;
        if (this.low && Math.random() < 0.55) continue;
        const flake = Math.random() < 0.6;
        this.S(flake ? 'star_06' : 'circle_05', { p: [e.group.position.x + Math.sin(yaw) * 0.8, e.group.position.y + 1.2 + (Math.random() - 0.4) * 0.4, e.group.position.z + Math.cos(yaw) * 0.8],
          v: [Math.sin(a) * sp, (Math.random() - 0.4) * 2.5, Math.cos(a) * sp], grav: 1, life: BLIZ.range / sp, size: [flake ? 0.22 : 0.16, flake ? 0.3 : 0.12], spin: (Math.random() - 0.5) * 8,
          color: Math.random() < 0.7 ? 0xffffff : 0xbfeaff, alpha: 0.95, fadeIn: 0.05, fadePow: 0.5 });
      }
    }
    for (const e of this.auras || []) {
      if (e.brew) {
        // Berserker Brew: follows its wizard; the eyes sit on the head bone
        if (rn > e.endAt || !e.w.group.parent) { this.stopAura(e); continue; }
        e.group.position.copy(e.w.group.position);
        e.w.head.getWorldPosition(e.eyes.position); e.eyes.rotation.y = e.w.group.rotation.y;
        e.shell.material.opacity = 0.2 + Math.sin(this.clock * 9) * 0.06; e.shell2.material.opacity = 0.16 + Math.sin(this.clock * 7 + 1) * 0.05;
        e.fume += dt;
        while (e.fume > 0.05) { e.fume -= 0.05; this.burst(e.group.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.3 + Math.random() * 1.6, (Math.random() - 0.5) * 0.8)), Math.random() < 0.5 ? 0x7fd34a : 0xa050e0, 1, 1, 0.3, -2); }
        continue;
      }
      e.group.position.copy(e.follow.position);
      e.shell.material.opacity = 0.3 + Math.sin(this.clock * 17) * 0.08;
      e.ember += dt;
      while (e.ember > 0.03) {
        e.ember -= 0.03;
        this.S(Math.random() < 0.5 ? 'flame_01' : 'fire_02', { p: e.group.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.3 + Math.random() * 1.6, (Math.random() - 0.5) * 1.2)),
          v: [0, 2 + Math.random() * 1.5, 0], life: 0.45, size: [0.7, 0.2], spin: (Math.random() - 0.5) * 3, color: Math.random() < 0.5 ? 0xffa040 : 0xffd080, alpha: 0.9, add: false, optional: true });
      }
    }
    for (const e of this.scorches || []) {
      const age = rn - e.born;
      if (age > 8) { this.scorches.delete(e); this.scene.remove(e.mesh); continue; }
      if (age > 6) e.mesh.material.opacity = 0.75 * (8 - age) / 2;
    }
    for (const e of this.lanes || []) {
      if (rn > e.endAt) { this.lanes.delete(e); this.scene.remove(e.group); continue; }
      const warm = Math.min(1, (rn - e.born) / Math.max(0.05, e.runAt - e.born)), fade = Math.max(0, Math.min(1, (e.endAt - rn) / 0.6));
      e.fill.material.opacity = (0.1 + 0.15 * warm + Math.sin(this.clock * 10) * 0.04) * fade;
      for (const ed of e.edges) ed.material.opacity = (0.5 + 0.4 * warm) * fade;
      e.chev.forEach((c, i) => { c.material.opacity = Math.max(0, Math.sin(this.clock * 8 - i * 0.9)) * 0.7 * fade * (rn < e.runAt + 2.2 ? 1 : 0.3); });
      // the ground shakes loose: dust along the lane, thick once the rams are running
      e.dust += dt * (rn < e.runAt ? 18 : 40);
      while (e.dust > 1) {
        e.dust -= 1;
        const along = Math.random() * e.length, side = (Math.random() - 0.5) * e.width;
        this.dust(new THREE.Vector3(e.p[0] + e.dir[0] * along - e.dir[2] * side, 0.1, e.p[2] + e.dir[2] * along + e.dir[0] * side), 1);
      }
    }
    for (const e of this.firewalls || []) {
      const k = Math.min(1, (rn - e.born) / 0.2), fade = Math.max(0, Math.min(1, (e.endAt - rn) / 0.35));
      if (fade <= 0) { this.firewalls.delete(e); this.scene.remove(e.group); continue; }
      // heat flicker on the light
      e.light.intensity = (8 + Math.sin(this.clock * 23) * 2 + (Math.random() - 0.5) * 3) * fade * k;
      const F = C.SPELLBOOK.firewall, W = F.width, rate = this.low ? 0.5 : 1;
      // a spot along the wall, tapered: fewer and smaller flames toward the ends (no hard silhouette)
      const spot = () => { let a, edge; do { a = (Math.random() - 0.5) * W; edge = Math.cos(Math.PI * a / W); } while (Math.random() > 0.25 + 0.75 * edge); return [a, Math.max(0.15, edge)]; };
      const at = (a, y, off = 0) => [e.x + e.along[0] * a - e.along[1] * off, y, e.z + e.along[1] * a + e.along[0] * off];
      // the flames: overlapping billboards rising and curling, shrinking and fading as they go (the top feathers out)
      e.flame += dt * 150 * rate * fade;
      while (e.flame > 1) {
        e.flame -= 1;
        const [a, edge] = spot(), sz = (1.3 + Math.random() * 1.4) * (0.4 + 0.6 * edge) * (0.5 + 0.5 * k);
        const body = Math.random() < 0.62;   // most of the curtain alpha-blended (true orange in daylight), the rest additive highlights
        const up = (1.2 + Math.random() * 1.4) * (0.45 + 0.55 * edge) * F.height / 3, curl = (Math.random() - 0.5) * 1.2;
        // born anywhere up the lower part of the curtain (lower toward the ends), so the body is full, not just the base
        const y0 = 0.1 + Math.pow(Math.random(), 1.3) * F.height * 0.5 * edge * k;
        this.S(['flame_01', 'flame_03', 'fire_01', 'fire_02'][Math.floor(Math.random() * 4)], { p: at(a, y0, (Math.random() - 0.5) * 0.3),
          v: [e.along[0] * curl, up, e.along[1] * curl], drag: 0.6, grav: -0.6, life: 0.5 + Math.random() * 0.45,
          size: [sz, sz * 0.45], aspect: 1.25, spin: (Math.random() - 0.5) * 2.4, rot: (Math.random() - 0.5) * 0.6,
          color: body ? [0xffc050, 0xff9a30, 0xff7020, 0xffd070][Math.floor(Math.random() * 4)] : [0xffd080, 0xffa040, 0xff7a2a][Math.floor(Math.random() * 3)],
          alpha: (body ? 0.75 + Math.random() * 0.2 : 0.55 + Math.random() * 0.35) * fade, fadeIn: 0.12, fadePow: 1.4, add: !body });
      }
      // the hot core along the base, and embers and sparks spitting up
      e.ember += dt * rate * fade;
      while (e.ember > 0.012) {
        e.ember -= 0.012;
        const [a, edge] = spot(), r = Math.random();
        if (r < 0.4) this.S('circle_05', { p: at(a, 0.2 + Math.random() * 0.2), v: [0, 0.4, 0], life: 0.35, size: [1.1 * edge + 0.3, 0.6], color: 0xff7a2a, alpha: 0.45 * fade, fadeIn: 0.2 });
        else if (r < 0.85) this.S('circle_05', { p: at(a, 0.3 + Math.random() * 1.5), v: [(Math.random() - 0.5) * 1.6, 2.5 + Math.random() * 3, (Math.random() - 0.5) * 1.6], grav: -0.5, drag: 0.4,
          life: 0.6 + Math.random() * 0.6, size: [0.12, 0.04], color: Math.random() < 0.5 ? 0xffd080 : 0xff8a2a, alpha: fade });
        else this.S('trace_01', { p: at(a, 0.4 + Math.random()), v: [(Math.random() - 0.5) * 3, 3 + Math.random() * 3, (Math.random() - 0.5) * 3], grav: 5, life: 0.4,
          size: [0.7, 0.25], aspect: 0.8, mode: 'streak', stretch: 0.06, color: 0xffc060, alpha: fade, optional: true });
      }
      // a dark smoke wisp rising off the top
      e.smoke += dt * 7 * rate * fade;
      while (e.smoke > 1) {
        e.smoke -= 1;
        const [a] = spot();
        this.S(['smoke_01', 'smoke_07', 'smoke_08'][Math.floor(Math.random() * 3)], { p: at(a * 0.8, F.height * 0.8 + Math.random() * 0.5), v: [(Math.random() - 0.5) * 0.6, 1 + Math.random() * 0.6, (Math.random() - 0.5) * 0.6],
          drag: 0.5, life: 1.4 + Math.random() * 0.6, size: [1, 2.8], spin: (Math.random() - 0.5) * 0.6, color: 0x2a2420, alpha: 0.28 * fade, add: false, fadeIn: 0.25 });
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
    for (const w of this.walls || []) {
      if (w.rise < 1) { w.rise = Math.min(1, w.rise + dt / 0.15); w.group.scale.y = 0.05 + 0.95 * (1 - Math.pow(1 - w.rise, 3)); }
      // ice glints catching the light on its faces
      w.glint = (w.glint || 0) + dt;
      if (w.glint > (this.low ? 0.5 : 0.22)) {
        w.glint = 0;
        const q = w.group.localToWorld(new THREE.Vector3((Math.random() - 0.5) * BULWARK.width * 0.9, 0.3 + Math.random() * (BULWARK.height - 0.5), (Math.random() < 0.5 ? -1 : 1) * 0.28));
        this.S(Math.random() < 0.5 ? 'star_06' : 'window_04', { p: q, size: [0.55, 0.1], life: 0.45, rot: Math.random() < 0.5 ? 0 : Math.PI / 4, color: 0xe8fbff, alpha: 0.9 });
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
