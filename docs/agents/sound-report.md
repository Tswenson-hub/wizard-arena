# Sound report (sound pass, stage 2)

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
| Hits on bodies | `hit_light` (every hit), `hit_heavy` (goat ram, Meteor Rain landing); `hurt` and `death` for the victim | `hit`, `sfx.hitBody/hurt/death` |
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
| Ram summon | `ram_summon` (creature snort as a stand-in) | `ramSpawn` |
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
- **Sheep, goat and ram voices:** there are none in any pack. `ram_summon` is a creature snort, and goats still use
  the synthesized `bleat` (goats.js, `ramCalled`, the goat bonk). **Suggestion:** a CC0 sheep and goat bleat set
  (freesound.org with the CC0 filter), 4 to 6 variants.
- **Hooves:** `sfx.hoof` is a low-pitched footstep, and Ram Ride and Stampede use earth rumbles. **Suggestion:** a
  "hooves gallop on dirt" loop and 2 to 3 single hoof thuds.
- **Defeat sting:** `defeat` is the victory fanfare slowed and low-passed. **Suggestion:** a dedicated minor-key lose
  jingle (OpenGameArt CC0).
- **Voices:** `hurt` and `death` are creature grunts, the same for every hero, including the female heroes. **Suggestion:**
  a CC0 voice-effort pack with male and female sets, mapped per hero.
- **Footsteps:** still the old Kenney footsteps; there's no grass or dirt variant. **Suggestion:** a CC0 grass and dirt footstep set.
- **Smaller ones:** there's no dedicated Telekinesis sound (it uses the old `tk_lift`/`tk_throw`), and no Mirror Step decoy pop
  or Relic curse sound (they use synthesized or older layers). The 80 CC0 RPG pack may have usable picks for these.
- **Loops:** nobody has listened to the wraps yet (this was a headless check). `loop()` already skips 12 ms at each
  end for the AAC priming. If a click shows up, raise that to about 25 ms (MAPPING.md's note).
