# Phase 3a: Chapter Review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-generate chapter review data (coherence scoring, ReaderOS snapshot, narrative asset summary) when the last scene of a chapter completes, and expose it via two new API endpoints.

**Architecture:** New `backend/conductor/chapter_review.py` contains `ChapterReviewBuilder` (data assembly) and `CoherenceScorer` (rule-based + Tier 3 LLM fine-tuning). Extended `ReaderOS` with 5 new public metric methods so the snapshot includes all 7 metrics. Two API endpoints added to `stage4_writing.py`. Triggered after progress save in `write_scene`.

**Tech Stack:** Python, FastAPI, Pydantic, existing ReaderOS calculator (zero-LLM), Tier 3 Haiku via ModelRouter for coherence fine-tuning

---

### Task 1: Extend ReaderOS with 5 public metric methods

**Files:**
- Modify: `backend/reader_os/calculator.py`
- Modify: `tests/test_reader_os.py`

ReaderOS currently has `calculate_addiction()` and `calculate_fatigue()` as public methods. Internal helpers `_calc_curiosity()`, `_calc_tension()`, `_calc_satisfaction()` exist but are private. Missing: frustration (挫败感), discussion (讨论潜力). The `snapshot()` method only returns 3 fields.

**What to do:**
1. Rename `_calc_curiosity` → `calculate_curiosity` (public)
2. Rename `_calc_tension` → `calculate_tension` (public)
3. Rename `_calc_satisfaction` → `calculate_satisfaction` (public)
4. Add `calculate_frustration(chapter_number, genre)` — inverse of satisfaction, based on retry rate and failed scenes
5. Add `calculate_discussion(chapter_number)` — based on open mystery count + twist count + cliffhanger
6. Update `snapshot()` to return all 7 metrics

- [ ] **Step 1: Read current ReaderOS code**

Read `backend/reader_os/calculator.py` and `tests/test_reader_os.py` fully.

- [ ] **Step 2: Write tests for the 5 new public methods**

```python
# tests/test_reader_os.py — add to existing file

class TestReaderOSMetrics:
    """Tests for the 5 new v1.6 public metric methods."""

    def test_calculate_curiosity_returns_float(self, reader_os):
        result = reader_os.calculate_curiosity(1)
        assert isinstance(result, float)
        assert 0 <= result <= 100

    def test_calculate_tension_returns_float(self, reader_os):
        result = reader_os.calculate_tension(1)
        assert isinstance(result, float)
        assert 0 <= result <= 100

    def test_calculate_satisfaction_returns_float(self, reader_os):
        result = reader_os.calculate_satisfaction(1)
        assert isinstance(result, float)
        assert 0 <= result <= 100

    def test_calculate_frustration_returns_float(self, reader_os):
        result = reader_os.calculate_frustration(1, "cool_novel")
        assert isinstance(result, float)
        assert 0 <= result <= 100

    def test_calculate_discussion_returns_float(self, reader_os):
        result = reader_os.calculate_discussion(1)
        assert isinstance(result, float)
        assert 0 <= result <= 100

    def test_snapshot_has_all_7_metrics(self, reader_os):
        snap = reader_os.snapshot(1, "cool_novel")
        assert "addiction" in snap
        assert "fatigue" in snap
        assert "curiosity" in snap
        assert "tension" in snap
        assert "satisfaction" in snap
        assert "frustration" in snap
        assert "discussion" in snap
        assert "warnings" in snap
        assert all(isinstance(v, (int, float)) for k, v in snap.items() if k != "warnings")
```

- [ ] **Step 3: Make existing helpers public and add new methods in calculator.py**

In `backend/reader_os/calculator.py`, make these changes:

```python
# Rename _calc_curiosity → calculate_curiosity (make public)
def calculate_curiosity(self, chapter_number: int) -> float:
    """好奇心: Σ(open_mysteries × weight), normalized 0-100."""
    return self._calc_curiosity_chapter(chapter_number)

def _calc_curiosity(self, progress: dict) -> float:
    # Existing implementation stays, used by calculate_addiction internally
    narrative_state = self._fm.read_json(self.project_id, "memory/l2/active_narrative_state.json") or {}
    # ... keep existing code ...
```

Wait — the current `_calc_curiosity(progress)` takes a `progress` dict. The public method should accept chapter_number. Let me handle this properly.

The existing internal methods (`_calc_curiosity`, `_calc_tension`, `_calc_satisfaction`) take a `progress` dict because they're called by `calculate_addiction` which already loaded progress. For the public API, we'll accept `chapter_number`, load progress internally, and delegate to the internal method.

