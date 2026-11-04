"""ROCKSLIDE: Hollin, the Tannberg huts and the valley's outbuildings (MeshCraft run_script).

Run inside MeshCraft's Blender (globals: bpy, kit, args, Palette):
  run_script {"path": ".../valley_buildings.py", "args": {"asset": "rs_chalet", "palette": ".../rockslide-palette.json", "out": ".../rs_chalet.blend"}}

These replace the code-built buildings in src/render/worldView.ts (not the patrol station). Each is
modelled in the game's own coordinates (metres, +Y up, the street front toward +Z) at the footprint the
code builds, so the colliders in src/world/station.ts still fit. Buildings the game sizes per instance
are split into nodes it can fit separately:

  rs_chalet / rs_chalet_wide / rs_chalet_small:
    body     walls, windows, shutters, trim (scaled to the house's width and depth)
    roof     roof, snow, gables (origin at the top of the walls; scaled to span and pitch)
    balcony  origin on the front wall line (moved to the house's depth; shown on some houses)
    door     the front door (hidden where the code puts its own, the clinic's glass door)
    chimney  origin at its foot (placed where the code's chimney and its smoke are)
  rs_cabin: body, roof (Fernhut; also fitted to the Tannberg top-station hut)
  rs_chapel, rs_boathouse, rs_barrier_hut: one node each, exact size.

Materials are roles (wall, roof, shutter, window...). The game paints each role with its own material for
that building (each house's wall and roof colour, the lit windows), so every region still merges into
one mesh per material. Low-poly and faceted, like the rest of the valley.
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

ROLES = {
    "stone": "#B7A69E", "stoneDark": "#8D7C78", "wall": "Blush", "plank": "#C9938F", "trim": "Paper",
    "shutter": "#5F9C86", "window": "Lamp Glow", "logDark": "#8E3F4C", "logLight": "#E3A3A6", "roof": "Burgundy Roof",
    "roofSnow": "Kessel Snow", "door": "#6B4428", "log": "Log", "logShade": "Log Dark", "grain": "End Grain",
    "dome": "Mustard", "spire": "Caution Amber", "belfry": "#262A30", "boat": "#6B4428", "boatDark": "#3D2A1C",
    # the patrol station's yard
    "boards": "#8FBFA8", "batten": "#729988", "header": "#64857A", "floor": "#9C9A94", "rolled": "#E9E2D0",
    "roofDark": "#4A4F55", "steel": "#6E7A85", "rib": "#58626A", "arch": "#4F5A64", "red": "Patrol Red",
    "white": "Paper", "metal": "Steel", "hut": "#5E6266", "dark": "#1A1512",
}
mats = K.Materials(pal, ROLES, prefix="RS")
M = mats.__getitem__


# ------------------------------------------------------------------ helpers, in three.js space
def place(o, pos=(0, 0, 0), rot=(0, 0, 0), role=None):
    o.rotation_mode = "ZYX"  # Blender ZYX == three.js 'XYZ'
    o.location = pos; o.rotation_euler = rot
    if role: K.assign(o, M(role))
    return o


def B(role, w, h, d, pos=(0, 0, 0), rot=(0, 0, 0), bevel=0.0):
    return place(K.box("b", (w, h, d), (0, 0, 0), None, bevel=bevel), pos, rot, role)


def C(role, rt, rb, h, seg, pos=(0, 0, 0), rot=(0, 0, 0)):
    return place(K.cylinder("c", rt, h, (0, 0, 0), axis="Y", verts=seg, r2=rb), pos, rot, role)


def P(role, outline, depth, pos=(0, 0, 0), rot=(0, 0, 0)):
    """An outline [(x, y), ...] in the xy plane, extruded along z."""
    return place(K.prism("p", outline, depth, (0, 0, 0), axis="Z"), pos, rot, role)


def lathe(role, profile, seg, pos=(0, 0, 0)):
    """A turned shape: profile [(r, y), ...] bottom to top, spun round y."""
    bm = bmesh.new(); rings = []
    for r, y in profile:
        rings.append([bm.verts.new((math.cos(a) * r, y, math.sin(a) * r)) for a in (math.tau * i / seg for i in range(seg))] if r > 1e-4 else [bm.verts.new((0, y, 0))])
    for a, b in zip(rings, rings[1:]):
        if len(b) == 1:
            for i in range(seg): bm.faces.new((a[i], a[(i + 1) % seg], b[0]))
        elif len(a) == 1:
            for i in range(seg): bm.faces.new((a[0], b[(i + 1) % seg], b[i]))
        else:
            for i in range(seg): bm.faces.new((a[i], a[(i + 1) % seg], b[(i + 1) % seg], b[i]))
    if len(rings[0]) > 1: bm.faces.new(rings[0][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("lathe"); bm.to_mesh(me); bm.free()
    return place(K.link(bpy.data.objects.new("lathe", me)), pos, (0, 0, 0), role)


def turn(parts, angle):
    """Rotate already-placed parts about the y axis through the origin (three.js space)."""
    R = Matrix.Rotation(angle, 4, "Z")  # in the three.js-space frame we model in, y is up: rotate about it
    # (we model in three.js coordinates inside Blender, so 'up' is Blender's local Y; build the matrix)
    R = Matrix(((math.cos(angle), 0, math.sin(angle), 0), (0, 1, 0, 0), (-math.sin(angle), 0, math.cos(angle), 0), (0, 0, 0, 1)))
    for o in parts:
        bpy.context.view_layer.update()
        o.matrix_world = R @ o.matrix_world
    return parts


def finish(parts, name, pivot=(0, 0, 0)):
    o = K.join(parts, name)
    o.data.transform(o.matrix_world); o.matrix_world = Matrix()
    pv = Vector(pivot)
    o.data.transform(Matrix.Translation(-pv))
    o.data.transform(TO_BLENDER)
    o.location = TO_BLENDER @ pv
    K.shade(o)
    K.bake_vertex_colors(o, mats, jitter=0.03, seed=len(name))
    o["gitcraft_asset"] = asset
    return o


# ------------------------------------------------------------------ shared pieces
def snow_roof(W, L, H, roof="roof", snow=0.28):
    """Two roof planes meeting at a ridge along z: span W across x, length L along z, pitch H, with
    snow on top, a snow ridge and a snow lip along both eaves. Origin at eave level, centred."""
    parts = []
    half = W / 2
    slope = math.hypot(half, H)
    a = math.atan2(H, half)
    for s in (-1, 1):
        parts.append(B(roof, slope, 0.22, L, (s * half / 2, H / 2, 0), (0, 0, -s * a)))
        n = Vector((s * math.sin(a), math.cos(a), 0))
        c = Vector((s * half / 2, H / 2, 0)) + n * 0.2
        parts.append(B("roofSnow", slope - 0.15, snow, L - 0.1, tuple(c), (0, 0, -s * a)))
        parts.append(C("roofSnow", 0.18, 0.18, L - 0.2, 6, (s * (half - 0.05), 0.05, 0), (math.pi / 2, 0, 0)))
    parts.append(C("roofSnow", 0.2, 0.2, L - 0.1, 6, (0, H + 0.24, 0), (math.pi / 2, 0, 0)))
    return parts


def gable_end(role, w, H, z, t=0.25):
    return P(role, [(-w / 2, 0), (w / 2, 0), (0, H)], t, (0, 0, z))


def window(x, y, z, face, shutter=True, w=0.8, h=0.9):
    """A lit window on a wall facing +z (face 1) or -z (face -1): frame, pane, cross bars, a snowy
    sill, shutters either side."""
    s = face
    out = [B("logDark", w + 0.18, h + 0.18, 0.1, (x, y, z)),
           B("window", w, h, 0.12, (x, y, z + s * 0.02)),
           B("logDark", 0.06, h, 0.14, (x, y, z + s * 0.03)),
           B("logDark", w, 0.06, 0.14, (x, y, z + s * 0.03)),
           B("roofSnow", w + 0.3, 0.12, 0.3, (x, y - h / 2 - 0.12, z + s * 0.1))]
    if shutter:
        for sx in (-1, 1):
            out.append(B("shutter", 0.4, h + 0.1, 0.06, (x + sx * (w / 2 + 0.22), y, z + s * 0.04)))
            out.append(B("trim", 0.32, 0.06, 0.07, (x + sx * (w / 2 + 0.22), y + 0.18, z + s * 0.05)))
    return out


def side_window(x, y, z, face, w=0.6, h=0.7):
    """A small window on a wall facing +x (face 1) or -x (face -1)."""
    s = face
    return [B("logDark", 0.1, h + 0.16, w + 0.16, (x, y, z)),
            B("window", 0.12, h, w, (x + s * 0.02, y, z)),
            B("logDark", 0.14, 0.05, w, (x + s * 0.03, y, z)),
            B("roofSnow", 0.28, 0.1, w + 0.25, (x + s * 0.1, y - h / 2 - 0.1, z))]


# ------------------------------------------------------------------ the chalet
def chalet(w, d, floors, wins):
    """An alpine chalet: stone ground floor with quoins, a painted timber upper floor with plank lines,
    a cream band and corner boards, shuttered windows, a deep snowy roof and gables, a balcony on its
    brackets, a front door, a chimney. The code's dimensions: ground floor 2.6 m, upper floor 2.4 m,
    roof pitch 0.42 x the shorter side, eaves 0.8 m over the sides and 0.9 m over the gable ends."""
    h1 = 2.6
    top = h1 + (2.4 if floors > 1 else 0)
    body = [B("stone", w, h1, d, (0, h1 / 2, 0)),
            B("stoneDark", w + 0.08, 0.28, d + 0.08, (0, 0.14, 0))]
    # quoins: alternating dressed stones up each corner
    for cx in (-w / 2, w / 2):
        for cz in (-d / 2, d / 2):
            for i in range(3):
                y = 0.55 + i * 0.75
                long_x = i % 2 == 0
                body.append(B("stoneDark", 0.5 if long_x else 0.26, 0.32, 0.26 if long_x else 0.5,
                              (cx - math.copysign(0.25 if long_x else 0.13, cx) + math.copysign(0.02, cx), y, cz - math.copysign(0.13 if long_x else 0.25, cz) + math.copysign(0.02, cz))))
    if floors > 1:
        body += [B("wall", w, 2.4, d, (0, h1 + 1.2, 0)),
                 B("trim", w + 0.1, 0.18, d + 0.1, (0, h1 + 0.05, 0))]
        for cx in (-w / 2, w / 2):
            for cz in (-d / 2, d / 2):
                body.append(B("trim", 0.16, 2.4, 0.16, (cx, h1 + 1.2, cz)))
        # plank lines on the painted timber
        for i in range(4):
            y = h1 + 0.45 + i * 0.5
            for s in (-1, 1):
                body.append(B("plank", w - 0.2, 0.04, 0.02, (0, y, s * (d / 2 + 0.01))))
                body.append(B("plank", 0.02, 0.04, d - 0.2, (s * (w / 2 + 0.01), y, 0)))
    wy = h1 + 1.3 if floors > 1 else 1.5
    xs = [-w / 4, w / 4] if wins == 2 else [-w / 3, 0, w / 3]
    for s in (-1, 1):
        for x in xs:
            body += window(x, wy, s * (d / 2 + 0.06), s)
    # small windows in the side walls, and two in the stone at the back
    for s in (-1, 1):
        body += side_window(s * (w / 2 + 0.06), wy, 0, s)
    if floors > 1:
        for x in (-w / 4, w / 4):
            body += window(x, 1.45, -(d / 2 + 0.06), -1, shutter=False, w=0.6, h=0.6)
    roof = snow_roof(w + 1.6, d + 1.8, min(w, d) * 0.42)
    H = min(w, d) * 0.42
    for s in (-1, 1):
        roof.append(gable_end("wall", w, H, s * (d / 2 - 0.05)))
        # barge boards along the rake of each gable, and the purlin ends under the eaves
        L = math.hypot(w / 2 + 0.8, H)
        a = math.atan2(H, w / 2 + 0.8)
        for sx in (-1, 1):
            roof.append(B("logDark", L, 0.18, 0.08, (sx * (w / 2 + 0.8) / 2, H / 2 + 0.02, s * (d / 2 + 0.88)), (0, 0, -sx * a)))
        for x in (-w / 3, 0, w / 3):
            roof.append(B("logDark", 0.16, 0.16, 0.9, (x, H * (1 - abs(x) / (w / 2 + 0.8)) - 0.25, s * (d / 2 + 0.4))))
    bal = []
    if floors > 1:
        bw = w * 0.8
        f = d / 2  # the front wall line: the balcony's own origin
        bal = [B("logDark", bw, 0.12, 1.1, (0, h1 + 0.15, f + 0.55)),
               B("logLight", bw, 0.08, 0.1, (0, h1 + 1.0, f + 1.05)),
               B("logLight", bw, 0.06, 0.08, (0, h1 + 0.35, f + 1.05))]
        n = max(8, int(bw / 0.32))
        for i in range(n + 1):
            bal.append(B("logLight", 0.12, 0.62, 0.04, (-bw / 2 + i * bw / n, h1 + 0.68, f + 1.06)))
        for x in (-bw / 2 + 0.2, 0, bw / 2 - 0.2):
            bal.append(B("logDark", 0.12, 0.12, 1.15, (x, h1 - 0.3, f + 0.5), (0.7, 0, 0)))
        bal.append(B("roofSnow", bw - 0.05, 0.1, 0.16, (0, h1 + 1.09, f + 1.05)))
    dx = w * 0.22
    door = [B("logDark", 1.15, 2.2, 0.12, (dx, 1.1, d / 2 + 0.04)),
            B("door", 0.92, 2.0, 0.1, (dx, 1.02, d / 2 + 0.08)),
            B("logDark", 0.92, 0.06, 0.12, (dx, 1.35, d / 2 + 0.1)),
            B("trim", 0.08, 0.08, 0.06, (dx + 0.3, 1.05, d / 2 + 0.15)),
            B("stoneDark", 1.4, 0.16, 0.6, (dx, 0.08, d / 2 + 0.3))]
    chimney = [B("stone", 0.7, 2.5, 0.7, (0, 1.25, 0)),
               B("stoneDark", 0.9, 0.15, 0.9, (0, 2.55, 0)),
               B("roofSnow", 0.82, 0.12, 0.82, (0, 2.68, 0))]
    objs = [finish(body, "body"), finish(roof, "roof"), finish(door, "door"), finish(chimney, "chimney")]
    # the roof is modelled with its origin at eave level: it sits on the top of the walls
    objs[1].location = TO_BLENDER @ Vector((0, top, 0))
    if bal:
        b = finish(bal, "balcony", (0, 0, d / 2))
        objs.append(b)
    return objs


# ------------------------------------------------------------------ the chapel
def chapel():
    """Hollin chapel: a powder-blue nave with tall arched windows and a door at the front, a burgundy
    roof under snow, and the white bell tower behind with louvred belfry openings, a clock and the
    mustard onion dome with its spire. The code's footprint: nave 5 x 8, tower 2.4 square at z -4.6."""
    p = [B("wall", 5, 4.2, 8, (0, 2.1, 0)), B("stoneDark", 5.1, 0.3, 8.1, (0, 0.15, 0))]
    p += snow_roof(5.8, 8.8, 2.4)
    p.append(gable_end("wall", 5, 2.4, 3.95))
    p[-1].location.y += 4.2
    p.append(gable_end("wall", 5, 2.4, -3.95))
    p[-1].location.y += 4.2
    for o in p[2:2 + 7]:
        o.location.y += 4.2
    # arched windows down both sides, a rose window and the door at the front
    for s in (-1, 1):
        for z in (-1.8, 0.4, 2.6):
            p.append(B("logDark", 0.1, 1.7, 0.86, (s * 2.53, 2.3, z)))
            p.append(B("window", 0.12, 1.5, 0.66, (s * 2.55, 2.25, z)))
            p.append(C("window", 0.33, 0.33, 0.12, 8, (s * 2.55, 3.0, z), (0, 0, math.pi / 2)))
    p.append(C("logDark", 0.5, 0.5, 0.1, 10, (0, 5.3, 4.02), (math.pi / 2, 0, 0)))
    p.append(C("window", 0.38, 0.38, 0.12, 10, (0, 5.3, 4.05), (math.pi / 2, 0, 0)))
    p.append(B("trim", 1.5, 2.6, 0.12, (0, 1.3, 4.03)))
    p.append(B("door", 1.1, 2.2, 0.12, (0, 1.1, 4.08)))
    p.append(C("door", 0.55, 0.55, 0.12, 10, (0, 2.2, 4.08), (math.pi / 2, 0, 0)))
    p.append(B("stoneDark", 2.0, 0.18, 0.9, (0, 0.09, 4.4)))
    # the tower
    tz = -4.6
    p.append(B("trim", 2.4, 8, 2.4, (0, 4, tz)))
    p.append(B("stoneDark", 2.6, 0.25, 2.6, (0, 0.12, tz)))
    p.append(B("stoneDark", 2.7, 0.22, 2.7, (0, 8.0, tz)))
    for (fx, fz) in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        # a louvred belfry opening (arched) on every face, and a clock below it on the three faces
        # the nave roof does not hide
        ox, oz = fx * 1.21, tz + fz * 1.21
        along_z = fz != 0
        disc = (math.pi / 2, 0, 0) if along_z else (0, 0, math.pi / 2)
        thin = (0.8, 0.8, 0.1) if along_z else (0.1, 0.8, 0.8)
        p.append(B("belfry", thin[0], thin[1], thin[2], (ox, 7.2, oz)))
        p.append(C("belfry", 0.4, 0.4, 0.1, 8, (ox, 7.6, oz), disc))
        for k in range(3):
            louvre = (0.84, 0.05, 0.06) if along_z else (0.06, 0.05, 0.84)
            p.append(B("trim", louvre[0], louvre[1], louvre[2], (ox, 6.95 + k * 0.22, oz)))
        if fz == 1:
            continue
        cx, cz = fx * 1.24, tz + fz * 1.24
        p.append(C("trim", 0.38, 0.38, 0.06, 10, (cx, 6.25, cz), disc))
        hand_out = (fx * 0.04, 0, fz * 0.04)
        p.append(B("belfry", 0.05 if along_z else 0.04, 0.28, 0.04 if along_z else 0.05, (cx + hand_out[0], 6.33, cz + hand_out[2])))
        p.append(B("belfry", 0.2 if along_z else 0.04, 0.05, 0.04 if along_z else 0.2, (cx + hand_out[0] + (0.08 if along_z else 0), 6.25, cz + hand_out[2] + (0 if along_z else 0.08))))
    # the onion dome, its neck and the spire with a cross
    p.append(lathe("dome", [(1.05, 8.1), (1.42, 8.5), (1.55, 9.0), (1.38, 9.5), (0.9, 9.95), (0.38, 10.35), (0.14, 10.62), (0.0, 10.78)], 12))
    p.append(C("spire", 0.06, 0.06, 1.3, 5, (0, 11.3, tz)))
    p[-2].location = (0, 0, tz)
    p.append(B("spire", 0.07, 0.6, 0.07, (0, 11.85, tz)))
    p.append(B("spire", 0.38, 0.07, 0.07, (0, 11.95, tz)))
    return [finish(p, "chapel")]


