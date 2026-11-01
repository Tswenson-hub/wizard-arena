// The end-of-match podium recap (characters track, round 16). Ten seconds after a match ends: a stage of KayKit castle pieces with
// three stepped plinths (1st in the middle and highest, 2nd on the left, 3rd on the right), the top three's real bodies on them
// (the Mage tinted by their spells, a Skeleton for a bot) emoting by place, a camera that dollies in on the winner and then frames
// all three, and an overlay with each name, place, K/D and accolades. 4th and below get a line at the bottom.
//
// API (main.js):
//   Podium.preload()                            load the stage pieces ahead (they're the castle's own models: from the cache)
//   Podium.start(msg, { renderer, scene, onEnd })  play the recap for a {t:'recap'} message; `scene` lends its sky
//   Podium.active()                             true while it plays: render with Podium.frame(dt) instead of the arena
//   Podium.frame(dt)                            advance and draw (uses `renderer`)
//   Podium.stop()                               end it now (the rematch countdown started, the player left); calls onEnd once
// The message: { t: 'recap', duration?: 10, top: [{ name, place, body, loadout, color, kills, deaths, accolades: [{ icon, title,
// value }] }, ...], rest: [{ name, place, kills, deaths }] }. Missing fields fall back (no accolades, the Mage, the default loadout).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { makeWizardBody, emoteClips, BODY_SCALE, BODY_TOP, looksReady } from './looks.js';
import * as C from '../shared/constants.js';

const KIT = './models/castle/';
const PIECES = ['floor_foundation_allsides', 'floor_tile_large', 'wall_arched', 'wall_pillar', 'pillar_decorated', 'banner_white', 'torch_mounted'];
// The plinths: x (2nd on the viewer's left), top height and width (m).
const PLINTHS = { 1: { x: 0, h: 1.25, w: 1.7 }, 2: { x: -2.15, h: 0.8, w: 1.5 }, 3: { x: 2.15, h: 0.45, w: 1.5 } };
const MEDAL = { 1: 0xffc857, 2: 0xd8dde6, 3: 0xd08a52 };
const PLACE = { 1: '1st', 2: '2nd', 3: '3rd' };
const DURATION = 10;

let pieces = null, loading = null;
export function preload() {
  if (loading) return loading;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const tex = new THREE.TextureLoader().load(KIT + 'dungeon_texture.webp');
  tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0 });
  loading = Promise.all(PIECES.map(n => loader.loadAsync(KIT + n + '.glb').then(g => {
    g.scene.traverse(o => { if (o.isMesh) { o.material = mat; o.castShadow = true; o.receiveShadow = true; } });
    return [n, g.scene];
  }).catch(() => [n, null]))).then(list => { pieces = Object.fromEntries(list); return pieces; });
  return loading;
}

// A kit piece, scaled to the castle (or stretched to `size` [w, h, d] m on its bounding box), its base at y 0.
function piece(name, size) {
  const src = pieces?.[name];
  if (!src) return new THREE.Group();
  const o = src.clone(true);
  o.scale.setScalar(BODY_SCALE);
  const box = new THREE.Box3().setFromObject(o), dim = box.getSize(new THREE.Vector3());
  if (size) o.scale.set(BODY_SCALE * size[0] / dim.x, BODY_SCALE * size[1] / dim.y, BODY_SCALE * size[2] / dim.z);
  const b2 = new THREE.Box3().setFromObject(o), c = b2.getCenter(new THREE.Vector3());
  const g = new THREE.Group(); o.position.set(-c.x, -b2.min.y, -c.z); g.add(o);
  return g;
}

let dotTex = null;
function dot() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return (dotTex = new THREE.CanvasTexture(c));
}

