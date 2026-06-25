"""Tests for the v1.7 novel-level outline layer in STAGE3."""
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.conductor.state_machine import Stage, StageStateMachine, PRECONDITIONS
from backend.main import app


@pytest.fixture
def projects_dir(tmp_path):
    d = tmp_path / "projects"
    d.mkdir()
    return d


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def project_data():
    return {
        "title": "测试小说",
        "genre": "cool_novel",
        "min_words": 4000,
        "free_text": "一个少年在异世界觉醒能力",
        "inspiration_source": "web_novel",
    }


def _write_json(projects_dir: Path, project_id: str, filename: str, data):
    p = projects_dir / project_id
    p.mkdir(parents=True, exist_ok=True)
    with open(p / filename, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def _seed_project(projects_dir: Path, proj_id: str):
    """Write the prerequisite files so the project can reach STAGE3."""
    _write_json(projects_dir, proj_id, "project.json", {
        "id": proj_id,
        "title": "测试小说",
        "genre": "cool_novel",
        "min_words": 4000,
        "current_stage": "STAGE3",
        "stage_history": [],
        "created_at": "2025-01-01T00:00:00",
    })
    _write_json(projects_dir, proj_id, "concept_and_dna.json", {
        "concept": {"title": "测试", "premise": "test", "tone": "", "theme": "逆袭"},
        "story_dna": {"core_contradiction": {"statement": "力量 vs 责任"}},
    })
    _write_json(projects_dir, proj_id, "world.json", {
        "era": "异世界", "power_system": {"name": "灵力", "core_rules": []}, "core_rules": [],
    })
    _write_json(projects_dir, proj_id, "characters.json", {
        "characters": [{"id": "c1", "name": "林峰", "personality": {"core_traits": []}, "current_state": {}}],
    })


SAMPLE_NOVEL_OUTLINE = {
    "core_conflict_theme": "底层少年逆袭",
    "volumes": [
        {"name": "第一卷 崛起", "chapter_range": "1-50", "summary": "觉醒与初战", "key_events": ["金手指开启"]},
        {"name": "第二卷 试炼", "chapter_range": "51-120", "summary": "宗门之争", "key_events": ["擂台赛"]},
    ],
    "mc_growth_arc": [
        {"label": "起点: 卑微", "target_chapter_range": "1-20", "description": "出身底层"},
        {"label": "觉醒", "target_chapter_range": "20-50", "description": "能力觉醒"},
    ],
    "key_plot_points": [
        {"title": "上古遗物", "must_appear_in_volume": "第一卷 崛起", "description": "主角金手指", "trigger_chapter_hint": "约第 5 章"},
    ],
}


class TestNovelOutlineEndpoints:
    def test_get_novel_outline_empty_returns_empty_dict(self, client, project_data, monkeypatch):
        """Fresh project with no novel_outline.json — GET returns {} not 404."""
        from backend.config import settings
        monkeypatch.setattr(settings, "projects_dir", settings.projects_dir)
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]

        resp = client.get(f"/api/stage3/novel-outline?project_id={proj_id}")
        assert resp.status_code == 200
        assert resp.json()["detail"] == {}

    def test_generate_novel_outline_creates_file(self, client, project_data, monkeypatch):
        from backend.config import settings
        monkeypatch.setattr(settings, "projects_dir", settings.projects_dir)
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]

        # Advance project to STAGE3 by writing prerequisites
        _seed_project(settings.projects_dir, proj_id)

        with patch("backend.agents.planner.PlannerAgent.generate_novel_outline", new_callable=AsyncMock) as mock:
            mock.return_value = (SAMPLE_NOVEL_OUTLINE, None)

            resp = client.post("/api/stage3/generate-novel-outline", json={"project_id": proj_id})

        assert resp.status_code == 200, resp.text
        detail = resp.json()["detail"]
        assert detail["core_conflict_theme"] == SAMPLE_NOVEL_OUTLINE["core_conflict_theme"]
        assert len(detail["volumes"]) == 2
        assert detail["generated_at"] != ""
        assert detail["updated_at"] != ""

        # File should now exist
        on_disk = json.loads((settings.projects_dir / proj_id / "novel_outline.json").read_text())
        assert on_disk["core_conflict_theme"] == SAMPLE_NOVEL_OUTLINE["core_conflict_theme"]

    def test_generate_novel_outline_requires_concept_world_chars(self, client, project_data, monkeypatch):
        from backend.config import settings
        monkeypatch.setattr(settings, "projects_dir", settings.projects_dir)
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]

        # Advance to STAGE3 but DON'T seed concept/world/characters
        _write_json(settings.projects_dir, proj_id, "project.json", {
            "id": proj_id, "title": "t", "genre": "g", "min_words": 4000,
            "current_stage": "STAGE3", "stage_history": [], "created_at": "2025-01-01T00:00:00",
        })

        resp = client.post("/api/stage3/generate-novel-outline", json={"project_id": proj_id})
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "PRECONDITION_FAILED"

    def test_update_novel_outline_persists_edits(self, client, project_data, monkeypatch):
        from backend.config import settings
        monkeypatch.setattr(settings, "projects_dir", settings.projects_dir)
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]
        _seed_project(settings.projects_dir, proj_id)

        edited = dict(SAMPLE_NOVEL_OUTLINE)
        edited["core_conflict_theme"] = "用户手动改写的主题"
        edited["volumes"] = SAMPLE_NOVEL_OUTLINE["volumes"] + [
            {"name": "第三卷 自定义", "chapter_range": "121-180", "summary": "用户加的", "key_events": []}
        ]

        resp = client.put("/api/stage3/novel-outline", json={
            "project_id": proj_id, "novel_outline": edited,
        })
        assert resp.status_code == 200
        assert resp.json()["detail"]["core_conflict_theme"] == "用户手动改写的主题"
        assert len(resp.json()["detail"]["volumes"]) == 3

        # GET should return the same
        get_resp = client.get(f"/api/stage3/novel-outline?project_id={proj_id}")
        assert get_resp.json()["detail"]["volumes"][-1]["name"] == "第三卷 自定义"


