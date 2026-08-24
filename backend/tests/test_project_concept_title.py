"""Tests for project list / status title derivation from concept.

书架的书目标题应当以"初始化向导-概念信息下的标题"为来源，而不是
create_project 时的 intent 截断标题。当 concept_and_dna.json 中
存在 `concept.title` 且非空时，`project.json` 中的 `title` 字段
仅作为回退（项目尚未进入向导第 1 步，或概念标题被清空）。

参见 v2.2 任务：书架书名应同步概念信息中的标题。
"""
from __future__ import annotations

import json
from typing import Optional

import pytest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


# Three orthogonal projects so list ordering is observable if needed.
PROJ_WITH_CONCEPT = "proj_list_concept"
PROJ_NO_CONCEPT = "proj_list_noconcept"
PROJ_EMPTY_CONCEPT_TITLE = "proj_list_emptyconcept"


def _write_project(tmp_path, proj_id: str, title: str) -> None:
    proj_dir = tmp_path / proj_id
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "project.json").write_text(
        json.dumps(
            {
                "id": proj_id,
                "title": title,
                "genre": "cool_novel",
                "current_stage": "INIT",
                "created_at": "2026-08-24T00:00:00",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def _write_concept(tmp_path, proj_id: str, concept_title: Optional[str]) -> None:
    """Write concept_and_dna.json with `concept.title` (or omit if None).

    pass concept_title=None → no `concept` key at all (file missing in real life).
    pass concept_title=""  → concept.title is the empty string.
    """
    proj_dir = tmp_path / proj_id
    (proj_dir / "concept_and_dna.json").write_text(
        json.dumps(
            {
                "concept": {"title": concept_title, "genre": "cool_novel"},
                "story_dna": {},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


@pytest.fixture(autouse=True)
def _patch_settings(tmp_path, monkeypatch):
    """Route project reads/writes to tmp_path.

    `backend.api.project.list_projects` resolves a fresh FileManager at
    call time via `FileManager(settings.projects_dir)`, so the
    `monkeypatch.setattr(settings, "projects_dir", tmp_path)` is enough
    for the listing path. `get_project_status` uses the module-level
    `fm`, so we patch its `projects_dir` too (same pattern as
    test_stage1_regenerate_section).
    """
    from backend.config import settings
    from backend.api import project as project_module

    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    monkeypatch.setattr(project_module.fm, "projects_dir", tmp_path)
    yield


def _projects_by_id(detail: list[dict]) -> dict[str, dict]:
    return {p["id"]: p for p in detail}


def test_list_projects_prefers_concept_title_when_present(tmp_path):
    """When concept.title is non-empty, list_projects uses it as the
    displayed title — overriding the original `project.json` title
    (which was derived from intent at create time)."""
    _write_project(tmp_path, PROJ_WITH_CONCEPT, title="intent截断...")
    _write_concept(tmp_path, PROJ_WITH_CONCEPT, concept_title="来自向导的书名")

    resp = client.get("/api/project/list")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["error"] is False
    by_id = _projects_by_id(payload["detail"])
    assert PROJ_WITH_CONCEPT in by_id
    assert by_id[PROJ_WITH_CONCEPT]["title"] == "来自向导的书名"


def test_list_projects_falls_back_to_project_title_when_no_concept(tmp_path):
    """Projects that haven't entered the wizard yet still show their
    create-time title (not '未命名')."""
    _write_project(tmp_path, PROJ_NO_CONCEPT, title="尚未进入向导")

    resp = client.get("/api/project/list")
    payload = resp.json()
    by_id = _projects_by_id(payload["detail"])
    assert PROJ_NO_CONCEPT in by_id
    assert by_id[PROJ_NO_CONCEPT]["title"] == "尚未进入向导"


def test_list_projects_falls_back_when_concept_title_empty(tmp_path):
    """An empty concept.title must not erase the project.json title
    — fall back to the original (matches 'concepts got wiped' UX)."""
    _write_project(tmp_path, PROJ_EMPTY_CONCEPT_TITLE, title="原标题")
    _write_concept(tmp_path, PROJ_EMPTY_CONCEPT_TITLE, concept_title="")

    resp = client.get("/api/project/list")
    payload = resp.json()
    by_id = _projects_by_id(payload["detail"])
    assert by_id[PROJ_EMPTY_CONCEPT_TITLE]["title"] == "原标题"


def test_list_projects_uses_default_when_both_missing(tmp_path):
    """project.json with no title field and no concept → falls back to
    the long-standing "未命名" sentinel used by the original endpoint."""
    proj_dir = tmp_path / "proj_untitled"
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "project.json").write_text(
        json.dumps({"id": "proj_untitled", "genre": "cool_novel"}, ensure_ascii=False),
        encoding="utf-8",
    )

    resp = client.get("/api/project/list")
    payload = resp.json()
    by_id = _projects_by_id(payload["detail"])
    assert by_id["proj_untitled"]["title"] == "未命名"


def test_get_project_status_uses_concept_title(tmp_path):
    """Same rule applies to the single-project status endpoint (used
    by the in-wizard header that shows the user what they're editing)."""
    _write_project(tmp_path, PROJ_WITH_CONCEPT, title="intent截断...")
    _write_concept(tmp_path, PROJ_WITH_CONCEPT, concept_title="来自向导的书名")

    resp = client.get(f"/api/project/{PROJ_WITH_CONCEPT}/status")
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert detail["title"] == "来自向导的书名"


def test_get_project_status_falls_back_when_no_concept(tmp_path):
    _write_project(tmp_path, PROJ_NO_CONCEPT, title="原标题")

    resp = client.get(f"/api/project/{PROJ_NO_CONCEPT}/status")
    detail = resp.json()["detail"]
    assert detail["title"] == "原标题"
