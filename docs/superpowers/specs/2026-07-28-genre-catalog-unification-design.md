# Genre Catalog Unification — Design Spec

> **For agentic workers:** This is the design spec. Use `superpowers:writing-plans` to produce the implementation plan from this spec.

**Goal:** Unify the three separate genre systems (`data/style/*.yaml`, `config/genre_thresholds.yaml`, `backend/creative_os/genre_fusion_engine.py`) into a single canonical catalog, so that adding a new genre is a single-file change, every project's `genre` field drives consistent behavior across Style Engine / ReaderOS / Fusion Engine / frontend UI, and the frontend exposes every supported genre.

## Background

The project currently has three overlapping genre systems that evolved independently:

| System | Coverage | Naming | Owns |
|---|---|---|---|
| `data/style/<id>.yaml` | 7 (cool_novel/xianxia/xuanhuan/dushi/kehuan/xuanyi/yanqing) | pinyin key | Style Engine: pacing, tone, style_formula, taboos, trope_patterns, model_preferences |
| `config/genre_thresholds.yaml` | 5 (爽文/严肃文学/悬疑推理/科幻/奇幻) | Chinese key | ReaderOS: 14 thresholds per genre (addiction/frustration/fatigue/etc.) |
| `backend/creative_os/genre_fusion_engine.py` | 17 (GENRE_GRAPH nodes) | Chinese name | Fusion Engine: pairwise compatibility matrix, family grouping, BFS distance |

Three concrete problems motivate this work:

1. **User discoverability gap** — Frontend `CreateProjectCard` exposes only 5 of the 7 backend templates (`xuanyi` and `yanqing` are missing from the dropdown but exist in `data/style/`). `StyleSandbox` and direct API calls can use all 7, but the primary creation path cannot.
2. **Cross-system inconsistency** — `backend/conductor/chapter_review.py:_check_writing_formula` (and its async twin) called `GenreTemplate().get_style_formula()` without passing the project genre, so every project silently got cool_novel's `avg_length_max=30` regardless of its actual genre. Just fixed in commit accompanying this spec.
3. **Maintenance burden** — Adding a new genre today requires: editing one of seven `data/style/*.yaml`, possibly editing `genre_thresholds.yaml`, almost certainly editing `genre_fusion_engine.py`'s `GENRE_GRAPH` and `COMPATIBILITY_MATRIX`, plus updating three hardcoded `GENRES` constants in the frontend (`CreateProjectCard.tsx`, `BookShelf.tsx`, `BookShelfModal.tsx`). Six+ locations, easy to miss one.

Three frontend GENRES constants were already collapsed into `frontend/src/constants/genres.ts` in the commit accompanying this spec, but the deeper three-system divergence remains.

---

## Design Decisions (from brainstorming 2026-07-28)

| Decision | Choice | Rationale |
|---|---|---|
| Single source of truth | `config/genres/` directory | Already used for other system configs (`genre_thresholds.yaml`, `trope_catalog.yaml`); not bundling style content with system config is preferable, so `data/` stays for content (style resources) |
| File layout | Per-genre file + central index | User chose B over single big YAML; per-genre files keep diffs small and parallel authoring easy |
| Canonical naming | pinyin key (`cool_novel`, `xuanyi`, …) | URLs/JSON-friendly; Chinese labels carried as `label_zh`; `label_en` for future i18n |
| Coverage | Union of 17 (data/style 7 + fusion-only 10) | Don't drop the fusion-only genres; UI shows `ui_visible: true` only for genres with full config |
| Label strategy | `label_zh` (Chinese) + `label_en` (English) | User wanted multi-language from the start; cheap to add both upfront |
| Project migration | One-shot script, no project JSON rewrite | Existing project `genre` values are already pinyin (`cool_novel`, …); they match the new catalog verbatim — no per-project rewrite needed |
| Old file fate | Deprecate for one release, then delete | Reduces blast radius; fallback to hardcoded `genre_fusion_engine.py` constants if new catalog fails to load during transition |
| Frontend source of truth | New `GET /api/v1/genres` endpoint, not a TypeScript constant | One place to add a genre; frontend just renders what the backend returns |

---

## Architecture

