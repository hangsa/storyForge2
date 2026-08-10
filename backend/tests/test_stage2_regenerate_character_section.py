"""Tests for POST /api/stage2/regenerate-character-section.

Sections: personality, voice_signature, current_state, unknown, relations.
Special cases:
- voice_signature must preserve behavior_examples (per-card regenerate
  workflow owns that field)
- personality with keep_existing=true appends items to the existing arrays
  instead of replacing them
"""
import json
import pytest
from unittest.mock import patch, AsyncMock
from pathlib import Path

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)
PROJ = "proj_test_char_section"
CID = "c1"


def _write(tmp_path: Path, name: str, payload) -> None:
    (tmp_path / PROJ).mkdir(parents=True, exist_ok=True)
    (tmp_path / PROJ / name).write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )


def _seed_project(tmp_path: Path) -> None:
    """Seed project.json so the 404 PROJECT_NOT_FOUND check in the endpoint
    does not fire before the target assertions. Genre defaults to cool_novel
    unless the test overrides."""
    _write(tmp_path, "project.json", {"genre": "cool_novel"})


def _seed_old_character():
    return {
        "id": CID,
        "name": "Alice",
        "character_type": "protagonist",
        "personality": {
            "beliefs": ["旧信A"],
            "desires": ["旧欲"],
            "fears": ["旧恐惧"],
            "values": ["旧价值"],
            "core_traits": ["旧特质A", "旧特质B"],
        },
        "current_state": {
            "location": "旧位置",
            "physical_condition": "旧身体",
            "emotional": "旧情绪",
            "known_secrets": ["旧秘密"],
        },
        "voice_signature": {
            "speech_style": "旧说话",
            "thought_patterns": "旧思维",
            "taboos": ["旧禁忌"],
            "behavior_examples": [
                {"situation": "旧场景", "action": "旧动作", "speech_sample": "旧台词"},
            ],
        },
        "unknown_to_character": ["旧未知"],
        "relations": {"c2": {"status": "盟友", "history": [], "last_update_chapter": 1}},
    }


def _mock_new_character():
    return {
        "id": CID,
        "name": "Alice",
        "character_type": "protagonist",
        "personality": {
            "beliefs": ["新信A", "新信B"],
            "desires": ["新欲"],
            "fears": ["新恐惧"],
            "values": ["新价值"],
            "core_traits": ["新特质A"],
        },
        "current_state": {
            "location": "新位置",
            "physical_condition": "新身体",
            "emotional": "新情绪",
            "known_secrets": ["新秘密"],
        },
        "voice_signature": {
            "speech_style": "新说话",
            "thought_patterns": "新思维",
            "taboos": ["新禁忌"],
            # LLM might return behavior_examples — endpoint must NOT touch the
            # existing ones (per-card regenerate-examples owns that field).
            "behavior_examples": [
                {"situation": "新LLM场景", "action": "新LLM动作", "speech_sample": "新LLM台词"},
            ],
        },
        "unknown_to_character": ["新未知"],
        "relations": {"c2": {"status": "宿敌", "history": [], "last_update_chapter": 2}},
    }


