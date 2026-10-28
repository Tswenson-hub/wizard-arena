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

**done** (spells, `d1eb78d`): `spin()` plays `spin` over the 0.5 s spin when the body has it (else `dash`); `spin` is LoopOnce + clamped. Checked in Playwright: Gale's `current` is `spin` at the pulse.

## characters → spells: Rime's body has a `death` clip (and his casts for Frostfall)
Rime now uses Ty's model with his frost staff. `makeWizardBody('rime').clips` has an extra key, **`death`**: he kneels
and falls flat, trimmed and squeezed to **2.5 s**, so he's down well inside the 3 s respawn. `actions.death` exists only
for bodies that have it. A suggestion for `updateAnimation`:
`if (this.dead) this.setBase(this.actions.death ? 'death' : 'stun', 0.1)`, with `death` set to `LoopOnce` +
`clampWhenFinished` in the constructor like the other one-shots.
His other clips keep your timings:
- `cast_heavy` (Charged_Spell_Cast_1) gathers until about 1.4 s, then pushes out wide from 1.75 to 3.1 s. Both
  a 1.25 s charge at 1.5× (clip time 1.9 s) and your release window (1.9–2.7 s) land on the push, so Frostfall can use it as is.
- `cast_fast` flings the arms and staff forward at 0.6–1.4 s.
- `stun` is a stagger (Fall2), stretched to the base stun's 2.3 s.
Screenshots: `/tmp/wa-characters/shots/rime-game-sheet.png`.

**done** (spells, `d1eb78d`): `death` (LoopOnce + clamped) plays on death for any body that has it, with **no sink and no tilt** (the corpse stays at y = 0 holding the last frame until the respawn moves it; 2.5–3 s clips leave no time for a sink before the 3 s respawn). Bodies without it keep the sink. Frostfall uses `cast_heavy` at 1.5× from 1.9 s for its 0.5 s cast pose.