```python
# New public methods — add after calculate_fatigue(), before get_warnings()

def calculate_curiosity(self, chapter_number: int) -> float:
    """好奇心: Σ(open_mysteries×weight), normalized 0-100."""
    progress = self._fm.read_json(self.project_id, "progress.json") or {}
    return self._calc_curiosity(progress)

def calculate_tension(self, chapter_number: int) -> float:
    """张力: avg(active_conflicts.intensity), 0-100."""
    progress = self._fm.read_json(self.project_id, "progress.json") or {}
    return self._calc_tension(progress)

def calculate_satisfaction(self, chapter_number: int) -> float:
    """满足感: based on chapter completion rate and coherence scores."""
    progress = self._fm.read_json(self.project_id, "progress.json") or {}
    return self._calc_satisfaction(chapter_number, progress)

def calculate_frustration(self, chapter_number: int, genre: str = "cool_novel") -> float:
    """
    挫败感: inverse of satisfaction, boosted by retry failures.
    Formula: max(0, min(100, (100 - satisfaction)*0.7 + retry_penalty*0.3))
    retry_penalty = min(100, sum(retry_count) / sum(scenes) * 100)
    """
    progress = self._fm.read_json(self.project_id, "progress.json") or {}
    satisfaction = self._calc_satisfaction(chapter_number, progress)

    # Retry penalty from progress
    chapters = progress.get("chapters", [])
    relevant = [ch for ch in chapters if ch.get("chapter_number", 0) <= chapter_number]
    total_retries = sum(
        s.get("retry_count", 0)
        for ch in relevant
        for s in ch.get("scenes", [])
    )
    total_scenes = sum(len(ch.get("scenes", [])) for ch in relevant)
    retry_penalty = min(100, (total_retries / max(1, total_scenes)) * 100)

    raw = max(0, min(100, (100 - satisfaction) * 0.7 + retry_penalty * 0.3))
    thresholds = self._get_thresholds(genre)
    formula = thresholds.get("fatigue_formula", {})
    decay = formula.get("decay", 1.0)
    return round(raw * decay, 1)

def calculate_discussion(self, chapter_number: int) -> float:
    """
    讨论潜力: based on open mysteries, twists, and cliffhangers.
    Formula: min(100, (open_mysteries*10 + twists_revealed*15 + has_cliffhanger*30) * 0.8)
    """
    progress = self._fm.read_json(self.project_id, "progress.json") or {}
    narrative_state = self._fm.read_json(self.project_id, "memory/l2/active_narrative_state.json") or {}

    open_mysteries = len(narrative_state.get("open_mysteries", []))
    planted_foreshadowings = len(narrative_state.get("planted_foreshadowings", []))

    twists = self._fm.read_json(self.project_id, "storyos/twists.json") or []
    if isinstance(twists, dict):
        twists = twists.get("twists", [])
    revealed_twists = sum(1 for t in twists if t.get("status") in ("revealed", "partially_revealed"))

    # Check cliffhanger from outline
    outline = self._fm.read_json(self.project_id, "outline.json") or {}
    chapters = outline.get("chapters", [])
    chapter = next((ch for ch in chapters if ch.get("chapter_number") == chapter_number), None)
    has_cliffhanger = 0
    if chapter:
        scenes = chapter.get("scene_plan", [])
        if scenes and scenes[-1].get("narrative_role") == "cliffhanger":
            has_cliffhanger = 1

    raw = (open_mysteries * 10 + planted_foreshadowings * 8 + revealed_twists * 15 + has_cliffhanger * 30) * 0.8
    return round(min(100, raw), 1)
```

- [ ] **Step 4: Update snapshot() to return all 7 metrics**

```python
def snapshot(self, chapter_number: int, genre: str = "cool_novel") -> dict:
    """Return a complete ReaderOS snapshot with all 7 v1.6 metrics."""
    return {
        "addiction": self.calculate_addiction(chapter_number),
        "fatigue": self.calculate_fatigue(chapter_number, genre),
        "curiosity": self.calculate_curiosity(chapter_number),
        "tension": self.calculate_tension(chapter_number),
        "satisfaction": self.calculate_satisfaction(chapter_number),
        "frustration": self.calculate_frustration(chapter_number, genre),
        "discussion": self.calculate_discussion(chapter_number),
        "warnings": self.get_warnings(chapter_number, genre),
    }
```

