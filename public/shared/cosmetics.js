// Cosmetic looks (characters track, round 26): how each unlock in constants.js's UNLOCKS looks, keyed by its id. The unlock levels,
// names, titles and the server's sanitizing are spells' (constants.js: UNLOCKS, COSMETIC_SLOTS, sanitizeEquipped, titleFor); this file
// only says what an id draws, so nothing here can change who may wear what. No THREE and no DOM.
//
// A wizard's equipped cosmetics are `{ robe, hat, staff, trail }` (an unlock id per slot; a missing slot is the default look).
//   robe:  [hue 0..1, saturation, value scale] for the robe and the cape swatches (looks.js re-hues KayKit's atlas, like the element tint)
//   hat:   `hat` a colour of its own (same triple), `wide` the brim's spread (1 = KayKit's), `band` 'circlet' | 'crown' (a gold band)
//   staff: `glow` the gem's colour and a halo on the staff head
//   trail: `trail` a spark colour off the staff head (and an accent for spells' trails, if effects.js mixes it in)
// `swatch` is the Wardrobe's chip colour.

export const SLOTS = ['robe', 'hat', 'staff', 'trail'];
export const SLOT_NAMES = { robe: 'Robes', hat: 'Hat', staff: 'Staff glow', trail: 'Spell trail' };
// The default of each slot (never stored, never sent): the Wardrobe's first chip.
export const DEFAULT_LOOK = {
  robe: { name: 'Element', blurb: 'Tinted by your spells' },
  hat: { name: 'Classic', blurb: 'Matches your robes' },
  staff: { name: 'Element', blurb: 'Your main element' },
  trail: { name: 'None', blurb: 'Your spells as they are' },
};

export const LOOKS = {
  robe_crimson: { slot: 'robe', robe: [0.985, 0.82, 0.95], cape: [0.11, 0.75, 1.35], swatch: 0xb3122a },
  robe_emerald: { slot: 'robe', robe: [0.39, 0.72, 0.85], cape: [0.12, 0.62, 1.25], swatch: 0x14915a },
  robe_midnight: { slot: 'robe', robe: [0.64, 0.62, 0.5], cape: [0.11, 0.55, 1.2], swatch: 0x1b2a6b },
  robe_gold: { slot: 'robe', robe: [0.115, 0.78, 1.55], cape: [0.99, 0.8, 0.85], swatch: 0xe0a92a },
  robe_frost: { slot: 'robe', robe: [0.56, 0.22, 1.95], cape: [0.57, 0.65, 1.3], swatch: 0xcfe9ff },
  robe_void: { slot: 'robe', robe: [0.79, 0.75, 0.62], cape: [0.86, 0.9, 1.1], swatch: 0x4a1a78 },

  hat_wide: { slot: 'hat', wide: 1.32, swatch: 0x6b4fa8 },
  hat_circlet: { slot: 'hat', band: 'circlet', swatch: 0xffcf4a },
  hat_crown: { slot: 'hat', band: 'crown', wide: 1.0, swatch: 0xffcf4a },

  staff_ember: { slot: 'staff', glow: 0xff7a22, swatch: 0xff7a22 },
  staff_frost: { slot: 'staff', glow: 0x8fe6ff, swatch: 0x8fe6ff },
  staff_void: { slot: 'staff', glow: 0xb24cff, swatch: 0xb24cff },

  trail_gold: { slot: 'trail', trail: 0xffd25a, swatch: 0xffd25a },
  trail_violet: { slot: 'trail', trail: 0xc070ff, swatch: 0xc070ff },
  trail_frost: { slot: 'trail', trail: 0xaef0ff, swatch: 0xaef0ff },
};

// Only ids this file can draw, each in its own slot (the look side of spells' sanitizeEquipped; it trusts the level). Never throws.
export function lookEquipped(eq) {
  const out = {};
  if (!eq || typeof eq !== 'object') return out;
  for (const slot of SLOTS) { const id = eq[slot]; if (typeof id === 'string' && LOOKS[id]?.slot === slot) out[slot] = id; }
  return out;
}
export const trailColor = (id) => LOOKS[id]?.trail ?? null;
