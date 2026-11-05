"""ROCKSLIDE: the working mountain (MeshCraft run_script).

Run inside MeshCraft's Blender (globals: bpy, kit, args, Palette):
  run_script {"path": ".../working_mountain.py", "args": {"asset": "rs_snowcat", "palette": ".../rockslide-palette.json", "out": ".../rs_snowcat.blend"}}

What an avalanche operation leaves on a range over the years (src/render/opsView.ts): snow fences on
Kessel Ridge, remote avalanche exploders over the start zone, a solar radio repeater, the AVALANCHE AREA
signs on the pass road, the old grooming snowcat by the top station, and the silver mine above the pass
road (its timber headframe and a collapsed cabin). Each replaces a code-built piece of the same size,
modelled in the game's own coordinates (metres, +Y up, facing -Z at rotation 0, origin on the ground at
its centre), so opsSpots() and the collision circles stay as they are. One node each.

Materials are roles; the game paints each role with its own graded colour and bakes the whole working
mountain into one vertex-coloured mesh, as before. The sign's printed face stays the game's canvas.
"""
import math
import bpy, bmesh
from mathutils import Matrix, Vector

A = args  # noqa: F821
pal = Palette.from_file(A["palette"])  # noqa: F821
asset = A["asset"]
K = kit  # noqa: F821
K.reset()
TO_BLENDER = Matrix.Rotation(math.pi / 2, 4, "X")

# the code's own colours (src/render/opsView.ts), so a role reads the same before the game repaints it
ROLES = {
    "timber": "#6F5B4C", "timberOld": "#5A4A3F", "timberDark": "#4F4339", "steel": "#8C9298", "steelDark": "#5B5E60",
    "concrete": "#9A9893", "catRed": "#A4473A", "rust": "#7A4C33", "dark": "#23262A", "track": "#4A4D50",
    "glass": "#2E3B44", "blade": "#6D6A63", "snow": "Kessel Snow", "yellow": "#D9A429", "control": "#D2C9A8",
    "panel": "#1D2A3A", "panelCell": "#2F4A66", "battery": "#8A8E88", "whip": "#D8D8D8", "antenna": "#E6E3DC",
    "plate": "#55534E", "tailings": "#9A7456",
    # snow lying on the ground (drifts, mounds, banks): the game lays it onto the terrain under the piece
    "groundSnow": "Kessel Snow", "pipe": "#3B3532", "rope": "#8A7A5A", "lamp": "#E9C46A",
}
mats = K.Materials(pal, ROLES, prefix="RS")
M = mats.__getitem__


def place(o, pos=(0, 0, 0), rot=(0, 0, 0), role=None):
    o.rotation_mode = "ZYX"  # Blender ZYX == three.js 'XYZ'
    o.location = pos; o.rotation_euler = rot
    if role: K.assign(o, M(role))
    return o


def B(role, w, h, d, pos=(0, 0, 0), rot=(0, 0, 0), bevel=0.0):
    return place(K.box("b", (w, h, d), (0, 0, 0), None, bevel=bevel), pos, rot, role)


def C(role, rt, rb, h, seg, pos=(0, 0, 0), rot=(0, 0, 0)):
    return place(K.cylinder("c", rt, h, (0, 0, 0), axis="Y", verts=seg, r2=rb), pos, rot, role)


def mound(role, w, h, d, pos, seg=10, rings=4, rot=(0, 0, 0)):
    """A snow drift or a heap: the top half of a squashed sphere, w x d at the base, h high."""
    bm = bmesh.new()
    top = bm.verts.new((0, h, 0))
    ringv = []
    for j in range(rings, 0, -1):
        a = (math.pi / 2) * j / (rings + 1)
        ringv.append([bm.verts.new((math.cos(t) * math.cos(a) * w / 2, math.sin(a) * h, math.sin(t) * math.cos(a) * d / 2))
                      for t in (math.tau * i / seg for i in range(seg))])
    base = [bm.verts.new((math.cos(t) * w / 2, 0, math.sin(t) * d / 2)) for t in (math.tau * i / seg for i in range(seg))]
    ringv.append(base)
    for i in range(seg):
        bm.faces.new((top, ringv[0][(i + 1) % seg], ringv[0][i]))
    for a_, b_ in zip(ringv, ringv[1:]):
        for i in range(seg):
            bm.faces.new((a_[i], a_[(i + 1) % seg], b_[(i + 1) % seg], b_[i]))
    bm.faces.new(base)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("mound"); bm.to_mesh(me); bm.free()
    return place(K.link(bpy.data.objects.new("mound", me)), pos, rot, role)


