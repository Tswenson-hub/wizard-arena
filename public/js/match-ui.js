// Match UI: warm-up, scoreboard and timer HUD, relic marker and beam, end screen, mode vote.
// Modes agent (round 5). main.js calls:
//   const matchUI = mountMatchUI({ scene, camera, net, players, props, myId: () => myId })
//   matchUI.onWelcome(msg)   the welcome message (with any welcomeExtras)
//   matchUI.onSnapshot(msg)  every 'snap' (with snapshotExtras, e.g. msg.match)
//   matchUI.onMessage(msg)   any message whose type starts with 'match'
//   matchUI.update(dt)       every frame while in game
//   matchUI.state()          the latest match state ({ mode, phase, relic: { propId, holder }, ... })
import * as THREE from 'three';
import * as C from '../shared/constants.js';

const MODE_NAMES = { ffa: 'Free-for-all', tdm: 'Team Deathmatch', relic: 'Sacred Relic' };
const MODE_BLURB = {
  ffa: 'Everyone for themselves. First to 15 kills.',
  tdm: 'Ember vs Frost, 3v3. First team to 30 kills.',
  relic: 'Hold the relic with telekinesis: +5 points a second. First to 300.',
};
const TEAM = { ember: { name: 'Ember', color: 0xff6a2a }, frost: { name: 'Frost', color: 0x3aa8ff } };
const VOTE_KEYS = { Digit1: 'ffa', Digit2: 'tdm', Digit3: 'relic' };
const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const clock = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function mountMatchUI(env) {
  const { scene, camera, net, players, props, myId } = env;

  // stylesheet (index.html isn't ours, so it's linked from here)
  if (!document.querySelector('link[data-match-css]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = '/css/match.css'; link.dataset.matchCss = '';
    document.head.appendChild(link);
  }

  // ------------------------------------------------------------ DOM
  const root = document.createElement('div');
  root.id = 'matchUI';
  root.className = 'hidden';
  root.innerHTML = `
    <div id="mTop">
      <div class="mTeam ember"><span class="mName">Ember</span><span class="mScore">0</span><div class="mFill"></div></div>
      <div class="mCenter"><div class="mMode"></div><div class="mClock">0:00</div><div class="mSub"></div></div>
      <div class="mTeam frost"><span class="mScore">0</span><span class="mName">Frost</span><div class="mFill"></div></div>
    </div>
    <div id="mRelic" class="hidden"></div>
    <div id="mTicker"></div>
    <div id="mBanner" class="hidden"><div class="big"></div><div class="small"></div></div>
    <div id="mArrow" class="hidden"><div class="tip"></div><span>RELIC</span></div>
    <div id="mEnd" class="hidden"></div>
    <div id="mVote" class="hidden"></div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const ui = {
    top: $('#mTop'), mode: $('.mMode'), clock: $('.mClock'), sub: $('.mSub'),
    ember: $('.mTeam.ember'), frost: $('.mTeam.frost'),
    relic: $('#mRelic'), ticker: $('#mTicker'), banner: $('#mBanner'), arrow: $('#mArrow'), end: $('#mEnd'), vote: $('#mVote'),
  };

  // ------------------------------------------------------------ state
  let match = null, matchAt = 0;      // last match state and when it arrived (performance.now ms)
  let results = null, myVote = null, joined = false;
  const info = new Map();             // player id -> { team, teamColor, name, kills, deaths, dmg, pts, bot }
  const nameOf = (id) => info.get(id)?.name || players.get(id)?.name || '?';
  const teamTag = (team) => team ? `<span class="tag ${team}">${TEAM[team].name}</span>` : '';
  const left = () => match?.left == null ? null : Math.max(0, match.left - (performance.now() - matchAt) / 1000);

  function ticker(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    ui.ticker.prepend(d);
    while (ui.ticker.children.length > 4) ui.ticker.lastChild.remove();
    setTimeout(() => d.remove(), 5000);
  }
  let bannerUntil = 0;
  function banner(big, small = '', secs = 2.5) {
    ui.banner.querySelector('.big').innerHTML = big;
    ui.banner.querySelector('.small').innerHTML = small;
    ui.banner.classList.remove('hidden');
    bannerUntil = performance.now() + secs * 1000;
  }

  // ------------------------------------------------------------ relic visuals
  const gold = 0xffc857;
  const relicFx = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.85, 24, 16),
    new THREE.MeshBasicMaterial({ color: gold, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  const cage = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 1),
    new THREE.MeshBasicMaterial({ color: 0xffe08a, wireframe: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  const light = new THREE.PointLight(gold, 6, 9, 1.6);
  relicFx.add(shell, cage, light);
  // the beam stands on the relic's ground spot (it doesn't tilt with the hold point)
  const beam = new THREE.Group();
  const beamOuter = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.9, 70, 20, 1, true).translate(0, 35, 0),
    new THREE.MeshBasicMaterial({ color: gold, transparent: true, opacity: 0.26, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  const beamCore = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 70, 10, 1, true).translate(0, 35, 0),
    new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  const groundRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.25, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: gold, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  groundRing.position.y = 0.05;
  beam.add(beamOuter, beamCore, groundRing);
  relicFx.visible = beam.visible = false;
  scene.add(relicFx, beam);

  // "+5" tickers rising over the holder
  function plusSprite(team) {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
    const g = cv.getContext('2d');
    g.font = 'bold 44px "Trebuchet MS", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,0.75)'; g.strokeText('+5', 64, 34);
    g.fillStyle = team ? hex(TEAM[team].color) : '#ffc857'; g.fillText('+5', 64, 34);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false }));
    sp.scale.set(1.1, 0.55, 1); sp.renderOrder = 12;
    return sp;
  }
  const plusMats = { ember: plusSprite('ember'), frost: plusSprite('frost') };
  const pluses = [];
  let plusClock = 0;

  const relicWorld = new THREE.Vector3();
  // Where the relic is right now on this client: in a holder's telekinesis grip, or on the ground.
  function relicPosition(r) {
    const holder = r.holder != null && players.get(r.holder);
    if (holder && !holder.dead) {
      if (holder.carry?.holder) return relicWorld.copy(holder.carry.holder.position);
      if (holder.holdPoint) return relicWorld.copy(holder.holdPoint());
    }
    const e = props.get(r.propId);
    if (e && e.data.state === 'idle') return relicWorld.set(e.data.x, (C.PROP_TYPES[e.data.type]?.h || 1) * 0.5, e.data.z);
    if (e && e.data.carrier != null) {
      const c = players.get(e.data.carrier);
      if (c?.carry?.holder) return relicWorld.copy(c.carry.holder.position);
    }
    return relicWorld.set(r.x, 0.5, r.z);
  }

  // ------------------------------------------------------------ HUD
  function renderTop() {
    if (!match) return;
    const teams = match.teams;
    ui.top.classList.toggle('teams', teams);
    ui.mode.textContent = MODE_NAMES[match.mode] || match.mode;
    const l = left();
    const me = info.get(myId());
    if (match.phase === 'warmup') { ui.clock.textContent = l == null ? '—' : clock(l); ui.sub.textContent = 'Warm-up'; }
    else if (match.phase === 'live') {
      ui.clock.textContent = l == null ? '' : clock(l);
      ui.clock.classList.toggle('urgent', l != null && l < 30);
      if (teams) ui.sub.innerHTML = `First to ${match.target}${me?.team ? ` · you are ${teamTag(me.team)}` : ''}`;
      else {
        const list = [...info.values()].filter(p => !p.spectator).sort((a, b) => b.kills - a.kills);
        const lead = list[0];
        ui.sub.innerHTML = `You <b>${me?.kills ?? 0}</b> · leader ${lead ? `${esc(lead.name)} <b>${lead.kills}</b>` : '—'} / ${match.target}`;
      }
    } else { ui.clock.textContent = l == null ? '' : clock(l); ui.sub.textContent = match.phase === 'end' ? 'Match over' : 'Vote for the next mode'; }
    if (teams) {
      for (const k of ['ember', 'frost']) {
        const el = ui[k], s = match.scores[k];
        el.querySelector('.mScore').textContent = s;
        el.querySelector('.mFill').style.width = `${Math.min(100, s / match.target * 100)}%`;
        el.classList.toggle('mine', me?.team === k);
      }
    }
    // relic line
    const r = match.relic;
    ui.relic.classList.toggle('hidden', !r);
    if (r) {
      const h = r.holder != null ? info.get(r.holder) : null;
      const who = h ? `<b style="color:${hex(TEAM[h.team]?.color ?? 0xffc857)}">${esc(h.name)}</b> holds the relic · +5/s ${teamTag(h.team)}` : r.propId == null ? 'The relic is about to appear' : 'The relic is free: <b>lift it</b> (F)';
      const tl = Math.max(0, r.left - (performance.now() - matchAt) / 1000);
      ui.relic.innerHTML = `<span class="relicIcon"></span>${who}<span class="relicTime">moves in ${Math.ceil(tl)}s</span>`;
    }
  }

  // ------------------------------------------------------------ end screen and vote
  function renderEnd() {
    if (!results) return;
    const teams = !!results.scores;
    const me = myId();
    let title;
    if (teams) title = results.winner ? `<span style="color:${hex(TEAM[results.winner].color)}">${TEAM[results.winner].name}</span> wins` : 'Draw';
    else title = results.winner != null ? (results.winner === me ? 'You win!' : `${esc(nameOf(results.winner))} wins`) : 'Draw';
    const mvp = results.players.find(p => p.id === results.mvp);
    const rows = results.players.map(p => `
      <tr class="${p.id === me ? 'me' : ''} ${p.team || ''}">
        <td>${p.id === results.mvp ? '<span class="mvp">MVP</span>' : ''}${esc(p.name)}${p.bot ? '<span class="bot">bot</span>' : ''}</td>
        ${teams ? `<td>${teamTag(p.team)}</td>` : ''}
        <td>${p.kills}</td><td>${p.deaths}</td><td>${p.dmg}</td>${results.mode === 'relic' ? `<td>${p.pts}</td>` : ''}
      </tr>`).join('');
    ui.end.innerHTML = `
      <div class="mPanel">
        <div class="mKicker">${MODE_NAMES[results.mode]} · ${results.reason === 'time' ? 'time up' : 'match over'}</div>
        <h1>${title}</h1>
        ${teams ? `<div class="mFinal"><span class="ember">${results.scores.ember}</span> – <span class="frost">${results.scores.frost}</span></div>` : ''}
        ${mvp ? `<div class="mMvp">MVP <b>${esc(mvp.name)}</b> · ${mvp.kills} kills${results.mode === 'relic' ? ` · ${mvp.pts} points` : ''}</div>` : ''}
        <table><thead><tr><th>Wizard</th>${teams ? '<th>Team</th>' : ''}<th>K</th><th>D</th><th>Dmg</th>${results.mode === 'relic' ? '<th>Pts</th>' : ''}</tr></thead>
        <tbody>${rows}</tbody></table>
        <div class="mNext">Vote for the next mode in a moment…</div>
      </div>`;
  }
  function renderVote() {
    const votes = match?.votes || { ffa: 0, tdm: 0, relic: 0 };
    const l = left();
    const cur = match?.mode;
    const w = results ? (results.scores ? (results.winner ? `${TEAM[results.winner].name} won` : 'Draw') : results.winner != null ? `${esc(nameOf(results.winner))} won` : 'Draw') : '';
    ui.vote.innerHTML = `
      <div class="mPanel">
        <div class="mKicker">${w ? `${w} · ` : ''}next match</div>
        <h2>Vote for the next mode <span class="mVoteClock">${l == null ? '' : Math.ceil(l)}</span></h2>
        <div class="mCards">
          ${['ffa', 'tdm', 'relic'].map((m, i) => `
            <button class="mCard ${myVote === m ? 'picked' : ''} ${m}" data-mode="${m}">
              <kbd>${i + 1}</kbd><div class="mCardName">${MODE_NAMES[m]}</div>
              <div class="mCardBlurb">${MODE_BLURB[m]}</div>
              <div class="mCardVotes">${'●'.repeat(votes[m] || 0) || '&nbsp;'}<span>${votes[m] || 0}</span></div>
              ${m === cur ? '<div class="mCardCur">current · wins ties</div>' : ''}
            </button>`).join('')}
        </div>
        <div class="mNext">Press <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> or click. Majority wins; a tie keeps ${MODE_NAMES[cur] || 'the current mode'}.</div>
      </div>`;
  }
  ui.vote.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b) vote(b.dataset.mode);
  });
  function vote(mode) {
    if (match?.phase !== 'vote') return;
    myVote = mode;
    net.send({ t: 'vote', mode });
    renderVote();
  }
  addEventListener('keydown', (e) => {
    if (!joined || match?.phase !== 'vote' || !VOTE_KEYS[e.code] || e.target.closest?.('input, select, textarea')) return;
    vote(VOTE_KEYS[e.code]);
  });

  function showPhase() {
    const ph = match?.phase;
    ui.end.classList.toggle('hidden', ph !== 'end' || !results);
    ui.vote.classList.toggle('hidden', ph !== 'vote');
    if (ph === 'end') renderEnd();
    if (ph === 'vote') renderVote();
  }

  // ------------------------------------------------------------ team colours on the rings
  function tintRings() {
    for (const [id, w] of players) {
      const p = info.get(id);
      const want = p?.teamColor ?? w.color;
      if (w.ring && want != null && w.ringTint !== want) { w.ring.material.color.setHex(want); w.ringTint = want; }
    }
  }

  function setMatch(m) {
    const prev = match;
    match = m; matchAt = performance.now();
    if (!prev || prev.phase !== m.phase || prev.mode !== m.mode) {
      if (m.phase === 'warmup') { myVote = null; banner(`${MODE_NAMES[m.mode]}`, `Warm-up · ${MODE_BLURB[m.mode]}`, 3.5); }
      if (m.phase === 'live' && prev) banner('Fight!', m.teams ? `${MODE_BLURB[m.mode]}` : `First to ${m.target} kills`, 2);
      if (m.phase === 'vote') myVote = null;
      showPhase();
    }
  }

  return {
    state: () => match,   // the latest match state (e.g. match.relic.propId), for main.js
    onWelcome(msg) {
      joined = true;
      root.classList.remove('hidden');
      for (const p of msg.players || []) info.set(p.id, p);
      if (msg.results) results = msg.results;
      if (msg.match) setMatch(msg.match);
    },
    onSnapshot(msg) {
      for (const s of msg.players) info.set(s.id, s);
      if (info.size > msg.players.length + 4) { const ids = new Set(msg.players.map(s => s.id)); for (const id of info.keys()) if (!ids.has(id)) info.delete(id); }
      if (msg.match) {
        const prevVotes = JSON.stringify(match?.votes);
        setMatch(msg.match);
        if (match.phase === 'vote' && JSON.stringify(match.votes) !== prevVotes) renderVote();
      }
      tintRings();
    },
    onMessage(msg) {
      switch (msg.t) {
        case 'matchPhase': setMatch(msg.match); break;
        case 'matchEnd': results = msg.results; renderEnd(); showPhase(); break;
        case 'matchVotes': if (match) { match.votes = msg.votes; if (match.phase === 'vote') renderVote(); } break;
        case 'matchMode': ticker(`Next: <b>${MODE_NAMES[msg.mode]}</b>`); break;
        case 'matchRelic': {
          if (msg.type === 'lift') ticker(`<b>${esc(nameOf(msg.by))}</b> lifted the relic ${teamTag(msg.team)}`);
          else if (msg.type === 'holderDied') ticker(`The relic holder <b>${esc(nameOf(msg.by))}</b> fell: the relic moves`);
          else if (msg.type === 'rotate') ticker('The relic moved to a new spot');
          else if (msg.type === 'knocked') ticker('The relic was knocked loose');
          if (match && msg.relic) { match.relic = msg.relic; matchAt = performance.now(); }
          break;
        }
      }
    },
    update(dt) {
      if (!match) return;
      renderTop();
      if (match.phase === 'vote') { const c = ui.vote.querySelector('.mVoteClock'); const l = left(); if (c && l != null) c.textContent = Math.ceil(l); }
      if (match.phase === 'warmup' && left() != null && left() < 3.5 && performance.now() > bannerUntil) banner(String(Math.ceil(left())), 'Get ready', 0.3);
      if (performance.now() > bannerUntil) ui.banner.classList.add('hidden');

      // the relic
      const r = match.relic;
      const show = !!(r && r.propId != null);
      relicFx.visible = beam.visible = show;
      ui.arrow.classList.toggle('hidden', !show);
      if (!show) { for (const p of pluses.splice(0)) scene.remove(p.sp); return; }
      const pos = relicPosition(r);
      const tsec = performance.now() / 1000;
      relicFx.position.copy(pos);
      cage.rotation.y += dt * 1.2; cage.rotation.x += dt * 0.5;
      const pulse = 1 + Math.sin(tsec * 4) * 0.06;
      shell.scale.setScalar(pulse);
      light.intensity = 5 + Math.sin(tsec * 4) * 1.5;
      beam.position.set(pos.x, 0, pos.z);
      // full strength from afar, faint when you're standing next to it
      const near = Math.min(1, Math.max(0.2, (Math.hypot(camera.position.x - pos.x, camera.position.z - pos.z) - 3) / 14));
      beamOuter.material.opacity = 0.26 * near; beamCore.material.opacity = 0.8 * near;
      const held = r.holder != null;
      const tc = held && info.get(r.holder)?.team;
      const col = tc ? TEAM[tc].color : gold;
      beamOuter.material.color.setHex(col); groundRing.material.color.setHex(col);
      groundRing.scale.setScalar(1 + (tsec % 1.2) * 0.6); groundRing.material.opacity = 0.6 * (1 - (tsec % 1.2) / 1.2);

      // +5 over the holder, once a second
      plusClock += dt;
      if (held && match.phase === 'live' && plusClock >= 1) {
        plusClock = 0;
        const sp = plusMats[tc]?.clone();
        if (sp) { sp.position.set(pos.x, pos.y + 1.2, pos.z); scene.add(sp); pluses.push({ sp, t: 0 }); }
      }
      for (let i = pluses.length - 1; i >= 0; i--) {
        const p = pluses[i]; p.t += dt;
        p.sp.position.y += dt * 1.1;
        p.sp.material.opacity = Math.max(0, 1 - p.t / 1.2);
        if (p.t > 1.2) { scene.remove(p.sp); pluses.splice(i, 1); }
      }

      // off-screen arrow
      const v = pos.clone().setY(pos.y + 1).project(camera);
      const behind = v.z > 1;
      const onScreen = !behind && Math.abs(v.x) < 0.92 && Math.abs(v.y) < 0.88;
      ui.arrow.classList.toggle('hidden', onScreen);
      if (!onScreen) {
        let x = v.x, y = v.y;
        if (behind) { x = -x; y = -y; }
        const a = Math.atan2(y, x);
        const k = 1 / Math.max(Math.abs(Math.cos(a)) / 0.9, Math.abs(Math.sin(a)) / 0.82);
        const sx = (Math.cos(a) * k * 0.5 + 0.5) * innerWidth, sy = (-Math.sin(a) * k * 0.5 + 0.5) * innerHeight;
        ui.arrow.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`;
        ui.arrow.querySelector('.tip').style.transform = `rotate(${-a}rad)`;
        ui.arrow.style.setProperty('--c', hex(col));
      }
    },
  };
}
