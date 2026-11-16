# Round 26 brief: playtime (progression, bots that feel alive, drop-off analytics)

## Context
Average playtime on CrazyGames is under 3 minutes. Ty feels the core is fun, but until multiplayer traffic grows most
matches are against bots. **He chose:** progression and unlocks, bots that feel alive, and drop-off analytics. A horde
(PvE) mode is deferred.

**Goal:**
- **A reason to play "one more match":** XP, levels, unlocks and daily challenges.
- **Bot matches that feel like real opponents.**
- **Data on exactly where players quit,** so the next fixes are targeted.

Everything must stay backward compatible with the CrazyGames builds in the store: protocol-gated as before, with older
clients ignoring new messages.

## 1. Drop-off analytics (environment agent owns `server/saves.js`; spells adds the hooks; do this first)
- **A Supabase table** `events` (session id, an anonymous id, the CrazyGames user id if logged in, client generation,
  platform, event, map, details jsonb, time). RLS is on with no policies, so the server writes it with the secret key.
  The coordinator applies the migration with the Supabase MCP.
- **Server-side events:**

  | Event | Details |
  |---|---|
  | `session_start` | platform, first visit or not, CrazyGames or web |
  | `join` | room kind and map |
  | `first_kill`, `first_death` | seconds since joining |
  | `match_end` | place, kills, deaths, length, map |
  | `rematch_stay` | the player stayed into the rematch |
  | `menu_open`, `loadout_change` | |
  | `idle_kick` | |
  | `disconnect` | **seconds played, current match state, last event** |

- **Batched** (one insert per few seconds or per disconnect), and off the game loop. No IPs, emails or names beyond
  the CrazyGames username already stored. Update the privacy note.
- **A readout:** `tools/analytics.sql` or a script with drop-off views:
  - quit before the first kill, during the first match, at the first podium or later
  - the median session length
  - kills per minute for new players
  - quits right after a death streak

  The coordinator runs it and reports to Ty after a few days of data.

## 2. Progression and unlocks
**Data and server** (spells agent: constants.js, server.js, room.js; environment agent: saves.js and the schema):
- **XP per match:**

  | Source | XP |
  |---|---|
  | Finishing a match | 50 |
  | Each kill | 10 |
  | Podium place | +30 / 20 / 10 |
  | A win | +50 |
  | First win of the day | ×2 |
  | A completed daily challenge | +100–150 |

  XP is server-authoritative and comes from the existing per-match stats.
- **Levels:** a gentle curve, about 300 XP per level, rising slowly. Show the level beside the name on the nameplate,
  scoreboard and podium.
- **Daily challenges:** three a day, a deterministic rotation from the date, for example:
  - get 5 kills with your primary
  - win a match on Sky Ruins
  - take 3 runes
  - knock someone into the void
  - use your ultimate 3 times
  - finish on the podium twice

  Track them server-side from the existing match stats.
- **Storage:**
  - **Logged-in CrazyGames players:** Supabase (`player_progress`: xp, level, unlocks, challenge state, last daily
    reset).
  - **Guests:** localStorage, merged once on login, the same way saves already merge.
  - Server-authoritative XP for logged-in players. Guests' XP is client-held; that's fine, it's cosmetic only.

**Unlocks (cosmetic only, no gameplay advantage)** (characters agent: looks.js, select.js, wizard.js):
- Robe colour palettes (beyond the element tint): crimson, midnight, emerald, gold, frost, void.
- Hats: the KayKit Mage hat variants or recolours, a crown or circlet if a piece exists.
- Staff glows.
- Spell trail colour accents.
- A title shown under the name ("Apprentice", "Battlemage", "Archmage" by level).
- About 1 unlock every 1–2 levels for the first 15 levels.
- The builder gets a **"Wardrobe" tab** (equip the unlocked items; locked ones show the level needed).
- Other players see your cosmetics. They ride in the join message under a new field, and old clients ignore it.

**The post-match screen** (characters agent: podium.js, select.js):
- After the podium: an **XP bar filling up** (+50 finish, +kills, +bonuses), level-up fanfare, **"Next unlock: Emerald
  robes at level 4"**, and the daily challenges' progress ticking.
- The rematch countdown runs alongside, so it never delays the next match.
- A small **challenge tracker** in the Esc menu and a toast when one completes in-match.

## 3. Bots that feel alive (spells agent: bots.js, match.js; characters agent: emotes and taunt visuals)
- **Adaptive difficulty per human:**
  - Track a rolling performance score (K/D and placement over the last 3 matches, plus the first-visit flag).
  - **Nudge the room's bot skill** to keep a new player near **40–60%** podium-or-better.
  - It adjusts aim error, reaction time and aggression within the Easy–Hard band, not by cheating.
  - Public rooms with several humans use the average.
- **Personalities** (one per bot, visible in behaviour):
  - **Brawler:** rushes, melee range, Gale Shear and Cyclone kits
  - **Sniper:** keeps range, Spark and Meteor, uses high ground
  - **Trickster:** blinks, Mirror Step, traps
  - **Support/healer:** Blood Siphon, Sanguine Aegis, Night Cage
  - **Showboat:** runes and jump pads, taunts a lot

  Loadouts are matched to the personality.
- **Human-like touches:**
  - varied reaction times
  - occasionally chasing the last player who hit them (grudges)
  - retreating to heal at low HP
  - grabbing runes
  - not all ganging up on the human
- **Emotes and taunts:**
  - a few emote animations from the KayKit clips (Cheering, Waving, Skeletons_Taunt) played after a kill or a
    multikill, sometimes
  - short speech-bubble lines over bots from a curated, harmless pool ("Too slow!", "My fireball!", "Nice dodge")
  - rare, with a cooldown, and toggleable in settings
  - the same emotes available to the player on a key (V), for fun
- **Names** stay skeleton-themed. Personality titles show on the scoreboard ("Grimshank the Sniper").
- **Target:** with adaptive difficulty on, a new-player sim (an Easy-level human proxy) lands in the 40–60% band after
  3 matches. Bots still never walk into the void, and there's no rubber-banding.

## Who
| Agent | Work |
|---|---|
| Environment | the `events` table, `player_progress` table and saves.js extensions (migrations posted for the coordinator); the analytics readout script |
| Spells | the server hooks for events, XP and challenges, adaptive difficulty and bot personalities |
| Characters | the Wardrobe, cosmetics, level and title on nameplates, the post-match XP screen, emotes and bubbles, the challenge UI |
| Deploy | tests across the three client generations, perf, the rebuild and the checklist, and the privacy note in the store description |

The brief is `docs/agents/round26-playtime.md`. The analytics land first, so data starts flowing while the rest is
built.

## Verification
- Unit tests ALL PASS, with new tests for:
  - XP maths and levels
  - the daily rotation and challenge completion
  - the guest-to-account merge
  - events batching (stubbed Supabase)
  - adaptive difficulty moving bot skill in the right direction
  - old clients unaffected (legacy, v22 and v24)
- Supabase (via the MCP): the migrations are applied, a test session writes events and progress rows, and then they're
  deleted. The security advisor shows nothing new.
- Playwright:
  - a first visit plays a match, then the XP bar fills, then the level-up, then the unlock teaser
  - the Wardrobe equips an unlock and it's visible to a second client
  - an emote and a taunt bubble show
  - no console errors
- `perf_test` on both maps still passes, with the shader budget kept (cosmetics reuse the existing programs).
- Ty plays on localhost:3000, then the push, the `dist/crazygames` rebuild and a CrazyGames upload. A week later, the
  coordinator runs the drop-off readout and reports.
