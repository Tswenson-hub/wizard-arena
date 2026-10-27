# Wizard Arena

A low-poly, browser-based multiplayer wizard brawler built with **three.js** and **WebSockets**.
Players duel with spells, block with a stamina-powered ward, blink around the arena, and pick up
and hurl the scenery at each other. Uses the Meshy wizard model and its seven animation clips.

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

All bots strafe, keep their preferred range, retreat behind pillars when losing, interrupt meteor
wind-ups with sparks, and use telekinesis.

## Controls

| Input | Action |
|---|---|
| `W A S D` | Move (camera-relative) |
| Mouse | Look / aim |
| `LMB` | **Spark** — quick bolt, low damage, briefly stuns the target |
| `RMB` | **Meteor** — 1.25 s wind-up, heavy damage and knockback. Being hit cancels it. |
| `Space` (hold) | **Ward** — blocks spells and thrown objects arriving from the front. Drains stamina while held and per spell blocked; if stamina runs out the ward shatters and you're staggered. |
| `E` | **Blink** — teleport 9 m in the direction you're facing (4 s cooldown) |
| `F` | **Telekinesis**: aim at an object up to 16 m away to lift it; `F` again hurls it at the crosshair. A held object floats beside you and absorbs one spell aimed at you. |
| `G` | Set the held object down |
| `M` | Mute / unmute (volume is in the `Esc` menu) |
| `Tab` (hold) | Scoreboard |
| `Esc` | Pause menu: bots, volume |

Crates, barrels, pumpkins, rocks and pots can be lifted with telekinesis and hurled (22 damage,
shatters on impact) and are destroyed by any spell that hits them. They respawn after ~18 s.
Spark stuns can't be chained: after one wears off, you're immune to spark stuns for 0.6 s.

Append `?low` to the URL to disable shadows on weak GPUs.

## How it works

```
server.js                  Node + express + ws. Authoritative for combat: spells, projectiles,
                           hits, HP, stamina, stuns, blocking cone, props, deaths/respawns.
public/shared/constants.js Tuning values shared by server and client (damage, speeds, map layout).
public/js/main.js          Client bootstrap, local player controller, camera, HUD, message handling.
public/js/wizard.js        Skinned wizard instances + animation state machine.
public/js/world.js         Low-poly arena, pillars, trees, prop mesh factories.
public/js/effects.js       Projectile visuals, particles, debris, teleport/impact effects.
public/js/net.js           WebSocket wrapper.      public/js/input.js   Keyboard + pointer lock.
public/js/audio.js         3D positional sound (HRTF panners, reverb, compressor) over the CC0
                           samples in public/sounds (see CREDITS.md there); synth fallback.
public/models/wizard.glb   The Meshy wizard with all animation clips merged into one 1.4 MB file.
server/bots.js             Server-side AI wizards (Easy / Normal / Hard).
bot.js                     CLI to add or clear bots on a running server.
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
