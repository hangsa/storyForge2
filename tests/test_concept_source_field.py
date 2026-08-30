# tests/test_concept_source_field.py
"""Verify PUT /api/stage1/concept accepts and persists the `source` /
`source_variant_id` fields set by the creative-divergence select flow.

Mirrors the project-bootstrap pattern used by
test_integration_e2e.py::TestStage1::test_update_concept (which writes to
the real projects/ directory) — patching settings.projects_dir does not
help here because backend.api.stage1_concept uses a module-level `fm`
that's frozen at import time.
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
        "title": "源字段测试",
        "genre": "cool_novel",
        "min_words": 4000,
        "free_text": "一个少年在异世界觉醒能力，踏上强者之路",
        "inspiration_source": "web_novel",
    }


@pytest.fixture
def project_with_creative_divergence_source(client, project_data):
    """Create a project, pre-seed concept_and_dna.json as if the
    creative-divergence select endpoint had already chosen a variant."""
    create_resp = client.post("/api/project/create", json=project_data)
    proj_id = create_resp.json()["detail"]["id"]
    proj_dir = settings.projects_dir / proj_id
    (proj_dir / "concept_and_dna.json").write_text(
        json.dumps(
            {
                "concept": {
                    "title": "X",
                    "source": "creative_divergence",
                    "source_variant_id": "var_abc",
                },
                "story_dna": {},
            },
            ensure_ascii=False,
        )
    )
    return proj_id


def test_update_concept_accepts_source_manual(client, project_with_creative_divergence_source):
    pid = project_with_creative_divergence_source
    r = client.put(
        "/api/stage1/concept",
        json={
            "project_id": pid,
            "concept": {
                "title": "New",
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
    assert saved["concept"]["title"] == "New"
    # Manual edits clear the variant-id — provenance is now human.
    assert saved["concept"].get("source_variant_id") in (None, "")


def test_update_concept_preserves_source_when_omitted(client, project_with_creative_divergence_source):
    pid = project_with_creative_divergence_source
    # Caller doesn't include `source` at all → existing provenance survives.
    r = client.put(
        "/api/stage1/concept",
        json={
            "project_id": pid,
            "concept": {"title": "Keep Source"},
            "story_dna": {},
        },
    )
    assert r.status_code == 200, r.text
    saved = json.loads(
        (settings.projects_dir / pid / "concept_and_dna.json").read_text()
    )
    assert saved["concept"]["source"] == "creative_divergence"
    assert saved["concept"]["title"] == "Keep Source"
    assert saved["concept"]["source_variant_id"] == "var_abc"


def test_update_concept_rejects_unknown_source(client, project_with_creative_divergence_source):
    pid = project_with_creative_divergence_source
    r = client.put(
        "/api/stage1/concept",
        json={
            "project_id": pid,
            "concept": {"title": "Y", "source": "bogus"},
            "story_dna": {},
        },
    )
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "VALIDATION_ERROR"