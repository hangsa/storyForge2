"""Tests for /novelty GET endpoint — list-level 4-dim novelty score (PRD §3.5)."""

import json
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.config import settings
from backend.api.creative_diverge import router as diverge_router


def _make_canvas_v3(pid_root: str, pid_child: str) -> dict:
    """Return a v3 canvas with a selected_path of two nodes."""
    return {
        "schema_version": 3,
        "root_node_id": pid_root,
        "nodes": {
            pid_root: {
                "id": pid_root,
                "depth": 0,
                "parent_id": None,
                "content": "root premise 主角觉醒力量",
                "trope_tags": ["修仙"],
                "saturation_warning": False,
                "novelty_score": None,
                "mutation_context": None,
                "children_ids": [pid_child],
                "is_expanded": True,
                "branch_status": "active",
            },
            pid_child: {
                "id": pid_child,
                "depth": 1,
                "parent_id": pid_root,
                "content": "child premise 道德困境的考验",
                "trope_tags": ["修仙"],
                "saturation_warning": False,
                "novelty_score": None,
                "mutation_context": None,
                "children_ids": [],
                "is_expanded": False,
                "branch_status": "active",
            },
        },
        "edges": [],
        "selected_path": [pid_root, pid_child],
        # Invariant 1: every expanded active node needs a branch_choices entry
        "branch_choices": {pid_root: pid_child},
        "evaluations": {},
        "created_at": "2026-08-30T10:00:00",
        "updated_at": "2026-08-30T10:00:00",
        "committed_at": None,
        "committed_concept_ref": None,
        "idea_variants": [],
        "core_contradiction": None,
        "novelty_scores": None,
        "raw_intent": None,
        "session_metadata": {
            "created_at": "2026-08-30T10:00:00",
            "last_modified_at": "2026-08-30T10:00:00",
            "elapsed_seconds": 0,
            "operation_count": 0,
            "ab_test_bucket": "control",
        },
    }


@pytest.fixture
def project(tmp_path):
    """Project with v3 canvas containing a selected_path."""
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_novelty"
    project_dir = tmp_path / pid
    creative_os_dir = project_dir / "creative_os"
    creative_os_dir.mkdir(parents=True)
    # _ensure_project looks for project.json via FileManager.project_exists
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": pid, "name": "novelty test"}, ensure_ascii=False),
        encoding="utf-8",
    )
    canvas = _make_canvas_v3("wi_001_00", "wi_001_01")
    creative_os_dir.joinpath("canvas_state.json").write_text(
        json.dumps(canvas, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    yield pid
    settings.projects_dir = original


@pytest.fixture
def client(project):
    app = FastAPI()
    app.include_router(diverge_router)
    return TestClient(app)


def test_get_novelty_returns_4_dims_and_composite(client, project):
    r = client.get(f"/api/v1/projects/{project}/creative/diverge/novelty")
    assert r.status_code == 200
    data = r.json()
    # Verify all 4 dims + composite + grade + extraction status + computed_at
    for key in [
        "market_saturation",
        "trope_similarity",
        "contradiction_depth",
        "discussion_potential",
        "composite",
        "grade",
        "trope_extraction_status",
        "computed_at",
    ]:
        assert key in data, f"missing key {key}"
    # Scores are 0-100
    for key in [
        "market_saturation",
        "trope_similarity",
        "contradiction_depth",
        "discussion_potential",
        "composite",
    ]:
        val = data[key]
        assert isinstance(val, (int, float)), f"{key} should be number, got {type(val)}"
        assert 0 <= val <= 100, f"{key} should be 0-100, got {val}"
    # Grade is one of the known strings
    assert data["grade"] in {"高新颖度", "中等", "偏低", "低"}


def test_get_novelty_persists_to_canvas_state(client, project):
    r = client.get(f"/api/v1/projects/{project}/creative/diverge/novelty")
    assert r.status_code == 200
    on_disk = json.loads(
        (settings.projects_dir / project / "creative_os" / "canvas_state.json").read_text(
            encoding="utf-8"
        )
    )
    assert on_disk["novelty_scores"] is not None
    assert "computed_at" in on_disk["novelty_scores"]
    assert "composite" in on_disk["novelty_scores"]


def test_get_novelty_uninitialized_canvas_returns_400(client, tmp_path):
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_novelty_no_canvas"
    project_dir = tmp_path / pid
    project_dir.mkdir()
    # _ensure_project looks for project.json
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": pid, "name": "novelty no canvas test"}, ensure_ascii=False),
        encoding="utf-8",
    )
    try:
        r = client.get(f"/api/v1/projects/{pid}/creative/diverge/novelty")
        assert r.status_code == 400
        assert r.json()["detail"]["code"] == "CANVAS_NOT_INITIALIZED"
    finally:
        settings.projects_dir = original


def test_get_novelty_fallback_returns_neutral_50_scores(client, project, monkeypatch):
    """When NoveltyEvaluator raises, all 4 dims + composite should be the
    neutral midpoint (50.0) — not the previous inconsistent 0/0/50/50 mix.
    """
    # Force the inner evaluate() to raise
    from backend.creative_os import novelty_evaluator
    original_init = novelty_evaluator.NoveltyEvaluator.__init__

    def boom(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        raise RuntimeError("forced failure for test")

    monkeypatch.setattr(novelty_evaluator.NoveltyEvaluator, "__init__", boom)
    r = client.get(f"/api/v1/projects/{project}/creative/diverge/novelty")
    assert r.status_code == 200
    data = r.json()
    assert data["market_saturation"] == 50.0
    assert data["trope_similarity"] == 50.0
    assert data["contradiction_depth"] == 50.0
    assert data["discussion_potential"] == 50.0
    assert data["composite"] == 50.0
