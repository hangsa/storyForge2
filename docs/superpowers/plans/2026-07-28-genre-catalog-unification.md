# Genre Catalog Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the three separate genre systems (`data/style/*.yaml`, `config/genre_thresholds.yaml`, `backend/creative_os/genre_fusion_engine.py`) into a single canonical catalog under `config/genres/`, plus expose all supported genres to the frontend via a new `GET /api/v1/genres` endpoint.

**Architecture:** Per-genre YAML files in `config/genres/` (17 total) + central `index.yaml`/`families.yaml`/`compatibility.yaml`. `backend/genres/catalog.py` exposes a `GenreCatalog` singleton that downstream systems (Style Engine, ReaderOS, Fusion Engine, prompts, API) read from. Frontend `useGenres()` hook fetches from the new API. Old files (`data/style/`, `config/genre_thresholds.yaml`, hardcoded fusion constants) get deprecation banners for one release then are deleted.

**Tech Stack:** Python 3.9 + FastAPI + pytest + PyYAML + pydantic-settings, React 18 + TypeScript + Vite + Vitest + React Testing Library. Existing `GenreTemplate`, existing `FileManager`, existing `api/client.ts`.

**Spec:** `docs/superpowers/specs/2026-07-28-genre-catalog-unification-design.md`

---

## File Structure

Files this plan creates or modifies:

**New — Backend**
- `backend/genres/__init__.py`
- `backend/genres/catalog.py` — `GenreCatalog` class + `get_catalog()` singleton
- `backend/genres/migrations.py` — old-to-new extraction helpers
- `backend/api/genres.py` — `GET /api/v1/genres` endpoint
- `tests/test_genre_catalog.py`
- `tests/test_genre_migrations.py`
- `tests/test_genres_api.py`

**New — Config**
- `config/genres/index.yaml` — 17 entries (id + labels + family + ui_visible)
- `config/genres/families.yaml` — family-to-genres map
- `config/genres/compatibility.yaml` — symmetric pairwise matrix
- `config/genres/<id>.yaml` × 17 — full per-genre config

**New — Scripts**
- `scripts/migrate_genre_catalog.py` — one-shot migration
- `tests/test_migrate_genre_catalog.py`

**New — Frontend**
- `frontend/src/hooks/useGenres.ts`
- (no new test — extends existing `genres.test.ts`)

**Modified — Backend**
- `backend/style_engine/genre_template.py` — delegate to `GenreCatalog`
- `backend/reader_os/thresholds.py` — read from `GenreCatalog` (fallback to legacy)
- `backend/creative_os/genre_fusion_engine.py` — remove hardcoded constants; read from `GenreCatalog` (fallback to legacy)
- `backend/prompts/prompt_placeholders.py` (or equivalent) — `{genre}` renders `catalog.label_zh`
- `backend/main.py` — include new `genres` router
- `backend/config.py` — add `genres_dir` setting

**Modified — Frontend**
- `frontend/src/api/client.ts` — add `listGenres()`
- `frontend/src/components/home/CreateProjectCard.tsx` — use `useGenres()`
- `frontend/src/components/home/BookShelf.tsx` — use `useGenres()`
- `frontend/src/components/home/BookShelfModal.tsx` — use `useGenres()`
- `frontend/src/constants/genres.ts` — mark deprecated, stub
- `frontend/src/test/genres.test.ts` — add hook fetch coverage
- `frontend/src/test/BookShelf.test.tsx` — mock `useGenres()`
- `frontend/src/test/BookShelfModal.test.tsx` — mock `useGenres()`
- `frontend/src/test/CreateProjectCard.test.tsx` (if exists; else add) — mock `useGenres()`

**Deprecated (banner only, deleted next release)**
- `data/style/*.yaml` × 7
- `config/genre_thresholds.yaml`
- `backend/creative_os/genre_fusion_engine.py:_LEGACY_GENRE_GRAPH`, `_LEGACY_COMPATIBILITY_MATRIX`

---

# Phase 0 — Skeleton

### Task 1: Create config skeleton with the 7 existing genres

**Files:**
- Create: `config/genres/index.yaml`
- Create: `config/genres/families.yaml`
- Create: `config/genres/compatibility.yaml`
- Create: `config/genres/cool_novel.yaml`
- Create: `config/genres/xianxia.yaml`
- Create: `config/genres/xuanhuan.yaml`
- Create: `config/genres/dushi.yaml`
- Create: `config/genres/kehuan.yaml`
- Create: `config/genres/xuanyi.yaml`
- Create: `config/genres/yanqing.yaml`
- Modify: `backend/config.py` (add `genres_dir` setting)

- [ ] **Step 1.1: Add `genres_dir` to backend/config.py**

Read `backend/config.py` first; then add this field alongside the existing settings (e.g., near `style_dir`):

```python
genres_dir: Path = Path(__file__).parent.parent / "config" / "genres"
```

- [ ] **Step 1.2: Create `config/genres/index.yaml` (7 entries, no fusion-only genres yet)**

```yaml
# Genre catalog index. Each id MUST have a matching config/genres/<id>.yaml.
# UI dropdown order matches this list. ui_visible defaults to true when omitted.
genres:
  - { id: cool_novel, label_zh: 爽文, label_en: Power Fantasy,  family: power_fantasy }
  - { id: xianxia,    label_zh: 仙侠, label_en: Xianxia,         family: cultivation   }
  - { id: xuanhuan,   label_zh: 玄幻, label_en: Xuanhuan,        family: cultivation   }
  - { id: dushi,      label_zh: 都市, label_en: Contemporary,    family: contemporary  }
  - { id: kehuan,     label_zh: 科幻, label_en: Sci-Fi,          family: sci_fi        }
  - { id: xuanyi,     label_zh: 悬疑, label_en: Mystery,         family: mystery       }
  - { id: yanqing,    label_zh: 言情, label_en: Romance,         family: romance       }
```

- [ ] **Step 1.3: Create `config/genres/families.yaml`**

```yaml
families:
  cultivation:    [xianxia, xuanhuan]
  mystery:        [xuanyi]
  sci_fi:         [kehuan]
  contemporary:   [dushi]
  power_fantasy:  [cool_novel]
  romance:        [yanqing]
```

- [ ] **Step 1.4: Create `config/genres/compatibility.yaml` for the 7 ids**

