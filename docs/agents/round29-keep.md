# Round 29 brief: one new map from the Kenney Castle Kit, plus a drag-and-drop editor

## Context
Ty wants to **replace both maps** (the Courtyard and Sky Ruins) with **one new, fun map** built from the **Kenney
Castle Kit 2.0** (`~/Desktop/kenney_castle-kit.zip`, CC0, about 76 GLB pieces). The kit has:
- walls of every kind, towers (square and hexagon, many tops), gates, a drawbridge, stairs, bridges
- ground and hills tiles, trees, rocks
- flags and banners
- siege engines: catapult, trebuchet, ballista, ram, tower, plus their demolished versions
- a shared colormap texture with seven colour variations

**Ty's other instructions:**
- Abandon the old map assets and designs, and delete them for space.
- Keep all the throwing-items functionality (Arcane Grasp).
- Give him a **drag-and-drop** way to edit the map himself, to finish the final draft.

**The live CrazyGames builds** (legacy, v22, v24) render their own bundled maps, but our **server** still simulates
those rooms from its copies of the old layout JSON. Keep those **small layout files server-side only**, frozen (legacy,
v22 and v24 rooms keep working), and delete the old **model and texture assets** from `public/`. Old clients load
their models from their CrazyGames zip, not from Render. The current generation (round 29) gets the new map only, and
rotation is off.

## 1. The new map: "Siege Keep" (environment agent)
**Concept:** a **castle under siege**, on grassy ground.
- **Centre:** a compact keep (square and hexagon towers, walls with walkable tops, a gatehouse with the **drawbridge**
  over a moat or ditch on one side, and a portcullis gate).
- **Outside the walls:** a **siege camp** on the other sides: catapults, trebuchets, ballistas and a siege tower to
  climb, broken siege engines as cover, rocks, trees and hills.
- **Routes:**
  - the drawbridge, kept as round 24's moving-surface mechanic, re-placed and with the kit's drawbridge model
  - a breach in the wall (broken wall pieces)
  - stairs up to the wall-walk
  - the siege tower as a climbable route onto the walls
  - jump pads launching onto the towers
- **Size:** about **50–60 m**, sized for 4 players: tighter than Sky Ruins, roomier than the old courtyard. Cover every
  5–7 m. **Three heights:** the ground, the wall-walks, and two tower tops.
- **Gameplay points:**
  - 8 spawns
  - 4 heal flasks
  - 4 runes (the keep's courtyard, a tower top, the siege camp, by the breach)
  - **18–20 throwable props**: Kenney-style crates and barrels, or the existing prop types re-skinned to fit, spread
    across all areas
- **No void.** It's grounded; the ditch or moat is shallow, not lethal. Remove the void rule from this map.
- **Look:**
  - pick one kit colour variation (warm stone and red roofs)
  - flags and banners in element colours
  - torches and braziers from the existing systems
  - the existing grass ground texture outside, with the painted sky and mountains kept
- **Pieces:** import only the used GLBs with meshopt, scaled to our 1.8 m wizards.
  - **Collisions:** auto boxes for walls, towers and siege engines, with hand-tuned parts for stairs, ramps and the
    wall-walks.
  - **Perf:** keep the round-20 budget (under 120k triangles, about 60 programs; one shared colormap material).

## 2. Remove the old maps (environment and deploy agents)
- **Rotation off:** `MAP_ORDER` is `['keep']` for current rooms. Keep the map registry, so adding maps later stays easy.
- **Delete from `public/`:**
  - `models/castle` (KayKit dungeon) and `models/village` (Quaternius)
  - the LOD atlases and the impostor trees, if unused
  - the old layout files from the client build
  - the old drawbridge and island rock code, if fully unused by the new map
- **Delete the raw packs** in `~/Downloads` that are no longer needed: KayKit Dungeon and Medieval Village. Keep the
  KayKit Adventurers, Animations and Skeletons packs, since they're still used for characters.
- **Keep server-side** (`server/legacy-maps/`, or the existing `MAPS.legacy`): the frozen layout JSON for the legacy,
  v22 and v24 rooms. Data only, no models.
- Check the CrazyGames build has no dangling references, and that the download size drops.

## 3. The drag-and-drop editor (environment agent: editor.js, server/mapedit.js)
The editor exists already (`npm run edit`, then `?edit=1`: a fly camera, select, a gizmo, a palette, undo, save to the
layout). Upgrade it for Ty:
- **Drag from the palette onto the map:** grab a piece's **thumbnail** from a palette grid grouped by kit category
  (walls, towers, siege, nature, props, gameplay points), drag it over the scene, see a ghost preview snapped to the
  ground and grid, and drop to place it.
- **Drag pieces directly:** click and drag a placed piece across the ground, without the gizmo, with snapping. **Q/E
  or the scroll wheel** rotates by 90° (Shift for 15°). **Alt-drag** duplicates. **Delete** removes. Height with
  PgUp/PgDn.
- **Thumbnails:** auto-render each kit piece once (or use the kit's `Previews/*.png`) for the palette.
- **Gameplay points as draggable icons:** spawns, flasks, runes, pads (with their arc shown), props and the
  drawbridge.
- **Live checks, kept:** reachability, spawn spacing, and props near edges.
- **"Test play":** a button that saves and opens a match on that layout in a new tab.
- **Save** writes the layout file, with backups as now. A short README section explains it.
- Only on `npm run edit` and localhost, as now; never on the live site.

## 4. Spells, characters and deploy
- **Spells:**
  - the bots' route graph for the new map (walls, stairs, siege tower, drawbridge, pads)
  - the drawbridge moved onto the new map's data
  - props, runes and heal flasks on the new layout
  - the void disabled
  - tests updated: map ids, rotation off, generations intact
- **Characters:**
  - the camera inside towers and on the walls
  - store art and the cover re-staged on the new map later (optional)
- **Deploy:**
  - perf_test on the new map
  - smoke and subpath
  - the legacy, v22 and v24 checks
  - the store description ("one castle-siege arena")
  - rebuild `dist/crazygames`

## Verification
- Unit tests ALL PASS (generations intact; old rooms on their frozen layouts).
- Playwright:
  - a fresh visit lands on Siege Keep
  - lifting and throwing props works
  - runes, pads and the drawbridge work
  - bots path everywhere with no stalls
  - no console errors
- `perf_test` on the keep passes.
- The editor: drag a wall from the palette, drag-move it, rotate, save, reload, and it's still there.
- Screenshots (overhead, the gatehouse, the siege camp, the wall-walk, the editor), and the size before and after.
- Then Ty edits the final draft in `npm run edit`, then the push, the rebuild and a CrazyGames upload.
