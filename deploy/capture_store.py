# Store art for the CrazyGames submission: gameplay screenshots and the three covers, captured from the running game.
# usage: python3 deploy/capture_store.py <game url> [out dir=dist/store] [--title "Wizard Arena"] [--wait 12]
#   PORT=4105 node server.js &  python3 deploy/capture_store.py http://localhost:4105 dist/store
# It joins a free-for-all with bots (with ?debug, for window.__wa), then:
#   screens/  1920x1080 PNGs: overhead, ground level from 4 sides, the wall-walk (the highest spawn), and gameplay with the HUD
#             facing the nearest bot (several, a few seconds apart; keep the best)
#   covers/   landscape 1920x1080, portrait 800x1200, square 800x800 (PNG and JPG), in two variants (hero: our wizard up close;
#             vista: over the courtyard): a clean render (no HUD) under the title only, which is all CrazyGames allows on a
#             cover (no borders, logos or other text)
#   bg/       the clean renders behind the covers
# Camera shots wrap renderer.render to place the camera, so no game code is involved. Every position comes from the map's
# exports (C.SPAWN_POINTS, C.HEAL_SPOTS), so it follows the layout. Software rendering is slow: allow a few minutes.
# CrazyGames also wants a 15-20 s preview video in 1080p landscape AND portrait (2:3), no cursor, no sound, no UI chrome:
# record that from a real browser (OBS), not here.
import asyncio, base64, os, sys, time
from playwright.async_api import async_playwright

