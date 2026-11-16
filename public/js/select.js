// The wizard gallery (characters track, round 27; the spell builder of rounds 11-26 and the hero picker of rounds 4-10 are in git history).
import * as THREE from 'three';
import * as C from '../shared/constants.js';
import { makeWizardBody, looksReady, lookOf, clipsFor } from './looks.js';
import { spellPlay } from './spellanim.js';
import { WIZARDS } from '../shared/wizards.js';
import { getView, subscribe as onProgress, equip, unlockList, tauntsEnabled, setTauntsEnabled, wizardAccess, grandfather } from './progress.js';   // round 26: the Wardrobe and the tracker
import { LOOKS, SLOTS, SLOT_NAMES, DEFAULT_LOOK } from '../shared/cosmetics.js';

const FPS = 30;
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ================================================================ the wizard gallery (round 27; the spell builder of rounds 11-26 is in git history)
// mountSpellBuilder(container, { loadout, voice, onChange(loadout, { wizard }), onVoice(voice), footer }) ->
//   { set(loadoutOrWizardId), setVoice(voice), footer, loadout, wizard, voice, destroy() }
// (the name is main.js's.) Six wizard cards (C.PRESETS: wizards.js's fixed kits), locked ones greyed with their XP and a bar from the
// ladder (progress.js wizardAccess). A detail panel beside them shows the hovered or focused wizard (else yours): a live preview
// casting its signature spell, its six abilities in plain words and a playstyle tip. Picking an open card sets the loadout to its kit.
// The top bar has How to play, Stats and the Wardrobe; the side the level, today's challenges and (on the join screen) the rooms;
// the bottom bar the voice and `footer` (main.js's name field, Play and bots). In the Esc menu the same gallery, compact.
// Keyboard: the cards are a radio group (arrows move, Enter or Space picks, focus shows the details); Tab leaves it.

// Raven Fantasy Icons (public/textures/icons/CREDITS.md), by spell; a spell not listed uses its own id.
const SPELL_ICON = {
  spark: 'fast', gale_shear: 'shear', glacial_skim: 'skim', hex_shards: 'hex', potion_toss: 'potion', meteor: 'heavy',
  sanguine_lash: 'lash', battering_ram: 'ram', toxic_flask: 'toxic', glacial_bulwark: 'bulwark', flask_step: 'flaskstep',
};
const iconOf = (id) => `./textures/icons/${SPELL_ICON[id] || id}.png`;
// An ability's one line in the detail panel: plain words, free of numbers so spells' tuning never makes it wrong, and short enough
// for one line of the panel. A spell not listed uses spells' `SPELLBOOK[id].line`, else its blurb's first sentence.
const ABILITY_LINE = {
  fireball: 'Big fire bolts; every third one stuns', meteor: 'A slow, heavy fireball after a wind-up', firewall: 'A wall of flame that burns up spells',
  smoke_screen: 'Leap back into smoke that hides you', meteor_rain: 'Leap into the sky, dive down as a blaze',
  gale_shear: 'Short-range blades of wind', cyclone: 'Spin and fling everyone near you away', tempest_veil: 'A wind bubble that swallows every spell',
  blink: 'Teleport forward', eye_of_storm: 'Become a tornado that pulls them in',
  glacial_skim: 'Ice shards along the ground that slow', frostfall: 'Drop a block of ice that freezes', glacial_bulwark: 'An ice wall that blocks everything',
  skyward: 'Flash straight up, float down', blizzard: 'A cone of snow that freezes and pushes',
  hex_shards: 'Glyphs that curve in from the sides', sanguine_lash: 'A blood bolt that heals you as it hits', black_death: 'A blood shroud that turns hits into healing',
  mirror_step: 'Dash and split off two decoys', night_cage: 'A ring of spikes nobody can cross',
  sling: 'Stones that hit harder the further they fly', battering_ram: 'A ram charges straight ahead', ram_guard: 'Three rams circle you and take your hits',
  ram_ride: 'Gallop on a ram, knocking them flat', stampede: 'A herd of rams thunders down a lane',
  potion_toss: 'Arcing potions that splash', toxic_flask: 'A pool of poison that lingers', smoke_flask: 'Purple smoke that eats incoming spells',
  flask_step: 'Teleport to where your flask lands', berserker_brew: 'Heal, hit harder, halve your cooldowns',
  telekinesis: 'Lift a crate or barrel, then hurl it', spark: 'Fast bolts, long reach', ward: 'Block spells from the front',
};
const firstSentence = (s) => (s || '').split(/(?<=\.)\s/)[0];
const spellName = (id) => C.SPELLBOOK[id]?.name || id;   // (F is Arcane Grasp for every wizard: the id stays `telekinesis`)
// The spell the preview casts when a wizard is hovered: the one that says the most about it.
const SIGNATURE = { cinder: 'fireball', rime: 'frostfall', gale: 'cyclone', vesper: 'sanguine_lash', embibe: 'potion_toss', jeb: 'battering_ram' };
// Phases a cast demonstrates, in order of preference (a primary shows its magazine's shots in turn).
const DEMO = ['windup', 'cast', 'release', 'channel', 'loop', 'hold'];

