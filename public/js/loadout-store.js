// Round 11: the player's loadout, voice and saved custom loadouts in localStorage (every access guarded: a private
// window or blocked storage just means nothing is remembered). Whatever comes back is sanitized.
import * as C from '../shared/constants.js';

const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } };
const json = (k) => { try { return JSON.parse(get(k)); } catch { return null; } };

export const MAX_SAVED = 3;
export const loadLoadout = () => C.sanitizeLoadout(json('wizardLoadout')) || { ...C.DEFAULT_LOADOUT };
export const saveLoadout = (lo) => { const c = C.sanitizeLoadout(lo); if (c) set('wizardLoadout', JSON.stringify(c)); return c; };
export const loadVoice = () => C.sanitizeVoice(get('wizardVoice'));
export const saveVoice = (v) => set('wizardVoice', C.sanitizeVoice(v));
// [{ name, loadout }], at most MAX_SAVED, bad entries dropped.
export function loadSaved() {
  const list = json('wizardLoadouts');
  return (Array.isArray(list) ? list : []).map(e => ({ name: String(e?.name || 'Custom').slice(0, 24), loadout: C.sanitizeLoadout(e?.loadout) }))
    .filter(e => e.loadout).slice(0, MAX_SAVED);
}
export function saveSaved(list) {
  const clean = (Array.isArray(list) ? list : []).map(e => ({ name: String(e?.name || 'Custom').slice(0, 24), loadout: C.sanitizeLoadout(e?.loadout) }))
    .filter(e => e.loadout).slice(0, MAX_SAVED);
  set('wizardLoadouts', JSON.stringify(clean));
  return clean;
}
