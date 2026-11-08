# Round 20 performance harness: plays a 4-player FFA (3 bots fill the seats) for N seconds on the GPU, with Chrome's
# CPU throttle, and reports frame times, draw calls, triangles, shader programs and the quality tier. Exits 1 when a
# target in docs/agents/round20-perf.md is missed.
# usage: python3 deploy/perf_test.py <base url> [--seconds 60] [--throttle 4] [--size 1280x720] [--dpr 1]
#                                    [--latency MS] [--quality auto|high|normal|low] [--json out.json] [--shot out.png]
#                                    [--swiftshader] [--room new] [--no-targets]
#   python3 deploy/perf_test.py http://localhost:4105
#   python3 deploy/perf_test.py http://localhost:4105 --latency 200     # +200 ms round trip on the game's WebSocket
#   python3 deploy/perf_test.py https://wizard-arena-76od.onrender.com --room new
#
# How it measures (independent of the game's code, so it works on any commit and on the live server):
# - frame times from its own requestAnimationFrame loop;
# - draw calls and triangles by wrapping the WebGL context's draw calls (every pass the game draws: shadows included),
#   counted per animation frame; renderer.info is printed too when the page exposes window.__wa (?debug);
# - shader programs: createProgram / deleteProgram, and how many were linked after the first 10 s of the match
#   (each of those is a mid-match compile hitch);
# - the tier: window.__wa.quality / window.WA_QUALITY / <html data-quality>, whichever the page sets;
# - --latency MS: the WebSocket goes through a local TCP proxy that holds every chunk MS/2 in each direction, and the
#   harness reports the gaps between snapshots and how smoothly the remote wizards are drawn (stalls, jumps, reversals).
import argparse, asyncio, json, ssl, statistics, sys, time, urllib.parse, urllib.request
from playwright.async_api import async_playwright

ap = argparse.ArgumentParser()
ap.add_argument('base')
ap.add_argument('--seconds', type=float, default=60)
ap.add_argument('--throttle', type=float, default=4)
ap.add_argument('--size', default='1280x720')
ap.add_argument('--dpr', type=float, default=1)
ap.add_argument('--latency', type=float, default=0, help='added round trip in ms (half each way)')
ap.add_argument('--quality', default=None, help='set ?quality=... (auto when omitted); low also adds ?low')
ap.add_argument('--room', default=None, help="'new' for a private room (use it on the live server)")
ap.add_argument('--json', default=None)
ap.add_argument('--shot', default=None)
ap.add_argument('--swiftshader', action='store_true')
ap.add_argument('--no-targets', action='store_true', help='report only, always exit 0')
A = ap.parse_args()
BASE = A.base.rstrip('/')
W, H = (int(v) for v in A.size.split('x'))
WARMUP = 10.0   # seconds of the match excluded from the "no frame over 100 ms" and "no new programs" checks

# --------------------------------------------------------------------------------------------- the latency proxy
class DelayProxy:
    """A TCP proxy that delivers every chunk `delay` seconds late, in both directions, in order. On a TLS upstream it
    rewrites the Host header of the WebSocket handshake to the real host (Render routes by it)."""
    def __init__(self, host, port, tls, delay):
        self.host, self.port, self.tls, self.delay = host, port, tls, delay
        self.sent = []   # when each server -> browser chunk was handed to the browser (after its delay), ms
    async def start(self):
        self.server = await asyncio.start_server(self.client, '127.0.0.1', 0)
        self.listen = self.server.sockets[0].getsockname()[1]
        return self.listen
    async def client(self, cr, cw):
        try:
            sr, sw = await asyncio.open_connection(self.host, self.port, ssl=ssl.create_default_context() if self.tls else None,
                                                   server_hostname=self.host if self.tls else None)
        except Exception:
            cw.close(); return
        def fix_host(b):
            if not self.tls: return b
            head, sep, rest = b.partition(b'\r\n\r\n')
            lines = [(b'Host: ' + self.host.encode()) if l.lower().startswith(b'host:') else l for l in head.split(b'\r\n')]
            return b'\r\n'.join(lines) + sep + rest
        await asyncio.gather(self.pipe(cr, sw, fix_host), self.pipe(sr, cw, None, self.sent), return_exceptions=True)
    async def pipe(self, r, w, first, log=None):
        q = asyncio.Queue()
        async def writer():
            while True:
                due, data = await q.get()
                if data is None: break
                wait = due - time.monotonic()
                if wait > 0: await asyncio.sleep(wait)
                w.write(data); await w.drain()
                if log is not None: log.append(time.monotonic() * 1000)
            w.close()
        task = asyncio.create_task(writer())
        try:
            while True:
                data = await r.read(65536)
                if not data: break
                if first: data, first = first(data), None
                q.put_nowait((time.monotonic() + self.delay, data))
        finally:
            q.put_nowait((0, None))
            await task

