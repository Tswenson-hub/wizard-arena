# Round 13 brief: agility (a double jump, casting on the move and casting in the air)

## Context
Ty: "We need to add a good amount of general mobility… Space bar should allow a double jump, stylized and with an
animation… Most spells should be able to be cast while moving. Only significant spells require rooting to the ground
and pausing. All spells should be able to be cast in the air. We need a lot more agility in the gameplay."

**His choices:**
- **Root only the big wind-ups:**
  - the 6 ultimates (1.3 s wind-up)
  - Meteor's charge, Sanguine Lash's wind-up and Battering Ram's wind-up
  - the Blizzard channel

  Everything else casts on the move, with at most a short slow.
- **Air roots hang you in the air.** Starting a rooting spell in mid-air holds you in place for the wind-up, with a float
  effect, then you drop on release.
- **Snappier movement at the same top speed:** walk stays 3.0 and sprint 5.5, but acceleration is about double, air
  control is full and sprint momentum carries through jumps.

**How it works today:**
- **Jump:** one fixed arc, `C.JUMP` (1.45 m high, 0.63 s, `{start, y0}`), with no air jump and no coyote time.
  Movement is client-authoritative, and the server checks it with a speed budget and height clamps (`case 'state'`,
  server.js:1653-1734).
- **Cast roots:** nearly every cast roots briefly (`CAST_ROOT`, constants.js:682). Neither server.js `castRooted`
  (:440) nor its client copy (main.js:1990) lets you move during it, and casting ends a sprint.
- **Casting during a jump:** `JUMP_LOCKED` (server.js:136) refuses most casts mid-jump. Skyward refuses most of the rest,
  and the client adds checks the server doesn't make (Blink, Veil, Smoke Flask and Ram Guard).
- **Speed modifiers:** `CHARGE_MOVE_SPEED` and `BLOCK_MOVE_SPEED` exist but nothing uses them.
- **Animation:** there's no jump or flip clip; every airborne state uses `float` (rime.Fall2).
  `cinder.Dive_Down_and_Land` has a tuck and somersault from about 0.2 to 0.5 s, and `wizard.js` already has procedural
  `spinT` and `hopT` hooks.
- **Tests:** none checks rooting or air casting.

## 1. Double jump (spells agent: constants.js, server.js, main.js, bots.js)
- **The rule:** Space while airborne gives **one air jump**, reset on landing. Airborne here covers a jump, a fall off
  an edge, or a drop after a dash.
  - The air jump is a fresh arc from the current height: `{start: now, y0: currentY, n: 2}`, about **1.2 m** higher.
  - It costs **10 stamina** (the first jump stays 10).
  - Air steering snaps toward the movement keys, so the air jump changes direction.
- **Coyote time:** a **0.12 s** grace to make the first jump after walking off an edge.
- **Server:**
  - `case 'jump'` accepts an air jump when `!p.airJumped` and you're airborne (a jump or a fall), and sets the new `p.jump`.
  - The height clamp (:1672) follows the new `y0`.
  - The ledge grab uses `jump.y0 + JUMP.height` (`startGrab` :538), so it gives reach from the second apex for free.
  - Bot arcs (:1432) use the new `y0` too.
  - The `jump` broadcast carries `n:2` so other clients play the flip.
- **Client:**
  - Space handler at main.js:1962. Track `local.airJumped`, cleared in `landed()` (:2058).
  - `local.fall` turns into a jump arc when you air-jump.

## 2. Casting on the move and in the air (spells agent)
- **Roots:** only these root:
  - `charging` (Meteor), `lash` and `ramWind` wind-ups
  - `ultWind`
  - Blizzard's `blizz` channel
  - the ledge pull-up `grab`

  Everything else replaces its `CAST_ROOT` entry with a **cast slow of 60% speed for 0.3 s**.
  - Add `C.CAST_SLOW = { mult: 0.6, time: 0.3 }` and `p.castSlowUntil`.
  - The server's speed budget (:1703) allows `own × 0.6` instead of 0. The client copies this at :1990-1996.
  - Primaries, Cyclone, Frostfall, Toxic Flask, the tap shields (Firewall, Bulwark, Smoke Flask, Ram Guard), held Ward
    and Black Death, Telekinesis lift and throw, the Relic curse and hold, and Flask Step's wind-up no longer root.
  - Held shields move at the existing `BLOCK_MOVE_SPEED` (×0.42); actually use that constant.
  - Charging or casting no longer ends a sprint; only the slow applies, and the sprint resumes after it.
  - Sanguine Lash's miss bind (a 1.0 s hard root) stays, because it's a punishment, not a cast.
