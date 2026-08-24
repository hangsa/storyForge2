# BookShelf modal — default-select-mode + click-zone split

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the "多选" toggle in the BookShelf modal and make selection the default interaction. Click the card title to navigate; click anywhere else on the card to toggle selection. The bulk-action-bar shows up only when ≥1 item is selected.

**Architecture:** Rewrite `BookShelfModal.tsx` to drop `selectMode` state entirely, restructure `ModalCard` from `<button>` to `<div role="button">` with a nested `<a>` for the title (the `<a>`'s `stopPropagation` keeps card-body clicks from triggering navigation), and gate the bulk-action-bar on `selectedIds.size > 0`. Update the existing test block to drop the 3 obsolete toggle tests + add 6 new tests covering the new behavior.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react, Tailwind CSS classes (already established in the project).

**Branch:** `v2.1` (work directly on it — user preference, no git worktree).

**Reference:** `docs/superpowers/specs/2026-08-11-bookshelf-select-all-design.md` — the spec this plan implements.

---

## File map

| File | Change |
|---|---|
| `frontend/src/test/BookShelfModal.test.tsx` | Add 6 new tests in a new describe block (lines 84+); later drop the 3 obsolete tests + modify the existing batch-delete test |
| `frontend/src/components/home/BookShelfModal.tsx` | Full rewrite: drop `selectMode`, drop `多选` button, restructure `ModalCard`, gate bulk-action-bar, rename 全选可见 → 全选, simplify `handleBulkDeleteConfirm` |

No new files. No new dependencies. No backend changes.

---

## Task 1: Add the 6 new failing tests

**Files:**
- Modify: `frontend/src/test/BookShelfModal.test.tsx:84` (insert new describe block after line 82, before line 84's existing describe)

- [ ] **Step 1: Read the test file head to confirm imports**

Run: `head -50 frontend/src/test/BookShelfModal.test.tsx`

Confirm: `renderModal`, `fireEvent`, `act`, `screen` are already imported. The new tests use the same fixtures.

- [ ] **Step 2: Append the new describe block**

In `frontend/src/test/BookShelfModal.test.tsx`, **after line 82** (end of the existing `"BookShelfModal navigation"` describe block) and **before line 84** (start of the existing `"BookShelfModal 多选 + 批量删除 (moved from BookShelf)"` describe block), insert this new describe block:

```tsx
describe("BookShelfModal default-select mode", () => {
  it("bulk-action-bar is hidden by default (no selections yet)", () => {
    renderModal();
    expect(screen.queryByTestId("bulk-action-bar")).not.toBeInTheDocument();
  });

  it("does NOT render a 多选 toggle button (selection is default)", () => {
    renderModal();
    expect(screen.queryByRole("button", { name: /多选/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /退出多选/ })).not.toBeInTheDocument();
  });

  it("clicking a card body toggles selection and reveals the bulk-action-bar", () => {
    renderModal();
    expect(screen.queryByTestId("bulk-action-bar")).not.toBeInTheDocument();
    const card = screen.getByText("诡眼少年").closest('[data-testid="book-card-modal"]')!;
    act(() => { card.click(); });
    expect(screen.getByTestId("bulk-action-bar")).toBeInTheDocument();
    expect(screen.getByText(/已选 1 项/)).toBeInTheDocument();
  });

  it("clicking a card body twice toggles selection off and hides the bulk-action-bar", () => {
    renderModal();
    const card = screen.getByText("诡眼少年").closest('[data-testid="book-card-modal"]')!;
    act(() => { card.click(); });
    expect(screen.getByTestId("bulk-action-bar")).toBeInTheDocument();
    act(() => { card.click(); });
    expect(screen.queryByTestId("bulk-action-bar")).not.toBeInTheDocument();
  });

  it("clicking 全选 selects every currently visible (filtered) project", () => {
    renderModal();
    // Open the bar by selecting one card so 全选 is visible.
    const cards = document.querySelectorAll('[data-testid="book-card-modal"]');
    act(() => { (cards[0] as HTMLElement).click(); });
    act(() => { screen.getByRole("button", { name: /^全选$/ }).click(); });
    expect(screen.getByText(/已选 2 项/)).toBeInTheDocument();
  });

  it("clicking 全选 after a search filter only selects the filtered projects", () => {
    renderModal();
    const search = screen.getByPlaceholderText("搜索");
    fireEvent.change(search, { target: { value: "诡眼" } });
    // Open the bar so 全选 is reachable
    const visibleCards = document.querySelectorAll('[data-testid="book-card-modal"]');
    act(() => { (visibleCards[0] as HTMLElement).click(); });
    act(() => { screen.getByRole("button", { name: /^全选$/ }).click(); });
    expect(screen.getByText(/已选 1 项/)).toBeInTheDocument();
  });

  it("clicking the card title navigates (does NOT toggle selection)", () => {
    renderModal();
    const titleLink = screen.getByRole("link", { name: /诡眼少年/ });
    expect(titleLink.getAttribute("href")).toBe("/project/proj_a/workspace");
    fireEvent.click(titleLink);
    // The title click must NOT reveal the bulk-action-bar
    expect(screen.queryByTestId("bulk-action-bar")).not.toBeInTheDocument();
  });

  it("selection persists when the search filter narrows the result", () => {
    renderModal();
    const cards = document.querySelectorAll('[data-testid="book-card-modal"]');
    act(() => { (cards[0] as HTMLElement).click(); });
    act(() => { (cards[1] as HTMLElement).click(); });
    expect(screen.getByText(/已选 2 项/)).toBeInTheDocument();
    // Narrow the filter — only 1 card visible, but selection count stays at 2
    const search = screen.getByPlaceholderText("搜索");
    fireEvent.change(search, { target: { value: "诡眼" } });
    expect(screen.getByText(/已选 2 项/)).toBeInTheDocument();
  });
});
```

The new describe block sits between the navigation tests (lines 48–82) and the obsolete multi-select tests (lines 84–156). The existing tests stay in place for now — Task 3 drops them.

- [ ] **Step 3: Run the new tests to confirm they fail**

Run: `cd frontend && npx vitest run src/test/BookShelfModal.test.tsx -t "default-select mode"`

Expected: 8 new tests, **all FAIL**. The component still has `selectMode` and the 多选 button, so:
- "bulk-action-bar is hidden by default" FAILS (the component currently shows the bar only after clicking 多选, so by default nothing is shown — wait, this one might PASS by accident. Verify after running.)
- "does NOT render a 多选 toggle button" FAILS (button still exists)
- "clicking a card body toggles selection" FAILS (card is still a `<button>` outside select mode and clicking it navigates)
- ... etc.

If any test unexpectedly passes, that's a sign the test isn't testing what it claims — fix the test before moving on.

- [ ] **Step 4: Commit the failing tests**

```bash
git add frontend/src/test/BookShelfModal.test.tsx
git commit -m "test(bookshelf): add failing tests for default-select-mode + click-zone split"
```

---

## Task 2: Rewrite BookShelfModal.tsx

**Files:**
- Modify: `frontend/src/components/home/BookShelfModal.tsx` (full rewrite)

- [ ] **Step 1: Replace `frontend/src/components/home/BookShelfModal.tsx` with the implementation below**

Full new file contents:

```tsx
import { useState, useMemo, type MouseEvent, type KeyboardEvent } from "react";
import api, { ProjectSummary } from "../../api/client";
import { isPreWizardStage } from "./stages";
import { useGenres } from "../../hooks/useGenres";

const STAGE_COLORS: Record<string, string> = {
  INIT: "bg-system-log/20 text-system-log",
  STAGE1: "bg-blue-500/20 text-blue-300",
  STAGE2: "bg-purple-500/20 text-purple-300",
  STAGE3: "bg-amber-500/20 text-amber-300",
  STAGE4: "bg-primary-container/20 text-primary-container",
  STAGE5: "bg-pink-500/20 text-pink-300",
  STAGE6: "bg-emerald-500/20 text-emerald-300",
  COMPLETED: "bg-green-500/20 text-green-300",
};

const STAGE_LABELS: Record<string, string> = {
  INIT: "初始化",
  STAGE1: "概念",
  STAGE2: "世界观",
  STAGE3: "大纲",
  STAGE4: "工作台",
  STAGE5: "诊断",
  STAGE6: "导出",
  COMPLETED: "已完成",
};

interface BookShelfModalProps {
  projects: ProjectSummary[];
  onClose: () => void;
  /** Notifies the parent (HomePage) after a successful bulk delete so it
   *  can prune its own copy of the project list. Optional — only required
   *  when the parent owns the fetch (BookShelf does NOT, but HomePage does). */
  onProjectsDeleted?: (deletedIds: string[]) => void;
}

function projectHref(currentStage: string, projectId: string) {
  const encoded = encodeURIComponent(projectId);
  if (isPreWizardStage(currentStage)) {
    return `/project/${encoded}/wizard`;
  }
  if (currentStage === "STAGE5") return `/project/${encoded}/stage5`;
  if (currentStage === "STAGE6") return `/project/${encoded}/stage6`;
  return `/project/${encoded}/workspace`;
}

export default function BookShelfModal({
  projects, onClose, onProjectsDeleted,
}: BookShelfModalProps) {
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.title.toLowerCase().includes(q));
  }, [projects, query]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDeleteConfirm = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    setBulkError(null);
    try {
      const ids = Array.from(selectedIds);
      const result = await api.bulkDeleteProjects(ids);
      onProjectsDeleted?.(result.deleted);
      setShowBulkConfirm(false);
      if (result.failed.length === 0) {
        setSelectedIds(new Set());
      } else {
        const failedIds = new Set(result.failed.map((f) => f.id));
        setSelectedIds(failedIds);
        setBulkError(
          `已删除 ${result.deleted_count} 个，${result.failed_count} 个失败：` +
            result.failed.map((f) => `${f.id} (${f.error})`).join("、"),
        );
      }
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : "批量删除失败");
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <div
      data-testid="book-shelf-modal"
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-8"
    >
      <div className="bg-surface-container-lowest border border-outline-variant rounded-lg w-full max-w-6xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 flex items-center justify-between border-b border-outline-variant gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <h2 className="font-headline-md text-primary">全部项目</h2>
            <span className="font-label-mono text-xs text-system-log">
              共 {projects.length} 本
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <span className="material-symbols-outlined text-base absolute left-3 top-1/2 -translate-y-1/2 text-system-log/60 pointer-events-none">
                search
              </span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索"
                className="w-60 bg-surface-container border border-outline-variant rounded-lg
                           pl-9 pr-3 py-1.5 text-sm text-primary placeholder:text-system-log/50
                           focus:outline-none focus:border-primary-container"
              />
            </div>
            <button
              onClick={onClose}
              aria-label="关闭"
              className="text-system-log hover:text-primary"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        {selectedIds.size > 0 && (
          <div
            data-testid="bulk-action-bar"
            className="sticky top-0 z-10 bg-surface-container-low border border-primary-container/40
                       rounded-lg mx-6 mt-3 px-4 py-2 flex items-center gap-3 shadow-lg shadow-black/20"
          >
            <span className="text-sm font-label-mono text-primary">
              已选 {selectedIds.size} 项
            </span>
            <div className="flex-1" />
            <button
              onClick={() => setSelectedIds(new Set(filtered.map((p) => p.id)))}
              className="text-sm text-system-log hover:text-primary"
            >
              全选
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-sm text-system-log hover:text-primary"
            >
              全不选
            </button>
            <button
              onClick={() => setShowBulkConfirm(true)}
              data-testid="bulk-delete-button"
              className="flex items-center gap-1 px-3 py-1 bg-error text-surface-container-low
                         text-sm rounded hover:opacity-90"
            >
              <span className="material-symbols-outlined text-base">delete</span>
              批量删除 ({selectedIds.size})
            </button>
          </div>
        )}

        {bulkError && (
          <div className="mx-6 mt-3 p-3 bg-error/10 border border-error/30 rounded text-error text-xs">
            {bulkError}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filtered.map((p) => (
              <ModalCard
                key={p.id}
                project={p}
                selected={selectedIds.has(p.id)}
                onToggle={() => toggleSelect(p.id)}
              />
            ))}
          </div>
          {filtered.length === 0 && (
            <div className="text-center py-12 text-system-log">未找到匹配项目</div>
          )}
        </div>
      </div>

      {showBulkConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60]">
          <div className="bg-surface-container-low border border-error/30 rounded-lg max-w-lg w-full mx-4 overflow-hidden">
            <div className="px-4 py-3 flex items-center gap-2 border-b border-outline-variant">
              <span className="material-symbols-outlined text-error">delete</span>
              <span className="font-label-mono text-error">
                批量删除 {selectedIds.size} 个项目
              </span>
            </div>
            <div className="p-6 space-y-4">
              <p className="font-body-ui text-system-log text-xs">
                将永久删除以下项目及其所有数据（概念、大纲、章节、模拟记录），此操作不可撤销。
              </p>
              <div className="max-h-60 overflow-y-auto border border-outline-variant rounded">
                {projects
                  .filter((p) => selectedIds.has(p.id))
                  .slice(0, 20)
                  .map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between px-3 py-2 border-b border-outline-variant last:border-b-0"
                    >
                      <span className="font-display text-primary text-sm truncate pr-3">
                        {p.title}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded font-label-mono shrink-0 ${STAGE_COLORS[p.current_stage] || "bg-system-log/20 text-system-log"}`}>
                        {STAGE_LABELS[p.current_stage] || p.current_stage}
                      </span>
                    </div>
                  ))}
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setShowBulkConfirm(false)}
                  disabled={bulkDeleting}
                  className="px-4 py-2 bg-surface-container text-system-log text-sm
                             rounded-lg hover:bg-surface-container-low disabled:opacity-40"
                >
                  取消
                </button>
                <button
                  onClick={handleBulkDeleteConfirm}
                  disabled={bulkDeleting}
                  className="px-4 py-2 bg-error text-surface-container-low text-sm
                             rounded-lg hover:opacity-90 disabled:opacity-40"
                >
                  {bulkDeleting ? "删除中…" : "确认删除"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ModalCard({
  project, selected, onToggle,
}: {
  project: ProjectSummary;
  selected: boolean;
  onToggle: () => void;
}) {
  const href = projectHref(project.current_stage, project.id);

  const handleCardClick = () => {
    onToggle();
  };

  // Keyboard: Enter/Space toggles selection EXCEPT when focus is on the title
  // <a> — in that case the browser handles activation natively (navigate on
  // Enter, scroll on Space). The card div must not double-trigger.
  const handleCardKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if ((e.target as HTMLElement).closest("a")) return;
    e.preventDefault();
    onToggle();
  };

  return (
    <div
      data-testid="book-card-modal"
      data-selected={selected ? "true" : "false"}
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleCardKey}
      className={`relative block w-full text-left bg-surface-container-low border rounded-lg p-4 cursor-pointer
                  transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-container
                  ${selected ? "border-primary-container" : "border-outline-variant hover:border-primary-container/40"}`}
    >
      <a
        href={href}
        onClick={(e) => e.stopPropagation()}
        className="font-headline-md text-primary truncate hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary-container"
      >
        {project.title}
      </a>
      <CardBody project={project} />
      {selected && (
        <span
          data-testid="book-card-check"
          className="material-symbols-outlined absolute top-2 right-2 text-xl text-primary-container"
        >
          check_box
        </span>
      )}
    </div>
  );
}

