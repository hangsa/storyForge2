# Phase 4b: TabooConstraintChecker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement TabooConstraintChecker with 3-layer detection (global regex → genre YAML → character keyword + Tier 3 LLM), integrate into ReviewerAgent's Style Guard phase, and collect results in ChapterReviewBuilder.

**Architecture:** New `backend/style_engine/taboo_constraints.py` with sync/async split (`check_sync` for Layers 1-2, `check_async` adds Layer 3 LLM). `ReviewerAgent.run_style_guard()` calls the checker, `stage4_writing.py` calls it after Narrative Guard. Genre template gets new `taboos` structured block alongside existing `taboo_words`. `ChapterReviewBuilder` collects violations from scene meta files.

**Tech Stack:** Python stdlib (re, json), PyYAML, Tier 3 Haiku LLM

**Files:**
- Create: `backend/style_engine/taboo_constraints.py`
- Create: `tests/test_taboo_constraints.py`
- Modify: `data/style/cool_novel.yaml`
- Modify: `backend/style_engine/genre_template.py`
- Modify: `backend/style_engine/__init__.py`
- Modify: `backend/agents/reviewer.py`
- Modify: `backend/api/stage4_writing.py`
- Modify: `backend/conductor/chapter_review.py`

---

### Task 1: TabooViolation dataclass + Layer 1 global taboos

**Files:**
- Create: `backend/style_engine/taboo_constraints.py`
- Create: `tests/test_taboo_constraints.py`

- [ ] **Step 1: Write the test file with Layer 1 tests**

Create `tests/test_taboo_constraints.py`:

```python
"""Tests for TabooConstraintChecker (Phase 4b)."""
import pytest
from backend.style_engine.taboo_constraints import (
    TabooViolation,
    TabooConstraintChecker,
)


class TestLayer1GlobalTaboos:
    @pytest.fixture
    def checker(self):
        return TabooConstraintChecker()

    def test_metaref_author_said(self, checker):
        violations = checker._check_global_taboos(
            "主角看着远方，作者说这段剧情太精彩了。"
        )
        assert any(v.pattern_name == "全局-元引用" for v in violations)
        assert all(v.layer == "global" for v in violations)
        assert all(v.severity == "error" for v in violations)

    def test_metaref_end_of_chapter(self, checker):
        violations = checker._check_global_taboos(
            "战斗结束，本章完。"
        )
        assert any(v.pattern_name == "全局-元引用" for v in violations)

    def test_metaref_aside(self, checker):
        violations = checker._check_global_taboos(
            "暂且不提这边的情况，看看另一边的战场。"
        )
        assert any(v.pattern_name == "全局-元引用" for v in violations)
        assert all(v.severity == "warning" for v in violations if v.pattern_name == "全局-元引用")

    def test_real_brand_china(self, checker):
        violations = checker._check_global_taboos(
            "他掏出手机，打开支付宝扫码支付。"
        )
        assert any(v.pattern_name == "全局-真实品牌" for v in violations)
        assert all(v.severity == "error" for v in violations)

    def test_real_brand_platform(self, checker):
        violations = checker._check_global_taboos(
            "这情节比起点的小说还精彩。"
        )
        assert any(v.pattern_name == "全局-真实平台" for v in violations)

    def test_no_violations_clean_text(self, checker):
        violations = checker._check_global_taboos(
            "主角深吸一口气，缓缓推开石门。门后是一条幽深的甬道。"
        )
        assert len(violations) == 0

    def test_violation_fields_populated(self, checker):
        violations = checker._check_global_taboos(
            "作者说这段很有意思。"
        )
        for v in violations:
            assert isinstance(v.pattern_name, str) and len(v.pattern_name) > 0
            assert v.layer == "global"
            assert v.severity in ("error", "warning")
            assert len(v.matched_text) > 0
            assert len(v.context) > 0

    def test_multiple_global_violations(self, checker):
        text = "作者说得对，他用微信付了钱，心想这情节够好看的。"
        violations = checker._check_global_taboos(text)
        assert len(violations) >= 2
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_taboo_constraints.py -v`
Expected: FAIL — "TabooConstraintChecker not defined"

- [ ] **Step 3: Write minimal implementation — TabooViolation + Layer 1**

Create `backend/style_engine/taboo_constraints.py`:

```python
"""StoryForge v1.6 Phase 4b — TabooConstraintChecker for L3 taboo constraint detection."""
import re
import json
import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class TabooViolation:
    pattern_name: str       # e.g. "虐主", "全局-元引用", "角色-林峰-禁止示弱"
    layer: str              # "global" | "genre" | "character"
    severity: str           # "error" | "warning"
    matched_text: str       # violating text snippet (~80 chars)
    context: str            # surrounding context (match_start-100 to match_end+100)


# --- Layer 1: Global taboo patterns (hardcoded, zero LLM) ---

_GLOBAL_TABOOS: list[dict] = [
    # Meta-reference — error
    {"pattern": r"如果这是一本小说", "name": "全局-元引用", "severity": "error"},
    {"pattern": r"作者说", "name": "全局-元引用", "severity": "error"},
    {"pattern": r"读者朋友们", "name": "全局-元引用", "severity": "error"},
    {"pattern": r"本章完", "name": "全局-元引用", "severity": "error"},
    # Meta-reference — warning
    {"pattern": r"按下不表", "name": "全局-元引用", "severity": "warning"},
    {"pattern": r"暂且不提", "name": "全局-元引用", "severity": "warning"},
    {"pattern": r"后文再续", "name": "全局-元引用", "severity": "warning"},
    # 4th wall breaks — warning
    {"pattern": r"各位看官", "name": "全局-元引用", "severity": "warning"},
    {"pattern": r"书接上文", "name": "全局-元引用", "severity": "warning"},
    # Real brand names — error
    {"pattern": r"\b(iPhone|iPad|MacBook|Apple Watch)\b", "name": "全局-真实品牌", "severity": "error"},
    {"pattern": r"(微信|支付宝|抖音|淘宝|百度|京东|美团|滴滴)", "name": "全局-真实品牌", "severity": "error"},
    {"pattern": r"\b(Nike|Adidas|Starbucks|McDonald'?s?|Google|Microsoft)\b", "name": "全局-真实品牌", "severity": "error"},
    # Real platforms in-story — error
    {"pattern": r"(起点中文网|起点|番茄小说|晋江文学城|晋江)", "name": "全局-真实平台", "severity": "error"},
]


def _extract_context(text: str, match_start: int, match_end: int) -> str:
    """Extract ~200 chars of context around a match."""
    start = max(0, match_start - 100)
    end = min(len(text), match_end + 100)
    return text[start:end]


def _extract_matched(text: str, match_start: int, match_end: int) -> str:
    """Extract ~80 chars of matched text snippet."""
    start = max(0, match_start - 10)
    end = min(len(text), match_end + 70)
    return text[start:end]


class TabooConstraintChecker:
    """L3 taboo constraint detection — 3 layers, only character taboos use Tier 3 LLM."""

    def check_sync(
        self, scene_text: str, genre_taboos: list[dict], character_taboos: list[dict]
    ) -> list[TabooViolation]:
        """
        Layers 1-2 only (zero LLM).
        
        Args:
            scene_text: Scene draft text to check
            genre_taboos: List of taboo entries from genre template YAML taboos block
            character_taboos: List of dicts with {"name": str, "taboos": list[str]}
        
        Returns:
            list[TabooViolation] — merged results from Layers 1-2
        """
        if not scene_text or not scene_text.strip():
            return []

        violations = []
        violations.extend(self._check_global_taboos(scene_text))
        violations.extend(self._check_genre_taboos(scene_text, genre_taboos))
        return violations

    def _check_global_taboos(self, scene_text: str) -> list[TabooViolation]:
        """Global taboo detection (regex + keyword, zero LLM)."""
        violations = []
        for entry in _GLOBAL_TABOOS:
            pattern = entry["pattern"]
            matches = list(re.finditer(pattern, scene_text))
            for m in matches:
                violations.append(TabooViolation(
                    pattern_name=entry["name"],
                    layer="global",
                    severity=entry["severity"],
                    matched_text=_extract_matched(scene_text, m.start(), m.end()),
                    context=_extract_context(scene_text, m.start(), m.end()),
                ))
        return violations


    def _check_genre_taboos(
        self, scene_text: str, genre_taboos: list[dict]
    ) -> list[TabooViolation]:
        """Genre taboo detection (YAML-driven, zero LLM). Stub — implemented in Task 2."""
        return []


    async def check_async(
        self, scene_text: str, genre_taboos: list[dict], character_taboos: list[dict]
    ) -> list[TabooViolation]:
        """Full 3-layer check. Stub — implemented in Task 5."""
        return self.check_sync(scene_text, genre_taboos, character_taboos)


    def _check_character_taboos(
        self, scene_text: str, character_taboos: list[dict]
    ) -> list[TabooViolation]:
        """Character taboo keyword matching (sync part). Stub — implemented in Task 5."""
        return []


    async def _check_character_taboos_async(
        self, scene_text: str, character_taboos: list[dict]
    ) -> list[TabooViolation]:
        """Character taboo keyword + Tier 3 LLM confirmation. Stub — implemented in Task 5."""
        return []
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_taboo_constraints.py -v`
Expected: All Layer 1 tests PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_taboo_constraints.py backend/style_engine/taboo_constraints.py
git commit -m "feat: add TabooViolation dataclass + Layer 1 global taboo detection

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Layer 2 genre taboos (keyword, sliding_window, consecutive_match)

**Files:**
- Modify: `backend/style_engine/taboo_constraints.py` — implement `_check_genre_taboos()`
- Modify: `tests/test_taboo_constraints.py` — add Layer 2 tests

- [ ] **Step 1: Add Layer 2 tests**

Append to `tests/test_taboo_constraints.py`:

```python

class TestLayer2GenreTaboos:
    @pytest.fixture
    def checker(self):
        return TabooConstraintChecker()

    @pytest.fixture
    def genre_taboos(self):
        return [
            {
                "name": "虐主",
                "type": "sliding_window",
                "keywords": ["受伤", "吐血", "被击飞", "惨叫", "虐待", "折磨", "碾压", "断臂"],
                "max_chars": 300,
                "severity": "error",
            },
            {
                "name": "连续失败",
                "type": "consecutive_match",
                "failure_keywords": ["失败", "输了", "不敌", "落败", "被击败", "无力", "败退"],
                "max_consecutive": 2,
                "severity": "error",
            },
            {
                "name": "禁用语",
                "type": "keyword",
                "words": ["无能为力", "绝望", "放弃", "认命", "恐怖如斯", "倒吸一口凉气", "此子不可留"],
                "severity": "warning",
            },
        ]

    # --- keyword type ---

    def test_keyword_type_flat_match(self, checker, genre_taboos):
        keyword_taboo = [t for t in genre_taboos if t["name"] == "禁用语"]
        violations = checker._check_genre_taboos(
            "主角感到绝望，但这不能让他放弃。", keyword_taboo
        )
        assert any(v.pattern_name == "禁用语" for v in violations)
        assert all(v.severity == "warning" for v in violations if v.pattern_name == "禁用语")
        assert all(v.layer == "genre" for v in violations)

    def test_keyword_type_no_match(self, checker, genre_taboos):
        keyword_taboo = [t for t in genre_taboos if t["name"] == "禁用语"]
        violations = checker._check_genre_taboos(
            "主角充满希望，勇往直前。", keyword_taboo
        )
        assert len(violations) == 0

    # --- sliding_window type ---

    def test_sliding_window_below_threshold(self, checker, genre_taboos):
        sliding_taboo = [t for t in genre_taboos if t["name"] == "虐主"]
        # 2 keywords in 300 chars → below threshold of 3
        text = "主角受伤了，" + "正文填充" * 10 + "但没有惨叫。"
        violations = checker._check_genre_taboos(text, sliding_taboo)
        assert len(violations) == 0

    def test_sliding_window_above_threshold(self, checker, genre_taboos):
        sliding_taboo = [t for t in genre_taboos if t["name"] == "虐主"]
        # 4 keywords in close proximity (< 300 chars)
        text = "主角受伤了，被人虐待，他吐血惨叫，遭到碾压。"
        violations = checker._check_genre_taboos(text, sliding_taboo)
        assert any(v.pattern_name == "虐主" for v in violations)
        assert all(v.severity == "error" for v in violations)

    # --- consecutive_match type ---

    def test_consecutive_match_below_threshold(self, checker, genre_taboos):
        consecutive_taboo = [t for t in genre_taboos if t["name"] == "连续失败"]
        text = "主角失败了。\n\n但是他没有放弃。\n\n继续战斗。"
        violations = checker._check_genre_taboos(text, consecutive_taboo)
        assert len(violations) == 0

    def test_consecutive_match_above_threshold(self, checker, genre_taboos):
        consecutive_taboo = [t for t in genre_taboos if t["name"] == "连续失败"]
        text = "第一战输了。\n\n第二战也落败。\n\n第三战不敌对手。"
        violations = checker._check_genre_taboos(text, consecutive_taboo)
        assert any(v.pattern_name == "连续失败" for v in violations)

    # --- edge cases ---

    def test_empty_genre_taboos(self, checker):
        violations = checker._check_genre_taboos("任意文本。", [])
        assert len(violations) == 0

    def test_unknown_taboo_type(self, checker):
        unknown = [{"name": "未知类型", "type": "unknown_type", "severity": "error"}]
        violations = checker._check_genre_taboos("任意文本。", unknown)
        assert len(violations) == 0

    def test_genre_taboo_layer_field(self, checker, genre_taboos):
        keyword_taboo = [t for t in genre_taboos if t["name"] == "禁用语"]
        violations = checker._check_genre_taboos("绝望地倒吸一口凉气。", keyword_taboo)
        assert all(v.layer == "genre" for v in violations)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_taboo_constraints.py::TestLayer2GenreTaboos -v`
Expected: FAIL — keyword type returns [] (stub), sliding_window tests fail

- [ ] **Step 3: Implement `_check_genre_taboos()`**

Replace the stub `_check_genre_taboos()` in `backend/style_engine/taboo_constraints.py`:

```python
    def _check_genre_taboos(
        self, scene_text: str, genre_taboos: list[dict]
    ) -> list[TabooViolation]:
        """Genre taboo detection (YAML-driven, zero LLM).
        
        Supports three types:
        - keyword: simple keyword match against words list
        - sliding_window: keyword density in sliding windows
        - consecutive_match: consecutive paragraphs containing failure keywords
        """
        if not genre_taboos:
            return []

        violations = []
        for taboo in genre_taboos:
            taboo_type = taboo.get("type", "")
            if taboo_type == "keyword":
                violations.extend(self._check_keyword_taboo(scene_text, taboo))
            elif taboo_type == "sliding_window":
                violations.extend(self._check_sliding_window(scene_text, taboo))
            elif taboo_type == "consecutive_match":
                violations.extend(self._check_consecutive_match(scene_text, taboo))
            # Unknown type → skip silently
        return violations

    def _check_keyword_taboo(
        self, scene_text: str, taboo: dict
    ) -> list[TabooViolation]:
        words = taboo.get("words", [])
        if not words:
            return []
        violations = []
        for word in words:
            for m in re.finditer(re.escape(word), scene_text):
                violations.append(TabooViolation(
                    pattern_name=taboo["name"],
                    layer="genre",
                    severity=taboo.get("severity", "error"),
                    matched_text=_extract_matched(scene_text, m.start(), m.end()),
                    context=_extract_context(scene_text, m.start(), m.end()),
                ))
        return violations

    def _check_sliding_window(
        self, scene_text: str, taboo: dict
    ) -> list[TabooViolation]:
        keywords = taboo.get("keywords", [])
        max_chars = taboo.get("max_chars", 300)
        if not keywords or max_chars <= 0:
            return []

        step = max(1, max_chars // 4)
        violations = []
        seen_windows: set[int] = set()  # deduplicate overlapping windows

        for start in range(0, len(scene_text), step):
            window_end = min(len(scene_text), start + max_chars)
            window = scene_text[start:window_end]

            hit_count = 0
            hit_positions = []
            for kw in keywords:
                for m in re.finditer(re.escape(kw), window):
                    hit_count += 1
                    hit_positions.append(start + m.start())

            if hit_count >= 3:
                # Check if this window overlaps significantly with an already-reported one
                window_key = start // step
                if window_key not in seen_windows:
                    seen_windows.add(window_key)
                    match_pos = hit_positions[0] if hit_positions else start
                    violations.append(TabooViolation(
                        pattern_name=taboo["name"],
                        layer="genre",
                        severity=taboo.get("severity", "error"),
                        matched_text=_extract_matched(scene_text, match_pos, match_pos + 10),
                        context=_extract_context(scene_text, start, window_end),
                    ))

        return violations

    def _check_consecutive_match(
        self, scene_text: str, taboo: dict
    ) -> list[TabooViolation]:
        failure_keywords = taboo.get("failure_keywords", [])
        max_consecutive = taboo.get("max_consecutive", 2)
        if not failure_keywords:
            return []

        paragraphs = [p.strip() for p in scene_text.split("\n\n") if p.strip()]
        if not paragraphs:
            return []

        # Find all consecutive runs
        hit_runs: list[list[int]] = []
        current_run: list[int] = []

        for i, para in enumerate(paragraphs):
            hit = any(
                re.search(re.escape(kw), para)
                for kw in failure_keywords
            )
            if hit:
                current_run.append(i)
            else:
                if len(current_run) >= max_consecutive:
                    hit_runs.append(current_run)
                current_run = []

        # Don't forget trailing run
        if len(current_run) >= max_consecutive:
            hit_runs.append(current_run)

        violations = []
        for run in hit_runs:
            # Find position in original text
            first_para = paragraphs[run[0]]
            match_start = scene_text.find(first_para)
            if match_start == -1:
                match_start = 0
            violations.append(TabooViolation(
                pattern_name=taboo["name"],
                layer="genre",
                severity=taboo.get("severity", "error"),
                matched_text=first_para[:80],
                context=_extract_context(scene_text, match_start, match_start + len(first_para)),
            ))

        return violations
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_taboo_constraints.py -v`
Expected: All 17 tests PASS (8 from Task 1 + 9 from Task 2)

- [ ] **Step 5: Commit**

```bash
git add tests/test_taboo_constraints.py backend/style_engine/taboo_constraints.py
git commit -m "feat: add Layer 2 genre taboo detection (keyword, sliding_window, consecutive_match)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: check_sync integration test + cool_novel.yaml taboos block

**Files:**
- Modify: `data/style/cool_novel.yaml` — add `taboos` block
- Modify: `backend/style_engine/genre_template.py` — add `get_structured_taboos()`
- Modify: `tests/test_taboo_constraints.py` — add integration test

- [ ] **Step 1: Add check_sync integration test**

Append to `tests/test_taboo_constraints.py`:

```python

class TestCheckSyncIntegration:
    @pytest.fixture
    def checker(self):
        return TabooConstraintChecker()

    @pytest.fixture
    def genre_taboos(self):
        return [
            {"name": "禁用语", "type": "keyword", "words": ["绝望", "放弃"], "severity": "warning"},
        ]

    def test_check_sync_combines_l1_l2(self, checker, genre_taboos):
        text = "作者说主角绝望地放弃了战斗。"
        violations = checker.check_sync(text, genre_taboos, [])
        # L1: "作者说" meta-reference
        # L2: "绝望", "放弃" from keyword taboo
        assert any(v.layer == "global" for v in violations), "Should have L1 violations"
        assert any(v.layer == "genre" for v in violations), "Should have L2 violations"

    def test_check_sync_empty_text(self, checker, genre_taboos):
        violations = checker.check_sync("", genre_taboos, [])
        assert len(violations) == 0

    def test_check_sync_no_taboos(self, checker):
        violations = checker.check_sync("任意文本。", [], [])
        # L1 may still fire (global patterns)
        assert all(v.layer == "global" for v in violations)
