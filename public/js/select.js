// The spell builder (characters track, round 11). The hero picker it replaced is in git history (round 4-10).
import * as THREE from 'three';
import * as C from '../shared/constants.js';
import { makeWizardBody, looksReady, lookOf, clipsFor } from './looks.js';
import { spellPlay } from './spellanim.js';
import { loadSaved, saveSaved, MAX_SAVED } from './loadout-store.js';

const FPS = 30;
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ================================================================ the spell builder (round 11)
// mountSpellBuilder(container, { loadout, voice, onChange(loadout), onVoice(voice), footer }) ->
//   { set(loadout), setVoice(voice), footer, destroy() }
// Six slot rows of spell cards (C.LOADOUT_SLOTS; every id of C.SPELL_POOL[slot]), a live preview of the generic
// wizard tinted by the loadout's element mix that plays a hovered card's cast, the element mix and active combos,
// presets (the old kits), Randomize, three saved loadouts (loadout-store.js) and the voice. `footer`: an element
// (the name field and Join, say) placed in the bottom bar; the bar is also returned as `footer`.
// Keyboard: arrows move between cards (up/down change rows), Enter or Space picks, Tab leaves the grid.

// Raven Fantasy Icons (public/textures/icons/CREDITS.md), by spell; a spell not listed uses its own id.
const SPELL_ICON = {
  spark: 'fast', gale_shear: 'shear', glacial_skim: 'skim', hex_shards: 'hex', potion_toss: 'potion', meteor: 'heavy',
  sanguine_lash: 'lash', battering_ram: 'ram', toxic_flask: 'toxic', glacial_bulwark: 'bulwark', flask_step: 'flaskstep',
};
const iconOf = (id) => `/textures/icons/${SPELL_ICON[id] || id}.png`;
const firstSentence = (s) => (s || '').split(/(?<=\.)\s/)[0];
// Phases a hovered card demonstrates, in order of preference (a primary shows its magazine's shots in turn).
const DEMO = ['windup', 'cast', 'release', 'channel', 'loop', 'hold'];

function builderHTML() {
  return `<div class="sb-top">
      <div class="sb-group sb-presets" role="group" aria-label="Presets"><span class="sb-label">Presets</span>${C.PRESETS.map(p =>
        `<button type="button" class="sb-chip" data-preset="${p.id}" title="${esc(p.hero)}'s old kit: ${esc(C.LOADOUT_SLOTS.map(s => C.SPELLBOOK[p.loadout[s]]?.name).join(', '))}">${esc(p.name)}</button>`).join('')}
        <button type="button" class="sb-chip sb-random" data-random title="A random spell in every slot">🎲 Randomize</button></div>
      <div class="sb-group sb-saved" role="group" aria-label="Saved loadouts"><span class="sb-label">Saved</span>${Array.from({ length: MAX_SAVED }, (_, i) =>
        `<span class="sb-slotbtn" data-saved="${i}"><button type="button" class="sb-chip sb-load"></button><button type="button" class="sb-save" title="Save the current loadout here">Save</button></span>`).join('')}</div>
    </div>
    <div class="sb-main">
      <div class="sb-rows" role="grid" aria-label="Spells">${C.LOADOUT_SLOTS.map(slot => `
        <div class="sb-row" role="row" data-slot="${slot}">
          <div class="sb-slot" role="rowheader"><kbd>${esc(C.SLOT_INFO[slot].key)}</kbd><span>${esc(C.SLOT_INFO[slot].label)}</span></div>
          <div class="sb-cards" role="radiogroup" aria-label="${esc(C.SLOT_INFO[slot].label)}" style="--n:${C.SPELL_POOL[slot].length}">${C.SPELL_POOL[slot].map(cardHTMLFor).join('')}</div>
        </div>`).join('')}
      </div>
      <div class="sb-side">
        <div class="sb-preview" aria-hidden="true"><div class="sb-caption"></div></div>
        <div class="sb-summary">
          <div class="sb-mixbar" aria-hidden="true"></div>
          <div class="sb-mix"></div>
          <div class="sb-combos"></div>
        </div>
      </div>
    </div>
    <div class="sb-foot">
      <div class="sb-group sb-voice" role="radiogroup" aria-label="Voice"><span class="sb-label">Voice</span>${C.VOICES.map(v =>
        `<button type="button" class="sb-chip" role="radio" data-voice="${v}">${v === 'male' ? 'Male' : 'Female'}</button>`).join('')}</div>
      <div class="sb-extra"></div>
    </div>
    <div class="sb-tip" role="tooltip" hidden></div>`;
}

