// usage: node tools/test/adaptsim.mjs <port> <matches> [auto|easy|normal|hard] [target] [cap]
// Round 26 (spells): the adaptive-difficulty sim. A server with MATCH_DEBUG=1 WA_DEBUG=1. A socket that never joins adds one proxy bot
// (an Easy brain the progression treats as a new human: its rating starts at Easy and moves after each match), which opens a lab room;
// the fill bots play at 'auto' (the proxy's rating) or a fixed difficulty for a baseline. Prints each match's place, kills and deaths
// and the room's skill, then the proxy's 1st-place and podium rates from match 4 on (the target: 30-40% 1st place after the first 3).
import WebSocket from '../../node_modules/ws/wrapper.mjs';
const [port = 4101, n = 9, mode = 'auto', target = 7, cap = 150] = process.argv.slice(2);
const ws = new WebSocket(`ws://localhost:${port}`);
let proxyId = null, skill = null, done = 0;
const rows = [];
ws.on('open', () => {
  ws.send(JSON.stringify({ t: 'addBot', difficulty: 'easy', proxy: true, loadout: 'cinder' }));   // (a new player's kit: the Pyromancer)
  setTimeout(() => ws.send(JSON.stringify({ t: 'matchDebug', target: +target, cap: +cap, ...(mode !== 'auto' ? { botDiff: mode } : {}) })), 300);
});
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.t === 'joined' && proxyId == null) proxyId = m.player.id;
  if (m.t === 'room' && m.room.skill != null) skill = m.room.skill;
  if (m.t === 'matchEnd') {
    const ps = m.results.players, i = ps.findIndex(q => q.id === proxyId), me = ps[i];
    rows.push({ place: i + 1, of: ps.length, kills: me?.kills, deaths: me?.deaths, skill, winner: m.results.winner === proxyId });
    console.log(`match ${rows.length}: place ${i + 1}/${ps.length}, ${me?.kills}-${me?.deaths}, room skill ${skill ?? mode}, ${m.results.reason}`);
    if (++done >= +n) finish();
  }
});
function finish() {
  const after = rows.slice(3);
  const rate = (f) => after.length ? (after.filter(f).length / after.length * 100).toFixed(0) + '%' : 'n/a';
  console.log(`${mode}: from match 4 on (${after.length} matches): 1st place ${rate(r => r.place === 1)} (outright wins ${rate(r => r.winner)}), podium-or-better ${rate(r => r.place <= 3)}, last place ${rate(r => r.place === r.of)}; mean place ${(after.reduce((s, r) => s + r.place, 0) / (after.length || 1)).toFixed(2)}`);
  ws.close(); process.exit(0);
}
