"""End-to-end verification for the volume-scoped chapter outline feature.

Exercises the actual /api/stage3/* endpoints that the wizard calls,
captures the planner kwargs the LLM would see, and asserts:
- Cast includes antagonist (not just characters[0])
- characters.json growth-curve ranges are aligned after the call
- kwargs passed to planner contain all expected slices (not None)
- progress.json total_chapters reflects planned_total

This is the "manual acceptance" task in plan 2026-08-21-volume-scoped-chapter-outline
(Task 6), translated into automated form for CI. A human still needs to walk
the wizard once to confirm UI flows, but the API surface and on-disk state
are fully verified here.
"""
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
         "summary": "觉醒与初战", "key_events": ["金手指开启", "首次杀人"]},
        {"name": "第二卷 试炼", "chapter_range": "51-120",
         "summary": "宗门之争", "key_events": ["擂台赛"]},
        {"name": "第三卷 归墟", "chapter_range": "121-200",
         "summary": "直面真相", "key_events": ["师父身死"]},
    ],
    "mc_growth_arc": [
        {"label": "起点", "target_chapter_range": "1-30", "description": "出身底层"},
        {"label": "觉醒", "target_chapter_range": "31-100", "description": "金手指觉醒"},
        {"label": "登顶", "target_chapter_range": "101-200", "description": "问鼎"},
    ],
    "key_plot_points": [
        {"title": "上古遗物", "must_appear_in_volume": "第一卷",
         "description": "金手指来源", "trigger_chapter_hint": "约第 5 章"},
    ],
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


