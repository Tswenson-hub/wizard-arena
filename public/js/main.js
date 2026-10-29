import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as C from '../shared/constants.js';
import { Net } from './net.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { buildWorld, makePropMesh, spinners, loadModels, trampleCrops } from './world.js';
import { GoatView } from './goats.js';
import { Wizard } from './wizard.js';
import { registerModel, loadWizardModels } from './looks.js';
import { Effects } from './effects.js';
import { mountWizardPicker } from './select.js';
import { mountMatchUI } from './match-ui.js';

// ---------------------------------------------------------------- setup
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(new URLSearchParams(location.search).has('low') ? 1 : Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
const LOW_FX = new URLSearchParams(location.search).has('low');   // ?low for weak GPUs
renderer.shadowMap.enabled = !LOW_FX;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 300);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

buildWorld(scene);
const effects = new Effects(scene);
const input = new Input(canvas);
const sfx = new Sfx();
const net = new Net();

const $ = (s) => document.querySelector(s);
const ui = {
  join: $('#join'), form: $('#joinForm'), name: $('#nameInput'), joinBtn: $('#joinBtn'), loadStatus: $('#loadStatus'),
  hud: $('#hud'), hp: $('#bars .hp .fill'), st: $('#bars .st .fill'), stBar: $('#bars .st'),
  charge: $('#chargeRing'), chargeFg: $('#chargeRing .fg'),
  feed: $('#feed'), hint: $('#hint'), status: $('#status'), death: $('#deathScreen'), vignette: $('#vignette'),
  scoreboard: $('#scoreboard'), scoreBody: $('#scoreboard tbody'), clickToPlay: $('#clickToPlay'),
  botCount: $('#botCount'), botDiff: $('#botDiff'), botTally: $('#botTally'), volume: $('#volume'), mute: $('#mute'),
  pickNote: $('#pickNote'),
  ammo: [...document.querySelectorAll('#abilities .ammo i')],
  ab: Object.fromEntries([...document.querySelectorAll('.ab')].map(el => [el.dataset.ab, el])),
  ultFg: $('#abilities .ult .fg'), ultPct: $('#abilities .ult .pct'),
};

// ---------------------------------------------------------------- game state
const players = new Map();   // id -> Wizard
const props = new Map();     // id -> { data, mesh }
const goats = new Map();     // id -> GoatView
let me = null;               // local Wizard
let myId = null;

const local = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(),
  yaw: 0, pitch: 0.25,
  cd: { fast: 0, power: 0, mobility: 0, guard: 0, throw: 0 },   // per slot, like the server
  charging: false, chargeStart: 0, chargeSent: false,
  cyclone: null,               // { start, pulsed } during our own Arcane Cyclone
  lash: null,                  // { start, sent } during our own Sanguine Lash wind-up
  slowUntil: 0,                // Glacial Skim slow
  rootUntil: 0,                // bound by a lash, or recovering from our own missed lash
  silenceUntil: 0,             // bound: no spells, ward or telekinesis
  dash: null,                  // { start, dir } during our own Smoke Screen dash
  liftCdUntil: 0, wasHolding: false,       // telekinesis: no new lift for a while after letting go
  ammo: 3, reloadUntil: 0, lastShot: 0,   // primary magazine (predicted; the server's copy wins)
  frostAim: false,             // RMB held with Frostfall: aiming the circle
  frozenUntil: 0,              // frozen by a Frostfall (the bind, shown as ice)
  ult: 0,                      // ultimate charge (the server's, from snapshots)
  cataAim: false,              // Q held with Cataclysm or Night Cage: aiming the circle
  eyeUntil: 0, blizzUntil: 0,  // our own Eye of the Storm / Blizzard: nothing else can be cast
  ultWind: null,               // { start }: our ultimate's wind-up (predicted; fizzles if interrupted)
  mrain: null,                 // Meteor Rain: { phase, start, from, hoverUntil, diveFrom, diveTo, diveStart, lastAim } (the server flies us)
  pull: null,                  // { v: [x, z], until } dragged by an enemy Eye of the Storm
  ride: null,                  // Jeb's Ram Ride: { start, rideAt, dismountAt, endAt } (predicted; the server's 'ride' confirms)
  fHold: null,                 // { start } while F is held with nothing carried (Trapped Relic: hold to curse)
  flight: null,                // { start, drop } during our own Skyward Flash
  spaceHeld: false,            // Space was used to drop out of a flight: don't ward until it's released
  blocking: false,
  anim: 'idle',
  lastSend: 0,
  stunUntil: 0,
};
let now = 0;
const tmp = { v1: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3() };
const CYC = C.SPELLBOOK.cyclone, SKY = C.SPELLBOOK.skyward;

// ---------------------------------------------------------------- wizard choice
// The wizard we want (saved in localStorage). The server's copy (me.wizard) is what casts use; it
// differs only while a switch waits for a cast to end or for a respawn.
let wantWizard = C.DEFAULT_WIZARD;
try { const w = localStorage.getItem('wizardChoice'); if (C.isWizard(w)) wantWizard = w; } catch {}
const kit = () => C.kitOf(me ? me.wizard : wantWizard);
const SPELL = C.SPELLBOOK;
const FROST = SPELL.frostfall, SMOKE = SPELL.smoke_screen;
const EYE = SPELL.eye_of_storm, CAGE = SPELL.night_cage, BLIZ = SPELL.blizzard, MRAIN = SPELL.meteor_rain, ULT_WIND = C.ULT_CHARGE.windup;
const ULT_KINDS = new Set(['eye_of_storm', 'eye_burst', 'blizzard_freeze', 'meteor_rain_hit']);
const STAMP = SPELL.stampede, RIDE = SPELL.ram_ride, RGUARD = SPELL.ram_guard;
const AIMED_ULTS = { night_cage: CAGE, stampede: STAMP };   // hold Q to aim (a circle, or Stampede's lane), release; then the wind-up
const LASH = SPELL.sanguine_lash, MIRROR = SPELL.mirror_step, BULWARK = SPELL.glacial_bulwark, RELIC = SPELL.trapped_relic, SKIM = SPELL.glacial_skim;

function chooseWizard(id) {
  if (!C.isWizard(id)) return;
  if (id !== wantWizard) sfx.click();
  wantWizard = id;
  try { localStorage.setItem('wizardChoice', id); } catch {}
  for (const pk of pickers) pk.set(id);
  if (me) net.send({ t: 'wizard', id });
  updatePickNote();
}
function updatePickNote() {
  if (!ui.pickNote) return;
  const pending = me && me.wizard !== wantWizard;
  ui.pickNote.textContent = pending ? `switching to ${C.WIZARDS[wantWizard].name} when your cast ends or you respawn`
    : 'switches right away (after a cast in progress, or at respawn)';
  ui.pickNote.classList.toggle('pending', !!pending);
}
// The picker draws the cards (select.js). If it draws nothing (the stub), a plain <select> stands in.
function mountPicker(el) {
  const pk = mountWizardPicker(el, { selected: wantWizard, onChange: chooseWizard });
  if (el.childElementCount) return pk;
  el.innerHTML = `<div class="wiz-fallback"><select aria-label="Wizard">${Object.values(C.WIZARDS).map(w =>
    `<option value="${w.id}">${esc(w.name)}, ${esc(w.title)}</option>`).join('')}</select><div class="wf-role"></div><ul></ul></div>`;
  const sel = el.querySelector('select');
  const show = (id) => {
    sel.value = id;
    const w = C.WIZARDS[id];
    sel.style.borderColor = '#' + w.color.toString(16).padStart(6, '0');
    el.querySelector('.wf-role').textContent = w.role;
    el.querySelector('ul').innerHTML = C.KIT_SLOTS.map(slot => {
      const sp = SPELL[w.kit[slot]];
      return `<li><kbd>${C.SLOT_INFO[slot].key}</kbd> <b>${esc(sp?.name || w.kit[slot])}</b> · ${esc(sp?.blurb || '')}</li>`;
    }).join('');
  };
  sel.addEventListener('change', () => chooseWizard(sel.value));
  sel.addEventListener('keydown', (e) => e.stopPropagation());
  show(wantWizard);
  return { set: show, destroy() { el.innerHTML = ''; } };
}
const pickers = [mountPicker($('#joinPicker')), mountPicker($('#pausePicker'))];
const spellName = (id) => SPELL[id]?.name || id;
const shortName = (id) => SPELL[id]?.short || spellName(id);

// ---------------------------------------------------------------- loading
try {
  ui.name.value = localStorage.getItem('wizardName') || '';
  const bots = JSON.parse(localStorage.getItem('wizardBots') || 'null');
  if (bots) { ui.botCount.value = bots.count; ui.botDiff.value = bots.difficulty; }
} catch {}
ui.joinBtn.disabled = true;

const loader = new GLTFLoader();
const wizardLoaded = new Promise((res, rej) => loader.load('/models/wizard.glb', (gltf) => { registerModel(gltf); res(); }, (ev) => {
  if (ev.total) ui.loadStatus.textContent = `Loading wizard… ${Math.round(ev.loaded / ev.total * 100)}%`;
}, rej));
Promise.all([wizardLoaded.then(() => loadWizardModels(loader)), loadModels(loader, scene)]).then(() => {
  ui.loadStatus.textContent = 'Ready. Pick a name and enter.';
  ui.joinBtn.disabled = false;
  if (!ui.name.value) ui.name.value = 'Wizard' + Math.floor(Math.random() * 900 + 100);
  ui.name.focus();
}, (err) => {
  ui.loadStatus.textContent = 'Failed to load the models: ' + (err?.message || err);
});

ui.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (ui.joinBtn.disabled) return;
  const name = ui.name.value.trim() || 'Wizard';
  try {
    localStorage.setItem('wizardName', name);
    localStorage.setItem('wizardBots', JSON.stringify({ count: ui.botCount.value, difficulty: ui.botDiff.value }));
  } catch {}
  ui.joinBtn.disabled = true; ui.loadStatus.textContent = 'Connecting…';
  sfx.init(); sfx.resume();
  try {
    const welcome = await net.connect(name, wantWizard, ui.botDiff.value);   // game modes fill teams with bots at this difficulty
    onWelcome(welcome);
    for (let i = 0; i < +ui.botCount.value; i++) net.send({ t: 'addBot', difficulty: ui.botDiff.value });
  } catch (err) {
    ui.loadStatus.textContent = err.message || 'Connection failed';
    ui.joinBtn.disabled = false;
  }
});

// Pause menu (shown whenever the mouse isn't captured): resume, practice bots, volume.
ui.clickToPlay.addEventListener('click', (e) => { if (e.target === ui.clickToPlay) input.requestLock(); });
$('#resumeBtn').addEventListener('click', () => { sfx.click(); input.requestLock(); });
for (const b of document.querySelectorAll('[data-bot]')) b.addEventListener('click', () => { sfx.click(); net.send({ t: 'addBot', difficulty: b.dataset.bot }); });
$('#clearBots').addEventListener('click', () => { sfx.click(); net.send({ t: 'removeBots' }); });
ui.volume.value = Math.round(sfx.volume * 100);
ui.mute.checked = sfx.muted;
ui.volume.addEventListener('input', () => { sfx.volume = ui.volume.value / 100; if (sfx.muted) { sfx.muted = false; ui.mute.checked = false; } });
ui.mute.addEventListener('change', () => { sfx.muted = ui.mute.checked; });
input.onLockChange = (locked) => { ui.clickToPlay.classList.toggle('hidden', locked || !me); updateBotTally(); };
function updateBotTally() {
  const n = [...players.values()].filter(w => w.bot).length;
  ui.botTally.textContent = n ? `(${n} in arena)` : '';
}
net.onClose = () => {
  if (!me) return;
  ui.status.textContent = 'Disconnected from server — refresh to rejoin.';
  ui.status.style.color = '#ff5c6a';
};

// ---------------------------------------------------------------- network handlers
// Game modes UI (public/js/match-ui.js, modes agent)
const matchUI = mountMatchUI({ scene, camera, net, players, props, myId: () => myId });
let teamBots = false;   // a team mode is on (snap.match.teams)

function onWelcome(msg) {
  myId = msg.id;
  matchUI.onWelcome(msg);
  for (const p of msg.players) addPlayer(p);
  for (const pr of msg.props) setProp(pr, true);
  for (const pj of msg.projectiles) effects.spawnProjectile(withBolt(pj));
  for (const g of msg.goats || []) addGoat(g);
  for (const st of msg.stampedes || []) stampedeFx.set(st.id, Object.assign(effects.stampedeLane(st.p, st.dir, st.width, st.length, st.left), { owner: st.owner }));
  for (const w of msg.walls || []) wallUp(w);
  for (const f of msg.frostfalls || []) frosts.set(f.id, effects.frostfall(f.p, f.left));
  for (const c of msg.smokes || []) effects.smoke(c.p, c.left);
  for (const f of msg.firewalls || []) firewalls.set(f.id, { data: f, fx: effects.firewall(f) });
  for (const c of msg.cages || []) cages.set(c.id, { ...c, x: c.p[0], z: c.p[2], fx: effects.nightCage(c.p, c.left) });
  me = players.get(myId);
  for (const d of msg.decoys || []) spawnDecoy(d);
  local.pos.set(me.targetPos.x, 0, me.targetPos.z);
  updatePickNote();
  ui.join.classList.add('hidden');
  ui.hud.classList.remove('hidden');
  input.enabled = true;
  input.requestLock();
  feed(`Welcome, <b>${esc(me.name)}</b>. ${players.size - 1} other wizard${players.size === 2 ? '' : 's'} here.`);
}