- [ ] **Step 5: Run tests to verify**

```bash
python3 -m pytest tests/test_reader_os.py -v
```

Expected: all metric tests pass (may need fixture setup for reader_os in conftest.py).

- [ ] **Step 6: Commit**

```bash
git add backend/reader_os/calculator.py tests/test_reader_os.py
git commit -m "feat: expose 5 new ReaderOS public metrics, snapshot returns all 7"
```

---

### Task 2: Add ChapterReviewData model to progress.py

**Files:**
- Modify: `backend/models/progress.py`

- [ ] **Step 1: Add ChapterReviewData Pydantic model**

Add after the `ProgressFile` class at the end of `backend/models/progress.py`:

```python
class NarrativeGuardWarning(BaseModel):
    drift_type: str = ""           # "emotion_surge" / "relation_shift" / etc.
    character: str = ""
    severity: str = ""             # "high" / "medium" / "low"
    description: str = ""


class FactGuardSummary(BaseModel):
    passed: int = 0
    failed: int = 0
    total: int = 0
    pass_rate: float = 0.0


class ChapterReviewData(BaseModel):
    chapter_number: int
    timestamp: str = ""
    coherence_score: int = 0       # 0-100
    coherence_comment: str = ""    # LLM one-liner review
    reader_os: dict[str, float] = {}
    narrative_assets: dict[str, int] = {}
    narrative_guard_warnings: list[NarrativeGuardWarning] = []
    fact_guard_summary: FactGuardSummary = FactGuardSummary()
    writing_formula_compliance: list = []   # Placeholder for Phase 4.3
    discussion_topics: list[str] = []       # Placeholder, to be backfilled
    decision: Optional[str] = None          # null / "approved" / "revise"
    decision_feedback: Optional[str] = None
```

- [ ] **Step 2: Verify model import works**

```bash
python3 -c "from backend.models.progress import ChapterReviewData, FactGuardSummary, NarrativeGuardWarning; print('OK')"
```

- [ ] **Step 3: Commit**

```bash
git add backend/models/progress.py
git commit -m "feat: add ChapterReviewData model for chapter review"
```

---

### Task 3: Create ChapterReviewBuilder and CoherenceScorer

**Files:**
- Create: `backend/conductor/chapter_review.py`

- [ ] **Step 1: Write the test file first**

Create `tests/test_chapter_review.py`:

```python
"""Tests for ChapterReviewBuilder and CoherenceScorer."""
import json
import pytest
from unittest.mock import patch, MagicMock
from backend.conductor.chapter_review import (
    ChapterReviewBuilder,
    CoherenceScorer,
)


class TestCoherenceScorer:
    def test_rule_score_in_range(self):
        scorer = CoherenceScorer()
        score = scorer._compute_rule_score(
            narrative_health=70.0,
            reader_os_avg=65.0,
            fact_guard_pass_rate=0.85,
        )
        assert 0 <= score <= 100

    def test_rule_score_all_perfect(self):
        scorer = CoherenceScorer()
        score = scorer._compute_rule_score(
            narrative_health=100.0,
            reader_os_avg=100.0,
            fact_guard_pass_rate=1.0,
        )
        assert score == 100

    def test_rule_score_all_zero(self):
        scorer = CoherenceScorer()
        score = scorer._compute_rule_score(
            narrative_health=0.0,
            reader_os_avg=0.0,
            fact_guard_pass_rate=0.0,
        )
        assert score == 0

    def test_clamp_llm_delta(self):
        scorer = CoherenceScorer()
        assert scorer._clamp_delta(15) == 10
        assert scorer._clamp_delta(-15) == -10
        assert scorer._clamp_delta(5) == 5

    def test_final_score_clamped(self):
        scorer = CoherenceScorer()
        # rule=95 + delta=10 → clamped to 100
        assert scorer._compute_final(95, 10) == 100
        # rule=5 + delta=-10 → clamped to 0
        assert scorer._compute_final(5, -10) == 0

    @pytest.mark.asyncio
    async def test_score_sync_fallback(self):
        """When LLM unavailable, returns rule score only."""
        scorer = CoherenceScorer()
        score, comment = await scorer.score(
            base_score=75,
            scene_summaries="测试摘要",
            narrative_assets_summary="测试资产",
        )
        assert 0 <= score <= 100
        assert isinstance(comment, str)
        # Without LLM model loaded, should fall back to rule score
        assert score == 75


class TestChapterReviewBuilder:
    @pytest.fixture
    def builder(self, tmp_path):
        projects_dir = tmp_path / "projects"
        proj_dir = projects_dir / "test_proj"
        (proj_dir / "memory" / "l2").mkdir(parents=True)
        (proj_dir / "storyos").mkdir(parents=True)
        (proj_dir / "chapters").mkdir(parents=True)
        (proj_dir / "progress.json").write_text(json.dumps({
            "project_id": "test_proj",
            "current_chapter": 3,
            "chapters": [
                {
                    "chapter_number": 3,
                    "status": "in_progress",
                    "scenes": [
                        {"scene_number": 1, "status": "completed", "retry_count": 0},
                        {"scene_number": 2, "status": "completed", "retry_count": 1},
                        {"scene_number": 3, "status": "completed", "retry_count": 0},
                    ],
                }
            ],
            "circuit_breaker_events": [
                {"scene_number": 1, "attempt": 1, "result": "passed"},
                {"scene_number": 2, "attempt": 1, "result": "retry"},
                {"scene_number": 2, "attempt": 2, "result": "passed"},
                {"scene_number": 3, "attempt": 1, "result": "passed"},
            ],
        }))
        return ChapterReviewBuilder("test_proj", projects_dir=projects_dir)

    def test_all_scenes_done_returns_true(self, builder):
        assert builder._all_scenes_done(3) is True

    def test_build_review_returns_valid_structure(self, builder):
        review = builder.build_review(3)
        assert review["chapter_number"] == 3
        assert "timestamp" in review
        assert 0 <= review["coherence_score"] <= 100
        assert isinstance(review["coherence_comment"], str)
        assert len(review["reader_os"]) >= 7
        assert "narrative_assets" in review
        assert review["writing_formula_compliance"] == []
        assert review["discussion_topics"] == []
        assert review["decision"] is None

    def test_build_review_fact_guard_summary(self, builder):
        review = builder.build_review(3)
        fgs = review["fact_guard_summary"]
        # 3 passes out of 4 total checks (1 retry + 3 passes)
        assert fgs["total"] > 0
        assert fgs["passed"] > 0

    def test_get_review_data_returns_none_for_missing(self, builder):
        result = builder.get_review_data(99)  # Chapter doesn't exist
        assert result is None

    def test_save_and_load_review(self, builder, tmp_path):
        projects_dir = tmp_path / "projects"
        builder._projects_dir = projects_dir
        builder._project_dir = projects_dir / "test_proj"
        review = builder.build_review(3)
        builder._save_review(review)
        loaded = builder.get_review_data(3)
        assert loaded is not None
        assert loaded["chapter_number"] == 3

    def test_set_decision(self, builder, tmp_path):
        projects_dir = tmp_path / "projects"
        builder._projects_dir = projects_dir
        builder._project_dir = projects_dir / "test_proj"
        review = builder.build_review(3)
        builder._save_review(review)
        result = builder.set_decision(3, "approved")
        assert result is True
        loaded = builder.get_review_data(3)
        assert loaded["decision"] == "approved"

    def test_set_decision_invalid_value(self, builder):
        result = builder.set_decision(3, "invalid")
        assert result is False
```

- [ ] **Step 2: Run test to verify it fails (file not created yet)**

```bash
python3 -m pytest tests/test_chapter_review.py -v 2>&1 | head -5
```

Expected: ImportError or file not found.

- [ ] **Step 3: Create `backend/conductor/chapter_review.py`**

