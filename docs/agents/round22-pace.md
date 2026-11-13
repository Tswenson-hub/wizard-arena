# Round 22 brief: faster pace, power-ups and jump pads, a second map with rotation

## Context
Wizard Arena is live on CrazyGames (Basic Launch). The first metrics:

| Metric | Value |
|---|---|
| Average playtime | 2m44s |
| Played 1+ min | 48.9% |
| Played 10+ min | 6.2% |
| Returning users | 1.6% |
| D1 retention | 1.2% |
| D7 retention | 0% |
| Rating | 10.0 (5 votes) |
| Load time | 2.2 s |
| Crash rate | ~1.5% |

The people who stay like it, but half leave within a minute and very few stay long enough for a full match: the cap is
7 minutes and the target is 15 kills. Round 21's first-visit flow (straight into a match as the Pyromancer) addresses
the first minute; it ships with the pending version. Ty thinks the pace is too slow and the map too basic.

**Ty chose for this release:** faster pace, power-ups and jump pads, and a second map with rotation. Progression and
crash reporting are deferred.

**Goal:** more action per minute, a full match and podium inside about 5 minutes (so "one more match" kicks in), and
visual variety from a second, more striking arena.

## Compatibility with the live CrazyGames build (important)
The live CrazyGames build bundles its own `layout.json` and doesn't know about pickups, pads or a second map. So:
- **The client sends a protocol version** with `join` (`proto: 22`).
- **Clients without it go to legacy rooms:** the courtyard only, no pickups, pads or rotation. They still get the
  server-side pace values; check the old client reads the target from the match messages.
- New rooms never mix with legacy clients.
- That lets us push to Render any time, and the new CrazyGames version takes over after approval.
- Add a unit test for the legacy path (a join without `proto`).

## 1. Faster pace (spells agent: constants.js, match.js, server.js, bots.js)
- **Match:** first to **10** kills (was 15) with a **5-minute** cap (was 7). Update the README, the how-to card and the
  store description.
- **Respawn:** 2 s → **1.5 s**, keeping the 1.5 s spawn protection. Spawn band 18–26 m → **14–22 m** from the nearest
  enemy.
- **Movement:** walk 3.0 → **3.5**, sprint 5.5 → **6.5**, with a slightly shorter double-jump air time. Check the
  speed-budget anti-cheat and bot pathing.
- **Ultimates:** passive charge 1.0 → **1.4%/s**, so an ult about every 30 s.
- **Streaks and callouts:**
  - First Blood, Double Kill (two kills within 4 s), Triple Kill, and streak banners at 3 / 5 / 8
    ("On Fire!", "Unstoppable!", "Archmage!").
  - Ending someone's streak shows "Shutdown". A 3-kill streak gives +10% ult charge.
  - The text banner sits under the match bar, with a short sting sound. Characters makes the banner visuals; spells
    sends the events.
- **Bots:** look for fights sooner (a shorter idle and wander time, a lower engage threshold), so action starts within
  about 5 s of spawning.
- **Targets** (`loadoutbalance` on normal, 12 runs of 75 s):
  - about **3 kills per player per minute** (2.1 now)
  - about **4 s** from respawn to first damage (about 6 s now)
  - a median match length under 5 minutes in botmatch
  - no new dominant spell

## 2. Power-ups (rune pickups) and jump pads
**Data** (environment agent: map.js, layout.json, editor):
- New layout kinds:
  - **`rune`:** a spawn point with an optional fixed type
  - **`pad`:** a launch target (x, y, z) and a strength
  - optionally **`portal`:** a linked pair
- The editor gets palette entries and overlays for these kinds (pad arcs drawn as a curve).

**Rules** (spells agent: server.js, bots.js, constants.js, effects.js):
- **Runes:** 4 spots per map, at contested points (the centre, the wall-walk corners). Each respawns 25 s after
  pickup. The type is random from:

  | Rune | Effect |
  |---|---|
  | Haste | +35% speed for 8 s |
  | Arcane Fury | ×1.4 damage for 8 s |
  | Aegis | a 40 HP shield for 10 s |
  | Surge | +35% ult charge, instantly |

  - Glowing rotating rune visuals, an aura on whoever is buffed, and an announcer line ("Fury rune taken by X").
  - Server-authoritative.
  - Bots value nearby runes.
- **Jump pads:** 4–6 per map (courtyard to wall-walk and towers, and across the courtyard).
  - Stepping on one launches you on a fixed ballistic arc, with the server and client sharing the same arc. The speed
    budget allows it.
  - Air control is reduced during the arc, and you can cast mid-flight.
  - A glowing rune circle with a whoosh.
  - Bots use pads in pathing (as a shortcut edge to high ground).