// A goat (or one of Jeb's summoned rams) seen for the first time.
function addGoat(g) {
  const v = new GoatView(g, scene);   // goats.js gives summoned rams their size, gold tint and orbit/mount motion
  v.summoned = !!g.summoned; v.owner = g.owner ?? null;
  goats.set(g.id, v);
  return v;
}
const stampedeFx = new Map();   // Stampede lanes on the ground: id -> effects entry
const laneMark = effects.laneAim(STAMP.width, STAMP.length);

function addPlayer(info) {
  if (players.has(info.id)) return players.get(info.id);
  const w = new Wizard(info, scene, info.id === myId);
  applySnapshot(w, info);
  players.set(info.id, w);
  return w;
}

// A player switched wizard: rebuild their Wizard (model, ring and nameplate colour), keeping its state.
function rebuildWizard(w, wizard, color) {
  const g = w.group.position;
  const info = { id: w.id, name: w.name, color: color ?? C.WIZARDS[wizard].color, bot: w.bot, wizard, p: [g.x, g.y, g.z], yaw: w.group.rotation.y };
  stopWizardAudio(w);
  w.dispose(scene);
  const n = new Wizard(info, scene, w === me);
  for (const k of ['hp', 'st', 'kills', 'deaths', 'dead', 'blocking', 'charging', 'stunned', 'netAnim', 'targetYaw', 'bound', 'slowed', 'lashing', 'frozen', 'veiled', 'ult']) n[k] = w[k];
  n.targetPos.copy(w.targetPos);
  players.set(w.id, n);
  if (w.carrying) startCarry(n, w.carrying);
  if (w === me) { me = n; updatePickNote(); }
  if (scoreVisible) updateScoreboard();
  return n;
}

function applySnapshot(w, s) {
  if (s.wizard && s.wizard !== w.wizard) w = rebuildWizard(w, s.wizard, s.color);
  if (w !== me) {
    w.targetPos.set(s.p[0], s.p[1], s.p[2]);
    w.targetYaw = s.yaw;
    w.netAnim = s.anim;
  }
  w.hp = s.hp; w.st = s.st; w.kills = s.kills; w.deaths = s.deaths;
  w.blocking = s.blocking; w.charging = s.charging; w.stunned = s.stun;
  w.slowed = !!s.slow; w.bound = !!s.bound; w.lashing = !!s.lashing; w.frozen = !!s.frozen;
  w.ult = s.ult ?? 0;
  // game modes: the ring and nameplate wear the team colour (match.js), else the wizard's own
  const shown = s.teamColor ?? s.color;
  if (shown != null && shown !== w.shownColor) { w.setColor(shown); w.shownColor = shown; }
  if (!s.eye && w.eyeFx) endEye(w);                  // missed the end message
  // Black Death's absorbed damage rides on the next Lash: the coiled whip glows with it (looks.js)
  if ((s.lashBonus ?? 0) !== (w.lashBonus ?? 0)) { w.lashBonus = s.lashBonus ?? 0; w.body?.setWhipGlow?.(w.lashBonus / SPELL.black_death.maxBonus); }
  w.team = s.team ?? null;
  w.riding = !!s.ride; w.ramGuard = !!s.ramGuard;
  w.ultWinding = !!s.ultWind; w.blizz = s.blizz ?? null;
  if (w === me) {
    if (!s.ultWind && local.ultWind && now - local.ultWind.start > 0.5) local.ultWind = null;   // refused, fizzled or fired
  }
  if (s.veil !== undefined && !!s.veil !== w.veiled) w.veiled = !!s.veil;
  if (!s.lashing && w.lashT >= 0 && w !== me) w.endLash();
  if (s.dead !== w.dead) w.dead = s.dead;
  if (w === me) {
    local.ult = s.ult ?? 0;
    if (!s.blocking && local.blocking) { local.blocking = false; }   // server cancelled the ward
    if (!s.charging && local.charging && local.chargeSent) { local.charging = false; }
    if (!s.lashing && local.lash && local.lash.sent) { local.lash = null; me.endLash(); }
    if (s.liftCd > 0 && Math.abs(local.liftCdUntil - now - s.liftCd) > 0.3) local.liftCdUntil = now + s.liftCd;
    // the magazine: adopt the server's count when we haven't just fired (our prediction may be ahead)
    if (s.ammo !== undefined && now - local.lastShot > 0.4) {
      if (s.reload > 0) { if (!local.reloadUntil || Math.abs(local.reloadUntil - now - s.reload) > 0.25) { local.ammo = 0; local.reloadUntil = now + s.reload; } }
      else if (!local.reloadUntil && s.ammo !== local.ammo) local.ammo = s.ammo;
    }
  }
  if (s.carrying !== w.carrying) startCarry(w, s.carrying);
  w.carryingGoat = s.carryingGoat || null;
}

// Show wizard `w` holding prop `id` (or nothing). A prop still rising lifts from where it stood.
function startCarry(w, id) {
  w.carrying = id;
  const e = id ? props.get(id) : null;
  w.setCarry(e ? makePropMesh(e.data.type) : null, e && e.data.state === 'lifting' ? [e.data.x, 0, e.data.z] : null);
}

function setProp(data, initial = false) {
  let entry = props.get(data.id);
  if (!entry) {
    entry = { data, mesh: makePropMesh(data.type) };
    scene.add(entry.mesh);
    props.set(data.id, entry);
  }
  const prevState = entry.data.state;
  entry.data = data;
  entry.mesh.position.set(data.x, 0, data.z);
  entry.mesh.visible = data.state === 'idle';
  if (data.state === 'idle' && prevState === 'broken' && !initial) {
    entry.mesh.scale.setScalar(0.01); entry.spawnT = 0;   // pop-in
    effects.burst(new THREE.Vector3(data.x, 0.5, data.z), C.PROP_TYPES[data.type].color, 8, 2, 0.3, 0);
  }
  if (data.state === 'lifting' || data.state === 'carried') {
    const carrier = players.get(data.carrier);
    if (carrier && carrier.carrying !== data.id) startCarry(carrier, data.id);
  } else {
    // thrown, dropped or broken: nobody holds it any more
    for (const w of players.values()) if (w.carrying === data.id) startCarry(w, null);
  }
}

// Telekinesis gestures (looks.js clips): the arm raising a lift, the fling of a throw. Bodies without them
// fall back to the quick cast.
function tkGesture(w, clip) {
  const a = w.actions[clip];
  if (a) w.oneShot(clip, Math.min(0.9, a.getClip().duration), 1, 0);
  else w.oneShot('cast_fast', 0.4, 2.6, 0.3);
}

// A spark takes its caster's colour (constants: BOLT_COLORS).
function withBolt(pj) {
  const owner = players.get(pj.owner);
  return pj.kind === 'fast' && owner ? { ...pj, color: C.boltColor(owner.wizard) } : pj;
}

// Where a wizard's sounds come from (chest height).
function wpos(w) { return w.group.position.clone().setY(w.group.position.y + 1.1); }