const presetOf = (id) => C.PRESETS.find(p => p.id === id) || null;
// The wizard a loadout (or id) belongs to: its kit exactly, else spells' mapping when there is one, else the kit with the same
// primary, else the Pyromancer (the server's rule for old saved custom loadouts).
export function wizardOf(x) {
  if (typeof x === 'string') return presetOf(x) ? x : C.DEFAULT_WIZARD || 'cinder';
  const lo = C.sanitizeLoadout(x);
  if (!lo) return C.PRESETS[0].id;
  const exact = C.PRESETS.find(p => C.sameLoadout(p.loadout, lo));
  if (exact) return exact.id;
  for (const f of [C.wizardOfLoadout, C.wizardForLoadout, C.kitOf]) {
    if (typeof f !== 'function') continue;
    const r = f(lo), id = typeof r === 'string' ? r : r?.id;
    if (presetOf(id)) return id;
  }
  return C.PRESETS.find(p => p.loadout.primary === lo.primary)?.id || C.PRESETS[0].id;
}
export function wizardName(x) { return presetOf(wizardOf(x))?.name || 'Pyromancer'; }
const kitOf = (id) => ({ ...(presetOf(id) || C.PRESETS[0]).loadout });
const wizColor = (id) => hex(lookOf(kitOf(id)).color);

function builderHTML() {
  return `<div class="sb-top">
      <div class="sb-group sb-menu" role="group" aria-label="More">
        <button type="button" class="sb-chip sb-howto" data-howto title="Controls and the goal">How to play</button>
        <button type="button" class="sb-chip sb-stats-btn" data-stats title="Your stats and the leaderboard">📊 Stats</button>
        <button type="button" class="sb-chip sb-wd-btn" data-wardrobe title="Robes, hats, staff glows and spell trails you've unlocked">🎩 Wardrobe <i class="sb-wd-lv"></i></button></div>
    </div>
    <div class="sb-main">
      <section class="wg-gallery" aria-label="Wizards">
        <div class="wg-head"><span class="wg-label">Choose your wizard</span><span class="wg-next"></span></div>
        <div class="wg-grid" role="radiogroup" aria-label="Wizards">${C.PRESETS.map(p => `
          <button type="button" class="wg-card" role="radio" aria-checked="false" tabindex="-1" data-wizard="${p.id}" style="--el:${wizColor(p.id)}">
            <span class="wg-pt" aria-hidden="true"><img alt="" draggable="false" hidden></span>
            <span class="wg-info"><b class="wg-name">${esc(p.name)}</b><span class="wg-role">${esc(WIZARDS[p.id]?.role || '')}</span><span class="wg-st"></span></span>
          </button>`).join('')}
        </div>
      </section>
      <div class="sb-wardrobe" role="region" aria-label="Wardrobe"></div>
      <section class="wg-detail" aria-live="polite">
        <div class="sb-preview" aria-hidden="true"></div>
        <div class="wg-about"></div>
      </section>
      <div class="sb-side">
        <div class="sb-prog" hidden></div>
      </div>
    </div>
    <div class="sb-foot">
      <div class="sb-group sb-voice" role="radiogroup" aria-label="Voice"><span class="sb-label">Voice</span>${C.VOICES.map(v =>
        `<button type="button" class="sb-chip" role="radio" data-voice="${v}">${v === 'male' ? 'Male' : 'Female'}</button>`).join('')}</div>
      <div class="sb-extra"></div>
    </div>
    <div class="sb-desktop" role="note"><b>Best played on a desktop with a keyboard and mouse</b>
      <span>Wizard Arena needs a wider window, WASD and a mouse. Make the window wider, or come back on a computer.</span></div>`;
}

