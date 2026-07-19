"""AutopilotSession — v1.9 server-driven orchestration model.

Spec: docs/design/storyForge-design-v1.9.md §四 F1.9.1.

PURE — no I/O, no FastAPI. Persistence lives in
`backend/conductor/autopilot_session.py` (AutopilotSessionManager).
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel


class SessionState(str, Enum):
    IDLE = "idle"
    RUNNING = "running"
    PAUSED = "paused"
    STOPPED = "stopped"
    ERROR = "error"


TASK_KINDS = frozenset({
    "plan_chapter", "write_scene", "fact_guard",
    "review", "archival", "diagnosis",
})

EVENT_TYPES = frozenset({
    "task_start", "task_complete", "task_fail", "decision",
    "intervention", "checkpoint", "circuit_open", "circuit_close",
    "queue_add", "queue_drop",
})


class InvalidTransition(Exception):
    """Raised when a state-machine trigger is not valid from the current state."""


class ManagedStartConfig(BaseModel):
    """Mirror of frontend/src/components/workspace/ManagedStartModal.tsx ManagedStartConfig.
    Field names and literal unions MUST stay in sync (Stage 2 contract test).
    """
    scope: str = "all_planned"     # "all_planned" | "next_chapter"
    cadence: str = "balanced"      # "fast" | "balanced" | "careful"
    policy: str = "auto"           # "auto" | "ask"
    notify: str = "milestones"     # "all" | "milestones"


@dataclass
class CurrentTask:
    kind: str
    chapter_number: Optional[int]
    scene_id: Optional[str]
    status: str                     # "queued" | "active" | "blocked" | "completed" | "failed"
    started_at: Optional[str]       # ISO8601
    description: str
    progress_pct: Optional[int] = None


@dataclass
class QueueItem:
    id: str
    kind: str
    chapter_number: Optional[int]
    scheduled_at: Optional[str]
    priority: int                   # lower = earlier
    payload: dict = field(default_factory=dict)


@dataclass
class SessionEvent:
    id: str
    at: str                         # ISO8601
    type: str
    task_id: Optional[str] = None
    chapter_number: Optional[int] = None
    payload: dict = field(default_factory=dict)


@dataclass
class CircuitSnapshot:
    """Spec L217: reflects累计强制通过次数. L287: threshold_warning at >=3."""
    force_pass_count: int = 0
    last_event_at: Optional[str] = None
    threshold_warning: bool = False


@dataclass
class AutopilotSession:
    project_id: str
    state: SessionState
    config: ManagedStartConfig
    started_at: Optional[str]
    last_heartbeat_at: Optional[str]
    current_task: Optional[CurrentTask]
    queue: list
    history: list
    circuit: CircuitSnapshot
    # Reason set when state transitions to STOPPED via stop(reason=...).
    # None for sessions that were never explicitly stopped, or for sessions
    # saved before this field existed (back-compat).
    stop_reason: Optional[str] = None


# --- Helpers ---

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_event_id() -> str:
    return f"evt_{uuid.uuid4().hex[:12]}"


def _append_event(s: AutopilotSession, type_: str, **fields) -> AutopilotSession:
    if type_ not in EVENT_TYPES:
        raise ValueError(f"unknown event type: {type_!r}")
    event = SessionEvent(id=_new_event_id(), at=_now(), type=type_, **fields)
    return AutopilotSession(
        project_id=s.project_id, state=s.state, config=s.config,
        started_at=s.started_at, last_heartbeat_at=s.last_heartbeat_at,
        current_task=s.current_task, queue=list(s.queue),
        history=s.history + [event], circuit=s.circuit,
        stop_reason=s.stop_reason,
    )


# --- State machine ---

# (from_state, trigger) → (to_state, event_type)
_TRANSITIONS: dict = {
    (SessionState.IDLE, "start"): (SessionState.RUNNING, "task_start"),
    (SessionState.IDLE, "stop"): (SessionState.STOPPED, "task_complete"),
    (SessionState.RUNNING, "pause"): (SessionState.PAUSED, "checkpoint"),
    (SessionState.RUNNING, "stop"): (SessionState.STOPPED, "task_complete"),
    (SessionState.RUNNING, "circuit_open"): (SessionState.PAUSED, "circuit_open"),
    (SessionState.RUNNING, "fatal_error"): (SessionState.ERROR, "task_fail"),
    (SessionState.PAUSED, "start"): (SessionState.RUNNING, "task_start"),
    (SessionState.PAUSED, "resume"): (SessionState.RUNNING, "task_start"),
    (SessionState.PAUSED, "stop"): (SessionState.STOPPED, "task_complete"),
    (SessionState.STOPPED, "start"): (SessionState.RUNNING, "task_start"),
    (SessionState.ERROR, "start"): (SessionState.RUNNING, "task_start"),
}


def transition(s: AutopilotSession, trigger: str) -> AutopilotSession:
    key = (s.state, trigger)
    if key not in _TRANSITIONS:
        raise InvalidTransition(
            f"trigger {trigger!r} not allowed from state {s.state.value!r}"
        )
    to_state, event_type = _TRANSITIONS[key]

    current_task = None if trigger == "stop" else s.current_task
    started_at = _now() if (trigger == "start" and s.started_at is None) else s.started_at

    s2 = AutopilotSession(
        project_id=s.project_id, state=to_state, config=s.config,
        started_at=started_at, last_heartbeat_at=s.last_heartbeat_at,
        current_task=current_task, queue=list(s.queue),
        history=list(s.history), circuit=s.circuit,
    )
    return _append_event(s2, event_type)


# --- Queue / current-task helpers ---

def set_current_task(s: AutopilotSession, task: CurrentTask) -> AutopilotSession:
    if task.kind not in TASK_KINDS:
        raise ValueError(f"unknown task kind: {task.kind!r}")
    return AutopilotSession(
        project_id=s.project_id, state=s.state, config=s.config,
        started_at=s.started_at, last_heartbeat_at=s.last_heartbeat_at,
        current_task=task, queue=list(s.queue), history=list(s.history),
        circuit=s.circuit,
    )


def complete_current_task(s: AutopilotSession) -> AutopilotSession:
    if s.current_task is None:
        return s
    done = CurrentTask(
        kind=s.current_task.kind, chapter_number=s.current_task.chapter_number,
        scene_id=s.current_task.scene_id, status="completed",
        started_at=s.current_task.started_at,
        description=s.current_task.description, progress_pct=100,
    )
    s2 = AutopilotSession(
        project_id=s.project_id, state=s.state, config=s.config,
        started_at=s.started_at, last_heartbeat_at=s.last_heartbeat_at,
        current_task=done, queue=list(s.queue), history=list(s.history),
        circuit=s.circuit,
    )
    s3 = _append_event(s2, "task_complete")
    return AutopilotSession(
        project_id=s3.project_id, state=s3.state, config=s3.config,
        started_at=s3.started_at, last_heartbeat_at=s3.last_heartbeat_at,
        current_task=None, queue=s3.queue, history=s3.history, circuit=s3.circuit,
    )


def fail_current_task(s: AutopilotSession, error: str) -> AutopilotSession:
    """Clear `current_task` and emit a `task_fail` event.

    Distinct from `complete_current_task`: success path emits task_complete and
    sets progress_pct=100; this emits task_fail and clears current_task outright.
    The runner uses this on the executor-exception branch.
    """
    if s.current_task is None:
        return s
    s2 = AutopilotSession(
        project_id=s.project_id, state=s.state, config=s.config,
        started_at=s.started_at, last_heartbeat_at=s.last_heartbeat_at,
        current_task=None, queue=list(s.queue), history=list(s.history),
        circuit=s.circuit,
    )
    return _append_event(s2, "task_fail", task_id=s.current_task.scene_id,
                         chapter_number=s.current_task.chapter_number,
                         payload={"error": error})


def add_queue_item(s: AutopilotSession, item: QueueItem) -> AutopilotSession:
    if item.kind not in TASK_KINDS:
        raise ValueError(f"unknown task kind: {item.kind!r}")
    queue = sorted(s.queue + [item], key=lambda q: q.priority)
    s2 = AutopilotSession(
        project_id=s.project_id, state=s.state, config=s.config,
        started_at=s.started_at, last_heartbeat_at=s.last_heartbeat_at,
        current_task=s.current_task, queue=queue, history=list(s.history),
        circuit=s.circuit,
    )
    return _append_event(s2, "queue_add", task_id=item.id, chapter_number=item.chapter_number)


def drop_queue_item(s: AutopilotSession, item_id: str) -> AutopilotSession:
    new_queue = [q for q in s.queue if q.id != item_id]
    if len(new_queue) == len(s.queue):
        return s
    s2 = AutopilotSession(
        project_id=s.project_id, state=s.state, config=s.config,
        started_at=s.started_at, last_heartbeat_at=s.last_heartbeat_at,
        current_task=s.current_task, queue=new_queue, history=list(s.history),
        circuit=s.circuit,
    )
    return _append_event(s2, "queue_drop", task_id=item_id)


# --- Class wrapper ---

class SessionStateMachine:
    """Stateless wrapper over transition(). Every method returns a NEW session."""

    def start(self, s, cfg=None):
        if cfg is not None:
            s = AutopilotSession(
                project_id=s.project_id, state=s.state, config=cfg,
                started_at=s.started_at, last_heartbeat_at=s.last_heartbeat_at,
                current_task=s.current_task, queue=s.queue, history=s.history,
                circuit=s.circuit,
            )
        return transition(s, "start")

    def stop(self, s):
        return transition(s, "stop")

    def pause(self, s):
        return transition(s, "pause")

    def resume(self, s):
        return transition(s, "resume")

    def circuit_open(self, s):
        return transition(s, "circuit_open")

    def fatal_error(self, s):
        return transition(s, "fatal_error")
