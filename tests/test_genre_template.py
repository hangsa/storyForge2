"""
Unit tests for genre_template.py — genre template loading and retrieval.
"""
import tempfile
from pathlib import Path

import pytest

from backend.style_engine.genre_template import GenreTemplate


@pytest.fixture
def style_dir():
    with tempfile.TemporaryDirectory() as tmp:
        yield Path(tmp)


def _write_yaml(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


class TestGenreTemplateLoad:
    def test_load_cool_novel_default(self):
        """Load the real cool_novel.yaml template."""
        gt = GenreTemplate()
        data = gt.load("cool_novel")
        assert isinstance(data, dict)
        assert "tone" in data

    def test_load_nonexistent_raises(self, style_dir):
        gt = GenreTemplate(style_dir)
        with pytest.raises(FileNotFoundError):
            gt.load("nonexistent")

    def test_load_custom_template(self, style_dir):
        _write_yaml(style_dir / "custom.yaml", "tone: dark\npacing:\n  scenes_per_chapter: 3\n")
        gt = GenreTemplate(style_dir)
        data = gt.load("custom")
        assert data["tone"] == "dark"
        assert data["pacing"]["scenes_per_chapter"] == 3

    def test_load_empty_yaml_returns_dict(self, style_dir):
        _write_yaml(style_dir / "empty.yaml", "")
        gt = GenreTemplate(style_dir)
        data = gt.load("empty")
        assert data == {}


class TestGenreTemplateGetters:
    def test_get_pacing(self, style_dir):
        _write_yaml(style_dir / "test.yaml",
            "pacing:\n  scenes_per_chapter: 4\n  words_per_scene: 1500\n")
        gt = GenreTemplate(style_dir)
        pacing = gt.get_pacing("test")
        assert pacing["scenes_per_chapter"] == 4

    def test_get_pacing_defaults(self, style_dir):
        _write_yaml(style_dir / "minimal.yaml", "tone: light\n")
        gt = GenreTemplate(style_dir)
        pacing = gt.get_pacing("minimal")
        assert pacing == {}

    def test_get_tone_rules(self, style_dir):
        _write_yaml(style_dir / "rules.yaml",
            "tone: dark\n"
            "taboo_words:\n  - 死亡\n  - 血腥\n"
            "style_rules:\n  - 句长不超过40字\n")
        gt = GenreTemplate(style_dir)
        rules = gt.get_tone_rules("rules")
        assert rules["tone"] == "dark"
        assert len(rules["taboo_words"]) == 2
        assert len(rules["style_rules"]) == 1

    def test_get_taboos(self, style_dir):
        _write_yaml(style_dir / "taboo.yaml",
            "taboo_words:\n  - 死亡\n  - 背叛\n")
        gt = GenreTemplate(style_dir)
        taboos = gt.get_taboos("taboo")
        assert taboos == ["死亡", "背叛"]

    def test_get_taboos_empty(self, style_dir):
        _write_yaml(style_dir / "no_taboo.yaml", "tone: light\n")
        gt = GenreTemplate(style_dir)
        taboos = gt.get_taboos("no_taboo")
        assert taboos == []
