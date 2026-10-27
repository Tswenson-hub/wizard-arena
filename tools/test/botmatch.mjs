// usage: node tools/test/botmatch.mjs port seconds diffA diffB [diffC...]
// Headless bot match: adds bots without joining, watches broadcasts, prints kills/deaths, hit stats,
// where thrown props landed and goat events. Example: PORT=4101 npm start, then
//   node tools/test/botmatch.mjs 4101 90 hard normal easy
import WebSocket from 'ws';
const [port, secs, ...diffs] = process.argv.slice(2);
const ws = new WebSocket(`ws://localhost:${port}`);
const stats = {}; const names = {};
const S = (id) => stats[id] ??= { casts: {}, hitsDealt: 0, dmg: 0, blocked: 0, hitsTaken: 0, tps: 0, pickups: 0, propHits: 0, shieldSaves: 0 };
const goatEv = { angry: 0, ramKill: 0, ramBlocked: 0, bonk: 0, goatDeaths: {} }; const projOwner = {}; const kinds = {}; const surf = {};
ws.on('open', () => { for (const d of diffs) ws.send(JSON.stringify({ t: 'addBot', difficulty: d })); });
let last, lastGoats;
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.t === 'joined') names[m.player.id] = `${m.player.name}(${m.player.bot})`;
  if (m.t === 'proj') { const s = S(m.owner); s.casts[m.kind] = (s.casts[m.kind] || 0) + 1; projOwner[m.id] = m.owner; kinds[m.id] = m.kind; }
  if (m.t === 'hit') { const a = S(m.attacker); if (m.dmg > 0) { a.hitsDealt++; a.dmg += m.dmg; if (m.kind === 'prop') a.propHits++; } const v = S(m.target); if (m.blocked) v.blocked++; else v.hitsTaken++; }
  if (m.t === 'projEnd' && kinds[m.id] === 'prop') { surf[m.hit ? (m.surface || '?') : 'expired'] = (surf[m.hit ? (m.surface || '?') : 'expired'] || 0) + 1; }
  if (m.t === 'tp') S(m.id).tps++;
  if (m.t === 'prop' && m.prop.state === 'lifting') S(m.prop.carrier).pickups++;
  if (m.t === 'goatAngry') goatEv.angry++;
  if (m.t === 'goatRam') m.blocked ? goatEv.ramBlocked++ : goatEv.ramKill++;
  if (m.t === 'goatBonk') goatEv.bonk++;
  if (m.t === 'death' && m.cause === 'goat') goatEv.goatDeaths[names[m.id]] = (goatEv.goatDeaths[names[m.id]] || 0) + 1;
  if (m.t === 'snap') { last = m.players; lastGoats = m.goats; }
});
setTimeout(() => {
  ws.send(JSON.stringify({ t: 'removeBots' })); console.log('prop surfaces', JSON.stringify(surf)); console.log('goats', JSON.stringify(goatEv), JSON.stringify(lastGoats));
  for (const p of last || []) console.log(names[p.id], 'K', p.kills, 'D', p.deaths, JSON.stringify(stats[p.id]));
  setTimeout(() => process.exit(0), 300);
}, secs * 1000);
