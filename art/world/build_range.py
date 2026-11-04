# Rebuild src/world/frontRange.ts from the WorldCraft heightfield (gitcraft-out/world/front_range):
#   worldcraft_terrain {preset: mountains, climate: cold, resolution: 513, mesh_resolution: 65, erosion: 40,
#     erosion_strength: 1.2, thermal: 80, roughness: 0.7, world_size: 6000, height_scale: 1200,
#     vegetation: 0, rocks: 0, seed: 14, name: front_range}
# then: python3 art/world/build_range.py   (area-average to 129 x 129, normalise, 16-bit, base64)
import base64
import numpy as np
from PIL import Image

N = 129
a = np.array(Image.open('gitcraft-out/world/front_range/front_range_height16.png')).astype(np.float32)
b = np.array(Image.fromarray(a, mode='F').resize((N, N), Image.BOX))
b = (b - b.min()) / (b.max() - b.min())
data = base64.b64encode((b * 65535).round().astype('<u2').tobytes()).decode()
print(len(data), 'base64 chars; paste into src/world/frontRange.ts DATA')
