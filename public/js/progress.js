// Progression on the client (characters track, round 26): the player's progress view (level, XP, unlocks, equipped cosmetics,
// today's challenges), the post-match XP panel, the challenge toasts, the emotes on V and the bots' speech bubbles.
//
// Two halves:
// - The store (no DOM, usable before a match): getView(), subscribe(fn), equip(slot, id), joinFields(). select.js's Wardrobe and
//   challenge tracker read it. A guest's progress lives in localStorage (`wa-progress`, the server's shape) and rides in the join;
//   the equipped look (`wa-equipped`) is kept for everyone, so the join screen dresses the preview before the server answers.
// - mountProgress({ sfx, net, players, myId, me, taunts }) (main.js, by dynamic import): onMessage(msg) for every server message,
//   update(dt), levelTag(w) for the scoreboard. It reads (spells' shapes, requests.md round 26): welcome.progress, progress, xp,
//   challenge, look, snap rows' `lv`, emote, taunt, recap, matchPhase. It sends { t: 'emote', e } and { t: 'equip', equipped }.
// Everything is optional on the wire: without progress from the server nothing shows and nothing breaks.
import * as THREE from 'three';
import * as C from '../shared/constants.js';
import { LOOKS, lookEquipped } from '../shared/cosmetics.js';
import { BODY_TOP } from './looks.js';

const KEY_GUEST = 'wa-progress', KEY_EQ = 'wa-equipped', KEY_TAUNTS = 'wa-taunts';
const load = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: this visit only */ } };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// ---------------------------------------------------------------- levels (constants.js's, with a stand-in until they land)

const xpToNext = (L) => C.xpToNext?.(L) ?? 300 + 25 * (Math.max(1, L) - 1);
const xpForLevel = (L) => C.xpForLevel?.(L) ?? (() => { const n = Math.max(1, L) - 1; return 300 * n + 25 * n * (n - 1) / 2; })();
export function levelInfo(xp) {
  if (C.levelInfo) return C.levelInfo(xp);
  xp = Math.max(0, Math.floor(+xp || 0));
  let level = 1;
  while (xpForLevel(level + 1) <= xp && level < 999) level++;
  return { level, into: xp - xpForLevel(level), need: xpToNext(level) };
}
export const titleFor = (L) => C.titleFor?.(L) ?? 'Apprentice';
export const unlockList = () => (Array.isArray(C.UNLOCKS) ? C.UNLOCKS : []).filter(u => LOOKS[u.id]);
export const nextUnlockAt = (L) => unlockList().find(u => u.level > L) || null;

// ---------------------------------------------------------------- the store

