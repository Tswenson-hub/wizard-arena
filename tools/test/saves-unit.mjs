// usage: NODE_ENV=test node tools/test/saves-unit.mjs
// Round 18: unit checks for server/saves.js with no network. verifyCgToken against a locally generated RS256 key and a test
// JWKS (good token, bad signature, expired, wrong kid, wrong alg, wrong gameId, junk); save validation and the size cap; the
// record_match arguments; the debounce (one write per 10 s, the latest data wins, a flush on disconnect) against a stubbed
// PostgREST; and the no-op path with no SUPABASE_* in the environment (nothing is fetched).
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import * as C from '../../public/shared/constants.js';

if (process.env.NODE_ENV !== 'test') { console.error('run with NODE_ENV=test'); process.exit(2); }
delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SECRET_KEY; delete process.env.CG_GAME_ID; delete process.env.CG_TEST_JWKS;
const S = await import('../../server/saves.js');

let fails = 0;
const ok = (cond, what) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails++; };
const calls = [];
let failNext = 0;
S._test.useFetch(async (url, init) => {
  calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers });
  if (failNext > 0) { failNext--; return new Response('boom', { status: 500 }); }
  const path = new URL(url).pathname;
  if (path.endsWith('/players')) return Response.json([{ id: '00000000-0000-4000-8000-000000000001' }]);
  if (path.endsWith('/player_saves') && init.method === 'GET') return Response.json([{ data: { loadout: C.DEFAULT_LOADOUT, junk: 1 } }]);
  if (path.endsWith('/player_stats')) return Response.json([{ matches: 3, wins: 1, kills: 12, deaths: 5 }]);
  if (path.endsWith('/rpc/leaderboard')) return Response.json(stub.board(JSON.parse(init.body)));
  if (path.endsWith('/rpc/player_rank')) return Response.json(stub.rank(JSON.parse(init.body)));
  if (path.endsWith('/match_results')) return Response.json(stub.recent);
  return new Response(null, { status: 204 });
});
const wait = (ms) => new Promise(r => setTimeout(r, ms));
// round 19's endpoints (the stats tests set these)
const stub = { board: () => [], rank: () => [], recent: [] };

// ---------------------------------------------------------------- no environment: everything is a no-op
{
  ok(!S.savesEnabled(), 'disabled with no SUPABASE_*');
  ok(await S.getStats('p1') === null && await S.getStats(null) === null, 'getStats → null (unavailable)');
  ok(await S.loadPlayer({ userId: 'u1', username: 'A' }) === null, 'loadPlayer → null');
  ok(S.writeSave('p1', { loadout: C.DEFAULT_LOADOUT }) === null, 'writeSave → null');
  ok(await S.recordMatch('p1', { place: 1 }) === false, 'recordMatch → false');
  ok((await S.recordRecap([{ id: 1, account: { playerId: 'p1' }, kills: 1 }])).length === 0, 'recordRecap → nothing');
  await S.flushSave('p1'); await S.flushAllSaves();
  ok(calls.length === 0, 'no request was made');
  ok(await S.verifyCgToken('a.b.c') === null, 'verifyCgToken → null without a JWKS (no remote fetch when disabled)');
}

