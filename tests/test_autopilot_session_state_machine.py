"""Unit tests for AutopilotSession state transitions (pure, no I/O).
Spec: docs/design/storyForge-design-v1.9.md §四 F1.9.1, L253-264.
"""
from __future__ import annotations
from datetime import datetime, timezone
import pytest

from backend.models.autopilot_session import (
    SessionState, ManagedStartConfig, CurrentTask, QueueItem,
    SessionEvent, CircuitSnapshot, AutopilotSession,
    transition, set_current_task, complete_current_task,
    add_queue_item, drop_queue_item, InvalidTransition,
)


def make_session(state: SessionState = SessionState.IDLE, **overrides) -> AutopilotSession:
    defaults: dict = {
        "project_id": "p1",
        "state": state,
        "config": ManagedStartConfig(),
        "started_at": None,
        "last_heartbeat_at": None,
        "current_task": None,
        "queue": [],
        "history": [],
        "circuit": CircuitSnapshot(),
    }
    defaults.update(overrides)
    return AutopilotSession(**defaults)


# --- LITERAL state-transition matrix from spec L253-264 ---
VALID_TRANSITIONS = [
    ("idle", "start", "running"),
    ("idle", "stop", "stopped"),
    ("running", "pause", "paused"),
    ("running", "stop", "stopped"),
    ("running", "circuit_open", "paused"),
    ("running", "fatal_error", "error"),
    ("paused", "resume", "running"),
    ("paused", "start", "running"),
    ("paused", "stop", "stopped"),
    ("stopped", "start", "running"),
    ("error", "start", "running"),  # error → idle → running (collapses to running)
]

INVALID_TRANSITIONS = [
    ("idle", "pause"),
    ("idle", "resume"),
    ("running", "start"),
    ("running", "resume"),
    ("paused", "pause"),
    ("stopped", "resume"),
    ("stopped", "pause"),
    ("stopped", "stop"),
    ("error", "resume"),
    ("error", "pause"),
    ("error", "stop"),
]


@pytest.mark.parametrize("from_state,trigger,expected", VALID_TRANSITIONS)
def test_valid_transition_changes_state(from_state, trigger, expected):
    s = make_session(SessionState(from_state))
    s2 = transition(s, trigger)
    assert s2.state == SessionState(expected)


@pytest.mark.parametrize("from_state,trigger", INVALID_TRANSITIONS)
def test_invalid_transition_raises(from_state, trigger):
    s = make_session(SessionState(from_state))
    with pytest.raises(InvalidTransition):
        transition(s, trigger)


# --- Specific shape assertions ---

class TestStartTransition:
    def test_start_from_idle_sets_started_at_and_appends_task_start(self):
        s = make_session(SessionState.IDLE)
        s2 = transition(s, "start")
        assert s2.started_at is not None
        datetime.fromisoformat(s2.started_at)  # ISO8601 parseable
        assert s2.history[-1].type == "task_start"

    def test_start_from_stopped_reuses_existing_config(self):
        cfg = ManagedStartConfig(scope="next_chapter", cadence="careful", policy="ask", notify="all")
        s = make_session(SessionState.STOPPED, config=cfg)
        s2 = transition(s, "start")
        assert s2.config.scope == cfg.scope  # spec L261: 沿用旧 config

    def test_start_from_error_clears_error_state(self):
        s = make_session(SessionState.ERROR)
        s2 = transition(s, "start")
        assert s2.state == SessionState.RUNNING


class TestStopTransition:
    def test_stop_clears_current_task(self):
        task = CurrentTask(
            kind="write_scene", chapter_number=1, scene_id="1-1",
            status="active", started_at="2026-07-12T00:00:00Z",
            description="写作第 1 章第 1 幕",
        )
        s = make_session(SessionState.RUNNING, current_task=task)
        s2 = transition(s, "stop")
        assert s2.state == SessionState.STOPPED
        assert s2.current_task is None
        assert s2.history[-1].type == "task_complete"

    def test_stop_preserves_queue(self):
        s = make_session(SessionState.RUNNING)
        s = add_queue_item(s, QueueItem(
            id="q1", kind="fact_guard", chapter_number=3,
            scheduled_at=None, priority=1, payload={},
        ))
        s2 = transition(s, "stop")
        assert len(s2.queue) == 1


