"""Tests for POST /api/stage1/regenerate-section.

Sections: `concept` rewrites only `concept_and_dna.concept`;
`dna` rewrites only `concept_and_dna.story_dna`. Other fields stay
byte-identical. Mirrors the regenerate-examples pattern.
"""
import json
import pytest
from unittest.mock import patch, AsyncMock
from pathlib import Path

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)
PROJ = "proj_test_concept_section"


def _write_concept_and_dna(tmp_path: Path, payload: dict) -> None:
    (tmp_path / PROJ).mkdir(parents=True, exist_ok=True)
    (tmp_path / PROJ / "concept_and_dna.json").write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )


def _write_project(tmp_path: Path) -> None:
    (tmp_path / PROJ).mkdir(parents=True, exist_ok=True)
    (tmp_path / PROJ / "project.json").write_text(
        json.dumps({
            "id": PROJ,
            "genre": "cool_novel",
            "initial_intent": {"free_text": "一个少年在废墟里觉醒"},
        }, ensure_ascii=False),
        encoding="utf-8",
    )


@pytest.fixture(autouse=True)
def _patch_settings(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    # The stage1_concept module instantiates `fm = FileManager(settings.projects_dir)`
    # at import time, so its `projects_dir` is frozen. Patch it here so tests
    # route reads/writes to tmp_path.
    from backend.api.stage1_concept import fm
    monkeypatch.setattr(fm, "projects_dir", tmp_path)
    yield


@pytest.fixture
def mock_planner():
    """PlannerAgent returns a payload with both `concept` and `story_dna`.
    The endpoint must extract only the targeted section."""
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_concept_and_dna = AsyncMock(return_value=(
            {
                "concept": {
                    "title": "新标题",
                    "genre": "cool_novel",
                    "premise": "新前提",
                    "tone": "热血",
                    "theme": "成长",
                    "target_audience": "男频",
                    "style_template": "升级流",
                },
                "story_dna": {
                    "core_contradiction": {"statement": "新矛盾", "side_a": "A", "side_b": "B"},
                    "value_stack": [{"value_a": "自由", "value_b": "秩序"}],
                },
            },
            None,  # LLMResponse placeholder
        ))
        yield MockPlanner


def _seed_old_payload():
    return {
        "concept": {
            "title": "旧标题",
            "genre": "cool_novel",
            "premise": "旧前提",
            "tone": "轻松",
            "theme": "友情",
            "target_audience": "全年龄",
            "style_template": "日常",
        },
        "story_dna": {
            "core_contradiction": {"statement": "旧矛盾", "side_a": "X", "side_b": "Y"},
            "value_stack": [{"value_a": "信任", "value_b": "背叛"}],
        },
        "warnings": [],  # legacy runtime field — must survive untouched
    }


def test_regenerate_concept_rewrites_only_concept(mock_planner, tmp_path):
    _write_project(tmp_path)
    seeded = _seed_old_payload()
    _write_concept_and_dna(tmp_path, seeded)

    resp = client.post(
        f"/api/stage1/regenerate-section?project_id={PROJ}",
        json={"section": "concept", "user_modifications": "更热血"},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]

    # Targeted section is replaced.
    assert detail["concept"]["title"] == "新标题"
    assert detail["concept"]["tone"] == "热血"

    # story_dna is preserved byte-identical (same dict values).
    assert detail["story_dna"] == seeded["story_dna"]

    # `warnings` field survives.
    assert detail["warnings"] == seeded["warnings"]


def test_regenerate_dna_rewrites_only_story_dna(mock_planner, tmp_path):
    _write_project(tmp_path)
    seeded = _seed_old_payload()
    _write_concept_and_dna(tmp_path, seeded)

    resp = client.post(
        f"/api/stage1/regenerate-section?project_id={PROJ}",
        json={"section": "dna", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]

    # story_dna is replaced.
    assert detail["story_dna"]["core_contradiction"]["statement"] == "新矛盾"
    assert detail["story_dna"]["value_stack"] == [{"value_a": "自由", "value_b": "秩序"}]

    # concept is preserved byte-identical.
    assert detail["concept"] == seeded["concept"]


def test_regenerate_unknown_section_returns_400(mock_planner, tmp_path):
    _write_project(tmp_path)
    _write_concept_and_dna(tmp_path, _seed_old_payload())
    resp = client.post(
        f"/api/stage1/regenerate-section?project_id={PROJ}",
        json={"section": "title_only", "user_modifications": ""},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"


def test_regenerate_missing_project_returns_404(mock_planner, tmp_path):
    # No project.json — planner never gets called.
    resp = client.post(
        f"/api/stage1/regenerate-section?project_id={PROJ}",
        json={"section": "concept", "user_modifications": ""},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "PROJECT_NOT_FOUND"


def test_regenerate_agent_value_error_returns_503(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    from backend.api.stage1_concept import fm
    monkeypatch.setattr(fm, "projects_dir", tmp_path)
    _write_project(tmp_path)
    _write_concept_and_dna(tmp_path, _seed_old_payload())
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_concept_and_dna = AsyncMock(side_effect=ValueError("LLM down"))
        resp = client.post(
            f"/api/stage1/regenerate-section?project_id={PROJ}",
            json={"section": "concept", "user_modifications": ""},
        )
    assert resp.status_code == 503
    assert resp.json()["detail"]["code"] == "LLM_GENERATION_FAILED"
