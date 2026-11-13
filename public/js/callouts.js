// Callouts (characters track, round 22): the streak and multikill banners under the match bar with a short sting, the rune
// announcer line ("Fury rune taken by X"), the "Next map" chip during the rematch countdown, and the map-change fade.
//
// main.js (spells):
//   const callouts = mountCallouts({ sfx, players, myId: () => myId })
//   callouts.onMessage(msg)       every server message (it ignores what isn't its own):
//     { t: 'callout', kind, id, label?, sub?, victim?, streak?, multi? }   kind: first_blood · double · triple · streak (3/5/8) · shutdown
//                                   (room.js sends label and sub; the banner uses its own "you" lines for the local player)
//     { t: 'runeTaken', i, by, type }                                      the announcer line
//     snap / matchPhase / welcome with msg.match { phase, next: { id, name } | null }   the "Next map" chip in the recap phase
//   callouts.update(dt)           per frame
//   await callouts.mapChange({ name, swap })   fade to black with the map's name, await swap(), fade back in
//   callouts.show(kind, opts)     a banner by hand (tests, the podium)
// The sting is synthesized on the Sfx's AudioContext into its sfx bus, so mute and volume apply and no sound file is needed.
import { RUNE_TYPES } from './pickups.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// The banners: big line, small line (you / name), priority (bigger first when two arrive together), the sting's notes.
const BANNERS = {
  first_blood: { big: 'First Blood!', small: (n, me) => me ? 'You drew first blood' : `${n} drew first blood`, prio: 2, notes: [523, 784], cls: 'co-first' },
  double: { big: 'Double Kill!', small: (n, me) => me ? 'Two in 4 seconds' : `${n} · two in 4 seconds`, prio: 3, notes: [523, 659, 784], cls: 'co-multi' },
  triple: { big: 'Triple Kill!', small: (n, me) => me ? 'Three in a row, fast' : `${n} · three in a row, fast`, prio: 4, notes: [523, 659, 784, 1047], cls: 'co-multi' },
  streak3: { big: 'On Fire!', small: (n, me) => `${me ? 'You' : n} · 3 kills without dying`, prio: 5, notes: [587, 740, 880], cls: 'co-s3' },
  streak5: { big: 'Unstoppable!', small: (n, me) => `${me ? 'You' : n} · 5 kills without dying`, prio: 6, notes: [587, 740, 880, 1175], cls: 'co-s5' },
  streak8: { big: 'Archmage!', small: (n, me) => `${me ? 'You' : n} · 8 kills without dying`, prio: 7, notes: [659, 831, 988, 1319, 1661], cls: 'co-s8' },
  shutdown: { big: 'Shutdown!', small: (n, me, v, k) => `${me ? 'You' : n} ended ${v}'s ${k ? `${k}-kill ` : ''}streak`, prio: 1, notes: [784, 523], cls: 'co-shut' },
};
const SHOW = 2.1, GAP = 0.9;   // a banner stays SHOW s; a queued one follows after GAP s of the current one

