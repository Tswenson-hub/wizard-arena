# Environment hand-off: the farmstead

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

## For the gameplay agent / Ty
- Requests filed in `requests.md`:
  - optional: call `trampleCrops(x, z, r)` from `world.js` on Meteor impacts and cyclone pulses
  - heads-up on collider kinds, the `hay` prop, the `return` goat state and `ARENA_RADIUS` 40
- `COLLIDERS` is about 300 circles now. The client camera boom, server projectiles and bots all loop over it. That is fine at this size, but
  fences and crops are where the count lives if it ever matters.
- `tools/test/goat_e2e.py` (coordinator-owned) still aims its first screenshot at the old hillside house position (9, 48) and
  picks goats by line of sight. It should still work, but its farmhouse shot will now look past the house.
