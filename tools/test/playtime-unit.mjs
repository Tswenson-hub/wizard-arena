// usage: node tools/test/playtime-unit.mjs
// Round 26 (spells): the playtime checks. Pure: the XP maths and levels, the daily rotation and challenge completion, the guest
// progress sanitizing, the adaptive rating and the bots' skill scale. Then a room in this process (server/room.js with stubbed Saves
// hooks and fake sockets, MATCH_DEBUG and WA_DEBUG on): the drop-off events a session logs (join, first_death, menu_open,
// loadout_change, match_end, rematch_stay, idle_kick, the disconnect's details), XP to a 26 client at the match's end, the adaptive
// skill moving the auto bots between matches, and the older clients (legacy, v22's 22-23 and v24) never sent anything new.
process.env.MATCH_DEBUG = '1';
process.env.WA_DEBUG = '1';
const C = await import('../../public/shared/constants.js');
const Prog = await import('../../server/progress.js');
const { cfgFor, createBot, setBotSkill } = await import('../../server/bots.js');
const { createRoom } = await import('../../server/room.js');

let fails = 0;
const ok = (cond, what) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- XP and levels
ok(C.xpForLevel(1) === 0 && C.xpForLevel(2) === 300 && C.xpToNext(1) === 300 && C.xpToNext(2) === 325, 'level 2 at 300 XP, then 325 more to level 3');
let mono = true;
for (let L = 1; L < 200; L++) {
  if (C.xpForLevel(L + 1) <= C.xpForLevel(L) || C.levelForXp(C.xpForLevel(L)) !== L || C.levelForXp(C.xpForLevel(L + 1) - 1) !== L) mono = false;
}
ok(mono, 'levelForXp is the exact inverse of xpForLevel for levels 1-200, and the curve rises');
ok(C.levelForXp(-5) === 1 && C.levelForXp('abc') === 1 && C.levelForXp(1e12) <= C.LEVEL_MAX, 'levelForXp is safe on junk');
{ const i = C.levelInfo(700); ok(i.level === 3 && i.into === 75 && i.need === 350, `levelInfo(700): level 3, 75 into 350 (${JSON.stringify(i)})`); }
ok(C.levelForXp(6475) === 15 && C.titleFor(1) === 'Apprentice' && C.titleFor(10) === 'Battlemage' && C.titleFor(15) === 'Archmage', 'level 15 at 6,475 XP; titles by level');
{
  const u = C.UNLOCKS.filter(k => k.level <= 15);
  ok(u.length >= 7 && u.length <= 15 && new Set(C.UNLOCKS.map(k => k.id)).size === C.UNLOCKS.length && C.UNLOCKS.every(k => /^[a-z0-9_-]{1,32}$/.test(k.id) && C.COSMETIC_SLOTS.includes(k.slot)),
    `${u.length} unlocks by level 15 (one every 1-2 levels), unique ids that fit the table's check`);
}
{
  const m0 = C.matchXp({ kills: 0, place: 4 }), m1 = C.matchXp({ kills: 3, place: 2 }), m2 = C.matchXp({ kills: 5, place: 1, won: true }), m3 = C.matchXp({ kills: 5, place: 1, won: true, firstWin: true });
  ok(m0.total === 50 && m1.total === 50 + 30 + 20 && m2.total === 50 + 50 + 30 + 50 && m3.total === 2 * m2.total, `match XP: 4th 50, 2nd with 3 kills 100, a win with 5 kills 180, the day's first ×2 (${m0.total} ${m1.total} ${m2.total} ${m3.total})`);
  ok(m3.items.some(i => i.k === 'firstWin' && i.xp === m2.total), 'the first win of the day is its own line');
}

// ---------------------------------------------------------------- daily challenges
{
  let good = true, mapPairs = 0, distinctDays = new Set();
  for (let d = 0; d < 400; d++) {
    const day = C.dayKey(Date.UTC(2026, 0, 1) + d * 864e5), a = C.dailyChallenges(day), b = C.dailyChallenges(day);
    if (a.length !== 3 || new Set(a.map(c => c.id)).size !== 3 || a.map(c => c.id).join() !== b.map(c => c.id).join()) good = false;
    if (a.filter(c => c.map).length > 1) mapPairs++;
    if (a.some(c => c.xp < 100 || c.xp > 150)) good = false;
    distinctDays.add(a.map(c => c.id).sort().join());
  }
  ok(good, 'every day: three different challenges, the same for everyone that day, 100-150 XP each');
  ok(mapPairs === 0, 'never two map-bound challenges on one day');
  ok(distinctDays.size > 60, `the rotation varies (${distinctDays.size} different sets over 400 days)`);
  ok(C.dayKey(new Date('2026-11-16T23:59:59Z')) === '2026-11-16' && C.dayKey(new Date('2026-11-17T00:00:01Z')) === '2026-11-17', 'the day turns at midnight UTC');
}

