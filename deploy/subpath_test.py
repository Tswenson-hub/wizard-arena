# The CrazyGames build, played from a subpath: every request stays under the page's folder (an absolute URL would
# escape it), nothing 404s, the socket reaches the configured server, a match starts with bots, the SDK shim's
# gameplayStart / gameplayStop fire, no console errors.
# usage: python3 deploy/subpath_test.py <page url> [screenshot path] [--block-sdk]
#   --block-sdk: the SDK script fails to load; the game must still play (the shim is guarded)
#   node tools/build-crazygames.mjs --server ws://localhost:4105 --out dist/crazygames-local --no-zip
#   PORT=4105 node server.js &  node tools/serve-subpath.mjs dist/crazygames-local 4199 /game &
#   python3 deploy/subpath_test.py http://localhost:4199/game/ /tmp/wa-deploy/subpath.png
import asyncio, sys, time
from urllib.parse import urlparse
from playwright.async_api import async_playwright

BLOCK_SDK = '--block-sdk' in sys.argv
args = [a for a in sys.argv[1:] if a != '--block-sdk']
PAGE = args[0]
SHOT = args[1] if len(args) > 1 else None
page_url = urlparse(PAGE)
folder = page_url.path if page_url.path.endswith('/') else page_url.path.rsplit('/', 1)[0] + '/'

async def main():
    ok = True
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 720})
        errs, escaped, failed, sockets, cg = [], [], [], [], []
        frames = {'recv': 0}
        own = 0
        def on_req(r):
            nonlocal own
            u = urlparse(r.url)
            if u.netloc == page_url.netloc:
                own += 1
                if not u.path.startswith(folder): escaped.append(u.path)
        pg.on('request', on_req)
        if BLOCK_SDK:
            await pg.route('**/crazygames-sdk-v3.js', lambda r: r.abort())
        pg.on('response', lambda r: failed.append(f'{r.status} {r.url}') if r.status >= 400 else None)
        pg.on('requestfailed', lambda r: None if BLOCK_SDK and 'crazygames-sdk' in r.url else failed.append(f'failed {r.url} {r.failure}'))
        pg.on('pageerror', lambda e: errs.append(str(e)))
        def on_console(m):
            if m.text.startswith('[crazygames]'): cg.append(m.text)
            elif m.type == 'error' and not (BLOCK_SDK and 'crazygames-sdk' in m.text + str(m.location)): errs.append(m.text)
        pg.on('console', on_console)
        def on_ws(ws):
            sockets.append(ws.url)
            ws.on('framereceived', lambda _: frames.__setitem__('recv', frames['recv'] + 1))
        pg.on('websocket', on_ws)
        t = time.time()
        sep = '&' if '?' in PAGE else '?'
        await pg.goto(PAGE + sep + 'cgdebug', timeout=120000)
        await pg.wait_for_function("""() => { const s = document.querySelector('#loadStatus')?.textContent || '';
          return s.startsWith('Ready') || s.startsWith('Failed'); }""", timeout=120000)
        status = await pg.evaluate("document.querySelector('#loadStatus').textContent")
        print(f'load: {status!r} in {time.time() - t:.1f}s')
        ok = ok and status.startswith('Ready')
        cfg = await pg.evaluate("({ server: window.WA_SERVER, platform: window.WA_PLATFORM?.name, sdk: !!window.CrazyGames?.SDK, icon: !!document.querySelector('link[rel=icon]') })")
        print('config:', cfg)
        cards = await pg.evaluate("document.querySelectorAll('#joinPicker .sb-card').length")
        print('builder cards:', cards)
        ok = ok and cards >= 8
        # first visit: the "How to play" card (round 14) covers the builder until it's dismissed
        if await pg.locator('.htp-close').count():
            await pg.click('.htp-close'); print('how-to-play card: dismissed')
        await pg.fill('#nameInput', 'subpath')
        await pg.click('#joinBtn')
        await pg.wait_for_function("!document.querySelector('#hud').classList.contains('hidden')", timeout=30000)
        await pg.wait_for_timeout(4000)
        # headless Chromium can't lock the pointer, so the "Click to play" prompt is up: hide it to stand in for a locked
        # mouse and check the shim reports gameplay, then bring it back
        await pg.evaluate("for (const s of ['#clickToPlay', '#lockPrompt']) document.querySelector(s)?.classList.add('hidden')")
        await pg.wait_for_timeout(500)
        if SHOT: await pg.screenshot(path=SHOT, timeout=120000); print('screenshot:', SHOT)
        await pg.evaluate("document.querySelector('#lockPrompt')?.classList.remove('hidden')")
        await pg.wait_for_timeout(500)
        st = await pg.evaluate("document.querySelector('#status')?.textContent || ''")
        print('status line:', repr(st))
        await b.close()
    print(f'requests to the page host: {own}, outside {folder}: {escaped or "none"}')
    print('failed requests:', failed or 'none')
    print('websockets:', sockets, frames)
    print('sdk shim:', cg or 'no log')
    print('console errors:', errs or 'none')
    ws_ok = bool(sockets) and frames['recv'] > 20
    starts = sum('gameplayStart' in c for c in cg)
    ok = ok and not escaped and not failed and ws_ok and not errs
    if cfg['sdk']: ok = ok and starts >= 1
    print('RESULT:', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)

asyncio.run(main())
