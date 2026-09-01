"""Verify /fuse response variants[0] contains risk_level + fusion_distance."""
import json
import pytest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.creative_diverge import router as diverge_router
from backend.config import settings


@pytest.fixture
def project(tmp_path):
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_fuse_meta"
    project_dir = tmp_path / pid
    creative_os_dir = project_dir / "creative_os"
    creative_os_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": pid, "genre": "xianxia"}),
        encoding="utf-8",
    )
    creative_os_dir.joinpath("canvas_state.json").write_text(
        json.dumps({
            "schema_version": 3,
            "root_node_id": "wi_001_00",
            "nodes": {"wi_001_00": {
                "id": "wi_001_00", "depth": 0, "parent_id": None,
                "content": "测试", "novelty_score": 70,
                "trope_tags": [], "saturation_warning": False,
                "mutation_context": None, "children_ids": [],
                "is_expanded": True, "branch_status": "active",
            }},
            "edges": [], "selected_path": ["wi_001_00"],
            "branch_choices": {}, "evaluations": {},
            "created_at": "2026-08-30T10:00:00",
            "updated_at": "2026-08-30T10:00:00",
            "committed_at": None, "committed_concept_ref": None,
            "idea_variants": [], "core_contradiction": None,
            "novelty_scores": None,
            "raw_intent": {
                "prompt": "测试",
                "genre_primary": "xianxia",
                "genre_secondary": "xuanyi",
                "trope_tags": [],
            },
            "session_metadata": {
                "created_at": "2026-08-30T10:00:00",
                "last_modified_at": "2026-08-30T10:00:00",
                "elapsed_seconds": 0, "operation_count": 0,
                "ab_test_bucket": "control",
            },
        }),
        encoding="utf-8",
    )
    yield pid
    settings.projects_dir = original


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(diverge_router)
    return TestClient(app)


def test_fuse_response_variant_has_risk_metadata(project, client):
    response = client.post(
        f"/api/v1/projects/{project}/creative/diverge/fuse",
        json={"genre_primary": "xianxia", "genre_secondary": "xuanyi", "prompt": "测试"},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert "variants" in data
    assert len(data["variants"]) == 1
    variant = data["variants"][0]
    assert variant["mutation_type"] in {"fusion", "FUSION"}
    assert "risk_level" in variant, f"missing risk_level in {variant}"
    assert "fusion_distance" in variant, f"missing fusion_distance in {variant}"
    assert variant["risk_level"] in {"low", "medium", "high"}
    assert 0 <= int(variant["fusion_distance"]) <= 3


def test_fuse_distance_is_int_0_to_3(project, client):
    response = client.post(
        f"/api/v1/projects/{project}/creative/diverge/fuse",
        json={"genre_primary": "xianxia", "genre_secondary": "dushi", "prompt": "测试"},
    )
    assert response.status_code == 200
    variant = response.json()["variants"][0]
    assert isinstance(variant["fusion_distance"], int)
    assert 0 <= variant["fusion_distance"] <= 3