The loader requires symmetry. For these 7 ids, mirror the values from `backend/creative_os/genre_fusion_engine.py:COMPATIBILITY_MATRIX` (already in the codebase). Example format:

```yaml
matrix:
  cool_novel:
    xianxia:    0.70
    xuanhuan:   0.70
    dushi:      0.40
    kehuan:     0.45
    xuanyi:     0.30
    yanqing:    0.20
  xianxia:
    cool_novel: 0.70
    xuanhuan:   0.80
    dushi:      0.30
    kehuan:     0.40
    xuanyi:     0.45
    yanqing:    0.30
  # ... continue for all 7 ids × 6 others; ensure a→b == b→a
```

To get the exact values, read `backend/creative_os/genre_fusion_engine.py` lines containing `COMPATIBILITY_MATRIX`. Extract only the entries for the 7 listed ids.

- [ ] **Step 1.5: Create the 7 per-genre YAML files**

For each existing id, read `data/style/<id>.yaml` and `config/genre_thresholds.yaml` and merge into one `config/genres/<id>.yaml`:

```yaml
id: xuanyi
label_zh: 悬疑
label_en: Mystery
family: mystery

pacing:
  # from data/style/xuanyi.yaml:pacing
  min_beats_per_1k: 1.0
  escalation_interval: 3
  action_ratio: 0.25
  max_consecutive_non_action: 4
  chapter_words: { min: 2500, max: 5000 }
  scene_words:   { min: 400,  max: 1800 }

tone: |
  # from data/style/xuanyi.yaml:tone
  紧张压抑，疑云密布。每个场景都应埋藏线索或引导读者产生疑问。
  信息释放要有层次——先呈现现象，再揭示部分真相，最后反转。
  描写要冷静克制，让读者自己拼图。气氛渲染重于人物抒情。

style_rules:
  # from data/style/xuanyi.yaml:style_rules
  - "每500字埋一个线索或暗示"
  - "反转前必须有伏笔回收"
  - "避免全知视角透露关键信息"
  # ... all entries from data/style/xuanyi.yaml

writing_formula:
  # merged from data/style/<id>.yaml:writing_formula + style_formula
  sentence:  { avg_length_max: 28, short_pct_min: 35, long_pct_max: 22 }
  dialogue:  { ratio_min: 0.18, max_consecutive_lines: 8 }
  paragraph: { max_sentences: 4, max_words: 250 }
  emotional_beat_density_min: 0.3
  satisfaction_beat_min: 1
  suspense_hook_required: true

taboo_words:
  # from data/style/xuanyi.yaml:taboo_words
  - "显而易见"
  - "随便猜"
  # ... all entries

taboos:
  # from data/style/xuanyi.yaml:taboos
  - name: ...
    type: ...
    keywords: [...]
    max_chars: ...
    max_consecutive: ...
    severity: ...

trope_patterns:
  # from data/style/xuanyi.yaml:trope_patterns
  - { name: ..., description: ..., min_interval: ..., max_per_volume: ... }
  # ... all entries

thresholds:
  # from config/genre_thresholds.yaml — match by genre key. GENRE_NAME_MAPPING in
  # backend/reader_os/thresholds.py maps Chinese ↔ pinyin. The "悬疑推理" Chinese key
  # in genre_thresholds.yaml corresponds to xuanyi. Extract that block.
  addiction_critical:     ...
  addiction_moderate:     ...
  # ... all 15 numeric fields + fatigue_formula

model_preferences:
  # from data/style/<id>.yaml:model_preferences
  creative_core: ...
  temperature: ...

fusion_meta:
  distances:
    # Distances to other 6 ids (1 - compatibility, or author reasonable values)
    cool_novel: 0.30
    xianxia:    0.55
    xuanhuan:   0.60
    dushi:      0.70
    kehuan:     0.50
    yanqing:    0.75
```

The exact `thresholds` block for each of the 7 ids comes from `config/genre_thresholds.yaml`. Use the `GENRE_NAME_MAPPING` dictionary in `backend/reader_os/thresholds.py` to find the right Chinese key:

- cool_novel → 爽文
- xianxia → 仙侠 (if not present, use sensible defaults from 严肃文学 or another)
- xuanhuan → 玄幻 (if not present, defaults)
- dushi → 都市 (if not present, defaults)
- kehuan → 科幻
- xuanyi → 悬疑推理
- yanqing → 言情 (if not present, defaults)

If a genre has no entry in `genre_thresholds.yaml`, copy the closest family-mate's thresholds and add a `# TODO: tune for <id>` comment.

- [ ] **Step 1.6: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add backend/config.py config/genres/
git commit -m "feat(genres): create config skeleton with 7 existing genres"
```

---

# Phase 1 — Catalog Core Loader

### Task 2: GenreCatalog class with full validation

**Files:**
- Create: `backend/genres/__init__.py`
- Create: `backend/genres/catalog.py`
- Create: `tests/test_genre_catalog.py`

- [ ] **Step 2.1: Write the failing test for index/per-genre validation**

Create `tests/test_genre_catalog.py`:

```python
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
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `source venv/bin/activate && pytest tests/test_genre_catalog.py -v`
Expected: ImportError or ModuleNotFoundError because `backend.genres.catalog` doesn't exist yet.

- [ ] **Step 2.3: Implement `backend/genres/__init__.py`**

```python
from backend.genres.catalog import GenreCatalog, CatalogLoadError, get_catalog

__all__ = ["GenreCatalog", "CatalogLoadError", "get_catalog"]
```

- [ ] **Step 2.4: Implement `backend/genres/catalog.py`**

```python
"""Single source of truth for genre config.

Loads config/genres/{index.yaml, <id>.yaml × N, families.yaml, compatibility.yaml}
with full validation. All downstream systems (Style Engine, ReaderOS, Fusion
Engine, prompts, frontend API) read from this singleton.
"""
import logging
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
        if self._entries is None:
            self._load()
        if genre_id in self._entries:  # type: ignore[operator]
            return self._entries[genre_id]  # type: ignore[index]
        logger.warning("Unknown genre '%s' — falling back to first index entry", genre_id)
        fallback_id = self._index[0]["id"]  # type: ignore[index]
        return self._entries[fallback_id]  # type: ignore[index]

    def list(self, ui_visible_only: bool = False) -> list[dict]:
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
        if a == b:
            return 0.0
        if self._compatibility is None:
            self._load()
        return self._compatibility.get(a, {}).get(b, 1.0)  # type: ignore[union-attr]

    def get_family(self, genre_id: str) -> str:
        return self.get(genre_id)["family"]


_catalog: GenreCatalog | None = None


def get_catalog() -> GenreCatalog:
    """Module-level singleton. Lazy-loads on first call."""
    global _catalog
    if _catalog is None:
        _catalog = GenreCatalog()
        _catalog._load()
    return _catalog
```

