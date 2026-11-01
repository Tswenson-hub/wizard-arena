// Match UI (round 11: the 4-player free-for-all only): the top bar (clock, your kills, the leader, the target),
// the 3 s countdown (round 16: no warm-up) and banners; at the end a 1.5 s gap (the winner's banner), then the 10 s recap: the
// top three on a podium with their accolades, a row for the rest, and Skip (any key, locally); then the rematch countdown.
// Spells agent (round 11; it was the modes agent's). main.js calls:
//   const matchUI = mountMatchUI({ scene, camera, net, players, props, myId: () => myId })
//   matchUI.onWelcome(msg)   the welcome message (with match.js welcomeExtras)
//   matchUI.onSnapshot(msg)  every 'snap' (msg.match)
//   matchUI.onMessage(msg)   any message whose type starts with 'match', and 'recap'
// The recap also goes out as window events for a 3D podium scene: 'wa:recap' (detail: the recap message), 'wa:recapEnd'
// (it's over, or skipped here: detail { skipped }).
//   matchUI.update(dt)       every frame while in game
//   matchUI.state()          the latest match state ({ mode, phase, left, target, size, leader })
import * as C from '../shared/constants.js';

const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const clock = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const SLOTS = C.LOADOUT_SLOTS;
const count = (n, word) => `<b>${n.toLocaleString('en-US')}</b> ${word}${n === 1 ? '' : 's'}`;