# ------------------------------------------------------------------ the log cabin
def cabin():
    """Fernhut: a log cabin 5 x 4 m, walls 2.3 m, with notched corners (the logs of the side walls sit
    half a log higher, their ends showing their grain), a window and a door at the front, a stone
    chimney, and a snowy roof with its ridge along the long side and log-filled gables."""
    r = 0.17
    h = 2.3
    n = max(2, round(h / (r * 2)))
    body = []
    for i in range(n):
        y0 = r + i * r * 2
        for s in (-1, 1):
            body.append(C("log" if i % 2 else "logShade", r, r, 5.5, 7, (0, y0, s * 2.0), (0, 0, math.pi / 2)))
            for ex in (-1, 1):
                body.append(C("grain", r * 0.92, r * 0.92, 0.04, 7, (ex * 2.76, y0, s * 2.0), (0, 0, math.pi / 2)))
            body.append(C("logShade" if i % 2 else "log", r, r, 4.5, 7, (s * 2.5, y0 + r, 0), (math.pi / 2, 0, 0)))
    body += window(0.6, 1.4, 2.2, 1, shutter=False, w=0.8, h=0.7)
    body += [B("logDark", 1.0, 2.0, 0.12, (-1.3, 1.0, 2.15)), B("door", 0.8, 1.85, 0.1, (-1.3, 0.95, 2.2)),
             B("stone", 0.6, 1.8, 0.6, (2.3, 3.2, 1.0)), B("roofSnow", 0.66, 0.12, 0.66, (2.3, 4.16, 1.0))]
    roof = snow_roof(5.6, 6.0, 1.7)
    for s in (-1, 1):
        roof.append(gable_end("log", 4.0, 1.7, s * 2.45))
    turn(roof, math.pi / 2)  # the ridge runs along the long side (x), as the code's roof does
    objs = [finish(body, "body"), finish(roof, "roof", (0, 0, 0))]
    objs[1].location = TO_BLENDER @ Vector((0, h, 0))
    return objs


