# Wizard Arena

A low-poly, browser-based multiplayer **wizard duelling** game built with **three.js** and **WebSockets**.
There are no fixed heroes: every player **builds their own wizard** by choosing one spell for each of six
slots from the full spellbook, then fights in a **four-player free-for-all** where timing, dodging and
firing back cleanly decide the duel. The arena is a wizard's farmstead with high ground, cover, throwable
scenery and short-tempered goats.

## Quick start

```bash
npm install
npm start           # http://localhost:3000
```

Open the URL, build a wizard, and enter. Bots fill any empty places up to four.

### The match

- **Free-for-all, four wizards**, first to **10 kills** or the most kills at the **8-minute** cap.
- A short warm-up, then the match, then results for 8 s and an **automatic rematch**.
- Humans take places first; bots fill the rest (difficulty on the join screen). A fifth human spectates
  until a place opens.
- You respawn after 3 s at the spawn point farthest from your enemies.

### Playing alone and bots

Pick the bot difficulty on the join screen. Bots build random loadouts (half the time one of the presets),
lead their shots, dodge, ward, use the high ground, jump, crouch and grab potions. From a terminal:

```bash
node bot.js 3 hard                    # add bots (the match keeps to four wizards)
node bot.js clear                     # remove them
```

## Build your wizard

The join screen (and the `Esc` menu) is the **spell builder**: six rows of spell cards, one per slot. Every card
shows the spell's element, damage, cooldown, range, wind-up and tags (Projectile, Area, Wind-up, Interrupts,
Combo...). The preview wizard on the right takes on the colours of your spells' dominant element.

- **Presets**: one click loads the six original kits (Cinder's, Gale's, Rime's, Vesper's, Jeb's, Embibe's).
- **Randomize** rolls a full loadout. **Three save slots** keep your favourites in the browser.
- **Voice**: male or female hurt and death voices.
- Loadout changes made in game apply at your next respawn.

| Slot | Key | Choices |
|---|---|---|
| Primary | `LMB` | Spark, Fireball, Glacial Skim, Gale Shear, Hex Shards, Shepherd's Sling, Potion Toss |
| Power | `RMB` | Meteor, Arcane Cyclone, Frostfall, Sanguine Lash, Battering Ram, Toxic Flask |
| Shield | `R` | Ward, Firewall, Glacial Bulwark, Tempest Veil, Black Death, Ram Guard, Smoke Flask |
| Mobility | `E` | Blink, Skyward Flash, Smoke Screen, Mirror Step, Ram Ride, Flask Step |
| Utility | `F` | Telekinesis, Trapped Relic |
| Ultimate | `Q` | Meteor Rain, Eye of the Storm, Blizzard, Night Cage, Stampede, Berserker Brew |

**Combos** work for anyone who equips both spells: Blood Lash (Black Death + Sanguine Lash), Hot Brew (Berserker
Brew + Potion Toss), Strong Brew (Berserker Brew + Toxic Flask), Hail from Above (Skyward Flash + Frostfall cast
mid-air) and Herd Call (Shepherd's Sling + Ram Guard). The builder tags them.

Primaries fire in a rhythm (two or three shots, then a reload); only the last shot of the rhythm stuns and
interrupts. Casting roots you briefly; movement spells don't. Ultimates charge from damage and time and have
an interruptible 1.3 s wind-up.

## Controls

| Input | Action |
|---|---|
| `W A S D` | Move (camera-relative) |
| Mouse | Look / aim |
| `LMB` / `RMB` | Primary / power spell |
| `R` | Shield (hold or tap, depending on the spell) |
| `E` | Mobility spell (Skyward Flash in the air: hold `E` to float slower, `C` to drop) |
| `F` | Utility: telekinesis lifts an object or goat up to 16 m away; `F` again hurls it |
| `G` | Set a held object down |
| `Q` | Ultimate (when charged) |
| `Space` | Jump (also pulls you up onto ledges just out of reach) |
| `C` / `Ctrl` | Crouch (`C` toggles, `Ctrl` holds): low cover hides you |
| `Shift` | Sprint |
| `T` | Reload early |
| `M` | Mute / unmute (a "muted" badge shows when sound is off; volume is in the `Esc` menu) |
| `Tab` (hold) | Scoreboard |
| `Esc` | Menu: spell builder, bots, sound |

## The arena

A wizard's farmstead built around a stone altar blasted open by an old spell. High ground (ruin ledges, rock
plateaus, the treetop fort, the barn, hay loft and silo, the embankment road) is reached by stairs, ramps,
ladders and ledge grabs. Cover clusters break up the sight lines. Health potions (35 HP, back after 20 s) sit on
contested spots, and you regenerate after 5 s without taking damage.

Crates, barrels, pots, hay and goats can be lifted with telekinesis and hurled: a hit knocks the target down.
**Goats** graze in their pen; hit one with a spell and it charges you, and a charging goat kills in one hit
unless your shield faces it.

Append `?low` to the URL for lighter graphics on weak GPUs.

## How it works

