# Action key art for the CrazyGames store (round 25): a staged in-engine render, graded and titled.
# usage: WA_DEBUG=1 MATCH_DEBUG=1 PORT=4103 node server.js &   (a private port; never the live server)
#        python3 deploy/capture_cover.py http://localhost:4103 [out dir=deploy/crazygames/store/covers] [--variants gate,court,meteor]
#                                        [--work /tmp/wa-cover] [--only landscape,portrait,square] [--pick duel2] [--swiftshader]
# Variants (round 29, Siege Keep): gate and court (the Meteor wind-up's thrust, Ty's round-25 pick, before the gatehouse or in the
# courtyard), meteor (the 'heavy' projectile at a skeleton mage). Spots come from a clear-line search (every camera sees the head, tip, fireball and target; 2.5 m free round both).
# Writes cover-action-<variant>-{landscape-1920x1080,portrait-800x1200,square-800x800}.jpg into the out dir (and the raw
# renders, masks and a 300 px comparison sheet into --work). Pick the best variant by eye and copy it to the unsuffixed
# cover-action-{landscape-1920x1080,...}.jpg names (--pick <variant> does the copy).
#
# How: the game page with ?debug (window.__wa) joins a private room (?room=new, the first-visit Pyromancer loadout); the
# room's own wizards are hidden at render time and our player is parked far away, so the stage is ours. The stage is
# real game content only: two bodies from looks.js (the Pyromancer in the cinder kit, a skeleton warrior: the bots' body),
# frozen on frames of the KayKit clips the game plays, and the game's own Fireball (effects.js spawnProjectile, its trail
# and its impact burst), flown from the staff tip and frozen mid-flight by stopping effects.update. Lighting is staged: an
# orange point light at the fireball, a cool rim from behind, the sun and sky light lowered and tinted, the sky texture
# graded toward dusk. A second render with only the two bodies (white on black) is the mask for the depth of field.
# Post (Python): bloom from the 2x render, saturation and contrast, a warm-cool split, a vignette, speed streaks behind the
# fireball, a background blur outside the mask, then the title ("WIZARD ARENA", Luckiest Guy from Google Fonts: only used
# for this image) as a chunky game logo rendered by Chromium with a transparent background and composited.
# Title placement follows the CrazyGames label rules: landscape top-right (clear of the top-left label zone, ~35% x 30%),
# portrait and square bottom centre.
import asyncio, json, math, os, shutil, sys, time
from playwright.async_api import async_playwright
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

