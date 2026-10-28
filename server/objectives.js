// Bot objective hints for game modes. Modes agent (round 5).
// server/bots.js (spells agent) asks objectiveFor(bot, world) each think tick and follows any hint given:
//   { moveTo: [x, z] | null, focus: playerId | null, guard: playerId | null, lift: propId | null }
// Return null to let the bot fight normally (FFA does).
export function objectiveFor(bot, world) {
  return null;
}
