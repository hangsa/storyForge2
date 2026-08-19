"""Unit tests for the pure helpers and async runner/executor that drive
the AutopilotSession queue. Spec: docs/superpowers/specs/2026-07-14-...
§§3-5 (file structure + 6-rule failure table)."""
from __future__ import annotations
import pytest

from backend.conductor.autopilot_runner_async import (
    archive_priority,
    is_chapter_complete,
    scene_priority,
)


def _scene(scene_number: int, status: str = "completed") -> dict:
    return {"scene_number": scene_number, "status": status}


def _plan(*scene_numbers: int) -> list:
    return [{"scene_number": n, "goal": "", "conflict": ""} for n in scene_numbers]


class TestIsChapterComplete:
    """Spec §5 rows 5, 6, 7 + edge cases. 8 cases."""

    def test_full_match_all_completed(self):
        assert is_chapter_complete(
            [_scene(1), _scene(2), _scene(3)],
            _plan(1, 2, 3),
        ) is True

    def test_partial_progress_returns_false(self):
        """Row 5: progress.scenes.length < outline.scene_plan.length."""
        assert is_chapter_complete(
            [_scene(1)], _plan(1, 2, 3),
        ) is False

    def test_progress_longer_than_outline_returns_true(self):
        """Row 6: outline was shortened mid-run; ignore extras."""
        assert is_chapter_complete(
            [_scene(1), _scene(2), _scene(3), _scene(99, "completed")],
            _plan(1, 2, 3),
        ) is True

    def test_zombie_in_progress_returns_false(self):
        """Row 7: last session crashed mid-write; treat as not-yet-done."""
        assert is_chapter_complete(
            [_scene(1), _scene(2, "in_progress")], _plan(1, 2),
        ) is False

    def test_force_passed_counts_as_done(self):
        assert is_chapter_complete(
            [_scene(1, "force_passed"), _scene(2)], _plan(1, 2),
        ) is True

    def test_skipped_counts_as_done(self):
        assert is_chapter_complete(
            [_scene(1, "skipped"), _scene(2)], _plan(1, 2),
        ) is True

    def test_empty_outline_returns_true(self):
        """Edge case: no scenes planned → trivially complete."""
        assert is_chapter_complete([], []) is True

    def test_outline_present_but_progress_empty_returns_false(self):
        assert is_chapter_complete([], _plan(1)) is False


from backend.conductor.autopilot_session import AutopilotSessionManager
from backend.conductor.autopilot_runner_async import seed_queue
from backend.models.autopilot_session import ManagedStartConfig, QueueItem


@pytest.fixture
def projects_dir(tmp_path, monkeypatch):
    import json
    from backend.config import settings
    from backend.api.stage4_writing import fm
    # _write_scene_chapter / _advance_chapter use settings.projects_dir (and the
    # module-level fm.projects_dir bound at import time). Bind both to tmp_path
    # so the executor's file I/O lands in the test's sandbox. monkeypatch
    # auto-reverts both when the test ends, preventing cross-suite state leaks.
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    monkeypatch.setattr(fm, "projects_dir", tmp_path)
    (tmp_path / "p1").mkdir(parents=True, exist_ok=True)
    (tmp_path / "p1" / "project.json").write_text(
        json.dumps({"id": "p1"}), encoding="utf-8"
    )
    return tmp_path


@pytest.fixture
def mgr(projects_dir):
    return AutopilotSessionManager(projects_dir, "p1")


def _write_outline(projects_dir, outline: dict) -> None:
    import json
    (projects_dir / "p1" / "outline.json").write_text(
        json.dumps(outline), encoding="utf-8"
    )


def _write_progress(projects_dir, progress: dict) -> None:
    import json
    (projects_dir / "p1" / "progress.json").write_text(
        json.dumps(progress), encoding="utf-8"
    )


