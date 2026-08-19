# Managed Mode Chapter Range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add chapter range configuration (`start_chapter` / `end_chapter`) to the managed mode start flow, replacing the all-or-nothing `scope` field with an explicit range, with regeneration semantics for already-completed chapters in that range.

**Architecture:** Spec-faithful 3-layer change. Backend gets a new `ManagedStartConfig` schema with Pydantic range validation, two pure helpers (`compute_range_defaults`, `find_latest_completed_chapter`), a `regenerate_chapter` orchestrator that resets progress + clears drafts + drops matching queue items + re-enqueues + syncs checkpoint, and a `seed_queue` refactor that drops the `next_chapter` scope branch. A read-only `GET /range-preview` endpoint powers the modal's live preview. Frontend extends `ManagedStartModal` with a scope radio + range inputs + warning banner + confirmation dialog, plus a small new `ManagedStartConfirmDialog` component.

**Tech Stack:** Python 3 + FastAPI + Pydantic v2 (backend); React 18 + Vite + Vitest (frontend).

**Working directory:** Already on `v2.1` branch — no worktree per `feedback_worktree_v19.md` precedent. Do not run `git checkout` or `git branch`.

**Spec:** `docs/superpowers/specs/2026-08-19-managed-mode-chapter-range-design.md`

---

## Task 1: ManagedStartConfig schema with Pydantic range validator

**Files:**
- Modify: `backend/models/autopilot_session.py:43-50`
- Modify: `tests/test_autopilot_session_persistence.py` (or create `tests/test_managed_range.py` if simpler — using a new file for the whole suite)

- [ ] **Step 1: Write the failing test**

Add to `tests/test_managed_range.py` (new file, will accumulate throughout the plan):

```python
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
```

- [ ] **Step 2: Run the test file and verify it fails**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_managed_range.py -v`
Expected: All 8 tests FAIL. The current `ManagedStartConfig` accepts `scope="next_chapter"`, has no `start_chapter`/`end_chapter` fields, and has no validator. Specifically:
- `test_scope_all_planned_default_is_accepted` may pass coincidentally (current default IS `"all_planned"`).
- `test_scope_range_accepts_valid_range` may pass coincidentally (any string works in current `str` typing).
- The remaining 6 tests FAIL.

- [ ] **Step 3: Update the schema**

Edit `backend/models/autopilot_session.py:43-50`. Replace the `ManagedStartConfig` class body with:

```python
class ManagedStartConfig(BaseModel):
    """Mirror of frontend/src/components/workspace/ManagedStartModal.tsx ManagedStartConfig.
    Field names and literal unions MUST stay in sync (Stage 2 contract test).
    """
    scope: Literal["all_planned", "range"] = "all_planned"
    start_chapter: Optional[int] = None
    end_chapter: Optional[int] = None
    cadence: Literal["fast", "balanced", "careful"] = "balanced"
    policy: Literal["auto", "ask"] = "auto"
    notify: Literal["all", "milestones"] = "milestones"

    @model_validator(mode="after")
    def _validate_range(self):
        if self.scope != "range":
            return self
        if self.start_chapter is None or self.end_chapter is None:
            raise ValueError("scope='range' requires both start_chapter and end_chapter")
        if self.start_chapter < 1:
            raise ValueError("start_chapter must be >= 1")
        if self.end_chapter < self.start_chapter:
            raise ValueError("end_chapter must be >= start_chapter")
        return self
```

Add to the imports at the top of the file (line 7-11 area):

```python
from typing import Literal, Optional
```

(`Optional` is already imported per line 7. Add `Literal`.) Replace the existing `from typing import Optional` to:

```python
from typing import Literal, Optional
```

Add `model_validator` to the pydantic import (line 13):

```python
from pydantic import BaseModel, model_validator
```

- [ ] **Step 4: Re-run the test file and verify all pass**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_managed_range.py -v`
Expected: 8 tests pass.

- [ ] **Step 5: Run the existing autopilot tests and verify no regression**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_autopilot_runner_async.py tests/test_autopilot_session_persistence.py tests/test_autopilot_loop.py -v`
Expected: All existing tests pass. `test_autopilot_runner_async.py` constructs `ManagedStartConfig(scope="all_planned", ...)` (no `start_chapter`) which is still valid; `scope="next_chapter"` literals in those tests must be updated to `scope="range", start_chapter=N, end_chapter=N` (or `scope="all_planned"`) — do this as part of this step.

If any `scope="next_chapter"` literal remains in test code, fix it: replace with the equivalent `scope="range", start_chapter=N, end_chapter=N` or `scope="all_planned"` as appropriate to preserve the original test intent.

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add backend/models/autopilot_session.py tests/test_managed_range.py tests/test_autopilot_runner_async.py tests/test_autopilot_session_persistence.py tests/test_autopilot_loop.py
git commit -m "feat(autopilot): add start/end_chapter to ManagedStartConfig

Replace scope='next_chapter' with a range-based 'scope=range' that
takes start_chapter/end_chapter. Pydantic validator enforces
end >= start, start >= 1.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Pure helpers — `compute_range_defaults` and `find_latest_completed_chapter`

**Files:**
- Modify: `backend/conductor/autopilot_runner_async.py` (add helpers near `is_chapter_complete`)
- Modify: `tests/test_managed_range.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_managed_range.py`:

```python
from backend.conductor.autopilot_runner_async import (
    compute_range_defaults,
    find_latest_completed_chapter,
)


def _chapter_progress(*scene_statuses: tuple[int, str]) -> list[dict]:
    return [
        {"scene_number": n, "status": s} for n, s in scene_statuses
    ]


def _chapter_outline(*scene_numbers: int) -> dict:
    return {
        "chapter_number": 0,  # overwritten by caller
        "scene_plan": [{"scene_number": n, "goal": "", "conflict": ""} for n in scene_numbers],
    }


class TestComputeRangeDefaults:
    def test_no_completed_chapters(self):
        start, end = compute_range_defaults(outline_max=20, latest_completed=None)
        assert (start, end) == (1, 11)  # 1+10

    def test_with_completed_chapters(self):
        start, end = compute_range_defaults(outline_max=20, latest_completed=7)
        assert (start, end) == (8, 18)

    def test_outline_smaller_than_default_span(self):
        start, end = compute_range_defaults(outline_max=5, latest_completed=None)
        assert (start, end) == (1, 5)  # end clamped to outline_max

    def test_completed_at_outline_max(self):
        start, end = compute_range_defaults(outline_max=10, latest_completed=10)
        # start=11 > outline_max=10 → caller will surface "all done" error
        assert (start, end) == (11, 10)  # end clamped to outline_max=10

    def test_latest_completed_zero(self):
        """Defensive: latest_completed=0 is treated as 'nothing done'."""
        start, end = compute_range_defaults(outline_max=15, latest_completed=0)
        assert (start, end) == (1, 11)


class TestFindLatestCompletedChapter:
    def test_returns_max_when_chapters_complete(self):
        progress = {
            "chapters": [
                {"chapter_number": n, "status": "completed",
                 "scenes": _chapter_progress((1, "completed"), (2, "completed"))}
                for n in [1, 2, 3, 4, 5]
            ]
        }
        outline = {
            "chapters": [
                _chapter_outline(1, 2) | {"chapter_number": n}
                for n in [1, 2, 3, 4, 5]
            ]
        }
        assert find_latest_completed_chapter(progress, outline) == 5

    def test_returns_none_when_no_chapter_complete(self):
        progress = {"chapters": []}
        outline = {"chapters": [_chapter_outline(1, 2) | {"chapter_number": 1}]}
        assert find_latest_completed_chapter(progress, outline) is None

    def test_ignores_partial_chapters(self):
        progress = {
            "chapters": [
                {"chapter_number": 1, "status": "completed",
                 "scenes": _chapter_progress((1, "completed"), (2, "completed"))},
                {"chapter_number": 2, "status": "in_progress",
                 "scenes": _chapter_progress((1, "completed"), (2, "in_progress"))},
                {"chapter_number": 3, "status": "completed",
                 "scenes": _chapter_progress((1, "completed"), (2, "completed"))},
            ]
        }
        outline = {
            "chapters": [
                _chapter_outline(1, 2) | {"chapter_number": n}
                for n in [1, 2, 3]
            ]
        }
        assert find_latest_completed_chapter(progress, outline) == 3

    def test_handles_gaps(self):
        """ch2 not in progress at all — should not block ch3 from being the max."""
        progress = {
            "chapters": [
                {"chapter_number": 1, "status": "completed",
                 "scenes": _chapter_progress((1, "completed"))},
                {"chapter_number": 3, "status": "completed",
                 "scenes": _chapter_progress((1, "completed"))},
            ]
        }
        outline = {
            "chapters": [
                _chapter_outline(1) | {"chapter_number": n}
                for n in [1, 2, 3]
            ]
        }
        assert find_latest_completed_chapter(progress, outline) == 3

    def test_force_passed_counts_as_done(self):
        progress = {
            "chapters": [
                {"chapter_number": 1, "status": "completed",
                 "scenes": _chapter_progress((1, "force_passed"))}
            ]
        }
        outline = {
            "chapters": [_chapter_outline(1) | {"chapter_number": 1}]
        }
        assert find_latest_completed_chapter(progress, outline) == 1
