# Round 14 brief: pacing pass and getting ready for CrazyGames

Ty: "It does not feel as fast paced and fun as I wanted. I want moves to be meaningful but not hardcore." He approved
every change below.

**What the data showed** (`/tmp/wa-pace/`, `/tmp/wa-audit/`):
- Kills themselves take 2–3 s. The drag is around them:
  - 11 s from respawn to first damage, with spawns 37 m from the nearest enemy
  - 55% of a life spent out of combat
  - about 60% of fights resetting into full regen
- About 1 kill per player per minute, so most matches hit the 8-minute cap.
- At 25 m every projectile can be sidestepped at a walk, and the primaries differ in time-to-kill by about 3×.

**A map change may be coming** (the coordinator is researching a castle or wizard map to buy). Until it's decided,
environment work in this round avoids cosmetic map dressing. The camera fix and model compression stay useful either
way.

## Spells agent: pacing and in-game fixes
Files: constants.js, server.js, server/match.js, server/bots.js, main.js, audio.js and effects.js. The aim is a TTK of
about 3–4 s under focused fire, and fights that rarely reset.

**Pacing:**
1. **Regen:** the delay goes from 5 s to **7 s**, and the rate from 8 to **6 HP/s**.
2. **Respawn and spawn protection:**
   - Respawn goes from 3 s to **2 s**, with **1.5 s of spawn protection**: no damage taken, and the protection ends
     early if you cast.
   - Spawn choice becomes "farthest from enemies among the spawns 20–30 m from the nearest enemy", falling back to the
     2nd-farthest. The target is about 20–28 m from the nearest enemy, down from 37.
3. **Projectile speeds:**

   | Spell | From | To |
   |---|---|---|
   | Fireball | 24 | 30 |
   | Hex | 22 | 28 |
   | Potion | 20 | 24 |
   | Meteor | 19 | 26 |

   Meteor's cooldown goes from 1.2 s to **4 s**.
4. **Evening out the primaries,** aiming for a TTK of about 3–4 s with every hit landing:
   - Spark: base 9 → 12 (keep watching its share; it dominated before)
   - Hex: 11 → 14
   - Sling: 7 → 10
   - Fireball: 18/26 → 16/24
   - Every reload: 1.5 → **1.2 s**
   - Glacial Skim shards: 11 → 9
5. **Ultimates:** the passive charge goes from 0.5 to **1.0%/s**, and the kill bonus from 5 to **10%**, for an
   ultimate about every 40 s.
6. **Outliers:**

   | Spell | Change |
   |---|---|
   | Battering Ram | no longer a one-shot: **70 damage plus a knockdown**, cooldown stays 12 s |
   | Trapped Relic | cooldown 3 → **6 s** |
   | Sanguine Lash | cooldown 13 → 9 |
   | Frostfall | cooldown 14 → 10 |
   | Glacial Bulwark | wall HP 120 → 80 |
   | Tempest Veil | cooldown 10 → 7 |
   | Black Death | modest buff (your call, e.g. a longer hold or a cheaper stamina cost) |

7. **Match:** first to **15 kills**, with a **7-minute** cap.

All values are in constants.js; update the builder card stats if they're derived. Bots should adapt (spawn
protection, the new ram).

**Fixes from the audit:**
- **The damage number on death** shows "-3616" for a 108-damage hit (`death_0.png`). Fix the floating number's source.
- **Pointer lock:** if it isn't locked, or the lock is refused (as in the CrazyGames iframe), show a clear "Click to
  play" overlay, and also show it whenever the lock is lost mid-game.
- **The pause menu** gets a "Leave match" / "Back to builder" button and a compact controls reference. Fix the clipped
  bottom row and voice buttons.
- **Placeholder visuals:**
  - The Telekinesis target marker is a raw white wireframe ball (main.js around :1710). Make it a soft glowing ring or
    outline around the target.
  - The Ward bubble's wireframe lives in wizard.js:150, which belongs to characters; ask them in requests.md.
- **Nameplates:** remove the "· hard" / "· normal" difficulty suffix from bots' plates, and cap a plate's on-screen
  size when it's very close to the camera.
- **Clean-up:** remove the `window.__wa` debug global (unless the tests need it, in which case put it behind a debug
  flag) and the console.log in net.js.
- **Audio licensing:** the menu music and goat bleats are Pixabay tracks, whose license may forbid shipping them as
  files. Replace them with CC0 alternatives (OpenGameArt, Kenney or Freesound CC0) and update `sounds/CREDITS.md`.

**Verify:**
- modematch-unit prints ALL PASS.
- Run `loadoutbalance.mjs <port> 12 75 normal` and `hard`, and report kills per minute, the time from respawn to first
  damage, the share of engagements ending in a kill, and the median TTK. Use `/tmp/wa-pace/observe.mjs` and
  `analyze.mjs` from the pacing analysis.
