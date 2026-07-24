# Writer Character & Chapter-Outline Context — Design Spec

> **For agentic workers:** This is the design spec. Use `superpowers:writing-plans` to produce the implementation plan from this spec.

**Goal:** Make the Writer agent produce scene prose where character behavior / dialogue / decisions stay consistent with each character's full personality, voice, and backstory — by injecting structured character fields, pre-generated behavior examples, and the chapter outline (title / theme / scene sequence) directly into the scene-writing prompt. Currently the Writer sees only a thin POV-centric slice and no chapter title/theme, which causes drift in long-form runs.

**Architecture:** Extend Character Designer (v1.7) to also emit `behavior_examples` at character-creation time → persist on the character record → surface in the wizard card with edit/regenerate controls → Writer's `_build_characters_context` is rewritten to filter appearing characters by `scene_plan` and format full structured fields + behavior examples → new `_build_chapter_outline_context` emits chapter title + theme + scene sequence → `scene_writing.yaml` template gains a `{chapter_outline_context}` placeholder and shifts formatting work from YAML into Python → one-time migration script backfills existing characters with behavior examples (idempotent, resumable).

**Tech Stack:** Python 3.9 + FastAPI + pytest, React 18 + TypeScript + Vite + Vitest + React Testing Library. No new shared dependencies. Existing `FileManager.write_json` (atomic), existing `GlassPanel`, existing `api/client.ts`. Character Designer LLM call (existing, v1.7 Growth Workshop).

---

## Background

Today `backend/agents/writer.py::_build_characters_context` (lines 28-76) only passes:
- POV character: `name`, `type`, `current_state.location`, `current_state.emotional`, `voice_signature.taboos`, `unknown_to_character`
- Other characters: `name`, `type`, `current_state.location`, `current_state.emotional`

What's missing from the Writer's view:
- Chapter title + theme (`outline.json` per-chapter fields — not even passed in)
- Personality layer beyond `taboos`: `core_traits`, `beliefs`, `desires`, `fears`, `values`
- Voice layer beyond `taboos`: `speech_style`, `thought_patterns`
- State layer beyond location/emotion: `physical_condition`, `known_secrets`
- Character relationships and growth stage
- Any concrete example of the character in action

`backend/prompts/scene_writing.yaml` has placeholders for L0-L4 contexts, growth hint, character growth context, reader warnings, and `{characters_context}` — but **no placeholder for chapter title or theme**.

Net effect: on long runs the LLM produces dialogue that's grammatically correct but drifts from character voice, and scenes occasionally miss the chapter's emotional arc because the Writer doesn't know the chapter's stated theme.

This spec closes that gap by (a) extending the schema with concrete behavior examples, (b) restructuring the context to surface full per-character detail for all appearing characters, and (c) feeding the chapter outline into the prompt.

---

## Design Decisions (from brainstorming 2026-07-24)

| Decision | Choice | Rationale |
|---|---|---|
| Character detail granularity | **All appearing characters get full details** | User confirmed; filtering by POV alone drops voice signals for the antagonist / key supporting cast |
| Chapter outline scope | **Title + theme + per-chapter scene sequence** | User confirmed; per-scene plan is already in `scene_plan`, so chapter-level adds the arc context |
| Character info presentation | **Structured fields + behavior examples** | User confirmed; structured fields are deterministic, examples ground the LLM in concrete voice |
| Behavior example generation timing | **Pre-bake at character creation via Character Designer (v1.7)** | User chose Approach A; Character Designer is the natural home; one-time backfill beats per-character write-time cost |
| Behavior example schema | `[{situation, action, speech_sample}]` | Three fields cover *what triggers, what they do, what they say* — the minimum for grounded voice |
| Behavior example count | **3-5 per character** | Enough to show range (deliberation / conflict / loyalty / loss / humor) without blowing token budget |
| Token budget for `{characters_context}` | **≤4000 tok per scene, ~600 tok/character** | ~3% of per-chapter 120K budget; priority-trim drops background extras first |
| Token-budget control | **Priority tiered truncation** in Python (not prompt-level cap) | Predictable; logged; no surprise cutoffs |
| Chapter outline token budget | **≤200 tok** | Title + theme + scene sequence is naturally compact |
| Existing character migration | **One-time backfill script, idempotent + resumable** | Projects like `proj_7cb0180f` already have 15 chars; safer to backfill than to silently degrade |
| Schema migration | **Optional field** | Old characters without `behavior_examples` keep working (Writer degrades to structured-only) |
| Storage location for behavior examples | Inside `voice_signature.behavior_examples` | Same logical bucket as the voice signals they exemplify |

