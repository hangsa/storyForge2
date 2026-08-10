# Wizard per-section regenerate

**Status:** Draft — pending user review
**Date:** 2026-08-10
**Branch:** v2.1
**Author:** Claude (brainstorming session)

## Goal

In the init wizard, each labeled section inside each step gets its own
independent regenerate capability. The user clicks a refresh icon next
to the section title, types modification guidance in a modal, and only
that section is rewritten — other sections stay as-is.

This gives precise, surgical control over what gets regenerated, instead
of having to either accept the whole-step regeneration or hand-edit
every field.

## Scope

### Steps with new section-level icons

| Step | Sections (icon after each title) | Existing whole-step regenerate |
|---|---|---|
| 1 — 概念 | 概念信息, 核心矛盾 | footer button (kept) |
| 2 — 世界观 | 时代与地理, 力量体系, 世界规则, 势力分布 | footer button (kept) |
| 3 — 角色设计 (per character) | 人格层, 声音签名, 当前状态, 角色不知道的事, 角色关系 | footer button (kept) |
| 4 — 全书大纲 | 核心冲突与主题, 分卷 / 阶段划分, 主角成长节点, 关键情节点 | footer button (kept) |
| 5 — 章节大纲 | **none** — per-chapter regenerate already exists | footer button (kept) |

### Save semantics

After a successful section regenerate, the new content is **immediately
written to disk** (mirroring the existing
`/stage2/character/{id}/regenerate-examples` pattern). The UI syncs
local state from the server response. The footer "下一步 / 确认修改并
继续" flow is unchanged — it still persists whatever the user has
hand-edited locally.

### Out of scope

- Regenerating the whole concept / world / novel-outline from a section
  icon. (Existing footer buttons cover this.)
- Touching `voice_signature.behavior_examples` when the "声音签名"
  section is regenerated. The existing per-character-examples regenerate
  keeps owning that sub-section.
- Adding icons to Step 5. Per-chapter regenerate already provides
  per-section granularity there.

## Backend design

Four new endpoints. Each follows the exact pattern of the existing
`POST /api/stage2/character/{character_id}/regenerate-examples`
(`backend/api/stage2_world_char.py:415`): read the current JSON file,
call the existing agent (with `user_modifications` threaded through
`_build_user_modifications_block`), extract only the targeted section,
merge back, write to disk.

### Endpoints

| Endpoint | Request body | Agent reused | Sections |
|---|---|---|---|
| `POST /api/stage1/regenerate-section` | `{ section, user_modifications }` | `PlannerAgent.generate_concept` | `concept` \| `dna` |
| `POST /api/stage2/regenerate-world-section` | `{ section, user_modifications }` | `PlannerAgent.generate_world` | `era` \| `power_system` \| `core_rules` \| `factions` |
| `POST /api/stage2/regenerate-character-section?character_id=X` | `{ section, keep_existing?, user_modifications }` | `PlannerAgent.generate_character` | `personality` \| `voice_signature` \| `current_state` \| `unknown` \| `relations` |
| `POST /api/stage3/regenerate-novel-outline-section` | `{ section, user_modifications }` | `PlannerAgent.generate_novel_outline` | `core_conflict` \| `volumes` \| `mc_growth` \| `key_plot` |

### Section validation

Use a `Literal[...]` Pydantic type for the `section` field. Unknown
values fail at request parse time with `400 VALIDATION_ERROR`. This
makes the contract self-documenting and prevents silent typo bugs.

### Merge semantics

For each endpoint:

1. Read the current JSON file via `_file_manager().read_json(project_id, <filename>)`.
2. Instantiate the relevant agent (re-resolved at call time so the test
   mock `patch("backend.agents.planner.PlannerAgent")` works, matching
   the regenerate-examples pattern).
