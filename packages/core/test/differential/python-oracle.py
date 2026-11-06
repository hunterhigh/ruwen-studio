"""Test-only adapter: invoke untouched upstream code with a fixed clock."""
import datetime as datetime_module
import json
from pathlib import Path
import runpy
import sys

# -I ignores PYTHONUTF8/PYTHONIOENCODING; make protocol pipes explicit.
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

OriginalDateTime = datetime_module.datetime


class FixedDateTime(OriginalDateTime):
    @classmethod
    def now(cls, tz=None):
        value = cls(2026, 11, 6, 0, 0, 0, 123000, tzinfo=datetime_module.timezone.utc)
        return value.astimezone(tz) if tz else value.replace(tzinfo=None)


datetime_module.datetime = FixedDateTime
scripts = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(scripts))
name = sys.argv[2]
arguments = sys.argv[3:]
if name == "approval-api":
    import approval_record
    operation, root_value, event_value = arguments
    root = Path(root_value)
    event = json.loads((root / event_value).read_text(encoding="utf-8"))
    event_id = event["id"]
    pending = root / approval_record.USAGE_RELATIVE / f".{event_id}.pending"
    final = root / approval_record.USAGE_RELATIVE / f"{event_id}.json"
    try:
        if operation == "reserve":
            result = approval_record.reserve_event(root, event, consumer="gushi-gousishi")
            result = {**result, "pending_path": str(result["pending_path"]), "final_path": str(result["final_path"])}
        elif operation == "commit":
            result = approval_record.commit_reservation({"entry": json.loads(pending.read_text(encoding="utf-8")), "pending_path": pending, "final_path": final})
        elif operation == "rollback":
            approval_record.rollback_reservation({"pending_path": pending})
            result = None
        else:
            result = approval_record.consume_event(root, event, consumer="gushi-gousishi")
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except ValueError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(2)
else:
    sys.argv = [str(scripts / f"{name}.py"), *arguments]
    runpy.run_path(sys.argv[0], run_name="__main__")