```python
"""StoryForge v1.6 Phase 3a — ChapterReviewBuilder + CoherenceScorer."""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from backend.config import settings
from backend.utils.file_manager import FileManager

logger = logging.getLogger(__name__)


class CoherenceScorer:
    """
    Scores chapter coherence: 60% rule-based + 40% Tier 3 LLM fine-tuning.

    Rule part weights:
    - Narrative asset health: 20% (active asset completion rate)
    - ReaderOS state avg: 20% ((addiction + satisfaction + curiosity) / 3)
    - Fact Guard pass rate: 20% (first-attempt pass / total checks)

    LLM part: ±10 delta + one-liner comment.
    Falls back to rule-only on LLM failure.
    """

    MAX_DELTA = 10
    NARRATIVE_HEALTH_WEIGHT = 0.20
    READEROS_WEIGHT = 0.20
    FACT_GUARD_WEIGHT = 0.20
    # Remaining 40% is LLM fine-tuning

    def _compute_rule_score(
        self,
        narrative_health: float,
        reader_os_avg: float,
        fact_guard_pass_rate: float,
    ) -> float:
        return round(
            narrative_health * self.NARRATIVE_HEALTH_WEIGHT
            + reader_os_avg * self.READEROS_WEIGHT
            + fact_guard_pass_rate * 100 * self.FACT_GUARD_WEIGHT
        )

    def _clamp_delta(self, delta: int) -> int:
        return max(-self.MAX_DELTA, min(self.MAX_DELTA, delta))

    def _compute_final(self, base_score: float, llm_delta: int) -> int:
        return max(0, min(100, int(base_score + llm_delta)))

    async def score(
        self,
        base_score: float,
        scene_summaries: str,
        narrative_assets_summary: str,
    ) -> tuple[int, str]:
        """
        Compute final coherence score with LLM fine-tuning.

        Returns (final_score, comment).
        Falls back to rule-only score if LLM unavailable.
        """
        try:
            from backend.llm.model_router import get_model_router, ModelUnavailableError

            router = get_model_router()

            system_prompt = (
                "你是一位专业的小说编辑。根据章节摘要和叙事资产数据，"
                "评估本章的连贯性。只输出一个 JSON 对象。"
            )
            user_prompt = (
                f"规则基础分: {base_score:.0f}/100\n\n"
                f"【章节场景摘要】\n{scene_summaries}\n\n"
                f"【叙事资产数据】\n{narrative_assets_summary}\n\n"
                "请评分（在基础分 ±10 范围内微调），并写一句中文点评。"
                '输出 JSON: {"delta": <int>, "comment": "<一句话点评>"}'
            )

            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]

            result = await router.execute(
                agent_name="reviewer",
                task_name="coherence_scorer",
                messages=messages,
                json_mode=True,
            )

            content = result.get("content", "")
            parsed = json.loads(content) if isinstance(content, str) else content
            delta = self._clamp_delta(int(parsed.get("delta", 0)))
            comment = parsed.get("comment", "")
            return self._compute_final(base_score, delta), comment

        except Exception as e:
            logger.warning("CoherenceScorer LLM unavailable, using rule score only: %s", e)
            return int(base_score), ""


class ChapterReviewBuilder:
    """Assembles chapter review data from all subsystems."""

    def __init__(self, project_id: str, projects_dir: Optional[Path] = None):
        self.project_id = project_id
        self._projects_dir = Path(projects_dir) if projects_dir else settings.projects_dir
        self._project_dir = self._projects_dir / project_id
        self._fm = FileManager(self._projects_dir)
        self._scorer = CoherenceScorer()

    def _all_scenes_done(self, chapter_number: int) -> bool:
        """Check if all scenes in the chapter are completed."""
        progress = self._fm.read_json(self.project_id, "progress.json") or {}
        chapters = progress.get("chapters", [])
        chapter = next(
            (ch for ch in chapters if ch.get("chapter_number") == chapter_number),
            None,
        )
        if not chapter:
            return False
        scenes = chapter.get("scenes", [])
        if not scenes:
            return False
        return all(
            s.get("status") in ("completed", "force_passed")
            for s in scenes
        )

    def build_review(self, chapter_number: int) -> dict:
        """Build complete chapter review data. Returns dict matching ChapterReviewData."""
        now = datetime.now(timezone.utc).isoformat()

        # 1. ReaderOS snapshot (all 7 metrics)
        from backend.reader_os.calculator import ReaderOS
        reader_os = ReaderOS(self.project_id, self._projects_dir)
        genre = self._detect_genre()
        reader_snapshot = reader_os.snapshot(chapter_number, genre)

        # 2. Narrative asset summary
        narrative_assets = self._summarize_narrative_assets()

        # 3. Fact Guard summary
        fact_guard = self._summarize_fact_guard(chapter_number)

        # 4. Narrative Guard warnings (from latest meta file)
        ng_warnings = self._collect_narrative_guard_warnings(chapter_number)

        # 5. Coherence score
        rule_score = self._compute_base_coherence(reader_snapshot, narrative_assets, fact_guard)
        final_score = rule_score  # fallback, replaced by async score() later
        comment = ""

        review = {
            "chapter_number": chapter_number,
            "timestamp": now,
            "coherence_score": final_score,
            "coherence_comment": comment,
            "reader_os": {
                "addiction": reader_snapshot.get("addiction", 0),
                "fatigue": reader_snapshot.get("fatigue", 0),
                "curiosity": reader_snapshot.get("curiosity", 0),
                "tension": reader_snapshot.get("tension", 0),
                "satisfaction": reader_snapshot.get("satisfaction", 0),
                "frustration": reader_snapshot.get("frustration", 0),
                "discussion": reader_snapshot.get("discussion", 0),
            },
            "narrative_assets": narrative_assets,
            "narrative_guard_warnings": ng_warnings,
            "fact_guard_summary": fact_guard,
            "writing_formula_compliance": [],
            "discussion_topics": [],
            "decision": None,
            "decision_feedback": None,
        }
        return review

    async def build_review_async(self, chapter_number: int) -> dict:
        """Build review with async LLM coherence scoring."""
        review = self.build_review(chapter_number)
        rule_score = review["coherence_score"]

        # Build summaries for LLM
        scene_summaries = self._build_scene_summaries(chapter_number)
        narrative_assets_summary = json.dumps(review["narrative_assets"], ensure_ascii=False)

        final_score, comment = await self._scorer.score(
            base_score=rule_score,
            scene_summaries=scene_summaries,
            narrative_assets_summary=narrative_assets_summary,
        )
        review["coherence_score"] = final_score
        review["coherence_comment"] = comment
        return review

    def _compute_base_coherence(
        self,
        reader_snapshot: dict,
        narrative_assets: dict,
        fact_guard: dict,
    ) -> float:
        """Compute rule-based base coherence (60% of final score)."""
        # Narrative health: resolved ratio of conflicts + fulfilled promises
        total_active = sum(v for k, v in narrative_assets.items() if "new" in k or "escalated" in k)
        total_resolved = sum(v for k, v in narrative_assets.items() if "resolved" in k or "fulfilled" in k)
        narrative_health = min(100, (total_resolved / max(1, total_active + total_resolved)) * 100)

        # ReaderOS avg: (addiction + satisfaction + curiosity) / 3
        reader_os_avg = (
            reader_snapshot.get("addiction", 50)
            + reader_snapshot.get("satisfaction", 50)
            + reader_snapshot.get("curiosity", 50)
        ) / 3

        # Fact Guard pass rate
        fg_pass_rate = fact_guard.get("pass_rate", 0.0)

        return self._scorer._compute_rule_score(
            narrative_health=narrative_health,
            reader_os_avg=reader_os_avg,
            fact_guard_pass_rate=fg_pass_rate,
        )

    def _detect_genre(self) -> str:
        """Detect genre from project story_dna.json."""
        dna = self._fm.read_json(self.project_id, "story_dna.json") or {}
        return dna.get("genre", "cool_novel")

    def _summarize_narrative_assets(self) -> dict:
        """Count narrative assets by status across all registries."""
        summary = {}
        registry_types = [
            ("conflict", "conflicts"),
            ("mystery", "mysteries"),
            ("twist", "twists"),
            ("goal", "goals"),
            ("promise", "promises"),
            ("reveal", "reveals"),
            ("expectation", "expectations"),
            ("foreshadowing", "foreshadowing"),
        ]

        for reg_type, key in registry_types:
            data = self._fm.read_json(self.project_id, f"storyos/{key}.json") or []
            if isinstance(data, dict):
                data = data.get(key, [])
            # Count by status
            for item in data:
                status = item.get("status", "unknown")
                count_key = f"{reg_type}_{status}"
                summary[count_key] = summary.get(count_key, 0) + 1

        # Simplify to standard keys expected by clients
        return {
            "new_conflicts": summary.get("conflict_active", 0),
            "escalated_conflicts": summary.get("conflict_escalated", 0),
            "resolved_conflicts": summary.get("conflict_resolved", 0),
            "new_clues": summary.get("mystery_active", 0) + summary.get("foreshadowing_planted", 0),
            "fulfilled_promises": summary.get("promise_fulfilled", 0),
            "revealed_twists": summary.get("twist_revealed", 0) + summary.get("twist_partially_revealed", 0),
            "fulfilled_expectations": summary.get("expectation_fulfilled", 0),
            "planted_foreshadowing": summary.get("foreshadowing_planted", 0),
        }

    def _summarize_fact_guard(self, chapter_number: int) -> dict:
        """Count Fact Guard pass/fail for scenes in this chapter."""
        progress = self._fm.read_json(self.project_id, "progress.json") or {}
        events = progress.get("circuit_breaker_events", [])

        chapter_scene_numbers = set()
        for ch in progress.get("chapters", []):
            if ch.get("chapter_number") == chapter_number:
                chapter_scene_numbers = {
                    s["scene_number"] for s in ch.get("scenes", [])
                }
                break

        chapter_events = [
            e for e in events
            if e.get("scene_number") in chapter_scene_numbers
        ]

        total = len(chapter_events)
        passed = sum(1 for e in chapter_events if e.get("result") == "passed")
        failed = total - passed

        return {
            "passed": passed,
            "failed": failed,
            "total": total,
            "pass_rate": round(passed / max(1, total), 2),
        }

    def _collect_narrative_guard_warnings(self, chapter_number: int) -> list[dict]:
        """Collect Narrative Guard warnings from scene meta files."""
        warnings = []
        chapters_dir = self._project_dir / "chapters"
        if not chapters_dir.exists():
            return warnings

        for meta_file in sorted(chapters_dir.glob(f"ch{chapter_number:02d}_scene_*_meta.json")):
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
                ng_warnings = meta.get("narrative_guard_warnings", [])
                if isinstance(ng_warnings, list):
                    warnings.extend(ng_warnings)
            except Exception:
                continue

        return warnings

    def _build_scene_summaries(self, chapter_number: int) -> str:
        """Build ~800 char summary of chapter scenes for LLM coherence scoring."""
        chapters_dir = self._project_dir / "chapters"
        summaries = []

        for draft_file in sorted(chapters_dir.glob(f"ch{chapter_number:02d}_scene_*_draft.md")):
            try:
                text = draft_file.read_text(encoding="utf-8")
                # Take first 300 chars of each scene + scene header
                scene_name = draft_file.stem.replace("_draft", "")
                snippet = text[:300].replace("\n", " ")
                summaries.append(f"[{scene_name}] {snippet}...")
            except Exception:
                continue

        if not summaries:
            return f"Chapter {chapter_number} — no scene drafts found"

        return "\n".join(summaries)[:800]

    def _save_review(self, review: dict) -> None:
        """Save review to project directory."""
        reviews_dir = self._project_dir / "chapter_reviews"
        reviews_dir.mkdir(parents=True, exist_ok=True)
        chapter = review["chapter_number"]
        path = reviews_dir / f"ch{chapter}_review.json"
        tmp = path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(review, f, ensure_ascii=False, indent=2)
        tmp.replace(path)

    def get_review_data(self, chapter_number: int) -> Optional[dict]:
        """Get review data for a chapter. Returns None if not found."""
        path = self._project_dir / "chapter_reviews" / f"ch{chapter_number}_review.json"
        if not path.exists():
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None

    def set_decision(self, chapter_number: int, decision: str, feedback: str = "") -> bool:
        """Set author's decision on chapter review."""
        if decision not in ("approved", "revise"):
            return False
        review = self.get_review_data(chapter_number)
        if review is None:
            return False
        review["decision"] = decision
        review["decision_feedback"] = feedback
        self._save_review(review)
        return True

    def save_review(self, review: dict) -> None:
        """Public wrapper for saving review data."""
        self._save_review(review)
```

