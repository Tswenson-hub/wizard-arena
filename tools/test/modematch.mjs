// usage: node tools/test/modematch.mjs <port> <mode: ffa|tdm|relic> <seconds> [difficulty] [--target N] [--cap S] [--rotate S] [--bots N (FFA)]
// Headless game-mode match. The server must run with MATCH_DEBUG=1 (e.g. MATCH_DEBUG=1 PORT=4104 node server.js).
// Joins as a spectator (no team, can't be hurt, bots ignore it), switches to the mode with a 2 s warm-up and
// lets bot fill run the match. Reports scores, team sizes over time, friendly-fire hits (should be 0),
// relic events (lifts, drops, rotations, resets on holder death) and whether points only accrue while held.
// Exits with code 1 if a check fails.
import WebSocket from 'ws';

const args = process.argv.slice(2);
const flag = (k) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : undefined; };
const [port, mode = 'tdm', secs = '480', diff = 'normal'] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const ws = new WebSocket(`ws://localhost:${port}`);
const names = {}, teamOf = {};
let myId = null, live = false, liveAt = 0, ended = null, lastMatch = null, prevSnap = null;
const ff = { hits: 0, dmg: 0, examples: [] };
const teamSizes = { min: { ember: 99, frost: 99 }, max: { ember: 0, frost: 0 }, samples: 0, unequal: 0 };
const relic = { events: [], rotates: [], resets: 0, deaths: 0, lifts: 0, drops: 0, knocked: 0, heldSnaps: 0, freeSnaps: 0, gainWhileFree: 0, gainWhileHeld: 0 };
let lastRotateAt = null;
const kills = { total: 0 };

ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name: 'Observer' })));
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.t === 'welcome') {
    myId = m.id;
    ws.send(JSON.stringify({ t: 'matchDebug', spectate: true, botDiff: diff, warmup: 2, target: flag('--target'), cap: flag('--cap'), rotate: flag('--rotate'), mode }));
    // FFA has no fill: add practice bots as the join screen would (--bots N, default 4)
    if (mode === 'ffa') for (let i = 0; i < (flag('--bots') ?? 4); i++) ws.send(JSON.stringify({ t: 'addBot', difficulty: diff }));
    return;
  }
  if (m.t === 'joined') names[m.player.id] = `${m.player.name}(${m.player.bot || 'human'})`;
  if (m.t === 'matchPhase') {
    const was = live;
    live = m.match.phase === 'live' && m.match.mode === mode;
    if (live && !was) { liveAt = Date.now(); console.log(`[${mode}] live: target ${m.match.target}`); }
  }
  if (m.t === 'matchEnd' && live) { ended = m.results; finish(); }
  if (m.t === 'death' && live) kills.total++;
  if (m.t === 'hit' && live && m.dmg > 0 && m.attacker !== m.target) {
    const a = teamOf[m.attacker], b = teamOf[m.target];
    if (a && a === b) { ff.hits++; ff.dmg += m.dmg; if (ff.examples.length < 5) ff.examples.push(`${names[m.attacker]}→${names[m.target]} ${m.kind} ${m.dmg}`); }
  }
  if (m.t === 'matchRelic' && live) {
    relic.events.push(m.type);
    if (m.type === 'rotate') { if (lastRotateAt !== null) relic.rotates.push(+(m.at - lastRotateAt).toFixed(1)); lastRotateAt = m.at; }
    if (m.type === 'reset' || m.type === 'spawn') lastRotateAt = m.at;
    if (m.type === 'reset') relic.resets++;
    if (m.type === 'holderDied') relic.deaths++;
    if (m.type === 'lift') relic.lifts++;
    if (m.type === 'drop') relic.drops++;
    if (m.type === 'knocked' || m.type === 'hit') relic.knocked++;
  }
  if (m.t === 'snap') {
    for (const p of m.players) { teamOf[p.id] = p.team; names[p.id] ??= `${p.name}(${p.bot || 'human'})`; }
    if (!live) { prevSnap = null; return; }
    lastMatch = m.match;
    const fighters = m.players.filter(p => !p.spectator);
    if (m.match.teams) {
      const n = { ember: 0, frost: 0 };
      for (const p of fighters) if (n[p.team] !== undefined) n[p.team]++;
      teamSizes.samples++;
      if (n.ember !== n.frost) teamSizes.unequal++;
      for (const k of ['ember', 'frost']) { teamSizes.min[k] = Math.min(teamSizes.min[k], n[k]); teamSizes.max[k] = Math.max(teamSizes.max[k], n[k]); }
    }
    if (mode === 'relic' && prevSnap) {
      const gain = (m.match.scores.ember + m.match.scores.frost) - (prevSnap.scores.ember + prevSnap.scores.frost);
      // points accrue only while held: a gain needs a holder now or in the previous snapshot (scores are floored)
      const held = m.match.relic?.holder || prevSnap.relic?.holder;
      if (m.match.relic?.holder) relic.heldSnaps++; else relic.freeSnaps++;
      if (gain > 0 && !held) relic.gainWhileFree += gain;
      if (gain > 0 && held) relic.gainWhileHeld += gain;
    }
    prevSnap = m.match;
  }
});

function finish() {
  const dur = liveAt ? ((Date.now() - liveAt) / 1000).toFixed(0) : '?';
  const fails = [];
  console.log(`\n=== ${mode.toUpperCase()} (${diff} bots) ${ended ? `ended (${ended.reason}) after ${dur}s` : `still running after ${dur}s`} ===`);
  const res = ended || { players: [], scores: lastMatch?.scores, winner: null };
  if (lastMatch?.teams || ended?.scores) console.log('scores', JSON.stringify(ended?.scores || lastMatch?.scores), 'winner', res.winner);
  else console.log('winner', names[res.winner] || res.winner);
  if (ended) console.log('MVP', names[ended.mvp]);
  for (const p of res.players) console.log(`  ${(p.team || '-').padEnd(5)} ${names[p.id]?.padEnd(22)} K ${p.kills} D ${p.deaths} dmg ${p.dmg} pts ${p.pts}`);
  console.log('deaths during the match', kills.total);
  console.log('friendly-fire hits', ff.hits, ff.dmg ? `(${ff.dmg} dmg) ${ff.examples.join('; ')}` : '');
  if (ff.hits) fails.push('friendly fire');
  if (mode !== 'ffa') {
    console.log('team sizes', JSON.stringify(teamSizes));
    if (teamSizes.min.ember < 3 || teamSizes.min.frost < 3 || teamSizes.unequal > teamSizes.samples * 0.02) fails.push('teams not 3v3');
  }
  if (mode === 'relic') {
    console.log('relic: lifts', relic.lifts, 'drops', relic.drops, 'knocked/hit', relic.knocked, 'holder deaths', relic.deaths, 'resets', relic.resets);
    console.log('relic: rotation intervals (s)', JSON.stringify(relic.rotates));
    console.log('relic: snapshots held', relic.heldSnaps, 'free', relic.freeSnaps, '| points gained while held', relic.gainWhileHeld, 'while free', relic.gainWhileFree);
    if (relic.gainWhileFree > 0) fails.push('points while free');
    if (relic.deaths !== relic.resets) fails.push('holder death without reset');
    if (relic.rotates.some(r => Math.abs(r - (flag('--rotate') || 30)) > 1)) fails.push('rotation interval');
  }
  if (!ended) fails.push('no winner within the time');
  console.log(fails.length ? `FAIL: ${fails.join(', ')}` : 'PASS');
  ws.close();
  setTimeout(() => process.exit(fails.length ? 1 : 0), 200);
}
setTimeout(finish, +secs * 1000);
