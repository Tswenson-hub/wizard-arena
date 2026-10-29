// usage: node tools/test/modematch.mjs <port> <mode: ffa|tdm|siege> <seconds> [difficulty] [--target N] [--cap S] [--hop S] [--bots N (FFA)]
// Headless game-mode match. The server must run with MATCH_DEBUG=1 (e.g. MATCH_DEBUG=1 PORT=4104 node server.js).
// Joins as a spectator (no team, can't be hurt, bots ignore it), switches to the mode with a 2 s warm-up and
// lets bot fill run the match. Reports scores, team sizes over time, friendly-fire hits (should be 0),
// Altar Siege: bars, hop intervals, contested/empty/held time per zone (the hold split), overtime, and whether a
// bar ever filled while the zone was contested or held by the other team.
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
const siege = { hops: [], lastHop: null, wrongGain: 0, contestedSnaps: 0, snaps: 0, overtime: false };
const kills = { total: 0 };

ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name: 'Observer' })));
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.t === 'welcome') {
    myId = m.id;
    ws.send(JSON.stringify({ t: 'matchDebug', spectate: true, botDiff: diff, warmup: 2, target: flag('--target'), cap: flag('--cap'), hop: flag('--hop'), mode }));
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
  if (m.t === 'matchZone' && live && m.type === 'hop') {
    const now = Date.now();
    siege.hops.push(+((now - (siege.lastHop ?? liveAt)) / 1000).toFixed(1));
    siege.lastHop = now;
  }
  if (m.t === 'matchOvertime' && live) siege.overtime = true;
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
    if (mode === 'siege' && prevSnap && m.match.zone && prevSnap.zone) {
      // a bar may only fill while its own team holds the zone alone (in this snapshot or the last)
      siege.snaps++;
      if (m.match.zone.contested) siege.contestedSnaps++;
      for (const k of ['ember', 'frost']) {
        const gain = m.match.scores[k] - prevSnap.scores[k];
        const ok = [m.match.zone, prevSnap.zone].some(z => z.owner === k && !z.contested);
        // (a hold shorter than a snapshot interval can fall between two snapshots: allow up to two intervals at 1.5%/s)
        if (gain > 0.16 && !ok) siege.wrongGain += gain;
      }
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
  if (mode === 'siege') {
    const sg = ended?.siege;
    const hop = flag('--hop') || 60;
    console.log('siege: hop intervals (s)', JSON.stringify(siege.hops), '| overtime', siege.overtime, sg?.overtime ? JSON.stringify(sg.overtime) : '');
    if (sg) {
      const live = sg.hold.reduce((a, h) => a + h.ember + h.frost, 0) + sg.contested + sg.empty;
      console.log(`siege: held ${(live - sg.contested - sg.empty).toFixed(0)}s, contested ${sg.contested}s (${(sg.contested / live * 100).toFixed(0)}%), empty ${sg.empty}s (${(sg.empty / live * 100).toFixed(0)}%)`);
      for (const h of sg.hold) console.log(`  ${h.name.padEnd(14)} ember ${String(h.ember).padStart(6)}s  frost ${String(h.frost).padStart(6)}s`);
      const sweep = ['ember', 'frost'].find(k => sg.hold.every(h => h[k] + h[k === 'ember' ? 'frost' : 'ember'] < 5 || h[k] > 0.85 * (h.ember + h.frost)));
      if (sweep) console.log(`  note: ${sweep} held 85%+ of every zone`);
    }
    console.log('siege: bar gain while not held alone', siege.wrongGain.toFixed(2));
    if (siege.wrongGain > 0.05) fails.push('bar filled while contested or not held');
    if (siege.hops.some(h => Math.abs(h - hop) > 1.5)) fails.push('hop interval');
  }
  if (!ended) fails.push('no winner within the time');
  console.log(fails.length ? `FAIL: ${fails.join(', ')}` : 'PASS');
  ws.close();
  setTimeout(() => process.exit(fails.length ? 1 : 0), 200);
}
setTimeout(finish, +secs * 1000);
