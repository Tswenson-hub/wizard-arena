# Wizard Arena

A low-poly, browser-based multiplayer wizard brawler built with **three.js** and **WebSockets**.
Wizards duel across a farmstead with a spellbook of their choosing, block with a stamina-powered
ward, hurl the scenery at each other with telekinesis, and try not to anger the goats.
Uses the Meshy wizard model and its seven animation clips.

## Quick start

```bash
npm install
npm start           # http://localhost:3000
```

Open the URL in two browser windows (or send it to friends on your LAN) and enter the arena.

### Playing alone

Pick a number of practice bots and a difficulty on the join screen, or press `Esc` in game and use
**+ Easy / + Normal / + Hard**. Bots run on the server, so they work on a hosted copy too, and they
leave when the last human does. From a terminal:

```bash
node bot.js 3 hard                    # add three Hard bots (max 6)
node bot.js 2 easy wss://your-app.onrender.com
node bot.js clear                     # remove them
```

| Bots | Reaction | Aim | Leads shots | Dodges |
|---|---|---|---|---|
| Easy | 0.45 s | ±7° | no | 25%, never blinks |
| Normal | 0.25 s | ±3.5° | partly | 60%, blinks away from meteors |
| Hard | 0.12 s | ±1.2° | fully | 90%, blinks, wards, punishes wind-ups |

All bots strafe, keep their preferred range, retreat behind cover when losing, interrupt wind-ups
with sparks, and use telekinesis. Each bot rolls a random spellbook: cyclone bots close in and spin,
flash bots escape upward, and all of them lead shots at falling targets.

## Controls

| Input | Action |
|---|---|
| `W A S D` | Move (camera-relative) |
| Mouse | Look / aim |
| `LMB` | **Spark** — quick bolt, low damage, briefly stuns the target |
| `RMB` | **Power spell** from your spellbook: Meteor or Arcane Cyclone (below) |
| `Space` (hold) | **Ward** — blocks spells and thrown objects arriving from the front. Drains stamina while held and per spell blocked; if stamina runs out the ward shatters and you're staggered. |
| `E` | **Mobility spell** from your spellbook: Blink or Skyward Flash (below). In the air: hold `E` to float slower, `Space` to drop |
| `F` | **Telekinesis**: aim at an object up to 16 m away to lift it; `F` again hurls it at the crosshair. A held object floats beside you and absorbs one spell aimed at you. |
| `G` | Set the held object down |
| `M` | Mute / unmute (volume is in the `Esc` menu) |
| `Tab` (hold) | Scoreboard |
| `Esc` | Pause menu: spellbook, bots, volume |

### Spellbook

