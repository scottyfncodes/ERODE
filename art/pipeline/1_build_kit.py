"""ROCKSLIDE x GITCRAFT production pipeline: MeshCraft builds, previews, exports, validates and engine-checks the Kessel kit.
Runs GITCRAFT servers through scripts/mcp.sh (guard + Landlock sandbox), via gcx.py.
Outputs go to $ROCKSLIDE_PRODUCTION (default ~/../rockslide-production, inside the GITCRAFT roots)."""
import json, os, sys, time
import gcx as g  # noqa
W = "/home/user/rockslide-production/3d"
R = "/home/user/ROCKSLIDE/art"
PAL = f"{R}/rockslide-palette.json"
SCRIPT = f"{R}/3d/scripts/kessel_kit.py"
assets = sys.argv[1:] or ["rs_crag_a","rs_crag_b","rs_crag_c","rs_boulder_a","rs_boulder_b","rs_stump","rs_deadfall","rs_akja","rs_cache"]
report = {}
for a in assets:
    t0 = time.time(); d = f"{W}/{a}"; os.makedirs(f"{d}/source", exist_ok=True)
    blend = f"{d}/source/{a}.blend"; rec = {}
    ok, r = g.call("meshcraft", "run_script", {"path": SCRIPT, "args": {"asset": a, "palette": PAL, "out": blend}})
    rec["build"] = r if not ok else r.get("stdout", "").strip()
    if not ok: print(a, "BUILD FAIL", r); report[a] = rec; continue
    ok, r = g.call("meshcraft", "render_preview", {"blend": blend, "out_dir": f"{d}/previews", "size": 384, "views": ["three_quarter", "front", "top"]})
    rec["preview"] = r if ok else ("FAIL", r)
    ok, r = g.call("meshcraft", "export_asset", {"blend": blend, "profiles": ["three-web-toon"], "out_dir": f"{d}/exports"})
    rec["export"] = r if ok else ("FAIL", r)
    glb = rec["export"][0]["path"] if isinstance(rec["export"], list) else f"{d}/exports/asset.three-web-toon.glb"
    ok, r = g.call("meshcraft", "validate_asset", {"blend": blend, "exports": [glb], "profiles": ["three-web-toon"]})
    rec["validate"] = r if ok else ("FAIL", r)
    ok, r = g.call("meshcraft", "engine_check", {"glb": glb, "out": f"{d}/engine.png", "size": 384})
    rec["engine"] = r if ok else ("FAIL", r)
    rec["seconds"] = round(time.time() - t0, 1)
    v = rec["validate"]
    summ = v.get("summary") if isinstance(v, dict) else v
    eng = [c["level"] for c in rec["engine"].get("checks", [])] if isinstance(rec["engine"], dict) else rec["engine"]
    print(a, rec["build"], "| validate:", json.dumps(summ)[:200], "| engine:", eng, "|", rec["seconds"], "s", flush=True)
    report[a] = rec
json.dump(report, open(f"{W}/build-report-{int(time.time())}.json", "w"), indent=1, default=str)
