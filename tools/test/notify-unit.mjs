// usage: node tools/test/notify-unit.mjs
// Round 23: Discord alerts (server/notify.js) against a stub webhook (a local HTTP server) with a fake clock, and the admin key
// against the real server on port 4193: a human join posts once, bots and admins don't, the throttles, a legacy room's text, the
// thread id, nothing without environment variables, an admin joins public-N and a non-admin can't.
import http from 'node:http';
import { createNotifier } from '../../server/notify.js';

let fails = 0;
const ok = (cond, what) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails++; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// ---- the stub webhook: records every POST (url, body)
const hits = [];
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => { hits.push({ url: req.url, body: JSON.parse(body || '{}') }); res.writeHead(204); res.end(); });
});
await new Promise(r => stub.listen(0, '127.0.0.1', r));
const HOOK = `http://127.0.0.1:${stub.address().port}/api/webhooks/1/abc`;
const flush = () => wait(60);

// ---- unit: a fake clock, a fake timer (held posts), the stub webhook
{
  let clock = 1_700_000_000_000;
  const timers = [];
  const N = createNotifier({ webhookUrl: HOOK, threadId: '777', adminKey: 'sesame', now: () => clock, log: { warn() {} },
    setTimer: (fn, ms) => { timers.push({ fn, at: clock + ms }); return timers.length; } });
  const fire = () => { for (const tm of timers.splice(0)) if (clock >= tm.at) tm.fn(); else timers.push(tm); };
  const ev = (roomId, humans, extra = {}) => ({ roomId, kind: 'public', legacy: false, map: 'courtyard', platform: 'web', humansBefore: 0, humans, ...extra });
  ok(N.enabled && N._url().endsWith('?thread_id=777'), `enabled, the thread id appended to the webhook (${N._url().split('/').pop()})`);
  ok(N.isAdmin('sesame') && !N.isAdmin('sesam') && !N.isAdmin('') && !N.isAdmin(null) && !N.isAdmin('sesame2'), 'the admin key: exact match only');
  ok(N.onHumanJoin(ev('public-1', [{ name: 'Ann' }])) === true, 'the first human in a public room posts');
  await flush();
  const e1 = hits.at(-1)?.body?.embeds?.[0];
  ok(hits.length === 1 && e1?.title === '🧙 A player is in Wizard Arena' && /public-1/.test(e1.fields[0].value) && /courtyard/.test(e1.fields[1].value) && /website/.test(e1.fields[2].value) && /Ann/.test(e1.fields[3].value) && /room=public-1&admin=1/.test(e1.description),
    `an embed with the room, map, source, names and the admin join link (${e1?.description})`);
  ok(hits[0].url === '/api/webhooks/1/abc?thread_id=777', `posted to the thread (${hits[0].url})`);
  clock += 30000;
  ok(N.onHumanJoin(ev('public-1', [{ name: 'Ann' }, { name: 'Bob' }], { humansBefore: 1 })) === false, 'a second human into the same room: nothing');
  ok(N.onHumanJoin(ev('public-1', [{ name: 'Bob' }], { humansBefore: 0 })) === false, 'the room emptied and refilled within 10 min: nothing');
  ok(N.onHumanJoin(ev('public-2', [{ name: 'Ty', admin: true }])) === false, 'an admin alone: nothing');
  ok(N.onHumanJoin(ev('lab-1', [{ name: 'X' }], { kind: 'lab' })) === false, 'a lab room: nothing');
  // the overall gap: another room's first human 30 s after the last post is held, and goes out when the 2 minutes are up
  const held = N.onHumanJoin(ev('public-3', [{ name: 'Cat' }], { humansNow: () => 1 }));
  ok(held === false && N.stats().held === 1 && hits.length === 1, 'a post inside the 2-minute gap is held');
  clock += 95000; fire(); await flush();
  ok(hits.length === 2 && /public-3/.test(hits[1].body.embeds[0].fields[0].value), 'and goes out when the gap ends');
  clock += 130000;
  ok(N.onHumanJoin(ev('public-4', [{ name: 'Dan' }], { humansNow: () => 0 })) === true, 'after the gap: a new room posts at once');
  await flush();
  ok(hits.length === 3, `three posts so far (${hits.length})`);
  clock += 11 * 60000;
  ok(N.onHumanJoin(ev('public-1', [{ name: 'Eve' }])) === true, 'the same room 10 minutes later posts again');
  await flush();
  // legacy
  clock += 130000;
  N.onHumanJoin(ev('public-9', [{ name: 'Old' }], { legacy: true, platform: undefined }));
  await flush();
  const el = hits.at(-1).body.embeds[0];
  ok(/old CrazyGames build/.test(el.description) && !/admin=1/.test(el.description) && /legacy/.test(el.fields[0].value) && /CrazyGames/.test(el.fields[2].value), `a legacy room: the crazygames.com text, no join link (${el.description.slice(0, 40)}…)`);
  // match end
  const before = hits.length;
  ok(N.onMatchEnd({ roomId: 'public-1', kind: 'public', map: 'sky', seconds: 250, ranked: [{ name: 'Bot', bot: true, kills: 10 }, { name: 'Eve', kills: 4 }] }) === true, 'a match with a real player posts a line');
  await flush();
  ok(hits.length === before + 1 && /Match over in public-1 \(sky, 4 min\)/.test(hits.at(-1).body.content) && /\*\*Bot\*\* wins with 10 kills \(a bot\)/.test(hits.at(-1).body.content) && /Eve \(4\)/.test(hits.at(-1).body.content), `the line (${hits.at(-1).body.content})`);
  ok(N.onMatchEnd({ roomId: 'public-1', kind: 'public', map: 'sky', seconds: 200, ranked: [{ name: 'Eve', kills: 10 }] }) === false, 'another match in that room within 10 min: nothing');
  ok(N.onMatchEnd({ roomId: 'public-5', kind: 'public', ranked: [{ name: 'Ty', admin: true, kills: 10 }, { name: 'Bot', bot: true, kills: 1 }] }) === false, 'a match with only Ty and bots: nothing');
  // a failing webhook never throws
  const bad = createNotifier({ webhookUrl: 'http://127.0.0.1:1/nope', now: () => clock, log: { warn() {} } });
  let threw = false;
  try { bad.onHumanJoin(ev('public-7', [{ name: 'Z' }])); } catch { threw = true; }
  await wait(200);
  ok(!threw && bad.stats().posts === 1, 'an unreachable webhook is logged, never thrown');
}
// ---- no environment: a no-op
{
  const N = createNotifier({ webhookUrl: undefined, threadId: undefined, adminKey: undefined, fetchImpl: () => { throw new Error('must not fetch'); } });
  ok(!N.enabled && N.onHumanJoin({ roomId: 'public-1', kind: 'public', humans: [{ name: 'A' }], humansBefore: 0 }) === false && N.onMatchEnd({ roomId: 'public-1', kind: 'public', ranked: [{ name: 'A', kills: 1 }] }) === false,
    'without NOTIFY_WEBHOOK_URL nothing is posted');
  ok(!N.isAdmin('anything') && !N.isAdmin(''), 'without ADMIN_KEY nobody is an admin');
}

