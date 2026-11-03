"""Tiny driver: call any GITCRAFT MCP server tool from Python (python gcx.py <server> <tool> '<json>')."""
import json, os, sys
sys.path.insert(0, os.path.join(os.environ.get("GITCRAFT_REPO", "/home/user/GITCRAFT"), "tests"))
from mcp_client import Client  # GITCRAFT's own stdio MCP client
MCP = os.path.expanduser("~/.gitcraft/runtime/scripts/mcp.sh")
GITCRAFT = os.environ.get("GITCRAFT_REPO", "/home/user/GITCRAFT")
PROD = os.environ.get("ROCKSLIDE_PRODUCTION", "/home/user/rockslide-production")
os.makedirs(PROD, exist_ok=True)
_c = {}
def client(tool):
    if tool not in _c:
        _c[tool] = Client([MCP, tool], log=os.path.join(PROD, f"{tool}.stderr.log"), cwd="/home/user")
    return _c[tool]
def call(tool, name, args=None, timeout=1800):
    ok, v = client(tool).call(name, args or {}, timeout)
    return ok, v
if __name__ == "__main__":
    tool, name = sys.argv[1], sys.argv[2]
    a = sys.argv[3] if len(sys.argv) > 3 else "{}"
    if a.startswith("@"): a = open(a[1:]).read()
    ok, v = call(tool, name, json.loads(a))
    print(json.dumps({"ok": ok, "result": v}, indent=1) if not isinstance(v, str) else json.dumps({"ok": ok}) + "\n" + v)
