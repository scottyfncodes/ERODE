"""ROCKSLIDE: the patrol's vehicles and the Kessel spruce (MeshCraft run_script).

Run inside MeshCraft's Blender (globals: bpy, kit, args, Palette):
  run_script {"path": ".../patrol_models.py", "args": {"asset": "rs_sled", "palette": ".../rockslide-palette.json", "out": ".../rs_sled.blend"}}

These replace code-built meshes, so each one is modelled in the game's own coordinates (three.js:
metres, +Y up, the vehicles' nose toward -Z) with the numbers copied from the code it replaces
(src/render/sledMesh.ts, heliMesh.ts, conifer.ts), then turned into Blender's Z-up at the end. The
glTF exporter turns it back, so every part lands exactly where the code put it.

Moving parts are their own nodes with their origin on the pivot the game turns them about:
  rs_sled:  sled_body, sled_ski_L, sled_ski_R          (skis steer about Y)
  rs_heli:  heli_body, heli_rotor, heli_tail_rotor      (rotor spins about Y, tail rotor about X)
  rs_spruce_a/b: spruce_crown, spruce_trunk             (1 unit tall, instanced and scaled per tree)
Materials are palette roles; the game maps each role back onto its own materials (so paint jobs and
the storybook grade still apply) and the COLOR_0 bake keeps the file correct on its own.
Lights, glows, the rotor disc and the delivery crate stay in code: they are effects, not shape.
"""
import math, random
import bpy, bmesh
from mathutils import Matrix, Vector

A = args  # noqa: F821  (injected by MeshCraft)
pal = Palette.from_file(A["palette"])  # noqa: F821
asset = A["asset"]
K = kit  # noqa: F821
K.reset()
TO_BLENDER = Matrix.Rotation(math.pi / 2, 4, "X")  # three.js (x, y, z) -> Blender (x, -z, y)


# ------------------------------------------------------------------ helpers, in three.js space
def place(o, pos=(0, 0, 0), rot=(0, 0, 0)):
    o.location = pos; o.rotation_euler = rot
    return o


def B(n, w, h, d, m, pos=(0, 0, 0), rot=(0, 0, 0), bevel=0.0):
    """A box like the game's box(w, h, d): w across (x), h up (y), d along (z)."""
    return place(K.box(n, (w, h, d), (0, 0, 0), m, bevel=bevel), pos, rot)


def C(n, rt, rb, h, seg, m, pos=(0, 0, 0), rot=(0, 0, 0), bevel=0.0):
    """A cylinder like three's CylinderGeometry(rt, rb, h, seg): along y, rt at the top."""
    return place(K.cylinder(n, rt, h, (0, 0, 0), axis="Y", verts=seg, mat=m, r2=rb, bevel=bevel), pos, rot)


def S(n, r, m, pos=(0, 0, 0), scale=(1, 1, 1), segs=12, rings=8, fn=None):
    """A UV sphere with its poles on y (like three's SphereGeometry), scaled per axis."""
    o = K.sphere(n, r, (0, 0, 0), m, segs=segs, rings=rings)
    def f(v):
        v = Vector((v.x * scale[0], v.z * scale[1], -v.y * scale[2]))
        return fn(v) if fn else v
    K.deform(o, f)
    return place(o, pos)


def P(n, outline, depth, m, pos=(0, 0, 0), rot=(0, 0, 0), bevel=0.0):
    """An outline [(x, y), ...] in the xy plane, extruded along z."""
    return place(K.prism(n, outline, depth, (0, 0, 0), axis="Z", mat=m, bevel=bevel), pos, rot)


def finish(parts, name, pivot=(0, 0, 0)):
    """Join, bake every transform into the mesh, put the origin on the pivot (three.js space), then
    turn the whole thing into Blender's Z-up so the glTF exporter turns it back exactly."""
    o = K.join(parts, name)
    o.data.transform(o.matrix_world); o.matrix_world = Matrix()
    pv = Vector(pivot)
    o.data.transform(Matrix.Translation(-pv))
    o.data.transform(TO_BLENDER)
    o.location = TO_BLENDER @ pv
    o["gitcraft_asset"] = asset
    return o


def tris(objs):
    return sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)