- [ ] **Step 2.5: Run test to verify it passes**

Run: `source venv/bin/activate && pytest tests/test_genre_catalog.py -v`
Expected: All 14 tests pass.

- [ ] **Step 2.6: Commit**

```bash
git add backend/genres/ tests/test_genre_catalog.py
git commit -m "feat(genres): GenreCatalog loader with full validation"
```

---

# Phase 2 — Downstream Switch

### Task 3: Switch Style Engine to GenreCatalog

**Files:**
- Modify: `backend/style_engine/genre_template.py`
- Test: `tests/test_genre_template.py` (existing — must still pass)

- [ ] **Step 3.1: Read existing `genre_template.py` and `tests/test_genre_template.py`**

Note that the existing `GenreTemplate` class loads from `settings.style_dir` (data/style). We'll make it a thin delegator to `GenreCatalog`.

- [ ] **Step 3.2: Rewrite `genre_template.py`**

Replace the entire content of `backend/style_engine/genre_template.py`:

```python
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
```

- [ ] **Step 3.3: Run existing Style Engine tests**

Run: `source venv/bin/activate && pytest tests/test_genre_template.py tests/test_writing_formulas.py tests/test_taboo_constraints.py -v`
Expected: All pass. If anything fails, debug until it does.

- [ ] **Step 3.4: Commit**

```bash
git add backend/style_engine/genre_template.py
git commit -m "refactor(style): GenreTemplate delegates to GenreCatalog"
```

---

### Task 4: Switch ReaderOS thresholds to GenreCatalog (with legacy fallback)

**Files:**
- Modify: `backend/reader_os/thresholds.py`
- Test: `tests/test_reader_os.py` (existing — must still pass)

- [ ] **Step 4.1: Read existing `backend/reader_os/thresholds.py`**

Identify the `load_genre_thresholds()` function. We wrap it to consult catalog first.

- [ ] **Step 4.2: Add catalog-first lookup with legacy fallback**

In `backend/reader_os/thresholds.py`, modify `load_genre_thresholds()` to:

```python
def load_genre_thresholds(genre: str = "cool_novel") -> dict:
    """Load genre-specific ReaderOS thresholds. Catalog first, legacy fallback.

    One-release dual-read window: if GenreCatalog fails to load, fall back to
    config/genre_thresholds.yaml. Remove the fallback in the next release.
    """
    try:
        from backend.genres.catalog import get_catalog
        return get_catalog().get_thresholds(genre)
    except Exception as e:
        logger.warning("GenreCatalog unavailable, falling back to genre_thresholds.yaml: %s", e)
        return _legacy_load_genre_thresholds(genre)


def _legacy_load_genre_thresholds(genre: str = "cool_novel") -> dict:
    """Original implementation, kept as fallback for one release."""
    # ... the existing body of load_genre_thresholds, unchanged ...
```

Keep the legacy function as-is. Wrap the public function.

- [ ] **Step 4.3: Run existing ReaderOS tests**

Run: `source venv/bin/activate && pytest tests/test_reader_os.py tests/test_settings_api.py -v`
Expected: All pass.

- [ ] **Step 4.4: Commit**

```bash
git add backend/reader_os/thresholds.py
git commit -m "refactor(reader): thresholds delegate to GenreCatalog with legacy fallback"
```

---

### Task 5: Switch Fusion Engine to GenreCatalog (with legacy fallback)

**Files:**
- Modify: `backend/creative_os/genre_fusion_engine.py`
- Test: `tests/test_creative_os/test_genre_fusion_engine.py` (existing — must still pass)

- [ ] **Step 5.1: Read existing `genre_fusion_engine.py`**

Note the hardcoded `GENRE_GRAPH` and `COMPATIBILITY_MATRIX` constants. The class uses these to build its internal graph.

- [ ] **Step 5.2: Replace hardcoded reads with catalog reads (keep legacy fallback)**

In `backend/creative_os/genre_fusion_engine.py`:

a) Rename existing constants to `_LEGACY_GENRE_GRAPH` and `_LEGACY_COMPATIBILITY_MATRIX`.
b) In the class `__init__` (or wherever the graph is built), wrap construction in try/except:

```python
def _build_graph(self):
    try:
        from backend.genres.catalog import get_catalog
        catalog = get_catalog()
        self._graph = {g: [] for g in [e["id"] for e in catalog.list()]}
        for genre in self._graph:
            for other in self._graph:
                if other != genre:
                    compat = catalog.get_compatibility(genre, other)
                    if compat >= 0.3:
                        self._graph[genre].append((other, compat))
        return
    except Exception as e:
        logger.warning("GenreCatalog unavailable, falling back to legacy graph: %s", e)

    # Legacy fallback
    self._graph = dict(_LEGACY_GENRE_GRAPH)
    self._compatibility = dict(_LEGACY_COMPATIBILITY_MATRIX)
```

Adjust the rest of the class to handle either source uniformly. The simplest path: have a single `_compatibility` dict and a single `_graph` (built by the function above), and remove all other references to `GENRE_GRAPH`/`COMPATIBILITY_MATRIX` constants.

- [ ] **Step 5.3: Run existing Fusion Engine tests**

Run: `source venv/bin/activate && pytest tests/test_creative_os/test_genre_fusion_engine.py -v`
Expected: All pass.

- [ ] **Step 5.4: Commit**

```bash
git add backend/creative_os/genre_fusion_engine.py
git commit -m "refactor(fusion): genre graph reads from GenreCatalog with legacy fallback"
```

---

### Task 6: Switch prompt `{genre}` placeholder to catalog label

**Files:**
- Modify: `backend/prompts/` (find the placeholder renderer)
- Test: existing prompt tests

- [ ] **Step 6.1: Locate the `{genre}` placeholder renderer**

Run: `grep -rn "{genre}" /Users/longsa/Codes/storyForge2/backend/prompts/ /Users/longsa/Codes/storyForge2/backend/`
Look for `prompt_placeholders.py` or similar. Identify where `{genre}` gets replaced with a literal Chinese label.

