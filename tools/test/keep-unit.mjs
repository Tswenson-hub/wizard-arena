// usage: node tools/test/keep-unit.mjs
// Round 29 (spells): Siege Keep, the current rooms' one map. The maps per generation (a current room plays the keep only: no rotation,
// no lock on an old map; v24 keeps the courtyard and Sky Ruins, v22 the courtyard, legacy its frozen copy), no void, the map's data as
// the rules read it (8 spawns, 4 flasks, 4 runes, 3 pads with clear arcs, 18-20 props standing on their floors), the bots' route graph
// (one piece, a walk through the breach, the drawbridge crossed only by its time-gated edge, every spot reachable from every spawn), the
// drawbridge on the keep's data (a floor down; rising, a slope that lifts; raised, a full-height wall that holds a wizard and a shot on
// the road), Arcane Grasp lifting a prop off the wall-walk in a real room, and the day's challenges (none bound to a map).
process.env.WA_DEBUG ??= '1';
process.env.MATCH_DEBUG ??= '1';
const C = await import('../../public/shared/constants.js');
const { createRoom } = await import('../../server/room.js');
const { routeGraphDebug } = await import('../../server/bots.js');

let fails = 0;
const ok = (cond, what) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails++; };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- the maps
ok(C.MAP_ORDER.join() === 'keep' && C.DEFAULT_MAP === 'keep' && C.MAPS.keep?.title === 'Siege Keep', `MAP_ORDER is ['keep'] (${C.MAP_ORDER}), the default map the keep`);
const gens = Object.fromEntries(['legacy', 'v22', 'v24', 'current'].map(g => [g, C.mapsForGen(g).join('+')]));
ok(gens.legacy === 'legacy' && gens.v22 === 'courtyard' && gens.v24 === 'courtyard+sky' && gens.current === 'keep', `the maps per generation: ${JSON.stringify(gens)}`);
ok(['courtyard', 'sky', 'legacy'].every(m => C.MAPS[m]?.server && C.MAPS[m].layout?.entries?.length), 'the frozen layouts are loaded server-side');
C.setActiveMap('keep');
ok(C.voidY() === null && C.MAP_INFO.void == null, 'the keep has no void');
ok(C.DAILY_POOL.every(c => !c.map) && ['prop_kills', 'streak3'].every(id => C.DAILY_POOL.some(c => c.id === id)) && !C.DAILY_POOL.some(c => /sky|void/.test(c.id)),
  'no daily challenge is bound to a map; prop_kills and streak3 replace win_sky and void_ko');

// ---------------------------------------------------------------- the keep's data
ok(C.SPAWN_POINTS.length === 8, `8 spawns (${C.SPAWN_POINTS.length})`);
ok(C.HEAL_SPOTS.length === 4 && C.RUNE_SPAWNS.length === 4, `4 heal flasks and 4 runes (${C.HEAL_SPOTS.length}, ${C.RUNE_SPAWNS.length})`);
ok(C.PROP_SPAWNS.length >= 18 && C.PROP_SPAWNS.length <= 20 && C.PROP_SPAWNS.every(([t]) => C.PROP_TYPES[t]), `18-20 props of known types (${C.PROP_SPAWNS.length})`);
const propFloors = C.PROP_SPAWNS.filter(([, x, z, y]) => Math.abs(C.surfaceHeight(x, z, y + 0.1) - y) > 0.05);
ok(!propFloors.length, `every prop stands on its floor (${propFloors.length} off; ${C.PROP_SPAWNS.filter(p => p[3] > 1).length} up on the walls)`);
const runeUp = C.RUNE_SPAWNS.find(r => r.y > 8);
ok(!!runeUp && Math.abs(C.surfaceHeight(runeUp.x, runeUp.z, runeUp.y + 0.1) - runeUp.y) < 0.05, `a rune on a tower top, on its floor (${runeUp?.id} at ${runeUp?.y})`);
ok(C.JUMP_PADS.length === 3, `3 jump pads (${C.JUMP_PADS.map(p => p.id)})`);
for (const pd of C.JUMP_PADS) {
  const a = C.padArc(pd); let hit = null;
  for (let e = 0.05; e < a.time - 0.05 && !hit; e += 0.02) { const [x, y, z] = C.padAt(a, pd, e); for (const [ox, oz] of [[0, 0], [0.45, 0], [-0.45, 0], [0, 0.45], [0, -0.45]]) hit ||= C.surfaceSolidAt(x + ox, y + 1.0, z + oz)?.name; }
  const end = C.padAt(a, pd, a.time);
  ok(!hit && Math.hypot(end[0] - pd.target[0], end[2] - pd.target[2]) < 0.1 && Math.abs(end[1] - pd.target[1]) < 0.1, `${pd.id}: a clear arc to (${pd.target.map(v => v.toFixed(1))})${hit ? ` (hits ${hit})` : ''}`);
}

