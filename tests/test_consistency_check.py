"""Tests for the 5-dimension consistency check (PRD §17.2).

Validates check_consistency() across all five dimensions:
- Concept (premise + core_conflict non-empty)
- World (≥1 world_rule declared)
- Character (≥1 named character with role)
- Conflict (core_conflict contains opposition keywords)
- Novelty (concept.novelty ≥ 0.5)
"""
from backend.creative_os.consistency_check import check_consistency


def test_all_dimensions_passing_returns_no_failures():
    concept = {
        "premise": "Cultivator seeks death after 1000 years",
        "core_conflict": "Immortality vs desire for meaning",
        "characters": [{"name": "Lin Feng", "role": "protagonist"}],
        "world_rules": ["Cultivation requires spiritual roots"],
        "tropes": ["xianxia"],
        "themes": ["mortality"],
        "novelty": 0.75,
    }
    result = check_consistency(concept)
    assert result.passed is True
    assert result.failures == []


def test_empty_premise_fails_concept_dimension():
    result = check_consistency({"premise": ""})
    assert "concept" in [f.dimension for f in result.failures]


def test_no_world_rules_fails_world_dimension():
    result = check_consistency({
        "premise": "x", "core_conflict": "y",
        "characters": [{"name": "a", "role": "p"}],
        "world_rules": [], "tropes": [], "themes": [], "novelty": 0.6,
    })
    assert "world" in [f.dimension for f in result.failures]


def test_novelty_below_threshold_fails():
    result = check_consistency({
        "premise": "x", "core_conflict": "y",
        "characters": [{"name": "a", "role": "p"}],
        "world_rules": ["r"], "tropes": [], "themes": [], "novelty": 0.3,
    })
    assert "novelty" in [f.dimension for f in result.failures]


def test_failure_includes_suggestion():
    result = check_consistency({"premise": ""})
    assert result.failures[0].suggestion