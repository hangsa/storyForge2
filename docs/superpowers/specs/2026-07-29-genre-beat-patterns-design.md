# v1.7 Genre Beat Patterns — Design Spec

> **For agentic workers:** This is the design spec. Use `superpowers:writing-plans` to produce the implementation plan from this spec.

**Goal:** Make the active genre's beat templates context-aware in Stage 3 outline generation — LLM receives only the beat templates whose keywords appear in the current outline, so each outline node can be expanded with the right pacing/shape for its genre.

**Architecture:** Extend the `GenreCatalog` schema with a new **required** `beat_patterns` field per genre (validates at load time), add a 4th prompt placeholder `{genre_beat_patterns}` (plus `{genre_focus_vocabulary}` for the focus legend), and match outline text against template keywords at outline-generation time. Backend wiring uses pure YAML data + 2 new helper functions in `planner.py`; no Python class hierarchy, no Skills, no per-genre code.

**Tech Stack:** Python 3.9 + FastAPI + PyYAML + pytest. Existing `GenreCatalog` singleton, existing `PlannerAgent.generate_novel_outline` / `generate_outline`, existing 3-tier prompt override chain (YAML → Global → Project). Frontend: no changes.

---

## Background

After the v1.7 dual-read window closed, all 7 genre templates live canonically in `config/genres/{id}.yaml` and are loaded by `backend/genres/catalog.py::GenreCatalog`. Three placeholders propagate genre fields into Stage 1-3 prompts:

| Placeholder | Source | Injected into |
|---|---|---|
| `{genre_tone}` | `entry.tone` | concept / world / character |
| `{genre_style_rules}` | `entry.style_rules` (numbered) | concept / world / character |
| `{genre_trope_patterns}` | `entry.trope_patterns` (bulleted) | concept / world / character |

All three are **constant and context-free** — the same content is injected regardless of what the outline currently says. In a side-by-side review against `plotPilot` (which implements a `ThemeAgent` Python class per genre with `get_beat_templates()` returning `[BeatTemplate(keywords, beats, priority)]`), storyForge2's mechanism is light but lacks the **context-aware** injection plotPilot achieves via keyword matching.

The smallest borrow that closes this gap: add a fourth placeholder `{genre_beat_patterns}` that returns **only beat templates whose keywords appear in the current outline text**, sorted by priority desc.

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| New YAML field name | `beat_patterns` (distinct from `trope_patterns`) | trope = high-level story pattern ("逆袭打脸"); beat = scene-level guide (4-phase expansion with word counts) |
| Beat shape | `[{description: str, words: int, focus: str}]` | Matches plotPilot; LLM-friendly; minimum viable granularity |
| Focus vocabulary | 6 words: `sensory / action / dialogue / emotion / suspense / reveal` | Smaller than plotPilot's 8; covers the 6 most common beat foci in Chinese web novels |
| Focus vocabulary location | New file `config/genre_focus_vocabulary.yaml` | Shared across all genres; single source of truth; loaded once at startup |
| Keyword match algorithm | Substring match, multi-keyword OR; **minimum keyword length 2 chars** | Robust to Chinese (no tokenizer dependency); plotPilot-style; "打脸" matches "打脸充胖子" — desired. Minimum 2 chars prevents single-character keywords like "脸" from generating noise matches |
| Empty outline_text behavior | Return all beat templates unfiltered (priority sorted) | First-pass outline generation has no prior text to match; useful for "scaffolding" pass |
| No-match behavior | Helper returns empty string (the entire `【题材节拍模板】` section disappears from the prompt) | Avoids polluting prompt with empty section headers |
| `outline_text=None` handling | Normalize to `""` at the top of the helper | Defensive — `None in str` would TypeError on substring match; cheap insurance |
| Priority sort direction | Descending (higher priority first) | When multiple templates match, the more impactful one leads |
| Scope | Both `generate_novel_outline` (全本大纲) and `generate_outline` (章节大纲) | Both produce outline text and benefit from beat expansion |
| Renaming `_resolve_genre_extras`? | **No** — keep as backward-compatible shim, add 2 new helpers | External consumers exist; renaming breaks them without functional benefit |
| New helpers' location | `backend/agents/planner.py` (next to `_resolve_genre_extras`) | Same module already owns genre-extras resolution |
| Schema validation | `_REQUIRED_GENRE_FIELDS` adds `beat_patterns` as **required** (not optional) | Forces all 7 genres to author templates up front; avoids silent prompt degradation |
| Frontend changes | None | Prompts are backend-only; genre picker already shows index.yaml data |
| Backward compatibility | Existing 3 placeholders unchanged; existing 14 `test_genre_template_propagation` tests unchanged | New field is purely additive |

