# Nebula Forge Homepage Refactor — Design Spec

**Date:** 2026-08-27
**Branch:** `neweb`
**Status:** Awaiting user review

## Background

The current StoryForge HomePage uses a horizontal-card Bookshelf layout and a cyan-accent Material 3 token palette that predates the "Nebula Forge" design system. The new design (`docs/design/webmain/DESIGN.md` + `screen.png`) restructures the Bookshelf into a table, swaps the accent palette to a sky-blue / Electric Blue system, adds a brand rename, and introduces a toolbar Delete action. This spec scopes a strict refactor of the HomePage surface (no Workspace, no Wizard pages).

## Goals

1. Apply the Nebula Forge design system to **HomePage** only — sidebar, toolbar, Bookshelf table, all four HomePage-resident modals.
2. Rename the brand from `StoryForge` to `Nebula Forge` everywhere visible on the HomePage.
3. Restructure the Bookshelf from horizontal scrolling cards to a sortable / filterable table that fits all projects on a single screen.
4. Extract reusable design-system primitives into `frontend/src/components/ds/` so future pages can adopt the system with low cost.
5. Keep the backend API surface small: one field-extension on `ProjectSummary`, no new endpoints.

## Non-Goals

- Workspace pages, Wizard pages, Stage pages, and all non-HomePage routes are out of scope for visual changes. They will pick up token-only color updates automatically because the underlying CSS variables change, but no layout or component changes will be made to them.
- No authentication / login page. The user's reference to a "login page" was a misnomer for the HomePage entry route.
- No light-mode theme. The Nebula Forge spec is dark-mode only.
- No new feature scope: bulk-delete UX exists today in `BookShelfModal`; this refactor moves it into the new table rather than redesigning the flow.

## Architecture & File Structure

A new `frontend/src/components/ds/` (design system) directory holds the primitives. HomePage feature components stay where they are but are rewritten to compose the primitives.

```
frontend/src/components/
├── ds/                                  ← NEW
│   ├── tokens.ts                        ← Design token constants (TS enum)
│   ├── BrandHeader.tsx
│   ├── PrimaryButton.tsx
│   ├── SecondaryButton.tsx
│   ├── GhostButton.tsx
│   ├── SearchInput.tsx
│   ├── DropdownSelect.tsx
│   ├── StatCard.tsx
│   ├── PanelCard.tsx
│   ├── PhaseIndicator.tsx
│   ├── ProjectTableRow.tsx
│   ├── Sidebar.tsx
│   ├── SidebarNavItem.tsx
│   └── index.ts                         ← barrel export
├── home/                                ← REWRITTEN
│   ├── StatsSidebar.tsx                 ← Uses ds/* components
│   ├── BookShelf.tsx                    ← Renders table + ProjectTableRow
│   ├── BulkDeleteModal.tsx              ← NEW (replaces BookShelfModal)
│   ├── MoreActionsModal.tsx             ← Token refresh only
│   ├── QuickActions.tsx                 ← REWRITTEN — composes ds/SecondaryButton + ds/GhostButton
│   ├── StageDistribution.tsx            ← DELETED (replaced by ds/PhaseIndicator)
│   ├── ManifestoHeader.tsx              ← DELETED (replaced by ds/BrandHeader)
│   ├── CreateProjectCard.tsx            ← DELETED
│   ├── StatCard.tsx                     ← DELETED (replaced by ds/StatCard)
│   ├── stages.ts                        ← UNCHANGED
│   └── promptPlaza/                     ← Token refresh only
├── aiConsole/AIConsoleModal.tsx         ← Token refresh only
└── wizard/InitWizardModal.tsx           ← Token refresh only
```

