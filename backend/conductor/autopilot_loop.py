"""Per-project asyncio task bookkeeping for the AutopilotRunner.

Spec: docs/superpowers/specs/2026-07-14-v1.9-autopilot-runner-wiring-design.md
§§3, 4C, 4E. One task per project; cancelled on stop/pause; respawned on
resume and on backend restart (for sessions in 'running' state).
"""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from backend.conductor.autopilot_session import AutopilotSessionManager
    from backend.conductor.autopilot_runner_async import (
        AsyncTaskExecutor, SeedResult,
    )
    from backend.models.autopilot_session import ManagedStartConfig

from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# Heartbeat staleness threshold (spec L287 "stale session" rule): if last
# heartbeat > this many seconds old, downgrade to paused on recovery.
STALE_HEARTBEAT_SECONDS = 30.0


async def _runner_loop_task(
    loop_svc: "AutopilotLoopService",
    project_id: str,
    mgr: "AutopilotSessionManager",
    executor: "AsyncTaskExecutor",
    cfg: "ManagedStartConfig",
) -> None:
    """The actual loop body. Always cleans up self._tasks[project_id] in finally."""
    from backend.conductor.autopilot_runner_async import AsyncAutopilotRunner
    runner = AsyncAutopilotRunner(mgr, executor, cadence=cfg.cadence)
    try:
        await runner.run()
    finally:
        loop_svc._tasks.pop(project_id, None)


def _read_outline(projects_dir: Path, project_id: str) -> dict:
    p = projects_dir / project_id / "outline.json"
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _read_progress(projects_dir: Path, project_id: str) -> dict:
    p = projects_dir / project_id / "progress.json"
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _read_novel_outline(projects_dir: Path, project_id: str):
    p = projects_dir / project_id / "novel_outline.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


@dataclass
class EnsureResult:
    """Outcome of AutopilotLoopService.ensure(). Carries enough context for
    the API to render an honest message — not just "all done" but the
    distinction between "we repaired stuck chapters", "your scope was
    widened automatically", and "there really is nothing left to write"
    (bug 2026-07-17 proj_cc4ca4ae: the latter was being conflated)."""
    outcome: str            # "started" | "already_running" | "no_work_to_do"
    seed_result: Optional["SeedResult"] = None
    repaired_chapters: list = field(default_factory=list)


