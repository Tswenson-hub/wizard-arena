# Characters hand-off

## Round 15: the KayKit Mage, the Skeleton bots and the animation remap

### Commits
- `a6ca00d`: requests.md, the body API, the scale confirmation and the named phases.
- `bed8d42`: the models. This adds `public/models/characters/` (1.3 MB) and `tools/build-characters.mjs`.
- `edf8221`: the code. It touches looks.js, spellanim.js, wizard.js (the parts the brief gave me) and select.js.
- `5550268`: Shoot's release time, and the preview framing.

### What I built
- **Models** (`node tools/build-characters.mjs [packsDir]`, which reads Ty's packs in ~/Downloads):
  - Five bodies:
    - `mage.glb` (116 KB)
    - `skeleton_mage.glb` (115 KB)
    - `skeleton_warrior.glb` (144 KB)
    - `skeleton_rogue.glb` (121 KB)
    - `skeleton_minion.glb` (107 KB)
  - Each body's skinned parts are joined into one mesh per material, so the Mage is one draw call plus its staff. The hat is
    kept.
  - Weapons are baked under the hand slot, each with a `tip` node at its far end:
    - Mage: the KayKit `staff`
    - Skeleton Mage: the skeleton staff
    - Warrior: the axe, with a shield in the left hand
    - Rogue: the crossbow
    - Minion: the blade
  - The atlas is a 512 webp, and everything is meshopt-compressed.
  - Node names lose their dots (`handslot.r` becomes `handslot_r`), because three strips dots.
- **`clips.glb`** (757 KB, about 240 KB gzipped): 62 Rig_Medium clips from General, MovementBasic/Advanced,
  CombatRanged/Melee, Special and Simulation (Lie_StandUp).
  - It holds the skeleton only. Tracks that never leave the rest pose are dropped, and rotations are normalized int16.
  - The clip pool, `bakeClipPool`/`retargetClip`, `MODEL_CLIPS`, `SHARED_CLIPS`, `POOL_SOURCES`, `PROPS`, `WHIPS`,
    `POTIONS` and the hero bodies are gone from looks.js.
- **looks.js:**
  - `BODY_SCALE = 1.8/2.16` (0.8333). It's agreed with environment and matches map.js's `KIT_SCALE`.
  - `BONES` and `bone(model, role)`, `BODY_TOP` (2.21 m, the hat tip).
  - `makeWizardBody(loadout, { body })` returns `{ model, clips, kind, look, setLook, hand, head, tip }`.
  - `botBody(seed)`; the pick DSL (cut, warp, reverse, flatY, pinXZ, yaw) is now on the KayKit rig.
  - `registerModel` is a no-op. main.js still loads `wizard.glb` until spells drops it.
- **Element tint by atlas region:** KayKit's atlas is flat swatches, so the shader re-hues three UV rectangles of
  `mage_texture` and keeps their gradient:
  - robe, sleeves and hat
  - the cape: it takes the second element when two or more spells share it
  - the staff gem: the element's bolt colour
  - Arcane keeps KayKit's purple. The auras are kept and hang off `BONES` (fire and arcane at the staff tip, ice shards
    on the shoulders).
  - Skeletons have no tint. Their eyes (the `Glow` material) burn in the element colour, with half-strength auras.
- **spellanim.js:** every key is remapped to KayKit clips per the brief's table. Releases were measured as the staff tip's
  speed peak (`/tmp/wa-characters/r15/tr.py`).
  - **Primaries:** every shot strikes at 0.08 s.
  - **Wind-ups:** meteor's tip peak is at 1.22 s (target 1.25), the ultimates' at 1.28 (target 1.3), Lash at 1.57 (target
    1.5), cyclone at 0.45 (target 0.45).
  - **Summons** (Battering Ram, Night Cage, Stampede) drive the staff into the ground on the release.
  - New: `PHASES` (named phases for main.js), `FLIPS` (procedural flips) and `SKELETON_ANIMS` (taunt, spawn, death, idle).
- **wizard.js:**
  - `LEG_BONES` reads from `BONES`; one-shots play once and clamp, while the loops are listed.
  - `pose(name, duration, {fit})`.
  - The old offset calls (`cast_fast` from 0.25, `cast_heavy` from 1.9, `stun`, `dash`) are translated to phases, so main.js
    works unchanged.
  - **Procedural flip:** a full turn on `model.rotation.x` about the body's middle (0.85 m) for `double_jump`(_back),
    `roll_air`(_back) and `smoke_screen`. Meteor Rain's dive pitches the body head-first.
  - Strafe clips play when moving sideways.
  - **On a respawn,** a skeleton awakens and a Mage plays the Spawn_Air drop. A skeleton taunts when its kill count rises.
  - The ward is 1.25 / 1.3 at 1.05 m and encloses the hat. The nameplate is at 2.61 m, the health bar at 2.38 m.
  - The charge orb and the TK beam start at `tip`.
- **select.js:** the preview frames the Mage (3.0 m × 2.8 m), idles at 1x and plays the spell clips on hover.

### Verified (port 4103, headless Chromium; everything is in `/tmp/wa-characters/r15/`)
- **Game, 3 bots:** loads with **no console errors or warnings**. Players are `mage`; bots are `skeleton_warrior` and
  `skeleton_minion` with skeleton names (`game1.png`, `join.png`).
- **`looks_row.png`:** all seven element looks.
- **`skel_row.png`:** the four skeletons, with element eyes.
- **`acts.png`** (the real `Wizard` class in a test scene), one row each:
  - a walk
  - a fireball shot
  - the meteor wind-up and thrust
  - a legacy `cast_heavy` call becoming the release
  - the ward bubble
  - the double-jump flip
  - a roll left
  - a knockdown, then Lie_StandUp
  - the Mage's death
  - a skeleton taunt
  - a skeleton's death collapse
- **`g-flip.png`:** the forward flip in a live game (`rotation.x` 1.66 at 0.15 s).
- **`bp.png`:** the builder preview playing Battering Ram, Frostfall and Gale Shear.
- Key timings are listed above (`keytrace` in `trace.html`).

### Left over, or for others
- **Spells (requests.md):**
  - aim from `me.tip`
  - drop the `wizard.glb` load
  - replace the offset calls with `w.pose(...)`; the translation covers them meanwhile
  - main.js `case 'smoke'` still plays the `back` walk; `playSpell(w, 'smoke_screen', 'cast')` gives the backflip
  - the server's `body` field is already in; the constructor uses it
- **Phase B can delete:**
  - `wizard.glb` and `models/wizards/*`
  - `tools/bake-clip-pool.py` and `tools/prepare-wizard-model.sh`
  - Nothing reads them once main.js stops loading `wizard.glb`.
- **Clips that still read weakly:**
  - Roll: KayKit's Dodge_* is a 0.4 s lean, not a roll. Air rolls get the procedural flip, ground rolls don't.
  - Ram Ride: Crouching stands in for a seat.
  - Black Death: the plain block.
  - Sanguine Lash: a slowed backhand.
  - Glacial Skim: the block-push.
  - Hex Shards: sword slashes.
  - Blink and Mirror Step: Spawn_Air's drop.
  - The Throw-based primaries are fine.
- **Suggestions:** add KayKit's `Rig_Medium_Simulation` `Sit_Chair_Idle` to the build for Ram Ride (one line in `CLIPS`). A
  roll or a flip would need a pack with them on Rig_Medium; KayKit's Character Animations doesn't have one.
- `NATURAL_SPEED` in wizard.js is only a fallback; each gait's speed is measured.

## Round 14: the first-run experience, the builder at three sizes, the Ward bubble

### What I did
- **How to play** (`select.js` `openHowToPlay()`, exported):
  - A card over the page that opens by itself on a first visit to the join screen. It's remembered in localStorage as
    `waHowToPlaySeen` and never opens from the pause menu's builder.
  - It re-opens from a new **How to play** chip next to Randomize. Esc, Enter, "Got it" or a click outside closes it.
  - Contents:
    - the goal: free-for-all, first to **15 kills** (a fixed string matching `FFA.target` in server/match.js)
    - "Build your wizard: one spell per slot", with the stat legend
    - the controls in two columns: Moving (WASD, Mouse, Space, Space ×2, Shift, C) and Your six spells (LMB, RMB, R, E,
      F, Q), then T reload, M mute and Esc menu
    - the goat warning
- **Stat symbols:** damage ✷, cooldown ⟳, range ↔, duration ◷ and wind-up ⧗ are now SVG masks in select.css, not font
  glyphs. The old ⚔ and ⟳ rendered as × and ◇ on some systems.
  - Duration has its own symbol now; it used to share ↔ with range.
  - The **legend** sits in the builder's footer and in the how-to card.
  - The tooltip is 13 px, and each stat row there carries its symbol.
- **Cards, with nothing clipped:**
  - Each card shows a short hand-written line (`CARD_LINE` in select.js) instead of the blurb's first sentence. The
    lines have no numbers, so tuning can't make them wrong. They use a 2-line clamp, and none reaches it.
  - Tags show in order of interest (Combo, Stuns, Roots, …, Projectile last), and only whole tags; the tooltip lists
    them all.
  - A short card (1280×720) first drops its tag row, or its line if that's enough. A combo card drops its line first, so
    the Combo tag stays. No card drops both.
- **Under 900 px wide:** the notice "Best played on a desktop with a keyboard and mouse" replaces the presets, the grid
  and the voice. The name field and Enter stay, for a narrow desktop window.
- **Pause menu builder:** rows were squeezed below the 84 px card minimum, so cards spilled into the next row. A row is
  now at least 84 px, and the panel scrolls.
