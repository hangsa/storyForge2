"""StageStateMachine.regress_to_init() — atomically clear STAGE4 runtime
state and regress current_stage to INIT, preserving init-phase artifacts
and stage_history.

The regress_to_init helper is the foundation of the workspace "初始化"
button: it deletes chapters/*.md + progress.json + .storyforge_checkpoint.json
+ autopilot/chunks/*.jsonl, then writes project.json with current_stage=INIT.
It is intentionally NOT transactional — idempotent retry is the recovery
path for partial-write failures (see spec §错误处理).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.conductor.state_machine import Stage, StageStateMachine


@pytest.fixture
def projects_dir(tmp_path: Path):
    return tmp_path


@pytest.fixture
def sm(projects_dir):
    return StageStateMachine(projects_dir)


def _seed_project(projects_dir: Path, pid: str, *,
                  stage: str = "STAGE4",
                  stage_history: list | None = None) -> dict:
    project_dir = projects_dir / pid
    project_dir.mkdir(parents=True, exist_ok=True)
    data = {
        "id": pid,
        "title": "测试小说",
        "genre": "cool_novel",
        "current_stage": stage,
        "stage_history": stage_history or [],
        "created_at": "2026-01-01T00:00:00",
    }
    (project_dir / "project.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return data


def test_regress_deletes_chapter_drafts(sm, projects_dir):
    pid = "proj_test"
    _seed_project(projects_dir, pid)
    chapters = projects_dir / pid / "chapters"
    chapters.mkdir()
    (chapters / "ch01_scene_001_draft.md").write_text("scene 1 body")
    (chapters / "ch01_scene_002_draft.md").write_text("scene 2 body")
    (chapters / "ch02_scene_001_draft.md").write_text("ch2 scene 1")

    result = sm.regress_to_init(pid)

    assert result.allowed is True
    assert list(chapters.glob("ch*_scene_*_draft.md")) == []


def test_regress_deletes_progress_and_checkpoint(sm, projects_dir):
    pid = "proj_test"
    proj = projects_dir / pid
    _seed_project(projects_dir, pid)
    (proj / "progress.json").write_text('{"chapters":[]}', encoding="utf-8")
    (proj / ".storyforge_checkpoint.json").write_text('{"pipeline_stage":"x"}', encoding="utf-8")

    sm.regress_to_init(pid)

    assert not (proj / "progress.json").exists()
    assert not (proj / ".storyforge_checkpoint.json").exists()


def test_regress_clears_chunks_but_keeps_dir(sm, projects_dir):
    pid = "proj_test"
    proj = projects_dir / pid
    _seed_project(projects_dir, pid)
    chunks = proj / "autopilot" / "chunks"
    chunks.mkdir(parents=True)
    (chunks / "ch01_scene_001.jsonl").write_text('{"seq":1,"text":"a"}', encoding="utf-8")
    (chunks / "ch02_scene_003.jsonl").write_text('{"seq":1,"text":"b"}', encoding="utf-8")

    sm.regress_to_init(pid)

    assert list(chunks.glob("*.jsonl")) == []
    assert chunks.exists()  # SceneChunkStore expects the parent dir to exist


def test_regress_writes_current_stage_init(sm, projects_dir):
    pid = "proj_test"
    proj = projects_dir / pid
    _seed_project(projects_dir, pid, stage="STAGE4")
    (proj / "progress.json").write_text('{}', encoding="utf-8")

    sm.regress_to_init(pid)

    data = json.loads((proj / "project.json").read_text(encoding="utf-8"))
    assert data["current_stage"] == "INIT"


def test_regress_preserves_stage_history(sm, projects_dir):
    pid = "proj_test"
    proj = projects_dir / pid
    history = [
        {"from_stage": "INIT", "to_stage": "STAGE1", "timestamp": "2026-01-01T00:00:00"},
        {"from_stage": "STAGE1", "to_stage": "STAGE4", "timestamp": "2026-01-02T00:00:00"},
    ]
    _seed_project(projects_dir, pid, stage="STAGE4", stage_history=history)

    sm.regress_to_init(pid)

    data = json.loads((proj / "project.json").read_text(encoding="utf-8"))
    assert data["stage_history"] == history


def test_regress_preserves_init_artifacts(sm, projects_dir):
    """outline.json, characters.json, world.json, novel_outline.json,
    concept_and_dna.json — these belong to init phase and must NOT be deleted."""
    pid = "proj_test"
    proj = projects_dir / pid
    _seed_project(projects_dir, pid)
    for fn in ("outline.json", "characters.json", "world.json",
               "novel_outline.json", "concept_and_dna.json"):
        (proj / fn).write_text(f'{{"file":"{fn}"}}', encoding="utf-8")
    chapters = proj / "chapters"
    chapters.mkdir()
    (chapters / "ch01_scene_001_draft.md").write_text("body", encoding="utf-8")

    sm.regress_to_init(pid)

    for fn in ("outline.json", "characters.json", "world.json",
               "novel_outline.json", "concept_and_dna.json"):
        assert (proj / fn).exists(), f"{fn} should be preserved"


def test_regress_returns_not_allowed_when_project_missing(sm):
    result = sm.regress_to_init("proj_nonexistent")
    assert result.allowed is False
    assert "不存在" in result.message


def test_regress_is_idempotent(sm, projects_dir):
    """第二次调用应成功（已删除的文件跳过）。"""
    pid = "proj_test"
    proj = projects_dir / pid
    _seed_project(projects_dir, pid)
    (proj / "progress.json").write_text('{}', encoding="utf-8")

    r1 = sm.regress_to_init(pid)
    r2 = sm.regress_to_init(pid)

    assert r1.allowed is True
    assert r2.allowed is True
    data = json.loads((proj / "project.json").read_text(encoding="utf-8"))
    assert data["current_stage"] == "INIT"


def test_regress_reports_actual_from_stage(sm, projects_dir):
    """from_stage should reflect the project's actual current_stage before reset,
    not be hardcoded to Stage.INIT."""
    pid = "proj_test"
    proj = projects_dir / pid
    _seed_project(projects_dir, pid, stage="STAGE5")
    (proj / "progress.json").write_text('{}', encoding="utf-8")

    result = sm.regress_to_init(pid)

    assert result.allowed is True
    assert result.from_stage == Stage.STAGE5
    assert result.to_stage == Stage.INIT
    assert "STAGE5" in result.message and "INIT" in result.message


# === /reset-preview endpoint tests ===

from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def client(projects_dir, monkeypatch):
    from backend import config as _config
    from backend.api.project import router
    monkeypatch.setattr(_config.settings, "projects_dir", projects_dir)
    # Force the module-level `fm` to use the patched projects_dir too.
    from backend.api import project as _project_mod
    monkeypatch.setattr(_project_mod, "fm", _project_mod.FileManager(projects_dir))
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_reset_preview_returns_draft_count(client, projects_dir):
    pid = "proj_test"
    proj = projects_dir / pid
    proj.mkdir(parents=True)
    (proj / "project.json").write_text(
        json.dumps({"id": pid, "current_stage": "STAGE4"}),
        encoding="utf-8",
    )
    chapters = proj / "chapters"
    chapters.mkdir()
    for n in (1, 2, 3):
        (chapters / f"ch{n:02d}_scene_001_draft.md").write_text("body")

    resp = client.get(f"/api/project/{pid}/reset-preview")
    assert resp.status_code == 200
    assert resp.json() == {
        "draft_count": 3,
        "has_progress": False,
        "has_checkpoint": False,
        "has_chunks": False,
    }


def test_reset_preview_detects_runtime_state(client, projects_dir):
    pid = "proj_test"
    proj = projects_dir / pid
    proj.mkdir(parents=True)
    (proj / "project.json").write_text(
        json.dumps({"id": pid, "current_stage": "STAGE4"}),
        encoding="utf-8",
    )
    (proj / "progress.json").write_text('{"chapters":[]}', encoding="utf-8")
    (proj / ".storyforge_checkpoint.json").write_text("{}", encoding="utf-8")
    chunks = proj / "autopilot" / "chunks"
    chunks.mkdir(parents=True)
    (chunks / "ch01_scene_001.jsonl").write_text('{"seq":1}')

    resp = client.get(f"/api/project/{pid}/reset-preview")
    body = resp.json()
    assert body["has_progress"] is True
    assert body["has_checkpoint"] is True
    assert body["has_chunks"] is True


def test_reset_preview_404_for_missing_project(client):
    resp = client.get("/api/project/proj_nonexistent/reset-preview")
    assert resp.status_code == 404


def test_reset_preview_handles_no_chapters_dir(client, projects_dir):
    """Project exists but never wrote any chapter drafts → all zeros."""
    pid = "proj_test"
    proj = projects_dir / pid
    proj.mkdir(parents=True)
    (proj / "project.json").write_text(
        json.dumps({"id": pid, "current_stage": "INIT"}),
        encoding="utf-8",
    )

    resp = client.get(f"/api/project/{pid}/reset-preview")
    assert resp.status_code == 200
    assert resp.json()["draft_count"] == 0
