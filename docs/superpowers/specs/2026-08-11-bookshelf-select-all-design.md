# BookShelf modal — default-select-mode + click-zone split

**Status:** Draft — pending user review
**Date:** 2026-08-11
**Branch:** v2.1
**Author:** Claude (brainstorming session)

## Goal

Remove the "多选" toggle and make selection the default interaction in the bookshelf popup modal. The card has two click zones:

- The **title** navigates to the project (existing per-stage href).
- **Anywhere else on the card** toggles that project's selection.

The bulk-action-bar appears the moment the user has ≥1 item selected, and hides when the selection returns to 0.

## Why

The current modal requires the user to click "多选" before they can select anything. That's two clicks to do what should be one. Selection is also the modal's only meaningful purpose (every other interaction in the modal leads to selection + bulk-delete), so making it default eliminates the toggle without losing any capability.

The split click-zone is the natural evolution: users who want to *open* a project click the title (its meaning is self-evident); users who want to *manage* a project click the card body, where the check icon in the top-left signals the selectable nature of the area.

## Scope

### In scope

- `frontend/src/components/home/BookShelfModal.tsx`
- `frontend/src/test/BookShelfModal.test.tsx` (the "多选 + 批量删除" describe block)

### Out of scope

- `frontend/src/components/home/BookShelf.tsx` (the home-page 5-card carousel). Its cards keep single-click-navigate. Adding two-zone click here is a separate UX decision (the home page has no bulk actions, so select mode has no purpose).
- New bulk operations (export, archive, etc.). `api.bulkDeleteProjects` stays the only bulk endpoint.
- Visual restyling of the card. Same colors, same layout — only click-zone semantics change.
- Renaming `data-testid` values that other code depends on. Tests are rewritten; no other component consumes these testIds.

## Design

### Interaction model

| Action | Result |
|---|---|
| Click book **title** | Navigate to project (`<a href={projectHref(...)}>`) |
| Click card body / check icon | Toggle that project's selection |
| Click **全选** | Select every currently visible (filtered) project |
| Click **全不选** | Clear selection (bar then hides) |
| Click **批量删除** | Open the existing bulk-delete confirmation dialog |
| Middle-click / cmd-click title | Native browser behavior (open in new tab) |

`selectMode` state is removed. The "多选" toggle button is removed. Selection is the only mode.

### Card markup

The current card is a single `<button>` (or `<a>` outside select mode). The new card is a `<div>` with two children:

```tsx
<div
  data-testid="book-card-modal"
  data-selected={selected ? "true" : "false"}
  role="button"
  tabIndex={0}
  onClick={() => toggleSelect(p.id)}
  onKeyDown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleSelect(p.id);
    }
  }}
  className="block w-full text-left bg-surface-container-low border rounded-lg p-4
             cursor-pointer transition-colors
             focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-container
             ${selected ? 'border-primary-container' : 'border-outline-variant hover:border-primary-container/40'}"
>
  <a
    href={projectHref(p.current_stage, p.id)}
    onClick={(e) => e.stopPropagation()}
    className="font-headline-md text-primary truncate hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary-container"
  >
    {p.title}
  </a>
  <div className="mt-2 flex items-center gap-2 text-xs font-label-mono text-system-log">
    <span>{genreLabel}</span>
    <span>·</span>
    <span>{lengthLabel}</span>
  </div>
  {selected && (
    <span className="material-symbols-outlined absolute top-2 right-2 text-xl text-primary-container">
      check_box
    </span>
  )}
</div>
```

Notes:
- `role="button"` + `tabIndex={0}` + `onKeyDown` makes the card keyboard-selectable.
- The title `<a>` is the clickable navigation target; its `stopPropagation` prevents the card's `onClick` from also firing.
- The check icon moves to **absolute top-right** (currently top-left). Reason: the top-left is occupied by the title, and visually pairing the check with the corner keeps the title readable. The check still signals "this card is selected" — placement is cosmetic.
- `<button>` cannot contain `<a>` (invalid HTML), so the card becomes a `<div>` with `role="button"`.
- The check icon stays a visual indicator only (no separate handler). Clicking it still falls through to the card's `onClick`, which toggles selection.

### Header

Remove the "多选" toggle button. Final header layout (left → right):

```
全部项目   共 N 本      [搜索框]      ✕
```

No new controls added in the header. The 全选/全不选/批量删除 actions live in the bulk-action-bar.

### Bulk-action-bar

