// usage: node tools/test/wizards-unit.mjs
// Round 27 (spells): six wizards with fixed kits. Pure: every kit is valid and uses Arcane Grasp, Roll and Trapped Relic are gone from
// the current game (but kept in the older rooms' rules), old loadouts map to a kit, the gallery's data. Then rooms in this process
// (server/room.js with fake sockets): a current room applies the joined wizard's kit, maps an old client's loadout, refuses a locked
// wizard (the Pyromancer at the join; the current one in game), takes an account's unlocks over a guest's claim, gives bots kits by
// personality, and every wizard lifts a crate with F; a v24 and a legacy room keep their free loadouts, Roll and Relic included.
process.env.MATCH_DEBUG = '1';
process.env.WA_DEBUG = '1';
const C = await import('../../public/shared/constants.js');
const { createRoom } = await import('../../server/room.js');

let fails = 0;
const ok = (cond, what) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- the kits
{
  ok(C.WIZARD_IDS.length === 6 && C.WIZARD_IDS.every(C.isWizard) && C.PRESETS.length === 6, `six wizards (${C.WIZARD_IDS.join(', ')})`);
  ok(C.WIZARD_IDS.every(id => C.sanitizeLoadout(C.kitFor(id)) && C.isKit(C.kitFor(id))), 'every kit is a valid loadout and a kit');
  ok(C.WIZARD_IDS.every(id => C.WIZARDS[id].kit.utility === 'telekinesis'), 'every wizard\'s F is telekinesis');
  ok(C.SPELLBOOK.telekinesis.name === 'Arcane Grasp' && C.SPELLBOOK.telekinesis.short === 'Arcane Grasp', 'telekinesis shows as "Arcane Grasp" (the id is unchanged)');
  const want = { cinder: 'fireball meteor firewall smoke_screen meteor_rain', gale: 'gale_shear cyclone tempest_veil blink eye_of_storm',
    rime: 'glacial_skim frostfall glacial_bulwark skyward blizzard', vesper: 'hex_shards sanguine_lash black_death mirror_step night_cage',
    jeb: 'sling battering_ram ram_guard ram_ride stampede', embibe: 'potion_toss toxic_flask smoke_flask flask_step berserker_brew' };
  ok(Object.entries(want).every(([id, k]) => ['primary', 'power', 'guard', 'mobility', 'ultimate'].map(s => C.WIZARDS[id].kit[s]).join(' ') === k), 'the kits are the brief\'s table (LMB, RMB, R, E, Q)');
  ok(!C.SPELLBOOK.roll && !C.SPELLBOOK.trapped_relic && !C.SPELL_INFO.roll && !C.SPELL_INFO.trapped_relic, 'Roll and Trapped Relic are gone from SPELLBOOK and SPELL_INFO');
  ok(C.LOADOUT_SLOTS.every(s => C.SPELL_POOL[s].every(id => C.WIZARD_IDS.some(w => C.WIZARDS[w].kit[s] === id))) && C.SPELL_POOL.utility.join() === 'telekinesis',
    'the current pool is the kits\' spells only (F: Arcane Grasp alone; no Spark or Ward)');
  ok(C.LEGACY_POOL.utility.includes('roll') && C.LEGACY_POOL.utility.includes('trapped_relic') && C.LEGACY_POOL.primary.includes('spark') && C.RETIRED_SPELLS.roll && C.RETIRED_SPELLS.trapped_relic,
    'the older rooms\' pool keeps Roll, Trapped Relic and Spark');
  ok(C.hitSpec('trapped_relic')?.damage === C.RETIRED_SPELLS.trapped_relic.damage && C.spellDef('roll') === C.RETIRED_SPELLS.roll, 'the server still finds the retired spells\' numbers (hitSpec, spellDef)');
  ok(C.BUILDER_UNLOCK_XP === undefined && !('builder' in C.wizardUnlocks(9999)), 'no builder rung');
  // mapping
  ok(C.wizardOfLoadout({ ...C.kitFor('vesper'), utility: 'trapped_relic' }) === 'vesper', 'an old Hemomancer kit with Trapped Relic maps to the Hemomancer');
  ok(C.wizardOfLoadout({ primary: 'glacial_skim', power: 'meteor', guard: 'ward', mobility: 'blink', utility: 'roll', ultimate: 'stampede' }) === 'rime', 'a custom loadout maps to the kit with its primary (Skim: the Frost Warden)');
  ok(C.wizardOfLoadout({ ...C.kitFor('gale'), primary: 'spark' }) === 'cinder' && C.wizardOfLoadout(null) === 'cinder' && C.wizardOfLoadout('nope') === 'cinder' && C.wizardOfLoadout([1]) === 'cinder',
    'Spark, nothing or junk: the Pyromancer');
  let allKits = true;
  for (let i = 0; i < 500; i++) allKits &&= C.isKit(C.kitLoadout(C.randomLoadout()).loadout);
  ok(allKits, 'any random old loadout becomes a whole kit');
  // the gallery's data
  const keys = C.WIZARD_IDS.map(id => C.wizardInfo(id).abilities.map(a => a.key).join(' '));
  ok(keys.every(k => k === 'LMB RMB R E F Q'), 'wizardInfo: six abilities in LMB, RMB, R, E, F, Q order');
  ok(C.WIZARD_IDS.every(id => { const w = C.wizardInfo(id); return w.tagline && w.tip && w.abilities.every(a => a.name && a.line && a.line.length <= 80) && w.abilities[4].name === 'Arcane Grasp'; }),
    'each has a role line, a tip, and a short line per ability (F: Arcane Grasp)');
  ok(C.WIZARD_IDS.map(id => C.wizardInfo(id).xp).join() === '0,50,200,350,500,650', 'the unlock XP follows the ladder');
  // personas
  ok(C.PERSONAS.brawler.wizards.join() === 'gale' && C.PERSONAS.sniper.wizards.every(w => ['cinder', 'rime'].includes(w)) && C.PERSONAS.showboat.wizards.join() === 'jeb',
    'bots by personality: the Brawler a Stormcaller, the Sniper a Pyromancer or Frost Warden, the Showboat a Beastcaller');
  ok(C.personaWizard('sniper', new Set(['cinder'])) === 'rime', 'a personality takes one of its wizards the room doesn\'t have yet');
}