@pytest.fixture(autouse=True)
def _patch_settings(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield


@pytest.fixture
def mock_planner():
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_character = AsyncMock(return_value=(
            _mock_new_character(),
            None,
        ))
        yield MockPlanner


def test_regenerate_voice_signature_preserves_behavior_examples(mock_planner, tmp_path):
    seeded = _seed_old_character()
    _seed_project(tmp_path)
    _write(tmp_path, "characters.json", {"characters": [seeded]})
    resp = client.post(
        f"/api/stage2/regenerate-character-section?project_id={PROJ}&character_id={CID}",
        json={"section": "voice_signature", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    # speech_style / thought_patterns / taboos replaced.
    assert detail["voice_signature"]["speech_style"] == "新说话"
    assert detail["voice_signature"]["thought_patterns"] == "新思维"
    assert detail["voice_signature"]["taboos"] == ["新禁忌"]
    # behavior_examples preserved — LLM's examples are NOT merged.
    assert detail["voice_signature"]["behavior_examples"] == seeded["voice_signature"]["behavior_examples"]
    # Other sections unchanged.
    assert detail["personality"] == seeded["personality"]
    assert detail["current_state"] == seeded["current_state"]
    assert detail["unknown_to_character"] == seeded["unknown_to_character"]
    assert detail["relations"] == seeded["relations"]


def test_regenerate_personality_default_replaces_arrays(mock_planner, tmp_path):
    seeded = _seed_old_character()
    _seed_project(tmp_path)
    _write(tmp_path, "characters.json", {"characters": [seeded]})
    resp = client.post(
        f"/api/stage2/regenerate-character-section?project_id={PROJ}&character_id={CID}",
        json={"section": "personality", "keep_existing": False, "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert detail["personality"]["beliefs"] == ["新信A", "新信B"]
    assert detail["personality"]["core_traits"] == ["新特质A"]
    # Old arrays gone.
    assert detail["personality"]["fears"] == ["新恐惧"]
    # Other sections unchanged.
    assert detail["voice_signature"] == seeded["voice_signature"]


def test_regenerate_personality_keep_existing_appends_items(mock_planner, tmp_path):
    seeded = _seed_old_character()
    _seed_project(tmp_path)
    _write(tmp_path, "characters.json", {"characters": [seeded]})
    resp = client.post(
        f"/api/stage2/regenerate-character-section?project_id={PROJ}&character_id={CID}",
        json={"section": "personality", "keep_existing": True, "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    # Existing items first, then LLM items appended per-key.
    assert detail["personality"]["beliefs"] == ["旧信A", "新信A", "新信B"]
    assert detail["personality"]["core_traits"] == ["旧特质A", "旧特质B", "新特质A"]
    assert detail["personality"]["desires"] == ["旧欲", "新欲"]
    assert detail["personality"]["fears"] == ["旧恐惧", "新恐惧"]
    assert detail["personality"]["values"] == ["旧价值", "新价值"]


def test_regenerate_current_state_replaces_only_state(mock_planner, tmp_path):
    seeded = _seed_old_character()
    _seed_project(tmp_path)
    _write(tmp_path, "characters.json", {"characters": [seeded]})
    resp = client.post(
        f"/api/stage2/regenerate-character-section?project_id={PROJ}&character_id={CID}",
        json={"section": "current_state", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert detail["current_state"]["location"] == "新位置"
    assert detail["current_state"]["emotional"] == "新情绪"
    assert detail["personality"] == seeded["personality"]
    assert detail["voice_signature"] == seeded["voice_signature"]


def test_regenerate_unknown_replaces_only_array(mock_planner, tmp_path):
    seeded = _seed_old_character()
    _seed_project(tmp_path)
    _write(tmp_path, "characters.json", {"characters": [seeded]})
    resp = client.post(
        f"/api/stage2/regenerate-character-section?project_id={PROJ}&character_id={CID}",
        json={"section": "unknown", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert detail["unknown_to_character"] == ["新未知"]
    assert detail["voice_signature"] == seeded["voice_signature"]


def test_regenerate_relations_replaces_only_relations(mock_planner, tmp_path):
    seeded = _seed_old_character()
    _seed_project(tmp_path)
    _write(tmp_path, "characters.json", {"characters": [seeded]})
    resp = client.post(
        f"/api/stage2/regenerate-character-section?project_id={PROJ}&character_id={CID}",
        json={"section": "relations", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert detail["relations"]["c2"]["status"] == "宿敌"
    assert detail["personality"] == seeded["personality"]


def test_regenerate_unknown_section_returns_400(mock_planner, tmp_path):
    _seed_project(tmp_path)
    _write(tmp_path, "characters.json", {"characters": [_seed_old_character()]})
    resp = client.post(
        f"/api/stage2/regenerate-character-section?project_id={PROJ}&character_id={CID}",
        json={"section": "growth_curve", "user_modifications": ""},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"


def test_regenerate_missing_project_returns_404(mock_planner, tmp_path):
    # Seed only characters.json — no project.json, so the 404 fires before the agent.
    _write(tmp_path, "characters.json", {"characters": [_seed_old_character()]})
    resp = client.post(
        f"/api/stage2/regenerate-character-section?project_id={PROJ}&character_id={CID}",
        json={"section": "personality", "user_modifications": ""},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "PROJECT_NOT_FOUND"


def test_regenerate_unknown_character_id_returns_404(mock_planner, tmp_path):
    _seed_project(tmp_path)
    _write(tmp_path, "characters.json", {"characters": [_seed_old_character()]})
    resp = client.post(
        f"/api/stage2/regenerate-character-section?project_id={PROJ}&character_id=c_missing",
        json={"section": "personality", "user_modifications": ""},
    )
    assert resp.status_code == 404


def test_regenerate_agent_value_error_returns_503(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    _seed_project(tmp_path)
    _write(tmp_path, "characters.json", {"characters": [_seed_old_character()]})
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_character = AsyncMock(side_effect=ValueError("LLM down"))
        resp = client.post(
            f"/api/stage2/regenerate-character-section?project_id={PROJ}&character_id={CID}",
            json={"section": "personality", "user_modifications": ""},
        )
    assert resp.status_code == 503
