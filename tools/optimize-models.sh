#!/bin/sh
# Shrink raw Meshy exports into the web-ready models in public/models.
#   tools/optimize-models.sh <goat.glb> <potion.glb> <farmhouse.glb>
# Needs network access the first time (npx fetches @gltf-transform/cli).
set -e
G="npx --yes @gltf-transform/cli@4"
OUT="$(dirname "$0")/../public/models"
TMP="$(mktemp -d)"
shrink() { # src dst simplify-ratio texture-size
  $G weld "$1" "$TMP/a.glb"
  $G simplify "$TMP/a.glb" "$TMP/b.glb" --ratio "$3" --error 0.003
  $G resize "$TMP/b.glb" "$TMP/c.glb" --width "$4" --height "$4"
  $G webp "$TMP/c.glb" "$TMP/d.glb" --quality 80
  $G quantize "$TMP/d.glb" "$2"
}
shrink "$1" "$OUT/goat.glb" 0.35 1024        # 15k -> 8.6k tris, 7.5 MB -> 0.6 MB
shrink "$2" "$OUT/potion.glb" 0.35 1024      # 12k -> 6k tris,   7.4 MB -> 0.5 MB
shrink "$3" "$OUT/farmhouse.glb" 0.02 2048   # 3.6M -> 130k tris, 222 MB -> 5.5 MB
rm -rf "$TMP"
