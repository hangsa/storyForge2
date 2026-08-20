# Workspace — Right-Panel "章节大纲" Tab

**Date:** 2026-08-20
**Branch:** v2.1
**Status:** Draft, pending review

## Context

The workspace right panel (`ContextPanel`) has six tabs: 概念 / 世界观 / 角色 / 大纲 / 诊断 / 导出. The "大纲" tab shows the **novel-level** outline (`core_conflict_theme` / `volumes` / `mc_growth_arc` / `key_plot_points`) — that decision was finalized in commit `db1aa79` (2026-07-14) with the rationale "The per-chapter outline stays in the left panel (WritingArea header)".

That worked for v1.9, but v2.1 surfaces two limitations:

1. **WritingArea header shows only the current chapter's outline** (theme + the first scene's goal/conflict/emotional_arc). Users who want to **review or revise a chapter other than the one currently being written** have no in-workspace view — they must leave the workspace and use Stage3.
2. **There is no in-workspace editor for per-chapter outline.** Even with the new `+ 新章节` button, users cannot adjust scene `goal` / `conflict` / `emotional_arc` / `narrative_role` / `beat_type` after Stage3 has generated them; minor outline fixes require Stage3 regeneration, which overwrites other sections too.

This spec adds a seventh tab "章节大纲" to the workspace right panel: a **volume-grouped, vertical, collapsible view/edit surface for the per-chapter outline** (`outline.json`).

## Goals

1. Provide a cross-chapter view of all chapters' titles / themes / scene plans in the workspace right panel, without leaving the writing context.
2. Provide in-workspace editing of per-chapter outline fields so users don't have to round-trip to Stage3 for small fixes.
3. Reuse the volume-grouping logic that `ChapterTreePanel` already uses, so the two surfaces look and behave consistently.
4. Honor the v1.9 readOnly contract — the tab is read-only in managed mode, consistent with the other four editor tabs.

## Non-Goals

- Reverting the v1.9 decision that demoted per-chapter outline from the right panel. We are *adding* a tab, not undoing the rationale for the existing "大纲" tab.
- Adding a chapter outline tab to the left panel (`ChapterTreePanel`) — chapter *selection* lives there; outline *editing* lives in the new tab.
- Changing the `Outline` data model or the `api.getOutline` / `api.updateOutline` endpoints. Both already exist.
- Auto-saving or autosave-to-server on field blur. Saving is explicit, matching other editors.
- Refactoring `ChapterTreePanel`. Only its `groupChaptersByVolume` / `parseVolumes` helpers are extracted into a shared util so both surfaces can use them.

## Architecture

### New tab in `ContextPanel`

`ContextPanel`'s `TAB_LABEL` and `FETCHER` maps gain a new entry:

| `WorkspacePanel` value | Label | Fetcher |
|---|---|---|
| `chapter-outline` | 章节大纲 | `api.getOutline` |

`useWorkspacePanel` accepts the new value (whitelist extended).

The existing `EditorForPanel` switch in `ContextPanel.tsx` routes `panel === "chapter-outline"` to a new `<ChapterOutlineEditor>`.

The `outline` data and the existing `novel_outline` data are independent JSON files (`outline.json` vs `novel_outline.json`); both fetches live on the same `ContextPanel` instance but at different tabs and reload independently when the user clicks back to that tab (driven by the existing `reloadKey` mechanism).

### Volume grouping — shared helper

`parseVolumes` and `groupChaptersByVolume` currently live inside `pages/WorkspacePage.tsx` as local helpers. Both are needed by:

- `WorkspacePage` (existing) — groups `manualChapters` for `ChapterTreePanel`
- The new `ChapterOutlineEditor` — groups `outline.chapters` for the new tab

To avoid duplication, the helpers are **moved to `frontend/src/utils/outline.ts`** and exported from there. `WorkspacePage` imports them from the new location (the public API does not change). The `VOLUME_RANGE_RE` regex constant is folded into the existing `CHAPTER_RANGE_RE` (same regex, different name) — one canonical regex.

The `ParsedVolume` interface used by both surfaces also moves to `utils/outline.ts`.

### Editor placement

