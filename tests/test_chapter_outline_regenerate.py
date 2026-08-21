"""Tests for POST /api/stage3/regenerate-chapter-outline.

Drives workspace sidebar "regenerate chapter outline" — replaces
chapter_start..chapter_end in outline.json's chapters[] via PlannerAgent,
leaves everything else byte-identical.

Mirrors the project_data + _write_json + _seed pattern used in
test_stage3_novel_outline.py so the module-level fm in stage3_outline.py
resolves to tmp_path via monkeypatched settings.projects_dir.
"""
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app


SAMPLE_NOVEL_OUTLINE = {
    "core_conflict_theme": "底层少年逆袭",
    "volumes": [
        {"name": "第一卷 崛起", "chapter_range": "1-50", "summary": "觉醒", "key_events": ["金手指开启"]},
    ],
    "mc_growth_arc": [],
    "key_plot_points": [],
}


@pytest.fixture
def client():
    return TestClient(app)


def _write_json(projects_dir: Path, project_id: str, filename: str, data):
    p = projects_dir / project_id
    p.mkdir(parents=True, exist_ok=True)
    with open(p / filename, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def _seed(projects_dir: Path, proj_id: str, planned_total: int = 5):
    """Write the prerequisite files for /regenerate-chapter-outline.

    `current_stage` is STAGE4 because the workspace runs after STAGE3
    has already produced outline.json (workspace sidebar regenerate is
    an after-the-fact edit, not a first-time generation).
    """
    _write_json(projects_dir, proj_id, "project.json", {
        "id": proj_id,
        "title": "测试小说",
        "genre": "cool_novel",
        "min_words": 4000,
        "current_stage": "STAGE4",
        "stage_history": [],
        "created_at": "2025-01-01T00:00:00",
    })
    _write_json(projects_dir, proj_id, "concept_and_dna.json", {
        "concept": {"title": "测试", "premise": "test", "tone": "", "theme": "逆袭"},
        "story_dna": {"core_contradiction": {"statement": "力量 vs 责任"}},
    })
    _write_json(projects_dir, proj_id, "world.json", {
        "era": "异世界",
        "power_system": {"name": "灵力", "core_rules": []},
        "core_rules": [],
    })
    _write_json(projects_dir, proj_id, "characters.json", {
        "characters": [
            {
                "id": "c1",
                "name": "林峰",
                "personality": {"core_traits": []},
                "current_state": {},
                "growth_curve": {
                    "stages": [
                        {"label": "起点: 卑微", "bound_chapter": 1},
                        {"label": "觉醒", "bound_chapter": 3},
                    ],
                },
            }
        ],
    })
    # novel_outline.json carries the planned_total the validator checks against.
    novel = dict(SAMPLE_NOVEL_OUTLINE)
    novel["volumes"] = [
        {"name": "第一卷", "chapter_range": f"1-{planned_total}", "summary": "x", "key_events": []},
    ]
    _write_json(projects_dir, proj_id, "novel_outline.json", novel)
    _write_json(projects_dir, proj_id, "outline.json", {
        "chapters": [
            {"chapter_number": i, "title": f"ch{i}-old", "theme": f"theme-{i}"}
            for i in range(1, planned_total + 1)
        ],
    })
    _write_json(projects_dir, proj_id, "progress.json", {
        "total_chapters": planned_total,
    })


def _regenerate_url(proj_id: str) -> str:
    return f"/api/stage3/regenerate-chapter-outline?project_id={proj_id}"


def _patch_fm_and_settings(monkeypatch, projects_dir):
    """stage3_outline.py freezes `fm = FileManager(settings.projects_dir)` at
    module import. Tests need both:
      1. settings.projects_dir pointing at tmp_path (for *re-resolved* callsites)
      2. fm.projects_dir pointing at tmp_path (for the frozen module-level fm)
    """
    from backend.api import stage3_outline
    from backend.config import settings

    monkeypatch.setattr(settings, "projects_dir", projects_dir)
    monkeypatch.setattr(stage3_outline.fm, "projects_dir", projects_dir)


class TestRegenerateChapterOutline:
    def test_regenerate_single_chapter_returns_merged_outline(
        self, client, projects_dir, monkeypatch
    ):
        """Happy path: regenerate chapter 3 only, return updated chapters[]."""
        _patch_fm_and_settings(monkeypatch, projects_dir)
        proj_id = "proj_single"
        _seed(projects_dir, proj_id, planned_total=5)

        new_ch3 = {
            "chapter_number": 3,
            "title": "ch3-NEW",
            "theme": "theme-3-new",
            "scenes": [{"scene_number": 1, "summary": "新写"}],
        }

        with patch("backend.agents.planner.PlannerAgent") as MockAgent:
            instance = MockAgent.return_value
            instance.generate_outline = AsyncMock(return_value=(new_ch3, None))

            resp = client.post(_regenerate_url(proj_id), json={
                "chapter_start": 3,
                "chapter_end": 3,
                "user_modifications": "",
            })

        assert resp.status_code == 200, resp.text
        detail = resp.json()["detail"]
        chapters = detail["chapters"]
        assert len(chapters) == 5
        assert chapters[2]["chapter_number"] == 3
        assert chapters[2]["title"] == "ch3-NEW"
        assert chapters[2]["theme"] == "theme-3-new"
        # Other chapters byte-identical
        assert chapters[0] == {"chapter_number": 1, "title": "ch1-old", "theme": "theme-1"}
        assert chapters[1] == {"chapter_number": 2, "title": "ch2-old", "theme": "theme-2"}
        assert chapters[3] == {"chapter_number": 4, "title": "ch4-old", "theme": "theme-4"}
        assert chapters[4] == {"chapter_number": 5, "title": "ch5-old", "theme": "theme-5"}

        # Agent called exactly once, with chapter_number=3
        instance.generate_outline.assert_awaited_once()
        call_kwargs = instance.generate_outline.await_args.kwargs
        assert call_kwargs["chapter_number"] == 3

        # Persisted to disk
        on_disk = json.loads((projects_dir / proj_id / "outline.json").read_text())
        persisted = {c["chapter_number"]: c for c in on_disk["chapters"]}
        assert persisted[3]["title"] == "ch3-NEW"
        assert persisted[1]["title"] == "ch1-old"

    def test_regenerate_range_calls_agent_per_chapter(
        self, client, projects_dir, monkeypatch
    ):
        """Multi-chapter range: agent called once per chapter, in order,
        range-external chapters left intact."""
        _patch_fm_and_settings(monkeypatch, projects_dir)
        proj_id = "proj_range"
        _seed(projects_dir, proj_id, planned_total=5)

        calls: list[int] = []

        async def fake_generate_outline(*args, chapter_number: int = 0, **kwargs):
            calls.append(chapter_number)
            return (
                {"chapter_number": chapter_number, "title": f"ch{chapter_number}-NEW", "theme": "fresh"},
                None,
            )

        with patch("backend.agents.planner.PlannerAgent") as MockAgent:
            instance = MockAgent.return_value
            instance.generate_outline = AsyncMock(side_effect=fake_generate_outline)

            resp = client.post(_regenerate_url(proj_id), json={
                "chapter_start": 2,
                "chapter_end": 4,
                "user_modifications": "让节奏更紧凑",
            })

        assert resp.status_code == 200, resp.text
        # Agent called exactly 3 times, in order, for chapters 2..4.
        assert calls == [2, 3, 4]

        chapters = resp.json()["detail"]["chapters"]
        assert len(chapters) == 5
        # ch1 + ch5 untouched.
        assert chapters[0]["title"] == "ch1-old"
        assert chapters[4]["title"] == "ch5-old"
        # ch2..ch4 replaced with NEW.
        for n in (2, 3, 4):
            assert chapters[n - 1]["title"] == f"ch{n}-NEW"
            assert chapters[n - 1]["theme"] == "fresh"
        # Sorted by chapter_number.
        assert [c["chapter_number"] for c in chapters] == [1, 2, 3, 4, 5]

        # user_modifications passed through verbatim on every call.
        assert instance.generate_outline.await_count == 3
        for call in instance.generate_outline.await_args_list:
            assert call.kwargs["user_modifications"] == "让节奏更紧凑"

    def test_regenerate_end_before_start_returns_400(
        self, client, projects_dir, monkeypatch
    ):
        """chapter_end < chapter_start → 400 VALIDATION_ERROR."""
        _patch_fm_and_settings(monkeypatch, projects_dir)
        proj_id = "proj_invalid_range"
        _seed(projects_dir, proj_id, planned_total=5)

        with patch("backend.agents.planner.PlannerAgent") as MockAgent:
            instance = MockAgent.return_value
            instance.generate_outline = AsyncMock()

            resp = client.post(_regenerate_url(proj_id), json={
                "chapter_start": 4,
                "chapter_end": 2,
            })

        assert resp.status_code == 400
        body = resp.json()["detail"]
        assert body["code"] == "VALIDATION_ERROR"
        assert "chapter_end" in body["message"]
        # Agent must not be called on invalid range.
        instance.generate_outline.assert_not_called()

    def test_regenerate_end_exceeds_planned_total_returns_400(
        self, client, projects_dir, monkeypatch
    ):
        """chapter_end > planned_total → 400 VALIDATION_ERROR."""
        _patch_fm_and_settings(monkeypatch, projects_dir)
        proj_id = "proj_overflow"
        _seed(projects_dir, proj_id, planned_total=5)

        with patch("backend.agents.planner.PlannerAgent") as MockAgent:
            instance = MockAgent.return_value
            instance.generate_outline = AsyncMock()

            resp = client.post(_regenerate_url(proj_id), json={
                "chapter_start": 4,
                "chapter_end": 99,
            })

        assert resp.status_code == 400
        body = resp.json()["detail"]
        assert body["code"] == "VALIDATION_ERROR"
        assert "planned_total" in body["message"]
        instance.generate_outline.assert_not_called()

    def test_regenerate_empty_outline_returns_400(
        self, client, projects_dir, monkeypatch
    ):
        """outline.json without chapters[] → 400 PRECONDITION_FAILED."""
        _patch_fm_and_settings(monkeypatch, projects_dir)
        proj_id = "proj_empty"
        _seed(projects_dir, proj_id, planned_total=5)
        # Overwrite outline.json with no chapters field.
        _write_json(projects_dir, proj_id, "outline.json", {})

        with patch("backend.agents.planner.PlannerAgent") as MockAgent:
            instance = MockAgent.return_value
            instance.generate_outline = AsyncMock()

            resp = client.post(_regenerate_url(proj_id), json={
                "chapter_start": 1,
                "chapter_end": 3,
            })

        assert resp.status_code == 400
        body = resp.json()["detail"]
        assert body["code"] == "PRECONDITION_FAILED"
        assert "outline.json" in body["message"]
        instance.generate_outline.assert_not_called()

    def test_regenerate_does_not_touch_characters_or_progress(
        self, client, projects_dir, monkeypatch
    ):
        """Sidebar regenerate must not modify characters.json's growth_curve.bound_chapter
        or progress.json.total_chapters — only outline.json's chapters[]."""
        _patch_fm_and_settings(monkeypatch, projects_dir)
        proj_id = "proj_isolation"
        _seed(projects_dir, proj_id, planned_total=5)

        # Snapshot pre-call state of growth_curve + progress.
        pre_chars = json.loads((projects_dir / proj_id / "characters.json").read_text())
        pre_progress = json.loads((projects_dir / proj_id / "progress.json").read_text())

        new_ch2 = {"chapter_number": 2, "title": "ch2-NEW", "theme": "fresh"}

        with patch("backend.agents.planner.PlannerAgent") as MockAgent:
            instance = MockAgent.return_value
            instance.generate_outline = AsyncMock(return_value=(new_ch2, None))

            resp = client.post(_regenerate_url(proj_id), json={
                "chapter_start": 2,
                "chapter_end": 2,
            })

        assert resp.status_code == 200, resp.text

        post_chars = json.loads((projects_dir / proj_id / "characters.json").read_text())
        post_progress = json.loads((projects_dir / proj_id / "progress.json").read_text())

        # characters.json byte-identical — especially growth_curve.bound_chapter.
        assert post_chars == pre_chars
        assert post_chars["characters"][0]["growth_curve"]["stages"][0]["bound_chapter"] == 1
        assert post_chars["characters"][0]["growth_curve"]["stages"][1]["bound_chapter"] == 3

        # progress.json byte-identical — total_chapters not refreshed.
        assert post_progress == pre_progress
        assert post_progress["total_chapters"] == 5

    def test_regenerate_partial_failure_returns_503_without_disk_write(
        self, client, projects_dir, monkeypatch
    ):
        """range 中途失败 → 503 LLM_GENERATION_FAILED，磁盘 outline.json 不变。

        区间 [3, 4] 中，ch3 成功但仅存在于内存（循环外才写盘），
        ch4 raise ValueError → 整批不写盘，磁盘保留旧 outline.json。
        """
        _patch_fm_and_settings(monkeypatch, projects_dir)
        proj_id = "proj_partial_fail"
        _seed(projects_dir, proj_id, planned_total=5)

        async def fake_generate_outline(*args, chapter_number: int = 0, **kwargs):
            if chapter_number == 3:
                return (
                    {"chapter_number": 3, "title": "ch3-NEW", "theme": "fresh"},
                    None,
                )
            raise ValueError("LLM failed on ch4")

        with patch("backend.agents.planner.PlannerAgent") as MockAgent:
            instance = MockAgent.return_value
            instance.generate_outline = fake_generate_outline

            resp = client.post(_regenerate_url(proj_id), json={
                "chapter_start": 3,
                "chapter_end": 4,
                "user_modifications": "",
            })

        assert resp.status_code == 503
        body = resp.json()["detail"]
        assert body["code"] == "LLM_GENERATION_FAILED"
        assert "ch4" in body["message"]

        # 磁盘 outline.json 未变 —— ch3 仍为 "ch3-old"，没有 ch3-NEW 残留。
        on_disk = json.loads((projects_dir / proj_id / "outline.json").read_text())
        ch3 = next(c for c in on_disk["chapters"] if c["chapter_number"] == 3)
        assert ch3["title"] == "ch3-old"
        assert ch3["theme"] == "theme-3"

    def test_regenerate_missing_body_returns_422(
        self, client, projects_dir, monkeypatch
    ):
        """POST without a JSON body must 422 (Pydantic validation), not 500."""
        _patch_fm_and_settings(monkeypatch, projects_dir)
        proj_id = "proj_no_body"
        _seed(projects_dir, proj_id, planned_total=5)

        with patch("backend.agents.planner.PlannerAgent") as MockAgent:
            instance = MockAgent.return_value
            instance.generate_outline = AsyncMock()

            resp = client.post(_regenerate_url(proj_id))

        assert resp.status_code == 422
        instance.generate_outline.assert_not_called()


@pytest.fixture
def projects_dir(tmp_path):
    """Reuse the same fixture name as test_stage3_novel_outline.py."""
    d = tmp_path / "projects"
    d.mkdir()
    return d