# Gameplay hand-off: spellbook, Arcane Cyclone, Skyward Flash

Main commit: `69edf64 Spellbook loadouts: Arcane Cyclone and Skyward Flash` (plus `3b733fb`, a request in `requests.md`).
Files touched: `public/shared/constants.js`, `server.js`, `server/bots.js`, `public/js/{main,wizard,effects,audio,net}.js`,
`public/index.html`, `public/css/style.css`, `docs/agents/requests.md`. `bot.js` didn't need changes.

## What I built

### Loadouts
- `SPELLBOOK` in `constants.js`: one entry per spell (`id, slot, name, blurb, cooldown`, plus tuning). There are also `LOADOUT_SLOTS`,
  `DEFAULT_LOADOUT`, `spellsFor(slot)`, `sanitizeLoadout(want, base)` (unknown ids fall back slot by slot) and
  `hitSpec(kind)`, which resolves damage, stun, stamina and knockback for projectile kinds and spellbook ids.
  To add a spell: add a table entry, a server handler in `handle()`, and a client branch in `updateLocal()`. The picker and
  the scoreboard pick it up automatically.
- Slots: Primary (LMB): Spark only. Power (RMB): Meteor or Arcane Cyclone. Mobility (E): Blink or Skyward Flash.
- Network: `join` carries `loadout`. `{t:'loadout', power, mobility}` changes it in game. The server validates ids (bad ids
  keep the old spell) and broadcasts `{t:'loadout', id, loadout}`. `playerPublic` includes `loadout`. A slot that's mid-cast
  (meteor charging, cyclone active, or airborne in a flash) keeps its spell until the cast ends, then the pending change applies.
- Cooldowns are per slot: `p.cd.power` and `p.cd.mobility` replace `cd.heavy` and `cd.tp`, on the server, the client and the bots.
  Swapping spells doesn't reset a cooldown.
- UI: spell cards on the join screen and in the Esc menu (name, blurb, key; the selected card is gold with a ✓, and a pending one
  has a dashed border). The choice is saved in `localStorage.wizardLoadout`. The ability bar shows the equipped spell names, and
  the scoreboard has a Spells column.
- `addBot` also accepts an optional `loadout` (`{t:'addBot', difficulty, loadout:{power, mobility}}`) to pin a bot's spells.
  Otherwise each bot rolls a random loadout, which appears in the server log line.

### Arcane Cyclone (`SPELLBOOK.cyclone`)
- Message `{t:'cyclone'}` starts a 0.45 s wind-up: no ward, 2 m/s movement, and a hit or stun cancels it. Then comes a 0.5 s spin.
  One pulse at the start of the spin: radius 5.5 m (vertical reach ±2.5 m, so airborne wizards escape it), 28 damage, 0.35 s stun,
  6 m/s knockback straight outward. It goes through `applyHit()`, so a ward facing the caster blocks it for 35 stamina (and can break).
  The pulse also breaks standing props in the radius. Goats in the radius get `dizzyGoat()` if they are rearing or charging
  (the environment agent added it on request) and `angerGoat(goat, casterId, goatCtx)` otherwise.
- Server state is `p.cyclone = {start, pulseAt, endAt, pulsed}`. Broadcasts: `cycloneStart {id, p}`,
  `cyclonePulse {id, p, hits:[{id, dmg, blocked}]}`, `cycloneCancel {id}`. A refused start gets a `cycloneCancel` sent
  back so the client drops its prediction. Hits also arrive as normal `hit` messages with `kind:'cyclone'`.
- Cooldown is 5 s, starting at the pulse. A cancelled wind-up costs no cooldown, like Meteor.
- Visuals: a purple runic circle (canvas texture) grows to the full radius under the caster during the wind-up. That is the
  telegraph. The spin is two model turns over the `dash` clip, with a flat shockwave ring, a low swirling wall and motes.
  Anyone inside the radius gets camera shake. Sound: low `tk_lift` on wind-up, then `tk_throw` and `impact_big` pitched down.

