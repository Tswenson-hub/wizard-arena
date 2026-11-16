// usage: MATCH_DEBUG=1 node tools/test/modematch-unit.mjs
// Rule checks for server/match.js (round 11: a 4-player free-for-all only) against a fake server ctx (no network,
// simulated clock): bot fill to 4, a human replacing a bot, a 5th human spectating until a place opens, first to 10,
// the 7-minute cap, the results and the rematch with no vote, spawns farthest from enemies; plus the loadout rules
// (constants.js sanitizeLoadout, presets, random loadouts, combos). Round 12 adds checks against the real server on port 4191
// (WA_DEBUG debugPlace/debugProp): only Telekinesis lifts, Trapped Relic traps (triggers, 2 per caster, glyphs), Roll. Round 13 adds
// the air jump, coyote time, casting on the move and in the air, the hover, and sprint-jump momentum in the speed budget.
// (match.js reads MATCH_DEBUG when it loads: set it before the import, so a plain `node tools/test/modematch-unit.mjs` runs the debug checks too)
process.env.MATCH_DEBUG ??= '1';
const { createMatch } = await import('../../server/match.js');
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
  // round 22: the map rotation (the room's maps, and the switches the match asks for)
  maps: () => ['courtyard', 'sky'], setMap: (id) => mapSwitches.push(id),
};
const mapSwitches = [];
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
  ok(C.LOADOUT_SLOTS.every(s => seen[s].size === C.LEGACY_POOL[s].length), 'random loadouts (the older rooms\' rules) reach every spell of every slot');
  ok(C.LOADOUT_SLOTS.every(s => C.SPELL_POOL[s].every(id => C.spellInfo(id)?.element && C.ELEMENTS[C.spellInfo(id).element])), 'every pickable spell has card data and an element');
  const lashLo = { ...L, power: 'sanguine_lash', guard: 'black_death' };
  ok(C.hasCombo(lashLo, 'blood_lash') && !C.hasCombo({ ...lashLo, guard: 'ward' }, 'blood_lash'), 'a combo needs both spells equipped');
  // round 13: Roll is a Utility (F) now; an old loadout with it in mobility moves it to a free utility slot, else drops it
  // (round 27: Roll is retired; these are the older rooms' rules, LEGACY_POOL)
  ok(C.RETIRED_SPELLS.roll.slot === 'utility' && C.LEGACY_POOL.utility.includes('roll') && !C.LEGACY_POOL.mobility.includes('roll') && C.LEGACY_POOL.mobility.length === 6,
    `Roll is in the older rooms' Utility pool, Mobility has its other 6 (${C.LEGACY_POOL.utility.join(', ')})`);
  const old = C.sanitizeLoadout({ ...L, mobility: 'roll' });
  ok(old && old.mobility === L.mobility && old.utility === L.utility, 'an old loadout with Roll in mobility gets the default mobility (its utility kept)');
  const oldFree = C.sanitizeLoadout({ ...L, mobility: 'roll', utility: undefined });
  ok(oldFree && oldFree.utility === 'roll' && oldFree.mobility === L.mobility, 'and keeps Roll in utility when that slot is free');
  ok(C.sanitizeLoadout({ ...L, utility: 'roll' })?.utility === 'roll' && C.sanitizeLoadout({ ...L, mobility: 'blink', utility: 'roll' }) !== null, 'Roll in utility is valid');
  ok(C.combosWith('frostfall').length === 1 && C.spellInfo('frostfall').tags.includes('Combo'), 'Frostfall carries the Combo tag (Skyward)');
  ok(!C.combosWith('berserker_brew').length && !C.spellInfo('berserker_brew').tags.includes('Combo'), 'Brew has no combo (its ×1.5 is on every spell)');
  ok(C.dominantElement(C.PRESETS[0].loadout) === 'fire' && C.dominantElement({ ...L, primary: 'spark', guard: 'ward', utility: 'telekinesis', power: 'cyclone', mobility: 'blink', ultimate: 'eye_of_storm' }) === 'wind', 'the dominant element follows the mix (arcane only when nothing else)');
}

// ---- round 16: Meteor Rain's aim sway (C.meteorSway): deterministic per seed, about 1.5-2 m at the default aim distance
{
  const S = C.SPELLBOOK.meteor_rain.sway;
  let peak = 0, same = true, diff = false;
  for (let t = 0; t < 4; t += 0.05) {
    const a = C.meteorSway(42, t, S.ref), b = C.meteorSway(42, t, S.ref), c = C.meteorSway(7, t, S.ref);
    peak = Math.max(peak, Math.hypot(a[0], a[1]));
    if (a[0] !== b[0] || a[1] !== b[1]) same = false;
    if (Math.hypot(a[0] - c[0], a[1] - c[1]) > 0.3) diff = true;
  }
  ok(same && diff && peak > 1.2 && peak < 2.6, `Meteor Rain's sway is the same path for the same seed, another for another, up to ${peak.toFixed(2)} m`);
}

// ---- a human arrives: bots fill to 4
const h = mk(false); h.botPref = 'hard'; join(h);
run(0.1);
ok(S.phase === 'countdown' && !S.paused && Math.abs(S.phaseEnd - clock - 3) < 0.15, 'a human unpauses the match: a 3 s countdown (no warm-up)');
run(2);
ok(fighters().length === 4 && bots().length === 3, `bots fill to 4 (${fighters().length} fighters, ${bots().length} bots)`);
ok(bots().every(p => p.bot.difficulty === 'hard'), 'fill bots use the human\'s difficulty');
ok(fighters().every(p => !p.team), 'no teams');
const [b1, b2] = bots();
ok(match.isEnemy(h, b1) && match.isEnemy(b1, b2) && !match.isEnemy(h, h), 'everyone else is an enemy, never yourself');
run(1);
ok(S.phase === 'live', 'the countdown (3 s) → live');
ok(match.matchPublic().target === 10 && match.matchPublic().mode === 'ffa', 'first to 10 (round 22), mode ffa');
ok(match.matchPublic().map?.id === 'courtyard' && match.matchPublic().next === null && mapSwitches.length === 0, `a room's first match is on the courtyard, no switch (${JSON.stringify(match.matchPublic().map)})`);

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
// round 16: the match stats behind the recap (live only; overkill doesn't count; assists within 10 s; natural regen never reaches onHeal)
{
  const [a, b, c] = [h, h2, h3];
  a.p = [0, 0, 0]; b.p = [20, 0, 0]; c.p = [0, 0, 5];
  b.hp = 90; match.onDamage(b, c, 10, null);
  b.hp = 60; match.onDamage(b, a, 30, [0, 1.3, 0]);   // a projectile from 20 m
  b.hp = -20; match.onDamage(b, a, 80, null);         // 80, of which 60 was left
  match.onKill(b, a);
  match.onHeal(c, 25, 'siphon'); match.onPotion(c); match.onPotion(c);
  match.onAirJump(b); match.onAirJump(b); match.onAirJump(b); match.onTrap(a);
  ok(a.mDmg === 90 && c.mDmg === 10 && b.ms.dmgTaken === 100, `damage dealt and taken, without the overkill (${a.mDmg}, ${c.mDmg}; taken ${b.ms.dmgTaken})`);
  ok(a.ms.biggest === 80 && Math.round(a.ms.longest) === 20, `the biggest hit (${a.ms.biggest}) and the longest (${a.ms.longest.toFixed(1)} m, from the shot's launch point)`);
  ok(c.ms.assists === 1 && a.ms.assists === 0, 'damage before someone else\'s kill is an assist (not for the killer)');
  ok(c.ms.healed === 25 && c.ms.potions === 2 && b.ms.airJumps === 3 && a.ms.traps === 1, 'healing, potions, double jumps and traps sprung count');
  b.hp = 100;
}
h.kills = 9; match.onKill(b1, h); ok(S.phase === 'live', '9 kills: still live');
h.kills = 10; h2.kills = 4; match.onKill(h2, h);
ok(S.phase === 'end' && S.results.winner === h.id && S.results.reason === 'target', 'the 10th kill ends the match, the leader wins');
ok(match.matchPublic().next?.id === 'sky' && match.matchPublic().next.name === 'Sky Ruins', `from the end of the match, next = Sky Ruins (${JSON.stringify(match.matchPublic().next)})`);
ok(S.results.players[0].id === h.id && S.results.players.length === 4 && S.results.players[0].loadout, 'results list the 4 fighters, best first, with loadouts');
ok(!match.isEnemy(h, h2), 'no fighting on the results screen');
ok(sent.some(m => m.t === 'matchEnd'), 'matchEnd broadcast');
// round 16: a 1.5 s gap, then the 10 s recap (the podium and accolades), then the rematch
run(1.4); ok(S.phase === 'end' && !sent.some(m => m.t === 'recap'), 'a 1.5 s gap after the last kill');
run(0.2);
const recap = sent.filter(m => m.t === 'recap').pop();
ok(S.phase === 'recap' && !!recap && recap.duration === 10 && Math.abs(S.phaseEnd - clock - 10) < 0.1, 'then the recap: broadcast, 10 s');
ok(recap?.podium.length === 3 && recap.podium.map(p => p.id).join() === [h, h2, h3].map(p => p.id).join() && recap.podium.every((p, i) => p.place === i + 1 && p.body && p.loadout && p.colors)
  && recap.everyone.length === 1 && recap.everyone[0].place === 4, `a podium of 3 by kills, deaths, damage (${recap?.podium.map(p => p.name).join(', ')}), a row for 4th`);
const accs = recap?.podium.flatMap(p => p.accolades.map(a => a.id)) || [];
ok(accs.length === new Set(accs).size && recap.podium.every(p => p.accolades.length >= 1 && p.accolades.length <= 2), `each on the podium has 1–2 accolades, none repeated (${recap?.podium.map(p => p.accolades.map(a => `${a.label}: ${a.value}`).join(' + ')).join(' | ')})`);
ok(recap?.podium[0].accolades[0].id === 'kills' && recap.podium[0].accolades[0].value === '10 kills', 'the winner is Most Kills, with the value');
ok(recap?.next?.id === 'sky', 'the recap message carries the next map (the podium\'s "Next map: Sky Ruins")');
ok(!match.isEnemy(h, h2), 'no fighting during the recap');
run(9.95);   // (to 0.05 s past the recap's 11.5 s, so the 7-minute check below starts on time)
ok(S.phase === 'countdown' && !sent.some(m => m.t === 'matchMode' || m.t === 'matchVotes'), 'after the recap: an immediate rematch (the 3 s countdown), no vote');
ok(fighters().every(p => p.kills === 0 && p.deaths === 0), 'the rematch starts from 0');
ok(fighters().every(p => (ult.get(p.id) || 0) === 0), 'ultimate charge reset');
ok(mapSwitches.join() === 'sky' && match.matchPublic().map.id === 'sky' && match.matchPublic().next === null, `the rematch's countdown switched the room to Sky Ruins (${mapSwitches.join()})`);
run(3.1); ok(S.phase === 'live', 'rematch goes live after the 3 s countdown');

// ---- the 5-minute cap (round 22; was 7)
ok(Math.abs(S.phaseEnd - clock - 300) < 0.2, 'the live phase lasts 5 minutes');
h.kills = 3; h2.kills = 5; clock = S.phaseEnd - 0.01; run(0.1);
ok(S.phase === 'end' && S.results.reason === 'time' && S.results.winner === h2.id, 'at the cap the most kills wins');
run(1.6); run(10.1); run(3.1);
h.kills = 2; h2.kills = 2; clock = S.phaseEnd - 0.01; run(0.1);
ok(S.phase === 'end' && S.results.winner === null, 'a tie at the cap: no winner');
ok(mapSwitches.join() === 'sky,courtyard' && match.matchPublic().map.id === 'courtyard' && match.matchPublic().next?.id === 'sky', `the rotation alternates: courtyard, sky, courtyard (${mapSwitches.join()}); next sky again`);

// ---- round 22: the host's lock and a test's pick
{
  run(1.6); run(10.1);   // the gap, the recap: into the next countdown (sky)
  ok(S.phase === 'countdown' && match.matchPublic().map.id === 'sky', 'the next countdown is on Sky Ruins');
  ok(match.setMapLock('courtyard') && mapSwitches.at(-1) === 'courtyard' && S.phase === 'countdown' && match.matchPublic().map.id === 'courtyard' && match.mapLock() === 'courtyard',
    'a lock on the courtyard during the countdown restarts it on the courtyard at once');
  run(3.1); ok(S.phase === 'live', 'live again');
  const n0 = mapSwitches.length;
  ok(match.setMapLock('sky') && mapSwitches.length === n0 + 1 && S.phase === 'countdown' && match.matchPublic().map.id === 'sky', 'a lock while live with no kills yet restarts on the new map');
  run(3.1); h.kills = 1; match.onKill(h2, h);
  ok(match.setMapLock('courtyard') && mapSwitches.length === n0 + 1 && S.phase === 'live' && match.matchPublic().map.id === 'sky', 'a lock after the first kill waits for the next match');
  h.kills = 10; match.onKill(h2, h);
  ok(match.matchPublic().next?.id === 'courtyard', 'next is the locked map');
  ok(match.setMapLock('rotate') && match.mapLock() === null && match.matchPublic().next?.id === 'courtyard', "'rotate' lifts the lock: next is the courtyard (the rotation)");
  ok(!match.setMapLock('moon'), 'an unknown map is refused');
  run(1.6); run(10.1);
  ok(S.phase === 'countdown' && match.matchPublic().map.id === 'courtyard', 'the rematch rotated to the courtyard');
  match.handle(h, { t: 'matchDebug', map: 'sky' });
  ok(S.phase === 'countdown' && match.matchPublic().map.id === 'sky', 'matchDebug.map during the countdown restarts on that map');
  run(3.1); h.kills = 10; match.onKill(h2, h); run(1.6); run(10.1);
  ok(S.phase === 'countdown' && match.matchPublic().map.id === 'courtyard', 'the rotation carries on from the pick');
  match.handle(h, { t: 'matchDebug', map: 'courtyard' }); run(3.1);
}

// ---- spawns (round 14): the farthest spawn in C.SPAWN_CHOICE's band from the nearest enemy, else the 2nd-farthest overall
{
  const list = match.spawnList();
  ok(list.length >= 4, `at least 4 spawn points (${list.length})`);
  const p = h, enemies = fighters().filter(q => q !== p);
  let good = 0;
  for (let k = 0; k < 30; k++) {
    // enemies stand at random spawns; the pick must be (near) the best by distance to the nearest enemy
    for (const q of enemies) { const s = list[Math.floor(Math.random() * list.length)]; q.p = [s[0], 0, s[2]]; q.dead = false; }
    const near = (sp) => Math.min(...enemies.map(q => Math.hypot(q.p[0] - sp[0], q.p[2] - sp[2])));
    const ds = list.map(near).sort((a, b) => b - a), band = ds.filter(d => d >= C.SPAWN_CHOICE.min && d <= C.SPAWN_CHOICE.max);
    const want = band.length ? band[0] : ds[1], got = near(match.spawnPointFor(p));
    // (the 2 m jitter can swap two spots within 2 m of each other)
    if (band.length ? got >= C.SPAWN_CHOICE.min && got <= C.SPAWN_CHOICE.max && got >= want - 2.01 : Math.abs(got - want) <= 2.01) good++;
  }
  ok(good === 30, `respawn picks the farthest spot in the ${C.SPAWN_CHOICE.min}–${C.SPAWN_CHOICE.max} m band, else the 2nd-farthest (${good}/30)`);
  for (const q of enemies) q.dead = true;
  ok(!!match.spawnPointFor(p), 'with every enemy dead it still picks a spawn');
}

// ---- the last human leaves: paused, bots go (server.js does that), the next arrival restarts it
for (const q of [...players.values()].filter(q => !q.bot && q !== h)) ctx.removePlayer(q.id);
ctx.removePlayer(h.id);
ok(S.paused && S.phase === 'countdown', 'the last human leaving pauses the match');
for (const q of [...players.values()]) players.delete(q.id);
const h6 = join(mk(false)); run(2);
ok(!S.paused && S.phase === 'countdown' && fighters().length === 4, 'the next arrival starts a fresh countdown with 3 bots');
ok(match.matchPublic().map.id === 'courtyard', 'an emptied room starts again on the courtyard');
ok(match.canThrow(h6, props.get(1)), 'telekinesis throws normally');
ok(!('vote' in match.matchPublic()) && !('zone' in match.matchPublic()) && !('scores' in match.matchPublic()), 'no vote, zone or team scores in the match state');

