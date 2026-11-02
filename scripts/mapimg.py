import json, sys
import numpy as np
from PIL import Image, ImageDraw
d = json.load(open(sys.argv[1]))
g = d['grid']; nx, nz = g['nx'], g['nz']
h = np.array(g['h']).reshape(nz, nx)
S = 6
# hillshade
gy, gx = np.gradient(h, g['cell'])
light = np.array([-0.5, 0.7, -0.5]); light /= np.linalg.norm(light)
n = np.dstack([-gx, np.ones_like(h), -gy]); n /= np.linalg.norm(n, axis=2, keepdims=True)
shade = np.clip((n @ light), 0, 1)
contour = (np.floor(h) % 2) * 0.08
img = (np.clip(shade * 0.8 + 0.2 - contour, 0, 1) * 255).astype(np.uint8)
im = Image.fromarray(img).resize((nx * S, nz * S), Image.NEAREST).convert('RGB')
dr = ImageDraw.Draw(im)
def P(x, z): return ((x - g['x0']) / g['cell'] * S, (z - g['z0']) / g['cell'] * S)
cols = [(255,60,60),(60,160,255),(60,220,90),(255,200,40),(220,80,255),(255,140,0)]
for i, t in enumerate(d['tracks']):
    if len(t) > 1: dr.line([P(*q) for q in t], fill=cols[i % len(cols)], width=3 if i == 0 else 2)
for o in d['objs']:
    x, y = P(o[0], o[1]); dr.ellipse([x-5, y-5, x+5, y+5], outline=(0,0,0), width=2); dr.text((x+6, y-6), o[2], fill=(0,0,0))
im.save(sys.argv[2])
