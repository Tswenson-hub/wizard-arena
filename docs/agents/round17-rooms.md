# Round 17 brief: rooms and CrazyGames multiplayer (blocks the submission)

## Why
The CrazyGames form for an online multiplayer game says games "will not be accepted" without:
- **invite link and button functionality**
- **IsInstantMultiplayer support**, so a party leader can create or join a lobby directly

Their docs add three more points:
- usernames must be shown in game
- room info is passed through the SDK (`updateRoom`)
- an invited user should be joinable right after launch

Today the server runs **one** shared match, where every human joins the same game and bots fill the seats. Ty chose to build rooms before submitting.

## SDK v3 API (from docs.crazygames.com/sdk/game and /sdk/user)
```js
const G = window.CrazyGames?.SDK?.game, U = window.CrazyGames?.SDK?.user;
G.isInstantMultiplayer            // bool: launch straight into a fresh private room
G.inviteParams                    // object or null on load from an invite link
G.getInviteParam('room')          // string or null
G.inviteLink({ room: 'K7Q2' })    // -> URL string to share
G.updateRoom({ roomId, isJoinable, inviteParams: { room } })   // call on every room change
G.leftRoom()
G.addJoinRoomListener(params => ...)   // a friend invite clicked while already in the game
G.showInviteButton({ room }) / G.hideInviteButton()           // deprecated but listed; use if cheap
G.happytime()                     // a celebration moment (optional: on winning the podium)
await U.getUser()                 // { username, profilePictureUrl } or null for guests; U.isUserAccountAvailable
```
Every call must be guarded (`?.`), so the game still runs on our own Render site without the SDK. The deploy agent's existing shim in `platform.js` / `config.js` is where these belong.

## Server: rooms (spells agent: server.js, server/match.js, server/bots.js)
- **The game is split into rooms**, each with its own match, players, bots, projectiles, props and state. Refactor the module-level world into `Room` objects. Keep one tick loop that iterates the rooms.
- **Public room:**
  - The default for a plain join: matchmaking puts you in the fullest public room with a free seat; if none, it creates one.
  - It's 4 seats, with bots filling seats as now. A human joining replaces a bot.
- **Private room:**
  - Created with `{t:'join', room:'new'}`. It gets a short code (4–5 chars, unambiguous alphabet).
  - Joined by `{t:'join', room:'K7Q2'}`.
  - Holds up to 4 humans, with bots filling the empty seats, so a pair of friends still gets a 4-player match.
  - The host can choose the bot difficulty.
  - If the code is unknown or full, send a clear error and fall back to a public room.
- **Lifecycle:**
  - Rooms with no humans for 60 s are deleted.
  - The idle/spectator rules apply per room.
  - The recap and rematch work per room.
  - Stats and the match timer are per room.
- **Limits:**
  - cap the total number of rooms (e.g. 40) and the total bots, to protect the Standard instance
  - the health check reports the room count
- The protocol stays backward compatible where it's cheap. The client is updated in the same round anyway.
- **Tests (modematch-unit):**
  - two private rooms are isolated: no hits, snapshots or kill feed crossing between them
  - joining by code works
  - full and unknown codes are handled
  - public matchmaking fills one room before opening a second
  - empty rooms are cleaned up
  - bots are per room

## Client (spells agent for main.js and net; characters agent for the builder and select UI)
- **The builder gets three buttons:**
  - **Play** (public, the default; one click)
  - **Create private match**
  - **Join with code** (an input box)
- **In a private room:** the Esc menu and a small corner chip show the room code with:
  - **Invite friends**, which copies `G.inviteLink({room})` on CrazyGames, otherwise our own `?room=CODE` URL
  - optionally the SDK invite button
- **Launch rules:**
  - `G.isInstantMultiplayer`: skip the builder and join a **new private room** at once, with the saved or default loadout, then show the invite UI.
  - `G.inviteParams?.room` (or `?room=` on our site): join that room directly, with no builder click. The loadout can be changed in the Esc menu.
  - `addJoinRoomListener`: leave the current room and join the invited one.
- **On every room change** call `G.updateRoom({roomId: code or 'public-N', isJoinable: seats free, inviteParams: {room: code}})`, and `G.leftRoom()` on leaving.
- **CrazyGames usernames:**
  - If `U.getUser()` returns a user, use `username` as the player name, pre-filled and locked or defaulted.
  - It must be shown in game: the nameplates and the scoreboard already show names.
  - Guests keep the random Wizard name. The name filter still applies.
- **Optional:** `G.happytime()` when the local player places 1st on the podium.

## Deploy agent
- Update `platform.js` and the shim so the SDK multiplayer calls are guarded.
- Rebuild `dist/crazygames` and the zip.
- **Extend `deploy/subpath_test.py`:** two browser contexts, where one creates a private room and the other joins it by code. Check they share a match, plus `?room=` on our site.
- **Update the submission checklist:**
  - multiplayer ticked
  - lobby size Min 1 / Max 4 ("Online with Friends")
  - a "how invites work" note for QA
- Remove the stale "No Data or User module" line.

## Verify (coordinator)
- unit tests ALL PASS
- a 2-browser Playwright test: a private room by code, the invite link, a public match fill, and room cleanup
- the smoke test on a private port
- then Ty plays, then we push to Render together with the rebuilt zip (the protocol changes, so they must match), then Ty uploads `dist/crazygames` and submits
