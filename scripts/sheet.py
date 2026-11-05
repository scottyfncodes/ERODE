"""Contact sheet of a capture folder: python3 scripts/sheet.py <dir> <prefix> <out.jpg> [cols]"""
import glob, sys
from PIL import Image
d, pre, out = sys.argv[1:4]
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 3
fs = sorted(glob.glob(f"{d}/{pre}-*.png"))
ims = [Image.open(f) for f in fs]
w, h = ims[0].size[0] // 2, ims[0].size[1] // 2
sheet = Image.new("RGB", (w * cols, h * ((len(ims) + cols - 1) // cols)))
for i, im in enumerate(ims):
    sheet.paste(im.resize((w, h)), ((i % cols) * w, (i // cols) * h))
sheet.save(out, quality=85)
print(out, [f.split("/")[-1] for f in fs])
