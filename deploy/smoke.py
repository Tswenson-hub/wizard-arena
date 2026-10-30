# Deploy smoke test: health check, page load, the spell builder renders, join the 4-player FFA (bots fill
# the empty seats), WebSocket traffic, no console errors.
# usage: python3 deploy/smoke.py <base url> [screenshot path]
#   python3 deploy/smoke.py http://localhost:3000
#   python3 deploy/smoke.py https://wizard-arena.onrender.com /tmp/wa-deploy/live.png
import asyncio, sys, time, urllib.request
from playwright.async_api import async_playwright

BASE = sys.argv[1].rstrip('/')
SHOT = sys.argv[2] if len(sys.argv) > 2 else None

def healthz():
    t = time.time()
    body = urllib.request.urlopen(BASE + '/healthz', timeout=120).read().decode().strip()
    return body, time.time() - t

async def main():
    body, dt = healthz()
    print(f'healthz: {body!r} in {dt:.1f}s')
    ok = body == 'ok'
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 720})
        errs, sockets, frames = [], [], {'sent': 0, 'recv': 0}
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        def on_ws(ws):
            sockets.append(ws.url)
            ws.on('framesent', lambda _: frames.__setitem__('sent', frames['sent'] + 1))
            ws.on('framereceived', lambda _: frames.__setitem__('recv', frames['recv'] + 1))
        pg.on('websocket', on_ws)
        t = time.time()
        await pg.goto(BASE + '/', timeout=120000)
        # Wait for main.js's own ready line, not just an enabled button: #joinBtn starts enabled in the HTML
        # until main.js runs, so a slow module load would otherwise let the check race ahead of the builder.
        await pg.wait_for_function("""() => { const s = document.querySelector('#loadStatus')?.textContent || '';
          return s.startsWith('Ready') || s.startsWith('Failed'); }""", timeout=120000)
        status = await pg.evaluate("document.querySelector('#loadStatus').textContent")
        if not status.startswith('Ready'):
            print('load failed:', status); ok = False
        print(f'page ready (assets loaded) in {time.time() - t:.1f}s')
        b_ = await pg.evaluate("""() => { const q = s => document.querySelectorAll('#joinPicker ' + s).length;
          const r = document.querySelector('#joinPicker .sb-main')?.getBoundingClientRect();
          return { rows: q('.sb-row'), cards: q('.sb-card'), presets: q('.sb-presets .sb-chip'), visible: !!r && r.width > 0 && r.height > 0 }; }""")
        builder_ok = b_['rows'] >= 4 and b_['cards'] >= 8 and b_['visible']
        print('spell builder:', b_, 'ok' if builder_ok else 'FAIL')
        ok = ok and builder_ok
        if SHOT:
            await pg.screenshot(path=SHOT.replace('.png', '-builder.png'), timeout=120000)
        await pg.fill('#nameInput', 'smoketest')
        await pg.click('#joinBtn')
        await pg.wait_for_function("window.__wa && window.__wa.local && window.__wa.players.size >= 4", timeout=30000)
        await pg.wait_for_timeout(3000)
        st = await pg.evaluate("""() => { const w = window.__wa; const ps = [...w.players.values()];
          return { players: ps.length, bots: ps.filter(p => p.bot).map(p => p.name + ' (' + p.bot + ')'),
                   status: document.querySelector('#status')?.textContent || '' }; }""")
        print('joined:', st)
        ok = ok and st['players'] >= 4 and len(st['bots']) >= 3
        if SHOT:
            await pg.screenshot(path=SHOT, timeout=120000); print('screenshot:', SHOT)
        await pg.wait_for_timeout(2000)
        connected = await pg.evaluate("window.__wa.net.connected")
        print('still connected after screenshot:', connected)
        await b.close()
    want = 'wss://' if BASE.startswith('https') else 'ws://'
    ws_ok = any(u.startswith(want) for u in sockets) and frames['recv'] > 10 and connected
    print('websockets:', sockets, frames, 'ok' if ws_ok else 'FAIL')
    print('console errors:', errs or 'none')
    ok = ok and ws_ok and not errs
    print('RESULT:', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)

asyncio.run(main())