function handleMessage(msg) {
  switch (msg.t) {
    case 'snap':
      for (const s of msg.players) {
        const w = players.get(s.id) || addPlayer(s);
        applySnapshot(w, s);
      }
      updateDecoys(msg.decoys || []);
      for (const g of msg.goats || []) { const v = goats.get(g.id) || addGoat(g); v.apply(g); }
      // a summoned ram no longer in the snapshot is gone, even if we missed its goatGone
      if (msg.goats) { const ids = new Set(msg.goats.map(g => g.id)); for (const [id, v] of goats) if (v.summoned && !ids.has(id)) { v.dispose(scene); goats.delete(id); } }
      matchUI.onSnapshot(msg);
      // team modes keep bots at 3v3 themselves: the practice-bot buttons don't apply
      if (!!msg.match?.teams !== teamBots) {
        teamBots = !!msg.match?.teams;
        for (const b of document.querySelectorAll('[data-bot], #clearBots')) { b.disabled = teamBots; b.title = teamBots ? 'Team modes fill bots to 3v3 automatically' : ''; }
      }
      break;
    case 'goatAngry': {
      const g = goats.get(msg.id);
      if (g) { g.apply({ p: [g.target.x, g.target.z], yaw: g.targetYaw, s: 'windup', tgt: msg.target }); sfx.bleat(g.group.position.clone().setY(1)); }
      if (msg.target === myId) feed('You angered a goat! <b>Ward (Space) facing it</b> or get out of the way');
      break;
    }
    case 'goatRam': {
      const target = players.get(msg.target);
      effects.ram(msg.p, msg.blocked);
      sfx.goatRam(msg.p, msg.blocked);
      if (target === me) {
        shake(msg.blocked ? 0.5 : 1.0);
        if (msg.blocked) { local.vel.x += msg.dir[0] * C.GOAT.blockKnockback; local.vel.z += msg.dir[2] * C.GOAT.blockKnockback; feed('Your ward stopped the goat!'); }
      } else if (Math.hypot(msg.p[0] - local.pos.x, msg.p[2] - local.pos.z) < 12) shake(0.3);
      if (target && msg.blocked) target.oneShot('stun', 0.45, 3.0, 0.3);
      break;
    }
    case 'goatBonk': {
      sfx.goatBonk(msg.p);
      effects.burst(new THREE.Vector3(msg.p[0], msg.p[1], msg.p[2]), 0xffe066, 12, 3, 0.35);
      break;
    }
    case 'joined': {
      const w = addPlayer(msg.player);
      if (w !== me) feed(`<b>${esc(w.name)}</b> entered the arena${w.bot ? ` <span style="opacity:.6">(${w.bot} bot)</span>` : ''}`);
      updateBotTally();
      break;
    }
    case 'leave': {
      const w = players.get(msg.id);
      if (w) { feed(`<b>${esc(w.name)}</b> left`); stopWizardAudio(w); w.dispose(scene); players.delete(msg.id); updateBotTally(); }
      break;
    }
    case 'proj': {
      effects.spawnProjectile(withBolt(msg));
      const owner = players.get(msg.owner);
      if (owner) {
        if (msg.kind === 'fast') { owner.oneShot('cast_fast', 0.45, 2.6, 0.25); msg.fin ? sfx.castFinisher(msg.p) : sfx.castFast(msg.p); }
        else if (msg.kind === 'fireball') { owner.oneShot('cast_fast', 0.5, 2.3, 0.25); msg.fin ? sfx.castFinisher(msg.p) : sfx.play('spark_cast', { pos: msg.p, vol: 0.7, rate: 0.85 }); }
        else if (msg.kind === 'shear') { owner.oneShot('cast_fast', 0.35, 3, 0.25); sfx.play('tk_throw', { pos: msg.p, vol: msg.fin ? 0.9 : 0.6, rate: msg.fin ? 1.3 : 1.7, jitter: 0.08 }); }
        else if (msg.kind === 'hex') { owner.oneShot('cast_fast', 0.45, 2.6, 0.25); sfx.play('mirror_step', { pos: msg.p, vol: 0.45, rate: 1.5 + (msg.curve?.shot ?? 0) * 0.15, jitter: 0.04 }); if (msg.fin) sfx.castFinisher(msg.p); }
        else if (msg.kind === 'skim') { if (!owner.inOneShot()) { owner.oneShot('cast_fast', 0.4, 2.8, 0.25); msg.fin ? sfx.castFinisher(msg.p) : sfx.castSkim(msg.p); } }   // three per cast
        else if (msg.kind === 'lash') {
          // a body with its own lash clip is already mid-strike: let the follow-through play
          if (!owner.actions.lash) owner.oneShot('cast_heavy', 0.5, 1.8, 1.9);
          owner.lashT = -1; owner.lashing = false; sfx.lashCrack(msg.p);
        }
        else if (msg.kind === 'heavy') { owner.charging = false; owner.oneShot('cast_heavy', 0.55, 1.5, 1.9); sfx.castHeavy(msg.p); }
        else { tkGesture(owner, 'tk_throw'); sfx.throw_(msg.p); if (owner.carrying) startCarry(owner, null); }
      }
      break;
    }
    case 'projEnd': {
      const pr = effects.projectiles.get(msg.id);
      effects.endProjectile(msg);
      if (msg.hit && pr) {
        const d = Math.hypot(msg.p[0] - local.pos.x, msg.p[2] - local.pos.z);
        if (pr.kind === 'heavy') { sfx.bigImpact(msg.p); shake(0.5 / (1 + d * 0.15)); trampleCrops(msg.p[0], msg.p[2], 2.5); }
        else if (msg.surface !== 'player' && pr.kind === 'fast') sfx.impact(msg.p);
        else if (pr.kind === 'skim') sfx.shardHit(msg.p);
        if (msg.surface === 'firewall') { effects.burnUp(msg.p); sfx.play('meteor_cast', { pos: msg.p, vol: 0.5, rate: 1.6, jitter: 0.1 }); }
      }
      break;
    }
    case 'hit': {
      const target = players.get(msg.target);
      if (!target) break;
      const c = target.group.position.clone(); c.y += 1;
      if (msg.veil) { target.veilFlash(); effects.burst(c, 0xe8dcff, 8, 3, 0.25, 0); sfx.block(c); }
      else if (msg.blocked) { const G = C.kitOf(target.wizard).guard; effects.blockFlash(c, G === 'black_death' ? 0xa0102a : 0x9ae4ff); sfx.block(c); }
      else {
        effects.burst(c, msg.kind === 'skim' ? 0xbfeaff : 0xff3b4e, 10, 3, 0.35);
        // a hurled prop or goat doubles them over (hit_waist); other interrupting hits flinch
        if ((msg.kind === 'prop' || msg.kind === 'goat') && target.actions.hit_waist) target.oneShot('hit_waist', target.actions.hit_waist.getClip().duration, 1, 0);
        else if (C.hitSpec(msg.kind)?.stun !== 0 && msg.int !== false) target.oneShot('stun', msg.kind === 'heavy' ? 0.5 : 0.55, 3.0, 0.3);
        sfx.hitBody(c);
        if (msg.slow) target.slowed = true;
        if (msg.launch) target.launch(msg.launch);
        if (msg.bind && (msg.freeze || msg.kind === 'frostfall')) { target.bound = true; target.frozen = true; target.endLash(); target.cancelCyclone(); target.oneShot('stun', 0.15, 3, 0.3); }
        else if (msg.bind) { target.bound = true; target.endLash(); target.cancelCyclone(); effects.bind([c.x, c.y - 1, c.z]); sfx.bind(c); target.oneShot('stun', msg.bind, 0.6, 0.2); }
      }
      if (target === me) {
        if (!msg.blocked) {
          sfx.hurt(); flashVignette(); shake(msg.kind === 'heavy' || msg.kind === 'cyclone' || msg.kind === 'trapped_relic' || ULT_KINDS.has(msg.kind) ? 0.6 : 0.25);
          if (msg.int !== false) local.stunUntil = Math.max(local.stunUntil, now + (C.hitSpec(msg.kind)?.stun ?? 0.4));
          if (msg.slow) local.slowUntil = now + msg.slow;
          if (msg.bind) {
            local.rootUntil = Math.max(local.rootUntil, now + msg.bind); local.silenceUntil = Math.max(local.silenceUntil, now + msg.bind); local.vel.set(0, 0, 0);
            local.frostAim = false;
            if (msg.freeze || msg.kind === 'frostfall') { local.frozenUntil = now + msg.bind; feed(`Frozen by <b>${esc(players.get(msg.attacker)?.name || '?')}</b>'s ${esc(C.hitSpec(msg.kind)?.name || 'ice')}!`); }
            else feed(`Bound by <b>${esc(players.get(msg.attacker)?.name || '?')}</b>'s lash!`);
          }
        }
        // knockback (none while rooted)
        if (now >= local.rootUntil) { local.vel.x += msg.dir[0] * msg.kb; local.vel.z += msg.dir[2] * msg.kb; }
        // only an interrupting hit (anything but the first two shots of a magazine) breaks a cast
        const breaks = !msg.blocked && msg.int !== false;
        if (breaks && local.charging) local.charging = false;
        if (breaks && local.lash) { local.lash = null; me.endLash(); }
        if (breaks && local.cyclone && !local.cyclone.pulsed) { local.cyclone = null; me.cancelCyclone(); }
        if (breaks) { local.frostAim = false; local.cataAim = false; }
      }
      if (msg.attacker === myId && msg.dmg > 0) hitmarker();
      break;
    }
    case 'blockBreak': {
      const w = players.get(msg.id);
      if (!w) break;
      sfx.blockBreak(wpos(w));
      effects.burst(w.group.position.clone().add(new THREE.Vector3(0, 1, 0)), 0x9ae4ff, 24, 5, 0.4);
      if (w === me) { local.blocking = false; local.stunUntil = now + C.BLOCK_BREAK_STUN; flashVignette(); feed('Your ward shattered!'); }
      w.blocking = false;
      break;
    }
    case 'chargeStart': {
      const w = players.get(msg.id);
      if (w) w.charging = true;   // its hum is started by updateWizardAudio()
      break;
    }
    case 'chargeCancel': {
      const w = players.get(msg.id);
      if (w) { w.charging = false; if (w === me) { local.charging = false; } }
      break;
    }
    case 'cycloneStart': {
      const w = players.get(msg.id);
      if (!w) break;
      if (w !== me || w.cycloneT < 0) w.startCyclone();   // our own was started locally
      sfx.cycloneWindup(wpos(w));
      break;
    }
    case 'cycloneCancel': {
      const w = players.get(msg.id);
      if (!w) break;
      w.cancelCyclone();
      if (w === me) local.cyclone = null;
      break;
    }
    case 'cyclonePulse': {
      const w = players.get(msg.id);
      const p = w === me ? [local.pos.x, local.pos.y, local.pos.z] : msg.p;
      effects.cyclonePulse(p, CYC.radius);
      trampleCrops(p[0], p[2], CYC.radius);
      sfx.cyclonePulse(p);
      if (w) w.spin();
      if (w === me && local.cyclone) { local.cyclone.pulsed = true; local.cd.power = now + CYC.cooldown; }
      // everyone inside the radius feels it
      if (Math.hypot(p[0] - local.pos.x, p[2] - local.pos.z) < CYC.radius + 1 && Math.abs(p[1] - local.pos.y) < CYC.height) shake(w === me ? 0.35 : 0.7);
      for (const h of msg.hits) if (h.id === myId && !h.blocked) feed(`Caught in <b>${esc(w?.name || '?')}</b>'s cyclone`);
      break;
    }
    case 'skyward': {
      const w = players.get(msg.id);
      if (!w) break;
      const p = w === me ? [local.pos.x, 0, local.pos.z] : msg.p;
      effects.skyward(p, msg.top);
      sfx.skyward([p[0], 1, p[2]]);
      w.oneShot('dash', 0.5, 2.5, 2.2);
      if (w !== me) { w.targetPos.set(msg.p[0], msg.top, msg.p[2]); w.group.position.copy(w.targetPos); }
      break;
    }
    case 'skywardCancel':
      if (msg.id === myId && local.flight) { local.flight = null; local.pos.y = 0; }
      break;
    case 'wizard': {
      const w = players.get(msg.id);
      if (w && w.wizard !== msg.wizard) {
        const n = rebuildWizard(w, msg.wizard, msg.color);
        effects.teleport([n.group.position.x, n.group.position.y, n.group.position.z], [n.group.position.x, n.group.position.y, n.group.position.z]);
        if (n === me) feed(`You are now <b>${esc(C.WIZARDS[msg.wizard].name)}</b>, ${esc(C.WIZARDS[msg.wizard].title)}`);
      }
      break;
    }
    case 'lashStart': {
      const w = players.get(msg.id);
      if (!w) break;
      if (w !== me || w.lashT < 0) w.startLash();   // our own was started locally
      w.lashing = true;
      sfx.cycloneWindup(wpos(w));
      break;
    }
    case 'lashCancel': {
      const w = players.get(msg.id);
      if (!w) break;
      w.endLash(); w.lashing = false;
      if (w === me) local.lash = null;
      break;
    }
    case 'lashMiss': {
      const w = players.get(msg.id);
      if (!w) break;
      w.oneShot('stun', msg.root, 0.5, 0.2);   // recovery: doubled over, rooted
      if (w === me) { local.rootUntil = Math.max(local.rootUntil, now + msg.root); local.vel.set(0, 0, 0); feed('Your lash missed: <b>recovering</b>'); }
      break;
    }
    case 'mirror': {
      const w = players.get(msg.id);
      if (!w) break;
      effects.mirror(msg.from, [msg.to, ...msg.decoys.map(d => d.p)]);
      sfx.mirror([msg.from[0], 1, msg.from[2]]);
      w.oneShot('dash', 0.4, 2.5, 2.2);
      if (w === me) { local.pos.set(msg.to[0], 0, msg.to[2]); local.vel.multiplyScalar(0.5); }
      else { w.targetPos.set(msg.to[0], 0, msg.to[2]); w.group.position.copy(w.targetPos); w.targetYaw = msg.yaw; w.group.rotation.y = msg.yaw; }
      for (const d of msg.decoys) spawnDecoy({ ...d, owner: msg.id });
      break;
    }
    case 'decoyEnd': {
      const d = decoys.get(msg.id);
      if (!d) break;
      effects.decoyPuff(msg.p, d.wiz.color, msg.popped);
      if (msg.popped) sfx.decoyPop([msg.p[0], 1, msg.p[2]]);
      removeDecoy(msg.id);
      break;
    }
    case 'goatLift': {
      const w = players.get(msg.id);
      if (w) { w.carryingGoat = msg.goat; tkGesture(w, 'tk_lift'); sfx.pickup(wpos(w)); }
      break;
    }
    case 'goatThrow': {
      const w = players.get(msg.id);
      if (w) { w.carryingGoat = null; tkGesture(w, 'tk_throw'); sfx.throw_(msg.p); }
      break;
    }
    case 'veil': {
      const w = players.get(msg.id);
      if (!w) break;
      w.veiled = true;
      const g = w.group.position;
      effects.veilGust([g.x, g.y, g.z]);
      sfx.veilUp([g.x, g.y + 1, g.z]);
      break;
    }
    case 'veilEnd': {
      const w = players.get(msg.id);
      if (!w) break;
      w.veiled = false;
      const g = w.group.position;
      if (!w.dead) { effects.veilPop([g.x, g.y, g.z]); sfx.veilDown([g.x, g.y + 1, g.z]); }
      break;
    }
    case 'smoke': {
      effects.smoke(msg.p, msg.left);
      const w = players.get(msg.owner);
      if (w) {
        if (w.actions.back) w.oneShot('back', SMOKE.dashTime + 0.1, w.actions.back.getClip().duration / (SMOKE.dashTime + 0.1) * 0.5, 0);
        else w.oneShot('dash', SMOKE.dashTime + 0.1, 2.5, 2.2);
        sfx.smoke([msg.p[0], 1, msg.p[2]]);
      }
      break;
    }
    case 'frostfall': {
      frosts.set(msg.id, effects.frostfall(msg.p, msg.left));
      const w = players.get(msg.owner);
      if (w) { w.oneShot('cast_heavy', FROST.castPose, 1.5, 1.9); sfx.frostCast(wpos(w)); }
      if (Math.hypot(msg.p[0] - local.pos.x, msg.p[2] - local.pos.z) < FROST.radius + 0.5 && msg.owner !== myId) feed('<b>Ice from above!</b> Get out of the shadow');
      break;
    }
    case 'frostfallHit': {
      effects.frostfallImpact(frosts.get(msg.id), msg.p);
      frosts.delete(msg.id);
      sfx.frostImpact([msg.p[0], 0.5, msg.p[2]]);
      trampleCrops(msg.p[0], msg.p[2], FROST.radius);
      const d = Math.hypot(msg.p[0] - local.pos.x, msg.p[2] - local.pos.z);
      shake(d < FROST.radius + 1 ? 0.9 : 0.7 / (1 + d * 0.2));
      break;
    }
    case 'wallUp': wallUp(msg.wall, true); break;
    case 'wallHit': {
      const w = walls.get(msg.id);
      if (!w) break;
      w.fx.setHp(msg.hp);
      sfx.wallHit([w.data.x, 1.3, w.data.z]);
      break;
    }
    case 'wallDown': {
      const w = walls.get(msg.id);
      if (!w) break;
      C.removeWallColliders(msg.id);
      effects.wallShatter(w.fx, w.data);
      sfx.wallShatter([w.data.x, 1.3, w.data.z]);
      walls.delete(msg.id);
      break;
    }
    case 'curse':
      // only ever sent to the curser
      if (msg.id && msg.id !== cursedProp) sfx.curse();
      cursedProp = msg.id;
      break;
    case 'relicBlast': {
      effects.relicBlast(msg.p, RELIC.radius);
      sfx.relicBlast(msg.p);
      const d = Math.hypot(msg.p[0] - local.pos.x, msg.p[2] - local.pos.z);
      shake(d < RELIC.radius + 1 ? 0.9 : 0.6 / (1 + d * 0.2));
      const by = players.get(msg.by), victim = players.get(msg.victim);
      if (victim === me) feed(`It was a trap! <b>${esc(by?.name || '?')}</b> cursed that object`);
      else if (by === me) feed(`Your relic went off in <b>${esc(victim?.name || '?')}</b>'s hands`);
      break;
    }
    case 'tp': {
      const w = players.get(msg.id);
      effects.teleport(msg.from, msg.to);
      if (w) {
        sfx.teleport(msg.to);
        w.oneShot('dash', 0.5, 2.5, 2.2);
        if (w !== me) { w.targetPos.set(msg.to[0], 0, msg.to[2]); w.group.position.copy(w.targetPos); }
        else if (local.pos.distanceTo(new THREE.Vector3(msg.to[0], 0, msg.to[2])) > 1.5) local.pos.set(msg.to[0], 0, msg.to[2]);
      }
      break;
    }
    case 'prop':
      if (msg.prop.state === 'lifting') { sfx.pickup([msg.prop.x, 0.6, msg.prop.z]); const w = players.get(msg.prop.carrier); if (w) tkGesture(w, 'tk_lift'); }
      setProp(msg.prop);
      break;
    case 'propBreak': {
      const e = props.get(msg.id);
      if (e) {
        e.data.state = 'broken'; e.mesh.visible = false;
        effects.propBreak(e.data.type, msg.p);
        sfx.shatter(msg.p, e.data.type);
        for (const w of players.values()) if (w.carrying === msg.id) startCarry(w, null);
      }
      break;
    }
    case 'death': {
      const w = players.get(msg.id);
      const k = players.get(msg.killer);
      if (!w) break;
      w.dead = true;
      effects.death([w.group.position.x, 0, w.group.position.z]);
      sfx.death(wpos(w));
      if (w === me) {
        ui.death.querySelector('.big').textContent = msg.cause === 'goat' ? 'Rammed by a goat' : msg.cause === 'ram' ? 'Flattened by a ram' : 'You were vanquished';
        ui.death.classList.remove('hidden'); local.charging = false; local.blocking = false;
        local.cyclone = null; local.flight = null; local.pos.y = 0; local.lash = null; local.fHold = null;
        local.slowUntil = local.rootUntil = local.silenceUntil = local.frozenUntil = 0; local.frostAim = false;
        local.cataAim = false; local.eyeUntil = local.blizzUntil = 0; local.pull = null; local.ride = null; local.ultWind = null; local.mrain = null;
      }
      if (msg.killer === myId && msg.id !== myId) sfx.killSting();   // our kill (goat kills credited to us too)
      if (msg.cause === 'goated' && k) feed(`<b>${esc(k.name)}</b> goated <b>${esc(w.name)}</b>`);
      else if (msg.cause === 'goat') feed(`<b>${esc(w.name)}</b> was rammed by a goat${k && k !== w ? ` (thanks, <b>${esc(k.name)}</b>)` : ''}`);
      else if (msg.cause === 'ram' && k) feed(`<b>${esc(k.name)}</b>'s ram flattened <b>${esc(w.name)}</b>`);
      else if (k && k !== w) feed(`<b>${esc(k.name)}</b> vanquished <b>${esc(w.name)}</b>`);
      else feed(`<b>${esc(w.name)}</b> perished`);
      break;
    }
    case 'respawn': {
      const w = players.get(msg.id);
      if (!w) break;
      w.dead = false;
      w.bound = w.slowed = w.frozen = false;
      if (w === me) { local.pos.set(msg.p[0], 0, msg.p[2]); local.vel.set(0, 0, 0); ui.death.classList.add('hidden'); local.stunUntil = 0; local.slowUntil = local.rootUntil = local.silenceUntil = 0; }
      else { w.targetPos.set(msg.p[0], 0, msg.p[2]); w.group.position.copy(w.targetPos); }
      effects.teleport(msg.p, msg.p);
      sfx.respawn([msg.p[0], 1, msg.p[2]]);
      break;
    }
    // ---- ultimates
    case 'ult': {
      const w = players.get(msg.id);
      if (!w) break;
      if (w === me) { local.ult = 0; local.cataAim = false; }
      feed(`<b>${esc(w.name)}</b> unleashes <b>${esc(SPELL[msg.ult]?.name || 'an ultimate')}</b>!`);
      sfx.play('meteor_cast', { pos: wpos(w), vol: 0.7, rate: 0.6 });
      break;
    }
    case 'ultRefused':
      local.cataAim = false;
      break;
    case 'eyeStart': {
      const w = players.get(msg.id);
      if (!w) break;
      if (w.eyeFx) effects.stopEye(w.eyeFx);
      w.eyeFx = effects.eyeStorm(w.group); w.eyeOn = true;
      w.eyeSpin();
      if (w === me) local.eyeUntil = now + msg.left;
      sfx.cyclonePulse(wpos(w));
      if (w !== me && Math.hypot(w.group.position.x - local.pos.x, w.group.position.z - local.pos.z) < EYE.radius + 3) feed('<b>A tornado!</b> Get away from it');
      break;
    }
    case 'eyePull':
      for (const pl of msg.pulls) if (pl.id === myId) local.pull = { v: pl.v, until: now + 0.2 };
      break;
    case 'eyeTick': {
      const w = players.get(msg.id);
      if (w) sfx.play('tk_throw', { pos: wpos(w), vol: 0.6, rate: 0.6 + Math.random() * 0.2 });
      break;
    }
    case 'eyeBurst': {
      const w = players.get(msg.id);
      const p = w === me ? [local.pos.x, local.pos.y, local.pos.z] : msg.p;
      effects.eyeBurst(p);
      sfx.cyclonePulse(p);
      trampleCrops(p[0], p[2], EYE.radius * 0.6);
      if (Math.hypot(p[0] - local.pos.x, p[2] - local.pos.z) < EYE.radius + 1) shake(0.7);
      break;
    }
    case 'eyeEnd': {
      const w = players.get(msg.id);
      if (w) endEye(w);
      if (msg.id === myId) local.eyeUntil = 0;
      break;
    }
    case 'ultWindup': {
      const w = players.get(msg.id);
      if (!w) break;
      w.ultWinding = true;
      w.oneShot(w.actions.ult ? 'ult' : 'cast_heavy', msg.left, w.actions.ult ? w.actions.ult.getClip().duration / msg.left : 0.9, w.actions.ult ? 0 : 0.3);
      effects.ultTell(w.group, msg.left, C.boltColor(w.wizard));
      sfx.play('tk_lift', { pos: wpos(w), vol: 1, rate: 0.45 });
      sfx.play('meteor_cast', { pos: wpos(w), vol: 0.5, rate: 0.4, delay: 0.3 });
      if (w === me && !local.ultWind) local.ultWind = { start: now };
      if (w !== me && Math.hypot(w.group.position.x - local.pos.x, w.group.position.z - local.pos.z) < 30) feed(`<b>${esc(w.name)}</b> is calling <b>${esc(SPELL[msg.ult]?.name || 'an ultimate')}</b>! Interrupt it`);
      break;
    }
    case 'ultFizzle': {
      const w = players.get(msg.id);
      if (!w) break;
      w.ultWinding = false; w.oneShotUntil = 0;
      effects.ultFizzle(w.group.position);
      sfx.play('ward_break', { pos: wpos(w), vol: 0.7, rate: 0.7 });
      if (w === me) { local.ultWind = null; feed(`Your <b>${esc(SPELL[msg.ult]?.name || 'ultimate')}</b> fizzled (half the charge is kept)`); }
      else feed(`<b>${esc(w.name)}</b>'s ${esc(SPELL[msg.ult]?.name || 'ultimate')} fizzled`);
      break;
    }
    case 'blizzard': {
      const w = players.get(msg.id);
      if (!w) break;
      w.blizzYaw = msg.yaw;
      if (w.blizzFx) effects.stopBlizzard(w.blizzFx);
      w.blizzFx = effects.blizzard(w, msg.left);
      w.oneShot('cast_heavy', msg.left, 0.4, 1.2);
      sfx.play('skim_cast', { pos: wpos(w), vol: 1, rate: 0.5 });
      sfx.frostCast(wpos(w));
      if (w === me) { local.blizzUntil = now + msg.left; local.rootUntil = Math.max(local.rootUntil, now + msg.left); local.vel.set(0, 0, 0); }
      break;
    }
    case 'blizzardEnd': {
      const w = players.get(msg.id);
      if (w?.blizzFx) { effects.stopBlizzard(w.blizzFx); w.blizzFx = null; }
      if (msg.id === myId) local.blizzUntil = 0;
      break;
    }
    case 'mrainLeap': {
      const w = players.get(msg.id);
      if (!w) break;
      effects.fireLaunch(msg.p, msg.top);
      sfx.play('meteor_cast', { pos: [msg.p[0], 1, msg.p[2]], vol: 1.1, rate: 0.7 });
      sfx.skyward([msg.p[0], 1, msg.p[2]]);
      w.mrainAura = effects.flameAura(w.group);
      if (w === me) { local.ultWind = null; local.mrain = { phase: 'rise', start: now, from: [msg.p[0], msg.p[2]], top: msg.top, rise: msg.rise, hoverUntil: now + msg.rise + msg.hover, lastAim: 0 }; }
      break;
    }
    case 'mrainAim': {
      if (msg.id === myId) break;   // ours is drawn from the crosshair
      const w = players.get(msg.id);
      if (!w) break;
      w.mrainMark ??= effects.cataAim(MRAIN.radius, 0xff3a0a, 0xff8040);
      w.mrainMark.visible = true; w.mrainMark.position.set(msg.at[0], 0, msg.at[1]);
      break;
    }
    case 'mrainDive': {
      const w = players.get(msg.id);
      effects.blazeDive(msg.from, msg.to, msg.left);
      sfx.play('meteor_cast', { pos: msg.to, vol: 1.2, rate: 0.55 });
      if (w?.mrainMark) { w.mrainMark.visible = true; w.mrainMark.position.set(msg.to[0], 0, msg.to[2]); }
      if (msg.id === myId && local.mrain) Object.assign(local.mrain, { phase: 'dive', diveFrom: msg.from, diveTo: msg.to, diveStart: now, dive: msg.left });
      break;
    }
    case 'mrainLand': {
      const w = players.get(msg.id);
      effects.scorch(msg.p, !!msg.wall);
      sfx.play('impact_big', { pos: [msg.p[0], 0.5, msg.p[2]], vol: 1.4, rate: 0.6 });
      sfx.play('meteor_cast', { pos: [msg.p[0], 0.5, msg.p[2]], vol: 0.8, rate: 0.5, delay: 0.03 });
      trampleCrops(msg.p[0], msg.p[2], MRAIN.radius);
      const d = Math.hypot(msg.p[0] - local.pos.x, msg.p[2] - local.pos.z);
      shake(d < MRAIN.radius + 2 ? 1 : 0.6 / (1 + d * 0.15));
      endMrain(w);
      if (msg.id === myId) { local.mrain = null; local.pos.set(msg.p[0], 0, msg.p[2]); local.vel.set(0, 0, 0); }
      break;
    }
    case 'mrainFall': {
      const w = players.get(msg.id);
      endMrain(w);
      if (w) feed(`<b>${esc(w.name)}</b> was knocked out of the sky!`);
      if (msg.id === myId) { local.mrain = null; local.pos.y = msg.p[1]; local.flight = { start: now - SKY.floatTime, last: now, drop: true }; }
      break;
    }
    case 'mrainEnd': {
      endMrain(players.get(msg.id));
      if (msg.id === myId) local.mrain = null;
      break;
    }
    case 'cage': {
      cages.set(msg.id, { ...msg, x: msg.p[0], z: msg.p[2], fx: effects.nightCage(msg.p, msg.left) });
      const w = players.get(msg.owner);
      if (w) { w.oneShot('cast_heavy', CAGE.castPose, 1.5, 1.9); sfx.play('wall_up', { pos: [msg.p[0], 1, msg.p[2]], vol: 1, rate: 0.6 }); sfx.bind([msg.p[0], 1, msg.p[2]]); }
      if (msg.foes.includes(myId)) feed(msg.inside.includes(myId) ? `<b>Caged!</b> You can't leave <b>${esc(w?.name || '?')}</b>'s Night Cage` : `<b>${esc(w?.name || '?')}</b>'s Night Cage: you can't get in`);
      break;
    }
    case 'cageSide': {
      const c = cages.get(msg.id);
      if (c) { c.inside = c.inside.filter(id => id !== msg.pid); if (msg.inside) c.inside.push(msg.pid); }
      break;
    }
    case 'cageEnd': {
      const c = cages.get(msg.id);
      if (c) { effects.endCage(c.fx); cages.delete(msg.id); }
      break;
    }
    case 'firewall': {
      firewalls.set(msg.id, { data: msg, fx: effects.firewall(msg) });
      const w = players.get(msg.owner);
      if (w) w.oneShot('cast_fast', 0.45, 2.2, 0.25);
      sfx.play('spark_cast', { pos: [msg.x, 1, msg.z], vol: 1, rate: 0.55 });   // Ty's fireball sound, deeper: the ignite
      sfx.play('meteor_cast', { pos: [msg.x, 1, msg.z], vol: 0.6, rate: 0.8, delay: 0.04 });
      break;
    }
    case 'firewallEnd': {
      const f = firewalls.get(msg.id);
      if (f) { effects.endFirewall(f.fx); firewalls.delete(msg.id); }
      break;
    }
    default:
      if (msg.t.startsWith('match')) matchUI.onMessage(msg);
  }
}