- [ ] **Step 6.2: Update the renderer to use catalog**

Replace any hardcoded mapping with:

```python
try:
    from backend.genres.catalog import get_catalog
    return get_catalog().get(genre)["label_zh"]
except Exception as e:
    logger.warning("GenreCatalog unavailable for {genre} placeholder: %s", e)
    # legacy fallback: existing mapping
    return _legacy_genre_label(genre)
```

Where `_legacy_genre_label(genre)` is the original hardcoded mapping extracted to a helper function.

- [ ] **Step 6.3: Run prompt tests**

Run: `source venv/bin/activate && pytest tests/ -k "prompt" -v`
Expected: All pass.

- [ ] **Step 6.4: Commit**

```bash
git add backend/prompts/
git commit -m "refactor(prompts): {genre} placeholder reads from GenreCatalog"
```

---

### Task 7: New `GET /api/v1/genres` endpoint

**Files:**
- Create: `backend/api/genres.py`
- Modify: `backend/main.py`
- Create: `tests/test_genres_api.py`

- [ ] **Step 7.1: Write the failing test**

Create `tests/test_genres_api.py`:

```python
"""Tests for GET /api/v1/genres endpoint."""
import pytest
from fastapi.testclient import TestClient
from backend.main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_list_genres_returns_array(client):
    resp = client.get("/api/v1/genres")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 7  # at least the 7 existing


def test_list_genres_schema(client):
    resp = client.get("/api/v1/genres")
    data = resp.json()
    for entry in data:
        assert set(entry.keys()) >= {"id", "label_zh", "label_en", "family", "ui_visible"}
        assert isinstance(entry["id"], str)
        assert isinstance(entry["label_zh"], str)


def test_list_genres_ui_visible_only(client):
    resp = client.get("/api/v1/genres?ui_visible_only=true")
    data = resp.json()
    for entry in data:
        assert entry["ui_visible"] is True
```

- [ ] **Step 7.2: Run test to verify it fails**

Run: `source venv/bin/activate && pytest tests/test_genres_api.py -v`
Expected: 404 (route not found).

- [ ] **Step 7.3: Implement `backend/api/genres.py`**

```python
"""GET /api/v1/genres — list all genres for the frontend."""
from fastapi import APIRouter

from backend.genres.catalog import get_catalog

router = APIRouter(prefix="/api/v1/genres", tags=["genres"])


@router.get("")
async def list_genres(ui_visible_only: bool = True) -> list[dict]:
    """Return [{id, label_zh, label_en, family, ui_visible}, ...].

    Default `ui_visible_only=True` because the primary caller is the UI dropdown.
    Admin / internal callers can pass `?ui_visible_only=false` to get the full set.
    """
    return get_catalog().list(ui_visible_only=ui_visible_only)
```

- [ ] **Step 7.4: Register the router in `backend/main.py`**

Locate where other routers are included (e.g., `app.include_router(project.router)`) and add:

```python
from backend.api import genres as genres_api
app.include_router(genres_api.router)
```

- [ ] **Step 7.5: Run test to verify it passes**

Run: `source venv/bin/activate && pytest tests/test_genres_api.py -v`
Expected: 3 tests pass.

- [ ] **Step 7.6: Commit**

```bash
git add backend/api/genres.py backend/main.py tests/test_genres_api.py
git commit -m "feat(api): GET /api/v1/genres endpoint"
```

---

# Phase 3 — Frontend Switch

### Task 8: New `useGenres()` hook

**Files:**
- Create: `frontend/src/hooks/useGenres.ts`
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 8.1: Add `listGenres()` to `frontend/src/api/client.ts`**

Read the existing `client.ts` to find the right place. Add:

```typescript
import type { Genre } from "../hooks/useGenres";

export type { Genre };

// inside the api object
listGenres(uiVisibleOnly = true): Promise<Genre[]> {
  const qs = uiVisibleOnly ? "?ui_visible_only=true" : "";
  return fetch(`/api/v1/genres${qs}`).then((r) => r.json());
}
```

- [ ] **Step 8.2: Create `frontend/src/hooks/useGenres.ts`**

```typescript
import { useEffect, useState } from "react";
import api from "../api/client";

export interface Genre {
  id: string;
  label_zh: string;
  label_en: string;
  family: string;
  ui_visible?: boolean;
}

let cache: Genre[] | null = null;
let inflight: Promise<Genre[]> | null = null;

export function useGenres(uiVisibleOnly = true): Genre[] {
  const [genres, setGenres] = useState<Genre[]>(cache ?? []);
  useEffect(() => {
    if (cache) {
      setGenres(cache);
      return;
    }
    if (!inflight) {
      inflight = api.listGenres(uiVisibleOnly).then((data) => {
        cache = data;
        return data;
      });
    }
    inflight
      .then(setGenres)
      .catch(console.error)
      .finally(() => {
        inflight = null;
      });
  }, [uiVisibleOnly]);
  return genres;
}
```

- [ ] **Step 8.3: Run existing frontend tests to confirm no regression**

Run: `cd frontend && npx vitest run src/test/genres.test.ts src/test/BookShelf.test.tsx src/test/BookShelfModal.test.tsx`
Expected: All pass (the hook is new; nothing should break yet).

- [ ] **Step 8.4: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/hooks/useGenres.ts
git commit -m "feat(frontend): useGenres hook fetching from /api/v1/genres"
```

---

### Task 9: Convert CreateProjectCard to useGenres

**Files:**
- Modify: `frontend/src/components/home/CreateProjectCard.tsx`
- Modify: `frontend/src/test/CreateProjectCard.test.tsx` (create if doesn't exist)
- Modify: `frontend/src/test/genres.test.ts`

- [ ] **Step 9.1: Update `CreateProjectCard.tsx`**

Replace:
```typescript
import { GENRES } from "../../constants/genres";
```
with:
```typescript
import { useGenres } from "../../hooks/useGenres";
```

Inside the component, replace `GENRES.map(...)` with the hook:

```typescript
const genres = useGenres(true);
// ...
{genres.map((g) => (
  <option key={g.id} value={g.id}>{g.label_zh}</option>
))}
```

- [ ] **Step 9.2: Update or create `CreateProjectCard.test.tsx`**

If the file doesn't exist, create it with:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../hooks/useGenres", () => ({
  useGenres: () => [
    { id: "cool_novel", label_zh: "爽文", label_en: "Power Fantasy", family: "power_fantasy", ui_visible: true },
    { id: "xuanyi", label_zh: "悬疑", label_en: "Mystery", family: "mystery", ui_visible: true },
  ],
}));

import CreateProjectCard from "../../components/home/CreateProjectCard";

describe("CreateProjectCard", () => {
  it("renders genre options from useGenres hook", () => {
    render(<CreateProjectCard onSubmit={async () => {}} submitting={false} error={null} />);
    const select = screen.getByTestId("genre-input") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain("cool_novel");
    expect(options).toContain("xuanyi");
  });
});
```

