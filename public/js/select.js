// Wizard picker (characters track). API (see docs/agents/characters.md):
//   mountWizardPicker(container, { selected, onChange(id) }) -> { set(id), destroy() }
// One card per wizard: a live 3D preview (idle, slowly turning), name, title, role and the five
// spells of its kit. Click or Enter/Space picks; arrow keys move between cards.
// Previews only run while a picker is on screen.
import * as THREE from 'three';
import { WIZARDS, KIT_SLOTS, DEFAULT_WIZARD, isWizard } from '../shared/wizards.js';
import { SPELLBOOK } from '../shared/constants.js';
import { makeWizardBody, looksReady } from './looks.js';

const SLOT_KEYS = { primary: 'LMB', power: 'RMB', mobility: 'E', guard: 'Space', utility: 'F' };
const FPS = 30;
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const prettyId = (id) => id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------------------------------------------------------------- previews
// Each mounted picker has one transparent WebGL canvas laid over its cards; every card's preview is
// drawn into that card's rectangle with a scissored viewport (no per-card contexts, no pixel copies).

const stages = new Set();       // mounted pickers whose previews are on screen
let raf = 0, last = 0;

function makeStage(root) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = 'wp-stage';
  root.appendChild(renderer.domElement);
  return { root, renderer, pvs: [] };
}

function makePreview(id, el) {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x3a2a40, 1.6));
  const key = new THREE.DirectionalLight(0xfff0dd, 2.2); key.position.set(2, 3, 3); scene.add(key);
  const rim = new THREE.DirectionalLight(WIZARDS[id].color, 2.5); rim.position.set(-2, 2, -2.5); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
  camera.position.set(0, 1.2, 4.7);
  camera.lookAt(0, 0.98, 0);
  const pv = { id, el, scene, camera, body: null, mixer: null, actions: null, gone: false };
  looksReady().then(() => {
    if (pv.gone) return;
    const { model, clips } = makeWizardBody(id);
    pv.body = model;
    model.rotation.y = Math.random() * 0.6 - 0.3;
    scene.add(model);
    pv.mixer = new THREE.AnimationMixer(model);
    pv.actions = {
      idle: pv.mixer.clipAction(clips.idle).setLoop(THREE.LoopPingPong),
      cast: pv.mixer.clipAction(clips.cast_fast).setLoop(THREE.LoopOnce),
    };
    pv.actions.idle.timeScale = 0.6;
    pv.actions.cast.clampWhenFinished = true;
    pv.actions.idle.play();
    pv.mixer.addEventListener('finished', () => pv.actions.cast.crossFadeTo(pv.actions.idle.reset().play(), 0.35, false));
    el.classList.add('ready');
  });
  return pv;
}

// A little flourish when a wizard is picked.
function celebrate(pv) {
  if (!pv?.actions) return;
  const { idle, cast } = pv.actions;
  cast.reset().setEffectiveWeight(1).play();
  idle.crossFadeTo(cast, 0.2, false);
}

