"""Async runner + helpers for AutopilotRunner wiring.

Spec: docs/superpowers/specs/2026-07-14-v1.9-autopilot-runner-wiring-design.md
§§3, 5. This file is intentionally thin: pure helpers + a small Protocol.
The production executor lives in `backend/conductor/stage4_async_executor.py`
and the loop-bookkeeping in `backend/conductor/autopilot_loop.py`.
"""
from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Protocol

from backend.models.autopilot_session import (
    CurrentTask, ManagedStartConfig, QueueItem, SessionState,
)


logger = logging.getLogger(__name__)


DONE_STATUSES = frozenset({"completed", "force_passed", "skipped"})

# Retry-then-pause: a transient LLM hiccup (peer-closed, 5xx, rate limit)
# shouldn't kill the whole autopilot run. We retry the SAME scene up to
# SCENE_WRITE_MAX_RETRIES additional times with growing backoff; only when
# ALL attempts fail do we pause the session with `pause_reason` set so the
# user can intervene via the cockpit banner.
#
# Why 2 retries (3 total attempts): aligns with the existing Fact Guard
# CircuitBreaker.MAX_RETRIES=3 budget, gives the upstream LLM enough slack
# to recover from a transient blip, but doesn't burn the user's token
# budget on a permanently broken prompt. Bug 2026-07-22 proj_a601cee9:
# drop-on-fail left scenes stuck forever after a single dropped LLM
# connection.
SCENE_WRITE_MAX_RETRIES = 2
SCENE_WRITE_RETRY_BACKOFFS = (30, 60)  # seconds before retry #1, #2


# Row-major queue priority scheme: chapters are processed in chapter_number
# order; within a chapter, scenes run in scene_number order. The 1000x gap
# between chapter buckets leaves 998 scene slots plus one archival slot per
# chapter (well above any realistic outline). The archive slot sits after the
# chapter's scenes and before the next chapter's first scene.
#
# Invariants:
#   scene_priority(N, M) < scene_priority(N, M+1)        (within chapter)
#   scene_priority(N, last) < archive_priority(N)         (archival after last scene)
#   archive_priority(N) < scene_priority(N+1, 1)          (archival before next chapter)
#
# Why row-major (and not column-major as before):
#   - Aligns with StoryForge's per-chapter MemoryOS cache (L1/L4/L2 survive
#     across scenes in the same chapter). Column-major thrashes the cache
#     every scene → ~60% extra context-assembly overhead per the design doc.
#   - Net-novel authoring works chapter-by-chapter; writing ch31.scene_4
#     "knows" all of ch31 already exists.
#   - Eliminates the "ch32.scene_1 written before ch31.scene_4" forward-leak
#     where MemoryOS L2 was missing the just-prior chapter's summary.
PRIORITY_SCALE_PER_CHAPTER = 1000
ARCHIVE_PRIORITY_OFFSET = 999  # archive runs after all scenes in its chapter


def scene_priority(chapter_number: int, scene_number: int) -> int:
    """Lower = earlier. Row-major: chapter_number then scene_number."""
    return chapter_number * PRIORITY_SCALE_PER_CHAPTER + scene_number


def archive_priority(chapter_number: int) -> int:
    """Just above the chapter's last scene, below the next chapter's first scene."""
    return chapter_number * PRIORITY_SCALE_PER_CHAPTER + ARCHIVE_PRIORITY_OFFSET


@dataclass
class SeedResult:
    """Outcome of seed_queue. Distinguishes "scope was widened automatically
    because the requested scope had nothing left to do" from "everything
    really is done" — without this distinction the API's no_work_to_do
    branch can't tell the user what actually happened (bug 2026-07-17:
    proj_cc4ca4ae saw a misleading "all 33 chapters done" toast when in
    reality the user's stale scope=next_chapter was the blocker).

    `enqueued` is the number of NEW queue items added by this call. `matched`
    is the total number of unfinished scenes in the requested scope
    (including scenes already in the queue from a previous call). The two
    diverge once seed_queue becomes idempotent: a restart against a queue
    that already holds its target scenes returns enqueued=0 but matched>0,
    which means "nothing new, but there's still work — keep running."
    """
    enqueued: int
    scope_used: str
    fallback_applied: bool
    matched: int = 0


