# Environment hand-off: the farmstead

## Altar Siege respawns pushed back (`SIEGE_SPAWNS`, Siege branch of `spawnPointFor`)
Ty: "it should take a second to get back into the battle once you are killed."
- **`map.js` `SIEGE_SPAWNS`:** `{ ember, frost }`, 4 points each, as `[x, 0, z, yaw facing the map centre]`.
  - **Ember:** the north-west corner of the farm, beside the tractor and the field's north-east corner, 26–27.5 m from centre, around (−19.9, 16.7).
  - **Frost:** the far south meadow edge, 36.6–38 m out, around (3.3, −37.9).
  - All points are ≥ 3.7 m from colliders and away from props and the pen.
- **Why Ember is nearer the centre than the 33–36 m asked:**
  - All three zones lie south of the map centre (altar z −7, barn −4.5, silo −19), and Frost can't go further than the rim.
  - Ember at 32–34 m behind the farmhouse walked about 2.8 s longer to every zone, and Frost won 3 of 3 siege matches.
  - At 27 m the gap was about 1 s on paper, but bots still arrived about 2 s later, and Frost won 4 of 4.
  - So the cluster sits at 26–27.5 m.
- **`server/match.js` `spawnPointFor`, Siege only:** always one of your team's `SIEGE_SPAWNS` (random, skipping points within 8 m of a living enemy),
  in every phase. I removed the "fair walk" logic that respawned you about as far from the active zone as the enemy's closest spawn.
  FFA and TDM are unchanged.
- **The facing (yaw) needs the spells side.** `respawn()` in server.js ignores `sp[3]`. To face the centre on respawn: `p.yaw = sp[3]` when it is
  finite, send it in the `respawn` message, and set `local.yaw` from it in main.js. It is filed in requests.md.

**Travel time from spawn to 1 m inside each zone.** Grid shortest path around every collider (`/tmp/wa-environment/walktime.mjs`),
walk 3.0 m/s; "sprint" is 5.5 m/s for 4 s (100 stamina at 25/s), then walking. Cluster means:

| zone | Ember walk / sprint | Frost walk / sprint |
|---|---|---|
| The Altar | 8.2 / 4.9 s | 8.1 / 4.8 s |
| Barn Passage | 10.8 / 7.5 s | 9.4 / 6.1 s |
| Fallen Silo | 9.6 / 6.3 s | 9.5 / 6.1 s |

**Verified:**
- `MATCH_DEBUG=1 node tools/test/modematch-unit.mjs`: **ALL PASS** (43). Three new checks:
  - every Siege respawn is at the team's `SIEGE_SPAWNS` for each active zone
  - none is within 20 m of the active zone (the closest is 29.7 m)
  - TDM still uses `TEAM_SPAWNS`
- `modematch siege 300 hard` on 4102 with MATCH_DEBUG=1, plus a passive watcher (`siegewatch.mjs`):
  - every respawn was at the team's own siege spawn
  - **no bot stalled near a spawn**
  - 0 friendly fire, every match finished
  - With the 27 m Ember cluster, the median respawn-to-zone time was Ember 9.7–13.1 s and Frost 8.4–10.7 s, and Frost won 4 of 4. Kills were even (for example 26–18 to Ember in a match Ember lost).
  - Runs with the current 26 m cluster are in progress. If they still lean Frost, I'll adjust only `SIEGE_SPAWNS` in a follow-up commit.
- Screenshots: `/tmp/wa-environment/ss_ember.png` (the 27 m cluster) and `ss_frost.png`.


