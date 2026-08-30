"""Tests for /contradict POST + PUT endpoints (PRD §3.2)."""
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.creative_diverge import router as diverge_router
from backend.config import settings


@pytest.fixture
def project(tmp_path):
    """Set up project with initialized canvas (v3 schema)."""
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_contradict"
    project_dir = tmp_path / pid
    creative_os_dir = project_dir / "creative_os"
    creative_os_dir.mkdir(parents=True)
    # Project root is required for _ensure_project's FileManager.project_exists check
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": pid, "genre": "cool_novel"}),
        encoding="utf-8",
    )
    creative_os_dir.joinpath("canvas_state.json").write_text(
        json.dumps({
            "schema_version": 3,
            "root_node_id": "wi_001_00",
            "nodes": {
                "wi_001_00": {
                    "id": "wi_001_00", "depth": 0, "parent_id": None,
                    "content": "测试前提", "dimension": "角色动机",
                    "novelty_score": 70, "trope_tags": [],
                    "saturation_warning": False, "mutation_context": None,
                    "children_ids": [], "is_expanded": True,
                    "branch_status": "active",
                },
            },
            "edges": [], "selected_path": ["wi_001_00"],
            "branch_choices": {}, "evaluations": {},
            "created_at": "2026-08-30T10:00:00", "updated_at": "2026-08-30T10:00:00",
            "committed_at": None, "committed_concept_ref": None,
            "idea_variants": [], "core_contradiction": None,
            "novelty_scores": None, "raw_intent": None,
            "session_metadata": {
                "created_at": "2026-08-30T10:00:00",
                "last_modified_at": "2026-08-30T10:00:00",
                "elapsed_seconds": 0, "operation_count": 0,
                "ab_test_bucket": "control",
            },
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    yield pid
    settings.projects_dir = original


@pytest.fixture
def client(project):
    app = FastAPI()
    app.include_router(diverge_router)
    return TestClient(app)


def test_post_contradict_returns_up_to_5_candidates(client, project):
    r = client.post(
        f"/api/v1/projects/{project}/creative/diverge/contradict",
        json={"variant_id": "v1", "variant_content": "主角拥有最强力量但力量同时是致命弱点"},
    )
    assert r.status_code == 200
    candidates = r.json()["candidates"]
    assert len(candidates) <= 5
    scores = [c["tension_score"] for c in candidates]
    assert scores == sorted(scores, reverse=True)


def test_post_contradict_includes_5_templates(client, project):
    r = client.post(
        f"/api/v1/projects/{project}/creative/diverge/contradict",
        json={"variant_id": "v1", "variant_content": "能力与代价"},
    )
    assert r.status_code == 200
    candidates = r.json()["candidates"]
    template_types = {c["template_type"] for c in candidates}
    # All 5 PRD templates should be in candidates
    assert "能力×限制" in template_types
    assert "永恒×消逝" in template_types
    assert "身份×秘密" in template_types
    assert "目标×代价" in template_types
    assert "力量即弱点" in template_types


def test_post_contradict_graceful_when_llm_unavailable(client, project):
    """Without LLM, expand() raises NotImplementedError — endpoint must not crash."""
    r = client.post(
        f"/api/v1/projects/{project}/creative/diverge/contradict",
        json={"variant_id": "v1", "variant_content": "any"},
    )
    assert r.status_code == 200
    candidates = r.json()["candidates"]
    # All 5 should still appear; preview fields are empty strings when LLM
    # is unavailable; tension_score is 0.
    assert len(candidates) == 5
    for c in candidates:
        assert c["preview_statement"] == ""
        assert c["side_a"] == ""
        assert c["side_b"] == ""
        assert c["tension_score"] == 0


def test_put_contradict_writes_to_canvas_state(client, project):
    r = client.put(
        f"/api/v1/projects/{project}/creative/diverge/contradict",
        json={
            "template_type": "能力×限制",
            "statement": "越强大越不能用",
            "side_a": "力量",
            "side_b": "代价",
            "is_custom": True,
        },
    )
    assert r.status_code == 200
    on_disk = json.loads(
        (settings.projects_dir / project / "creative_os" / "canvas_state.json").read_text()
    )
    assert on_disk["core_contradiction"]["template_type"] == "能力×限制"
    assert on_disk["core_contradiction"]["statement"] == "越强大越不能用"
    assert on_disk["core_contradiction"]["is_custom"] is True
    assert "tension_score" in on_disk["core_contradiction"]
    assert "confirmed_at" in on_disk["core_contradiction"]


def test_put_contradict_auto_scores_when_missing(client, project):
    r = client.put(
        f"/api/v1/projects/{project}/creative/diverge/contradict",
        json={
            "template_type": "力量即弱点",
            "statement": "越强越弱",
            "side_a": "强",
            "side_b": "弱",
        },
    )
    assert r.status_code == 200
    payload = r.json()["core_contradiction"]
    # tension_score should be auto-computed via ContradictionEngine.score_depth
    assert isinstance(payload["tension_score"], int)
    assert payload["tension_score"] >= 0
    # Statement has no depth keywords → score should be 0, but is_custom default False
    assert payload["is_custom"] is False


def test_put_contradict_rejects_uninitialized_canvas(client, tmp_path):
    """No canvas_state.json on disk → 400."""
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_no_canvas"
    project_dir = tmp_path / pid
    project_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": pid}), encoding="utf-8",
    )
    r = client.put(
        f"/api/v1/projects/{pid}/creative/diverge/contradict",
        json={
            "template_type": "力量即弱点",
            "statement": "x", "side_a": "a", "side_b": "b",
        },
    )
    assert r.status_code == 400
    body = r.json()
    assert body["detail"]["code"] == "CANVAS_NOT_INITIALIZED"
    settings.projects_dir = original
