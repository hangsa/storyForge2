"""Tests for GenreCatalog loader and getters."""
import pytest
import yaml
from pathlib import Path
from backend.genres.catalog import GenreCatalog, CatalogLoadError


@pytest.fixture
def tmp_catalog(tmp_path):
    """Build a minimal valid catalog under tmp_path/config/genres."""
    cat_dir = tmp_path / "config" / "genres"
    cat_dir.mkdir(parents=True)

    (cat_dir / "index.yaml").write_text(yaml.safe_dump({
        "genres": [
            {"id": "alpha", "label_zh": "甲", "label_en": "Alpha", "family": "test"},
            {"id": "beta",  "label_zh": "乙", "label_en": "Beta",  "family": "test"},
        ]
    }, allow_unicode=True), encoding="utf-8")

    (cat_dir / "families.yaml").write_text(yaml.safe_dump({
        "families": {"test": ["alpha", "beta"]}
    }, allow_unicode=True), encoding="utf-8")

    (cat_dir / "compatibility.yaml").write_text(yaml.safe_dump({
        "matrix": {
            "alpha": {"beta": 0.5},
            "beta":  {"alpha": 0.5},
        }
    }), encoding="utf-8")

    for gid, dist in [("alpha", {"beta": 0.5}), ("beta", {"alpha": 0.5})]:
        (cat_dir / f"{gid}.yaml").write_text(yaml.safe_dump({
            "id": gid,
            "label_zh": "甲" if gid == "alpha" else "乙",
            "label_en": gid.capitalize(),
            "family": "test",
            "pacing": {"min_beats_per_1k": 1.0},
            "tone": "test tone",
            "style_rules": [],
            "writing_formula": {"sentence": {"avg_length_max": 30}},
            "taboo_words": [],
            "taboos": [],
            "trope_patterns": [],
            "thresholds": {"addiction_critical": 50, "fatigue_formula": {"threshold": 60, "decay": 1.0}},
            "model_preferences": {"creative_core": "claude-opus-4-7", "temperature": 0.7},
            "fusion_meta": {"distances": dist},
        }, allow_unicode=True), encoding="utf-8")

    return cat_dir


class TestGenreCatalogLoad:
    def test_loads_valid_catalog(self, tmp_catalog):
        cat = GenreCatalog(genres_dir=tmp_catalog)
        cat._load()
        assert cat.get("alpha")["id"] == "alpha"

    def test_missing_index_file_fails(self, tmp_path):
        empty = tmp_path / "config" / "genres"
        empty.mkdir(parents=True)
        cat = GenreCatalog(genres_dir=empty)
        with pytest.raises(CatalogLoadError, match="index.yaml"):
            cat._load()

    def test_index_references_missing_yaml_fails(self, tmp_catalog):
        (tmp_catalog / "index.yaml").write_text(yaml.safe_dump({
            "genres": [{"id": "ghost", "label_zh": "鬼", "label_en": "Ghost", "family": "test"}]
        }, allow_unicode=True))
        cat = GenreCatalog(genres_dir=tmp_catalog)
        with pytest.raises(CatalogLoadError, match="ghost"):
            cat._load()

    def test_per_genre_missing_required_field_fails(self, tmp_catalog):
        bad = tmp_catalog / "alpha.yaml"
        data = yaml.safe_load(bad.read_text(encoding="utf-8"))
        del data["tone"]
        bad.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
        cat = GenreCatalog(genres_dir=tmp_catalog)
        with pytest.raises(CatalogLoadError, match="tone"):
            cat._load()

    def test_distances_missing_id_fails(self, tmp_catalog):
        bad = tmp_catalog / "alpha.yaml"
        data = yaml.safe_load(bad.read_text(encoding="utf-8"))
        del data["fusion_meta"]["distances"]["beta"]
        bad.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
        cat = GenreCatalog(genres_dir=tmp_catalog)
        with pytest.raises(CatalogLoadError, match="fusion_meta.distances"):
            cat._load()

    def test_compatibility_asymmetric_fails(self, tmp_catalog):
        (tmp_catalog / "compatibility.yaml").write_text(yaml.safe_dump({
            "matrix": {
                "alpha": {"beta": 0.5},
                "beta":  {"alpha": 0.7},  # asymmetric
            }
        }), encoding="utf-8")
        cat = GenreCatalog(genres_dir=tmp_catalog)
        with pytest.raises(CatalogLoadError, match="symmetric"):
            cat._load()

    def test_compatibility_within_tolerance_passes(self, tmp_catalog):
        (tmp_catalog / "compatibility.yaml").write_text(yaml.safe_dump({
            "matrix": {
                "alpha": {"beta": 0.5},
                "beta":  {"alpha": 0.505},  # within 0.01 tolerance
            }
        }), encoding="utf-8")
        cat = GenreCatalog(genres_dir=tmp_catalog)
        cat._load()  # should not raise
        assert cat.get_compatibility("alpha", "beta") == 0.5


