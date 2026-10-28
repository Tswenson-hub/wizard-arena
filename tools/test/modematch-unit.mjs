// usage: MATCH_DEBUG=1 node tools/test/modematch-unit.mjs
// Rule checks for server/match.js against a fake server ctx (no network, simulated clock): teams and bot fill,
// no friendly fire, the relic (scoring only while held, can't be thrown, reset on holder death, rotation,
// knocked loose), win conditions, the vote and its tie rule.
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
match.handle(h, { t: 'vote', mode: 'ffa' }); match.handle(h2, { t: 'vote', mode: 'relic' });
run(16); ok(S.mode === 'tdm' && S.phase === 'warmup', 'vote tie keeps the current mode');
S.target = null;
match.handle(h, { t: 'matchDebug', skip: true }); run(0.1); match.handle(h, { t: 'matchDebug', skip: true }); run(0.1);
match.handle(h, { t: 'matchDebug', skip: true }); run(0.1);
ok(S.phase === 'vote', 'skip through to the next vote');
match.handle(h, { t: 'vote', mode: 'relic' }); match.handle(h2, { t: 'vote', mode: 'relic' });
match.handle(h, { t: 'matchDebug', skip: true }); run(0.1);
ok(S.mode === 'relic', 'majority picks Sacred Relic');
run(2.5);
ok(S.phase === 'live' && S.relic && S.relic.propId, `relic spawned on prop ${S.relic?.propId} (${props.get(S.relic?.propId)?.type})`);
ok(['crate', 'barrel', 'pot', 'hay', 'potion'].includes(props.get(S.relic.propId).type), 'relic is an eligible prop type');

// free relic: no points
const before = S.scores.ember + S.scores.frost; run(3);
ok(S.scores.ember + S.scores.frost === before, 'no points while the relic is free');
// lift it (as server.js does)
const lift = (p) => { const pr = props.get(S.relic.propId); pr.state = 'carried'; pr.carrier = p.id; p.carrying = pr.id; match.onPickup(p, pr); return pr; };
let pr = lift(h); ult.set(h.id, 0);
const s0 = S.scores[h.team]; run(4);
ok(Math.abs(S.scores[h.team] - s0 - 20) < 0.5, `+5/s while held (${(S.scores[h.team] - s0).toFixed(1)} in 4 s)`);
ok(Math.abs(ult.get(h.id) - 8) < 0.3, `+2% ult/s while held (${ult.get(h.id).toFixed(1)}% in 4 s)`);
ok(!match.canThrow(h, pr) && match.canThrow(h, props.get(pr.id === 1 ? 2 : 1)), 'the relic can\'t be thrown, other props can');
// knocked loose (server.js shatters a held prop that's hit): stays the relic, set down
const id0 = pr.id;
match.onPropBroken(pr); h.carrying = null; pr.state = 'broken'; pr.carrier = null; run(0.1);
ok(S.relic.propId === id0 && pr.state === 'idle', 'a hit knocks the relic loose; it stays the relic, idle');
// holder dies: reset to a new prop, timer restarts
pr = lift(h); const rot = S.relic.rotateAt;
run(5);
match.onDrop(h, pr, 'destroyed');
ok(S.relic.propId !== id0 && Math.abs(S.relic.rotateAt - clock - 30) < 0.1, 'holder death: a new relic and a fresh 30 s');
// rotation after 30 s, even while held
pr = lift(h); const id1 = pr.id;
run(30.2);
ok(S.relic.propId !== id1, 'the relic moves after 30 s even while held');
ok(match.canThrow(h, pr), 'the old relic is an ordinary prop again (throwable)');

// FFA: fill bots leave, nobody is a teammate
match.handle(h, { t: 'matchDebug', mode: 'ffa' }); run(2);
ok([...players.values()].filter(p => p.bot).length === 0, 'FFA removes the fill bots');
ok(match.isEnemy(h, h2) && !match.isEnemy(h, h), 'FFA: everyone else is an enemy');
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
