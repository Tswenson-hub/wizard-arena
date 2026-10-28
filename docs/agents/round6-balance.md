# Round 6: Ty's balance and identity pass

Ty's words are in quotes; anything else is the coordinator's proposal for details Ty left open. Tuning goes in `SPELLBOOK`.

## Spells agent

### Number changes
- **Eye of the Storm:** 12 → **8 damage per tick**.
- **Cinder's Meteor:** +15% damage.
- **Rime:** damage from Glacial Skim gives **30% less ultimate charge**, because Rime fills it twice as fast as the others.

### A unique primary fire per wizard
Ty: "Each hero should have a unique primary fire that feels unique. Rime is taken care of. Each is still a rhythmic 1, 2, 3."
The magazine rule stays: 3 shots, then a 1.5 s reload, and only the 3rd shot stuns or interrupts. Spark leaves every kit.

**Cinder: Fireball.** "Cinder's fireball should do much more damage."
- A bigger, hotter projectile, slightly slower than Spark (about 24 m/s). Ty's fireball sound stays.
- About **18 damage**; the 3rd shot about **26** plus the stun or interrupt. Tune it in the balance match so Cinder stops being the weakest wizard without becoming the strongest.

**Gale: Gale Shear.** "Gale's should be limited to close range only."
- A short wind-blade burst: a fan or arc of wind out to about **8 m**, gone after that. Not a long-range bolt.
- About 14 damage, with a little knockback. The 3rd shot is a wider crescent that interrupts.
- It suits her Veil-then-dive play.

**Vesper: Hex Shards.** "Vesper throws unique shapes that arc through the air at offset angles towards the enemy."
- Each shot is a crimson glyph shape (a triangle, then a diamond, then a crescent) that flies a **curved path**.
  - Shot 1 curves in from the left, shot 2 from the right, shot 3 lobs high and drops.
  - Each path bends toward the aim point (the target at release), so all three converge.
- Simulate the curve server-side (for example a quadratic Bézier from the hand to the aim point with a sideways or upward
  control point) and mirror it exactly on clients.
- About 11 damage.
- Curves can go around thin cover but are blocked by what they actually hit.

### A unique shield (Space) per wizard
Ty: "Each wizard needs a unique shield ability." Rime has Glacial Bulwark and Gale has Tempest Veil.

**Rime: Glacial Bulwark changes.** "Make Rime's wall longer and taller. Touching it freezes enemies."
- About **6 m wide and 4 m tall** (was 2.7 × 2.7). Keep it as a collider chain and scale the HP sensibly.
- Any **enemy** that touches it is **frozen for 1.5 s** (Frostfall's freeze, the same visual), at most once per wall per enemy
  every 3 s. Rime and teammates are unaffected.

**Vesper: Black Death.** "A wall of black that completely covers the player and shields as usual. Damage absorbed charges
her whip."
- **Hold Space:** a churning black shroud fully encloses her, so it blocks from **every** direction, unlike the front-cone Ward.
  It drains stamina like the Ward, and breaks like the Ward when stamina runs out.
- **Damage absorbed charges the whip (Sanguine Lash):**
  - absorbed damage cuts Lash's remaining cooldown, by about 0.1 s per point
  - absorbed damage also stores bonus damage for the next Lash, about +1 per 2 absorbed, up to +14
  - Show it as a crimson charge ring on the RMB button, and the coiled whip glowing.

**Cinder: Flame Ward** (the coordinator's proposal; Ty left Cinder's shield open).
- **Hold Space:** a front-cone ward, with the same stamina rules as the Ward, drawn as a curtain of fire.
- Every hit it blocks lashes back: anyone within 6 m in front of her takes about 8 burn damage. That makes it risky to
  pressure Cinder up close.

### Vesper's ultimate changes
"Vesper's ultimate places a black ring on the ground that traps enemies inside and outside the zone temporarily."
- This **replaces Crimson Eclipse**. Call it **Night Cage** unless Ty names it.
- **Aim it** like Frostfall (hold Q to aim, release), placing a black ring of about **7 m** radius on the ground.
- **For 4 s the ring is a barrier to enemies only:** enemies inside can't get out, and enemies outside can't get in. Vesper and
  teammates cross freely, and spells pass through.
- **Enforce it in movement:**
  - server-side for bots
  - for humans, on the client with a server check
  - a Blink, Mirror Step or Smoke Screen dash can't cross it
  - Skyward Flash passes over it if the wizard is above about 3 m
- **Visuals:** a black ring of jagged obsidian spikes rising from the ground, with a dark wall shimmering upward.

### The rest
- Bots understand all of the above.
- Re-run the per-wizard balance match, with 4 Hard bots, one per wizard, 3 × 120 s FFA, and report K/D. Cinder should no
  longer trail.
- Verify everything in Playwright, commit, and update the hand-off.

## Characters agent
Ty: "I have downloaded two new whip models to be used on her character."
- `~/Desktop/Meshy_AI_hemomancer_whip_coile_1028175842_texture.glb`: a coiled whip, a flat coil about 0.96 wide.
  **Hang it on Vesper's hip** (a hips or upper-leg bone) at all times.
- `~/Desktop/Meshy_AI_hemomancer_whip_rigre_1028175836_texture.glb`: a straight whip, a thin 0.96-long rod.
  **During Sanguine Lash it appears in her right hand** (hide the hip coil and the wand during the wind-up and the slash),
  scaled to about 1.6–2 m.
- Expose `body.setWhip('coiled' | 'out')` so the spells agent can switch it at the Lash wind-up and back after.
- The coil should glow crimson as Black Death charges the whip: expose `body.setWhipGlow(0..1)`.
- Shrink both models, screenshot Vesper idle (coil at hip), mid-Lash (whip in hand) and mid-run. Commit, and file a
  requests.md entry with the API.

## Environment agent
Ty: "Let's arrange the environment in a way that makes sense, almost like a magical explosion took place (obelisk and
stone objects) around an altar of stone. Otherwise the farmhouse and meadow is organized on its own. Avoid just having
objects strewn around on the ground in a disorganized fashion."
- **A blast site with an altar at its centre:** build a **stone altar** (procedural or from existing stone models) as the
  epicentre. Pick its location so the farm stays coherent; the open meadow or the courtyard centre are candidates.
- **Arrange the mystical pieces as debris from one magical explosion, radiating out from the altar:**
  - the obelisk
  - the floating rune pillars
  - the archway
  - the jagged and table rocks
  - toppled pillars, cracked and scorched ground (a decal ring), and stones tilted away from the centre at falloff distances

  It should read as one event, not scattered rocks.
- **Keep the farm organised on its own:**
  - the farmhouse, barn, pen, field, tractor, cart and silo, with tidy rows and fences
  - props grouped where they make sense: barrels by the barn, crates on the cart, hay by the pen, potion barrels by the house
  - no random loose objects on open ground
- **Keep it playable:**
  - duel sight lines
  - team spawn sides (Ember north, Frost south, as requested by the modes agent in requests.md); implement those
    spawns now if not done
  - the relic's eligible props spread across both halves so neither team is favoured
  - goat routes
  - bots not getting stuck (botmatch on 4102)
- **Screenshots:** aerial, the altar and blast site, the farm, and each team's spawn view.
