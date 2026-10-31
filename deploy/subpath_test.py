# The CrazyGames build, played from a subpath: every request stays under the page's folder (an absolute URL would
# escape it), nothing 404s, the socket reaches the configured server, a match starts with bots, the SDK shim's
# gameplayStart / gameplayStop fire, no console errors.
# It also measures the initial download the way CrazyGames does: bytes from load start to the first gameplayStart
# (and at "Ready"), against the 20 MB target (CrazyGames: 50 MB desktop, 20 MB for the mobile homepage).
# usage: python3 deploy/subpath_test.py <page url> [screenshot path] [--block-sdk] [--max-mb 20]
#   --block-sdk: the SDK script fails to load; the game must still play (the shim is guarded)
#   --max-mb N: FAIL when the initial download is over N MB (default: report only)
#   node tools/build-crazygames.mjs --server ws://localhost:4105 --out dist/crazygames-local --no-zip
#   PORT=4105 node server.js &  node tools/serve-subpath.mjs dist/crazygames-local 4199 /game &
#   python3 deploy/subpath_test.py http://localhost:4199/game/ /tmp/wa-deploy/subpath.png
import asyncio, sys, time
from urllib.parse import urlparse
from playwright.async_api import async_playwright

BLOCK_SDK = '--block-sdk' in sys.argv
MAX_MB = float(sys.argv[sys.argv.index('--max-mb') + 1]) if '--max-mb' in sys.argv else None
args = [a for i, a in enumerate(sys.argv[1:], 1) if a != '--block-sdk' and a != '--max-mb' and sys.argv[i - 1] != '--max-mb']
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
        # bytes per finished response (encoded size on the wire); `marks` snapshots the running total
        dl = {'bytes': 0, 'n': 0, 'by': {}}
        marks = {}
        async def on_done(r):
            try:
                sz = (await r.sizes())['responseBodySize']
            except Exception:
                return
            dl['bytes'] += sz; dl['n'] += 1
            u = urlparse(r.url)
            key = u.netloc if u.netloc != page_url.netloc else (u.path[len(folder):].split('/')[0] or 'index.html')
            if key == 'models': key = '/'.join(u.path[len(folder):].split('/')[:2])
            dl['by'][key] = dl['by'].get(key, 0) + sz
        pg.on('requestfinished', lambda r: asyncio.ensure_future(on_done(r)))
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
            if m.text.startswith('[crazygames]'):
                cg.append(m.text)
                if 'gameplayStart' in m.text and 'start' not in marks: marks['start'] = (dl['bytes'], dl['n'])
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
        await pg.wait_for_timeout(300); marks['ready'] = (dl['bytes'], dl['n'])
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
    MB = lambda b: f'{b / 1048576:.1f} MB'
    for k, label in (('ready', 'at "Ready"'), ('start', 'at the first gameplayStart')):
        if k in marks: print(f'initial download {label}: {MB(marks[k][0])} in {marks[k][1]} responses')
    print(f'total downloaded this run: {MB(dl["bytes"])} in {dl["n"]} responses')
    print('by folder: ' + ', '.join(f'{k} {MB(v)}' for k, v in sorted(dl['by'].items(), key=lambda kv: -kv[1])[:10]))
    initial = marks.get('start', marks.get('ready', (dl['bytes'], 0)))[0]
    if MAX_MB is not None and initial > MAX_MB * 1048576:
        print(f'initial download {MB(initial)} is over the {MAX_MB:g} MB target'); ok = False
    ws_ok = bool(sockets) and frames['recv'] > 20
    starts = sum('gameplayStart' in c for c in cg)
    ok = ok and not escaped and not failed and ws_ok and not errs
    if cfg['sdk']: ok = ok and starts >= 1
    print('RESULT:', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)

asyncio.run(main())
