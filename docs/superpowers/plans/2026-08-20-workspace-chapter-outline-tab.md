# Workspace Right-Panel "章节大纲" Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 7th tab "章节大纲" to the workspace `ContextPanel` that surfaces `outline.json` (per-chapter outline) for cross-chapter view/edit, reusing the volume-grouping logic that already powers `ChapterTreePanel`.

**Architecture:** Move `parseVolumes` / `groupChaptersByVolume` from `WorkspacePage.tsx` into `utils/outline.ts` so both `ChapterTreePanel` and the new `ChapterOutlineEditor` share them. Extend `WorkspacePanel` union with `"chapter-outline"`. Create a new editor that renders volume-grouped accordion rows with inline-edit for Tier-A fields and a per-scene "预注册" accordion for Tier-B fields (`registry_changes` / `required_logs`). Save contract mirrors `NovelOutlineEditor` (bottom-right 保存/取消 + `onSaved()`). No backend change — `api.getOutline` / `api.updateOutline` already exist.

**Tech Stack:** React 18 + Vite + Tailwind (existing), Vitest + @testing-library/react (existing), TypeScript (existing).

---

## File Structure

**New files:**
- `frontend/src/components/workspace/editors/ChapterOutlineEditor.tsx` — new editor component (303 lines target)
- `frontend/src/test/ChapterOutlineEditor.test.tsx` — unit tests for the new editor

**Modified files:**
- `frontend/src/utils/outline.ts` — add `parseVolumes` / `groupChaptersByVolume` / `ParsedVolume` / `WorkspaceVolumeGroup`; export them
- `frontend/src/pages/WorkspacePage.tsx` — remove local `parseVolumes` / `groupChaptersByVolume` / `ParsedVolume` / `VOLUME_RANGE_RE`; import from `utils/outline.ts` instead
- `frontend/src/hooks/useWorkspacePanel.ts` — extend `WorkspacePanel` union and `VALID` whitelist with `"chapter-outline"`
- `frontend/src/components/workspace/ContextPanel.tsx` — add new entry to `TAB_LABEL`, `FETCHER`, and `EditorForPanel` switch
- `frontend/src/test/ContextPanel.test.tsx` — add test for the new tab routing
- `frontend/src/test/utils.outline.test.ts` — add tests for the moved `parseVolumes` / `groupChaptersByVolume`

**Deleted files:** none.

**Backend changes:** none.

---

## Task 1: Move shared parsing helpers to `utils/outline.ts`

**Files:**
- Modify: `frontend/src/utils/outline.ts`
- Modify: `frontend/src/pages/WorkspacePage.tsx:46-106`
- Test: `frontend/src/test/utils.outline.test.ts`

- [ ] **Step 1: Add failing tests for `parseVolumes` and `groupChaptersByVolume` in `utils.outline.test.ts`**

Append the following block at the end of `frontend/src/test/utils.outline.test.ts`:

```typescript
import {
  parseVolumes,
  groupChaptersByVolume,
  type ParsedVolume,
  type WorkspaceVolumeGroup,
  type WorkspaceChapterNode,
} from "../utils/outline";

describe("parseVolumes", () => {
  it("returns [] when novelOutline is null", () => {
    expect(parseVolumes(null)).toEqual([]);
  });

  it("returns [] when volumes is missing", () => {
    expect(parseVolumes({ volumes: undefined } as unknown as NovelOutline)).toEqual([]);
  });

  it("parses a single '1-30' range into one ParsedVolume", () => {
    const result = parseVolumes(withVolumes(["1-30"]));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: "v0", start: 1, end: 30, chapter_range: "1-30" });
  });

  it("skips volumes with unparseable chapter_range", () => {
    expect(parseVolumes(withVolumes(["garbage", "1-10"]))).toHaveLength(1);
  });

  it("skips volumes with end < start", () => {
    expect(parseVolumes(withVolumes(["5-1", "1-10"]))).toHaveLength(1);
  });

  it("skips volumes with start < 1", () => {
    expect(parseVolumes(withVolumes(["0-30", "1-10"]))).toHaveLength(1);
  });

  it("tolerates whitespace inside the range", () => {
    expect(parseVolumes(withVolumes(["  1-30  "]))).toHaveLength(1);
    expect(parseVolumes(withVolumes(["1 - 30"]))).toHaveLength(1);
  });
});

describe("groupChaptersByVolume", () => {
  const chapters: WorkspaceChapterNode[] = [
    { chapter_number: 1, title: "第一章", scenes: [] },
    { chapter_number: 5, title: "第五章", scenes: [] },
    { chapter_number: 35, title: "第三十五章", scenes: [] },
  ];

  it("returns [] when chapters is empty", () => {
    expect(groupChaptersByVolume([], null)).toEqual([]);
  });

  it("returns a single '未分组' bucket when novelOutline is null", () => {
    const result = groupChaptersByVolume(chapters, null);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("未分组");
    expect(result[0].chapters).toEqual(chapters);
  });

  it("returns a single '未分组' bucket when no volumes are parseable", () => {
    const result = groupChaptersByVolume(chapters, withVolumes(["garbage"]));
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("未分组");
    expect(result[0].chapters).toEqual(chapters);
  });

  it("groups chapters into matching volume buckets", () => {
    const result = groupChaptersByVolume(chapters, withVolumes(["1-30", "31-60"]));
    expect(result.map((g) => g.name)).toEqual(["v0", "v1"]);
    expect(result[0].chapters.map((c) => c.chapter_number)).toEqual([1, 5]);
    expect(result[1].chapters.map((c) => c.chapter_number)).toEqual([35]);
  });

  it("routes chapters outside any volume to a trailing '未分组' bucket", () => {
    const result = groupChaptersByVolume(chapters, withVolumes(["1-10"]));
    expect(result.map((g) => g.name)).toEqual(["v0", "未分组"]);
    expect(result[1].chapters.map((c) => c.chapter_number)).toEqual([5, 35]);
  });

  it("suppresses the '未分组' bucket when it would be empty", () => {
    const result = groupChaptersByVolume(
      [{ chapter_number: 1, title: "第一章", scenes: [] }],
      withVolumes(["1-30"]),
    );
    expect(result.map((g) => g.name)).toEqual(["v0"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- src/test/utils.outline.test.ts`
Expected: FAIL — `parseVolumes` and `groupChaptersByVolume` are not exported from `../utils/outline`.

- [ ] **Step 3: Add helpers to `utils/outline.ts`**

Open `frontend/src/utils/outline.ts` and add (after `computeFirstVolumeEnd`, before the end of file):

```typescript
import type { NovelOutline } from "../api/client";

export interface WorkspaceChapterNode {
  chapter_number: number;
  title: string;
  scenes: unknown[];
}

export interface WorkspaceVolumeGroup {
  name: string;
  chapter_range: string;
  summary?: string;
  chapters: WorkspaceChapterNode[];
}

export interface ParsedVolume {
  name: string;
  chapter_range: string;
  summary?: string;
  start: number;
  end: number;
}

export function parseVolumes(novelOutline: NovelOutline | null): ParsedVolume[] {
  if (!novelOutline?.volumes?.length) return [];
  const out: ParsedVolume[] = [];
  for (const v of novelOutline.volumes) {
    const m = CHAPTER_RANGE_RE.exec(v.chapter_range ?? "");
    if (!m) continue;
    const start = +m[1];
    const end = +m[2];
    if (start < 1 || end < start) continue;
    out.push({ name: v.name, chapter_range: v.chapter_range, summary: v.summary, start, end });
  }
  return out;
}

export function groupChaptersByVolume(
  chapters: WorkspaceChapterNode[],
  novelOutline: NovelOutline | null,
): WorkspaceVolumeGroup[] {
  const parsed = parseVolumes(novelOutline);
  if (parsed.length === 0) {
    return chapters.length === 0
      ? []
      : [{ name: "未分组", chapter_range: "", summary: undefined, chapters }];
  }
  const buckets: WorkspaceVolumeGroup[] = parsed.map((v) => ({
    name: v.name,
    chapter_range: v.chapter_range,
    summary: v.summary,
    chapters: [],
  }));
  const ungrouped: WorkspaceChapterNode[] = [];
  for (const ch of chapters) {
    const idx = parsed.findIndex((v) => ch.chapter_number >= v.start && ch.chapter_number <= v.end);
    if (idx === -1) {
      ungrouped.push(ch);
    } else {
      buckets[idx].chapters.push(ch);
    }
  }
  if (ungrouped.length > 0) {
    buckets.push({ name: "未分组", chapter_range: "", summary: undefined, chapters: ungrouped });
  }
  return buckets.filter((b) => b.chapters.length > 0 || b.name !== "未分组");
}
```

Note: the existing top of `utils/outline.ts` already has `CHAPTER_RANGE_RE`. Do NOT define a separate `VOLUME_RANGE_RE`.

- [ ] **Step 4: Update `WorkspacePage.tsx` to use the shared helpers**

Open `frontend/src/pages/WorkspacePage.tsx` and:

1. Add to the import block at top:
   ```typescript
   import {
     parseVolumes,
     groupChaptersByVolume,
     type WorkspaceChapterNode,
     type WorkspaceVolumeGroup,
   } from "../utils/outline";
   ```

2. Delete the following from the file body (lines 47-106 in the current file):
   - `const VOLUME_RANGE_RE = /^\s*(\d+)\s*-\s*(\d+)\s*$/;`
   - `interface ParsedVolume { ... }`
   - `function parseVolumes(...)` body
   - `function groupChaptersByVolume(...)` body

3. Keep the local `interface WorkspaceChapterNode` and `interface WorkspaceVolumeGroup` definitions? No — they are now exported from `utils/outline.ts`. Delete them too (lines 41-48).

4. The existing local `WorkspaceChapterNode` type used in `ChapterTreePanel`'s props needs to remain compatible. Since `ChapterTreePanel.tsx` defines its own `WorkspaceChapterNode` interface with `scenes: WorkspaceSceneNode[]` (more specific), the import from `utils/outline` will collide. Resolution: do **not** delete `WorkspaceChapterNode` / `WorkspaceVolumeGroup` from `WorkspacePage.tsx`; instead, leave the local definitions and import only `parseVolumes` / `groupChaptersByVolume` from utils. Adjust the imports accordingly:

   Replace step 1 above with:
   ```typescript
   import { parseVolumes, groupChaptersByVolume } from "../utils/outline";
   ```

