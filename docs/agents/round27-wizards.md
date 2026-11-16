# Round 27 brief: wizards only (no spell builder), and Arcane Grasp for everyone

## Context
Ty: the spell-card grid (35 cards in slot rows) shouldn't appear anymore. "It should be all about the selectable
wizard and level progression to unlock the next ones. When the user hovers over it, it can go into detail about the
wizards. Get rid of Roll and Trapped Relic completely. All wizards have telekinesis to throw objects. Rename it to
something magical sounding."

**Ty's choices:**
- **Remove the custom builder entirely.** The game is the 6 wizards with fixed kits, and the 650-XP rung only unlocks
  the 6th wizard.
- **Telekinesis becomes "Arcane Grasp"** (F), the same for every wizard.

This lands **on top of round 26**: XP, levels, the wizard ladder, the Wardrobe and analytics are committed but not
pushed. Rounds 26 and 27 ship together.

## 1. Wizard-only selection UI (characters agent: select.js, select.css, index.html, podium.js)
- **Replace the builder** on the join screen and in the Esc menu with a **wizard gallery**: six large cards
  (Pyromancer, Frost Warden, Stormcaller, Hemomancer, Alchemist, Beastcaller), each with:
  - a 3D portrait, or the live preview dressed in that wizard's element look
  - the name, a one-line role ("Fire burst from range", "Freeze and wall off", …) and an element colour
  - **locked** cards greyed, with a lock, "Unlocks at N XP" and a progress bar, using round 26's ladder
  - the selected wizard highlighted; selecting one sets the loadout
- **Hover (or focus) shows a detail panel:**
  - the wizard's six abilities with key, icon, name and one-line description: LMB, RMB, R, E, F (Arcane Grasp) and Q
  - a short playstyle tip
  - the preview playing that wizard's signature cast
  - plain words, not stat soup; at most one or two numbers, and only where they help
- **Keep:**
  - the Play button
  - Create private match and Join with code
  - the Wardrobe tab
  - the level and challenges panel
  - Stats and How to play
  - voice, name and bots
- **Remove:**
  - the spell grid, slot rows, saved loadout slots, Randomize and the stat-symbol legend
  - the combos panel; combos stay automatic inside kits
- **The Esc menu** gets the same gallery, compact, with "Respawn as …".
- Must fit 1280×720 without scrolling, and be keyboard accessible.

## 2. Kits, Roll and Trapped Relic gone, Arcane Grasp (spells agent: constants.js, wizards.js, server.js, room.js, bots.js, main.js)
**The six fixed kits:** utility is **`arcane_grasp`** for everyone. Keep the internal id `telekinesis` for
compatibility and change only the display name, short name, blurb and card text. The kits:

| Wizard | LMB | RMB | R | E | Q |
|---|---|---|---|---|---|
| Pyromancer | Fireball | Meteor | Firewall | Smoke Screen | Meteor Rain |
| Stormcaller | Gale Shear | Arcane Cyclone | Tempest Veil | Blink | Eye of the Storm |
| Frost Warden | Glacial Skim | Frostfall | Glacial Bulwark | Skyward Flash | Blizzard |
| Hemomancer | Hex Shards | Blood Siphon | Sanguine Aegis | Mirror Step | Night Cage |
| Beastcaller | Shepherd's Sling | Battering Ram | Ram Guard | Ram Ride | Stampede |
| Alchemist | Potion Toss | Toxic Flask | Smoke Flask | Flask Step | Berserker Brew |

**Delete Roll and Trapped Relic completely:**
- the spellbook entries, server logic and traps
- the bot logic, client and effects code
- the HUD pips, icons, tests, the README and store text

Spark, Ward and the other non-kit spells: spells that are in no kit are no longer selectable. Leave their code alone
this round (bots use kits only) unless it's trivially dead.

**Server-side kit validation** (the current, round-27 protocol):
- A join sends a **wizard id**, and the server applies that kit.
- A loadout that isn't one of the six kits maps to the nearest kit by primary, otherwise the Pyromancer.
- Old saved custom loadouts and old clients map the same way, server-side, with no client change.
- Legacy, v22 and v24 rooms keep their own rules untouched: their builds can still pick Roll and Relic among
  themselves, and only current rooms drop them.

**Unlock gating:** the server checks the requested wizard against the player's unlocked set. Logged-in players are
checked against the account; guests are trusted client-side, as in round 26. A locked request falls back to the
Pyromancer.

**Bots:** they pick from the six kits by personality (the Brawler gets Stormcaller, the Sniper Pyromancer or Frost
Warden, and so on).

**Progression:**
- Round 26's ladder stays (0/50/200/350/500/650), with the 650 rung unlocking only the Beastcaller.
- Drop `BUILDER_UNLOCK_XP`.
- Daily challenges that referenced Relic or Roll are swapped for kit-neutral ones.

**Tests:**
- every kit is valid
- Roll and Relic are absent in current rooms
- mapping old loadouts
- a locked wizard falls back
- Arcane Grasp works for every wizard
- old generations unaffected

## 3. Deploy agent
- smoke, subpath and legacy tests for all generations, plus perf on both maps
- the store description: remove "pick any of 35 spells" and describe the six wizards to unlock
- rebuild `dist/crazygames` from the final commit

## Verification
- All unit suites ALL PASS: modematch (with MATCH_DEBUG=1), playtime, notify, saves.
- Playwright on a fresh profile:
  - the gallery shows the Pyromancer unlocked and the other five locked with XP bars
  - hover shows the ability details
  - after one match the Frost Warden unlocks and is selectable
  - F shows "Arcane Grasp" and lifts a crate as the Frost Warden
  - no spell grid anywhere (join screen or Esc menu)
  - no console errors
- Screenshots at 1280×720 and 1920×1080.
- The older CrazyGames builds still play.
- Ty plays at localhost:3000, then the push (rounds 26 and 27), the analytics and XP rows checked in Supabase, the
  rebuild, and a CrazyGames upload with the new description.