# ------------------------------------------------------------------------------------------- the in-page probe
PROBE = r"""
(() => {
  const P = window.__perf = { frames: [], draw: 0, tris: 0, perFrame: [], programs: 0, created: [], snaps: [],
                              names: {}, remote: [], t0: null };
  // draws and triangles, per animation frame
  const TRI = (mode, n) => mode === 4 ? n / 3 : (mode === 5 || mode === 6) ? Math.max(0, n - 2) : 0;
  const wrap = (proto) => {
    if (!proto || proto.__perfWrapped) return; proto.__perfWrapped = true;
    const dA = proto.drawArrays, dE = proto.drawElements;
    proto.drawArrays = function (m, f, c) { P.draw++; P.tris += TRI(m, c); return dA.apply(this, arguments); };
    proto.drawElements = function (m, c, t, o) { P.draw++; P.tris += TRI(m, c); return dE.apply(this, arguments); };
    if (proto.drawArraysInstanced) { const f = proto.drawArraysInstanced;
      proto.drawArraysInstanced = function (m, a, c, n) { P.draw++; P.tris += TRI(m, c) * n; return f.apply(this, arguments); }; }
    if (proto.drawElementsInstanced) { const f = proto.drawElementsInstanced;
      proto.drawElementsInstanced = function (m, c, t, o, n) { P.draw++; P.tris += TRI(m, c) * n; return f.apply(this, arguments); }; }
    if (proto.drawRangeElements) { const f = proto.drawRangeElements;
      proto.drawRangeElements = function (m, s, e, c) { P.draw++; P.tris += TRI(m, c); return f.apply(this, arguments); }; }
    const cp = proto.createProgram, dp = proto.deleteProgram, lp = proto.linkProgram;
    proto.createProgram = function () { P.programs++; return cp.apply(this, arguments); };
    proto.deleteProgram = function (p) { if (p) P.programs--; return dp.apply(this, arguments); };
    proto.linkProgram = function () { P.created.push(performance.now()); return lp.apply(this, arguments); };
  };
  wrap(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
  wrap(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
  // frame times, and the remote wizards' drawn positions (window.__wa, with ?debug)
  const tick = (t) => {
    P.frames.push(t);
    const wa = window.__wa, ri = wa && wa.renderer && wa.renderer.info.render;
    P.perFrame.push([P.draw, P.tris, ri ? ri.calls : -1, ri ? ri.triangles : -1]); P.draw = 0; P.tris = 0;
    if (P.t0 !== null && wa && wa.players) {
      const row = [t], me = wa.local && wa.local.pos;
      for (const [id, w] of wa.players) {
        const g = w.group || w; if (!g.position) continue;
        if (me && Math.hypot(g.position.x - me.x, g.position.z - me.z) < 0.6) continue;   // our own wizard (drawn at local.pos)
        row.push(id, g.position.x, g.position.z);
      }
      P.remote.push(row);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // snapshot arrivals (and the player names, to tell our own wizard from the others)
  const WS = window.WebSocket;
  window.WebSocket = function (url, proto) {
    const ws = proto === undefined ? new WS(url) : new WS(url, proto);
    ws.addEventListener('message', (e) => {
      if (typeof e.data !== 'string' || !e.data.startsWith('{"t":"snap"')) return;
      P.snaps.push(performance.now());
      if (P.snaps.length % 30 === 1) try { for (const p of JSON.parse(e.data).players || []) P.names[p.id] = p.name; } catch {}
    });
    return ws;
  };
  window.WebSocket.prototype = WS.prototype;
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
})();
"""

