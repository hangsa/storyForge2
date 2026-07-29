"""Thin wrapper around GenreCatalog for backward compat with existing callers."""
from backend.genres.catalog import get_catalog


class GenreTemplate:
    """Legacy API: load genre template settings by id.

    Delegates to the unified GenreCatalog. Existing callers (chapter_review,
    stage4_writing, reviewer) continue to work without change.
    """

    def load(self, template_name: str = "cool_novel") -> dict:
        return get_catalog().get(template_name)

    def get_pacing(self, template_name: str = "cool_novel") -> dict:
        return get_catalog().get_pacing(template_name)

    def get_tone_rules(self, template_name: str = "cool_novel") -> dict:
        return get_catalog().get_tone_rules(template_name)

    def get_taboos(self, template_name: str = "cool_novel") -> list[str]:
        entry = get_catalog().get(template_name)
        return entry.get("taboo_words", [])

    def get_style_formula(self, template_name: str = "cool_novel") -> dict:
        return get_catalog().get_formula(template_name)

    def get_structured_taboos(self, template_name: str = "cool_novel") -> list[dict]:
        return get_catalog().get_taboos(template_name)
