// The animation table (characters track). Round 15: every body is a KayKit character on the Rig_Medium skeleton, and every clip
// below is cut from KayKit's Character Animations (clips.glb, built by tools/build-characters.mjs): no retargeting.
// Each spell names the clip its cast plays, retimed so its release frame lands where the spell actually fires.
//
// A clip spec ("pick") is one of:
//   'Clip'                               a whole clip
//   ['Clip', from, to, duration?]        the part between two clip times (s), optionally stretched to `duration`
//   { clip, from, to, warp, ... }        that part retimed through warp [[clipTime, newTime], ...] (piecewise linear, in clip
//                                        times); `yaw` turns it (deg); `reverse: true` plays it backwards; `flatY: dy` pins the
//                                        hips dy m above standing height (airborne moves); `pinXZ: true` keeps their rise and fall;
//                                        `bend: { spine, chest, head }` leans those bones forward (deg) all through (a hunch).
//                                        Two warp points with the same clip time hold that pose between their new times.
// Release times were measured on the clips (the staff tip's speed peak and height, /tmp/wa-characters/r15/tr.py) and checked on
// contact sheets.
//
// Each spell entry:
//   keys     clip keys this spell adds to the body: `${id}` (its cast), `${id}1..n` (one per primary shot), and named extras
//   play     when main.js plays what: phase -> [key, duration, timeScale, startAt] (Wizard.oneShot's arguments)
//              shot     a primary shot, as it fires; '#' is the shot number (1..magazine)
//              cast     an instant cast, as the server confirms it
//              windup   the start of a wind-up; the release frame lands on the wind-up's end
//              release  the moment a held or aimed spell fires
//              channel / hold / loop / hover / dive / land    held states and Meteor Rain's flight
//   release  seconds into `play`'s main key where the spell visibly leaves the staff
//   legacy   the older shared key names (wizard.js / main.js) this spell fills on a body that has it equipped:
//            combo1..3, spin, lash, ult, float, ride, flask_step, arrival
//   grade    'good' (a clear, readable tell), 'ok' (works, not ideal); `need`: what would read better

// A strike cut around its peak (clip time `peak`): `lead` s before it squeezed into 0.08 s (the cross-fade in), `follow` s after
// it at about real speed. For primary shots: play at 1x from 0 the moment the shot fires.
const strike = (clip, peak, lead = 0.25, follow = 0.45, extra) =>
  ({ clip, from: Math.max(0, peak - lead), to: peak + follow, warp: [[Math.max(0, peak - lead), 0], [peak, 0.08], [peak + follow, 0.08 + follow * 0.9]], ...extra });
// A wind-up cut: clip time `from` at 0, the release (clip time `peak`) at `windupS` s, then `follow` s after it.
const windup = (clip, from, peak, windupS, follow = 0.5, extra) =>
  ({ clip, from, to: peak + follow, warp: [[from, 0], [peak, windupS], [peak + follow, windupS + follow]], ...extra });
const shot = (n = 0.7) => ['#', n, 1, 0];

// KayKit clip moments (s), measured: the staff thrust of Ranged_Magic_Shoot, the gathered thrust of Spellcasting_Long, the
// overhead raise of Ranged_Magic_Raise, the staff driven into the ground in Ranged_Magic_Summon, Throw's release.
const SHOOT = 0.3, LONG = 1.5, RAISE = 0.38, SLAM = 2.45, THROW = 0.73;
const DODGE = (dir) => ({ clip: `Dodge_${dir}`, from: 0, to: 0.4, warp: [[0, 0], [0.4, 0.45]] });
// The ground roll's tuck under the procedural tumble (FLIPS): Jump_Land's crouch, reached by 0.06 s, held low through the turn,
// up by 0.45 s. Its lean is the dodge's direction.
const TUCK = (lean) => ({ clip: 'Jump_Land', warp: [[0, 0], [0.25, 0.06], [0.3, 0.34], [0.67, 0.45]], pinXZ: true, bend: { spine: 25 * lean, chest: 20 * lean } });
// The blink's arrival: Spawn_Ground from the body bursting up out of the ground, the hop and the landing crouch, squeezed.
const POP = (d) => ({ clip: 'Spawn_Ground', from: 0.3, to: 1.2, warp: [[0.3, 0], [0.8, d * 0.55], [1.2, d]], pinXZ: true });

