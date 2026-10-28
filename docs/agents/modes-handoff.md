# Modes agent hand-off (round 5: game modes)

## What I built
**`server/match.js`** (the hooks server.js calls):
- **The match loop runs one arena:**
  - warm-up (10 s; you can move and fight, but nothing counts)
  - live (to the target, or the 8 min cap, when the higher score wins and a tie is a draw)
  - end screen (8 s)
  - vote (15 s)
  - reset
- **The reset** respawns everyone on their side, puts props back at `PROP_SPAWNS`, calls `ctx.resetGoats()`, calls
  `ctx.resetUlt(p)` and zeroes K/D/damage/points. Ultimate charge is also zeroed when the match goes live, so nothing
  carries over from the warm-up.
- **The loop pauses when no human is connected** and restarts with a warm-up when one arrives. The mode is kept between sessions.
- **Modes:**
  - FFA: 15 kills.
  - TDM 3v3: 30 team kills.
  - Sacred Relic 3v3: 300 points.
  - The numbers are in `MODES` at the top of match.js.
- **Votes:** humans only, `{ t: 'vote', mode }`, keys 1/2/3 or a click. The majority wins; a tie (or no votes) keeps the current mode.
- **Teams (Ember north, Frost south):**
  - On a mode change, humans are split evenly at random.
  - A joiner goes to the team with fewer humans.
  - `isEnemy`: in FFA everyone else is an enemy. In team modes the other team is. During the end screen and the vote,
    nobody is an enemy (an intermission).
- **Bot fill:**
  - Team modes are topped up to 3v3 (or ⌈humans/2⌉ a side if there are more than 6 humans), once a second, with a 1.5 s grace period after a human joins.
  - Fill bots use `S.botDiff`: the most recent human's join-screen difficulty (`p.botPref`), or the difficulty of the last bot a human added.
  - Surplus bots leave, old-difficulty bots first, so a human always gets a slot.
  - In FFA the fill bots leave, and bots people added themselves stay.
- **Spawns:** each team spawns at the point on its side farthest from living enemies. It uses `C.TEAM_SPAWNS` if map.js exports it
  (requested from the environment agent), else the north/south subsets of `SPAWN_POINTS`.
- **Sacred Relic:**
  - Eligible props: crate, barrel, pot, hay, potion, idle and not cursed.
  - The holder (the prop `carried` by them) gives their team +5/s and gets +2%/s ultimate charge (`ctx.addUltCharge`).
  - `canThrow` is false, so F sets it down.
  - `protectProp` is true, so a hit knocks it loose (server.js drops it idle where it was hit) instead of shattering it.
  - It moves to a new random prop every 30 s, even while held. The old one becomes an ordinary prop again.
  - When the holder dies (`onDrop(…, 'destroyed')`), a new relic appears and the 30 s timer restarts.
  - There's a fallback for a shatter that didn't ask `protectProp`: the relic is restored idle on the next tick.
- **Stats:** per player kills, deaths, `dmg` and `pts`. MVP = kills×100 + damage + points×4 − deaths×30.
- **What clients get:**
  - `playerPublic` gains `team`, `teamColor`, `dmg` and `pts`.
  - Every snapshot carries `match: { mode, phase, left, target, teams, scores, relic: { propId, holder, team, left, x, z }, votes }`.
  - Messages: `matchPhase`, `matchEnd` (results), `matchVotes`, `matchMode` and `matchRelic` (spawn, rotate, reset, lift, drop, holderDied).

**`server/objectives.js`:** `objectiveFor(bot, world)`:
- **FFA, or outside a live match:** null.
- **TDM:** `focus` the weakest visible enemy (HP + distance/2, pillars block sight).
- **Relic, free:** the nearest bot of each team gets `lift` + `moveTo`. Its teammates head there, `guard` that bot and `focus` the
  nearest rival near the relic.
- **Relic, held by a teammate:** `guard`, a `moveTo` if they're more than 8 m away, and `focus` whoever last hit the holder
  (else the nearest enemy).
- **Relic, held by an enemy:** everyone `focus`es the holder.
- **The holder bot:** `moveTo` back toward its own side.