Choose a spell for each slot on the join screen or any time in the `Esc` menu (saved in your browser;
a slot that's mid-cast switches when the cast ends). Cooldowns belong to the slot, so swapping
doesn't reset them. The scoreboard shows everyone's spells.

| Slot | Spell | What it does |
|---|---|---|
| LMB | **Spark** | Quick bolt, 9 damage, short stun |
| RMB | **Meteor** | 1.25 s wind-up, then a heavy fireball: 38 damage, big knockback. Being hit cancels the wind-up. |
| RMB | **Arcane Cyclone** | 0.45 s wind-up (purple rune grows under you; you can't ward, you move slowly, a hit cancels it), then you spin and blast everything within 5.5 m: 28 damage, stun, knockback outward. Breaks objects, angers goats, and stops a charging goat cold. A ward facing you blocks it. 5 s cooldown. |
| E | **Blink** | Teleport 9 m forward. 4 s cooldown. |
| E | **Skyward Flash** | Flash 7 m straight up, then float down with full steering (hold `E` to float slower, `Space` to drop). Spark and telekinesis work in the air; ward and power spells don't. Goats and cyclones can't reach you up there, but you're a slow target. 6 s cooldown. |

### The farmstead

**+z is north.** The wizard's farmhouse stands on the north side of the yard; facing it, the goat pen
is on your left (east) and the crop field on your right (west).

- **Courtyard**: open ground in front of the house around a stone well, with hay stacks, a hand cart
  and four rune pillars as cover. The south meadow is open for long-range duels.
- **Goat pen**: picket fence with a gate, a lean-to and a water trough. Fences block walking but
  spells fly over them.
- **Crop field**: corn rows you walk between; spells fly over the plants, and explosions and
  charging goats flatten them for a while. A wizard-hatted scarecrow watches over it.
- **Tractor**: parked between the field and the yard, solid cover.

Crates, barrels, pumpkins, rocks, pots and hay bales can be lifted with telekinesis and hurled (22 damage,
shatters on impact) and are destroyed by any spell that hits them. They respawn after ~18 s.
Spark stuns can't be chained: after one wears off, you're immune to spark stuns for 0.6 s.
Purple potion barrels are thrown the same way and burst in a splash.

### Goats

Four meadow goats graze in their pen. Hit one with anything (a spark, a meteor, a hurled
object, a cyclone) and it rears up for 0.7 s, leaps the fence, then charges whoever hit it at 12.5 m/s, curving after them.
**A goat that reaches you kills you in one hit** unless your ward faces it; a ward stops it but costs
50 stamina, and an empty ward shatters. Charging goats smash through objects, get knocked dizzy by
pillars and trees, and ram anyone in their way. If a goat you angered rams someone else, the kill
is yours. Blink sideways late or flash skyward to dodge one (goats pass under airborne wizards), or
hit it with an Arcane Cyclone to knock it dizzy. Afterwards it trots back to the pen through the gate.
Normal and Hard bots won't shoot through goats; Easy bots anger them by accident.

Append `?low` to the URL to disable shadows on weak GPUs.

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
public/js/world.js         The farmstead: ground, house, pen, field, tractor and stand-in meshes,
                           Meshy model loading (FARM_MODELS), prop mesh factories, crop trampling.
public/js/effects.js       Projectile visuals, particles, debris, teleport/impact effects.
public/js/net.js           WebSocket wrapper.      public/js/input.js   Keyboard + pointer lock.
public/js/audio.js         3D positional sound (HRTF panners, reverb, compressor) over the CC0
                           samples in public/sounds (see CREDITS.md there); synth fallback.
public/models/wizard.glb   The Meshy wizard with all animation clips merged into one 1.4 MB file.
public/models/*.glb        Meshy goat, potion barrel and farmhouse, shrunk for the web with
                           tools/optimize-models.sh (the farmhouse went from 222 MB to 5.5 MB).
public/js/goats.js         Goat visuals (procedural grazing / rearing / galloping / dizzy).
server/goats.js            Goat state machine: graze/wander in the pen, windup, charge (leaping the
                           fence), ram, dizzy, return home through the gate.
server/bots.js             Server-side AI wizards (Easy / Normal / Hard).
bot.js                     CLI to add or clear bots on a running server.
tools/test/                Headless bot matches (botmatch.mjs, spellmatch.mjs) and a goat browser test.
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

**Not on Vercel.** The game needs a long-running Node process that holds WebSocket connections open;
Vercel's serverless functions can't do that. Any host that runs a normal Node server works.

### Render (recommended, free tier)

1. Push this folder to a GitHub repo.
2. In the [Render dashboard](https://dashboard.render.com): **New → Blueprint**, pick the repo. It reads
   `render.yaml` (Node, `npm ci`, `npm start`, health check at `/healthz`).
3. Share the `https://wizard-arena-xxxx.onrender.com` URL. The client uses `wss://` automatically.

The free plan sleeps after ~15 minutes with nobody connected; the first visit afterwards takes ~30 s
to wake it. The paid Starter plan stays awake. Railway and Fly.io work the same way (Fly can use the
included `Dockerfile`).

```bash
docker build -t wizard-arena . && docker run -p 3000:3000 wizard-arena
```

The server reads `PORT` from the environment.