export function mountMatchUI(env) {
  const { players, myId } = env;

  // stylesheet (linked from here, as before)
  if (!document.querySelector('link[data-match-css]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = './css/match.css'; link.dataset.matchCss = '';
    document.head.appendChild(link);
  }

  // ------------------------------------------------------------ DOM
  const root = document.createElement('div');
  root.id = 'matchUI';
  root.className = 'hidden';
  root.innerHTML = `
    <div id="mTop"><div class="mCenter"><div class="mMode"></div><div class="mClock">0:00</div><div class="mSub"></div></div></div>
    <div id="mBanner" class="hidden"><div class="big"></div><div class="small"></div></div>
    <div id="mRecap" class="hidden"></div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const ui = { mode: $('.mMode'), clock: $('.mClock'), sub: $('.mSub'), banner: $('#mBanner'), recap: $('#mRecap') };

  // ------------------------------------------------------------ state
  let match = null, matchAt = 0;      // last match state and when it arrived (performance.now ms)
  let results = null, recap = null;
  const info = new Map();             // player id -> its latest snapshot entry
  const nameOf = (id) => info.get(id)?.name || players.get(id)?.name || '?';
  const since = () => (performance.now() - matchAt) / 1000;
  const left = () => match?.left == null ? null : Math.max(0, match.left - since());

  let bannerUntil = 0;
  function banner(big, small = '', secs = 2.5) {
    ui.banner.querySelector('.big').innerHTML = big;
    ui.banner.querySelector('.small').innerHTML = small;
    ui.banner.classList.remove('hidden');
    bannerUntil = performance.now() + secs * 1000;
  }

  // ------------------------------------------------------------ HUD
  function renderTop() {
    if (!match) return;
    ui.mode.textContent = `Free-for-all · first to ${match.target}`;
    const l = left(), me = info.get(myId());
    ui.clock.classList.remove('urgent');
    if (match.phase === 'countdown') { ui.clock.textContent = l == null ? '—' : clock(l); ui.sub.textContent = l == null ? 'Waiting' : 'Get ready'; }
    else if (match.phase === 'live') {
      ui.clock.textContent = l == null ? '' : clock(l);
      ui.clock.classList.toggle('urgent', l != null && l < 30);
      if (me?.spectator) { ui.sub.textContent = 'Watching: the match is full'; return; }
      const list = [...info.values()].filter(p => !p.spectator).sort((a, b) => b.kills - a.kills);
      const lead = list[0], mine = me?.kills ?? 0;
      const leadTxt = !lead || !lead.kills ? '—' : lead.id === myId() ? (list[1]?.kills === mine ? 'tied' : '<b>you</b>') : `${esc(lead.name)} <b>${lead.kills}</b>`;
      ui.sub.innerHTML = `You <b>${mine}</b> · leader ${leadTxt}`;
    } else { ui.clock.textContent = l == null ? '' : clock(l); ui.sub.textContent = 'Rematch soon'; }
  }

  // ------------------------------------------------------------ the end: the gap's banner, then the recap
  const spellChip = (id) => {
    const i = C.spellInfo(id);
    return i ? `<span class="mSpell" style="--c:${hex(i.color)}" title="${esc(i.name)}">${esc(i.short)}</span>` : '';
  };
  function endBanner() {
    if (!results) return;
    const me = myId(), w = results.winner;
    banner(w == null ? 'Draw' : w === me ? 'Victory!' : `${esc(nameOf(w))} wins`, 'Match over', 1.6);
  }
  function renderRecap() {
    if (!recap) return;
    const me = myId();
    const card = (p) => `
      <div class="mPod p${p.place}${p.id === me ? ' me' : ''}" style="--c:${hex(p.color ?? 0xffc857)}">
        <div class="mPlace">${['1st', '2nd', '3rd'][p.place - 1]}</div>
        <div class="mName">${esc(p.name)}${p.bot ? '<span class="bot">bot</span>' : ''}</div>
        <div class="mKd">${count(p.kills, 'kill')} · ${count(p.deaths, 'death')} · <b>${p.damage.toLocaleString('en-US')}</b> damage</div>
        <div class="mAccs">${p.accolades.map(a => `<div class="mAcc"><b>${esc(a.label)}</b><span>${esc(a.value)}</span></div>`).join('')}</div>
        <div class="mLoadout">${p.loadout ? SLOTS.map(s => spellChip(p.loadout[s])).join('') : ''}</div>
        <div class="mStep"></div>
      </div>`;
    // the podium's order on screen: 2nd, 1st, 3rd
    const order = [recap.podium[1], recap.podium[0], recap.podium[2]].filter(Boolean);
    const rest = recap.everyone.map(p => `<div class="mRest${p.id === me ? ' me' : ''}">${p.place}. ${esc(p.name)} · ${count(p.kills, 'kill')} · ${count(p.deaths, 'death')} · <b>${p.damage.toLocaleString('en-US')}</b> damage</div>`).join('');
    ui.recap.innerHTML = `
      <div class="mKicker">Match recap</div>
      <div class="mPodium">${order.map(card).join('')}</div>
      ${rest}
      <div class="mNext">Rematch in <b class="mRe"></b> s · <button class="mSkip">Skip</button> <span>(or any key)</span></div>`;
    ui.recap.querySelector('.mSkip').onclick = skipRecap;
  }
  function endRecap(skipped) {
    if (!recap) return;
    recap = null; ui.recap.classList.add('hidden');
    window.dispatchEvent(new CustomEvent('wa:recapEnd', { detail: { skipped } }));
  }
  function skipRecap() { endRecap(true); }
  // any key skips the recap here (the others still watch theirs)
  window.addEventListener('keydown', () => { if (recap && !ui.recap.classList.contains('hidden')) skipRecap(); });
  function startRecap(msg) {
    recap = msg;
    renderRecap();
    ui.recap.classList.remove('hidden');
    window.dispatchEvent(new CustomEvent('wa:recap', { detail: msg }));
  }
  function showPhase() {
    if (match?.phase !== 'recap') endRecap(false);
  }
  function setMatch(m) {
    const prev = match;
    match = m; matchAt = performance.now();
    if (!prev || prev.phase !== m.phase) {
      if (m.phase === 'countdown' && m.left != null) banner('Free-for-all', `First to ${m.target} kills`, 0.9);
      if (m.phase === 'live' && prev) banner('Fight!', `First to ${m.target} kills`, 2);
      showPhase();
    }
  }

  return {
    state: () => match,
    recapShowing: () => !!recap,
    onWelcome(msg) {
      root.classList.remove('hidden');
      for (const p of msg.players || []) info.set(p.id, p);
      if (msg.results) results = msg.results;
      if (msg.match) setMatch(msg.match);
      if (msg.recap && msg.match?.phase === 'recap') startRecap(msg.recap);   // (joined mid-recap)
    },
    onSnapshot(msg) {
      for (const s of msg.players) info.set(s.id, s);
      if (info.size > msg.players.length + 4) { const ids = new Set(msg.players.map(s => s.id)); for (const id of info.keys()) if (!ids.has(id)) info.delete(id); }
      if (msg.match) setMatch(msg.match);
    },
    onMessage(msg) {
      switch (msg.t) {
        case 'matchPhase': setMatch(msg.match); break;
        case 'matchEnd': results = msg.results; endBanner(); break;
        case 'recap': if (match?.phase === 'recap' || !match) startRecap(msg); break;
      }
    },
    update() {
      if (!match) return;
      renderTop();
      if (match.phase === 'recap' && recap) { const c = ui.recap.querySelector('.mRe'), l = left(); if (c && l != null) c.textContent = Math.ceil(l); }
      if (match.phase === 'countdown' && left() != null && left() < 3.05 && performance.now() > bannerUntil) banner(String(Math.ceil(left())), 'Get ready', 0.3);
      if (performance.now() > bannerUntil) ui.banner.classList.add('hidden');
    },
  };
}
