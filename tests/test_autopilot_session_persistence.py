"""Persistence tests for AutopilotSessionManager (write-through JSON).
Spec: docs/design/storyForge-design-v1.9.md §四 F1.9.1, L284-287.
"""
from __future__ import annotations
import json
from pathlib import Path
import pytest

from backend.conductor.autopilot_session import AutopilotSessionManager
from backend.models.autopilot_session import (
    SessionState, ManagedStartConfig, CurrentTask, QueueItem,
)


@pytest.fixture
def projects_dir(tmp_path: Path) -> Path:
    return tmp_path


class TestFileCreation:
    def test_start_creates_session_file(self, projects_dir):
        mgr = AutopilotSessionManager(projects_dir, "p1")
        s = mgr.start(ManagedStartConfig())
        assert s.state == SessionState.RUNNING
        path = projects_dir / "p1" / "autopilot" / "session.json"
        assert path.exists()

    def test_session_file_has_full_shape(self, projects_dir):
        mgr = AutopilotSessionManager(projects_dir, "p1")
        mgr.start(ManagedStartConfig())
        raw = json.loads((projects_dir / "p1" / "autopilot" / "session.json").read_text())
        for key in ("project_id", "state", "config", "started_at",
                    "last_heartbeat_at", "current_task", "queue", "history", "circuit"):
            assert key in raw, f"missing key {key!r}"
        assert raw["state"] == "running"
        assert raw["history"][-1]["type"] == "task_start"
        assert raw["circuit"]["force_pass_count"] == 0


class TestLoad:
    def test_load_returns_none_if_no_file(self, projects_dir):
        mgr = AutopilotSessionManager(projects_dir, "missing")
        assert mgr.load() is None

    def test_load_restores_in_progress_session(self, projects_dir):
        mgr1 = AutopilotSessionManager(projects_dir, "p2")
        mgr1.start(ManagedStartConfig())
        mgr1.pause()
        # New manager = simulate server restart
        mgr2 = AutopilotSessionManager(projects_dir, "p2")
        s = mgr2.load()
        assert s.state == SessionState.PAUSED
        assert s.config.scope == "all_planned"

    def test_load_preserves_history(self, projects_dir):
        mgr = AutopilotSessionManager(projects_dir, "p3")
        mgr.start(ManagedStartConfig())
        mgr.pause()
        mgr.resume()
        s = AutopilotSessionManager(projects_dir, "p3").load()
        types = [e.type for e in s.history]
        assert "task_start" in types and "checkpoint" in types


class TestStateTransitionsPersist:
    def test_pause_writes_through(self, projects_dir):
        mgr = AutopilotSessionManager(projects_dir, "p4")
        mgr.start(ManagedStartConfig())
        mgr.pause()
        raw = json.loads((projects_dir / "p4" / "autopilot" / "session.json").read_text())
        assert raw["state"] == "paused"

    def test_stop_clears_current_task_and_persists(self, projects_dir):
        mgr = AutopilotSessionManager(projects_dir, "p5")
        mgr.start(ManagedStartConfig())
        mgr.set_current_task(CurrentTask(
            kind="write_scene", chapter_number=1, scene_id="1-1",
            status="active", started_at="2026-07-12T00:00:00Z", description="X",
        ))
        mgr.stop()
        raw = json.loads((projects_dir / "p5" / "autopilot" / "session.json").read_text())
        assert raw["state"] == "stopped"
        assert raw["current_task"] is None


class TestAtomicWrites:
    def test_no_tmp_file_leaks_after_write(self, projects_dir):
        """No half-written session.json remains if manager crashes mid-write."""
        mgr = AutopilotSessionManager(projects_dir, "p6")
        mgr.start(ManagedStartConfig())
        leaked = list((projects_dir / "p6" / "autopilot").glob("*.tmp"))
        assert leaked == []

    def test_overwrite_replaces_existing_file(self, projects_dir):
        mgr = AutopilotSessionManager(projects_dir, "p7")
        mgr.start(ManagedStartConfig())
        mgr.pause()
        mgr.stop()
        mgr.start(ManagedStartConfig())
        assert mgr.load().state == SessionState.RUNNING


class TestHeartbeat:
    def test_heartbeat_updates_last_heartbeat_at(self, projects_dir):
        mgr = AutopilotSessionManager(projects_dir, "p8")
        mgr.start(ManagedStartConfig())
        before = mgr.load().last_heartbeat_at
        import time
        time.sleep(0.05)
        mgr.heartbeat()
        after = mgr.load().last_heartbeat_at
        assert after is not None and after != before


