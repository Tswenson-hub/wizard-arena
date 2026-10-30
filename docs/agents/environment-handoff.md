# Environment hand-off: the farmstead

## Round 13: double-jump verification, the barn's walls, and two spell assets (ice wall, acid puddle)
**Reach with the double jump** (`JUMP.height` 1.45 + `AIR_JUMP.height` 1.2): the best apex is **2.65 m** above the take-off floor and a
ledge grab reaches **3.85 m**. Checked with the game's own rules (`surfaceHeight`, `surfacePushOut`, `ledgeTarget`) from just outside every
edge of every standable surface (`/tmp/wa-environment/reach2.mjs`, `reach3.mjs`), then in game (below).
- **Nothing new opens up.** Every perch at 2.65 m or less (the three ruin ledges at 2.0, the loft deck at 2.28, the high plateau and the
  pen rock at 2.5) was already reachable from the ground with a single jump plus a ledge grab (2.65 m) since round 10. The double jump
  only skips the pull-up. Their stairs and ladders are still the quick way up, and each keeps its counter (a second route, or cover).
- **The watchtower stays ladder-only.** Its deck is 4.25 m up, 0.4 m beyond the 3.85 m grab, and nothing standable is near it. Its roof
  has no collider and isn't a surface, so you can't grab or stand on it.
- **Roofs:** the farmhouse, barn and well are colliders, not surfaces, so `ledgeTarget` never targets them. Nobody can grab onto or stand
  on a roof.
- **The rim:** you can't leave over it at any height. The client clamps you to the arena circle every frame (main.js), the server clamps
  dashes radially, and the farthest surface corner (the tower deck) is 38 m out of 40. Note for spells: the server's `state` clamp
  (server.js, `np`) is a square ±40, so only a modified client could stand outside the circle in the corners. That's unrelated to jumping.
- **Low colliders you can now hop over from the ground** (h 1.45–2.65): hay bales (cover and the pen stacks), blast rocks, the cart (2.0),
  the pen shelter (2.4), the scarecrow, the obelisks' feet and the fallen pillar's foot. None is standable or encloses anything, so you come
  down beyond it or slide off its top. That's the agility Ty asked for, so I left them alone.
- **Fixed: the barn** (`fe901b8`). Its wall colliders were 4 m tall, but its roof is 4.2 m at the eaves and 5.7 m along the ridge
  (measured from barn.glb). A double jump from the hay loft's deck (apex 4.93) or its hay stack (5.92) could clear a wall and drop through
  the roof into the barn. The posts under the roof (model z −2.4..1.15, 50 of 60) are now **6 m** (`BARN_POST_H`); the open door leaves
  stay 4 m. Spells now stop at 6 m on those wall lines, where the roof slope would have stopped them a step later anyway.
- **Known, not changed: the watchtower roof.** On the deck, a jump puts your head into the roof (from 6.4 m) and a double jump puts your
  whole body in it for a moment. A single jump already did this before round 13. An invisible cap would need a head-clearance check
  in the jump physics, and the push-out code would shove you off the deck rather than stop you, so it's spells' call. Under a 2.1 m roof it
  would cap the jump at about 0.3 m, which also stops hopping over the parapet.

**Glacial Bulwark's ice wall** (coordinator's request, Ty's Meshy model):
- **The model:** `public/models/ice_wall.glb`, shrunk with `tools/optimize-models.sh one <src> ice_wall 0.4 1024`: 7.3 MB and 14k tris
  down to **406 KB and 7.4k tris** (1024 webp textures).
- **`effects.wall()`:** the model loads once on first use (a dynamic `GLTFLoader` import, cached in `effects.iceWallModel`). Each wall clones
  it at `BULWARK.width` × `BULWARK.height` and 0.7 m thick; the gameplay collider is unchanged.
  - The procedural slab and crystals show until the model loads, or for good if it fails.
  - **Material:** frosty and translucent (opacity 0.92, low roughness, a blue emissive at 0.3).
  - **Damage:** `setHp` still reveals the cracks (moved out onto the thicker faces) and clouds the ice (opacity down to 0.75, emissive down
    to 0.1). The shatter is unchanged.

**Toxic Flask's pool** (Ty's Meshy concept render):
- **The texture:** `public/textures/fx/acid_puddle.webp` (163 KB, 1024², alpha).
  - The grey background became alpha, by flood-filling from the borders so the dark soil patches inside stay.
  - The grey fringe was un-premultiplied out of the edges, the image trimmed, and its height stretched 1.52× so the puddle reads round
    from above. Script: `/tmp/wa-environment/puddle.py`.
