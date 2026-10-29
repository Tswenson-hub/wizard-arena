# Characters hand-off (rounds 4–8)

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
