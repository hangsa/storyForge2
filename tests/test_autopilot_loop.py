"""Tests for AutopilotLoopService: lifecycle + crash recovery.

Spec: docs/superpowers/specs/2026-07-14-v1.9-autopilot-runner-wiring-design.md §4C, §4E.
"""
from __future__ import annotations
import asyncio
import json
from pathlib import Path
import pytest

from backend.conductor.autopilot_loop import AutopilotLoopService


@pytest.fixture
def projects_dir(tmp_path: Path):
    (tmp_path / "p1").mkdir(parents=True, exist_ok=True)
    (tmp_path / "p1" / "project.json").write_text(
        json.dumps({"id": "p1"}), encoding="utf-8"
    )
    return tmp_path


class TestLoopLifecycle:
    @pytest.mark.asyncio
    async def test_ensure_is_idempotent(self, projects_dir):
        from backend.conductor.autopilot_session import AutopilotSessionManager
        from backend.models.autopilot_session import ManagedStartConfig
        svc = AutopilotLoopService()
        mgr = AutopilotSessionManager(projects_dir, "p1")
        # Stub executor that does nothing.
        class StubExec:
            async def execute(self, item, project_id):
                return {"status": "ok"}
        # Outline has 0 chapters → seed_queue returns 0 → no task spawned.
        (projects_dir / "p1" / "outline.json").write_text(
            json.dumps({"chapters": []}), encoding="utf-8"
        )
        await svc.ensure("p1", mgr, StubExec(), ManagedStartConfig())
        await svc.ensure("p1", mgr, StubExec(), ManagedStartConfig())
        assert svc.is_running("p1") is False  # nothing to do

    @pytest.mark.asyncio
    async def test_cancel_on_unknown_project_is_noop(self):
        svc = AutopilotLoopService()
        await svc.cancel("nonexistent")  # must not raise

    @pytest.mark.asyncio
    async def test_two_projects_have_independent_tasks(self, projects_dir):
        from backend.conductor.autopilot_session import AutopilotSessionManager
        from backend.models.autopilot_session import ManagedStartConfig
        # Seed outlines for BOTH projects so seed_queue returns >0 and ensure()
        # actually spawns a task. Without these, seed_queue returns 0 → ensure()
        # calls mgr.stop() and never adds to _tasks, breaking the assertion.
        for pid in ("p1", "p2"):
            (projects_dir / pid).mkdir(parents=True, exist_ok=True)
            (projects_dir / pid / "outline.json").write_text(
                json.dumps({"chapters": [
                    {"chapter_number": 1, "scene_plan": [
                        {"scene_number": 1, "goal": "", "conflict": ""},
                    ]},
                ]}), encoding="utf-8"
            )
        svc = AutopilotLoopService()
        mgr1 = AutopilotSessionManager(projects_dir, "p1")
        mgr2 = AutopilotSessionManager(projects_dir, "p2")
        class StubExec:
            async def execute(self, item, project_id):
                return {"status": "ok"}
        await svc.ensure("p1", mgr1, StubExec(), ManagedStartConfig())
        await svc.ensure("p2", mgr2, StubExec(), ManagedStartConfig())
        assert "p1" in svc._tasks
        assert "p2" in svc._tasks
        assert svc._tasks["p1"] is not svc._tasks["p2"]
        # Cleanup: cancel tasks so they don't leak between tests.
        await svc.cancel("p1")
        await svc.cancel("p2")


