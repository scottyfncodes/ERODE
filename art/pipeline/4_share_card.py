"""ROCKSLIDE x GITCRAFT production pipeline: DesignCraft composes the 1200x630 share card (public/og-image.jpg).
Storybook direction (art/README.md): aubergine card stock with an inset cream rule, the Jost wordmark in tracked
capitals, Courier Prime copy, and the patrol lodge at dusk with Vince and Koda.

1. node art/pipeline/4_share_card_capture.mjs gitcraft-out/designcraft/shots   (needs `npx vite preview --port 4173`)
2. Put Jost (Medium, SemiBold) and Courier Prime TTFs (Google Fonts, OFL) in gitcraft-out/designcraft/Document Fonts/:
   DesignCraft picks up a "Document Fonts" folder next to the document when it is opened, which is the reliable way
   to give the sandboxed server fonts that were installed after it started.
3. python3 4_share_card.py   (runs DesignCraft through scripts/mcp.sh via gcx.py)
Writes gitcraft-out/designcraft/og-card.designcraft and og-image.jpg; copy the JPEG to public/og-image.jpg."""
import gcx as g, json, os
W = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../gitcraft-out/designcraft"))
EMBLEM = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../public/icons/icon-512.png"))

def call(tool, a):
    ok, r = g.call("designcraft", tool, a)
    if not ok: raise SystemExit(f"{tool} failed: {r}")
    return r
def x(cmd, p=None): return call("execute", {"command": cmd, "params": p or {}})
def text(rect, s, attrs, hyphenate=True):
    f = x("frame.create", {"rect": rect, "content": "text", "text": s})
    x("text.selectStory", {"frame": f["id"], "point": [rect[0] + 4, rect[1] + 6]})
    x("type.char", {"attrs": attrs})
    if not hyphenate: x("type.para", {"attrs": {"hyphenate": False}})
    x("edit.deselectAll")
    return f

# The emblem without its square field: a round cut of the shipped icon.
from PIL import Image, ImageDraw
im = Image.open(EMBLEM).convert("RGBA"); c, r = 256, 208
m = Image.new("L", (2048, 2048), 0); ImageDraw.Draw(m).ellipse([(c - r) * 4, (c - r) * 4, (c + r) * 4, (c + r) * 4], fill=255)
im.putalpha(m.resize((512, 512), Image.LANCZOS)); im.crop((c - r, c - r, c + r, c + r)).save(f"{W}/emblem-round.png")

call("new_document", {"width": 1200, "height": 630, "intent": "web", "margins": 0, "title": "ROCKSLIDE share card"})
call("save_document", {"path": f"{W}/og-card.designcraft"})
call("open_document", {"path": f"{W}/og-card.designcraft"})  # loads Document Fonts/
for n, hx in [("Aubergine", "#3A2632"), ("Paper", "#F6ECDC"), ("Blush", "#E7AAA6"), ("Mustard", "#E0B042")]:
    x("swatch.create", {"name": "RS " + n, "color": hx})
bg = x("frame.create", {"rect": [0, 0, 1200, 630], "content": "graphic"})
x("object.fill", {"swatch": "RS Aubergine", "ids": [bg["id"]]}); x("object.stroke", {"weight": 0, "ids": [bg["id"]]})
hero = x("frame.create", {"rect": [420, 0, 1200, 630], "content": "graphic"})
call("place_image", {"path": f"{W}/shots/dusk.png", "frame": hero["id"]})
x("object.fit", {"mode": "fillProportionally", "ids": [hero["id"]]}); x("object.stroke", {"weight": 0, "ids": [hero["id"]]})
x("transform.move", {"dx": 120, "dy": 0, "ids": [hero["id"]], "content": True})  # lodge right of the wordmark
fade = x("frame.create", {"rect": [418, 0, 720, 630], "content": "graphic"})
x("object.gradient", {"kind": "linear", "angle": 0, "ids": [fade["id"]], "stops": [
    {"location": 0, "color": "#3A2632", "opacity": 100}, {"location": 35, "color": "#3A2632", "opacity": 82},
    {"location": 100, "color": "#3A2632", "opacity": 0}]})
x("object.stroke", {"weight": 0, "ids": [fade["id"]]})
rule = x("frame.create", {"rect": [18, 18, 1182, 612], "content": "unassigned"})
x("object.stroke", {"swatch": "RS Paper", "weight": 1.5, "align": "inside", "ids": [rule["id"]]})
x("object.fill", {"swatch": "[None]", "ids": [rule["id"]]})
call("place_image", {"path": f"{W}/emblem-round.png", "x": 64, "y": 66, "width": 104})
text([60, 222, 760, 318], "ROCKSLIDE", {"fontFamily": "Jost", "fontStyle": "SemiBold", "size": 84, "tracking": 110, "fill": "RS Paper", "leading": {"kind": "points", "value": 88}})
text([66, 322, 700, 352], "MOUNTAIN PATROL", {"fontFamily": "Jost", "fontStyle": "Medium", "size": 21, "tracking": 520, "fill": "RS Blush"})
text([66, 392, 520, 520], "Rescues, avalanche control and recon flights in the Kessel valley. A snowmobile, a helicopter, a pair of old skis, and Koda.",
     {"fontFamily": "Courier Prime", "fontStyle": "Regular", "size": 19, "fill": "RS Paper", "leading": {"kind": "points", "value": 27}}, hyphenate=False)
text([66, 548, 766, 570], "PLAY FREE IN THE BROWSER  ·  ROCKSLIDE-GAME.VERCEL.APP",
     {"fontFamily": "Jost", "fontStyle": "SemiBold", "size": 13, "tracking": 220, "fill": "RS Mustard"}, hyphenate=False)
missing = [f for f in x("font.list") if f["missing"] or f["matchStatus"] != "exact"]
if missing: raise SystemExit(f"fonts not resolved: {json.dumps(missing)[:400]}")
print(call("export_png", {"path": f"{W}/og-image.jpg", "scale": 1, "page": 0}))
call("save_document", {"path": f"{W}/og-card.designcraft"})
