"""Tests for AutopilotRunner — bridge between session and executor.
Spec: docs/design/storyForge-design-v1.9.md §四 F1.9.1, L282.
"""
from __future__ import annotations
import json
from pathlib import Path
import pytest

from backend.conductor.autopilot_session import AutopilotSessionManager
from backend.conductor.autopilot_runner import AutopilotRunner, RecordingExecutor
from backend.models.autopilot_session import (
    ManagedStartConfig, QueueItem, SessionState,
)


@pytest.fixture
def projects_dir(tmp_path: Path) -> Path:
    (tmp_path / "p1").mkdir(parents=True, exist_ok=True)
    (tmp_path / "p1" / "project.json").write_text(json.dumps({
        "id": "p1", "title": "T", "current_stage": "STAGE4",
    }), encoding="utf-8")
    return tmp_path


@pytest.fixture
def mgr(projects_dir: Path) -> AutopilotSessionManager:
    return AutopilotSessionManager(projects_dir, "p1")


@pytest.fixture
def executor() -> RecordingExecutor:
    return RecordingExecutor()


class TestPickNext:
    def test_returns_lowest_priority_first(self, mgr, executor):
        mgr.start(ManagedStartConfig())
        mgr.add_queue(QueueItem(id="q_high", kind="fact_guard", chapter_number=3,
                                scheduled_at=None, priority=10, payload={}))
        mgr.add_queue(QueueItem(id="q_low", kind="plan_chapter", chapter_number=4,
                                scheduled_at=None, priority=1, payload={}))
        runner = AutopilotRunner(mgr, executor)
        assert runner.pick_next(mgr.load()).id == "q_low"

    def test_returns_none_when_empty(self, mgr, executor):
        mgr.start(ManagedStartConfig())
        assert AutopilotRunner(mgr, executor).pick_next(mgr.load()) is None


class TestStep:
    def test_step_picks_sets_and_completes_task(self, mgr, executor):
        mgr.start(ManagedStartConfig())
        mgr.add_queue(QueueItem(id="q1", kind="fact_guard", chapter_number=3,
                                scheduled_at=None, priority=1, payload={"scene": "1-1"}))
        result = AutopilotRunner(mgr, executor).step()
        assert result["picked"] == "q1"
        assert result["completed"] is True
        s = mgr.load()
        assert s.current_task is None
        assert s.queue == []

    def test_step_noop_when_session_not_running(self, mgr, executor):
        result = AutopilotRunner(mgr, executor).step()
        assert result["picked"] is None
        assert result["completed"] is False


class TestExecutorContract:
    def test_executor_sees_queue_item(self, mgr, executor):
        mgr.start(ManagedStartConfig())
        mgr.add_queue(QueueItem(id="q1", kind="review", chapter_number=2,
                                scheduled_at=None, priority=1, payload={"chapter": 2}))
        AutopilotRunner(mgr, executor).step()
        assert any(call["item_id"] == "q1" for call in executor.calls)


class TestRecordForcePass:
    def test_increments_circuit_count(self, mgr, executor):
        mgr.start(ManagedStartConfig())
        runner = AutopilotRunner(mgr, executor)
        runner.record_force_pass()
        runner.record_force_pass()
        assert mgr.load().circuit.force_pass_count == 2