class AsyncTaskExecutor(Protocol):
    """The runner only knows this Protocol. Production: AsyncStage4Executor.
    Tests: FakeStage4Executor."""

    async def execute(self, item: QueueItem, project_id: str) -> dict:
        ...

    async def execute_stream(self, item: QueueItem, project_id: str) -> dict:
        """Streaming twin. Implementations may delegate to execute() if they
        don't yet support streaming (FakeStage4Executor pre-Plan-3 still does)."""
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


def find_latest_completed_chapter(progress: dict, outline: dict) -> Optional[int]:
    """Return the highest chapter_number whose every scene in the outline's
    scene_plan is in DONE_STATUSES. None if no chapter is fully done.

    Reuses is_chapter_complete so the "done" definition stays in one place.
    """
    outline_by_num = {
        c.get("chapter_number"): c for c in (outline.get("chapters") or [])
    }
    progress_by_num = {
        ch.get("chapter_number"): ch for ch in (progress.get("chapters") or [])
    }
    completed: list[int] = []
    for ch_num, outline_ch in outline_by_num.items():
        ch_progress = progress_by_num.get(ch_num, {})
        planned = outline_ch.get("scene_plan", []) or []
        if not planned:
            continue
        if is_chapter_complete(ch_progress.get("scenes", []) or [], planned):
            completed.append(ch_num)
    return max(completed) if completed else None


def compute_range_defaults(
    outline_max: int, latest_completed: Optional[int],
) -> tuple[int, int]:
    """Default range for ManagedStartConfig(scope='range').

    start = (latest_completed or 0) + 1  →  1 if nothing completed yet.
    end   = min(start + 10, outline_max).

    Caller is responsible for surfacing "invalid" when start > outline_max.
    """
    start = (latest_completed or 0) + 1
    end = min(start + 10, outline_max)
    return start, end


