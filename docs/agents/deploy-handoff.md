# Deploy hand-off

## Where it lives
- **Repo (public):** https://github.com/Tswenson-hub/wizard-arena, branch `main`
- **Live game:** https://wizard-arena-76od.onrender.com
- **Render service:** `srv-dbhui1ec6qcc73f0qt70`, Standard plan (always on), auto-deploy on every push to `main`.
  Deploys show up on GitHub as deployments ("main - wizard-arena") with the Render dashboard link.
- **Live commit:** `e416f68` (rounds 12b-13: Roll on F, the map editor, Ty's assets, mountains, ground textures,
  jeb2 animations), pushed by the coordinator with Ty's approval. Earlier: `29602cc` (deploy took ~45 s).

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

## CrazyGames submission checklist (round 15, final draft)
Sources: docs.crazygames.com, "Technical requirements", "Gameplay requirements", "Game covers" and "Multiplayer" (read 2026-10-30).

### What to upload (all ready at `04fd64b`)
| What | Path | Notes |
|---|---|---|
| **Game zip** | `dist/crazygames.zip` (gitignored; rebuild with `npm run build:crazygames -- --ref <sha>`) | from `04fd64b`, 377 files, 9.4 MB unzipped, 6.6 MB zip, sha256 `c48d1a4e…5853`; talks to `wss://wizard-arena-76od.onrender.com` |
| **Cover, landscape 1920×1080** | `deploy/crazygames/store/covers/cover-hero-landscape-1920x1080.jpg` | recommended: the Mage up close in the courtyard |
| **Cover, portrait 800×1200** | `deploy/crazygames/store/covers/cover-hero-portrait-800x1200.jpg` | same frame, cropped |
| **Cover, square 800×800** | `deploy/crazygames/store/covers/cover-hero-square-800x800.jpg` | same frame, cropped |
| Alternative covers | `deploy/crazygames/store/covers/cover-vista-*.jpg` | the courtyard from above, mid-fight; same three sizes |
| **Screenshots, 1920×1080** | `deploy/crazygames/store/screens/01-overhead.jpg` … `09-ground-east.jpg` | 01 overhead, 02 wall-walk, 03–05 gameplay with the HUD (03 a Blizzard call-out, 04 two skeletons, 05 the hall), 06–09 ground level from 4 sides. Best to lead with 04, 03, 01, 02 |
| **Preview video** | not made | required: 15–20 s, 1080p landscape **and** 1080p portrait (2:3), < 50 MB, no sound, cursor, logos or black bars; open on the cover's frame. Record from a real browser (OBS); headless is too slow |

Each cover has the title only ("Wizard Arena", Cinzel Decorative) over a clean render, with no HUD, borders, logos or other text (their
rules). The three covers in each set are crops of one 2400×2400 frame, so they match. Made by `deploy/capture_store.py` (below) and
picked by eye from four runs; the raw renders are in `dist/store-r3`, `-r4`, `-r5` until `dist/` is cleaned.

### 1. Build and server
- `npm run build:crazygames -- --ref <approved sha>` (no `--allow-abs`; it must exit 0). `public/` hasn't changed since `04fd64b`, so the
  zip above stands unless something under `public/` is committed after it (rebuild then).
- Render must run the **same commit's** server (the protocol changes between rounds): the coordinator pushes it to `main` (Ty's go-ahead)
  before or with the upload. Then `python3 deploy/smoke.py https://wizard-arena-76od.onrender.com`.
- Upload `dist/crazygames.zip` as HTML5 (index.html at the zip's root).
- Limits: 250 MB total, 1,500 files, initial download 50 MB desktop / 20 MB mobile homepage, relative paths only. We're at 377 files,
  **7.7 MB initial**.

### 2. The form (ready to paste)
**Title:** `Wizard Arena`

**Short description:**
```
Build your own wizard from 35 spells and duel three rivals in a castle courtyard free-for-all.
```

**Description:**
```
Build your wizard, then prove it in the courtyard. Pick one spell for each of six slots (primary, power, shield, mobility, utility and ultimate) from a spellbook of 35, across fire, ice, wind, earth, blood, alchemy and arcane. Every combination plays differently: lob fireballs from the wall-walk, freeze a rival mid-dash, lift a crate with telekinesis and hurl it, or curse a barrel and wait.

Matches are four-wizard free-for-alls, first to 15 kills. Skeleton bots fill any empty seat instantly, so there is always a fight, on easy, normal or hard. Dodge, double-jump, roll, climb the towers for high ground and time your shield to turn the duel.

Change your loadout from the menu at any time; it takes effect on your next respawn.
```

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
- **Multiplayer:** yes, real-time online. **Lobby size: 4** (free-for-all; bots fill empty seats, so nobody waits).
- **Devices:** **desktop only** (keyboard and mouse; the builder shows a desktop notice under ~900 px). Mobile and tablet off.
- **Orientation:** **landscape**.
- **SDK:** v3, Basic Launch: `gameplayStart` / `gameplayStop`, `loadingStart` / `loadingStop`. No ads, no Data or User module.
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
- **Privacy note:** we keep the name, loadout and settings in localStorage and send the typed name to our server for the match only.
  A short note behind the "?" with a contact address covers it; Ty decides.
- **Optional, more traffic:** CrazyGames' "online with friends" (invite links and room data through the SDK, CrazyGames usernames)
  earns a place on their multiplayer landing page; not needed to submit.

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
