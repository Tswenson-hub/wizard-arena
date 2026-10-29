#!/bin/sh
# Turn one of Ty's Meshy character exports into public/models/wizards/<id>.glb (characters track).
#   tools/prepare-wizard-model.sh <rigged-character.glb> <wizard-id> [texture-size]
# 1. Inspects it: skinned? bone names vs. the base wizard.glb, clips, height.
# 2. Shrinks it: weld -> resize textures (1024) -> webp -> resample clips -> quantize. No simplify:
#    skinned meshes tear. Every clip and the skin are kept.
# If the bones match the base skeleton, looks.js drives it with the base clips and no animations
# need exporting. Otherwise it needs Meshy's Running, Walking, Stand_Dodge_2, Stand_Dodge_3,
# Two_Handed_Parry, Charged_Spell_Cast and mage_soell_cast clips (looks.js maps those names too).
# Needs network access the first time (npx fetches @gltf-transform/cli).
set -e
[ -n "$2" ] || { sed -n '2,9p' "$0"; exit 1; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$1"; ID="$2"; SIZE="${3:-1024}"
OUT="${OUT:-$ROOT/public/models/wizards/$ID.glb}"
G="npx --yes @gltf-transform/cli@4"
TMP="$(mktemp -d)"

python3 - "$SRC" "$ROOT/public/models/wizard.glb" <<'PY'
import json, struct, sys
def read(f):
    b = open(f, 'rb').read(); n = struct.unpack('<I', b[12:16])[0]
    return len(b), json.loads(b[20:20 + n])
size, j = read(sys.argv[1]); _, base = read(sys.argv[2])
import re
# Mixamo-style rigs name bones 'mixamorig:Hips'; looks.js strips the prefix, so compare without it
names = lambda g: [re.sub(r'^mixamorig:?', '', g['nodes'][i].get('name') or '') for s in g.get('skins', []) for i in s['joints']]
bones, want = names(j), names(base)
print(f"source: {sys.argv[1]} ({size / 1e6:.1f} MB)")
if not bones:
    print("NOT SKINNED: this is a static mesh. Ask Ty for the rigged export (Meshy: Rig -> Character_output.glb).")
    sys.exit(2)
print(f"bones: {len(bones)}")
missing = [b for b in want if b not in bones]
mapped = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'] + [sd + b for sd in ('Left', 'Right') for b in ('Shoulder', 'Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot', 'ToeBase')]
if not missing: print("skeleton matches the base wizard: base clips will drive it")
elif all(b in bones for b in mapped): print("Mixamo-style rig: looks.js uses its own clips and retargets the rest (MIXAMO_TO_BASE)")
else: print(f"skeleton differs and can't be retargeted; missing {[b for b in mapped if b not in bones]}")
print("RightHand bone:", "yes" if "RightHand" in bones else "NO (tell the spells agent the hand bone)")
print("Head bone:", "yes" if "Head" in bones else "NO")
print("clips:", [a.get('name') for a in j.get('animations', [])] or "none")
for m in j['meshes']:
    for p in m['primitives']:
        a = j['accessors'][p['attributes']['POSITION']]
        if 'min' in a: print(f"bind-pose bounds y {a['min'][1]:.2f}..{a['max'][1]:.2f}, x {a['min'][0]:.2f}..{a['max'][0]:.2f}, z {a['min'][2]:.2f}..{a['max'][2]:.2f}, {a['count']} verts")
PY

mkdir -p "$(dirname "$OUT")"
$G weld "$SRC" "$TMP/a.glb"
$G resize "$TMP/a.glb" "$TMP/b.glb" --width "$SIZE" --height "$SIZE"
$G webp "$TMP/b.glb" "$TMP/c.glb" --quality 80
$G resample "$TMP/c.glb" "$TMP/r.glb"          # drops redundant keyframes (2.97 -> 1.71 MB for Gale)
$G quantize "$TMP/r.glb" "$TMP/d.glb"
$G prune "$TMP/d.glb" "$OUT"
rm -rf "$TMP"
ls -la "$OUT"
