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
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from backend.conductor.autopilot_session import AutopilotSessionManager
    from backend.conductor.autopilot_runner_async import AsyncTaskExecutor
    from backend.models.autopilot_session import ManagedStartConfig

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


class AutopilotLoopService:
    """Per-project asyncio task bookkeeping. Lives in app.state.loop_service."""

    def __init__(self) -> None:
        self._tasks: dict = {}
        self._lock = asyncio.Lock()

    async def ensure(
        self,
        project_id: str,
        mgr: "AutopilotSessionManager",
        executor: "AsyncTaskExecutor",
        cfg: "ManagedStartConfig",
    ) -> None:
        """Spawn a runner task for project_id if not already running. Idempotent."""
        async with self._lock:
            existing = self._tasks.get(project_id)
            if existing and not existing.done():
                return
            projects_dir = mgr._projects_dir
            outline = _read_outline(projects_dir, project_id)
            progress = _read_progress(projects_dir, project_id)
            novel_outline = _read_novel_outline(projects_dir, project_id)
            from backend.conductor.autopilot_runner_async import seed_queue
            seeded = seed_queue(mgr, outline, progress, novel_outline, cfg)
            if seeded == 0:
                # Nothing to do — don't spawn a loop that would immediately exit.
                mgr.stop()
                return
            task = asyncio.create_task(
                _runner_loop_task(self, project_id, mgr, executor, cfg),
                name=f"autopilot-{project_id}",
            )
            self._tasks[project_id] = task

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