"""Single source of truth for genre config.

Loads config/genres/{index.yaml, <id>.yaml × N, families.yaml, compatibility.yaml}
with full validation. All downstream systems (Style Engine, ReaderOS, Fusion
Engine, prompts, frontend API) read from this singleton.
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Optional

import yaml

from backend.config import settings

logger = logging.getLogger(__name__)


class CatalogLoadError(Exception):
    """Raised when the catalog fails to load or validate."""


_REQUIRED_GENRE_FIELDS = (
    "id", "label_zh", "label_en", "family",
    "pacing", "tone", "style_rules", "writing_formula",
    "taboo_words", "taboos", "trope_patterns",
    "thresholds", "model_preferences", "fusion_meta",
)


class GenreCatalog:
    """Lazy-loading genre catalog. Single instance per process via get_catalog()."""

    def __init__(self, genres_dir: Optional[Path] = None):
        self._dir = Path(genres_dir) if genres_dir else settings.genres_dir
        self._entries: dict[str, dict] | None = None
        self._index: list[dict] | None = None
        self._compatibility: dict | None = None
        self._families: dict | None = None

    def _load(self) -> None:
        try:
            self._load_index()
            self._load_entries()
            self._load_compatibility()
            self._load_families()
            self._validate_distances()
        except FileNotFoundError as e:
            raise CatalogLoadError(f"Required file missing: {e.filename}") from e
        except yaml.YAMLError as e:
            raise CatalogLoadError(f"YAML parse error: {e}") from e

    def _load_index(self) -> None:
        path = self._dir / "index.yaml"
        if not path.exists():
            raise CatalogLoadError(f"index.yaml not found in {self._dir}")
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        self._index = data.get("genres") or []
        if not self._index:
            raise CatalogLoadError("index.yaml has no genres entry")

    def _load_entries(self) -> None:
        self._entries = {}
        for entry in self._index:  # type: ignore[union-attr]
            gid = entry["id"]
            yaml_path = self._dir / f"{gid}.yaml"
            if not yaml_path.exists():
                raise CatalogLoadError(
                    f"index references '{gid}' but config/genres/{gid}.yaml is missing"
                )
            data = yaml.safe_load(yaml_path.read_text(encoding="utf-8")) or {}
            for field in _REQUIRED_GENRE_FIELDS:
                if field not in data:
                    raise CatalogLoadError(
                        f"config/genres/{gid}.yaml missing required field '{field}'"
                    )
            if data["id"] != gid:
                raise CatalogLoadError(
                    f"config/genres/{gid}.yaml has id='{data['id']}' (mismatch)"
                )
            self._entries[gid] = data

    def _load_compatibility(self) -> None:
        path = self._dir / "compatibility.yaml"
        if not path.exists():
            raise CatalogLoadError("compatibility.yaml not found")
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        matrix = data.get("matrix") or {}
        # Symmetry check
        for a, row in matrix.items():
            for b, val in row.items():
                rev = matrix.get(b, {}).get(a)
                if rev is None:
                    raise CatalogLoadError(
                        f"compatibility.yaml: missing reverse entry {b}→{a}"
                    )
                if abs(val - rev) > 0.01:
                    raise CatalogLoadError(
                        f"compatibility.yaml asymmetric: {a}→{b}={val} vs {b}→{a}={rev}"
                    )
        self._compatibility = matrix

    def _load_families(self) -> None:
        path = self._dir / "families.yaml"
        if not path.exists():
            raise CatalogLoadError("families.yaml not found")
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        self._families = data.get("families") or {}

    def _validate_distances(self) -> None:
        ids = sorted(self._entries.keys())  # type: ignore[union-attr]
        for gid, entry in self._entries.items():  # type: ignore[union-attr]
            distances = entry["fusion_meta"]["distances"]
            expected = set(ids) - {gid}
            actual = set(distances.keys())
            if actual != expected:
                missing = expected - actual
                extra = actual - expected
                raise CatalogLoadError(
                    f"config/genres/{gid}.yaml fusion_meta.distances mismatch: "
                    f"missing={sorted(missing)}, extra={sorted(extra)}"
                )

    # --- Public API ---

    def get(self, genre_id: str) -> dict:
        """Return full entry dict; falls back to first index entry on unknown id."""
        if self._entries is None:
            self._load()
        if genre_id in self._entries:  # type: ignore[operator]
            return self._entries[genre_id]  # type: ignore[index]
        logger.warning("Unknown genre '%s' — falling back to first index entry", genre_id)
        fallback_id = self._index[0]["id"]  # type: ignore[index]
        return self._entries[fallback_id]  # type: ignore[index]

    def list(self, ui_visible_only: bool = False) -> list[dict]:
        """Return list of index entries; if ui_visible_only=True, hide entries with ui_visible=False."""
        if self._index is None:
            self._load()
        result = []
        for entry in self._index:  # type: ignore[union-attr]
            if ui_visible_only and entry.get("ui_visible") is False:
                continue
            result.append({
                "id": entry["id"],
                "label_zh": entry["label_zh"],
                "label_en": entry["label_en"],
                "family": entry["family"],
                "ui_visible": entry.get("ui_visible", True),
            })
        return result

    def get_thresholds(self, genre_id: str) -> dict:
        return self.get(genre_id)["thresholds"]

    def get_pacing(self, genre_id: str) -> dict:
        return self.get(genre_id)["pacing"]

    def get_formula(self, genre_id: str) -> dict:
        return self.get(genre_id)["writing_formula"]

    def get_taboos(self, genre_id: str) -> list[dict]:
        return self.get(genre_id)["taboos"]

    def get_tone_rules(self, genre_id: str) -> dict:
        entry = self.get(genre_id)
        return {
            "tone": entry["tone"],
            "taboo_words": entry.get("taboo_words", []),
            "style_rules": entry.get("style_rules", []),
        }

    def get_compatibility(self, a: str, b: str) -> float:
        """Return compatibility score [0.0, 1.0]. 0.0 for self-pairs, 1.0 default for unknown pairs."""
        if a == b:
            return 0.0
        if self._compatibility is None:
            self._load()
        return self._compatibility.get(a, {}).get(b, 1.0)  # type: ignore[union-attr]

    def get_family(self, genre_id: str) -> str:
        return self.get(genre_id)["family"]


_catalog: GenreCatalog | None = None
_catalog_lock = threading.Lock()


def get_catalog() -> GenreCatalog:
    """Module-level singleton. Lazy-loads on first call. Thread-safe."""
    global _catalog
    if _catalog is None:
        with _catalog_lock:
            if _catalog is None:
                _catalog = GenreCatalog()
                _catalog._load()
    return _catalog