// A soft glow disc on a plinth top, and a ring of rising sparkles.
function glow(color, r, n) {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: dot(), color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  disc.position.y = 0.02; g.add(disc);
  const geo = new THREE.BufferGeometry(), pos = new Float32Array(n * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: dot(), color, size: 0.12, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.frustumCulled = false; g.add(pts);
  const seed = Array.from({ length: n }, (_, i) => [Math.random() * 6.283, Math.random(), 0.3 + Math.random() * 0.5]);
  g.userData.tick = (t) => {
    for (let i = 0; i < n; i++) {
      const [a, ph, rr] = seed[i], k = (t * 0.35 + ph) % 1;
      pos[i * 3] = Math.cos(a + t * 0.8) * rr * r; pos[i * 3 + 1] = k * 2.4; pos[i * 3 + 2] = Math.sin(a + t * 0.8) * rr * r;
    }
    geo.attributes.position.needsUpdate = true;
    disc.material.opacity = 0.65 + 0.2 * Math.sin(t * 3);
  };
  return g;
}

// Confetti over the winner: little coloured squares tumbling down, recycled at the top.
function confetti(n, colors) {
  const geo = new THREE.PlaneGeometry(0.07, 0.11);
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const st = [], col = new THREE.Color(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    st.push({ x: (Math.random() - 0.5) * 4.5, y: 2 + Math.random() * 5, z: (Math.random() - 0.5) * 2.5, v: 0.9 + Math.random() * 0.9, sp: Math.random() * 8, ph: Math.random() * 6 });
    mesh.setColorAt(i, col.setHex(colors[i % colors.length]));
  }
  mesh.frustumCulled = false;
  mesh.userData.tick = (t, dt) => {
    for (let i = 0; i < n; i++) {
      const c = st[i];
      c.y -= c.v * dt; if (c.y < 0.05) c.y += 5.5;
      p.set(c.x + Math.sin(t * 1.3 + c.ph) * 0.25, c.y, c.z);
      q.setFromEuler(e.set(t * c.sp, t * c.sp * 0.7, c.ph));
      mesh.setMatrixAt(i, m.compose(p, q, s));
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  return mesh;
}

// ---------------------------------------------------------------- the recap

let cur = null;
export const active = () => !!cur;

export function start(msg, { renderer, scene: arena, onEnd } = {}) {
  stop(true);
  const top = (msg.top || []).slice(0, 3).map((p, i) => ({ ...p, place: p.place || i + 1 }));
  if (!top.length || !renderer) { onEnd?.(); return false; }
  document.exitPointerLock?.();
  const dur = msg.duration || DURATION;
  const scene = new THREE.Scene();
  scene.background = arena?.background || new THREE.Color(0x2a2238);
  scene.environment = arena?.environment || null;
  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x40324a, 1.1));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.6); sun.position.set(3, 8, 6); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -2, near: 1, far: 20 });
  scene.add(sun);

  // the stage: a stone floor, a wall of arches with pillars, torches, and the three plinths with banners in each player's colour
  const stage = new THREE.Group(); scene.add(stage);
  for (let x = -3; x <= 3; x++) for (let z = -2; z <= 1; z++) { const f = piece('floor_tile_large'); f.position.set(x * 3.33, 0, z * 3.33); stage.add(f); }
  for (let x = -3; x <= 3; x++) { const w = piece('wall_arched'); w.position.set(x * 3.33, 0, -2.6); stage.add(w); }
  for (const x of [-5, 5]) { const p = piece('pillar_decorated'); p.position.set(x, 0, -2.0); stage.add(p); }
  for (const x of [-3.3, 3.3]) {
    const t = piece('torch_mounted'); t.position.set(x, 1.9, -2.15); stage.add(t);
    const l = new THREE.PointLight(0xff9a40, 4, 6); l.position.set(x, 2.4, -1.8); stage.add(l);
  }
  const bodies = [], ticks = [];
  const emote = emoteClips();
  for (const p of top) {
    const P = PLINTHS[p.place] || PLINTHS[3];
    const plinth = piece('floor_foundation_allsides', [P.w, P.h, P.w]); plinth.position.x = P.x; stage.add(plinth);
    const loadout = C.sanitizeLoadout?.(p.loadout) || { ...C.DEFAULT_LOADOUT };
    const body = makeWizardBody(loadout, { body: p.body || 'mage' });
    const color = p.color ?? body.look.color;
    const banner = piece('banner_white', [1.0, 2.2, 0.2]);
    banner.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.setHex(body.look.color).lerp(new THREE.Color(0xffffff), 0.25); } });
    banner.position.set(P.x, 1.0, -2.35); stage.add(banner);
    body.model.position.set(P.x, P.h, 0);
    body.model.rotation.y = P.x * -0.12;                 // turned a little towards the middle
    stage.add(body.model);
    const g = glow(p.place === 1 ? 0xffd86a : MEDAL[p.place], p.place === 1 ? 0.95 : 0.7, p.place === 1 ? 24 : 10);
    g.position.set(P.x, P.h, 0); stage.add(g); ticks.push(g.userData.tick);
    const mixer = new THREE.AnimationMixer(body.model);
    const skel = body.kind !== 'mage';
    const clip = p.place === 1 ? (skel ? emote.taunt : emote.cheer) : p.place === 2 ? emote.wave : emote.clap;
    const a = mixer.clipAction(clip); a.time = Math.random() * 0.3; a.play();
    if (clip === emote.clap && body.grip) body.grip.visible = false;     // the staff is tucked away to clap
    bodies.push({ p, P, body, mixer, color });
  }
  // the winner's spotlight and confetti in the top three's colours
  const spot = new THREE.SpotLight(0xffe2a0, 60, 14, 0.32, 0.5, 1.2);
  spot.position.set(0, 7.5, 3.5); spot.target.position.set(0, PLINTHS[1].h, 0); scene.add(spot, spot.target);
  const conf = confetti(180, [0xffc857, 0xff5c6a, 0x7fd8ff, 0x9cff50, 0xffffff, ...bodies.map(b => b.body.look.color)]);
  stage.add(conf); ticks.push(conf.userData.tick);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  const ui = overlay(top, msg.rest || [], dur, () => stop());
  cur = { scene, camera, renderer, bodies, ticks, ui, t: 0, dur, onEnd };
  frame(0);
  return true;
}

