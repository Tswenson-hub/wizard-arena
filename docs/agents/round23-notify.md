# Round 23 brief: Discord alerts when a real player is online (so Ty can join them)

Ty wants a live notification when someone is playing, so he can join and play against them. The destination is a
**Discord** channel, or a thread in it.

## Server (spells agent: a new `server/notify.js`, plus small hooks in server.js and room.js)
**Configuration** (environment variables only, never in the client or the CrazyGames zip):
- `NOTIFY_WEBHOOK_URL`: a Discord webhook.
- `NOTIFY_THREAD_ID` (optional): post into that thread, by appending `?thread_id=` to the webhook URL.
- `ADMIN_KEY`: Ty's secret.
- With no webhook set, everything is a no-op.

**When to send:**
- **A human (not a bot, not Ty) joins a public room, or a private room they made.** One post per room "session":
  - a room with no humans that gets its first human posts once
  - more joins into the same room within 10 minutes update nothing
  - at most about 1 post per 2 minutes overall
- **Optionally, a short match-end line** for rooms with at least one non-admin human: winner, kills, and who was a real
  player. Throttle it to one per room per 10 minutes.

**Message (a Discord embed):**
- "🧙 A player is in Wizard Arena". Include:
  - the room id
  - the map
  - the number of humans and their names (the CrazyGames username or the guest name)
  - the source: CrazyGames or the website (from the client's platform flag)
  - whether it's a legacy room
- **A join link:** `https://wizard-arena-76od.onrender.com/?room=<id>&admin=1`.
  - For a **legacy room**, say instead "they're on the old CrazyGames build: play at crazygames.com to meet them" (our
    new client can't join legacy rooms).
- **Never block the game loop:** fire-and-forget `fetch` with a timeout. Log failures only.

## Admin (Ty)
- `?admin=<ADMIN_KEY>` on our site stores the key in localStorage, and the client sends it with `join`.
- If the server verifies it:
  - **no notification for Ty's own joins**
  - Ty **may join a public room by id** (`room: 'public-3'`) as long as it has a free seat; today only private codes
    work
  - non-admins asking for a public id keep today's behaviour (a public match)
- Never send the key back to clients or log it.

## Tests
Unit tests against a local stub webhook (an HTTP server):
- a human join posts once
- bots don't post, and an admin doesn't post
- the throttle works
- a legacy room gets the right text
- the thread_id is appended
- with no environment variables, nothing happens
- an admin can join `public-N` and a non-admin can't

## Ship
Backward compatible. The coordinator pushes on Ty's go-ahead, and Ty sets `NOTIFY_WEBHOOK_URL`, `NOTIFY_THREAD_ID`
and `ADMIN_KEY` on Render.
