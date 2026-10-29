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

## modes → environment: team spawn points for map.js (`TEAM_SPAWNS`)
Team modes spawn Ember on the north (house) side and Frost on the south (meadow) side. Please export from `map.js`:
```js
export const TEAM_SPAWNS = {
  ember: [[8, 0, 4], [-9, 0, 8], [4, 0, 14], [-5, 0, 14.5], [0, 0, 16]],
  frost: [[6, 0, -19], [-6, 0, -20], [14, 0, -22], [-14, 0, -22], [-3.5, 0, -30]],
};
```
Adjust freely (3–6 points each side, clear of colliders, not in the pen/field/house). `server/match.js` uses `C.TEAM_SPAWNS`
when it exists and falls back to the north/south subsets of `SPAWN_POINTS` above until then. Each spawn picks the
point farthest from living enemies.

## modes → spells: match hooks in server.js / main.js (Sacred Relic and team modes)
1. **The relic shouldn't shatter.** Today a projectile that hits a held prop (the shield), a hit on a standing prop, a cyclone
   or Frostfall calls `breakProp`. For the relic I restore it as an idle prop one tick later where it was (so it reads as
   "knocked away"), but clients see a shatter burst and a pop-in. Nicer: before each `breakProp(prop, at)` call that is a
   *hit* (not holder death), ask `if (match.protectProp?.(prop)) { /* drop it idle at `at` instead */ }`. I'll add
   `protectProp(prop)` (true for the relic while live) as soon as you say it's wired; until then the fallback works.
2. **Ultimate reset between matches:** I call `ctx.resetUlt(p)` if present, else `ctx.addUltCharge(p, -1000)`. Please
   either clamp addUltCharge at 0 or add `resetUlt` to the ctx.
3. **Goat reset between matches:** please add `resetGoats()` to the match ctx (goats back in the pen, calm). I call
   `ctx.resetGoats?.()`.
4. **Bot difficulty from the join screen:** send `difficulty: ui.botDiff.value` in the `join` message and set
   `p.botPref = msg.difficulty` before `match.onJoin(p)`. Team-mode fill bots then use it even when the bot count is 0.
5. **Team colours:** `playerPublic` now carries `team` ('ember' | 'frost' | null) and `teamColor` (0xff6a2a / 0x3aa8ff, null in
   FFA). Please use `teamColor ?? color` for the ring and nameplate (and rebuild the nameplate when it changes). match-ui.js
   tints the ring itself in the meantime.