// ---- round 12, against the real server (WA_DEBUG + MATCH_DEBUG, on a private port): only Telekinesis lifts, Trapped Relic
// is traps only (2 per caster; an enemy close by, lifting it or breaking it sets it off), and Roll's charges and dodge window
// ---- round 24: the drawbridge's cycle, angle, moving surface and slide (constants.js), and the hop planner
{
  const D = C.DRAWBRIDGE, deg = (a) => a * 180 / Math.PI;
  D.t0 = 0;
  ok(D.cycle === 28 && D.down === 12 && D.rising === 4 && D.up === 8 && D.lowering === 4, 'the drawbridge cycle is Down 12, Rising 4, Up 8, Lowering 4 (28 s)');
  ok(C.drawbridgePhase(0).phase === 'down' && C.drawbridgePhase(11.99).phase === 'down' && C.drawbridgePhase(12).phase === 'rising' && C.drawbridgePhase(16).phase === 'up'
    && C.drawbridgePhase(23.99).phase === 'up' && C.drawbridgePhase(24).phase === 'lowering' && C.drawbridgePhase(28).phase === 'down' && C.drawbridgePhase(-1).phase === 'lowering', 'the phases at their boundaries, and the cycle wraps both ways');
  ok(C.drawbridgeAngle(5) === 0 && Math.abs(deg(C.drawbridgeAngle(14)) - 40) < 0.01 && Math.abs(deg(C.drawbridgeAngle(16)) - 80) < 0.01 && Math.abs(deg(C.drawbridgeAngle(20)) - 80) < 0.01
    && Math.abs(deg(C.drawbridgeAngle(26)) - 40) < 0.01 && C.drawbridgeAngle(28.5) === 0, 'the angle: flat down, 80° up, halfway through a rise or a fall at its middle');
  let mono = true;
  for (let t = 12; t < 16; t += 0.05) if (C.drawbridgeAngle(t + 0.05) < C.drawbridgeAngle(t)) mono = false;
  for (let t = 24; t < 28; t += 0.05) if (C.drawbridgeAngle(t + 0.05) > C.drawbridgeAngle(t)) mono = false;
  ok(mono, 'the rise only rises and the fall only falls');
  const W5 = C.drawbridgeWindow(5), W20 = C.drawbridgeWindow(20);
  ok(W5.phase === 'down' && Math.abs(W5.downFor - 7) < 1e-9 && W5.downIn === 0 && W20.phase === 'up' && W20.downFor === 0 && Math.abs(W20.downIn - 8) < 1e-9, 'the window: down for 7 more s at 5 s; down again in 8 s at 20 s');
  ok(C.drawbridgeSlide(0) === 0 && C.drawbridgeSlide(D.slideFrom) === 0 && C.drawbridgeSlide(20 * Math.PI / 180) > 1 && Math.abs(C.drawbridgeSlide(D.fallAngle) - D.slideMax) < 1e-9 && C.drawbridgeSlide(D.upAngle) === D.slideMax, 'the slide: nothing until 10°, 5 m/s from 45°');
  // the moving surface on Sky Ruins (a test drawbridge at environment's posted hinge: (16, 6, 0) along +x, a 7.2 × 3.4 slab)
  const had = C.ACTIVE_MAP.name;
  if (C.setActiveMap('sky')) {
    C.setDrawbridges([{ id: 'db-unit', x: 16, y: 6, z: 0, dir: [1, 0], w: 3.4, d: 7.2 }]);
    C.updateDrawbridges(0);
    const S0 = C.SURFACES.find(q => q.drawbridge === 'db-unit');
    ok(!!S0 && S0.kind === 'ramp' && Math.abs(S0.x - 19.6) < 1e-6 && Math.abs(S0.d - 7.2) < 1e-6 && S0.y0 === 6 && S0.y1 === 6 && !S0.noStand, 'down: one flat ramp from the hinge to the far end, standable');
    ok(C.surfaceHeight(22.5, 0, 6) === 6 && C.surfaceHeight(16.5, 1.5, 6) === 6 && C.surfaceHeight(19.6, 2.0, 6) < 6, 'down: a floor at 6 along its 3.4 m width over the gap, none beside it');
    ok(C.activeMap().built.SURFACES.includes(S0), 'the surface is in the map\'s built list too (a map switch keeps it)');
    C.updateDrawbridges(14);   // 40°
    ok(C.SURFACES.filter(q => q.drawbridge).length === 1 && Math.abs(S0.y1 - (6 + 7.2 * Math.sin(40 * Math.PI / 180))) < 1e-6 && Math.abs(S0.d - 7.2 * Math.cos(40 * Math.PI / 180)) < 1e-6 && !S0.noStand,
      'rising (40°): the same surface, its far end up 4.6 m, its footprint shortened, still standable');
    const u = 5, xu = 16 + u * Math.cos(40 * Math.PI / 180), top = 6 + u * Math.sin(40 * Math.PI / 180);
    ok(Math.abs(C.surfaceHeight(xu, 0, top - 0.2) - top) < 0.02 && Math.abs((C.drawbridgeUnder(xu, 0, top)?.u ?? -9) - u) < 0.05, `at 40°, 5 m up the slab the floor is where the helper says (${top.toFixed(2)} m) and drawbridgeUnder knows how far along`);
    // a wizard standing still 5 m up the slab as it rises (feet follow the floor while it's within a step): lifted, then dropped past the fall angle
    let y = 6, fellAt = null, peak = 6;
    for (let t = 12; t <= 16; t += 1 / 60) { C.updateDrawbridges(t); const fl = C.surfaceHeight(21, 0, y); if (fl >= y - 0.02) { y = fl; peak = Math.max(peak, y); } else { fellAt = { t, a: deg(C.drawbridgeAngle(t)) }; break; } }
    ok(fellAt && fellAt.a > 44.9 && fellAt.a < 47 && peak > 9.4, `standing 5 m up: carried to ${peak.toFixed(2)} m, dropped as the slab passed 45° (${fellAt?.a.toFixed(1)}° at ${fellAt?.t.toFixed(2)} s)`);
    C.updateDrawbridges(16);   // up: 80°
    const [px] = C.surfacePushOut(16.3, 0, 6, C.PLAYER_RADIUS), topAt = S0.y0 + (S0.y1 - S0.y0) * ((16.4 - S0.x) / S0.d + 0.5);
    ok(S0.noStand && px < 16.05 && C.surfaceHeight(16.6, 0, 6) < 6 && !!C.surfaceSolidAt(16.4, topAt - 0.1, 0) && C.surfaceBlocks([14, 7.5, 0], [19, 7.5, 0]), 'up (80°): a wall across the island\'s edge: pushes a wizard back onto the apron, holds nobody, is solid to shots and sight');
    const slide = C.drawbridgeSlideVec({ a: 30 * Math.PI / 180, b: C.drawbridges()[0] });
    ok(slide && slide[0] < -3 && Math.abs(slide[1]) < 1e-9, `the slide points back to the hinge (-x) at 30°: ${slide?.map(v => v.toFixed(2))}`);
    C.setDrawbridges([]); C.updateDrawbridges(0);
    const own = (C.DRAWBRIDGES || []).map(b => b.id);
    ok(!C.SURFACES.some(q => q.drawbridge === 'db-unit') && !C.activeMap().built.SURFACES.some(q => q.drawbridge === 'db-unit') && C.SURFACES.filter(q => q.drawbridge).every(q => own.includes(q.drawbridge)) && C.SURFACES.filter(q => q.drawbridge).length === own.length,
      `an empty test list takes the test surface out of both lists; the map's own drawbridges stay (${own.join(', ') || 'none'})`);
  } else ok(true, '(no Sky Ruins layout loaded: the moving-surface checks skipped)');
  if (had) C.setActiveMap(had);
  // the hop planner: a sprint-jump alone makes 3 m level; 4-5.3 m needs the air jump at the apex; past about 6 m nothing does
  const cap = C.sprintOf() * 0.97, P3 = C.hopPlan([0, 6, 0], [3, 6, 0], cap), P4 = C.hopPlan([0, 6, 0], [4, 6.3, 0], cap), P5 = C.hopPlan([0, 6, 0], [5.3, 6, 0], cap), P7 = C.hopPlan([0, 6, 0], [7, 6, 0], cap);
  ok(P3 && !P3.air && P4 && P4.air && Math.abs(P4.airAt - C.JUMP.v0 / C.JUMP.gravity) < 1e-9 && P5 && P5.air && P5.speed <= cap && !P7,
    `hopPlan: 3 m single (${P3?.speed.toFixed(1)} m/s), 4 m +0.3 and 5.3 m with the air jump at the apex (${P4?.speed.toFixed(1)}, ${P5?.speed.toFixed(1)} m/s), 7 m impossible`);
}

// ---- round 24: the route graph on Sky Ruins (bots.js): stepping-stone hops, the narrow walkway, the drawbridge edge
{
  const { routeGraphDebug } = await import('../../server/bots.js');
  const had = C.ACTIVE_MAP.name;
  if (C.setActiveMap('sky')) {
    C.updateDrawbridges(0);
    const G = routeGraphDebug();
    const stones = (C.ISLANDS || []).filter(i => i.w <= 2.5 && i.d <= 2.5), hops = G.edges.filter(e => e.kind === 'hop'), narrow = G.edges.filter(e => e.kind === 'narrow'), dbs = G.edges.filter(e => e.kind === 'drawbridge');
    if (stones.length) {
      // every stone is on a hop chain (each gap made by a planned sprint-jump plus the air jump: hopPlan built the edges), from banks on two islands
      const stoneIdx = G.nodes.map((n, i) => n.stone ? i : -1).filter(i => i >= 0);
      ok(stoneIdx.every(i => G.adj[i].some(e => e.kind === 'hop')) && hops.length >= stones.length * 2, `every stepping stone has a hop edge (${stones.length} stones, ${hops.length / 2} hops)`);
      const bankIslands = new Set(G.nodes.filter(n => n.bank).map(n => n.bank.id));
      ok(bankIslands.size >= 2, `the stones are jumped onto from ${bankIslands.size} islands (${[...bankIslands].join(', ')})`);
      // the chain crosses: from a bank on one island, hops only, to a bank on another
      const bankIdx = G.nodes.map((n, i) => n.bank ? i : -1).filter(i => i >= 0), seen = new Set([bankIdx[0]]), queue = [bankIdx[0]];
      while (queue.length) { const u = queue.shift(); for (const e of G.adj[u]) if (e.kind === 'hop' && !seen.has(e.b)) { seen.add(e.b); queue.push(e.b); } }
      ok(bankIdx.some(i => i !== bankIdx[0] && seen.has(i) && G.nodes[i].bank.id !== G.nodes[bankIdx[0]].bank.id), 'a chain of hops joins two islands through the stones');
    } else ok(true, '(no stepping stones in layout-sky.json yet: the hop checks skipped)');
    const wk = C.SURFACES.find(s => /^walkway/.test(s.name || ''));
    if (wk) ok(narrow.length === 2 && Math.min(wk.w, wk.d) <= 1.2 && narrow[0].s === wk && narrow.every(e => G.adj[e.a].some(q => q.kind === 'walk')), `the narrow walkway (${wk.name}, ${Math.min(wk.w, wk.d).toFixed(1)} m wide) is one narrow edge each way, joined to the islands`);
    else ok(true, '(no walkway-* deck in layout-sky.json yet: the narrow check skipped)');
    if (C.drawbridges().length) ok(dbs.length === 2 && dbs[0].len > 7, `the drawbridge is a time-gated edge each way (${dbs[0]?.len.toFixed(1)} m)`);
    else ok(true, '(no drawbridge in layout-sky.json yet: the edge check skipped)');
  }
  if (had) C.setActiveMap(had);
}

await serverChecks();
await roomChecks();
await savesChecks();

