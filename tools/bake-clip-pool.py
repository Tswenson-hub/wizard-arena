#!/usr/bin/env python3
"""Bake the generic wizard's clip pool (characters track, round 11).

Every clip of every hero export (looks.js POOL_SOURCES) is retargeted onto the base wizard.glb rig in a
headless browser (looks.js bakeClipPool), exported as an animation-only GLB (the bone hierarchy, no mesh),
then shrunk with gltf-transform (resample drops redundant keys, meshopt packs the rest). Output: public/models/wizards/clip-pool.glb.

Usage: start a server (PORT=4103 node server.js), then
  python3 tools/bake-clip-pool.py [port]
Re-run it after adding or replacing a hero export; then pick the new clips in public/js/spellanim.js.
"""
import base64, os, subprocess, sys, tempfile
from playwright.sync_api import sync_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else '4103'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public/models/wizards/clip-pool.glb')

JS = """async () => {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const { bakeClipPool, baseRig } = await import('/js/looks.js');
  const clips = await bakeClipPool(new GLTFLoader());
  // export the bones only: the tracks bind to them by name
  const root = new THREE.Group(); root.name = 'clipPool';
  root.add(baseRig());
  const glb = await new GLTFExporter().parseAsync(root, { binary: true, animations: clips });
  let s = ''; const u = new Uint8Array(glb);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return { b64: btoa(s), clips: clips.map(c => [c.name, +c.duration.toFixed(2), c.tracks.length]) };
}"""

with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(f'http://localhost:{PORT}/')
    pg.wait_for_function('!document.getElementById("joinBtn").disabled', timeout=90000)
    res = pg.evaluate(JS)
    b.close()

for name, dur, tracks in res['clips']:
    print(f'  {name:48s} {dur:5.2f} s  {tracks} tracks')
raw = base64.b64decode(res['b64'])
tmp = tempfile.NamedTemporaryFile(suffix='.glb', delete=False).name
open(tmp, 'wb').write(raw)
print(f'{len(res["clips"])} clips, raw {len(raw) // 1024} KB')
G = ['npx', '--yes', '@gltf-transform/cli@4']
subprocess.run(G + ['resample', tmp, tmp + '.r.glb'], check=True, capture_output=True)
# meshopt packs the keyframes (quaternions at 16 bits); looks.js loads it with three's MeshoptDecoder
subprocess.run(G + ['meshopt', tmp + '.r.glb', OUT], check=True, capture_output=True)
print(f'wrote {OUT}: {os.path.getsize(OUT) // 1024} KB')
if errs: print('page errors:', errs)