3. Call the agent with `existing_*` inputs read from the current file
   (so the LLM has full context, not just the targeted section's inputs).
4. Build the targeted section object via Pydantic models; drop
   malformed entries (skip-don't-fail, like regenerate-examples).
5. Merge into the existing object: targeted section replaced (or appended
   if `keep_existing=true` for character), all other fields preserved.
6. Write back via `_file_manager().write_json(...)`.
7. Return the merged object so the frontend can sync local state.

#### `voice_signature` special case

When `section="voice_signature"`, the merge replaces
`voice_signature.speech_style`, `thought_patterns`, and `taboos`, but
**explicitly preserves** `voice_signature.behavior_examples`. This
keeps the existing per-card regenerate-examples workflow intact.

### Error handling

| Failure | Response |
|---|---|
| Unknown `section` value | `400 VALIDATION_ERROR` (Pydantic) |
| Project file missing | `404 NOT_FOUND` |
| Agent raises `ValueError` | `503 LLM_GENERATION_FAILED` (mirrors regenerate-examples) |
| Pydantic model rejects malformed section entries | skip-don't-fail — drop the entry, keep the rest |

## Frontend design

### New shared component

`frontend/src/components/shared/SectionRegenerateButton.tsx`

A small icon button that owns its own busy state and opens the existing
`RegenerateModal`. Reused across every section in every step.

```ts
interface SectionRegenerateButtonProps {
  target: string;                       // modal title: "力量体系"
  onRegenerate: (userModifications: string) => Promise<void>;
  disabled?: boolean;
  testId?: string;                      // default: `section-regenerate-${target}`
}
```

Visual: a 14px `material-symbols-outlined` `refresh` icon, default
color `text-system-log/50`, hover `text-primary-container`, disabled
when `onRegenerate` is in flight. Clicking opens the existing
`RegenerateModal` with `target` as its title; confirming calls
`onRegenerate(text)`; cancelling just closes the modal.

### API client wrappers

`frontend/src/api/client.ts` — add four wrappers, each a thin POST:

```ts
regenerateConceptSection(projectId, section, userModifications)
regenerateWorldSection(projectId, section, userModifications)
regenerateCharacterSection(projectId, characterId, section, opts?)
regenerateNovelOutlineSection(projectId, section, userModifications)
```

### Per-step wiring

Each step gets:

1. A small section-key state union: `type SectionKey = "era" | "power_system" | ...`
2. A single `busySection: SectionKey | null` state (not a Set — only one
   in-flight call per section is allowed; multiple sections can run in
   parallel because they have different keys).
3. A `handleSectionRegenerate(section, mods)` function that:
   - Sets `busySection = section`
   - Calls the relevant API wrapper
   - On success: replaces local state from the response (e.g. `setWorld(response)`),
     calls `wizard.markStepGenerated(stepNum, { entity: response })` so the
     step stays reachable in the indicator
   - On error: `wizard.setStatus("error", message)` — the existing
     step-top error banner picks it up
   - Always: clears `busySection`

### UI placement

Every labeled section header (e.g. "力量体系") becomes a flex row:

```tsx
<div className="flex items-center justify-between mb-3">
  <div className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">
    力量体系
  </div>
  <SectionRegenerateButton
    target="力量体系"
    onRegenerate={(mods) => handleSectionRegenerate("power_system", mods)}
    testId="world-power-system-regenerate"
  />
</div>
```

Sections that currently lack a labeled header (e.g. "概念信息" in
ConceptStep, "核心冲突与主题" / "主角成长节点" / "关键情节点" in
OutlineStep) get a new label header in the project's existing
uppercase 10px style, paired with a regenerate icon.

### State isolation

Section regenerate does **not** touch the wizard's global
`status` / `prefillComplete`. The footer "重新生成" button (whole-step)
keeps its existing behavior; section icons live alongside it without
interfering. This means a user can regenerate section A while
simultaneously editing section B in the form, with both reflecting their
own state independently.

## Testing strategy

### Backend tests (one file per endpoint)

Following the pattern of `backend/tests/test_stage2_regenerate_examples.py`:

- `tests/test_stage1_regenerate_section.py`
  - each section regenerates and merges correctly
  - unknown `section` returns 400
  - missing project returns 404
  - agent `ValueError` returns 503
- `tests/test_stage2_regenerate_world_section.py`
  - same matrix over `era` / `power_system` / `core_rules` / `factions`
- `tests/test_stage2_regenerate_character_section.py`
  - same matrix over the 5 character sections
  - extra case: regenerating `voice_signature` does **not** clobber
    `behavior_examples`
- `tests/test_stage3_regenerate_novel_outline_section.py`
  - same matrix over `core_conflict` / `volumes` / `mc_growth` / `key_plot`

For every "happy path" case, the test asserts:
1. The targeted section is replaced with the LLM output.
2. All other sections in the same file are byte-identical before and after.

### Frontend tests

- `frontend/src/test/SectionRegenerateButton.test.tsx` (new):
  - renders the icon
  - opens the modal on click
  - shows busy state while `onRegenerate` is in flight
  - closes the modal on confirm
  - surfaces errors via the caller's promise rejection
- `frontend/src/test/InitWizardModal.test.tsx` (extend existing):
  - one test per step that the section regenerate icon is rendered
  - one test that clicking it calls the right API wrapper
- `frontend/src/test/client.test.ts` (extend):
  - the four new wrappers build correct URLs and bodies
- Existing tests in `BehaviorExamplesSection.test.tsx` /
  `CharacterStep.behavior_examples.test.tsx` / etc. stay untouched —
  the per-card behavior-examples regenerate is unchanged.

### Manual verification checklist

Recorded here for the implementation session — not automated:

- For each step, click the section icon → modal opens → submit → file
  on disk changes only in that section; other sections are byte-identical.
- Trigger a regenerate failure (e.g. invalid API key) → error banner at
  the top of the step renders, busy state clears.
- Click section A's icon, then immediately click section B's icon → both
  regenerate in parallel; both finalize correctly without clobbering.
- Edit a field by hand, then regenerate that section → hand-edits in
  other sections survive; only the targeted section changes.

## Open questions

None at design time.