### Skyward Flash (`SPELLBOOK.skyward`)
- `{t:'skyward'}`: an instant flash to 7 m, then a float down at 2.5 m/s, or 1.2 m/s while E is held. Space, or reaching 2.8 s,
  switches to a 6 m/s drop. Steering in the air is 4.5 m/s. You can spark, lift and throw from the air. You can't ward or cast
  the power spell. Cooldown 6 s from launch. Landing snaps to y = 0 with a dust puff and a thud. There's no fall damage.
- Server: `p.flightStart` and `p.flightUntil` (= start + `FLIGHT_MAX_TIME`, about 4.7 s). Outside that window the `state` handler
  forces y = 0. Inside it, y must sit between a falling ceiling (7.5 m − 1.08 m/s·t, capped at 8) and a floor (it can't fall faster
  than a drop). The flight ends when the wizard reports y ≈ 0 or the window runs out. `sanitizeOrigin` is now relative to the
  feet, so sparks from height are accepted. `killPlayer` and `respawn` clear the flight. A refused flash gets `skywardCancel`.
- The client integrates the descent on real elapsed time rather than the frame-clamped dt, so slow machines stay in step with the
  server's ceiling. Airborne wizards pass over colliders lower than their feet, and over props and goats when above 1 m.
  Every airborne wizard shows a soft shadow with a purple ring on the ground. The camera pivot already followed `local.pos.y`.
- Visuals: a light streak from the ground, a ground ring, bursts, and the blink sound pitched up.

### Bots (`server/bots.js`)
- Random loadout per bot.
- Cyclone bots rush in when the spell is ready ("dive", reduced strafing) and spin when the target is within 4.5 m and not
  warding toward them, or is stunned or busy. With `dizzyGoat` available they cyclone an incoming goat whose charge will arrive
  just after the pulse.
- Every bot treats an enemy cyclone wind-up within about 6 m as a threat after its reaction delay. It flashes up (skyward), blinks
  clear, runs out of the radius, or, for Hard bots that can't get out in time, wards facing the caster. Wind-ups are also
  "punished" with sparks, the same way meteor wind-ups are.
- Skyward bots flash up to dodge meteors, cyclones and goat charges. Normal and Hard bots also take the high ground now and
  then (6 % per decision when 7–18 m away and HP > 40). Airborne bots use the same descent physics and randomly "hold E".
  Easy bots never use mobility defensively, as before.
- Velocity tracking now includes vertical speed. `aimAt` predicts a falling target's height (clamped to chest height above
  the ground), scaled by each difficulty's `lead`.

## Verification

### Browser (Playwright, headless Chromium on port 4101)
Script: `/tmp/wa-gameplay/spellbook_e2e.py` (dummy players are raw WebSockets opened inside the page, so I could place, turn
and ward them exactly; the helper is `/tmp/wa-gameplay/dummy.js`). Last run (`/tmp/wa-gameplay/run3.json`), no console errors:
| Check | Result |
|---|---|
| Loadout survives reload (localStorage) | `spark / cyclone / skyward` selected after reload; the server's copy matched on join |
| `{t:'loadout', power:'nope'}` | ignored, power stayed `cyclone` |
| Cyclone, dummy at 4 m | HP 100 → 72, `hit {kind:'cyclone', kb:6, dir:[1,0,0]}` (straight outward) |
| Cyclone, dummy at 7 m | HP 100, not in `hits` |
| Ward facing the caster | blocked: HP unchanged, stamina 96 → 50 (35 + ward drain) |
| Ward facing away | hit: HP 72 → 44 |
| Spark during the wind-up | `cycloneCancel`, no pulse |
| Skyward peak | `local.pos.y` max 7.0 |
| Descent after 1.5 s | plain 3.58 m (≈2.3 m/s), E held 5.26 m (≈1.15 m/s) |
| Landing | y = 0 |
| Spark from 6.5 m at a dummy below | HP 44 → 35 |
| Switching in the pause menu | the server applied `power: meteor` immediately |