`ChapterOutlineEditor` lives at `frontend/src/components/workspace/editors/ChapterOutlineEditor.tsx`, the path vacated when `OutlineEditor.tsx` was deleted in commit `db1aa79`.

It follows the same `BaseEditorProps` contract (`projectId`, `data`, `onSaved`, `readOnly?`) as the other four editors, with the same `readOnly` semantics: when `readOnly=true`, all inputs are disabled and the save button shows `disabled` + the `readOnly` reason tooltip ("托管运行中,元数据已锁定").

## Component Structure

```
ContextPanel
└── (Object.keys(TAB_LABEL)).map
    └── panel === "chapter-outline"
        └── <ChapterOutlineEditor>
            ├── loading state           → "加载中…"
            ├── empty state             → "尚未生成章节大纲 — 请到 Stage3 生成"
            └── editing state
                ├── <VolumeGroup> × N   (from groupChaptersByVolume)
                │   ├── <VolumeHeader>  (collapsible, default open)
                │   └── <ChapterRow> × N (collapsible, default open)
                │       ├── inline edit: title (text input)
                │       ├── inline edit: theme (textarea, auto-grow)
                │       └── <SceneRow> × N (collapsible, default closed)
                │           ├── inline edit: goal, conflict, emotional_arc
                │           ├── select:    narrative_role (4-option enum)
                │           ├── input:     beat_type (string)
                │           └── <BFieldsAccordion> (collapsible, default closed)
                │               ├── registry_changes.created
                │               │   ├── list of { type, id_pattern, description }
                │               │   ├── per-row delete + add buttons
                │               ├── registry_changes.updated
                │               │   ├── list of { asset_id, field, new_value }
                │               │   └── per-row delete + add buttons
                │               └── required_logs
                │                   └── tag input: chips with × delete + "+" add
                └── footer (right-aligned)
                    ├── dirty indicator (only when modified)
                    ├── 取消 button
                    └── 保存 button (disabled while busy / readOnly)
```

All collapse/expand state lives in the editor's local `useState` and resets when the panel switches away and back (driven by the `data` prop change on remount via `useEffect`).

## Data Flow

### Initial load

1. `ContextPanel` mounts `ChapterOutlineEditor` and passes `data = await api.getOutline(projectId)`.
2. `ChapterOutlineEditor` reads `data` → seeds local state via `readOutline(data)` (defensive default `{ chapters: [] }`).
3. `useEffect([data])` re-seeds local state on every parent refetch — this is the same pattern as `NovelOutlineEditor:52-55`, used to keep the form in sync after `onSaved → reloadKey++ → FETCHER → setData`.

### Local edits

Each input handler computes an immutable patch and calls `setOutline(prev => patch)`. No API call. Save state is tracked separately:

- `lastSavedOutline` — set after a successful `updateOutline` (and on initial mount, mirroring the `data` snapshot). A `useMemo` compares `outline !== lastSavedOutline` to derive a `dirty` flag that drives the bottom-right "未保存修改" hint.

### Save

```
user clicks 保存
  → setBusy(true), setError(null)
  → await api.updateOutline(projectId, outline)
    → success: setLastSavedOutline(outline), onSaved() (parent refetches; useEffect re-seeds)
    → failure: setError(e.message); button re-enabled
  → setBusy(false)
```

### Cancel

Reverts to the last `data` snapshot via `setOutline(readOutline(data))`. Identical pattern to `NovelOutlineEditor:70-73`.

## Fields & Edit Semantics

### Always editable (Tier A)

| Field | Where | Input control |
|---|---|---|
| `chapter.title` | chapter row | text input |
| `chapter.theme` | chapter row | textarea, auto-grow (existing `useAutoHeight`) |
| `scene.goal` | scene row | textarea, auto-grow |
| `scene.conflict` | scene row | textarea, auto-grow |
| `scene.emotional_arc` | scene row | textarea, auto-grow |
| `scene.narrative_role` | scene row | `<select>` with the 4 enum values |
| `scene.beat_type` | scene row | text input |

### Editable but folded (Tier B)