```

- [ ] **Step 2: Run tests to verify integration tests pass**

Run: `pytest tests/test_taboo_constraints.py::TestCheckSyncIntegration -v`
Expected: PASS (check_sync already implemented in Task 1, just verifying)

- [ ] **Step 3: Add `taboos` block to `cool_novel.yaml`**

After the existing `taboo_words` list (line 72), add:

```yaml
# Structured taboos for L3 constraint detection (Phase 4b)
taboos:
  - name: "虐主"
    type: "sliding_window"
    keywords: ["受伤", "吐血", "被击飞", "惨叫", "虐待", "折磨", "碾压", "断臂"]
    max_chars: 300
    severity: error

  - name: "连续失败"
    type: "consecutive_match"
    failure_keywords: ["失败", "输了", "不敌", "落败", "被击败", "无力", "败退"]
    max_consecutive: 2
    severity: error
```

Note: `taboo_words` list is preserved for backward compatibility. The existing "禁用语" words from `taboo_words` are already covered by Fact Guard Check 2's exact string matching. A separate keyword-type entry is not needed unless we want Layer 2 to also detect them.

- [ ] **Step 4: Add `get_structured_taboos()` to GenreTemplate**

In `backend/style_engine/genre_template.py`, add after `get_style_formula()` (line 43):

```python
    def get_structured_taboos(self, template_name: str = "cool_novel") -> list[dict]:
        """Read structured taboos section from genre template. Returns [] if not configured."""
        template = self.load(template_name)
        return template.get("taboos", [])
```

- [ ] **Step 5: Verify GenreTemplate backward compat**

Run: `python3 -c "from backend.style_engine.genre_template import GenreTemplate; t = GenreTemplate(); print(t.get_taboos()); print(t.get_structured_taboos())"`
Expected: prints existing `taboo_words` list and new `taboos` list; no errors

- [ ] **Step 6: Commit**

```bash
git add data/style/cool_novel.yaml backend/style_engine/genre_template.py tests/test_taboo_constraints.py
git commit -m "feat: add structured taboos YAML block + GenreTemplate.get_structured_taboos()

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Layer 3 character taboos (keyword mapping + Tier 3 LLM)

**Files:**
- Modify: `backend/style_engine/taboo_constraints.py` — implement character taboo methods
- Modify: `tests/test_taboo_constraints.py` — add Layer 3 tests

- [ ] **Step 1: Add Layer 3 tests**

Append to `tests/test_taboo_constraints.py`:

```python

class TestLayer3CharacterTaboos:
    @pytest.fixture
    def checker(self):
        return TabooConstraintChecker()

    @pytest.fixture
    def character_taboos(self):
        return [
            {"name": "林峰", "taboos": ["禁止说脏话", "禁止主动求助"]},
            {"name": "苏晓晓", "taboos": ["禁止示弱"]},
        ]

    def test_keyword_match_dirty_words(self, checker, character_taboos):
        violations = checker._check_character_taboos(
            "林峰骂道：'你他妈就是个混蛋，真是废物！'",
            character_taboos,
        )
        assert len(violations) > 0, "Should match '他妈' and '混蛋' and '废物'"
        pattern_names = {v.pattern_name for v in violations}
        assert "角色-林峰-禁止说脏话" in pattern_names

    def test_keyword_match_help_request(self, checker, character_taboos):
        violations = checker._check_character_taboos(
            "帮帮我！救命！求求你了！",
            character_taboos,
        )
        pattern_names = {v.pattern_name for v in violations}
        assert "角色-林峰-禁止主动求助" in pattern_names

    def test_keyword_match_weakness(self, checker, character_taboos):
        violations = checker._check_character_taboos(
            "苏晓晓低声道：'我不行，放过我吧。'",
            character_taboos,
        )
        pattern_names = {v.pattern_name for v in violations}
        assert "角色-苏晓晓-禁止示弱" in pattern_names

    def test_no_match_clean_speech(self, checker, character_taboos):
        violations = checker._check_character_taboos(
            "林峰说道：'我们走吧。'苏晓晓点了点头。",
            character_taboos,
        )
        assert len(violations) == 0

    def test_unknown_taboo_phrase_skipped(self, checker):
        taboos = [{"name": "路人", "taboos": ["禁止飞行"]}]
        violations = checker._check_character_taboos(
            "路人飞了起来。",
            taboos,
        )
        assert len(violations) == 0  # "禁止飞行" not in TABOO_KEYWORD_MAP → skip

    def test_empty_character_taboos(self, checker):
        violations = checker._check_character_taboos("任意文本。", [])
        assert len(violations) == 0

    def test_character_taboo_has_layer_and_severity(self, checker, character_taboos):
        violations = checker._check_character_taboos(
            "林峰：'他妈的，救救我！'",
            character_taboos,
        )
        for v in violations:
            assert v.layer == "character"
            assert v.severity in ("error", "warning")

    @pytest.mark.asyncio
    async def test_check_async_llm_unavailable(self, checker, character_taboos):
        """When LLM is unavailable, all keyword candidates pass through."""
        # By default, _check_character_taboos_async calls LLM which fails → passes all candidates
        violations = await checker._check_character_taboos_async(
            "林峰：'他妈的！'",
            character_taboos,
        )
        assert len(violations) > 0  # candidate passes through

    @pytest.mark.asyncio
    async def test_check_async_integrates_results(self, checker, character_taboos):
        violations = await checker.check_async(
            "作者说林峰骂道：'他妈的都是废物！'",
            [],  # no genre taboos
            character_taboos,
        )
        # L1: meta-reference from "作者说"
        # L3: character taboo from "他妈"
        layers = {v.layer for v in violations}
        assert "global" in layers
        assert "character" in layers
```