// Shared by every body (not tied to a spell).
export const COMMON_ANIMS = {
  // locomotion (wizard.js time-scales each to the ground speed by its measured gait speed)
  idle: 'Idle_A',
  run: 'Running_A',
  walk: 'Walking_A',
  walk_fight: 'Walking_A',                  // the normal walk (3 m/s)
  back: 'Walking_Backwards',
  strafe_left: 'Running_Strafe_Left',
  strafe_right: 'Running_Strafe_Right',
  crouch: 'Crouching',                      // the crouched idle (C / Ctrl)
  crouch_walk: 'Sneaking',
  // the base casts (the named phases below play these)
  cast_fast: strike('Ranged_Magic_Shoot', SHOOT, 0.2, 0.45),                     // the quick one-handed thrust, released at 0.08 s
  cast_release: { clip: 'Ranged_Magic_Spellcasting_Long', from: 1.3, to: 2.53, warp: [[1.3, 0], [LONG, 0.1], [2.53, 0.75]] },
  cast_heavy: { clip: 'Ranged_Magic_Spellcasting', loop: true },                // gathering through a wind-up (a held loop)
  windup: { clip: 'Ranged_Magic_Spellcasting_Long', from: 0, to: LONG },          // the gather alone, to stretch over a wind-up
  block: 'Melee_Blocking',                  // held behind a ward
  block_tap: ['Melee_Block', 0, 0.6],
  stun: 'Hit_A',                            // a flinch
  hit_waist: 'Hit_B',                       // hit by a thrown object: the bigger stagger
  dash: DODGE('Forward'),
  throw: strike('Throw', THROW, 0.3, 0.5),
  summon: windup('Ranged_Magic_Summon', 1.6, SLAM, 0.8, 0.6),
  drink: { clip: 'Use_Item', warp: [[0, 0], [0.3, 0.55], [1.2, 1.15], [1.6, 1.6]] },
  ledge_climb: ['Jump_Land', 0.05, 0.6, 0.45],    // the pull-up: crouched over the edge, rising
  tk_lift: { clip: 'Ranged_Magic_Raise', from: 0, to: 1.0, warp: [[0, 0], [RAISE, 0.35], [1.0, 0.9]] },   // the staff raised: the lift
  tk_throw: strike('Throw', THROW, 0.25, 0.6),                                                         // the fling
  death: 'Death_B',                         // falls forward, flat by about 0.9 s (2.6 s)
  // knockdown / getup: Death_A's backward fall cut to the flat moment, then Lie_StandUp (looks.js knockClips)
  // jumps (round 13 hooks): the push-off, the air jump (wizard.js adds the procedural flip, FLIPS below), landings, the air cast
  float: { clip: 'Jump_Idle', loop: true },
  jump: { clip: 'Jump_Start', from: 0.27, to: 0.55, warp: [[0.27, 0], [0.55, 0.25]], pinXZ: true },
  double_jump: { clip: 'Jump_Start', from: 0.2, to: 0.5, warp: [[0.2, 0], [0.3, 0.12], [0.5, 0.45]], flatY: 0.1 },
  double_jump_back: { clip: 'Jump_Start', from: 0.2, to: 0.5, warp: [[0.2, 0], [0.3, 0.12], [0.5, 0.45]], flatY: 0.1 },
  land: { clip: 'Jump_Land', warp: [[0, 0], [0.3, 0.12], [0.67, 0.4]], pinXZ: true },          // crouched by 0.12 s, up by 0.4 s
  land_soft: { clip: 'Jump_Land', from: 0.1, to: 0.67, warp: [[0.1, 0], [0.3, 0.08], [0.67, 0.25]], pinXZ: true },
  air_cast: strike('Ranged_Magic_Shoot', SHOOT, 0.2, 0.4, { flatY: 0 }),
  // a blink's or a respawn's arrival: Spawn_Air's drop and landing crouch, then up
  arrival: ['Spawn_Air', 0.55, 1.3, 0.8],
  hit: 'Hit_A',
};