// The camera: from a mid shot, dolly in on the winner's face (0-2.8 s), pull back to frame all three (by 5 s), then drift.
const ease = (k) => k * k * (3 - 2 * k);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _l = new THREE.Vector3(), _m = new THREE.Vector3();
function cameraAt(t, cam) {
  const h1 = PLINTHS[1].h, head = h1 + 1.5;
  const close = [_a.set(0.35, head + 0.15, 2.4), _l.set(0, head - 0.05, 0)];
  const far = [_b.set(Math.sin(t * 0.15) * 0.6, 2.3, 6.6), _m.set(0, 1.75, 0)];
  if (t < 2.8) {
    const k = ease(t / 2.8);
    cam.position.set(0.2, head + 0.5, 6.0).lerp(close[0], k);
    cam.lookAt(new THREE.Vector3(0, head - 0.2, 0).lerp(close[1], k));
  } else {
    const k = ease(Math.min(1, (t - 2.8) / 2.2));
    cam.position.copy(close[0]).lerp(far[0], k);
    cam.lookAt(close[1].clone().lerp(far[1], k));
  }
}

export function frame(dt) {
  const c = cur;
  if (!c) return;
  c.t += dt;
  const size = c.renderer.getSize(new THREE.Vector2());
  c.camera.aspect = size.x / Math.max(1, size.y); c.camera.updateProjectionMatrix();
  cameraAt(c.t, c.camera);
  for (const b of c.bodies) { b.mixer.update(dt); b.body.updateGrip?.(0); }
  for (const tick of c.ticks) tick(c.t, dt);
  c.renderer.render(c.scene, c.camera);
  c.ui.update(c.t, c.bodies, c.camera, size);
  if (c.t >= c.dur) stop();
}

export function stop(silent) {
  const c = cur;
  if (!c) return;
  cur = null;
  c.ui.remove();
  for (const b of c.bodies) b.mixer.stopAllAction();
  c.scene.traverse(o => { if (o.isPoints || o.isInstancedMesh) { o.geometry.dispose(); o.material.dispose(); } });
  if (!silent) c.onEnd?.();
}

