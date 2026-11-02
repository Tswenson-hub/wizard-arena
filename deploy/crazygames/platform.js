// CrazyGames SDK v3, Basic Launch (deploy-owned; only the CrazyGames build loads this file, see
// tools/build-crazygames.mjs). Everything is guarded: with no SDK, a failed init or any SDK error, the game runs as
// it does on our own site.
//
// gameplayStart / gameplayStop follow the page instead of hooks in main.js, so no game file depends on the SDK:
//   in gameplay  = the HUD is showing (#hud not .hidden), and none of these is up: the Esc menu (#clickToPlay), the
//                  "Click to play" prompt (#lockPrompt), the death screen (#deathScreen), the end-of-match recap (podium.js's
//                  body.recap-on, or match-ui.js's 2D #mRecap), the old results panel (#mEnd)
//   anything else (join screen, builder, Esc menu, lost pointer lock, dead, recap; Leave reloads the page) = stopped
// main.js may also call window.WA_PLATFORM.gameplay(true|false) directly; the first such call turns the DOM
// observer off for good.
// WA_PLATFORM.ready resolves (never rejects) once SDK.init() is done or failed: public/js/platform.js (the multiplayer
// wrappers the game imports, on both builds) waits on it before touching SDK.game / SDK.user.
(function () {
  const log = (...a) => { if (/[?&]cgdebug\b/.test(location.search)) console.info('[crazygames]', ...a); };
  let sdk = null, ready = false, playing = false, manual = false, loading = true;
  let settle;
  const readyP = new Promise(r => { settle = r; });

  function call(fn) {
    if (!ready) return;
    try { const r = fn(sdk); if (r && typeof r.catch === 'function') r.catch(e => log('call failed', e)); }
    catch (e) { log('call failed', e); }
  }
  function set(on) {
    on = !!on;
    if (on === playing) return;
    playing = on;
    log(on ? 'gameplayStart' : 'gameplayStop');
    call(s => on ? s.game.gameplayStart() : s.game.gameplayStop());
  }
  const hidden = (sel) => { const el = document.querySelector(sel); return !el || el.classList.contains('hidden'); };
  function fromDom() {
    if (manual) return;
    if (loading && !hidden('#hud')) stopLoading();
    set(!hidden('#hud') && hidden('#clickToPlay') && hidden('#lockPrompt') && hidden('#deathScreen') && hidden('#mRecap')
      && hidden('#mEnd') && !document.body.classList.contains('recap-on'));
  }
  function stopLoading() {
    if (!loading) return;
    loading = false; log('loadingStop'); call(s => s.game.loadingStop());
  }

  window.WA_PLATFORM = {
    name: 'crazygames',
    gameplay(on) { manual = true; set(on); },
    loadingDone: stopLoading,
    get sdk() { return ready ? sdk : null; },
    ready: readyP,
  };

  async function init() {
    const SDK = window.CrazyGames && window.CrazyGames.SDK;
    if (!SDK) { log('no SDK on the page'); settle(null); return; }
    try {
      await SDK.init();
      sdk = SDK; ready = true;
      log('init ok, environment', SDK.environment);
      // nothing reached the SDK before this point: start from "not playing", and only open loading if it's still on
      playing = false;
      if (loading) call(s => s.game.loadingStart());
      // main.js writes "Ready..." into #loadStatus once the assets are in: that's the end of loading
      const st = document.getElementById('loadStatus');
      if (st) {
        const check = () => { if (/^Ready/.test(st.textContent || '')) stopLoading(); };
        new MutationObserver(check).observe(st, { childList: true, characterData: true, subtree: true });
        check();
      }
      fromDom();
    } catch (e) { log('init failed, running without the SDK', e); }
    settle(ready ? sdk : null);
  }

  function observe() {
    new MutationObserver(fromDom).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    init();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe); else observe();
})();
