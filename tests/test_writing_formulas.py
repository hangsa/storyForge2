"""Tests for WritingFormulaAnalyzer (Phase 4a)."""
import pytest
from backend.style_engine.writing_formulas import (
    WritingFormulaAnalyzer,
    WritingFormulaStats,
    ComplianceResult,
)


SAMPLE_FORMULA = {
    "sentence": {"avg_length_max": 30, "short_pct_min": 30, "long_pct_max": 20},
    "dialogue": {"ratio_min": 0.20, "max_consecutive_lines": 8},
    "paragraph": {"max_sentences": 5, "max_words": 300},
    "emotional_beat": {"min_per_1k": 1.5},
    "satisfaction_beat": {"min_count": 3},
    "suspense_hook": {"required": True},
}


class TestWritingFormulaAnalyzer:
    @pytest.fixture
    def analyzer(self):
        return WritingFormulaAnalyzer()

    @pytest.fixture
    def sample_text(self):
        return (
            "主角深吸一口气，缓缓推开石门。门后是一条幽深的甬道。\n\n"
            "他走在甬道中，心中暗自警惕。突然，前方传来异响。\n\n"
            '"谁在那里？"他喝道。\n'
            '"是我。""你怎么会在这里？""说来话长，先跟我来。"\n'
            '"好吧，但你得告诉我发生了什么。"她低声道，"我在前面发现了敌人的踪迹。"\n'
            '"明白了。我们走。"林峰点头，"小心背后。"\n'
        )

    # --- Deterministic tests ---

    def test_analyze_sync_returns_stats(self, analyzer, sample_text):
        stats = analyzer.analyze_sync([sample_text])
        assert isinstance(stats, WritingFormulaStats)
        assert stats.avg_sentence_length > 0
        assert 0 <= stats.dialogue_ratio <= 1

    def test_analyze_sync_empty_text(self, analyzer):
        stats = analyzer.analyze_sync([""])
        assert stats.avg_sentence_length == 0.0
        assert stats.dialogue_ratio == 0.0

    def test_analyze_sync_empty_list(self, analyzer):
        stats = analyzer.analyze_sync([])
        assert stats.avg_sentence_length == 0.0

    def test_avg_sentence_length(self, analyzer):
        text = "今天天气很好。我去公园散步。"
        stats = analyzer.analyze_sync([text])
        assert stats.avg_sentence_length > 0

    def test_dialogue_detection(self, analyzer):
        text = '主角说："你好。"对方回应："你也好。"'
        stats = analyzer.analyze_sync([text])
        assert stats.dialogue_ratio > 0

    def test_max_consecutive_dialogue_lines(self, analyzer):
        text = '"A。"\n"B。"\n"C。"\n"D。"\n"E。"\n"F。"\n"G。"\n"H。"\n"I。"'
        stats = analyzer.analyze_sync([text])
        assert stats.max_consecutive_dialogue >= 9

    def test_paragraph_stats(self, analyzer):
        text = "第一段。\n\n第二段。\n\n第三段。"
        stats = analyzer.analyze_sync([text])
        assert stats.max_para_sentences >= 1
        assert stats.max_para_words > 0

    def test_multiple_scenes_merged(self, analyzer):
        stats = analyzer.analyze_sync(["文本一。", "文本二。"])
        assert stats.avg_sentence_length > 0

    # --- Compliance tests ---

    def test_check_compliance_all_pass(self, analyzer):
        stats = WritingFormulaStats(
            avg_sentence_length=25.0,
            short_ratio=0.35,
            long_ratio=0.15,
            dialogue_ratio=0.30,
            max_consecutive_dialogue=4,
            max_para_sentences=3,
            max_para_words=200,
            emotional_beat_density=2.0,
            satisfaction_beat_count=4,
            suspense_hook_present=True,
        )
        results = analyzer.check_compliance(stats, SAMPLE_FORMULA)
        assert all(r.passed for r in results)
        assert len(results) >= 9

    def test_check_compliance_avg_length_fails(self, analyzer):
        stats = WritingFormulaStats(avg_sentence_length=50.0)
        results = analyzer.check_compliance(stats, SAMPLE_FORMULA)
        avg_result = next(r for r in results if r.metric == "avg_sentence_length")
        assert avg_result.passed is False

    def test_check_compliance_dialogue_ratio_fails(self, analyzer):
        stats = WritingFormulaStats(dialogue_ratio=0.05)
        results = analyzer.check_compliance(stats, SAMPLE_FORMULA)
        dr_result = next(r for r in results if r.metric == "dialogue_ratio")
        assert dr_result.passed is False

    def test_check_compliance_emo_beats_passed_when_zero(self, analyzer):
        """LLM unavailable -> emotional beat metrics default passed."""
        stats = WritingFormulaStats()  # all zeros, llm_available=False
        results = analyzer.check_compliance(stats, SAMPLE_FORMULA)
        emo = next(r for r in results if r.metric == "emotional_beat_density")
        assert emo.passed is True
        sat = next(r for r in results if r.metric == "satisfaction_beat_count")
        assert sat.passed is True
        sus = next(r for r in results if r.metric == "suspense_hook_present")
        assert sus.passed is True

    def test_check_compliance_llm_available_density_zero_fails(self, analyzer):
        """BUG REGRESSION: LLM was available and returned density=0
        (chapter really has no emotional beats). The check must FAIL,
        not silently auto-pass.
        """
        stats = WritingFormulaStats(
            llm_available=True,
            emotional_beat_density=0.0,
        )
        results = analyzer.check_compliance(stats, SAMPLE_FORMULA)
        emo = next(r for r in results if r.metric == "emotional_beat_density")
        assert emo.passed is False, (
            "When LLM is available and reports density=0, the check must fail. "
            "Auto-passing here would silently mask chapters with no emotional beats."
        )

    def test_check_compliance_llm_available_satisfaction_zero_fails(self, analyzer):
        """BUG REGRESSION: LLM available + count=0 must fail (real zero, not LLM down)."""
        stats = WritingFormulaStats(
            llm_available=True,
            satisfaction_beat_count=0,
        )
        results = analyzer.check_compliance(stats, SAMPLE_FORMULA)
        sat = next(r for r in results if r.metric == "satisfaction_beat_count")
        assert sat.passed is False

    def test_check_compliance_llm_available_hook_absent_fails(self, analyzer):
        """BUG REGRESSION: LLM available + no hook must fail."""
        stats = WritingFormulaStats(
            llm_available=True,
            suspense_hook_present=False,
        )
        results = analyzer.check_compliance(stats, SAMPLE_FORMULA)
        sus = next(r for r in results if r.metric == "suspense_hook_present")
        assert sus.passed is False

    def test_check_compliance_all_pass_with_llm_available(self, analyzer):
        """All metrics pass when LLM is available and all values meet thresholds."""
        stats = WritingFormulaStats(
            avg_sentence_length=25.0,
            short_ratio=0.35,
            long_ratio=0.15,
            dialogue_ratio=0.30,
            max_consecutive_dialogue=4,
            max_para_sentences=3,
            max_para_words=200,
            llm_available=True,
            emotional_beat_density=2.0,
            satisfaction_beat_count=4,
            suspense_hook_present=True,
        )
        results = analyzer.check_compliance(stats, SAMPLE_FORMULA)
        assert all(r.passed for r in results)

    def test_check_compliance_empty_formula(self, analyzer):
        stats = WritingFormulaStats()
        results = analyzer.check_compliance(stats, {})
        assert results == []

    def test_sentence_distribution_counts(self, analyzer):
        text = "短句。短短。也是非常短的一句话。这是一句中等长度的测试句子用来检查分布。"
        text += "这是一个很长很长很长很长很长很长很长很长很长很长的超长句子用来测试长句占比情况分析。"
        stats = analyzer.analyze_sync([text])
        assert stats.short_ratio >= 0
        assert stats.medium_ratio >= 0
        assert stats.long_ratio >= 0

    # --- LLM-assisted tests (sync fallback behavior only) ---

    def test_analyze_sync_sets_llm_fields_to_zero(self, analyzer, sample_text):
        """Sync analysis should leave LLM fields at default (0/False/llm_unavailable)."""
        stats = analyzer.analyze_sync([sample_text])
        assert stats.emotional_beat_density == 0.0
        assert stats.satisfaction_beat_count == 0
        assert stats.suspense_hook_present is False
        assert stats.llm_available is False  # no LLM attempt in sync path

    @pytest.mark.asyncio
    async def test_analyze_llm_falls_back_gracefully(self, analyzer, sample_text):
        """LLM unavailable -> returns sync stats with LLM fields unchanged."""
        stats = await analyzer.analyze_async([sample_text])
        assert isinstance(stats, WritingFormulaStats)


class TestWritingFormulaStats:
    def test_default_values(self):
        stats = WritingFormulaStats()
        assert stats.avg_sentence_length == 0.0
        assert stats.dialogue_ratio == 0.0
        assert stats.max_consecutive_dialogue == 0
        assert stats.emotional_beat_density == 0.0
        assert stats.satisfaction_beat_count == 0
        assert stats.suspense_hook_present is False


class TestComplianceResult:
    def test_fields(self):
        cr = ComplianceResult(
            metric="avg_sentence_length",
            expected="<=30",
            actual="28",
            passed=True,
        )
        assert cr.metric == "avg_sentence_length"
        assert cr.passed is True
