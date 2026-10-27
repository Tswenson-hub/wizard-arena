# Shared rules for parallel agents (Wizard Arena, round 3)

Two agents work in the same git working tree at `~/wizard-arena` at the same time:
**environment** (farmstead map) and **gameplay** (spell loadouts). A coordinator (the Claude
session that wrote these briefs) merges, runs final verification and talks to Ty.

## Read first
- `README.md`: what the game is, controls, architecture.
- `public/shared/map.js`: map layout. `COLLIDERS` is the single list of solid circles
  `{x, z, r, h, kind}` that **every** system collides against (players, bots, goats, projectiles
  pass over anything lower than `h`, line-of-sight checks ignore colliders shorter than `LOS_HEIGHT`).
- `public/shared/constants.js`: gameplay tuning; it re-exports everything from `map.js`.

## File ownership (strict)
| Agent | Owns (may edit) |
|---|---|
| environment | `public/shared/map.js`, `public/js/world.js`, `public/js/goats.js`, `server/goats.js`, `public/models/*`, `tools/optimize-models.sh`, new files under `public/js/env/` if you want them |
| gameplay | `public/shared/constants.js`, `server.js`, `server/bots.js`, `bot.js`, `public/js/main.js`, `public/js/wizard.js`, `public/js/effects.js`, `public/js/audio.js`, `public/js/input.js`, `public/js/net.js`, `public/index.html`, `public/css/style.css`, `public/sounds/*` |
| coordinator | `README.md`, `docs/agents/*` (except your own hand-off and `requests.md`), `tools/test/*`, `package.json` |

Need a change in a file you don't own? Append it to `docs/agents/requests.md`
(`## <from> → <to>: <one-line title>` + what and why), keep going, and check that file now and then
for requests addressed to you. Never edit the other agent's files, even for a one-liner.

## Git
- Commit only your own files: `git add <paths>` explicitly, never `git add -A` / `git commit -a`.
- Small commits with clear messages, ending with the line
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Don't rebase, reset, stash, amend or force anything: the other agent is committing into the same tree.
- If `git commit` fails because of the index lock, wait a few seconds and retry.

## Running and testing
- Your own server port: **environment 4102, gameplay 4101**. Start it with
  `PORT=410x node server.js` (background) and restart it after server-side changes.
  Port 3000 belongs to Ty. Don't stop or restart it.
- Headless balance check: `node tools/test/botmatch.mjs <port> <seconds> hard normal easy`
  (adds bots without joining; prints kills/deaths, hits, where props landed, goat events).
- Browser checks: Python Playwright (`python3`, already installed), headless Chromium against your
  port. `window.__wa` exposes `{ input, net, local, players, props, goats, effects, scene, camera, sfx }`.
  Pointer lock doesn't work headless: set `__wa.local.yaw/pitch` directly, use `page.keyboard`
  for keys, and send actions with `__wa.net.send(...)` where a mouse click would be needed.
  `tools/test/goat_e2e.py` is a worked example. Put screenshots and scratch files in `/tmp/wa-<agent>/`.
- Before every commit: `node --check` on changed JS, and a botmatch run if you touched anything
  the server loads. Look at your screenshots. Don't assume a visual change is right.

## Done
Write `docs/agents/<agent>-handoff.md`: what you built, how you verified it (numbers and screenshot
paths), known issues, and anything the other agent or Ty must know. Commit it, then stop.
