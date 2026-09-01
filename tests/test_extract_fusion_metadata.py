"""Unit tests for _extract_fusion_metadata helper."""
import pytest

from backend.api.creative_diverge import _extract_fusion_metadata


def test_returns_none_when_no_fusion_variants():
    canvas = {"idea_variants": [
        {"id": "v1", "mutation_type": "inversion"},
        {"id": "v2", "mutation_type": "escalation"},
    ]}
    assert _extract_fusion_metadata(canvas) is None


def test_returns_none_when_idea_variants_empty():
    canvas = {"idea_variants": []}
    assert _extract_fusion_metadata(canvas) is None


def test_returns_metadata_when_single_fusion_variant():
    canvas = {"idea_variants": [
        {"id": "f1", "mutation_type": "fusion", "risk_level": "medium", "fusion_distance": 2},
    ]}
    assert _extract_fusion_metadata(canvas) == ("medium", 2)


def test_returns_last_when_multiple_fusion_variants():
    """Append-only invariant: last fusion variant = most recent."""
    canvas = {"idea_variants": [
        {"id": "f1", "mutation_type": "fusion", "risk_level": "low", "fusion_distance": 1},
        {"id": "f2", "mutation_type": "inversion"},
        {"id": "f3", "mutation_type": "fusion", "risk_level": "high", "fusion_distance": 3},
    ]}
    assert _extract_fusion_metadata(canvas) == ("high", 3)


def test_falls_back_to_low_zero_when_metadata_missing():
    canvas = {"idea_variants": [
        {"id": "f1", "mutation_type": "fusion"},  # missing risk_level + fusion_distance
    ]}
    assert _extract_fusion_metadata(canvas) == ("low", 0)


def test_handles_invalid_distance_gracefully():
    canvas = {"idea_variants": [
        {"id": "f1", "mutation_type": "fusion", "risk_level": "medium", "fusion_distance": "not-a-number"},
    ]}
    assert _extract_fusion_metadata(canvas) == ("medium", 0)


def test_handles_missing_idea_variants_key():
    canvas = {}
    assert _extract_fusion_metadata(canvas) is None
