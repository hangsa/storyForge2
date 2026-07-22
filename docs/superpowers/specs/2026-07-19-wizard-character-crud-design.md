# Wizard + Workspace Character Edit / Delete — Design Spec

> **For agentic workers:** This is the design spec. Use `superpowers:writing-plans` to produce the implementation plan from this spec.

**Goal:** Let users delete generated characters and modify every editable field (name, personality layer, voice signature, current state, unknown_to_character, character_type, is_core_character, relations) directly from the initialization wizard's character step AND from the workspace's CharacterEditor — without bouncing to a different surface.

**Architecture:** 2 new backend endpoints (`PATCH /stage2/character/{cid}` for partial update, `DELETE /stage2/character/{cid}` with bidirectional relation cleanup) + 1 new Pydantic model (`CharacterPatch` with all fields optional) + wizard `CharacterStep.tsx` gains inline edit / delete buttons + new `CharacterEditForm.tsx` and `CharacterRelationsEditor.tsx` extracted sub-components + workspace `CharacterEditor.tsx` gains `+ 新建角色` (via existing `POST /stage2/generate-character`) and 🗑️ delete button per card + 1 new test file for the backend endpoints, 1 new test file for the wizard component.

**Tech Stack:** Python 3.9 + FastAPI + pytest, React 18 + TypeScript + Vite + Vitest + React Testing Library. Existing `FileManager.write_json` (atomic), existing `GlassPanel`, existing `api/client.ts`. No new shared dependencies.

---

## Background

Today the wizard's `frontend/src/components/wizard/CharacterStep.tsx` (Stage 2 of the init wizard) auto-generates 6 default characters on mount, displays them as read-only cards, and offers only "add one more of type X" + "regenerate all" + "next step" controls. After clicking "下一步" the user lands in the workspace's right-panel editor (`frontend/src/components/workspace/editors/CharacterEditor.tsx`) which is editable for most fields but **explicitly disowns add/remove** (line 41-46 comment + line 103 hint pointing back to Stage 2). Net effect: there is no path to delete a generated character or correct a misgenerated name once the wizard has advanced — the only escape is "重新生成" which wipes all six.

This spec closes that loop. Two surfaces gain CRUD:

1. **Wizard (`CharacterStep.tsx`)** — primary surface; users should be able to clean up / tune the generated set before advancing to outline.
2. **Workspace (`CharacterEditor.tsx`)** — secondary surface for late-stage edits where the user wants to add a character they thought of mid-chapter, or drop a character that's no longer pulling weight.

The two surfaces share the same backend endpoints; the only divergence is that the workspace's "+ 新建角色" routes through `POST /stage2/generate-character` (existing CharacterDesigner agent call) while the wizard already has characters and doesn't need that path.

---

## Design Decisions (from brainstorming 2026-07-19)

| Decision | Choice | Rationale |
|---|---|---|
| Edit scope in wizard | **All editable fields**, not just the 4 user-named ones | User confirmed full coverage; matches what workspace CharacterEditor already allows; avoids a future "why can I edit X here but not there" complaint |
| Edit interaction | **Inline expand**: card → form in place | User confirmed; reuses existing CharacterEditor form shape; no new modal-routing infrastructure |
| Backend API semantics | **New `PATCH` + new `DELETE` by id** | User confirmed; existing `PUT` (replace-all) stays for "regenerate" flow; `POST generate-character` stays for the agent path. Mirrors REST norms. |
| Relations editing | **Independent sub-form**: list of `{target, status}` rows with add/remove | User confirmed; relations are a dict keyed by id, not a flat field; needs CRUD UI |
| Delete cascade | **Auto-clean dangling relations in other characters' `relations` dict + toast count** | User confirmed; dangling refs break `unknown_to_character` checks downstream; explicit count tells the user what changed |
| Save semantics | **Field-blur PATCH** (debounced 500ms) — no "save" button for individual fields | User confirmed; matches workspace CharacterEditor's existing on-blur save |
| "重新生成" coexistence | **Confirmation modal** that warns the user edits will be wiped | User confirmed; keeps both flows but makes the destructive one explicit |
| Workspace create path | **CharacterDesigner agent** via existing `POST /stage2/generate-character` | User confirmed; consistent with how wizard creates characters; no new "blank character" endpoint needed |
| Workspace delete | Reuse `DELETE /stage2/character/{cid}` | Same endpoint powers both surfaces — single source of truth |
| Character id | Server-assigned, never user-editable | Stable key referenced by relations, chapter drafts, StoryOS registries. Renaming would break dangling refs everywhere. |

---

## Backend

### New Pydantic model: `CharacterPatch`

`backend/models/character.py` — add a sibling to the existing `Character` model:

```python
class CharacterPatch(BaseModel):
    """Partial-update payload for PATCH /stage2/character/{cid}.
    All fields optional; only those present are written."""
    name: Optional[str] = None
    character_type: Optional[str] = None
    is_core_character: Optional[bool] = None
    personality: Optional[Personality] = None
    voice_signature: Optional[VoiceSignature] = None
    current_state: Optional[CharacterCurrentState] = None
    unknown_to_character: Optional[list[str]] = None
    relations: Optional[dict[str, RelationStatus]] = None
```

No `id` (immutable, used as URL key). No `growth_curve` (out of scope for this iteration).

### New endpoint: `PATCH /stage2/character/{character_id}`

`backend/api/stage2_world_char.py`:

1. Validate `character_id` exists in `characters.json` → 404 if not.
2. Locate the matching character in the `characters` array.
3. Merge payload fields into the character dict (Pydantic `.model_dump(exclude_none=True)`).
4. Atomic write back via `fm.write_json("characters.json", data)` (already exists — uses tmp-file replace).
5. Return the updated character dict.

Validation is delegated to Pydantic — invalid `character_type` or out-of-range values trigger 422 via FastAPI's standard envelope.

### New endpoint: `DELETE /stage2/character/{character_id}`

`backend/api/stage2_world_char.py`:

1. Validate `character_id` exists → 404 if not.
2. Compute `cascaded_relation_removals`: number of other characters that had a `relations` entry keyed by `character_id`.
3. Remove those keys from each affected character.
4. Remove the target character from the `characters` array.
5. Atomic write back.
6. Return `{ "deleted_id": ..., "cascaded_relation_removals": N }`.

### Untouched

- `GET /stage2/character` (read full set or one by index)
- `POST /stage2/generate-character` (CharacterDesigner agent append)
- `PUT /stage2/character` (full-set replace — still used by "重新生成")

---

## Frontend — Wizard `CharacterStep.tsx`

### Card display mode (default)

For each character in the list, render the existing read-only card **plus two icon buttons in the top-right corner**:

- ✏️ **编辑** — switches this card to edit mode (see below)
- 🗑️ **删除** — opens delete confirmation modal

### Card edit mode (after clicking ✏️)

The card's content area is replaced by `<CharacterEditForm>` (new component, see below). The card's top-right switches to:

- **完成** — exits edit mode (always succeeds, all changes already autosaved)
- **取消** — exits edit mode; if `isDirty`, show "丢弃未保存的修改？" confirmation

Form field sections, each collapsible but expanded by default for the first edit:

1. **基础信息**: `name` (text), `character_type` (select: 主角/配角/反派/其他), `is_core_character` (checkbox)
2. **人格层 (Personality)**: 5 chip-array inputs (beliefs, desires, fears, values, core_traits) — each is a tag input with add-on-Enter / remove-on-click
3. **声音签名 (Voice Signature)**: `speech_style` textarea, `thought_patterns` textarea, `taboos` chip array
4. **当前状态 (Current State)**: `location`, `physical_condition`, `emotional` textareas, `known_secrets` chip array
5. **角色不知道的事 (unknown_to_character)**: chip array
6. **角色关系 (Relations)**: `<CharacterRelationsEditor>` (new component)

Top of the form shows a status badge: `已同步` / `保存中…` / `保存失败 (重试)`.

### Save behavior

Each input has an `onBlur` handler that, if the value differs from last-saved, fires a PATCH for that single field (or that single nested object for complex fields). Debounced 500ms per field to batch keystrokes.

PATCH failures: keep the local edit, surface a toast + status badge → user can retry by re-blurring.

### Card delete (🗑️)

Opens a confirmation modal:

> **删除「{character.name}」？**
> 将同时清理 **{N}** 个反向关系。
> [取消] [确认删除]

`N` is computed client-side by counting other characters whose `relations` keys include this id. After successful DELETE, the card animates out (150ms fade) and is removed from local state.

### "重新生成" coexistence

The existing "重新生成" button now opens a confirmation modal:

> **重新生成所有角色？**
> 现有 **{N}** 个角色（包含你的编辑）将被覆盖，无法恢复。
> [取消] [确认重新生成]

Confirmation calls the existing `PUT /stage2/character` path. No backend changes.

### New component: `CharacterEditForm.tsx`

`frontend/src/components/wizard/CharacterEditForm.tsx`

Props:
```ts
{
  character: Character;
  projectId: string;
  allCharacters: Character[];   // for relations target picker
  onComplete: (updated: Character) => void;
  onCancel: (discarded: boolean) => void;
}
```

Internal state: local copy of `character`, `dirtyFields: Set<string>`, `saveStatus: 'idle' | 'saving' | 'error'`.