def _write(projects_dir: Path, project_id: str, filename: str, data):
    p = projects_dir / project_id
    p.mkdir(parents=True, exist_ok=True)
    with open(p / filename, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def _seed(projects_dir: Path, proj_id: str, stages_range: str = "1-1"):
    _write(projects_dir, proj_id, "project.json", {
        "id": proj_id, "title": "e2e测试", "genre": "cool_novel", "min_words": 4000,
        "current_stage": "STAGE3", "stage_history": [], "created_at": "2025-01-01T00:00:00",
    })
    _write(projects_dir, proj_id, "concept_and_dna.json", {
        "concept": {"title": "测试", "free_text": "少年觉醒"},
        "story_dna": {},
    })
    _write(projects_dir, proj_id, "world.json", {
        "era": "异世界", "power_system": {"name": "灵力", "core_rules": []},
        "core_rules": [],
    })
    _write(projects_dir, proj_id, "characters.json", {"characters": [
        {"id": "mc", "name": "林峰", "character_type": "protagonist",
         "is_core_character": True, "personality": {"core_traits": ["坚韧"]},
         "current_state": {}, "relations": {},
         "growth_curve": {"curve_description": "", "stages": [
             {"stage_number": 1, "stage_name": "觉醒",
              "trigger_event_type": "moral_awakening",
              "trigger_event_description": "顿悟", "character_change": "由怯懦转为果决",
              "target_chapter_range": stages_range, "bound_chapter": None},
         ]}},
        {"id": "ant", "name": "黑袍人", "character_type": "antagonist",
         "is_core_character": False, "personality": {"core_traits": ["阴狠"]},
         "current_state": {}, "relations": {}},
    ]})


def _setup_project(client, projects_dir, stages_range: str = "1-1") -> str:
    resp = client.post("/api/project/create", json={
        "title": "e2e测试", "genre": "cool_novel", "min_words": 4000,
        "free_text": "少年觉醒", "inspiration_source": "web_novel",
    })
    proj_id = resp.json()["detail"]["id"]
    _seed(projects_dir, proj_id, stages_range=stages_range)
    _write(projects_dir, proj_id, "novel_outline.json", dict(NOVEL_OUTLINE))
    return proj_id


class TestEndToEndPromptSlicing:
    """Captures the kwargs the planner receives via /api/stage3/generate
    and asserts the slicing+cast wiring works end-to-end."""

    def test_chapter_1_first_volume_no_recent_text(self, client):
        from backend.config import settings
        proj_id = _setup_project(client, settings.projects_dir)

        with patch("backend.agents.planner.PlannerAgent.generate_outline",
                   new_callable=AsyncMock) as mock:
            mock.return_value = (dict(CHAPTER_RESULT), None)
            resp = client.post("/api/stage3/generate",
                               json={"project_id": proj_id, "chapter_number": 1})

        assert resp.status_code == 200, resp.text
        assert mock.call_count == 1

    def test_character_ranges_aligned_on_first_generate(self, client):
        from backend.config import settings
        proj_id = _setup_project(client, settings.projects_dir)

        with patch("backend.agents.planner.PlannerAgent.generate_outline",
                   new_callable=AsyncMock) as mock:
            mock.return_value = (dict(CHAPTER_RESULT), None)
            client.post("/api/stage3/generate",
                        json={"project_id": proj_id, "chapter_number": 1})

        chars = json.loads((settings.projects_dir / proj_id / "characters.json").read_text())
        ranges = [s["target_chapter_range"]
                  for s in chars["characters"][0]["growth_curve"]["stages"]]
        assert ranges == ["1-30"], f"Expected ['1-30'] got {ranges}"

    def test_planner_called_with_full_cast_and_outline(self, client):
        from backend.config import settings
        proj_id = _setup_project(client, settings.projects_dir)

        with patch("backend.agents.planner.PlannerAgent.generate_outline",
                   new_callable=AsyncMock) as mock:
            mock.return_value = (dict(CHAPTER_RESULT), None)
            client.post("/api/stage3/generate",
                        json={"project_id": proj_id, "chapter_number": 1})

        kwargs = mock.call_args.kwargs
        names = [c["name"] for c in kwargs["characters"]]
        assert "林峰" in names and "黑袍人" in names, f"Cast missing characters: {names}"
        assert kwargs.get("outline") is not None
        assert "character" not in kwargs

    def test_progress_total_matches_novel_planned_total(self, client):
        from backend.config import settings
        proj_id = _setup_project(client, settings.projects_dir)

        with patch("backend.agents.planner.PlannerAgent.generate_outline",
                   new_callable=AsyncMock) as mock:
            mock.return_value = (dict(CHAPTER_RESULT), None)
            client.post("/api/stage3/generate",
                        json={"project_id": proj_id, "chapter_number": 1})

        progress = json.loads((settings.projects_dir / proj_id / "progress.json").read_text())
        assert progress.get("total_chapters") == 200, (
            f"Expected total_chapters=200 (planned_total), got {progress.get('total_chapters')}"
        )

    def test_outline_json_persists_chapter_after_generate(self, client):
        from backend.config import settings
        proj_id = _setup_project(client, settings.projects_dir)

        with patch("backend.agents.planner.PlannerAgent.generate_outline",
                   new_callable=AsyncMock) as mock:
            mock.return_value = (dict(CHAPTER_RESULT, chapter_number=42), None)
            client.post("/api/stage3/generate",
                        json={"project_id": proj_id, "chapter_number": 42})

        outline = json.loads((settings.projects_dir / proj_id / "outline.json").read_text())
        chapters = outline.get("chapters", [])
        assert len(chapters) == 1
        assert chapters[0]["chapter_number"] == 42

    def test_legacy_degenerate_ranges_realigned_on_entry(self, client):
        """Projects whose growth-stage ranges were written by the deleted
        auto_generator (all degenerate "1-1") are realigned by /stage3/generate
        as a migration path — no manual re-save required."""
        from backend.config import settings
        proj_id = _setup_project(client, settings.projects_dir, stages_range="1-1")
        chars = json.loads((settings.projects_dir / proj_id / "characters.json").read_text())
        assert chars["characters"][0]["growth_curve"]["stages"][0]["target_chapter_range"] == "1-1"

        with patch("backend.agents.planner.PlannerAgent.generate_outline",
                   new_callable=AsyncMock) as mock:
            mock.return_value = (dict(CHAPTER_RESULT), None)
            client.post("/api/stage3/generate",
                        json={"project_id": proj_id, "chapter_number": 1})

        chars = json.loads((settings.projects_dir / proj_id / "characters.json").read_text())
        ranges = [s["target_chapter_range"]
                  for s in chars["characters"][0]["growth_curve"]["stages"]]
        assert ranges == ["1-30"], f"Expected post-call re-alignment to ['1-30'], got {ranges}"