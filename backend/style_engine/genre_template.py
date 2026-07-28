"""Thin wrapper around GenreCatalog for backward compat with existing callers."""
from pathlib import Path
from typing import Optional

from backend.config import settings


class GenreTemplate:
    """Legacy API: load genre template settings by id.

    Delegates to the unified GenreCatalog. Existing callers (chapter_review,
    stage4_writing, reviewer) continue to work without change.
    """

    def __init__(self, style_dir: Optional[Path] = None):
        # style_dir argument kept for backward compat; ignored when catalog is available
        self._style_dir = Path(style_dir) if style_dir else settings.style_dir

    def _catalog(self):
        from backend.genres.catalog import get_catalog
        return get_catalog()

    def load(self, template_name: str = "cool_novel") -> dict:
        return self._catalog().get(template_name)

    def get_pacing(self, template_name: str = "cool_novel") -> dict:
        return self._catalog().get_pacing(template_name)

    def get_tone_rules(self, template_name: str = "cool_novel") -> dict:
        return self._catalog().get_tone_rules(template_name)

    def get_taboos(self, template_name: str = "cool_novel") -> list[str]:
        entry = self._catalog().get(template_name)
        return entry.get("taboo_words", [])

    def get_style_formula(self, template_name: str = "cool_novel") -> dict:
        return self._catalog().get_formula(template_name)

    def get_structured_taboos(self, template_name: str = "cool_novel") -> list[dict]:
        return self._catalog().get_taboos(template_name)