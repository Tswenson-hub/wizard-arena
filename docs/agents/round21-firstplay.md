# Round 21 brief: first play drops you straight into a match (conversion)

Ty: "On the very first play, a user should be immediately dropped into the game with the fire wizard. After playing for
some small amount of time, an on screen prompt can advise them to pause in order to change class and wizard. The
initial homescreen is likely overwhelming and hurting conversion."

## First visit
**"First visit"** means none of the following:
- `waPlayedOnce` in localStorage
- a saved or last loadout
- for a logged-in CrazyGames player, a profile with `matches > 0`

The CrazyGames username check is asynchronous, so don't wait more than about 1.5 s for it. If unsure, treat it as a
first visit.

**Flow:**
1. The loading screen shows as today, then the builder is **skipped**.
2. **Auto-join a public match** with the **Pyromancer** preset (Fireball, Meteor, Firewall, Smoke Screen, Telekinesis,
   Meteor Rain).
   - The name is the CrazyGames username, or the usual random `WizardNNN`.
   - The male voice default is fine.
3. The arena renders straight away behind the existing **Click to play** prompt. That click, which pointer lock needs,
   is the only click before playing. Restyle the prompt for the first visit as a big friendly "Click to start" with the
   one-line goal "First to 15 kills wins".
4. **First-match bots:** if matchmaking opens a new public room for a first-timer, its bots are **Easy**, so a new
   player can win their first fights. If they join a room with other humans, the room's difficulty stands.
5. Set `waPlayedOnce` once they've played for 10 s.
6. **No how-to-play modal on the first visit.** Instead, an **in-game controls strip** fades in at the bottom for the
   first ~25 s:
   - WASD move · Mouse aim · Left click Fireball · Right click Meteor · Space jump (twice to double jump) · Q ultimate
     when charged
   - It hides early once the player has moved and fired. It's re-openable via "?" in the Esc menu.

**Precedence is unchanged:** an invite link (`?room=` or `inviteParams`) and CrazyGames `isInstantMultiplayer` still
win. They join their room directly; a first-timer joining one also gets the Pyromancer preset and no builder.

## The "change your wizard" prompt
- A toast near the top centre, with Esc shown as a key: **"Press Esc to change your wizard and spells"**, plus a small
  subline "Six ready-made wizards, or build your own".
- It appears after **about 75 s of play** or the **first death**, whichever comes first. It stays about 8 s and doesn't
  block play.
  - On the death screen, the same line shows under "Respawning…".
- It shows **once per visit,** up to the player's 3rd visit, then stops. Count visits in localStorage.
- **The first time Esc opens the menu after a first visit:** pulse the presets row (Pyromancer, Stormcaller, Frost
  Warden, Hemomancer, Beastcaller, Alchemist) with a small header "Try another wizard", and make **Respawn with these
  spells** the obvious button.
- **Podium after the first match:** a "Try another wizard" button that opens the Esc builder.

## Returning players
- Unchanged: the builder with **Play**.
- **Do make the builder less overwhelming on open:** the presets row and Play should be the most visible elements. The
  full spell grid can stay, but give it less visual weight. No big redesign this round.

## Who
| Agent | Files and work |
|---|---|
| Spells (`gameplay` pane) | main.js / net / platform hookup: the first-visit detection and auto-join, Easy bots for a first-timer's new public room (server matchmaking), timing the prompt (75 s or first death), the visit counter |
| Characters | select.js / select.css / podium.js / index.html: the "Click to start" first-visit styling, the in-game controls strip, the toast, the death-screen line, the pulsing presets and "Try another wizard" in the Esc menu, the podium button, and the returning-player builder emphasis |

Agree the hooks in requests.md first (for example `Select.firstVisit()`, `Select.showChangeWizardHint()`,
`Select.showControlsStrip()`).

## Verify
- Playwright with a fresh profile (empty localStorage):
  - the page loads, then **one click** puts you in a match with the Pyromancer loadout, in under ~12 s on the GPU
  - the controls strip shows, then fades
  - the prompt appears at the first death or at 75 s
  - Esc shows the highlighted presets
- **Second visit:** the builder shows (no auto-join), and the prompt shows again (visit 2).
- **Invite and instant multiplayer:** unchanged; extend `subpath_test.py` if needed.
- Unit tests ALL PASS; `perf_test.py` doesn't regress; the smoke and subpath tests pass.
- Then Ty plays it, then the push and the `dist/crazygames` rebuild, then Ty submits a new version.
