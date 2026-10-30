# Map editor brief (environment agent, after round 13)

Ty wants to open the map and move assets around himself. Build an **in-game edit mode**: `localhost:3000/?edit=1`. It
shows the real map, lets him select assets and move them, and saves straight back to the game's files so they play
exactly as edited.

## 1. A layout file, the single source of truth
- Move the hand-placed positions in `public/shared/map.js` into **`public/shared/layout.json`**, with one entry per
  placed thing: `{ id, kind, model, x, y, z, rotY, scale, ...kind-specific }`.
  - It covers the buildings, trees, rocks, ruins and pillars, the cover clusters, props, heal spots, spawns, goat-pen
    and goat points, platforms, ramps, stairs and bridges.
- Keep generated scatter (rim rocks, grass, far trees, blast shards) procedural, but give its seed and parameters a
  layout entry so it can be toggled or tuned.
- `map.js` reads `layout.json` and builds `COLLIDERS`, `SURFACES`, `SPAWN_POINTS`, `HEAL_SPOTS`, `PROP_SPAWNS` and so on
  from it, with **the same exports and shapes as today**, so server.js, bots.js and main.js don't change.
  - A collider or surface belongs to its entry. It is defined relative to the asset, so it moves, rotates and scales
    with it.
- The server must load it synchronously at start (Node `import ... with { type: 'json' }` or `readFileSync`). The
  browser loads it before the world builds.
- **Must be a no-op migration.** Before and after, dump `COLLIDERS`, `SURFACES`, spawns, heal spots and props and diff
  them: they should be identical, to rounding. Run the unit tests and a botmatch.

## 2. The edit mode (client, `?edit=1`)
- **Camera:** a free fly camera (WASD, mouse look on right-drag, Shift for fast, Q and E for down and up) and a top-down
  toggle (T). No match, bots or HUD while editing; goats are frozen.
- **Selecting:** click to select (outline highlight) and Shift-click to add to the selection. A side panel shows the
  entry's fields and lets him type in values.
- **Gizmo:** three's `TransformControls` (from `/vendor/three/examples/jsm/controls/`): W move, E rotate (Y only by
  default), R scale.
  - Snap to the ground (`surfaceHeight`) on by default, and grid snap of 0.25 m and 15° available.
- **Actions:**
  - delete (Del), duplicate (Ctrl+D) and undo/redo (Ctrl+Z / Ctrl+Shift+Z)
  - an **asset palette** listing every model in `public/models` plus props, spawn, heal spot and cover. Click one,
    then click the ground to place it.
- **Overlays (toggles):** collider circles and heights, standable surfaces (green) and `noStand` (red), spawn arrows,
  heal spots, the goat pen and paths, the arena rim, and the blast scorch radius. Show farm, blast and magic zone tint
  lines so Ty can keep the story layout.
- **Checks (warnings, not blockers):**
  - a collider overlapping a spawn, heal spot or prop
  - spawns closer than 15 m, or able to see each other
  - anything outside the rim
  - a goat point inside a collider
  - a platform with no way up (out of jump-plus-double-jump-plus-grab reach)
- **Save (Ctrl+S, plus a button):** sends the layout to the server, which writes `layout.json` with stable pretty
  formatting so git diffs stay readable, and keeps a timestamped backup in `tools/layout-backups/` (gitignored).
  - Show "Saved". Hot-reload the arena for anyone connected, or reload the page.
- Also provide **Export / Import JSON** buttons, for working without the save endpoint.

## 3. The save endpoint, local only
- Put it in a new `server/mapedit.js` (environment-owned), mounted from server.js with a one-line hook. Ask the spells
  agent in requests.md, or add the line yourself, since it's a single isolated line, and tell them.
- **Enabled only when `MAP_EDIT=1`**, and it refuses requests not from localhost. Render never sets it, so the public
  site can't be written to.
- `npm run edit` starts the server with `MAP_EDIT=1` (a package.json script).
- Validate the payload against the schema before writing: known kinds, finite numbers, and ids unique.

## 4. Docs and handover
- README: a short "Editing the map" section: `npm run edit`, open `localhost:3000/?edit=1`, the controls, Save, and
  that saved layouts need a commit and push to reach the live site.
- Add to `shared-rules.md`: `layout.json` is the map's data, and Ty may edit it through the editor. Agents must pull
  his changes and not overwrite them; if Ty has unsaved or uncommitted layout edits, ask the coordinator before
  touching the layout.
- Verify:
  - the no-op migration diff
  - the unit tests pass
  - a botmatch with no new stalls
  - Playwright: open `?edit=1`, select the barn, move it 3 m, save, reload, and see it moved with its collider (then
    revert)
  - screenshots of the editor with the overlays
  - no console errors
  - a POST from a non-localhost origin, or without `MAP_EDIT`, is refused
- Commit in small steps: the migration first, then the editor, the endpoint, and the docs. Write the hand-off.