// ---------------------------------------------------------------- decoys, walls, curses
// Mirror Step decoys: full Wizards that look exactly like their caster (see-through on the caster's screen).
const decoys = new Map();    // id -> { wiz, owner }
function spawnDecoy(d) {
  if (decoys.has(d.id)) return;
  const owner = players.get(d.owner);
  if (!owner) return;
  const wiz = new Wizard({ id: owner.id, name: owner.name, color: owner.color, bot: owner.bot, wizard: owner.wizard, p: d.p, yaw: d.yaw }, scene, false);
  wiz.hp = owner.hp; wiz.netAnim = 'run';
  if (owner === me) wiz.makeGhost();
  decoys.set(d.id, { wiz, owner: d.owner });
}
function removeDecoy(id) {
  const d = decoys.get(id);
  if (!d) return;
  d.wiz.dispose(scene);
  decoys.delete(id);
}
function updateDecoys(list) {
  const seen = new Set();
  for (const d of list) {
    seen.add(d.id);
    if (!decoys.has(d.id)) spawnDecoy(d);
    const e = decoys.get(d.id);
    if (e) { e.wiz.targetPos.set(d.p[0], d.p[1], d.p[2]); e.wiz.targetYaw = d.yaw; }
  }
  for (const id of [...decoys.keys()]) if (!seen.has(id)) removeDecoy(id);
}

