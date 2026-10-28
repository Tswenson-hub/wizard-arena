# Brief: characters agent (round 4)

Read `docs/agents/shared-rules.md` first. You own how wizards **look** and how players **choose** one.

## Context
Players now pick one of four wizards, each with a fixed spell kit (roster in `public/shared/wizards.js`).
The spells agent is building the spells and the selection logic at the same time.
Ty is making a **Meshy character model for each wizard** and will drop them on `~/Desktop` (`Meshy_AI_*`), one by one:
- **Cinder** the Pyromancer: red, the current look
- **Gale** the Tempest Dervish: violet, wind
- **Rime** the Frost Warden: ice blue
- **Vesper** the Hemomancer: crimson and black

Today everyone uses `public/models/wizard.glb`, the original Meshy wizard with 7 clips merged in.
`public/js/looks.js` loads it and hands each Wizard a skinned body through `makeWizardBody(id)`. As a stand-in look,
`makeWizardBody` tints the base model per wizard.

## 1. Wizard picker (`public/js/select.js`, `public/css/select.css`)
- **API** (the spells agent wires it into the join screen and the Esc menu, so keep it exactly):
  `mountWizardPicker(container, { selected, onChange(id) })` returns `{ set(id), destroy() }`.
- **One card per wizard:**
  - a **live 3D preview**: the wizard's body from `makeWizardBody(id)` playing idle, slowly turning, with a small offscreen
    renderer or one shared renderer drawing into each card's canvas
  - the name and title, and the role line
  - the five spells: the key (LMB / RMB / E / Space / F), the spell name and its one-line blurb from `SPELLBOOK`
    (`constants.js`). The new spells' entries are being added now; until they land, fall back to the id.
- **States:** the selected card stands out, with its accent colour (`WIZARDS[id].color`) and a check mark.
  Keyboard: arrow keys move between cards, Enter picks.
- **Layout:** it must fit the existing join panel (about 520 px wide; it can grow to about 760 px if the layout needs it)
  and the pause panel. Two by two works well. Test at 1280×720 and 1920×1080.
- Pause previews when the picker is hidden; it shouldn't eat frame time in game.

## 2. Stand-in looks until the models land
Make the four wizards clearly distinct today, using the base model:
- a **tint** (already started; tune it so the texture still reads)
- accent colours on the existing ring and nameplate. The spells agent sets the colour from `WIZARDS[id].color`.
- an optional **small attachment per wizard** on the base skeleton:
  - Cinder: an ember glow at the staff hand
  - Gale: swirling motes
  - Rime: frost shards on the shoulders
  - Vesper: a dark crimson aura

  Build these in `looks.js` as part of the body. `wizard.js` (spells-owned) just adds `body.model`, so put attachments
  inside `model`, attached to bones (`model.getObjectByName('RightHand')`, etc.).

## 3. Ty's models: the pipeline
When a character model arrives:
1. **Inspect it.** Is it skinned? Which bone names? Which animations? Run the python GLB-JSON reader pattern, or gltf-transform `inspect`.
2. **Does it share the base skeleton?** Compare its bone names with `wizard.glb`'s.
   - If they match (Meshy's humanoid auto-rig uses consistent names), **reuse the 7 base clips** on the new mesh, and Ty
     doesn't need to export animations.
   - If they don't match, retarget with `SkeletonUtils.retargetClip`, or ask Ty (through the coordinator, in your hand-off or
     `requests.md`) to export it with Meshy's animations: Running, Walking, Stand_Dodge_2, Stand_Dodge_3, Two_Handed_Parry,
     Charged_Spell_Cast, mage_soell_cast.
3. **Shrink it:** `npx @gltf-transform/cli` weld → resize textures 1024 → webp → quantize (as in `tools/optimize-models.sh`).
   Don't simplify skinned meshes aggressively; check the skin still deforms cleanly. Target under 2 MB.
   Output goes to `public/models/wizards/<id>.glb`.
4. **Wire it in:** set `WIZARDS[id].model` and load it in `loadWizardModels(loader)`. `makeWizardBody(id)` then uses that
   model with the right clips. Fall back to the tinted base if loading fails.
5. **Match it to the base model:** height (about 1.8 m), feet on y = 0, facing +z, a `RightHand` bone (or tell the spells
   agent the name), and the same clip names (`run, walk, block, cast_fast, cast_heavy, stun, dash, idle`).
6. **Screenshot it in game** running, casting, warding and stunned. Check the skin doesn't tear.

Check `ls ~/Desktop/Meshy_AI_*` now and then. Ignore the farm props; the environment agent handles those.

## Interfaces (don't break)
- `looks.js` exports `registerModel(gltf)`, `loadWizardModels(loader)` and `makeWizardBody(id) → { model, clips }`.
  `main.js` calls the first two before enabling Join.
- `wizard.js` expects these clip keys: `run, walk, block, cast_fast, cast_heavy, stun, dash, idle`. It also expects a
  `RightHand` and `Head` object somewhere in `model` (used for spell effects and the telekinesis beam).

## Verify (Playwright, port 4103)
- Screenshots of the picker on the join screen and in the pause menu, at 1280×720 and 1920×1080.
- In game, all four wizards side by side (dummy players via raw WebSockets work, as the spells agent did last round), and
  each real model as it arrives.
- No console errors. `du -sh public/models/wizards`.

Finish with `docs/agents/characters-handoff.md`.
