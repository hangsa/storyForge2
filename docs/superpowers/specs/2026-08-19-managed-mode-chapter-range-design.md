# Managed Mode — Chapter Range Configuration

Date: 2026-08-19
Status: Draft (awaiting user review)

## Problem

`ManagedStartConfig.scope` only accepts two values today: `"all_planned"` (every chapter in `outline.json`) and `"next_chapter"` (the single chapter pointed to by `progress.current_chapter`). Users who want to write the next 10 chapters, or regenerate chapters 5–10, have no UI affordance — they get the all-or-nothing choice.

This is also a workflow gap: there is no way to **regenerate** an already-completed chapter via the autopilot. Today, completed chapters are silently skipped (`autopilot_runner_async.py:281-289`), so if a user dislikes a finished chapter they have to manually delete the draft file and edit `progress.json` by hand.

## Goal

Add chapter range configuration to the managed mode start flow:

1. Users can configure `start_chapter` and `end_chapter` for the session.
2. Default range is `[latest_completed + 1, min(start + 10, outline_max)]` — sensible continuation, not regen-by-default.
3. Validation rejects `end < start`, `start < 1`, `end > outline_max`, `start > outline_max`.
4. Chapters in the range whose `status ∈ DONE_STATUSES` get **regenerated**: progress reset, drafts cleared, queue entries removed and re-seeded.

Out of scope (deferred):
- Live-editing the range mid-run (start session → change range without restart).
- Per-scene or per-arc range selection (range is always full chapters).
- Migrating `scope="next_chapter"` in any persisted state (none exists — `cfg` is per-session).

## Design

### Config shape

`backend/models/autopilot_session.py:43-50` — `ManagedStartConfig`:

```python
class ManagedStartConfig(BaseModel):
    scope: Literal["all_planned", "range"] = "range"
    start_chapter: Optional[int] = None   # required when scope="range"
    end_chapter: Optional[int] = None     # required when scope="range"
    cadence: Literal["fast", "balanced", "careful"] = "balanced"
    policy: Literal["auto", "ask"] = "auto"
    notify: Literal["all", "milestones"] = "milestones"

    @model_validator(mode="after")
    def _validate_range(self):
        if self.scope != "range":
            return self
        if self.start_chapter is None or self.end_chapter is None:
            raise ValueError("scope='range' requires both start_chapter and end_chapter")
        if self.start_chapter < 1:
            raise ValueError("start_chapter must be >= 1")
        if self.end_chapter < self.start_chapter:
            raise ValueError("end_chapter must be >= start_chapter")
        return self
```

The `start > outline_max` and `end > outline_max` checks happen on the backend at session-start time (against the loaded `outline.json`) and in a preview endpoint — not in the Pydantic model, since `outline_max` is project-specific state, not a config invariant.

`scope="next_chapter"` is removed. This is a breaking change for any external caller; verified by grep that the only construction paths are `ManagedStartModal.tsx` and tests, both updated in this spec.

### Latest-completed calculation

```python
def find_latest_completed_chapter(progress: dict, outline: dict) -> Optional[int]:
    """Return the highest chapter_number whose every scene in the outline's
    scene_plan is in DONE_STATUSES. None if no chapter is fully done."""
    outline_by_num = {c.get("chapter_number"): c for c in (outline.get("chapters") or [])}
    progress_by_num = {
        ch.get("chapter_number"): ch for ch in (progress.get("chapters") or [])
    }
    completed = []
    for ch_num, outline_ch in outline_by_num.items():
        ch_progress = progress_by_num.get(ch_num, {})
        planned = outline_ch.get("scene_plan", []) or []
        if not planned:
            continue
        if is_chapter_complete(ch_progress.get("scenes", []) or [], planned):
            completed.append(ch_num)
    return max(completed) if completed else None
```

This reuses `is_chapter_complete()` (`autopilot_runner_async.py:112-134`) so the "done" definition stays in one place.

### Default range computation

```python
def compute_range_defaults(outline_max: int, latest_completed: Optional[int]) -> tuple[int, int]:
    start = (latest_completed or 0) + 1   # 1 if nothing completed yet
    end = min(start + 10, outline_max)
    return start, end
```

Edge cases:
- `outline_max == 0` → caller should refuse (`scope="range"` is meaningless; force `scope="all_planned"` or return 422). The preview endpoint returns `valid=False, error="没有章节大纲，请先生成"`.
- `latest_completed == outline_max` → start = outline_max + 1, end = outline_max. Invalid → preview endpoint returns `valid=False, error="所有章节已完成"`.
- `outline_max` small (e.g. 3, nothing completed) → start=1, end=3. Range covers the whole outline.

### Regeneration semantics

