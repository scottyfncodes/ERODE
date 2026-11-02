"""ROCKSLIDE: Mountain Patrol, the Kessel valley environment kit (MeshCraft run_script).

Run inside MeshCraft's Blender (globals: bpy, kit, args, Palette):
  run_script {"path": ".../kessel_kit.py", "args": {"asset": "rs_crag_a", "palette": ".../rockslide-palette.json", "out": ".../source/rs_crag_a.blend"}}

Every asset is low-poly and faceted to sit beside the game's own "miniature kit" (chunky primitives,
flat colour, clear silhouettes). Colours are Rockslide palette roles baked into the Color attribute
(glTF COLOR_0), so the game shades them with its own lighting and toon banding.
Blender is Z-up with the front facing -Y; glTF/three.js gets +Y up, front +Z.
"""
import math, random
from mathutils import Vector, noise

A = args  # noqa: F821  (injected by MeshCraft)
pal = Palette.from_file(A["palette"])  # noqa: F821
asset = A["asset"]

kit.reset()  # noqa: F821
ROCK_ROLES = {"rock": "Granite", "rockdark": "Granite Dark", "rocklight": "Granite Light", "lichen": "Lichen",
              "rust": "Rust Stain", "snow": "Kessel Snow", "shade": "Snow Shade"}


def set_mats(o, mats, roles):
    o.data.materials.clear()
    for r in roles: o.data.materials.append(mats[r])
    return {r: i for i, r in enumerate(roles)}


def paint_rock(o, mats, seed, snow_line=0.6, top=1.0):
    """Faces looking up take snow (more of it higher up); the rest is granite with dark overhangs,
    light edges, lichen and a little rust staining."""
    idx = set_mats(o, mats, list(ROCK_ROLES))
    rng = random.Random(seed)
    for p in o.data.polygons:
        n, c = p.normal, p.center
        h = max(0.0, c.z) / max(0.01, top)
        wob = noise.noise(c * 0.9 + Vector((seed, 0, 0))) * 0.18
        if n.z > snow_line - 0.25 * h + wob:
            p.material_index = idx["snow"] if n.z > 0.5 or rng.random() > 0.35 else idx["shade"]
        elif n.z < -0.15:
            p.material_index = idx["rockdark"]
        else:
            r = rng.random()
            p.material_index = idx["lichen"] if (r < 0.1 and n.z > -0.05) else idx["rust"] if r < 0.14 else idx["rocklight"] if r < 0.32 else idx["rock"]


def craggy(o, seed, strata=0.55, amp=0.35, floor=-0.7):
    """Noise displacement, horizontal strata (the bedding of the granite), and a flat base sunk below ground."""
    off = Vector((seed * 1.7, seed * 0.3, seed * 2.1))
    def f(v):
        d = noise.noise(v * 0.45 + off) * amp + noise.noise(v * 1.3 + off) * amp * 0.35
        v = v + v.normalized() * d if v.length > 1e-4 else v
        if strata: v.z = v.z + (round(v.z / strata) * strata - v.z) * 0.55
        v.z = max(v.z, floor)
        return v
    kit.deform(o, f)  # noqa: F821


def crag(seed, blocks, spread, height):
    mats = kit.Materials(pal, ROCK_ROLES, prefix="RS")  # noqa: F821
    rng = random.Random(seed)
    parts = []
    for i in range(blocks):
        k = 1.0 - i / (blocks * 1.6)
        r = rng.uniform(0.75, 1.05) * height * 0.55 * k
        loc = (rng.uniform(-spread, spread) * (0.4 + i / blocks), rng.uniform(-spread, spread) * 0.55, r * rng.uniform(0.05, 0.45))
        # tall, blocky tors: granite weathers into stacked, upright blocks rather than rounded heaps
        sc = (rng.uniform(0.8, 1.2), rng.uniform(0.6, 0.95), rng.uniform(1.25, 1.9))
        b = kit.ico(f"blk{i}", r, loc, mats["rock"], sub=1, scale=sc, seed=seed * 31 + i, wobble=0.16)  # noqa: F821
        b.rotation_euler = (rng.uniform(-0.12, 0.12), rng.uniform(-0.12, 0.12), rng.uniform(0, math.pi))
        parts.append(b)
    o = kit.join(parts, asset)  # noqa: F821
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o  # noqa: F821
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)  # noqa: F821
    craggy(o, seed, strata=height * 0.2, amp=height * 0.07, floor=-0.9)
    top = max(v.co.z for v in o.data.vertices)
    paint_rock(o, mats, seed, snow_line=0.78, top=top)
    return o, mats