class TestCrashRecovery:
    @pytest.mark.asyncio
    async def test_only_running_sessions_are_recovered(self, projects_dir):
        # Two projects: one running, one paused.
        for pid, state in [("p_run", "running"), ("p_pause", "paused")]:
            (projects_dir / pid).mkdir(parents=True, exist_ok=True)
            (projects_dir / pid / "autopilot").mkdir(parents=True, exist_ok=True)
            # Outline so ensure() seeds a non-zero queue and spawns a task.
            (projects_dir / pid / "outline.json").write_text(
                json.dumps({"chapters": [
                    {"chapter_number": 1, "scene_plan": [
                        {"scene_number": 1, "goal": "", "conflict": ""},
                    ]},
                ]}), encoding="utf-8"
            )
            (projects_dir / pid / "autopilot" / "session.json").write_text(json.dumps({
                "project_id": pid, "state": state,
                "config": {"scope": "all_planned", "cadence": "balanced",
                           "policy": "auto", "notify": "milestones"},
                "started_at": None, "last_heartbeat_at": None,
                "current_task": None, "queue": [], "history": [],
                "circuit": {"force_pass_count": 0, "last_event_at": None,
                            "threshold_warning": False},
            }), encoding="utf-8")

        svc = AutopilotLoopService()
        await svc.recover_running_sessions(projects_dir)
        # p_run has no heartbeat → downgraded to paused (Layer 2 fix).
        # p_pause is already paused → left as-is.
        assert svc.is_running("p_run") is False
        assert svc.is_running("p_pause") is False
        # Both session files should now be in 'paused' state.
        for pid in ("p_run", "p_pause"):
            payload = json.loads(
                (projects_dir / pid / "autopilot" / "session.json").read_text(encoding="utf-8")
            )
            assert payload["state"] == "paused", f"{pid} should be paused, got {payload['state']}"

    @pytest.mark.asyncio
    async def test_running_session_with_no_heartbeat_is_downgraded(self, projects_dir):
        """A running session with last_heartbeat_at == None must be downgraded
        to paused on recovery. The Layer 1 heartbeat fix means fresh sessions
        always have a heartbeat; None implies the runner died before the
        heartbeat was ever added (i.e., a pre-Layer-1 crashed session)."""
        from datetime import datetime, timezone
        pid = "p_no_hb"
        (projects_dir / pid).mkdir(parents=True, exist_ok=True)
        (projects_dir / pid / "autopilot").mkdir(parents=True, exist_ok=True)
        (projects_dir / pid / "outline.json").write_text(
            json.dumps({"chapters": [
                {"chapter_number": 1, "scene_plan": [
                    {"scene_number": 1, "goal": "", "conflict": ""},
                ]},
            ]}), encoding="utf-8"
        )
        (projects_dir / pid / "autopilot" / "session.json").write_text(json.dumps({
            "project_id": pid, "state": "running",
            "config": {"scope": "all_planned", "cadence": "balanced",
                       "policy": "auto", "notify": "milestones"},
            "started_at": None, "last_heartbeat_at": None,
            "current_task": None, "queue": [], "history": [],
            "circuit": {"force_pass_count": 0, "last_event_at": None,
                        "threshold_warning": False},
        }), encoding="utf-8")

        svc = AutopilotLoopService()
        await svc.recover_running_sessions(projects_dir)
        # No task should be spawned for a stale session.
        assert svc.is_running(pid) is False
        assert pid not in svc._tasks
        # Session file should be downgraded to 'paused'.
        payload = json.loads(
            (projects_dir / pid / "autopilot" / "session.json").read_text(encoding="utf-8")
        )
        assert payload["state"] == "paused"

    @pytest.mark.asyncio
    async def test_running_session_with_stale_heartbeat_is_downgraded(self, projects_dir):
        """A running session whose last_heartbeat_at is older than
        STALE_HEARTBEAT_SECONDS must be downgraded to paused."""
        from datetime import datetime, timezone, timedelta
        pid = "p_stale"
        (projects_dir / pid).mkdir(parents=True, exist_ok=True)
        (projects_dir / pid / "autopilot").mkdir(parents=True, exist_ok=True)
        (projects_dir / pid / "outline.json").write_text(
            json.dumps({"chapters": [
                {"chapter_number": 1, "scene_plan": [
                    {"scene_number": 1, "goal": "", "conflict": ""},
                ]},
            ]}), encoding="utf-8"
        )
        stale_ts = (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()
        (projects_dir / pid / "autopilot" / "session.json").write_text(json.dumps({
            "project_id": pid, "state": "running",
            "config": {"scope": "all_planned", "cadence": "balanced",
                       "policy": "auto", "notify": "milestones"},
            "started_at": None, "last_heartbeat_at": stale_ts,
            "current_task": None, "queue": [], "history": [],
            "circuit": {"force_pass_count": 0, "last_event_at": None,
                        "threshold_warning": False},
        }), encoding="utf-8")

        svc = AutopilotLoopService()
        await svc.recover_running_sessions(projects_dir)
        assert svc.is_running(pid) is False
        assert pid not in svc._tasks
        payload = json.loads(
            (projects_dir / pid / "autopilot" / "session.json").read_text(encoding="utf-8")
        )
        assert payload["state"] == "paused"

    @pytest.mark.asyncio
    async def test_running_session_with_fresh_heartbeat_is_resumed(self, projects_dir):
        """Regression: a running session with a fresh last_heartbeat_at should
        still be resumed by ensure()."""
        from datetime import datetime, timezone, timedelta
        pid = "p_fresh"
        (projects_dir / pid).mkdir(parents=True, exist_ok=True)
        (projects_dir / pid / "autopilot").mkdir(parents=True, exist_ok=True)
        (projects_dir / pid / "outline.json").write_text(
            json.dumps({"chapters": [
                {"chapter_number": 1, "scene_plan": [
                    {"scene_number": 1, "goal": "", "conflict": ""},
                ]},
            ]}), encoding="utf-8"
        )
        fresh_ts = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
        (projects_dir / pid / "autopilot" / "session.json").write_text(json.dumps({
            "project_id": pid, "state": "running",
            "config": {"scope": "all_planned", "cadence": "balanced",
                       "policy": "auto", "notify": "milestones"},
            "started_at": None, "last_heartbeat_at": fresh_ts,
            "current_task": None, "queue": [], "history": [],
            "circuit": {"force_pass_count": 0, "last_event_at": None,
                        "threshold_warning": False},
        }), encoding="utf-8")

        svc = AutopilotLoopService()
        await svc.recover_running_sessions(projects_dir)
        # Fresh heartbeat → task should be spawned via ensure().
        assert svc.is_running(pid) is True
        # Session file should remain in 'running' state.
        payload = json.loads(
            (projects_dir / pid / "autopilot" / "session.json").read_text(encoding="utf-8")
        )
        assert payload["state"] == "running"
        # Cleanup
        await svc.cancel(pid)