def beam(role, a, b, t):
    """A square timber or bar of thickness t from point a to point b (three.js space)."""
    a, b = Vector(a), Vector(b)
    d = b - a
    L = d.length
    o = K.box("beam", (t, L, t), (0, 0, 0), None)
    # point the box's +y along d
    q = Vector((0, 1, 0)).rotation_difference(d.normalized())
    o.rotation_mode = "QUATERNION"; o.rotation_quaternion = q
    o.location = (a + b) / 2
    K.assign(o, M(role))
    return o


def finish(parts, name, pivot=(0, 0, 0)):
    o = K.join(parts, name)
    o.data.transform(o.matrix_world); o.matrix_world = Matrix()
    pv = Vector(pivot)
    o.data.transform(Matrix.Translation(-pv))
    o.data.transform(TO_BLENDER)
    o.location = TO_BLENDER @ pv
    K.shade(o)
    K.bake_vertex_colors(o, mats, jitter=0.05, seed=len(name))
    o["gitcraft_asset"] = asset
    return o


# ------------------------------------------------------------------ the snow fence
def snow_fence():
    """A ridge snow fence, 4.5 m of weathered slats with gaps between them (it slows the wind rather than
    stopping it), on two posts set in the snow, a raking brace on the windward side, battens holding the
    slats, the drift it builds in its lee (+z) and snow along the top rail. Kept lean (about 60 of them
    stand on the ridge): every part is a plain box and the drift is a low dome."""
    p = []
    for x in (-2.1, 2.1):
        p.append(B("timberOld", 0.16, 2.7, 0.16, (x, 1.05, 0)))
        p.append(beam("timberOld", (x, 0.0, -1.35), (x, 2.0, -0.08), 0.11))
    for i in range(6):
        y = 0.35 + i * 0.32
        p.append(B("timberOld" if i % 2 else "timber", 4.6, 0.15, 0.04, (0, y, 0.1), (0, 0, 0.012 * ((i * 7) % 3 - 1))))
    for x in (-1.0, 1.0):
        p.append(B("timberDark", 0.1, 1.9, 0.05, (x, 1.15, 0.14)))
    p += [B("snow", 4.5, 0.08, 0.16, (0, 2.27, 0.1)), mound("groundSnow", 5.2, 0.62, 3.6, (0, -0.1, 1.55), seg=10, rings=3)]
    return [finish(p, "fence")]


# ------------------------------------------------------------------ the exploder
def exploder():
    """A remote avalanche exploder: a steel tube on a concrete footing, flanged, turning over the top in a
    mitred elbow and down toward the slope (+z) to a flared mouth; a yellow band, the gas bottles in a
    hut with a little roof, the control box with its antenna and solar panel, and snow on it all."""
    p = [B("concrete", 1.8, 0.9, 1.8, (0, 0.2, 0), bevel=0.04), B("snow", 1.8, 0.18, 1.8, (0, 0.72, 0)),
         C("steel", 0.3, 0.3, 3.6, 10, (0, 2.45, 0)), C("steelDark", 0.38, 0.38, 0.1, 10, (0, 0.7, 0)),
         C("yellow", 0.32, 0.32, 0.3, 10, (0, 1.6, 0))]
    for y in (2.3, 3.6):
        p.append(C("steelDark", 0.36, 0.36, 0.08, 10, (0, y, 0)))
    # the elbow: three mitred segments over the top, then the arm down toward the slope
    pts = [(0, 4.2, 0), (0, 4.65, 0.25), (0, 4.75, 0.7), (0, 4.55, 1.2)]
    for a, b in zip(pts, pts[1:]):
        d = Vector(b) - Vector(a)
        o = C("steel", 0.28, 0.28, d.length + 0.12, 10, tuple((Vector(a) + Vector(b)) / 2))
        o.rotation_mode = "QUATERNION"; o.rotation_quaternion = Vector((0, 1, 0)).rotation_difference(d.normalized())
        p.append(o)
    arm_a, arm_b = Vector((0, 4.55, 1.2)), Vector((0, 4.1, 2.25))
    d = arm_b - arm_a
    for role, r0, r1, L, at in (("steel", 0.26, 0.26, d.length, (arm_a + arm_b) / 2), ("dark", 0.44, 0.27, 0.5, arm_b + d.normalized() * 0.15),
                                ("steelDark", 0.46, 0.46, 0.06, arm_b + d.normalized() * 0.4)):
        o = C(role, r0, r1, L, 12, tuple(at))
        o.rotation_mode = "QUATERNION"; o.rotation_quaternion = Vector((0, 1, 0)).rotation_difference(d.normalized())
        p.append(o)
    p.append(B("snow", 0.5, 0.1, 0.9, (0, 4.95, 0.5)))
    # gas bottle hut and control box on the footing
    p += [B("steelDark", 0.7, 0.9, 0.5, (-0.45, 1.1, -0.55)), B("timberDark", 0.85, 0.06, 0.65, (-0.45, 1.58, -0.55)),
          B("snow", 0.85, 0.1, 0.65, (-0.45, 1.66, -0.55))]
    for x in (-0.6, -0.3):
        p.append(C("yellow", 0.1, 0.1, 0.75, 8, (x, 1.05, -0.5)))
    p += [B("control", 0.6, 0.8, 0.4, (0.95, 1.05, -0.3), bevel=0.02), B("snow", 0.7, 0.1, 0.5, (0.95, 1.5, -0.3)),
          C("whip", 0.015, 0.015, 1.4, 4, (1.15, 2.15, -0.4)), B("panel", 0.7, 0.04, 0.5, (0.95, 1.85, -0.15), (-0.8, 0, 0)),
          B("steelDark", 0.04, 0.5, 0.04, (0.95, 1.6, -0.25))]
    return [finish(p, "exploder")]