# ------------------------------------------------------------------ the boathouse and the barrier hut
def boathouse():
    """The Mirror Lake boathouse: dark board-and-batten walls 5 x 7 m, a pair of lake doors with
    braces, a roof with its ridge along the length, and a jetty on posts."""
    p = [B("boat", 5, 2.4, 7, (0, 1.2, 0))]
    for i in range(9):
        x = -2.2 + i * 0.55
        for s in (-1, 1):
            if abs(x) > 1.5 or s < 0:
                p.append(B("boatDark", 0.07, 2.3, 0.05, (x, 1.15, s * 3.52)))
    for i in range(12):
        z = -3.25 + i * 0.59
        for s in (-1, 1):
            p.append(B("boatDark", 0.05, 2.3, 0.07, (s * 2.52, 1.15, z)))
    for sx in (-1, 1):
        p.append(B("boatDark", 1.45, 2.0, 0.1, (sx * 0.76, 1.0, 3.55)))
        p.append(B("logDark", 1.3, 0.1, 0.06, (sx * 0.76, 1.6, 3.61)))
        p.append(B("logDark", 1.3, 0.1, 0.06, (sx * 0.76, 0.4, 3.61)))
        p.append(B("logDark", 1.4, 0.08, 0.06, (sx * 0.76, 1.0, 3.62), (0, 0, sx * 0.72)))
    p.append(B("logDark", 1.6, 0.15, 6, (0, 0.3, 6.5)))
    for z in (4.2, 6.5, 8.8):
        for sx in (-1, 1):
            p.append(C("logDark", 0.08, 0.08, 0.9, 5, (sx * 0.7, -0.05, z)))
    roof = snow_roof(5.8, 7.8, 1.8, roof="boatDark")
    for s in (-1, 1):
        roof.append(gable_end("boat", 5, 1.8, s * 3.45))
    for o in roof:
        o.location.y += 2.4
    return [finish(p + roof, "boathouse")]


