import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as C from '../shared/constants.js';
import { Net } from './net.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { buildWorld, makePropMesh, spinners, loadModels, trampleCrops } from './world.js';
import { GoatView } from './goats.js';
import { Wizard, registerModel } from './wizard.js';
import { Effects } from './effects.js';

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
  books: [$('#joinBook'), $('#pauseBook')],
  ab: Object.fromEntries([...document.querySelectorAll('.ab')].map(el => [el.dataset.ab, el])),
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
  cd: { fast: 0, power: 0, mobility: 0, throw: 0 },   // per slot, like the server
  charging: false, chargeStart: 0, chargeSent: false,
  cyclone: null,               // { start, pulsed } during our own Arcane Cyclone
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

// ---------------------------------------------------------------- spellbook
// The loadout we want (saved in localStorage). The server's copy (me.loadout) is what casts use;
// it differs only while a slot is mid-cast and the change is waiting.
let wantLoadout = C.DEFAULT_LOADOUT;
try { wantLoadout = C.sanitizeLoadout(JSON.parse(localStorage.getItem('wizardLoadout') || 'null')); } catch {}

function renderBooks() {
  const html = Object.entries(C.LOADOUT_SLOTS).map(([slot, info]) => {
    const spells = C.spellsFor(slot);
    const cards = spells.map(sp => {
      const sel = wantLoadout[slot] === sp.id;
      const pending = sel && me && me.loadout[slot] !== sp.id;
      return `<div class="spell-card${sel ? ' selected' : ''}${spells.length === 1 ? ' only' : ''}${pending ? ' pending' : ''}" role="button" tabindex="0" data-slot="${slot}" data-spell="${sp.id}" aria-pressed="${sel}">
        <span class="sc-key">${info.key}</span><span class="sc-name">${esc(sp.name)}</span><span class="sc-blurb">${esc(sp.blurb)}</span></div>`;
    }).join('');
    return `<div class="book-slot"><div class="slot-label">${info.label}<kbd>${info.key}</kbd></div><div class="book-cards">${cards}</div></div>`;
  }).join('');
  for (const el of ui.books) el.innerHTML = html;
}
function chooseSpell(slot, id) {
  if (wantLoadout[slot] === id) return;
  wantLoadout = C.sanitizeLoadout({ ...wantLoadout, [slot]: id }, wantLoadout);
  try { localStorage.setItem('wizardLoadout', JSON.stringify(wantLoadout)); } catch {}
  sfx.click();
  if (me) net.send({ t: 'loadout', power: wantLoadout.power, mobility: wantLoadout.mobility, primary: wantLoadout.primary });
  renderBooks();
}
for (const el of ui.books) {
  el.addEventListener('click', (e) => { const c = e.target.closest('.spell-card'); if (c) chooseSpell(c.dataset.slot, c.dataset.spell); });
  el.addEventListener('keydown', (e) => {
    const c = e.target.closest('.spell-card');
    if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); chooseSpell(c.dataset.slot, c.dataset.spell); }
  });
}
renderBooks();
const spellName = (id) => C.SPELLBOOK[id]?.name || id;

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
Promise.all([wizardLoaded, loadModels(loader, scene)]).then(() => {
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
    const welcome = await net.connect(name, wantLoadout);
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
function onWelcome(msg) {
  myId = msg.id;
  for (const p of msg.players) addPlayer(p);
  for (const pr of msg.props) setProp(pr, true);
  for (const pj of msg.projectiles) effects.spawnProjectile(pj);
  for (const g of msg.goats || []) goats.set(g.id, new GoatView(g, scene));
  me = players.get(myId);
  local.pos.set(me.targetPos.x, 0, me.targetPos.z);
  renderBooks();
  ui.join.classList.add('hidden');
  ui.hud.classList.remove('hidden');
  input.enabled = true;
  input.requestLock();
  feed(`Welcome, <b>${esc(me.name)}</b>. ${players.size - 1} other wizard${players.size === 2 ? '' : 's'} here.`);
}

function addPlayer(info) {
  if (players.has(info.id)) return players.get(info.id);
  const w = new Wizard(info, scene, info.id === myId);
  applySnapshot(w, info);
  players.set(info.id, w);
  return w;
}

function applySnapshot(w, s) {
  if (w !== me) {
    w.targetPos.set(s.p[0], s.p[1], s.p[2]);
    w.targetYaw = s.yaw;
    w.netAnim = s.anim;
  }
  w.hp = s.hp; w.st = s.st; w.kills = s.kills; w.deaths = s.deaths;
  w.blocking = s.blocking; w.charging = s.charging; w.stunned = s.stun;
  if (s.loadout) w.loadout = s.loadout;
  if (s.dead !== w.dead) w.dead = s.dead;
  if (w === me) {
    if (!s.blocking && local.blocking) { local.blocking = false; }   // server cancelled the ward
    if (!s.charging && local.charging && local.chargeSent) { local.charging = false; }
  }
  if (s.carrying !== w.carrying) startCarry(w, s.carrying);
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

// Where a wizard's sounds come from (chest height).
function wpos(w) { return w.group.position.clone().setY(w.group.position.y + 1.1); }

function handleMessage(msg) {
  switch (msg.t) {
    case 'snap':
      for (const s of msg.players) {
        const w = players.get(s.id) || addPlayer(s);
        applySnapshot(w, s);
      }
      for (const g of msg.goats || []) (goats.get(g.id) || goats.set(g.id, new GoatView(g, scene)).get(g.id)).apply(g);
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
      effects.spawnProjectile(msg);
      const owner = players.get(msg.owner);
      if (owner) {
        if (msg.kind === 'fast') { owner.oneShot('cast_fast', 0.45, 2.6, 0.25); sfx.castFast(msg.p); }
        else if (msg.kind === 'heavy') { owner.charging = false; owner.oneShot('cast_heavy', 0.55, 1.5, 1.9); sfx.castHeavy(msg.p); }
        else { owner.oneShot('cast_fast', 0.4, 2.6, 0.3); sfx.throw_(msg.p); if (owner.carrying) startCarry(owner, null); }
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
      }
      break;
    }
    case 'hit': {
      const target = players.get(msg.target);
      if (!target) break;
      const c = target.group.position.clone(); c.y += 1;
      if (msg.blocked) { effects.blockFlash(c); sfx.block(c); }
      else {
        effects.burst(c, 0xff3b4e, 10, 3, 0.35);
        target.oneShot('stun', msg.kind === 'heavy' ? 0.5 : 0.55, 3.0, 0.3);
        sfx.hitBody(c);
      }
      if (target === me) {
        if (!msg.blocked) {
          sfx.hurt(); flashVignette(); shake(msg.kind === 'heavy' || msg.kind === 'cyclone' ? 0.6 : 0.25);
          local.stunUntil = now + (C.hitSpec(msg.kind)?.stun || 0.4);
        }
        // knockback
        local.vel.x += msg.dir[0] * msg.kb; local.vel.z += msg.dir[2] * msg.kb;
        if (!msg.blocked && local.charging) local.charging = false;
        if (!msg.blocked && local.cyclone && !local.cyclone.pulsed) { local.cyclone = null; me.cancelCyclone(); }
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
    case 'loadout': {
      const w = players.get(msg.id);
      if (w) w.loadout = msg.loadout;
      if (w === me) renderBooks();
      if (scoreVisible) updateScoreboard();
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
      if (msg.prop.state === 'lifting') sfx.pickup([msg.prop.x, 0.6, msg.prop.z]);
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
        ui.death.querySelector('.big').textContent = msg.cause === 'goat' ? 'Rammed by a goat' : 'You were vanquished';
        ui.death.classList.remove('hidden'); local.charging = false; local.blocking = false;
        local.cyclone = null; local.flight = null; local.pos.y = 0;
      }
      if (msg.cause === 'goat') feed(`<b>${esc(w.name)}</b> was rammed by a goat${k && k !== w ? ` (thanks, <b>${esc(k.name)}</b>)` : ''}`);
      else if (k && k !== w) feed(`<b>${esc(k.name)}</b> vanquished <b>${esc(w.name)}</b>`);
      else feed(`<b>${esc(w.name)}</b> perished`);
      break;
    }
    case 'respawn': {
      const w = players.get(msg.id);
      if (!w) break;
      w.dead = false;
      if (w === me) { local.pos.set(msg.p[0], 0, msg.p[2]); local.vel.set(0, 0, 0); ui.death.classList.add('hidden'); local.stunUntil = 0; }
      else { w.targetPos.set(msg.p[0], 0, msg.p[2]); w.group.position.copy(w.targetPos); }
      effects.teleport(msg.p, msg.p);
      sfx.respawn([msg.p[0], 1, msg.p[2]]);
      break;
    }
  }
}

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
  ui.scoreBody.innerHTML = rows.map(w => `<tr class="${w === me ? 'me' : ''}"><td style="color:#${w.color.toString(16).padStart(6, '0')}">${esc(w.name)}${w.bot ? `<span class="bot">${w.bot} bot</span>` : ''}</td><td class="spells">${esc(spellName(w.loadout.power))} · ${esc(spellName(w.loadout.mobility))}</td><td>${w.kills}</td><td>${w.deaths}</td></tr>`).join('');
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
  return best || near;
}

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
  for (const g of goats.values()) hitSphere(tmp.v1.copy(g.group.position).setY(C.GOAT.hitY), C.GOAT.radius + 0.2);
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

// Glow marker on the prop telekinesis would grab.
const tkMarker = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1),
  new THREE.MeshBasicMaterial({ color: 0xb48cff, wireframe: true, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
tkMarker.visible = false;
scene.add(tkMarker);
let tkHover = null;

function updateLocal(dt) {
  const stunned = now < local.stunUntil || me.stunned;
  const canAct = !me.dead && !stunned;

  // mouse look
  if (input.locked) {
    local.yaw -= input.mouseDX * 0.0022;
    local.pitch = THREE.MathUtils.clamp(local.pitch + input.mouseDY * 0.0022, -0.6, 1.1);
  }

  const lo = me.loadout;
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
  const winding = !!local.cyclone && !local.cyclone.pulsed;
  const busy = local.charging || !!local.cyclone;

  // ---- actions
  if (canAct) {
    // block
    const wantBlock = input.down('Space') && me.st > 2 && !busy && !airborne && !local.spaceHeld;
    if (wantBlock !== local.blocking) { local.blocking = wantBlock; net.send({ t: 'block', on: wantBlock }); }

    // fast bolt
    if (input.lmbPressed && !local.blocking && !busy && !me.carrying && now >= local.cd.fast) {
      computeAim();
      local.cd.fast = now + C.SPELLS.fast.cooldown;
      net.send({ t: 'cast', kind: 'fast', origin: aimOrigin.toArray(), dir: aimDir.toArray() });
    }
    // power slot
    if (input.rmbPressed && !local.blocking && !busy && !airborne && !me.carrying && now >= local.cd.power) {
      if (lo.power === 'meteor') {
        // wind-up: press to start, fires automatically when fully charged
        local.charging = true; local.chargeStart = now; local.chargeSent = false;
        net.send({ t: 'chargeStart' });
      } else if (lo.power === 'cyclone') {
        local.cyclone = { start: now, pulsed: false };
        me.startCyclone();
        net.send({ t: 'cyclone' });
      }
    }
    if (local.charging && !local.chargeSent && now - local.chargeStart >= C.SPELLS.heavy.chargeTime) {
      computeAim();
      local.chargeSent = true;
      local.cd.power = now + C.SPELLS.heavy.cooldown;
      net.send({ t: 'chargeRelease', origin: aimOrigin.toArray(), dir: aimDir.toArray() });
      setTimeout(() => { local.charging = false; }, 150);
    }
    // mobility slot
    if (input.justPressed('KeyE') && !busy && !airborne && now >= local.cd.mobility) {
      if (lo.mobility === 'blink') {
        const dir = [Math.sin(local.yaw), 0, Math.cos(local.yaw)];
        const from = [local.pos.x, 0, local.pos.z];
        const to = C.computeTeleport(from, dir);
        local.cd.mobility = now + C.TELEPORT.cooldown;
        net.send({ t: 'teleport', dir, from });
        local.pos.set(to[0], 0, to[2]); local.vel.set(0, 0, 0);
      } else if (lo.mobility === 'skyward') {
        local.cd.mobility = now + SKY.cooldown;
        local.flight = { start: now, last: now, drop: false };
        local.pos.y = SKY.height;
        net.send({ t: 'skyward' });
      }
      if (local.blocking) { local.blocking = false; }
    }
    // telekinesis: lift / hurl / set down
    if (input.justPressed('KeyF')) {
      if (me.carrying) {
        if (now >= local.cd.throw && props.get(me.carrying)?.data.state === 'carried') {
          computeAim();
          local.cd.throw = now + C.THROW_COOLDOWN;
          net.send({ t: 'throw', dir: aimDir.toArray(), target: aimPoint() });
        }
      } else if (!busy && !local.blocking && tkHover) {
        camera.getWorldDirection(camDir);
        net.send({ t: 'pickup', aimOrigin: camera.position.toArray(), aimDir: camDir.toArray() });
      }
    }
    if (input.justPressed('KeyG') && me.carrying) net.send({ t: 'drop' });
  } else {
    if (local.blocking) { local.blocking = false; net.send({ t: 'block', on: false }); }
  }

  // ---- movement (camera-relative)
  let mx = 0, mz = 0;
  if (input.down('KeyW')) mz += 1;
  if (input.down('KeyS')) mz -= 1;
  if (input.down('KeyA')) mx -= 1;
  if (input.down('KeyD')) mx += 1;
  const moving = (mx || mz) && canAct;
  let speed = C.MOVE_SPEED;
  if (local.charging || local.cyclone) speed = C.CHARGE_MOVE_SPEED;
  else if (local.blocking) speed = C.BLOCK_MOVE_SPEED;
  else if (local.flight) speed = SKY.airSpeed;
  const fwd = tmp.v1.set(Math.sin(local.yaw), 0, Math.cos(local.yaw));
  const right = tmp.v2.set(-Math.cos(local.yaw), 0, Math.sin(local.yaw));   // forward × up
  const wish = tmp.v3.set(0, 0, 0);
  if (moving) { wish.addScaledVector(fwd, mz).addScaledVector(right, mx).normalize().multiplyScalar(speed); }
  // accelerate toward wish velocity; knockback lives in local.vel too
  const accel = Math.min(1, dt * 12);
  local.vel.x += (wish.x - local.vel.x) * accel;
  local.vel.z += (wish.z - local.vel.z) * accel;
  if (!me.dead) local.pos.addScaledVector(local.vel, dt);

  // ---- collisions (2D circles)
  const pr = C.PLAYER_RADIUS;
  const pushOut = (cx, cz, r) => {
    const dx = local.pos.x - cx, dz = local.pos.z - cz;
    const d = Math.hypot(dx, dz);
    if (d < r + pr && d > 0.0001) { const k = (r + pr - d) / d; local.pos.x += dx * k; local.pos.z += dz * k; }
  };
  // airborne, we pass over anything lower than our feet
  const y = local.pos.y;
  for (const c of C.COLLIDERS) if (y < c.h) pushOut(c.x, c.z, c.r);
  if (y < 1) for (const e of props.values()) if (e.data.state === 'idle') pushOut(e.data.x, e.data.z, C.PROP_TYPES[e.data.type].r * 0.8);
  for (const w of players.values()) if (w !== me && !w.dead && Math.abs(w.group.position.y - y) < C.PLAYER_HEIGHT) pushOut(w.group.position.x, w.group.position.z, pr);
  if (y < 1) for (const g of goats.values()) if (g.state !== 'charge') pushOut(g.group.position.x, g.group.position.z, C.GOAT.radius);
  const r = Math.hypot(local.pos.x, local.pos.z);
  if (r > C.ARENA_RADIUS) { local.pos.x *= C.ARENA_RADIUS / r; local.pos.z *= C.ARENA_RADIUS / r; }

  // ---- apply to the wizard
  me.group.position.copy(local.pos);
  me.group.rotation.y = local.yaw;
  me.blocking = local.blocking;
  me.charging = local.charging;
  me.updateAnimation(!!moving, dt);
  local.anim = me.dead ? 'dead' : local.charging || winding ? 'charge' : local.blocking ? 'block' : moving ? 'run' : 'idle';

  // ---- send state (20 Hz)
  if (now - local.lastSend > 1 / 20) {
    local.lastSend = now;
    net.send({ t: 'state', p: [local.pos.x, local.pos.y, local.pos.z], yaw: local.yaw, anim: local.anim });
  }

  // ---- camera: over-the-shoulder orbit
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
  const windup = local.charging ? [local.chargeStart, C.SPELLS.heavy.chargeTime] : local.cyclone && !local.cyclone.pulsed ? [local.cyclone.start, CYC.windup] : null;
  if (windup) {
    const k = Math.min(1, (now - windup[0]) / windup[1]);
    ui.charge.classList.add('on'); ui.charge.classList.toggle('ready', k >= 1); ui.charge.classList.toggle('cyclone', !local.charging);
    ui.chargeFg.style.strokeDashoffset = 163.4 * (1 - k);
  } else ui.charge.classList.remove('on');

  // ability bar: the equipped spell's name and its slot's cooldown
  const lo = me.loadout;
  const setName = (key, text) => { const el = ui.ab[key].querySelector('.name'); if (el.textContent !== text) el.textContent = text; };
  setName('power', lo.power === 'cyclone' ? 'Cyclone' : spellName(lo.power));
  setName('mobility', lo.mobility === 'skyward' ? 'Skyward' : spellName(lo.mobility));
  const cdFill = (key, until, total) => { const k = Math.max(0, Math.min(1, (until - now) / total)); ui.ab[key].querySelector('.cd').style.height = `${k * 100}%`; };
  cdFill('fast', local.cd.fast, C.SPELLS.fast.cooldown);
  cdFill('power', local.cd.power, C.SPELLBOOK[lo.power].cooldown);
  cdFill('mobility', local.cd.mobility, C.SPELLBOOK[lo.mobility].cooldown);
  cdFill('throw', local.cd.throw, C.THROW_COOLDOWN);
  ui.ab.block.classList.toggle('active', local.blocking);
  ui.ab.power.classList.toggle('active', local.charging || !!local.cyclone);
  ui.ab.mobility.classList.toggle('active', !!local.flight);
  ui.ab.block.classList.toggle('disabled', me.st < 3 || !!local.flight);
  ui.ab.throw.querySelector('.name').textContent = me.carrying ? 'Hurl' : 'Lift';
  ui.ab.throw.classList.toggle('active', !!me.carrying);
  ui.ab.fast.classList.toggle('disabled', !!me.carrying);
  ui.ab.power.classList.toggle('disabled', !!me.carrying || !!local.flight);

  // hint
  let hint = '';
  tkHover = !me.dead && !me.carrying ? tkTarget() : null;
  if (tkHover) {
    const spec = C.PROP_TYPES[tkHover.data.type];
    tkMarker.visible = true;
    tkMarker.position.set(tkHover.data.x, spec.h * 0.5, tkHover.data.z);
    tkMarker.scale.setScalar(spec.r + 0.3 + Math.sin(now * 6) * 0.04);
    tkMarker.rotation.y += dt * 1.5;
  } else tkMarker.visible = false;
  const hunted = !me.dead && [...goats.values()].some(g => g.tgt === myId && (g.state === 'windup' || g.state === 'charge'));
  if (hunted) hint = 'A goat is charging you! Ward (Space) facing it, or blink away';
  else if (local.flight) hint = 'Hold E to hover · Space to drop';
  else if (me.carrying) hint = 'F hurl · G set down';
  else if (now < local.stunUntil) hint = 'Stunned!';
  else if (tkHover) hint = 'F lift';
  ui.hint.textContent = hint; ui.hint.classList.toggle('on', !!hint); ui.hint.classList.toggle('danger', hunted);

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
  const charging = w.charging && !w.dead, warding = w.blocking && !w.dead;
  if (charging && !w.sndCharge) w.sndCharge = sfx.loop('charge_loop', { pos, vol: 0.55, rate: 0.6 });
  else if (!charging && w.sndCharge) { w.sndCharge.stop(0.08); w.sndCharge = null; }
  if (w.sndCharge) { w.sndCharge.setPos(pos); w.sndCharge.setRate(0.6 + Math.min(1, w.chargeT / C.SPELLS.heavy.chargeTime) * 0.9); }
  if (warding && !w.sndWard) w.sndWard = sfx.loop('ward_loop', { pos, vol: 0.45, fadeIn: 0.12 });
  else if (!warding && w.sndWard) { w.sndWard.stop(0.2); w.sndWard = null; }
  if (w.sndWard) w.sndWard.setPos(pos);

  // running steps every 0.3 s; slowed by a ward or wind-up, every 0.5 s
  const speed = w === me ? Math.hypot(local.vel.x, local.vel.z) : (w.netAnim === 'run' ? C.MOVE_SPEED : 0);
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
    for (const w of players.values()) w.faceCamera(camera);
    updateHud(dt);
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
window.__wa = { input, net, local, players, props, goats, effects, scene, camera, sfx };
