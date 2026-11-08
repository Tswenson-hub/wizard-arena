# Round 20 brief: performance ("The game seems very laggy")

CrazyGames rejected the Basic Launch build on 2026-11-05: **"The game seems very laggy. Please optimize this before we
release it in BL."** Their reviewers are in Europe (Belgium) on ordinary office laptops. CrazyGames also requires games
to run smoothly on 4 GB Chromebooks. "Laggy" can mean low or stuttering frame rate, or network delay, so we fix both.

## What the coordinator measured (local server, headless Chrome)
| Setup | FPS | Frame time p50 / p95 / max | Draw calls | Triangles | Shader programs |
|---|---|---|---|---|---|
| Apple GPU, 1280×720, DPR 1 | 59 | 16.7 / 17.6 / **159 ms** | 103 | **383k** | **193** |
| Apple GPU, 1920×1080, DPR 2 | 52 | 16.8 / 22.9 / **235 ms** | 150 | **384k** | 172 |
| Software GL (worst case) | 0.5 | n/a | 165 | 398k | 98 |

- **Triangles are about 3–4 times too many** for integrated GPUs. Aim for under 120k in a typical view.
- **There are about 190 shader programs.** Compiling them mid-match causes 150–250 ms hitches the first time each effect,
  material or body appears.
- **The Render server is in Oregon,** so a player in Belgium has roughly 150–180 ms round trip. Movement is predicted by
  the client, but enemy positions and hits wait on snapshots.

## Targets (verified by the new perf harness)
- **Integrated-GPU class** (simulate with Chrome's CPU throttle at 4× and the 'low' auto-quality tier): a steady 50+ fps
  at 1280×720. p95 frame time under 25 ms, no frame over 100 ms after the first 10 s of a match.
- **Typical view:** under 120k triangles and under 120 draw calls on normal quality; under 60k on low.
- **Shader programs:** under 60. All compiled during the loading screen, none mid-match.
- **Simulated 200 ms round trip:** remote wizards move smoothly with no rubber-banding; your own movement and casting feel
  instant; hits register as before.

## Work
**Environment agent** (world.js, map.js, layout.json, models):
- Find the triangle budget per source: trees outside the walls, castle kit, Quaternius hall, grass, props, mountains.
  Cut the far trees to impostors or billboards (or far fewer, simplified), lower the castle kit's LOD, and simplify the
  village pieces.
- **Shadows:** a smaller shadow map (1024 on normal, off on low), a tighter shadow camera around the player, and only
  big pieces and wizards cast shadows.
- Merge and instance whatever is still separate. Share materials so the world uses only a handful of programs.
- Report triangles, draw calls and programs per category, before and after.

**Characters agent** (looks.js, wizard.js, podium.js):
- The character models' triangle counts (Mage and Skeletons): simplify if they're over about 8k each.
- **Element tint and aura shaders:** use one shared material per body type, with the tint as a uniform or vertex colour.
  Never one program per loadout.
- Auras: cheaper on normal, off on low.
- The podium preloads its scene without new shader variants.

**Spells agent** (main.js, effects.js, server):
- **Effects:**
  - pool all effect meshes and materials, so nothing is created per cast or per hit
  - remove per-prop material copies in the camera fade; use a shared dithered fade material instead
  - cap particle counts
- **Shader warm-up:** after load, `renderer.compile()` the scene plus one instance of every effect, body and prop
  variant behind the loading screen.
- **Automatic quality:**
  - Tiers **high / normal / low**: device pixel ratio cap 2 / 1.5 / 1, shadows on / on-small / off, antialias,
    particles, grass, auras.
  - Start on normal, and drop a tier if the average frame time over 3 s exceeds 22 ms (also after 30 s). Rise
    carefully.
  - A Graphics setting (Auto / High / Normal / Low) in the Esc menu, saved with the other settings.
  - `?low` still forces low.
- **Network smoothing:**
  - Interpolate remote players 100–150 ms behind, adapting to measured jitter.
  - Extrapolate briefly when a snapshot is late.
  - Show local cast effects immediately (already the case for most; check them all).
  - Keep the authoritative hits.
  - Measure the round trip with a ping message and show it in the Tab scoreboard.
- **Server:** profile the tick with 4 rooms × 4 players. The tick must stay under 4 ms at 60 Hz on Render Standard.
  Report the numbers.

**Deploy agent** (deploy/, tools/):
- **`deploy/perf_test.py`:**
  - Playwright on the GPU with Chrome DevTools CPU throttling (4×) at 1280×720.
  - Plays 60 s in a match with 3 bots (moving and casting).
  - Reports fps, p50/p95/max frame time, the number of frames over 50/100 ms, triangles, draw calls, programs and the
    tier chosen.
  - A `--latency 200` option, using a small WebSocket proxy that delays both directions, which also reports
    snapshot-gap and remote-motion smoothness.
  - Exits non-zero against the targets.
- Run it before and after on `localhost`, and against the live server.
- Rebuild `dist/crazygames` from the final commit and update the checklist.

## Coordinator decision to raise with Ty
An **EU server** (Render Frankfurt, about $25/month) would cut European ping from about 170 ms to about 30 ms. Decide
after the smoothing work and the latency test show how it feels at 200 ms.

## Verification
- `perf_test.py` passes its targets, before and after numbers are in the hand-offs, and unit tests ALL PASS.
- The subpath test and smoke test pass.
- Ty plays it on his own machine.
- Push, rebuild, and Ty submits a new version with a short note to CrazyGames QA describing the performance changes.