- [ ] **Step 4: Run tests to verify**

```bash
python3 -m pytest tests/test_chapter_review.py -v
```

Expected: all tests pass except the async LLM test. If `test_save_and_load_review` and `test_set_decision` fail due to path issues, fix `tmp_path` handling.

- [ ] **Step 5: Commit**

```bash
git add backend/conductor/chapter_review.py tests/test_chapter_review.py
git commit -m "feat: add ChapterReviewBuilder and CoherenceScorer"
```

---

### Task 4: Wire review trigger into write-scene endpoint

**Files:**
- Modify: `backend/api/stage4_writing.py`

- [ ] **Step 1: Add the review trigger after progress save**

In `backend/api/stage4_writing.py`, after line 377 (`fm.write_json(project_id, "progress.json", progress)`), add the review trigger. The code should:

1. Check if all scenes in the chapter are done
2. If yes, build and save the chapter review asynchronously
3. Add `chapter_review_ready` to the response

```python
    # --- After progress save (after line 377) ---

    # v1.6 Phase 3a: Chapter review trigger
    chapter_review_ready = False
    all_scenes_done = all(
        s.get("status") in ("completed", "force_passed")
        for s in chapter_progress.get("scenes", [])
    )
    if all_scenes_done and chapter_progress.get("scenes"):
        try:
            from backend.conductor.chapter_review import ChapterReviewBuilder
            builder = ChapterReviewBuilder(project_id)
            review = await builder.build_review_async(chapter_number)
            builder.save_review(review)
            chapter_review_ready = True
            logger.info(
                "Chapter review generated for project=%s chapter=%d score=%d",
                project_id, chapter_number, review["coherence_score"],
            )
        except Exception as e:
            logger.warning("Chapter review generation failed (non-blocking): %s", e)
```

