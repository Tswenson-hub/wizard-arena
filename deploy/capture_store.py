# Store art for the CrazyGames submission: gameplay screenshots and the three covers, captured from the running game.
# usage: python3 deploy/capture_store.py <game url> [out dir=dist/store] [--title "Wizard Arena"] [--wait 12] [--stage]
#                                        [--only hero,vista,overhead,ground,wallwalk,gameplay]
#   WA_DEBUG=1 PORT=4105 node server.js &  python3 deploy/capture_store.py http://localhost:4105 dist/store --stage
#   --stage: for the gameplay frames, put our wizard about 9 m from a bot (needs a private server with WA_DEBUG=1, never live)
#   --only: redo just these shots (names are prefixes), keeping the other files
# It joins a free-for-all with bots (with ?debug, for window.__wa), then:
#   screens/  1920x1080 PNGs: overhead, ground level from 4 sides, the wall-walk (the highest spawn), and gameplay with the HUD
#             facing the nearest bot (several, a few seconds apart; keep the best)
#   covers/   landscape 1920x1080, portrait 800x1200, square 800x800 (PNG and JPG), in two variants (hero: our wizard up close;
#             vista: over the courtyard): a clean render (no HUD, no nameplates) under the title only, which is all CrazyGames
#             allows on a cover (no borders, logos or other text). Each set is cropped from one 2400x2400 frame, so they match
#   bg/       the clean renders behind the covers (<variant>-full.png and its crops)
# Clear spots are found from the map itself (SURFACES boxes, COLLIDERS, props, wizards), and gameplay frames are kept only
# while we're alive with a bot within 16 m. Results still vary run to run: look at them, retake with --only, keep the best.
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
STAGE = '--stage' in sys.argv
ONLY = opt('--only', '').split(',') if '--only' in sys.argv else None
want = lambda name: ONLY is None or any(name.startswith(o) for o in ONLY)
pos = [a for i, a in enumerate(sys.argv[1:], 1) if not a.startswith('--') and sys.argv[i - 1] not in ('--title', '--wait', '--only')]
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
  // free space around a camera spot (x, y, z), 0..2 m: solid map pieces (SURFACES, sampled on rings at the camera's height and
  // 0.8 m below), the circle COLLIDERS, props and the other wizards
  const cols = C.COLLIDERS.filter(c => c.h > 0.5);
  window.__capClear = (x, z, y = 1.9) => {
    let d = 2;
    for (const r of [0.3, 0.6, 1, 1.5, 2]) {
      if (r >= d) break;
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
        if (C.surfaceSolidAt(px, y, pz) || C.surfaceSolidAt(px, y - 0.8, pz)) { d = Math.min(d, r - 0.15); break; } }
    }
    for (const c of cols) d = Math.min(d, Math.hypot(x - c.x, z - c.z) - c.r);
    for (const e of wa.props.values()) if (e.mesh?.visible) d = Math.min(d, Math.hypot(x - e.mesh.position.x, z - e.mesh.position.z) - 0.7);
    for (const w of wa.players.values()) { const q = w.group.position;
      if (w.group.visible && Math.hypot(q.x - wa.local.pos.x, q.z - wa.local.pos.z) > 0.3) d = Math.min(d, Math.hypot(x - q.x, z - q.z) - 0.6); }
    return Math.max(0, d);
  };
  // the clearest line of sight: free space at the spot and along the first `ahead` m towards (tx, tz), and 0 when a map piece
  // cuts the line at that height within `ahead` m
  window.__capLine = (x, z, tx, tz, ahead, y = 1.9) => {
    const L = Math.hypot(tx - x, tz - z) || 1; let d = 2;
    for (let s = 0; s <= ahead; s += 0.5) d = Math.min(d, __capClear(x + (tx - x) / L * s, z + (tz - z) / L * s, y));
    const hit = C.surfaceSegmentHit([x, y, z], [x + (tx - x) / L * ahead, y - 0.2, z + (tz - z) / L * ahead]);
    return hit ? 0 : d;
  };
  const spawns = C.SPAWN_POINTS.map(s => ({ x: s[0], y: s[1] || 0, z: s[2] }));
  return { cx, cz, R, high, highs: spawns.filter(s => s.y > 1), arena: C.ARENA_RADIUS };
}"""

# clean shots: only the canvas, and no nameplates over the wizards
UI_OFF = """document.getElementById('__capcss') || document.head.insertAdjacentHTML('beforeend', '<style id=__capcss>body *{visibility:hidden!important} canvas{visibility:visible!important}</style>');
  for (const w of window.__wa.players.values()) if (w.nameplate) w.nameplate.visible = false"""
UI_ON = """document.getElementById('__capcss')?.remove(); for (const s of ['#clickToPlay', '#lockPrompt']) document.querySelector(s)?.classList.add('hidden');
  for (const w of window.__wa.players.values()) if (w.nameplate) w.nameplate.visible = true"""

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
        print('map:', {k: (round(v, 1) if isinstance(v, (int, float)) else v) for k, v in geo.items() if k != 'highs'})
        cx, cz, R = geo['cx'], geo['cz'], geo['R']
        await pg.wait_for_timeout(2500)   # the first frames after joining compile shaders

        async def shot(name, cam=None, ui=False, folder='screens', settle=2500):
            await pg.evaluate('c => { window.__cap = c; }', cam)
            await pg.evaluate(UI_ON if ui else UI_OFF)
            await pg.wait_for_timeout(settle)
            path = os.path.join(OUT, folder, name + '.png')
            await pg.screenshot(path=path, timeout=180000)
            print('  ', path)
            return path

        async def covers_from(variant, cam):
            # one 2400x2400 frame, cropped to each cover's aspect and scaled down: the three covers show the same moment
            # (CrazyGames asks for consistent covers), and nothing can change between them
            from PIL import Image
            await pg.set_viewport_size({'width': 2400, 'height': 2400})
            full = await shot(f'{variant}-full', cam, folder='bg', settle=3500)
            await pg.set_viewport_size({'width': 1920, 'height': 1080})
            src = Image.open(full).convert('RGB')
            for name, (w, h) in covers.items():
                cw, ch = (2400, round(2400 * h / w)) if w / h >= 1 else (round(2400 * w / h), 2400)
                x0, y0 = (2400 - cw) // 2, (2400 - ch) // 2
                bg = os.path.join(OUT, 'bg', f'{variant}-{name}.png')
                src.crop((x0, y0, x0 + cw, y0 + ch)).resize((w, h), Image.LANCZOS).save(bg)
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
                Image.open(out + '.png').convert('RGB').save(out + '.jpg', quality=92)
                print('  ', out + '.png')

        covers = {'landscape': (1920, 1080), 'portrait': (800, 1200), 'square': (800, 800)}
        # hero, first: we're standing on our spawn in the warm-up, so nobody has hit us yet. The camera is chosen once (16 directions
        # around our wizard, the clearest line, preferring a view towards the centre) and reused for all three sizes.
        if want('hero'):
            print('hero covers:')
            alive = "document.querySelector('#deathScreen')?.classList.contains('hidden') !== false"
            for attempt in range(4):
              if not await pg.evaluate(alive): await pg.wait_for_timeout(3000); continue
              if STAGE:   # stand in the open 6-10 m from the centre first, so the courtyard and its centrepiece are behind us
                  print('   placed at', await pg.evaluate("""([cx, cz]) => { const wa = window.__wa; let best = null;
                    for (let r = 6; r <= 10; r += 1) for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
                      const f = __capClear(x, z, 1.5); if (!best || f > best.f) best = { x, z, f }; }
                    wa.net.send({ t: 'debugPlace', p: [best.x, 0, best.z] }); wa.local.pos.set(best.x, 0, best.z); wa.local.vel?.set(0, 0, 0);
                    return best; }""", [cx, cz]))
                  await pg.wait_for_timeout(1500)
              cam = await pg.evaluate("""([cx, cz]) => { const L = window.__wa.local, me = L.pos;
                let best = null;
                for (let i = 0; i < 16; i++) {
                  const a = i / 16 * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
                  const free = Math.min(__capLine(me.x + dx * 4.4, me.z + dz * 4.4, me.x, me.z, 3.6, me.y + 1.5), __capLine(me.x + dx * 4.4, me.z + dz * 4.4, me.x - dx * 6, me.z - dz * 6, 8, me.y + 1.8));
                  const toCentre = -(dx * (cx - me.x) + dz * (cz - me.z)) / (Math.hypot(cx - me.x, cz - me.z) || 1);
                  const score = Math.min(free, 1.5) + 0.3 * toCentre;
                  if (free > 0.5 && (!best || score > best.score)) best = { score, dx, dz, free };
                }
                if (!best) return null;
                const { dx, dz } = best;
                L.yaw = Math.atan2(dx, dz); L.pitch = 0;   // facing the camera
                const sx = dz * 0.7, sz = -dx * 0.7;      // a little off to the side
                return { p: [me.x + dx * 3.6 + sx, me.y + 1.55, me.z + dz * 3.6 + sz], l: [me.x - dx * 8, me.y + 1.9, me.z - dz * 8], fov: 72 }; }""", [cx, cz])
              if cam is None: print('   no clear direction around our wizard; skipped (rerun, or use the vista)')
              else:
                await covers_from('hero', cam)
                print('   our wizard:', await pg.evaluate("""() => { const wa = window.__wa, me = wa.local.pos;
                  const w = [...wa.players.values()].find(w => w.group.position.distanceTo(me) < 0.5);
                  return w ? { visible: w.group.visible, dead: !!w.dead, at: [+me.x.toFixed(1), +me.y.toFixed(1), +me.z.toFixed(1)] } : 'not found'; }"""))
                if await pg.evaluate(alive) and await pg.evaluate("!!window.__wa.local && !window.__wa.local.dead"): break
                print('   retry: we died during the hero shot')
        # the hero is shot in the warm-up (nobody can hurt us); everything else waits for the match itself, then WAIT more
        # seconds for the bots to spread out and start fighting
        try:
            await pg.wait_for_function("!document.body.innerText.includes('Warm-up')", timeout=90000)
        except Exception:
            print('   still in the warm-up after 90 s; carrying on')
        await pg.wait_for_timeout(int(WAIT * 1000))

        if want('vista'):
            print('vista covers:')
            await covers_from('vista', {'p': [cx + R * 0.55, R * 0.42 + 2, cz + R * 0.75], 'l': [cx, 1.5, cz], 'fov': 72})

        print('screens:')
        if want('overhead'):
            await shot('overhead', {'p': [cx, R * 1.5, cz + R * 1.05], 'l': [cx, 0, cz], 'fov': 55})
        # ground level from each side: walk in from 0.8 R towards the centre and stand at the first spot with 1.2 m free
        # around it and along the next 5 m of the view
        for side, (dx, dz) in {'north': (0, 1), 'east': (1, 0), 'south': (0, -1), 'west': (-1, 0)}.items():
            if not want(f'ground-{side}'): continue
            spot = await pg.evaluate("""([cx, cz, R, dx, dz]) => { let best = null;
              for (let r = 0.8 * R; r >= 0.3 * R; r -= 0.5) { const x = cx + dx * r, z = cz + dz * r, f = __capLine(x, z, cx, cz, 5);
                if (f >= 1.2) return { x, z, f }; if (!best || f > best.f) best = { x, z, f }; }
              return best; }""", [cx, cz, R, dx, dz])
            await shot(f'ground-{side}', {'p': [spot['x'], 1.9, spot['z']], 'l': [cx - dx * R * 0.6, 1.4, cz - dz * R * 0.6], 'fov': 62})
        # the wall-walk: the high spawn with nobody near, the camera a little above head height, looking over the courtyard
        if want('wallwalk') and geo['highs']:
            hs = await pg.evaluate("""(hs) => hs.map(h => ({ ...h, f: __capClear(h.x, h.z) })).sort((a, b) => b.f - a.f)""", geo['highs'])
            hh = hs[0]
            ux, uz = cx - hh['x'], cz - hh['z']; n = max(1e-6, (ux * ux + uz * uz) ** 0.5); ux, uz = ux / n, uz / n
            await shot('wallwalk', {'p': [hh['x'] - ux * 0.4, hh['y'] + 2.4, hh['z'] - uz * 0.4], 'l': [cx + ux * R * 0.3, 0.5, cz + uz * R * 0.3], 'fov': 64})
        # gameplay, the shoulder camera with the HUD, facing the nearest bot (with --stage: about 9 m from it first)
        face = """() => { const wa = window.__wa, me = wa.local.pos; let best = null, bd = 1e9;
          for (const w of wa.players.values()) { const q = w.group.position; const d = Math.hypot(q.x - me.x, q.z - me.z);
            if (d > 0.5 && w.group.visible && !w.dead && d < bd) { bd = d; best = q; } }
          if (best) { wa.local.yaw = Math.atan2(best.x - me.x, best.z - me.z); wa.local.pitch = 0.1; } return bd < 1e9 ? +bd.toFixed(1) : null; }"""
        stage = """([cx, cz, k]) => { const wa = window.__wa, me = wa.local.pos;
          const bots = [...wa.players.values()].map(w => w.group.position).filter((q, i, a) => Math.hypot(q.x - me.x, q.z - me.z) > 0.5)
            .filter(q => q.y < 0.6).sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
          const best = bots.length ? bots[k % bots.length] : null;
          if (!best) return null;
          let spot = null;
          for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2, x = best.x + Math.sin(a) * 9, z = best.z + Math.cos(a) * 9;
            const f = Math.min(__capClear(x, z), __capLine(x, z, best.x, best.z, 7), __capLine(x, z, 2 * x - best.x, 2 * z - best.z, 4.5)); if (Math.hypot(x - cx, z - cz) > 22) continue;
            if (!spot || f > spot.f) spot = { x, z, f }; }
          if (!spot) return null;
          wa.net.send({ t: 'debugPlace', p: [spot.x, 0, spot.z] }); wa.local.pos.set(spot.x, 0, spot.z); wa.local.vel?.set(0, 0, 0);
          return spot; }"""
        # up to 8 tries for the 3 frames: a frame counts only if we're alive (no death screen) and a bot is within 16 m
        alive = "document.querySelector('#deathScreen')?.classList.contains('hidden') !== false"
        shots, tries = [i for i in range(3) if want(f'gameplay-{i + 1}')], 0
        while shots and tries < 8:
            tries += 1
            if not await pg.evaluate(alive): await pg.wait_for_timeout(2000); continue
            if STAGE:
                print('     staged at', await pg.evaluate(stage, [cx, cz, tries])); await pg.wait_for_timeout(1500)
            d = await pg.evaluate(face)
            if d is None or d > 16 or not await pg.evaluate(alive):
                print('     retry: nearest bot', d, 'm'); await pg.wait_for_timeout(1500); continue
            await pg.evaluate(UI_ON); await pg.evaluate('c => { window.__cap = c; }', None)
            await pg.evaluate("() => { const i = window.__wa.input; i.locked = i.enabled = true; i.lmb = i.lmbPressed = true; setTimeout(() => { i.lmb = false; }, 300); }")
            await shot(f'gameplay-{shots[0] + 1}', None, ui=True, settle=450)
            if not await pg.evaluate(alive): print('     retry: died during the shot'); continue
            print('     nearest bot', d, 'm'); shots.pop(0)
            await pg.wait_for_timeout(2500)
        if shots: print('   gameplay frames missing:', [f'gameplay-{i + 1}' for i in shots])
        await b.close()
    print('console errors:', errs or 'none')
    print(f'done in {time.time() - t0:.0f}s')

asyncio.run(main())