class TestStateMachinePreconditions:
    """The new STAGE3 preconditions must require novel_outline.json."""

    def test_stage3_preconditions_include_novel_outline(self):
        checks = PRECONDITIONS[Stage.STAGE3]
        filenames = [c[0] for c in checks]
        assert "novel_outline.json" in filenames

    def test_state_machine_blocks_stage3_without_novel_outline(self, projects_dir):
        """Project at STAGE2 with all STAGE3 prereqs EXCEPT novel_outline.json
        must fail to advance to STAGE3 — the new precondition triggers."""
        sm = StageStateMachine(projects_dir)
        proj_id = "proj_test"
        # Project at STAGE2 with STAGE3 prereqs (world, characters) but no novel_outline
        _write_json(projects_dir, proj_id, "project.json", {
            "id": proj_id, "title": "t", "genre": "g", "min_words": 4000,
            "current_stage": "STAGE2", "stage_history": [], "created_at": "2025-01-01T00:00:00",
        })
        _write_json(projects_dir, proj_id, "characters.json", {
            "characters": [{"id": "c1", "name": "林峰"}],
        })
        _write_json(projects_dir, proj_id, "world.json", {"era": "异世界"})

        result = sm.transition_check(proj_id, Stage.STAGE3)
        assert not result.allowed
        # Failure must mention novel_outline.json — either in missing_files or failed_checks
        all_messages = " ".join(result.missing_files + result.failed_checks)
        assert "novel_outline.json" in all_messages, (
            f"Expected novel_outline.json to be flagged. missing={result.missing_files} "
            f"failed={result.failed_checks}"
        )

    def test_state_machine_allows_stage3_with_novel_outline(self, projects_dir):
        sm = StageStateMachine(projects_dir)
        proj_id = "proj_test"
        _write_json(projects_dir, proj_id, "project.json", {
            "id": proj_id, "title": "t", "genre": "g", "min_words": 4000,
            "current_stage": "STAGE2", "stage_history": [], "created_at": "2025-01-01T00:00:00",
        })
        _write_json(projects_dir, proj_id, "characters.json", {
            "characters": [{"id": "c1", "name": "林峰"}],
        })
        _write_json(projects_dir, proj_id, "world.json", {"era": "异世界"})
        _write_json(projects_dir, proj_id, "novel_outline.json", SAMPLE_NOVEL_OUTLINE)

        result = sm.transition_check(proj_id, Stage.STAGE3)
        assert result.allowed, f"Should pass: missing={result.missing_files} failed={result.failed_checks}"