// Skeleton bots only (merged over COMMON_ANIMS on a skeleton body).
export const SKELETON_ANIMS = {
  taunt: 'Skeletons_Taunt',                 // on a kill
  spawn: 'Skeletons_Awaken_Standing',       // on a respawn: slumped, then up
  death: 'Skeletons_Death',                 // collapses into a pile by 0.3 s (2 s)
  idle: 'Skeletons_Idle',
};

// Procedural flips (wizard.js): a key here also turns the body about its side axis once over the given time (dir 1: forward,
// -1: backward). KayKit has no flip clip; the pose underneath is the tucked jump.
// `axis`: 'x' somersaults (forward/back), 'z' rolls sideways (dir 1: to the body's right). `pivot`: the turn's centre above the
// feet (m, default 0.85). `squash`: the body shrinks by this much mid-turn and back, so a tumble on the ground stays a tight ball.
export const FLIPS = {
  double_jump: { dir: 1, time: 0.45 },
  double_jump_back: { dir: -1, time: 0.45 },
  roll_air: { dir: 1, time: 0.42 },
  roll_air_back: { dir: -1, time: 0.42 },
  roll_air_left: { dir: -1, time: 0.42, axis: 'z' },
  roll_air_right: { dir: 1, time: 0.42, axis: 'z' },
  smoke_screen: { dir: -1, time: 0.42 },
  roll: { dir: 1, time: 0.36, pivot: 1.0, squash: 0.4 },
  roll_back: { dir: -1, time: 0.36, pivot: 1.0, squash: 0.4 },
  roll_left: { dir: -1, time: 0.36, pivot: 1.0, squash: 0.4, axis: 'z' },
  roll_right: { dir: 1, time: 0.36, pivot: 1.0, squash: 0.4, axis: 'z' },
};

// Named phases for main.js (round 15: they replace the old clip-offset calls). Wizard.pose(name, duration?) plays `key`
// for `dur` s (or the duration given); `fit`: stretch the clip to that duration (wind-ups). `release`: seconds in where the cast
// visibly leaves the staff (at the default duration).
export const PHASES = {
  cast: { key: 'cast_fast', dur: 0.45, release: 0.08 },
  cast_release: { key: 'cast_release', dur: 0.55, release: 0.1 },
  windup: { key: 'windup', dur: 1.25, fit: true, release: 1.25 },
  flinch: { key: 'stun', dur: 0.45, release: 0 },
  stagger: { key: 'hit_waist', dur: 0.75, fit: true, release: 0 },
  bound: { key: 'stun', dur: 0.6, fit: true, release: 0 },
  dash: { key: 'dash', dur: 0.45, release: 0 },
  block_tap: { key: 'block_tap', dur: 0.5, release: 0 },
  summon: { key: 'summon', dur: 1.4, release: 0.8 },
  throw: { key: 'throw', dur: 0.6, release: 0.08 },
  drink: { key: 'drink', dur: 1.6, fit: true, release: 0.55 },
  ledge_climb: { key: 'ledge_climb', dur: 0.45, fit: true, release: 0 },
  tk_lift: { key: 'tk_lift', dur: 0.9, release: 0.35 },
  tk_throw: { key: 'tk_throw', dur: 0.9, release: 0.08 },
  arrival: { key: 'arrival', dur: 0.8, release: 0 },
  taunt: { key: 'taunt', dur: 1.03, release: 0 },
  spawn: { key: 'spawn', dur: 1.0, release: 0 },
};