// Glacial Bulwark walls: their circles go into the shared collider list, so movement, the camera and
// aiming all treat them like any other obstacle.
const walls = new Map();     // id -> { data, fx }
// Frostfall warnings on the ground (everyone sees them), and our own targeting circle.
const frosts = new Map();    // id -> effects entry
// Cataclysm meteors on their way down, and our Cataclysm targeting circle.
// Meteor Rain: our aim circle up there, and the cleanup when anyone's ends.
const mrainMark = effects.cataAim(MRAIN.radius, 0xff5a1e, 0xffc080);
function endMrain(w) {
  if (!w) return;
  if (w.mrainMark) w.mrainMark.visible = false;
  if (w.mrainAura) { effects.stopAura(w.mrainAura); w.mrainAura = null; }
}
function endEye(w) { effects.stopEye(w.eyeFx); w.eyeFx = null; w.eyeOn = false; }
// Cinder's Firewalls: id -> { data, fx }.
const firewalls = new Map();
// Night Cages (id -> { x, z, inside: [ids], foes: [ids], fx }), and Vesper's aim circle for one.
const cages = new Map();
const cageMark = effects.cataAim(CAGE.radius, 0x2a0010, 0xff1f3d);
// Keep `pos` ([x, y, z], mutated) on our side of every enemy cage, as the server does. True if it moved.
function cageKeep(pos) {
  let moved = false;
  for (const c of cages.values()) if (c.foes.includes(myId) && C.cageClamp(pos, c, c.inside.includes(myId))) moved = true;
  return moved;
}
// Ram Ride timing (as the server times it): mount, gallop, dismount.
function rideTimes(msg) {
  const start = now;
  return { start, rideAt: start + (msg?.mount ?? RIDE.mount), dismountAt: start + (msg?.mount ?? RIDE.mount) + (msg?.ride ?? RIDE.distance / RIDE.speed),
    endAt: start + (msg?.mount ?? RIDE.mount) + (msg?.ride ?? RIDE.distance / RIDE.speed) + (msg?.dismount ?? RIDE.dismount) };
}
// Gale's tornado spin, every frame.
function updateUltimates() {
  for (const w of players.values()) if (w.eyeOn && !w.dead && (w.spinT < 0 || !w.inOneShot())) w.eyeSpin();
}
let lastDashDir = [0, 0];
const frostMark = effects.frostAim();
function wallUp(w, fresh = false) {
  if (walls.has(w.id)) return;
  C.addWallColliders(w.id, w.x, w.z, w.yaw);
  const fx = effects.wall(w);
  if (!fresh) { fx.rise = 1; fx.group.scale.y = 1; }   // already standing when we joined
  walls.set(w.id, { data: w, fx });
  if (fresh) sfx.wallUp([w.x, 1, w.z]);
}

// Smoke Screen: anyone inside a cloud is hidden from us unless we're inside the same cloud.
function updateSmokeHiding(dt) {
  const t = performance.now() / 1000;
  const clouds = [...(effects.smokes || [])].filter(c => t < c.endAt);
  const cloudsAt = (p) => clouds.filter(c => p.y < SMOKE.height && Math.hypot(p.x - c.x, p.z - c.z) < SMOKE.radius);
  const mine = cloudsAt(local.pos);
  const check = (w) => { const theirs = cloudsAt(w.group.position); w.setHidden(theirs.length > 0 && !theirs.some(c => mine.includes(c)), dt); };
  for (const w of players.values()) if (w !== me) check(w);
  for (const d of decoys.values()) check(d.wiz);
}

// Trapped Relic: the prop we've cursed (the server tells only us), marked with a faint glyph.
let cursedProp = null;
const curseMark = effects.curseGlyph();