async function serverChecks() {
  const { spawn } = await import('node:child_process');
  const { default: WebSocket } = await import('ws');
  const port = 4191, root = new URL('../../', import.meta.url).pathname;
  const srv = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), WA_DEBUG: '1', MATCH_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  try {
    await new Promise((res, rej) => { srv.stdout.on('data', d => { if (/listening/.test(d)) res(); }); srv.on('exit', () => rej(new Error('server exited'))); });
    const RELIC = C.RETIRED_SPELLS.trapped_relic, ROLL = C.RETIRED_SPELLS.roll;   // (round 27: retired; these checks run in v24 rooms, proto 24)
    const join = async (name, lo, room = undefined) => {   // (round 24: `room` 'new' or a code, for checks that want a room of their own)
      const ws = new WebSocket(`ws://localhost:${port}`);
      // (round 16: like the game's client, a state report echoes the server's last move of us it has seen, unless the test sets tp)
      const c = { ws, name, msgs: [], id: null, props: null, tp: 0, send: (m) => ws.send(JSON.stringify(m.t === 'state' && !('tp' in m) ? { ...m, tp: c.tp } : m)) };
      ws.on('message', raw => { const m = JSON.parse(raw); if (m.t === 'welcome') { c.id = m.id; c.props = m.props; c.room = m.room; c.propState = new Map(m.props.map(q => [q.id, q])); }
        if (m.t === 'prop' && c.propState) c.propState.set(m.prop.id, m.prop);
        if (m.t === 'propBreak' && c.propState?.has(m.id)) c.propState.set(m.id, { ...c.propState.get(m.id), state: 'broken' });
        if (m.id === c.id && typeof m.seq === 'number' && ['respawn', 'flaskArrive', 'mirror', 'mrainLand'].includes(m.t)) c.tp = m.seq;
        c.msgs.push(m); });
      await new Promise(r => ws.on('open', r));
      c.send({ t: 'join', proto: 24, name, loadout: { ...C.DEFAULT_LOADOUT, primary: 'spark', ...lo }, ...(room ? { room } : {}) });   // (round 22 / 24: not a legacy or v22 room; round 27: a v24 room, the store build's free loadouts)
      while (c.id == null) await wait(10);
      return c;
    };
    const since = (c, n, pred) => c.msgs.slice(n).filter(pred);
    const A = await join('Relic', { utility: 'trapped_relic' }), B = await join('Tk', { utility: 'telekinesis' });
    const V = await join('Victim', { utility: 'telekinesis' }), R = await join('Roller', { utility: 'roll' });
    A.send({ t: 'matchDebug', size: 4, countdown: 1 }); A.send({ t: 'removeBots' });
    await wait(1500);
    const place = (c, p, yaw = 0) => c.send({ t: 'debugPlace', p: [p[0], 0, p[1]], yaw });
    // open ground (round 15, the castle: inside its walls; no collider, platform, wall or prop within 3.5 m, sampled over
    // the whole disc), and a prop moved to each spot (debugProp). Spots 9-12 are where the four testers park.
    const inside = (x, z, m) => (C.insideArena && Number.isFinite(C.ARENA_BOUNDS?.x0)) ? C.insideArena(x, z, m) : Math.hypot(x, z) < C.ARENA_RADIUS - m;
    const flat = (x, z, r) => { for (let dx = -r; dx <= r; dx += 0.75) for (let dz = -r; dz <= r; dz += 0.75) if (dx * dx + dz * dz <= r * r && C.surfaceTopAt(x + dx, z + dz) >= 0.05) return false; return true; };
    // (the trap tests also stand and shoot along the prop's x axis, out to 4.6 m: that strip must be clear too)
    const strip = (x, z) => { for (let dx = -4.6; dx <= 4.6; dx += 0.4) for (const dz of [-0.6, 0, 0.6]) if (C.surfaceTopAt(x + dx, z + dz) >= 0.05) return false; return true; };
    const clear = (x, z, r) => inside(x, z, r) && C.COLLIDERS.every(c => Math.hypot(c.x - x, c.z - z) > c.r + r)
      && [...A.propState.values()].every(p => Math.hypot(p.x - x, p.z - z) > r) && flat(x, z, r) && strip(x, z);
    // every prop at rest (nothing carried or in flight from a fill bot) before choosing open ground around them
    for (let i = 0; i < 60 && ![...A.propState.values()].every(q => q.state === 'idle'); i++) await wait(150);
    const spots = [];
    for (let x = -34; x <= 34; x++) for (let z = -34; z <= 34; z++) if (clear(x, z, 3.5) && spots.every(q => Math.hypot(q[0] - x, q[1] - z) > 9.5)) spots.push([x, z]);
    // parking: open ground (no strip needed), 9.5 m from every test spot and from each other
    const parks = [];
    for (let x = -34; x <= 34; x++) for (let z = -34; z <= 34; z++) if (inside(x, z, 2) && flat(x, z, 2) && [...A.propState.values()].every(p => Math.hypot(p.x - x, p.z - z) > 2)
      && spots.slice(0, 9).every(q => Math.hypot(q[0] - x, q[1] - z) > 9.5) && parks.every(q => Math.hypot(q[0] - x, q[1] - z) > 4)) parks.push([x, z]);
    ok(spots.length >= 9 && parks.length >= 4, `nine open spots for the trap and roll tests (${spots.length}) and four to park on (${parks.length})`);
    const park = (c, i) => place(c, parks[i] || [0, 0]);   // out of the way, on open ground of its own
    [A, B, V, R].forEach(park);
    // round 17 (deterministic): all four testers share one room, and each test prop is put on its spot and confirmed there by
    // the room's own broadcast (debugProp only moves a resting prop: a fill bot from before the testers arrived may have
    // lifted or thrown one, so wait until it's idle again, and retry)
    ok([B, V, R].every(c => c.room?.id === A.room?.id), `the four testers share one room (${[A, B, V, R].map(c => c.room?.id).join(' ')})`);
    const putProp = async (p, x, z) => {
      for (let i = 0; i < 40; i++) {
        const cur = A.propState.get(p.id);
        if (cur?.state === 'idle') {
          A.send({ t: 'debugProp', id: p.id, x, z }); await wait(120);
          const now = A.propState.get(p.id);
          if (now?.state === 'idle' && now.x === x && now.z === z) { p.x = x; p.z = z; return true; }
        } else await wait(150);
      }
      return false;
    };
    const open = [...A.propState.values()].sort((a, b) => (a.state !== 'idle') - (b.state !== 'idle') || a.id - b.id).slice(0, 8).map(q => ({ ...q }));   // (resting ones first; spots[7] is the roll test's)
    const placed = [];
    for (const [i, p] of open.entries()) { const sp = spots[i < 7 ? i : 8]; placed.push(await putProp(p, sp[0], sp[1])); }
    ok(placed.every(Boolean), `the test props are resting on their spots (${placed.filter(Boolean).length}/${open.length})`);
    const [p1, p2, p3, p4] = open;
    const at = (prop, dx, dz) => [prop.x + dx, prop.z + dz];
    const aimAt = (c, from, prop) => { const o = [from[0], 1.3, from[1]], t = [prop.x, C.PROP_TYPES[prop.type].h * 0.5, prop.z]; return { aimOrigin: o, aimDir: [t[0] - o[0], t[1] - o[1], t[2] - o[2]] }; };
    const yawTo = (from, prop) => Math.atan2(prop.x - from[0], prop.z - from[1]);
    const curse = async (prop) => {
      const from = at(prop, 4, 0); place(A, from, yawTo(from, prop)); A.send({ t: 'debugPlace', p: [from[0], 0, from[1]], resetCd: true }); await wait(80);
      const n = A.msgs.length; A.send({ t: 'curse', ...aimAt(A, from, prop) }); await wait(120);
      return since(A, n, m => m.t === 'curse').pop()?.ids || null;
    };

    // Telekinesis only: a Relic player's pickup is ignored; a Telekinesis player's lifts
    {
      const from = at(p1, 4, 0); place(A, from, yawTo(from, p1)); await wait(80);
      const n = A.msgs.length; A.send({ t: 'pickup', ...aimAt(A, from, p1) }); await wait(500);
      ok(!since(A, n, m => m.t === 'prop' && m.prop.carrier === A.id).length, 'Trapped Relic can\'t lift (pickup ignored)');
      park(A, 0);
      place(B, from, yawTo(from, p1)); await wait(80);
      const k = B.msgs.length; B.send({ t: 'pickup', ...aimAt(B, from, p1) }); await wait(600);
      ok(since(B, k, m => m.t === 'prop' && m.prop.id === p1.id && m.prop.carrier === B.id).length > 0, 'Telekinesis lifts');
      B.send({ t: 'drop' }); await wait(100);
      // round 16 (Ty): 4.5 s after letting go before the next lift (was 3)
      const lifted = (n) => since(B, n, m => m.t === 'prop' && m.prop.id === p1.id && m.prop.carrier === B.id).length > 0;
      const now1 = () => B.msgs.filter(m => m.t === 'prop' && m.prop.id === p1.id).pop()?.prop || p1;
      await wait(3400); let k2 = B.msgs.length; place(B, at(now1(), 4, 0), yawTo(at(now1(), 4, 0), now1())); await wait(80);
      B.send({ t: 'pickup', ...aimAt(B, at(now1(), 4, 0), now1()) }); await wait(400);
      const early = lifted(k2);
      await wait(1000); k2 = B.msgs.length; B.send({ t: 'pickup', ...aimAt(B, at(now1(), 4, 0), now1()) }); await wait(600);
      ok(!early && lifted(k2), `Telekinesis waits ${C.SPELLBOOK.telekinesis.liftCooldown} s after letting go: no lift at 3.5 s, a lift at 4.9 s`);
      B.send({ t: 'drop' }); await wait(100);
      park(B, 1); await wait(80);
    }
    // the curse, then the curser walking past it, then an enemy walking in
    {
      const ids = await curse(p2);
      ok(ids?.includes(p2.id), 'Trapped Relic curses an object (F, no lift)');
      let n = A.msgs.length;
      place(A, at(p2, 1, 0)); await wait(600);
      ok(!since(A, n, m => (m.t === 'relicFuse' || m.t === 'relicBlast') && (m.id === p2.id || m.prop === p2.id)).length, 'the curser walking past their own trap doesn\'t set it off');
      park(A, 0);
      place(V, at(p2, 0, 5)); await wait(200);
      ok(V.msgs.filter(m => m.t === 'glyphs').pop()?.ids?.includes(p2.id), `an enemy within ${RELIC.seen} m sees the trap's glyph`);
      place(V, at(p2, 0, 9)); await wait(200);
      ok(!V.msgs.filter(m => m.t === 'glyphs').pop()?.ids?.includes(p2.id), 'and not from farther away');
      n = V.msgs.length;
      place(V, at(p2, 0, 1.2)); await wait(500);
      const fuse = since(V, n, m => m.t === 'relicFuse' && m.id === p2.id)[0], blast = since(V, n, m => m.t === 'relicBlast' && m.prop === p2.id)[0];
      const hit = since(V, n, m => m.t === 'hit' && m.target === V.id && m.kind === 'trapped_relic' && m.attacker === A.id)[0];
      ok(!!fuse && !!blast && blast.by === A.id && blast.victim === null, 'an enemy walking up to it lights the fuse, and it blows where it stands');
      ok(!!hit && hit.dmg > 0, `the enemy takes the blast, credited to the curser (${hit?.dmg} damage)`);
      park(V, 2); await wait(600);
    }
    // an enemy's spell breaking it sets it off; the curser breaking their own only disarms it
    {
      let ids = await curse(p3);
      ok(ids?.includes(p3.id), 'a second trap');
      park(A, 0);
      place(V, at(p3, 0, 2.6)); const from = at(p3, -4.5, 0); place(B, from, yawTo(from, p3)); await wait(150);
      let n = V.msgs.length;
      B.send({ t: 'cast', kind: 'fast', ...(({ aimOrigin, aimDir }) => ({ origin: aimOrigin, dir: aimDir }))(aimAt(B, from, p3)) }); await wait(700);
      ok(since(V, n, m => m.t === 'relicBlast' && m.prop === p3.id).length === 1, 'an enemy\'s Spark breaking a trap sets it off');
      ok(since(V, n, m => m.t === 'hit' && m.target === V.id && m.kind === 'trapped_relic').length === 1, 'and blasts an enemy beside it');
      park(B, 1); park(V, 2); await wait(800);
      ids = await curse(p4);
      ok(ids?.includes(p4.id), 'a trap to break ourselves');
      const f2 = at(p4, -4.5, 0); place(A, f2, yawTo(f2, p4)); place(V, at(p4, 0, 2.6)); await wait(150);
      n = V.msgs.length;
      A.send({ t: 'cast', kind: 'fast', ...(({ aimOrigin, aimDir }) => ({ origin: aimOrigin, dir: aimDir }))(aimAt(A, f2, p4)) }); await wait(700);
      ok(since(V, n, m => m.t === 'propBreak' && m.id === p4.id).length === 1 && !since(V, n, m => m.t === 'relicBlast').length
        && !since(V, n, m => m.t === 'hit' && m.target === V.id).length, 'the curser breaking their own trap only disarms it');
      park(V, 2);
    }
    // laid beside an enemy, it waits for them to step out and come back (a trap, not a remote bomb)
    {
      const pr = open[7];
      place(V, at(pr, 0, 1.2)); await wait(100);
      const n = V.msgs.length;
      const ids = await curse(pr); park(A, 0); await wait(500);
      ok(ids?.includes(pr.id) && !since(V, n, m => m.t === 'relicFuse' && m.id === pr.id).length, 'a trap laid beside an enemy doesn\'t go off on them at once');
      place(V, at(pr, 0, 4)); await wait(150); place(V, at(pr, 0, 1.2)); await wait(500);
      ok(since(V, n, m => m.t === 'relicBlast' && m.prop === pr.id).length === 1, 'it does when they step out and come back');
      park(V, 2); await wait(600);
    }
    // one armed trap at most (round 16, Ty: was 2): a new curse clears the old one
    {
      const fresh = open.slice(4, 6);
      const got = [];
      for (const pr of fresh) got.push(await curse(pr));
      ok(RELIC.traps === 1 && got[0]?.length === 1 && got[0].includes(fresh[0].id) && got[1]?.length === 1 && got[1].includes(fresh[1].id),
        `${RELIC.traps} trap per caster; a new curse clears the old one (${JSON.stringify(got)})`);
      park(A, 0);
    }
    // Roll: two charges, then the cooldown; a Spark passes through inside the dodge window, and hits after it
    {
      const spot = [spots[7][0] + 2, spots[7][1]], from = [spot[0] - 4, spot[1]];
      place(R, spot); place(B, from, Math.atan2(spot[0] - from[0], spot[1] - from[1])); B.send({ t: 'debugPlace', p: [from[0], 0, from[1]], resetCd: true }); await wait(800);
      const shoot = () => B.send({ t: 'cast', kind: 'fast', origin: [from[0], 1.3, from[1]], dir: [spot[0] - from[0], C.HIT_CENTER_Y - 1.3, spot[1] - from[1]] });
      let n = R.msgs.length;
      R.send({ t: 'roll', dir: [0, 0, 1] }); shoot(); await wait(400);
      ok(since(R, n, m => m.t === 'roll' && m.id === R.id).length === 1, 'Roll goes');
      ok(!since(R, n, m => m.t === 'hit' && m.target === R.id).length, 'a Spark fired into the roll passes through (dodge window)');
      await wait(200); n = R.msgs.length; shoot(); await wait(400);   // (Spark's cooldown is 0.45 s)
      ok(since(R, n, m => m.t === 'hit' && m.target === R.id).length === 1, 'after the window, the next Spark hits');
      n = R.msgs.length;
      R.send({ t: 'roll', dir: [0, 0, -1] }); await wait(450);
      R.send({ t: 'roll', dir: [0, 0, 1] }); await wait(200);
      ok(since(R, n, m => m.t === 'roll' && m.id === R.id).length === 1, `two charges, then wait (${ROLL.cooldown} s)`);
    }
    // ---- round 22: rune pickups, jump pads and the void (debugMap sets this room's spots, so no layout is needed)
    {
      const spot = spots[7], far = spots[8];
      const runeAt = (x, z, type) => ({ id: 'r' + type, x, y: 0, z, type });
      // the landing: another open spot with nothing tall on the straight path from the pad (an arc skimming a wall top lands on it)
      const lowPath = (a, b) => { for (let i = 0; i <= 30; i++) { const x = a[0] + (b[0] - a[0]) * i / 30, z = a[1] + (b[1] - a[1]) * i / 30; if (C.surfaceTopAt(x, z) > 0.8) return false; } return true; };
      const land = spots.find((q, i) => i !== 7 && i !== 8 && lowPath(far, q)) || spots[6];
      const pad = { id: 'pad-t', x: far[0], y: 0, z: far[1], tx: land[0], ty: 0, tz: land[1], strength: 2.5 };
      A.send({ t: 'debugMap', runes: [runeAt(spot[0], spot[1], 'haste'), runeAt(spot[0] + 5, spot[1], 'aegis'), runeAt(spot[0] - 5, spot[1], 'surge'), runeAt(spot[0], spot[1] + 5, 'fury')], pads: [pad] });
      await wait(200);
      const mapMsg = A.msgs.filter(m => m.t === 'map').pop();
      ok(mapMsg?.runes?.length === 4 && mapMsg.runes.every(r => r.up && r.type) && mapMsg.pads?.length === 1 && Math.abs(mapMsg.pads[0].to[0] - pad.tx) < 0.01,
        `debugMap: 4 runes up with their types and a pad with its target (${mapMsg?.runes?.map(r => r.type).join(' ')}, pad to ${mapMsg?.pads?.[0]?.to})`);
      const snapRunes = () => A.msgs.filter(m => m.t === 'snap' && m.runes).pop()?.runes || [];
      const meIn = (c) => A.msgs.filter(m => m.t === 'snap').pop()?.players.find(q => q.id === c.id);
      [A, B, V, R].forEach(park);
      let n = A.msgs.length;
      place(V, [spot[0], spot[1]]); await wait(250);
      const taken = since(A, n, m => m.t === 'runeTaken')[0];
      ok(taken?.by === V.id && taken.type === 'haste' && taken.i === 0, `walking onto a rune takes it: runeTaken by the walker, its type (${JSON.stringify(taken)})`);
      ok(meIn(V)?.buffs?.haste === 1 && !meIn(V)?.buffs?.fury, `the snapshot shows the Haste buff (${JSON.stringify(meIn(V)?.buffs)})`);
      ok(snapRunes()[0]?.up === false && snapRunes()[0].in > 20 && snapRunes()[0].in <= C.RUNES.respawn, `the rune is down, back in ${snapRunes()[0]?.in} s`);
      // haste: a report 1.3x the walk is accepted (no overspeed drag); the same without haste is dragged
      const walkTest = async (c, fast) => {
        const start = [c === V ? spot[0] : far[0], c === V ? spot[1] + 2 : far[1] + 2];
        c.send({ t: 'debugPlace', p: [start[0], 0, start[1]] }); await wait(100);
        const v = C.speedOf() * (fast ? C.RUNES.types.haste.speedMul : 1) * 0.97;
        for (let i = 1; i <= 20; i++) { c.send({ t: 'state', p: [start[0] + v * 0.05 * i, 0, start[1]], yaw: Math.PI / 2 }); await wait(50); }
        await wait(100);
        return meIn(c).p[0] - start[0];
      };
      const dHaste = await walkTest(V, true);
      ok(dHaste > C.speedOf() * C.RUNES.types.haste.speedMul * 0.9, `with Haste the server accepts 1.35x the walk (${dHaste.toFixed(2)} m in 1 s)`);
      park(V, 2);
      place(B, [far[0], far[1] + 6]); await wait(100);
      const dPlain = await walkTest(B, false);
      ok(dPlain < C.speedOf() * 1.2, `without it the same reports are held to the walk (${dPlain.toFixed(2)} m in 1 s)`);
      park(B, 1); await wait(200);
      // aegis: a 40 HP shield soaks a Spark (hit.shield, no hp lost)
      n = A.msgs.length;
      place(V, [spot[0] + 5, spot[1]]); await wait(250);
      ok(since(A, n, m => m.t === 'runeTaken' && m.type === 'aegis' && m.by === V.id).length === 1 && meIn(V)?.buffs?.aegis === C.RUNES.types.aegis.shield, `the Aegis rune: a ${C.RUNES.types.aegis.shield} HP shield in the snapshot (${JSON.stringify(meIn(V)?.buffs)})`);
      const from = [spot[0] + 5 - 4.5, spot[1]]; place(B, from, Math.PI / 2); B.send({ t: 'debugPlace', p: [from[0], 0, from[1]], resetCd: true }); await wait(100);
      const hpBefore = meIn(V).hp; n = A.msgs.length;
      B.send({ t: 'cast', kind: 'fast', origin: [from[0], 1.3, from[1]], dir: [1, (C.HIT_CENTER_Y - 1.3) / 4.5, 0] }); await wait(500);
      const sh = since(A, n, m => m.t === 'hit' && m.target === V.id)[0];
      ok(sh && sh.shield > 0 && sh.dmg === 0 && meIn(V).hp >= hpBefore && meIn(V).buffs.aegis === C.RUNES.types.aegis.shield - sh.shield,
        `a Spark into the shield: ${sh?.shield} soaked, 0 damage, the shield down to ${meIn(V).buffs?.aegis}`);
      park(B, 1); park(V, 2); await wait(200);
      // surge: +35% ult at once
      const ultBefore = meIn(R).ult; n = A.msgs.length;
      place(R, [spot[0] - 5, spot[1]]); await wait(250);
      ok(since(A, n, m => m.t === 'runeTaken' && m.type === 'surge').length === 1 && meIn(R).ult >= ultBefore + C.RUNES.types.surge.ult - 1, `the Surge rune: ult ${ultBefore} -> ${meIn(R).ult}`);
      park(R, 3);
      // fury: x1.4 damage
      n = A.msgs.length; place(A, [spot[0], spot[1] + 5]); await wait(250);
      ok(since(A, n, m => m.t === 'runeTaken' && m.type === 'fury' && m.by === A.id).length === 1 && meIn(A)?.buffs?.fury === 1, 'the Fury rune: the fury buff');
      const f2 = [spot[0], spot[1] + 5 - 4.5]; place(A, f2, 0); A.send({ t: 'debugPlace', p: [f2[0], 0, f2[1]], resetCd: true }); place(B, [spot[0], spot[1] + 5]); await wait(150);   // (B: no shield left on V)
      n = A.msgs.length; A.send({ t: 'cast', kind: 'fast', origin: [f2[0], 1.3, f2[1]], dir: [0, (C.HIT_CENTER_Y - 1.3) / 4.5, 1] }); await wait(500);
      const fh = since(A, n, m => m.t === 'hit' && m.target === B.id && m.attacker === A.id)[0];
      ok(fh && fh.dmg === Math.round(Math.round(C.SPELLS.fast.damage * C.DAMAGE_SCALE) * C.RUNES.types.fury.damageMul), `a Spark with Fury does x1.4 (${fh?.dmg}, plain ${Math.round(C.SPELLS.fast.damage * C.DAMAGE_SCALE)})`);
      park(A, 0); park(B, 1); await wait(200);
      // the pad: stepping on it launches (a pad message), the client flying C.padAt's arc is accepted, and lands at the target
      const arc = C.padArc(pad);
      n = R.msgs.length;
      R.send({ t: 'debugPlace', p: [pad.x - 0.3, 0, pad.z] }); await wait(120);
      const launch = since(R, n, m => m.t === 'pad' && m.id === R.id)[0];
      ok(launch && launch.pad === 0 && Math.abs(launch.time - arc.time) < 0.01 && Math.abs(launch.to[0] - pad.tx) < 0.01, `standing on a pad launches: { t: 'pad' } with the arc's time ${launch?.time} s to ${launch?.to}`);
      ok(meIn(R).pad === true, 'the snapshot shows the pad flight');
      const t0 = Date.now();
      for (let e = 0.05; e < arc.time + 0.2; e += 0.05) {
        const at = C.padAt(arc, pad, Math.min(e, arc.time)); if (e >= arc.time) at[1] = 0;
        R.send({ t: 'state', p: at, yaw: 0, tp: R.tp });
        await new Promise(r => setTimeout(r, Math.max(0, t0 + e * 1000 - Date.now())));
      }
      await wait(150);
      const landed = meIn(R);
      ok(Math.abs(landed.p[0] - pad.tx) < 0.3 && Math.abs(landed.p[2] - pad.tz) < 0.3 && landed.p[1] < 0.05 && !landed.pad, `the reported arc is accepted: landed at (${landed.p.map(v => v.toFixed(2))}), target (${pad.tx}, 0, ${pad.tz}); the flight is over`);
      ok(Math.abs(C.padAt(arc, pad, arc.time)[0] - pad.tx) < 0.01 && Math.abs(C.padAt(arc, pad, arc.time)[1] - pad.ty) < 0.01 && Math.abs(arc.apex - pad.y - 2.5) < 0.01, 'padArc lands on the target, its apex `strength` above the pad');
      park(R, 3); await wait(300);
      // the void: below the map's void height (Sky Ruins' MAP_INFO.void; here debugMap's own, so the rule is checked on any map) you
      // die, credited to whoever hurt you within VOID.credit s
      {
        A.send({ t: 'debugMap', runes: [], pads: [], void: -1 }); await wait(200);
        const vs = [spot[0], spot[1]], as = [spot[0] + 4.5, spot[1]];
        place(V, vs); place(A, as, Math.atan2(-1, 0)); A.send({ t: 'debugPlace', p: [as[0], 0, as[1]], resetCd: true }); await wait(300);
        n = A.msgs.length;
        A.send({ t: 'cast', kind: 'fast', origin: [as[0], 1.3, as[1]], dir: [-1, (C.HIT_CENTER_Y - 1.3) / 4.5, 0] }); await wait(400);
        const hitV = since(A, n, m => m.t === 'hit' && m.target === V.id && (m.dmg > 0 || m.shield > 0)).length;   // (V may still carry the Aegis: a soaked hit counts as being hurt)
        V.send({ t: 'debugPlace', p: [vs[0], -2, vs[1]] }); await wait(300);
        const d = since(A, n, m => m.t === 'death' && m.id === V.id)[0];
        ok(hitV === 1 && d && d.cause === 'void' && d.kind === 'void' && d.killer === A.id, `below the void: a 'void' death credited to who hit them 0.4 s ago (${JSON.stringify(d)})`);
        await wait(C.RESPAWN_TIME * 1000 + 300);
        park(A, 0); await wait(5000);
        n = A.msgs.length;
        V.send({ t: 'debugPlace', p: [vs[0], -2, vs[1]] }); await wait(300);
        const d2 = since(A, n, m => m.t === 'death' && m.id === V.id)[0];
        ok(d2?.cause === 'void' && d2.killer === null, `more than 5 s after the last hit: nobody is credited (${JSON.stringify(d2)})`);
        await wait(C.RESPAWN_TIME * 1000 + 300);
        park(V, 2);
        A.send({ t: 'debugMap', runes: [], pads: [] }); await wait(200);
      }
      // the second map (environment's layout-sky.json), when the server has it: a test's pick switches the room there and back
      if (C.MAPS?.sky) {
        // (the match has had kills: the pick applies to the next match, so end this one: a short gap and recap, then the countdown)
        A.send({ t: 'matchDebug', map: 'sky', endTime: 0.3, recapTime: 0.3 }); A.send({ t: 'matchDebug', skip: true }); await wait(1800);
        ok(A.msgs.filter(m => m.t === 'map').pop()?.map?.id === 'sky' && A.msgs.filter(m => m.t === 'matchPhase').pop()?.match.map.id === 'sky', 'matchDebug.map sky, the match ended: the rematch is on Sky Ruins (a map message, matchPhase on sky)');
        ok(Number.isFinite(C.MAPS.sky.layout?.map?.void), `Sky Ruins has a void height (${C.MAPS.sky.layout?.map?.void})`);
        A.send({ t: 'matchDebug', map: 'courtyard' }); A.send({ t: 'matchDebug', skip: true }); await wait(1800);
        ok(A.msgs.filter(m => m.t === 'map').pop()?.map?.id === 'courtyard', 'and back to the courtyard the same way');
      }
    }
    for (const c of [A, B, V, R]) c.ws.close();
    await wait(300);
    await agilityChecks(join, since, spots);
    await drawbridgeChecks(join, since);
    await skyPropChecks(join, since);
  } catch (e) { ok(false, `server checks: ${e.message}`); }
  finally { if (srv.exitCode === null) { srv.kill(); await new Promise(r => srv.once('exit', r)); } }   // (so a rerun can have the port)
}

