// usage: node tools/test/modematch.mjs <port> <seconds> [difficulty] [--target N] [--cap S] [--rematch]
// Headless free-for-all (round 11: the only mode). The server must run with MATCH_DEBUG=1
// (e.g. MATCH_DEBUG=1 PORT=4101 node server.js). Joins as a spectator (can't be hurt, bots ignore it), so bot fill
// plays the match with 4 bots at <difficulty>. Reports the result with each bot's loadout, checks that the match
// stays at 4 fighters, that nobody hurts themselves (self-hits) or anyone during the results screen, that it ends
// at the target or the cap, and with --rematch that the next match's warm-up follows on its own (no vote).
// Exits with code 1 if a check fails.
import WebSocket from 'ws';

const args = process.argv.slice(2);
const flag = (k) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : undefined; };
const [port, secs = '480', diff = 'normal'] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--rematch'));
const wantRematch = args.includes('--rematch');
const ws = new WebSocket(`ws://localhost:${port}`);
const names = {}, loadouts = {};
let phase = null, liveAt = 0, ended = null, rematch = false;
const sizes = { min: 99, max: 0 };
const bad = { endHits: 0 };
let deaths = 0;

ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name: 'Observer', difficulty: diff })));
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.t === 'welcome') {
    ws.send(JSON.stringify({ t: 'matchDebug', spectate: true, botDiff: diff, warmup: 2, endTime: 3, target: flag('--target'), cap: flag('--cap') }));
    return;
  }
  if (m.t === 'joined') names[m.player.id] = `${m.player.name}(${m.player.bot || 'human'})`;
  if (m.t === 'matchPhase') {
    const was = phase;
    phase = m.match.phase;
    if (phase === 'live' && was !== 'live' && !ended) { liveAt = Date.now(); console.log(`[ffa] live: first to ${m.match.target}`); }
    if (phase === 'warmup' && ended) { rematch = true; finish(); }
  }
  if (m.t === 'matchEnd' && !ended) { ended = m.results; if (!wantRematch) finish(); }
  if (m.t === 'death' && phase === 'live') deaths++;
  if (m.t === 'hit' && phase === 'end' && m.dmg > 0) bad.endHits++;
  if (m.t === 'snap') {
    for (const p of m.players) { names[p.id] ??= `${p.name}(${p.bot || 'human'})`; if (p.loadout) loadouts[p.id] = p.loadout; }
    if (phase === 'live' && !ended) {
      const n = m.players.filter(p => !p.spectator).length;
      sizes.min = Math.min(sizes.min, n); sizes.max = Math.max(sizes.max, n);
    }
  }
});

function finish() {
  const dur = liveAt ? ((Date.now() - liveAt) / 1000).toFixed(0) : '?';
  const fails = [];
  console.log(`\n=== FFA (${diff} bots) ${ended ? `ended (${ended.reason}) after ${dur}s` : `still running after ${dur}s`} ===`);
  if (ended) {
    console.log('winner', names[ended.winner] || 'none (a tie)', '| MVP', names[ended.mvp]);
    for (const p of ended.players) {
      const lo = p.loadout || loadouts[p.id] || {};
      console.log(`  ${names[p.id]?.padEnd(18)} K ${String(p.kills).padStart(2)} D ${String(p.deaths).padStart(2)} dmg ${String(p.dmg).padStart(4)}  ${['primary', 'power', 'guard', 'mobility', 'utility', 'ultimate'].map(s => lo[s]).join(' ')}`);
    }
  }
  console.log('deaths during the match', deaths, '| fighters min/max', sizes.min, sizes.max, '| hits on the results screen', bad.endHits);
  if (sizes.min !== 4 || sizes.max !== 4) fails.push('not 4 fighters');
  if (bad.endHits) fails.push('damage on the results screen');
  if (!ended) fails.push('no result within the time');
  else if (ended.reason === 'target' && !ended.players.some(p => p.kills >= (flag('--target') ?? 10))) fails.push('ended at the target without anyone reaching it');
  if (wantRematch) { console.log('rematch warm-up followed', rematch); if (!rematch) fails.push('no rematch'); }
  console.log(fails.length ? `FAIL: ${fails.join(', ')}` : 'PASS');
  ws.close();
  setTimeout(() => process.exit(fails.length ? 1 : 0), 200);
}
setTimeout(finish, +secs * 1000);
