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
    def test_construct_without_current_event_loop(self):
        policy = asyncio.get_event_loop_policy()
        try:
            previous_loop = policy.get_event_loop()
        except RuntimeError:
            previous_loop = None
        policy.set_event_loop(None)
        try:
            svc = AutopilotLoopService()
        finally:
            policy.set_event_loop(previous_loop)
        assert svc.is_running("p1") is False

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

# --- ensure() return contract -------------------------------------------------
# Found 2026-07-17: clicking "启动托管" on a project with all chapters already
# complete looks broken — the session flips running→stopped in ~50ms with no
# feedback. ensure() now returns a string so the API can surface a friendly
# "project all done" message instead.

class TestEnsureReturnContract:
    @pytest.mark.asyncio
    async def test_ensure_returns_started_when_seeded(self, projects_dir):
        from backend.conductor.autopilot_session import AutopilotSessionManager
        from backend.models.autopilot_session import ManagedStartConfig, SessionState
        # Outline with one unfinished chapter so seed_queue returns > 0.
        (projects_dir / "p1" / "outline.json").write_text(
            json.dumps({
                "chapters": [{
                    "chapter_number": 1,
                    "scene_plan": [{"scene_number": 1}, {"scene_number": 2}],
                }],
            }),
            encoding="utf-8",
        )
        svc = AutopilotLoopService()
        mgr = AutopilotSessionManager(projects_dir, "p1")
        mgr.start(ManagedStartConfig())

        class StubExec:
            async def execute(self, item, project_id):
                return {"status": "ok"}
        result = await svc.ensure("p1", mgr, StubExec(), ManagedStartConfig())
        assert result.outcome == "started"
        assert svc.is_running("p1") is True
        await svc.cancel("p1")

    @pytest.mark.asyncio
    async def test_ensure_returns_no_work_to_do_when_all_complete(self, projects_dir):
        from backend.conductor.autopilot_session import AutopilotSessionManager
        from backend.models.autopilot_session import ManagedStartConfig, SessionState
        # Outline + progress where every scene is already completed.
        (projects_dir / "p1" / "outline.json").write_text(
            json.dumps({
                "chapters": [{
                    "chapter_number": 1,
                    "scene_plan": [{"scene_number": 1}],
                }],
            }),
            encoding="utf-8",
        )
        (projects_dir / "p1" / "progress.json").write_text(
            json.dumps({
                "current_chapter": 2,
                "chapters": [{
                    "chapter_number": 1,
                    "status": "completed",
                    "scenes": [{"scene_number": 1, "status": "completed"}],
                }],
            }),
            encoding="utf-8",
        )
        svc = AutopilotLoopService()
        mgr = AutopilotSessionManager(projects_dir, "p1")
        mgr.start(ManagedStartConfig())

        class StubExec:
            async def execute(self, item, project_id):
                return {"status": "ok"}
        result = await svc.ensure("p1", mgr, StubExec(), ManagedStartConfig())
        assert result.outcome == "no_work_to_do"
        assert result.seed_result.enqueued == 0
        assert result.repaired_chapters == []
        # Critical: session MUST be stopped in this branch so the state
        # machine is consistent (otherwise a subsequent /start would flip
        # the state again and seed_queue would still return 0, creating
        # the original "click does nothing" bug).
        assert mgr.load().state == SessionState.STOPPED
        assert svc.is_running("p1") is False

    @pytest.mark.asyncio
    async def test_ensure_repairs_stuck_chapters_before_seed(self, projects_dir):
        """Bug 2026-07-17 proj_cc4ca4ae: chapters 21-30 had status='in_progress'
        in progress.json but every scene was 'completed'. ensure() must
        auto-repair those before seeding so seed_queue sees the corrected
        state. Repaired chapters are returned in the result so the API can
        surface them in the no_work_to_do toast / response."""
        from backend.conductor.autopilot_session import AutopilotSessionManager
        from backend.models.autopilot_session import ManagedStartConfig
        # Outline says ch2 has 2 scenes; progress says ch2 is in_progress
        # with both scenes completed → repair should flip it. ch3 is
        # genuinely unfinished, so seed_queue enqueues it (and ch2 is
        # already correct post-repair, so no scene there).
        (projects_dir / "p1" / "outline.json").write_text(json.dumps({
            "chapters": [
                {"chapter_number": 2, "scene_plan": [
                    {"scene_number": 1}, {"scene_number": 2},
                ]},
                {"chapter_number": 3, "scene_plan": [
                    {"scene_number": 1},
                ]},
            ],
        }), encoding="utf-8")
        (projects_dir / "p1" / "progress.json").write_text(json.dumps({
            "current_chapter": 2,
            "chapters": [
                {"chapter_number": 2, "status": "in_progress", "scenes": [
                    {"scene_number": 1, "status": "completed"},
                    {"scene_number": 2, "status": "completed"},
                ]},
                {"chapter_number": 3, "status": "in_progress", "scenes": [
                    {"scene_number": 1, "status": "in_progress"},
                ]},
            ],
        }), encoding="utf-8")
        svc = AutopilotLoopService()
        mgr = AutopilotSessionManager(projects_dir, "p1")
        mgr.start(ManagedStartConfig())

        class StubExec:
            async def execute(self, item, project_id):
                return {"status": "ok"}

        result = await svc.ensure("p1", mgr, StubExec(), ManagedStartConfig())
        assert result.outcome == "started"
        assert result.repaired_chapters == [2]
        # The repair is persisted to disk so subsequent reads see it.
        from pathlib import Path
        persisted = json.loads(
            (Path(projects_dir) / "p1" / "progress.json").read_text()
        )
        ch2 = next(c for c in persisted["chapters"] if c["chapter_number"] == 2)
        assert ch2["status"] == "completed"
        await svc.cancel("p1")

    @pytest.mark.asyncio
    async def test_ensure_returns_seed_result_with_fallback_info(self, projects_dir):
        """When seed_queue auto-fallbacks from next_chapter to all_planned,
        the API needs to know so it can show the user a clear message
        instead of 'all done'."""
        from backend.conductor.autopilot_session import AutopilotSessionManager
        from backend.models.autopilot_session import ManagedStartConfig
        (projects_dir / "p1" / "outline.json").write_text(json.dumps({
            "chapters": [
                {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
                {"chapter_number": 2, "scene_plan": [{"scene_number": 1}]},
                {"chapter_number": 3, "scene_plan": [{"scene_number": 1}]},
            ],
        }), encoding="utf-8")
        # current_chapter=2 with ch2's scene already done → fallback should
        # widen scope to all_planned and enqueue ch3.
        (projects_dir / "p1" / "progress.json").write_text(json.dumps({
            "current_chapter": 2,
            "chapters": [
                {"chapter_number": 1, "scenes": [
                    {"scene_number": 1, "status": "completed"},
                ]},
                {"chapter_number": 2, "scenes": [
                    {"scene_number": 1, "status": "completed"},
                ]},
            ],
        }), encoding="utf-8")
        svc = AutopilotLoopService()
        mgr = AutopilotSessionManager(projects_dir, "p1")
        mgr.start(ManagedStartConfig(scope="range", start_chapter=2, end_chapter=2))

        class StubExec:
            async def execute(self, item, project_id):
                return {"status": "ok"}

        result = await svc.ensure(
            "p1", mgr, StubExec(), ManagedStartConfig(scope="range", start_chapter=2, end_chapter=2),
        )
        assert result.outcome == "started"
        assert result.seed_result.fallback_applied is True
        assert result.seed_result.scope_used == "all_planned"
        assert result.seed_result.enqueued == 1
        await svc.cancel("p1")

    @pytest.mark.asyncio
    async def test_ensure_returns_already_running_when_task_in_flight(self, projects_dir):
        from backend.conductor.autopilot_session import AutopilotSessionManager
        from backend.models.autopilot_session import ManagedStartConfig
        (projects_dir / "p1" / "outline.json").write_text(
            json.dumps({
                "chapters": [{
                    "chapter_number": 1,
                    "scene_plan": [{"scene_number": 1}, {"scene_number": 2}],
                }],
            }),
            encoding="utf-8",
        )
        svc = AutopilotLoopService()
        mgr = AutopilotSessionManager(projects_dir, "p1")
        mgr.start(ManagedStartConfig())

        class SlowExec:
            async def execute(self, item, project_id):
                await asyncio.sleep(10)  # hold the task alive
                return {"status": "ok"}
        first = await svc.ensure("p1", mgr, SlowExec(), ManagedStartConfig())
        second = await svc.ensure("p1", mgr, SlowExec(), ManagedStartConfig())
        assert first.outcome == "started"
        assert second.outcome == "already_running"
        await svc.cancel("p1")

    @pytest.mark.asyncio
    async def test_ensure_returns_started_when_queue_pre_seeded(self, projects_dir):
        """Bug 2026-07-17 proj_cc4ca4ae: ensure() used `seed_result.enqueued==0`
        to decide no_work_to_do, but with idempotent seeding a re-start adds
        0 items because they're already in the queue. Without this fix,
        ensure() would return no_work_to_do and never spawn the loop, so
        the queue would sit forever. ensure() must instead check whether
        the queue has work (len(mgr.load().queue) == 0), since dedup means
        enqueued==0 is no longer equivalent to "nothing to do"."""
        from backend.conductor.autopilot_session import AutopilotSessionManager
        from backend.models.autopilot_session import (
            ManagedStartConfig, QueueItem,
        )
        (projects_dir / "p1" / "outline.json").write_text(
            json.dumps({
                "chapters": [{
                    "chapter_number": 1,
                    "scene_plan": [{"scene_number": 1}],
                }],
            }),
            encoding="utf-8",
        )
        svc = AutopilotLoopService()
        mgr = AutopilotSessionManager(projects_dir, "p1")
        mgr.start(ManagedStartConfig())
        # Pre-seed the queue, simulating a prior start whose loop drained
        # partially and stopped. ensure() must NOT report no_work_to_do.
        mgr.add_queue(QueueItem(
            id="write-1-1", kind="write_scene", chapter_number=1,
            scheduled_at=None, priority=21, payload={"scene_number": 1},
        ))

        class StubExec:
            async def execute(self, item, project_id):
                return {"status": "ok"}

        result = await svc.ensure("p1", mgr, StubExec(), ManagedStartConfig())
        # With the fix: queue is non-empty → outcome=started and task spawned.
        # Without the fix: enqueued==0 → outcome=no_work_to_do and session
        # stops, leaving the queued item orphaned (this is the bug).
        assert result.outcome == "started"
        assert svc.is_running("p1") is True
        await svc.cancel("p1")