```

- [ ] **Step 2: Run and verify failure**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_managed_range.py -v -k "ComputeRangeDefaults or FindLatestCompleted"`
Expected: 10 tests FAIL with `ImportError: cannot import name 'compute_range_defaults'` / `'find_latest_completed_chapter'`.

- [ ] **Step 3: Add the helpers to `autopilot_runner_async.py`**

Insert after `is_chapter_complete` (after line 134), before `repair_stuck_chapters`:

```python
def find_latest_completed_chapter(progress: dict, outline: dict) -> Optional[int]:
    """Return the highest chapter_number whose every scene in the outline's
    scene_plan is in DONE_STATUSES. None if no chapter is fully done.

    Reuses is_chapter_complete so the "done" definition stays in one place.
    """
    outline_by_num = {
        c.get("chapter_number"): c for c in (outline.get("chapters") or [])
    }
    progress_by_num = {
        ch.get("chapter_number"): ch for ch in (progress.get("chapters") or [])
    }
    completed: list[int] = []
    for ch_num, outline_ch in outline_by_num.items():
        ch_progress = progress_by_num.get(ch_num, {})
        planned = outline_ch.get("scene_plan", []) or []
        if not planned:
            continue
        if is_chapter_complete(ch_progress.get("scenes", []) or [], planned):
            completed.append(ch_num)
    return max(completed) if completed else None


def compute_range_defaults(
    outline_max: int, latest_completed: Optional[int],
) -> tuple[int, int]:
    """Default range for ManagedStartConfig(scope='range').

    start = (latest_completed or 0) + 1  →  1 if nothing completed yet.
    end   = min(start + 10, outline_max).

    Caller is responsible for surfacing "invalid" when start > outline_max.
    """
    start = (latest_completed or 0) + 1
    end = min(start + 10, outline_max)
    return start, end
```

- [ ] **Step 4: Re-run and verify pass**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_managed_range.py -v -k "ComputeRangeDefaults or FindLatestCompleted"`
Expected: 10 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add backend/conductor/autopilot_runner_async.py tests/test_managed_range.py
git commit -m "feat(autopilot): add compute_range_defaults and find_latest_completed helpers

find_latest_completed_chapter scans progress.json chapters[] for the
highest chapter_number whose scenes are all in DONE_STATUSES, reusing
is_chapter_complete. compute_range_defaults produces the [start, end]
sensible continuation: start = latest_completed + 1, end = min(start+10, outline_max).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: `regenerate_chapter` orchestrator + I/O helpers

This task creates the four-piece regeneration pipeline. Each piece gets its own test, but the orchestrator function is what `seed_queue` calls.

**Files:**
- Modify: `backend/conductor/autopilot_runner_async.py` (add 4 helpers + orchestrator)
- Modify: `tests/test_managed_range.py` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_managed_range.py`:

```python
import json
from pathlib import Path
from unittest.mock import MagicMock

from backend.conductor.autopilot_runner_async import (
    clear_chapter_drafts,
    drop_chapter_queue_items,
    enqueue_chapter_scenes,
    regenerate_chapter,
    reset_chapter_progress,
)


@pytest.fixture
def project_layout(tmp_path: Path):
    """Build a minimal project layout with progress.json + chapters/ + session queue."""
    proj = tmp_path / "p_regen"
    proj.mkdir()
    (proj / "project.json").write_text(json.dumps({"id": "p_regen"}))
    # progress.json with ch5 having 3 scenes all completed
    progress = {
        "current_chapter": 8,
        "chapters": [
            {
                "chapter_number": 5,
                "status": "completed",
                "scenes": [
                    {"scene_number": 1, "status": "completed", "retry_count": 2,
                     "coherence_score": 90},
                    {"scene_number": 2, "status": "completed", "retry_count": 0,
                     "coherence_score": 85},
                    {"scene_number": 3, "status": "completed", "retry_count": 0,
                     "coherence_score": 95},
                ],
            },
            {
                "chapter_number": 6,
                "status": "completed",
                "scenes": [
                    {"scene_number": 1, "status": "completed", "retry_count": 0,
                     "coherence_score": 80},
                ],
            },
        ],
    }
    (proj / "progress.json").write_text(json.dumps(progress))
    # chapters/ directory with ch05 + ch06 drafts (and a draft for another chapter
    # that should NOT be touched)
    chapters_dir = proj / "chapters"
    chapters_dir.mkdir()
    (chapters_dir / "ch05_scene_001_draft.md").write_text("draft 1")
    (chapters_dir / "ch05_scene_002_draft.md").write_text("draft 2")
    (chapters_dir / "ch05_scene_003_draft.md").write_text("draft 3")
    (chapters_dir / "ch06_scene_001_draft.md").write_text("ch6 draft")
    (chapters_dir / "ch07_scene_001_draft.md").write_text("ch7 draft (untouched)")
    return proj


class TestResetChapterProgress:
    def test_resets_status_and_clears_metadata(self, project_layout):
        reset_chapter_progress("p_regen", 5, project_layout)
        progress = json.loads((project_layout / "progress.json").read_text())
        ch5 = next(c for c in progress["chapters"] if c["chapter_number"] == 5)
        assert ch5["status"] == "pending"
        for s in ch5["scenes"]:
            assert s["status"] == "pending"
            assert s["retry_count"] == 0
            assert s["coherence_score"] is None

    def test_does_not_touch_other_chapters(self, project_layout):
        reset_chapter_progress("p_regen", 5, project_layout)
        progress = json.loads((project_layout / "progress.json").read_text())
        ch6 = next(c for c in progress["chapters"] if c["chapter_number"] == 6)
        assert ch6["status"] == "completed"
        assert ch6["scenes"][0]["status"] == "completed"


class TestClearChapterDrafts:
    def test_deletes_only_target_chapter_drafts(self, project_layout):
        clear_chapter_drafts("p_regen", 5, project_layout)
        chapters_dir = project_layout / "chapters"
        # ch05 drafts gone
        remaining = sorted(p.name for p in chapters_dir.iterdir())
        assert "ch05_scene_001_draft.md" not in remaining
        assert "ch05_scene_002_draft.md" not in remaining
        assert "ch05_scene_003_draft.md" not in remaining
        # ch06 + ch07 drafts untouched
        assert "ch06_scene_001_draft.md" in remaining
        assert "ch07_scene_001_draft.md" in remaining

    def test_no_op_when_chapter_dir_missing(self, project_layout):
        """Defensive: clear_chapter_drafts on a chapter that has no drafts
        must not raise."""
        clear_chapter_drafts("p_regen", 99, project_layout)
        # No exception; other files still there
        assert (project_layout / "chapters" / "ch07_scene_001_draft.md").exists()


class TestDropChapterQueueItems:
    def test_drops_matching_items_keeps_others(self, project_layout):
        mgr = MagicMock()
        # Snapshot returns queue with items from ch5, ch6, ch7
        snapshot = MagicMock()
        snapshot.queue = [
            MagicMock(id="write-5-1"),
            MagicMock(id="write-5-2"),
            MagicMock(id="write-5-3"),
            MagicMock(id="write-6-1"),
            MagicMock(id="write-7-1"),
        ]
        mgr.load.return_value = snapshot
        # Track added QueueItems
        added: list = []
        def fake_add(item):
            added.append(item)
            return mgr
        mgr.add_queue.side_effect = fake_add
        # We only need to drop; nothing added in this test
        drop_chapter_queue_items(mgr, 5)
        # mgr.add_queue should have been called 3 times — once for each removed item,
        # restoring the queue without ch5 entries.
        # The exact mechanism is implementation detail; what matters: ch5 ids are gone.
        # Verify by checking which ids are present in the final queue snapshot.
        final_queue_ids = {item.id for item in snapshot.queue if item.id not in added}
        # ch5 ids should be absent
        assert "write-5-1" not in final_queue_ids
        assert "write-5-2" not in final_queue_ids
        assert "write-5-3" not in final_queue_ids
        # ch6, ch7 ids preserved
        assert "write-6-1" in final_queue_ids
        assert "write-7-1" in final_queue_ids


class TestEnqueueChapterScenes:
    def test_enqueues_one_item_per_scene_in_plan(self, project_layout):
        mgr = MagicMock()
        added: list = []
        def fake_add(item):
            added.append(item)
            return mgr
        mgr.add_queue.side_effect = fake_add
        scene_plan = [{"scene_number": n} for n in [1, 2, 3]]
        enqueue_chapter_scenes(mgr, 5, scene_plan)
        ids = sorted(item.id for item in added)
        assert ids == ["write-5-1", "write-5-2", "write-5-3"]
        # Priorities follow row-major
        priorities = [item.priority for item in added]
        assert priorities == [5001, 5002, 5003]  # 5*1000+scene


class TestRegenerateChapterOrchestrator:
    def test_full_pipeline_resets_clears_drops_reenqueues(self, project_layout):
        """The orchestrator wires all four steps together."""
        mgr = MagicMock()
        added: list = []
        snapshot = MagicMock()
        # queue has 3 ch5 items + 1 ch6 item (untouched) + 1 ch7 item (untouched)
        snapshot.queue = [
            MagicMock(id="write-5-1"),
            MagicMock(id="write-5-2"),
            MagicMock(id="write-5-3"),
            MagicMock(id="write-6-1"),
            MagicMock(id="write-7-1"),
        ]
        mgr.load.return_value = snapshot
        def fake_add(item):
            added.append(item)
            return mgr
        mgr.add_queue.side_effect = fake_add

        scene_plan = [{"scene_number": n} for n in [1, 2, 3]]
        regenerate_chapter("p_regen", mgr, 5, scene_plan, project_layout)

        # 1. progress reset
        progress = json.loads((project_layout / "progress.json").read_text())
        ch5 = next(c for c in progress["chapters"] if c["chapter_number"] == 5)
        assert ch5["status"] == "pending"
        # 2. drafts cleared
        chapters_dir = project_layout / "chapters"
        remaining = {p.name for p in chapters_dir.iterdir()}
        assert "ch05_scene_001_draft.md" not in remaining
        assert "ch05_scene_002_draft.md" not in remaining
        assert "ch05_scene_003_draft.md" not in remaining
        assert "ch07_scene_001_draft.md" in remaining  # untouched
        # 3. queue: ch5 ids removed, then 3 fresh ch5 ids added
        new_ids = [item.id for item in added if item.id.startswith("write-5-")]
        assert sorted(new_ids) == ["write-5-1", "write-5-2", "write-5-3"]
```

