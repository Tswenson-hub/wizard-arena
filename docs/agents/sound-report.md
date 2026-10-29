# Sound report (sound pass, stage 2, plus Ty's second batch)

## Ty's second batch (voices, grass steps, goats, telekinesis)
Ty's files on ~/Desktop were only read. Processing script: /tmp/wa-spells/snd2/make.py (`rows.json` lists every cut).
- **Hurt voices:**
  - **Male:** 33 grunts were found in `Male_hurt.mp3` by the energy envelope. The 12 strongest short ones (0.3–0.55 s)
    became `hurt_male`, and the two longest (0.8 s) became `death_male`. No source clips; the weak ones (below -16 dB peak) were dropped.
  - **Female:** each female file holds just one grunt, so `hurt_female` has only 2 recorded grunts. Three more are
    pitch-shifted copies (±6–7%), for 5 in all; `death_female` is the longer grunt 12% lower.
    **Ty:** a few more recorded female grunts would make it less repetitive.
  - Female heroes are Cinder, Gale, Vesper and Embibe; male heroes are Rime and Jeb.
  - **Pitch per hero:** Cinder 1.04, Gale 1.10, Vesper 0.94, Embibe 1.00, Rime 0.96, Jeb 1.06.
  - **Where it plays:** every hero, on every damaging hit (3D for others, flat for you), and on death.
  - **Cycling:** a shuffled bag per wizard (`Sfx.fromBag`), reshuffled when empty, and never the same grunt twice in a row.
  - **Rate limit:** one grunt per wizard every 0.35 s, so damage-over-time ticks don't stutter (deaths always play).
- **Grass steps:** `step_grass` has 7 variants (6 cut from `Grass_sounds.mp3` plus the `Grass.mp3` rustle).
  - They replace the Kenney footsteps everywhere and cycle per wizard. The timing is unchanged: the same gait intervals,
    0.5 s walking and 0.3 s running.
  - **Sprint** plays the same pool at 1.5× gain and rate 0.88.
  - `sfx.hoof` also uses the grass steps, lower, until hoof recordings exist.
  - The `Grass.mp3` rustle is spiky, so the peak limit leaves it about 6 dB under the others.
- **Goats and rams:** `goat_bleat` has 2 variants from the dragon-studio files and replaces the synthesized bleat (kept
  only as a fallback). Pitch is varied per bleat.
  - **Grazing and wandering goats:** quiet (0.3), every 9–25 s, and only within 28 m of the camera (`updateGoatAudio` in main.js).
  - **Angered or rearing:** loud and lower (rate about 0.8, vol 1.2).
  - **Picked up or thrown:** goats.js's existing calls, now with the samples.
  - **Ram summon:** Battering Ram and Stampede rams bleat angry, Ram Guard rams once per guard, and a mount softly. This replaced `ram_summon`.
  - **Stampede:** three angry bleats roll down the lane under the rumble.
  - **Sling:** a called ram bleats angry.
  - **Goat bonk:** the thump plus a startled bleat.
- **Telekinesis:**
  - `tk_lift` is 0.85 s around the swell of `Telekinesis_Pull.mp3`.
  - `tk_hold_loop` is a 2.6 s loop from its steady middle (0.4 s crossfade), played quietly (0.35) while anyone holds a prop or a goat.
  - `tk_throw` is `telekinesis_throw.mp3`.
  - The spells that used the old files as layers keep them: they were renamed `swell` (old tk_lift) and `whoosh` (old
    tk_throw_1-3). These are the Cyclone wind-up and pulse, Frostfall's cast, the curse, Flask Step's wind-up and lob,
    and the Eye of the Storm ticks.
- **Credits:** two new CREDITS.md tables: "Provided by Ty" (voices, steps, telekinesis), and "Provided by Ty
  (Pixabay: dragon-studio)" for the goats.
- **Pruned (9 files):** `footstep_1-4`, `hurt_1-2`, `death_1` and `ram_summon_1-2`.
- **Size:** public/sounds is now 3.41 MB (150 sound files, 100 keys).
- **Verified:**
  - All 100 keys decode in Chromium.
  - **Hurt cycling:** 20 hits per hero, for all six heroes, with no back-to-back repeat; a 21st hit 0.1 s after the 20th played no grunt (the rate limit).
  - **Play test:** a 110 s run with 3 Hard bots had no console errors. Hurt (both sets), death, steps, goat bleats, tk
    lift/throw/hold, and swell/whoosh all fired.
  - `node --check` and botmatch pass.