- **Everything casts in the air:**
  - Empty `JUMP_LOCKED` and the 0.15 s `castLock`, apart from things that genuinely need ground:
    - **Ram Ride:** in the air, the ram spawns under you as you land.
    - **Battering Ram:** it spawns on the ground below the aim point.
  - Remove the Skyward refusals (`chargeStart`, cyclone, lash, block, ult, smoke, roll, mirror, toxic, flaskStep,
    firewall, bulwark).
  - Fix the client-only refusals so the client and server agree (Blink, Veil, Smoke Flask, Ram Guard, aimed ults).
  - **Ground-placed spells cast from the air** (Firewall, Bulwark, Frostfall, Toxic's pool, Smoke Flask, Night Cage,
    Stampede) project down to `surfaceHeight` under the aim point; the existing aim helpers already raycast to the
    ground.
  - **Air dashes:** Blink, Roll, Smoke Screen, Mirror Step and Skyward work in the air. A dash in the air keeps your
    height (a horizontal air dash), and then you fall.
    - Roll in the air becomes a flipping air-dodge (the roll clip's tuck).
    - Each air dash still uses its normal cooldown or charges.
- **Air hang for rooting spells:** starting a rooting wind-up in mid-air (the ult wind-up, Meteor charge, Lash wind-up
  or Ram wind-up) **freezes your height**: `p.hover = {y, until: release}`.
  - Show a float pose, a rune ring under your feet, and a soft hum.
  - On release or interrupt you fall normally, and your air jump is still available if unused.
  - It's capped at the wind-up length.
  - You're a stationary target while hanging, which keeps the commitment.
  - The server's height clamp and fall rules respect `p.hover`. Bots get the same.

## 3. Snappier movement (spells agent)
- **Ground acceleration:** rate 12 → **24/s**, and deceleration when releasing keys **30/s**, so stops are crisp
  (main.js:2017).
- **Air control:** 0.6 → **1.0**. Keep horizontal momentum from a sprint into a jump, so a sprint-jump carries 5.5 m/s.
  - The server's budget gives airborne wizards the speed they took off with, using `p.jumpSpeed` set at takeoff.
- **Instant direction changes** while strafing (A/D) remain, and backpedal stays at 2.
- **Landing:** no landing lag. A landing at the end of a double jump plays a quick 0.15 s land pose, with a dust ring
  and `skyward_land` at a low volume.
- Walk 3.0 and sprint 5.5 are unchanged. Sprint is still free.

## 4. Animation and style (characters agent: spellanim.js, looks.js, wizard.js)
- **Double-jump flip:**
  - New `double_jump` key cut from `cinder.Dive_Down_and_Land`, the tuck-to-somersault portion at about 0.2–0.5 s with
    `flatY`, warped to about 0.45 s.
  - Then it blends back to `float`.
  - If it reads badly, fall back to the `cinder.Roll_Dodge` tuck played in the air plus a procedural forward rotation
    added to `model.rotation.x` (wizard.js:530 currently overwrites it, so make that additive).
  - Pick whichever looks best, and record why in the hand-off.
- **Jump takeoff and land:**
  - A short `jump` key, for example from the `jeb.Sword_Judgment` leap or a cut of the Roll start, so the first jump
    isn't just `float`.
  - A `land` key used after a double jump.
- **Air roll:** the roll keys play in the air (no ground snap).
- **Hover pose:** the existing wind-up clips play while hanging, plus a slight float bob (`hopT`).
- **Flag clips we still lack** (a true front flip, a backflip, a jump takeoff) in the hand-off as Meshy export
  requests for Ty.

**Effects (spells agent: effects.js, audio.js):**
- **On the air jump:** an element-tinted burst ring under the feet (`effects.groundRing` / `land`, coloured by
  `loadoutColor`), a short trail during the flip, and `whoosh` plus `skyward_launch` at a high rate and low volume.
- **On the hover:** a rune circle under the feet.

## 5. Bots (spells agent: bots.js)
- **Air jump:**
  - to reach ledges beyond a single jump (`ledgeTarget` with the raised apex, :1514)
  - as a dodge (alongside the Roll at :497 and :718)
  - to hop Skim volleys (:1287)
- **Cast while moving:** remove the "stop to cast" (`castRootedBot` :216 and the stop at :1479) for spells that no longer
  root, so bots strafe while firing.
- **Use air casts sometimes:** jump, then fire; Hard bots do it more.
- Bots know about the hover window and treat a hanging enemy as a punish window, as they do for rooted targets now
  (:463).

## 6. Tests (spells agent: tools/test/modematch-unit.mjs)
- An air jump is accepted once per airtime and refused a second time, and it resets on landing.
- The second apex is about 1.2 m above the first jump's height. Coyote time works.
- A primary cast while moving is accepted, and the position keeps advancing at 60% speed during the slow.
- A Meteor charge still roots on the ground.
- A primary, Frostfall, Firewall and an ult cast mid-jump are accepted.
- An ult wind-up in the air holds the height (hover), then falls after release.
- The server's speed budget accepts sprint-jump momentum and rejects a speed beyond it.

## Who and order
| Agent | Work |
|---|---|
| Spells | §1, §2, §3, §5, §6 and the effects. It starts with the constants and posts the `n:2` jump broadcast and hover state in `requests.md` |
| Characters | §4 animations |
| Environment | **verification only**. Air jumps raise reach to about 2.65 m + 1.2 m. Check that no perch meant to be stairs-only becomes trivially reachable (or that it's fine), that no player can jump out over the rim, and that ledge grabs onto roofs don't break things. Mark any perch that needs it `noStand`, and report |

The coordinator then verifies on a private port, updates port 3000 and asks Ty before pushing to Render.

## Verification
- `MATCH_DEBUG=1 node tools/test/modematch-unit.mjs` prints ALL PASS, with the new tests.
- **Headless Playwright with the GPU flags:**
  - Double-jump screenshots of the takeoff, flip and land, and a measured apex of about 2.65 m.
  - Strafing while firing Spark (the position changes during the cast).
  - Firing in mid-jump, and a Meteor Rain started mid-air hanging.
  - No console errors.
- **Bot match:** `botmatch.mjs` on Hard; bots double-jump and air-cast with no rubber-banding or stalls.
  `loadoutbalance.mjs <port> 12 75 hard` shows no new dominant spell (watch Spark and Trapped Relic).
- **Port 3000:** updated and checked, then hand it to Ty to feel.
