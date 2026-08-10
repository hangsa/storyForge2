"""Tests for POST /api/stage3/regenerate-novel-outline-section.

Sections: core_conflict (string), volumes (array), mc_growth (array),
key_plot (array). Other top-level fields stay byte-identical.
generated_at preserved; updated_at refreshed.
"""
import json
import pytest
from unittest.mock import patch, AsyncMock
from pathlib import Path

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)
PROJ = "proj_test_outline_section"


def _write(tmp_path: Path, name: str, payload) -> None:
    (tmp_path / PROJ).mkdir(parents=True, exist_ok=True)
    (tmp_path / PROJ / name).write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )


def _seed_project(tmp_path: Path) -> None:
    (tmp_path / PROJ).mkdir(parents=True, exist_ok=True)
    (tmp_path / PROJ / "project.json").write_text(
        json.dumps({"genre": "cool_novel", "min_words": 2000, "target_total_words": 1_000_000}, ensure_ascii=False),
        encoding="utf-8",
    )


def _seed_old_outline():
    return {
        "core_conflict_theme": "旧核心冲突与主题",
        "volumes": [
            {"name": "旧卷一", "chapter_range": "1-10", "summary": "旧摘要", "key_events": ["旧事件"]},
        ],
        "mc_growth_arc": [
            {"label": "旧成长一", "target_chapter_range": "1-5", "description": "旧描述"},
        ],
        "key_plot_points": [
            {"title": "旧情节点", "must_appear_in_volume": "卷一", "description": "旧描述", "trigger_chapter_hint": "1"},
        ],
        "generated_at": "2026-01-01T00:00:00",
        "updated_at": "2026-01-01T00:00:00",
    }


def _mock_new_outline():
    return {
        "core_conflict_theme": "新核心冲突与主题",
        "volumes": [
            {"name": "新卷一", "chapter_range": "1-12", "summary": "新摘要", "key_events": ["新事件"]},
            {"name": "新卷二", "chapter_range": "13-25", "summary": "新二摘要", "key_events": []},
        ],
        "mc_growth_arc": [
            {"label": "新成长一", "target_chapter_range": "1-3", "description": "新描述"},
        ],
        "key_plot_points": [
            {"title": "新情节点", "must_appear_in_volume": "卷一", "description": "新描述", "trigger_chapter_hint": "2"},
        ],
    }


@pytest.fixture(autouse=True)
def _patch_settings(tmp_path, monkeypatch):
    from backend.config import settings
    from backend.api.stage3_outline import fm
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    # stage3_outline.py has module-level `fm = FileManager(settings.projects_dir)`
    # at import time, so its `projects_dir` is frozen. Patch it here so tests
    # route reads/writes to tmp_path.
    monkeypatch.setattr(fm, "projects_dir", tmp_path)
    yield


@pytest.fixture
def mock_planner():
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_novel_outline = AsyncMock(return_value=(
            _mock_new_outline(),
            None,
        ))
        yield MockPlanner


def test_regenerate_core_conflict_replaces_only_string(mock_planner, tmp_path):
    _seed_project(tmp_path)
    seeded = _seed_old_outline()
    _write(tmp_path, "novel_outline.json", seeded)
    resp = client.post(
        f"/api/stage3/regenerate-novel-outline-section?project_id={PROJ}",
        json={"section": "core_conflict", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert detail["core_conflict_theme"] == "新核心冲突与主题"
    assert detail["volumes"] == seeded["volumes"]
    assert detail["mc_growth_arc"] == seeded["mc_growth_arc"]
    assert detail["key_plot_points"] == seeded["key_plot_points"]
    assert detail["generated_at"] == seeded["generated_at"]


def test_regenerate_volumes_replaces_only_volumes(mock_planner, tmp_path):
    _seed_project(tmp_path)
    seeded = _seed_old_outline()
    _write(tmp_path, "novel_outline.json", seeded)
    resp = client.post(
        f"/api/stage3/regenerate-novel-outline-section?project_id={PROJ}",
        json={"section": "volumes", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert len(detail["volumes"]) == 2
    assert detail["volumes"][0]["name"] == "新卷一"
    assert detail["core_conflict_theme"] == seeded["core_conflict_theme"]
    assert detail["mc_growth_arc"] == seeded["mc_growth_arc"]
    assert detail["key_plot_points"] == seeded["key_plot_points"]


def test_regenerate_mc_growth_replaces_only_mc_growth(mock_planner, tmp_path):
    _seed_project(tmp_path)
    seeded = _seed_old_outline()
    _write(tmp_path, "novel_outline.json", seeded)
    resp = client.post(
        f"/api/stage3/regenerate-novel-outline-section?project_id={PROJ}",
        json={"section": "mc_growth", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert detail["mc_growth_arc"][0]["label"] == "新成长一"
    assert detail["volumes"] == seeded["volumes"]


def test_regenerate_key_plot_replaces_only_key_plot(mock_planner, tmp_path):
    _seed_project(tmp_path)
    seeded = _seed_old_outline()
    _write(tmp_path, "novel_outline.json", seeded)
    resp = client.post(
        f"/api/stage3/regenerate-novel-outline-section?project_id={PROJ}",
        json={"section": "key_plot", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert detail["key_plot_points"][0]["title"] == "新情节点"
    assert detail["mc_growth_arc"] == seeded["mc_growth_arc"]


def test_regenerate_unknown_section_returns_400(mock_planner, tmp_path):
    _seed_project(tmp_path)
    _write(tmp_path, "novel_outline.json", _seed_old_outline())
    resp = client.post(
        f"/api/stage3/regenerate-novel-outline-section?project_id={PROJ}",
        json={"section": "themes", "user_modifications": ""},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"


def test_regenerate_missing_project_returns_404(mock_planner, tmp_path):
    # Seed only novel_outline.json — no project.json, so the 404 fires before the agent.
    _write(tmp_path, "novel_outline.json", _seed_old_outline())
    resp = client.post(
        f"/api/stage3/regenerate-novel-outline-section?project_id={PROJ}",
        json={"section": "volumes", "user_modifications": ""},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "PROJECT_NOT_FOUND"


def test_regenerate_agent_value_error_returns_503(tmp_path, monkeypatch):
    from backend.config import settings
    from backend.api.stage3_outline import fm
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    monkeypatch.setattr(fm, "projects_dir", tmp_path)
    _seed_project(tmp_path)
    _write(tmp_path, "novel_outline.json", _seed_old_outline())
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_novel_outline = AsyncMock(side_effect=ValueError("LLM down"))
        resp = client.post(
            f"/api/stage3/regenerate-novel-outline-section?project_id={PROJ}",
            json={"section": "volumes", "user_modifications": ""},
        )
    assert resp.status_code == 503