The spells agent integrated the files the characters agent staged in /tmp/wa-sounds/staged (see its MAPPING.md for
each pick's source file). Ty's originals in ~/Downloads were only read, never moved or deleted.

## Size
- **public/sounds before:** 0.76 MB (49 files). **After:** 3.24 MB (127 sound files + manifest + CREDITS.md).
- The menu music is 1.38 MB of that; the other 86 new files are about 1.3 MB.
- **Pruned (5 files):** `hit_body_1-3` (replaced by `hit_light`), `hurt.m4a` and `death.m4a` (replaced by `hurt_1-2` and
  `death_1`). `meteor_cast.m4a` was overwritten by the new pick.
- **Not copied:** `blink_alt`, `smoke_screen_alt` and `ui_click_alt`, because Ty's `blink` and `smoke_screen` and the
  current `ui_click` stay. `bulwark_cast` was also left out, because Ty's `wall_up` ("Ice wall.mp3") already raises the
  Bulwark. All four are still in staging if Ty prefers them.
- Every file in public/sounds is in the manifest, and every manifest key is played by the code.

## What plays where
Spatial sounds play at the event's position; UI and mode tones play flat.

| Slot | Key(s) | Hook (public/js) |
|---|---|---|
| Primary casts | `spark_cast` (Cinder, Gale's spark, Vesper's fast), `shear_cast`, `hex_cast`, `sling_cast`, `skim_cast` (Ty), `potion_toss` (Potion, Toxic Flask lower) | main.js `proj` |
| Primary impacts | `fireball_impact`, `shear_impact`, `hex_impact`, `sling_impact`, `skim_impact`, `impact_small` (spark on scenery), `potion_shatter` (Ty) | main.js `projEnd` |
| 3rd-shot finisher | `finisher_fire/wind/ice/dark/earth/acid` by hero (falls back to the old layered accent) | `sfx.finisher` on `proj` with `fin` |
| Hits on bodies | `hit_light` (every hit), `hit_heavy` (goat ram, Meteor Rain landing); `hurt_male/female` and `death_male/female` for the victim | `hit`, `death`, `sfx.voice` |
| Hit marker | `hit_marker` (yours only) | `hitmarker()` |
| Reload | `reload` (yours only, empty magazine or R) | `startReload` in updateLocal |
| Meteor | `meteor_cast` (new), `meteor_impact` | `proj` heavy / `projEnd` |
| Cyclone | `cyclone_loop` for 1 s over the old wind-up layer | `cycloneStart` |
| Frostfall | `frostfall_fall` timed to end on the impact, `frostfall_impact` | `frostfall` / `frostfallHit` |
| Lash | `lash`, `lash_bind` | `sfx.lashCrack` / `sfx.bind` |
| Battering Ram | `battering_ram` | `batteringRam` |
| Firewall | `firewall_cast`, `firewall_block` (a bolt burning up), `firewall_break` (quiet, when it ends) | `firewall`, `projEnd`, `firewallEnd` |
| Glacial Bulwark | `wall_up` (Ty), `bulwark_block`, `bulwark_break` | `wallUp/wallHit/wallShatter` |
| Tempest Veil | `veil_cast`, `veil_block`, `veil_break` | `veilUp`, `hit` with `veil`, `veilDown` |
| Black Death | `black_death_cast` (raising it, from the snapshot's blocking edge), `black_death_block`, `black_death_break` | `applySnap`, `hit`, `blockBreak` |
| Ward (others) | `ward_loop`, `ward_block`, `ward_break` (unchanged) | |
| Ram Guard | `ram_guard_cast`, `ram_guard_block` (a guard ram eats a bolt), `ram_guard_break` (once, when the rams go) | `ramGuard`, `projEnd` surface goat, `goatGone` |
| Skyward Flash | `skyward_launch`, `skyward_land` | `sfx.skyward/land` |
| Ram summon | `goat_bleat` (see Ty's second batch) | `ramSpawn` |
| Ram Ride | `ram_ride_loop` following Jeb until the ride ends | `ride` / per-frame |
| Ultimates | `ult_ready` (your charge fills), `ult_windup` (every wind-up; the old `ult` meteor layer was removed) | updateHud, `ultWindup` |
| Meteor Rain | `meteor_rain_launch`, `meteor_rain_dive`, `meteor_impact` + `hit_heavy` | `mrainLeap/Dive/Land` |
| Eye of the Storm | `eye_storm_loop` following Gale until `eyeEnd` | `eyeStart` / `endEye` |
| Night Cage | `night_cage` + `night_cage_chains` | `cage` |
| Stampede | `stampede` (replaced the six synthesized thuds) | `stampede` |
| Berserker Brew | `brew_drink` (Ty) then `brew_roar` at the end of the drink | `brew` |
| Blizzard | `blizzard_cast`, `blizzard_loop` (Ty) | unchanged |
| Fight start | `fight_start` when warm-up turns live | `matchSounds` (main.js) |
| Countdown | `countdown_tick` at 3, 2, 1 of the warm-up | `matchSnapSounds` |
| Score | `score_tick` when your team scores (every kill in TDM, every 10 points in Siege) | `matchSnapSounds` |
| Siege | `siege_capture` (your team takes the altar), `siege_contested` (a contest starts), `siege_moving` (the hop warning) | `matchSnapSounds`, `matchZone` warn |
| Match end | `victory` (you or your team won) or `defeat`; nothing on a draw | `matchEnd` |
| Vote | `vote` when you vote | `matchVotes` |
| Menu music | `menu_music` looped with 1.5 s fade-in and 1.2 s fade-out | `sfx.setMusic`, `updateMusic()` |

- **Menu music** plays on the join screen from the first click or key (browsers block sound before a gesture), stops
  when you're in the arena, and comes back for the end screen and the vote. It goes through the master gain, so the
  pause-menu volume slider and mute (M) apply. Its bus is 0.42, under the effects. The outdoor ambience stays under gameplay.
- Mode tones live in main.js (`matchSounds` and `matchSnapSounds`), so match-ui.js, which belongs to the modes agent, is untouched.

## Credits
- public/sounds/CREDITS.md lists every file with its source file and licence: Leonardo Calvo (Magic Spell Full
  Pack, **CC BY 4.0**), lentikula (Basic Spell Impacts, CC0), 80 CC0 RPG SFX (CC0), the OpenGameArt Victory fanfare
  (CC0, credited anyway; `defeat` is derived from it), the Pixabay music (turning_pages, Pixabay Content License), plus
  the existing Kenney, OpenGameArt and Ty tables.
- **In game:** a credits line on the join screen and in the pause menu (under Sound): "Spell sounds: Magic Spell Full
  Pack by Leonardo Calvo (thesoundrack), CC BY 4.0. Music: "Nordic Fantasia Lofi" by turning_pages (Pixabay). Also CC0
  sounds by Kenney, lentikula and OpenGameArt contributors. All credits" (links to the licence and to CREDITS.md).
- **README:** the coordinator owns it. It still needs the Leonardo Calvo CC BY 4.0 credit.

## Verified
- **Decoding** (Playwright, Chromium): all 95 manifest keys, 127 files, decoded with 0 failures (`/tmp/wa-spells/t_sounds.py`).
- **Music:** playing on the join screen after a click, stopped after joining.
- **Play test:** two runs with 3 Hard bots (40 s and 110 s), with every `sfx.play`/`loop` key counted. No console errors.
  Heard in the runs: every hero's casts and impacts, finishers, Frostfall fall and impact, Veil cast/block/break,
  Bulwark break, Ram Guard cast/break, Ram Ride loop, Stampede, Skyward, Cyclone loop, ult wind-ups, Blizzard,
  countdown ticks and fight start.
- **Not covered by the runs:** hit marker, reload, ult ready (all yours only), and victory/defeat, vote and the Siege tones.
  These were checked against the message shapes in server/match.js.
- **Loudness proxy** (active RMS above -50 dBFS, per file, `/tmp/wa-spells/snd_levels.json`): the new picks sit
  between -11 and -27 dBFS, peaks at about -1 dBFS. The quietest are `vote`, `score_tick`, `hit_marker` and
  `countdown_tick` (-24 to -27, short UI ticks, fine), plus `frostfall_impact` (-21.5, played at 1.2) and
  `black_death_block` (-20.4). The loudest are `cyclone_loop`, `meteor_impact` and `hit_heavy` (about -13; played at 0.7 to 1.1).
  Nothing clips.
- `node --check` and botmatch pass.

## Gaps and suggestions
- ~~**Sheep, goat and ram voices**~~ **filled** by Ty's dragon-studio bleats. Only 2 variants, so 2 to 4 more would help.
- **Hooves:** `sfx.hoof` is a low-pitched grass step, and Ram Ride and Stampede use earth rumbles. **Suggestion:** a
  "hooves gallop on dirt" loop and 2 to 3 single hoof thuds.
- **Defeat sting:** `defeat` is the victory fanfare slowed and low-passed. **Suggestion:** a dedicated minor-key lose
  jingle (OpenGameArt CC0).
- ~~**Voices**~~ **filled** by Ty's male and female grunts, per hero. The female set has only 2 recorded grunts (plus pitched copies).
- ~~**Footsteps**~~ **filled** by Ty's grass steps (walk and sprint).
- ~~**Telekinesis**~~ **filled** by Ty's pull and throw, plus a hold loop.
- **Smaller ones:** there's no Mirror Step decoy pop
  or Relic curse sound (they use synthesized or older layers). The 80 CC0 RPG pack may have usable picks for these.
- **Loops:** nobody has listened to the wraps yet (this was a headless check). `loop()` already skips 12 ms at each
  end for the AAC priming. If a click shows up, raise that to about 25 ms (MAPPING.md's note).