// ---------------------------------------------------------------- progress: guests, sanitizing, completion
{
  const day = C.dayKey(), list = C.dailyChallenges(day);
  const junk = C.sanitizeProgress({ xp: -3, challenges: { day, list: [{ id: list[0].id, n: 1e9, goal: 1 }, { id: 'nope', n: 5 }] }, equipped: { robe: 'robe_void', hat: 'robe_crimson', bogus: 1 }, firstWinDay: 'x' });
  ok(junk.xp === 0 && junk.level === 1 && junk.challenges.list[0].n === list[0].goal && junk.challenges.list[0].done && junk.challenges.list.length === 3, 'junk progress: XP 0, the counts clamped to their goal, unknown challenges dropped');
  ok(!Object.keys(junk.equipped).length && junk.firstWinDay === null, 'a robe above the level and a hat id in the robe slot are dropped; a bad date is null');
  const old = C.sanitizeProgress({ xp: 900, challenges: { day: '2020-01-01', list: list.map(c => ({ id: c.id, n: 1, done: true })) } }, day);
  ok(old.xp === 900 && old.challenges.day === day && old.challenges.list.every(e => e.n === 0 && !e.done), "another day's challenges start over (the XP stays)");
  const lv4 = C.sanitizeProgress({ xp: C.xpForLevel(4), equipped: { robe: 'robe_emerald', staff: 'staff_ember', hat: 'hat_crown' } });
  ok(lv4.equipped.robe === 'robe_emerald' && lv4.equipped.staff === 'staff_ember' && !lv4.equipped.hat && lv4.unlocks.includes('robe_crimson'), 'a level 4 guest wears Emerald robes and the Ember staff, not the level-16 crown');
  ok(C.nextUnlock(3).id === 'robe_emerald' && C.nextUnlock(3).level === 4, '"Next unlock: Emerald robes at level 4"');

  // a challenge completed mid-match: its XP once, then listed in the match's award (the day pinned: 2026-12-26's are wins, podiums, void_ko)
  Prog.clock.day = () => '2026-12-26';
  const p = { id: 1 };
  Prog.initProgress(p, { xp: 250 });
  ok(p.prog.challenges.list.map(e => e.id).join() === 'wins,podiums,void_ko', `the pinned day's challenges (${p.prog.challenges.list.map(e => e.id)})`);
  const moved = [...Prog.bump(p, 'voidKos'), ...Prog.bump(p, 'voidKos')];
  ok(moved.filter(m => m.newly).length === 1 && p.prog.xp === 250 + 130 && p.prog.challenges.list[2].done, 'a void knockout completes "void_ko" once (+130 XP), a second does nothing');
  ok(Prog.bump(p, 'nothing').length === 0 && Prog.bump({ bot: {} }, 'kills').length === 0, 'unknown counters and bots move nothing');
  const r1 = Prog.finishMatch(p, { place: 2, of: 4, won: false, map: 'courtyard', kills: 13, deaths: 2 });
  const it = (k) => r1.msg.items.find(i => i.k === k);
  ok(it('finish').xp === 50 && it('kills').xp === 130 && it('podium').xp === 20 && it('challenge')?.xp === 130 && !it('win'), 'the award lists finish, kills, podium and the challenge done mid-match');
  ok(r1.msg.before.xp === 250 && r1.msg.progress.xp === 250 + 130 + 50 + 130 + 20 && r1.msg.gained === 330, `before ${r1.msg.before.xp}, after ${r1.msg.progress.xp}, gained ${r1.msg.gained}`);
  ok(r1.msg.levelUps.join() === '2' && r1.msg.unlocked.map(u => u.id).join() === 'robe_crimson', 'a level-up to 2 unlocks Crimson robes');
  ok(p.prog.challenges.list[1].n === 1 && !p.prog.challenges.list[1].done, 'the podium counts toward "finish on the podium twice"');
  const r2 = Prog.finishMatch(p, { place: 1, of: 4, won: true, map: 'sky', kills: 4, deaths: 0 });
  ok(r2.msg.items.some(i => i.k === 'firstWin') && r2.msg.items.filter(i => i.k === 'challenge').map(i => i.id).sort().join() === 'podiums,wins', "a win: the day's first-win bonus, and both 'podiums' and 'wins' complete");
  const r3 = Prog.finishMatch(p, { place: 1, of: 4, won: true, map: 'sky', kills: 4, deaths: 0 });
  ok(!r3.msg.items.some(i => i.k === 'firstWin' || i.k === 'challenge'), 'the second win that day: no bonus, nothing completes twice');
  Prog.clock.day = () => '2026-12-27';
  const r4 = Prog.finishMatch(p, { place: 1, of: 4, won: true, map: 'courtyard', kills: 1, deaths: 0 });
  ok(r4.msg.items.some(i => i.k === 'firstWin') && r4.msg.progress.challenges.day === '2026-12-27' && r4.msg.progress.challenges.list.every(e => e.n <= 1), 'the next day: new challenges, and a first win again');
  ok(Prog.progressRow(p).lastDailyReset === '2026-12-27' && Prog.progressRow(p).xp === p.prog.xp, "the row for Saves.writeProgress carries the day's reset");
  Prog.clock.day = () => C.dayKey();
}

