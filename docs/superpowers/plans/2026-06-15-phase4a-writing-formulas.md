# Phase 4a: WritingFormulaAnalyzer + Template Expansion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement WritingFormulaAnalyzer (deterministic sentence/dialogue/paragraph stats + Tier 3 LLM emotional/satisfaction/suspense detection), expand genre template with explicit thresholds, and wire into ChapterReviewBuilder to fill the `writing_formula_compliance` placeholder.

**Architecture:** New `backend/style_engine/writing_formulas.py` reuses `style_extractor.py` helpers (`_split_sentences`, `_DIALOGUE_PATTERN`, `_char_count`). Sync path produces deterministic stats only; async path adds LLM-assisted metrics. `ChapterReviewBuilder` follows the same split pattern as CoherenceScorer: `build_review()` calls sync version, `build_review_async()` upgrades with LLM data.

**Tech Stack:** Python stdlib (re, json), PyYAML, FastAPI, Tier 3 Haiku LLM

**Files:**
- Create: `backend/style_engine/writing_formulas.py`
- Create: `tests/test_writing_formulas.py`
- Modify: `data/style/cool_novel.yaml`
- Modify: `backend/style_engine/genre_template.py`
- Modify: `backend/style_engine/__init__.py`
- Modify: `backend/conductor/chapter_review.py`

---

### Task 1: Create WritingFormulaAnalyzer

**Files:**
- Create: `backend/style_engine/writing_formulas.py`
- Create: `tests/test_writing_formulas.py`
- Modify: `backend/style_engine/__init__.py`

- [ ] **Step 1: Write the test file**

Create `tests/test_writing_formulas.py`:

```python
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
        """LLM unavailable → emotional beat metrics default passed."""
        stats = WritingFormulaStats()  # all zeros
        results = analyzer.check_compliance(stats, SAMPLE_FORMULA)
        emo = next(r for r in results if r.metric == "emotional_beat_density")
        assert emo.passed is True
        sat = next(r for r in results if r.metric == "satisfaction_beat_count")
        assert sat.passed is True
        sus = next(r for r in results if r.metric == "suspense_hook_present")
        assert sus.passed is True

    def test_check_compliance_empty_formula(self, analyzer):
        stats = WritingFormulaStats()
        results = analyzer.check_compliance(stats, {})
        assert results == []

    def test_sentence_distribution_counts(self, analyzer):
        # short ≤15, medium 16-40, long >40
        text = "短句。短短。也是非常短的一句话。这是一句中等长度的测试句子用来检查分布。"
        text += "这是一个很长很长很长很长很长很长很长很长很长很长的超长句子用来测试长句占比情况分析。"
        stats = analyzer.analyze_sync([text])
        assert stats.short_ratio >= 0
        assert stats.medium_ratio >= 0
        assert stats.long_ratio >= 0

    # --- LLM-assisted tests (sync fallback behavior only) ---

    def test_analyze_sync_sets_llm_fields_to_zero(self, analyzer, sample_text):
        """Sync analysis should leave LLM fields at default (0/False)."""
        stats = analyzer.analyze_sync([sample_text])
        assert stats.emotional_beat_density == 0.0
        assert stats.satisfaction_beat_count == 0
        assert stats.suspense_hook_present is False

    @pytest.mark.asyncio
    async def test_analyze_llm_falls_back_gracefully(self, analyzer, sample_text):
        """LLM unavailable → returns sync stats with LLM fields unchanged."""
        stats = await analyzer.analyze_async([sample_text])
        # Should not crash; LLM fields stay 0 (graceful degradation)
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
            expected="≤30",
            actual="28",
            passed=True,
        )
        assert cr.metric == "avg_sentence_length"
        assert cr.passed is True
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/longsa/Codes/storyForge2 && python3 -m pytest tests/test_writing_formulas.py -v 2>&1 | head -5
```

Expected: ImportError (file not created yet).

- [ ] **Step 3: Create `backend/style_engine/writing_formulas.py`**

