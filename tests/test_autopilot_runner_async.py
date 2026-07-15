"""Unit tests for the pure helpers and async runner/executor that drive
the AutopilotSession queue. Spec: docs/superpowers/specs/2026-07-14-...
§§3-5 (file structure + 6-rule failure table)."""
from __future__ import annotations
import pytest

from backend.conductor.autopilot_runner_async import is_chapter_complete


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
def projects_dir(tmp_path):
    import json
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
        assert n == 5  # 3 + 2
        s = mgr.load()
        assert len(s.queue) == 5
        # add_queue sorts by priority. Priority = 20 + scene_number, so
        # ch1s1(21)/ch2s1(21)/ch1s2(22)/ch2s2(22)/ch1s3(23).
        nums = [q.payload["scene_number"] for q in s.queue
                if q.kind == "write_scene"]
        chapters = [q.chapter_number for q in s.queue if q.kind == "write_scene"]
        assert chapters == [1, 2, 1, 2, 1]
        assert nums == [1, 1, 2, 2, 3]
        # Priorities match: 20 + scene_number (sorted ascending by add_queue).
        assert [q.priority for q in s.queue if q.kind == "write_scene"] == [21, 21, 22, 22, 23]

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
        assert n == 2  # scenes 2 and 3 only
        nums = [q.payload["scene_number"] for q in mgr.load().queue]
        assert nums == [2, 3]

    def test_next_chapter_scope_only_enqueues_current(self, mgr):
        n = seed_queue(
            mgr,
            outline={"chapters": [
                {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
                {"chapter_number": 2, "scene_plan": [{"scene_number": 1}]},
                {"chapter_number": 3, "scene_plan": [{"scene_number": 1}]},
            ]},
            progress={"current_chapter": 2, "chapters": []},
            novel_outline=None,
            cfg=ManagedStartConfig(scope="next_chapter"),
        )
        assert n == 1
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
        assert n == 0

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
        assert n == 1

    def test_returns_zero_when_nothing_to_do(self, mgr):
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
        assert n == 0