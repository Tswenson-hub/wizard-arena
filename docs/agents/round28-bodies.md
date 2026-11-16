# Round 28 brief: a distinct look for each wizard

## Context
With round 27 every wizard plays as a fixed kit, but they all use the **same KayKit Mage body**, tinted. Ty: "They are
completely uniform right now, which looks unpolished. They should each be different depending on their style." He
chose to use the **KayKit Adventurers pack already in `~/Downloads`**. All six of its bodies share our `Rig_Medium`
(23 joints, the same names as the Mage), so every clip, the BONES map and the staff slot work with no retargeting.

This runs **after round 27 lands** (the characters agent is busy with the gallery). Rounds 26, 27 and 28 can ship
together.

## Mapping (characters agent: tools/build-characters.mjs, looks.js, wizard.js, select.js, podium.js)
| Wizard | Body | Style | Prop |
|---|---|---|---|
| **Pyromancer** | Mage (as now) | red and orange robes, ember aura | fire staff |
| **Frost Warden** | Knight | armour tinted frost blue and white, icy rim, frost aura | ice-tipped staff, or the knight's shield recoloured as an ice ward |
| **Stormcaller** | Rogue_Hooded | storm violet and white hood, wind-mote aura | wand, with a crackling tip |
| **Hemomancer** | Rogue | crimson and black, dark smoke aura | wand plus a spellbook in the off hand |
| **Beastcaller** | Barbarian | furs, horn helm, earthy browns, dust aura | the Shepherd's crook staff (a KayKit staff, recoloured) |
| **Alchemist** | Ranger | green hood, leather, acid drips | a potion flask in the off hand (`potion` prop) plus a short wand |

- **Import:** copy only the used GLBs, with meshopt and webp, into `public/models/characters/`. Reuse the character
  build script.
- **The tint system per body:** the round-15 atlas-region recolour on the Mage generalises to per-body region maps, or
  per-material colours, so each class keeps its identity and Wardrobe robe palettes still apply.
- **Hats:** Wardrobe hats are Mage-specific. Hide or adapt hat cosmetics on bodies whose head piece differs, and say so
  in the Wardrobe ("hats: Mage-style wizards only"), or give each body its own hat slot recolour. Keep it simple.
- **Everywhere a wizard is drawn:**
  - in game, for players and for bots (bots stay Skeletons)
  - the gallery cards and the hover preview
  - the podium and the Esc menu
  - Mirror Step decoys copy the owner's body
- **The protocol** already carries the wizard id or kit, so the body comes from the wizard. Old clients keep seeing
  their Mage, which is harmless.
- **Perf:** each body is about the Mage's triangle count. Keep the shader programs within budget; the bodies should
  share one skinned material with a uniform per body, not one program per class.

## Verification
- Playwright:
  - a gallery screenshot with six distinct wizards
  - each wizard in game: idle, cast and the Arcane Grasp lift
  - the podium with mixed wizards
  - no console errors
- `perf_test` on both maps: programs at 60 or fewer, triangles within the budget.
- Unit tests ALL PASS.
- Ty plays, then the push (rounds 26, 27 and 28), the rebuild and a CrazyGames upload.
