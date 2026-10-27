// usage: node tools/test/spellmatch.mjs port secs diff[:power/mobility] ...
// Bot match that pins loadouts and counts spellbook use (cyclone pulses/cancels, flashes, hits taken airborne).
// Example: node tools/test/spellmatch.mjs 4101 120 hard:cyclone/skyward hard:meteor/blink normal
import WebSocket from 'ws';
const [port, secs, ...specs] = process.argv.slice(2);
const ws = new WebSocket(`ws://localhost:${port}`);
const S = {}; const names = {}; const st = (id) => S[id] ??= { dmg: 0, hits: 0, cyc: 0, cycHits: 0, cycDmg: 0, cycBlocked: 0, cycCancel: 0, sky: 0, tp: 0, airHitsTaken: 0, meteor: 0, goatDeaths: 0 };
let last = [];
const pos = {};
ws.on('open', () => { for (const sp of specs) { const [d, lo] = sp.split(':'); const [power, mobility] = (lo || '').split('/'); ws.send(JSON.stringify({ t: 'addBot', difficulty: d, loadout: lo ? { power, mobility } : undefined })); } });
ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.t === 'joined') names[m.player.id] = `${m.player.name}(${m.player.bot} ${m.player.loadout.power}/${m.player.loadout.mobility})`;
  if (m.t === 'hit' && m.dmg > 0) { st(m.attacker).dmg += m.dmg; st(m.attacker).hits++; if ((pos[m.target]?.[1] || 0) > 0.5) st(m.target).airHitsTaken++; }
  if (m.t === 'cyclonePulse') { const s = st(m.id); s.cyc++; for (const h of m.hits) { if (h.blocked) s.cycBlocked++; else { s.cycHits++; s.cycDmg += h.dmg; } } }
  if (m.t === 'cycloneCancel') st(m.id).cycCancel++;
  if (m.t === 'skyward') st(m.id).sky++;
  if (m.t === 'tp') st(m.id).tp++;
  if (m.t === 'proj' && m.kind === 'heavy') st(m.owner).meteor++;
  if (m.t === 'death' && m.cause === 'goat') st(m.id).goatDeaths++;
  if (m.t === 'snap') { last = m.players; for (const p of m.players) pos[p.id] = p.p; }
});
setTimeout(() => {
  ws.send(JSON.stringify({ t: 'removeBots' }));
  for (const p of last) console.log(names[p.id].padEnd(36), 'K', p.kills, 'D', p.deaths, JSON.stringify(S[p.id] || {}));
  setTimeout(() => process.exit(0), 300);
}, secs * 1000);
