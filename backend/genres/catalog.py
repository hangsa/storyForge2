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
    "beat_patterns",  # NEW: required for Stage 3 outline generation prompts
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
            self._validate_beat_patterns(gid, data)  # NEW
            self._entries[gid] = data

    def _validate_beat_patterns(self, gid: str, entry: dict) -> None:
        """Validate the shape of `beat_patterns` for a single genre entry.

        Rules (per spec 2026-07-29):
          - beat_patterns must be a non-empty list
          - Each template must have:
            - keywords: non-empty list of strings, each ≥2 chars
            - priority: int in [0, 100]
            - beats: non-empty list of dicts
          - Each beat must have:
            - description: non-empty string
            - words: int > 0
            - focus: str ∈ focus vocabulary (config/genre_focus_vocabulary.yaml)
        """
        focus_vocab_path = self._dir.parent / "genre_focus_vocabulary.yaml"
        if focus_vocab_path.is_file():
            vocab = (yaml.safe_load(focus_vocab_path.read_text(encoding="utf-8")) or {}).get("focus_legend") or {}
            valid_focuses = set(vocab.keys())
        else:
            valid_focuses = set()  # If vocab file missing, validation will reject all focus values

        patterns = entry.get("beat_patterns")
        if not isinstance(patterns, list) or len(patterns) == 0:
            raise CatalogLoadError(
                f"config/genres/{gid}.yaml beat_patterns invalid: must be a non-empty list"
            )

        for i, tmpl in enumerate(patterns):
            if not isinstance(tmpl, dict):
                raise CatalogLoadError(
                    f"config/genres/{gid}.yaml beat_patterns invalid: beat_patterns[{i}] must be a dict"
                )
            keywords = tmpl.get("keywords")
            if not isinstance(keywords, list) or len(keywords) == 0:
                raise CatalogLoadError(
                    f"config/genres/{gid}.yaml beat_patterns invalid: beat_patterns[{i}].keywords must be non-empty list"
                )
            for k_idx, kw in enumerate(keywords):
                if not isinstance(kw, str) or len(kw) < 2:
                    raise CatalogLoadError(
                        f"config/genres/{gid}.yaml beat_patterns invalid: beat_patterns[{i}].keywords[{k_idx}] must be string ≥2 chars, got {kw!r}"
                    )

            priority = tmpl.get("priority")
            if not isinstance(priority, int) or not (0 <= priority <= 100):
                raise CatalogLoadError(
                    f"config/genres/{gid}.yaml beat_patterns invalid: beat_patterns[{i}].priority must be int in [0,100], got {priority!r}"
                )

            beats = tmpl.get("beats")
            if not isinstance(beats, list) or len(beats) == 0:
                raise CatalogLoadError(
                    f"config/genres/{gid}.yaml beat_patterns invalid: beat_patterns[{i}].beats must be non-empty list"
                )
            for b_idx, beat in enumerate(beats):
                if not isinstance(beat, dict):
                    raise CatalogLoadError(
                        f"config/genres/{gid}.yaml beat_patterns invalid: beat_patterns[{i}].beats[{b_idx}] must be a dict"
                    )
                desc = beat.get("description")
                if not isinstance(desc, str) or not desc.strip():
                    raise CatalogLoadError(
                        f"config/genres/{gid}.yaml beat_patterns invalid: beat_patterns[{i}].beats[{b_idx}].description must be non-empty string"
                    )
                words = beat.get("words")
                if not isinstance(words, int) or words <= 0:
                    raise CatalogLoadError(
                        f"config/genres/{gid}.yaml beat_patterns invalid: beat_patterns[{i}].beats[{b_idx}].words must be int > 0"
                    )
                focus = beat.get("focus")
                if not isinstance(focus, str) or focus not in valid_focuses:
                    raise CatalogLoadError(
                        f"config/genres/{gid}.yaml beat_patterns invalid: beat_patterns[{i}].beats[{b_idx}].focus must be in {sorted(valid_focuses)}, got {focus!r}"
                    )

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