When `start ≤ ch ≤ end` and `is_chapter_complete(...)` is true for that chapter:

1. **Reset `progress.json`** — chapter entry `status` → `"pending"`; all scenes `status` → `"pending"`, `retry_count` → `0`, `coherence_score` → null. Don't touch `reader_os` — the metrics are recomputed on next archival.
2. **Clear drafts** — delete `projects/<id>/chapters/ch{NN}_scene_*.md` files for that chapter. `chapters/` directory is flat (verified: `ls proj_1a7d7fcf/chapters/` shows top-level `ch01_scene_001_draft.md`, etc.).
3. **Remove matching queue items** — drop any `write-{ch}-{scene}` from `session.json` queue that belongs to the regenerated chapter. This is critical: existing dedup logic (`autopilot_runner_async.py:266-293`) would otherwise block re-seeding because the queue still has the old items.
4. **Re-enqueue** — call `mgr.add_queue(write-{ch}-{scene})` for every scene in the chapter's `scene_plan` (deterministic ids so the queue stays consistent with the regular path).
5. **Sync checkpoint** — read `.storyforge_checkpoint.json` and remove any entries whose `chapter_number == ch` so the next checkpoint write doesn't carry stale "completed" status.

Helper (lives in `backend/conductor/autopilot_runner_async.py`):

```python
def regenerate_chapter(project_id: str, mgr: "AutopilotSessionManager",
                       chapter_number: int, scene_plan: list) -> None:
    """Reset progress, clear drafts, drop queue items, re-enqueue."""
    reset_chapter_progress(project_id, chapter_number)
    clear_chapter_drafts(project_id, chapter_number)
    drop_chapter_queue_items(mgr, chapter_number)
    enqueue_chapter_scenes(mgr, chapter_number, scene_plan)
    sync_checkpoint_for_chapter(project_id, chapter_number)
```

`scope="all_planned"` runs the same regen check over `[1, outline_max]`. The UI surfaces the regen warning + confirmation dialog identically for both scopes — a session that picks "all_planned" while some chapters are done is also implicitly asking for regeneration.

### Backend runner changes

`backend/conductor/autopilot_runner_async.py`:

- `_enqueue_for_scope` (lines 243-300) gets refactored to accept a pre-computed `target_chapters: list[int]` instead of a `target_scope: str` + `current_chapter` pair. The `scope == "next_chapter"` branch and the `seed_queue` fallback for `next_chapter` (lines 222-235) are removed.
- `seed_queue` (lines 175-240) computes the target chapter list based on `cfg.scope` + `cfg.start_chapter`/`end_chapter`, then delegates to `_enqueue_for_scope(target_chapters)`. Before `_enqueue_for_scope` runs, it calls `regenerate_chapter(...)` on every chapter in `[start, end]` whose status is in `DONE_STATUSES`. For `scope="all_planned"`, the same logic runs over `[1, outline_max]`.

`backend/api/autopilot.py`:

New preview endpoint:

```python
@router.get("/projects/{project_id}/managed/range-preview")
def range_preview(
    project_id: str,
    start: int = Query(...),
    end: int = Query(...),
) -> dict:
    # Loads outline.json, progress.json.
    # Returns:
    # {
    #   "outline_max": int,
    #   "valid": bool,
    #   "error": str | None,
    #   "regenerate_chapters": [int, ...],   # ch nums that will be reset
    #   "defaults": { "start_chapter": int, "end_chapter": int },  # suggested defaults
    # }
```

The frontend calls this on every (debounced) input change to render the live preview.

`POST /session/start` body validates via the new Pydantic `ManagedStartConfig`. If `scope="range"` and `outline_max == 0`, returns `422` with `error="没有章节大纲，请先生成"`.

### Frontend changes

`frontend/src/components/workspace/ManagedStartModal.tsx`:

- Default scope selector switches from `all_planned` to `range` (more useful — users opening this modal want to push the novel forward).
- New fields under `scope === "range"`: two number inputs (`start_chapter`, `end_chapter`) with `min={1}`, `max={outline_max}`.
- Live preview: on input change (300 ms debounce), fetch `GET /managed/range-preview?start=X&end=Y`. Render one of:
  - Validation error (red text)
  - "⚠ 将重生第 X–Y 章（N 章已完成）" (orange text)
  - No banner (range is all-fresh work)
- Submit: if `regenerate_chapters.length > 0`, open a confirmation dialog (`ManagedStartConfirmDialog`) before calling `POST /session/start`. Dialog text: "您即将重新生成以下章节：[X, Y, ...]。这些章节的现有内容将被覆盖，无法撤销。是否继续？"
- Same preview + confirmation flow applies when `scope === "all_planned"` if any chapters in `[1, outline_max]` are done.

