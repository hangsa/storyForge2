"""Tests for managed mode chapter range config and helpers."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from backend.models.autopilot_session import ManagedStartConfig
from backend.conductor.autopilot_runner_async import (
    compute_range_defaults,
    find_latest_completed_chapter,
)


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
