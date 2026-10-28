# Requests between agents

Append: `## <from> → <to>: <title>`, then what and why. The receiver marks it **done** or replies under it.

## gameplay → environment: optional `dizzyGoat(goat, ctx)` export in server/goats.js
The Arcane Cyclone pulse calls `angerGoat()` on goats in its 5.5 m radius, but `angerGoat` returns
early for a goat that is already charging, so a cyclone can't answer a goat charge (the brief asks
bots to use it that way). If you'd like that interaction, please export
`dizzyGoat(goat, ctx)` that puts a charging goat into your `dizzy` state (as if it hit a pillar,
with a `goatBonk` broadcast if you like). `server.js` already calls it when it exists
(`Goats.dizzyGoat?.`-style lookup) and bots switch the tactic on automatically; nothing breaks if you skip it.

**done** (environment): `export function dizzyGoat(goat, ctx)` in `server/goats.js`. A goat in `windup` or
`charge` goes `dizzy` for `GOAT.dizzyTime` with a `goatBonk` broadcast and it returns `true`; any other state is a no-op
that returns `false`. Afterwards the goat trots home to the pen as usual.

## environment → gameplay: call the crop-flattening hook on explosions (optional polish)
`public/js/world.js` exports `trampleCrops(x, z, radius)` (visual only: crops in the radius lie flat and
regrow after about 10 s). Charging goats already call it. If you'd like it, please call it from `main.js`
where Meteor impacts are shown (radius about the blast radius) and on `cyclonePulse` (5.5). It returns at once
for points away from the field, so it's cheap to call on every explosion. `updateCrops()` runs from `goats.js`
every frame, so nothing else is needed.

**done** (gameplay): `main.js` calls `trampleCrops(x, z, 2.5)` on Meteor impacts and `trampleCrops(x, z, 5.5)` on every `cyclonePulse`.

## environment → gameplay: heads-up on new collider kinds and the new `hay` prop
`COLLIDERS` now holds about 300 circles with `kind` one of `pillar, tree, house, fence, shelter, trough, crop,
scarecrow, tractor, well, cart, hay`. The fence (`h` 0.7) and crops (`h` 0.9) are below `LOS_HEIGHT`, so
`pillarBlocks` and the bots' LOS ignore them, but movement collides with them. In my botmatch runs no bot got
stuck. `PROP_TYPES.hay` is a new throwable (small round bale). `effects.js` uses the generic colour burst for it;
a straw puff would be nice if you have time. `ARENA_RADIUS` is now 40. Goats have a new state, `return`
(trotting home); only `charge` matters to bots. Goats pass under wizards with `p[1] >= GOAT.rammableBelow` (1.0).

**noted** (gameplay): bots and the client skip colliders lower than the wizard's feet while airborne. The cyclone uses
`dizzyGoat` first (rearing/charging goats go dizzy) and `angerGoat` otherwise. `hay` breaks with a straw puff in `effects.js`.
One thing on your side: the well's roof (about 2.5 m up) sits above its low collider, so the third-person camera can end up
under the roof when you stand right next to the well and it fills the top of the screen. If you give the roof its own
collider circle with `h` ≈ 3, the camera's boom check (which uses `COLLIDERS`) will pull in instead.

## characters → spells: widen the join panel to about 760 px (optional)
The picker (`select.js`) is in and your `#joinPicker` / `#pausePicker` mounts work. At the current 560 px panel
the spell blurbs are cut to one line with an ellipsis (the full text is in a tooltip). With
`.panel { width: min(94vw, 760px) }` (the brief allowed up to about 760) every blurb shows in full and the cards
stay two by two; I tested both widths at 1280×720 and 1920×1080. The pause panel is fine either way.
Notes for `wizard.js`, no action needed:
- `makeWizardBody()` now returns `model` as a wrapper `Group` named `wizardBody`, with the skinned scene inside.
  Moving or tilting `model` (your death sink) is safe. `RightHand` and `Head` are found with `getObjectByName` as before.
- Every body has its **own** material clones, so fading or tinting one body (decoys, frost on slowed wizards) won't
  touch others. If you set opacity on a decoy by traversing `model`, the flair inside (`THREE.Points` and, for Rime,
  small ice meshes) will be included. That's fine to fade along with the body.
- Heads-up seen at 19:40: `main.js` `updateHud` threw `Cannot read properties of undefined (reading 'power')` every
  frame after joining (line about 962, `kit()`), which stopped the camera from following. Probably mid-edit on your side.

**done** (spells): `.panel` is now `min(94vw, 760px)` in `style.css`. The `updateHud` error was mid-edit; it's gone at
`eb16956` (no console errors in my Playwright runs). Decoys on the caster's own screen are faded by traversing `model`
(`Wizard.makeGhost()`), flair included, as you suggested. `SLOT_INFO` in `constants.js` has the key labels per slot
(`LMB, RMB, E, Space, F`) if you want them from one place.

## characters → spells: play the `spin` clip during the Arcane Cyclone spin when a body has it
Gale now has her own model (Ty's rigged export) and `makeWizardBody('gale').clips` includes an extra key, **`spin`**:
the low spinning floor sweep from her Sweeping_Kick, 0.9 s long, in place. `wizard.js` already makes an action for every
clip key, so `this.actions.spin` exists for Gale and is `undefined` for everyone else.
Please use it in `spin()` when it's there, e.g.:
```js
if (this.actions.spin) this.oneShot('spin', CYC.spin, this.actions.spin.getClip().duration / CYC.spin, 0);
else this.oneShot('dash', CYC.spin, 2.5, 2.2);
```
That plays the whole sweep over the 0.5 s spin. Your two-turn model rotation on top still looks right: it's a cyclone.
Gale's other clips keep your timings: her `cast_fast` is the same Meshy move as the base spark cast, and her
`cast_heavy` has its release pose in your 1.9–2.7 s window. block, stun, dash and idle are the base clips retargeted onto her rig.
Screenshot of the kick in game: `/tmp/wa-characters/shots/gale-game-sheet.png`.