function CardBody({ project }: { project: ProjectSummary }) {
  const genres = useGenres(false); // include all so labels render for any project genre
  const labelByGenre = Object.fromEntries(genres.map((g) => [g.id, g.label_zh]));

  return (
    <div className="mt-2 flex items-center gap-2 text-xs font-label-mono text-system-log">
      <span>{labelByGenre[project.genre] || project.genre}</span>
      <span>·</span>
      <span>
        {project.target_length_category || `${(project.target_total_words / 10000).toFixed(0)}万字`}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Run the new tests to confirm they pass**

Run: `cd frontend && npx vitest run src/test/BookShelfModal.test.tsx -t "default-select mode"`

Expected: 8 new tests **all PASS**. If any fail, the implementation has a bug — fix it before moving on. Most likely failure: the click on the title `<a>` bubbles despite `stopPropagation`. Confirm `e.stopPropagation()` is on the `<a>`'s `onClick`.

- [ ] **Step 3: Run the full BookShelfModal test file to observe the obsolete failures**

Run: `cd frontend && npx vitest run src/test/BookShelfModal.test.tsx`

Expected:
- The 4 navigation tests (lines 48–82) **PASS** (titles are still `<a>` elements)
- The 8 new tests (added in Task 1) **PASS**
- The 1 modified batch-delete test (will be modified in Task 3 — currently failing because it tries to click 多选 which no longer exists)
- The 3 obsolete toggle tests **FAIL** (multi-select describe block still has the toggle-based tests; the 多选 button no longer exists)

These failures are expected. Task 3 cleans them up.

- [ ] **Step 4: Commit the rewrite**

```bash
git add frontend/src/components/home/BookShelfModal.tsx
git commit -m "feat(bookshelf): default-select-mode + click-zone split in modal

- Drop selectMode state and the 多选/退出多选 toggle button
- Card becomes div[role=button] with nested <a> title; body click selects,
  title click navigates (stopPropagation prevents double-trigger)
- Bulk-action-bar shows only when ≥1 selected
- 全选可见 → 全选
- handleBulkDeleteConfirm now calls setSelectedIds(new Set()) instead of
  the removed exitSelectMode"
```

---

## Task 3: Drop obsolete tests + update the batch-delete test

**Files:**
- Modify: `frontend/src/test/BookShelfModal.test.tsx`

- [ ] **Step 1: Drop the obsolete multi-select describe block**

In `frontend/src/test/BookShelfModal.test.tsx`, **delete the entire describe block** `"BookShelfModal 多选 + 批量删除 (moved from BookShelf)"` (currently lines 84–156). The new "default-select mode" describe block (added in Task 1) replaces it. The block's last `});` is on line 156.

After this deletion, the file ends with the `}` of the new describe block (Task 1's block).

- [ ] **Step 2: Add the modified batch-delete test inside the new describe block**

After the last test (`it("selection persists when the search filter narrows the result", ...)`) inside the `"BookShelfModal default-select mode"` describe block, add this test (it covers the bulk-delete confirmation flow that was previously in the obsolete block):

```tsx
  it("batch-delete confirm calls bulkDeleteProjects and notifies parent via onProjectsDeleted", async () => {
    (api.bulkDeleteProjects as ReturnType<typeof vi.fn>).mockResolvedValue({
      deleted: ["proj_a", "proj_b"], failed: [], deleted_count: 2, failed_count: 0,
    });
    const onProjectsDeleted = vi.fn();
    renderModal({ onProjectsDeleted });
    const cards = document.querySelectorAll('[data-testid="book-card-modal"]');
    act(() => {
      (cards[0] as HTMLElement).click();
      (cards[1] as HTMLElement).click();
    });
    expect(screen.getByText(/已选 2 项/)).toBeInTheDocument();
    await act(async () => {
      screen.getByRole("button", { name: /批量删除/ }).click();
    });
    await act(async () => {
      screen.getByRole("button", { name: "确认删除" }).click();
    });
    expect(api.bulkDeleteProjects).toHaveBeenCalledTimes(1);
    expect(api.bulkDeleteProjects).toHaveBeenCalledWith(
      expect.arrayContaining(["proj_a", "proj_b"]),
    );
    expect(onProjectsDeleted).toHaveBeenCalledWith(["proj_a", "proj_b"]);
  });
```

The diff vs the old test: the `act(() => { screen.getByRole("button", { name: /多选/ }).click(); })` step is removed (the modal is always in select mode now). Everything else is identical.

- [ ] **Step 3: Run the full BookShelfModal test file**

Run: `cd frontend && npx vitest run src/test/BookShelfModal.test.tsx`

Expected: all tests **PASS**. Specifically:
- 4 navigation tests
- 8 new default-select-mode tests (7 from Task 1 + 1 batch-delete from this task)
- 1 search filter test (added in Task 1)
= 13 tests total.

If the batch-delete test fails, the most likely cause is the `api.bulkDeleteProjects` mock not being reset between tests — verify `(api.bulkDeleteProjects as ReturnType<typeof vi.fn>).mockReset();` is in `beforeEach` at line 44.

- [ ] **Step 4: Commit the test cleanup**

```bash
git add frontend/src/test/BookShelfModal.test.tsx
git commit -m "test(bookshelf): drop obsolete 多选 toggle tests; move batch-delete into default-select block"
```

---

## Task 4: Final verification

**Files:** none — runs the full test suite and a manual smoke check.

- [ ] **Step 1: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`

Expected: all tests pass except the 12 pre-existing `Workspace.test.tsx` baseline failures (EventSource not defined in jsdom). Those failures are NOT caused by this work and should not be investigated.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit -p .`

Expected: 37 pre-existing baseline errors (none related to this feature). The new code uses `MouseEvent` and `KeyboardEvent` types from React — verify the import line is correct: `import { useState, useMemo, type MouseEvent, type KeyboardEvent } from "react";`. If new errors appear in `BookShelfModal.tsx`, fix them.

- [ ] **Step 3: Manual smoke test**

In two terminals:

Terminal 1 — backend:
```bash
source venv/bin/activate
uvicorn backend.main:app --reload --port 8000
```

Terminal 2 — frontend:
```bash
cd frontend
npm run dev
```

Open `http://localhost:5173`. Then:

1. Open the bookshelf modal (home page → "查看全部" link).
2. **No 多选 toggle button** in the header (was removed).
3. **No bulk-action-bar** visible on initial open (selection = 0).
4. Click the body of any card → the card gets a primary-container border + a check icon in the top-right; the bulk-action-bar appears at the top showing "已选 1 项".
5. Click the title of any card → navigates to that project (no selection change).
6. Click another card body → "已选 2 项"; the bulk-action-bar still visible.
7. Click 全选 → "已选 N 项" where N equals the total filtered count.
8. Type in the search box → filtered cards update; selection count is unchanged.
9. Clear search → selection count unchanged.
10. Click 全不选 → bar disappears (0 selected).
11. Click one card body → bar reappears.
12. Click 批量删除 → existing confirmation dialog opens; confirm → projects deleted.

- [ ] **Step 4: Final commit (only if smoke test surfaced anything)**

If the smoke test surfaced any fix, commit it. Otherwise the work is done.

```bash
git status  # expect clean
```

---

## Self-review notes

**Spec coverage check:**
- ✅ Remove `selectMode` state → Task 2 Step 1
- ✅ Remove 多选 toggle button → Task 2 Step 1
- ✅ Bulk-action-bar visible only when ≥1 selected → Task 2 Step 1
- ✅ 全选可见 → 全选 → Task 2 Step 1
- ✅ Card markup: `<div role="button">` + `<a>` title → Task 2 Step 1
- ✅ `handleBulkDeleteConfirm` cleanup → Task 2 Step 1
- ✅ Test rewrite → Tasks 1 and 3

**Placeholder scan:** no TBDs, no "implement later", no vague requirements.

**Type consistency:** `selectedIds: Set<string>`, `filtered: ProjectSummary[]`, `ModalCard` props `{ project, selected, onToggle }` — all consistent across tasks.