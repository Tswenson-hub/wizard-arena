// Pickups (characters track, round 22): the rune pickups' visuals (a glowing rune ring on the floor, the rune glyph turning
// over it in its type's colour, a halo and orbiting motes; dim while it recharges, a burst when taken) and the jump pads
// (a mint rune circle with inward chevrons, an updraft of motes and a faint dotted arc towards where the pad lands you; a
// flash and a whoosh on a launch). The server owns the rules: the runes come from the snapshot, the pads from map.js PADS.
//
// main.js (spells):
//   const pickups = mountPickups({ scene, sfx, players, myId: () => myId })
//   pickups.onMessage(msg)    every server message: snap/welcome `runes: [{ i, x, y, z, type, up, in? }]`,
//                             { t: 'runeTaken', i, by, type }, { t: 'pad', id, pad }
//   pickups.update(dt, camera) per frame
//   pickups.rebuild()         after a map swap (re-reads the pads: the last welcome's list, else C.JUMP_PADS; the runes return with the next snap)
//   pickups.clear()           leaving the room
//   pickups.landed([x, y, z], { air, mine })  round 24: a landing (ours or a remote wizard's). On one of Sky Ruins' stepping stones it
//                             kicks up rock dust that spills off the edge and pebbles that hop and fall into the void; returns the stone,
//                             or null at once anywhere else (so the call is cheap on every landing). `air`: after an air jump (bigger).
// No shader program of its own: every piece is drawn with a program the arena already has (the auras' Points, a MeshBasicMaterial
// with a map, a SpriteMaterial with a map).
import * as THREE from 'three';
import * as C from '../shared/constants.js';
import { motes, dotTexture } from './looks.js';

// The rune types: the name and colour from constants.js C.RUNES.types (spells; the HUD and the glow agree), these as the fallback.
// `css` is the HUD's colour, `glyphChar` the announcer line's mark, `glyph` the drawing.
const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');
export const RUNE_TYPES = Object.fromEntries(Object.entries({
  haste: { name: 'Haste', color: 0x5cc8ff, glyphChar: '»', glyph: 'bolt' },
  fury: { name: 'Fury', color: 0xff5a2a, glyphChar: '✶', glyph: 'flame' },
  aegis: { name: 'Aegis', color: 0xffd36a, glyphChar: '⛨', glyph: 'shield' },
  surge: { name: 'Surge', color: 0xc070ff, glyphChar: '⟡', glyph: 'star' },
}).map(([k, v]) => { const c = C.RUNES?.types?.[k]; const color = c?.color ?? v.color; return [k, { ...v, name: c?.name?.split(' ').pop() || v.name, color, css: hex(new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.15).getHex()) }]; }));
const PAD_COLOR = 0x8affc8;
const RESPAWN = 25;   // s (the server's rune respawn, for the charging glow when the snapshot has no `in`)

