"""POST /api/stage4/fact-guard runs a fact-guard check on user-supplied
draft text without invoking the Writer LLM. Returns the same
fact_guard_results shape as the inline result of /write-scene."""
from __future__ import annotations
import json
from pathlib import Path
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def projects_dir(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    from backend.api import stage4_fact_guard, stage4_writing
    monkeypatch.setattr(stage4_fact_guard.fm, "projects_dir", tmp_path)
    monkeypatch.setattr(stage4_writing.fm, "projects_dir", tmp_path)
    return tmp_path


@pytest.fixture
def client(projects_dir):
    from backend.api.stage4_fact_guard import router
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _seed_project(projects_dir: Path, pid: str = "p1") -> None:
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


def test_fact_guard_returns_pass_result(client, projects_dir):
    _seed_project(projects_dir)
    resp = client.post("/api/stage4/fact-guard", json={
        "project_id": "p1",
        "chapter_number": 1,
        "scene_number": 1,
        "draft_text": "一段没有问题的正文内容。",
    })
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["error"] is False
    assert body["code"] == "OK"
    detail = body["detail"]
    assert "all_passed" in detail
    assert "checks" in detail
    assert isinstance(detail["checks"], list)


def test_fact_guard_does_not_overwrite_draft_on_disk(client, projects_dir):
    _seed_project(projects_dir)
    chapters = projects_dir / "p1" / "chapters"
    chapters.mkdir()
    draft_path = chapters / "ch01_scene_001_draft.md"
    draft_path.write_text("原始内容", encoding="utf-8")
    client.post("/api/stage4/fact-guard", json={
        "project_id": "p1",
        "chapter_number": 1,
        "scene_number": 1,
        "draft_text": "新检查的内容",
    })
    assert draft_path.read_text(encoding="utf-8") == "原始内容"


def test_fact_guard_404_for_unknown_scene(client, projects_dir):
    _seed_project(projects_dir)
    resp = client.post("/api/stage4/fact-guard", json={
        "project_id": "p1",
        "chapter_number": 1,
        "scene_number": 99,
        "draft_text": "x",
    })
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "SCENE_NOT_FOUND"


def test_fact_guard_400_for_empty_project_id(client, projects_dir):
    resp = client.post("/api/stage4/fact-guard", json={
        "project_id": "",
        "chapter_number": 1,
        "scene_number": 1,
        "draft_text": "x",
    })
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"
