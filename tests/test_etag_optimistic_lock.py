"""Tests for ETag / optimistic locking on the creative divergence canvas.

Each GET /state returns an ETag at top level (16-char MD5 prefix). The
write endpoints /contradict PUT, /mutate/{id}/regenerate, and /merge
honor the If-Match header and reject with 409 RACE_CONDITION when the
client's ETag disagrees with the current canvas state.

If-Match is OPTIONAL — absent header means "no check" so existing
callers without optimistic locking keep working. /commit intentionally
does NOT gate on ETag (user-driven rewrite after path review).
"""
import json
import re

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
                "content": "测试前提",
                "novelty_score": 70,
                "trope_tags": [],
                "saturation_warning": False,
                "mutation_context": None,
                "children_ids": [],
                "is_expanded": True,
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
def project(tmp_path):
    """Set up project with initialized v3 canvas on disk."""
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_etag"
    project_dir = tmp_path / pid
    project_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": pid, "genre": "cool_novel"}),
        encoding="utf-8",
    )
    canvas = _make_canvas()
    creative_os_dir = project_dir / "creative_os"
    creative_os_dir.mkdir(parents=True)
    creative_os_dir.joinpath("canvas_state.json").write_text(
        json.dumps(canvas, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    yield pid, tmp_path
    settings.projects_dir = original


@pytest.fixture
def client(project):
    app = FastAPI()
    app.include_router(diverge_router)
    return TestClient(app)


def test_state_returns_etag_top_level(client, project):
    """GET /state returns a top-level `etag` field — 16 hex chars."""
    pid, _ = project
    r = client.get(f"/api/v1/projects/{pid}/creative/diverge/state")
    assert r.status_code == 200
    body = r.json()
    assert "etag" in body
    assert isinstance(body["etag"], str)
    # 16 hex chars from MD5 prefix
    assert re.fullmatch(r"[0-9a-f]{16}", body["etag"]), (
        f"etag must be 16 hex chars, got {body['etag']!r}"
    )
    # detail still holds the canvas dict
    assert "detail" in body
    assert body["detail"]["root_node_id"] == "wi_001_00"


def test_state_etag_is_stable_across_reads_when_unchanged(client, project):
    """Two consecutive GET /state calls return the same etag if no write happened."""
    pid, _ = project
    r1 = client.get(f"/api/v1/projects/{pid}/creative/diverge/state")
    r2 = client.get(f"/api/v1/projects/{pid}/creative/diverge/state")
    assert r1.json()["etag"] == r2.json()["etag"]


def test_state_etag_changes_after_write(client, project):
    """After PUT /contradict, the next GET /state returns a different etag."""
    pid, _ = project
    etag_before = client.get(
        f"/api/v1/projects/{pid}/creative/diverge/state"
    ).json()["etag"]

    r = client.put(
        f"/api/v1/projects/{pid}/creative/diverge/contradict",
        json={
            "template_type": "能力×限制",
            "statement": "越强越不能用",
            "side_a": "力量",
            "side_b": "代价",
            "is_custom": True,
        },
    )
    assert r.status_code == 200

    etag_after = client.get(
        f"/api/v1/projects/{pid}/creative/diverge/state"
    ).json()["etag"]
    assert etag_after != etag_before


def test_put_contradict_with_wrong_if_match_returns_409(client, project):
    """If-Match header with stale etag → 409 RACE_CONDITION."""
    pid, tmp_path = project

    # Capture etag
    etag_fresh = client.get(
        f"/api/v1/projects/{pid}/creative/diverge/state"
    ).json()["etag"]

    # Bypass the API: write canvas directly to disk so the stored version
    # no longer matches etag_fresh.
    canvas_path = tmp_path / pid / "creative_os" / "canvas_state.json"
    canvas = json.loads(canvas_path.read_text(encoding="utf-8"))
    canvas["raw_intent"] = {"prompt": "concurrent edit", "trope_tags": []}
    canvas_path.write_text(
        json.dumps(canvas, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    r = client.put(
        f"/api/v1/projects/{pid}/creative/diverge/contradict",
        json={
            "template_type": "能力×限制",
            "statement": "越强越不能用",
            "side_a": "力量",
            "side_b": "代价",
            "is_custom": True,
        },
        headers={"If-Match": etag_fresh},
    )
    assert r.status_code == 409
    body = r.json()
    assert body["detail"]["code"] == "RACE_CONDITION"
    # current_etag in detail for client retry
    assert "current_etag" in body["detail"]["detail"]


def test_put_contradict_with_correct_if_match_succeeds(client, project):
    """If-Match header with current etag → 200."""
    pid, _ = project
    etag = client.get(
        f"/api/v1/projects/{pid}/creative/diverge/state"
    ).json()["etag"]

    r = client.put(
        f"/api/v1/projects/{pid}/creative/diverge/contradict",
        json={
            "template_type": "能力×限制",
            "statement": "越强越不能用",
            "side_a": "力量",
            "side_b": "代价",
            "is_custom": True,
        },
        headers={"If-Match": etag},
    )
    assert r.status_code == 200


def test_put_contradict_without_if_match_header_succeeds(client, project):
    """If-Match absent → no check; existing callers keep working."""
    pid, tmp_path = project
    # Mutate canvas on disk to simulate stale state on the client
    canvas_path = tmp_path / pid / "creative_os" / "canvas_state.json"
    canvas = json.loads(canvas_path.read_text(encoding="utf-8"))
    canvas["raw_intent"] = {"prompt": "concurrent edit", "trope_tags": []}
    canvas_path.write_text(
        json.dumps(canvas, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    r = client.put(
        f"/api/v1/projects/{pid}/creative/diverge/contradict",
        json={
            "template_type": "能力×限制",
            "statement": "越强越不能用",
            "side_a": "力量",
            "side_b": "代价",
            "is_custom": True,
        },
    )
    assert r.status_code == 200


def test_post_merge_with_wrong_if_match_returns_409(client, project):
    """POST /merge honors If-Match — stale etag → 409."""
    pid, tmp_path = project
    etag_fresh = client.get(
        f"/api/v1/projects/{pid}/creative/diverge/state"
    ).json()["etag"]

    canvas_path = tmp_path / pid / "creative_os" / "canvas_state.json"
    canvas = json.loads(canvas_path.read_text(encoding="utf-8"))
    canvas["raw_intent"] = {"prompt": "concurrent edit", "trope_tags": []}
    canvas_path.write_text(
        json.dumps(canvas, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    r = client.post(
        f"/api/v1/projects/{pid}/creative/diverge/merge",
        json={"node_id_a": "wi_001_00", "node_id_b": "wi_002_00"},
        headers={"If-Match": etag_fresh},
    )
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "RACE_CONDITION"


def test_etag_field_is_never_persisted_on_disk(client, project):
    """`_etag` is a transient in-memory field; never written to canvas_state.json."""
    pid, tmp_path = project

    # Trigger a write via PUT /contradict
    r = client.put(
        f"/api/v1/projects/{pid}/creative/diverge/contradict",
        json={
            "template_type": "能力×限制",
            "statement": "x",
            "side_a": "a",
            "side_b": "b",
            "is_custom": True,
        },
    )
    assert r.status_code == 200

    canvas_path = tmp_path / pid / "creative_os" / "canvas_state.json"
    on_disk = json.loads(canvas_path.read_text(encoding="utf-8"))
    assert "_etag" not in on_disk


def test_etag_changes_when_updated_at_changes(client, project):
    """Two writes with different updated_at timestamps yield different etags."""
    pid, tmp_path = project

    # First write
    etag_after_first = client.get(
        f"/api/v1/projects/{pid}/creative/diverge/state"
    ).json()["etag"]
    client.put(
        f"/api/v1/projects/{pid}/creative/diverge/contradict",
        json={
            "template_type": "能力×限制",
            "statement": "first write",
            "side_a": "a",
            "side_b": "b",
            "is_custom": True,
        },
    )
    etag_after_second = client.get(
        f"/api/v1/projects/{pid}/creative/diverge/state"
    ).json()["etag"]
    assert etag_after_first != etag_after_second


def test_write_bumps_operation_count(client, project):
    """Each canvas write bumps session_metadata.operation_count."""
    pid, tmp_path = project

    canvas_path = tmp_path / pid / "creative_os" / "canvas_state.json"
    before = json.loads(canvas_path.read_text(encoding="utf-8"))
    count_before = before["session_metadata"]["operation_count"]

    client.put(
        f"/api/v1/projects/{pid}/creative/diverge/contradict",
        json={
            "template_type": "能力×限制",
            "statement": "x",
            "side_a": "a",
            "side_b": "b",
            "is_custom": True,
        },
    )

    after = json.loads(canvas_path.read_text(encoding="utf-8"))
    assert after["session_metadata"]["operation_count"] == count_before + 1