def barrier_hut():
    """The pass barrier hut: a cream 2 m box with a red snow roof, a window toward the road and a door."""
    p = [B("trim", 2, 2.2, 2, (0, 1.1, 0)), B("stoneDark", 2.08, 0.2, 2.08, (0, 0.1, 0))]
    p += window(0, 1.4, 1.06, 1, shutter=False, w=0.8, h=0.6)
    p += [B("logDark", 0.9, 1.9, 0.1, (1.05, 0.95, 0.2), (0, math.pi / 2, 0)), B("roof", 0.75, 1.75, 0.08, (1.08, 0.9, 0.2), (0, math.pi / 2, 0))]
    roof = snow_roof(2.6, 2.6, 0.7, snow=0.2)
    for s in (-1, 1):
        roof.append(gable_end("trim", 2, 0.7, s * 0.95))
    turn(roof, math.pi / 2)
    for o in roof:
        o.location.y += 2.2
    return [finish(p + roof, "barrier_hut")]


# ------------------------------------------------------------------ the patrol station's yard
# (src/world/station.ts: GARAGE 12 x 10, walls 3.6; HANGAR 14 x 16, walls 6; EQUIP 9 x 6, walls 3)
def garage():
    """The patrol garage: painted boards with battens, an open west front with a header beam and the
    rolled-up door, a dark roof under snow with board gables. Walls, front and roof are their own nodes:
    the game cuts them away (its dollhouse view) when you are inside."""
    w, d, h = 12.0, 10.0, 3.6
    hw, hd = w / 2, d / 2
    floor = [B("floor", w, 0.15, d, (0, 0.07, 0))]

    def wall(name, ww, dd, x, z):
        p = [B("boards", ww, h, dd, (x, h / 2, z))]
        n = round(max(ww, dd) / 0.6)
        for i in range(n):
            u = -0.5 + (i + 0.5) / n
            if ww > dd:
                p.append(B("batten", 0.08, h, dd + 0.04, (x + u * ww, h / 2, z)))
            else:
                p.append(B("batten", dd + 0.04 if False else ww + 0.04, h, 0.08, (x, h / 2, z + u * dd)))
        # a small window high in each long wall
        if ww > dd:
            for wx in (-3, 3):
                p += [B("logDark", 1.1, 0.7, dd + 0.06, (wx, 2.6, z)), B("window", 0.9, 0.5, dd + 0.08, (wx, 2.6, z))]
        return finish(p, name)

    walls = [wall("wall_n", w, 0.3, 0, -hd), wall("wall_s", w, 0.3, 0, hd), wall("wall_e", 0.3, d, hw, 0)]
    side = (d - 5.5) / 2
    front = [B("boards", 0.3, h, side, (-hw, h / 2, -hd + side / 2)), B("boards", 0.3, h, side, (-hw, h / 2, hd - side / 2)),
             B("header", 0.4, 0.7, d, (-hw, h - 0.35, 0)), B("rolled", 0.3, 0.5, 5.6, (-hw + 0.2, h - 0.95, 0))]
    for z in (-hd + side / 2, hd - side / 2):
        for k in range(3):
            front.append(B("batten", 0.34, h, 0.08, (-hw, h / 2, z - side / 2 + (k + 0.5) * side / 3)))
    # bump stops either side of the door, painted patrol red and white
    for z in (-2.85, 2.85):
        for k in range(3):
            front.append(B("red" if k % 2 == 0 else "white", 0.34, 0.3, 0.34, (-hw - 0.05, 0.15 + k * 0.3, z)))
    roof = snow_roof(d + 1.2, w + 1.2, 1.8, roof="roofDark")
    for sd in (-1, 1):
        roof.append(gable_end("boards", d, 1.8, sd * (hw - 0.1), t=0.3))
    turn(roof, math.pi / 2)  # ridge along x, as the code's roof
    for o in roof:
        o.location.y += h
    objs = [finish(floor, "floor")] + walls + [finish(front, "front"), finish(roof, "roof")]
    return objs