// ---- round 13: the air jump, coyote time, casting on the move and in the air, the hover, sprint-jump momentum
async function agilityChecks(join, since, spots) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  // the arcs themselves: the air jump's apex is AIR_JUMP.height (about 1.2 m) above where it starts
  {
    let top = 0;
    for (let e = 0; e < 1; e += 0.001) top = Math.max(top, C.jumpAt({ y0: C.JUMP.height, n: 2 }, e));
    const H = C.AIR_JUMP.height;   // (round 22: 1.0 m, was 1.2)
    ok(Math.abs(top - C.JUMP.height - H) < 0.02 && Math.abs(C.jumpApex({ y0: C.JUMP.height, n: 2 }) - (C.JUMP.height + H)) < 0.01,
      `the air jump from the first apex peaks about ${H} m higher (${top.toFixed(2)} m, ${(C.JUMP.height + H).toFixed(2)} expected)`);
  }
  const J = await join('Jumper', { primary: 'spark', power: 'meteor', mobility: 'blink', utility: 'telekinesis' });
  const F = await join('Floater', { primary: 'spark', power: 'frostfall', guard: 'firewall', ultimate: 'berserker_brew', utility: 'telekinesis' });
  J.send({ t: 'matchDebug', size: 2 }); J.send({ t: 'removeBots' }); await wait(600);   // (no bots fill in to interfere)
  const snap = (c) => c.msgs.filter(m => m.t === 'snap').pop()?.players.find(q => q.id === c.id);
  const reset = async (c, x, z, yaw = 0) => { c.send({ t: 'debugPlace', p: [x, 0, z], yaw, resetCd: true }); await wait(120); };
  // reports `p` (x, y, z) every 50 ms along a path: f(k) for k in 0..1 over `secs`
  const walk = async (c, secs, f, extra = {}) => { const n = Math.max(1, Math.round(secs / 0.05)); for (let i = 1; i <= n; i++) { c.send({ t: 'state', p: f(i / n), yaw: 0, ...extra }); await wait(50); } };
  const sx = spots[9]?.[0] ?? spots[0][0], sz = spots[9]?.[1] ?? spots[0][1];
  const fx = spots[10]?.[0] ?? spots[1][0], fz = spots[10]?.[1] ?? spots[1][1];

  // the air jump: once per airtime, refused a second time, back on landing
  {
    await reset(J, sx, sz);
    J.send({ t: 'state', p: [sx, 0, sz], yaw: 0 }); await wait(80);
    let n = J.msgs.length;
    J.send({ t: 'jump', y0: 0 });
    await walk(J, 0.2, k => [sx, 1.2 * k, sz]);
    J.send({ t: 'jump', n: 2, y0: 1.2 }); await wait(100);
    const aj = since(J, n, m => m.t === 'jump' && m.id === J.id && m.n === 2)[0];
    ok(!!aj && Math.abs(aj.y0 - 1.2) < 0.01, `an air jump is accepted in a jump, broadcast with n: 2 and its height (${JSON.stringify(aj)})`);
    await walk(J, 0.15, k => [sx, 1.2 + 1.2 * k, sz]); await wait(120);   // (the next snapshot)
    ok(Math.abs(snap(J).p[1] - 2.4) < 0.06, `the server takes the air jump's height (${snap(J).p[1].toFixed(2)} m, 2.4 reported)`);
    await walk(J, 0.1, () => [sx, 3.4, sz]); await wait(120);
    ok(snap(J).p[1] <= 1.2 + C.AIR_JUMP.height + 0.21, `and no higher than its apex (${snap(J).p[1].toFixed(2)} m, 3.4 reported)`);
    n = J.msgs.length;
    J.send({ t: 'jump', n: 2, y0: 2.4 }); await wait(100);
    ok(since(J, n, m => m.t === 'jumpRefused').length === 1 && !since(J, n, m => m.t === 'jump' && m.id === J.id).length,
      `a second air jump in the same airtime is refused (${JSON.stringify(since(J, n, m => m.t === 'jumpRefused' || (m.t === 'jump' && m.id === J.id)))})`);
    await walk(J, 0.4, k => [sx, 2.4 * (1 - k), sz]);   // down
    await wait(100);
    n = J.msgs.length;
    J.send({ t: 'jump', y0: 0 }); await walk(J, 0.15, k => [sx, 1.0 * k, sz]);
    J.send({ t: 'jump', n: 2, y0: 1.0 }); await wait(100);
    ok(since(J, n, m => m.t === 'jump' && m.id === J.id && m.n === 2).length === 1, 'landing gives the air jump back');
    await walk(J, 0.4, k => [sx, 1.0 * (1 - k), sz]); await wait(150);
  }
  // coyote time: a jump just after walking off an edge is a first jump; a moment later it's the air jump
  {
    let edge = null;
    for (let x = -34; x <= 34 && !edge; x += 0.5) for (let z = -34; z <= 34 && !edge; z += 0.5) {
      const top = C.surfaceTopAt(x, z);
      if (top < 1.5 || top > 4 || Math.hypot(x, z) > C.ARENA_RADIUS - 4) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ox = x + dx * 1.2, oz = z + dz * 1.2;
        if (C.surfaceTopAt(ox, oz) < 0.05 && C.surfaceTopAt(x - dx * 0.8, z - dz * 0.8) >= top - 0.05 && C.COLLIDERS.every(c => Math.hypot(c.x - ox, c.z - oz) > c.r + 0.6)) { edge = { x, z, top, dx, dz }; break; }
      }
    }
    ok(!!edge, `a ledge to walk off for the coyote test (${edge ? `${edge.x}, ${edge.z}, ${edge.top.toFixed(2)} m` : 'none'})`);
    if (edge) {
      const off = async () => {
        J.send({ t: 'debugPlace', p: [edge.x - edge.dx * 0.5, edge.top, edge.z - edge.dz * 0.5], yaw: 0, resetCd: true }); await wait(120);
        J.send({ t: 'state', p: [edge.x - edge.dx * 0.5, edge.top, edge.z - edge.dz * 0.5], yaw: 0 }); await wait(60);
        J.send({ t: 'state', p: [edge.x + edge.dx * 0.9, edge.top - 0.05, edge.z + edge.dz * 0.9], yaw: 0 }); await wait(30);   // off the edge, starting to fall
      };
      await off();
      let n = J.msgs.length;
      J.send({ t: 'jump', y0: edge.top - 0.05 }); await wait(100);
      const j = since(J, n, m => m.t === 'jump' && m.id === J.id)[0];
      ok(!!j && !j.n, 'coyote time: a jump just after walking off an edge is the normal jump');
      await walk(J, 0.6, k => [edge.x + edge.dx * 1.3, Math.max(0, edge.top - 0.05 - 3 * k), edge.z + edge.dz * 1.3]); await wait(200);
      await off();
      await walk(J, 0.25, k => [edge.x + edge.dx * 1.1, edge.top - 0.05 - 0.6 * k, edge.z + edge.dz * 1.1]);
      n = J.msgs.length;
      J.send({ t: 'jump', y0: edge.top - 0.65 }); await wait(100);
      ok(since(J, n, m => m.t === 'jumpRefused').length === 1, 'past the grace, a plain jump in a fall is refused (the air jump it would be)');
      J.send({ t: 'jump', n: 2, y0: edge.top - 0.7 }); await wait(100);
      ok(since(J, n, m => m.t === 'jump' && m.id === J.id && m.n === 2).length === 1, 'and the air jump from a fall is accepted');
      await walk(J, 0.6, k => [edge.x + edge.dx * 1.3, Math.max(0, edge.top - 0.7 - 3 * k), edge.z + edge.dz * 1.3]); await wait(200);
    }
  }
  // casting on the move: a Spark while walking slows (60%), it doesn't root; a Meteor charge still roots
  {
    await reset(J, sx, sz);
    J.send({ t: 'state', p: [sx, 0, sz], yaw: 0 }); await wait(400);   // (a full movement budget)
    let n = J.msgs.length;
    J.send({ t: 'cast', kind: 'fast', origin: [sx, 1.3, sz], dir: [0, 0, 1] });
    // 1.6 m/s: under the 60% cap (1.8 m/s) with room for the reports' arrival jitter (walking at the cap itself got clamped now
    // and then), and far above a root; then a fresh snapshot (20 Hz) before reading where the server has us
    await walk(J, 0.3, k => [sx, 0, sz + 0.48 * k]); await wait(150);
    ok(since(J, n, m => m.t === 'proj' && m.owner === J.id).length === 1, 'a Spark cast while walking is accepted');
    ok(Math.abs(snap(J).p[2] - (sz + 0.48)) < 0.05, `and the caster keeps moving through the cast, slowed but not rooted (${(snap(J).p[2] - sz).toFixed(2)} of 0.48 m)`);
    await reset(J, sx, sz); J.send({ t: 'state', p: [sx, 0, sz], yaw: 0 }); await wait(400);
    J.send({ t: 'chargeStart' }); await wait(60);
    await walk(J, 0.6, k => [sx, 0, sz + 1.8 * k]);
    await wait(120);
    ok(snap(J).p[2] - sz < 0.65, `a Meteor charge on the ground still roots (moved ${(snap(J).p[2] - sz).toFixed(2)} of 1.8 m)`);
    await wait(900); J.send({ t: 'chargeRelease', origin: [sx, 1.3, sz], dir: [0, 0, 1] }); await wait(400);
  }
  // everything casts mid-jump: the primary, Frostfall, Firewall and an ultimate (which hangs in the air, then falls)
  {
    await reset(F, fx, fz); F.send({ t: 'state', p: [fx, 0, fz], yaw: 0 }); await wait(300);
    const hop = async () => { F.send({ t: 'jump', y0: 0 }); await walk(F, 0.15, k => [fx, 1.0 * k, fz]); };
    const land = async () => { await walk(F, 0.4, k => [fx, Math.max(0, 1.0 - 2 * k), fz]); await wait(150); };
    let n = F.msgs.length;
    await hop(); F.send({ t: 'cast', kind: 'fast', origin: [fx, 2.3, fz], dir: [0, 0, 1] }); await wait(100);
    ok(since(F, n, m => m.t === 'proj' && m.owner === F.id).length === 1, 'a primary cast mid-jump is accepted');
    await land(); n = F.msgs.length;
    await hop(); F.send({ t: 'frostfall', at: [fx, fz + 8] }); await wait(100);
    ok(since(F, n, m => m.t === 'frostfall' && m.owner === F.id).length === 1, 'Frostfall cast mid-jump is accepted');
    await land(); n = F.msgs.length;
    await hop(); F.send({ t: 'firewall', yaw: 0 }); await wait(100);
    ok(since(F, n, m => m.t === 'firewall' && m.owner === F.id).length === 1, 'Firewall cast mid-jump is accepted');
    await land();
    F.send({ t: 'debugCharge' }); await wait(80); n = F.msgs.length;
    await hop(); F.send({ t: 'ult' }); await wait(100);
    ok(since(F, n, m => m.t === 'ultWindup' && m.id === F.id).length === 1, 'an ultimate cast mid-jump is accepted');
    const hy = snap(F).hover;
    await walk(F, 0.5, () => [fx, 1.0, fz]);
    ok(hy != null && Math.abs(snap(F).p[1] - 1.0) < 0.05 && snap(F).hover != null, `its wind-up hangs the caster at that height (hover ${hy}, y ${snap(F).p[1].toFixed(2)})`);
    await walk(F, 0.25, () => [fx, 1.6, fz]); await wait(120);
    ok(snap(F).p[1] < 1.15, `no higher than where the hang began (${snap(F).p[1].toFixed(2)} m)`);
    await walk(F, 0.75, () => [fx, 1.0, fz]);
    await walk(F, 0.15, () => [fx, 1.0, fz]);
    ok(snap(F).hover == null, 'the hang ends with the wind-up');
    await walk(F, 0.4, k => [fx, 1.0 * (1 - k), fz]); await wait(150);   // (a snapshot after the last report)
    ok(snap(F).p[1] < 0.05, `then the caster falls (${snap(F).p[1].toFixed(2)} m)`);
    await wait(150);
  }
  // the speed budget: a sprint-jump carries 5.5 m/s through the air; beyond that it's held back
  {
    await reset(J, sx, sz - 6); J.send({ t: 'state', p: [sx, 0, sz - 6], yaw: 0, sprint: true }); await wait(400);
    let z = sz - 6;
    await walk(J, 0.5, k => [sx, 0, z + 2.75 * k], { sprint: true }); z += 2.75;
    J.send({ t: 'jump', y0: 0 });
    const z0 = z;
    await walk(J, 0.5, k => [sx, Math.max(0, C.jumpAt({ y0: 0, n: 1 }, 0.5 * k)), z0 + 2.75 * k]);   // no Shift: momentum only
    z += 2.75; await wait(120);
    ok(Math.abs(snap(J).p[2] - z) < 0.15, `a sprint-jump's 5.5 m/s is accepted in the air (server ${(snap(J).p[2] - z0).toFixed(2)} of 2.75 m)`);
    await walk(J, 0.2, () => [sx, 0, z]); await wait(400);
    await reset(J, sx, sz - 6); J.send({ t: 'state', p: [sx, 0, sz - 6], yaw: 0 }); await wait(400);
    J.send({ t: 'jump', y0: 0 });
    await walk(J, 0.5, k => [sx, Math.max(0, C.jumpAt({ y0: 0, n: 1 }, 0.5 * k)), sz - 6 + 4.5 * k]);   // 9 m/s, from a walk
    await wait(120);
    ok(snap(J).p[2] - (sz - 6) < 3.4, `a jump faster than it took off with is held back (server ${(snap(J).p[2] - (sz - 6)).toFixed(2)} of 4.5 m)`);
  }
  for (const c of [J, F]) c.ws.close();
  await wait(300);
  await slingChecks(join, since);
}

// A straight 24 m (len) line across open courtyard floor, clear of every castle piece at knee, chest and head height, with a
// free spot 3 m from its start: { a, far, near, yaw } (a, far, near at chest height), or null.
function clearLine(len) {
  const flatAt = (x, z) => C.surfaceTopAt(x, z) < 0.05 && C.surfaceTopAt(x + 0.6, z) < 0.05 && C.surfaceTopAt(x - 0.6, z) < 0.05;
  for (let x = -22; x <= 22; x += 1) for (let z = -22; z <= 22; z += 1) for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
    const a = [x, 1.3, z], far = [x + dx * len, 1.3, z + dz * len], near = [x + dx * 3, 1.3, z + dz * 3];
    if (!(C.insideArena ? C.insideArena(far[0], far[2], 1.5) && C.insideArena(x, z, 1.5) : true)) continue;
    if (!flatAt(x, z) || !flatAt(far[0], far[2]) || !flatAt(near[0], near[2])) continue;
    if (C.surfaceSegmentHit([x, 0.4, z], [far[0], 0.4, far[2]]) || C.surfaceSegmentHit(a, far) || C.surfaceSegmentHit([x, 2, z], [far[0], 2, far[2]])) continue;
    return { a, far, near, yaw: Math.atan2(dx, dz), dir: [dx, dz] };
  }
  return null;
}

// ---- round 15: Shepherd's Sling hits harder the further the stone has flown (C.slingDamage)
async function slingChecks(join, since) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const S = await join('Slinger', { primary: 'sling', utility: 'telekinesis' });
  const T1 = await join('FarMark', { utility: 'telekinesis' }), T2 = await join('NearMark', { utility: 'telekinesis' });
  S.send({ t: 'matchDebug', size: 3 }); S.send({ t: 'removeBots' }); await wait(600);
  const line = clearLine(24);
  ok(!!line, `a clear 24 m line for the Sling test (${line ? `${line.a[0]}, ${line.a[2]}` : 'none'})`);
  if (!line) { for (const c of [S, T1, T2]) c.ws.close(); return; }
  const place = (c, p, yaw = 0) => c.send({ t: 'debugPlace', p: [p[0], 0, p[2]], yaw, resetCd: true });
  place(S, line.a, line.yaw); place(T1, line.far, line.yaw + Math.PI); place(T2, [line.a[0] - Math.sin(line.yaw) * 30, 0, line.a[2] - Math.cos(line.yaw) * 30]);
  await wait(2200);   // (past spawn protection)
  const shoot = (to) => { const d = [to[0] - line.a[0], to[1] - line.a[1], to[2] - line.a[2]], l = Math.hypot(...d);
    S.send({ t: 'cast', kind: 'sling', origin: line.a, dir: d.map(v => v / l) }); };
  let n = S.msgs.length; const nStart = n;
  shoot([line.far[0], 0.95, line.far[2]]); await wait(1100);
  const far = since(S, n, m => m.t === 'hit' && m.target === T1.id && m.kind === 'sling')[0];
  place(T1, [line.a[0] - Math.sin(line.yaw) * 30, 0, line.a[2] - Math.cos(line.yaw) * 30]);   // out of the way of the near shot
  place(T2, line.near, line.yaw + Math.PI); await wait(700);
  S.send({ t: 'debugPlace', p: [line.a[0], 0, line.a[2]], yaw: line.yaw, resetCd: true });
  for (let i = 0; i < 40; i++) {   // (a stone in the pouch: wait out the reload)
    await wait(100);
    const me = S.msgs.filter(m => m.t === 'snap').pop()?.players.find(q => q.id === S.id);
    if (me && me.ammo > 0 && !me.reload) break;
  }
  n = S.msgs.length;
  shoot([line.near[0], 0.95, line.near[2]]); await wait(500);
  const near = since(S, n, m => m.t === 'hit' && m.target === T2.id && m.kind === 'sling')[0];
  ok(!!far && !!near && far.dmg > near.dmg, `a Sling stone that flew 24 m hits harder than one from 3 m (${far?.dmg} vs ${near?.dmg})`);
  ok(!!far && far.dmg >= 17 && !!far.long && !!near && near.dmg <= 12 && !near.long, `long hits are flagged long; point blank about 9-11 (${far?.dmg}${far?.long ? ' long' : ''}, ${near?.dmg})`);
  // round 15 (Ty): the stone is just a stone: no ram is called, and no hit is more than its farthest damage
  const maxDmg = Math.round(C.SPELLS.sling.far * C.DAMAGE_SCALE);
  ok(!since(S, nStart, m => m.t === 'ramSpawn' || m.t === 'ramCalled').length, 'a Sling hit summons no ram');
  ok(!!far && far.dmg <= maxDmg && !!near && near.dmg <= maxDmg, `a Sling hit does at most ${maxDmg} (${far?.dmg}, ${near?.dmg})`);
  for (const c of [S, T1, T2]) c.ws.close();
  await wait(300);
  await rideChecks(join, since);
}