Extracted from `CharacterEditor.tsx`'s existing per-card form (lines 117-198 of that file are the precedent), so the two surfaces stay visually consistent.

### New component: `CharacterRelationsEditor.tsx`

`frontend/src/components/wizard/CharacterRelationsEditor.tsx`

Props:
```ts
{
  relations: Record<string, RelationStatus>;
  allCharacters: Character[];
  selfId: string;
  onChange: (next: Record<string, RelationStatus>) => void;
}
```

Renders a list of rows. Each row: `[disabled: target name] · [status select] · [🗑️]`. Bottom button `+ 添加关系` opens a popover with a `<select>` of remaining characters + a `status` text input. Self cannot be selected as a target. Save fires when relations dict changes (PATCH the whole `relations` field — smaller than tracking per-row blur).

---

## Frontend — Workspace `CharacterEditor.tsx`

### Add controls

- Top-right of the panel: `+ 新建角色` button. Click → calls existing `api.generateCharacter(projectId)` (uses `POST /stage2/generate-character`) → on success, appends the new character to local list AND switches the new card to edit mode (so the user can immediately refine what the agent produced). Reuses the same `<CharacterEditForm>` from the wizard.
- Per-card 🗑️ button: identical behavior to wizard — opens delete modal, calls `DELETE /stage2/character/{cid}`.

### Remove old boundary

- Delete the comment at `frontend/src/components/workspace/editors/CharacterEditor.tsx:41-46` (the "intentionally out of scope" block).
- Delete the hint at line 103 ("详细增删请到 Stage2").

### Save path stays as-is

`CharacterEditor.tsx` currently PUTs the full set on save. No change there — existing PUT continues to work. The new PATCH path is for fine-grained per-card edits inside the wizard; the workspace's "save all" button remains a single PUT.

---

## API Client Additions

`frontend/src/api/client.ts`:

```ts
patchCharacter(projectId: string, characterId: string, patch: Partial<Character>): Promise<Character>
deleteCharacter(projectId: string, characterId: string): Promise<{ deleted_id: string; cascaded_relation_removals: number }>
```

---

## File-by-file change list

**New:**
- `frontend/src/components/wizard/CharacterEditForm.tsx`
- `frontend/src/components/wizard/CharacterRelationsEditor.tsx`
- `frontend/src/components/wizard/__tests__/CharacterStep.test.tsx`
- `frontend/src/components/wizard/__tests__/CharacterEditForm.test.tsx`
- `frontend/src/components/workspace/editors/__tests__/CharacterEditor.test.tsx` (additions only — file may already exist; if not, create it)
- `tests/test_stage2_character_crud.py`

**Modified — backend:**
- `backend/models/character.py` — add `CharacterPatch`
- `backend/api/stage2_world_char.py` — add `PATCH` and `DELETE` handlers + `cascaded_relation_removals` accounting + 404 envelope

**Modified — frontend:**
- `frontend/src/components/wizard/CharacterStep.tsx` — add ✏️ / 🗑️ icons, edit-mode toggle, "重新生成" confirmation
- `frontend/src/components/workspace/editors/CharacterEditor.tsx` — add `+ 新建角色` button + 🗑️ per card; remove old boundary comments
- `frontend/src/api/client.ts` — add `patchCharacter` + `deleteCharacter`

---

## Test Plan

### Backend — `tests/test_stage2_character_crud.py` (new)

| Case | Expectation |
|---|---|
| `test_patch_single_field` | PATCH `{"name": "新名"}` updates only that field; other fields unchanged |
| `test_patch_nested_field` | PATCH `{"personality": {"core_traits": ["x"]}}` merges into existing personality dict, preserves other personality keys |
| `test_patch_unknown_id_404` | PATCH a non-existent id returns 404 with our error envelope |
| `test_patch_invalid_character_type_422` | PATCH `{"character_type": "bogus"}` returns 422 |
| `test_delete_removes_character` | DELETE removes from `characters` array; subsequent GET omits it |
| `test_delete_cascades_relations` | Delete character A; other characters' `relations` dict no longer contain key `A.id`; response reports correct `cascaded_relation_removals` count |
| `test_delete_unknown_id_404` | DELETE non-existent id returns 404 |
| `test_delete_no_cascade_when_no_inbound_relations` | Response `cascaded_relation_removals` = 0 |
| `test_atomic_write_on_patch_failure` | If Pydantic validation fails after partial merge, file is NOT corrupted (regression for the atomic write path) |

### Frontend — `frontend/src/components/wizard/__tests__/CharacterStep.test.tsx` (new)

