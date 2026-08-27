# Nebula Forge HomePage Assembly + Cleanup — Implementation Plan (Plan 3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the 12 `ds/*` primitives from Plans 1+2 into the refactored HomePage, add `BulkDeleteModal` for the Notion-style toolbar delete, refresh the four HomePage-resident modal token surfaces, and delete the 6 legacy home components that the primitives replaced.

**Architecture:** Replace, don't rename — `StatsSidebar.tsx`, `BookShelf.tsx`, `QuickActions.tsx` are rewritten in place to compose `ds/*` primitives. New `BulkDeleteModal.tsx` is added at `frontend/src/components/home/`. HomePage.tsx drops `CreateProjectCard` and `ManifestoHeader` references. The four untouched modals (`MoreActionsModal`, `PromptPlazaModal`, `AIConsoleModal`, `InitWizardModal`) get a token-only pass: legacy `text-system-log`, `font-label-mono`, `font-display-lg`, `font-body-narrative`, `font-body-ui` classes are swapped to their Material 3 + Tailwind equivalents so they pick up the new palette consistently.

**Tech Stack:** TypeScript + React 18 + Tailwind 3 + Vitest + jsdom + @testing-library/react (frontend). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-27-nebula-forge-homepage-refactor-design.md` (commit `bd0bed9`), §"Bookshelf Restructure" + "Brand Rename" + §"Testing Strategy".

**Depends on:** Plan 1 (CSS palette + Tailwind typography + `ds/tokens.ts` + `ds/BrandHeader`) and Plan 2 (11 remaining primitives + `ds/stages.ts`).

---

## Token-replacement cheat sheet

This cheat sheet is reused in every "token refresh" task below. Apply it mechanically.

| Legacy pattern | Replacement |
|---|---|
| `text-system-log` | `text-on-surface-variant` |
| `text-system-log/20` (on bg) | `bg-surface-container-low` parent + `text-on-surface-variant` |
| `text-system-log/40` (disabled) | `text-on-surface-variant/40` |
| `text-system-log/50` (placeholder) | `text-on-surface-variant/50` |
| `text-system-log/60` (muted) | `text-on-surface-variant/60` |
| `font-label-mono` | `font-mono` |
| `font-headline-md` | `font-display text-title-md` |
| `font-headline-lg` | `font-display text-headline-lg` |
| `font-display-lg` | `font-display text-headline-lg` |
| `font-body-narrative` | `font-body text-body-lg` |
| `font-body-ui` | `font-body text-body-md` |
| `text-primary-container` (as text color) | `text-primary` |
| `bg-canvas-surface` (legacy alias) | `bg-surface-container` |
| Hardcoded hex like `#020617` / `#00f0ff` in swatches | Remove if decorative; otherwise keep (theme swatches are preview-only) |

---

## Task 1: Migrate STAGE_COLORS + STAGE_LABELS consumers to ds/stages.ts

**Files:**
- Modify: `frontend/src/components/home/BookShelf.tsx` (drop the local maps; import from `ds/stages.ts`)
- Modify: `frontend/src/components/home/BookShelfModal.tsx` (same)
- Modify: `frontend/src/components/home/stages.ts` (keep `isPreWizardStage` only — the maps now live in `ds/stages.ts`)

- [ ] **Step 1: Edit BookShelf.tsx**

Open `frontend/src/components/home/BookShelf.tsx`. At the top of the file, replace:

```ts
import { isPreWizardStage } from "./stages";
```

with:

```ts
import { isPreWizardStage, STAGE_COLORS, STAGE_LABELS } from "../ds/stages";
```

Then delete the local `STAGE_COLORS` and `STAGE_LABELS` const blocks (lines ~7–27 in the current file).

- [ ] **Step 2: Edit BookShelfModal.tsx**

Open `frontend/src/components/home/BookShelfModal.tsx`. Apply the same import rewrite:

```ts
import { STAGE_COLORS, STAGE_LABELS } from "../ds/stages";
```

Then delete the local `STAGE_COLORS` block.

- [ ] **Step 3: Trim home/stages.ts to keep only isPreWizardStage**

Open `frontend/src/components/home/stages.ts`. The file currently contains only `isPreWizardStage` (verified — no STAGE_COLORS in this file). No edits required. Plan 3 Task 14 deletes this file (its sole export now lives in `ds/stages.ts`).

- [ ] **Step 4: Run frontend tests to verify no consumer breaks**

Run: `cd frontend && npm test -- --run 'BookShelf|StatsSidebar|HomePage' 2>&1 | tail -30`
Expected: PASS — all tests that touch these components still work because they assert against rendered text/structure, not against the source of the maps.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/home/BookShelf.tsx frontend/src/components/home/BookShelfModal.tsx
git commit -m "refactor(home): consume STAGE_COLORS + STAGE_LABELS from ds/stages.ts"
```

---

## Task 2: BulkDeleteModal — failing test

**Files:**
- Create: `frontend/src/test/home/BulkDeleteModal.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BulkDeleteModal from "../../components/home/BulkDeleteModal";