- **`effects.toxicPool()`:** a decal 2.5 R across, randomly turned, at `surfaceHeight` under the pool (so it lies on a deck or ledge), 0.1 m
  up, with polygonOffset and no depth write.
  - The green liquid fills most of the rim, and the splashes and soaked soil run a little past it.
  - The rim ring at R, the bubbles, the fumes, the grow-in, the fade-out and the scorch are unchanged.
  - **Leftover:** the bubbles (in the update loop, which isn't mine) still spawn at y 0.15 rather than at the pool's height on a raised
    surface.

**Update: the Toxic pool now uses Ty's 3D puddle model** (`public/models/acid_puddle.glb`: 8 MB and 14k tris down to 502 KB and 5.7k tris).
- **Size and placement:** scaled to 2.4 R across and flattened to 0.45 of that height so the vial lies low, on `surfaceHeight`.
- **Fade and glow:** the mesh's `onBeforeRender` drives its own fade from `endAt` and a green emissive pulse (0.3 ± 0.15), so the shared
  update loop is untouched.
- **Fallback:** the decal above shows until the model loads.
- **Shots:** `pool.png`, `pool_low.png` and `pool_end.png` (faded); no console errors.

**Verified** (port 4102; the HEAD server crashed on spells' half-landed constants while I tested the assets, so those shots ran from a
copy of `10bc641` plus my files):
- **Ice wall:** `wall_fresh.png`, `wall_fresh_angle.png`, `wall_half.png`, `wall_damaged.png`, `wall_shatter.png`.
- **Pool:** `pool.png` (from above), `pool_low.png`, `pool_end.png` (faded).
- No console errors. A 60 s hard/normal/easy botmatch with the barn change ran without errors.
- All screenshots are in `/tmp/wa-environment/`.
- **In game, against the spells agent's committed jump** (`9ac931c`, `a71870d`, `5023e57`; WA_DEBUG server on 4102,
  `/tmp/wa-environment/jumpcheck.py`, Metal flags):
  - **Flat ground:** the double jump peaks at **2.65 m**.
  - **The tower deck from the ground** (its west parapet, sprinting in, both jumps): peak 2.65, back on the ground. It stays ladder-only.
  - **The high plateau from the ground:** reached directly (y 2.5).
  - **A sprint double jump west from the loft hay at the barn:** peak 5.57. The 6 m wall stops it and it drops between the loft and the
    barn (x 17.3, outside the wall at 16.4); before the fix it would have cleared the 4 m wall. Shots: `jc_*.png`.
  - **Bots:** a 120 s botmatch with three Hard bots ran with no errors and no stalls.
  - No console errors.

## Round 12: one story, farm north, blast band, magic land south (`cd12afb`, notes for spells in `34bfaac`)
**The layout** (`map.js` header has the full map):
- **The farm (z > +5).** Farmhouse, barn, hay loft, leaning silo, well, cart, tractor, scarecrow and the cart road are unchanged.
  - The **goat pen** moved 9.5 m north and 1 m west (x 17..27, z 1.5..12.5), between the barn and the pen rock.
    - Its gate (z 6.1..8.9), `gateOut`/`gateIn`, the shelter, the trough and `GOAT_SPAWNS` are now relative to `PEN`, so they follow it.
    - Two hay stacks and two loose bales sit south of the gate.
  - The **pen rock** is reached by `wooden_stairs.glb` (yaw π, `sx` 0.75, landing at 2.5 m, move-only hand rails). It used to be ruin
    steps.
  - **Cover:** every farm cluster is round bales (`hay`): c1, c2, c5 (the old crate stack), c6, c8, c9, c10 (moved, the pen took its
    place), c12, c17 and c18.
  - **Trees:** pines and oaks, plus a new east oak at (32.3, −1) that screens the east spawn from the pen rock.
- **The blast band (z +5..−20).**
  - The altar, the scorch with its glowing cracks, the rune circle, blast stones (four now; 112° went for the new ledge), slabs, ten
    shards (was 26) and the c3/c4/c7/h1/h2 rocks.
  - The **felled silo** moved from the south-west meadow to bearing 80, 12–23 m east of the altar (`SILO_BEARING`). Its crates and barrels
    (props 20–24) lie on its north flank, 1.2 m off it, so a bot can walk between (at 0.45 m one wedged for 26 s).
  - Four **fence panels** lie flat on the farm edge (`FENCE_DEBRIS` in world.js). They're cosmetic and have no collider.
  - The **fallen pillar** is `rune_pillar.glb` on its side (`layFallenPillars`), 6.6 m long. Its collider is now a 1.7 m rubble foot and
    1.1 m shaft circles.
