// usage: MATCH_DEBUG=1 node tools/test/modematch-unit.mjs
// Rule checks for server/match.js against a fake server ctx (no network, simulated clock): teams and bot fill,
// no friendly fire, Altar Siege (occupancy, fill rates, contest, ultimate charge, hops and the warning, overtime,
// the win), win conditions, the vote and its tie rule.
import { createMatch } from '../../server/match.js';
import * as C from '../../public/shared/constants.js';

let clock = 0, nextId = 1, fails = 0;
const ok = (cond, what) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails++; };
const players = new Map(), props = new Map(), sent = [];
C.PROP_SPAWNS.forEach(([type, x, z], i) => props.set(i + 1, { id: i + 1, type, x, z, state: 'idle', carrier: null }));
const ult = new Map();
const ctx = {
  players, props, now: () => clock, broadcast: (m) => sent.push(m), send: () => {},
  propPublic: (p) => ({ ...p }), respawn: (p) => { p.dead = false; },
  addUltCharge: (p, pct) => ult.set(p.id, Math.max(0, Math.min(100, (ult.get(p.id) || 0) + pct))),
  addBot: (difficulty) => { const p = mk(true, difficulty); match.onJoin(p); },
  removePlayer: (id) => { const p = players.get(id); if (p) { match.onLeave(p); players.delete(id); } },
};
function mk(bot, difficulty = 'normal') {
  const id = nextId++;
  const p = { id, name: (bot ? 'B' : 'H') + id, p: [0, 0, 0], yaw: 0, hp: 100, dead: false, kills: 0, deaths: 0, carrying: null, bot: bot ? { difficulty } : undefined };
  players.set(id, p);
  return p;
}
const match = createMatch(ctx);
const S = match.state();
const run = (secs, dt = 1 / 60) => { for (let i = 0; i < secs / dt; i++) { clock += dt; match.tick(dt); } };
const team = (t) => [...players.values()].filter(p => p.team === t);

// a human arrives; switch to TDM
const h = mk(false); h.botPref = 'hard'; match.onJoin(h);
run(0.1);
match.handle(h, { t: 'matchDebug', mode: 'tdm', warmup: 2 });
run(2.1);
ok(team('ember').length === 3 && team('frost').length === 3, `TDM fills to 3v3 (${team('ember').length}v${team('frost').length})`);
ok([...players.values()].filter(p => p.bot).every(p => p.bot.difficulty === 'hard'), 'fill bots use the human\'s difficulty');
const mate = team(h.team).find(p => p.bot), foe = team(h.team === 'ember' ? 'frost' : 'ember')[0];
ok(!match.isEnemy(h, mate) && match.isEnemy(h, foe), 'isEnemy: teammate no, opponent yes');
ok(S.phase === 'live', 'warm-up → live');
// a second human joins mid-match: smaller human team, a bot makes way
const h2 = mk(false); match.onJoin(h2); run(2);
ok(h2.team && h2.team !== h.team, 'mid-match joiner goes to the team with fewer humans');
ok(team('ember').length === 3 && team('frost').length === 3, 'still 3v3 after a human joins (a bot left)');
// TDM kill scoring and the target
match.onKill(foe, h); ok(S.scores[h.team] === 1, 'an enemy kill scores for the team');
match.onKill(mate, h); ok(S.scores[h.team] === 1, 'a teamkill (if one ever got through) does not score');
match.onDamage(mate, h, 10); ok(S.stats.ff === 1, 'friendly damage is counted for the harness');
S.target = 2; match.onKill(foe, h); ok(S.phase === 'end' && S.results.winner === h.team, 'reaching the target ends the match');
ok(!match.isEnemy(h, foe), 'no fighting during the end screen');

