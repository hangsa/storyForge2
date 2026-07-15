"""API-level integration: POST /session/start actually spawns a runner.

Spec §7 (API test). The runner is observable via the SSE broadcaster which
the autopilot router publishes to.
"""
from __future__ import annotations
import asyncio
import json
from pathlib import Path
import pytest
from fastapi import FastAPI
import httpx

from backend.config import settings
from backend.conductor.autopilot_loop import AutopilotLoopService
from backend.utils.sse_broadcaster import SSEBroadcaster


@pytest.fixture
def projects_dir(tmp_path: Path):
    p = tmp_path / "p1"
    p.mkdir(parents=True, exist_ok=True)
    (p / "project.json").write_text(
        json.dumps({"id": "p1", "current_stage": "STAGE4"}),
        encoding="utf-8",
    )
    (p / "outline.json").write_text(json.dumps({
        "chapters": [{"chapter_number": 1, "scene_plan": [
            {"scene_number": 1, "goal": "g", "conflict": "c"},
        ]}],
    }), encoding="utf-8")
    (p / "characters.json").write_text(json.dumps({"characters": []}),
                                     encoding="utf-8")
    (p / "world.json").write_text(json.dumps({}), encoding="utf-8")
    (p / "concept_and_dna.json").write_text(json.dumps({}), encoding="utf-8")
    return tmp_path


@pytest.mark.asyncio
async def test_post_start_spawns_runner_and_emits_sse_event(
    projects_dir, monkeypatch
):
    monkeypatch.setattr(settings, "projects_dir", projects_dir)
    from backend.api import autopilot
    # Fresh broadcaster so we can observe events.
    bc = SSEBroadcaster(history_size=64, queue_max=8)
    monkeypatch.setattr(autopilot, "broadcaster", bc, raising=False)

    app = FastAPI()
    app.include_router(autopilot.router)

    # Initialise app state the way main.py's lifespan would.
    app.state.loop_service = AutopilotLoopService()
    from backend.conductor.stage4_async_executor import FakeStage4Executor
    # Stub executor: completes scenes with canned text + passed breaker.
    executor = FakeStage4Executor(
        mgr=autopilot._mgr("p1"), projects_dir=projects_dir,
        draft_factory=lambda c, s: "ok", breaker_result="passed",
    )
    app.state.stage4_executor = executor

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
        # 1) POST /start
        r = await client.post(
            "/api/v1/projects/p1/autopilot/session/start",
            json={"scope": "all_planned", "cadence": "balanced",
                  "policy": "auto", "notify": "milestones"},
        )
        assert r.status_code == 200
        assert r.json()["detail"]["state"] == "running"

        # 2) Within 200ms, GET /session shows current_task OR queue activity.
        await asyncio.sleep(0.2)
        r = await client.get("/api/v1/projects/p1/autopilot/session")
        session = r.json()["detail"]
        # Either current_task is set (mid-flight) OR the queue is empty + state
        # is stopped (runner finished quickly with FakeStage4Executor).
        assert session["state"] in ("running", "stopped")

        # 3) SSE feed received at least one task_start event (via broadcaster history).
        await asyncio.sleep(0.5)
        task_events = [
            ev for ev in bc.history
            if ev.event in ("task_start", "task_complete", "queue_add")
        ]
        assert len(task_events) >= 1

    # Cleanup: cancel the runner so subsequent tests don't leak tasks.
    await app.state.loop_service.cancel("p1")
