// Cosmetics and level titles (characters track, round 26): the catalog, the unlock levels and the rules. No THREE and no DOM, so
// the server can import it to sanitize a join's or a wardrobe change's `cos`. Cosmetic only: nothing here touches gameplay.
//
// A wizard's cosmetics are `{ robe, hat, staff, trail, title }`, each an id from its slot (missing: the slot's default, which is
// never stored). Ids are unique across slots and fit environment's `^[a-z0-9_-]{1,32}$` (player_progress.unlocks / equipped).
// The looks: robes are [hue 0..1, saturation, value scale] for the robe and cape swatches (looks.js re-hues KayKit's atlas with
// them, like the element tint); hats tint the hat or add a gold band (`band`); staffs set the gem's colour and a glow at the tip;
// trails a colour accent on the caster's spell trails.

export const COSMETIC_SLOTS = ['robe', 'hat', 'staff', 'trail', 'title'];
export const SLOT_NAMES = { robe: 'Robes', hat: 'Hats', staff: 'Staff glow', trail: 'Spell trail', title: 'Title' };

const item = (slot, id, name, level, look = {}) => ({ slot, id, name, level, ...look });
export const COSMETICS = [
  item('robe', 'robe_element', 'Element', 1, { blurb: 'Tinted by your spells' }),
  item('robe', 'robe_crimson', 'Crimson', 2, { robe: [0.985, 0.82, 0.95], cape: [0.11, 0.75, 1.35], swatch: 0xb3122a }),
  item('robe', 'robe_emerald', 'Emerald', 4, { robe: [0.39, 0.72, 0.85], cape: [0.12, 0.62, 1.25], swatch: 0x14915a }),
  item('robe', 'robe_midnight', 'Midnight', 7, { robe: [0.64, 0.62, 0.5], cape: [0.11, 0.55, 1.2], swatch: 0x1b2a6b }),
  item('robe', 'robe_gold', 'Gold', 10, { robe: [0.115, 0.78, 1.55], cape: [0.99, 0.8, 0.85], swatch: 0xe0a92a }),
  item('robe', 'robe_frost', 'Frost', 13, { robe: [0.56, 0.22, 1.95], cape: [0.57, 0.65, 1.3], swatch: 0xcfe9ff }),
  item('robe', 'robe_void', 'Void', 15, { robe: [0.79, 0.75, 0.62], cape: [0.86, 0.9, 1.1], swatch: 0x4a1a78 }),

  item('hat', 'hat_classic', 'Classic', 1, { blurb: 'Matches your robes' }),
  item('hat', 'hat_midnight', 'Midnight hat', 5, { hat: [0.66, 0.6, 0.42], swatch: 0x1a2250 }),
  item('hat', 'hat_circlet', 'Gold circlet', 8, { band: 'circlet', swatch: 0xffcf4a }),
  item('hat', 'hat_crown', 'Crown', 12, { band: 'crown', swatch: 0xffcf4a }),

  item('staff', 'staff_element', 'Element', 1, { blurb: 'Your main element' }),
  item('staff', 'staff_ember', 'Ember', 3, { glow: 0xff7a22 }),
  item('staff', 'staff_frost', 'Frost', 9, { glow: 0x8fe6ff }),
  item('staff', 'staff_void', 'Void', 14, { glow: 0xb24cff }),

  item('trail', 'trail_none', 'None', 1, { blurb: 'Your spells as they are' }),
  item('trail', 'trail_gold', 'Gold sparks', 6, { trail: 0xffd25a }),
  item('trail', 'trail_frost', 'Frost sparks', 11, { trail: 0xaef0ff }),
  item('trail', 'trail_void', 'Void sparks', 18, { trail: 0xc070ff }),

  item('title', 'title_auto', 'By level', 1, { blurb: 'Your highest title' }),
  item('title', 'title_apprentice', 'Apprentice', 1),
  item('title', 'title_adept', 'Adept', 5),
  item('title', 'title_battlemage', 'Battlemage', 10),
  item('title', 'title_archmage', 'Archmage', 15),
  item('title', 'title_grand', 'Grand Archmage', 20),
];
export const COSMETIC = Object.fromEntries(COSMETICS.map(c => [c.id, c]));
export const DEFAULT_COSMETICS = Object.fromEntries(COSMETIC_SLOTS.map(s => [s, COSMETICS.find(c => c.slot === s).id]));
export const bySlot = (slot) => COSMETICS.filter(c => c.slot === slot);
// The unlocks a level-up can bring: everything above level 1 (the defaults and Apprentice are everyone's).
const UNLOCKS = COSMETICS.filter(c => c.level > 1).sort((a, b) => a.level - b.level);

