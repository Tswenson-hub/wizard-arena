# The CrazyGames build, played from a subpath: every request stays under the page's folder (an absolute URL would
# escape it), nothing 404s, the socket reaches the configured server, a match starts with bots, the SDK shim's
# gameplayStart / gameplayStop fire, no console errors.
# It also measures the initial download the way CrazyGames does: bytes from load start to the first gameplayStart
# (and at "Ready"), against the 20 MB target (CrazyGames: 50 MB desktop, 20 MB for the mobile homepage).
# Rooms (round 17): browser A creates a private match, browser B joins it with the code box, and browser C opens the
# invite link (`?room=CODE`, from A's "Invite friends" card) on --site, our own server's page; all three must land in the
# same room, see each other in the server's snapshots, and the public join must not see them.
# usage: python3 deploy/subpath_test.py <page url> [screenshot path] [--block-sdk] [--max-mb 20] [--swiftshader]
#                                       [--no-rooms] [--site http://localhost:4105/]
#   --no-rooms: only the single-player checks
#   --site URL: our own site (the same game server as the build's config.js) for the ?room= check; default: skipped
#   --block-sdk: the SDK script fails to load; the game must still play (the shim is guarded)
#   --max-mb N: FAIL when the initial download is over N MB (default: report only)
#   node tools/build-crazygames.mjs --server ws://localhost:4105 --out dist/crazygames-local --no-zip
#   PORT=4105 node server.js &  node tools/serve-subpath.mjs dist/crazygames-local 4199 /game &
#   python3 deploy/subpath_test.py http://localhost:4199/game/ /tmp/wa-deploy/subpath.png
import asyncio, re, sys, time
from urllib.parse import urlparse
from playwright.async_api import async_playwright

# GPU by default (ANGLE on Metal: macOS); --swiftshader for software GL (slow: it can stall several seconds compiling the castle's shaders)
GL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] if '--swiftshader' in sys.argv else ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
BLOCK_SDK = '--block-sdk' in sys.argv
ROOMS = '--no-rooms' not in sys.argv
MAX_MB = float(sys.argv[sys.argv.index('--max-mb') + 1]) if '--max-mb' in sys.argv else None
SITE = sys.argv[sys.argv.index('--site') + 1] if '--site' in sys.argv else None
VALUED = ('--max-mb', '--site')
args = [a for i, a in enumerate(sys.argv[1:], 1) if a not in ('--block-sdk', '--swiftshader', '--no-rooms') + VALUED and sys.argv[i - 1] not in VALUED]
PAGE = args[0]
SHOT = args[1] if len(args) > 1 else None
page_url = urlparse(PAGE)
folder = page_url.path if page_url.path.endswith('/') else page_url.path.rsplit('/', 1)[0] + '/'

# ---- rooms: one browser per player (separate contexts = separate localStorage, like separate people)
async def player(b, url, name, errs, first=False):
    # round 21: a fresh context is a first visit (the page joins by itself); the builder-driven players ask for ?builder=1
    if not first and 'room=' not in url: url += ('&' if '?' in url else '?') + 'builder=1'
    ctx = await b.new_context(viewport={'width': 1280, 'height': 720})
    await ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=f'{urlparse(url).scheme}://{urlparse(url).netloc}')
    pg = await ctx.new_page()
    seen = {'names': set(), 'frames': 0}
    def on_ws(ws):
        def on_frame(f):
            seen['frames'] += 1
            if isinstance(f, str) and '"name"' in f:
                for m in re.finditer(r'"name":"([^"]{1,24})"', f): seen['names'].add(m.group(1))
                for m in re.finditer(r'"bot":"(easy|normal|hard)"', f): seen.setdefault('bots', set()).add(m.group(1))
        ws.on('framereceived', on_frame)
    pg.on('websocket', on_ws)
    pg.on('pageerror', lambda e: errs.append(f'{name}: {e}'))
    pg.on('console', lambda m: errs.append(f'{name}: {m.text}') if m.type == 'error' and not (BLOCK_SDK and 'crazygames-sdk' in m.text + str(m.location)) else None)
    if BLOCK_SDK: await pg.route('**/crazygames-sdk-v3.js', lambda r: r.abort())
    await pg.goto(url, timeout=120000)
    # Ready, or already in game: an invite (?room=) auto-joins without waiting at the builder
    await pg.wait_for_function("(document.querySelector('#loadStatus')?.textContent || '').startsWith('Ready')"
                               " || !document.querySelector('#hud').classList.contains('hidden')", timeout=120000)
    if await pg.locator('.htp-close').count(): await pg.click('.htp-close')
    return ctx, pg, seen

async def in_game(pg):
    await pg.wait_for_function("!document.querySelector('#hud').classList.contains('hidden')", timeout=30000)

async def chip(pg, timeout=15000):
    try:
        await pg.wait_for_selector('#roomChip .wr-code', timeout=timeout)
    except Exception:
        return None
    return await pg.evaluate("({ code: document.querySelector('#roomChip .wr-code').textContent.trim(), n: document.querySelector('#roomChip .wr-n').textContent.trim() })")

