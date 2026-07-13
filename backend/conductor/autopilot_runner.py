"""AutopilotRunner — bridges AutopilotSession to a TaskExecutor.

Spec: docs/design/storyForge-design-v1.9.md §四 F1.9.1, L282.

Stage 1: SYNC runner, recording executor. Stage 2 promotes to asyncio and
swaps RecordingExecutor for Stage4PipelineExecutor (calls existing planner/
writer/reviewer via `backend/api/stage4_writing.py`).
"""
from __future__ import annotations
import logging
from datetime import datetime, timezone
from typing import Optional, Protocol

from backend.conductor.autopilot_session import AutopilotSessionManager
from backend.models.autopilot_session import (
    CircuitSnapshot, CurrentTask, QueueItem,
)

logger = logging.getLogger(__name__)


class TaskExecutor(Protocol):
    """Interface for the runner's execution backend. Stage 2 adds Stage4PipelineExecutor."""

    def execute(self, item: QueueItem, project_id: str) -> dict:
        ...


class RecordingExecutor:
    """Test executor — records every execute() call, returns success."""

    def __init__(self) -> None:
        self.calls: list = []

    def execute(self, item: QueueItem, project_id: str) -> dict:
        self.calls.append({"item_id": item.id, "kind": item.kind, "project_id": project_id})
        return {"status": "ok", "item_id": item.id}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AutopilotRunner:
    """Drives a session's queue one step at a time."""

    def __init__(self, mgr: AutopilotSessionManager, executor: TaskExecutor) -> None:
        self._mgr = mgr
        self._executor = executor

    def pick_next(self, session) -> Optional[QueueItem]:
        if not session.queue:
            return None
        return min(session.queue, key=lambda q: q.priority)

    def step(self) -> dict:
        """One step. Returns {picked, completed, error, result?}."""
        s = self._mgr.load()
        if s is None or s.state.value != "running":
            return {"picked": None, "completed": False, "error": "session not running"}

        item = self.pick_next(s)
        if item is None:
            return {"picked": None, "completed": False, "error": "queue empty"}

        task = CurrentTask(
            kind=item.kind,
            chapter_number=item.chapter_number,
            scene_id=None,
            status="active",
            started_at=_now(),
            description=f"{item.kind} (chapter {item.chapter_number})",
            progress_pct=0,
        )
        self._mgr.set_current_task(task)

        try:
            result = self._executor.execute(item, project_id=self._mgr._project_id)
        except Exception as e:
            logger.exception("Executor failed for %s", item.id)
            self._mgr.intervene("stop_current_task")
            return {"picked": item.id, "completed": False, "error": str(e)}

        # Drop from queue (single write-through via mgr helper) and clear
        # current_task by routing through the same intervene hook used on the
        # failure path — both branches converge on a cleared task + event.
        self._mgr.drop_queue(item.id)
        self._mgr.intervene("stop_current_task")
        return {"picked": item.id, "completed": True, "result": result}

    def record_force_pass(self) -> None:
        """Task 1.7 hook: increments session.circuit.force_pass_count.
        Stage 2 wires this to CircuitBreaker events automatically.
        """
        s = self._mgr.load()
        if s is None:
            return
        new_count = s.circuit.force_pass_count + 1
        snap = CircuitSnapshot(
            force_pass_count=new_count,
            last_event_at=_now(),
            threshold_warning=new_count >= 3,  # spec L287: warn at >=3
        )
        self._mgr.update_circuit_snapshot(snap)
