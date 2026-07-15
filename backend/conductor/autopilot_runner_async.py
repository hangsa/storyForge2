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


def seed_queue(
    mgr: "AutopilotSessionManager",
    outline: dict,
    progress: Optional[dict],
    novel_outline: Optional[dict],
    cfg: ManagedStartConfig,
) -> int:
    """Translate (outline, progress, novel_outline, cfg) into QueueItems
    appended to mgr.queue. Returns count of items enqueued.

    Pure-ish: the only side effect is `mgr.add_queue(...)` (which writes
    session.json). No HTTP, no LLM, no executor.
    """
    if not outline or not outline.get("chapters"):
        return 0
    progress = progress or {}
    chapters = progress.get("chapters", []) or []
    progress_by_chapter = {
        ch.get("chapter_number"): ch for ch in chapters
    }
    current_chapter = progress.get("current_chapter", 1)

    # Decide which chapters to enqueue based on scope.
    all_chapters = outline["chapters"]
    if cfg.scope == "next_chapter":
        target_chapters = [
            ch for ch in all_chapters
            if ch.get("chapter_number") == current_chapter
        ]
    else:  # "all_planned"
        target_chapters = list(all_chapters)

    seeded = 0
    for ch in target_chapters:
        ch_num = ch.get("chapter_number")
        scene_plan = ch.get("scene_plan", []) or []
        if not scene_plan:
            continue
        ch_progress = progress_by_chapter.get(ch_num, {})
        done_nums = {
            s.get("scene_number")
            for s in ch_progress.get("scenes", []) or []
            if s.get("status") in DONE_STATUSES
        }
        for s in scene_plan:
            n = s.get("scene_number")
            if n in done_nums:
                continue
            item = QueueItem(
                id=f"write-{ch_num}-{n}",
                kind="write_scene",
                chapter_number=ch_num,
                scheduled_at=None,
                priority=20 + n,   # archival uses priority 10 (lower = earlier)
                payload={"scene_number": n},
            )
            mgr.add_queue(item)
            seeded += 1
    return seeded
