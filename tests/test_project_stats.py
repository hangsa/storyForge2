"""Tests for GET /api/project/stats aggregation endpoint."""
import json
import re
import shutil
import tempfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def temp_projects_dir():
    d = Path(tempfile.mkdtemp())
    yield d
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def client(temp_projects_dir):
    from backend.config import settings
    original = settings.projects_dir
    settings.projects_dir = temp_projects_dir

    from backend.api.project import router as project_router
    app = FastAPI()
    app.include_router(project_router)
    yield TestClient(app)
    settings.projects_dir = original


def _make_project(root: Path, pid: str, *, stage: str = "STAGE4", title: str = "X") -> Path:
    pdir = root / pid
    pdir.mkdir(parents=True)
    (pdir / "project.json").write_text(
        json.dumps({"id": pid, "title": title, "current_stage": stage}, ensure_ascii=False),
        encoding="utf-8",
    )
    return pdir


def _add_outline(pdir: Path, chapters):
    (pdir / "outline.json").write_text(
        json.dumps({"chapters": [{"chapter_number": n} for n in chapters]}, ensure_ascii=False),
        encoding="utf-8",
    )


def _add_scene_draft(pdir: Path, chapter: int, scene: int, body: str) -> None:
    chapters_dir = pdir / "chapters"
    chapters_dir.mkdir(exist_ok=True)
    fname = "ch" + str(chapter).zfill(2) + "_scene_" + str(scene).zfill(3) + "_draft.md"
    (chapters_dir / fname).write_text(body, encoding="utf-8")


class TestProjectStats:
    def test_empty_projects_dir_returns_zeros(self, client):
        resp = client.get("/api/project/stats")
        assert resp.status_code == 200
        data = resp.json()["detail"]
        assert data["total_books"] == 0
        assert data["total_chapters"] == 0
        assert data["total_words"] == 0
        assert data["stage_distribution"] == {
            "INIT": 0, "STAGE1": 0, "STAGE2": 0, "STAGE3": 0,
            "STAGE4": 0, "STAGE5": 0, "STAGE6": 0, "COMPLETED": 0,
        }

    def test_counts_books_and_stage_distribution(self, client, temp_projects_dir):
        _make_project(temp_projects_dir, "proj_a", stage="STAGE4")
        _make_project(temp_projects_dir, "proj_b", stage="STAGE1")
        _make_project(temp_projects_dir, "proj_c", stage="STAGE4")

        resp = client.get("/api/project/stats")
        data = resp.json()["detail"]
        assert data["total_books"] == 3
        assert data["stage_distribution"]["STAGE4"] == 2
        assert data["stage_distribution"]["STAGE1"] == 1
        assert data["stage_distribution"]["STAGE2"] == 0

    def test_counts_total_chapters_from_outlines(self, client, temp_projects_dir):
        a = _make_project(temp_projects_dir, "proj_a")
        _add_outline(a, [1, 2, 3])
        b = _make_project(temp_projects_dir, "proj_b")
        _add_outline(b, [1, 2])

        resp = client.get("/api/project/stats")
        assert resp.json()["detail"]["total_chapters"] == 5

    def test_missing_outline_counts_zero_for_that_project(self, client, temp_projects_dir):
        _make_project(temp_projects_dir, "proj_a")
        b = _make_project(temp_projects_dir, "proj_b")
        _add_outline(b, [1, 2, 3])

        resp = client.get("/api/project/stats")
        assert resp.json()["detail"]["total_chapters"] == 3

    def test_total_words_sums_draft_characters(self, client, temp_projects_dir):
        a = _make_project(temp_projects_dir, "proj_a")
        _add_scene_draft(a, 1, 1, "你好世界")
        _add_scene_draft(a, 1, 2, "abc")
        b = _make_project(temp_projects_dir, "proj_b")
        _add_scene_draft(b, 1, 1, "中文一")

        resp = client.get("/api/project/stats")
        assert resp.json()["detail"]["total_words"] == 10

    def test_total_words_strips_sf_log_comments(self, client, temp_projects_dir):
        a = _make_project(temp_projects_dir, "proj_a")
        body_with_log = "正文ABC<!-- SF_LOG knowledge_gain char=\"X\" content=\"Y\" -->正文DEF"
        _add_scene_draft(a, 1, 1, body_with_log)
        resp = client.get("/api/project/stats")
        # After stripping the SF_LOG comment the visible body is
        # "正文ABC正文DEF" which is 10 characters (Chinese chars count as 1).
        assert resp.json()["detail"]["total_words"] == 10

    def test_unknown_stage_buckets_into_other_zero(self, client, temp_projects_dir):
        _make_project(temp_projects_dir, "proj_a", stage="MYSTAGE")
        resp = client.get("/api/project/stats")
        data = resp.json()["detail"]
        assert data["total_books"] == 1
        assert data["stage_distribution"]["STAGE4"] == 0
        assert data["stage_distribution"].get("MYSTAGE", 0) == 0

    def test_does_not_recurse_into_subdirs(self, client, temp_projects_dir):
        stray_content = json.dumps({"id": "stray", "current_stage": "STAGE4"}, ensure_ascii=False)
        (temp_projects_dir / "stray.json").write_text(stray_content, encoding="utf-8")
        resp = client.get("/api/project/stats")
        assert resp.json()["detail"]["total_books"] == 0

    def test_skips_unreadable_project_json_without_500(self, client, temp_projects_dir):
        bad = _make_project(temp_projects_dir, "proj_a")
        (bad / "project.json").write_text("{not valid json", encoding="utf-8")
        resp = client.get("/api/project/stats")
        assert resp.status_code == 200
        assert resp.json()["detail"]["total_books"] == 0

    def test_includes_all_seven_canonical_stages(self, client):
        resp = client.get("/api/project/stats")
        keys = set(resp.json()["detail"]["stage_distribution"].keys())
        assert keys == {"INIT", "STAGE1", "STAGE2", "STAGE3", "STAGE4", "STAGE5", "STAGE6", "COMPLETED"}

    def test_word_count_series_is_cumulative_and_monotonic(self, client, temp_projects_dir):
        # Three chapter drafts across two projects, written in this order so
        # mtime ordering matches insertion order. Series must be cumulative
        # word counts in that order — strictly non-decreasing, with the final
        # value equal to total_words.
        a = _make_project(temp_projects_dir, "proj_a")
        b = _make_project(temp_projects_dir, "proj_b")
        _add_scene_draft(a, 1, 1, "你好")                # 2 chars
        _add_scene_draft(a, 1, 2, "中文测试")            # 4 chars
        _add_scene_draft(b, 1, 1, "abc")                # 3 chars

        resp = client.get("/api/project/stats")
        detail = resp.json()["detail"]
        series = detail["word_count_series"]
        assert len(series) == 3
        assert series == [2, 6, 9]
        assert series[-1] == detail["total_words"]
        for prev, curr in zip(series, series[1:]):
            assert curr >= prev

    def test_word_count_series_empty_when_no_chapters(self, client):
        resp = client.get("/api/project/stats")
        assert resp.json()["detail"]["word_count_series"] == []