// ---------------------------------------------------------------- the bots' route graph
const G = routeGraphDebug();
const kinds = {}; for (const e of G.edges) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
ok(kinds.stair === 10 && kinds.pad === 3 && kinds.drawbridge === 2, `the graph: 5 stairs (both ways), 3 pads, the drawbridge each way (${JSON.stringify(kinds)})`);
ok(G.nodes.filter(n => n.tile).length >= 20 && G.nodes.some(n => n.tile && /towertop/.test(n.tile.name)), `nodes on the wall-walk and tower-top tiles (${G.nodes.filter(n => n.tile).length})`);
const reach = (s, skip = () => false) => { const seen = new Set([s]), q = [s]; while (q.length) { const u = q.shift(); for (const e of G.adj[u]) if (!skip(e) && !seen.has(e.b)) { seen.add(e.b); q.push(e.b); } } return seen; };
const nearest = (x, z, y = 0) => { let bi = -1, bd = Infinity; G.nodes.forEach((n, i) => { const d = Math.hypot(n.p[0] - x, n.p[1] - z) + Math.abs(n.y - y) * 3; if (d < bd) { bd = d; bi = i; } }); return bi; };
const spots = [...C.SPAWN_POINTS.map(s => ['spawn', s[0], s[2], s[1] || 0]), ...C.HEAL_SPOTS.map(h => [h.id, h.x, h.z, h.y || 0]), ...C.RUNE_SPAWNS.map(r => [r.id, r.x, r.z, r.y || 0])];
const unreached = [];
for (const s of C.SPAWN_POINTS) { const R = reach(nearest(s[0], s[2])); for (const [id, x, z, y] of spots) if (!R.has(nearest(x, z, y))) unreached.push(`${id} from (${s[0]}, ${s[2]})`); }
ok(!unreached.length, `every spawn, flask and rune is on the graph from every spawn (${unreached.slice(0, 4).join('; ') || 'all'})`);
// the breach: with the drawbridge, the pads and the siege tower left out, the courtyard still reaches the field on foot
const inside = nearest(0, -6), outside = nearest(22, 22);
const onFoot = reach(inside, e => e.kind === 'drawbridge' || e.kind === 'pad' || e.kind === 'stair');
ok(onFoot.has(outside), 'on foot, with no drawbridge, pads or stairs, the courtyard reaches the field (through the breach)');
const db = C.DRAWBRIDGES[0];
const crossing = G.edges.filter(e => e.kind === 'walk' && Math.min(G.nodes[e.a].y, G.nodes[e.b].y) < 2 && (() => {
  const A = G.nodes[e.a].p, B = G.nodes[e.b].p;
  for (let k = 0; k <= 20; k++) { const x = A[0] + (B[0] - A[0]) * k / 20 - db.x, z = A[1] + (B[1] - A[1]) * k / 20 - db.z, al = x * db.dir[0] + z * db.dir[1], ac = x * db.dir[1] - z * db.dir[0]; if (al > 0 && al < db.d && Math.abs(ac) < db.w / 2) return true; }
  return false; })());
