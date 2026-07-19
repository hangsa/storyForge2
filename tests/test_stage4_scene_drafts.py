"""GET /api/stage4/scene-drafts — list scene-draft availability for a
chapter, derived from outline.json scene_plan and disk-side
scene_draft.md existence/non-empty. Read-only, no LLM."""
from __future__ import annotations
import json
from pathlib import Path
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def projects_dir(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    from backend.api.stage4_writing import fm
    fm.projects_dir = tmp_path
    return tmp_path


@pytest.fixture
def client(projects_dir):
    from backend.api.stage4_writing import router
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _seed_outline(projects_dir: Path, chapters: list, pid: str = "p1") -> None:
    proj = projects_dir / pid
    proj.mkdir(parents=True, exist_ok=True)
    (proj / "outline.json").write_text(
        json.dumps({"chapters": chapters}), encoding="utf-8"
    )


def _write_draft(projects_dir: Path, pid: str, ch: int, sc: int, body: str) -> None:
    chapters_dir = projects_dir / pid / "chapters"
    chapters_dir.mkdir(parents=True, exist_ok=True)
    fname = f"ch{ch:02d}_scene_{sc:03d}_draft.md"
    (chapters_dir / fname).write_text(body, encoding="utf-8")


def test_returns_empty_when_outline_missing(client, projects_dir):
    # Project dir exists but no outline.json
    (projects_dir / "p1").mkdir(parents=True, exist_ok=True)
    resp = client.get("/api/stage4/scene-drafts", params={
        "project_id": "p1", "chapter_number": 1,
    })
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Envelope: detail carries the actual payload
    assert body["error"] is False
    assert body["code"] == "OK"
    assert body["detail"] == {"chapter_number": 1, "scenes": []}


def test_returns_true_for_existing_non_empty_drafts(client, projects_dir):
    _seed_outline(projects_dir, [
        {"chapter_number": 1, "scene_plan": [
            {"scene_number": 1}, {"scene_number": 2}, {"scene_number": 3},
        ]},
    ])
    _write_draft(projects_dir, "p1", 1, 1, "第一幕草稿")
    _write_draft(projects_dir, "p1", 1, 3, "第三幕草稿")
    # scene 2 deliberately not written

    resp = client.get("/api/stage4/scene-drafts", params={
        "project_id": "p1", "chapter_number": 1,
    })
    assert resp.status_code == 200, resp.text
    detail = resp.json()["detail"]
    assert detail["chapter_number"] == 1
    scenes = detail["scenes"]
    assert {s["scene_number"]: s["has_draft"] for s in scenes} == {
        1: True, 2: False, 3: True,
    }


def test_returns_false_for_empty_draft_file(client, projects_dir):
    _seed_outline(projects_dir, [
        {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
    ])
    _write_draft(projects_dir, "p1", 1, 1, "   \n  \n")  # whitespace only

    resp = client.get("/api/stage4/scene-drafts", params={
        "project_id": "p1", "chapter_number": 1,
    })
    assert resp.status_code == 200
    scenes = resp.json()["detail"]["scenes"]
    assert scenes[0]["has_draft"] is False


def test_returns_false_for_missing_draft_file(client, projects_dir):
    _seed_outline(projects_dir, [
        {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
    ])
    # No draft file written
    resp = client.get("/api/stage4/scene-drafts", params={
        "project_id": "p1", "chapter_number": 1,
    })
    assert resp.status_code == 200
    assert resp.json()["detail"]["scenes"][0]["has_draft"] is False


def test_returns_empty_when_chapter_not_in_outline(client, projects_dir):
    _seed_outline(projects_dir, [
        {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
    ])
    # Request chapter 2 which outline doesn't have
    resp = client.get("/api/stage4/scene-drafts", params={
        "project_id": "p1", "chapter_number": 2,
    })
    assert resp.status_code == 200
    assert resp.json()["detail"] == {"chapter_number": 2, "scenes": []}


def test_404_for_unknown_project(client, projects_dir):
    resp = client.get("/api/stage4/scene-drafts", params={
        "project_id": "nope", "chapter_number": 1,
    })
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "PROJECT_NOT_FOUND"


def test_handles_zero_padded_paths_consistently(client, projects_dir):
    """ch{02d}_scene_{03d}_draft.md — ch1 scene1 must read ch01_scene_001_draft.md."""
    _seed_outline(projects_dir, [
        {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
    ])
    # Write using the canonical filename format the writer uses
    (projects_dir / "p1" / "chapters").mkdir(parents=True, exist_ok=True)
    (projects_dir / "p1" / "chapters" / "ch01_scene_001_draft.md").write_text(
        "首章首场景", encoding="utf-8"
    )
    resp = client.get("/api/stage4/scene-drafts", params={
        "project_id": "p1", "chapter_number": 1,
    })
    assert resp.status_code == 200
    assert resp.json()["detail"]["scenes"][0]["has_draft"] is True