# ------------------------------------------------------------------ the patrol snowmobile
def sled():
    mats = K.Materials(pal, {"main": "Patrol Red", "second": "Cross White", "dark": "Slate Ink", "metal": "Steel",
                             "stripe": "Caution Amber", "glass": "Nav Cyan", "grip": "Aubergine", "lug": "Steel Dark",
                             "cross": "Cross White"}, prefix="RS")
    m = mats.__getitem__
    body = []
    # cowl: a stretched, squashed ball, flattened underneath where it sits on the belly pan, and
    # drawn to a blunt prow at the front
    def cowl_shape(v):
        if v.y < -0.12: v.y = -0.12 + (v.y + 0.12) * 0.35
        if v.z < 0: v.x *= 1 + v.z * 0.12
        return v
    body.append(S("cowl", 0.75, m("main"), (0, 0.62, -0.9), (0.95, 0.62, 1.35), segs=12, rings=7, fn=cowl_shape))
    body.append(B("pan", 1.15, 0.28, 2.1, m("second"), (0, 0.32, -0.55), bevel=0.06))
    body.append(B("hood", 1.0, 0.18, 0.9, m("main"), (0, 0.78, -0.2), (-0.18, 0, 0), bevel=0.05))
    body.append(B("stripe", 1.18, 0.1, 2.12, m("stripe"), (0, 0.5, -0.55), bevel=0.02))
    # the screen: a cut trapezoid instead of a slab
    screen = [(-0.46, -0.27), (0.46, -0.27), (0.42, 0.12), (0.3, 0.27), (-0.3, 0.27), (-0.42, 0.12)]
    body.append(P("screen", screen, 0.05, m("glass"), (0, 1.15, -0.62), (-0.45, 0, 0)))
    # bars, stem, grips
    body.append(C("bar", 0.04, 0.04, 1.0, 6, m("dark"), (0, 1.05, -0.32), (0, 0, math.pi / 2)))
    body.append(C("stem", 0.05, 0.05, 0.35, 6, m("dark"), (0, 0.92, -0.38)))
    for x in (-0.5, 0.5):
        body.append(C(f"grip{x}", 0.055, 0.055, 0.16, 6, m("grip"), (x, 1.05, -0.32), (0, 0, math.pi / 2)))
    # seat, with a stitched seam, and its back
    body.append(B("seat", 0.62, 0.22, 1.25, m("dark"), (0, 0.85, 0.45), bevel=0.06))
    body.append(B("seam", 0.64, 0.03, 1.2, m("lug"), (0, 0.9, 0.45)))
    body.append(B("seatBack", 0.62, 0.32, 0.15, m("dark"), (0, 1.0, 1.05), bevel=0.05))
    # tunnel and its painted side rails; running boards for the rider's boots
    body.append(B("tunnel", 0.95, 0.34, 2.2, m("second"), (0, 0.6, 0.75), bevel=0.03))
    body.append(B("tunnelSide", 0.98, 0.1, 2.2, m("main"), (0, 0.75, 0.75), bevel=0.02))
    for s in (-1, 1):
        body.append(B(f"board{s}", 0.22, 0.04, 1.1, m("dark"), (s * 0.56, 0.47, 0.4)))
        # the patrol cross on each flank of the cowl
        body.append(B(f"crossv{s}", 0.03, 0.26, 0.09, m("cross"), (s * 0.69, 0.66, -0.95)))
        body.append(B(f"crossh{s}", 0.03, 0.09, 0.26, m("cross"), (s * 0.69, 0.66, -0.95)))
    # track, lugs and the bogie wheels at each end
    body.append(B("track", 0.72, 0.42, 2.4, m("dark"), (0, 0.26, 0.8), bevel=0.08))
    # (the code version ran its lugs 0.8 m past the end of the track; these stay on it)
    for i in range(9):
        body.append(B(f"lug{i}", 0.74, 0.06, 0.08, m("lug"), (0, 0.05, -0.25 + i * 0.27)))
    for z in (-0.2, 1.8):
        body.append(C(f"wheel{z}", 0.21, 0.21, 0.76, 10, m("metal"), (0, 0.26, z), (0, 0, math.pi / 2)))
    # the rack where Koda rides
    body.append(B("rackPlate", 0.85, 0.05, 0.9, m("metal"), (0, 0.82, 1.5)))
    for x in (-0.42, 0.42):
        body.append(B(f"rail{x}", 0.05, 0.25, 0.9, m("metal"), (x, 0.94, 1.5)))
    body.append(B("rackBack", 0.85, 0.25, 0.05, m("metal"), (0, 0.94, 1.95)))
    # ski arms and spindles (fixed); the skis themselves steer
    skis = []
    for s in (-1, 1):
        body.append(B(f"arm{s}", 0.08, 0.08, 0.6, m("metal"), (s * 0.45, 0.35, -0.85), (0, 0, s * 0.4)))
        body.append(C(f"spindle{s}", 0.05, 0.05, 0.4, 6, m("metal"), (s * 0.55, 0.22, -1.0)))
        px, py, pz = s * 0.55, 0.04, -1.0
        sk = [B("plank", 0.18, 0.06, 1.5, m("dark"), (px, py, pz), bevel=0.02),
              B("tip", 0.18, 0.06, 0.4, m("dark"), (px, py + 0.1, pz - 0.88), (0.55, 0, 0), bevel=0.02),
              B("keel", 0.04, 0.03, 1.3, m("metal"), (px, py - 0.04, pz + 0.05)),
              B("saddle", 0.12, 0.08, 0.22, m("metal"), (px, py + 0.07, pz))]
        skis.append(finish(sk, f"sled_ski_{'L' if s < 0 else 'R'}", (px, py, pz)))
    objs = [finish(body, "sled_body")] + skis
    return objs, mats


