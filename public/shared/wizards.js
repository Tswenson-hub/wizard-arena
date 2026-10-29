// The wizard roster. Each wizard has a fixed kit: one spell per slot, and players pick a wizard,
// not individual spells. Spell ids refer to SPELLBOOK in constants.js.
// Kits: gameplay track. Look fields (color, tint, model, title, role): characters track.

export const KIT_SLOTS = ['primary', 'power', 'mobility', 'guard', 'utility'];

export const WIZARDS = {
  cinder: {
    id: 'cinder', name: 'Cinder', title: 'the Pyromancer', role: 'All-rounder · long-range burst',
    color: 0xff5c3c,          // UI accent, ring and nameplate
    tint: null,               // stand-in tint over the base model until a model of its own exists
    model: '/models/wizards/cinder.glb',   // null = base wizard.glb, tinted by `tint`
    kit: { primary: 'fireball', power: 'meteor', mobility: 'smoke_screen', guard: 'firewall', utility: 'telekinesis', ultimate: 'meteor_rain' },
    speed: 3.0,               // walk speed (m/s; Ty: normal movement is a walk); spells track, like kit
    sprint: 5.5,              // Shift: a run that drains stamina (round 8)
  },
  gale: {
    id: 'gale', name: 'Gale', title: 'the Tempest Dervish', role: 'Diver · blinks in and spins',
    color: 0xb46cff, tint: 0x9a6bff, model: '/models/wizards/gale.glb',
    kit: { primary: 'gale_shear', power: 'cyclone', mobility: 'blink', guard: 'tempest_veil', utility: 'telekinesis', ultimate: 'eye_of_storm' },
    speed: 3.6,               // Gale stays the fastest
    sprint: 6.2,              // Shift (round 8)
  },
  rime: {
    id: 'rime', name: 'Rime', title: 'the Frost Warden', role: 'Fortress · slows, walls off, shells from cover',
    color: 0x7fd8ff, tint: 0x8fd4ff, model: '/models/wizards/rime.glb',
    kit: { primary: 'glacial_skim', power: 'frostfall', mobility: 'skyward', guard: 'glacial_bulwark', utility: 'telekinesis', ultimate: 'blizzard' },
    speed: 3.0,
  },
  vesper: {
    id: 'vesper', name: 'Vesper', title: 'the Hemomancer', role: 'Trickster · decoys, binds, traps',
    color: 0xd8203c, tint: 0x8a1024, model: '/models/wizards/vesper.glb',
    kit: { primary: 'hex_shards', power: 'sanguine_lash', mobility: 'mirror_step', guard: 'black_death', utility: 'trapped_relic', ultimate: 'night_cage' },
    speed: 3.0,
  },
  // Round 7. Placeholder kit (existing spells) until the spells agent lands Jeb's; stand-in body until the
  // characters agent wires his model.
  jeb: {
    id: 'jeb', name: 'Jeb', title: 'the Shepherd', role: 'Herder · rams do his fighting',
    color: 0xe8dcc0, tint: 0xc9b07a, model: '/models/wizards/jeb.glb',
    kit: { primary: 'sling', power: 'battering_ram', mobility: 'ram_ride', guard: 'ram_guard', utility: 'telekinesis', ultimate: 'stampede' },
    speed: 3.0,
  },
  // Round 8. Placeholder kit (existing spells) until the spells agent lands Embibe's; stand-in body until the
  // characters agent wires her model.
  embibe: {
    id: 'embibe', name: 'Embibe', title: 'the Alchemist', role: 'Potion thrower · pools, splashes, a brutal brew',
    color: 0x7fd34a, tint: 0x6a3a9a, model: null,
    kit: { primary: 'potion_toss', power: 'toxic_flask', mobility: 'flask_step', guard: 'smoke_flask', utility: 'telekinesis', ultimate: 'berserker_brew' },
    speed: 3.0,
  },
};

export const DEFAULT_WIZARD = 'cinder';
export const isWizard = (id) => typeof id === 'string' && Object.hasOwn(WIZARDS, id);