def opt(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
GL_ARGS = (['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] if '--swiftshader' in sys.argv
           else ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'])
pos = [a for i, a in enumerate(sys.argv[1:], 1) if not a.startswith('--') and sys.argv[i - 1] not in ('--variants', '--work', '--pick', '--only')]
URL = pos[0].rstrip('/')
OUT = pos[1] if len(pos) > 1 else 'deploy/crazygames/store/covers'
WORK = opt('--work', '/tmp/wa-cover')
PICK = opt('--pick', None)
os.makedirs(OUT, exist_ok=True); os.makedirs(WORK, exist_ok=True)
SIZES = {'landscape': (1920, 1080), 'portrait': (800, 1200), 'square': (800, 800)}
ONLY = opt('--only', ','.join(SIZES)).split(',')
SS = 2   # render at 2x and downsample (cleaner edges; the bloom is taken from the big frame)

# ---------------------------------------------------------------- the variants
# A duel in a local frame: M the mage's feet, d the direction to the target (yaw), p = d turned right (screen side), up.
# cam: position M + d*f + p*s + up*h, looking at M + d*lf + up*lh (fov). u: how far the fireball has flown (0..1) when frozen.
# Per-aspect cameras shared by the variants (a variant's own cams override). Portrait and square restage the duel tighter
# (`dist`, `u`): a front three-quarter view of the mage and a target 5 m away don't fit a 2:3 frame; the title goes at the
# bottom there, so the camera looks low (the bodies sit high in the frame).
CAMS = {'landscape': dict(f=2.0, s=-3.8, h=0.75, lf=2.35, lh=1.55, fov=55),
        'portrait': dict(dist=3.0, u=0.38, f=1.5, s=-5.2, h=0.8, lf=1.5, lh=0.45, fov=68),
        'square': dict(dist=4.0, u=0.5, f=1.8, s=-4.8, h=0.8, lf=2.0, lh=0.4, fov=66)}
VARIANTS = {
    # Round 29: Siege Keep is the only map the client has (the courtyard is server-only now), so the stages moved there; the poses are
    # round 25's (duel2's Meteor wind-up was Ty's pick). gate: on the road south of the moat, the gatehouse, drawbridge and walls behind.
    'gate': dict(map='keep', M=[2.6, 0, -21.6], yaw=-math.pi / 2, dist=5.2,
                 mage=dict(clip='Ranged_Magic_Spellcasting_Long', t=1.6, turn=-0.3, nod=0.25), skel=dict(kind='skeleton_warrior', clip='Hit_A', t=0.18, turn=0.5),
                 u=0.5, big=1.5, keyI=26,
                 cams={'landscape': dict(f=2.0, s=-3.8, h=0.75, lf=2.35, lh=1.55, fov=55)}),
    # court: in the keep's courtyard, the hex tower and the NE tower behind
    'court': dict(map='keep', M=[3.2, 0, -5.6], yaw=-math.pi / 2, dist=5.2,
                  mage=dict(clip='Ranged_Magic_Spellcasting_Long', t=1.6, turn=-0.3, nod=0.25), skel=dict(kind='skeleton_warrior', clip='Hit_A', t=0.18, turn=0.5),
                  u=0.5, big=1.5, keyI=26,
                  cams={'landscape': dict(f=2.0, s=-3.8, h=0.75, lf=2.35, lh=1.55, fov=55)}),
    # Meteor: the Pyromancer's power spell (the game's 'heavy' projectile) at the end of its wind-up, a skeleton mage knocked back, by the gate
    'meteor': dict(map='keep', M=[2.5, 0, -22.0], yaw=-math.pi / 2, dist=5.0, kind='heavy',
                   mage=dict(clip='Ranged_Magic_Spellcasting_Long', t=1.6, turn=-0.3, nod=0.25), skel=dict(kind='skeleton_mage', clip='Hit_B', t=0.15, turn=0.45),
                   u=0.48, big=1.6, keyI=30,
                   cams={'landscape': dict(f=2.3, s=-3.4, h=0.7, lf=2.45, lh=1.6, fov=60)}),
}

# ---------------------------------------------------------------- in the page
JOIN_WAIT = "window.__wa?.local && !document.querySelector('#hud').classList.contains('hidden')"
UI_OFF = "document.getElementById('__capcss') || document.head.insertAdjacentHTML('beforeend', '<style id=__capcss>body *{visibility:hidden!important} canvas{visibility:visible!important}</style>')"

STAGE = r"""async (V) => {
  const wa = window.__wa, THREE = await import('three'), LK = await import('./js/looks.js'), W = await import('./shared/wizards.js');
  const C = wa.C, scene = wa.scene, pool = LK.poolClips();
  wa.Q?.setSetting?.('high');
  // park our player far from the stage and hide every live wizard (bots included) at render time
  const far = [...C.SPAWN_POINTS].map(s => ({ x: s[0], y: s[1] || 0, z: s[2] })).sort((a, b) => Math.hypot(b.x - V.M[0], b.z - V.M[2]) - Math.hypot(a.x - V.M[0], a.z - V.M[2]))[0];
  wa.net.send({ t: 'debugPlace', p: [far.x, far.y, far.z] }); wa.local.pos.set(far.x, far.y, far.z);
  if (window.__stage) { window.__stage.root.removeFromParent(); }
  const root = new THREE.Group(); root.name = 'coverStage'; scene.add(root);
  const d = new THREE.Vector3(Math.sin(V.yaw), 0, Math.cos(V.yaw)), p = new THREE.Vector3(d.z, 0, -d.x), up = new THREE.Vector3(0, 1, 0);
  const M = new THREE.Vector3(...V.M), S = M.clone().addScaledVector(d, V.dist);
  S.y = C.surfaceHeight(S.x, S.z, M.y + 0.5);
  const pose = (body, clip, t) => { const c = pool[clip]; const m = new THREE.AnimationMixer(body.model), a = m.clipAction(c); a.play(); a.paused = true; a.time = Math.min(t, c.duration - 0.01); m.update(0); return m; };
  const mage = LK.makeWizardBody(W.WIZARDS.cinder.kit, { aura: 'full' });
  mage.model.position.copy(M); mage.model.rotation.y = V.yaw + (V.mage.turn || 0); root.add(mage.model);
  pose(mage, V.mage.clip, V.mage.t); mage.updateGrip?.(0);
  if (V.mage.nod && mage.head) mage.head.rotateX(V.mage.nod);   // head and hat tipped down: a determined look (the face can't change)
  const skel = LK.makeWizardBody({ primary: 'hex', power: 'curse' }, { body: V.skel.kind, aura: 'cheap' });
  skel.model.position.copy(S); skel.model.rotation.y = V.yaw + Math.PI + (V.skel.turn || 0); root.add(skel.model);
  pose(skel, V.skel.clip, V.skel.t);
  root.updateMatrixWorld(true);
  const tip = new THREE.Vector3(); (mage.tip || mage.hand).getWorldPosition(tip);
  const chest = S.clone().setY(S.y + 1.05);
  // lighting: the sun and sky light down and tinted toward dusk; an orange key at the fireball; a cool rim from behind
  const saved = window.__stageSaved || (window.__stageSaved = { lights: [], bg: scene.background, fog: scene.fog && scene.fog.color.getHex(), fogNear: scene.fog?.near, fogFar: scene.fog?.far });
  scene.traverse(o => { if (o.isHemisphereLight) { o.userData.capI ??= o.intensity; o.intensity = o.userData.capI * (V.hemi ?? 0.55); o.color.setHex(V.hemiColor ?? 0x9a8ee0); o.groundColor?.setHex(0x3a2a4a); }
    if (o.isDirectionalLight && !o.userData.cover) { o.userData.capI ??= o.intensity; o.intensity = o.userData.capI * (V.sun ?? 0.5); o.color.setHex(V.sunColor ?? 0xffb27a); } });
  if (scene.fog) { scene.fog.color.setHex(V.fog ?? 0x6a5a9a); }
  const key = new THREE.PointLight(0xff8a2a, V.keyI ?? 60, 14, 1.6); key.userData.cover = true; root.add(key);
  const tipL = new THREE.PointLight(0xffa040, (V.keyI ?? 60) * 0.35, 6, 1.8); tipL.position.copy(tip); root.add(tipL);
  const rim = new THREE.DirectionalLight(V.rimColor ?? 0x7a6cff, V.rimI ?? 3.2); rim.userData.cover = true;
  const camGuess = M.clone().addScaledVector(d, 1.8).addScaledVector(p, -2.8);
  rim.position.copy(M).addScaledVector(camGuess.clone().sub(M).normalize(), -10).setY(M.y + 6); rim.target.position.copy(M.clone().addScaledVector(d, V.dist / 2)); root.add(rim, rim.target);
  // the sky: the painted texture graded toward dusk (dark violet up top, a warm band at the horizon)
  if (saved.bg && saved.bg.image && !window.__duskBg) {
    const img = saved.bg.image, cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'multiply';
    const gr = g.createLinearGradient(0, 0, 0, cv.height);
    gr.addColorStop(0, '#2a1d5e'); gr.addColorStop(0.3, '#5a3f9a'); gr.addColorStop(0.47, '#d88a8a'); gr.addColorStop(0.53, '#ffb070'); gr.addColorStop(1, '#4a3a6a');
    g.fillStyle = gr; g.fillRect(0, 0, cv.width, cv.height);
    const t = new THREE.CanvasTexture(cv); t.mapping = saved.bg.mapping; t.colorSpace = saved.bg.colorSpace; t.flipY = saved.bg.flipY;
    window.__duskBg = t;
  }
  if (window.__duskBg && V.dusk !== false) scene.background = window.__duskBg;
  // the Fireball: the game's own projectile, bigger, flown from the staff tip at the skeleton's chest and frozen mid-flight
  const fx = wa.effects;
  if (fx.__update0) fx.update = fx.__update0;
  fx.__update0 = fx.update;
  fx.clearAll();
  const dir = chest.clone().sub(tip), L = dir.length(); dir.normalize();
  const speed = 9;
  fx.spawnProjectile({ id: 'cover-fb', kind: V.kind || 'fireball', p: tip.toArray(), v: dir.clone().multiplyScalar(speed).toArray(), fin: true, life: 10 });
  const pr = fx.projectiles.get('cover-fb');
  pr.group.scale.setScalar(Math.min(V.big, 1.3));
  if (pr.group.userData.ring) pr.group.userData.ring.visible = false;   // (the finisher's ring read as a portal at this size)
  // a fat ball of flame round the hot core: alpha-blended orange layers (additive ones bloomed to a white disc)
  const glow = [fx.S('fire_01', { follow: pr.group, size: 1.25 * V.big, life: 60, spin: 1.5, color: 0xff7a1e, alpha: 0.95, fadeIn: 0, add: false }),
                fx.S('fire_02', { follow: pr.group, size: 1.05 * V.big, life: 60, spin: -1.2, color: 0xffa040, alpha: 0.95, fadeIn: 0, add: false }),
                fx.S('flame_03', { follow: pr.group, size: 0.75 * V.big, life: 60, spin: -2, color: 0xffd070, alpha: 0.9, fadeIn: 0, add: false })];
  // the meshes: the white core smaller and warmer (up close it read as a white plate), the faceted outer shell hidden
  const [core, flame] = pr.group.children;
  if (core) { core.material = core.material.clone(); core.material.toneMapped = false; core.material.color.setHex(0xfff6dc); core.scale.multiplyScalar(0.75); }
  if (flame && (V.kind || 'fireball') !== 'fireball') flame.visible = false;   // (the Meteor's glow sphere read as a flat disc)
  else if (flame) { flame.material = flame.material.clone(); flame.material.toneMapped = false; flame.material.color.setHex(0xff6a10); flame.material.opacity = 0.8; flame.scale.multiplyScalar(0.6); }
  if (pr.group.userData.shell) pr.group.userData.shell.visible = false;
  // fly it in real time (its trail is emitted on the way), burst on the skeleton just before the freeze
  await new Promise(res => {
    let burst = false, n = 0, wrapped = false;
    const tick = () => {
      const k = pr.pos.distanceTo(tip) / L;
      if ((n++ & 1) === 0) fx.fireBurst(pr.pos, 0.3 * V.big, 1);   // a fatter flame trail than a normal cast
      if (!burst && k > V.u - 0.18) { burst = true; fx.burst(chest, 0xff7a1e, 40, 7, 0.75); fx.fireBurst(chest, 1.3, 10); fx.sparks(chest, 0xffc060, 26, 9, 0.5); fx.flash(chest, 0xffa040, 2.2); }
      if (k >= V.u - 0.06 && !wrapped) { wrapped = true; for (let i = 0; i < 4; i++) fx.fireBurst(pr.pos, 0.6 * V.big, 7); }   // ragged flames round the ball
      if (k >= V.u) { fx.update = () => {}; res(); } else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  key.position.copy(pr.pos);
  // the camera: fixed per aspect; window.__cover.aspect picks one
  const camFor = (c) => ({ p: M.clone().addScaledVector(d, c.f).addScaledVector(p, c.s).addScaledVector(up, c.h), l: M.clone().addScaledVector(d, c.lf).addScaledVector(up, c.lh), fov: c.fov });
  const cams = Object.fromEntries(Object.entries(V.cams).map(([k, c]) => [k, camFor(c)]));
  const pts = { head: mage.head, tip: mage.tip || mage.hand, fire: pr.group, chest: skel.head || skel.model };
  window.__stage = { root, cams, mage, skel, pr, pts };
  if (!wa.renderer.__coverWrapped) {
    const render = wa.renderer.render.bind(wa.renderer);
    wa.renderer.render = (sc, cam) => {
      const st = window.__stage, cv = window.__cover;
      for (const w of wa.players.values()) w.group.visible = false;
      if (!window.__pickHidden) { window.__pickHidden = []; sc.traverse(o => { if (o.userData?.cat === 'pickups' && o.visible) window.__pickHidden.push(o); }); }
      for (const o of window.__pickHidden) o.visible = false;
      if (!st || !cv || !st.cams[cv.aspect]) return render(sc, cam);   // (between a re-stage and the next aspect)
      const c = st.cams[cv.aspect];
      cam.position.copy(c.p); cam.lookAt(c.l); cam.fov = c.fov; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      if (!cv.mask) return render(sc, cam);
      // the mask: the two bodies alone, white on black
      const vis = [];
      sc.traverse(o => { if (o !== sc && o.visible && !o.isLight) { let k = o, ours = false; while (k) { if (k === st.root) { ours = true; break; } k = k.parent; }
        const keep = ours && !(o.name === 'aura' || o.isPoints || o.isSprite) && !o.isLight; if (!keep && o.parent?.visible !== false) { vis.push(o); } } });
      const hid = vis.filter(o => { let k = o, ours = false; while (k) { if (k === st.root) { ours = true; break; } k = k.parent; } return !ours || o.name === 'aura' || o.isPoints || o.isSprite; });
      for (const o of hid) o.visible = false;
      const bg = sc.background, fog = sc.fog, om = sc.overrideMaterial;
      sc.background = new THREE.Color(0x000000); sc.fog = null; sc.overrideMaterial = window.__maskMat ??= new THREE.MeshBasicMaterial({ color: 0xffffff });
      const tm = wa.renderer.toneMapping; wa.renderer.toneMapping = THREE.NoToneMapping;
      render(sc, cam);
      wa.renderer.toneMapping = tm; sc.background = bg; sc.fog = fog; sc.overrideMaterial = om;
      for (const o of hid) o.visible = true;
    };
    wa.renderer.__coverWrapped = true;
  }
  // occlusion: the map between each camera and what it must show (the map's own segment test, and the round colliders)
  const blocked = {};
  for (const [k, c] of Object.entries(cams)) {
    const hits = [];
    const targets = { head: M.clone().setY(M.y + 1.6), tip, fire: pr.pos.clone(), chest };
    for (const [n, t] of Object.entries(targets)) {
      const h = C.surfaceSegmentHit(c.p.toArray(), t.toArray());
      if (h && h.t < 0.97) hits.push(n + '@' + h.t.toFixed(2));
      for (const col of C.COLLIDERS) { if (col.h < Math.min(c.p.y, t.y) - 0.2) continue;
        const ax = c.p.x, az = c.p.z, bx = t.x - ax, bz = t.z - az, L2 = bx * bx + bz * bz || 1, u = Math.max(0, Math.min(0.95, ((col.x - ax) * bx + (col.z - az) * bz) / L2));
        if (Math.hypot(ax + bx * u - col.x, az + bz * u - col.z) < col.r) { hits.push(n + ':col'); break; } }
    }
    if (C.surfaceSolidAt(c.p.x, c.p.y, c.p.z)) hits.push('camera inside');
    blocked[k] = hits;
  }
  return { blocked, M: M.toArray(), S: S.toArray(), tip: tip.toArray().map(v => +v.toFixed(2)), fire: pr.pos.toArray().map(v => +v.toFixed(2)), L: +L.toFixed(2) };
}"""

# screen positions (0..1) of the stage's points, for the streaks and the focus
PROJECT = r"""() => { const wa = window.__wa, st = window.__stage, cam = wa.camera, out = {};
  for (const [k, o] of Object.entries(st.pts)) { const v = o.getWorldPosition(new cam.position.constructor()); if (k === 'chest') v.y -= 0.35; v.project(cam); out[k] = [(v.x + 1) / 2, (1 - v.y) / 2]; }
  const v = st.pr.vel ? st.pr.vel.clone() : null;
  if (v) { const a = st.pr.pos.clone().project(cam), b = st.pr.pos.clone().sub(v.normalize()).project(cam); out.back = [(b.x - a.x) / 2, -(b.y - a.y) / 2]; }
  return out; }"""

# ---------------------------------------------------------------- the title (a transparent PNG from Chromium)
TITLE_HTML = """<!doctype html><html><head><meta charset=utf-8>
<link href="https://fonts.googleapis.com/css2?family=Luckiest+Guy&display=block" rel=stylesheet>
<style>
html,body{margin:0;background:transparent}
.logo{position:relative;display:inline-block;padding:%(pad)dpx;transform:rotate(-4deg);transform-origin:50%% 50%%}
.l{display:block;font:%(size)dpx/0.92 'Luckiest Guy',sans-serif;letter-spacing:.02em;text-align:center;white-space:nowrap}
.stack{position:relative}
.stack span{position:absolute;left:0;right:0;top:0}
.ext{color:#2a0f45;-webkit-text-stroke:%(stroke)dpx #2a0f45;text-shadow:%(ext)s}
.out{color:transparent;-webkit-text-stroke:%(stroke)dpx #2a0f45}
.fill{background:linear-gradient(180deg,#fff6b0 0%%,#ffd23a 38%%,#ff9a1a 70%%,#ff5a12 100%%);-webkit-background-clip:text;background-clip:text;color:transparent}
.shine{background:linear-gradient(180deg,rgba(255,255,255,.75) 0%%,rgba(255,255,255,0) 42%%);-webkit-background-clip:text;background-clip:text;color:transparent;clip-path:inset(0 0 55%% 0)}
.small{font-size:%(small)dpx}
.glint{position:absolute;width:%(gl)dpx;height:%(gl)dpx;left:%(glx)s;top:%(gly)s;
background:radial-gradient(circle,#fff 0,#fff 6%%,rgba(255,240,200,.6) 14%%,rgba(255,200,120,0) 40%%),
linear-gradient(0deg,transparent 47%%,#fff 50%%,transparent 53%%),linear-gradient(90deg,transparent 47%%,#fff 50%%,transparent 53%%);
filter:drop-shadow(0 0 %(gls)dpx rgba(255,220,140,.9))}
</style></head><body><div class=logo id=logo>
<div class=stack>%(lines)s</div><div class=glint></div></div></body></html>"""

async def render_title(browser, path, size, two_lines):
    stroke = max(6, int(size * 0.075))
    depth = max(6, int(size * 0.11))
    ext = ','.join(f'0 {i}px 0 #2a0f45' for i in range(1, depth + 1)) + f',0 {depth + int(size * .05)}px {int(size * .12)}px rgba(10,0,25,.75)'
    words = ['WIZARD', 'ARENA'] if two_lines else ['WIZARD ARENA']
    lines = ''
    for w in words:
        lines += (f'<div class="l" style="position:relative"><span class="ext" style="position:relative;display:block">{w}</span>'
                  f'<span class="out" style="position:absolute;left:0;right:0;top:0">{w}</span>'
                  f'<span class="fill" style="position:absolute;left:0;right:0;top:0">{w}</span>'
                  f'<span class="shine" style="position:absolute;left:0;right:0;top:0">{w}</span></div>')
    pg = await browser.new_page(viewport={'width': int(size * 8), 'height': int(size * 4)})
    await pg.set_content(TITLE_HTML % dict(size=size, pad=int(size * 0.3), stroke=stroke, ext=ext, lines=lines, small=int(size * 0.8),
                                           gl=int(size * 0.75), glx='78%' if two_lines else '88%', gly='-2%', gls=int(size * 0.08)))
    await pg.evaluate('document.fonts.ready')
    await pg.wait_for_timeout(300)
    ok = await pg.evaluate("document.fonts.check('40px \"Luckiest Guy\"')")
    await pg.locator('#logo').screenshot(path=path, omit_background=True)
    await pg.close()
    return ok

# ---------------------------------------------------------------- post
luma = lambda a: a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722
def grade(raw_path, mask_path, pts, out_size, aspect):
    W, H = out_size
    img = np.asarray(Image.open(raw_path).convert('RGB')).astype(np.float32) / 255.0
    h, w = img.shape[:2]
    mask = np.asarray(Image.open(mask_path).convert('L').filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(w / 400))).astype(np.float32) / 255.0
    # depth of field: blur outside the bodies (and a disc round the fireball and the impact)
    yy, xx = np.mgrid[0:h, 0:w]
    focus = mask.copy()
    for k, r in (('fire', 0.12), ('chest', 0.1)):
        if k in pts:
            fx, fy = pts[k][0] * w, pts[k][1] * h
            focus = np.maximum(focus, np.clip(1.4 - np.hypot(xx - fx, yy - fy) / (r * max(w, h)), 0, 1))
    blurred = np.asarray(Image.fromarray((img * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(w / 520))).astype(np.float32) / 255.0
    img = img * focus[..., None] + blurred * (1 - focus[..., None])
    # bloom: the bright parts, blurred at three radii, screened on
    lum = luma(img)
    bright = img * np.clip((lum - 0.78) / 0.2, 0, 1)[..., None]
    b8 = Image.fromarray((np.clip(bright, 0, 1) * 255).astype(np.uint8))
    bloom = sum(np.asarray(b8.filter(ImageFilter.GaussianBlur(w * r))).astype(np.float32) / 255.0 * k for r, k in ((0.004, 0.45), (0.012, 0.4), (0.035, 0.35)))
    img = 1 - (1 - img) * (1 - np.clip(bloom, 0, 1))
    # the spell's light: a white-hot centre through yellow to orange on the fireball, a cast flash at the staff tip and the
    # impact's glow on the target (screened on, like the bloom; positions are the stage's own projected points)
    def glow(at, r, cols):
        gx, gy = at[0] * w, at[1] * h
        dd = np.hypot(xx - gx, yy - gy) / (r * w)
        g = np.zeros_like(img)
        for rad, col, k in cols:
            g += np.array(col, np.float32)[None, None, :] / 255.0 * (k * np.clip(1 - dd / rad, 0, 1) ** 2.2)[..., None]
        return np.clip(g, 0, 1)
    light = np.zeros_like(img)
    if 'fire' in pts: light = 1 - (1 - light) * (1 - glow(pts['fire'], 0.085, [(0.45, (255, 255, 240), 1.0), (1.0, (255, 210, 90), 0.95), (2.6, (255, 110, 20), 0.7)]))
    if 'tip' in pts: light = 1 - (1 - light) * (1 - glow(pts['tip'], 0.035, [(0.6, (255, 240, 200), 0.8), (2.0, (255, 140, 40), 0.5)]))
    if 'chest' in pts: light = 1 - (1 - light) * (1 - glow(pts['chest'], 0.05, [(0.8, (255, 200, 120), 0.45), (2.2, (255, 90, 20), 0.35)]))
    img = 1 - (1 - img) * (1 - light)
    # speed streaks behind the fireball: thin warm lines along its flight, fading back toward the staff
    if 'fire' in pts and 'back' in pts:
        st = Image.new('RGB', (w, h), (0, 0, 0)); dr = ImageDraw.Draw(st)
        fx, fy = pts['fire'][0] * w, pts['fire'][1] * h
        bx, by = pts['back']; n = math.hypot(bx * w, by * h) or 1; ux, uy = bx * w / n, by * h / n
        px, py = -uy, ux
        rng = np.random.default_rng(7)
        reach = math.hypot((pts['tip'][0] - pts['fire'][0]) * w, (pts['tip'][1] - pts['fire'][1]) * h) * 1.05
        for i in range(26):
            off = rng.normal(0, 0.028 * w)
            start = rng.uniform(0.04, 0.2) * reach; length = rng.uniform(0.35, 0.95) * (reach - start)
            x0, y0 = fx + ux * start + px * off, fy + uy * start + py * off
            x1, y1 = x0 + ux * length, y0 + uy * length
            col = (255, int(rng.uniform(150, 220)), int(rng.uniform(60, 120)))
            for s in range(10):   # taper: bright near the ball, fading along
                a, b2 = s / 10, (s + 1) / 10
                c = tuple(int(v * (1 - a) ** 1.6) for v in col)
                dr.line([(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a), (x0 + (x1 - x0) * b2, y0 + (y1 - y0) * b2)], fill=c, width=max(2, int(w / 700 * (1 - a) + 1)))
        st = np.asarray(st.filter(ImageFilter.GaussianBlur(w / 1400))).astype(np.float32) / 255.0
        img = 1 - (1 - img) * (1 - st * 0.85)
    # grade: contrast and saturation, warm highlights and cool shadows, a vignette
    img = np.clip(img, 0, 1)
    lum = luma(img)
    img = lum[..., None] + (img - lum[..., None]) * 1.28                          # saturation +28 %
    img = np.clip((img - 0.5) * 1.12 + 0.5, 0, 1)                                 # contrast
    lum = luma(img)
    split = np.clip(lum, 0, 1)[..., None]
    img = img + (np.array([0.05, 0.015, -0.035]) * split) + (np.array([-0.02, -0.01, 0.05]) * (1 - split))
    cx, cy = 0.5, 0.52
    v = np.hypot((xx / w - cx) / 0.75, (yy / h - cy) / 0.75)
    img = img * (1 - 0.55 * np.clip(v - 0.45, 0, 1) ** 1.4)[..., None]
    out = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).resize((W, H), Image.LANCZOS)
    return out

def place_title(cover, title_path, aspect):
    W, H = cover.size
    t = Image.open(title_path).convert('RGBA')
    if aspect == 'landscape':
        tw = int(W * 0.40); t = t.resize((tw, int(t.height * tw / t.width)), Image.LANCZOS)
        x, y = W - tw - int(W * 0.025), int(H * 0.035)
    else:
        tw = int(W * (0.84 if aspect == 'portrait' else 0.66)); t = t.resize((tw, int(t.height * tw / t.width)), Image.LANCZOS)
        x, y = (W - tw) // 2, H - t.height - int(H * 0.035)
    # a soft dark pool under the title so it holds on any background
    shade = Image.new('L', cover.size, 0); ImageDraw.Draw(shade).ellipse([x - tw * 0.05, y - t.height * 0.05, x + tw * 1.05, y + t.height * 1.05], fill=110)
    shade = shade.filter(ImageFilter.GaussianBlur(tw * 0.08))
    cover = Image.composite(Image.new('RGB', cover.size, (12, 4, 30)), cover, shade)
    cover.paste(t, (x, y), t)
    return cover, (x, y, t.width, t.height)

async def main():
    t0 = time.time()
    names = opt('--variants', ','.join(VARIANTS)).split(',')
    async with async_playwright() as pw:
        b = await pw.chromium.launch(args=GL_ARGS)
        titles = {}
        for two, key in ((True, 'stack'),):
            tp = os.path.join(WORK, f'title-{key}.png')
            ok = await render_title(b, tp, 220, two)
            print('title', tp, 'font loaded' if ok else 'FONT NOT LOADED (fallback face)')
            titles[key] = tp
        for name in names:
            V = VARIANTS[name]
            pg = await b.new_page(viewport={'width': 1280, 'height': 720})
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(URL + '/?debug&first&room=new', timeout=120000)
            await pg.wait_for_function(JOIN_WAIT, timeout=60000)
            if V['map'] != 'keep':   # a room starts on the current generation's first map (round 29: the keep)
                await pg.evaluate(f"window.__wa.net.send({{ t: 'roomMap', map: '{V['map']}' }})")
                await pg.wait_for_function(f"window.__wa.map === '{V['map']}'", timeout=30000)
                await pg.wait_for_timeout(2500)
            await pg.evaluate(UI_OFF)
            await pg.wait_for_timeout(1500)
            for aspect in ONLY:
                W, H = SIZES[aspect]
                cam = {**CAMS[aspect], **V.get('cams', {}).get(aspect, {})}
                Va = {**V, **{k: cam[k] for k in ('dist', 'u') if k in cam}, 'cams': {aspect: cam}}
                info = await pg.evaluate(STAGE, Va)
                print(name, aspect, 'staged', json.dumps(info['blocked']), 'fire', info['fire'])
                await pg.set_viewport_size({'width': W * SS, 'height': H * SS})
                await pg.evaluate("a => { window.__cover = { aspect: a, mask: false }; }", aspect)
                await pg.wait_for_timeout(1200)
                raw = os.path.join(WORK, f'{name}-{aspect}-raw.png'); await pg.screenshot(path=raw)
                pts = await pg.evaluate(PROJECT)
                await pg.evaluate("() => { window.__cover.mask = true; }")
                await pg.wait_for_timeout(400)
                mk = os.path.join(WORK, f'{name}-{aspect}-mask.png'); await pg.screenshot(path=mk)
                await pg.evaluate("() => { window.__cover.mask = false; }")
                cover = grade(raw, mk, pts, (W, H), aspect)
                cover.save(os.path.join(WORK, f'{name}-{aspect}-graded.png'))
                cover, box = place_title(cover, titles['stack'], aspect)
                out = os.path.join(OUT, f'cover-action-{name}-{aspect}-{W}x{H}.jpg')
                cover.save(out, quality=92)
                print('  ', out, 'title box', box, 'points', {k: [round(v, 3) for v in xy] for k, xy in pts.items()})
            print('   page errors:', errs[:3] or 'none')
            await pg.close()
        await b.close()
    # the 300 px sheet: every variant's landscape next to the old hero cover
    thumbs = [os.path.join(OUT, f'cover-action-{n}-landscape-1920x1080.jpg') for n in names] + [os.path.join(OUT, 'cover-hero-landscape-1920x1080.jpg')]
    thumbs = [t for t in thumbs if os.path.exists(t)]
    if thumbs:
        sheet = Image.new('RGB', (310 * len(thumbs) + 10, 190), (30, 30, 36))
        for i, t in enumerate(thumbs): sheet.paste(Image.open(t).resize((300, 169), Image.LANCZOS), (10 + 310 * i, 10))
        sheet.save(os.path.join(WORK, 'thumbs-300.png')); print('sheet', os.path.join(WORK, 'thumbs-300.png'))
    if PICK:
        for aspect, (W, H) in SIZES.items():
            src = os.path.join(OUT, f'cover-action-{PICK}-{aspect}-{W}x{H}.jpg')
            if os.path.exists(src): shutil.copy(src, os.path.join(OUT, f'cover-action-{aspect}-{W}x{H}.jpg')); print('picked', src)
    print(f'done in {time.time() - t0:.0f}s')

asyncio.run(main())
