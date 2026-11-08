# Round 20: bake the far trees' impostor atlas (public/models/trees_impostor.webp) from the *_far tree models.
# One square cell per tree (pine_far, oak_far, birch_far, left to right), the tree seen from the side, fitted like
# world.js's instanced() does (base at the bottom edge, 1 unit tall = the cell's height, centred), lit by the game's sky
# and sun and not tone mapped (the game's ACES pass maps it once, as it does the real trees). world.js draws each far
# tree as two crossed quads sampling its cell. Transparent texels take their nearest leaf's colour so mipmaps don't
# darken the edges (Pillow writes the webp with exact=True to keep them). Re-run after changing a tree model:
#   PORT=4112 node server.js &   python3 tools/bake-impostors.py 4112
import asyncio, sys, base64, pathlib
from playwright.async_api import async_playwright
from PIL import Image
PORT = sys.argv[1] if len(sys.argv) > 1 else '4102'
OUT = pathlib.Path(__file__).resolve().parent.parent / 'public/models/trees_impostor.webp'
CELL = 256
SPAN = 1.15   # a cell is SPAN tree heights across (the oak is 1.1 wide); world.js's IMPOSTOR.span must match

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=['--use-angle=metal'])
        pg = await b.new_page()
        await pg.goto(f'http://localhost:{PORT}/?debug=1')
        await pg.wait_for_function("!document.querySelector('#joinBtn').disabled", timeout=120000)
        r = await pg.evaluate("""async ([CELL, SPAN]) => {
          const THREE = await import('three');
          const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
          const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
          const L = new GLTFLoader(); L.setMeshoptDecoder(MeshoptDecoder);
          const names = ['pine_far', 'oak_far', 'birch_far'];
          const canvas = document.createElement('canvas'); canvas.width = CELL * names.length; canvas.height = CELL;
          const R = new THREE.WebGLRenderer({ canvas, alpha: true, premultipliedAlpha: false, antialias: true, preserveDrawingBuffer: true });
          R.outputColorSpace = THREE.SRGBColorSpace; R.toneMapping = THREE.NoToneMapping; R.setClearColor(0x000000, 0);
          R.setScissorTest(true);
          const widths = [];
          for (let i = 0; i < names.length; i++) {
            const g = await new Promise((res, rej) => L.load(`./models/${names[i]}.glb`, res, undefined, rej));
            const scene = new THREE.Scene();
            scene.add(new THREE.HemisphereLight(0xd6efff, 0x6a6a58, 1.15));
            const sun = new THREE.DirectionalLight(0xffe9c4, 2.3); sun.position.set(0.35, 0.8, 1); scene.add(sun);   // from in front, above
            scene.add(g.scene); g.scene.updateMatrixWorld(true);
            const bb = new THREE.Box3().setFromObject(g.scene), h = bb.max.y - bb.min.y;
            const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
            widths.push(+(Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / h).toFixed(3));
            // square cell, SPAN heights across: a square quad SPAN tree heights a side, its foot at the tree's base, maps it
            const cam = new THREE.OrthographicCamera(-h * SPAN / 2, h * SPAN / 2, h * SPAN, 0, 0.01, 1000);
            cam.position.set(cx, 0, cz + 100); cam.lookAt(cx, 0, cz);
            cam.top = bb.min.y + h * SPAN; cam.bottom = bb.min.y; cam.updateProjectionMatrix();
            R.setViewport(i * CELL, 0, CELL, CELL); R.setScissor(i * CELL, 0, CELL, CELL);
            R.clear(); R.render(scene, cam);
          }
          const gl = R.getContext(), W = canvas.width, H = canvas.height, px = new Uint8Array(W * H * 4);
          gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
          // flip to top-down, then bleed colour into the transparent texels (alpha stays 0)
          const img = new Uint8ClampedArray(W * H * 4);
          for (let y = 0; y < H; y++) img.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
          let filled = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) filled[i] = img[i * 4 + 3] > 127;
          for (let pass = 0; pass < 12; pass++) {
            const next = filled.slice();
            for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
              const i = y * W + x; if (filled[i]) continue;
              let r = 0, g = 0, b2 = 0, n = 0;
              for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
                if (Math.floor(xx / CELL) !== Math.floor(x / CELL)) continue;   // don't bleed across cells
                const j = yy * W + xx; if (!filled[j]) continue; r += img[j * 4]; g += img[j * 4 + 1]; b2 += img[j * 4 + 2]; n++;
              }
              if (n) { img[i * 4] = r / n; img[i * 4 + 1] = g / n; img[i * 4 + 2] = b2 / n; next[i] = 1; }
            }
            filled = next;
          }
          for (let i = 0; i < W * H; i++) img[i * 4 + 3] = img[i * 4 + 3] > 127 ? 255 : 0;
          // raw RGBA back to Python (a canvas would drop the colour under alpha 0)
          let bin = ''; for (let i = 0; i < img.length; i += 0x8000) bin += String.fromCharCode.apply(null, img.subarray(i, i + 0x8000));
          return { raw: btoa(bin), W, H, widths };
        }""", [CELL, SPAN])
        Image.frombytes('RGBA', (r['W'], r['H']), base64.b64decode(r['raw'])).save(OUT, 'WEBP', quality=88, exact=True, method=6)
        print(OUT, OUT.stat().st_size, 'bytes; width/height per tree', r['widths'])
        await b.close()
asyncio.run(main())
