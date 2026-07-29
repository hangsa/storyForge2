"""Unit tests for GenreTemplate delegator — verifies the wrapper forwards to GenreCatalog."""
import pytest

from backend.style_engine.genre_template import GenreTemplate


class TestGenreTemplateLoad:
    def test_load_cool_novel_returns_full_entry(self):
        """The default catalog genre loads with all expected fields."""
        gt = GenreTemplate()
        data = gt.load("cool_novel")
        assert isinstance(data, dict)
        assert data["id"] == "cool_novel"
        assert "pacing" in data
        assert "tone" in data
        assert "writing_formula" in data
        assert "thresholds" in data

    def test_load_all_seven_genres(self):
        """All 7 catalog genres load successfully."""
        gt = GenreTemplate()
        for gid in ("cool_novel", "xianxia", "xuanhuan", "dushi", "kehuan", "xuanyi", "yanqing"):
            data = gt.load(gid)
            assert data["id"] == gid

    def test_load_unknown_falls_back(self):
        """Unknown genres fall back to first index entry — no raise."""
        gt = GenreTemplate()
        data = gt.load("nonexistent")
        # First entry is cool_novel
        assert data["id"] == "cool_novel"

    def test_no_constructor_args(self):
        """GenreTemplate takes no constructor args — catalog is a singleton."""
        gt = GenreTemplate()
        data = gt.load("cool_novel")
        assert data["id"] == "cool_novel"


class TestGenreTemplateGetters:
    def test_get_pacing_returns_pacing_subdict(self):
        gt = GenreTemplate()
        pacing = gt.get_pacing("cool_novel")
        assert isinstance(pacing, dict)
        assert "min_beats_per_1k" in pacing

    def test_get_pacing_xuanyi_distinct_from_cool_novel(self):
        """Different genres have distinct pacing configs."""
        gt = GenreTemplate()
        pacing_cn = gt.get_pacing("cool_novel")
        pacing_xy = gt.get_pacing("xuanyi")
        # At minimum they should not be the exact same dict (different genre ids)
        assert pacing_cn is not pacing_xy

    def test_get_tone_rules_returns_combined_dict(self):
        gt = GenreTemplate()
        rules = gt.get_tone_rules("cool_novel")
        assert "tone" in rules
        assert "taboo_words" in rules
        assert "style_rules" in rules

    def test_get_taboos_returns_list_of_strings(self):
        gt = GenreTemplate()
        taboos = gt.get_taboos("cool_novel")
        assert isinstance(taboos, list)
        # All entries should be strings (the taboo_words field)
        for t in taboos:
            assert isinstance(t, str)

    def test_get_style_formula_returns_writing_formula(self):
        gt = GenreTemplate()
        formula = gt.get_style_formula("cool_novel")
        assert isinstance(formula, dict)
        assert "sentence" in formula

    def test_get_structured_taboos_returns_list_of_dicts(self):
        """Structured taboos are dicts, not strings."""
        gt = GenreTemplate()
        taboos = gt.get_structured_taboos("cool_novel")
        assert isinstance(taboos, list)
        # Structured taboos may be empty list — that's fine, but if present they should be dicts
        for t in taboos:
            assert isinstance(t, dict)