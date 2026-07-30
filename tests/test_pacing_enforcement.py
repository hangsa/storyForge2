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


class TestCompliance:
    PACING = {
        "chapter_words": {"min": 3000, "max": 6000},
        "scene_words": {"min": 500, "max": 2000},
        "action_ratio": 0.45,
        "max_consecutive_non_action": 2,
        "min_beats_per_1k": 1.5,
    }

    def test_check_compliance_scene_words_min_passes_when_above(self):
        stats = PacingStats(scene_word_counts=[600, 700, 800], chapter_word_count=2100)
        results = PacingAnalyzer().check_compliance(stats, self.PACING)
        scene_min_results = [r for r in results if r.metric.startswith("scene_words.min#")]
        assert len(scene_min_results) == 3
        assert all(r.passed for r in scene_min_results)

    def test_check_compliance_scene_words_max_fails_when_above(self):
        stats = PacingStats(scene_word_counts=[2200, 700], chapter_word_count=2900)
        results = PacingAnalyzer().check_compliance(stats, self.PACING)
        scene_max_results = [r for r in results if r.metric.startswith("scene_words.max#")]
        assert len(scene_max_results) == 2
        assert any(not r.passed for r in scene_max_results)
        # The failing one is scene #1 with 2200 chars (above max=2000).
        failing = next(r for r in scene_max_results if not r.passed)
        assert failing.actual == "2200"
        assert failing.metric == "scene_words.max#1"

    def test_check_compliance_action_ratio_uses_tolerance_window(self):
        # 0.45 target, ±30% → pass range [0.315, 0.585]
        for actual, expected_pass in [(0.40, True), (0.60, False), (0.30, False)]:
            stats = PacingStats(action_ratio=actual, chapter_word_count=1000, scene_word_counts=[1000])
            results = PacingAnalyzer().check_compliance(stats, self.PACING)
            ratio_result = next(r for r in results if r.metric == "action_ratio")
            assert ratio_result.passed is expected_pass, f"actual={actual}"

    def test_check_compliance_max_consecutive_non_action_one_sided(self):
        for actual, expected_pass in [(2, True), (3, False), (1, True)]:
            stats = PacingStats(
                max_consecutive_non_action=actual,
                chapter_word_count=1000,
                scene_word_counts=[1000],
            )
            results = PacingAnalyzer().check_compliance(stats, self.PACING)
            mcna = next(r for r in results if r.metric == "max_consecutive_non_action")
            assert mcna.passed is expected_pass, f"actual={actual}"

    def test_check_compliance_min_beats_one_sided_actual_must_meet_target(self):
        for actual, expected_pass in [(1.5, True), (2.0, True), (1.0, False)]:
            stats = PacingStats(
                sf_log_tags_per_1k=actual,
                chapter_word_count=1000,
                scene_word_counts=[1000],
            )
            results = PacingAnalyzer().check_compliance(stats, self.PACING)
            beats = next(r for r in results if r.metric == "min_beats_per_1k")
            assert beats.passed is expected_pass, f"actual={actual}"


class TestPromptWiring:
    """Task 4 — chapter-level pacing injection into the planner outline prompts."""

    @staticmethod
    def _load_prompt(name: str) -> dict:
        # Canonical prompt loader used across the codebase (3-tier YAML → global
        # → project merge). With no override stores passed it is YAML-only.
        from backend.services.prompt_override_store import load_prompt_effective

        return load_prompt_effective(name)

    def test_resolve_genre_pacing_includes_chapter_words_and_interval(self):
        from backend.agents.planner import _resolve_genre_pacing

        text = _resolve_genre_pacing("xianxia")
        # xianxia: chapter_words 3000-7000, escalation_interval 5, min_beats_per_1k 1.2
        assert "3000" in text and "7000" in text
        assert "5" in text  # escalation_interval
        assert "1.2" in text  # min_beats_per_1k

    def test_novel_outline_prompt_has_genre_pacing_placeholder(self):
        prompt = self._load_prompt("novel_outline_generation")
        assert "{genre_pacing}" in prompt.get("user_prompt_template", "")

    def test_outline_prompt_has_genre_pacing_placeholder(self):
        prompt = self._load_prompt("outline_generation")
        assert "{genre_pacing}" in prompt.get("user_prompt_template", "")

    def test_resolve_genre_pacing_returns_empty_when_catalog_raises(self):
        """Exception path: catalog unavailable → "" instead of propagating."""
        import unittest.mock

        from backend.agents.planner import _resolve_genre_pacing

        def _raise():
            raise RuntimeError("test catalog unavailable")

        with unittest.mock.patch("backend.genres.catalog.get_catalog", _raise):
            assert _resolve_genre_pacing("xianxia") == ""

        # Unknown genre falls back to the first index entry — must not raise.
        assert isinstance(_resolve_genre_pacing("__definitely_not_a_genre__"), str)

    # --- Task 5: scene-level pacing injection into writer.scene_writing ---

    def test_resolve_genre_scene_pacing_includes_four_scene_fields(self):
        from backend.agents.writer import _resolve_genre_scene_pacing

        text = _resolve_genre_scene_pacing("xianxia")
        # xianxia: scene_words 600-2500, action_ratio 0.35, max_consecutive_non_action 3, min_beats_per_1k 1.2
        assert "600" in text and "2500" in text
        assert "0.35" in text
        assert "3" in text
        assert "1.2" in text
        # escalation_interval is chapter-level — must NOT appear
        assert "升级间隔" not in text

    def test_scene_writing_prompt_has_genre_pacing_scene_placeholder(self):
        # Use the canonical loader discovered in T4
        from backend.services.prompt_override_store import load_prompt_effective

        prompt = load_prompt_effective("scene_writing")
        assert "{genre_pacing_scene}" in prompt.get("user_prompt_template", "")
