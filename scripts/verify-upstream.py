"""Run upstream tests on a temporary copy; never write into vendor."""

from pathlib import Path
import io
import os
import subprocess
import sys
import tarfile
import tempfile


def main() -> int:
    upstream = Path(__file__).resolve().parents[1] / "vendor/ruwen"
    plugin = "01-完整插件/ruwen-xiezuo-xitong"
    # git archive preserves committed bytes despite Windows core.autocrlf.
    archived = subprocess.run(
        ["git", "-C", str(upstream), "archive", "--format=tar", "HEAD", plugin],
        check=True,
        capture_output=True,
    ).stdout
    with tempfile.TemporaryDirectory(prefix="ruwen-upstream-") as temporary:
        with tarfile.open(fileobj=io.BytesIO(archived)) as archive:
            archive.extractall(temporary, filter="data")
        copied = Path(temporary) / plugin
        environment = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "PYTHONUTF8": "1"}
        # Upstream test subprocesses use sys.executable and sibling imports.
        # The outer wrapper is isolated; the unmodified suite runs on its copy.
        result = subprocess.run(
            [sys.executable, "-B", str(copied / "scripts/test_ruwen_v5.py"), "-v"],
            cwd=copied,
            env=environment,
            check=False,
        )
        return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
