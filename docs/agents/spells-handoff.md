# Spells hand-off (round 4): wizards with fixed kits, five new spells, Frostfall

Commits: `eb16956` (kits and the five spells), `275d33b` (bot fixes, walls on join), `d1eb78d` (death, float, lash and
spin clips; Frostfall client), `08650c2` (Frostfall server and bots), `49b7511` (wizards.js kits: Rime power = Frostfall,
Gale mobility = Blink), plus request replies (`1d5db26`, `ec01861`).
Files: `public/shared/constants.js`, `server.js`, `server/bots.js`, `public/js/{main,wizard,effects,audio,net}.js`,
`public/index.html`, `public/css/style.css`, and the `kit` fields in `public/shared/wizards.js`.

## Kits and speeds (current)
| Wizard | LMB | RMB | E | Space | F | Run speed |
|---|---|---|---|---|---|---|
| Cinder | Spark | Meteor | **Smoke Screen** | Ward | Telekinesis | 5.3 m/s |
| Gale | Spark | Arcane Cyclone | **Blink** | **Tempest Veil** | Telekinesis | 6.2 m/s |
| Rime | Glacial Skim | **Frostfall** | Skyward Flash | Glacial Bulwark | Telekinesis | 5.3 m/s |
| Vesper | Spark | Sanguine Lash | Mirror Step | Ward | Trapped Relic | 5.3 m/s |

Bold entries are Ty's later changes. Speeds are the `speed` field next to `kit` in `wizards.js` (spells-owned). Wind-up
and ward speeds scale from it (2.0 and 2.6 m/s at 6.2). Backpedalling is capped at 3 m/s for everyone.

## What I built

### Wizard selection (the spellbook is gone)
- `constants.js`: `SPELLBOOK` has every spell (ward and telekinesis included), each with `slot`, `name`, `short` (the ability
  bar label), `blurb`, `cooldown` and its tuning. `SLOT_INFO` gives the key and label per slot. `kitOf(id)` returns a kit.
  `constants.js` re-exports `wizards.js`. `LOADOUT_SLOTS`, `DEFAULT_LOADOUT`, `spellsFor` and `sanitizeLoadout` are gone.
- Network: `join` carries `wizard`, and `{t:'wizard', id}` switches. Ids are validated with `isWizard`; `nope`, `__proto__`
  and `42` are ignored. A switch applies at once, or when a cast in progress ends (meteor, lash, cyclone, airborne), or at
  respawn if the player is dead. It's broadcast as `{t:'wizard', id, wizard, color}`. `playerPublic` carries `wizard`, plus
  `lashing, slow, bound, rooted, frozen`. Colour is `WIZARDS[id].color`.
- Client: the characters agent's picker is mounted in `#joinPicker` and `#pausePicker` (a `<select>` fallback stands in if
  the picker draws nothing). The choice is saved in `localStorage.wizardChoice`. A switch rebuilds the player's `Wizard`
  (model, ring and nameplate). The ability bar names all five spells from the kit. The scoreboard columns are Player / Wizard.
  The join panel is 760 px wide, as the characters agent asked.
- Bots: `addBot` takes `wizard` (random otherwise). `node bot.js` works unchanged.

### New spells (server rules + client + bots)
- **Glacial Skim**: 3 shards at ±6°, y 0.35, 26 m/s, about 22 m range, 11 damage each. A hit slows by 35 % for 2 s
  (refreshed, not stacked; sent as `hit.slow`, enforced in `updateLocal`). No stun. Colliders taller than 0.35 (fences,
  crops) block the shards. A ward blocks each for 6 stamina. Cast from the air, the shards start on the ground below.
- **Sanguine Lash**: `lashStart` begins a 1.5 s wind-up (red coil; slow movement; no ward); `lashRelease` then fires a
  28 m/s piercing whip (about 22 m). Each wizard on its path takes 12 damage and a 1.25 s bind (root + silence, no
  knockback). A hit or stun during the wind-up cancels it at no cost. If it binds nobody, the caster is rooted for 1 s
  (`lashMiss`, recovery pose). **A ward facing the caster stops it for 40 stamina, and that counts as a miss** (my call).
  Cooldown 13 s from release.