// ---- round 15: Ram Ride: a quicker mount, a faster gallop, and an enemy in the way is knocked flat (ram_shove, KNOCKDOWN.kinds)
async function rideChecks(join, since) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const RIDE = C.SPELLBOOK.ram_ride;
  const H = await join('Rider', { mobility: 'ram_ride', utility: 'telekinesis' }), V = await join('Trampled', { utility: 'telekinesis' });
  H.send({ t: 'matchDebug', size: 2 }); H.send({ t: 'removeBots' }); await wait(600);
  const line = clearLine(16);
  ok(!!line, `a clear 16 m line for the Ram Ride test (${line ? `${line.a[0]}, ${line.a[2]}` : 'none'})`);
  if (!line) { for (const c of [H, V]) c.ws.close(); return; }
  const at = (d) => [line.a[0] + line.dir[0] * d, 0, line.a[2] + line.dir[1] * d];
  H.send({ t: 'debugPlace', p: at(0), yaw: line.yaw, resetCd: true }); V.send({ t: 'debugPlace', p: at(6), yaw: line.yaw + Math.PI, resetCd: true });
  await wait(2200);   // (past spawn protection)
  let n = V.msgs.length;
  H.send({ t: 'ride', yaw: line.yaw }); await wait(40);
  const ride = since(V, n, m => m.t === 'ride' && m.id === H.id)[0];
  ok(!!ride && ride.mount <= 0.3 && Math.abs(ride.ride - RIDE.distance / RIDE.speed) < 0.01, `the ride starts: mount ${ride?.mount} s, ${ride?.ride?.toFixed(2)} s at ${RIDE.speed} m/s`);
  await wait(RIDE.mount * 1000);
  // gallop along the line, reporting every 50 ms at the ride's speed, through where the enemy stands
  for (let i = 1; i <= 24; i++) { H.send({ t: 'state', p: at(Math.min(12, RIDE.speed * 0.05 * i)), yaw: line.yaw }); await wait(50); }
  await wait(200);
  const hit = since(V, n, m => m.t === 'hit' && m.target === V.id && m.kind === 'ram_shove')[0];
  ok(!!hit && hit.dmg > 0 && !!hit.knockdown, `an enemy in the ride's path is knocked flat (${hit ? `${hit.dmg} damage, knockdown ${hit.knockdown}` : 'no hit'})`);
  for (const c of [H, V]) c.ws.close();
  await wait(300);
  await blackDeathChecks(join, since);
}

// ---- round 15: Black Death heals more: 60% of what it absorbs, plus a mend while held (BD.holdHeal a second), shown as 'bd' heals
async function blackDeathChecks(join, since) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const BD = C.SPELLBOOK.black_death;
  const S = await join('Shooter', { primary: 'fireball', utility: 'telekinesis' }), D = await join('Shroud', { guard: 'black_death', utility: 'telekinesis' });
  S.send({ t: 'matchDebug', size: 2 }); S.send({ t: 'removeBots' }); await wait(600);
  const line = clearLine(10);
  ok(!!line, `a clear line for the Black Death test (${line ? `${line.a[0]}, ${line.a[2]}` : 'none'})`);
  if (!line) { for (const c of [S, D]) c.ws.close(); return; }
  const at = (d) => [line.a[0] + line.dir[0] * d, 0, line.a[2] + line.dir[1] * d];
  S.send({ t: 'debugPlace', p: at(0), yaw: line.yaw, resetCd: true }); D.send({ t: 'debugPlace', p: at(8), yaw: line.yaw + Math.PI, resetCd: true });
  await wait(2200);   // (past spawn protection)
  const fire = () => { const o = [at(0)[0], 1.3, at(0)[2]], tg = [at(8)[0], 1.0, at(8)[2]], d = tg.map((v, i) => v - o[i]), l = Math.hypot(...d);
    S.send({ t: 'cast', kind: 'fireball', origin: o, dir: d.map(v => v / l) }); };
  const hpOf = () => D.msgs.filter(m => m.t === 'snap').pop()?.players.find(q => q.id === D.id)?.hp;
  fire(); await wait(800);   // hurt first, so there's something to heal
  const hurt = hpOf();
  let n = D.msgs.length;
  D.send({ t: 'block', on: true }); await wait(1200);   // held, nothing incoming: the mend
  const mend = since(D, n, m => m.t === 'heal' && m.id === D.id).reduce((a, m) => a + m.amt, 0);
  ok(hurt < C.MAX_HP && mend >= BD.holdHeal * 0.7 && since(D, n, m => m.t === 'heal' && m.id === D.id).every(m => m.src === 'bd'),
    `holding Black Death mends (${mend} HP in 1.2 s from ${hurt}, shown as 'bd')`);
  await wait(1300);   // (the shooter's next shot)
  n = D.msgs.length; fire(); await wait(700);
  const blocked = since(D, n, m => m.t === 'hit' && m.target === D.id && m.blocked)[0];
  const healed = since(D, n, m => m.t === 'heal' && m.id === D.id).reduce((a, m) => a + m.amt, 0);
  const want = (blocked?.absorbed ?? 0) * BD.healPerDamage;
  ok(!!blocked && healed >= want - 1, `a blocked hit heals ${Math.round(BD.healPerDamage * 100)}% of what it absorbed (absorbed ${blocked?.absorbed}, healed ${healed} incl. the mend)`);
  D.send({ t: 'block', on: false });
  for (const c of [S, D]) c.ws.close();
  await wait(300);
  await reviewBuffChecks(join, since);
}

// ---- round 16 balance review (Ty approved): Berserker Brew's drink heals and its ×1.5 is on every spell (not just
// potions and pools); Night Cage burns the enemies inside it (cage_burn every CAGE.burn s)
async function reviewBuffChecks(join, since) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const BREW = C.SPELLBOOK.berserker_brew, CAGE = C.SPELLBOOK.night_cage;
  const B = await join('Brewer', { primary: 'fireball', ultimate: 'berserker_brew' }), V = await join('Victim', { primary: 'fireball', ultimate: 'night_cage' });
  B.send({ t: 'matchDebug', size: 2 }); B.send({ t: 'removeBots' }); await wait(600);
  const line = clearLine(10);
  ok(!!line, `a clear line for the review-buff tests (${line ? `${line.a[0]}, ${line.a[2]}` : 'none'})`);
  if (!line) { for (const c of [B, V]) c.ws.close(); return wallWalkChecks(join, since); }
  const at = (d) => [line.a[0] + line.dir[0] * d, 0, line.a[2] + line.dir[1] * d];
  const placeBoth = () => { B.send({ t: 'debugPlace', p: at(0), yaw: line.yaw, resetCd: true }); V.send({ t: 'debugPlace', p: at(8), yaw: line.yaw + Math.PI, resetCd: true }); };
  const fire = (c, a, b) => { const o = [at(a)[0], 1.3, at(a)[2]], tg = [at(b)[0], 1.0, at(b)[2]], d = tg.map((v, i) => v - o[i]), l = Math.hypot(...d);
    c.send({ t: 'cast', kind: 'fireball', origin: o, dir: d.map(v => v / l) }); };
  const hitsOn = (c, n, kind) => since(c, n, m => m.t === 'hit' && m.target === c.id && m.kind === kind && !m.blocked);
  placeBoth(); await wait(2200);   // (past spawn protection)
  let n = V.msgs.length; fire(B, 0, 8); await wait(800);
  const plain = hitsOn(V, n, 'fireball')[0]?.dmg;
  n = B.msgs.length; fire(V, 8, 0); await wait(800); placeBoth(); await wait(200); fire(V, 8, 0); await wait(800);   // hurt the brewer more than the drink heals
  ok(hitsOn(B, n, 'fireball').length === 2, 'the brewer is hurt first (two Fireballs)');
  placeBoth(); await wait(200);
  n = B.msgs.length; B.send({ t: 'debugCharge' }); await wait(80); B.send({ t: 'ult' }); await wait((C.ULT_CHARGE.windup + 0.6) * 1000);
  const drank = since(B, n, m => m.t === 'heal' && m.id === B.id).reduce((a, m) => a + m.amt, 0);
  ok(since(B, n, m => m.t === 'brew' && m.id === B.id).length === 1 && drank >= BREW.heal - 1, `the Brew's drink heals ${BREW.heal} HP (healed ${drank})`);
  B.send({ t: 'debugPlace', p: at(0), yaw: line.yaw, resetCd: true }); await wait(100);
  n = V.msgs.length; fire(B, 0, 8); await wait(800);
  const brewed = hitsOn(V, n, 'fireball')[0]?.dmg;
  ok(plain > 0 && brewed === Math.round(plain * BREW.damageMul), `under the Brew a Fireball (not a potion) does ×${BREW.damageMul} (${plain} → ${brewed})`);
  // Night Cage on the brewer: burns them while they're inside
  await wait(BREW.duration * 1000);   // (the Brew wears off)
  placeBoth(); await wait(200);
  n = B.msgs.length; V.send({ t: 'debugCharge' }); await wait(80); V.send({ t: 'ult', at: [at(0)[0], at(0)[2]] });
  await wait((C.ULT_CHARGE.windup + 2) * 1000);
  const burns = hitsOn(B, n, 'cage_burn'), each = C.D(C.hitSpec('cage_burn').damage);
  ok(since(B, n, m => m.t === 'cage').length === 1 && burns.length >= 3 && burns.every(h => h.attacker === V.id && h.dmg === each),
    `Night Cage burns an enemy inside it every ${CAGE.burn} s (${burns.length} burns of ${burns[0]?.dmg} in 2 s, credited to the caster)`);
  for (const c of [B, V]) c.ws.close();
  await wait(300);
  await cycloneRadiusChecks(join, since);
}

// ---- round 16 (Ty: the Cyclone's area was too big): the spin hits within SPELLBOOK.cyclone.radius (4 m), not at 4.5 m
async function cycloneRadiusChecks(join, since) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const CYC = C.SPELLBOOK.cyclone;
  const S = await join('Spinner', { power: 'cyclone' }), N = await join('Near', { primary: 'spark' }), F = await join('Far', { primary: 'spark' });
  S.send({ t: 'matchDebug', size: 3 }); S.send({ t: 'removeBots' }); await wait(600);
  const line = clearLine(10);
  ok(!!line && CYC.radius === 4, `a clear line for the Cyclone radius test, radius ${CYC.radius} m`);
  if (line) {
    const at = (d) => [line.a[0] + line.dir[0] * d, 0, line.a[2] + line.dir[1] * d];
    S.send({ t: 'debugPlace', p: at(5), yaw: line.yaw, resetCd: true });
    N.send({ t: 'debugPlace', p: at(5 - 3.5), yaw: line.yaw }); F.send({ t: 'debugPlace', p: at(5 + 4.5), yaw: line.yaw + Math.PI });
    await wait(2200);   // (past spawn protection)
    const n = S.msgs.length;
    S.send({ t: 'cyclone' }); await wait((CYC.windup + CYC.spin) * 1000 + 300);
    const hit = (c) => since(S, n, m => m.t === 'hit' && m.target === c.id && m.kind === 'cyclone' && m.dmg > 0).length > 0;
    ok(hit(N), 'the Cyclone hits an enemy 3.5 m away');
    ok(!hit(F), 'and not one 4.5 m away');
  }
  for (const c of [S, N, F]) c.ws.close();
  await wait(300);
  await shearRangeChecks(join, since);
}

// ---- round 16 (Ty: Gale Shear 'needs much more reduced range and damage'): 5.5 m blades. A blade reaches a wizard whose centre
// is within its 5.5 m plus the blade's and the body's radii (6.5-6.9 m). The 3rd, the wider crescent, about 0.35 m further (to 7.25 m).
async function shearRangeChecks(join, since) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const SH = C.SPELLS.shear;
  const G = await join('Gale', { primary: 'gale_shear' }), T = await join('Target', { primary: 'spark' });
  G.send({ t: 'matchDebug', size: 2 }); G.send({ t: 'removeBots' }); await wait(600);
  const line = clearLine(10);
  ok(!!line, 'a clear line for the Gale Shear range test');
  if (line) {
    const at = (d) => [line.a[0] + line.dir[0] * d, 0, line.a[2] + line.dir[1] * d];
    G.send({ t: 'debugPlace', p: at(0), yaw: line.yaw, resetCd: true });
    T.send({ t: 'debugPlace', p: at(4), yaw: line.yaw + Math.PI }); await wait(2200);   // (past spawn protection)
    // one shot (a full magazine each time, so shot 1 is a plain blade and shot 3 the crescent) at a target d m away
    const shot = async (d, fin) => {
      G.send({ t: 'debugPlace', p: at(0), yaw: line.yaw, resetCd: true }); T.send({ t: 'debugPlace', p: at(d), yaw: line.yaw + Math.PI }); await wait(150);
      const o = [at(0)[0], 1.3, at(0)[2]], dir = [line.dir[0], 0, line.dir[1]];
      let n = G.msgs.length;
      if (fin) { const away = [-dir[0], 0, -dir[2]]; for (let k = 0; k < 2; k++) { G.send({ t: 'cast', kind: 'shear', origin: o, dir: away }); await wait(500); } n = G.msgs.length; }
      G.send({ t: 'cast', kind: 'shear', origin: o, dir }); await wait(500);
      const h = since(G, n, m => m.t === 'hit' && m.target === T.id && m.kind === 'shear')[0] || null;
      return h && !!h.fin === fin ? h : null;
    };
    const near = await shot(4.5, false);
    ok(!!near && near.dmg === C.D(SH.damage), `Gale Shear hits at 4.5 m for ${C.D(SH.damage)} (${near?.dmg})`);
    // (6.5 m is the blade's edge: it moves 0.5 m a tick, so it hits there some runs and not others; logged, not checked)
    const reach = {};
    for (const [d, fin] of [[6, false], [6.5, false], [7, false], [6, true], [7, true], [7.5, true]]) reach[`${fin ? 'fin' : 'blade'} ${d}`] = (await shot(d, fin)) ? 'hit' : '-';
    console.log('  (Gale Shear reach)', JSON.stringify(reach));
    ok(reach['blade 6'] === 'hit' && reach['blade 7'] === '-', 'a blade reaches 6 m, not 7 m (was about 9.4 m)');
    ok(reach['fin 6'] === 'hit' && reach['fin 7.5'] === '-', 'the crescent (the 3rd, 0.35 m wider) reaches 6 m, not 7.5 m');
  }
  for (const c of [G, T]) c.ws.close();
  await wait(300);
  await flaskStepChecks(join, since);
}

// ---- round 16 (Ty: 'I teleport and then get killed by someone attacking where I just was'): after Flask Step lands, the
// server has her at the landing spot, even when a position report from before the landing (the old spot) arrives after
// it; a shot at the old spot misses, one at the new spot hits. A throw into a wall lands short of it, the same on both.
async function flaskStepChecks(join, since) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const A = await join('Flasker', { mobility: 'flask_step' }), S = await join('Shooter', { primary: 'spark' });
  S.send({ t: 'matchDebug', size: 2 }); S.send({ t: 'removeBots' }); await wait(600);
  const line = clearLine(26);
  const at = (d, y = 0) => [line.a[0] + line.dir[0] * d, y, line.a[2] + line.dir[1] * d];
  const aim = line && C.flaskLaunch([line.dir[0], 0, line.dir[1]]);
  const pred = line && C.flaskPath(at(8, 1.3), aim);
  const L = pred ? Math.hypot(pred.at[0] - at(8)[0], pred.at[2] - at(8)[2]) : 0;
  ok(!!line && !pred.blocked && L > 6 && L < 17, `a clear line for the Flask Step test (a ${L.toFixed(1)} m throw)`);
  if (!line) { for (const c of [A, S]) c.ws.close(); return wallWalkChecks(join, since); }
  const posOf = (c) => c.msgs.filter(m => m.t === 'snap').pop()?.players.find(q => q.id === c.id)?.p;
  const flask = async (from, dir) => {
    A.send({ t: 'debugPlace', p: from, yaw: Math.atan2(dir[0], dir[2]), resetCd: true }); await wait(150);
    const n = A.msgs.length; A.send({ t: 'flaskStep', dir });
    for (let k = 0; k < 40 && !since(A, n, m => m.t === 'flaskArrive' && m.id === A.id).length; k++) await wait(50);
    return since(A, n, m => m.t === 'flaskArrive' && m.id === A.id)[0];
  };
  const shoot = (tg) => { const o = at(0, 1.3), d = tg.map((v, i) => v - o[i]), l = Math.hypot(...d); S.send({ t: 'cast', kind: 'fast', origin: o, dir: d.map(v => v / l) }); };
  const sparkHits = (n) => since(S, n, m => m.t === 'hit' && m.target === A.id && m.kind === 'fast').length;
  S.send({ t: 'debugPlace', p: at(0), yaw: line.yaw, resetCd: true });
  A.send({ t: 'debugPlace', p: at(8), yaw: line.yaw }); await wait(2200);   // (past spawn protection)
  const old = at(8);
  const arr = await flask(old, aim);
  ok(!!arr && typeof arr.seq === 'number' && Math.hypot(arr.to[0] - pred.at[0], arr.to[2] - pred.at[2]) < 0.6,
    `Flask Step lands where the throw predicted, with a teleport seq (${arr ? arr.to.map(v => v.toFixed(1)).join(', ') : 'none'}; seq ${arr?.seq})`);
  if (arr) {
    // the race: a report sent just before the client heard of the landing (the old spot, the old seq) arrives after it
    A.send({ t: 'state', p: old, yaw: line.yaw, tp: arr.seq - 1 }); await wait(60);
    A.send({ t: 'state', p: arr.to, yaw: line.yaw, tp: arr.seq }); await wait(200);
    const p = posOf(A);
    ok(!!p && Math.hypot(p[0] - arr.to[0], p[2] - arr.to[2]) < 0.2, `a report from before the landing doesn't put her back (server at ${p ? Math.hypot(p[0] - old[0], p[2] - old[2]).toFixed(1) : '?'} m from the old spot)`);
    let n = S.msgs.length; shoot([old[0], 0.2, old[2]]); await wait(900);   // (low: it ends in the ground there)
    ok(sparkHits(n) === 0, 'a Spark at her old spot misses');
    S.send({ t: 'debugPlace', p: at(0), yaw: line.yaw, resetCd: true }); await wait(100);
    n = S.msgs.length; shoot([arr.to[0], (arr.to[1] || 0) + 1.0, arr.to[2]]); await wait(1200);
    ok(sparkHits(n) === 1, 'a Spark at where she landed hits');
  }
  // into a wall: from open ground, a level throw that a wall stops within 8 m
  let wall = null;
  for (let x = -24; x <= 24 && !wall; x += 1) for (let z = -24; z <= 24 && !wall; z += 1) {
    if (C.topFloorAt(x, z) > 0.05 || C.surfaceSolidAt(x, 0.5, z, true) || !(C.insideArena ? C.insideArena(x, z, 1.5) : true)) continue;
    for (let a = 0; a < 8 && !wall; a++) {
      const yaw = a * Math.PI / 4, dir = C.flaskLaunch([Math.sin(yaw), 0, Math.cos(yaw)]), r = C.flaskPath([x, 1.3, z], dir);
      if (r.blocked && Math.hypot(r.at[0] - x, r.at[2] - z) > 2 && Math.hypot(r.at[0] - x, r.at[2] - z) < 8) wall = { from: [x, 0, z], dir, r };
    }
  }
  ok(!!wall, `a throw into a wall for the clamp test (${wall ? wall.from.join(', ') : 'none'})`);
  if (wall) {
    const arr2 = await flask(wall.from, wall.dir);   // (debugPlace's resetCd: no cooldown wait)
    await wait(250);
    const p = posOf(A), to = arr2?.to;
    ok(!!to && Math.hypot(to[0] - wall.r.at[0], to[2] - wall.r.at[2]) < 0.6 && !C.surfaceSolidAt(to[0], (to[1] || 0) + 0.5, to[2], true),
      `a throw into a wall lands short of it, out of anything solid, where the client predicts (${to ? to.map(v => v.toFixed(1)).join(', ') : 'none'})`);
    ok(!!p && !!to && Math.hypot(p[0] - to[0], p[2] - to[2]) < 0.2, 'and the server has her there');
  }
  for (const c of [A, S]) c.ws.close();
  await wait(300);
  await wallWalkChecks(join, since);
}