def opt(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
TITLE = opt('--title', 'Wizard Arena')
WAIT = float(opt('--wait', '12'))
pos = [a for i, a in enumerate(sys.argv[1:], 1) if not a.startswith('--') and not sys.argv[i - 1].startswith('--')]
URL = pos[0].rstrip('/')
OUT = pos[1] if len(pos) > 1 else 'dist/store'
for d in ('screens', 'covers', 'bg'): os.makedirs(os.path.join(OUT, d), exist_ok=True)

# runs in the page: the camera override and the map's geometry
HOOK = """() => {
  const wa = window.__wa;
  if (!wa.renderer.__capWrapped) {
    const render = wa.renderer.render.bind(wa.renderer);
    wa.renderer.render = (scene, cam) => {
      const c = window.__cap;
      if (c) { cam.position.set(...c.p); cam.lookAt(...c.l); if (c.fov) { cam.fov = c.fov; cam.updateProjectionMatrix(); } cam.updateMatrixWorld(); }
      render(scene, cam);
    };
    wa.renderer.__capWrapped = true;
  }
  const C = wa.C, pts = [...C.SPAWN_POINTS.map(s => ({ x: s[0], y: s[1] || 0, z: s[2] })), ...C.HEAL_SPOTS.map(h => ({ x: h.x, y: h.y || 0, z: h.z }))];
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  const R = Math.max(...pts.map(p => Math.hypot(p.x - cx, p.z - cz)));
  const high = [...pts].sort((a, b) => b.y - a.y)[0];
  return { cx, cz, R, high, arena: C.ARENA_RADIUS };
}"""

UI_OFF = "document.getElementById('__capcss') || document.head.insertAdjacentHTML('beforeend', '<style id=__capcss>body *{visibility:hidden!important} canvas{visibility:visible!important}</style>')"
UI_ON = "document.getElementById('__capcss')?.remove(); for (const s of ['#clickToPlay', '#lockPrompt']) document.querySelector(s)?.classList.add('hidden')"

COVER_HTML = """<!doctype html><html><head><meta charset=utf-8>
<link href="https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@900&display=block" rel=stylesheet>
<style>html,body{margin:0;width:%(w)dpx;height:%(h)dpx;overflow:hidden;background:#000}
.bg{position:absolute;inset:0;background:url(data:image/png;base64,%(img)s) center/cover}
.shade{position:absolute;inset:0;background:linear-gradient(to bottom, rgba(10,6,30,.55), rgba(10,6,30,0) %(fade)d%%)}
h1{position:absolute;left:4%%;right:4%%;top:%(top)dpx;margin:0;text-align:center;font:900 %(size)dpx/1.0 'Cinzel Decorative','Trajan Pro',Georgia,serif;
color:#ffe39a;letter-spacing:.02em;-webkit-text-stroke:%(stroke)dpx #2a1352;paint-order:stroke fill;
text-shadow:0 0 %(glow)dpx rgba(170,110,255,.9),0 %(drop)dpx 0 #1a0b33}</style></head>
<body><div class=bg></div><div class=shade></div><h1>%(title)s</h1></body></html>"""

async def main():
    t0 = time.time()
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        pg = await b.new_page(viewport={'width': 1920, 'height': 1080})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        await pg.goto(URL + '/?debug', timeout=180000)
        await pg.wait_for_function("(document.querySelector('#loadStatus')?.textContent || '').match(/^(Ready|Failed)/)", timeout=180000)
        if await pg.locator('.htp-close').count(): await pg.click('.htp-close')
        await pg.fill('#nameInput', 'Merlin')
        await pg.click('#joinBtn')
        await pg.wait_for_function("!document.querySelector('#hud').classList.contains('hidden') && window.__wa?.local", timeout=60000)
        geo = await pg.evaluate(HOOK)
        print('map:', {k: (round(v, 1) if isinstance(v, (int, float)) else v) for k, v in geo.items()})
        cx, cz, R, high = geo['cx'], geo['cz'], geo['R'], geo['high']
        await pg.wait_for_timeout(int(WAIT * 1000))   # let the bots spread out and start fighting

        async def shot(name, cam=None, ui=False, folder='screens'):
            await pg.evaluate('c => { window.__cap = c; }', cam)
            await pg.evaluate(UI_ON if ui else UI_OFF)
            await pg.wait_for_timeout(2500)
            path = os.path.join(OUT, folder, name + '.png')
            await pg.screenshot(path=path, timeout=180000)
            print('  ', path)
            return path

        print('screens:')
        await shot('overhead', {'p': [cx, R * 1.5, cz + R * 1.05], 'l': [cx, 0, cz], 'fov': 55})
        for side, (dx, dz) in {'north': (0, 1), 'east': (1, 0), 'south': (0, -1), 'west': (-1, 0)}.items():
            r = R * 0.7
            await shot(f'ground-{side}', {'p': [cx + dx * r, 1.7, cz + dz * r], 'l': [cx - dx * R, 1.5, cz - dz * R], 'fov': 62})
        if high['y'] > 1:
            await shot('wallwalk', {'p': [high['x'], high['y'] + 1.7, high['z']], 'l': [cx, 1, cz], 'fov': 62})
        # gameplay, shoulder camera with the HUD, turned towards the nearest living bot
        face = """() => { const wa = window.__wa, me = wa.local.pos; let best = null, bd = 1e9;
          for (const w of wa.players.values()) { const q = w.group.position; const d = Math.hypot(q.x - me.x, q.z - me.z);
            if (d > 0.5 && w.group.visible && d < bd) { bd = d; best = q; } }
          if (best) { wa.local.yaw = Math.atan2(best.x - me.x, best.z - me.z); wa.local.pitch = 0.12; } return bd < 1e9 ? +bd.toFixed(1) : null; }"""
        for i in range(3):
            d = await pg.evaluate(face)
            await shot(f'gameplay-{i + 1}', None, ui=True)
            print('     nearest bot', d, 'm')
            await pg.wait_for_timeout(3000)

        # covers, two variants: 'hero' (our wizard in the foreground, facing the camera, the courtyard behind) and 'vista' (an
        # elevated three-quarter view). Each is rendered at the cover's own size (x1.5 for the small ones, for sharpness).
        print('covers:')
        # hero: try 16 directions around our wizard and keep the one whose camera spot (and the line to the wizard) is
        # furthest from any collider taller than knee height, preferring a view towards the courtyard's centre
        hero_cam = """([cx, cz]) => { const wa = window.__wa, L = wa.local, me = L.pos, cols = wa.C.COLLIDERS.filter(c => c.h > 0.5);
          const clear = (x, z) => Math.min(9, ...cols.map(c => Math.hypot(x - c.x, z - c.z) - c.r));
          let best = null;
          for (let i = 0; i < 16; i++) {
            const a = i / 16 * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
            let worst = 9; for (let d = 0.8; d <= 4.4; d += 0.4) worst = Math.min(worst, clear(me.x + dx * d, me.z + dz * d));
            const toCentre = -(dx * (cx - me.x) + dz * (cz - me.z)) / (Math.hypot(cx - me.x, cz - me.z) || 1);   // 1 = looking at the centre
            const score = Math.min(worst, 1.5) + 0.3 * toCentre;
            if (worst > 0.4 && (!best || score > best.score)) best = { score, dx, dz, worst };
          }
          if (!best) return null;
          const { dx, dz } = best;
          L.yaw = Math.atan2(dx, dz); L.pitch = 0;   // facing the camera
          const sx = dz * 0.7, sz = -dx * 0.7;      // a little off to the side
          return { p: [me.x + dx * 3.6 + sx, me.y + 1.55, me.z + dz * 3.6 + sz], l: [me.x - dx * 8, me.y + 1.9, me.z - dz * 8], fov: 50,
                   clear: +best.worst.toFixed(2) }; }"""
        variants = {'vista': {'p': [cx + R * 0.55, R * 0.42 + 2, cz + R * 0.75], 'l': [cx, 1.5, cz], 'fov': 50}}
        covers = {'landscape': (1920, 1080), 'portrait': (800, 1200), 'square': (800, 800)}
        for variant in ('hero', 'vista'):
            for name, (w, h) in covers.items():
                scale = 1 if w >= 1920 else 1.5
                await pg.set_viewport_size({'width': int(w * scale), 'height': int(h * scale)})
                cam = await pg.evaluate(hero_cam, [cx, cz]) if variant == 'hero' else variants[variant]
                if cam is None:
                    print('   hero: no clear direction around our wizard; skipped (rerun, or use the vista)'); break
                bg = await shot(f'{variant}-{name}', cam, folder='bg')
                img = base64.b64encode(open(bg, 'rb').read()).decode()
                cp = await b.new_page(viewport={'width': w, 'height': h})
                size = int(h * 0.12) if w > h else int(w * 0.16)   # portrait and square wrap to two lines
                await cp.set_content(COVER_HTML % dict(w=w, h=h, img=img, title=TITLE, size=size, top=int(h * (0.07 if w > h else 0.09)),
                                                       stroke=max(2, size // 22), glow=size // 3, drop=max(2, size // 14), fade=45))
                try: await cp.evaluate('document.fonts.ready')
                except Exception: pass
                await cp.wait_for_timeout(800)
                out = os.path.join(OUT, 'covers', f'cover-{variant}-{name}-{w}x{h}')
                await cp.screenshot(path=out + '.png')
                await cp.close()
                try:
                    from PIL import Image
                    Image.open(out + '.png').convert('RGB').save(out + '.jpg', quality=92)
                except ImportError:
                    pass
                print('  ', out + '.png')
        await b.close()
    print('console errors:', errs or 'none')
    print(f'done in {time.time() - t0:.0f}s')

asyncio.run(main())