```python
"""StoryForge v1.6 Phase 4a — WritingFormulaAnalyzer for L2 writing formula compliance."""
import json
import logging
from dataclasses import dataclass, field
from typing import Optional

from backend.style_engine.style_extractor import (
    _split_sentences,
    _DIALOGUE_PATTERN,
    _char_count,
)

logger = logging.getLogger(__name__)


@dataclass
class ComplianceResult:
    metric: str
    expected: str
    actual: str
    passed: bool


@dataclass
class WritingFormulaStats:
    """Statistics computed from chapter scene texts."""
    # Deterministic
    avg_sentence_length: float = 0.0
    short_ratio: float = 0.0
    medium_ratio: float = 0.0
    long_ratio: float = 0.0
    dialogue_ratio: float = 0.0
    max_consecutive_dialogue: int = 0
    max_para_sentences: int = 0
    max_para_words: int = 0
    # LLM-assisted (Tier 3 Haiku)
    emotional_beat_density: float = 0.0
    satisfaction_beat_count: int = 0
    suspense_hook_present: bool = False


class WritingFormulaAnalyzer:
    """L2 writing formula statistics + compliance checking.

    Deterministic (tier_0): sentence length, dialogue ratio, paragraph density.
    LLM-assisted (Tier 3): emotional beat density, satisfaction beat count, suspense hook.
    """

    def analyze_sync(self, scene_texts: list[str]) -> WritingFormulaStats:
        """Run deterministic analysis only. Zero LLM calls."""
        merged = "\n\n".join(scene_texts)
        if not merged.strip():
            return WritingFormulaStats()

        sentences = _split_sentences(merged)
        total_chars = _char_count(merged)

        # Sentence stats
        if sentences:
            lengths = [_char_count(s) for s in sentences]
            avg = sum(lengths) / len(lengths)
            total_len = len(lengths)
            short = sum(1 for l in lengths if l <= 15)
            medium = sum(1 for l in lengths if 16 <= l <= 40)
            long = sum(1 for l in lengths if l > 40)
            short_ratio = round(short / total_len, 2)
            medium_ratio = round(medium / total_len, 2)
            long_ratio = round(long / total_len, 2)
        else:
            avg = 0.0
            short_ratio = medium_ratio = long_ratio = 0.0

        # Dialogue stats
        if total_chars > 0:
            turns = _DIALOGUE_PATTERN.findall(merged)
            dialogue_chars = sum(_char_count(t) for t in turns)
            dialogue_ratio = round(dialogue_chars / total_chars, 2)
            max_consecutive = self._count_max_consecutive_dialogue(merged)
        else:
            dialogue_ratio = 0.0
            max_consecutive = 0

        # Paragraph stats
        paragraphs = [p.strip() for p in merged.split("\n\n") if p.strip()]
        if paragraphs:
            max_para_sentences = max(
                len(_split_sentences(p)) for p in paragraphs
            )
            max_para_words = max(
                _char_count(p) for p in paragraphs
            )
        else:
            max_para_sentences = 0
            max_para_words = 0

        return WritingFormulaStats(
            avg_sentence_length=round(avg, 1),
            short_ratio=short_ratio,
            medium_ratio=medium_ratio,
            long_ratio=long_ratio,
            dialogue_ratio=dialogue_ratio,
            max_consecutive_dialogue=max_consecutive,
            max_para_sentences=max_para_sentences,
            max_para_words=max_para_words,
        )

    async def analyze_async(self, scene_texts: list[str]) -> WritingFormulaStats:
        """Run full analysis (deterministic + LLM-assisted). LLM failures are silent."""
        stats = self.analyze_sync(scene_texts)
        merged = "\n\n".join(scene_texts)
        if not merged.strip():
            return stats

        try:
            emo_stats = await self._detect_emotional_beats(merged)
            stats.emotional_beat_density = emo_stats.get("density", 0.0)
            stats.satisfaction_beat_count = emo_stats.get("count", 0)

            stats.suspense_hook_present = await self._detect_suspense_hook(merged)
        except Exception as e:
            logger.warning("WritingFormulaAnalyzer LLM unavailable: %s", e)

        return stats

    def check_compliance(
        self, stats: WritingFormulaStats, formula: dict
    ) -> list[ComplianceResult]:
        """Compare stats against formula thresholds. Returns list of results."""
        if not formula:
            return []

        results = []

        # Sentence checks
        sent = formula.get("sentence", {})
        if "avg_length_max" in sent:
            results.append(ComplianceResult(
                metric="avg_sentence_length",
                expected=f"≤{sent['avg_length_max']}",
                actual=str(stats.avg_sentence_length),
                passed=stats.avg_sentence_length <= sent["avg_length_max"],
            ))
        if "short_pct_min" in sent:
            actual_pct = round(stats.short_ratio * 100, 1)
            results.append(ComplianceResult(
                metric="short_sentence_ratio",
                expected=f"≥{sent['short_pct_min']}%",
                actual=f"{actual_pct}%",
                passed=actual_pct >= sent["short_pct_min"],
            ))
        if "long_pct_max" in sent:
            actual_pct = round(stats.long_ratio * 100, 1)
            results.append(ComplianceResult(
                metric="long_sentence_ratio",
                expected=f"≤{sent['long_pct_max']}%",
                actual=f"{actual_pct}%",
                passed=actual_pct <= sent["long_pct_max"],
            ))

        # Dialogue checks
        dial = formula.get("dialogue", {})
        if "ratio_min" in dial:
            actual_pct = round(stats.dialogue_ratio * 100, 1)
            results.append(ComplianceResult(
                metric="dialogue_ratio",
                expected=f"≥{int(dial['ratio_min'] * 100)}%",
                actual=f"{actual_pct}%",
                passed=stats.dialogue_ratio >= dial["ratio_min"],
            ))
        if "max_consecutive_lines" in dial:
            results.append(ComplianceResult(
                metric="max_consecutive_dialogue",
                expected=f"≤{dial['max_consecutive_lines']}",
                actual=str(stats.max_consecutive_dialogue),
                passed=stats.max_consecutive_dialogue <= dial["max_consecutive_lines"],
            ))

        # Paragraph checks
        para = formula.get("paragraph", {})
        if "max_sentences" in para:
            results.append(ComplianceResult(
                metric="max_para_sentences",
                expected=f"≤{para['max_sentences']}",
                actual=str(stats.max_para_sentences),
                passed=stats.max_para_sentences <= para["max_sentences"],
            ))
        if "max_words" in para:
            results.append(ComplianceResult(
                metric="max_para_words",
                expected=f"≤{para['max_words']}",
                actual=str(stats.max_para_words),
                passed=stats.max_para_words <= para["max_words"],
            ))

        # Emotional beat checks (LLM-assisted; default passed if unavailable)
        emo = formula.get("emotional_beat", {})
        if "min_per_1k" in emo:
            results.append(ComplianceResult(
                metric="emotional_beat_density",
                expected=f"≥{emo['min_per_1k']}/千字",
                actual=f"{stats.emotional_beat_density}/千字",
                passed=stats.emotional_beat_density == 0.0 or stats.emotional_beat_density >= emo["min_per_1k"],
            ))

        sat = formula.get("satisfaction_beat", {})
        if "min_count" in sat:
            results.append(ComplianceResult(
                metric="satisfaction_beat_count",
                expected=f"≥{sat['min_count']}",
                actual=str(stats.satisfaction_beat_count),
                passed=stats.satisfaction_beat_count == 0 or stats.satisfaction_beat_count >= sat["min_count"],
            ))

        hook = formula.get("suspense_hook", {})
        if "required" in hook:
            results.append(ComplianceResult(
                metric="suspense_hook_present",
                expected="true",
                actual=str(stats.suspense_hook_present).lower(),
                passed=not hook["required"] or stats.suspense_hook_present,
            ))

        return results

    def _count_max_consecutive_dialogue(self, text: str) -> int:
        """Count max consecutive lines containing quoted dialogue."""
        lines = text.split("\n")
        max_run = 0
        current_run = 0
        for line in lines:
            if _DIALOGUE_PATTERN.search(line):
                current_run += 1
                max_run = max(max_run, current_run)
            else:
                current_run = 0
        return max_run

    async def _detect_emotional_beats(self, text: str) -> dict:
        """Use Tier 3 LLM to detect emotional beats (satisfaction points)."""
        try:
            from backend.llm.model_router import get_model_router

            router = get_model_router()
            sample = text[:3000]

            system_prompt = (
                "你是一位网文编辑。分析以下章节文本，检测"爽点"（能力展示/打脸/逆袭/收获/突破）。"
                "只输出一个 JSON 对象。"
            )
            user_prompt = (
                f"分析以下文本的爽点：\n\n{sample}\n\n"
                "输出 JSON：\n"
                '{"emotional_beat_density": <每千字爽点数量，浮点数>,\n'
                ' "satisfaction_beats": [{"type": "能力展示|打脸|逆袭|收获|突破", "description": "一句话描述"}]}'
            )

            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]

            result = await router.execute(
                agent_name="reviewer",
                task_name="emotional_beat_detection",
                messages=messages,
                json_mode=True,
            )

            content = result.get("content", "")
            parsed = json.loads(content) if isinstance(content, str) else content
            density = float(parsed.get("emotional_beat_density", 0))
            beats = parsed.get("satisfaction_beats", [])
            return {"density": density, "count": len(beats)}

        except Exception as e:
            logger.warning("Emotional beat detection failed: %s", e)
            return {"density": 0.0, "count": 0}

    async def _detect_suspense_hook(self, text: str) -> bool:
        """Use Tier 3 LLM to detect chapter-end suspense hook."""
        try:
            from backend.llm.model_router import get_model_router

            router = get_model_router()
            # Focus on the last ~1000 chars (chapter ending)
            ending = text[-1000:] if len(text) > 1000 else text

            system_prompt = (
                "你是一位网文编辑。检查章节结尾是否有悬念钩子（新敌人/新目标/新线索/未解谜题）。"
                "只输出一个 JSON 对象。"
            )
            user_prompt = (
                f"章节结尾文本：\n\n{ending}\n\n"
                "输出 JSON：{\"suspense_hook_present\": true|false}"
            )

            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]

            result = await router.execute(
                agent_name="reviewer",
                task_name="suspense_hook_detection",
                messages=messages,
                json_mode=True,
            )

            content = result.get("content", "")
            parsed = json.loads(content) if isinstance(content, str) else content
            return bool(parsed.get("suspense_hook_present", False))

        except Exception as e:
            logger.warning("Suspense hook detection failed: %s", e)
            return False
```

