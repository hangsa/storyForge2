# ChapterTreePanel UI 清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up `ChapterTreePanel` — remove dead-code view-mode tabs (扁平/树形/按幕) whose state is never used to branch rendering, and make the header (章节/刷新/+新章节) sticky so it stays visible when scrolling long chapter lists.

**Architecture:** Pure JSX/CSS cleanup in two files. No backend, no new components, no new state, no new tests (the deleted tests are obsoleted by the view-mode removal; the sticky behavior is verified by manual visual test rather than a brittle jsdom scroll simulation).

**Tech Stack:** React 18 + Tailwind CSS · vitest

---

## Task 1: Remove view-mode dead code + obsolete tests

**Files:**
- Modify: `frontend/src/components/workspace/ChapterTreePanel.tsx`
- Modify: `frontend/src/test/ChapterTreePanel.test.tsx`

- [ ] **Step 1: Delete the `ViewMode` type at line 38**

Open `frontend/src/components/workspace/ChapterTreePanel.tsx`. Find the line:

```ts
type ViewMode = "flat" | "tree" | "act";
```

Delete that single line (and any trailing blank line above the next constant). After deletion, the file should still compile cleanly because nothing else references `ViewMode` once we complete the rest of this task.

- [ ] **Step 2: Delete the `VIEW_MODES` const at lines 54-58**

Find this block:

```ts
const VIEW_MODES: { value: ViewMode; label: string }[] = [
  { value: "flat", label: "扁平" },
  { value: "tree", label: "树形" },
  { value: "act", label: "按幕" },
];
```

Delete the entire block (and the blank line that follows it).

- [ ] **Step 3: Delete the `viewMode` state at line 64**

Find this line:

```ts
  const [viewMode, setViewMode] = useState<ViewMode>("flat");
```

Delete it.

- [ ] **Step 4: Delete the view-mode JSX block at lines 146-162**

Find this block:

