# Round 11: the pivot to a spell-builder dueling game (Ty approved)

## Context
Ty is pivoting the design. **Wizard Arena becomes a dueling game:** great timing, dodging spells and smoothly firing back.
His decisions:
- **No more heroes.** Every player is the **original generic wizard** (the base `wizard.glb` from the first zip, with its
  staff). Their look is tinted by the spells they choose.
- **Build your wizard:** pick **any spell for each slot** from everything we've made, fully free, one spell per slot.
  The spells are the replayability.
- **Combos stay** as cross-spell synergies (Black Death charging the Lash, the Sling calling rams, Berserker Brew halving
  cooldowns, and so on), working for whoever equips both. The builder shows a "Combo" tag.
- **Only one game type: a 4-player free-for-all.** Siege is deleted, and so is Team Deathmatch.
- **Map:** cut back the unpolished, cluttered additions, especially the **narrow covered walkways** and the haphazard
  bits. Keep the better verticality.
- **The round-10 combat changes stay** (Ty: "the combat changes are good").
- **Sound:** Ty hears nothing. The pipeline works on port 3000 (the context runs, 100 sounds decode, nothing is muted in
  a fresh browser), so his browser is most likely muted (M, which is saved in localStorage), the volume slider, the tab or
  his Mac output. Add a visible mute indicator.
- **Animations matter:** Ty will want each spell's animation right, so set up the structure for that now.

## 1. The spell builder replaces hero selection (spells and characters agents)
- **Data:** heroes go away as a gameplay concept. `WIZARDS` becomes, at most, a list of **preset loadouts** named after the
  old heroes (Cinder's, Gale's, Rime's, Vesper's, Jeb's and Embibe's kits) as one-click starting points.
  - A player's loadout is `{ primary, power, mobility, guard, utility, ultimate }`, each any `SPELLBOOK` id for that slot.
  - The server validates it with `sanitizeLoadout` (slot match), and the client saves it in localStorage.
  - The loadout changes only between lives (applied on respawn) or on the builder screen before joining.
