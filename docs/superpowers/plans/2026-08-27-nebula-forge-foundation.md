# Nebula Forge Foundation — Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the foundation for the Nebula Forge homepage refactor: extend `GET /api/project/list` with per-project `chapter_count` + `word_count` fields, swap the CSS color palette to the Nebula Forge palette, extend Tailwind with design-doc typography tokens, centralize design tokens under `frontend/src/components/ds/tokens.ts`, and ship one Primitive (`BrandHeader`) to validate the `ds/` folder layout.

**Architecture:** Two-layer swap: (1) backend computes and returns two new fields per project by reading each project's `outline.json` (chapter count) and aggregating draft word counts under `chapters/*.md` (reuse the existing per-project aggregation pattern in `project.py:294-344`); (2) frontend token migration leaves utility-class API unchanged but rewires the underlying CSS variable values, so 96 existing `bg-canvas-*` usages upgrade for free. New `ds/` folder is introduced by `BrandHeader` alone in this plan — later plans fill in the rest.

**Tech Stack:** Python 3 + FastAPI + pytest + tempfile fixtures (backend); TypeScript + React 18 + Tailwind 3 + Vitest + jsdom (frontend). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-27-nebula-forge-homepage-refactor-design.md` (commit `bd0bed9`).

---

## Task 1: Backend test — list_projects returns chapter_count

**Files:**
- Test: `tests/test_project_list.py` (modify, append a new test function)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_project_list.py`:

```python
def test_list_returns_chapter_count_from_outline(client, temp_projects_dir):
    project_id = "proj_chapters"
    _write_project(temp_projects_dir, project_id, {
        "id": project_id,
        "title": "有章节",
        "genre": "cool_novel",
        "current_stage": "STAGE4",
        "created_at": "2026-01-01T00:00:00Z",
    })
    (temp_projects_dir / project_id / "outline.json").write_text(
        json.dumps({"chapters": [{"number": 1}, {"number": 2}, {"number": 3}]}),
        encoding="utf-8",
    )

    resp = client.get("/api/project/list")
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert len(detail) == 1
    assert detail[0]["chapter_count"] == 3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `source venv/bin/activate && pytest tests/test_project_list.py::test_list_returns_chapter_count_from_outline -v`
Expected: FAIL with `KeyError: 'chapter_count'` (or `AssertionError` on the chapter_count == 3 line). Current `list_projects` does not return this field.

- [ ] **Step 3: Implement chapter_count in list_projects**

In `backend/api/project.py`, inside `list_projects()`, inside the `for proj_dir in proj_dirs:` loop, after the existing `latest_mtime` computation and BEFORE building the `projects.append({...})` payload, add:

```python
chapter_count = 0
outline_file = proj_dir / "outline.json"
if outline_file.exists():
    try:
        outline = fm_local.read_json(proj_dir.name, "outline.json")
        chapters = outline.get("chapters", []) if outline else []
        if isinstance(chapters, list):
            chapter_count = len(chapters)
    except Exception:
        chapter_count = 0
```

Then in the same `projects.append({...})` dict literal, add `"chapter_count": chapter_count` after `"created_at": ...`.

- [ ] **Step 4: Run test to verify it passes**

Run: `source venv/bin/activate && pytest tests/test_project_list.py::test_list_returns_chapter_count_from_outline -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/api/project.py tests/test_project_list.py
git commit -m "feat(api): list_projects returns per-project chapter_count"
```

---

## Task 2: Backend test — list_projects returns word_count

**Files:**
- Test: `tests/test_project_list.py` (modify, append a new test function)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_project_list.py`:

```python
def test_list_returns_word_count_from_drafts(client, temp_projects_dir):
    project_id = "proj_words"
    _write_project(temp_projects_dir, project_id, {
        "id": project_id,
        "title": "有字数",
        "genre": "cool_novel",
        "current_stage": "STAGE4",
        "created_at": "2026-01-01T00:00:00Z",
    })
    chapters_dir = temp_projects_dir / project_id / "chapters"
    chapters_dir.mkdir()
    # Two drafts totalling 10 visible chars after stripping SF_LOG tags.
    (chapters_dir / "ch01_scene_001_draft.md").write_text(
        "你好世界<!-- SF_LOG foo -->", encoding="utf-8"
    )
    (chapters_dir / "ch02_scene_001_draft.md").write_text(
        "另外六个字符<!-- SF_LOG bar --><!-- SF_LOG baz -->", encoding="utf-8"
    )

    resp = client.get("/api/project/list")
    assert resp.status_code == 200
    detail = resp.json()["detail"]
    assert len(detail) == 1
    # 4 + 6 = 10 visible chars (SF_LOG tag contents stripped)
    assert detail[0]["word_count"] == 10
```

- [ ] **Step 2: Run test to verify it fails**

Run: `source venv/bin/activate && pytest tests/test_project_list.py::test_list_returns_word_count_from_drafts -v`
Expected: FAIL with `KeyError: 'word_count'` (current `list_projects` does not return this field).

- [ ] **Step 3: Implement word_count in list_projects**

In `backend/api/project.py`, first add `import re` to the top-of-file imports (alongside the other stdlib imports). Then, in the same `list_projects()` loop body, AFTER the chapter_count block from Task 1 and BEFORE `projects.append({...})`, add:

```python
word_count = 0
chapters_dir = proj_dir / "chapters"
if chapters_dir.exists() and chapters_dir.is_dir():
    for draft_file in chapters_dir.iterdir():
        if not draft_file.is_file() or not draft_file.name.endswith(".md"):
            continue
        try:
            text = draft_file.read_text(encoding="utf-8")
            visible = re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)
            word_count += len(visible)
        except (OSError, UnicodeDecodeError):
            continue
```

Then in the `projects.append({...})` dict literal, add `"word_count": word_count` right after `"chapter_count": chapter_count`.

- [ ] **Step 4: Run test to verify it passes**

Run: `source venv/bin/activate && pytest tests/test_project_list.py::test_list_returns_word_count_from_drafts -v`
Expected: PASS.

- [ ] **Step 5: Run full project_list test suite to verify no regressions**

Run: `source venv/bin/activate && pytest tests/test_project_list.py -v`
Expected: ALL PASS (3 tests, no regressions).

- [ ] **Step 6: Commit**

```bash
git add backend/api/project.py tests/test_project_list.py
git commit -m "feat(api): list_projects returns per-project word_count from drafts"
```

---

## Task 3: Frontend — extend ProjectSummary interface with new fields

**Files:**
- Modify: `frontend/src/api/client.ts:98-108`

- [ ] **Step 1: Edit ProjectSummary interface**

In `frontend/src/api/client.ts`, find the existing interface and add two fields:

```ts
export interface ProjectSummary {
  id: string;
  title: string;
  genre: string;
  current_stage: string;
  created_at: string;
  updated_at: number;       // Unix seconds — from GET /api/project/list
  min_words: number;
  target_total_words: number;
  target_length_category: string;
  chapter_count: number;    // added for Nebula Forge bookshelf
  word_count: number;       // added for Nebula Forge bookshelf (visible chars in drafts)
}
```

