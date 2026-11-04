"""ROCKSLIDE: the patroller and Koda as rigged models (MeshCraft run_script).

Run inside MeshCraft's Blender (globals: bpy, kit, args, Palette):
  run_script {"path": ".../patrol_people.py", "args": {"asset": "rs_patroller", "palette": ".../rockslide-palette.json", "out": ".../rs_patroller.blend"}}

The game animates both characters in code (src/render/characterMesh.ts, huskyMesh.ts, gait.ts): a two-
bone leg solver, damped springs on every joint, jiggles on the soft things. These models give that code
a skeleton to drive instead of nested groups, so the movement does not change at all:

  * one bone per joint the code animates, with the code's own names, at the code's pivots, with zero
    rest rotation (every bone points straight up, roll 0, so its glTF node rotation is identity: the
    same frame as the code's THREE.Group, and the code's rotation/position/scale values mean the same);
  * every piece is rigidly bound (weight 1) to the joint that carries it in the code, modelled where the
    code puts it with all joints at rest;
  * things the game shows and hides (hats, skis, poles, the patrol gear; Koda's harness, bandana, eyes,
    tongue) are their own skinned meshes, so the code can keep toggling them.

Everything is modelled in three.js space (metres, +Y up, forward -Z) and turned into Blender's Z-up at the
end. Materials are palette roles; the game maps each role back onto its own materials (paint, hats,
gear colours and the storybook grade keep working), and COLOR_0 keeps the file right on its own.
"""
import math
import bpy, bmesh
from mathutils import Matrix, Vector

A = args  # noqa: F821
pal = Palette.from_file(A["palette"])  # noqa: F821
asset = A["asset"]
K = kit  # noqa: F821
K.reset()
TO_BLENDER = Matrix.Rotation(math.pi / 2, 4, "X")  # three.js (x, y, z) -> Blender (x, -z, y)
UP = 0.06  # bone length (only for display: bones are pivots)


def v3(a, b=(0, 0, 0)):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


class Rig:
    """Bones (absolute rest positions in three.js space) and the parts bound to them."""

    def __init__(self, mats):
        self.mats, self.bones, self.parts = mats, {}, {}

    def bone(self, name, parent, offset):
        base = self.bones[parent][0] if parent else (0, 0, 0)
        self.bones[name] = (v3(base, offset), parent)
        return name

    def at(self, bone, local):
        return v3(self.bones[bone][0], local)

    def add(self, obj, bone, o, role=None):
        """Bind object `o` (already in three.js space) rigidly to `bone`, in output mesh `obj`."""
        if role: K.assign(o, self.mats[role])
        o.vertex_groups.new(name=bone).add(list(range(len(o.data.vertices))), 1.0, "REPLACE")
        self.parts.setdefault(obj, []).append(o)
        return o


def place(o, pos, rot=(0, 0, 0), scale=(1, 1, 1)):
    o.rotation_mode = "ZYX"  # Blender ZYX == three.js 'XYZ'
    o.location = pos; o.rotation_euler = rot; o.scale = scale
    return o


def B(n, w, h, d, pos, rot=(0, 0, 0), scale=(1, 1, 1), bevel=0.0):
    return place(K.box(n, (w, h, d), (0, 0, 0), None, bevel=bevel), pos, rot, scale)


def C(n, rt, rb, h, seg, pos, rot=(0, 0, 0), scale=(1, 1, 1)):
    return place(K.cylinder(n, rt, h, (0, 0, 0), axis="Y", verts=seg, r2=rb), pos, rot, scale)


def G(n, r, pos, detail=1, scale=(1, 1, 1), rot=(0, 0, 0)):
    """three's IcosahedronGeometry(r, detail): a cut gem."""
    return place(K.ico(n, r, (0, 0, 0), None, sub=detail + 1), pos, rot, scale)


def P(n, outline, depth, pos, rot=(0, 0, 0)):
    """An outline [(x, y), ...] in the xy plane, extruded along z (depth)."""
    return place(K.prism(n, outline, depth, (0, 0, 0), axis="Z"), pos, rot)


def S(n, r, pos, seg=9, scale=(1, 1, 1), floor=None):
    """three's SphereGeometry(r, seg, round(seg * 0.7)), poles on y. `floor` (in the sphere's own
    units, before scaling) flattens everything below it: a dome with no underside."""
    o = K.sphere(n, r, (0, 0, 0), None, segs=seg, rings=max(4, round(seg * 0.7)))
    K.deform(o, lambda v: Vector((v.x, v.z if floor is None else max(v.z, floor), -v.y)))
    return place(o, pos, (0, 0, 0), scale)