// ---- the real server: joins post once per room, bots and the admin don't, the admin joins public-N, a non-admin can't
{
  const { spawn } = await import('node:child_process');
  const { default: WebSocket } = await import('ws');
  const port = 4193, root = new URL('../../', import.meta.url).pathname;
  const srv = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), MATCH_DEBUG: '1', NOOBTUBE: '0', NOTIFY_WEBHOOK_URL: HOOK, NOTIFY_THREAD_ID: '42', ADMIN_KEY: 'open-sesame' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  srv.stderr.on('data', d => { logs += d; });
  try {
    await new Promise((res, rej) => { srv.stdout.on('data', d => { logs += d; if (/listening/.test(d)) res(); }); srv.on('exit', () => rej(new Error('server exited'))); });
    hits.length = 0;
    const join = async (name, extra = {}) => {
      const ws = new WebSocket(`ws://localhost:${port}`);
      const c = { ws, name, msgs: [], id: null, room: null, send: (m) => ws.send(JSON.stringify(m)) };
      ws.on('message', raw => { const m = JSON.parse(raw); if (m.t === 'welcome') { c.id = m.id; c.room = m.room; c.welcome = m; } c.msgs.push(m); });
      await new Promise(r => ws.on('open', r));
      c.send({ t: 'join', proto: 24, name, ...extra });   // (round 24: a current client)
      while (c.id == null) await wait(10);
      return c;
    };
    const close = async (...cs) => { for (const c of cs) c.ws.close(); await wait(300); };
    const A = await join('Ann', { platform: 'web' });
    await wait(2500);   // (the fill bots join meanwhile: they must not post)
    ok(hits.length === 1 && /Ann/.test(hits[0].body.embeds[0].fields[3].value) && new RegExp(A.room.id).test(hits[0].body.embeds[0].fields[0].value) && hits[0].url.endsWith('?thread_id=42'),
      `a human's join posts once, to the thread, with the room and name (${hits.length} post${hits.length === 1 ? '' : 's'}, room ${A.room.id})`);
    const B = await join('Bob', { platform: 'crazygames' });
    await wait(400);
    ok(B.room.id === A.room.id && hits.length === 1, 'a second human in that room: no new post; the bots never posted');
    const T = await join('Ty', { admin: 'open-sesame', room: A.room.id });
    await wait(400);
    ok(T.room.id === A.room.id && hits.length === 1, `the admin joins the public room by its id (${T.room.id}) and posts nothing`);
    ok(!JSON.stringify(T.welcome).includes('open-sesame') && !JSON.stringify(T.msgs).includes('open-sesame') && !logs.includes('open-sesame'), 'the key is never sent back or logged');
    const N1 = await join('Nia', { admin: 'wrong', room: A.room.id });
    ok(N1.room.id !== A.room.id || N1.welcome.roomError, `a non-admin naming public-N gets today's public match (${N1.room.id}, error ${N1.welcome.roomError?.reason ?? 'none'})`);
    await close(N1);
    const N2 = await join('Nol', { room: A.room.id });
    ok(N2.welcome.roomError?.reason === 'unknown', `a plain join naming public-N: today's 'unknown' error and a public match (${N2.room.id})`);
    await close(N2);
    // the admin alone in a fresh room: nothing; a real player arriving after: within the 2-minute gap it's held (no post yet)
    const T2 = await join('Ty2', { admin: 'open-sesame', room: 'new' });
    await wait(400);
    const n0 = hits.length;
    const G = await join('Gus', { room: T2.room.code });
    await wait(400);
    ok(hits.length === n0, `the admin's own private room posts nothing; a guest arriving inside the 2-minute gap is held (${hits.length} posts)`);
    const T3 = await join('Ty3', { admin: 'open-sesame', room: 'public-999' });
    ok(T3.welcome.roomError?.reason === 'unknown' && !T3.room.private, `an admin naming a room that doesn't exist: 'unknown', a public match (${T3.room.id})`);
    const L = await join('Old', { room: A.room.id, proto: undefined });   // (no proto: a legacy join; an id of the other kind can't be joined by anyone)
    ok(L.room.legacy === true && L.room.id !== A.room.id, `a legacy join never lands in a current room (${L.room.id})`);
    await close(A, B, T, T2, G, T3, L);
  } catch (e) { ok(false, `server checks: ${e.message}`); }
  finally { if (srv.exitCode === null) { srv.kill(); await new Promise(r => srv.once('exit', r)); } }
}
stub.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
