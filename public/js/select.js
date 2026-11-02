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
const iconOf = (id) => `./textures/icons/${SPELL_ICON[id] || id}.png`;
// A card's one-line description (round 14): short enough for two lines on the smallest card, and free of numbers so the
// spells agent's tuning never makes it wrong. The tooltip has the full blurb and every stat.
const CARD_LINE = {
  spark: 'Fast bolts, long reach', glacial_skim: 'Ground shards that slow', fireball: 'Big, hot bolts', gale_shear: 'A short-range wind blade',
  potion_toss: 'Arcing potions that splash', sling: 'Stones that hit harder far off', hex_shards: 'Glyphs that curve in',
  toxic_flask: 'A pool of poison', meteor: 'A slow, heavy fireball', cyclone: 'Spin and fling them away', sanguine_lash: 'A blood bolt that heals you',
  frostfall: 'Drop a block of ice', battering_ram: 'A ram charges ahead',
  smoke_flask: 'Smoke that eats spells', ward: 'Block from the front', firewall: 'A wall of flame', black_death: 'A blood shroud that heals',
  tempest_veil: 'Swallow spells, keep casting', ram_guard: 'Rams take your hits', glacial_bulwark: 'A freezing ice wall',
  flask_step: 'Teleport where it lands', ram_ride: 'Gallop on a ram', blink: 'Teleport forward', skyward: 'Shoot up, float down',
  mirror_step: 'Dash and leave decoys', smoke_screen: 'Leap back into smoke',
  telekinesis: 'Lift an object and hurl it', trapped_relic: 'Turn an object into a trap', roll: 'Roll out of the way',
  meteor_rain: 'Leap up, dive as a blaze', blizzard: 'A cone of freezing snow', eye_of_storm: 'Become a tornado',
  stampede: 'A lane of charging rams', berserker_brew: 'Harder potions, half cooldowns', night_cage: 'A ring nobody crosses',
};
const firstSentence = (s) => (s || '').split(/(?<=\.)\s/)[0];
const cardLine = (s) => CARD_LINE[s.id] || firstSentence(s.blurb);
// The tags a card shows, most telling first (the tooltip lists them all; fit() drops any that don't fit).
const TAG_ORDER = ['Combo', 'Stuns', 'Roots', 'Knockdown', 'Slows', 'Heal', 'Teleport', 'Dodge', 'Channel', 'Summon', 'Lob', 'Area',
  'Wind-up', 'Dash', 'Shield', 'Hitscan-like', 'Interrupts', 'Projectile'];
const tagRank = (t) => { const i = TAG_ORDER.indexOf(t); return i < 0 ? TAG_ORDER.length : i; };
// The stat symbols (an SVG mask each, so they look the same on every system) and their legend.
const STATS = [['dmg', 'Damage'], ['cd', 'Cooldown'], ['rng', 'Range'], ['dur', 'Duration'], ['wu', 'Wind-up']];
// a stat on a card: its number and unit kept together by a narrow space ("0.45 s" -> "0.45 s", narrower)
const tight = (v) => String(v).replace(/(\d) (s|m|s\/|%)/g, '$1\u202f$2');
const tagHTML = (t) => `<i${t === 'Combo' ? ' class="combo"' : ''}>${esc(t)}</i>`;
// Phases a hovered card demonstrates, in order of preference (a primary shows its magazine's shots in turn).
const DEMO = ['windup', 'cast', 'release', 'channel', 'loop', 'hold'];

function builderHTML() {
  return `<div class="sb-top">
      <div class="sb-group sb-presets" role="group" aria-label="Presets"><span class="sb-label">Presets</span>${C.PRESETS.map(p =>
        `<button type="button" class="sb-chip" data-preset="${p.id}" title="${esc(p.name)}: ${esc(C.LOADOUT_SLOTS.map(s => C.SPELLBOOK[p.loadout[s]]?.name).join(', '))}">${esc(p.name)}</button>`).join('')}
        <button type="button" class="sb-chip sb-random" data-random title="A random spell in every slot">🎲 Randomize</button>
        <button type="button" class="sb-chip sb-howto" data-howto title="Controls and the goal">How to play</button>
        <button type="button" class="sb-chip sb-stats-btn" data-stats title="Your stats and the leaderboard">📊 Stats</button></div>
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
      <div class="sb-legend" aria-label="Stat symbols">${STATS.map(([k, t]) => `<span class="st-${k}">${t}</span>`).join('')}</div>
      <div class="sb-extra"></div>
    </div>
    <div class="sb-tip" role="tooltip" hidden></div>
    <div class="sb-desktop" role="note"><b>Best played on a desktop with a keyboard and mouse</b>
      <span>Wizard Arena needs a wider window, WASD and a mouse. Make the window wider, or come back on a computer.</span></div>`;
}