// ---- round 15 (Ty: spells cast on the wall-walk fell to the ground below it): cast from up on the wall-walk, Glacial Skim
// travels and Smoke Flask, Frostfall, Toxic Flask and Firewall land at the wall-walk's height, not y 0
async function wallWalkChecks(join, since) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  // an 8 m straight stretch of wall-walk (a standable top 2.5 m up or more, the same height all along, nothing solid on it)
  let walk = null;
  for (let x = -26; x <= 26 && !walk; x += 0.5) for (let z = -26; z <= 26 && !walk; z += 0.5) for (const [dx, dz] of [[1, 0], [0, 1]]) {
    const y = C.topFloorAt(x, z);
    if (y < 2.5) continue;
    let ok2 = true;
    for (let k = 0; k <= 8 && ok2; k += 0.5) for (const s of [-0.7, 0, 0.7]) {
      const px = x + dx * k + dz * s, pz = z + dz * k + dx * s;
      if (Math.abs(C.topFloorAt(px, pz) - y) > 0.05 || Math.abs(C.surfaceHeight(px, pz, y) - y) > 0.05 || C.surfaceSolidAt(px, y + 0.5, pz, true) || C.surfaceSolidAt(px, y + 1.6, pz, true)) ok2 = false;
    }
    if (ok2) walk = { x, z, y, dir: [dx, dz], yaw: Math.atan2(dx, dz) };
  }
  ok(!!walk, `an 8 m stretch of wall-walk for the height checks (${walk ? `${walk.x}, ${walk.z} at ${walk.y.toFixed(2)} m` : 'none'})`);
  if (!walk) return;
  const at = (k) => [walk.x + walk.dir[0] * k, walk.y, walk.z + walk.dir[1] * k];
  const A = await join('UpA', { primary: 'glacial_skim', power: 'frostfall', guard: 'smoke_flask', utility: 'telekinesis' });
  const B = await join('UpB', { primary: 'spark', power: 'toxic_flask', guard: 'firewall', utility: 'telekinesis' });
  A.send({ t: 'matchDebug', size: 2 }); A.send({ t: 'removeBots' }); await wait(600);
  A.send({ t: 'debugPlace', p: at(0), yaw: walk.yaw, resetCd: true }); B.send({ t: 'debugPlace', p: at(1.5), yaw: walk.yaw, resetCd: true });
  await wait(1600);
  const near = (y) => Math.abs(y - walk.y) < 0.6;
  let n = A.msgs.length;
  A.send({ t: 'cast', kind: 'skim', origin: [at(0)[0], walk.y + 1.3, at(0)[2]], dir: [walk.dir[0], 0, walk.dir[1]] }); await wait(200);
  const shard = since(A, n, m => m.t === 'proj' && m.owner === A.id && m.kind === 'skim')[0];
  const shardEnd = since(A, n, m => m.t === 'projEnd' && m.id === shard?.id)[0];
  ok(!!shard && shard.p[1] > walk.y && shard.p[1] < walk.y + 1, `Glacial Skim skims the wall-walk (shards at ${shard?.p[1]?.toFixed(2)} m)`);
  // (the toxic lob first: an enemy's Smoke Flask cloud swallows it)
  n = B.msgs.length; const ta = at(7.5), o = [at(1.5)[0], walk.y + 1.3, at(1.5)[2]];
  B.send({ t: 'toxic', origin: o, dir: [walk.dir[0], 0.3, walk.dir[1]], target: [ta[0], walk.y, ta[2]] }); await wait(1500);
  const pool = since(B, n, m => m.t === 'pool' && m.owner === B.id)[0];
  ok(!!pool && near(pool.p[1]), `Toxic Flask's pool spreads on the wall-walk (${pool?.p?.[1]?.toFixed(2)} m)`);
  n = A.msgs.length; A.send({ t: 'smokeFlask' }); await wait(150);
  const sf = since(A, n, m => m.t === 'smokeFlask' && m.owner === A.id)[0];
  ok(!!sf && near(sf.p[1]), `Smoke Flask's cloud sits on the wall-walk (${sf?.p?.[1]?.toFixed(2)} m)`);
  n = A.msgs.length; const fa = at(7); A.send({ t: 'frostfall', at: [fa[0], fa[2]] }); await wait(150);
  const ff = since(A, n, m => m.t === 'frostfall' && m.owner === A.id)[0];
  ok(!!ff && near(ff.p[1]), `Frostfall lands on the wall-walk (${ff?.p?.[1]?.toFixed(2)} m)`);
  n = B.msgs.length; B.send({ t: 'firewall', yaw: walk.yaw }); await wait(150);
  const fw = since(B, n, m => m.t === 'firewall' && m.owner === B.id)[0];
  ok(!!fw && near(fw.y), `Firewall stands on the wall-walk (${fw?.y?.toFixed(2)} m)`);
  for (const c of [A, B]) c.ws.close();
  await wait(300);
  await siphonChecks(join, since);
}

// ---- round 24: the drawbridge against the real server (a test drawbridge at environment's hinge on Sky Ruins, the cycle moved with
// debugMap drawbridgePhase): a wizard standing on the slab is carried up as it rises (the server's height matches the shared helper's),
// its slide at the shared curve's speed passes the speed check, past 45° it drops into the void (nobody credited); up, the slab is a wall
// (a wizard walking out of the gate is held, a Spark stops at it)
async function drawbridgeChecks(join, since) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  if (!C.MAPS?.sky) { ok(true, '(no Sky Ruins: the drawbridge server checks skipped)'); return; }
  // (a private room of their own: the public rooms still hold earlier checks' players and bots, whose shots and knockbacks spoil a placement)
  const A = await join('Bridge', { utility: 'telekinesis' }, 'new'), B = await join('Gate', { utility: 'telekinesis' }, A.room?.code);
  ok(!!A.room?.code && B.room?.id === A.room?.id, `the drawbridge testers share a private room (${A.room?.id}, ${B.room?.id})`);
  A.send({ t: 'matchDebug', size: 2, countdown: 1, map: 'sky' }); A.send({ t: 'removeBots' });
  for (let i = 0; i < 40 && !A.msgs.some(m => m.t === 'map' && m.map?.id === 'sky'); i++) await wait(100);
  ok(A.msgs.some(m => m.t === 'map' && m.map?.id === 'sky'), 'the drawbridge test room is on Sky Ruins');
  // (the match goes live on it: the countdown roots everyone and its end respawns them, which would undo a placement)
  for (let i = 0; i < 60 && ![A, B].every(c => c.msgs.some(m => m.t === 'matchPhase' && m.match?.phase === 'live' && m.match?.map?.id === 'sky')); i++) await wait(100);
  await wait(300);
  const H = { id: 'db-srv', x: 16, y: 6, z: 0, dir: [1, 0], yaw: Math.PI / 2, w: 3.4, d: 7.2 };
  let n = A.msgs.length;
  A.send({ t: 'debugMap', drawbridges: [H], drawbridgePhase: 11, void: 1 }); await wait(250);
  const mm = since(A, n, m => m.t === 'map').pop();
  ok(mm?.drawbridges?.[0]?.id === 'db-srv' && Number.isFinite(mm.drawbridges[0].t0), `debugMap: the map message carries the test drawbridge and the cycle's origin (t0 ${mm?.drawbridges?.[0]?.t0?.toFixed(2)})`);
  C.DRAWBRIDGE.t0 = mm?.drawbridges?.[0]?.t0 ?? 0;
  C.setDrawbridges([H]);   // (our own copy of the helper poses the same test slab: the layout's own drawbridge is replaced, as on the server)
  const snapOf = (c) => { const sn = c.msgs.filter(m => m.t === 'snap').pop(); return sn ? { time: sn.time, me: sn.players.find(q => q.id === c.id) } : null; };
  // A stands 5.5 m up the slab (x 21.5) while it's down; B on the apron behind the gate
  A.send({ t: 'debugPlace', p: [21.5, 6, 0], yaw: -Math.PI / 2 }); B.send({ t: 'debugPlace', p: [14.6, 6, 0], yaw: Math.PI / 2 }); await wait(250);
  const s0 = snapOf(A);
  ok(s0?.me && Math.abs(s0.me.p[1] - 6) < 0.05 && Math.abs(s0.me.p[0] - 21.5) < 0.05, `down: A stands on the slab over the gap at 6 m (${s0?.me?.p.map(v => v.toFixed(2))})`);
  // through the rise, reporting the height the snapshots give us (a client does its own, from the same helper), and from about 17° the
  // slide toward the hinge at the shared curve's speed: the server lifts us with the slab and lets the slide through
  let lastY = 6, x = 21.5, slid = 0, rejected = 0; const diffs = [];
  for (let i = 0; i < 80; i++) {
    const sn = snapOf(A);
    if (sn?.me) { lastY = sn.me.p[1]; const sv = C.drawbridgeSlide(C.drawbridgeAngle(sn.time)); if (sv > 0) { x -= sv * 0.05; slid += sv * 0.05; } }
    A.send({ t: 'state', p: [x, lastY, 0], yaw: -Math.PI / 2 }); await wait(50);
    if (sn?.me) { C.updateDrawbridges(sn.time); diffs.push(Math.abs(sn.me.p[1] - C.surfaceHeight(sn.me.p[0], 0, 99))); if (Math.abs(sn.me.p[0] - x) > 0.6) rejected++; }
    if (sn && C.drawbridgePhase(sn.time).at > 14.05) break;
  }
  const s1 = snapOf(A), worst = Math.max(...diffs.slice(6));
  ok(s1.me.p[1] > 8.3 && worst < 0.45, `rising: the server carried A up to ${s1.me.p[1].toFixed(2)} m; its height matches the shared helper's (worst ${worst.toFixed(2)} m over ${diffs.length} snapshots)`);
  ok(slid > 1.2 && rejected === 0 && Math.abs(s1.me.p[0] - x) < 0.6, `the slide toward the hinge (${slid.toFixed(2)} m reported at the shared curve's speed) passes the speed check (server x ${s1.me.p[0].toFixed(2)}, ours ${x.toFixed(2)})`);
  // past 45° the slab holds nobody: standing still now, A drops off the tilted slab into the void
  n = A.msgs.length;
  for (let i = 0; i < 70 && !since(A, n, m => m.t === 'death' && m.id === A.id).length; i++) { const sn = snapOf(A); if (sn?.me) lastY = sn.me.p[1]; A.send({ t: 'state', p: [x, lastY, 0], yaw: -Math.PI / 2 }); await wait(50); }
  const d = since(A, n, m => m.t === 'death' && m.id === A.id)[0];
  ok(d && d.cause === 'void' && (d.killer == null || d.killer === A.id), `past 45° A dropped and died in the void, nobody credited (${d?.cause}, killer ${d?.killer})`);
  // up (80°): a wall across the island's edge: B can't walk out onto it, and a Spark from the gate stops at it
  A.send({ t: 'debugMap', drawbridgePhase: 18 }); await wait(200);
  // (like a client: each report steps on from where the server last had us, so a push-back holds)
  for (let i = 0; i < 24; i++) { const sn = snapOf(B); const bx = Math.min(17.5, (sn?.me?.p[0] ?? 14.6) + 0.15); B.send({ t: 'state', p: [bx, 6, 0], yaw: Math.PI / 2 }); await wait(50); }
  const sb = snapOf(B);
  ok(sb.me.p[0] < 16.1 && sb.me.p[0] > 15.2 && Math.abs(sb.me.p[1] - 6) < 0.05, `up: B walking out of the gate is held on the apron (x ${sb.me.p[0].toFixed(2)}, y ${sb.me.p[1].toFixed(2)})`);
  n = B.msgs.length;
  B.send({ t: 'cast', kind: 'fast', origin: [sb.me.p[0], 7.3, 0], dir: [1, 0, 0] }); await wait(700);
  const pj = since(B, n, m => m.t === 'proj' && m.owner === B.id)[0], pe = pj && since(B, n, m => m.t === 'projEnd' && m.id === pj.id)[0];
  ok(pe && pe.hit && pe.p[0] < 17.6 && pe.p[0] > 15.5, `a Spark from the gate stops at the raised slab (hit at x ${pe?.p?.[0]?.toFixed(2)})`);
  A.send({ t: 'debugMap', drawbridges: [], drawbridgePhase: 0 }); await wait(150);
  C.DRAWBRIDGE.t0 = 0; C.setDrawbridges([]);
  for (const c of [A, B]) c.ws.close();
  await wait(300);
}

// ---- round 24b: throwables on Sky Ruins (PROP_SPAWNS [type, x, z, y]): props stand on their floor, lift and throw from it and hit, a
// prop set down over the void or thrown off an island breaks and comes back at its spawn (home), on its floor
async function skyPropChecks(join, since) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  if (!C.MAPS?.sky) { ok(true, '(no Sky Ruins: the prop checks skipped)'); return; }
  const had = C.ACTIVE_MAP.name; C.setActiveMap('sky');
  const spawns = C.PROP_SPAWNS.map(([type, x, z, y], i) => ({ id: i + 1, type, x, z, y }));
  if (had) C.setActiveMap(had);
  const A = await join('Lifter', { utility: 'telekinesis' }, 'new'), B = await join('Target', { utility: 'telekinesis' }, A.room?.code);
  A.send({ t: 'matchDebug', size: 2, countdown: 1, map: 'sky' }); A.send({ t: 'removeBots' });
  for (let i = 0; i < 60 && ![A, B].every(c => c.msgs.some(m => m.t === 'matchPhase' && m.match?.phase === 'live' && m.match?.map?.id === 'sky')); i++) await wait(100);
  await wait(300);
  const mapMsg = A.msgs.filter(m => m.t === 'map' && m.map?.id === 'sky').pop();
  const raised = (mapMsg?.props || []).filter(q => q.y > 1);
  ok(spawns.length >= 10 && raised.length === spawns.length && raised.every(q => Math.abs(q.y - spawns[q.id - 1].y) < 1e-6),
    `Sky Ruins' props stand on their floors in the map message (${raised.length}/${spawns.length} raised; ${[...new Set(raised.map(q => +q.y.toFixed(2)))].join(', ')} m)`);
  const isl = (q) => spawns.find(s => s.id === q);
  // three props on the north island (floor 6): the crate to throw at B, the keg to set down over the edge, the barrel to throw off the island
  const crate = spawns.find(s => s.y === 6 && s.z > 24 && s.type === 'crate'), keg = spawns.find(s => s.y === 6 && s.z > 24 && s.type === 'keg'), barrel = spawns.find(s => s.y === 6 && s.z > 30 && s.type === 'barrel');
  if (!crate || !keg || !barrel) { ok(false, `north-island props for the checks (${!!crate} ${!!keg} ${!!barrel})`); for (const c of [A, B]) c.ws.close(); return; }
  const propOf = () => { const st = new Map(); for (const m of A.msgs) { if (m.t === 'map') for (const q of m.props || []) st.set(q.id, q); if (m.t === 'prop') st.set(m.prop.id, m.prop); if (m.t === 'propBreak') st.set(m.id, { ...(st.get(m.id) || {}), state: 'broken' }); } return st; };
  const place = (c, x, z, yaw) => c.send({ t: 'debugPlace', p: [x, 6, z], yaw, resetCd: true });
  const lift = async (c, pr) => {
    const me = [pr.lx, 6, pr.lz], from = [me[0], 6 + 1.3, me[2]], ctr = [pr.x, pr.y + C.PROP_TYPES[pr.type].h * 0.5, pr.z];
    c.send({ t: 'pickup', aimOrigin: from, aimDir: [ctr[0] - from[0], ctr[1] - from[1], ctr[2] - from[2]] }); await wait(500);
    return propOf().get(pr.id)?.state;
  };
  // 1. lift the crate from 2.5 m south of it, throw it at B (on the island 3.5 m north of A): a hit. (B stands 1.5 m short of the
  // layout's wall_half at (4.3, 35.8): at z 36 the crate met B's hit sphere and that wall within one tick, and on a loaded machine
  // (a longer tick) the wall won: 'breaks at (4.1, 7.2, 34.9) with no hit')
  place(A, crate.x, crate.z + 2.5, Math.PI); place(B, crate.x + 0.5, crate.z + 6, Math.PI); await wait(300);
  const st1 = await lift(A, { ...crate, lx: crate.x, lz: crate.z + 2.5 });
  ok(st1 === 'carried', `Telekinesis lifts the crate from the island's floor at 6 m (${st1})`);
  A.send({ t: 'debugPlace', p: [crate.x, 6, crate.z + 2.5], yaw: 0 }); await wait(250);   // (turned round to face B)
  let n = A.msgs.length;
  A.send({ t: 'throw', target: [crate.x + 0.5, 6 + C.HIT_CENTER_Y, crate.z + 6] }); await wait(800);
  const hit = since(A, n, m => m.t === 'hit' && m.target === B.id && m.kind === 'prop')[0], br1 = since(A, n, m => m.t === 'propBreak' && m.id === crate.id)[0];
  ok(!!hit && hit.dmg > 0 && hit.target === B.id && !!br1 && br1.p[1] > 5, `the thrown crate hits B up on the island and breaks there (${hit?.dmg} damage, broke at y ${br1?.p?.[1]?.toFixed(2)})`);
  // 2. the keg: set down over the island's west edge (x -10): it falls away (broken), to be back at home
  place(A, keg.x - 2.5, keg.z, Math.PI / 2); await wait(300);
  const st2 = await lift(A, { ...keg, lx: keg.x - 2.5, lz: keg.z });
  A.send({ t: 'debugPlace', p: [-9.4, 6, 30], yaw: -Math.PI / 2 }); await wait(300);
  n = A.msgs.length; A.send({ t: 'drop' }); await wait(300);
  const br2 = since(A, n, m => m.t === 'propBreak' && m.id === keg.id)[0];
  ok(st2 === 'carried' && !!br2 && !since(A, n, m => m.t === 'prop' && m.prop.id === keg.id && m.prop.state === 'idle').length, `the keg set down over the void edge breaks instead of resting on the cloud (${st2}, broke at ${br2?.p?.map(v => v.toFixed(1))})`);
  // 3. the barrel: set down on the island elsewhere (it rests there, on the floor), lifted again and thrown off the island to the west
  place(A, barrel.x + 2.5, barrel.z, -Math.PI / 2); await wait(300);
  const st3 = await lift(A, { ...barrel, lx: barrel.x + 2.5, lz: barrel.z });
  n = A.msgs.length; A.send({ t: 'drop' }); await wait(300);
  const rest = since(A, n, m => m.t === 'prop' && m.prop.id === barrel.id && m.prop.state === 'idle').pop()?.prop;
  ok(st3 === 'carried' && rest && Math.abs(rest.y - 6) < 0.05 && Math.hypot(rest.x - barrel.x, rest.z - barrel.z) > 0.5, `set down on the island it rests on the floor there (${rest?.x?.toFixed(1)}, ${rest?.y?.toFixed(2)}, ${rest?.z?.toFixed(1)})`);
  const re = { ...barrel, x: rest?.x ?? barrel.x, z: rest?.z ?? barrel.z };
  place(A, re.x + 2.5, re.z, -Math.PI / 2); await wait(300);
  const st4 = await lift(A, { ...re, lx: re.x + 2.5, lz: re.z });
  A.send({ t: 'debugPlace', p: [-8.8, 6, re.z], yaw: -Math.PI / 2 }); await wait(250);
  n = A.msgs.length; A.send({ t: 'throw', dir: [-1, 0.25, 0] }); await wait(2500);
  const br4 = since(A, n, m => m.t === 'propBreak' && m.id === barrel.id)[0];
  const hadM = C.ACTIVE_MAP.name; C.setActiveMap('sky');
  const offIsland = !!br4 && C.surfaceHeight(br4.p[0], br4.p[2], br4.p[1]) < C.voidY();
  if (hadM) C.setActiveMap(hadM);
  ok(st4 === 'carried' && offIsland, `thrown off the island to the west it breaks out over the void (at ${br4?.p?.map(v => v.toFixed(1))})`);
  // 4. both come back at home on their floor (PROP_RESPAWN_TIME, 18 s); the crate where it was lifted from (its home too)
  await wait((C.PROP_RESPAWN_TIME + 1.2) * 1000);
  const S = propOf(), k = S.get(keg.id), b = S.get(barrel.id), c = S.get(crate.id);
  ok(k?.state === 'idle' && Math.hypot(k.x - keg.x, k.z - keg.z) < 0.01 && Math.abs(k.y - 6) < 0.01, `the keg is back at home on the island floor (${k?.state} at ${k?.x}, ${k?.y}, ${k?.z})`);
  ok(b?.state === 'idle' && Math.hypot(b.x - barrel.x, b.z - barrel.z) < 0.01 && Math.abs(b.y - 6) < 0.01, `the barrel thrown off the island is back at home, not where it was last set down (${b?.state} at ${b?.x}, ${b?.y}, ${b?.z})`);
  ok(c?.state === 'idle' && Math.abs(c.y - 6) < 0.01, `the crate is back on its floor (${c?.state} at y ${c?.y})`);
  for (const q of [A, B]) q.ws.close();
  await wait(300);
}

