// Round 11: no heroes in gameplay. These are the old heroes, kept as the builder's presets (shown by `preset`, a generic
// type name; the hero names are internal only): `kit` is a preset loadout
// (constants.js PRESETS), one spell per slot. Spell ids refer to SPELLBOOK in constants.js. Everyone moves alike now
// (constants.js MOVE_SPEED, SPRINT.speed), so the per-hero speed fields are gone.
// Kits: gameplay track. Look fields (color, title, role, tip): characters track. Round 27: `role` is the gallery card's one line,
// `tip` the detail panel's playstyle tip (select.js).

export const KIT_SLOTS = ['primary', 'power', 'mobility', 'guard', 'utility'];

export const WIZARDS = {
  cinder: {
    id: 'cinder', preset: 'Pyromancer', name: 'Cinder', title: 'the Pyromancer', role: 'Fire burst from range',
    tip: 'Fireballs hit hard from far away: keep your distance. Catch someone in your Firewall or mid-cast, then drop a Meteor on them.',
    color: 0xff5c3c,          // UI accent, ring and nameplate
    kit: { primary: 'fireball', power: 'meteor', mobility: 'smoke_screen', guard: 'firewall', utility: 'telekinesis', ultimate: 'meteor_rain' },
  },
  gale: {
    id: 'gale', preset: 'Stormcaller', name: 'Gale', title: 'the Tempest Dervish', role: 'Blink in, fling them away',
    tip: 'Blink in close, cut with Gale Shear, then spin an Arcane Cyclone to throw them off a ledge. On the Sky Ruins the void does the rest.',
    color: 0xb46cff,
    kit: { primary: 'gale_shear', power: 'cyclone', mobility: 'blink', guard: 'tempest_veil', utility: 'telekinesis', ultimate: 'eye_of_storm' },
  },
  rime: {
    id: 'rime', preset: 'Frost Warden', name: 'Rime', title: 'the Frost Warden', role: 'Freeze and wall off',
    tip: "Slow them with Glacial Skim, then drop Frostfall where they're heading. A Glacial Bulwark blocks a doorway, a charge or a whole volley.",
    color: 0x7fd8ff,
    kit: { primary: 'glacial_skim', power: 'frostfall', mobility: 'skyward', guard: 'glacial_bulwark', utility: 'telekinesis', ultimate: 'blizzard' },
  },
  vesper: {
    id: 'vesper', preset: 'Hemomancer', name: 'Vesper', title: 'the Hemomancer', role: 'Drain life, dodge with decoys',
    tip: 'Blood Siphon heals you as it hits, so trade blows and win. In trouble, Mirror Step: two decoys run off and they chase the wrong one.',
    color: 0xd8203c,
    kit: { primary: 'hex_shards', power: 'sanguine_lash', mobility: 'mirror_step', guard: 'black_death', utility: 'telekinesis', ultimate: 'night_cage' },
  },
  jeb: {
    id: 'jeb', preset: 'Beastcaller', name: 'Jeb', title: 'the Shepherd', role: 'Rams do the fighting',
    tip: "Sling stones hit harder from far off. Hide behind a Ram Guard, ride in on a ram, and send a Stampede down a lane they can't leave.",
    color: 0xe8dcc0,
    kit: { primary: 'sling', power: 'battering_ram', mobility: 'ram_ride', guard: 'ram_guard', utility: 'telekinesis', ultimate: 'stampede' },
  },
  embibe: {
    id: 'embibe', preset: 'Alchemist', name: 'Embibe', title: 'the Alchemist', role: 'Potions, poison and a brutal brew',
    tip: 'Lob potions over cover and leave Toxic Flask pools in doorways. When a fight gets close, drink Berserker Brew: harder hits and half the cooldowns.',
    color: 0x7fd34a,
    kit: { primary: 'potion_toss', power: 'toxic_flask', mobility: 'flask_step', guard: 'smoke_flask', utility: 'telekinesis', ultimate: 'berserker_brew' },
  },
};

export const DEFAULT_WIZARD = 'cinder';
export const isWizard = (id) => typeof id === 'string' && Object.hasOwn(WIZARDS, id);