function cardHTMLFor(id) {
  const s = C.spellInfo(id);
  const stats = [['dmg', 'Damage', s.damage], ['cd', 'Cooldown', s.cooldown], ['rng', s.range ? 'Range' : 'Duration', s.range || s.duration], ['wu', 'Wind-up', s.windup]]
    .filter(([, , v]) => v).map(([k, t, v]) => `<span class="st-${k}" title="${t}">${esc(v)}</span>`).join('');
  const tags = s.tags.map(t => `<i${t === 'Combo' ? ' class="combo"' : ''}>${esc(t)}</i>`).join('');
  return `<div class="sb-card" role="radio" tabindex="-1" data-spell="${id}" aria-label="${esc(s.name)}" style="--el:${hex(s.color)}">
      <div class="sb-head"><img class="sb-icon" src="${iconOf(id)}" alt="" draggable="false"><b class="sb-name">${esc(s.name)}</b></div>
      <div class="sb-blurb">${esc(firstSentence(s.blurb))}</div>
      <div class="sb-stats">${stats}</div>
      <div class="sb-tags">${tags}</div>
    </div>`;
}

function tipHTML(id) {
  const s = C.spellInfo(id);
  const row = (k, v) => v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : '';
  return `<div class="tip-head" style="--el:${hex(s.color)}"><img src="${iconOf(id)}" alt=""><div><b>${esc(s.name)}</b><span>${esc(C.ELEMENTS[s.element].name)} · ${esc(C.SLOT_INFO[s.slot].label)} (${esc(C.SLOT_INFO[s.slot].key)})</span></div></div>
    <p>${esc(s.blurb)}</p>
    <dl>${row('Damage', s.damage)}${row('Cooldown', s.cooldown)}${row('Range', s.range)}${row('Duration', s.duration)}${row('Wind-up', s.windup)}</dl>
    <div class="sb-tags">${s.tags.map(t => `<i${t === 'Combo' ? ' class="combo"' : ''}>${esc(t)}</i>`).join('')}</div>
    ${s.combos.map(c => `<div class="tip-combo"><b>Combo: ${esc(c.name)}</b> with ${esc(c.spells.filter(x => x !== id).map(x => C.SPELLBOOK[x].name).join(', '))}. ${esc(c.text)}</div>`).join('')}`;
}

