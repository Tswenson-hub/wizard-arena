#!/usr/bin/env python3
# Bake the painted Meshy sky (a 16:9 panorama, horizon at the bottom edge, zenith at the top) into a seamless
# 2:1 equirectangular map for scene.background (EquirectangularReflectionMapping).
#   python3 tools/make-sky.py <src.png> [sun-azimuth-u]   -> public/textures/sky.jpg
# - The left/right wrap seam: the last `B` columns are cross-faded into the first ones and dropped, so the
#   panorama wraps without a visible edge.
# - The painting fills the upper hemisphere (v linear in elevation, as three.js samples it); the lower half is
#   the horizon colour, which is also printed so the fog can match it.
# - The column with the strongest sunbeams is rolled to `sun-azimuth-u` (three's equirect u = atan2(z, x) / 2pi
#   + 0.5), so the painted sunbeams sit where the scene's DirectionalLight comes from.
import sys, os
import numpy as np
from PIL import Image
src = sys.argv[1]
sun_u = float(sys.argv[2]) if len(sys.argv) > 2 else 0.594
out = os.path.join(os.path.dirname(__file__), '..', 'public', 'textures', 'sky.jpg')
img = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
H, W, _ = img.shape
B = W // 12                                   # cross-fade band (128 px on a 1536 px source)
seam = img[:, :W - B].copy()
t = (np.arange(B, dtype=np.float32) / B)[None, :, None]
seam[:, :B] = t * img[:, :B] + (1 - t) * img[:, W - B:]
Wp = seam.shape[1]
# the sunbeams: the brightest, warmest band of columns in the middle third of the height
mid = seam[H // 3: 2 * H // 3]
warm = (mid[..., 0] + mid[..., 1] - 0.6 * mid[..., 2]).mean(axis=0)
warm = np.convolve(warm, np.ones(61) / 61, mode='same')
sun_x = int(np.argmax(warm))
shift = int(round(sun_u * Wp)) - sun_x
seam = np.roll(seam, shift, axis=1)
OW, OH = 2048, 1024
upper = np.asarray(Image.fromarray(seam.clip(0, 255).astype(np.uint8)).resize((OW, OH // 2), Image.LANCZOS)).astype(np.float32)
horizon = upper[-6:].reshape(-1, 3).mean(axis=0)
lower = np.empty((OH // 2, OW, 3), np.float32)
lower[:] = horizon
# a short soft band below the horizon so the edge never shows as a line
k = np.linspace(1, 0, 24, dtype=np.float32)[:, None, None]
lower[:24] = k * upper[-1:] + (1 - k) * horizon
sky = np.concatenate([upper, lower], axis=0)
Image.fromarray(sky.clip(0, 255).astype(np.uint8)).save(out, quality=86, optimize=True, progressive=True)
print(f'sunbeams at x {sun_x}/{Wp}, rolled by {shift}; horizon #{int(horizon[0]):02x}{int(horizon[1]):02x}{int(horizon[2]):02x}; {os.path.getsize(out) // 1024} KB -> {out}')
