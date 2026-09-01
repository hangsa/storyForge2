"""Verify /regenerate/{node_id}/regenerate on a fusion variant calls /fuse, not INVERSION fallback."""
import json
import pytest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.creative_diverge import router as diverge_router
from backend.config import settings


@pytest.fixture
def project_with_fusion_variant(tmp_path):
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_fusion_regen"
    project_dir = tmp_path / pid
    creative_os_dir = project_dir / "creative_os"
    creative_os_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": pid, "genre": "cool_novel"}), encoding="utf-8",
    )
    creative_os_dir.joinpath("canvas_state.json").write_text(
        json.dumps({
            "schema_version": 3,
            "root_node_id": "wi_001_00",
            "nodes": {"wi_001_00": {
                "id": "wi_001_00", "depth": 0, "parent_id": None, "content": "",
                "novelty_score": 0, "trope_tags": [], "saturation_warning": False,
                "mutation_context": None, "children_ids": [], "is_expanded": True,
                "branch_status": "active",
            }},
            "edges": [], "selected_path": ["wi_001_00"],
            "branch_choices": {}, "evaluations": {},
            "created_at": "2026-08-30T10:00:00",
            "updated_at": "2026-08-30T10:00:00",
            "committed_at": None, "committed_concept_ref": None,
            "idea_variants": [
                {"id": "var-existing", "mutation_type": "fusion",
                 "title": "old fusion", "premise_one_line": "old",
                 "mutation_logic": "", "estimated_novelty": 0.7,
                 "trope_tags": ["xianxia", "xuanyi"],
                 "regenerated_count": 0,
                 "risk_level": "medium", "fusion_distance": 2},
            ],
            "core_contradiction": None,
            "novelty_scores": None,
            "raw_intent": {
                "prompt": "p",
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


def test_regenerate_fusion_variant_keeps_mutation_type(project_with_fusion_variant, client):
    """Regenerating a fusion variant must NOT downgrade it to INVERSION.

    Also asserts that fusion-specific metadata (risk_level, fusion_distance)
    is recomputed via the /fuse code path — without the fusion special-case,
    the regenerate handler would call MutationEngine.mutate() with the FUSION
    op (which lacks prompt support for fusion) and synthesize a variant
    missing risk_level + fusion_distance, breaking /commit's fusion_meta.
    """
    response = client.post(
        f"/api/v1/projects/{project_with_fusion_variant}/creative/diverge/mutate/var-existing/regenerate"
    )
    assert response.status_code == 200, response.text
    variant = response.json()["variant"]
    assert variant["mutation_type"] == "fusion", \
        f"Expected fusion, got {variant['mutation_type']} — D9 regression"
    assert variant["id"] == "var-existing", "ID must be preserved"
    assert variant["regenerated_count"] == 1, "regenerated_count must increment"
    # Fusion-specific metadata must be present (recomputed via /fuse path).
    assert "risk_level" in variant, \
        "risk_level missing — regenerate did not go through /fuse path (D9)"
    assert variant["risk_level"] in {"low", "medium", "high"}
    assert "fusion_distance" in variant, \
        "fusion_distance missing — regenerate did not go through /fuse path (D9)"
    assert isinstance(variant["fusion_distance"], int)
    # trope_tags should preserve the two genre names from raw_intent.
    assert "xianxia" in variant["trope_tags"]
    assert "xuanyi" in variant["trope_tags"]


def test_regenerate_fusion_variant_with_missing_genres_preserves_mutation_type(project_with_fusion_variant, client):
    """Fusion variant + missing/empty genres in raw_intent → still 200, label preserved.

    Graceful degradation: when raw_intent lacks genre_primary or genre_secondary,
    the fusion branch can't re-run /fuse, but the variant is still labeled
    'fusion' on canvas — we don't downgrade it to inversion. regenerated_count
    bumps so the user sees a refreshed card.
    """
    canvas_path = (
        settings.projects_dir / project_with_fusion_variant
        / "creative_os" / "canvas_state.json"
    )
    canvas = json.loads(canvas_path.read_text(encoding="utf-8"))
    # Remove genre_primary and genre_secondary — degenerate raw_intent
    canvas["raw_intent"] = {"prompt": "old", "trope_tags": []}
    canvas_path.write_text(json.dumps(canvas), encoding="utf-8")

    response = client.post(
        f"/api/v1/projects/{project_with_fusion_variant}/creative/diverge/mutate/var-existing/regenerate"
    )
    assert response.status_code == 200, response.text
    variant = response.json()["variant"]
    # Graceful: still labeled 'fusion' (variant IS fusion semantically)
    assert variant["mutation_type"] == "fusion", \
        f"Fusion variant should keep its label, got {variant['mutation_type']}"
    assert variant["regenerated_count"] == 1


def test_regenerate_fusion_variant_with_identical_genres_preserves_mutation_type(tmp_path):
    """Fusion variant + genre_primary == genre_secondary → still 200, label preserved.

    Same graceful-degradation pattern: even when genres are identical (and /fuse
    would FUSION_SAME_GENRE), the variant keeps its fusion label and the count
    bumps.
    """
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    try:
        pid = "proj_identical_genres"
        project_dir = tmp_path / pid
        creative_os_dir = project_dir / "creative_os"
        creative_os_dir.mkdir(parents=True)
        project_dir.joinpath("project.json").write_text(
            json.dumps({"id": pid, "genre": "cool_novel"}), encoding="utf-8",
        )
        creative_os_dir.joinpath("canvas_state.json").write_text(
            json.dumps({
                "schema_version": 3,
                "root_node_id": "wi_001_00",
                "nodes": {"wi_001_00": {
                    "id": "wi_001_00", "depth": 0, "parent_id": None,
                    "content": "", "novelty_score": 0, "trope_tags": [],
                    "saturation_warning": False, "mutation_context": None,
                    "children_ids": [], "is_expanded": True,
                    "branch_status": "active",
                }},
                "edges": [], "selected_path": ["wi_001_00"],
                "branch_choices": {}, "evaluations": {},
                "created_at": "2026-08-30T10:00:00",
                "updated_at": "2026-08-30T10:00:00",
                "committed_at": None, "committed_concept_ref": None,
                "idea_variants": [
                    {"id": "var-fuse", "mutation_type": "fusion",
                     "title": "old", "premise_one_line": "old",
                     "mutation_logic": "", "estimated_novelty": 0.7,
                     "trope_tags": ["xianxia", "xianxia"],
                     "regenerated_count": 0,
                     "risk_level": "low", "fusion_distance": 0},
                ],
                "core_contradiction": None, "novelty_scores": None,
                "raw_intent": {
                    "prompt": "p",
                    "genre_primary": "xianxia",
                    "genre_secondary": "xianxia",  # SAME as primary
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

        app = FastAPI()
        app.include_router(diverge_router)
        c = TestClient(app)
        response = c.post(
            f"/api/v1/projects/{pid}/creative/diverge/mutate/var-fuse/regenerate"
        )
        assert response.status_code == 200, response.text
        variant = response.json()["variant"]
        # Graceful: still labeled 'fusion' (canvas says fusion)
        assert variant["mutation_type"] == "fusion", \
            f"Fusion variant should keep its label, got {variant['mutation_type']}"
        assert variant["regenerated_count"] == 1
    finally:
        settings.projects_dir = original