def boulder(seed, size):
    mats = kit.Materials(pal, ROCK_ROLES, prefix="RS")  # noqa: F821
    o = kit.ico(asset, size * 0.5, (0, 0, size * 0.22), mats["rock"], sub=2, scale=(1.25, 1.0, 0.78), seed=seed, wobble=0.12)  # noqa: F821
    craggy(o, seed, strata=0, amp=size * 0.08, floor=-0.25)
    paint_rock(o, mats, seed, snow_line=0.66, top=size)
    return o, mats


def stump():
    mats = kit.Materials(pal, {"bark": "Log Dark", "grain": "End Grain", "snow": "Kessel Snow", "shade": "Snow Shade"}, prefix="RS")  # noqa: F821
    parts = [kit.cylinder("trunk", 0.36, 0.8, (0, 0, 0.3), verts=9, mat=mats["bark"], r2=0.31),  # noqa: F821
             kit.cylinder("cut", 0.305, 0.04, (0, 0, 0.71), verts=9, mat=mats["grain"])]  # noqa: F821
    for i in range(4):
        a = i * math.pi / 2 + 0.4
        root = kit.cylinder(f"root{i}", 0.13, 0.62, (0, 0, 0), axis="X", verts=5, mat=mats["bark"], r2=0.03)  # noqa: F821
        root.rotation_euler = (0, 0.55, a); root.location = (math.cos(a) * 0.36, math.sin(a) * 0.36, 0.12); parts.append(root)
    cap = kit.sphere("cap", 0.33, (0.03, 0, 0.74), mats["snow"], segs=9, rings=5, scale=(1.05, 1.0, 0.32))  # noqa: F821
    parts.append(cap)
    o = kit.join(parts, asset)  # noqa: F821
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o  # noqa: F821
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)  # noqa: F821
    return o, mats


def deadfall():
    mats = kit.Materials(pal, {"bark": "Log", "barkdark": "Log Dark", "grain": "End Grain", "snow": "Kessel Snow"}, prefix="RS")  # noqa: F821
    L = 5.6
    parts = [kit.cylinder("log", 0.3, L, (0, 0, 0.26), axis="X", verts=8, mat=mats["bark"], r2=0.22)]  # noqa: F821
    for s in (-1, 1):
        parts.append(kit.cylinder(f"end{s}", 0.3 if s < 0 else 0.22, 0.03, (s * L / 2, 0, 0.26), axis="X", verts=8, mat=mats["grain"]))  # noqa: F821
    rng = random.Random(5)
    for i in range(5):
        x = -L / 2 + 0.8 + i * 1.05
        a = rng.uniform(-0.9, 0.9) + (math.pi if i % 2 else 0)
        st = kit.cylinder(f"stub{i}", 0.06, 0.6, (x, math.sin(a) * 0.38, 0.26 + math.cos(a) * 0.38), verts=5, mat=mats["barkdark"], r2=0.03)  # noqa: F821
        st.rotation_euler = (a, 0, 0); parts.append(st)
    snow = kit.sphere("snow", 1.0, (0.1, 0, 0.5), mats["snow"], segs=12, rings=5, scale=(L * 0.47, 0.3, 0.14))  # noqa: F821
    parts.append(snow)
    o = kit.join(parts, asset)  # noqa: F821
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o  # noqa: F821
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)  # noqa: F821
    return o, mats


def akja():
    """The patrol's rescue toboggan: a red fibreglass shell with a raised bow, steel runners,
    hauling bars, cross-straps and a rolled casualty blanket. Front (bow) faces -Y."""
    mats = kit.Materials(pal, {"hull": "Patrol Red", "hulldark": "Patrol Red Deep", "cross": "Cross White", "steel": "Steel",  # noqa: F821
                               "strap": "Slate Ink", "blanket": "Caution Amber"}, prefix="RS")
    L, W, H = 2.3, 0.66, 0.3
    hull = kit.box("hull", (W, L, H), (0, 0, H / 2 + 0.04), mats["hull"], bevel=0.06, segs=2, taper=-0.12)  # noqa: F821
    def bow(v):
        y = v.y + L / 2
        if y < 0.55: v.z += (0.55 - y) ** 2 * 0.9
        if v.z < 0.1: v.x *= 0.82
        return v
    kit.deform(hull, bow)  # noqa: F821
    rim = kit.box("rim", (W + 0.06, L - 0.3, 0.05), (0, 0.12, H + 0.06), mats["hulldark"])  # noqa: F821
    inner = kit.box("inner", (W - 0.12, L - 0.55, 0.04), (0, 0.15, H + 0.07), mats["strap"])  # noqa: F821
    parts = [hull, rim, inner]
    for s in (-1, 1):
        parts.append(kit.box(f"runner{s}", (0.04, L - 0.2, 0.04), (s * W * 0.32, 0.08, 0.02), mats["steel"]))  # noqa: F821
        # the white cross on each flank
        parts += [kit.box(f"crossv{s}", (0.02, 0.09, 0.22), (s * (W / 2 + 0.065), 0.25, H * 0.62), mats["cross"]),  # noqa: F821
                  kit.box(f"crossh{s}", (0.02, 0.24, 0.08), (s * (W / 2 + 0.065), 0.25, H * 0.62), mats["cross"])]  # noqa: F821
        bar = kit.cylinder(f"bar{s}", 0.025, 0.7, (s * 0.24, L / 2 + 0.28, 0.34), axis="Y", verts=6, mat=mats["steel"])  # noqa: F821
        parts.append(bar)
    parts.append(kit.cylinder("handle", 0.03, 0.56, (0, L / 2 + 0.62, 0.34), axis="X", verts=6, mat=mats["steel"]))  # noqa: F821
    for y in (-0.45, 0.35):
        parts.append(kit.box(f"strap{y}", (W + 0.08, 0.07, 0.03), (0, y, H + 0.12), mats["strap"]))  # noqa: F821
    parts.append(kit.cylinder("blanket", 0.13, W - 0.14, (0, 0.72, H + 0.16), axis="X", verts=8, mat=mats["blanket"]))  # noqa: F821
    o = kit.join(parts, asset)  # noqa: F821
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o  # noqa: F821
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)  # noqa: F821
    return o, mats