class TestPauseResume:
    def test_pause_preserves_current_task(self):
        task = CurrentTask(
            kind="write_scene", chapter_number=2, scene_id="2-1",
            status="active", started_at="2026-07-12T00:00:00Z", description="X",
        )
        s = make_session(SessionState.RUNNING, current_task=task)
        s2 = transition(s, "pause")
        assert s2.state == SessionState.PAUSED
        assert s2.current_task is not None  # spec L273: preserved
        assert s2.history[-1].type == "checkpoint"

    def test_resume_from_paused_returns_to_running(self):
        s = make_session(SessionState.PAUSED)
        s2 = transition(s, "resume")
        assert s2.state == SessionState.RUNNING
        assert s2.history[-1].type == "task_start"


class TestCircuitAndFatal:
    def test_circuit_open_auto_pauses_running_session(self):
        s = make_session(SessionState.RUNNING)
        s2 = transition(s, "circuit_open")
        assert s2.state == SessionState.PAUSED
        assert any(e.type == "circuit_open" for e in s2.history)

    def test_fatal_error_lands_in_error_state(self):
        s = make_session(SessionState.RUNNING)
        s2 = transition(s, "fatal_error")
        assert s2.state == SessionState.ERROR
        assert any(e.type == "task_fail" for e in s2.history)


# --- Queue ops ---

class TestQueueOperations:
    def test_add_queue_item_orders_by_priority_low_first(self):
        s = make_session()
        s = add_queue_item(s, QueueItem(id="q1", kind="fact_guard", chapter_number=3,
                                        scheduled_at=None, priority=2, payload={}))
        s = add_queue_item(s, QueueItem(id="q2", kind="plan_chapter", chapter_number=4,
                                        scheduled_at=None, priority=1, payload={}))
        # spec L235: "越低越靠前"
        assert s.queue[0].id == "q2"
        assert s.queue[1].id == "q1"

    def test_drop_queue_item_removes_and_logs(self):
        s = make_session()
        s = add_queue_item(s, QueueItem(id="q1", kind="fact_guard", chapter_number=3,
                                        scheduled_at=None, priority=1, payload={}))
        s = drop_queue_item(s, "q1")
        assert s.queue == []
        assert s.history[-1].type == "queue_drop"

    def test_drop_unknown_id_is_noop(self):
        s = make_session()
        s = drop_queue_item(s, "nonexistent")
        assert s.queue == []


# --- Current task lifecycle ---

class TestCurrentTaskLifecycle:
    def test_set_current_task_round_trip(self):
        s = make_session(SessionState.RUNNING)
        task = CurrentTask(kind="write_scene", chapter_number=7, scene_id="7-2",
                           status="active", started_at="2026-07-12T00:00:00Z",
                           description="写作第 7 章第 2 幕", progress_pct=42)
        s = set_current_task(s, task)
        assert s.current_task.description == "写作第 7 章第 2 幕"
        assert s.current_task.progress_pct == 42

    def test_complete_current_task_appends_event_and_clears(self):
        task = CurrentTask(kind="write_scene", chapter_number=1, scene_id="1-1",
                           status="active", started_at="2026-07-12T00:00:00Z",
                           description="X")
        s = make_session(SessionState.RUNNING, current_task=task)
        s = complete_current_task(s)
        assert s.current_task is None
        assert s.history[-1].type == "task_complete"


# --- History invariants ---

