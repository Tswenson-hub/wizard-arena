// Round 11: no heroes in gameplay. These are the old heroes, kept as the builder's presets (shown by `preset`, a generic
// type name; the hero names are internal only): `kit` is a preset loadout
// (constants.js PRESETS), one spell per slot. Spell ids refer to SPELLBOOK in constants.js. Everyone moves alike now
// (constants.js MOVE_SPEED, SPRINT.speed), so the per-hero speed fields are gone.
// Kits: gameplay track. Look fields (color, title, role): characters track.

export const KIT_SLOTS = ['primary', 'power', 'mobility', 'guard', 'utility'];

export const WIZARDS = {
  cinder: {
    id: 'cinder', preset: 'Pyromancer', name: 'Cinder', title: 'the Pyromancer', role: 'All-rounder · long-range burst',
    color: 0xff5c3c,          // UI accent, ring and nameplate
    kit: { primary: 'fireball', power: 'meteor', mobility: 'smoke_screen', guard: 'firewall', utility: 'telekinesis', ultimate: 'meteor_rain' },
  },
  gale: {
    id: 'gale', preset: 'Stormcaller', name: 'Gale', title: 'the Tempest Dervish', role: 'Diver · blinks in and spins',
    color: 0xb46cff,
    kit: { primary: 'gale_shear', power: 'cyclone', mobility: 'blink', guard: 'tempest_veil', utility: 'telekinesis', ultimate: 'eye_of_storm' },
  },
  rime: {
    id: 'rime', preset: 'Frost Warden', name: 'Rime', title: 'the Frost Warden', role: 'Fortress · slows, walls off, shells from cover',
    color: 0x7fd8ff,
    kit: { primary: 'glacial_skim', power: 'frostfall', mobility: 'skyward', guard: 'glacial_bulwark', utility: 'telekinesis', ultimate: 'blizzard' },
  },
  vesper: {
    id: 'vesper', preset: 'Hemomancer', name: 'Vesper', title: 'the Hemomancer', role: 'Trickster · decoys, binds, traps',
    color: 0xd8203c,
    kit: { primary: 'hex_shards', power: 'sanguine_lash', mobility: 'mirror_step', guard: 'black_death', utility: 'trapped_relic', ultimate: 'night_cage' },
  },
  jeb: {
    id: 'jeb', preset: 'Beastcaller', name: 'Jeb', title: 'the Shepherd', role: 'Herder · rams do his fighting',
    color: 0xe8dcc0,
    kit: { primary: 'sling', power: 'battering_ram', mobility: 'ram_ride', guard: 'ram_guard', utility: 'telekinesis', ultimate: 'stampede' },
  },
  embibe: {
    id: 'embibe', preset: 'Alchemist', name: 'Embibe', title: 'the Alchemist', role: 'Potion thrower · pools, splashes, a brutal brew',
    color: 0x7fd34a,
    kit: { primary: 'potion_toss', power: 'toxic_flask', mobility: 'flask_step', guard: 'smoke_flask', utility: 'telekinesis', ultimate: 'berserker_brew' },
  },
};

export const DEFAULT_WIZARD = 'cinder';
export const isWizard = (id) => typeof id === 'string' && Object.hasOwn(WIZARDS, id);