- **The magic land (z < −15).**
  - A second **archway** at bearing 222, 22 m from the altar (`ARCHWAYS[1]`, 7 m), and a second, upright **obelisk** at bearing 141, 24 m
    (`OBELISKS[1]`, 6.8 m).
  - A third **ruin ledge** (`ledge-c`, `LEDGE_SE` = bearing 122, 17.5 m) where the fort stood. It holds heal spot `ruin`.
  - **Broken rune pillars** as cover (type `pillar`): c11, c13, c14, c15 and c16, 2–3 each, 4.8–6.3 m.
  - **14 crystal clusters** (`CRYSTALS`, seeded, colliders r 0.5s, h 1.1s, kind `crystal`).
  - Six **vases** (pot props 25–30) and two rocks.
  - **Birches only.** The two south oaks became birches, and two birches were added.
  - The **grass turns violet** in the shader (`vMagic` from the instance's world z: none above −13, full past −20).
  - The outer ring of far trees is birch on the south side.
  - The **watchtower** stays put (its sight lines and heal spot are tuned) and is dressed as a mage's lookout: a violet pennant and a
    turning crystal over its roof.

**Removed:**
- The pumpkins (type, spawns, mesh, comments).
- The canopy fort (surfaces, oaks, `FORT`/`FORT_OAKS`/`CANOPY_DECK`, its heal spot) and the c5 procedural crate stack.
- The cylinder fallen pillar (`makeFallenPillar`), the silo footing ring (`SILO_FOOTING`) and the dead `C.ROOFS` loop.
- The `crates` cover type.

**Fixes:**
- **The invisible ledge parapets.** They're pieces of their own (`ledge-a-wall` etc., style `parapet`), so `swapModel('piece:ledge-a')` no
  longer clears them. They're drawn as two `rock_jagged` instances standing on the ledge, like the plateau boulders. Plain boxes looked
  unfinished.
- **Two props that were inside colliders before this round.** The rock prop at fromAltar(30, 9.5) sat in h2, so it's at (2.6, −0.6)
  now. Table rock 275° was 0.29 m from ledge-b's stairs (a snag), so it's at 16.2 m.

**Asset counts** (in the arena unless noted):

| Asset | Count |
|---|---|
| `rock_jagged` | 65, was about 150: rim 26, rock clusters 16, shards 10, blast stones 4, plateau boulders 3, parapets 6, none outside |
| `rune_pillar` | 4 + 1 lying + 13 |
| `archway` | 2 |
| `obelisk` | 2 |
| `ruin_platform` | 3 |
| `ruin_steps` | 1 |
| `wooden_stairs` | 1 (was 0) |
| `rock_table` | 4 + rim 26 + 12 outside |

**How I verified it** (server on 4102; scripts in `/tmp/wa-environment/`):
- **`check12.mjs`.** No prop inside a collider, a surface or another prop. No 0.02–0.95 m snag gaps between colliders, or between
  colliders and walkable pieces. Spawn clearances are in the next item.
- **Spawns** (`spawnsearch12.mjs`, `evalset.mjs`, `why.mjs`).
  - 415 valid candidates. The search keeps 4 on the farm side and 3 in the magic land.
  - The closest pair is 15.2 m apart (was 17), none sees another at chest height, none is overlooked by a perch within 15 m, and each is
    at least 14 m from every potion.
  - The longest clear ground line from a spawn is 37–60 m, and the mean over 72 bearings is 11.5–14.4 m.
- **Goats** (`homesim12.mjs`): a dizzy goat dropped at 67 spots, including round the new pen, the silo, ledge-c, the second archway, the
  second obelisk, the stairs and the east oak, gets home every time. The one "miss" starts inside the pen and just grazes.
- **Bots** (`stuckwatch12.mjs`, 150 s, four bots).
  - The first runs had stalls by the c4/h1/h2 rocks and one 26 s wedge at the silo's crate row. I fixed the crate row.
  - Later runs: 1–2 stalls of 6–11 s per run, all mid-fight beside cover.
  - Round 11 baseline (a worktree of HEAD on 4112): 1–2 stalls of about 6 s.
- **`botmatch.mjs 4102 60/90`** runs clean. `MATCH_DEBUG=1 node tools/test/modematch-unit.mjs`: ALL PASS.
- **Screenshots** (headless, no console errors):
  - The four for the coordinator: `r12_overhead.png`, `r12_farm_half.png`, `r12_blast_band.png`, `r12_magic_half.png`.
  - Close-ups: `r12_parapet.png`, `r12_ledge_se.png`, `r12_crystals.png`, `r12_grass_s.png`, `r12_grass_band.png`, `r12_east.png`.
  - Before: `r12_before_top.png`.

**Known issues and left over:**
- The spawns' closest pair is 15.2 m (south-west to south), 2 m tighter than round 11. More cover there would let them spread.
- Bots steer greedily, so they can still lean on a cover cluster for a few seconds when their target is straight behind it (the silo's
  base end and c4 make a channel east of the altar). That's the same behaviour as before, at about the same rate.
- The crystals, pillar stubs and fence panels have no Meshy models. The crystals and panels are procedural; the pillars use `rune_pillar.glb`.
- The farm's cover is now nearly all hay bales (31 big bales in clusters). A Meshy woodpile or crate stack would add variety.

## Round 11: map cleanup for a 4-player free-for-all
Ty found the round 10 additions cluttered and haphazard. Commit afb8b0f.

**Removed:**
- the farmhouse annex: the deck, the shed on posts, the shed-to-watchtower bridge and the shed's roof
- the narrow covered walkway from the annex onto the cart road, and its roof (`C.ROOFS` is gone; world.js reads `C.ROOFS || []`)
- the farmhouse porch (a stand-in deck)
- the loft gallery along the barn's east wall, with its Meshy stairs, its ladder and its hay
- all 44 round-10 cover clusters: the grey wall and green hedge blocks, plus the Siege-fairness walls `h1`/`h2`/`h4`
- `SIEGE_ZONES`, `SIEGE_SPAWNS` and `TEAM_SPAWNS`
- the `plateau-high` potion spot (8 m from the loft's; it blocked any spawn on the east side)

The old crop field is meadow again: no dirt patch, grass grows on it, and the scarecrow and pumpkins stay. The watchtower
parapet's west gap (where the shed bridge landed) is closed.

**Kept, unchanged:**
- the canopy fort
- the ruin ledges with their stairs and plank bridge
- both rock plateaus
- the pen rock with its steps and bridge
- the hay loft, the leaning silo up to it, and the loft-to-high-plateau bridge. Without the gallery this reads cleanly; the
  loft's ways up are its ladder, the silo and the bridge.
- the embankment cart road
- the watchtower

**Cover:** `COVER_CLUSTERS` has 20 clusters, all of real models: 16 rock outcrops (Meshy `rock_jagged`, mostly four rocks
in a shallow arc), 3 hay stacks and 1 crate stack in the farmyard.
- Each cluster is at least 6 m from the next.
- 18 were placed by `/tmp/wa-environment/coverplace11.mjs`, a copy of the round-10 placer limited to these types, aimed at
  ground lines over 30 m.
- Two (`h1`, `h2`) are hand-placed either side of the path across the open strip between the yard and the altar, where
  every 70 m+ line ran.
- `gapfix.mjs`: no snag gaps under 1 m. `c4` and `c13` were then moved for the goats (see below).

**Sight lines at chest height** (`sightlines.mjs`; reports `sight_r11_nocover.json` and `sight_r11_final.json`):

| | round 10 (44 clusters) | round 11, no cover | round 11 (20 clusters) |
|---|---|---|---|
| median | 6.9 m | 13.1 m | 8.8 m |
| p90 | 22.4 m | 37.9 m | 25.7 m |
| p99 | 42.3 m | 60.4 m | 45.2 m |
| rays > 40 m | 533 | 3,943 | 867 (1.9%) |

The target was 20–30 m duel lines; p90 is 25.7 m. The archway lane (60 m) is kept open on purpose, and the longest
remaining lines cross the altar's north side along the south path.

**FFA spawns:** `SPAWN_POINTS` has seven entries, `[x, 0, z, yaw toward the centre]`, round the rim at r 31–37. Picked with
`/tmp/wa-environment/spawnsearch11.mjs` and `overlook.mjs`.

| spawn | x, z |
|---|---|
| N | 8.5, 30 |
| NW | −17, 27 |
| W | −32, 5.5 |
| SW | −22, −24 |
| S | −6.5, −32.5 |
| SE | 10.5, −34.5 |
| E | 33, −7 |

- The nearest pair is 17 m apart, and the rest are 18–36 m.
- No spawn can see another at chest height.
- Every spawn is at least 14 m from a potion.
- The nearest perch with a line onto a spawn is 10.3 m away (the fort's oak decks onto E and SE). The west and north spawns
  have no perch within 18 m.
- The barn, loft, pen, pen rock and fort take up the east half, so only one spawn is there.

**Checks:**
- `surface_test`: 29 checks pass.
- **Goats:** `homesim11.mjs` (the round-10 spots minus the removed pieces, plus one beside each new cluster and each
  spawn, 70 spots): every goat got home in two runs, with no ghosting; the longest took 36.7 s.
  - `c4` (east of the altar) was moved twice. First it put a fallen-pillar detour corner inside its rocks. Then it blocked
    the goats' west-to-gate lane along z −2.
  - `c13` was turned north–south: from the south-east corner, goats ghosted 2 times in 5.
  - `goatthrow_test` and `ramsummon_test` pass. Their "clear lanes" moved to the old field (z −8.5), because the new `c16`
    sits in the old south-meadow lane.
- **`server/goats.js`:** `wardFacing` called `C.kitOf(p.wizard)`, which no longer exists. A ram meeting a warding wizard
  would have thrown. It now reads `C.SPELLBOOK[p.loadout?.guard]?.allSides`.
- **Botmatch, 90 s, 4 bots:** no errors.
- **Stuck-watch** (3 runs of 4 bots, 120–150 s, 12–14 kills each): 9 stall episodes.
  - Eight were 6–9.5 s, at cover, the altar or a ruin ledge (bots holding a spot), the same as round 10.
  - One was 18 s behind the `c17` outcrop on the east rim, in one run of three. If it shows up again, straighten that arc.
- **Screenshots**, all looked at: `r11_before_top` and `r11_before_aerial` (round 10, with the overlay), `r11_aerial`, `r11_aerial_nw`, `r11_fort`,
  `r11_ledges`, `r11_barn` (loft, silo and bridges), `r11_penrock`, `r11_road`, `r11_plateau_low`, `r11_tower`, and the
  eye-level shots `r11_eye_s`, `r11_eye_w` and `r11_eye_e`, all in `/tmp/wa-environment/`.
  - They show no walkways, no grey or green blocks, and the rock outcrops reading as one family with the blast stones.

**Still stand-ins (models from Meshy would replace them):** the fort's decks, bridges, rails and plank walls, and the crate
stacks. The ledge parapets and the perch boulders are as in round 10.


## Round 10: a dense, connected, vertical map (plus Ty's pen and stairs-into-rock notes)
**`HEAL_SPOTS`** (committed first, abfded1): six potion spots, all at least 17 m from every spawn.
- bridge crest 2.45
- canopy centre deck (15, −16) 4.2
- loft 2.28
- high plateau 2.5
- low plateau 1.5
- watchtower 4.25

**New pieces** (all stand-ins drawn from their surfaces, except the reused Meshy models):
- **Canopy fort** (`FORT`, south-east of the altar):
  - three 13 m oaks (`TREES` 12–14) on bearings 60/180/300° at 5.5 m round a centre deck (4.2 m)
  - a deck round each trunk (3.9 m), bridged to the centre
  - stairs up the south oak, ladders up the other two
  - low plank walls and crates on the decks as cover
  - the foliage is `LOS_VOLUMES` (line of sight only)
  - Not moved onto a Siege zone: Ember's Siege spawns are about 48 m of walking from it, Frost's about 25 m.
- **Farmhouse annex** (replaces the crop field; scarecrow and pumpkins kept):
  - annex deck (1.5 m, crates on it)
  - a walled shed on posts (3.0 m, walls west/north/south, open toward the altar, roof)
  - a plank bridge from the shed to the watchtower (a gap cut in the parapet)
  - a covered walkway from the deck onto the cart road's crest
  - a porch (0.9 m) on the farmhouse's west wall
  - Ways up: the deck's north stairs, the walkway, stairs deck→shed, the shed's ladder, the tower's ladder.
- **Barn complex:**
  - the loft extended into a gallery along the barn's east wall (2.28 m)
  - wooden stairs (Meshy) up to it from the pen side
  - a ladder down toward the courtyard
  - a hay bale on it as cover
  - a silo leaning up to the loft (silo.glb at half size, tilted; its top is the ramp)
  - a plank bridge (Meshy) from the loft to the high plateau
- **Pen rock** (Ty's "stairs leading into rock"): ruin steps up onto a rock plateau (2.5 m) on ground the smaller pen freed, bridged north to
  the high plateau. That makes one high route: pen side → pen rock → high plateau → loft → gallery → down by the barn.
  - The high plateau's own wooden stairs went (their spot is the bridge); its ways up are the two bridges.
  - No new stairs-into-rock file was on the Desktop, so it pairs `ruin_steps` and `rock_plateau`.
- **Pen:** a third of the area (x 18..28, z −8..3); the gate is unchanged; the shelter, trough and goat spawns moved inside.
- **Cover clusters** (`COVER_CLUSTERS`, 44, colliders of kind `cover`; `h1`, `h2`, `h4` are hand-placed for Siege fairness, see below):
  - hedges (1.9 m), broken stone walls (1.8 m), hay stacks, crate stacks and tall rocks
  - The greedy placer (`/tmp/wa-environment/coverplace.mjs`) put them where the most long chest-height lines crossed, set across those
    lines and typed by area: hay and crates in the farmyard, rocks and walls at the blast site, hedges and walls elsewhere.
  - They're kept off paths, zone cores (they may ring a zone's edge), spawns, heal spots, the pen, the gate approach, props and the archway lane.
  - `gapfix.mjs` then nudged clusters so no gap to anything is between 0 and 1.05 m (no snag pockets).
- **Cover on every perch:**
  - a boulder on each rock top
  - a broken-wall chunk on each ruin ledge
  - the tower parapet now blocks spells
  - hay on the loft and gallery
  - crates and walls on the fort and annex
- **Grass:** 760 tall + 950 clover (was 640 + 800).

**Sight lines at chest height** (1.3 m; a 2 m grid of free ground, 48 directions; `/tmp/wa-environment/sightlines.mjs`, reports `sight_before.json`
and `sight_after.json`):

| | before | after |
|---|---|---|
| median line | 14.5 m | 6.9 m |
| p90 | 41.8 m | 22.4 m |
| p99 | 65.4 m | 42.3 m |
| rays > 25 m | 12,518 of 43,776 (29%) | 3,065 (8%) |
| rays > 40 m | 4,946 | 533 |
| grid points with a line > 35 m | 909 of 912 | 522 |
| archway lane | 60 m | 60 m (kept) |

- **The 25 m target is not fully met.** A few rim-to-rim diagonals (up to 76 m) still thread the deliberately open places: the Altar and
  Barn Passage zone cores, the main paths, and the goats' gate approach.
- Closing them means cover inside the zone cores or on the paths. That's a call for Ty/the coordinator; the placer is ready to run with those allowed.

**Checks:**
- No perch overlooks a spawn within 15 m (`perchcheck.mjs`). The TDM Frost spawns moved to the south rim, so TDM Frost now averages 29 m to the
  altar against Ember's 21 m.
- **Jump apex 1.45:** see requests.md. The ledges were raised to 2.0 m; no cover can be hopped.
- **Goats:** all 49 test spots get home with no ghosting (longest 36.9 s).
  - Routing now ignores decks a goat walks under.
  - The gallery ladder moved off the barn wall (it trapped goats).
  - Each cover cluster is a detour box.
  - Goat throw and summoned-ram tests pass; the orbit test moved to a lane the new hedges didn't block.
- `surface_test`: 29 checks pass.
- **Botmatch 90 s:** no errors.
- **Stuck-watch, 5 bots × 120 s:** 9 kills (fewer than before: much more cover), one 6.3 s stall by the road.
- **Siege (`modematch siege 300 hard` ×3, MATCH_DEBUG=1):**
  - **First pass:** Frost swept, worse than before (0.5–100, 45.9–100, 69.3–98.7). The annex, the tractor and three new clusters sat in
    Ember's lanes, and Ember bots took about 4 s longer to reach zones.
  - **Fix 1:** the Ember Siege spawns moved east of the tractor, to (−12, 14) and around (r 17–20). The three lane clusters were removed.
    - Grid shortest walks are now Ember 6.4 / 7.8 / 10.1 s, Frost 8.2 / 9.4 / 9.5 s (altar / barn / silo).
    - Ember's altar walk is under the 8 s penalty target. It offsets the steering losses bots take on Ember's cluttered side; in practice
      respawn-to-zone is even.
    - **Result:** respawn-to-zone came out even (about 9 s), but Frost still won 3 of 3. Frost had about 2:1 K/D whichever bots it drew.
  - **The cause:** a death map (`deathmap.mjs`) showed Ember dying at the zones' open north edges while Frost fought from the cover south of them.
  - **Fix 2:** three hand-placed broken walls on Ember's approaches (`h1`/`h2` flanking the Altar path and the Barn Passage's north-west rim,
    `h4` north of the Silo zone).
  - **Final:** Frost 100–12.6, a near tie at the cap (Ember 82.9 – Frost 91.9), Ember 100–68.5. 0 friendly fire, no stalls near spawns,
    every respawn at its own siege spawn.
- **Screenshots**, all looked at: `r10_aerial`, `r10_top`, `r10_fort`, `r10_fort_eye`, `r10_annex`, `r10_annex_eye`, `r10_barn`,
  `r10_barn_eye`, `r10_pen`, `r10_meadow_eye`, `r10_yard_eye`.

**Meshy pieces Ty could make to replace stand-ins:**
- wooden deck or porch section (the annex deck, porch, gallery and fort decks)
- a shed on stilts (the annex shed)
- covered walkway or balcony section (the walkway, the gallery)
- hedge segment
- broken stone wall segment
- a rope ladder (fort, gallery, shed)
- a long wooden stair, about 4 m rise (the fort's south stairs)
- a crate stack
- a standing broken silo (not used yet)


## Round 9: platforms and ramps (walkable surfaces + Ty's Meshy high-ground pieces)
**Surface model** (`map.js`, re-exported by constants.js; spells wires movement, projectiles and LOS to it):
- `SURFACES`: boxes and ramps with options `round`, `thick` (a deck you can walk under), `moveOnly` (ladders and rails: no effect on shots)
  and `ladder`.
- Helpers:
  - `surfaceHeight(x, z, footY)`: STEP_UP 0.45
  - `surfaceTopAt`
  - `surfaceSolidAt`
  - `surfacePushOut(x, z, footY, r, height)`
  - `surfaceSegmentHit` / `surfaceBlocks`
  - `surfaceCorners`
  - `rampFoot`
- 29 checks in `/tmp/wa-environment/surface_test.mjs` cover steps, slopes, walls from the side and below, decks, round footprints, ladders,
  and shots into sides, tops, slopes and undersides.
- `piece(id, model, at, parts)` places a model at `{x, z, yaw, h, sx, sz, y, modelYaw}` and fits its surfaces in the model's own units.
  Those were measured from top-down heightmaps and horizontal slices of each optimised glb (`/tmp/wa-environment/heightmap.mjs`, `slices.mjs`),
  then checked with a lineup render. `PIECE_MODELS` drives `world.js`. Until a model loads, a plain stand-in is drawn per surface.

**Thin walls aren't standable (fix):** surfaces may carry `noStand: true`. `surfaceHeight` never returns their top, and `surfacePushOut`
walls them off whenever the feet are below their top, with no step-up. Every `rail`-style part gets it automatically: the tower parapet, the
stair rails and the bridge ropes. So do the stone side walls of the low plateau's steps.
- Before the fix, a jump from the tower deck (peak +1.1 m) could perch on the 25 cm parapet at 5.53 m.
- Now none of 48 scripted jumps from the deck lands above it (`/tmp/wa-environment/railjump.mjs`). Only jumps toward the open ladder side
  leave the deck.
- No standable surface narrower than 0.6 m remains. The loft's hay bale (1.0 × 1.2 m, 1 m above the deck) is standable on purpose.

**Pieces** (models shrunk with `optimize-models.sh one … 0.3 <px> 0.02 <tris>`: 2.1k–6k tris, 1024 px, the vases 512 px):

| piece | model(s) | where | top | way up / counter |
|---|---|---|---|---|
| ruin ledges A + B | ruin_platform ×2 (h 2.0, 0.8 stretch) + plank_bridge (h 2.6) | west rim of the blast site, r 11.6 at 237° / 273° | 1.8 m, bridge crest 2.45 | each its own stairs (facing away from the altar) plus the bridge; ring pillars and stones as cover |
| watchtower | wooden_watchtower, h 8.5 | SW corner of the field (−32.8, −14.8) | deck 4.25 m (fits two) | ladder on the east face; parapet blocks walking only, not spells; no cover |
| hay loft | hay_loft, h 3.3 | east of the barn (20.6, 21.5) | deck 2.28 m, hay bale on it | ladder facing the barn; under the deck is open |
| low plateau | rock_plateau (h 1.6, ×1.5) + ruin_steps | SE meadow (26.5, −22.5) | 1.5 m | stone steps on the west; hay stacks and the oak screen Frost |
| high plateau | rock_plateau (h 2.66, ×1.25) + wooden_stairs | NE meadow past the pen (29, 18.5) | 2.5 m | wooden stairs on the south |
| cart road | embankment ×2 nose to nose (h 1.0, ×1.3) | farmyard west (−10.5, 0.7..8.3) | 0.9 m crest | both ends |

- Also swapped in: the **Meshy well** (`C.WELL` r 1.05, h 3.4, with its collider up to the roof for the camera) and the **two vases** for
  the `pot` prop (alternating).
- No piece overlooks a spawn from closer than 15 m. That moved one Frost team spawn, (−11, −28) → (−13.5, −31.5). The barn-nook loft
  stand-in is gone: the Meshy loft is 3 m wide and the nook is 1.8 m.
- **Fit notes:**
  - The ruin platform's built-in stairs are short and steep. Their surface is one ramp from the foot to the top edge, so feet float up to
    about 0.2 m above a tread mid-flight.
  - The embankment top is lumpy by ±8 cm.
  - The bridge arch is 4 ramps (within 3 cm of the deck).
  - A rope across one end of the bridge is visual only.
  - The tower roof has no collider. The camera on the deck can meet its underside; that's noted for spells in requests.md.

**Goats:**
- Footprints are obstacles: push-out, charges go dizzy against a side, thrown goats land on solid parts. Goats walk under decks.
- Return routes go round each footprint exactly, plan from outside one, and re-plan after two failed side-steps.
- The crop field is now a detour box too. Returning goats used to walk into it; that predated this round, but no earlier test spot crossed it.
- The ghost fallback is now 40 s, because the far west edge is a 30 s trot.
- `homesim`: 57 spots, all home with no ghosting (3 runs, longest 32 s). The goat throw and summoned-ram tests pass.

**Verified (4102):**
- Botmatch 90 s: no server errors, goats calm.
- Stuck-watch, 5 bots × 120 s: 13 kills, four 6–10 s stalls, none at a new piece (by the altar's NW ring pillar and in the crop field).
  Bots don't use surfaces until spells wires them.
- **`modematch siege 300 hard` ×3** (0 friendly fire, no stalls near spawns):

  | run | Ember | Frost | winner |
  |---|---|---|---|
  | 1 | 57 | 100 | Frost |
  | 2 | 47.6 | 100 | Frost |
  | 3 | 64.8 | 94.3 | none |

  Per-zone holds were mixed, with Barn Passage going to each team once. Median respawn-to-zone time was Ember 9.8–12.2 s and Frost 7.0–9.4 s.
  That's the same Frost lean as before this round (Ember bots arrive about 2 s later), not caused by the pieces.
- **Perf** (5 player-eye views, stand-ins → Meshy): draw calls −85 to −137, triangles +0.06–0.10 M.
- **Screenshots**, all looked at:
  - a wizard standing on each piece, from the side: `on_plateau_low`, `on_plateau_low_steps`, `on_plateau_high`, `on_stairs_high`,
    `on_loft`, `on_tower`, `on_ledge`, `on_bridge`, `on_road`, `on_road_slope`
  - from below: `hg_below_*`
  - `hg_well`
  - the lineup `lu9_*` and `br_*`
  - The feet sit on every visible top; the client kept each set height.
- Found and fixed with these shots: a 3 cm gap between the two embankment crests that dropped you to the ground.


## Painted sky and grass (Ty's assets)
**Sky.** `public/textures/sky.jpg` (2048×1024, 215 KB) is baked by `tools/make-sky.py` from `~/Desktop/Meshy_AI_fantasy_blue_skybox.png`
(a 1536×864 panorama; the original is untouched).
- **Mapping:** the painting fills the upper hemisphere of a 2:1 equirectangular map, horizon at the middle row and linear in elevation, as
  three.js samples it. The lower half is the horizon colour, #48d7f2. `world.js` loads it as `scene.background` with
  `EquirectangularReflectionMapping`, so there is no sky sphere and nothing to fit inside the camera's far plane.
- **The wrap seam:** the last 128 source columns are crossfaded into the first ones and dropped. After the roll, that band sits to the
  north-west of the arena. Looking straight at it (`sky_seam.png`), the clouds run through with no edge.
- **Sun alignment:** the panorama is rolled so its brightest sunbeam column sits at the DirectionalLight's bearing (from (30, 50, 20)), so
  the painted sunbeams are where the shadows say the sun is.
- **Scene match:** the fog is now `SKY.fog` 0x7cc9de (the horizon cyan softened, so the hills and mountains melt into the horizon), the hemisphere
  sky colour is 0xd6efff and the sun is a warmer 0xffe9c4 at 2.3.
- Until the texture loads, the background is the horizon colour.

**Grass.** `public/models/grass_tall.glb` (610 tris, 128 KB) and `grass_clover.glb` (704 tris, 59 KB), from Ty's two Meshy files via
`optimize-models.sh one … 0.3 512 0.02 <target>`. At 393 tris the clover went blocky, so it was re-run at 760.
- **Cosmetic only:** no colliders, no LOS effect, no shadows cast.
- **`GRASS_ITEMS`:** placement is seeded, so all clients match. Clump centres are drawn by rejection sampling from a density field:
  - strongest along the pen fence and the crop field's edge, and round trees, rocks, stones, the silo, the obelisk, pillars, the scarecrow
    and the hay stacks
  - plus the south meadow
  - a thin fringe at the rim and a little in open ground
- **Clumps:** 3–8 plants within about 0.3–0.8 m. Tall grass is favoured at edges, clover in the open. Height, yaw and tint vary (brighter than the
  texture, a touch green, some yellow).
- **Kept clear:** paths (the `PATHS` list now drives both the path strips and this), the farmyard, the blast scorch, the siege circles, every
  spawn point, props, the pen floor, the crops, the silo footing, the well and every collider. The Barn Passage siege circle covers the pen's
  west fence, so that stretch stays bare.
- **Counts:** 640 tall and 800 clover. `?low` gives 220 and 280.
- **Rendering:**
  - one InstancedMesh per 12 m chunk per kind (instance colours for the tint), double-sided
  - the vertex shader sways the tops (`uTime`) and shrinks each clump into the ground between 20 and 30 m from the camera (`?low`: 14–22)
  - a `scene.onBeforeRender` hook in world.js advances the clock and hides chunks beyond the fade, so nothing in main.js ticks it

**Per-frame cost** (draw calls / triangles, every pass including shadows, measured with `/tmp/wa-environment/perf.py` from player-eye views
on a bot-free FFA server; "before" is HEAD served alongside):

| view | before | after | ?low before | ?low after |
|---|---|---|---|---|
| farmyard, facing south | 509 / 1.28M | 464 / 1.33M | 278 / 0.65M | 266 / 0.63M |
| south meadow, facing north | 558 / 1.38M | 549 / 1.80M | 316 / 0.73M | 328 / 0.90M |
| by the pen fence | 360 / 1.06M | 392 / 1.34M | 154 / 0.41M | 170 / 0.46M |
| west rim | 438 / 1.27M | 454 / 1.64M | 241 / 0.62M | 241 / 0.71M |
| by the crop field | 346 / 1.29M | 364 / 1.40M | 140 / 0.63M | 140 / 0.67M |

- The `?low` columns were measured with the 26–38 m fade, before the final tightening.
- At the first counts, with a 26–38 m fade and 16 m chunks, it cost up to +0.6M triangles. The tighter fade and smaller chunks brought that down
  to these numbers.
- The draw-call counts swing by ±40 between runs, because effects and the camera boom vary.

**Verified:**
- **Screenshots**, all looked at:
  - sky: `sky_n`, `sky_e`, `sky_s`, `sky_w`, `sky_up`, `sky_seam`, `sky_seam2`, `sky_aerial`, and the join-screen drift camera `sky_join`
    (dimmed by the join panel, looking down)
  - grass: `grass_fence`, `grass_field`, `grass_meadow`, `grass_meadow2`, `grass_rim`, `grass_low`, and close-ups `gv_front` / `gv_top`
- No page errors. Botmatch 4102: bots fight, goats fine, no server errors.
- One SwiftShader crash on the first join-screen screenshot didn't reproduce on retry or in the 10+ runs since.
- `tools/make-sky.py` is new and mine, alongside `optimize-models.sh`.


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
  - **With the committed 26 m cluster** (4 runs): 87.3–96 and 76.2–80.2 (both reached the cap with no winner), 1–100 and 61.1–100 to Frost.
    Median respawn-to-zone time was Ember 9.4–12.1 s and Frost 7.3–10 s. No stalls, and every respawn was at its own siege spawn.
  - **Tried and reverted:** Ember at bearing −55° (to clear the tractor on the straight line to the altar). Over 3 runs: 33.5–100, 0–100 and
    99.6–41.7 (no winner). That's no better than −50°, with outcomes driven by team strength. Per-zone respawn-to-zone medians were within
    8–15 s for both teams, but they swing with which team is losing.
  - **Remaining lean:** Ember bots arrive about 2 s later than Frost in practice (pathfinder: about 0.5 s). Bots steer rather than pathfind,
    and Ember's routes pass the tractor and the crop field's corner. Frost has won more of the matches since the change, but several were close.
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
