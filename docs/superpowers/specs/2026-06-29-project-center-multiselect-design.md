# T?.?? Project Center Multi-select, Search, Bulk Delete — Design Spec

> **For agentic workers:** This is the design spec. Use `superpowers:writing-plans` to produce the implementation plan from this spec.

**Goal:** Let users search the project center by name, select multiple projects, and delete them in one transaction.

**Architecture:** 1 new backend endpoint + 4 new state slots + 2 inline UI additions (search box, mode toggle) in `ProjectListPage` + 1 floating bulk-action toolbar (only visible in select mode) + 1 expanded bulk-delete confirmation modal. No new shared components, no new pages.

**Tech Stack:** Python 3.9 + FastAPI + pytest, React 18 + TypeScript + Vite + Vitest + React Testing Library. Material Symbols Outlined icons. Existing `GlassPanel`, existing `api/client.ts`, existing `FileManager`.

---

## Background

`ProjectListPage` is a 3-column grid of project cards. Each card has a hover-revealed delete button that opens a single-project delete confirmation modal. With 900+ projects (most test fixtures from earlier development), manually deleting them one by one is impractical.

Three capabilities are missing:
1. **Multi-select** — no way to mark several projects at once
2. **Name search** — no way to narrow the grid
3. **Bulk delete** — only single-project delete exists

`backend/api/project.py` already has `GET /api/project/list` and `DELETE /api/project/{project_id}`. `FileManager.delete_project` is the existing single-project deletion primitive (uses `shutil.rmtree`).

## Design Decisions (from brainstorming 2026-06-29)

| Decision | Choice | Rationale |
|---|---|---|
| Bulk delete transport | New `POST /api/project/bulk-delete` | One semantic unit, atomic, server can add auth/limits later; sequential loops from client would fragment the operation |
| Search implementation | Pure client-side filter (lowercase `includes`) | ~900 items is trivial to filter; avoids a server round-trip per keystroke; trivial to migrate to server later if count grows past ~5K |
| Multi-select mode | Explicit mode toggle (default = navigate) | Doesn't pollute the default UX with checkboxes; standard pattern in admin tables; one click to enter, one click to exit |
| Delete confirmation | Modal listing every selected title + count | User sees exactly what will be deleted; matches existing single-delete modal style |
| "Select all" semantics | Select all currently *visible* (post-search) | Matches user mental model — they're working with the filtered set, not the full 900 |
| On partial bulk-delete failure | Keep selection state, surface failures, only remove successes from local list | User can retry the failed ones without re-selecting everything |
| Mode toggle position | Header right, next to "新建项目" | Visible without scrolling; primary action zone |

---

## Backend

### New endpoint: `POST /api/project/bulk-delete`

In `backend/api/project.py`, added to the existing router:

```python
@router.post("/bulk-delete")
async def bulk_delete_projects(data: dict):
    ids = data.get("project_ids")
    if not isinstance(ids, list) or not ids:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "VALIDATION_ERROR",
                "message": "project_ids 必须是非空数组",
                "detail": {},
            },
        )

    deleted: list[str] = []
    failed: list[dict] = []
    for pid in ids:
        if not isinstance(pid, str) or not pid:
            failed.append({"id": str(pid), "error": "invalid_id"})
            continue
        try:
            if not fm.project_exists(pid):
                failed.append({"id": pid, "error": "not_found"})
                continue
            fm.delete_project(pid)
            deleted.append(pid)
        except Exception as e:
            failed.append({"id": pid, "error": str(e)})

    return {
        "error": False,
        "code": "OK",
        "message": f"已删除 {len(deleted)} 个，失败 {len(failed)} 个",
        "detail": {
            "deleted": deleted,
            "failed": failed,
            "deleted_count": len(deleted),
            "failed_count": len(failed),
        },
    }
```

- Always returns 200 when the request body itself is well-formed; per-item success lives in `detail.deleted` / `detail.failed`
- Returns 400 only for malformed body (missing/non-list `project_ids`, or empty list)
- Reuses existing `FileManager` — no new filesystem code

### Tests (`tests/test_project_bulk.py`, new file)

- All IDs exist → `deleted_count` matches, filesystem confirms dirs are gone
- Mixed (some exist, some not) → `deleted` contains the existing ones, `failed` lists the rest with `error: "not_found"`
- All IDs missing → `deleted` empty, `failed` lists all
- Empty list → 400 with `VALIDATION_ERROR`
- `project_ids` not a list (string, dict, null) → 400
- `project_ids` contains non-string items → that item lands in `failed` with `error: "invalid_id"`, valid siblings still succeed
- One ID triggers an unexpected exception (mock `FileManager.delete_project` to raise) → that ID in `failed` with the exception message, others still succeed

---

## Frontend

### State additions in `ProjectListPage`

```ts
const [selectMode, setSelectMode] = useState(false);
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
const [searchQuery, setSearchQuery] = useState("");
const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
const [bulkDeleting, setBulkDeleting] = useState(false);
```

Derived value:

```ts
const visibleProjects = useMemo(() => {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return projects;
  return projects.filter((p) => p.title.toLowerCase().includes(q));
}, [projects, searchQuery]);
```

The grid renders `visibleProjects` instead of `projects`. The existing empty state, loading state, and count display all key off `visibleProjects.length`. When `searchQuery` is non-empty and the filter is active (so `visibleProjects.length < projects.length`), a small right-aligned hint above the grid reads `"N 个匹配项 / 共 M 个"` (e.g. `"23 个匹配项 / 共 917 个"`) so the user knows the list is filtered and how aggressively. When the search yields zero results, the existing empty-state block is reused with a "无匹配项目" headline and a "清空搜索" button that resets `searchQuery`.

