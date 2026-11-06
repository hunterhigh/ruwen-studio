"""Snapshot canonical upstream template and regex data; never modify vendor."""
import ast
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import base64

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = ROOT / "vendor/ruwen"
PLUGIN = "01-完整插件/ruwen-xiezuo-xitong"


def source(relative):
    return subprocess.run(["git", "-C", str(UPSTREAM), "show", f"HEAD:{PLUGIN}/{relative}"], check=True, capture_output=True).stdout


def value(tree, name):
    return next(node.value for node in tree.body if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets))


def pattern(raw, dotall=False):
    flags = "us" if dotall else "u"
    if "(?i" in raw:
        flags += "i"
    if "(?m" in raw or "(?im" in raw:
        flags += "m"
    converted = re.sub(r"\(\?[im]+\)", "", raw).replace("(?i:", "(?:")
    converted = converted.replace(r'\"', '"').replace(r"\'", "'")
    return {"pattern": converted, "flags": flags}


archive_bytes = subprocess.run(["git", "-C", str(UPSTREAM), "archive", "HEAD", f"{PLUGIN}/assets/project-template"], check=True, capture_output=True).stdout
files = {}
with tarfile.open(fileobj=io.BytesIO(archive_bytes)) as archive:
    for member in archive.getmembers():
        if member.isfile():
            handle = archive.extractfile(member)
            files[member.name.removeprefix(f"{PLUGIN}/assets/project-template/")] = base64.b64encode(handle.read()).decode("ascii")
state = ast.parse(source("scripts/story_state.py"))
closure = ast.parse(source("scripts/closure_audit.py"))
checks = ast.literal_eval(value(closure, "CHECKS"))
contamination = []
for item in value(state, "CONTAMINATION_PATTERNS").elts:
    contamination.append({**pattern(ast.literal_eval(item.elts[0].args[0])), "label": ast.literal_eval(item.elts[1])})
silent = [pattern(ast.literal_eval(item.args[0])) for item in value(state, "SILENT_FLOOR_PATTERNS").elts]
bundle = {
    "commit": subprocess.run(["git", "-C", str(UPSTREAM), "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip(),
    "files": files,
    "soul": source("skills/ruwen-zhangjie-xiezuo/CREATIVE-SOUL.md").decode("utf-8"),
    "contamination": contamination,
    "silent": silent,
    "closure": {key: [pattern(raw, True) for raw in raws] for key, raws in checks.items()},
}
destination = ROOT / "packages/core/assets/upstream-bundle.json"
destination.parent.mkdir(parents=True, exist_ok=True)
checking = "--check" in sys.argv
if checking:
    if json.loads(destination.read_text(encoding="utf-8")) != bundle:
        raise SystemExit("Core asset snapshot does not match pinned upstream")
else:
    destination.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
print(f"Captured {len(files)} canonical template files at {bundle['commit']}")

tests = ast.parse(source("scripts/test_ruwen_v5.py"))
test_class = next(node for node in tests.body if isinstance(node, ast.ClassDef) and node.name == "RuwenV5Tests")
ready = next(node for node in test_class.body if isinstance(node, ast.FunctionDef) and node.name == "make_ready")
resources = {}
for node in ast.walk(ready):
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "update_resource":
        resources[ast.literal_eval(node.args[0])] = ast.literal_eval(node.args[1])
fixture = ROOT / "packages/core/test/fixtures/ready-resources.json"
fixture.parent.mkdir(parents=True, exist_ok=True)
if checking:
    if json.loads(fixture.read_text(encoding="utf-8")) != resources:
        raise SystemExit("Ready-resource fixture does not match pinned upstream")
else:
    fixture.write_text(json.dumps(resources, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
