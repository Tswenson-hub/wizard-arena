# Brief: spells agent (round 4: wizards with fixed kits)

Read `docs/agents/shared-rules.md` first (the ownership table changed this round). You built the spellbook last
round: `docs/agents/gameplay-handoff.md` is your own earlier hand-off.

## Goal
Players no longer mix and match spells. They **pick a wizard**, and each wizard has a fixed kit of five spells.
Ty approved the roster and the spell designs below. Ty's decisions:
1. Spells are locked to the wizard. **Remove the free spellbook picker** (join screen and Esc menu).
2. Trapped Relic explodes **at the person who lifts it** (details below).
3. Sanguine Lash's lockdown is **1.25 s** (not 3 s).

## Roster (`public/shared/wizards.js`, already written)
| Wizard | Primary (LMB) | Power (RMB) | Mobility (E) | Guard (Space) | Utility (F) |
|---|---|---|---|---|---|
| Cinder, the Pyromancer | spark | meteor | blink | ward | telekinesis |
| Gale, the Tempest Dervish | spark | cyclone | skyward | ward | telekinesis |
| Rime, the Frost Warden | glacial_skim | meteor | skyward | glacial_bulwark | telekinesis |
| Vesper, the Hemomancer | spark | sanguine_lash | mirror_step | ward | trapped_relic |

You own the `kit` fields; the characters agent owns the look fields.

## 1. Wizard selection replaces loadouts
- Ward and telekinesis become spellbook entries too: slots `primary, power, mobility, guard, utility` (`KIT_SLOTS`).
  Add `SPELLBOOK` entries for `ward`, `telekinesis` and the five new spells. A player's spells are `WIZARDS[p.wizard].kit`.
- `join` carries `wizard: id`, and a new `{t:'wizard', id}` message switches wizard in game. Validate with `isWizard`.
  A switch applies when that player respawns, or immediately if they are alive and not mid-cast.
  Snapshots carry `wizard`, and `playerPublic` includes it. Remove the `loadout` message, `sanitizeLoadout` and its UI. The
  scoreboard shows the wizard's name. Ring and nameplate colour come from `WIZARDS[id].color`. Player colours may repeat; that's fine.
- **UI:** the join screen and Esc menu use the characters agent's picker:
  `import { mountWizardPicker } from './select.js'`, then `mountWizardPicker(containerEl, { selected, onChange(id) })` returns
  `{ set(id), destroy() }`. The picker draws the cards (preview, name, title, role, the five spells with blurbs from `SPELLBOOK`).
  You provide the containers in `index.html`, save the choice in `localStorage.wizardChoice`, and send it.
  Until the real picker lands, `select.js` is a stub, so a temporary `<select>` fallback is fine.
- `new Wizard(info, …)` already passes `info.wizard` to `makeWizardBody()` (`looks.js`), so make sure `info.wizard` is set
  everywhere a Wizard is made (welcome, joined, snapshots), and rebuild a player's Wizard object if their wizard changes.
- The ability bar shows the wizard's spell names for all five keys.
- Bots: `addBot` takes an optional `wizard`. Otherwise each bot picks one at random. `node bot.js` keeps working.

## 2. New spells
Tuning goes in `SPELLBOOK`. Ty's spec, plus the details we agreed:

**Glacial Skim** (primary)
- Three small ice shards in a tight forward cone (±6°), skimming along the ground (y ≈ 0.35). 11 damage each.
- A hit slows the target's movement by 35% for 2 s. Refresh the slow on new hits; don't stack it.
- Cooldown 0.6 s. No stun.
- The shards are blocked by every collider whose `h` is above their height, which includes low fences and crops.
- They can't hit wizards in the air from Skyward Flash, because they fly at ground level.
- A ward stops each shard for a small stamina cost (about 6).
- They break props and anger goats like other projectiles.
- **Slowing a human:** the client owns its movement, so send the slow to the client and enforce it in `updateLocal()` speed.
  Make the server's speed check allow for it, i.e. it must not punish slowed players. Slowed wizards show frost on themselves.

**Sanguine Lash** (power)
- **Wind-up:** 1.5 s with a red whip coiling around the caster as the warning. Being hit cancels it, like meteor.
- **Then:** a fast whip projectile (about 28 m/s, about 22 m range) that **pierces**: it hits every wizard along its path.
- **On a hit:** 12 damage plus **bind for 1.25 s**: rooted (no movement, including knockback) and silenced (no spells, ward
  or telekinesis). It also cancels the target's wind-up or cyclone.
- **On a miss** (it hit nobody): the caster is rooted for 1.0 s in a recovery pose.
- A ward that faces the caster blocks it, costing 40 stamina.
- Cooldown 13 s.
- Visuals: red chains or glyphs on a bound wizard.

