#!/bin/sh
# Shrink raw Meshy exports into the web-ready models in public/models.
#   tools/optimize-models.sh <goat.glb> <potion.glb> <farmhouse.glb>
#   tools/optimize-models.sh one <src.glb> <name> [simplify-ratio] [texture-size] [simplify-error] [target-tris]
#     target-tris: also run meshoptimizer's *sloppy* simplifier down to about that many triangles. Meshy
#     exports have so many UV seams that the regular simplifier stalls around 4k; sloppy ignores seams
#     (fine for trees and rocks, which repeat dozens of times). Installs its npm deps in a temp dir.
#     -> public/models/<name>.glb (defaults: ratio 0.35, 1024 px; aim for < 1 MB, ~10k tris for props)
#   Repeated scenery (trees, rocks) needs a looser error to reach its ratio, e.g. one <pine.glb> pine 0.5 512 0.02
#   Big image-to-3d scenery went:  one <barn.glb> barn 0.03 2048   (88 MB -> 2.6 MB, 64k tris)
#                                  one <silo.glb> silo 0.012 2048  (248 MB -> 4.1 MB)
# Needs network access the first time (npx fetches @gltf-transform/cli).
set -e
G="npx --yes @gltf-transform/cli@4"
OUT="$(dirname "$0")/../public/models"
TMP="$(mktemp -d)"
sloppy() { # src dst target-tris
  [ -d "$TMP/npm/node_modules/meshoptimizer" ] || npm i --silent --prefix "$TMP/npm" @gltf-transform/core@4 meshoptimizer@1.3 >/dev/null
  cat > "$TMP/npm/sloppy.mjs" <<'JS'
import { NodeIO } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer';
const [src, dst, target] = process.argv.slice(2);
await MeshoptSimplifier.ready;
const io = new NodeIO(), doc = await io.read(src);
const prims = doc.getRoot().listMeshes().flatMap(m => m.listPrimitives());
const total = prims.reduce((n, p) => n + p.getIndices().getCount() / 3, 0);
for (const p of prims) {
  const idx = p.getIndices(), pos = p.getAttribute('POSITION');
  const want = Math.max(3, Math.floor(idx.getCount() * Math.min(1, target / total) / 3) * 3);
  const [out] = MeshoptSimplifier.simplifySloppy(new Uint32Array(idx.getArray()), new Float32Array(pos.getArray()), 3, null, want, 1);
  idx.setArray(new Uint32Array(out));
  console.log(`sloppy: ${idx.getCount() / 3} tris (from ${total})`);
}
await io.write(dst, doc);
JS
  (cd "$TMP/npm" && node sloppy.mjs "$1" "$2" "$3")
}
shrink() { # src dst simplify-ratio texture-size [simplify-error] [target-tris]
  $G weld "$1" "$TMP/a.glb"
  $G simplify "$TMP/a.glb" "$TMP/b.glb" --ratio "$3" --error "${5:-0.003}"
  if [ -n "$6" ]; then sloppy "$TMP/b.glb" "$TMP/s.glb" "$6"; $G prune "$TMP/s.glb" "$TMP/b.glb"; fi
  $G resize "$TMP/b.glb" "$TMP/c.glb" --width "$4" --height "$4"
  $G webp "$TMP/c.glb" "$TMP/d.glb" --quality 80
  $G quantize "$TMP/d.glb" "$2"
}
if [ "$1" = one ]; then
  shrink "$2" "$OUT/$3.glb" "${4:-0.35}" "${5:-1024}" "${6:-0.003}" "$7"
  ls -la "$OUT/$3.glb"
else
  shrink "$1" "$OUT/goat.glb" 0.35 1024        # 15k -> 8.6k tris, 7.5 MB -> 0.6 MB
  shrink "$2" "$OUT/potion.glb" 0.35 1024      # 12k -> 6k tris,   7.4 MB -> 0.5 MB
  shrink "$3" "$OUT/farmhouse.glb" 0.02 2048   # 3.6M -> 130k tris, 222 MB -> 5.5 MB
fi
rm -rf "$TMP"