- **Mirror Step**: `{t:'mirror', dir, from}`. Three 7 m paths (centre and ±30° around the WASD direction); the server puts the
  caster on one at random and two decoys on the others. Decoys run at run speed for 2.5 s and are sent in snapshots
  (`decoys`) and `decoyEnd`. To others they're full `Wizard`s with the caster's model, name, nameplate, HP bar and run
  animation; on the caster's own screen they're see-through. One hit of anything pops them (projectiles stop; the lash
  cuts through), as do a cyclone, a relic blast, Frostfall and charging goats. Cooldown 7 s.
- **Glacial Bulwark** (Rime's Space; Rime can't ward): a wall 2.5 m ahead, 2.7 × 2.7 m, made of 5 circles
  (`kind:'bulwark', wall:id`) added to `C.COLLIDERS` on the server and every client (`wallUp`/`wallDown`, and `welcome`
  for walls already up). It blocks movement, projectiles, props, LOS, the camera and goats (they bonk on it). Projectiles
  damage it by their damage (`wallHit`); it breaks at 120 or after 10 s. A cyclone pulse and a relic blast don't pass
  it. Cooldown 12 s.
- **Trapped Relic**: tap F lifts (on release); hold F for 0.5 s on an idle prop curses it (`prop.cursedBy`, one per
  caster, sent only to the caster as `{t:'curse', id}`, shown as a faint red glyph). An enemy who lifts it: as the prop reaches
  their hold point, `relicBlast`: 45 damage within 3.5 m, knockback, credited to the curser. A ward facing the blast
  blocks it for 40. Lifting your own just lifts it and clears the curse; a curse also ends if the prop breaks.