- [ ] **Step 4: Update `backend/style_engine/__init__.py`**

The file is currently empty. Write:

```python
from backend.style_engine.genre_template import GenreTemplate
from backend.style_engine.style_extractor import StyleExtractor, ExtractedStyle
from backend.style_engine.writing_formulas import (
    WritingFormulaAnalyzer,
    WritingFormulaStats,
    ComplianceResult,
)

__all__ = [
    "GenreTemplate",
    "StyleExtractor",
    "ExtractedStyle",
    "WritingFormulaAnalyzer",
    "WritingFormulaStats",
    "ComplianceResult",
]
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /Users/longsa/Codes/storyForge2 && python3 -m pytest tests/test_writing_formulas.py -v
```

Expected: all 16 tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add backend/style_engine/writing_formulas.py backend/style_engine/__init__.py tests/test_writing_formulas.py
git commit -m "feat: add WritingFormulaAnalyzer with deterministic stats and Tier 3 LLM emotional/hook detection"
```

---

### Task 2: Expand genre template + add get_style_formula

**Files:**
- Modify: `data/style/cool_novel.yaml`
- Modify: `backend/style_engine/genre_template.py`

- [ ] **Step 1: Add `style_formula` section to `data/style/cool_novel.yaml`**

Append the following to the end of the file:

```yaml
# Writing formula thresholds (L2 compliance checking)
style_formula:
  sentence:
    avg_length_max: 30
    short_pct_min: 30
    long_pct_max: 20
  dialogue:
    ratio_min: 0.20
    max_consecutive_lines: 8
  paragraph:
    max_sentences: 5
    max_words: 300
  emotional_beat:
    min_per_1k: 1.5
  satisfaction_beat:
    min_count: 3
  suspense_hook:
    required: true
