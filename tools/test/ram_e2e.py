# Browser test (round 15, replaces goat_e2e.py): the rams render and work, and bots are Skeletons.
#   1. Ram Guard: 3 rams circle us.  2. Battering Ram: a ghost ram, then a charging ram.
#   3. A hard Sling bot calls rams on us: the '!' hint and a ram view homing on us.  4. A Skeleton bot up close.
# usage: python3 tools/test/ram_e2e.py <port> <screenshot dir>
import asyncio, sys, json
from playwright.async_api import async_playwright
PORT = sys.argv[1]
OUT = sys.argv[2] + '/'
JEB = {'primary': 'sling', 'power': 'battering_ram', 'guard': 'ram_guard', 'mobility': 'ram_ride', 'utility': 'roll', 'ultimate': 'stampede'}
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        pg = await b.new_page(viewport={'width': 1280, 'height': 720})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        await pg.add_init_script(f"localStorage.setItem('wizardLoadout', {json.dumps(json.dumps(JEB))}); localStorage.setItem('waSeenHowTo', '1');")
        await pg.goto('http://localhost:' + PORT + '/?debug=1')
        await pg.wait_for_function("!document.querySelector('#joinBtn').disabled", timeout=90000)
        if await pg.locator('.htp-close').count(): await pg.locator('.htp-close').first.click()
        await pg.click('#joinBtn')
        await pg.wait_for_function("window.__wa && window.__wa.local && [...window.__wa.players.values()].length >= 1", timeout=20000)
        await pg.evaluate("() => window.__wa.net.send({ t: 'removeBots' })")
        await pg.wait_for_timeout(4500)   # (past the "Get ready" countdown: no casting before it)
        res = {}
        # 1. Ram Guard
        for _ in range(12):   # (refused until the spawn countdown is over: try each second)
            await pg.evaluate("() => { const L = window.__wa.local; L.pitch = -0.25; window.__wa.net.send({ t: 'ramGuard' }); }")
            await pg.wait_for_timeout(1000)
            res['guard_rams'] = await pg.evaluate("() => [...window.__wa.rams.values()].filter(r => r.mode === 'orbit').length")
            if res['guard_rams']: break
        await pg.screenshot(path=OUT + 'ram_guard.png')
        await pg.wait_for_timeout(3500)
        # 2. Battering Ram along our facing
        await pg.evaluate("() => { const L = window.__wa.local; window.__wa.net.send({ t: 'ram', dir: [Math.sin(L.yaw), 0, Math.cos(L.yaw)] }); }")
        await pg.wait_for_timeout(400); await pg.screenshot(path=OUT + 'ram_battering_windup.png')
        await pg.wait_for_timeout(700)
        res['battering_charging'] = await pg.evaluate("() => [...window.__wa.rams.values()].filter(r => r.state === 'charge' && r.mode === 'charge').length")
        await pg.screenshot(path=OUT + 'ram_battering_charge.png')
        await pg.wait_for_timeout(3000)
        # 3. a Sling bot calls rams on us
        await pg.evaluate(f"() => window.__wa.net.send({{ t: 'addBot', difficulty: 'hard', loadout: {{ ...{json.dumps(JEB)}, power: 'meteor', guard: 'ward', mobility: 'blink' }} }})")
        seen = {'hunted': False, 'homing': False, 'calls': 0, 'body': None}
        for i in range(160):
            await pg.wait_for_timeout(150)
            st = await pg.evaluate("""() => { const w = window.__wa, me = [...w.players.values()].find(p => !p.botLevel), bot = [...w.players.values()].find(p => p.botLevel);
              if (bot && !me.dead) { const L = w.local, b = bot.group.position; L.yaw = Math.atan2(b.x - L.pos.x, b.z - L.pos.z) + Math.PI; }   // back to it: no blocking
              return { hint: document.querySelector('#hint')?.textContent || '', homing: [...w.rams.values()].some(r => r.tgt === me.id), body: bot?.bodyKind, kind: bot?.body?.kind,
                dead: me.dead, deaths: me.deaths }; }""")
            if 'ram is charging you' in st['hint']: seen['hunted'] = True
            if st['homing'] and not seen['homing']: seen['homing'] = True; await pg.screenshot(path=OUT + 'ram_sling_call.png')
            seen['body'] = st['body']; seen['kind'] = st['kind']; seen['deaths'] = st['deaths']
            if seen['hunted'] and seen['homing'] and i > 40: break
        res.update(seen)
        # 4. the Skeleton bot, from 4 m
        await pg.evaluate("""() => { const w = window.__wa, L = w.local, bot = [...w.players.values()].find(p => p.botLevel); if (!bot) return;
          const b = bot.group.position; L.pos.set(b.x + 4, b.y, b.z); L.yaw = Math.atan2(b.x - L.pos.x, b.z - L.pos.z); L.pitch = -0.05; }""")
        await pg.wait_for_timeout(500); await pg.screenshot(path=OUT + 'ram_skeleton_bot.png')
        print(json.dumps(res))
        print('errors', errs[:10])
        await b.close()
asyncio.run(main())