---

## Backend — Schema

### `backend/models/character.py`

Extend `VoiceSignature`:

```python
class BehaviorExample(BaseModel):
    situation: str       # 触发场景 (e.g. "挚友被陷害")
    action: str          # 行为反应 (e.g. "压制怒火,暗中收集证据")
    speech_sample: str   # 标志性台词 (e.g. "我会让你付出代价。")

class VoiceSignature(BaseModel):
    speech_style: str
    thought_patterns: str
    taboos: list[str]
    behavior_examples: list[BehaviorExample] = []   # NEW; defaults to [] for backward compat
```

Backward compat: existing characters without `behavior_examples` deserialize fine — Pydantic default applies, no migration of existing `characters.json` files required for them to keep loading.

---

## Backend — Character Designer Prompt

### `backend/prompts/character_designer.yaml`

Append to the user-instruction list (after the existing core_traits / beliefs / desires / fears / values / voice_signature fields):

```yaml
- voice_signature.behavior_examples: 3-5 concrete examples that ground this character's voice.
  Each example has three fields:
    * situation: a 1-line trigger scenario (specific, not generic)
    * action: 1-line behavioral response showing HOW the character reacts
    * speech_sample: 1-line in-character dialogue sample, written in the character's speech_style
  Variety: pick situations that show distinct facets (deliberation, conflict, loyalty, loss, humor, etc.).
  Concrete: every speech_sample must read like something THIS specific character would actually say.
```

The model's `output_schema` (JSON schema block at the bottom of the YAML) gets a matching addition so the structured output is validated.

### No new endpoint

Existing `POST /stage2/generate-character` and `PUT /stage2/character` already return / accept full character records — the new field rides on them transparently.

### Optional helper endpoint: `POST /stage2/character/{cid}/regenerate-examples`

For the wizard's "重新生成示例" button. Body: `{"keep_existing": false}` (default) or `{"keep_existing": true}` (append 2 new examples instead of replacing). Behavior: re-runs Character Designer for the single character with a focused prompt ("given existing character record, emit 3-5 NEW behavior examples") → merges into `voice_signature.behavior_examples` (replace or append per flag) → atomic write → returns updated character.

---

## Backend — Writer Pipeline

### `backend/agents/writer.py`

#### New helper: `_build_chapter_outline_context(chapter: dict) -> str`

Input: a chapter dict from `outline.json`:
```python
{
  "chapter_number": int,
  "title": str,
  "theme": str,
  "scene_plan": [{"scene_index": int, "goal": str, "conflict": str, "emotional_arc": str}, ...]
}
```

Output format (~150-200 tok):
```
## 本章大纲
- 标题: {title}
- 主题: {theme}
- 场景序列:
  1. {scene1.goal} (冲突: {scene1.conflict}, 情感弧线: {scene1.emotional_arc})
  2. {scene2.goal} (冲突: {scene2.conflict}, 情感弧线: {scene2.emotional_arc})
  ...
```

#### Rewrite: `_build_characters_context(characters: list[dict], scene_plan: dict) -> str`

