// Bot objective hints for game modes. Modes agent (round 5).
// server/bots.js (spells agent) asks objectiveFor(bot, world) each think tick and follows any hint given:
//   { moveTo: [x, z] | null, focus: playerId | null, guard: playerId | null, lift: propId | null }
// Return null to let the bot fight normally (FFA does).
import * as C from '../public/shared/constants.js';

const SIGHT = 40;          // farthest a TDM bot looks for a weakest target
const GUARD_RANGE = 8;     // a guard stays this close to the relic holder
const HOME = { ember: [0, 12], frost: [0, -20] };   // where a relic holder retreats to

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

  // Sacred Relic
  const prop = match.relicProp();
  if (!prop || prop.state === 'broken' || prop.state === 'thrown') return null;
  const carrier = (prop.state === 'carried' || prop.state === 'lifting') ? world.players.get(prop.carrier) : null;
  const at = carrier ? flat(carrier) : [prop.x, prop.z];

  if (!carrier) {
    // free: the nearest bot of each team goes to lift it; the rest escort that bot or head there
    const mates = players.filter(p => p.bot && p.team === bot.team);
    const lifter = mates.sort((a, b) => dist(flat(a), at) - dist(flat(b), at))[0];
    if (lifter === bot) {
      hint.lift = prop.id;
      hint.moveTo = at;
    } else {
      hint.moveTo = at;
      if (lifter) hint.guard = lifter.id;
      // shoot whoever is going for it on the other side
      const rival = enemies.filter(e => dist(flat(e), at) < 15 && sees(bot, e)).sort((a, b) => dist(flat(a), at) - dist(flat(b), at))[0];
      if (rival) hint.focus = rival.id;
    }
    return hint;
  }

  if (carrier === bot) {
    // holding it: get back toward our own side, away from the enemy
    hint.moveTo = HOME[bot.team] || null;
    return hint;
  }

  if (!match.isEnemy(bot, carrier)) {
    // a teammate holds it: guard them, punish whoever last hurt them
    hint.guard = carrier.id;
    if (dist(flat(bot), at) > GUARD_RANGE) hint.moveTo = at;
    const attacker = carrier.lastHitBy && world.players.get(carrier.lastHitBy);
    if (attacker && !attacker.dead && match.isEnemy(bot, attacker)) hint.focus = attacker.id;
    else {
      const near = enemies.filter(e => dist(flat(e), at) < 14).sort((a, b) => dist(flat(a), at) - dist(flat(b), at))[0];
      if (near) hint.focus = near.id;
    }
    return hint;
  }

  // an enemy holds it: everyone on them
  hint.focus = carrier.id;
  hint.moveTo = at;
  return hint;
}