// ---------------------------------------------------------------- the token
const { publicKey, privateKey } = await generateKeyPair('RS256');
const other = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'ingame-auth', alg: 'RS256', use: 'sig' };
const jwkOtherKid = { ...jwk, kid: 'something-else' };
await S._test.useJwks({ keys: [jwk, jwkOtherKid] });
const now = Math.floor(Date.now() / 1000);
const sign = (payload, { key = privateKey, kid = 'ingame-auth', exp = now + 3600 } = {}) =>
  new SignJWT({ userId: 'cg-123', gameId: '42', username: 'Merlin', profilePictureUrl: 'x', ...payload })
    .setProtectedHeader({ alg: 'RS256', kid }).setIssuedAt(now - 10).setExpirationTime(exp).sign(key);
{
  const v = await S.verifyCgToken(await sign({}));
  ok(v && v.userId === 'cg-123' && v.username === 'Merlin' && Object.keys(v).length === 2, 'a good token → { userId, username }');
  ok(await S.verifyCgToken(await sign({}, { key: other.privateKey })) === null, 'bad signature → null');
  ok(await S.verifyCgToken(await sign({}, { exp: now - 5 })) === null, 'expired → null');
  ok(await S.verifyCgToken(await sign({}, { kid: 'something-else' })) === null, 'wrong kid (even with a matching key) → null');
  const t = await sign({});
  const [h, p, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), userId: 'admin' })).toString('base64url');
  ok(await S.verifyCgToken(`${h}.${forged}.${sig}`) === null, 'tampered payload → null');
  const none = Buffer.from(JSON.stringify({ alg: 'none', kid: 'ingame-auth' })).toString('base64url');
  ok(await S.verifyCgToken(`${none}.${p}.`) === null, 'alg none → null');
  const hs = await new SignJWT({ userId: 'x' }).setProtectedHeader({ alg: 'HS256', kid: 'ingame-auth' }).setExpirationTime(now + 60)
    .sign(new TextEncoder().encode('k'.repeat(32)));
  ok(await S.verifyCgToken(hs) === null, 'HS256 → null');
  const noExp = await new SignJWT({ userId: 'cg-1' }).setProtectedHeader({ alg: 'RS256', kid: 'ingame-auth' }).sign(privateKey);
  ok(await S.verifyCgToken(noExp) === null, 'no exp → null');
  ok(await S.verifyCgToken(await sign({ userId: '' })) === null, 'no userId → null');
  ok((await S.verifyCgToken(await sign({ username: 'Evil\u0000Name‮ that is far too long to show' })))?.username === 'EvilName that is far too', 'username cleaned and capped');
  for (const junk of [null, 42, '', 'abc', 'a.b.c', 'x'.repeat(5000)]) ok(await S.verifyCgToken(junk) === null, `junk ${JSON.stringify(junk)?.slice(0, 12)} → null`);
  process.env.CG_GAME_ID = '42';
  ok(!!(await S.verifyCgToken(await sign({}))), 'CG_GAME_ID matches → ok');
  process.env.CG_GAME_ID = '7';
  ok(await S.verifyCgToken(await sign({})) === null, 'CG_GAME_ID differs → null');
  delete process.env.CG_GAME_ID;
}

// ---------------------------------------------------------------- save validation
{
  const lo = { ...C.DEFAULT_LOADOUT };
  const s = S.sanitizeSave({ loadout: lo, voice: 'female', loadouts: [{ name: 'A\u0007b', loadout: lo }, { name: 'bad', loadout: { primary: 'nuke' } },
    { loadout: lo }, { name: 'x'.repeat(99), loadout: lo }, { name: 'fourth', loadout: lo }],
    settings: { volume: 7, muted: true, bots: 'hard', howto: true, evil: 'x' }, hacked: { admin: true } });
  ok(s.v === 1 && !('hacked' in s), 'unknown keys dropped');
  ok(C.sameLoadout(s.loadout, lo), 'loadout kept');
  ok(s.loadouts.length === 3 && s.loadouts[0].name === 'Ab' && s.loadouts[1].name === 'Custom' && s.loadouts[2].name.length === 24,
    'saved loadouts: bad one dropped, names cleaned and capped, at most 3');
  ok(s.voice === 'female', 'voice kept');
  ok(JSON.stringify(s.settings) === JSON.stringify({ volume: 1, muted: true, bots: 'hard', howto: true }), 'settings whitelisted and clamped');
  ok(!('loadout' in S.sanitizeSave({ loadout: { ...lo, ultimate: 'win_game' } })), 'a bogus loadout is dropped');
  ok(S.sanitizeSave({ voice: 'robot', settings: { bots: 'god', volume: 'loud' } }).voice === undefined, 'bad voice dropped');
  for (const junk of [null, 'x', 5, [], undefined]) ok(S.sanitizeSave(junk) === null, `save ${JSON.stringify(junk)} → null`);
  const huge = S.sanitizeSave({ loadouts: Array.from({ length: 100000 }, () => ({ name: 'n'.repeat(1000), loadout: lo })) });
  ok(huge && huge.loadouts.length === 3 && JSON.stringify(huge).length <= S.MAX_SAVE_BYTES, 'a huge save is capped');
}

// ---------------------------------------------------------------- match rows
{
  const r = S.sanitizeMatchRow({ roomKind: 'private', place: 2, kills: 9.6, deaths: -3, assists: 1e9, damage: 'x', seconds: 400, bots: 2,
    perSpell: { fireball: { kills: 3, damage: 120.4, uses: 40 }, nope: { kills: 1 }, spark: { kills: 0 }, meteor: 5 } });
  ok(r.p_room_kind === 'private' && r.p_place === 2 && r.p_kills === 10 && r.p_deaths === 0 && r.p_assists === 500 && r.p_damage === 0, 'numbers clamped');
  ok(JSON.stringify(r.p_per_spell) === JSON.stringify({ fireball: { kills: 3, damage: 120, uses: 40 } }), 'per spell: known ids only, empty dropped');
  ok(S.sanitizeMatchRow({ place: 1, roomKind: 'weird' }).p_room_kind === 'public', 'room kind defaults to public');
  ok(S.sanitizeMatchRow({ place: 0 }) === null && S.sanitizeMatchRow({}) === null && S.sanitizeMatchRow(null) === null, 'no place → null');
  ok(S.sanitizeMatchRow({ place: 1 }).p_per_spell && Object.keys(S.sanitizeMatchRow({ place: 1 })).length === 11, 'all eleven arguments');
}