// The view: spells' progressPublic shape, { xp, level, into, need, title, unlocks, equipped, challenges: { day, list }, next, account }.
let view = null, net = null;
const subs = new Set();
function normalize(p) {
  const xp = Math.max(0, Math.floor(+p?.xp || 0)), li = levelInfo(xp);
  const level = Number.isFinite(p?.level) ? p.level : li.level;
  return {
    xp, level, into: p?.into ?? li.into, need: p?.need ?? li.need, title: p?.title || titleFor(level),
    unlocks: Array.isArray(p?.unlocks) ? p.unlocks : unlockList().filter(u => u.level <= level).map(u => u.id),
    equipped: lookEquipped(p?.equipped), challenges: p?.challenges && Array.isArray(p.challenges.list) ? p.challenges : { day: null, list: [] },
    next: p?.next !== undefined ? p.next : nextUnlockAt(level), account: !!p?.account, fromServer: !!p?.fromServer,
  };
}
function localView() {
  const g = load(KEY_GUEST);
  const v = normalize(g || {});
  const eq = load(KEY_EQ);
  if (eq) v.equipped = lookEquipped(eq);
  v.equipped = Object.fromEntries(Object.entries(v.equipped).filter(([, id]) => v.unlocks.includes(id)));
  return v;
}
export function getView() { return (view ??= localView()); }
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
const emit = () => { for (const fn of subs) { try { fn(view); } catch (e) { console.warn('[progress]', e); } } };
// A progress from the server (welcome, progress, xp). A guest keeps it (the server computed it from what the join sent).
export function setProgress(p) {
  if (!p || typeof p !== 'object') return;
  view = normalize({ ...p, fromServer: true });
  save(KEY_EQ, view.equipped);
  if (!view.account) {
    const old = load(KEY_GUEST) || {};
    save(KEY_GUEST, { xp: view.xp, level: view.level, unlocks: view.unlocks, equipped: view.equipped,
      challenges: { day: view.challenges.day, list: view.challenges.list.map(({ id, n, goal, done }) => ({ id, n, goal, done })) },
      firstWinDay: p.firstWinDay ?? old.firstWinDay ?? null });
  }
  emit();
}
// The Wardrobe: wear `id` in `slot` (null: the default). Locked ids are refused. Shown at once; the server checks it again.
export function equip(slot, id) {
  const v = getView();
  if (id && (!LOOKS[id] || LOOKS[id].slot !== slot || !v.unlocks.includes(id))) return false;
  const eq = { ...v.equipped };
  if (id) eq[slot] = id; else delete eq[slot];
  view = { ...v, equipped: eq };
  save(KEY_EQ, eq);
  if (!v.account) { const g = load(KEY_GUEST); if (g) save(KEY_GUEST, { ...g, equipped: eq }); }
  net?.send?.({ t: 'equip', equipped: eq });
  mounted?.dressMe(eq);
  emit();
  return true;
}
// What the join carries: the look for everyone, a guest's whole progress (the server shows its level and merges it once on login).
export function joinFields() {
  const v = getView(), g = load(KEY_GUEST);
  return { equipped: v.equipped, ...(g && !v.account ? { progress: { ...g, equipped: v.equipped } } : {}) };
}

// The "Bot taunts" setting (the Esc menu's toggle, select.js): the bots' speech bubbles and their emotes. On by default.
export function tauntsEnabled() { try { return localStorage.getItem(KEY_TAUNTS) !== '0'; } catch { return true; } }
export function setTauntsEnabled(on) { try { localStorage.setItem(KEY_TAUNTS, on ? '1' : '0'); } catch { /* this visit only */ } }

// ---------------------------------------------------------------- in game

let mounted = null;
const EMOTE_KEYS = ['cheer', 'wave', 'taunt'];
const EMOTE_CD = 2.5;              // s between our emotes (the server's limit)
const BUBBLE_S = 2.8, BUBBLE_FAR = 38;
const XP_LABEL = { finish: 'Match finished', kills: 'Kills', podium: 'Podium', win: 'Victory', firstWin: 'First win of the day', challenge: 'Challenge' };
const PLACE = ['', '1st', '2nd', '3rd'];