If it exists, update existing mocks to use `useGenres`.

- [ ] **Step 9.3: Run CreateProjectCard tests**

Run: `cd frontend && npx vitest run src/test/CreateProjectCard.test.tsx -v`
Expected: pass.

- [ ] **Step 9.4: Commit**

```bash
git add frontend/src/components/home/CreateProjectCard.tsx frontend/src/test/CreateProjectCard.test.tsx
git commit -m "feat(frontend): CreateProjectCard uses useGenres()"
```

---

### Task 10: Convert BookShelf and BookShelfModal to useGenres

**Files:**
- Modify: `frontend/src/components/home/BookShelf.tsx`
- Modify: `frontend/src/components/home/BookShelfModal.tsx`
- Modify: `frontend/src/test/BookShelf.test.tsx`
- Modify: `frontend/src/test/BookShelfModal.test.tsx`

- [ ] **Step 10.1: Update `BookShelf.tsx`**

Replace:
```typescript
import { GENRE_LABELS } from "../../constants/genres";
```
with:
```typescript
import { useGenres } from "../../hooks/useGenres";
```

Inside the component, build a label map from the hook:

```typescript
const genres = useGenres(false); // include all so labels render for any project genre
const labelByGenre = Object.fromEntries(genres.map((g) => [g.id, g.label_zh]));
```

Replace `{GENRE_LABELS[project.genre] || project.genre}` with `{labelByGenre[project.genre] || project.genre}`.

- [ ] **Step 10.2: Apply the same change to `BookShelfModal.tsx`**

Same imports, same pattern.

- [ ] **Step 10.3: Update `BookShelf.test.tsx` and `BookShelfModal.test.tsx` mocks**

In each test file, add the mock at the top:

```typescript
vi.mock("../../hooks/useGenres", () => ({
  useGenres: () => [
    { id: "cool_novel", label_zh: "爽文", label_en: "Power Fantasy", family: "power_fantasy", ui_visible: true },
    { id: "xianxia", label_zh: "仙侠", label_en: "Xianxia", family: "cultivation", ui_visible: true },
    { id: "xuanyi", label_zh: "悬疑", label_en: "Mystery", family: "mystery", ui_visible: true },
  ],
}));
```

Add it near the existing `vi.mock("../api/client", ...)` calls.

- [ ] **Step 10.4: Run BookShelf + BookShelfModal tests**

Run: `cd frontend && npx vitest run src/test/BookShelf.test.tsx src/test/BookShelfModal.test.tsx -v`
Expected: All pass.

- [ ] **Step 10.5: Commit**

```bash
git add frontend/src/components/home/BookShelf.tsx frontend/src/components/home/BookShelfModal.tsx frontend/src/test/BookShelf.test.tsx frontend/src/test/BookShelfModal.test.tsx
git commit -m "feat(frontend): BookShelf + Modal use useGenres() for labels"
```

---

### Task 11: Mark `constants/genres.ts` deprecated

**Files:**
- Modify: `frontend/src/constants/genres.ts`

- [ ] **Step 11.1: Add DEPRECATED notice and keep stub exports**

```typescript
/**
 * @deprecated Hardcoded genre list is replaced by useGenres() hook (Phase 3 of
 * genre catalog unification). This file remains as a stub for one release so
 * any unported imports still resolve. Will be deleted in the next release.
 *
 * Use `import { useGenres } from "../hooks/useGenres"` instead.
 */

export interface GenreOption {
  value: string;
  label: string;
}

/** Empty stub — consumers must migrate to useGenres(). */
export const GENRES: ReadonlyArray<GenreOption> = Object.freeze([]);
export const GENRE_LABELS: Readonly<Record<string, string>> = Object.freeze({});
export const GENRE_TEMPLATE_KEYS: ReadonlyArray<string> = Object.freeze([]);
```

- [ ] **Step 11.2: Run frontend tests**

Run: `cd frontend && npx vitest run src/test/genres.test.ts src/test/BookShelf.test.tsx src/test/BookShelfModal.test.tsx src/test/CreateProjectCard.test.tsx -v`
Expected: The `genres.test.ts` test that expects `GENRE_TEMPLATE_KEYS` to cover backend templates **will fail** — update it next.

- [ ] **Step 11.3: Update `frontend/src/test/genres.test.ts`**

Replace the `GENRES constant` describe block with hook-based coverage:

```typescript
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { useGenres } from "../hooks/useGenres";

vi.mock("../api/client", () => ({
  default: {
    listGenres: vi.fn().mockResolvedValue([
      { id: "cool_novel", label_zh: "爽文", label_en: "Power Fantasy", family: "power_fantasy", ui_visible: true },
      { id: "xianxia", label_zh: "仙侠", label_en: "Xianxia", family: "cultivation", ui_visible: true },
      { id: "xuanhuan", label_zh: "玄幻", label_en: "Xuanhuan", family: "cultivation", ui_visible: true },
      { id: "dushi", label_zh: "都市", label_en: "Contemporary", family: "contemporary", ui_visible: true },
      { id: "kehuan", label_zh: "科幻", label_en: "Sci-Fi", family: "sci_fi", ui_visible: true },
      { id: "xuanyi", label_zh: "悬疑", label_en: "Mystery", family: "mystery", ui_visible: true },
      { id: "yanqing", label_zh: "言情", label_en: "Romance", family: "romance", ui_visible: true },
    ]),
  },
}));

const BACKEND_STYLE_DIR = path.resolve(__dirname, "../../../data/style");

function listBackendTemplates(): string[] {
  return fs
    .readdirSync(BACKEND_STYLE_DIR)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.replace(/\.yaml$/, ""))
    .sort();
}

describe("useGenres hook", () => {
  it("renders a list that includes every backend data/style template", () => {
    const genres = useGenres(true);
    const ids = genres.map((g) => g.id).sort();
    const backend = listBackendTemplates();
    // Backend templates that should be visible
    expect(ids.length).toBeGreaterThanOrEqual(backend.length);
    for (const t of backend) expect(ids).toContain(t);
  });

  it("includes the two previously missing genres (xuanyi, yanqing)", () => {
    const genres = useGenres(true);
    const ids = genres.map((g) => g.id);
    expect(ids).toContain("xuanyi");
    expect(ids).toContain("yanqing");
  });
});
```