| Case | Expectation |
|---|---|
| `test_renders_six_default_cards` | After mount, 6 cards rendered with names from mock fixture |
| `test_click_edit_enters_edit_mode` | Clicking ✏️ swaps card content for `<CharacterEditForm>` |
| `test_edit_form_field_blur_fires_patch` | Mock client; type new name; blur; expect `patchCharacter` called with `{ name: ... }` |
| `test_edit_form_save_failure_shows_badge` | Mock client returns 500; badge shows "保存失败" |
| `test_click_delete_opens_confirmation_modal` | Clicking 🗑️ opens confirmation modal showing character name + cascade count |
| `test_confirm_delete_calls_api_and_removes_card` | Click confirm; DELETE fired; card removed from list |
| `test_regenerate_button_shows_confirmation` | Click regenerate; confirmation modal with count; confirm calls PUT |
| `test_regenerate_button_cancel_does_not_call_put` | Click cancel in confirmation; no PUT issued |

### Frontend — `frontend/src/components/wizard/__tests__/CharacterEditForm.test.tsx` (new)

| Case | Expectation |
|---|---|
| `test_chip_array_add_and_remove` | Type into chip input + Enter → chip appears; click chip → removed; PATCH fired with new array |
| `test_relations_subform_add_remove` | Click `+ 添加关系` → pick target → status → row added; click row's 🗑️ → row removed; PATCH fired |
| `test_relations_self_not_selectable` | Target picker excludes the character being edited |
| `test_dirty_cancel_shows_confirmation` | Type new value; click cancel; "丢弃未保存修改？" modal appears |

### Frontend — `CharacterEditor.test.tsx` (workspace)

If the file exists, add cases. If not, create with these:

| Case | Expectation |
|---|---|
| `test_new_character_button_appends_card` | Click `+ 新建角色` → mock `generateCharacter` returns char → card appears + auto-enters edit mode |
| `test_delete_button_per_card` | Click 🗑️ → modal → confirm → DELETE fired → card removed |

### Manual smoke (post-implementation)

1. `uvicorn backend.main:app --reload --port 8000` + `npm run dev`
2. Create a new project → wizard Stage 2
3. Edit one character's name → blur → refresh page → name persists
4. Add a relation between two characters → save → refresh → relation persists
5. Delete character A → confirm modal shows "1 个反向关系" → confirm → other characters' relations to A are gone
6. Click "重新生成" → confirmation shows → cancel → no destruction
7. Advance to Stage 3 → outline generation uses updated names (verify in `progress.json` or similar)

---

## Out of scope (follow-ups)

- Per-row relation history editing (`relations[X].history` stays read-only — user can see but not edit past events)
- Bulk operations (multi-select delete, batch rename)
- Character `growth_curve` editing in the wizard (stays in Growth Workshop)
- Drag-to-reorder characters
- Avatar / portrait upload
- Cross-project character templates ("use Lin Feng from project X as starting point")

---

## Risk register

| Risk | Mitigation |
|---|---|
| PATCH race condition if user edits two cards simultaneously | Each card PATCHes its own id; backend serializes per-file write via tmp-file atomic replace. Worst case: last writer wins per field. Acceptable for single-user wizard flow. |
| `cascaded_relation_removals` undercount if relations dict uses string-id but actual character.id is a number | Existing model is `dict[str, RelationStatus]` (string keys). Confirmed by `RelationStatus` model + existing `unknown_to_character` checks. |
| User deletes a `is_core_character` while outline already references it by name | Outline uses character `name` (string), not id. After deletion + refresh, outline re-resolution will skip the missing character and the user can re-link. Acceptable for v1.9. |
| 500ms debounce interferes with rapid Tab navigation | Field blur is the trigger, not keystroke. Tab triggers blur → debounce starts. Worst case 500ms delay before PATCH. Acceptable. |
| `CharacterEditForm.tsx` drifts from `CharacterEditor.tsx`'s inline form | Both render the same field shape; on extraction, treat `CharacterEditForm` as canonical and refactor `CharacterEditor` to use it for per-card rendering too (future cleanup task). |

---

## Migration / rollout

Pure additive — no schema migration needed. New endpoints coexist with the existing 4 stage2 endpoints. Frontend additions don't change existing behavior unless the user clicks the new buttons.

Suggested commit split (atomic per commit):

1. `feat(models): add CharacterPatch Pydantic model`
2. `feat(api): PATCH/DELETE /stage2/character/{id} with relation cascade`
3. `test(api): stage2 character CRUD + cascade coverage`
4. `feat(wizard): CharacterEditForm + CharacterRelationsEditor extracted components`
5. `feat(wizard): inline edit + delete on character cards + regenerate confirmation`
6. `feat(workspace): add/delete buttons on CharacterEditor (boundary removed)`
7. `test(wizard): CharacterStep + CharacterEditForm coverage`
8. `test(workspace): CharacterEditor add/delete coverage`
