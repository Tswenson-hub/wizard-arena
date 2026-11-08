// Round 20: graphics quality (CrazyGames: "The game seems very laggy"; it must run on 4 GB Chromebooks). Three tiers:
//   high:   pixel ratio up to 2, antialiasing, shadows, effect lights, every particle, grass, full auras
//   normal: pixel ratio up to 1.5, antialiasing, small shadows, effect lights, most particles, grass, cheaper auras
//   low:    pixel ratio 1, no antialiasing, no shadows, no effect lights, a third of the particles, no grass, no auras
// The setting (Graphics in the Esc menu) is auto | high | normal | low, saved with the other settings. Auto starts on the
// tier it last settled on (else normal), drops a tier when the average frame over 3 s is slower than 22 ms (checked the
// whole match, so a fight that gets heavy after 30 s still counts) and rises one, carefully, after 30 s at a steady 60.
// ?low forces low.
//
// Antialiasing, shadows on or off and the effect lights can't change without a new context or recompiling every shader
// (a long hitch), so they follow the tier we *start* on (`boot`). A drop mid-match lowers the pixel ratio, thins the
// particles and updates the shadows at 15 Hz instead; the next visit starts on the lower tier properly.
//
// Other modules read `params()` when they build and listen with `onQuality(fn)` (fn(tier, params) on every change):
// world.js (grass, the shadow map's size), looks.js (auras).
export const TIERS = {
  high:   { dpr: 2,   antialias: true,  shadows: 'on',    shadowSize: 2048, fxLights: true,  particles: 1,    grass: true,  auras: 'full' },
  normal: { dpr: 1.5, antialias: true,  shadows: 'small', shadowSize: 1024, fxLights: true,  particles: 0.65, grass: true,  auras: 'cheap' },
  low:    { dpr: 1,   antialias: false, shadows: 'off',   shadowSize: 512,  fxLights: false, particles: 0.3,  grass: false, auras: 'off' },
};
const ORDER = ['low', 'normal', 'high'];
export const SETTINGS = ['auto', 'high', 'normal', 'low'];
const KEY = 'waGraphics', AUTO_KEY = 'waAutoTier';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const forcedLow = (() => { try { return new URLSearchParams(location.search).has('low'); } catch { return false; } })();

let setting = SETTINGS.includes(store.get(KEY)) ? store.get(KEY) : 'auto';
const startTier = () => forcedLow ? 'low' : setting !== 'auto' ? setting : (TIERS[store.get(AUTO_KEY)] ? store.get(AUTO_KEY) : 'normal');
let tier = startTier();
// what the tier we started on decided for good (see the top)
export const boot = Object.freeze({ tier, ...TIERS[tier] });
const listeners = new Set();

export const getTier = () => tier;
export const getSetting = () => setting;
export const isForcedLow = () => forcedLow;
// the tier's numbers, with what only `boot` decides
export function params(t = tier) {
  const p = { ...TIERS[t] };
  p.antialias = boot.antialias;
  p.fxLights = boot.fxLights && p.fxLights;
  // shadows exist only if we booted with them; a lower tier then updates them less often instead of turning them off
  p.shadowsOn = boot.shadows !== 'off';
  p.shadowEvery = !p.shadowsOn ? 0 : p.shadows === 'off' ? 4 : 1;
  return p;
}
export function onQuality(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function setTier(t, why) {
  if (t === tier || !TIERS[t]) return;
  tier = t;
  if (setting === 'auto' && !forcedLow) store.set(AUTO_KEY, t);
  auto.reset();
  for (const fn of listeners) { try { fn(tier, params(), why); } catch (e) { console.warn('[quality]', e); } }
}
// The Esc menu's Graphics (and a cloud save). Auto keeps the current tier and lets the sampler move it.
export function setSetting(v) {
  if (!SETTINGS.includes(v) || forcedLow) return;
  setting = v;
  store.set(KEY, v);
  if (v !== 'auto') setTier(v, 'setting');
  auto.rises = 0;
}

// ---------------------------------------------------------------- auto
// sample(ms) once a frame while a match is being played (not on the join screen, in a menu, or in a hidden tab).
const DROP_MS = 22, WINDOW_S = 3, RISE_MS = 17.6, RISE_S = 30, WARMUP_S = 4, MAX_RISES = 1;
const auto = {
  sum: 0, n: 0, win: 0, good: 0, skip: WARMUP_S, rises: 0, dropped: null,
  reset() { this.sum = 0; this.n = 0; this.win = 0; this.good = 0; this.skip = WARMUP_S; },
};
export function sample(ms) {
  if (setting !== 'auto' || forcedLow) return;
  if (!(ms > 0) || ms > 250) return;   // a stall (a tab switch, a GC pause) isn't the frame rate
  const s = ms / 1000;
  if (auto.skip > 0) { auto.skip -= s; return; }
  auto.sum += ms; auto.n++; auto.win += s;
  if (auto.win < WINDOW_S) return;
  const avg = auto.sum / auto.n;
  auto.sum = 0; auto.n = 0; auto.win = 0;
  const i = ORDER.indexOf(tier);
  if (avg > DROP_MS && i > 0) { auto.dropped = tier; setTier(ORDER[i - 1], `avg ${avg.toFixed(1)} ms`); return; }
  // rising: only after RISE_S of frames at the display's 60, never back to a tier we dropped from, and once a session
  auto.good = avg < RISE_MS ? auto.good + WINDOW_S : 0;
  if (auto.good >= RISE_S && i < ORDER.length - 1 && ORDER[i + 1] !== auto.dropped && auto.rises < MAX_RISES && ORDER[i + 1] !== 'high') {
    auto.rises++; setTier(ORDER[i + 1], `steady ${avg.toFixed(1)} ms`);
  }
}
export const debug = () => ({ tier, setting, boot: boot.tier, avgWindow: auto.n ? auto.sum / auto.n : null, rises: auto.rises, dropped: auto.dropped });