- **Targets:** at least about 2 kills per player per minute on normal, about 6 s from respawn to first damage, about 50%
  of engagements ending in a kill, and no single spell above about 35% of its slot's kills.

## Characters agent: the first-run experience and the builder
Files: select.js, select.css, looks.js, wizard.js and spellanim.js.
- **How to play:** a short card on first visit (dismissible, remembered in localStorage, and re-openable from "?") that
  shows:
  - the controls (WASD, Space ×2, Shift, C, LMB, RMB, R, E, F, Q, T reload, M mute, Esc)
  - the goal (first to 15 kills)
  - "Build your wizard: one spell per slot"
- **A legend** for the stat symbols (×, ◇, ↔, ⌛) on the builder, and readable tooltips.
- **No clipped text** at 1280×720: card descriptions mustn't end in "…" (use tooltips or a 2-line clamp with a sensible
  card size), and Berserker Brew's tags must fit. Check 1920×1080 and 1366×768 too.
- **Small screens:** under about 900 px wide, show "Best played on a desktop with a keyboard and mouse" instead of a
  broken grid. The game is desktop-only.
- **Ward bubble** (wizard.js:150): replace the wireframe with a proper shader-like bubble (fresnel rim, soft fill), and
  the same for any other wireframe you own.
- Read and verify the spells agent's new numbers on the cards once they land.

## Environment agent: the camera and model size
Files: world.js, map.js, layout.json and the models.
- **Camera clipping (the worst audit item):** the third-person camera goes inside Meshy models (trees, hay and the barn
  area near (19.8, 21.2)): `game_view3.png`, `game_cast.png`. Provide camera-blocking geometry from world.js, for
  example `world.cameraBlockers`, a list of simplified meshes or boxes for every large model including tree canopies.
  - Coordinate with the spells agent in requests.md to make the camera raycast against it and pull in, and fade or hide
    foliage between the camera and the wizard.
  - You may make that small change in main.js's camera function yourself if spells agrees in requests.md.
- **Download size:** compress the models with meshopt (gltf-transform `meshopt`, and three's MeshoptDecoder from
  `/vendor/three/examples/jsm/libs/meshopt_decoder.module.js` wired into the GLTFLoaders). Start with farmhouse
  (5.5 MB), silo (4.1 MB) and barn (2.6 MB), then everything else.
  - The target is an initial download under **20 MB** (it's 29 MB now). Measure it with Playwright as the total
    transferred bytes before "Fight!".
- Hold the cosmetic items (crystals, the well ring) until the map decision.

## Deploy agent: the CrazyGames build
Files: deploy/, tools/, the build scripts and package.json scripts. Coordinate in requests.md if a client file needs
an edit.
- **Relative paths:** CrazyGames hosts the client files and requires relative paths only. Make every URL relative:
  the importmap (`/vendor/three` becomes `./vendor/three/`), models, textures, sounds, CSS and JSON (`layout.json`).
  Each owner may need a small edit, so post a precise list in requests.md, or do the mechanical replacement with each
  owner's OK.
  - Vendor three into the build (copy the used files), since there's no node_modules on CrazyGames.
- **The server URL:** the client connects to the page's own host now. Add a config (for example
  `window.WA_SERVER` or a `config.js`) that defaults to the same origin but is set to
  `wss://wizard-arena-76od.onrender.com` in the CrazyGames build.
  - Check the server accepts WebSocket origins from CrazyGames domains, and add CORS for any HTTP fetches.
- **SDK:** add the CrazyGames SDK v3 for the Basic Launch: init, `gameplayStart` when the match is entered, and
  `gameplayStop` on pause or menu. It must be guarded so the game still works without the SDK (our own site).
- **`npm run build:crazygames`:** writes `dist/crazygames/` and a zip, with relative paths, vendored three, the
  config pointing at Render, and no editor files. Check the file count is under 1500 and the size limits.
  - Test it by serving `dist/crazygames/` from a different port under a subpath (for example
    `http://localhost:4199/game/`) and playing a match against Render or a local server.
- **Favicon:** add a small wizard-hat or staff icon (favicon.ico plus a PNG, with a link in index.html, via
  requests.md).
- **Hide the map editor on live:** `/?edit=1` and `edit.html` return 404 unless `MAP_EDIT=1`. That's in
  `server/mapedit.js`, which belongs to environment; coordinate in requests.md.
- Update deploy-handoff.md with a CrazyGames submission checklist: what to upload, lobby size 4, desktop-only,
  landscape, and the T&C/privacy note.

## Order and verification
- All four agents work in parallel. Spells and characters share the card numbers; spells and environment share the
  camera.
- When they're all done, the coordinator verifies:
  - unit tests and bot balance
  - Playwright screenshots of the camera near the barn and trees, the death number, the click-to-play overlay, the
    how-to-play card and the builder at 3 sizes
  - the CrazyGames build played under a subpath on another port
  - the initial download size

  Then Ty plays it on port 3000. **Production only on Ty's go-ahead.**
