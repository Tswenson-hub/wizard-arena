// Match and game modes: FFA / Team Deathmatch 3v3 / Sacred Relic 3v3, teams, scoring, the relic, the
// end-of-match vote and bot fill. Modes agent (round 5); see docs/agents/modes.md.
//
// Hooks: server.js calls these. Keep the names and signatures; fill in the bodies.
//   isEnemy(a, b)            players: may a hurt b? (no friendly fire in team modes; FFA: anyone but yourself)
//   spawnPointFor(p)         [x, 0, z] or null for the default random spawn
//   onJoin(p) / onLeave(p)   a human or bot entered or left
//   onDamage(target, attacker, dmg)   attacker may be undefined (goats, environment)
//   onKill(target, attacker, cause)
//   onPickup(p, prop)        a prop started rising toward p (telekinesis)
//   onDrop(p, prop, reason)  'dropped' | 'released' | 'destroyed' | 'thrown'
//   onPropBroken(prop)
//   canThrow(p, prop)        false: the server turns the throw into a gentle drop (the relic)
//   tick(dt)                 every simulation step
//   handle(p, msg)           messages server.js doesn't know (e.g. { t: 'vote', mode })
//   playerExtras(p)          merged into playerPublic (e.g. { team })
//   snapshotExtras()         merged into every 'snap' broadcast (e.g. { match: {...} })
//   welcomeExtras(p)         merged into the 'welcome' message
//
// ctx (from server.js): { players, props, now, broadcast, send, addBot, removePlayer, respawn,
//   propPublic, addUltCharge(p, pct) }

export function createMatch(ctx) {
  return {
    isEnemy: (a, b) => !!a && !!b && a.id !== b.id,
    spawnPointFor: () => null,
    onJoin() {}, onLeave() {},
    onDamage() {}, onKill() {},
    onPickup() {}, onDrop() {}, onPropBroken() {},
    canThrow: () => true,
    tick() {},
    handle() { return false; },
    playerExtras: () => ({}),
    snapshotExtras: () => ({}),
    welcomeExtras: () => ({}),
  };
}
