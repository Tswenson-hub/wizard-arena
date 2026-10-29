# Altar Siege: replaces Sacred Relic (Ty approved)

## Context
Ty finds Sacred Relic doesn't work. It needed heavy changes or replacing, and the map size question is on hold. Ty
picked **Altar Siege**, a 3v3 king-of-the-hill mode built for this cast: walls, Firewall, Night Cage, Frostfall, Stampede,
Cyclone and Tempest Veil are all tools for holding or breaking a spot. It also suits the new walking speed and the current
map size. Bots can play it without pathfinding, because the objective is "stand here".

## Rules
- **Teams:** 3v3, Ember vs Frost, bot fill, the existing warm-up → live → end → vote loop (`server/match.js`).
- **The zone:** a glowing rune circle, radius about 7 m.
  - It starts at the **altar**, then **hops every 60 s**: altar → barn passage → by the fallen silo → altar.
  - Exact spots come from the environment agent, in the open near each landmark.
  - A 5 s warning before each hop shows where it's going: a ghost circle and an arrow.
- **Scoring:**
  - **One team's living wizards in the zone, nobody from the other team:** that team's bar fills at **1% per second**,
    or 1.5% with 2+ of them inside.
  - **Both teams inside:** **contested**. Nothing fills, and the circle flickers in both colours.
  - **Empty:** nothing happens.
  - **First to 100%** wins, with the usual 8-minute cap (highest bar wins).
- **Overtime:** if the cap hits while the zone is contested, the match can't end until it isn't, with a hard extra 30 s.
- **Ultimate charge:** +1% per second while standing in your team's held zone, in place of the relic bonus.
- **Respawn:** on your team's side (spawns already exist), with the usual 3 s timer.

## What changes where
**Modes agent** (`server/match.js`, `server/objectives.js`, `public/js/match-ui.js`, `public/css/match.css`, `tools/test/modematch.mjs`):
- Remove Sacred Relic: its mode entry, the relic logic, the relic hint and UI. Remove the `canThrow` special case too.
  The telekinesis code goes back to normal.
- Add `siege`:
  - the zone state and its rotation
  - occupancy each tick (living, grounded or low-flying wizards within the radius)
  - contest, fill, overtime and the win
  - snapshot extras: `zone {x, z, r, owner, contested, next, nextAt}` and the bars
- **Vote screen:** FFA / TDM / Altar Siege.
- **HUD:**
  - both bars and a contested flash
  - zone timer, plus an off-screen arrow to the zone (reuse the relic arrow)
  - "+" ticks while capturing
- **In-world:**
  - the rune circle (team-coloured fill, flickering when contested)
  - a ghost circle and beam for the next spot
- **Bot hints (`objectiveFor`):**
  - go to the zone
  - inside it, hold position within the circle, strafing inside it rather than kiting out
  - if enemies are in the zone, `focus` the one deepest in
  - one bot per team may flank or guard the next zone spot in the last 10 s before a hop
- **Testing:** `modematch siege` reports bars, contest time, zone hops, overtime and 0 friendly fire. The unit tests are
  updated (remove the relic checks, add zone checks).

**Spells agent:**
- `ctx.addUltCharge` already exists. Remove anything relic-specific on its side: the relic hint in `main.js`, the F
  "Drop" label, `protectProp` callers. **The modes agent lists exactly which in `requests.md`.**
- Bots already follow `objectiveFor` hints. Make sure "hold inside the circle" works with their movement (don't kite out
  of the zone while fighting there).

**Environment agent:** pick 3 open zone spots of about 7 m radius (altar, barn passage, silo) in `map.js` as
`SIEGE_ZONES`. Clear of big colliders, roughly fair to both team spawns, each with some cover at the edge. Screenshot each.

## Sequencing
The spells agent is mid-Jeb plus the walk-speed change. The environment agent is on Jeb's rams. The modes agent is idle.
1. Start the modes agent now; it owns nearly all of this.
2. Send the environment agent's zone-spot request as a small add-on after its Jeb work.
3. The spells agent's cleanup comes after Jeb and the walk speed.

## Verification
- **Bots:** `modematch siege` on a private port with Hard bot fill.
  - a match finishes within the cap
  - zones hop on time
  - contest time is meaningful
  - no team sweeps every zone just from spawn proximity; check the per-zone hold split
  - 0 friendly fire
- **Unit tests:** pass.
- **Playwright:**
  - vote Altar Siege
  - stand in the zone and watch the bar fill
  - a dummy enemy enters and it shows contested
  - the hop warning, then the zone moving
  - screenshots of the HUD, circle and arrow
- **No relic left:** no relic UI, and telekinesis throws normally in every mode.
- Then update port 3000 from the play copy and verify there.
