"""Tests for the two new optional World fields added in v1.8."""
import json
import pytest
from backend.models.world import World


def test_world_accepts_new_fields_with_values():
    world = World(
        era="近未来",
        geography="东亚沿海",
        era_social_structure="联邦体制",
        era_cultural_history="上一次技术爆发",
        power_system={"name": "X", "description": "", "stages": [], "core_rules": [], "ceilings": []},
        factions=[],
        core_rules=[],
    )
    assert world.era_social_structure == "联邦体制"
    assert world.era_cultural_history == "上一次技术爆发"


def test_world_new_fields_default_to_none():
    world = World(
        era="古代",
        geography="中原",
        power_system={"name": "X", "description": "", "stages": [], "core_rules": [], "ceilings": []},
        factions=[],
        core_rules=[],
    )
    assert world.era_social_structure is None
    assert world.era_cultural_history is None


def test_world_round_trips_through_model_dump():
    world = World(
        era="古代",
        geography="中原",
        era_social_structure="分封制",
        era_cultural_history="百家争鸣",
    )
    data = world.model_dump()
    assert data["era_social_structure"] == "分封制"
    assert data["era_cultural_history"] == "百家争鸣"


def test_world_yaml_prompt_references_both_fields():
    from pathlib import Path
    prompt_path = Path(__file__).resolve().parents[1] / "backend" / "prompts" / "world_generation.yaml"
    text = prompt_path.read_text(encoding="utf-8")
    assert "era_social_structure" in text, "world_generation.yaml must reference era_social_structure"
    assert "era_cultural_history" in text, "world_generation.yaml must reference era_cultural_history"


def test_world_yaml_prompt_includes_power_system_core_rules():
    # Bug fix: previously the prompt only asked for core_rules at the top
    # level (世界规则) but not inside power_system (体系规则). The wizard
    # renders both fields, so the prompt must populate both.
    from pathlib import Path
    prompt_path = Path(__file__).resolve().parents[1] / "backend" / "prompts" / "world_generation.yaml"
    text = prompt_path.read_text(encoding="utf-8")
    # Must mention 体系规则 in the user-instruction list of power_system
    # components (line "3. 力量体系（...）").
    assert "体系规则" in text, "world_generation.yaml must mention 体系规则 in power system instructions"
    # Extract the power_system {{ ... }} block and assert it contains
    # "core_rules" (so the schema the LLM is told to emit populates the
    # wizard's 体系规则 field, not just the top-level 世界规则).
    after_ps = text.split('"power_system":', 1)[1]
    # The block ends at the matching closing "}}" — the prompt nests one
    # level (power_system block uses {{ }}), so take up to the first "}}".
    ps_block = after_ps.split("}}", 1)[0]
    assert '"core_rules"' in ps_block, (
        "world_generation.yaml power_system schema must include core_rules as a field"
    )


# Regression: proj_ec67d3e2 — the LLM ignored the prompt's string schema for
# `era_social_structure` and `power_system.stages` and produced nested
# objects. The wizard's <textarea value={...}> threw on the object and the
# form failed to render. The model's field_validator coerces objects to
# JSON strings / flattens nested arrays so the schema stays self-consistent
# and the wizard can render the legacy data.
def test_world_coerces_object_era_social_structure_to_json_string():
    raw = {
        "era": "清末",
        "geography": "华南",
        "era_social_structure": {
            "人类阶层": "军阀",
            "异类阶层": "僵尸",
        },
        "era_cultural_history": "太平天国",
        "power_system": {"name": "X", "description": "", "stages": [], "core_rules": [], "ceilings": []},
        "factions": [],
        "core_rules": [],
    }
    world = World.model_validate(raw)
    # Validator serialized the object to a JSON string. The wizard's
    # <textarea value={...}> needs a string, not an object.
    assert isinstance(world.era_social_structure, str)
    decoded = json.loads(world.era_social_structure)
    assert decoded == {"人类阶层": "军阀", "异类阶层": "僵尸"}
    # Round-trip through model_dump preserves the stringification.
    dumped = world.model_dump()
    assert isinstance(dumped["era_social_structure"], str)


def test_world_coerces_object_power_system_stages_to_flat_array():
    raw = {
        "era": "清末",
        "geography": "华南",
        "power_system": {
            "name": "道炁",
            "description": "",
            "stages": {
                "人道阶": ["养气期", "凝神期"],
                "地道阶": ["贯通期"],
            },
            "core_rules": ["境界匹配"],
            "ceilings": ["合道期"],
        },
        "factions": [],
        "core_rules": [],
    }
    world = World.model_validate(raw)
    # Validator flattened the nested object to a flat string array.
    assert world.power_system.stages == ["养气期", "凝神期", "贯通期"]
    # Round-trip preserves the flattening.
    assert world.model_dump()["power_system"]["stages"] == ["养气期", "凝神期", "贯通期"]


def test_world_passes_through_valid_string_inputs_unchanged():
    # The validator must be a no-op for data that already matches the schema.
    raw = {
        "era": "古代",
        "geography": "中原",
        "era_social_structure": "分封制",
        "era_cultural_history": "百家争鸣",
        "power_system": {
            "name": "灵力",
            "description": "...",
            "stages": ["炼气", "筑基"],
            "core_rules": [],
            "ceilings": [],
        },
        "factions": [],
        "core_rules": [],
    }
    world = World.model_validate(raw)
    assert world.era_social_structure == "分封制"
    assert world.era_cultural_history == "百家争鸣"
    assert world.power_system.stages == ["炼气", "筑基"]
