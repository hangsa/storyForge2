"""Tests for POST /api/stage2/character/{cid}/regenerate-examples.

Mocks the PlannerAgent.generate_character call to avoid LLM costs.
"""
import json
import pytest
from unittest.mock import patch, AsyncMock
from pathlib import Path

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)
PROJ = "proj_test_regen"


def _write_characters(tmp_path: Path, characters: list[dict]) -> None:
    (tmp_path / PROJ).mkdir(parents=True, exist_ok=True)
    (tmp_path / PROJ / "characters.json").write_text(
        json.dumps({"characters": characters}, ensure_ascii=False),
        encoding="utf-8",
    )


@pytest.fixture(autouse=True)
def _patch_settings(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield


@pytest.fixture
def mock_planner():
    """Mock PlannerAgent.generate_character to return a fixed dict containing
    only behavior_examples — the endpoint will merge just that field."""
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_character = AsyncMock(return_value=(
            {"behavior_examples": [
                {"situation": "新场景", "action": "新行为", "speech_sample": "新台词"},
                {"situation": "新场景2", "action": "新行为2", "speech_sample": "新台词2"},
            ]},
            None,  # LLMResponse placeholder
        ))
        yield MockPlanner


def test_regenerate_replaces_existing_examples(mock_planner, tmp_path):
    _write_characters(tmp_path, [
        {"id": "c1", "name": "Alice",
         "voice_signature": {"speech_style": "s", "thought_patterns": "t", "taboos": [],
                              "behavior_examples": [{"situation": "old", "action": "old", "speech_sample": "old"}]}},
    ])
    resp = client.post(
        f"/api/stage2/character/c1/regenerate-examples?project_id={PROJ}",
        json={"keep_existing": False},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert len(detail["voice_signature"]["behavior_examples"]) == 2
    assert detail["voice_signature"]["behavior_examples"][0]["situation"] == "新场景"
    # Old example is gone.
    assert not any(e["situation"] == "old" for e in detail["voice_signature"]["behavior_examples"])


def test_regenerate_keep_existing_appends(mock_planner, tmp_path):
    _write_characters(tmp_path, [
        {"id": "c1", "name": "Alice",
         "voice_signature": {"speech_style": "s", "thought_patterns": "t", "taboos": [],
                              "behavior_examples": [{"situation": "old", "action": "old", "speech_sample": "old"}]}},
    ])
    resp = client.post(
        f"/api/stage2/character/c1/regenerate-examples?project_id={PROJ}",
        json={"keep_existing": True},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert len(detail["voice_signature"]["behavior_examples"]) == 3  # 1 old + 2 new


def test_regenerate_unknown_id_returns_404(mock_planner, tmp_path):
    _write_characters(tmp_path, [{"id": "c1", "name": "Alice"}])
    resp = client.post(
        f"/api/stage2/character/c_unknown/regenerate-examples?project_id={PROJ}",
        json={"keep_existing": False},
    )
    assert resp.status_code == 404


def test_regenerate_preserves_other_voice_signature_fields(mock_planner, tmp_path):
    _write_characters(tmp_path, [
        {"id": "c1", "name": "Alice",
         "voice_signature": {"speech_style": "沉稳", "thought_patterns": "三思后行", "taboos": ["撒谎"],
                              "behavior_examples": [{"situation": "old", "action": "old", "speech_sample": "old"}]}},
    ])
    resp = client.post(
        f"/api/stage2/character/c1/regenerate-examples?project_id={PROJ}",
        json={"keep_existing": False},
    )
    detail = resp.json()["detail"]
    assert detail["voice_signature"]["speech_style"] == "沉稳"
    assert detail["voice_signature"]["thought_patterns"] == "三思后行"
    assert detail["voice_signature"]["taboos"] == ["撒谎"]
