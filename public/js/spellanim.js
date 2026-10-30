// The per-spell animation table (characters track, round 11). Every player is the same generic wizard
// (the base wizard.glb); each spell names the clip its cast plays, cut from the clip pool (every clip of the
// six hero exports, retargeted onto the base rig: looks.js bakeClipPool, tools/bake-clip-pool.py), and
// retimed so its release frame lands where the spell actually fires.
//
// A clip spec ("pick") is one of:
//   'hero.Clip'                          a whole pool clip ('base.<key>' for the base wizard's own clips)
//   ['hero.Clip', from, to, duration?]   the part between two clip times (s), optionally stretched to `duration`
//   { clip, from, to, warp, yaw }        that part retimed through warp [[clipTime, newTime], ...] (piecewise
//                                        linear, in clip times); `yaw` turns it (deg) for moves from a bladed stance;
//                                        `reverse: true` plays it backwards; `flatY: dy` pins the Hips dy m above
//                                        standing height (no root motion at all: for airborne clips)
// Root motion is stripped. Release times below were measured on the pool (the right hand's speed peak,
// /tmp/wa-characters/r11/trace.py) and checked on contact sheets.
//
// Each entry:
//   keys     clip keys this spell adds to the body: `${id}` (its cast), `${id}1..n` (one per primary shot),
//            and named extras (an ultimate's channel, a ride, an arrival)
//   play     when main.js plays what: phase -> [key, duration, timeScale, startAt] (Wizard.oneShot's arguments)
//              shot     a primary shot, as it fires; '#' is the shot number (1..magazine)
//              cast     an instant cast, as the server confirms it
//              windup   the start of a wind-up; the release frame lands on the wind-up's end
//              release  the moment a held or aimed spell fires
//              channel / hold / loop    held states (play LoopOnce + clamp)
//   release  seconds into `play`'s main key where the spell visibly leaves the hand
//   legacy   the older shared key names (wizard.js / main.js) this spell fills on a body that has it equipped:
//            combo1..3, spin, lash, ult, float, ride, flask_step, arrival
//   grade    'good' (a clear, readable tell), 'ok' (works, not ideal), 'missing' (a stand-in: see `need`)
//   need     what to export from Meshy next, for 'ok' and 'missing' spells

// A strike cut around its peak (clip time `peak`): `lead` s before it squeezed into 0.08 s (the cross-fade in),
// `follow` s after it played at about real speed. For primary shots: play at 1x from 0 the moment the shot fires.
const strike = (clip, peak, lead = 0.25, follow = 0.45, yaw) =>
  ({ clip, from: Math.max(0, peak - lead), to: peak + follow, warp: [[Math.max(0, peak - lead), 0], [peak, 0.08], [peak + follow, 0.08 + follow * 0.9]], ...(yaw ? { yaw } : {}) });
// A wind-up cut: clip time `from` at 0, the release (clip time `peak`) at `windup` s, then `follow` s after it.
const windup = (clip, from, peak, windupS, follow = 0.5) =>
  ({ clip, from, to: peak + follow, warp: [[from, 0], [peak, windupS], [peak + follow, windupS + follow]] });
const shot = (n = 0.7) => ['#', n, 1, 0];
const ROLL = { clip: 'cinder.Roll_Dodge', from: 0.55, to: 1.8, warp: [[0.55, 0], [0.86, 0.08], [1.47, 0.32], [1.8, 0.45]] };

// Shared by every generic body (not tied to a spell).
export const COMMON_ANIMS = {
  walk_fight: 'cinder.Walk_Fight_Forward',   // a guarded walk, for slow movement (wind-ups, warding, slowed)
  back: 'cinder.Walk_Fight_Back',            // walking backward relative to facing
  float: ['rime.Fall2', 0, 0.67, 1.0],       // airborne: knees up, arms out (jumps, falls, Skyward's descent)
  hit_waist: ['cinder.Hit_Reaction_to_Waist', 0.2, 1.45, 0.75],     // hit by a thrown object
  tk_lift: { clip: 'cinder.mage_soell_cast_6', warp: [[0, 0], [0.7, 0.1], [1.2, 0.35], [2.3, 1.1]] },
  tk_throw: { clip: 'cinder.mage_soell_cast_4', warp: [[0, 0], [0.45, 0.08], [0.65, 0.18], [2.2, 1.0]] },
  death: 'embibe.dying_backwards',           // staggers back, flat by about 1.4 s (knockdown and getup are cut from it)
};

