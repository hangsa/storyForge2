from __future__ import annotations
import json
import logging
from collections import deque

from backend.config import settings

logger = logging.getLogger(__name__)

USAGE_PATH = settings.projects_dir.parent / "llm_usage.jsonl"
# Over-read by 2x to give malformed/blank-line skip some headroom without
# pulling the entire (unbounded) append-only log into memory.
_READ_BUFFER_MULTIPLIER = 2


def read_recent(limit: int = 50) -> list[dict]:
    """Return the most recent `limit` records from llm_usage.jsonl.
    Empty / malformed JSON lines are skipped without aborting.
    Memory bounded by O(limit) regardless of file size.
    """
    if not USAGE_PATH.is_file():
        return []
    try:
        with open(USAGE_PATH, "r", encoding="utf-8", errors="replace") as f:
            tail = deque(f, maxlen=limit * _READ_BUFFER_MULTIPLIER)
    except OSError as e:
        logger.warning("Failed to read usage log %s: %s", USAGE_PATH, e)
        return []
    out: list[dict] = []
    for line in reversed(tail):
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
