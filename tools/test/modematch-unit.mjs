// usage: MATCH_DEBUG=1 node tools/test/modematch-unit.mjs
// Rule checks for server/match.js (round 11: a 4-player free-for-all only) against a fake server ctx (no network,
// simulated clock): bot fill to 4, a human replacing a bot, a 5th human spectating until a place opens, first to 10,
// the 8-minute cap, the results and the rematch with no vote, spawns farthest from enemies; plus the loadout rules
// (constants.js sanitizeLoadout, presets, random loadouts, combos).
import { createMatch } from '../../server/match.js';
import * as C from '../../public/shared/constants.js';

let clock = 0, nextId = 1, fails = 0;
const ok = (cond, what) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails++; };
const players = new Map(), props = new Map(), sent = [], notices = [];
C.PROP_SPAWNS.forEach(([type, x, z], i) => props.set(i + 1, { id: i + 1, type, x, z, state: 'idle', carrier: null }));
const ult = new Map();
const ctx = {
  players, props, now: () => clock, broadcast: (m) => sent.push(m), send: (id, m) => notices.push({ id, ...m }),
  propPublic: (p) => ({ ...p }), respawn: (p) => { p.dead = false; const sp = match.spawnPointFor(p); p.p = [sp[0], 0, sp[2]]; },
  addUltCharge: (p, pct) => ult.set(p.id, Math.max(0, Math.min(100, (ult.get(p.id) || 0) + pct))),
  addBot: (difficulty) => { const p = mk(true, difficulty); match.onJoin(p); },
  removePlayer: (id) => { const p = players.get(id); if (p) { match.onLeave(p); players.delete(id); } },
};
function mk(bot, difficulty = 'normal') {
  const id = nextId++;
  const p = { id, name: (bot ? 'B' : 'H') + id, p: [0, 0, 0], yaw: 0, hp: 100, dead: false, kills: 0, deaths: 0, carrying: null,
    loadout: C.botLoadout(), bot: bot ? { difficulty } : undefined };
  players.set(id, p);
  return p;
}
const join = (p) => { match.onJoin(p); return p; };
const match = createMatch(ctx);
const S = match.state();
const run = (secs, dt = 1 / 60) => { for (let i = 0; i < secs / dt; i++) { clock += dt; match.tick(dt); } };
const fighters = () => [...players.values()].filter(p => !p.spectator);
const bots = () => fighters().filter(p => p.bot);

// ---- loadouts
{
  const L = C.DEFAULT_LOADOUT;
  ok(!!C.sanitizeLoadout(L) && C.sameLoadout(C.sanitizeLoadout(L), L), 'the default loadout is valid');
  ok(C.sanitizeLoadout({ ...L, power: 'fireball' }) === null, 'a primary in the power slot is rejected');
  ok(C.sanitizeLoadout({ ...L, guard: 'nope' }) === null, 'an unknown spell is rejected');
  ok(C.sanitizeLoadout({ primary: 'fireball' }) === null, 'a partial loadout is rejected');
  ok(C.sanitizeLoadout('fireball') === null && C.sanitizeLoadout(null) === null && C.sanitizeLoadout([L]) === null, 'non-objects are rejected');
  ok(C.sanitizeLoadout({ ...L, extra: 'x' })?.extra === undefined, 'extra keys are dropped');
  ok(C.PRESETS.length === 6 && C.PRESETS.every(k => C.sanitizeLoadout(k.loadout)), `the 6 hero presets are valid loadouts (${C.PRESETS.map(k => k.name).join(', ')})`);
  let allValid = true;
  const seen = Object.fromEntries(C.LOADOUT_SLOTS.map(s => [s, new Set()]));
  for (let i = 0; i < 2000; i++) { const r = C.randomLoadout(); allValid &&= !!C.sanitizeLoadout(r); for (const s of C.LOADOUT_SLOTS) seen[s].add(r[s]); }
  ok(allValid, 'random loadouts are always valid');
  ok(C.LOADOUT_SLOTS.every(s => seen[s].size === C.SPELL_POOL[s].length), 'random loadouts reach every spell of every slot');
  ok(C.LOADOUT_SLOTS.every(s => C.SPELL_POOL[s].every(id => C.spellInfo(id)?.element && C.ELEMENTS[C.spellInfo(id).element])), 'every pickable spell has card data and an element');
  const lashLo = { ...L, power: 'sanguine_lash', guard: 'black_death' };
  ok(C.hasCombo(lashLo, 'blood_lash') && !C.hasCombo({ ...lashLo, guard: 'ward' }, 'blood_lash'), 'a combo needs both spells equipped');
  ok(C.combosWith('berserker_brew').length === 2 && C.spellInfo('berserker_brew').tags.includes('Combo'), 'Brew carries the Combo tag (two partners)');
  ok(C.dominantElement(C.PRESETS[0].loadout) === 'fire' && C.dominantElement({ ...L, primary: 'spark', guard: 'ward', utility: 'telekinesis', power: 'cyclone', mobility: 'blink', ultimate: 'eye_of_storm' }) === 'wind', 'the dominant element follows the mix (arcane only when nothing else)');
}

// ---- a human arrives: bots fill to 4
const h = mk(false); h.botPref = 'hard'; join(h);
run(0.1);
ok(S.phase === 'warmup' && !S.paused, 'a human unpauses the match: warm-up');
run(2);
ok(fighters().length === 4 && bots().length === 3, `bots fill to 4 (${fighters().length} fighters, ${bots().length} bots)`);
ok(bots().every(p => p.bot.difficulty === 'hard'), 'fill bots use the human\'s difficulty');
ok(fighters().every(p => !p.team), 'no teams');
const [b1, b2] = bots();
ok(match.isEnemy(h, b1) && match.isEnemy(b1, b2) && !match.isEnemy(h, h), 'everyone else is an enemy, never yourself');
run(9);
ok(S.phase === 'live', 'warm-up (10 s) → live');
ok(match.matchPublic().target === 10 && match.matchPublic().mode === 'ffa', 'first to 10, mode ffa');

