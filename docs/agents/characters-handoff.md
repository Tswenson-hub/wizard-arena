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
  - **Shrink:** weld, resize textures to 1024, webp at quality 80, quantize, prune. It doesn't simplify, because skinned meshes tear.
  - Output: `public/models/wizards/<id>.glb`.
- **Runtime** (`loadWizardModels`): for every wizard with `WIZARDS[id].model` set:
  - It loads the model and checks the bone names against `wizard.glb`.
    If every base bone is there, the base clips drive it by bone name, so Ty doesn't need to export animations.
    Otherwise it maps the model's own clips, by our names or Meshy's (`Running`, `Walking`, `Two_Handed_Parry`,
    `mage_soell_cast`, `Charged_Spell_Cast`, `Stand_Dodge_2`, `Stand_Dodge_3`, including `Armature|X|baselayer`).
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
3. If the skeleton differs and the clips are missing, ask Ty for Meshy's seven animations (names above).
4. Check facing: Meshy exports face +z like the base. If one doesn't, rotate `inner` in `makeWizardBody`.
5. Screenshot it running, casting, warding and stunned. `/tmp/wa-characters/ingame.py` places all four bodies in the
   live scene, and `ingame.py model` shows how to fake a model URL with an init script.

**Status: Ty's four models arrived at 19:40 (`Meshy_AI_<wizard>_…_texture.glb`), but they can't be used yet: they are
static meshes.** They have no skin, no bones and no animations; they're the textured exports, not the rigged ones.
They look great: Cinder has a lantern staff and a witch hat, Gale wears flowing violet scarves, Vesper is hooded in
black and crimson, and Rime is the frost warden. They face +z and stand about 0.95 m tall, centred on the origin.
`looks.js` rescales and grounds them automatically. Render: `/tmp/wa-characters/shots/desktop-models.png`.

**Ty, one step per wizard:** in Meshy, open each model and run **Animate → Rig** (humanoid auto-rig). Download the rigged
character (`Meshy_AI_Character_output.glb` or `…_rigged….glb`) to the Desktop. Exporting animations isn't needed:
Meshy's humanoid rig uses the same 24 bone names as `wizard.glb`, so the existing seven clips drive it.
Then: `tools/prepare-wizard-model.sh <file> <id>`, set `model` in wizards.js, and screenshot it (steps above).
Until then every wizard keeps the recoloured base model and its flair, so nothing is broken.
Gale's long scarves may stretch a little under the auto-rig; check her run and cyclone poses first.

## Verification
All runs used headless Chromium (SwiftShader) against port 4103. Screenshots are in `/tmp/wa-characters/shots/`.
- **Picker (`picker.py`):** joined to the join panel at 1280×720 and 1920×1080, narrow (560 px) and wide (760 px):
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
- `du -sh public/models/wizards`: not created yet (the models that arrived are unrigged, see above). The base `wizard.glb` is unchanged at 1.4 MB.

## Known issues and notes
- **Vesper vs Cinder:** both are red, but Vesper is darker, has smoke and a pool, and has a different nameplate tone.
  At long range they're closest; Ty's models will settle it.
- **Panel width:** at the 560 px join panel the blurbs are cut to one line. I asked the spells agent in `requests.md`
  to widen it to about 760 px (optional).
- **Picker canvases:** each mounted picker holds one WebGL context while it exists (2 for join + pause, plus the game's).
  `destroy()` releases it.