# ------------------------------------------------------------------ the radio repeater
def repeater():
    """A solar radio repeater: a three-legged lattice mast 9 m tall with zigzag bracing, a whip antenna and
    a stub antenna at the top, the solar panel on its frame tilted south (+z), the battery box, snow."""
    p = []
    legs = [(math.cos(a) * 0.35, math.sin(a) * 0.35) for a in (math.tau * i / 3 + 0.3 for i in range(3))]
    for x, z in legs:
        p += [C("steel", 0.05, 0.05, 9, 5, (x, 4.5, z)), B("concrete", 0.3, 0.25, 0.3, (x, 0.05, z))]
    for k in range(8):
        y0, y1 = 0.4 + k * 1.05, 0.4 + (k + 1) * 1.05
        for i in range(3):
            a, b = legs[i], legs[(i + 1) % 3]
            p.append(beam("steel", (a[0], y0, a[1]), (b[0], y1, b[1]), 0.035))
            p.append(beam("steel", (a[0], y1, a[1]), (b[0], y1, b[1]), 0.035))
    p += [C("whip", 0.04, 0.04, 2.2, 5, (0.2, 10.0, 0)), C("antenna", 0.12, 0.12, 0.9, 8, (-0.35, 8.4, 0.1)),
          B("steelDark", 0.5, 0.05, 0.05, (-0.1, 8.4, 0.1)), B("snow", 0.6, 0.06, 0.6, (0, 9.0, 0))]
    # the solar panel frame and the panel, cells and all
    p += [beam("steelDark", (-0.6, 0, 0.6), (-0.6, 3.0, 0.75), 0.06), beam("steelDark", (0.6, 0, 0.6), (0.6, 3.0, 0.75), 0.06),
          B("panel", 1.6, 0.06, 1.0, (0, 3.2, 0.9), (-0.9, 0, 0))]
    for i in range(4):
        for j in range(2):
            u, v = -0.6 + i * 0.4, -0.22 + j * 0.44
            c = Vector((u, 0.035, v))
            c.rotate(Matrix.Rotation(-0.9, 3, "X"))
            p.append(B("panelCell", 0.36, 0.01, 0.4, tuple(Vector((0, 3.2, 0.9)) + c), (-0.9, 0, 0)))
    p += [B("battery", 0.8, 1.0, 0.6, (0.9, 0.5, 0), bevel=0.02), B("snow", 0.9, 0.12, 0.7, (0.9, 1.05, 0)),
          B("dark", 0.05, 0.3, 0.05, (0.9, 0.75, 0.32)), mound("groundSnow", 2.6, 0.35, 2.0, (0.3, -0.05, -0.4))]
    return [finish(p, "repeater")]