ok(!crossing.length, `no plain walk crosses the drawbridge's span (${crossing.length})`);
const gateIn = reach(inside, e => e.kind === 'pad' || e.kind === 'stair' || (e.kind === 'walk' && [e.a, e.b].some(i => { const n = G.nodes[i]; return n.p[0] > 9 && Math.abs(n.p[1] - 4) < 4; })));
ok(gateIn.has(nearest(0, -24)), 'with the breach closed too, the road south is reached through the drawbridge edge');

// ---------------------------------------------------------------- the drawbridge on the keep's data
ok(C.DRAWBRIDGES.length === 1 && db.id === 'drawbridge' && Math.abs(db.dir[1] + 1) < 1e-3, `one drawbridge, the slab toward the road (south) (${db?.id})`);
const D = C.DRAWBRIDGE, t0 = D.t0;
D.t0 = 0;
const out = [db.x + db.dir[0] * 3.6, db.z + db.dir[1] * 3.6];
C.updateDrawbridges(5);
ok(Math.abs(C.surfaceHeight(out[0], out[1], 0.5) - db.y) < 0.01, `down: a floor over the moat at ${db.y}`);
C.updateDrawbridges(13.4);
const a134 = C.drawbridgeAngle(13.4), want = db.y + 3.6 * Math.tan(a134) * Math.cos(a134);
ok(C.surfaceHeight(out[0], out[1] - 3.6 * (1 - Math.cos(a134)) * db.dir[1], 3) > db.y + 1, `rising (${(a134 * 180 / Math.PI).toFixed(0)}°): a slope that lifts whoever stands on it`);
C.updateDrawbridges(18);
let z = db.z + db.dir[1] * 7;
for (let i = 0; i < 200; i++) { z -= db.dir[1] * 0.05; z = C.surfacePushOut(db.x, z, 0, 0.45)[1]; }
const face = db.z + db.dir[1] * (db.d * Math.cos(C.drawbridgeAngle(18)));
ok(Math.abs(z - (face + db.dir[1] * 0.45)) < 0.1, `raised: walking at the gate from the road holds a wizard at the slab's face (z ${z.toFixed(2)}, face ${face.toFixed(2)})`);
ok(!!C.surfaceBlocks([db.x, 1.2, db.z + db.dir[1] * 6], [db.x, 1.2, db.z - db.dir[1] * 3]) && !!C.surfaceSolidAt(db.x, 4, face - db.dir[1] * 0.2), 'and blocks a shot from the road, up to its top');
C.updateDrawbridges(26);
D.t0 = t0;