- [ ] **Step 2: Run tests to verify sync tests fail**

Run: `pytest tests/test_taboo_constraints.py::TestLayer3CharacterTaboos -v -k "not asyncio"`
Expected: FAIL — `_check_character_taboos()` returns `[]` (stub)

- [ ] **Step 3: Implement keyword mapping + `_check_character_taboos()` (sync)**

Replace the stubs in `backend/style_engine/taboo_constraints.py`. Add the keyword map at module level (after `_GLOBAL_TABOOS`):

```python
# --- Layer 3: Character taboo keyword mapping ---

TABOO_KEYWORD_MAP: dict[str, list[str]] = {
    "禁止说脏话": ["他妈", "混蛋", "废物", "找死", "该死"],
    "禁止主动求助": ["帮忙", "救我", "求求你", "帮帮我", "拜托", "救命"],
    "禁止示弱": ["我不行", "做不到", "放过我", "饶了我", "我输了"],
    "禁止撒谎": ["骗", "假的", "隐瞒", "没说"],
    "禁止背叛": ["出卖", "背叛", "投靠", "反水"],
}
```

Replace the stub `_check_character_taboos()`:

```python
    def _check_character_taboos(
        self, scene_text: str, character_taboos: list[dict]
    ) -> list[TabooViolation]:
        """Character taboo keyword matching (sync, zero LLM).
        
        Args:
            scene_text: Scene draft text
            character_taboos: [{"name": str, "taboos": [str, ...]}, ...]
            
        Returns:
            Candidate violations from keyword matching (no LLM confirmation)
        """
        if not character_taboos:
            return []

        violations = []
        for char_entry in character_taboos:
            char_name = char_entry.get("name", "未知角色")
            taboos = char_entry.get("taboos", [])
            if not taboos:
                continue

            for taboo_phrase in taboos:
                keywords = TABOO_KEYWORD_MAP.get(taboo_phrase)
                if not keywords:
                    continue  # unknown taboo phrase → skip

                for kw in keywords:
                    for m in re.finditer(re.escape(kw), scene_text):
                        violations.append(TabooViolation(
                            pattern_name=f"角色-{char_name}-{taboo_phrase}",
                            layer="character",
                            severity="warning",
                            matched_text=_extract_matched(scene_text, m.start(), m.end()),
                            context=_extract_context(scene_text, m.start(), m.end()),
                        ))
        return violations
```

- [ ] **Step 4: Run sync tests to verify they pass**

Run: `pytest tests/test_taboo_constraints.py::TestLayer3CharacterTaboos -v -k "not asyncio"`
Expected: 6 PASS

- [ ] **Step 5: Implement `_check_character_taboos_async()` + `check_async()` (LLM)**

Replace the stubs with full implementation:

```python
    async def _check_character_taboos_async(
        self, scene_text: str, character_taboos: list[dict]
    ) -> list[TabooViolation]:
        """Character taboo: keyword match → Tier 3 LLM confirmation.
        
        LLM unavailable → all keyword candidates pass through (conservative).
        """
        # Get keyword-match candidates first
        candidates = self._check_character_taboos(scene_text, character_taboos)
        if not candidates:
            return []

        try:
            from backend.llm.model_router import get_model_router, ModelUnavailableError

            router = get_model_router()

            # Build candidate list text
            candidates_text = "\n".join(
                f"[{i}] matched: \"{c.matched_text}\" | context: \"{c.context[:100]}\""
                for i, c in enumerate(candidates)
            )

            # Use first character's name/taboo for prompt (simplification: single char per call)
            char_entry = character_taboos[0] if character_taboos else {}
            char_name = char_entry.get("name", "未知角色")
            taboos = char_entry.get("taboos", [])

            system_prompt = (
                "你是一位网文编辑。以下是从角色禁忌关键词匹配中检测到的候选违规列表。"
                "判断每个候选是否构成真实的禁忌违规（考虑语境：引述他人、虚构假设、讽刺反语不算违规）。"
                "只输出一个 JSON 对象。"
            )
            user_prompt = (
                f"角色: {char_name}\n"
                f"禁忌: {', '.join(taboos)}\n\n"
                f"候选违规列表:\n{candidates_text}\n\n"
                '输出 JSON:\n'
                '{"violations": [{"index": <int>, "confirmed": true|false, "reason": "<一句话>"}]}'
            )

            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]

            result = await router.execute(
                agent_name="reviewer",
                task_name="character_taboo_confirmation",
                messages=messages,
                json_mode=True,
            )

            content = result.get("content", "")
            parsed = json.loads(content) if isinstance(content, str) else content
            confirmed_indices = {
                item["index"]
                for item in parsed.get("violations", [])
                if item.get("confirmed", False)
            }

            # Filter to confirmed only
            return [
                c for i, c in enumerate(candidates)
                if i in confirmed_indices
            ]

        except Exception as e:
            logger.warning("Character taboo LLM confirmation failed, passing all candidates: %s", e)
            # Conservative: pass all candidates through
            return candidates

    async def check_async(
        self, scene_text: str, genre_taboos: list[dict], character_taboos: list[dict]
    ) -> list[TabooViolation]:
        """Full 3-layer check. Layers 1-2 sync + Layer 3 with LLM confirmation."""
        if not scene_text or not scene_text.strip():
            return []

        violations = self.check_sync(scene_text, genre_taboos, character_taboos)
        violations.extend(
            await self._check_character_taboos_async(scene_text, character_taboos)
        )
        return violations
```

