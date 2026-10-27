# Brief: gameplay agent ("spellbook")

Read `docs/agents/shared-rules.md` first. You own combat, the server, bots, the client game loop and UI.

## Goal
Ty wants replayability: **players pick which spell goes in each ability slot**, and come back to try
combinations. Build a loadout system and two new spells.

### Loadout system
- Slots: **Primary (LMB)**: Spark only for now. **Power (RMB)**: Meteor *or* **Arcane Cyclone**.
  **Mobility (E)**: Blink *or* **Skyward Flash**. Ward (Space) and Telekinesis (F) stay fixed.
- Make spells data: a `SPELLBOOK` in `constants.js` (`id`, `slot`, `name`, `blurb`, tuning). Adding
  a spell later should mean one table entry plus its handler.
- UI: a spellbook picker on the join screen and in the `Esc` pause menu: one card per spell per slot
  (name, one-line description, the slot's key), with the selected card highlighted. Save it in
  `localStorage`. The ability bar shows the equipped spell's name; scoreboard rows show each player's spells.
- Network: `join` carries `loadout: {power, mobility}`, plus a new `loadout` message to change it in
  game. The server validates ids (reject unknown ids and keep the old ones) and stores `p.loadout`.
  A change applies immediately unless that slot is mid-cast. `playerPublic` includes the loadout.
  Cooldowns are per slot.

### Arcane Cyclone (Power slot, RMB)
- Press RMB: a **0.45 s wind-up** during which you can't ward and move at 2 m/s. Getting hit
  cancels it, like Meteor's wind-up does today.
- Then a **0.5 s spin**: the wizard spins two full turns (rotate the model; the `cast_fast`/`dash`
  clips can layer underneath). One damage pulse at the start of the spin:
  - radius **5.5 m**, **28 damage**, 0.35 s stun, knockback 6 m/s straight outward
  - breaks standing props in the radius
  - angers goats in the radius: call `angerGoat(goat, ownerId, goatCtx)` from `server/goats.js`
  - a ward blocks it only if it faces the caster (reuse the cone test in `applyHit`), costing 35 stamina
- Cooldown 5 s. Purple theme:
  - wind-up: a purple runic circle growing on the ground (the telegraph other players react to)
  - spin: an expanding purple shockwave ring plus motes, and camera shake for anyone inside
  - sound: a swoosh plus a low thump (reuse samples in `public/sounds` with pitch changes, or
    `tk_throw` + `impact_big`)
- Server state like `charging`: `p.cyclone` with timestamps. Broadcast `cycloneStart` /
  `cyclonePulse {id, p, hits:[...]}` / `cycloneCancel`.

### Skyward Flash (Mobility slot, E)
- Press E: **instant flash straight up to 7 m** (a purple light streak from the ground, a ring on
  the ground, the blink sound pitched up, `dash` animation).
- Then **float down** over about 2.8 s at a default 2.5 m/s; **hold E** to slow the fall to
  1.2 m/s, and press **Space** (or let go after 2.8 s) to drop at 6 m/s. Full horizontal steering
  at 4.5 m/s while airborne.
- While airborne you can cast Spark and throw with telekinesis (shooting down from above). You can't
  ward or start the Power spell. Goats and ground props can't touch you (the environment agent is
  making goat rams ignore wizards with `p[1] >= 1`).
- Cooldown 6 s from launch. A soft shadow ring on the ground shows where you'll land.
- Clients own their position. Today the server's `state` handler clamps y to 0–3. Allow up to 8 m
  only inside an active flight window you track server-side (`p.flightUntil`), and sanity-check
  the fall rate. Projectile hits already use `p[1]`, so airborne wizards are hittable. Make sure
  `HIT_CENTER_Y` applies at height and that the client's camera pivot follows `local.pos.y`.
- Landing: snap to y = 0, a small dust puff. No fall damage.

### Bots (`server/bots.js`)
- Each bot picks a random loadout when added (`node bot.js` / in-game buttons keep working).
- Cyclone bots: use it when the target is inside about 4.5 m (and as an answer to a goat charge if
  it would land first). Treat an enemy's cyclone wind-up within 6 m as a threat and back out of
  the radius.
- Skyward Flash bots: use it to escape meteors, cyclones and goat charges, and sometimes to take
  the high ground for sparks. Bots don't otherwise move vertically; give airborne bots the same
  descent physics.
- Lead shots at airborne targets: they fall at a known rate, so predict y.
- Re-run `tools/test/botmatch.mjs` to confirm the spread still holds: Hard clearly beats Normal,
  which beats Easy. Report the numbers.

## Interfaces with environment (don't break these)
- `public/shared/map.js` is the environment agent's: layout, `COLLIDERS`, `PROP_TYPES`, `GOAT`,
  spawns. Read it through `constants.js`. Don't hardcode positions, the arena radius or obstacle lists.
- `server/goats.js` and `public/js/goats.js` are the environment agent's. Call `angerGoat`; don't change it.
- `public/js/world.js` is the environment agent's (`buildWorld`, `loadModels`, `makePropMesh`).
  `main.js` must keep calling `loadModels(loader, scene)` and waiting on it before enabling Join.

## Verify
- Playwright on port 4101:
  - cyclone hits a stationary bot within 5.5 m (HP drops 28, knocked outward) and misses one at 7 m
  - a ward facing the caster blocks it
  - Skyward Flash: `__wa.local.pos.y` peaks at about 7. Descent with E held is slower than without.
    You land at y = 0, and a spark fired at height hits a bot below.
  - loadout survives a reload (localStorage), and the server ignores `{t:'loadout', power:'nope'}`
- Screenshots of the spellbook UI on the join screen and in the pause menu, a cyclone mid-spin and a
  wizard mid-air. Look at them.
- botmatch numbers in your hand-off.