// ---- round 16: Blood Siphon (the Lash's id): a 0.35 s cast, a bolt that heals its caster for half its damage; a miss costs nothing
async function siphonChecks(join, since) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const SI = C.SPELLBOOK.sanguine_lash;
  const S = await join('Siphoner', { power: 'sanguine_lash', utility: 'telekinesis' }), T = await join('Bleeder', { primary: 'fireball', utility: 'telekinesis' });
  S.send({ t: 'matchDebug', size: 2 }); S.send({ t: 'removeBots' }); await wait(600);
  const line = clearLine(12);
  ok(!!line, `a clear line for the Siphon test (${line ? `${line.a[0]}, ${line.a[2]}` : 'none'})`);
  if (!line) { for (const c of [S, T]) c.ws.close(); return; }
  const at = (d) => [line.a[0] + line.dir[0] * d, 0, line.a[2] + line.dir[1] * d];
  S.send({ t: 'debugPlace', p: at(0), yaw: line.yaw, resetCd: true }); T.send({ t: 'debugPlace', p: at(10), yaw: line.yaw + Math.PI, resetCd: true });
  await wait(2200);
  const toward = (from, to) => { const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]], l = Math.hypot(...d); return d.map(v => v / l); };
  // the bleeder hurts the siphoner first, so there's something to heal
  T.send({ t: 'cast', kind: 'fireball', origin: [at(10)[0], 1.3, at(10)[2]], dir: toward([at(10)[0], 1.3, at(10)[2]], [at(0)[0], 1.0, at(0)[2]]) }); await wait(800);
  let n = S.msgs.length;
  S.send({ t: 'siphonStart' }); await wait(SI.castTime * 1000 + 40);
  S.send({ t: 'siphonRelease', origin: [at(0)[0], 1.3, at(0)[2]], dir: toward([at(0)[0], 1.3, at(0)[2]], [at(10)[0], 1.0, at(10)[2]]) }); await wait(700);
  const hit = since(S, n, m => m.t === 'hit' && m.attacker === S.id && m.kind === 'siphon')[0];
  const healed = since(S, n, m => m.t === 'heal' && m.id === S.id && m.src === 'siphon').reduce((a, m) => a + m.amt, 0);
  ok(!!hit && hit.dmg >= 28 && Math.abs(healed - hit.dmg * SI.heal) <= 1.01, `a Siphon hit heals its caster ${Math.round(SI.heal * 100)}% of the damage (${hit?.dmg} dealt, ${healed} healed)`);
  ok(!since(S, n, m => m.t === 'siphonStart' && m.id === S.id).length || !S.msgs.slice(n).some(m => m.t === 'snap' && m.players.find(q => q.id === S.id)?.rooted),
    'the cast never roots');
  // a miss: fired at nothing. No root, no recovery: moving and casting right away work
  S.send({ t: 'debugPlace', p: at(0), yaw: line.yaw + Math.PI / 2, resetCd: true }); await wait(150);
  n = S.msgs.length;
  S.send({ t: 'siphonStart' }); await wait(SI.castTime * 1000 + 40);
  S.send({ t: 'siphonRelease', origin: [at(0)[0], 1.3, at(0)[2]], dir: [Math.sin(line.yaw + Math.PI / 2), 0, Math.cos(line.yaw + Math.PI / 2)] }); await wait(1000);
  const me = S.msgs.filter(m => m.t === 'snap').pop()?.players.find(q => q.id === S.id);
  ok(!since(S, n, m => m.t === 'hit' && m.attacker === S.id).length && !since(S, n, m => m.t === 'lashMiss').length && me && !me.rooted && !me.bound,
    `a miss costs nothing (rooted ${me?.rooted}, bound ${me?.bound})`);
  for (const c of [S, T]) c.ws.close();
  await wait(300);
  await respawnChecks(join, since);
}

// ---- round 16: the Esc menu's Respawn button ({ t: 'respawnNow', loadout })
async function respawnChecks(join, since) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const R = C.RESPAWN_NOW;
  const P = await join('Respawner', { primary: 'spark', utility: 'telekinesis' }), K = await join('Hitter', { primary: 'fireball', utility: 'telekinesis' });
  P.send({ t: 'matchDebug', size: 2 }); P.send({ t: 'removeBots' }); await wait(600);
  const line = clearLine(10);
  if (!line) { ok(false, 'a clear line for the respawn test'); for (const c of [P, K]) c.ws.close(); return; }
  const at = (d) => [line.a[0] + line.dir[0] * d, 0, line.a[2] + line.dir[1] * d];
  P.send({ t: 'debugPlace', p: at(0), yaw: line.yaw, resetCd: true }); K.send({ t: 'debugPlace', p: at(9), yaw: line.yaw + Math.PI, resetCd: true });
  await wait(2200);
  const snapOf = (c) => c.msgs.filter(m => m.t === 'snap').pop()?.players.find(q => q.id === c.id);
  // safe: not hurt for 5 s. Instant, no death, the new loadout applied
  const newLo = { ...C.DEFAULT_LOADOUT, primary: 'hex_shards', utility: 'telekinesis' };
  let n = P.msgs.length;
  const deaths0 = snapOf(P)?.deaths ?? 0;
  P.send({ t: 'respawnNow', loadout: newLo }); await wait(300);
  ok(since(P, n, m => m.t === 'respawn' && m.id === P.id).length === 1 && !since(P, n, m => m.t === 'death' && m.id === P.id).length
    && (snapOf(P)?.deaths ?? 0) === deaths0 && snapOf(P)?.loadout?.primary === 'hex_shards', 'a safe respawn: instant, no death counted, the new loadout on');
  // spam: again at once is refused
  n = P.msgs.length;
  P.send({ t: 'respawnNow', loadout: newLo }); await wait(200);
  ok(!since(P, n, m => m.t === 'respawn' && m.id === P.id).length && since(P, n, m => m.t === 'respawnNowRefused').length === 1, `a second one within ${R.cooldown} s is refused`);
  // hurt: the hitter lands a fireball; then a respawn counts as a death, credited to the hitter
  await wait(R.cooldown * 1000 + 100);
  // (back on the clear line: the safe respawn put us at a spawn, maybe behind cover)
  const pp = at(0), kp = at(7);
  P.send({ t: 'debugPlace', p: pp, yaw: line.yaw }); K.send({ t: 'debugPlace', p: kp, yaw: line.yaw + Math.PI, resetCd: true }); await wait(1700);
  const o = [kp[0], kp[1] + 1.3, kp[2]], d = [pp[0] - o[0], pp[1] + 1 - o[1], pp[2] - o[2]], l = Math.hypot(...d);
  n = P.msgs.length;
  K.send({ t: 'cast', kind: 'fireball', origin: o, dir: d.map(v => v / l) }); await wait(600);
  const hurt = since(P, n, m => m.t === 'hit' && m.target === P.id && m.dmg > 0).length > 0;
  const kills0 = snapOf(K)?.kills ?? 0;
  n = P.msgs.length;
  P.send({ t: 'respawnNow', loadout: newLo }); await wait(300);
  const death = since(P, n, m => m.t === 'death' && m.id === P.id)[0];
  ok(hurt && !!death && death.killer === K.id && death.cause === 'respawn', `a hurt respawn is a death credited to the last attacker (hit ${hurt}, killer ${death?.killer === K.id ? 'the hitter' : death?.killer})`);
  await wait(300);
  ok((snapOf(K)?.kills ?? 0) === kills0 + 1, `and the attacker gets the kill (${kills0} → ${snapOf(K)?.kills})`);
  for (const c of [P, K]) c.ws.close();
  await wait(300);
  await idleChecks(join, since);
}

// ---- after round 16: idle players. No input for C.IDLE.spectate s: they watch and a bot plays; any input seats them again;
// C.IDLE.kick s: disconnected. (debugIdle shortens the times to 1.5 / 3 / 5 s on this test server.)
async function idleChecks(join, since) {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const H = await join('Idler', { utility: 'telekinesis' });
  let closed = false; H.ws.on('close', () => { closed = true; });
  H.send({ t: 'matchDebug', size: 2 }); H.send({ t: 'debugIdle', spectate: 1.5, waiting: 3, kick: 5 }); H.send({ t: 'activity' });
  await wait(1200);
  const me = () => H.msgs.filter(m => m.t === 'snap').pop()?.players.find(q => q.id === H.id);
  const fightersNow = () => (H.msgs.filter(m => m.t === 'snap').pop()?.players || []).filter(q => !q.spectator).length;
  ok(!me()?.spectator, 'a player who just did something is playing');
  let n = H.msgs.length;
  await wait(2500);   // idle past 1.5 s
  ok(since(H, n, m => m.t === 'idle' && m.on).length === 1 && !!me()?.spectator, 'idle: they watch instead (told so)');
  await wait(1200);
  ok(fightersNow() === 2 && (H.msgs.filter(m => m.t === 'snap').pop()?.players || []).some(q => q.bot && !q.spectator), `and a bot takes the place (${fightersNow()} fighters)`);
  n = H.msgs.length;
  H.send({ t: 'activity' }); await wait(1500);
  ok(since(H, n, m => m.t === 'idle' && !m.on).length === 1 && !me()?.spectator && since(H, n, m => m.t === 'respawn' && m.id === H.id).length >= 1,
    'any input seats them again (a bot makes way)');
  n = H.msgs.length;
  await wait(5600);   // past the 5 s kick
  ok(since(H, n, m => m.t === 'kicked' && m.reason === 'inactivity').length === 1 && closed, `idle long enough: disconnected for inactivity (closed ${closed})`);
}


