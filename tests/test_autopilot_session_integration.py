"""End-to-end integration: session.start → runner → chapter completes → history.
Spec: docs/design/storyForge-design-v1.9.md §四 F1.9.1.

Stage 1 flagship test — exercises the full pipeline:
    REST start  →  manager.start  →  queue add  →  runner.step (RecordingExecutor)
    →  task_complete + queue_drop events  →  REST /history reflects them
    →  restart with a fresh manager and verify session.json load restores everything.
"""
from __future__ import annotations
import json
from pathlib import Path
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.conductor.autopilot_session import AutopilotSessionManager
from backend.conductor.autopilot_runner import AutopilotRunner, RecordingExecutor
from backend.models.autopilot_session import QueueItem


@pytest.fixture
def projects_dir(tmp_path: Path) -> Path:
    (tmp_path / "p1").mkdir(parents=True, exist_ok=True)
    (tmp_path / "p1" / "project.json").write_text(json.dumps({
        "id": "p1", "title": "测试", "current_stage": "STAGE4",
    }), encoding="utf-8")
    (tmp_path / "p1" / "outline.json").write_text(json.dumps({
        "chapters": [{"chapter_number": 1, "title": "第一章",
                      "scene_plan": [{"scene_number": 1, "goal": "g", "conflict": "c"}]}],
    }), encoding="utf-8")
    return tmp_path


@pytest.fixture
def client(projects_dir: Path):
    from backend.config import settings
    orig = settings.projects_dir
    settings.projects_dir = projects_dir
    from backend.api.autopilot import router as autopilot_router
    from backend.conductor.autopilot_loop import AutopilotLoopService

    app = FastAPI()
    app.include_router(autopilot_router)
    # Wiring from Tasks 10/11: handlers require app.state.loop_service + executor.
    # Use the real loop service; tests observe state via the underlying mgr, not
    # the spawned runner, so the noop-async-executor here is safe.
    class _NoopExec:
        async def execute(self, item, project_id):
            return {"status": "ok"}
    app.state.loop_service = AutopilotLoopService()
    app.state.stage4_executor = _NoopExec()
    yield TestClient(app)
    settings.projects_dir = orig


def test_full_session_lifecycle_through_api_and_runner(client, projects_dir):
    """The flagship Stage 1 test: a chapter runs through the session."""
    pid = "p1"
    # 1. Start the session via the REST API
    r = client.post(
        f"/api/v1/projects/{pid}/autopilot/session/start",
        json={"scope": "range", "start_chapter": 1, "end_chapter": 1,
              "cadence": "balanced", "policy": "auto", "notify": "milestones"},
    )
    assert r.status_code == 200
    assert r.json()["detail"]["state"] == "running"

    # 2. Wire up a manager + recording executor on disk, queue a chapter task
    mgr = AutopilotSessionManager(projects_dir, pid)
    executor = RecordingExecutor()
    mgr.add_queue(QueueItem(id="q1", kind="plan_chapter", chapter_number=1,
                            scheduled_at=None, priority=1, payload={"chapter": 1}))

    # 3. Step the runner — picks q1, runs executor, completes
    result = AutopilotRunner(mgr, executor).step()
    assert result["picked"] == "q1"
    assert result["completed"] is True

    # 4. State after run: still running, queue empty, no current_task
    s = mgr.load()
    assert s.state.value == "running"
    assert s.queue == []
    assert s.current_task is None

    # 5. History contains task_start (from session start) and task_complete
    #    (from the runner). task_start must appear before task_complete.
    types = [e.type for e in s.history]
    assert "task_start" in types
    assert "task_complete" in types
    assert types.index("task_start") < types.index("task_complete"), (
        "task_start must precede task_complete in history"
    )

    # 6. Executor actually saw q1
    assert executor.calls[0]["item_id"] == "q1"

    # 7. REST /history reflects the events
    r = client.get(f"/api/v1/projects/{pid}/autopilot/session/history")
    assert r.status_code == 200
    types_api = [e["type"] for e in r.json()["detail"]["events"]]
    assert "task_start" in types_api
    assert "task_complete" in types_api

    # 8. REST /session returns the running state with our config
    r = client.get(f"/api/v1/projects/{pid}/autopilot/session")
    body = r.json()["detail"]
    assert body["state"] == "running"
    assert body["config"]["scope"] == "range"

    # 9. File persistence: session.json on disk matches in-memory state
    session_path = projects_dir / "p1" / "autopilot" / "session.json"
    assert session_path.exists()
    raw = json.loads(session_path.read_text(encoding="utf-8"))
    assert raw["state"] == "running"
    assert raw["queue"] == []
    assert raw["current_task"] is None

    # 10. Restart-resume: a fresh manager loads identical state + history
    fresh = AutopilotSessionManager(projects_dir, pid).load()
    assert fresh is not None
    assert fresh.state.value == "running"
    assert fresh.config.scope == "range"
    assert [e.type for e in fresh.history] == [e.type for e in s.history]
    assert [e.id for e in fresh.history] == [e.id for e in s.history]