class TestGenreCatalogGetters:
    def test_list_returns_all(self, tmp_catalog):
        cat = GenreCatalog(genres_dir=tmp_catalog)
        ids = [e["id"] for e in cat.list()]
        assert ids == ["alpha", "beta"]

    def test_get_thresholds(self, tmp_catalog):
        cat = GenreCatalog(genres_dir=tmp_catalog)
        assert cat.get_thresholds("alpha")["addiction_critical"] == 50

    def test_get_pacing(self, tmp_catalog):
        cat = GenreCatalog(genres_dir=tmp_catalog)
        assert cat.get_pacing("alpha")["min_beats_per_1k"] == 1.0

    def test_get_formula(self, tmp_catalog):
        cat = GenreCatalog(genres_dir=tmp_catalog)
        assert cat.get_formula("alpha")["sentence"]["avg_length_max"] == 30

    def test_get_taboos(self, tmp_catalog):
        cat = GenreCatalog(genres_dir=tmp_catalog)
        assert cat.get_taboos("alpha") == []

    def test_get_compatibility(self, tmp_catalog):
        cat = GenreCatalog(genres_dir=tmp_catalog)
        assert cat.get_compatibility("alpha", "beta") == 0.5

    def test_get_family(self, tmp_catalog):
        cat = GenreCatalog(genres_dir=tmp_catalog)
        assert cat.get_family("alpha") == "test"

    def test_unknown_genre_returns_fallback(self, tmp_catalog):
        cat = GenreCatalog(genres_dir=tmp_catalog)
        # First entry is the fallback
        fallback = cat.get("nonexistent")
        assert fallback["id"] in ("alpha", "beta")

    def test_list_with_ui_visible_only_hides_flagged(self, tmp_catalog):
        data = yaml.safe_load((tmp_catalog / "index.yaml").read_text(encoding="utf-8"))
        # Mark alpha as hidden
        for entry in data["genres"]:
            if entry["id"] == "alpha":
                entry["ui_visible"] = False
        (tmp_catalog / "index.yaml").write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")

        cat = GenreCatalog(genres_dir=tmp_catalog)
        assert [e["id"] for e in cat.list(ui_visible_only=True)] == ["beta"]
        # And unfiltered: both present (ui_visible still surfaces in the dict for clients to inspect)
        assert {e["id"] for e in cat.list(ui_visible_only=False)} == {"alpha", "beta"}
        # And the hidden one has ui_visible=False in the result
        alpha_result = next(e for e in cat.list(ui_visible_only=False) if e["id"] == "alpha")
        assert alpha_result["ui_visible"] is False

    def test_compatibility_missing_pair_returns_default(self, tmp_catalog):
        cat = GenreCatalog(genres_dir=tmp_catalog)
        # alpha/beta is in matrix, but alpha/alpha_or_other_unknown returns 0.0 (self)
        assert cat.get_compatibility("alpha", "alpha") == 0.0
        # Unknown pair not in matrix returns default 1.0
        assert cat.get_compatibility("alpha", "no_such_genre") == 1.0

    def test_default_ui_visible_is_true(self, tmp_catalog):
        cat = GenreCatalog(genres_dir=tmp_catalog)
        results = cat.list()
        # Both alpha and beta lack ui_visible in the index — default to True
        assert all(e["ui_visible"] is True for e in results)
