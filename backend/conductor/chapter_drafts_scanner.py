"""Disk-side draft discovery for autopilot seed_queue.

Spec: docs/superpowers/plans/2026-08-20-fix-seed-queue-destructive-regen.md

The autopilot's source-of-truth for scene completion is `progress.json`,
but that file can drift out of sync with `chapters/*.md` (e.g. when an
earlier `regenerate_chapter()` cleared drafts without a corresponding
progress write, or when the runner was force-killed between writing the
draft and committing the status). This module gives `seed_queue` the
inverse view: which scenes have actual draft.md files on disk?

Used by seed_queue to promote disk-only scenes to status='completed'
WITHOUT deleting the drafts — the destructive-regeneration behavior
(proj_1a7d7fcf 2026-08-20 lost ch1–ch11 to it) is gone, replaced by a
non-destructive trust-the-disk promotion.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable

# Mirrors the filename convention in backend/api/stage4_writing.py:517:
#   f"ch{chapter_number:02d}_scene_{scene_number:03d}_draft.md"
# Zero-padded chapter (2 digits) + zero-padded scene (3 digits). The
# FileManager writes these via fm.write_markdown(project_id, f"chapters/{fname}", ...).
_DRAFT_NAME_RE = re.compile(r"^ch(\d+)_scene_(\d+)_draft\.md$")


def has_draft(project_dir: Path, chapter_number: int, scene_number: int) -> bool:
    """True iff `chapters/ch{NN}_scene_{NNN}_draft.md` exists and non-empty.

    Non-empty is the signal we care about: an empty file (touch'd by a
    test, or truncated by a partial write) should NOT count as evidence
    the scene was actually generated. Stage4 writers use
    `fm.write_markdown(...)` which writes atomically; a 0-byte file means
    either nothing was written yet or the write crashed mid-flight.
    """
    fname = f"ch{chapter_number:02d}_scene_{scene_number:03d}_draft.md"
    p = project_dir / "chapters" / fname
    if not p.exists():
        return False
    try:
        return p.stat().st_size > 0
    except OSError:
        return False


def discover_drafts(
    project_dir: Path, target_chapters: Iterable[dict]
) -> set[tuple[int, int]]:
    """Return the set of `(chapter_number, scene_number)` tuples whose
    `chapters/*.md` exists and is non-empty on disk, intersected with
    the scenes in `target_chapters` (each dict is an outline chapter
    with a `scene_plan` list).

    Strategy: one `os.listdir` on `chapters/`, parse the regex once per
    filename, then intersect with the desired chapter/scene set. For a
    100-chapter / 500-scene project this is ~500 stat() calls vs. the
    naive approach of one per (chapter, scene) pair — same number, but
    the parse happens once. Either is fast enough; this wins on clarity.

    If `chapters/` is missing or unreadable, returns an empty set (not
    an error). seed_queue should still proceed normally in that case —
    a missing chapters/ directory just means "nothing on disk to trust".

    Defensive against malformed filenames: only ch{N}_scene_{N}_draft.md
    pattern counts. Other files (.tmp, .swp, scene_chunk replays) are
    ignored — the source-of-truth for live streams is
    `autopilot/chunks/*.jsonl`, but those are cleared on `done` and
    intentionally not part of the trust-the-disk promotion.
    """
    chapters_dir = project_dir / "chapters"
    if not chapters_dir.exists() or not chapters_dir.is_dir():
        return set()

    wanted: set[tuple[int, int]] = set()
    for ch in target_chapters:
        ch_num = ch.get("chapter_number")
        if ch_num is None:
            continue
        for s in ch.get("scene_plan", []) or []:
            sc_num = s.get("scene_number")
            if sc_num is None:
                continue
            wanted.add((ch_num, sc_num))

    if not wanted:
        return set()

    found: set[tuple[int, int]] = set()
    try:
        entries = list(chapters_dir.iterdir())
    except OSError:
        return set()

    for entry in entries:
        if not entry.is_file():
            continue
        m = _DRAFT_NAME_RE.match(entry.name)
        if not m:
            continue
        try:
            if entry.stat().st_size == 0:
                continue
        except OSError:
            continue
        key = (int(m.group(1)), int(m.group(2)))
        if key in wanted:
            found.add(key)
    return found