- **Ward bubble** (`wizard.js` `bubbleMaterial`): a ShaderMaterial with a fresnel rim, a faint fill and ripples drifting
  up, additive.
  - Black Death keeps its opaque dark shroud inside a crimson rim.
  - The Telekinesis shell around a held prop uses the same bubble in purple.
  - `w.wardHit()` flares the bubble for about 0.25 s; spells is asked in requests.md to call it next to `effects.blockFlash`.

### Verified (`/tmp/wa-characters/`, port 4103)
- **`measure.py`** checks every visible card for an element whose text overflows its box, an element past the card's
  edge, or a tag not wholly inside its row:
  - **0 clipped** at 1280×720, 1366×768 and 1920×1080; no horizontal scroll at any size.
  - 1280×720 (cards 125×88): 15 cards drop their tag row and 7 drop their line. Berserker Brew shows Combo and Wind-up.
  - 1366×768 (cards 135×96): 2 drop tags and 2 drop the line.
  - 1920×1080 (cards 195×148): nothing dropped.
- **`shots.py`** at 1280, 860 and 390 px wide:
  - The card shows on a first visit, Esc closes it, and it doesn't come back after a reload.
  - The chip re-opens it, there are no page errors, and the document width equals the viewport.
  - Screenshots: `first_1280.png` (the card), `tip_1280.png` (Brew's tooltip), `after_390.png` and `after_860.png` (the
    notice).
- **Bubble screenshots** in a live match: `ward_black_death.png` (the shroud) and `ward_ward.png`, which now shows the TK
  shell; the TK check overwrote the blue Ward shot, which I had looked at before. `pause_1280.png` is the pause builder.
- **Card numbers against the spells agent's round 14 constants** (`ab77100`), with damage ×1.3 on the cards:
  - Spark 12 → 16, Hex 14 → 18, Sling 10 → 13 + ram, Fireball 16/24 → 21/31, Skim 3 × 12
  - Meteor cooldown 4 s, Battering Ram 70 (not "kill"), Trapped Relic 6 s, Sanguine Lash 9 s, Frostfall 10 s
  - Tempest Veil 7 s, Black Death about 3.5 s, and Bulwark's 80 HP in its tooltip
  - All of them match. The cards read SPELL_INFO, so later tuning carries through by itself.

### Left over, or for others
- **Spells** (requests.md):
  - `#helpBtn` should call `Select.openHowToPlay()`.
  - The header `.sub` still says "first to 10 kills".
  - `target.wardHit?.()` is the optional flare.
- The how-to card's "15 kills" is a string. If `FFA.target` changes, update it in select.js.
- Headless runs, after joining a match: the client showed "Disconnected from server" a few seconds in, and the server log
  shows the player leaving. Seen twice, with the in-progress server code on my port. I didn't look into it (spells' code).
