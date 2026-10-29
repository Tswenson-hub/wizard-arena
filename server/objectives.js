// Bot objective hints for game modes. Modes agent (round 5).
// server/bots.js (spells agent) asks objectiveFor(bot, world) each think tick and follows any hint given:
//   { moveTo: [x, z] | null, focus: playerId | null, guard: playerId | null, lift: propId | null }
//   Altar Siege also sends area: [x, z, r]: stay inside this circle while fighting (strafe within it, don't kite out).
// Return null to let the bot fight normally (FFA does).
import * as C from '../public/shared/constants.js';

const SIGHT = 40;          // farthest a TDM bot looks for a weakest target

const flat = (p) => [p.p[0], p.p[2]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const sees = (a, b) => !C.pillarBlocks(a.p, b.p, 0.1);

// Bots walk straight at moveTo and have no pathfinding, so a long wall (the felled silo, the barn, the archway legs)
// can pin them. route() returns moveTo itself when the way is clear, else one waypoint both legs of which are clear.
const BODY = 0.5;
function blocked(a, b) {
  const sx = b[0] - a[0], sz = b[1] - a[1], ll = sx * sx + sz * sz || 1;
  for (const c of C.COLLIDERS) {
    if (c.h < 0.5) continue;
    const k = Math.max(0, Math.min(1, ((c.x - a[0]) * sx + (c.z - a[1]) * sz) / ll));
    if (Math.hypot(a[0] + sx * k - c.x, a[1] + sz * k - c.z) < c.r + BODY) return true;
  }
  return false;
}
const RING = Array.from({ length: 16 }, (_, i) => [Math.cos(i * Math.PI / 8), Math.sin(i * Math.PI / 8)]);
function route(bot, to, now) {
  const from = flat(bot), r = bot.routeCache;
  if (r && now < r.until && dist(r.to, to) < 0.5) return r.wp;
  let wp = to;
  if (dist(from, to) > 2 && blocked(from, to)) {
    let best = null, bl = Infinity, fallback = null, fd = Infinity;
    for (const [base, radii] of [[to, [5, 9, 14]], [from, [4, 8]]]) {
      for (const d of radii) for (const [cx, cz] of RING) {
        const w = [base[0] + cx * d, base[1] + cz * d];
        if (Math.hypot(w[0], w[1]) > C.ARENA_RADIUS - 1 || blocked(from, w)) continue;
        const l = dist(from, w) + dist(w, to);
        if (!blocked(w, to)) { if (l < bl) { bl = l; best = w; } }
        else if (dist(w, to) < fd) { fd = dist(w, to); fallback = w; }
      }
    }
    wp = best || fallback || to;
  }
  bot.routeCache = { to, wp, until: now + 0.4 };
  return wp;
}

export function objectiveFor(bot, world) {
  const match = world?.match;
  if (!match?.state || bot.dead) return null;
  const S = match.state();
  if (S.mode === 'ffa' || S.phase !== 'live') return null;
  const players = [...world.players.values()].filter(p => !p.dead && !p.spectator);
  const enemies = players.filter(p => match.isEnemy(bot, p));
  const hint = { moveTo: null, focus: null, guard: null, lift: null };

  if (S.mode === 'tdm') {
    // the weakest enemy in sight; never a teammate (enemies are filtered by isEnemy)
    let best = null, bh = Infinity;
    for (const e of enemies) {
      if (dist(flat(e), flat(bot)) > SIGHT || !sees(bot, e)) continue;
      const score = e.hp + dist(flat(e), flat(bot)) * 0.5;
      if (score < bh) { bh = score; best = e; }
    }
    if (best) hint.focus = best.id;
    return best ? hint : null;
  }

  // Altar Siege
  if (S.mode !== 'siege' || !S.zone) return null;
  const Z = match.zoneAt(S.zone.i), N = match.zoneAt(S.zone.i + 1);
  const me = flat(bot), c = [Z.x, Z.z];
  // each bot holds its own spot inside the circle (spread by id, so they don't stack on the centre)
  const spot = (zone) => { const a = bot.id * 2.39996, k = zone.r * (0.25 + (bot.id % 3) * 0.17); return [zone.x + Math.cos(a) * k, zone.z + Math.sin(a) * k]; };

  // the last 10 s before a hop: one bot per team (the closest to the next spot) goes ahead to take it
  const hopIn = S.zone.hopAt - world.now();
  if (!S.overtime && hopIn <= 10) {
    const mates = players.filter(p => p.bot && p.team === bot.team && !p.dummy);
    const scout = mates.length >= 2 && mates.sort((a, b) => dist(flat(a), [N.x, N.z]) - dist(flat(b), [N.x, N.z]))[0];
    if (scout === bot) {
      hint.moveTo = route(bot, spot(N), world.now());
      hint.area = [N.x, N.z, N.r];
      return hint;
    }
  }

  // enemies in the circle: the one deepest in
  const intruders = enemies.filter(e => dist(flat(e), c) <= Z.r + 1).sort((a, b) => dist(flat(a), c) - dist(flat(b), c));
  if (intruders.length) hint.focus = intruders[0].id;
  // stand in the circle: walk to our spot, and once inside, stay inside (strafe within it, don't kite out)
  hint.area = [Z.x, Z.z, Z.r];
  if (dist(me, c) > Z.r * 0.8 || !intruders.length) hint.moveTo = route(bot, spot(Z), world.now());
  return hint;
}