// ---------------------------------------------------------------- rate limit
{
  const ws = {}, t0 = 1_000_000;
  ok(S.authAllowed(ws, t0) && S.authAllowed(ws, t0 + 1) && !S.authAllowed(ws, t0 + 2), 'auth: a burst of 2, then refused');
  ok(!S.authAllowed(ws, t0 + 20_000) && S.authAllowed(ws, t0 + 31_000), 'auth: one more after 30 s');
}

// ---------------------------------------------------------------- with an environment (stubbed PostgREST)
process.env.SUPABASE_URL = 'https://stub.supabase.co/';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_TEST';
{
  ok(S.savesEnabled(), 'enabled with both set');
  calls.length = 0;
  const pl = await S.loadPlayer({ userId: 'cg-123', username: 'Merlin\u0000' });
  ok(pl?.playerId === '00000000-0000-4000-8000-000000000001', 'loadPlayer → playerId');
  ok(pl.save && C.sameLoadout(pl.save.loadout, C.DEFAULT_LOADOUT) && !('junk' in pl.save), 'the stored save comes back sanitized');
  ok(pl.stats.matches === 3 && pl.stats.wins === 1 && pl.stats.assists === 0, 'stats with zeros filled in');
  const up = calls[0];
  ok(up.method === 'POST' && up.url === 'https://stub.supabase.co/rest/v1/players?on_conflict=cg_user_id&select=id'
    && up.headers.Prefer.includes('merge-duplicates') && up.body.cg_user_id === 'cg-123' && up.body.username === 'Merlin' && up.body.last_seen,
  'players upserted on cg_user_id with username and last_seen');
  ok(Object.keys(up.body).sort().join() === 'cg_user_id,last_seen,username', 'nothing else stored about the user (no IP, no email)');
  ok(up.headers.apikey === 'sb_secret_TEST' && up.headers.Authorization === 'Bearer sb_secret_TEST', 'the secret key is sent as apikey and bearer');
  failNext = 1;
  ok(await S.loadPlayer({ userId: 'cg-123', username: 'M' }) === null, 'a Supabase error → null (guest), no throw');

  // debounce: first write at once, then at most one per 10 s with the latest data; flush on disconnect
  calls.length = 0;
  const P = 'pid-1', lo = { ...C.DEFAULT_LOADOUT };
  ok(S.writeSave(P, { loadout: lo, settings: { volume: 0.5 } })?.settings.volume === 0.5, 'writeSave returns the sanitized save');
  await wait(20);
  ok(calls.length === 1 && calls[0].url.endsWith('/player_saves?on_conflict=player_id') && calls[0].body.player_id === P, 'the first save is written at once');
  S.writeSave(P, { settings: { volume: 0.1 } });
  S.writeSave(P, { settings: { volume: 0.2 } });
  ok(S.writeSave(P, { nonsense: true })?.v === 1, 'an all-unknown save sanitizes to an empty one');
  S.writeSave(P, { settings: { volume: 0.3 } });
  await wait(20);
  ok(calls.length === 1, 'saves within 10 s are held back');
  ok(S._test.queued(P)?.timer, 'a write is scheduled');
  await S.flushSave(P);
  ok(calls.length === 2 && calls[1].body.data.settings.volume === 0.3, 'flush on disconnect writes the latest one, once');
  ok(!S._test.queued(P), 'the player is forgotten after the flush');
  await S.flushSave(P);
  ok(calls.length === 2, 'a second flush writes nothing');
  ok(S.writeSave(P, 'junk') === null && S.writeSave(null, {}) === null, 'a bad save or no player → null');
  failNext = 1;
  S.writeSave('pid-2', { voice: 'male' });
  await wait(20);
  ok(true, 'a failed write is logged, not thrown');
  S._test.reset();

  // record_match
  calls.length = 0;
  ok(await S.recordMatch('pid-1', { place: 1, kills: 4, roomKind: 'public', perSpell: { fireball: { kills: 2 } } }) === true, 'recordMatch → true');
  ok(calls[0].url.endsWith('/rest/v1/rpc/record_match') && calls[0].body.p_player === 'pid-1' && calls[0].body.p_kills === 4
    && calls[0].body.p_per_spell.fireball.kills === 2, 'record_match called with named arguments');
  failNext = 1;
  ok(await S.recordMatch('pid-1', { place: 1 }) === false, 'an RPC error → false');
  ok(await S.recordMatch('pid-1', { place: -1 }) === false, 'a bad row → false, not sent');

  // the recap hook: humans with an account, in place order; bots counted, never recorded
  calls.length = 0;
  const list = [
    { id: 1, bot: { difficulty: 'hard' }, account: { playerId: 'fake' }, kills: 9 },
    { id: 2, account: { playerId: 'pid-A' }, kills: 5, deaths: 2, mDmg: 340.6, ms: { assists: 3, healed: 20, potions: 1 } },
    { id: 3, kills: 3 },                                     // a guest
    { id: 4, account: { playerId: 'pid-B' }, kills: 0, deaths: 6 },
  ];
  const res = await S.recordRecap(list, { roomKind: 'private', seconds: 312 });
  ok(JSON.stringify(res) === '[false,true,false,true]', 'recordRecap: only the two humans with accounts');
  const a = calls.find(c => c.body.p_player === 'pid-A'), b = calls.find(c => c.body.p_player === 'pid-B');
  ok(calls.length === 2 && a.body.p_place === 2 && a.body.p_damage === 341 && a.body.p_assists === 3 && a.body.p_healing === 20
    && a.body.p_bots === 1 && a.body.p_seconds === 312 && a.body.p_room_kind === 'private' && b.body.p_place === 4, 'places, stats, bots and room kind');
}