Algorithm:
1. **Resolve appearing characters.** `scene_plan.characters_in_scene` is the canonical list of IDs that appear in this scene. If absent, fall back to: any character mentioned by name in `scene_plan.goal`/`conflict`/`emotional_arc`, plus POV (protagonist). If still empty → return empty string (degraded mode).
2. **Score priority per appearing character** (used for budget overflow):
   - Tier 1: POV (character_type == "protagonist") → 1.0
   - Tier 2: Antagonist OR appears in ≥2 of the chapter's scenes → 0.8
   - Tier 3: Supporting, appears in 1 scene → 0.5
   - Tier 4: Background (mentioned only) → 0.2
3. **Format per character (~250-600 tok each):**
   ```
   ### {name} ({character_type}, 优先级 {tier})
   - **性格**: core_traits=[...], beliefs=[...], desires=[...], fears=[...], values=[...]
   - **声音签名**: speech_style="...", thought_patterns="...", taboos=[...]
   - **当前状态**: location=..., physical_condition=..., emotional=..., known_secrets=[...]
   - **不知道的事**: [...]
   - **行为示例**:
     - 场景「{situation}」→ 行为「{action}」→ 台词「{speech_sample}」
     - ...
   ```
4. **Token budget enforcement.** If total exceeds 4000 tok:
   - Sort by tier descending (1.0 first)
   - Drop from tier 4 first (compress tier 4 to name+type+1 example line)
   - If still over, drop tier 3 examples to 2 each
   - If still over, drop tier 2 examples to 3 each
   - POV tier 1 is never truncated
   - Log `logger.debug("characters_context_truncated", original_tok=N, final_tok=M, dropped_tiers=[3,4])`
5. **Backward compat.** If a character lacks `behavior_examples`, emit a one-line note `（无行为示例，按结构化字段演绎）` instead of the examples block.

#### Wire-in: `write_scene()` and template

- `write_scene(...)` signature unchanged; reads chapter outline from disk (`projects/{id}/outline.json` keyed by `chapter_number`) and passes to new helper.
- `scene_plan` already passed in — use its `characters_in_scene` if present.

### `backend/prompts/scene_writing.yaml`

Template additions:

```yaml
system: |
  ...

  ## 本章上下文
  {chapter_outline_context}

  ## 出场角色
  {characters_context}

  ...
```

`{chapter_outline_context}` appears at the top of the prompt (after system preamble, before L0-L4). `{characters_context}` follows it. Existing L0-L4 / growth / reader-warnings placeholders stay where they are.

---

## Backend — Migration Script

### `scripts/backfill_behavior_examples.py`

- CLI: `python scripts/backfill_behavior_examples.py [--project-id ID] [--dry-run] [--batch-size 5]`
- Walks `projects/*/characters.json`. For each project, for each character whose `voice_signature.behavior_examples` is empty/missing:
  - Calls Character Designer with a focused single-character prompt ("given existing character record, emit 3-5 behavior examples")
  - Merges result into the character dict
  - Atomic write
- **Idempotent**: skips characters that already have non-empty `behavior_examples`
- **Resumable**: keeps a `.backfill_progress.json` per project with set of completed character_ids; resumed runs skip those
- **Batched**: `--batch-size` controls concurrency (default 5 concurrent LLM calls)
- **Logged**: per-character success/failure with timestamps
- **Dry-run**: `--dry-run` logs planned work but writes nothing
- Exit code 0 on full success, 1 if any individual character failed (summary printed at end)

Lives next to existing `scripts/repair_progress_from_drafts.py` (referenced in memory entry `project_streaming_path_retry_status_leak.md`).

---

## Frontend — `CharacterStep.tsx`

### New sub-component: `BehaviorExamplesSection`

Lives in `frontend/src/components/wizard/BehaviorExamplesSection.tsx`. Props:

```ts
{
  examples: BehaviorExample[];
  onChange: (next: BehaviorExample[]) => void;
  onRegenerate: () => void;       // calls api.regenerateCharacterExamples (single character)
  regenerating?: boolean;
}
```