// The detail panel's text for wizard `id`: name and role, a lock line when it's locked, the six abilities and the tip.
function aboutHTML(id, { locked, unlockXp, toGo, mine } = {}) {
  const p = presetOf(id), w = WIZARDS[id] || {};
  const rows = C.LOADOUT_SLOTS.map(slot => {
    const sid = p.loadout[slot], s = C.SPELLBOOK[sid] || {};
    return `<li data-spell="${sid}" style="--el:${hex(s.color ?? C.spellInfo?.(sid)?.color ?? 0xffc857)}"><kbd>${esc(C.SLOT_INFO[slot].key)}</kbd>
      <img src="${iconOf(sid)}" alt="" draggable="false"><span><b>${esc(spellName(sid))}</b><em>${esc(ABILITY_LINE[sid] || s.line || firstSentence(s.blurb))}</em></span></li>`;
  }).join('');
  const state = locked ? `<div class="wg-lock">🔒 Unlocks at ${unlockXp} XP${toGo > 0 ? ` · ${toGo} XP to go` : ''}</div>`
    : mine ? '<div class="wg-mine">✓ Your wizard</div>' : '<div class="wg-pick">Click to play this wizard</div>';
  return `<div class="wg-title" style="--el:${wizColor(id)}"><b>${esc(p.name)}</b><span>${esc(w.role || '')}</span></div>${state}
    <ul class="wg-abil" aria-label="${esc(p.name)}'s spells">${rows}</ul>
    ${w.tip ? `<p class="wg-tip"><b>Tip</b> ${esc(w.tip)}</p>` : ''}`;
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
  const pv = { tall: 3.0, wide: 2.8, renderer, scene, camera, rim, body: null, mixer: null, idle: null, cur: null, until: 0, demo: null, raf: 0, last: 0, visible: false, gone: false, yaw: 0.5 };
  let ready = false;
  looksReady().then(() => { ready = true; pv.onReady?.(); });

  // Round 27: hovering across the gallery swaps wizards often, so each loadout's body (and its mixer) is made once and kept.
  const bodies = new Map();
  let eqNow = null;
  pv.setLoadout = (lo) => {
    if (!ready) { pv.onReady = () => pv.setLoadout(lo); return; }
    const key = C.LOADOUT_SLOTS.map(s => lo[s]).join('|');
    let b = bodies.get(key);
    if (!b) {
      const body = makeWizardBody(lo, { aura: 'full', cos: eqNow || getView().equipped });   // (the preview shows the whole look on every graphics tier)
      const mixer = new THREE.AnimationMixer(body.model);
      b = { body, mixer, idle: mixer.clipAction(body.clips.idle), eq: eqNow };
      bodies.set(key, b);
    } else if (b.eq !== eqNow && eqNow) { b.body.setCosmetics?.(eqNow); b.eq = eqNow; }
    if (pv.body === b.body) return;
    if (pv.body) { scene.remove(pv.body.model); pv.mixer.stopAllAction(); }
    pv.body = b.body; pv.mixer = b.mixer; pv.idle = b.idle;
    b.body.model.rotation.y = pv.yaw;
    scene.add(b.body.model);
    pv.idle.reset().play();
    pv.cur = pv.idle;
    rim.color.setHex(b.body.look.color);
    el.style.setProperty('--el', hex(b.body.look.color));
    if (pv.demo) pv.play(pv.demo.id, pv.demo.lo);
  };
  // Round 26: the Wardrobe dresses the preview in place (and any kept body when it's shown again).
  pv.setCosmetics = (eq) => {
    eqNow = eq;
    const b = [...bodies.values()].find(x => x.body === pv.body);
    if (b) { b.body.setCosmetics?.(eq); b.eq = eq; }
  };
  // Play spell `id`'s cast (from the clip set of loadout `lo`, which has it equipped), on repeat while it's asked for.
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
    camera.position.set(0, 1.25, Math.max(pv.tall / span, pv.wide / (span * camera.aspect)));
    camera.lookAt(0, 1.15, 0);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
  pv.setVisible = (v) => { pv.visible = v; if (v && !pv.raf) { pv.last = performance.now(); pv.raf = requestAnimationFrame(frame); } };
  pv.destroy = () => { pv.gone = true; for (const b of bodies.values()) b.mixer.stopAllAction(); bodies.clear(); renderer.dispose(); renderer.forceContextLoss(); };
  return pv;
}


// Round 27: the gallery cards' portraits. Each wizard in its element look (no cosmetics), knees up, rendered once into a PNG by a
// throwaway renderer that's gone again before the match (so it costs the game's renderer nothing). Shared by every gallery.
let portraitsP = null;
function portraits() {
  return portraitsP ||= looksReady().then(() => {
    const W = 320, H = 400, out = new Map();
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    try {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(1);
      renderer.setSize(W, H, false);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x3a2a40, 1.6));
      const key = new THREE.DirectionalLight(0xfff0dd, 2.4); key.position.set(2, 3, 3); scene.add(key);
      const rim = new THREE.DirectionalLight(0xffffff, 3); rim.position.set(-2, 2, -2.5); scene.add(rim);
      const camera = new THREE.PerspectiveCamera(28, W / H, 0.1, 30);
      camera.position.set(0, 1.42, 4.1); camera.lookAt(0, 1.2, 0);
      for (const p of C.PRESETS) {
        const body = makeWizardBody(p.loadout, { aura: 'full' });
        const mixer = new THREE.AnimationMixer(body.model);
        mixer.clipAction(body.clips.idle).play();
        mixer.update(0.7);
        body.updateGrip?.(1);
        body.model.rotation.y = 0.42;
        rim.color.setHex(body.look.color);
        scene.add(body.model);
        renderer.render(scene, camera);
        out.set(p.id, renderer.domElement.toDataURL('image/png'));
        scene.remove(body.model);
        mixer.stopAllAction();
      }
    } finally { renderer.dispose(); renderer.forceContextLoss(); }
    return out;
  }).catch((e) => { console.warn('[select] portraits', e?.message); return new Map(); });
}

// ---------------------------------------------------------------- round 26: the Wardrobe and the progress block