Screenshots, all in `/tmp/wa-gameplay/` and all looked at: `join_spellbook.png`, `pause_spellbook.png`, `scoreboard.png`,
`rune_early.png` and `rune_full.png` (the wind-up telegraph seen by a bystander), `cyclone_remote_windup.png` and
`cyclone_remote_spin.png` (shockwave, then flying debris from broken props), `cyclone_spin.png` (own view),
`skyward_remote_launch.png` (streak and ground ring), `skyward_remote_air.png` (wizard mid-air with its landing shadow),
`skyward_self.png` (own view from 7 m looking down).

Note on screenshots: swiftshader screenshots take a few hundred ms, longer than the 0.45 s wind-up. The rune shots therefore pin
the remote wizard's wind-up clock client-side (`/tmp/wa-gameplay/rune.py`). The real wind-up was checked by timing the messages.

### Botmatch
`node tools/test/botmatch.mjs 4101 90 hard normal easy`, 3 runs (random loadouts per bot):
| Bot | Kills | Deaths | Damage dealt |
|---|---|---|---|
| Hard | 5 / 3 / 7 = **15** | 1 / 1 / 2 = **4** | 434 / 480 / 790 = **1704** |
| Normal | 2 / 4 / 2 = **8** | 3 / 3 / 2 = **8** | 353 / 377 / 265 = **995** |
| Easy | 0 / 1 / 0 = **1** | 3 / 4 / 5 = **12** | 136 / 120 / 101 = **357** |

The spread holds: Hard clearly beats Normal, which beats Easy.

Loadout balance among four Hard bots, 2 × 120 s (`/tmp/wa-gameplay/match.mjs`, which also counts cyclone and skyward events):
| Loadout | K / D (run 1, run 2) | Notes |
|---|---|---|
| meteor/blink | 2/2, 3/3 | 11–12 meteors per run |
| cyclone/skyward | 4/5, 1/3 | 4–6 pulses, 1–7 wind-ups interrupted; takes 3–11 hits while airborne |
| cyclone/blink | 5/4, 6/4 | 4 of 5–6 pulses hit someone |
| meteor/skyward | 3/4, 3/3 | takes 8–10 hits while airborne |

Nothing dominates. Flash users trade safety from meteors, cyclones and goats for being a slow target in the air, and cyclone
wind-ups get punished by Hard bots.

Also checked: `node bot.js 2 hard` and `node bot.js clear` work, and the server log is clean.

## Known issues and notes for the coordinator / Ty
- **README** (coordinator-owned) still lists RMB = Meteor and E = Blink. It needs a Spellbook section (the slots, the two new
  spells, Hold E / Space while airborne) and the new messages in "How it works".
- **`tools/test/goat_e2e.py`** fails at HEAD because no goat is within its 5–22 m search from the spawn now that goats live in the
  pen (`gid` is None → `TypeError ... 'group'`). A copy that first moves the player 11 m from the pen passes
  (`/tmp/wa-gameplay/goat_e2e_near.py`: unwarded ram kills, a ward facing the goat survives). The fix belongs in the
  coordinator's harness.
- `tools/test/botmatch.mjs` counts only projectile casts, so cyclone and skyward use doesn't appear in its output. My harness
  `/tmp/wa-gameplay/match.mjs` (bots with `diff:power/mobility`, counts pulses, cancels, flashes, airborne hits) could be adopted
  into `tools/test/`.
- The camera can sit under the well's roof (about (0, 2)) and the roof fills the top of the screen. The roof is above the well's low
  collider, so the camera boom check doesn't see it. I filed this in `requests.md` for the environment agent; a roof collider with
  `h` ≈ 3 fixes it.
- The courtyard ground decals sit at y = 0.05, so my ground effects (rune, shadow, rings) are at 0.12–0.13. Anything new laid on
  the ground needs to sit above 0.05 too.
- The server's copy of an airborne wizard's height trails the client by latency (as horizontal position already does), so a
  spark at a falling wizard is judged against the server's slightly older height.
- The cyclone pulse doesn't check line of sight: it goes through a thin tree or fence post within 5.5 m. That was intentional
  for a close-range AoE, but it could be changed with `pillarBlocks` if it feels wrong.