5. Replace any usage of `parseVolumes(...)` and `groupChaptersByVolume(...)` in `WorkspacePage.tsx` with the imported versions — they have the same signatures. (No other call sites; the local definitions are gone.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npm test -- src/test/utils.outline.test.ts src/test/ChapterTreePanel.test.tsx`
Expected: PASS — all moved tests pass, and `ChapterTreePanel` tests still pass (its grouping input is unchanged).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/utils/outline.ts frontend/src/pages/WorkspacePage.tsx frontend/src/test/utils.outline.test.ts
git commit -m "refactor(workspace): move parseVolumes/groupChaptersByVolume to utils/outline

Both ChapterTreePanel and the upcoming ChapterOutlineEditor need volume
grouping. Move the helpers (currently local to WorkspacePage.tsx) into
utils/outline.ts so they're shared. No behavior change; ChapterTreePanel
keeps its own typed interfaces and just imports the parsing functions.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Extend `WorkspacePanel` with the new tab value

**Files:**
- Modify: `frontend/src/hooks/useWorkspacePanel.ts`

- [ ] **Step 1: Add `"chapter-outline"` to the `WorkspacePanel` union**

Open `frontend/src/hooks/useWorkspacePanel.ts`. Replace the `WorkspacePanel` type:

```typescript
export type WorkspacePanel =
  | "concept"
  | "world"
  | "character"
  | "outline"
  | "chapter-outline"
  | "diagnosis"
  | "export";
```

- [ ] **Step 2: Add `"chapter-outline"` to the `VALID` whitelist**

In the same file, replace the `VALID` array:

```typescript
const VALID: WorkspacePanel[] = [
  "concept",
  "world",
  "character",
  "outline",
  "chapter-outline",
  "diagnosis",
  "export",
];
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (no type errors). If anything else in the codebase consumes `WorkspacePanel`, the union expansion is non-breaking because `VALID` is the runtime whitelist and consumers like `ContextPanel`'s switch are exhaustiveness-checked.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useWorkspacePanel.ts
git commit -m "feat(workspace): add chapter-outline to WorkspacePanel whitelist

Purely additive — extends the union and VALID[] array. No consumers
yet; wired in Task 3. TypeScript exhaustiveness checks downstream will
catch any switch that misses the new value.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Wire `chapter-outline` into `ContextPanel`

**Files:**
- Modify: `frontend/src/components/workspace/ContextPanel.tsx`
- Test: `frontend/src/test/ContextPanel.test.tsx`

- [ ] **Step 1: Add `chapter-outline` to `TAB_LABEL`**

In `ContextPanel.tsx`, replace the `TAB_LABEL` map (lines 29-36):

```typescript
const TAB_LABEL: Record<WorkspacePanel, string> = {
  concept: "概念",
  world: "世界观",
  character: "角色",
  outline: "大纲",
  "chapter-outline": "章节大纲",
  diagnosis: "诊断",
  export: "导出",
};
```

- [ ] **Step 2: Add `chapter-outline` to `FETCHER`**

Replace the `FETCHER` map (lines 38-45):

```typescript
const FETCHER: Record<WorkspacePanel, (id: string) => Promise<unknown>> = {
  concept: (id) => api.getConcept(id),
  world: (id) => api.getWorld(id),
  character: (id) => api.getCharacter(id),
  outline: (id) => api.getNovelOutline(id),
  "chapter-outline": (id) => api.getOutline(id),
  diagnosis: async () => ({}),
  export: async () => ({}),
};
```

- [ ] **Step 3: Add `chapter-outline` to the `EditorForPanel` switch**

`EditorForPanel`'s parameter `panel` is a narrow union (`"concept" | "world" | "character" | "outline"`). To route the new panel, change the `EditorForPanel` props at line 109:

Before:
```typescript
function EditorForPanel({
  panel, projectId, data, onSaved, readOnly,
}: { panel: "concept" | "world" | "character" | "outline" } & BaseEditorProps) {
```

After:
```typescript
function EditorForPanel({
  panel, projectId, data, onSaved, readOnly,
}: { panel: "concept" | "world" | "character" | "outline" | "chapter-outline" } & BaseEditorProps) {
```

And add the new branch at the end of its body (before the closing `}`):

```typescript
import ChapterOutlineEditor from "./editors/ChapterOutlineEditor";
```

Then in the function:
```typescript
  if (panel === "concept") return <ConceptEditor projectId={projectId} data={data} onSaved={onSaved} readOnly={readOnly} />;
  if (panel === "world") return <WorldEditor projectId={projectId} data={data} onSaved={onSaved} readOnly={readOnly} />;
  if (panel === "character") return <CharacterEditor projectId={projectId} data={data} onSaved={onSaved} readOnly={readOnly} />;
  if (panel === "outline") return <NovelOutlineEditor projectId={projectId} data={data} onSaved={onSaved} readOnly={readOnly} />;
  return <ChapterOutlineEditor projectId={projectId} data={data} onSaved={onSaved} readOnly={readOnly} />;
```

Also update the panel-switch above at line 93 to include `"chapter-outline"`:

Before:
```typescript
{panel === "concept" || panel === "world" || panel === "character" || panel === "outline" ? (
```

After:
```typescript
{panel === "concept" || panel === "world" || panel === "character" || panel === "outline" || panel === "chapter-outline" ? (
```

- [ ] **Step 4: Verify TypeScript fails (sanity)**

Run: `cd frontend && npx tsc --noEmit`
Expected: FAIL — `ChapterOutlineEditor` does not exist yet (next task). This is intentional; the failure confirms wiring is in place.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/workspace/ContextPanel.tsx
git commit -m "feat(workspace): wire chapter-outline tab in ContextPanel

Add TAB_LABEL/FETCHER/EditorForPanel switch entries for the new panel.
TypeScript currently fails because ChapterOutlineEditor doesn't exist
yet — resolved by Task 4.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: `ChapterOutlineEditor` — skeleton with loading/empty states

**Files:**
- Create: `frontend/src/components/workspace/editors/ChapterOutlineEditor.tsx`
- Create: `frontend/src/test/ChapterOutlineEditor.test.tsx`

- [ ] **Step 1: Write failing tests for loading and empty states**

Create `frontend/src/test/ChapterOutlineEditor.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import ChapterOutlineEditor from "../components/workspace/editors/ChapterOutlineEditor";

vi.mock("../api/client", () => ({
  default: {
    getOutline: vi.fn(),
    updateOutline: vi.fn(),
  },
}));

import api from "../api/client";
const mockedUpdateOutline = api.updateOutline as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedUpdateOutline.mockReset().mockResolvedValue(undefined);
});

describe("ChapterOutlineEditor", () => {
  it("renders the loading state initially", async () => {
    // The editor reads `data` synchronously on mount; if we pass `undefined`,
    // it shows a loading placeholder until the parent (ContextPanel) passes
    // real data.
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={undefined}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByTestId("chapter-outline-loading")).toBeInTheDocument();
    expect(screen.getByTestId("chapter-outline-loading")).toHaveTextContent("加载中");
  });

  it("renders the empty state when chapters are empty", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{ chapters: [] }}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByTestId("chapter-outline-editor")).toBeInTheDocument();
    expect(screen.getByTestId("chapter-outline-empty")).toHaveTextContent("尚未生成");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- src/test/ChapterOutlineEditor.test.tsx`
Expected: FAIL — `ChapterOutlineEditor` is not a module.

- [ ] **Step 3: Implement the skeleton**

Create `frontend/src/components/workspace/editors/ChapterOutlineEditor.tsx`:

```tsx
import { useState } from "react";
import api, { type Outline } from "../../../api/client";

interface BaseEditorProps {
  projectId: string;
  data: unknown;
  onSaved: () => void;
  readOnly?: boolean;
}

const EMPTY: Outline = { chapters: [] };

function readOutline(data: unknown): Outline | null {
  if (data === undefined) return null; // loading
  if (!data || typeof data !== "object") return EMPTY;
  const raw = data as Partial<Outline>;
  return { chapters: Array.isArray(raw.chapters) ? raw.chapters : [] };
}

export default function ChapterOutlineEditor({ data, readOnly: _readOnly }: BaseEditorProps) {
  const [outline] = useState<Outline>(() => readOutline(data) ?? EMPTY);
  const initial = readOutline(data);

  if (initial === null) {
    return (
      <div data-testid="chapter-outline-loading" className="font-body-ui text-system-log text-sm">
        加载中…
      </div>
    );
  }

  if (outline.chapters.length === 0) {
    return (
      <div data-testid="chapter-outline-editor" className="space-y-3">
        <p data-testid="chapter-outline-empty" className="font-body-ui text-system-log text-sm">
          尚未生成章节大纲 — 请到 Stage3 生成。
        </p>
      </div>
    );
  }

  return <div data-testid="chapter-outline-editor" className="space-y-3">TODO</div>;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- src/test/ChapterOutlineEditor.test.tsx`
Expected: PASS for both tests.

- [ ] **Step 5: Verify TypeScript**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS — the `readOnly` prop and the `api.updateOutline` import are wired in later tasks but already typed.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/workspace/editors/ChapterOutlineEditor.tsx frontend/src/test/ChapterOutlineEditor.test.tsx
git commit -m "feat(workspace): ChapterOutlineEditor skeleton with loading/empty states

Establishes BaseEditorProps, readOutline defensive parser, and the two
non-editing states. Real volume-group + edit flow lands in Tasks 5-8.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Render volume groups + chapter rows with title/theme editing

**Files:**
- Modify: `frontend/src/components/workspace/editors/ChapterOutlineEditor.tsx`
- Modify: `frontend/src/test/ChapterOutlineEditor.test.tsx`

- [ ] **Step 1: Append failing tests for volume-grouped chapter rows**

Append to `frontend/src/test/ChapterOutlineEditor.test.tsx`:

```tsx
  it("renders one volume group per parsed volume", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            {
              chapter_number: 1, title: "第一章", theme: "觉醒",
              scene_plan: [{ scene_number: 1, goal: "x", conflict: "y", emotional_arc: "z", narrative_role: "setup", beat_type: "inciting", registry_changes: { created: [], updated: [] }, required_logs: [] }],
            },
            {
              chapter_number: 35, title: "第三十五章", theme: "决战",
              scene_plan: [{ scene_number: 1, goal: "x", conflict: "y", emotional_arc: "z", narrative_role: "major_reveal", beat_type: "climax", registry_changes: { created: [], updated: [] }, required_logs: [] }],
            },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    // Two chapters spread across two volumes → two volume groups.
    expect(screen.getByTestId("volume-v0")).toBeInTheDocument();
    expect(screen.getByTestId("volume-v1")).toBeInTheDocument();
    expect(screen.getByTestId("chapter-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("chapter-row-35")).toBeInTheDocument();
  });

  it("chapter title input updates local state", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            {
              chapter_number: 1, title: "原标题", theme: "原主题",
              scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }],
            },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    const titleInput = screen.getByTestId("chapter-1-title") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "新标题" } });
    expect(titleInput.value).toBe("新标题");
  });

  it("chapter theme textarea updates local state", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            {
              chapter_number: 1, title: "第一章", theme: "原主题",
              scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }],
            },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    const themeArea = screen.getByTestId("chapter-1-theme") as HTMLTextAreaElement;
    fireEvent.change(themeArea, { target: { value: "新主题" } });
    expect(themeArea.value).toBe("新主题");
  });
```

Add `fireEvent` to the imports at the top:
```tsx
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- src/test/ChapterOutlineEditor.test.tsx`
Expected: FAIL — `volume-v0`, `chapter-row-1`, `chapter-1-title`, `chapter-1-theme` test IDs do not exist.

- [ ] **Step 3: Replace the editor's rendering with volume-grouped chapter rows**

Replace the body of `ChapterOutlineEditor.tsx`. New imports at the top:

```tsx
import { useEffect, useState } from "react";
import api, { type Outline, type ScenePlan, type NovelOutline } from "../../../api/client";
import {
  parseVolumes,
  groupChaptersByVolume,
  type WorkspaceVolumeGroup,
  type WorkspaceChapterNode,
} from "../../../utils/outline";
```

(Note: we pass `scene_plan` through; the chapter-level edit UI needs `theme` and `title`, but `groupChaptersByVolume` from utils expects `WorkspaceChapterNode` with `scenes: unknown[]`. We map `scene_plan` → a thin wrapper that exposes `chapter_number` and `title` for grouping; the actual `Outline.chapters` is preserved verbatim for editing.)

Replace the entire function body (everything from `export default function` to the end) with:

```tsx
export default function ChapterOutlineEditor({ projectId: _projectId, data, onSaved: _onSaved, readOnly: _readOnly }: BaseEditorProps) {
  const initial = readOutline(data);
  const [outline, setOutline] = useState<Outline>(() => initial ?? EMPTY);

  useEffect(() => {
    const next = readOutline(data);
    if (next !== null) setOutline(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (initial === null) {
    return (
      <div data-testid="chapter-outline-loading" className="font-body-ui text-system-log text-sm">
        加载中…
      </div>
    );
  }

  if (outline.chapters.length === 0) {
    return (
      <div data-testid="chapter-outline-editor" className="space-y-3">
        <p data-testid="chapter-outline-empty" className="font-body-ui text-system-log text-sm">
          尚未生成章节大纲 — 请到 Stage3 生成。
        </p>
      </div>
    );
  }

  // For grouping, we only read chapter_number/title from outline.chapters.
  // The grouping util's `WorkspaceChapterNode.scenes` is unused for grouping;
  // we pass empty arrays to satisfy the type. Full Outline (including
  // scene_plan) is preserved via `outline` state above.
  const stubChapters: WorkspaceChapterNode[] = outline.chapters.map((c) => ({
    chapter_number: c.chapter_number,
    title: c.title,
    scenes: [],
  }));
  // We pass null for novelOutline; the editor does not load it.
  // To preserve volume-grouping without an extra API call, we accept
  // the loss of grouping when novelOutline is not available — but
  // ContextPanel already loaded novelOutline for the adjacent tab.
  // Future enhancement: thread novelOutline via prop. For now: flat list.
  const groups: WorkspaceVolumeGroup[] = groupChaptersByVolume(stubChapters, null);

  const updateChapter = (n: number, patch: Partial<Outline["chapters"][number]>) => {
    setOutline((prev) => ({
      ...prev,
      chapters: prev.chapters.map((c) => (c.chapter_number === n ? { ...c, ...patch } : c)),
    }));
  };

  return (
    <div data-testid="chapter-outline-editor" className="space-y-3">
      {groups.length === 0
        ? outline.chapters.map((ch) => (
            <ChapterRow
              key={ch.chapter_number}
              chapter={ch}
              onUpdate={(patch) => updateChapter(ch.chapter_number, patch)}
              onSceneUpdate={(_sn, patch) => {
                setOutline((prev) => ({
                  ...prev,
                  chapters: prev.chapters.map((c) =>
                    c.chapter_number === ch.chapter_number
                      ? {
                          ...c,
                          scene_plan: c.scene_plan.map((s) => ({ ...s, ...patch })),
                        }
                      : c,
                  ),
                }));
              }}
              readOnly={_readOnly}
            />
          ))
        : groups.map((g) => (
            <div key={g.name} data-testid={`volume-${g.name}`} className="space-y-1">
              <div className="font-label-mono text-system-log text-xs">
                {g.name}{g.chapter_range ? ` · 第 ${g.chapter_range} 章` : ""}
              </div>
              {g.chapters.map((stub) => {
                const ch = outline.chapters.find((c) => c.chapter_number === stub.chapter_number)!;
                return (
                  <ChapterRow
                    key={ch.chapter_number}
                    chapter={ch}
                    onUpdate={(patch) => updateChapter(ch.chapter_number, patch)}
                    onSceneUpdate={(_sn, patch) => {
                      setOutline((prev) => ({
                        ...prev,
                        chapters: prev.chapters.map((c) =>
                          c.chapter_number === ch.chapter_number
                            ? {
                                ...c,
                                scene_plan: c.scene_plan.map((s) => ({ ...s, ...patch })),
                              }
                            : c,
                        ),
                      }));
                    }}
                    readOnly={_readOnly}
                  />
                );
              })}
            </div>
          ))}
    </div>
  );
}

function ChapterRow({
  chapter, onUpdate, onSceneUpdate, readOnly,
}: {
  chapter: Outline["chapters"][number];
  onUpdate: (patch: Partial<Outline["chapters"][number]>) => void;
  onSceneUpdate: (scene_number: number, patch: Partial<ScenePlan>) => void;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div data-testid={`chapter-row-${chapter.chapter_number}`} className="border border-outline-variant rounded-lg p-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">
          第 {chapter.chapter_number} 章
        </span>
        <button
          type="button"
          data-testid={`chapter-row-${chapter.chapter_number}-toggle`}
          onClick={() => setOpen((v) => !v)}
          className="text-xs text-system-log hover:text-primary"
        >{open ? "收起" : "展开"}</button>
      </div>
      <div>
        <label className="block font-label-mono text-system-log mb-1 text-xs">章节标题</label>
        <input
          data-testid={`chapter-${chapter.chapter_number}-title`}
          value={chapter.title}
          onChange={(e) => onUpdate({ title: e.target.value })}
          disabled={readOnly}
          className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-sm text-primary focus:outline-none focus:border-primary-container"
        />
      </div>
      <div>
        <label className="block font-label-mono text-system-log mb-1 text-xs">本章主题</label>
        <textarea
          data-testid={`chapter-${chapter.chapter_number}-theme`}
          value={chapter.theme ?? ""}
          onChange={(e) => onUpdate({ theme: e.target.value })}
          disabled={readOnly}
          className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container overflow-hidden"
        />
      </div>
      {open && (
        <div className="space-y-1">
          {chapter.scene_plan.length === 0 ? (
            <p className="text-xs text-system-log">暂无场景 — 请到 Stage3 重新生成此章节大纲。</p>
          ) : (
            chapter.scene_plan.map((scene) => (
              <SceneRow
                key={scene.scene_number}
                scene={scene}
                onUpdate={(patch) => onSceneUpdate(scene.scene_number, patch)}
                readOnly={readOnly}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function SceneRow({
  scene, onUpdate, readOnly,
}: {
  scene: ScenePlan;
  onUpdate: (patch: Partial<ScenePlan>) => void;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid={`scene-row-${scene.scene_number}`} className="border border-outline-variant rounded p-2 space-y-1">
      <button
        type="button"
        data-testid={`scene-row-${scene.scene_number}-toggle`}
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-system-log hover:text-primary"
      >场景 {scene.scene_number} · {open ? "收起" : "展开"}</button>
      {open && (
        <div className="space-y-1">
          <label className="block font-label-mono text-system-log mb-1 text-[10px] uppercase tracking-wider">goal</label>
          <textarea
            data-testid={`scene-${scene.scene_number}-goal`}
            value={scene.goal}
            onChange={(e) => onUpdate({ goal: e.target.value })}
            disabled={readOnly}
            className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container overflow-hidden"
          />
        </div>
      )}
    </div>
  );
}
```

Note on the `parseVolumes` / volume grouping: because the editor currently doesn't receive `novelOutline`, `groupChaptersByVolume(stubChapters, null)` returns a single "未分组" bucket. The `groups.length === 0` branch is unreachable in this state — it exists for future when the editor is given `novelOutline`. For the v1 test, both `volume-v0` / `volume-v1` testids are produced when the editor is given a `novelOutline` prop. **But the test in Step 1 above doesn't pass `novelOutline`!**

Adjust the test plan: the simpler implementation path is to **always use the flat list when novelOutline isn't passed**, and the `volume-*` testid assertions in Step 1 must be revised. Replace them with the simpler form:

In Step 1's tests, replace the first test (`renders one volume group per parsed volume`) with:

```tsx
  it("renders one chapter row per outline.chapter", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            {
              chapter_number: 1, title: "第一章", theme: "觉醒",
              scene_plan: [{ scene_number: 1, goal: "x", conflict: "y", emotional_arc: "z", narrative_role: "setup", beat_type: "inciting", registry_changes: { created: [], updated: [] }, required_logs: [] }],
            },
            {
              chapter_number: 2, title: "第二章", theme: "磨炼",
              scene_plan: [{ scene_number: 1, goal: "x", conflict: "y", emotional_arc: "z", narrative_role: "mini_payoff", beat_type: "rising", registry_changes: { created: [], updated: [] }, required_logs: [] }],
            },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByTestId("chapter-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("chapter-row-2")).toBeInTheDocument();
  });
```

This simplification keeps the implementation flat-list-first. Volume grouping is deferred until the editor receives a `novelOutline` prop (out of scope for this iteration; see Future in spec).

Replace the implementation code above accordingly — drop the `groups.length === 0` branch and always map `outline.chapters`:

```tsx
  return (
    <div data-testid="chapter-outline-editor" className="space-y-3">
      {outline.chapters.map((ch) => (
        <ChapterRow
          key={ch.chapter_number}
          chapter={ch}
          onUpdate={(patch) => updateChapter(ch.chapter_number, patch)}
          onSceneUpdate={(_sn, patch) => {
            setOutline((prev) => ({
              ...prev,
              chapters: prev.chapters.map((c) =>
                c.chapter_number === ch.chapter_number
                  ? { ...c, scene_plan: c.scene_plan.map((s) => ({ ...s, ...patch })) }
                  : c,
              ),
            }));
          }}
          readOnly={_readOnly}
        />
      ))}
    </div>
  );
```

Drop the unused imports `parseVolumes`, `groupChaptersByVolume`, `WorkspaceVolumeGroup`, `WorkspaceChapterNode`, `NovelOutline`. Keep only what's actually used.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- src/test/ChapterOutlineEditor.test.tsx`
Expected: PASS — all three tests (loading + empty + chapter row + title/theme edit).

- [ ] **Step 5: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/workspace/editors/ChapterOutlineEditor.tsx frontend/src/test/ChapterOutlineEditor.test.tsx
git commit -m "feat(workspace): ChapterOutlineEditor renders chapter rows with title/theme editing

Each chapter renders as a collapsible card; title (input) and theme
(auto-grow textarea) are inline-editable. Scene rows are collapsed
inside; A/B field editing lands in Tasks 6-7. Volume grouping deferred
to a follow-up (spec: future enhancement — requires novelOutline prop).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Scene row A-field editing (goal/conflict/emotional_arc/narrative_role/beat_type)

**Files:**
- Modify: `frontend/src/components/workspace/editors/ChapterOutlineEditor.tsx`
- Modify: `frontend/src/test/ChapterOutlineEditor.test.tsx`

- [ ] **Step 1: Append failing tests for scene A-field editing**

Append to `ChapterOutlineEditor.test.tsx`:

```tsx
  it("renders scene rows inside an expanded chapter", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            {
              chapter_number: 1, title: "第一章", theme: "觉醒",
              scene_plan: [
                { scene_number: 1, goal: "原goal", conflict: "原conflict", emotional_arc: "原arc", narrative_role: "setup", beat_type: "inciting", registry_changes: { created: [], updated: [] }, required_logs: [] },
                { scene_number: 2, goal: "g2", conflict: "c2", emotional_arc: "a2", narrative_role: "mini_payoff", beat_type: "rising", registry_changes: { created: [], updated: [] }, required_logs: [] },
              ],
            },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    // Scenes are inside an expanded chapter; their toggle is present
    expect(screen.getByTestId("scene-row-1-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("scene-row-2-toggle")).toBeInTheDocument();
  });

  it("expanding a scene reveals goal/conflict/emotional_arc/narrative_role/beat_type inputs", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            {
              chapter_number: 1, title: "第一章", theme: "觉醒",
              scene_plan: [
                { scene_number: 1, goal: "原goal", conflict: "原conflict", emotional_arc: "原arc", narrative_role: "setup", beat_type: "inciting", registry_changes: { created: [], updated: [] }, required_logs: [] },
              ],
            },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("scene-row-1-toggle"));
    expect(screen.getByTestId("scene-1-goal")).toBeInTheDocument();
    expect(screen.getByTestId("scene-1-conflict")).toBeInTheDocument();
    expect(screen.getByTestId("scene-1-emotional-arc")).toBeInTheDocument();
    expect(screen.getByTestId("scene-1-narrative-role")).toBeInTheDocument();
    expect(screen.getByTestId("scene-1-beat-type")).toBeInTheDocument();
  });

  it("narrative_role select offers exactly the 4 enum values", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            {
              chapter_number: 1, title: "第一章", theme: "觉醒",
              scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }],
            },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("scene-row-1-toggle"));
    const select = screen.getByTestId("scene-1-narrative-role") as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.value);
    expect(opts).toEqual(["setup", "mini_payoff", "cliffhanger", "major_reveal"]);
  });

  it("editing scene.goal updates the textarea value", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            {
              chapter_number: 1, title: "第一章", theme: "觉醒",
              scene_plan: [{ scene_number: 1, goal: "原goal", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }],
            },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("scene-row-1-toggle"));
    const goal = screen.getByTestId("scene-1-goal") as HTMLTextAreaElement;
    fireEvent.change(goal, { target: { value: "新goal" } });
    expect(goal.value).toBe("新goal");
  });

  it("changing narrative_role updates the select value", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            {
              chapter_number: 1, title: "第一章", theme: "觉醒",
              scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }],
            },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("scene-row-1-toggle"));
    const select = screen.getByTestId("scene-1-narrative-role") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "cliffhanger" } });
    expect(select.value).toBe("cliffhanger");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- src/test/ChapterOutlineEditor.test.tsx`
Expected: FAIL — `scene-1-goal` / `scene-1-conflict` / etc. testids don't exist; only the `scene-row-1-toggle` exists (Task 5).

- [ ] **Step 3: Expand `SceneRow` to render all A fields**

Replace the body of the `SceneRow` component in `ChapterOutlineEditor.tsx`:

```tsx
const NARRATIVE_ROLES = ["setup", "mini_payoff", "cliffhanger", "major_reveal"] as const;

function SceneRow({
  scene, onUpdate, readOnly,
}: {
  scene: ScenePlan;
  onUpdate: (patch: Partial<ScenePlan>) => void;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid={`scene-row-${scene.scene_number}`} className="border border-outline-variant rounded p-2 space-y-1">
      <button
        type="button"
        data-testid={`scene-row-${scene.scene_number}-toggle`}
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-system-log hover:text-primary"
      >场景 {scene.scene_number} · {open ? "收起" : "展开"}</button>
      {open && (
        <div className="space-y-2">
          <div>
            <label className="block font-label-mono text-system-log mb-1 text-[10px] uppercase tracking-wider">goal</label>
            <textarea
              data-testid={`scene-${scene.scene_number}-goal`}
              value={scene.goal}
              onChange={(e) => onUpdate({ goal: e.target.value })}
              disabled={readOnly}
              className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container overflow-hidden"
            />
          </div>
          <div>
            <label className="block font-label-mono text-system-log mb-1 text-[10px] uppercase tracking-wider">conflict</label>
            <textarea
              data-testid={`scene-${scene.scene_number}-conflict`}
              value={scene.conflict}
              onChange={(e) => onUpdate({ conflict: e.target.value })}
              disabled={readOnly}
              className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container overflow-hidden"
            />
          </div>
          <div>
            <label className="block font-label-mono text-system-log mb-1 text-[10px] uppercase tracking-wider">emotional_arc</label>
            <textarea
              data-testid={`scene-${scene.scene_number}-emotional-arc`}
              value={scene.emotional_arc}
              onChange={(e) => onUpdate({ emotional_arc: e.target.value })}
              disabled={readOnly}
              className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container overflow-hidden"
            />
          </div>
          <div>
            <label className="block font-label-mono text-system-log mb-1 text-[10px] uppercase tracking-wider">narrative_role</label>
            <select
              data-testid={`scene-${scene.scene_number}-narrative-role`}
              value={scene.narrative_role}
              onChange={(e) => onUpdate({ narrative_role: e.target.value as ScenePlan["narrative_role"] })}
              disabled={readOnly}
              className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
            >
              {NARRATIVE_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block font-label-mono text-system-log mb-1 text-[10px] uppercase tracking-wider">beat_type</label>
            <input
              data-testid={`scene-${scene.scene_number}-beat-type`}
              value={scene.beat_type}
              onChange={(e) => onUpdate({ beat_type: e.target.value })}
              disabled={readOnly}
              className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container"
            />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- src/test/ChapterOutlineEditor.test.tsx`
Expected: PASS — all five new scene-A tests pass.

- [ ] **Step 5: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/workspace/editors/ChapterOutlineEditor.tsx frontend/src/test/ChapterOutlineEditor.test.tsx
git commit -m "feat(workspace): scene A-field editing (goal/conflict/emotional_arc/narrative_role/beat_type)

narrative_role is a constrained <select> over the 4 enum values; the
other four are text inputs / textareas. B-fields (registry_changes +
required_logs) land in Task 7.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Scene B-fields accordion (registry_changes + required_logs)

**Files:**
- Modify: `frontend/src/components/workspace/editors/ChapterOutlineEditor.tsx`
- Modify: `frontend/src/test/ChapterOutlineEditor.test.tsx`

- [ ] **Step 1: Append failing tests for B-fields accordion**

Append to `ChapterOutlineEditor.test.tsx`:

```tsx
  it("B-fields accordion is hidden by default", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            {
              chapter_number: 1, title: "第一章", theme: "觉醒",
              scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }],
            },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("scene-row-1-toggle"));
    expect(screen.queryByTestId("scene-1-b-accordion")).not.toBeInTheDocument();
  });

  it("expanding B-fields accordion reveals registry_changes.created rows + add button", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            {
              chapter_number: 1, title: "第一章", theme: "觉醒",
              scene_plan: [
                {
                  scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "",
                  registry_changes: {
                    created: [{ type: "conflict", id_pattern: "cf_001", description: "主角与师父起冲突" }],
                    updated: [],
                  },
                  required_logs: ["character_relation_change"],
                },
              ],
            },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("scene-row-1-toggle"));
    fireEvent.click(screen.getByTestId("scene-1-b-toggle"));
    expect(screen.getByTestId("scene-1-b-accordion")).toBeInTheDocument();
    expect(screen.getByTestId("scene-1-registry-created-0-type")).toBeInTheDocument();
    expect(screen.getByTestId("scene-1-registry-created-0-id-pattern")).toBeInTheDocument();
    expect(screen.getByTestId("scene-1-registry-created-0-description")).toBeInTheDocument();
    expect(screen.getByTestId("scene-1-registry-created-add")).toBeInTheDocument();
  });

  it("clicking + 新增 button appends an empty registry_changes.created row", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            {
              chapter_number: 1, title: "第一章", theme: "觉醒",
              scene_plan: [
                { scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] },
              ],
            },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("scene-row-1-toggle"));
    fireEvent.click(screen.getByTestId("scene-1-b-toggle"));
    fireEvent.click(screen.getByTestId("scene-1-registry-created-add"));
    expect(screen.getByTestId("scene-1-registry-created-0-type")).toBeInTheDocument();
  });

  it("required_logs renders chips and an add input", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            {
              chapter_number: 1, title: "第一章", theme: "觉醒",
              scene_plan: [
                { scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: ["character_relation_change", "knowledge_gain"] },
              ],
            },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("scene-row-1-toggle"));
    fireEvent.click(screen.getByTestId("scene-1-b-toggle"));
    expect(screen.getByTestId("scene-1-required-log-0")).toHaveTextContent("character_relation_change");
    expect(screen.getByTestId("scene-1-required-log-1")).toHaveTextContent("knowledge_gain");
    expect(screen.getByTestId("scene-1-required-log-add")).toBeInTheDocument();
  });

  it("typing a new required_log tag and pressing Enter appends it", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            {
              chapter_number: 1, title: "第一章", theme: "觉醒",
              scene_plan: [
                { scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] },
              ],
            },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("scene-row-1-toggle"));
    fireEvent.click(screen.getByTestId("scene-1-b-toggle"));
    const input = screen.getByTestId("scene-1-required-log-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "twist_reveal" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(screen.getByTestId("scene-1-required-log-0")).toHaveTextContent("twist_reveal");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- src/test/ChapterOutlineEditor.test.tsx`
Expected: FAIL — `scene-1-b-toggle` / `scene-1-b-accordion` / `scene-1-registry-created-*` testids don't exist.

- [ ] **Step 3: Add `BFieldsAccordion` sub-component**

After the `SceneRow` component in `ChapterOutlineEditor.tsx`, add:

```tsx
function BFieldsAccordion({
  scene, onUpdate, readOnly,
}: {
  scene: ScenePlan;
  onUpdate: (patch: Partial<ScenePlan>) => void;
  readOnly?: boolean;
}) {
  const addCreated = () => {
    onUpdate({
      registry_changes: {
        ...scene.registry_changes,
        created: [...scene.registry_changes.created, { type: "", id_pattern: "", description: "" }],
      },
    });
  };
  const removeCreated = (i: number) => {
    onUpdate({
      registry_changes: {
        ...scene.registry_changes,
        created: scene.registry_changes.created.filter((_, idx) => idx !== i),
      },
    });
  };
  const updateCreated = (i: number, patch: Partial<ScenePlan["registry_changes"]["created"][number]>) => {
    onUpdate({
      registry_changes: {
        ...scene.registry_changes,
        created: scene.registry_changes.created.map((row, idx) =>
          idx === i ? { ...row, ...patch } : row,
        ),
      },
    });
  };
  const addUpdated = () => {
    onUpdate({
      registry_changes: {
        ...scene.registry_changes,
        updated: [...scene.registry_changes.updated, { asset_id: "", field: "", new_value: "" }],
      },
    });
  };
  const removeUpdated = (i: number) => {
    onUpdate({
      registry_changes: {
        ...scene.registry_changes,
        updated: scene.registry_changes.updated.filter((_, idx) => idx !== i),
      },
    });
  };
  const updateUpdated = (i: number, patch: Partial<ScenePlan["registry_changes"]["updated"][number]>) => {
    onUpdate({
      registry_changes: {
        ...scene.registry_changes,
        updated: scene.registry_changes.updated.map((row, idx) =>
          idx === i ? { ...row, ...patch } : row,
        ),
      },
    });
  };
  const [newTag, setNewTag] = useState("");
  const addTag = () => {
    const t = newTag.trim();
    if (!t) return;
    if (scene.required_logs.includes(t)) {
      setNewTag("");
      return;
    }
    onUpdate({ required_logs: [...scene.required_logs, t] });
    setNewTag("");
  };
  const removeTag = (i: number) => {
    onUpdate({ required_logs: scene.required_logs.filter((_, idx) => idx !== i) });
  };

  return (
    <div data-testid={`scene-${scene.scene_number}-b-accordion`} className="mt-2 space-y-2 border-t border-outline-variant pt-2">
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">预注册 · registry_changes.created</span>
          {!readOnly && (
            <button
              type="button"
              data-testid={`scene-${scene.scene_number}-registry-created-add`}
              onClick={addCreated}
              className="text-xs text-primary-container"
            >+ 新增</button>
          )}
        </div>
        {scene.registry_changes.created.length === 0 ? (
          <p className="text-[10px] text-system-log/70">（无）</p>
        ) : (
          <div className="space-y-1">
            {scene.registry_changes.created.map((row, i) => (
              <div key={i} className="grid grid-cols-3 gap-1">
                <input
                  data-testid={`scene-${scene.scene_number}-registry-created-${i}-type`}
                  value={row.type}
                  onChange={(e) => updateCreated(i, { type: e.target.value })}
                  placeholder="type"
                  disabled={readOnly}
                  className="bg-surface-container border border-outline-variant rounded px-1 py-0.5 text-[10px]"
                />
                <input
                  data-testid={`scene-${scene.scene_number}-registry-created-${i}-id-pattern`}
                  value={row.id_pattern}
                  onChange={(e) => updateCreated(i, { id_pattern: e.target.value })}
                  placeholder="id_pattern"
                  disabled={readOnly}
                  className="bg-surface-container border border-outline-variant rounded px-1 py-0.5 text-[10px]"
                />
                <div className="flex gap-1">
                  <input
                    data-testid={`scene-${scene.scene_number}-registry-created-${i}-description`}
                    value={row.description}
                    onChange={(e) => updateCreated(i, { description: e.target.value })}
                    placeholder="description"
                    disabled={readOnly}
                    className="flex-1 bg-surface-container border border-outline-variant rounded px-1 py-0.5 text-[10px]"
                  />
                  {!readOnly && (
                    <button
                      type="button"
                      data-testid={`scene-${scene.scene_number}-registry-created-${i}-remove`}
                      onClick={() => removeCreated(i)}
                      className="text-[10px] text-error"
                    >×</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">预注册 · registry_changes.updated</span>
          {!readOnly && (
            <button
              type="button"
              data-testid={`scene-${scene.scene_number}-registry-updated-add`}
              onClick={addUpdated}
              className="text-xs text-primary-container"
            >+ 新增</button>
          )}
        </div>
        {scene.registry_changes.updated.length === 0 ? (
          <p className="text-[10px] text-system-log/70">（无）</p>
        ) : (
          <div className="space-y-1">
            {scene.registry_changes.updated.map((row, i) => (
              <div key={i} className="grid grid-cols-3 gap-1">
                <input
                  data-testid={`scene-${scene.scene_number}-registry-updated-${i}-asset-id`}
                  value={row.asset_id}
                  onChange={(e) => updateUpdated(i, { asset_id: e.target.value })}
                  placeholder="asset_id"
                  disabled={readOnly}
                  className="bg-surface-container border border-outline-variant rounded px-1 py-0.5 text-[10px]"
                />
                <input
                  data-testid={`scene-${scene.scene_number}-registry-updated-${i}-field`}
                  value={row.field}
                  onChange={(e) => updateUpdated(i, { field: e.target.value })}
                  placeholder="field"
                  disabled={readOnly}
                  className="bg-surface-container border border-outline-variant rounded px-1 py-0.5 text-[10px]"
                />
                <div className="flex gap-1">
                  <input
                    data-testid={`scene-${scene.scene_number}-registry-updated-${i}-new-value`}
                    value={row.new_value}
                    onChange={(e) => updateUpdated(i, { new_value: e.target.value })}
                    placeholder="new_value"
                    disabled={readOnly}
                    className="flex-1 bg-surface-container border border-outline-variant rounded px-1 py-0.5 text-[10px]"
                  />
                  {!readOnly && (
                    <button
                      type="button"
                      data-testid={`scene-${scene.scene_number}-registry-updated-${i}-remove`}
                      onClick={() => removeUpdated(i)}
                      className="text-[10px] text-error"
                    >×</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="font-label-mono text-system-log text-[10px] uppercase tracking-wider">预注册 · required_logs</span>
        </div>
        <div className="flex flex-wrap gap-1 mb-1">
          {scene.required_logs.map((tag, i) => (
            <span
              key={i}
              data-testid={`scene-${scene.scene_number}-required-log-${i}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-[10px]"
            >
              {tag}
              {!readOnly && (
                <button
                  type="button"
                  data-testid={`scene-${scene.scene_number}-required-log-${i}-remove`}
                  onClick={() => removeTag(i)}
                  className="text-error"
                >×</button>
              )}
            </span>
          ))}
        </div>
        {!readOnly && (
          <div className="flex gap-1">
            <input
              data-testid={`scene-${scene.scene_number}-required-log-input`}
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
              placeholder="新增 tag…"
              className="flex-1 bg-surface-container border border-outline-variant rounded px-1 py-0.5 text-[10px]"
            />
            <button
              type="button"
              data-testid={`scene-${scene.scene_number}-required-log-add`}
              onClick={addTag}
              className="text-[10px] text-primary-container"
            >添加</button>
          </div>
        )}
      </div>
    </div>
  );
}
```

Then in `SceneRow`'s `open` branch, at the very end of the inner `<div>`, add:

```tsx
<div className="pt-2">
  <button
    type="button"
    data-testid={`scene-${scene.scene_number}-b-toggle`}
    onClick={() => setShowB((v) => !v)}
    className="text-[10px] text-system-log hover:text-primary"
  >预注册（{scene.registry_changes.created.length + scene.registry_changes.updated.length} 项 · {scene.required_logs.length} tags） · {showB ? "收起" : "展开"}</button>
  {showB && <BFieldsAccordion scene={scene} onUpdate={onUpdate} readOnly={readOnly} />}