`frontend/src/hooks/useAutopilotConfig.ts:8` — `MANAGED_START_DEFAULTS`:

```ts
{
  scope: "range" as const,
  start_chapter: null,
  end_chapter: null,
  cadence: "balanced" as const,
  policy: "auto" as const,
  notify: "milestones" as const,
}
```

`frontend/src/api/autopilot.ts` — add `rangePreview(projectId, start, end)` returning the preview shape.

### Frontend confirmation dialog

`frontend/src/components/workspace/ManagedStartConfirmDialog.tsx` — new file, ~50 lines. Uses the existing project dialog primitive (no new UI dependencies). Props: `{ open, onConfirm, onCancel, chapterNumbers: number[] }`.

## Data Flow

### Write path (scope="range")

```
User clicks "启动托管" in cockpit
  ↓
ManagedStartModal opens (default scope="range", start/end computed by preview endpoint)
  ↓ User edits
GET /managed/range-preview?start=5&end=15 (debounced)
  ↓ Backend returns:
{
  outline_max: 20,
  valid: true,
  error: null,
  regenerate_chapters: [5, 6, 7, 8],   # ch5-8 already done
  defaults: { start: 11, end: 20 },   # last_completed was 10
}
  ↓
UI renders: "⚠ 将重生第 5–8 章（4 章已完成）"
  ↓ User clicks "启动"
ManagedStartConfirmDialog opens: "您即将重新生成第 5–8 章..."
  ↓ User confirms
POST /session/start {scope:"range", start_chapter:5, end_chapter:15, ...}
  ↓ ensure() → seed_queue():
  - For ch5,6,7,8 (DONE_STATUSES): regenerate_chapter() →
    reset progress, clear drafts, drop queue items, re-enqueue, sync checkpoint
  - For ch9-15 (pending): enqueue_chapter_scenes() only
  ↓
AsyncAutopilotRunner starts consuming the queue
```

### Read path (unchanged for completed scenes)

`get_effective` and `get_override_only` continue to merge arbitrary dict keys (`PromptEditPanel`-style code is unrelated). `progress.json` schema is unchanged.

### Existing `scope="next_chapter"` callers

Verified by grep: the only construction sites of `ManagedStartConfig` with `scope="next_chapter"` are:
- `frontend/src/components/workspace/ManagedStartModal.tsx` — UI, updated.
- `tests/test_autopilot_*.py` — tests, updated to use `scope="range"`.

No persisted state ever references the string `"next_chapter"` outside an in-memory `ManagedStartConfig`, so no migration needed.

## Error Handling

| Scenario | Behavior |
|---|---|
| `outline.json` missing or has 0 chapters | Preview returns `valid=False, error="没有章节大纲，请先生成"`. Modal disables Start. POST /session/start returns 422. |
| `start < 1` | Pydantic 422 with Pydantic-style detail. |
| `end < start` | Pydantic 422. |
| `start > outline_max` or `end > outline_max` | Preview returns `valid=False`. POST returns 422 if user bypasses modal (defensive). |
| Range is entirely completed | Preview shows no regen warning (no fresh work). POST succeeds with empty queue → runner hits `no_work_to_do` (existing path). |
| User cancels confirmation dialog | Dialog closes, modal stays open, no API call. |
| Regeneration hits a mid-flight runner | `/session/start` already refuses when session is `RUNNING` (existing behavior). User must Stop first. |
| `progress.json` / `outline.json` missing or malformed | Existing error paths in `ensure()` apply — same as `next_chapter` did. |
| Draft file deletion fails (perm denied) | `clear_chapter_drafts` logs warning, continues. The runner will overwrite on next write — stale content is benign because the next write replaces the file atomically. |

## Testing

### Backend (`tests/test_managed_range.py`)

