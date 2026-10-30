// usage: MATCH_DEBUG=1 node tools/test/modematch-unit.mjs
// Rule checks for server/match.js (round 11: a 4-player free-for-all only) against a fake server ctx (no network,
// simulated clock): bot fill to 4, a human replacing a bot, a 5th human spectating until a place opens, first to 10,
// the 8-minute cap, the results and the rematch with no vote, spawns farthest from enemies; plus the loadout rules
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
      const c = { ws, name, msgs: [], id: null, props: null, send: (m) => ws.send(JSON.stringify(m)) };
      ws.on('message', raw => { const m = JSON.parse(raw); if (m.t === 'welcome') { c.id = m.id; c.props = m.props; } c.msgs.push(m); });
      await new Promise(r => ws.on('open', r));
      c.send({ t: 'join', name, loadout: { ...C.DEFAULT_LOADOUT, primary: 'spark', ...lo } });
      while (c.id == null) await wait(10);
      return c;
    };
    const since = (c, n, pred) => c.msgs.slice(n).filter(pred);
    const A = await join('Relic', { utility: 'trapped_relic' }), B = await join('Tk', { utility: 'telekinesis' });
    const V = await join('Victim', { utility: 'telekinesis' }), R = await join('Roller', { mobility: 'roll', utility: 'telekinesis' });
    A.send({ t: 'matchDebug', size: 4, warmup: 1 }); A.send({ t: 'removeBots' });
    await wait(1500);
    const place = (c, p, yaw = 0) => c.send({ t: 'debugPlace', p: [p[0], 0, p[1]], yaw });
    const park = (c, i) => place(c, [-30 + i * 3, -33 + i]);   // out of the way, on the south rim
    [A, B, V, R].forEach(park);
    // open ground (no collider, platform or prop within 5 m), and a prop moved to each spot (debugProp)
    const clear = (x, z, r) => Math.hypot(x, z) < C.ARENA_RADIUS - 4 && C.COLLIDERS.every(c => Math.hypot(c.x - x, c.z - z) > c.r + r)
      && A.props.every(p => Math.hypot(p.x - x, p.z - z) > r) && [-r, 0, r].every(dx => [-r, 0, r].every(dz => C.surfaceTopAt(x + dx, z + dz) < 0.05));
    const spots = [];
    for (let x = -34; x <= 34; x++) for (let z = -34; z <= 34; z++) if (clear(x, z, 4.6) && spots.every(q => Math.hypot(q[0] - x, q[1] - z) > 9.5)) spots.push([x, z]);
    ok(spots.length >= 9, `nine open spots for the trap and roll tests (${spots.length})`);
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
    // two armed traps at most: a third clears the oldest
    {
      const fresh = open.slice(4, 7);
      const got = [];
      for (const pr of fresh) got.push(await curse(pr));
      ok(fresh.length === 3 && got[1]?.length === 2 && got[2]?.length === RELIC.traps && !got[2].includes(fresh[0].id) && got[2].includes(fresh[2].id),
        `${RELIC.traps} traps per caster; a third clears the oldest (${JSON.stringify(got)})`);
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
  const J = await join('Jumper', { primary: 'spark', power: 'meteor', mobility: 'roll', utility: 'telekinesis' });
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
    await walk(J, 0.3, k => [sx, 0, sz + 0.54 * k]);   // 1.8 m/s: 60% of the walk
    ok(since(J, n, m => m.t === 'proj' && m.owner === J.id).length === 1, 'a Spark cast while walking is accepted');
    ok(Math.abs(snap(J).p[2] - (sz + 0.54)) < 0.05, `and the caster keeps moving at 60% through the cast (${(snap(J).p[2] - sz).toFixed(2)} of 0.54 m)`);
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
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