# ------------------------------------------------------------------ the warning sign
def warning_sign():
    """The sign's steel: two posts, a galvanised backing plate (the game puts its printed face 0.06 m in
    front of it, at the height the code did), bolts, and snow on top."""
    p = [C("steel", 0.05, 0.05, 2.6, 6, (-0.5, 1.3, 0)), C("steel", 0.05, 0.05, 2.6, 6, (0.5, 1.3, 0)),
         B("plate", 1.56, 1.56, 0.04, (0, 2.2, 0.02)), B("steelDark", 1.2, 0.06, 0.06, (0, 2.75, -0.03)),
         B("steelDark", 1.2, 0.06, 0.06, (0, 1.65, -0.03)), B("snow", 1.0, 0.1, 0.3, (0, 3.02, 0.02)),
         mound("groundSnow", 1.6, 0.3, 0.8, (0, -0.05, 0))]
    for x in (-0.5, 0.5):
        for y in (1.65, 2.75):
            p.append(C("steelDark", 0.03, 0.03, 0.06, 6, (x, y, 0.045), (math.pi / 2, 0, 0)))
    return [finish(p, "sign")]


# ------------------------------------------------------------------ the old snowcat
def snowcat():
    """A grooming snowcat, decades old, retired where it died: two track assemblies (road wheels, the drive
    sprocket, cleats), the hull with rust through the red paint, the cab with its pillars and windows, a
    light bar, an exhaust stack, the front blade on its push arms (-z), the tiller at the back, and a snow
    bank up the uphill side (+x) with snow on the roof and hood. Upright and on the ground: the game
    sinks and lists it as before."""
    p = []
    for x in (-1.15, 1.15):
        p += [B("dark", 0.8, 0.75, 4.6, (x, 0.42, 0), bevel=0.12), B("track", 0.82, 0.08, 4.4, (x, 0.85, 0))]
        for k in range(14):
            p.append(B("track", 0.84, 0.06, 0.12, (x, 0.04, -2.0 + k * 0.31)))
        for z in (-1.4, -0.45, 0.5, 1.45):
            p.append(C("steelDark", 0.3, 0.3, 0.84, 10, (x, 0.38, z), (0, 0, math.pi / 2)))
        p.append(C("steelDark", 0.36, 0.36, 0.86, 10, (x, 0.5, 2.05), (0, 0, math.pi / 2)))
        p.append(C("steelDark", 0.32, 0.32, 0.86, 10, (x, 0.48, -2.1), (0, 0, math.pi / 2)))
    p += [B("catRed", 2.4, 1.0, 4.0, (0, 1.3, 0.1), bevel=0.05), B("rust", 2.42, 0.25, 3.0, (0, 0.9, 0.1)),
          B("rust", 0.6, 0.35, 0.02, (0.6, 1.5, -1.91)), B("catRed", 2.2, 0.35, 1.6, (0, 1.95, -1.05), bevel=0.04)]
    # the cab: roof, pillars, glass all round
    p += [B("catRed", 2.1, 0.12, 2.0, (0, 3.08, 0.7)), B("catRed", 2.0, 0.35, 1.9, (0, 1.95, 0.7))]
    for x in (-0.98, 0.98):
        for z in (-0.2, 1.6):
            p.append(B("catRed", 0.1, 1.0, 0.1, (x, 2.55, z)))
    p += [B("glass", 1.86, 0.8, 0.04, (0, 2.6, -0.2)), B("glass", 1.86, 0.8, 0.04, (0, 2.6, 1.6)),
          B("glass", 0.04, 0.8, 1.7, (-0.98, 2.6, 0.7)), B("glass", 0.04, 0.8, 1.7, (0.98, 2.6, 0.7)),
          B("steelDark", 1.4, 0.12, 0.18, (0, 3.22, -0.1))]
    for x in (-0.5, -0.17, 0.17, 0.5):
        p.append(B("lamp", 0.2, 0.14, 0.05, (x, 3.22, -0.2)))
    p += [C("pipe", 0.07, 0.07, 1.2, 8, (0.85, 2.5, -1.5)), C("rust", 0.09, 0.09, 0.1, 8, (0.85, 3.12, -1.5))]
    # the blade on its push arms, angled back at the top
    p += [B("blade", 3.6, 1.1, 0.2, (0, 0.75, -2.75), (0.25, 0, 0), bevel=0.03), B("steelDark", 3.6, 0.12, 0.2, (0, 0.24, -2.85))]
    for x in (-0.9, 0.9):
        p.append(beam("steelDark", (x, 0.7, -2.6), (x, 0.9, -1.6), 0.14))
    # the tiller behind
    p += [B("steelDark", 2.2, 0.3, 0.8, (0, 0.6, 2.6)), C("steelDark", 0.18, 0.18, 2.3, 8, (0, 0.55, 2.6), (0, 0, math.pi / 2)),
          B("blade", 2.4, 0.06, 0.9, (0, 0.28, 2.85))]
    # snow: banked up the uphill side, on the roof, the hood, the track tops
    p += [mound("snow", 4.6, 1.9, 6.0, (1.3, -0.05, 0.3)), B("snow", 2.0, 0.22, 1.9, (0, 3.24, 0.7), bevel=0.06),
          B("snow", 2.3, 0.18, 1.7, (0, 2.2, -1.0), bevel=0.05), B("snow", 0.7, 0.1, 3.4, (-1.15, 0.93, 0.2))]
    return [finish(p, "snowcat")]


