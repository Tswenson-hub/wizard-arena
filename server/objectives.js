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
      hint.moveTo = spot(N);
      hint.area = [N.x, N.z, N.r];
      return hint;
    }
  }

  // enemies in the circle: the one deepest in
  const intruders = enemies.filter(e => dist(flat(e), c) <= Z.r + 1).sort((a, b) => dist(flat(a), c) - dist(flat(b), c));
  if (intruders.length) hint.focus = intruders[0].id;
  // stand in the circle: walk to our spot, and once inside, stay inside (strafe within it, don't kite out)
  hint.area = [Z.x, Z.z, Z.r];
  if (dist(me, c) > Z.r * 0.8 || !intruders.length) hint.moveTo = spot(Z);
  return hint;
}
