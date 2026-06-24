"""Tests for mutation_context being stamped onto WhatIfNodes by /apply-mutation.

Also covers the side effect: any write to canvas_state.json (other than
/commit itself) clears the committed_at marker.
"""
import json
from pathlib import Path
from unittest.mock import MagicMock, AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(temp_dir):
    from backend.config import settings
    original = settings.projects_dir
    settings.projects_dir = temp_dir

    project_dir = temp_dir / "test_project"
    project_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({
            "id": "test_project",
            "initial_intent": {"free_text": "测试"},
            "genre": "cool_novel",
        }),
        encoding="utf-8",
    )
    creative_os_dir = project_dir / "creative_os"
    creative_os_dir.mkdir(parents=True)
    creative_os_dir.joinpath("canvas_state.json").write_text(
        json.dumps({
            "schema_version": 2,
            "root_node_id": "wi_root",
            "nodes": {
                "wi_root": {
                    "id": "wi_root", "depth": 0, "parent_id": None,
                    "content": "root", "novelty_score": 50, "trope_tags": [],
                    "children_ids": ["wi_child"], "is_expanded": True,
                    "branch_status": "active", "mutation_context": None,
                },
                "wi_child": {
                    "id": "wi_child", "depth": 1, "parent_id": "wi_root",
                    "content": "child", "novelty_score": 60, "trope_tags": [],
                    "children_ids": [], "is_expanded": False,
                    "branch_status": "active", "mutation_context": None,
                },
            },
            "edges": [{"from": "wi_root", "to": "wi_child"}],
            "selected_path": ["wi_root", "wi_child"],
            "branch_choices": {"wi_root": "wi_child"},
            "evaluations": {},
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    from backend.api.creative_canvas import router
    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    yield client, project_dir
    settings.projects_dir = original


class TestMutationContextStamped:
    def test_apply_mutation_writes_mutation_context_to_new_node(self, client):
        c, project_dir = client

        from backend.creative_os.mutation_engine import MutationResult
        from backend.models.creative_os import MutationOp
        mr = MutationResult(
            operation=MutationOp.INVERSION,
            source_trope_id="synthetic_wi_child",
            source_trope_name="t",
            core_premise="inverted premise",
            core_conflict="inverted conflict",
            novelty_hook="hook",
            self_consistency_check="checks out",
        )
        with patch("backend.creative_os.mutation_engine.MutationEngine") as mock_engine_cls:
            mock_instance = MagicMock()
            mock_instance.mutate = AsyncMock(return_value=mr)
            mock_engine_cls.return_value = mock_instance
            response = c.post(
                "/api/v1/projects/test_project/creative/canvas/apply-mutation",
                json={"node_id": "wi_child", "operation": "inversion"},
            )
        assert response.status_code == 200

        canvas = json.loads(
            (project_dir / "creative_os" / "canvas_state.json").read_text(encoding="utf-8")
        )
        new_nodes = [n for nid, n in canvas["nodes"].items() if nid.startswith("mu_")]
        assert len(new_nodes) == 1
        new_node = new_nodes[0]
        assert new_node["mutation_context"] is not None
        ctx = new_node["mutation_context"]
        assert ctx["operation"] == "inversion"
        assert ctx["core_premise"] == "inverted premise"
        assert ctx["core_conflict"] == "inverted conflict"
        assert ctx["novelty_hook"] == "hook"
        assert ctx["self_consistency_check"] == "checks out"


class TestCommittedMarkerLifecycle:
    def test_subsequent_write_clears_committed_at(self, client):
        """After /commit stamps committed_at, any other write should clear it.

        Regression guard: if /expand or /choose-branch forgets to clear, the
        '已提交' chip on the frontend will lie to the user.
        """
        c, project_dir = client

        # Manually set committed_at to simulate a prior /commit
        canvas_path = project_dir / "creative_os" / "canvas_state.json"
        canvas = json.loads(canvas_path.read_text(encoding="utf-8"))
        canvas["committed_at"] = "2026-06-24T00:00:00"
        canvas["committed_concept_ref"] = "concept_and_dna.json"
        canvas_path.write_text(json.dumps(canvas, ensure_ascii=False, indent=2),
                               encoding="utf-8")

        # Use /choose-branch to trigger a write that should clear the marker
        # Note: in this test fixture, branch_choices already has wi_root → wi_child,
        # and wi_child is the only child, so choose-branch to a different child
        # would fail. Easiest: trigger a write via /select with the same path.
        response = c.post(
            "/api/v1/projects/test_project/creative/canvas/select",
            json={"path_node_ids": ["wi_root", "wi_child"]},
        )
        assert response.status_code == 200

        canvas = json.loads(canvas_path.read_text(encoding="utf-8"))
        assert "committed_at" not in canvas, (
            "/select should have cleared the committed_at marker"
        )
        assert "committed_concept_ref" not in canvas

    def test_commit_preserves_committed_at_on_its_own_write(self, client):
        """The /commit endpoint itself writes canvas_state.json with the marker
        set; the write must not then immediately pop it back off.
        """
        c, project_dir = client
        # Pre-seed with selected_path length 2 (already done in fixture)
        with patch("backend.agents.planner.PlannerAgent") as mock_agent_cls:
            mock_instance = MagicMock()
            mock_instance.generate_concept_from_canvas = AsyncMock(return_value=(
                {
                    "concept": {"title": "T", "premise": "P", "genre": "cool_novel",
                                "tone": "t", "theme": "th", "target_audience": "ta"},
                    "story_dna": {"core_contradiction": {"statement": "X",
                                                          "side_a": "a", "side_b": "b"},
                                  "value_stack": []},
                },
                MagicMock(),
            ))
            mock_agent_cls.return_value = mock_instance
            response = c.post(
                "/api/v1/projects/test_project/creative/canvas/commit",
            )
        assert response.status_code == 200

        canvas = json.loads(
            (project_dir / "creative_os" / "canvas_state.json").read_text(encoding="utf-8")
        )
        assert "committed_at" in canvas
        assert canvas["committed_concept_ref"] == "concept_and_dna.json"