And add `chapter_review_ready` to the response dict (line ~379):

```python
    return {
        "error": False,
        "code": "OK",
        "message": f"Scene {scene_number} 写作完成",
        "detail": {
            "scene_number": scene_number,
            "status": breaker_result,
            "retry_count": attempt - 1,
            "draft_text": current_draft,
            "chapter_review_ready": chapter_review_ready,  # v1.6 Phase 3a
            "parsed_logs": [
                # ... rest unchanged
```

- [ ] **Step 2: Add `async` to the write_scene endpoint if not already**

The `write_scene` function needs `async` since `build_review_async` uses `await`. Check the function signature — it should already be `async def write_scene(...)`.

- [ ] **Step 3: Add the GET chapter-review and POST decide endpoints**

Add at the end of `backend/api/stage4_writing.py` (before the file ends):

```python
# --- v1.6 Phase 3a: Chapter Review API ---


@router.get("/chapter-review")
async def get_chapter_review(project_id: str, chapter: int):
    """Get chapter review data. Returns 404 if not yet generated."""
    from backend.conductor.chapter_review import ChapterReviewBuilder

    builder = ChapterReviewBuilder(project_id)
    review = builder.get_review_data(chapter)
    if review is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": True,
                "code": "REVIEW_NOT_FOUND",
                "message": f"Chapter {chapter} review not found",
                "detail": {},
            },
        )

    return {
        "error": False,
        "code": "OK",
        "message": f"Chapter {chapter} review loaded",
        "detail": review,
    }


@router.post("/chapter-review/decide")
async def decide_chapter_review(data: dict):
    """Author decision on chapter review.
    Request: {project_id, chapter_number, decision: "approved"|"revise", feedback?: string}
    """
    project_id = data.get("project_id", "")
    chapter_number = data.get("chapter_number", 0)
    decision = data.get("decision", "")
    feedback = data.get("feedback", "")

    if decision not in ("approved", "revise"):
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "INVALID_DECISION",
                "message": "decision must be 'approved' or 'revise'",
                "detail": {},
            },
        )

    from backend.conductor.chapter_review import ChapterReviewBuilder

    builder = ChapterReviewBuilder(project_id)
    ok = builder.set_decision(chapter_number, decision, feedback)
    if not ok:
        raise HTTPException(
            status_code=404,
            detail={
                "error": True,
                "code": "REVIEW_NOT_FOUND",
                "message": f"Chapter {chapter_number} review not found, cannot set decision",
                "detail": {},
            },
        )

    return {
        "error": False,
        "code": "OK",
        "message": f"Decision '{decision}' recorded for chapter {chapter_number}",
        "detail": {"status": "ok"},
    }
```

