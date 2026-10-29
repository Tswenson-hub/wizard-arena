# Round 7: Jeb the Shepherd (Ty approved)

A fifth wizard whose kit is all about the rams (the map's goats). Ty's choices:
- **Ultimate:** Stampede.
- **Ward rule:** his rams follow the **goat rule**. A ward, shield or wall facing a ram stops it, leaving it dizzy; otherwise the hit kills.
- **Model:** his rigged model and crook staff are on the Desktop.

The roster entry `WIZARDS.jeb` already exists in `public/shared/wizards.js` with a **placeholder kit** (existing spells) and
a stand-in body. The spells agent replaces the `kit` fields, and the characters agent replaces the look fields.

## Kit (starting numbers; tune in the balance match)
| Slot | Spell (id) | Behaviour |
|---|---|---|
| LMB | **Shepherd's Sling** (`sling`) | About 7 damage, **2-shot magazine** (1, 2, then the 1.5 s reload); only shot 2 interrupts. **A hit on an enemy calls a ram:** the nearest map goat within about 22 m that is calm (not rearing, charging, held or flying) rears up and charges that enemy, credited to Jeb. A 3 s per-target lockout stops one target emptying the pen. |
| RMB | **Battering Ram** (`battering_ram`) | A ram appears just in front of Jeb (dust puff) and charges **dead straight** along his aim, with no homing, at goat charge speed for up to about 3 s. **One-shots** an enemy it hits (goat rule: a facing ward, Veil, Black Death or any wall stops it, leaving it dizzy). It passes Jeb's teammates. It **despawns once recovered** (after its dizzy or recover). Cooldown about 9 s. |
| Space | **Ram Guard** (`ram_guard`) | **3 rams spawn and circle Jeb** (radius about 2.2 m, a full lap about every 1.5 s) as body blockers that **absorb projectiles**. An enemy whose shot hits one becomes its target: that ram breaks orbit and charges the shooter as a normal ram (one-shot, goat rule), credited to Jeb. Rams despawn after their charge, or at **3 s** if not hit. Cooldown about 10 s. |
| E | **Ram Ride** (`ram_ride`) | **0.4 s mount** (a ram appears under him; he can't act), then he **rides at about 11 m/s**, steerable, no casting, for about **14 m**. Then a **0.4 s dismount**, and the ram despawns. Riding into an enemy shoves them for about 15 damage, with no one-shot. Cooldown about 8 s. |
| F | Telekinesis (`telekinesis`) | Unchanged. |
| Q | **Stampede** (`stampede`) | Aim a lane: hold Q, release. A **1 s telegraph** of rumble, dust and a lane marker on the ground, then **about 8 rams** thunder down the lane (about 6 m wide, 28 m long) over about 2 s. Each one-shots an enemy it hits (goat rule). Charge it like other ultimates. |

Jeb's run speed is 5.3. His rams are the goat model about 1.15× larger with a faint golden tint, so they read as summoned.

## Contract: `server/goats.js` (environment) ↔ `server.js` (spells)
**Environment implements:**
- `summonRam(opts, ctx) → ram`. A temporary goat-like entity in the same `goats` array, rendered by `goats.js` with
  `summoned: true, owner, team` in `goatPublic`. opts: `{ x, z, yaw, ownerId, mode, targetId?, speed?, maxTime? }`.
  - `mode: 'charge'`: a **straight** charge along `yaw` with no homing, stopping on a collider (then dizzy), a wizard (ram), or `maxTime` (then recover).
  - `mode: 'orbit'`: circles the owner (radius and angular speed in `GOAT`), and blocks movement like a goat. `ctx.ramHitByProjectile(ram, shooterId)`
    (or `angerGoat` with the owner as credit) switches it to a homing charge at that shooter.
  - `mode: 'mount'`: placed under the rider every tick by the spells side (`ram.x/z/yaw` set by server.js), with no AI and no ramming.
  - Stampede rams are a batch of `'charge'` rams, spawned by the spells side with small offsets and delays.
  - **Summoned rams never pen, never `return`, never wander. They despawn** (removed from the array, with a `goatGone {id}`
    broadcast) once they leave `dizzy` or `recover`, or at a hard timeout. They **never ram their owner or the owner's team**
    (use `ctx.isEnemy(owner, victim)` when the owner exists), and a ram kill is credited to the owner.
- `callRam(targetId, creditId, from, range, ctx) → goat | null`: picks the nearest calm **map** goat within `range` of
  `from` and makes it charge `targetId` (rear-up windup as usual), with any kill credited to `creditId`. Returns null if none.
- **Projectiles hitting an orbiting ram:** server.js already tests projectiles against goats. For `orbit` rams, the
  projectile ends there (absorbed) and the ram charges the shooter.
- **Client:** summoned rams look like goats with the size and tint above. There's a spawn poof, a despawn poof, a
  `mount` pose (it moves with the rider, legs galloping), and orbit motion.

**Spells implements:** Jeb's SPELLBOOK entries and kit, every handler, the mount and ride movement (server-authoritative
for bots, client-predicted for humans, with Jeb's body following the mount's height), and bots playing Jeb.
- **Every bot** treats a Battering Ram heading at it and a Stampede lane as threats: sidestep out of the line, or ward,
  Veil or wall facing it.
- **Balance match:** 5 Hard bots, one per wizard, 3 × 120 s FFA. Report K/D and ram one-shots.

## Characters agent
- Body: `~/Desktop/Meshy_AI_shepherd_wizard_3d_All_Animations.glb` (66 joints).
- Crook: `~/Desktop/Meshy_AI_shepherd_crook_staff__1028230655_texture.glb` (static), in his right hand.
- Jeb's look fields in `WIZARDS.jeb`: model path, colour and tint as needed, with the role line kept or tuned.
- Clips:

  | Key | Clip |
  |---|---|
  | run / walk | Running / Walking |
  | cast_fast | a trimmed mage_soell_cast_1 (the sling) |
  | cast_heavy | Angry_Ground_Stomp_2 (summoning the Battering Ram) |
  | block | Block1 (Ram Guard) |
  | ult | a trimmed Sword_Judgment (the Stampede call) |
  | death | Lie_Back_Leg_Swing, if it reads as a fall |
  | ride (new) | a held crouch from Cautious_Crouch_Walk_Left_inplace (Ram Ride) |

  The shared clips (tk_lift, tk_throw, hit_waist, walk_fight, back) are retargeted as for the others.
- Picker card and stand-in look until the model loads. Post new clip keys in `requests.md`.

## Verify
Each agent verifies its own part (ports 4101/4102/4103). The coordinator runs the end-to-end checks.
