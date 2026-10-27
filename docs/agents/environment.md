# Brief: environment agent ("farmstead")

Read `docs/agents/shared-rules.md` first. You own the map: layout, scenery, models, goats.

## Goal
Ty loves the game and wants the arena to become a **wizard's farmstead** built around the Meshy
farmhouse. Today the house is backdrop on the hill outside the arena (`loadModels()` in
`public/js/world.js`, position (9, 48)), goats wander anywhere, and the arena is a circle of stone
pillars. Make it a place with an organised layout:

| Area | What |
|---|---|
| Farmhouse | Move it **inside** the arena, north side, about (0, 24), front door facing the middle. Scale it down to about 11 m tall so it reads as a building, not a cliff. Give it a footprint of a few large colliders in `COLLIDERS` (`h` about 9) so it is real cover and spells hit it. Check the sun's shadow camera still covers it (`buildWorld()`). |
| Courtyard | The open dueling space in front of the house. Replace most stone pillars with farm cover (well, hay bales, cart) but keep 3–4 rune pillars with their floating crystals for the magic theme. Keep sight lines long enough for spell duels. |
| Goat pen | West side, fenced, with a gate. **All the goats live in the pen.** Wander destinations stay inside it. When a goat is angered it **leaps the fence** (a hop arc: visual in `public/js/goats.js`, the server just ignores fence colliders while charging) and charges as now. Afterwards it trots back to the pen through the gate. Players should be able to anger penned goats from range (spells and thrown props reach in over the low fence). |
| Crop field | East side: tidy crop rows. Crops are low colliders (`h` about 0.9): they block walking and hide your feet, but spells fly over. Optional polish: crops near an explosion flatten, then regrow (visual only). |
| Tractor | Parked between the field and the courtyard: a big static collider that blocks spells (hard cover). |
| Spawns and props | Move `SPAWN_POINTS` so nobody spawns in the pen, the field or inside the house. Redistribute `PROP_SPAWNS` to suit the layout (barrels and crates by the house, pumpkins at the field edge, potion barrels near the house). |

The arena radius can grow from 34 to about 40 m (`ARENA_RADIUS` in `map.js`) if the layout needs
room. Keep the rim stones and rolling hills outside.

Fences: a chain of post colliders (r about 0.25, spacing ≤ 0.7 m so a 0.45 m wizard can't slip
through, `h` about 1.1) so players and bots walk around but sparks (flying at about 1.3 m) pass over.

## Assets
Ty is generating Meshy models and will drop them on `~/Desktop` (names start `Meshy_AI_`). Expected,
in priority order: tractor, fence section, fence gate, round hay bale, crop plants, scarecrow in a
wizard hat, stone well, water trough, goat shelter / lean-to, hand cart or wheelbarrow.
- **Don't wait for them.** Build the layout first with procedural low-poly stand-ins in `world.js`
  (the style already used for pillars and trees), so it is playable straight away.
- Check `ls ~/Desktop/Meshy_AI_*` now and then. When one arrives, shrink it with the pattern in
  `tools/optimize-models.sh` (gltf-transform weld → simplify → resize 1024 → webp → quantize; aim for
  under 1 MB and about 10k triangles for props). Then load it in `loadModels()` and swap it for the stand-in.
  Meshy models face +z, are centred on the origin and are about one unit tall; render each once to check.
- Fences and crops repeat many times: use `THREE.InstancedMesh` (or merged geometry) for them.
- New throwable props (a hay bale is a good one) are a new entry in `PROP_TYPES` plus a `makePropMesh` case.

## Interfaces with gameplay (don't break these)
- The gameplay agent is adding **Skyward Flash**: wizards fly up to about 7 m and float down. In
  `server/goats.js` `ram()`, only ram wizards whose feet are low (`p.p[1] < 1.0`). Charging goats
  pass under airborne wizards.
- Gameplay is adding **Arcane Cyclone**, an area spell that calls `angerGoat()` from
  `server/goats.js` for goats in range. Keep that export and its signature `(goat, ownerId, ctx)`.
- `server.js` (gameplay-owned) creates the goats with `createGoats()`, calls
  `updateGoats(goats, dt, goatCtx)`, uses `goatPublic` in snapshots, and collides projectiles with
  goats using `C.GOAT.radius`/`hitY`. Keep those exports. If you need more from `goatCtx`, ask in
  `requests.md`.
- `server/bots.js` (gameplay-owned) reads `world.goats` (`x, z, yaw, state, target, id`) and
  `COLLIDERS`. If bots get stuck on your fences, file a request rather than editing bots.js.

## Verify
- botmatch on port 4102: bots still fight (kills happen within 90 s), goats only leave the pen when
  angered, and nobody gets stuck. Add temporary logging as needed, then remove it.
- Playwright screenshots: overview from the courtyard toward the house, the pen with all 4 goats in
  it, the field, the tractor, and a goat leaping the fence after being sparked. Look at each one.
- The client loads with no console errors and models stay small (`du -sh public/models`).