</div>
```

Add `const [showB, setShowB] = useState(false);` to the top of `SceneRow`'s body, alongside the existing `open` state.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- src/test/ChapterOutlineEditor.test.tsx`
Expected: PASS — all 5 new B-field tests pass.

- [ ] **Step 5: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/workspace/editors/ChapterOutlineEditor.tsx frontend/src/test/ChapterOutlineEditor.test.tsx
git commit -m "feat(workspace): scene B-fields accordion (registry_changes + required_logs)

Default-collapsed accordion per scene. Each sub-list supports add/remove
rows with row-level inputs. required_logs uses a chip + Enter-to-add
tag input. All controls disabled when readOnly.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Save / Cancel / readOnly footer + dirty indicator

**Files:**
- Modify: `frontend/src/components/workspace/editors/ChapterOutlineEditor.tsx`
- Modify: `frontend/src/test/ChapterOutlineEditor.test.tsx`

- [ ] **Step 1: Append failing tests for save/cancel/readOnly**

Append to `ChapterOutlineEditor.test.tsx`:

```tsx
  it("save calls api.updateOutline once with the edited outline + calls onSaved", async () => {
    const onSaved = vi.fn();
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            { chapter_number: 1, title: "原标题", theme: "原主题",
              scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
          ],
        }}
        onSaved={onSaved}
      />,
    );
    fireEvent.change(screen.getByTestId("chapter-1-title"), { target: { value: "新标题" } });
    fireEvent.click(screen.getByTestId("chapter-outline-editor-save"));
    await waitFor(() => expect(mockedUpdateOutline).toHaveBeenCalledTimes(1));
    const [projectIdArg, outlineArg] = mockedUpdateOutline.mock.calls[0];
    expect(projectIdArg).toBe("p1");
    expect(outlineArg.chapters[0].title).toBe("新标题");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("save error shows banner and preserves local state", async () => {
    mockedUpdateOutline.mockRejectedValueOnce(new Error("网络超时"));
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            { chapter_number: 1, title: "原标题", theme: "原主题",
              scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId("chapter-1-title"), { target: { value: "新标题" } });
    fireEvent.click(screen.getByTestId("chapter-outline-editor-save"));
    await waitFor(() => screen.getByTestId("chapter-outline-editor-error"));
    expect(screen.getByTestId("chapter-outline-editor-error")).toHaveTextContent("网络超时");
    // Local state preserved
    expect((screen.getByTestId("chapter-1-title") as HTMLInputElement).value).toBe("新标题");
  });

  it("cancel reverts local state to the data prop", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            { chapter_number: 1, title: "原标题", theme: "原主题",
              scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    const titleInput = screen.getByTestId("chapter-1-title") as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "临时修改" } });
    expect(titleInput.value).toBe("临时修改");
    fireEvent.click(screen.getByTestId("chapter-outline-editor-cancel"));
    expect(titleInput.value).toBe("原标题");
  });

  it("readOnly disables every input and the save button", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            { chapter_number: 1, title: "原标题", theme: "原主题",
              scene_plan: [{ scene_number: 1, goal: "原goal", conflict: "原conflict", emotional_arc: "原arc", narrative_role: "setup", beat_type: "inciting", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
          ],
        }}
        onSaved={() => {}}
        readOnly
      />,
    );
    expect((screen.getByTestId("chapter-1-title") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("scene-row-1-toggle"));
    expect((screen.getByTestId("scene-1-goal") as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByTestId("scene-1-narrative-role") as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByTestId("chapter-outline-editor-save")).toBeDisabled();
  });

  it("'未保存修改' indicator appears after editing", () => {
    render(
      <ChapterOutlineEditor
        projectId="p1"
        data={{
          chapters: [
            { chapter_number: 1, title: "原标题", theme: "原主题",
              scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
          ],
        }}
        onSaved={() => {}}
      />,
    );
    expect(screen.queryByTestId("chapter-outline-editor-dirty")).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("chapter-1-title"), { target: { value: "新标题" } });
    expect(screen.getByTestId("chapter-outline-editor-dirty")).toHaveTextContent("未保存修改");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm test -- src/test/ChapterOutlineEditor.test.tsx`
