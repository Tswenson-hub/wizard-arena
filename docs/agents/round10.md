# Round 10: denser map, more verticality, shorter sight lines, harder hits (Ty approved)

## Context
After round 9, Ty finds the game too comfortable and the map too sparse and open. His requests and answers:
- **Map:**
  - shorten the sight lines
  - add more verticality: a treetop area around the middle, and a connection between several broken silos and the barn
  - **replace the low-poly crop field** with something that connects to the farmhouse in multiple pieces, so players can
    take the high ground
  - "we have the pieces"
- **Jeb's Battering Ram** needs a wind-up before the ram launches; it's too strong.
- **Damage:** +30% for every spell, ultimate and thrown object. Healing and shields are unchanged.
- **Extras:** health potions on the map, health regeneration after 5 s out of combat, and ledge grab.

## 1. Map pass: dense, connected, vertical (environment agent)
- **The sight-line goal:** today's long open lanes let ranged heroes sit back. After this pass, **no unbroken ground-level
  sight line longer than about 25 m through the play space**, except the deliberate one down the meadow archway path.
  - Measure it: cast rays on a grid at standing chest height and report the longest lines before and after.
  - High ground can see further, but every perch must have cover on its own deck.
- **Treetops in the middle,** next to the altar blast site:
  - two or three of the big oaks become a **canopy fort**: plank platforms around the trunks at about 3.5–5 m
  - linked by **plank bridges**, with **wooden stairs or a ladder** up
  - the canopy itself blocks sight from above, as an LOS-only collider
  - a central perch with plenty of cover, contested from below
- **Silo and barn complex:**
  - two or three **fallen and broken silos** (reusing silo.glb at different angles and scales; one leaning up against the
    barn as a climbable ramp)
  - linked by **plank bridges** to the **hay loft** and a **barn-roof walkway** (a walkable strip along the ridge, or the
    loft extended)
  - an elevated route from the pen side to the courtyard
- **The farmhouse annex replaces the crop field:**
  - remove the crop rows
  - build a connected cluster on that side, reaching the farmhouse: a **raised wooden deck or porch** around the house, a
    **covered walkway or balcony** to a **storage shed or second building** on posts, the **watchtower** joined to it
    by a bridge, plus fences and haystacks below as ground cover
  - several routes up (stairs, ramps, the embankment), so it's a multi-level fight space, not a single perch
  - keep the scarecrow and pumpkins as decoration at the edge
- **Breaking up open ground:**
  - hedge rows, broken stone walls, stacked hay, crates, carts and tall rocks in the meadow and courtyard, as clusters
    that make lanes and corners, not scattered loose
  - grass density can go up a little now that there's more to frame it
- **Existing pieces to reuse:** plank_bridge, wooden_stairs, stone_ruin_platform and steps, rock_plateau,
  earth_embankment, hay_loft, watchtower, silo, barn, oak, haystack, well, cart and fences.
- **Pieces that would help, if Ty wants to make them:**
  - wooden porch or deck section
  - wooden shed on stilts
  - covered walkway or balcony section
  - hedge segment
  - broken stone wall segment
  - a rope ladder
  - a standing (upright) broken silo

  Stand-ins (simple shapes) until they arrive.
- **Keep it playable:**
  - spawns stay safe (no perch overlooks a spawn)
  - every high spot has two or more ways up and a counter
  - goats still route home
  - bots use the new ramps; ramp waypoints are added to the bot graph
  - Siege zones get new locations if a better contested spot appears (e.g. one zone on the canopy, with its height band)
  - the fairness check and the per-zone hold split are re-run

## 2. Combat (spells agent)
- **+30% damage, globally:** one multiplier `C.DAMAGE_SCALE = 1.3` applied to every damage source (primaries, power
  spells, ultimates, DoTs, thrown props and goats, ram hits, relic blasts, the Firewall burn and so on), so it can be tuned
  in one place. Healing, shields and stamina costs are unchanged. Keep goat and ram one-shots one-shots.
- **Jeb's Battering Ram gets a wind-up:**
  - about **0.8 s**, interruptible like other wind-ups and cast-rooted
  - a clear tell: Jeb stomps, and a ghostly ram paws the ground in front of him, kicking up dust, with a snort sound
  - the ram then launches. Cooldown unchanged unless the balance match says otherwise.
- **Health potions:**
  - 5 or 6 pickup spots placed by the environment agent (`HEAL_SPOTS` in map.js) on contested and high-ground positions,
    none near spawns
  - each heals **35 HP** on touch and respawns after **20 s**, as a glowing red flask on a small stand
  - shown on the HUD when nearby, plus a pickup sound and burst
  - bots grab them when hurt
- **Out-of-combat regeneration:**
  - after **5 s** without taking damage, regenerate about **8 HP per second** up to full
  - any damage resets the timer
  - shown as a soft green pulse on the HP bar
- **Ledge grab:**
  - jumping toward a surface edge that is above your jump apex but within about **1.2 m** pulls you up onto it
  - about 0.45 s, cast-rooted, with a climb pose; no stand-in clip exists, so use tk_lift or a crouch-to-stand
  - it uses the SURFACES helpers (the top and edge under the reach point), and the server validates it
  - bots use it as part of ramp and waypoint navigation
- **Balance:** re-run the 6-hero match. The target is fights about **30–40% shorter** than round 9, about 20+ kills per
  150 s for 6 Hard bots, with no hero dominating.

## 3. Assets and animation (characters agent, optional)
If Ty exports a **climb / ledge pull-up** clip (Meshy has one) and **jump and crouch** clips from one hero, retarget them
to all six and replace the stand-ins.

## Order
1. **Environment:** the map pass, plus `HEAL_SPOTS` in map.js (commit `HEAL_SPOTS` early so spells can wire pickups).
2. **Spells:** damage, Jeb's wind-up and regen (independent, start now), then potions and ledge grab once the map work lands.
3. **Coordinator:** a private-port check, then port 3000 and the push.

## Verification
- **Sight lines:** the ray-grid report shows the longest ground lines before and after, at about 25 m or less except the
  archway lane.
- **Screenshots** of the treetops, the silo and barn complex, the farmhouse annex, and an aerial view.
- **Movement:**
  - climb every new structure by its routes
  - ledge grab works from below each deck edge
  - bots reach the treetops and the annex
- **Combat:**
  - Fireball damage is 1.3× in the logs
  - Jeb's ram has a 0.8 s interruptible wind-up
  - a potion heals 35 and respawns at 20 s
  - regen starts after 5 s
- **Regressions:** the Siege bot match (fair hold split, 0 friendly fire), the unit tests, and a 6-hero balance match with
  K/D and kills per 150 s.
- Then update port 3000 and push.
