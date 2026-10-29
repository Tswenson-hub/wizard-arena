# Sound pass (Ty): use the downloaded packs, prune unused, report gaps

Ty: "I have downloaded a litany of sounds as instructed: some are background, special effects, spells etc. Make the most
use of what is downloaded. Any lingering sounds that are not used can be deleted to save space. Integrate these new sounds
and give a report on anything sound related that is still missing."

## Sources (in ~/Downloads; read-only, never delete or move Ty's originals)
| Source | Licence | Credit |
|---|---|---|
| `Magic Spell Full Pack.part1.rar` + `.part2.rar`: 2177 files, 2.25 GB of WAV, by Leonardo Calvo (thesoundrack), Fire/Lightning/Ice/Holy/Dark/Acid/Wind/Water/Earth. Extract with `7z x "Magic Spell Full Pack.part1.rar" -o<dir>`. | **CC BY 4.0** | **credit Leonardo Calvo** in public/sounds/CREDITS.md and in an in-game credits line (README too) |
| `80-CC0-RPG-SFX.zip` (80 OGG files): blades, creatures (hurt, die, roar), items, metal, stone, wood | CC0 | none needed |
| `Basic Spell Impacts/` (lentikula): Fire/Ice/Lightning/Water impacts, 20 WAV | CC0 | none needed |
| `Victory.mp3` / `Victory.wav` (4.9 s): a victory fanfare (OpenGameArt, CC0 per Ty's pick) | CC0 | credit it anyway |
| `turning_pages-nordic-fantasia-lofi-skyrim-lofi-opener-406706.mp3` (145 s): background music, a Pixabay track | Pixabay Content License | credit as Pixabay |

No sheep, goat or hoof sounds were downloaded. Note that in the gap report.

## Stage 1: characters agent (idle; no repo edits)
Extract everything to `/tmp/wa-sounds/src/`, then build a catalogue (path, duration, loudness, a short name-based description).
Pick the best candidate (1–3 variants) for each slot below, judging by name, folder, duration and loudness envelope. Then trim
silence, normalise, and convert to small AAC `.m4a` with `afconvert`: mono for one-shots, stereo at a low bitrate for loops and
music, about 1–2 MB total for the music. Write them to `/tmp/wa-sounds/staged/`, plus `/tmp/wa-sounds/staged/MAPPING.md`: slot
key → file(s) → source path → licence. Work in `/tmp/wa-sounds` only. Never delete anything under ~/Downloads, and don't touch
the repo.

**Slots** (prefer the element that matches each hero: Fire → Cinder, Ice → Rime, Wind → Gale, Dark → Vesper,
Acid → Embibe, Earth → Jeb and rams, Holy or Lightning → UI and ultimates):
- **Primaries, per hero (cast and impact):**
  - Cinder: fireball (has Ty's; add an impact)
  - Gale: Shear (wind slash)
  - Rime: skim (has Ty's; add an ice impact)
  - Vesper: Hex Shards (dark crystalline)
  - Jeb: Sling (whirl/release, earth impact)
  - Embibe: Potion Toss (has a shatter; add a throw whoosh)
  - The 3rd-shot finisher accent for each.
- **Reload:** a short magical recharge, shared or per element.
- **Hits:**
  - light body hit, 3 variants
  - heavy hit/crunch, for meteors, rams and Stampede
  - hurt grunts (creature hurt)
  - death
  - a hit-marker tick for your own landed hit
- **Power spells:** meteor cast and impact (fire), cyclone (wind), frostfall fall and impact (ice), lash (dark whip),
  battering ram (earth rumble), toxic flask (has Ty's).
- **Shields, cast, block and break per hero:** Firewall (fire roar), Bulwark (ice crack), Veil (wind gust), Black Death
  (dark whoosh), Smoke Flask (has Ty's glass), Ram Guard (earth).
- **Mobility:** Blink, Skyward launch and landing, Smoke Screen, Mirror Step (has Ty's), Flask Step (has Ty's), Ram Ride rumble.
- **Ultimates:**
  - a shared "ult ready" chime
  - a shared wind-up sting
  - per hero: Meteor Rain (launch roar and dive whistle), Eye of the Storm (tornado loop), Blizzard (has Ty's),
    Night Cage (dark gong or chains), Stampede (earth rumble), Berserker Brew (roar, plus the drink Ty supplied)
- **Rams:** a creature roar or snort as a stand-in for the summon (note the real sheep/goat gap).
- **Game mode:**
  - "Fight!" start
  - Siege capturing tone, contested warning, zone-moving alarm
  - victory (Ty's) and defeat (find one or derive it)
  - score tick
  - countdown tick
- **UI:** click, vote, kill sting (has Ty's).
- **Background:** the lofi track as **menu and lobby music**, looping, with a short fade, played on the join screen, the end
  screen and the vote. The existing outdoor ambience stays under gameplay.

## Stage 2: spells agent (owns public/sounds, audio.js and the call sites)
After the cast-root work: read `/tmp/wa-sounds/staged/MAPPING.md`.
- **Integrate:** copy the picks into `public/sounds/`, update the manifest, and wire every slot (many need new hooks: reload,
  hit marker, ult ready and wind-up, the Siege tones, menu music with a mute and volume that respect the existing settings).
- **Prune:** delete every file in `public/sounds/` no longer referenced by the manifest or code. Report MB before and after.
- **Credits:** update `CREDITS.md` with every source and licence, and add a visible **credits line** (pause menu or join
  screen) crediting Leonardo Calvo (CC BY 4.0) and the music.
- **Verify:** check every sound decodes in Playwright, and listen-proxy the levels so nothing is too loud relative to the rest.
- **Write `docs/agents/sound-report.md`:**
  - what's wired where
  - what was pruned
  - **what's still missing** (e.g. sheep or goat bleats, hooves, defeat sting), with concrete suggestions