def test_session_pause_interrupts_runner_step(client, projects_dir):
    """After pause, runner.step() is a no-op (does not run the executor)."""
    client.post("/api/v1/projects/p1/autopilot/session/start", json={})
    client.post("/api/v1/projects/p1/autopilot/session/pause")
    mgr = AutopilotSessionManager(projects_dir, "p1")
    executor = RecordingExecutor()
    mgr.add_queue(QueueItem(id="q1", kind="fact_guard", chapter_number=1,
                            scheduled_at=None, priority=1, payload={}))
    result = AutopilotRunner(mgr, executor).step()
    assert result["picked"] is None
    assert executor.calls == []


def test_full_chapter_pipeline_via_runner_loop(client, projects_dir):
    """Drain a chapter workflow through repeated runner.step() calls.

    Exercises the "≥ 1 full chapter" scenario from Task 1.6: a queue of
    plan/write/review/archival tasks runs end-to-end, the runner picks in
    priority order, every event is recorded, and a fresh manager loads
    the full picture on disk.
    """
    # 1. Start the session via the API
    client.post("/api/v1/projects/p1/autopilot/session/start",
                json={"scope": "range", "start_chapter": 1, "end_chapter": 1,
                      "cadence": "balanced"})

    # 2. Queue a chapter workflow — added out-of-order so we can verify the
    #    runner picks by priority (not insertion order).
    mgr = AutopilotSessionManager(projects_dir, "p1")
    executor = RecordingExecutor()
    runner = AutopilotRunner(mgr, executor)
    mgr.add_queue(QueueItem(id="review",  kind="review",       chapter_number=1,
                            scheduled_at=None, priority=30, payload={}))
    mgr.add_queue(QueueItem(id="write",   kind="write_scene",  chapter_number=1,
                            scheduled_at=None, priority=20, payload={}))
    mgr.add_queue(QueueItem(id="archive", kind="archival",     chapter_number=1,
                            scheduled_at=None, priority=40, payload={}))
    mgr.add_queue(QueueItem(id="plan",    kind="plan_chapter", chapter_number=1,
                            scheduled_at=None, priority=10, payload={}))

    # 3. Drain the queue via repeated step() calls
    completed_ids = []
    while True:
        result = runner.step()
        if result.get("error") == "queue empty":
            break
        assert result["completed"] is True, f"runner.step failed: {result}"
        completed_ids.append(result["picked"])

    # 4. Tasks ran in priority order; executor saw each exactly once. With
    #    the new loop.ensure wiring, /start also seeds a write_scene item
    #    (the "write-1-1" from seed_queue), so we filter to only the
    #    test-owned items below.
    expected_ids = ["plan", "write", "review", "archive"]
    test_owned_completed = [i for i in completed_ids if i in expected_ids]
    test_owned_calls = [c["item_id"] for c in executor.calls if c["item_id"] in expected_ids]
    assert test_owned_completed == expected_ids
    assert test_owned_calls == expected_ids

    # 5. State preserved: running, queue drained, no current_task
    s = mgr.load()
    assert s.state.value == "running"
    assert s.queue == []
    assert s.current_task is None

    # 6. History composition: 1 task_start (session start) + ≥4 queue_add
    #    (the 4 explicit add_queue() calls below, plus any seed_queue items
    #    the start handler triggered via the new loop.ensure wiring) + ≥4
    #    task_complete + ≥4 queue_drop (per runner step).
    types = [e.type for e in s.history]
    assert types.count("task_start") == 1
    assert types.count("queue_add") >= 4
    assert types.count("task_complete") >= 4
    assert types.count("queue_drop") >= 4

    # 7. Per-item ordering: every queue_add must be followed by its matching
    #    queue_drop later in the history. Queue_drop fires in priority-pick
    #    order, queue_add fires in insertion order — so we compare by id
    #    sets and verify each queue_add precedes its queue_drop.
    add_indices: dict = {}
    drop_indices: dict = {}
    for i, e in enumerate(s.history):
        if e.type == "queue_add":
            add_indices.setdefault(e.task_id, i)
        if e.type == "queue_drop":
            drop_indices.setdefault(e.task_id, i)
    # The test-owned items must all be present; seed_queue may add extra
    # write-* items via the loop.ensure wiring, so we only assert the
    # test-owned subset is represented.
    assert {"plan", "write", "review", "archive"}.issubset(set(add_indices))
    assert {"plan", "write", "review", "archive"}.issubset(set(drop_indices))
    for tid in add_indices:
        assert add_indices[tid] < drop_indices[tid], (
            f"queue_add for {tid} must precede its queue_drop"
        )

    # 8. queue_drop order matches the priority-picked execution order
    #    (filter to test-owned items; seed_queue may add a "write-1-1" via
    #    the loop.ensure wiring, which runs out of priority order)
    expected_ids = ["plan", "write", "review", "archive"]
    drop_order = [
        tid for tid in
        (e.task_id for e in s.history if e.type == "queue_drop")
        if tid in expected_ids
    ]
    assert drop_order == expected_ids

    # 9. Restart with a fresh manager — full history and config survive
    fresh = AutopilotSessionManager(projects_dir, "p1").load()
    assert fresh.state.value == "running"
    assert fresh.queue == []
    assert fresh.config.scope == "range"
    assert [e.type for e in fresh.history] == [e.type for e in s.history]
    assert [e.id for e in fresh.history] == [e.id for e in s.history]