export function mountProgress({ sfx, net: n, players, myId, me, taunts } = {}) {
  net = n;
  mounted?.destroy();
  if (!document.querySelector('link[data-progress-css]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = './css/progress.css'; l.dataset.progressCss = '1';
    document.head.appendChild(l);
  }
  const myIdOf = () => (typeof myId === 'function' ? myId() : myId);
  const meOf = () => (typeof me === 'function' ? me() : me) || players?.get?.(myIdOf());
  const tauntsOn = () => { try { return taunts == null ? tauntsEnabled() : typeof taunts === 'function' ? taunts() !== false : taunts !== false; } catch { return true; } };
  const toasts = Object.assign(document.createElement('div'), { className: 'wa-toasts' });
  document.body.appendChild(toasts);

  // ---- sounds (synthesized on sfx.ctx into the sfx bus, like callouts' stings: mute and the volume apply)
  function bell(notes, { vol = 0.2, gap = 0.08, len = 0.6 } = {}) {
    const ctx = sfx?.ctx, bus = sfx?.sfxBus;
    if (!ctx || !bus || ctx.state !== 'running') return;
    const t0 = ctx.currentTime + 0.01;
    notes.forEach((f, i) => {
      const at = t0 + i * gap;
      for (const [mult, g] of [[1, 1], [2, 0.28], [4, 0.06]]) {
        const o = ctx.createOscillator(), gain = ctx.createGain();
        o.type = mult === 1 ? 'sine' : 'triangle'; o.frequency.value = f * mult;
        gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(vol * g, at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0008, at + len + i * 0.04);
        o.connect(gain).connect(bus); o.start(at); o.stop(at + len + 0.15 + i * 0.04);
      }
    });
  }
  const sndTick = () => bell([1568], { vol: 0.05, len: 0.12 });
  const sndLevel = () => bell([523, 659, 784, 1047, 1319], { vol: 0.22, gap: 0.09, len: 0.9 });
  const sndChallenge = () => bell([880, 1175, 1568], { vol: 0.16, gap: 0.07 });

  // ---- toasts (a challenge done mid-match; an unlock)
  function toast(html, cls = '') {
    const el = document.createElement('div');
    el.className = 'wa-toast ' + cls; el.innerHTML = html;
    toasts.appendChild(el);
    requestAnimationFrame(() => el.classList.add('on'));
    setTimeout(() => { el.classList.remove('on'); setTimeout(() => el.remove(), 500); }, 4200);
    while (toasts.children.length > 3) toasts.firstChild.remove();
  }

  // ---- speech bubbles (bots' taunts): a canvas sprite over the nameplate (the nameplate's own program)
  const bubbles = [];
  const tauntLines = () => { const T = C.TAUNTS; return T && typeof T === 'object' ? new Set(Object.values(T).flat()) : null; };
  function bubble(w, text) {
    if (!w?.group) return;
    for (const b of bubbles) if (b.w === w) b.t = Math.max(b.t, BUBBLE_S - 0.2);   // the old one leaves
    const cv = document.createElement('canvas'), g = cv.getContext('2d');
    g.font = 'bold 40px "Trebuchet MS", sans-serif';
    const tw = Math.min(560, g.measureText(text).width), W = Math.ceil(tw + 64), H = 104;
    cv.width = W; cv.height = H;
    g.font = 'bold 40px "Trebuchet MS", sans-serif';
    g.fillStyle = 'rgba(255, 250, 238, 0.96)'; g.strokeStyle = 'rgba(40, 24, 8, 0.85)'; g.lineWidth = 5;
    const r = 26, bw = W - 6, bh = 72;
    g.beginPath();
    g.moveTo(3 + r, 3); g.arcTo(3 + bw, 3, 3 + bw, 3 + bh, r); g.arcTo(3 + bw, 3 + bh, 3, 3 + bh, r);
    g.lineTo(W / 2 + 14, 3 + bh); g.lineTo(W / 2 - 2, H - 4); g.lineTo(W / 2 - 12, 3 + bh);
    g.arcTo(3, 3 + bh, 3, 3, r); g.arcTo(3, 3, 3 + bw, 3, r); g.closePath();
    g.fill(); g.stroke();
    g.fillStyle = '#2a1a08'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, W / 2, 3 + bh / 2 + 1, tw);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    const k = 0.0078;     // (m per canvas px: about the nameplate's text size)
    sp.userData.size = [W * k, H * k];
    sp.center.set(0.5, 0);
    sp.renderOrder = 12;
    sp.position.y = (w.nameplate?.position?.y ?? BODY_TOP + 0.4) + 0.4;
    w.group.add(sp);
    bubbles.push({ w, sp, t: 0 });
  }
  function updateBubbles(dt, camera) {
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.t += dt;
      const gone = b.t >= BUBBLE_S || !b.w.group?.parent || b.w.dead;
      if (gone) { b.sp.removeFromParent(); b.sp.material.map.dispose(); b.sp.material.dispose(); bubbles.splice(i, 1); continue; }
      const pop = Math.min(1, b.t / 0.16), out = Math.max(0, (b.t - (BUBBLE_S - 0.35)) / 0.35);
      const s = (pop < 1 ? 0.6 + 0.4 * pop + Math.sin(pop * Math.PI) * 0.12 : 1);
      b.sp.scale.set(b.sp.userData.size[0] * s, b.sp.userData.size[1] * s, 1);
      b.sp.material.opacity = 1 - out;
      b.sp.position.y = (b.w.nameplate?.position?.y ?? BODY_TOP + 0.4) + 0.4;
      if (camera) b.sp.visible = b.w.group.position.distanceTo(camera.position) < BUBBLE_FAR && b.w.nameplate?.visible !== false;
    }
  }

  // ---- emotes on V (ours at once; the server tells the others)
  let emoteAt = -99, emoteI = 0;
  function playEmote(e) {
    const t = performance.now() / 1000, w = meOf();
    if (!w || t - emoteAt < EMOTE_CD) return false;
    if (!w.emote?.(e)) return false;
    emoteAt = t;
    net?.send?.({ t: 'emote', e });
    return true;
  }
  const onKey = (e) => {
    if (e.code !== 'KeyV' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
    if (!document.pointerLockElement || document.body.classList.contains('recap-on')) return;
    if (playEmote(EMOTE_KEYS[emoteI % EMOTE_KEYS.length])) emoteI++;
  };
  addEventListener('keydown', onKey);

  // ---- the post-match XP panel
  let xpMsg = null, panel = null, panelT = 0, wait = 0, live = false;
  const ord = (n) => PLACE[n] || `${n}th`;
  function itemText(it) {
    if (it.k === 'kills') return `${it.n ?? ''} kill${it.n === 1 ? '' : 's'}`;
    if (it.k === 'podium') return `${ord(it.place ?? it.n)} place`;
    if (it.k === 'challenge') {
      const c = (xpMsg?.progress?.challenges?.list || []).find(e => e.id === it.id) || (C.DAILY_POOL || []).find(e => e.id === it.id);
      return `Challenge: ${c?.text || 'complete'}`;
    }
    return XP_LABEL[it.k] || it.k;
  }
  const teaser = (next) => next ? `Next unlock: <b>${esc(next.name)}</b> at level ${next.level}` : 'Every unlock is yours';
  function challengeRows(list) {
    return (list || []).map(c => `<div class="xp-ch${c.done ? ' done' : ''}" data-id="${esc(c.id)}">
      <span class="xp-ch-text">${c.done ? '✓ ' : ''}${esc(c.text || c.id)}</span><span class="xp-ch-n">${Math.min(c.n, c.goal)}/${c.goal}</span>
      <i style="--k:${Math.min(1, c.n / Math.max(1, c.goal))}"></i></div>`).join('');
  }
  function openPanel(msg) {
    closePanel(true);
    const before = msg.before || {}, after = normalize(msg.progress || {});
    const items = Array.isArray(msg.items) ? msg.items : [];
    const el = document.createElement('div');
    el.className = 'xp-panel';
    el.innerHTML = `<button type="button" class="xp-x" title="Hide">×</button>
      <div class="xp-head"><span class="xp-lv">Level <b>${before.level ?? after.level}</b></span><span class="xp-title">${esc(titleFor(before.level ?? after.level))}</span>
        <span class="xp-gain">+<b>0</b> XP</span></div>
      <div class="xp-bar"><i></i><em></em></div>
      <div class="xp-items">${items.map((it, i) => `<div class="xp-item" data-i="${i}"><span>${esc(itemText(it))}</span><b>+${it.xp}</b></div>`).join('')}</div>
      <div class="xp-up" hidden></div>
      <div class="xp-next">${teaser(after.next)}</div>
      ${after.challenges.list.length ? `<div class="xp-chs"><div class="xp-chs-h">Daily challenges</div>${challengeRows(after.challenges.list)}</div>` : ''}`;
    document.body.appendChild(el);
    el.querySelector('.xp-x').addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });
    requestAnimationFrame(() => el.classList.add('on'));
    const gained = msg.gained ?? items.reduce((s, it) => s + (it.xp || 0), 0);
    panel = { el, msg, items, gained, after, from: before.xp ?? Math.max(0, after.xp - gained), shown: -1, level: before.level ?? levelInfo(before.xp ?? 0).level,
      ups: [...(msg.levelUps || [])], unlocked: [...(msg.unlocked || [])], t: 0 };
    panelT = 0;
    paintBar(panel.from);
  }
  function paintBar(xp) {
    const p = panel, li = levelInfo(xp);
    p.el.querySelector('.xp-bar i').style.width = `${Math.min(100, li.into / Math.max(1, li.need) * 100)}%`;
    p.el.querySelector('.xp-bar em').textContent = `${Math.floor(li.into)} / ${li.need} XP`;
    if (li.level !== p.level) {
      p.level = li.level;
      p.el.querySelector('.xp-lv b').textContent = li.level;
      p.el.querySelector('.xp-title').textContent = titleFor(li.level);
      levelUp(li.level);
    }
  }
  function levelUp(level) {
    const p = panel, up = p.el.querySelector('.xp-up');
    const got = (p.unlocked.length ? p.unlocked : unlockList()).filter(u => u.level === level);
    up.hidden = false;
    up.innerHTML = `<div class="xp-up-big">Level up! <b>${level}</b></div>${got.map(u => `<div class="xp-unlock" style="--sw:#${(LOOKS[u.id]?.swatch ?? 0xffd25a).toString(16).padStart(6, '0')}"><i></i>Unlocked: <b>${esc(u.name)}</b> <span>in the Wardrobe</span></div>`).join('')}`;
    up.classList.remove('pop'); void up.offsetWidth; up.classList.add('pop');
    p.el.classList.add('leveled');
    sndLevel();
  }
  // the panel's timeline: the lines come in one by one (0.45 s apart, from 0.5 s), the bar fills with each, the total counts up
  function updatePanel(dt) {
    const p = panel;
    if (!p) return;
    p.t += dt;
    const step = 0.45, n = p.items.length, shown = Math.min(n - 1, Math.floor((p.t - 0.5) / step));
    if (shown > p.shown) {
      for (let i = p.shown + 1; i <= shown; i++) p.el.querySelector(`.xp-item[data-i="${i}"]`)?.classList.add('in');
      p.shown = shown; sndTick();
    }
    const fillK = Math.max(0, Math.min(1, (p.t - 0.5) / Math.max(0.6, n * step + 0.3)));
    const ease = 1 - (1 - fillK) ** 2;
    const xp = p.from + p.gained * ease;
    paintBar(xp);
    p.el.querySelector('.xp-gain b').textContent = Math.round(p.gained * ease);
    if (fillK >= 1 && !p.done) { p.done = true; p.el.classList.add('done'); }
  }
  function closePanel(now) {
    const p = panel;
    if (!p) return;
    panel = null;
    if (now) { p.el.remove(); return; }
    p.el.classList.remove('on'); setTimeout(() => p.el.remove(), 400);
  }

  // ---- messages
  function onMessage(msg) {
    switch (msg?.t) {
      case 'welcome': live = false; if (msg.progress) setProgress(msg.progress); break;
      case 'progress': if (msg.progress) setProgress(msg.progress); break;
      case 'look': {
        const w = players?.get?.(msg.id);
        if (w) { if (msg.lv != null) w.setLevel?.(msg.lv, msg.title); if (msg.eq) w.setCosmetics?.(msg.eq); }
        break;
      }
      case 'snap':
        for (const s of msg.players || []) if (Number.isFinite(s.lv)) { const w = players?.get?.(s.id); if (w && w.lv !== s.lv) w.setLevel?.(s.lv); }
        break;
      case 'xp':
        xpMsg = msg;
        if (msg.progress) setProgress(msg.progress);
        wait = 1.8;     // the podium's recap comes 1.5 s after; open with it (or alone, if it doesn't)
        break;
      case 'recap': {
        if (xpMsg && wait > 0) wait = 0.35;
        // the podium (podium.js reads this same message next) shows each wizard's level and wears their cosmetics: filled in here
        // from the live wizards when the server's rows don't carry them
        for (const row of [...(msg.top || []), ...(msg.rest || [])]) {
          const w = row && players?.get?.(row.id);
          if (!w) continue;
          if (row.lv == null && Number.isFinite(w.lv)) row.lv = w.lv;
          if (row.eq == null && w.body?.cos) row.eq = { ...w.body.cos };
          row.title ??= w.title || undefined; row.persona ??= w.persona || undefined;
        }
        break;
      }
      case 'challenge': {
        const v = getView(), list = v.challenges.list.slice(), i = list.findIndex(c => c.id === msg.id);
        const was = i >= 0 ? list[i] : null;
        const c = { ...(was || {}), id: msg.id, text: msg.text ?? was?.text, n: msg.n ?? was?.n ?? 0, goal: msg.goal ?? was?.goal ?? 1, done: !!msg.done, xp: msg.xp ?? was?.xp };
        if (i >= 0) list[i] = c; else list.push(c);
        view = { ...v, challenges: { ...v.challenges, list } };
        emit();
        if (c.done && !was?.done) { toast(`<div class="t-h">Challenge complete!</div><div class="t-b">${esc(c.text || '')}</div>${c.xp ? `<div class="t-xp">+${c.xp} XP</div>` : ''}`, 'chal'); sndChallenge(); }
        break;
      }
      case 'emote': {
        const w = msg.id !== myIdOf() && EMOTE_KEYS.includes(msg.e) ? players?.get?.(msg.id) : null;
        if (w && (tauntsOn() || !(w.botLevel || w.persona))) w.emote?.(msg.e);   // (the toggle quiets the bots, not the players)
        break;
      }
      case 'taunt': {
        if (!tauntsOn() || typeof msg.text !== 'string' || msg.text.length > 60) break;
        const ok = tauntLines();
        if (ok && !ok.has(msg.text)) break;
        bubble(players?.get?.(msg.id), msg.text);
        break;
      }
      case 'matchPhase': {
        const ph = msg.match?.phase;
        if (ph === 'live' && panel) { live = true; setTimeout(() => { if (live) closePanel(); }, 1200); }
        if (ph !== 'live') live = false;
        break;
      }
      default: break;
    }
  }

  function update(dt, camera) {
    if (wait > 0 && (wait -= dt) <= 0 && xpMsg) { openPanel(xpMsg); xpMsg = null; }
    updatePanel(dt);
    updateBubbles(dt, camera);
  }

  mounted = {
    onMessage, update,
    levelTag: (w) => (Number.isFinite(w?.lv) ? `<span class="lvl" title="Level ${w.lv}">${w.lv}</span>` : ''),
    dressMe: (eq) => meOf()?.setCosmetics?.(eq),
    emote: playEmote, bubble: (id, text) => bubble(players?.get?.(id), text), toast,
    joinFields, getView, equip,
    _state: () => ({ panel: !!panel, panelT: panel?.t ?? null, bubbles: bubbles.length, waiting: wait, toasts: toasts.children.length }),
    destroy() { removeEventListener('keydown', onKey); closePanel(true); toasts.remove(); for (const b of bubbles) b.sp.removeFromParent(); bubbles.length = 0; mounted = null; },
  };
  return mounted;
}
