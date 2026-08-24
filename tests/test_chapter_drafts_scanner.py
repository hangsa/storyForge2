"""Tests for chapter_drafts_scanner (disk-side draft discovery).

The scanner is the input layer for seed_queue's trust-the-disk promotion.
It must be fast, defensive, and never lie: an empty file is NOT a draft,
a malformed filename is NOT a draft, and a missing chapters/ directory
returns the empty set (NOT a crash).
"""
from __future__ import annotations

from pathlib import Path

import pytest

from backend.conductor.chapter_drafts_scanner import (
    discover_drafts,
    has_draft,
)


# ---------------------------------------------------------------------------
# has_draft — single-scene lookup
# ---------------------------------------------------------------------------

class TestHasDraft:
    def test_returns_true_for_existing_nonempty_draft(self, tmp_path):
        (tmp_path / "chapters").mkdir()
        (tmp_path / "chapters" / "ch01_scene_001_draft.md").write_text("正文")
        assert has_draft(tmp_path, 1, 1) is True

    def test_returns_false_for_missing_draft(self, tmp_path):
        (tmp_path / "chapters").mkdir()
        assert has_draft(tmp_path, 1, 1) is False

    def test_returns_false_for_empty_file(self, tmp_path):
        # 0-byte file = no actual draft content (touch'd by a test, or
        # truncated by a partial write). Should NOT count.
        (tmp_path / "chapters").mkdir()
        (tmp_path / "chapters" / "ch01_scene_001_draft.md").write_text("")
        assert has_draft(tmp_path, 1, 1) is False

    def test_returns_false_when_chapters_dir_missing(self, tmp_path):
        # No chapters/ directory at all — nothing on disk to trust.
        # Not an error: a project that hasn't started writing has no drafts.
        assert has_draft(tmp_path, 1, 1) is False

    def test_zero_padded_filename_format(self, tmp_path):
        # The scanner must accept the same format stage4 writes:
        # ch{NN}_scene_{NNN}_draft.md with NN=2 digits, NNN=3 digits.
        (tmp_path / "chapters").mkdir()
        (tmp_path / "chapters" / "ch12_scene_003_draft.md").write_text("ok")
        assert has_draft(tmp_path, 12, 3) is True

    def test_ignores_unrelated_files(self, tmp_path):
        # Live-stream chunks, swap files, tmp files must not be confused
        # with completed drafts. The source-of-truth for live streams is
        # autopilot/chunks/*.jsonl; drafts are chapter-final artifacts.
        (tmp_path / "chapters").mkdir()
        (tmp_path / "chapters" / "ch01_scene_001_draft.md.tmp").write_text("x")
        (tmp_path / "chapters" / "ch01_scene_001_draft.md.swp").write_text("x")
        (tmp_path / "chapters" / "ch01_scene_001_chunk_001.jsonl").write_text("x")
        assert has_draft(tmp_path, 1, 1) is False


# ---------------------------------------------------------------------------
# discover_drafts — multi-chapter scan
# ---------------------------------------------------------------------------