Renders a vertical list of examples. Each row has three editable textareas (situation / action / speech_sample) and a 🗑️ delete button. Bottom row has:
- `+ 添加示例` — appends an empty `BehaviorExample` and focuses the situation textarea
- `🔄 重新生成` — calls `onRegenerate` (single LLM roundtrip replaces the list; spinner while `regenerating=true`)

### Card integration

`CharacterStep.tsx` card layout, below the existing voice-signature block, adds:
```
[voice-signature section]
[behavior-examples section]      ← NEW
[personality section]
[current-state section]
[relations section]
```

Inherits the inline-edit mode from the v1.9 refactor (no display/edit toggle). Edits stay in local state; footer "确认修改并继续" bulk-saves via existing `api.updateCharacter`.

### New wizard footer button per card

Top-right of each character card gets a `🔄 重新生成示例` button (next to existing 🗑️ delete). Calls `onRegenerate` directly on this card. Behavior:
1. Optimistic: clear local `behavior_examples`
2. Call `api.regenerateCharacterExamples(projectId, characterId)`
3. On success: replace local list with response
4. On failure: restore previous list, show toast

### `api/client.ts`

```ts
regenerateCharacterExamples(projectId: string, characterId: string): Promise<{ behavior_examples: BehaviorExample[] }>
```

---

## File-by-file change list

**New:**
- `backend/scripts/backfill_behavior_examples.py` (or `scripts/backfill_behavior_examples.py` — match existing convention)
- `frontend/src/components/wizard/BehaviorExamplesSection.tsx`
- `frontend/src/components/wizard/__tests__/BehaviorExamplesSection.test.tsx`
- `frontend/src/components/wizard/__tests__/CharacterStep.behavior_examples.test.tsx`
- `backend/tests/test_writer_chapter_outline_context.py`
- `backend/tests/test_writer_characters_context.py`
- `backend/tests/test_character_designer_prompt_examples.py`
- `backend/tests/test_backfill_behavior_examples.py`

**Modified — backend:**
- `backend/models/character.py` — add `BehaviorExample` + extend `VoiceSignature.behavior_examples`
- `backend/prompts/character_designer.yaml` — append behavior-examples instructions + output schema
- `backend/prompts/scene_writing.yaml` — add `{chapter_outline_context}` placeholder
- `backend/agents/writer.py` — new `_build_chapter_outline_context`; rewrite `_build_characters_context`; wire into `write_scene`
- `backend/api/stage2_world_char.py` — add `POST /stage2/character/{cid}/regenerate-examples`

**Modified — frontend:**
- `frontend/src/components/wizard/CharacterStep.tsx` — embed `<BehaviorExamplesSection>` in card; add per-card `🔄 重新生成示例` button
- `frontend/src/api/client.ts` — add `regenerateCharacterExamples`

---

## Test Plan

### Backend — unit

| File | Case | Expectation |
|---|---|---|
| `test_character_designer_prompt_examples.py` | `test_prompt_requires_3_to_5_examples` | `character_designer.yaml` mentions 3-5 in user instructions |
| `test_character_designer_prompt_examples.py` | `test_output_schema_includes_behavior_examples` | JSON schema block contains `behavior_examples` with required fields `situation`, `action`, `speech_sample` |
| `test_character_designer_prompt_examples.py` | `test_backward_compat_old_character_loads_without_field` | Character record missing `behavior_examples` deserializes; defaults to `[]` |
| `test_writer_chapter_outline_context.py` | `test_outputs_title_and_theme` | Format contains `标题:`, `主题:`, scene sequence with goal/conflict/emotional_arc |
| `test_writer_chapter_outline_context.py` | `test_handles_empty_scene_plan` | Returns just title+theme if `scene_plan` is empty |
| `test_writer_characters_context.py` | `test_filters_to_appearing_characters_via_scene_plan` | Only IDs in `scene_plan.characters_in_scene` appear in output |
| `test_writer_characters_context.py` | `test_priority_tier_pov_first` | POV (character_type=protagonist) listed before antagonists before supporting |
| `test_writer_characters_context.py` | `test_truncates_background_tier_first` | When total >4000 tok, tier 4 chars get compressed to name+type+1 example line |
| `test_writer_characters_context.py` | `test_never_truncates_pov_tier` | POV always has full examples regardless of budget pressure |
| `test_writer_characters_context.py` | `test_handles_missing_behavior_examples_field` | Old character without field gets `（无行为示例，按结构化字段演绎）` note; doesn't crash |
| `test_writer_characters_context.py` | `test_token_budget_log_emitted_on_truncation` | `logger.debug("characters_context_truncated", ...)` fires when truncation happens |

