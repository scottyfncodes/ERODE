"""A small layout kit over GITCRAFT DesignCraft for the art bible (art/bible/build_bible.py).

DesignCraft runs headless through GITCRAFT's own launcher (scripts/mcp.sh: guard, sandbox, audit
log), driven over stdio MCP with GITCRAFT's own client. Every helper is one or a few DesignCraft
commands; nothing is drawn outside DesignCraft.
"""
import json, os, re, sys

RUNTIME = os.path.expanduser(os.environ.get("GITCRAFT_RUNTIME", "~/.gitcraft/runtime"))
sys.path.insert(0, os.path.join(RUNTIME, "tests"))
from mcp_client import Client  # noqa: E402  (GITCRAFT's stdio MCP client)


# Google's static IBM Plex Mono files name each weight as its own family (fc-scan: "IBM Plex Mono
# Medium" / Regular); Jost and Courier Prime carry a typographic family. Map the CSS weight names.
FONT_ALIAS = {("IBM Plex Mono", "Medium"): ("IBM Plex Mono Medium", "Regular"), ("IBM Plex Mono", "SemiBold"): ("IBM Plex Mono SemiBold", "Regular")}


class DC:
    def __init__(self, cwd, log):
        self.c = Client([os.path.join(RUNTIME, "scripts", "mcp.sh"), "designcraft"], log=log, cwd=cwd)
        self.calls = 0
        self.swatches = set()

    def tool(self, name, args=None, timeout=600):
        ok, r = self.c.call(name, args or {}, timeout)
        self.calls += 1
        if not ok:
            raise RuntimeError(f"DesignCraft {name} {json.dumps(args)[:300]} failed: {r}")
        return r

    def x(self, command, params=None):
        return self.tool("execute", {"command": command, "params": params or {}})

    def close(self):
        self.c.close()

    # ---- colour
    def swatch(self, hexcol):
        name = "RS " + hexcol.upper().lstrip("#")
        if name not in self.swatches:
            self.x("swatch.create", {"name": name, "color": hexcol})
            self.swatches.add(name)
        return name

    # ---- shapes
    def rect(self, sp, r, fill=None, stroke=None, weight=1.0, radius=0, opacity=None, shape="rectangle"):
        f = self.x("frame.create", {"spread": sp, "rect": r, "content": "unassigned", "shape": shape})
        i = f["id"]
        if fill:
            self.x("object.color", {"color": fill, "target": "fill", "ids": [i]})
        else:
            self.x("object.fill", {"swatch": "[None]", "ids": [i]})
        if stroke:
            self.x("object.color", {"color": stroke, "target": "stroke", "ids": [i]})
            self.x("object.stroke", {"weight": weight, "align": "inside", "ids": [i]})
        else:
            self.x("object.stroke", {"weight": 0, "ids": [i]})
        if radius:
            self.x("object.cornerOptions", {"shape": "rounded", "size": radius, "ids": [i]})
        if opacity is not None:
            self.x("object.opacity", {"opacity": opacity, "ids": [i]})
        return i

    def gradient(self, sp, r, stops, angle=0):
        f = self.x("frame.create", {"spread": sp, "rect": r, "content": "unassigned"})
        self.x("object.gradient", {"kind": "linear", "angle": angle, "ids": [f["id"]], "stops": stops})
        self.x("object.stroke", {"weight": 0, "ids": [f["id"]]})
        return f["id"]

    # ---- text: one frame, one set of character and paragraph attributes
    def text(self, sp, r, s, font, style, size, color, tracking=0, leading=None, align="left", space_after=0, caps=False, vjust=None):
        f = self.x("frame.create", {"spread": sp, "rect": r, "content": "text", "text": s})
        n = len(s.encode("utf-8"))
        self.x("text.select", {"story": f["story"], "anchor": 0, "focus": n})
        font, style = FONT_ALIAS.get((font, style), (font, style))
        attrs = {"fontFamily": font, "fontStyle": style, "size": size, "tracking": tracking, "fill": self.swatch(color)}
        if leading:
            attrs["leading"] = {"kind": "points", "value": leading}
        if caps:
            attrs["capitalization"] = "allCaps"
        w = self.x("type.char", {"attrs": attrs})
        if w and w.get("warnings"):
            raise RuntimeError(f"font problem in {s[:40]!r}: {w['warnings']}")
        self.x("type.para", {"attrs": {"align": align, "hyphenate": False, "spaceAfter": space_after}})
        # set what is typed: no ligatures or contextual forms (Jost would join "--" into a dash)
        self.x("type.feature", {"features": {"liga": False, "clig": False, "calt": False, "dlig": False}})
        # CSS custom properties inside running text are code: set them in Plex Mono (Jost's tight
        # hyphens would otherwise read "--slate" as a dash)
        if font == "Jost":
            for m in re.finditer(r"--[a-z0-9-]+", s):
                a0, a1 = len(s[: m.start()].encode("utf-8")), len(s[: m.end()].encode("utf-8"))
                self.x("text.select", {"story": f["story"], "anchor": a0, "focus": a1})
                self.x("type.char", {"attrs": {"fontFamily": "IBM Plex Mono Medium", "fontStyle": "Regular", "size": round(size * 0.92, 2), "tracking": 0}})
        self.x("edit.deselectAll")
        if vjust:
            self.x("object.textFrameOptions", {"verticalJustification": vjust, "inset": 0, "ids": [f["id"]]})
        else:
            self.x("object.textFrameOptions", {"inset": 0, "ids": [f["id"]]})
        return f

    # ---- pictures
    def image(self, sp, r, path, align=4, stroke=None, weight=0.75):
        f = self.x("frame.create", {"spread": sp, "rect": r, "content": "graphic"})
        i = f["id"]
        self.tool("place_image", {"path": path, "frame": i})
        self.x("object.fittingOptions", {"fitting": "fillProportionally", "align": align, "ids": [i]})
        self.x("object.fit", {"mode": "fillProportionally", "ids": [i]})
        if stroke:
            self.x("object.color", {"color": stroke, "target": "stroke", "ids": [i]})
            self.x("object.stroke", {"weight": weight, "align": "inside", "ids": [i]})
        else:
            self.x("object.stroke", {"weight": 0, "ids": [i]})
        return i

    def shift_content(self, frame, dx, dy):
        self.x("transform.move", {"dx": dx, "dy": dy, "ids": [frame], "content": True})