def cone(n, r, h, seg, pos, rot=(0, 0, 0), scale=(1, 1, 1)):
    """three's ConeGeometry(r, h, seg): along y, point up, centred."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=0, depth=h)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 3, "X"), verts=bm.verts)
    me = bpy.data.meshes.new(n); bm.to_mesh(me); bm.free()
    return place(K.link(bpy.data.objects.new(n, me)), pos, rot, scale)


def limb(n, r0, r1, length, pos, sides=7):
    """A faceted, tapered capsule hanging down from its joint (the code's limb()): rounded at both
    ends, `sides` facets round."""
    rings = [(0.0, 0.5 * r0), (-0.45 * r0, r0), (-length + 0.45 * r1, r1), (-length, 0.5 * r1)]
    bm = bmesh.new(); loops = []
    for y, r in rings:
        loops.append([bm.verts.new((math.cos(a) * r, y, math.sin(a) * r)) for a in (math.tau * i / sides for i in range(sides))])
    for a, b in zip(loops, loops[1:]):
        for i in range(sides):
            j = (i + 1) % sides
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(loops[0]); bm.faces.new(loops[-1][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(n); bm.to_mesh(me); bm.free()
    return place(K.link(bpy.data.objects.new(n, me)), pos)


def ribbon(n, w0, w1, length, pos, y=0.0):
    """The scarf tails: a flat four-sided taper hanging from its pivot."""
    o = C(n, w0, w1, length, 4, (0, 0, 0))
    K.deform(o, lambda v: Vector((v.x, v.y - length / 2 + y, v.z)))
    o.rotation_mode = "ZYX"; o.rotation_euler = (0, math.pi / 4, 0)
    bpy.context.view_layer.update()
    o.data.transform(o.matrix_basis); o.matrix_basis = Matrix()
    K.deform(o, lambda v: Vector((v.x, v.y, v.z * 0.28)))
    return place(o, pos)


def build(rig, name):
    """Armature + one skinned mesh per output object, all turned into Blender space."""
    bones = []
    for bn, (head, parent) in rig.bones.items():
        h = TO_BLENDER @ Vector(head)
        bones.append((bn, tuple(h), tuple(h + Vector((0, 0, UP))), parent))
    arm = K.armature(f"{name}_rig", bones)
    out = []
    for obj, parts in rig.parts.items():
        o = K.join(parts, obj)
        o.data.transform(o.matrix_world); o.matrix_world = Matrix()
        o.data.transform(TO_BLENDER)
        # Shared vertices: the game shades these with its facet() materials (flatShading: the facets
        # come from screen-space derivatives, not vertex normals), so the file can share each vertex
        # between its faces instead of splitting it per face. Smooth normals and one colour per role
        # (no per-face jitter) let the exporter weld them: a third of the vertices to skin.
        K.shade(o, smooth_angle=180)
        K.bake_vertex_colors(o, rig.mats, jitter=0.0)
        K.skin_rigid(o, arm, {})
        o["gitcraft_asset"] = asset
        out.append(o)
    return arm, out


# ====================================================================== the patroller
THIGH, SHIN, ANKLE = 0.48, 0.46, 0.08  # src/render/gait.ts
LEG = THIGH + SHIN + ANKLE
H = 0.195  # hat radius


def patroller():
    mats = K.Materials(pal, {
        "jacket": "Patrol Red", "trim": "Cross White", "trousers": "#3B3550", "boot": "#6A2E2A", "sole": "#2A1D1A",
        "gaiter": "#2C2840", "glove": "#33303C", "strap": "#2B2F38", "dark": "Aubergine", "skin": "#F2C9A8",
        "hair": "#5A3A26", "scarf": "#5F9C86", "lens": "#F2A33A", "ski": "#C79A62", "hatMain": "Patrol Red",
        "hatSecond": "Cross White", "patchWhite": "Paper", "patchRed": "Patrol Red", "pack": "#56606C",
        "packDark": "#434B56", "nose": "#E3A283", "eye": "#1D1D1D", "cheek": "#EEA295", "smile": "Painted Timber Dark",
        "metal": "Steel",
    }, prefix="RS")
    r = Rig(mats)
    # ---- the skeleton: the code's joints, at its pivots (all rotations zero)
    r.bone("body", None, (0, 0, 0))
    r.bone("pelvis", "body", (0, LEG - 0.03, 0))
    for s, x in (("L", -0.11), ("R", 0.11)):
        r.bone(f"hip_{s}", "pelvis", (x, 0, 0))
        r.bone(f"knee_{s}", f"hip_{s}", (0, -THIGH, 0))
        r.bone(f"ankle_{s}", f"knee_{s}", (0, -SHIN, 0))
    r.bone("spine", "pelvis", (0, 0.12, 0))
    r.bone("chest", "spine", (0, 0.18, 0))
    r.bone("pack", "chest", (0, 0, 0))
    for s, x in (("L", -0.27), ("R", 0.27)):
        r.bone(f"shoulder_{s}", "chest", (x, 0.31, 0))
        r.bone(f"elbow_{s}", f"shoulder_{s}", (0, -0.29, 0))
    r.bone("neck", "chest", (0, 0.4, 0))
    r.bone("head", "neck", (0, 0.13, 0))
    # the eyes sit lower than the code-built figure's (out from under the hat band); they blink about
    # their own centres, so the bones move with them
    r.bone("eye_L", "head", (-0.062, 0.127, -0.17))
    r.bone("eye_R", "head", (0.062, 0.127, -0.17))
    r.bone("pom_beanie", "head", (0, 0.21 + H * 0.88, 0.01))
    r.bone("pom_bobble", "head", (0, 0.225 + H * 1.08, 0.01))
    tails = ((0, -0.03, 0.2), (1, 0.035, 0.17))
    for i, x, ln in tails:
        r.bone(f"scarf_a_{i}", "chest", (x, 0.46, 0.13))
        r.bone(f"scarf_b_{i}", f"scarf_a_{i}", (0, -ln, 0))
    J = r.at
    body = "pat_body"

    # ---- legs: thigh, shin, a cargo pocket, a chunky boot under a gaiter, a toe cap
    # (budget: the code-built figure draws ~2,560 triangles; this one stays about there)
    for s, sx in (("L", -1), ("R", 1)):
        hp, kn, an = f"hip_{s}", f"knee_{s}", f"ankle_{s}"
        r.add(body, hp, limb(f"thigh{s}", 0.11, 0.088, THIGH + 0.04, J(hp, (0, 0, 0))), "trousers")
        r.add(body, hp, G(f"pocket{s}", 0.06, J(hp, (sx * 0.095, -0.24, 0)), 0, (0.45, 1.2, 0.9)), "gaiter")
        r.add(body, kn, limb(f"shin{s}", 0.086, 0.072, SHIN, J(kn, (0, 0, 0))), "trousers")
        r.add(body, kn, C(f"gaiter{s}", 0.097, 0.094, 0.07, 7, J(kn, (0, -SHIN + 0.2, 0))), "gaiter")
        r.add(body, kn, C(f"boot{s}", 0.09, 0.08, 0.2, 7, J(kn, (0, -SHIN + 0.09, 0))), "boot")
        r.add(body, an, G(f"foot{s}", 0.088, J(an, (0, -ANKLE + 0.05, -0.075)), 0, (0.92, 0.62, 1.85)), "boot")
        r.add(body, an, G(f"toecap{s}", 0.06, J(an, (0, -ANKLE + 0.045, -0.2)), 0, (1.15, 0.7, 0.9)), "boot")
        r.add(body, an, G(f"tread{s}", 0.09, J(an, (0, -ANKLE + 0.022, -0.075)), 0, (0.96, 0.3, 1.9)), "sole")

    # ---- the patrol shell over insulated trousers
    r.add(body, "pelvis", C("seat", 0.2, 0.215, 0.2, 8, J("pelvis", (0, 0.02, 0)), scale=(1, 1, 0.78)), "trousers")
    r.add(body, "pelvis", C("hem", 0.225, 0.242, 0.17, 8, J("pelvis", (0, 0, 0)), scale=(1, 1, 0.8)), "jacket")
    r.add(body, "pelvis", C("hemBand", 0.245, 0.245, 0.035, 8, J("pelvis", (0, -0.08, 0)), scale=(1, 1, 0.8)), "trim")
    r.add(body, "spine", C("waist", 0.205, 0.225, 0.2, 8, J("spine", (0, 0.08, 0)), scale=(1, 1, 0.78)), "jacket")
    r.add(body, "chest", C("torso", 0.26, 0.205, 0.38, 8, J("chest", (0, 0.17, 0)), scale=(1, 1, 0.76)), "jacket")
    r.add(body, "chest", G("shoulders", 0.27, J("chest", (0, 0.33, 0)), 1, (1, 0.36, 0.78)), "trim")
    r.add(body, "chest", B("zip", 0.022, 0.4, 0.012, J("chest", (0, 0.16, -0.19)), (0.1, 0, 0)), "trim")
    r.add(body, "chest", C("collar", 0.13, 0.155, 0.1, 8, J("chest", (0, 0.41, 0))), "jacket")
    r.add(body, "chest", G("hood", 0.12, J("chest", (0, 0.43, 0.13)), 0, (1.3, 0.6, 0.8)), "jacket")
    # the scarf, wound twice, and its two tails on their own joints
    r.add(body, "chest", C("wrap", 0.135, 0.165, 0.075, 8, J("chest", (0, 0.425, 0.005))), "scarf")
    r.add(body, "chest", C("wrap2", 0.125, 0.145, 0.06, 8, J("chest", (0, 0.475, 0.01)), (0, 0, 0.12)), "scarf")
    for i, x, ln in tails:
        a, b = f"scarf_a_{i}", f"scarf_b_{i}"
        r.add(body, a, ribbon(f"tailA{i}", 0.04, 0.036, ln, J(a, (0, 0, 0))), "scarf")
        r.add(body, b, ribbon(f"tailB{i}", 0.036, 0.032, ln * 0.85, J(b, (0, 0, 0))), "scarf")
        r.add(body, b, ribbon(f"fringe{i}", 0.034, 0.042, 0.035, J(b, (0, 0, 0)), -ln * 0.85), "trim")

    # ---- arms: upper arm, forearm with a cuff, a big mitten with a thumb
    for s, sx in (("L", -1), ("R", 1)):
        sh, el = f"shoulder_{s}", f"elbow_{s}"
        r.add(body, sh, limb(f"upper{s}", 0.08, 0.066, 0.3, J(sh, (0, 0, 0))), "jacket")
        r.add(body, el, limb(f"fore{s}", 0.068, 0.058, 0.26, J(el, (0, 0, 0))), "jacket")
        r.add(body, el, C(f"cuff{s}", 0.07, 0.07, 0.05, 7, J(el, (0, -0.24, 0))), "trim")
        r.add(body, el, G(f"hand{s}", 0.074, J(el, (0, -0.31, -0.01)), 1, (0.88, 1.12, 1)), "glove")
        r.add(body, el, G(f"thumb{s}", 0.032, J(el, (-sx * 0.055, -0.29, -0.045)), 0), "glove")

    # ---- neck and head
    r.add(body, "neck", C("neckC", 0.065, 0.07, 0.12, 7, J("neck", (0, 0.05, 0))), "skin")
    hd = lambda p: J("head", p)  # noqa: E731
    r.add(body, "head", G("face", 0.185, hd((0, 0.13, 0)), 1, (0.95, 1.06, 1)), "skin")
    r.add(body, "head", G("hairCap", 0.19, hd((0, 0.165, 0.035)), 1), "hair")
    # A face that reads at phone size: eyes, brows, nose, blush and smile all below the hat band.
    # tufts of hair at the temples, under the band (the old fringe poked out through the hat)
    for sx in (-1, 1):
        r.add(body, "head", G(f"tuft{sx}", 0.045, hd((sx * 0.162, 0.135, -0.04)), 0, (0.55, 1.25, 0.9), (0, 0, sx * 0.25)), "hair")
    # eyes: dark ovals with a catchlight; each blinks (squashes) about its own centre
    for s_, sx in (("L", -1), ("R", 1)):
        e = f"eye_{s_}"
        r.add(body, e, G(f"eye{s_}", 0.024, J(e, (0, 0, 0.003)), 0, (0.82, 1.3, 0.45)), "eye")
        r.add(body, e, B(f"glint{s_}", 0.011, 0.011, 0.006, J(e, (0.007, 0.01, -0.0075)), (0, 0, 0.6)), "patchWhite")
        # brows: a soft arch just under the band, lifted at the inner end (friendly, a little keen)
        r.add(body, "head", B(f"brow{s_}", 0.046, 0.009, 0.01, hd((sx * 0.064, 0.16, -0.177)), (-0.25, sx * 0.15, sx * 0.14)), "hair")
    # a button nose
    r.add(body, "head", G("nose", 0.026, hd((0, 0.098, -0.19)), 0, (1, 0.85, 0.95)), "nose")
    # blush: flat discs lying on the cheeks
    for sx in (-1, 1):
        # on the face's own surface there (x 0.098, 4.5 cm below its centre), facing the way it does
        r.add(body, "head", C(f"blush{sx}", 0.026, 0.026, 0.005, 6, hd((sx * 0.096, 0.085, -0.146)), (math.pi / 2, 0, sx * 0.63), (1, 1, 0.75)), "cheek")
    # the smile: one crescent, tipped to follow the face down toward the chin
    arc = [(math.cos(a) * 0.036, math.sin(a) * 0.02) for a in (math.pi * (1.1 + 0.2 * i) for i in range(5))]
    inner = [(x * 0.86, y * 0.62 + 0.002) for x, y in arc[::-1]]  # a thin, upturned line: a smile, not lips
    r.add(body, "head", P("smile", arc + inner, 0.01, hd((0, 0.073, -0.177)), (-0.32, 0, 0)), "smile")
    # rounded ears
    for sx in (-1, 1):
        r.add(body, "head", S(f"ear{sx}", 0.045, hd((sx * 0.178, 0.122, 0.005)), 6, (0.42, 1, 0.78)), "skin")
    # goggles pushed up on the brow
    r.add(body, "head", C("gStrap", 0.19, 0.19, 0.04, 9, hd((0, 0.225, 0.01))), "dark")
    r.add(body, "head", B("gFrame", 0.25, 0.085, 0.05, hd((0, 0.232, -0.165)), bevel=0.01), "dark")
    r.add(body, "head", B("gLens", 0.225, 0.065, 0.06, hd((0, 0.232, -0.17))), "lens")

    # ---- hats (one shows at a time); pom-poms on their own joints. Each crown is a dome with no
    # underside (floor) that stops inside its band, so it never covers the face or shows through
    r.add("pat_hat_beanie", "head", S("dome", H, hd((0, 0.21, 0.01)), 9, (1, 0.92, 1), floor=-0.035 / 0.92), "hatMain")
    r.add("pat_hat_beanie", "head", C("band", H + 0.016, H + 0.02, 0.08, 9, hd((0, 0.205, 0.01))), "hatSecond")
    r.add("pat_hat_beanie", "pom_beanie", G("pom", 0.05, J("pom_beanie", (0, 0.05 * 0.75, 0)), 1), "hatSecond")
    r.add("pat_hat_helmet", "head", S("shell", H + 0.02, hd((0, 0.195, 0.01)), 10, (1, 0.95, 1.06), floor=-0.028 / 0.95), "hatMain")
    r.add("pat_hat_helmet", "head", B("ridge", 0.05, 0.04, 0.27, hd((0, 0.39, 0.01))), "hatSecond")
    r.add("pat_hat_helmet", "head", B("badge", 0.08, 0.08, 0.015, hd((0, 0.245, 0.215))), "hatSecond")
    r.add("pat_hat_trapper", "head", S("cap", H + 0.006, hd((0, 0.205, 0.01)), 9, (1, 0.9, 1), floor=-0.04 / 0.9), "hatMain")
    r.add("pat_hat_trapper", "head", C("brim", H + 0.024, H + 0.024, 0.08, 9, hd((0, 0.204, 0.01))), "hatSecond")
    for sx in (-1, 1):
        r.add("pat_hat_trapper", "head", G(f"earflap{sx}", 0.09, hd((sx * 0.185, 0.1, 0.01)), 0, (0.42, 1, 0.8)), "hatSecond")
    r.add("pat_hat_bobble", "head", S("bdome", H, hd((0, 0.225, 0.01)), 9, (1, 1.14, 1), floor=-0.065 / 1.14), "hatMain")
    r.add("pat_hat_bobble", "head", C("bband", H + 0.016, H + 0.02, 0.07, 9, hd((0, 0.195, 0.01))), "hatSecond")
    r.add("pat_hat_bobble", "pom_bobble", G("bpom", 0.085, J("pom_bobble", (0, 0.085 * 0.75, 0)), 1), "hatSecond")

    # ---- the patrol's gear (the villagers go without): straps, radio, the cross, the pack
    gear = "pat_gear"
    for sx in (-1, 1):
        r.add(gear, "chest", B(f"strap{sx}", 0.055, 0.3, 0.02, J("chest", (sx * 0.13, 0.2, -0.19)), (0.1, 0, 0)), "strap")
        r.add(gear, "chest", B(f"over{sx}", 0.055, 0.02, 0.36, J("chest", (sx * 0.13, 0.38, 0))), "strap")
    r.add(gear, "chest", B("radio", 0.06, 0.1, 0.04, J("chest", (0.13, 0.26, -0.215)), bevel=0.008), "strap")
    r.add(gear, "chest", C("aerial", 0.007, 0.007, 0.1, 4, J("chest", (0.145, 0.35, -0.215))), "strap")
    r.add(gear, "chest", B("patch", 0.085, 0.085, 0.012, J("chest", (-0.11, 0.24, -0.185)), (0.1, 0, 0)), "patchWhite")
    r.add(gear, "chest", B("pv", 0.022, 0.06, 0.014, J("chest", (-0.11, 0.24, -0.19)), (0.1, 0, 0)), "patchRed")
    r.add(gear, "chest", B("ph", 0.06, 0.022, 0.014, J("chest", (-0.11, 0.24, -0.19)), (0.1, 0, 0)), "patchRed")
    r.add(gear, "pack", G("packMain", 0.215, J("pack", (0, 0.15, 0.25)), 1, (0.86, 1.02, 0.42)), "pack")
    r.add(gear, "pack", G("packFlap", 0.2, J("pack", (0, 0.3, 0.255)), 1, (0.92, 0.38, 0.46)), "packDark")
    r.add(gear, "pack", C("crossBg", 0.115, 0.115, 0.012, 8, J("pack", (0, 0.13, 0.348)), (math.pi / 2, 0, 0)), "trim")
    r.add(gear, "pack", B("crossV", 0.055, 0.15, 0.014, J("pack", (0, 0.13, 0.356))), "jacket")
    r.add(gear, "pack", B("crossH", 0.15, 0.055, 0.014, J("pack", (0, 0.13, 0.356))), "jacket")
    for sx in (-1, 1):
        r.add(gear, "pack", G(f"side{sx}", 0.07, J("pack", (sx * 0.19, 0.06, 0.25)), 0, (0.6, 1.1, 1)), "packDark")
    # skis on the pack, A-framed (shown when they are not on the feet)
    for sx in (-1, 1):
        r.add("pat_skis_back", "pack", B(f"bski{sx}", 0.065, 1.3, 0.03, J("pack", (sx * 0.1, 0.26, 0.37)), (0, 0, sx * 0.065)), "ski")
    # skis on the boots, poles in the mittens
    for s in ("L", "R"):
        an, el = f"ankle_{s}", f"elbow_{s}"
        g = (0, -ANKLE - 0.01, -0.07)
        r.add(f"pat_ski_{s}", an, B(f"ski{s}", 0.085, 0.03, 1.65, J(an, v3(g, (0, 0, -0.05)))), "ski")
        r.add(f"pat_ski_{s}", an, B(f"tip{s}", 0.085, 0.03, 0.2, J(an, v3(g, (0, 0.035, -0.95))), (0.45, 0, 0)), "ski")
        r.add(f"pat_ski_{s}", an, B(f"binding{s}", 0.1, 0.04, 0.16, J(an, v3(g, (0, 0.03, 0.03)))), "dark")
        p = (0, -0.31, 0)
        r.add(f"pat_pole_{s}", el, C(f"shaft{s}", 0.012, 0.012, 1.2, 5, J(el, v3(p, (0, -0.85, -0.04)))), "metal")
        r.add(f"pat_pole_{s}", el, C(f"basket{s}", 0.05, 0.05, 0.015, 6, J(el, v3(p, (0, -1.38, -0.04)))), "dark")
    return r


# ====================================================================== Koda
def koda():
    mats = K.Materials(pal, {
        "grey": "#5F6873", "white": "#F4F2EE", "dark": "#3A4048", "noseBlack": "#15171A", "iris": "#8FD0F0",
        "pupil": "#101418", "earInner": "#E8B4A8", "tongue": "#E86A7A", "collar": "#D8382A", "tag": "#F2C230",
        "harnessMain": "#D8382A", "harnessSecond": "#F3EFE6", "bandana": "#D8382A", "glint": "Cross White",
    }, prefix="RS")
    r = Rig(mats)
    r.bone("body", None, (0, 0.5, 0))
    r.bone("front", "body", (0, 0, 0))
    r.bone("rear", "body", (0, 0, 0))
    r.bone("chest", "front", (0, 0, -0.33))
    legs = (("FL", -0.15, -0.34, True), ("FR", 0.15, -0.34, True), ("RL", -0.15, 0.38, False), ("RR", 0.15, 0.38, False))
    for n, x, z, front in legs:
        r.bone(f"leg_{n}_upper", "front" if front else "rear", (x, -0.04, z))
        r.bone(f"leg_{n}_lower", f"leg_{n}_upper", (0, -(0.23 if front else 0.24), 0))
    r.bone("head", "front", (0, 0.3, -0.5))
    r.bone("jaw", "head", (0, -0.11, -0.16))
    r.bone("tongue", "jaw", (0, 0.012, -0.08))
    r.bone("ear_L", "head", (-0.11, 0.16, 0.02))
    r.bone("ear_R", "head", (0.11, 0.16, 0.02))
    r.bone("tail_0", "rear", (0, 0.16, 0.5))
    for i in range(1, 4):
        r.bone(f"tail_{i}", f"tail_{i - 1}", (0, 0.1, 0))
    J = r.at
    body = "koda_body"
    # barrel: grey back over a white belly; chest (breathes) and ruff up front; haunches behind
    r.add(body, "body", G("back", 0.3, J("body", (0, 0.07, 0.02)), 1, (0.92, 0.8, 1.45)), "grey")
    r.add(body, "body", G("belly", 0.27, J("body", (0, -0.04, 0.02)), 1, (0.86, 0.74, 1.4)), "white")
    r.add(body, "chest", G("chestG", 0.25, J("chest", (0, 0, 0)), 1, (1, 1.05, 0.95)), "white")
    r.add(body, "front", G("ruff", 0.27, J("front", (0, 0.15, -0.3)), 1, (1.06, 0.88, 0.82)), "grey")
    r.add(body, "rear", G("haunch", 0.25, J("rear", (0, 0.06, 0.34)), 1, (1, 0.95, 1.05)), "grey")
    r.add(body, "rear", G("rump", 0.2, J("rear", (0, -0.05, 0.4)), 0), "white")
    # legs: a six-sided segment from each joint (as the code's), a snowshoe paw
    # (budget: the code-built Koda draws ~1,320 triangles; this one stays under it)
    for n, x, z, front in legs:
        up, lo = f"leg_{n}_upper", f"leg_{n}_lower"
        ul = 0.23 if front else 0.24
        r.add(body, up, C(f"u{n}", 0.08 if front else 0.1, 0.06, ul + 0.04, 6, J(up, (0, -(ul + 0.04) / 2, 0))), "white" if front else "grey")
        if not front:
            r.add(body, up, G(f"thigh{n}", 0.11, J(up, (0, -0.06, 0.01)), 0, (0.8, 1.2, 1.1)), "grey")
        r.add(body, lo, C(f"l{n}", 0.058, 0.05, 0.22, 6, J(lo, (0, -0.11, 0))), "white")
        r.add(body, lo, G(f"paw{n}", 0.07, J(lo, (0, -0.225, -0.03)), 0, (1, 0.58, 1.35)), "white")
    # head: grey cap and mask, white face, the muzzle, a dark nose
    hd = lambda p: J("head", p)  # noqa: E731
    r.add(body, "head", G("skull", 0.2, hd((0, 0.04, 0)), 1, (1, 0.88, 1.05)), "grey")
    r.add(body, "head", G("face", 0.17, hd((0, -0.03, -0.08)), 1, (1.06, 0.85, 1)), "white")
    r.add(body, "head", G("muzzle", 0.11, hd((0, -0.06, -0.25)), 1, (0.92, 0.72, 1.45)), "white")
    # a rounded nose (the old one was a spiky ball)
    r.add(body, "head", S("nose", 0.04, hd((0, -0.012, -0.4)), 6, (1.15, 0.75, 0.85)), "noseBlack")
    # the husky's white brow spots above each eye, and tufts of white ruff at the cheeks
    for sx in (-1, 1):
        r.add(body, "head", G(f"browspot{sx}", 0.03, hd((sx * 0.075, 0.115, -0.168)), 0, (1.15, 0.65, 0.6), (0.3, 0, sx * -0.3)), "white")
        r.add(body, "head", cone(f"cheek{sx}", 0.045, 0.11, 3, hd((sx * 0.16, -0.055, -0.04)), (0, 0, sx * -(math.pi / 2 + 0.45))), "white")
    r.add(body, "head", G("mask", 0.07, hd((0, 0.06, -0.19)), 0, (0.75, 0.5, 2), (0.3, 0, 0)), "grey")
    r.add(body, "jaw", G("jawG", 0.08, J("jaw", (0, -0.01, -0.08)), 0, (0.95, 0.4, 1.4)), "white")
    # ears (the left flops: the code tips it over on its joint), with pink insides
    for s in ("L", "R"):
        e = f"ear_{s}"
        r.add(body, e, cone(f"ear{s}", 0.08, 0.19, 4, J(e, (0, 0.09, 0))), "grey")
        r.add(body, e, cone(f"inner{s}", 0.048, 0.13, 4, J(e, (0, 0.075, -0.027))), "earInner")
    # the tail: a plume of four links, grey to a white tip
    for i in range(4):
        t = f"tail_{i}"
        rr = 0.075 - i * 0.004
        r.add(body, t, G(f"tuft_{i}", rr, J(t, (0, 0.055, 0)), 0, (1, 1.35, 1)), "white" if i == 3 else "grey")
    # collar and tag (always on; the code paints the collar)
    r.add(body, "front", place(K.torus("collarT", 0.15, 0.03, (0, 0, 0), axis="Z", major=10, minor=4), J("front", (0, 0.18, -0.43)), (math.pi / 2 - 0.5, 0, 0)), "collar")
    r.add(body, "front", G("tag", 0.03, J("front", (0, 0.08, -0.55)), 0), "tag")
    # eyes open and shut (the code swaps them), and the tongue (shown when panting)
    for sx, s in ((-1, "L"), (1, "R")):
        # pale husky-blue almond eyes, tipped up at the outer corner, on the face's surface there
        # (where the skull and the white face meet, z ~ -0.19), the pupil set into the iris (it used
        # to float in front of it) and a catchlight
        r.add("koda_eyes_open", "head", G(f"iris{s}", 0.042, hd((sx * 0.085, 0.06, -0.183)), 0, (1, 0.8, 0.52), (0, 0, sx * 0.25)), "iris")
        r.add("koda_eyes_open", "head", G(f"pupil{s}", 0.021, hd((sx * 0.085, 0.058, -0.2)), 0, (1, 1.05, 0.4)), "pupil")
        r.add("koda_eyes_open", "head", B(f"glint{s}", 0.012, 0.012, 0.006, hd((sx * 0.085 - 0.009, 0.071, -0.209)), (0, 0, 0.6)), "glint")
        # asleep: a curved, closed eye (two strokes bowed downward)
        for k in (-1, 1):
            r.add("koda_eyes_shut", "head", B(f"lid{s}{k}", 0.042, 0.012, 0.02, hd((sx * 0.085 + k * 0.017, 0.055, -0.192)), (0, 0, k * 0.35)), "dark")
    tg = K.box("tongueB", (0.065, 0.015, 0.13), (0, 0, 0))
    K.deform(tg, lambda v: Vector((v.x, v.y, v.z - 0.065)))
    r.add("koda_tongue", "tongue", place(tg, J("tongue", (0, 0, 0))), "tongue")
    # harness and its saddlebags (gear the game turns on)
    r.add("koda_harness", "body", place(K.torus("strapT", 0.28, 0.035, (0, 0, 0), axis="Z", major=12, minor=4), J("body", (0, 0.04, -0.14))), "harnessMain")
    r.add("koda_harness", "body", B("saddle", 0.36, 0.06, 0.32, J("body", (0, 0.31, -0.05)), bevel=0.01), "harnessMain")
    r.add("koda_harness", "body", B("hx", 0.37, 0.065, 0.08, J("body", (0, 0.31, -0.05))), "harnessSecond")
    r.add("koda_harness", "body", B("hz", 0.08, 0.066, 0.2, J("body", (0, 0.31, -0.05))), "harnessSecond")
    for sx in (-1, 1):
        r.add("koda_harness_pack", "body", B(f"bag{sx}", 0.12, 0.2, 0.28, J("body", (sx * 0.29, 0.12, 0.02)), bevel=0.015), "harnessSecond")
    r.add("koda_bandana", "front", place(cone("band", 0.17, 0.2, 3, (0, 0, 0)), J("front", (0, 0.02, -0.5)), (math.pi + 0.4, 0, 0)), "bandana")
    return r


BUILD = {"rs_patroller": patroller, "rs_koda": koda}
rig = BUILD[asset]()
arm, objs = build(rig, asset)
bpy.ops.wm.save_as_mainfile(filepath=A["out"])
tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs}
print(f"{asset}: {sum(tris.values())} tris {tris}, {len(rig.bones)} bones, saved {A['out']}")