## characters → spells: play Vesper's `lash` clip over the Sanguine Lash wind-up
Vesper now uses Ty's model with her hemomancer wand. `makeWizardBody('vesper').clips` has an extra key, **`lash`**:
her sword slash (Ty's choice for the whip), **retimed in looks.js** for your timing.
- It runs 2.1 s: a crouched wind-up with the wand drawn back for the first 1.3 s, the strike across at 1.3–1.55 s, then the
  follow-through to 2.1 s.
- Play it **from the start of the wind-up at 1×**, and the strike lands on the 1.5 s release with no extra timing code.
  For example, in `startLash()`: `if (this.actions.lash) this.oneShot('lash', LASH.windup + 0.6, 1, 0);`.
- At release, keep `oneShot('cast_heavy', …)` for bodies without `lash` only, so the follow-through isn't cut off.
- If the wind-up is cancelled (hit), your `endLash()` path returning to the base state is fine.
She also has `death` (`Dead`, 2.97 s, flat by about 2.2 s), so the death request above covers her too.
Her `cast_fast` is an overhead flick in the usual spark window; `cast_heavy`, block, stun, dash and idle are the base clips retargeted.
Screenshots: `/tmp/wa-characters/shots/vesper-game-sheet.png`.

**done** (spells, `d1eb78d`): `startLash()` plays `lash` from 0 at 1× for windup + 0.6 s; at release `cast_heavy` is played only for bodies without `lash`; a cancelled wind-up drops back to the base state.

## characters → spells: play Rime's `float` clip during the Skyward Flash descent (Ty's request)
Ty wants Rime's Fall2 motion while he floats back down after Skyward Flash, not on stun. `makeWizardBody('rime').clips`
now has an extra key, **`float`**: Fall2 settling into its airborne pose (knees up, arms out) over 1.0 s.
Please play it while a wizard whose body has it is airborne from Skyward Flash, and return to the normal state machine on landing:
- In the constructor, set `float` to `LoopOnce` + `clampWhenFinished` (like the casts), so it holds the pose for the whole
  descent (about 2.8 s) instead of replaying the fall.
- In `updateAnimation`, while airborne: `if (this.actions.float) this.setBase('float', 0.2)`; otherwise keep what you do now.
Rime's `stun` is now the base stun retargeted, a quick flinch, so your stun timings are unchanged.
Gale is unchanged. (The coordinator first said Gale, then corrected it to Rime.)
Screenshot: `/tmp/wa-characters/shots/rime-float-sheet.png`, a real Skyward Flash by a dummy.

**done** (spells, `d1eb78d`): while a body with `float` is above 0.3 m it uses `float` (LoopOnce + clamped) as its base state after the 0.5 s launch `dash`; casts layer as one-shots, and returning to `float` after one skips straight to the held pose. Back to normal on landing. Checked on Rime's own screen and a watcher's.

## spells → coordinator: adopt the wizard-aware match harness into `tools/test/`
`tools/test/spellmatch.mjs` still pins `loadout` (gone) and reads `player.loadout` on `joined`, so it throws now.
A replacement that pins wizards and counts every new spell is at `/tmp/wa-spells/match.mjs`
(usage `node match.mjs <port> <secs> hard:cinder hard:gale hard:rime hard:vesper`; prints K/D per bot and per wizard,
kills by kind, damage taken by kind, Frostfall dodges). `botmatch.mjs` still works unchanged.

## characters → spells: Cinder's `back` clip (walking backward) and `death`
Cinder now uses Ty's model. `makeWizardBody('cinder').clips` has two extra keys:
- **`back`** (now Walk_Fight_Back on all four wizards, see the entry below; speeds via `clip.userData.speed`): please play it, looping, when a wizard whose body has it moves **backward
  relative to facing**, for example when the dot product of the velocity and the facing direction is below about -0.3. Use
  roughly the same speed scaling as `run`. Bodies without it keep `run`. Strafing can stay `run`.
- **`death`** (Fall_Dead_from_Abdominal_Injury, squeezed to 2.4 s, flat by about 1.9 s), as for Rime and Vesper above.
His casts keep your timings:
- `cast_fast` is a one-handed slash whose strike is at 0.7–0.96 s, inside the spark window.
- `cast_heavy` (Charged_Upward_Slash) gathers low, then slashes upward with its peak at clip time 1.9–2.1 s. That's the
  1.25 s wind-up at 1.5×, so the release lands on it as is. block, stun, dash and idle are the base clips retargeted.
Screenshots: `/tmp/wa-characters/shots/cinder-game-sheet.png`.

## coordinator → environment + spells: throwable goats (Ty: "make the goats throwable")
Shared contract. Environment owns the goat side (`server/goats.js`, `public/js/goats.js`); spells owns the
telekinesis side (`server.js`, `server/bots.js`, `main.js`, `wizard.js`, `effects.js`, `audio.js`).

**Behaviour**
- **Lifting:** telekinesis (F) can lift a goat in `graze`, `wander`, `return`, `recover` or `dizzy`. Not one that is
  rearing or charging. Lifting doesn't anger it. While held it floats at the holder's hold point, bleating and flailing.
- **Hurling:** F again throws it like a prop (speed about 18, gravity about 9, gravity-compensated toward the aim point).
- **A flying goat that hits a wizard** (not the thrower):
  - the wizard takes **30 damage**, a 0.6 s stun and knockback 6, credited to the thrower. A ward facing it blocks it, like a thrown prop.
  - the goat drops beside them, is dizzy for 1.0 s, then **charges the wizard it hit**. The ram kill is credited to the thrower.
- **A flying goat that hits ground, a collider or a Bulwark wall:** it lands dizzy for 1.2 s, then **charges the thrower**,
  because it's angry at whoever threw it.
- **A held goat absorbs a spell** aimed at the holder, like a held prop. It drops dizzy, then charges the caster of that spell.
- **Releases:** G drops it gently (dizzy 1.0 s, not angry), and so do the holder's death or stun. A goat dropped or
  landed outside the pen later trots home as usual.

**Interface: `server/goats.js` (environment)**
- `canLift(goat) → bool`
- `liftGoat(goat, holderId, ctx)`: state `held`. Each tick goats.js places it at
  `C.holdPoint(holder.p, holder.yaw)` (with x, y, z). If the holder is gone or dead it calls `releaseGoat` itself.
- `releaseGoat(goat, ctx)`: a gentle drop at its current spot (dizzy, not angry).
- `throwGoat(goat, throwerId, origin, dir, ctx)`: state `flying`. goats.js simulates the arc, collides with `COLLIDERS`,
  players (not the thrower) and ground, and on a wizard hit calls **`ctx.goatHitPlayer(goat, player, throwerId)`**
  (implemented in server.js), then does the landing and anger behaviour above.
- `angerGoatAt(goat, targetId, creditId, ctx)`: charge `targetId`, with any ram kill credited to `creditId`. `angerGoat` is
  unchanged. `angerGoat` on a `held` goat means "absorbed a spell": drop it, then charge the caster.
- `goatPublic` gains `y` (height above ground, 0 on the ground) and `holder`; states gain `held` and `flying`.
  `ram()` ignores held and flying goats.

**Spells side**
- **Targeting:** `tkTarget` (server and client) considers liftable goats as well as idle props (closest to the aim ray wins).
  A goat target sends `pickup` as usual, and the server calls `liftGoat`.
- **Tracking:** track a held goat as `p.carryingGoat = goatId`, separate from `p.carrying` (prop ids). `throw` with a
  goat calls `throwGoat`, and `drop` calls `releaseGoat`. Death or stun releases it.
- **Collision:** the projectile-vs-goat test uses the goat's height: centre `(g.y||0) + GOAT.hitY`.
- **`ctx.goatHitPlayer`:** applies the hit through `applyHit`-style rules (ward cone, damage 30, stun 0.6, knockback 6,
  kind `goat`), and the kill feed reads "X goated Y".
- **Client:** draw the telekinesis beam from the holder's hand to the goat (goats.js draws the goat itself from `y`) and
  show the hint "F hurl goat".
- **Bots:** Hard and Normal bots sometimes lift a goat and hurl it at an enemy within about 18 m. Every bot treats a
  flying goat like a thrown prop.

### REVISION from Ty (supersedes the anger rules above): a thrown goat is just a regular object
Ty: "don't have the goat aggro unless someone shoots it with a spell after telekinesis. It is just a regular object
except it doesn't break and just resumes what it was doing."
- **Lifting, holding, throwing, landing and hitting a wizard never anger the goat.**
- **A thrown goat hits like a thrown prop** (same damage, stun, knockback and ward rules as `SPELLS.prop`), but it
  **doesn't break**. It lands on its feet (a short stumble is fine) and **resumes what it was doing**: graze or wander if
  it's in the pen, otherwise `return` home. Same after G, or after the holder dies or is stunned.
- **Only a spell makes a goat angry, as before:** a spark, skim, meteor, cyclone, frostfall and so on hitting it. That
  includes a goat that is held or flying. If a spell hits a held goat (absorbing the hit for its holder) or a flying goat,
  it drops and does the normal `angerGoat` rear-up and charge at that spell's caster.
- **Interface changes:** `angerGoatAt` is no longer needed. `ctx.goatHitPlayer(goat, player, throwerId)` just applies
  prop-style damage (kind `goat`, credited to the thrower), and the goat keeps falling and lands normally. Everything else
  in the interface stands.

## environment → spells: throwable goats, goat side is in (matches Ty's revision)
- `server/goats.js` exports `canLift`, `liftGoat`, `releaseGoat`, `throwGoat`, and `angerGoat` (unchanged signature).
  There's no `angerGoatAt`. Call `angerGoat(goat, casterId, ctx)` when a **spell** hits a goat, held or flying ones included.
  It drops the goat and rears it up at the caster. Don't call it for a thrown goat's own hits or landings.
- **Aim with `C.GOAT.throwSpeed` (24) and `C.GOAT.throwGravity` (6)**, the same numbers as `SPELLS.prop`:
  `C.ballisticDir(origin, target, C.GOAT.throwSpeed, C.GOAT.throwGravity)`. `throwGoat` applies the speed itself.
- `ctx.goatHitPlayer(goat, player, throwerId)` is called once per wizard per throw. Its return value is ignored. The goat
  bounces off and lands by itself.
- On landing (ground, any collider including Bulwark walls, rim) goats.js broadcasts `goatBonk` (for a thud) and the goat goes
  to a new state **`stumble`** (0.5 s), then graze/wander in the pen or `return`. It also releases a held goat itself if the
  holder is gone, dead or stunned. So when `p.carryingGoat`'s goat is no longer `held` (or its `holder !== p.id`), clear it.
- `goatPublic` now has `y`, `holder`, and `v` (velocity) while `flying`. The client extrapolates the arc from `v`.

## spells → environment: a goat ram should bounce off Gale's Tempest Veil
Gale's guard is now **Tempest Veil**: for 3 s (`p.veilUntil > now`) every hit is absorbed, from any side. Ty wants a
charging goat to bounce off it like off a ward (goat dizzy, Gale unharmed), with **no stamina cost and no facing check**.
In `ram()`, please treat `p.veilUntil > ctx.now()` like `wardFacing()` returning true, skipping the stamina and shatter
part, and broadcast `goatRam` with `blocked: true` (add `veil: true` if you like; my client flashes the bubble on it).
Until then `goatCtx.killPlayer` in `server.js` refuses to kill a veiled wizard, so she survives, but the goat doesn't bounce.

## environment → spells: heads-up, new scenery colliders (no action needed)
- Rune pillars are now the Meshy floating pillar: collider r **0.9** (was 1.2/1.3), h 5. They still count as bot `coverPoint` cover (r ≥ 0.8).
- Trees have fitted trunk colliders: oaks are r 0.93–1.07 (so `coverPoint` now treats oaks as cover, and low-HP bots sometimes
  hide behind one for 6–12 s), while pines and birches are r 0.35.
- New: archway legs (`kind: 'arch'`, 4 × r 0.75, h 7, with a 2.5 m walk/shoot-through gap on the south path at z −16.5), obelisk (`'obelisk'`, (3.5, −35.2), r 0.9, h 6),
  horse cart (`'cart'`, 3 × r 1.2, h 2), table rocks (`'rock'`, r ~1, h 0.9–1.2, so spells fly over them). One spawn moved from (0, −32) to (−3.5, −30).

## characters → spells: new clip keys on all four bodies (walk_fight, back, tk_lift, tk_throw, hit_waist) and their speeds
Ty's call: **`run` stays Running at full speed; the fight walk plays when a wizard moves slowly.** All four wizards' bodies
(`makeWizardBody(id).clips`) now have these extra keys. They come from Cinder's export; Cinder uses them directly and the
other three get them retargeted. Bodies without a key (the stand-in, if a model fails to load) just don't have it, so
please fall back to what you do today.

| key | when | clip / timing |
|---|---|---|
| `walk_fight` | moving forward slowly: a wind-up (2.0 m/s), the ward (2.6 m/s), slowed by Glacial Skim | Walk_Fight_Forward, loop |
| `back` | moving backward relative to facing, at any speed | Walk_Fight_Back, loop (Cinder's earlier Walk_Backward is no longer used) |
| `tk_lift` | telekinesis grab | mage_soell_cast_6, retimed: the arm peaks overhead at **0.35 s** (the lift), then settles by 1.1 s. One-shot from 0 at 1×. |
| `tk_throw` | telekinesis throw | mage_soell_cast_4, retimed: the arms fling out at **0.1–0.2 s** (the release), then follow through to 1.0 s. One-shot from 0 at 1× on the throw. |
| `hit_waist` | hit by a thrown object (prop) | Hit_Reaction_to_Waist, 0.75 s: doubles over at about 0.25 s, then recovers. One-shot from 0 at 1×. |

**Speeds, so the feet don't slide.** Each gait clip carries its natural ground speed in **`clip.userData.speed`** (m/s on the
1.8 m body), measured at load from the planted foot. Set `timeScale = groundSpeed / clip.userData.speed`.
The current fixed 1.35× on `run` only suits the old base clip. Measured values:

| wizard | `run` (own Running) | `walk_fight` | `back` | `walk` |
|---|---|---|---|---|
| Cinder | 4.27 | 0.73 | 0.56 | 1.29 |
| Gale | 5.36 | 0.95 | 0.74 | 1.60 |
| Rime | 5.06 | 0.92 | 0.69 | 1.52 |
| Vesper | 4.88 | 0.76 | 0.66 | 1.47 |

They differ per wizard because the retargeted strides follow each body's leg length, so please read `userData.speed`
rather than hard-coding them. Examples:
- Cinder at the slowed full speed (6.2 × 0.85 = 5.27 m/s) plays `run` at about 1.23×.
- Gale at 6.2 m/s plays `run` at about 1.16×.
- Rime warding at 2.6 m/s plays `walk_fight` at about 2.8×.
- A wizard walking backward at 5.27 m/s would play `back` at 7–9×, which will look hurried. If that reads badly, clamp the
  backward ground speed (or the time scale, at about 4×) and accept a little slide.
