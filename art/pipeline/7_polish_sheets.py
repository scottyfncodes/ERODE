"""ROCKSLIDE polish pass: before/after sheets for the PR, composed in PhotoCraft.

Input: captures of main (before-*) and this branch (after-*) made with the same scripted views,
copied to $ROCKSLIDE_PRODUCTION/polish/. Each sheet is a PhotoCraft document: the captures are
placed as smart objects at half size on the patrol slate, then exported to JPEG in docs/polish/.
Portrait sheets: before on the top row, after on the bottom. Landscape: before left, after right."""
import os, sys
import gcx as g  # noqa

SRC = os.path.join(g.PROD, "polish")
OUT = "/home/user/ROCKSLIDE/docs/polish"
os.makedirs(OUT, exist_ok=True)
VIEWS = ["0title", "2yard", "3sled", "4heli"]
GAP = 12


def sheet(name, w, h, cells):
    ok, r = g.call("photocraft", "doc_new", {"width": w, "height": h, "background": "#141c24", "name": name})
    if not ok:
        sys.exit(f"doc_new failed: {r}")
    for path, cx, cy in cells:
        ok, r = g.call("photocraft", "doc_place", {"path": path, "center": [cx, cy], "scale": 50})
        if not ok:
            sys.exit(f"doc_place {path} failed: {r}")
    ok, r = g.call("photocraft", "doc_save", {"path": f"{OUT}/{name}.jpg", "format": "jpg"})
    print(name, "saved" if ok else f"FAIL {r}", r if ok else "")
    g.call("photocraft", "doc_close", {})


# portrait: 390x844 captures at 50% -> 195x422
pw, ph = 195, 422
W = GAP + len(VIEWS) * (pw + GAP)
H = GAP + 2 * (ph + GAP)
cells = []
for i, v in enumerate(VIEWS):
    cx = GAP + i * (pw + GAP) + pw / 2
    cells.append((f"{SRC}/before-p-{v}.png", cx, GAP + ph / 2))
    cells.append((f"{SRC}/after-p-{v}.png", cx, GAP + ph + GAP + ph / 2))
sheet("portrait-before-after", W, H, cells)

# landscape: 844x390 captures at 50% -> 422x195
lw, lh = 422, 195
W = GAP + 2 * (lw + GAP)
H = GAP + len(VIEWS) * (lh + GAP)
cells = []
for i, v in enumerate(VIEWS):
    cy = GAP + i * (lh + GAP) + lh / 2
    cells.append((f"{SRC}/before-l-{v}.png", GAP + lw / 2, cy))
    cells.append((f"{SRC}/after-l-{v}.png", GAP + lw + GAP + lw / 2, cy))
sheet("landscape-before-after", W, H, cells)
