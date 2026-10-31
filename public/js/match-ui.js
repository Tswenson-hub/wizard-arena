// Match UI (round 11: the 4-player free-for-all only): the top bar (clock, your kills, the leader, the target),
// the warm-up countdown and banners, and the results screen with each wizard's loadout, then the rematch countdown.
// Spells agent (round 11; it was the modes agent's). main.js calls:
//   const matchUI = mountMatchUI({ scene, camera, net, players, props, myId: () => myId })
//   matchUI.onWelcome(msg)   the welcome message (with match.js welcomeExtras)
//   matchUI.onSnapshot(msg)  every 'snap' (msg.match)
//   matchUI.onMessage(msg)   any message whose type starts with 'match'
//   matchUI.update(dt)       every frame while in game
//   matchUI.state()          the latest match state ({ mode, phase, left, target, size, leader })
import * as C from '../shared/constants.js';

const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const clock = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const SLOTS = C.LOADOUT_SLOTS;

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
    <div id="mEnd" class="hidden"></div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const ui = { mode: $('.mMode'), clock: $('.mClock'), sub: $('.mSub'), banner: $('#mBanner'), end: $('#mEnd') };

  // ------------------------------------------------------------ state
  let match = null, matchAt = 0;      // last match state and when it arrived (performance.now ms)
  let results = null;
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
    if (match.phase === 'warmup') { ui.clock.textContent = l == null ? '—' : clock(l); ui.sub.textContent = l == null ? 'Waiting' : 'Warm-up: nothing counts yet'; }
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

  // ------------------------------------------------------------ results
  const spellChip = (id) => {
    const i = C.spellInfo(id);
    return i ? `<span class="mSpell" style="--c:${hex(i.color)}" title="${esc(i.name)}">${esc(i.short)}</span>` : '';
  };
  function renderEnd() {
    if (!results) return;
    const me = myId();
    const title = results.winner != null ? (results.winner === me ? 'You win!' : `${esc(nameOf(results.winner))} wins`) : 'Draw';
    const mvp = results.players.find(p => p.id === results.mvp);
    const rows = results.players.map((p, i) => `
      <tr class="${p.id === me ? 'me' : ''}">
        <td class="mRank">${i + 1}</td>
        <td>${p.id === results.mvp ? '<span class="mvp">MVP</span>' : ''}${esc(p.name)}${p.bot ? '<span class="bot">bot</span>' : ''}</td>
        <td>${p.kills}</td><td>${p.deaths}</td><td>${p.dmg}</td>
        <td class="mLoadout">${p.loadout ? SLOTS.map(s => spellChip(p.loadout[s])).join('') : ''}</td>
      </tr>`).join('');
    const reason = { time: 'time up', target: `first to ${results.target ?? match?.target ?? 10}`, skip: 'ended early' }[results.reason] || 'match over';
    ui.end.innerHTML = `
      <div class="mPanel">
        <div class="mKicker">Free-for-all · ${reason}</div>
        <h1>${title}</h1>
        ${mvp ? `<div class="mMvp">MVP <b>${esc(mvp.name)}</b> · ${mvp.kills} kills · ${mvp.dmg} damage</div>` : ''}
        <table><thead><tr><th></th><th>Wizard</th><th>K</th><th>D</th><th>Dmg</th><th>Loadout</th></tr></thead>
        <tbody>${rows}</tbody></table>
        <div class="mNext">Rematch in <b class="mRe"></b> s. Change your loadout with <kbd>Esc</kbd>: it applies when the next match starts.</div>
      </div>`;
  }
  function showPhase() {
    const ph = match?.phase;
    ui.end.classList.toggle('hidden', ph !== 'end' || !results);
    if (ph === 'end') renderEnd();
  }
  function setMatch(m) {
    const prev = match;
    match = m; matchAt = performance.now();
    if (!prev || prev.phase !== m.phase) {
      if (m.phase === 'warmup' && m.left != null) banner('Free-for-all', `Warm-up · first to ${m.target} kills`, 3.5);
      if (m.phase === 'live' && prev) banner('Fight!', `First to ${m.target} kills`, 2);
      showPhase();
    }
  }

  return {
    state: () => match,
    onWelcome(msg) {
      root.classList.remove('hidden');
      for (const p of msg.players || []) info.set(p.id, p);
      if (msg.results) results = msg.results;
      if (msg.match) setMatch(msg.match);
    },
    onSnapshot(msg) {
      for (const s of msg.players) info.set(s.id, s);
      if (info.size > msg.players.length + 4) { const ids = new Set(msg.players.map(s => s.id)); for (const id of info.keys()) if (!ids.has(id)) info.delete(id); }
      if (msg.match) setMatch(msg.match);
    },
    onMessage(msg) {
      switch (msg.t) {
        case 'matchPhase': setMatch(msg.match); break;
        case 'matchEnd': results = msg.results; renderEnd(); showPhase(); break;
      }
    },
    update() {
      if (!match) return;
      renderTop();
      if (match.phase === 'end') { const c = ui.end.querySelector('.mRe'), l = left(); if (c && l != null) c.textContent = Math.ceil(l); }
      if (match.phase === 'warmup' && left() != null && left() < 3.5 && performance.now() > bannerUntil) banner(String(Math.ceil(left())), 'Get ready', 0.3);
      if (performance.now() > bannerUntil) ui.banner.classList.add('hidden');
    },
  };
}