- [ ] **Step 2: Type-check the frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit code 0 (no type errors). If any consumer file references `project.chapter_count` somewhere that triggers a type narrowing failure, fix it in this commit — but no consumers reference these fields yet, so it should be clean.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "feat(api-client): extend ProjectSummary with chapter_count + word_count"
```

---

## Task 4: CSS — swap core palette to Nebula Forge values

**Files:**
- Modify: `frontend/src/styles/globals.css` (the `:root` block)

- [ ] **Step 1: Update `--color-*` variable values in `:root`**

Open `frontend/src/styles/globals.css`, locate the `:root { ... }` block. Replace each `--color-*` value with its Nebula Forge equivalent. Reference table from the spec:

| Variable | Old | New |
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

Keep `--color-error`, `--color-on-error`, `--color-error-container`, `--color-on-error-container` UNCHANGED (the design doc reuses the same red).

- [ ] **Step 2: Run frontend tests to verify no regressions**

Run: `cd frontend && npm test -- --run 2>&1 | tail -30`
Expected: PASS or, at most, pre-existing test failures unrelated to color tokens. Any new failure with `bg-primary`, `text-primary`, etc. in the error message means a snapshot test expects the old hex value — those snapshots are out of scope for this plan and will be regenerated in Plan 3.

- [ ] **Step 3: Manually start the dev server and confirm color swap**

Run in the background: `cd frontend && npm run dev`
Then in another shell: `curl -s http://localhost:5173 | grep -o "color-primary\|#8ed5ff" | head -3` (or open http://localhost:5173 in a browser).
Expected: the served CSS contains `#8ed5ff` (new primary) at least once. Stop the dev server when done.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/styles/globals.css
git commit -m "feat(theme): swap CSS color palette to Nebula Forge (Material 3 sky blue)"
```

---

## Task 5: CSS — swap legacy canvas-* tokens to Nebula Forge values

**Files:**
- Modify: `frontend/src/styles/globals.css` (still in `:root`)

- [ ] **Step 1: Update the 5 `--color-canvas-*` values**

In the same `:root` block from Task 4:

| Variable | Old | New |
|---|---|---|
| `--color-canvas-bg` | `#020617` | `#051424` |
| `--color-canvas-surface` | `#0b1326` | `#122131` |
| `--color-canvas-text-muted` | `#64748b` | `#bdc8d1` |
| `--color-canvas-text-secondary` | `#b9cacb` | `#d4e4fa` |
| `--color-canvas-accent` | `#00dbe9` | `#7bd0ff` |

These aliases stay — `bg-canvas-bg`, `text-canvas-accent`, etc. continue to work, now pointing at Nebula Forge values. This is what upgrades 96 existing usages across Workspace / aiConsole / ChapterTreePanel for free.

- [ ] **Step 2: Confirm grep count of legacy tokens still in use**

Run: `grep -rln "canvas-bg\|canvas-surface\|canvas-text-muted\|canvas-text-secondary\|canvas-accent" frontend/src/ | wc -l`
Expected: `96` (matches the spec's pre-migration count; if less, that's fine — usage may have decreased organically, but should not have increased).

- [ ] **Step 3: Run frontend tests**

Run: `cd frontend && npm test -- --run 2>&1 | tail -20`
Expected: PASS or pre-existing failures only.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/styles/globals.css
git commit -m "feat(theme): redirect canvas-* legacy tokens to Nebula Forge palette"
```

---

## Task 6: Tailwind — extend typography tokens (fontSize + fontFamily)

**Files:**
- Modify: `frontend/tailwind.config.ts` (inside `theme.extend`)

- [ ] **Step 1: Add fontSize entries**

In `frontend/tailwind.config.ts`, inside `theme.extend`, add a `fontSize` object:

```ts
fontSize: {
  'display-lg':          ['48px', { lineHeight: '56px', fontWeight: '700', letterSpacing: '-0.02em' }],
  'headline-lg':         ['32px', { lineHeight: '40px', fontWeight: '600' }],
  'headline-lg-mobile':  ['24px', { lineHeight: '32px', fontWeight: '600' }],
  'title-md':            ['20px', { lineHeight: '28px', fontWeight: '500' }],
  'body-lg':             ['18px', { lineHeight: '30px', fontWeight: '400' }],
  'body-md':             ['16px', { lineHeight: '24px', fontWeight: '400' }],
  'label-sm':            ['12px', { lineHeight: '16px', fontWeight: '500', letterSpacing: '0.05em' }],
  'stats-number':        ['24px', { lineHeight: '32px', fontWeight: '600' }],
},
```

- [ ] **Step 2: Add fontFamily entries**

In the same `theme.extend` block, add a `fontFamily` object mapping the design-doc triple-font system. The three families are loaded via `@import` (or `<link>`) in `frontend/index.html`; this step just wires the Tailwind utility classes so consumers can write `font-display`, `font-body`, `font-mono`:

```ts
fontFamily: {
  display: ['"Hanken Grotesk"', 'system-ui', 'sans-serif'],
  body:    ['Inter', 'system-ui', 'sans-serif'],
  mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
},
```

- [ ] **Step 3: Verify Tailwind generates the utility classes**

Run: `cd frontend && npx tailwindcss --input <(echo '<div class="text-stats-number text-label-sm font-display font-body"></div>') --output /tmp/tw-out.css 2>&1 | tail -10`
Then: `grep -oE "font-size:[^;]*|font-family:[^;]*" /tmp/tw-out.css | head -10`
Expected: at least two `font-size` lines (`24px`, `12px`) and at least two `font-family` lines referencing `Hanken Grotesk` and `Inter`.

- [ ] **Step 4: Run frontend tests**

Run: `cd frontend && npm test -- --run 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/tailwind.config.ts
git commit -m "feat(tailwind): add Nebula Forge typography tokens (fontSize + fontFamily)"
```

---

## Task 7: ds/tokens.ts — centralize design-token names

**Files:**
- Create: `frontend/src/components/ds/tokens.ts`

- [ ] **Step 1: Write the token constants file**

```ts
// Nebula Forge design-token names. Numeric values live in
// frontend/src/styles/globals.css and frontend/tailwind.config.ts —
// this file gives components a stable TypeScript surface to import
// when they want to look up a token by name (rather than hard-coding
// "stats-number" as a string in many places).