Visible **only when `selectedIds.size > 0`**. When visible, content is:

```tsx
{selectedIds.size > 0 && (
  <div data-testid="bulk-action-bar" className="sticky top-0 z-10 ...">
    <span className="text-sm font-label-mono text-primary">
      已选 {selectedIds.size} 项
    </span>
    <div className="flex-1" />
    <button onClick={() => setSelectedIds(new Set(filtered.map((p) => p.id)))}>
      全选
    </button>
    <button
      onClick={() => setSelectedIds(new Set())}
      className="..."
    >
      全不选
    </button>
    <button
      onClick={() => setShowBulkConfirm(true)}
      disabled={selectedIds.size === 0}
      data-testid="bulk-delete-button"
      className="..."
    >
      批量删除 ({selectedIds.size})
    </button>
  </div>
)}
```

When `selectedIds.size > 0`, `全不选` and `批量删除` are always enabled (no need for `disabled={selectedIds.size === 0}` since the bar doesn't render when 0).

The first button's label changes from "全选可见" → **"全选"**. The "可见" (visible) suffix was meaningful when the bar was hidden behind a toggle; now that select mode is default, the action is obvious from context.

### State changes

**Removed:**
- `selectMode` state and `exitSelectMode` callback
- `selectMode` / `selected` props on `ModalCard` (replaced by direct `selected` prop on the new card markup)
- The "多选"/"退出多选" header button

**Kept (unchanged):**
- `query`, `filtered`, `selectedIds`, `showBulkConfirm`, `bulkDeleting`, `bulkError`
- `toggleSelect`, `handleBulkDeleteConfirm`
- `api.bulkDeleteProjects` integration
- Confirmation dialog markup and behavior

### Edge cases

| Case | Behavior |
|---|---|
| Click title (`<a>`) | Native navigation fires; card's `onClick` does NOT fire (because of `stopPropagation`); selection unchanged |
| Middle-click title | Native "open in new tab" behavior (browser default for `<a>`) |
| Keyboard: Tab onto card, Enter/Space | Selection toggles |
| Keyboard: Tab onto title `<a>`, Enter | Native navigation |
| User types in search box, narrowing results | Existing selection is preserved (selection is keyed by `id`, not by filtered index). Cards that are now hidden remain selected — bulk-delete still operates on the full selection |
| 0 selected | Bulk-action-bar hidden. The only path to ≥1 selection is clicking a card body, which makes the bar appear |
| 0 projects / 0 filtered | Cards grid shows the existing "未找到匹配项目" message; bulk-action-bar remains hidden (no selections possible) |
| Click 全不选 while bar visible | Selection clears → bar hides |
| Click 批量删除 then confirm | Existing `handleBulkDeleteConfirm` flow unchanged. On full success, `exitSelectMode()` was called; now we just `setSelectedIds(new Set())` since there's no `selectMode` to exit |

### Accessibility

- Card: `role="button"` + `tabIndex={0}` + `onKeyDown` for Enter/Space → toggles selection.
- Title: native `<a>` for navigation; browser provides focus + activation.
- Focus styling: `focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-container` on the card div so keyboard users see where they are.
- The card's `data-selected` attribute provides a programmatic hook for testing and (if needed later) screen-reader announcements.

## Testing strategy

### `frontend/src/test/BookShelfModal.test.tsx`

Rewrite the `"BookShelfModal 多选 + 批量删除 (moved from BookShelf)"` describe block (currently lines 84–155). The pre-existing tests in lines 1–83 (rendering, search, navigation) are unchanged.

**Drop these tests (they assert the old toggle behavior):**
- "renders a '多选' toggle button in the modal header"
- "clicking 多选 reveals the bulk action bar with '全选可见' / '全不选' / '批量删除'"
- "'退出多选' button hides the bulk action bar and clears selection"

**Add these tests:**
- "bulk-action-bar is hidden by default (no selections yet)"
- "clicking a card body toggles selection and reveals the bulk-action-bar"
- "clicking a card body twice toggles selection off and hides the bulk-action-bar"
- "clicking 全选 selects every currently visible (filtered) project"
- "clicking the card title navigates (does NOT toggle selection)"
- "selection persists when the search filter narrows the result"

**Keep these tests (they should pass unchanged):**
- Bulk-delete confirmation flow (existing `handleBulkDeleteConfirm` logic is preserved)
- Error handling for partial bulk-delete failures
- Search filter narrows visible cards

## Open questions

None at design time.