# The bot driver: walk, strafe, sprint, jump, turn, cast the fast and power spells and the E/F/R/Q kit. Needs
# window.__wa (?debug) for the input object; without it the player only walks (keys), which still renders a match.
DRIVE = r"""
(() => {
  const wa = window.__wa; if (!wa || !wa.input) return false;
  const I = wa.input;
  I.enabled = true; I.locked = true; I.onLockChange && I.onLockChange(true);   // pretend the pointer is locked (headless)
  let k = 0;
  window.__perfDrive = setInterval(() => {
    k++;
    I.locked = true;
    if (wa.local) { wa.local.yaw += Math.sin(k / 37) * 0.06; wa.local.pitch = 0.08 * Math.sin(k / 23); }
    if (k % 3 === 0) { I.lmb = true; I.lmbPressed = true; }
    if (k % 25 === 0) { I.rmb = true; I.rmbPressed = true; setTimeout(() => { I.rmb = false; I.rmbReleased = true; }, 300); }
    const press = (c) => { I.pressed.add(c); I.keys.add(c); setTimeout(() => I.keys.delete(c), 120); };
    if (k % 40 === 7) press('KeyE');
    if (k % 55 === 11) press('KeyF');
    if (k % 70 === 19) press('KeyR');
    if (k % 90 === 31) press('KeyQ');
    if (k % 35 === 3) press('KeyT');
    if (k % 20 === 5) press('Space');
  }, 100);
  return true;
})()
"""

def pct(xs, p):
    if not xs: return 0
    xs = sorted(xs); i = min(len(xs) - 1, max(0, int(round(p / 100 * (len(xs) - 1)))))
    return xs[i]

def smoothness(remote, t0):
    """Per remote wizard, per drawn frame, on its drawn speed (m/s, so a long frame isn't a jump): a stall is a frame
    with no motion between two moving frames, a jump a frame 3x faster than both neighbours (and moving over 0.15 m),
    a reversal a direction flip (both frames over 1 m/s). Teleports (respawns, blinks: over 3 m) are skipped."""
    tracks = {}
    for row in remote:
        t = row[0]
        if t < t0: continue
        for i in range(1, len(row), 3):
            tracks.setdefault(row[i], []).append((t, row[i + 1], row[i + 2]))
    frames = stalls = jumps = revs = 0
    for pts in tracks.values():
        d = [((b[1] - a[1]), (b[2] - a[2])) for a, b in zip(pts, pts[1:])]
        m = [(x * x + z * z) ** 0.5 for x, z in d]
        v = [mi / max(0.001, (b[0] - a[0]) / 1000) for mi, a, b in zip(m, pts, pts[1:])]
        for i in range(1, len(m) - 1):
            if max(m[i - 1], m[i], m[i + 1]) > 3: continue
            if not (v[i - 1] > 0.3 and v[i + 1] > 0.3): continue
            frames += 1
            if m[i] < 0.0005: stalls += 1
            elif m[i] > 0.15 and v[i] > 3 * max(v[i - 1], v[i + 1]): jumps += 1
            dot = d[i][0] * d[i - 1][0] + d[i][1] * d[i - 1][1]
            if dot < 0 and v[i] > 1 and v[i - 1] > 1: revs += 1
    return frames, stalls, jumps, revs, len(tracks)