def cache():
    """A patrol rescue cache: a red locker on steel legs with the white cross, snow on the lid,
    and a reflector so you can find it with a headlamp."""
    mats = kit.Materials(pal, {"box": "Patrol Red", "lid": "Patrol Red Deep", "cross": "Cross White", "steel": "Steel Dark",  # noqa: F821
                               "snow": "Kessel Snow", "glow": "Pole Orange"}, prefix="RS")
    parts = [kit.box("locker", (1.1, 0.62, 0.72), (0, 0, 0.98), mats["box"], bevel=0.03),  # noqa: F821
             kit.box("lid", (1.2, 0.72, 0.1), (0, 0, 1.38), mats["lid"], bevel=0.02),  # noqa: F821
             kit.box("snowcap", (1.14, 0.66, 0.12), (0, 0, 1.47), mats["snow"], bevel=0.05, taper=0.08),  # noqa: F821
             kit.box("crossv", (0.12, 0.02, 0.42), (0, -0.32, 0.98), mats["cross"]),  # noqa: F821
             kit.box("crossh", (0.42, 0.02, 0.12), (0, -0.32, 0.98), mats["cross"]),  # noqa: F821
             kit.box("reflector", (0.9, 0.02, 0.05), (0, -0.32, 0.7), mats["glow"])]  # noqa: F821
    for sx in (-0.45, 0.45):
        for sy in (-0.22, 0.22):
            parts.append(kit.box(f"leg{sx}{sy}", (0.07, 0.07, 0.66), (sx, sy, 0.31), mats["steel"]))  # noqa: F821
    o = kit.join(parts, asset)  # noqa: F821
    return o, mats


BUILD = {
    "rs_crag_a": lambda: crag(11, 5, 2.6, 4.2),
    "rs_crag_b": lambda: crag(23, 4, 1.8, 5.6),
    "rs_crag_c": lambda: crag(37, 6, 3.4, 3.2),
    "rs_boulder_a": lambda: boulder(3, 2.0),
    "rs_boulder_b": lambda: boulder(8, 1.3),
    "rs_stump": stump,
    "rs_deadfall": deadfall,
    "rs_akja": akja,
    "rs_cache": cache,
}

o, mats = BUILD[asset]()
# ground the asset and centre its footprint: the origin is the middle of the base, at ground level.
# (Crags and boulders are modelled with a flat base well below their visible shoulder; the game sinks
# them into the slope at placement time, so the file itself stays a clean, grounded asset.)
xs = [v.co.x for v in o.data.vertices]; ys = [v.co.y for v in o.data.vertices]; zs = [v.co.z for v in o.data.vertices]
shift = Vector((-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, -min(zs)))
o.data.transform(__import__("mathutils").Matrix.Translation(shift))
o.location = (0, 0, 0)
kit.shade(o)  # noqa: F821  flat: the faceted low-poly look of the rest of the valley
kit.bake_vertex_colors(o, mats, jitter=0.05, seed=len(asset))  # noqa: F821
o["gitcraft_asset"] = asset
tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
dims = tuple(round(d, 2) for d in o.dimensions)
bpy.ops.wm.save_as_mainfile(filepath=A["out"])  # noqa: F821
print(f"{asset}: {tris} tris, {dims} m, saved {A['out']}")