def hangar():
    """Hangar 1: ribbed steel walls (open to the west for the helicopter) on a concrete floor, a low
    arched roof with snow along its crown, and a vent on top."""
    w, d, h = 14.0, 16.0, 6.0
    p = [B("floor", w, 0.15, d, (0, 0.07, 0))]
    p += [B("steel", w - 2, h, 0.3, (1, h / 2, -d / 2)), B("steel", w - 2, h, 0.3, (1, h / 2, d / 2)), B("steel", 0.3, h, d, (w / 2, h / 2, 0))]
    for i in range(10):
        x = -w / 2 + 2 + i * ((w - 2) / 10)
        for s in (-1, 1):
            p.append(B("rib", 0.12, h, 0.36, (x, h / 2, s * d / 2)))
    for i in range(12):
        z = -d / 2 + 0.7 + i * (d - 1.4) / 11
        p.append(B("rib", 0.36, h, 0.12, (w / 2, h / 2, z)))
    # the arch: a flattened half cylinder along x, ribs over it, snow along the crown
    R = d / 2 + 0.4
    seg = 14
    arc = [(math.cos(math.pi * i / seg) * R, math.sin(math.pi * i / seg) * R * 0.35) for i in range(seg + 1)]
    for i in range(seg):
        (z0, y0), (z1, y1) = arc[i], arc[i + 1]
        L = math.hypot(z1 - z0, y1 - y0)
        ang = math.atan2(y1 - y0, z1 - z0)
        mid = ((z0 + z1) / 2, (y0 + y1) / 2)
        p.append(B("arch", w, 0.16, L + 0.02, (1, h + mid[1], mid[0]), (-ang, 0, 0)))
        if 4 <= i <= 9:
            p.append(B("roofSnow", w - 0.3, 0.2, L + 0.02, (1, h + mid[1] + 0.15, mid[0]), (-ang, 0, 0)))
    for k in range(6):
        x = -w / 2 + 1.5 + k * (w - 1) / 5
        for i in range(seg):
            (z0, y0), (z1, y1) = arc[i], arc[i + 1]
            L = math.hypot(z1 - z0, y1 - y0)
            p.append(B("rib", 0.14, 0.2, L + 0.02, (x, h + (y0 + y1) / 2 + 0.06, (z0 + z1) / 2), (-math.atan2(y1 - y0, z1 - z0), 0, 0)))
    p += [C("metal", 0.35, 0.35, 0.8, 8, (3, h + R * 0.35 + 0.3, 0)), C("hut", 0.5, 0.5, 0.15, 8, (3, h + R * 0.35 + 0.75, 0))]
    return [finish(p, "hangar")]


