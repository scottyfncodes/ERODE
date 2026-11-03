"""ROCKSLIDE x GITCRAFT production pipeline: ForgeCraft ingests the kit into the 3D library; MeshCraft builds the lantern template.
Runs GITCRAFT servers through scripts/mcp.sh (guard + Landlock sandbox), via gcx.py.
Outputs go to $ROCKSLIDE_PRODUCTION (default ~/../rockslide-production, inside the GITCRAFT roots)."""
import json, os, glob
import gcx as g  # noqa
W="/home/user/rockslide-production"; out={}
ids = ["rs_crag_a","rs_crag_b","rs_crag_c","rs_boulder_a","rs_boulder_b","rs_stump","rs_deadfall","rs_akja","rs_cache"]
for a in ids:
    glb=f"{W}/3d/{a}/exports/asset.three-web-toon.glb"
    ok,r=g.call("forgecraft","process_mesh",{"input":glb,"name":a,"asset_id":a,"profiles":["three-web-toon"],"tags":["rockslide","kessel-kit","run_script"],"handoff_dir":f"{W}/handoff"})
    out[a]=r; print(a, ok, json.dumps(r)[:300] if not ok else json.dumps({k:r.get(k) for k in ("status","library","job","handoff")})[:400], flush=True)
brief={"asset_id":"rs_lantern","template":"lantern","params":{"height":0.46,"sides":6,"swing_deg":5,"swing_seconds":2.6},
 "palette":"/home/user/ROCKSLIDE/art/rockslide-palette.json","roles":{"cap":"Slate Ink","frame":"Steel Dark","glass":"Lamp Glow","flame":"Pole Orange","base":"Slate Ink"},
 "material_prefix":"RS","out_dir":f"{W}/3d/rs_lantern","profiles":["three-web-toon"],"preview":{"size":384,"views":["three_quarter","front"]},
 "manifest":"/home/user/ROCKSLIDE/art/MANIFEST.json"}
ok,r=g.call("meshcraft","run_pipeline",{"brief":brief})
out["rs_lantern"]=r; print("rs_lantern", ok, json.dumps(r)[:1500] if not ok else json.dumps({"summary":r.get("validation",{}).get("summary"),"library":r.get("library"),"exports":[e["path"] for e in r.get("exports",[])]}))
if ok:
    glb=[e["path"] for e in r["exports"] if e.get("format")=="glb"][0]
    ok2,e=g.call("meshcraft","engine_check",{"glb":glb,"clip":"swing","time":0.6,"out":f"{W}/3d/rs_lantern/engine.png","size":384})
    print("lantern engine", [c["level"] for c in e.get("checks",[])] if ok2 else e)
json.dump(out,open(f"{W}/forge-report.json","w"),indent=1,default=str)