function cardHTMLFor(id) {
  const s = C.spellInfo(id);
  const stats = [['dmg', 'Damage', s.damage], ['cd', 'Cooldown', s.cooldown], s.range ? ['rng', 'Range', s.range] : ['dur', 'Duration', s.duration], ['wu', 'Wind-up', s.windup]]
    .filter(([, , v]) => v).map(([k, t, v]) => `<span class="st-${k}" title="${t}: ${esc(v)}">${esc(tight(v))}</span>`).join('');
  const tags = s.tags.slice().sort((a, b) => tagRank(a) - tagRank(b)).map(tagHTML).join('');
  return `<div class="sb-card" role="radio" tabindex="-1" data-spell="${id}"${s.combos.length ? ' data-combo' : ''} aria-label="${esc(s.name)}" style="--el:${hex(s.color)}">
      <div class="sb-head"><img class="sb-icon" src="${iconOf(id)}" alt="" draggable="false"><b class="sb-name">${esc(s.name)}</b></div>
      <div class="sb-blurb">${esc(cardLine(s))}</div>
      <div class="sb-stats">${stats}</div>
      <div class="sb-tags">${tags}</div>
    </div>`;
}

function tipHTML(id) {
  const s = C.spellInfo(id);
  const row = (k, v, st) => v ? `<dt class="st-${st}">${k}</dt><dd>${esc(v)}</dd>` : '';
  return `<div class="tip-head" style="--el:${hex(s.color)}"><img src="${iconOf(id)}" alt=""><div><b>${esc(s.name)}</b><span>${esc(C.ELEMENTS[s.element].name)} · ${esc(C.SLOT_INFO[s.slot].label)} (${esc(C.SLOT_INFO[s.slot].key)})</span></div></div>
    <p>${esc(s.blurb)}</p>
    <dl>${row('Damage', s.damage, 'dmg')}${row('Cooldown', s.cooldown, 'cd')}${row('Range', s.range, 'rng')}${row('Duration', s.duration, 'dur')}${row('Wind-up', s.windup, 'wu')}</dl>
    <div class="sb-tags">${s.tags.slice().sort((a, b) => tagRank(a) - tagRank(b)).map(tagHTML).join('')}</div>
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
    pv.idle = pv.mixer.clipAction(body.clips.idle);
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
    const [k, dur, scale, from] = args || ['cast_fast', 0.6, 1, 0];
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
    // the staff upright while idling, KayKit's grip while a spell plays (looks.js updateGrip)
    pv.gripW = (pv.gripW ?? 1) + ((pv.cur === pv.idle ? 1 : 0) - (pv.gripW ?? 1)) * Math.min(1, dt * 12);
    pv.body.updateGrip?.(pv.gripW);
    // a slow sway around a three-quarter view, so casts read from the front
    pv.body.model.rotation.y = pv.yaw + Math.sin(now / 2400) * 0.35;
    camera.aspect = W / H;
    // frame the whole body: the Mage with its hat (2.2 m), the staff raised overhead or held out in front (2.7 m tall, 2.3 m
    // wide, with a margin), whatever the panel's shape
    const span = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.position.set(0, 1.25, Math.max(3.0 / span, 2.8 / (span * camera.aspect)));
    camera.lookAt(0, 1.15, 0);
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
    else if ('howto' in b.dataset) openHowToPlay();
    else if ('stats' in b.dataset) openStats();
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

  // Nothing on a card is cut off (the tooltip has everything): tags that don't fit on its one line are left off whole;
  // a card still too full (a short screen) drops its tag row, or its description instead if that's enough. A combo
  // card would rather keep its Combo tag, so it tries dropping the description first.
  const over = (c) => c.scrollHeight > c.clientHeight + 1;
  const fit = () => {
    const cards = $$('.sb-card').filter(c => c.offsetParent);
    for (const c of cards) { c.classList.remove('tight', 'notags'); for (const i of c.querySelectorAll('.sb-tags i')) i.hidden = false; }
    for (const c of cards) {
      const row = c.querySelector('.sb-tags'), w = row.clientWidth;
      for (const i of row.querySelectorAll('i')) if (i.offsetLeft - row.offsetLeft + i.offsetWidth > w + 0.5) i.hidden = true;
    }
    const first = (c) => 'combo' in c.dataset ? 'tight' : 'notags', second = (c) => 'combo' in c.dataset ? 'notags' : 'tight';
    for (const c of cards.filter(over)) c.classList.add(first(c));
    for (const c of cards.filter(over)) c.classList.replace(first(c), second(c));
    for (const c of cards.filter(over)) c.classList.add(first(c));
  };
  const ro = new ResizeObserver(() => requestAnimationFrame(fit));
  ro.observe($('.sb-rows'));

  paint();
  pv.setLoadout(cur);
  const sub = container.closest('#join')?.querySelector('.sub');
  if (sub) sub.textContent = JOIN_SUB(matchTarget);     // (index.html's own line said 10)
  // One-click start (CrazyGames): a first visit isn't stopped by the how-to-play card. Once the player enters the arena from the
  // join screen, a compact controls card floats over the first match instead (openFirstMatchTips), without taking any input.
  const form = footer?.querySelector('form');
  if (container.closest('#join') && form) mountJoinRooms($('.sb-side'), form);
  if (container.closest('#join') && form && !howToSeen()) {
    form.addEventListener('submit', () => {
      const join = container.closest('#join'), t0 = performance.now();
      const wait = () => {
        if (howToSeen()) return;
        if (!join.offsetParent || getComputedStyle(join).display === 'none') setTimeout(openFirstMatchTips, 600);
        else if (performance.now() - t0 < 15000) setTimeout(wait, 250);
      };
      wait();
    });
  }
  const io = new IntersectionObserver((en) => pv.setVisible(en[en.length - 1].isIntersecting));
  io.observe(root);

  // round 18: the CrazyGames profile chip in the top bar, and the saved list redrawn when the profile's customs arrive
  const profileEl = document.createElement('div');
  profileEl.className = 'sb-profile';
  profileEl.hidden = true;
  $('.sb-top').appendChild(profileEl);
  const hook = { profile: () => paintProfile(profileEl), saved: () => { saved = loadSaved(); paint(); } };
  builders.add(hook);
  hook.profile();

  return {
    set(lo) { setLoadout(lo, { silent: true }); },
    setVoice(v) { vox = C.sanitizeVoice(v); paint(); },
    footer: $('.sb-foot'),
    get loadout() { return { ...cur }; },
    get voice() { return vox; },
    destroy() { builders.delete(hook); io.disconnect(); ro.disconnect(); pv.destroy(); root.remove(); },
  };
}

// ---------------------------------------------------------------- how to play (round 14)
// openHowToPlay(): the controls and the goal, as a card over the page. It opens by itself on a first visit (remembered
// in localStorage), and again from the builder's "How to play" chip (or anything else that calls it, the "?" say).
// Esc, the button or a click outside closes it.
const HOWTO_KEY = 'waHowToPlaySeen';
const howToSeen = () => { try { return !!localStorage.getItem(HOWTO_KEY); } catch { return false; } };
const KEYS = {
  Moving: [[['W', 'A', 'S', 'D'], 'Move'], [['Mouse'], 'Look and aim'], [['Space'], 'Jump'], [['Space', '×2'], 'Double jump'],
    [['Shift'], 'Sprint'], [['C'], 'Crouch']],
  'Your six spells': [[['LMB'], 'Primary: a magazine, then a reload'], [['RMB'], 'Power'], [['R'], 'Shield (hold or tap)'],
    [['E'], 'Mobility'], [['F'], 'Utility'], [['Q'], 'Ultimate, once charged']],
};
const MORE_KEYS = [['T', 'Reload early'], ['M', 'Mute'], ['Esc', 'Menu and your loadout']];
// The kill target for the join header and the how-to-play texts. The server's FFA.target (server/match.js) is the truth; this is its
// client copy until the match tells us (setMatchTarget(match.target) from main.js on a match state).
let matchTarget = 15;
const JOIN_SUB = (n) => `Build your wizard from any spells: one per slot. Four wizards, first to ${n} kills.`;
export function setMatchTarget(n) {
  if (!(n > 0) || n === matchTarget) return;
  matchTarget = n;
  for (const el of document.querySelectorAll('[data-kill-target]')) el.textContent = n;
  const sub = document.querySelector('#join .sub');
  if (sub) sub.textContent = JOIN_SUB(n);
}

// Ty's privacy note (round 16), plain text, shown in the how-to-play card; exported for the "?" panel.
export const PRIVACY = 'Privacy: if you play logged in to CrazyGames, we store your CrazyGames username and ID, your saved spells and '
  + 'settings, and your match stats on our server to keep your progress. As a guest, your data stays in this browser and your name is '
  + 'used only for the match. CrazyGames usernames and match stats appear on the in-game leaderboard. No ads, no tracking. '
  + 'Questions or deletion requests: tyswenson34@gmail.com';
let howTo = null;
export function openHowToPlay() {
  if (howTo) { howTo.querySelector('.htp-close').focus(); return; }
  const back = document.createElement('div');
  back.className = 'htp-back';
  back.innerHTML = `<div class="htp" role="dialog" aria-modal="true" aria-labelledby="htpTitle">
      <h2 id="htpTitle">How to play</h2>
      <div class="htp-goal"><b>Free-for-all, four wizards.</b> The first to <b><span data-kill-target>${matchTarget}</span> kills</b> wins.</div>
      <div class="htp-build"><b>Build your wizard: one spell per slot.</b> Each row of cards is a slot with its own key.
        Hover a card for its full stats; cards tagged <i class="combo">Combo</i> work together.
        <div class="sb-legend">${STATS.map(([k, t]) => `<span class="st-${k}">${t}</span>`).join('')}</div></div>
      <div class="htp-keys">${Object.entries(KEYS).map(([h, list]) => `<dl><h3>${h}</h3>${list.map(([ks, t]) =>
        `<dt>${ks.map(k => k.startsWith('×') ? `<span>${k}</span>` : `<kbd>${k}</kbd>`).join('')}</dt><dd>${esc(t)}</dd>`).join('')}</dl>`).join('')}</div>
      <div class="htp-more">${MORE_KEYS.map(([k, t]) => `<span><kbd>${k}</kbd> ${esc(t)}</span>`).join('')}</div>
      <p class="htp-tip">Watch for rams: a charging ram flattens you, unless your shield faces it.</p>
      <p class="htp-privacy">${esc(PRIVACY)}</p>
      <button type="button" class="htp-close">Got it</button>
    </div>`;
  const close = () => {
    try { localStorage.setItem(HOWTO_KEY, '1'); } catch { /* private mode: it shows again next time */ }
    removeEventListener('keydown', onKey, true);
    back.remove(); howTo = null;
  };
  const onKey = (e) => {
    if (document.body.classList.contains('recap-on')) return;   // hidden under the podium recap: its keys are the recap's
    if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') { e.preventDefault(); back.querySelector('.htp-close').focus(); }
  };
  back.addEventListener('click', (e) => { if (e.target === back || e.target.closest('.htp-close')) close(); });
  addEventListener('keydown', onKey, true);
  document.body.appendChild(back);
  howTo = back;
  back.querySelector('.htp-close').focus({ preventScroll: true });
}

// openFirstMatchTips(): the first visit's controls, as a small card over the first match (round 16, one-click start). It takes
// no input and doesn't move focus, so the game's "Click to play" and the keys work through it; it fades out after 25 s, or at
// once from its x. Shown once (the same localStorage flag as the full card, which stays on the builder's "How to play" chip).
let tips = null;
export function openFirstMatchTips() {
  if (tips) return;
  try { localStorage.setItem(HOWTO_KEY, '1'); } catch { /* private mode */ }
  const el = document.createElement('aside');
  el.className = 'htp-float';
  el.setAttribute('aria-label', 'Controls');
  el.innerHTML = `<button type="button" class="htp-x" title="Hide" aria-label="Hide the controls">×</button>
    <h2>How to play</h2>
    <p class="htp-goal"><b>First to <span data-kill-target>${matchTarget}</span> kills</b> wins. Your spells are on the keys below; <kbd>Esc</kbd> changes them.</p>
    <div class="htp-keys">${Object.entries(KEYS).map(([h, list]) => `<dl><h3>${h}</h3>${list.map(([ks, t]) =>
      `<dt>${ks.map(k => k.startsWith('×') ? `<span>${k}</span>` : `<kbd>${k}</kbd>`).join('')}</dt><dd>${esc(t)}</dd>`).join('')}</dl>`).join('')}</div>`;
  const close = () => { if (!tips) return; tips = null; el.classList.add('gone'); setTimeout(() => el.remove(), 400); };
  el.querySelector('.htp-x').addEventListener('click', (e) => { e.stopPropagation(); close(); });
  document.body.appendChild(el);
  tips = el;
  setTimeout(close, 25000);
}

// ================================================================ rooms (round 17)
// The join screen: Play (public matchmaking, the default and Enter in the name field), Create private match, and Join with
// a code. Every button submits main.js's #joinForm with form.dataset.room set: '' public, 'new' a new private room, 'K7Q2'
// that room. In game: setRoom(room) shows the private room's code chip and a row in the Esc menu, both with Invite friends;
// openInvite() the invite card; roomError() the "room full or unknown" note. Platform calls go through platform.js (deploy).
const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // the server's code alphabet (no 0 O 1 I L)
const ROOM_LEN = 4;
const cleanCode = (v) => [...String(v ?? '').toUpperCase()].filter(ch => ROOM_ALPHABET.includes(ch)).join('').slice(0, 5);
let platformP = null;
const platform = () => (platformP ||= import('./platform.js').catch(() => null));
// the CrazyGames username fills the name field (unless the player types first); main.js may await nameReady() before reading it
let nameReadyP = Promise.resolve();
export function nameReady() { return nameReadyP; }

function mountJoinRooms(side, form) {
  const playBtn = form.querySelector('button[type="submit"]'), nameIn = form.querySelector('input');
  if (playBtn) { playBtn.textContent = 'Play'; playBtn.title = 'Join a public match now (Enter)'; }
  const box = document.createElement('section');
  box.className = 'sb-rooms';
  box.setAttribute('aria-label', 'Play with friends');
  box.innerHTML = `<h4>Play with friends</h4>
    <button type="button" class="sb-room-new" title="A match only friends with the code can join; bots fill the empty seats">Create private match</button>
    <div class="sb-room-join">
      <input class="sb-room-code" maxlength="5" placeholder="Code" aria-label="Room code" autocomplete="off" spellcheck="false" autocapitalize="characters">
      <button type="button" class="sb-room-go">Join</button>
    </div>
    <p class="sb-room-msg" aria-live="polite"></p>`;
  side.appendChild(box);
  const code = box.querySelector('.sb-room-code'), msg = box.querySelector('.sb-room-msg');
  const newBtn = box.querySelector('.sb-room-new'), goBtn = box.querySelector('.sb-room-go');
  let pending = null;   // the room the next submit asks for; Play and Enter in the name field leave it null (public)
  const go = (room) => { if (playBtn?.disabled) return; pending = room; form.requestSubmit(); };
  // registered before main.js's submit handler, so the room is set by the time it reads it. A submit of main.js's own (the
  // launch's auto-join, no submitter) keeps whatever room it set.
  form.addEventListener('submit', (e) => {
    if (pending) form.dataset.room = pending;
    else if (e.submitter && e.submitter === playBtn) form.dataset.room = '';
    pending = null;
  });
  newBtn.addEventListener('click', () => go('new'));
  const joinCode = () => {
    const c = cleanCode(code.value);
    if (c.length < ROOM_LEN) { msg.textContent = `A code is ${ROOM_LEN} letters or digits.`; code.focus(); return; }
    msg.textContent = '';
    go(c);
  };
  goBtn.addEventListener('click', joinCode);
  code.addEventListener('input', () => {
    const c = cleanCode(code.value);
    if (c !== code.value) code.value = c;
    msg.textContent = '';
    goBtn.classList.toggle('ready', c.length >= ROOM_LEN);
  });
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); joinCode(); } });
  // main.js disables Play while loading and connecting: the room buttons follow it
  const sync = () => { newBtn.disabled = goBtn.disabled = !!playBtn?.disabled; };
  if (playBtn) new MutationObserver(sync).observe(playBtn, { attributes: true, attributeFilter: ['disabled'] });
  sync();
  // an invite's code (?room= here, the SDK's invite params on CrazyGames) shows in the box, in case the auto-join didn't happen
  const fill = (c) => { c = cleanCode(c); if (c.length >= ROOM_LEN && !code.value) { code.value = c; goBtn.classList.add('ready'); } };
  try { fill(new URLSearchParams(location.search).get('room')); } catch { /* no URL */ }
  let typed = false;
  nameIn?.addEventListener('input', () => { typed = true; }, { once: true });
  nameReadyP = platform().then(async (P) => {
    if (!P) return;
    await P.ready?.();
    fill(P.inviteRoom?.());
    const user = await P.getUsername?.();
    if (user && nameIn && !typed) { nameIn.value = user; nameIn.title = 'Your CrazyGames username'; }
    if (user && !profile) { const last = cachedProfile(); if (last?.username === user) { profile = last; for (const b of builders) b.profile(); } }
  }).catch(() => {});
}

// ---------------------------------------------------------------- in game: the room chip and the Esc menu row
let room = null, chip = null, row = null;
const roomLabel = (r) => `${r.humans ?? 1}/${r.max ?? 4} players`;
export function setRoom(r) {
  const was = room?.code;
  room = r && r.private && r.code ? r : null;
  if (!room) {
    chip?.remove(); row?.remove(); chip = row = null;
    if (was) platform().then(P => P?.hideInviteButton?.());
    return;
  }
  if (!chip) {
    chip = document.createElement('div');
    chip.id = 'roomChip';
    chip.className = 'wa-room-chip';
    chip.innerHTML = `<span class="wr-label">Private room</span> <b class="wr-code"></b> <span class="wr-n"></span>
      <button type="button" class="wr-invite">Invite friends</button>`;
    chip.querySelector('.wr-invite').addEventListener('click', (e) => { e.stopPropagation(); openInvite(); });
    document.body.appendChild(chip);
  }
  const top = document.querySelector('#clickToPlay .pause-top');
  if (!row && top) {
    row = document.createElement('div');
    row.className = 'pause-group wa-room-row';
    row.innerHTML = `<span class="pause-label">Room</span> <b class="wr-code"></b> <span class="wr-n"></span>
      <button type="button" class="wr-invite">Invite friends</button>
      <label class="wr-bots" title="The bots that fill the empty seats (you're the host)">Bots
        <select><option value="easy">Easy</option><option value="normal">Normal</option><option value="hard">Hard</option></select></label>`;
    row.querySelector('.wr-invite').addEventListener('click', () => openInvite());
    const sel = row.querySelector('select');
    sel.addEventListener('change', () => window.WA_ROOM?.setBots?.(sel.value));
    sel.addEventListener('keydown', (e) => e.stopPropagation());
    top.appendChild(row);
  }
  for (const el of [chip, row].filter(Boolean)) {
    el.querySelector('.wr-code').textContent = room.code;
    el.querySelector('.wr-n').textContent = roomLabel(room);
  }
  if (row) {
    const bots = row.querySelector('.wr-bots');
    bots.hidden = !room.isHost;
    if (room.bots) bots.querySelector('select').value = room.bots;
  }
  if (room.code !== was) platform().then(P => P?.showInviteButton?.(room.code));
}

// The invite card: the code, the link (copied at once) and a Copy button. Not modal: the game's own prompts work around it.
let invite = null;
export async function openInvite() {
  if (!room) return;
  const code = room.code;
  if (!invite) {
    invite = document.createElement('aside');
    invite.className = 'wa-invite';
    invite.setAttribute('aria-label', 'Invite friends');
    invite.innerHTML = `<button type="button" class="htp-x" title="Close" aria-label="Close">×</button>
      <h2>Invite friends</h2>
      <p>Send this link to up to 3 friends. Or they press <b>Join with code</b> and type:</p>
      <div class="wi-code"></div>
      <div class="wi-link"><input readonly aria-label="Invite link"><button type="button" class="wi-copy">Copy link</button></div>
      <p class="wi-note" aria-live="polite"></p>`;
    for (const t of ['click', 'mousedown', 'keydown']) invite.addEventListener(t, (e) => e.stopPropagation());
    invite.querySelector('.htp-x').addEventListener('click', () => { invite.remove(); invite = null; });
    invite.querySelector('.wi-copy').addEventListener('click', () => copyLink());
    document.body.appendChild(invite);
  }
  invite.querySelector('.wi-code').textContent = code;
  const input = invite.querySelector('input');
  const P = await platform();
  const link = (await P?.inviteLink?.(code)) || `${location.origin}${location.pathname}?room=${code}`;
  if (!invite) return;
  input.value = link;
  copyLink();
}
async function copyLink() {
  if (!invite) return;
  const input = invite.querySelector('input'), note = invite.querySelector('.wi-note');
  try { await navigator.clipboard.writeText(input.value); note.textContent = 'Link copied. Paste it to your friends.'; }
  catch { input.focus(); input.select(); note.textContent = 'Copy the link above (Ctrl+C).'; }
}

// The server couldn't seat us in the room we asked for and put us in a public match instead.
export function roomError({ code, reason } = {}) {
  const what = code ? `Room ${cleanCode(code) || code}` : 'That room';
  const text = reason === 'full' ? `${what} is full.` : reason === 'unknown' ? `${what} doesn't exist (check the code).`
    : reason === 'busy' ? 'No private rooms are free right now.' : `${what} isn't available.`;
  const el = document.createElement('div');
  el.className = 'wa-room-error';
  el.setAttribute('role', 'status');
  el.innerHTML = `<b>${esc(text)}</b> You're in a public match instead.`;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('gone'), 6000);
  setTimeout(() => el.remove(), 6500);
}

