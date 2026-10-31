# Round 16 brief: Lash rework, no warm-up, menu respawn, Meteor Rain aim sway

## Context
Ty played the live castle build (fea2ad3) and asked for four more changes. The spells agent is still finishing the
previous request (Ram Ride faster, Black Death more healing, bot accuracy down about 20%, a balance review). These four
queue right after it, on the same agent.

1. **Sanguine Lash rework.** "The whip aspect doesn't really work anymore," and a miss shouldn't leave you stuck. It
   becomes a **Blood Siphon bolt**: a fast crimson bolt with a short cast and no root, which hits hard and heals the
   caster for **half the damage dealt**. A miss has no penalty. It pairs with Black Death's healing for a sustain-duelist
   Hemomancer kit.
2. **No warm-up before a match.** Just a short countdown, then go.
3. **A Respawn button in the Esc menu**, so players can change their spells and play immediately. It's free and
   instant if you haven't taken damage in the last 5 s. Otherwise it **counts as a death**, and the last attacker gets
   the kill, so it can't be used to escape a fight.
4. **Meteor Rain is still too strong.** While airborne and aiming, the target circle should **sway naturally**, so a
   perfect hit takes some skill.

## 1. Sanguine Lash becomes Blood Siphon (spells agent; characters agent for the animation)
**The spell** (`SPELLBOOK.sanguine_lash`, constants.js; keep the id so saved loadouts and presets keep working):
- Rename it to **"Blood Siphon"**.
- Remove the 1.5 s rooted wind-up, the bind (`lash` state, `rootUntil` on the target), the whip visuals and the miss
  root (`missRoot`, a 1.0 s hard root). Delete the `lash` code paths in server.js, main.js, effects.js and bots.js, and
  keep nothing that only the whip used.
- **The new bolt:**
  - a 0.35 s cast (cast slow, no root)
  - fast (about 34 m/s), 26 m range
  - **about 30 damage** after DAMAGE_SCALE
  - heals the caster for **50% of damage dealt**, capped at max HP, with a crimson heal number and a pulse
  - cooldown **about 7 s**
- It's a normal projectile, so it can be blocked and dodged. Reuse the existing projectile pipeline (`SPELLS`
  projectile kinds) with a new kind, `siphon`.
- **Combo:** keep the Hemomancer synergy. If Black Death is equipped, a Siphon hit also adds a short heal-over-time
  (e.g. 10 HP over 2 s), or Black Death's absorbed damage charges the next Siphon. Pick whichever is simpler, and update
  `COMBOS` and the card's Combo tag.
- **Cards and blurb:** "A fast blood bolt that heals you for half the damage it deals." Update the stats, the tags
  (Projectile, Heal) and the icon if needed (the existing lash icon is fine).
- **Bots:** use it as a poke and heal, especially when hurt.
- **Effects:** a crimson bolt with a dark trail; on a hit, a red ribbon of light flows back from the victim to the
  caster (a short tracer).
- **Characters agent:** a quick one-hand cast for Siphon (Ranged_Magic_Shoot) replaces the slowed backhand, and the
  release lines up with 0.35 s. The `lash` and `sanguine_lash` keys in spellanim.js are updated.

## 1b. Black Death becomes Sanguine Aegis (spells agent; Ty: rename it to fit its healing)
- Black Death (guard, R) becomes **"Sanguine Aegis"**: a crimson blood shroud that absorbs hits and heals you. Keep the
  id `black_death` so saved loadouts keep working.
- Update the name, short name, blurb ("Hold to raise a blood shroud that turns absorbed damage into healing"), card
  tags (Shield, Heal), the kill-feed and death-screen names (`KIND_NAME`), the README, and the Combo text with Blood
  Siphon.
- Re-tint the shroud's visuals from black to deep crimson with a lighter rim, so it reads as healing rather than
  darkness.

## 2. No warm-up (spells agent: server/match.js, main.js HUD)
- Remove the warm-up phase (`MATCH_DEBUG`-aware match.js states).
- A match starts with a **3 s countdown** (3, 2, 1, Fight!) once at least one human plus bots fill the lobby. Nothing
  counts during it.
- Rematches also use the 3 s countdown.
- Update the HUD text ("Warm-up: nothing counts yet" goes), the unit tests that assume a warm-up, and the README.

## 3. A Respawn button in the Esc menu (spells agent: main.js menu and server.js; characters agent for any builder layout)
- **The Esc menu:** the spell builder is already there. Add a prominent **"Respawn with these spells"** button next to
  "Leave match".
- **Server message** `{t: 'respawnNow', loadout}`:
  - validate the loadout (`sanitizeLoadout`) and apply it immediately
  - if `now - lastDamageTakenAt >= 5 s`, respawn instantly at a spawn chosen by the normal rule, with no death counted
  - otherwise it **counts as a death**: the last attacker within 5 s gets the kill (feed: "X finished Y"), then respawn
    after the normal 2 s timer with the new loadout
  - while dead, the button just sets the loadout for the coming respawn (as today)
  - cooldown about 3 s, to stop spam
- The button shows the current state: "Respawn now" when safe, or "Respawn (counts as a death)" in red when hurt
  recently.
- **Bots:** not affected.
- **Tests:**
  - a safe respawn: no death counted, and the new loadout is applied
  - a hurt respawn: a death is counted and the attacker credited
  - spam is blocked

## 4. Meteor Rain aim sway (spells agent: main.js aiming, constants; server validation)
- While Meteor Rain is being aimed in the air (the hover phase), the target circle **drifts** on a smooth
  pseudo-random path (two summed sines or simplex noise):
  - amplitude **about 1.5–2 m** at the default aim distance, scaling with range
  - period about 1.2–2 s
  - the player counters it by steering the aim
- The circle shown is where it will land: the client sends the swayed point, and the server keeps its current
  validation (range and LOS). Use a deterministic seed per cast so the server could check it if needed; the sway itself
  is client-side aim.
- **Optional steadying:** holding crouch (C) during the hover halves the sway but costs time. Only if it's cheap.
- **Bots:** their Meteor Rain aim gets the same sway, which adds misses.
- Keep the 2.4 m kill ring and the splash from the last change.
- **Re-measure:** Meteor Rain's kills per match equipped (target well under 0.88 on normal), and its share of Ultimate
  kills.

## Order and verification
1. The spells agent finishes the current task (Ram Ride, Black Death, bot accuracy, balance review) and reports. I take
   the buff list to Ty.
2. The spells agent does §1–§4 in small commits. The characters agent does Siphon's cast animation in parallel (API in
   requests.md).
3. **Verify:**
   - `MATCH_DEBUG=1 node tools/test/modematch-unit.mjs` prints ALL PASS, with the new tests: Siphon heals 50% and a
     miss has no penalty, the respawn cases, and the countdown start.
   - Playwright on a private port (GPU flags): the 3 s countdown, then fight; the Esc menu's Respawn button in both
     states; Blood Siphon's bolt and heal number; Meteor Rain's swaying circle in mid-air.
   - `loadoutbalance` normal and hard (12 runs of 75 s each), reporting Meteor Rain and Blood Siphon.
   - The smoke test and the CrazyGames build (subpath test) still pass.
4. **Ship:** port 3000 already serves the working tree. Push to Render only on Ty's go-ahead, rebuild
   `dist/crazygames.zip` from the pushed commit, and run the live smoke test.
