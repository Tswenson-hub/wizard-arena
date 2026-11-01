// usage: MATCH_DEBUG=1 node tools/test/modematch-unit.mjs
// Rule checks for server/match.js (round 11: a 4-player free-for-all only) against a fake server ctx (no network,
// simulated clock): bot fill to 4, a human replacing a bot, a 5th human spectating until a place opens, first to 10,
// the 7-minute cap, the results and the rematch with no vote, spawns farthest from enemies; plus the loadout rules
// (constants.js sanitizeLoadout, presets, random loadouts, combos). Round 12 adds checks against the real server on port 4191
// (WA_DEBUG debugPlace/debugProp): only Telekinesis lifts, Trapped Relic traps (triggers, 2 per caster, glyphs), Roll. Round 13 adds
// the air jump, coyote time, casting on the move and in the air, the hover, and sprint-jump momentum in the speed budget.
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
  // round 13: Roll is a Utility (F) now; an old loadout with it in mobility moves it to a free utility slot, else drops it
  ok(C.SPELLBOOK.roll.slot === 'utility' && C.SPELL_POOL.utility.includes('roll') && !C.SPELL_POOL.mobility.includes('roll') && C.SPELL_POOL.mobility.length === 6,
    `Roll is in the Utility pool, Mobility has its other 6 (${C.SPELL_POOL.utility.join(', ')})`);
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
ok(match.matchPublic().target === 15 && match.matchPublic().mode === 'ffa', 'first to 15, mode ffa');

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
h.kills = 14; match.onKill(b1, h); ok(S.phase === 'live', '14 kills: still live');
h.kills = 15; h2.kills = 4; match.onKill(h2, h);
ok(S.phase === 'end' && S.results.winner === h.id && S.results.reason === 'target', 'the 15th kill ends the match, the leader wins');
ok(S.results.players[0].id === h.id && S.results.players.length === 4 && S.results.players[0].loadout, 'results list the 4 fighters, best first, with loadouts');
ok(!match.isEnemy(h, h2), 'no fighting on the results screen');
ok(sent.some(m => m.t === 'matchEnd'), 'matchEnd broadcast');
run(8.1);
ok(S.phase === 'countdown' && !sent.some(m => m.t === 'matchMode' || m.t === 'matchVotes'), 'results (8 s) → an immediate rematch (the 3 s countdown), no vote');
ok(fighters().every(p => p.kills === 0 && p.deaths === 0), 'the rematch starts from 0');
ok(fighters().every(p => (ult.get(p.id) || 0) === 0), 'ultimate charge reset');
run(3.1); ok(S.phase === 'live', 'rematch goes live after the 3 s countdown');

// ---- the 7-minute cap
ok(Math.abs(S.phaseEnd - clock - 420) < 0.2, 'the live phase lasts 7 minutes');
h.kills = 3; h2.kills = 5; clock = S.phaseEnd - 0.01; run(0.1);
ok(S.phase === 'end' && S.results.reason === 'time' && S.results.winner === h2.id, 'at the cap the most kills wins');
run(8.1); run(3.1);
h.kills = 2; h2.kills = 2; clock = S.phaseEnd - 0.01; run(0.1);
ok(S.phase === 'end' && S.results.winner === null, 'a tie at the cap: no winner');

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
ok(match.canThrow(h6, props.get(1)), 'telekinesis throws normally');
ok(!('vote' in match.matchPublic()) && !('zone' in match.matchPublic()) && !('scores' in match.matchPublic()), 'no vote, zone or team scores in the match state');

// ---- round 12, against the real server (WA_DEBUG + MATCH_DEBUG, on a private port): only Telekinesis lifts, Trapped Relic
// is traps only (2 per caster; an enemy close by, lifting it or breaking it sets it off), and Roll's charges and dodge window
await serverChecks();

async function serverChecks() {
  const { spawn } = await import('node:child_process');
  const { default: WebSocket } = await import('ws');
  const port = 4191, root = new URL('../../', import.meta.url).pathname;
  const srv = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), WA_DEBUG: '1', MATCH_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  try {
    await new Promise((res, rej) => { srv.stdout.on('data', d => { if (/listening/.test(d)) res(); }); srv.on('exit', () => rej(new Error('server exited'))); });
    const RELIC = C.SPELLBOOK.trapped_relic, ROLL = C.SPELLBOOK.roll;
    const join = async (name, lo) => {
      const ws = new WebSocket(`ws://localhost:${port}`);
      // (round 16: like the game's client, a state report echoes the server's last move of us it has seen, unless the test sets tp)
      const c = { ws, name, msgs: [], id: null, props: null, tp: 0, send: (m) => ws.send(JSON.stringify(m.t === 'state' && !('tp' in m) ? { ...m, tp: c.tp } : m)) };
      ws.on('message', raw => { const m = JSON.parse(raw); if (m.t === 'welcome') { c.id = m.id; c.props = m.props; }
        if (m.id === c.id && typeof m.seq === 'number' && ['respawn', 'flaskArrive', 'mirror', 'mrainLand'].includes(m.t)) c.tp = m.seq;
        c.msgs.push(m); });
      await new Promise(r => ws.on('open', r));
      c.send({ t: 'join', name, loadout: { ...C.DEFAULT_LOADOUT, primary: 'spark', ...lo } });
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
      && A.props.every(p => Math.hypot(p.x - x, p.z - z) > r) && flat(x, z, r) && strip(x, z);
    const spots = [];
    for (let x = -34; x <= 34; x++) for (let z = -34; z <= 34; z++) if (clear(x, z, 3.5) && spots.every(q => Math.hypot(q[0] - x, q[1] - z) > 9.5)) spots.push([x, z]);
    // parking: open ground (no strip needed), 9.5 m from every test spot and from each other
    const parks = [];
    for (let x = -34; x <= 34; x++) for (let z = -34; z <= 34; z++) if (inside(x, z, 2) && flat(x, z, 2) && A.props.every(p => Math.hypot(p.x - x, p.z - z) > 2)
      && spots.slice(0, 9).every(q => Math.hypot(q[0] - x, q[1] - z) > 9.5) && parks.every(q => Math.hypot(q[0] - x, q[1] - z) > 4)) parks.push([x, z]);
    ok(spots.length >= 9 && parks.length >= 4, `nine open spots for the trap and roll tests (${spots.length}) and four to park on (${parks.length})`);
    const park = (c, i) => place(c, parks[i] || [0, 0]);   // out of the way, on open ground of its own
    [A, B, V, R].forEach(park);
    const open = A.props.filter(p => p.state === 'idle').slice(0, 8);   // (spots[7] is the roll test's)
    open.forEach((p, i) => { const sp = spots[i < 7 ? i : 8]; p.x = sp[0]; p.z = sp[1]; A.send({ t: 'debugProp', id: p.id, x: p.x, z: p.z }); });
    await wait(100);
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
    for (const c of [A, B, V, R]) c.ws.close();
    await wait(300);
    await agilityChecks(join, since, spots);
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
    ok(Math.abs(top - C.JUMP.height - 1.2) < 0.02 && Math.abs(C.jumpApex({ y0: C.JUMP.height, n: 2 }) - 2.65) < 0.01,
      `the air jump from the first apex peaks about 1.2 m higher (${top.toFixed(2)} m, 2.65 expected)`);
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
    await walk(F, 0.4, k => [fx, 1.0 * (1 - k), fz]);
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

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