- [ ] **Step 11.4: Run genres test**

Run: `cd frontend && npx vitest run src/test/genres.test.ts -v`
Expected: pass.

- [ ] **Step 11.5: Commit**

```bash
git add frontend/src/constants/genres.ts frontend/src/test/genres.test.ts
git commit -m "refactor(frontend): mark genres.ts deprecated; test useGenres()"
```

---

# Phase 4 — Migration & Cleanup

### Task 12: One-shot migration script

**Files:**
- Create: `scripts/migrate_genre_catalog.py`
- Create: `backend/genres/migrations.py`
- Create: `tests/test_migrate_genre_catalog.py`

- [ ] **Step 12.1: Write helper module `backend/genres/migrations.py`**

```python
"""Extract genre config from the legacy three-system layout.

Used by scripts/migrate_genre_catalog.py (one-shot) and tests/
test_migrate_genre_catalog.py. Read-only on the legacy files.
"""
from pathlib import Path
from typing import Any


def load_from_data_style(style_dir: Path) -> dict[str, dict[str, Any]]:
    """Read data/style/*.yaml and return {id: raw_dict}."""
    import yaml
    result: dict[str, dict[str, Any]] = {}
    for f in sorted(style_dir.glob("*.yaml")):
        gid = f.stem
        with open(f, encoding="utf-8") as fh:
            result[gid] = yaml.safe_load(fh) or {}
    return result


def load_from_thresholds(thresholds_path: Path) -> dict[str, dict[str, Any]]:
    """Read config/genre_thresholds.yaml and return {pinyin_id: thresholds_dict}.

    Uses GENRE_NAME_MAPPING from backend.reader_os.thresholds to translate
    Chinese keys → pinyin ids.
    """
    import yaml
    from backend.reader_os.thresholds import GENRE_NAME_MAPPING
    if not thresholds_path.exists():
        return {}
    raw = yaml.safe_load(thresholds_path.read_text(encoding="utf-8")) or {}
    result: dict[str, dict[str, Any]] = {}
    for zh_key, val in raw.items():
        pinyin = GENRE_NAME_MAPPING.get(zh_key, zh_key)
        result[pinyin] = val
    return result


def load_from_fusion_engine() -> tuple[dict[str, list[str]], dict[str, dict[str, float]]]:
    """Extract GENRE_GRAPH and COMPATIBILITY_MATRIX from genre_fusion_engine.py.

    Uses regex parsing (no import side effects).
    """
    import re
    from backend.creative_os import genre_fusion_engine as gfe
    src_path = Path(gfe.__file__)
    src = src_path.read_text(encoding="utf-8")
    # The legacy constants are top-level Python literals. ast.literal_eval is safer:
    import ast
    graph_match = re.search(r"^GENRE_GRAPH\s*=\s*(\{.*?\n\})", src, re.MULTILINE | re.DOTALL)
    compat_match = re.search(r"^COMPATIBILITY_MATRIX\s*=\s*(\{.*?\n\})", src, re.MULTILINE | re.DOTALL)
    graph = ast.literal_eval(graph_match.group(1)) if graph_match else {}
    compat = ast.literal_eval(compat_match.group(1)) if compat_match else {}
    families: dict[str, list[str]] = {}
    for genre, neighbors in graph.items():
        # Derive family from the first neighbor (legacy heuristic)
        # Authoritative family map is hand-curated in the catalog spec; this is best-effort.
        pass
    return families, compat


def write_catalog(target_dir: Path, *, force: bool = False) -> None:
    """Write the catalog files. Idempotent unless force=True.

    Caller has already constructed the catalog dicts; this just writes them.
    """
    raise NotImplementedError("write_catalog is implemented by the script")
```

- [ ] **Step 12.2: Write the failing integration test**

Create `tests/test_migrate_genre_catalog.py`:

```python
"""Integration test for the migration script."""
import shutil
import subprocess
from pathlib import Path

import pytest


def test_migrate_dry_run(tmp_path):
    """Dry-run should report what would be written without changing anything."""
    repo = tmp_path / "repo"
    repo.mkdir()
    # Copy minimum fixture: data/style/cool_novel.yaml, config/genre_thresholds.yaml,
    # backend/creative_os/genre_fusion_engine.py — see scripts/migrate_genre_catalog.py docstring.
    pytest.skip("Implementation: copy fixtures, then assert script --dry-run exits 0 "
                "and target dir is empty")


def test_migrate_apply_produces_valid_catalog(tmp_path):
    pytest.skip("Implementation: run script --apply, then instantiate GenreCatalog against "
                "output dir and assert .get('cool_novel') returns expected fields")
```

- [ ] **Step 12.3: Implement `scripts/migrate_genre_catalog.py`**

