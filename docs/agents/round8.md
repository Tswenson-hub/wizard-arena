# Round 8: Jeb ride, sprint, Embibe (Ty approved)

## Context
Ty's list after playtesting:
1. **Jeb's Ram Ride** works now. Make it **twice as long, but cancellable**.
2. **Sprint for every hero** on Shift. It uses the **running animation** and drains the **same stamina as shields**.
3. **New hero, Embibe**, a dark potion thrower and alchemist ("she"). Ty's spec, plus his pick of **Smoke Flask** for her shield.
4. **Animations:** use the new ones on her model, and existing ones elsewhere. Her export also includes a **triple-strike
   combo** that other heroes can use, and a **new death animation**.

Assets, already inspected:
- **Body:** `~/Desktop/Meshy_AI_embibe_alchemist_3d_All_Animations.glb`, 11.1 MB, **70 joints**, a new rig size. Gale, Rime,
  Cinder and Jeb have 66 and Vesper 50, so the retarget map needs checking. Clips:
  - Running 0.63 s, Walking 1.03 s
  - Crouch_Charge_and_Throw 7.67 s, Crouch_Pull_and_Throw 5.8 s, Female_Crouch_Pick_Throw_Forward 4.87 s
  - Stand_and_Drink 8.87 s
  - Thrust_Slash 3.0 s
  - **Triple_Combo_Attack 4.33 s** (the shared combo)
  - **dying_backwards 2.2 s** (the new death)
- **Potion props:** `Meshy_AI_potion_green_crystal__…glb` (6.5 MB) and `Meshy_AI_potion_purple_swirl_3_…glb` (8.0 MB), both static.

## 1. Jeb's Ram Ride (spells)
- Ride distance 10 → **about 20 m**, same speed (7 m/s), so about 2.9 s.
- **Cancellable:** pressing E again, or Space or a primary click, dismounts early with the normal 0.4 s dismount.
  Being stunned, bound or frozen also throws him off.
- The cooldown starts at dismount. Bots cancel early when they reach their target spot.

## 2. Sprint for everyone (spells)
- **Hold Shift** while moving forward or diagonally forward to sprint at about **5.5 m/s**. Gale is about **6.2 m/s**,
  keeping her the fastest.
- It plays the **Running** clip, time-scaled to speed; 'run' comes back for sprint only.
- **Stamina:** it drains the shield stamina bar at about **25 per second**, using the same stamina, regeneration delay and
  HUD bar as the ward.
  - It stops automatically at 0 and can restart above about 15, which stops stutter at the bottom.
- **Can't sprint while:** casting a wind-up, warding or shielding, carrying something with telekinesis, rooted or frozen,
  or walking backward.
- **Server:** its speed check allows the sprint speed while the player is sprinting and has stamina.
- **Bots:** they sprint to reach the zone or their target and to escape at low HP, keeping stamina for shields when threatened.

## 3. Embibe the Alchemist (spells, characters)
Starting numbers; the balance match tunes them. Theme colour: a toxic green-purple palette.

| Slot | Spell (id) | Behaviour |
|---|---|---|
| LMB | **Potion Toss** (`potion_toss`) | A **2-throw magazine** (shot 1, shot 2, then the 1.5 s reload). Each throw arcs a purple swirl potion (the purple prop). Shot 1 deals about **16**; shot 2 about 14 and **stuns** (the usual last-shot interrupt). Each shatters with a small **splash, radius about 1.2 m**, at reduced damage. |
| RMB | **Toxic Flask** (`toxic_flask`) | A short throw animation; a green crystal potion (the green prop) lobs to the aim point, about 18 m max. It shatters into a **pool of green liquid, radius about 3.5 m, lasting 5 s**. A direct hit does about 12. Anyone standing in the pool takes about **12 per second** while inside, and it hurts enemies only. Cooldown about 8 s. |
| E | **Flask Step** (`flask_step`) | A **medium wind-up (about 0.6 s)**, interruptible, then she lobs a potion along her aim, about 16 m max. **Wherever it lands, she teleports there** with a purple smoke burst at both ends, and a short arrival animation. A wall in the way ends it at the wall. Cooldown about 8 s. |
| Space | **Smoke Flask** (`smoke_flask`; Ty's pick) | She smashes a flask at her feet: a **2 s** purple smoke cloud around her **absorbs incoming projectiles from every side**. No stamina; cooldown about 10 s. |
| F | Telekinesis | Unchanged. |
| Q | **Berserker Brew** (`berserker_brew`) | After the usual 1.3 s interruptible ultimate wind-up, she **plays the drinking animation** and is **enraged for 7 s**: Potion Toss and Toxic Flask deal **about +50% damage**, and **all her cooldowns are halved** (primary reload included). Visuals: a green-purple aura and glowing eyes. |

## 4. Animations (characters, a fresh agent)
- **Embibe:** her body (70 joints) gets its own mapping, checked for skin tearing.

  | Key | Clip |
  |---|---|
  | run / walk | Running / Walking |
  | primary (two swipes) | the first two strikes of Triple_Combo_Attack, or Thrust_Slash, timed to the throw |
  | cast_heavy (Toxic Flask) | a short throw from Crouch_Pull_and_Throw |
  | flask_step (wind-up) | Crouch_Charge_and_Throw, trimmed to about 0.6 s |
  | arrival (new key) | a short recovery, or Female_Crouch_Pick_Throw_Forward's end |
  | ult | Stand_and_Drink, trimmed so the drink lands inside about 1.3 s plus a short hold |
  | death | dying_backwards |

  Shared walk-fight, back, telekinesis lift and throw, hit_waist and sprint use the existing shared and retargeted clips.
- **Shared from her export:**
  - **dying_backwards → Gale's death**, the one hero who still sinks.
  - **Triple_Combo_Attack** offered as optional per-shot primary clips (`combo1`, `combo2`, `combo3` keys) for heroes
    whose 3-shot primary would read better as a melee-style flourish. Proposed for **Gale's Gale Shear**, close range.
- **Potion props:** shrink both. The purple swirl is Potion Toss and the green crystal is Toxic Flask (held in the hand
  during the wind-up, then flying as the projectile). Hang one at her belt as decoration.
- The picker gets a **sixth card**.

## Who does what
- **Spells agent:** sections 1–3 (rules, effects, sounds, bots), plus playing the new clip keys. Then the balance match with
  6 Hard bots, one per hero.
- **Characters agent:** the characters agent was retired for the deploy agent. **Start a fresh one** in the modes pane;
  the modes agent's work is done and committed. It does section 4.
- **Embibe's roster entry:** the coordinator adds `WIZARDS.embibe` first, with a placeholder kit and stand-in look, as for Jeb.
- **Deploy agent:** pushes after verification.

## Verification (private port)
- **Jeb:** the ride goes about 20 m, and pressing E mid-ride dismounts early.
- **Sprint:** about 5.5 m/s with the Running clip; stamina drains and it stops at 0; it's refused while carrying
  something or winding up; Gale sprints at about 6.2.
- **Embibe:**
  - two potion throws, the second stuns, and the splash hits a dummy beside the target
  - Toxic Flask pool ticks damage for 5 s on an enemy inside, never on a teammate
  - Flask Step teleports to the landing point
  - Smoke Flask absorbs from behind
  - the ult halves cooldowns and adds damage for 7 s
  - screenshots of each
- **Gale:** the death animation plays. **Embibe:** the skin holds in every pose.
- **Balance:** 6 Hard bots, one per hero; nobody dominates.
- Then update port 3000, and push via the deploy agent.