### API client addition

In `frontend/src/api/client.ts`, in the same `api` object that already exposes `listProjects` / `deleteProject`:

```ts
bulkDeleteProjects: (projectIds: string[]) =>
  request<BulkDeleteResult>(
    "POST",
    "/project/bulk-delete",
    { project_ids: projectIds },
  ),
```

New exported type:

```ts
export interface BulkDeleteResult {
  deleted: string[];
  failed: { id: string; error: string }[];
  deleted_count: number;
  failed_count: number;
}
```

### Header layout (replaces the right side of the existing header)

```
+---------------------------------------------+
|  StoryForge / 项目中心              [🔍 输入框] [☐ 多选] [+] 新建项目  |
+---------------------------------------------+
```

- Search input: 240px wide, `type="search"` (so the browser provides a native clear-X for free), magnifier icon on the left, `placeholder="搜索项目名称"`, controlled by `searchQuery`. No submit button — filter is live on every keystroke. Clearing the field (via X or Escape) restores the full list immediately.
- Mode toggle button: uses `check_box` / `check_box_outline_blank` icon, label switches between "多选" and "退出多选". When `selectMode` is on, the button gets the primary-container accent border.
- "新建项目" stays exactly where it is.

### Card behavior in select mode

- Each card's top-left corner shows a checkbox (`check_box` / `check_box_outline_blank` icon) — only rendered when `selectMode` is true. When unchecked, the icon is at 50% opacity; on hover it goes to 100%.
- Clicking the checkbox toggles the project ID in `selectedIds`.
- Clicking anywhere else on the card (the existing "navigate to project" button) **does not** navigate; it instead toggles selection. The existing navigate button is suppressed in select mode.
- A selected card gets a `border-primary-container` ring (reuses the existing hover style, made permanent while selected).

### Floating bulk-action toolbar (only visible when `selectMode` is true and `selectedIds.size > 0`)

Sticky to the top of the grid container, slides down with a 150ms transition:

```
[✕ 取消多选]  已选 5 / 917 项   |   [☑ 全选可见] [☐ 全不选]   |   [🗑 批量删除 (5)]
```

- "取消多选" exits select mode and clears `selectedIds`
- "全选可见" replaces `selectedIds` with `new Set(visibleProjects.map(p => p.id))`
- "全不选" sets `selectedIds` to `new Set()`
- "批量删除 (N)" opens the bulk delete modal, disabled when N=0 (defense in depth — toolbar is hidden in that case anyway)

### Bulk delete confirmation modal

Reuses the existing single-delete modal's red-bordered shell (`border-error/30`). Body changes:

- Header icon + title: `🗑 批量删除 N 个项目`
- Subtitle: "将永久删除以下项目及其所有数据（概念、大纲、章节、模拟记录），此操作不可撤销"
- Scrollable list (max-h-60 overflow-y-auto) of every selected project: each row shows the title in `font-display` and the stage label using the existing `STAGE_COLORS`/`STAGE_LABELS` map. If the list is very long (>20), truncate to 20 with "+ N 项未显示" footer.
- Footer: `取消` (text-style, secondary) / `确认删除` (red, primary), with `bulkDeleting` spinner state on the confirm button.

### Bulk delete handler

```ts
const handleBulkDeleteConfirm = async () => {
  if (selectedIds.size === 0) return;
  setBulkDeleting(true);
  try {
    const ids = Array.from(selectedIds);
    const result = await api.bulkDeleteProjects(ids);
    setProjects((prev) => prev.filter((p) => !result.deleted.includes(p.id)));
    if (result.failed.length === 0) {
      // full success — exit select mode
      setSelectMode(false);
      setSelectedIds(new Set());
      setShowBulkDeleteModal(false);
    } else {
      // partial failure — keep selection mode, prune selection to failed only
      const failedIds = new Set(result.failed.map((f) => f.id));
      setSelectedIds(failedIds);
      setShowBulkDeleteModal(false);
      setError(
        `已删除 ${result.deleted_count} 个，${result.failed_count} 个失败：` +
          result.failed.map((f) => `${f.id} (${f.error})`).join("、"),
      );
    }
  } catch (e) {
    setError(e instanceof Error ? e.message : "批量删除失败");
  } finally {
    setBulkDeleting(false);
  }
};
```

### Mode-exit cleanup

```ts
const exitSelectMode = () => {
  setSelectMode(false);
  setSelectedIds(new Set());
};
```

Called by the toolbar's "取消多选" button. **Does not** clear `searchQuery` — search state is independent of selection state, so users can search, enter select mode, then exit, then search again without re-typing.

### State invariant

`selectMode === false` ⇒ `selectedIds.size === 0` (the cleanup function guarantees this). Tests assert the invariant after every transition.

---

## Files Changed

| File | Change |
|---|---|
| `backend/api/project.py` | Add `bulk_delete_projects` endpoint (~30 lines) |
| `tests/test_project_bulk.py` | New file, ~7 test cases |
| `frontend/src/api/client.ts` | Add `BulkDeleteResult` type + `bulkDeleteProjects` method (~15 lines) |
| `frontend/src/pages/ProjectListPage.tsx` | 4 state additions, search input, mode toggle, card variant, bulk toolbar, modal — net +~180 lines |

No new shared components. No new pages. No new routes. No backend changes beyond the one endpoint.

## Out of Scope

- Server-side search / pagination / sorting
- "Select all matching" across the full unfiltered list
- Bulk export, bulk archive, bulk tag
- Per-project confirmation within a batch (e.g. "are you sure about this one?")
- Selection persistence across navigation (intentionally cleared on exit)
