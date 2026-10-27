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

Spawn AI opponents in a second terminal:

```bash
node bot.js 3       # three bots; node bot.js 3 ws://host:port for a remote server
```

## Controls

| Input | Action |
|---|---|
| `W A S D` | Move (camera-relative) |
| Mouse | Look / aim |
| `LMB` | **Spark** — quick bolt, low damage, briefly stuns the target |
| `RMB` | **Meteor** — 1.25 s wind-up, heavy damage and knockback. Being hit cancels it. |
| `Space` (hold) | **Ward** — blocks spells and thrown objects arriving from the front. Drains stamina while held and per spell blocked; if stamina runs out the ward shatters and you're staggered. |
| `E` | **Blink** — teleport 9 m in the direction you're facing (4 s cooldown) |
| `F` | Pick up the nearest object / throw the object you're carrying |
| `G` | Drop what you're carrying |
| `Tab` (hold) | Scoreboard |
| `Esc` | Release the mouse |

Crates, barrels, pumpkins, rocks and pots can be picked up and thrown (22 damage, shatters on impact)
and are destroyed by any spell that hits them. They respawn after ~18 s.

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
public/js/audio.js         Synthesized sound effects (no audio files).
public/models/wizard.glb   The Meshy wizard with all animation clips merged into one 1.4 MB file.
bot.js                     Headless AI opponents for testing.
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

Any host that runs a long-lived Node process with WebSocket support works
(Render, Railway, Fly.io, a VPS, Docker). Serverless platforms (e.g. Vercel functions) do **not**
support the WebSocket server.

```bash
docker build -t wizard-arena . && docker run -p 3000:3000 wizard-arena
```

The server reads `PORT` from the environment. Put it behind HTTPS and the client automatically
uses `wss://`.