export const SPELL_ANIMS = {
  // ---------------------------------------------------------------- primaries (LMB): one key per shot
  spark: {
    grade: 'ok', release: 0.08, legacy: ['combo'],
    keys: { spark1: strike('base.cast_fast', 0.6, 0.25, 0.5), spark2: strike('base.cast_fast', 0.6, 0.25, 0.5), spark3: strike('base.cast_heavy', 0.7, 0.3, 0.5) },
    play: { shot: shot() },
    need: 'a quick one-handed flick (the same flick three times reads as a loop)',
  },
  fireball: {
    grade: 'good', release: 0.08, legacy: ['combo'],
    // Ty's pick for Cinder: the three strikes of the triple combo, each landing at 0.08 s
    keys: {
      fireball1: { yaw: 45, clip: 'embibe.Triple_Combo_Attack', from: 0.6, to: 1.0, warp: [[0.6, 0], [0.76, 0.08], [1.0, 0.45]] },
      fireball2: { yaw: 45, clip: 'embibe.Triple_Combo_Attack', from: 1.36, to: 1.85, warp: [[1.36, 0], [1.5, 0.08], [1.85, 0.45]] },
      fireball3: { yaw: 45, clip: 'embibe.Triple_Combo_Attack', from: 2.14, to: 3.3, warp: [[2.14, 0], [2.28, 0.08], [2.6, 0.35], [3.3, 0.8]] },
    },
    play: { shot: shot() },
  },
  gale_shear: {
    grade: 'good', release: 0.08, legacy: ['combo'],
    // wind blades: a forehand slash, a thrust, then the wide spinning crescent (the finisher)
    keys: {
      gale_shear1: strike('cinder.Right_Hand_Sword_Slash', 0.53, 0.25, 0.4),
      gale_shear2: strike('embibe.Thrust_Slash', 0.73, 0.3, 0.4),
      gale_shear3: strike('cinder.Axe_Spin_Attack', 0.9, 0.35, 0.6),
    },
    play: { shot: shot() },
  },
  glacial_skim: {
    grade: 'ok', release: 0.08, legacy: ['combo'],
    // a low two-handed fling (the shards skim the ground), the finisher a full forward throw
    keys: {
      glacial_skim1: strike('cinder.mage_soell_cast_4', 0.5, 0.3, 0.5),
      glacial_skim2: strike('cinder.mage_soell_cast_4', 0.5, 0.3, 0.5),
      glacial_skim3: strike('gale.mage_soell_cast_2', 1.23, 0.3, 0.5),
    },
    play: { shot: shot() },
    need: 'a low underhand sweep along the ground (a bowler\'s release)',
  },
  hex_shards: {
    grade: 'ok', release: 0.08, legacy: ['combo'],
    // glyphs from the left, from the right, then a high lob: a cross-body slash each way, then the overhead flick
    keys: {
      hex_shards1: strike('cinder.Charged_Slash', 1.17, 0.3, 0.45),
      hex_shards2: strike('embibe.Triple_Combo_Attack', 0.77, 0.3, 0.45, 45),
      hex_shards3: strike('base.cast_fast', 0.6, 0.3, 0.5),
    },
    play: { shot: shot() },
    need: 'a sign-tracing hand gesture (left, right, up): Vesper\'s own cast is too slow for a 0.45 s shot',
  },
  sling: {
    grade: 'ok', release: 0.08, legacy: ['combo'],
    keys: { sling1: strike('jeb.mage_soell_cast_1', 0.6, 0.25, 0.45), sling2: strike('jeb.mage_soell_cast_1', 1.4, 0.3, 0.45) },
    play: { shot: shot() },
    need: 'a sling whirl and release (overhead circle, sidearm snap)',
  },
  potion_toss: {
    grade: 'good', release: 0.08, legacy: ['combo'],
    // Embibe's overhand throw (the hand overhead, then flung forward at 2.4 s)
    keys: { potion_toss1: strike('embibe.Female_Crouch_Pick_Throw_Forward', 2.4, 0.4, 0.4), potion_toss2: strike('embibe.Female_Crouch_Pick_Throw_Forward', 2.4, 0.4, 0.4) },
    play: { shot: shot() },
  },

  // ---------------------------------------------------------------- power (RMB)
  meteor: {
    grade: 'good', release: 1.25,
    // the base heavy cast: gathers through the 1.25 s wind-up, hurls at its end
    keys: { meteor: windup('base.cast_heavy', 0, 1.9, 1.25, 0.8) },
    play: { windup: ['meteor', 2.05, 1, 0] },
  },
  cyclone: {
    grade: 'good', release: 0.45, legacy: ['spin'],
    // crouches into the 0.45 s wind-up, then Gale's low spinning sweep through the 0.5 s spin
    keys: { cyclone: windup('gale.Sweeping_Kick', 0.35, 0.8, 0.45, 0.9), spin: ['gale.Sweeping_Kick', 0.8, 1.7] },
    play: { windup: ['cyclone', 0.45 + 0.9, 1, 0] },
  },
  sanguine_lash: {
    grade: 'good', release: 1.5, legacy: ['lash'],
    // Vesper's lash: the crouched wind-up fills 1.5 s, the slash lands on the release, then the follow-through
    keys: { sanguine_lash: { clip: 'cinder.Right_Hand_Sword_Slash', warp: [[0, 0], [0.55, 1.3], [0.85, 1.55], [1.5, 2.1]] } },
    play: { windup: ['sanguine_lash', 2.1, 1, 0] },
  },
  frostfall: {
    grade: 'good', release: 0.15,
    // Rime's charged cast: the two-handed push (peak 1.9 s) as the circle is released
    keys: { frostfall: { clip: 'rime.Charged_Spell_Cast_1', from: 1.6, to: 3.1, warp: [[1.6, 0], [1.9, 0.15], [3.1, 0.8]] },
      frostfall_aim: ['rime.Charged_Spell_Cast_1', 0.4, 1.6, 1.0] },   // gathering while the circle is aimed (clamp)
    play: { hold: ['frostfall_aim', 99, 1, 0], release: ['frostfall', 0.5, 1, 0] },
  },
  battering_ram: {
    grade: 'ok', release: 0.8,
    // Jeb's lunging stomp: lands (0.7 s) at the end of the 0.8 s wind-up, as the ram bursts out
    keys: { battering_ram: windup('jeb.Angry_Ground_Stomp_2', 0, 0.7, 0.8, 0.8) },
    play: { windup: ['battering_ram', 1.6, 1, 0] },
    need: 'a big two-footed stomp or a ground punch (on the generic wizard the stomp is legs only and reads weakly)',
  },
  toxic_flask: {
    grade: 'ok', release: 0.15,
    // the rising lob from Embibe's crouch-pull-and-throw (hand overhead at 3.45 s)
    keys: { toxic_flask: { clip: 'embibe.Crouch_Pull_and_Throw', from: 3.15, to: 4.0, warp: [[3.15, 0], [3.45, 0.15], [4.0, 0.6]] } },
    play: { cast: ['toxic_flask', 0.6, 1, 0] },
    need: 'a standing underhand lob (the pool clip starts from a crouch)',
  },

  // ---------------------------------------------------------------- mobility (E)
  blink: {
    grade: 'missing', release: 0,
    keys: { blink: ['base.dash', 2.0, 2.6, 0.35] },
    play: { cast: ['blink', 0.35, 1, 0] },
    need: 'a short forward lunge or vanishing crouch (the base dodge is a sidestep)',
  },
  skyward: {
    grade: 'ok', release: 0, legacy: ['float'],
    keys: { skyward: ['base.cast_heavy', 1.7, 2.1, 0.3] },     // arms up as he launches; the descent is the shared float
    play: { cast: ['skyward', 0.3, 1, 0], loop: ['float', 2.8, 1, 0] },
    need: 'a crouch-and-launch straight up',
  },
  mirror_step: {
    grade: 'missing', release: 0,
    keys: { mirror_step: ['base.dash', 2.0, 2.8, 0.5] },
    play: { cast: ['mirror_step', 0.5, 1, 0] },
    need: 'a fast forward dash (a sprint-start lunge); the decoys run with the run clip',
  },
  smoke_screen: {
    grade: 'missing', release: 0,
    keys: { smoke_screen: ['cinder.Walk_Fight_Back', 0, 0.85, 0.35] },
    play: { cast: ['smoke_screen', 0.35, 1, 0] },
    need: 'a backflip or a backward leap (it is a 6.5 m leap; now it is a quick backpedal)',
  },
  roll: {
    grade: 'good', release: 0,
    // Cinder's Roll_Dodge (the cleanest of the three: one tight forward roll that ends standing; Roll_Dodge_2 spends
    // 0.7 s shuffling before it goes, Roll_Dodge_4 is a sideways tumble that ends in a low crouch). Cut from the dip
    // (0.55 s) to standing (1.8 s): tucked by 0.08 s, over by 0.32 s (the 0.35 s dash), up by 0.45 s.
    // One key per direction relative to facing (rollKey below): forward, back (the same roll reversed), left, right.
    keys: {
      roll: ROLL,
      roll_back: { ...ROLL, reverse: true },
      roll_left: { ...ROLL, yaw: 90 },
      roll_right: { ...ROLL, yaw: -90 },
    },
    play: { cast: ['roll', 0.45, 1, 0] },
  },
  ram_ride: {
    grade: 'ok', release: 0, legacy: ['ride'],
    keys: { ride: ['jeb.Cautious_Crouch_Walk_Left_inplace', 0.3, 0.42, 1.0] },   // a held wide-legged crouch, straddling the ram
    play: { loop: ['ride', 2.9, 1, 0] },
    need: 'a seated riding pose (bouncing with the gallop)',
  },
  flask_step: {
    grade: 'good', release: 0.6, legacy: ['flask_step', 'arrival'],
    keys: {
      flask_step: { clip: 'embibe.Crouch_Charge_and_Throw', from: 4.3, to: 5.7, warp: [[4.3, 0], [5.35, 0.6], [5.7, 0.85]] },
      arrival: ['embibe.Female_Crouch_Pick_Throw_Forward', 3.45, 4.6, 0.8],    // lands crouched, rises
    },
    play: { windup: ['flask_step', 0.85, 1, 0], cast: ['arrival', 0.8, 1, 0] },
  },

  // ---------------------------------------------------------------- guard (R)
  ward: {
    grade: 'good', release: 0,
    keys: {},                                      // the base block, held
    play: { hold: ['block', 99, 0.8, 0] },
  },
  black_death: {
    grade: 'ok', release: 0,
    keys: {},
    play: { hold: ['block', 99, 0.8, 0] },
    need: 'a hunched, arms-wrapped shroud pose (it blocks from every side; the front-facing block undersells it)',
  },
  firewall: {
    grade: 'ok', release: 0.2,
    // gathers low, then spreads both arms wide as the wall rises
    keys: { firewall: { clip: 'jeb.mage_soell_cast_1', from: 1.2, to: 2.2, warp: [[1.2, 0], [1.4, 0.2], [2.2, 0.8]] } },
    play: { cast: ['firewall', 0.6, 1, 0] },
    need: 'a sweeping arm raise from low to high (a wall rising from the ground)',
  },
  tempest_veil: {
    grade: 'ok', release: 0.15,
    // no root: a quick two-handed gather, then she keeps moving
    keys: { tempest_veil: strike('gale.mage_soell_cast_3', 0.93, 0.3, 0.4) },
    play: { cast: ['tempest_veil', 0.45, 1, 0] },
    need: 'an upper-body-only arms-around-self swirl (it must blend over running)',
  },
  glacial_bulwark: {
    grade: 'good', release: 0.15,
    keys: { glacial_bulwark: { clip: 'rime.Charged_Spell_Cast_1', from: 1.6, to: 2.6, warp: [[1.6, 0], [1.9, 0.15], [2.6, 0.6]] } },
    play: { cast: ['glacial_bulwark', 0.5, 1, 0] },
  },
  ram_guard: {
    grade: 'ok', release: 0,
    keys: { ram_guard: ['jeb.Block1', 0.3, 1.3, 0.6] },
    play: { cast: ['ram_guard', 0.6, 1, 0] },
    need: 'a whistle or shepherd\'s call gesture (the block reads as a ward)',
  },
  smoke_flask: {
    grade: 'missing', release: 0.1,
    keys: { smoke_flask: strike('embibe.Thrust_Slash', 0.73, 0.25, 0.35) },
    play: { cast: ['smoke_flask', 0.4, 1, 0] },
    need: 'a flask smashed down at the feet (a downward throw)',
  },

  // ---------------------------------------------------------------- utility (F)
  telekinesis: {
    grade: 'good', release: 0.35,
    keys: {},                                      // the shared tk_lift / tk_throw
    play: { cast: ['tk_lift', 0.9, 1, 0], release: ['tk_throw', 0.9, 1, 0] },
  },
  trapped_relic: {
    grade: 'ok', release: 0.35,
    keys: { trapped_relic: ['vesper.mage_soell_cast_5', 9.7, 10.5, 0.5] },   // the curse: a slow hand raised over the object
    play: { cast: ['tk_lift', 0.9, 1, 0], release: ['tk_throw', 0.9, 1, 0], hold: ['trapped_relic', 0.5, 1, 0] },
    need: 'a curse gesture over an object (both hands, palms down)',
  },

  // ---------------------------------------------------------------- ultimates (Q): every one has a 1.3 s wind-up
  meteor_rain: {
    grade: 'good', release: 1.3, legacy: ['ult'],
    // Wind-up: Jeb's arm-up leap (crouch, then the leap on the release). Cinder's Dive_Down_and_Land is airborne from its
    // first frame (no crouch or take-off in it), so it takes over in the air: its opening tuck, slowed, is the rise and
    // hover; its somersault into a head-first plunge is the 0.6 s dive, the plunge landing on the impact. Its vertical
    // root motion is dropped (flatY): the server flies her. Then she comes up from a crouch out of the blast.
    keys: {
      meteor_rain: windup('jeb.Sword_Judgment', 0.2, 0.83, 1.3, 0.2),
      mrain_hover: { clip: 'cinder.Dive_Down_and_Land', from: 0, to: 0.6, warp: [[0, 0], [0.6, 4.5]], flatY: 0 },
      mrain_dive: { clip: 'cinder.Dive_Down_and_Land', from: 0.6, to: 1.6, warp: [[0.6, 0], [1.0, 0.18], [1.6, 0.6]], flatY: -0.45 },   // head 10 cm off the ground at the impact
      mrain_land: { clip: 'embibe.Female_Crouch_Pick_Throw_Forward', from: 3.45, to: 4.6, warp: [[3.45, 0], [4.6, 0.8]] },   // up from the crouch
    },
    // windup: on ultWindup; hover: on mrainLeap (rise + hover, at most 4.5 s; mrainDive cuts it); dive: on mrainDive
    // (msg.left = 0.6 s, so the plunge lands with mrainLand); land: on mrainLand
    play: { windup: ['meteor_rain', 1.5, 1, 0], hover: ['mrain_hover', 4.5, 1, 0], dive: ['mrain_dive', 0.6, 1, 0], land: ['mrain_land', 0.8, 1, 0] },
  },
  eye_of_storm: {
    grade: 'ok', release: 1.3, legacy: ['ult', 'spin'],
    // a turning, rising gather, then the spinning sweep, repeated while she is the tornado
    keys: { eye_of_storm: windup('gale.mage_soell_cast_2', 0, 1.23, 1.3, 0.3), spin: ['gale.Sweeping_Kick', 0.8, 1.7] },
    play: { windup: ['eye_of_storm', 1.6, 1, 0], channel: ['spin', 0.7, 1, 0] },
    need: 'a looping full-body spin (a tornado), to replace the repeated sweep',
  },
  blizzard: {
    grade: 'good', release: 1.3, legacy: ['ult'],
    // Rime's charged cast: the gather fills the wind-up, then the push is held through the 2.5 s cone
    keys: { blizzard: windup('rime.Charged_Spell_Cast_1', 0.4, 1.9, 1.3, 0.1), blizzard_hold: ['rime.Charged_Spell_Cast_1', 1.9, 2.85, 2.5] },
    play: { windup: ['blizzard', 1.4, 1, 0], channel: ['blizzard_hold', 2.5, 1, 0] },
  },
  night_cage: {
    grade: 'ok', release: 1.3, legacy: ['ult'],
    // the heavy cast: gather, then both hands driven down as the spikes rise
    keys: { night_cage: windup('base.cast_heavy', 0.3, 1.9, 1.3, 0.6) },
    play: { windup: ['night_cage', 1.9, 1, 0] },
    need: 'both fists slammed to the ground (the spikes rise from it)',
  },
  stampede: {
    grade: 'good', release: 1.3, legacy: ['ult'],
    // Jeb's call: the arm-up leap, then the ground slam on the release
    keys: { stampede: windup('jeb.Sword_Judgment', 0.2, 1.0, 1.3, 0.8) },
    play: { windup: ['stampede', 2.1, 1, 0] },
  },
  berserker_brew: {
    grade: 'ok', release: 1.3, legacy: ['ult'],
    // Embibe's drink: the flask at the lips at 0.55 s of the 1.2 s drink, head back, lowered
    keys: { berserker_brew: { clip: 'embibe.Stand_and_Drink', from: 1.9, to: 5.9, warp: [[1.9, 0], [3.0, 0.55], [4.5, 1.15], [5.9, 1.6]] } },
    play: { windup: ['berserker_brew', 1.6, 1, 0] },
    need: 'a drink with a flask in hand: the generic wizard holds no flask, so the left-hand drink barely reads (or fit Embibe\'s potion prop)',
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
export function rollKey(dir, yaw) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const fwd = dir[0] * fx + dir[1] * fz, side = dir[0] * fz - dir[1] * fx;    // side > 0: to the body's left
  if (Math.abs(fwd) >= Math.abs(side)) return fwd >= 0 ? 'roll' : 'roll_back';
  return side > 0 ? 'roll_left' : 'roll_right';
}
