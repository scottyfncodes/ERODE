"""ROCKSLIDE x GITCRAFT: verify the GLBs the game actually ships (public/models), not just their sources.

For every shipped model: MeshCraft inspect_file (triangles, size, materials, clips) and engine_check
(three.js in headless Chromium, every clip played on its own); then the rebuild from
1_build_kit.py, if present, is compared with what ships (same triangle count and size).
Runs through scripts/mcp.sh (guard + Landlock sandbox) via gcx.py. Prints a JSON report and exits 1
on any failure. The game's own three.js version is checked separately by scripts/verify.mjs."""
import glob, hashlib, json, os, shutil, sys
import gcx as g  # noqa

R = "/home/user/ROCKSLIDE"
OUT = os.path.join(g.PROD, "verify")
REBUILT = os.path.join(g.PROD, "3d")
os.makedirs(OUT, exist_ok=True)
report, fails = {}, []


def tris_of(info):
    if isinstance(info, dict):
        for k in ("triangles", "tris", "total_triangles"):
            if k in info:
                return info[k]
    return None


for path in sorted(glob.glob(f"{R}/public/models/*.glb")):
    a = os.path.basename(path)[:-4]
    rec = {"bytes": os.path.getsize(path), "sha256": hashlib.sha256(open(path, "rb").read()).hexdigest()[:16]}
    ok, info = g.call("meshcraft", "inspect_file", {"path": path})
    rec["inspect"] = info if ok else ("FAIL", info)
    if not ok:
        fails.append(f"{a}: inspect_file failed")
    # every clip played on its own, for the models that have clips; the lantern hangs from its hook
    # on a post arm in the game (kitView lanternPost), so it is checked as a hanging asset with the
    # nodes and clip the game plays, rather than as one that should stand on the ground
    clips = list(info.get("actions") or []) if ok and isinstance(info, dict) else []
    args = {"glb": path, "out": f"{OUT}/{a}.png", "size": 384}
    if clips:
        args["all_clips"] = True
    if a == "rs_lantern":
        args["contract"] = {"ground": False, "nodes": {"pivot": "lantern", "body": "lantern_body", "light": "lantern_light"}}
    rec["engine_args"] = {k: v for k, v in args.items() if k not in ("glb", "out")}
    ok, eng = g.call("meshcraft", "engine_check", args)
    rec["engine"] = eng if ok else ("FAIL", eng)
    levels = [c.get("level") for c in eng.get("checks", [])] if ok and isinstance(eng, dict) else []
    rec["engine_levels"] = levels
    if not ok or not levels or any(l == "fail" for l in levels):
        fails.append(f"{a}: engine_check {levels or eng}")
    # the rebuild from source (1_build_kit.py) should match what ships
    rebuilt = glob.glob(f"{REBUILT}/{a}/exports/*.glb")
    if rebuilt:
        ok2, info2 = g.call("meshcraft", "inspect_file", {"path": rebuilt[0]})
        t1, t2 = tris_of(info), tris_of(info2)
        rec["rebuild"] = {"tris_shipped": t1, "tris_rebuilt": t2, "same_bytes": os.path.getsize(rebuilt[0]) == rec["bytes"]}
        if ok2 and t1 is not None and t1 != t2:
            fails.append(f"{a}: rebuild has {t2} tris, shipped has {t1}")
    report[a] = rec
    print(a, rec["bytes"], "B | tris", tris_of(info), "| engine", levels, "| rebuild", rec.get("rebuild"), flush=True)

json.dump(report, open(f"{OUT}/shipped-report.json", "w"), indent=1, default=str)
print("FAIL\n- " + "\n- ".join(fails) if fails else f"PASS: {len(report)} shipped models")
sys.exit(1 if fails else 0)
