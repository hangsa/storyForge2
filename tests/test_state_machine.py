"""
StageStateMachine unit tests — transitions, preconditions, stage ordering.
"""

import json
import tempfile
from pathlib import Path

import pytest

from backend.conductor.state_machine import (
    Stage,
    StageStateMachine,
    TransitionResult,
    STAGE_ORDER,
    PRECONDITIONS,
)


@pytest.fixture
def projects_dir():
    with tempfile.TemporaryDirectory() as tmp:
        yield Path(tmp)


@pytest.fixture
def sm(projects_dir):
    return StageStateMachine(projects_dir)


def _write_json(projects_dir: Path, project_id: str, filename: str, data: dict):
    project_dir = projects_dir / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    path = project_dir / filename
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


class TestStageEnum:
    def test_stage_order_correct(self):
        assert STAGE_ORDER == [
            Stage.INIT,
            Stage.STAGE1,
            Stage.STAGE2,
            Stage.STAGE3,
            Stage.STAGE4,
            Stage.STAGE5,
            Stage.STAGE6,
            Stage.COMPLETED,
        ]

    def test_stage_values(self):
        assert Stage.INIT.value == "INIT"
        assert Stage.STAGE4.value == "STAGE4"
        assert Stage.STAGE5.value == "STAGE5"
        assert Stage.STAGE6.value == "STAGE6"
        assert Stage.COMPLETED.value == "COMPLETED"


class TestGetCurrentStage:
    def test_default_init_when_no_project(self, sm):
        assert sm.get_current_stage("nonexistent") == Stage.INIT

    def test_returns_saved_stage(self, projects_dir, sm):
        _write_json(projects_dir, "proj_001", "project.json",
                    {"title": "test", "genre": "xianxia", "current_stage": "STAGE2"})
        assert sm.get_current_stage("proj_001") == Stage.STAGE2


class TestGetNextStage:
    def test_init_to_stage1(self, sm):
        assert sm.get_next_stage(Stage.INIT) == Stage.STAGE1

    def test_stage4_to_stage5(self, sm):
        assert sm.get_next_stage(Stage.STAGE4) == Stage.STAGE5

    def test_stage5_to_stage6(self, sm):
        assert sm.get_next_stage(Stage.STAGE5) == Stage.STAGE6

    def test_stage6_to_completed(self, sm):
        assert sm.get_next_stage(Stage.STAGE6) == Stage.COMPLETED

    def test_completed_is_terminal(self, sm):
        assert sm.get_next_stage(Stage.COMPLETED) is None


class TestPreconditions:
    def test_stage1_preconditions(self):
        pre = PRECONDITIONS[Stage.STAGE1]
        assert len(pre) == 2
        files = {p[0] for p in pre}
        assert "project.json" in files

    def test_stage2_needs_concept(self):
        pre = PRECONDITIONS[Stage.STAGE2]
        files = {p[0] for p in pre}
        assert "concept_and_dna.json" in files

    def test_stage3_needs_characters_and_world(self):
        pre = PRECONDITIONS[Stage.STAGE3]
        files = {p[0] for p in pre}
        assert "characters.json" in files
        assert "world.json" in files

    def test_stage4_needs_outline(self):
        pre = PRECONDITIONS[Stage.STAGE4]
        files = {p[0] for p in pre}
        assert "outline.json" in files

    def test_stage5_needs_all_scenes_done(self):
        pre = PRECONDITIONS[Stage.STAGE5]
        assert len(pre) == 1
        assert pre[0][0] == "progress.json"

    def test_stage6_needs_diagnosis_report(self):
        pre = PRECONDITIONS[Stage.STAGE6]
        assert len(pre) == 1
        assert pre[0][0] == "diagnosis_report.json"

    def test_completed_needs_export(self):
        pre = PRECONDITIONS[Stage.COMPLETED]
        assert len(pre) == 1
        assert pre[0][0] == "exports/novel.md"