const lvlOf = (level) => Math.max(1, Math.floor(Number(level) || 1));
// Every id a wizard at `level` may wear.
export const unlockedAt = (level) => COSMETICS.filter(c => c.level <= lvlOf(level)).map(c => c.id);
// What reaching exactly `level` unlocks.
export const unlocksOn = (level) => UNLOCKS.filter(c => c.level === lvlOf(level));
// The first unlock above `level` ({ id, name, slot, level }), or null past the last one.
export function nextUnlock(level) {
  const c = UNLOCKS.find(u => u.level > lvlOf(level));
  return c ? { id: c.id, name: c.name, slot: c.slot, level: c.level } : null;
}
// "Emerald robes", "Ember staff glow", "the Adept title": how a teaser names an unlock.
export function unlockLabel(c) {
  if (!c) return '';
  if (c.slot === 'robe') return `${c.name} robes`;
  if (c.slot === 'staff') return `${c.name} staff glow`;
  if (c.slot === 'title') return `the ${c.name} title`;
  return c.name;
}

// A clean { slot: id } from anything: known ids in their own slot, and (when `level` is given) only those unlocked by it. The
// defaults are dropped, so {} means "the defaults". Never throws.
export function sanitizeCosmetics(obj, level) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  const max = level == null ? Infinity : lvlOf(level);
  for (const slot of COSMETIC_SLOTS) {
    const id = obj[slot], c = typeof id === 'string' ? COSMETIC[id] : null;
    if (c && c.slot === slot && c.level <= max && id !== DEFAULT_COSMETICS[slot]) out[slot] = id;
  }
  return out;
}

// The title shown under a name: the equipped one, else the highest by level.
const TITLES = COSMETICS.filter(c => c.slot === 'title' && c.id !== 'title_auto');
export function titleFor(level, cos) {
  const t = cos?.title && COSMETIC[cos.title];
  if (t && t.slot === 'title' && t.id !== 'title_auto') return t.name;
  const L = lvlOf(level);
  return TITLES.filter(c => c.level <= L).pop()?.name || 'Apprentice';
}
export const trailColor = (id) => COSMETIC[id]?.trail ?? null;

// The level curve, used only when constants.js has no levelForXp / xpForLevel: about 300 XP for level 2, each level 25 more.
export const fallbackXpForLevel = (level) => { const n = lvlOf(level) - 1; return 300 * n + 25 * n * (n - 1) / 2; };
export function fallbackLevelForXp(xp) {
  let L = 1;
  while (fallbackXpForLevel(L + 1) <= (Number(xp) || 0) && L < 1000) L++;
  return L;
}

// Bot taunts (§3): the only lines a speech bubble shows; the client drops anything else. By situation, for the server's bots.
export const TAUNT_LINES = {
  kill: ['Too slow!', 'My fireball!', 'Back to the crypt!', 'Rattled you!', 'Bonk!', 'Not even close!'],
  multikill: ['Who\'s next?', 'Line up, line up!', 'Unstoppable bones!', 'That\'s a combo!'],
  death: ['Ow, my bones!', 'Lucky shot!', 'I\'ll be back!', 'Hey, no fair!', 'Ugh, again?'],
  dodge: ['Nice dodge!', 'Missed me!', 'Whoosh!', 'Over here!'],
  rune: ['Mine now!', 'Ooh, shiny!', 'Power up!'],
  spawn: ['Round two!', 'Fresh bones!', 'Again!'],
};
const ALL_TAUNTS = new Set(Object.values(TAUNT_LINES).flat());
export const isTauntLine = (s) => typeof s === 'string' && ALL_TAUNTS.has(s);
export const EMOTES = ['cheer', 'wave', 'taunt'];