// ---------------------------------------------------------------- the preview (one small WebGL canvas)
function makeBuilderPreview(el) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  el.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x3a2a40, 1.6));
  const key = new THREE.DirectionalLight(0xfff0dd, 2.2); key.position.set(2, 3, 3); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 2.5); rim.position.set(-2, 2, -2.5); scene.add(rim);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
  const pv = { renderer, scene, camera, rim, body: null, mixer: null, idle: null, cur: null, until: 0, demo: null, raf: 0, last: 0, visible: false, gone: false, yaw: 0.5 };
  let ready = false;
  looksReady().then(() => { ready = true; pv.onReady?.(); });

  pv.setLoadout = (lo) => {
    if (!ready) { pv.onReady = () => pv.setLoadout(lo); return; }
    const body = makeWizardBody(lo);
    if (pv.body) { scene.remove(pv.body.model); pv.mixer.stopAllAction(); }
    pv.body = body;
    body.model.rotation.y = pv.yaw;
    scene.add(body.model);
    pv.mixer = new THREE.AnimationMixer(body.model);
    pv.idle = pv.mixer.clipAction(body.clips.idle).setLoop(THREE.LoopPingPong);
    pv.idle.timeScale = 0.6;
    pv.idle.play();
    pv.cur = pv.idle;
    rim.color.setHex(body.look.color);
    el.style.setProperty('--el', hex(body.look.color));
    if (pv.demo) pv.play(pv.demo.id, pv.demo.lo);
  };
  // Play spell `id`'s cast (from the clip set of loadout `lo`, which has it equipped), on repeat while hovered.
  pv.play = (id, lo) => {
    pv.demo = id ? { id, lo, step: 0, next: 0 } : null;
    if (!id && pv.cur !== pv.idle && pv.idle) { pv.cur.crossFadeTo(pv.idle.reset().play(), 0.3, false); pv.cur = pv.idle; }
  };
  function demoStep(now) {
    const d = pv.demo;
    if (!d || !pv.mixer || now < d.next) return;
    const clips = clipsFor(d.lo);
    const shots = Object.keys(clips).filter(k => k.startsWith(d.id) && /\d$/.test(k) && k.length === d.id.length + 1).length;
    let args = shots ? spellPlay(d.id, 'shot', (d.step % shots) + 1) : null;
    for (const ph of DEMO) if (!args) args = spellPlay(d.id, ph);
    const [k, dur, scale, from] = args || ['cast_fast', 0.9, 1.6, 0.3];
    const clip = clips[k] || pv.body.clips[k];
    if (!clip) { d.next = Infinity; return; }
    const a = pv.mixer.clipAction(clip);
    a.reset(); a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; a.time = from; a.setEffectiveTimeScale(scale); a.setEffectiveWeight(1); a.play();
    if (pv.cur && pv.cur !== a) pv.cur.crossFadeTo(a, 0.08, false);
    pv.cur = a;
    const len = Math.min(dur > 10 ? 1.6 : dur, (clip.duration - from) / scale);
    d.step++;
    // a magazine's shots follow each other quickly; anything else rests in idle before repeating
    const rest = shots && d.step % shots ? 0.25 : 0.9;
    d.back = now + len * 1000;
    d.next = d.back + rest * 1000;
  }
  function frame(now) {
    pv.raf = 0;
    if (!pv.visible || pv.gone) return;
    pv.raf = requestAnimationFrame(frame);
    if (now - pv.last < 1000 / FPS - 2) return;
    const dt = Math.min(0.1, (now - pv.last) / 1000 || 1 / FPS);
    pv.last = now;
    const W = el.clientWidth, H = el.clientHeight;
    if (!W || !H || !pv.body) return;
    const dpr = Math.min(2, devicePixelRatio);
    if (renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
    const sz = renderer.getSize(new THREE.Vector2());
    if (sz.x !== W || sz.y !== H) renderer.setSize(W, H, false);
    demoStep(now);
    const d = pv.demo;
    if (d && d.back && now > d.back && pv.cur !== pv.idle) { pv.cur.crossFadeTo(pv.idle.reset().play(), 0.25, false); pv.cur = pv.idle; d.back = 0; }
    pv.mixer.update(dt);
    // a slow sway around a three-quarter view, so casts read from the front
    pv.body.model.rotation.y = pv.yaw + Math.sin(now / 2400) * 0.35;
    camera.aspect = W / H;
    // frame the whole body, a staff raised overhead and arms flung wide (3 m tall, 2.1 m wide) whatever the panel's shape
    const span = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.position.set(0, 1.15, Math.max(3.0 / span, 2.1 / (span * camera.aspect)));
    camera.lookAt(0, 0.95, 0);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
  pv.setVisible = (v) => { pv.visible = v; if (v && !pv.raf) { pv.last = performance.now(); pv.raf = requestAnimationFrame(frame); } };
  pv.destroy = () => { pv.gone = true; pv.mixer?.stopAllAction(); renderer.dispose(); renderer.forceContextLoss(); };
  return pv;
}

// ---------------------------------------------------------------- the builder

export function mountSpellBuilder(container, { loadout, voice, onChange, onVoice, footer } = {}) {
  let cur = C.sanitizeLoadout(loadout) || { ...C.DEFAULT_LOADOUT };
  let vox = C.sanitizeVoice(voice);
  const root = document.createElement('div');
  root.className = 'spell-builder';
  root.innerHTML = builderHTML();
  container.appendChild(root);
  const $ = (s) => root.querySelector(s), $$ = (s) => [...root.querySelectorAll(s)];
  const tip = $('.sb-tip');
  const pv = makeBuilderPreview($('.sb-preview'));
  const caption = $('.sb-caption');
  if (footer) $('.sb-extra').appendChild(footer);
  let saved = loadSaved();
  let focusCard = null;      // the card with tabindex 0

  const paint = () => {
    for (const card of $$('.sb-card')) {
      const slot = card.closest('.sb-row').dataset.slot, on = cur[slot] === card.dataset.spell;
      card.classList.toggle('selected', on);
      card.setAttribute('aria-checked', on);
    }
    if (!focusCard || !root.contains(focusCard)) focusCard = $(`.sb-row[data-slot="${C.LOADOUT_SLOTS[0]}"] .sb-card.selected`);
    for (const card of $$('.sb-card')) card.tabIndex = card === focusCard ? 0 : -1;
    for (const b of $$('[data-preset]')) b.classList.toggle('active', C.sameLoadout(C.PRESETS.find(p => p.id === b.dataset.preset).loadout, cur));
    for (const b of $$('[data-voice]')) { const on = b.dataset.voice === vox; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); }
    $$('[data-saved]').forEach((el, i) => {
      const s = saved[i], load = el.querySelector('.sb-load');
      load.textContent = s ? s.name : `Slot ${i + 1}: empty`;
      load.disabled = !s;
      load.title = s ? `Load: ${C.LOADOUT_SLOTS.map(k => C.SPELLBOOK[s.loadout[k]]?.name).join(', ')}` : 'Nothing saved here yet';
      load.classList.toggle('active', !!s && C.sameLoadout(s.loadout, cur));
      el.querySelector('.sb-save').title = s ? `Save the current loadout here (replaces ${s.name})` : 'Save the current loadout here';
    });
    // the summary: element mix (a bar and counts) and active combos
    const look = lookOf(cur);
    root.style.setProperty('--accent', hex(look.color));
    $('.sb-mixbar').innerHTML = look.mix.map(e => `<i style="flex:${e.count};background:${hex(C.ELEMENTS[e.element].color)}"></i>`).join('');
    $('.sb-mix').innerHTML = look.mix.map(e => `<span style="--el:${hex(C.ELEMENTS[e.element].color)}"><b>${e.count}</b> ${esc(C.ELEMENTS[e.element].name)}</span>`).join('');
    const combos = C.combosOf(cur);
    $('.sb-combos').innerHTML = `<h4>Combos active</h4>` + (combos.length
      ? combos.map(c => `<div class="sb-combo"><b>${esc(c.name)}</b> <span>${esc(c.spells.map(x => C.SPELLBOOK[x].name).join(' + '))}</span><p>${esc(c.text)}</p></div>`).join('')
      : `<p class="sb-none">None. Cards tagged <i class="combo">Combo</i> work together.</p>`);
  };

  const setLoadout = (lo, { silent } = {}) => {
    const clean = C.sanitizeLoadout(lo);
    if (!clean) return;
    const changed = !C.sameLoadout(clean, cur);
    cur = clean;
    paint();
    pv.setLoadout(cur);
    if (changed && !silent) onChange?.({ ...cur });
  };
  const pick = (card) => {
    const slot = card.closest('.sb-row').dataset.slot;
    focusCard = card;
    setLoadout({ ...cur, [slot]: card.dataset.spell });
  };

  // hover / focus: the tooltip, and the preview plays the card's cast (as if it were equipped)
  let tipFor = null;
  const showTip = (card) => {
    if (!card) { tip.hidden = true; tipFor = null; pv.play(null); caption.textContent = ''; return; }
    if (tipFor === card) return;
    tipFor = card;
    const id = card.dataset.spell, slot = card.closest('.sb-row').dataset.slot;
    tip.innerHTML = tipHTML(id);
    tip.hidden = false;
    const r = card.getBoundingClientRect(), box = root.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = r.left - box.left + r.width / 2 - tw / 2, y = r.bottom - box.top + 6;
    if (y + th > box.height - 4) y = r.top - box.top - th - 6;
    x = Math.max(4, Math.min(box.width - tw - 4, x));
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(Math.max(4, y))}px)`;
    pv.play(id, { ...cur, [slot]: id });
    caption.textContent = C.SPELLBOOK[id].name;
  };

  root.addEventListener('click', (e) => {
    const card = e.target.closest('.sb-card');
    if (card) { pick(card); card.focus({ preventScroll: true }); return; }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.preset) setLoadout(C.PRESETS.find(p => p.id === b.dataset.preset).loadout);
    else if ('random' in b.dataset) setLoadout(C.randomLoadout());
    else if (b.dataset.voice) { if (b.dataset.voice !== vox) { vox = b.dataset.voice; paint(); onVoice?.(vox); } }
    else if (b.classList.contains('sb-load')) { const s = saved[+b.parentElement.dataset.saved]; if (s) setLoadout(s.loadout); }
    else if (b.classList.contains('sb-save')) {
      // the store keeps a plain list, so empty slots fill from the left
      const i = Math.min(+b.parentElement.dataset.saved, saved.length);
      const look = lookOf(cur);
      const next = saved.slice();
      next[i] = { name: `${[look.main, look.second].filter(Boolean).map(e => C.ELEMENTS[e].name).join(' + ')} ${i + 1}`, loadout: { ...cur } };
      saved = saveSaved(next);
      paint();
      const done = $$('[data-saved] .sb-save')[i];
      done.textContent = 'Saved ✓'; setTimeout(() => { done.textContent = 'Save'; }, 900);
    }
  });
  root.addEventListener('pointerover', (e) => showTip(e.target.closest('.sb-card')));
  root.addEventListener('pointerleave', () => showTip(root.contains(document.activeElement) ? document.activeElement.closest('.sb-card') : null));
  root.addEventListener('focusin', (e) => { const c = e.target.closest('.sb-card'); if (c) { focusCard = c; for (const k of $$('.sb-card')) k.tabIndex = k === c ? 0 : -1; } showTip(c); });
  root.addEventListener('focusout', (e) => { if (!root.contains(e.relatedTarget)) showTip(null); });
  root.addEventListener('keydown', (e) => {
    const card = e.target.closest('.sb-card');
    if (!card) { if (e.key !== 'Tab' && e.key !== 'Escape') e.stopPropagation(); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); pick(card); return; }
    const rows = $$('.sb-row');
    const ri = rows.indexOf(card.closest('.sb-row'));
    const cards = [...rows[ri].querySelectorAll('.sb-card')], ci = cards.indexOf(card);
    let next = null;
    if (e.key === 'ArrowLeft') next = cards[(ci - 1 + cards.length) % cards.length];
    else if (e.key === 'ArrowRight') next = cards[(ci + 1) % cards.length];
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const row = rows[(ri + (e.key === 'ArrowUp' ? -1 : 1) + rows.length) % rows.length];
      const list = [...row.querySelectorAll('.sb-card')];
      next = list[Math.min(ci, list.length - 1)];
    } else if (e.key === 'Home') next = cards[0];
    else if (e.key === 'End') next = cards[cards.length - 1];
    if (!next) return;
    e.preventDefault(); e.stopPropagation();
    next.focus();
  });

  // a card whose content overflows (a two-line name on a short screen) drops its blurb
  const fit = () => {
    const cards = $$('.sb-card');
    for (const c of cards) c.classList.remove('tight');
    for (const c of cards) if (c.scrollHeight > c.clientHeight + 1) c.classList.add('tight');
  };
  const ro = new ResizeObserver(() => requestAnimationFrame(fit));
  ro.observe($('.sb-rows'));

  paint();
  pv.setLoadout(cur);
  const io = new IntersectionObserver((en) => pv.setVisible(en[en.length - 1].isIntersecting));
  io.observe(root);

  return {
    set(lo) { setLoadout(lo, { silent: true }); },
    setVoice(v) { vox = C.sanitizeVoice(v); paint(); },
    footer: $('.sb-foot'),
    get loadout() { return { ...cur }; },
    get voice() { return vox; },
    destroy() { io.disconnect(); ro.disconnect(); pv.destroy(); root.remove(); },
  };
}
