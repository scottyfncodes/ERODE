"""ROCKSLIDE x GITCRAFT production pipeline: VectorCraft draws the Kessel Patrol emblem.
Runs GITCRAFT servers through scripts/mcp.sh (guard + Landlock sandbox), via gcx.py.
Outputs go to $ROCKSLIDE_PRODUCTION (default ~/../rockslide-production, inside the GITCRAFT roots)."""
import gcx as g  # noqa, json
B="/home/user/rockslide-production/brand"
def c(name, a):
    ok, r = g.call("vectorcraft", name, a)
    if not ok: print("FAIL", name, r); raise SystemExit(1)
    return r
c("command_run", {"id": "file.new", "params": {"name": "kessel-patrol-emblem", "width": 1024, "height": 1024, "units": "Pixels", "colorMode": "rgb"}})
INK, SLATE, PAPER, SNOW, SHADE, RED, ORANGE, GLACIER = "#141C24", "#1D2731", "#F1ECE1", "#F4F6F8", "#C9D8EA", "#D8382A", "#FF7A1A", "#9FC3DE"
c("draw_shape", {"shape": "rectangle", "x": 0, "y": 0, "width": 1024, "height": 1024, "fill": INK, "stroke": "none", "name": "field"})
c("draw_shape", {"shape": "ellipse", "x": 112, "y": 112, "width": 800, "height": 800, "fill": SLATE, "stroke": PAPER, "strokeWidth": 26, "name": "patch"})
c("draw_shape", {"shape": "ellipse", "x": 150, "y": 150, "width": 724, "height": 724, "fill": "none", "stroke": ORANGE, "strokeWidth": 9, "name": "pole ring"})
for i, (x, y, r) in enumerate([(330, 300, 7), (650, 250, 9), (735, 360, 6), (420, 225, 5)]):
    c("draw_shape", {"shape": "ellipse", "x": x - r, "y": y - r, "width": 2 * r, "height": 2 * r, "fill": PAPER, "stroke": "none", "name": f"star {i}"})
# the Grauhorn: a snow peak with its shaded north face and a glacier tongue
c("draw_path", {"d": "M168 602 L392 352 L452 410 L566 262 L858 602 Z", "fill": SNOW, "stroke": "none", "name": "peak"})
c("draw_path", {"d": "M566 262 L858 602 L668 602 L612 444 L640 380 Z", "fill": SHADE, "stroke": "none", "name": "north face"})
c("draw_path", {"d": "M392 352 L452 410 L420 470 L380 430 L330 520 L300 455 Z", "fill": GLACIER, "stroke": "none", "name": "couloir"})
# the patrol band and its cross
c("draw_path", {"d": "M121.8 600 L902.2 600 A400 400 0 0 1 825.8 760 L198.2 760 A400 400 0 0 1 121.8 600 Z", "fill": RED, "stroke": "none", "name": "patrol band"})
c("draw_path", {"d": "M490 618 L534 618 L534 658 L574 658 L574 702 L534 702 L534 742 L490 742 L490 702 L450 702 L450 658 L490 658 Z", "fill": PAPER, "stroke": "none", "name": "cross"})
c("save_file", {"path": f"{B}/kessel-patrol-emblem.vectorcraft"})
for f in ("svg", "png", "pdf"):
    r = c("export", {"path": f"{B}/kessel-patrol-emblem.{f}", "format": f})
    print(f, json.dumps(r)[:200])
print(json.dumps(c("inspect_document", {"depth": 1}))[:600])
