# Brief: modes agent (round 5: game modes)

Read `docs/agents/shared-rules.md` first, then `README.md` for what the game is. You're new: the spells, characters
and environment agents have built the game so far (their hand-offs are in this folder).

## Goal (Ty approved)
The server runs **one arena** in a loop: warm-up, then a match, then the end screen, then a vote on the next mode,
then the next match. Three modes:

| Mode | Teams | Win | Cap |
|---|---|---|---|
| **Free-for-all** | none | first to 15 kills | 8 min: most kills wins |
| **Team Deathmatch** | 3v3 (Ember vs Frost) | first team to 30 kills | 8 min |
| **Sacred Relic** | 3v3 | first team to 300 points | 8 min |

### Match flow
1. **Warm-up:** about 10 s. Players can move but not score.
2. **Match:** a timer, score and objective HUD.
3. **End screen:** winner, MVP, and per-player kills, deaths, damage and points.
4. **Vote:** about 15 s, on FFA, TDM or Relic. Majority wins; ties keep the current mode.
5. **Reset:** players respawn on their side, props and goats reset, ultimate charge goes to 0, and the next match starts.

### Teams
- Players are auto-balanced on join, and mid-match joiners go to the smaller team.
- **Bots fill team modes to 3v3** (Ty's decision). They use the difficulty set on the join screen (the most recent
  human's choice), and a bot leaves when a human needs the slot. FFA keeps today's practice-bot behaviour.
- **No friendly fire:** `isEnemy(a, b)` decides. In FFA everyone is an enemy. Goats still charge anyone.
- **Team colours:** the ring and nameplate use the team colour (Ember red-orange, Frost blue) in team modes, and the
  wizard's own colour in FFA. Send this to clients so the spells agent's rendering can use it.
- Each team spawns on its own side: Ember north (house side), Frost south (meadow side). File the spawn positions
  for `map.js` as a request to the environment agent, or propose them yourself in `requests.md`.

### Sacred Relic
- **Every 30 s,** a random idle prop becomes the relic. Eligible: crate, barrel, pot, hay, potion barrel; never a goat.
  It keeps being the relic while dropped. After 30 s it **moves to another random prop, even if someone is holding it**.
- **The holder** (the player whose telekinesis holds it) scores **+5 points per second** for their team and **+2%
  ultimate charge per second** (`ctx.addUltCharge`).
  - The holder can't cast while holding, as with any held object.
  - **The relic can't be thrown:** F on the relic releases it gently (`canThrow` returns false, so the server turns the
    throw into a drop).
  - A hit that knocks the object away drops it.
- **The holder dies:** reset. A new random prop becomes the relic and the 30 s timer restarts.
- **Dropped:** anyone can lift it (the other team scores while they hold it).
- **Visuals** (your `match-ui.js`, through the scene handle `main.js` passes you): a golden glow and shell on the relic prop,
  a vertical light beam visible across the map, an off-screen arrow pointing to it, and a "+5" ticker over the holder.
- **HUD:** both team scores, the relic timer, and who holds it.

### Bot objectives (`server/objectives.js`)
`objectiveFor(bot)` returns hints that `server/bots.js` (spells agent) follows:
`{ moveTo: [x,z] | null, focus: playerId | null, guard: playerId | null, lift: propId | null }`.
- **Relic, free:** the nearest bot of each team goes to lift it (`lift`). The others guard that bot or move toward the relic.
- **Relic, held by a teammate:** guard the holder (stay within about 8 m, `focus` whoever last damaged them).
- **Relic, held by an enemy:** `focus` the holder.
- **TDM:** `focus` the weakest enemy in sight, and never a teammate.

## Files (yours)
- `server/match.js`, `server/objectives.js`, `public/js/match-ui.js`, `public/css/match.css`
- `tools/test/modematch.mjs` (new): a headless harness like `botmatch.mjs` that runs a mode and reports
  scores, teams, friendly-fire events (should be 0) and relic events.

The coordinator has already put **stubs and hook calls** into `server.js` and `main.js` (see "Hooks" in
`server/match.js`). Fill in the stubs. If you need another hook in a file you don't own, ask in `requests.md`.

## Verify (port 4104)
- `modematch` for each mode, with bot fill:
  - TDM reaches 30 within the cap
  - Relic reaches 300 within the cap
  - teams stay 3v3
  - 0 friendly-fire hits
  - the relic resets on holder death and rotates every 30 s
  - points only accrue while it's held
- **Playwright:**
  - join FFA, finish the match (set a low target through a debug flag), vote TDM, and see teams and bots fill in
  - in Relic, lift the relic and watch the score and ultimate ring rise; die and see the relic move
  - screenshot the lobby, end screen, vote, relic beam and HUD, and look at them

Finish with `docs/agents/modes-handoff.md`.