function renderStage(st, dt) {
  const { renderer, root } = st;
  const W = root.clientWidth, H = root.clientHeight;
  if (!W || !H) return;
  const dpr = Math.min(2, devicePixelRatio);
  if (renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
  const size = renderer.getSize(new THREE.Vector2());
  if (size.x !== W || size.y !== H) renderer.setSize(W, H, false);
  renderer.setScissorTest(false);
  renderer.clear();
  renderer.setScissorTest(true);
  const box = root.getBoundingClientRect();
  for (const pv of st.pvs) {
    if (!pv.body) continue;
    pv.mixer.update(dt);
    pv.body.rotation.y += dt * 0.55;
    const r = pv.el.getBoundingClientRect();
    const x = r.left - box.left, y = H - (r.bottom - box.top);
    if (!r.width || !r.height) continue;
    renderer.setViewport(x, y, r.width, r.height);
    renderer.setScissor(x, y, r.width, r.height);
    pv.camera.aspect = r.width / r.height; pv.camera.updateProjectionMatrix();
    renderer.render(pv.scene, pv.camera);
  }
}

function tick(now) {
  raf = 0;
  if (!stages.size) return;
  raf = requestAnimationFrame(tick);
  if (now - last < 1000 / FPS - 2) return;
  const dt = Math.min(0.1, (now - last) / 1000 || 1 / FPS);
  last = now;
  for (const st of stages) renderStage(st, dt);
}
const startLoop = () => { if (!raf && stages.size) { last = performance.now(); raf = requestAnimationFrame(tick); } };

// ---------------------------------------------------------------- picker

function cardHTML(w) {
  const spells = KIT_SLOTS.map(slot => {
    const id = w.kit[slot];
    const s = SPELLBOOK[id];
    return `<li${s?.blurb ? ` title="${esc(s.blurb)}"` : ''}><kbd>${SLOT_KEYS[slot]}</kbd><b>${esc(s?.name || prettyId(id))}</b>${s?.blurb ? `<span>${esc(s.blurb)}</span>` : ''}</li>`;
  }).join('');
  return `<div class="wp-head">
      <div class="wp-preview" aria-hidden="true"></div>
      <div class="wp-id">
        <div class="wp-name">${esc(w.name)}</div>
        <div class="wp-title">${esc(w.title)}</div>
        <div class="wp-role">${esc(w.role)}</div>
      </div>
      <span class="wp-check" aria-hidden="true">✓</span>
    </div>
    <ul class="wp-kit">${spells}</ul>`;
}

export function mountWizardPicker(container, { selected, onChange } = {}) {
  let current = isWizard(selected) ? selected : DEFAULT_WIZARD;
  const root = document.createElement('div');
  root.className = 'wizard-picker';
  const grid = document.createElement('div');
  grid.className = 'wp-grid';
  grid.setAttribute('role', 'radiogroup');
  grid.setAttribute('aria-label', 'Choose your wizard');
  root.appendChild(grid);
  const cards = {};
  const pvs = {};
  let stage = null;
  for (const w of Object.values(WIZARDS)) {
    const card = document.createElement('div');
    card.className = 'wp-card';
    card.dataset.wizard = w.id;
    card.setAttribute('role', 'radio');
    card.style.setProperty('--accent', hex(w.color));
    card.innerHTML = cardHTML(w);
    grid.appendChild(card);
    cards[w.id] = card;
    pvs[w.id] = makePreview(w.id, card.querySelector('.wp-preview'));
  }
  container.appendChild(root);

  const paint = () => {
    for (const [id, card] of Object.entries(cards)) {
      const on = id === current;
      card.classList.toggle('selected', on);
      card.setAttribute('aria-checked', on);
      card.tabIndex = on ? 0 : -1;
    }
  };
  paint();

  const pick = (id) => {
    if (!isWizard(id)) return;
    const changed = id !== current;
    current = id;
    paint();
    celebrate(pvs[id]);
    if (changed) onChange?.(id);
  };

  root.addEventListener('click', (e) => {
    const card = e.target.closest('.wp-card');
    if (card) { pick(card.dataset.wizard); card.focus({ preventScroll: true }); }
  });
  const ids = Object.keys(cards);
  root.addEventListener('keydown', (e) => {
    const card = e.target.closest('.wp-card');
    if (!card) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); pick(card.dataset.wizard); return; }
    // The grid is two columns wide unless it has collapsed to one.
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
    if (!step) return;
    e.preventDefault(); e.stopPropagation();
    const next = cards[ids[(ids.indexOf(card.dataset.wizard) + step + ids.length) % ids.length]];
    for (const c of Object.values(cards)) c.tabIndex = c === next ? 0 : -1;
    next.focus();
  });

  // Run the previews only while this picker is actually on screen. The WebGL canvas is made the first
  // time it shows, so a picker that is never opened costs nothing.
  const setVisible = (v) => {
    if (v && !stage) { stage = makeStage(root); stage.pvs = Object.values(pvs); }
    if (stage) v ? stages.add(stage) : stages.delete(stage);
    startLoop();
  };
  const io = new IntersectionObserver((entries) => setVisible(entries[entries.length - 1].isIntersecting));
  io.observe(root);

  return {
    set(id) { if (isWizard(id)) { current = id; paint(); } },
    destroy() {
      io.disconnect();
      setVisible(false);
      for (const pv of Object.values(pvs)) { pv.gone = true; pv.mixer?.stopAllAction(); }
      if (stage) { stage.renderer.dispose(); stage.renderer.forceContextLoss(); }
      root.remove();
    },
  };
}
