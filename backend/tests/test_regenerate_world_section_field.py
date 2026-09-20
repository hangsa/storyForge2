"""Tests for /regenerate-world-section?section=era&field=<era field>.

2026-09-20: WorldStep 二级 tab 需要细粒度 era 字段重生。
section=era 时,可附加 field 限定仅重生 4 个 era 字段中的一个,
其余 3 个 era 字段 byte-preserve。
"""
import json
import pytest
from unittest.mock import patch, AsyncMock
from pathlib import Path
from typing import Literal

from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.main import app

client = TestClient(app)
PROJ = "proj_test_world_field"


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
            "source": "energetics",
        },
        "factions": [
            {"name": "旧势力A", "type": "国家", "goal": "旧目标A", "relations": "旧关系A"},
        ],
        "core_rules": ["世界规则旧"],
    }


@pytest.fixture(autouse=True)
def _patch_settings(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield


def _mock_world_payload_only_geography_changed():
    """LLM mocked to return a geography field different from existing;
    other era fields equal existing values (so per-field diff is observable)."""
    return {
        "era": "旧时代",
        "geography": "新大陆+新海洋",
        "era_social_structure": "旧社会",
        "era_cultural_history": "旧历史",
        "power_systems": [
            {
                "name": "旧体系",
                "description": "旧描述",
                "stages": ["旧一阶"],
                "core_rules": ["旧规则"],
                "ceilings": ["旧上限"],
                "cost_system": "旧代价",
            }
        ],
        "factions": [
            {"name": "旧势力A", "type": "国家", "goal": "旧目标A", "relations": "旧关系A"},
        ],
        "core_rules": ["世界规则旧"],
    }


def _mock_world_payload_only_era_changed():
    """LLM mocked to return era field different from existing;
    other era fields equal existing values."""
    return {
        "era": "新世纪元",
        "geography": "旧地理",
        "era_social_structure": "旧社会",
        "era_cultural_history": "旧历史",
        "power_systems": [
            {
                "name": "旧体系",
                "description": "旧描述",
                "stages": ["旧一阶"],
                "core_rules": ["旧规则"],
                "ceilings": ["旧上限"],
                "cost_system": "旧代价",
            }
        ],
        "factions": [
            {"name": "旧势力A", "type": "国家", "goal": "旧目标A", "relations": "旧关系A"},
        ],
        "core_rules": ["世界规则旧"],
    }


def test_field_geography_only_writes_geography(tmp_path):
    """section=era&field=geography → 只改 world.geography, 其他 3 个 era 字段 byte-identical。"""
    _seed_project(tmp_path)
    _write(tmp_path, "world.json", _seed_old_world())
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_world = AsyncMock(return_value=(
            _mock_world_payload_only_geography_changed(),
            None,
        ))
        resp = client.post(
            f"/api/stage2/regenerate-world-section?project_id={PROJ}",
            json={"section": "era", "field": "geography"},
        )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    existing = _seed_old_world()
    # Target field changed
    assert detail["geography"] == "新大陆+新海洋"
    # Other 3 era fields byte-identical
    assert detail["era"] == existing["era"]
    assert detail["era_social_structure"] == existing["era_social_structure"]
    assert detail["era_cultural_history"] == existing["era_cultural_history"]
    # Other top-level keys untouched
    assert detail["factions"] == existing["factions"]
    assert detail["power_systems"] == [existing["power_system"]]


def test_field_era_only_writes_era(tmp_path):
    """section=era&field=era → 只改 world.era, 其他 3 个 era 字段 byte-identical。"""
    _seed_project(tmp_path)
    _write(tmp_path, "world.json", _seed_old_world())
    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_world = AsyncMock(return_value=(
            _mock_world_payload_only_era_changed(),
            None,
        ))
        resp = client.post(
            f"/api/stage2/regenerate-world-section?project_id={PROJ}",
            json={"section": "era", "field": "era"},
        )
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    existing = _seed_old_world()
    # Target field changed
    assert detail["era"] == "新世纪元"
    # Other 3 era fields byte-identical
    assert detail["geography"] == existing["geography"]
    assert detail["era_social_structure"] == existing["era_social_structure"]
    assert detail["era_cultural_history"] == existing["era_cultural_history"]
    # Other top-level keys untouched
    assert detail["factions"] == existing["factions"]
    assert detail["power_systems"] == [existing["power_system"]]


def test_field_validator_rejects_unknown_field():
    """field 非 Literal 值应被 Pydantic validator 拒绝 (测试 Pydantic 直接构造)。"""
    from backend.api.stage2_world_char import RegenerateWorldSectionPayload
    with pytest.raises(ValidationError):
        RegenerateWorldSectionPayload(section="era", field="not_a_field")


def test_field_validator_rejects_field_with_non_era_section():
    """field 仅在 section='era' 时生效 — section='power_system' & field=X 应被 validator 拒绝。"""
    from backend.api.stage2_world_char import RegenerateWorldSectionPayload
    with pytest.raises(ValidationError):
        RegenerateWorldSectionPayload(section="power_system", field="era")


def test_field_validator_rejects_dim_mutual_exclusion():
    """field + category 同时传 → 互斥校验拒绝。"""
    from backend.api.stage2_world_char import RegenerateWorldSectionPayload
    with pytest.raises(ValidationError):
        RegenerateWorldSectionPayload(
            section="era", field="era", category="physical"
        )