// ---- a 2nd human takes a bot's place; 3rd and 4th too; a 5th spectates
const h2 = join(mk(false)); run(0.1);
ok(!h2.spectator && fighters().length === 4 && bots().length === 2, 'a 2nd human takes a bot\'s place (still 4)');
const h3 = join(mk(false)), h4 = join(mk(false)); run(0.1);
ok(fighters().length === 4 && bots().length === 0, '4 humans: no bots left');
const h5 = join(mk(false)); run(0.1);
ok(h5.spectator && fighters().length === 4, 'a 5th human spectates');
ok(notices.some(n => n.id === h5.id && /full/.test(n.text)), 'and is told the match is full');
ok(!match.isEnemy(h, h5) && !match.isEnemy(h5, h), 'a spectator can\'t be hurt or hurt anyone');
const sp5 = match.spawnPointFor(h5); ok(Math.hypot(sp5[0], sp5[2]) > 30, 'a spectator is kept off the field');
ctx.removePlayer(h4.id); run(1.5);
ok(!h5.spectator && fighters().length === 4, 'a human leaves: the spectator gets the place');
ctx.removePlayer(h5.id); run(1.5);
ok(fighters().length === 4 && bots().length === 1, 'another leaves: a bot fills the place');
// a bot asked for in a full match replaces a fill bot (not a human)
const before = new Set(players.keys());
ctx.addBot('easy'); run(0.1);
ok(fighters().length === 4 && [h, h2, h3].every(p => players.has(p.id)), 'an extra bot in a full match never takes a human\'s place');

// ---- kills, the target, results, rematch
for (const p of players.values()) { p.kills = 0; p.deaths = 0; }
h.kills = 9; match.onKill(b1, h); ok(S.phase === 'live', '9 kills: still live');
h.kills = 10; h2.kills = 4; match.onKill(h2, h);
ok(S.phase === 'end' && S.results.winner === h.id && S.results.reason === 'target', 'the 10th kill ends the match, the leader wins');
ok(S.results.players[0].id === h.id && S.results.players.length === 4 && S.results.players[0].loadout, 'results list the 4 fighters, best first, with loadouts');
ok(!match.isEnemy(h, h2), 'no fighting on the results screen');
ok(sent.some(m => m.t === 'matchEnd'), 'matchEnd broadcast');
run(8.1);
ok(S.phase === 'warmup' && !sent.some(m => m.t === 'matchMode' || m.t === 'matchVotes'), 'results (8 s) → an immediate rematch (warm-up), no vote');
ok(fighters().every(p => p.kills === 0 && p.deaths === 0), 'the rematch starts from 0');
ok(fighters().every(p => (ult.get(p.id) || 0) === 0), 'ultimate charge reset');
run(10.1); ok(S.phase === 'live', 'rematch goes live');

// ---- the 8-minute cap
ok(Math.abs(S.phaseEnd - clock - 480) < 0.2, 'the live phase lasts 8 minutes');
h.kills = 3; h2.kills = 5; clock = S.phaseEnd - 0.01; run(0.1);
ok(S.phase === 'end' && S.results.reason === 'time' && S.results.winner === h2.id, 'at the cap the most kills wins');
run(8.1); run(10.1);
h.kills = 2; h2.kills = 2; clock = S.phaseEnd - 0.01; run(0.1);
ok(S.phase === 'end' && S.results.winner === null, 'a tie at the cap: no winner');

// ---- spawns: the FFA spawn farthest from every living enemy
{
  const list = match.spawnList();
  ok(list.length >= 4, `at least 4 spawn points (${list.length})`);
  const p = h, enemies = fighters().filter(q => q !== p);
  let good = 0;
  for (let k = 0; k < 30; k++) {
    // enemies stand at random spawns; the pick must be (near) the best by distance to the nearest enemy
    for (const q of enemies) { const s = list[Math.floor(Math.random() * list.length)]; q.p = [s[0], 0, s[2]]; q.dead = false; }
    const near = (sp) => Math.min(...enemies.map(q => Math.hypot(q.p[0] - sp[0], q.p[2] - sp[2])));
    const best = Math.max(...list.map(near)), got = near(match.spawnPointFor(p));
    if (got >= best - 2.01) good++;
  }
  ok(good === 30, `respawn picks the spot farthest from enemies (${good}/30 within the 2 m jitter)`);
  for (const q of enemies) q.dead = true;
  ok(!!match.spawnPointFor(p), 'with every enemy dead it still picks a spawn');
}

// ---- the last human leaves: paused, bots go (server.js does that), the next arrival restarts it
for (const q of [...players.values()].filter(q => !q.bot && q !== h)) ctx.removePlayer(q.id);
ctx.removePlayer(h.id);
ok(S.paused && S.phase === 'warmup', 'the last human leaving pauses the match');
for (const q of [...players.values()]) players.delete(q.id);
const h6 = join(mk(false)); run(2);
ok(!S.paused && S.phase === 'warmup' && fighters().length === 4, 'the next arrival starts a fresh warm-up with 3 bots');
ok(match.canThrow(h6, props.get(1)), 'telekinesis throws normally');
ok(!('vote' in match.matchPublic()) && !('zone' in match.matchPublic()) && !('scores' in match.matchPublic()), 'no vote, zone or team scores in the match state');

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