```
config/genres/                          # NEW: single source of truth
  ├── index.yaml                        # Genre list (id + labels + family + ui_visible)
  ├── cool_novel.yaml                   # Per-genre full config
  ├── xianxia.yaml
  ├── ... (17 files)
  ├── compatibility.yaml                # Pairwise compatibility matrix (symmetric)
  └── families.yaml                     # Genre family groups

backend/genres/                         # NEW: catalog loader
  ├── __init__.py
  ├── catalog.py                        # GenreCatalog singleton loader + getters
  └── migrations.py                     # Helper utilities for one-shot migration

backend/api/
  └── genres.py                         # NEW: GET /api/v1/genres

scripts/
  └── migrate_genre_catalog.py          # NEW: one-shot migration script

# Existing files - modified
backend/style_engine/genre_template.py  # Delegate to GenreCatalog
backend/reader_os/thresholds.py         # Delegate to GenreCatalog
backend/creative_os/genre_fusion_engine.py  # Remove hardcoded GENRE_GRAPH; read from catalog
backend/prompts/                        # {genre} placeholder renders catalog.label_zh
backend/api/stage4_writing.py           # Already calls GenreTemplate; no change after genre_template rewrite
backend/conductor/chapter_review.py     # Already uses genre_template; no change

# Existing files - deprecated (deleted next release)
data/style/cool_novel.yaml              # Marked DEPRECATED
... (7 files)
config/genre_thresholds.yaml            # Marked DEPRECATED

# Existing files - hardcoded constants removed
backend/creative_os/genre_fusion_engine.py  # GENRE_GRAPH and COMPATIBILITY_MATRIX deleted (replaced by catalog reads)

# Frontend
frontend/src/constants/genres.ts        # Stub: re-exports from useGenres() hook
frontend/src/hooks/useGenres.ts         # NEW: fetches /api/v1/genres, caches
frontend/src/components/home/CreateProjectCard.tsx  # Use useGenres()
frontend/src/components/home/BookShelf.tsx           # Use useGenres()
frontend/src/components/home/BookShelfModal.tsx      # Use useGenres()
```

### Data flow

```
config/genres/index.yaml ─┐
config/genres/<id>.yaml ──┼─→ GenreCatalog (singleton, lazy) ─┬─→ Style Engine
config/genres/compatibility.yaml ┘                           ├─→ ReaderOS
                                                            ├─→ Fusion Engine
                                                            ├─→ {genre} placeholder in prompts
                                                            └─→ GET /api/v1/genres ─→ Frontend
```

---

## File Schemas

### `config/genres/index.yaml`

```yaml
# Ordered list. UI dropdown order matches this list (filtered by ui_visible: true).
# Each entry MUST have a matching config/genres/<id>.yaml file.

genres:
  - { id: cool_novel, label_zh: 爽文, label_en: Power Fantasy,   family: power_fantasy }
  - { id: xianxia,    label_zh: 仙侠, label_en: Xianxia,          family: cultivation   }
  - { id: xuanhuan,   label_zh: 玄幻, label_en: Xuanhuan,         family: cultivation   }
  - { id: dushi,      label_zh: 都市, label_en: Contemporary,     family: contemporary  }
  - { id: kehuan,     label_zh: 科幻, label_en: Sci-Fi,           family: sci_fi        }
  - { id: xuanyi,     label_zh: 悬疑, label_en: Mystery,          family: mystery       }
  - { id: yanqing,    label_zh: 言情, label_en: Romance,          family: romance       }
  - { id: wuxia,      label_zh: 武侠, label_en: Wuxia,            family: cultivation,  ui_visible: false }
  - { id: kongbu,     label_zh: 恐怖, label_en: Horror,           family: mystery,      ui_visible: false }
  - { id: moshi,      label_zh: 末世, label_en: Post-Apocalyptic, family: sci_fi,       ui_visible: false }
  - { id: lishi,      label_zh: 历史, label_en: Historical,        family: contemporary, ui_visible: false }
  - { id: shenhua,    label_zh: 神话, label_en: Mythology,        family: cultivation,  ui_visible: false }
  - { id: youxi,      label_zh: 游戏, label_en: Game Lit,         family: sci_fi,       ui_visible: false }
  - { id: tuili,      label_zh: 推理, label_en: Detective,        family: mystery,      ui_visible: false }
  - { id: yijie,      label_zh: 异界, label_en: Isekai,           family: cultivation,  ui_visible: false }
  - { id: zhanzheng,  label_zh: 战争, label_en: War,              family: contemporary, ui_visible: false }
  - { id: qihuan,     label_zh: 奇幻, label_en: Western Fantasy,  family: cultivation,  ui_visible: false }
```

