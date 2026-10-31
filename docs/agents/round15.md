# Round 15 brief: castle courtyard, KayKit Mage and Skeleton bots (the overhaul)

## Context
Ty isn't in love with the farm map and wants a professional, consistent theme. He chose option 1, a castle courtyard
built from CC0 kits, plus matching characters and animations. He downloaded these to `~/Downloads` (all CC0, already
extracted):

| Pack | Folder | Contents |
|---|---|---|
| KayKit Dungeon Pack 1.1 | `KayKit_Dungeon_Pack_1.1_FREE` | 211 glTF pieces, one 1024 atlas, 4 m wall and floor grid, walls 4 m tall |
| Quaternius Medieval Village MegaKit | `Medieval Village MegaKit[Standard]` | 176 glTF pieces, 2 m grid, 3.12 m storeys, 2048 PBR tiling textures (heavy) |
| KayKit Adventurers 2.0 | `KayKit_Adventurers_2.0_FREE` | Mage (skinned parts, hat 2.65 m tall); `staff`, `wand` and `spellbook` props |
| KayKit Character Animations 1.1 | `KayKit_Character_Animations_1.1` | Rig_Medium clips: the same 23 joints as the Mage, matched by name; in-place clips |
| KayKit Skeletons 1.1 | `KayKit_Skeletons_1.1_FREE` | Skeleton_Mage, Minion, Rogue, Warrior on the same rig |

**Ty's choices:**
- Every player is the KayKit Mage, tinted by their spells' element mix. **Bots are KayKit Skeletons.**
- **Remove the goats** (and the pen).
- **KayKit-led bright courtyard:** the dungeon kit is the main kit, and Quaternius is used only for roofs, towers and
  balconies, with simplified textures. Open air, under the painted sky and mountains, with torches and banners.

**What the code survey found:**
- **Map:**
  - Server, bots and physics only read generic exports: `COLLIDERS`, `SURFACES`, `SPAWN_POINTS`, `HEAL_SPOTS` and
    `PROP_SPAWNS`. No hard-coded farm coordinates in server.js or bots.js.
  - **But** `map.js` `buildMap` (:492-737) **requires** the farm kinds (`one('altar'|'farmhouse'|'pen'|...)` throws
    without them) and hand-fits farm collider shapes.
  - `world.js` builds a procedural farm, `FARM_MODELS`, farm scatter and ground zones.
  - The editor's model list isn't recursive (`server/mapedit.js:27`), and there's no generic box-collider kind.
- **Character:**
  - The game's animation vocabulary is about 80 keys (`spellanim.js` `COMMON_ANIMS` :44 and `SPELL_ANIMS` :75-341,
    plus the base clips idle, run, block, cast_fast, cast_heavy, stun and dash).
  - Meshy bone names are hard-coded across looks.js, wizard.js and main.js (`RightHand`, `Hips`, `Head`, `LEG_BONES`
    and so on).
  - `main.js` has fallbacks that hard-code offsets into the Meshy clips (`cast_fast` from 0.25 s, `cast_heavy` from
    1.9 s, `dash` from 2.2 s, and so on).
  - The robe tint recolours red pixels (`RECOLOR_GLSL`, looks.js:724), which won't work on KayKit's atlas.
  - The projectile origin is the `RightHand` bone (main.js:1627).
  - Body height is assumed to be 1.8 m (constants `PLAYER_HEIGHT`, the nameplate at 2.25, the builder camera).
- **KayKit clips are missing** a flip, a roll and a kneel. The substitutes: the Dodge_* clips (0.4 s) for Roll, and
  Jump_Start plus a procedural spin for the double jump. Magic is well covered: Ranged_Magic_Shoot, Spellcasting,
  Spellcasting_Long, Raise and Summon, plus Throw, Use_Item, the Melee_Block* clips, Hit_A/B, Death_A/B and
  Spawn_Air/Ground.

**Precondition:** round 14 (pacing, the CrazyGames build and so on) finishes and is verified first. The spells agent
is still on its final balance runs and has an uncommitted `SPAWN_CHOICE` change.

## Phase A: in parallel

### Environment agent: the castle courtyard
**Kit import:**
- Copy only the pieces actually used into `public/models/castle/` (KayKit) and `public/models/village/` (Quaternius).
  Convert them to GLB with meshopt (`tools/optimize-models.sh`).
