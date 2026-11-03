"""ROCKSLIDE x GITCRAFT production pipeline: DesignCraft lays out the art bible (PDFCraft then combines it with the emblem PDF).
Runs GITCRAFT servers through scripts/mcp.sh (guard + Landlock sandbox), via gcx.py.
Outputs go to $ROCKSLIDE_PRODUCTION (default ~/../rockslide-production, inside the GITCRAFT roots)."""
import gcx as g  # noqa, json, os
B="/home/user/rockslide-production/brand"; F="/home/user/rockslide-production/final"
W, H = 1200, 800
def x(cmd, p):
    ok, r = g.call("designcraft", "execute", {"command": cmd, "params": p})
    if not ok: print("FAIL", cmd, r)
    return r
ok, r = g.call("designcraft", "new_document", {"width": W, "height": H, "pages": 2, "facingPages": False, "intent": "print", "margins": 0, "title": "ROCKSLIDE Kessel art bible"}); print(ok, r)
d = g.call("designcraft", "inspect_document", {})[1]
spreads = d["spreads"]; print("spreads", len(spreads), [s.get("index") for s in spreads])
PAL = json.load(open("/home/user/ROCKSLIDE/art/rockslide-palette.json"))
for n, hx in [("Ink", "#141C24"), ("Paper", "#F1ECE1"), ("Red", "#D8382A"), ("Orange", "#FF7A1A"), ("Muted", "#9FB0BF")]:
    x("swatch.create", {"name": "RS " + n, "color": hx})
def solid(spread, rect, hx):
    r = x("frame.create", {"spread": spread, "rect": rect, "content": "graphic"})
    x("object.gradient", {"kind": "linear", "ids": [r["id"]], "stops": [{"location": 0, "color": hx}, {"location": 100, "color": hx}]})
    return r
def text(spread, rect, s, attrs):
    r = x("frame.create", {"spread": spread, "rect": rect, "content": "text", "text": s})
    x("text.selectStory", {"frame": r["id"], "point": [rect[0] + 4, rect[1] + 6]})
    x("type.char", {"attrs": attrs})
    x("edit.deselectAll", {})
    return r
H1 = {"fontFamily": "Inter Display", "fontStyle": "Black", "size": 64, "fill": "RS Paper"}
MONO = {"fontFamily": "JetBrains Mono", "fontStyle": "Bold", "size": 15, "tracking": 200, "fill": "RS Orange"}
BODY = {"fontFamily": "Inter", "fontStyle": "Regular", "size": 17, "fill": "RS Paper", "leading": {"kind": "points", "value": 25}}
SMALL = {"fontFamily": "JetBrains Mono", "fontStyle": "Medium", "size": 11, "fill": "RS Muted"}
# page 1: identity
solid(0, [0, 0, W, H], "#141C24")
g.call("designcraft", "place_image", {"path": f"{B}/kessel-patrol-emblem.png", "x": 60, "y": 60, "width": 200, "spread": 0})
text(0, [290, 92, 1150, 170], "ROCKSLIDE", H1)
text(0, [294, 172, 1150, 196], "KESSEL VALLEY ART DIRECTION", MONO)
text(0, [60, 300, 640, 760], "A miniature alpine world, built from chunky faceted primitives and flat palette colour, lit like a clear winter morning: warm sun, blue shade, snow that holds the light.\n\nRock is granite in the same tone as the ground rock, weathered into upright tors; snow sits only on the ledges. Patrol equipment is red with a white cross, so anything that can help you reads at a glance. Pole orange marks the way. The interface is slate instrument housing over paper maps.\n\nEvery 3D piece is built in GITCRAFT MeshCraft from art/3d/scripts/kessel_kit.py with these palette roles, baked to vertex colour so the game shades it with its own light.", BODY)
cols = list(PAL.items())
for i, (name, hx) in enumerate(cols):
    cx, cy = 700 + (i % 4) * 118, 300 + (i // 4) * 66
    solid(0, [cx, cy, cx + 104, cy + 36], hx)
    text(0, [cx, cy + 38, cx + 112, cy + 62], f"{name}\n{hx}", SMALL)
# page 2: the kit
solid(1, [0, 0, W, H], "#141C24")
text(1, [60, 40, 1150, 104], "The Kessel kit", dict(H1, size=46))
text(1, [62, 104, 1150, 128], "MESHCRAFT (BLENDER 5.2.3) · FORGECRAFT LIBRARY · THREE-WEB-TOON GLB", MONO)
ids = ["rs_crag_a", "rs_crag_b", "rs_crag_c", "rs_boulder_a", "rs_boulder_b", "rs_stump", "rs_deadfall", "rs_akja", "rs_cache", "rs_lantern"]
for i, a in enumerate(ids):
    d = [p for p in os.listdir(F) if p.rsplit("_v", 1)[0] == a][0]
    meta = json.load(open(f"{F}/{d}/asset.json"))
    tris = meta.get("triangles") or meta.get("geometry", {}).get("triangles") or ""
    cx, cy = 60 + (i % 5) * 220, 160 + (i // 5) * 300
    solid(1, [cx, cy, cx + 200, cy + 200], "#E6DFD0")
    g.call("designcraft", "place_image", {"path": f"{F}/{d}/previews/{a}_three_quarter.png", "x": cx, "y": cy, "width": 200, "spread": 1})
    text(1, [cx, cy + 208, cx + 210, cy + 228], a, dict(MONO, size=13, tracking=40, fill="RS Paper"))
    glb = os.path.getsize(f"/home/user/ROCKSLIDE/public/models/{a}.glb")
    text(1, [cx, cy + 230, cx + 210, cy + 270], f"library v{d.rsplit('_v',1)[1]} · {tris} tris\n{glb/1024:.1f} KB GLB · validated", SMALL)
print(g.call("designcraft", "export_png", {"page": 1, "path": f"{B}/kit-sheet.png", "scale": 1}))
print(g.call("designcraft", "export_png", {"page": 0, "path": f"{B}/art-direction.png", "scale": 1}))
print(x("file.exportPdf", {"path": f"{B}/kessel-art-bible-layout.pdf"}))
g.call("designcraft", "save_document", {"path": f"{B}/kessel-art-bible.designcraft"})
