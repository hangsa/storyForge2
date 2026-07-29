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


class TestSchemaValidation:
    """Catalog must reject malformed beat_patterns at load time."""

    def _write_genre_yaml(self, tmp_path, genre_id, beat_patterns_block):
        """Helper: write a minimal valid genre YAML into tmp_path."""
        import yaml
        (tmp_path / "index.yaml").write_text(
            yaml.safe_dump({"genres": [{"id": genre_id, "label_zh": "测试", "label_en": "Test", "family": "test"}]}, allow_unicode=True),
            encoding="utf-8",
        )
        (tmp_path / "compatibility.yaml").write_text(
            yaml.safe_dump({"matrix": {genre_id: {}}}, allow_unicode=True),
            encoding="utf-8",
        )
        (tmp_path / "families.yaml").write_text(
            yaml.safe_dump({"families": {"test": [genre_id]}}, allow_unicode=True),
            encoding="utf-8",
        )
        # All required fields EXCEPT beat_patterns — we'll inject beat_patterns separately.
        valid_entry = {
            "id": genre_id, "label_zh": "测试", "label_en": "Test", "family": "test",
            "pacing": {"min_beats_per_1k": 1.0, "escalation_interval": 5, "action_ratio": 0.3,
                       "max_consecutive_non_action": 3, "chapter_words": {"min": 2000, "max": 5000},
                       "scene_words": {"min": 400, "max": 1800}},
            "tone": "测试",
            "style_rules": ["rule1"],
            "writing_formula": {"sentence": {}, "dialogue": {}, "paragraph": {}},
            "taboo_words": [],
            "taboos": [],
            "trope_patterns": [],
            "thresholds": {},
            "model_preferences": {"creative_core": "deepseek-chat", "temperature": 0.8},
            "fusion_meta": {"distances": {}},  # Will fail distance validation, but beat_patterns is checked first
        }
        valid_entry["beat_patterns"] = beat_patterns_block
        (tmp_path / f"{genre_id}.yaml").write_text(
            yaml.safe_dump(valid_entry, allow_unicode=True),
            encoding="utf-8",
        )

    def test_all_7_genres_have_beat_patterns_field(self):
        """The production catalog loads with all 7 genres declaring beat_patterns."""
        from backend.genres.catalog import get_catalog
        catalog = get_catalog()
        for gid in ("cool_novel", "xianxia", "xuanhuan", "dushi", "kehuan", "xuanyi", "yanqing"):
            entry = catalog.get(gid)
            assert "beat_patterns" in entry, f"{gid} missing beat_patterns"
            assert isinstance(entry["beat_patterns"], list)
            assert len(entry["beat_patterns"]) >= 1

    def test_beat_pattern_with_empty_keywords_raises_on_load(self, tmp_path):
        """A beat_pattern with keywords=[] is invalid."""
        from backend.genres.catalog import GenreCatalog, CatalogLoadError
        self._write_genre_yaml(tmp_path, "test_genre", [
            {"keywords": [], "priority": 80, "beats": [{"description": "x", "words": 100, "focus": "sensory"}]}
        ])
        with pytest.raises(CatalogLoadError, match="beat_patterns invalid"):
            GenreCatalog(genres_dir=tmp_path).get("test_genre")

    def test_beat_with_unknown_focus_raises_on_load(self, tmp_path):
        """A beat with focus='random_word' (not in vocabulary) is invalid."""
        from backend.genres.catalog import GenreCatalog, CatalogLoadError
        self._write_genre_yaml(tmp_path, "test_genre", [
            {"keywords": ["测试"], "priority": 80, "beats": [{"description": "x", "words": 100, "focus": "random_word"}]}
        ])
        with pytest.raises(CatalogLoadError, match="beat_patterns invalid"):
            GenreCatalog(genres_dir=tmp_path).get("test_genre")

    def test_beat_with_single_char_keyword_raises_on_load(self, tmp_path):
        """A keyword of length 1 (e.g., '脸') is too noisy — min 2 chars required."""
        from backend.genres.catalog import GenreCatalog, CatalogLoadError
        self._write_genre_yaml(tmp_path, "test_genre", [
            {"keywords": ["脸"], "priority": 80, "beats": [{"description": "x", "words": 100, "focus": "sensory"}]}
        ])
        with pytest.raises(CatalogLoadError, match="beat_patterns invalid"):
            GenreCatalog(genres_dir=tmp_path).get("test_genre")
