# Modes agent hand-off (rounds 5 and 8: game modes; Altar Siege replaced Sacred Relic)

## What I built
**`server/match.js`** (the hooks server.js calls):
- **The match loop runs one arena:**
  - warm-up (10 s; you can move and fight, but nothing counts)
  - live (to the target or the 8 min cap; the higher score wins, a tie is a draw)
  - end screen (8 s)
  - vote (15 s)
  - reset
- **The reset** respawns everyone on their side, puts props back at `PROP_SPAWNS`, calls `ctx.resetGoats()` and `ctx.resetUlt(p)`,
  and zeroes K/D/damage/capture. Ultimate charge is zeroed again at go-live.
- **The loop pauses when no human is connected** and starts with a warm-up when one arrives. The server keeps the last mode.
- **Modes** (numbers in `MODES` at the top of match.js):
  - FFA: 15 kills.
  - TDM 3v3: 30 team kills.
  - **Altar Siege 3v3: first team to 100%.**
- **Votes:** humans only, `{ t: 'vote', mode }` with `ffa | tdm | siege`, keys 1/2/3 or a click. The majority wins; a tie keeps the current mode.
- **Teams (Ember north, Frost south):**
  - Humans are split evenly on a mode change, and a joiner goes to the side with fewer humans.
  - `isEnemy`: in FFA everyone else is an enemy, in team modes the other team. During the end screen and the vote nobody is.
- **Bot fill:** team modes are topped up to 3v3 (or ⌈humans/2⌉ a side) at the most recent human's difficulty. Surplus bots make way
  for humans. FFA keeps only the bots people added.
