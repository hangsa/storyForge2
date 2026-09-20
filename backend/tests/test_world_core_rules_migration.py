"""World.core_rules migration: list[str] → list[CoreRule{category, text}]."""

from backend.models.world import World, CoreRuleCategory, CoreRule


def test_legacy_string_list_migrates_to_structured_with_physical_default():
    """Old world.json had `core_rules: ["灵气存在", "王朝垄断灵脉"]` —
    a flat list of strings. Default category=physical (ontology) since
    ontology is the largest contributor to core_rules."""
    world = World.model_validate({
        "era": "古代",
        "core_rules": ["灵气存在", "王朝垄断灵脉"],
    })
    assert len(world.core_rules) == 2
    assert all(isinstance(r, CoreRule) for r in world.core_rules)
    assert world.core_rules[0].category == CoreRuleCategory.PHYSICAL
    assert world.core_rules[0].text == "灵气存在"
    assert world.core_rules[1].text == "王朝垄断灵脉"


def test_structured_list_with_categories_passes_through():
    """New shape `core_rules: [{category, text}, ...]` should validate
    with categories preserved."""
    world = World.model_validate({
        "core_rules": [
            {"category": "physical", "text": "灵气有限"},
            {"category": "social", "text": "灵脉开采权被朝廷垄断"},
            {"category": "narrative", "text": "强者不可干预弱者命运"},
            {"category": "protagonist", "text": "寄体觉醒后必死"},
        ]
    })
    assert [r.category for r in world.core_rules] == [
        CoreRuleCategory.PHYSICAL,
        CoreRuleCategory.SOCIAL,
        CoreRuleCategory.NARRATIVE,
        CoreRuleCategory.PROTAGONIST,
    ]
    assert world.core_rules[3].text == "寄体觉醒后必死"


def test_invalid_category_value_is_rejected():
    """An unknown category string should raise a validation error."""
    import pytest
    with pytest.raises(Exception):
        World.model_validate({
            "core_rules": [{"category": "magic", "text": "x"}]
        })


def test_missing_core_rules_key_yields_empty_list():
    world = World.model_validate({"era": "古代"})
    assert world.core_rules == []


def test_mixed_legacy_and_modern_list_preserves_each_category():
    """A partially-migrated list (some legacy strings, some new dicts)
    must preserve each item's category — no silent rewriting."""
    world = World.model_validate({
        "core_rules": [
            "legacy string",
            {"category": "social", "text": "modern dict"},
        ],
    })
    assert len(world.core_rules) == 2
    assert world.core_rules[0].category == CoreRuleCategory.PHYSICAL
    assert world.core_rules[0].text == "legacy string"
    assert world.core_rules[1].category == CoreRuleCategory.SOCIAL
    assert world.core_rules[1].text == "modern dict"


def test_world_rules_summary_flattens_across_categories():
    """WorldRulesSummary.from_world() must continue to flatten
    core_rules text across all 4 categories."""
    from backend.models.world import WorldRulesSummary
    world = World.model_validate({
        "core_rules": [
            {"category": "physical", "text": "灵气有限"},
            {"category": "social", "text": "灵脉被垄断"},
            {"category": "narrative", "text": "强者受限"},
            {"category": "protagonist", "text": "寄体必死"},
        ]
    })
    summary = WorldRulesSummary.from_world(world)
    assert summary.core_rules == [
        "灵气有限", "灵脉被垄断", "强者受限", "寄体必死",
    ]