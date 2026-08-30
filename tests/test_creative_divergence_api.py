# tests/test_creative_divergence_api.py
import json
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.config import settings

@pytest.fixture
def project(tmp_path, monkeypatch):
    pid = "proj_test_cd"
    (tmp_path / pid).mkdir()
    # _file_manager() is now a per-call factory that reads settings.projects_dir
    # fresh each invocation (sibling pattern from stage2_world_char.py), so
    # patch settings rather than a singleton attribute.
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    return pid

@pytest.fixture
def client(project):
    return TestClient(app)

def test_generate_returns_4_variants(client, project):
    r = client.post(f"/api/projects/{project}/creative-divergence/generate",
                    json={"prompt": "赛博朋克侦探调查记忆盗窃"})
    assert r.status_code == 200
    data = r.json()
    assert len(data["variants"]) == 4
    for v in data["variants"]:
        assert {"id", "label", "title", "description", "tags"} <= set(v.keys())

def test_generate_rejects_oversized_prompt(client, project):
    r = client.post(f"/api/projects/{project}/creative-divergence/generate",
                    json={"prompt": "x" * 2001})
    assert r.status_code == 422

def test_select_writes_concept_and_marks_source(client, project):
    client.post(f"/api/projects/{project}/creative-divergence/generate",
                json={"prompt": "AI 觉醒"})
    list_r = client.get(f"/api/projects/{project}/creative-divergence")
    variant_id = list_r.json()["variants"][0]["id"]
    sel = client.post(f"/api/projects/{project}/creative-divergence/select",
                      json={"variant_id": variant_id})
    assert sel.status_code == 200
    payload = sel.json()["concept_payload"]
    assert {"title", "genre", "premise", "tone", "theme"} <= set(payload.keys())
    cd = json.loads((settings.projects_dir / project / "concept_and_dna.json").read_text())
    assert cd["concept"]["source"] == "creative_divergence"
    assert cd["concept"]["source_variant_id"] == variant_id

def test_select_rejects_unknown_variant_id(client, project):
    client.post(f"/api/projects/{project}/creative-divergence/generate",
                json={"prompt": "AI 觉醒"})
    r = client.post(f"/api/projects/{project}/creative-divergence/select",
                    json={"variant_id": "var_doesnotexist"})
    assert r.status_code == 422

def test_prefill_check_reports_state(client, project):
    r = client.get(f"/api/projects/{project}/creative-divergence/prefill-check")
    assert r.json() == {"exists": False, "has_selection": False}
    client.post(f"/api/projects/{project}/creative-divergence/generate",
                json={"prompt": "AI 觉醒"})
    r = client.get(f"/api/projects/{project}/creative-divergence/prefill-check")
    assert r.json() == {"exists": True, "has_selection": False}