// ---------------------------------------------------------------- UI helpers
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function feed(html) {
  const el = document.createElement('div'); el.innerHTML = html;
  ui.feed.prepend(el);
  while (ui.feed.children.length > 6) ui.feed.lastChild.remove();
  setTimeout(() => el.remove(), 6000);
}
let vignetteT = 0;
function flashVignette() { ui.vignette.classList.add('hit'); vignetteT = 0.25; }
let shakeAmt = 0;
function shake(a) { shakeAmt = Math.max(shakeAmt, a); }
function hitmarker() {
  const ch = $('#crosshair .ring'); ch.style.borderColor = '#ffd25c'; ch.style.transform = 'scale(1.4)';
  setTimeout(() => { ch.style.borderColor = ''; ch.style.transform = ''; }, 120);
}
let scoreVisible = false, scoreT = 0;
function updateScoreboard() {
  const rows = [...players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  ui.scoreBody.innerHTML = rows.map(w => `<tr class="${w === me ? 'me' : ''}"><td style="color:#${w.color.toString(16).padStart(6, '0')}">${esc(w.name)}${w.bot ? `<span class="bot">${w.bot} bot</span>` : ''}</td><td class="wiz">${esc(C.WIZARDS[w.wizard]?.name || '?')}</td><td>${w.kills}</td><td>${w.deaths}</td></tr>`).join('');
}

// ---------------------------------------------------------------- local player update
const aimDir = new THREE.Vector3();
const aimOrigin = new THREE.Vector3();

function computeAim() {
  camera.getWorldDirection(aimDir);
  const target = tmp.v1.copy(camera.position).addScaledVector(aimDir, 40);
  me.hand.getWorldPosition(aimOrigin);
  // keep the origin sane even mid-animation
  if (aimOrigin.distanceTo(local.pos) > 2 || aimOrigin.y < 0.3) aimOrigin.set(local.pos.x, local.pos.y + 1.3, local.pos.z);
  aimDir.copy(target).sub(aimOrigin).normalize();
}

// The prop telekinesis would grab: closest to the crosshair ray within range and cone, else
// anything at point-blank range. Mirrors tkTarget() in server.js.
const camDir = new THREE.Vector3();
function tkTarget() {
  camera.getWorldDirection(camDir);
  const o = camera.position;
  const cone = C.TK.aimConeDeg * Math.PI / 180;
  const p = [local.pos.x, 0, local.pos.z];
  let best = null, bestScore = -Infinity, near = null, nd = C.PICKUP_RANGE;
  for (const e of props.values()) {
    const d = e.data;
    if (d.state !== 'idle') continue;
    const d2 = Math.hypot(d.x - p[0], d.z - p[2]);
    if (d2 < nd) { nd = d2; near = e; }
    if (d2 > C.TK.range) continue;
    const spec = C.PROP_TYPES[d.type];
    const vx = d.x - o.x, vy = spec.h * 0.5 - o.y, vz = d.z - o.z;
    const l = Math.hypot(vx, vy, vz) || 1;
    const cos = (vx * camDir.x + vy * camDir.y + vz * camDir.z) / l;
    if (Math.acos(THREE.MathUtils.clamp(cos, -1, 1)) - Math.atan2(spec.r, l) > cone) continue;
    if (C.pillarBlocks(p, [d.x, 0, d.z], 0.1)) continue;
    const score = cos - l * 0.002;
    if (score > bestScore) { bestScore = score; best = e; }
  }
  // liftable goats compete with props (server: tkTarget). A goat comes back as { goat }.
  for (const g of goats.values()) {
    if (g.summoned || !LIFTABLE_GOAT_STATES.has(g.state)) continue;
    const gp = g.group.position;
    const d2 = Math.hypot(gp.x - p[0], gp.z - p[2]);
    if (d2 < nd) { nd = d2; near = { goat: g }; }
    if (d2 > C.TK.range) continue;
    const vx = gp.x - o.x, vy = gp.y + C.GOAT.hitY - o.y, vz = gp.z - o.z;
    const l = Math.hypot(vx, vy, vz) || 1;
    const cos = (vx * camDir.x + vy * camDir.y + vz * camDir.z) / l;
    if (Math.acos(THREE.MathUtils.clamp(cos, -1, 1)) - Math.atan2(C.GOAT.radius, l) > cone) continue;
    if (C.pillarBlocks(p, [gp.x, 0, gp.z], 0.1)) continue;
    const score = cos - l * 0.002;
    if (score > bestScore) { bestScore = score; best = { goat: g }; }
  }
  return best || near;
}
const LIFTABLE_GOAT_STATES = new Set(['graze', 'wander', 'return', 'recover', 'dizzy', 'stumble']);

// What the crosshair is pointing at (wizard, pillar, tree or ground), for aiming hurled props.
function aimPoint() {
  camera.getWorldDirection(camDir);
  const o = camera.position;
  let best = 60;
  const hitSphere = (c, r) => {
    const lx = c.x - o.x, ly = c.y - o.y, lz = c.z - o.z;
    const tca = lx * camDir.x + ly * camDir.y + lz * camDir.z;
    if (tca < 0) return;
    const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
    if (d2 > r * r) return;
    const t = tca - Math.sqrt(r * r - d2);
    if (t > 4.5 && t < best) best = t;       // ignore anything between the camera and us
  };
  for (const w of players.values()) if (w !== me && !w.dead) hitSphere(tmp.v1.copy(w.group.position).setY(w.group.position.y + C.HIT_CENTER_Y), C.HIT_RADIUS + 0.3);
  for (const d of decoys.values()) if (d.owner !== myId) hitSphere(tmp.v1.copy(d.wiz.group.position).setY(C.HIT_CENTER_Y), C.HIT_RADIUS + 0.3);
  for (const g of goats.values()) if (!(g.state === 'held' && me.carryingGoat === g.id)) hitSphere(tmp.v1.copy(g.group.position).setY(g.group.position.y + C.GOAT.hitY), C.GOAT.radius + 0.2);
  // pillars and trees as vertical cylinders (2D ray vs circle)
  const hx = camDir.x, hz = camDir.z, hl = Math.hypot(hx, hz) || 1;
  for (const c of C.COLLIDERS) {
    const lx = c.x - o.x, lz = c.z - o.z;
    const tca = (lx * hx + lz * hz) / hl;
    const d2 = lx * lx + lz * lz - tca * tca;
    if (tca < 0 || d2 > c.r * c.r) continue;
    const t = (tca - Math.sqrt(c.r * c.r - d2)) / hl;
    if (t > 4.5 && t < best && o.y + camDir.y * t < c.h) best = t;
  }
  if (camDir.y < -0.01) { const t = -o.y / camDir.y; if (t > 4.5 && t < best) best = t; }
  return [o.x + camDir.x * best, Math.max(0.3, o.y + camDir.y * best), o.z + camDir.z * best];
}

// Where the crosshair meets the ground, at most `range` from us and inside the arena.
function frostTarget() { return groundTarget(FROST.range); }
function groundTarget(range) {
  camera.getWorldDirection(camDir);
  const o = camera.position;
  let x, z;
  if (camDir.y < -0.02) { const t = -o.y / camDir.y; x = o.x + camDir.x * t; z = o.z + camDir.z * t; }
  else { x = local.pos.x + Math.sin(local.yaw) * range; z = local.pos.z + Math.cos(local.yaw) * range; }
  const d = Math.hypot(x - local.pos.x, z - local.pos.z);
  if (d > range) { x = local.pos.x + (x - local.pos.x) * range / d; z = local.pos.z + (z - local.pos.z) * range / d; }
  const r = Math.hypot(x, z);
  if (r > C.ARENA_RADIUS) { x *= C.ARENA_RADIUS / r; z *= C.ARENA_RADIUS / r; }
  return [x, 0, z];
}

function sendPickup() {
  camera.getWorldDirection(camDir);
  net.send({ t: 'pickup', aimOrigin: camera.position.toArray(), aimDir: camDir.toArray() });
}

// Glow marker on the prop telekinesis would grab.
const tkMarker = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1),
  new THREE.MeshBasicMaterial({ color: 0xb48cff, wireframe: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
tkMarker.visible = false;
scene.add(tkMarker);
let tkHover = null;

function updateLocal(dt) {
  const stunned = now < local.stunUntil || me.stunned;
  const bound = now < local.silenceUntil || me.bound;
  const rooted = now < local.rootUntil;
  const canAct = !me.dead && !stunned && !bound;

  // mouse look
  if (input.locked) {
    local.yaw -= input.mouseDX * 0.0022;
    local.pitch = THREE.MathUtils.clamp(local.pitch + input.mouseDY * 0.0022, -0.6, 1.1);
  }

  const K = kit();
  if (!input.down('Space')) local.spaceHeld = false;

  // ---- Skyward Flash: float down (slower holding E), drop after floatTime or on Space
  if (local.flight) {
    if (input.justPressed('Space')) { local.flight.drop = true; local.spaceHeld = true; }
    const dropping = local.flight.drop || now - local.flight.start >= SKY.floatTime;
    const rate = dropping ? SKY.dropSpeed : input.down('KeyE') ? SKY.slowFallSpeed : SKY.fallSpeed;
    // real elapsed time, not the frame-clamped dt: the server checks the height against its clock
    local.pos.y -= rate * Math.min(0.25, now - local.flight.last);
    local.flight.last = now;
    if (local.pos.y <= 0 || me.dead) {
      local.pos.y = 0; local.flight = null;
      if (!me.dead) { effects.land([local.pos.x, 0, local.pos.z]); sfx.land([local.pos.x, 0.2, local.pos.z]); }
    }
  }
  const airborne = !!local.flight;

  // ---- Arcane Cyclone timing (the server pulses; this keeps our controls honest meanwhile)
  if (local.cyclone && now - local.cyclone.start > CYC.windup + CYC.spin + 0.3) local.cyclone = null;
  if (local.lash && local.lash.sent && now - local.lash.start > LASH.windup + 0.6) { local.lash = null; me.endLash(); }
  const winding = (!!local.cyclone && !local.cyclone.pulsed) || !!local.lash;
  const busy = local.charging || !!local.cyclone || !!local.lash;

  // movement input (camera-relative), also the direction of a Mirror Step
  let mx = 0, mz = 0;
  if (input.down('KeyW')) mz += 1;
  if (input.down('KeyS')) mz -= 1;
  if (input.down('KeyA')) mx -= 1;
  if (input.down('KeyD')) mx += 1;
  const fwd = tmp.v1.set(Math.sin(local.yaw), 0, Math.cos(local.yaw));
  const right = tmp.v2.set(-Math.cos(local.yaw), 0, Math.sin(local.yaw));   // forward × up

  // ---- actions
  // our own tornado or rune flare: nothing else can be cast meanwhile
  if (local.ride && now >= local.ride.endAt + 0.3) local.ride = null;   // missed the rideEnd
  if (local.ultWind && now - local.ultWind.start > ULT_WIND + 0.6) local.ultWind = null;   // missed the result
  const ultLock = now < local.eyeUntil || now < local.blizzUntil || !!local.ride || !!local.ultWind || !!local.mrain;   // (a Ram Ride, a wind-up, Meteor Rain too)
  if (canAct) {
    // ultimate (Q): Cataclysm aims a circle (hold, release); the others go off at once
    const U = K.ultimate, ultReady = local.ult >= C.ULT_CHARGE.max, holdingQ = !!(me.carrying || me.carryingGoat);
    if (input.justPressed('KeyQ') && ultReady && !ultLock && !busy && !holdingQ && !local.cataAim) {
      if (AIMED_ULTS[U]) local.cataAim = true;
      else if (!airborne) { local.ultWind = { start: now }; net.send({ t: 'ult' }); }
    }
    if (local.cataAim) {
      if (busy || holdingQ || !ultReady || !AIMED_ULTS[U]) local.cataAim = false;
      else if (!input.down('KeyQ')) {
        local.cataAim = false;
        const at = groundTarget(AIMED_ULTS[U].range);
        local.ultWind = { start: now };
        net.send({ t: 'ult', at: [at[0], at[2]] });
      }
    }
  }
  if (canAct && !ultLock) {
    // guard: hold to ward, or tap for Rime's ice wall (Space while airborne drops instead)
    const wantBlock = C.isWard(K.guard) && input.down('Space') && me.st > 2 && !busy && !airborne && !local.spaceHeld;
    if (wantBlock !== local.blocking) { local.blocking = wantBlock; net.send({ t: 'block', on: wantBlock }); }
    if (K.guard === 'tempest_veil' && input.justPressed('Space') && !airborne && !local.spaceHeld && now >= local.cd.guard && !me.veiled) {
      local.cd.guard = now + SPELL.tempest_veil.cooldown;   // tap: the bubble goes up for its duration, no holding
      net.send({ t: 'veil' });
    }
    if (K.guard === 'glacial_bulwark' && input.justPressed('Space') && !airborne && !local.spaceHeld && !busy && now >= local.cd.guard) {
      local.cd.guard = now + BULWARK.cooldown;
      net.send({ t: 'bulwark', yaw: local.yaw });
    }
    if (K.guard === 'ram_guard' && input.justPressed('Space') && !airborne && !local.spaceHeld && now >= local.cd.guard) {
      local.cd.guard = now + RGUARD.cooldown;
      net.send({ t: 'ramGuard' });
    }
    if (K.guard === 'firewall' && input.justPressed('Space') && !airborne && !local.spaceHeld && !busy && now >= local.cd.guard) {
      local.cd.guard = now + SPELL.firewall.cooldown;   // tap: the flame stands for its life, no holding
      net.send({ t: 'firewall', yaw: local.yaw });
    }

    // primary
    const MAG = C.primaryMag(K.primary);
    if (local.reloadUntil && now >= local.reloadUntil) { local.ammo = MAG.magazine; local.reloadUntil = 0; }
    const startReload = () => { local.ammo = 0; local.reloadUntil = now + MAG.reload; };
    if (!local.reloadUntil && local.ammo > 0 && local.ammo < MAG.magazine && now - local.lastShot > MAG.idleReload) startReload();
    if (input.justPressed('KeyR') && !local.reloadUntil && local.ammo < MAG.magazine) { startReload(); net.send({ t: 'reload' }); }
    const holding = !!(me.carrying || me.carryingGoat);
    if (local.wasHolding && !holding) local.liftCdUntil = now + SPELL[K.utility].liftCooldown;
    local.wasHolding = holding;
    if (input.lmbPressed && !local.blocking && !busy && !holding && now >= local.cd.fast && !local.reloadUntil && local.ammo > 0) {
      computeAim();
      local.ammo--; local.lastShot = now;
      if (!local.ammo) local.reloadUntil = now + MAG.reload;
      const kind = C.PRIMARY_KIND[K.primary];
      local.cd.fast = now + SPELL[K.primary].cooldown;
      if (kind === 'skim') net.send({ t: 'cast', kind, dir: [aimDir.x, 0, aimDir.z] });
      else if (kind === 'hex') net.send({ t: 'cast', kind, origin: aimOrigin.toArray(), dir: aimDir.toArray(), target: aimPoint() });   // curves in on what the crosshair is on
      else net.send({ t: 'cast', kind, origin: aimOrigin.toArray(), dir: aimDir.toArray() });
    }
    // power slot
    if (input.rmbPressed && !local.blocking && !busy && (!airborne || SPELL[K.power].airCast) && !holding && now >= local.cd.power) {
      if (K.power === 'meteor') {
        // wind-up: press to start, fires automatically when fully charged
        local.charging = true; local.chargeStart = now; local.chargeSent = false;
        net.send({ t: 'chargeStart' });
      } else if (K.power === 'cyclone') {
        local.cyclone = { start: now, pulsed: false };
        me.startCyclone();
        net.send({ t: 'cyclone' });
      } else if (K.power === 'sanguine_lash') {
        local.lash = { start: now, sent: false };
        me.startLash();
        net.send({ t: 'lashStart' });
      } else if (K.power === 'battering_ram') {
        computeAim();
        local.cd.power = now + SPELL.battering_ram.cooldown;
        net.send({ t: 'ram', dir: [aimDir.x, 0, aimDir.z] });
      } else if (K.power === 'frostfall') {
        local.frostAim = true;   // hold to aim, release to cast
      }
    }
    if (local.frostAim) {
      if (busy || holding || local.blocking || K.power !== 'frostfall') local.frostAim = false;   // fine from the air
      else if (!input.rmb) {
        local.frostAim = false;
        local.cd.power = now + FROST.cooldown;
        const at = frostTarget();
        net.send({ t: 'frostfall', at: [at[0], at[2]] });
      }
    }
    if (local.charging && !local.chargeSent && now - local.chargeStart >= C.SPELLS.heavy.chargeTime) {
      computeAim();
      local.chargeSent = true;
      local.cd.power = now + C.SPELLS.heavy.cooldown;
      net.send({ t: 'chargeRelease', origin: aimOrigin.toArray(), dir: aimDir.toArray() });
      setTimeout(() => { local.charging = false; }, 150);
    }
    if (local.lash && !local.lash.sent && now - local.lash.start >= LASH.windup) {
      computeAim();
      local.lash.sent = true;
      local.cd.power = now + LASH.cooldown;
      net.send({ t: 'lashRelease', origin: aimOrigin.toArray(), dir: aimDir.toArray() });
    }
    // mobility slot
    if (input.justPressed('KeyE') && !busy && !airborne && now >= local.cd.mobility && !(rooted && K.mobility !== 'skyward')) {
      if (K.mobility === 'blink') {
        const dir = [Math.sin(local.yaw), 0, Math.cos(local.yaw)];
        const from = [local.pos.x, 0, local.pos.z];
        const to = C.computeTeleport(from, dir);
        cageKeep(to);   // a blink can't cross a Night Cage
        local.cd.mobility = now + C.TELEPORT.cooldown;
        net.send({ t: 'teleport', dir, from });
        local.pos.set(to[0], 0, to[2]); local.vel.set(0, 0, 0);
      } else if (K.mobility === 'skyward') {
        local.cd.mobility = now + SKY.cooldown;
        local.flight = { start: now, last: now, drop: false };
        local.pos.y = SKY.height;
        net.send({ t: 'skyward' });
      } else if (K.mobility === 'smoke_screen') {
        // a fast dash straight back from where we face; the smoke stays where we stood
        local.cd.mobility = now + SMOKE.cooldown;
        local.dash = { start: now, dir: [-Math.sin(local.yaw), -Math.cos(local.yaw)] };
        lastDashDir = local.dash.dir;
        net.send({ t: 'smoke', yaw: local.yaw, from: [local.pos.x, 0, local.pos.z] });
      } else if (K.mobility === 'ram_ride') {
        // mount up and gallop where we face (steer with the mouse, or A/D)
        if (!me.carrying && !me.carryingGoat) {
          local.cd.mobility = now + RIDE.cooldown;
          local.ride = rideTimes();
          net.send({ t: 'ride', yaw: local.yaw });
        }
      } else if (K.mobility === 'mirror_step') {
        // along the movement keys, forward if none; the server picks which of the three paths is us
        const d = (mx || mz) ? tmp.v3.set(0, 0, 0).addScaledVector(fwd, mz).addScaledVector(right, mx).normalize() : fwd;
        local.cd.mobility = now + MIRROR.cooldown;
        net.send({ t: 'mirror', dir: [d.x, 0, d.z], from: [local.pos.x, 0, local.pos.z] });
      }
      if (local.blocking) { local.blocking = false; }
    }
    // utility: lift / hurl / set down; with Trapped Relic, holding F on an object curses it instead
    const relic = K.utility === 'trapped_relic';
    if (input.justPressed('KeyF')) {
      if (me.carryingGoat) {
        // hurl the goat: like a prop, toward what the crosshair is on
        if (now >= local.cd.throw) {
          computeAim();
          local.cd.throw = now + C.THROW_COOLDOWN;
          net.send({ t: 'throw', dir: aimDir.toArray(), target: aimPoint() });
        }
      } else if (me.carrying) {
        if (now >= local.cd.throw && props.get(me.carrying)?.data.state === 'carried') {
          computeAim();
          local.cd.throw = now + C.THROW_COOLDOWN;
          net.send({ t: 'throw', dir: aimDir.toArray(), target: aimPoint() });
        }
      } else if (!busy && !local.blocking && tkHover && now >= local.liftCdUntil) {
        if (relic && !tkHover.goat) local.fHold = { start: now };   // goats can't be cursed: they just lift
        else sendPickup();
      }
    }
    if (local.fHold) {
      if (holding || busy || local.blocking || !tkHover || tkHover.goat) local.fHold = null;
      else if (now - local.fHold.start >= RELIC.hold) { local.fHold = null; local.liftCdUntil = now + RELIC.liftCooldown; camera.getWorldDirection(camDir); net.send({ t: 'curse', aimOrigin: camera.position.toArray(), aimDir: camDir.toArray() }); }
      else if (!input.down('KeyF')) { local.fHold = null; sendPickup(); }
    }
    if (input.justPressed('KeyG') && holding) net.send({ t: 'drop' });
  } else {
    if (local.blocking) { local.blocking = false; if (!ultLock) net.send({ t: 'block', on: false }); }
    local.fHold = null; local.frostAim = false;
    if (!canAct) local.cataAim = false;
  }
  const aimedUlt = local.cataAim && AIMED_ULTS[K.ultimate];
  const mark = K.ultimate === 'night_cage' ? cageMark : laneMark;
  cageMark.visible = laneMark.visible = false;
  mark.visible = !!aimedUlt;
  if (aimedUlt && mark === laneMark) {
    // the lane runs from us toward the crosshair's spot on the ground
    const at = groundTarget(aimedUlt.range);
    laneMark.position.set(local.pos.x, 0, local.pos.z);
    laneMark.rotation.y = Math.atan2(at[0] - local.pos.x, at[2] - local.pos.z);
  } else if (aimedUlt) { const at = groundTarget(aimedUlt.range); mark.position.set(at[0], 0, at[2]); }
  // the targeting circle follows the crosshair while aiming
  frostMark.visible = local.frostAim;
  if (local.frostAim) { const at = frostTarget(); frostMark.position.set(at[0], 0, at[2]); }

  // ---- Meteor Rain: the server flies us (it ignores our position meanwhile); mirror its path, aim, and dive
  mrainMark.visible = false;
  if (local.mrain) {
    const M = local.mrain;
    if (M.phase === 'dive') {
      const k = Math.min(1, (now - M.diveStart) / M.dive);
      for (const [i, key] of [[0, 'x'], [1, 'y'], [2, 'z']]) local.pos[key] = M.diveFrom[i] + (M.diveTo[i] - M.diveFrom[i]) * k * k;
    } else {
      const k = Math.min(1, (now - M.start) / M.rise);
      local.pos.set(M.from[0], M.top * (1 - (1 - k) * (1 - k)), M.from[1]);
      if (now >= M.start + M.rise) M.phase = 'hover';
      // aim: where the crosshair meets the ground, at most MRAIN.range from where we leapt
      let at = groundTarget(60);
      const d = Math.hypot(at[0] - M.from[0], at[2] - M.from[1]);
      if (d > MRAIN.range) at = [M.from[0] + (at[0] - M.from[0]) * MRAIN.range / d, 0, M.from[1] + (at[2] - M.from[1]) * MRAIN.range / d];
      mrainMark.visible = true; mrainMark.position.set(at[0], 0, at[2]);
      if (now - M.lastAim > 0.2) { M.lastAim = now; net.send({ t: 'mrainAim', at: [at[0], at[2]] }); }
      if (M.phase === 'hover' && (input.lmbPressed || input.justPressed('KeyQ'))) net.send({ t: 'mrainDive', at: [at[0], at[2]] });
    }
    local.vel.set(0, 0, 0);
    me.group.position.copy(local.pos); me.group.rotation.y = local.yaw;
    me.updateAnimation(false, dt);
    if (now - local.lastSend > 1 / 20) { local.lastSend = now; net.send({ t: 'state', p: [local.pos.x, local.pos.y, local.pos.z], yaw: local.yaw, anim: 'idle' }); }
    updateCamera(dt);
    return;
  }

  // ---- movement (camera-relative); a bound wizard can't move, a silenced one still can
  // Ram Ride: still while getting on and off; at the gallop, straight ahead at full tilt (A/D steer too)
  const galloping = local.ride && now >= local.ride.rideAt && now < local.ride.dismountAt;
  if (local.ride && !galloping) { mx = 0; mz = 0; }
  if (galloping) {
    // the ram runs along its own heading, which turns toward where we look (A/D nudge it) at RIDE.turnRate, on real time
    const R = local.ride, rt = Math.min(0.25, now - (R.turnAt ?? now)); R.turnAt = now;
    R.heading ??= local.yaw;
    const want = local.yaw - (mx || 0) * 0.6;
    R.heading += THREE.MathUtils.clamp(Math.atan2(Math.sin(want - R.heading), Math.cos(want - R.heading)), -RIDE.turnRate * rt, RIDE.turnRate * rt);
    mx = 0; mz = 1; fwd.set(Math.sin(R.heading), 0, Math.cos(R.heading));
  }
  const moving = (mx || mz) && !me.dead && !stunned && !rooted;
  let speed = C.speedOf(me.wizard);   // per wizard (wizards.js speed)
  if (local.charging || local.cyclone || local.lash || local.ultWind) speed = C.chargeSpeedOf(me.wizard);   // (an ultimate's wind-up too)
  else if (local.blocking) speed = C.blockSpeedOf(me.wizard);
  else if (local.flight) speed = SKY.airSpeed;
  if (now < local.slowUntil) speed *= 1 - C.SPELLS.skim.slow;     // Glacial Skim
  if (now < local.eyeUntil) speed = C.speedOf(me.wizard) * EYE.speedMul;   // the tornado: fast, and nothing slows it
  if (galloping) speed = RIDE.speed;
  const wish = tmp.v3.set(0, 0, 0);
  if (moving) {
    wish.addScaledVector(fwd, mz).addScaledVector(right, mx).normalize();
    wish.multiplyScalar(C.backpedalSpeed(speed, wish.x, wish.z, local.yaw));   // backpedalling is slower
  }
  // accelerate toward wish velocity; knockback lives in local.vel too
  const accel = Math.min(1, dt * 12);
  local.vel.x += (wish.x - local.vel.x) * accel;
  local.vel.z += (wish.z - local.vel.z) * accel;
  // Smoke Screen dash: straight back, covering the distance over dashTime of real time (so a slow
  // frame rate doesn't shorten it), in small steps that collide like walking
  let dashMove = 0;
  if (local.dash) {
    const end = local.dash.start + SMOKE.dashTime;
    const t0 = Math.min(local.dash.last ?? local.dash.start, end), t1 = Math.min(now, end);
    if (!stunned && !rooted && !me.dead) dashMove = Math.max(0, t1 - t0) * SMOKE.distance / SMOKE.dashTime;
    local.dash.last = t1;
    if (now >= end || stunned || rooted || me.dead) local.dash = null;
    local.vel.set(0, 0, 0);
  }
  // Ram Ride's gallop, likewise on real time (now is the real clock; dt is clamped), straight along our facing
  if (galloping) {
    const t0 = Math.max(local.ride.rideAt, local.ride.last ?? local.ride.rideAt), t1 = Math.min(now, local.ride.dismountAt);
    if (!stunned && !me.dead) dashMove = Math.max(0, t1 - t0) * RIDE.speed;
    local.ride.last = t1;
    lastDashDir = [Math.sin(local.ride.heading ?? local.yaw), Math.cos(local.ride.heading ?? local.yaw)];
    local.vel.set(0, 0, 0);
  }
  if (rooted) local.vel.set(0, 0, 0);
  if (!me.dead) local.pos.addScaledVector(local.vel, dt);
  // dragged toward an enemy Eye of the Storm
  if (local.pull && now < local.pull.until && !rooted && !me.dead) { local.pos.x += local.pull.v[0] * dt; local.pos.z += local.pull.v[1] * dt; }

  // ---- collisions (2D circles)
  const pr = C.PLAYER_RADIUS;
  const pushOut = (cx, cz, r) => {
    const dx = local.pos.x - cx, dz = local.pos.z - cz;
    const d = Math.hypot(dx, dz);
    if (d < r + pr && d > 0.0001) { const k = (r + pr - d) / d; local.pos.x += dx * k; local.pos.z += dz * k; }
  };
  // airborne, we pass over anything lower than our feet
  const y = local.pos.y;
  if (dashMove > 0) {
    const n = Math.ceil(dashMove / 0.25), step = dashMove / n;
    for (let i = 0; i < n; i++) {
      local.pos.x += lastDashDir[0] * step; local.pos.z += lastDashDir[1] * step;
      for (const c of C.COLLIDERS) if (y < c.h) pushOut(c.x, c.z, c.r);
    }
  }
  for (const c of C.COLLIDERS) if (y < c.h) pushOut(c.x, c.z, c.r);
  if (y < 1) for (const e of props.values()) if (e.data.state === 'idle') pushOut(e.data.x, e.data.z, C.PROP_TYPES[e.data.type].r * 0.8);
  for (const w of players.values()) if (w !== me && !w.dead && Math.abs(w.group.position.y - y) < C.PLAYER_HEIGHT) pushOut(w.group.position.x, w.group.position.z, pr);
  // (never the ram we ride: it sits under us a frame behind, and pushing out of it shoved us forward every frame)
  if (y < 1) for (const g of goats.values()) if (g.state !== 'charge' && g.state !== 'mount' && g.group.position.y < 0.5) pushOut(g.group.position.x, g.group.position.z, C.GOAT.radius);
  if (y < 1) for (const d of decoys.values()) if (d.owner !== myId) pushOut(d.wiz.group.position.x, d.wiz.group.position.z, pr);
  const r = Math.hypot(local.pos.x, local.pos.z);
  if (r > C.ARENA_RADIUS) { local.pos.x *= C.ARENA_RADIUS / r; local.pos.z *= C.ARENA_RADIUS / r; }
  // a Night Cage: stay on our side of the ring (the server checks the same)
  if (cages.size) { const pp = local.pos.toArray(); if (cageKeep(pp)) { local.pos.set(pp[0], pp[1], pp[2]); local.vel.multiplyScalar(0.3); } }

  // ---- apply to the wizard
  me.group.position.copy(local.pos);
  me.group.rotation.y = local.yaw;
  me.blocking = local.blocking;
  me.riding = !!local.ride;   // predicted: seated on the ram from the moment we mount
  me.charging = local.charging;
  me.slowed = now < local.slowUntil; me.bound = bound && !me.dead; me.frozen = now < local.frozenUntil || (me.frozen && me.bound);
  me.updateAnimation(!!moving, dt);
  local.anim = me.dead ? 'dead' : local.charging || winding ? 'charge' : local.blocking ? 'block' : moving ? 'run' : 'idle';

  // ---- send state (20 Hz)
  if (now - local.lastSend > 1 / 20) {
    local.lastSend = now;
    net.send({ t: 'state', p: [local.pos.x, local.pos.y, local.pos.z], yaw: local.yaw, anim: local.anim });
  }

  updateCamera(dt);
}

// Over-the-shoulder orbit camera (pulled in when something stands between it and us).
function updateCamera(dt) {
  let camDist = 4.2;
  const pivot = tmp.v1.set(local.pos.x, local.pos.y + 1.55, local.pos.z);
  const back = tmp.v2.set(-Math.sin(local.yaw) * Math.cos(local.pitch), Math.sin(local.pitch), -Math.cos(local.yaw) * Math.cos(local.pitch));
  const shoulder = tmp.v3.set(Math.cos(local.yaw), 0, -Math.sin(local.yaw)).multiplyScalar(0.7);
  // pull the camera in if a pillar sits between it and the wizard (2D circle test along the boom)
  for (const p of C.COLLIDERS) {
    for (let d = 0.6; d < camDist; d += 0.3) {
      const x = pivot.x + back.x * d + shoulder.x, z = pivot.z + back.z * d + shoulder.z;
      if (pivot.y + back.y * d < p.h + 0.5 && Math.hypot(x - p.x, z - p.z) < p.r + 0.35) { camDist = Math.max(1.2, d - 0.3); break; }
    }
  }
  const desired = pivot.clone().addScaledVector(back, camDist).add(shoulder);
  if (desired.y < 0.4) desired.y = 0.4;
  camera.position.lerp(desired, Math.min(1, dt * 18));
  const look = pivot.clone().add(shoulder).addScaledVector(back, -6);
  if (shakeAmt > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shakeAmt; camera.position.y += (Math.random() - 0.5) * shakeAmt;
    shakeAmt *= Math.max(0, 1 - dt * 10);
  }
  camera.lookAt(look);
}

// ---------------------------------------------------------------- HUD
let lastHud = { hp: -1, st: -1 };
function updateHud(dt) {
  if (me.hp !== lastHud.hp) { ui.hp.style.width = `${me.hp}%`; lastHud.hp = me.hp; }
  const stShown = me.st;
  if (Math.abs(stShown - lastHud.st) > 0.5) { ui.st.style.width = `${stShown}%`; lastHud.st = stShown; ui.stBar.classList.toggle('low', stShown < 25); }

  // charge ring: the meteor's wind-up, or the cyclone's (purple)
  const windup = local.charging ? [local.chargeStart, C.SPELLS.heavy.chargeTime] : local.cyclone && !local.cyclone.pulsed ? [local.cyclone.start, CYC.windup]
    : local.lash ? [local.lash.start, LASH.windup] : local.fHold ? [local.fHold.start, RELIC.hold] : null;
  if (windup) {
    const k = Math.min(1, (now - windup[0]) / windup[1]);
    ui.charge.classList.add('on'); ui.charge.classList.toggle('ready', k >= 1);
    ui.charge.classList.toggle('cyclone', !!local.cyclone); ui.charge.classList.toggle('lash', !!local.lash || !!local.fHold);
    ui.chargeFg.style.strokeDashoffset = 163.4 * (1 - k);
  } else ui.charge.classList.remove('on');

  // ability bar: the wizard's five spells and each slot's cooldown
  const K = kit();
  const bound = now < local.silenceUntil;
  const setName = (key, text) => { const el = ui.ab[key].querySelector('.name'); if (el.textContent !== text) el.textContent = text; };
  setName('fast', shortName(K.primary));
  setName('power', shortName(K.power));
  setName('mobility', shortName(K.mobility));
  setName('block', shortName(K.guard));
  const holdingNow = !!(me.carrying || me.carryingGoat);
  setName('throw', holdingNow ? 'Hurl' : shortName(K.utility));
  const cdFill = (key, until, total) => { const k = total ? Math.max(0, Math.min(1, (until - now) / total)) : 0; ui.ab[key].querySelector('.cd').style.height = `${k * 100}%`; };
  // primary: ammo pips, and the reload sweeping down over the slot
  const MAG = C.primaryMag(K.primary);
  if (local.reloadUntil) cdFill('fast', local.reloadUntil, MAG.reload); else cdFill('fast', local.cd.fast, SPELL[K.primary].cooldown);
  ui.ammo.forEach((el, i) => { el.style.display = i < MAG.magazine ? '' : 'none'; el.classList.toggle('full', i < local.ammo); el.classList.toggle('fin', i === 0); });
  ui.ab.fast.classList.toggle('reloading', !!local.reloadUntil);
  cdFill('power', local.cd.power, SPELL[K.power].cooldown);
  // Black Death: the whip's stored charge, as a crimson ring around the RMB slot
  const whipK = K.guard === 'black_death' ? Math.min(1, (me.lashBonus || 0) / SPELL.black_death.maxBonus) : 0;
  ui.ab.power.style.setProperty('--whip', whipK.toFixed(3));
  ui.ab.power.classList.toggle('whip', whipK > 0);
  cdFill('mobility', local.cd.mobility, SPELL[K.mobility].cooldown);
  cdFill('block', local.cd.guard, SPELL[K.guard].cooldown);
  if (!me.carrying && !me.carryingGoat && now < local.liftCdUntil) cdFill('throw', local.liftCdUntil, SPELL[K.utility].liftCooldown);   // lift cooldown
  else cdFill('throw', local.cd.throw, C.THROW_COOLDOWN);
  ui.ab.block.classList.toggle('active', local.blocking || me.veiled || [...walls.values()].some(w => w.data.owner === myId) || [...firewalls.values()].some(f => f.data.owner === myId) || me.ramGuard);
  ui.ab.power.classList.toggle('active', local.charging || !!local.cyclone || !!local.lash || local.frostAim);
  ui.ab.mobility.classList.toggle('active', !!local.flight || !!local.ride);
  ui.ab.block.classList.toggle('disabled', bound || (C.isWard(K.guard) && me.st < 3) || !!local.flight);
  ui.ab.throw.classList.toggle('active', holdingNow || !!local.fHold);
  ui.ab.throw.classList.toggle('disabled', bound);
  ui.ab.fast.classList.toggle('disabled', holdingNow || bound);
  ui.ab.power.classList.toggle('disabled', holdingNow || (!!local.flight && !SPELL[K.power].airCast) || bound);
  ui.ab.mobility.classList.toggle('disabled', bound || (now < local.rootUntil && K.mobility !== 'skyward'));

  // ultimate: the ring fills with the charge and glows in our colour when full
  const pct = Math.floor(local.ult), ultEl = ui.ab.ult;
  setName('ult', shortName(K.ultimate));
  const off = `${169.6 * (1 - Math.min(100, pct) / 100)}`;
  if (ui.ultFg.style.strokeDashoffset !== off) ui.ultFg.style.strokeDashoffset = off;
  const pctText = pct >= C.ULT_CHARGE.max ? 'READY' : `${pct}%`;
  if (ui.ultPct.textContent !== pctText) ui.ultPct.textContent = pctText;
  ultEl.classList.toggle('ready', pct >= C.ULT_CHARGE.max);
  ultEl.style.setProperty('--ult', `#${C.boltColor(me.wizard).toString(16).padStart(6, '0')}`);
  ultEl.classList.toggle('active', local.cataAim || !!local.ultWind || !!local.mrain || now < local.eyeUntil || now < local.blizzUntil || [...cages.values()].some(c => c.owner === myId));
  ultEl.classList.toggle('disabled', bound || holdingNow);

  // our cursed prop: a faint red glyph above it
  const cp = cursedProp && props.get(cursedProp);
  curseMark.visible = !!cp && cp.data.state === 'idle';
  if (curseMark.visible) {
    curseMark.position.set(cp.data.x, C.PROP_TYPES[cp.data.type].h + 0.45 + Math.sin(now * 2) * 0.06, cp.data.z);
    curseMark.material.opacity = 0.4 + Math.sin(now * 3) * 0.12;
  }

  // hint
  let hint = '';
  tkHover = !me.dead && !holdingNow ? tkTarget() : null;
  if (tkHover?.goat) {
    const gp = tkHover.goat.group.position;
    tkMarker.visible = true;
    tkMarker.position.set(gp.x, gp.y + C.GOAT.hitY, gp.z);
    tkMarker.scale.setScalar(C.GOAT.radius + 0.45 + Math.sin(now * 6) * 0.04);
    tkMarker.rotation.y += dt * 1.5;
  } else if (tkHover) {
    const spec = C.PROP_TYPES[tkHover.data.type];
    tkMarker.visible = true;
    tkMarker.position.set(tkHover.data.x, spec.h * 0.5, tkHover.data.z);
    tkMarker.scale.setScalar(spec.r + 0.3 + Math.sin(now * 6) * 0.04);
    tkMarker.rotation.y += dt * 1.5;
  } else tkMarker.visible = false;
  const hunted = !me.dead && [...goats.values()].some(g => g.tgt === myId && (g.state === 'windup' || g.state === 'charge'));
  const rooted = now < local.rootUntil, slowed = now < local.slowUntil;
  const inFrost = !me.dead && [...frosts.values()].some(f => f.left > 0 && Math.hypot(f.group.position.x - local.pos.x, f.group.position.z - local.pos.z) < FROST.radius + 0.3);
  const rn = performance.now() / 1000;
  // an enemy Meteor Rain aimed at (or diving on) us; a Blizzard cone we're standing in
  const inMeteor = !me.dead && [...players.values()].some(w => w !== me && w.mrainMark?.visible && Math.hypot(w.mrainMark.position.x - local.pos.x, w.mrainMark.position.z - local.pos.z) < MRAIN.radius + 0.5);
  const inBlizzard = !me.dead && [...players.values()].some(w => {
    if (w === me || w.blizz == null) return false;
    const dx = local.pos.x - w.group.position.x, dz = local.pos.z - w.group.position.z, d = Math.hypot(dx, dz);
    return d < BLIZ.range + 0.5 && Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - w.blizz), Math.cos(Math.atan2(dx, dz) - w.blizz))) < BLIZ.cone / 2 * Math.PI / 180;
  });
  const caged = !me.dead && [...cages.values()].some(c => c.foes.includes(myId) && c.inside.includes(myId));
  for (const [id, e] of stampedeFx) if (performance.now() / 1000 > e.endAt) stampedeFx.delete(id);
  const inLaneNow = !me.dead && [...stampedeFx.values()].some(e => {
    const st = e; const dx = local.pos.x - st.p[0], dz = local.pos.z - st.p[2];
    const along = dx * st.dir[0] + dz * st.dir[2], side = -dx * st.dir[2] + dz * st.dir[0];
    return players.get(st.owner) !== me && along > -1 && along < st.length && Math.abs(side) < st.width / 2 + 0.5;
  });
  if (hunted) hint = C.isWard(K.guard) ? 'A goat is charging you! Ward (Space) facing it, or get out of the way' : 'A goat is charging you! Wall it off (Space) or get out of the way';
  else if (bound && now < local.frozenUntil) hint = 'Frozen!';
  else if (bound) hint = 'Bound!';
  else if (inFrost) hint = 'Ice falling! Get out of the shadow';
  else if (inMeteor) hint = 'Meteor Rain is aimed at you! Move!';
  else if (caged) hint = 'Caged! You can\'t cross the black ring';
  else if (inLaneNow) hint = 'Stampede! Get out of the lane';
  else if (local.ride) hint = now < local.ride.rideAt ? 'Mounting…' : now < local.ride.dismountAt ? 'Riding! Steer with the mouse' : 'Dismounting…';
  else if (local.cataAim) hint = K.ultimate === 'night_cage' ? 'Release Q to raise the Night Cage' : 'Release Q to call down the meteors';
  else if (now < local.eyeUntil) hint = 'Eye of the Storm! Run them down';
  else if (local.mrain) hint = local.mrain.phase === 'dive' ? '' : 'Aim the circle · Q or click to dive';
  else if (local.ultWind) hint = 'Calling your ultimate…';
  else if (now < local.blizzUntil) hint = 'Blizzard! Turn slowly to sweep it';
  else if (inBlizzard) hint = 'Blizzard! Get out of the cone';
  else if (local.frostAim) hint = 'Release RMB to drop the ice';
  else if (rooted) hint = 'Recovering…';
  else if (local.flight) hint = 'Hold E to hover · Space to drop';
  else if (me.carryingGoat) hint = 'F hurl goat · G set down';
  else if (me.carrying) hint = 'F hurl · G set down';
  else if (now < local.stunUntil) hint = 'Stunned!';
  else if (local.fHold) hint = 'Cursing…';
  else if (tkHover?.goat) hint = 'F lift goat';
  else if (tkHover) hint = K.utility === 'trapped_relic' ? (tkHover.data.id === cursedProp ? 'Your relic · F lift (removes the curse)' : 'F lift · hold F to curse') : 'F lift';
  else if (slowed) hint = 'Slowed by frost';
  else if (local.reloadUntil && now - local.lastShot < 1) hint = 'Reloading…';
  ui.hint.textContent = hint; ui.hint.classList.toggle('on', !!hint); ui.hint.classList.toggle('danger', hunted || ((inFrost || inMeteor || inBlizzard || caged || inLaneNow) && !bound));
  ui.hint.classList.toggle('bound', !hunted && (bound || rooted)); ui.hint.classList.toggle('frost', !hunted && !bound && !rooted && slowed && hint === 'Slowed by frost');

  if (vignetteT > 0) { vignetteT -= dt; if (vignetteT <= 0) ui.vignette.classList.remove('hit'); }

  const want = input.down('Tab');
  if (want !== scoreVisible) { scoreVisible = want; ui.scoreboard.classList.toggle('hidden', !want); if (want) { updateScoreboard(); scoreT = now; } }
  if (scoreVisible && now - scoreT > 0.5) { updateScoreboard(); scoreT = now; }

  if (Math.floor(now) !== Math.floor(now - dt)) {
    ui.status.textContent = `${players.size} wizard${players.size === 1 ? '' : 's'} online · ${me.kills} kill${me.kills === 1 ? '' : 's'}`;
  }
}