Expected: FAIL — `chapter-outline-editor-save` / `chapter-outline-editor-cancel` / `chapter-outline-editor-error` / `chapter-outline-editor-dirty` testids don't exist; `api.updateOutline` is not called.

- [ ] **Step 3: Add footer + save/cancel handlers + dirty tracking**

In `ChapterOutlineEditor.tsx`, update the imports at top:

```tsx
import { useEffect, useRef, useState } from "react";
```

Replace the entire `export default function ChapterOutlineEditor` body. New signature uses all props and exposes the footer:

```tsx
export default function ChapterOutlineEditor({ projectId, data, onSaved, readOnly }: BaseEditorProps) {
  const initial = readOutline(data);
  const [outline, setOutline] = useState<Outline>(() => initial ?? EMPTY);
  const [lastSavedOutline, setLastSavedOutline] = useState<Outline>(() => initial ?? EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outlineRef = useRef(outline);
  outlineRef.current = outline;

  useEffect(() => {
    const next = readOutline(data);
    if (next !== null) {
      setOutline(next);
      setLastSavedOutline(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.updateOutline(projectId, outlineRef.current);
      setLastSavedOutline(outlineRef.current);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = () => {
    setOutline(lastSavedOutline);
    setError(null);
  };

  const dirty = JSON.stringify(outline) !== JSON.stringify(lastSavedOutline);

  if (initial === null) {
    return (
      <div data-testid="chapter-outline-loading" className="font-body-ui text-system-log text-sm">
        加载中…
      </div>
    );
  }

  if (outline.chapters.length === 0) {
    return (
      <div data-testid="chapter-outline-editor" className="space-y-3">
        <p data-testid="chapter-outline-empty" className="font-body-ui text-system-log text-sm">
          尚未生成章节大纲 — 请到 Stage3 生成。
        </p>
      </div>
    );
  }

  const updateChapter = (n: number, patch: Partial<Outline["chapters"][number]>) => {
    setOutline((prev) => ({
      ...prev,
      chapters: prev.chapters.map((c) => (c.chapter_number === n ? { ...c, ...patch } : c)),
    }));
  };

  return (
    <div data-testid="chapter-outline-editor" className="space-y-3">
      {outline.chapters.map((ch) => (
        <ChapterRow
          key={ch.chapter_number}
          chapter={ch}
          onUpdate={(patch) => updateChapter(ch.chapter_number, patch)}
          onSceneUpdate={(_sn, patch) => {
            setOutline((prev) => ({
              ...prev,
              chapters: prev.chapters.map((c) =>
                c.chapter_number === ch.chapter_number
                  ? { ...c, scene_plan: c.scene_plan.map((s) => ({ ...s, ...patch })) }
                  : c,
              ),
            }));
          }}
          readOnly={readOnly}
        />
      ))}
      {error && (
        <div data-testid="chapter-outline-editor-error" className="p-2 bg-error-container/20 border border-error rounded text-error font-body-ui text-xs">
          {error}
        </div>
      )}
      <footer className="flex items-center justify-end gap-2 pt-2">
        {dirty && (
          <span data-testid="chapter-outline-editor-dirty" className="text-xs text-system-log mr-auto">未保存修改</span>
        )}
        <button
          type="button"
          data-testid="chapter-outline-editor-cancel"
          onClick={handleCancel}
          disabled={busy || !dirty}
          className="px-3 py-1 text-xs bg-surface-container text-system-log rounded-lg hover:bg-surface-container-low disabled:opacity-40"
        >取消</button>
        <button
          type="button"
          data-testid="chapter-outline-editor-save"
          onClick={handleSave}
          disabled={busy || readOnly || !dirty}
          title={readOnly ? "托管运行中,元数据已锁定" : undefined}
          className="px-4 py-1 text-xs bg-tertiary-container text-surface-container-low rounded-lg hover:opacity-90 disabled:opacity-40"
        >{busy ? "保存中…" : "保存"}</button>
      </footer>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- src/test/ChapterOutlineEditor.test.tsx`
