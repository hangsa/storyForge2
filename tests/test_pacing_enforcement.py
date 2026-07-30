"""Tests for PacingAnalyzer + chapter review pacing_compliance integration."""
import pytest

from backend.style_engine.pacing import (
    PacingAnalyzer,
    PacingCompliance,
    PacingStats,
)


class TestPacingAnalyzer:
    def test_analyze_sync_empty_texts_returns_zero_stats(self):
        stats = PacingAnalyzer().analyze_sync([])
        assert stats == PacingStats()

    def test_analyze_sync_empty_string_returns_zero_stats(self):
        stats = PacingAnalyzer().analyze_sync([""])
        assert stats.chapter_word_count == 0
        assert stats.scene_word_counts == []
        assert stats.action_ratio == 0.0
        assert stats.max_consecutive_non_action == 0
        assert stats.sf_log_tags_per_1k == 0.0
