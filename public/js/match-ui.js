// Match UI: warm-up, scoreboard and timer HUD, the Altar Siege zone (circle, next-spot ghost, arrows), end screen,
// mode vote. Modes agent. main.js calls:
//   const matchUI = mountMatchUI({ scene, camera, net, players, props, myId: () => myId })
//   matchUI.onWelcome(msg)   the welcome message (with any welcomeExtras)
//   matchUI.onSnapshot(msg)  every 'snap' (with snapshotExtras, e.g. msg.match)
//   matchUI.onMessage(msg)   any message whose type starts with 'match'
//   matchUI.update(dt)       every frame while in game
//   matchUI.state()          the latest match state ({ mode, phase, scores, zone: { x, z, r, owner, contested, next, nextAt }, ... })
import * as THREE from 'three';

const MODE_NAMES = { ffa: 'Free-for-all', tdm: 'Team Deathmatch', siege: 'Altar Siege' };
const MODE_BLURB = {
  ffa: 'Everyone for themselves. First to 15 kills.',
  tdm: 'Ember vs Frost, 3v3. First team to 30 kills.',
  siege: 'Hold the rune circle: it hops every 60 s. First team to 100%.',
};
const TEAM = { ember: { name: 'Ember', color: 0xff6a2a }, frost: { name: 'Frost', color: 0x3aa8ff } };
const NEUTRAL = 0xffc857;
const VOTE_KEYS = { Digit1: 'ffa', Digit2: 'tdm', Digit3: 'siege' };
const WARN = 5;   // seconds of hop warning (server: SIEGE.warn)
const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const clock = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const pct = (v) => `${Math.floor(v)}%`;

