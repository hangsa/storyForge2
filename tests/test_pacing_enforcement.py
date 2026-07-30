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

    def test_analyze_sync_counts_chapter_words_correctly(self):
        # 10 CJK chars
        text = "你好世界这是测试文本"
        stats = PacingAnalyzer().analyze_sync([text])
        assert stats.chapter_word_count == 10

    def test_analyze_sync_counts_scene_words_per_scene(self):
        stats = PacingAnalyzer().analyze_sync(["一二三", "四五六"])
        assert stats.scene_word_counts == [3, 3]
        assert stats.chapter_word_count == 6

    def test_analyze_sync_detects_action_segments_via_verb_regex(self):
        # 2 paragraphs: first is dialogue-only (no verb, has quote → not action),
        # second has verb "挥" and no quote → action.
        text = '他说："你好啊。"\n\n林峰挥剑上前。'
        stats = PacingAnalyzer().analyze_sync([text])
        # 2 paragraphs total, 1 action → ratio 0.5
        assert stats.action_ratio == 0.5

    def test_analyze_sync_detects_max_consecutive_non_action(self):
        # 4 paragraphs: [non-action, action, non-action, non-action]
        # max consecutive non-action = 2 (the trailing two)
        text = (
            '他说："你好。"\n\n'
            '林峰挥剑而上。\n\n'
            '夜色静谧。\n\n'
            '星光黯淡。'
        )
        stats = PacingAnalyzer().analyze_sync([text])
        assert stats.max_consecutive_non_action == 2

    def test_analyze_sync_counts_sf_log_tags_per_1k(self):
        # 10 CJK chars + 1 SF_LOG tag → 1 / (10/1000) = 100 tags/1k
        # Note: SF_LOG tag payload uses ASCII-only attribute values so the
        # tag itself doesn't contribute to chapter_word_count.
        text = '你好世界这是测试文本<!-- SF_LOG knowledge_gain char="A" -->'
        stats = PacingAnalyzer().analyze_sync([text])
        assert stats.sf_log_tags_per_1k == pytest.approx(100.0)
