# Spells hand-off (round 4): wizards with fixed kits, five new spells, Frostfall

Commits: `eb16956` (kits and the five spells), `275d33b` (bot fixes, walls on join), `d1eb78d` (death, float, lash and
spin clips; Frostfall client), `08650c2` (Frostfall server and bots), `49b7511` (wizards.js kits: Rime power = Frostfall,
Gale mobility = Blink), plus request replies (`1d5db26`, `ec01861`).
Files: `public/shared/constants.js`, `server.js`, `server/bots.js`, `public/js/{main,wizard,effects,audio,net}.js`,
`public/index.html`, `public/css/style.css`, and the `kit` fields in `public/shared/wizards.js`.

## Kits (current)
| Wizard | LMB | RMB | E | Space | F |
|---|---|---|---|---|---|
| Cinder | Spark | Meteor | Blink | Ward | Telekinesis |
| Gale | Spark | Arcane Cyclone | **Blink** (was Skyward, Ty's change) | Ward | Telekinesis |
| Rime | Glacial Skim | **Frostfall** (was Meteor, Ty's change) | Skyward Flash | Glacial Bulwark | Telekinesis |
| Vesper | Spark | Sanguine Lash | Mirror Step | Ward | Trapped Relic |

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

## Known issues and notes
- **README** (coordinator) still describes the spellbook. It needs the wizard roster, the five kits, the new spells,
  the messages (`wizard`, `lashStart/lashRelease/lashCancel/lashMiss`, `mirror/decoyEnd`, `bulwark/wallUp/wallHit/
  wallDown`, `curse/relicBlast`, `frostfall/frostfallHit`) and the snapshot fields.
- `tools/test/spellmatch.mjs` throws now (it reads `player.loadout`); see `requests.md` for the replacement.
- Judgement calls Ty may want to revisit: a blocked lash counts as a miss (caster rooted); Glacial Skim cast from the air
  starts its shards on the ground under Rime; Trapped Relic lifts on F release (up to 0.5 s later than before) because a
  hold means curse; Frostfall doesn't hit its caster.
- Cinder may want a buff if Ty agrees with the numbers above (e.g. Meteor cooldown or damage); I didn't change his spells.
- Swiftshader runs at 3–5 fps, so Playwright timing checks use events and the client's velocity, and the death screenshots
  step the animation by hand. On a real GPU none of this matters.
- Decoys are separate entities on the wire (`decoys` in snapshots), so a modified client could tell them apart.
  Visually they are identical.
