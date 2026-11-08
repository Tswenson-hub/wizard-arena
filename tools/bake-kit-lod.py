# Round 20: bake the castle kit's far LOD (public/models/castle/kit_lod.webp + kit_lod.json).
# world.js draws a far wall or floor tile as a box of up to five quads (both sides, the ends, the top; never the bottom),
# each textured with that side of the real piece seen straight on. A side is baked from the kit's own palette with a light
# along its normal tipped 45 deg up, scaled so a flat face comes out exactly its albedo: the bricks' and tiles' bevels keep
# their light top and dark bottom edges, and the game lights the box like any other stone. Each quad sits at the depth
# where most of that side's surface is (not the bounding box, which the odd protruding brick would push out). The json
# lists, per model, the quads' corners in the model's own units, their normals and their atlas uvs (flipY false, as
# kitTexture loads it); world.js gives the LOD to every model it lists. CUTOUT models keep their empty texels
# transparent (a balustrade's gaps, a banner's outline). Re-run after changing one of LOD_MODELS or CUTOUT:
#   PORT=4112 node server.js &   python3 tools/bake-kit-lod.py 4112
import asyncio, sys, base64, json, pathlib
from playwright.async_api import async_playwright
from PIL import Image
PORT = sys.argv[1] if len(sys.argv) > 1 else '4102'
OUT = pathlib.Path(__file__).resolve().parent.parent / 'public/models/castle'
# Only what repeats enough to pay for its two draw calls (the piece near, its box far): every model here is 6k+ triangles
# over the map. A banner or a single crate isn't.
LOD_MODELS = ['castle/wall', 'castle/wall_cracked', 'castle/wall_window_closed', 'castle/floor_tile_large']
# cut out: what the bake leaves empty stays transparent (world.js alpha-tests the boxes): the balustrade's gaps, the stack's outline
CUTOUT = ['castle/barrier', 'castle/crates_stacked']
PPU = 48       # atlas pixels per model unit (a wall is 4 units: 192 px a side)
ATLAS_W = 1024
TILT = 1.0     # the bake light: the face's normal plus TILT x its image-up

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True, args=['--use-angle=metal'])
        pg = await b.new_page()
        pg.on('console', lambda m: print('page:', m.text) if m.type == 'error' else None)
        await pg.goto(f'http://localhost:{PORT}/?debug=1')
        await pg.wait_for_function("!document.querySelector('#joinBtn').disabled", timeout=120000)
        r = await pg.evaluate("""async ([MODELS, CUTOUT, PPU, W, TILT]) => {
          const THREE = await import('three');
          const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
          const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
          const L = new GLTFLoader(); L.setMeshoptDecoder(MeshoptDecoder);
          const pal = await new THREE.TextureLoader().loadAsync('./models/castle/dungeon_texture.webp');
          pal.colorSpace = THREE.SRGBColorSpace; pal.flipY = false;
          const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
          // name, axis, outward sign, image right (U), image up (V); U x V = the outward normal, so quads wind outward
          const FACES = [['pz', 'z', 1, V3(1, 0, 0), V3(0, 1, 0)], ['nz', 'z', -1, V3(-1, 0, 0), V3(0, 1, 0)],
            ['px', 'x', 1, V3(0, 0, -1), V3(0, 1, 0)], ['nx', 'x', -1, V3(0, 0, 1), V3(0, 1, 0)], ['py', 'y', 1, V3(1, 0, 0), V3(0, 0, -1)]];
          const AX = { x: V3(1, 0, 0), y: V3(0, 1, 0), z: V3(0, 0, 1) };
          const jobs = [];
          for (const model of MODELS) {
            const g = await L.loadAsync(`./models/${model}.glb`);
            g.scene.updateMatrixWorld(true);
            const mat = new THREE.MeshLambertMaterial({ map: pal });
            const tris = [];
            g.scene.traverse(o => { if (!o.isMesh) return; o.material = mat;
              const pos = o.geometry.attributes.position, idx = o.geometry.index, n = idx ? idx.count : pos.count;
              for (let i = 0; i < n; i += 3) { const v = [0, 1, 2].map(k => V3().fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(o.matrixWorld)); tris.push(v); } });
            const bb = new THREE.Box3().setFromObject(g.scene), ctr = bb.getCenter(V3()), size = bb.getSize(V3());
            for (const [name, ax, s, U, Vv] of FACES) {
              const N = AX[ax].clone().multiplyScalar(s);
              // the depth (along N) of most of this side's area: an area-weighted median of the faces turned this way
              const cands = [];
              for (const [a, b2, c] of tris) { const cr = V3().subVectors(b2, a).cross(V3().subVectors(c, a)), area = cr.length() / 2;
                if (area > 1e-6 && cr.normalize().dot(N) > 0.9) cands.push([(a.dot(N) + b2.dot(N) + c.dot(N)) / 3, area]); }
              cands.sort((p, q) => p[0] - q[0]);
              const total = cands.reduce((t, c) => t + c[1], 0); let acc = 0, depth = s > 0 ? bb.max[ax] : -bb.min[ax];
              for (const [d, a] of cands) { acc += a; if (acc >= total / 2) { depth = d; break; } }
              const ext = (dir) => { const vals = [bb.min.x, bb.max.x].flatMap(x => [bb.min.y, bb.max.y].flatMap(y => [bb.min.z, bb.max.z].map(z => V3(x, y, z).dot(dir)))); return [Math.min(...vals), Math.max(...vals)]; };
              const [u0, u1] = ext(U), [v0, v1] = ext(Vv);
              jobs.push({ model, name, scene: g.scene, N, U, Vv, depth, u0, u1, v0, v1, w: Math.max(8, Math.round((u1 - u0) * PPU)), h: Math.max(8, Math.round((v1 - v0) * PPU)), reach: size.length() + 1, ctr });
            }
          }
          // shelf-pack, tallest first
          const order = [...jobs].sort((a, b) => b.h - a.h); let x = 0, y = 0, rowH = 0;
          for (const j of order) { if (x + j.w > W) { x = 0; y += rowH; rowH = 0; } j.x = x; j.y = y; x += j.w; rowH = Math.max(rowH, j.h); }
          const H = Math.ceil((y + rowH) / 4) * 4;   // WebGL2 mipmaps any size
          const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
          const R = new THREE.WebGLRenderer({ canvas, alpha: true, premultipliedAlpha: false, antialias: true, preserveDrawingBuffer: true });
          R.outputColorSpace = THREE.SRGBColorSpace; R.toneMapping = THREE.NoToneMapping; R.setClearColor(0x000000, 0); R.setScissorTest(true);
          R.setViewport(0, 0, W, H); R.setScissor(0, 0, W, H); R.clear();
          const out = {};
          for (const j of jobs) {
            const scene = new THREE.Scene(); scene.add(j.scene);
            // light along the normal, tipped toward the image's up (45 deg: sides lit from above, like the sky and the sun do);
            // scaled so a flat face is exactly its albedo
            const ld = j.N.clone().add(j.Vv.clone().multiplyScalar(TILT)).normalize(), cos = ld.dot(j.N);
            const sun = new THREE.DirectionalLight(0xffffff, Math.PI / cos); sun.position.copy(ld).multiplyScalar(50); scene.add(sun, sun.target);
            const cu = (j.u0 + j.u1) / 2, cv = (j.v0 + j.v1) / 2;
            const at = j.N.clone().multiplyScalar(j.depth).add(j.U.clone().multiplyScalar(cu)).add(j.Vv.clone().multiplyScalar(cv));
            const cam = new THREE.OrthographicCamera(-(j.u1 - j.u0) / 2, (j.u1 - j.u0) / 2, (j.v1 - j.v0) / 2, -(j.v1 - j.v0) / 2, 0.01, 2 * j.reach + 10);
            cam.position.copy(at).addScaledVector(j.N, j.reach + 5); cam.up.copy(j.Vv); cam.lookAt(at); cam.updateMatrixWorld();
            R.setViewport(j.x, H - j.y - j.h, j.w, j.h); R.setScissor(j.x, H - j.y - j.h, j.w, j.h);
            R.render(scene, cam);
            // the quad: corners (U min, V min), (U max, V min), (U max, V max), (U min, V max), uvs with v down the atlas
            const P = (u, v) => j.N.clone().multiplyScalar(j.depth).add(j.U.clone().multiplyScalar(u)).add(j.Vv.clone().multiplyScalar(v));
            const pos = [P(j.u0, j.v0), P(j.u1, j.v0), P(j.u1, j.v1), P(j.u0, j.v1)].flatMap(p => [p.x, p.y, p.z].map(n => +n.toFixed(4)));
            const ua = (j.x + 0.5) / W, ub = (j.x + j.w - 0.5) / W, vt = (j.y + 0.5) / H, vb = (j.y + j.h - 0.5) / H;
            (out[j.model] ||= { cutout: CUTOUT.includes(j.model), faces: [] }).faces.push({ face: j.name, pos, normal: [j.N.x, j.N.y, j.N.z], uv: [ua, vb, ub, vb, ub, vt, ua, vt].map(n => +n.toFixed(5)) });
          }
          const gl = R.getContext(), px = new Uint8Array(W * H * 4);
          gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
          const img = new Uint8ClampedArray(W * H * 4);
          for (let yy = 0; yy < H; yy++) img.set(px.subarray((H - 1 - yy) * W * 4, (H - yy) * W * 4), yy * W * 4);
          // texels nothing covered take their neighbours' colour, within their own rect (so mipmaps don't bleed in black);
          // they stay transparent in a cut-out model's rects and turn opaque (a ragged edge) in a solid one's
          const owner = new Int32Array(W * H).fill(-1);
          jobs.forEach((j, k) => { for (let yy = j.y; yy < j.y + j.h; yy++) for (let xx = j.x; xx < j.x + j.w; xx++) owner[yy * W + xx] = k; });
          let filled = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) filled[i] = img[i * 4 + 3] > 127;
          const filled0 = filled.slice();
          for (let pass = 0; pass < 24; pass++) {
            const next = filled.slice(); let left = 0;
            for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
              const i = yy * W + xx; if (filled[i] || owner[i] < 0) continue; left++;
              let r = 0, g2 = 0, b2 = 0, n = 0;
              for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = xx + dx, Y = yy + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
                const k = Y * W + X; if (!filled[k] || owner[k] !== owner[i]) continue; r += img[k * 4]; g2 += img[k * 4 + 1]; b2 += img[k * 4 + 2]; n++; }
              if (n) { img[i * 4] = r / n; img[i * 4 + 1] = g2 / n; img[i * 4 + 2] = b2 / n; next[i] = 1; }
            }
            filled = next; if (!left) break;
          }
          const cut = new Uint8Array(W * H);
          jobs.forEach(j => { if (!CUTOUT.includes(j.model)) return; for (let yy = j.y; yy < j.y + j.h; yy++) for (let xx = j.x; xx < j.x + j.w; xx++) cut[yy * W + xx] = 1; });
          const solidA = filled0;
          for (let i = 0; i < W * H; i++) img[i * 4 + 3] = cut[i] && !solidA[i] ? 0 : 255;
          let bin = ''; for (let i = 0; i < img.length; i += 0x8000) bin += String.fromCharCode.apply(null, img.subarray(i, i + 0x8000));
          return { raw: btoa(bin), W, H, out };
        }""", [LOD_MODELS + CUTOUT, CUTOUT, PPU, ATLAS_W, TILT])
        Image.frombytes('RGBA', (r['W'], r['H']), base64.b64decode(r['raw'])).save(OUT / 'kit_lod.webp', 'WEBP', quality=85, method=6, exact=True)
        (OUT / 'kit_lod.json').write_text(json.dumps({'size': [r['W'], r['H']], 'models': r['out']}, separators=(',', ':')) + '\n')
        print(OUT / 'kit_lod.webp', (OUT / 'kit_lod.webp').stat().st_size, 'bytes', r['W'], 'x', r['H'], len(r['out']), 'models')
        await b.close()
asyncio.run(main())