// ---------------------------------------------------------------- per-wizard sound
// Charge hum (rising in pitch), ward hum and footsteps follow each wizard around.
function updateWizardAudio(w, dt) {
  const pos = wpos(w);
  const charging = (w.charging || w.lashT >= 0 || w.ultWinding) && !w.dead, warding = (w.blocking || w.veiled) && !w.dead;   // Ty's shield hum for both
  if (charging && !w.sndCharge) w.sndCharge = sfx.loop('charge_loop', { pos, vol: 0.55, rate: 0.6 });
  else if (!charging && w.sndCharge) { w.sndCharge.stop(0.08); w.sndCharge = null; }
  // the lash hum sits lower and rises over its longer wind-up
  if (w.sndCharge) { w.sndCharge.setPos(pos); w.sndCharge.setRate(w.lashT >= 0 ? 0.4 + Math.min(1, w.lashT / LASH.windup) * 0.5 : 0.6 + Math.min(1, w.chargeT / C.SPELLS.heavy.chargeTime) * 0.9); }
  if (warding && !w.sndWard) w.sndWard = sfx.loop('ward_loop', { pos, vol: 0.45, fadeIn: 0.12 });
  else if (!warding && w.sndWard) { w.sndWard.stop(0.2); w.sndWard = null; }
  if (w.sndWard) w.sndWard.setPos(pos);

  // running steps every 0.3 s; slowed by a ward or wind-up, every 0.5 s
  const speed = w === me ? Math.hypot(local.vel.x, local.vel.z) : (w.netAnim === 'run' ? C.speedOf(w.wizard) : 0);
  const moving = !w.dead && speed > 1.5;
  const interval = speed > 4 ? 0.3 : 0.5;
  w.stepT = (w.stepT || 0) + dt;
  if (moving && w.stepT > interval) { w.stepT = 0; sfx.footstep(w.group.position, w === me ? 0.28 : 0.4); }
}
function stopWizardAudio(w) { w.sndCharge?.stop(); w.sndWard?.stop(); w.sndCharge = w.sndWard = null; }