# ------------------------------------------------------------------ the patrol helicopter
def heli():
    mats = K.Materials(pal, {"main": "Patrol Red", "second": "Cross White", "dark": "Slate Ink", "metal": "Steel",
                             "yellow": "Caution Amber", "glass": "Nav Cyan"}, prefix="RS")
    m = mats.__getitem__
    body = []
    body.append(S("cabin", 1.7, m("main"), (0, 0.3, -0.4), (1, 0.95, 1.55), segs=16, rings=10))
    body.append(S("belly", 1.62, m("second"), (0, -0.35, -0.35), (1.02, 0.6, 1.5), segs=16, rings=8))
    body.append(S("nose", 1.25, m("glass"), (0, 0.55, -1.95), (1.05, 0.9, 1.05), segs=14, rings=8))
    body.append(C("stripe", 1.72, 1.72, 0.45, 16, m("yellow"), (0, 0.3, 0.9), (math.pi / 2, 0, 0)))
    bpy.data.objects["stripe"].scale = (1, 1, 0.95)  # squashed with the cabin (y in three = z here before the turn)
    for s in (-1, 1):
        # a sliding door each side with the patrol cross, and a cabin window behind it
        body.append(B(f"door{s}", 0.06, 1.3, 1.5, m("second"), (s * 1.66, 0.35, 0.1), bevel=0.02))
        body.append(B(f"crossV{s}", 0.08, 0.7, 0.22, m("main"), (s * 1.69, 0.35, 0.1)))
        body.append(B(f"crossH{s}", 0.08, 0.22, 0.7, m("main"), (s * 1.69, 0.35, 0.1)))
        body.append(B(f"window{s}", 0.06, 0.55, 0.7, m("glass"), (s * 1.58, 0.75, -1.15), (0, s * 0.18, 0)))
    body.append(C("boom", 0.22, 0.55, 5.6, 10, m("main"), (0, 0.75, 3.9), (math.pi / 2, 0, 0)))
    body.append(B("fin", 0.18, 1.9, 1.1, m("main"), (0, 1.55, 6.45), (-0.35, 0, 0), bevel=0.03))
    body.append(B("finTip", 0.2, 0.4, 0.9, m("second"), (0, 2.35, 6.75), (-0.35, 0, 0), bevel=0.03))
    body.append(B("stab", 2.0, 0.12, 0.6, m("second"), (0, 0.85, 5.6), bevel=0.03))
    for s in (-1, 1):
        body.append(B(f"endplate{s}", 0.06, 0.4, 0.5, m("main"), (s * 1.0, 0.85, 5.6)))
    body.append(C("mast", 0.28, 0.5, 0.9, 10, m("metal"), (0, 1.95, -0.2)))
    body.append(S("engine", 0.9, m("second"), (0, 1.55, 0.5), (0.9, 0.55, 1.6), segs=12, rings=6))
    for s in (-1, 1):
        body.append(C(f"exhaust{s}", 0.13, 0.16, 0.4, 8, m("dark"), (s * 0.55, 1.6, 1.55), (math.pi / 2, 0, 0)))
        body.append(B(f"intake{s}", 0.05, 0.25, 0.6, m("dark"), (s * 0.78, 1.6, 0.35)))
    # skids with little skis for the snow
    for s in (-1, 1):
        body.append(C(f"rail{s}", 0.12, 0.12, 4.6, 6, m("dark"), (s * 1.25, -1.45, -0.2), (math.pi / 2, 0, 0)))
        body.append(B(f"ski{s}", 0.42, 0.08, 2.2, m("main"), (s * 1.25, -1.56, -0.4), bevel=0.02))
        body.append(B(f"skiTip{s}", 0.42, 0.08, 0.5, m("main"), (s * 1.25, -1.45, -1.65), (0.5, 0, 0), bevel=0.02))
        for zz in (-1.3, 1.3):
            body.append(B(f"strut{s}{zz}", 0.1, 1.3, 0.1, m("dark"), (s * 1.0, -0.72, -0.2 + zz), (0, 0, -s * 0.3)))
    # hoist arm over the right-hand door, and the scanner turret under the nose
    body.append(B("hoistArm", 1.4, 0.2, 0.25, m("metal"), (2.15, 1.25, -0.2), bevel=0.02))
    body.append(B("hoist", 0.4, 0.4, 0.4, m("yellow"), (2.8, 1.15, -0.2), bevel=0.04))
    body.append(C("cable", 0.02, 0.02, 0.5, 4, m("dark"), (2.8, 0.7, -0.2)))
    body.append(S("turret", 0.34, m("dark"), (0, -0.75, -2.0), segs=10, rings=6))
    # main rotor: four blades through the hub (eight arms), with painted tips
    rotor = []
    rx, ry, rz = 0, 2.45, -0.2
    for i in range(4):
        a = i * math.pi / 4
        rotor.append(B(f"blade{i}", 12.4, 0.08, 0.42, m("dark"), (rx, ry, rz), (0, a, 0)))
        for s in (-1, 1):
            tip = B(f"tip{i}{s}", 0.5, 0.09, 0.43, m("yellow"), (rx + s * 5.95 * math.cos(a), ry, rz - s * 5.95 * math.sin(a)), (0, a, 0))
            rotor.append(tip)
    rotor.append(C("hub", 0.35, 0.45, 0.5, 10, m("metal"), (rx, ry, rz)))
    rotor.append(C("cap", 0.12, 0.3, 0.2, 8, m("metal"), (rx, ry + 0.33, rz)))
    # tail rotor: two blades in a cross, on a small hub
    tail = []
    tx, ty, tz = -0.25, 1.75, 6.55
    for i in range(2):
        tail.append(B(f"tblade{i}", 0.06, 1.9, 0.22, m("dark"), (tx, ty, tz), (i * math.pi / 2, 0, 0)))
    tail.append(C("thub", 0.12, 0.12, 0.2, 8, m("metal"), (tx, ty, tz), (0, 0, math.pi / 2)))
    objs = [finish(body, "heli_body"), finish(rotor, "heli_rotor", (rx, ry, rz)), finish(tail, "heli_tail_rotor", (tx, ty, tz))]
    return objs, mats