# ------------------------------------------------------------------ the mine headframe
def headframe():
    """A timber mine headframe: two plumb posts and two raking back legs (+z), cross-braced with an X, a
    sheave wheel with spokes on its deck at the top, a ladder, the shaft collar drifted over, an ore bucket
    hanging in the shaft, and a tailings heap stained by the ore with snow lying on it."""
    p = []
    for x in (-1.3, 1.3):
        p += [B("timber", 0.3, 9, 0.3, (x, 4.5, 0), bevel=0.02), beam("timberOld", (x, 0, 4.4), (x, 8.7, 0.15), 0.28)]
        p.append(beam("timberOld", (x, 4.5, 0), (x, 3.0, 2.85), 0.18))
    for y in (2.5, 5.0, 7.5):
        p.append(B("timberOld", 2.9, 0.22, 0.22, (0, y, 0)))
    for y0, y1 in ((2.5, 5.0), (5.0, 7.5)):
        p += [beam("timberOld", (-1.2, y0, 0.05), (1.2, y1, 0.05), 0.16), beam("timberOld", (1.2, y0, -0.05), (-1.2, y1, -0.05), 0.16)]
    # the ladder up the front of one post
    p += [B("timberDark", 0.06, 8.6, 0.06, (-0.9, 4.3, -0.25)), B("timberDark", 0.06, 8.6, 0.06, (-0.5, 4.3, -0.25))]
    for k in range(20):
        p.append(B("timberDark", 0.42, 0.05, 0.05, (-0.7, 0.4 + k * 0.42, -0.25)))
    # deck, sheave wheel, its spokes and axle, the cable down the shaft
    p += [B("timber", 3.2, 0.3, 1.2, (0, 9.0, 0.2)), B("snow", 3.1, 0.12, 1.1, (0, 9.2, 0.2)),
          place(K.torus("wheel", 0.9, 0.09, (0, 0, 0), axis="Z", major=18, minor=6), (0, 10.25, 0.2), (0, 0, 0), "pipe"),
          C("pipe", 0.08, 0.08, 0.5, 8, (0, 10.25, 0.2), (math.pi / 2, 0, 0)), B("timberDark", 0.2, 1.1, 0.2, (-0.55, 9.7, 0.2)),
          B("timberDark", 0.2, 1.1, 0.2, (0.55, 9.7, 0.2))]
    for k in range(6):
        a = math.tau * k / 6
        p.append(beam("pipe", (0, 10.25, 0.2), (math.cos(a) * 0.85, 10.25 + math.sin(a) * 0.85, 0.2), 0.05))
    p += [beam("rope", (0, 9.35, 0.2), (0, 3.0, 0.2), 0.03), beam("rope", (0.9, 10.25, 0.2), (1.3, 0.0, 4.2), 0.03),
          C("rust", 0.35, 0.3, 0.6, 8, (0, 2.7, 0.2)), C("rust", 0.37, 0.37, 0.05, 8, (0, 3.0, 0.2))]
    # the collar of the shaft and the tailings heap, with snow on them
    p += [B("timberOld", 3.4, 0.6, 3.0, (0, 0.1, 0)), B("dark", 2.2, 0.62, 1.8, (0, 0.11, 0.2)),
          B("snow", 0.6, 0.1, 3.0, (-1.4, 0.45, 0)), B("snow", 0.6, 0.1, 3.0, (1.4, 0.45, 0)),
          mound("tailings", 7, 1.6, 5, (3.5, -0.3, 2.5), seg=12), mound("groundSnow", 5.2, 1.5, 3.6, (3.2, -0.08, 2.3), seg=12)]
    return [finish(p, "headframe")]