---

## Data Schema

### `config/genre_focus_vocabulary.yaml` (NEW)

```yaml
focus_legend:
  sensory:  感官描写为主，渲染氛围/环境/细节
  action:   动作/事件推进为主，节奏紧凑
  dialogue: 对话/心理独白为主，人物互动
  emotion:  情感波动为主，内心刻画
  suspense: 悬念/不安为主，信息管控
  reveal:   揭露/反转为主，情节兑现
```

Loaded once at startup by `_resolve_genre_focus_vocabulary()`. 6 entries.

### `config/genres/{cool_novel,xianxia,xuanhuan,dushi,kehuan,xuanyi,yanqing}.yaml` (MODIFIED)

Add `beat_patterns` block between `trope_patterns` and `thresholds`. Shape:

```yaml
beat_patterns:
  - keywords: [打脸, 装逼, 嘲讽, 不自量力, 蝼蚁]
    priority: 90
    beats:
      - { description: "铺垫：对手嚣张/轻视/嘲讽主角",     words: 500, focus: "dialogue" }
      - { description: "交锋：主角被压制或隐藏实力",         words: 700, focus: "action"   }
      - { description: "反转：底牌揭露、压倒性爆发",         words: 900, focus: "reveal"   }
      - { description: "余波：围观者震惊、势力格局变动",     words: 600, focus: "emotion"  }
  - keywords: [突破, 升级, 晋升, 实力提升]
    priority: 70
    beats:
      - { description: "...", words: 500, focus: "sensory" }
      - { description: "...", words: 1000, focus: "action" }
      - { description: "...", words: 600, focus: "emotion" }
  # ... 4-6 templates per genre
```

**Per-genre authoring target** (initial draft, to be hand-tuned later):

| Genre | Templates | Source guidance |
|---|---|---|
| `cool_novel` | 打脸/装逼, 越级挑战, 突破升级, 身份揭露 | plotPilot xuanhuan_agent.py templates + cool_novel trope_patterns |
| `xianxia` | 境界突破, 宗门大比, 秘境探险, 因果了结, 天劫降临 | plotPilot xuanhuan_agent.py + xianxia trope_patterns |
| `xuanhuan` | 血脉觉醒, 遗迹探索, 大陆争霸, 位面战争, 魔兽契约 | plotPilot xuanhuan_agent.py + xuanhuan trope_patterns |
| `dushi` | 商业博弈, 身份反转, 职场冲突, 现实事件 | plotPilot dushi_agent.py + dushi trope_patterns |
| `kehuan` | 技术突破, 首次接触, 伦理困境, 系统危机, 文明抉择 | plotPilot scifi_agent.py + kehuan trope_patterns |
| `xuanyi` | 线索发现, 嫌疑人反转, 个人危机, 大反转, 终极对决 | plotPilot suspense_agent.py + xuanyi trope_patterns |
| `yanqing` | 误会和解, 关系升级, 第三者介入, 外力阻挠, 情感转折 | plotPilot romance_agent.py + yanqing trope_patterns |

Total: 33 beat templates across 7 genres (2 genres × 4 templates + 5 genres × 5 templates = 33). Assuming ~4 beats per template, that's ~132 beats total. Each beat description is 1 sentence (~30 chars Chinese), each genre YAML grows by ~30-50 lines.

---

## Backend Changes

### `backend/genres/catalog.py` (MODIFIED)

1. Add `"beat_patterns"` to `_REQUIRED_GENRE_FIELDS` tuple — all 7 genre YAMLs must declare it.
2. New private method `_validate_beat_patterns(gid, entry)` called inside `_load_entries()` after the existing field check:
   - `entry["beat_patterns"]` must be a list (≥1 element)
   - Each template must have `keywords: list[str]` (non-empty, all strings ≥2 chars), `priority: int` (0-100), `beats: list[dict]` (≥1 element)
   - Each beat must have `description: str` (non-empty), `words: int` (>0), `focus: str` ∈ focus vocabulary
   - On violation: `raise CatalogLoadError(f"config/genres/{gid}.yaml beat_patterns invalid: {detail}")`