**Mirror Step** (mobility)
- **The dash:** an instant 7 m along the movement input (WASD direction; forward if none). It splits into three paths:
  centre, and ±30°. The caster appears on one of the three at random; the other two are taken by **decoys**.
- **Decoys:** server entities that run along their own path at run speed for 2.5 s, then fade.
  - To opponents they look exactly like the caster: same wizard model, name, nameplate, health bar and run animation.
  - Each has 1 HP and vanishes in a puff when anything hits it (projectile, cyclone, prop, goat).
  - Projectiles stop on decoys.
  - On the caster's own screen, decoys are see-through.
- Bots target a decoy with a chance by difficulty: Easy about 50%, Normal about 30%, Hard about 15%.
- Cooldown 7 s.

**Glacial Bulwark** (guard, Rime's Space; replaces the ward entirely)
- **Tap Space:** an ice wall appears 2.5 m ahead, centred on and perpendicular to the aim direction.
  It is 2.7 m tall and 2.7 m wide.
- **It blocks everything:** all movement (players, bots, goats), projectiles, thrown props and line of sight.
  - Charging goats that hit it go dizzy. This works automatically: goats bonk on any collider of `kind` other than fence/crop.
- It lasts 10 s or until it takes 120 damage. Show cracks as it takes damage, and shatter it into ice shards at the end.
- Cooldown 12 s. Rime has **no** hold-to-block.
- **How:** push the wall into the shared `C.COLLIDERS` array at runtime, as a chain of about 5 circles (r about 0.35, h 2.7,
  `kind: 'bulwark'`, `wall: <id>`), and splice them out when it ends. Do this on the server, and on every client from
  `wallUp` / `wallDown` messages (and in `welcome` for walls already standing).
  - Every collision loop already iterates `COLLIDERS`: movement, projectiles, line of sight, camera, goats and bots.
    So nobody else's files change.
  - Track wall HP separately: projectiles that hit a `bulwark` collider damage that wall.

**Trapped Relic** (utility, Vesper's F)
- **Lifting still works:** tap F to lift and hurl as normal.
- **Cursing:** hold F for 0.5 s while aiming at a loose idle prop. This curses it instead of lifting it.
  - The server tracks `prop.cursedBy`. One cursed prop per caster: a new curse removes the old one.
  - Only the caster sees it, as a faint red glyph. It's invisible to everyone else and to their clients, so don't broadcast it.
- **When an opponent lifts it:** it rises as usual, then **explodes as it arrives** at their hold point.
  - 45 damage within 3.5 m, plus knockback.
  - A ward facing the blast blocks it for 40 stamina.
  - The kill goes to the curser.
- Lifting your own cursed prop just lifts it, and clears the curse. If the prop breaks some other way, the curse is gone.
- **Bots:** Vesper bots curse props near the enemy. Other bots don't know about curses (no cheating), but Hard bots stop
  re-lifting a prop that blew up on them recently.

## 3. Bots
Every bot must handle all twelve spells. Specifically, bots:
- dodge a Lash wind-up aimed at them (strafe out of the line, or ward facing it)
- treat Glacial Skim like a spark threat
- use Bulwark against meteors, lashes and goat charges
- shoot decoys at the rates above
- use Mirror Step to escape
- curse props when playing Vesper

Re-run `tools/test/botmatch.mjs` and `tools/test/spellmatch.mjs`, extending spellmatch to pin wizards. Check:
- the difficulty spread still holds
- no wizard dominates: run 4 Hard bots, one of each wizard, about 3 × 120 s, and report K/D per wizard

## Verify (Playwright, port 4101)
- **Selection:**
  - each wizard's kit applies; the ability bar shows its spells
  - the choice survives a reload
  - `{t:'wizard', id:'nope'}` is ignored
- **Glacial Skim:** three shards; a hit slows a dummy (measure its speed); fences block the shards; a wizard in the air is untouched.
- **Lash:**
  - a hit binds a dummy for 1.25 s (it can't move or cast)
  - it pierces two dummies in a line
  - a miss roots the caster for 1 s
  - a hit during the wind-up cancels it
- **Mirror Step:** two decoys appear; the caster ends up on one of the three paths; a spark kills a decoy in one hit.
- **Bulwark:** the wall blocks a spark and a dummy walking into it, takes damage and breaks at 120, and stops a charging goat.
- **Relic:** an opponent lifting the cursed prop takes 45 damage; the curse is invisible on the opponent's client.
- **Screenshots:** the picker or fallback, a lash wind-up, a bound wizard, decoys, the wall, and a relic blast. Look at each.

Finish with `docs/agents/spells-handoff.md`.