```tsx
      <div className="flex rounded border border-outline-variant overflow-hidden text-xs">
        {VIEW_MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            data-testid={`view-mode-${m.value}`}
            onClick={() => setViewMode(m.value)}
            className={`flex-1 py-1 font-body-ui transition-colors ${
              viewMode === m.value
                ? "bg-primary-container text-surface-container-low"
                : "text-system-log hover:bg-surface-container"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
```

Delete the entire `<div>` (including the leading 6-space indent on the opening line and the trailing line break). This is the entire row of three tab buttons that previously sat between the header and the chapter list.

- [ ] **Step 5: Run the typecheck to verify the component still compiles**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx tsc --noEmit`

Expected: Exit code 0 with no errors related to `ChapterTreePanel.tsx`. Pre-existing TS errors in other files are OK; do not fix them.

- [ ] **Step 6: Delete the two obsolete view-mode tests in `ChapterTreePanel.test.tsx`**

Open `frontend/src/test/ChapterTreePanel.test.tsx`. Find and delete these two `it(...)` blocks (be sure to remove the full block including the leading blank line and the trailing blank line):

Block 1 — `renders all three view-mode buttons`:

```tsx
  it("renders all three view-mode buttons (扁平 / 树形 / 按幕)", () => {
    render(<ChapterTreePanel ... />);
    expect(screen.getByTestId("view-mode-flat")).toBeInTheDocument();
    expect(screen.getByTestId("view-mode-tree")).toBeInTheDocument();
    expect(screen.getByTestId("view-mode-act")).toBeInTheDocument();
  });
```

(The exact `render(...)` body inside is whatever the file currently has; delete the whole `it(...)` block including the opening `it(` line and the closing `});`.)

Block 2 — `clicking a view-mode button highlights it`:

```tsx
  it("clicking a view-mode button highlights it (v1.8: label-only, no filter)", () => {
    render(<ChapterTreePanel ... />);
    fireEvent.click(screen.getByTestId("view-mode-tree"));
    expect(screen.getByTestId("view-mode-tree").className).toContain("bg-primary-container");
    expect(screen.getByTestId("view-mode-flat").className).not.toContain("bg-primary-container");
  });
```

Delete the whole `it(...)` block the same way.

- [ ] **Step 7: Run the test suite to confirm no regressions**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npm test -- --run`

Expected:
- `ChapterTreePanel.test.tsx`: 12 tests pass (was 14 — 2 deleted), no new failures.
- `Workspace.test.tsx`: 505 pass, 12 pre-existing baseline `ManagedDashboard.test.tsx` failures unchanged.
- Total: ~503 pass, 12 fail (all pre-existing ManagedDashboard baseline).

- [ ] **Step 8: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/components/workspace/ChapterTreePanel.tsx frontend/src/test/ChapterTreePanel.test.tsx
git commit -m "$(cat <<'EOF'
refactor(workspace): remove dead view-mode tabs from ChapterTreePanel

viewMode state was set on click but never used to branch rendering —
all three modes (扁平/树形/按幕) produced identical DOM. Dropped
the unused ViewMode type, VIEW_MODES const, viewMode state, and
the JSX block. Also dropped the 2 obsolete tests that asserted the
buttons existed and toggled active styling.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Make ChapterTreePanel header sticky

**Files:**
- Modify: `frontend/src/components/workspace/ChapterTreePanel.tsx`

- [ ] **Step 1: Verify the current header line**

Open `frontend/src/components/workspace/ChapterTreePanel.tsx`. After Task 1's deletions, the header `<div>` should now be the very first child of the panel root `<div data-testid="chapter-tree">`. It currently reads (around line 128):

```tsx
      <div className="flex items-center justify-between">
        <span className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">章节</span>
        <div className="flex gap-1">
          <button
            type="button"
            data-testid="refresh"
            ...
```

Confirm the opening `<div>` line is exactly:

```tsx
      <div className="flex items-center justify-between">
```

- [ ] **Step 2: Add the sticky styling to the header `<div>`**

Replace the opening `<div>` line identified in Step 1 with:

```tsx
      <div className="sticky top-0 z-10 bg-canvas-bg border-b border-outline-variant -mx-3 px-3 pt-3 pb-2 flex items-center justify-between">
```

The change adds (in this order):
- `sticky top-0 z-10` — pin to the top of the scroll container with stacking context
- `bg-canvas-bg` — opaque background so scrolling content doesn't bleed through under the header
- `border-b border-outline-variant` — visual separator between header and chapter list
- `-mx-3 px-3 pt-3 pb-2` — cancel out the parent `p-3` padding horizontally so the band spans full column width, then restore the original vertical rhythm (3 top to match parent, 2 bottom for snug button padding)

The original `flex items-center justify-between` stays at the end of the class string.

- [ ] **Step 3: Run the typecheck to confirm no errors**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx tsc --noEmit`

Expected: Exit code 0 with no errors in `ChapterTreePanel.tsx`.

- [ ] **Step 4: Run the test suite to confirm no regressions**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npm test -- --run`

Expected:
- `ChapterTreePanel.test.tsx`: 12 tests pass (same as after Task 1)
- `Workspace.test.tsx`: 505 pass, 12 pre-existing baseline failures unchanged
- Total: ~503 pass, 12 fail (same baseline as Task 1)

- [ ] **Step 5: Manual visual verify**

(a) Check the dev server isn't running on port 5173:

```bash
lsof -i :5173 || echo "port 5173 free"
```

(b) If free, start the dev server:

```bash
cd /Users/longsa/Codes/storyForge2/frontend && npm run dev &
```

(c) Open `http://localhost:5173/project/proj_cc4ca4ae/workspace?chapter=1&scene=1-1` in a browser. Confirm:
- The "章节 / 刷新 / +新章节" row appears at the very top of the left column.
- Scroll the chapter list down (drag the scrollbar, or use a project with many chapters) — the header row stays pinned at the top of the column.
- A horizontal line (the new border-b) separates the header from the scrolling chapter list.

(d) Kill the dev server:

```bash
kill %1
```

(e) Note: if `proj_cc4ca4ae` doesn't have enough chapters to overflow the viewport, just confirm the header still renders correctly at top — the sticky behavior is verified by code review (the `sticky top-0` classes are applied); manual scroll verification is a nice-to-have but not blocking.

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/components/workspace/ChapterTreePanel.tsx
git commit -m "$(cat <<'EOF'
refactor(workspace): pin ChapterTreePanel header with sticky positioning

Header (章节/刷新/+新章节) now uses position: sticky; top: 0 inside
the existing left-column overflow-y-auto container, so it stays
visible when scrolling long chapter lists. Added bg-canvas-bg to
prevent content bleed-through and a border-b separator for visual
clarity at the scroll boundary.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
---

## Spec coverage check

- View-mode tabs completely removed → Task 1 (4 deletions, 1 commit)
- Header sticky during scroll → Task 2 (1 className change, 1 commit)
- 2 obsolete tests deleted → Task 1 Step 6
- No WorkspaceLayout change → both tasks scoped to ChapterTreePanel.tsx only (no other files touched)
- No ManagedDashboard change → neither task touches it

## Self-review notes

- 2 commits, each scoped to one logical change (dead-code removal vs sticky styling) — keeps history readable
- No new tests: deleted 2 obsolete ones; sticky behavior is a single className change verified by manual scroll test (jsdom scroll simulation is brittle and not worth the maintenance burden)
- All class names in the sticky step are Tailwind utilities or existing project tokens (`bg-canvas-bg`, `border-outline-variant`); no custom CSS
- Task boundaries align with the spec's two non-goal-adjacent changes; each commits independently so a partial rollout is possible