// ---------------------------------------------------------------- round 19: stats and the leaderboard
{
  S._test.reset();
  const ME = 'pid-me';
  const rows = (period) => Array.from({ length: 25 }, (_, i) => ({ rank: i + 1, player_id: i === 2 ? ME : `pid-other-${i}`,
    username: i === 0 ? 'Top\u0000Wizard' : `W${i}`, wins: 30 - i, kills: 100 - i, matches: 40 + (period === 'all' ? 10 : 0) }));
  let boardCalls = 0;
  stub.board = ({ period, lim }) => { boardCalls++; return lim === 25 && ['week', 'all'].includes(period) ? rows(period) : 'bad'; };
  stub.rank = ({ p_player, period }) => p_player === ME ? [{ rank: period === 'week' ? 3 : 41, wins: 9, kills: 33 }] : [];
  stub.recent = [{ place: 1, kills: 6, deaths: 2, damage: 512, room_kind: 'private', bots_in_match: 2, created_at: '2026-11-01T10:00:00Z' }];
  const statsRow = { matches: 8, wins: 3, podiums: 5, kills: 25, deaths: 10, assists: 4, damage: 4001, healing: 90, potions: 3, playtime_s: 2400,
    per_spell: { fireball: { kills: 10, damage: 900, uses: 200 }, spark: { kills: 10, damage: 1200, uses: 300 }, meteor: { kills: 2, damage: 50, uses: 9 },
      blink: { uses: 40 }, not_a_spell: { kills: 99 }, frostfall: 'x' } };
  S._test.useFetch(async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    if (failNext > 0) { failNext--; return new Response('boom', { status: 500 }); }
    const path = new URL(url).pathname;
    if (path.endsWith('/player_stats')) return Response.json([statsRow]);
    if (path.endsWith('/rpc/leaderboard')) return Response.json(stub.board(JSON.parse(init.body)));
    if (path.endsWith('/rpc/player_rank')) return Response.json(stub.rank(JSON.parse(init.body)));
    if (path.endsWith('/match_results')) return Response.json(stub.recent);
    return new Response(null, { status: 204 });
  });

  calls.length = 0;
  const r = await S.getStats(ME);
  ok(r && !r.unavailable && Object.keys(r).sort().join() === 'board,me,rank,recent', 'a logged-in player: { me, recent, board, rank }');
  ok(r.board.week.length === 25 && r.board.all.length === 25 && r.board.all[0].matches === 50, 'both boards, 25 rows each');
  ok(r.board.week.every(e => Object.keys(e).every(k => ['rank', 'username', 'wins', 'kills', 'matches', 'me'].includes(k))), 'board rows: no ids');
  ok(!JSON.stringify(r).includes('pid-'), 'no player id anywhere in the reply');
  ok(r.board.week[0].username === 'TopWizard', 'usernames cleaned');
  ok(r.board.week[2].me === true && r.board.week.filter(e => e.me).length === 1, 'the player\'s own row is marked');
  ok(JSON.stringify(r.rank) === JSON.stringify({ week: { rank: 3, wins: 9, kills: 33 }, all: { rank: 41, wins: 9, kills: 33 } }), 'rank on both boards, also outside the top 25');
  ok(r.me.matches === 8 && r.me.winRate === 0.375 && r.me.kd === 2.5 && r.me.avgDamage === 500 && r.me.playtime_s === 2400 && r.me.podiums === 5, 'me: totals and derived values');
  ok(JSON.stringify(r.me.topSpells.map(e => e.id)) === '["spark","fireball","meteor"]', 'top 3 spells by kills, then damage (unknown ids dropped)');
  ok(!('per_spell' in r.me), 'per_spell itself is not sent');
  ok(r.recent.length === 1 && JSON.stringify(r.recent[0]) === JSON.stringify({ place: 1, kills: 6, deaths: 2, damage: 512, room: 'private', bots: 2, at: '2026-11-01T10:00:00Z' }), 'recent matches');
  const recentCall = calls.find(c => c.url.includes('/match_results'));
  ok(recentCall.url.includes(`player_id=eq.${ME}`) && recentCall.url.includes('order=created_at.desc') && recentCall.url.includes('limit=10'), 'recent: the player\'s last 10, newest first');
  ok(calls.filter(c => c.url.endsWith('/rpc/player_rank')).map(c => c.body.period).sort().join() === 'all,week', 'player_rank asked for both periods');
  ok(calls.filter(c => c.url.endsWith('/rpc/leaderboard')).every(c => c.body.lim === 25), 'leaderboard asked for 25');

  // the board cache (60 s): shared by every asker; per-player data is fetched on each ask
  const n = calls.length;
  boardCalls = 0;
  const g = await S.getStats(null);
  ok(boardCalls === 0, 'the boards are cached');
  ok(g.me === null && g.recent.length === 0 && g.rank.week === null && g.rank.all === null && g.board.week.length === 25, 'a guest: boards only');
  ok(!g.board.week.some(e => e.me), 'a guest has no marked row');
  ok(!calls.slice(n).some(c => c.url.includes('/player_stats') || c.url.includes('player_rank') || c.url.includes('match_results')), 'nothing per-player fetched for a guest');
  await S.getStats(ME);
  ok(boardCalls === 0 && calls.filter(c => c.url.includes('/player_stats')).length === 2, 'the player\'s own data is fetched again, the boards aren\'t');
  S._test.reset();
  await S.getStats(null);
  ok(boardCalls === 2, 'an expired cache asks again for both boards');
  S._test.reset(); boardCalls = 0;
  await Promise.all([S.getStats(null), S.getStats(ME), S.getStats(null)]);
  ok(boardCalls === 2, 'concurrent asks: one request per board');
  {
    const realNow = Date.now; let fake = realNow();
    Date.now = () => fake;
    S._test.reset(); boardCalls = 0;
    await S.getStats(null); fake += 59_000; await S.getStats(null);
    ok(boardCalls === 2, 'still cached after 59 s');
    fake += 2_000; await S.getStats(null);
    ok(boardCalls === 4, 'fetched again after 60 s');
    Date.now = realNow;
  }

  // a new account: no stats row, no matches, not on a board
  stub.rank = () => []; stub.recent = [];
  const fresh = S.derivedStats(undefined);
  ok(fresh.matches === 0 && fresh.winRate === 0 && fresh.kd === 0 && fresh.avgDamage === 0 && fresh.topSpells.length === 0, 'no stats: zeros');
  const nr = await S.getStats('pid-new');
  ok(nr.rank.week === null && nr.rank.all === null && !nr.board.week.some(e => e.me), 'not on a board: rank null');
  S._test.reset(); stub.board = () => [];
  const e = await S.getStats(null);
  ok(e && e.board.week.length === 0 && e.board.all.length === 0, 'an empty board: empty lists');

  // errors: null (unavailable), never a rejection, and not cached
  S._test.reset(); stub.board = ({ period }) => rows(period);
  failNext = 1;
  ok(await S.getStats(ME) === null, 'a Supabase error → null');
  ok((await S.getStats(ME))?.board.week.length === 25, 'the next ask works: errors aren\'t cached');

  // disabled again: null, nothing fetched
  delete process.env.SUPABASE_URL;
  calls.length = 0;
  ok(await S.getStats(ME) === null && calls.length === 0, 'no environment: null, nothing fetched');
}

console.log(fails ? `\n${fails} FAILED` : '\nall saves checks passed');
process.exit(fails ? 1 : 0);