- **Everyone is the same wizard mechanically:**
  - one walk and sprint speed (Gale's speed perk goes)
  - 100 HP, same hitbox
  - hurt and death voices from a **voice choice** in the builder (male or female, using the existing grunt sets)
- **Remove per-hero special cases** throughout `server.js`, `bots.js` and `main.js`:
  - `p.wizard` checks: Gale's Veil no-root becomes a property of **Tempest Veil** itself (`noRoot: true`); kit-based logic
    becomes spell-based
  - combos key off equipped spells: for example, Black Death's bonus damage applies to Sanguine Lash only if equipped,
    and Berserker Brew halves the cooldowns of whatever is equipped
- **The spells that existed only as hero signatures all join the pool:**
  - primaries: Fireball, Shear, Skim, Hex, Sling, Potion Toss
  - shields: Firewall, Veil, Bulwark, Black Death, Ram Guard, Smoke Flask, Ward
  - mobility: Smoke Screen, Blink, Skyward, Mirror Step, Ram Ride, Flask Step
  - power: Meteor, Cyclone, Frostfall, Lash, Battering Ram, Toxic Flask
  - utility: Telekinesis, Trapped Relic
  - ultimates: Meteor Rain, Eye of the Storm, Blizzard, Night Cage, Stampede, Berserker Brew
- **Bots** pick random full loadouts (half the time an old hero preset, half the time fully random), and the bot AI keys
  off spells, not heroes.

## 2. The builder screen (characters agent: `select.js`, `select.css`; spells agent: main.js wiring)
It replaces the hero picker on the join screen and in the Esc menu. Spells are the star.
- **Left: six slot rows** (LMB Primary, RMB Power, R Shield, E Mobility, F Utility, Q Ultimate). Each row is a strip of
  spell cards showing:
  - the spell's icon (Raven icons, already in use)
  - its name
  - its element colour
  - a one-line blurb
  - quick stats: damage, cooldown, range or duration, and wind-up, from `SPELLBOOK`
  - tags such as Projectile, Hitscan-like, Area, Wind-up, Interrupts, Combo

  The selected card is highlighted.
- **Right: a live preview** of the generic wizard, tinted by the loadout's element mix, playing the selected slot's cast
  animation when you hover a card, plus a loadout summary: element breakdown and combos active.
- **Top: presets** (the six old hero kits by name), **Randomize**, and up to **3 saved custom loadouts** in localStorage.
- **Bottom:** the voice choice (male or female), the name, and Join.
- Readable at 1280×720 and up, and usable by keyboard (arrows, Enter). Tooltips give the full stats.
- **Look by spell mix:** the dominant element(s) among the chosen spells set the robe tint and a subtle element aura on the
  generic wizard (reusing `looks.js` tint and flair code: fire ember, ice frost, wind motes, dark smoke, earth dust, acid drip).

## 3. One mode: 4-player free-for-all (spells agent takes over `server/match.js`)
- **Delete Siege and Team Deathmatch** completely: the zone code, `SIEGE_ZONES` and `SIEGE_SPAWNS` usage, teams, team
  heroes, the vote screen, the relic leftovers and the related tests. `modematch` becomes an FFA-only harness.
- **The match:** **4 players** (humans, with bots filling up to 4; a 5th human waits as a spectator, or we add room support
  later). First to **10 kills** or the most at an 8-minute cap. Warm-up, then the match, then results, then an immediate
  rematch with no vote.
- **Spawns:** 4 to 8 FFA spawn points spread to give fair duel openings; respawn picks the spot farthest from enemies.
- The server starts directly in FFA. The README and HUD are updated.

## 4. Map cleanup (environment agent)
- **Remove:**
  - the narrow covered walkways
  - the haphazard stand-in clutter (most of the grey wall and green hedge blocks)
  - anything that reads as unpolished
- **Keep the strongest verticality,** in **clean, intentional** pieces:
  - the treetop fort
  - the ruin ledges with stairs
  - the rock plateaus with steps
  - the barn, hay loft and silo link, if it reads cleanly
  - the embankment road
- **Size for 4 players:** fewer, better-placed cover clusters. Sight lines moderate for duels (about 20–30 m), so dodging
  matters but there's somewhere to break line of sight.
- Re-check the FFA spawns, goats, bots' routes and screenshots.

## 5. Animation framework for spells (characters agent)
- **A per-spell animation table:** each `SPELLBOOK` entry names its cast clip, with a timing offset so the release frame
  matches the projectile spawn and wind-up length.
- Pool every clip we have from all six hero exports, retargeted onto the generic wizard: casts, throws, combos, stomp,
  drink, slash, and so on.
- Map each spell to its best current clip, and list in the hand-off **which spells still lack a good animation**, so Ty
  knows exactly what to export from Meshy next. Dueling readability depends on clear wind-up tells.

## 6. Sound check (spells agent)
- Add a **visible mute and volume indicator** to the HUD (a speaker icon, crossed out when muted). Show "Sound is muted
  (press M)" once on join if a saved mute is on.

## Who and order
| Agent | Work |
|---|---|
| Spells | §1 data, server and bots; §3 the mode (owns `match.js` now); §6; wiring the builder |
| Characters | §2 the builder UI and look-by-mix; §5 the animation table |
| Environment | §4 cleanup |

The spells agent lands the loadout data model first (API notes in `requests.md`); the builder UI follows it. The coordinator
verifies, updates port 3000, and asks Ty before pushing to Render.

## Verification
- **The builder:**
  - pick any spell per slot, save, reload and it's kept
  - presets fill all slots, and Randomize works
  - a bogus loadout is rejected by the server
- **In game:** a mixed loadout casts every slot correctly, a combo works only when both spells are equipped, and the look
  changes with the element mix.
- **The mode:** FFA only, max 4 (bots fill), first to 10, rematch; no Siege or TDM code paths left, and the unit tests are
  updated and passing.
- **The map:** screenshots show the walkways and clutter gone and clean verticality; bots move fine.
- **Balance:** 4 Hard bots with random loadouts, many short runs: no single spell dominates the kill share. Report the
  top and bottom spells.
- **Sound:** the indicator shows the mute state.
