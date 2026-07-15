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
        # Only the running one was resumed (paused stays paused, recovered on user action).
        assert svc.is_running("p_run") is True
        assert svc.is_running("p_pause") is False
        # Cleanup
        await svc.cancel("p_run")