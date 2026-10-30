// usage: node tools/test/loadoutbalance.mjs <port> [runs=10] [seconds=90] [difficulty=hard] [--presets]
// Round 11 balance check: 4 bots with fully random loadouts (C.randomLoadout; --presets mixes in the old hero kits
// the way fill bots pick), many short runs, without joining. Reports, per spell:
//   - kill share: the share of all kills whose killing blow was that spell (hit kind -> spell, below)
//   - equipped: kills and deaths of the bots carrying it, per run it was carried (K/run, D/run, K/D)
// and lists the top and bottom spells by both. A spell "dominates" if its killing-blow share is more than twice
// its fair share in its slot (1 / pool size of the spells actually dealing kills in that slot).
import WebSocket from 'ws';
import * as C from '../../public/shared/constants.js';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const [port, runs = '10', secs = '90', diff = 'hard'] = args;
const presets = process.argv.includes('--presets');

// a hit kind (death.kind) -> the spell id it belongs to, given the killer's loadout
function spellOfKind(kind, lo) {
  const direct = { fast: 'spark', fireball: 'fireball', skim: 'glacial_skim', shear: 'gale_shear', hex: 'hex_shards', sling: 'sling',
    potion: 'potion_toss', potion_splash: 'potion_toss', heavy: 'meteor', cyclone: 'cyclone', lash: 'sanguine_lash', frostfall: 'frostfall',
    toxic: 'toxic_flask', toxic_pool: 'toxic_flask', firewall_burn: 'firewall', bulwark_frost: 'glacial_bulwark', eye_of_storm: 'eye_of_storm',
    eye_burst: 'eye_of_storm', blizzard_chip: 'blizzard', blizzard_freeze: 'blizzard', meteor_rain_hit: 'meteor_rain', ram_shove: 'ram_ride',
    trapped_relic: 'trapped_relic', relic: 'trapped_relic' }[kind];
  if (direct) return direct;
  if (kind === 'prop' || kind === 'goat') return lo?.utility === 'telekinesis' ? 'telekinesis' : `?${kind}`;   // round 12: only Telekinesis lifts and throws
  if (kind === 'ram' || kind === 'battering_ram') {   // a summoned ram: whichever ram spell the killer carries (power first)
    for (const s of ['battering_ram', 'stampede', 'ram_guard', 'sling', 'ram_ride']) if (Object.values(lo || {}).includes(s)) return s;
  }
  return `?${kind}`;
}

const stat = new Map();     // spell -> { runs, k, d, blows }
const st = (id) => { if (!stat.has(id)) stat.set(id, { runs: 0, k: 0, d: 0, blows: 0 }); return stat.get(id); };
const kinds = {};
let totalKills = 0, envDeaths = 0;

function oneRun(i) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const lo = {}, mine = new Set();
    ws.on('open', () => {
      ws.send(JSON.stringify({ t: 'removeBots' }));
      for (let k = 0; k < 4; k++) ws.send(JSON.stringify({ t: 'addBot', difficulty: diff, loadout: presets ? C.botLoadout() : C.randomLoadout() }));
    });
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 'joined' && m.player.bot) { lo[m.player.id] = m.player.loadout; mine.add(m.player.id); }
      if (m.t === 'death' && mine.has(m.id)) {
        const killer = m.killer != null && m.killer !== m.id && mine.has(m.killer) ? m.killer : null;
        for (const s of Object.values(lo[m.id] || {})) st(s).d++;
        if (killer == null) { envDeaths++; kinds[`env:${m.cause || m.kind}`] = (kinds[`env:${m.cause || m.kind}`] || 0) + 1; return; }
        totalKills++;
        kinds[m.kind] = (kinds[m.kind] || 0) + 1;
        for (const s of Object.values(lo[killer] || {})) st(s).k++;
        st(spellOfKind(m.kind, lo[killer])).blows++;
      }
    });
    setTimeout(() => {
      for (const id of mine) for (const s of Object.values(lo[id] || {})) st(s).runs++;
      ws.send(JSON.stringify({ t: 'removeBots' }));
      setTimeout(() => { ws.close(); resolve(); }, 300);
      process.stdout.write(`run ${i + 1}/${runs}: ${totalKills} kills so far\n`);
    }, +secs * 1000);
  });
}

for (let i = 0; i < +runs; i++) await oneRun(i);

const slotOf = (id) => C.SPELLBOOK[id]?.slot || '?';
const rows = [...stat].map(([id, s]) => ({ id, slot: slotOf(id), runs: s.runs, kpr: s.runs ? s.k / s.runs : 0, dpr: s.runs ? s.d / s.runs : 0,
  kd: s.d ? s.k / s.d : s.k, share: totalKills ? s.blows / totalKills : 0, blows: s.blows }));
const pct = (v) => `${(v * 100).toFixed(1)}%`;
console.log(`\n${runs} runs × ${secs}s, 4 ${diff} bots (${presets ? 'presets + random' : 'fully random'} loadouts): ${totalKills} kills, ${envDeaths} other deaths`);
console.log('killing blows by hit kind', JSON.stringify(Object.fromEntries(Object.entries(kinds).sort((a, b) => b[1] - a[1]))));
for (const slot of C.LOADOUT_SLOTS) {
  console.log(`\n${slot.toUpperCase()}`);
  console.log('  spell              runs  K/run  D/run   K/D   killing blows (share)');
  for (const r of rows.filter(r => r.slot === slot).sort((a, b) => b.share - a.share || b.kpr - a.kpr)) {
    console.log(`  ${r.id.padEnd(18)} ${String(r.runs).padStart(4)}  ${r.kpr.toFixed(2).padStart(5)}  ${r.dpr.toFixed(2).padStart(5)}  ${r.kd.toFixed(2).padStart(5)}   ${String(r.blows).padStart(3)} (${pct(r.share)})`);
  }
}
const unknown = rows.filter(r => r.id.startsWith('?'));
if (unknown.length) console.log('\nunmapped kinds', unknown.map(r => `${r.id} ${r.blows}`).join(', '));
const ranked = rows.filter(r => !r.id.startsWith('?') && r.runs >= 3).sort((a, b) => b.share - a.share);
console.log('\nTOP by kill share:   ', ranked.slice(0, 5).map(r => `${r.id} ${pct(r.share)}`).join(', '));
console.log('BOTTOM by kill share:', ranked.slice(-5).reverse().map(r => `${r.id} ${pct(r.share)}`).join(', '));
const byKd = rows.filter(r => !r.id.startsWith('?') && r.runs >= 3).sort((a, b) => b.kd - a.kd);
console.log('TOP by equipped K/D: ', byKd.slice(0, 5).map(r => `${r.id} ${r.kd.toFixed(2)}`).join(', '));
console.log('BOTTOM by equipped K/D:', byKd.slice(-5).reverse().map(r => `${r.id} ${r.kd.toFixed(2)}`).join(', '));
// dominance: within a slot, a killing-blow share more than twice the slot's even split
for (const slot of C.LOADOUT_SLOTS) {
  const inSlot = rows.filter(r => r.slot === slot && r.blows > 0), sum = inSlot.reduce((a, r) => a + r.blows, 0);
  if (!sum) continue;
  const fair = 1 / C.SPELL_POOL[slot].length;
  for (const r of inSlot) if (r.blows / sum > 2 * fair && r.blows >= 5) console.log(`DOMINANT in ${slot}: ${r.id} has ${pct(r.blows / sum)} of the slot's killing blows (even split ${pct(fair)})`);
}
process.exit(0);
