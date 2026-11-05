"""ROCKSLIDE x GITCRAFT: build, preview, export, validate and engine-check models from a ROCKSLIDE
MeshCraft script, then (with --ship) copy the main GLB into public/models/.

  python3 8_build_models.py <script> <asset> [<asset> ...] [--ship]
  e.g. python3 8_build_models.py valley_buildings rs_lodge rs_lodge_wing rs_lodge_furniture --ship

Runs MeshCraft through scripts/mcp.sh (guard + sandbox) via gcx.py. Work files go to
gitcraft-out/3d/<asset>/ inside the repo (git-ignored; MeshCraft may only write inside the workspace)."""
import json, os, shutil, sys, time
os.environ.setdefault("GITCRAFT_REPO", os.path.expanduser("~/.gitcraft/repo"))
R = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
os.environ.setdefault("ROCKSLIDE_PRODUCTION", f"{R}/gitcraft-out")
import gcx as g  # noqa: E402

W = f"{R}/gitcraft-out/3d"
PAL = f"{R}/art/rockslide-palette.json"
args = [a for a in sys.argv[1:] if not a.startswith("--")]
ship = "--ship" in sys.argv
# --sunk: the model stands in the snow as the code's did (a plinth below y = 0), so it is not checked for
# a base on the ground
sunk = "--sunk" in sys.argv
script = f"{R}/art/3d/scripts/{args[0]}.py"
fails = []
for a in args[1:]:
    t0 = time.time(); d = f"{W}/{a}"; os.makedirs(f"{d}/source", exist_ok=True)
    blend = f"{d}/source/{a}.blend"
    ok, r = g.call("meshcraft", "run_script", {"path": script, "args": {"asset": a, "palette": PAL, "out": blend}})
    if not ok: print(a, "BUILD FAIL", r); fails.append(a); continue
    print(a, (r.get("stdout", "") if isinstance(r, dict) else r).strip()[-300:])
    g.call("meshcraft", "render_preview", {"blend": blend, "out_dir": f"{d}/previews", "size": 512, "views": ["three_quarter", "front", "back_three_quarter", "top"]})
    ok, ex = g.call("meshcraft", "export_asset", {"blend": blend, "profiles": ["three-web-toon"], "out_dir": f"{d}/exports"})
    if not ok: print(a, "EXPORT FAIL", ex); fails.append(a); continue
    glbs = [e["path"] for e in ex if isinstance(e, dict) and str(e.get("path", "")).endswith(".glb")] if isinstance(ex, list) else []
    glb = next((p for p in glbs if ".lod" not in p and ".collision" not in p), f"{d}/exports/{a}.three-web-toon.glb")
    ok, v = g.call("meshcraft", "validate_asset", {"blend": blend, "exports": [glb], "profiles": ["three-web-toon"]})
    summ = v.get("summary") if ok and isinstance(v, dict) else v
    ok, e = g.call("meshcraft", "engine_check", {"glb": glb, "out": f"{d}/engine.png", "size": 512, **({"contract": {"ground": False}} if sunk else {})})
    levels = [c.get("level") for c in e.get("checks", [])] if ok and isinstance(e, dict) else ["fail"]
    if "fail" in levels: fails.append(a)
    print(a, "| validate:", json.dumps(summ)[:400], "| engine:", levels, "|", round(time.time() - t0, 1), "s", flush=True)
    if ship:
        shutil.copyfile(glb, f"{R}/public/models/{a}.glb")
        print(a, "-> public/models/", os.path.getsize(f"{R}/public/models/{a}.glb"), "bytes")
print("FAIL: " + ", ".join(fails) if fails else "PASS")
sys.exit(1 if fails else 0)