```python
#!/usr/bin/env python3
"""One-shot script: extract genre config from legacy three-system layout, write new catalog.

Usage:
    python scripts/migrate_genre_catalog.py --dry-run     # preview only
    python scripts/migrate_genre_catalog.py --apply       # write files
    python scripts/migrate_genre_catalog.py --target DIR  # custom output dir (default config/genres)

Idempotent: re-running with --apply does not overwrite existing files unless --force is set.
"""
import argparse
import sys
from pathlib import Path

import yaml

# Make backend importable when run from project root
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.genres.migrations import (
    load_from_data_style,
    load_from_thresholds,
    load_from_fusion_engine,
)


REPO_ROOT = Path(__file__).parent.parent

# Hand-curated labels + families for the 10 fusion-only genres that have no
# data/style/*.yaml entry. These are surfaced in the catalog as `ui_visible: false`
# until full pacing/tone/writing_formula/thresholds are authored.
FUSION_ONLY_META: dict[str, dict[str, str]] = {
    "wuxia":     {"label_zh": "武侠", "label_en": "Wuxia",            "family": "cultivation"},
    "kongbu":    {"label_zh": "恐怖", "label_en": "Horror",           "family": "mystery"},
    "moshi":     {"label_zh": "末世", "label_en": "Post-Apocalyptic", "family": "sci_fi"},
    "lishi":     {"label_zh": "历史", "label_en": "Historical",       "family": "contemporary"},
    "shenhua":   {"label_zh": "神话", "label_en": "Mythology",        "family": "cultivation"},
    "youxi":     {"label_zh": "游戏", "label_en": "Game Lit",         "family": "sci_fi"},
    "tuili":     {"label_zh": "推理", "label_en": "Detective",        "family": "mystery"},
    "yijie":     {"label_zh": "异界", "label_en": "Isekai",           "family": "cultivation"},
    "zhanzheng": {"label_zh": "战争", "label_en": "War",              "family": "contemporary"},
    "qihuan":    {"label_zh": "奇幻", "label_en": "Western Fantasy",  "family": "cultivation"},
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", default=str(REPO_ROOT / "config" / "genres"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    if not (args.dry_run or args.apply):
        parser.error("Specify --dry-run or --apply")

    target = Path(args.target)
    style_data = load_from_data_style(REPO_ROOT / "data" / "style")
    thresholds = load_from_thresholds(REPO_ROOT / "config" / "genre_thresholds.yaml")
    families, compat = load_from_fusion_engine()

    # Merge per-genre
    merged: dict[str, dict] = {}
    for gid, raw in style_data.items():
        merged[gid] = {
            **raw,
            "label_zh": raw.get("label_zh") or raw.get("name", gid),
            "label_en": raw.get("label_en", gid),
            "family": raw.get("family", "default"),
            "thresholds": thresholds.get(gid, {}),
            "fusion_meta": {"distances": {
                other: round(1.0 - compat.get(gid, {}).get(other, 0.5), 2)
                for other in compat.keys()
            }},
        }

    # 10 fusion-only genres that have no data/style entry
    fusion_only = set(compat.keys()) - set(merged.keys())
    for gid in fusion_only:
        meta = FUSION_ONLY_META.get(gid, {"label_zh": gid, "label_en": gid, "family": "default"})
        merged[gid] = {
            "id": gid,
            "label_zh": meta["label_zh"],
            "label_en": meta["label_en"],
            "family": meta["family"],
            "pacing": {},
            "tone": "",
            "style_rules": [],
            "writing_formula": {},
            "taboo_words": [],
            "taboos": [],
            "trope_patterns": [],
            "thresholds": {},
            "model_preferences": {},
            "fusion_meta": {"distances": {
                other: round(1.0 - compat.get(gid, {}).get(other, 0.5), 2)
                for other in compat.keys()
            }},
            "_stub": True,
        }

    print(f"Would write {len(merged)} per-genre files to {target}")
    print(f"  Per-genre from data/style: {sorted(style_data.keys())}")
    print(f"  Stub-only (need authoring): {sorted(fusion_only)}")

    if args.dry_run:
        return 0

    target.mkdir(parents=True, exist_ok=True)
    for gid, data in merged.items():
        path = target / f"{gid}.yaml"
        if path.exists() and not args.force:
            print(f"  skip (exists): {path}")
            continue
        path.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")
        print(f"  wrote: {path}")

    # Write index.yaml
    index_path = target / "index.yaml"
    if not index_path.exists() or args.force:
        index_path.write_text(yaml.safe_dump({
            "genres": [
                {"id": gid, "label_zh": d.get("label_zh", gid), "label_en": d.get("label_en", gid),
                 "family": d.get("family", "default"),
                 **({"ui_visible": False} if d.get("_stub") else {})}
                for gid, d in sorted(merged.items(), key=lambda x: (
                    x[1].get("_stub", False),  # non-stub first
                    x[0]
                ))
            ]
        }, allow_unicode=True, sort_keys=False), encoding="utf-8")
        print(f"  wrote: {index_path}")

    print("\nDone. Next steps:")
    print("  1. Hand-author pacing/tone/writing_formula/thresholds for stub genres")
    print("  2. Add # DEPRECATED banners to old files (Task 13)")
    print("  3. Run pytest to confirm catalog loads cleanly")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 12.4: Run dry-run against current repo**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && python scripts/migrate_genre_catalog.py --dry-run --target /tmp/preview-genres`
Expected: Reports the genres it would write, exits 0.

- [ ] **Step 12.5: Run apply to a temporary target**

Run: `python scripts/migrate_genre_catalog.py --apply --target /tmp/migrated-genres`
Expected: Writes files; logs list.

- [ ] **Step 12.6: Verify generated catalog loads**

```bash
source venv/bin/activate && python -c "
import sys; sys.path.insert(0, '/Users/longsa/Codes/storyForge2')
from backend.genres.catalog import GenreCatalog
cat = GenreCatalog(genres_dir='/tmp/migrated-genres')
cat._load()
print('OK, loaded:', sorted(cat._entries.keys())[:5], '...')
"
```

Expected: prints first 5 ids, no exception.

- [ ] **Step 12.7: Replace integration test stubs with real-repo-based tests**

Replace `tests/test_migrate_genre_catalog.py` with:

```python
"""Integration test for the migration script (runs against the real repo)."""
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).parent.parent
SCRIPT = REPO_ROOT / "scripts" / "migrate_genre_catalog.py"


def test_dry_run_exits_zero_without_writing(tmp_path):
    """Dry-run reports what would be written; target dir stays empty."""
    target = tmp_path / "preview-genres"
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--target", str(target), "--dry-run"],
        cwd=str(REPO_ROOT),
        capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, f"stderr: {result.stderr}"
    assert not target.exists() or list(target.iterdir()) == []


def test_apply_produces_loading_catalog(tmp_path):
    """Apply to a fresh target dir; GenreCatalog loads the result cleanly."""
    target = tmp_path / "migrated-genres"
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--target", str(target), "--apply", "--force"],
        cwd=str(REPO_ROOT),
        capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, f"stderr: {result.stderr}"
    assert (target / "index.yaml").exists()

    # Load the generated catalog
    sys.path.insert(0, str(REPO_ROOT))
    from backend.genres.catalog import GenreCatalog
    cat = GenreCatalog(genres_dir=target)
    cat._load()  # must not raise
    # At least the 7 well-known ids should be present
    for gid in ["cool_novel", "xianxia", "xuanyi", "yanqing"]:
        assert gid in cat._entries, f"missing {gid} in migrated catalog"


def test_apply_is_idempotent(tmp_path):
    """Running --apply twice with same target produces no errors."""
    target = tmp_path / "migrated-genres"
    for _ in range(2):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--target", str(target), "--apply", "--force"],
            cwd=str(REPO_ROOT),
            capture_output=True, text=True, timeout=60,
        )
        assert result.returncode == 0, f"stderr: {result.stderr}"
```

