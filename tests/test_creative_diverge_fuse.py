"""Tests for /fuse endpoint (PRD §3.4 — S0-B 跨体裁融合)."""
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
    pid = "proj_fuse"
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
                    "content": "测试前提",
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
            "novelty_scores": None,
            "raw_intent": {
                "prompt": "测试",
                "genre_primary": "修仙",
                "genre_secondary": "法庭推理",
                "trope_tags": [],
            },
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


def test_fuse_same_genre_returns_400(client, project):
    """Same primary/secondary genre → 400 FUSION_SAME_GENRE (per Task 3 contract)."""
    r = client.post(
        f"/api/v1/projects/{project}/creative/diverge/fuse",
        json={"genre_primary": "修仙", "genre_secondary": "修仙", "prompt": "test"},
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "FUSION_SAME_GENRE"


def test_fuse_distinct_genres_returns_valid_response(client, project):
    """Distinct genres return a valid response with one variant and a risk level."""
    r = client.post(
        f"/api/v1/projects/{project}/creative/diverge/fuse",
        json={"genre_primary": "修仙", "genre_secondary": "法庭推理", "prompt": "test"},
    )
    assert r.status_code == 200
    data = r.json()
    assert "variants" in data
    assert len(data["variants"]) == 1
    assert "fusion_distance" in data
    assert "compatibility" in data["fusion_distance"]
    # Compatibility is one of the 3 high/medium/low buckets from GenreFusionEngine
    assert data["fusion_distance"]["compatibility"] in {"高", "中", "低"}
    assert data["risk_level"] in {"low", "medium", "high"}


def test_fuse_persists_to_canvas(client, project):
    """The fused variant is appended to canvas_state.idea_variants."""
    r = client.post(
        f"/api/v1/projects/{project}/creative/diverge/fuse",
        json={"genre_primary": "修仙", "genre_secondary": "法庭推理", "prompt": "test"},
    )
    assert r.status_code == 200
    on_disk = json.loads(
        (settings.projects_dir / project / "creative_os" / "canvas_state.json").read_text()
    )
    assert len(on_disk["idea_variants"]) == 1
    variant = on_disk["idea_variants"][0]
    # When MutationEngine.fuse is unavailable (no router), mutation_type falls
    # back to "fusion" via the synthesized variant path.
    assert variant["mutation_type"] in {"fusion", "FUSION"}
    # The two genre tags should be preserved.
    assert "修仙" in variant["trope_tags"]
    assert "法庭推理" in variant["trope_tags"]


def test_fuse_graceful_when_llm_unavailable(client, project):
    """When MutationEngine.fuse raises (no router), endpoint synthesizes a
    minimal variant from genres + distance instead of crashing.
    """
    r = client.post(
        f"/api/v1/projects/{project}/creative/diverge/fuse",
        json={"genre_primary": "修仙", "genre_secondary": "未知体裁", "prompt": "test"},
    )
    assert r.status_code == 200
    data = r.json()
    # Should still get exactly one variant (either real or synthesized).
    assert len(data["variants"]) == 1
    variant = data["variants"][0]
    # Synthesized variant has a non-empty premise_one_line that names both genres.
    assert variant["premise_one_line"]
    # mutation_type is always "fusion" (synthesized path) — or the FUSION enum
    # value if the LLM path succeeded.
    assert variant["mutation_type"] in {"fusion", "FUSION"}


def test_fuse_on_fresh_project_returns_400_canvas_not_initialized(tmp_path):
    """Verify /fuse returns 400 CANVAS_NOT_INITIALIZED when no canvas exists.

    Task 3 contract: /fuse no longer seeds a fresh canvas — callers must
    run /init first (the /fuse contract now mirrors other canvas endpoints
    like /apply-mutation).
    """
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from backend.api.creative_diverge import router as diverge_router

    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_fuse_fresh"
    project_dir = tmp_path / pid
    project_dir.mkdir()
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": pid, "genre": "cool_novel"}),
        encoding="utf-8",
    )
    app = FastAPI()
    app.include_router(diverge_router)
    client = TestClient(app)
    try:
        r = client.post(
            f"/api/v1/projects/{pid}/creative/diverge/fuse",
            json={"genre_primary": "修仙", "genre_secondary": "法庭推理", "prompt": "test"},
        )
        assert r.status_code == 400, r.text
        assert r.json()["detail"]["code"] == "CANVAS_NOT_INITIALIZED"
        # No canvas should have been written either.
        assert not (settings.projects_dir / pid / "creative_os" / "canvas_state.json").exists()
    finally:
        settings.projects_dir = original