// ---------------------------------------------------------------- real rooms (in this process)
const ROOMOPTS = { allocId: (() => { let n = 1; return () => n++; })(), canAddBot: () => true };
function fakeWs() { const ws = { readyState: 1, got: [], send(s) { const m = JSON.parse(s); if (m.t !== 'snap') ws.got.push(m); }, close() { ws.readyState = 3; } }; return ws; }
const lastRoom = (ws) => ws.got.filter(m => m.t === 'room').pop()?.room || ws.got.find(m => m.t === 'welcome')?.room;
{
  const cur = createRoom({ ...ROOMOPTS, id: 'keep-1', kind: 'private', code: 'KEEP', gen: 'current' });
  const v24 = createRoom({ ...ROOMOPTS, id: 'v24-1', kind: 'public', gen: 'v24' });
  const v22 = createRoom({ ...ROOMOPTS, id: 'v22-1', kind: 'public', gen: 'v22' });
  const tick = setInterval(() => { cur.simulate(1 / 60); v24.simulate(1 / 60); v22.simulate(1 / 60); }, 1000 / 60);
  const w = fakeWs(), wv = fakeWs(), w2 = fakeWs();
  const id = cur.join(w, { t: 'join', proto: 27, wizard: 'cinder', name: 'Keeper' });
  v24.join(wv, { t: 'join', proto: 24, name: 'Store' });
  v22.join(w2, { t: 'join', proto: 22, name: 'Older' });
  cur.host = id;
  await wait(300);
  const wel = w.got.find(m => m.t === 'welcome');
  ok(wel?.match?.map?.id === 'keep' && lastRoom(w)?.maps?.join() === 'keep', `a current room plays the keep only (${wel?.match?.map?.id}, maps ${lastRoom(w)?.maps})`);
  ok(lastRoom(wv)?.map === 'courtyard' && lastRoom(wv)?.maps?.join() === 'courtyard,sky', `a v24 room keeps the courtyard and Sky Ruins (${lastRoom(wv)?.maps})`);
  ok(lastRoom(w2)?.map === 'courtyard' && lastRoom(w2)?.maps?.join() === 'courtyard', `a v22 room the courtyard (${lastRoom(w2)?.maps})`);
  ok((wel?.drawbridges || []).length === 1 && wel.drawbridges[0].id === 'drawbridge', 'the welcome carries the keep\'s drawbridge');
  cur.message(id, { t: 'matchDebug', size: 1, countdown: 1 }); cur.message(id, { t: 'removeBots' });
  cur.message(id, { t: 'roomMap', map: 'sky' });
  await wait(300);
  ok(lastRoom(w)?.lock == null && lastRoom(w)?.map === 'keep' && !w.got.some(m => m.t === 'map'), 'the host can\'t lock Sky Ruins in a current room: it stays on the keep');
  // a match ends: the rematch stays on the keep (the rotation is off)
  cur.message(id, { t: 'matchDebug', endTime: 0.3, recapTime: 0.3 });
  for (let i = 0; i < 40 && !w.got.some(m => m.t === 'matchPhase' && m.match?.phase === 'live'); i++) await wait(100);
  cur.message(id, { t: 'matchDebug', skip: true });   // (live: ends the match)
  await wait(2500);
  const ph = w.got.filter(m => m.t === 'matchPhase').map(m => `${m.match?.phase}:${m.match?.map?.id}`);
  const ended = ph.findIndex(s => /^(end|recap)/.test(s)), again = ph.findIndex((s, i) => i > ended && /^countdown|^live/.test(s));
  ok(ended >= 0 && again > ended && ph.every(s => s.endsWith(':keep')) && !w.got.some(m => m.t === 'map'), `after a finished match the next is on the keep again (${ph.join(' ')})`);
  // Arcane Grasp from the wall-walk: the prop up there lifts
  C.setActiveMap('keep');   // (the other rooms' ticks leave map.js on their maps)
  const iWall = C.PROP_SPAWNS.findIndex(p => p[3] > 4);
  const [, px, pz, py] = C.PROP_SPAWNS[iWall];
  const pid = iWall + 1;
  const along = Math.abs(Math.abs(px) - 12) < 2.5 && Math.abs(pz) < 10 ? [0, 1] : [1, 0];   // (along the walk)
  const sx = px + along[0] * 2, sz = pz + along[1] * 2;
  cur.message(id, { t: 'debugPlace', p: [sx, py, sz], yaw: Math.atan2(px - sx, pz - sz) });
  await wait(400);
  const from = [sx, py + 1.6, sz], d = [px - sx, py + 0.4 - from[1], pz - sz], n = Math.hypot(...d);
  const n0 = w.got.length;
  cur.message(id, { t: 'pickup', aimOrigin: from, aimDir: d.map(v => v / n), id: pid });
  await wait(1300);
  const st = w.got.slice(n0).filter(m => m.t === 'prop' && m.prop.id === pid).map(m => m.prop.state);
  ok(st.includes('carried') || st.includes('lifting'), `Arcane Grasp lifts the ${C.PROP_SPAWNS[iWall][0]} on the wall-walk (${st})`);
  // a wizard dropped below the ground (the moat is ground level): no void death on the keep
  const n1 = w.got.length;
  cur.message(id, { t: 'debugPlace', p: [0, -2, -16.5] });
  await wait(600);
  ok(!w.got.slice(n1).some(m => m.t === 'death'), 'no void: a wizard put below the moat isn\'t killed');
  clearInterval(tick);
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
