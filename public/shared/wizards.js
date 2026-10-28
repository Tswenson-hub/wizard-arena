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
    kit: { primary: 'spark', power: 'meteor', mobility: 'blink', guard: 'ward', utility: 'telekinesis' },
  },
  gale: {
    id: 'gale', name: 'Gale', title: 'the Tempest Dervish', role: 'Diver · blinks in and spins',
    color: 0xb46cff, tint: 0x9a6bff, model: '/models/wizards/gale.glb',
    kit: { primary: 'spark', power: 'cyclone', mobility: 'blink', guard: 'ward', utility: 'telekinesis' },
  },
  rime: {
    id: 'rime', name: 'Rime', title: 'the Frost Warden', role: 'Fortress · slows, walls off, shells from cover',
    color: 0x7fd8ff, tint: 0x8fd4ff, model: '/models/wizards/rime.glb',
    kit: { primary: 'glacial_skim', power: 'frostfall', mobility: 'skyward', guard: 'glacial_bulwark', utility: 'telekinesis' },
  },
  vesper: {
    id: 'vesper', name: 'Vesper', title: 'the Hemomancer', role: 'Trickster · decoys, binds, traps',
    color: 0xd8203c, tint: 0x8a1024, model: '/models/wizards/vesper.glb',
    kit: { primary: 'spark', power: 'sanguine_lash', mobility: 'mirror_step', guard: 'ward', utility: 'trapped_relic' },
  },
};

export const DEFAULT_WIZARD = 'cinder';
export const isWizard = (id) => typeof id === 'string' && Object.hasOwn(WIZARDS, id);