class AutopilotLoopService:
    """Per-project asyncio task bookkeeping. Lives in app.state.loop_service."""

    def __init__(self) -> None:
        self._tasks: dict = {}
        self._lock: Optional[asyncio.Lock] = None

    async def ensure(
        self,
        project_id: str,
        mgr: "AutopilotSessionManager",
        executor: "AsyncTaskExecutor",
        cfg: "ManagedStartConfig",
    ) -> EnsureResult:
        """Spawn a runner task for project_id if not already running. Idempotent.

        Returns an EnsureResult carrying:
          - outcome: "started" | "already_running" | "no_work_to_do"
          - seed_result: SeedResult (enqueued count, scope used, fallback flag)
          - repaired_chapters: chapter numbers flipped from in_progress to
            completed because their scenes were already terminal

        The richer return shape lets the API distinguish "your scope was
        too narrow and we widened it" from "the project really is finished"
        — without that distinction the 2026-07-17 proj_cc4ca4ae UI showed
        a misleading "all 33 chapters done" toast when ch21 was already
        done but ch31-33 had no progress at all.
        """
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            existing = self._tasks.get(project_id)
            if existing and not existing.done():
                return EnsureResult(outcome="already_running")
            projects_dir = mgr._projects_dir
            outline = _read_outline(projects_dir, project_id)
            progress = _read_progress(projects_dir, project_id)
            novel_outline = _read_novel_outline(projects_dir, project_id)

            # Repair chapters stuck at status='in_progress' despite all
            # outline scenes being terminal. Pure on the in-memory dict; we
            # persist back to disk so seed_queue + the UI both see the
            # corrected state. Without this, the executor's mid-run stop can
            # leave chapters half-finalized forever (proj_cc4ca4ae 2026-07-17
            # had ch21-30 stuck this way).
            from backend.conductor.autopilot_runner_async import (
                repair_stuck_chapters, seed_queue,
            )
            repaired = repair_stuck_chapters(progress, outline)
            if repaired and progress:
                # Best-effort persist; failure here must not block start.
                progress_path = projects_dir / project_id / "progress.json"
                try:
                    progress_path.write_text(
                        json.dumps(progress, ensure_ascii=False, indent=2),
                        encoding="utf-8",
                    )
                except Exception:
                    logger.warning(
                        "autopilot start: failed to persist repaired progress for %s (chapters=%s)",
                        project_id, repaired, exc_info=True,
                    )

            seed_result = seed_queue(mgr, outline, progress, novel_outline, cfg)
            # Use queue length, not seed_result.enqueued, to decide no-work.
            # seed_queue is idempotent: a re-start whose target scenes are
            # already in mgr.queue returns enqueued=0 but the queue itself
            # still has work. If we treated enqueued==0 as "nothing to do",
            # every restart would stop the session and orphan the queued
            # items (bug 2026-07-17 proj_cc4ca4ae).
            post_snapshot = mgr.load()
            queue_len = len(post_snapshot.queue) if post_snapshot else 0
            if queue_len == 0:
                # Nothing to do — don't spawn a loop that would immediately exit.
                mgr.stop()
                return EnsureResult(
                    outcome="no_work_to_do",
                    seed_result=seed_result,
                    repaired_chapters=repaired,
                )
            task = asyncio.create_task(
                _runner_loop_task(self, project_id, mgr, executor, cfg),
                name=f"autopilot-{project_id}",
            )
            self._tasks[project_id] = task
            return EnsureResult(
                outcome="started",
                seed_result=seed_result,
                repaired_chapters=repaired,
            )

    async def cancel(self, project_id: str) -> None:
        """Cancel + await the task. No-op if no task exists."""
        task = self._tasks.get(project_id)
        if task is None:
            return
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass  # _runner_loop_task swallows + cleans up

    def is_running(self, project_id: str) -> bool:
        task = self._tasks.get(project_id)
        return task is not None and not task.done()

    async def recover_running_sessions(
        self, projects_dir: Path, broadcaster=None,
    ) -> None:
        """Called from FastAPI startup. Resumes sessions in 'running' state
        that have a recent last_heartbeat_at; downgrades stale ones to paused.

        `broadcaster` is forwarded to the per-session executor so recovery
        on a server restart publishes scene chunks on the same SSE channel
        that the live cockpit UI subscribes to. Without this, the recovered
        executor uses a private broadcaster and silently drops every event
        (the same bug fixed in main.py at v1.9 Direction B on 2026-07-17 —
        proj_cc4ca4ae was the trigger)."""
        from datetime import datetime, timezone
        from backend.conductor.autopilot_session import AutopilotSessionManager
        from backend.conductor.stage4_async_executor import AsyncStage4Executor
        from backend.models.autopilot_session import SessionState

        if not projects_dir.exists():
            return
        for proj_dir in sorted(projects_dir.iterdir()):
            if not proj_dir.is_dir():
                continue
            session_file = proj_dir / "autopilot" / "session.json"
            if not session_file.exists():
                continue
            try:
                payload = json.loads(session_file.read_text(encoding="utf-8"))
            except Exception:
                continue
            if payload.get("state") != SessionState.RUNNING.value:
                continue
            pid = proj_dir.name

            # Stale-session rule: downgrade to paused if heartbeat is missing OR stale.
            # A None heartbeat means the runner never reported — after Layer 1's fix
            # this only happens for sessions that pre-date the heartbeat mechanism
            # (i.e., crashed before heartbeats were added). Treating that as stale
            # is safe: the user can manually resume from managed mode if needed.
            last_hb = payload.get("last_heartbeat_at")
            is_stale = False
            stale_reason = ""
            if last_hb is None:
                is_stale = True
                stale_reason = "no heartbeat recorded"
            else:
                try:
                    hb_dt = datetime.fromisoformat(last_hb)
                    age = (datetime.now(timezone.utc) - hb_dt).total_seconds()
                    if age > STALE_HEARTBEAT_SECONDS:
                        is_stale = True
                        stale_reason = f"heartbeat {age:.1f}s old (>{STALE_HEARTBEAT_SECONDS}s)"
                except Exception:
                    # Unparseable timestamp → treat as stale (safer than resuming
                    # a session whose age we can't compute).
                    is_stale = True
                    stale_reason = "unparseable heartbeat timestamp"

            if is_stale:
                # Use the manager so SSE events fire on the downgrade.
                mgr = AutopilotSessionManager(projects_dir, pid)
                mgr.pause()
                logger.info(
                    "autopilot recovery: downgraded stale session %s (%s)",
                    pid, stale_reason,
                )
                continue
            mgr = AutopilotSessionManager(projects_dir, pid)
            cfg = payload.get("config") or {}
            from backend.models.autopilot_session import ManagedStartConfig
            try:
                cfg_obj = ManagedStartConfig(**cfg)
            except Exception:
                cfg_obj = ManagedStartConfig()
            executor = AsyncStage4Executor(projects_dir, broadcaster=broadcaster)
            await self.ensure(pid, mgr, executor, cfg_obj)