## Altar Siege zone spots (`SIEGE_ZONES` in map.js)
**Update, after the modes agent's balance runs:** Barn Passage moved from (10, 4), where Ember won every hold, to **(11.3, −4.5)**.
That is the farmyard-to-pen-gate passage between the altar ring and the pen; mean spawn distance is now 22 / 27 m.
- I moved the blast stone that stood inside the new circle from bearing 80° to 112° (16 m), at the zone's south-east edge.
- **Measured** (`modematch siege 300 hard`, 15 runs across three positions, compared against the Altar's share in the same match):
  - here, Barn holds were Ember 66 s / Frost 65 s (50%) over 4 runs with a split
  - 0.7–1.5 m further north it leaned Ember (76% over 8 runs)
- The Silo pooled 43% Ember over 11 runs and is noisy. I left it, because the modes agent measured it about even. Numbers are in requests.md.
- Logs: `/tmp/wa-environment/siege_*.log`. Screenshots: `z_barn2_{top,ember,frost}.png`.

The original placement notes follow; the barn position in them is superseded.

Three circles with r 7, in rotation order:
- **Altar:** (0, −7)
- **Barn Passage:** (10, 4), the open ground in front of the barn arch between the yard and the pen hay
- **Fallen Silo:** (−22, −19), north-west of the silo

**How I picked them:** `/tmp/wa-environment/zonepick.mjs` grid-scores candidate centres. The rules:
- no collider ≥ 1.6 m tall inside, and no fence or crop
- clear of the rim
- cover (≥ 1.2 m) within 1 m inside to 3 m outside the edge
- mean and nearest team-spawn distance

**Results:**
- Mean spawn distance, Ember / Frost: altar 21 / 23, barn 14 / 34, silo 40 / 25 m. The barn and silo skews roughly cancel over a rotation, leaving Ember about 2 m ahead.
- I moved the birch at (−22, −17) to (−27.5, −12.5) to clear the silo spot.
- After the move, layoutcheck is clean and homesim gets all 30 goats home. Botmatch 90 s: goats charging and ramming normally, no server errors.
- **Screenshots** (ring drawn), all looked at: `z_top`, and `z_{altar,barn,silo}_{ember,frost}` plus `z_silo_frost2`.
- Details and the fairness note for the modes agent are in requests.md.


## Round 7: Jeb the Shepherd's rams (goat side of the contract in docs/agents/round7-jeb.md)
**`server/goats.js`:**
- **`summonRam(opts, ctx)`**: a summoned ram lives in the same `goats` array, with ids from 1000.
  - It joins `ctx.goats` at once if the ctx has it; otherwise it waits in a `pending` list and joins at the next `updateGoats`.
  - opts: `{ x, z, yaw, ownerId, mode, targetId?, speed?, maxTime?, radius?, lap? }`.
  - **charge:** dead straight (it homes only with `targetId`), at `speed` for `maxTime`. A collider leaves it `dizzy`, a wizard gets rammed, and time running out means `recover`.
  - **orbit:** circles the owner (`radius` / `lap`, defaulting to `GOAT.orbitRadius` 2.2 and `orbitLap` 1.5), starting from where it stands, until `maxTime` (`orbitTime` 3).
  - **mount:** no AI. server.js moves it under the rider.
  - A **stampede** is just a batch of charge rams, spawned by the spells side.
- **Never penned:** summoned rams never return home, wander or graze. Spent rams are marked `gone` and swept at the start and end of every
  `updateGoats`, with a `goatGone {id, p}` broadcast, so no snapshot carries one. A ram is spent when any of these happens:
  - its dizzy or recover ends
  - an orbit ram reaches its time
  - an orbit or mount ram's owner is dead or gone
  - `GOAT.ramLife` (9 s) passes
  - `despawnRam(ram, ctx)` is called
- **Friendly rule:** `hostile(g, p, ctx)` is used in `charge()`. A summoned ram passes its owner and anyone `ctx.isEnemy(owner, p)` says
  isn't an enemy (fallback: the same `team`). A map goat sent by `callRam` passes its caller and his team in the same way (`g.calledBy`,
  cleared when it calms down or goes home). Sparked goats are unchanged: they ram anyone, including their angerer.
- **Credit:** a summoned ram has `angeredBy = owner`, so kills go to Jeb with cause `'ram'`. The goat rule is unchanged: a facing ward,
  Veil or Black Death leaves it dizzy.
- **`angerGoat` on a ram** works only on an orbiting ram hit by an enemy of its owner. It rears up for 0.3 s, then homing-charges the shooter.
  Otherwise it returns false. `angerGoat` now returns a boolean.
- **`callRam(targetId, creditId, from, range, ctx)`:** the nearest calm map goat (not winding up, charging, held or flying, and not summoned)
  rears up at the target and broadcasts `goatAngry` with `caller`. It returns null when no goat qualifies.