export const FONT_SIZE_TOKENS = {
  display: "display-lg",
  headline: "headline-lg",
  headlineMobile: "headline-lg-mobile",
  title: "title-md",
  bodyLarge: "body-lg",
  body: "body-md",
  label: "label-sm",
  statsNumber: "stats-number",
} as const;

export type FontSizeToken = (typeof FONT_SIZE_TOKENS)[keyof typeof FONT_SIZE_TOKENS];

export const SURFACE_TOKENS = {
  background: "bg-background",
  surface: "bg-surface",
  surfaceDim: "bg-surface-dim",
  surfaceBright: "bg-surface-bright",
  surfaceContainerLowest: "bg-surface-container-lowest",
  surfaceContainerLow: "bg-surface-container-low",
  surfaceContainer: "bg-surface-container",
  surfaceContainerHigh: "bg-surface-container-high",
  surfaceContainerHighest: "bg-surface-container-highest",
  surfaceVariant: "bg-surface-variant",
} as const;

export const COLOR_ROLES = {
  primary: "text-primary",
  onPrimary: "text-on-primary",
  primaryContainer: "bg-primary-container",
  onPrimaryContainer: "text-on-primary-container",
  secondary: "text-secondary",
  tertiary: "text-tertiary",
  error: "text-error",
} as const;

export const RADIUS_TOKENS = {
  sm: "rounded-sm",
  base: "rounded",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  full: "rounded-full",
} as const;
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ds/tokens.ts
git commit -m "feat(ds): centralize Nebula Forge design-token names"
```

---

## Task 8: ds/BrandHeader — failing test

**Files:**
- Create: `frontend/src/components/ds/BrandHeader.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BrandHeader from "./BrandHeader";