Expected: PASS — all 5 new save/cancel/readOnly/dirty tests pass.

- [ ] **Step 5: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/workspace/editors/ChapterOutlineEditor.tsx frontend/src/test/ChapterOutlineEditor.test.tsx
git commit -m "feat(workspace): ChapterOutlineEditor save/cancel/readOnly footer + dirty indicator

Mirrors NovelOutlineEditor's contract: bottom-right 保存/取消, error
banner above footer on save failure, save button disabled when busy,
readOnly, or not dirty. Cancel reverts to lastSavedOutline (preserved
across refetches). Dirty uses JSON.stringify equality — outlines are
small so the cost is negligible.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: Update `ContextPanel.test.tsx` for the new tab + readOnly

**Files:**
- Modify: `frontend/src/test/ContextPanel.test.tsx`

- [ ] **Step 1: Add the new panel to the parameterized tab test**

Find the `it.each` block at the top of the `describe` (around line 93):

```typescript
  it.each([
    "concept", "world", "character", "outline", "diagnosis", "export",
  ] as const)("renders %s tab active when ?panel=%s", async (panel) => {
```

Add `"chapter-outline"` to the list (becomes 7 entries):

```typescript
  it.each([
    "concept", "world", "character", "outline", "chapter-outline", "diagnosis", "export",
  ] as const)("renders %s tab active when ?panel=%s", async (panel) => {
```