// ================================================================ the CrazyGames profile (round 18)
// main.js calls setProfile(msg) with the server's { t: 'profile', username, save, stats } for a logged-in CrazyGames player (never
// for guests), and refreshSaved() after writing the profile's saved customs into loadout-store. Every builder shows a small chip
// (the username, matches, wins, K/D); the podium says "Saved to your profile" (hasProfile). There's no login or logout here.
const PROFILE_KEY = 'waProfile';
const builders = new Set();
let profile = null;
function cachedProfile() { try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch { return null; } }
export function setProfile(msg) {
  if (!msg || msg.guest || !msg.username) { profile = null; try { localStorage.removeItem(PROFILE_KEY); } catch { /* private mode */ } }
  else {
    profile = { username: String(msg.username), stats: msg.stats || {} };
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch { /* private mode */ }
  }
  for (const b of builders) b.profile();
}
export function hasProfile() { return !!profile; }
export function refreshSaved() { for (const b of builders) b.saved(); }
function paintProfile(el) {
  el.hidden = !profile;
  if (!profile) { el.innerHTML = ''; return; }
  const st = profile.stats || {}, n = (v) => Math.max(0, Math.round(+v || 0));
  const kd = (n(st.kills) / Math.max(1, n(st.deaths))).toFixed(2);
  el.title = 'Your CrazyGames profile: your spells, settings and match stats are saved';
  el.innerHTML = `<span class="sp-user">${esc(profile.username)}</span>
    <span><b>${n(st.matches)}</b> ${n(st.matches) === 1 ? 'match' : 'matches'}</span>
    <span><b>${n(st.wins)}</b> ${n(st.wins) === 1 ? 'win' : 'wins'}</span>
    <span>K/D <b>${kd}</b></span>`;
}

