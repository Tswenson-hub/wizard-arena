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

// room codes: 4-5 characters of the server's alphabet (no 0 O 1 I L), case-insensitive
const clean = (v) => {
  const s = String(v ?? '').trim().toUpperCase();
  return /^[A-HJKMNP-Z2-9]{4,5}$/.test(s) ? s : null;
};

// ?room= on this page's own URL: our site's invite links, and window.WA_ROOM.join() (main.js), which reloads the page with
// ?room=CODE or ?room=new to switch rooms, inside the CrazyGames iframe too. It's newer than the SDK's launch params, so it wins.
function urlRoom() {
  let v = null;
  try { v = new URLSearchParams(location.search).get('room'); } catch { return null; }
  if (v && v.trim().toLowerCase() === 'new') return 'new';
  return clean(v);
}

// CrazyGames: launch straight into a fresh private room (a party leader's "play with friends"); false after a room switch
export function isInstantMultiplayer() {
  if (urlRoom()) return false;
  return !!call('isInstantMultiplayer', s => s.game.isInstantMultiplayer, false);
}

// the room to join on launch: ?room= on the URL (a code, or 'new'), else the SDK's invite params, else null
export function inviteRoom() {
  const own = urlRoom();
  if (own) return own;
  return clean(call('inviteParams', s => (s.game.inviteParams && s.game.inviteParams.room) || s.game.getInviteParam?.('room'), null));
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