- `window.__wa` now needs `?debug` (spells' change); my scripts in `/tmp/wa-characters/` use it.


## Round 13b: Ty's second Jeb export (flips, jumps, landings, the air cast, the crouch)

### What I did
- **Import:** Ty's export (`Meshy_AI_shepherd_wizard_3d_All_Animations (1).glb`, 10.4 MB, same 66-joint rig) is a
  new pool source.
  - It went through `tools/prepare-wizard-model.sh … jeb2 64` and became `public/models/wizards/jeb2.glb` (1.4 MB). It's
    only read by the bake; no page loads it.
  - `jeb.glb` and its older clips (Sword_Judgment and the rest) are untouched.
  - Its Running and Walking are skipped as duplicates, so the pool gains 7 clips. Pool: **47 clips, 848 KB** (was 40,
    719 KB).
- **`looks.js`:** `POOL_SOURCES.jeb2`, and a new pick option `pinXZ`. It keeps the hips' rise and fall but drops their
  drift; this is for landings and the crouch walk, whose clips travel up to 1.2 m.
- **`spellanim.js`:** each key below replaces round 13's version, after a side-by-side on the sheets:
  - **`jump`** (the takeoff): `Basic_Jump` 1.72–2.25 s in 0.25 s. The legs drive straight and the arms rise. It reads
    as a real jump, where the old cut read as a sword leap.
  - **`double_jump`:** a layout **front flip**. It's `Backflip` 0.6–1.4 s played backwards: tucked, over the top at 0.2 s,
    then opening out arms-up.
  - **`double_jump_back`:** the backflip itself. Both are 0.45 s with the hips pinned.
    - `airJump()` picks the backflip when the measured velocity runs backwards against the facing, so no hook is needed.
    - Both beat the round 13 roll somersault: they're extended and acrobatic rather than a ball.
    - `Backflip_Jump`'s flip is a tighter tuck; its in-air part is about 0.8 s, so it would need a 1.8× squeeze. `Backflip`
      read better.
  - **`land`** (the hard landing, after an air jump or a drop of 3 m or more): `Dive_Down_and_Land_2`'s three-point
    crouch, one hand down and the staff out. Crouched by 0.05 s, standing by 0.4 s, or 0.22 s when landing on the run.
  - **`land_soft`** (after a plain jump): `Basic_Jump`'s dip and rise, 0.25 s, or 0.15 s on the run. Stepping off a ledge
    plays nothing.
  - **`air_cast`:** `Jumping_Punch`'s in-air strike, knees tucked, with the strike at 0.1 s. `wizard.js` plays it in place
    of any cast `oneShot` while airborne. It doesn't for rooting wind-ups (those hang in their own pose), whole-body moves,
    or mobility casts.
  - **`crouch_walk` / `crouch`:** `Crouch_Walk_with_Torch`, the walk and a held frame. The existing crouch branch in
    wizard.js picks them up, so the squash stand-in is off. The walk is speed-scaled (natural 1.3 m/s).
    - The torch arm is the staff hand, so the staff is carried low and forward like a spear. It reads fine, so nothing is
      hidden.
  - **`smoke_screen`:** `Backflip` from takeoff to landing (over by 0.3 s, up by 0.5 s). Graded `good` now.
  - **`mrain_land`:** Meteor Rain's landing is now the three-point superhero crouch (0.8 s). It was Embibe's crouch-rise.
- **`wizard.js`:** landings are decided per airtime from `jumping`, `inAir` and the peak height, for every wizard. Flips,
  air casts and air rolls may be cut short by a landing; anything else playing at touchdown goes on.

**Not used:**
- **`Leap_Right_and_Catch`:** a small upright side hop. The pinned side roll tumble reads better as an air dodge.
- **`Dive_Down_and_Land_2`'s dive half:** it starts head-down. After Meteor Rain's hover tuck it would snap, so the Cinder
  dive stays.
- **`Backflip_Jump`:** see above.

### Verification (port 4103, `WA_DEBUG`, headless Chromium with the Metal flags)
- **Clip sheets** in `/tmp/wa-characters/r13/`: `jeb2-a.png` and `jeb2-b.png` (raw), `c1.png` to `c3.png` (candidates),
  and `final1.png` and `final2.png` (every final key).
- **In game** (`jeb2game.py`, real keys):
  - **Single jump:** `jump`, `float`, `land_soft`, `idle`, peak 1.45 m.
  - **Double jump with W:** `jump`, `double_jump`, `float`, `land`, `walk_fight`, peak 2.59 m.
  - **Double jump with S:** the same with `double_jump_back`.
  - **Air cast:** LMB mid-jump played `air_cast` at 1.31 m, then `land_soft`.
  - **Crouch (C):** `crouch` standing, `crouch_walk` with W.
  - **Meteor Rain:** `mrain_land` on the impact.
  - **Screenshots:** `g-sheet.png` (takeoff, air cast, hard and soft landings, crouch walk, crouch, Meteor Rain landing)
    and `g-flips.png` (front flip and backflip mid-turn).
  - No page errors.
- **Smoke Screen in game is pending.** main.js's `case 'smoke'` plays the `back` walk directly. I asked the spells agent to
  try `playSpell(w, 'smoke_screen', 'cast')` first (`requests.md`). The key itself is on `final2.png`.

### Notes
- An occasional `stun` shows in the traces. It's main.js's hit or block flinch from the bots, not these clips.
- **Still wanted from Meshy:**
  - an airborne cast with both arms forward (the punch is one-armed)
  - a hunched shroud for Black Death
  - a whistle for Ram Guard

## Round 13: the jump, the double-jump flip, landing, air rolls, the hover and casting on the move

### What I did
- **`spellanim.js` (`COMMON_ANIMS`, on every body):**
  - **`jump`:** the push-off for the first jump. It's Jeb's `Sword_Judgment` leap (0.6–0.9 s, the legs driving straight and
    the staff arm going up), squeezed into 0.2 s with `flatY: 0`. Then the shared `float`.
  - **`double_jump`:** the air jump's flip. It's Cinder's `Roll_Dodge` (0.55–1.8 s) with the hips pinned (`flatY: 0.1`), so
    the tuck-and-roll becomes a tucked front somersault in the air. The head is lowest at 0.1 s and the body is upright
    again by 0.3 s; the whole key is 0.45 s, then `float`.
  - **`land`:** after an airtime with an air jump in it. It's Jeb's landing kneel with the staff driven down
    (`Sword_Judgment` 1.16–2.5 s): crouched by 0.04 s, held to 0.12 s, standing by 0.3 s.
- **Air rolls:** `roll_air`, `roll_air_back`, `roll_air_left` and `roll_air_right`. They're the roll keys with the hips pinned:
  a front flip, a backflip and a sideways tumble each way. `rollKey(dir, yaw, air)` takes a third argument to pick them.
- **`wizard.js`** (§4 gave me these hooks):
  - **`airJump()`:** plays the flip. main.js calls it for us and on `jump` with `n: 2`.
  - **The push-off** plays on `jumping`'s rising edge.
  - **The land kneel** plays when an airtime with an air jump in it ends. It lasts 0.28 s, or 0.15 s when landing on the run
    so the feet don't slide.
  - **`hovering`** keeps the wind-up's pose instead of the float and adds a bob of 0–11 cm.
  - `jump`, `double_jump` and `land` play once and hold their last frame.
- **Casting on the move** (the spells agent asked for it in `requests.md`, now that only the big wind-ups root). A cast
  that doesn't root plays on the upper body while the legs walk, run, backpedal or stand.
  - Each clip gets an upper-body copy and a legs copy (the hips and legs). Each copy holds only its own bones' tracks, so
    every bone has one driver, and the copies are made on first use.
  - The split starts the moment you move during a cast and rejoins when you stop or leave the ground.
  - A primary's next shot keeps the legs in stride.
  - Whole-body moves never split: jumps, the flip, rolls, hits, deaths, rides, the Meteor Rain dive and Lash.
- **The spells agent wired all of it** in main.js: `w.airJump()`, `playRoll(w, dir, air)`, `w.hovering` and `me.jumping`
  through a hover or air dash.

**Why the roll and not `Dive_Down_and_Land`, which the brief suggested.**
- In the dive, 0.2–0.5 s is a static tuck with no rotation. Its somersault (0.6–1.2 s) ends head-down, because it's a dive.
- The roll with its hips pinned is a full 360° that ends upright. It reads as a front flip from the side and from behind.
- The roll was enough, so no procedural rotation was needed and `model.rotation.x` stays as it was.
- Sheets: `/tmp/wa-characters/r13/raw1.png` (raw clips), `cand1.png` and `cand2.png` (the candidates), and `keys.png` (the final
  keys: push-off, flip side-on and from behind, land, air rolls).

### How I verified it (port 4103, headless Chromium with the Metal flags)
- **Contact sheets** of the final keys: `/tmp/wa-characters/r13/keys.png`.
- **In game** (`ingame.py`), with real Space presses through the spells agent's main.js:
  - A single jump plays `jump`, then `float`, then `idle`, with a peak of **1.45 m**.
  - A double jump plays `jump`, `float`, `double_jump` (at 0.28 s), `float`, `land`, then `idle`, with a peak of **2.59 m**.
  - Frames are in `dj-sheet.png`: the push-off, the tuck, the turn over the top and the land kneel with its dust. The burst
    ring is the spells agent's.
- **Air rolls** (`airroll.py`): E in a jump with W, S, A or no key played `roll_air`, `roll_air_back`, `roll_air_left` and
  `roll_air_back`, then `float`.
- **Hover** (`hover2.py`): a Meteor charge (right mouse) started mid-jump played `cast_heavy` with `hovering` set, at a
  steady 1.31 m for about 1.45 s, with a bob of 0–0.108 m. Then `float`, the throw and `idle`. The frame is
  `hover-meteor.png`.
- **The cast split** (`split.py`):
  - Walking forward and casting puts `fireball3^up` at weight 1 and `walk_fight^legs` at 1, and nothing else.
  - Starting to walk mid-cast splits it. Stopping mid-cast swaps the legs to `idle^legs`.
  - After the cast it's `walk_fight` alone. The frame is `split-walkcast.png`.
- No page errors in any run. `node --check` passes on both files. The server loads neither file, so no botmatch was needed.

### Known issues and notes
- The **hover** holds the ground wind-up pose (standing) in mid-air, as the brief asked. A nicer look would be the split:
  the float's tucked legs under the wind-up's arms. That's a small follow-up if Ty wants it.
- A **cast started right as you stop** (while the measured speed is still above 0.4 m/s) splits with standing legs. That's
  fine, but it's slightly less expressive than the whole-body cast.
- The **split's hips come from the walk**, so a cast's forward lean through the hips is lost while walking. The spine and arms
  are kept.
- **`roll_air_back`** is the forward roll reversed. It ends in the tuck, then cross-fades to `float`.

### Meshy exports for Ty (to replace stand-ins)
- **A true front flip** in the air (a tucked somersault, about 0.5 s, ending upright). It would replace the pinned roll for the
  double jump.
- **A backflip** (a standing back tuck). It's for `roll_air_back`, Smoke Screen's leap and a backward air jump.
- **A jump takeoff:** a crouch, an explosive push-off and the knees coming up (about 0.3 s). The push-off is now a cut from
  a sword leap.
- **A landing:** a short absorb-and-rise crouch, without the sword-kneel flourish.
- Optional: an **airborne cast pose** (legs tucked, both arms forward) for casting in the air and the hover.

## Round 12: the Cinder re-import, Roll, and Meteor Rain's dive

### What I did
- **Cinder re-imported** from `~/Desktop/Meshy_AI_cinder_pyromancer_rig_All_Animations (2).glb` with
  `tools/prepare-wizard-model.sh … cinder`. It has the same 66-joint Mixamo-style rig and 18 clips (the old 14 plus
  `Dive_Down_and_Land` 1.6 s, `Roll_Dodge` 1.83 s, `Roll_Dodge_2` 2.0 s, `Roll_Dodge_4` 3.13 s). `cinder.glb` is 2.09 MB
  (was 1.78 MB).
- **Clip pool re-baked** (`tools/bake-clip-pool.py 4103`): 40 clips, `clip-pool.glb` 718 KB (was 660 KB).
- **`spellanim.js`:**
  - **`roll`:** four 0.45 s keys cut from `cinder.Roll_Dodge` 0.55–1.8 s and time-warped: tucked by 0.08 s, over by 0.32 s
    (the dash is 0.35 s), standing by 0.45 s.
    - `roll` goes forward and `roll_back` is the same roll reversed. `roll_left` and `roll_right` are turned ±90°.
    - `rollKey(dir, yaw)` picks one from the roll's world direction and the body's facing. It's unit-checked for all four.
  - **`meteor_rain`:** wind-up, hover, dive and land keys (details below).
- **`looks.js` pick options:** `reverse: true` plays a cut backwards. `flatY: dy` pins the Hips at their rest place, dy m above
  standing height, which drops all root motion; it's for airborne clips on a body the server flies.
  - The offset is converted into the hips' parent space, because Meshy armatures are Z-up and scaled by 100.

**Why `Roll_Dodge` won.** It is one tight forward roll that ends standing, so it survives a 2.8× squeeze.
- `Roll_Dodge_2` spends its first 0.7 s shuffling before it rolls, and its roll is looser.
- `Roll_Dodge_4` is a sideways tumble that ends in a low crouch, so a 0.45 s cut ends crouched and pops to idle.
- Contact sheet of all three: `/tmp/wa-characters/r12/rolls.png`.

**Meteor Rain, and where it differs from the brief.** `Dive_Down_and_Land` has **no crouch or take-off**. It starts already in
the air (hips about 2.2 m up), tucks, somersaults forward, and ends in a **head-first plunge**
(`/tmp/wa-characters/r12/dive.png`). So:
- **Wind-up (1.3 s):** it keeps the crouch-and-leap (`jeb.Sword_Judgment`, crouched at 0.55 s, leaving the ground on the 1.3 s
  release).
- **`hover`:** the clip's opening tuck (0–0.6 s), slowed to 4.5 s, covering the 0.5 s rise and up to 4 s of hover. It replaces
  the shared `float`, so the `float` loop is gone from Meteor Rain.
- **`dive`:** 0.6–1.6 s of the clip, warped to 0.6 s (= `MRAIN.dive`).
  - She somersaults and is head-down by about 0.44 s, then holds the plunge.
  - The head is 0.13 m off the ground when `mrainLand` fires, so the plunge lands on the impact.
- **`land`:** after the impact she comes up out of a crouch in the blast (0.8 s, `embibe.Female_Crouch_Pick_Throw_Forward`).
- The spells agent wired all four phases and the roll in `main.js` (`ed85e1c`), from my request in `requests.md`.
- **The wind-up timing also changed for every ultimate:** `ultWindup` now plays each ult's `windup` phase at 1x.
  - Before, the whole key was squeezed into 1.3 s, so releases landed about 15% early.
  - Now Meteor Rain's leap lands on 1.3 s.

### How I verified it
- **Contact sheets** (the real `makeWizardBody` path), in `/tmp/wa-characters/r12/`:
  - `mrain.png`: the hover, dive and landing keys, with hips and head heights per frame
  - `roll.png`: all four roll keys
  - `rolls.png` and `dive.png`: the raw clips
- **In game**, `/tmp/wa-characters/r12/ingame1.py`, one headless page on port 4103 with `WA_DEBUG`:
  - We cast through the server and `main.js`'s real hooks. The render camera is moved side-on, and the pose is held at the
    asked time once the phase starts, because swiftshader runs at about 2 fps.
  - **Real `main.js` (after `ed85e1c`):** `verify-r12.png` has the wind-up, release, hover at 12 m, landing frame (dive at 0.6 s,
    on the ground), the rise, and rolls forward, left and back.
  - **Rolls:** E with W, with A, and with nothing played `roll`, `roll_left` and `roll_back`, and each moved 4.3–4.5 m.
  - **Clearer wind-up and release frames:** `mrain-crops.png` is the same keys from an earlier run on a HEAD snapshot. In the real
    run a hay bale and the ult beam hide the body.
  - **Mid-dive:** not caught in game, because the 0.6 s dive passes within one or two frames at that frame rate. The contact sheet
    covers it.
- `node --check` passes on `looks.js` and `spellanim.js`, and no page errors came up in the in-game runs. The server loads neither
  file, so no botmatch was needed.

### Known issues and notes
- The somersault turns her body away from her facing for about 0.3 s. That's fine for a falling blaze, but say if Ty wants a
  straight drop. The fix would be `dive` = `[1.2, 1.6]` only.
- `roll_back` ends in the dip pose the forward roll starts from, then cross-fades to idle (0.25 s). A real backward roll from Meshy
  would read better.
- A bug I caught before committing: `pick.reverse` is true on every array pick (`Array.prototype.reverse`), so the check is
  `=== true`.
- **For the coordinator:** while I worked, `world.js` (environment, uncommitted) briefly threw on load:
  `blocked` at world.js:820, "reading 'x'". It loads fine now.

## Round 11: the spell builder, the generic wizard and the spell animation table

### What I built
**The builder** (`public/js/select.js` `mountSpellBuilder`, `public/css/select.css`). It replaces the hero picker; that
picker and its CSS are deleted (they're in git history).
- **API:** the spells agent's API, `mountSpellBuilder(container, { loadout, voice, onChange, onVoice, footer })`, returns
  `{ set, setVoice, footer, loadout, voice, destroy }`. `footer` is an element placed in the bottom bar, for the name field and Join.
- **Layout:**
  - **Top:** six presets (`C.PRESETS`), with the matching one lit; 🎲 Randomize (`C.randomLoadout`); three saved slots
    (`loadout-store.js`).
    - Save fills the clicked slot, or the first empty one, and names it by the mix ("Ice + Blood 1").
    - Clicking a filled slot loads it.
  - **Left:** six slot rows (`C.LOADOUT_SLOTS`, with keys and labels from `C.SLOT_INFO`), each with every spell of
    `C.SPELL_POOL[slot]` as a card. A card shows:
    - the Raven icon, the name, and its element colour (top stripe, tint, glow when selected)
    - the blurb's first sentence
    - stats from `C.spellInfo`: ⚔ damage, ⟳ cooldown, ↔ range or duration, ⏳ wind-up
    - tags, with Combo in gold
  - **Right:** a live preview of the generic wizard in the loadout's look. Hovering or focusing a card plays that spell's cast
    from the animation table (a primary plays its magazine's shots in turn), and the spell's name shows under it.
    Below it: the element mix (a bar and counts) and the active combos with their text.
  - **Bottom:** the voice (Male / Female) and the footer slot.
- **Tooltips** (hover or keyboard focus): the full blurb, every stat, the element and slot, the tags, and each combo with its partner.
- **Keyboard:** one roving tab stop across the grid. ←/→ move within a row, ↑/↓ move between rows, Home/End go to the row's
  ends, and Enter or Space picks. Keys don't propagate, so nothing casts in the Esc menu.
- **Sizes:** designed for a full-screen container.
  - At 1280×720, a card that would overflow (a two-line name) drops its blurb: `.tight`, set by a ResizeObserver.
  - At 1500 px and up, blurbs get two lines and the icons grow.
  - Under 980 px (an embedded panel), the preview goes on top and each row scrolls sideways.
- **The preview** is one small WebGL canvas, rendered at 30 fps only while the builder is on screen (IntersectionObserver).
  The camera always frames 3 m × 2.1 m, so a raised staff or wide arms stay in view.

**The generic wizard** (`public/js/looks.js`):
- `makeWizardBody(loadout)` returns `makeGenericBody`: `{ model, clips, look, loadout, setLook }`. A hero id still works:
  it gives the generic wizard in that hero's old kit.
- **Look by mix** (`lookOf(loadout)`, built on the spells agent's `C.loadoutElements`):
  - The dominant element sets the robe, through the same recolour shader as before (`ROBES`: fire keeps the base red; wind,
    ice and blood reuse Gale's, Rime's and Vesper's tuning; earth is tan, alchemy green, arcane blue).
  - A second element with two or more spells tints the dark cloth 30% toward its colour and adds a half-strength aura.
  - **Auras** (`AURA`, one draw call each):
    - fire: ember glow and sparks at the hand
    - wind: violet motes
    - ice: frost shards on the shoulders, and snow
    - blood: a crimson halo, smoke, sparks and a dark pool
    - earth (new): dust and hopping pebbles at the feet
    - alchemy: bubbles, plus drops dripping from the hands (new)
    - arcane (new): motes circling the staff hand, shown only when nothing else leads
  - `setLook` re-tints and swaps the aura in place.
- **No hero models load any more** (`HERO_BODIES.load = false`), which saves about 10 MB per visit.
- **Clips depend on the loadout** (cached per loadout): the base clips, `COMMON_ANIMS`, each equipped spell's keys, and the
  older shared keys filled from the spells that have them (`combo1..3`, `spin`, `lash`, `ult`, `ride`, `flask_step`, `arrival`).
  Today's main.js calls work unchanged.

**The clip pool:** every clip of the six hero exports, 36 unique, retargeted onto the base wizard's 24-bone rig.
- `bakeClipPool` in looks.js maps Mixamo bones to the base rig, the inverse of `MIXAMO_TO_BASE`.
- It's baked into `public/models/wizards/clip-pool.glb`: 2.0 MB raw, then 1.57 MB after resample, then **676 KB** after meshopt.
- Tool: `tools/bake-clip-pool.py [port]` (new, characters-owned). It drives the game page headless, exports the bones and
  clips with GLTFExporter, then runs gltf-transform resample + meshopt.
  **Re-run it after adding a Meshy export to `POOL_SOURCES`**, then pick from it in spellanim.js.
- Clips are named `hero.Clip` (`embibe.Triple_Combo_Attack`). The base clips are reachable as `base.cast_heavy` and so on.

**The per-spell animation table** (`public/js/spellanim.js`, new, characters-owned). Every pickable spell has an entry:
- `keys`: pool cuts in the same pick format as before (a clip, `[clip, from, to, dur]`, or `{ clip, from, to, warp, yaw }`).
- `play`: phase → `Wizard.oneShot` arguments. The phases are shot, windup, cast, release, channel, hold and loop.
- `release`: where the spell leaves the hand.
- `legacy`: the older shared keys it fills.
- `grade` and `need`.
- `spellPlay(id, phase, n)` is the lookup.
- **Release frames were measured**, not guessed: each pool clip's right-hand speed peaks
  (`/tmp/wa-characters/r11/trace.py`, `trace.json`).
  - Primaries' strikes are cut so the peak lands at 0.08 s (the bolt spawns as the shot plays).
  - Wind-ups are warped so the peak lands exactly at the spell's wind-up length (Meteor 1.25 s, Lash 1.5 s, Ram 0.8 s,
    Cyclone 0.45 s, every ultimate 1.3 s).
- Checked on contact sheets of the generic wizard: `/tmp/wa-characters/r11/prim.png`, `power.png`, `ult.png`.

### Animation status, for Ty (what to export from Meshy next)
**Missing** (stand-ins that don't sell the spell):
- **Blink:** a short forward lunge or vanishing crouch (the base dodge is a sidestep).
- **Mirror Step:** a fast forward dash (a sprint-start lunge).
- **Smoke Screen:** a backflip or backward leap (it's a 6.5 m leap; now it's a quick backpedal).
- **Smoke Flask:** a flask smashed down at the feet.

**OK** (works, a better clip would help the tell):
- **Spark:** a quick one-handed flick (now the same flick 3×).
- **Glacial Skim:** a low underhand sweep along the ground.
- **Hex Shards:** a sign-tracing gesture (left, right, up). Vesper's own cast is too slow for a 0.45 s shot.
- **Shepherd's Sling:** a sling whirl and sidearm release.
- **Battering Ram:** a big two-footed stomp or ground punch. Jeb's stomp is legs-only and reads weakly on the generic wizard.
- **Toxic Flask:** a standing underhand lob (the pool's lob starts from a crouch).
- **Skyward Flash:** a crouch-and-launch straight up.
- **Ram Ride:** a seated riding pose.
- **Black Death:** a hunched, arms-wrapped shroud (it blocks every side; the front block undersells it).
- **Firewall:** a sweeping arm raise from low to high.
- **Tempest Veil:** an upper-body swirl that blends over running.
- **Ram Guard:** a whistle or shepherd's-call gesture.
- **Trapped Relic:** a two-handed curse gesture over an object.
- **Meteor Rain:** a crouch-and-leap up, a hover pose, a diving fall.
- **Eye of the Storm:** a looping full-body spin.
- **Night Cage:** both fists slammed to the ground.
- **Berserker Brew:** a drink with a flask in hand. The generic wizard holds no flask; or fit Embibe's potion prop to it.

**Good:** Fireball, Gale Shear, Potion Toss, Meteor, Arcane Cyclone, Sanguine Lash, Frostfall, Flask Step, Ward,
Glacial Bulwark, Telekinesis, Blizzard, Stampede.

To add a clip:
1. Prepare the export (`tools/prepare-wizard-model.sh`, or just the rigged GLB).
2. Add it to `POOL_SOURCES` in looks.js.
3. Run `python3 tools/bake-clip-pool.py`.
4. Run `trace.py <clip>` for its release peak.
5. Set the spell's `keys` and `play` in spellanim.js.
6. Check it with `sheet.py out.png <spell>`.

### Verification
- **Screens:** `/tmp/wa-characters/r11/builder-1280.png`, `builder-1280-hover.png` (tooltip and Frostfall cast in the preview),
  `builder-1920.png`, `builder-1920-hover.png`, and `fn-icebuild.png` (an ice + blood build: blue robe, frost shards,
  Blood Lash combo active). There is no page scroll at either size.
- **Functions** (`builder_fn.py`):
  - card clicks call `onChange` with full, valid loadouts
  - the Jeb preset fills all six slots and lights its chip
  - Save writes `wizardLoadouts`, and the slot survives a reload and loads back
  - Randomize gives a full loadout
  - keyboard: →→↓ Enter picked Arcane Cyclone, and ↑ Space picked a primary; the tooltip follows focus
  - the voice calls `onVoice`
  - no console errors
- **In game** (`ingame.py`, port 4103): four players, each body with a look by mix (ice, blood, wind, earth) and 27–30 clip
  keys including `combo1` and `ult`. No `[looks]` warnings, no errors. `ingame-1.png` shows the local ice wizard in the arena.
- The botmatch wasn't run: I touched no server-loaded file.

### Known issues and asks
- **The join screen and Esc menu still mount the builder in narrow panels** (690 px), so it shows its scrolling fallback. Asked
  the spells agent for a full-screen mount with the name, bots and Join passed as `footer` (`requests.md`, "round 11 builder…").
- **The 14 new icons** in `public/textures/icons/` need rows in its `CREDITS.md` (asked in the same request). The pack numbers:
  - ward fc856, black_death fc859, tempest_veil fc857, ram_guard fc853, smoke_flask fc830, smoke_screen fc755, blink fc1077
  - skyward fc874, mirror_step fc1078, ram_ride fc885, telekinesis fc1082, night_cage fc1180, stampede fc1045, berserker_brew fc961
- **`float` is on every body now** (Rime's airborne pose), so every jump uses it. Drop it from `COMMON_ANIMS` if it reads oddly.
- **Pool clips keep their first frame's hip offset** (up to 25 cm for Embibe's crouch throws), as the hero bodies did.
- **The generic wizard has no flask or whip props**, so those hero props are gone with the heroes.

---

## Rounds 4–10 (the hero era; kept for history and for the model pipeline)

## What I built
**Wizard picker** (`public/js/select.js`, `public/css/select.css`)
- `mountWizardPicker(container, { selected, onChange(id) })` returns `{ set(id), destroy() }`, exactly as briefed.
  The spells agent's `#joinPicker` / `#pausePicker` mounts use it. Their `<select>` fallback no longer triggers.
- The picker shows four cards, two by two. Each card has:
  - a live 3D preview: `makeWizardBody(id)` playing idle and slowly turning, and a cast flourish when the wizard is picked
  - the name in the accent colour, the title and the role
  - the five spells: key, name and blurb from `SPELLBOOK`. A missing entry falls back to a prettified id.
- The selected card gets an accent border, a glow and a ✓ badge. Clicking a card or pressing Enter/Space picks it.
  Arrow keys move focus (roving tabindex), and the picker stops those keys propagating, so Space doesn't ward in the pause menu.
- Container queries adapt the layout. Below 600 px wide, each blurb is cut to one line with an ellipsis, and the full
  text is in a tooltip. Below 380 px, the cards go to one column.
- **Rendering:** each picker gets one transparent WebGL canvas laid over its cards, created the first time it shows.
  Every preview is drawn into its own card's rectangle with a scissored viewport.
  - There are no per-card contexts and no pixel copies. My first version copied frames into 2D canvases, which forced GPU readbacks.
  - It renders at 30 fps.
  - An IntersectionObserver stops the loop while the picker is hidden, so it costs nothing during play.

**Stand-in looks** (`public/js/looks.js`): these apply until Ty's models land.
- **Robe recolour in the shader:** red pixels that are saturated enough take the hue of `WIZARDS[id].tint`.
  Black, grey and skin keep their colour, so the texture still reads.
  - `STAND_IN` in looks.js holds per-wizard tuning: a hue override, saturation and value scales, and a shade colour for the dark cloth.
  - Results: Gale is violet, Rime is ice blue with a slate cloak, and Vesper is deep crimson and near-black. Cinder is unchanged.
- **Flair** (`FLAIR` in looks.js) is built inside `model`. It animates itself in `onBeforeRender`, so wizard.js needs no changes.
  - Cinder: an ember glow and rising sparks at `RightHand`.
  - Gale: violet motes with short trails swirling around the body.
  - Rime: frost-shard clusters on both shoulders, attached to the `LeftArm`/`RightArm` bones so they follow the animation, plus light snowfall.
  - Vesper: a crimson halo, dark smoke wisps rising in a spiral, red sparks and a dark pool underfoot.
  - Every effect is one `THREE.Points` draw call with no lights; the Rime shards are 8 tiny meshes.
- **Body structure:**
  - `makeWizardBody` returns `model` as a wrapper `Group` (named `wizardBody`) with the skinned scene inside.
    The death sink in wizard.js can move or tilt it without undoing the per-model normalisation.
  - Every body has its own material clone, so decoy see-through or frost tints only touch that body.
- `looksReady()` (new export) resolves once `loadWizardModels` is done. The picker waits on it.

**Pipeline for Ty's character models**
- `tools/prepare-wizard-model.sh <rigged.glb> <id>` is a new file, outside every ownership row. I'm claiming it for characters.
  - **Inspect:** whether the model is skinned, its bone count, whether it matches the base skeleton, `RightHand`/`Head`, its clips and its bind-pose bounds.
    It refuses static (unrigged) meshes.
  - **Shrink:** weld, resize textures to 1024, webp at quality 80, resample clips (drops redundant keyframes), quantize, prune.
    It keeps the skin and every clip, and doesn't simplify, because skinned meshes tear.
  - Output: `public/models/wizards/<id>.glb`.
- **Runtime** (`loadWizardModels`): for every wizard with `WIZARDS[id].model` set:
  - It loads the model and checks the bone names against `wizard.glb`.
    If every base bone is there, the base clips drive it by bone name, so Ty doesn't need to export animations.
    Otherwise it builds the clip set in this order:
    1. per-wizard picks in `MODEL_CLIPS` (looks.js)
    2. Meshy-named clips (`Running`, `Walking`, `Two_Handed_Parry`, `mage_soell_cast`, `Charged_Spell_Cast`,
       `Stand_Dodge_2`, `Stand_Dodge_3`, including `Armature|X|baselayer`)
    3. any key still missing: the base clip **retargeted** onto the model's rig, through `MIXAMO_TO_BASE`
  - **Mixamo-style rigs** (Meshy's "rig ready" export, `mixamorig:Hips` and so on): bone and track names lose the
    `mixamorig` prefix, so `RightHand` and `Head` exist where wizard.js looks for them.
  - **Retarget** (`retargetClip` in looks.js, not three's): each target bone's rest pose is first lined up with the base
    bone's rest direction, which absorbs A-pose vs T-pose differences. It then follows the base bone's world rotation
    relative to its own rest. The hips also follow the base hips' offset, scaled to the model's hip height.
    three's `SkeletonUtils.retargetClip` copies world rotations as they are, which only works when both rigs share bone orientations.
  - It scales the model to 1.8 m and puts its feet on y = 0.
  - Any failure logs `[looks] …` and falls back to the recoloured base.
  - The flair still applies on top of a real model. Drop a wizard from `FLAIR` if its model makes it redundant (Rime's shards, say).
- **Dry run:** Meshy's rigged `Character_output.glb` from Ty's original zip went from 6.9 MB to 0.73 MB, kept its skin
  (quantize rewrites the inverse bind matrices) and matched the skeleton. It loaded through the own-model path standing in
  as Rime, came out 1.8 m tall with feet at 0, and animated with the base clips with no tearing in idle, run, cast_heavy, block, stun or cast_fast.
  Contact sheet: `/tmp/wa-characters/shots/row-model-sheet.png`.

## When a model lands on ~/Desktop (Meshy_AI_*)
1. `tools/prepare-wizard-model.sh ~/Desktop/<file>.glb gale` and read the inspect lines. It must be the **rigged** export.
2. Set `model: '/models/wizards/gale.glb'` in `public/shared/wizards.js`, and commit wizards.js on its own.
3. If the skeleton differs: Mixamo-style rigs work as they are (own clips where picked, base clips retargeted for the
   rest). Watch its clips on a contact sheet (`/tmp/wa-characters/galeclips2.py`) and add picks to `MODEL_CLIPS`.
   main.js plays casts from fixed offsets tuned to the base clips (spark: from 0.25 s at 2.6×; meteor release: from
   1.9 s at 1.5×; stun: from 0.3 s at 3×), so a pick needs its key moment at about the same time as the base clip.
4. Check facing: Meshy exports face +z like the base. If one doesn't, rotate `inner` in `makeWizardBody`.
5. Screenshot it running, casting, warding and stunned. `/tmp/wa-characters/ingame.py` places all four bodies in the
   live scene, and `ingame.py model` shows how to fake a model URL with an init script.

## Status of Ty's models
- **Gale: in the game.** The source is `Meshy_AI_gale_tempest_rigready_All_Animations.glb`, now
  `public/models/wizards/gale.glb`.
  - Size: 10.7 MB went down to **1.71 MB**, keeping the skin, the normal map and all nine clips. The resample step did most of it (2.97 to 1.71 MB).
  - Rig: Mixamo-style, 66 bones, 1.70 m tall, faces +z. The game normalises her to 1.8 m.
  - Picked by watching contact sheets of every clip (`gale-clips.png`, and `gale-clips2.png` side by side with the base):

    | key | clip | why |
    |---|---|---|
    | run, walk | `Running`, `Walking` | |
    | cast_fast | `mage_soell_cast` | an overhead flick thrown forward. It's the same Meshy move as the base spark cast, with the same timing, so it fits main.js's window as is. |
    | cast_heavy | `mage_soell_cast_1` | gathers, then spreads the arms wide. The spread lands in the meteor release window (1.9–2.7 s). |
    | **spin** (new key) | `Sweeping_Kick` 0.8–1.7 s | the low spinning floor sweep. It reads well as the cyclone spin. |
    | block, stun, dash, idle | retargeted from the base wizard | they hold up: a guarded block, a clean flinch and crouch, no flipped limbs (`gale-keys.png`) |

  - Not used: `_2` (turns and jumps, too acrobatic), `_3` (a subtle two-handed push), `_4` (a limp arms-out flick).
    `_5` is 11 s of calm hand gestures and would make a good idle if Ty prefers it to the retargeted base idle:
    add `idle: 'mage_soell_cast_5'` to `MODEL_CLIPS.gale`.
  - Requested in `requests.md`: the spells agent should play `actions.spin` during the Arcane Cyclone spin when a body has it.
    Until they do, Gale spins with the dash clip like everyone else.
  - Her violet flair motes still swirl around the new model.
- **Rime: in the game, with his frost staff.** The source is `Meshy_AI_rime_frost_rigready_3_All_Animations.glb`, now
  `rime.glb`.
  - Size: 10.8 MB went down to **1.43 MB**.
  - Rig: the same Mixamo-style rig as Gale, 1.70 m, normalised to 1.8 m.

    | key | clip | notes |
    |---|---|---|
    | run, walk | `Running`, `Walking` | |
    | cast_fast | `mage_soell_cast_4` | arms and staff flung forward at 0.6–1.4 s, inside the spark/skim window |
    | cast_heavy | `Charged_Spell_Cast_1` | gathers until about 1.4 s, then a wide push from 1.75 to 3.1 s. The charge hold (1.9 s) and the release window (1.9–2.7 s) both land on the push; it's meant for his Frostfall cast. |
    | stun | the base stun, retargeted | a quick recoil and recovery. Fall2 used to be here; Ty said it reads as a fall. |
    | **float** (new key) | `Fall2`, settling over 1.0 s | Ty wants it for the Skyward Flash descent: an airborne pose with knees up and arms out, held (LoopOnce + clamp) for the about 2.8 s descent. Requested in `requests.md`. |
    | **death** (new key) | `Strangled_and_Fall_Forward` 3.6–7.3 s, squeezed to 2.5 s | kneels, then falls flat; he's down before the 3 s respawn. Requested in `requests.md`. |
    | block, dash, idle | retargeted from the base wizard | |

  - **Staff:** `rime-wand.glb` went from 9.4 MB to **261 KB** (simplify 0.25, 512 px textures).
    `PROPS.rime` in looks.js fits it once, in his idle pose, into the right fist: the midpoint between the wrist and the
    middle-finger knuckle, 1.5 m long, gripped 0.6 m from the bottom, upright, with the top leaning 0.12 rad forward and 0.1 rad out.
    It is parented to the `RightHand` bone, so it follows the hand: upright at idle, thrust forward on the quick cast,
    swept wide on the heavy cast, raised in front of his face in the ward, flung in the stagger, and under him in death.
    While running it angles down and forward with the arm swing.
  - **Flair:** the frost-shard clusters are skipped on a real model (his pauldrons are already ice); the snowfall stays.
    The same body is used in the picker preview.
- **Vesper: in the game, with her hemomancer wand.** The source is `Meshy_AI_vesper_hemomancer_rig_All_Animations.glb`, now
  `vesper.glb`.
  - Size: 8.8 MB went down to **1.23 MB**. The wand (`vesper-wand.glb`) went from 8.9 MB to **157 KB**.
  - Rig: Mixamo-style with **50 bones**, fewer finger bones than Gale and Rime. Every bone in `MIXAMO_TO_BASE` and
    `RightHandMiddle1` (for the grip) is still there, so the retarget and the wand fit work unchanged.

    | key | clip | notes |
    |---|---|---|
    | run, walk | `Running`, `Walking` | |
    | cast_fast | `mage_soell_cast_5` 9.9–11.36 s | the quickest readable gesture in the 11 s clip: the arm rises overhead, then flings forward and down, inside the spark window |
    | **lash** (new key) | `Right_Hand_Sword_Slash`, **retimed** to 2.1 s | Ty's choice for the whip. The native strike is at about 0.7–0.85 s, so `warpClip` stretches the crouched wind-up over 1.3 s and lands the strike on the 1.5 s release, then follows through. Play it from the wind-up's start at 1× (requested). |
    | **death** | `Dead` (2.97 s) | staggers, then is flat by about 2.2 s, inside the 3 s respawn. Not trimmed. |
    | cast_heavy, block, stun, dash, idle | retargeted from the base wizard | |

  - **Flair:** the smoke wisps read as grey blotches next to the real model, so they're skipped for her (stand-in only).
    The crimson halo, sparks and pool stay.
  - The wand uses the same `PROPS` fit as Rime's: upright at idle, overhead on the cast, drawn back then swung across in
    the lash, upright in the ward, and under her in death.
- **Cinder: in the game.** The source is `Meshy_AI_cinder_pyromancer_rig_All_Animations.glb`, now `cinder.glb`.
  - Size: 10.7 MB went down to **1.49 MB**.
  - Rig: the same 66-bone rig as Gale and Rime. **He holds no staff or weapon**: the lantern staff from his earlier static
    model isn't part of the rigged export. If Ty sends it as a separate file like Rime's and Vesper's, it goes into
    `PROPS.cinder` the same way.

    | key | clip | notes |
    |---|---|---|
    | run, walk | `Running`, `Walking` | |
    | cast_fast | `Right_Hand_Sword_Slash` | a quick one-handed slash; the strike at 0.7–0.96 s lands in the spark window. It reads punchier than `mage_soell_cast_4`. |
    | cast_heavy | `Charged_Upward_Slash` | gathers low through the wind-up; the upward slash peaks at clip time 1.9–2.1 s. That's the 1.25 s wind-up at main.js's 1.5×, so the release lands on it with no warp. `Charged_Slash` strikes too early (1.1–1.6 s). |
    | **death** | `Fall_Dead_from_Abdominal_Injury` 0–2.8 s, squeezed to 2.4 s | hunches, kneels, and is flat by about 1.9 s |
    | **back** (new key) | `Walk_Backward` | for moving backward relative to facing (requested) |
    | block, stun, dash, idle | retargeted from the base wizard | |

  - Not used: `Walk_Fight_Forward` and `Walk_Fight_Back` are a guarded walk that reads no better as a ward than the retargeted block.
  - **Flair:** the ember glow and sparks at his right hand suit the pyromancer and don't clash, so they stay.
- **Shared clips from Cinder's re-export** (`Meshy_AI_cinder_pyromancer_rig_All_Animations (1).glb`, 14 clips;
  `cinder.glb` is now **1.78 MB**). `SHARED_CLIPS` in looks.js gives **all four** wizards these extra keys:
  Cinder uses them directly, and the others get them retargeted.

  | key | clip | timing |
  |---|---|---|
  | `walk_fight` | Walk_Fight_Forward | slow movement: wind-ups, the ward, slowed (Ty's call; `run` stays each model's Running) |
  | `back` | Walk_Fight_Back | walking backward (it replaces Cinder's Walk_Backward) |
  | `tk_lift` | mage_soell_cast_6, retimed | the arm peaks overhead at 0.35 s (the lift), then settles by 1.1 s |
  | `tk_throw` | mage_soell_cast_4, retimed | the arms fling out at 0.1–0.2 s (the release), then follow through to 1.0 s |
  | `hit_waist` | Hit_Reaction_to_Waist 0.2–1.45 s, squeezed to 0.75 s | hit by a thrown object |

  - `retargetClip` now takes any source rig. Mixamo-style to Mixamo-style uses `MIXAMO_SAME` (same names), and it works
    on Vesper's 50-bone rig too (close-up: `shared-keys-vesper.png`, no tearing).
  - The loader now loads every model first, then builds the clips.
  - **Gait speeds:** each body's `run`, `walk`, `walk_fight` and `back` clips carry `clip.userData.speed`: the natural ground
    speed in m/s, measured at load from the planted foot (`measureSpeed`). The spells agent sets `timeScale = ground speed / speed`.
    Measured values:

    | wizard | run | walk_fight | back | walk |
    |---|---|---|---|---|
    | Cinder | 4.27 | 0.73 | 0.56 | 1.29 |
    | Gale | 5.36 | 0.95 | 0.74 | 1.60 |
    | Rime | 5.06 | 0.92 | 0.69 | 1.52 |
    | Vesper | 4.88 | 0.76 | 0.66 | 1.47 |

    They differ per wizard because the retargeted stride follows each body's legs.
  - Walking backward at full speed would need `back` at 7–9×, so the request suggests clamping it.
  - Not used: Axe_Spin_Attack, Cautious_Crouch_Walk_Left, Charged_Slash and Walk_Backward.
- **Vesper's whips (round 6, `WHIPS` in looks.js).**
  - **Coil:** `vesper-whip-coil.glb` (9.7 MB went down to 219 KB), 0.34 m across. It hangs flat on her left hip,
    parented to `Hips` so it rides the pelvis instead of swinging with the leg, and it's turned about 35° toward the
    front so it reads from both the front and the side.
  - **Straight whip:** `vesper-whip.glb` (8.5 MB went down to 163 KB), 1.6 m long, fitted by its gem handle into her
    right fist with `fitProp`. It's 1.6× thicker than modelled, because at 1.6× it reads at range and the original was a
    pencil line. At 1.8 m the tip went through the floor in the crouched wind-up.
  - **API** (on the body and on `body.model.userData`, posted in `requests.md`):
    - `setWhip('out' | 'coiled')` swaps the whips and hides the wand while the whip is out.
    - `setWhipGlow(0..1)` makes both whips glow crimson, using per-body materials.
  - **Shots:** `vesper-whips.png` (close-up: idle, run, Lash, Lash glowing, idle glowing) and `whip-game-sheet.png`
    (in game). In game the coil is subtle at idle (dark on her dark coat) and clear once it glows.
- **Jeb the Shepherd (round 7).** `Meshy_AI_shepherd_wizard_3d_All_Animations.glb` became `jeb.glb` (10.2 MB went down to
  **1.58 MB**). Same 66-bone rig.

  | key | clip | notes |
  |---|---|---|
  | cast_fast | mage_soell_cast_1 0.3–1.2 s | the sling; the fling at about 0.54 s |
  | cast_heavy | Angry_Ground_Stomp_2 | the ram summon; the stomp lands at about 0.6–0.75 s (not a meteor wind-up; requested to play from 0) |
  | block | Block1 | Ram Guard |
  | **ult** (new) | Sword_Judgment 0.2–2.1 s, squeezed to 1.1 s | the Stampede call: leap at 0.3 s, slam at 0.75 s |
  | **ride** (new) | Cautious_Crouch_Walk_Left_inplace 0.3–0.42 s, stretched to 1 s | Ram Ride: a held wide crouch |
  | death | Lie_Back_Leg_Swing 0–1.3 s | falls flat on his back; the kip-up is cut |
  | run, walk, the shared clips; stun, dash, idle retargeted | | |

  - **Crook:** `jeb-crook.glb` (5 MB went down to 114 KB), 1.75 m, gripped 0.85 m up.
  - The crook is **fitted in a mid-run frame** (the new `pose`/`at` options on `PROPS`). Fitted at idle, his run swung
    the hook to the ground; now the hook stays up while he runs, rests over his shoulder at idle, is held across in the
    block, and is carried level like a lance on the ram.
  - Look fields: model `/models/wizards/jeb.glb`. I kept the colour (`0xe8dcc0`, wool), the tint (stand-in only) and
    the role line ("Herder · rams do his fighting").
  - **Picker:**
    - Every card now lists the ultimate (Q) under a dashed line.
    - With five wizards, the odd last card spans the row (CSS `:last-child:nth-child(odd)`): portrait and name on the
      left, spells in two columns on the right.
    - Keyboard: down from Rime reaches Jeb.
  - **Shots:** `jeb-clips.png` (his raw clips), `jeb-keys.png` (every key with the crook), `jeb-game-sheet.png` (in game:
    run, sling or summon, block, ride, Stampede call, death), and `picker5-*.png` / `picker5-jeb-*.png` (the picker at
    1280×720 and 1920×1080).
- **Embibe the Alchemist (round 8, a fresh characters agent).** `Meshy_AI_embibe_alchemist_3d_All_Animations.glb` became
  `embibe.glb` (11.1 MB went down to **1.89 MB**).
  - **Rig:** **70 joints**: the 66-bone Mixamo-style rig plus four hood bones (`Bone_029`–`Bone_032`, under `Head`).
    Every bone in `MIXAMO_TO_BASE` is there, so the retarget needed no new map. She is 1.70 m and faces +z.
  - **Retarget check:** I compared every leg bone's world rotation against Gale's in the retargeted idle; they differ by ≤ 27°.
    The base idle's crossed fighting stance looked crumpled on her heavy boots, but it isn't tearing: Gale has the same pose
    (`legs-close.png`). So she gets her own relaxed idle instead.

    | key | clip | notes |
    |---|---|---|
    | idle | Stand_and_Drink 0.2–1.9 s | a relaxed stand before the arm lifts |
    | run, walk | Running, Walking | natural speeds 5.21 / 1.61 m/s |
    | cast_fast | Female_Crouch_Pick_Throw_Forward 1.85–3.6 s | overhand throw; the release is at 0.55 s (the spark window) |
    | cast_heavy | Crouch_Pull_and_Throw 1.0–4.6 s, warped | Toxic Flask: a crouched scoop, then an overhead lob peaking at 2.1 s (meteor convention) |
    | **flask_step** (new) | Crouch_Charge_and_Throw 4.3–5.7 s, warped to 0.85 s | a crouched charge, then a sidearm lob; the release is at 0.6 s (the wind-up's end) |
    | **arrival** (new) | Female_Crouch_Pick_Throw_Forward 3.45–4.6 s → 0.8 s | lands crouched and rises |
    | ult | Stand_and_Drink 1.9–5.9 s, warped to 1.6 s | the flask is at her lips by 0.55 s, head back at 1.15 s |
    | death | dying_backwards (2.2 s) | flat by about 1.4 s |
    | combo1/2/3, the shared clips; block, stun, dash retargeted | | |

  - **How I chose the picks:** contact sheets (`embibe-clips.png`, `-combo`, `-drink`, `-charge`, `-pull`, `-misc`), plus a numeric
    trace of hand height, reach, speed and chest facing (`/tmp/wa-characters/embibetrace.py`). The throws twist her chest by up to ±100°,
    which is natural for sidearm and overhand throws.
  - **New pick forms** (MODEL_CLIPS / SHARED_CLIPS):
    - `{ clip, from, to, warp }` cuts a part of a clip, then retimes it (warp points are in source clip times).
    - `yaw: deg` turns the whole clip through its Hips tracks, for moves performed from a bladed stance.
  - **Potions** (`POTIONS` in looks.js): `embibe-potion-purple.glb` (8.0 MB → 205 KB) and `embibe-potion-green.glb` (6.5 MB → 175 KB).
    - Settings: weld, simplify 0.5, 512 px webp, quantize.
    - Each is fitted into **both fists**, hidden. `body.holdPotion('purple' | 'green' | null, 'right' | 'left')` shows one.
    - The right hand is fitted at idle, upright.
    - The **left hand is fitted at the drink's peak** (new `aim` option: the bottle's neck points from the fist to a spot near
      the Head bone). Her drinking hand rises above her face, so the flask tips with the cork at her lips (`embibe-drink-head.png`).
    - A green flask hangs on her right hip (`fitHip` now takes `height`/`side`/`front` for upright objects).
  - **Look:** her texture is the darkest on the roster (mean luma 52; Gale, Rime and Jeb are 111–132), and in game light she was a black
    silhouette. `BRIGHTEN.embibe = 1.45` multiplies her base colour (`eg-cmp-2.png`, next to Gale, Jeb and Vesper).
    `FLAIR.embibe` adds 9 green and violet bubbles rising around her; `motes` now takes a per-point `tint`.
  - **Picker:** the sixth card needed no code. Six cards make three rows of two, so the odd-card span rule no longer applies, and
    keyboard rows still work. Shots: `picker6-*.png`, `picker6-embibe-1280x720.png` and `picker6-embibe-560x900.png`.
- **Shared from Embibe's export** (`SHARED_CLIPS` is now a list of `{ from, to?, keys }` sources):
  - `combo1`, `combo2`, `combo3` (Embibe and **Gale**) come from Triple_Combo_Attack.
    - The cuts: 0.3–1.0, 1.0–1.85 and 1.85–3.3 s.
    - Each is warped so it strikes at 0.15 s; combo1 and combo2 are 0.45 s long, combo3 is 0.8 s.
    - All three are turned 45°, because the combo stance is about 55° off forward.
    - combo2 is a spinning backhand that ends facing away; combo3 starts from there.
    - The spells agent's main.js already plays `combo<shot+1>` for any body that has them, so **Gale Shear uses them now**.
  - `death` for **Gale** is dying_backwards, retargeted. Gale no longer sinks.
- **Bug fixed in `retargetClip`:** it sampled its source as a looping action, so the last sample (t = duration) wrapped to frame 0, and every
  retargeted clip ended on its first pose. That would have stood Gale's clamped death back up. It now plays the source LoopOnce + clamp.
  This affects how `hit_waist`, `tk_*` (on everyone but Cinder) and the retargeted `stun`/`dash`/`block` end (requested note posted).
- `tools/prepare-wizard-model.sh` now recognises Mixamo-style rigs in its inspect report. It used to say "RightHand bone: NO".
- **Knocked down by thrown objects (Ty): `knockdown` and `getup` on all six heroes.** looks.js `knockClips` builds them at load
  from the body's own `death` clip:
  - `flatTime` finds the first moment the head and hips are each within 6 cm of their lowest.
  - `knockdown` is 0..flat, resampled through each track's interpolant and squeezed to 0.4 s. Resampling matters: `subclip` drops
    tracks with no key in the range, and the compressed clips are sparse.
  - `getup` is the same segment reversed (`reverseClip`).
  - Measured flat times: Cinder 1.95, Gale 1.34, Rime 2.28, Vesper 2.14, Jeb 0.64, Embibe 1.32 s.
  - The knockdown ends lying (head 0.30–0.49 m) and the getup ends standing (head 1.42–1.62 m; idle is 1.45–1.63 m).
  - Both must be **LoopOnce + clamp** (requested). As loops, the held knockdown wraps back to standing.
  - Shots: `knock-sheet.png` (in game, all six: mid-fall, down, getup) and `knock-close-sheet.png`. No skin tearing.
  - Tested on a clean `git archive HEAD` copy (`/tmp/wa-characters/tree2`) with my looks.js. The working tree didn't load at the
    time, because of another agent's in-progress map.js (`COVER_CLUSTERS is not defined`).
- **Cinder's Fireball uses the triple strike (Ty).** `SHARED_CLIPS` has a third Embibe set, `to: ['cinder']`.
  - The same three Triple_Combo_Attack strikes, retargeted onto Cinder's 66-bone rig.
  - The cuts start later (0.6, 1.36 and 2.14 s), so each strike lands at once: the server spawns the bolt as it receives the cast,
    and main.js starts `combo<shot+1>` (at 1×, ≤ 0.7 s) when that spawn reaches the client. Its 0.08 s cross-fade into the one-shot
    ends right on the strike.
  - Measured peak right-hand speed: combo1 at 0.067 s, combo2 at 0.042 s, combo3 at 0.067 s (`/tmp/wa-characters/strike.py`).
    All three are inside the 0.30 s Fireball cast root, and the root ends during the follow-through.
  - Durations are 0.45, 0.45 and 0.8 s; shots are at least 0.5 s apart. combo2 releases sidearm with the chest turned about 90°.
  - Gale's and Embibe's combos are unchanged (they strike at 0.13–0.17 s).
  - Shots:
    - `cinder-combo-game-sheet.png`: in game, FFA (`MATCH_MODE=ffa`, so Siege bots don't crowd the frame). Top row is each strike
      at its release, bottom row the follow-through.
    - `cinder-combo-close.png`: close-ups.
    - No skin tearing; `allkeys.py` shows every hero's keys and there are no console errors.
- **One of each hero per team (team modes).** `pk.setTaken(ids | { id: teammateName })` on the picker handle.
  - Taken cards are greyed (CSS `.wp-card.taken`), carry a TAKEN badge (`.wp-taken`), and have a "Taken by …" tooltip and `aria-disabled`.
  - Their preview stops turning and gets a dark veil drawn in the shared canvas, because the card's CSS filter can't reach the WebGL overlay.
  - Clicks and Enter/Space on them are ignored; arrow keys still move focus over them.
  - The picker's own current pick is never marked. `null` (FFA) clears all badges, and an unchanged list is a no-op.
  - The data is the server's `snap.teamHeroes` (spells agent). Calling it is main.js's job: the snippet is in `requests.md`
    ("characters → spells: call the picker's setTaken"). Until the spells agent adds it, the picker shows every hero, and the server
    rule still applies (the nearest free hero plus a notice).
  - Verified in a live Siege match on 4103 with raw-socket teammates (`/tmp/wa-characters/takengame.py`): Gale was "Taken by Bram",
    and the badge moved to Cinder when he switched. Bot holders were checked on a synthetic snapshot.
    Shots: `taken-team.png`, `taken-live.png`, `taken-ffa.png`, `taken-ingame*.png`.
- **All six wizards have Ty's models.** The recoloured stand-in (`STAND_IN`, `bodyMaterial`) is only used if a model fails to load.

## Verification
All runs used headless Chromium (SwiftShader) against port 4103. Screenshots are in `/tmp/wa-characters/shots/`.
- **Picker (`picker.py`, written before the spells agent removed `#joinBook`; `e2e.py` now covers the mounted picker):** joined to the join panel at 1280×720 and 1920×1080, narrow (560 px) and wide (760 px):
  `picker-*.png`, `join-*.png`. Pause menu: `pause-1280x720.png`.
  - Keyboard and click: ArrowRight + Enter picked rime, and the click picked vesper.
    `onChange` received `['rime', 'vesper']`, `set('cinder')` didn't fire `onChange`, and focus stayed put.
  - Render loop: about 30 frames/s visible and **0** while hidden.
- **Integrated (`e2e.py`, the spells agent's live main.js):** `e2e-join-1920x1080.png` and `e2e-join-1280x720.png`.
  - A choice survives a reload (`wizardChoice=rime`, and the rime card is selected).
  - In game, all five Wizards (me plus four raw-WebSocket dummies, one per wizard) got the right `wizard` and found
    `RightHand` and `Head` on their body. See `e2e-row-block.png`: the local Rime with frost shards and the Bulwark/Skim ability bar.
- **Looks:** `lookdev.png` (large previews) and `row-sheet.png` (all four in game lighting in six poses; the skin deforms
  cleanly and the shards follow the arms).
- **Console:** no errors from my code. One earlier run hit a spells-side `updateHud` exception, which they've since fixed;
  the final run had 0 errors. The only warnings were "GPU stall due to ReadPixels", which also appear on the untouched
  page in headless Chromium, so they come from the screenshot path, not the game.
- **Gale in game (`galegame.py`):** I joined as Gale with four Gale dummies, each frozen mid-pose (run, spark, meteor
  release, cyclone kick) at two moments: `gale-game-sheet.png`, `gale-game-poses*.png`.
  - Every body had all ten clip keys and found `RightHand`/`Head`, with no `[looks]` warnings and no console errors.
  - The skin holds in every pose.
  - The ability bar showed Gale's kit, and the picker card shows the real model (`gale-picker.png`).
- **Rime in game (`rimegame.py`):** I joined as Rime with five Rime dummies (run, Skim, Frostfall, stagger, death),
  frozen at two moments each: `rime-game-sheet.png`.
  - The staff is in hand in every pose. `rime-keys.png` shows every key over time; `rime-clips.png` compares his clips with the base clips.
  - The picker card shows him with the staff and snowfall (`rime-picker.png`).
  - No `[looks]` warnings and no console errors. The integrated `e2e.py` still passes (reload keeps `wizardChoice`, 0 errors).
- **Shared clips in game (`sharedgame.py <wizard>`):** for each wizard, five dummies frozen walking forward (fight walk), walking back,
  lifting, throwing and taking a waist hit, at two moments each: `shared-game-sheet.png` (rows: Cinder, Gale, Rime, Vesper).
  Every wizard had all the keys and there were 0 console errors. The contact sheet is `shared-keys.png`; the speed check is `speeds.py`.
- **Cinder in game (`cindergame.py`):** six Cinder dummies (run, spark, meteor wind-up, meteor release, stagger, death),
  each at two moments: `cinder-game-sheet.png`. Every key over time: `cinder-keys.png`; his clips next to the base clips:
  `cinder-clips.png`. No `[looks]` warnings and no console errors.
- **Rime's stun and float (`rimefloat.py`):**
  - The stunned dummy recoils, then recovers.
  - The float dummy really cast Skyward Flash, so it hangs about 3 m up with the landing ring below, holding the float pose:
    `rime-float-sheet.png`.
  - I compared the stun candidates in `rime-stun.png`. The start of Strangled_and_Fall_Forward was too slow for a flinch.
- **Vesper in game (`vespergame.py`):** four Vesper dummies (run, cast, lash, death), each at two moments:
  `vesper-game-sheet.png`.
  - The wand is in hand in every pose.
  - `vesper-keys.png` shows every key over time; `vesper-clips.png` and `vesper-cast5.png` show how I chose the cast segment and the slash timing.
  - No `[looks]` warnings and no console errors.
- **Fixed along the way:** flair points were sized by the whole canvas height, so in the picker's small viewports they were
  about 5× too big. They now scale by viewport height, with no change in game.
- **Embibe (round 8):** port 4103 (a stale server from the previous agent held it; I restarted it).
  - `embibekeys.py` / `embibeclose.py`: every key over time, close up. `embibe-close-1..3.png` cover all 20 keys, with the potions
    shown where they're used. **No skin tearing in any pose**; the boots and cloak hold in the throws, combos, death and the retargeted
    walk_fight/back/stun/dash/block.
  - `embibegame.py <wizard> <prefix> key@t1@t2[@potion:hand[@wizard]]`: dummies frozen in game.
    - `eg-a-*` (run, Potion Toss, Toxic Flask, Flask Step)
    - `eg-b-*` (arrival, Brew, combo1, death)
    - `eg-c-*` (combo2, combo3, block, hit_waist)
    - `eg-gale-*` (Gale's combos and death)
    - `eg-cmp-*` (Embibe beside Gale, Jeb, Vesper)
  - `allkeys.py`: every hero's keys and gait speeds after the shared-clip refactor. They're unchanged for the five others, and there were
    no `[looks]` warnings and no console errors.
  - `facing.py`: chest facing over each key; it's how I found the yaw offset and the retarget wrap bug.
- `public/models/wizards/` (`ls`): `gale.glb` 1.71 MB, `rime.glb` 1.43 MB, `rime-wand.glb` 261 KB, `vesper.glb` 1.23 MB, `vesper-wand.glb` 157 KB, `cinder.glb` 1.78 MB, `vesper-whip.glb` 163 KB, `vesper-whip-coil.glb` 219 KB, `jeb.glb` 1.58 MB, `jeb-crook.glb` 114 KB, `embibe.glb` 1.89 MB, `embibe-potion-purple.glb` 205 KB, `embibe-potion-green.glb` 175 KB (about 11 MB in total). The base `wizard.glb` is unchanged at 1.4 MB.

## Known issues and notes
- **Vesper vs Cinder:** both are red, but Vesper is darker, has smoke and a pool, and has a different nameplate tone.
  At long range they're closest; Ty's models will settle it.
- **Panel width:** the spells agent answered the 760 px panel request in `requests.md`.
- **Extra clip keys:** Gale's `spin`, Rime's `float`, `death` (Rime, Vesper, Cinder), Vesper's `lash`, and on everyone
  `walk_fight`, `back`, `tk_lift`, `tk_throw` and `hit_waist` need the spells agent's changes
  (all requested in `requests.md`) to show in play.
- **wizards.js:** the spells agent had an uncommitted `frostfall` kit edit in the file, so I staged only my `model` line
  (via `git update-index`). Their change is still in the working tree for them to commit.
- **Round 8, waiting on the spells agent** (`requests.md`, "characters → spells: Embibe's clip keys"):
  - Flask Step's wind-up should play `flask_step`; it plays `combo1` now.
  - Toxic Flask should play `cast_heavy` from 1.85 s; it plays `cast_fast` now.
  - `holdPotion` calls.
  - Adding the new keys to wizard.js's LoopOnce list.
  Until then the potions stay hidden in her hands (the belt flask always shows).
- **Embibe's combos** come from a bladed stance; even after the 45° turn, combo2 spins her to face away for about 0.25 s. If that reads badly
  for her two-shot primary, playing combo1 then combo3 is the fallback (combo3 ends facing forward).
- **Retarget limits:** the retarget works for Mixamo-style rigs (`MIXAMO_TO_BASE`). A rig with other bone names needs its
  own map, or Meshy's seven clips exported with it.
- **Picker canvases:** each mounted picker holds one WebGL context while it exists (2 for join + pause, plus the game's).
  `destroy()` releases it.
