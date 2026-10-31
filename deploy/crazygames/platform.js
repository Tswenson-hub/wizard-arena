// CrazyGames SDK v3, Basic Launch (deploy-owned; only the CrazyGames build loads this file, see
// tools/build-crazygames.mjs). Everything is guarded: with no SDK, a failed init or any SDK error, the game runs as
// it does on our own site.
//
// gameplayStart / gameplayStop follow the page instead of hooks in main.js, so no game file depends on the SDK:
//   in gameplay  = the HUD is showing (#hud not .hidden), neither the pause menu (#clickToPlay) nor the
//                  "Click to play" prompt (#lockPrompt) is up, and the match results aren't (#mEnd)
//   anything else (join screen, builder, pause, lost pointer lock, results) = stopped
// main.js may also call window.WA_PLATFORM.gameplay(true|false) directly; the first such call turns the DOM
// observer off for good.
(function () {
  const log = (...a) => { if (/[?&]cgdebug\b/.test(location.search)) console.info('[crazygames]', ...a); };
  let sdk = null, ready = false, playing = false, manual = false, loading = true;

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
    set(!hidden('#hud') && hidden('#clickToPlay') && hidden('#lockPrompt') && hidden('#mEnd'));
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
  };

  async function init() {
    const SDK = window.CrazyGames && window.CrazyGames.SDK;
    if (!SDK) { log('no SDK on the page'); return; }
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
  }

  function observe() {
    new MutationObserver(fromDom).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    init();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe); else observe();
})();