### `config/genres/<id>.yaml`

Required keys (loader fails fast if missing):

```yaml
# Identity (must match index entry)
id: xuanyi                   # pinyin, unique
label_zh: 悬疑               # Chinese display name
label_en: Mystery            # English display name
family: mystery              # must match one in families.yaml

# Style Engine: pacing
pacing:
  min_beats_per_1k: 1.0
  escalation_interval: 3
  action_ratio: 0.25
  max_consecutive_non_action: 4
  chapter_words: { min: 2500, max: 5000 }
  scene_words:   { min: 400,  max: 1800 }

# Style Engine: tone + style rules
tone: |
  紧张压抑，疑云密布……
style_rules:
  - "线索铺设有层次"
  - "反转前留伏笔"

# Style Engine: writing formula (merged from writing_formula + style_formula)
writing_formula:
  sentence:  { avg_length_max: 28, short_pct_min: 35, long_pct_max: 22 }
  dialogue:  { ratio_min: 0.18, max_consecutive_lines: 8 }
  paragraph: { max_sentences: 4, max_words: 250 }
  emotional_beat_density_min: 0.3
  satisfaction_beat_min: 1
  suspense_hook_required: true

# Style Engine: taboo words + structured taboos
taboo_words:
  - "显而易见"
  - "随便猜"
taboos:
  - name: 过早揭露凶手
    type: consecutive_match
    keywords: ["凶手是"]
    max_consecutive: 1
    severity: high

# Style Engine: trope patterns
trope_patterns:
  - { name: 线索, description: "...", min_interval: 2, max_per_volume: 30 }

# ReaderOS: thresholds (15 numeric + 1 nested formula — mirrors current genre_thresholds.yaml)
thresholds:
  addiction_critical:     50
  addiction_moderate:     35
  frustration_high:       60
  frustration_moderate:   45
  fatigue_moderate:       55
  fatigue_low:            40
  fatigue_formula:        { threshold: 60, decay: 1.0 }
  curiosity_moderate:     35
  curiosity_low:          20
  tension_moderate:       55
  tension_low:            40
  satisfaction_moderate:  60
  satisfaction_low:       45
  discussion_high:        50
  discussion_moderate:    35

# Model preferences
model_preferences:
  creative_core: claude-opus-4-7   # tier 1 model for scene writing
  temperature:    0.7

# Fusion Engine: distances to other 16 genres (0 = identical, 1 = unrelated)
# Loader requires ALL 16 other ids present; missing one fails fast.
fusion_meta:
  distances:
    cool_novel: 0.85
    xianxia:    0.85
    xuanhuan:   0.80
    dushi:      0.70
    kehuan:     0.50
    yanqing:    0.75
    wuxia:      0.80
    kongbu:     0.20
    moshi:      0.55
    lishi:      0.70
    shenhua:    0.75
    youxi:      0.60
    tuili:      0.15
    yijie:      0.75
    zhanzheng:  0.70
    qihuan:     0.70
```

### `config/genres/families.yaml`

```yaml
# Family-to-genres map. Used by Fusion Engine for BFS seeding.
families:
  cultivation:    [xianxia, xuanhuan, wuxia, shenhua, yijie, qihuan]
  mystery:        [xuanyi, tuili, kongbu]
  sci_fi:         [kehuan, moshi, youxi]
  contemporary:   [dushi, lishi, zhanzheng]
  power_fantasy:  [cool_novel]
  romance:        [yanqing]
```

### `config/genres/compatibility.yaml`

```yaml
# Pairwise genre compatibility, symmetric (loader verifies |a→b - b→a| < 0.01).
# Used by Fusion Engine for cross-genre mutation suggestions.
matrix:
  cool_novel:
    xianxia:    0.70
    xuanhuan:   0.70
    dushi:      0.40
    kehuan:     0.45
    xuanyi:     0.30
    yanqing:    0.20
    wuxia:      0.75
    kongbu:     0.20
    moshi:      0.50
    lishi:      0.25
    shenhua:    0.60
    youxi:      0.65
    tuili:      0.30
    yijie:      0.65
    zhanzheng:  0.35
    qihuan:     0.65
  # ... (17 entries total, each with all 16 others)
```

