# Round 22 legacy-client test: the live CrazyGames build (a client without `proto: 22`, built from the commit CrazyGames
# runs) served under a subpath and played against the NEW server, through a whole match to the podium and the rematch.
# The server must keep the old client working: it goes to a legacy room (courtyard only, no runes, pads or map rotation),
# reads the kill target from the match messages, never sees a message it can't handle, and reaches the recap.
# usage: python3 deploy/legacy_test.py <page url> [screenshot path] [--fast] [--seconds 420] [--swiftshader] [--first]
#   node tools/build-crazygames.mjs --ref 95aca29 --server ws://localhost:4105 --out dist/crazygames-legacy --no-zip
#   WA_DEBUG=1 MATCH_DEBUG=1 PORT=4105 node server.js &   node tools/serve-subpath.mjs dist/crazygames-legacy 4198 /game &
#   python3 deploy/legacy_test.py http://localhost:4198/game/ /tmp/wa-deploy/r22/legacy.png --fast
#   --fast     ends the match sooner (matchDebug: target 3, a 4 s recap; needs MATCH_DEBUG=1 on the server). Without it the
#              match plays to the real target or the cap (about 5 minutes).
#   --seconds  how long to wait for the match to end (default 420: the cap plus the countdown and some margin)
#   --first    the first-visit path (a fresh profile joins by itself as the Pyromancer); default: the builder, as 'legacy'
#   --gen v22  round 24: the page is the round-23 build (`--ref 21a31ef`, proto 22, the OLD Sky Ruins bundled): it must land in a 'v22'
#              room (room.gen), the courtyard WITH runes and pads, and stay on the courtyard through the rematch (no rotation)
# Checks: the welcome and the HUD agree on the target; a legacy room when the server has them (room.legacy, the courtyard,
# no runes or pads); round 26: none of the XP / progress / emote messages arrive; the match goes live, ends (target or cap), the recap shows (the podium), the rematch countdown follows;
# the socket stays open; no console or page errors; the SDK shim's gameplayStart fired.
import asyncio, json, sys, time
from playwright.async_api import async_playwright

GL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] if '--swiftshader' in sys.argv else ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
FAST = '--fast' in sys.argv
FIRST = '--first' in sys.argv
GEN = sys.argv[sys.argv.index('--gen') + 1] if '--gen' in sys.argv else 'legacy'   # round 24: 'legacy' (no proto), 'v22' (proto 22) or 'v24' (a proto-24 build)
SECONDS = float(sys.argv[sys.argv.index('--seconds') + 1]) if '--seconds' in sys.argv else 420
args = [a for i, a in enumerate(sys.argv[1:], 1) if a not in ('--fast', '--first', '--swiftshader', '--seconds', '--gen') and sys.argv[i - 1] not in ('--seconds', '--gen')]
PAGE = args[0]
SHOT = args[1] if len(args) > 1 else None

