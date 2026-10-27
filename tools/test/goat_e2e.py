# Browser test: anger a goat and take the hit, then anger one and ward it.
# usage: python3 tools/test/goat_e2e.py <port> <screenshot dir>
import asyncio, sys
from playwright.async_api import async_playwright
PORT=sys.argv[1]
OUT=sys.argv[2]+'/'
AIM = """(gid) => { const w=window.__wa, L=w.local, g=w.goats.get(gid).group.position;
  L.yaw = Math.atan2(g.x-L.pos.x, g.z-L.pos.z); return Math.hypot(g.x-L.pos.x, g.z-L.pos.z); }"""
SHOOT = """(gid) => { const w=window.__wa, L=w.local, g=w.goats.get(gid).group.position;
  const o=[L.pos.x, 1.3, L.pos.z]; const d=[g.x-o[0], 0.7-o[1], g.z-o[2]]; const l=Math.hypot(...d);
  w.net.send({t:'cast', kind:'fast', origin:o, dir:d.map(v=>v/l)}); }"""
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(args=['--use-angle=swiftshader','--enable-unsafe-swiftshader']); pg=await b.new_page(viewport={'width':1280,'height':720})
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type=='error' else None)
        await pg.goto('http://localhost:' + PORT + '')
        await pg.wait_for_function("!document.querySelector('#joinBtn').disabled", timeout=60000)
        await pg.select_option('#botCount','0'); await pg.click('#joinBtn')
        await pg.wait_for_function("window.__wa && window.__wa.goats.size === 4", timeout=15000)
        # look at the farmhouse first
        await pg.evaluate("() => { const L=window.__wa.local; L.yaw = Math.atan2(9-L.pos.x, 48-L.pos.z); L.pitch=0.05; }")
        await pg.wait_for_timeout(1200); await pg.screenshot(path=OUT+'g_farmhouse.png')
        for trial in ['noblock','block']:
            await pg.wait_for_function("!window.__wa.players.get(window.__wa.local && [...window.__wa.players.values()].find(p=>!p.bot).id).dead", timeout=15000)
            gid = None
            await pg.evaluate("""() => { const w=window.__wa, L=w.local; const gs=[...w.goats.values()].map(g=>g.group.position);
              const c=gs.reduce((a,p)=>[a[0]+p.x/gs.length,a[1]+p.z/gs.length],[0,0]); const l=Math.hypot(...c)||1;
              L.pos.set(c[0]-c[0]/l*11, 0, c[1]-c[1]/l*11); }""")
            await pg.wait_for_timeout(800)
            for _ in range(40):
                gid = await pg.evaluate("""async () => { const C = await import('/shared/constants.js'); const w=window.__wa, L=w.local; let best=null, bd=1e9;
                  for (const g of w.goats.values()) { const p=g.group.position; const d=Math.hypot(p.x-L.pos.x, p.z-L.pos.z);
                    if (g.state!=='graze' && g.state!=='wander') continue;
                    if (C.pillarBlocks([L.pos.x,0,L.pos.z],[p.x,0,p.z],0.5) || C.TREES.some(t=>{const sx=p.x-L.pos.x, sz=p.z-L.pos.z; const k=Math.max(0,Math.min(1,((t.x-L.pos.x)*sx+(t.z-L.pos.z)*sz)/(sx*sx+sz*sz))); return Math.hypot(L.pos.x+sx*k-t.x, L.pos.z+sz*k-t.z) < 1.2;})) continue;
                    if (d<bd && d>5 && d<22){bd=d;best=g.id;} } return best; }""")
                if gid: break
                await pg.wait_for_timeout(500)
            d = await pg.evaluate(AIM, gid); print(trial, 'goat', gid, 'dist', round(d,1))
            if trial=='block': await pg.keyboard.down('Space')
            await pg.evaluate(SHOOT, gid)
            await pg.wait_for_timeout(450)
            await pg.evaluate(AIM, gid); await pg.screenshot(path=OUT+f'g_{trial}_windup.png')
            for i in range(30):
                await pg.evaluate(AIM, gid)   # keep facing it
                await pg.wait_for_timeout(100)
                if i==7: await pg.screenshot(path=OUT+f'g_{trial}_charge.png')
            if trial=='block': await pg.keyboard.up('Space')
            st = await pg.evaluate("() => { const w=window.__wa; const me=[...w.players.values()].find(p=>!p.bot); return {dead: me.dead, deaths: me.deaths, st: me.st, hint: document.querySelector('#hint').textContent, death: document.querySelector('#deathScreen .big').textContent, goat: [...w.goats.values()].map(g=>g.state) } }")
            print(' result', st)
            await pg.wait_for_timeout(4000)
        print('errors', errs[:10]); await b.close()
asyncio.run(main())
