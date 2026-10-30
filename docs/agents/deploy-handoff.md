# Deploy hand-off

## Where it lives
- **Repo (public):** https://github.com/Tswenson-hub/wizard-arena, branch `main`
- **Live game:** https://wizard-arena-76od.onrender.com
- **Render service:** `srv-dbhui1ec6qcc73f0qt70`, Standard plan (always on), auto-deploy on every push to `main`.
  Deploys show up on GitHub as deployments ("main - wizard-arena") with the Render dashboard link.
- **Live commit at hand-off:** `29602cc` (round 10 plus the round-11 spell builder and README). Deploy took ~45 s.

## Pushes (each on the coordinator's go-ahead, always `git push origin <sha>:main`, fast-forward only)
`ac71367` (initial) → `16afaad` → `4b4089e` → `5c4a3c1` → `09fdfa9` → `7677394` → `4c54e6c` → `d96ee39`
→ `6b00b54` → `8d8a19b` → `29602cc`. Never pushed anything newer than the approved commit or anyone's
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

## Render config
- `render.yaml`: `runtime: node`, `NODE_VERSION=22`, `npm ci --omit=dev`, `npm start`, `healthCheckPath: /healthz`,
  `autoDeployTrigger: commit`, `plan: standard`.
- The server binds `process.env.PORT` and listens on all interfaces. Debug hooks only switch on with
  `WA_DEBUG` / `MATCH_DEBUG` set, and Render doesn't set them. `MATCH_MODE` is optional.
- **Not pushed yet:** `render.yaml` said `plan: free` while the live service is on Standard. I changed it to
  `plan: standard` (committed locally with the README section and this file) so a Blueprint sync can't
  downgrade the service. It goes live with the next push the coordinator approves. If Ty ever wants to go back
  to free, change that line, and expect the ~15 min idle sleep and ~30 s wake-up.

## Live verification of 29602cc (2026-10-30, `python3 deploy/smoke.py https://wizard-arena-76od.onrender.com /tmp/wa-deploy/live.png`)
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