export function mountCallouts({ sfx = null, players = null, myId = () => null } = {}) {
  if (!document.querySelector('link[data-callouts-css]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = './css/callouts.css'; l.dataset.calloutsCss = '1';
    document.head.appendChild(l);
  }
  const root = document.createElement('div');
  root.id = 'callouts';
  root.innerHTML = `<div class="co-banner" hidden><div class="co-big"></div><div class="co-small"></div></div>
    <div class="co-line" hidden></div>
    <div class="co-next" hidden>Next map: <b></b></div>
    <div class="co-fade" hidden><div class="co-map"><span class="co-kicker">Next map</span><b></b></div></div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const ui = { banner: $('.co-banner'), big: $('.co-big'), small: $('.co-small'), line: $('.co-line'), next: $('.co-next'), nextName: $('.co-next b'), fade: $('.co-fade'), fadeName: $('.co-fade b') };

  const nameOf = (id, fallback) => players?.get?.(id)?.name || fallback || '?';
  let t = 0;                        // seconds, from update(dt)
  const queue = [];                 // banners waiting: { kind, big, small, cls, notes, mine }
  let shownAt = -1e9, hideAt = 0;   // the current banner's times
  let lineHideAt = 0;

  // ---------------------------------------------------------------- the sting (synthesized)
  // A quick rising arpeggio of soft bell tones (a sine with a touch of its octave), one note every 70 ms, each ringing 0.5 s;
  // the shutdown's two notes fall instead. Into the sfx bus: mute and the volume slider apply.
  function sting(notes, mine) {
    const ctx = sfx?.ctx, bus = sfx?.sfxBus;
    if (!ctx || !bus || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + 0.01, vol = mine ? 0.26 : 0.18;
    notes.forEach((f, i) => {
      const at = t0 + i * 0.07;
      for (const [mult, g] of [[1, 1], [2, 0.3], [3, 0.08]]) {
        const o = ctx.createOscillator(), gain = ctx.createGain();
        o.type = mult === 1 ? 'sine' : 'triangle'; o.frequency.value = f * mult;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(vol * g, at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0008, at + 0.55 + i * 0.05);
        o.connect(gain).connect(bus);
        o.start(at); o.stop(at + 0.7 + i * 0.05);
      }
    });
    // a short breath of noise under the big streaks
    if (notes.length >= 4) {
      const n = ctx.createBufferSource(), buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.35), ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.8;
      const g = ctx.createGain(); g.gain.value = vol * 0.5;
      n.buffer = buf; n.connect(f).connect(g).connect(bus); n.start(t0);
    }
  }
  function tick(f = 1320) {   // the rune line's soft chime
    const ctx = sfx?.ctx, bus = sfx?.sfxBus;
    if (!ctx || !bus || ctx.state !== 'running') return;
    const at = ctx.currentTime + 0.01, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.1, at + 0.01); g.gain.exponentialRampToValueAtTime(0.0008, at + 0.3);
    o.connect(g).connect(bus); o.start(at); o.stop(at + 0.35);
  }

  // ---------------------------------------------------------------- banners
  function show(kind, { id = null, name = null, victim = null, victimName = null, streak = 0, label = null, sub = null, multi = 0 } = {}) {
    const key = kind === 'streak' ? `streak${streak >= 8 ? 8 : streak >= 5 ? 5 : 3}` : kind;
    const B = BANNERS[key] || (label ? { big: label, small: () => sub || '', prio: 1, notes: [659, 880], cls: 'co-multi' } : null);
    if (!B) return false;
    const mine = id != null && id === myId();
    const n = esc(nameOf(id, name)), v = esc(nameOf(victim, victimName));
    // the server's label and sub (room.js) win for a kind this doesn't know, or a 4+ multi kill ("Multi Kill!"); the "you" lines are ours
    const big = (!BANNERS[key] || (multi > 3 && label)) ? label : B.big;
    const small = mine || !sub ? B.small(n, mine, v, streak) : esc(sub);
    const item = { kind: key, big, small, cls: B.cls + (mine ? ' co-mine' : ''), notes: B.notes, prio: B.prio + (mine ? 10 : 0) };
    queue.push(item);
    queue.sort((a, b) => b.prio - a.prio);   // (shown from update(): two arriving in the same tick go bigger first)
    return true;
  }
  function pump() {
    if (!queue.length) return;
    if (!ui.banner.hidden && t - shownAt < GAP) return;   // the current one has its moment; update() calls again
    const b = queue.shift();
    ui.big.textContent = b.big; ui.small.innerHTML = b.small;
    ui.banner.className = `co-banner ${b.cls}`;
    ui.banner.hidden = false;
    // restart the pop animation
    ui.banner.style.animation = 'none'; void ui.banner.offsetWidth; ui.banner.style.animation = '';
    shownAt = t; hideAt = t + SHOW;
    sting(b.notes, b.cls.includes('co-mine'));
  }

  // ---------------------------------------------------------------- the rune line and the next-map chip
  function line(html, secs = 2.4, color = null) {
    ui.line.innerHTML = html;
    ui.line.style.setProperty('--c', color || '#ffc857');
    ui.line.hidden = false;
    ui.line.style.animation = 'none'; void ui.line.offsetWidth; ui.line.style.animation = '';
    lineHideAt = t + secs;
  }
  function runeTaken(msg) {
    const R = RUNE_TYPES[msg.type];
    if (!R) return;
    const mine = msg.by != null && msg.by === myId();
    line(`<i>${R.glyphChar}</i> ${esc(R.name)} rune taken by <b>${mine ? 'you' : esc(nameOf(msg.by, msg.byName))}</b>`, 2.4, R.css);
    tick(mine ? 1568 : 1320);
  }
  let match = null;
  function setMatch(m) {
    match = m || null;
    const next = match?.phase === 'recap' && match.next?.name;
    ui.next.hidden = !next;
    if (next) ui.nextName.textContent = match.next.name;
  }

  // ---------------------------------------------------------------- the map-change fade
  let fading = Promise.resolve();
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  function mapChange({ name = '', swap = null } = {}) {
    const run = async () => {
      ui.fadeName.textContent = name;
      ui.fade.classList.toggle('co-named', !!name);
      ui.fade.hidden = false;
      ui.fade.classList.remove('co-in'); void ui.fade.offsetWidth; ui.fade.classList.add('co-in');
      await wait(380);
      const t0 = performance.now();
      try { await swap?.(); } catch (e) { console.warn('[callouts] map swap', e); }
      if (name) await wait(Math.max(0, 450 - (performance.now() - t0)));   // the name reads for a moment at least
      ui.fade.classList.remove('co-in');
      await wait(620);
      if (!ui.fade.classList.contains('co-in')) ui.fade.hidden = true;
    };
    fading = fading.then(run, run);
    return fading;
  }

  return {
    show, mapChange, setMatch,
    onMessage(msg) {
      switch (msg.t) {
        case 'callout': show(msg.kind, msg); break;
        case 'runeTaken': runeTaken(msg); break;
        case 'snap': case 'matchPhase': case 'welcome': if (msg.match) setMatch(msg.match); break;
        case 'recap': if (msg.next && match) setMatch({ ...match, phase: 'recap', next: msg.next }); break;
      }
    },
    update(dt) {
      t += dt;
      if (!ui.banner.hidden && t >= hideAt) ui.banner.hidden = true;
      if (!ui.line.hidden && t >= lineHideAt) ui.line.hidden = true;
      pump();
    },
    // tests
    _state: () => ({ queue: queue.map(q => q.kind), showing: ui.banner.hidden ? null : ui.big.textContent, line: ui.line.hidden ? null : ui.line.textContent, next: ui.next.hidden ? null : ui.nextName.textContent, fading: !ui.fade.hidden }),
  };
}
