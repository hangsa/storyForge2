"""Tests for POST /api/stage2/regenerate-world-section.

Sections: era (era + geography + era_social_structure + era_cultural_history),
power_system (object), factions (array), core_rules (top-level array).
Other top-level keys stay byte-identical.
"""
import json
import pytest
from unittest.mock import patch, AsyncMock
from pathlib import Path

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)
PROJ = "proj_test_world_section"


def _write(tmp_path: Path, name: str, payload) -> None:
    (tmp_path / PROJ).mkdir(parents=True, exist_ok=True)
    (tmp_path / PROJ / name).write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )


def _seed_old_world():
    return {
        "era": "旧时代",
        "geography": "旧地理",
        "era_social_structure": "旧社会",
        "era_cultural_history": "旧历史",
        "power_system": {
            "name": "旧体系",
            "description": "旧描述",
            "stages": ["旧一阶"],
            "core_rules": ["旧规则"],
            "ceilings": ["旧上限"],
            "cost_system": "旧代价",
        },
        "factions": [
            {"name": "旧势力A", "type": "国家", "goal": "旧目标A", "relations": "旧关系A"},
        ],
        "core_rules": ["世界规则旧"],
    }


def _mock_world_payload():
    return {
        "era": "新时代",
        "geography": "新地理",
        "era_social_structure": "新社会",
        "era_cultural_history": "新历史",
        "power_system": {
            "name": "新体系",
            "description": "新描述",
            "stages": ["新一阶", "新二阶"],
            "core_rules": ["新规则"],
            "ceilings": ["新上限"],
            "cost_system": "新代价",
        },
        "factions": [
            {"name": "新势力A", "type": "宗门", "goal": "新目标A", "relations": "新关系A"},
        ],
        "core_rules": ["世界规则新"],
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
        instance.generate_world = AsyncMock(return_value=(
            _mock_world_payload(),
            None,
        ))
        yield MockPlanner


def test_regenerate_era_rewrites_only_era_block(mock_planner, tmp_path):
    _write(tmp_path, "world.json", _seed_old_world())
    resp = client.post(
        f"/api/stage2/regenerate-world-section?project_id={PROJ}",
        json={"section": "era", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert detail["era"] == "新时代"
    assert detail["geography"] == "新地理"
    # power_system / factions / core_rules preserved
    assert detail["power_system"] == _seed_old_world()["power_system"]
    assert detail["factions"] == _seed_old_world()["factions"]
    assert detail["core_rules"] == _seed_old_world()["core_rules"]


def test_regenerate_power_system_rewrites_only_power_system(mock_planner, tmp_path):
    _write(tmp_path, "world.json", _seed_old_world())
    resp = client.post(
        f"/api/stage2/regenerate-world-section?project_id={PROJ}",
        json={"section": "power_system", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert detail["power_system"]["name"] == "新体系"
    assert detail["power_system"]["stages"] == ["新一阶", "新二阶"]
    assert detail["era"] == _seed_old_world()["era"]
    assert detail["factions"] == _seed_old_world()["factions"]
    assert detail["core_rules"] == _seed_old_world()["core_rules"]


def test_regenerate_core_rules_rewrites_only_top_level_array(mock_planner, tmp_path):
    _write(tmp_path, "world.json", _seed_old_world())
    resp = client.post(
        f"/api/stage2/regenerate-world-section?project_id={PROJ}",
        json={"section": "core_rules", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert detail["core_rules"] == ["世界规则新"]
    assert detail["era"] == _seed_old_world()["era"]
    assert detail["power_system"] == _seed_old_world()["power_system"]
    assert detail["factions"] == _seed_old_world()["factions"]


def test_regenerate_factions_rewrites_only_factions_array(mock_planner, tmp_path):
    _write(tmp_path, "world.json", _seed_old_world())
    resp = client.post(
        f"/api/stage2/regenerate-world-section?project_id={PROJ}",
        json={"section": "factions", "user_modifications": ""},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert len(detail["factions"]) == 1
    assert detail["factions"][0]["name"] == "新势力A"
    assert detail["era"] == _seed_old_world()["era"]
    assert detail["power_system"] == _seed_old_world()["power_system"]


def test_regenerate_unknown_section_returns_400(mock_planner, tmp_path):
    _write(tmp_path, "world.json", _seed_old_world())
    resp = client.post(
        f"/api/stage2/regenerate-world-section?project_id={PROJ}",
        json={"section": "history", "user_modifications": ""},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"


def test_regenerate_agent_value_error_returns_503(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    _write(tmp_path, "world.json", _seed_old_world())
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_world = AsyncMock(side_effect=ValueError("LLM down"))
        resp = client.post(
            f"/api/stage2/regenerate-world-section?project_id={PROJ}",
            json={"section": "era", "user_modifications": ""},
        )
    assert resp.status_code == 503
    assert resp.json()["detail"]["code"] == "LLM_GENERATION_FAILED"
