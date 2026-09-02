"""Verify /init persists all RawIntent fields to canvas.raw_intent."""
import json
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.creative_diverge import router as diverge_router
from backend.config import settings


@pytest.fixture
def project(tmp_path):
    """Project root + canvas dir; /init writes canvas_state.json on success."""
    original = settings.projects_dir
    settings.projects_dir = tmp_path
    pid = "proj_init_persist"
    project_dir = tmp_path / pid
    project_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": pid, "genre": "cool_novel"}),
        encoding="utf-8",
    )
    yield pid
    settings.projects_dir = original


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(diverge_router)
    return TestClient(app)


def test_init_persists_all_raw_intent_fields(project, client):
    response = client.post(
        f"/api/v1/projects/{project}/creative/diverge/init",
        json={
            "premise": "一个关于永生者寻找死亡方法的故事",
            "genre_primary": "仙侠",
            "genre_secondary": "悬疑",
            "target_reader": "男频 · 30+",
            "reference_works": ["诡秘之主"],
            "forbidden_directions": ["后宫"],
            "quick_mode": False,
        },
    )
    assert response.status_code == 200, response.text

    canvas_path = (
        settings.projects_dir / project / "creative_os" / "canvas_state.json"
    )
    canvas = json.loads(canvas_path.read_text(encoding="utf-8"))
    raw_intent = canvas["raw_intent"]
    assert raw_intent["prompt"] == "一个关于永生者寻找死亡方法的故事"
    assert raw_intent["genre_primary"] == "仙侠"
    assert raw_intent["genre_secondary"] == "悬疑"
    assert raw_intent["target_reader"] == "男频 · 30+"
    assert raw_intent["reference_works"] == ["诡秘之主"]
    assert raw_intent["forbidden_directions"] == ["后宫"]
    assert raw_intent["quick_mode"] is False
    assert raw_intent["trope_tags"] == []


def test_init_returns_400_when_genre_primary_missing(project, client):
    response = client.post(
        f"/api/v1/projects/{project}/creative/diverge/init",
        json={"premise": "no genre here"},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "GENRE_MISSING"


def test_init_returns_400_when_genre_primary_empty_string(project, client):
    """Edge case: empty string must be rejected just like a missing field.

    Locks in the `(request.genre_primary or "").strip()` gate so a future
    refactor cannot let "" slip through.
    """
    response = client.post(
        f"/api/v1/projects/{project}/creative/diverge/init",
        json={"premise": "x", "genre_primary": ""},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "GENRE_MISSING"


def test_init_returns_400_when_genre_primary_whitespace_only(project, client):
    """Edge case: whitespace-only genre_primary must be rejected.

    The .strip() check ensures "   " is treated as missing.
    """
    response = client.post(
        f"/api/v1/projects/{project}/creative/diverge/init",
        json={"premise": "x", "genre_primary": "   "},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "GENRE_MISSING"


def test_init_accepts_prompt_alias_for_premise(project, client):
    """The frontend RawIntent interface uses `prompt`; the legacy backend
    field name is `premise`. Both must populate the same canvas field so
    the UI doesn't 422 on every submit.

    Found in Task 13 E2E smoke test (proj_f597db51, 2026-09-02): the
    field mismatch was hidden by frontend unit tests that mock
    postDivergeInit, so the bug shipped through Tasks 1 + 8 undetected.
    """
    response = client.post(
        f"/api/v1/projects/{project}/creative/diverge/init",
        json={"prompt": "用 prompt 字段的现代调用", "genre_primary": "xianxia"},
    )
    assert response.status_code == 200, response.text
    canvas = response.json()["detail"]
    assert canvas["raw_intent"]["prompt"] == "用 prompt 字段的现代调用"


def test_init_accepts_legacy_premise_field_name(project, client):
    """The `prompt` alias was added so the new frontend works, but legacy
    internal callers (tests, scripts) still send `premise`. This test
    asserts the legacy name keeps working — without it, a future refactor
    that drops `populate_by_name=True` would silently break every legacy
    caller.

    Pairs with `test_init_accepts_prompt_alias_for_premise` (the modern
    side of the same alias contract).
    """
    response = client.post(
        f"/api/v1/projects/{project}/creative/diverge/init",
        json={"premise": "legacy premise 字段的旧调用", "genre_primary": "xianxia"},
    )
    assert response.status_code == 200, response.text
    canvas = response.json()["detail"]
    # Both aliases populate the same canvas field; the wire-level naming
    # is invisible to downstream consumers (regenerate/fuse/commit all
    # read canvas.raw_intent.prompt regardless of which name was sent).
    assert canvas["raw_intent"]["prompt"] == "legacy premise 字段的旧调用"