- **Characters agent:** a launch pose (Jump_Start) and buff auras (reusing the aura system, within the shader budget).

## 2b. Courtyard dressing pass (environment agent; Ty: "it is a little sparse")
- **More mid-height cover and clusters:**
  - market stalls, carts, crate and barrel stacks, broken statues, rubble piles and low walls
  - target cover every 5–7 m, with no long, empty sight lines across the open stone
- **A clearer centrepiece:** a raised, ruined fountain or a rune altar with steps, so the middle becomes a fought-over
  hill (it also holds the centre rune).
- **Ground detail:**
  - floor variation (cracked and mossy tiles, grass tufts at the edges, puddles)
  - banners, hanging lanterns, ivy, a few small trees in planters
  - braziers with glow
- **Liveliness:** drifting magic particles over the rune circle, birds or crows on the walls, and banners swaying
  (cheap vertex wobble).
- **Constraints:**
  - keep the round-20 budgets: under 120k triangles and under 60 programs; instance repeated props
  - keep the sight lines fair, and keep bots pathing (botmatch shows no new stalls)
- **Assets:**
  - use the pieces already in `~/Downloads`: the KayKit Dungeon props (barrels, kegs, tables, chairs, chests, banners,
    candles, rubble) and the Quaternius Medieval Village props (wagon, fences, crates, vines)
  - post a short wish-list in requests.md of anything Ty should download, for example the KayKit Forest/Nature pack,
    or market and fountain pieces; the coordinator relays it to Ty
- Screenshots before and after, from 4 ground views plus overhead.

## 3. Second map "Sky Ruins", and rotation
**Map** (environment agent: `layout-sky.json` plus map.js/world.js support for multiple layouts):
- A ruined arcane keep on **floating islands** above the clouds, using the same mountain vista from above plus cloud
  layers.
  - **A central island:** a broken mage tower with a rune circle and two levels.
  - **Three or four smaller islands:** bridges, plus jump pads between islands.
  - About **35–40 m across**: tighter than the courtyard, for pace.
- **Falling** into the void kills you, credited to the last attacker within 5 s ("knocked into the void"). This makes
  knockback spells matter.
- Built from the KayKit Dungeon pieces (still in `~/Downloads`; copy any new ones in with meshopt), rocks and cliffs
  for the island undersides, and Quaternius pieces for the tower roofs.
- 8 spawns, 4 heal spots, 4 runes and the pads. Sight lines stay broken. It must stay within the round-20 perf budget:
  under 120k triangles, under 60 shader programs.
- **Bots:** navigate islands and bridges, never path off edges, and use pads.

**Rotation** (spells agent: match.js and rooms; characters agent: UI):
- **Each new match alternates maps:** courtyard, then Sky Ruins. A private room's host can lock a map.
- The rematch countdown shows "Next map: Sky Ruins".
- **The client loads both layouts at boot.** Load Sky Ruins in the background after the first match starts, so the
  first load stays fast. Swap the world on map change behind a short fade.
- New first-visit players always start on the **courtyard**, the polished and known map.

## Who
| Agent | Work |
|---|---|
| Spells | §1 pace and streaks; rune and pad rules; rotation in match.js; the legacy-room path; tests and balance |
| Environment | the rune, pad and portal layout kinds and editor support; placing pads and runes in the courtyard; the Sky Ruins map and multi-layout world.js |
| Characters | streak banners; pickup, pad and buff visuals and poses; "Next map" UI; the map-change fade |
| Deploy | perf_test on both maps; subpath and smoke tests (with the legacy join simulated); rebuild; the checklist and description update ("first to 10", runes, two maps) |

The brief goes in `docs/agents/round22-pace.md`. Coordinate the interfaces in requests.md first.

## Verification
- `MATCH_DEBUG=1 node tools/test/modematch-unit.mjs` prints ALL PASS, with new tests for:
  - runes: spawn, pickup, effect and respawn
  - pad arcs (server and client agree)
  - void deaths with credit
  - rotation order
  - legacy-room isolation and the target-10 rules
- `loadoutbalance` normal and hard meet the pace targets above.
- `perf_test.py` passes on both maps, with 0 ms and 200 ms latency.
- Playwright: the first visit lands on the courtyard; a match ends, then "Next map: Sky Ruins", then a match there, with
  runes picked up and a pad used. Screenshots of both maps.
- A legacy client (the current CrazyGames build, `dist/crazygames` from 95aca29) against the new server still plays a
  full match.
- Ty plays it on localhost:3000, then the push (backward-compatible), the `dist/crazygames` rebuild, and Ty submits a
  new version.
