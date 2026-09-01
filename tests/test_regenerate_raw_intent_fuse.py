"""Verify /regenerate/raw-intent re-runs /fuse when raw_intent.genre_secondary exists."""
import json
import pytest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.creative_diverge import router as diverge_router
from backend.config import settings


@pytest.fixture
def project_with_intent_and_no_fusion(tmp_path):
    """Canvas where raw_intent has genre_secondary but no fusion variant exists."""
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_regen_raw_intent_fuse"
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
                "id": "wi_001_00", "depth": 0, "parent_id": None, "content": "p",
                "novelty_score": 0, "trope_tags": [], "saturation_warning": False,
                "mutation_context": None, "children_ids": [], "is_expanded": True,
                "branch_status": "active",
            }},
            "edges": [], "selected_path": ["wi_001_00"],
            "branch_choices": {}, "evaluations": {},
            "created_at": "2026-08-30T10:00:00",
            "updated_at": "2026-08-30T10:00:00",
            "committed_at": None, "committed_concept_ref": None,
            "idea_variants": [],   # starting empty; regen should add mutation + fusion
            "core_contradiction": None,
            "novelty_scores": None,
            "raw_intent": {
                "prompt": "长生者寻死",
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


def test_regenerate_raw_intent_appends_fusion_variant_when_secondary_exists(
    project_with_intent_and_no_fusion, client
):
    response = client.post(
        f"/api/v1/projects/{project_with_intent_and_no_fusion}/creative/diverge/regenerate/raw-intent",
        json={"user_modifications": ""},
    )
    assert response.status_code == 200, response.text

    canvas_path = (
        settings.projects_dir / project_with_intent_and_no_fusion
        / "creative_os" / "canvas_state.json"
    )
    canvas = json.loads(canvas_path.read_text(encoding="utf-8"))
    variants = canvas.get("idea_variants", [])
    fusion_variants = [v for v in variants if v.get("mutation_type") == "fusion"]
    assert len(fusion_variants) == 1, \
        f"Expected exactly 1 fusion variant after regen, got {len(fusion_variants)}"
    assert fusion_variants[0]["risk_level"] in {"low", "medium", "high"}
    assert 0 <= int(fusion_variants[0]["fusion_distance"]) <= 3


def test_regenerate_raw_intent_skips_fusion_when_secondary_absent(tmp_path):
    """Without genre_secondary, only the 3-op mutation chain runs — no fusion variant."""
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    try:
        pid = "proj_no_secondary"
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
                    "content": "p", "novelty_score": 0, "trope_tags": [],
                    "saturation_warning": False, "mutation_context": None,
                    "children_ids": [], "is_expanded": True,
                    "branch_status": "active",
                }},
                "edges": [], "selected_path": ["wi_001_00"],
                "branch_choices": {}, "evaluations": {},
                "created_at": "2026-08-30T10:00:00",
                "updated_at": "2026-08-30T10:00:00",
                "committed_at": None, "committed_concept_ref": None,
                "idea_variants": [],
                "core_contradiction": None,
                "novelty_scores": None,
                "raw_intent": {
                    "prompt": "p",
                    "genre_primary": "xianxia",
                    # NO genre_secondary
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
            f"/api/v1/projects/{pid}/creative/diverge/regenerate/raw-intent",
            json={"user_modifications": ""},
        )
        assert response.status_code == 200, response.text

        canvas_path = (
            settings.projects_dir / pid / "creative_os" / "canvas_state.json"
        )
        canvas = json.loads(canvas_path.read_text(encoding="utf-8"))
        variants = canvas.get("idea_variants", [])
        fusion_variants = [v for v in variants if v.get("mutation_type") == "fusion"]
        assert len(fusion_variants) == 0, \
            f"Expected no fusion variant when genre_secondary is absent, got {len(fusion_variants)}"
    finally:
        settings.projects_dir = original


def test_regenerate_raw_intent_skips_fusion_when_genres_identical(tmp_path):
    """When genre_primary == genre_secondary, /fuse would 400 — skip fusion entirely."""
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    try:
        pid = "proj_identical_genres_regen"
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
                    "content": "p", "novelty_score": 0, "trope_tags": [],
                    "saturation_warning": False, "mutation_context": None,
                    "children_ids": [], "is_expanded": True,
                    "branch_status": "active",
                }},
                "edges": [], "selected_path": ["wi_001_00"],
                "branch_choices": {}, "evaluations": {},
                "created_at": "2026-08-30T10:00:00",
                "updated_at": "2026-08-30T10:00:00",
                "committed_at": None, "committed_concept_ref": None,
                "idea_variants": [],
                "core_contradiction": None,
                "novelty_scores": None,
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
            f"/api/v1/projects/{pid}/creative/diverge/regenerate/raw-intent",
            json={"user_modifications": ""},
        )
        assert response.status_code == 200, response.text

        canvas_path = (
            settings.projects_dir / pid / "creative_os" / "canvas_state.json"
        )
        canvas = json.loads(canvas_path.read_text(encoding="utf-8"))
        variants = canvas.get("idea_variants", [])
        fusion_variants = [v for v in variants if v.get("mutation_type") == "fusion"]
        assert len(fusion_variants) == 0, \
            f"Expected no fusion variant when genres identical, got {len(fusion_variants)}"
    finally:
        settings.projects_dir = original