// ---- round 17: rooms. Public matchmaking fills one room before opening a second; private rooms by code ('new', a code, an
// unknown or full code falls back to a public room); two rooms are isolated (no snapshots, hits, projectiles or kill feed
// crossing); bots are per room; the host's bot difficulty; empty rooms are deleted (ROOM_EMPTY_TTL=2 on this test server).
async function roomChecks() {
  const { spawn } = await import('node:child_process');
  const { default: WebSocket } = await import('ws');
  const port = 4192, root = new URL('../../', import.meta.url).pathname;
  const srv = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), MATCH_DEBUG: '1', ROOM_EMPTY_TTL: '2' }, stdio: ['ignore', 'pipe', 'inherit'] });
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const health = async () => (await (await fetch(`http://localhost:${port}/healthz`)).text());
  const roomsNow = async () => +(/rooms=(\d+)/.exec(await health())?.[1] ?? -1);
  try {
    await new Promise((res, rej) => { srv.stdout.on('data', d => { if (/listening/.test(d)) res(); }); srv.on('exit', () => rej(new Error('server exited'))); });
    const join = async (name, room) => {
      const ws = new WebSocket(`ws://localhost:${port}`);
      const c = { ws, name, msgs: [], id: null, welcome: null, room: null, send: (m) => ws.send(JSON.stringify(m)) };
      ws.on('message', raw => { const m = JSON.parse(raw); if (m.t === 'welcome') { c.id = m.id; c.welcome = m; c.room = m.room; } if (m.t === 'room') c.room = m.room; c.msgs.push(m); });
      await new Promise(r => ws.on('open', r));
      c.send({ t: 'join', name, room, difficulty: 'easy' });
      while (c.id == null) await wait(10);
      return c;
    };
    const close = async (...cs) => { for (const c of cs) c.ws.close(); await wait(300); };
    ok(/^ok rooms=0\b/.test(await health()), `/healthz reports the room count (${await health()})`);

    // public matchmaking
    const P = [];
    for (let i = 0; i < 4; i++) P.push(await join('Pub' + i));
    ok(P.every(c => c.room.id === P[0].room.id && !c.room.private && c.room.code === null), `four plain joins share one public room (${P.map(c => c.room.id).join(' ')})`);
    ok(P[0].room.humans === 4 && P[0].room.joinable === false, `the room message counts them (${P[0].room.humans}/4, joinable ${P[0].room.joinable})`);
    const P5 = await join('Pub4');
    ok(P5.room.id !== P[0].room.id && !P5.room.private, `a 5th opens a second public room (${P5.room.id})`);
    await close(P[3]);
    const P6 = await join('Pub5');
    ok(P6.room.id === P[0].room.id, `a free seat in the fuller room is taken before the emptier one (${P6.room.id})`);
    await close(...P.slice(0, 3), P5, P6);

    // private rooms
    const A1 = await join('Ann', 'new');
    const code = A1.room.code;
    ok(A1.room.private && /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/.test(code) && A1.room.id === code && A1.room.host === A1.id,
      `'new' makes a private room with a 4-character code, its creator the host (${code})`);
    const A2 = await join('Ben', code.toLowerCase());
    ok(A2.room.id === code && A2.welcome.players.some(q => q.id === A1.id) && !A2.welcome.roomError, 'joining by code (any case) lands in that room with its creator');
    const B1 = await join('Cat', 'new');
    ok(B1.room.code && B1.room.code !== code, `a second private room has its own code (${B1.room.code})`);
    const U = await join('Dan', 'QQQQ');
    ok(U.welcome.roomError?.reason === 'unknown' && U.msgs.some(m => m.t === 'roomError' && m.code === 'QQQQ') && !U.room.private,
      `an unknown code: a clear error, then a public room (${U.welcome.roomError?.text})`);
    await close(U);

    // bots per room, and isolation: let both rooms fight a while (a short countdown; the bots fight each other)
    A1.send({ t: 'matchDebug', countdown: 1 }); B1.send({ t: 'matchDebug', countdown: 1 });
    await wait(14000);
    const lastSnap = (c) => c.msgs.filter(m => m.t === 'snap').pop();
    const idsA = new Set(lastSnap(A1)?.players.map(q => q.id)), idsB = new Set(lastSnap(B1)?.players.map(q => q.id));
    const botsA = lastSnap(A1)?.players.filter(q => q.bot) || [], botsB = lastSnap(B1)?.players.filter(q => q.bot) || [];
    ok(botsA.length === 2 && botsB.length === 3 && botsA.every(q => !idsB.has(q.id)) && botsB.every(q => !idsA.has(q.id)),
      `bots fill each room's empty seats, each room its own (${botsA.length} with 2 humans, ${botsB.length} with 1)`);
    // the player ids each message is about (a projectile's owner, a hit's two, a death's two, a join, a respawn)
    const PLAYER_MSGS = { proj: ['owner'], hit: ['attacker', 'target'], death: ['id', 'killer'], respawn: ['id'], leave: ['id'], tp: ['id'] };
    const about = (m) => [...(PLAYER_MSGS[m.t] || []).map(k => m[k]), m.t === 'joined' ? m.player.id : null, ...(m.t === 'snap' ? m.players.map(q => q.id) : [])].filter(v => v != null);
    const seenA = new Set(A1.msgs.flatMap(m => m.t === 'snap' || m.t === 'joined' || m.t === 'welcome' ? (m.t === 'welcome' ? m.players.map(q => q.id) : about(m)) : []));
    const seenB = new Set(B1.msgs.flatMap(m => m.t === 'snap' || m.t === 'joined' || m.t === 'welcome' ? (m.t === 'welcome' ? m.players.map(q => q.id) : about(m)) : []));
    const fights = (c) => c.msgs.filter(m => ['proj', 'hit', 'death', 'grab', 'frostfall', 'veil', 'jump'].includes(m.t)).length;
    const fightA = fights(A1), fightB = fights(B1);
    const foreign = (c, own, other) => c.msgs.filter(m => about(m).some(id => !own.has(id) || other.has(id)));
    const crossA = foreign(A1, seenA, seenB), crossB = foreign(B1, seenB, seenA);
    ok(fightA >= 2 && fightB >= 2, `both rooms are fighting (${fightA} and ${fightB} casts, hits and the like seen)`);
    ok([...seenA].every(id => !seenB.has(id)), `no player of one room is ever in the other's snapshots (${seenA.size} and ${seenB.size} ids)`);
    ok(crossA.length === 0 && crossB.length === 0 && A1.msgs.filter(m => m.t === 'hit' || m.t === 'proj' || m.t === 'death').length + B1.msgs.filter(m => m.t === 'hit' || m.t === 'proj' || m.t === 'death').length > 0,
      `no projectile, hit, death (the kill feed) or respawn crosses between them (${crossA.length + crossB.length} ${JSON.stringify([...crossA, ...crossB].map(m => m.t))})`);

    // the host's bot difficulty (a guest's request does nothing)
    let n = A1.msgs.length;
    A2.send({ t: 'roomBots', difficulty: 'hard' }); await wait(300);
    ok(A1.room.bots === 'easy', `a guest can't change the bots (${A1.room.bots})`);
    A1.send({ t: 'roomBots', difficulty: 'hard' }); await wait(1300);
    ok(A2.room.bots === 'hard' && (lastSnap(A2)?.players.filter(q => q.bot) || []).every(q => q.bot === 'hard'), `the host can: every fill bot plays hard now (${A2.room.bots})`);

    // full: 4 humans, then a 5th by code
    const A3 = await join('Eve', code), A4 = await join('Fay', code);
    const A5 = await join('Gus', code);
    ok(A5.welcome.roomError?.reason === 'full' && A5.room.id !== code && !A5.room.private, `a full room: the 5th gets an error and a public room (${A5.welcome.roomError?.text})`);
    await wait(300);   // (a fresh snapshot)
    ok((lastSnap(A1)?.players.filter(q => q.bot) || []).length === 0, `four humans in a private room: no bots left (${(lastSnap(A1)?.players.filter(q => q.bot) || []).map(q => q.name)})`);
    await close(A5);
    // the host leaves: the earliest human left takes over
    await close(A1);
    ok(A2.room.host === A2.id, `the host left: the next human is host (${A2.room.host} = ${A2.id})`);

    // cleanup: everyone out; after ROOM_EMPTY_TTL the rooms go, and the code no longer works
    await close(A2, A3, A4, B1);
    await wait(1000);
    const back = await join('Hal', code);
    ok(back.room?.id === code && !back.welcome.roomError, `an empty private room stays a moment: a friend can still come back by its code (${back.room?.id})`);
    await close(back);
    await wait(3500);
    const after = await roomsNow();
    ok(after === 0, `rooms with nobody in them for 2 s are deleted (${after} left)`);
    const late = await join('Ida', code);
    ok(late.welcome.roomError?.reason === 'unknown', `a deleted room's code is unknown (${late.welcome.roomError?.reason})`);
    await close(late);

    // a socket that only adds bots (botmatch.mjs, bot.js) watches a lab room of its own; nobody can join it
    {
      const ws = new WebSocket(`ws://localhost:${port}`), got = [];
      ws.on('message', raw => got.push(JSON.parse(raw)));
      await new Promise(r => ws.on('open', r));
      ws.send(JSON.stringify({ t: 'addBot', difficulty: 'easy' })); ws.send(JSON.stringify({ t: 'addBot', difficulty: 'easy' }));
      await wait(800);
      const H = await join('Ivy');
      ok(got.some(m => m.t === 'snap' && m.players.filter(q => q.bot).length === 2) && H.welcome.players.every(q => !q.bot || !got.some(m => m.t === 'joined' && m.player.id === q.id)),
        'an add-bots-only socket gets its own lab room and sees its bots; a plain join does not land there');
      ws.close(); await close(H);
    }

    // round 21: a first-timer (join.firstVisit) alone in a public room gets Easy fill bots, whatever difficulty the client sent;
    // a first-timer joining other humans leaves the room's difficulty alone; a plain join still sets it (the most recent human's)
    {
      await wait(2500);   // (the rooms above have emptied and closed: ROOM_EMPTY_TTL 2)
      const joinAs = async (name, extra) => {
        const ws = new WebSocket(`ws://localhost:${port}`);
        const c = { ws, name, msgs: [], id: null, room: null, send: (m) => ws.send(JSON.stringify(m)) };
        ws.on('message', raw => { const m = JSON.parse(raw); if (m.t === 'welcome') { c.id = m.id; c.room = m.room; } c.msgs.push(m); });
        await new Promise(r => ws.on('open', r));
        c.send({ t: 'join', name, ...extra });
        while (c.id == null) await wait(10);
        return c;
      };
      const F1 = await joinAs('Newbie', { firstVisit: true, difficulty: 'normal' });
      ok(!F1.room.private && F1.room.humans === 1 && F1.room.bots === 'easy', `a first-timer alone in a public room: the room's bots are Easy (${F1.room.id}, sent 'normal', bots ${F1.room.bots})`);
      await wait(3000);   // the 1.5 s grace, then the fill
      const fill = F1.msgs.filter(m => m.t === 'joined' && m.player.bot).map(m => m.player.bot);
      ok(fill.length === 3 && fill.every(d => d === 'easy'), `its three fill bots are Easy (${fill.join(', ') || 'none'})`);
      const F2 = await joinAs('Newbie2', { firstVisit: true, difficulty: 'hard' });
      ok(F2.room.id === F1.room.id && F2.room.bots === 'easy', `a first-timer joining a room with a human leaves its difficulty alone (${F2.room.id}, bots ${F2.room.bots})`);
      const F3 = await joinAs('Vet', { difficulty: 'hard' });
      ok(F3.room.id === F1.room.id && F3.room.bots === 'hard', `a plain join still sets the room's difficulty (bots ${F3.room.bots})`);
      await close(F1, F2, F3);
      // round 22: a join without `proto` (the live CrazyGames build) goes to a legacy room: the courtyard only, no runes or pads,
      // never shared with a current client; private codes of the other kind are refused
      await wait(2500);
      const L1 = await joinAs('OldBuild', { difficulty: 'normal' });
      const w1 = L1.msgs.find(m => m.t === 'welcome');
      ok(L1.room.legacy === true && w1.match.map.id === 'courtyard' && w1.runes === undefined && w1.pads === undefined, `a join without proto: a legacy room on the courtyard, no runes or pads (${JSON.stringify(L1.room)})`);
      const N1 = await joinAs('NewBuild', { proto: 24, difficulty: 'normal' });
      ok(N1.room.id !== L1.room.id && !N1.room.legacy, `a proto-24 join never shares it (${N1.room.id} vs ${L1.room.id})`);
      const L2 = await joinAs('OldBuild2', {});
      ok(L2.room.id === L1.room.id, 'a second legacy join shares the legacy room');
      await wait(1500);
      ok(!L1.msgs.some(m => m.t === 'snap' && m.runes) && !L1.msgs.some(m => m.t === 'snap' && m.players.some(q => q.id === N1.id)), 'its snapshots carry no runes and never the new client');
      const LP = await joinAs('OldHost', { room: 'new' }), NP = await joinAs('NewHost', { proto: 24, room: 'new' });
      const toL = await joinAs('NewGuest', { proto: 24, room: LP.room.code }), toN = await joinAs('OldGuest', { room: NP.room.code });
      const errL = toL.msgs.find(m => m.t === 'welcome')?.roomError, errN = toN.msgs.find(m => m.t === 'welcome')?.roomError;
      ok(errL?.reason === 'version' && !toL.room.private && !toL.room.legacy, `a new client at a legacy code: 'version', a public room of its own kind (${errL?.text})`);
      ok(errN?.reason === 'version' && !toN.room.private && toN.room.legacy === true, `an old client at a new code: 'version', a legacy public room (${errN?.text})`);
      // the private host's map lock (roomMap) and the first-visit routing
      NP.send({ t: 'roomMap', map: 'sky' }); await wait(400);
      const locked = NP.msgs.filter(m => m.t === 'room').pop()?.room;
      ok(!C.MAPS?.sky || (locked?.lock === 'sky' && locked.map === 'sky' && NP.msgs.some(m => m.t === 'map' && m.map.id === 'sky')), `the host locks Sky Ruins during the countdown: the room switches now (${JSON.stringify({ lock: locked?.lock, map: locked?.map })})`);
      toN.send({ t: 'roomMap', map: 'courtyard' }); await wait(300);
      ok(NP.msgs.filter(m => m.t === 'room').pop()?.room.lock === (C.MAPS?.sky ? 'sky' : null), 'a guest (in another room) can\'t change it');
      LP.send({ t: 'roomMap', map: 'sky' }); await wait(300);
      ok(LP.msgs.filter(m => m.t === 'room').pop()?.room.map === 'courtyard', 'a legacy room has no other map to lock');
      // round 24: three generations. A proto-22 or -23 join (the round-23 build pending at CrazyGames bundles the OLD Sky Ruins layout) gets a
      // 'v22' room: the courtyard with runes, pads and the current pace, no rotation and no other map to lock; never shared with a legacy
      // (no proto) or a current (proto 24) client, and a private code of another generation is refused with 'version'
      const V1 = await joinAs('Round23', { proto: 22, difficulty: 'normal' }), V2 = await joinAs('Round23b', { proto: 23 });
      const wv = V1.msgs.find(m => m.t === 'welcome');
      ok(V1.room.gen === 'v22' && !V1.room.legacy && wv.match.map.id === 'courtyard' && Array.isArray(wv.runes) && wv.runes.length > 0 && Array.isArray(wv.pads) && wv.pads.length > 0
        && V1.room.maps.join() === 'courtyard', `a proto-22 join: a v22 room on the courtyard with runes and pads, no rotation (${JSON.stringify({ gen: V1.room.gen, maps: V1.room.maps, runes: wv.runes?.length, pads: wv.pads?.length })})`);
      ok(V2.room.id === V1.room.id && V1.room.id !== L1.room.id && V1.room.id !== N1.room.id, `a proto-23 join shares it; it is neither the legacy nor the current room (${V2.room.id}; ${L1.room.id}, ${N1.room.id})`);
      ok(N1.room.gen === 'v24' && L1.room.gen === 'legacy' && L1.room.legacy === true, `the rooms say their generation (round 27: proto 24 is the store build's v24; ${N1.room.gen}, ${L1.room.gen})`);
      // round 27: a proto-27 join (six wizards) gets a current room, never the store build's v24 one; its private code refuses a v24 client
      const K1 = await joinAs('Kits', { proto: 27, wizard: 'cinder', difficulty: 'normal' });
      ok(K1.room.gen === 'current' && K1.room.id !== N1.room.id && K1.room.id !== V1.room.id && K1.room.id !== L1.room.id, `a proto-27 join: a current room of its own (${K1.room.id}; v24 ${N1.room.id})`);
      const KP = await joinAs('KitsHost', { proto: 27, room: 'new' }), v24ToK = await joinAs('StoreAtKits', { proto: 24, room: KP.room.code });
      const e24 = v24ToK.msgs.find(m => m.t === 'welcome')?.roomError;
      ok(e24?.reason === 'version' && v24ToK.room.gen === 'v24' && /newer version/.test(e24.text), `a v24 client at a current code: 'version' ("newer version"), a v24 public room (${e24?.text})`);
      await close(K1, KP, v24ToK);
      const VP = await joinAs('V22Host', { proto: 22, room: 'new' });
      const toV = await joinAs('NewAtV22', { proto: 24, room: VP.room.code }), vToN = await joinAs('V22AtNew', { proto: 23, room: NP.room.code }), oldToV = await joinAs('OldAtV22', { room: VP.room.code });
      const err = (c) => c.msgs.find(m => m.t === 'welcome')?.roomError;
      ok(err(toV)?.reason === 'version' && toV.room.gen === 'v24' && !toV.room.private, `a v24 client at a v22 code: 'version', a v24 public room (${err(toV)?.text})`);
      ok(err(vToN)?.reason === 'version' && vToN.room.gen === 'v22' && !vToN.room.private, `a v22 client at a current code: 'version', a v22 public room (${err(vToN)?.text})`);
      ok(err(oldToV)?.reason === 'version' && oldToV.room.legacy === true && !oldToV.room.private, `a legacy client at a v22 code: 'version', a legacy public room`);
      ok(vToN.room.id === V1.room.id || vToN.room.gen === 'v22', 'the v22 public room is shared by v22 clients only');
      VP.send({ t: 'roomMap', map: 'sky' }); await wait(400);
      ok(VP.msgs.filter(m => m.t === 'room').pop()?.room.map === 'courtyard' && !VP.msgs.some(m => m.t === 'map' && m.map.id === 'sky'), 'a v22 host can\'t lock Sky Ruins: the room stays on the courtyard');
      await wait(1200);
      ok(!V1.msgs.some(m => m.t === 'snap' && m.players.some(q => q.id === N1.id || q.id === L1.id)) && V1.msgs.some(m => m.t === 'snap' && m.runes), 'a v22 room\'s snapshots carry runes and never a legacy or current client');
      await close(L1, L2, N1, LP, NP, toL, toN, V1, V2, VP, toV, vToN, oldToV);
    }
  } catch (e) { ok(false, `room checks: ${e.message}`); }
  finally { if (srv.exitCode === null) { srv.kill(); await new Promise(r => srv.once('exit', r)); } }
}


// ---- round 18: server.js's save hooks against a real server (NODE_ENV=test, a test JWKS, a stub PostgREST on port 4195):
// auth → profile (the account on the player), save → a write, the verified username at join, a finished match → record_match
// for the logged-in player only, a disconnect flushes; a bad token → guest.
async function savesChecks() {
  const { spawn } = await import('node:child_process');
  const { default: WebSocket } = await import('ws');
  const http = await import('node:http');
  const { generateKeyPair, exportJWK, SignJWT } = await import('jose');
  const port = 4193, restPort = 4195, root = new URL('../../', import.meta.url).pathname;
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const calls = [];
  const rest = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      const path = req.url.split('?')[0];
      calls.push({ method: req.method, path, body: body ? JSON.parse(body) : null });
      res.setHeader('Content-Type', 'application/json');
      if (path.endsWith('/players')) return res.end(JSON.stringify([{ id: '00000000-0000-4000-8000-000000000007' }]));
      if (path.endsWith('/player_saves') && req.method === 'GET') return res.end(JSON.stringify([{ data: { loadout: C.DEFAULT_LOADOUT, voice: 'female' } }]));
      if (path.endsWith('/player_stats')) return res.end(JSON.stringify([{ matches: 3, wins: 1, kills: 12, deaths: 5 }]));
      res.statusCode = 204; res.end();
    });
  });
  await new Promise(r => rest.listen(restPort, r));
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'ingame-auth', alg: 'RS256', use: 'sig' };
  const t0 = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ userId: 'cg-77', username: 'CloudMage' }).setProtectedHeader({ alg: 'RS256', kid: 'ingame-auth' }).setIssuedAt(t0).setExpirationTime(t0 + 3600).sign(privateKey);
  const srv = spawn(process.execPath, ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, PORT: String(port), MATCH_DEBUG: '1',
    NODE_ENV: 'test', CG_TEST_JWKS: JSON.stringify({ keys: [jwk] }), SUPABASE_URL: `http://localhost:${restPort}`, SUPABASE_SECRET_KEY: 'sb_secret_test', STATS_EVERY_MS: '1000', WA_DEBUG: '1' } });
  try {
    await new Promise((res, rej) => { srv.stdout.on('data', d => { if (/listening/.test(d)) res(); }); srv.on('exit', () => rej(new Error('server exited'))); });
    const client = async () => {
      const ws = new WebSocket(`ws://localhost:${port}`);
      const c = { ws, msgs: [], id: null, send: (m) => ws.send(JSON.stringify(m)) };
      ws.on('message', raw => { const m = JSON.parse(raw); if (m.t === 'welcome') c.id = m.id; c.msgs.push(m); });
      await new Promise(r => ws.on('open', r));
      return c;
    };
    const A = await client();
    A.send({ t: 'auth', token }); await wait(600);
    const prof = A.msgs.find(m => m.t === 'profile');
    ok(prof && prof.username === 'CloudMage' && prof.save?.voice === 'female' && prof.stats?.matches === 3, `auth → the profile with the save and stats (${prof?.username}, ${prof?.stats?.matches} matches)`);
    A.send({ t: 'join', name: 'Typed', room: 'new' });
    while (A.id == null) await wait(10);
    ok(A.msgs.find(m => m.t === 'welcome').players.find(q => q.id === A.id)?.name === 'CloudMage', 'joining after the auth: the verified CrazyGames name');
    const G = await client();
    G.send({ t: 'auth', token: token.slice(0, -4) + 'AAAA' }); await wait(400);
    ok(G.msgs.some(m => m.t === 'profile' && m.guest), 'a bad token: profile guest');
    // round 19: { t: 'stats' } before any join (the join screen's panel); three at once: one answer now, one when the limit allows
    {
      const S = await client(), at = [];
      S.ws.on('message', raw => { if (JSON.parse(raw).t === 'stats') at.push(Date.now()); });
      const t0 = Date.now();
      S.send({ t: 'stats' }); await wait(200);
      S.send({ t: 'stats' }); S.send({ t: 'stats' });   // (inside the 1 s: answered together when it's up)
      await wait(1800);
      const replies = S.msgs.filter(m => m.t === 'stats');
      ok(replies.length === 2 && replies.every(m => m.unavailable === true || (m.board && 'me' in m)),
        `stats before joining: answered (${replies.map(m => m.unavailable ? 'unavailable' : 'board').join(', ')}); repeats collapse into one`);
      ok(at[0] - t0 < 500 && at[1] - at[0] >= 900, `one stats reply per interval per socket (${at[0] - t0} ms, then ${at[1] - at[0]} ms later)`);
      S.ws.close();
    }
    G.send({ t: 'join', name: 'Guesty', room: A.msgs.find(m => m.t === 'welcome').room.code });
    while (G.id == null) await wait(10);
    G.send({ t: 'save', data: { voice: 'male' } });
    A.send({ t: 'save', data: { loadout: C.DEFAULT_LOADOUT, voice: 'male', settings: { volume: 0.5, muted: false, bots: 'hard', howto: true } } });
    await wait(500);
    const saves = calls.filter(c => c.path.endsWith('/player_saves') && c.method !== 'GET');
    ok(saves.length === 1 && saves[0].body?.data?.settings?.bots === 'hard', `a save from the logged-in player is written; a guest's is ignored (${saves.length} writes)`);
    A.send({ t: 'matchDebug', skip: true }); await wait(400);   // the countdown → live
    // round 19: the logged-in player hits the guest with their primary: that spell's damage goes into the record (per_spell)
    const primary = A.msgs.find(m => m.t === 'welcome').players.find(q => q.id === A.id).loadout.primary;
    const line = clearLine(10);
    if (line) {
      const at = (d) => [line.a[0] + line.dir[0] * d, 0, line.a[2] + line.dir[1] * d];
      A.send({ t: 'matchDebug', pinBots: true });
      A.send({ t: 'debugPlace', p: at(0), yaw: line.yaw, resetCd: true }); G.send({ t: 'debugPlace', p: at(4), yaw: line.yaw + Math.PI });
      await wait(1800);   // (past spawn protection)
      for (let k = 0; k < 3; k++) { A.send({ t: 'cast', kind: C.PRIMARY_KIND[primary], origin: [at(0)[0], 1.3, at(0)[2]], dir: [line.dir[0], (C.HIT_CENTER_Y - 1.3) / 4, line.dir[1]] }); await wait(600); }
    }
    A.send({ t: 'matchDebug', skip: true }); await wait(800);   // live → the end
    const rec = calls.filter(c => c.path.endsWith('/rpc/record_match'));
    ok(rec.length === 1 && rec[0].body?.p_player === '00000000-0000-4000-8000-000000000007' && rec[0].body?.p_room_kind === 'private', `the match end records the logged-in player only (${rec.length} record_match, ${rec[0]?.body?.p_room_kind} room)`);
    const ps = rec[0]?.body?.p_per_spell || {};
    ok(line && ps[primary]?.damage > 0, `the record carries damage per spell (${primary}: ${JSON.stringify(ps[primary])})`);
    A.send({ t: 'save', data: { voice: 'female' } }); await wait(200);
    const n = calls.filter(c => c.path.endsWith('/player_saves') && c.method !== 'GET').length;
    A.ws.close(); await wait(600);
    ok(calls.filter(c => c.path.endsWith('/player_saves') && c.method !== 'GET').length === n + 1, 'a save waiting on the 10 s is flushed when they disconnect');
    G.ws.close();
  } catch (e) { ok(false, `saves checks: ${e.message}`); }
  finally { if (srv.exitCode === null) { srv.kill(); await new Promise(r => srv.once('exit', r)); } rest.close(); }
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