// ---------------------------------------------------------------- main loop
let last = performance.now();
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  now = t / 1000;

  if (me) {
    for (const msg of net.drain()) handleMessage(msg);
    updateLocal(dt);
    for (const w of players.values()) {
      if (w === me) continue;
      w.interpolate(dt);
      const moving = w.netAnim === 'run';
      w.updateAnimation(moving, dt);
      // a remote wizard touching down after a Skyward Flash
      const air = w.targetPos.y > 0.3;
      if (w.wasAir && !air && !w.dead) { effects.land([w.targetPos.x, 0, w.targetPos.z]); sfx.land([w.targetPos.x, 0.2, w.targetPos.z]); }
      w.wasAir = air;
    }
    for (const d of decoys.values()) {
      const owner = players.get(d.owner);
      if (owner) d.wiz.hp = owner.hp;
      d.wiz.interpolate(dt);
      d.wiz.updateAnimation(true, dt);
      d.wiz.faceCamera(camera);
    }
    // telekinesis beam to a held goat (goats.js draws the goat itself)
    for (const w of players.values()) {
      const g = w.carryingGoat && goats.get(w.carryingGoat);
      w.beamTo = g && g.state === 'held' ? g.group.position.clone().setY(g.group.position.y + C.GOAT.hitY) : null;
    }
    updateUltimates();
    updateSmokeHiding(dt);
    for (const w of players.values()) w.faceCamera(camera);
    updateHud(dt);
    matchUI.update(dt);
    if (input.justPressed('KeyM')) { sfx.muted = !sfx.muted; ui.mute.checked = sfx.muted; feed(sfx.muted ? 'Sound muted (M)' : 'Sound on'); }
    sfx.setListener(camera);
    for (const w of players.values()) updateWizardAudio(w, dt);
  } else {
    // idle camera drift on the join screen
    const a = t * 0.00008;
    camera.position.set(Math.sin(a) * 26, 9, Math.cos(a) * 26);
    camera.lookAt(0, 2, 0);
  }

  for (const g of goats.values()) g.update(dt, effects, sfx);
  // a Ram Ride mount sits right under its rider (the rider is drawn ahead of the snapshots)
  for (const g of goats.values()) {
    if (g.state !== 'mount') continue;
    const w = players.get(g.owner);
    if (w) { g.group.position.set(w.group.position.x, 0, w.group.position.z); g.group.rotation.y = w.group.rotation.y; }
  }

  // prop pop-in + spinning crystals
  for (const e of props.values()) {
    if (e.spawnT !== undefined) { e.spawnT += dt; const s = Math.min(1, e.spawnT * 4); e.mesh.scale.setScalar(s); if (s >= 1) delete e.spawnT; }
  }
  for (const s of spinners) { s.rotation.y += dt; s.position.y += Math.sin(t * 0.002) * 0.002; }

  effects.update(dt);
  renderer.render(scene, camera);
  input.endFrame();
}
requestAnimationFrame(frame);

// Debug handle (used by the automated smoke test; harmless in production).
window.__wa = { input, net, local, players, props, goats, effects, scene, camera, sfx, decoys, walls, frosts, frostMark, mrainMark, cageMark, laneMark, cages, firewalls, stampedeFx, C, get cursedProp() { return cursedProp; } };