| Test | Asserts |
|------|---------|
| `test_compute_range_defaults_with_completed_chapters` | `(latest_completed=7, outline_max=20)` → `(8, 18)` |
| `test_compute_range_defaults_no_completed` | `(None, 20)` → `(1, 11)` |
| `test_compute_range_defaults_outline_smaller` | `(None, 5)` → `(1, 5)` (end clamped) |
| `test_find_latest_completed_returns_max` | progress has ch1-7 done, ch8 partial, ch9 no scenes → `7` |
| `test_find_latest_completed_with_gaps` | ch1 done, ch2 partial, ch3 done → still returns `3` (max, not consecutive) |
| `test_regenerate_chapter_resets_progress` | After call, progress.json chapter + all scenes status=pending, retry_count=0 |
| `test_regenerate_chapter_clears_drafts` | Files matching `ch{NN}_*.md` removed; other chapters' drafts untouched |
| `test_regenerate_chapter_drops_queue_items` | Queue before: 3 items for ch5; after: empty for ch5 |
| `test_regenerate_chapter_reenqueues` | Queue after regen: one item per scene in outline's scene_plan |
| `test_regenerate_chapter_syncs_checkpoint` | `.storyforge_checkpoint.json` has no entry for `chapter_number=N` |
| `test_seed_queue_range_no_completed` | scope=range, range [8,12], all chapters pending → all scenes enqueued |
| `test_seed_queue_range_with_completed` | scope=range, range [5,10], ch5-7 done → regen for 5-7, plain enqueue for 8-10 |
| `test_seed_queue_all_planned_with_completed` | scope=all_planned, ch1-3 done → regen for 1-3, plain enqueue for 4+ |
| `test_seed_queue_next_chapter_branch_removed` | Next_chapter scope is no longer accepted (raises ValueError or 422) |
| `test_range_preview_endpoint` | Returns `{outline_max, valid, regenerate_chapters, defaults}` correctly |
| `test_range_preview_invalid_range` | start=0, end=20 → `valid=False, error=...` |
| `test_managed_start_config_pydantic_validation` | scope=range without start/end → ValidationError; end < start → ValidationError; start < 1 → ValidationError |

### Frontend (`ManagedStartModal.test.tsx`)

| Test | Asserts |
|------|---------|
| `test_default_scope_is_range` | Modal opens with `range` radio selected |
| `test_scope_radio_toggles_inputs` | Selecting "all_planned" hides start/end inputs; selecting "range" shows them |
| `test_input_change_triggers_preview` | Typing in end input debounces → calls `GET /range-preview` |
| `test_preview_warning_shown_when_completed_in_range` | Mock preview returns regenerate_chapters=[5,6] → modal shows "⚠ 将重生第 5–6 章" |
| `test_preview_error_shown_for_invalid_range` | Mock preview returns valid=False → modal shows error text, Start disabled |
| `test_no_warning_when_no_completed_in_range` | Mock returns regenerate_chapters=[] → no warning banner |
| `test_start_button_opens_confirmation_when_regen_needed` | Click Start with regen_chapters.length > 0 → confirm dialog opens |
| `test_start_skips_confirmation_when_no_regen` | Click Start with empty regen_chapters → confirm dialog does NOT open, POST fires |
| `test_cancel_in_dialog stays in modal` | Cancel → dialog closes, no POST |
| `test_confirm_in_dialog fires POST` | Confirm → POST /session/start with the configured payload |
| `test_all_planned_with_completed_shows_warning` | scope=all_planned + some completed → same warning + confirmation flow |

## Files Touched

```
backend/models/autopilot_session.py            # ManagedStartConfig schema + validator
backend/conductor/autopilot_runner_async.py    # helpers + seed_queue refactor
backend/api/autopilot.py                       # new /range-preview endpoint
backend/conductor/checkpoint.py                # checkpoint sync helper
tests/test_managed_range.py                    # new ~25 tests
frontend/src/components/workspace/ManagedStartModal.tsx
frontend/src/components/workspace/ManagedStartConfirmDialog.tsx   # new
frontend/src/hooks/useAutopilotConfig.ts       # default scope
frontend/src/api/autopilot.ts                  # rangePreview() client
frontend/src/test/ManagedStartModal.test.tsx   # extended
frontend/src/test/ManagedStartConfirmDialog.test.tsx  # new
```

~11 files, 1 commit. No new dependencies.

## Risks

- **Breaking change**: `scope="next_chapter"` removed. Mitigated by updating the only 2 known callers (frontend modal + tests). No persisted state contains the literal value.
- **Regeneration is destructive**: completed chapters' drafts are deleted. Mitigated by the two-step confirmation (live preview warning + click-to-confirm dialog).
- **Checkpoint race**: between `regenerate_chapter` (which removes the chapter's checkpoint entries) and the next checkpoint write, the runner might read stale data. Mitigated by checkpoint read paths preferring `progress.json` for status checks (verified: `checkpoint.py:70-79` reads `progress.get("current_chapter")` — already prefers live progress).
- **`current_chapter` pointer doesn't auto-reset**: if user regenerates ch5 while `progress.current_chapter=9`, the pointer stays at 9. Regenerating doesn't move it back. This is intentional — the runner doesn't depend on `current_chapter` once `scope` is no longer `next_chapter`. Pointer is only consulted by `_advance_chapter` for sequential writes in single-chapter flows.
- **Two scope modes**: keeping both `all_planned` and `range` adds some code, but `all_planned` is the obvious "cover everything" affordance that fits workflows like "start from scratch with full regeneration." Worth the small extra surface.