const hexCss = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');
// The level, its title and the bar, as the Wardrobe's header and the side block show it.
function levelHTML(v) {
  const pct = Math.min(100, (v.into || 0) / Math.max(1, v.need || 1) * 100);
  return `<div class="pg-lv"><span>Level <b>${v.level}</b></span><em>${esc(v.title)}</em><small>${Math.floor(v.into || 0)} / ${v.need} XP</small></div>
    <div class="pg-bar"><i style="width:${pct}%"></i></div>`;
}
function progHTML(v) {
  const list = v.challenges?.list || [];
  return `${levelHTML(v)}${list.length ? `<div class="pg-chs"><div class="pg-h">Daily challenges</div>${list.map(c => `<div class="pg-ch${c.done ? ' done' : ''}">
      <span>${c.done ? '✓ ' : ''}${esc(c.text || c.id)}</span><b>${Math.min(c.n, c.goal)}/${c.goal}</b><i style="--k:${Math.min(1, c.n / Math.max(1, c.goal))}"></i></div>`).join('')}</div>` : ''}`;
}
// Four rows (robes, hat, staff glow, spell trail): the default and every unlock of that slot; a locked one shows its level.
function wardrobeHTML(v) {
  const all = unlockList();
  const next = all.find(u => u.level > v.level);
  const chip = (slot, u) => {
    const id = u?.id || '', on = (v.equipped[slot] || '') === id, locked = u && !v.unlocks.includes(u.id);
    const look = u ? LOOKS[u.id] : null, name = u ? u.name.replace(/ (robes|staff glow|spell trails)$/i, '') : DEFAULT_LOOK[slot].name;
    const sw = look?.swatch != null ? hexCss(look.swatch) : 'transparent';
    return `<button type="button" class="wd-item${on ? ' on' : ''}${locked ? ' locked' : ''}" data-wd-slot="${slot}" data-wd-id="${id}"
      style="--sw:${sw}" title="${esc(u ? `${u.name}${locked ? `: unlocks at level ${u.level}` : ''}` : DEFAULT_LOOK[slot].blurb)}"${on ? ' aria-pressed="true"' : ''}>
      <i class="wd-sw${u ? '' : ' def'}"></i><span>${esc(name)}</span>${locked ? `<em>🔒 Lv ${u.level}</em>` : on ? '<em>✓</em>' : ''}</button>`;
  };
  return `<div class="wd-head">${levelHTML(v)}
      <div class="wd-next">${next ? `Next unlock: <b>${esc(next.name)}</b> at level ${next.level}` : all.length ? 'Every unlock is yours' : ''}</div>
      <button type="button" class="sb-chip wd-back" data-wd-back>‹ Wizards</button></div>
    <div class="wd-rows">${SLOTS.map(slot => `<div class="wd-row"><div class="wd-slot">${esc(SLOT_NAMES[slot])}</div>
      <div class="wd-items">${chip(slot, null)}${all.filter(u => u.slot === slot).map(u => chip(slot, u)).join('')}</div></div>`).join('')}</div>
    <p class="wd-note">Cosmetic only: every unlock changes how you look, never how you play. Everyone in the match sees them.${all.length ? '' : ' (Unlocks arrive with the next server update.)'}</p>`;
}

// Round 26b: a small preview of a wizard casting its signature spell on repeat (the XP panel's "New wizard unlocked!"). { destroy() }.
export function mountWizardPreview(el, loadout) {
  if (!el) return null;
  const pv = makeBuilderPreview(el), id = wizardOf(loadout), lo = kitOf(id);
  pv.setLoadout(lo); pv.play(SIGNATURE[id] || lo.primary, lo); pv.setVisible(true);
  return { destroy: () => pv.destroy() };
}


// ---------------------------------------------------------------- the gallery