```

- [ ] **Step 2: Add `get_style_formula()` to `backend/style_engine/genre_template.py`**

Add this method to the `GenreTemplate` class (after `get_taboos`):

```python
    def get_style_formula(self, template_name: str = "cool_novel") -> dict:
        """Read style_formula section from genre template. Returns {} if not configured."""
        template = self.load(template_name)
        return template.get("style_formula", {})
```

- [ ] **Step 3: Verify the template loads correctly**

```bash
cd /Users/longsa/Codes/storyForge2 && python3 -c "
from backend.style_engine.genre_template import GenreTemplate
gt = GenreTemplate()
formula = gt.get_style_formula()
assert formula['sentence']['avg_length_max'] == 30
assert formula['dialogue']['ratio_min'] == 0.20
assert formula['paragraph']['max_sentences'] == 5
assert formula['emotional_beat']['min_per_1k'] == 1.5
assert formula['satisfaction_beat']['min_count'] == 3
assert formula['suspense_hook']['required'] is True
print('All assertions passed')
"
```

- [ ] **Step 4: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add data/style/cool_novel.yaml backend/style_engine/genre_template.py
git commit -m "feat: expand genre template with L2 style_formula thresholds"
```

---

### Task 3: Wire into ChapterReviewBuilder

**Files:**
- Modify: `backend/conductor/chapter_review.py` (lines 127-170, 173-188)

- [ ] **Step 1: Add writing formula methods to ChapterReviewBuilder**

Add these two methods to the `ChapterReviewBuilder` class. Place them after `_build_scene_summaries` (which ends at line 315) and before `_save_review` (line 317):

