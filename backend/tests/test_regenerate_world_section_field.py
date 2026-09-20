"""Tests for /regenerate-world-section?section=era&field=<era field>.

2026-09-20: WorldStep 二级 tab 需要细粒度 era 字段重生。
section=era 时,可附加 field 限定仅重生 4 个 era 字段中的一个,
其余 3 个 era 字段 byte-preserve。
"""
import json
import pytest
from unittest.mock import patch, AsyncMock
from pathlib import Path

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
        "era": "旧古代",
        "geography": "中原",
        "era_social_structure": "分封制",
        "era_cultural_history": "百家争鸣",
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


# (field_name, new_value) — all 4 era fields are regenerated in turn;
# the other 3 era fields in the LLM-returned payload are intentionally
# *different* from the seeded values so that any handler that
# accidentally writes a non-target field is caught by the byte-identical
# assertion below.
ERA_FIELD_CASES = [
    ("era", "古代"),
    ("geography", "新中原"),
    ("era_social_structure", "新分封制"),
    ("era_cultural_history", "新百家争鸣"),
]
ERA_FIELD_NAMES = {case[0] for case in ERA_FIELD_CASES}


@pytest.mark.parametrize("field_name,new_value", ERA_FIELD_CASES)
def test_field_only_writes_target_field(tmp_path, field_name, new_value):
    """section=era&field=<field_name> → 只改目标 era 字段,
    其他 3 个 era 字段 byte-identical (与 seeded 旧值逐字相同)。

    若 handler 因为 ERA_BLOCK_KEYS / Literal 顺序等 off-by-one 把
    错位的 era 字段写到 merged, 这里会立刻 fail。
    """
    _seed_project(tmp_path)
    seeded = _seed_old_world()
    _write(tmp_path, "world.json", seeded)

    # Mocked LLM 故意让 4 个 era 字段全部 ≠ seeded 旧值 —
    # 这样 handler 即使误写了非目标字段, 字节级比对也能发现。
    other_distractors = {
        "era": "LLM_era",
        "geography": "LLM_geo",
        "era_social_structure": "LLM_social",
        "era_cultural_history": "LLM_history",
    }
    mocked_payload = dict(other_distractors, **{field_name: new_value})
    mocked_payload.update({
        "power_systems": [{
            "name": seeded["power_system"]["name"],
            "description": seeded["power_system"]["description"],
            "stages": seeded["power_system"]["stages"],
            "core_rules": seeded["power_system"]["core_rules"],
            "ceilings": seeded["power_system"]["ceilings"],
            "cost_system": seeded["power_system"]["cost_system"],
        }],
        "factions": seeded["factions"],
        "core_rules": seeded["core_rules"],
    })

    with patch("backend.agents.planner.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value
        instance.generate_world = AsyncMock(return_value=(mocked_payload, None))
        resp = client.post(
            f"/api/stage2/regenerate-world-section?project_id={PROJ}",
            json={"section": "era", "field": field_name},
        )
    assert resp.status_code == 200
    detail = resp.json()["detail"]

    # Target field updated to new_value
    assert detail[field_name] == new_value
    # Other 3 era fields byte-identical to seeded (NOT to LLM distractor)
    for other_field in seeded:
        if other_field == field_name:
            continue
        if other_field in ERA_FIELD_NAMES:  # other era field — filter to the 4 era keys
            assert detail[other_field] == seeded[other_field], (
                f"non-target era field {other_field!r} should be byte-identical "
                f"to seeded value {seeded[other_field]!r}, got {detail[other_field]!r}"
            )
    # Other top-level keys untouched
    assert detail["factions"] == seeded["factions"]
    assert detail["power_systems"] == [seeded["power_system"]]


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