### `backend/agents/planner.py` (MODIFIED)

Two new helpers, both module-level functions next to `_resolve_genre_extras`:

```python
_FOCUS_VOCAB_PATH = Path(__file__).resolve().parents[2] / "config" / "genre_focus_vocabulary.yaml"


@lru_cache(maxsize=1)
def _resolve_genre_focus_vocabulary() -> str:
    """Load focus vocabulary once and return formatted legend string.

    Returns multi-line text:
      【focus 字段图例】
      - sensory:  感官描写为主，渲染氛围/环境/细节
      - action:   动作/事件推进为主，节奏紧凑
      - dialogue: 对话/心理独白为主，人物互动
      - emotion:  情感波动为主，内心刻画
      - suspense: 悬念/不安为主，信息管控
      - reveal:   揭露/反转为主，情节兑现

    The leading 【focus 字段图例】 header is included so the prompt template
    only needs to place {genre_focus_vocabulary} on its own line.

    Raises CatalogLoadError only if file is missing or malformed.
    """


def _resolve_genre_beat_patterns(
    genre: str,
    outline_text: Optional[str] = "",
) -> str:
    """Return keyword-matched beat templates as a formatted multi-line string,
    INCLUDING the leading 【题材节拍模板】 section header.

    For the given genre, read `beat_patterns` from catalog. If `outline_text`
    is non-empty (and not None), keep only templates where at least one
    keyword is a substring of outline_text. Sort by priority desc.

    Render shape (whole section, including header):
      【题材节拍模板】（按优先级排序；仅显示与当前大纲关键词匹配的模板）
      1. keywords=[打脸, 装逼, ...] priority=90
         - 铺垫：对手嚣张/轻视/嘲讽主角 (500 字, focus: dialogue)
         - 交锋：... (700 字, focus: action)
         ...
      2. keywords=[突破, 升级, ...] priority=70
         ...

    If no templates match (after filtering), return empty string. The whole
    section disappears from the rendered prompt — no blank header.

    outline_text=None is normalized to "" (defensive: substring match would
    TypeError on None).
    """
```

Wire into `generate_novel_outline` and `generate_outline`:

```python
async def generate_novel_outline(
    self, ..., outline_text: str = "",   # NEW param, optional
):
    ...
    beat_patterns_str = _resolve_genre_beat_patterns(genre, outline_text)
    focus_vocab = _resolve_genre_focus_vocabulary()
    result, response = await self.generate_from_template(
        "novel_outline_generation",
        ...,
        genre_beat_patterns=beat_patterns_str,
        genre_focus_vocabulary=focus_vocab,
    )

async def generate_outline(
    self, ..., outline_text: str = "",   # NEW param, optional
):
    ...  # same wiring, template name "outline_generation"
```

The `outline_text` parameter is `Optional[str] = ""` — default behavior unchanged (returns all beat templates unfiltered).

### `backend/api/stage3_outline.py` (REVIEW)

The Stage 3 API calls into `generate_novel_outline` / `generate_outline`. No source changes are required for first-pass generation — the new `outline_text` parameter has a default of `""`, so existing call sites continue to work (returning all beat templates unfiltered).

**For incremental regeneration** (if supported by Stage 3): when re-running outline generation against an existing `novel_outline.json` or per-chapter plan, the API should pass that JSON content as `outline_text`. This enables keyword matching against the prior outline so beat templates are filtered to only those relevant to the current text.

This is **not in scope** for this spec — the new `outline_text` parameter is provided but the API doesn't wire it up yet. Implementation review during planning should check `backend/api/stage3_outline.py` to confirm no immediate changes are needed.

---

## Prompt Template Changes

### `backend/prompts/novel_outline_generation.yaml` (MODIFIED)

Add before the "请生成" section. The helpers return whole sections (header + body), so the template just needs placeholder lines:

```yaml
{genre_beat_patterns}

{genre_focus_vocabulary}
```

When `genre_beat_patterns` is empty (no keyword matches), the section disappears entirely from the rendered prompt. The focus vocabulary section always renders.

### `backend/prompts/outline_generation.yaml` (MODIFIED)

Same two-placeholder insert as above.

### Render output example (with matched keywords)