---

## Backend

### `backend/genres/catalog.py`

Singleton loader with lazy init:

```python
class GenreCatalog:
    def __init__(self, genres_dir: Path | None = None):
        self._dir = Path(genres_dir) if genres_dir else settings.genres_dir
        self._entries: dict[str, dict] | None = None
        self._index: list[dict] | None = None
        self._compatibility: dict | None = None
        self._families: dict | None = None

    def _load(self) -> None:
        """Lazy-load all YAML files. Validates required fields and invariants."""
        # 1. Load index.yaml; verify every id has a matching <id>.yaml
        # 2. Load each <id>.yaml; verify required fields
        # 3. Verify fusion_meta.distances covers all other 16 ids
        # 4. Load compatibility.yaml; verify matrix symmetry
        # 5. Load families.yaml; verify every family in index entry exists
        # Raises CatalogLoadError with specific file/id on any failure

    # Public API
    def get(self, genre_id: str) -> dict: ...
    def list(self, ui_visible_only: bool = False) -> list[dict]: ...
    def get_thresholds(self, genre_id: str) -> dict: ...
    def get_pacing(self, genre_id: str) -> dict: ...
    def get_formula(self, genre_id: str) -> dict: ...
    def get_taboos(self, genre_id: str) -> list[dict]: ...
    def get_tone_rules(self, genre_id: str) -> dict: ...
    def get_compatibility(self, a: str, b: str) -> float: ...
    def get_family(self, genre_id: str) -> str: ...

# Module-level singleton
_catalog: GenreCatalog | None = None
def get_catalog() -> GenreCatalog:
    global _catalog
    if _catalog is None:
        _catalog = GenreCatalog()
        _catalog._load()
    return _catalog
```

### `backend/genres/migrations.py`

Helper for the one-shot script. Reads old files, writes new format:

```python
def load_from_old_data_style() -> dict[str, dict]:
    """Read data/style/*.yaml; return {id: merged_fields}."""

def load_from_old_thresholds() -> dict[str, dict]:
    """Read config/genre_thresholds.yaml; return {id: thresholds_dict}."""

def load_from_old_fusion_graph() -> tuple[dict[str, list], dict]:
    """Read GENRE_GRAPH and COMPATIBILITY_MATRIX from genre_fusion_engine.py;
    return (families, compatibility_matrix)."""

def write_catalog(target_dir: Path) -> None:
    """Idempotent: writes <id>.yaml, index.yaml, families.yaml, compatibility.yaml.
    Skips files that already exist with identical content (idempotent guard)."""
```

### Modified: `backend/style_engine/genre_template.py`

Becomes a thin wrapper around `GenreCatalog`. Preserves the existing method signatures so call sites don't need to change.

```python
from backend.genres.catalog import get_catalog

class GenreTemplate:
    def __init__(self, style_dir: Path | None = None):
        # style_dir argument kept for back-compat; ignored if catalog is available
        pass

    def load(self, template_name: str = "cool_novel") -> dict:
        return get_catalog().get(template_name)

    def get_pacing(self, template_name: str = "cool_novel") -> dict:
        return get_catalog().get_pacing(template_name)
    # ... rest of methods delegate the same way
```

### Modified: `backend/reader_os/thresholds.py`

`load_genre_thresholds()` now reads from `GenreCatalog.get_thresholds(genre)` first, falling back to the legacy `genre_thresholds.yaml` if catalog load fails (one-release transition).

### Modified: `backend/creative_os/genre_fusion_engine.py`

Remove `GENRE_GRAPH` and `COMPATIBILITY_MATRIX` constants. Methods now read from `GenreCatalog`:

```python
def get_neighbors(genre: str, threshold: float = 0.5) -> list[tuple[str, float]]:
    catalog = get_catalog()
    return [
        (other, catalog.get_compatibility(genre, other))
        for other in catalog.list()
        if other != genre and catalog.get_compatibility(genre, other) >= threshold
    ]
```

Hardcoded constants stay as `_LEGACY_GENRE_GRAPH` and `_LEGACY_COMPATIBILITY_MATRIX`, used only when `GenreCatalog._load()` raises (one-release fallback).

