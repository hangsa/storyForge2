"""Tests for POST /api/stage2/regenerate-power-system-item.

Only world.power_systems[system_index] is rewritten. The rest of the array
and every other top-level world.json key stay byte-identical.
"""
import json
import pytest
from unittest.mock import patch, AsyncMock
from pathlib import Path

from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)
PROJ = "proj_test_power_item"


def _write(tmp_path: Path, name: str, payload) -> None:
    (tmp_path / PROJ).mkdir(parents=True, exist_ok=True)
    (tmp_path / PROJ / name).write_text(
        json.dumps(payload, ensure_ascii=False),
        encoding="utf-8",
    )


def _seed_project(tmp_path: Path) -> None:
    _write(tmp_path, "project.json", {
        "id": PROJ,
        "genre": "cool_novel",
        "initial_intent": {"free_text": "少年觉醒"},
    })
    _write(tmp_path, "concept_and_dna.json", {
        "concept": {"title": "觉醒", "premise": "逆袭", "tone": "热血", "theme": "命运"},
        "story_dna": {"core_contradiction": {"statement": "宿命 vs 自我"}},
    })


def _seed_two_system_world():
    return {
        "era": "修真纪元",
        "geography": "九州",
        "era_social_structure": "宗门林立",
        "era_cultural_history": "万年大战",
        "power_systems": [
            {
                "name": "灵力",
                "description": "吸纳天地灵气",
                "stages": ["炼气", "筑基", "金丹"],
                "core_rules": ["灵根为根"],
                "ceilings": ["最高元婴"],
                "cost_system": "寿元",
            },
            {
                "name": "武道",
                "description": "锤炼肉身",
                "stages": ["锻体", "宗师"],
                "core_rules": ["气血枯竭则止"],
                "ceilings": ["最高大宗师"],
                "cost_system": None,
            },
        ],
        "factions": [
            {"name": "青云宗", "type": "宗门", "goal": "守护", "relations": "中立"},
        ],
        "core_rules": ["弱肉强食"],
    }


def _mock_new_system():
    return {
        "name": "武道（新）",
        "description": "新武道描述",
        "stages": ["锻体", "宗师", "大宗师"],
        "core_rules": ["新规则"],
        "ceilings": ["最高武圣"],
        "cost_system": "折寿",
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
        instance.regenerate_power_system = AsyncMock(return_value=(
            _mock_new_system(),
            None,
        ))
        yield MockPlanner


def test_rewrite_only_target_index(mock_planner, tmp_path):
    _seed_project(tmp_path)
    old_world = _seed_two_system_world()
    _write(tmp_path, "world.json", old_world)
    resp = client.post(
        f"/api/stage2/regenerate-power-system-item?project_id={PROJ}",
        json={"system_index": 1, "user_modifications": "强调肉身极限"},
    )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert detail["system_index"] == 1
    assert detail["power_system"]["name"] == "武道（新）"
    # First system is untouched (byte-for-byte)
    assert detail["world"]["power_systems"][0] == old_world["power_systems"][0]
    # Second system is the new dict
    assert detail["world"]["power_systems"][1] == _mock_new_system()
    # All other top-level keys preserved
    assert detail["world"]["era"] == old_world["era"]
    assert detail["world"]["era_social_structure"] == old_world["era_social_structure"]
    assert detail["world"]["factions"] == old_world["factions"]
    assert detail["world"]["core_rules"] == old_world["core_rules"]


def test_rewrite_user_modifications_passed_to_agent(mock_planner, tmp_path):
    _seed_project(tmp_path)
    _write(tmp_path, "world.json", _seed_two_system_world())
    resp = client.post(
        f"/api/stage2/regenerate-power-system-item?project_id={PROJ}",
        json={"system_index": 0, "user_modifications": "弱化灵根门槛"},
    )
    assert resp.status_code == 200
    kwargs = mock_planner.return_value.regenerate_power_system.call_args.kwargs
    assert kwargs["user_modifications"] == "弱化灵根门槛"
    assert kwargs["target_index"] == 0
    assert len(kwargs["existing_systems"]) == 2


def test_rewrite_writes_to_disk_without_legacy_key(mock_planner, tmp_path):
    _seed_project(tmp_path)
    # Seed with the legacy singular shape — endpoint must fold it on write.
    legacy = _seed_two_system_world()
    legacy["power_system"] = legacy["power_systems"][0]
    _write(tmp_path, "world.json", legacy)
    resp = client.post(
        f"/api/stage2/regenerate-power-system-item?project_id={PROJ}",
        json={"system_index": 1, "user_modifications": ""},
    )
    assert resp.status_code == 200
    on_disk = json.loads((tmp_path / PROJ / "world.json").read_text(encoding="utf-8"))
    assert "power_system" not in on_disk
    assert len(on_disk["power_systems"]) == 2
    assert on_disk["power_systems"][1]["name"] == "武道（新）"


def test_out_of_range_index_returns_400(mock_planner, tmp_path):
    _seed_project(tmp_path)
    _write(tmp_path, "world.json", _seed_two_system_world())
    resp = client.post(
        f"/api/stage2/regenerate-power-system-item?project_id={PROJ}",
        json={"system_index": 5, "user_modifications": ""},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"
    assert resp.json()["detail"]["detail"]["index"] == 5
    assert resp.json()["detail"]["detail"]["total"] == 2


def test_empty_power_systems_returns_400(mock_planner, tmp_path):
    _seed_project(tmp_path)
    _write(tmp_path, "world.json", {
        "era": "空", "geography": "空", "era_social_structure": "",
        "era_cultural_history": "", "power_systems": [], "factions": [],
        "core_rules": [],
    })
    resp = client.post(
        f"/api/stage2/regenerate-power-system-item?project_id={PROJ}",
        json={"system_index": 0, "user_modifications": ""},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"


def test_agent_value_error_returns_503(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    _seed_project(tmp_path)
    _write(tmp_path, "world.json", _seed_two_system_world())
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.regenerate_power_system = AsyncMock(side_effect=ValueError("LLM down"))
        resp = client.post(
            f"/api/stage2/regenerate-power-system-item?project_id={PROJ}",
            json={"system_index": 0, "user_modifications": ""},
        )
    assert resp.status_code == 503
    assert resp.json()["detail"]["code"] == "LLM_GENERATION_FAILED"


def test_missing_project_returns_404(tmp_path):
    # No project.json — 404 fires before planner access.
    resp = client.post(
        f"/api/stage2/regenerate-power-system-item?project_id={PROJ}",
        json={"system_index": 0, "user_modifications": ""},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "PROJECT_NOT_FOUND"