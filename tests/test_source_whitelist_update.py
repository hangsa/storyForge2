# tests/test_source_whitelist_update.py
"""Verify ALLOWED_CONCEPT_SOURCES accepts {canvas, canvas_edited} and that
canvas → canvas_edited auto-upgrades on first edit (preserves audit trail
per PRD §6.2).

Mirrors test_concept_source_field.py: uses backend.main:app + bootstrap
via /api/project/create so the module-level `fm` singleton sees the
real settings.projects_dir. Patching settings.projects_dir does NOT
help because backend.api.stage1_concept freezes `fm` at import time.
"""
import json
import pytest
from fastapi.testclient import TestClient

from backend.config import settings
from backend.main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def project_data():
    return {
        "title": "源白名单测试",
        "genre": "cool_novel",
        "min_words": 4000,
        "free_text": "测试 canvas / canvas_edited 来源白名单",
        "inspiration_source": "web_novel",
    }


@pytest.fixture
def project_with_canvas_source(client, project_data):
    """Create a project, pre-seed concept_and_dna.json as if the canvas
    /commit endpoint had already written a canvas-sourced concept."""
    create_resp = client.post("/api/project/create", json=project_data)
    proj_id = create_resp.json()["detail"]["id"]
    proj_dir = settings.projects_dir / proj_id
    (proj_dir / "concept_and_dna.json").write_text(
        json.dumps(
            {
                "concept": {
                    "title": "Canvas Title",
                    "premise": "p",
                    "theme": "t",
                    "genre": "g",
                    "tone": "tn",
                    "source": "canvas",
                    "source_variant_id": "wi_001_00",
                },
                "story_dna": {},
            },
            ensure_ascii=False,
        )
    )
    return proj_id


def test_canvas_source_accepted_on_get(client, project_with_canvas_source):
    """GET /api/stage1/concept returns the canvas-sourced concept as-is."""
    pid = project_with_canvas_source
    r = client.get(f"/api/stage1/concept?project_id={pid}")
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload["detail"]["concept"]["source"] == "canvas"
    assert payload["detail"]["concept"]["source_variant_id"] == "wi_001_00"


def test_canvas_source_upgraded_to_edited_on_put(client, project_with_canvas_source):
    """First PUT with source=canvas must auto-upgrade to canvas_edited
    and preserve source_variant_id (audit trail per PRD §6.2)."""
    pid = project_with_canvas_source
    r = client.put(
        "/api/stage1/concept",
        json={
            "project_id": pid,
            "concept": {
                "title": "Edited Title",
                "premise": "p2",
                "theme": "t2",
                "genre": "g2",
                "tone": "tn2",
                "source": "canvas",
            },
            "story_dna": {},
        },
    )
    assert r.status_code == 200, r.text
    saved = json.loads(
        (settings.projects_dir / pid / "concept_and_dna.json").read_text()
    )
    assert saved["concept"]["source"] == "canvas_edited"
    assert saved["concept"]["title"] == "Edited Title"
    # source_variant_id preserved from the canvas write
    assert saved["concept"]["source_variant_id"] == "wi_001_00"


def test_canvas_edited_source_preserved_on_put(client, project_with_canvas_source):
    """Second PUT with source=canvas_edited must stay canvas_edited
    (no downgrade, no source_variant_id loss)."""
    pid = project_with_canvas_source
    # First edit: canvas → canvas_edited
    client.put(
        "/api/stage1/concept",
        json={
            "project_id": pid,
            "concept": {
                "title": "First Edit",
                "premise": "p",
                "theme": "t",
                "genre": "g",
                "tone": "tn",
                "source": "canvas",
            },
            "story_dna": {},
        },
    )
    # Second edit: explicitly canvas_edited → stays canvas_edited
    r = client.put(
        "/api/stage1/concept",
        json={
            "project_id": pid,
            "concept": {
                "title": "Second Edit",
                "premise": "p2",
                "theme": "t2",
                "genre": "g2",
                "tone": "tn2",
                "source": "canvas_edited",
            },
            "story_dna": {},
        },
    )
    assert r.status_code == 200, r.text
    saved = json.loads(
        (settings.projects_dir / pid / "concept_and_dna.json").read_text()
    )
    assert saved["concept"]["source"] == "canvas_edited"
    assert saved["concept"]["title"] == "Second Edit"
    assert saved["concept"]["source_variant_id"] == "wi_001_00"


def test_unknown_source_still_rejected(client, project_with_canvas_source):
    """Source outside the expanded whitelist must still 422."""
    pid = project_with_canvas_source
    r = client.put(
        "/api/stage1/concept",
        json={
            "project_id": pid,
            "concept": {
                "title": "X",
                "source": "garbage",
            },
            "story_dna": {},
        },
    )
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "VALIDATION_ERROR"


def test_manual_source_still_clears_variant_id(client, project_with_canvas_source):
    """Regression: manual source must still clear source_variant_id,
    even when the existing on-disk source is canvas."""
    pid = project_with_canvas_source
    r = client.put(
        "/api/stage1/concept",
        json={
            "project_id": pid,
            "concept": {
                "title": "Manual Edit",
                "premise": "p",
                "theme": "t",
                "genre": "g",
                "tone": "tn",
                "source": "manual",
            },
            "story_dna": {},
        },
    )
    assert r.status_code == 200, r.text
    saved = json.loads(
        (settings.projects_dir / pid / "concept_and_dna.json").read_text()
    )
    assert saved["concept"]["source"] == "manual"
    assert saved["concept"].get("source_variant_id") in (None, "")