- **Altar Siege:**
  - **Zones:** a 7 m circle at `C.SIEGE_ZONES` (the environment agent's: The Altar (0, −7), Barn Passage (10, 4), Fallen Silo (−22, −19)).
    There's a fallback if map.js lacks them.
  - **Hops:** altar → barn → silo → altar every 60 s. A `matchZone: warn` 5 s before, then `hop`.
  - **Occupancy each tick:** living, team, not a spectator, feet no higher than 2.5 m, within r.
  - **Scoring:**
    - One team alone fills its bar at 1%/s, or 1.5%/s with 2+ inside.
    - Each holder gets an equal share as `pts` (capture %) and +1% ultimate charge a second (`ctx.addUltCharge`).
    - Both teams inside is **contested**: nothing fills.
  - **Overtime:** if the cap hits while contested, play goes on until the zone isn't contested, at most 30 s more (`matchOvertime`).
    The zone doesn't hop during overtime.
  - **Fair respawns:** in a live siege, a wizard respawns at the team spawn whose distance to the current zone best matches the other
    team's closest spawn. It's still on its own side and never within 8 m of a living enemy. Without this, the zone next to a team's
    spawn was theirs for the taking.
  - **Results** carry `siege: { hold: [{ name, ember, frost }] (seconds), contested, empty, hops, overtime }`.
- **The relic is gone:** its mode, logic, events and `protectProp`. `canThrow` stays as a hook but always returns true, so
  telekinesis throws normally everywhere.
- **MVP** = kills×100 + damage + capture%×10 − deaths×30.
- **What clients get:**
  - `playerPublic`: `team`, `teamColor`, `dmg`, `pts`.
  - `snap.match`: `{ mode, phase, left, target, teams, scores (siege: bars to 0.1), zone: { i, x, z, r, name, owner, contested,
    inside: { ember, frost }, next: { x, z, r, name }, nextAt }, overtime, votes }`.
  - Messages: `matchPhase`, `matchEnd`, `matchVotes`, `matchMode`, `matchZone` (warn, hop, held, contested, empty) and `matchOvertime`.

**`server/objectives.js`:** `objectiveFor(bot, world)`:
- **FFA, or outside a live match:** null.
- **TDM:** `focus` the weakest visible enemy.
- **Siege:**
  - Every bot gets `area: [x, z, r]` (the circle) and a `moveTo` toward its own spot inside it (spread by bot id).
  - `focus` the enemy deepest in the circle.
  - In the last 10 s before a hop, one bot per team (the closest) scouts the next spot.
  - **Routing:** bots walk straight at `moveTo` and the felled silo pinned Frost bots, so `route()` swaps in one waypoint whose two legs
    are clear of colliders (h ≥ 0.5), re-planned every 0.4 s.
  - **New hint field `area`:** I asked the spells agent to keep fighting bots inside it (requests.md).

**`public/js/match-ui.js` + `public/css/match.css`:**
- **Top bar:** clock (`OT n` in overtime). In siege, the team boxes show bars as %, both flash Ember/Frost while contested, the holder
  glows, and "+1%"/"+1.5%" ticks float off the holding team's box.
- **Zone line:** the zone name, then the state:
  - holding team and rate, `CONTESTED · 2 v 1` (flashing) or "stand in the circle"
  - "you're in"
  - "moves in Ns", which turns into "moves to Barn Passage in 3s" for the warning
- **In the world:**
  - **The circle:** a thick edge, a turning band of rune arcs, a faint disc, a 2.2 m wall of light and a centre beam that fades
    when you're near. It's gold when neutral, the team colour when held, and flickers in both colours when contested.
  - **The next spot:** a blinking ghost ring and a beam during the warning.
  - **Arrows:** off-screen ZONE and NEXT arrows at the screen edge.
- **Vote card:** Altar Siege.
- **End screen:** bars as %, a "Cap" column, and the per-zone hold split plus contested time.
- `matchUI.state()` returns the latest match state.

**Tests**
- **`tools/test/modematch.mjs <port> <ffa|tdm|siege> <secs> [difficulty] [--target N] [--cap S] [--hop S] [--bots N]`:** needs `MATCH_DEBUG=1`.
  It joins as a spectator and reports:
  - scores, the per-player table, team sizes and friendly-fire hits
  - siege: hop intervals, held/contested/empty time, the per-zone hold split, overtime, and any bar gain while the zone wasn't held
    alone (tolerance: two snapshot intervals)
- **`tools/test/modematch-unit.mjs`:** 40 rule checks against a fake ctx. The relic checks are gone. New siege checks cover:
  - empty, 1%/s, 1.5%/s, ult charge, contested
  - dead or high fliers don't count
  - the warning, the hop and the next hop at 60 s
  - overtime start and end, the 30 s overtime limit, the 100% win, the hold split in results
  - canThrow is true
- **Debug** (`MATCH_DEBUG=1` only): `{ t: 'matchDebug', target, cap, warmup, endTime, voteTime, hop, overtime, botDiff, mode, skip,
  spectate, dummy: { team, x, z } | false, pinBots: true | false }`.
  - `dummy` is a pinned, bound bot of a team, used to test contesting.
  - `pinBots` freezes every bot where it stands.

## How I verified it (port 4104, MATCH_DEBUG=1, a snapshot of the working tree in /tmp/wa-modes/wip)
**Hard-bot siege runs**, after the routing and fair-respawn fixes:

| result | time | contested | per-zone holds, Ember/Frost (s) |
|---|---|---|---|
| Ember 100–73.8 | 322 s | 56% | Altar 20.7/21.5 · Barn 34.7/15.5 · Silo 19.7/19.7 |
| Ember 100–39.1 | 276 s | 60% | Altar 18.6/10.4 · Barn 33.5/11.8 · Silo 20.5/8.7 |
| Ember 100–43.6 | 294 s | 62% | Altar 16.5/15.2 · Barn 41.9/8.2 · Silo 14.2/10.6 |

- **Every run:** hops exactly every 60 s, 0 friendly fire, 3v3 throughout, 0 bar gain while the zone wasn't held alone, no overtime.
- **Before the fixes:** 5 runs, Ember won all 5, and Frost held the Fallen Silo about 0 s (bots were stuck on the silo body).
- **`modematch-unit.mjs`:** all 40 checks pass.
- **Playwright** (`/tmp/wa-modes/siege_e2e.py`; screenshots in `/tmp/wa-modes/siege/` and `/tmp/wa-modes/siege-1793239675/`):
  - **Telekinesis:** a lifted prop is thrown as a projectile, and there's no relic UI.
  - **Vote:** pressing 3 votes Altar Siege (tally 1), and the mode switches. The warm-up shows the circle at The Altar.
  - **Holding:** standing in the zone (bots pinned), my team's bar went 2.8 → 6.6 at +1.5%/s, and the line read "Ember holding · you're in".
  - **Contest:** a frost dummy in the zone shows CONTESTED · 2 v 1 and the bars flash.
  - **Hop:** the warning reads "moves to Barn Passage in 3s", then the zone moves to Barn Passage with a banner and a ZONE arrow.
  - No page errors.
  - Screenshots: `s1_vote`, `s2_warmup_circle` (the bolder circle is in the second folder), `s3_holding`, `s4_contested`,
    `s5_hop_warning`, `s6_arrows`, `s7_after_hop`.

## Known issues / for Ty and the coordinator
- **Ember is favoured in siege by the Barn Passage spot:** Ember's spawns average 14 m from it, Frost's 34 m. With Hard fill Ember
  won 8 of 8 overall: 5 before my fixes, 3 after (the Altar and the Silo now come out about even).
  - **Tried:** moving the barn zone to (12, −3) in a scratch copy gave Frost 1 win in 3.
  - **Filed:** the request to the environment agent, with numbers.
  - **Options:** move the barn spot, add a Frost-side fourth zone, or shuffle the rotation.
- **Contested time is high (52–62% of live time)** with bots, because every bot goes to the zone. Humans will spread out more.
  Matches still finish in 3–5.5 min, well within the cap.
- **Spells-side relic cleanup** is listed line by line in requests.md (`hitProp`/`protectProp` callers, the `canThrow` drop, `relicId`
  and the Drop label/hint in main.js, bots' `lift`/`canThrow` code). It's all dead code now: nothing in match.js triggers it.
  The `area` hint is also requested there.
- **Not done yet: port 3000.** I haven't updated or verified Ty's port 3000 from the play copy. That port isn't mine, so it's
  left for the coordinator.
- **Earlier notes still hold:** team-mode addBot is trimmed to 3v3 (the buttons are disabled there), and goat kills don't score.
