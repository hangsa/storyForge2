"""Verify /fuse returns explicit error codes for missing canvas / intent / same-genre."""
import json
import pytest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.creative_diverge import router as diverge_router
from backend.config import settings


@pytest.fixture
def project_no_canvas(tmp_path):
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_no_canvas"
    project_dir = tmp_path / pid
    project_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": pid, "genre": "cool_novel"}),
        encoding="utf-8",
    )
    yield pid
    settings.projects_dir = original


@pytest.fixture
def project_no_genre(tmp_path):
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_no_genre"
    project_dir = tmp_path / pid
    creative_os_dir = project_dir / "creative_os"
    creative_os_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": pid, "genre": "cool_novel"}),
        encoding="utf-8",
    )
    creative_os_dir.joinpath("canvas_state.json").write_text(
        json.dumps({
            "schema_version": 3, "root_node_id": "wi_001_00",
            "nodes": {"wi_001_00": {
                "id": "wi_001_00", "depth": 0, "parent_id": None,
                "content": "", "novelty_score": 0, "trope_tags": [],
                "saturation_warning": False, "mutation_context": None,
                "children_ids": [], "is_expanded": True, "branch_status": "active",
            }},
            "edges": [], "selected_path": ["wi_001_00"],
            "branch_choices": {}, "evaluations": {},
            "created_at": "2026-08-30T10:00:00",
            "updated_at": "2026-08-30T10:00:00",
            "committed_at": None, "committed_concept_ref": None,
            "idea_variants": [], "core_contradiction": None,
            "novelty_scores": None,
            "raw_intent": {"prompt": "测试", "trope_tags": []},
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


def test_fuse_returns_400_when_canvas_not_initialized(project_no_canvas, client):
    response = client.post(
        f"/api/v1/projects/{project_no_canvas}/creative/diverge/fuse",
        json={"genre_primary": "xianxia", "genre_secondary": "xuanyi", "prompt": "测试"},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "CANVAS_NOT_INITIALIZED"


def test_fuse_returns_400_when_genre_primary_missing_in_intent(project_no_genre, client):
    response = client.post(
        f"/api/v1/projects/{project_no_genre}/creative/diverge/fuse",
        json={"genre_primary": "xianxia", "genre_secondary": "xuanyi", "prompt": "测试"},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "INTENT_INCOMPLETE"
