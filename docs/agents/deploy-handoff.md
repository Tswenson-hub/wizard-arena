# Deploy hand-off

## Where it lives
- **Repo (public):** https://github.com/Tswenson-hub/wizard-arena, branch `main`
- **Live game:** https://wizard-arena-76od.onrender.com
- **Render service:** `srv-dbhui1ec6qcc73f0qt70`, Standard plan (always on), auto-deploy on every push to `main`.
  Deploys show up on GitHub as deployments ("main - wizard-arena") with the Render dashboard link.
- **Live commit:** `e416f68` (rounds 12b-13: Roll on F, the map editor, Ty's assets, mountains, ground textures,
  jeb2 animations), pushed by the coordinator with Ty's approval. Earlier: `29602cc` (deploy took ~45 s).

## Round 24: Sky Ruins rebuilt (deploy's part)
**Verified at `54d1a9a`** (the final round-24 commit: environment `bb8bd1f` `f1ebcf8`, spells `f6f05bf`…`2eb6321`, characters; the server from
a detached worktree at that commit on 4105 with WA_DEBUG + MATCH_DEBUG; the `95aca29` no-proto build on 4198, the `21a31ef` round-23 build
(proto 22, pending at CrazyGames) on 4197, the `54d1a9a` build on 4199; everything headless on the M4 GPU; logs, JSON and shots in
`/tmp/wa-deploy/r24/`):
- `MATCH_DEBUG=1 node tools/test/modematch-unit.mjs` at `54d1a9a`: **ALL PASS**.
- `perf_test.py`, both maps, 0 and 200 ms (CPU 4×, 1280×720 DPR 1, 60 s, 4 in the match, `--map` through `matchDebug`; `perf1-<map>-<ms>.*`):

  | Run | fps | p95 / max after 10 s | triangles median (p95) | draw calls | programs (after 10 s) | result |
  |---|---|---|---|---|---|---|
  | sky, 0 ms | 59.9 | 18.3 / 18.7 | 94,406 (107,480) | 58 | 58 (0) | **PASS** 10/10 |
  | sky, 200 ms | 60.0 | 18.3 / 18.8 | 101,370 (118,210) | 85 | 58 (0) | **PASS** 13/13 (stalls 0 %, jumps 0, reversals 4/min) |
  | courtyard, 0 ms | 60.0 | 18.3 / 50 | **123,481** (183,278) | 115 | 57 (0) | FAIL only `triangles < 120k` |
  | courtyard, 200 ms | 60.0 | 18.3 / 18.7 | **124,912** (176,238) | 113 | 57 (0) | FAIL only `triangles < 120k` (stalls 0 %, 2 jumps, 1 reversal/min) |

  **Sky Ruins** went 59k (the old map, `c0a4f41`) → **94–101k with the keep**, under the 120k line, programs 58 as before and none compiled
  mid-match, no console errors. **The courtyard** is where it was (127k at `c0a4f41`, 122k in round 22; `layout.json` unchanged): the
  pre-existing overage, not this round's. Its draw calls are 113–115 against 120: environment's LOD trim brought them back under; worth watching.
  The 0 ms sky shot has the driver's camera against our own hat at an island's edge (the headless driver, not the game).
- `smoke.py http://localhost:4105` **PASS** (`smoke-54d1a9a.png`): 4 in the match, the no-proto join in a legacy room (`public-2`, `gen 'legacy'`,
  the courtyard, no runes or pads), **the proto-22 join in a v22 room** (`public-3`, `gen 'v22'`, the courtyard, 4 runes and 6 pads in the welcome,
  runes in its snapshots), neither seen by the proto-24 player; the first visit in a match in 1.0 s with Easy bots; no console errors.
- `subpath_test.py http://localhost:4199/game/ --max-mb 20 --site http://localhost:4105/` **PASS** (`subpath-54d1a9a.png`): **9.2 MB initial in
  402 responses**, 381 requests all under `/game/`, none failed, rooms 15/15 (the private room, the code box, the invite link on our site, the
  `version` refusal for a no-proto join by a current code), SDK start/stop, no console errors.
- `legacy_test.py http://localhost:4198/game/` **full length, no `--fast`** (`legacy-full.png`, `-recap.png`): the `95aca29` client played a real
  first-to-10 in a legacy room to the target after 308 s, podium, rematch countdown, socket open, 0 failed requests, 0 errors; the only
  field it never knew: `match.map`.
- **`legacy_test.py http://localhost:4197/game/ --gen v22 --fast`** **PASS** (`v22-fast.png`, `-recap.png`): the round-23 build (`21a31ef`, proto 22)
  landed in `public-3` (`gen 'v22'`, `maps ['courtyard']`), runes and pads in its welcome, the HUD read first to 10, the match (target 3)
  ended at the target, podium, rematch, **the courtyard in every match message and no `map` message** (no rotation), 0 errors.
- **The zip:** `npm run build:crazygames -- --ref 54d1a9a` exit 0, no warnings: **446 files, 10.5 MB unzipped, 7.1 MB zip**, sha256
  `ed1d4a991b42e9df…`, `PROTO = 24`, talks to `wss://wizard-arena-76od.onrender.com`. (`dist/crazygames-r23` and `dist/crazygames-legacy` are
  the 21a31ef and 95aca29 builds pointed at 4105, kept for the next run; `dist/crazygames-local` is the 54d1a9a build at 4105.)

**Scripts (deploy-owned, `990494c`):** `legacyjoin.py` takes `proto=` and gains `report_v22` (a proto-22 join: `room.gen 'v22'`, the courtyard,
runes and pads in the welcome and the snapshots, apart from the proto-24 client); `smoke.py` runs it next to the no-proto join;
`legacy_test.py --gen v22` plays the round-23 build through a match and the rematch and fails on any map other than the courtyard or any `map` message.

**Push order (the coordinator):** the server is backward-compatible with both store builds (`95aca29` in legacy rooms, the pending `21a31ef`
in v22 rooms), so Render can take `54d1a9a` before the new zip is approved; after the push, `python3 deploy/smoke.py https://wizard-arena-76od.onrender.com`
(the live smoke now also checks the proto-22 path). Then the zip above to CrazyGames. Not done here: a real-browser look at the keep on
localhost:3000 (Ty's), the push, the upload.

**Baselines at `c0a4f41`** (before the rebuild), for the record: sky 59,366 triangles (p95 101,602) / 94 draw calls / 58 programs, PASS;
courtyard 127,366 / 109 / 57, FAIL only triangles (`perf0-<map>-0.*`).

## Round 22: pace, runes, pads, two maps (deploy's part)
**Scripts (deploy-owned):**
- `863ec00` `e53b49a` `7476208` `d2f4467` `b003200` `636b439` requests.md: the interfaces the tests need, taken up by spells as posted:
  `match.map` (`{ id, name }`; my scripts also take a string) and `match.next`; `room.legacy: true` on legacy rooms (the frozen `legacy`
  layout, byte-identical to what the live build bundles); `matchDebug.map` (MATCH_DEBUG) and the host's `{ t: 'roomMap', map }`;
  `<html data-map>` / `__wa.map` after the client's swap; `roomError.reason = 'version'`. Two findings from runs against spells' working
  tree went there too (an empty, then a non-empty `runes` in legacy snapshots: both fixed before `c29cda4`), and the perf numbers below.
- `768b204` **`deploy/legacy_test.py`**: the live CrazyGames build (`--ref 95aca29 --server ws://localhost:4105 --out
  dist/crazygames-legacy --no-zip`: identical to the live `dist/crazygames` but for config.js) served under `/game/` on 4198 and played
  against the new server on 4105 with the perf driver, through a whole match to the podium and the rematch countdown. `--fast` (MATCH_DEBUG
  on the server) plays to 3 kills with a 4 s recap, about a minute; without it the real target or the 5-minute cap. Checks: the HUD's
  "first to N" and the prompt read the server's target; a legacy room (`room.legacy`, the courtyard, no runes or pads in the welcome or the
  snapshots); the socket stays open; the SDK shim's gameplayStart; no failed requests, no console or page errors; and it lists every field
  the old client never knew that it was sent. `--first` takes the first-visit path instead of the builder.