- KayKit pieces share `dungeon_texture.png` as one 1024 webp.
- Rebake the Quaternius pieces to small textures (512, or flat colours sampled from their materials) so they sit
  stylistically with KayKit and stay under budget.
- **Scale:** characters are 1.8 m. Scale the KayKit kit by the same factor the characters agent applies to the Mage
  (agree it in requests.md), so doorways and walls keep KayKit's native proportions. Scale Quaternius to match
  (its 2 m grid is about half of KayKit's).

**`map.js` generalisation:**
- Make every farm kind optional. Remove the `one(...)` requirements and the farm-only shapes (`HOUSE_BLOCKS`,
  `PEN_POSTS`, `FIELD`, `TRACTOR_BLOCKS`, `BARN_WALLS`, `SILO`, `WELL_SIZE` and `CART`), along with the farm scatter
  rules.
- Add a **generic `kit` kind:** `{kind:'kit', model:'castle/wall', x, z, rotY, scale, y?}`. Its colliders and surfaces
  come from a per-model `KIT_PARTS` table: boxes, ramps and `noStand` in the model's own units, like today's
  `PIECE_PARTS` at :376.
  - For simple solid pieces (walls, pillars, barriers, crates), derive the parts automatically from the model's bounding
    box, with an option to override.
  - Stairs are ramps, wall-walk floors are boxes, and parapets are `noStand`.
- Keep `ARENA_RADIUS` as the outer bound, but the castle walls form the real boundary.
- Keep the exports (`COLLIDERS`, `SURFACES`, `SPAWN_POINTS`, `HEAL_SPOTS`, `PROP_SPAWNS` and `LOS`) identical in shape,
  so the server, bots and physics don't change.

**`world.js`:**
- Replace the farm builder, `FARM_MODELS`, the yard, the pen, the field and the blast site with a generic layout-driven
  model loader. It should use instancing for repeated kit pieces, which keeps the draw-call count low.
- The ground becomes a stone courtyard (KayKit floor tiles, or a tiling stone texture) inside the walls, with Ty's grass
  texture outside, plus the mountain vista and sky.
- Remove the farm's procedural stand-ins and the zone tints.
- The camera blockers must still work: tag kit models `cam = 'solid'`.

**Layout (`layout.json`, a new version; back up the farm layout to `tools/layout-backups/farm.json`):**
- An **inner courtyard about 30 m across** in the centre: rune circle, fountain or obelisk, broken pillars and barrier
  cover clusters.
- A **wall-walk about 4 m up** around it.
- **Two or three stair towers** and one ramp, so there are fast ways up.
- A **gatehouse arch.**
- A Quaternius **side hall with a balcony** and roofs, for verticality and line-of-sight breaks.
- **Torches and banners** in the element colours.

Gameplay targets from round 14's pacing:
- Spawns 18–26 m from the nearest enemy; 7–8 spawns, split between the courtyard edges and the wall-walk.
- 4–5 heal spots, at least two of them up high.
- Sight lines of 20–30 m, with cover every 6–10 m.
- Every high spot reachable by jump plus double jump plus grab, or by stairs, and nothing climbable out of the arena.

**Props:** KayKit barrels, crates, kegs and chests become `PROP_TYPES` for Telekinesis and Trapped Relic. Remove the
hay, pot and rock props unless they fit.

**Remove the goats:**
- `server/goats.js`, `public/js/goats.js`, the goat model, `GOAT_*`, `PEN`, `FENCE_SEGMENTS` and `trampleCrops`.
- Coordinate with the spells agent for the hooks in server.js, main.js and bots.js.

**Editor:**
- The model list goes recursive.
- The palette is grouped by kit with search, and shows a thumbnail or name list.
- Add the kit kind with the auto box collider, a snap of the kit grid (2 m, or 1 m for half pieces) and 90°, and a y
  offset for stacking (wall-walk floors).
- Remove the farm-specific `RADIUS` table and the zone lines.
- Ty will fine-tune the layout in the editor afterwards.

**Do the blockout first** (walls, floors, stairs, spawns and colliders), post overhead and ground screenshots, then
dress it (torches, banners, props, side hall).

### Characters agent: the KayKit Mage, the Skeleton bots and the animation remap
**Bodies:**
- Import the Mage (the skinned parts merged into one character, with the hat kept) and the four Skeletons.
- Attach the KayKit `staff` to `handslot.r`. Bots get their matching weapon or staff: Skeleton_Mage gets a staff, the
  others the kit's own.
- Scale to 1.8 m to the top of the head; the hat is extra. Feet at y = 0.
- Copy the KayKit textures as webp, and use meshopt.

**A bone-name map:** a central `BONES` map in looks.js
(`hand: 'handslot.r'`, `hips: 'hips'`, `head: 'head'`, `legs: [...]`, `toes`). Replace every hard-coded Meshy name
(looks.js, wizard.js, and the hand reference in main.js through an exported getter) with it.

**Element tint:**
- Recolour the Mage's robe and hat through a material swap or atlas-region mask rather than red-pixel rehueing; the robe
  is distinct UV regions in `mage_texture.png`.
- Keep the element auras (fire ember, ice frost and so on), attached through `BONES`.
- Skeleton bots get a subtle element-coloured glow (eyes or staff) instead of a robe tint.

**Clips:**
- Load the Rig_Medium clip GLBs (General, MovementBasic, MovementAdvanced, CombatRanged, CombatMelee, plus Special for
  the skeletons) as the new clip source, merged into one compressed `clips.glb`.
- **Retire** `clip-pool.glb`, `bakeClipPool`/`retargetClip`, `MODEL_CLIPS`, `SHARED_CLIPS` and `POOL_SOURCES`. No
  retargeting is needed.
- Keep the pick DSL (`[name, from, to, dur]`, `warp`, `reverse`, `flatY`, `pinXZ`) for re-timing.

**Remap the whole vocabulary** (the full key list is in the survey):

| Game keys | KayKit clip |
|---|---|
| idle | Idle_A, or Ranged_Magic idle-ish |
| walk_fight / run / back | Walking_A / Running_A / Walking_Backwards |
| strafes | Running_Strafe_Left/Right |
| cast_fast / primaries | Ranged_Magic_Shoot, Spellcasting |
| cast_heavy / wind-ups / ult wind-ups | Spellcasting_Long, Ranged_Magic_Raise |
| summons (Stampede, Ram Guard, Battering Ram) | Ranged_Magic_Summon (cut) |
| throws (Potion, Toxic, Smoke Flask, TK throw) | Throw |
| drink (Berserker Brew) | Use_Item |
| ward / black_death / block | Melee_Blocking / Melee_Block |
| roll and its variants | Dodge_Forward/Backward/Left/Right |
| air rolls | Dodge_* with flatY |
| jump / land / land_soft | Jump_Start / Jump_Land |
| float | Jump_Idle |
| double_jump | Jump_Start, re-timed, plus a procedural forward or back flip on `model.rotation.x` (already additive) |
| hit | Hit_A/B |
| death | Death_A/B |
| knockdown / getup | Death_B, then Lie_StandUp |
| arrival / blink / mirror | Spawn_Air |
| crouch / crouch_walk | Crouching / Sneaking |
| tk_lift / tk_throw | Ranged_Magic_Raise / Throw |
| Lash | Melee_1H_Attack_Slice_Horizontal, or Ranged_Magic_Shoot |
| air_cast | Ranged_Magic_Shoot with flatY |
| Meteor Rain hover / dive / land | Jump_Idle / a procedural dive / Jump_Land |

- Release frames must match the server timings already in `SPELL_ANIMS`. Re-cut each key and keep the `release`
  numbers.
- Skeleton bots use the same keys, plus `Skeletons_Taunt` on a kill and `Skeletons_Death`/`Awaken` for death and spawn
  if the timings fit.

**Other updates:**
- **wizard.js:** the constructor's required clips, `LEG_BONES` through `BONES`, the ward bubble's size and height, the
  nameplate height, and the hover bob.
- **Builder preview:** select.js frames the Mage, idles, and plays the spell clips on hover.
- **Hand-off:** a list of any clips that still read poorly, and suggestions for which KayKit or Quaternius
  animations to add.

### Spells agent: hooks, goat removal and bots
**main.js:**
- Replace the hard-coded clip-offset fallbacks (`cast_fast` 0.25 s, `cast_heavy` 1.9 s, `dash` 2.2 s, `stun` 0.3 s
  and so on, at main.js:470-1272) with named spellanim phases from the characters agent. Agree the API in requests.md.
- The projectile origin is the staff tip: a `tip` node on the staff from the characters agent, falling back to the
  hand.
- The ledge-climb pose and the remote TK pose go through the same API.

**Goats:** remove them from server.js (goat hits, stirring, `goatHitPlayer`, the TK goat lift), bots.js (goat grab and
avoidance) and main.js, and clean up the constants, `KNOCKDOWN.kinds` and the sounds.

**Bots:**
- The snapshot and `makeWizardBody` carry a body flag so bots render as Skeletons; players stay Mages.
- Bot names fit the theme (skeleton names).

**Other fixes:**
- **Bug:** `bots.js:1079` reads `HEAL_SPOTS` as `h[1], h[2]` instead of `{x, z}`, which gives NaN and breaks Trapped
  Relic's hot-spot scoring.
- Update tests that assume farm geometry: modematch-unit's open-spot search, parking spots and walk-off ledge
  (lines 90, 125, 180-187 and 343-353) read from the new map. Delete or rewrite `goat_e2e.py`.

### Deploy agent: the build, credits and clean-up
- Update `npm run build:crazygames` for the new model folders, and check the initial download is **under 20 MB** and
  the file count.
- **README credits:** Kay Lousberg (KayKit Dungeon, Adventurers, Character Animations and Skeletons, CC0) and
  Quaternius (Medieval Village MegaKit, CC0). Remove the farm and Meshy credits that no longer apply.
- **Phase B clean-up.**

## Phase B: integration, clean-up and verification (coordinator, then the deploy agent)

**Delete obsolete repo assets** (Ty asked to remove anything unlikely to be reused), once the castle and Mage are
verified:
- the farm models (farmhouse, barn, silo, hay, hay_loft, tractor, scarecrow, well, horse_cart, embankment,
  watchtower, plank_bridge, the goat and the rest, unless reused)
- the grass tufts if they're unused inside the castle
- `wizard.glb`, `models/wizards/*` (the Meshy heroes, `clip-pool.glb` and `jeb2`)
- `tools/bake-clip-pool.py` and `tools/prepare-wizard-model.sh`
- the farm-only code paths

**Delete the raw packs** from `~/Downloads` once the needed pieces are copied into the repo: the five KayKit and
Quaternius folders, plus any zips. Show Ty the list right before deleting.

**Verify:**
- unit tests ALL PASS (with the updated map assumptions)
- botmatch on Hard (no stalls, no falls out), and `loadoutbalance` normal and hard
- the pacing targets still hold (kills per minute, respawn to first damage)
- the Playwright screenshot set: courtyard overhead, ground level from 4 sides, the wall-walk, a Mage casting each slot,
  a Skeleton bot, a double jump, a roll, the builder preview
- no console errors
- the CrazyGames build under a subpath with its initial download size
- the editor opens the new layout, and moving and saving a kit piece works

Then port 3000, then Ty plays and edits in the editor. Push to production only on Ty's go-ahead.

## Phase C: the final draft (Ty: "ready for submission to Crazy games, deployed to Render and fun")

**A fun pass on the new map:**
- Coordinator-run playtests, Playwright plus bot matches on normal and hard, against the pacing targets:
  - about 2 kills per player per minute
  - about 6 s from respawn to first damage
  - about 50% of engagements ending in a kill
  - a TTK of 3–4 s
  - no spell above about 35% of its slot's kills
- Spells-agent tuning from round 14's open flags:
  - Trapped Relic 75% of Utility kills
  - Frostfall 43.5% of Power kills
  - Ram Guard's rams one-shotting
- Replace the last six Pixabay sounds with CC0 ones, and update the README music credit.
- Ty plays it on port 3000 and gives feel notes; one quick iteration.

**Submission-ready:**
- The CrazyGames build (`npm run build:crazygames`): relative paths, `WA_SERVER` set to the Render wss URL, the guarded
  SDK basic events, an initial download under 20 MB, file count under 1500, tested under a subpath.
- The how-to-play card, the click-to-play prompt, the favicon, no console errors, and desktop-only plus landscape
  declared.
- `deploy-handoff.md` has a submission checklist (what to upload, the lobby size of 4, the description and tags, and a
  cover image and screenshots taken from the new castle).

**Deploy:**
- Push the verified commit to `main`. Render auto-deploys.
- Run the live smoke test on https://wizard-arena-76od.onrender.com.
- The CrazyGames zip in `dist/` is handed to Ty to upload. Pushing still only happens on Ty's go-ahead.

## Order
1. Finish and verify round 14 (and offer it to Ty for a push).
2. Commit this brief as `docs/agents/round15.md`.
3. `/clear` and brief the four agents.
4. Environment posts the blockout screenshots early for Ty's feedback.
5. Phase B when all agents have landed.