class TestIntervene:
    def test_intervene_stop_current_task_clears_task(self, projects_dir):
        mgr = AutopilotSessionManager(projects_dir, "p9")
        mgr.start(ManagedStartConfig())
        mgr.set_current_task(CurrentTask(
            kind="write_scene", chapter_number=2, scene_id="2-1",
            status="active", started_at="2026-07-12T00:00:00Z", description="Y",
        ))
        mgr.intervene("stop_current_task")
        s = mgr.load()
        assert s.current_task is None
        assert s.state == SessionState.RUNNING

    def test_intervene_pause_immediate_pauses_running(self, projects_dir):
        mgr = AutopilotSessionManager(projects_dir, "p10")
        mgr.start(ManagedStartConfig())
        mgr.intervene("pause_immediate")
        assert mgr.load().state == SessionState.PAUSED

    def test_intervene_unknown_action_raises(self, projects_dir):
        mgr = AutopilotSessionManager(projects_dir, "p11")
        with pytest.raises(ValueError):
            mgr.intervene("bogus")

    def test_intervene_rollback_to_checkpoint_pauses(self, projects_dir):
        """Stage 1 stub: rollback just pauses. Stage 2 restores from CheckpointManager."""
        mgr = AutopilotSessionManager(projects_dir, "p12")
        mgr.start(ManagedStartConfig())
        mgr.intervene("rollback_checkpoint")
        assert mgr.load().state == SessionState.PAUSED


class TestIdempotency:
    def test_start_when_already_running_is_noop(self, projects_dir):
        mgr = AutopilotSessionManager(projects_dir, "p13")
        mgr.start(ManagedStartConfig())
        mgr.start(ManagedStartConfig())  # second start
        events = [e for e in mgr.load().history if e.type == "task_start"]
        assert len(events) == 1

    def test_stop_when_already_stopped_is_noop(self, projects_dir):
        mgr = AutopilotSessionManager(projects_dir, "p14")
        mgr.start(ManagedStartConfig())
        mgr.stop()
        mgr.stop()  # second stop
        completes = [e for e in mgr.load().history if e.type == "task_complete"]
        assert len(completes) == 1


class TestSsePublish:
    def test_state_transition_publishes_to_broadcaster(self, tmp_path):
        """A start() call must publish its transition event to the broadcaster."""
        from backend.conductor.autopilot_session import AutopilotSessionManager
        from backend.utils.sse_broadcaster import SSEBroadcaster
        from backend.models.autopilot_session import ManagedStartConfig

        (tmp_path / "p1").mkdir(parents=True, exist_ok=True)
        (tmp_path / "p1" / "project.json").write_text('{"id":"p1"}', encoding="utf-8")

        bc = SSEBroadcaster(history_size=16, queue_max=4)
        mgr = AutopilotSessionManager(tmp_path, "p1", broadcaster=bc)
        mgr.start(ManagedStartConfig())
        published = [ev for ev in bc.history if ev.event == "task_start"]
        assert len(published) >= 1
        assert published[-1].data["type"] == "task_start"

    def test_add_queue_publishes_queue_add_event(self, tmp_path):
        from backend.conductor.autopilot_session import AutopilotSessionManager
        from backend.models.autopilot_session import ManagedStartConfig, QueueItem
        from backend.utils.sse_broadcaster import SSEBroadcaster

        (tmp_path / "p1").mkdir(parents=True, exist_ok=True)
        (tmp_path / "p1" / "project.json").write_text('{"id":"p1"}', encoding="utf-8")

        bc = SSEBroadcaster(history_size=16, queue_max=4)
        mgr = AutopilotSessionManager(tmp_path, "p1", broadcaster=bc)
        mgr.start(ManagedStartConfig())
        mgr.add_queue(QueueItem(id="q1", kind="write_scene", chapter_number=1,
                                scheduled_at=None, priority=1, payload={}))
        kinds = [ev.data.get("type") for ev in bc.history]
        assert "queue_add" in kinds

    def test_no_broadcaster_does_not_crash(self, tmp_path):
        """When constructed without a broadcaster, writes still succeed."""
        from backend.conductor.autopilot_session import AutopilotSessionManager
        from backend.models.autopilot_session import ManagedStartConfig

        (tmp_path / "p1").mkdir(parents=True, exist_ok=True)
        (tmp_path / "p1" / "project.json").write_text('{"id":"p1"}', encoding="utf-8")

        mgr = AutopilotSessionManager(tmp_path, "p1")  # no broadcaster
        s = mgr.start(ManagedStartConfig())
        assert s.state.value == "running"
