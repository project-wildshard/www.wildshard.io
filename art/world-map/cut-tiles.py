"""Cut the world-map concept into the /map/ viewer's zoom tiles.

python3 -I cut-tiles.py <full.png> <out dir>

full.png is worldmap.py's render at scale 2 (8800 x 10600): the chart is its top
8800 x 8820, the legend panels below it are left out (the page has them as
text). Level 5 is the chart at full size; each level above it halves the one
below, rounding up (8800 x 8820, 4400 x 4410, ... 275 x 276). Each level is
cut into 512 px WebP tiles named <z>/<x>_<y>.webp; edge tiles are partial.
"""
import os
import sys

from PIL import Image

W, H, T, TOP = 8800, 8820, 512, 5

src, out = sys.argv[1], sys.argv[2]
Image.MAX_IMAGE_PIXELS = None
chart = Image.open(src).convert('RGB').crop((0, 0, W, H))
level, w, h = chart, W, H
for z in range(TOP, -1, -1):
    if z < TOP:
        w, h = (w + 1) // 2, (h + 1) // 2
        level = level.resize((w, h), Image.LANCZOS)
    os.makedirs(f'{out}/{z}', exist_ok=True)
    n = 0
    for x in range(0, (w + T - 1) // T):
        for y in range(0, (h + T - 1) // T):
            tile = level.crop((x * T, y * T, min(w, (x + 1) * T), min(h, (y + 1) * T)))
            tile.save(f'{out}/{z}/{x}_{y}.webp', 'WEBP', quality=82, method=6)
            n += 1
    print(f'level {z}: {w} x {h}, {n} tiles')