# ------------------------------------------------------------------ the collapsed cabin
def mine_cabin():
    """What is left of the miners' cabin, 5 x 3.9 m: the lower courses of three log walls, ragged where the
    logs have gone, the east gable end still standing (+x), the roof fallen in (its planks at a slant, one
    end on the ground), a broken door, a stovepipe that outlasted the roof, loose planks, snow on it all."""
    p = []
    r = 0.15
    for i in range(3):
        y = 0.2 + i * 0.32
        for z in (-1.8, 1.8):
            L = 5.0 - (0.9 if (i == 2 and z > 0) else 0) - (0.5 if (i == 1 and z < 0) else 0)
            p.append(C("timberOld" if i % 2 else "timber", r, r, L, 7, (-(5.0 - L) / 2 if z > 0 else (5.0 - L) / 2, y, z), (0, 0, math.pi / 2)))
        if i < 2:
            p.append(C("timberOld" if i % 2 else "timber", r, r, 3.9, 7, (-2.4, y + 0.16, 0), (math.pi / 2, 0, 0)))
    # the standing gable end: logs up to the eaves, a triangle of boards above
    for i in range(7):
        p.append(C("timber" if i % 2 else "timberOld", r, r, 3.9, 7, (2.4, 0.2 + i * 0.3, 0), (math.pi / 2, 0, 0)))
    for k in range(-3, 4):
        h = 1.3 * (1 - abs(k) / 4.0)
        if h > 0.1:
            p.append(B("timberDark", 0.08, h, 0.5, (2.42, 2.2 + h / 2, k * 0.5)))
    # the roof, fallen in, in two broken halves
    p += [B("timberDark", 3.0, 0.12, 3.8, (-1.0, 0.8, 0), (0, 0, 0.32)), B("timberDark", 1.8, 0.12, 3.6, (1.4, 1.4, 0.1), (0, 0, -0.45)),
          B("snow", 2.8, 0.25, 3.6, (-1.0, 0.98, 0), (0, 0, 0.32), bevel=0.06), B("snow", 1.6, 0.2, 3.4, (1.4, 1.56, 0.1), (0, 0, -0.45), bevel=0.05)]
    for k in range(5):
        p.append(B("timberDark", 0.04, 0.13, 3.0, (-2.0 + k * 0.6, 0.86 + k * 0.19, 0), (0, 0, 0.32)))
    # door hanging by one hinge, the stovepipe, loose planks in the snow
    p += [B("timberDark", 0.8, 1.6, 0.06, (0.6, 0.75, 1.95), (0, 0.5, 0.18)),
          C("pipe", 0.12, 0.12, 2.2, 8, (1.6, 1.4, 1.0)), C("pipe", 0.16, 0.16, 0.12, 8, (1.6, 2.5, 1.0)),
          B("timberDark", 2.2, 0.06, 0.25, (-1.5, 0.08, 2.6), (0, 0.4, 0)), B("timberDark", 1.8, 0.06, 0.25, (-0.6, 0.1, -2.5), (0, -0.3, 0.05)),
          mound("groundSnow", 3.4, 0.5, 2.0, (-2.6, -0.05, 0.6)), mound("groundSnow", 5.4, 0.35, 1.6, (0, -0.05, -2.3))]
    return [finish(p, "minecabin")]


