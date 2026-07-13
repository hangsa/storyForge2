"""AutopilotRunner — bridges AutopilotSession to a TaskExecutor.

Spec: docs/design/storyForge-design-v1.9.md §四 F1.9.1, L282.

Stage 1: SYNC runner, recording executor. Stage 2 promotes to asyncio and
swaps RecordingExecutor for Stage4PipelineExecutor (calls existing planner/
writer/reviewer via `backend/api/stage4_writing.py`).

Task 1.7: optional constructor-injected `CircuitBreaker`. `sync_circuit_breaker()`
pulls any new force_pass events from the breaker into the session and triggers
a `circuit_open` state transition (auto-pause) when the cumulative force-pass
count crosses the threshold (spec L258, L287).
"""
from __future__ import annotations
import logging
from datetime import datetime, timezone
from typing import Optional, Protocol

from backend.conductor.autopilot_session import AutopilotSessionManager
from backend.models.autopilot_session import (
    CircuitSnapshot, CurrentTask, QueueItem, SessionState, SessionStateMachine,
)

logger = logging.getLogger(__name__)


# Spec L287: threshold at which we mark a warning. v1.9 keeps the v1.6
# CircuitBreaker.MAX_RETRIES=3 contract; warning fires AT the third force-pass.
CIRCUIT_THRESHOLD = 3


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

    def __init__(
        self,
        mgr: AutopilotSessionManager,
        executor: TaskExecutor,
        circuit_breaker: Optional[object] = None,
    ) -> None:
        self._mgr = mgr
        self._executor = executor
        self._circuit_breaker = circuit_breaker
        # Cursor into the breaker's event stream. Tests may reset to re-sync.
        self._circuit_cursor: int = 0

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

        When the cumulative count CROSSES the threshold (i.e. transitions from
        below to >= CIRCUIT_THRESHOLD), also fire the `circuit_open` state
        transition, which auto-pauses the session per spec L258. Spec L287
        explicitly says "不阻断" — we don't refuse writes; we just pause.
        """
        s = self._mgr.load()
        if s is None:
            return
        new_count = s.circuit.force_pass_count + 1
        crossed_threshold = (
            s.circuit.force_pass_count < CIRCUIT_THRESHOLD
            and new_count >= CIRCUIT_THRESHOLD
        )
        snap = CircuitSnapshot(
            force_pass_count=new_count,
            last_event_at=_now(),
            threshold_warning=new_count >= CIRCUIT_THRESHOLD,  # spec L287
        )
        self._mgr.update_circuit_snapshot(snap)

        if crossed_threshold:
            self._trigger_circuit_open()

    def _trigger_circuit_open(self) -> None:
        """Fire circuit_open transition on the session and auto-pause.

        Spec L258: running --[circuit_open]--> paused (自动暂停).
        Per spec L287, this is a "警示", not a block. After auto-pause, the
        user can resume manually (Risk Note 5 in plan).
        """
        s = self._mgr.load()
        if s is None or s.state != SessionState.RUNNING:
            return  # only auto-pause from running
        sm = SessionStateMachine()
        s2 = sm.circuit_open(s)
        self._mgr.save(s2)

    def sync_circuit_breaker(self) -> dict:
        """Task 1.7: pull new force_pass events from the injected CircuitBreaker.

        Returns a small summary dict so tests can assert behavior without
        poking the session JSON directly.
        """
        if self._circuit_breaker is None:
            return {"new_force_passes": 0, "circuit_opened": False}

        events = self._circuit_breaker.get_events()
        new_events = events[self._circuit_cursor:]
        force_passes = [e for e in new_events if getattr(e, "result", None) == "force_pass"]
        # Advance the cursor past all events we just observed (passed/retry too)
        self._circuit_cursor = len(events)

        circuit_opened = False
        for _ in force_passes:
            s = self._mgr.load()
            if s is None:
                break
            pre_count = s.circuit.force_pass_count
            self.record_force_pass()
            s_after = self._mgr.load()
            if pre_count < CIRCUIT_THRESHOLD and s_after.circuit.force_pass_count >= CIRCUIT_THRESHOLD:
                circuit_opened = True

        return {
            "new_force_passes": len(force_passes),
            "circuit_opened": circuit_opened,
        }