**`public/js/match-ui.js` + `public/css/match.css`** (the CSS is linked from the JS, since index.html isn't mine):
- **Top bar:**
  - The mode and the clock (red under 30 s).
  - Team modes add Ember and Frost score boxes, each with a progress bar and an outline on your own team.
  - FFA shows your kills and the leader instead.
- **Banners:** the warm-up banner (mode and rules), a 3-2-1 countdown, and "Fight!".
- **Relic HUD:** the relic line (who holds it, +5/s, a "moves in Ns" countdown) and a small event ticker.
- **Relic in the world:**
  - A golden shell and wireframe cage with a point light.
  - A 70 m light beam that takes the holder's team colour and fades when you stand next to it.
  - A pulsing ground ring and rising "+5" sprites over the holder.
  - An off-screen arrow at the screen edge pointing at the relic.
- **End screen:** the winner, the final team score, the MVP, and a table of K, D, damage and points (points in Relic).
- **Vote panel:** three cards with live tallies, your pick highlighted, and "current · wins ties".
- **Rings:** each wizard's ring takes its team colour (the spells agent now does the ring and nameplate too, via `teamColor`).
- **`matchUI.state()`** returns the latest match state.

**Tests**
- **`tools/test/modematch.mjs <port> <ffa|tdm|relic> <secs> [difficulty] [--target N] [--cap S] [--rotate S] [--bots N]`:** needs
  `MATCH_DEBUG=1` on the server. It joins as a **spectator** (no team, can't be hurt, nobody targets it), switches mode with a 2 s warm-up,
  and reports:
  - scores and the per-player table
  - team sizes sampled every snapshot
  - friendly-fire hits (a `hit` with dmg > 0 between teammates)
  - relic events, rotation intervals, and points gained while held vs free

  It exits 1 if a check fails.
- **`tools/test/modematch-unit.mjs`** (new; it sits in the coordinator's `tools/test/`, so move it if you prefer): 28 rule checks
  against a fake ctx with a simulated clock. It covers fill and trim, the mid-match joiner, isEnemy, TDM scoring, the vote tie rule,
  relic scoring and ultimate charge, canThrow, knock-loose, holder-death reset and rotation while held.
- **Debug message** (only with `MATCH_DEBUG=1`): `{ t: 'matchDebug', target, cap, warmup, endTime, voteTime, rotate, botDiff, mode, skip, spectate }`.
  It's ignored without the env var.

## How I verified it (port 4104)
I tested against a snapshot of the working tree (the spells agent's WIP, with protectProp, resetUlt, resetGoats, `isEnemy` in bots
and objective following) copied to `/tmp/wa-modes/wip`.

| run | result | time | FF hits | teams | relic |
|---|---|---|---|---|---|
| TDM, normal | 30–25 | 277 s | 0 | 3v3 in all 5388 samples | |
| TDM, hard | 30–18 | 463 s | 0 | 3v3 in all 5502 samples | |
| Relic, normal | 300–200 | 151 s | 0 | 3v3 in all 2940 samples | 22 lifts, 17 holder deaths → 17 resets, points while free: 0 |
| Relic, hard | 300–174 | 151 s | 0 | 3v3 in all 3996 samples | 30 lifts, 14 knocked loose, 14 holder deaths → 14 resets, points while free: 0 |
| FFA, 4 normal | Vexlith 15 | 404 s | 0 | – | |
| Relic, `--rotate 5` (HEAD bots) | | | | | rotation intervals [5, 5, 5] |

- In real Relic matches every relic died with its holder before 30 s, so rotation is checked by the `--rotate` run and the unit test.
- `modematch-unit.mjs`: all 28 checks pass.
- **Playwright** (`/tmp/wa-modes/modes_e2e.py`; screenshots in `/tmp/wa-modes/shots/`). These steps all passed:
  1. Join FFA (target 1 by debug) and play the match to the end. The end screen shows the winner, the MVP and the table.
  2. Press 2 to vote TDM. The tally shows 1, the mode switches, and teams fill to 3v3 with Ember and Frost rings (`ff6a2a` / `3aa8ff`).
  3. Switch to Relic and lift the relic. Ember's score went 7 → 31 and my ultimate went 15% → 28% in about 5 s.
  4. Press F on the relic. It reports `drop`, not a throw.
  5. Hold it until enemy bots kill me. `holderDied` → `reset` to a new prop, and the arrow points at it.
  6. No page errors.

  Screenshots: `1_lobby`, `2_ffa_warmup`, `3_ffa_live`, `4_end`, `5_vote`, `6_tdm_hud`, `7_relic_beam`, `8_relic_arrow`,
  `9_relic_held` (shell, beam, Cataclysm ring at 21%), `10_relic_moved`.

## Known issues / for Ty and the coordinator
- **Relic matches are short:** 300 points takes about 2.5 min with bots (60 s of holding). That is the approved number, but if the
  mode should last longer, raise `MODES.relic.target` (600 gives about 5 min) or lower `RELIC.points`.
- **Hard-bot TDM** took 463 s of the 480 s cap. Some hard matches will end on time, when the higher score wins.
- **TEAM_SPAWNS** is still requested from the environment agent (see requests.md). The fallback points work.
- **In team modes, bots people add are trimmed back to 3v3**, and "Remove all" is refilled. The spells agent disables those buttons in team modes.
- **The relic hint text in main.js** ("F hurl") is requested from the spells agent: F actually sets the relic down.
- **Goats can still kill anyone in team modes.** Goat kills don't score in TDM. A thrown goat is credited to its thrower through `applyHit`, so it follows `isEnemy`.
- **The server keeps the last mode** after everyone leaves, so the next visitor starts in that mode.
