# Round 24 brief: rebuild the Sky Ruins

## Context
Ty played the live Sky Ruins and wants it reworked. His feedback:
- It's too cramped. The 4 outer islands are too small and the middle island is too compact.
- The wooden plank bridges look bad.
- The middle needs a complete, polished rework: **taller, with castle walls**.
- Each side gets a different way into the middle:
  - a **drawbridge** that keeps raising and lowering
  - a **very narrow walkway**
  - **3 floating rocks** to jump across at any time
  - (Ty's choice) a **wide stone bridge** as the safe main route
- (Ty's choice) **Keep the lower level** as the castle's dungeon, so the map still plays on several heights.

Everything else stays:
- runes, pads, the void rule
- the rotation with the Courtyard
- legacy rooms for the old CrazyGames build (they never see Sky Ruins)
- the perf budget: under 120k triangles, under 60 shader programs

## 1. Layout (environment agent: `layout-sky.json`, map.js, world.js, KayKit and Quaternius pieces)
- **Scale:**
  - Bounds grow to about **80 m** (from 56).
  - The **central keep island is about 30 m** across (was about 16).
  - The **outer islands are about 20 × 16 m** each, about 30 m from the centre, with a ring path along each so there's
    room to fight and dodge on them.
  - Keep sight lines broken with cover (rocks, ruined walls, statues, shrines) on every island.
- **The castle keep (the centrepiece, fully dressed):**
  - **Curtain walls** about 5 m high, with a **walkable wall-walk** and crenellations around the keep island.
  - **Four corner towers,** two of them climbable, with a rune on one top.
  - **A central tall tower** (about 12–14 m) with the rune circle courtyard at its foot.
  - **A gate** on each side where a route arrives.
  - Banners, torches, braziers and windows. Use KayKit walls, towers and stairs, and Quaternius roofs. No planks.
  - **Three heights:**
    1. the courtyard inside the walls (main)
    2. the wall-walk and tower tops
    3. the **dungeon** below the courtyard (the existing undercroft idea, rebuilt as stone vaults), reached by stairs
       inside the walls and from at least one outer island
- **The four routes in**, all stone or rock: **remove every plank bridge**.

  | Side | Route |
  |---|---|
  | South (main) | A **wide arched stone bridge** (about 4 m wide) with low battlements. The safe route. |
  | East | The **drawbridge** (§2): the keep's east gate drops a wooden-and-iron bridge to the east island on a cycle. |
  | North | A **very narrow stone walkway**, about 1 m wide, no rails, a little higher than the others. Risky, fast and good for knockback kills. |
  | West | **Three floating rocks**: stepping stones, each reachable with a normal jump or an air jump (gaps about 3.5–4.5 m, small height steps). Static. |

- **Between outer islands:** add arched stone bridges between neighbours, or pads, so the outer ring flows and nobody
  gets stuck. Keep the existing pads where they fit, re-aimed.
- **Gameplay points:**
  - 8 spawns (2 per outer island, none facing an immediate drop)
  - 4 flasks: one in the dungeon, one on a tower, two on outer islands
  - 4 runes: the central tower top, the dungeon, the narrow walkway's end (bait), and the floating rocks' middle stone
- **Look:**
  - better island undersides: layered rock (use the KayKit and Quaternius rock pieces if Ty downloads a rock pack;
    otherwise improve the procedural rock with ledges, hanging roots and crystals)
  - clouds drifting below
  - the peaks around
- **Perf:** instance and merge the walls. Distant walls use the round-20 LOD boxes, and keep the shader programs
  shared.

## 2. The drawbridge: a moving platform (spells agent: server.js, map.js helpers, bots.js; client prediction in main.js)
- **A cycle on the server clock** that all clients compute from the synced match time, so there are no per-frame
  messages:

  | Phase | Duration |
  |---|---|
  | Down | 12 s |
  | Rising | 4 s |
  | Up | 8 s |
  | Lowering | 4 s |

  Ty doubled these: the bridge should feel slow to raise and lower, and stay in each position longer. A 28 s cycle.

- **The surface:**
  - a hinged ramp whose angle comes from the cycle
  - walkable while down
  - while it rises, wizards on it slide toward the gate, or off the end into the void past about 45°
- **Shared helper** `drawbridgeAngle(t)` and a moving surface in the `surfaceHeight` and collision queries, used the
  same way by the server, the client and the bots.
- **Visuals:** chains and a clank and creak sound while it moves. **No warning cue** (Ty): it just rises and lowers on
  its cycle.
- **Bots** use it only when it will stay down long enough to cross, and otherwise take another route (route graph edge
  weights by phase).
- **Legacy and old builds:** Sky Ruins is never served to legacy rooms, so there's no compatibility issue.

## 3. Bots and routes (spells agent)
- **Update the per-map route graph:** the bridge, the walkway, the stepping stones (jump edges, with Hard bots taking
  them more), the drawbridge (time-gated), the dungeon stairs and the towers.
- **Never walk off edges.** Knockback deaths are still allowed.
- **Target:** a 150 s Sky Ruins botmatch with 0 non-knockback void deaths, with every route used at least once.

## 4. Characters agent
Light touches only (no drawbridge warning cue, per Ty):
- the stepping-stone landing dust
- check that the camera works inside the keep walls and dungeon, and in tight tower stairs (camera blockers from
  world.js)

## Who
| Agent | Work |
|---|---|
| Environment | §1 layout and art |
| Spells | §2 drawbridge mechanics and §3 bots |
| Characters | §4 |
| Deploy | perf_test on sky, smoke, subpath and legacy tests, rebuild `dist/crazygames` |

The brief is `docs/agents/round24-skyruins.md`. Environment posts the drawbridge hinge position, size and cycle
constants in requests.md first.

## Verification
- `MATCH_DEBUG=1 node tools/test/modematch-unit.mjs` prints ALL PASS, with new tests for:
  - the drawbridge's angle and surface (the server and shared helper agree; a wizard standing on it when it rises
    slides or falls)
  - stepping-stone reachability (a jump plus an air jump makes every gap)
  - the narrow walkway
- The editor's reachability check passes on Sky Ruins.
- `perf_test.py --map sky` passes.
- The Sky Ruins botmatch target above is met.
- Screenshots: overhead, each of the four routes, the keep courtyard, the wall-walk, the dungeon.
- Ty plays it on localhost:3000 (`?first` plus a private room with the map locked), then the push, the
  `dist/crazygames` rebuild and a CrazyGames version upload.
