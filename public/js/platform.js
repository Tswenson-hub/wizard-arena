// Platform wrappers for rooms and invites (deploy-owned, round 17). The game imports this on both builds:
//   - the CrazyGames build loads the SDK and deploy/crazygames/platform.js (window.WA_PLATFORM), which runs SDK.init();
//     everything here waits for that, then calls SDK.game / SDK.user, each call guarded and in try/catch
//   - our own site has neither: invites are plain `?room=CODE` URLs and the rest are no-ops
// The invite param key is `room` on both: inviteParams { room: 'K7Q2' } on CrazyGames, ?room=K7Q2 here.
const log = (...a) => { if (/[?&]cgdebug\b/.test(location.search)) console.info('[platform]', ...a); };

let sdk = null;
export let onCrazyGames = false;

const readyP = (async () => {
  const shim = window.WA_PLATFORM;
  if (!shim || !shim.ready) return;
  // never hold the game up on a stuck SDK
  const s = await Promise.race([shim.ready, new Promise(r => setTimeout(() => r(null), 4000))]).catch(() => null);
  if (s && s.game) { sdk = s; onCrazyGames = true; log('SDK ready'); }
  else log('no SDK: our own site rules');
})();

// resolves once the SDK is up (or at once without it); never rejects
export function ready() { return readyP; }

function call(what, fn, fallback) {
  if (!sdk) return fallback;
  try { return fn(sdk); }
  catch (e) { log(what, 'failed', e); return fallback; }
}

const clean = (v) => {
  const s = String(v ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{3,8}$/.test(s) ? s : null;
};

// CrazyGames: launch straight into a fresh private room (a party leader's "play with friends")
export function isInstantMultiplayer() {
  return !!call('isInstantMultiplayer', s => s.game.isInstantMultiplayer, false);
}

// the room code this page was launched with: the SDK's invite params, else ?room= on our site
export function inviteRoom() {
  const fromSdk = call('inviteParams', s => (s.game.inviteParams && s.game.inviteParams.room) || s.game.getInviteParam?.('room'), null);
  if (clean(fromSdk)) return clean(fromSdk);
  try { return clean(new URLSearchParams(location.search).get('room')); } catch { return null; }
}

function siteLink(code) {
  const u = new URL(location.href);
  u.search = ''; u.hash = '';
  u.searchParams.set('room', code);
  return u.toString();
}

// a link friends can open to land in this room
export async function inviteLink(code) {
  code = clean(code);
  if (!code) return null;
  if (sdk) {
    try {
      const link = await sdk.game.inviteLink({ room: code });
      if (typeof link === 'string' && link) return link;
    } catch (e) { log('inviteLink failed', e); }
  }
  return siteLink(code);
}

// call on every room change; room = the private code (null in a public room)
export function updateRoom({ roomId, isJoinable, room } = {}) {
  const params = clean(room) ? { room: clean(room) } : {};
  call('updateRoom', s => s.game.updateRoom?.({ roomId: String(roomId ?? ''), isJoinable: !!isJoinable, inviteParams: params }));
}

export function leftRoom() { call('leftRoom', s => s.game.leftRoom?.()); }

// a friend's invite clicked while already in the game: fn(code). Returns a function that removes the listener.
export function onJoinRoom(fn) {
  let off = false, listener = null;
  readyP.then(() => {
    if (off || !sdk) return;
    listener = (params) => {
      const code = clean(params && params.room);
      log('join room', params);
      if (code) fn(code);
    };
    call('addJoinRoomListener', s => s.game.addJoinRoomListener?.(listener));
  });
  return () => {
    off = true;
    if (listener) call('removeJoinRoomListener', s => s.game.removeJoinRoomListener?.(listener));
  };
}

// the CrazyGames username, or null for a guest / no SDK
export async function getUsername() {
  await readyP;
  if (!sdk || !sdk.user) return null;
  try {
    if (sdk.user.isUserAccountAvailable === false) return null;
    const u = await sdk.user.getUser();
    return (u && typeof u.username === 'string' && u.username.trim()) || null;
  } catch (e) { log('getUser failed', e); return null; }
}

// CrazyGames' own invite button (deprecated in their docs, still listed); no-ops elsewhere
export function showInviteButton(code) {
  code = clean(code);
  if (code) call('showInviteButton', s => s.game.showInviteButton?.({ room: code }));
}
export function hideInviteButton() { call('hideInviteButton', s => s.game.hideInviteButton?.()); }

// a celebration moment (1st on the podium)
export function happytime() { call('happytime', s => s.game.happytime?.()); }
