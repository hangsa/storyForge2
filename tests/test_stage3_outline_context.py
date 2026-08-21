"""Tests for STAGE3 endpoint wiring of volume slicing + growth alignment (v2.1)."""
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app

NOVEL_OUTLINE = {
    "core_conflict_theme": "底层少年逆袭",
    "volumes": [
        {"name": "第一卷 崛起", "chapter_range": "1-50",
         "summary": "觉醒", "key_events": ["金手指开启"]},
        {"name": "第二卷 试炼", "chapter_range": "51-120",
         "summary": "宗门之争", "key_events": ["擂台赛"]},
    ],
    "mc_growth_arc": [
        {"label": "起点", "target_chapter_range": "1-20", "description": "出身底层"},
        {"label": "登顶", "target_chapter_range": "101-120", "description": "问鼎"},
    ],
    "key_plot_points": [],
}

CHAPTER_RESULT = {
    "chapter_number": 1, "title": "开端", "theme": "起势",
    "scene_plan": [{"scene_number": 1, "goal": "开场", "conflict": "",
                    "emotional_arc": "", "narrative_role": "setup",
                    "beat_type": "setup", "required_logs": [],
                    "registry_changes": {"created": [], "updated": []}}],
}


@pytest.fixture
def client():
    return TestClient(app)


