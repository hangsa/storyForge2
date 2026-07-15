"""Async runner + helpers for AutopilotRunner wiring.

Spec: docs/superpowers/specs/2026-07-14-v1.9-autopilot-runner-wiring-design.md
§§3, 5. This file is intentionally thin: pure helpers + a small Protocol.
The production executor lives in `backend/conductor/stage4_async_executor.py`
and the loop-bookkeeping in `backend/conductor/autopilot_loop.py`.
"""
from __future__ import annotations

import asyncio
from typing import Optional, Protocol

from backend.models.autopilot_session import (
    CurrentTask, ManagedStartConfig, QueueItem, SessionState,
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


class AsyncAutopilotRunner:
    """Drives the session queue. Exits when state != running or queue empty."""

    def __init__(
        self,
        mgr: "AutopilotSessionManager",
        executor: AsyncTaskExecutor,
        cadence: str = "balanced",
    ) -> None:
        self._mgr = mgr
        self._executor = executor
        self._cadence_delay = CADENCE_DELAYS.get(cadence, CADENCE_DELAYS["balanced"])

    def _pick_next(self, queue: list) -> Optional[QueueItem]:
        if not queue:
            return None
        return min(queue, key=lambda q: q.priority)

    async def run(self) -> None:
        """Main loop. Exits on state != running, or when queue is exhausted
        (auto-stop in that case)."""
        while True:
            # Layer 1 fix: keep last_heartbeat_at fresh so recover_running_sessions
            # can detect a dead runner. Without this the field is always null and
            # the stale-session downgrade never fires. Called once per iteration
            # (each iteration already has asyncio.sleep(self._cadence_delay)
            # = 0.5/2/5s, well under the 30s staleness threshold).
            self._mgr.heartbeat()
            s = self._mgr.load()
            if s is None or s.state != SessionState.RUNNING:
                return
            item = self._pick_next(s.queue)
            if item is None:
                self._mgr.stop()
                return
            await self._step_one(item, project_id=s.project_id)
            await asyncio.sleep(self._cadence_delay)

    async def _step_one(self, item: QueueItem, project_id: str) -> dict:
        """One iteration. Mirrors sync runner.step() but async + task_fail branch."""
        task = CurrentTask(
            kind=item.kind,
            chapter_number=item.chapter_number,
            scene_id=None,
            status="active",
            started_at=None,  # manager fills in if it cares
            description=f"{item.kind} (chapter {item.chapter_number})",
            progress_pct=0,
        )
        self._mgr.set_current_task(task)

        try:
            result = await self._executor.execute(item, project_id=project_id)
        except Exception as e:
            self._mgr.fail_current_task(error=str(e))
            self._mgr.drop_queue(item.id)
            return {"picked": item.id, "completed": False, "error": str(e)}

        # Success path: drop queue item + complete current_task.
        self._mgr.drop_queue(item.id)
        self._mgr.complete_current_task()

        # Circuit breaker: only on force_passed scenes (spec §5 row 2).
        # Delegate to mgr.record_force_pass_internal() which encapsulates the
        # increment + threshold-check + circuit_open transition in one
        # write-through (matches the existing sync runner's record_force_pass).
        scene_status = result.get("scene_status") if isinstance(result, dict) else None
        if scene_status == "force_passed":
            self._mgr.record_force_pass_internal()

        return {"picked": item.id, "completed": True, "result": result}
