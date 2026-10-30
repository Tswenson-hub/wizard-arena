# Round 12 brief: utility split, the Cinder clips, a Roll spell, and a farm-to-magic map

## Context
Ty played the live round-11 build (https://wizard-arena-76od.onrender.com) and asked for five changes.

**1. Trapped Relic becomes a pure trap spell.**
- Today it is "Telekinesis plus a curse". Worse, lifting and throwing aren't gated at all: the server's
  `pickup`/`throw` cases never check the utility, so every wizard can lift.
- Ty's answer: "If you have on trapped relic you can only set traps, if you have on the telekinesis power you are good
  to grab and throw."

**2. Remove the low-poly pumpkins** (procedural spheres) **and any other assets that look unfinished.** Ty also chose
to remove the box-built canopy tree fort.

**3. Meteor Rain uses Cinder's new `Dive_Down_and_Land` clip.**
- Source: `~/Desktop/Meshy_AI_cinder_pyromancer_rig_All_Animations (2).glb`, 18 clips.
- It has the same 66-joint rig and the same 14 clips as the repo's `cinder.glb`, plus four new ones:
  `Dive_Down_and_Land` (1.6 s), `Roll_Dodge` (1.83 s), `Roll_Dodge_2` (2.0 s) and `Roll_Dodge_4` (3.13 s).

**4. Add Roll as a new Mobility (E) spell card** (Ty's choice).

**5. Make the map read as one story.**
- Half of it is a farm. A magical explosion happened at the altar, and the rest is the magic area.
- Use the assets evenly, and give each area a logical sense.

**Where the map stands now:**
- North of z ≈ 0 is already mostly farm. The blast centre is the altar at (0, −7), with a scorch radius of 15.
- Some farm items have drifted into the south:
  - the felled silo with its crates and barrels, in the SW
  - hay stacks and bales in the SE meadow, around z −27
  - the box-built canopy fort in the SE
- The magic side has few real models: 4 rune pillars, 1 archway, 1 obelisk and 2 ruin platforms. The altar and the
  fallen pillar are procedural, and `rock_jagged` appears about 135 times while ten models appear once each.
- Bug: the ruin-ledge parapets are invisible but still block spells. `swapModel('piece:ledge-x')` (world.js:1015)
  clears their meshes when ruin_platform.glb loads.

The work runs on the usual Herdr agents, which own files per `docs/agents/shared-rules.md`. The brief is
`docs/agents/round12.md`.

## 1. Utility split (spells agent: server.js, server/bots.js, main.js, constants.js, effects.js)

**Telekinesis**
- It is the only spell that can lift and throw.
- Gate `case 'pickup'`/`'throw'` (server.js:2008-2062) and the client's F lift path (main.js:1827-1854, the hover marker
  at :2196) on `kit(p).utility === 'telekinesis'`. Goats work the same way (`Goats.liftGoat`).
- Nothing else about Telekinesis changes.

**Trapped Relic: traps only, no lifting**
- The spell entry stays at constants.js:531-541. Its blurb changes to: "Curse an object. It explodes when an enemy comes
  near, lifts it or breaks it."
- F behaviour: tapping or holding F (0.5 s, as now) on a prop curses it, using the `case 'curse'` path at
  server.js:1957. There is no lift fallback.
- Allow **2 armed traps per caster** instead of 1; arming a third clears the oldest (`clearCurse`, server.js:813).
  The cooldown is the existing `liftCooldown`, about 3 s, applied on each curse.
- **New triggers:**
  - an enemy of the curser comes within **1.8 m** of a cursed prop that is resting. Checked in the server tick, at
    most once per tick per prop, with a 0.25 s fuse and a visible flare so a sharp duelist can back off.
  - an enemy with Telekinesis lifts it (the existing path at :2020 and :1564).
  - an enemy's spell breaks it (`breakProp` at :498 fires `relicBlast` instead of only clearing the curse). If the
    curser breaks their own trapped prop, it is just disarmed.
- `relicBlast` (:819) uses the prop's position when nobody is holding it, instead of `holdPoint(victim)`. It keeps
  the current damage, 3.5 m radius, ward block and credit to the curser.
- Enemies see a faint glyph only within about 6 m, so traps aren't invisible (`effects.curseGlyph`). Today only the
  caster sees the curse message.

**Bots (bots.js)**
- They lift and throw only if they have Telekinesis (the `pickProp` and goat-grab blocks at :519-539).
- Trapped Relic bots curse props along likely paths: near cover, spawns and heal spots, reusing `curseCandidate` at
  :1048.
- All bots avoid stepping within about 2 m of a prop that is visibly cursed, which reuses the `relicMemory` and
  `burned` maps.

**Tests**
- modematch-unit: a Trapped Relic player can't lift (pickup is ignored), but can curse.
- An enemy walking into a cursed prop takes the blast. The curser walking past it doesn't.
- Breaking a cursed prop blasts the enemies nearby.
- loadoutbalance.mjs:23 credits `relic` kills to `trapped_relic`.

## 2. Roll mobility spell (spells agent for data, server and bots; characters agent for the animation)

**New `SPELLBOOK.roll` in the mobility slot**
- Short and fast: about **4.5 m in 0.35 s** in the movement-input direction, or backwards if there is no input.
- **0.25 s of dodge immunity:** projectiles pass through, but area damage still applies.
- **Cooldown 3.5 s**, two charges. It doesn't root, and it doesn't break crouch or sprint afterwards.
- The server reuses the existing dash-motion helper that Blink, Skim and Mirror Step use, with collision and
  `STEP_UP` respected.
- It goes in `SPELL_POOL` and `spellInfo` with the tags Mobility and Dodge, and the icon comes from the existing
  Raven set.
- Bots use it reactively in their existing dodge code, when a projectile is about to hit (bots.js:1360).

**Animation (characters agent)**
- Re-import Cinder from the (2) GLB:
  `tools/prepare-wizard-model.sh "~/Desktop/Meshy_AI_cinder_pyromancer_rig_All_Animations (2).glb" cinder`.
- Re-bake the clip pool (`tools/bake-clip-pool.py`; `POOL_SOURCES` is at looks.js:336) so it gains `cinder.Dive_Down_and_Land`
  and `cinder.Roll_Dodge*`.
- spellanim.js gets `roll`. Use whichever Roll_Dodge variant reads best at 0.35–0.5 s, time-warped. The hand-off notes
  why that variant won.

## 3. Meteor Rain animation (characters agent: spellanim.js:251-256)
- `meteor_rain` keys `cinder.Dive_Down_and_Land`: the crouch and leap during the 1.3 s wind-up, then the dive and land
  on release, timed so the landing frame matches the first meteor impact.
- Keep the `float` loop only if there is a hover window in between.
- Update the `need:` note, and verify the timing from screenshots taken at the wind-up, release and land frames.

## 4. Map: farm north, magic south, with the blast in between (environment agent: map.js, world.js, goats.js)

**Story layout**
- **North half (z > +5), the farm:** farmhouse, barn, hay loft and leaning silo, well, cart, tractor, scarecrow, the
  goat pen (move it to the north-east), hay, crates and barrels, embankment cart road, pines and oaks.
- **Blast band (about z +5 to −20), the explosion:**
  - Centred on the altar at (0, −7), with the scorch, blast stones, table slabs and shards.
  - Farm debris thrown outward at the farm edge: the **felled silo moves here from the SW**, plus a scattering of
    broken crates and fence pieces.
  - The ground cracks glow faintly.
- **South half (z < −15), the magic land:**
  - The rune pillars, archway, obelisk, ruin ledges and ruin steps, and the watchtower re-dressed as a mage lookout,
    or moved to the farm edge, whichever reads better.
  - Birches only, with purple-tinted grass, crystals and vases (they're magic vessels).
  - No hay, crates or barrels.

**Removals**
- **The low-poly pumpkins:** PROP_TYPES entry map.js:23, spawns map.js:276-277, mesh world.js:1076-1082, the comments,
  and the server's generic spawn picking them up.
- **The canopy fort:** surfaces map.js:623-646, drawing world.js:377-415, and its heal spot. Move that heal spot to a
  clean high point in the SE magic area, such as the low plateau or the ruin steps.
- **Other procedural stand-ins that look unfinished:**
  - the box crate stack in cover cluster c5 (world.js:447)
  - the fallen pillar made of cylinders, replaced by `rune_pillar.glb` lying on its side (world.js:324-360)
  - the silo footing box ring
  - the dead `C.ROOFS` loop
- **Keep and polish:**
  - the goat pen (box pickets are fine for a fence, but tidy them)
  - the altar, which is the centrepiece: tighten the crystals and reuse the rune materials
  - the crate and barrel props, which are throwables and fine as simple shapes. Use them only on the farm side.

**Even asset use**
- Cut `rock_jagged` from about 135 to roughly 60, mostly the rim and blast pieces.
- Duplicate the one-off models where it makes sense:
  - a second hay loft or cart is unnecessary; instead, add a second archway and obelisk in the magic half
  - more rune pillars as cover
  - `wooden_stairs.glb`, unused today, to reach a plateau
- Each cover cluster uses its area's assets: hay and crates in the north, pillars and ruin pieces in the south.

**Fixes and checks**
- Fix the invisible ledge parapets: give them a piece tag of their own so `swapModel` doesn't clear them.
- Re-check the 7 FFA spawns: they should split roughly 4 farm and 3 magic, with fair sight lines of 20–30 m.
- Re-check the heal spots, goat paths, bot routes, and that no collider is left without a mesh.

## Who and order
| Agent | Work |
|---|---|
| Spells | §1 and §2 server, data and bots |
| Characters | the Cinder re-import, clip pool, Roll and Meteor Rain animations (§2 and §3) |
| Environment | §4 |

These can run in parallel:
- the spells agent adds `roll` to the SPELLBOOK first and notes the API in `requests.md` for the characters agent
- the environment agent posts any changes to prop types or ids in `requests.md`, because the server spawns props

The coordinator then verifies on a private port, updates port 3000 from `~/wizard-arena-play`, and asks Ty before
pushing to Render.

## Verification
- **Unit tests:** `MATCH_DEBUG=1 node tools/test/modematch-unit.mjs` prints ALL PASS, including the new utility and trap
  tests.
- **Headless Playwright** on a private port with the GPU flags:
  - With Trapped Relic, F on a crate curses it and can't lift it. A bot walking into the crate triggers the blast, and
    the kill feed credits the curser.
  - With Telekinesis, lifting and throwing still work, for goats too.
  - Roll moves about 4.5 m, a Spark passes through during the immunity window, and the cooldown shows on E.
  - Screenshots of Meteor Rain at its wind-up, release and land frames show the dive.
- **Map screenshots:** an overhead view plus one from each half. No pumpkins and no fort; farm assets only in the
  north, magic assets only in the south, and the blast band reads as the transition.
- **Balance:** `loadoutbalance.mjs <port> 12 75 hard` reports kill share for Roll and Trapped Relic, and confirms
  neither dominates.
- **Port 3000:** updated and checked once with no console errors before telling Ty it's ready.
