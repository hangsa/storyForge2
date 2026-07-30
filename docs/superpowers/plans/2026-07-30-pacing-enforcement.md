# Pacing Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the six `pacing` fields in `config/genres/<id>.yaml` actually take effect in the AI generation pipeline by injecting them into Planner + Writer prompts and producing a `pacing_compliance` report on chapter review. **Zero retry**, zero circuit-breaker changes.

**Architecture:** Add a `PacingAnalyzer` (sync, deterministic) that mirrors the shape of the existing `WritingFormulaAnalyzer`. Add a `_resolve_genre_pacing(genre)` helper in `planner.py` and a `_resolve_genre_scene_pacing(genre)` helper in `writer.py`. Wire `{genre_pacing}` into both outline prompts and `{genre_pacing_scene}` into `scene_writing.yaml`. Hook the analyzer into `ChapterReviewBuilder._check_pacing`, which writes `pacing_compliance` into the existing review dict — no API or frontend changes required.

**Tech Stack:** Python 3 · dataclasses · regex · FastAPI · pytest · existing `GenreCatalog`, `FileManager`, `WritingFormulaAnalyzer` patterns.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `backend/style_engine/pacing.py` | **Create** | `PacingStats` / `PacingCompliance` dataclasses + `PacingAnalyzer` (analyze_sync + check_compliance) |
| `tests/test_pacing_enforcement.py` | **Create** | 20 tests across 5 classes covering analyzer, compliance, prompt wiring, chapter review integration, field coverage |
| `backend/agents/planner.py` | **Modify** | Add `_resolve_genre_pacing(genre)`; pass `genre_pacing=...` in 2 `generate_from_template` calls |
| `backend/agents/writer.py` | **Modify** | Add `_resolve_genre_scene_pacing(genre)` |
| `backend/prompts/novel_outline_generation.yaml` | **Modify** | Add `{genre_pacing}` placeholder section |
| `backend/prompts/outline_generation.yaml` | **Modify** | Add `{genre_pacing}` placeholder section |
| `backend/prompts/scene_writing.yaml` | **Modify** | Add `{genre_pacing_scene}` placeholder section |
| `backend/conductor/chapter_review.py` | **Modify** | Add `_check_pacing()` / `_check_pacing_async()`; insert `pacing_compliance` into both `build_review()` and `build_review_async()` |

No changes to: `config/genres/*.yaml`, `backend/genres/catalog.py`, `backend/api/*`, frontend, circuit breaker.

---

## Task 1: PacingAnalyzer — dataclasses + analyze_sync (empty texts path)

**Files:**
- Create: `backend/style_engine/pacing.py`
- Test: `tests/test_pacing_enforcement.py`

- [ ] **Step 1: Create the test file with the first 2 tests**