- [ ] **Step 6: Run all Layer 3 tests**

Run: `pytest tests/test_taboo_constraints.py::TestLayer3CharacterTaboos -v`
Expected: All 8 tests PASS (async tests may skip if no model router configured, but sync part passes)

- [ ] **Step 7: Commit**

```bash
git add backend/style_engine/taboo_constraints.py tests/test_taboo_constraints.py
git commit -m "feat: add Layer 3 character taboo detection with keyword mapping + Tier 3 LLM

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: ReviewerAgent.run_style_guard()

**Files:**
- Modify: `backend/agents/reviewer.py` — add `run_style_guard()` method
- Modify: `tests/test_taboo_constraints.py` — add reviewer integration test

- [ ] **Step 1: Add reviewer integration test**

Append to `tests/test_taboo_constraints.py`:

```python

class TestReviewerStyleGuard:
    @pytest.fixture
    def genre_template(self):
        return {
            "taboos": [
                {"name": "禁用语", "type": "keyword", "words": ["绝望", "放弃"], "severity": "warning"},
            ]
        }

    @pytest.fixture
    def characters(self):
        return [
            {
                "name": "林峰",
                "voice_signature": {"taboos": ["禁止说脏话", "禁止主动求助"]},
            }
        ]

    @pytest.mark.asyncio
    async def test_run_style_guard_returns_violations(self, genre_template, characters):
        from backend.agents.reviewer import ReviewerAgent
        reviewer = ReviewerAgent("test_project")
        violations = await reviewer.run_style_guard(
            scene_text="作者说林峰绝望地喊道：'他妈的都是废物！救命啊！'",
            genre_template=genre_template,
            characters=characters,
        )
        assert isinstance(violations, list)
        # Should have violations from all 3 layers (L3 passes through without LLM)
        assert len(violations) > 0

    @pytest.mark.asyncio
    async def test_run_style_guard_no_taboos_no_violations(self, genre_template, characters):
        from backend.agents.reviewer import ReviewerAgent
        reviewer = ReviewerAgent("test_project")
        violations = await reviewer.run_style_guard(
            scene_text="主角推开石门，步入大殿。",
            genre_template={"taboos": []},
            characters=[{"name": "林峰", "voice_signature": {}}],
        )
        # L1 may fire (e.g., "主角" is fine), so check that no genre/character violations
        assert all(v.layer == "global" for v in violations), (
            "Should only have global violations, not genre or character"
        )

    @pytest.mark.asyncio
    async def test_run_style_guard_returns_dicts(self, genre_template, characters):
        from backend.agents.reviewer import ReviewerAgent
        reviewer = ReviewerAgent("test_project")
        violations = await reviewer.run_style_guard(
            scene_text="林峰说：'他妈的！'",
            genre_template=genre_template,
            characters=characters,
        )
        # All items should be dicts (serializable)
        for v in violations:
            assert isinstance(v, dict)
            assert "pattern_name" in v
            assert "layer" in v
            assert "severity" in v
            assert "matched_text" in v
            assert "context" in v
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_taboo_constraints.py::TestReviewerStyleGuard -v`
Expected: FAIL — `ReviewerAgent has no attribute run_style_guard`

- [ ] **Step 3: Implement `run_style_guard()` in ReviewerAgent**

In `backend/agents/reviewer.py`, add after `run_narrative_guard()` (after line 521):

```python
    async def run_style_guard(
        self,
        scene_text: str,
        genre_template: dict,
        characters: list[dict],
    ) -> list[dict]:
        """
        执行 Style Guard L3 禁忌约束检测。
        在 Narrative Guard 之后调用。不阻断 Scene。
        返回 TabooViolation 列表的 dict 形式。

        Args:
            scene_text: Scene draft text
            genre_template: Loaded genre template dict (contains taboos key)
            characters: List of character dicts with voice_signature.taboos
        """
        try:
            from backend.style_engine.taboo_constraints import TabooConstraintChecker

            checker = TabooConstraintChecker()

            genre_taboos = genre_template.get("taboos", []) if genre_template else []

            character_taboos = [
                {
                    "name": c.get("name", "未知角色"),
                    "taboos": c.get("voice_signature", {}).get("taboos", []),
                }
                for c in characters
                if c.get("voice_signature", {}).get("taboos")
            ]

            violations = await checker.check_async(
                scene_text=scene_text,
                genre_taboos=genre_taboos,
                character_taboos=character_taboos,
            )

            return [
                {
                    "pattern_name": v.pattern_name,
                    "layer": v.layer,
                    "severity": v.severity,
                    "matched_text": v.matched_text,
                    "context": v.context,
                }
                for v in violations
            ]
        except Exception as e:
            logger.warning("Style Guard check failed (non-blocking): %s", e)
            return []
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_taboo_constraints.py::TestReviewerStyleGuard -v`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/agents/reviewer.py tests/test_taboo_constraints.py
git commit -m "feat: add ReviewerAgent.run_style_guard() for L3 taboo constraint detection

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Pipeline integration (stage4_writing.py + chapter_review.py + __init__.py)

**Files:**
- Modify: `backend/api/stage4_writing.py` — call style guard in write-scene pipeline
- Modify: `backend/conductor/chapter_review.py` — collect style guard violations
- Modify: `backend/style_engine/__init__.py` — export new classes

- [ ] **Step 1: Export TabooConstraintChecker and TabooViolation from __init__.py**

In `backend/style_engine/__init__.py`, add to imports and `__all__`:

```python
from backend.style_engine.taboo_constraints import (
    TabooConstraintChecker,
    TabooViolation,
)
```

And update `__all__`:

```python
__all__ = [
    "GenreTemplate",
    "StyleExtractor",
    "ExtractedStyle",
    "WritingFormulaAnalyzer",
    "WritingFormulaStats",
    "ComplianceResult",
    "TabooConstraintChecker",
    "TabooViolation",
]
```

- [ ] **Step 2: Add `_collect_style_guard_violations()` to ChapterReviewBuilder**

In `backend/conductor/chapter_review.py`, add after `_collect_narrative_guard_warnings()` (after line 298):

```python
    def _collect_style_guard_violations(self, chapter_number: int) -> list[dict]:
        """Collect Style Guard violations from scene meta files."""
        violations = []
        chapters_dir = self._project_dir / "chapters"
        if not chapters_dir.exists():
            return violations

        for meta_file in sorted(chapters_dir.glob(f"ch{chapter_number:02d}_scene_*_meta.json")):
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
                sg_violations = meta.get("style_guard_violations", [])
                if isinstance(sg_violations, list):
                    violations.extend(sg_violations)
            except Exception:
                continue

        return violations