```
【题材节拍模板】（按优先级排序；仅显示与当前大纲关键词匹配的模板）
1. keywords=[打脸, 装逼, 嘲讽] priority=90
   - 铺垫：对手嚣张/轻视/嘲讽主角 (500 字, focus: dialogue)
   - 交锋：主角被压制或隐藏实力 (700 字, focus: action)
   - 反转：底牌揭露、压倒性爆发 (900 字, focus: reveal)
   - 余波：围观者震惊、势力格局变动 (600 字, focus: emotion)

2. keywords=[突破, 升级, 晋升] priority=70
   - 升级契机出现 (500 字, focus: sensory)
   - 升级过程 (1000 字, focus: action)
   - 升级余波 (600 字, focus: emotion)

【focus 字段图例】
- sensory:  感官描写为主，渲染氛围/环境/细节
- action:   动作/事件推进为主，节奏紧凑
- dialogue: 对话/心理独白为主，人物互动
- emotion:  情感波动为主，内心刻画
- suspense: 悬念/不安为主，信息管控
- reveal:   揭露/反转为主，情节兑现
```

---

## Testing Strategy

New file `tests/test_genre_beat_patterns.py` with 4 test classes (target: 14 tests total).

### `TestSchemaValidation` (4 tests)

Test isolation pattern: use `GenreCatalog(tmp_genres_dir)` constructor (the existing constructor already accepts a custom dir at `catalog.py:36-39`). For each test, write a malformed YAML into a temp dir and instantiate a fresh `GenreCatalog` — its `_load()` is called on first `get()` / `get_catalog()` access, raising `CatalogLoadError` on invalid data.

```python
def test_all_7_genres_have_beat_patterns_field():
    """catalog loading succeeds → all 7 genres declare beat_patterns."""

def test_beat_pattern_with_empty_keywords_raises_on_load(tmp_path):
    """Write a genre YAML with keywords=[]; GenreCatalog(tmp_path).get() → CatalogLoadError."""

def test_beat_with_unknown_focus_raises_on_load(tmp_path):
    """Write a genre YAML with focus='random_word'; GenreCatalog(tmp_path).get() → CatalogLoadError."""

def test_beat_with_single_char_keyword_raises_on_load(tmp_path):
    """Write a genre YAML with keywords=['脸']; GenreCatalog(tmp_path).get() → CatalogLoadError (min length 2)."""
```

### `TestKeywordMatching` (4 tests)

```python
def test_substring_match_returns_matching_template_only():
    """outline_text='主角打脸反派' → returns only '打脸/装逼' template."""

def test_multiple_keyword_match_sorts_by_priority_desc():
    """outline containing both '打脸' and '突破' keywords → 2 templates, sorted by priority desc."""

def test_empty_outline_returns_all_templates_unfiltered():
    """outline_text='' → all templates returned, sorted by priority desc."""

def test_no_keyword_match_returns_empty_string():
    """outline with no matching keywords → empty string (no '【题材节拍模板】' header)."""
```

### `TestPromptWiring` (4 tests)

```python
@pytest.mark.asyncio
async def test_novel_outline_prompt_renders_beat_patterns_section():
    """generate_novel_outline with matching outline → prompt contains '【题材节拍模板】' + keywords."""

@pytest.mark.asyncio
async def test_novel_outline_prompt_omits_section_when_no_match():
    """generate_novel_outline with no-keyword outline → prompt contains focus vocab but no beat section."""

@pytest.mark.asyncio
async def test_chapter_outline_prompt_uses_outline_text_for_matching():
    """generate_outline with chapter_number=5 and outline_text='打脸场景' → matching template appears."""

@pytest.mark.asyncio
async def test_focus_vocabulary_appears_in_prompt():
    """Prompt always contains the '【focus 字段图例】' section with all 6 focus definitions."""
```

### `TestIntegration` (2 tests)

```python
@pytest.mark.asyncio
async def test_keyword_match_changes_prompt_with_different_outlines():
    """Same genre + concept; outline_text='打脸' vs '突破' produces different prompts."""

@pytest.mark.asyncio
async def test_unknown_genre_falls_back_to_first_index_entry():
    """genre='nonexistent_xyz' → cool_novel's beat_patterns used (matches existing fallback)."""
```

### Existing tests

The 14 existing tests in `tests/test_genre_template_propagation.py` MUST continue to pass unchanged. They cover the 3 prior placeholders (`{genre_tone}` / `{genre_style_rules}` / `{genre_trope_patterns}`), which are not affected by this change.

---

## Files Changed