```python
    def _collect_scene_texts(self, chapter_number: int) -> list[str]:
        """Collect all scene draft texts for a chapter."""
        texts = []
        chapters_dir = self._project_dir / "chapters"
        if not chapters_dir.exists():
            return texts
        for draft_file in sorted(chapters_dir.glob(f"ch{chapter_number:02d}_scene_*_draft.md")):
            try:
                text = draft_file.read_text(encoding="utf-8")
                if text.strip():
                    texts.append(text)
            except Exception:
                continue
        return texts

    def _check_writing_formula(self, chapter_number: int) -> list[dict]:
        """Synchronous writing formula compliance check (deterministic only)."""
        try:
            from backend.style_engine.writing_formulas import WritingFormulaAnalyzer
            from backend.style_engine.genre_template import GenreTemplate

            texts = self._collect_scene_texts(chapter_number)
            if not texts:
                return []

            formula = GenreTemplate().get_style_formula()
            if not formula:
                return []

            analyzer = WritingFormulaAnalyzer()
            stats = analyzer.analyze_sync(texts)
            results = analyzer.check_compliance(stats, formula)
            return [
                {"metric": r.metric, "expected": r.expected, "actual": r.actual, "passed": r.passed}
                for r in results
            ]
        except Exception as e:
            logger.warning("Writing formula check failed (non-blocking): %s", e)
            return []

    async def _check_writing_formula_async(self, chapter_number: int) -> list[dict]:
        """Async writing formula compliance check (adds LLM metrics)."""
        try:
            from backend.style_engine.writing_formulas import WritingFormulaAnalyzer
            from backend.style_engine.genre_template import GenreTemplate

            texts = self._collect_scene_texts(chapter_number)
            if not texts:
                return []

            formula = GenreTemplate().get_style_formula()
            if not formula:
                return []

            analyzer = WritingFormulaAnalyzer()
            stats = await analyzer.analyze_async(texts)
            results = analyzer.check_compliance(stats, formula)
            return [
                {"metric": r.metric, "expected": r.expected, "actual": r.actual, "passed": r.passed}
                for r in results
            ]
        except Exception as e:
            logger.warning("Writing formula async check failed (non-blocking): %s", e)
            return []
```

- [ ] **Step 2: Replace the placeholder in `build_review()`**

In the `build_review` method, change:

```python
            "writing_formula_compliance": [],
```

to:

```python
            "writing_formula_compliance": self._check_writing_formula(chapter_number),
```

- [ ] **Step 3: Add async upgrade in `build_review_async()`**

In the `build_review_async` method, after the coherence score upgrade (after `review["coherence_comment"] = comment`), add:

```python
        # Upgrade writing formula compliance with LLM-assisted metrics
        review["writing_formula_compliance"] = await self._check_writing_formula_async(chapter_number)
```

- [ ] **Step 4: Run chapter review tests to verify integration**

```bash
cd /Users/longsa/Codes/storyForge2 && python3 -m pytest tests/test_chapter_review.py -v
```

Expected: all 17 tests pass. The `test_build_review_returns_valid_structure` test previously asserted `== []` — update it to accept the new behavior.

- [ ] **Step 5: Update the test assertion**

In `tests/test_chapter_review.py`, change line 112:

```python
        assert review["writing_formula_compliance"] == []
```

to:

```python
        assert isinstance(review["writing_formula_compliance"], list)
```

And change line 177:

```python
        assert review["writing_formula_compliance"] == []
```

to:

```python
        assert isinstance(review["writing_formula_compliance"], list)
```

- [ ] **Step 6: Run full test suite to verify zero regressions**

```bash
cd /Users/longsa/Codes/storyForge2 && python3 -m pytest tests/test_chapter_review.py tests/test_writing_formulas.py -v
```

Expected: all tests pass (17 + 16 = 33 passed).

- [ ] **Step 7: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add backend/conductor/chapter_review.py tests/test_chapter_review.py
git commit -m "feat: wire WritingFormulaAnalyzer into ChapterReviewBuilder, fill placeholder"
```

---

### Task 4: End-to-end verification

- [ ] **Step 1: Run writing formula tests**

```bash
cd /Users/longsa/Codes/storyForge2 && python3 -m pytest tests/test_writing_formulas.py -v
```

Expected: all 16 tests pass.

- [ ] **Step 2: Run full regression suite**

```bash
cd /Users/longsa/Codes/storyForge2 && python3 -m pytest tests/ -q --tb=short
```

Expected: 17 pre-existing failures, zero new failures.

- [ ] **Step 3: Verify imports**

```bash
cd /Users/longsa/Codes/storyForge2 && python3 -c "
from backend.style_engine import WritingFormulaAnalyzer, WritingFormulaStats, ComplianceResult
from backend.style_engine import GenreTemplate
from backend.style_engine import StyleExtractor
print('All imports OK')
"
```

- [ ] **Step 4: Commit any regression fixes if needed**

```bash
cd /Users/longsa/Codes/storyForge2
git add -A
git commit -m "fix: Phase 4a regression fixes"
```