export function mountSpellBuilder(container, { loadout, voice, onChange, onVoice, footer } = {}) {
  const asked = typeof loadout === 'string' ? null : C.sanitizeLoadout(loadout);
  let wiz = wizardOf(loadout ?? C.DEFAULT_LOADOUT);   // (a loadout that isn't a kit maps to the nearest; the ladder is checked below)
  let cur = kitOf(wiz);
  let vox = C.sanitizeVoice(voice);
  const root = document.createElement('div');
  root.className = 'spell-builder wizard-gallery';
  const inJoin = !!container.closest('#join');
  root.classList.add(inJoin ? 'sb-join' : 'sb-pause');   // round 21: the join screen's emphasis; the pause menu's compact "Try another wizard"
  root.innerHTML = builderHTML();
  container.appendChild(root);
  const $ = (s) => root.querySelector(s), $$ = (s) => [...root.querySelectorAll(s)];
  const pv = makeBuilderPreview($('.sb-preview'));
  pv.tall = 2.55;   // (a wide, short panel: a little closer than the full 3 m, the staff's top may brush the edge mid-cast)
  if (!inJoin) pv.wide = 2.0;   // (the Esc menu's: tall and narrow, beside the abilities)
  if (footer) $('.sb-extra').appendChild(footer);
  if (!inJoin) $('.sb-top').appendChild($('.sb-voice'));   // (the Esc menu: one bar on top, the height goes to the gallery)
  const cards = $$('.wg-card');
  let acc = wizardAccess();
  let focusCard = null;      // the card with tabindex 0
  const rung = (id) => acc.list.find(u => u.id === id);
  const isOpen = (id) => acc.unlocked.has(id) || !rung(id);   // (a wizard the ladder doesn't list is open)

  const paintCards = () => {
    const xp = getView().xp;
    for (const c of cards) {
      const id = c.dataset.wizard, open = isOpen(id), on = id === wiz, u = rung(id), name = presetOf(id).name;
      c.classList.toggle('locked', !open);
      c.classList.toggle('on', on);
      c.setAttribute('aria-checked', String(on));
      if (open) c.removeAttribute('aria-disabled'); else c.setAttribute('aria-disabled', 'true');
      c.setAttribute('aria-label', open ? `${name}: ${WIZARDS[id]?.role || ''}` : `${name}, locked: unlocks at ${u.xp} XP`);
      let st;
      if (open) st = on ? '<em class="wg-on">✓ Your wizard</em>' : '<em>Play this wizard</em>';
      else {
        const prev = acc.list[acc.list.indexOf(u) - 1]?.xp ?? 0, k = Math.max(0, Math.min(1, (xp - prev) / Math.max(1, u.xp - prev)));
        st = `<em>🔒 <span class="wg-at">Unlocks at </span>${u.xp} XP</em><i class="wg-bar"><i style="width:${(k * 100).toFixed(0)}%"></i></i>`;
      }
      c.querySelector('.wg-st').innerHTML = st;
    }
    if (!focusCard || !root.contains(focusCard)) focusCard = cards.find(c => c.dataset.wizard === wiz);
    for (const c of cards) c.tabIndex = c === focusCard ? 0 : -1;
    const nx = acc.next;
    $('.wg-next').innerHTML = nx ? `Next: <b>${esc(nx.name)}</b> in ${nx.toGo} XP <small>· play matches to earn XP</small>` : '';
  };

  // The detail panel: the hovered or focused wizard (`hover`), else ours. The preview casts the shown wizard's signature spell
  // while one is hovered, or an ability row's spell while that row is; ours at rest just idles.
  let hover = null, aboutFor = null;
  const showAbout = (id = hover || wiz, { force } = {}) => {
    if (id !== aboutFor || force) {
      aboutFor = id;
      const u = rung(id), open = isOpen(id);
      $('.wg-about').innerHTML = aboutHTML(id, { locked: !open, unlockXp: u?.xp, toGo: (u?.xp ?? 0) - Math.floor(getView().xp), mine: id === wiz });
      const d = $('.wg-detail');
      d.style.setProperty('--el', wizColor(id));
      d.classList.toggle('locked', !open);
      d.classList.toggle('peek', id !== wiz);
      pv.setLoadout(kitOf(id));
    }
    pv.play(hover ? SIGNATURE[id] : null, kitOf(id));
  };
  const setHover = (id) => { if (id === hover) return; hover = id; showAbout(); };

  const paint = () => {
    acc = wizardAccess();
    paintCards();
    root.style.setProperty('--accent', wizColor(wiz));
    for (const b of $$('[data-voice]')) { const on = b.dataset.voice === vox; b.classList.toggle('active', on); b.setAttribute('aria-checked', on); }
    showAbout(undefined, { force: true });
  };

  // Our wizard: `x` is a loadout or a wizard id. A locked one falls back to the first open wizard (the Pyromancer).
  const setWizard = (x, { silent } = {}) => {
    acc = wizardAccess();
    let id = wizardOf(x);
    if (!isOpen(id)) id = C.PRESETS.find(p => isOpen(p.id))?.id || C.PRESETS[0].id;
    const changed = id !== wiz;
    wiz = id; cur = kitOf(id);
    if (inJoin) lastJoinLoadout = { ...cur };   // (the controls strip names its primary and power)
    paint();
    if (changed && !silent) onChange?.({ ...cur }, { wizard: id });
    return changed;
  };
  const pick = (card) => {
    focusCard = card;
    if (card.classList.contains('locked')) { card.classList.remove('nope'); void card.offsetWidth; card.classList.add('nope'); showAbout(card.dataset.wizard); return; }
    setWizard(card.dataset.wizard);
    $('.wg-gallery').classList.remove('sb-try');
  };

  root.addEventListener('click', (e) => {
    const card = e.target.closest('.wg-card');
    if (card) { pick(card); card.focus({ preventScroll: true }); return; }
    const b = e.target.closest('button');
    if (!b) return;
    if ('howto' in b.dataset) openHowToPlay();
    else if ('stats' in b.dataset) openStats();
    else if ('wardrobe' in b.dataset || 'wdBack' in b.dataset) setTab(root.classList.contains('sb-wd') ? 'wizards' : 'wardrobe');
    else if (b.dataset.wdSlot) { if (!b.classList.contains('locked')) equip(b.dataset.wdSlot, b.dataset.wdId || null); }
    else if (b.dataset.voice) { if (b.dataset.voice !== vox) { vox = b.dataset.voice; paint(); onVoice?.(vox); } }
  });
  // hover: a card shows its wizard (kept while the pointer reads the panel); an ability row casts its spell
  const main = $('.sb-main');
  main.addEventListener('pointerover', (e) => {
    if (root.classList.contains('sb-wd')) return;
    const card = e.target.closest('.wg-card');
    if (card) { setHover(card.dataset.wizard); return; }
    const li = e.target.closest('.wg-abil li');
    if (li) pv.play(li.dataset.spell, kitOf(aboutFor));
    else if (e.target.closest('.wg-detail')) pv.play(hover ? SIGNATURE[aboutFor] : null, kitOf(aboutFor));
  });
  main.addEventListener('pointerleave', () => setHover(root.contains(document.activeElement) ? document.activeElement.closest('.wg-card')?.dataset.wizard || null : null));
  root.addEventListener('focusin', (e) => {
    const c = e.target.closest('.wg-card');
    if (!c) return;
    focusCard = c;
    for (const k of cards) k.tabIndex = k === c ? 0 : -1;
    setHover(c.dataset.wizard);
  });
  root.addEventListener('focusout', (e) => { if (!e.relatedTarget?.closest?.('.wg-card') && !main.matches(':hover')) setHover(null); });
  root.addEventListener('keydown', (e) => {
    const card = e.target.closest('.wg-card');
    if (!card) { if (e.key !== 'Tab' && e.key !== 'Escape') e.stopPropagation(); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); pick(card); return; }
    // a grid: as many columns as cards share the first card's row
    const i = cards.indexOf(card), cols = Math.max(1, cards.filter(c => c.offsetTop === cards[0].offsetTop).length);
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
    let next = null;
    if (step) next = cards[(i + step + cards.length) % cards.length];
    else if (e.key === 'Home') next = cards[0];
    else if (e.key === 'End') next = cards[cards.length - 1];
    if (e.key !== 'Tab' && e.key !== 'Escape') e.stopPropagation();
    if (!next) return;
    e.preventDefault();
    next.focus();
  });

  const sub = container.closest('#join')?.querySelector('.sub');
  if (sub) sub.textContent = JOIN_SUB(matchTarget);
  // One-click start (CrazyGames): a first visit isn't stopped by the how-to-play card. Once the player enters the arena from the
  // join screen (or round 21's auto-join submits the form), the controls strip shows over the first match instead
  // (showControlsStrip), without taking any input.
  const form = footer?.querySelector('form');
  if (inJoin && form) mountJoinRooms($('.sb-side'), form);
  if (inJoin && form && !howToSeen()) {
    form.addEventListener('submit', () => {
      const join = container.closest('#join'), t0 = performance.now();
      const wait = () => {
        if (howToSeen()) return;
        if (!join.offsetParent || getComputedStyle(join).display === 'none') setTimeout(() => showControlsStrip({ loadout: cur }), 600);
        else if (performance.now() - t0 < 15000) setTimeout(wait, 250);
      };
      wait();
    });
  }
  const io = new IntersectionObserver((en) => pv.setVisible(en[en.length - 1].isIntersecting));
  io.observe(root);

  // round 18: the CrazyGames profile chip in the top bar
  const profileEl = document.createElement('div');
  profileEl.className = 'sb-profile';
  profileEl.hidden = true;
  $('.sb-top').appendChild(profileEl);
  const hook = { profile: () => paintProfile(profileEl), saved: () => {} };
  builders.add(hook);
  hook.profile();

  // the portraits, once they're drawn
  portraits().then((m) => {
    for (const c of cards) { const src = m.get(c.dataset.wizard), img = c.querySelector('.wg-pt img'); if (src && img) { img.src = src; img.hidden = false; } }
  });

  // round 26: the Wardrobe (in place of the gallery; the preview shows our wizard dressed) and the level and today's challenges
  const setTab = (tab) => {
    const wd = tab === 'wardrobe';
    root.classList.toggle('sb-wd', wd);
    $('.sb-wd-btn').classList.toggle('active', wd);
    if (wd) { hover = null; showAbout(wiz); paintWardrobe(getView()); }
  };
  const paintWardrobe = (v) => {
    if (!root.classList.contains('sb-wd')) return;
    $('.sb-wardrobe').innerHTML = wardrobeHTML(v);
  };
  const paintProg = (v) => {
    const el = $('.sb-prog');
    el.hidden = !v.fromServer && v.xp <= 0 && !v.challenges.list.length;
    el.innerHTML = progHTML(v);
    $('.sb-wd-lv').textContent = `Lv ${v.level}`;
  };
  // The ladder can change under us (the welcome's progress, an unlock): repaint, and if our wizard is locked now, the Pyromancer.
  const unProgress = onProgress((v) => { paintWardrobe(v); paintProg(v); pv.setCosmetics(v.equipped); setWizard(wiz); });
  paintProg(getView());
  pv.setCosmetics(getView().equipped);
  // A saved loadout that isn't an open wizard's kit (an old custom build, a locked wizard) becomes one: tell main.js once it has
  // finished mounting its pickers.
  const fixed = setWizard(wiz, { silent: true });
  if (fixed || (asked && !C.sameLoadout(asked, cur))) setTimeout(() => onChange?.({ ...cur }, { wizard: wiz }), 0);

  return {
    set(lo) { setWizard(lo, { silent: true }); },
    setVoice(v) { vox = C.sanitizeVoice(v); paint(); },
    footer: $('.sb-foot'),
    get loadout() { return { ...cur }; },
    get wizard() { return wiz; },
    get voice() { return vox; },
    destroy() { unProgress(); builders.delete(hook); io.disconnect(); pv.destroy(); root.remove(); },
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
    [['E'], 'Mobility'], [['F'], 'Arcane Grasp: lift and hurl'], [['Q'], 'Ultimate, once charged']],
};
const MORE_KEYS = [['T', 'Reload early'], ['M', 'Mute'], ['Esc', 'Menu and your wizard']];
// The kill target for the join header and the how-to-play texts. The server's FFA.target (server/match.js) is the truth; this is its
// client copy until the match tells us (setMatchTarget(match.target) from main.js on a match state).
let matchTarget = 10;   // round 22: first to 10 (was 15)
const JOIN_SUB = (n) => `Pick your wizard and fight${wizardAccess().all ? '' : ': more unlock as you play'}. Four wizards, first to ${n} kills.`;
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
  + 'used only for the match. CrazyGames usernames, levels and match stats appear on the in-game leaderboard. We also record anonymous '
  + 'gameplay events (when you join, how long you play, kills, where you leave a match) and your XP, level and unlocks, tied to a random ID '
  + 'and, if logged in, your CrazyGames ID, to improve the game. No ads, no IP addresses or emails stored. '
  + 'Questions or deletion requests: tyswenson34@gmail.com';
