"""Tests for PATCH/DELETE /stage2/character/{cid} — partial update + delete with
bidirectional relation cleanup. Backbone of wizard character edit/delete."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.config import settings
from backend.utils.file_manager import FileManager


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def project_with_characters(tmp_path, monkeypatch):
    """Create a project with two characters (one with a relation pointing at the other)."""
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    fm = FileManager(tmp_path)
    pid = "test_proj"
    fm.ensure_project_dir(pid)
    fm.write_json(pid, "characters.json", {
        "characters": [
            {
                "id": "char_alice",
                "name": "Alice",
                "personality": {"beliefs": ["x"], "desires": [], "fears": [], "values": [], "core_traits": []},
                "voice_signature": {"speech_style": "", "thought_patterns": "", "taboos": []},
                "current_state": {"location": "", "physical_condition": "normal", "emotional": "neutral", "known_secrets": []},
                "unknown_to_character": [],
                "is_core_character": True,
                "character_type": "protagonist",
                "relations": {"char_bob": {"status": "ally", "history": [], "last_update_chapter": 0}},
            },
            {
                "id": "char_bob",
                "name": "Bob",
                "personality": {"beliefs": [], "desires": [], "fears": [], "values": [], "core_traits": []},
                "voice_signature": {"speech_style": "", "thought_patterns": "", "taboos": []},
                "current_state": {"location": "", "physical_condition": "normal", "emotional": "neutral", "known_secrets": []},
                "unknown_to_character": [],
                "is_core_character": False,
                "character_type": "supporting",
                "relations": {},
            },
        ],
    })
    return pid, fm


def test_patch_single_field_updates_only_that_field(client, project_with_characters):
    pid, _ = project_with_characters
    r = client.patch(f"/api/stage2/character/char_alice?project_id={pid}", json={"name": "Alicia"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["detail"]["name"] == "Alicia"
    assert body["detail"]["id"] == "char_alice"
    assert body["detail"]["character_type"] == "protagonist"
    assert body["detail"]["is_core_character"] is True


def test_patch_nested_field_merges_into_personality(client, project_with_characters):
    pid, _ = project_with_characters
    r = client.patch(f"/api/stage2/character/char_alice?project_id={pid}",
                     json={"personality": {"beliefs": ["new"], "core_traits": ["brave"]}})
    assert r.status_code == 200, r.text
    body = r.json()
    p = body["detail"]["personality"]
    assert "new" in p["beliefs"]
    assert "brave" in p["core_traits"]
    assert p["desires"] == []


def test_patch_unknown_id_returns_404(client, project_with_characters):
    pid, _ = project_with_characters
    r = client.patch(f"/api/stage2/character/no_such?project_id={pid}", json={"name": "x"})
    assert r.status_code == 404
    body = r.json()
    assert body["detail"]["code"] == "NOT_FOUND"


def test_patch_invalid_character_type_returns_422(client, project_with_characters):
    pid, _ = project_with_characters
    r = client.patch(f"/api/stage2/character/char_alice?project_id={pid}",
                     json={"character_type": "bogus"})
    assert r.status_code == 422


def test_delete_removes_character_from_file(client, project_with_characters):
    pid, fm = project_with_characters
    r = client.delete(f"/api/stage2/character/char_bob?project_id={pid}")
    assert r.status_code == 200
    assert r.json()["detail"]["deleted_id"] == "char_bob"
    on_disk = fm.read_json(pid, "characters.json")
    assert on_disk is not None
    ids = [c["id"] for c in on_disk["characters"]]
    assert "char_bob" not in ids
    assert "char_alice" in ids


def test_delete_cascades_inbound_relations(client, project_with_characters):
    pid, fm = project_with_characters
    r = client.delete(f"/api/stage2/character/char_bob?project_id={pid}")
    assert r.status_code == 200
    assert r.json()["detail"]["cascaded_relation_removals"] == 1
    on_disk = fm.read_json(pid, "characters.json")
    alice = next(c for c in on_disk["characters"] if c["id"] == "char_alice")
    assert "char_bob" not in alice["relations"]


def test_delete_no_cascade_when_no_inbound_relations(client, project_with_characters):
    pid, _ = project_with_characters
    fm = FileManager(settings.projects_dir)
    fm.write_json(pid, "characters.json", {
        "characters": [
            {"id": "lonely", "name": "Lonely", "personality": {"beliefs": [], "desires": [], "fears": [], "values": [], "core_traits": []},
             "voice_signature": {"speech_style": "", "thought_patterns": "", "taboos": []},
             "current_state": {"location": "", "physical_condition": "normal", "emotional": "neutral", "known_secrets": []},
             "unknown_to_character": [], "is_core_character": False, "character_type": "supporting", "relations": {}},
        ],
    })
    r = client.delete(f"/api/stage2/character/lonely?project_id={pid}")
    assert r.status_code == 200
    assert r.json()["detail"]["cascaded_relation_removals"] == 0


def test_delete_unknown_id_returns_404(client, project_with_characters):
    pid, _ = project_with_characters
    r = client.delete(f"/api/stage2/character/no_such?project_id={pid}")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "NOT_FOUND"