// the vote: a tie keeps the current mode, a majority switches
run(9); ok(S.phase === 'vote', 'end → vote');
match.handle(h, { t: 'vote', mode: 'ffa' }); match.handle(h2, { t: 'vote', mode: 'siege' });
run(16); ok(S.mode === 'tdm' && S.phase === 'warmup', 'vote tie keeps the current mode');
S.target = null;
match.handle(h, { t: 'matchDebug', skip: true }); run(0.1); match.handle(h, { t: 'matchDebug', skip: true }); run(0.1);
match.handle(h, { t: 'matchDebug', skip: true }); run(0.1);
ok(S.phase === 'vote', 'skip through to the next vote');
match.handle(h, { t: 'vote', mode: 'siege' }); match.handle(h2, { t: 'vote', mode: 'siege' });
match.handle(h, { t: 'matchDebug', skip: true }); run(0.1);
ok(S.mode === 'siege', 'majority picks Altar Siege');
ok(team('ember').length === 3 && team('frost').length === 3, 'siege fills to 3v3');
const Z0 = match.zoneAt(0);
const away = () => { for (const p of players.values()) { p.p = [0, 0, p.team === 'ember' ? 30 : -35]; p.dead = false; } };
const into = (p, zone = match.zoneAt(S.zone.i), dx = 0) => { p.p = [zone.x + dx, 0, zone.z]; };
away(); into(h);
ok(S.phase === 'warmup' && S.zone && S.zone.i === 0 && match.matchPublic().zone?.name === Z0.name, `warm-up shows the first zone (${Z0.name} at ${Z0.x}, ${Z0.z})`);
run(1); ok(S.scores.ember + S.scores.frost === 0, 'nothing fills during the warm-up');
away(); run(1.2); ok(S.phase === 'live', 'siege goes live');
away();
let H = h.team, O = H === 'ember' ? 'frost' : 'ember';
let hmate = team(H).find(p => p.bot), opp = team(O).find(p => p.bot);
const sides = () => { H = h.team; O = H === 'ember' ? 'frost' : 'ember'; opp = team(O).find(p => p.bot); };
run(3); ok(S.scores.ember + S.scores.frost === 0 && !S.zone.owner, 'an empty zone fills nothing');
into(h); ult.set(h.id, 0); run(4);
ok(Math.abs(S.scores[H] - 4) < 0.1 && S.zone.owner === H, `one wizard alone: 1%/s (${S.scores[H].toFixed(2)} in 4 s)`);
ok(Math.abs(ult.get(h.id) - 4) < 0.1, `+1% ultimate/s in your held zone (${ult.get(h.id).toFixed(2)})`);
into(hmate, undefined, 2); run(4);
ok(Math.abs(S.scores[H] - 10) < 0.1, `two inside: 1.5%/s (${S.scores[H].toFixed(2)} after 4 + 4 s)`);
into(opp, undefined, -2); const s1 = S.scores[H]; run(3);
ok(S.zone.contested && S.scores[H] === s1 && S.scores[O] === 0, 'both teams inside: contested, nothing fills');
ok(match.matchPublic().zone.contested && match.matchPublic().zone.inside[O] === 1, 'snapshot: zone contested, inside counts');
opp.dead = true; run(1); ok(!S.zone.contested && S.zone.owner === H, 'a dead wizard doesn\'t hold or contest');
opp.dead = false; opp.p[1] = 6; run(1); ok(!S.zone.contested, 'a wizard high in the air doesn\'t count');
opp.p[1] = 0;
// the hop: warning 5 s before, then the next spot
away(); sent.length = 0;
const hopAt = S.zone.hopAt; clock = hopAt - 5.5; run(1);
ok(sent.some(m => m.t === 'matchZone' && m.type === 'warn') && S.zone.i === 0, 'hop warning 5 s before');
ok(match.matchPublic().zone.next.name === match.zoneAt(1).name, 'snapshot carries the next spot');
run(5); ok(S.zone.i === 1 && sent.some(m => m.t === 'matchZone' && m.type === 'hop'), `the zone hops after 60 s (now ${match.zoneAt(1).name})`);
ok(Math.abs(S.zone.hopAt - clock - 60) < 1, 'and the next hop is 60 s later');
// overtime: the cap hits while contested
into(h); into(opp, undefined, 1); run(0.1);
S.phaseEnd = clock + 0.2; run(1);
ok(S.phase === 'live' && S.overtime, 'cap while contested: overtime, the match goes on');
opp.p = [0, 0, -35]; run(0.2);
ok(S.phase === 'end' && S.results.reason === 'overtime' && S.results.winner === H, 'overtime ends when the zone is no longer contested');
ok(S.results.siege && S.results.siege.hold.length === 3 && S.results.siege.contested > 0, `results carry the per-zone hold split (${JSON.stringify(S.results.siege.hold)})`);
// a hard 30 s on overtime, and the 100% win
match.handle(h, { t: 'matchDebug', mode: 'siege' }); run(2.2); away(); sides();
into(h); into(opp, undefined, 1); S.phaseEnd = clock + 0.1; run(1);
ok(S.overtime, 'overtime again'); run(30);
ok(S.phase === 'end' && S.results.reason === 'overtime', 'overtime stops after 30 s even if still contested');
match.handle(h, { t: 'matchDebug', mode: 'siege' }); run(2.2); away(); sides();
S.scores[H] = 99.5; into(h); run(1);
ok(S.phase === 'end' && S.results.reason === 'target' && S.results.winner === H, 'first to 100% wins');
ok(match.canThrow(h, props.get(1)), 'telekinesis throws normally (no relic special case)');

// FFA: fill bots leave, nobody is a teammate
match.handle(h, { t: 'matchDebug', mode: 'ffa' }); run(2);
ok([...players.values()].filter(p => p.bot).length === 0, 'FFA removes the fill bots');
ok(match.isEnemy(h, h2) && !match.isEnemy(h, h), 'FFA: everyone else is an enemy');
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