let howTo = null;
export function openHowToPlay() {
  if (howTo) { howTo.querySelector('.htp-close').focus(); return; }
  const back = document.createElement('div');
  back.className = 'htp-back';
  back.innerHTML = `<div class="htp" role="dialog" aria-modal="true" aria-labelledby="htpTitle">
      <h2 id="htpTitle">How to play</h2>
      <div class="htp-goal"><b>Free-for-all, four wizards.</b> The first to <b><span data-kill-target>${matchTarget}</span> kills</b> wins.</div>
      <div class="htp-arena"><b>Runes and jump pads.</b> Grab a glowing rune for <i class="rn-haste">Haste</i>, <i class="rn-fury">Fury</i>,
        an <i class="rn-aegis">Aegis</i> shield or an ultimate <i class="rn-surge">Surge</i>; they return after 25 s. Jump pads fling you up to the
        walls. The arenas take turns: the <b>Courtyard</b>, then the <b>Sky Ruins</b>, where a fall into the clouds is fatal.</div>
      <div class="htp-build"><b>Pick a wizard.</b> Each has six spells of its own, one per key; hover a wizard to see them and
        watch it cast. You start as the Pyromancer: play matches to earn XP and unlock the other five.</div>
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

// ================================================================ first play (round 21)
// A first visit skips the builder and drops into a match as the Pyromancer (main.js detects it and auto-joins). This side:
//   setFirstVisit(on)            body.wa-first; the "Click to start" prompt (back to "Click to play" after the first lock);
//                                arms the first Esc menu (the presets pulse under "Try another wizard", Respawn is the obvious
//                                button) and the podium's "Try another wizard" (podium.js reads firstVisitUI()).
//   showControlsStrip({loadout}) the controls strip under the match bar: WASD · Mouse · LMB <primary> · RMB <power> · Space ×2 ·
//                                Q. Hides after 25 s of locked play, or once the player has moved and fired. "?" in the Esc
//                                menu reopens it. (openFirstMatchTips is its old name.)
//   showChangeWizardHint()       the toast "Press Esc to change your wizard and spells" for 8 s (main.js times it: 75 s or the
//                                first death, visits 1-3), and the same line on the death screen until the menu has been opened.
//   openEscMenu() / closeEscMenu()  through main.js's window.WA_MENU when it exists, else a synthetic Escape / the Resume button.
const LOCK_NOTE = 'The mouse aims while the game has it. <kbd>Esc</kbd> opens the menu.';   // main.js's default, restored after the first lock
let firstVisit = false, lastJoinLoadout = null, hintShown = false, menuSeen = false;
export function firstVisitUI() { return firstVisit; }
export function setFirstVisit(on) {
  firstVisit = !!on;
  document.body.classList.toggle('wa-first', firstVisit);
  const big = document.querySelector('#lockPrompt .lp-big'), note = document.querySelector('#lockNote');
  const normal = () => { document.body.classList.remove('wa-start'); if (big) big.textContent = 'Click to play'; if (note) note.innerHTML = LOCK_NOTE; };
  if (!firstVisit) { normal(); return; }
  document.body.classList.add('wa-start');
  if (big) big.textContent = 'Click to start';
  if (note) {
    note.innerHTML = `First to <span data-kill-target>${matchTarget}</span> kills wins`;
    const preset = C.PRESETS.find(p => lastJoinLoadout && C.sameLoadout(p.loadout, lastJoinLoadout));
    let more = note.parentElement.querySelector('.lp-more');
    if (!more) { more = document.createElement('div'); more.className = 'lp-more'; note.after(more); }
    more.innerHTML = `${preset ? `You're the <b>${esc(preset.name)}</b>. ` : ''}Move the mouse to aim, click to cast.`;
  }
  // main.js rewrites the subline when a lock is refused (the welcome's own request, without a click, usually is): ours stays
  // until the first lock succeeds
  const mine = note?.innerHTML;
  const keep = note && new MutationObserver(() => { if (document.body.classList.contains('wa-start') && note.innerHTML !== mine) note.innerHTML = mine; });
  keep?.observe(note, { childList: true });
  const onLock = () => {
    if (!document.pointerLockElement) return;
    document.removeEventListener('pointerlockchange', onLock); keep?.disconnect();
    if (document.body.classList.contains('wa-start')) normal();
  };
  document.addEventListener('pointerlockchange', onLock);
}

let strip = null;
export function showControlsStrip({ loadout } = {}) {
  if (strip) return;
  try { localStorage.setItem(HOWTO_KEY, '1'); } catch { /* private mode */ }
  const lo = C.sanitizeLoadout(loadout) || lastJoinLoadout || C.DEFAULT_LOADOUT;
  const name = (id) => C.SPELLBOOK[id]?.name || '';
  const items = [['move', ['W', 'A', 'S', 'D'], 'Move'], ['aim', ['Mouse'], 'Aim'], ['fire', ['Left click'], name(lo.primary)], ['power', ['Right click'], name(lo.power)],
    ['jump', ['Space'], 'Jump, twice to double jump'], ['ult', ['Q'], 'Ultimate when charged']];
  const el = document.createElement('aside');
  el.className = 'wa-strip';
  el.setAttribute('aria-label', 'Controls');
  el.innerHTML = items.map(([k, keys, t]) => `<span data-k="${k}">${keys.map(x => `<kbd>${x}</kbd>`).join('')}<em>${esc(t)}</em></span>`).join('<i class="dot"></i>')
    + `<button type="button" class="htp-x" title="Hide" aria-label="Hide the controls">×</button>`;
  document.body.appendChild(el);
  strip = el;
  requestAnimationFrame(() => el.classList.add('on'));
  let moved = false, fired = false, lockedAt = 0, timer = 0;
  const close = () => {
    if (strip !== el) return;
    strip = null; clearTimeout(timer);
    removeEventListener('keydown', onKey, true); removeEventListener('mousedown', onMouse, true); document.removeEventListener('pointerlockchange', onLock);
    el.classList.remove('on'); setTimeout(() => el.remove(), 500);
  };
  const done = (k) => el.querySelector(`[data-k="${k}"]`)?.classList.add('done');
  const check = () => { if (moved && fired) { clearTimeout(timer); timer = setTimeout(close, 1500); } };
  const onKey = (e) => { if (/^Key[WASD]$/.test(e.code) && document.pointerLockElement) { moved = true; done('move'); check(); } };
  const onMouse = (e) => { if (!document.pointerLockElement) return; if (e.button === 0) { fired = true; done('fire'); check(); } else if (e.button === 2) done('power'); };
  const onLock = () => { if (document.pointerLockElement && !lockedAt) { lockedAt = performance.now(); if (!(moved && fired)) timer = setTimeout(close, 25000); } };
  addEventListener('keydown', onKey, true); addEventListener('mousedown', onMouse, true); document.addEventListener('pointerlockchange', onLock);
  onLock();
  timer = setTimeout(close, 90000);   // never locked (the prompt refused, a tab in the background): gone anyway
  el.querySelector('.htp-x').addEventListener('click', (e) => { e.stopPropagation(); close(); });
}
export const openFirstMatchTips = showControlsStrip;

let hintEl = null;
export function showChangeWizardHint({ reason, unlocked } = {}) {
  // round 26b: on the wizard ladder the hint waits for a second wizard (progress.js calls it with reason 'unlock' after the XP panel)
  const acc = wizardAccess(), open = C.PRESETS.filter(p => acc.unlocked.has(p.id)).length;
  if (!acc.all && open < 2 && reason !== 'unlock') return;
  if (reason === 'unlock') hintShown = false;
  if (hintShown) return;
  hintShown = true;
  document.body.classList.add('wa-hinted');   // the death screen's line (index.html .ds-hint) until the menu has been opened
  const el = document.createElement('div');
  el.className = 'wa-esc-hint';
  el.setAttribute('role', 'status');
  const got = (unlocked || []).map(u => u.name).filter(Boolean);
  el.innerHTML = `<div class="eh-main">Press <kbd>Esc</kbd> to change your wizard</div><div class="eh-sub">${got.length ? `${esc(got.join(' and '))} unlocked`
    : acc.all ? 'Six wizards, each with its own spells' : 'More wizards unlock as you play'}</div>`;
  document.body.appendChild(el);
  hintEl = el;
  requestAnimationFrame(() => el.classList.add('on'));
  setTimeout(() => { el.classList.remove('on'); setTimeout(() => { el.remove(); if (hintEl === el) hintEl = null; }, 600); }, 8000);
}

export function openEscMenu() {
  if (window.WA_MENU?.open) { window.WA_MENU.open(); return; }
  if (document.pointerLockElement) { try { document.exitPointerLock(); } catch { /* not locked */ } }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
}
export function closeEscMenu() {
  if (window.WA_MENU?.close) { window.WA_MENU.close(); return; }
  document.querySelector('#resumeBtn')?.click();
}

// The Esc menu's first opening of the visit: after a first visit (or once the hint has shown) the presets pulse under "Try
// another wizard" and Respawn is the obvious button, until the menu closes (the pulse: a preset click or 12 s). The menu's
// "?" chip reopens the controls strip. Watched on #clickToPlay's class (main.js's updateLockUI toggles it).
function watchMenu() {
  const menu = document.querySelector('#clickToPlay');
  if (!menu) return;
  const leave = document.querySelector('#leaveBtn');
  if (leave && !menu.querySelector('.wa-help')) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ghost wa-help'; b.title = 'Show the controls again';
    b.textContent = '? Controls';
    b.addEventListener('click', () => { if (hintEl) { hintEl.remove(); hintEl = null; } closeEscMenu(); setTimeout(() => showControlsStrip(), 150); });
    leave.after(b);
  }
  // round 26: the bots' speech bubbles and emotes, on or off (progress.js reads it)
  if (leave && !menu.querySelector('.wa-taunts')) {
    const t = document.createElement('button');
    t.type = 'button'; t.className = 'ghost wa-taunts'; t.title = 'Speech bubbles and emotes from the bots';
    const label = () => { t.textContent = `💬 Bot taunts: ${tauntsEnabled() ? 'On' : 'Off'}`; t.setAttribute('aria-pressed', String(tauntsEnabled())); };
    label();
    t.addEventListener('click', () => { setTauntsEnabled(!tauntsEnabled()); label(); });
    (menu.querySelector('.wa-help') || leave).after(t);
  }
  let wasOpen = false;
  const sync = () => {
    const open = !menu.classList.contains('hidden');
    if (open === wasOpen) return;
    wasOpen = open;
    const presets = menu.querySelector('.sb-pause .wg-gallery'), label = presets?.querySelector('.wg-label'), respawn = menu.querySelector('#respawnBtn');
    if (open && !menuSeen) {
      menuSeen = true;
      document.body.classList.add('wa-menu-seen');
      if (firstVisit || hintShown) {
        document.body.classList.add('wa-try');
        if (label) label.textContent = 'Try another wizard';
        presets?.classList.add('sb-try');
        respawn?.classList.add('wa-obvious');
        setTimeout(() => presets?.classList.remove('sb-try'), 12000);
      }
    } else if (!open) {
      document.body.classList.remove('wa-try');
      presets?.classList.remove('sb-try');
      respawn?.classList.remove('wa-obvious');
    }
  };
  new MutationObserver(sync).observe(menu, { attributes: true, attributeFilter: ['class'] });
  sync();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchMenu); else watchMenu();

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
  el.title = 'Your CrazyGames profile: your progress, settings and match stats are saved';
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