class TestHistoryInvariants:
    def test_every_transition_appends_exactly_one_event(self):
        s = make_session(SessionState.IDLE)
        s = transition(s, "start")
        s = transition(s, "pause")
        s = transition(s, "resume")
        s = transition(s, "stop")
        # task_start, checkpoint, task_start, task_complete = 4
        assert len(s.history) == 4
        assert [e.type for e in s.history] == ["task_start", "checkpoint", "task_start", "task_complete"]

    def test_history_event_has_unique_id_and_iso8601_at(self):
        s = make_session(SessionState.IDLE)
        s = transition(s, "start")
        s = transition(s, "pause")
        ids = [e.id for e in s.history]
        assert len(ids) == len(set(ids))
        for e in s.history:
            datetime.fromisoformat(e.at)


class TestCircuitSnapshot:
    def test_defaults(self):
        cs = CircuitSnapshot()
        assert cs.force_pass_count == 0
        assert cs.last_event_at is None
        assert cs.threshold_warning is False


class TestSessionStateMachineClass:
    """The class is a thin wrapper over free functions — single import surface."""

    def test_class_imports_cleanly(self):
        from backend.models.autopilot_session import SessionStateMachine
        assert SessionStateMachine() is not None

    def test_pause_resume_stop_chain(self):
        from backend.models.autopilot_session import SessionStateMachine
        sm = SessionStateMachine()
        s = make_session(SessionState.RUNNING)
        s = sm.pause(s)
        assert s.state == SessionState.PAUSED
        s = sm.resume(s)
        assert s.state == SessionState.RUNNING
        s = sm.stop(s)
        assert s.state == SessionState.STOPPED

    def test_circuit_open_method_pauses(self):
        from backend.models.autopilot_session import SessionStateMachine
        sm = SessionStateMachine()
        s = make_session(SessionState.RUNNING)
        s = sm.circuit_open(s)
        assert s.state == SessionState.PAUSED
        assert any(e.type == "circuit_open" for e in s.history)

    def test_fatal_error_method(self):
        from backend.models.autopilot_session import SessionStateMachine
        sm = SessionStateMachine()
        s = make_session(SessionState.RUNNING)
        assert sm.fatal_error(s).state == SessionState.ERROR

    def test_invalid_trigger_raises_invalid_transition(self):
        from backend.models.autopilot_session import SessionStateMachine
        sm = SessionStateMachine()
        with pytest.raises(InvalidTransition):
            sm.pause(make_session(SessionState.IDLE))


class TestFailCurrentTask:
    def test_emits_task_fail_event(self):
        from backend.models.autopilot_session import (
            AutopilotSession, CircuitSnapshot, CurrentTask, ManagedStartConfig,
            SessionState, fail_current_task,
        )
        s = AutopilotSession(
            project_id="p1", state=SessionState.RUNNING,
            config=ManagedStartConfig(), started_at=None,
            last_heartbeat_at=None,
            current_task=CurrentTask(
                kind="write_scene", chapter_number=1, scene_id=None,
                status="active", started_at="2026-07-15T00:00:00Z",
                description="writing chapter 1 scene 1",
            ),
            queue=[], history=[], circuit=CircuitSnapshot(),
        )
        s2 = fail_current_task(s, error="LLM 5xx")
        assert s2.current_task is None
        assert len(s2.history) == 1
        assert s2.history[0].type == "task_fail"
        assert s2.history[0].payload == {"error": "LLM 5xx"}

    def test_no_op_when_no_current_task(self):
        from backend.models.autopilot_session import (
            AutopilotSession, CircuitSnapshot, ManagedStartConfig,
            SessionState, fail_current_task,
        )
        s = AutopilotSession(
            project_id="p1", state=SessionState.RUNNING,
            config=ManagedStartConfig(), started_at=None,
            last_heartbeat_at=None, current_task=None,
            queue=[], history=[], circuit=CircuitSnapshot(),
        )
        s2 = fail_current_task(s, error="orphan fail")
        assert s2.history == []