### Backend — integration

| File | Case | Expectation |
|---|---|---|
| `test_writer_pipeline_consistency.py` | `test_dialogue_matches_speech_style_marker` | Given 3 characters with distinct `speech_style`s, run full Writer pipeline, assert output contains expected lexical markers (regex check: short-sentence ratio for 沉稳/简洁 style; rhetorical-question markers for 狡诈 style) |
| `test_backfill_behavior_examples.py` | `test_idempotent_skip_existing` | Run twice; second run produces no LLM calls for already-filled chars |
| `test_backfill_behavior_examples.py` | `test_resumable_from_progress_file` | Kill mid-run; restart; picks up from `.backfill_progress.json` |
| `test_backfill_behavior_examples.py` | `test_dry_run_makes_no_writes` | `--dry-run` mode produces no file changes |

### Frontend — Vitest

| File | Case | Expectation |
|---|---|---|
| `CharacterStep.behavior_examples.test.tsx` | `test_renders_section_per_card` | Each character card has a `behavior-examples-section` with the examples listed |
| `CharacterStep.behavior_examples.test.tsx` | `test_inline_edit_updates_local_state` | Edit a `speech_sample` textarea; local state changes; no API call until footer "确认修改并继续" |
| `CharacterStep.behavior_examples.test.tsx` | `test_regenerate_button_calls_endpoint` | Click 🔄 → `regenerateCharacterExamples` called once with correct ids; spinner during; list replaced on success |
| `CharacterStep.behavior_examples.test.tsx` | `test_delete_example_removes_from_list` | Click 🗑️ on one example; row removed; no API call (held in local state) |
| `CharacterStep.behavior_examples.test.tsx` | `test_add_example_appends_blank_row` | Click `+ 添加示例`; new row appears with empty textareas |
| `BehaviorExamplesSection.test.tsx` | `test_section_handles_empty_initial` | Renders `+ 添加示例` button when `examples=[]` |
| `BehaviorExamplesSection.test.tsx` | `test_section_renders_progress_indicator_on_regenerating` | Spinner visible when `regenerating=true` |

### Manual smoke (post-implementation)

1. `uvicorn backend.main:app --reload --port 8000` + `npm run dev`
2. New project → wizard Stage 2 → 6 default characters generated → verify each card has `behavior-examples-section` with 3-5 examples
3. Edit one `speech_sample` inline → click footer "确认修改并继续" → refresh → edit persists
4. Click 🔄 on one card → spinner → list replaced with new examples
5. Run `python scripts/backfill_behavior_examples.py --project-id proj_7cb0180f --dry-run` → logs planned work
6. Run without `--dry-run` → verify `proj_7cb0180f/characters.json` gets `behavior_examples` for all 15 chars
7. Advance to Stage 3 → write chapter 1 → verify Writer logs include `chapter_outline_context` block and full per-character context
8. Manually inspect written scene: confirm 3-5 character dialogue lines roughly match each character's `speech_style`

---

## Out of scope (follow-ups)