def _write_json(projects_dir: Path, project_id: str, filename: str, data):
    p = projects_dir / project_id
    p.mkdir(parents=True, exist_ok=True)
    with open(p / filename, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def _seed(projects_dir: Path, proj_id: str, stages_range: str = "9-9"):
    _write_json(projects_dir, proj_id, "project.json", {
        "id": proj_id, "title": "测试小说", "genre": "cool_novel", "min_words": 4000,
        "current_stage": "STAGE3", "stage_history": [], "created_at": "2025-01-01T00:00:00",
    })
    _write_json(projects_dir, proj_id, "concept_and_dna.json", {
        "concept": {"title": "测试"}, "story_dna": {},
    })
    _write_json(projects_dir, proj_id, "world.json", {
        "era": "异世界", "power_system": {"name": "灵力", "core_rules": []}, "core_rules": [],
    })
    _write_json(projects_dir, proj_id, "characters.json", {"characters": [
        {"id": "mc", "name": "林峰", "character_type": "protagonist",
         "is_core_character": True, "personality": {}, "current_state": {}, "relations": {},
         "growth_curve": {"curve_description": "", "stages": [
             {"stage_number": 1, "stage_name": "起", "trigger_event_type": "moral_awakening",
              "trigger_event_description": "", "character_change": "",
              "target_chapter_range": stages_range, "bound_chapter": None},
             {"stage_number": 2, "stage_name": "承", "trigger_event_type": "moral_awakening",
              "trigger_event_description": "", "character_change": "",
              "target_chapter_range": stages_range, "bound_chapter": None},
         ]}},
    ]})


def _new_project(client, projects_dir) -> str:
    resp = client.post("/api/project/create", json={
        "title": "测试小说", "genre": "cool_novel", "min_words": 4000,
        "free_text": "少年觉醒", "inspiration_source": "web_novel",
    })
    proj_id = resp.json()["detail"]["id"]
    _seed(projects_dir, proj_id)
    return proj_id


def _stage_ranges(projects_dir: Path, proj_id: str) -> list[str]:
    data = json.loads((projects_dir / proj_id / "characters.json").read_text())
    return [s["target_chapter_range"]
            for s in data["characters"][0]["growth_curve"]["stages"]]


class TestAlignmentOnNovelOutlineEndpoints:
    def test_generate_novel_outline_aligns_growth_curves(self, client):
        from backend.config import settings
        proj_id = _new_project(client, settings.projects_dir)

        with patch("backend.agents.planner.PlannerAgent.generate_novel_outline",
                   new_callable=AsyncMock) as mock:
            mock.return_value = (dict(NOVEL_OUTLINE), None)
            resp = client.post("/api/stage3/generate-novel-outline",
                               json={"project_id": proj_id})

        assert resp.status_code == 200, resp.text
        assert _stage_ranges(settings.projects_dir, proj_id) == ["1-20", "101-120"]

    def test_put_novel_outline_aligns_growth_curves(self, client):
        from backend.config import settings
        proj_id = _new_project(client, settings.projects_dir)

        resp = client.put("/api/stage3/novel-outline",
                          json={"project_id": proj_id, "novel_outline": dict(NOVEL_OUTLINE)})

        assert resp.status_code == 200, resp.text
        assert _stage_ranges(settings.projects_dir, proj_id) == ["1-20", "101-120"]

    def test_regenerate_section_aligns_growth_curves(self, client):
        from backend.config import settings
        proj_id = _new_project(client, settings.projects_dir)
        _write_json(settings.projects_dir, proj_id, "novel_outline.json", dict(NOVEL_OUTLINE))

        with patch("backend.agents.planner.PlannerAgent.generate_novel_outline",
                   new_callable=AsyncMock) as mock:
            mock.return_value = (dict(NOVEL_OUTLINE), None)
            resp = client.post(
                f"/api/stage3/regenerate-novel-outline-section?project_id={proj_id}",
                json={"section": "volumes", "user_modifications": ""},
            )

        assert resp.status_code == 200, resp.text
        assert _stage_ranges(settings.projects_dir, proj_id) == ["1-20", "101-120"]


class TestGenerateChapterOutline:
    def test_aligns_on_entry_for_legacy_projects(self, client):
        """Existing projects hold degenerate ranges written by the deleted
        auto_generator. /stage3/generate re-aligns without a manual re-save."""
        from backend.config import settings
        proj_id = _new_project(client, settings.projects_dir)
        _write_json(settings.projects_dir, proj_id, "novel_outline.json", dict(NOVEL_OUTLINE))
        assert _stage_ranges(settings.projects_dir, proj_id) == ["9-9", "9-9"]

        with patch("backend.agents.planner.PlannerAgent.generate_outline",
                   new_callable=AsyncMock) as mock:
            mock.return_value = (dict(CHAPTER_RESULT), None)
            resp = client.post("/api/stage3/generate",
                               json={"project_id": proj_id, "chapter_number": 1})

        assert resp.status_code == 200, resp.text
        assert _stage_ranges(settings.projects_dir, proj_id) == ["1-20", "101-120"]

    def test_planner_receives_characters_list_and_outline(self, client):
        from backend.config import settings
        proj_id = _new_project(client, settings.projects_dir)
        _write_json(settings.projects_dir, proj_id, "novel_outline.json", dict(NOVEL_OUTLINE))
        _write_json(settings.projects_dir, proj_id, "outline.json", {"chapters": [
            dict(CHAPTER_RESULT, chapter_number=1),
        ]})

        with patch("backend.agents.planner.PlannerAgent.generate_outline",
                   new_callable=AsyncMock) as mock:
            mock.return_value = (dict(CHAPTER_RESULT, chapter_number=2), None)
            client.post("/api/stage3/generate",
                        json={"project_id": proj_id, "chapter_number": 2})

        kwargs = mock.call_args.kwargs
        assert isinstance(kwargs["characters"], list)
        assert kwargs["characters"][0]["name"] == "林峰"
        assert kwargs["outline"]["chapters"][0]["chapter_number"] == 1
        assert "character" not in kwargs

    def test_total_chapters_uses_planned_total(self, client):
        from backend.config import settings
        proj_id = _new_project(client, settings.projects_dir)
        _write_json(settings.projects_dir, proj_id, "novel_outline.json", dict(NOVEL_OUTLINE))

        with patch("backend.agents.planner.PlannerAgent.generate_outline",
                   new_callable=AsyncMock) as mock:
            mock.return_value = (dict(CHAPTER_RESULT), None)
            client.post("/api/stage3/generate",
                        json={"project_id": proj_id, "chapter_number": 1})

        progress = json.loads((settings.projects_dir / proj_id / "progress.json").read_text())
        assert progress["total_chapters"] == 120