### New: `backend/api/genres.py`

```python
@router.get("/api/v1/genres")
async def list_genres(ui_visible_only: bool = True) -> list[dict]:
    """Return [{id, label_zh, label_en, family, ui_visible}, ...].

    Default `ui_visible_only=True` because the primary caller is the UI dropdown.
    Admin / internal callers can pass `?ui_visible_only=false` to get the full 17.
    """
    return get_catalog().list(ui_visible_only=ui_visible_only)
```

---

## Frontend

### New: `frontend/src/hooks/useGenres.ts`

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
    inflight.then(setGenres).catch(console.error).finally(() => { inflight = null; });
  }, [uiVisibleOnly]);
  return genres;
}
```

### Modified: `frontend/src/constants/genres.ts`

Becomes a thin re-export wrapper to keep existing imports working during transition. Marked DEPRECATED in JSDoc; consumers migrate to `useGenres()` in the next refactor pass.

### Modified: `CreateProjectCard.tsx`, `BookShelf.tsx`, `BookShelfModal.tsx`

Replace hardcoded `GENRES` / `GENRE_LABELS` usage with `useGenres()`. Renders `label_zh` in the dropdown and labels.

### New: `frontend/src/api/client.ts: listGenres()`

```typescript
listGenres(uiVisibleOnly = true): Promise<Genre[]> {
  return fetch(`/api/v1/genres?ui_visible_only=${uiVisibleOnly}`).then(r => r.json());
}
```

---

## Migration

### One-shot script: `scripts/migrate_genre_catalog.py`

Idempotent. Run on a fresh checkout (no projects affected) or against an existing checkout (no project JSON changes needed since pinyin keys match).

```bash
source venv/bin/activate
python scripts/migrate_genre_catalog.py --target config/genres --dry-run   # preview
python scripts/migrate_genre_catalog.py --target config/genres             # apply
```

Steps:
1. Read all 7 `data/style/*.yaml` → emit per-genre `<id>.yaml` with merged fields
2. Read `config/genre_thresholds.yaml` → merge into each per-genre file's `thresholds:` section
3. Read `genre_fusion_engine.GENRE_GRAPH` → emit `families.yaml` + each per-genre file's `fusion_meta.distances` (cloned from neighbors)
4. Read `genre_fusion_engine.COMPATIBILITY_MATRIX` → emit `compatibility.yaml`
5. Emit `index.yaml` from the union of all ids seen
6. Verify by instantiating `GenreCatalog()` and calling `_load()` — must not raise
7. Append `# DEPRECATED: see config/genres/<id>.yaml` to each old file
8. Verify: scan `projects/*/project.json`, confirm every `genre` value is in the new index — fail with a list of unknown ids if not

### Project migration

Existing projects store `genre: "cool_novel"` etc. — pinyin keys that match the new catalog verbatim. **No project JSON rewrite needed.**

Verification script (part of `migrate_genre_catalog.py` step 8) catches any project with a `genre` not in the new index (e.g., legacy test fixtures from earlier phases).

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Catalog load fails (file missing / YAML syntax error) | Startup fails fast; log lists specific file/id |
| Project's `genre` not in catalog | `GenreCatalog.get(unknown)` returns a `cool_novel` fallback dict and logs WARN; UI's `useGenres` doesn't list it (no rendering for unknown ids) |
| LLM writes a genre not in catalog (Stage 1) | Stage 1 normalization falls back to `cool_novel` and logs WARN |
| `fusion_meta.distances` missing an id | Catalog load fails fast — author must complete the matrix |
| `compatibility.yaml` matrix not symmetric | Catalog load fails fast — author must fix |
| Frontend fetches old catalog schema | API contract additive — new fields OK, old fields preserved |
| Old fallback needed (one release) | `genre_fusion_engine._LEGACY_*` constants used when `GenreCatalog._load()` raises `CatalogLoadError` |

---

## Testing Strategy

### Unit

- `tests/test_genre_catalog.py` — loader validation (missing file, bad field, asymmetric matrix, missing distance), getters, list filter
- `tests/test_genre_migrations.py` — `load_from_old_*()` functions produce correct structures

### Regression (existing tests must keep passing)

- `tests/test_style_engine/` — `test_genre_template.py`, `test_writing_formulas.py`, `test_taboo_constraints.py` — exercise full genre lookup paths via catalog
- `tests/test_reader_os.py` — thresholds return same values as before for the 5 currently-tested genres
- `tests/test_creative_os/test_genre_fusion_engine.py` — fusion results unchanged after switching to catalog read
- `tests/test_chapter_review.py` (just fixed) — regression test still passes
- `tests/test_prompts.py` — `{genre}` placeholder renders catalog label

### Contract

- `tests/test_genres_api.py` — `GET /api/v1/genres` returns 17 entries (or 7 with `ui_visible_only=true`); correct schema; CORS OK

### Integration

- `tests/test_migrate_genre_catalog.py` — given a fixture with the three old files, the migration script produces the expected 17 per-genre files + index + compatibility + families, and `GenreCatalog._load()` succeeds on the result

### Frontend

- `frontend/src/test/genres.test.ts` (just added) — extends to also fetch from `/api/v1/genres` mock and verify hook
- `BookShelf.test.tsx`, `BookShelfModal.test.tsx`, `CreateProjectCard.test.tsx` — update mocks for `useGenres`; assert rendered labels come from the API response

---

## Implementation Decomposition

Independent, each is mergeable on its own:

**Phase 0 — Skeleton**
- 0.1 Create empty `config/genres/` and `backend/genres/` skeleton with stub `GenreCatalog.list()` returning `[]`
- 0.2 Add `config/genres/<id>.yaml` for the existing 7 ids (verbatim copy from `data/style/` plus thresholds + fusion_meta stub)

**Phase 1 — Catalog core**
- 1.1 Implement `GenreCatalog._load()` with full validation (index, per-genre fields, distances, matrix symmetry, families)
- 1.2 Implement all getter methods
- 1.3 Hand-author `index.yaml`, `compatibility.yaml`, `families.yaml`, AND the 10 fusion-only per-genre YAML files (`wuxia`/`kongbu`/`moshi`/`lishi`/`shenhua`/`youxi`/`tuili`/`yijie`/`zhanzheng`/`qihuan`) — each with full `pacing/tone/writing_formula/thresholds/fusion_meta` derived from the closest family-mate; all marked `ui_visible: false`

**Phase 2 — Downstream switch** (one system per change)
- 2.1 `backend/style_engine/genre_template.py` delegates to `GenreCatalog`
- 2.2 `backend/reader_os/thresholds.py` reads from `GenreCatalog` with one-release legacy fallback
- 2.3 `backend/creative_os/genre_fusion_engine.py` removes hardcoded constants, reads from `GenreCatalog` with one-release legacy fallback
- 2.4 `{genre}` placeholder in `backend/prompts/` resolves to `catalog.label_zh`
- 2.5 New `backend/api/genres.py` endpoint `GET /api/v1/genres`

**Phase 3 — Frontend switch**
- 3.1 New `useGenres()` hook with cache + inflight dedupe
- 3.2 `CreateProjectCard.tsx` consumes `useGenres()` instead of hardcoded `GENRES`
- 3.3 `BookShelf.tsx` and `BookShelfModal.tsx` consume `useGenres()` for label lookup
- 3.4 `constants/genres.ts` marked DEPRECATED in JSDoc (kept for one release as a stub)

**Phase 4 — Migration & cleanup**
- 4.1 `scripts/migrate_genre_catalog.py` — idempotent, dry-run flag
- 4.2 Project `genre` validator (part of 4.1) — scans `projects/*/project.json`
- 4.3 Deprecation banners on old files
- 4.4 (Next release) Delete `data/style/`, `config/genre_thresholds.yaml`, `genre_fusion_engine._LEGACY_*`

---

## Risk Notes

- **Phase 2.1-2.3 require full regression runs.** Just-fixed `chapter_review.py:_check_writing_formula` regression test must still pass after each switch — it's the canary that the genre actually flows through.
- **Authoring the 10 fusion-only genres is manual.** Done as part of Phase 1.3. Each gets `pacing/tone/writing_formula/thresholds/fusion_meta` derived from the closest family-mate (e.g., `wuxia` clones `xianxia` then tweaks `action_ratio` upward). `ui_visible: false` ensures UI never offers an under-configured genre.
- **One-release dual-read window** is the safety net: if anything breaks in Phase 2, the legacy fallback to old files keeps the system running while we debug.