class TestSeedQueue:
    """Spec §4A + §2 row 2. seed_queue is pure: takes inputs, returns count.
    It writes to the manager as a side effect (QueueItems land in mgr.queue)
    so callers can introspect via mgr.load().queue."""

    def test_all_planned_with_no_progress_enqueues_all_scenes(
        self, mgr, projects_dir
    ):
        _write_outline(projects_dir, {"chapters": [
            {"chapter_number": 1, "scene_plan": [
                {"scene_number": 1}, {"scene_number": 2}, {"scene_number": 3},
            ]},
            {"chapter_number": 2, "scene_plan": [
                {"scene_number": 1}, {"scene_number": 2},
            ]},
        ]})
        from backend.conductor.autopilot_runner_async import seed_queue
        n = seed_queue(
            mgr, outline={"chapters": [
                {"chapter_number": 1, "scene_plan": [
                    {"scene_number": 1}, {"scene_number": 2}, {"scene_number": 3},
                ]},
                {"chapter_number": 2, "scene_plan": [
                    {"scene_number": 1}, {"scene_number": 2},
                ]},
            ]},
            progress=None, novel_outline=None, cfg=ManagedStartConfig(),
        )
        assert n.enqueued == 5  # 3 + 2
        s = mgr.load()
        assert len(s.queue) == 5
        # Row-major: chapter_number then scene_number (ch1's scenes all before ch2's).
        # Priority = chapter * 1000 + scene_number.
        ch_scene_pairs = [
            (q.chapter_number, q.payload["scene_number"])
            for q in s.queue if q.kind == "write_scene"
        ]
        assert ch_scene_pairs == [(1, 1), (1, 2), (1, 3), (2, 1), (2, 2)]
        assert [q.priority for q in s.queue if q.kind == "write_scene"] == [
            1001, 1002, 1003, 2001, 2002,
        ]  # noqa: E501

    def test_all_planned_skips_completed_scenes(self, mgr, projects_dir):
        """Spec §5 row 5: progress shorter than outline; only enqueue missing."""
        _write_outline(projects_dir, {"chapters": [
            {"chapter_number": 1, "scene_plan": [
                {"scene_number": 1}, {"scene_number": 2}, {"scene_number": 3},
            ]},
        ]})
        n = seed_queue(
            mgr,
            outline={"chapters": [{"chapter_number": 1, "scene_plan": [
                {"scene_number": 1}, {"scene_number": 2}, {"scene_number": 3},
            ]}]},
            progress={"current_chapter": 1, "chapters": [
                {"chapter_number": 1, "scenes": [
                    {"scene_number": 1, "status": "completed"},
                ]},
            ]},
            novel_outline=None, cfg=ManagedStartConfig(),
        )
        assert n.enqueued == 2  # scenes 2 and 3 only
        nums = [q.payload["scene_number"] for q in mgr.load().queue]
        assert nums == [2, 3]

    def test_next_chapter_scope_only_enqueues_current(self, mgr):
        """scope='range' [2,2] enqueues only chapter 2's unfinished scene."""
        n = seed_queue(
            mgr,
            outline={"chapters": [
                {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
                {"chapter_number": 2, "scene_plan": [{"scene_number": 1}]},
                {"chapter_number": 3, "scene_plan": [{"scene_number": 1}]},
            ]},
            progress={"current_chapter": 2, "chapters": []},
            novel_outline=None,
            cfg=ManagedStartConfig(scope="range", start_chapter=2, end_chapter=2),
        )
        assert n.enqueued == 1
        assert mgr.load().queue[0].chapter_number == 2

    def test_chapter_fully_done_is_skipped(self, mgr):
        """Spec §5 row 6: progress longer than outline → ignore extras; full
        chapter means no new items enqueued for it."""
        n = seed_queue(
            mgr,
            outline={"chapters": [
                {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
            ]},
            progress={"current_chapter": 2, "chapters": [
                {"chapter_number": 1, "scenes": [
                    {"scene_number": 1, "status": "completed"},
                ]},
            ]},
            novel_outline=None, cfg=ManagedStartConfig(),
        )
        assert n.enqueued == 0

    def test_zombie_scene_is_re_enqueued(self, mgr):
        """Spec §5 row 7: in_progress scene is treated as not yet done."""
        n = seed_queue(
            mgr,
            outline={"chapters": [
                {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
            ]},
            progress={"current_chapter": 1, "chapters": [
                {"chapter_number": 1, "scenes": [
                    {"scene_number": 1, "status": "in_progress"},
                ]},
            ]},
            novel_outline=None, cfg=ManagedStartConfig(),
        )
        assert n.enqueued == 1

    def test_returns_zero_when_nothing_to_do(self, mgr):
        from backend.conductor.autopilot_runner_async import seed_queue
        from backend.models.autopilot_session import ManagedStartConfig
        result = seed_queue(
            mgr,
            outline={"chapters": [
                {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
            ]},
            progress={"current_chapter": 2, "chapters": [
                {"chapter_number": 1, "scenes": [
                    {"scene_number": 1, "status": "completed"},
                ]},
            ]},
            novel_outline=None, cfg=ManagedStartConfig(),
        )
        assert result.enqueued == 0
        assert result.scope_used == "all_planned"
        assert result.fallback_applied is False

    def test_seed_queue_is_idempotent_when_called_twice(self, mgr):
        """Bug 2026-07-17 proj_cc4ca4ae: every "启动托管" click called
        seed_queue, and each call appended all 10 scenes again because
        QueueItem ids are deterministic but mgr.add_queue never dedupes.
        Over 3 restarts the queue grew 10→20→30 and history ballooned
        with thousands of `queue_add` events. seed_queue must be idempotent:
        calling it twice on the same mgr without draining the queue must
        leave the queue length unchanged."""
        outline = {"chapters": [
            {"chapter_number": 1, "scene_plan": [
                {"scene_number": 1}, {"scene_number": 2}, {"scene_number": 3},
            ]},
            {"chapter_number": 2, "scene_plan": [
                {"scene_number": 1}, {"scene_number": 2},
            ]},
        ]}
        first = seed_queue(
            mgr, outline=outline, progress=None,
            novel_outline=None, cfg=ManagedStartConfig(),
        )
        assert first.enqueued == 5
        queue_len_after_first = len(mgr.load().queue)
        assert queue_len_after_first == 5

        # Second call: same scope, same mgr, queue not drained.
        # Must not grow. seed_queue reports enqueued=0 because every item
        # is already in the queue.
        second = seed_queue(
            mgr, outline=outline, progress=None,
            novel_outline=None, cfg=ManagedStartConfig(),
        )
        assert second.enqueued == 0
        assert len(mgr.load().queue) == queue_len_after_first

        # Third call: still idempotent.
        third = seed_queue(
            mgr, outline=outline, progress=None,
            novel_outline=None, cfg=ManagedStartConfig(),
        )
        assert third.enqueued == 0
        assert len(mgr.load().queue) == queue_len_after_first

    def test_seed_queue_dedup_across_scope_changes(self, mgr):
        """Calling seed_queue with all_planned after some scenes were already
        queued must not re-add them, regardless of which scope populated the
        queue first."""
        # Simulate a previous start that seeded ch1 scene 1 via the older
        # non-deduping path.
        mgr.add_queue(QueueItem(
            id="write-1-1", kind="write_scene", chapter_number=1,
            scheduled_at=None, priority=21, payload={"scene_number": 1},
        ))
        result = seed_queue(
            mgr,
            outline={"chapters": [
                {"chapter_number": 1, "scene_plan": [
                    {"scene_number": 1}, {"scene_number": 2}, {"scene_number": 3},
                ]},
            ]},
            progress=None, novel_outline=None,
            cfg=ManagedStartConfig(),
        )
        # Only ch1 scene 2 and 3 are new; scene 1 was already in queue.
        assert result.enqueued == 2
        nums = sorted(q.payload["scene_number"] for q in mgr.load().queue
                      if q.kind == "write_scene")
        assert nums == [1, 2, 3]  # no duplicate


class TestSeedQueueNoFallback:
    """v2.1 removed the scope=next_chapter auto-fallback to all_planned.
    Out-of-scope chapters must stay out of scope; the UI surfaces "scope
    had no work" honestly rather than silently widening."""

    def test_no_fallback_when_next_chapter_has_work(self, mgr):
        """Sanity: when the scoped chapter itself has unfinished scenes, no
        fallback should occur and only that chapter's scenes are enqueued."""
        from backend.conductor.autopilot_runner_async import seed_queue
        from backend.models.autopilot_session import ManagedStartConfig
        result = seed_queue(
            mgr,
            outline={"chapters": [
                {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
                {"chapter_number": 2, "scene_plan": [{"scene_number": 1}]},
            ]},
            progress={"current_chapter": 2, "chapters": [
                {"chapter_number": 1, "scenes": [
                    {"scene_number": 1, "status": "completed"},
                ]},
            ]},
            novel_outline=None,
            cfg=ManagedStartConfig(scope="range", start_chapter=2, end_chapter=2),
        )
        assert result.enqueued == 1
        assert result.scope_used == "range"
        assert result.fallback_applied is False

    def test_no_fallback_when_all_planned_scope_used(self, mgr):
        """Sanity: all_planned scope never reports a fallback (no
        auto-widening happens in v2.1)."""
        from backend.conductor.autopilot_runner_async import seed_queue
        from backend.models.autopilot_session import ManagedStartConfig
        result = seed_queue(
            mgr,
            outline={"chapters": [
                {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
            ]},
            progress=None, novel_outline=None,
            cfg=ManagedStartConfig(scope="all_planned"),
        )
        assert result.enqueued == 1
        assert result.scope_used == "all_planned"
        assert result.fallback_applied is False

    def test_returns_zero_with_no_fallback_when_all_truly_done(self, mgr):
        """When all chapters are genuinely complete, seed_queue must still
        return 0 with no fallback (otherwise we'd enqueue phantom scenes)."""
        from backend.conductor.autopilot_runner_async import seed_queue
        from backend.models.autopilot_session import ManagedStartConfig
        result = seed_queue(
            mgr,
            outline={"chapters": [
                {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
            ]},
            progress={"current_chapter": 2, "chapters": [
                {"chapter_number": 1, "scenes": [
                    {"scene_number": 1, "status": "completed"},
                ]},
            ]},
            novel_outline=None,
            cfg=ManagedStartConfig(scope="range", start_chapter=2, end_chapter=2),
        )
        assert result.enqueued == 0
        assert result.fallback_applied is False

    def test_no_fallback_when_next_chapter_work_already_queued(self, mgr):
        """Dedup interaction: with idempotent seeding, the scope's scene may
        already be in the queue from a prior seed_queue call. seed_queue
        must not silently add more scenes outside the requested range."""
        from backend.conductor.autopilot_runner_async import seed_queue
        from backend.models.autopilot_session import ManagedStartConfig
        # current_chapter=2, ch2's scene is unfinished, but already in queue
        # from a prior seed_queue call (simulated here by pre-loading the
        # queue with the deterministic QueueItem id).
        mgr.add_queue(QueueItem(
            id="write-2-1", kind="write_scene", chapter_number=2,
            scheduled_at=None, priority=21, payload={"scene_number": 1},
        ))
        result = seed_queue(
            mgr,
            outline={"chapters": [
                {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
                {"chapter_number": 2, "scene_plan": [{"scene_number": 1}]},
                {"chapter_number": 3, "scene_plan": [{"scene_number": 1}]},
            ]},
            progress={"current_chapter": 2, "chapters": [
                {"chapter_number": 1, "scenes": [
                    {"scene_number": 1, "status": "completed"},
                ]},
            ]},
            novel_outline=None,
            cfg=ManagedStartConfig(scope="range", start_chapter=2, end_chapter=2),
        )
        # ch2 has work (matched>0), and even though we added 0 new items
        # (dedup), we must NOT silently enqueue ch3.
        assert result.enqueued == 0
        assert result.matched == 1  # the scope has one candidate
        assert result.scope_used == "range"
        assert result.fallback_applied is False
        # And critically: ch3's scene must NOT have been added.
        ids = {q.id for q in mgr.load().queue}
        assert "write-3-1" not in ids
        assert ids == {"write-2-1"}


class TestRowMajorPriority:
    """Bug 2026-07-17: seed_queue used column-major priority (20 + scene_number),
    which interleaved scene N of every chapter before scene N+1 of any chapter.
    This forced per-scene cache rebuilds (L1/L4/L2 invalidated at every chapter
    transition) and broke narrative coherence — ch32.scene_1 was written
    before ch31.scene_2, so MemoryOS L2 had only ch30's summary when writing
    ch32. Fixed by switching to row-major priority (chapter * 1000 + scene)."""

    def test_chapters_seeded_in_chapter_order_not_scene_order(self, mgr):
        """Outline: ch1 has 3 scenes, ch2 has 2 scenes. seed_queue must place
        all of ch1's scenes BEFORE any of ch2's scenes."""
        outline = {"chapters": [
            {"chapter_number": 1, "scene_plan": [
                {"scene_number": 1}, {"scene_number": 2}, {"scene_number": 3},
            ]},
            {"chapter_number": 2, "scene_plan": [
                {"scene_number": 1}, {"scene_number": 2},
            ]},
        ]}
        seed_queue(
            mgr, outline=outline, progress=None, novel_outline=None,
            cfg=ManagedStartConfig(),
        )
        chapters = [q.chapter_number for q in mgr.load().queue
                    if q.kind == "write_scene"]
        scenes = [q.payload["scene_number"] for q in mgr.load().queue
                  if q.kind == "write_scene"]
        assert chapters == [1, 1, 1, 2, 2]
        assert scenes == [1, 2, 3, 1, 2]

    def test_scene_priorities_are_unique_within_a_chapter(self, mgr):
        """Each scene in a chapter gets a distinct priority (strictly increasing
        with scene_number)."""
        outline = {"chapters": [
            {"chapter_number": 5, "scene_plan": [
                {"scene_number": 1}, {"scene_number": 2}, {"scene_number": 3},
                {"scene_number": 4},
            ]},
        ]}
        seed_queue(
            mgr, outline=outline, progress=None, novel_outline=None,
            cfg=ManagedStartConfig(),
        )
        priorities = [q.priority for q in mgr.load().queue
                      if q.kind == "write_scene"]
        assert priorities == sorted(priorities)  # monotonic non-decreasing
        assert len(set(priorities)) == len(priorities)  # all unique

    def test_chapter_boundary_respected_across_three_chapters(self, mgr):
        """The largest priority in chapter N must be smaller than the smallest
        priority in chapter N+1 (no inter-chapter interleaving)."""
        outline = {"chapters": [
            {"chapter_number": 1, "scene_plan": [
                {"scene_number": 1}, {"scene_number": 2},
            ]},
            {"chapter_number": 2, "scene_plan": [
                {"scene_number": 1},
            ]},
            {"chapter_number": 3, "scene_plan": [
                {"scene_number": 1}, {"scene_number": 2}, {"scene_number": 3},
            ]},
        ]}
        seed_queue(
            mgr, outline=outline, progress=None, novel_outline=None,
            cfg=ManagedStartConfig(),
        )
        queue = [q for q in mgr.load().queue if q.kind == "write_scene"]
        groups = {}
        for q in queue:
            groups.setdefault(q.chapter_number, []).append(q.priority)
        # Within each chapter: priorities sorted ascending
        for ch, ps in groups.items():
            assert ps == sorted(ps), f"chapter {ch} priorities not ascending"
        # Cross-chapter: max of N < min of N+1
        sorted_chs = sorted(groups.keys())
        for a, b in zip(sorted_chs, sorted_chs[1:]):
            assert max(groups[a]) < min(groups[b]), (
                f"chapter {a} max ({max(groups[a])}) not < chapter {b} min "
                f"({min(groups[b])})"
            )

    def test_priority_formula_is_documented_and_increasing_with_chapter(self, mgr):
        """Sanity: priority is positive, monotonically increases with chapter
        AND with scene_number, and the formula is chapter*1000 + scene."""
        outline = {"chapters": [
            {"chapter_number": 7, "scene_plan": [{"scene_number": 2}]},
            {"chapter_number": 8, "scene_plan": [{"scene_number": 1}]},
        ]}
        seed_queue(
            mgr, outline=outline, progress=None, novel_outline=None,
            cfg=ManagedStartConfig(),
        )
        priorities = {(q.chapter_number, q.payload["scene_number"]): q.priority
                      for q in mgr.load().queue if q.kind == "write_scene"}
        assert priorities[(7, 2)] == 7002
        assert priorities[(8, 1)] == 8001
        assert priorities[(7, 2)] < priorities[(8, 1)]

    def test_archive_priority_sits_between_chapters(self):
        assert scene_priority(7, 998) < archive_priority(7)
        assert archive_priority(7) < scene_priority(8, 1)


class TestRepairStuckChapters:
    """Bug 2026-07-17 proj_cc4ca4ae: chapters 21-30 had status='in_progress'
    in progress.json but every scene was already 'completed' (writes finished,
    chapter-level flip never happened — probably because the runner stopped
    between scene-finalize and chapter-finalize). Without a repair, the
    autopilot looks 'halfway done' forever and users see stale state. We
    auto-flip such chapters in-memory before seed_queue runs."""

    def test_flips_in_progress_chapter_when_all_scenes_completed(self):
        from backend.conductor.autopilot_runner_async import repair_stuck_chapters
        progress = {
            "current_chapter": 21,
            "chapters": [
                {"chapter_number": 21, "status": "in_progress", "scenes": [
                    {"scene_number": 1, "status": "completed"},
                    {"scene_number": 2, "status": "completed"},
                    {"scene_number": 3, "status": "completed"},
                ]},
            ],
        }
        outline = {"chapters": [
            {"chapter_number": 21, "scene_plan": [
                {"scene_number": 1}, {"scene_number": 2}, {"scene_number": 3},
            ]},
        ]}
        repaired = repair_stuck_chapters(progress, outline)
        assert repaired == [21]
        assert progress["chapters"][0]["status"] == "completed"

    def test_force_passed_and_skipped_count_as_done(self):
        from backend.conductor.autopilot_runner_async import repair_stuck_chapters
        progress = {"chapters": [
            {"chapter_number": 5, "status": "in_progress", "scenes": [
                {"scene_number": 1, "status": "completed"},
                {"scene_number": 2, "status": "force_passed"},
                {"scene_number": 3, "status": "skipped"},
            ]},
        ]}
        outline = {"chapters": [
            {"chapter_number": 5, "scene_plan": [
                {"scene_number": 1}, {"scene_number": 2}, {"scene_number": 3},
            ]},
        ]}
        assert repair_stuck_chapters(progress, outline) == [5]

    def test_leaves_in_progress_chapter_alone_when_scene_still_pending(self):
        from backend.conductor.autopilot_runner_async import repair_stuck_chapters
        progress = {"chapters": [
            {"chapter_number": 7, "status": "in_progress", "scenes": [
                {"scene_number": 1, "status": "completed"},
                {"scene_number": 2, "status": "in_progress"},
            ]},
        ]}
        outline = {"chapters": [
            {"chapter_number": 7, "scene_plan": [
                {"scene_number": 1}, {"scene_number": 2},
            ]},
        ]}
        assert repair_stuck_chapters(progress, outline) == []
        assert progress["chapters"][0]["status"] == "in_progress"

    def test_leaves_completed_chapter_alone(self):
        from backend.conductor.autopilot_runner_async import repair_stuck_chapters
        progress = {"chapters": [
            {"chapter_number": 3, "status": "completed", "scenes": [
                {"scene_number": 1, "status": "completed"},
            ]},
        ]}
        outline = {"chapters": [
            {"chapter_number": 3, "scene_plan": [{"scene_number": 1}]},
        ]}
        assert repair_stuck_chapters(progress, outline) == []

    def test_repairs_multiple_chapters_at_once(self):
        from backend.conductor.autopilot_runner_async import repair_stuck_chapters
        progress = {"chapters": [
            {"chapter_number": 1, "status": "completed", "scenes": [
                {"scene_number": 1, "status": "completed"},
            ]},
            {"chapter_number": 2, "status": "in_progress", "scenes": [
                {"scene_number": 1, "status": "completed"},
            ]},
            {"chapter_number": 3, "status": "in_progress", "scenes": [
                {"scene_number": 1, "status": "in_progress"},
            ]},
            {"chapter_number": 4, "status": "in_progress", "scenes": [
                {"scene_number": 1, "status": "completed"},
                {"scene_number": 2, "status": "completed"},
            ]},
        ]}
        outline = {"chapters": [
            {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
            {"chapter_number": 2, "scene_plan": [{"scene_number": 1}]},
            {"chapter_number": 3, "scene_plan": [{"scene_number": 1}]},
            {"chapter_number": 4, "scene_plan": [
                {"scene_number": 1}, {"scene_number": 2},
            ]},
        ]}
        assert repair_stuck_chapters(progress, outline) == [2, 4]
        statuses = {ch["chapter_number"]: ch["status"] for ch in progress["chapters"]}
        assert statuses == {1: "completed", 2: "completed", 3: "in_progress", 4: "completed"}

    def test_skips_chapter_without_outline_match(self):
        """Defensive: a progress entry whose chapter_number isn't in the
        outline (e.g. scrubbed) shouldn't be touched — we have no ground truth."""
        from backend.conductor.autopilot_runner_async import repair_stuck_chapters
        progress = {"chapters": [
            {"chapter_number": 99, "status": "in_progress", "scenes": [
                {"scene_number": 1, "status": "completed"},
            ]},
        ]}
        outline = {"chapters": [
            {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
        ]}
        assert repair_stuck_chapters(progress, outline) == []
        assert progress["chapters"][0]["status"] == "in_progress"

    def test_skips_chapter_with_empty_scene_plan(self):
        from backend.conductor.autopilot_runner_async import repair_stuck_chapters
        progress = {"chapters": [
            {"chapter_number": 8, "status": "in_progress", "scenes": []},
        ]}
        outline = {"chapters": [
            {"chapter_number": 8, "scene_plan": []},
        ]}
        assert repair_stuck_chapters(progress, outline) == []


import json
from pathlib import Path


@pytest.fixture
def fake_project(projects_dir: Path):
    """A minimal project with outline + progress suitable for AsyncStage4Executor."""
    proj = projects_dir / "p1"
    # _write_scene_chapter and _advance_chapter need these files. The bare
    # outline.json + progress.json from the plan are insufficient.
    (proj / "project.json").write_text(json.dumps({
        "id": "p1", "title": "测试", "current_stage": "STAGE4",
        "genre": "cool_novel",
    }), encoding="utf-8")
    (proj / "concept_and_dna.json").write_text(json.dumps({"title": "X"}), encoding="utf-8")
    (proj / "world.json").write_text(json.dumps({}), encoding="utf-8")
    (proj / "characters.json").write_text(json.dumps({"characters": []}), encoding="utf-8")
    (proj / "outline.json").write_text(json.dumps({
        "chapters": [
            {"chapter_number": 1, "scene_plan": [
                {"scene_number": 1, "goal": "g1", "conflict": "c1"},
                {"scene_number": 2, "goal": "g2", "conflict": "c2"},
            ]},
            {"chapter_number": 2, "scene_plan": [
                {"scene_number": 1, "goal": "g3", "conflict": "c3"},
            ]},
        ],
    }), encoding="utf-8")
    (proj / "progress.json").write_text(json.dumps({
        "project_id": "p1", "current_stage": "STAGE4",
        "current_chapter": 1, "total_chapters": 2,
        "chapters": [
            {"chapter_number": 1, "status": "in_progress", "scenes": []},
            {"chapter_number": 2, "status": "pending", "scenes": []},
        ], "circuit_breaker_events": [],
    }), encoding="utf-8")
    return "p1"


class TestFakeStage4Executor:
    @pytest.mark.asyncio
    async def test_write_scene_writes_draft_and_updates_progress(
        self, mgr, projects_dir, fake_project
    ):
        from backend.conductor.stage4_async_executor import FakeStage4Executor
        mgr.start(ManagedStartConfig())
        executor = FakeStage4Executor(
            mgr, projects_dir,
            draft_factory=lambda c, s: f"<draft ch={c} scene={s} />",
            breaker_result="passed",
        )
        result = await executor.execute(
            QueueItem(id="w-1-1", kind="write_scene", chapter_number=1,
                      scheduled_at=None, priority=21,
                      payload={"scene_number": 1}),
            project_id="p1",
        )
        assert result["status"] == "ok"
        # Draft file written
        draft = (projects_dir / "p1" / "chapters" / "ch01_scene_001_draft.md").read_text()
        assert draft == "<draft ch=1 scene=1 />"
        # Progress.json updated
        progress = json.loads(
            (projects_dir / "p1" / "progress.json").read_text()
        )
        ch1 = next(c for c in progress["chapters"] if c["chapter_number"] == 1)
        assert any(s["status"] == "completed" for s in ch1["scenes"])

    @pytest.mark.asyncio
    async def test_write_scene_emits_archival_after_last_scene(
        self, mgr, projects_dir, fake_project
    ):
        """When this write_scene completes the chapter, an archival item lands in queue."""
        from backend.conductor.stage4_async_executor import FakeStage4Executor
        mgr.start(ManagedStartConfig())
        executor = FakeStage4Executor(
            mgr, projects_dir,
            draft_factory=lambda c, s: f"<d {c}-{s}>",
            breaker_result="passed",
        )
        # Write both scenes of chapter 1.
        await executor.execute(
            QueueItem(id="w-1-1", kind="write_scene", chapter_number=1,
                      scheduled_at=None, priority=21,
                      payload={"scene_number": 1}),
            project_id="p1",
        )
        await executor.execute(
            QueueItem(id="w-1-2", kind="write_scene", chapter_number=1,
                      scheduled_at=None, priority=22,
                      payload={"scene_number": 2}),
            project_id="p1",
        )
        await executor.execute(
            QueueItem(id="w-1-2-retry", kind="write_scene", chapter_number=1,
                      scheduled_at=None, priority=22,
                      payload={"scene_number": 2}),
            project_id="p1",
        )
        archival = [q for q in mgr.load().queue if q.kind == "archival"]
        assert len(archival) == 1
        assert archival[0].chapter_number == 1
        # Row-major: archive chapter 1 after its scenes and before chapter 2.
        assert archival[0].priority == 1999

    @pytest.mark.asyncio
    async def test_archival_advances_and_seeds_next_chapter(
        self, mgr, projects_dir, fake_project
    ):
        from backend.conductor.stage4_async_executor import FakeStage4Executor
        # Mark chapter 1 scenes as completed so _advance_chapter's precondition passes.
        prog_path = projects_dir / "p1" / "progress.json"
        prog = json.loads(prog_path.read_text(encoding="utf-8"))
        prog["chapters"][0]["scenes"] = [
            {"scene_number": 1, "status": "completed"},
            {"scene_number": 2, "status": "completed"},
        ]
        prog_path.write_text(json.dumps(prog), encoding="utf-8")

        mgr.start(ManagedStartConfig())
        mgr.add_queue(QueueItem(
            id="write-2-1", kind="write_scene", chapter_number=2,
            scheduled_at=None, priority=2001, payload={"scene_number": 1},
        ))
        executor = FakeStage4Executor(
            mgr, projects_dir,
            draft_factory=lambda c, s: f"<d {c}-{s}>",
            breaker_result="passed",
        )
        result = await executor.execute(
            QueueItem(id="a-1", kind="archival", chapter_number=1,
                      scheduled_at=None, priority=10, payload={}),
            project_id="p1",
        )
        assert result["advanced"] is True
        # progress.current_chapter bumped to 2; next chapter's scene seeded.
        progress = json.loads(
            (projects_dir / "p1" / "progress.json").read_text()
        )
        assert progress["current_chapter"] == 2
        seeded = [q for q in mgr.load().queue if q.kind == "write_scene"]
        assert len(seeded) == 1
        assert seeded[0].priority == 2001

    @pytest.mark.asyncio
    async def test_archival_failure_raises_so_runner_pauses(
        self, mgr, projects_dir, fake_project
    ):
        """Spec §5 row 4: SummaryArchiver raises → executor propagates."""
        from backend.conductor.stage4_async_executor import FakeStage4Executor
        # Mark chapter 1 scenes as completed so _advance_chapter's precondition passes.
        prog_path = projects_dir / "p1" / "progress.json"
        prog = json.loads(prog_path.read_text(encoding="utf-8"))
        prog["chapters"][0]["scenes"] = [
            {"scene_number": 1, "status": "completed"},
            {"scene_number": 2, "status": "completed"},
        ]
        prog_path.write_text(json.dumps(prog), encoding="utf-8")

        mgr.start(ManagedStartConfig())
        executor = FakeStage4Executor(
            mgr, projects_dir,
            draft_factory=lambda c, s: "ok",
            breaker_result="passed",
            advance_should_raise=RuntimeError("summary failed"),
        )
        with pytest.raises(RuntimeError, match="summary failed"):
            await executor.execute(
                QueueItem(id="a-1", kind="archival", chapter_number=1,
                          scheduled_at=None, priority=10, payload={}),
                project_id="p1",
            )

    @pytest.mark.asyncio
    async def test_unsupported_kind_raises_value_error(
        self, mgr, projects_dir, fake_project
    ):
        from backend.conductor.stage4_async_executor import FakeStage4Executor
        mgr.start(ManagedStartConfig())
        executor = FakeStage4Executor(mgr, projects_dir)
        with pytest.raises(ValueError, match="unsupported kind"):
            await executor.execute(
                QueueItem(id="x", kind="plan_chapter", chapter_number=1,
                          scheduled_at=None, priority=1, payload={}),
                project_id="p1",
            )


class TestAsyncStage4ExecutorControlFlow:
    """Light control-flow tests for the production executor. They patch the
    extracted helpers so we don't need an LLM key. Production routing is
    verified end-to-end in Task 12 (integration tests)."""

    @pytest.mark.asyncio
    async def test_routes_write_scene_through_extracted_helper(
        self, monkeypatch, projects_dir
    ):
        from backend.conductor import stage4_async_executor as mod
        from backend.conductor.stage4_async_executor import AsyncStage4Executor

        async def fake_write_scene_chapter(**kwargs):
            # Return the same shape _write_scene_chapter returns.
            return {"error": False, "code": "OK", "message": "",
                    "detail": {"status": "ok"}}

        monkeypatch.setattr(mod, "_write_scene_chapter", fake_write_scene_chapter)

        executor = AsyncStage4Executor(projects_dir)
        result = await executor.execute(
            QueueItem(id="w-1", kind="write_scene", chapter_number=1,
                      scheduled_at=None, priority=21,
                      payload={"scene_number": 1}),
            project_id="p1",
        )
        assert result["status"] == "ok"
        assert result["scene_status"] == "ok"

    @pytest.mark.asyncio
    async def test_routes_archival_through_extracted_helper(
        self, monkeypatch, projects_dir, fake_project
    ):
        from backend.conductor import stage4_async_executor as mod
        from backend.conductor.stage4_async_executor import AsyncStage4Executor

        async def fake_advance_chapter(**kwargs):
            # Mimic the real shape so the executor's progress read sees a
            # bumped current_chapter.
            import json as _json
            prog_path = projects_dir / "p1" / "progress.json"
            prog = _json.loads(prog_path.read_text(encoding="utf-8"))
            prog["current_chapter"] = prog.get("current_chapter", 1) + 1
            prog_path.write_text(_json.dumps(prog), encoding="utf-8")
            return {"error": False, "code": "OK", "message": "",
                    "detail": {"status": "advanced"}}

        monkeypatch.setattr(mod, "_advance_chapter", fake_advance_chapter)

        executor = AsyncStage4Executor(projects_dir)
        executor._mgr_for("p1").add_queue(QueueItem(
            id="write-2-1", kind="write_scene", chapter_number=2,
            scheduled_at=None, priority=2001, payload={"scene_number": 1},
        ))
        result = await executor.execute(
            QueueItem(id="a-1", kind="archival", chapter_number=1,
                      scheduled_at=None, priority=10, payload={}),
            project_id="p1",
        )
        assert result["status"] == "ok"
        assert result["advanced"] is True
        seeded = [
            q for q in executor._mgr_for("p1").load().queue
            if q.kind == "write_scene"
        ]
        assert len(seeded) == 1
        assert seeded[0].priority == 2001

    @pytest.mark.asyncio
    async def test_unsupported_kind_raises_value_error(
        self, projects_dir
    ):
        from backend.conductor.stage4_async_executor import AsyncStage4Executor
        executor = AsyncStage4Executor(projects_dir)
        with pytest.raises(ValueError, match="unsupported kind"):
            await executor.execute(
                QueueItem(id="x", kind="plan_chapter", chapter_number=1,
                          scheduled_at=None, priority=1, payload={}),
                project_id="p1",
            )


class TestAsyncAutopilotRunner:
    @pytest.mark.asyncio
    async def test_run_executes_all_items_then_stops(
        self, mgr, projects_dir, fake_project
    ):
        from backend.conductor.autopilot_runner_async import AsyncAutopilotRunner
        from backend.conductor.stage4_async_executor import FakeStage4Executor
        mgr.start(ManagedStartConfig())
        mgr.add_queue(QueueItem(id="w-1-1", kind="write_scene", chapter_number=1,
                                scheduled_at=None, priority=21,
                                payload={"scene_number": 1}))
        mgr.add_queue(QueueItem(id="w-1-2", kind="write_scene", chapter_number=1,
                                scheduled_at=None, priority=22,
                                payload={"scene_number": 2}))
        executor = FakeStage4Executor(mgr, projects_dir, breaker_result="passed")
        runner = AsyncAutopilotRunner(mgr, executor, cadence="fast")
        await runner.run()
        # Both scenes were processed; runner auto-stopped because after archival,
        # chapter 2 has no scenes (we did NOT pre-seed chapter 2).
        assert mgr.load().state.value == "stopped"
        kinds = [c["kind"] for c in executor._calls]
        assert "write_scene" in kinds
        assert "archival" in kinds

    @pytest.mark.asyncio
    async def test_run_returns_immediately_when_state_not_running(
        self, mgr, projects_dir, fake_project
    ):
        from backend.conductor.autopilot_runner_async import AsyncAutopilotRunner
        from backend.conductor.stage4_async_executor import FakeStage4Executor
        # Don't start the session — state stays idle.
        mgr.add_queue(QueueItem(id="w-1-1", kind="write_scene", chapter_number=1,
                                scheduled_at=None, priority=21,
                                payload={"scene_number": 1}))
        executor = FakeStage4Executor(mgr, projects_dir)
        runner = AsyncAutopilotRunner(mgr, executor)
        await runner.run()
        assert executor._calls == []  # never executed

    @pytest.mark.asyncio
    async def test_step_emits_task_fail_on_executor_exception(
        self, mgr, projects_dir, fake_project, monkeypatch
    ):
        """Retry-then-pause: 3 consecutive failures → session paused with
        scene_write_failed reason, queue item preserved so resume() can
        re-pick it, task_fail event emitted."""
        from backend.conductor.autopilot_runner_async import AsyncAutopilotRunner
        from backend.conductor import autopilot_runner_async as runner_mod
        # Shrink backoffs so the test doesn't wait 90s for retries.
        monkeypatch.setattr(runner_mod, "SCENE_WRITE_RETRY_BACKOFFS", (0, 0))

        mgr.start(ManagedStartConfig())
        mgr.add_queue(QueueItem(id="w-1-1", kind="write_scene", chapter_number=1,
                                scheduled_at=None, priority=21,
                                payload={"scene_number": 1}))

        class BoomExecutor:
            async def execute(self, item, project_id):
                raise RuntimeError("LLM 5xx")
            @property
            def _calls(self): return []

        executor = BoomExecutor()
        runner = AsyncAutopilotRunner(mgr, executor, cadence="fast")
        s = mgr.load()
        item = runner._pick_next(s.queue)
        await runner._step_one(item, "p1")
        # task_fail event was appended
        events = [e.type for e in mgr.load().history]
        assert "task_fail" in events
        # current_task was cleared
        assert mgr.load().current_task is None
        # Session is paused (not stopped)
        assert mgr.load().state.value == "paused"
        # pause_reason describes the failure
        reason = mgr.load().pause_reason
        assert reason is not None
        assert reason.startswith("scene_write_failed:write-1-1:")
        assert "LLM 5xx" in reason
        # Queue item is PRESERVED so resume() can re-pick it
        ids = [q.id for q in mgr.load().queue]
        assert "w-1-1" in ids
        # force_pass_count NOT incremented (executor-level failure, not fact-guard)
        assert mgr.load().circuit.force_pass_count == 0

    @pytest.mark.asyncio
    async def test_step_increments_force_pass_count_on_force_passed_scene(
        self, mgr, projects_dir, fake_project
    ):
        from backend.conductor.autopilot_runner_async import AsyncAutopilotRunner
        from backend.conductor.stage4_async_executor import FakeStage4Executor
        mgr.start(ManagedStartConfig())
        mgr.add_queue(QueueItem(id="w-1-1", kind="write_scene", chapter_number=1,
                                scheduled_at=None, priority=21,
                                payload={"scene_number": 1}))
        executor = FakeStage4Executor(mgr, projects_dir, breaker_result="force_pass")
        runner = AsyncAutopilotRunner(mgr, executor, cadence="fast")
        await runner.run()  # one step then queue empty (no archival enqueued)
        # session paused after 3 force-passes is the circuit-breaker behaviour;
        # 1 force-pass alone just increments counter and stays running.
        s = mgr.load()
        assert s.circuit.force_pass_count == 1
        assert s.circuit.threshold_warning is False

    @pytest.mark.asyncio
    async def test_step_emits_circuit_open_after_three_force_passes(
        self, mgr, projects_dir, fake_project, monkeypatch
    ):
        """Circuit breaker: 3 force_passes within a session auto-pause via
        circuit_open transition. Updated for retry-then-pause: we lower
        CIRCUIT_THRESHOLD to 2 for this test so we only need 2 valid scenes
        (the fake_project outline has 2 scenes; the previous w-1-3 was
        invalid input that now hits the retry-pause branch instead of
        accumulating force_passes)."""
        from backend.conductor.autopilot_runner_async import AsyncAutopilotRunner
        from backend.conductor.stage4_async_executor import FakeStage4Executor
        from backend.conductor import autopilot_runner as sync_runner_mod
        monkeypatch.setattr(sync_runner_mod, "CIRCUIT_THRESHOLD", 2)

        mgr.start(ManagedStartConfig())
        executor = FakeStage4Executor(mgr, projects_dir, breaker_result="force_pass")
        # Pre-seed 2 write_scene items (the only 2 valid scenes in fake_project).
        for n in (1, 2):
            mgr.add_queue(QueueItem(id=f"w-1-{n}", kind="write_scene",
                                    chapter_number=1, scheduled_at=None,
                                    priority=20 + n,
                                    payload={"scene_number": n}))
        runner = AsyncAutopilotRunner(mgr, executor, cadence="fast")
        await runner.run()
        s = mgr.load()
        assert s.circuit.force_pass_count >= 2
        assert s.circuit.threshold_warning is True
        # Auto-paused after the 2nd force-pass crossed the lowered threshold.
        assert s.state.value == "paused"
        events = [e.type for e in s.history]
        assert "circuit_open" in events

    @pytest.mark.asyncio
    async def test_run_calls_heartbeat_so_recovery_can_detect_dead_runner(
        self, mgr, projects_dir, fake_project
    ):
        """Layer 1 fix: AsyncAutopilotRunner.run() must call mgr.heartbeat()
        at least once per iteration so session.last_heartbeat_at is fresh.
        Without this, recover_running_sessions's `if last_hb:` guard sees
        None and never downgrades a stale session after a --reload crash."""
        from backend.conductor.autopilot_runner_async import AsyncAutopilotRunner
        from backend.conductor.stage4_async_executor import FakeStage4Executor

        mgr.start(ManagedStartConfig())
        # Sanity: a freshly started session has last_heartbeat_at == None
        # (start() doesn't populate it).
        assert mgr.load().last_heartbeat_at is None

        mgr.add_queue(QueueItem(id="w-1-1", kind="write_scene", chapter_number=1,
                                scheduled_at=None, priority=21,
                                payload={"scene_number": 1}))
        executor = FakeStage4Executor(mgr, projects_dir, breaker_result="passed")
        runner = AsyncAutopilotRunner(mgr, executor, cadence="fast")
        await runner.run()  # one iteration is enough

        # After run() exits, last_heartbeat_at must be populated. We don't
        # assert exact value (it's a timestamp) — just that heartbeat() ran.
        s = mgr.load()
        assert s.last_heartbeat_at is not None
        assert isinstance(s.last_heartbeat_at, str)
        # And the same value survives a fresh load (i.e. it was persisted).
        s2 = mgr.load()
        assert s2.last_heartbeat_at == s.last_heartbeat_at

    @pytest.mark.asyncio
    async def test_run_heartbeats_each_iteration_not_just_first(
        self, mgr, projects_dir, fake_project
    ):
        """The heartbeat must be refreshed on every loop iteration, not only
        the first one — otherwise a long chapter stalls past the 30s
        staleness threshold without any new heartbeat on disk."""
        from backend.conductor.autopilot_runner_async import AsyncAutopilotRunner
        from backend.conductor.stage4_async_executor import FakeStage4Executor

        # Wrap heartbeat() to count calls without changing behavior.
        call_count = {"n": 0}
        real_heartbeat = mgr.heartbeat
        def counting_heartbeat():
            call_count["n"] += 1
            return real_heartbeat()
        mgr.heartbeat = counting_heartbeat

        mgr.start(ManagedStartConfig())
        # Three write_scene items → runner will iterate at least 3 times
        # before the loop decides to stop (plus 1 archival = 4 iterations).
        for n in (1, 2, 3):
            mgr.add_queue(QueueItem(id=f"w-1-{n}", kind="write_scene",
                                    chapter_number=1, scheduled_at=None,
                                    priority=20 + n,
                                    payload={"scene_number": n}))
        executor = FakeStage4Executor(mgr, projects_dir, breaker_result="passed")
        runner = AsyncAutopilotRunner(mgr, executor, cadence="fast")
        await runner.run()

        assert call_count["n"] >= 3, (
            f"expected ≥3 heartbeats (one per loop iteration), got "
            f"{call_count['n']}"
        )


class TestRetryThenPause:
    """Spec for v1.9 retry-then-pause behavior. Bug 2026-07-22
    proj_a601cee9: a transient LLM connection drop left scenes stuck at
    status='retry' forever (drop-on-fail + no retry loop). Fix: retry the
    same scene up to SCENE_WRITE_MAX_RETRIES more times with backoff, then
    pause the session with a reason; resume() re-picks the same queue item."""

    @pytest.fixture
    def short_backoffs(self, monkeypatch):
        from backend.conductor import autopilot_runner_async as runner_mod
        monkeypatch.setattr(runner_mod, "SCENE_WRITE_RETRY_BACKOFFS", (0, 0))

    @pytest.mark.asyncio
    async def test_recovers_on_second_attempt_no_pause(
        self, mgr, projects_dir, fake_project, short_backoffs
    ):
        """First attempt raises, second attempt succeeds → session stays
        running, no pause_reason set, item dropped normally."""
        from backend.conductor.autopilot_runner_async import AsyncAutopilotRunner
        from backend.conductor.stage4_async_executor import FakeStage4Executor

        mgr.start(ManagedStartConfig())
        mgr.add_queue(QueueItem(id="w-1-1", kind="write_scene", chapter_number=1,
                                scheduled_at=None, priority=21,
                                payload={"scene_number": 1}))

        # Succeeds on attempt 2 (fail once, then return ok).
        attempt_count = {"n": 0}
        executor = FakeStage4Executor(mgr, projects_dir, breaker_result="passed")
        original_execute = executor.execute
        async def flaky_execute(item, project_id):
            attempt_count["n"] += 1
            if attempt_count["n"] == 1:
                raise RuntimeError("transient 5xx")
            return await original_execute(item, project_id=project_id)
        executor.execute = flaky_execute

        runner = AsyncAutopilotRunner(mgr, executor, cadence="fast")
        s = mgr.load()
        item = runner._pick_next(s.queue)
        result = await runner._step_one(item, "p1")
        assert result["completed"] is True
        assert attempt_count["n"] == 2
        # Session still running
        assert mgr.load().state.value == "running"
        # pause_reason NOT set
        assert mgr.load().pause_reason is None
        # Item dropped normally
        assert all(q.id != "w-1-1" for q in mgr.load().queue)

    @pytest.mark.asyncio
    async def test_structured_fail_status_also_retries(
        self, mgr, projects_dir, fake_project, short_backoffs
    ):
        """The runner must also retry when the executor returns a structured
        {status: fail} dict (not just on raw exceptions)."""
        from backend.conductor.autopilot_runner_async import AsyncAutopilotRunner

        mgr.start(ManagedStartConfig())
        mgr.add_queue(QueueItem(id="w-1-1", kind="write_scene", chapter_number=1,
                                scheduled_at=None, priority=21,
                                payload={"scene_number": 1}))

        attempt_count = {"n": 0}
        class FailTwiceThenOk:
            async def execute(self, item, project_id):
                attempt_count["n"] += 1
                if attempt_count["n"] < 3:
                    return {"status": "fail", "error": "rate limited"}
                return {"status": "ok", "scene_status": "ok"}
            @property
            def _calls(self): return []

        runner = AsyncAutopilotRunner(mgr, FailTwiceThenOk(), cadence="fast")
        item = runner._pick_next(mgr.load().queue)
        result = await runner._step_one(item, "p1")
        assert result["completed"] is True
        assert attempt_count["n"] == 3

    @pytest.mark.asyncio
    async def test_exhausted_retries_pause_with_reason(
        self, mgr, projects_dir, fake_project, short_backoffs
    ):
        """3 attempts all fail → session paused with scene_write_failed
        reason that names the failing queue item."""
        from backend.conductor.autopilot_runner_async import AsyncAutopilotRunner
        mgr.start(ManagedStartConfig())
        mgr.add_queue(QueueItem(id="w-5-2", kind="write_scene", chapter_number=5,
                                scheduled_at=None, priority=5021,
                                payload={"scene_number": 2}))

        class AlwaysFails:
            async def execute(self, item, project_id):
                raise RuntimeError("peer closed connection")
            @property
            def _calls(self): return []

        runner = AsyncAutopilotRunner(mgr, AlwaysFails(), cadence="fast")
        item = runner._pick_next(mgr.load().queue)
        result = await runner._step_one(item, "p1")
        assert result["completed"] is False
        assert result["picked"] == "w-5-2"
        s = mgr.load()
        # State: paused
        assert s.state.value == "paused"
        # Reason: scene_write_failed prefix + item coords + error
        reason = s.pause_reason
        assert reason is not None
        assert reason.startswith("scene_write_failed:write-5-2:")
        assert "peer closed connection" in reason
        # Queue item PRESERVED for resume
        ids = [q.id for q in s.queue]
        assert "w-5-2" in ids
        # History: 3 task_fail events? No — fail_current_task is called once
        # at the end after retries. task_fail events: 1.
        fail_events = [e for e in s.history if e.type == "task_fail"]
        assert len(fail_events) == 1

    @pytest.mark.asyncio
    async def test_subsequent_queue_items_not_picked_after_pause(
        self, mgr, projects_dir, fake_project, short_backoffs
    ):
        """run() exits when state != running, so paused-on-failure stops the
        runner loop. The remaining queue items stay untouched."""
        from backend.conductor.autopilot_runner_async import AsyncAutopilotRunner
        mgr.start(ManagedStartConfig())
        # First item will fail-then-pause. Second item would normally be
        # picked next iteration.
        mgr.add_queue(QueueItem(id="w-1-1", kind="write_scene", chapter_number=1,
                                scheduled_at=None, priority=21,
                                payload={"scene_number": 1}))
        mgr.add_queue(QueueItem(id="w-1-2", kind="write_scene", chapter_number=1,
                                scheduled_at=None, priority=22,
                                payload={"scene_number": 2}))

        class AlwaysFails:
            async def execute(self, item, project_id):
                raise RuntimeError("permanent")
            @property
            def _calls(self): return []

        runner = AsyncAutopilotRunner(mgr, AlwaysFails(), cadence="fast")
        await runner.run()  # exits when state flips to paused
        s = mgr.load()
        assert s.state.value == "paused"
        assert s.pause_reason is not None
        # Both items still in queue (neither was dropped on failure)
        ids = {q.id for q in s.queue}
        assert "w-1-1" in ids
        assert "w-1-2" in ids

    @pytest.mark.asyncio
    async def test_resume_clears_pause_reason_and_re_picks(
        self, mgr, projects_dir, fake_project, short_backoffs
    ):
        """resume() clears pause_reason; the runner's next step picks the
        same item that failed."""
        from backend.conductor.autopilot_runner_async import AsyncAutopilotRunner
        from backend.conductor.stage4_async_executor import FakeStage4Executor
        mgr.start(ManagedStartConfig())
        mgr.add_queue(QueueItem(id="w-1-1", kind="write_scene", chapter_number=1,
                                scheduled_at=None, priority=21,
                                payload={"scene_number": 1}))

        # Phase 1: fail forever → pause.
        class AlwaysFails:
            async def execute(self, item, project_id):
                raise RuntimeError("permanent")
            @property
            def _calls(self): return []

        runner = AsyncAutopilotRunner(mgr, AlwaysFails(), cadence="fast")
        await runner._step_one(mgr.load().queue[0], "p1")
        assert mgr.load().state.value == "paused"
        assert mgr.load().pause_reason is not None

        # Phase 2: user resumes. Reason must clear.
        mgr.resume()
        assert mgr.load().state.value == "running"
        assert mgr.load().pause_reason is None

        # Phase 3: with a healthy executor, the runner re-picks the SAME item.
        healthy = FakeStage4Executor(mgr, projects_dir, breaker_result="passed")
        runner2 = AsyncAutopilotRunner(mgr, healthy, cadence="fast")
        item = runner2._pick_next(mgr.load().queue)
        assert item.id == "w-1-1"
        result = await runner2._step_one(item, "p1")
        assert result["completed"] is True

    @pytest.mark.asyncio
    async def test_pause_during_backoff_aborts_retry(
        self, mgr, projects_dir, fake_project, monkeypatch
    ):
        """If the user pauses/stops during the retry backoff window, the
        retry must abort (the run() loop will see the new state and exit)."""
        from backend.conductor.autopilot_runner_async import AsyncAutopilotRunner
        from backend.conductor import autopilot_runner_async as runner_mod
        # Slow backoff so we can intervene.
        monkeypatch.setattr(runner_mod, "SCENE_WRITE_RETRY_BACKOFFS", (5, 5))

        mgr.start(ManagedStartConfig())
        mgr.add_queue(QueueItem(id="w-1-1", kind="write_scene", chapter_number=1,
                                scheduled_at=None, priority=21,
                                payload={"scene_number": 1}))

        attempt_count = {"n": 0}

        class AlwaysFails:
            async def execute(self, item, project_id):
                attempt_count["n"] += 1
                # First call returns ok instantly; we'll override below.
                raise RuntimeError("retryable")
            @property
            def _calls(self): return []

        runner = AsyncAutopilotRunner(mgr, AlwaysFails(), cadence="fast")

        # Schedule a user-pause during the first backoff (5s window).
        import asyncio as _asyncio
        async def user_pause():
            await _asyncio.sleep(0.5)
            mgr.pause(reason="user_intervention")
        pause_task = _asyncio.create_task(user_pause())

        item = runner._pick_next(mgr.load().queue)
        result = await runner._step_one(item, "p1")
        await pause_task

        # The retry loop saw state != RUNNING during backoff and aborted.
        assert result["completed"] is False
        assert "aborted during retry backoff" in result["error"]
        # Only one attempt happened before abort
        assert attempt_count["n"] == 1
        # User's pause_reason took precedence (runner wrote aborted, then
        # mgr.pause() overwrote with user reason — actually no, the retry
        # loop's abort path doesn't call pause; user's pause() does). So
        # pause_reason is the user's.
        assert mgr.load().pause_reason == "user_intervention"


class TestSceneMissingShortCircuit:
    """Bug 2026-07-27 proj_bb0375eb: outline.json was overwritten by the
    /api/stage3/generate endpoint after the autopilot session was already
    seeded, stranding write-10-4 in the queue. The runner retried 3x then
    paused the whole session. Fix: executor returns {"status":"scene_missing"}
    when outline doesn't contain the scene; runner drops + fails task
    without retrying or pausing.

    These tests pin down that short-circuit at the runner boundary."""

    @pytest.mark.asyncio
    async def test_scene_missing_drops_without_retry_or_pause(
        self, mgr, projects_dir, fake_project
    ):
        from backend.conductor.autopilot_runner_async import AsyncAutopilotRunner
        mgr.start(ManagedStartConfig())
        # Row-major priority: chapter * 1000 + scene. Lower = picked first.
        # Pick order: w-1-1 (1001, valid) → w-1-9 (1009, scene_missing).
        # Outline's chapter 1 only has scenes 1, 2 — scene 9 was removed.
        mgr.add_queue(QueueItem(id="w-1-1", kind="write_scene", chapter_number=1,
                                scheduled_at=None, priority=1001,
                                payload={"scene_number": 1}))
        mgr.add_queue(QueueItem(id="w-1-9", kind="write_scene", chapter_number=1,
                                scheduled_at=None, priority=1009,
                                payload={"scene_number": 9}))

        attempts = {"n": 0}

        class CountAttempts:
            async def execute(self, item, project_id):
                attempts["n"] += 1
                if item.id == "w-1-9":
                    # Pretend the executor returned scene_missing (what the real
                    # AsyncStage4Executor does after the precheck).
                    return {"status": "scene_missing",
                            "error": "Scene 9 不存在（大纲已被修改）"}
                return {"status": "ok", "scene_status": "completed"}
            @property
            def _calls(self): return []

        runner = AsyncAutopilotRunner(mgr, CountAttempts(), cadence="fast")

        # Step 1: valid scene 1 succeeds normally
        s = mgr.load()
        item1 = runner._pick_next(s.queue)
        result1 = await runner._step_one(item1, "p1")
        assert result1["completed"] is True
        assert result1["picked"] == "w-1-1"
        assert attempts["n"] == 1

        # Step 2: scene_missing item short-circuits — no retry, no pause
        s = mgr.load()
        item2 = runner._pick_next(s.queue)
        result2 = await runner._step_one(item2, "p1")
        assert result2["completed"] is False
        assert result2["skipped"] == "scene_missing"
        assert result2["picked"] == "w-1-9"
        assert attempts["n"] == 2, "scene_missing must NOT be retried"

        s = mgr.load()
        # Session still running (not paused)
        assert s.state.value == "running"
        assert s.pause_reason is None
        # Both items dropped
        assert all(q.id not in ("w-1-1", "w-1-9") for q in s.queue)
        # task_fail event recorded for chapter 1 with the outline-drift reason.
        # Note: CurrentTask.scene_id is always None for write_scene in the
        # runner (the queue item id lives in queue events only), so we filter
        # by chapter_number instead of task_id.
        fail_events = [e for e in s.history if e.type == "task_fail" and e.chapter_number == 1]
        assert len(fail_events) == 1, [e for e in s.history if e.type == "task_fail"]
        assert "大纲已被修改" in fail_events[0].payload.get("error", "")
        # queue_drop event recorded for w-1-9 (carries the queue item id)
        drop_events = [e for e in s.history if e.type == "queue_drop" and e.task_id == "w-1-9"]
        assert len(drop_events) == 1

    @pytest.mark.asyncio
    async def test_scene_missing_emits_task_fail_and_queue_drop(
        self, mgr, projects_dir, fake_project
    ):
        from backend.conductor.autopilot_runner_async import AsyncAutopilotRunner
        mgr.start(ManagedStartConfig())
        mgr.add_queue(QueueItem(id="w-2-7", kind="write_scene", chapter_number=2,
                                scheduled_at=None, priority=27,
                                payload={"scene_number": 7}))  # ch2 only has scene 1

        class AlwaysSceneMissing:
            async def execute(self, item, project_id):
                return {"status": "scene_missing",
                        "error": "Scene 7 不存在（大纲已被修改）"}
            @property
            def _calls(self): return []

        runner = AsyncAutopilotRunner(mgr, AlwaysSceneMissing(), cadence="fast")
        s = mgr.load()
        item = runner._pick_next(s.queue)
        await runner._step_one(item, "p1")

        s = mgr.load()
        # queue_drop event recorded (carries the queue item id)
        drop_events = [e for e in s.history if e.type == "queue_drop" and e.task_id == "w-2-7"]
        assert len(drop_events) == 1
        # task_fail event recorded. The runner's CurrentTask.scene_id is
        # always None for write_scene items (the queue item id lives in
        # queue events only), so we filter by chapter_number instead of
        # task_id — that's enough to disambiguate from a prior chapter's
        # failures in the same session.
        fail_events = [e for e in s.history if e.type == "task_fail" and e.chapter_number == 2]
        assert len(fail_events) == 1, [e for e in s.history if e.type == "task_fail"]
        assert "大纲已被修改" in fail_events[0].payload.get("error", "")
        assert s.state.value == "running"
        assert s.pause_reason is None

    @pytest.mark.asyncio
    async def test_async_stage4_executor_precheck_integration(
        self, mgr, projects_dir, fake_project
    ):
        """End-to-end: real AsyncStage4Executor returns scene_missing BEFORE
        calling _write_scene_chapter when the outline lacks the scene. Runner
        picks up the scene_missing status and short-circuits."""
        from backend.conductor.autopilot_runner_async import AsyncAutopilotRunner
        from backend.conductor.stage4_async_executor import AsyncStage4Executor

        mgr.start(ManagedStartConfig())
        mgr.add_queue(QueueItem(id="w-1-9", kind="write_scene", chapter_number=1,
                                scheduled_at=None, priority=29,
                                payload={"scene_number": 9}))

        # Stub _write_scene_chapter to fail the test if the precheck didn't fire.
        def must_not_run(*args, **kwargs):
            raise AssertionError(
                "AsyncStage4Executor precheck failed — _write_scene_chapter "
                "was called for scene 9 even though outline.json has no scene 9"
            )
        from backend.conductor import stage4_async_executor as ex_mod
        ex_mod._write_scene_chapter = must_not_run

        executor = AsyncStage4Executor(projects_dir)
        runner = AsyncAutopilotRunner(mgr, executor, cadence="fast")

        s = mgr.load()
        item = runner._pick_next(s.queue)
        result = await runner._step_one(item, "p1")
        assert result["skipped"] == "scene_missing"
        s = mgr.load()
        assert s.state.value == "running"  # not paused
        assert all(q.id != "w-1-9" for q in s.queue)