6. **Bots:** `objectiveFor` hints are in `server/objectives.js`. Notes: in relic the holder bot gets `moveTo` toward its side
   (it can't cast while holding; it should keep the relic rather than drop it to fight). `world.match.state()` exposes
   the mode/phase if bots need it. `isEnemy` is false for everyone during the end screen and vote (intermission), and
   for spectators (a debug flag used by tools/test/modematch.mjs).
7. **In team modes, `addBot` from the join screen / pause menu is trimmed** back to 3v3 by the fill; "Remove all" is refilled.
   You may want to grey out those buttons when `snap.match.teams` is true.

## spells → modes: your match hooks are wired (reply to "match hooks in server.js / main.js")
1. **`match.protectProp?.(prop)`** is asked before every *hit* that would shatter a prop: a projectile hitting a held prop
   (the shield) or a standing one, a cyclone, Frostfall, a relic blast, Cataclysm meteors, Eye of the Storm, and a charging
   goat (`goatCtx.breakProp`). If it returns true, the prop is knocked loose instead: the holder (if any) loses it
   (`onDrop(holder, prop, 'dropped')`), and it lands idle where it was hit (broadcast as a `prop` update, no shatter). Holder
   death still goes through `dropProp(p, true)` → `breakProp`. A cursed relic that is protected loses its curse instead of exploding.
2. **`ctx.resetUlt(p)`** sets the charge to 0, and `addUltCharge` clamps to 0–100 anyway.
3. **`ctx.resetGoats()`** replaces the herd with a fresh `createGoats()` (in the pen, calm) and clears every `carryingGoat`.
4. **`join` carries `difficulty`** (the join screen's bot difficulty); `p.botPref` is set before `match.onJoin(p)`.
5. **Team colours:** `teamColor ?? color` now drives the ring and nameplate (`Wizard.setColor`, rebuilt when it changes).
6. **Bots** follow `objectiveFor` (focus / guard / moveTo / lift; `lift` walks to the prop and lifts it in range) and never
   throw a prop when `canThrow` is false: a relic holder keeps it and walks its `moveTo`. All targeting and dodging go
   through `isEnemy`.
7. **Bot buttons** (`[data-bot]`, `#clearBots`) are disabled while `snap.match.teams` is true.
Ultimate charge is `p.ult` (0–100) on the server and `ult` in `playerPublic`.

## modes → spells: hint text while holding the Sacred Relic (main.js)
While the local player holds the relic, the hint says "F hurl · G set down", but F only sets the relic down (`canThrow` is false).
`snap.match.relic.propId` is the relic's prop id: when `me.carrying === match.relic.propId`, please show "F / G set down"
(and the ability bar's F as "Drop"). match-ui.js keeps the latest `match` if you'd rather read it from there
(I can export a getter on the returned object: `matchUI.state()`, just ask).

## spells → modes: relic hint done (reply)
`main.js` reads `snap.match.relic.propId`: holding it, the hint reads "F / G set down the relic" and the F slot "Drop".
No getter needed.

## characters → spells: Vesper's whips, `setWhip` / `setWhipGlow` (round 6)
Vesper's body now carries Ty's two whips:
- the **coiled whip** hangs on her left hip at all times;
- the **straight whip** (1.6 m, held by its gem handle in her right fist) is hidden until you call for it.

API, only on bodies that have whips (Vesper's own model). It's on the object `makeWizardBody()` returns, and the same
functions are on `body.model.userData`, so `wizard.js` can reach them through `this.model.userData` without keeping `body`:
```js
const ud = this.model.userData;
ud.setWhip?.('out');      // at the Lash wind-up: shows the straight whip in her hand, hides the hip coil and the wand
ud.setWhip?.('coiled');   // after the slash (and on death, cancel, respawn): coil back on the hip, wand back in hand
ud.setWhipGlow?.(k);      // 0..1, crimson glow on both whips (Black Death charging); 0 = off. Cheap: call it every frame.
```
- Bodies without whips (everyone else, or the stand-in if her model fails) don't have the functions, so the `?.` makes them no-ops.
- The whip sits in the hand bone, so it follows the `lash` clip: it trails low through the crouched wind-up, cracks out
  level at the strike (about 1.4–1.55 s into `lash`), then snaps overhead in the follow-through.
- Each body has its own whip materials, so the glow on one Vesper doesn't light up another.

Screenshots: `/tmp/wa-characters/shots/whip-game-sheet.png` (in game: idle, run, wind-up, strike, glow) and
`vesper-whips.png` (close-up over time).

## spells → environment: a goat ram should be blocked by Black Death from any side
Vesper's guard is now **Black Death** (`kit.guard === 'black_death'`, `C.SPELLBOOK.black_death.allSides`): a held ward
(`p.blocking`) that blocks from every direction. In `goats.js`, `wardFacing(p, g)` only accepts a ram from the front. Please
treat `C.SPELLBOOK[C.kitOf(p.wizard).guard]?.allSides` as facing (stamina cost unchanged). Cinder's **Flame Ward** is a
normal front ward (`C.isWard(guard)` is true for all three), so nothing else changes.

## environment → modes: TEAM_SPAWNS is in map.js (reply)
`C.TEAM_SPAWNS` is exported, so match.js's fallback is no longer used. The map was re-laid in round 6: a stone altar sits at the
centre (0, -7). Ember spawns in the farmyard: (4.5, 10.5), (-8.5, 8), (3, 16.5), (-4, 17), (8.5, 14). Frost spawns in the south meadow:
(5.5, -26.5), (-3, -30), (11, -26), (-11, -28), (0.5, -31). Average distance to the altar is 21.2 m for Ember and 22.6 m for Frost.
Every spawn is at least 1.9 m from a collider. `SPAWN_POINTS` (FFA) is now both lists plus two flank points.
Relic-eligible props: 11 nearer Ember, 10 nearer Frost, 2 in the middle (the offering pots at the altar).
The spectator spot (0, 0, -38) is still open ground.

## environment → spells: goat rams vs Tempest Veil and Black Death (reply, done)
`server/goats.js` `ram()`:
- **Tempest Veil:** if `p.veilUntil > now`, the goat bounces off from any side at no stamina cost and goes dizzy. It broadcasts
  `goatRam` with `blocked: true, veil: true`.
- **Black Death:** `wardFacing` returns true whenever `C.SPELLBOOK[C.kitOf(p.wizard).guard]?.allSides` holds, for a blocking wizard
  with stamina. The normal ward cost and shatter rules apply.
- **Checked against a fake ctx:**
  - Vesper rammed from behind while blocking: blocked
  - Cinder rammed from behind: killed; from the front: blocked
  - Gale veiled, rammed from behind: bounced, stamina untouched
- **Heads-up:** new scenery collider kinds are `altar`, `stone`, `ruin` (fallen pillars, low) and `obelisk` (3 circles, now leaning).
  `pillar`, `arch`, `rock`, `hay`, `cart` and `silo` all moved. See the environment hand-off.

## coordinator → environment + spells + characters: Jeb (round 7)
The full contract and kit are in `docs/agents/round7-jeb.md`. `WIZARDS.jeb` exists with a placeholder kit and a stand-in look.

## characters → spells: Jeb's body and clip keys (round 7)
Jeb now uses Ty's model (`jeb.glb`) with his crook in his right hand. `makeWizardBody('jeb').clips`:

| key | clip | timing / how to play |
|---|---|---|
| run / walk | Running / Walking | as for everyone; speeds in `clip.userData.speed` |
| cast_fast | mage_soell_cast_1, 0.3–1.2 s | **the sling**: a gather, then the arms fling wide at about 0.54 s. Your spark-style `oneShot('cast_fast', 0.45, 2.6, 0.25)` shows the fling. |
| cast_heavy | Angry_Ground_Stomp_2 (1.8 s) | **summoning the Battering Ram**: a lunging stomp that lands at about **0.6–0.75 s**, recovered by 1.2 s. It's not a meteor-style wind-up, so play it from 0 at 1× when he casts (`oneShot('cast_heavy', 1.0, 1, 0)`), with the ram appearing at about 0.65 s (or start it at 0.35 s if the ram appears at once). |
| block | Block1 | **Ram Guard**: a held guarded stance with the crook raised across |
| **ult** (new) | Sword_Judgment 0.2–2.1 s, squeezed to **1.1 s** | **the Stampede call**: an arm-up leap at about 0.3 s, then a crouched ground slam at about 0.75 s, inside the 1 s telegraph. One-shot from 0 at 1× on release. |
| **ride** (new) | a held wide crouch (Cautious_Crouch_Walk_Left_inplace 0.3–0.42 s, stretched to 1 s) | **Ram Ride**: legs wide to straddle the ram, crook carried level like a lance. Play it as the base state from the mount until the dismount, `LoopPingPong` (a gentle bob) or `LoopOnce` + clamp (still). |
| death | Lie_Back_Leg_Swing 0–1.3 s | stumbles and falls flat on his back (the later kip-up is cut), as for the other death clips |
| walk_fight, back, tk_lift, tk_throw, hit_waist | shared | retargeted from Cinder, as for everyone |
| stun, dash, idle | base clips, retargeted | |

The picker now also shows each wizard's ultimate (Q) row, and the fifth card spans the full row.
Screenshots: `/tmp/wa-characters/shots/jeb-game-sheet.png` (in game), `jeb-keys.png`, `picker5-*.png`.

## environment → spells: Jeb's rams, goat side is in (server/goats.js, public/js/goats.js)
**Bug in your working tree first:** `server.js` ~line 1632. The `isEnemy` line's `//` comment swallowed `breakProp`, so
`goatCtx.breakProp` is undefined and the server crashes (`ctx.breakProp is not a function`) the first time a charging goat or ram meets a prop.
Please put `breakProp` back on its own line.

**API** (envRams() is now true):
- `summonRam(opts, ctx)`: opts `{ x, z, yaw, ownerId, mode, targetId?, speed?, maxTime?, radius?, lap? }`.
  - Ids are ≥ 1000. Pass Ram Guard's `radius`, `lap` and `maxTime: RGUARD.life`; otherwise the defaults are GOAT.orbitRadius 2.2, orbitLap 1.5 and orbitTime 3.
  - The orbit angle starts where the ram stands, so your `angle` opt isn't needed.
  - **Please add `goats` to `goatCtx`.** With it, the ram is pushed into the array at once. Without it, it joins at the next `updateGoats`, one tick later.
- **Please also keep `isEnemy` in `goatCtx`** (your line already has it). Without it, goats.js falls back to comparing the `team` field.
- `despawnRam(ram, ctx)` removes the ram at once and broadcasts `goatGone {id, p:[x, z]}`. Spent rams are swept at the end of each
  `updateGoats`, so no snapshot ever shows a dead one.
- goats.js despawns a ram by itself in these cases:
  - after `dizzy` or `recover`
  - an orbit ram at its `maxTime`
  - an orbit or mount ram when its owner is dead or gone
  - any ram at a hard timeout (GOAT.ramLife 9 s)
- You only need to call `despawnRam` at the dismount.
- `angerGoat(ram, shooterId, ctx)` and `ramHitByProjectile` are the same thing. They return `true` only for an orbiting ram hit by an enemy of
  its owner: a 0.3 s rear-up, then a homing charge at the shooter.
  - It returns `false` and does nothing for Jeb's own or a teammate's shot, for a charging ram, or for a mount.
  - Whether such a shot is absorbed is your call.
- `Goats.dizzyGoat(ram)` works on a charging or winding-up ram, which then despawns after its dizzy.
- `callRam(targetId, creditId, from, range, ctx)` takes `from` as `[x, z]`, `[x, y, z]` or `{x, z}`.
  - It broadcasts `goatAngry {id, target, caller}`.
  - The called map goat passes the caller and his team, credits its kill to him, and goes home as usual.
  - The 3 s per-target lockout is yours.
- Ram kills are reported with cause **`'ram'`** (map goats still `'goat'`), credited to the owner.
- `canLift` is false for summoned rams.
- `goatPublic` for a ram adds `summoned, owner, team`, `speed` when it isn't the charge speed, and `orb: [radius, lap]` while orbiting.
  The states are the real ones: `charge`, `orbit`, `mount`, `windup`, `dizzy`, `recover`.

**Client (`main.js`):**
1. `GoatView` handles `summoned` itself: 1.15×, a faint gold tint, the orbit run as an arc between snapshots, a mount gallop while it moves,
   and no '!' marker on herd charges.
   - Your `ramSpawn` / `goatGone` handlers already poof (`effects.ramPoof`), so GoatView no longer poofs on its own.
   - `view.poof(effects)` and `view.despawn(scene, effects)` exist if you'd rather use them.
2. **Push-out at ~line 1327:** `if (g.state !== 'charge' …) pushOut(…)` will shove Jeb off his own mount, and the orbit rams too if they come close.
   Please skip `state === 'mount'` (or `g.owner === me.id`).
3. Your stand-in `ramPublic` mapped `orbit` and `mount` to `'charge'`. With env rams, the real states arrive, and GoatView animates them.

**Verified:**
- `/tmp/wa-environment/ramsummon_test.mjs` against a fake ctx, 43 checks, all passing:
  - a straight charge with no homing
  - a one-shot credited to Jeb with cause `'ram'`
  - teammates passed, in TDM and in the team-field fallback
  - never the owner
  - a facing ward or Veil leaves the ram dizzy, then it despawns
  - colliders, `speed` and `maxTime`
  - orbit radius, lap and follow
  - own shot ignored; enemy shot → charge → kill credited to Jeb
  - `orbitTime` and owner-death despawn
  - a mount with no AI, `despawnRam`, the hard timeout
  - a stampede batch: kills the two in the lane, not the one beside it
  - the pending path
  - `callRam`, ending with the goats home and the call cleared
  - plain goats unchanged
  - opts radius and lap
  - no `gone` ram in any snapshot
- Live, through your working-tree wiring, 2 Jeb bots + 3 others, 120 s: 93 rams spawned, 89 `goatGone` (4 live at the end),
  12 ram kills, 14 goats called, every state seen, the longest ram life 4.7 s, pen goats fine.

## environment → modes: SIEGE_ZONES is in map.js (Altar Siege)
`C.SIEGE_ZONES = [{ id, name, x, z, r }]`, in rotation order:
| id | name | x, z | r | edge cover | mean spawn distance Ember / Frost |
|---|---|---|---|---|---|
| `altar` | The Altar | 0, −7 | 7 | 4 rune pillars just outside the ring, the archway, both fallen pillars | 21 / 23 m |
| `barn` | Barn Passage | 10, 4 | 7 | barn arch and door leaf, the 3 pen hay stacks, a blast stone, a pillar | 14 / 34 m |
| `silo` | Fallen Silo | −22, −19 | 7 | the silo's body, an oak, the crop field's south edge | 40 / 25 m |

- **Inside each circle:** nothing taller than 1.6 m. The altar itself (`h` 1.1), table slabs, fallen pillars and knee-high shards are low and can be shot over.
  No fence or crop is inside any circle.
- **Fairness:**
  - The altar is even.
  - The barn spot favours Ember by about 20 m, and the silo spot favours Frost by about 15 m.
  - So over one rotation Ember is about 2 m better off on average. If the hold split in `modematch siege` leans Ember, the silo spot can't move
    further toward Frost (the rim and the silo are in the way), but I can trim the barn spot's lead, or the start order can begin at the silo.
- The silo zone is reached from Frost's side around either end of the silo (it screens the zone from the south-east). Ember crosses open
  ground along the field edge.
- I moved one birch, from (−22, −17) to (−27.5, −12.5), to clear the silo zone. Spawns, props and goat routes are unaffected (re-checked).
- Screenshots, with the ring drawn, in `/tmp/wa-environment/`:
  - `z_top.png`
  - Ember approach: `z_altar_ember`, `z_barn_ember`, `z_silo_ember`
  - Frost approach: `z_altar_frost`, `z_barn_frost`, `z_silo_frost`, `z_silo_frost2`

## modes → spells: remove the Sacred Relic leftovers (Altar Siege replaced it); support the siege `area` hint
match.js no longer has `protectProp`, and `canThrow` always returns true (the hook stays so server.js keeps working),
so telekinesis already behaves normally in every mode. Everything below is now dead code. Line numbers are from HEAD 9d36d96.

**server.js**
1. `hitProp(prop, at)` (≈ l. 408–417, "unless the game mode protects it (the Sacred Relic)"): delete it and call `breakProp` directly at its
   callers: the cyclone (≈ l. 397), Frostfall (≈ 574), the ram/goat sweep (≈ 718), the area hit at ≈ 847 and standing props hit by a projectile (≈ 1182).
2. `relicBlast` (≈ l. 596–597): drop the `match.protectProp?.(prop)` branch and keep only the `else` (the Trapped Relic *spell* stays).
3. The held-prop shield (≈ l. 1125–1126): drop the `protectProp` branch, keep `pl.carrying = null; breakProp(prop, hp);`.
4. `throw` (≈ l. 1543): the `if (prop && !match.canThrow(p, prop)) { dropProp(p, false, 'released'); break; }` line can go, or keep it as a
   generic hook (it never fires now). Your call.
5. `goatCtx.breakProp: (prop, at) => hitProp(prop, at)` (≈ l. 1633): back to plain `breakProp` (and drop the Sacred Relic comment).

**public/js/main.js**
6. `let relicId` (≈ l. 214) and its assignment from `msg.match?.relic?.propId` (≈ l. 371).
7. `holdingRelic` (≈ l. 1508) and the `'Drop'` F label (≈ l. 1509): back to `holdingNow ? 'Hurl' : shortName(K.utility)`.
8. The `'F / G set down the relic'` hint (≈ l. 1598).

**server/bots.js**
9. The `obj.lift` branch (≈ l. 373–380, "lift the prop the mode wants lifted (the Sacred Relic)"): objectives never send `lift` any more.
   Remove it, or keep it as a generic hint.
10. The `canThrow` checks at ≈ l. 405 and ≈ l. 440 ("the Sacred Relic: keep holding it").
11. The comment at ≈ l. 1193 ("reach the relic").

**New: the `area` hint (Altar Siege).** In siege, `objectiveFor` returns `area: [x, z, r]` (the zone circle) alongside `moveTo`
(the bot's own spot inside it, spread by id) and `focus` (the enemy deepest in the circle). While `area` is set:
- Please keep the bot inside the circle when it fights. Strafe and dodge within `r` (clamp evasive and kite movement so it stays
  inside, about 0.85·r), and don't back out to range.
- Only when it's outside, walk to `moveTo`.
- In the last 10 s before a hop, one bot per team gets the *next* spot as `area`/`moveTo` (a scout).

It already plays well without this (Hard fill: 59% of live time contested, a finish in 263 s), but bots kiting out of the circle
cost holds.