def reset_chapter_progress(project_id: str, chapter_number: int,
                            projects_dir: Path) -> None:
    """Set chapter + all scenes to status='pending', clear retry/coherence.
    Mutates progress.json in place. Other chapters untouched.

    `projects_dir` is the project directory (the folder containing
    progress.json), not the projects-root parent. Callers typically pass
    `settings.projects_dir / project_id` so the path here stays a single
    `progress.json` join. `project_id` is accepted for signature symmetry
    with the other helpers and is reserved for future use.
    """
    progress_path = projects_dir / "progress.json"
    if not progress_path.exists():
        return
    progress = json.loads(progress_path.read_text(encoding="utf-8"))
    for ch in progress.get("chapters", []):
        if ch.get("chapter_number") != chapter_number:
            continue
        ch["status"] = "pending"
        for s in ch.get("scenes", []):
            s["status"] = "pending"
            s["retry_count"] = 0
            s["coherence_score"] = None
    progress_path.write_text(
        json.dumps(progress, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def clear_chapter_drafts(project_id: str, chapter_number: int,
                          projects_dir: Path) -> None:
    """Delete drafts for the given chapter: chapters/ch{NN}_*.md.

    Format matches the layout produced by stage4 writers: ch{NN}_scene_{NNN}_draft.md.
    Defensive: missing directories or no matching files are no-ops.

    `projects_dir` is the project directory (folder containing chapters/),
    not the projects-root parent.
    """
    import re
    chapters_dir = projects_dir / "chapters"
    if not chapters_dir.exists():
        return
    # Match ch01_, ch1_, ch001_ etc. — zero-padded or not. The filename
    # must start with the literal "ch" then the chapter_number digits
    # then "_"; any padding (or none) is allowed.
    pattern = re.compile(rf"^ch0*{chapter_number}_")
    for f in chapters_dir.iterdir():
        if f.is_file() and pattern.match(f.name):
            f.unlink()


def drop_chapter_queue_items(mgr: "AutopilotSessionManager",
                              chapter_number: int) -> None:
    """Remove all queue items with id like 'write-{chapter_number}-{scene}'.

    Persists via mgr.save after the in-memory mutation.
    """
    snapshot = mgr.load()
    if snapshot is None:
        return
    prefix = f"write-{chapter_number}-"
    new_queue = [q for q in snapshot.queue if not q.id.startswith(prefix)]
    if len(new_queue) == len(snapshot.queue):
        return
    snapshot.queue = new_queue
    mgr.save(snapshot)


def enqueue_chapter_scenes(mgr: "AutopilotSessionManager",
                            chapter_number: int,
                            scene_plan: list) -> None:
    """Enqueue one write-{ch}-{scene} item per scene in the plan, with
    row-major priority (matches existing _enqueue_for_scope scheme)."""
    for s in scene_plan:
        n = s.get("scene_number")
        if n is None:
            continue
        item = QueueItem(
            id=f"write-{chapter_number}-{n}",
            kind="write_scene",
            chapter_number=chapter_number,
            scheduled_at=None,
            priority=scene_priority(chapter_number, n),
            payload={"scene_number": n},
        )
        mgr.add_queue(item)


def regenerate_chapter(project_id: str,
                        mgr: "AutopilotSessionManager",
                        chapter_number: int,
                        scene_plan: list,
                        projects_dir: Path) -> None:
    """Orchestrate regeneration: reset progress, clear drafts, drop queue
    items, re-enqueue scenes. Checkpoint sync is the caller's responsibility
    (separate helper, see sync_checkpoint_for_chapter).

    The helpers are called in this order: reset progress → clear drafts →
    drop queue items → re-enqueue. Reset-then-clear ensures the next write
    doesn't see stale scene status; drop-then-enqueue prevents duplicate
    ids in the queue (matching the existing dedup logic).
    """
    reset_chapter_progress(project_id, chapter_number, projects_dir)
    clear_chapter_drafts(project_id, chapter_number, projects_dir)
    drop_chapter_queue_items(mgr, chapter_number)
    enqueue_chapter_scenes(mgr, chapter_number, scene_plan)


def repair_stuck_chapters(progress: dict, outline: dict) -> list:
    """Flip chapters stuck at status='in_progress' despite all outline scenes
    being terminal to status='completed'. Mutates `progress` in place;
    returns the sorted chapter_numbers that were repaired.

    Pure on its inputs (no I/O). The caller is responsible for persisting
    `progress` afterwards if disk durability is wanted.

    Why this exists: the executor finalizes scenes one at a time and only
    flips the chapter status after the last scene lands. If the runner stops
    between those two writes (manual stop, server restart, force-passed
    mid-flight), the chapter is left half-finalized forever. Without an
    explicit repair, the autopilot sees "this chapter is still in progress"
    and refuses to advance. surfacing 2026-07-17 on proj_cc4ca4ae where
    chapters 21-30 had every scene completed but chapter.status was still
    'in_progress'.
    """
    outline_chapters_by_num = {
        c.get("chapter_number"): c for c in (outline.get("chapters") or [])
    }
    repaired: list = []
    for ch in progress.get("chapters", []) or []:
        if ch.get("status") != "in_progress":
            continue
        ch_num = ch.get("chapter_number")
        outline_ch = outline_chapters_by_num.get(ch_num)
        if outline_ch is None:
            continue  # no ground truth → skip defensively
        planned = outline_ch.get("scene_plan", []) or []
        if not planned:
            continue
        if is_chapter_complete(ch.get("scenes", []) or [], planned):
            ch["status"] = "completed"
            repaired.append(ch_num)
    repaired.sort()
    return repaired


def seed_queue(
    mgr: "AutopilotSessionManager",
    outline: dict,
    progress: Optional[dict],
    novel_outline: Optional[dict],
    cfg: ManagedStartConfig,
) -> SeedResult:
    """Translate (outline, progress, novel_outline, cfg) into QueueItems
    appended to mgr.queue. Returns a SeedResult describing what was enqueued.

    Idempotent: items with deterministic ids (`write-{ch}-{scene}`,
    `archive-{ch}`) already present in mgr.queue are skipped, so a restart
    that re-runs seed_queue against a non-empty queue grows the queue by
    zero. Without this, every restart doubled or tripled the queue and
    history ballooned with thousands of `queue_add` events (bug 2026-07-17
    proj_cc4ca4ae: queue grew 10 → 20 → 30 across three restarts).

    Auto-fallback: when cfg.scope == "next_chapter" but the scoped chapter
    has zero unfinished scenes in progress.json (so the first pass enqueues
    0), retry with target=all_chapters. This protects against stale
    "next_chapter" intent sitting in session.json from a previous run —
    without the fallback the UI shows a misleading "project complete" toast
    (bug 2026-07-17 on proj_cc4ca4ae: ch21 was already done but ch31-33 had
    no progress at all, so a meaningful plan existed below the scoped
    chapter). The fallback decision uses `matched` (total unfinished scenes
    in the requested scope), not `enqueued` (newly added), so a re-start
    whose work is already queued doesn't silently widen scope.

    Pure-ish: the only side effect is `mgr.add_queue(...)` (which writes
    session.json). No HTTP, no LLM, no executor.
    """
    if not outline or not outline.get("chapters"):
        return SeedResult(enqueued=0, scope_used=cfg.scope, fallback_applied=False)
    progress = progress or {}
    chapters = progress.get("chapters", []) or []
    progress_by_chapter = {
        ch.get("chapter_number"): ch for ch in chapters
    }
    current_chapter = progress.get("current_chapter", 1)

    all_chapters = outline["chapters"]

    # First pass with the requested scope.
    first_seeded, first_matched = _enqueue_for_scope(
        mgr, all_chapters, progress_by_chapter, cfg.scope, current_chapter,
    )

    # Fallback: next_chapter's scope produced ZERO candidates (the chapter
    # is genuinely complete), but later chapters may still have unfinished
    # scenes. Use matched (not enqueued) so a re-start whose work is
    # already queued doesn't trigger fallback.
    if first_matched == 0 and cfg.scope == "next_chapter":
        second_seeded, _ = _enqueue_for_scope(
            mgr, all_chapters, progress_by_chapter,
            target_scope="all_planned", current_chapter=current_chapter,
        )
        if second_seeded > 0:
            return SeedResult(
                enqueued=second_seeded, scope_used="all_planned",
                fallback_applied=True, matched=first_matched,
            )

    return SeedResult(
        enqueued=first_seeded, scope_used=cfg.scope, fallback_applied=False,
        matched=first_matched,
    )


def _enqueue_for_scope(
    mgr: "AutopilotSessionManager",
    all_chapters: list,
    progress_by_chapter: dict,
    target_scope: str,
    current_chapter: int,
) -> tuple[int, int]:
    """Enqueue unfinished scenes for chapters matching `target_scope`.
    Returns `(seeded, matched)`:
      - `seeded`: number of NEW queue items added (excludes items already
        in mgr.queue with the same deterministic id).
      - `matched`: total number of unfinished scenes in scope (including
        those already queued — needed by the caller to decide fallback).

    Pure-ish (only side effect is via mgr.add_queue)."""
    if target_scope == "next_chapter":
        target_chapters = [
            ch for ch in all_chapters
            if ch.get("chapter_number") == current_chapter
        ]
    else:  # "all_planned"
        target_chapters = list(all_chapters)

    # Snapshot existing queue ids once. Reading mgr.queue inside the loop
    # would force a session.json load per scene; this keeps dedup O(n).
    # mgr.load() can return None if the session file doesn't exist yet
    # (e.g. seed_queue called before mgr.start()) — treat that as empty.
    snapshot = mgr.load()
    existing_ids = {q.id for q in (snapshot.queue or [])} if snapshot else set()

    seeded = 0
    matched = 0
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
            item_id = f"write-{ch_num}-{n}"
            matched += 1
            if item_id in existing_ids:
                continue
            item = QueueItem(
                id=item_id,
                kind="write_scene",
                chapter_number=ch_num,
                scheduled_at=None,
                priority=scene_priority(ch_num, n),  # row-major; archival uses archive_priority
                payload={"scene_number": n},
            )
            mgr.add_queue(item)
            existing_ids.add(item_id)
            seeded += 1
    return seeded, matched


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
        """One iteration. Mirrors sync runner.step() but async + retry-then-pause.

        Retry budget (write_scene only — archival / plan_chapter / fact_guard
        / review keep the pre-fix drop-on-fail behavior):
          - Up to SCENE_WRITE_MAX_RETRIES additional attempts on the SAME
            queue item with growing backoff (SCENE_WRITE_RETRY_BACKOFFS).
          - On every retry the queue item is intentionally NOT dropped so
            that `seed_queue()` (idempotent on item ids) cannot re-add a
            duplicate. If the user resumes, the runner picks the same item.
          - Between backoff sleeps we re-check session state — if the user
            paused/stopped during the wait, we abort the retry and return.
        Failure mode (write_scene only):
          - When all attempts fail, the runner calls fail_current_task()
            AND mgr.pause(reason=...). The queue item stays so resume()
            can re-pick it; the cockpit banner explains what failed.
          - Pre-fix behavior was drop-on-fail, which permanently skipped
            failed scenes. Bug 2026-07-22 on proj_a601cee9 left ch5 s2/s3
            stuck at "retry" forever after an LLM connection drop.
        Failure mode (other kinds):
          - drop-on-fail: drop_queue + fail_current_task + return error.
            The runner's outer loop sees the queue shrink and either picks
            the next item or auto-stops when empty.
        """
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

        # Non-scene kinds keep the pre-fix drop-on-fail path so the outer
        # loop can auto-stop once the queue drains (e.g. archival fails on
        # an exhausted outline — we don't want the whole session stuck in
        # paused forever, that's a recoverable end-of-work signal handled
        # by the runner's empty-queue auto-stop, not a user-actionable
        # failure).
        if item.kind != "write_scene":
            try:
                result = await self._executor.execute(item, project_id=project_id)
            except Exception as e:
                self._mgr.fail_current_task(error=str(e))
                self._mgr.drop_queue(item.id)
                return {"picked": item.id, "completed": False, "error": str(e)}
            if isinstance(result, dict) and result.get("status") == "fail":
                err = result.get("error", "scene write failed")
                self._mgr.fail_current_task(error=err)
                self._mgr.drop_queue(item.id)
                return {"picked": item.id, "completed": False, "error": err}
            self._mgr.drop_queue(item.id)
            self._mgr.complete_current_task()
            return {"picked": item.id, "completed": True, "result": result}

        last_error: Optional[str] = None
        executor_call = (
            self._executor.execute_stream
            if hasattr(self._executor, "execute_stream")
            else self._executor.execute
        )

        for attempt in range(SCENE_WRITE_MAX_RETRIES + 1):
            if attempt > 0:
                backoff = SCENE_WRITE_RETRY_BACKOFFS[attempt - 1]
                await asyncio.sleep(backoff)
                # Honor user-initiated pause/stop during the backoff window.
                s = self._mgr.load()
                if s is None or s.state != SessionState.RUNNING:
                    return {
                        "picked": item.id, "completed": False,
                        "error": f"aborted during retry backoff (state={s.state.value if s else 'none'})",
                    }

            try:
                result = await executor_call(item, project_id=project_id)
            except Exception as e:
                last_error = str(e)
                logger.warning(
                    "[autopilot] scene write attempt %d/%d failed for %s: %s",
                    attempt + 1, SCENE_WRITE_MAX_RETRIES + 1, item.id, last_error,
                )
                continue

            if isinstance(result, dict) and result.get("status") == "scene_missing":
                # Outline drift: the chapter's scene_plan no longer contains
                # this scene number. Drop the queue item and emit task_fail,
                # but DO NOT pause the session and DO NOT retry — other queue
                # items may still be valid. Pre-fix behavior was to retry 3x
                # then pause the whole session, burning 90+ seconds on a
                # deterministic failure (bug 2026-07-27 proj_bb0375eb:
                # /api/stage3/generate regenerated chapter 10 with fewer
                # scenes, stranding write-10-4 in the queue).
                err = result.get("error", "scene missing in outline")
                self._mgr.fail_current_task(error=err)
                self._mgr.drop_queue(item.id)
                logger.info(
                    "[autopilot] %s dropped (outline drift): %s", item.id, err,
                )
                return {
                    "picked": item.id, "completed": False,
                    "error": err, "skipped": "scene_missing",
                }

            if isinstance(result, dict) and result.get("status") == "fail":
                last_error = result.get("error", "scene write failed")
                logger.warning(
                    "[autopilot] scene write attempt %d/%d returned fail for %s: %s",
                    attempt + 1, SCENE_WRITE_MAX_RETRIES + 1, item.id, last_error,
                )
                continue

            # Success path: drop queue item + complete current_task.
            self._mgr.drop_queue(item.id)
            self._mgr.complete_current_task()

            # Circuit breaker: only on force_passed scenes (spec §5 row 2).
            # Delegate to mgr.record_force_pass_internal() which encapsulates
            # the increment + threshold-check + circuit_open transition in
            # one write-through.
            scene_status = result.get("scene_status") if isinstance(result, dict) else None
            if scene_status == "force_passed":
                self._mgr.record_force_pass_internal()

            return {"picked": item.id, "completed": True, "result": result}

        # Exhausted retries — pause session with reason. Queue item stays so
        # resume() can re-pick it. fail_current_task emits the task_fail
        # history event before the pause so the cockpit shows what went wrong.
        err = last_error or "scene write failed"
        self._mgr.fail_current_task(error=err)
        scene_id = item.payload.get("scene_number", "?") if isinstance(item.payload, dict) else "?"
        reason = f"scene_write_failed:write-{item.chapter_number}-{scene_id}:{err}"
        self._mgr.pause(reason=reason)
        logger.warning(
            "[autopilot] %s failed after %d attempts — pausing session (reason=%s)",
            item.id, SCENE_WRITE_MAX_RETRIES + 1, reason,
        )
        return {"picked": item.id, "completed": False, "error": err}
