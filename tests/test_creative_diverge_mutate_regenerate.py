"""Tests for /mutate/{node_id}/regenerate endpoint (PRD §3.3)."""
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.creative_diverge import router as diverge_router
from backend.config import settings


def _make_canvas(root_id: str = "wi_001_00") -> dict:
    """Return a minimal valid v3 canvas with a root node."""
    return {
        "schema_version": 3,
        "root_node_id": root_id,
        "nodes": {
            root_id: {
                "id": root_id,
                "depth": 0,
                "parent_id": None,
                "content": "root",
                "novelty_score": 0,
                "trope_tags": [],
                "saturation_warning": False,
                "mutation_context": None,
                "children_ids": [],
                "is_expanded": False,
                "branch_status": "active",
            },
        },
        "edges": [],
        "selected_path": [root_id],
        "branch_choices": {},
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
def project_with_variants(tmp_path):
    """Project with v3 canvas containing one idea_variant + valid root node."""
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_regen"
    project_dir = tmp_path / pid
    creative_os_dir = project_dir / "creative_os"
    creative_os_dir.mkdir(parents=True)

    canvas = _make_canvas()
    canvas["idea_variants"] = [
        {
            "id": "variant-1",
            "title": "原变体",
            "premise_one_line": "test premise",
            "mutation_type": "inversion",
            "mutation_logic": "original logic",
            "estimated_novelty": 0.5,
            "trope_tags": [],
            "regenerated_count": 0,
        },
    ]
    creative_os_dir.joinpath("canvas_state.json").write_text(
        json.dumps(canvas, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    yield pid
    settings.projects_dir = original


@pytest.fixture
def client(project_with_variants):
    app = FastAPI()
    app.include_router(diverge_router)
    return TestClient(app)


def test_regenerate_increments_count_and_preserves_id(client, project_with_variants):
    r = client.post(
        f"/api/v1/projects/{project_with_variants}/creative/diverge/mutate/variant-1/regenerate"
    )
    assert r.status_code == 200, r.text
    variant = r.json()["variant"]
    assert variant["id"] == "variant-1"
    assert variant["regenerated_count"] == 1


def test_regenerate_persists_to_canvas(client, project_with_variants):
    r = client.post(
        f"/api/v1/projects/{project_with_variants}/creative/diverge/mutate/variant-1/regenerate"
    )
    assert r.status_code == 200, r.text
    on_disk = json.loads(
        (settings.projects_dir / project_with_variants / "creative_os" / "canvas_state.json").read_text()
    )
    persisted = next(v for v in on_disk["idea_variants"] if v["id"] == "variant-1")
    assert persisted["regenerated_count"] == 1


def test_regenerate_unknown_variant_returns_400(client, project_with_variants):
    r = client.post(
        f"/api/v1/projects/{project_with_variants}/creative/diverge/mutate/variant-nonexistent/regenerate"
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "INVALID_NODE_ID"


def test_regenerate_uninitialized_canvas_returns_400(client, tmp_path):
    """When no canvas_state.json exists, endpoint should 400 with CANVAS_NOT_INITIALIZED."""
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_no_canvas"
    (tmp_path / pid).mkdir()
    try:
        r = client.post(
            f"/api/v1/projects/{pid}/creative/diverge/mutate/variant-1/regenerate"
        )
        assert r.status_code == 400
        assert r.json()["detail"]["code"] == "CANVAS_NOT_INITIALIZED"
    finally:
        settings.projects_dir = original


def test_regenerate_handles_unknown_mutation_type(tmp_path):
    """If variant has a mutation_type not in the enum (e.g., 'custom'),
    endpoint should still work by falling back to INVERSION.
    """
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_unknown_mutation"
    project_dir = tmp_path / pid
    creative_os_dir = project_dir / "creative_os"
    creative_os_dir.mkdir(parents=True)

    canvas = _make_canvas()
    canvas["idea_variants"] = [
        {
            "id": "variant-custom",
            "title": "custom var",
            "premise_one_line": "x",
            "mutation_type": "custom",  # not in MutationOp enum
            "mutation_logic": "x",
            "estimated_novelty": 0.5,
            "trope_tags": [],
            "regenerated_count": 0,
        },
    ]
    creative_os_dir.joinpath("canvas_state.json").write_text(
        json.dumps(canvas, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    app = FastAPI()
    app.include_router(diverge_router)
    client = TestClient(app)
    try:
        r = client.post(
            f"/api/v1/projects/{pid}/creative/diverge/mutate/variant-custom/regenerate"
        )
        assert r.status_code == 200, r.text
        variant = r.json()["variant"]
        assert variant["id"] == "variant-custom"
        assert variant["regenerated_count"] == 1
    finally:
        settings.projects_dir = original


def test_regenerate_preserves_other_variants(client, project_with_variants):
    """Regenerating one variant must not lose the others."""
    # Add a second variant to the canvas
    on_disk_path = settings.projects_dir / project_with_variants / "creative_os" / "canvas_state.json"
    canvas = json.loads(on_disk_path.read_text(encoding="utf-8"))
    canvas["idea_variants"].append({
        "id": "variant-2",
        "title": "second",
        "premise_one_line": "p2",
        "mutation_type": "escalation",
        "mutation_logic": "l2",
        "estimated_novelty": 0.6,
        "trope_tags": [],
        "regenerated_count": 0,
    })
    on_disk_path.write_text(
        json.dumps(canvas, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    r = client.post(
        f"/api/v1/projects/{project_with_variants}/creative/diverge/mutate/variant-1/regenerate"
    )
    assert r.status_code == 200, r.text
    on_disk = json.loads(on_disk_path.read_text(encoding="utf-8"))
    ids = [v["id"] for v in on_disk["idea_variants"]]
    assert ids == ["variant-2", "variant-1"] or set(ids) == {"variant-1", "variant-2"}
    # The other variant is unchanged
    other = next(v for v in on_disk["idea_variants"] if v["id"] == "variant-2")
    assert other["regenerated_count"] == 0
    # The regenerated one has count 1
    regen = next(v for v in on_disk["idea_variants"] if v["id"] == "variant-1")
    assert regen["regenerated_count"] == 1