class TestDiscoverDrafts:
    def _outline(self, *specs):
        """specs is a list of (chapter_num, [scene_num, ...]) tuples."""
        return [
            {"chapter_number": c, "scene_plan": [{"scene_number": s} for s in scenes]}
            for c, scenes in specs
        ]

    def test_returns_empty_when_chapters_dir_missing(self, tmp_path):
        # No crash, no error: just an empty set. seed_queue must still
        # proceed normally in this case (draft promotion is a no-op).
        result = discover_drafts(tmp_path, self._outline((1, [1, 2, 3])))
        assert result == set()

    def test_returns_only_requested_scenes(self, tmp_path):
        # Discovered drafts outside target_chapters should NOT be returned.
        (tmp_path / "chapters").mkdir()
        (tmp_path / "chapters" / "ch01_scene_001_draft.md").write_text("a")
        (tmp_path / "chapters" / "ch01_scene_002_draft.md").write_text("b")
        (tmp_path / "chapters" / "ch02_scene_001_draft.md").write_text("c")

        # Only ask for ch1.
        outline = self._outline((1, [1, 2]))
        result = discover_drafts(tmp_path, outline)
        assert result == {(1, 1), (1, 2)}

    def test_returns_empty_when_target_chapters_empty(self, tmp_path):
        (tmp_path / "chapters").mkdir()
        (tmp_path / "chapters" / "ch01_scene_001_draft.md").write_text("a")
        result = discover_drafts(tmp_path, [])
        assert result == set()

    def test_skips_empty_files(self, tmp_path):
        (tmp_path / "chapters").mkdir()
        (tmp_path / "chapters" / "ch01_scene_001_draft.md").write_text("real content")
        (tmp_path / "chapters" / "ch01_scene_002_draft.md").write_text("")  # empty
        (tmp_path / "chapters" / "ch01_scene_003_draft.md").write_text("more")
        outline = self._outline((1, [1, 2, 3]))
        result = discover_drafts(tmp_path, outline)
        assert result == {(1, 1), (1, 3)}

    def test_handles_unpadded_chapter_numbers_via_regex(self, tmp_path):
        # The regex `ch(\d+)` accepts any number of digits. stage4 always
        # writes zero-padded, but the scanner must be tolerant in case
        # any other writer (tests, manual touch) uses a different width.
        (tmp_path / "chapters").mkdir()
        (tmp_path / "chapters" / "ch1_scene_1_draft.md").write_text("ok")
        (tmp_path / "chapters" / "ch120_scene_001_draft.md").write_text("ok")
        outline = self._outline((1, [1]), (120, [1]))
        result = discover_drafts(tmp_path, outline)
        assert result == {(1, 1), (120, 1)}

    def test_ignores_non_matching_files(self, tmp_path):
        # Defensive: random text files, dotfiles, the chunk replay jsonl
        # from autopilot/chunks/ are NOT in chapters/ anyway, but make
        # sure an unrelated .md in chapters/ doesn't get misread.
        (tmp_path / "chapters").mkdir()
        (tmp_path / "chapters" / "ch01_scene_001_draft.md").write_text("real")
        (tmp_path / "chapters" / "README.md").write_text("x")
        (tmp_path / "chapters" / "ch01_notes.md").write_text("x")
        (tmp_path / "chapters" / "ch01_scene_001_chunk_001.jsonl").write_text("x")
        outline = self._outline((1, [1]))
        result = discover_drafts(tmp_path, outline)
        assert result == {(1, 1)}

    def test_does_not_crash_on_unreadable_entries(self, tmp_path, monkeypatch):
        # chmod 000 the chapters dir — iterdir() may raise PermissionError
        # on some systems. The scanner should swallow it and return empty
        # rather than propagating, since the caller has no recovery path.
        (tmp_path / "chapters").mkdir()
        (tmp_path / "chapters" / "ch01_scene_001_draft.md").write_text("real")

        def _raise(*_args, **_kwargs):
            raise PermissionError("nope")

        monkeypatch.setattr(Path, "iterdir", _raise)
        outline = self._outline((1, [1]))
        result = discover_drafts(tmp_path, outline)
        assert result == set()

    def test_outline_without_scene_number_is_skipped(self, tmp_path):
        # Defensive: an outline entry with no scene_number shouldn't
        # cause a crash or false-positive. Just skip silently.
        outline = [
            {"chapter_number": 1, "scene_plan": [
                {"scene_number": 1},
                {"scene_number": None},  # malformed
                {},                      # no scene_number key
                {"scene_number": 2},
            ]},
        ]
        (tmp_path / "chapters").mkdir()
        (tmp_path / "chapters" / "ch01_scene_001_draft.md").write_text("a")
        (tmp_path / "chapters" / "ch01_scene_002_draft.md").write_text("b")
        result = discover_drafts(tmp_path, outline)
        assert result == {(1, 1), (1, 2)}
