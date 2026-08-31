"""Tests for Task 13 — /commit dual-write + 4-layer value_stack + style_template.

Covers:
- concept_and_dna.json carries 4-layer value_stack + style_template
- creative_divergence.json dual-written (compat with STAGE1 /concept guard)
- Response detail carries novelty_summary / next_step_url / warnings / previews
- Optional body overrides: confirmed_path_ids, value_stack_override
- No-body backwards compat (legacy callers)
- Low-novelty advisory surfaces as warning, never blocks
"""
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def temp_dir():
    d = Path("/tmp/pytest_commit_dual_write")
    if d.exists():
        import shutil
        shutil.rmtree(d)
    d.mkdir(parents=True)
    yield d
    import shutil
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def client(temp_dir):
    from backend.config import settings
    original = settings.projects_dir
    settings.projects_dir = temp_dir

    project_dir = temp_dir / "proj_commit_dual"
    project_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": "proj_commit_dual", "genre": "cool_novel"}),
        encoding="utf-8",
    )
    creative_os_dir = project_dir / "creative_os"
    creative_os_dir.mkdir(parents=True)

    from backend.api.creative_diverge import router
    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    yield client, project_dir
    settings.projects_dir = original


def _seed_canvas(project_dir: Path, *, novelty_scores=None,
                 raw_intent_prompt: str = "修仙少年觉醒") -> None:
    nodes = {
        "node-root": {
            "id": "node-root", "depth": 0, "parent_id": None,
            "content": "根节点前提：修仙少年觉醒力量",
            "novelty_score": 70, "trope_tags": ["修仙"],
            "is_expanded": True, "children_ids": ["node-1"],
            "branch_status": "active", "saturation_warning": False,
            "mutation_context": None,
        },
        "node-1": {
            "id": "node-1", "depth": 1, "parent_id": "node-root",
            "content": "子节点前提：道德困境的考验",
            "novelty_score": 65, "trope_tags": ["修仙"],
            "is_expanded": False, "children_ids": [],
            "branch_status": "active", "saturation_warning": False,
            "mutation_context": None,
        },
    }
    state = {
        "schema_version": 3,
        "root_node_id": "node-root",
        "nodes": nodes,
        "edges": [],
        "selected_path": ["node-root", "node-1"],
        "branch_choices": {"node-root": "node-1"},
        "evaluations": {},
        "novelty_scores": novelty_scores,
        "raw_intent": {"prompt": raw_intent_prompt, "genre_primary": "修仙"},
    }
    (project_dir / "creative_os" / "canvas_state.json").write_text(
        json.dumps(state, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _llm_mock(value_stack=None, style_template="白描克制") -> MagicMock:
    """Return a PlannerAgent mock whose generate_concept_from_canvas yields
    a 4-layer value_stack + style_template by default.
    """
    mock_instance = MagicMock()
    mock_instance.generate_concept_from_canvas = AsyncMock(return_value=(
        {
            "concept": {
                "title": "测试标题",
                "genre": "cool_novel",
                "premise": "一句话前提",
                "tone": "热血",
                "theme": "成长",
                "target_audience": "大众",
            },
            "story_dna": {
                "core_contradiction": {
                    "statement": "核心矛盾陈述",
                    "side_a": "立场A",
                    "side_b": "立场B",
                },
                "value_stack": value_stack if value_stack is not None else [
                    {"value_a": "自由", "value_b": "责任", "level": "personal"},
                    {"value_a": "个人", "value_b": "体制", "level": "social"},
                    {"value_a": "相对", "value_b": "绝对", "level": "philosophical"},
                    {"value_a": "意义", "value_b": "虚无", "level": "existential"},
                ],
                "style_template": style_template,
            },
        },
        MagicMock(),
    ))
    return mock_instance


class TestCommitDualWrite:

    def test_commit_writes_concept_and_dna_with_canvas_source(self, client):
        c, project_dir = client
        _seed_canvas(project_dir)
        with patch("backend.agents.planner.PlannerAgent") as mock_agent_cls:
            mock_agent_cls.return_value = _llm_mock()
            response = c.post(
                "/api/v1/projects/proj_commit_dual/creative/diverge/commit"
            )
        assert response.status_code == 200, response.text
        cd_path = project_dir / "concept_and_dna.json"
        assert cd_path.exists()
        data = json.loads(cd_path.read_text(encoding="utf-8"))
        assert data["source"] == "canvas"
        assert "style_template" in data["story_dna"]
        assert len(data["story_dna"]["value_stack"]) == 4
        assert {vs["level"] for vs in data["story_dna"]["value_stack"]} == {
            "personal", "social", "philosophical", "existential"
        }

    def test_commit_writes_creative_divergence_json_compat(self, client):
        c, project_dir = client
        _seed_canvas(project_dir, raw_intent_prompt="修仙少年觉醒对抗命运")
        with patch("backend.agents.planner.PlannerAgent") as mock_agent_cls:
            mock_agent_cls.return_value = _llm_mock()
            response = c.post(
                "/api/v1/projects/proj_commit_dual/creative/diverge/commit"
            )
        assert response.status_code == 200, response.text
        # creative_divergence.json is the STAGE1 /concept guard compat file
        cd_div_path = project_dir / "creative_divergence.json"
        assert cd_div_path.exists(), "creative_divergence.json should be dual-written"
        cd_div = json.loads(cd_div_path.read_text(encoding="utf-8"))
        assert cd_div["source"] == "canvas"
        assert cd_div["prompt"] == "修仙少年觉醒对抗命运"
        assert cd_div["selected_id"] is None
        assert cd_div["variants"] == []
        assert "selected_at" in cd_div

    def test_commit_truncates_long_raw_intent_prompt_to_1700(self, client):
        c, project_dir = client
        long_prompt = "x" * 5_000
        _seed_canvas(project_dir, raw_intent_prompt=long_prompt)
        with patch("backend.agents.planner.PlannerAgent") as mock_agent_cls:
            mock_agent_cls.return_value = _llm_mock()
            response = c.post(
                "/api/v1/projects/proj_commit_dual/creative/diverge/commit"
            )
        assert response.status_code == 200
        cd_div = json.loads(
            (project_dir / "creative_divergence.json").read_text(encoding="utf-8")
        )
        assert len(cd_div["prompt"]) == 1700
        assert cd_div["prompt"] == "x" * 1700

    def test_commit_response_includes_novelty_summary_and_next_step_url(self, client):
        c, project_dir = client
        novelty = {
            "market_saturation": 30.0,
            "trope_similarity": 50.0,
            "contradiction_depth": 60.0,
            "discussion_potential": 70.0,
            "composite": 52.5,
            "grade": "中等",
            "computed_at": "2026-08-30T10:00:00",
        }
        _seed_canvas(project_dir, novelty_scores=novelty)
        with patch("backend.agents.planner.PlannerAgent") as mock_agent_cls:
            mock_agent_cls.return_value = _llm_mock()
            response = c.post(
                "/api/v1/projects/proj_commit_dual/creative/diverge/commit"
            )
        body = response.json()
        assert body["error"] is False
        detail = body["detail"]
        # Existing fields preserved
        assert "concept" in detail
        assert "story_dna" in detail
        assert detail["source"] == "canvas"
        assert "committed_at" in detail
        # New additive fields
        assert detail["concept_preview"] == detail["concept"]
        assert detail["story_dna_preview"] == detail["story_dna"]
        assert detail["novelty_summary"] == novelty
        assert detail["next_step_url"] == "/project/proj_commit_dual/wizard?step=2"
        assert detail["warnings"] == []  # composite > 0.4 → no warning

    def test_commit_with_value_stack_override(self, client):
        c, project_dir = client
        _seed_canvas(project_dir)
        custom_stack = [
            {"value_a": "X", "value_b": "Y", "level": "personal"},
            {"value_a": "X", "value_b": "Y", "level": "social"},
            {"value_a": "X", "value_b": "Y", "level": "philosophical"},
            {"value_a": "X", "value_b": "Y", "level": "existential"},
        ]
        with patch("backend.agents.planner.PlannerAgent") as mock_agent_cls:
            mock_agent_cls.return_value = _llm_mock()
            response = c.post(
                "/api/v1/projects/proj_commit_dual/creative/diverge/commit",
                json={"value_stack_override": custom_stack},
            )
        assert response.status_code == 200, response.text
        data = json.loads(
            (project_dir / "concept_and_dna.json").read_text(encoding="utf-8")
        )
        assert data["story_dna"]["value_stack"] == custom_stack
        # Response should also reflect the override
        detail = response.json()["detail"]
        assert detail["story_dna"]["value_stack"] == custom_stack
        assert detail["story_dna_preview"]["value_stack"] == custom_stack

    def test_commit_with_confirmed_path_ids_override(self, client):
        c, project_dir = client
        # Seed initial canvas first (so the file exists)
        _seed_canvas(project_dir)
        # Add a third sibling node so the override is distinguishable
        canvas_path = project_dir / "creative_os" / "canvas_state.json"
        canvas = json.loads(canvas_path.read_text(encoding="utf-8"))
        canvas["nodes"]["node-2"] = {
            "id": "node-2", "depth": 1, "parent_id": "node-root",
            "content": "子节点备选分支：复仇之路",
            "novelty_score": 80, "trope_tags": ["修仙"],
            "is_expanded": False, "children_ids": [],
            "branch_status": "active", "saturation_warning": False,
            "mutation_context": None,
        }
        # node-root must list both children to satisfy invariant 4
        canvas["nodes"]["node-root"]["children_ids"] = ["node-1", "node-2"]
        canvas["branch_choices"]["node-root"] = "node-2"
        canvas_path.write_text(
            json.dumps(canvas, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        with patch("backend.agents.planner.PlannerAgent") as mock_agent_cls:
            mock_agent_cls.return_value = _llm_mock()
            # Override selected_path to use node-2 instead of node-1
            response = c.post(
                "/api/v1/projects/proj_commit_dual/creative/diverge/commit",
                json={"confirmed_path_ids": ["node-root", "node-2"]},
            )
        assert response.status_code == 200, response.text
        data = json.loads(
            (project_dir / "concept_and_dna.json").read_text(encoding="utf-8")
        )
        # The snapshot reflects the override path, not the canvas default
        assert data["canvas_snapshot"]["selected_path"] == ["node-root", "node-2"]

    def test_commit_without_body_still_works(self, client):
        """Legacy no-body callers must keep working — defaults to canvas's
        selected_path. The new optional body is additive.
        """
        c, project_dir = client
        _seed_canvas(project_dir)
        with patch("backend.agents.planner.PlannerAgent") as mock_agent_cls:
            mock_agent_cls.return_value = _llm_mock()
            # Empty JSON body (no fields)
            response = c.post(
                "/api/v1/projects/proj_commit_dual/creative/diverge/commit",
                json={},
            )
        assert response.status_code == 200, response.text
        data = json.loads(
            (project_dir / "concept_and_dna.json").read_text(encoding="utf-8")
        )
        # Falls back to canvas.selected_path
        assert data["canvas_snapshot"]["selected_path"] == ["node-root", "node-1"]

    def test_commit_warnings_appear_for_low_novelty(self, client):
        c, project_dir = client
        novelty = {
            "market_saturation": 10.0,
            "trope_similarity": 20.0,
            "contradiction_depth": 30.0,
            "discussion_potential": 25.0,
            "composite": 0.1,  # < 0.4 → warning
            "grade": "低",
            "computed_at": "2026-08-30T10:00:00",
        }
        _seed_canvas(project_dir, novelty_scores=novelty)
        with patch("backend.agents.planner.PlannerAgent") as mock_agent_cls:
            mock_agent_cls.return_value = _llm_mock()
            response = c.post(
                "/api/v1/projects/proj_commit_dual/creative/diverge/commit"
            )
        # Submission still succeeds — D-2 warn-don't-block
        assert response.status_code == 200
        detail = response.json()["detail"]
        assert len(detail["warnings"]) >= 1
        assert any("novelty_below_threshold" in w for w in detail["warnings"])

    def test_commit_no_warnings_when_novelty_absent(self, client):
        """When canvas has no novelty_scores (user skipped /novelty),
        warnings stay empty — we don't fabricate scores.
        """
        c, project_dir = client
        _seed_canvas(project_dir, novelty_scores=None)
        with patch("backend.agents.planner.PlannerAgent") as mock_agent_cls:
            mock_agent_cls.return_value = _llm_mock()
            response = c.post(
                "/api/v1/projects/proj_commit_dual/creative/diverge/commit"
            )
        assert response.status_code == 200
        detail = response.json()["detail"]
        assert detail["novelty_summary"] == {}
        assert detail["warnings"] == []