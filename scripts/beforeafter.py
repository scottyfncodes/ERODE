"""Before/after pairs: python3 scripts/beforeafter.py <before_dir> <after_dir> <prefix> <out.jpg> name [name ...]
Each row is one view: before on the left, after on the right, labelled."""
import sys
from PIL import Image, ImageDraw
b, a, pre, out, *names = sys.argv[1:]
rows = []
for n in names:
    x, y = Image.open(f"{b}/{pre}-{n}.png").convert("RGB"), Image.open(f"{a}/{pre}-{n}.png").convert("RGB")
    w, h = x.size
    r = Image.new("RGB", (w * 2 + 8, h), (40, 30, 40))
    r.paste(x, (0, 0)); r.paste(y, (w + 8, 0))
    d = ImageDraw.Draw(r)
    for t, ox in (("BEFORE", 6), ("AFTER (GITCRAFT)", w + 14)):
        d.rectangle((ox, h - 26, ox + 8 * len(t) + 10, h - 6), fill=(40, 30, 40)); d.text((ox + 5, h - 22), t, fill=(246, 236, 220))
    rows.append(r)
s = Image.new("RGB", (rows[0].size[0], sum(r.size[1] + 8 for r in rows)), (40, 30, 40))
yy = 0
for r in rows:
    s.paste(r, (0, yy)); yy += r.size[1] + 8
s.save(out, quality=82)
print(out)
