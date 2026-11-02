# Round 18 brief: player saves on Supabase, linked to the CrazyGames user

## Why
Ty picked "Yes, linked to a game account on the game's backend, which is associated with the CrazyGames User" on the
CrazyGames form. The form warns: **"Games that don't automatically log in CrazyGames users, or games that provide
external log in methods (Google, Facebook, etc...) will be rejected."**

CrazyGames' rules (docs.crazygames.com/requirements/account-integration):
- **Guests must always be able to play.** "You should always allow the user to start playing as Guest, as main
  scenario." Don't create permanent guest accounts that rely only on local data.
- **No external logins**, and no in-game logout. CrazyGames login is the only identity.
- **Logged-in CrazyGames users are logged in automatically,** with no button and no prompt. A new logged-in user gets an
  account created automatically, and can optionally carry over their guest progress.
- **Ask for the current user every time the game starts,** because several people may share one device.
- **Logout:** CrazyGames reloads the whole page. Nothing to do.
- **Account linking prompt:** optional. Only relevant if we created accounts for guests, which we don't.

Token verification (docs.crazygames.com/sdk/user):
- The client calls `await CrazyGames.SDK.user.getUserToken({ signingKeyType: 'IN_GAME_AUTH' })`, which returns a JWT.
  The SDK refreshes it; it lives 1 hour.
- The server verifies **RS256** against the JWKS at **`https://userportal.crazygames.com/.well-known/jwks.json`**,
  checking that the `kid` is `ingame-auth` and that `exp` hasn't passed. Ideally also check `gameId` once we know ours.
- The payload holds `userId`, `gameId`, `username`, `profilePictureUrl`, `iat` and `exp`.
- Use the `jose` npm package (`createRemoteJWKSet` and `jwtVerify`); it caches the keys.
- Never trust `__dangerousUserId` from the client.

## The Supabase project (created by the coordinator)
- **Project:** `wizard-arena`, ref `qrjnulueaeixyjcqwjcv`, us-west-1, URL `https://qrjnulueaeixyjcqwjcv.supabase.co`.
- **Schema** (migration `wizard_arena_player_saves`, already applied):
  - `players (id uuid, cg_user_id text unique, username, created_at, last_seen)`
  - `player_saves (player_id, data jsonb, under 64 KB)`: saved loadouts, last loadout and settings
  - `player_stats (player_id, matches, wins, podiums, kills, deaths, assists, damage, healing, potions, playtime_s,
    per_spell jsonb)`
  - `match_results (player_id, room_kind, place, kills, deaths, damage, bots_in_match, created_at)`
  - function `record_match(p_player, p_room_kind, p_place, p_kills, p_deaths, p_assists, p_damage, p_healing,
    p_potions, p_seconds, p_bots, p_per_spell jsonb)`: atomic, one call per human per match
- **RLS is on with no policies**, so only the server's secret key can read or write. The advisor's "RLS enabled, no
  policy" INFO notices are intentional.
- **Server environment variables:** `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (the service-role / secret key). Ty adds
  both on Render; locally they go in `.env`, which is gitignored. **Never ship either to the client or the CrazyGames
  zip.**
- If they're missing, saves are disabled and the game behaves exactly as now. That's the case for local dev and tests.

## Server (environment agent: new `server/saves.js`; one small hook in server.js agreed with spells in requests.md)
- `server/saves.js`, using `@supabase/supabase-js` (or plain `fetch` to PostgREST, to stay light), with:
  - `verifyCgToken(token)` → `{ userId, username }` or null
  - `loadPlayer(cg)` → upsert `players` (username, last_seen), then return `{ playerId, save, stats }`
  - `writeSave(playerId, data)`: validated (only known keys, sizes capped, loadouts through `sanitizeLoadout`) and
    debounced (at most once every 10 s per player, plus a flush on disconnect)
  - `recordMatch(playerId, row)`: called from the recap, for humans with a verified account only. Bots are never
    recorded.
- **Protocol:**
  - The client sends `{t:'auth', token}` right after connecting, and again whenever the SDK hands out a fresh token.
  - The server replies `{t:'profile', username, save, stats}`, or `{t:'profile', guest:true}`.
  - The client sends `{t:'save', data}` when the loadout or settings change.
  - All of it is asynchronous and never blocks joining. A slow or down Supabase must not delay play.
- **Rate limits:** about 1 save per 10 s and about 1 auth per 30 s per socket.
- **Privacy:** store only `cg_user_id`, username and game data. No IPs and no emails.

## Client (spells agent: main.js and net; characters agent: builder and select UI; deploy agent: the platform shim)
- **On every start**, the shim calls `U.isUserAccountAvailable`, then `await U.getUser()`.
  - **If there's a user:** get the token, send `auth`, then:
    - use the CrazyGames username as the player name (the name field shows it, read-only or prefilled)
    - load the saved loadouts and settings from the `profile` reply
    - merge guest progress once: if the local save has loadouts and the cloud save is empty, upload the local one
  - **If there's no user:** guest play, exactly as now (localStorage).
- `U.addAuthListener(user => ...)`: when a guest logs in mid-session, send `auth` and merge. Logout reloads the page.
- **No login buttons of any kind,** and no logout.
- **Builder profile chip** (characters agent), shown only for logged-in users: username, matches, wins, K/D.
- **Podium:** "Saved to your profile" for logged-in users.

## Deploy agent
- Add `jose` (and supabase-js, if used) to package.json.
- Add `.env.example` with `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, and add `SUPABASE_*` to render.yaml with
  `sync: false`, so Ty sets them in the dashboard.
- The CrazyGames build must not include any server code or keys. Add an assertion to the build script that scans the
  output for the secret key's prefix or `SUPABASE_SECRET`.
- Update the submission checklist:
  - progress save = "linked to a game account on the game's backend, associated with the CrazyGames User"
  - a short QA note: "CrazyGames users are logged in automatically via getUserToken, verified server-side against
    CrazyGames' JWKS; guests play with local saves; there are no other logins"
- **Privacy note** (characters agent, behind the "?"):
  - for logged-in CrazyGames users we store your CrazyGames username and ID, your saved spells and settings, and your
    match stats, to keep your progress
  - guests' data stays in the browser
  - deletion requests to tyswenson34@gmail.com

## Tests
- **Unit:**
  - `verifyCgToken` rejects a bad signature, an expired token and the wrong `kid`, using a locally generated RS256 key
    with a test JWKS. A test-only override is allowed when `NODE_ENV=test`.
  - `record_match` increments correctly (against a local stub, or the real project with a `test_` cg_user_id cleaned up
    afterwards).
  - saves are validated and size-capped
  - with no environment variables, everything is a no-op
- **Integration** (coordinator, against the real project): a fake verified user, through the test-key path on a
  private port only, loads, saves, plays a match and records it; the rows are checked in Supabase and then deleted.
- **Guest path:** unchanged; the smoke test passes.

## Order
Round 17 (rooms) is in progress on spells, characters and deploy. The environment agent starts `server/saves.js` now,
because it's an isolated module. The hooks in server.js and main.js land after round 17's commits, to avoid conflicts.
Push only on Ty's go-ahead, together with the rebuilt zip.