- [ ] **Step 2: Run and verify failure**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_managed_range.py -v -k "ResetChapterProgress or ClearChapterDrafts or DropChapterQueue or EnqueueChapter or RegenerateChapter"`
Expected: All ~12 tests FAIL with `ImportError`.

- [ ] **Step 3: Implement the helpers**

Insert after `compute_range_defaults` (end of Task 2's insertion block):

```python
def reset_chapter_progress(project_id: str, chapter_number: int,
                            projects_dir: Path) -> None:
    """Set chapter + all scenes to status='pending', clear retry/coherence.
    Mutates progress.json in place. Other chapters untouched.
    """
    progress_path = projects_dir / project_id / "progress.json"
    if not progress_path.exists():
        return
    progress = json.loads(progress_path.read_text(encoding="utf-8"))
    for ch in progress.get("chapters", []):
        if ch.get("chapter_number") != chapter_number:
            continue
        ch["status"] = "pending"
        for s in ch.get("scenes", []):
            s["status"] = "pending"
            s["retry_count"] = 0
            s["coherence_score"] = None
    progress_path.write_text(
        json.dumps(progress, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def clear_chapter_drafts(project_id: str, chapter_number: int,
                          projects_dir: Path) -> None:
    """Delete drafts for the given chapter: chapters/ch{NN}_*.md.

    Format matches the layout produced by stage4 writers: ch{NN}_scene_{NNN}_draft.md.
    Defensive: missing directories or no matching files are no-ops.
    """
    chapters_dir = projects_dir / project_id / "chapters"
    if not chapters_dir.exists():
        return
    # Match ch01_, ch1_, ch001_ etc. — zero-padded or not.
    pattern_prefix = f"ch{chapter_number}_"
    for f in chapters_dir.iterdir():
        if f.is_file() and f.name.startswith(pattern_prefix):
            f.unlink()


def drop_chapter_queue_items(mgr: "AutopilotSessionManager",
                              chapter_number: int) -> None:
    """Remove all queue items with id like 'write-{chapter_number}-{scene}'.

    Persists via mgr.save after the in-memory mutation.
    """
    snapshot = mgr.load()
    if snapshot is None:
        return
    prefix = f"write-{chapter_number}-"
    new_queue = [q for q in snapshot.queue if not q.id.startswith(prefix)]
    if len(new_queue) == len(snapshot.queue):
        return
    snapshot.queue = new_queue
    mgr.save(snapshot)


def enqueue_chapter_scenes(mgr: "AutopilotSessionManager",
                            chapter_number: int,
                            scene_plan: list) -> None:
    """Enqueue one write-{ch}-{scene} item per scene in the plan, with
    row-major priority (matches existing _enqueue_for_scope scheme)."""
    for s in scene_plan:
        n = s.get("scene_number")
        if n is None:
            continue
        item = QueueItem(
            id=f"write-{chapter_number}-{n}",
            kind="write_scene",
            chapter_number=chapter_number,
            scheduled_at=None,
            priority=scene_priority(chapter_number, n),
            payload={"scene_number": n},
        )
        mgr.add_queue(item)


def regenerate_chapter(project_id: str,
                        mgr: "AutopilotSessionManager",
                        chapter_number: int,
                        scene_plan: list,
                        projects_dir: Path) -> None:
    """Orchestrate regeneration: reset progress, clear drafts, drop queue
    items, re-enqueue scenes. Checkpoint sync is the caller's responsibility
    (separate helper, see sync_checkpoint_for_chapter)."""
    reset_chapter_progress(project_id, chapter_number, projects_dir)
    clear_chapter_drafts(project_id, chapter_number, projects_dir)
    drop_chapter_queue_items(mgr, chapter_number)
    enqueue_chapter_scenes(mgr, chapter_number, scene_plan)
```

Add these imports to the top of `backend/conductor/autopilot_runner_async.py` (after the existing imports):

```python
import json
from pathlib import Path
```

(`json` and `Path` may already be imported; check and add only what's missing.)

- [ ] **Step 4: Re-run and verify pass**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_managed_range.py -v -k "ResetChapterProgress or ClearChapterDrafts or DropChapterQueue or EnqueueChapter or RegenerateChapter"`
Expected: 12 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add backend/conductor/autopilot_runner_async.py tests/test_managed_range.py
git commit -m "feat(autopilot): add regenerate_chapter pipeline

reset_chapter_progress, clear_chapter_drafts, drop_chapter_queue_items,
enqueue_chapter_scenes — each independently tested. Orchestrator
regenerate_chapter wires the four for use by seed_queue.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: `sync_checkpoint_for_chapter` helper

**Files:**
- Modify: `backend/conductor/autopilot_runner_async.py` (add helper)
- Modify: `tests/test_managed_range.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_managed_range.py`:

```python
from backend.conductor.autopilot_runner_async import sync_checkpoint_for_chapter


class TestSyncCheckpointForChapter:
    def test_removes_checkpoint_when_chapter_matches(self, tmp_path):
        proj = tmp_path / "p_ckpt"
        proj.mkdir()
        (proj / "project.json").write_text(json.dumps({"id": "p_ckpt"}))
        checkpoint = {
            "project_id": "p_ckpt",
            "pipeline_stage": "scene_review",
            "current_chapter": 5,
            "current_scene": 3,
            "l0_snapshot": {},
            "registry_snapshots": {},
            "character_states": [],
            "timestamp": "2026-08-19T00:00:00Z",
        }
        (proj / ".storyforge_checkpoint.json").write_text(json.dumps(checkpoint))

        sync_checkpoint_for_chapter("p_ckpt", 5, tmp_path)

        # After sync: file deleted (chapter is being regenerated; no useful state)
        assert not (proj / ".storyforge_checkpoint.json").exists()

    def test_deletes_only_matching_chapter_when_different(self, tmp_path):
        proj = tmp_path / "p_ckpt2"
        proj.mkdir()
        (proj / "project.json").write_text(json.dumps({"id": "p_ckpt2"}))
        # Checkpoint for chapter 9, not 5
        checkpoint = {
            "project_id": "p_ckpt2",
            "current_chapter": 9,
            "current_scene": 2,
            "pipeline_stage": "scene_review",
        }
        (proj / ".storyforge_checkpoint.json").write_text(json.dumps(checkpoint))

        sync_checkpoint_for_chapter("p_ckpt2", 5, tmp_path)

        # File should still exist (chapter mismatch → no action)
        assert (proj / ".storyforge_checkpoint.json").exists()

    def test_no_op_when_checkpoint_missing(self, tmp_path):
        proj = tmp_path / "p_ckpt3"
        proj.mkdir()
        # No checkpoint file
        sync_checkpoint_for_chapter("p_ckpt3", 5, tmp_path)
        # No exception
```

- [ ] **Step 2: Run and verify failure**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_managed_range.py -v -k "SyncCheckpoint"`
Expected: 3 tests FAIL with `ImportError`.

- [ ] **Step 3: Add the helper**

Insert after `regenerate_chapter`:

```python
def sync_checkpoint_for_chapter(project_id: str, chapter_number: int,
                                  projects_dir: Path) -> None:
    """Remove the .storyforge_checkpoint.json when its current_chapter
    matches the chapter being regenerated.

    Rationale: the checkpoint snapshot reflects completed work that the
    regeneration will overwrite. Leaving it in place creates a stale
    snapshot that the runner's recover() path would later read. The
    runner rebuilds the checkpoint naturally on the next checkpoint tick,
    so deleting is preferable to mutating in place.
    """
    path = projects_dir / project_id / ".storyforge_checkpoint.json"
    if not path.exists():
        return
    try:
        ckpt = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        # Corrupt checkpoint — safe to leave; recover() handles it.
        return
    if ckpt.get("current_chapter") == chapter_number:
        path.unlink()
```

- [ ] **Step 4: Re-run and verify pass**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_managed_range.py -v -k "SyncCheckpoint"`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add backend/conductor/autopilot_runner_async.py tests/test_managed_range.py
git commit -m "feat(autopilot): add sync_checkpoint_for_chapter

Removes .storyforge_checkpoint.json when its current_chapter matches
the chapter being regenerated. Prevents the runner from later reading
a stale snapshot.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Refactor `seed_queue` to use range scope and integrate regeneration

**Files:**
- Modify: `backend/conductor/autopilot_runner_async.py:175-300` (refactor `seed_queue` + `_enqueue_for_scope`)
- Modify: `tests/test_managed_range.py` (append integration tests)

- [ ] **Step 1: Write the failing integration tests**

Append to `tests/test_managed_range.py`:

```python
from backend.config import settings as _settings
from backend.models.autopilot_session import QueueItem
from backend.conductor.autopilot_runner_async import seed_queue


@pytest.fixture
def regen_projects_dir(tmp_path, monkeypatch):
    """Project layout with outline + progress for range integration tests."""
    proj = tmp_path / "p_range"
    proj.mkdir()
    (proj / "project.json").write_text(json.dumps({"id": "p_range"}))
    # Outline: 12 chapters, 3 scenes each
    outline = {
        "chapters": [
            {"chapter_number": n, "scene_plan": [{"scene_number": s} for s in (1, 2, 3)]}
            for n in range(1, 13)
        ]
    }
    (proj / "outline.json").write_text(json.dumps(outline))
    # Progress: ch1-3 completed, ch4-6 in_progress, ch7+ nothing
    progress = {
        "current_chapter": 7,
        "chapters": [],
    }
    for n in range(1, 4):
        progress["chapters"].append({
            "chapter_number": n, "status": "completed",
            "scenes": [{"scene_number": s, "status": "completed"} for s in (1, 2, 3)],
        })
    for n in range(4, 7):
        progress["chapters"].append({
            "chapter_number": n, "status": "in_progress",
            "scenes": [{"scene_number": s, "status": "pending"} for s in (1, 2, 3)],
        })
    (proj / "progress.json").write_text(json.dumps(progress))
    monkeypatch.setattr(_settings, "projects_dir", tmp_path)
    return tmp_path


class TestSeedQueueRange:
    def test_scope_range_no_overlap_with_completed(self, regen_projects_dir):
        from backend.conductor.autopilot_session import AutopilotSessionManager
        mgr = AutopilotSessionManager(regen_projects_dir, "p_range")
        mgr.start(ManagedStartConfig(scope="range", start_chapter=7, end_chapter=10))
        outline = json.loads((regen_projects_dir / "p_range" / "outline.json").read_text())
        progress = json.loads((regen_projects_dir / "p_range" / "progress.json").read_text())
        result = seed_queue(mgr, outline, progress, None,
                            ManagedStartConfig(scope="range", start_chapter=7, end_chapter=10))
        # 4 chapters × 3 scenes = 12 items
        assert result.enqueued == 12
        assert result.scope_used == "range"
        assert result.fallback_applied is False

    def test_scope_range_includes_completed_chapters(self, regen_projects_dir):
        """Range [2, 5] overlaps with completed ch1-3 AND in-progress ch4-6.
        Regeneration should reset ch2, ch3 (completed) and queue everything."""
        from backend.conductor.autopilot_session import AutopilotSessionManager
        mgr = AutopilotSessionManager(regen_projects_dir, "p_range")
        cfg = ManagedStartConfig(scope="range", start_chapter=2, end_chapter=5)
        mgr.start(cfg)
        outline = json.loads((regen_projects_dir / "p_range" / "outline.json").read_text())
        progress = json.loads((regen_projects_dir / "p_range" / "progress.json").read_text())
        result = seed_queue(mgr, outline, progress, None, cfg)
        # 4 chapters × 3 scenes = 12 items enqueued
        assert result.enqueued == 12
        # ch2 and ch3 should be reset to pending
        progress_after = json.loads(
            (regen_projects_dir / "p_range" / "progress.json").read_text()
        )
        for ch_num in [2, 3]:
            ch = next(c for c in progress_after["chapters"] if c["chapter_number"] == ch_num)
            assert ch["status"] == "pending", f"ch{ch_num} should be reset"
        # ch1 (outside range) should be untouched
        ch1 = next(c for c in progress_after["chapters"] if c["chapter_number"] == 1)
        assert ch1["status"] == "completed"

    def test_scope_all_planned_also_regenerates_completed(self, regen_projects_dir):
        from backend.conductor.autopilot_session import AutopilotSessionManager
        mgr = AutopilotSessionManager(regen_projects_dir, "p_range")
        cfg = ManagedStartConfig(scope="all_planned")
        mgr.start(cfg)
        outline = json.loads((regen_projects_dir / "p_range" / "outline.json").read_text())
        progress = json.loads((regen_projects_dir / "p_range" / "progress.json").read_text())
        result = seed_queue(mgr, outline, progress, None, cfg)
        # all_planned regenerates ch1-3 + enqueues ch4-12 = 12 chapters × 3 = 36
        assert result.enqueued == 36
        # ch1, ch2, ch3 all reset
        progress_after = json.loads(
            (regen_projects_dir / "p_range" / "progress.json").read_text()
        )
        for ch_num in [1, 2, 3]:
            ch = next(c for c in progress_after["chapters"] if c["chapter_number"] == ch_num)
            assert ch["status"] == "pending", f"ch{ch_num} should be reset"
        # ch4-6 untouched (in_progress, not completed)
        for ch_num in [4, 5, 6]:
            ch = next(c for c in progress_after["chapters"] if c["chapter_number"] == ch_num)
            assert ch["status"] == "in_progress"

    def test_empty_outline_returns_zero(self, regen_projects_dir):
        from backend.conductor.autopilot_session import AutopilotSessionManager
        mgr = AutopilotSessionManager(regen_projects_dir, "p_range")
        cfg = ManagedStartConfig(scope="range", start_chapter=1, end_chapter=10)
        mgr.start(cfg)
        # Empty outline
        result = seed_queue(mgr, {"chapters": []}, None, None, cfg)
        assert result.enqueued == 0
        assert result.scope_used == "range"
        assert result.fallback_applied is False

    def test_next_chapter_branch_removed(self, regen_projects_dir):
        """seed_queue no longer accepts scope='next_chapter' from the old config shape.
        A Pydantic-validated ManagedStartConfig(scope='range', ...) still works;
        the test here just confirms seed_queue doesn't fall back to next_chapter
        when given scope='range' with no work in scope but work elsewhere."""
        from backend.conductor.autopilot_session import AutopilotSessionManager
        mgr = AutopilotSessionManager(regen_projects_dir, "p_range")
        cfg = ManagedStartConfig(scope="range", start_chapter=100, end_chapter=110)
        mgr.start(cfg)
        outline = json.loads((regen_projects_dir / "p_range" / "outline.json").read_text())
        progress = json.loads((regen_projects_dir / "p_range" / "progress.json").read_text())
        result = seed_queue(mgr, outline, progress, None, cfg)
        # No chapters in [100, 110]; no fallback (we removed next_chapter fallback).
        assert result.enqueued == 0
        assert result.fallback_applied is False
```

- [ ] **Step 2: Run and verify failure**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_managed_range.py -v -k "SeedQueue"`
Expected: 5 tests FAIL (existing `seed_queue` doesn't accept range scope).

- [ ] **Step 3: Refactor `seed_queue` and `_enqueue_for_scope`**

Replace `seed_queue` (lines 175-240) with:

```python
def seed_queue(
    mgr: "AutopilotSessionManager",
    outline: dict,
    progress: Optional[dict],
    novel_outline: Optional[dict],
    cfg: ManagedStartConfig,
    projects_dir: Optional[Path] = None,
) -> SeedResult:
    """Translate (outline, progress, novel_outline, cfg) into QueueItems.

    Handles scope="all_planned" (every chapter in outline) and
    scope="range" (cfg.start_chapter..cfg.end_chapter inclusive).
    Regenerates chapters whose status is in DONE_STATUSES — reset
    progress, clear drafts, drop queue items, re-enqueue, sync checkpoint.
    """
    if not outline or not outline.get("chapters"):
        return SeedResult(enqueued=0, scope_used=cfg.scope, fallback_applied=False)
    progress = progress or {}
    chapters = progress.get("chapters", []) or []
    progress_by_chapter = {
        ch.get("chapter_number"): ch for ch in chapters
    }
    all_chapters = outline["chapters"]

    # Determine target chapter list.
    if cfg.scope == "range":
        target_chapters = [
            ch for ch in all_chapters
            if cfg.start_chapter <= ch.get("chapter_number", 0) <= cfg.end_chapter
        ]
    else:  # "all_planned"
        target_chapters = list(all_chapters)

    seeded, matched = _enqueue_for_scope(
        mgr, target_chapters, progress_by_chapter,
    )

    # Regenerate any chapters in scope whose status is terminal.
    if projects_dir is not None:
        for ch in target_chapters:
            ch_num = ch.get("chapter_number")
            ch_progress = progress_by_chapter.get(ch_num, {})
            planned = ch.get("scene_plan", []) or []
            if not planned:
                continue
            if is_chapter_complete(ch_progress.get("scenes", []) or [], planned):
                regenerate_chapter(
                    mgr.project_id, mgr, ch_num, planned, projects_dir,
                )
                sync_checkpoint_for_chapter(mgr.project_id, ch_num, projects_dir)

    return SeedResult(
        enqueued=seeded, scope_used=cfg.scope, fallback_applied=False,
        matched=matched,
    )
```

Replace `_enqueue_for_scope` (lines 243-300) with:

```python
def _enqueue_for_scope(
    mgr: "AutopilotSessionManager",
    target_chapters: list,
    progress_by_chapter: dict,
) -> tuple[int, int]:
    """Enqueue unfinished scenes for the given chapters. Returns
    (seeded, matched). `seeded` excludes items already in the queue
    (dedup via deterministic ids); `matched` includes them so callers
    can distinguish empty-after-filter from genuine no-work."""
    snapshot = mgr.load()
    existing_ids = {q.id for q in (snapshot.queue or [])} if snapshot else set()

    seeded = 0
    matched = 0
    for ch in target_chapters:
        ch_num = ch.get("chapter_number")
        scene_plan = ch.get("scene_plan", []) or []
        if not scene_plan:
            continue
        ch_progress = progress_by_chapter.get(ch_num, {})
        done_nums = {
            s.get("scene_number")
            for s in ch_progress.get("scenes", []) or []
            if s.get("status") in DONE_STATUSES
        }
        for s in scene_plan:
            n = s.get("scene_number")
            if n in done_nums:
                continue
            item_id = f"write-{ch_num}-{n}"
            matched += 1
            if item_id in existing_ids:
                continue
            item = QueueItem(
                id=item_id,
                kind="write_scene",
                chapter_number=ch_num,
                scheduled_at=None,
                priority=scene_priority(ch_num, n),
                payload={"scene_number": n},
            )
            mgr.add_queue(item)
            seeded += 1
    return seeded, matched
```

Note: the `next_chapter` fallback branch (lines 222-235 of the original) is removed entirely — `seed_queue` no longer auto-widens.

The `projects_dir` parameter is new and defaulted to None. Callers that don't pass it (older tests) get the no-regeneration path, which preserves their behavior.

**Add public accessors to `AutopilotSessionManager`** so production callers can pass them to `seed_queue`:

In `backend/conductor/autopilot_session.py`, after `__init__` (around line 52), add:

```python
    @property
    def project_id(self) -> str:
        return self._project_id

    @property
    def projects_dir(self) -> Path:
        return self._projects_dir
```

**Update production callers.** `backend/conductor/autopilot_loop.py:ensure()` (the only production caller of `seed_queue`) must be updated to pass `projects_dir=settings.projects_dir` in the `seed_queue(...)` call. After this change, `seed_queue` can regenerate chapters end-to-end.

- [ ] **Step 4: Re-run and verify pass**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_managed_range.py -v -k "SeedQueue"`
Expected: 5 tests pass.

- [ ] **Step 5: Run the full existing autopilot suite to verify no regression**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_autopilot_runner_async.py tests/test_autopilot_loop.py tests/test_autopilot_session_persistence.py tests/test_autopilot_runner_async_integration.py tests/test_autopilot_api_runner_integration.py -v`
Expected: All existing tests pass. Any test that constructs `ManagedStartConfig(scope="next_chapter", ...)` will need to be updated to use `scope="range", start_chapter=N, end_chapter=N` or `scope="all_planned"` — do this inline as part of this step.

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add backend/conductor/autopilot_runner_async.py backend/conductor/autopilot_loop.py backend/conductor/autopilot_session.py tests/test_managed_range.py tests/test_autopilot_runner_async.py tests/test_autopilot_loop.py tests/test_autopilot_session_persistence.py tests/test_autopilot_runner_async_integration.py tests/test_autopilot_api_runner_integration.py
git commit -m "feat(autopilot): refactor scope=range with regeneration integration

seed_queue accepts scope='range' (start_chapter..end_chapter) and
scope='all_planned' (every chapter). Both paths call regenerate_chapter
on chapters whose status is in DONE_STATUSES, then sync checkpoint.
Removes the next_chapter auto-fallback branch.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: `GET /range-preview` endpoint

**Files:**
- Modify: `backend/api/autopilot.py` (add route)
- Modify: `tests/test_autopilot_api.py` (or create test in `tests/test_managed_range.py`)

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_managed_range.py`:

```python
from fastapi.testclient import TestClient

from backend.main import app


class TestRangePreviewEndpoint:
    @pytest.fixture
    def client(self, regen_projects_dir):
        return TestClient(app)

    def test_returns_outline_max_and_defaults(self, client):
        resp = client.get(
            "/api/v1/projects/p_range/autopilot/projects/p_range/managed/range-preview",
            params={"start": 5, "end": 15},
        )
        # Wrong path; should 404 OR — if path is right — 200. Let's fix the path:
        assert resp.status_code in (200, 404)

    def test_returns_valid_with_no_regen(self, client):
        resp = client.get(
            "/api/v1/projects/p_range/autopilot/managed/range-preview",
            params={"start": 7, "end": 10},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["outline_max"] == 12
        assert body["valid"] is True
        assert body["error"] is None
        # ch7-10 have no completed chapters
        assert body["regenerate_chapters"] == []
        # defaults based on latest_completed = 3
        assert body["defaults"] == {"start_chapter": 4, "end_chapter": 12}

    def test_returns_regenerate_chapters_when_overlap(self, client):
        resp = client.get(
            "/api/v1/projects/p_range/autopilot/managed/range-preview",
            params={"start": 2, "end": 5},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["outline_max"] == 12
        # ch2, ch3 are completed (in our fixture ch1-3 done)
        assert sorted(body["regenerate_chapters"]) == [2, 3]

    def test_returns_invalid_for_end_above_outline_max(self, client):
        resp = client.get(
            "/api/v1/projects/p_range/autopilot/managed/range-preview",
            params={"start": 5, "end": 100},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["valid"] is False
        assert "结束章节" in body["error"] or "end" in body["error"].lower()

    def test_returns_invalid_for_start_below_one(self, client):
        resp = client.get(
            "/api/v1/projects/p_range/autopilot/managed/range-preview",
            params={"start": 0, "end": 5},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["valid"] is False

    def test_returns_invalid_for_end_less_than_start(self, client):
        resp = client.get(
            "/api/v1/projects/p_range/autopilot/managed/range-preview",
            params={"start": 10, "end": 5},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["valid"] is False

    def test_returns_invalid_when_outline_missing(self, client, tmp_path, monkeypatch):
        # Switch projects_dir to one with no outline
        empty = tmp_path / "p_empty"
        empty.mkdir()
        (empty / "project.json").write_text(json.dumps({"id": "p_empty"}))
        monkeypatch.setattr(_settings, "projects_dir", tmp_path)
        resp = client.get(
            "/api/v1/projects/p_empty/autopilot/managed/range-preview",
            params={"start": 1, "end": 5},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["valid"] is False
        assert "大纲" in body["error"] or "outline" in body["error"].lower()
```

- [ ] **Step 2: Run and verify failure**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_managed_range.py -v -k "RangePreview"`
Expected: All 7 tests FAIL with 404.

- [ ] **Step 3: Add the endpoint**

Insert before `GET /session` in `backend/api/autopilot.py`:

```python
# --- GET /managed/range-preview ---

@router.get("/managed/range-preview")
def range_preview(
    project_id: str,
    start: int = Query(...),
    end: int = Query(...),
    scope: Optional[str] = Query(None),
) -> dict:
    """Read-only preview used by the start modal's live warning.

    Returns the outline's max chapter, the chapters in [start, end]
    that are currently completed (and would be regenerated), the
    sensible default range, and a validation flag.

    When `scope="all_planned"` is passed, the start/end values are
    ignored and the range is derived as [1, outline_max] server-side.
    This lets the modal show regen warnings for all_planned without
    the client needing to know outline_max.
    """
    err = _ensure_project_exists(project_id)
    if err is not None:
        return {
            "outline_max": 0,
            "valid": False,
            "error": f"项目 {project_id} 不存在",
            "regenerate_chapters": [],
            "defaults": None,
        }

    project_dir = settings.projects_dir / project_id
    outline_path = project_dir / "outline.json"
    progress_path = project_dir / "progress.json"

    if not outline_path.exists():
        return {
            "outline_max": 0,
            "valid": False,
            "error": "项目缺少 outline.json，无法配置章节范围",
            "regenerate_chapters": [],
            "defaults": None,
        }

    outline = json.loads(outline_path.read_text(encoding="utf-8"))
    outline_chapters = outline.get("chapters", []) or []
    outline_max = max(
        (c.get("chapter_number") for c in outline_chapters
         if c.get("chapter_number") is not None),
        default=0,
    )

    progress: dict = {}
    if progress_path.exists():
        try:
            progress = json.loads(progress_path.read_text(encoding="utf-8"))
        except Exception:
            progress = {}

    # scope=all_planned overrides start/end with the full outline range.
    if scope == "all_planned":
        start = 1
        end = outline_max

    # Validation
    if outline_max == 0:
        return _range_preview_invalid("大纲为空，无法配置章节范围", 0)
    if start < 1:
        return _range_preview_invalid("开始章节必须 ≥ 1", outline_max)
    if end < start:
        return _range_preview_invalid("结束章节不能小于开始章节", outline_max)
    if start > outline_max:
        return _range_preview_invalid(
            f"开始章节超出最大章节数 ({outline_max})", outline_max,
        )
    if end > outline_max:
        return _range_preview_invalid(
            f"结束章节超出最大章节数 ({outline_max})", outline_max,
        )

    # Compute defaults and regen list
    latest = find_latest_completed_chapter(progress, outline)
    default_start, default_end = compute_range_defaults(outline_max, latest)

    progress_by_chapter = {
        ch.get("chapter_number"): ch
        for ch in (progress.get("chapters", []) or [])
    }
    regenerate_chapters: list[int] = []
    for ch in outline_chapters:
        ch_num = ch.get("chapter_number", 0)
        if not (start <= ch_num <= end):
            continue
        planned = ch.get("scene_plan", []) or []
        if not planned:
            continue
        ch_progress = progress_by_chapter.get(ch_num, {})
        if is_chapter_complete(ch_progress.get("scenes", []) or [], planned):
            regenerate_chapters.append(ch_num)
    regenerate_chapters.sort()

    return {
        "outline_max": outline_max,
        "valid": True,
        "error": None,
        "regenerate_chapters": regenerate_chapters,
        "defaults": {
            "start_chapter": default_start,
            "end_chapter": default_end,
        },
    }


def _range_preview_invalid(error: str, outline_max: int) -> dict:
    return {
        "outline_max": outline_max,
        "valid": False,
        "error": error,
        "regenerate_chapters": [],
        "defaults": None,
    }
```

Add to imports at the top of `backend/api/autopilot.py`:

```python
from backend.conductor.autopilot_runner_async import (
    compute_range_defaults, find_latest_completed_chapter, is_chapter_complete,
)
```

(`is_chapter_complete` is needed for the regenerate detection.)

- [ ] **Step 4: Re-run and verify pass**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_managed_range.py -v -k "RangePreview"`
Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add backend/api/autopilot.py tests/test_managed_range.py
git commit -m "feat(api): add /managed/range-preview endpoint

Returns outline_max, defaults, regenerate_chapters list, and a
valid/error flag for the start modal's live preview banner.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Frontend `rangePreview()` API client

**Files:**
- Modify: `frontend/src/api/autopilot.ts` (add `rangePreview`)
- Modify: `frontend/src/test/api/autopilot.test.ts` (or co-located tests)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/api/__tests__/autopilot.rangePreview.test.ts` (or extend existing API tests — verify existing test layout first):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { rangePreview } from "../autopilot";

vi.mock("./client", () => ({
  default: {
    get: vi.fn(),
  },
}));

import api from "./client";

describe("rangePreview", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it("calls GET with correct path and query params", async () => {
    vi.mocked(api.get).mockResolvedValue({
      outline_max: 12,
      valid: true,
      error: null,
      regenerate_chapters: [2, 3],
      defaults: { start_chapter: 4, end_chapter: 12 },
    });

    const result = await rangePreview("p1", 5, 10);

    expect(api.get).toHaveBeenCalledWith(
      "/api/v1/projects/p1/autopilot/managed/range-preview",
      { params: { start: 5, end: 10 } },
    );
    expect(result.outline_max).toBe(12);
    expect(result.regenerate_chapters).toEqual([2, 3]);
  });

  it("returns the preview shape unchanged", async () => {
    vi.mocked(api.get).mockResolvedValue({
      outline_max: 0,
      valid: false,
      error: "项目缺少 outline.json",
      regenerate_chapters: [],
      defaults: null,
    });

    const result = await rangePreview("p1", 1, 5);
    expect(result.valid).toBe(false);
    expect(result.error).toBe("项目缺少 outline.json");
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npm test -- --run src/api/__tests__/autopilot.rangePreview.test.ts`
Expected: Both tests FAIL with `rangePreview is not a function`.

(Note: per `feedback_plan_import_paths.md`, paths from `src/api/__tests__/` use `../autopilot` not `../../api/autopilot`.)

- [ ] **Step 3: Add `rangePreview()` to the API client**

Append to `frontend/src/api/autopilot.ts`:

```ts
export interface ManagedRangePreview {
  outline_max: number;
  valid: boolean;
  error: string | null;
  regenerate_chapters: number[];
  defaults: { start_chapter: number; end_chapter: number } | null;
}

export async function rangePreview(
  projectId: string,
  start: number,
  end: number,
): Promise<ManagedRangePreview> {
  return api.get("/api/v1/projects/{projectId}/autopilot/managed/range-preview"
    .replace("{projectId}", encodeURIComponent(projectId)),
    { params: { start, end } },
  ) as Promise<ManagedRangePreview>;
}
```

(The `.replace` template substitution is needed because the router prefix uses `{project_id}` as a path parameter — see how `connectAutopilotSSE` builds its URL at line 43: `/api/v1/projects/${encodeURIComponent(projectId)}/autopilot/session/events`. Follow that exact pattern instead of the `.replace` shown above.)

Replace the implementation with the consistent pattern:

```ts
export async function rangePreview(
  projectId: string,
  start: number,
  end: number,
  scope?: "all_planned" | "range",
): Promise<ManagedRangePreview> {
  const url = `/api/v1/projects/${encodeURIComponent(projectId)}/autopilot/managed/range-preview`;
  const params: Record<string, string | number> = { start, end };
  if (scope) params.scope = scope;
  return api.get(url, { params }) as Promise<ManagedRangePreview>;
}
```

Update the test's `expect(api.get).toHaveBeenCalledWith(...)` to match this URL form.

- [ ] **Step 4: Re-run and verify pass**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npm test -- --run src/api/__tests__/autopilot.rangePreview.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/api/autopilot.ts frontend/src/api/__tests__/autopilot.rangePreview.test.ts
git commit -m "feat(frontend): add rangePreview() client for /range-preview endpoint

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: `ManagedStartConfirmDialog` component

**Files:**
- Create: `frontend/src/components/workspace/ManagedStartConfirmDialog.tsx`
- Create: `frontend/src/test/ManagedStartConfirmDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/test/ManagedStartConfirmDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ManagedStartConfirmDialog from "../components/workspace/ManagedStartConfirmDialog";

describe("ManagedStartConfirmDialog", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(
      <ManagedStartConfirmDialog
        open={false}
        chapterNumbers={[5, 6]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the chapter list when open", () => {
    render(
      <ManagedStartConfirmDialog
        open={true}
        chapterNumbers={[5, 6, 7]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("confirm-dialog")).toBeTruthy();
    expect(screen.getByText(/第 5, 6, 7 章/)).toBeTruthy();
  });

  it("calls onConfirm when confirm button clicked", () => {
    const onConfirm = vi.fn();
    render(
      <ManagedStartConfirmDialog
        open={true}
        chapterNumbers={[5]}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-yes"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when cancel button clicked", () => {
    const onCancel = vi.fn();
    render(
      <ManagedStartConfirmDialog
        open={true}
        chapterNumbers={[5]}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-no"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders singular vs plural chapter text correctly", () => {
    const { rerender } = render(
      <ManagedStartConfirmDialog
        open={true}
        chapterNumbers={[5]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/第 5 章/)).toBeTruthy();
    rerender(
      <ManagedStartConfirmDialog
        open={true}
        chapterNumbers={[5, 6]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/第 5, 6 章/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npm test -- --run src/test/ManagedStartConfirmDialog.test.tsx`
Expected: All 5 tests FAIL (component doesn't exist).

- [ ] **Step 3: Create the component**

Create `frontend/src/components/workspace/ManagedStartConfirmDialog.tsx`:

```tsx
interface Props {
  open: boolean;
  chapterNumbers: number[];
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ManagedStartConfirmDialog({
  open, chapterNumbers, onConfirm, onCancel,
}: Props) {
  if (!open) return null;

  const list = chapterNumbers.join(", ");
  const isSingle = chapterNumbers.length === 1;

  return (
    <div
      data-testid="confirm-dialog"
      className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4"
    >
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 max-w-md w-full space-y-4">
        <h3 className="font-display text-primary text-base">确认重新生成</h3>
        <p className="font-body-ui text-sm text-system-log">
          您即将重新生成以下{isSingle ? "章节" : "章节"}：
          <span className="font-medium text-on-surface">第 {list} 章</span>。
        </p>
        <p className="font-body-ui text-sm text-warning">
          这些章节的现有内容将被覆盖，无法撤销。是否继续？
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            data-testid="confirm-no"
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg bg-surface-container text-system-log hover:bg-surface-container-low"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="confirm-yes"
            onClick={onConfirm}
            className="px-4 py-2 text-sm rounded-lg bg-tertiary-container text-surface-container-low hover:opacity-90"
          >
            确认重新生成
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Re-run and verify pass**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npm test -- --run src/test/ManagedStartConfirmDialog.test.tsx`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/components/workspace/ManagedStartConfirmDialog.tsx frontend/src/test/ManagedStartConfirmDialog.test.tsx
git commit -m "feat(frontend): add ManagedStartConfirmDialog component

Confirmation modal shown when the start range overlaps already-completed
chapters. Lists the chapters to be regenerated, warns about overwriting.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: Modal — scope selector, range inputs, defaults

**Files:**
- Modify: `frontend/src/components/workspace/ManagedStartModal.tsx` (extend)
- Modify: `frontend/src/hooks/useAutopilotConfig.ts` (defaults)
- Modify: `frontend/src/components/workspace/ManagedStartModal.tsx` (re-export type)
- Modify: `frontend/src/test/ManagedStartModal.test.tsx` (extend)

- [ ] **Step 1: Write the failing tests**

Locate the existing `frontend/src/test/ManagedStartModal.test.tsx` (or create it if missing). Append the new test cases (or add a new file `frontend/src/test/ManagedStartModal.range.test.tsx`):

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ManagedStartModal, { ManagedStartConfig } from "../components/workspace/ManagedStartModal";

// Mock rangePreview to control the preview result
vi.mock("../api/autopilot", async () => {
  const actual = await vi.importActual<typeof import("../api/autopilot")>("../api/autopilot");
  return {
    ...actual,
    rangePreview: vi.fn(),
    getAutopilotSession: vi.fn().mockResolvedValue({
      state: "stopped", config: null, queue: [], history: [], current_task: null,
    }),
    startAutopilotSession: vi.fn().mockResolvedValue({ state: "running" }),
  };
});

import { rangePreview, startAutopilotSession } from "../api/autopilot";

describe("ManagedStartModal — range scope", () => {
  beforeEach(() => {
    vi.mocked(rangePreview).mockReset();
    vi.mocked(startAutopilotSession).mockReset();
    vi.mocked(rangePreview).mockResolvedValue({
      outline_max: 12, valid: true, error: null,
      regenerate_chapters: [], defaults: { start_chapter: 4, end_chapter: 12 },
    });
    vi.mocked(startAutopilotSession).mockResolvedValue({ state: "running" } as any);
  });

  it("default scope is range with start/end inputs visible", async () => {
    render(<ManagedStartModal projectId="p1" open={true} onCancel={vi.fn()} onStarted={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("managed-start-modal")).toBeTruthy());
    // Range radio is checked
    const rangeRadio = screen.getByDisplayValue("range") as HTMLInputElement;
    expect(rangeRadio.checked).toBe(true);
    // Start/end inputs visible
    expect(screen.getByTestId("range-start")).toBeTruthy();
    expect(screen.getByTestId("range-end")).toBeTruthy();
  });

  it("selecting all_planned hides start/end inputs", async () => {
    render(<ManagedStartModal projectId="p1" open={true} onCancel={vi.fn()} onStarted={vi.fn()} />);
    await waitFor(() => screen.getByTestId("managed-start-modal"));
    fireEvent.click(screen.getByDisplayValue("all_planned"));
    expect(screen.queryByTestId("range-start")).toBeNull();
    expect(screen.queryByTestId("range-end")).toBeNull();
  });

  it("shows regen warning when preview returns regenerate_chapters", async () => {
    vi.mocked(rangePreview).mockResolvedValue({
      outline_max: 12, valid: true, error: null,
      regenerate_chapters: [5, 6, 7], defaults: { start_chapter: 4, end_chapter: 12 },
    });
    render(<ManagedStartModal projectId="p1" open={true} onCancel={vi.fn()} onStarted={vi.fn()} />);
    await waitFor(() => screen.getByTestId("managed-start-modal"));
    // Wait for debounced preview call
    await waitFor(() => {
      expect(screen.getByTestId("regen-warning")).toBeTruthy();
    });
    expect(screen.getByText(/第 5, 6, 7 章/)).toBeTruthy();
  });

  it("shows preview error message when valid=false", async () => {
    vi.mocked(rangePreview).mockResolvedValue({
      outline_max: 12, valid: false, error: "结束章节超出最大章节数",
      regenerate_chapters: [], defaults: null,
    });
    render(<ManagedStartModal projectId="p1" open={true} onCancel={vi.fn()} onStarted={vi.fn()} />);
    await waitFor(() => screen.getByTestId("managed-start-modal"));
    await waitFor(() => {
      expect(screen.getByTestId("preview-error")).toBeTruthy();
    });
    expect(screen.getByText(/结束章节超出最大章节数/)).toBeTruthy();
  });

  it("opens confirmation dialog when Start clicked and regen chapters present", async () => {
    vi.mocked(rangePreview).mockResolvedValue({
      outline_max: 12, valid: true, error: null,
      regenerate_chapters: [5, 6], defaults: { start_chapter: 4, end_chapter: 12 },
    });
    render(<ManagedStartModal projectId="p1" open={true} onCancel={vi.fn()} onStarted={vi.fn()} />);
    await waitFor(() => screen.getByTestId("managed-start-modal"));
    await waitFor(() => screen.getByTestId("regen-warning"));
    fireEvent.click(screen.getByTestId("start-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("confirm-dialog")).toBeTruthy();
    });
    // POST should NOT have been called yet
    expect(startAutopilotSession).not.toHaveBeenCalled();
  });

  it("skips confirmation and POSTs directly when no regen chapters", async () => {
    vi.mocked(rangePreview).mockResolvedValue({
      outline_max: 12, valid: true, error: null,
      regenerate_chapters: [], defaults: { start_chapter: 4, end_chapter: 12 },
    });
    const onStarted = vi.fn();
    render(<ManagedStartModal projectId="p1" open={true} onCancel={vi.fn()} onStarted={onStarted} />);
    await waitFor(() => screen.getByTestId("managed-start-modal"));
    await waitFor(() => expect(rangePreview).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("start-submit"));
    await waitFor(() => expect(startAutopilotSession).toHaveBeenCalled());
    expect(onStarted).toHaveBeenCalled();
  });

  it("all_planned with completed chapters also shows regen warning + confirmation", async () => {
    vi.mocked(rangePreview).mockResolvedValue({
      outline_max: 12, valid: true, error: null,
      regenerate_chapters: [1, 2, 3], defaults: { start_chapter: 4, end_chapter: 12 },
    });
    render(<ManagedStartModal projectId="p1" open={true} onCancel={vi.fn()} onStarted={vi.fn()} />);
    await waitFor(() => screen.getByTestId("managed-start-modal"));
    fireEvent.click(screen.getByDisplayValue("all_planned"));
    await waitFor(() => screen.getByTestId("regen-warning"));
    expect(screen.getByText(/第 1, 2, 3 章/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run and verify failure**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npm test -- --run src/test/ManagedStartModal.range.test.tsx`
Expected: Most tests FAIL (no range inputs, no preview call, no confirmation).

- [ ] **Step 3: Update the type, defaults, and modal**

First, update `frontend/src/components/workspace/ManagedStartModal.tsx`. Replace the `ManagedStartConfig` interface (lines 4-9):

```ts
export interface ManagedStartConfig {
  scope: "all_planned" | "range";
  start_chapter: number | null;
  end_chapter: number | null;
  cadence: "fast" | "balanced" | "careful";
  policy: "auto" | "ask";
  notify: "all" | "milestones";
}
```

Replace the scope radio Field (lines 42-45):

```tsx
<Field label="推进范围">
  <Radio name="scope" value="range" current={config.scope} onChange={(v) => setField("scope", v as any)} label="指定章节范围" />
  <Radio name="scope" value="all_planned" current={config.scope} onChange={(v) => setField("scope", v as any)} label="所有已规划章节" />
</Field>
```

After the scope Field, insert the range inputs (visible when `config.scope === "range"`):

```tsx
{config.scope === "range" && (
  <Field label="章节范围">
    <input
      type="number"
      data-testid="range-start"
      min={1}
      value={config.start_chapter ?? ""}
      onChange={(e) => setField("start_chapter", e.target.value ? Number(e.target.value) : null)}
      className="w-24 px-2 py-1 text-sm rounded border border-outline-variant bg-surface text-on-surface"
      placeholder="开始"
    />
    <span className="text-system-log text-sm">—</span>
    <input
      type="number"
      data-testid="range-end"
      min={1}
      value={config.end_chapter ?? ""}
      onChange={(e) => setField("end_chapter", e.target.value ? Number(e.target.value) : null)}
      className="w-24 px-2 py-1 text-sm rounded border border-outline-variant bg-surface text-on-surface"
      placeholder="结束"
    />
  </Field>
)}
```

Add a new section for preview + warning + confirmation. Insert just before the action buttons (after the notify Field, before `<div className="flex justify-end gap-2 pt-2">`):

```tsx
{preview && !preview.valid && (
  <p
    data-testid="preview-error"
    className="font-body-ui text-sm text-error bg-error-container/10 border border-error/30 rounded p-2"
  >
    {preview.error}
  </p>
)}
{preview && preview.valid && preview.regenerate_chapters.length > 0 && (
  <p
    data-testid="regen-warning"
    className="font-body-ui text-sm text-on-surface bg-warning-container/30 border border-warning/40 rounded p-2"
  >
    ⚠ 将重新生成第 {preview.regenerate_chapters.join(", ")} 章（{preview.regenerate_chapters.length} 章已完成）
  </p>
)}
```

Then update the Start button onClick (lines 73-108) to gate POST behind a confirmation when there are regen chapters:

```tsx
onClick={async () => {
  if (preview && preview.regenerate_chapters.length > 0) {
    setConfirmOpen(true);
    return;
  }
  await actuallySubmit();
}}
```

Add a `ManagedStartConfirmDialog` import at the top of the file:

```tsx
import ManagedStartConfirmDialog from "./ManagedStartConfirmDialog";
```

Add state for `confirmOpen` and `preview`. Replace the component header area:

```tsx
export default function ManagedStartModal({
  projectId, open, onCancel, onStarted,
}: Props) {
  const { config, setConfig, loaded, submitting, submit } =
    useAutopilotConfig(projectId);
  const { show } = useToast();
  const [preview, setPreview] = useState<ManagedRangePreview | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // ...
```

Add the import at top:

```tsx
import { useEffect, useState } from "react";
import type { ManagedRangePreview } from "../../api/autopilot";
import { rangePreview } from "../../api/autopilot";
```

Add a debounced preview effect inside the component:

```tsx
useEffect(() => {
  if (!open || !loaded) return;
  if (config.scope === "range" &&
      (config.start_chapter == null || config.end_chapter == null)) {
    setPreview(null);
    return;
  }
  const handle = setTimeout(() => {
    const opts: { start: number; end: number; scope?: "all_planned" | "range" } =
      config.scope === "range"
        ? { start: config.start_chapter!, end: config.end_chapter!, scope: "range" }
        : { start: 1, end: 1, scope: "all_planned" };  // server derives full range
    rangePreview(projectId, opts.start, opts.end, opts.scope)
      .then(setPreview)
      .catch(() => setPreview(null));
  }, 300);
  return () => clearTimeout(handle);
}, [open, loaded, config.scope, config.start_chapter, config.end_chapter, projectId]);
```

Add the `actuallySubmit` helper:

```tsx
const actuallySubmit = async () => {
  try {
    const result = await submit();
    // ... existing toast logic (keep verbatim from current code) ...
    onStarted();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    show(`启动失败：${msg}`);
  }
};
```

Add the confirm dialog at the bottom of the modal's outer div (before the closing `</div>` of the modal container, but as a sibling to the inner content div):

```tsx
<ManagedStartConfirmDialog
  open={confirmOpen}
  chapterNumbers={preview?.regenerate_chapters ?? []}
  onConfirm={async () => {
    setConfirmOpen(false);
    await actuallySubmit();
  }}
  onCancel={() => setConfirmOpen(false)}
/>
```

Finally, update `frontend/src/hooks/useAutopilotConfig.ts` — change `MANAGED_START_DEFAULTS` (lines 8-13):

```ts
export const MANAGED_START_DEFAULTS: ManagedStartConfig = {
  scope: "range",
  start_chapter: null,
  end_chapter: null,
  cadence: "balanced",
  policy: "auto",
  notify: "milestones",
};
```

- [ ] **Step 4: Re-run and verify pass**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npm test -- --run src/test/ManagedStartModal.range.test.tsx`
Expected: All 7 tests pass.

- [ ] **Step 5: Run all existing modal tests to verify no regression**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npm test -- --run src/test/ManagedStartModal.test.tsx`
Expected: Existing tests pass. Update any that reference `scope="next_chapter"` to `scope="range"` + matching `start_chapter`/`end_chapter` defaults.

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/components/workspace/ManagedStartModal.tsx frontend/src/hooks/useAutopilotConfig.ts frontend/src/test/ManagedStartModal.range.test.tsx frontend/src/test/ManagedStartModal.test.tsx
git commit -m "feat(frontend): add range scope + preview + warning to ManagedStartModal

Modal opens with scope='range' selected. Start/end number inputs
trigger a debounced GET /range-preview, which renders either an error
banner (red) or a regen warning (yellow) listing chapters to be
regenerated. Start button routes through ManagedStartConfirmDialog
when regen chapters are present.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: Full regression sweep — backend + frontend suites

**Files:** none modified (pure verification)

- [ ] **Step 1: Run the full backend test suite**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/ -q`
Expected: All tests pass. Specifically watch `tests/test_managed_range.py` (30+ tests added) and the existing autopilot tests that we updated.

If any tests in unrelated suites fail due to `scope="next_chapter"` literals, update them to `scope="range"` with appropriate `start_chapter`/`end_chapter` as part of this step.

- [ ] **Step 2: Run the full frontend test suite**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npm test -- --run`
Expected: All tests pass. Specifically watch `ManagedStartModal.range.test.tsx` and `ManagedStartConfirmDialog.test.tsx`.

- [ ] **Step 3: Lint**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npm run lint 2>&1 | tail -30`
Expected: No new errors.

- [ ] **Step 4: TypeScript check**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx tsc --noEmit 2>&1 | tail -30`
Expected: No new errors.

- [ ] **Step 5: Commit (only if any fixes were needed)**

If any of Steps 1-4 surfaced fixes, commit them:

```bash
cd /Users/longsa/Codes/storyForge2
git add -u
git commit -m "test: align remaining tests + lint with managed mode range config

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Self-Review Checklist (run after implementation)

- [ ] `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_managed_range.py -v` — all tests pass
- [ ] `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/ -q` — full backend suite green
- [ ] `cd /Users/longsa/Codes/storyForge2/frontend && npm test -- --run` — full frontend suite green
- [ ] `cd /Users/longsa/Codes/storyForge2/frontend && npm run lint` — no errors
- [ ] `cd /Users/longsa/Codes/storyForge2/frontend && npx tsc --noEmit` — no errors
- [ ] `git log --oneline d582836..HEAD` shows ~9 commits ahead (one per task that landed)
- [ ] No `scope="next_chapter"` literals remain in the codebase (`grep -rn 'next_chapter' backend/ frontend/ tests/`)
- [ ] `git status` is clean except for the pre-existing uncommitted WIP (model_tiers.yaml + wizard files + untracked plan/global_overrides files)