// ================================================================ stats and the leaderboard (round 19)
// openStats(): a card with two tabs, Your stats and Leaderboard (This week / All time). The data comes from main.js's fetcher
// (setStatsFetcher), which asks the server ({ t: 'stats' }); a reply is reused for 5 s (the server's rate limit).
let statsFetch = null, statsCache = null, statsAt = 0, stats = null;
export function setStatsFetcher(fn) { statsFetch = typeof fn === 'function' ? fn : null; }
const STATS_TTL = 5000;
async function loadStats(force) {
  if (!force && statsCache && performance.now() - statsAt < STATS_TTL) return statsCache;
  if (!statsFetch) return { offline: true };
  const r = await Promise.race([statsFetch(), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 8000))]);
  if (r && !r.offline && !r.unavailable) { statsCache = r; statsAt = performance.now(); }
  return r || { unavailable: true };
}
const num = (v) => Math.max(0, Math.round(+v || 0));
const big = (v) => num(v).toLocaleString('en-US');
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
function playtime(sec) {
  const m = Math.round(num(sec) / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
function when(at) {
  const d = new Date(at);
  if (isNaN(d)) return '';
  const days = Math.floor((Date.now() - d) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 7 ? `${days} days ago` : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function meHTML(r) {
  if (!r.me) return `<p class="st-msg">Log in to CrazyGames to track your stats.<br><span>Every match you play while logged in counts, against wizards or bots.</span></p>`;
  const m = r.me, matches = num(m.matches), deaths = num(m.deaths);
  const wr = m.winRate ?? m.win_rate, winRate = wr != null ? +wr : (matches ? num(m.wins) / matches : 0);
  const kd = m.kd != null ? +m.kd : num(m.kills) / Math.max(1, deaths);
  const tiles = [['Matches', big(matches)], ['Wins', big(m.wins)], ['Win rate', `${Math.round(winRate * 100)}%`], ['Podiums', big(m.podiums)],
    ['Kills', big(m.kills)], ['K/D', kd.toFixed(2)], ['Damage', big(m.damage)], ['Healing', big(m.healing)]];
  const top = (m.topSpells || m.top_spells || []).slice(0, 3).filter(t => C.SPELLBOOK[t.id || t.spell]);
  const recent = (r.recent || []).slice(0, 10);
  return `<div class="st-tiles">${tiles.map(([k, v]) => `<div class="st-tile"><b>${esc(v)}</b><span>${k}</span></div>`).join('')}</div>
    <p class="st-time">Play time <b>${playtime(m.playtime_s)}</b>${matches ? ` · <b>${big(m.avgDamage ?? num(m.damage) / matches)}</b> damage a match` : ''}</p>
    <div class="st-cols">
      <section><h3>Top spells</h3>${top.length ? `<ol class="st-spells">${top.map(t => { const id = t.id || t.spell; return `<li style="--el:${hex(C.spellInfo(id).color)}">
        <img src="${iconOf(id)}" alt=""><span>${esc(C.SPELLBOOK[id].name)}</span><em>${big(t.kills)} ${num(t.kills) === 1 ? 'kill' : 'kills'}</em></li>`; }).join('')}</ol>`
        : `<p class="st-none">Your best spells show here after a few kills.</p>`}</section>
      <section><h3>Last matches</h3>${recent.length ? `<table class="st-recent"><thead><tr><th>Place</th><th>Kills</th><th>Deaths</th><th>Damage</th><th></th></tr></thead><tbody>${
        recent.map(x => `<tr class="${num(x.place) === 1 ? 'won' : ''}"><td>${x.place ? ordinal(num(x.place)) : '–'}</td><td>${big(x.kills)}</td><td>${big(x.deaths)}</td><td>${big(x.damage)}</td><td class="st-when">${esc(when(x.at || x.created_at || x.date))}</td></tr>`).join('')}</tbody></table>`
        : `<p class="st-none">No matches yet. Play one!</p>`}</section>
    </div>`;
}
function boardHTML(r, period) {
  // rows: [{ rank, username, wins, kills, me? }] in order; rank[period]: { rank, wins, kills } or null (not on the board, or a guest)
  const rows = (r.board?.[period] || []).slice(0, 25), mine = r.me?.username || profile?.username;
  const isMe = (x) => !!x.me || (!!mine && x.username === mine);
  const rk = r.rank?.[period], myRank = typeof rk === 'number' ? { rank: rk } : rk;
  if (!rows.length) return `<p class="st-msg">Be the first on the board!${period === 'week' ? '<br><span>The week started Monday, 00:00 UTC.</span>' : ''}</p>`;
  const row = (x, i, cls = '') => `<tr class="${cls}${isMe(x) ? ' me' : ''}"><td class="st-rank">${num(x.rank) || i}</td><td class="st-name">${esc(x.username ?? '')}</td><td>${big(x.wins)}</td><td>${big(x.kills)}</td></tr>`;
  const inTop = rows.some(isMe);
  const pin = !inTop && myRank?.rank ? row({ username: mine || 'You', wins: myRank.wins, kills: myRank.kills, me: true }, myRank.rank, 'pinned') : '';
  const note = !r.me ? '<p class="st-foot">Log in to CrazyGames to get on the board.</p>'
    : !inTop && !pin ? `<p class="st-foot">Play a match${period === 'week' ? ' this week' : ''} to get on the board.</p>` : '';
  return `<table class="st-board"><thead><tr><th>#</th><th>Wizard</th><th>Wins</th><th>Kills</th></tr></thead>
    <tbody>${rows.map((x, i) => row(x, i + 1)).join('')}</tbody>${pin ? `<tfoot>${pin}</tfoot>` : ''}</table>${note}`;
}

let statsEl = null;
export function openStats(tab = 'me') {
  if (statsEl) { statsEl.querySelector('.htp-close').focus(); return; }
  const back = document.createElement('div');
  back.className = 'htp-back st-back';
  back.innerHTML = `<div class="htp st" role="dialog" aria-modal="true" aria-labelledby="stTitle">
      <h2 id="stTitle">Stats</h2>
      <div class="st-tabs" role="tablist">
        <button type="button" role="tab" data-tab="me">Your stats</button><button type="button" role="tab" data-tab="board">Leaderboard</button>
        <span class="st-period" role="group" aria-label="Period"><button type="button" data-period="week">This week</button><button type="button" data-period="all">All time</button></span>
      </div>
      <div class="st-body" role="tabpanel" aria-live="polite"></div>
      <button type="button" class="htp-close">Close</button>
    </div>`;
  let period = 'week', state = 'loading', data = null;
  const body = back.querySelector('.st-body');
  const paint = () => {
    for (const b of back.querySelectorAll('[data-tab]')) { const on = b.dataset.tab === tab; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); }
    for (const b of back.querySelectorAll('[data-period]')) b.classList.toggle('active', b.dataset.period === period);
    back.querySelector('.st-period').hidden = tab !== 'board' || state !== 'ok';
    body.innerHTML = state === 'loading' ? '<div class="st-spin" aria-label="Loading"></div>'
      : state === 'offline' ? `<p class="st-msg">Your stats and the leaderboard load once you're in a match.</p>`
      : state === 'error' ? `<p class="st-msg">Stats unavailable right now.<br><button type="button" class="st-retry">Retry</button></p>`
      : tab === 'me' ? meHTML(data) : boardHTML(data, period);
  };
  const load = async (force) => {
    state = 'loading'; paint();
    let r;
    try { r = await loadStats(force); } catch { r = { unavailable: true }; }
    if (statsEl !== back) return;   // closed (or another card opened) meanwhile
    data = r; state = r.offline ? 'offline' : r.unavailable ? 'error' : 'ok';
    paint();
  };
  const close = () => { removeEventListener('keydown', onKey, true); back.remove(); statsEl = null; };
  const onKey = (e) => {
    if (document.body.classList.contains('recap-on')) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    e.stopPropagation();   // the game's keys wait (Tab, Enter and the arrows move through the card as usual)
  };
  back.addEventListener('click', (e) => {
    if (e.target === back || e.target.closest('.htp-close')) return close();
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tab) { tab = b.dataset.tab; paint(); }
    else if (b.dataset.period) { period = b.dataset.period; paint(); }
    else if (b.classList.contains('st-retry')) load(true);
  });
  addEventListener('keydown', onKey, true);
  document.body.appendChild(back);
  statsEl = back;
  back.querySelector(`[data-tab="${tab}"]`).focus({ preventScroll: true });
  load(false);
}
