#!/bin/sh
# Shrink raw Meshy exports into the web-ready models in public/models.
#   tools/optimize-models.sh <goat.glb> <potion.glb> <farmhouse.glb>
#   tools/optimize-models.sh one <src.glb> <name> [simplify-ratio] [texture-size] [simplify-error] [target-tris]
#     target-tris: also run meshoptimizer's *sloppy* simplifier down to about that many triangles. Meshy
#     exports have so many UV seams that the regular simplifier stalls around 4k; sloppy ignores seams
#     (fine for trees and rocks, which repeat dozens of times). Installs its npm deps in a temp dir.
#     -> public/models/<name>.glb (defaults: ratio 0.35, 1024 px; aim for < 1 MB, ~10k tris for props)
#   tools/optimize-models.sh kit <src-gltf-dir> <subdir> name...
#     round 15: KayKit / Quaternius glTF pieces -> public/models/<subdir>/<name>.glb, meshopt, images stripped (world.js
#     gives each kit one shared material set: castle/dungeon_texture.webp, village/*.webp)
#   tools/optimize-models.sh pack <name> [maps-px] [simplify-ratio]
#     meshopt-compress public/models/<name>.glb in place (EXT_meshopt_compression: world.js and the editor set
#     three's MeshoptDecoder on their GLTFLoaders), shrinking its normal/roughness maps to maps-px (default 512;
#     the base colour keeps its size). `one` already ends with this. Round 14 packed every map model this way:
#     farmhouse/silo/barn with 1024 maps (silo and farmhouse also simplify 0.5, error 0.002), the rest with 512.
#     Not ice_wall/acid_puddle: effects.js loads those with its own GLTFLoader, which has no decoder.
#     Packing an already-packed file works but re-quantizes; start from the backup or the source when you can.
#   Repeated scenery (trees, rocks) needs a looser error to reach its ratio, e.g. one <pine.glb> pine 0.5 512 0.02
#   Big image-to-3d scenery went:  one <barn.glb> barn 0.03 2048   (88 MB -> 2.6 MB, 64k tris)
#                                  one <silo.glb> silo 0.012 2048  (248 MB -> 4.1 MB)
# Needs network access the first time (npx fetches @gltf-transform/cli).
set -e
G="npx --yes @gltf-transform/cli@4"
OUT="${OUT:-$(dirname "$0")/../public/models}"
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
pack() { # src dst [maps-px] [simplify-ratio]
  [ -d "$TMP/pk/node_modules/sharp" ] || npm i --silent --prefix "$TMP/pk" @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer@1.3 sharp >/dev/null
  cat > "$TMP/pk/pack.mjs" <<'JS'
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
const [src, dst, maps, ratio] = process.argv.slice(2);
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 80, resize: [+maps, +maps], slots: /^(normalTexture|metallicRoughnessTexture|occlusionTexture)$/ }));
if (+ratio < 1) await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: +ratio, error: 0.002 }));
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high', quantizePosition: 12, quantizeNormal: 8 }));
await io.write(dst, doc);
JS
  set -- "$(cd "$(dirname "$1")" && pwd)/$(basename "$1")" "$(cd "$(dirname "$2")" && pwd)/$(basename "$2")" "$3" "$4"
  (cd "$TMP/pk" && node pack.mjs "$1" "$2" "${3:-512}" "${4:-1}")
}
shrink() { # src dst simplify-ratio texture-size [simplify-error] [target-tris]
  $G weld "$1" "$TMP/a.glb"
  $G simplify "$TMP/a.glb" "$TMP/b.glb" --ratio "$3" --error "${5:-0.003}"
  if [ -n "$6" ]; then sloppy "$TMP/b.glb" "$TMP/s.glb" "$6"; $G prune "$TMP/s.glb" "$TMP/b.glb"; fi
  $G resize "$TMP/b.glb" "$TMP/c.glb" --width "$4" --height "$4"
  $G webp "$TMP/c.glb" "$TMP/d.glb" --quality 80
  pack "$TMP/d.glb" "$2" "$(( $4 > 1024 ? 1024 : 512 ))"
}
kitpack() { # dst-dir src.gltf... : glTF -> meshopt GLB without its images (world.js gives each kit one shared material set)
  [ -d "$TMP/kit/node_modules/meshoptimizer" ] || npm i --silent --prefix "$TMP/kit" @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer@1.3 >/dev/null
  cat > "$TMP/kit/kit.mjs" <<'JS'
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import path from 'node:path';
const [dst, ...srcs] = process.argv.slice(2);
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
for (const src of srcs) {
  const doc = await io.read(src);
  for (const t of doc.getRoot().listTextures()) t.dispose();     // materials keep their names (and factors); textures go
  await doc.transform(weld(), prune({ keepAttributes: true }), meshopt({ encoder: MeshoptEncoder, level: 'high', quantizePosition: 14, quantizeNormal: 8 }));
  const out = path.join(dst, path.basename(src).replace(/\.gltf$/, '.glb'));
  await io.write(out, doc);
  console.log(out);
}
JS
  D="$(cd "$1" && pwd)"; shift
  ABS=""; for f in "$@"; do ABS="$ABS $(cd "$(dirname "$f")" && pwd)/$(basename "$f")"; done
  (cd "$TMP/kit" && node kit.mjs "$D" $ABS)
}
if [ "$1" = kit ]; then
  # tools/optimize-models.sh kit <src-gltf-dir> <public/models subdir> name... : the kit pieces the layout uses (round 15: castle/, village/)
  SRC="$2"; SUB="$3"; shift 3
  mkdir -p "$OUT/$SUB"
  FILES=""; for n in "$@"; do FILES="$FILES $SRC/$n.gltf"; done
  kitpack "$OUT/$SUB" $FILES
elif [ "$1" = pack ]; then
  cp "$OUT/$2.glb" "$TMP/in.glb"
  pack "$TMP/in.glb" "$OUT/$2.glb" "$3" "$4"
  ls -la "$OUT/$2.glb"
elif [ "$1" = one ]; then
  shrink "$2" "$OUT/$3.glb" "${4:-0.35}" "${5:-1024}" "${6:-0.003}" "$7"
  ls -la "$OUT/$3.glb"
else
  shrink "$1" "$OUT/goat.glb" 0.35 1024        # 15k -> 8.6k tris, 7.5 MB -> 0.6 MB
  shrink "$2" "$OUT/potion.glb" 0.35 1024      # 12k -> 6k tris,   7.4 MB -> 0.5 MB
  shrink "$3" "$OUT/farmhouse.glb" 0.02 2048   # 3.6M -> 130k tris, 222 MB -> 5.5 MB
fi
rm -rf "$TMP"
