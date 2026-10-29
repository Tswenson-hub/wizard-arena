# Round 9: jump and crouch, platforms and ramps, combat feedback (Ty approved)

## Context
Ty wants the game to feel more modern and playable. His decisions:
- **Controls:** **Space jumps, R is the shield** (it moves off Space), and **C crouches** (Ctrl as an alternative hold).
- **Verticality:** **raised platforms and ramps**, not sculpted terrain. Players fight from different heights and angles.
- **Modern feature this round:** **combat feedback**.

Today the arena floor is flat: `groundHeight()` in `world.js` returns 0 inside the rim. Height only exists for Skyward
Flash, Meteor Rain and thrown or flying objects (`p[1]`), and every collider is a 2D circle with a height `h`.

## 1. Jump and crouch (spells agent)
- **Jump (Space):**
  - About a 1.1 m hop, with a short air time (about 0.55 s) and air control at about 60%.
  - Costs about 10 stamina, so it can't be spammed and it competes with shields and sprint.
  - No casting during the first 0.15 s; after that, primary fire is allowed in the air, other casts aren't. That keeps the
    cast-root rule readable.
  - Landing makes a small dust puff and sound.
  - Movement abilities keep their own rules.
- **Crouch (C toggle, or Ctrl hold):**
  - Walk at about 1.6 m/s, with the hitbox height and centre lowered (HIT_CENTER_Y and the radius scaled for the crouched pose).
  - It finally makes **low cover matter**: fences (h 0.7), crops (h 0.9), hay and table rocks hide a crouched wizard from
    spells flying over.
  - Can't sprint while crouched; crouching cancels sprint.
- **Shield moves to R** for every hero: hold R to ward or Black Death, tap R for Firewall, Bulwark, Veil, Smoke Flask and
  Ram Guard. Update the ability bar, tooltips, picker blurbs, the README controls table and the goat warning text.
  Airborne rules: Skyward's drop moves from Space to crouch (C).
- **Server:** it validates vertical position as a jump arc or a standing surface, together with the platforms below.
  Bots jump onto platforms, over low obstacles and to dodge ground-level shots like Glacial Skim, and crouch behind low
  cover when hurt.
- **Animations:** the existing models have no jump or crouch clips. Ty should export **Jump** (takeoff, airborne loop,
  landing) and **Crouch idle and crouch walk** from one hero, the way Cinder's re-export became the shared set. Until then:
  - jump uses `dash` or the float pose
  - crouch uses Jeb's crouch-walk clip, retargeted

## 2. Platforms and ramps (environment agent, plus spells for the movement rules)
- **One shared walkable-surface model** in `map.js`: `SURFACES`, a list of boxes and ramps
  `{ kind: 'box' | 'ramp', x, z, w, d, yaw, top | (y0, y1) }`.
  - `C.surfaceHeight(x, z, footY)` returns the highest walkable top under a point that the wizard can **step onto**
    (a rise of 0.45 m or less) or is already standing on. You step up stairs and ramps and fall off edges.
  - The sides of a box are walls below its top: they become **colliders** for anyone standing lower.
- **Everything learns height:**
  - client movement and gravity
  - the server's speed and height checks
  - projectiles (a box blocks a shot below its top; shots pass over)
  - line of sight
  - goats (they stay on the ground and treat platforms as obstacles)
  - bots: they use ramps when their target is up high; a simple "nearest ramp foot" waypoint is enough, without full pathfinding
  - Siege zones (occupancy by 2D distance plus a height band)
  - telekinesis, which can lift objects resting on platforms
- **Proposed pieces,** each a deliberate high-ground spot with a way up and a counter:
  - **Hay loft inside the barn,** reached by a ladder-ramp: a sniping perch over the barn passage Siege zone.
  - **Ruin ledges** ringing the altar blast site: two or three broken stone platforms of different heights, linked by
    toppled-pillar ramps. Lets players fight over the altar zone from above.
  - **Watchtower:** a wooden lookout by the field, with stairs. Height for long-range heroes, but exposed.
  - **Rock outcrops** in the meadow: two table-rock plateaus, about 1.5 m and 2.5 m high, with natural slopes.
  - **Raised cart road:** a gently sloped earth embankment along one side, giving the courtyard a high and a low route.
- **Balance:** each perch needs a counter, a second route up or cover from it, and must not overlook a spawn. The modes
  check zones and spawn fairness again.
- **Assets Ty can make in Meshy** (until they arrive, the agent builds stand-ins from simple shapes):

  | # | Piece | Notes |
  |---|---|---|
  | 1 | Wooden ramp / stairs | short, about 2–3 m |
  | 2 | Stone stairs, broken ruin steps | |
  | 3 | Wooden watchtower / lookout platform | with stairs |
  | 4 | Broken stone platform, ruin ledge | flat-topped |
  | 5 | Barn hay loft floor plus ladder | or a ladder alone |
  | 6 | Large rock plateau | flat-topped outcrop, about 2 m |
  | 7 | Earth embankment / raised road segment | |
  | 8 | Wooden bridge or plank walkway | between two ledges |

  Exports should have **flat walkable tops** and simple shapes, so the colliders match what players see.

## 3. Combat feedback (spells agent)
- **Floating damage numbers** at the hit point. Small for primaries, larger and coloured for heavy hits, crits and ultimates.
  Heals show in green (Vesper), and blocked hits show "BLOCKED" in grey. Numbers stack and drift; your own damage taken
  shows red near the HP bar.
- **Hit marker:** the crosshair tick plus Ty's hit-marker sound. A bigger "kill" marker on a kill.
- **Kill feed with icons:** the killer's hero colour and name, the spell icon (Raven Fantasy Icons from Ty's Downloads, or
  simple glyphs), then the victim. Highlighted when it involves you.
- **"Killed by" card** for the 3 s respawn: the attacker's hero, the spell that killed you, their HP remaining, and the
  damage they dealt you. No killcam replay this round.
- **Directional damage indicator:** a red arc on screen toward the source of a hit.

## Who does what
| Agent | Work |
|---|---|
| Spells | jump, crouch, rebinding the shield to R; the movement, collision, projectile and LOS height rules for SURFACES; bot jumping, crouching and ramp use; combat feedback |
| Environment | SURFACES data and the platform and ramp pieces (stand-ins, then Ty's models); Siege and spawn fairness checks |
| Characters | jump and crouch clips when Ty exports them; until then the fallbacks above |

**Order:** environment defines `SURFACES` and its helper in `map.js` first, then spells wires the movement rules. Combat
feedback is independent and can go in parallel.

## Verification (private port)
- **Jump and crouch:**
  - jump height and stamina cost
  - crouching behind a fence lets a Spark pass overhead
  - R wards and Space no longer does
  - Skyward drop on C
- **Platforms:**
  - walk up each ramp and stand on each platform; a Spark from the ground hits a box side and a shot from the top passes over
  - falling off an edge lands correctly
  - bots reach a high platform when their target is on it
  - the Siege zone counts a defender on a ledge inside its height band
- **Combat feedback:** damage numbers, heals, "BLOCKED", the hit and kill markers, the kill feed with icons, the killed-by
  card and the damage arc.
- **No regressions:** `modematch` siege, a 6-hero balance match and the unit tests.
- Then update port 3000 and push.