- [ ] **Step 4: Verify imports and syntax**

```bash
python3 -c "from backend.api.stage4_writing import router; print('Import OK')"
```

- [ ] **Step 5: Commit**

```bash
git add backend/api/stage4_writing.py
git commit -m "feat: wire chapter review trigger into write-scene, add review API endpoints"
```

---

### Task 5: End-to-end verification

- [ ] **Step 1: Run chapter review tests**

```bash
python3 -m pytest tests/test_chapter_review.py -v
```

Expected: all tests pass.

- [ ] **Step 2: Run full test suite for regression**

```bash
python3 -m pytest tests/ -q --tb=short
```

Expected: same 17 pre-existing failures, zero new failures.

- [ ] **Step 3: Manual smoke test (optional)**

Start the server and verify:
1. `GET /api/stage4/chapter-review?project_id=test&chapter=1` returns 404 for unreviewed chapter
2. Create a project through STAGE 1-3, write all scenes for a chapter
3. After last scene: response includes `chapter_review_ready: true`
4. `GET /api/stage4/chapter-review` returns the review with all fields populated
5. `POST /api/stage4/chapter-review/decide` with `decision: "approved"` works
6. `POST /api/stage4/chapter-review/decide` with `decision: "invalid"` returns 400

- [ ] **Step 4: Final commit (if any fixes from regression)**

```bash
git add -A
git commit -m "fix: chapter review regression fixes"
```