describe("BulkDeleteModal", () => {
  it("does not render when isOpen is false", () => {
    render(
      <BulkDeleteModal
        isOpen={false}
        selectedIds={["p1"]}
        selectedTitles={["书 A"]}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.queryByText(/确定要删除以下/)).not.toBeInTheDocument();
  });

  it("renders the count and a truncated list when isOpen is true", () => {
    render(
      <BulkDeleteModal
        isOpen
        selectedIds={["p1", "p2", "p3"]}
        selectedTitles={["书 A", "书 B", "书 C"]}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText(/确定要删除以下 3 个项目/)).toBeInTheDocument();
    expect(screen.getByText("书 A")).toBeInTheDocument();
    expect(screen.getByText("书 B")).toBeInTheDocument();
    expect(screen.getByText("书 C")).toBeInTheDocument();
  });

  it("caps the visible list at 10 entries and shows the overflow count", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
    const titles = Array.from({ length: 12 }, (_, i) => `书 ${i}`);
    render(
      <BulkDeleteModal
        isOpen
        selectedIds={ids}
        selectedTitles={titles}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText(/还有 2 个/)).toBeInTheDocument();
  });

  it("fires onConfirm when the destructive button is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <BulkDeleteModal
        isOpen
        selectedIds={["p1"]}
        selectedTitles={["书 A"]}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("fires onCancel when the cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(
      <BulkDeleteModal
        isOpen
        selectedIds={["p1"]}
        selectedTitles={["书 A"]}
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- --run BulkDeleteModal 2>&1 | tail -10`
Expected: FAIL with `Failed to resolve import "../../components/home/BulkDeleteModal"`.

---

## Task 3: BulkDeleteModal — implement

**Files:**
- Create: `frontend/src/components/home/BulkDeleteModal.tsx`

- [ ] **Step 1: Implement BulkDeleteModal**

```tsx
import { GhostButton, SecondaryButton } from "../ds";

export interface BulkDeleteModalProps {
  selectedIds: string[];
  selectedTitles: string[];
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const VISIBLE_LIMIT = 10;

export default function BulkDeleteModal({
  selectedIds,
  selectedTitles,
  isOpen,
  onConfirm,
  onCancel,
}: BulkDeleteModalProps) {
  if (!isOpen) return null;

  const visible = selectedTitles.slice(0, VISIBLE_LIMIT);
  const overflow = selectedTitles.length - visible.length;

  return (
    <div
      data-testid="bulk-delete-modal"
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-8"
    >
      <div className="bg-surface-container-lowest border border-outline-variant rounded-lg w-full max-w-md flex flex-col">
        <header className="px-6 py-4 border-b border-outline-variant">
          <h2 className="font-display text-title-md text-primary">确认删除</h2>
        </header>
        <div className="px-6 py-4 space-y-3">
          <p className="font-body text-body-md text-on-surface">
            确定要删除以下 {selectedIds.length} 个项目吗？此操作不可撤销。
          </p>
          <ul className="max-h-60 overflow-y-auto bg-surface-container border border-outline-variant rounded p-3 space-y-1">
            {visible.map((t, i) => (
              <li key={i} className="font-body text-body-md text-on-surface truncate">
                {t}
              </li>
            ))}
            {overflow > 0 && (
              <li className="font-mono text-label-sm text-on-surface-variant">
                … 还有 {overflow} 个
              </li>
            )}
          </ul>
        </div>
        <footer className="px-6 py-4 border-t border-outline-variant flex justify-end gap-3">
          <GhostButton label="取消" onClick={onCancel} />
          <SecondaryButton label="删除" variant="destructive" icon="delete" onClick={onConfirm} />
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd frontend && npm test -- --run BulkDeleteModal 2>&1 | tail -10`
Expected: PASS (5 tests).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/home/BulkDeleteModal.tsx frontend/src/test/home/BulkDeleteModal.test.tsx
git commit -m "feat(home): add BulkDeleteModal with truncated list + overflow indicator"
```

---

## Task 4: QuickActions — rewrite using ds/ components

**Files:**
- Modify: `frontend/src/components/home/QuickActions.tsx`

The current `QuickActions` renders a 2×2 grid of icon+label buttons. Refactor to use `ds/SidebarNavItem` for collapsed state and a small grid of `ds/SecondaryButton`s for expanded state. Keep the existing 4 actions (AI 控制台, 提示词广场, 刷新, 更多) and the same props interface — `StatsSidebar` already passes them.

- [ ] **Step 1: Replace file contents**

Open `frontend/src/components/home/QuickActions.tsx`. Replace its entire content with:

```tsx
import { SecondaryButton } from "../ds";

interface QuickActionsProps {
  onRefresh: () => void;
  refreshing: boolean;
  onOpenPlaza?: () => void;
  plazaDisabled?: boolean;
  plazaTooltip?: string;
  onOpenConsole?: () => void;
  consoleDisabled?: boolean;
  consoleTooltip?: string;
  onOpenMore?: () => void;
  /** When true, renders compact icon-only buttons (collapsed sidebar). */
  collapsed?: boolean;
}

export default function QuickActions({
  onRefresh,
  refreshing,
  onOpenPlaza,
  plazaDisabled,
  plazaTooltip,
  onOpenConsole,
  consoleDisabled,
  consoleTooltip,
  onOpenMore,
  collapsed = false,
}: QuickActionsProps) {
  if (collapsed) {
    return (
      <div data-testid="quick-actions" className="flex flex-col gap-2">
        <IconButton icon="smart_toy" disabled={consoleDisabled} tooltip={consoleTooltip} onClick={onOpenConsole} testId="qa-ai-console" />
        <IconButton icon="forum" disabled={plazaDisabled} tooltip={plazaTooltip} onClick={onOpenPlaza} testId="qa-prompt-square" />
        <IconButton icon={refreshing ? "progress_activity" : "refresh"} onClick={onRefresh} testId="qa-refresh" spinning={refreshing} />
        <IconButton icon="more_horiz" onClick={onOpenMore} testId="qa-more" />
      </div>
    );
  }

  return (
    <div data-testid="quick-actions" className="grid grid-cols-2 gap-2">
      <SecondaryButton label="AI 控制台" size="sm" icon="smart_toy" disabled={consoleDisabled} onClick={() => onOpenConsole?.()} />
      <SecondaryButton label="提示词广场" size="sm" icon="forum" disabled={plazaDisabled} onClick={() => onOpenPlaza?.()} />
      <SecondaryButton label={refreshing ? "刷新中…" : "刷新"} size="sm" icon={refreshing ? "progress_activity" : "refresh"} onClick={onRefresh} />
      <SecondaryButton label="更多" size="sm" icon="more_horiz" onClick={() => onOpenMore?.()} />
    </div>
  );
}

function IconButton({
  icon, onClick, disabled, tooltip, testId, spinning,
}: {
  icon: string;
  onClick?: () => void;
  disabled?: boolean;
  tooltip?: string;
  testId: string;
  spinning?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className="p-2 rounded bg-surface-container text-primary hover:bg-surface-container-high disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <span className={`material-symbols-outlined text-xl ${spinning ? "animate-spin" : ""}`} aria-hidden="true">
        {icon}
      </span>
    </button>
  );
}
```

- [ ] **Step 2: Run frontend tests touching QuickActions**

Run: `cd frontend && npm test -- --run 'QuickActions|StatsSidebar' 2>&1 | tail -20`
Expected: PASS — `StatsSidebar` passes the same prop shape; existing selectors (`qa-ai-console`, `qa-prompt-square`, `qa-refresh`, `qa-more`) still resolve.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/home/QuickActions.tsx
git commit -m "refactor(home): QuickActions composes ds/SecondaryButton + IconButton"
```

---

## Task 5: StatsSidebar — rewrite using ds/ components

**Files:**
- Modify: `frontend/src/components/home/StatsSidebar.tsx`

The current `StatsSidebar` owns its own collapse state, header logo, and three sections (统计 / 阶段分布 / 快捷操作). Refactor to compose:
- `ds/Sidebar` shell (handles collapse state + localStorage)
- `ds/BrandHeader` header (with brand rename to "Nebula Forge")
- `ds/StatCard` × 3 (总书籍 / 总章节 / 总字数)
- `ds/PhaseIndicator` distribution list
- Rewritten `QuickActions`

- [ ] **Step 1: Replace file contents**

Open `frontend/src/components/home/StatsSidebar.tsx`. Replace its entire content with:

```tsx
import { useMemo } from "react";
import { ProjectStats } from "../../api/client";
import { BrandHeader, PhaseIndicator, Sidebar, StatCard } from "../ds";
import { STAGE_LABELS } from "../ds/stages";
import QuickActions from "./QuickActions";

interface StatsSidebarProps {
  stats: ProjectStats | null;
  statsLoading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  onOpenPlaza?: () => void;
  plazaDisabled?: boolean;
  plazaTooltip?: string;
  onOpenConsole?: () => void;
  consoleDisabled?: boolean;
  consoleTooltip?: string;
  onOpenMore?: () => void;
}

const STAGE_ORDER = [
  "INIT", "STAGE1", "STAGE2", "STAGE3",
  "STAGE4", "STAGE5", "STAGE6", "COMPLETED",
] as const;

export default function StatsSidebar({
  stats,
  statsLoading,
  onRefresh,
  refreshing,
  onOpenPlaza,
  plazaDisabled,
  plazaTooltip,
  onOpenConsole,
  consoleDisabled,
  consoleTooltip,
  onOpenMore,
}: StatsSidebarProps) {
  const phases = useMemo(
    () =>
      STAGE_ORDER.map((key) => ({
        key,
        label: STAGE_LABELS[key],
        count: stats?.stage_distribution?.[key] ?? 0,
        active: key === "STAGE4",
        completed: key === "COMPLETED",
      })),
    [stats]
  );

  return (
    <Sidebar
      persistKey="storyforge.home.sidebar.collapsed"
      header={<BrandHeader brandName="Nebula Forge" />}
      footer={null}
    >
      {(collapsed) => (
        <div className="flex flex-col gap-4">
          {collapsed ? (
            <QuickActions
              collapsed
              onRefresh={onRefresh}
              refreshing={refreshing}
              onOpenPlaza={onOpenPlaza}
              plazaDisabled={plazaDisabled}
              plazaTooltip={plazaTooltip}
              onOpenConsole={onOpenConsole}
              consoleDisabled={consoleDisabled}
              consoleTooltip={consoleTooltip}
              onOpenMore={onOpenMore}
            />
          ) : (
            <>
              <section>
                <h3 className="font-mono text-label-sm uppercase tracking-wider text-on-surface-variant mb-2">
                  统计
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  <StatCard label="总书籍" value={stats?.total_books ?? null} size="sm" />
                  <StatCard label="总章节" value={stats?.total_chapters ?? null} size="sm" />
                  <StatCard label="总字数" value={stats?.total_words ?? null} size="sm" />
                </div>
              </section>

              <section>
                <h3 className="font-mono text-label-sm uppercase tracking-wider text-on-surface-variant mb-2">
                  阶段分布
                </h3>
                <PhaseIndicator phases={phases} />
              </section>

              <section>
                <h3 className="font-mono text-label-sm uppercase tracking-wider text-on-surface-variant mb-2">
                  快捷操作
                </h3>
                <QuickActions
                  onRefresh={onRefresh}
                  refreshing={refreshing}
                  onOpenPlaza={onOpenPlaza}
                  plazaDisabled={plazaDisabled}
                  plazaTooltip={plazaTooltip}
                  onOpenConsole={onOpenConsole}
                  consoleDisabled={consoleDisabled}
                  consoleTooltip={consoleTooltip}
                  onOpenMore={onOpenMore}
                />
                {statsLoading && (
                  <div className="mt-3 font-mono text-label-sm text-on-surface-variant/60">
                    加载中…
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </Sidebar>
  );
}
```

Note: `Sidebar`'s default rendering uses `children` as plain ReactNode. To make the `(collapsed) =>` render-prop work, the implementation must update `ds/Sidebar.tsx` (Plan 2 file) so its `children` prop accepts either `ReactNode` or `(collapsed: boolean) => ReactNode`. The Sidebar edit is included in Step 1b below.

- [ ] **Step 1b: Update `ds/Sidebar.tsx` to support render-prop children**

Open `frontend/src/components/ds/Sidebar.tsx`. Replace the `children` prop type:

```ts
children: ReactNode;
```

with:

```ts
children: ReactNode | ((collapsed: boolean) => ReactNode);
```

And in the body where it renders `{children}`, replace with:

```tsx
{typeof children === "function" ? children(collapsedState) : children}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Run StatsSidebar test (will fail — selectors changed in next task)**

Run: `cd frontend && npm test -- --run StatsSidebar 2>&1 | tail -30`
Expected: existing test fails because selectors reference `text-primary` directly and the old `data-collapsed` attribute. Task 6 updates the test.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/home/StatsSidebar.tsx frontend/src/components/ds/Sidebar.tsx
git commit -m "refactor(home): StatsSidebar composes ds/Sidebar + ds/BrandHeader + ds/StatCard + ds/PhaseIndicator"
```

---

## Task 6: StatsSidebar test — update selectors

**Files:**
- Modify: `frontend/src/test/StatsSidebar.test.tsx`

The old test asserts on `text-primary` (now `text-on-surface` for the brand area) and `data-collapsed` (Sidebar doesn't expose this directly). It also references `StatCard` test-id (`stat-card`) which the new `ds/StatCard` does NOT expose — StatCard renders `bg-surface-container-low` instead.

- [ ] **Step 1: Replace test file contents**

Open `frontend/src/test/StatsSidebar.test.tsx`. Replace its entire content with:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import StatsSidebar from "../components/home/StatsSidebar";

const SAMPLE_STATS = {
  total_books: 12,
  total_chapters: 87,
  total_words: 214000,
  stage_distribution: {
    INIT: 1, STAGE1: 2, STAGE2: 0, STAGE3: 0,
    STAGE4: 5, STAGE5: 0, STAGE6: 0, COMPLETED: 4,
  },
};

beforeEach(() => {
  localStorage.removeItem("storyforge.home.sidebar.collapsed");
});

describe("StatsSidebar", () => {
  it("renders the Nebula Forge brand and stats sections when expanded", () => {
    render(
      <StatsSidebar
        stats={SAMPLE_STATS}
        statsLoading={false}
        onRefresh={() => {}}
        refreshing={false}
      />
    );
    expect(screen.getByText("Nebula Forge")).toBeInTheDocument();
    expect(screen.getByText("统计")).toBeInTheDocument();
    expect(screen.getByText("阶段分布")).toBeInTheDocument();
    expect(screen.getByText("快捷操作")).toBeInTheDocument();
    expect(screen.getByText("总书籍")).toBeInTheDocument();
    expect(screen.getByText("总章节")).toBeInTheDocument();
    expect(screen.getByText("总字数")).toBeInTheDocument();
  });

  it("renders only the collapsed icon column when localStorage says collapsed", () => {
    localStorage.setItem("storyforge.home.sidebar.collapsed", "true");
    render(
      <StatsSidebar
        stats={SAMPLE_STATS}
        statsLoading={false}
        onRefresh={vi.fn()}
        refreshing={false}
      />
    );
    expect(screen.queryByText("统计")).not.toBeInTheDocument();
    expect(screen.queryByText("快捷操作")).not.toBeInTheDocument();
    // Brand text hidden but BrandHeader icon still present
    expect(screen.getByText("auto_stories")).toBeInTheDocument();
  });

  it("forwards refresh / plaza / console / more callbacks to QuickActions", () => {
    const onRefresh = vi.fn();
    const onOpenPlaza = vi.fn();
    const onOpenConsole = vi.fn();
    const onOpenMore = vi.fn();
    render(
      <StatsSidebar
        stats={SAMPLE_STATS}
        statsLoading={false}
        onRefresh={onRefresh}
        refreshing={false}
        onOpenPlaza={onOpenPlaza}
        onOpenConsole={onOpenConsole}
        onOpenMore={onOpenMore}
      />
    );
    screen.getByTestId("qa-refresh").click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    screen.getByTestId("qa-prompt-square").click();
    expect(onOpenPlaza).toHaveBeenCalledTimes(1);
    screen.getByTestId("qa-ai-console").click();
    expect(onOpenConsole).toHaveBeenCalledTimes(1);
    screen.getByTestId("qa-more").click();
    expect(onOpenMore).toHaveBeenCalledTimes(1);
  });

  it("shows 加载中… when statsLoading is true", () => {
    render(
      <StatsSidebar
        stats={null}
        statsLoading
        onRefresh={() => {}}
        refreshing={false}
      />
    );
    expect(screen.getByText("加载中…")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd frontend && npm test -- --run StatsSidebar 2>&1 | tail -10`
Expected: PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/test/StatsSidebar.test.tsx
git commit -m "test(home): update StatsSidebar selectors for ds/* composition"
```

---

## Task 7: BookShelf — rewrite as table + toolbar

**Files:**
- Modify: `frontend/src/components/home/BookShelf.tsx`

The current `BookShelf.tsx` renders a horizontal scroll of cards. Replace it with a sortable / filterable table that uses `ds/ProjectTableRow` and a toolbar that uses `ds/SearchInput`, `ds/DropdownSelect`, `ds/PrimaryButton`, and `ds/SecondaryButton` (for the toolbar delete). Add bulk-selection state and a confirmation modal via `BulkDeleteModal`.

- [ ] **Step 1: Replace file contents**

Open `frontend/src/components/home/BookShelf.tsx`. Replace its entire content with:

```tsx
import { useMemo, useState } from "react";
import api, { ProjectSummary } from "../../api/client";
import {
  DropdownSelect, GhostButton, PrimaryButton, ProjectTableRow,
  SearchInput, SecondaryButton,
} from "../ds";
import { isPreWizardStage } from "../ds/stages";
import BulkDeleteModal from "./BulkDeleteModal";

type SortKey = "default" | "title" | "chapter_count" | "word_count" | "target_total_words" | "updated_at";
type SortDir = "asc" | "desc";

interface BookShelfProps {
  projects: ProjectSummary[];
  loading: boolean;
  onProjectsDeleted: (deletedIds: string[]) => void;
  /** Fires when the user clicks the toolbar "+ 新建项目" button. HomePage
   *  uses this to open the InitWizardModal (replaces the old CreateProjectCard). */
  onCreateProject?: () => void;
  /** Fires when the user clicks a row whose stage is pre-wizard (INIT/STAGE1-3).
   *  HomePage uses this to re-open the InitWizardModal at the right step. */
  onResumeWizard?: (projectId: string) => void;
}

const GENRE_OPTIONS = [
  { value: "all", label: "全部题材" },
  { value: "xuanhuan", label: "玄幻" },
  { value: "yanqing", label: "言情" },
];

const LENGTH_OPTIONS = [
  { value: "all", label: "全部分类" },
  { value: "短篇", label: "短篇" },
  { value: "标准连载", label: "标准连载" },
  { value: "长篇巨著", label: "长篇巨著" },
];

export default function BookShelf({ projects, loading, onProjectsDeleted, onCreateProject, onResumeWizard }: BookShelfProps) {
  const [search, setSearch] = useState("");
  const [genre, setGenre] = useState("all");
  const [length, setLength] = useState("all");
  const [filtersApplied, setFiltersApplied] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("default");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const filtered = useMemo(() => {
    let list = projects;
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) => p.title.toLowerCase().includes(q));
    if (filtersApplied) {
      if (genre !== "all") list = list.filter((p) => p.genre === genre);
      if (length !== "all") list = list.filter((p) => p.target_length_category === length);
    }
    return list;
  }, [projects, search, genre, length, filtersApplied]);

  const sorted = useMemo(() => {
    if (sortKey === "default") {
      return [...filtered].sort((a, b) => b.updated_at - a.updated_at);
    }
    const list = [...filtered];
    list.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey !== key) { setSortKey(key); setSortDir("asc"); return; }
    if (sortDir === "asc") setSortDir("desc");
    else { setSortKey("default"); setSortDir("desc"); }
  }

  const empty = !loading && projects.length === 0;
  const filteredEmpty = !loading && projects.length > 0 && sorted.length === 0;

  return (
    <section data-testid="book-shelf" className="space-y-3">
      <header className="flex items-center gap-3 flex-wrap">
        <h2 className="font-display text-headline-lg-mobile text-primary">书架</h2>
        <span className="font-mono text-label-sm text-on-surface-variant">
          {loading ? "加载中…" : `共 ${projects.length} 本`}
        </span>
        <div className="flex-1" />
        <SearchInput value={search} onChange={setSearch} />
        <DropdownSelect label="题材" options={GENRE_OPTIONS} value={genre} onChange={setGenre} />
        <DropdownSelect label="篇幅" options={LENGTH_OPTIONS} value={length} onChange={setLength} />
        <PrimaryButton label="查询" icon="search" onClick={() => setFiltersApplied(true)} />
        <PrimaryButton label="+ 新建项目" icon="plus" onClick={() => onCreateProject?.()} />
      </header>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-surface-container border border-outline-variant rounded">
          <span className="font-mono text-body-md text-on-surface">
            {selectedIds.size} 已选
          </span>
          <SecondaryButton label="删除" variant="destructive" icon="delete" onClick={() => setConfirmOpen(true)} />
          <GhostButton label="取消" onClick={() => setSelectedIds(new Set())} />
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-on-surface-variant">
          <span className="material-symbols-outlined text-3xl animate-spin">progress_activity</span>
          <div className="mt-2 font-body text-body-md">加载中…</div>
        </div>
      ) : empty ? (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-on-surface-variant/20 mb-3 block">
            auto_stories
          </span>
          <p className="font-body text-body-md text-on-surface-variant">
            还没有项目，点击「+ 新建项目」开始
          </p>
        </div>
      ) : filteredEmpty ? (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-on-surface-variant/20 mb-3 block">
            search_off
          </span>
          <p className="font-body text-body-md text-on-surface-variant mb-3">未找到匹配项目</p>
          <GhostButton label="清空筛选" onClick={() => { setSearch(""); setGenre("all"); setLength("all"); setFiltersApplied(false); }} />
        </div>
      ) : (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-lg overflow-hidden">
          <div className="grid grid-cols-[40px_2fr_1fr_1fr_1fr_1fr_120px] items-center py-2 px-3 border-b border-outline-variant font-mono text-label-sm uppercase tracking-wider text-on-surface-variant">
            <div />
            <button onClick={() => toggleSort("title")}>项目详情</button>
            <button onClick={() => toggleSort("chapter_count")} className="text-center">章节</button>
            <button onClick={() => toggleSort("word_count")} className="text-center">字数</button>
            <button onClick={() => toggleSort("target_total_words")} className="text-center">篇幅</button>
            <button onClick={() => toggleSort("updated_at")} className="text-right">最后编辑</button>
          </div>
          {sorted.map((p) => (
            <ProjectTableRow
              key={p.id}
              project={p}
              selected={selectedIds.has(p.id)}
              onClick={() => {
                if (isPreWizardStage(p.current_stage)) {
                  onResumeWizard?.(p.id);
                } else {
                  window.location.assign(`/${p.id}/stage4`);
                }
              }}
              onSelectChange={(sel) => {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (sel) next.add(p.id); else next.delete(p.id);
                  return next;
                });
              }}
            />
          ))}
        </div>
      )}

      <BulkDeleteModal
        isOpen={confirmOpen}
        selectedIds={[...selectedIds]}
        selectedTitles={sorted.filter((p) => selectedIds.has(p.id)).map((p) => p.title)}
        onConfirm={async () => {
          try {
            await api.bulkDeleteProjects([...selectedIds]);
          } catch {
            // swallow — HomePage will refresh and reflect server truth
          }
          const deleted = [...selectedIds];
          onProjectsDeleted(deleted);
          setSelectedIds(new Set());
          setConfirmOpen(false);
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Run BookShelf test (will fail — assertions rewritten in next task)**

Run: `cd frontend && npm test -- --run BookShelf 2>&1 | tail -30`
Expected: existing test fails because cards are gone. Task 8 rewrites it.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/home/BookShelf.tsx
git commit -m "feat(home): BookShelf is now a sortable/filterable table with bulk-delete"
```

---

## Task 8: BookShelf test — rewrite for table

**Files:**
- Modify: `frontend/src/test/BookShelf.test.tsx`

The existing test asserts on a horizontal card layout. Replace it with table-specific assertions: columns, rows, sort, filter, bulk selection.

- [ ] **Step 1: Replace test file contents**

Open `frontend/src/test/BookShelf.test.tsx`. Replace its entire content with:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import BookShelf from "../components/home/BookShelf";
import api from "../api/client";
import type { ProjectSummary } from "../api/client";

const PROJECTS: ProjectSummary[] = [
  {
    id: "p1", title: "翻天", genre: "xuanhuan", current_stage: "STAGE4",
    created_at: "2026-01-01T00:00:00Z", updated_at: 1700000000,
    min_words: 1000, target_total_words: 200000, target_length_category: "标准连载",
    chapter_count: 118, word_count: 452000,
  },
  {
    id: "p2", title: "另一书", genre: "yanqing", current_stage: "COMPLETED",
    created_at: "2026-01-02T00:00:00Z", updated_at: 1700000100,
    min_words: 1000, target_total_words: 50000, target_length_category: "短篇",
    chapter_count: 23, word_count: 121000,
  },
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "bulkDeleteProjects").mockResolvedValue({
    deleted: ["p1"],
    skipped: [],
  } as Awaited<ReturnType<typeof api.bulkDeleteProjects>>);
});

describe("BookShelf table", () => {
  it("renders one row per project with stats columns", () => {
    render(<BookShelf projects={PROJECTS} loading={false} onProjectsDeleted={() => {}} />);
    expect(screen.getByText("翻天")).toBeInTheDocument();
    expect(screen.getByText("另一书")).toBeInTheDocument();
    expect(screen.getByText("118")).toBeInTheDocument();
    expect(screen.getByText("45.2w")).toBeInTheDocument();
    expect(screen.getByText("23")).toBeInTheDocument();
    expect(screen.getByText("12.1w")).toBeInTheDocument();
  });

  it("shows the loading spinner when loading is true and projects is empty", () => {
    render(<BookShelf projects={[]} loading onProjectsDeleted={() => {}} />);
    expect(screen.getByText("加载中…")).toBeInTheDocument();
  });

  it("shows the empty state when there are no projects at all", () => {
    render(<BookShelf projects={[]} loading={false} onProjectsDeleted={() => {}} />);
    expect(screen.getByText(/还没有项目/)).toBeInTheDocument();
  });

  it("filters by search input in real time", () => {
    render(<BookShelf projects={PROJECTS} loading={false} onProjectsDeleted={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "翻天" } });
    expect(screen.getByText("翻天")).toBeInTheDocument();
    expect(screen.queryByText("另一书")).not.toBeInTheDocument();
  });

  it("exposes the bulk action bar after a row is selected", () => {
    render(<BookShelf projects={PROJECTS} loading={false} onProjectsDeleted={() => {}} />);
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    expect(screen.getByText(/1 已选/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument();
  });

  it("opens BulkDeleteModal when 删除 is clicked and forwards IDs on confirm", async () => {
    const onDeleted = vi.fn();
    render(<BookShelf projects={PROJECTS} loading={false} onProjectsDeleted={onDeleted} />);
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "删除" }));
    // Wait for the awaited api.bulkDeleteProjects to resolve
    await new Promise((r) => setTimeout(r, 0));
    expect(onDeleted).toHaveBeenCalledWith(["p1"]);
    expect(api.bulkDeleteProjects).toHaveBeenCalledWith(["p1"]);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd frontend && npm test -- --run BookShelf 2>&1 | tail -30`
Expected: PASS (6 tests). The `api.bulkDeleteProjects` mock resolves immediately so `onProjectsDeleted` fires after the next microtask.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/test/BookShelf.test.tsx
git commit -m "test(home): rewrite BookShelf assertions for table + bulk-delete UX"
```

---

## Task 9: HomePage.tsx — wire new components

**Files:**
- Modify: `frontend/src/pages/HomePage.tsx`

The current HomePage renders `<StatsSidebar> + <ManifestoHeader> + <CreateProjectCard> + <BookShelf> + modals`. After this task: `<StatsSidebar> + <BookShelf> + modals` (ManifestoHeader and CreateProjectCard are deleted; the `+ 新建项目` button inside BookShelf's toolbar opens `InitWizardModal`).

- [ ] **Step 1: Replace imports**

Open `frontend/src/pages/HomePage.tsx`. Replace the import block (lines 1–11) with:

```tsx
import { useState, useCallback, useEffect } from "react";
import api, { type ProjectSummary } from "../api/client";
import StatsSidebar from "../components/home/StatsSidebar";
import BookShelf from "../components/home/BookShelf";
import InitWizardModal from "../components/wizard/InitWizardModal";
import PromptPlazaModal from "../components/home/promptPlaza/PromptPlazaModal";
import AIConsoleModal from "../components/aiConsole/AIConsoleModal";
import MoreActionsModal from "../components/home/MoreActionsModal";
import { useProjectStats } from "../hooks/useProjectStats";
```

The `CreateProjectCard` import is removed (file deleted in Task 14). `ManifestoHeader` is removed (file deleted in Task 14). `StatsSidebar` is unchanged.

- [ ] **Step 2: Add wizard-resume + create-project handlers**

Inside `HomePage`, define two new callbacks alongside the existing `handleCreate`:

```tsx
const handleResumeWizard = useCallback((projectId: string) => {
  setWizardProjectId(projectId);
}, []);

const handleCreateProject = useCallback(() => {
  // Opens the InitWizardModal in "from scratch" mode. The InitWizardModal
  // distinguishes "create new" vs "resume existing" by whether
  // wizardProjectId is set to a non-existent project id; for a brand-new
  // project, pass an empty string. Adjust per InitWizardModal's API if it
  // requires a projectId for new projects too.
  setWizardProjectId("");
}, []);
```

Place these after the existing `handleCreate` callback (around line 80).

- [ ] **Step 3: Replace main content**

Replace the `<main>` JSX (the chunk between `<StatsSidebar ... />` and the modal block) with:

```tsx
<main className="flex-1 min-w-0 px-8 py-8 max-w-[1200px] mx-auto">
  <BookShelf
    projects={projects}
    loading={projectsLoading}
    onProjectsDeleted={handleProjectsDeleted}
    onCreateProject={handleCreateProject}
    onResumeWizard={handleResumeWizard}
  />
</main>
```

The `+ 新建项目` button inside BookShelf's toolbar now opens the InitWizardModal via `handleCreateProject`. Row clicks on pre-wizard stages reopen the modal at the saved step via `handleResumeWizard`.

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Run HomePage test (will fail — assertions rewritten next task)**

Run: `cd frontend && npm test -- --run HomePage 2>&1 | tail -30`
Expected: existing test fails because `ManifestoHeader` is gone. Task 10 rewrites it.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/HomePage.tsx
git commit -m "refactor(home): HomePage composes StatsSidebar + BookShelf (table); drop ManifestoHeader + CreateProjectCard"
```

---

## Task 10: HomePage test — rewrite

**Files:**
- Modify: `frontend/src/test/HomePage.test.tsx`

The existing test asserts on `ManifestoHeader`, `CreateProjectCard`, and `BookShelf`. After this task, only `StatsSidebar` and `BookShelf` (now table) are mounted.

- [ ] **Step 1: Replace test file contents**

Open `frontend/src/test/HomePage.test.tsx`. Replace its entire content with:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import HomePage from "../pages/HomePage";

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem("storyforge.home.sidebar.collapsed");
});

describe("HomePage", () => {
  it("renders StatsSidebar and BookShelf table after projects load", async () => {
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByTestId("stats-sidebar") || screen.getByTestId("book-shelf")).toBeTruthy();
    });
    expect(screen.getByText("Nebula Forge")).toBeInTheDocument();
  });

  it("shows the bookshelf empty state when there are no projects", async () => {
    vi.spyOn(global, "fetch").mockImplementation((url) => {
      if (typeof url === "string" && url.includes("/api/project/list")) {
        return Promise.resolve(new Response(JSON.stringify({ error: false, detail: [] })));
      }
      if (typeof url === "string" && url.includes("/api/project/stats")) {
        return Promise.resolve(new Response(JSON.stringify({ error: false, detail: {} })));
      }
      return Promise.resolve(new Response("{}"));
    });
    render(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText(/还没有项目/)).toBeInTheDocument();
    });
  });
});
```

Note: depending on how StatsSidebar renders, the test may need to query `screen.getByText("Nebula Forge")` after `StatsSidebar` mounts, which only happens after the parent provides a `stats` value. If `useProjectStats` returns `null` initially and `StatsSidebar` doesn't render the brand until stats load, drop the brand assertion in the first test.

- [ ] **Step 2: Run test to verify it passes**

Run: `cd frontend && npm test -- --run HomePage 2>&1 | tail -10`
Expected: PASS (2 tests). Adjust mocks for any unmocked fetch paths your local HomePage triggers (e.g., `useGenres`, `useProjectStats`).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/test/HomePage.test.tsx
git commit -m "test(home): rewrite HomePage assertions for table-based BookShelf"
```

---

## Task 11: Modal token refresh — MoreActionsModal

**Files:**
- Modify: `frontend/src/components/home/MoreActionsModal.tsx`

- [ ] **Step 1: Apply token replacements**

Open `frontend/src/components/home/MoreActionsModal.tsx`. Apply the cheat-sheet replacements:

| Find | Replace |
|---|---|
| `font-headline-md` | `font-display text-title-md` |
| `text-system-log` | `text-on-surface-variant` |
| Hardcoded `#020617` / `#171f33` / `#00f0ff` in `swatches` (decorative) | Keep — these are theme-preview swatches and intentionally literal |

- [ ] **Step 2: Run MoreActionsModal test**

Run: `cd frontend && npm test -- --run MoreActionsModal 2>&1 | tail -10`
Expected: PASS — MoreActionsModal.test.tsx is unchanged (per spec) and the swap is cosmetic.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/home/MoreActionsModal.tsx
git commit -m "refactor(home): MoreActionsModal adopts Material 3 token classes"
```

---

## Task 12: Modal token refresh — promptPlaza subdirectory

**Files:**
- Modify: `frontend/src/components/home/promptPlaza/PromptPlazaModal.tsx`
- Modify: `frontend/src/components/home/promptPlaza/PromptListPanel.tsx`
- Modify: `frontend/src/components/home/promptPlaza/PromptEditPanel.tsx`
- Modify: `frontend/src/components/home/promptPlaza/AdvancedSection.tsx`

- [ ] **Step 1: Apply token replacements across the 4 files**

For each file, apply the cheat-sheet replacements:
- `text-system-log` → `text-on-surface-variant`
- `font-label-mono` → `font-mono`
- `font-headline-md` → `font-display text-title-md`
- `font-body-ui` → `font-body text-body-md`
- `font-body-narrative` → `font-body text-body-lg`
- `font-display-lg` → `font-display text-headline-lg`

Do not change behavior. Do not extract new components. Just className swaps.

- [ ] **Step 2: Run promptPlaza tests**

Run: `cd frontend && npm test -- --run promptPlaza 2>&1 | tail -20`
Expected: PASS (per spec, PromptPlazaModal.test.tsx is unchanged).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/home/promptPlaza/
git commit -m "refactor(prompt-plaza): adopt Material 3 token classes (no logic change)"
```

---

## Task 13: Modal token refresh — AIConsoleModal

**Files:**
- Modify: `frontend/src/components/aiConsole/AIConsoleModal.tsx`
- Modify (if they use legacy tokens): `frontend/src/components/aiConsole/AgentMappingPanel.tsx`
- Modify (if they use legacy tokens): `frontend/src/components/aiConsole/ProviderPanel.tsx`
- Modify (if they use legacy tokens): `frontend/src/components/aiConsole/TierPanel.tsx`
- Modify (if they use legacy tokens): `frontend/src/components/aiConsole/UsagePanel.tsx`

- [ ] **Step 1: Apply token replacements across the file(s)**

For each file, apply the cheat-sheet replacements. Use `grep -l "text-system-log\|font-label-mono\|font-display-lg\|font-body-narrative\|font-body-ui" frontend/src/components/aiConsole/` to confirm which files actually need touching.

- [ ] **Step 2: Run AIConsoleModal test**

Run: `cd frontend && npm test -- --run 'AIConsole|ProviderPanel|TierPanel|AgentMappingPanel|UsagePanel' 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/aiConsole/
git commit -m "refactor(ai-console): adopt Material 3 token classes (no logic change)"
```

---

## Task 14: Modal token refresh — InitWizardModal

**Files:**
- Modify: `frontend/src/components/wizard/InitWizardModal.tsx`
- Modify (if they use legacy tokens): `frontend/src/components/wizard/ConceptStep.tsx`, `WorldStep.tsx`, `MapStep.tsx`, `OutlineStep.tsx`, `CharacterStep.tsx`, `BehaviorExamplesSection.tsx`, `WizardSteps.tsx`, `WizardContext.tsx`, `ChapterOutlineStep.tsx`, `CharacterRelationsEditor.tsx`

- [ ] **Step 1: Apply token replacements across the file(s)**

For each file, apply the cheat-sheet replacements. Note: `InitWizardModal` is OUT OF SCOPE for visual changes per the spec — only the token-color refresh applies. Do not change behavior or extract components.

- [ ] **Step 2: Run wizard tests**

Run: `cd frontend && npm test -- --run 'Wizard|ChapterOutline|Concept|Character|World|Map|Outline|BehaviorExamples' 2>&1 | tail -20`
Expected: PASS. Pre-existing failures unrelated to token swaps are out of scope; fix only token-induced regressions.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/wizard/
git commit -m "refactor(wizard): adopt Material 3 token classes (no logic change)"
```

---

## Task 15: Cleanup — delete obsolete files

**Files:**
- Delete: `frontend/src/components/home/CreateProjectCard.tsx`
- Delete: `frontend/src/test/CreateProjectCard.test.tsx`
- Delete: `frontend/src/components/home/ManifestoHeader.tsx`
- Delete: `frontend/src/components/home/StageDistribution.tsx`
- Delete: `frontend/src/components/home/StatCard.tsx`
- Delete: `frontend/src/components/home/BookShelfModal.tsx`
- Delete: `frontend/src/test/BookShelfModal.test.tsx`
- Delete: `frontend/src/components/home/stages.ts`

- [ ] **Step 1: Verify no remaining consumers**

Run: `grep -rln "CreateProjectCard\|ManifestoHeader\|StageDistribution\|home/StatCard\|home.StatCard\|BookShelfModal\|from \"./stages\"" frontend/src/ 2>&1`
Expected: empty output (zero consumers). If anything remains, refactor it to use the `ds/*` replacement before deleting.

- [ ] **Step 2: Delete the files**

```bash
git rm frontend/src/components/home/CreateProjectCard.tsx
git rm frontend/src/test/CreateProjectCard.test.tsx
git rm frontend/src/components/home/ManifestoHeader.tsx
git rm frontend/src/components/home/StageDistribution.tsx
git rm frontend/src/components/home/StatCard.tsx
git rm frontend/src/components/home/BookShelfModal.tsx
git rm frontend/src/test/BookShelfModal.test.tsx
git rm frontend/src/components/home/stages.ts
```

- [ ] **Step 3: Type-check + run full frontend suite**

Run: `cd frontend && npx tsc --noEmit && npm test -- --run 2>&1 | tail -40`
Expected: exit 0 + green tests. Pre-existing unrelated failures may remain; token-swap regressions should be fixed inline.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(home): delete 6 obsolete components + their tests after ds/* migration"
```

---

## Task 16: Final regression — backend + frontend green + push

**Files:** (no file changes)

- [ ] **Step 1: Run full backend test suite**

Run: `source venv/bin/activate && pytest tests/test_project_list.py tests/test_project_stats.py tests/test_project_bulk.py -v 2>&1 | tail -20`
Expected: ALL PASS — confirms the Plan 1 chapter_count + word_count fields don't regress any list/stats/bulk test.

- [ ] **Step 2: Run full frontend test suite**

Run: `cd frontend && npm test -- --run 2>&1 | tail -40`
Expected: ALL PASS — all 12 ds/* primitive tests + the rewritten StatsSidebar/BookShelf/HomePage tests + the untouched modal tests are green.

- [ ] **Step 3: Type-check backend (sanity)**

Run: `cd backend && python -c "from backend.api.project import list_projects; print('OK')"`
Expected: prints `OK`.

- [ ] **Step 4: Production build smoke-test**

Run: `cd frontend && npm run build 2>&1 | tail -20`
Expected: exit 0, no TypeScript or Vite errors. If any import path is broken (e.g., a forgotten reference to a deleted file), the build will surface it.

- [ ] **Step 5: Push the branch**

```bash
git push origin neweb 2>&1 | tail -5
```

Expected: a series of new commits pushed (Plan 2 commits + Plan 3 commits). No errors.

- [ ] **Step 6: Final summary to user**

Tell the user:
- Plan 3 complete; HomePage refactored to use the Nebula Forge design system end-to-end.
- Brand reads "Nebula Forge"; tagline preserved; bookshelf is now a sortable/filterable table with bulk-delete.
- All 6 obsolete components + their tests deleted; all 12 ds/* primitives wired in.
- Backend exposes per-project chapter_count + word_count; all backend + frontend tests green.
- Recommend opening the dev server and clicking through the toolbar / sort / bulk-delete / modals to visually confirm.