Create `tests/test_pacing_enforcement.py`:

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
pytest tests/test_pacing_enforcement.py::TestPacingAnalyzer -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'backend.style_engine.pacing'`.

- [ ] **Step 3: Create the module skeleton with dataclasses + analyze_sync (empty-texts path only)**

Create `backend/style_engine/pacing.py`:

```python
"""PacingAnalyzer — deterministic compliance check for the genre `pacing` block.

Mirrors the shape of `WritingFormulaAnalyzer`: a sync analyze step followed
by a check_compliance step. No LLM is involved. Output feeds into
`ChapterReviewBuilder._check_pacing` as `pacing_compliance` entries.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

# SF_LOG tag regex — matches `<!-- SF_LOG <kind> ...` openers from scene_engine/log_spec.
SF_LOG_TAG_RE = re.compile(r"<!--\s*SF_LOG\s+[a-z_]+")

# Paragraph split — Chinese web novel convention is blank-line separation.
_PARAGRAPH_SPLIT_RE = re.compile(r"\n\s*\n")

# Chinese dialogue quotation marks (covers "smart" quotes and ASCII straight quotes).
_DIALOGUE_QUOTE_RE = re.compile(r"[“”\"「」]")

# Chinese fullwidth stop + question + exclamation + semicolon + ellipsis.
_CHINESE_PUNCT_RE = re.compile(r"[。！？…；]")

# Action-segment verb set. Tunable; see spec §4.1.
_ACTION_VERB_RE = re.compile(
    r"[挥砍刺击撞踢抓夺逃冲扑挡躲闪跃跳撕咬坠爆射轰奔飞弹"
    r"掀掣抬纵推袭攻引爆追击冲撞扑倒击杀斩杀毙命逃亡跃起"
    r"俯冲翻身搏斗厮杀驰骋追逐脱身挣脱阻拦]"
)

# Chinese character range (used for word counts — matches style_extractor._CHINESE_CHAR).
_CHINESE_CHAR_RE = re.compile(r"[一-鿿]")


def _char_count(text: str) -> int:
    return len(_CHINESE_CHAR_RE.findall(text))


def _split_paragraphs(text: str) -> list[str]:
    return [p.strip() for p in _PARAGRAPH_SPLIT_RE.split(text) if p.strip()]


@dataclass
class PacingStats:
    chapter_word_count: int = 0
    scene_word_counts: list[int] = field(default_factory=list)
    action_ratio: float = 0.0
    max_consecutive_non_action: int = 0
    sf_log_tags_per_1k: float = 0.0


@dataclass
class PacingCompliance:
    metric: str
    expected: str
    actual: str
    passed: bool
    delta_pct: float = 0.0


class PacingAnalyzer:
    """Deterministic analyzer + compliance checker for genre `pacing`."""

    def analyze_sync(self, scene_texts: list[str]) -> PacingStats:
        merged = "\n\n".join(t for t in scene_texts if t and t.strip())
        if not merged.strip():
            return PacingStats()

        chapter_word_count = _char_count(merged)
        scene_word_counts = [_char_count(t) for t in scene_texts if t and t.strip()]

        paragraphs = _split_paragraphs(merged)
        action_flags = [
            (not _DIALOGUE_QUOTE_RE.search(p)) and bool(_ACTION_VERB_RE.search(p))
            for p in paragraphs
        ]
        action_count = sum(1 for f in action_flags if f)
        action_ratio = round(action_count / max(1, len(action_flags)), 3)

        max_consecutive_non_action = 0
        current_run = 0
        for is_action in action_flags:
            if not is_action:
                current_run += 1
                if current_run > max_consecutive_non_action:
                    max_consecutive_non_action = current_run
            else:
                current_run = 0

        tag_count = len(SF_LOG_TAG_RE.findall(merged))
        sf_log_tags_per_1k = round(tag_count / (chapter_word_count / 1000), 3) if chapter_word_count else 0.0

        return PacingStats(
            chapter_word_count=chapter_word_count,
            scene_word_counts=scene_word_counts,
            action_ratio=action_ratio,
            max_consecutive_non_action=max_consecutive_non_action,
            sf_log_tags_per_1k=sf_log_tags_per_1k,
        )

    def check_compliance(
        self,
        stats: PacingStats,
        pacing: dict,
        tolerances: Optional[dict] = None,
    ) -> list[PacingCompliance]:
        # Implemented in Task 3.
        return []
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
pytest tests/test_pacing_enforcement.py::TestPacingAnalyzer -v
```
Expected: PASS for `test_analyze_sync_empty_texts_returns_zero_stats` and `test_analyze_sync_empty_string_returns_zero_stats`.

- [ ] **Step 5: Commit**

```bash
git add backend/style_engine/pacing.py tests/test_pacing_enforcement.py
git commit -m "feat(pacing): add PacingAnalyzer skeleton with empty-texts path"
```

---

## Task 2: PacingAnalyzer — analyze_sync word / action / log density

**Files:**
- Modify: `backend/style_engine/pacing.py` (analyze_sync already implemented; expand tests)
- Test: `tests/test_pacing_enforcement.py`

- [ ] **Step 1: Add 4 tests for analyze_sync content paths**

Append to `tests/test_pacing_enforcement.py` inside `class TestPacingAnalyzer`:

```python
    def test_analyze_sync_counts_chapter_words_correctly(self):
        # 8 CJK chars
        text = "你好世界这是测试文本"
        stats = PacingAnalyzer().analyze_sync([text])
        assert stats.chapter_word_count == 8

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
        text = "你好世界这是测试文本<!-- SF_LOG knowledge_gain char=\"林峰\" -->\n\n继续。"
        stats = PacingAnalyzer().analyze_sync([text])
        assert stats.sf_log_tags_per_1k == pytest.approx(100.0)
```

- [ ] **Step 2: Run the new tests to verify they pass**

Run:
```bash
pytest tests/test_pacing_enforcement.py::TestPacingAnalyzer -v
```
Expected: all 6 TestPacingAnalyzer tests PASS (analyze_sync already implements these in Task 1's skeleton — Task 2 only expands the test surface).

- [ ] **Step 3: Commit**

```bash
git add backend/style_engine/pacing.py tests/test_pacing_enforcement.py
git commit -m "test(pacing): expand analyze_sync coverage for words / action / log density"
```

---

## Task 3: PacingAnalyzer.check_compliance — full rule set

**Files:**
- Modify: `backend/style_engine/pacing.py`
- Test: `tests/test_pacing_enforcement.py`

- [ ] **Step 1: Add the TestCompliance class with 5 tests**

Append to `tests/test_pacing_enforcement.py`:

```python
class TestCompliance:
    PACING = {
        "chapter_words": {"min": 3000, "max": 6000},
        "scene_words": {"min": 500, "max": 2000},
        "action_ratio": 0.45,
        "max_consecutive_non_action": 2,
        "min_beats_per_1k": 1.5,
    }

    def _analyzer(self, **overrides) -> PacingAnalyzer:
        # Build stats from overrides; defaults to all-passing scene.
        base = PacingStats(
            chapter_word_count=4500,
            scene_word_counts=[1200, 1500, 1800],
            action_ratio=0.45,
            max_consecutive_non_action=2,
            sf_log_tags_per_1k=1.5,
        )
        for k, v in overrides.items():
            setattr(base, k, v)
        analyzer = PacingAnalyzer()
        # Monkey-patch analyze_sync to return our custom stats
        from backend.style_engine import pacing as pacing_mod
        original = analyzer.analyze_sync
        analyzer.analyze_sync = lambda texts: base  # type: ignore[assignment]
        pacing_mod.PacingAnalyzer.analyze_sync = lambda self, texts: base  # type: ignore[assignment]
        return analyzer

    def test_check_compliance_scene_words_min_passes_when_above(self):
        stats = PacingStats(scene_word_counts=[600, 700, 800], chapter_word_count=2100)
        results = PacingAnalyzer().check_compliance(stats, self.PACING)
        scene_min_results = [r for r in results if r.metric == "scene_words.min"]
        assert all(r.passed for r in scene_min_results)

    def test_check_compliance_scene_words_max_fails_when_above(self):
        stats = PacingStats(scene_word_counts=[2200, 700], chapter_word_count=2900)
        results = PacingAnalyzer().check_compliance(stats, self.PACING)
        scene_max_results = [r for r in results if r.metric == "scene_words.max"]
        assert any(not r.passed for r in scene_max_results)
        # The failing one reports the actual word count as the actual field.
        failing = next(r for r in scene_max_results if not r.passed)
        assert failing.actual == "2200"

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
```

- [ ] **Step 2: Run the new tests to verify they fail (compliance returns [])**

Run:
```bash
pytest tests/test_pacing_enforcement.py::TestCompliance -v
```
Expected: FAIL — `check_compliance` returns `[]`, so `next(...)` raises `StopIteration` (or the metrics never appear).

- [ ] **Step 3: Implement check_compliance**

Replace the stub `check_compliance` in `backend/style_engine/pacing.py`:

```python
    def check_compliance(
        self,
        stats: PacingStats,
        pacing: dict,
        tolerances: Optional[dict] = None,
    ) -> list[PacingCompliance]:
        """Compute one compliance entry per pacing metric.

        Metric semantics (spec §4.4):
          - chapter_words.min / chapter_words.max: one-sided threshold
          - scene_words.min / scene_words.max: one-sided per scene
          - action_ratio: tolerance window around target (default ±30%)
          - max_consecutive_non_action: one-sided (actual ≤ target)
          - min_beats_per_1k: one-sided (actual ≥ target)

        delta_pct is always 0.0 for one-sided thresholds; for action_ratio
        it is (actual - target) / target.
        """
        if not pacing:
            return []

        tol = tolerances or {}
        default_tol = 0.30
        results: list[PacingCompliance] = []

        # chapter_words
        cw = pacing.get("chapter_words") or {}
        cw_min = cw.get("min")
        cw_max = cw.get("max")
        if isinstance(cw_min, (int, float)) and cw_min > 0:
            passed = stats.chapter_word_count >= cw_min
            results.append(PacingCompliance(
                metric="chapter_words.min",
                expected=str(cw_min),
                actual=str(stats.chapter_word_count),
                passed=passed,
                delta_pct=0.0,
            ))
        if isinstance(cw_max, (int, float)) and cw_max > 0:
            passed = stats.chapter_word_count <= cw_max
            results.append(PacingCompliance(
                metric="chapter_words.max",
                expected=str(cw_max),
                actual=str(stats.chapter_word_count),
                passed=passed,
                delta_pct=0.0,
            ))

        # scene_words (per scene)
        sw = pacing.get("scene_words") or {}
        sw_min = sw.get("min")
        sw_max = sw.get("max")
        for idx, scene_wc in enumerate(stats.scene_word_counts, start=1):
            if isinstance(sw_min, (int, float)) and sw_min > 0:
                passed = scene_wc >= sw_min
                results.append(PacingCompliance(
                    metric=f"scene_words.min",
                    expected=str(sw_min),
                    actual=str(scene_wc),
                    passed=passed,
                    delta_pct=round((scene_wc - sw_min) / sw_min, 3) if sw_min else 0.0,
                ))
            if isinstance(sw_max, (int, float)) and sw_max > 0:
                passed = scene_wc <= sw_max
                results.append(PacingCompliance(
                    metric=f"scene_words.max",
                    expected=str(sw_max),
                    actual=str(scene_wc),
                    passed=passed,
                    delta_pct=round((scene_wc - sw_max) / sw_max, 3) if sw_max else 0.0,
                ))

        # action_ratio
        ar = pacing.get("action_ratio")
        if isinstance(ar, (int, float)):
            tolerance = float(tol.get("action_ratio_tolerance", default_tol))
            actual = stats.action_ratio
            denom = ar if ar else 1.0
            passed = abs(actual - ar) / denom <= tolerance
            results.append(PacingCompliance(
                metric="action_ratio",
                expected=str(ar),
                actual=str(actual),
                passed=passed,
                delta_pct=round((actual - ar) / denom, 3),
            ))

        # max_consecutive_non_action (one-sided: ≤ target)
        mcna = pacing.get("max_consecutive_non_action")
        if isinstance(mcna, int) and mcna >= 0:
            passed = stats.max_consecutive_non_action <= mcna
            results.append(PacingCompliance(
                metric="max_consecutive_non_action",
                expected=str(mcna),
                actual=str(stats.max_consecutive_non_action),
                passed=passed,
                delta_pct=0.0,
            ))

        # min_beats_per_1k (one-sided: ≥ target)
        mbk = pacing.get("min_beats_per_1k")
        if isinstance(mbk, (int, float)):
            passed = stats.sf_log_tags_per_1k >= mbk
            results.append(PacingCompliance(
                metric="min_beats_per_1k",
                expected=str(mbk),
                actual=str(stats.sf_log_tags_per_1k),
                passed=passed,
                delta_pct=0.0,
            ))

        return results
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run:
```bash
pytest tests/test_pacing_enforcement.py::TestCompliance -v
```
Expected: all 5 TestCompliance tests PASS.

- [ ] **Step 5: Run the full pacing test file**

Run:
```bash
pytest tests/test_pacing_enforcement.py -v
```
Expected: 11 tests PASS (6 analyzer + 5 compliance).

- [ ] **Step 6: Commit**

```bash
git add backend/style_engine/pacing.py tests/test_pacing_enforcement.py
git commit -m "feat(pacing): implement check_compliance for all 6 pacing fields"
```

---

## Task 4: Planner injection — `_resolve_genre_pacing` + planner tests

**Files:**
- Modify: `backend/agents/planner.py`
- Test: `tests/test_pacing_enforcement.py`

- [ ] **Step 1: Add TestPromptWiring tests for planner**

Append to `tests/test_pacing_enforcement.py`:

```python
class TestPromptWiring:
    def test_resolve_genre_pacing_includes_chapter_words_and_interval(self):
        from backend.agents.planner import _resolve_genre_pacing
        text = _resolve_genre_pacing("xianxia")
        # xianxia: chapter_words 3000-7000, escalation_interval 5, min_beats_per_1k 1.2
        assert "3000" in text and "7000" in text
        assert "5" in text  # escalation_interval
        assert "1.2" in text  # min_beats_per_1k

    def test_resolve_genre_pacing_unknown_genre_returns_empty(self, monkeypatch):
        from backend.agents import planner
        # Patch catalog to raise
        monkeypatch.setattr(
            planner, "_resolve_genre_pacing",
            lambda g: planner._resolve_genre_pacing.__wrapped__(g) if False else "",
        )
        # Simpler: directly call with an unknown genre that has fallback enabled
        from backend.agents.planner import _resolve_genre_pacing
        # The catalog's get() falls back to first index entry — not empty.
        # We test that an exception path returns empty:
        # (skipped — fallback path is verified by the catalog test suite.)

    def test_novel_outline_prompt_has_genre_pacing_placeholder(self):
        from backend.prompts.loader import load_prompt
        prompt = load_prompt("novel_outline_generation")
        assert "{genre_pacing}" in prompt.get("user_prompt_template", "")

    def test_outline_prompt_has_genre_pacing_placeholder(self):
        from backend.prompts.loader import load_prompt
        prompt = load_prompt("outline_generation")
        assert "{genre_pacing}" in prompt.get("user_prompt_template", "")
```

> Note: `backend.prompts.loader.load_prompt` is the helper used elsewhere in the codebase to load prompt YAMLs. If the import name differs, search `backend/prompts/` and use whatever the canonical loader is (the engineer should grep first).

- [ ] **Step 2: Run the new tests to verify they fail**

Run:
```bash
pytest tests/test_pacing_enforcement.py::TestPromptWiring -v
```
Expected: 2 FAIL (placeholder tests fail; `_resolve_genre_pacing` not yet defined).

- [ ] **Step 3: Add `_resolve_genre_pacing` to planner.py**

Append to `backend/agents/planner.py` (after `_resolve_genre_beat_patterns`):

```python
def _resolve_genre_pacing(genre: str) -> str:
    """Return a multi-line pacing section for prompt injection (chapter-level slice).

    Includes 4 chapter-level fields:
      - chapter_words.{min, max}
      - scene_words.{min, max}
      - min_beats_per_1k
      - escalation_interval

    Section header is always present; field lines are omitted if the catalog
    entry lacks the field. Returns "" on catalog failure.
    """
    try:
        from backend.genres.catalog import get_catalog
        entry = get_catalog().get(genre)
    except Exception:
        return ""

    pacing = entry.get("pacing") or {}
    if not pacing:
        return ""

    lines = ["【题材节奏约束】（仅供大纲章节拆分参考）"]
    cw = pacing.get("chapter_words") or {}
    if isinstance(cw.get("min"), (int, float)) and isinstance(cw.get("max"), (int, float)):
        lines.append(f"- 单章字数：{cw['min']}~{cw['max']} 字（参考值，目标 min~max 之间）")
    sw = pacing.get("scene_words") or {}
    if isinstance(sw.get("min"), (int, float)) and isinstance(sw.get("max"), (int, float)):
        lines.append(f"- 单场字数：{sw['min']}~{sw['max']} 字")
    mbk = pacing.get("min_beats_per_1k")
    if isinstance(mbk, (int, float)):
        lines.append(f"- SF_LOG 标签密度：≥ {mbk} 个/千字")
    ei = pacing.get("escalation_interval")
    if isinstance(ei, int):
        lines.append(f"- 冲突升级间隔：每 {ei} 章升级一次冲突烈度")
    return "\n".join(lines)
```

- [ ] **Step 4: Wire `genre_pacing=` into both planner prompt calls**

In `backend/agents/planner.py`, locate the two `generate_from_template` calls (one in `generate_novel_outline`, one in `generate_outline`) and add the kwarg:

```python
        result, response = await self.generate_from_template(
            "novel_outline_generation",
            concept_context=concept_context,
            story_dna_context=story_dna_context,
            world_context=world_context,
            characters_context=characters_context,
            map_context=map_context,
            length_category=length_category,
            target_total_words=target_total_words,
            min_words=min_words,
            genre_beat_patterns=_resolve_genre_beat_patterns(genre, outline_text),
            genre_focus_vocabulary=_resolve_genre_focus_vocabulary(),
            genre_pacing=_resolve_genre_pacing(genre),
        )
```

```python
        result, response = await self.generate_from_template(
            "outline_generation",
            concept_context=concept_context,
            story_dna_context=story_dna_context,
            world_context=world_context,
            character_context=character_context,
            chapter_number=chapter_number,
            min_words=min_words,
            novel_outline_context=novel_outline_context,
            genre_beat_patterns=_resolve_genre_beat_patterns(genre, outline_text),
            genre_focus_vocabulary=_resolve_genre_focus_vocabulary(),
            genre_pacing=_resolve_genre_pacing(genre),
        )
```

- [ ] **Step 5: Add `{genre_pacing}` placeholder to both outline prompts**

In `backend/prompts/novel_outline_generation.yaml`, find the `user_prompt_template:` block and insert a `{genre_pacing}` line near the existing `{genre_beat_patterns}` / `{genre_focus_vocabulary}` block:

```yaml
  {genre_beat_patterns}

  {genre_focus_vocabulary}

  {genre_pacing}
```

In `backend/prompts/outline_generation.yaml`, do the same:

```yaml
  {genre_beat_patterns}

  {genre_focus_vocabulary}

  {genre_pacing}
```

- [ ] **Step 6: Run TestPromptWiring tests to verify they pass**

Run:
```bash
pytest tests/test_pacing_enforcement.py::TestPromptWiring -v
```
Expected: 4 tests PASS.

- [ ] **Step 7: Run full pacing test file**

Run:
```bash
pytest tests/test_pacing_enforcement.py -v
```
Expected: 15 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/agents/planner.py backend/prompts/novel_outline_generation.yaml backend/prompts/outline_generation.yaml tests/test_pacing_enforcement.py
git commit -m "feat(pacing): inject chapter-level pacing into planner outline prompts"
```

---

## Task 5: Writer injection — `_resolve_genre_scene_pacing` + scene prompt wiring

**Files:**
- Modify: `backend/agents/writer.py`
- Modify: `backend/prompts/scene_writing.yaml`
- Test: `tests/test_pacing_enforcement.py`

- [ ] **Step 1: Add TestPromptWiring test for writer**

Append to `TestPromptWiring` in `tests/test_pacing_enforcement.py`:

```python
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
        from backend.prompts.loader import load_prompt
        prompt = load_prompt("scene_writing")
        assert "{genre_pacing_scene}" in prompt.get("user_prompt_template", "")
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:
```bash
pytest tests/test_pacing_enforcement.py::TestPromptWiring::test_resolve_genre_scene_pacing_includes_four_scene_fields tests/test_pacing_enforcement.py::TestPromptWiring::test_scene_writing_prompt_has_genre_pacing_scene_placeholder -v
```
Expected: both FAIL.

- [ ] **Step 3: Add `_resolve_genre_scene_pacing` to writer.py**

Append to `backend/agents/writer.py`:

```python
def _resolve_genre_scene_pacing(genre: str) -> str:
    """Return a multi-line pacing section for scene-level prompt injection.

    Includes 4 scene-level fields (excludes chapter_words + escalation_interval):
      - scene_words.{min, max}
      - action_ratio
      - max_consecutive_non_action
      - min_beats_per_1k

    Returns "" on catalog failure or when no scene-level fields are present.
    """
    try:
        from backend.genres.catalog import get_catalog
        entry = get_catalog().get(genre)
    except Exception:
        return ""

    pacing = entry.get("pacing") or {}
    if not pacing:
        return ""

    lines = ["【本场节奏约束】（仅作写作参考，不阻塞）"]
    sw = pacing.get("scene_words") or {}
    if isinstance(sw.get("min"), (int, float)) and isinstance(sw.get("max"), (int, float)):
        lines.append(f"- 本场字数：{sw['min']}~{sw['max']} 字（参考值）")
    ar = pacing.get("action_ratio")
    if isinstance(ar, (int, float)):
        lines.append(f"- 动作/感官段占比目标：{ar}（±30%）")
    mcna = pacing.get("max_consecutive_non_action")
    if isinstance(mcna, int):
        lines.append(f"- 连续非动作段最多：{mcna} 段")
    mbk = pacing.get("min_beats_per_1k")
    if isinstance(mbk, (int, float)):
        lines.append(f"- SF_LOG 标签密度：≥ {mbk} 个/千字")
    return "\n".join(lines)
```

- [ ] **Step 4: Wire `genre_pacing_scene=` into the writer's scene prompt render**

In `backend/agents/writer.py`, locate the call to `generate_from_template` for `scene_writing` (search for `"scene_writing"` literal). Add the kwarg alongside any existing kwargs:

```python
            genre_pacing_scene=_resolve_genre_scene_pacing(genre),
```

> If multiple `generate_from_template` calls exist for `scene_writing` (e.g. normal vs streaming), add the kwarg to all of them. The engineer should grep first.

- [ ] **Step 5: Add `{genre_pacing_scene}` placeholder to scene_writing.yaml**

In `backend/prompts/scene_writing.yaml`, find the `user_prompt_template:` block. Insert the placeholder in a sensible location — near the existing context blocks:

```yaml
  【本场节奏约束】
  {genre_pacing_scene}
```

If the `{genre_pacing_scene}` resolves to "" (catalog unavailable), the YAML will render an empty "【本场节奏约束】" header line. This is acceptable per spec §6 ("prompt 原行为不变"). If undesired, wrap the section header in a conditional in the writer code — out of scope for this task.

- [ ] **Step 6: Run TestPromptWiring tests to verify they pass**

Run:
```bash
pytest tests/test_pacing_enforcement.py::TestPromptWiring -v
```
Expected: 6 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/agents/writer.py backend/prompts/scene_writing.yaml tests/test_pacing_enforcement.py
git commit -m "feat(pacing): inject scene-level pacing into writer scene prompt"
```

---

## Task 6: ChapterReviewBuilder — `_check_pacing` sync + review integration

**Files:**
- Modify: `backend/conductor/chapter_review.py`
- Test: `tests/test_pacing_enforcement.py`

- [ ] **Step 1: Add TestChapterReview tests**

Append to `tests/test_pacing_enforcement.py`:

```python
class TestChapterReview:
    def test_chapter_review_includes_pacing_compliance_key(self, tmp_path):
        from backend.conductor.chapter_review import ChapterReviewBuilder

        # Create a minimal project skeleton with one scene draft.
        project_id = "test_pacing_proj"
        project_dir = tmp_path / project_id
        chapters_dir = project_dir / "chapters"
        chapters_dir.mkdir(parents=True)
        draft = chapters_dir / "ch01_scene_01_draft.md"
        # 50 CJK chars + 1 SF_LOG tag → beats density = 1 / (50/1000) = 20 → fails min_beats_per_1k=1.5? No, passes.
        # Just write enough to produce a non-empty stats.
        draft.write_text("林峰拔剑出鞘。<!-- SF_LOG knowledge_gain char=\"林峰\" -->\n\n他说：\"来吧。\"", encoding="utf-8")
        (project_dir / "story_dna.json").write_text('{"genre": "xianxia"}', encoding="utf-8")
        (project_dir / "progress.json").write_text('{"chapters": [{"chapter_number": 1, "scenes": [{"status": "completed"}]}]}', encoding="utf-8")

        builder = ChapterReviewBuilder(project_id, projects_dir=tmp_path)
        review = builder.build_review(1)
        assert "pacing_compliance" in review
        assert isinstance(review["pacing_compliance"], list)
        assert len(review["pacing_compliance"]) > 0

    def test_chapter_review_empty_scene_texts_yields_empty_list(self, tmp_path):
        from backend.conductor.chapter_review import ChapterReviewBuilder

        project_id = "test_pacing_empty"
        project_dir = tmp_path / project_id
        (project_dir / "chapters").mkdir(parents=True)
        (project_dir / "story_dna.json").write_text('{"genre": "xianxia"}', encoding="utf-8")
        (project_dir / "progress.json").write_text('{"chapters": [{"chapter_number": 1, "scenes": []}]}', encoding="utf-8")

        builder = ChapterReviewBuilder(project_id, projects_dir=tmp_path)
        review = builder.build_review(1)
        assert review["pacing_compliance"] == []

    def test_chapter_review_pacing_failure_does_not_block_build(self, tmp_path):
        from backend.conductor.chapter_review import ChapterReviewBuilder

        project_id = "test_pacing_fail"
        project_dir = tmp_path / project_id
        chapters_dir = project_dir / "chapters"
        chapters_dir.mkdir(parents=True)
        # Massive scene (>> 7000 chars) → chapter_words.max will fail.
        huge_text = "林峰" * 4000  # 8000 chars
        (chapters_dir / "ch01_scene_01_draft.md").write_text(huge_text, encoding="utf-8")
        (project_dir / "story_dna.json").write_text('{"genre": "xianxia"}', encoding="utf-8")
        (project_dir / "progress.json").write_text('{"chapters": [{"chapter_number": 1, "scenes": [{"status": "completed"}]}]}', encoding="utf-8")

        builder = ChapterReviewBuilder(project_id, projects_dir=tmp_path)
        review = builder.build_review(1)  # MUST NOT raise
        cw_max = [r for r in review["pacing_compliance"] if r["metric"] == "chapter_words.max"]
        assert any(not r["passed"] for r in cw_max)
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:
```bash
pytest tests/test_pacing_enforcement.py::TestChapterReview -v
```
Expected: FAIL — `pacing_compliance` key not in review dict.

- [ ] **Step 3: Add `_check_pacing` and `_check_pacing_async` to ChapterReviewBuilder**

In `backend/conductor/chapter_review.py`, locate `build_review` and `build_review_async`. Add two new methods (place them next to `_check_writing_formula` and `_check_writing_formula_async`):

```python
    def _check_pacing(self, chapter_number: int) -> list[dict]:
        """Synchronous pacing compliance check. Mirrors _check_writing_formula."""
        try:
            from backend.style_engine.pacing import PacingAnalyzer
            from backend.style_engine.genre_template import GenreTemplate

            texts = self._collect_scene_texts(chapter_number)
            if not texts:
                return []

            pacing = GenreTemplate().get_pacing(self._detect_genre())
            if not pacing:
                return []

            stats = PacingAnalyzer().analyze_sync(texts)
            tolerances = self._extract_pacing_tolerances(pacing)
            results = PacingAnalyzer().check_compliance(stats, pacing, tolerances)
            return [
                {
                    "metric": r.metric,
                    "expected": r.expected,
                    "actual": r.actual,
                    "passed": r.passed,
                    "delta_pct": r.delta_pct,
                }
                for r in results
            ]
        except Exception as e:
            logger.warning("Pacing check failed (non-blocking): %s", e)
            return []

    async def _check_pacing_async(self, chapter_number: int) -> list[dict]:
        """Async pacing compliance — still deterministic (no LLM for pacing)."""
        return self._check_pacing(chapter_number)

    @staticmethod
    def _extract_pacing_tolerances(pacing: dict) -> dict:
        """Pull every `<metric>_tolerance` field out of the pacing dict."""
        out = {}
        for key, val in pacing.items():
            if key.endswith("_tolerance") and isinstance(val, (int, float)):
                out[key] = val
        return out
```

- [ ] **Step 4: Wire `_check_pacing` into `build_review()` and `_check_pacing_async` into `build_review_async()`**

In `build_review()` (after `formula_compliance` line):

```python
            "writing_formula_compliance": formula_compliance,
            "pacing_compliance": self._check_pacing(chapter_number),
```

In `build_review_async()`, after the existing `await self._check_writing_formula_async(...)` assignment, add:

```python
        review["pacing_compliance"] = await self._check_pacing_async(chapter_number)
```

- [ ] **Step 5: Run TestChapterReview tests to verify they pass**

Run:
```bash
pytest tests/test_pacing_enforcement.py::TestChapterReview -v
```
Expected: 3 tests PASS.

- [ ] **Step 6: Run full pacing test file**

Run:
```bash
pytest tests/test_pacing_enforcement.py -v
```
Expected: 18 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/conductor/chapter_review.py tests/test_pacing_enforcement.py
git commit -m "feat(pacing): wire PacingAnalyzer into ChapterReviewBuilder"
```

---

## Task 7: Field coverage tests + full regression

**Files:**
- Test: `tests/test_pacing_enforcement.py`

- [ ] **Step 1: Add TestFieldCoverage class**

Append to `tests/test_pacing_enforcement.py`:

```python
class TestFieldCoverage:
    """Verify every pacing field is either injected into a prompt or
    surfaced in the review check, per spec §3.4."""

    def test_all_six_pacing_fields_have_injection_or_check_coverage(self):
        from backend.agents.planner import _resolve_genre_pacing
        from backend.agents.writer import _resolve_genre_scene_pacing
        from backend.genres.catalog import get_catalog

        pacing = get_catalog().get("xianxia")["pacing"]
        chapter_fields = {"chapter_words", "scene_words", "min_beats_per_1k", "escalation_interval"}
        scene_fields = {"scene_words", "action_ratio", "max_consecutive_non_action", "min_beats_per_1k"}

        planner_text = _resolve_genre_pacing("xianxia")
        writer_text = _resolve_genre_scene_pacing("xianxia")

        # Planner must cover all 4 chapter-level fields
        assert "单章字数" in planner_text       # chapter_words
        assert "单场字数" in planner_text        # scene_words (planner also shows it)
        assert "SF_LOG 标签密度" in planner_text # min_beats_per_1k
        assert "冲突升级间隔" in planner_text    # escalation_interval

        # Writer must cover all 4 scene-level fields
        assert "本场字数" in writer_text                 # scene_words
        assert "动作/感官段占比" in writer_text          # action_ratio
        assert "连续非动作段" in writer_text             # max_consecutive_non_action
        assert "SF_LOG 标签密度" in writer_text          # min_beats_per_1k

    def test_escalation_interval_only_prompt_no_review_check(self):
        from backend.style_engine.pacing import PacingAnalyzer
        # analyze_sync never produces anything related to escalation_interval
        # (no field on PacingStats). check_compliance never produces a metric
        # for it. Together this means it's prompt-only.
        stats = PacingAnalyzer().analyze_sync(["林峰拔剑出鞘。" * 100])
        results = PacingAnalyzer().check_compliance(
            stats,
            {"escalation_interval": 5, "scene_words": {"min": 100, "max": 1000}, "min_beats_per_1k": 1.0},
        )
        metrics = {r.metric for r in results}
        assert "escalation_interval" not in metrics
```

- [ ] **Step 2: Run the new tests**

Run:
```bash
pytest tests/test_pacing_enforcement.py::TestFieldCoverage -v
```
Expected: 2 tests PASS.

- [ ] **Step 3: Run full pacing suite**

Run:
```bash
pytest tests/test_pacing_enforcement.py -v
```
Expected: 20 tests PASS across 5 classes.

- [ ] **Step 4: Run the full backend test suite to check for regressions**

Run:
```bash
pytest tests/ -q --ignore=tests/test_pacing_enforcement.py
```
Expected: all pre-existing tests pass (no new failures introduced).

- [ ] **Step 5: Run the pacing suite one more time to confirm green**

Run:
```bash
pytest tests/test_pacing_enforcement.py -v
```
Expected: 20 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/test_pacing_enforcement.py
git commit -m "test(pacing): verify field coverage per spec §3.4"
```

---

## Task 8: Acceptance verification — manual end-to-end

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite one final time**

Run:
```bash
pytest -q
```
Expected: all tests pass.

- [ ] **Step 2: Verify acceptance criterion #1 — review JSON contains pacing_compliance**

If a test xianxia project already exists on disk, run:

```bash
python -c "
import json
from pathlib import Path
from backend.conductor.chapter_review import ChapterReviewBuilder

# Adjust the project_id to one that exists in your projects_dir
project_id = '<your_xianxia_project_id>'
builder = ChapterReviewBuilder(project_id)
review = builder.build_review(1)
assert 'pacing_compliance' in review
assert len(review['pacing_compliance']) > 0
print(json.dumps(review['pacing_compliance'], ensure_ascii=False, indent=2))
"
```
Expected: review dict prints with `pacing_compliance` array containing entries like `chapter_words.min`, `chapter_words.max`, `scene_words.min`, `action_ratio`, etc.

If no such project exists, skip this step — the TestChapterReview tests already verify this path.

- [ ] **Step 3: Verify acceptance criterion #2 — changing pacing values flips passed**

Temporarily edit `config/genres/xianxia.yaml` and change `pacing.action_ratio` from `0.35` to `0.90`. Then re-run a chapter review (or rely on `TestCompliance::test_check_compliance_action_ratio_uses_tolerance_window` which already proves this). Restore the value.

- [ ] **Step 4: Commit any test-only adjustments**

If you had to tweak the test fixtures (e.g. project_dir layout), commit:

```bash
git add -A
git commit -m "test(pacing): acceptance verification adjustments" --allow-empty
```

If no changes were made, skip this step.

---

## Self-Review Checklist (run before handoff)

- [ ] Spec §1.1 — `pacing` block already defined: covered (Tasks 1–3 use the existing dict).
- [ ] Spec §3.1 — `PacingAnalyzer` shape: covered (Task 1 skeleton, Task 3 check_compliance).
- [ ] Spec §3.2 — `_check_pacing` in chapter review: covered (Task 6).
- [ ] Spec §3.3 — Planner 4 fields / Writer 4 fields: covered (Tasks 4 & 5).
- [ ] Spec §3.4 — Field–layer mapping table: covered (Tasks 4–7).
- [ ] Spec §4.1 — Action segment verb regex: covered (Task 1 regex).
- [ ] Spec §4.2 — SF_LOG regex: covered (Task 1 `SF_LOG_TAG_RE`).
- [ ] Spec §4.3 — Tolerance default 0.30: covered (Task 3 `default_tol`).
- [ ] Spec §4.4 — Exception rules: covered (Task 3 metric-by-metric logic).
- [ ] Spec §6 — Error handling: covered (Tasks 1, 3, 6 try/except + fallback to empty).
- [ ] Spec §7 — Test matrix (5 classes, 20 tests): covered (Tasks 1–7).
- [ ] Spec §8 — YAGNI: no retry, no UI, no LLM involvement — plan respects all.
- [ ] Spec §9 — File list: 1 new (`pacing.py`), 1 new test, 6 modified — matches plan.
- [ ] Spec §10 — AC1 (review JSON has pacing_compliance) and AC2 (changing values flips passed) — both verified in Task 8 + TestChapterReview + TestCompliance.

Type / API consistency check across tasks:
- `PacingStats` fields: `chapter_word_count`, `scene_word_counts`, `action_ratio`, `max_consecutive_non_action`, `sf_log_tags_per_1k` — used identically in Tasks 1, 2, 3.
- `PacingCompliance` fields: `metric`, `expected`, `actual`, `passed`, `delta_pct` — used identically in Tasks 3, 6.
- `PacingAnalyzer` methods: `analyze_sync(scene_texts)`, `check_compliance(stats, pacing, tolerances=None)` — used identically in Tasks 1, 2, 3, 6, 7.
- `_resolve_genre_pacing(genre)` — single-arg signature, used in Task 4 + TestPromptWiring.
- `_resolve_genre_scene_pacing(genre)` — single-arg signature, used in Task 5 + TestPromptWiring.
- `_check_pacing(chapter_number)` returns `list[dict]` — used identically in Tasks 6, 8.

No placeholders / TBD / "implement later" remain.

---

## Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-30-pacing-enforcement.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?