async def main():
    loop_proxy = proxy = None
    u = urllib.parse.urlparse(BASE)
    if A.latency > 0:
        tls = u.scheme == 'https'
        proxy = DelayProxy(u.hostname, u.port or (443 if tls else 80), tls, A.latency / 2000)
        port = await proxy.start()
        loop_proxy = f'ws://127.0.0.1:{port}'
        print(f'latency proxy: {loop_proxy} -> {u.hostname}:{proxy.port} (+{A.latency:.0f} ms round trip)')
    q = ['debug']
    if A.quality: q.append('quality=' + A.quality)
    if A.quality == 'low': q.append('low')
    if A.room: q.append('room=' + A.room)
    url = BASE + '/?' + '&'.join(q)
    gl = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] if A.swiftshader else ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
    async with async_playwright() as p:
        b = await p.chromium.launch(args=gl + ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'])
        ctx = await b.new_context(viewport={'width': W, 'height': H}, device_scale_factor=A.dpr)
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        await pg.add_init_script(PROBE + (f'\nwindow.WA_SERVER = {json.dumps(loop_proxy)};' if loop_proxy else ''))
        t = time.time()
        await pg.goto(url, timeout=180000)
        # (?room=new skips the builder: the page creates the room and goes straight into it)
        await pg.wait_for_function("""() => { const s = document.querySelector('#loadStatus')?.textContent || '';
          return s.startsWith('Ready') || s.startsWith('Failed') || !document.querySelector('#hud').classList.contains('hidden'); }""", timeout=180000)
        in_game = await pg.evaluate("!document.querySelector('#hud').classList.contains('hidden')")
        load_s = time.time() - t
        status = await pg.evaluate("document.querySelector('#loadStatus').textContent")
        print(f'{url}: {status!r} in {load_s:.1f} s, {W}x{H} DPR {A.dpr}, CPU throttle {A.throttle}x')
        progs_loaded = await pg.evaluate('__perf.programs')
        if not in_game:
            if await pg.locator('.htp-close').count(): await pg.click('.htp-close')
            await pg.fill('#nameInput', 'perftest')
        cdp = await ctx.new_cdp_session(pg)
        if A.throttle > 1: await cdp.send('Emulation.setCPUThrottlingRate', {'rate': A.throttle})
        if not in_game: await pg.click('#joinBtn')
        await pg.wait_for_function("!document.querySelector('#hud').classList.contains('hidden')", timeout=60000)
        for _ in range(60):
            n = await pg.evaluate('Object.keys(__perf.names).length')
            if n >= 4: break
            await pg.wait_for_timeout(500)
        await pg.evaluate("__perf.t0 = performance.now()")
        if proxy: proxy.sent.clear()
        driven = await pg.evaluate(DRIVE)
        await pg.keyboard.down('KeyW')
        info_mid = None
        start, i = time.time(), -1
        while time.time() - start < A.seconds:
            i += 1
            # wander: forward always, a strafe that changes every 3 s, sprint now and then
            if i % 6 == 0:
                for kc in ('KeyA', 'KeyD', 'ShiftLeft'): await pg.keyboard.up(kc)
                side = ('KeyA', 'KeyD', None)[(i // 6) % 3]
                if side: await pg.keyboard.down(side)
                if (i // 6) % 4 == 1: await pg.keyboard.down('ShiftLeft')
            if info_mid is None and time.time() - start >= A.seconds / 2:
                info_mid = await pg.evaluate("""() => { const r = window.__wa?.renderer; if (!r) return null;
                  return { calls: r.info.render.calls, triangles: r.info.render.triangles, programs: r.info.programs?.length,
                           geometries: r.info.memory.geometries, textures: r.info.memory.textures }; }""")
                if A.shot: await pg.screenshot(path=A.shot)
            await pg.wait_for_timeout(500)
        for kc in ('KeyW', 'KeyA', 'KeyD', 'ShiftLeft'): await pg.keyboard.up(kc)
        if A.throttle > 1: await cdp.send('Emulation.setCPUThrottlingRate', {'rate': 1})
        P = await pg.evaluate("""() => { const P = __perf; return { frames: P.frames, perFrame: P.perFrame, programs: P.programs,
          created: P.created, snaps: P.snaps, remote: P.remote, t0: P.t0, names: P.names,
          tier: window.__wa?.quality?.tier ?? window.__wa?.quality ?? window.WA_QUALITY ?? document.documentElement.dataset.quality ?? null,
          ping: window.__wa?.net?.ping ?? window.__wa?.net?.rtt ?? null }; }""")
        players = len(P['names'])
        await b.close()

    t0 = P['t0']
    idx = [i for i, f in enumerate(P['frames']) if f >= t0]
    fr = [P['frames'][i] for i in idx]
    dts = [b_ - a for a, b_ in zip(fr, fr[1:])]
    late = [b_ - a for a, b_ in zip(fr, fr[1:]) if a >= t0 + WARMUP * 1000]
    span = (fr[-1] - fr[0]) / 1000 if len(fr) > 1 else 1
    pf = [P['perFrame'][i] for i in idx if P['perFrame'][i][0] > 0]   # frames that drew (skip the rare empty rAF)
    med = lambda k: int(statistics.median([r[k] for r in pf])) if pf else 0
    p95 = lambda k: int(pct([r[k] for r in pf], 95))
    has_info = bool(pf) and pf[-1][2] >= 0
    mid_compiles = [c for c in P['created'] if c >= t0 + WARMUP * 1000]
    match_compiles = [c for c in P['created'] if c >= t0]
    R = {
        'url': url, 'size': A.size, 'dpr': A.dpr, 'throttle': A.throttle, 'latency_ms': A.latency, 'seconds': round(span, 1),
        'players': players, 'driven': driven, 'tier': P['tier'], 'load_s': round(load_s, 1),
        'fps': round(len(dts) / span, 1) if dts else 0,
        'frame_ms': {'p50': round(pct(dts, 50), 1), 'p95': round(pct(dts, 95), 1), 'p99': round(pct(dts, 99), 1), 'max': round(max(dts or [0]), 1)},
        'max_after_warmup_ms': round(max(late or [0]), 1),
        'frames_over_50': sum(d > 50 for d in dts), 'frames_over_100': sum(d > 100 for d in dts),
        'frames_over_100_after_warmup': sum(d > 100 for d in late),
        # renderer.info's per-render() numbers when the page exposes them (what three.js reports; the coordinator's table),
        # else the WebGL hook's; the hook's are kept as gl_* (every draw in the frame: a second render() call included)
        'draw_calls': med(2) if has_info else med(0), 'triangles': med(3) if has_info else med(1),
        'draw_calls_p95': p95(2) if has_info else p95(0), 'triangles_p95': p95(3) if has_info else p95(1),
        'counted_by': 'renderer.info' if has_info else 'webgl hook',
        'gl_draw_calls': med(0), 'gl_triangles': med(1), 'gl_draw_calls_p95': p95(0), 'gl_triangles_p95': p95(1),
        'programs': P['programs'], 'programs_at_load': progs_loaded,
        'programs_linked_in_match': len(match_compiles), 'programs_linked_after_warmup': len(mid_compiles),
        'renderer_info': info_mid, 'console_errors': errs[:10],
    }
    if True:   # (snapshot gaps and remote motion: reported always, checked only with --latency)
        # the network side, with --latency only: the proxy's deliveries to the browser (chunks within 5 ms are one send)
        sn = []
        for t_ in (proxy.sent if proxy else []):
            if not sn or t_ - sn[-1] > 5: sn.append(t_)
        gaps = [b_ - a for a, b_ in zip(sn, sn[1:])]
        hs = [s for s in P['snaps'] if s >= t0]
        hgaps = [b_ - a for a, b_ in zip(hs, hs[1:])]
        f, st, ju, rv, nt = smoothness(P['remote'], t0)
        mins = span / 60
        R['snapshots'] = {'delivery_hz': round(len(gaps) / span, 1), 'gap_p50': round(pct(gaps, 50), 1), 'gap_p95': round(pct(gaps, 95), 1),
                          'gap_max': round(max(gaps or [0]), 1), 'gaps_over_100': sum(g > 100 for g in gaps),
                          'handled_hz': round(len(hgaps) / span, 1), 'handled_gap_p50': round(pct(hgaps, 50), 1), 'handled_gap_p95': round(pct(hgaps, 95), 1), 'handled_gap_max': round(max(hgaps or [0]), 1)}
        R['remote_motion'] = {'wizards': nt, 'moving_frames': f, 'stall_pct': round(100 * st / max(1, f), 1),
                              'jumps_per_min': round(ju / mins, 1), 'reversals_per_min': round(rv / mins, 1)}
        R['ping_ms'] = P['ping']

    # targets (docs/agents/round20-perf.md)
    low = str(R['tier']).lower().startswith('low') or A.quality == 'low'
    tri_cap = 60000 if low else 120000
    T = [
        ('fps >= 50', R['fps'] >= 50),
        ('p95 frame < 25 ms', R['frame_ms']['p95'] < 25),
        ('no frame > 100 ms after 10 s', R['frames_over_100_after_warmup'] == 0),
        (f'triangles < {tri_cap // 1000}k', R['triangles'] < tri_cap),
        ('draw calls < 120', R['draw_calls'] < 120),
        ('programs < 60', R['programs'] < 60),
        ('no programs compiled after 10 s', R['programs_linked_after_warmup'] == 0),
        ('4 players in the match', players >= 4),
        ('no console errors', not errs),
    ]
    if A.latency > 0:
        rm = R['remote_motion']
        T += [('remote wizards: stalls < 5% of moving frames', rm['stall_pct'] < 5),
              ('remote wizards: < 6 jumps / min', rm['jumps_per_min'] < 6),
              ('remote wizards: < 6 reversals / min', rm['reversals_per_min'] < 6)]
    R['targets'] = {name: ok for name, ok in T}
    if A.json:
        with open(A.json, 'w') as fh: json.dump(R, fh, indent=1)

    print(f"tier {R['tier']}, {players} players, driver {'on' if driven else 'off (no window.__wa: walk only)'}, {R['seconds']} s measured")
    fm = R['frame_ms']
    print(f"fps {R['fps']}  frame p50 {fm['p50']} / p95 {fm['p95']} / p99 {fm['p99']} / max {fm['max']} ms  "
          f"(max after 10 s {R['max_after_warmup_ms']})  >50 ms: {R['frames_over_50']}  >100 ms: {R['frames_over_100']} ({R['frames_over_100_after_warmup']} after 10 s)")
    print(f"draw calls {R['draw_calls']} (p95 {R['draw_calls_p95']})  triangles {R['triangles']:,} (p95 {R['triangles_p95']:,}) [{R['counted_by']}]  "
          f"all GL per frame: {R['gl_draw_calls']} calls, {R['gl_triangles']:,} triangles")
    print(f"programs {R['programs']} (at load {R['programs_at_load']}, linked in match {R['programs_linked_in_match']}, after 10 s {R['programs_linked_after_warmup']})")
    if info_mid: print('renderer.info (mid-match):', info_mid)
    s, rm = R['snapshots'], R['remote_motion']
    if proxy: print(f"proxy -> browser: {s['delivery_hz']} sends/s, gap p50 {s['gap_p50']} / p95 {s['gap_p95']} / max {s['gap_max']} ms, {s['gaps_over_100']} gaps > 100 ms")
    print(f"snapshots handled by the page: {s['handled_hz']} Hz, gap p50 {s['handled_gap_p50']} / p95 {s['handled_gap_p95']} / max {s['handled_gap_max']} ms")
    print(f"remote motion ({rm['wizards']} wizards, {rm['moving_frames']} moving frames): stalls {rm['stall_pct']}%, "
          f"jumps {rm['jumps_per_min']}/min, reversals {rm['reversals_per_min']}/min" + (f", ping {R['ping_ms']} ms" if R['ping_ms'] is not None else ''))
    print('console errors:', errs[:5] or 'none')
    for name, ok in T: print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    bad = [n for n, ok in T if not ok]
    print('RESULT:', 'PASS' if not bad else f'FAIL ({len(bad)} of {len(T)} targets missed)')
    sys.exit(0 if (not bad or A.no_targets) else 1)

asyncio.run(main())
