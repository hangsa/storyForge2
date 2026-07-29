"""Tests for genre beat pattern injection into Stage 3 outline prompts.

Pattern: config/genre_focus_vocabulary.yaml -> planner._resolve_genre_focus_vocabulary
       : catalog.<filename> -> planner._resolve_genre_beat_patterns -> prompt placeholders
       : {genre_beat_patterns}, {genre_focus_vocabulary}
"""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest


class TestFocusVocabulary:
    def test_returns_legend_with_all_six_focus_words_and_header(self):
        """_resolve_genre_focus_vocabulary returns the full legend, prefixed by
        the 【focus 字段图例】 header. All 6 focus words must appear in the output."""
        from backend.agents.planner import _resolve_genre_focus_vocabulary

        result = _resolve_genre_focus_vocabulary()

        assert "【focus 字段图例】" in result
        for word in ("sensory", "action", "dialogue", "emotion", "suspense", "reveal"):
            assert word in result
