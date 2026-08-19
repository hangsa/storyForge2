"""Tests for managed mode chapter range config and helpers."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from backend.models.autopilot_session import ManagedStartConfig


class TestManagedStartConfigRange:
    def test_scope_all_planned_default_is_accepted(self):
        cfg = ManagedStartConfig()
        assert cfg.scope == "all_planned"
        assert cfg.start_chapter is None
        assert cfg.end_chapter is None

    def test_scope_range_requires_start_and_end(self):
        with pytest.raises(ValidationError) as ei:
            ManagedStartConfig(scope="range")
        assert "start_chapter" in str(ei.value) or "end_chapter" in str(ei.value)

    def test_scope_range_accepts_valid_range(self):
        cfg = ManagedStartConfig(scope="range", start_chapter=5, end_chapter=15)
        assert cfg.start_chapter == 5
        assert cfg.end_chapter == 15

    def test_scope_range_rejects_end_less_than_start(self):
        with pytest.raises(ValidationError) as ei:
            ManagedStartConfig(scope="range", start_chapter=10, end_chapter=5)
        assert "end_chapter" in str(ei.value)

    def test_scope_range_rejects_start_less_than_one(self):
        with pytest.raises(ValidationError) as ei:
            ManagedStartConfig(scope="range", start_chapter=0, end_chapter=5)
        assert "start_chapter" in str(ei.value)

    def test_scope_range_allows_equal_start_and_end(self):
        """A single-chapter range is valid (degenerate case)."""
        cfg = ManagedStartConfig(scope="range", start_chapter=7, end_chapter=7)
        assert cfg.start_chapter == cfg.end_chapter == 7

    def test_next_chapter_scope_is_rejected(self):
        """Breaking change: scope='next_chapter' is gone."""
        with pytest.raises(ValidationError):
            ManagedStartConfig(scope="next_chapter", start_chapter=1, end_chapter=1)

    def test_cadence_policy_notify_literals_unchanged(self):
        """Other fields keep their old behavior."""
        cfg = ManagedStartConfig(scope="range", start_chapter=1, end_chapter=10,
                                  cadence="fast", policy="ask", notify="all")
        assert cfg.cadence == "fast"
        assert cfg.policy == "ask"
        assert cfg.notify == "all"
