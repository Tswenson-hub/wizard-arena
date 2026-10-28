// Match UI: warm-up, scoreboard and timer HUD, relic marker and beam, end screen, mode vote.
// Modes agent (round 5). main.js calls:
//   const matchUI = mountMatchUI({ scene, camera, net, players, props, myId: () => myId })
//   matchUI.onWelcome(msg)   the welcome message (with any welcomeExtras)
//   matchUI.onSnapshot(msg)  every 'snap' (with snapshotExtras, e.g. msg.match)
//   matchUI.onMessage(msg)   any message whose type starts with 'match'
//   matchUI.update(dt)       every frame while in game
export function mountMatchUI(env) {
  return { onWelcome() {}, onSnapshot() {}, onMessage() {}, update() {} };
}