describe("BrandHeader", () => {
  it("renders brand name and tagline by default", () => {
    render(<BrandHeader brandName="Nebula Forge" />);
    expect(screen.getByText("Nebula Forge")).toBeInTheDocument();
    expect(screen.getByText("让你的灵感长出血肉")).toBeInTheDocument();
  });

  it("hides text content when collapsed", () => {
    render(<BrandHeader brandName="Nebula Forge" collapsed />);
    expect(screen.queryByText("Nebula Forge")).not.toBeInTheDocument();
    expect(screen.queryByText("让你的灵感长出血肉")).not.toBeInTheDocument();
    // Icon should still render
    expect(screen.getByText("auto_stories")).toBeInTheDocument();
  });

  it("uses a custom icon when iconName is provided", () => {
    render(<BrandHeader brandName="Nebula Forge" iconName="rocket_launch" />);
    expect(screen.getByText("rocket_launch")).toBeInTheDocument();
  });

  it("uses a custom tagline when provided", () => {
    render(
      <BrandHeader brandName="Nebula Forge" tagline="Hello world" />
    );
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails (component doesn't exist)**

Run: `cd frontend && npm test -- --run BrandHeader 2>&1 | tail -15`
Expected: FAIL with `Failed to resolve import "./BrandHeader"` or `Cannot find module`.

- [ ] **Step 3: (No commit yet — implementation follows in next task)**

---

## Task 9: ds/BrandHeader — implement minimal version

**Files:**
- Create: `frontend/src/components/ds/BrandHeader.tsx`

- [ ] **Step 1: Implement BrandHeader**

```tsx
import { ReactNode } from "react";

export interface BrandHeaderProps {
  brandName: string;
  tagline?: string;        // default "让你的灵感长出血肉"
  iconName?: string;       // default "auto_stories"
  collapsed?: boolean;     // default false — hides text, keeps icon
}

export default function BrandHeader({
  brandName,
  tagline = "让你的灵感长出血肉",
  iconName = "auto_stories",
  collapsed = false,
}: BrandHeaderProps) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="material-symbols-outlined text-primary-container text-2xl"
        aria-hidden="true"
      >
        {iconName}
      </span>
      {!collapsed && (
        <div className="flex flex-col">
          <span className="font-display text-primary text-lg leading-tight">
            {brandName}
          </span>
          <span className="font-body text-on-surface-variant text-xs leading-tight">
            {tagline}
          </span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd frontend && npm test -- --run BrandHeader 2>&1 | tail -15`
Expected: PASS (4 tests, all green).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ds/BrandHeader.tsx frontend/src/components/ds/BrandHeader.test.tsx
git commit -m "feat(ds): add BrandHeader primitive with collapsed variant"
```

---

## Task 10: ds/index.ts — barrel export

**Files:**
- Create: `frontend/src/components/ds/index.ts`

- [ ] **Step 1: Write the barrel**

```ts
// Nebula Forge design-system primitives.
// Re-exported here so consumers can `import { BrandHeader } from "../components/ds"`
// instead of reaching into individual files.

export { default as BrandHeader } from "./BrandHeader";
export type { BrandHeaderProps } from "./BrandHeader";
```

- [ ] **Step 2: Verify the barrel type-checks and resolves**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ds/index.ts
git commit -m "feat(ds): add barrel export for BrandHeader"
```

---

## Task 11: Final regression — backend + frontend green

**Files:** (no file changes)

- [ ] **Step 1: Run full backend test suite**

Run: `source venv/bin/activate && pytest tests/test_project_list.py tests/test_project_stats.py tests/test_project_bulk.py -v 2>&1 | tail -30`
Expected: ALL PASS — confirms the new fields don't break any existing list/stats/bulk test.

- [ ] **Step 2: Run full frontend test suite**

Run: `cd frontend && npm test -- --run 2>&1 | tail -30`
Expected: ALL PASS — confirms the token swap + Tailwind extension + new BrandHeader don't regress anything. Pre-existing snapshot mismatches in components that haven't been migrated yet (StatsSidebar, BookShelf, etc.) are out of scope; Plan 3 regenerates those snapshots.

- [ ] **Step 3: Type-check backend**

Run: `cd backend && python -c "from backend.api.project import list_projects; print('OK')"`
Expected: prints `OK`. Confirms no Python syntax / import error.

- [ ] **Step 4: Push the branch**

```bash
git push origin neweb 2>&1 | tail -5
```

Expected: 10 new commits pushed (`feat(api): list_projects returns per-project chapter_count`, …, `feat(ds): add barrel export for BrandHeader`). No errors.

- [ ] **Step 5: Final summary to user**

Tell the user:
- Plan 1 complete; backend exposes new fields; all colors swapped; BrandHeader primitive shipped.
- Hand off to Plan 2 (Primitive Library) which fills in the remaining 11 primitives.