- [ ] **Step 2: Add a chapter-outline routing test**

After the existing "outline tab save calls api.updateNovelOutline" test (around line 224), append:

```tsx
  it("chapter-outline tab mounts ChapterOutlineEditor and pre-fills from getOutline", async () => {
    mockedGetOutline.mockResolvedValueOnce({
      chapters: [
        { chapter_number: 1, title: "第一章", theme: "觉醒",
          scene_plan: [{ scene_number: 1, goal: "g", conflict: "c", emotional_arc: "a", narrative_role: "setup", beat_type: "inciting", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
        { chapter_number: 2, title: "第二章", theme: "磨炼",
          scene_plan: [{ scene_number: 1, goal: "g", conflict: "c", emotional_arc: "a", narrative_role: "mini_payoff", beat_type: "rising", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
      ],
    });
    setupActivePanel("/workspace?mode=manual&panel=chapter-outline");
    expect(await screen.findByTestId("chapter-outline-editor")).toBeInTheDocument();
    expect(screen.getByTestId("chapter-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("chapter-row-2")).toBeInTheDocument();
    expect((screen.getByTestId("chapter-1-title") as HTMLInputElement).value).toBe("第一章");
  });

  it("chapter-outline tab save calls api.updateOutline with the edited outline", async () => {
    mockedGetOutline.mockResolvedValueOnce({
      chapters: [
        { chapter_number: 1, title: "原标题", theme: "原主题",
          scene_plan: [{ scene_number: 1, goal: "", conflict: "", emotional_arc: "", narrative_role: "setup", beat_type: "", registry_changes: { created: [], updated: [] }, required_logs: [] }] },
      ],
    });
    setupActivePanel("/workspace?mode=manual&panel=chapter-outline");
    const titleInput = (await screen.findByTestId("chapter-1-title")) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "新标题" } });
    fireEvent.click(screen.getByTestId("chapter-outline-editor-save"));
    await waitFor(() => expect(mockedUpdateOutline).toHaveBeenCalledTimes(1));
    const [projectIdArg, outlineArg] = mockedUpdateOutline.mock.calls[0];
    expect(projectIdArg).toBe("p1");
    expect(outlineArg.chapters[0].title).toBe("新标题");
  });
```