// ---------------------------------------------------------------- adaptive difficulty: the rating and the bots' scale
{
  let a = C.sanitizeAdapt(null, true);
  ok(a.r === C.ADAPT.first && C.sanitizeAdapt(null, false).r === C.ADAPT.start, `a first visit starts at ${C.ADAPT.first} (Easy), a returning player without a rating at ${C.ADAPT.start}`);
  let up = { r: 0.5, h: [] }, down = { r: 0.5, h: [] }, mid = { r: 0.5, h: [] };
  for (let i = 0; i < 4; i++) { up = C.adaptAfter(up, 1, 4, 6, 1); down = C.adaptAfter(down, 4, 4, 0, 6); }
  for (const pl of [2, 4, 3, 4]) mid = C.adaptAfter(mid, pl, 4, 2, 3);
  ok(up.r > 0.75 && down.r < 0.25, `winning moves the rating up (${up.r}), losing moves it down (${down.r})`);
  ok(Math.abs(mid.r - 0.5) < 0.15, `a player near the target band stays near (${mid.r})`);
  let hi = { r: 0.99, h: [] }; for (let i = 0; i < 10; i++) hi = C.adaptAfter(hi, 1, 4, 9, 0);
  ok(hi.r <= 1 && hi.h.length === C.ADAPT.window, `the rating stays within 0-1 and keeps the last ${C.ADAPT.window} matches`);
  const e = cfgFor(0), n = cfgFor(0.5), h = cfgFor(1), q = cfgFor(0.25);
  ok(Math.abs(e.aimErr - 10) < 1e-9 && Math.abs(n.aimErr - 7) < 1e-9 && Math.abs(h.aimErr - 3.5) < 1e-9 && q.aimErr > n.aimErr && q.aimErr < e.aimErr, 'aim error runs Easy 10° → Normal 7° → Hard 3.5°, in between at 0.25');
  ok(e.react > q.react && q.react > n.react && n.react > h.react && e.aggression < n.aggression && n.aggression < h.aggression, 'reaction time shortens and aggression rises with skill');
  ok(cfgFor(0.1).blinkDodge === false && cfgFor(0.6).blinkDodge === true && cfgFor(0.9).relicMemory === true, "a yes/no is the nearer table's");
  const b = createBot('auto', { skill: 0.2, persona: 'sniper' });
  ok(b.auto && b.difficulty === 'easy' && b.cfg.range[1] > cfgFor(0.2).range[1] * 1.3, `an auto bot at 0.2 is labelled Easy; a Sniper keeps farther away (${b.cfg.range.map(v => v.toFixed(1))})`);
  setBotSkill(b, 0.9);
  ok(b.difficulty === 'hard' && b.cfg.aimErr < 5 && b.persona === 'sniper', 'setBotSkill moves it to Hard and keeps its personality');
  ok(Object.values(C.PERSONAS).every(P => C.sanitizeLoadout(P.loadout)), 'every personality has a valid loadout');
}

