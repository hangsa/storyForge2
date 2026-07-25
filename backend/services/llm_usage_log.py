from __future__ import annotations
import json

from backend.config import settings

USAGE_PATH = settings.projects_dir.parent / "llm_usage.jsonl"


def read_recent(limit: int = 50) -> list[dict]:
    """Return the most recent `limit` records from llm_usage.jsonl.
    Bad JSON lines are skipped (do not abort the read).
    """
    if not USAGE_PATH.is_file():
        return []
    try:
        with open(USAGE_PATH, "r", encoding="utf-8") as f:
            lines = f.readlines()
    except OSError:
        return []
    out: list[dict] = []
    for line in reversed(lines[-limit * 4 :]):
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        out.append(rec)
        if len(out) >= limit:
            break
    return out