# ------------------------------------------------------------------ the Kessel spruce
# The game's own conifer colours (src/render/conifer.ts, linear rgb) and its snow, so the new trees
# sit in the same forest light. Spruce / Snow from the palette keep the materials honest on their own.
DARK, MID, TIP, SNOW = (0.09, 0.2, 0.2), (0.16, 0.32, 0.29), (0.3, 0.46, 0.38), (0.98, 0.965, 0.95)
SHADE = (0.83, 0.8, 0.92)  # the tree snow's lavender shade (the valley's Snow Shade), for the cap edges


def lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def spruce(seed, points, slender, caps=True):
    """Star-shaped tiers of boughs: each tier is a fan from a snowy crown point to a rim that
    alternates drooping bough tips and tucked-in notches (2 x points triangles a tier, fewer points on
    the small upper tiers). Snow lies on the upper, inner part of every tier, the way the game's snowy
    conifer paints it. ~10,000 of these stand in the valley, so a tree costs no more than the
    procedural one did.

    Snow caps: the three broad lower tiers carry a three-sided cap of the game's tree snow lying on
    their upper faces (the small upper tiers are painted white, notches and crown points), so the
    forest reads as snow-loaded from the helicopter. 63-65 triangles with a four-sided trunk: under the
    procedural tree's 76 and about what the uncapped spruce cost, since ~10,000 of them stand in the
    valley."""
    tiers = len(points)
    mats = K.Materials(pal, {"spruce": "Spruce", "bark": "Log Dark"}, prefix="RS")
    rng = random.Random(seed)
    bm = bmesh.new()
    cols = []  # per face: (apex, rim a, rim b) colours
    for t in range(tiers):
        f = t / (tiers - 1)
        r = (0.24 - f * 0.19) * (0.88 + rng.random() * 0.24) * slender
        h = 0.26 - f * 0.1
        y = 0.14 + f * 0.74
        phase = rng.random() * math.tau
        apex = bm.verts.new((0, y + h, 0))
        rim, rc = [], []
        n = points[t] * 2
        for i in range(n):
            a = phase + math.tau * i / n
            if i % 2 == 0:  # a bough tip: out and drooping
                rr = r * (0.95 + rng.random() * 0.1); yy = y - 0.05 * (1 - f * 0.4)
                c = lerp(lerp(DARK, MID, 0.25 + f * 0.3), SNOW, 0.12)  # a dusting on the tips
            else:           # a notch: in and up, holding snow
                rr = r * 0.6; yy = y + h * 0.18
                c = lerp(lerp(MID, TIP, f), SNOW, 0.8)
            rim.append(bm.verts.new((math.cos(a) * rr, yy, math.sin(a) * rr))); rc.append(c)
        ac = lerp(lerp(MID, TIP, 0.6), SNOW, 0.95)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((apex, rim[j], rim[i]))
            cols.append((ac, rc[j], rc[i]))
        if caps and t < tiers - 3:
            # the cap: a low three-sided pyramid of snow just proud of the tier's upper face,
            # reaching most of the way to the notches where snow collects
            top = y + h
            capex = bm.verts.new((0, top + 0.012, 0))
            cr = []
            for k in range(3):
                a = phase + math.tau * (2 * k * points[t] // 3 + 1) / n
                reach = 1.0
                # the tier's face at this reach (apex to notch), lifted a hair so it never z-fights
                yy = top + (y + h * 0.18 - top) * reach + 0.015
                rr = r * 0.6 * reach  # along the line from the crown point to the notch
                cr.append(bm.verts.new((math.cos(a) * rr, yy, math.sin(a) * rr)))
            for k in range(3):
                bm.faces.new((capex, cr[(k + 1) % 3], cr[k]))
                cols.append((SNOW, lerp(SNOW, SHADE, 0.2), lerp(SNOW, SHADE, 0.2)))
    # winding: outward and up, so the normals read like the game's
    me = bpy.data.meshes.new("spruce_crown"); bm.to_mesh(me); bm.free()
    crown = K.link(bpy.data.objects.new("spruce_crown", me)); K.assign(crown, mats["spruce"])
    attr = me.color_attributes.new("Color", "FLOAT_COLOR", "CORNER")
    for p, (ca, cb, cc) in zip(me.polygons, cols):
        for li, c in zip(p.loop_indices, (ca, cb, cc)):
            attr.data[li].color = (*c, 1.0)
    me.color_attributes.active_color = attr
    # the trunk: five sides, open ends (the crown hides the top, the snow the bottom)
    tb = bmesh.new()
    bmesh.ops.create_cone(tb, cap_ends=False, segments=4, radius1=0.03, radius2=0.014, depth=0.42)
    bmesh.ops.rotate(tb, cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 3, "X"), verts=tb.verts)  # z -> y
    bmesh.ops.translate(tb, vec=(0, 0.21, 0), verts=tb.verts)
    tm = bpy.data.meshes.new("spruce_trunk"); tb.to_mesh(tm); tb.free()
    trunk = K.link(bpy.data.objects.new("spruce_trunk", tm)); K.assign(trunk, mats["bark"])
    K.bake_vertex_colors(trunk, mats, jitter=0.0)
    out = []
    for o in (crown, trunk):
        o.data.transform(TO_BLENDER); o["gitcraft_asset"] = asset
        out.append(o)
    return out, None


BUILD = {
    "rs_sled": sled,
    "rs_heli": heli,
    "rs_spruce_a": lambda: spruce(11, (5, 5, 4, 4, 3, 3), 1.0),
    "rs_spruce_b": lambda: spruce(47, (5, 4, 4, 4, 3, 3), 0.92),
    # far-forest stand-ins (beyond ~200 m the game draws these crowns only, no trunk, no shadows):
    # four tiers, the same height, width and snow, in 28 triangles
    "rs_spruce_a_far": lambda: spruce(11, (4, 4, 3, 3), 1.0, caps=False),
    "rs_spruce_b_far": lambda: spruce(47, (4, 4, 3, 3), 0.92, caps=False),
}

objs, mats = BUILD[asset]()
for o in objs:
    if mats is not None:
        K.shade(o)  # flat: faceted like the rest of the valley
        K.bake_vertex_colors(o, mats, jitter=0.03, seed=len(o.name))
    else:
        K.shade(o)
bpy.ops.wm.save_as_mainfile(filepath=A["out"])
dims = [tuple(round(d, 2) for d in o.dimensions) for o in objs]
print(f"{asset}: {tris(objs)} tris, nodes {[o.name for o in objs]}, dims {dims}, saved {A['out']}")