- Editing `behavior_examples` via the workspace's `CharacterEditor.tsx` (read-only there for v1.10; future iteration)
- Per-scene behavior-example overrides (e.g., user wants 林峰 in this scene to be unusually cold)
- Behavior-example versioning / history
- LLM-as-judge automated regression suite for dialogue-vs-speech-style consistency (currently manual smoke only)
- Auto-regeneration of behavior_examples when voice_signature fields are edited (would invalidate stale examples; deferred — user can manually click 🔄)
- Behavior examples for non-character entities (factions, locations) — only characters for now

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Character Designer prompt produces 1-2 examples instead of 3-5 | medium | Pydantic `min_length=3` on `behavior_examples` field; retry once with stricter prompt; final fallback `behavior_examples: []` (Writer degrades gracefully) |
| Character Designer examples are too generic (e.g., "面对困难,勇敢面对") | medium | Prompt explicitly demands "specific, not generic"; manual edit UI lets user fix; future iteration could add LLM-as-judge filter |
| 4000 tok budget forces truncation of meaningful context for big ensemble scenes (10+ chars) | low-medium | Priority tiering drops background chars first; logged so user can see; future: increase budget or split scene plan into sub-scenes |
| Backfill script runs long on projects with many characters | low | `--batch-size 5` parallelism; resumable; idempotent; can be left running overnight |
| Existing scene-writing tests break because context payload changed | medium | Existing tests mock `_build_characters_context`; will need updates. Full Writer pipeline integration tests need re-baselining |
| Writer's increased prompt length increases per-scene token cost by ~5% | low | Per-chapter budget has headroom (~3-5% of 120K); acceptable |
| LLM occasionally references behavior examples verbatim in prose, breaking narrative flow | medium | Prompt instructs "use examples to ground voice, not to copy verbatim"; manual smoke catches; future: post-process regex check |
| Old characters without `behavior_examples` produce worse output than before (regression) | low | Backward-compat path uses structured fields exactly as before; same prompt length in that case |
| `regenerate-examples` endpoint racy with concurrent edits | low | Atomic write; last-writer-wins per field acceptable for single-user wizard |

---

## Migration / rollout

**No breaking changes.** All additions are forward-compatible:
- Schema: new optional field
- Endpoints: one new POST endpoint (`regenerate-examples`)
- Writer pipeline: rewrites an existing helper, no signature change
- Frontend: adds a section to the card, doesn't change existing fields

**Rollout order:**
1. Ship schema + Character Designer prompt extension → existing characters (no `behavior_examples`) keep working
2. Ship Writer pipeline rewrite + migration script → run migration for `proj_7cb0180f` and any other active projects
3. Ship frontend `BehaviorExamplesSection` + wizard card integration + `regenerate-examples` endpoint
4. Verify end-to-end with a fresh project through to chapter 1

**Suggested commit split (atomic per commit):**
1. `feat(models): BehaviorExample + voice_signature.behavior_examples (optional)`
2. `feat(prompts): character_designer emits behavior_examples (3-5)`
3. `feat(agents): Writer._build_chapter_outline_context + rewrite _build_characters_context with priority tiers`
4. `feat(prompts): scene_writing.yaml includes chapter_outline_context block`
5. `feat(api): POST /stage2/character/{cid}/regenerate-examples`
6. `feat(scripts): backfill_behavior_examples.py (idempotent, resumable)`
7. `feat(wizard): BehaviorExamplesSection + per-card regenerate button`
8. `feat(api-client): regenerateCharacterExamples`
9. `test(models): backward compat for missing behavior_examples`
10. `test(agents): writer chapter_outline_context + characters_context (priority, truncation, backward compat)`
11. `test(prompts): character_designer requires 3-5 examples in output schema`
12. `test(scripts): backfill idempotent + resumable + dry-run`
13. `test(wizard): BehaviorExamplesSection + CharacterStep integration`
14. `chore(scripts): run backfill for proj_7cb0180f and other active projects`