- [ ] **Step 3: Run ContextPanel tests to verify they pass**

Run: `cd frontend && npm test -- src/test/ContextPanel.test.tsx`
Expected: PASS — all existing tests pass; the 2 new chapter-outline tests pass.

- [ ] **Step 4: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: PASS — no regressions. If any pre-existing test breaks, fix the test (not the production code) — likely the parameterized `it.each` will fail if `chapter-outline` isn't a valid `WorkspacePanel` value at type-check time. Verify with `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/test/ContextPanel.test.tsx
git commit -m "test(workspace): ContextPanel covers chapter-outline tab routing + save

Two new tests: chapter-outline tab mounts the new editor with pre-filled
rows; saving an edit calls api.updateOutline with the patched outline.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: Lint + final integration check

**Files:** none modified (unless lint requires fixes).

- [ ] **Step 1: Run ESLint**

Run: `cd frontend && npm run lint`
Expected: PASS — no new errors. If there are warnings about unused imports in `ChapterOutlineEditor.tsx` (e.g. `parseVolumes` / `groupChaptersByVolume` are imported but unused after Task 5 simplification), remove them.

- [ ] **Step 2: Run full frontend test suite once more**

Run: `cd frontend && npm test`
Expected: PASS.

- [ ] **Step 3: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS — no type errors.

- [ ] **Step 4: Run backend test suite (smoke — no backend changes expected, but verify)**

Run: `pytest -x -q`
Expected: PASS — no regression. Frontend-only change; backend untouched.

- [ ] **Step 5: Visual smoke test (manual, in browser)**

1. `cd frontend && npm run dev`
2. Open http://localhost:5173, pick or create a project with chapters
3. Navigate to workspace; switch to "章节大纲" tab
4. Verify: chapters render, scenes collapsed, B-fields collapsed, expand + edit + save flow works, save button disabled in managed mode
5. Switch to managed mode → confirm tab becomes fully read-only

If visual issues are found, fix inline and commit. If clean, no commit.

---

## Self-Review

**Spec coverage:**

| Spec section | Covered by |
|---|---|
| § Goals 1 (cross-chapter view) | Tasks 5 (chapter rows) + Task 4 (loading/empty) |
| § Goals 2 (in-workspace editing) | Tasks 6 + 7 (A/B fields) + Task 8 (save) |
| § Goals 3 (volume-grouping reuse) | Task 1 (move helpers) — **NOTE: deferred** in Task 5 step 3 simplification |
| § Goals 4 (readOnly contract) | Task 8 (footer disabled) + Task 4 (passes `readOnly` prop) |
| § Non-Goals (no reversion of v1.9) | New tab added; existing "大纲" tab untouched |
| § Architecture: panel value | Tasks 2 + 3 |
| § Architecture: move helpers | Task 1 |
| § Architecture: editor at vacated path | Task 4 (file at `editors/ChapterOutlineEditor.tsx`) |
| § Component structure | Tasks 4-8 |
| § Data flow: load + reseed | Task 4 + Task 8 |
| § Data flow: local edits | Tasks 5-7 |
| § Data flow: save | Task 8 |
| § Data flow: cancel | Task 8 |
| § Tier A/B fields | Tasks 5-7 |
| § Never-editable fields | `chapter_number` / `scene_number` not in any input control |
| § Error handling | Task 8 + Task 4 |
| § Reused code: useAutoHeight | NOT used — chapter/theme and goal/conflict/emotional_arc are simple textareas with `overflow-hidden`. **This is a deviation from spec.** The spec says "auto-grow for theme / goal / conflict / emotional_arc textareas (mirrors NovelOutlineEditor)". To match, refactor: replace the textarea `className` `overflow-hidden` with `useAutoHeight(ref, [value])` for `chapter-${n}-theme`, `scene-${n}-goal`, `scene-${n}-conflict`, `scene-${n}-emotional-arc`. Add `useAutoHeight` import. **Add as a final sub-task in Task 10 or a new Task 11.** |
| § Reused code: footer styling | Task 8 footer matches NovelOutlineEditor verbatim |
| § Reused code: empty-state tone | Task 4 message matches |
| § Testing: new editor unit tests | Tasks 4-8 (incremental TDD) |
| § Testing: ContextPanel snapshot update | Task 9 |
| § Out-of-Scope | Not addressed (correctly excluded) |

**Deviation found:** § Reused code (auto-grow textareas) is missing from the implementation tasks. This must be added before declaring done.

**Add as new Task 11 (auto-grow textareas):**

### Task 11: Auto-grow textareas for `theme` / `goal` / `conflict` / `emotional_arc`

**Files:**
- Modify: `frontend/src/components/workspace/editors/ChapterOutlineEditor.tsx`

- [ ] **Step 1: Update imports**

Replace the import line at the top:
```tsx
import { useEffect, useRef, useState } from "react";
import api, { type Outline, type ScenePlan } from "../../../api/client";
import { useAutoHeight } from "../../../hooks/useAutoHeight";
```

- [ ] **Step 2: Add refs + `useAutoHeight` calls inside `ChapterRow` and `SceneRow`**

In `ChapterRow`, add:
```tsx
const themeRef = useRef<HTMLTextAreaElement>(null);
useAutoHeight(themeRef, [chapter.theme ?? ""]);
```

And update the `<textarea data-testid={`chapter-${chapter.chapter_number}-theme`}>` to add `ref={themeRef}`.

In `SceneRow`, add:
```tsx
const goalRef = useRef<HTMLTextAreaElement>(null);
const conflictRef = useRef<HTMLTextAreaElement>(null);
const arcRef = useRef<HTMLTextAreaElement>(null);
useAutoHeight(goalRef, [scene.goal]);
useAutoHeight(conflictRef, [scene.conflict]);
useAutoHeight(arcRef, [scene.emotional_arc]);
```

And update the three textareas (`scene-${n}-goal`, `scene-${n}-conflict`, `scene-${n}-emotional-arc`) to add their respective refs.

- [ ] **Step 3: Run tests**

Run: `cd frontend && npm test -- src/test/ChapterOutlineEditor.test.tsx`
Expected: PASS — `useAutoHeight` works against a `null` ref in jsdom (the hook checks `ref.current` and bails when it's null; jsdom doesn't compute layout heights so the hook is a no-op in tests).

- [ ] **Step 4: Run TypeScript + lint**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/workspace/editors/ChapterOutlineEditor.tsx
git commit -m "feat(workspace): auto-grow textareas (theme/goal/conflict/emotional_arc)

Mirrors NovelOutlineEditor's use of useAutoHeight so textareas grow
with their content instead of cropping or scrolling internally.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

**Placeholder scan:** No "TBD" / "TODO" / "fill in" in plan. ✅

**Type consistency:**
- `ScenePlan["registry_changes"]["created"][number]` matches the `ScenePlan` definition (object with `type`, `id_pattern`, `description`). ✅
- `ScenePlan["registry_changes"]["updated"][number]` matches. ✅
- `Outline["chapters"][number]` matches the imported `Outline`. ✅
- `WorkspacePanel` "chapter-outline" referenced consistently across Tasks 2, 3, 9. ✅
- `ChapterOutlineEditor` `data-testid` prefix `chapter-outline-editor-*` consistent across Tasks 4-9. ✅
- Test IDs for chapter rows (`chapter-row-N`), chapter title (`chapter-N-title`), chapter theme (`chapter-N-theme`), scene rows (`scene-row-N-toggle`), scene fields (`scene-N-{goal|conflict|...}`), B-accordion (`scene-N-b-accordion`, `scene-N-b-toggle`), registry rows (`scene-N-registry-created/updated-i-*`), required log chips (`scene-N-required-log-i`). All unique and consistent. ✅

**Final scope check:** 11 tasks, ~30 minutes each, all independent commits, each task produces a passing test suite. Scope: focused on adding one new tab + moving shared helpers. No creep.

**Volume-grouping deferred:** During planning I simplified Task 5 to drop volume grouping (since `novelOutline` isn't threaded into the editor). The spec's § Goals 3 says "reuse volume-grouping logic". This is a real gap. Two options:

**Option A** (ship without volume grouping now): Add a TODO in `ChapterOutlineEditor.tsx` referencing "future: thread `novelOutline` via prop to enable volume-grouped rendering". Update spec § Goals 3 to "deferred".

**Option B** (add volume grouping now): Thread `novelOutline` from `WorkspacePage.tsx` into `ContextPanel` → `ChapterOutlineEditor`. Significantly more wiring. Adds 1 more task.

Recommend **Option A** for now; if user pushes back, switch to Option B. Mark this gap clearly in the plan deliverable summary.

---

Plan complete. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?