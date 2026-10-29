# Brief: deploy agent

Read `docs/agents/shared-rules.md` (you own no game code; your files are `render.yaml`, `Dockerfile`, `.gitignore`, the
"Deploying" section of `README.md`, and anything new under `deploy/`). Then do the following.

## Goal (Ty's request)
"Commit this project to my GitHub repository and then help me get it hosted (for free) somewhere that will be playable online."
Ty's decisions:
- **The GitHub repo is PUBLIC.** The account is `Tswenson-hub`, and `gh` is already authenticated with repo scope.
- **Host on Render's free tier.** `render.yaml` already exists: Node, `npm ci --omit=dev`, `npm start`, health check `/healthz`.

## Steps
1. **Pre-publish audit, because the repo will be public.** Scan everything tracked and the full git history for secrets:
   tokens, API keys, `.env` files, `*.p8` or `*.pem`, passwords, and personal paths that leak more than a username. Use
   `git grep` and `git log -p`, or `gitleaks` if it's installed. Check `.gitignore` covers `node_modules/`, logs, `.env*`,
   OS junk and any local test output. Note the size of the largest files (none should be over 20 MB; the total repo is
   about 26 MB). Report what you found. **If anything sensitive is in history, STOP and tell the coordinator; don't rewrite
   history yourself.**
2. **Create the repo and push.**
   - Run `gh repo create Tswenson-hub/wizard-arena --public --source . --remote origin`, with a short description:
     "Low-poly multiplayer wizard brawler on a farmstead: three.js + WebSockets".
   - Push `master`/`main` (whatever the current branch is) **as it is committed**. Never commit or stage other agents'
     uncommitted work; they are still working in this tree. Don't rename the branch.
   - Afterwards, only push when the coordinator asks; pushes will auto-deploy.
3. **Hosting on Render, with Ty's clicks guided.**
   - Check `render.yaml` against Render's current Blueprint format, the free plan, health check and Node version. Make sure
     `package.json` has an `engines.node` Render accepts and the server binds `process.env.PORT`.
   - The server must survive Render's environment: no debug flags on, no reliance on local paths.
   - Render needs Ty to sign in with GitHub and approve. Write Ty **exact, numbered click-steps** in your pane and in
     `docs/agents/deploy-handoff.md`: dashboard.render.com → New → Blueprint → pick the repo → Apply.
   - If a Render API key is ever needed, Ty creates and pastes it; never print it or commit it.
   - Once Ty reports the service URL (`https://<name>.onrender.com`), **verify it end to end**:
     - `/healthz` returns ok
     - a Python Playwright headless run loads the page, joins, sees the welcome with bots added, and gets **no console errors**
     - WebSockets work over `wss://`
     - note the cold-start time after sleep
4. **Document it.** Update the README "Deploying" section: the live URL, how auto-deploy works, the free-tier sleep
   (about 15 min idle, then about 30 s to wake), and how to share it with friends. Commit only your own files, and push
   only with the coordinator's go-ahead.
5. Finish with `docs/agents/deploy-handoff.md`: repo URL, live URL, audit result, verification output, known limits.

## Don't
- Don't force-push or rewrite history.
- Don't change game code; file requests in `requests.md` if deploying needs a code change.
- Don't make the repo private, delete anything, or touch other repos.