export function mountMatchUI(env) {
  const { scene, camera, net, players, myId } = env;

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
      <div class="mTeam ember"><span class="mName">Ember</span><span class="mScore">0</span><div class="mFill"></div><div class="mTicks"></div></div>
      <div class="mCenter"><div class="mMode"></div><div class="mClock">0:00</div><div class="mSub"></div></div>
      <div class="mTeam frost"><span class="mScore">0</span><span class="mName">Frost</span><div class="mFill"></div><div class="mTicks"></div></div>
    </div>
    <div id="mZone" class="hidden"></div>
    <div id="mTicker"></div>
    <div id="mBanner" class="hidden"><div class="big"></div><div class="small"></div></div>
    <div class="mArrow hidden" id="mArrowZone"><div class="tip"></div><span>ZONE</span></div>
    <div class="mArrow next hidden" id="mArrowNext"><div class="tip"></div><span>NEXT</span></div>
    <div id="mEnd" class="hidden"></div>
    <div id="mVote" class="hidden"></div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const ui = {
    top: $('#mTop'), mode: $('.mMode'), clock: $('.mClock'), sub: $('.mSub'),
    ember: $('.mTeam.ember'), frost: $('.mTeam.frost'),
    zone: $('#mZone'), ticker: $('#mTicker'), banner: $('#mBanner'),
    arrowZone: $('#mArrowZone'), arrowNext: $('#mArrowNext'), end: $('#mEnd'), vote: $('#mVote'),
  };

  // ------------------------------------------------------------ state
  let match = null, matchAt = 0;      // last match state and when it arrived (performance.now ms)
  let results = null, myVote = null, joined = false;
  const info = new Map();             // player id -> its latest snapshot entry ({ team, teamColor, name, kills, ... })
  const nameOf = (id) => info.get(id)?.name || players.get(id)?.name || '?';
  const teamTag = (team) => team ? `<span class="tag ${team}">${TEAM[team].name}</span>` : '';
  const since = () => (performance.now() - matchAt) / 1000;
  const left = () => match?.left == null ? null : Math.max(0, match.left - since());
  const hopIn = () => match?.zone?.nextAt == null ? null : Math.max(0, match.zone.nextAt - since());

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

  // ------------------------------------------------------------ the zone in the world
  const additive = (color, opacity, extra = {}) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, ...extra });
  // a soft wall of light: bright at the ground, fading upward
  const fadeTex = (() => {
    const cv = document.createElement('canvas'); cv.width = 4; cv.height = 64;
    const g = cv.getContext('2d'), grd = g.createLinearGradient(0, 0, 0, 64);
    grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = grd; g.fillRect(0, 0, 4, 64);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  function makeCircle(r, ghost) {
    const g = new THREE.Group();
    const parts = {};
    parts.edge = new THREE.Mesh(new THREE.RingGeometry(r - 0.45, r, 96).rotateX(-Math.PI / 2), additive(NEUTRAL, ghost ? 0.5 : 1));
    parts.edge.position.y = 0.06;
    // the rune band: 16 arc segments turning slowly inside the edge
    parts.runes = new THREE.Group();
    for (let i = 0; i < 16; i++) {
      const arc = new THREE.Mesh(new THREE.RingGeometry(r - 1.05, r - 0.55, 8, 1, i / 16 * Math.PI * 2, Math.PI * 2 / 16 * 0.62).rotateX(-Math.PI / 2), additive(NEUTRAL, ghost ? 0.25 : 0.5));
      parts.runes.add(arc);
    }
    parts.runes.position.y = 0.05;
    g.add(parts.edge, parts.runes);
    if (!ghost) {
      parts.disc = new THREE.Mesh(new THREE.CircleGeometry(r, 64).rotateX(-Math.PI / 2), additive(NEUTRAL, 0.1));
      parts.disc.position.y = 0.04;
      parts.wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 2.2, 96, 1, true).translate(0, 1.1, 0), additive(NEUTRAL, 0.45, { map: fadeTex, side: THREE.DoubleSide }));
      g.add(parts.disc, parts.wall);
    }
    // a light column at the centre, seen across the map
    parts.beamOuter = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 60, 16, 1, true).translate(0, 30, 0), additive(NEUTRAL, ghost ? 0.22 : 0.12, { side: THREE.DoubleSide }));
    parts.beamCore = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.18, 60, 8, 1, true).translate(0, 30, 0), additive(0xfff6dc, ghost ? 0.6 : 0.35));
    g.add(parts.beamOuter, parts.beamCore);
    g.visible = false;
    scene.add(g);
    return { g, parts, r };
  }
  let zoneFx = null, ghostFx = null;
  const circleFor = (fx, r, ghost) => (fx && Math.abs(fx.r - r) < 0.01) ? fx : (fx && scene.remove(fx.g), makeCircle(r, ghost));
  function paint(fx, color) {
    for (const k of ['edge', 'disc', 'wall', 'beamOuter']) fx.parts[k]?.material.color.setHex(color);
    for (const a of fx.parts.runes.children) a.material.color.setHex(color);
  }

  // ------------------------------------------------------------ HUD
  function renderTop() {
    if (!match) return;
    const teams = match.teams, siege = match.mode === 'siege';
    ui.top.classList.toggle('teams', teams);
    ui.top.classList.toggle('contested', !!(siege && match.phase === 'live' && match.zone?.contested));
    ui.mode.textContent = MODE_NAMES[match.mode] || match.mode;
    const l = left();
    const me = info.get(myId());
    ui.clock.classList.remove('urgent', 'ot');
    if (match.phase === 'warmup') { ui.clock.textContent = l == null ? '—' : clock(l); ui.sub.textContent = 'Warm-up'; }
    else if (match.phase === 'live') {
      if (match.overtime != null) { ui.clock.textContent = `OT ${Math.ceil(Math.max(0, match.overtime - since()))}`; ui.clock.classList.add('ot'); }
      else { ui.clock.textContent = l == null ? '' : clock(l); ui.clock.classList.toggle('urgent', l != null && l < 30); }
      if (teams) ui.sub.innerHTML = `First to ${match.target}${siege ? '%' : ''}${me?.team ? ` · you are ${teamTag(me.team)}` : ''}`;
      else {
        const list = [...info.values()].filter(p => !p.spectator).sort((a, b) => b.kills - a.kills);
        const lead = list[0];
        ui.sub.innerHTML = `You <b>${me?.kills ?? 0}</b> · leader ${lead ? `${esc(lead.name)} <b>${lead.kills}</b>` : '—'} / ${match.target}`;
      }
    } else { ui.clock.textContent = l == null ? '' : clock(l); ui.sub.textContent = match.phase === 'end' ? 'Match over' : 'Vote for the next mode'; }
    if (teams) {
      for (const k of ['ember', 'frost']) {
        const el = ui[k], s = match.scores[k];
        el.querySelector('.mScore').textContent = siege ? pct(s) : s;
        el.querySelector('.mFill').style.width = `${Math.min(100, s / match.target * 100)}%`;
        el.classList.toggle('mine', me?.team === k);
        el.classList.toggle('holding', !!(siege && match.zone?.owner === k && match.phase === 'live'));
      }
    }
    renderZoneLine(me);
  }
  function renderZoneLine(me) {
    const z = match.zone;
    ui.zone.classList.toggle('hidden', !z);
    if (!z) return;
    const hop = hopIn();
    let state;
    if (match.phase === 'warmup') state = `the circle starts here · nothing scores in the warm-up`;
    else if (z.contested) state = `<b class="cont">CONTESTED</b> · ${z.inside.ember} v ${z.inside.frost}`;
    else if (z.owner) state = `<b style="color:${hex(TEAM[z.owner].color)}">${TEAM[z.owner].name}</b> holding · +${z.inside[z.owner] >= 2 ? '1.5' : '1'}%/s`;
    else state = 'nobody holds it: <b>stand in the circle</b>';
    let when = '';
    if (match.overtime != null) when = `<span class="zTime ot">overtime: until the zone is clear</span>`;
    else if (hop != null && hop <= WARN) when = `<span class="zTime warn">moves to <b>${esc(z.next.name)}</b> in ${Math.ceil(hop)}s</span>`;
    else if (hop != null) when = `<span class="zTime">moves in ${Math.ceil(hop)}s</span>`;
    const mine = me && !me.dead && Math.hypot(me.p[0] - z.x, me.p[2] - z.z) <= z.r ? '<span class="zIn">you\'re in</span>' : '';
    ui.zone.classList.toggle('contested', !!z.contested && match.phase === 'live');
    ui.zone.innerHTML = `<span class="zIcon"></span><b>${esc(z.name)}</b> · ${state}${mine}${when}`;
  }
  // "+1%" ticks floating off your team's bar while it fills
  let tickClock = 0;
  function tickBars(dt) {
    const z = match.zone;
    if (match.mode !== 'siege' || match.phase !== 'live' || !z?.owner || z.contested) { tickClock = 0; return; }
    tickClock += dt;
    if (tickClock < 1) return;
    tickClock = 0;
    const d = document.createElement('div');
    d.className = 'mTick';
    d.textContent = `+${z.inside[z.owner] >= 2 ? '1.5' : '1'}%`;
    ui[z.owner].querySelector('.mTicks').appendChild(d);
    setTimeout(() => d.remove(), 1200);
  }

  // ------------------------------------------------------------ end screen and vote
  function renderEnd() {
    if (!results) return;
    const teams = !!results.scores, siege = results.mode === 'siege';
    const me = myId();
    let title;
    if (teams) title = results.winner ? `<span style="color:${hex(TEAM[results.winner].color)}">${TEAM[results.winner].name}</span> wins` : 'Draw';
    else title = results.winner != null ? (results.winner === me ? 'You win!' : `${esc(nameOf(results.winner))} wins`) : 'Draw';
    const mvp = results.players.find(p => p.id === results.mvp);
    const rows = results.players.map(p => `
      <tr class="${p.id === me ? 'me' : ''} ${p.team || ''}">
        <td>${p.id === results.mvp ? '<span class="mvp">MVP</span>' : ''}${esc(p.name)}${p.bot ? '<span class="bot">bot</span>' : ''}</td>
        ${teams ? `<td>${teamTag(p.team)}</td>` : ''}
        <td>${p.kills}</td><td>${p.deaths}</td><td>${p.dmg}</td>${siege ? `<td>${p.pts}%</td>` : ''}
      </tr>`).join('');
    const sg = results.siege;
    const split = sg ? `<div class="mSplit">${sg.hold.map(h => `${esc(h.name)} <span class="ember">${Math.round(h.ember)}s</span>/<span class="frost">${Math.round(h.frost)}s</span>`).join(' · ')} · contested ${Math.round(sg.contested)}s${sg.overtime ? ' · overtime' : ''}</div>` : '';
    const fmt = (v) => siege ? pct(v) : v;
    const reason = { time: 'time up', overtime: 'after overtime' }[results.reason] || 'match over';
    ui.end.innerHTML = `
      <div class="mPanel">
        <div class="mKicker">${MODE_NAMES[results.mode] || results.mode} · ${reason}</div>
        <h1>${title}</h1>
        ${teams ? `<div class="mFinal"><span class="ember">${fmt(results.scores.ember)}</span> – <span class="frost">${fmt(results.scores.frost)}</span></div>` : ''}
        ${split}
        ${mvp ? `<div class="mMvp">MVP <b>${esc(mvp.name)}</b> · ${mvp.kills} kills${siege ? ` · ${mvp.pts}% captured` : ''}</div>` : ''}
        <table><thead><tr><th>Wizard</th>${teams ? '<th>Team</th>' : ''}<th>K</th><th>D</th><th>Dmg</th>${siege ? '<th>Cap</th>' : ''}</tr></thead>
        <tbody>${rows}</tbody></table>
        <div class="mNext">Vote for the next mode in a moment…</div>
      </div>`;
  }
  function renderVote() {
    const votes = match?.votes || { ffa: 0, tdm: 0, siege: 0 };
    const l = left();
    const cur = match?.mode;
    const w = results ? (results.scores ? (results.winner ? `${TEAM[results.winner].name} won` : 'Draw') : results.winner != null ? `${esc(nameOf(results.winner))} won` : 'Draw') : '';
    ui.vote.innerHTML = `
      <div class="mPanel">
        <div class="mKicker">${w ? `${w} · ` : ''}next match</div>
        <h2>Vote for the next mode <span class="mVoteClock">${l == null ? '' : Math.ceil(l)}</span></h2>
        <div class="mCards">
          ${['ffa', 'tdm', 'siege'].map((m, i) => `
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
      if (m.phase === 'warmup') { myVote = null; banner(`${MODE_NAMES[m.mode] || m.mode}`, `Warm-up · ${MODE_BLURB[m.mode] || ''}`, 3.5); }
      if (m.phase === 'live' && prev) banner('Fight!', m.teams ? `${MODE_BLURB[m.mode] || ''}` : `First to ${m.target} kills`, 2);
      if (m.phase === 'vote') myVote = null;
      showPhase();
    }
  }

  // ------------------------------------------------------------ off-screen arrows
  const v3 = new THREE.Vector3();
  function arrow(el, x, z, color) {
    const v = v3.set(x, 1.2, z).project(camera);
    const behind = v.z > 1;
    const onScreen = !behind && Math.abs(v.x) < 0.92 && Math.abs(v.y) < 0.88;
    el.classList.toggle('hidden', onScreen);
    if (onScreen) return;
    let ax = v.x, ay = v.y;
    if (behind) { ax = -ax; ay = -ay; }
    const a = Math.atan2(ay, ax);
    const k = 1 / Math.max(Math.abs(Math.cos(a)) / 0.9, Math.abs(Math.sin(a)) / 0.8);
    const sx = (Math.cos(a) * k * 0.5 + 0.5) * innerWidth, sy = (-Math.sin(a) * k * 0.5 + 0.5) * innerHeight;
    el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`;
    el.querySelector('.tip').style.transform = `rotate(${-a}rad)`;
    el.style.setProperty('--c', hex(color));
  }

  return {
    state: () => match,
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
        case 'matchMode': ticker(`Next: <b>${MODE_NAMES[msg.mode] || msg.mode}</b>`); break;
        case 'matchZone':
          if (msg.type === 'warn') ticker(`The circle moves to <b>${esc(msg.to)}</b> in ${WARN} s`);
          else if (msg.type === 'hop') banner(esc(msg.to), 'The circle has moved', 2);
          break;
        case 'matchOvertime': banner('Overtime', 'The zone is contested: clear it to finish', 2.5); break;
      }
    },
    update(dt) {
      if (!match) return;
      renderTop();
      tickBars(dt);
      if (match.phase === 'vote') { const c = ui.vote.querySelector('.mVoteClock'); const l = left(); if (c && l != null) c.textContent = Math.ceil(l); }
      if (match.phase === 'warmup' && left() != null && left() < 3.5 && performance.now() > bannerUntil) banner(String(Math.ceil(left())), 'Get ready', 0.3);
      if (performance.now() > bannerUntil) ui.banner.classList.add('hidden');

      // the siege zone
      const z = match.zone;
      if (!z) {
        if (zoneFx) zoneFx.g.visible = false;
        if (ghostFx) ghostFx.g.visible = false;
        ui.arrowZone.classList.add('hidden'); ui.arrowNext.classList.add('hidden');
        return;
      }
      const tsec = performance.now() / 1000;
      zoneFx = circleFor(zoneFx, z.r, false);
      const fx = zoneFx;
      fx.g.visible = true;
      fx.g.position.set(z.x, 0, z.z);
      fx.parts.runes.rotation.y += dt * 0.15;
      const live = match.phase === 'live';
      let color = NEUTRAL;
      if (live && z.contested) color = Math.floor(tsec * 5) % 2 ? TEAM.ember.color : TEAM.frost.color;   // flicker in both colours
      else if (live && z.owner) color = TEAM[z.owner].color;
      paint(fx, color);
      const capturing = live && z.owner && !z.contested;
      const pulse = 0.5 + 0.5 * Math.sin(tsec * (capturing ? 5 : 2));
      fx.parts.disc.material.opacity = (capturing ? 0.14 : 0.08) + pulse * 0.05 + (live && z.contested ? 0.06 : 0);
      fx.parts.wall.material.opacity = 0.38 + pulse * (capturing ? 0.25 : 0.1);
      // fade the centre column when you stand near it
      const near = Math.min(1, Math.max(0.15, (Math.hypot(camera.position.x - z.x, camera.position.z - z.z) - 3) / 16));
      fx.parts.beamOuter.material.opacity = 0.12 * near; fx.parts.beamCore.material.opacity = 0.35 * near;
      arrow(ui.arrowZone, z.x, z.z, color);

      // the next spot: a ghost circle and a beam for the last WARN seconds before the hop
      const hop = hopIn();
      const warn = live && z.next && hop != null && hop <= WARN;
      if (warn) {
        ghostFx = circleFor(ghostFx, z.next.r, true);
        ghostFx.g.visible = true;
        ghostFx.g.position.set(z.next.x, 0, z.next.z);
        ghostFx.parts.runes.rotation.y -= dt * 0.6;
        const blink = 0.55 + 0.45 * Math.sin(tsec * 8);
        ghostFx.parts.edge.material.opacity = 0.6 * blink;
        ghostFx.parts.beamOuter.material.opacity = 0.28 * blink;
        arrow(ui.arrowNext, z.next.x, z.next.z, 0xffffff);
      } else {
        if (ghostFx) ghostFx.g.visible = false;
        ui.arrowNext.classList.add('hidden');
      }
    },
  };
}