export const SPELL_ANIMS = {
  // ---------------------------------------------------------------- primaries (LMB): one key per shot
  spark: {
    grade: 'good', release: 0.08, legacy: ['combo'],
    // the staff thrust twice, then a wide swing for the finisher
    keys: { spark1: strike('Ranged_Magic_Shoot', SHOOT, 0.2, 0.45), spark2: strike('Ranged_Magic_Shoot', SHOOT, 0.2, 0.45),
      spark3: strike('Melee_1H_Attack_Slice_Horizontal', 0.27, 0.25, 0.5) },
    play: { shot: shot() },
  },
  fireball: {
    grade: 'good', release: 0.08, legacy: ['combo'],
    // a diagonal slash, a backhand sweep, then the overhead chop (the finisher)
    keys: {
      fireball1: strike('Melee_1H_Attack_Slice_Diagonal', 0.42, 0.3, 0.45),
      fireball2: strike('Melee_1H_Attack_Slice_Horizontal', 0.27, 0.25, 0.45),
      fireball3: strike('Melee_1H_Attack_Chop', 0.59, 0.3, 0.45),
    },
    play: { shot: shot() },
  },
  gale_shear: {
    grade: 'good', release: 0.08, legacy: ['combo'],
    // wind blades: a forehand slash, a thrust, then the spinning crescent (the finisher)
    keys: {
      gale_shear1: strike('Melee_1H_Attack_Slice_Horizontal', 0.27, 0.25, 0.4),
      gale_shear2: strike('Melee_1H_Attack_Stab', 0.4, 0.3, 0.4),
      gale_shear3: strike('Melee_2H_Attack_Spin', 0.72, 0.4, 0.6),
    },
    play: { shot: shot() },
  },
  glacial_skim: {
    grade: 'ok', release: 0.08, legacy: ['combo'],
    // the staff thrust low along the ground (the shards skim it), leaning in, a little to each side; the finisher a low throw
    keys: {
      glacial_skim1: strike('Ranged_Magic_Shoot', SHOOT, 0.2, 0.45, { bend: { spine: 18, chest: 22 }, yaw: 12 }),
      glacial_skim2: strike('Ranged_Magic_Shoot', SHOOT, 0.2, 0.45, { bend: { spine: 18, chest: 22 }, yaw: -12 }),
      glacial_skim3: strike('Throw', THROW, 0.3, 0.5, { bend: { spine: 12, chest: 12 } }),
    },
    play: { shot: shot() },
    need: 'an underhand sweep along the ground',
  },
  hex_shards: {
    grade: 'good', release: 0.08, legacy: ['combo'],
    // glyphs from the left, from the right (the staff thrust from a turned stance), then the staff swept up for the high lob
    keys: {
      hex_shards1: strike('Ranged_Magic_Shoot', SHOOT, 0.2, 0.45, { yaw: 30 }),
      hex_shards2: strike('Ranged_Magic_Shoot', SHOOT, 0.2, 0.45, { yaw: -30 }),
      hex_shards3: strike('Ranged_Magic_Raise', 0.3, 0.25, 0.45),
    },
    play: { shot: shot() },
  },
  sling: {
    grade: 'good', release: 0.08, legacy: ['combo'],
    keys: { sling1: strike('Throw', THROW, 0.3, 0.45), sling2: strike('Throw', THROW, 0.3, 0.45, { yaw: 15 }) },
    play: { shot: shot() },
  },
  potion_toss: {
    grade: 'good', release: 0.08, legacy: ['combo'],
    keys: { potion_toss1: strike('Throw', THROW, 0.35, 0.45), potion_toss2: strike('Throw', THROW, 0.35, 0.45, { yaw: 15 }) },
    play: { shot: shot() },
  },

  // ---------------------------------------------------------------- power (RMB)
  meteor: {
    grade: 'good', release: 1.25,
    // Spellcasting_Long: the staff gathers through the 1.25 s wind-up and thrusts at its end
    keys: { meteor: windup('Ranged_Magic_Spellcasting_Long', 0, LONG, 1.25, 0.8) },
    play: { windup: ['meteor', 2.05, 1, 0] },
  },
  cyclone: {
    grade: 'good', release: 0.45, legacy: ['spin'],
    // the two-handed spin's wind-up through 0.45 s, then the spin itself through the 0.5 s pulse
    keys: { cyclone: windup('Melee_2H_Attack_Spin', 0.2, 0.7, 0.45, 0.9), spin: ['Melee_2H_Attack_Spin', 0.6, 1.4] },
    play: { windup: ['cyclone', 0.45 + 0.9, 1, 0] },
  },
  sanguine_lash: {
    grade: 'good', release: 1.5, legacy: ['lash'],
    // the backhand drawn back by 0.4 s and held there, hunched, through the 1.5 s wind-up (the coil tightens); the slash cracks on
    // the release (its peak, clip 0.27 s, at 1.5 s), then the follow-through
    keys: { sanguine_lash: { clip: 'Melee_1H_Attack_Slice_Horizontal', warp: [[0, 0], [0.2, 0.4], [0.2, 1.4], [0.27, 1.5], [1.37, 2.1]], bend: { spine: 12, chest: 10 } } },
    play: { windup: ['sanguine_lash', 2.1, 1, 0] },
    need: 'a crouched whip wind-up',
  },
  frostfall: {
    grade: 'good', release: 0.15,
    // gathering while the circle is aimed (a held loop), then the staff raised overhead as the ice falls
    keys: { frostfall: { clip: 'Ranged_Magic_Raise', from: 0.1, to: 1.0, warp: [[0.1, 0], [RAISE, 0.15], [1.0, 0.8]] },
      frostfall_aim: { clip: 'Ranged_Magic_Spellcasting', loop: true } },
    play: { hold: ['frostfall_aim', 99, 1, 0], release: ['frostfall', 0.5, 1, 0] },
  },
  battering_ram: {
    grade: 'good', release: 0.8,
    // the staff driven into the ground at the end of the 0.8 s wind-up, as the ram bursts out
    keys: { battering_ram: windup('Ranged_Magic_Summon', 1.6, SLAM, 0.8, 0.8) },
    play: { windup: ['battering_ram', 1.6, 1, 0] },
  },
  toxic_flask: {
    grade: 'good', release: 0.15,
    keys: { toxic_flask: { clip: 'Throw', from: 0.45, to: 1.2, warp: [[0.45, 0], [THROW, 0.15], [1.2, 0.6]] } },
    play: { cast: ['toxic_flask', 0.6, 1, 0] },
  },

  // ---------------------------------------------------------------- mobility (E)
  blink: {
    grade: 'good', release: 0,
    // bursting up out of the ground at the far end (Spawn_Ground), a hop and the landing crouch
    keys: { blink: POP(0.45) },
    play: { cast: ['blink', 0.45, 1, 0] },
  },
  skyward: {
    grade: 'ok', release: 0, legacy: ['float'],
    keys: { skyward: { clip: 'Jump_Start', from: 0.2, to: 0.55, warp: [[0.2, 0], [0.55, 0.3]], pinXZ: true } },   // the launch; then the float
    play: { cast: ['skyward', 0.3, 1, 0], loop: ['float', 2.8, 1, 0] },
  },
  mirror_step: {
    grade: 'good', release: 0,
    keys: { mirror_step: POP(0.5) },
    play: { cast: ['mirror_step', 0.5, 1, 0] },
  },
  smoke_screen: {
    grade: 'good', release: 0,
    // the tucked jump with a procedural backflip (FLIPS), over by 0.42 s (the 0.25 s dash and the drop), up by 0.5 s
    keys: { smoke_screen: { clip: 'Jump_Start', from: 0.2, to: 0.5, warp: [[0.2, 0], [0.3, 0.1], [0.5, 0.5]], pinXZ: true } },
    play: { cast: ['smoke_screen', 0.5, 1, 0] },
  },
  roll: {
    grade: 'good', release: 0,
    // a tucked crouch with a procedural tumble (FLIPS: a somersault forward or back, a sideways roll each way), one per direction
    // relative to facing (rollKey below): over by 0.36 s (the 0.35 s dash), up by 0.45 s. In the air, KayKit's dodges with the
    // hips pinned and the same tumble.
    keys: {
      roll: TUCK(1), roll_back: TUCK(-0.6), roll_left: TUCK(0.5), roll_right: TUCK(0.5),
      roll_air: { ...DODGE('Forward'), flatY: 0.1 },
      roll_air_back: { ...DODGE('Backward'), flatY: 0.1 },
      roll_air_left: { ...DODGE('Left'), flatY: 0.1 },
      roll_air_right: { ...DODGE('Right'), flatY: 0.1 },
    },
    play: { cast: ['roll', 0.45, 1, 0] },
  },
  ram_ride: {
    grade: 'ok', release: 0, legacy: ['ride'],
    keys: { ride: { clip: 'Sit_Chair_Idle', loop: true } },     // seated on the ram's back, legs forward
    play: { loop: ['ride', 2.9, 1, 0] },
  },
  flask_step: {
    grade: 'good', release: 0.6, legacy: ['flask_step', 'arrival'],
    keys: {
      flask_step: { clip: 'Throw', from: 0.2, to: 1.1, warp: [[0.2, 0], [THROW, 0.6], [1.1, 0.85]] },
      arrival: ['Spawn_Air', 0.55, 1.3, 0.8],
    },
    play: { windup: ['flask_step', 0.85, 1, 0], cast: ['arrival', 0.8, 1, 0] },
  },

  // ---------------------------------------------------------------- guard (R)
  ward: {
    grade: 'good', release: 0,
    keys: {},                                      // the shared block, held
    play: { hold: ['block', 99, 1, 0] },
  },
  black_death: {
    grade: 'ok', release: 0,
    // the block hunched over (spine and chest bent forward, the head ducked): wizard.js holds it instead of the block
    keys: { shroud: { clip: 'Melee_Blocking', loop: true, bend: { spine: 22, chest: 18, head: 12 } } },
    play: { hold: ['shroud', 99, 1, 0] },
    need: 'an arms-wrapped shroud pose',
  },
  firewall: {
    grade: 'good', release: 0.2,
    // the staff swept up overhead as the wall rises
    keys: { firewall: { clip: 'Ranged_Magic_Raise', from: 0.1, to: 1.0, warp: [[0.1, 0], [RAISE, 0.2], [1.0, 0.6]] } },
    play: { cast: ['firewall', 0.6, 1, 0] },
  },
  tempest_veil: {
    grade: 'ok', release: 0.15,
    keys: { tempest_veil: strike('Ranged_Magic_Raise', RAISE, 0.3, 0.4) },
    play: { cast: ['tempest_veil', 0.45, 1, 0] },
  },
  glacial_bulwark: {
    grade: 'good', release: 0.15,
    // a low push forward with the staff as the wall rises in front
    keys: { glacial_bulwark: { clip: 'Melee_Block_Attack', from: 0.2, to: 0.9, warp: [[0.2, 0], [0.43, 0.15], [0.9, 0.6]] } },
    play: { cast: ['glacial_bulwark', 0.5, 1, 0] },
  },
  ram_guard: {
    grade: 'ok', release: 0,
    keys: { ram_guard: ['Melee_Block', 0, 0.6] },
    play: { cast: ['ram_guard', 0.6, 1, 0] },
    need: 'a whistle or a shepherd\'s call',
  },
  smoke_flask: {
    grade: 'good', release: 0.1,
    keys: { smoke_flask: strike('Throw', THROW, 0.25, 0.35) },
    play: { cast: ['smoke_flask', 0.4, 1, 0] },
  },

  // ---------------------------------------------------------------- utility (F)
  telekinesis: {
    grade: 'good', release: 0.35,
    keys: {},                                      // the shared tk_lift / tk_throw
    play: { cast: ['tk_lift', 0.9, 1, 0], release: ['tk_throw', 0.9, 1, 0] },
  },
  trapped_relic: {
    grade: 'ok', release: 0.35,
    keys: { trapped_relic: ['Ranged_Magic_Spellcasting', 0, 0.67, 0.5] },   // the curse: a hand worked over the object
    play: { cast: ['tk_lift', 0.9, 1, 0], release: ['tk_throw', 0.9, 1, 0], hold: ['trapped_relic', 0.5, 1, 0] },
  },

  // ---------------------------------------------------------------- ultimates (Q): every one has a 1.3 s wind-up
  meteor_rain: {
    grade: 'good', release: 1.3, legacy: ['ult'],
    // the long gather, the thrust on the release (the leap); then Jump_Idle held through the rise and hover; the dive is the same
    // pose with wizard.js's procedural pitch (mrainDive); then the landing crouch out of the blast
    keys: {
      meteor_rain: windup('Ranged_Magic_Spellcasting_Long', 0, LONG, 1.3, 0.2),
      mrain_hover: { clip: 'Jump_Idle', loop: true, flatY: 0 },
      mrain_dive: { clip: 'Jump_Start', from: 0.2, to: 0.3, warp: [[0.2, 0], [0.3, 0.6]], flatY: -0.2 },
      mrain_land: { clip: 'Jump_Land', warp: [[0, 0], [0.3, 0.25], [0.67, 0.8]], pinXZ: true },
    },
    play: { windup: ['meteor_rain', 1.5, 1, 0], hover: ['mrain_hover', 4.5, 1, 0], dive: ['mrain_dive', 0.6, 1, 0], land: ['mrain_land', 0.8, 1, 0] },
  },
  eye_of_storm: {
    grade: 'ok', release: 1.3, legacy: ['ult', 'spin'],
    keys: { eye_of_storm: windup('Ranged_Magic_Spellcasting_Long', 0, LONG, 1.3, 0.3), spin: ['Melee_2H_Attack_Spin', 0.6, 1.4] },
    play: { windup: ['eye_of_storm', 1.6, 1, 0], channel: ['spin', 0.7, 1, 0] },
  },
  blizzard: {
    grade: 'good', release: 1.3, legacy: ['ult'],
    // the gather fills the wind-up and thrusts on the release, then the casting loop is held through the 2.5 s cone
    keys: { blizzard: windup('Ranged_Magic_Spellcasting_Long', 0, LONG, 1.3, 0.1), blizzard_hold: { clip: 'Ranged_Magic_Spellcasting', loop: true } },
    play: { windup: ['blizzard', 1.4, 1, 0], channel: ['blizzard_hold', 2.5, 1, 0] },
  },
  night_cage: {
    grade: 'good', release: 1.3, legacy: ['ult'],
    // the staff raised, then driven into the ground as the spikes rise
    keys: { night_cage: windup('Ranged_Magic_Summon', 0.3, SLAM, 1.3, 0.6) },
    play: { windup: ['night_cage', 1.9, 1, 0] },
  },
  stampede: {
    grade: 'good', release: 1.3, legacy: ['ult'],
    keys: { stampede: windup('Ranged_Magic_Summon', 0.3, SLAM, 1.3, 0.8) },
    play: { windup: ['stampede', 2.1, 1, 0] },
  },
  berserker_brew: {
    grade: 'ok', release: 1.3, legacy: ['ult'],
    // Use_Item: the hand at the lips at 0.55 s, held, lowered by 1.6 s
    keys: { berserker_brew: { clip: 'Use_Item', warp: [[0, 0], [0.3, 0.55], [1.2, 1.15], [1.6, 1.6]] } },
    play: { windup: ['berserker_brew', 1.6, 1, 0] },
    need: 'a flask in the hand',
  },
};

