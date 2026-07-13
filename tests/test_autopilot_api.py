"""End-to-end FastAPI tests for /api/v1/projects/{id}/autopilot/*.
Spec: docs/design/storyForge-design-v1.9.md §四 F1.9.1, L268-277.
"""
from __future__ import annotations
import json
from pathlib import Path
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def projects_dir(tmp_path: Path) -> Path:
    return tmp_path


@pytest.fixture
def client(projects_dir: Path):
    from backend.config import settings
    orig = settings.projects_dir
    settings.projects_dir = projects_dir
    from backend.api.autopilot import router as autopilot_router
    app = FastAPI()
    app.include_router(autopilot_router)
    yield TestClient(app)
    settings.projects_dir = orig


def _make_project(projects_dir: Path, project_id: str = "p1") -> None:
    (projects_dir / project_id).mkdir(parents=True, exist_ok=True)
    (projects_dir / project_id / "project.json").write_text(
        json.dumps({"id": project_id, "title": "测试项目", "current_stage": "STAGE4"}),
        encoding="utf-8",
    )


def _start_payload() -> dict:
    return {"scope": "all_planned", "cadence": "balanced", "policy": "auto", "notify": "milestones"}


class TestGetSession:
    def test_returns_idle_when_no_session_yet(self, client, projects_dir):
        """UX-friendly: GET /session returns 200 + state=idle when no file."""
        _make_project(projects_dir, "p1")
        r = client.get("/api/v1/projects/p1/autopilot/session")
        assert r.status_code == 200
        assert r.json()["detail"]["state"] == "idle"

    def test_404_when_project_does_not_exist(self, client):
        r = client.get("/api/v1/projects/nope/autopilot/session")
        assert r.status_code == 404
        assert r.json()["code"] == "PROJECT_NOT_FOUND"

    def test_returns_full_snapshot_after_start(self, client, projects_dir):
        _make_project(projects_dir, "p1")
        client.post("/api/v1/projects/p1/autopilot/session/start", json=_start_payload())
        r = client.get("/api/v1/projects/p1/autopilot/session")
        assert r.status_code == 200
        body = r.json()["detail"]
        assert body["state"] == "running"
        assert body["config"]["scope"] == "all_planned"
        assert isinstance(body["history"], list)
        assert body["circuit"]["force_pass_count"] == 0


class TestStart:
    def test_creates_session_and_returns_running(self, client, projects_dir):
        _make_project(projects_dir, "p1")
        r = client.post("/api/v1/projects/p1/autopilot/session/start", json=_start_payload())
        assert r.status_code == 200
        body = r.json()["detail"]
        assert body["state"] == "running"
        assert body["history"][-1]["type"] == "task_start"

    def test_404_when_project_missing(self, client):
        r = client.post("/api/v1/projects/nope/autopilot/session/start", json=_start_payload())
        assert r.status_code == 404

    def test_uses_default_config_when_payload_partial(self, client, projects_dir):
        _make_project(projects_dir, "p1")
        r = client.post("/api/v1/projects/p1/autopilot/session/start", json={})
        assert r.status_code == 200
        assert r.json()["detail"]["config"]["scope"] == "all_planned"


class TestLifecycleEndpoints:
    def test_pause_then_resume_round_trip(self, client, projects_dir):
        _make_project(projects_dir, "p1")
        client.post("/api/v1/projects/p1/autopilot/session/start", json=_start_payload())
        assert client.post("/api/v1/projects/p1/autopilot/session/pause").json()["detail"]["state"] == "paused"
        assert client.post("/api/v1/projects/p1/autopilot/session/resume").json()["detail"]["state"] == "running"
        assert client.post("/api/v1/projects/p1/autopilot/session/stop").json()["detail"]["state"] == "stopped"

    def test_stop_when_idle_returns_stopped(self, client, projects_dir):
        _make_project(projects_dir, "p1")
        r = client.post("/api/v1/projects/p1/autopilot/session/stop")
        assert r.status_code == 200
        assert r.json()["detail"]["state"] == "stopped"

    def test_resume_when_running_returns_409(self, client, projects_dir):
        _make_project(projects_dir, "p1")
        client.post("/api/v1/projects/p1/autopilot/session/start", json=_start_payload())
        r = client.post("/api/v1/projects/p1/autopilot/session/resume")
        assert r.status_code == 409
        assert r.json()["code"] == "INVALID_STATE"


class TestIntervene:
    def test_pause_immediate(self, client, projects_dir):
        _make_project(projects_dir, "p1")
        client.post("/api/v1/projects/p1/autopilot/session/start", json=_start_payload())
        r = client.post("/api/v1/projects/p1/autopilot/session/intervene",
                        json={"action": "pause_immediate"})
        assert r.status_code == 200
        assert r.json()["detail"]["state"] == "paused"

    def test_unknown_action_returns_400(self, client, projects_dir):
        _make_project(projects_dir, "p1")
        r = client.post("/api/v1/projects/p1/autopilot/session/intervene", json={"action": "bogus"})
        assert r.status_code == 400
        assert r.json()["code"] == "INVALID_ACTION"

    def test_rollback_checkpoint_pauses(self, client, projects_dir):
        _make_project(projects_dir, "p1")
        client.post("/api/v1/projects/p1/autopilot/session/start", json=_start_payload())
        r = client.post("/api/v1/projects/p1/autopilot/session/intervene",
                        json={"action": "rollback_checkpoint"})
        assert r.status_code == 200
        assert r.json()["detail"]["state"] == "paused"  # Stage 1 stub


class TestHistory:
    def test_returns_event_list_after_start(self, client, projects_dir):
        _make_project(projects_dir, "p1")
        client.post("/api/v1/projects/p1/autopilot/session/start", json=_start_payload())
        r = client.get("/api/v1/projects/p1/autopilot/session/history")
        assert r.status_code == 200
        events = r.json()["detail"]["events"]
        assert any(e["type"] == "task_start" for e in events)

    def test_cursor_pagination(self, client, projects_dir):
        _make_project(projects_dir, "p1")
        client.post("/api/v1/projects/p1/autopilot/session/start", json=_start_payload())
        client.post("/api/v1/projects/p1/autopilot/session/pause")
        full = client.get("/api/v1/projects/p1/autopilot/session/history").json()["detail"]["events"]
        assert len(full) >= 2
        cursor = full[1]["id"]
        page = client.get("/api/v1/projects/p1/autopilot/session/history",
                          params={"cursor": cursor}).json()["detail"]
        # Page = events STRICTLY AFTER the cursor
        assert len(page["events"]) == len(full) - 2

    def test_empty_history_when_no_session(self, client, projects_dir):
        _make_project(projects_dir, "p1")
        r = client.get("/api/v1/projects/p1/autopilot/session/history")
        assert r.status_code == 200
        assert r.json()["detail"]["events"] == []
        assert r.json()["detail"]["next_cursor"] is None