class TestTransitionCheck:
    def test_valid_transition_init_to_stage1(self, projects_dir, sm):
        _write_json(projects_dir, "proj_001", "project.json",
                    {"title": "test", "genre": "xianxia", "current_stage": "INIT"})
        result = sm.transition_check("proj_001", Stage.STAGE1)
        assert result.allowed

    def test_invalid_skip_stage(self, projects_dir, sm):
        _write_json(projects_dir, "proj_001", "project.json",
                    {"title": "test", "current_stage": "INIT"})
        result = sm.transition_check("proj_001", Stage.STAGE3)
        assert not result.allowed
        assert "无效的阶段转换" in result.message

    def test_missing_precondition_files(self, projects_dir, sm):
        _write_json(projects_dir, "proj_001", "project.json",
                    {"title": "test", "genre": "xianxia", "current_stage": "STAGE1"})
        result = sm.transition_check("proj_001", Stage.STAGE2)
        assert not result.allowed
        assert len(result.missing_files) > 0
        assert "concept_and_dna.json" in result.missing_files

    def test_stage1_precondition_title_empty(self, projects_dir, sm):
        _write_json(projects_dir, "proj_001", "project.json",
                    {"title": "", "genre": "xianxia", "current_stage": "INIT"})
        result = sm.transition_check("proj_001", Stage.STAGE1)
        assert not result.allowed
        assert len(result.failed_checks) > 0

    def test_completed_rejects_incomplete_scenes(self, projects_dir, sm):
        _write_json(projects_dir, "proj_001", "project.json",
                    {"title": "test", "current_stage": "STAGE4"})
        _write_json(projects_dir, "proj_001", "outline.json",
                    {"chapters": [{"chapter_number": 1, "scene_plan": [{}]}]})
        _write_json(projects_dir, "proj_001", "progress.json", {
            "chapters": [{
                "chapter_number": 1,
                "scenes": [{"scene_number": 1, "status": "in_progress"}],
            }]
        })
        result = sm.transition_check("proj_001", Stage.COMPLETED)
        assert not result.allowed


class TestAdvance:
    def test_advance_updates_project_stage(self, projects_dir, sm):
        _write_json(projects_dir, "proj_001", "project.json",
                    {"title": "test", "genre": "xianxia", "current_stage": "INIT"})
        result = sm.advance("proj_001", Stage.STAGE1)
        assert result.allowed
        assert sm.get_current_stage("proj_001") == Stage.STAGE1

    def test_advance_records_stage_history(self, projects_dir, sm):
        _write_json(projects_dir, "proj_001", "project.json",
                    {"title": "test", "genre": "xianxia", "current_stage": "INIT"})
        sm.advance("proj_001", Stage.STAGE1)
        data = sm._read_json("proj_001", "project.json")
        assert "stage_history" in data
        assert len(data["stage_history"]) == 1
        assert data["stage_history"][0]["from_stage"] == "INIT"
        assert data["stage_history"][0]["to_stage"] == "STAGE1"

    def test_advance_blocked_by_preconditions(self, projects_dir, sm):
        _write_json(projects_dir, "proj_001", "project.json",
                    {"title": "", "genre": "xianxia", "current_stage": "INIT"})
        result = sm.advance("proj_001", Stage.STAGE1)
        assert not result.allowed

    def test_full_stage_progression(self, projects_dir, sm):
        pid = "proj_001"
        _write_json(projects_dir, pid, "project.json",
                    {"title": "test", "genre": "xianxia", "current_stage": "INIT"})
        assert sm.advance(pid, Stage.STAGE1).allowed

        _write_json(projects_dir, pid, "concept_and_dna.json", {
            "story_dna": {"core_contradiction": {"statement": "矛盾陈述"}},
        })
        assert sm.advance(pid, Stage.STAGE2).allowed

        _write_json(projects_dir, pid, "characters.json", {"characters": [{"name": "林峰"}]})
        _write_json(projects_dir, pid, "world.json", {"era": "玄幻"})
        assert sm.advance(pid, Stage.STAGE3).allowed

        _write_json(projects_dir, pid, "outline.json", {
            "chapters": [{"chapter_number": 1, "scene_plan": [{"scene_number": 1}]}],
        })
        assert sm.advance(pid, Stage.STAGE4).allowed

        # STAGE4 → STAGE5: all scenes completed
        _write_json(projects_dir, pid, "progress.json", {
            "chapters": [{
                "chapter_number": 1,
                "scenes": [{"scene_number": 1, "status": "completed"}],
            }],
        })
        assert sm.advance(pid, Stage.STAGE5).allowed

        # STAGE5 → STAGE6: diagnosis_report with no P0 issues
        _write_json(projects_dir, pid, "diagnosis_report.json", {
            "issues": [{"id": "i1", "severity": "P1", "status": "resolved"}],
        })
        assert sm.advance(pid, Stage.STAGE6).allowed

        # STAGE6 → COMPLETED: exports/novel.md exists
        import os
        export_dir = projects_dir / pid / "exports"
        export_dir.mkdir(parents=True, exist_ok=True)
        (export_dir / "novel.md").write_text("# Test Novel")
        assert sm.advance(pid, Stage.COMPLETED).allowed
        assert sm.get_current_stage(pid) == Stage.COMPLETED


class TestResolveNested:
    def test_nested_dict_path(self, projects_dir, sm):
        data = {"a": {"b": {"c": 42}}}
        assert sm._resolve_nested(data, "a.b.c") == 42

    def test_array_index_path(self, projects_dir, sm):
        data = {"chapters": [{"title": "Ch1"}, {"title": "Ch2"}]}
        assert sm._resolve_nested(data, "chapters[1].title") == "Ch2"

    def test_missing_key_returns_none(self, projects_dir, sm):
        data = {"a": 1}
        assert sm._resolve_nested(data, "nonexistent.key") is None