# ------------------------------------------------------------------ the Grauhorn weather station
def weather_mast():
    """The Grauhorn automatic weather station (Morning Rounds: de-ice and restart it): a 7 m galvanised
    mast with flanged joints, three guy wires to anchors in the snow, a lightning rod, the wind vane on its
    crossarm (6.2 m), a radiation shield for the thermometer, the solar panel on its bracket (4.4 m) and
    the logger box with its conduit (2.2 m; the game puts its status light on the door). Two nodes:
    `mast` (still) and `anemometer` (its hub at 7.2 m is the node's origin; the game spins it once the
    station is repaired). The ice on the cups stays code."""
    p = [C("steel", 0.12, 0.14, 7, 6, (0, 3.5, 0)), B("concrete", 0.7, 0.3, 0.7, (0, 0.05, 0)), C("steelDark", 0.02, 0.02, 0.9, 4, (0, 7.85, 0))]
    for y in (2.4, 4.8):
        p.append(C("steelDark", 0.18, 0.18, 0.08, 6, (0, y, 0)))
    for a in (0.0, 2.1, 4.2):
        ax, az = math.cos(a) * 3.2, math.sin(a) * 3.2
        p += [beam("dark", (0, 6.6, 0), (ax, 0.05, az), 0.02), B("concrete", 0.3, 0.2, 0.3, (ax, 0.0, az)), B("snow", 0.4, 0.08, 0.4, (ax, 0.13, az))]
    for k in range(14):
        p.append(B("steelDark", 0.24, 0.03, 0.03, (0, 0.5 + k * 0.42, -0.15)))
    # crossarm with the vane (tail fin and counterweight) and the radiation shield
    p += [B("steelDark", 1.3, 0.06, 0.06, (0.3, 6.2, 0)), C("steelDark", 0.03, 0.03, 0.3, 6, (0.9, 6.35, 0)),
          B("dark", 1.2, 0.05, 0.05, (0.9, 6.5, 0)), B("catRed", 0.05, 0.3, 0.35, (0.3, 6.5, 0)), place(K.sphere("w", 0.07, (0, 0, 0), None, segs=6, rings=4), (1.5, 6.5, 0), (0, 0, 0), "dark")]
    for k in range(5):
        p.append(C("antenna", 0.16 - k * 0.01, 0.16 - k * 0.01, 0.04, 8, (-0.45, 5.0 + k * 0.07, 0)))
    p += [B("steelDark", 0.5, 0.04, 0.04, (-0.2, 5.0, 0))]
    # solar panel on its bracket, tilted south (+z), and the logger box
    p += [B("steelDark", 0.06, 0.06, 0.7, (-0.2, 4.4, -0.25)), B("panel", 1.4, 0.06, 0.9, (-0.2, 4.45, 0.1), (-0.5, 0, 0))]
    for i in range(3):
        for j in range(2):
            c = Vector((-0.45 + i * 0.45, 0.035, -0.2 + j * 0.4))
            c.rotate(Matrix.Rotation(-0.5, 3, "X"))
            p.append(B("panelCell", 0.4, 0.01, 0.36, tuple(Vector((-0.2, 4.45, 0.1)) + c), (-0.5, 0, 0)))
    p += [B("antenna", 0.8, 1.0, 0.4, (0.2, 2.2, 0.15), bevel=0.02), B("steelDark", 0.04, 0.9, 0.02, (-0.17, 2.2, 0.36)),
          B("snow", 0.9, 0.1, 0.5, (0.2, 2.76, 0.15)), C("dark", 0.025, 0.025, 2.4, 4, (0.45, 3.5, 0.05)),
          mound("snow", 2.0, 0.35, 2.0, (0, -0.05, 0))]
    mast = finish(p, "mast")
    # the anemometer: hub, three arms, conical cups open to the wind
    an = [C("steelDark", 0.07, 0.07, 0.16, 8, (0, 7.2, 0)), C("dark", 0.03, 0.03, 0.25, 6, (0, 7.05, 0))]
    for i in range(3):
        a = math.tau * i / 3
        ex, ez = math.cos(a) * 0.9, -math.sin(a) * 0.9
        an.append(beam("dark", (0, 7.2, 0), (ex, 7.2, ez), 0.04))
        # each cup faces along the turn (tangent), so the three of them catch the wind one way
        cup = C("antenna", 0.13, 0.02, 0.22, 10, (ex, 7.2, ez))
        tx, tz = -math.sin(a), -math.cos(a)
        cup.rotation_mode = "QUATERNION"; cup.rotation_quaternion = Vector((0, 1, 0)).rotation_difference(Vector((tx, 0, tz)))
        an.append(cup)
    anemo = finish(an, "anemometer", (0, 7.2, 0))
    return [mast, anemo]


BUILD = {
    "rs_weather_mast": weather_mast,
    "rs_snow_fence": snow_fence,
    "rs_exploder": exploder,
    "rs_repeater": repeater,
    "rs_warning_sign": warning_sign,
    "rs_snowcat": snowcat,
    "rs_headframe": headframe,
    "rs_mine_cabin": mine_cabin,
}
objs = BUILD[asset]()
bpy.ops.wm.save_as_mainfile(filepath=A["out"])
tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs}
print(f"{asset}: {sum(tris.values())} tris {tris}")