// The key a spell fills for an older shared name (legacy), or null.
export function legacyKey(spellId, name) {
  const a = SPELL_ANIMS[spellId];
  if (!a?.legacy) return null;
  if (name.startsWith('combo') && a.legacy.includes('combo')) {
    const n = +name.slice(5), keys = Object.keys(a.keys).filter(k => /\d$/.test(k));
    return keys.length ? keys[Math.min(n, keys.length) - 1] : null;
  }
  if (!a.legacy.includes(name)) return null;
  if (name === 'ult') return spellId;
  if (name === 'lash') return spellId;
  return name;            // spin, float, ride, flask_step, arrival: the same key name in `keys` (or COMMON_ANIMS)
}

// Wizard.oneShot arguments for `spellId`'s `phase` ('shot' takes the shot number, 1-based), or null.
export function spellPlay(spellId, phase, n = 1) {
  const p = SPELL_ANIMS[spellId]?.play?.[phase];
  if (!p) return null;
  const shots = Object.keys(SPELL_ANIMS[spellId].keys).filter(k => /\d$/.test(k)).length;
  const key = p[0] === '#' ? `${spellId}${Math.max(1, Math.min(n, shots))}` : p[0];
  return [key, p[1], p[2], p[3]];
}

// Roll: the key for a roll along world direction `dir` ([x, z]) by a wizard facing `yaw` (a body faces +z at yaw 0;
// wizard.js turns it by yaw about +y). Pass it to Wizard.oneShot with the rest of spellPlay('roll', 'cast').
// `air`: the roll starts off the ground, so it's the flipping air-dodge (the roll_air* keys).
export function rollKey(dir, yaw, air = false) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const fwd = dir[0] * fx + dir[1] * fz, side = dir[0] * fz - dir[1] * fx;    // side > 0: to the body's left
  const base = air ? 'roll_air' : 'roll';
  if (Math.abs(fwd) >= Math.abs(side)) return fwd >= 0 ? base : `${base}_back`;
  return side > 0 ? `${base}_left` : `${base}_right`;
}