async def rooms(b):
    ok, errs = True, []
    def check(cond, label):
        nonlocal ok
        print(('  ok  ' if cond else '  FAIL ') + label)
        ok = ok and bool(cond)
    print('rooms:')
    sep = '&' if '?' in PAGE else '?'
    # A: Create private match
    ca, a, sa = await player(b, PAGE + sep + 'cgdebug', 'A', errs)
    await a.fill('#nameInput', 'hostA')
    await a.click('.sb-room-new'); await in_game(a)
    ra = await chip(a)
    check(ra and re.fullmatch(r'[A-HJKMNP-Z2-9]{4,5}', ra['code']), f'A created a private room: {ra}')
    if not ra: return False, errs
    code = ra['code']
    # the invite card: the link A would send (our ?room= link here; SDK.game.inviteLink on CrazyGames)
    await a.click('#roomChip .wr-invite')
    await a.wait_for_function("(document.querySelector('.wa-invite input')?.value || '').length > 0", timeout=10000)
    link = await a.evaluate("document.querySelector('.wa-invite input').value")
    # ours: ?room=CODE; the SDK's: ...&czy_invite_params=room%3DCODE
    check(f'room={code}' in link or f'room%3D{code}' in link, f'invite link: {link}')
    # B: the code box
    cb, bp, sb = await player(b, PAGE + sep + 'cgdebug', 'B', errs)
    await bp.fill('#nameInput', 'friendB')
    await bp.fill('.sb-room-code', code.lower())
    await bp.click('.sb-room-go'); await in_game(bp)
    rb = await chip(bp)
    check(rb and rb['code'] == code, f'B joined by code: {rb}')
    pages = [('A', a, sa), ('B', bp, sb)]
    # C: our own site with ?room=CODE joins at once, no click
    if SITE:
        cc, c, sc = await player(b, SITE.rstrip('/') + '/?room=' + code, 'C', errs)
        try:
            await in_game(c); rc = await chip(c)
        except Exception as e:
            rc = None; print('  C:', e)
        check(rc and rc['code'] == code, f'C joined from {SITE} ?room={code} without a click: {rc}')
        pages.append(('C', c, sc))
    await a.wait_for_timeout(3000)
    want = len(pages)
    counts = [await chip(p, 1000) for _, p, _ in pages]
    check(all(r and r['n'].startswith(f'{want}/4') for r in counts), f'every chip shows {want}/4: {[r and r["n"] for r in counts]}')
    names = {'A': 'hostA', 'B': 'friendB', 'C': None}
    for k, _, s in pages:
        others = [names[o] for o, _, _ in pages if o != k and names[o]]
        check(all(n in s['names'] for n in others), f'{k} sees {others} in the server frames ({s["frames"]} frames)')
    # a public join must not land in the private room
    cd, d, sd = await player(b, PAGE + sep + 'cgdebug', 'D', errs)
    await d.fill('#nameInput', 'publicD')
    await d.click('#joinBtn'); await in_game(d)
    await d.wait_for_timeout(3000)
    rd = await chip(d, 1000)
    check(rd is None, 'D (Play) is in a public room: no room chip')
    check('hostA' not in sd['names'] and 'friendB' not in sd['names'], 'D sees neither A nor B')
    if SHOT: await a.screenshot(path=SHOT.replace('.png', '-roomA.png')); await bp.screenshot(path=SHOT.replace('.png', '-roomB.png'))
    # a wrong code falls back to a public match with an error
    ce, e, se = await player(b, PAGE + sep + 'cgdebug', 'E', errs)
    bad = 'ZZZZ' if code != 'ZZZZ' else 'YYYY'
    await e.fill('.sb-room-code', bad); await e.click('.sb-room-go'); await in_game(e)
    try:
        await e.wait_for_selector('.wa-room-error', state='attached', timeout=8000)
        err = await e.evaluate("document.querySelector('.wa-room-error').textContent")
    except Exception:
        err = None
    check(err and bad in err, f'unknown code {bad}: {err!r}')
    # round 21: a first visit (a fresh context, no ?builder) is in a public match with no click, its fill bots Easy
    cf, f, sf = await player(b, PAGE + sep + 'cgdebug', 'F', errs, first=True)
    try:
        await in_game(f); await f.wait_for_timeout(3500)
        rf = await chip(f, 1000)
        fv = await f.evaluate("({ prompt: !document.querySelector('#lockPrompt').classList.contains('hidden'), join: getComputedStyle(document.querySelector('#join')).display })")
        check(rf is None and fv['prompt'] and fv['join'] == 'none' and sf.get('bots') == {'easy'}, f"F (first visit) is in a public match with no click, Easy bots: {fv}, bots {sorted(sf.get('bots', []))}")
    except Exception as ex:
        check(False, f'F (first visit): {ex}')
    for c in (ca, cb, cd, ce, cf) + ((cc,) if SITE else ()): await c.close()
    errs = [x for x in errs if 'WebSocket' not in x]   # closing a context mid-socket logs one
    check(not errs, f'no console errors in the room browsers: {errs or "none"}')
    return ok, errs

async def main():
    ok = True
    async with async_playwright() as p:
        b = await p.chromium.launch(args=GL_ARGS)
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
        await pg.goto(PAGE + sep + 'cgdebug&builder=1', timeout=120000)   # (round 21: ?builder keeps a fresh profile on the builder)
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
        rooms_ok = True
        if ROOMS: rooms_ok, _ = await rooms(b)
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
    ok = ok and not escaped and not failed and ws_ok and not errs and rooms_ok
    if cfg['sdk']: ok = ok and starts >= 1
    print('RESULT:', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)

asyncio.run(main())