const fract = (x) => x - Math.floor(x);
const rand = (i, k) => fract(Math.sin(i * 127.1 + k * 311.7) * 43758.5453);
// ---------------------------------------------------------------- canvas textures (made once)
const tex = {};
function canvasTex(key, size, draw) {
  if (tex[key]) return tex[key];
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  g.strokeStyle = g.fillStyle = '#fff'; g.lineCap = g.lineJoin = 'round';
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return (tex[key] = t);
}
// the rune ring: a bright band, a thin inner ring and runic ticks between them
const ringTex = () => canvasTex('ring', 256, (g, s) => {
  const c = s / 2;
  g.shadowColor = '#fff'; g.shadowBlur = 10;
  g.lineWidth = 7; g.beginPath(); g.arc(c, c, c * 0.84, 0, 6.283); g.stroke();
  g.lineWidth = 2.5; g.beginPath(); g.arc(c, c, c * 0.56, 0, 6.283); g.stroke();
  g.lineWidth = 4;
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * 6.283, r0 = c * 0.62, r1 = c * (i % 3 === 0 ? 0.78 : 0.7);
    g.beginPath(); g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.stroke();
    if (i % 3 === 1) { const a2 = a + 0.08, r2 = c * 0.66; g.beginPath(); g.moveTo(c + Math.cos(a) * r2, c + Math.sin(a) * r2); g.lineTo(c + Math.cos(a2) * (r2 + 8), c + Math.sin(a2) * (r2 + 8)); g.stroke(); }
  }
});
// the pad ring: a band with four chevrons pointing in, and a soft centre
const padTex = () => canvasTex('pad', 256, (g, s) => {
  const c = s / 2;
  g.shadowColor = '#fff'; g.shadowBlur = 12;
  g.lineWidth = 8; g.beginPath(); g.arc(c, c, c * 0.86, 0, 6.283); g.stroke();
  g.lineWidth = 5;
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * 6.283 + 0.785;
    for (const k of [0.72, 0.58]) {
      const x = c + Math.cos(a) * c * k, y = c + Math.sin(a) * c * k, w = 0.42;
      g.beginPath(); g.moveTo(x + Math.cos(a + w) * 22, y + Math.sin(a + w) * 22); g.lineTo(x, y); g.lineTo(x + Math.cos(a - w) * 22, y + Math.sin(a - w) * 22); g.stroke();
    }
  }
  const grd = g.createRadialGradient(c, c, 0, c, c, c * 0.4);
  grd.addColorStop(0, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.shadowBlur = 0; g.fillStyle = grd; g.fillRect(0, 0, s, s);
});
// rock dust (round 24): a soft uneven puff, blotched so an expanding disc of it reads as dust rather than a glow
const dustTex = () => canvasTex('dust', 128, (g, s) => {
  const c = s / 2, grd = g.createRadialGradient(c, c, 0, c, c, c);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)'); grd.addColorStop(0.45, 'rgba(255,255,255,0.6)'); grd.addColorStop(0.8, 'rgba(255,255,255,0.18)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 16; i++) {
    const a = rand(i, 1) * 6.283, rr = c * (0.25 + rand(i, 2) * 0.7), R = c * (0.08 + rand(i, 3) * 0.16);
    const h = g.createRadialGradient(c + Math.cos(a) * rr, c + Math.sin(a) * rr, 0, c + Math.cos(a) * rr, c + Math.sin(a) * rr, R);
    h.addColorStop(0, 'rgba(255,255,255,0.75)'); h.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = h; g.fillRect(0, 0, s, s);
  }
});
// the glyphs, inside a thin runic circle
const GLYPHS = {
  bolt(g, s) { const k = s / 128; g.lineWidth = 7 * k; g.beginPath(); g.moveTo(74 * k, 22 * k); g.lineTo(46 * k, 68 * k); g.lineTo(66 * k, 68 * k); g.lineTo(52 * k, 106 * k); g.lineTo(84 * k, 58 * k); g.lineTo(64 * k, 58 * k); g.closePath(); g.stroke(); },
  flame(g, s) {
    const k = s / 128; g.lineWidth = 7 * k; g.beginPath();
    g.moveTo(64 * k, 20 * k); g.bezierCurveTo(90 * k, 50 * k, 96 * k, 70 * k, 84 * k, 92 * k); g.bezierCurveTo(78 * k, 104 * k, 50 * k, 104 * k, 44 * k, 92 * k);
    g.bezierCurveTo(32 * k, 70 * k, 48 * k, 56 * k, 54 * k, 46 * k); g.bezierCurveTo(58 * k, 56 * k, 66 * k, 58 * k, 64 * k, 20 * k); g.stroke();
    g.beginPath(); g.arc(64 * k, 86 * k, 8 * k, 0, 6.283); g.fill();
  },
  shield(g, s) {
    const k = s / 128; g.lineWidth = 7 * k; g.beginPath();
    g.moveTo(64 * k, 20 * k); g.lineTo(96 * k, 32 * k); g.lineTo(92 * k, 72 * k); g.bezierCurveTo(88 * k, 92 * k, 72 * k, 104 * k, 64 * k, 108 * k);
    g.bezierCurveTo(56 * k, 104 * k, 40 * k, 92 * k, 36 * k, 72 * k); g.lineTo(32 * k, 32 * k); g.closePath(); g.stroke();
    g.lineWidth = 5 * k; g.beginPath(); g.moveTo(64 * k, 40 * k); g.lineTo(64 * k, 88 * k); g.moveTo(48 * k, 58 * k); g.lineTo(80 * k, 58 * k); g.stroke();
  },
  star(g, s) {
    const k = s / 128, c = 64 * k; g.lineWidth = 6 * k; g.beginPath();
    for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283 - 1.5708, r = i % 2 ? 14 * k : 44 * k; g[i ? 'lineTo' : 'moveTo'](c + Math.cos(a) * r, c + Math.sin(a) * r); }
    g.closePath(); g.stroke();
    g.beginPath(); g.arc(c, c, 7 * k, 0, 6.283); g.fill();
  },
};
const glyphTex = (kind) => canvasTex('glyph_' + kind, 256, (g, s) => {
  g.shadowColor = '#fff'; g.shadowBlur = 14;
  g.lineWidth = 3; g.beginPath(); g.arc(s / 2, s / 2, s * 0.46, 0, 6.283); g.stroke();
  for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; g.beginPath(); g.moveTo(s / 2 + Math.cos(a) * s * 0.42, s / 2 + Math.sin(a) * s * 0.42); g.lineTo(s / 2 + Math.cos(a) * s * 0.46, s / 2 + Math.sin(a) * s * 0.46); g.stroke(); }
  GLYPHS[kind]?.(g, s); GLYPHS[kind]?.(g, s);   // (twice: the strokes over their own glow read solid)
});