- [ ] **Step 12.8: Commit**

```bash
git add scripts/migrate_genre_catalog.py backend/genres/migrations.py
git commit -m "feat(scripts): one-shot migration from legacy three-system layout"
```

---

### Task 13: Project genre validator (part of migration)

**Files:**
- Create: `scripts/validate_project_genres.py`
- Modify: `scripts/migrate_genre_catalog.py` (call validator as final step)

- [ ] **Step 13.1: Implement the validator**

Create `scripts/validate_project_genres.py`:

```python
#!/usr/bin/env python3
"""Scan projects/*/project.json and report any genre not in the new catalog.

Exits 0 if all project genres are valid; exits 1 with a list of unknown ids otherwise.
"""
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
PROJECTS_DIR = REPO_ROOT / "projects"


def main() -> int:
    sys.path.insert(0, str(REPO_ROOT))
    from backend.genres.catalog import get_catalog
    valid_ids = {e["id"] for e in get_catalog().list(ui_visible_only=False)}

    unknown: list[tuple[str, str]] = []
    if not PROJECTS_DIR.exists():
        print(f"No projects directory at {PROJECTS_DIR}; nothing to validate.")
        return 0

    for proj_dir in sorted(PROJECTS_DIR.iterdir()):
        if not proj_dir.is_dir():
            continue
        project_json = proj_dir / "project.json"
        if not project_json.exists():
            continue
        try:
            data = json.loads(project_json.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            print(f"WARN: {project_json} is not valid JSON: {e}")
            continue
        genre = data.get("genre")
        if genre and genre not in valid_ids:
            unknown.append((proj_dir.name, genre))

    if unknown:
        print(f"FAIL: {len(unknown)} projects have genres not in catalog:")
        for pid, genre in unknown:
            print(f"  {pid}: genre='{genre}'")
        return 1
    print("OK: all project genres are in catalog.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 13.2: Run the validator**

Run: `source venv/bin/activate && python scripts/validate_project_genres.py`
Expected: "OK: all project genres are in catalog." (since project genres are already pinyin keys that exist in the catalog).

- [ ] **Step 13.3: Commit**

```bash
git add scripts/validate_project_genres.py
git commit -m "feat(scripts): validate all project genres against catalog"
```

---

### Task 14: Deprecation banners on old files

**Files:**
- Modify: `data/style/cool_novel.yaml`
- Modify: `data/style/xianxia.yaml`
- Modify: `data/style/xuanhuan.yaml`
- Modify: `data/style/dushi.yaml`
- Modify: `data/style/kehuan.yaml`
- Modify: `data/style/xuanyi.yaml`
- Modify: `data/style/yanqing.yaml`
- Modify: `config/genre_thresholds.yaml`

- [ ] **Step 14.1: Prepend deprecation banner to each `data/style/*.yaml`**

For each of the 7 files, prepend:

```yaml
# DEPRECATED: This file will be removed in the next release.
# Genre config now lives in config/genres/<id>.yaml — see backend/genres/catalog.py.
# Do not edit this file; changes will be ignored after catalog takes over.
---
```

Preserve the rest of the file content verbatim.

- [ ] **Step 14.2: Prepend deprecation banner to `config/genre_thresholds.yaml`**

```yaml
# DEPRECATED: This file will be removed in the next release.
# ReaderOS thresholds now live in config/genres/<id>.yaml under the `thresholds:` key.
# Do not edit this file; changes will be ignored after catalog takes over.
---
```

- [ ] **Step 14.3: Verify no regression**

Run: `source venv/bin/activate && pytest tests/test_genre_template.py tests/test_reader_os.py tests/test_genre_catalog.py -v`
Expected: All pass. (The deprecation banners are comments; the legacy fallback path in thresholds.py still reads the file when catalog fails.)

- [ ] **Step 14.4: Commit**

```bash
git add data/style/ config/genre_thresholds.yaml
git commit -m "chore: deprecation banners on legacy genre files"
```

---

### Task 15: Final verification — full test sweep

**Files:** none

- [ ] **Step 15.1: Backend test sweep**

Run: `source venv/bin/activate && pytest tests/ -v --timeout=60 2>&1 | tail -20`
Expected: 0 failures (except any pre-existing failures unrelated to this work; e.g., the EventSource-related Workspace.test.tsx failures noted in CLAUDE.md memory).

- [ ] **Step 15.2: Frontend test sweep**

Run: `cd frontend && npx vitest run --no-coverage 2>&1 | tail -10`
Expected: 0 failures from changed files; the unrelated Workspace.test.tsx EventSource failures are pre-existing.

- [ ] **Step 15.3: Live smoke test**

Start backend and frontend, create a project with `genre: "xuanyi"`, write one chapter, and verify in the response that:
- `GET /api/v1/genres` returns 7 entries
- `xuanyi` is in the list with `label_zh: "悬疑"`
- The chapter review's `writing_formula_compliance` uses xuanyi's thresholds (avg_length_max=28), not cool_novel's (avg_length_max=30)

If anything fails, debug before declaring done.

- [ ] **Step 15.4: Final commit (if any cleanup needed)**

If any cleanup was needed from Step 15.3:

```bash
git add -u
git commit -m "chore: post-verification cleanup"
```

---

# Notes for Future Release (NOT this plan)

These are out of scope for this plan but should happen in the **next release** (after the one-release dual-read window):

1. Delete `data/style/` directory (7 files).
2. Delete `config/genre_thresholds.yaml`.
3. Delete `backend/creative_os/genre_fusion_engine.py:_LEGACY_GENRE_GRAPH`, `_LEGACY_COMPATIBILITY_MATRIX`.
4. Delete `frontend/src/constants/genres.ts` (stub).
5. Remove the `_legacy_*` fallback paths in `backend/reader_os/thresholds.py` and `backend/creative_os/genre_fusion_engine.py`.
6. Remove the `{genre}` placeholder fallback in prompt renderer.

Open a separate spec/plan for that release.