// ---------------------------------------------------------------- a room in this process
const events = [], saved = [], matchEnds = [];
const ROOMOPTS = { kind: 'public', allocId: (() => { let n = 1; return () => n++; })(), canAddBot: () => true,
  logEvent: (s, event, details, map) => events.push({ s, event, details, map }), saveProgress: (p, row) => saved.push({ id: p.id, row }),
  onMatchEnd: (list) => matchEnds.push(list.length) };
function fakeWs(session = null) { const ws = { readyState: 1, got: [], session, send(s) { const m = JSON.parse(s); if (m.t !== 'snap') ws.got.push(m); }, close() { ws.readyState = 3; } }; return ws; }
const NEW = ['xp', 'challenge', 'emote', 'taunt', 'look', 'progress'];
{
  const room = createRoom({ ...ROOMOPTS, id: 'test-1', gen: 'current' });
  const tick = setInterval(() => room.simulate(1 / 60), 1000 / 60);
  const w26 = fakeWs('S26'), w24 = fakeWs('S24');
  const id26 = room.join(w26, { t: 'join', proto: 26, name: 'New', difficulty: 'auto', anon: 'abcdefgh', progress: { xp: 290 }, adapt: { r: 0.8, h: [] }, equipped: { robe: 'robe_crimson' } });
  const id24 = room.join(w24, { t: 'join', proto: 24, name: 'Old', difficulty: 'normal' });
  const wel26 = w26.got.find(m => m.t === 'welcome'), wel24 = w24.got.find(m => m.t === 'welcome');
  ok(wel26.progress?.xp === 290 && wel26.progress.level === 1 && !wel24.progress, 'the 26 client gets its progress in the welcome; the 24 client gets none');
  ok(events.filter(e => e.event === 'join').map(e => `${e.s}:${e.details.room}:${e.map}`).join() === 'S26:public:courtyard,S24:public:courtyard', 'each session logs join with the room kind and the map');
  room.message(id26, { t: 'equip', equipped: { robe: 'robe_crimson', staff: 'staff_ember' } });   // (level 1: neither is unlocked)
  ok(!w24.got.some(m => m.t === 'look') && w26.got.some(m => m.t === 'look' && m.id === id26 && !Object.keys(m.eq).length), 'equip at level 1 drops the locked robes; the look goes to the 26 client only');
  room.message(id26, { t: 'menu', open: true }); room.message(id26, { t: 'menu', open: false }); room.message(id26, { t: 'menu', open: true });
  ok(events.filter(e => e.event === 'menu_open').length === 1, 'menu_open is logged once (repeats within 10 s are not)');
  room.message(id26, { t: 'loadout', loadout: C.PRESETS[1].loadout });
  ok(events.some(e => e.event === 'loadout_change' && e.s === 'S26'), 'a loadout change is logged');
  await sleep(2500);   // (the bots fill in)
  const bots = [...room.players.values()].filter(q => q.bot);
  ok(bots.length === 2 && bots.every(q => q.persona && q.botLv >= 2) && new Set(bots.map(q => q.persona)).size === 2, `two fill bots, each with its own personality and a level (${bots.map(q => `${q.name} the ${C.PERSONAS[q.persona].name} lv${q.botLv}`).join(', ')})`);
  ok(room.info().bots === 'normal', `the last human's pick (Normal) is the room's bots (${room.info().bots})`);
  room.setBots('auto');
  ok(room.info().skill === 0.6 && bots.every(q => !room.players.get(q.id) || true), `Auto: the room's skill is the humans' mean rating ((0.8 + ${C.ADAPT.start}) / 2 = ${room.info().skill})`);
  const autoBots = () => [...room.players.values()].filter(q => q.bot);
  ok(autoBots().every(q => q.bot.auto && Math.abs(q.bot.skill - 0.6) < 1e-9), 'the fill bots switch to the auto skill at once (a host pick), keeping their personalities');
  room.message(id26, { t: 'emote', e: 'cheer' }); room.message(id26, { t: 'emote', e: 'cheer' }); room.message(id26, { t: 'emote', e: 'dance' });
  ok(w26.got.filter(m => m.t === 'emote' && m.id === id26).length === 1 && !w24.got.some(m => m.t === 'emote'), 'an emote: one per 2.5 s, only known ones, to 26 clients only');
  // wait for a death (the bots go for the humans), up to 40 s
  for (let i = 0; i < 80 && !events.some(e => e.event === 'first_death'); i++) await sleep(500);
  const fd = events.find(e => e.event === 'first_death');
  ok(fd && Number.isFinite(fd.details.s), `first_death with its seconds since joining (${fd && JSON.stringify(fd.details)})`);
  // the match ends
  room.message(id26, { t: 'matchDebug', skip: true, endTime: 0.3, recapTime: 0.5, countdown: 1 });
  await sleep(300);
  const xp = w26.got.find(m => m.t === 'xp');
  ok(xp && xp.items[0].k === 'finish' && xp.progress.xp === xp.before.xp + xp.items.filter(i => i.k !== 'challenge').reduce((s, i) => s + i.xp, 0), `the 26 client gets its XP at the match's end (+${xp?.gained})`);
  ok(Array.isArray(xp?.adapt?.h) && xp.adapt.h.length === 1, 'the xp message carries the updated adaptive rating');
  const me26 = events.filter(e => e.event === 'match_end');
  ok(me26.length === 2 && me26.every(e => ['place', 'kills', 'deaths', 's', 'humans', 'bots'].every(k => k in e.details) && e.details.humans === 2 && e.details.bots === 2), 'match_end for both humans: place, kills, deaths, length, humans, bots');
  ok(!saved.length, 'a guest (no account) is never written to Supabase');
  for (let i = 0; i < 20 && room.match.state().phase !== 'countdown'; i++) await sleep(200);
  ok(events.filter(e => e.event === 'rematch_stay').length === 2, 'both humans stayed into the rematch: rematch_stay twice');
  const r26 = room.players.get(id26).adapt.r;
  ok(autoBots().every(q => Math.abs(q.bot.skill - room.info().skill) < 1e-9), `between matches the auto bots take the humans' new mean rating (${room.info().skill}; the 26 player's is now ${r26})`);
  const st = room.playerState(id26);
  ok(['menu', 'live', 'podium', 'lobby'].includes(st.state) && 'kills' in st && 'deaths' in st && 'streak' in st, `the disconnect's details: ${JSON.stringify(st)}`);
  ok(!w24.got.some(m => NEW.includes(m.t)), `the 24 client never got ${NEW.join(', ')}`);
  // an idle kick
  room.message(id24, { t: 'debugIdle', kick: 1 });
  for (let i = 0; i < 10 && !events.some(e => e.event === 'idle_kick'); i++) await sleep(300);
  ok(events.some(e => e.event === 'idle_kick' && e.s === 'S24' && Number.isFinite(e.details.s)), 'an idle kick is logged');
  clearInterval(tick);
  room.close();
}
// the legacy and v22 rooms: their clients never see anything new
for (const [gen, proto] of [['legacy', undefined], ['v22', 22], ['v22', 23]]) {
  const room = createRoom({ ...ROOMOPTS, id: `test-${gen}-${proto}`, gen, legacy: gen === 'legacy' });
  const tick = setInterval(() => room.simulate(1 / 60), 1000 / 60);
  const ws = fakeWs(`L-${gen}-${proto}`);
  const id = room.join(ws, { t: 'join', ...(proto ? { proto } : {}), name: 'Store', difficulty: 'easy' });
  await sleep(2000);
  room.message(id, { t: 'emote', e: 'wave' }); room.message(id, { t: 'equip', equipped: {} });
  room.message(id, { t: 'matchDebug', skip: true, endTime: 0.3 });   // (the countdown, then the match)
  await sleep(300);
  if (room.match.state().phase === 'live') room.message(id, { t: 'matchDebug', skip: true });
  await sleep(600);
  const wel = ws.got.find(m => m.t === 'welcome');
  ok(!wel.progress && !ws.got.some(m => NEW.includes(m.t)) && ws.got.some(m => m.t === 'matchEnd') && events.some(e => e.event === 'match_end' && e.s === `L-${gen}-${proto}`), `a ${gen} client (proto ${proto ?? 'none'}): a match ends as before (its match_end logged), and nothing new arrives`);
  clearInterval(tick);
  room.close();
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