// ---------------------------------------------------------------- materials (per type, made once and kept: no program churn)
const mats = {};
// (normal blending: additive washed the rings and glyphs to white on the light stone; the halo, the pad's disc and the motes stay additive)
function flat(map, color, additive = false) {
  return new THREE.MeshBasicMaterial({ map, color, transparent: true, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false });
}
function matsFor(type) {
  if (mats[type]) return mats[type];
  const R = RUNE_TYPES[type];
  return (mats[type] = { ring: flat(ringTex(), R.color), glyph: flat(glyphTex(R.glyph), R.color),
    halo: new THREE.SpriteMaterial({ map: dotTexture(), color: R.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.32 }) });
}
let padMats = null;
const padMatsFor = () => padMats ??= { ring: flat(padTex(), PAD_COLOR), disc: flat(dotTexture(), PAD_COLOR, true) };
// the stepping stones' dust: pale rock dust, darker pebbles (normal blending: additive dust would glow on the sky)
const DUST_COLOR = 0xd9d3c7, PEBBLE_COLOR = 0x8d8578, DRIFT_COLOR = 0xc4bcae;
let dustMat = null;
const dustMatFor = () => dustMat ??= flat(dustTex(), DUST_COLOR);
// a vertical plane seen from both sides without DoubleSide (that would be another program): two front faces back to back
let glyphGeo = null;
function glyphGeometry() {
  if (glyphGeo) return glyphGeo;
  const a = new THREE.PlaneGeometry(1.35, 1.35), b = a.clone().rotateY(Math.PI);
  const pos = new Float32Array([...a.attributes.position.array, ...b.attributes.position.array]);
  const uv = new Float32Array([...a.attributes.uv.array, ...b.attributes.uv.array]);
  const idx = [...a.index.array, ...b.index.array.map(i => i + 4)];
  glyphGeo = new THREE.BufferGeometry();
  glyphGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); glyphGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); glyphGeo.setIndex(idx);
  return glyphGeo;
}

