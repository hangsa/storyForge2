"""Step state machine for Creative Canvas v2.

5 states: LOCKED / AVAILABLE / ACTIVE / COMPLETED / STALE
(SKIPPED is v2.1+; not in v2.0 MVP)

All state changes go through transition_step_state() to keep the rules
centralized (spec §4.2). _validate_step_invariants() catches structural
errors that any single endpoint might miss.
"""
from __future__ import annotations


class StepStateError(ValueError):
    """Raised when creative_path violates a structural invariant."""


def transition_step_state(canvas: dict, step: int | None = None, event: str = "") -> None:
    """Apply a transition event to creative_path.

    Events:
      - "init": all LOCKED; step 1 = AVAILABLE (special)
      - "activate": path[step-1] = ACTIVE
      - "complete": path[step-1] = COMPLETED; path[step] = AVAILABLE (if exists)
      - "backtrack_from": path[step-1..end] = STALE (v2.1; v2.0 unused)

    No-op when event is empty or unknown.
    """
    path = canvas.get("creative_path", [])
    if not path:
        return

    if event == "init":
        for p in path:
            p["state"] = "locked"
        path[0]["state"] = "available"
        return

    if step is None or step < 1 or step > len(path):
        return

    if event == "activate":
        path[step - 1]["state"] = "active"
    elif event == "complete":
        path[step - 1]["state"] = "completed"
        if step < len(path):
            path[step]["state"] = "available"
    elif event == "backtrack_from":
        for i in range(step - 1, len(path)):
            path[i]["state"] = "stale"


def _validate_step_invariants(canvas: dict) -> None:
    """Raise StepStateError on any violation (spec §4.3).

    Called by _validate_for_commit() before allowing a commit.
    """
    path = canvas.get("creative_path", [])

    if len(path) > 5:
        raise StepStateError(f"creative_path 超过 5 步: {len(path)}")

    if not path or path[0].get("step") != 1:
        raise StepStateError("creative_path 必须以 Step 1 开头")

    if any(p.get("state") == "stale" for p in path):
        raise StepStateError("存在 STALE 步骤,需要回溯处理")

    for p in path:
        if p.get("state") == "completed" and not p.get("selected_option_id"):
            raise StepStateError(
                f"Step {p.get('step')} COMPLETED 但无 selected_option_id"
            )