# the same driver perf_test.py uses: walk, strafe, sprint, jump, cast everything (window.__wa, so ?debug)
DRIVE = r"""
(() => {
  const wa = window.__wa; if (!wa || !wa.input) return false;
  const I = wa.input;
  I.enabled = true; I.locked = true; I.onLockChange && I.onLockChange(true);
  let k = 0;
  window.__drive = setInterval(() => {
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

# the recap on the old client: match-ui.js's #mRecap (text), and the podium scene's body.recap-on (podium.js)
RECAP_DOM = "({ recap: !!document.querySelector('#mRecap') && getComputedStyle(document.querySelector('#mRecap')).display !== 'none' && document.querySelector('#mRecap').textContent.trim().length > 0, podium: document.body.classList.contains('recap-on') })"

async def main():
    ok = True
    def check(cond, label):
        nonlocal ok
        print(('  ok   ' if cond else '  FAIL ') + label)
        ok = ok and bool(cond)
    S = {'welcome': None, 'phases': [], 'end': None, 'recap': None, 'rematch': False, 'deaths': 0, 'kills': 0, 'keys': set(),
         'types': set(), 'closed': None, 'sent': 0, 'recv': 0, 'names': set(), 'bots': set(), 'snapMatch': None}
    async with async_playwright() as p:
        b = await p.chromium.launch(args=GL_ARGS)
        ctx = await b.new_context(viewport={'width': 1280, 'height': 720})
        pg = await ctx.new_page()
        errs, failed, cg = [], [], []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        def on_console(m):
            if m.text.startswith('[crazygames]'): cg.append(m.text)
            elif m.type == 'error': errs.append(m.text)
        pg.on('console', on_console)
        pg.on('response', lambda r: failed.append(f'{r.status} {r.url}') if r.status >= 400 else None)
        pg.on('requestfailed', lambda r: failed.append(f'failed {r.url} {r.failure}'))
        def on_frame(f, ws=None):
            S['recv'] += 1
            if not isinstance(f, str): return
            try: m = json.loads(f)
            except Exception: return
            t = m.get('t'); S['types'].add(t)
            if t == 'welcome':
                S['welcome'] = m; S['keys'] |= set(m.keys()); S['me'] = m.get('id'); S['game'] = ws   # (the old client also opens a short stats socket at load)
            elif t == 'snap':
                S['keys'] |= {'snap.' + k for k in m.keys()}
                if m.get('match'): S['snapMatch'] = m['match']
                for q in m.get('players', []):
                    if q.get('name'): S['names'].add(q['name'])
                    if q.get('bot'): S['bots'].add(q['bot'])
            elif t == 'matchPhase':
                ph = m['match']['phase']
                if not S['phases'] or S['phases'][-1][0] != ph: S['phases'].append((ph, time.time(), m['match']))
                if ph == 'countdown' and S['end']: S['rematch'] = True
            elif t == 'matchEnd': S['end'] = S['end'] or m
            elif t == 'map': S.setdefault('maps', []).append(m.get('map'))   # round 24: a v22 room must never send one (no rotation)
            elif t == 'recap': S['recap'] = S['recap'] or m
            elif t == 'death':
                if m.get('id') == S.get('me'): S['deaths'] += 1
                if m.get('killer') == S.get('me') or m.get('attacker') == S.get('me'): S['kills'] += 1
        def on_ws(ws):
            S['url'] = ws.url
            ws.on('framesent', lambda _: S.__setitem__('sent', S['sent'] + 1))
            ws.on('framereceived', lambda f: on_frame(f, ws))
            ws.on('close', lambda _: S.__setitem__('closed', time.time()) if S.get('game') is ws else None)
        pg.on('websocket', on_ws)
        sep = '&' if '?' in PAGE else '?'
        url = PAGE + sep + 'debug&cgdebug' + ('' if FIRST else '&builder=1')
        t = time.time()
        await pg.goto(url, timeout=120000)
        await pg.wait_for_function("""() => { const s = document.querySelector('#loadStatus')?.textContent || '';
          return s.startsWith('Ready') || s.startsWith('Failed') || !document.querySelector('#hud').classList.contains('hidden'); }""", timeout=120000)
        status = await pg.evaluate("document.querySelector('#loadStatus').textContent")
        print(f'{url}: {status!r} in {time.time() - t:.1f} s')
        check(not status.startswith('Failed'), 'the old client loaded')
        cfg = await pg.evaluate("({ server: window.WA_SERVER, platform: window.WA_PLATFORM?.name, proto: (window.__wa?.net?.proto ?? null) })")
        print('config:', cfg)
        if not FIRST:
            if await pg.locator('.htp-close').count(): await pg.click('.htp-close')
            await pg.fill('#nameInput', 'legacy')
            await pg.click('#joinBtn')
        await pg.wait_for_function("!document.querySelector('#hud').classList.contains('hidden')", timeout=60000)
        for _ in range(40):
            if S['welcome'] and len(S['names']) >= 4: break
            await pg.wait_for_timeout(500)
        w = S['welcome'] or {}
        check(bool(w), f"welcome received ({len(w.get('players', []))} players in it, room {w.get('room', {}).get('id')})")
        match = w.get('match') or {}
        target = match.get('target')
        print(f"  welcome.match: target {target}, cap {match.get('cap')}, map {match.get('map', '(no map field)')}, phase {match.get('phase')}")
        room = w.get('room') or {}
        print(f"  welcome.room: {room}")
        # the legacy room: only checked once the server has them (room.legacy); before that, a note
        if GEN == 'v22':
            check(room.get('gen') == 'v22' and not room.get('legacy'), f"a v22 room (room.gen {room.get('gen')!r}, legacy {room.get('legacy')!r})")
            mid = match.get('map', 'courtyard'); mid = mid.get('id') if isinstance(mid, dict) else mid
            check(mid == 'courtyard', f"on the courtyard (match.map {match.get('map')!r})")
            runes, pads = w.get('runes'), w.get('pads')
            check(bool(runes) and bool(pads), f'runes and pads in the welcome ({len(runes or [])} runes, {len(pads or [])} pads)')
        elif 'legacy' in room:
            check(room['legacy'] is True, f"a legacy room (room.legacy {room['legacy']})")
            mid = match.get('map', 'courtyard'); mid = mid.get('id') if isinstance(mid, dict) else mid   # (a string, or { id, name })
            check(mid in ('courtyard', 'legacy'), f"on the courtyard (match.map {match.get('map')!r}; 'legacy' is environment's frozen copy of the live layout)")
            runes, pads = w.get('runes'), w.get('pads')
            check(not runes and not pads, f'no runes or pads in the welcome (runes {runes!r}, pads {pads!r})')
        else:
            print('  note: this server has no room.legacy yet (pre-round-22): the legacy-room checks are skipped')
        # the HUD reads the target from the match messages (match-ui.js: 'Free-for-all · first to N')
        hud = await pg.evaluate("document.querySelector('.mMode')?.textContent || ''")
        check(target is not None and f'first to {target}' in hud, f"the HUD's mode line reads the server's target: {hud!r}")
        prompt = await pg.evaluate("document.querySelector('#lockPrompt')?.textContent || ''")
        if 'kills' in prompt: check(f'{target} kills' in prompt, f"the prompt reads the server's target: {' '.join(prompt.split())[:80]!r}")
        if FAST:
            await pg.evaluate("window.__wa.net.send({ t: 'matchDebug', target: 3, recapTime: 4 })")
            print('  --fast: matchDebug target 3, recap 4 s (MATCH_DEBUG=1 on the server, or this does nothing)')
        # headless Chromium can't lock the pointer: hide the prompt so the shim reports gameplay, then drive the wizard
        await pg.evaluate("for (const s of ['#clickToPlay', '#lockPrompt']) document.querySelector(s)?.classList.add('hidden')")
        driven = await pg.evaluate(DRIVE)
        print('  driver', 'on' if driven else 'off (no window.__wa)')
        await pg.keyboard.down('KeyW')
        t0, i, shot_mid, recap_dom = time.time(), -1, False, None
        while time.time() - t0 < SECONDS:
            i += 1
            if i % 6 == 0:
                for kc in ('KeyA', 'KeyD', 'ShiftLeft'): await pg.keyboard.up(kc)
                side = ('KeyA', 'KeyD', None)[(i // 6) % 3]
                if side: await pg.keyboard.down(side)
                if (i // 6) % 4 == 1: await pg.keyboard.down('ShiftLeft')
            if SHOT and not shot_mid and time.time() - t0 > 20:
                await pg.screenshot(path=SHOT, timeout=120000); shot_mid = True; print('  screenshot:', SHOT)
            if S['closed']: break
            if S['end'] and S['recap']:
                # the podium is up: wait for it to show, check the DOM while it's on, then wait for the rematch countdown
                await pg.wait_for_timeout(1500)
                recap_dom = await pg.evaluate(RECAP_DOM)
                if SHOT: await pg.screenshot(path=SHOT.replace('.png', '-recap.png'), timeout=120000); print('  screenshot:', SHOT.replace('.png', '-recap.png'))
                for _ in range(40):
                    if S['rematch']: break
                    await pg.wait_for_timeout(500)
                break
            await pg.wait_for_timeout(500)
        for kc in ('KeyW', 'KeyA', 'KeyD', 'ShiftLeft'): await pg.keyboard.up(kc)
        played = time.time() - t0
        if recap_dom is None: recap_dom = await pg.evaluate(RECAP_DOM)
        await b.close()

    phases = [ph for ph, _, _ in S['phases']]
    live = [m for ph, _, m in S['phases'] if ph == 'live']
    print(f"phases seen: {phases}; match messages: {sorted(S['types'])}")
    print(f"played {played:.0f} s: my kills {S['kills']}, my deaths {S['deaths']}, players seen {sorted(S['names'])}, bots {sorted(S['bots'])}")
    check('live' in phases, 'the match went live')
    e = S['end'] or {}
    r = e.get('results') or {}
    check(bool(e), f"the match ended: reason {r.get('reason')!r}, target {r.get('target')}, winner {r.get('winner')}, {len(r.get('players', []))} players scored")
    if e: check(r.get('reason') in ('target', 'cap'), 'ended at the target or the cap')
    check(bool(S['recap']), f"the recap message arrived ({len((S['recap'] or {}).get('podium', []))} on the podium)")
    check(recap_dom['recap'] or recap_dom['podium'], f'the old client showed the recap: {recap_dom}')
    check(S['rematch'], 'the rematch countdown followed')
    if GEN == 'v22':
        mids = sorted({(mm.get('map') or {}).get('id') if isinstance(mm.get('map'), dict) else mm.get('map') for _, _, mm in S['phases'] if mm.get('map')} | {(x or {}).get('id') if isinstance(x, dict) else x for x in S.get('maps', [])})
        check(mids == ['courtyard'], f"the courtyard in every match message, through the rematch, and no map change ({mids}; map messages {len(S.get('maps', []))})")
    # round 26: an older build (no proto, 22, 24) never receives the XP / progress / challenge / emote / taunt / look messages, nor a welcome.progress
    new26 = sorted(S['types'] & {'xp', 'progress', 'challenge', 'emote', 'taunt', 'look'})
    check(not new26 and 'progress' not in (S['welcome'] or {}), f"no round-26 messages for this older client (saw {new26 or 'none'}; welcome.progress {'present' if 'progress' in (S['welcome'] or {}) else 'absent'})")
    check(S['closed'] is None, 'the socket stayed open' if S['closed'] is None else f"the socket closed after {S['closed'] - t0:.0f} s")
    check(len(S['bots']) >= 1 and len(S['names']) >= 4, '4 in the match (bots filled the seats)')
    starts = sum('gameplayStart' in c for c in cg)
    check(starts >= 1 or not cg, f'SDK shim: {len(cg)} events, {starts} gameplayStart' if cg else 'SDK shim: no log (no ?cgdebug build)')
    check(not failed, f'no failed requests: {failed[:5] or "none"}')
    check(not errs, f'no console or page errors: {errs[:5] or "none"}')
    unknown = sorted(k for k in S['keys'] if k.split('.')[-1] in ('runes', 'pads', 'portals', 'map', 'legacy'))
    print('fields the old client never knew, seen in welcome / snap:' if GEN == 'legacy' else 'map / rune / pad fields seen in welcome / snap (the v22 client knows them):', unknown or 'none')
    print(f"websocket {S.get('url')}: sent {S['sent']}, received {S['recv']}")
    print('RESULT:', 'PASS' if ok else 'FAIL')
    sys.exit(0 if ok else 1)

asyncio.run(main())