export function mountPickups({ scene, sfx = null, pads: pads0 = null, stones: stones0 = null } = {}) {   // `pads` / `stones`: lists instead of the map's (tests)
  const runes = new Map();   // i -> visual
  const pads = [];
  let t = 0;

  // ---------------------------------------------------------------- runes
  function makeRune(r) {
    const g = new THREE.Group(); g.name = 'rune' + r.i; g.userData.cat = 'pickups';
    const M = matsFor(r.type || 'haste');
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6).rotateX(-Math.PI / 2), M.ring);
    ring.position.y = 0.06; ring.renderOrder = 2;
    const glyph = new THREE.Mesh(glyphGeometry(), M.glyph);
    glyph.position.y = 1.3; glyph.renderOrder = 3;
    const halo = new THREE.Sprite(M.halo);
    halo.position.y = 1.3; halo.scale.setScalar(2.4); halo.renderOrder = 3;
    const sphere = new THREE.Sphere(new THREE.Vector3(0, 1.4, 0), 3.2);
    // orbiting motes round the glyph, and a slow pillar of motes rising from the ring (visible from across the arena)
    const orbit = motes(10, { size: 0.09, color: 0xffffff, sphere, place: (i, tt, p) => {
      const a = tt * (1.4 + rand(i, 1) * 0.6) + rand(i, 2) * 6.283, rr = 0.62 + rand(i, 3) * 0.2;
      p.set(Math.cos(a) * rr, 1.3 + Math.sin(tt * 1.7 + i) * 0.32, Math.sin(a) * rr);
      return 0.7 + 0.3 * Math.sin(tt * 5 + i);
    } });
    const pillar = motes(8, { size: 0.16, color: 0xffffff, sphere, place: (i, tt, p) => {
      const q = fract(tt * 0.22 + rand(i, 1));
      const a = rand(i, 2) * 6.283 + q * 1.5, rr = 0.9 * (1 - q * 0.6);
      p.set(Math.cos(a) * rr, 0.1 + q * 2.8, Math.sin(a) * rr);
      return Math.sin(q * Math.PI) * 0.55;
    } });
    g.add(ring, glyph, halo, orbit, pillar);
    g.position.set(r.x, r.y || 0, r.z);
    scene.add(g);
    const v = { i: r.i, x: r.x, y: r.y || 0, z: r.z, type: null, up: null, in: null, g, ring, glyph, halo, orbit, pillar, burst: -1, ph: rand(r.i, 9) * 6.283 };
    setType(v, r.type);
    return v;
  }
  function setType(v, type) {
    if (!RUNE_TYPES[type] || v.type === type) return;
    v.type = type;
    // each rune has its own copies (the burst fades them), of the type's materials (the copies share their programs)
    const M = matsFor(type);
    v.ring.material = M.ring.clone(); v.glyph.material = M.glyph.clone(); v.halo.material = M.halo.clone();
    const col = new THREE.Color(RUNE_TYPES[type].color);
    for (const pts of [v.orbit, v.pillar]) pts.material.color.copy(col).lerp(new THREE.Color(0xffffff), 0.35);
  }
  function applyRune(r) {
    let v = runes.get(r.i);
    if (v && (Math.abs(v.x - r.x) > 0.01 || Math.abs(v.z - r.z) > 0.01 || Math.abs(v.y - (r.y || 0)) > 0.01)) { drop(v); runes.delete(r.i); v = null; }
    if (!v) runes.set(r.i, v = makeRune(r));
    if (r.type) setType(v, r.type);
    const up = r.up !== false && r.up !== 0;
    if (v.up === true && !up && v.burst < 0) v.burst = t;   // missed the runeTaken message: burst anyway
    v.up = up; v.in = r.in ?? null;
    if (!up && v.in == null && v.downAt == null) v.downAt = t;
    if (up) v.downAt = null;
  }
  function drop(v) { v.g.removeFromParent(); for (const pts of [v.orbit, v.pillar]) pts.geometry.dispose(); }
  function runeTaken(msg) {
    const v = runes.get(msg.i);
    if (!v) return;
    v.burst = t; v.up = false; v.downAt = t;
    if (msg.type) setType(v, msg.type);
    tickRune(v);
  }
  function tickRune(v) {   // the pickup's chime, where the rune was (the taker's own banner line has its own)
    sfx?.play?.('tk_lift', { pos: v.g.position.clone().setY(v.y + 1.2), vol: 0.5, rate: 1.4, jitter: 0.03 });
  }
  function updateRune(v, dt) {
    const tt = t + v.ph;
    const bursting = v.burst >= 0 && t - v.burst < 0.5;
    if (bursting) {
      const k = (t - v.burst) / 0.5;
      v.ring.scale.setScalar(1 + k * 1.4); v.ring.material.opacity = 1 - k;
      v.halo.scale.setScalar(2.4 + k * 4); v.halo.material.opacity = 0.32 * (1 - k);
      v.glyph.position.y = 1.3 + k * 1.6; v.glyph.scale.setScalar(1 + k * 0.6); v.glyph.material.opacity = 1 - k;
      v.glyph.visible = v.halo.visible = true; v.orbit.visible = false; v.pillar.visible = true;
      return;
    }
    if (v.burst >= 0) { v.burst = -1; v.ring.scale.setScalar(1); v.halo.scale.setScalar(2.4); v.glyph.scale.setScalar(1); v.ring.material.opacity = 1; v.halo.material.opacity = 0.32; v.glyph.material.opacity = 1; }
    if (v.up) {
      v.glyph.visible = v.halo.visible = v.orbit.visible = v.pillar.visible = true;
      v.ring.rotation.y = tt * 0.5; v.ring.scale.setScalar(1 + 0.03 * Math.sin(tt * 2.2));
      v.glyph.rotation.y = tt * 1.5; v.glyph.position.y = 1.3 + Math.sin(tt * 1.6) * 0.12;
      v.halo.position.y = v.glyph.position.y; v.halo.scale.setScalar(2.2 + 0.25 * Math.sin(tt * 3.1));
    } else {
      // recharging: the ring dim and slowly turning, brightening as the respawn nears; the pillar returns in the last 3 s
      const left = v.in ?? (v.downAt != null ? Math.max(0, RESPAWN - (t - v.downAt)) : RESPAWN);
      const charge = 1 - Math.min(1, left / RESPAWN);
      v.glyph.visible = v.halo.visible = v.orbit.visible = false;
      v.pillar.visible = left < 3;
      v.ring.rotation.y = tt * 0.15; v.ring.scale.setScalar(0.7 + 0.3 * charge);
      v.ring.material.opacity = 0.2 + 0.3 * charge + (left < 3 ? 0.25 * Math.max(0, Math.sin(tt * 6)) : 0);
    }
  }

  // ---------------------------------------------------------------- pads
  function makePad(P, idx) {
    const g = new THREE.Group(); g.name = 'pad' + idx; g.userData.cat = 'pickups';
    const M = padMatsFor(), r = P.r || 1.2;
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(r * 2.2, r * 2.2).rotateX(-Math.PI / 2), M.ring);
    ring.position.y = 0.05; ring.renderOrder = 2;
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(r * 2.6, r * 2.6).rotateX(-Math.PI / 2), M.disc);
    disc.position.y = 0.04; disc.renderOrder = 1; disc.material.opacity = 0.35;
    // the arc towards the landing spot (the visual's own parabola; the server has the real one): dotted motes flowing along it
    const T = P.to || P.target || (P.tx != null ? [P.tx, P.ty, P.tz] : null);
    const to = T ? new THREE.Vector3(T[0] - P.x, (T[1] ?? P.y ?? 0) - (P.y || 0), T[2] - P.z) : null;
    const dist = to ? Math.hypot(to.x, to.z) : 0;
    const apex = to ? Math.max(0, to.y) + 2.5 + dist * 0.18 : 3;
    const mid = to ? to.clone().multiplyScalar(0.5).setY(apex * 0.6) : new THREE.Vector3(0, 1.5, 0);
    const sphere = new THREE.Sphere(mid, (to ? to.length() / 2 : 0) + 3.5);
    const state = { boost: -1 };
    const draft = motes(10, { size: 0.14, color: PAD_COLOR, sphere, place: (i, tt, p) => {
      const fast = state.boost >= 0 && tt - state.boost < 0.6 ? 4 : 1;
      const q = fract(tt * 0.35 * fast + rand(i, 1));
      const a = rand(i, 2) * 6.283 + tt * 0.8, rr = r * 0.75 * (1 - q * 0.5);
      p.set(Math.cos(a) * rr, 0.1 + q * 2.2 * fast, Math.sin(a) * rr);
      return Math.sin(q * Math.PI) * 0.6;
    } });
    const arc = to ? motes(14, { size: 0.11, color: PAD_COLOR, sphere, place: (i, tt, p) => {
      const q = fract(tt * 0.28 + i / 14);
      p.set(to.x * q, 4 * apex * q * (1 - q) + to.y * q, to.z * q);
      return 0.35 * Math.sin(q * Math.PI) + 0.1;
    } }) : null;
    g.add(ring, disc, draft); if (arc) g.add(arc);
    g.position.set(P.x, P.y || 0, P.z);
    scene.add(g);
    return { id: P.id ?? idx, g, ring, disc, draft, arc, state, flash: -1, ph: rand(idx, 5) * 6.283, r };
  }
  // the pads: the welcome's list (room.js, the room's real pads: the legacy rooms have none), else map.js JUMP_PADS (or PADS)
  let padList = Array.isArray(pads0) ? pads0 : null;
  function buildPads() {
    for (const p of pads) { p.g.removeFromParent(); p.draft.geometry.dispose(); p.arc?.geometry.dispose(); }
    pads.length = 0;
    for (const [i, P] of (padList || C.JUMP_PADS || C.PADS || []).entries()) pads.push(makePad(P, i));
  }
  function padLaunch(msg) {
    const p = pads[msg.pad] ?? pads.find(q => msg.padId != null && q.id === msg.padId);
    if (!p) return;
    p.flash = t; p.state.boost = performance.now() / 1000;   // (the motes' clock)
    sfx?.play?.('whoosh', { pos: p.g.position.clone().setY(p.g.position.y + 1), vol: 0.9, rate: 1.15, jitter: 0.05 });
  }
  function updatePad(p) {
    const tt = t + p.ph;
    const k = p.flash >= 0 ? Math.min(1, (t - p.flash) / 0.4) : 1;
    p.ring.rotation.y = -tt * 0.6;
    p.ring.scale.setScalar(1 + 0.04 * Math.sin(tt * 2.5) + (1 - k) * 0.6);
    p.disc.scale.setScalar(1 + (1 - k) * 0.9);
    p.disc.material.opacity = 0.3 + 0.1 * Math.sin(tt * 3) + (1 - k) * 0.5;
  }

  // ---------------------------------------------------------------- stepping stones (round 24): landing dust
  // The stones: the map's STEPPING_STONES export `{ id, x, y, z, r }` (environment), else the small ISLANDS footprints (a rock under 5 m
  // across), else a list given at mount (tests). A landing counts when the feet are on the stone's top within its footprint and a bit over
  // the edge (a landing on the lip still kicks dust).
  let stoneList = Array.isArray(stones0) ? stones0 : null;
  const stones = () => {
    if (stoneList) return stoneList;
    const S = C.STEPPING_STONES;
    if (Array.isArray(S) && S.length) return S;
    return (C.ISLANDS || []).filter(i => i.w < 5 && i.d < 5).map(i => ({ id: i.id, x: i.x, y: i.top, z: i.z, r: Math.max(i.w, i.d) / 2 }));
  };
  function stoneAt(x, y, z) {
    for (const s of stones()) {
      const top = s.y ?? s.top ?? 0, r = s.r ?? (Math.max(s.w || 0, s.d || 0) / 2 || 1.5);
      if (Math.abs(y - top) < 0.6 && Math.hypot(x - s.x, z - s.z) <= r + 0.35) return { id: s.id, x: s.x, y: top, z: s.z, r };
    }
    return null;
  }
  // A pool of puffs (made on the first landing, so the courtyard pays nothing): each is two dust discs, a Points of pebbles and a Points of
  // drifting dust. The pebbles are pure functions of the time since the landing (an arc under gravity; one that comes down on the stone sticks
  // there and fades, one that comes down past the edge keeps falling and fades on the way): no per-particle state.
  const PUFFS = 6, PEBBLES = 12, DRIFT = 8, G = 9.8;
  const puffs = [];
  const pnow = () => performance.now() / 1000;
  function makePuff() {
    const g = new THREE.Group(); g.name = 'stonedust'; g.userData.cat = 'pickups'; g.visible = false;
    const M = dustMatFor();
    const disc = () => { const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), M.clone()); m.renderOrder = 2; return m; };
    const d1 = disc(), d2 = disc();
    const P = { g, d1, d2, born: -1, p: null };   // p: { lx, lz, r, air, rot }  (the landing spot relative to the stone's centre)
    const sphere = new THREE.Sphere(new THREE.Vector3(0, -1, 0), 8);
    const pebble = (i) => {   // one pebble's arc: the start, the velocity, when it comes back down to the top, and whether that is on the stone
      const q = P.p, a = rand(i + 1, 11) * 6.283, boost = q.air ? 1.3 : 1;
      const h = (0.7 + rand(i + 1, 12) * 1.9) * boost, vy = (1.4 + rand(i + 1, 13) * 2) * boost, y0 = 0.12;
      const tl = (vy + Math.sqrt(vy * vy + 2 * G * y0)) / G;
      const x = q.lx + Math.cos(a) * 0.15, z = q.lz + Math.sin(a) * 0.15;
      const xl = x + Math.cos(a) * h * tl, zl = z + Math.sin(a) * h * tl;
      return { a, h, vy, y0, tl, x, z, onStone: Math.hypot(xl, zl) < q.r - 0.08 };
    };
    const pebbles = motes(PEBBLES, { size: 0.13, color: PEBBLE_COLOR, additive: false, sphere, place: (i, tt, p) => {
      if (!P.p || (P.p.air ? 0 : 4) > i) { p.set(0, -50, 0); return 0; }   // (8 pebbles after a plain jump, 12 after an air jump)
      const u = tt - P.born, k = pebble(i);
      if (u < 0) { p.set(0, -50, 0); return 0; }
      if (k.onStone && u > k.tl) { p.set(k.x + Math.cos(k.a) * k.h * k.tl, 0.03, k.z + Math.sin(k.a) * k.h * k.tl); return Math.max(0, 1 - (u - k.tl) / 0.9); }
      p.set(k.x + Math.cos(k.a) * k.h * u, k.y0 + k.vy * u - 0.5 * G * u * u, k.z + Math.sin(k.a) * k.h * u);
      return u > k.tl ? Math.max(0, 1 - (u - k.tl) / 0.8) : 1;   // past the edge: fading as it falls into the void
    } });
    const drift = motes(DRIFT, { size: 0.5, color: DRIFT_COLOR, additive: false, sphere, place: (i, tt, p) => {
      if (!P.p) { p.set(0, -50, 0); return 0; }
      const u = tt - P.born, life = P.p.air ? 1.4 : 1.1, q = u / life;
      if (u < 0 || q >= 1) { p.set(0, -50, 0); return 0; }
      const a = rand(i + 1, 21) * 6.283, sp = (0.8 + rand(i + 1, 22) * 0.9) * (P.p.air ? 1.3 : 1), rr = 0.25 + sp * u * (1 - 0.4 * q);
      p.set(P.p.lx + Math.cos(a) * rr, 0.15 + u * (0.3 + rand(i + 1, 23) * 0.25), P.p.lz + Math.sin(a) * rr);
      return 0.3 * (1 - q) * Math.min(1, q * 6);
    } });
    g.add(d1, d2, pebbles, drift);
    P.pebbles = pebbles; P.drift = drift;
    scene.add(g);
    return P;
  }
  function tickPuff(P) {
    if (P.born < 0) return;
    const u = pnow() - P.born, life = P.p.air ? 1.9 : 1.6;
    if (u >= life) { P.born = -1; P.p = null; P.g.visible = false; return; }
    const r0 = P.p.r * (P.p.air ? 1.25 : 1.0);
    for (const [d, delay, sc] of [[P.d1, 0, 1], [P.d2, 0.07, 0.72]]) {
      const k = Math.max(0, Math.min(1, (u - delay) / 0.8)), e = 1 - (1 - k) * (1 - k);
      d.visible = k > 0 && k < 1;
      d.scale.setScalar(Math.max(0.01, r0 * (0.35 + 1.75 * e) * sc));
      d.material.opacity = 0.62 * (1 - k) * (1 - k) * Math.min(1, k * 10);
      d.position.set(P.p.lx * (1 - e * 0.6), 0.06 + e * 0.12 + (sc < 1 ? 0.03 : 0), P.p.lz * (1 - e * 0.6));
    }
  }
  function scuff(pos, mine, air) {
    sfx?.play?.('impact_small', { pos: [pos[0], pos[1] + 0.2, pos[2]], vol: mine ? 0.45 : 0.3, rate: air ? 0.85 : 1.1, jitter: 0.08 });
    if (!mine) return;
    // ours: a scrape of rock dust under the impact and two or three pebble clicks after it (synthesized; no sound file)
    const ctx = sfx?.ctx, bus = sfx?.sfxBus;
    if (!ctx || !bus || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + 0.01;
    const noise = (at, dur, type, f, Q, gain) => {
      const n = ctx.createBufferSource(), buf = ctx.createBuffer(1, Math.max(8, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
      const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = Q;
      const g = ctx.createGain(); g.gain.value = gain;
      n.buffer = buf; n.connect(flt).connect(g).connect(bus); n.start(at);
    };
    noise(t0, air ? 0.22 : 0.15, 'lowpass', 900, 0.7, air ? 0.22 : 0.16);
    for (let i = 0, n = air ? 3 : 2; i < n; i++) noise(t0 + 0.1 + i * (0.09 + Math.random() * 0.12), 0.014, 'bandpass', 2600 + Math.random() * 1800, 2.5, 0.09);
  }
  function landed(pos, { air = false, mine = false } = {}) {
    const x = pos.x ?? pos[0], y = pos.y ?? pos[1] ?? 0, z = pos.z ?? pos[2];
    const s = stoneAt(x, y, z);
    if (!s) return null;
    if (!puffs.length) for (let i = 0; i < PUFFS; i++) puffs.push(makePuff());
    let P = puffs.find(q => q.born < 0) || puffs.reduce((a, b) => (a.born < b.born ? a : b));
    P.born = pnow(); P.p = { lx: x - s.x, lz: z - s.z, r: s.r, air: !!air };
    P.g.position.set(s.x, s.y, s.z); P.g.rotation.y = 0; P.g.visible = true;
    P.d1.rotation.z = rand(P.born * 7, 31) * 6.283; P.d2.rotation.z = rand(P.born * 7, 32) * 6.283;
    tickPuff(P);
    scuff([x, y, z], mine, air);
    return s;
  }
  function dropPuffs() { for (const P of puffs) { P.g.removeFromParent(); P.pebbles.geometry.dispose(); P.drift.geometry.dispose(); } puffs.length = 0; }

  buildPads();

  return {
    onMessage(msg) {
      switch (msg.t) {
        case 'welcome': if (Array.isArray(msg.pads)) { padList = msg.pads; buildPads(); }   // falls through: the welcome's runes too
        // eslint-disable-next-line no-fallthrough
        case 'snap': if (Array.isArray(msg.runes)) { for (const r of msg.runes) if (r && r.i != null) applyRune(r); } break;
        case 'runeTaken': runeTaken(msg); break;
        case 'pad': padLaunch(msg); break;
      }
    },
    update(dt) {
      t += dt;
      for (const v of runes.values()) updateRune(v, dt);
      for (const p of pads) updatePad(p);
      for (const P of puffs) tickPuff(P);
    },
    landed,                       // round 24: ([x, y, z], { air, mine }) -> the stepping stone landed on, or null
    setStones(list) { stoneList = Array.isArray(list) ? list : null; },
    rebuild() { for (const v of runes.values()) drop(v); runes.clear(); buildPads(); },
    clear() { for (const v of runes.values()) drop(v); runes.clear(); for (const p of pads) { p.g.removeFromParent(); p.draft.geometry.dispose(); p.arc?.geometry.dispose(); } pads.length = 0; dropPuffs(); },
    // tests
    _state: () => ({ runes: [...runes.values()].map(v => ({ i: v.i, type: v.type, up: v.up, x: v.x, z: v.z })), pads: pads.length, stones: stones().length, puffs: puffs.filter(P => P.born >= 0).length }),
  };
}
