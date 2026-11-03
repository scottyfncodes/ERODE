"""ROCKSLIDE x GITCRAFT production pipeline: DesignCraft composes the 1200x630 share card (one server session).
Runs GITCRAFT servers through scripts/mcp.sh (guard + Landlock sandbox), via gcx.py.
Outputs go to $ROCKSLIDE_PRODUCTION (default ~/../rockslide-production, inside the GITCRAFT roots)."""
import gcx as g, json
B="/home/user/rockslide-production/brand"
def c(tool, a):
    ok, r = g.call("designcraft", tool, a)
    print(tool, a.get("command", ""), "OK" if ok else "FAIL", json.dumps(r)[:260]); return ok, r
c("new_document", {"width": 1200, "height": 630, "intent": "web", "margins": 0, "columns": 1})
ok, img = c("place_image", {"path": f"{B}/hero-title.png", "x": 0, "y": 0, "width": 1200})
ok, sh = c("execute", {"command": "frame.create", "params": {"rect": [0, 0, 820, 630], "content": "graphic"}})
c("execute", {"command": "object.gradient", "params": {"kind": "linear", "angle": 0, "ids": [sh["id"]], "stops": [{"location": 0, "color": "#141C24", "opacity": 96}, {"location": 55, "color": "#141C24", "opacity": 80}, {"location": 100, "color": "#141C24", "opacity": 0}]}})
ok, em = c("place_image", {"path": f"{B}/kessel-patrol-emblem.png", "x": 64, "y": 92, "width": 150})
ok, t1 = c("execute", {"command": "frame.create", "params": {"rect": [60, 262, 820, 380], "content": "text", "text": "ROCKSLIDE"}})
ok, t2 = c("execute", {"command": "frame.create", "params": {"rect": [66, 386, 820, 424], "content": "text", "text": "MOUNTAIN PATROL"}})
ok, t3 = c("execute", {"command": "frame.create", "params": {"rect": [66, 440, 640, 540], "content": "text", "text": "Rescues, avalanche control and recon flights in the Kessel valley. A snowmobile, a helicopter, a pair of old skis, and Koda."}})
ok, b1 = c("execute", {"command": "frame.create", "params": {"rect": [0, 618, 1200, 630], "content": "graphic"}})
c("execute", {"command": "object.gradient", "params": {"kind": "linear", "angle": 0, "ids": [b1["id"]], "stops": [{"location": 0, "color": "#D8382A"}, {"location": 72, "color": "#D8382A"}, {"location": 72.5, "color": "#FF7A1A"}, {"location": 100, "color": "#FF7A1A"}]}})

def c2(cmd, p):
    ok, r = g.call("designcraft", "execute", {"command": cmd, "params": p})
    print(cmd, "OK" if ok else "FAIL", json.dumps(r)[:200]); return r
for name, hx in [("RS Paper", "#F1ECE1"), ("RS Patrol Red", "#D8382A"), ("RS Amber", "#F6D488"), ("RS Orange", "#FF7A1A")]:
    c2("swatch.create", {"name": name, "color": hx})
def style(frame, pt, attrs):
    c2("text.selectStory", {"frame": frame, "point": pt})
    c2("type.char", {"attrs": attrs})
style(t1['id'], [80, 300], {"fontFamily": "Inter Display", "fontStyle": "Black", "size": 108, "tracking": -20, "fill": "RS Paper", "leading": {"kind": "points", "value": 104}})
style(t2['id'], [80, 400], {"fontFamily": "JetBrains Mono", "fontStyle": "ExtraBold", "size": 25, "tracking": 320, "fill": "RS Orange"})
style(t3['id'], [80, 460], {"fontFamily": "Inter", "fontStyle": "Medium", "size": 23, "fill": "RS Paper", "leading": {"kind": "points", "value": 31}})
c2("edit.deselectAll", {})
ok, r = g.call("designcraft", "export_png", {"path": f"{B}/og-image.png", "scale": 1}); print(r)
ok, r = g.call("designcraft", "save_document", {"path": f"{B}/og-card.designcraft"}); print(ok, str(r)[:200])
