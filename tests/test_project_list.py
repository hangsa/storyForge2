"""Tests for GET /api/project/list updated_at field."""
import json
import shutil
import tempfile
import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def temp_projects_dir():
    d = Path(tempfile.mkdtemp())
    yield d
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def client(temp_projects_dir):
    from backend.config import settings
    original = settings.projects_dir
    settings.projects_dir = temp_projects_dir

    from backend.api.project import router as project_router
    app = FastAPI()
    app.include_router(project_router)
    yield TestClient(app)
    settings.projects_dir = original


def _write_project(dir: Path, project_id: str, payload: dict) -> None:
    (dir / project_id).mkdir(parents=True, exist_ok=True)
    (dir / project_id / "project.json").write_text(json.dumps(payload), encoding="utf-8")


def test_list_returns_updated_at_field(client, temp_projects_dir):
    project_id = "proj_test"
    _write_project(temp_projects_dir, project_id, {
        "id": project_id,
        "title": "测试",
        "genre": "cool_novel",
        "current_stage": "STAGE4",
        "created_at": "2026-01-01T00:00:00Z",
    })
    resp = client.get("/api/project/list")
    assert resp.status_code == 200
    body = resp.json()
    assert body["error"] is False
    detail = body["detail"]
    assert len(detail) == 1
    assert "updated_at" in detail[0]
    assert isinstance(detail[0]["updated_at"], (int, float))
    assert detail[0]["updated_at"] > 0


def test_list_updated_at_reflects_recent_file_write(client, temp_projects_dir):
    project_id = "proj_recent"
    _write_project(temp_projects_dir, project_id, {
        "id": project_id,
        "title": "最近修改",
        "genre": "cool_novel",
        "current_stage": "STAGE4",
        "created_at": "2026-01-01T00:00:00Z",
    })
    initial_resp = client.get("/api/project/list")
    initial_mtime = initial_resp.json()["detail"][0]["updated_at"]

    time.sleep(1.1)
    (temp_projects_dir / project_id / "outline.json").write_text(
        json.dumps({"chapters": []}), encoding="utf-8"
    )

    after_resp = client.get("/api/project/list")
    after_mtime = after_resp.json()["detail"][0]["updated_at"]
    assert after_mtime > initial_mtime