- **Frostfall** (Ty's later request): hold RMB to aim a 3.2 m circle where the crosshair meets the ground (max 24 m),
  release to cast (`{t:'frostfall', at:[x, z]}`, 0.5 s `cast_heavy` pose). Everyone sees a growing dark shadow with a
  frost ring, and the ice block falls for the last 0.5 s. Impact 1.75 s after release: everyone in the circle with feet
  below 2 m takes 50 damage and is **frozen 1.5 s** (the lash's root + silence, with an ice-block visual instead of chains;
  `hit.bind` + snapshot `frozen`). Wards and walls don't help (`unblockable`). The caster isn't hit. It breaks props, pops
  decoys, and puts goats in the circle into `dizzyGoat`, or angers them. Cooldown 14 s.
  The warning counts down on the real clock (`performance.now`), so a slow machine still sees the ice land on time.

### Clip hooks (characters agent's bodies)
- `death`: played once and held, **no sink or tilt** (Ty's bug report). Bodies without it (Cinder, Gale) keep the sink.
- `float` (Rime): base state while airborne after the 0.5 s launch dash, back to normal on landing.
- `lash` (Vesper): plays over the lash wind-up. `spin` (Gale): plays over the cyclone spin.

### Bots (`server/bots.js`)
Bots play every kit. They dodge lash wind-ups aimed at them (wall it, ward it about 0.3 s before release, or step off the
line as it fires; mobility is saved for the whip itself). They treat skim shards like sparks (no reaction while airborne).
They raise a Bulwark against meteors, lashes, goat charges and cyclones. They go after decoys at Easy 50 %, Normal 29 %,
Hard 14 % (measured over 2000 trials each). They Mirror-Step, or now Blink, away when hurt and pressed. Vesper bots curse
props near their target, holding F for 0.5 s like a player, at most one curse per 8–14 s. Hard bots stop lifting a prop
that blew up on them for 40 s. Everyone walks, blinks or flashes out of a Frostfall shadow (react delay by difficulty).
Rime aims Frostfall where a rooted, stunned, casting or slowed target will be when the ice lands.

## Later changes (after the first hand-off), by commit
- **Frostfall from the air** (`58497d2`): the one power spell Rime can cast during Skyward Flash (`airCast`). The server
  accepts it from any height (range measured flat), and the cast pose layers over `float`. Rime bots sometimes flash up first.
- **Smoke Screen** (Cinder's E, `58497d2`): a 0.25 s backward dash (6.5 m, opposite her facing) that collides like walking;
  the client predicts it on real time, in small collision steps, and the server allows the dash speed. It leaves a 4 m × 3 m
  cloud for 5 s (+1 s fade): layered billboard puffs with an ember tint. Anyone inside is faded out (model, ring,
  nameplate, health bar) for viewers outside the same cloud. Bots can't see into, out of or through it (`C.smokeBlocks`):
  they drop a hidden target and head for where they last saw it. Bots use it to escape. Cooldown 8 s.
- **3-shot magazine** (`63ef725`): primary fire is 3 shots (a Skim volley counts as one), then a 1.5 s reload. R, or 2 s
  idle, reloads a partial magazine (`SPELLBOOK.*.magazine/reload/idleReload`). The server tracks `ammo/reloadUntil` and
  refuses shots while reloading. Only the 3rd shot (the finisher, `proj.fin`) stuns and interrupts (wind-ups, a lift);
  shots 1–2 just deal damage (and Skim's slow). `hit.int` tells clients. Spark stun immunity still applies. Skim's
  finisher cancels but doesn't stun (Skim never stuns, by Ty's first spec). Bots save the finisher for wind-ups (Hard 90 %,
  Normal 50 %, Easy never). HUD: ammo pips (the finisher's is gold) and a reload sweep.
  *Reload gesture:* none for now. A short "recharge" clip (about 0.6 s, e.g. a staff tap or a palm-up gather) would help.
- **Ty's sounds** (`db03fec`): `spark_cast` (fireball primary), `skim_cast` (ice primary, the 3.65–4.45 s burst), `blink`,
  `mirror_step` (split into 3), `smoke_screen`, `wall_up` (Ice wall; its break keeps the old shatter layers), `ward_loop` (ward
  shield, a 4 s crossfaded loop, kept quiet) and `kill_sting` (win_duel_kill_enemy: all its sound is in the first ~1 s, so 1.45 s
  with a fade). The sting plays flat, only for the killer, and restarts instead of stacking. The finisher plays `spark_cast`
  pitched down with a bright ring. `spark_cast_1–3` were removed. All credited in `public/sounds/CREDITS.md`.
- **Tempest Veil** (Gale's Space, `412e09b`): tap for a 3 s wind bubble that absorbs **every** hit from any side (damage,
  stun, slow, bind, knockback; frostfall and relic blasts too). Absorbed hits don't cancel her own casts. No stamina, no
  refresh; cooldown 10 s from activation. Visual: a swirling violet-white sphere, a gust on cast, a pop at the end and a
  flash per absorbed hit; the ward hum plays while it's up. Bots veil to dive into cyclone range and against goats,
  Frostfall and big spells; other bots hold fire on a veiled Gale and back away.
  **Pending (environment):** a goat ram should bounce off the veil (request in `requests.md`). Until then
  `goatCtx.killPlayer` refuses to kill a veiled wizard, so she survives, but the goat doesn't bounce.
- **Throwable goats, telekinesis side** (`dc4f58f`), per Ty's revision: telekinesis targets calm goats as well as props
  (server and client). A held goat floats at the hold point with the beam, blocks casting like a held prop, and shields its
  holder. F hurls it like a prop (`SPELLS.goat` = prop numbers, credited to the thrower, "X goated Y" on a kill); G sets
  it down. Death or stun drops it (goats.js). Lifting, throwing and landing never anger it; only a spell does (held
  and flying goats included), and spells hit goats at their height. Bots sometimes hurl a goat and dodge flying ones.
- **Sparks in the caster's colour** (`a7af67c`): `BOLT_COLORS` in `constants.js` (Cinder ember `ff5a1e`, Gale violet
  `b070ff`, Vesper crimson `ff1f3d`; Rime's Skim stays ice). A white-hot core inside the coloured glow, light, trail and
  impact burst; the finisher is bigger, with a lighter ring.
- **Speed, locomotion, gestures, telekinesis cooldown** (`2f37782`, `e09e94e`, `9e31c58`): the per-wizard speed and the
  backpedal cap above (applied on the client, in the server's speed check, for bots and decoys). Locomotion picks `run`
  at speed, `walk_fight` when slow (below 3 m/s, or in a wind-up, ward or slow) and `back` when moving backward, each
  time-scaled to ground speed ÷ the clip's measured speed (`clip.userData.speed`, capped at 6×). `tk_lift` and `tk_throw`
  play on a lift and a throw; `hit_waist` plays when a hurled prop or goat hits. Hurled objects already interrupt (only
  primary fire follows the magazine rule); a ward or veil that blocks them means no interrupt. Telekinesis has a 3 s
  lift cooldown (`liftCooldown`, shared with Trapped Relic) after letting go of anything (thrown, set down, knocked away,
  dropped) and after laying a curse. The server enforces it (`snap.liftCd`), the client predicts it with the F-button sweep,
  and bots respect it.

## Verification
Harnesses are in `/tmp/wa-spells/` (Playwright scripts `t_*.py`, raw-socket rule checks `t_server.mjs` and
`t_frost.mjs`, match harness `match.mjs`). There were no console errors in any browser run.

**Server rules (raw sockets; last run after all changes):** wall: HP 111 → … → 3, broken by the 14th spark, Rime
behind it untouched. Lash: pierced D1 and D2 (12 damage, bind 1.25, kb 0); a bound wizard moved 0.00 m and its cast
and ward were refused; measured bind about 1.27 s (20 Hz snapshots); a miss roots the caster (moved 0.00, free after
1 s); a spark during the wind-up → `lashCancel` and no lash; a ward → blocked, 40 stamina, caster rooted. Mirror: 2
decoys on the other two paths, a led spark pops a decoy (`surface:'decoy'`), the other expires after 2.5 s. Relic: curse
sent only to the caster; lifter and bystander take 45 each, credited to Vesper; the prop breaks and the curse clears.
Wizard: bad ids ignored; a switch during a meteor wind-up applies after release. Frostfall: impact at 1.78 s; ward and
wall don't stop it (50 damage, bind 1.5, frozen); an airborne Gale and a wizard 4.2 m out are untouched; frozen
wizards can't move or cast; refused on cooldown; range clamped to 24.00 m.

**Browser (Playwright, port 4101):**
- Selection: the choice survives a reload; each kit's bar reads (Cinder) `Spark | Meteor | Ward | Blink | Lift`,
  (Vesper) `Spark | Lash | Ward | Mirror | Relic`, (Rime) `Skim | Frostfall | Bulwark | Skyward | Lift`; `{t:'wizard', id:'nope'}` is ignored.
- Skim: 3 shards; a walking full client's velocity went from 6.06 to 4.12–4.5 m/s while slowed (35 % off 6.2 = 4.03),
  and back after 2 s; a fence stopped all 3 shards (`fence, fence, fence`, target untouched); a wizard at 6.4 m up was untouched.
- Bulwark: present on both clients (5 colliders); a walker stopped 0.77 m from the wall's centre line (circle 0.35 +
  player 0.45); sparks hit `bulwark`; a charging goat → `goatBonk`.
- Lash: the watcher sees the coil; the target shows `bound` with chains. Mirror: the watcher sees 2 decoys looking
  exactly like Vesper; Vesper sees 2 ghosts. Relic: curse glyph on Vesper's screen; on the watcher's client
  `cursedProp` is null and 0 curse messages arrive; the watcher lifts it → HP 100 → 55, feed "It was a trap!".
- Frostfall: aim circle shown, cast pose `cast_heavy`, shadow and frost ring, falling ice, impact mist; a target in the
  circle took 50. Ice block vs chains: `frozen_vs_bound.png`.
- Clips: Rime `float` mid-descent (own screen and watcher's), `idle` after landing, `stun` when sparked; Vesper `lash`;
  Gale `spin`. Death, stepped deterministically at 0.5 / 1.5 / 2.5 s: Rime and Vesper in `death` with model y 0 and
  tilt 0 at every step (Rime flat by 2.5 s); Gale sinks (-0.73 / -1.34 / -1.52); all are `idle` at ground level after respawn.

Screenshots, all looked at, in `/tmp/wa-spells/`: `picker_fallback.png` (the real picker), `hud_vesper.png`,
`scoreboard.png`, `lash_windup.png`, `bound.png`, `decoys_watcher.png`, `decoys_own.png`, `wall.png`,
`wall_far_side.png`, `curse_glyph.png`, `relic_blast.png`, `frost_aim.png`, `frost_shadow.png`, `frost_falling.png`,
`frost_frozen.png`, `frozen_vs_bound.png`, `rime_float.png`, `rime_stun.png`, `vesper_lash.png`, `gale_spin.png`,
`death_0.5.png`, `death_1.5.png`, `death_2.5.png`.

**Difficulty spread** (`botmatch.mjs 4101 90 hard normal easy`, 3 runs, random wizards, final code):
Hard 6/1, 4/1, 5/0 = **15 K / 2 D**; Normal 1/3, 1/3, 0/2 = **2 / 8**; Easy 0/3, 1/2, 0/3 = **1 / 8**. The spread holds.

**Wizard balance** (4 Hard bots, one per wizard, 120 s runs, `match.mjs`):
| Code state | Cinder | Gale | Rime | Vesper |
|---|---|---|---|---|
| First kits, 5 runs | 9 / 18 | 15 / 23 | 24 / 20 | 26 / 13 |
| After bot fixes (Blink escape, Vesper holds F to curse), 4 runs | 12 / 17 | 21 / 17 | 19 / 19 | 12 / 11 |
| Final (Frostfall, Gale on Blink), 3 runs | 5 / 10 | 11 / 14 | 14 / 9 | 12 / 10 |

Vesper's early lead came from bot asymmetries (instant curses, and only Mirror bots escaping when hurt), not the spells.
After those fixes nothing dominates, but **Cinder is consistently the weakest** (K/D about 0.5–0.7): the base kit
has no tool the others lack. Frostfall: 20 bot casts, 18 wizards inside a shadow at cast time, 3 caught. It's
dodgeable, and it pays off on rooted or slowed targets.

### Verification of the later changes
Raw-socket rule checks (`/tmp/wa-spells/t_*.mjs`) and Playwright (`t_*.py`), port 4101, no console errors:
- Frostfall from the air: accepted at 6.8 m up (flat range 8.00 m), 50 damage to the dummy; in the browser the cast lands
  and freezes a dummy (50, bind 1.5), and the watcher sees `float → cast_heavy (0.8 m up) → idle`.
- Smoke Screen: the dash goes exactly 6.5 m straight back and stops 0.45 m from a pillar behind. A dummy in the cloud is
  hidden from a viewer outside (fade 1 → invisible), and visible to a viewer inside. A Hard bot fired 5 sparks in 5 s
  at a visible Cinder, 0 while she stood in her smoke, and 2 once it cleared. (`smoke_outside.png`, `smoke_inside.png`)
- Magazine: shots 1–2 hit for 9 with `int:false` (no stun, the meteor wind-up survives); shot 3 is `fin` and stuns and
  cancels. A 4th shot during the reload is refused; firing works again after it. R and idle reloads work. Stun immunity:
  a second finisher 0.8 s after the first does 9 damage but doesn't re-stun. In the browser, 4 clicks give 3 projectiles,
  the 3rd `fin`, and pips 3 → 0 → 3. (`mag_reloading.png`)
- Sounds: all 25 manifest keys decode in Chromium. The sting plays on our kill, restarts on a second, and stays silent for others' kills.
- Tempest Veil: 4 sparks from front and back absorbed (HP 100); a finisher during the veiled cyclone wind-up is absorbed
  and the cyclone still pulses; the veil ends at 3.02 s; after it two plain shots land (HP 82) and a finisher cancels the
  wind-up; a recast is refused on cooldown. (`veil.png`)
- Goats: a lift doesn't anger; the goat follows its holder; the hurl hits a dummy for 22 (prop numbers) credited to the
  thrower; the goat lands and grazes; a miss lands calmly too; a spark at a held goat drops it and sends it charging the
  caster. In the browser: "F lift goat" → lifted → "F hurl goat · G set down" → dummy 100 → 78. (`goat_held2.png`)
- Spark colours: each caster's sparks arrive in its colour (`bolts_still.png`).
- Speeds: Cinder 5.29 m/s (`run` 1.13×), Gale 6.19 (`run` 1.30×), both backpedal at 3.0 (`back`). A wind-up walk plays
  `walk_fight`, and a lift plays `tk_lift`. A thrown crate interrupts a meteor wind-up (22, `int`); a ward facing it blocks, no stun.
- Telekinesis cooldown: about 2.7 s left right after a throw, a set-down or a curse; lifts are refused during it, and a lift
  3 s after the throw works.

**Balance with the later changes** (4 Hard bots, one per wizard, 120 s): after the magazine, Cinder 3/8, Gale 9/7,
Rime 10/7, Vesper 5/6 (3 runs). After the Veil, Gale 10/13 over 4 runs: not dominant, so the cooldown stays at 10 s.
After the speed change: Cinder 4/3, Gale 2/6, Rime 4/4, Vesper 5/3 (2 runs). Kills are much rarer since the magazine
and slower movement, so per-run numbers are noisy. Difficulty (botmatch, 3 × 90 s, final code): Hard 5 K / 2 D (damage
462, 265, n/a), Normal 8/5 (190, 214), Easy 5/12 (146, 182). By damage Hard is clearly ahead; by kills the spread is
blurrier than before.

## Known issues and notes
- **README** (coordinator) still describes the spellbook. It needs the wizard roster, the five kits, the new spells,
  the messages (`wizard`, `lashStart/lashRelease/lashCancel/lashMiss`, `mirror/decoyEnd`, `bulwark/wallUp/wallHit/
  wallDown`, `curse/relicBlast`, `frostfall/frostfallHit`) and the snapshot fields.
- `tools/test/spellmatch.mjs` throws now (it reads `player.loadout`); see `requests.md` for the replacement.
- Judgement calls Ty may want to revisit: a blocked lash counts as a miss (caster rooted); Glacial Skim cast from the air
  starts its shards on the ground under Rime; Trapped Relic lifts on F release (up to 0.5 s later than before) because a
  hold means curse; Frostfall doesn't hit its caster.
- Cinder may want a buff if Ty agrees with the numbers above (e.g. Meteor cooldown or damage); I didn't change his spells.
- Under swiftshader, the first seconds after joining stall while shaders compile (the new scenery and models), and long
  stalls can miss the 15 s heartbeat (the page then shows "Disconnected"). Tests warm up first. On a real GPU this doesn't happen.
- Rime's `float` hold, the death clips (no sink: they lie at ground level until the respawn moves them), Vesper's `lash` and
  Gale's `spin` are all wired; `back` is now the backward fight walk (it loops), and Smoke Screen plays it as a short one-shot.
- Swiftshader runs at 3–5 fps, so Playwright timing checks use events and the client's velocity, and the death screenshots
  step the animation by hand. On a real GPU none of this matters.
- Decoys are separate entities on the wire (`decoys` in snapshots), so a modified client could tell them apart.
  Visually they are identical.