| File | Operation | Approx. Δ |
|---|---|---|
| `config/genre_focus_vocabulary.yaml` | NEW | +10 lines |
| `config/genres/cool_novel.yaml` | MODIFY | +30 lines |
| `config/genres/xianxia.yaml` | MODIFY | +50 lines |
| `config/genres/xuanhuan.yaml` | MODIFY | +50 lines |
| `config/genres/dushi.yaml` | MODIFY | +35 lines |
| `config/genres/kehuan.yaml` | MODIFY | +40 lines |
| `config/genres/xuanyi.yaml` | MODIFY | +40 lines |
| `config/genres/yanqing.yaml` | MODIFY | +35 lines |
| `backend/genres/catalog.py` | MODIFY | +25 lines (validation) |
| `backend/agents/planner.py` | MODIFY | +70 lines (2 helpers + 2 wiring points) |
| `backend/prompts/novel_outline_generation.yaml` | MODIFY | +5 lines |
| `backend/prompts/outline_generation.yaml` | MODIFY | +5 lines |
| `tests/test_genre_beat_patterns.py` | NEW | ~250 lines |

Total: 1 new config file, 1 new test file, 7 genre YAMLs + 4 backend files modified (catalog + planner + 2 prompts). Net addition ~640 lines.

---

## Out of Scope (Explicitly YAGNI)

The following plotPilot capabilities are **deliberately not borrowed**:

| Capability | Why not |
|---|---|
| Python `ThemeAgent` class per genre | Violates "data-driven" principle; 200 lines of Python per genre; the YAML field already covers the core capability |
| `ThemeSkill` cross-genre sharing mechanism | storyForge2 has no analogous engine layer; introducing requires architectural refactor of Stage 3-5 context assembly |
| `get_opening_beats(chapter_number)` (first-3-chapter specialization) | PlotPilot-specific; unverified benefit on storyForge2; staged for later evaluation |
| `get_buffer_chapter_template(outline)` (low-tension filler chapters) | Unverified benefit; storyForge2's ReaderOS already handles fatigue via thresholds |
| `get_audit_criteria` (dynamic per-outline audit list) | storyForge2 already has `required_logs` mechanism in Stage 4 Fact Guard |
| `config/genre_packs/` lightweight YAML packs | plotPilot's equivalent is orphaned config; the canonical path is `config/genres/*.yaml` |
| Frontend taxonomy picker refactor | Frontend already reads `index.yaml` via `/api/genres`; no need for additional facet UI |

These can be revisited in future design specs if the beat_patterns prove insufficient.

---

## Rollout

Single commit, single PR. The 7 genre YAMLs need their `beat_patterns` fields authored before the catalog can load — this is the natural sequencing:

1. Author `config/genre_focus_vocabulary.yaml`
2. Add `beat_patterns` to all 7 genre YAMLs (catalog will not load without it once `_REQUIRED_GENRE_FIELDS` is updated)
3. Update `catalog.py` schema validation
4. Add 2 helpers to `planner.py`
5. Wire into `generate_novel_outline` and `generate_outline`
6. Update 2 prompt YAMLs
7. Add `tests/test_genre_beat_patterns.py`
8. Run full suite (existing 1358 tests + 14 new = target 1372 passing)
9. Verify 10 pre-existing failures (autopilot / llm_config) remain unchanged

The worktree preference is **direct on v1.9 branch** (per user preference in feedback memory); no separate worktree.

---

## Open Questions (Resolved)

These were raised during brainstorming; resolved in this spec:

| # | Question | Resolution |
|---|---|---|
| 1 | Should we rename `_resolve_genre_extras`? | No — keep as backward-compat shim, add 2 new helpers. Avoids breaking external callers. |
| 2 | Where to put focus vocabulary? | Standalone `config/genre_focus_vocabulary.yaml` — shared, single source. |
| 3 | Substring vs exact keyword match? | Substring — robust to Chinese; "打脸" matching "打脸充胖子" is desired behavior. |
| 4 | Match against trope_patterns names too? | No — keep beat_patterns distinct. trope is high-level ("逆袭打脸"); beat is scene-level (4-phase expansion). LLM prompt stays focused. |
| 5 | Per-chapter chapter_type filtering? | No — out of scope. Future iteration if data shows need. |
| 6 | 6 vs 8 focus words? | 6 — fewer is better; covers the 6 dominant beat foci in Chinese web novel writing. |