- `2311dbb` `e4514db` `ce3d65c` **`deploy/legacyjoin.py`**: a join without `proto` from the test's own browser (on the game server's origin:
  Chromium refuses the socket from about:blank), used by **`smoke.py`** (next to `smoketest`) and **`subpath_test.py`** (next to `subpath`,
  against the build's `WA_SERVER`, and in the rooms check with the new room's code): the server welcomes the old join; the joiner is in a
  legacy room, the proto-22 player isn't, neither ever sees the other in its snapshots, no runes or pads reach the legacy room; an old join
  with a current room's code gets `roomError 'version'` and a legacy public room. On a server without `room.legacy` (live today) it only
  reports, so the live smoke keeps passing.
- `2311dbb` **`perf_test.py --map courtyard|sky`**: sends `matchDebug.map` (or `roomMap` with `--room new`, for live), waits up to 90 s
  for `data-map`, settles 3 s, then measures; reports `map` and adds the target "on the <map> map"; JSON gets `map`, `map_wanted`.

**Verified at `8a6e855`** (the server from a detached worktree at that commit on 4105, so the others' live edits never moved under a run;
the 95aca29 build on 4198, the `8a6e855` build on 4199; everything headless on the M4 GPU):
- `legacy_test.py` **full length** (`734b1e5`, no `--fast`): a real first-to-10 match in a legacy room ended at the target after 187 s of
  play, 3 on the podium, the podium scene on the old client, the rematch countdown, the socket open, 0 errors
  (`/tmp/wa-deploy/r22/legacy-full.png`, `-recap.png`). The only unknown fields the old client was sent: `match.map` and the new `callout`
  message, both ignored. `--fast` at `8a6e855`: PASS (`legacy-8a6e855.png`).
- `smoke.py` PASS with the legacy join (`smoke-8a6e855.png`); the first visit in a match in 0.7 s with Easy bots.
- `subpath_test.py --max-mb 20 --site http://localhost:4105/` PASS: **9.2 MB initial in 402 responses**, nothing outside `/game/`, no
  failures, rooms 14/14 including the `version` refusal, no console errors (`subpath-8a6e855.png`: the dressed courtyard).
- `perf_test.py`, both maps, 0 and 200 ms (CPU 4×, 1280×720, 60 s, 4 in the match; JSON and shots `/tmp/wa-deploy/r22/perf2-sky-*`,
  `perf3-courtyard-*`):

  | Run | fps | p95 / max after 10 s | triangles median (p95) | draw calls | programs (after 10 s) | result |
  |---|---|---|---|---|---|---|
  | sky, 0 ms (`b003200`) | 60.0 | 18.3 / 18.8 | 50,734 (93,494) | 98 | 58 (0) | **PASS** |
  | sky, 200 ms | 60.0 | 18.3 / 18.8 | 52,668 (76,012) | 107 | 58 (0) | **PASS** (stalls 0 %, jumps 0, reversals 3/min) |
  | courtyard, 0 ms (`8a6e855`) | 60.0 | 18.3 / 18.7 | **121,880** (181,049) | 86 | 57 (0) | FAIL only `triangles < 120k` |
  | courtyard, 200 ms | 60.0 | 18.3 / 18.8 | **122,190** (185,490) | 92 | 57 (0) | FAIL only `triangles < 120k` (stalls 0 %, 0 jumps, 0 reversals) |

  The courtyard went 142.8k (`734b1e5`, dressed) → 139k (`b003200`) → 122k after environment's trim (`8a6e855`): 2 % over the round-20
  line with the frame budget untouched; **the coordinator's call** (posted in requests.md). Sky Ruins went 62 → 58 programs with `8476562`.
  One `b003200` courtyard run at 200 ms read 28 reversals/min for the remote wizards (0–5 in every other run): bots turning on pads and
  runes rather than the netcode, I think; a check to watch.
