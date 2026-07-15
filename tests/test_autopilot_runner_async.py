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