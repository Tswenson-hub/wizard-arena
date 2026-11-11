# Deploy smoke test: health check, page load, the spell builder renders, join the 4-player FFA (bots fill
# the empty seats), WebSocket traffic, no console errors.
# usage: python3 deploy/smoke.py <base url> [screenshot path] [--swiftshader]
#   python3 deploy/smoke.py http://localhost:3000
#   python3 deploy/smoke.py https://wizard-arena-76od.onrender.com /tmp/wa-deploy/live.png
import asyncio, json, sys, time, urllib.request
from playwright.async_api import async_playwright

# GPU by default (ANGLE on Metal: macOS); --swiftshader for software GL (slow: it can stall several seconds compiling the castle's shaders)
GL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] if '--swiftshader' in sys.argv else ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
ARGS = [a for a in sys.argv[1:] if a != '--swiftshader']
BASE = ARGS[0].rstrip('/')
SHOT = ARGS[1] if len(ARGS) > 1 else None

def healthz():
    t = time.time()
    body = urllib.request.urlopen(BASE + '/healthz', timeout=120).read().decode().strip()
    return body, time.time() - t

async def main():
    body, dt = healthz()
    print(f'healthz: {body!r} in {dt:.1f}s')
    ok = body == 'ok' or body.startswith('ok ')   # round 17: 'ok rooms=N humans=N bots=N'
    async with async_playwright() as p:
        b = await p.chromium.launch(args=GL_ARGS)
        pg = await b.new_page(viewport={'width': 1280, 'height': 720})
        errs, sockets, frames = [], [], {'sent': 0, 'recv': 0}
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        last_snap = {}
        def on_frame(payload):
            frames['recv'] += 1
            if isinstance(payload, str) and payload.startswith('{"t":"snap"'):
                last_snap['players'] = json.loads(payload)['players']
        def on_ws(ws):
            sockets.append(ws.url)
            ws.on('framesent', lambda _: frames.__setitem__('sent', frames['sent'] + 1))
            ws.on('framereceived', on_frame)
        pg.on('websocket', on_ws)
        t = time.time()
        # round 21: a fresh profile is a first visit and joins by itself; ?builder=1 keeps the builder for these checks
        await pg.goto(BASE + '/?builder=1', timeout=120000)
        # Wait for main.js's own ready line, not just an enabled button: #joinBtn starts enabled in the HTML
        # until main.js runs, so a slow module load would otherwise let the check race ahead of the builder.
        await pg.wait_for_function("""() => { const s = document.querySelector('#loadStatus')?.textContent || '';
          return s.startsWith('Ready') || s.startsWith('Failed'); }""", timeout=120000)
        status = await pg.evaluate("document.querySelector('#loadStatus').textContent")
        if not status.startswith('Ready'):
            print('load failed:', status); ok = False
        print(f'page ready (assets loaded) in {time.time() - t:.1f}s')
        b_ = await pg.evaluate("""() => { const q = s => document.querySelectorAll('#joinPicker ' + s).length;
          const r = document.querySelector('#joinPicker')?.getBoundingClientRect();
          return { rows: q('.sb-row'), cards: q('.sb-card'), presets: q('.sb-presets .sb-chip'), visible: !!r && r.width > 0 && r.height > 0 }; }""")
        builder_ok = b_['rows'] >= 4 and b_['cards'] >= 8 and b_['visible']
        print('spell builder:', b_, 'ok' if builder_ok else 'FAIL')
        ok = ok and builder_ok
        if SHOT:
            await pg.screenshot(path=SHOT.replace('.png', '-builder.png'), timeout=120000)
        # first visit: the "How to play" card (round 14) covers the builder until it's dismissed
        if await pg.locator('.htp-close').count():
            await pg.click('.htp-close'); print('how-to-play card: dismissed')
        await pg.fill('#nameInput', 'smoketest')
        await pg.click('#joinBtn')
        # the server's own snapshots say who's in the match (window.__wa, the old debug hook, is off since round 14)
        await pg.wait_for_function("!document.querySelector('#hud').classList.contains('hidden')", timeout=30000)
        for _ in range(60):
            if len(last_snap.get('players', [])) >= 4: break
            await pg.wait_for_timeout(500)
        await pg.wait_for_timeout(2000)
        ps = last_snap.get('players', [])
        st = { 'players': len(ps), 'bots': [f"{p.get('name')} ({p['bot']})" for p in ps if p.get('bot')],
               'status': await pg.evaluate("document.querySelector('#status')?.textContent || ''") }
        print('joined:', st)
        ok = ok and st['players'] >= 4 and len(st['bots']) >= 3
        if SHOT:
            await pg.screenshot(path=SHOT, timeout=120000); print('screenshot:', SHOT)
        # any frame within 8 s: a headless page can stall a couple of seconds compiling shaders after the screenshot
        before, waited = frames['recv'], 0
        while frames['recv'] <= before and waited < 8000:
            await pg.wait_for_timeout(500); waited += 500
        await pg.wait_for_timeout(1000)
        connected = frames['recv'] > before
        print('still connected after screenshot:', connected, f"({frames['recv'] - before} frames, first after {waited / 1000:.1f} s)")
        # round 21: a first visit (a fresh context, no ?builder) is in a match with no click, as the Pyromancer, with Easy bots.
        # The first player leaves first: a first-timer joining other humans keeps their room's difficulty, by design.
        await pg.close(); await asyncio.sleep(1.5)
        ctx2 = await b.new_context(viewport={'width': 1280, 'height': 720})
        pg2 = await ctx2.new_page()
        pg2.on('pageerror', lambda e: errs.append(str(e)))
        pg2.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        bots2 = set()
        def on_ws2(ws):
            def on_frame(f):
                if isinstance(f, str) and f.startswith('{"t":"snap"'):
                    for p_ in json.loads(f)['players']:
                        if p_.get('bot'): bots2.add(p_['bot'])
            ws.on('framereceived', on_frame)
        pg2.on('websocket', on_ws2)
        t = time.time()
        await pg2.goto(BASE + '/', timeout=120000)
        try:
            await pg2.wait_for_function("!document.querySelector('#hud').classList.contains('hidden')", timeout=60000)
            first_in = time.time() - t
            await pg2.wait_for_timeout(3500)
            fv = await pg2.evaluate("({ prompt: !document.querySelector('#lockPrompt').classList.contains('hidden'), join: getComputedStyle(document.querySelector('#join')).display })")
            first_ok = fv['prompt'] and fv['join'] == 'none' and bots2 == {'easy'}
            print(f'first visit: in the match with no click in {first_in:.1f}s, prompt {fv["prompt"]}, bots {sorted(bots2)}', 'ok' if first_ok else 'FAIL')
        except Exception as e:
            first_ok = False; print('first visit: FAIL', e)
        ok = ok and first_ok
        if SHOT:
            await pg2.screenshot(path=SHOT.replace('.png', '-first.png'), timeout=120000)
        await ctx2.close()
        await b.close()
    want = 'wss://' if BASE.startswith('https') else 'ws://'
    ws_ok = any(u.startswith(want) for u in sockets) and frames['recv'] > 10 and connected
    print('websockets:', sockets, frames, 'ok' if ws_ok else 'FAIL')
    print('console errors:', errs or 'none')
    ok = ok and ws_ok and not errs
    print('RESULT:', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)

asyncio.run(main())
