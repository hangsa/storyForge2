"""Tests for the two new optional World fields added in v1.8."""
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