```

In `build_review()` (around line 166), add the new field:

```python
            "writing_formula_compliance": self._check_writing_formula(chapter_number),
            "style_guard_violations": self._collect_style_guard_violations(chapter_number),
            "discussion_topics": [],
```

- [ ] **Step 3: Insert Style Guard call in write-scene pipeline**

In `backend/api/stage4_writing.py`, after the L0 update (line 289), add the Style Guard call:

After:
```python
    # Update L0 from character state changes
    l0.update_from_logs(registry_report.character_state_updates)
```

Add:
```python
    # --- Style Guard (v1.6 Phase 4b) ---
    style_violations = []
    try:
        from backend.style_engine.genre_template import GenreTemplate
        genre_template = GenreTemplate().load(ctx["genre"])
        style_violations = await reviewer.run_style_guard(
            scene_text=current_draft,
            genre_template=genre_template,
            characters=ctx["characters"],
        )
    except Exception as e:
        logger.warning("Style Guard failed (non-blocking): %s", e)
```

In the `scene_meta` dict (around line 299), add after `"registry_updates"`:

```python
        "style_guard_violations": style_violations,
```

- [ ] **Step 4: Run regression tests**

Run: `pytest tests/ -q --tb=short`
Expected: 394 passed (same as pre-existing count), no new failures

- [ ] **Step 5: Verify imports work**

Run: `python3 -c "from backend.style_engine import TabooConstraintChecker, TabooViolation; print('OK')"`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add backend/style_engine/__init__.py backend/conductor/chapter_review.py backend/api/stage4_writing.py
git commit -m "feat: wire TabooConstraintChecker into scene writing pipeline and chapter review

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run full test suite**

Run: `pytest tests/ -q --tb=short`

Expected: 394+ tests passed, 0 new failures. All existing tests continue to pass.

- [ ] **Step 2: Run new test file specifically**

Run: `pytest tests/test_taboo_constraints.py -v`

Expected: All tests PASS (estimated 26+ tests across all layers)

- [ ] **Step 3: Verify no import errors on uvicorn startup**

Run: `python3 -c "from backend.api.stage4_writing import router; from backend.agents.reviewer import ReviewerAgent; from backend.conductor.chapter_review import ChapterReviewBuilder; from backend.style_engine import TabooConstraintChecker, TabooViolation; print('All imports OK')"`

Expected: `All imports OK`

- [ ] **Step 4: Commit final verification**

```bash
git add -A
git diff --cached --stat
git commit -m "chore: final verification — Phase 4b TabooConstraintChecker complete

All tests passing, zero regressions.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```