```
server.js                  Node + express + ws. Authoritative for combat: spells, projectiles,
                           hits, HP, stamina, stuns, blocking cone, props, deaths/respawns.
public/shared/constants.js Tuning shared by server and client: SPELLBOOK (every spell's slot, blurb and
                           numbers), speeds, stamina. Re-exports map.js.
public/shared/map.js       Map layout: arena radius, COLLIDERS (every solid thing as a circle with a
                           height: movement hits all of them, spells fly over low ones), props,
                           goats, spawn points.
public/js/main.js          Client bootstrap, local player controller, camera, HUD, message handling.
public/js/wizard.js        Skinned wizard instances + animation state machine.
public/js/select.js        The spell builder (slot rows of spell cards, presets, saves, preview).
public/js/looks.js         The generic wizard body, its tint and aura by element mix, retargeted clips.
public/js/spellanim.js     Per-spell cast animation table (which clip, timed to each spell's release).
server/match.js            The four-player free-for-all: warm-up, first to 10, results, rematch.
public/js/world.js         The farmstead: ground, sky, buildings, high ground, cover, grass,
                           Meshy model loading (FARM_MODELS), prop mesh factories.
public/js/effects.js       Projectile visuals, particles, debris, teleport/impact effects.
public/js/net.js           WebSocket wrapper.      public/js/input.js   Keyboard + pointer lock.
public/js/audio.js         3D positional sound (HRTF panners, reverb, compressor) over the
                           samples in public/sounds (see CREDITS.md there); synth fallback.
public/models/wizard.glb   The Meshy wizard with all animation clips merged into one 1.4 MB file.
public/models/*.glb        Meshy goat, potion barrel and farmhouse, shrunk for the web with
                           tools/optimize-models.sh (the farmhouse went from 222 MB to 5.5 MB).
public/js/goats.js         Goat visuals (procedural grazing / rearing / galloping / dizzy).
server/goats.js            Goat state machine: graze/wander in the pen, windup, charge (leaping the
                           fence), ram, dizzy, return home through the gate.
server/bots.js             Server-side AI wizards (Easy / Normal / Hard).
bot.js                     CLI to add or clear bots on a running server.
tools/test/                Headless checks: modematch (FFA), loadoutbalance (spell kill shares),
                           modematch-unit (match rules), botmatch, goat browser test.
docs/agents/               Briefs and hand-off notes from the parallel environment/gameplay build.
```

Clients own their own movement and report position 20×/s; the server sanity-checks speed and
owns everything that affects other players. Projectiles are simulated on the server for hit
detection and mirrored deterministically on clients for smooth visuals.

### Tuning

Everything balance-related — damage, stun length, cooldowns, stamina drain, block cone, teleport
distance, map layout and prop placement — lives in `public/shared/constants.js`.

### Animation clips

The GLB was assembled from the Meshy exports with `@gltf-transform`: the rigged character plus the
`Running`, `Walking`, `Stand_Dodge_2` (used as the hit flinch), `Stand_Dodge_3` (blink + its opening
second doubles as the idle stance), `Two_Handed_Parry` (ward), `Charged_Spell_Cast` (meteor) and
`mage_soell_cast` (spark) clips, with textures resized to 1024 px WebP.

## Deploying

**Live:** <https://wizard-arena-76od.onrender.com>. Send that link to friends: it runs in any desktop
browser, no install, and up to four people share one free-for-all (bots fill the empty seats).

**Not on Vercel.** The game needs a long-running Node process that holds WebSocket connections open;
Vercel's serverless functions can't do that. Any host that runs a normal Node server works.

### Render (how the live site runs)

- Source: <https://github.com/Tswenson-hub/wizard-arena> (public), branch `main`.
- `render.yaml` describes the service: Node 22, `npm ci --omit=dev`, `npm start`, health check at
  `/healthz`, plan **Standard** (always on, no sleep).
- **Auto-deploy:** every push to `main` builds and goes live in about a minute, with zero downtime (Render
  switches over once `/healthz` answers). So push only commits you've verified.
- On the **free** plan instead, the service sleeps after ~15 minutes with nobody connected and the first visit
  afterwards takes ~30 s to wake it.
- Check a deploy: `python3 deploy/smoke.py https://wizard-arena-76od.onrender.com /tmp/live.png`
  (health check, spell builder, join the 4-player FFA, `wss://` traffic, no console errors).

To host your own copy: fork the repo, then in the [Render dashboard](https://dashboard.render.com)
**New → Blueprint**, pick the fork, **Apply**. Railway and Fly.io work the same way (Fly can use the
included `Dockerfile`).

```bash
docker build -t wizard-arena . && docker run -p 3000:3000 wizard-arena
```

The server reads `PORT` from the environment.

## Credits

- **Characters, props and scenery:** made by Ty with Meshy AI.
- **Spell models and textures:** the Glacial Bulwark ice wall (`models/ice_wall.glb`) and the Toxic Flask acid puddle
  (`textures/fx/acid_puddle.webp`, cut out of a concept render) were made by Ty with Meshy AI.
- **Magic sound effects:** *Magic Spell SFX Soundpack* by **Leonardo Calvo** ([thesoundrack](https://thesoundrack.itch.io/freemagicspellsfx)),
  licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Clips were trimmed, loudness-matched and re-encoded.
- **Other sound effects:** *Basic Spell Impacts* (lentikula, CC0), *80 CC0 RPG SFX* (OpenGameArt, CC0), Kenney audio packs (CC0),
  and effects and music supplied by Ty from Pixabay (Pixabay Content License).
- **Menu music:** "Nordic Fantasia" by turning_pages (Pixabay).
- Per-file sources and licences: [`public/sounds/CREDITS.md`](public/sounds/CREDITS.md).
