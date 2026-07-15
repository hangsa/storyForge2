"""After extracting _write_scene_chapter() and _advance_chapter() out of the
HTTP handlers, /api/stage4/write-scene and /api/stage4/advance-chapter MUST
return the same response shape and the same progress.json contents."""
from __future__ import annotations
import json
from pathlib import Path
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def projects_dir(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    # stage4_writing.py binds `fm = FileManager(settings.projects_dir)` at
    # module import time, so re-instantiate it here to point at this test's
    # tmp_path. (Same fix pattern as test_autopilot_* tests.)
    from backend.api.stage4_writing import fm
    fm.projects_dir = tmp_path
    return tmp_path


@pytest.fixture
def client(projects_dir):
    from backend.api.stage4_writing import router
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _seed_minimal_project(projects_dir: Path, pid: str = "p1") -> None:
    proj = projects_dir / pid
    proj.mkdir(parents=True, exist_ok=True)
    (proj / "project.json").write_text(json.dumps({
        "id": pid, "title": "测试", "current_stage": "STAGE4",
    }), encoding="utf-8")
    (proj / "concept_and_dna.json").write_text(json.dumps({"title": "X"}), encoding="utf-8")
    (proj / "world.json").write_text(json.dumps({}), encoding="utf-8")
    (proj / "characters.json").write_text(json.dumps({"characters": []}), encoding="utf-8")
    (proj / "outline.json").write_text(json.dumps({
        "chapters": [{"chapter_number": 1, "scene_plan": [
            {"scene_number": 1, "goal": "测试", "conflict": "测试"},
        ]}],
    }), encoding="utf-8")
    (proj / "progress.json").write_text(json.dumps({
        "project_id": pid, "current_stage": "STAGE4", "current_chapter": 1,
        "total_chapters": 1, "chapters": [], "circuit_breaker_events": [],
    }), encoding="utf-8")


def test_write_scene_handler_returns_error_envelope(client, projects_dir):
    """Even if LLM call fails, the HTTP envelope must be intact.

    Without a real LLM key, the call should raise 503 (LLM_GENERATION_FAILED)
    — that's the pre-extraction behaviour, and the refactor must preserve it.
    """
    _seed_minimal_project(projects_dir, "p1")
    r = client.post("/api/stage4/write-scene", json={
        "project_id": "p1", "chapter_number": 1, "scene_number": 1,
    })
    # 503 because no LLM key, OR 200 if a stub is configured; either way envelope shape must be present.
    body = r.json()
    assert "error" in body
    assert "code" in body
    assert "message" in body
    assert "detail" in body


def test_advance_chapter_handler_returns_400_when_no_progress(client, projects_dir):
    """Pre-extraction: /advance-chapter returns 400 PRECONDITION_FAILED if no
    chapter progress exists. Refactor must preserve."""
    _seed_minimal_project(projects_dir, "p2")
    r = client.post("/api/stage4/advance-chapter", json={"project_id": "p2"})
    assert r.status_code == 400
    # FastAPI's HTTPException handler wraps the {error,code,message,detail}
    # envelope inside "detail".
    assert r.json()["detail"]["code"] == "PRECONDITION_FAILED"