| Field | Where | Input control |
|---|---|---|
| `scene.registry_changes.created[]` | inside `<BFieldsAccordion>` | array of {type, id_pattern, description} — row with 3 inputs + delete button |
| `scene.registry_changes.updated[]` | inside `<BFieldsAccordion>` | array of {asset_id, field, new_value} — row with 3 inputs + delete button |
| `scene.required_logs[]` | inside `<BFieldsAccordion>` | tag input — chips with × + add input |

### Never editable

| Field | Reason |
|---|---|
| `chapter_number` | Identity — renaming breaks all references in `progress.json`, `scene-drafts.json`, StoryOS Agent registry |
| `scene_number` | Identity — same as above |

These never appear in any input control. If a user needs to renumber, the workflow is: delete the chapter + add a new one via `+ 新章节` (already supported).

## Error Handling

| Scenario | Behavior |
|---|---|
| `getOutline` 404 | `chapters = []` → empty state hint |
| `getOutline` other error / network | caught silently → same empty state (matches existing `NovelOutlineEditor` policy of not surfacing technical errors) |
| `updateOutline` network / 5xx | error banner above footer; local state preserved; button re-enabled |
| User cancels with dirty changes | discard local state; re-seed from `data` prop |
| `narrative_role` edit | `<select>` constrained to 4 enum values; no free-text path |
| `registry_changes.*` array editing | delete row removes that index; add row appends an empty shape `{ type: "", id_pattern: "", description: "" }` (or `{ asset_id: "", field: "", new_value: "" }`) |
| `required_logs` edit | each tag is a string chip; empty strings are filtered on save (no zero-length chips stored) |
| Empty `scene_plan[]` (chapter with no scenes yet) | render the chapter row with the title/theme editable, scene section replaced with "暂无场景 — 请到 Stage3 重新生成此章节大纲" hint |

## Reused Code

- `useAutoHeight` — for `theme` / `goal` / `conflict` / `emotional_arc` textareas (mirrors `NovelOutlineEditor`)
- `parseVolumes` / `groupChaptersByVolume` — moved to `utils/outline.ts`; imported by both `WorkspacePage` and `ChapterOutlineEditor`
- `BaseEditorProps` — the existing interface shape (no new fields beyond the already-present `readOnly?`)
- Footer / save / cancel button styling — copy from `NovelOutlineEditor:155-170` verbatim
- Empty-state message tone — "尚未生成... — 请到 Stage3..."

## Testing

### New tests in `frontend/src/test/ChapterOutlineEditor.test.tsx`

- Renders loading state when `data === null`
- Renders empty state when `data.chapters = []`
- Renders one chapter row per item in `data.chapters`
- Renders scenes only when the chapter row is expanded (default collapsed)
- Editing `chapter.title` updates local state; no API call
- Editing `scene.goal` updates local state
- `narrative_role` select offers exactly the 4 enum values
- Expanding B-fields accordion reveals `registry_changes` rows; clicking "新增" appends an empty row
- "保存" calls `api.updateOutline` once with the patched `Outline`
- "保存" success path calls `onSaved`; failure shows error banner and keeps state
- "取消" resets local state to the `data` prop
- `readOnly=true` disables every input and the save button; cancel still works
- Re-mount with a different `data` prop (simulating `onSaved → reloadKey → setData`) reseeds local state

### Updates to `frontend/src/test/ContextPanel.test.tsx`

- Snapshot includes the new `chapter-outline` tab
- URL `?panel=chapter-outline` mounts `ChapterOutlineEditor` (assert via new `data-testid="chapter-outline-editor"`)
- readOnly behavior is inherited (banner + save disabled) — same pattern as the existing concept/world/character/outline tests

### No new tests needed for

- `WorkspacePage` — it doesn't change
- `useWorkspacePanel` — adding a string to a `VALID[]` whitelist doesn't justify a test (covered by `ContextPanel` snapshot)

## Out-of-Scope (Future)

- Drag-reorder chapters / scenes
- Diff preview between saved and editing state
- Per-section "重新生成" button (Stage3 already provides this)
- Inline JSON editor for `registry_changes` (current structured form is enough)
- Conflict detection against existing `progress.json` (e.g., warn if a chapter is currently being written and its outline is being edited)