// ---------------------------------------------------------------- the overlay

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const hex = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');
// '1 kill', '2 kills'; and a value from the server reading '1 kills' or '1 blocks' loses its plural s
const count = (n, word) => `<b>${n ?? 0}</b> ${word}${(n ?? 0) === 1 ? '' : 's'}`;
const one = (v) => String(v).replace(/(^|\D)1 (\w+?)s\b/g, '$11 $2');
// Accolade icons: a short symbol from the server, else one by id, else a star.
const ICONS = { kills: '✷', damage: '✷', streak: '🔥', heal: '✚', healing: '✚', survivor: '⛨', blocks: '⛨', accuracy: '◎', props: '⬢', mvp: '★' };
const iconOf = (a) => (a.icon && [...a.icon].length <= 2) ? a.icon : ICONS[a.icon || a.id] || '★';

function overlay(top, rest, dur, onSkip) {
  if (!document.querySelector('link[data-recap-css]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = './css/recap.css'; l.dataset.recapCss = '1';
    document.head.appendChild(l);
  }
  const el = document.createElement('div');
  el.className = 'recap';
  const tag = (p) => `<div class="rc-tag rc-p${p.place}" style="--medal:${hex(MEDAL[p.place])};--col:${hex(p.color ?? 0xffffff)}">
      <div class="rc-place">${PLACE[p.place]}</div>
      <div class="rc-name">${esc(p.name)}</div>
      <div class="rc-kd">${count(p.kills, 'kill')} · ${count(p.deaths, 'death')}</div>
      <div class="rc-accs">${(p.accolades || []).slice(0, 2).map(a => `<div class="rc-acc"><i>${esc(iconOf(a))}</i><span>${esc(a.title)}</span>${a.value != null ? `<em>${esc(one(a.value))}</em>` : ''}</div>`).join('')}</div>
    </div>`;
  el.innerHTML = `<div class="rc-head">Match over</div>
    <button type="button" class="rc-skip">Skip ›</button>
    ${top.map(tag).join('')}
    ${rest.length ? `<div class="rc-rest">${rest.map(r => `<span>${PLACE[r.place] || `${r.place}th`} <b>${esc(r.name)}</b> ${r.kills ?? 0}/${r.deaths ?? 0}</span>`).join('')}</div>` : ''}
    <div class="rc-bar"><i></i></div>`;
  document.body.appendChild(el);
  document.body.classList.add('recap-on');
  el.querySelector('.rc-skip').addEventListener('click', (e) => { e.stopPropagation(); onSkip(); });
  const tags = [...el.querySelectorAll('.rc-tag')], bar = el.querySelector('.rc-bar i');
  const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onSkip(); } };
  addEventListener('keydown', onKey, true);
  const v = new THREE.Vector3();
  return {
    update(t, bodies, cam, size) {
      bar.style.width = `${Math.min(100, t / dur * 100)}%`;
      bodies.forEach((b, i) => {
        const tg = tags[i];
        // a name plate on the plinth's front face; when that's below the screen (the winner's close-up), at the bottom instead
        v.set(b.P.x, b.P.h * 0.55, b.P.w / 2 + 0.05).project(cam);
        const on = v.z < 1 && Math.abs(v.x) < 1.1;
        // 2nd and 3rd join once the camera has pulled back (their tags would crowd the winner's close-up)
        const show = on && (b.p.place === 1 || t > 3.6);
        tg.classList.toggle('on', show);
        const x = (v.x + 1) / 2 * size.x, y = (1 - v.y) / 2 * size.y, h = tg.offsetHeight;
        if (on) tg.style.transform = y + h / 2 > size.y - 16 ? `translate(${size.x / 2}px, ${size.y - 24}px) translate(-50%, -100%)`
          : `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      });
    },
    remove() { removeEventListener('keydown', onKey, true); el.remove(); document.body.classList.remove('recap-on'); },
  };
}

// load the stage pieces once the page has settled (they're the castle's models, normally already in the HTTP cache)
looksReady().then(() => setTimeout(preload, 1500));