`pages/HomePage.tsx` keeps the same overall shape (`<StatsSidebar> + <main>` + modals) but all child components are swapped for ds/* versions.

### Key decisions

- **Tailwind config is not changed at the utility-class level.** Existing utility classes (`bg-primary`, `text-on-surface`, `bg-surface-container`, etc.) already map to `var(--color-*)`. Only the underlying CSS variable values change in `globals.css`.
- **Typography stack stays in `tailwind.config.ts`** (Hanken Grotesk / Inter / JetBrains Mono) and gets extended with a `fontSize` token table matching the design doc.
- **Vitest + jsdom test infrastructure is unchanged.** Tests are rewritten, not migrated.
- **Backend is touched only at `list_projects()`** to surface per-project chapter / word counts.

## Token Migration

### CSS variable value swaps (`frontend/src/styles/globals.css`)

Replace every `--color-*` value in the `:root` block with the Nebula Forge value from the design doc. The variable NAMES stay the same; only the hex values change.

| CSS variable | Old value | New value |
|---|---|---|
| `--color-background` | `#0b1326` | `#051424` |
| `--color-on-background` | `#dae2fd` | `#d4e4fa` |
| `--color-surface` | `#0b1326` | `#051424` |
| `--color-surface-dim` | `#0b1326` | `#051424` |
| `--color-surface-bright` | `#31394d` | `#2c3a4c` |
| `--color-surface-container-lowest` | `#060e20` | `#010f1f` |
| `--color-surface-container-low` | `#131b2e` | `#0d1c2d` |
| `--color-surface-container` | `#171f33` | `#122131` |
| `--color-surface-container-high` | `#222a3d` | `#1c2b3c` |
| `--color-surface-container-highest` | `#2d3449` | `#273647` |
| `--color-surface-variant` | `#2d3449` | `#273647` |
| `--color-on-surface` | `#dae2fd` | `#d4e4fa` |
| `--color-on-surface-variant` | `#b9cacb` | `#bdc8d1` |
| `--color-inverse-surface` | `#dae2fd` | `#d4e4fa` |
| `--color-inverse-on-surface` | `#283044` | `#233143` |
| `--color-outline` | `#849495` | `#87929a` |
| `--color-outline-variant` | `#334155` | `#3e484f` |
| `--color-surface-tint` | `#00dbe9` | `#7bd0ff` |
| `--color-primary` | `#dbfcff` | `#8ed5ff` |
| `--color-on-primary` | `#00363a` | `#00354a` |
| `--color-primary-container` | `#00f0ff` | `#38bdf8` |
| `--color-on-primary-container` | `#006970` | `#004965` |
| `--color-inverse-primary` | `#006970` | `#00668a` |
| `--color-primary-fixed` | `#7df4ff` | `#c4e7ff` |
| `--color-primary-fixed-dim` | `#00dbe9` | `#7bd0ff` |
| `--color-on-primary-fixed` | `#002022` | `#001e2c` |
| `--color-on-primary-fixed-variant` | `#004f54` | `#004c69` |
| `--color-secondary` | `#d0bcff` | `#bcc7de` |
| `--color-on-secondary` | `#3c0091` | `#263143` |
| `--color-secondary-container` | `#571bc1` | `#3e495d` |
| `--color-on-secondary-container` | `#c4abff` | `#aeb9d0` |
| `--color-tertiary` | `#d8ffe7` | `#c5cce6` |
| `--color-error` | `#ffb4ab` | `#ffb4ab` |
| `--color-on-error` | `#690005` | `#690005` |
| `--color-error-container` | `#93000a` | `#93000a` |
| `--color-on-error-container` | `#ffdad6` | `#ffdad6` |

### Legacy canvas-* tokens (96 usages across 10+ files)

The variables keep their existing names — only the hex values change. The strategy is to **redirect them to design-doc values** without renaming, so existing `bg-canvas-bg` / `text-canvas-accent` utility classes stay functional:

| CSS variable | Old value | New value | Equivalent to |
|---|---|---|---|
| `--color-canvas-bg` | `#020617` | `#051424` | `background` |
| `--color-canvas-surface` | `#0b1326` | `#122131` | `surface-container` |
| `--color-canvas-text-muted` | `#64748b` | `#bdc8d1` | `on-surface-variant` |
| `--color-canvas-text-secondary` | `#b9cacb` | `#d4e4fa` | `on-surface` |
| `--color-canvas-accent` | `#00dbe9` | `#7bd0ff` | `surface-tint` |

This means 96 existing usages (across HomePage, Workspace, aiConsole, etc.) automatically pick up the new colors with **zero file edits**. Workspace pages pick up new color values too — that's an intentional, in-scope token refresh, not a layout change.

### Typography tokens (Tailwind `fontSize` extension)

Add the design-doc sizes to `tailwind.config.ts` under `theme.fontSize`:

| Token | font | size | weight | line-height |
|---|---|---|---|---|
| `display-lg` | Hanken Grotesk | 48px | 700 | 56px |
| `headline-lg` | Hanken Grotesk | 32px | 600 | 40px |
| `headline-lg-mobile` | Hanken Grotesk | 24px | 600 | 32px |
| `title-md` | Hanken Grotesk | 20px | 500 | 28px |
| `body-lg` | Inter | 18px | 400 | 30px |
| `body-md` | Inter | 16px | 400 | 24px |
| `label-sm` | JetBrains Mono | 12px | 500 | 16px |
| `stats-number` | JetBrains Mono | 24px | 600 | 32px |

### Rounded & spacing

Existing Tailwind defaults cover the design-doc rounded values (`rounded-sm` 2px, `rounded` 4px, `rounded-md` 6px, `rounded-lg` 8px, `rounded-full` 9999px) — no config change needed. Spacing values (xs=8, sm=16, md=24, lg=40, xl=64) map cleanly to Tailwind's default scale.

## Design-System Primitives

All primitives live in `frontend/src/components/ds/` and are exported via `index.ts`. Each has a colocated `*.test.tsx`.

### Buttons

**`PrimaryButton`** — solid Electric Blue main trigger (used for "查询", "+ 新建项目").

```ts
interface PrimaryButtonProps {
  label: string;
  icon?: "plus" | "search" | "delete";
  iconPosition?: "leading" | "trailing"; // default "leading"
  size?: "sm" | "md";                    // default "md"
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}
```

Styling: `bg-primary text-on-primary rounded px-4 py-2 hover:bg-primary-container transition`. Loading state replaces the icon with a spinner and disables clicks.

**`SecondaryButton`** — Slate border + hover fill (used for "删除", Modal actions).

```ts
interface SecondaryButtonProps {
  label: string;
  icon?: "plus" | "search" | "delete";
  variant?: "default" | "destructive"; // destructive → red border
  size?: "sm" | "md";
  disabled?: boolean;
  onClick: () => void;
}
```

Styling: `bg-surface-container border border-outline-variant text-on-surface rounded px-4 py-2 hover:bg-surface-container-high`. Destructive: `border-error-container text-error`.

**`GhostButton`** — text-only link-style (used for "查看全部 →", "清空搜索").

```ts
interface GhostButtonProps {
  label: string;
  size?: "sm" | "md";
  disabled?: boolean;
  onClick: () => void;
}
```

Styling: `text-on-surface-variant hover:text-primary text-sm font-mono`.

### Inputs

**`SearchInput`** — dark-filled input with leading search icon, Electric Blue focus border.

```ts
interface SearchInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string; // default "搜索项目…"
  width?: string;             // default "w-60"
}
```

Styling: `bg-surface-container border border-outline-variant rounded pl-9 pr-3 py-1.5 text-sm text-primary placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary`. Icon container is absolutely positioned.

**`DropdownSelect`** — used for 题材 / 篇幅 / query triggers.

```ts
interface DropdownSelectProps {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
}
```

Styling: `bg-surface-container border border-outline-variant rounded px-3 py-1.5 text-sm text-primary flex items-center gap-1 hover:bg-surface-container-high`. Chevron rotates 180° in open state.

### Display

**`BrandHeader`** — sidebar logo + brand name + optional tagline. Replaces current `ManifestoHeader`.

```ts
interface BrandHeaderProps {
  brandName: string;        // "Nebula Forge"
  tagline?: string;         // default "让你的灵感长出血肉"
  iconName?: string;        // default "auto_stories"
  collapsed?: boolean;      // true → icon only
}
```

Styling: `flex items-center gap-2`. Icon: `material-symbols-outlined text-primary-container text-2xl`. Brand name: `font-display text-primary text-lg`.

**`StatCard`** — replaces current `StatCard`, gains `unit` prop and optional sparkline slot.

```ts
interface StatCardProps {
  label: string;
  value: number | string | null;     // null → render "—"
  sparkline?: React.ReactNode;
  size?: "sm" | "md";                // sm for sidebar, md for hero block
  unit?: string;                     // e.g. "k", "w"
}
```

Styling: `bg-surface-container-low border border-outline-variant rounded-lg p-3`. Label: `font-mono text-[10px] uppercase tracking-wider text-on-surface-variant`. Value: `font-mono text-2xl text-primary` (sm → `text-base`).

**`PanelCard`** — generic rounded-lg surface-container card with 1px outline. Used by every "card" in the system.

```ts
interface PanelCardProps {
  children: React.ReactNode;
  padding?: "sm" | "md" | "lg";     // default md = p-4
  interactive?: boolean; // hover:border-primary-container/40 + cursor-pointer
  onClick?: () => void;
}
```

Styling: `bg-surface-container-low border border-outline-variant rounded-lg`.

**`PhaseIndicator`** — vertical phase list with circular markers; active phase has a pulsing Electric Blue glow. Replaces current `StageDistribution`.

```ts
interface PhaseIndicatorProps {
  phases: Array<{
    key: string;
    label: string;
    count: number;
    active?: boolean;
    completed?: boolean;
  }>;
  onPhaseClick?: (key: string) => void;
}
```

Marker: `w-2 h-2 rounded-full bg-outline-variant`. Active: `bg-primary ring-4 ring-primary/20 animate-pulse`. Completed: solid `bg-primary`.

**`ProjectTableRow`** — single row of the new Bookshelf table.

```ts
interface ProjectTableRowProps {
  project: ProjectSummary;
  selected?: boolean;
  onClick?: () => void;         // Row body click — navigates to project
  onSelectChange?: (selected: boolean) => void;  // Checkbox toggle
}
```

Column grid: `grid-cols-[40px_2fr_1fr_1fr_1fr_1fr_120px]`. Hover: `bg-surface-container-low`. Selected: left `border-l-4 border-primary`. Row click and checkbox click are separate handlers (see Column layout note above) — `onClick` must NOT also fire on checkbox toggle.

Genre label is resolved via `useGenres(false)` (same hook the current `BookCard` uses) so the `奇幻` / `言情` etc. Chinese labels render regardless of API returning IDs or labels.

Status chip colors follow the existing `STAGE_COLORS` map, but with semantic Material 3 utility classes:

| Stage | Class |
|---|---|
| `INIT` | `bg-surface-tint/20 text-surface-tint` |
| `STAGE1` | `bg-blue-500/20 text-blue-300` |
| `STAGE2` | `bg-purple-500/20 text-purple-300` |
| `STAGE3` | `bg-amber-500/20 text-amber-300` |
| `STAGE4` | `bg-primary-container/20 text-primary-container` |
| `STAGE5` | `bg-pink-500/20 text-pink-300` |
| `STAGE6` | `bg-emerald-500/20 text-emerald-300` |
| `COMPLETED` | `bg-green-500/20 text-green-300` |

The map lives in a sibling `stages.ts` (extracted from `home/stages.ts`) so `ProjectTableRow` and any future stage-aware component share the same source.

### Layout

**`Sidebar`** — generic sidebar shell with collapsible behavior. Reuses the localStorage persistence pattern from current `StatsSidebar`.

```ts
interface SidebarProps {
  width?: number;                  // default 300
  collapsedWidth?: number;         // default 52
  collapsible?: boolean;           // default true
  persistKey?: string;             // default "ds.sidebar.collapsed"
  header?: React.ReactNode;        // BrandHeader
  children: React.ReactNode;
  footer?: React.ReactNode;
}
```

**`SidebarNavItem`** — single nav entry.

```ts
interface SidebarNavItemProps {
  icon: string;
  label: string;
  active?: boolean;
  onClick?: () => void;
  collapsed?: boolean;
}
```

Active: `bg-surface-container text-primary border-l-2 border-primary -ml-0.5 pl-3.5`. Inactive: `text-on-surface-variant hover:text-primary hover:bg-surface-container-low`.

## Bookshelf Restructure (cards → table)

### Backend extension

`backend/api/project.py:list_projects()` adds two fields per project to the response:

- `chapter_count: number` — read from `chapters.json` for the project.
- `word_count: number` — sum of draft word counts (reuse existing aggregation logic from `ProjectStats`).

`frontend/src/api/client.ts:ProjectSummary` interface extends with the same two fields. No new endpoint, no schema migration.

### New Bookshelf structure

```
┌──────────────────────────────────────────────────────────────────┐
│  [Search]    [题材▾] [篇幅▾] [查询] [+ 新建项目] [删除]           │  Toolbar
├──────────────────────────────────────────────────────────────────┤
│ ☐ │ 项目详情              │ 章节 │ 字数 │ 篇幅      │ 最后编辑    │  Header
├───┼──────────────────────┼──────┼──────┼───────────┼─────────────┤
│ ☐ │ 🖼 翻天 [奇幻][创作中] │ 118  │ 45.2w│ 标准连载   │ 2026-08-09  │
│ ☐ │ 🖼 另一书 [言情][已完成]│ 23   │ 12.1w│ 短篇       │ 2026-08-08  │
│ ☐ │ ...                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

### Column layout (CSS grid)

`grid-cols-[40px_2fr_1fr_1fr_1fr_1fr_120px]`

| Column | Width | Content | Sortable |
|---|---|---|---|
| ☐ | 40px | Selection checkbox (visible on row hover) | — |
| 项目详情 | 2fr | Cover icon + title + `[题材][状态]` tags | by title |
| 章节 | 1fr | Number (centered) | by chapter_count |
| 字数 | 1fr | `"45.2w"` (centered) | by word_count |
| 篇幅 | 1fr | Length category (centered) | by target_total_words |
| 最后编辑 | 120px | `YYYY-MM-DD` (right-aligned) | by updated_at (default DESC) |

### Interaction

- **Default sort:** `updated_at DESC` (matches current BookShelf behaviour).
- **Column sort:** Click header to sort by that column ASC; click again for DESC; third click clears sort back to default.
- **Toolbar filters:** 题材 / 篇幅 dropdowns are applied only when "查询" is clicked (matches screenshot toolbar layout). Search is real-time title filter.
- **Delete UX (Notion-style):**
  - Each row shows a checkbox on hover.
  - Selecting any row reveals a top action bar: `N 已选 · 删除 · 取消`.
  - Clicking 删除 opens a `BulkDeleteModal` confirmation, then calls `api.bulkDeleteProjects(selectedIds)`.
  - On success, `HomePage` removes those IDs from its `projects` state via `onProjectsDeleted`.
  - No `dontShowAgain` option. Confirmation modal is mandatory.

### States

The Bookshelf table handles three non-data states explicitly:

| State | Trigger | UI |
|---|---| |
| **Loading** | `projectsLoading === true` (initial fetch in flight) | Centered spinner + `加载中…` text in `text-on-surface-variant` |
| **Empty** | `projects.length === 0` (no projects at all) | `auto_stories` icon (large, dim) + `还没有项目，点击「+ 新建项目」开始` text in `text-on-surface-variant` |
| **Filtered empty** | `filtered.length === 0` but `projects.length > 0` | `search_off` icon + `未找到匹配项目` + `GhostButton label="清空筛选"` |

The action bar (`N 已选 · 删除 · 取消`) appears only when `selectedIds.length > 0` and replaces the table's empty state implicitly.

### Removed / merged

- `BookShelfModal.tsx` is **deleted**; replaced by `BulkDeleteModal.tsx` (confirmation only — the table itself shows all projects).
- `CreateProjectCard.tsx` (full-width form section) is **deleted**. The toolbar `+ 新建项目` button opens `InitWizardModal` directly via existing `handleCreate` flow in `HomePage`.
- `ManifestoHeader.tsx` is **deleted**; replaced by `ds/BrandHeader`.
- `StageDistribution.tsx` is **deleted**; replaced by `ds/PhaseIndicator`.
- `StatCard.tsx` (current) is **deleted**; replaced by `ds/StatCard`.

### `BulkDeleteModal` interface

```ts
interface BulkDeleteModalProps {
  /** Project IDs the user has selected via row checkboxes. */
  selectedIds: string[];
  /** Resolved titles for display in the confirmation prompt. */
  selectedTitles: string[];
  isOpen: boolean;
  onConfirm: () => void;          // calls api.bulkDeleteProjects
  onCancel: () => void;
}
```

Modal body shows `确定要删除以下 N 个项目吗？` followed by a scrollable list of selected titles (capped at 10 with `… 还有 N 个`). Confirm button uses `ds/SecondaryButton variant="destructive"`. Cancel uses `ds/GhostButton`.

## Brand Rename

`StoryForge` → `Nebula Forge` everywhere on the HomePage surface:

| Location | Old | New |
|---|---|---|
| `BrandHeader` brandName prop | `"StoryForge"` | `"Nebula Forge"` |
| `BrandHeader` tagline | `"让你的灵感长出血肉"` (unchanged) | unchanged |
| `HomePage` version chip | `"V0.1.0"` (unchanged) | unchanged |
| All HomePage-resident modal titles / buttons | no "StoryForge" copy currently | n/a |

No backend, CLAUDE.md, README, or package.json renames — those are out of scope and tracked separately.

## Testing Strategy

### New primitive tests (`frontend/src/components/ds/*.test.tsx`)

One test file per primitive, ~30-50 lines each, ≥80% line coverage target.

| Primitive | File | Key assertions |
|---|---|---|
| BrandHeader | `BrandHeader.test.tsx` | collapsed toggles text visibility; brandName string |
| PrimaryButton | `PrimaryButton.test.tsx` | loading → spinner + disabled; click callback |
| SecondaryButton | `SecondaryButton.test.tsx` | destructive variant → red border |
| GhostButton | `GhostButton.test.tsx` | click callback |
| SearchInput | `SearchInput.test.tsx` | placeholder default; onChange; focus → border-primary |
| DropdownSelect | `DropdownSelect.test.tsx` | options render; selection callback |
| StatCard | `StatCard.test.tsx` | null value → "—"; unit suffix; size switching |
| PanelCard | `PanelCard.test.tsx` | padding switching; interactive + onClick |
| PhaseIndicator | `PhaseIndicator.test.tsx` | active → ring + animate-pulse; click callback |
| ProjectTableRow | `ProjectTableRow.test.tsx` | selected → left border; onClick |
| Sidebar | `Sidebar.test.tsx` | collapse/expand + localStorage persistence |
| SidebarNavItem | `SidebarNavItem.test.tsx` | active → border-primary; collapsed → icon only |

### Rewritten / updated component tests

| File | Action | Notes |
|---|---|---|
| `HomePage.test.tsx` | rewrite | No CreateProjectCard; BookShelf is table |
| `BookShelf.test.tsx` | rewrite | Card → table assertions (columns, rows, sort, filter) |
| `BookShelfModal.test.tsx` | delete | Modal removed; logic moved to BulkDeleteModal |
| `BulkDeleteModal.test.tsx` | new | Checkbox + confirm + bulkDelete call |
| `CreateProjectCard.test.tsx` | delete | Component removed |
| `ManifestoHeader.test.tsx` | delete | Merged into `BrandHeader.test.tsx` |
| `StatsSidebar.test.tsx` | update | Uses ds/* children; selectors change |

### Modal tests (token refresh only — no logic change)

| File | Action |
|---|---|
| `InitWizardModal.test.tsx` | unchanged |
| `PromptPlazaModal.test.tsx` | unchanged |
| `AIConsoleModal.test.tsx` | unchanged |
| `MoreActionsModal.test.tsx` | unchanged |

### Backend test

Add or extend the existing `backend/tests/test_api_project_list.py` (or equivalent) with two assertions: `chapter_count == 3` and `word_count == 45200` for a fixture project, in the `GET /api/project/list` response.

### Test baseline

- Pre-refactor: ~62 backend + ~50 frontend tests.
- Post-refactor: ~62 backend + ~60 frontend tests (−3 deleted + ~13 new).
- Gate: `pytest` and `npm test` both fully green before commit.

## Implementation Order

1. **Backend** — Extend `list_projects()` to surface `chapter_count` + `word_count`; add backend test.
2. **Design tokens** — Update `globals.css` color variables; extend Tailwind `fontSize`; add `ds/tokens.ts`.
3. **Primitives (TDD)** — Write primitive tests first, then implement each primitive in `ds/`.
4. **Composing components** — Update `StatsSidebar`, write `BulkDeleteModal`, write `BookShelf` (table).
5. **Modal token refresh** — `InitWizardModal`, `PromptPlazaModal`, `AIConsoleModal`, `MoreActionsModal`.
6. **HomePage wiring** — Update `HomePage.tsx` to compose the new components; remove `CreateProjectCard` reference; remove `ManifestoHeader` reference.
7. **Brand rename** — Pass `"Nebula Forge"` through `BrandHeader`.
8. **Cleanup** — Delete `BookShelfModal.tsx`, `CreateProjectCard.tsx`, `ManifestoHeader.tsx`, `StageDistribution.tsx`, `StatCard.tsx` and their test files.
9. **Regression** — Run full `pytest` and `npm test`, fix any breakage.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Token-swap breaks Workspace / Stage visuals (out of scope but use the same variables) | Acceptable per design — token refresh is an intentional side-effect; layout / structure unchanged in those pages. |
| `chapter_count` / `word_count` computation is slow for many projects | Read only `chapters.json` and aggregate per existing `ProjectStats` logic; for ≤200 projects this is sub-100ms. Cache results per request. |
| New table layout breaks responsive design below 768px | First implementation targets desktop only. Tablet / mobile responsive is a follow-up issue (not blocking the design-doc compliance). |
| Test rewrite takes longer than implementation | Tests are written TDD-style alongside primitives, not as a separate phase. |

## Out of Scope (explicit)

- Workspace pages, Wizard pages, Stage pages — only token color refresh applies automatically.
- Light-mode theme.
- Mobile / tablet responsive layout for the new table.
- Bulk-edit (rename, change genre, etc.) — only bulk-delete is in scope.
- Backend performance optimizations beyond the `list_projects` extension.
- CLAUDE.md / README / package.json rebrand.

## Acceptance Criteria

- All four HomePage sections (sidebar, toolbar, Bookshelf table, brand header) match the design-doc screenshot visually.
- Brand copy reads "Nebula Forge" in the sidebar; tagline "让你的灵感长出血肉" is preserved.
- `ProjectSummary` exposes `chapter_count` and `word_count`; both columns render non-null for projects that have chapters.
- Toolbar Delete flow: select rows → action bar appears → confirm → rows disappear from list.
- All non-deleted vitest + pytest tests pass; ~13 new primitive tests pass.
- No new TypeScript or backend errors; `npm run build` succeeds.