- **Re-run at `a7d177c` and `1d192c5`** (spells' Sky Ruins bot fixes and the map-change physics hold): `smoke.py` PASS, `subpath_test.py` PASS
  (9.2 MB in 402 responses), `legacy_test.py --fast` PASS, `perf_test --map sky` PASS (60 fps, 49.9k triangles, 83 calls, 58 programs;
  `/tmp/wa-deploy/r22/perf5-sky-0.json`). `c6e313a` (bots' ranges and pad use, `server/bots.js` only) landed after those runs; the zip is
  built from it and its client is `1d192c5`'s.
- **Not done here:** the live smoke after the push (the coordinator's, with Ty's go-ahead); a real-browser look at Sky Ruins (the headless
  mid-match shot `perf-sky-0.png` has the camera inside an island's rock for a frame: worth a glance on localhost:3000).
- **If a newer commit is the one pushed:** `git -C /tmp/wa-deploy/wt checkout --detach <sha>` and restart 4105 from it, then the three
  quick runs above (`smoke.py`, `subpath_test.py` on a `--ref <sha>` build, `legacy_test.py --fast`) take about 5 minutes, and
  `npm run build:crazygames -- --ref <sha>` remakes the zip. The worktree is removed and the ports 4105 / 4196–4199 are stopped; `dist/crazygames-legacy`
  (the 95aca29 build pointed at 4105) and `dist/crazygames-local` (the `1d192c5` build) are left for the next run.

## Round 18: saves (deploy's part)
- `8b425e8` **platform.js:** `getUserToken()` → the `IN_GAME_AUTH` JWT, or null (guest: `getUser()` null; no SDK; any error, e.g.
  `userNotAuthenticated`); `onAuthChange(fn)` wraps `user.addAuthListener` (CrazyGames reloads on logout). Spells' main.js already
  calls both (`?.`).
- `5086a1c` **`jose` ^6 in dependencies** (it was only in node_modules, so Render's `npm ci --omit=dev` would have left it out and
  every token would have been rejected). Checked: a clean `npm ci --omit=dev` from the lockfile installs it and `import('jose')` works
  on Node 22.
- `ff8a877` **config:** `.env.example` (with `!.env.example` in .gitignore), `render.yaml` `SUPABASE_URL` / `SUPABASE_SECRET_KEY`
  with `sync: false`, and the build's secret scan (fails before the zip; checked with a planted value: exit 1, no zip).
- **Verified at `ff8a877`:** `NODE_ENV=test node tools/test/saves-unit.mjs` all pass; `subpath_test.py --max-mb 20 --site
  http://localhost:4105/` PASS (the build from `--ref HEAD`; rooms as in round 17, 7.8 MB initial, no errors,
  `/tmp/wa-deploy/r18-subpath.png`); under the local SDK, `getUserToken()` gave a 3-part RS256 JWT and the game sent `{t:'auth'}`
  after the welcome (my server had no Supabase env, so it stayed a guest, as designed).
- **Not checked here:** a real login against Supabase (needs the keys; the coordinator / Ty on Render).

## Round 17: rooms and CrazyGames multiplayer (deploy's part)
- **`public/js/platform.js`** (`8a38c05`, `7d8200a`, `f129e88`): the game's one door to the SDK, on both builds. `ready`, `onCrazyGames`,
  `isInstantMultiplayer`, `inviteRoom`, `inviteLink`, `updateRoom`, `leftRoom`, `onJoinRoom`, `getUsername`, `show/hideInviteButton`,
  `happytime`, `onMuteAudio`. Every SDK call is guarded and in try/catch; with no SDK (our Render site) invites are `?room=CODE` links and
  the rest are no-ops. A `?room=` on the page (our links, and spells' `WA_ROOM.join` reload) wins over the SDK's launch params and turns
  `isInstantMultiplayer` off, so switching rooms inside the CrazyGames iframe doesn't bounce back. The shim (`deploy/crazygames/platform.js`)
  exposes `WA_PLATFORM.ready` and now stops gameplay on `#deathScreen`, `#mRecap` and `body.recap-on` too.
- **Mute audio:** `SDK.game.settings.muteAudio` + `addSettingsChangeListener` → `Platform.onMuteAudio` → spells' `sfx.setPlatformMute`
  (silent over the player's own M setting, never saved). Checked: the local SDK with `?muteAudio=true` fires `onMuteAudio(true)`.
- **Verified at `038f34e`** (build from the tree with `--server ws://localhost:4105`, served under `/game/` on 4199):
  - `subpath_test.py --max-mb 20 --site http://localhost:4105/`: **PASS**. A created room `BF8J`; the invite card's link came from the real SDK
    (`…czy_invite_params=room%3DBF8J`); B joined by the code box; C opened `localhost:4105/?room=BF8J` and was in the room with no click;
    every chip read 3/4; each saw the others' names in the server frames; D (Play) landed in a public room and saw neither; `ZZZZ` showed
    "Room ZZZZ doesn't exist…" in a public match; 7.8 MB initial, nothing outside `/game/`, no failures, no console errors.
    Screenshots `/tmp/wa-deploy/r17-subpath-roomA.png`, `-roomB.png`.
  - `--block-sdk`: PASS (the invite link falls back to `…/game/?room=G5SJ`). `smoke.py http://localhost:4105`: PASS (healthz now reads
    `ok rooms=N humans=N bots=N`; smoke accepts it).
  - The local SDK's fake user `User1` filled the name field: `getUsername` works end to end.
  - The shim's events in a real browser: entering the match → `gameplayStart`; death screen, recap (both kinds), Esc menu → `gameplayStop`.
- **Cosmetic, characters:** the invite card opens over the "Click to play" prompt (`r17-subpath-roomA.png`).

## Round 16: GPU tests, the live check, the zip
- **Tests on the GPU** (round 16): `deploy/smoke.py`, `deploy/subpath_test.py` and `deploy/capture_store.py` launch Chromium with
  `--use-angle=metal --enable-gpu --ignore-gpu-blocklist` by default; `--swiftshader` brings back software GL. SwiftShader stalled more
  than 8 s compiling the castle's shaders after the screenshot, which failed smoke's "still connected" check locally and live.
  (`tools/test/ram_e2e.py`, the coordinator's, still launches SwiftShader.)
- **Live, `6d08eea`** (2026-11-01, `python3 deploy/smoke.py https://wizard-arena-76od.onrender.com /tmp/wa-deploy/live-r16.png`): PASS.
  healthz `ok` in 0.2 s, page ready in 1.8 s (9–15 s on SwiftShader), builder 6 rows / 35 cards / 8 presets, joined a 4-wizard FFA
  with bots Ossia, Cragrib and Grimshank (normal), still connected (first frame 0.5 s after the screenshot), `wss://` traffic, no
  console errors. Live `shared/constants.js` byte-matches `6d08eea`.
- **Local, `6d08eea`:** `smoke.py` PASS (ready in 4.6 s); `subpath_test.py --max-mb 20` PASS, **7.7 MB** initial in 355 responses, nothing
  outside `/game/`, no failures, no console errors, SDK start/stop (`/tmp/wa-deploy/r16-subpath.png`).
- **Zip:** `dist/crazygames.zip` rebuilt from `6d08eea` (377 files, 9.5 MB unzipped, 6.6 MB zip). The local test build differs from it only
  in `config.js` (the server URL).

## Round 15 (castle overhaul): deploy work
- **Build** (`07206f6`): `npm run build:crazygames` now **fails** on a root-absolute path in the sources and lists each `file:line`
  (`--allow-abs` rewrites them in the copy, for a test build only, never the upload). It also refuses unconverted source formats under
  `public/` (`.gltf`, `.fbx`, `.obj`, `.mtl`, `.blend`, `.tga`, `.psd`, `.exr`, `.hdr`), keeps any `js/editor*.js` out, and prints the size by
  folder with `models/` split per kit (`models/castle/`, `models/village/`, `models/characters/`). New folders under `public/` ship with no
  change. At `b10be88` it fails on 22 paths, all characters' (looks.js 15, select.js 1, wizards.js 6), posted in requests.md.
- **Initial download** (`fe5123e`): `deploy/subpath_test.py` counts the bytes CrazyGames counts (load start to the first `gameplayStart`),
  plus at "Ready" and by folder; `--max-mb 20` fails over the target.
- **Store art** (`14f2d24`): `deploy/capture_store.py <game url> [out]` (below).
- **README credits** (`896c7f2`, `ad5bb1b`): Kay Lousberg (four KayKit packs) and Quaternius, CC0; Kenney particles; RandomMind's CC0 menu
  music. After Phase B, Meshy is credited only for what's still shipped: trees, potion barrel, ram, ice wall, acid puddle, mountains, grass.
- **Phase B clean-up** (`2337150`, `ebec3be`, `0baa724`, `8c808cf`): deleted 25 farm GLBs, `textures/ground/dirt_path.webp`, `wizard.glb`,
  `models/wizards/` (15 files), `tools/bake-clip-pool.py`, `tools/prepare-wizard-model.sh` (each grepped unreferenced first); dropped
  the presets' dead `tint`/`model`, the `registerModel` stub, the deleted names in the editor's `SPECIAL_MODELS`, and the last absolute
  path (`select.js:26`). Noted in requests.md.
- **Verified at `8c808cf`:** `modematch-unit` ALL PASS (96 checks); `npm run build:crazygames -- --ref HEAD` exit 0 with no warnings;
  `subpath_test.py --max-mb 20` PASS, 7.7 MB initial, no request outside `/game/`, no failures, no console errors, SDK start/stop
  (`/tmp/wa-deploy/phaseb-subpath.png`, the castle); `smoke.py` on a HEAD server PASS 3 of 4 runs, the 4th failed only "still connected"
  (0 frames in 2 s while the page compiled shaders), fixed in `smoke.py` by waiting up to 8 s (then PASS, first frame after 1.5 s).

### Download budget (target under 20 MB to the first gameplayStart)
| When | Initial download | Build | Notes |
|---|---|---|---|
| `b10be88` (round 14, farm) | **16.9 MB** in 383 responses | 313 files, 30.4 MB unzipped, 22.8 MB zip | sounds 2.5, farmhouse 2.0, silo 1.6, wizard.glb 1.4, barn 1.3, textures 1.1, wizards/ 0.8 (lazy), vendor 0.8, js 0.5 |
| `51355b3` (characters and castle kit in, farm not yet removed) | not measured (game server mid-change) | 372 files, 32.3 MB unzipped | characters/ 1.3 MB (6), castle/ 0.3 MB (51); fails on 7 absolute paths |
| **`8c808cf` (Phase B: farm, Meshy wizards and dirt texture deleted)** | **7.7 MB** in 355 responses | **377 files, 9.4 MB unzipped, 6.6 MB zip**, zero absolute paths | sounds 2.5, characters 1.3, textures 0.9, vendor 0.8, castle 0.5, js 0.5, ram 0.3, village 0.3, potion 0.3 |

The unzipped 30.4 MB is mostly what round 15 removes: `models/wizards/` 12.8 MB (15 files, the Meshy heroes, `clip-pool.glb`, `jeb2`) and
the farm models in `models/` 12.2 MB. Re-measure after Phase B's delete:
```sh
node tools/build-crazygames.mjs --server ws://localhost:4105 --out dist/crazygames-local --no-zip
PORT=4105 node server.js &  node tools/serve-subpath.mjs dist/crazygames-local 4199 /game &
python3 deploy/subpath_test.py http://localhost:4199/game/ /tmp/wa-deploy/subpath.png --max-mb 20
```

## Round 26 verification (HEAD `1c14c92`; `public/` and the server are `cb2508c`'s; private ports, 3000 untouched)
Server `WA_DEBUG=1 MATCH_DEBUG=1 PORT=4105`; the 95aca29 / 21a31ef / 54d1a9a / HEAD builds on 4198 / 4197 / 4196 / 4199; all in `/tmp/wa-deploy/r26/`. Supabase isn't
configured in this server, so no rows were written (the events batching runs in `playtime-unit` with stubbed hooks; the live write is the coordinator's check after the push).
- **`smoke.py` PASS:** no-proto join in a legacy room, proto-22 join in a v22 room, **a proto-24 join in a current room**; **none of the three got an `xp`,
  `progress`, `challenge`, `emote`, `taunt` or `look` message or a `welcome.progress`** (new `report_no26` / `report_v24` in `legacyjoin.py`); a proto-26 join's welcome
  carries progress (level 1, 0 XP, "Apprentice", 3 challenges); first visit 0.8 s, Easy bots; no console errors.
- **`subpath_test.py --max-mb 20` (the HEAD build) PASS:** 9.3 MB initial (was 9.2), rooms all ok, the older joins as above, no failed requests, no errors; the page keeps `wa-progress` / `wa-equipped` / `wa-ladder`.
- **`legacy_test.py --fast` PASS** on the three older store builds: legacy (95aca29), `--gen v22` (21a31ef), new `--gen v24` (54d1a9a): the match, the recap and the rematch, and the check that none of the round-26 messages reached them.
- **Characters' `e2e.py` (copied to 4105) ALL PASS:** a first match fills the XP bar (+50 finish, +30 podium), level 2 with Crimson robes, the next-unlock teaser, 3 challenges, a toast, V emote seen by a second client, the Wardrobe equip seen by it, programs 55.
- **`perf_test` (CPU 4x, 1280x720, 60 s, 4 in the match):** sky **88.9k triangles (p95 98.5k) / 58 draw calls / 58 programs PASS** (60 fps, p95 18.3 ms, 0 compiled mid-match);
  courtyard, three runs: **94 / 99 / 121 draw calls, 120.7k / 115.9k / 123.8k triangles**, 57 programs, 60 fps: the triangle overage is the pre-existing one (127k at `c0a4f41`,
  123.5k in round 24), and the draw calls swing with the bots' cosmetics (the first run missed `< 120` by one).
- **Unit:** `playtime-unit`, `notify-unit`, `saves-unit` ALL PASS. **`modematch-unit` needs `MATCH_DEBUG=1` exported** (without it the two map-switch checks fail); with it **one check fails, every run:**
  "the thrown crate hits B up on the island and breaks there": the crate flies and breaks at (4.1, 7.2, 34.9) with no `hit` message (spells' hand-off says 290 pass; something between).

## Round 27 verification (final commit `8fba931`; includes round 28's bodies; private ports 4105 / 4195-4199, all stopped; 3000 untouched)
Server `WA_DEBUG=1 MATCH_DEBUG=1 PORT=4105`; builds from `95aca29` (legacy), `21a31ef` (v22), `54d1a9a` (v24), `1c14c92` (the round-26 build) and HEAD, in `/tmp/wa-deploy/r27/`.
- **Unit:** modematch (with `MATCH_DEBUG=1`), playtime, notify, wizards ALL PASS; saves-unit all passed.
- **`smoke.py` PASS:** the gallery has 6 `.wg-card`, no spell cards or rows (the script now checks that); no-proto join in a legacy room, proto 22 in a v22 room, **proto 24 in a `v24` room** (the
  check expected "current" before round 27; `legacyjoin.py` fixed), none of them got round-26 messages; a proto-26+ join's welcome carries progress; first visit in 1.3 s; no console errors.
- **`subpath_test.py --max-mb 20` (HEAD build) PASS:** 9.9 MB initial (was 9.3: the five body models), 6 wizard cards and 0 spell cards, rooms ok, no failed requests, no errors.
- **`legacy_test.py --fast`: legacy PASS, `--gen v22` PASS, `--gen v24` (54d1a9a) PASS** (match, recap, rematch; no round-26 messages).
  The round-26 build (`1c14c92`, proto 26) also plays a whole match, recap and rematch in a v24 room; the test's "no round-26 messages" check fails for it, as it should (a proto-26 client is sent xp/emote/taunt), so that is not a regression.
- **Perf: inconclusive.** The machine was at load 22-40 (other agents' browsers; one headless Chromium has run since 12:39), so every run dropped to the `low` tier at 27-42 fps and the frame targets can't be judged.
  Load-independent numbers: sky 90.9k triangles / 90 draw calls (round 26: 88.9k / 58 on the `high` tier), courtyard 109k triangles / 104 draw calls (round 26: 116-124k / 94-121); 62-63 programs at load, 0 linked mid-match
  (the "programs < 60" miss is the harness counting every WebGL context, as characters said). **Rerun on an idle machine** (`perf_test.py http://localhost:41xx --map sky|courtyard`) before the upload.
- **Zip rebuilt:** `npm run build:crazygames -- --ref HEAD` from `8fba931`: 452 files, 11.3 MB unzipped, 8.0 MB zip, sha256 `c2eca607a96df993…`, exit 0, `models/characters/` has the five new bodies; the only Trapped Relic text left is a comment in `shared/map.js`.
- Screenshots: `/tmp/wa-deploy/r27/smoke-builder.png` (the gallery on the join screen), `smoke.png` (in the FFA), `subpath.png`.

**Short description** (round 27):
```
Start as the Pyromancer, level up to unlock five more wizards, then duel three rivals in fast free-for-alls across two arenas: a castle courtyard and the Sky Ruins.
```

**Description** (round 27: six fixed wizards, no spell builder, Arcane Grasp for all):
```
Start as the Pyromancer, win duels, level up and unlock more wizards with XP: the Frost Warden after your first match, then the Stormcaller, the Hemomancer, the Alchemist and finally the Beastcaller. Six wizards, six very different kits. Hurl fireballs and call down a meteor rain, freeze a rival mid-dash and wall off a corridor with ice, blink through a storm, drain a rival with Blood Siphon to heal yourself, throw potions that poison and a brew that makes you berserk, or ram through the arena as the Beastcaller. Hover a wizard on the select screen to see all six of its abilities before you pick.

Every wizard has Arcane Grasp: press F to seize a crate, a barrel or a loose rock with your mind and hurl it at a rival, or break it on the courtyard walls and the Sky Ruins' stones to get the drop on the other wizards.

Earn XP every match for finishing, for kills, for a podium place and for a win, and finish the three daily challenges for a bonus. Each level unlocks a cosmetic for your wizard: robe colours, hats, staff glows and spell trails, shown on your nameplate with your level and title. Equip them in the Wardrobe.

Matches are four-wizard free-for-alls, first to 10 kills or the most kills in five minutes, after a three-second countdown. Skeleton bots with their own personalities (the Brawler, the Sniper, the Trickster, the Healer and the Showboat) fill any empty seat instantly, so there is always a fight, and they adjust to how you play. Grab the runes that spawn at the contested spots (Haste, Arcane Fury, Aegis and Surge), ride the jump pads onto the towers and across the courtyard, and chain kills for First Blood, Double Kill and streak call-outs. Press V to cheer or taunt.

Two arenas take turns: the castle courtyard, and the Sky Ruins, a broken mage tower on floating islands where a knockback spell can send a rival into the void. Dodge, double-jump, take the high ground and time your shield to turn the duel.
```
(Removed: "35 spells", the six slots, "build your own wizard", Roll. Please check "Dodge, double-jump" against the final controls: Roll is gone.)

## CrazyGames submission checklist (round 17)
Sources: docs.crazygames.com, "Technical requirements", "Gameplay requirements", "Game covers" and "Multiplayer" (read 2026-10-30).

### What to upload (zip from `c6e313a`, round 22; rebuild from the commit that's pushed to Render)
| What | Path | Notes |
|---|---|---|
| **Game zip** | `dist/crazygames.zip` (gitignored; rebuild with `npm run build:crazygames -- --ref <sha>`) | **built from `1c14c92`** (round 26: XP, levels, daily challenges, cosmetics, the wizard ladder, bot personalities, drop-off events; PROTO 26, `public/` is `cb2508c`'s; 449 files, 10.6 MB unzipped, 7.5 MB zip, sha256 `b43ca04558271626…`, no secrets; the server keeps the `95aca29`, `21a31ef` and `54d1a9a` store builds playing). Previously **`54d1a9a`** (round 24: the rebuilt Sky Ruins, PROTO 24; 446 files, 10.5 MB unzipped, 7.1 MB zip, sha256 `ed1d4a991b42e9df…`; the server keeps the `95aca29` and `21a31ef` store builds playing in legacy and v22 rooms). Previously: **built from `c6e313a`** (round 22: first to 10, runes, jump pads, the dressed courtyard, Sky Ruins in rotation; rounds 19–21 stats, perf, first visit; its `public/` is `1d192c5`'s, the commit the quick set and a Sky Ruins perf run passed on; `c6e313a` itself changes `server/bots.js` only): **445 files, 10.4 MB unzipped, 7.1 MB zip**, sha256 `66223536280e56d0…`, no secrets (the build checks); talks to `wss://wizard-arena-76od.onrender.com`. **Round 22 is backward-compatible:** the server keeps the live build (`95aca29`, no `proto`) playing in legacy rooms, so Render can be pushed before the new zip is approved; players on the old version just don't see runes, pads or Sky Ruins until it is |
| **Cover, landscape 1920×1080** | `deploy/crazygames/store/covers/cover-hero-landscape-1920x1080.jpg` | recommended: the Mage up close in the courtyard |
| **Cover, portrait 800×1200** | `deploy/crazygames/store/covers/cover-hero-portrait-800x1200.jpg` | same frame, cropped |
| **Cover, square 800×800** | `deploy/crazygames/store/covers/cover-hero-square-800x800.jpg` | same frame, cropped |
| Alternative covers | `deploy/crazygames/store/covers/cover-vista-*.jpg` | the courtyard from above, mid-fight; same three sizes |
| **Screenshots, 1920×1080** | `deploy/crazygames/store/screens/01-overhead.jpg` … `09-ground-east.jpg` | 01 overhead, 02 wall-walk, 03–05 gameplay with the HUD (03 a Blizzard call-out, 04 two skeletons, 05 the hall), 06–09 ground level from 4 sides. Best to lead with 04, 03, 01, 02 |
| **Preview video** | not made | required: 15–20 s, 1080p landscape **and** 1080p portrait (2:3), < 50 MB, no sound, cursor, logos or black bars; open on the cover's frame. Record from a real browser (OBS); headless is too slow |

Each cover has the title only ("Wizard Arena", Cinzel Decorative) over a clean render, with no HUD, borders, logos or other text (their
rules). The three covers in each set are crops of one 2400×2400 frame, so they match. Made by `deploy/capture_store.py` (below) and
picked by eye from four runs at `04fd64b` (round 16 changed spells and balance, not the castle or the bodies, so they still show the game as it is); the raw renders are in `dist/store-r3`, `-r4`, `-r5` until `dist/` is cleaned.

### 1. Build and server
- `npm run build:crazygames -- --ref <approved sha>` (no `--allow-abs`; it must exit 0). The zip above is from `c6e313a`; rebuild it
  from whatever is pushed, so the client and the server match (from round 22 on, an older client still plays, in a legacy room).
- Render must run the **same commit's** server (the protocol changes between rounds): the coordinator pushes it to `main` (Ty's go-ahead)
  before or with the upload. Then `python3 deploy/smoke.py https://wizard-arena-76od.onrender.com`.
- Upload `dist/crazygames.zip` as HTML5 (index.html at the zip's root).
- Limits: 250 MB total, 1,500 files, initial download 50 MB desktop / 20 MB mobile homepage, relative paths only. We're at 445 files,
  **9.2 MB initial** (round 22; 7.7 MB in round 15). Sky Ruins' layout and its extra pieces load in the background after the first match
  starts, so they're not in the initial download.

### 2. The form (ready to paste)
**Title:** `Wizard Arena`

**Short description** (round 26):
```
Unlock new wizards as you level up, then duel three rivals in fast free-for-alls across two arenas: a castle courtyard and the Sky Ruins.
```

**Description** (round 26: XP, levels, daily challenges, cosmetics, the wizard ladder, bots with personalities; still first to 10, the 5-minute cap, runes, jump pads, two maps):
```
Start as the Pyromancer, win duels, level up and unlock more wizards: the Frost Warden after your first match, then the Stormcaller, the Hemomancer, the Alchemist and the Beastcaller, and finally the spellbook itself, where you build your own wizard from 35 spells, one for each of six slots (primary, power, shield, mobility, utility and ultimate) across fire, ice, wind, earth, blood, alchemy and arcane. Every wizard plays differently: lob fireballs from the wall-walk, freeze a rival mid-dash, drain a rival with Blood Siphon to heal yourself, wrap yourself in Sanguine Aegis, lift a crate with telekinesis and hurl it, or curse a barrel and wait.

Earn XP every match for finishing, for kills, for a podium place and for a win, and finish the three daily challenges for a bonus. Each level unlocks a cosmetic for your wizard: robe colours, hats, staff glows and spell trails, shown on your nameplate with your level and title. Equip them in the Wardrobe.

Matches are four-wizard free-for-alls, first to 10 kills or the most kills in five minutes, after a three-second countdown. Skeleton bots with their own personalities (the Brawler, the Sniper, the Trickster, the Healer and the Showboat) fill any empty seat instantly, so there is always a fight, and they adjust to how you play. Grab the runes that spawn at the contested spots (Haste, Arcane Fury, Aegis and Surge), ride the jump pads onto the towers and across the courtyard, and chain kills for First Blood, Double Kill and streak call-outs. Press V to cheer or taunt.

Two arenas take turns: the castle courtyard, and the Sky Ruins, a broken mage tower on floating islands where a knockback spell can send a rival into the void. Dodge, double-jump, roll, take the high ground and time your shield to turn the duel.
```
The round-22 text (build from any spell at once) is in git history.

**Privacy note** (round 26; the same text is in the game's "?" card, `Select.PRIVACY` in `select.js`; paste it into the form's privacy / data field if there is one):
```
Privacy: if you play logged in to CrazyGames, we store your CrazyGames username and ID, your saved spells and settings, and your match stats on our server to keep your progress. As a guest, your data stays in this browser and your name is used only for the match. CrazyGames usernames, levels and match stats appear on the in-game leaderboard. We also record anonymous gameplay events (when you join, how long you play, kills, where you leave a match) and your XP, level and unlocks, tied to a random ID and, if logged in, your CrazyGames ID, to improve the game. No ads, no IP addresses or emails stored. Questions or deletion requests: tyswenson34@gmail.com
```
(Copied verbatim from `Select.PRIVACY` at the round-26 HEAD; if select.js changes it, copy again.)

**Controls** (matches the in-game how-to-play card, select.js `KEYS`):
```
WASD: move
Mouse: look and aim
Space: jump (press again in the air to double jump)
Shift: sprint
C: crouch
Left click: primary spell
Right click: power spell
R: shield (hold or tap)
E: mobility spell
F: utility spell
Q: ultimate (once charged)
T: reload early
M: mute
Esc: menu and loadout
```

**Tags** (choose from their list; these are the closest fits): `Multiplayer`, `PvP`, `Magic`, `Wizard`, `Fantasy`, `3D`, `Third-person`,
`Shooter`, `Arena`, `Battle`. **Category:** Action (or Shooter).

**Settings:**
- **Multiplayer:** [x] yes, real-time online, **"Online with Friends"**. **Lobby size: Min 1 / Max 4** (free-for-all; bots fill the
  empty seats, so one player can start alone and nobody waits).
- **Multiplayer SDK features** [x] invite link and button, [x] `isInstantMultiplayer`, [x] `updateRoom` / `leftRoom` on every room change,
  [x] the join-room listener, [x] CrazyGames usernames in game (nameplates and scoreboard). All in `public/js/platform.js`, guarded,
  so our Render site runs without the SDK (there, invites are `?room=CODE` links).
- **Devices:** **desktop only** (keyboard and mouse; the builder shows a desktop notice under ~900 px). Mobile and tablet off.
- **Orientation:** **landscape**.
- **SDK:** v3: `gameplayStart` / `gameplayStop`, `loadingStart` / `loadingStop`, `settings.muteAudio`, the game module's multiplayer
  calls (above), and the User module: `getUser()` (the username), `getUserToken({ signingKeyType: 'IN_GAME_AUTH' })` and
  `addAuthListener` (round 18 saves). No ads.
- **Progress save:** [x] **"linked to a game account on the game's backend, associated with the CrazyGames User"** (round 18: Supabase,
  through our server only; guests keep local saves in the browser). Round 26 adds XP, level, unlocks and daily challenges to the same
  account row (`wizard_arena_player_progress`), and anonymous drop-off events (`wizard_arena_events`: session, join, kills, match end,
  disconnect; no IPs or emails; the key stays on the server). Mention both in the form's data-collection answers.
- **Age:** PEGI 12-friendly (fantasy magic, no blood; skeletons collapse). CrazyGames' audience is 13+.

### 3. Re-making the art
`WA_DEBUG=1 PORT=4105 node server.js` from the approved commit (a private port, never live), then
`python3 deploy/capture_store.py http://localhost:4105 dist/store --stage` (about 3–4 min headless). `--stage` uses the debug
`debugPlace` hook to stand our wizard in the open for the hero and about 9 m from a bot for the gameplay frames, and
`--only hero,vista,overhead,ground,wallwalk,gameplay` retakes single shots. Shots vary run to run (bots, spells, deaths):
look at them and keep the best of each.

### 4. Review risks
- **Open, Ty's call: "land in gameplay within 1 click"** (gameplay requirements). A first visit is the how-to-play card ("Got it", or
  Enter), the builder's "Enter" button (a default loadout and a random name are already filled in), then "Click to play" for pointer lock. The lock click is unavoidable and
  usually accepted as the one click; the card is the extra one. Options: let Enter on the card also join, or show the card over the first
  match instead (characters, select.js).
- **Done:** names go through a profanity filter on the server (`rudeName` in `join`, spells). The goat tip in the how-to-play card is now
  the ram tip. No Pixabay files left (`public/sounds/CREDITS.md`, round 15 "Flasks and potions"); everything is CC0 or CC BY 4.0
  (Leonardo Calvo, credited in-game and in the README).
- **Privacy note** (round 18, updated round 26, characters, behind the "?"; the full text is in the form section above): for logged-in CrazyGames users we store the CrazyGames username and ID,
  saved spells and settings, and match stats, to keep their progress; guests' data stays in the browser; deletion requests to Ty's
  address. Check it's in the build before submitting.
- **Done (round 17): "online with friends"** is required for an online multiplayer game, not optional: rooms, invite links and room
  data through the SDK, CrazyGames usernames. See the QA note below.

### 5. How invites work (paste into the form's notes for QA)
```
Wizard Arena is a 4-player free-for-all, first to 10 kills or 5 minutes; skeleton bots fill every empty seat, so a match starts at once
with 1 player. Matches alternate between two arenas (the courtyard, then the Sky Ruins); a private room's host can lock one.
- Play: joins a public match (the fullest public room with a free seat).
- Create private match: makes a private room with a short code (shown in the corner and in the Esc menu). "Invite friends"
  copies the CrazyGames invite link; friends who open it land straight in that room, with no extra click. Up to 4 friends
  per room; bots fill the rest.
- Join with code: type a friend's code on the start screen.
- Instant multiplayer: launched as a party leader, the game skips the start screen, opens a new private room and shows
  the invite options.
- An invite clicked while already playing moves you to that room.
- Logged-in CrazyGames players play under their CrazyGames username; guests get a random wizard name.
```

### 6. How saves work (paste into the form's notes for QA)
```
CrazyGames users are logged in automatically via getUserToken, verified server-side against CrazyGames' JWKS; guests play with
local saves; there are no other logins.
```
Before the upload: Render needs `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (Ty set both in the dashboard; `render.yaml` lists them with
`sync: false`, so a Blueprint sync keeps them). Without them the server runs, and everyone is a guest. Optional: `CG_GAME_ID`
(saves.js then also checks the token's `gameId`). The build fails if a secret ends up in it (`sb_secret_`, `SUPABASE_SECRET`,
`service_role`, the key's value when the shell has it, `.env` or server files).

## Round 14: the CrazyGames build
**Build:** `npm run build:crazygames -- --ref HEAD` (use `--ref` for the upload, so only committed files ship; without it the
working tree is used and uncommitted changes under `public/` are listed as a warning). Output: `dist/crazygames/` and
`dist/crazygames.zip` (index.html at the zip's root; `dist/` is gitignored). `tools/build-crazygames.mjs` does this:
- copies `public/` without the map editor (`edit.html`, `js/editor.js`)
- makes every URL relative: anything still root-absolute in the sources is rewritten in the copy and listed as a warning,
  and the build fails if one survives. The per-owner list for fixing the sources is in `requests.md`
  ("deploy → spells, characters, environment").
- vendors three.js: only the files the client imports, followed through the addons' own imports (5 files today:
  three.module.js (the minified build), GLTFLoader, BufferGeometryUtils, SkeletonUtils, meshopt_decoder), plus three's LICENSE
- writes `config.js` with `window.WA_SERVER = 'wss://wizard-arena-76od.onrender.com'` (`--server` to change it). net.js
  doesn't read it yet, so the build patches that one line in its copy until spells adds `window.WA_SERVER ||`.
- adds the SDK (`https://sdk.crazygames.com/crazygames-sdk-v3.js`) and `deploy/crazygames/platform.js`, the guarded shim:
  `SDK.init()`, `loadingStart` / `loadingStop` (at main.js's "Ready…"), `gameplayStart` while the HUD is up and none of
  `#clickToPlay`, `#lockPrompt` or `#mEnd` shows, `gameplayStop` otherwise. Every call is in try/catch; with no SDK it's a
  no-op. `?cgdebug` logs each event to the console. Our own site never loads either file.
- checks CrazyGames' limits and prints files, sizes and the largest files.

**Server:** the `ws` server has no Origin check, so sockets from CrazyGames' domains are accepted. The CrazyGames build makes
no cross-origin HTTP requests (every file comes from CrazyGames' host; only the socket goes to Render), so no CORS
change was needed. The map editor: `/?edit=1`, `/edit.html`, `/js/editor.js` and `/api/map/models` answer 404 without
`MAP_EDIT=1` (environment's `28b023b`; checked on my port 4105: 404, 404, 404, 404, with `/`, `/healthz`, `/favicon.ico` 200).

**Favicon:** `public/favicon.ico` (16/32/48) and `public/favicon.png` (180 px), a purple wizard hat with a gold band and
star. The `<link rel="icon">` lines are requested from spells (index.html); the build adds them if missing.

**Verified (2026-10-30):**
- Build from `08d539c`: 311 files (limit 1,500), 42.0 MB unzipped, 29.8 MB zip. From the working tree with
  environment's meshopt models: 313 files, 30.4 MB unzipped.
- Initial download of the build, served from a subpath, with the working tree's meshopt models: **17.0 MB in 389
  responses** at "Ready", the same 5 s into the match (desktop limit 50 MB, mobile homepage 20 MB). Uncompressed
  transfer from a plain static server; CrazyGames' CDN may compress the text files further.
- `python3 deploy/subpath_test.py http://localhost:4199/game/` with the build served by `tools/serve-subpath.mjs` on 4199
  under `/game/` and the game server on 4105: PASS. 287 requests to the page host, none outside `/game/`, no failed
  requests, `ws://localhost:4105/` with 907 frames, the builder's 35 cards, a 4-wizard FFA "first to 15", no console errors,
  SDK shim `init ok (environment local)`, `loadingStop`, `gameplayStart`, `gameplayStop`. Screenshot `/tmp/wa-deploy/subpath.png`.
- Same with `--block-sdk` (the SDK script fails to load): PASS, the game loads and plays, no errors.
- The Render build (`wss://wizard-arena-76od.onrender.com`) served from `localhost:4198/game/`: PASS, 716 frames from
  Render, so Render accepts a socket from a foreign origin. (That joined one live match briefly as "subpath"; live still
  runs `e416f68`.) Screenshot `/tmp/wa-deploy/subpath-render.png`.
- `deploy/smoke.py http://localhost:4105`: PASS (4 players, bots Zaltar, Morgra and Ebonyx at normal, 845 frames, no errors).

**smoke.py:** the builder selectors (`.sb-row`, `.sb-card`, `.sb-presets .sb-chip`) are still current. `window.__wa` is gone
this round, so players and bots now come from the server's `snap` frames, "still connected" means frames keep arriving,
and the first-visit how-to-play card is dismissed (`.htp-close`) before joining.

The submission checklist moved to "CrazyGames submission checklist (round 15)" below.

## Pushes (each on the coordinator's go-ahead, always `git push origin <sha>:main`, fast-forward only)
`ac71367` (initial) → `16afaad` → `4b4089e` → `5c4a3c1` → `09fdfa9` → `7677394` → `4c54e6c` → `d96ee39`
→ `6b00b54` → `8d8a19b` → `29602cc`, then the coordinator pushed `e416f68` (which includes my `c52534a`). Never pushed anything newer than the approved commit or anyone's
uncommitted work. No force pushes and no history rewrites.

## Pre-publish audit (full history) and per-push re-scans
- No tokens, API keys (GitHub, Anthropic/OpenAI, AWS, Google, Slack, Render, Meshy), private keys, `.env`, `.pem`
  or `.p8` files, passwords or personal paths anywhere in history. `gitleaks` isn't installed, so I used `git log -p`
  and a regex sweep, repeated on every pushed range.
- Binaries checked on each push: Ty's `.m4a` sounds only carry Apple's gapless tag (`iTunSMPB`); `sky.jpg` has no
  EXIF/GPS (re-baked by `tools/make-sky.py`); the Meshy `.glb`s were rewritten by glTF-Transform (no task IDs, URLs or extras).
  Largest file: `public/models/farmhouse.glb`, 5.5 MB. Repo about 30 MB.
- **Public by design:** commit author lines show `Ty Swenson <tyswenson34@gmail.com>`. To hide it in future commits,
  turn on GitHub → Settings → Emails → "Keep my email addresses private" and use the noreply address.
- `.gitignore` covers `node_modules/`, logs, `.env*`, keys, OS/editor junk and local test output.

- `29602cc..e416f68` (56 commits, pushed by the coordinator): re-scanned afterwards and clean. No secrets or key files;
  the 10 new or changed binaries (`.glb`, `.webp`, `.png`) carry no EXIF/GPS/XMP/text chunks or local paths;
  largest new file `wizards/cinder.glb` at 2.1 MB.

## Render config
- `render.yaml`: `runtime: node`, `NODE_VERSION=22`, `npm ci --omit=dev`, `npm start`, `healthCheckPath: /healthz`,
  `autoDeployTrigger: commit`, `plan: standard`.
- The server binds `process.env.PORT` and listens on all interfaces. Debug hooks only switch on with
  `WA_DEBUG` / `MATCH_DEBUG` set, and Render doesn't set them. `MATCH_MODE` is optional.
- **Not pushed yet:** `render.yaml` said `plan: free` while the live service is on Standard. I changed it to
  `plan: standard` (committed locally with the README section and this file) so a Blueprint sync can't
  downgrade the service. It goes live with the next push the coordinator approves. If Ty ever wants to go back
  to free, change that line, and expect the ~15 min idle sleep and ~30 s wake-up.

## Map editor on live (e416f68)
- `/?edit=1` serves the editor page to anyone (HTTP 200), but it can't write anything there.
- `POST /api/map/layout` on live: **HTTP 403** `{"error":"map editing is off: start the server with \`npm run edit\`"}`.
  `server/mapedit.js` gates saving twice: `MAP_EDIT=1` (Render never sets it), then a loopback-only caller and a
  localhost Origin. `tools/layout-backups/` is gitignored and holds nothing tracked.

## Live verification of e416f68 (2026-10-30, `python3 deploy/smoke.py https://wizard-arena-76od.onrender.com /tmp/wa-deploy/live.png`)
```
healthz: 'ok' in 0.2s
page ready (assets loaded) in 9.6s
spell builder: {'rows': 6, 'cards': 35, 'presets': 7, 'visible': True} ok
joined: {'players': 4, 'bots': ['Zaltar (normal)', 'Morgra (normal)', 'Ebonyx (normal)'], 'status': ''}
still connected after screenshot: True
websockets: ['wss://wizard-arena-76od.onrender.com/'] {'sent': 8, 'recv': 501} ok
console errors: none
RESULT: PASS
```
- Live `index.html`, `js/main.js` and `js/select.js` byte-match `e416f68`. Screenshots: `/tmp/wa-deploy/live-builder.png`
  (35 cards including Roll), `/tmp/wa-deploy/live.png` (in the FFA: mountains, new ground, a bot already hitting).
- **Why the builder check read 0/0 before:** the selectors weren't stale (`.sb-row` / `.sb-card` are unchanged in
  `select.js`). `#joinBtn` starts *enabled* in `index.html` until `main.js` runs, and round 13's bigger module graph
  loads slowly enough that the old "button enabled" wait passed before the builder existed. `deploy/smoke.py` now
  waits for `main.js`'s own `#loadStatus` line ("Ready…", or fails on "Failed…").

## Earlier: live verification of 29602cc (2026-10-30, `python3 deploy/smoke.py https://wizard-arena-76od.onrender.com /tmp/wa-deploy/live.png`)
```
healthz: 'ok' in 0.2s
page ready (assets loaded) in 15.4s          (headless software rendering; a real browser is faster)
spell builder: {'rows': 6, 'cards': 34, 'presets': 7, 'visible': True} ok
joined: {'players': 4, 'bots': ['Zaltar (normal)', 'Morgra (normal)', 'Ebonyx (normal)'], 'status': '4 wizards online · 0 kills'}
still connected after screenshot: True
websockets: ['wss://wizard-arena-76od.onrender.com/'] {'sent': 11, 'recv': 806} ok
console errors: none
RESULT: PASS
```
- I confirmed the live `index.html`, `js/main.js` and `shared/constants.js` byte-match `29602cc`. Right after
  Render said "success", one request still hit the old instance for a few seconds during the switch-over.
- Download times from the live host: `/` 0.16 s; `three.module.js` (1.3 MB) 0.24 s; `farmhouse.glb` (5.5 MB) 0.41 s;
  `menu_music.m4a` (1.4 MB) 0.67 s. Static files are cached for 1 h (`max-age=3600`).
- Cold start: not applicable on Standard (no sleep).
- Screenshots: `/tmp/wa-deploy/live-builder.png` (join screen spell builder), `/tmp/wa-deploy/live.png` (in the FFA, "Fight!").

## Known limits and notes
- One server instance holds all matches in memory, so a deploy restarts the server and drops anyone connected
  (they refresh to rejoin).
- Licensing to keep an eye on: the menu music and the goat bleats come from Pixabay. Its license forbids
  redistributing a file "on a standalone basis", and a public repo makes them downloadable (generally accepted
  inside a game). If the Meshy models were made on Meshy's free plan, they're CC BY 4.0 and the README credits
  should name Meshy. Kenney particles are CC0 and not yet credited (no credit required).
- `deploy/smoke.py` is the re-runnable live check. It exits non-zero on any failure.

## Round 29 verification (HEAD `e31c1a4`, a clean worktree; Siege Keep; private ports, 3000 untouched; files in `/tmp/wa-deploy/r29/`)
Server `WA_DEBUG=1 MATCH_DEBUG=1 PORT=4105`; the 95aca29 / 21a31ef / 54d1a9a / HEAD builds on 4198 / 4197 / 4196 / 4199. Ty's uncommitted `layout-keep.json` was not in the worktree.
- **`perf_test.py` on the keep: PASS, all 9 targets** (60 s, 4x throttle, tier normal): 59.9 fps, p95 18.5 ms, 1 frame over 50 ms (none after 10 s), **98.6k triangles** (p95 121k;
  the 120k target is on the mean), 89 draw calls, **50 programs** (0 linked after load), no console errors. Both old failures (courtyard 121k triangles, programs 62) are gone. Shot: `perf.png`. (`--map` accepts `keep` now; one map, so it needs no flag.)
- **`smoke.py` PASS:** legacy join (courtyard, no runes), v22 join (courtyard, 4 runes and 6 pads), v24 join in a `v24` room, no round-26 messages to the old three, a proto-26 welcome with progress, first visit in 1.1 s, no console errors.
- **`subpath_test.py` PASS** (HEAD build, `--max-mb 20`): rooms, invite, old-client roomError 'version', no failed requests, 9.2 MB in 322 responses at "Ready" (`models/keep` 0.4 MB), no errors.
- **`legacy_test.py --fast`: legacy (95aca29) PASS, `--gen v22` (21a31ef) PASS, `--gen v24` (54d1a9a) PASS** on their frozen layouts (`server/legacy-maps/`): match, recap, rematch, no failed requests.
- **Size** (before = `1035762`): `public/` 11,688 → 9,544 KB (-2.1 MB); the build 12,504 → 10,340 KB; zip 8.03 → 6.75 MB (-1.28 MB, from a test zip; `dist/crazygames` is NOT rebuilt yet, waiting for Ty's final layout).
  The test build warns "untracked file shipped" for `public/shared/layout.json`, `icons/roll.png` and `icons/trapped_relic.png` (they exist in the ref but are not tracked: worth a look by their owners; harmless).
- **Left to do:** after Ty's layout is committed: `npm run build:crazygames -- --ref <sha>`, then the quick set once more on that sha.

**Short description** (round 29):
```
Start as the Pyromancer, level up to unlock five more wizards, then duel three rivals in fast free-for-alls in one castle-siege arena.
```
**Description changes** (round 29; the rest of round 27's text stands): replace the two paragraphs about the arenas with:
```
One arena, the Siege Keep: a castle under siege. Cross the drawbridge, break through the breach in the wall, climb the siege tower or ride a jump pad onto the towers, and fight from the wall-walks while catapults and trebuchets loom outside. Dodge, double-jump, take the high ground and time your shield to turn the duel.
```
and in the Arcane Grasp paragraph, "break it on the courtyard walls and the Sky Ruins' stones" becomes "break it on the keep's walls and stones". Also "ride the jump pads onto the towers and across the courtyard" becomes "ride the jump pads onto the towers". (The cover and the screens in `store/` still show the old courtyard: re-stage them on the keep before the upload.)
