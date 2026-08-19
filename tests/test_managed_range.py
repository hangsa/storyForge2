"""Tests for managed mode chapter range config and helpers."""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

from backend.models.autopilot_session import ManagedStartConfig
from backend.conductor.autopilot_runner_async import (
    clear_chapter_drafts,
    clear_checkpoint_for_chapter,
    compute_range_defaults,
    drop_chapter_queue_items,
    enqueue_chapter_scenes,
    find_latest_completed_chapter,
    regenerate_chapter,
    reset_chapter_progress,
)
from backend.utils.file_manager import FileManager


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
    def test_resets_status_and_clears_metadata(self, project_layout, tmp_path):
        fm = FileManager(tmp_path)
        reset_chapter_progress(fm, "p_regen", 5)
        progress = json.loads((project_layout / "progress.json").read_text())
        ch5 = next(c for c in progress["chapters"] if c["chapter_number"] == 5)
        assert ch5["status"] == "pending"
        for s in ch5["scenes"]:
            assert s["status"] == "pending"
            assert s["retry_count"] == 0
            assert s["coherence_score"] is None

    def test_does_not_touch_other_chapters(self, project_layout, tmp_path):
        fm = FileManager(tmp_path)
        reset_chapter_progress(fm, "p_regen", 5)
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
    def test_full_pipeline_resets_clears_drops_reenqueues(self, project_layout, tmp_path):
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
        fm = FileManager(tmp_path)
        regenerate_chapter(fm, "p_regen", mgr, 5, scene_plan, project_layout)

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


class TestClearCheckpointForChapter:
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

        clear_checkpoint_for_chapter("p_ckpt", 5, tmp_path)

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

        clear_checkpoint_for_chapter("p_ckpt2", 5, tmp_path)

        # File should still exist (chapter mismatch → no action)
        assert (proj / ".storyforge_checkpoint.json").exists()

    def test_no_op_when_checkpoint_missing(self, tmp_path):
        proj = tmp_path / "p_ckpt3"
        proj.mkdir()
        # No checkpoint file
        clear_checkpoint_for_chapter("p_ckpt3", 5, tmp_path)
        # No exception

    def test_no_op_on_corrupt_json(self, tmp_path):
        proj = tmp_path / "p_ckpt_corrupt"
        proj.mkdir()
        # Invalid JSON in checkpoint file
        (proj / ".storyforge_checkpoint.json").write_text("{not valid json")
        # Should not raise; should leave the corrupt file alone
        clear_checkpoint_for_chapter("p_ckpt_corrupt", 5, tmp_path)
        assert (proj / ".storyforge_checkpoint.json").exists()