// ---------------------------------------------------------------- rooms
const ROOMOPTS = { kind: 'public', allocId: (() => { let n = 1; return () => n++; })(), canAddBot: () => true, logEvent: () => {}, saveProgress: () => {} };
function fakeWs() { const ws = { readyState: 1, got: [], send(s) { const m = JSON.parse(s); if (m.t !== 'snap') ws.got.push(m); }, close() { ws.readyState = 3; } }; return ws; }
const rowOf = (ws, id) => ws.got.find(m => m.t === 'welcome')?.players.find(q => q.id === id);
{
  const room = createRoom({ ...ROOMOPTS, id: 'k-1', gen: 'current' });
  const P = (id) => room.players.get(id);
  // a fresh guest asks for the Frost Warden: locked, so the Pyromancer, and told why
  const a = fakeWs(), A = room.join(a, { t: 'join', proto: 27, name: 'Fresh', wizard: 'rime', progress: { xp: 0 } });
  const ra = a.got.find(m => m.t === 'wizardRefused');
  ok(P(A).wizard === 'cinder' && C.sameLoadout(P(A).loadout, C.kitFor('cinder')) && ra?.reason === 'locked' && ra.want === 'rime' && ra.wizard === 'cinder', 'a locked wizard at the join: the Pyromancer, and wizardRefused (locked)');
  ok(rowOf(a, A)?.wizard === 'cinder', 'the player row carries `wizard`');
  // one match in (60 XP): the Frost Warden
  const b = fakeWs(), B = room.join(b, { t: 'join', proto: 27, name: 'OneMatch', wizard: 'rime', progress: { xp: 60 } });
  ok(P(B).wizard === 'rime' && C.sameLoadout(P(B).loadout, C.kitFor('rime')) && !b.got.some(m => m.t === 'wizardRefused'), 'an unlocked wizard at the join: its kit');
  // an old client's custom loadout (with Roll) maps to the kit by its primary
  const c = fakeWs(), Cq = room.join(c, { t: 'join', proto: 27, name: 'Custom', loadout: { primary: 'hex_shards', power: 'meteor', guard: 'ward', mobility: 'blink', utility: 'roll', ultimate: 'blizzard' }, progress: { xp: 400 } });
  ok(P(Cq).wizard === 'vesper' && C.isKit(P(Cq).loadout) && P(Cq).loadout.utility === 'telekinesis', 'an old custom loadout (Hex Shards + Roll) becomes the Hemomancer\'s kit, Arcane Grasp included');
  // in game: a locked one is refused and nothing changes; an unknown one too; an unlocked one waits for the respawn
  room.message(B, { t: 'wizard', id: 'gale' });
  const rb = b.got.filter(m => m.t === 'wizardRefused').pop();
  ok(rb?.reason === 'locked' && rb.wizard === 'rime' && P(B).wizard === 'rime' && !P(B).pendingLoadout, 'a locked wizard in game: refused, the Frost Warden stays');
  room.message(B, { t: 'wizard', id: 'roll' });
  ok(b.got.filter(m => m.t === 'wizardRefused').pop()?.reason === 'unknown' && !P(B).pendingLoadout, 'an unknown id: refused (unknown)');
  room.message(B, { t: 'wizard', id: 'cinder' });
  ok(C.sameLoadout(P(B).pendingLoadout, C.kitFor('cinder')) && P(B).wizard === 'rime', 'an unlocked one waits for the next respawn');
  // an old-style { t: 'loadout' } in a current room also becomes a kit
  room.message(Cq, { t: 'loadout', loadout: { ...C.kitFor('cinder'), utility: 'trapped_relic' } });
  ok(C.sameLoadout(P(Cq).pendingLoadout, C.kitFor('cinder')), 'a { t: \'loadout\' } with Trapped Relic becomes the Pyromancer\'s kit');
  // Roll and curses do nothing in a current room
  const pos = P(A).p.slice();
  room.message(A, { t: 'roll', dir: [1, 0, 0], yaw: 0, from: pos });
  ok(!a.got.some(m => m.t === 'roll') && !P(A).rollUntil, 'a { t: \'roll\' } does nothing in a current room');
  // a grandfathered guest plays anything
  const g = fakeWs(), G = room.join(g, { t: 'join', proto: 27, name: 'Veteran', wizard: 'jeb', progress: { xp: 0, grandfathered: true } });
  ok(P(G)?.wizard === 'jeb', 'a grandfathered player may play the Beastcaller at 0 XP');
  room.close();
}
{
  // an account's progress arrives after the join and lacks the guest's wizard: the next life is the Pyromancer
  const room = createRoom({ ...ROOMOPTS, id: 'k-2', gen: 'current' });
  const a = fakeWs(), A = room.join(a, { t: 'join', proto: 27, name: 'Claimer', wizard: 'embibe', progress: { xp: 600 } });
  ok(room.players.get(A).wizard === 'embibe', 'a guest\'s claim (600 XP) gets the Alchemist');
  room.setProgress(A, { xp: 100 });
  const r = a.got.filter(m => m.t === 'wizardRefused').pop();
  ok(C.sameLoadout(room.players.get(A).pendingLoadout, C.kitFor('cinder')) && r?.reason === 'locked' && r.want === 'embibe', 'the account (100 XP) hasn\'t got her: the next life is the Pyromancer');
  room.close();
}
{
  // bots: kits by personality; and Arcane Grasp lifts a crate for every wizard
  const room = createRoom({ ...ROOMOPTS, id: 'k-3', gen: 'current' });
  const tick = setInterval(() => room.simulate(1 / 60), 1000 / 60);
  const w = fakeWs(), H = room.join(w, { t: 'join', proto: 27, name: 'Lifter', wizard: 'cinder', progress: { xp: 0, grandfathered: true } });
  await sleep(2500);
  const bots = [...room.players.values()].filter(q => q.bot);
  ok(bots.length >= 2 && bots.every(q => C.isKit(q.loadout) && C.PERSONAS[q.persona].wizards.includes(q.wizard)), `fill bots play their personality's kits (${bots.map(q => `${C.PERSONAS[q.persona].name}: ${q.wizard}`).join(', ')})`);
  const props = w.got.find(m => m.t === 'welcome').props;
  const lifted = [];
  for (const id of C.WIZARD_IDS) {
    const p = room.players.get(H);
    p.loadout = C.kitFor(id); p.wizard = id; p.pendingLoadout = null;
    if (p.carrying) { room.message(H, { t: 'drop' }); }
    await sleep(100);
    p.cd.lift = 0; p.stunUntil = 0; p.dead = false; p.hp = 100;
    const prop = props[lifted.length % props.length];
    p.p = [prop.x + 1.2, prop.y || 0, prop.z];
    const from = [p.p[0], p.p[1] + 1.3, p.p[2]], to = [prop.x, (prop.y || 0) + 0.4, prop.z];
    const d = to.map((v, i) => v - from[i]), l = Math.hypot(...d);
    room.message(H, { t: 'pickup', aimOrigin: from, aimDir: d.map(v => v / l) });
    lifted.push(p.carrying != null);
    if (p.carrying != null) { room.message(H, { t: 'drop' }); await sleep(100); }
  }
  ok(lifted.every(Boolean), `Arcane Grasp lifts an object for every wizard (${C.WIZARD_IDS.map((id, i) => `${id} ${lifted[i] ? 'yes' : 'NO'}`).join(', ')})`);
  clearInterval(tick);
  room.close();
}
for (const [gen, proto] of [['v24', 24], ['v24', 26], ['legacy', undefined]]) {
  // the older rooms: free loadouts, Roll and Trapped Relic kept, nothing new sent
  const room = createRoom({ ...ROOMOPTS, id: `k-${gen}-${proto}`, gen, legacy: gen === 'legacy' });
  const lo = { primary: 'spark', power: 'meteor', guard: 'ward', mobility: 'blink', utility: 'roll', ultimate: 'blizzard' };
  const ws = fakeWs(), id = room.join(ws, { t: 'join', ...(proto ? { proto } : {}), name: 'Store', loadout: lo });
  const p = room.players.get(id);
  ok(C.sameLoadout(p.loadout, lo) && C.sameLoadout(rowOf(ws, id)?.loadout, lo), `a ${gen} room (proto ${proto ?? 'none'}): a free loadout with Spark, Ward and Roll is kept as sent`);
  room.message(id, { t: 'loadout', loadout: { ...C.kitFor('vesper'), utility: 'trapped_relic' } });
  ok(p.pendingLoadout?.utility === 'trapped_relic' || p.loadout.utility === 'trapped_relic', `a ${gen} room: Trapped Relic can still be picked`);
  room.message(id, { t: 'wizard', id: 'rime' });
  ok(!ws.got.some(m => m.t === 'wizardRefused') && (p.pendingLoadout?.utility === 'trapped_relic' || p.loadout.utility === 'trapped_relic'), `a ${gen} room ignores { t: 'wizard' } and sends no wizardRefused`);
  room.close();
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
