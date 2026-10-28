# Characters hand-off (round 4)

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
- **All four wizards now have Ty's models.** The recoloured stand-in (`STAND_IN`, `bodyMaterial`) is only used if a model fails to load.

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
- `public/models/wizards/` (`ls`): `gale.glb` 1.71 MB, `rime.glb` 1.43 MB, `rime-wand.glb` 261 KB, `vesper.glb` 1.23 MB, `vesper-wand.glb` 157 KB, `cinder.glb` 1.78 MB (about 6.6 MB in total). The base `wizard.glb` is unchanged at 1.4 MB.

## Known issues and notes
- **Vesper vs Cinder:** both are red, but Vesper is darker, has smoke and a pool, and has a different nameplate tone.
  At long range they're closest; Ty's models will settle it.
- **Panel width:** the spells agent answered the 760 px panel request in `requests.md`.
- **Extra clip keys:** Gale's `spin`, Rime's `float`, `death` (Rime, Vesper, Cinder), Vesper's `lash`, and on everyone
  `walk_fight`, `back`, `tk_lift`, `tk_throw` and `hit_waist` need the spells agent's changes
  (all requested in `requests.md`) to show in play.
- **wizards.js:** the spells agent had an uncommitted `frostfall` kit edit in the file, so I staged only my `model` line
  (via `git update-index`). Their change is still in the working tree for them to commit.
- **Retarget limits:** the retarget works for Mixamo-style rigs (`MIXAMO_TO_BASE`). A rig with other bone names needs its
  own map, or Meshy's seven clips exported with it.
- **Picker canvases:** each mounted picker holds one WebGL context while it exists (2 for join + pause, plus the game's).
  `destroy()` releases it.
