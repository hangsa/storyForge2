"""Async runner + helpers for AutopilotRunner wiring.

Spec: docs/superpowers/specs/2026-07-14-v1.9-autopilot-runner-wiring-design.md
§§3, 5. This file is intentionally thin: pure helpers + a small Protocol.
The production executor lives in `backend/conductor/stage4_async_executor.py`
and the loop-bookkeeping in `backend/conductor/autopilot_loop.py`.
"""
from __future__ import annotations

from typing import Optional, Protocol

from backend.models.autopilot_session import (
    ManagedStartConfig, QueueItem, SessionState,
)


DONE_STATUSES = frozenset({"completed", "force_passed", "skipped"})


class AsyncTaskExecutor(Protocol):
    """The runner only knows this Protocol. Production: AsyncStage4Executor.
    Tests: FakeStage4Executor."""

    async def execute(self, item: QueueItem, project_id: str) -> dict:
        ...


CADENCE_DELAYS = {"fast": 0.5, "balanced": 2.0, "careful": 5.0}


def is_chapter_complete(
    progress_scenes: list,
    expected_scene_plan: list,
) -> bool:
    """Spec §5 rule rows 5, 6, 7. Pure — no I/O.

    A chapter is complete when, for every scene in the outline (in order),
    the matching progress entry exists with a status in {completed, force_passed,
    skipped}. Extra progress entries beyond the outline's length are ignored
    (defensive against outline edits mid-run).
    """
    if not expected_scene_plan:
        return True  # nothing planned → trivially done
    plan_nums = [s.get("scene_number") for s in expected_scene_plan]
    progress_by_num = {
        s.get("scene_number"): s.get("status")
        for s in progress_scenes
    }
    for n in plan_nums:
        status = progress_by_num.get(n)
        if status not in DONE_STATUSES:
            return False
    return True