- `canLift` is false for summoned rams.
- `goatPublic` adds `summoned, owner, team`, `speed` (when it isn't the charge speed) and `orb: [r, lap]` (while orbiting).
- `map.js` `GOAT` gained `ramScale` 1.15, `orbitRadius` 2.2, `orbitLap` 1.5, `orbitTime` 3 and `ramLife` 9.

**`public/js/goats.js`:**
- Summoned rams are scaled 1.15× and given a faint gold tint (cloned materials, colour ×0xffe7b0, emissive 0x5a3c00 at 0.35).
- Orbit is dead-reckoned as an arc (tangent velocity plus a yaw turning at the orbit rate, from `orb`), with a leaning trot and dust.
- A mount gallops while its snapshots move, and stands still otherwise.
- Herd charges get dust and hoofbeats, but no '!' marker (only a ram turning on a shooter shows it).
- `poof(effects)` and `despawn(scene, effects)` exist, but the spells side already poofs on `ramSpawn` and `goatGone`, so a view doesn't poof on its own.

**Verified:**
- `/tmp/wa-environment/ramsummon_test.mjs`, fake ctx, **43 checks, all passing**. The list is in requests.md
  ("environment → spells: Jeb's rams").
- `goatthrow_test.mjs`, `ramtest.mjs` (ward, Veil, Black Death) and `homesim.mjs` (30 spots, all home, no ghosting) still pass.
- Live through the spells agent's working-tree wiring (`/tmp/wa-environment/jebwatch.mjs`, 2 Jeb bots + 3 others, 120 s):
  - 93 rams spawned, 89 `goatGone`, 4 live at the end
  - 12 ram kills, 14 goats called
  - orbit, mount, windup, charge, dizzy and recover all seen; the longest ram life was 4.7 s
  - pen goats never grazing outside the pen
- **Botmatch 4102, 90 s:** 7 kills, goats penned, none angry. The 120 s stuck-watch had 20 kills and no stalls.
  - This was run on a HEAD snapshot plus my files (`/tmp/wa-environment/headtree`). The working-tree `server.js` currently crashes when a
    charging goat meets a prop: a spells edit put `breakProp` behind a `//` on the `isEnemy` line of `goatCtx`. I reported it in requests.md.
- **Visuals** (`ramviz.py`, which fakes ram snapshots on the client), screenshots looked at:
  - `ram_scene_0..2.png`: 3 orbiting rams, a galloping mount, a 4-ram herd, and a plain goat for comparison
  - `ram_compare.png`: gold, larger ram next to a white goat
  - `ram_poof.png`: the despawn puff
  - No page errors.

**Known / for spells (in requests.md):**
- add `goats` to `goatCtx`
- skip `state === 'mount'` in main.js's goat push-out, or Jeb gets shoved off his mount
- the `breakProp` bug above


## Round 6: the altar and the blast site (current layout; positions in older sections below are out of date)
Ty asked for the map to read as one magical explosion around a stone altar, with the farm organised on its own and nothing strewn about.

**Where things are now (+z north):**
| Area | Where | Details |
|---|---|---|
| Altar | `ALTAR` (0, −7): the map's centre, halfway between the team sides | Procedural. A two-step dais (0.3 m, walkable), a slab split in two with violet light through the crack, a floating crystal with 4 shards, and 22 flagstones heaved outward. Collider r 1.3, `h` 1.1 (`'altar'`): you can shoot over it but not walk through. |
| Blast site | radius 15 round the altar | A scorched decal (canvas texture: soot rays, cracks) with an additive layer of violet glowing cracks. Every piece below leans away from the altar (`awayYaw`). Helpers: `fromAltar(bearing°, d)` and `awayYaw(x, z)`. |
| Rune pillars | 4 on the diagonals, 7.5 m out | Tilt 0.11, crystals follow the tilt. The N–S and E–W lanes through the altar stay open. |
| Fallen pillars | `FALLEN_PILLARS`, bearings 100° and 255° | Procedural stump plus 3 drums with rune bands. Colliders `'ruin'`: stump r 0.8 `h` 1.2, shaft r 0.55 `h` 1.0, so they are low cover. |
| Archway | (−0.14, −17), facing south, tilt 0.06 | The path south runs through it. Legs refit with yaw π: gap still centred on the path. |
| Obelisk | bearing 200°, 23 m out (−7.9, −28.6) | Tilt 0.3, sunk 0.35. 3 colliders along the lean. A torn-earth furrow decal runs back toward the altar. |
| Blast stones | `BLAST_STONES`: 7 jagged shards at 11.5–14 m | `h` 1.6–2.2, tilt 0.28–0.35, collider r 0.33 h shifted toward the lean (`'stone'`). They block LOS. |
| Slabs | `TABLE_ROCKS`: 4 at 14.5–17.5 m | Tilt 0.15–0.2, low cover. |
| Shards | `BLAST_SHARDS`: 26, seeded, 6–18 m | 0.45–0.75 m. Colliders r ~0.2 (`'stone'`), so you don't walk through them and spells fly over. Kept ≥1.4 m from other colliders and ≥1.8 m apart, so no snag pockets. |
| Silo | bearing 225°, 21.5 m out, yaw 3π/4 | Felled radially, base toward the altar, with a cracked stone footing (`SILO_FOOTING`, visual) where it stood. |
| Farmyard | dirt ellipse centred (0, 13) | Well at (−4.5, 12.5), horse cart at (−9, 18) beside the tractor. Paths lead to the door, the barn arch, the pen gate and the field, plus the old way south past the altar and through the arch. |
| Hay | `HAY_STACKS` | 3 big bales against the pen's yard-side fence, 2 in the SE meadow (16–18, −23). |

**Props, grouped:**
- Potion barrels in pairs flanking the farmhouse door.
- Crates beside the cart.
- Barrels by the barn's west wall, set 1.5 m off it so goats can pass.
- A pot by the well.
- Loose bales by the pen stacks and by the meadow stacks.
- A grain store (3 crates, 3 barrels) lined up along the felled silo.
- Two offering pots on the dais rim.
- 4 rock props among the debris.
- Pumpkins along the field edge.

Relic-eligible props, measured by the nearest team spawn: 11 Ember, 10 Frost, 2 in the middle.

**Spawns:**
- `TEAM_SPAWNS`: Ember is in the farmyard, Frost in the south meadow (lists in requests.md). Average distance to the altar is 21.2 m for Ember and 22.6 m for Frost.
- `SPAWN_POINTS` (FFA) is both lists plus flank points (−13.5, 1.5) and (12.5, 1.5).
- Every spawn is ≥1.9 m from a collider and not in the pen, field or house.

**Goats:** `GOAT_DETOURS` gained a box for the pen hay stacks plus their bales, and one per fallen pillar. A long low wall is something the
goat's step-aside can't get round. Before the boxes, goats from south of the arch or by the obelisk ghosted after 30 s.

**Code:**
- `world.js`: `standin()` takes `tilt` (lean toward the model's +z after the yaw, Euler order YXZ) and `sink`.
- `instanced()` items take `[x, z, yaw, h, tilt, leanYaw, sink]`. Rim rocks and trees are unchanged.
- `buildBlastSite()` draws the decals, altar, flagstones, fallen pillars and furrow.

**Also done:** spells' requests for goat rams. Tempest Veil bounces a goat at no cost, and Black Death blocks from every side
(`server/goats.js`, see requests.md).

**Verified (server 4102):**
- `layoutcheck.mjs` (scratch) checks:
  - spawn clearance
  - prop overlap
  - the relic split
  - collider pairs with a 0–1 m gap (none, apart from the old sealed fence/shelter and fence/hay nooks)
- `homesim.mjs`, with idle props present: a dizzy goat dropped at 30 spots round the barn, pen hay, altar, fallen pillars, silo, store, arch,
  obelisk, meadow hay and farmyard. All got home in 4.5–25 s with no ghosting, in 3 repeated runs.
  - Found and fixed on the way:
    - an offering pot 0.86 m from the altar trapped a goat (moved to the dais rim)
    - the barn barrels flush against the wall trapped one (moved 1.5 m out)
- `goatthrow_test.mjs`: all pass. I moved its three throw lanes off the old courtyard (a pillar now stands on the old z −2 line).
- `stuckwatch.mjs`, 5 bots × 180 s: 33 kills, **no stall episodes**.
- `botmatch.mjs 4102 90 hard normal easy`: 5 kills, 3 kills and 7 kills on three runs. Goats penned or homing.
- `modematch.mjs`:
  - TDM 120 s: 7–10, 18 deaths, 3v3 throughout, no friendly fire
  - Relic 150 s: 71–115 (one run, so it may be noise), 14 lifts, 3 rotations, points only while held
  - Both "FAIL" only because no team reached the target in the short run.
- `ramtest.mjs`: Veil and Black Death checks as listed in requests.md.
- **Screenshots** in `/tmp/wa-environment/`, all of which I looked at, no page errors:
  - `r6_aerial`, `r6_top`, `c_r6_top` (collider overlay plus team spawn markers)
  - blast site: `r6_blast`, `r6_v_altar`, `r6_obelisk`, `r6_v_obelisk`, `r6_v_silo`
  - farm: `r6_farm`, `r6_v_farm`, `r6_v_house`, `r6_v_hay`
  - team spawn views: `r6_v_ember` (from (4.5, 10.5), facing south) and `r6_v_frost` (from (0.5, −31), facing north, through the arch to the house)

**Known issues:**
- ~~`tools/test/modematch-unit.mjs` fails 14 checks at HEAD~~ **Correction:** that was my mistake. I ran it without `MATCH_DEBUG=1`; run as
  `MATCH_DEBUG=1 node tools/test/modematch-unit.mjs`, it passes.
- Not re-measured for draw calls. The blast site adds roughly 70 small procedural meshes, mostly flagstones and pillar drums. If perf matters,
  instance the flagstones first.
- The furrow decal can read as a plinth under the obelisk when seen end-on from close by.
- `blast_shard` colliders add 26 circles (433 total).


## What I built
The arena is now a wizard's farmstead, radius 40 (was 34). **+z is north.** If you stand in the
courtyard facing the farmhouse, the goat pen is on your **left (+x)** and the crop field on your **right (−x)**.

| Area | Where | Details |
|---|---|---|
| Farmhouse | (0, 26), door facing the well | Meshy model scaled to 11 m. 7 colliders (`kind: 'house'`, `h` 9), fitted to the walls. I measured the model's vertices below 2.5 m and drew the colliders over the top-down view to check them. Shadow camera widened to ±50. |
| Courtyard | around (0, 2) | Packed-earth yard with paths to the door, the gate, the field and the south meadow. Stone well (`h` 2.6) in the middle. Big round hay bales (Meshy, lying on their sides, 1.7 m tall, `h` 1.7 so they block LOS) in pairs as cover. Hand cart (−4, −16). Four rune pillars with glowing bands and floating crystals at (10, 9.5), (−9, −11), (9.5, −12.5), (0, −25). The south meadow stays open for long-range duels. |
| Goat pen | x 18…33, z −13…9 | Picket fence: 119 post colliders (`kind: 'fence'`, r 0.25, ≤ 0.62 m apart, `h` **0.7**). The gate is a 2.8 m gap in the courtyard-facing side, with its leaf swung open flat along the outside of the fence. Inside: a lean-to shelter and a water trough. All 4 goats spawn and graze inside. |
| Crop field | x −33…−18.4, z −11…10.5 | 6 corn rows running north-south, 144 plant colliders (`kind: 'crop'`, r 0.5, `h` 0.9). Rows block walking. Furrows about 1.5 m wide are walkable, and spells fly over. A Meshy scarecrow in a wizard hat (2.4 m) stands at the north end. Pumpkins line the edge. |
| Tractor | (−14.8, 13.2), grille toward the courtyard | Meshy wizard tractor, 3 m tall. 3 colliders (`h` 3.0, hard cover) fitted to the model's measured footprint: 4.3 m long, 2.5 m across the rear wheels, 2.0 m across the front. |
| Spawns / props | | 12 spawn points, none in the pen, the field or the house. Crates, barrels and the 4 potion barrels are by the house; pumpkins along the field edge; pots around the well; rocks in the south meadow. New throwable **`hay`** (small round bale) is in `PROP_TYPES`, with 4 near the pen and the stacks. |

### Goats (`server/goats.js`, `public/js/goats.js`)
- `graze`/`wander` only inside the pen. Wander destinations are picked inside it, and walking collides with the fence.
- When angered, a goat does `windup` → `charge`. Charges ignore `fence` and `crop` colliders, so the goat leaps the fence and tramples crops.
  On the client a hop arc is drawn: up to 1.25 m, within 1.5 m of the fence line, nose up on the way over and down on landing.
  Crops a charging goat runs through lie flat and regrow after about 10 s (visual only).
- After `recover`/`dizzy`, a goat outside the pen enters a new state, **`return`**. It trots home at 2.6 m/s along the shortest
  route around the pen corners to the gate, goes through it, then grazes. If it stalls it steps aside. After 30 s it ignores colliders
  and hops whatever is in the way.
- `ram()` skips wizards with `p[1] >= GOAT.rammableBelow` (1.0), so goats pass under Skyward Flash.
- New export `dizzyGoat(goat, ctx)` (gameplay request, done). `angerGoat(goat, ownerId, ctx)`, `createGoats`, `updateGoats` and `goatPublic` are unchanged.

### Fence height deviation (deliberate)
The brief said fence `h` ≈ 1.1. At that height, a spark aimed at a goat's body (y 0.7) dropped below the top of the fence
whenever the goat stood near it, and only 1 of 12 scripted shots got through. At `h` 0.7, every shot aimed at a goat clears the fence.
Walking is unaffected (every collider blocks movement). The visual pickets are 0.92 m.

## How I verified it (server on 4102)
- `node tools/test/botmatch.mjs 4102 90 hard normal easy`: 7 kills in 90 s, goats never angered, all 4 stayed in the pen.
- `/tmp/wa-environment/goatwatch.mjs` (my scratch watcher: goat position by state each snapshot, return times, bots that don't move
  for 6 s), run with scripted "poker" players that spark goats from the courtyard, the south meadow and behind the pen:
  - never a goat outside the pen unless it had been angered (`leftUnangered: 0`)
  - every return finished. Longest was 15 s from the courtyard and 22 s from behind the pen (before the gate fix it was 50 s, see below)
  - 23 kills in 90 s with 4 bots plus the poker, first kill at 5.6 s
  - no bot stuck (the only "stuck" reports were the stationary poker)
- Skyward pass-under: a scripted player sparked a goat and flashed to 6.5 m. The goat was angered and charged, and there was no ram.
- Screenshots, all of which I looked at, in `/tmp/wa-environment/`:
  - `v_courtyard.png`: player view toward the house
  - `o_aerial.png`: whole map
  - `o_pen.png`: pen with all 4 goats inside
  - `o_field.png`, `o_tractor.png`, `o_house.png`
  - `leap2_0..5.png`: goat stepped across the fence. Lift goes 0.07 → 0.69 → 1.11 → 1.25 → 1.11 → 0.69. Headless rendering is too slow to catch a 0.2 s live leap, so I stepped the goat by hand.
  - `trample.png`: flattened crops
  - `c_house.png`, `c_all.png`: collider overlay
- No console errors (only SwiftShader "GPU stall" performance warnings). `du -sh public/models` = 7.7 MB (unchanged).

Fixed during testing: the open gate leaf first stuck out at an angle and trapped goats in the wedge it made with the fence.
It now lies flat along the fence.

## Meshy assets
| Model | Source on `~/Desktop` | Output | Notes |
|---|---|---|---|
| tractor | `Meshy_AI_low_poly_wizard_tract_1027224222_texture.glb` | `public/models/tractor.glb`, 0.65 MB, 14k verts | Exported nose toward −x; `FARM_MODELS` turns it +π/2 to face +z. |
| scarecrow | `Meshy_AI_low_poly_wizard_scare_1027224239_texture.glb` | `public/models/scarecrow.glb`, 0.63 MB | Faces +z as exported. |
| hay | `Meshy_AI_low_poly_hay_bale_1027224234_texture.glb` | `public/models/hay.glb`, 0.38 MB | One load, two sizes: `models.hay` (0.9 m, the throwable prop) and `models.haystack` (1.7 m, the courtyard cover). |

I ignored the duplicate `… (1).glb` tractor and the untextured `_generate.glb` scarecrow.
`du -sh public/models` is now 9.3 MB.
I rendered each model once beside a +z arrow (`mv_front.png`, `mv_top.png`, `mv_scare.png`) and took in-game shots
(`o_m_tractor.png`, `o_m_scarecrow.png`, `o_m_hay.png`, `o_m_hayprop.png`, and the tractor collider overlay `c_tractor.png`).
I looked at all of them.
After the swap, botmatch on 4102 still has the bots fighting (5 kills in 90 s, first kill 4.9 s in a second run), with the goats penned and no bot stuck.

The well, cart, shelter and trough are still procedural stand-ins. To swap one:
1. `tools/optimize-models.sh one ~/Desktop/Meshy_AI_<x>.glb <name>`
2. Add `['<name>', '/models/<name>.glb', <height m>, <yaw to face +z>]` to `FARM_MODELS` in `world.js`.
   Stand-in names are `well, cart, shelter, trough`.
3. Render it once to check the facing.

Run the script under `sh` and pass arguments literally. A zsh `for` loop that splits `$pair` silently passes nothing.
Fence and crops are instanced. A Meshy fence or crop would need a small instancing change.

## Barn and fallen silo (Meshy, round 4)
| Piece | Where | Details |
|---|---|---|
| Walk-through barn | (14, 20.5), yaw −π/2, between the house and the pen's NW corner | `public/models/barn.glb`, 2.6 MB, 64k tris (88 MB source, ratio 0.03, 2048 px). 15.3 m long, 7 m to the cupola. |
| Fallen grain silo | (−16, −27), yaw 0.35, south-west meadow | `public/models/silo.glb`, 4.1 MB (248 MB source, ratio 0.012, 2048 px). 11 m long, 4 m tall, ivy-covered, domed cap toward the ESE. |

**The barn is not open at both ends.** I rendered it from all sides and inside (`m_barn_*.png`). In model space it is long along x,
with a wide arch and swung-open doors at −x, a 3 m side doorway in the middle of the +z wall (x 0..3), and a *closed*
window wall at +x. So the way through is an L: the **arch opens south onto the courtyard** (a new path strip leads to it from
the yard, past the rune pillar at (10, 9.5), which now screens the entrance) and the **side door opens west toward the house**
(a path strip to the house path). North of the side door is a 3.5 m dead-end nook.
Colliders: 60 posts (`kind: 'barn'`, r 0.45, `h` 4, ≤ 0.6 m apart) along wall polylines that I measured with a raycast section of the
model at 0.6 and 1.4 m (`/tmp/wa-environment/section.py`), not by eye. That covers both long walls, the closed end and the door leaves.
The arch and the side door stay open, and the inside is 2.5 m clear. The big side windows are visual only: walls block spells and LOS full height.
I closed a 1.2 m gap beside the arch's north door leaf (it is visually open, but sits right next to the arch).

Silo: 7 circles (`kind: 'silo'`, r 1.8, `h` 3.6) along its axis, fitted to the section (body x −5.75..5.3, z −0.25 in model space).
I moved the tree (−12, −31) to (−11, −33.5) and the crate (−21, −25) to (−24, −21.5) out of its footprint. No spawn point
was within reach of either piece, so spawns are unchanged.

Code: `map.js` has `BARN`, `BARN_POSTS`, `SILO`, a `chain()` polyline helper, a `place()` model→world helper and `GOAT_DETOURS`
(world boxes of the barn and silo colliders). `world.js` has procedural stand-ins `makeBarn`/`makeSilo` (shown only if the glb fails;
I didn't screenshot those) and the two `FARM_MODELS` entries. `server/goats.js`: the return route now goes around
the pen **and** every `GOAT_DETOURS` box (their padded corners are extra Dijkstra nodes). A goat inside a box's margin only has to clear
the bare box.

Verified (server 4102):
- Screenshots, all of which I looked at: `c_barn.png` and `c_silo.png` (collider overlay, top down), `c_plan2.png` (whole map overlay),
  `o_v_barn_arch.png`, `o_v_barn_inside.png`, `o_v_barn_door.png`, `o_v_barn_out.png`, `o_v_silo_court.png`,
  `o_v_silo_meadow.png` (player's eye), `o_aerial.png`. No page errors.
- `botmatch.mjs 4102 90 hard normal easy`: 6 kills, goats penned.
- `/tmp/wa-environment/stuckwatch.mjs` (stall = 6 s within 1.5 m): 5 bots, 180 s, 32 kills, one 7.8 s stall at the old pillar (−9, −11).
  With idle targets planted behind the barn (11, 31) and behind the silo (−16, −31.5): 41 kills in 150 s, both targets were killed repeatedly,
  and no bot stalled at the barn or silo (one 9 s stall against the farmhouse's east wall).
- `/tmp/wa-environment/homesim.mjs` runs the real server goat code with a dizzy goat dropped at 15 spots: around, inside and in the nook of the barn,
  and around the silo. Every goat got home in 9–25 s and none needed the 30 s ghost fallback.
- Live goat run with lures (`lure.mjs`): 6/6 returns finished, longest 19.9 s, `leftUnangered: 0`.
- `du -sh public/models` is 23 MB in total, but most of that is the characters' `wizards/`. Barn + silo add 6.7 MB.

Known: bots don't pathfind (they steer and flip strafe), so a bot chasing someone around the barn takes the long way, but in my runs it never stuck.
Pre-existing, not new: a goat sparked near the trough bonks on it (the trough isn't excluded from charge stops). It's harmless, but it is why lures rarely got a charge past the pen.

## Throwable goats, goat side (round 4, Ty's revision)
- `server/goats.js`: `canLift` (graze, wander, return, recover, dizzy, stumble), `liftGoat` (state `held`, placed at
  `C.holdPoint` of the holder each tick, set down if the holder is gone, dead or stunned), `releaseGoat`, and `throwGoat` (state `flying`,
  `GOAT.throwSpeed` 24 and `throwGravity` 6, the prop numbers). The flight hits each wizard except the thrower once via `ctx.goatHitPlayer` and bounces off.
  It lands on ground, any collider (Bulwark walls too) or the rim with a `goatBonk`, then `stumble` for 0.5 s, then graze/wander in the pen or
  `return` home. **Nothing about telekinesis angers a goat.** `angerGoat` (a spell) on a held or flying goat drops it, then rears it up at
  the caster. `goatPublic` gains `y`, `holder` and `v` (velocity, while flying). `ram()` only runs for a charging goat.
- `public/js/goats.js`: draws the goat at its `y`. Held goats kick (a fast uneven body wobble). Flying ones tumble end over end about their middle,
  extrapolated with `v` and gravity between snapshots, and roll back upright on landing. `stumble` is a dying wobble. It plays `sfx.bleat` on lift
  (calm) and throw (indignant).
- Verified: `/tmp/wa-environment/goatthrow_test.mjs` runs 20 checks against a fake ctx, all passing. Lift/hold point, hit credited to the
  thrower, landing beside the victim and at the aim point, the well stopping it, calm return to the pen, spell on held/flying → charge
  at the caster, holder stun and death. Screenshots `held_1.png` and `fly_1.png` come from faked held/flying snapshots, because the
  spells side wasn't in yet. Botmatch 4102 90 s: 5 kills, goats penned, none angered. I couldn't test the full loop (F lift → hurl) until the spells side lands.
  Contract notes for spells are in `requests.md` ("environment → spells: throwable goats").

## Meshy scenery: trees, rocks, rune pillars, archway, obelisk, horse cart (round 4)
| Model | File | Triangles | Where |
|---|---|---|---|
| pine / oak / birch | `pine.glb` 0.23 MB, `oak.glb` 0.26, `birch.glb` 0.25 (512 px) | 3.9k / 5.3k / 3.9k | The 12 arena `TREES` (oaks and birches round the farm and meadow, pines on the north and east edges), instanced |
| pine_far / oak_far / birch_far | 0.03 / 0.22 / 0.04 MB (256 px) | 1.0k / 1.6k / 1.3k | Outside scatter, 90 trees (oaks and birches near the rim, pines toward the hills), instanced, no shadows |
| rock_jagged / rock_table | 0.03 / 0.06 MB | 0.9k / 1.1k | Rim ring (52, every 4th a table rock), 24 outside, the throwable `rock` prop mesh, and 4 table rocks as low meadow cover |
| rune_pillar | 0.45 MB (1024 px) | 4.1k | Replaces the 4 procedural rune pillars, 6 m tall, with the purple crystal kept above |
| archway | 0.59 MB | 8.7k | (0.14, −16.5), 7.5 m, over the path into the south meadow |
| obelisk | 0.55 MB | 7.8k | (3.5, −35), 6 m, the meadow's far end, just off the path so it shows past the (0, −25) pillar |
| horse_cart | 0.60 MB | 9.6k | Replaces the hand cart, now at (−12.5, −15.5) by the SW yard edge, shafts toward the well |

New models add 3.3 MB in total. `du -sh public/models` is 26 MB, and most of that is the characters' `wizards/`.

- **Instancing:** `world.js` `SCATTER` holds per-model `[x, z, yaw, height]` lists. `instanced()` builds one InstancedMesh per model
  (normalised like `fitModel`), so 8 draw calls cover about 180 trees and rocks. The scatter uses a seeded RNG, so all clients match.
  Procedural trees and rim stones stay as stand-ins until the models load.
- **Purple runes:** the Meshy landmarks glow cyan. `purpleRunes()` patches their shader (`onBeforeCompile`) to swap cyan texels for violet
  and add them to the emissive term. Applied to the pillar, arch and obelisk (`FARM_MODELS` 5th field).
- **Colliders** were fitted from raycast sections (`section.py`):
  - **Trees:** `TREE_KINDS` trunk circles, scaled per tree with a minimum r of 0.35. Oaks are r ~1.0. Yaw is fixed per tree (not random) because the trunk offset depends on it.
  - **Arch:** only the two legs (4 × r 0.75, h 7), leaving a 2.48 m gap centred on the path.
  - **Obelisk:** r 0.9, h 6.
  - **Cart:** 3 × r 1.2, h 2, on the bed only. The shafts are walk-through.
  - **Table rocks:** r ~1.0, h at their real 0.9–1.2 m, so spells fly over them and bots see across them.
  - **Pillars:** refit to r 0.9, h 5. The model's base rubble is r ~0.95, and its body is only r ~0.45 above 1 m.
- **Moves:** the tree (0, −36) is gone (the obelisk took its place), the arena now has pines at (−33, 8) and (33.5, 14), the spawn at (0, −32) went to (−3.5, −30),
  the barrel at (−0.5, −14) moved out of the arch mouth to (−3.2, −12.8), the rock prop moved to (−16.5, −11.5), and the 4th table rock was kept off the pen fence.
- **`tools/optimize-models.sh`** has two new optional arguments: a simplify error, and a target triangle count. With a target it runs meshoptimizer's *sloppy*
  simplifier through an embedded node step, installing its npm deps in a temp dir. Meshy exports have so many UV seams that the regular simplifier stalls around
  4k triangles whatever ratio you ask for. The exact commands are in the script header.

**Performance:** per-frame WebGL counts, all passes including the shadow map, measured by hooking `draw*` in `/tmp/wa-environment/perf.py`
(`renderer.info` isn't reachable from my files):

| view | draw calls before → after | triangles before → after |
|---|---|---|
| courtyard (player eye) | 400 → 271 | 0.76M → 1.16M |
| meadow (player eye) | 329 → 198 | 0.56M → 0.98M |
| aerial | 631 → 421 | 0.90M → 1.35M |

Scene meshes went from 511 to 395, with 11 InstancedMeshes. Draw calls fell by about a third. Triangles rose about 50%, because the map gained
about 180 textured trees and rocks plus 7 detailed landmarks, where before it had cones and dodecahedrons. The first cut was 2.3M, before the far trees,
the sloppy rocks and the simpler pillar. Further levers, if needed: fewer outside trees, no shadows on the rim rocks, or a ~2k arena oak.

**Verified (server 4102):**
- Screenshots, all looked at: `o_n_courtyard`, `o_n_meadow` (the arch frames the path to the pillar), `o_n_rim`, `o_n_aerial`,
  `o_n_pillar`, `o_n_cart`, `o_n_obelisk`, `o_n_trees`, `o_n_tablerock`, `c_south` (collider overlay of the arch, cart, pillars,
  table rocks and trees), and lineups `lu_*`. No page errors.
- Botmatch 90 s: 8 kills, goats fine.
- Three 180 s stuckwatch runs with 5 bots: 21, 36 and 32 kills. Stalls ran 6.5–12 s. Most were at old spots (tractor ×3, crop field, pen fence); one was beside an oak
  and one at the obelisk, probably low-HP bots hiding behind them as cover, since both now pass `coverPoint`'s r ≥ 0.8 rule.
- `homesim.mjs`: goats get home from every spot, including 6 new ones by the arch, obelisk, cart and table rock (7.5–26 s, no ghosting).
- `goatthrow_test.mjs` still passes.

## For the gameplay agent / Ty
- Requests filed in `requests.md`:
  - optional: call `trampleCrops(x, z, r)` from `world.js` on Meteor impacts and cyclone pulses
  - heads-up on collider kinds, the `hay` prop, the `return` goat state and `ARENA_RADIUS` 40
- `COLLIDERS` is about 300 circles now. The client camera boom, server projectiles and bots all loop over it. That is fine at this size, but
  fences and crops are where the count lives if it ever matters.
- `tools/test/goat_e2e.py` (coordinator-owned) still aims its first screenshot at the old hillside house position (9, 48) and
  picks goats by line of sight. It should still work, but its farmhouse shot will now look past the house.