def equipment():
    """The equipment room: board-and-batten walls on a stone footing, a door, a window each side, a
    snowy roof with board gables (the code's had open triangles)."""
    w, d, h = 9.0, 6.0, 3.0
    p = [B("boat", w, h, d, (0, h / 2, 0)), B("stoneDark", w + 0.1, 0.3, d + 0.1, (0, 0.15, 0))]
    for i in range(12):
        x = -w / 2 + 0.4 + i * 0.75
        for s in (-1, 1):
            if not (s > 0 and abs(x) < 0.9):
                p.append(B("boatDark", 0.08, h, 0.05, (x, h / 2, s * (d / 2 + 0.02))))
    # (no canopy over the door: the game hangs its EQUIPMENT sign there)
    p += [B("logDark", 1.6, 2.35, 0.1, (0, 1.17, d / 2 + 0.03)), B("boatDark", 1.4, 2.2, 0.12, (0, 1.1, d / 2 + 0.06))]
    for x in (-3, 3):
        p += window(x, 1.7, d / 2 + 0.06, 1, shutter=False, w=0.9, h=0.7)
    roof = snow_roof(d + 1, w + 1, 1.4)
    for s in (-1, 1):
        roof.append(gable_end("boat", d, 1.4, s * (w / 2 - 0.05)))
    turn(roof, math.pi / 2)
    for o in roof:
        o.location.y += h
    return [finish(p + roof, "equipment")]


def doghouse():
    """Koda's house: plank walls, a round-topped doorway, a pitched roof under snow (the kennel upgrade
    scales it up and repaints it)."""
    p = [B("wall", 1.8, 1.1, 2.2, (0, 0.55, 0)), B("stoneDark", 1.9, 0.12, 2.3, (0, 0.06, 0))]
    for i in range(4):
        y = 0.2 + i * 0.27
        for s in (-1, 1):
            p.append(B("plank", 0.02, 0.03, 2.1, (s * 0.91, y, 0)))
    p += [B("dark", 0.6, 0.55, 0.05, (0, 0.37, 1.11)), C("dark", 0.3, 0.3, 0.05, 10, (0, 0.65, 1.11), (math.pi / 2, 0, 0)),
          B("trim", 0.75, 0.06, 0.07, (0, 0.92, 1.12))]
    roof = snow_roof(2.4, 2.6, 0.8, snow=0.18)
    for s in (-1, 1):
        roof.append(gable_end("wall", 1.8, 0.8, s * 1.08))
    for o in roof:
        o.location.y += 1.1
    return [finish(p + roof, "doghouse")]


def mast():
    """The radio mast: 20 m of red and white sections tapering up, a ladder, a work platform with its
    arm, the dish, and the equipment hut at the foot (the beacon on top is the game's own light)."""
    H = 20.0
    p = []
    for i in range(8):
        r0, r1 = 0.6 - i * 0.04, 0.55 - i * 0.04
        p.append(C("red" if i % 2 == 0 else "white", r1, r0, H / 8, 4, (0, (i + 0.5) * H / 8, 0), (0, math.pi / 4, 0)))
    for i in range(int(H / 0.5)):
        p.append(B("metal", 0.4, 0.04, 0.04, (0, 0.3 + i * 0.5, 0.62 - i * 0.01)))
    p += [B("metal", 0.04, H - 1, 0.04, (0.2, H / 2, 0.58)), B("metal", 0.04, H - 1, 0.04, (-0.2, H / 2, 0.58))]
    p += [B("metal", 1.4, 0.2, 0.8, (0.5, 14, 0)), B("metal", 0.2, 1.4, 0.2, (1.1, 15, 0)), B("metal", 1.4, 0.5, 0.05, (0.5, 14.35, 0.4))]
    p.append(place(lathe("white", [(0.0, -0.32), (0.45, -0.25), (0.75, -0.08), (0.82, 0.0)], 12), (-0.6, 12, 0), (0, 0, math.pi / 2)))
    p.append(C("metal", 0.05, 0.05, 0.6, 5, (-0.95, 12, 0), (0, 0, math.pi / 2)))
    hut = [B("hut", 2.2, 1.8, 1.8, (1.6, 0.9, 1.6)), B("roofDark", 2.4, 0.12, 2.0, (1.6, 1.86, 1.6)), B("roofSnow", 2.3, 0.1, 1.9, (1.6, 1.96, 1.6)),
           B("logDark", 0.8, 1.5, 0.06, (1.6, 0.75, 2.52)), B("metal", 0.5, 0.3, 0.06, (2.2, 1.4, 2.52))]
    return [finish(p + hut, "mast")]


BUILD = {
    "rs_chalet": lambda: chalet(6.0, 5.0, 2, 2),
    "rs_chalet_wide": lambda: chalet(10.0, 7.5, 2, 3),
    "rs_chalet_small": lambda: chalet(4.0, 3.5, 1, 2),
    "rs_chapel": chapel,
    "rs_cabin": cabin,
    "rs_boathouse": boathouse,
    "rs_barrier_hut": barrier_hut,
    "rs_garage": garage,
    "rs_hangar": hangar,
    "rs_equipment": equipment,
    "rs_doghouse": doghouse,
    "rs_mast": mast,
}
objs = BUILD[asset]()
bpy.ops.wm.save_as_mainfile(filepath=A["out"])
tris = {o.name: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs}
print(f"{asset}: {sum(tris.values())} tris {tris}")
