# Creative Canvas — Idea → Step 1 触发点重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 IdeaRootNode 卡片右侧新增「继续」图标按钮,新增 CanvasPreStepHint 占位卡片引导 Step 1 生成,使 init 后的 UX 与 mockup `code.html:258-282` 一致。

**Architecture:** 前端专项,后端 /init / /next-step 不动。IdeaRootNode 加可选 `onContinue` + `continueLoading` props(向后兼容,默认 undefined 不渲染按钮);新增 CanvasPreStepHint 组件显示 Step 1 available 时的引导文案;CreativeCanvasPage 在 step 1 + available 时把 `nextStep(1)` 绑给 onContinue,并把 PreStepHint 渲染到 active-step 区域上方。状态机 5 态不变,TreeCanvas 中央 advance-step-{n} 按钮保留(Step 1 冗余入口,本 plan 不删)。

**Tech Stack:** React 18 + TypeScript + Vitest。`useCreativeCanvasV2` hook 已有 `nextStep(currentStep)` + `loadingStep` 状态,直接复用。

**Spec:** [`../specs/2026-09-04-canvas-init-next-step-design.md`](../specs/2026-09-04-canvas-init-next-step-design.md)

**Run tests from `frontend/`** (cwd quirk — see `project_vitest_run_from_frontend_dir` memory).

---

## File Structure

| File | Type | Responsibility |
|---|---|---|
| `frontend/src/components/creative-canvas/IdeaRootNode.tsx` | Modify | 加 `onContinue?: () => void` 与 `continueLoading?: boolean` props;仅在 `onContinue` 非 undefined 时渲染「继续」图标按钮;loading 态显示 spinner 并禁用 |
| `frontend/src/components/creative-canvas/IdeaRootNode.test.tsx` | Create | 单测:不传 onContinue 不渲染按钮;有 onContinue 渲染按钮;loading 态显示 spinner + 禁用;点击触发 callback;禁用态点击不触发 |
| `frontend/src/components/creative-canvas/CanvasPreStepHint.tsx` | Create | 新组件:`step?: number` prop(默认 1),渲染引导卡片,语义约束为(1)指向 IdeaRootNode 旁的「继续」按钮(2)提到 AI(3)步骤号动态 |
| `frontend/src/components/creative-canvas/CanvasPreStepHint.test.tsx` | Create | 单测:默认 step=1 文案含"第 1 步";step=3 文案含"第 3 步";渲染「继续」关键字提示 |
| `frontend/src/pages/CreativeCanvasPage.tsx` | Modify | 计算 `isStep1Available`;给 IdeaRootNode 传 `onContinue` + `continueLoading`(仅 Step 1 + available 时);在 active-step 区域前渲染 CanvasPreStepHint(仅 Step 1 + available + !activeStep) |
| `frontend/src/test/pages/CreativeCanvasPage.test.tsx` | Modify (扩展) | 测试:init 后 IdeaRootNode 显示「继续」;点「继续」触发 nextStep(1) 调用;active-step 区域显示 PreStepHint 直到 state=active;Step 2 available 时 IdeaRootNode 不显示「继续」(理论上 Step 2 不会到 available 态,作防御测试) |

---

## Task 1: IdeaRootNode — 添加 onContinue + continueLoading props

**Files:**
- Modify: `frontend/src/components/creative-canvas/IdeaRootNode.tsx`
- Create: `frontend/src/components/creative-canvas/IdeaRootNode.test.tsx`

- [ ] **Step 1: Write the failing test for IdeaRootNode props**

Create `frontend/src/components/creative-canvas/IdeaRootNode.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IdeaRootNode } from "@/components/creative-canvas/IdeaRootNode";

describe("IdeaRootNode onContinue", () => {
  it("does not render 继续 button when onContinue is undefined", () => {
    render(<IdeaRootNode prompt="修仙对抗外星" genre="xianxia" />);
    expect(screen.queryByTestId("idea-root-continue")).toBeNull();
  });

  it("renders 继续 button when onContinue is provided", () => {
    render(
      <IdeaRootNode
        prompt="修仙对抗外星"
        genre="xianxia"
        onContinue={() => {}}
      />,
    );
    const btn = screen.getByTestId("idea-root-continue");
    expect(btn).toBeInTheDocument();
    // Accessible label points to 继续 / 推进 / generate-next semantics.
    expect(btn.getAttribute("aria-label") ?? btn.textContent).toMatch(
      /继续|推进|生成下一步|继续生成/
    );
  });

  it("invokes onContinue callback when the button is clicked", () => {
    const onContinue = vi.fn();
    render(
      <IdeaRootNode
        prompt="修仙对抗外星"
        genre="xianxia"
        onContinue={onContinue}
      />,
    );
    fireEvent.click(screen.getByTestId("idea-root-continue"));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("shows spinner + disables button when continueLoading=true", () => {
    render(
      <IdeaRootNode
        prompt="修仙对抗外星"
        genre="xianxia"
        onContinue={() => {}}
        continueLoading
      />,
    );
    const btn = screen.getByTestId("idea-root-continue");
    expect(btn).toBeDisabled();
    // Loading visual: either an aria-busy attribute or a spinner element
    // inside the button. Either is acceptable; test at least one signal.
    expect(
      btn.getAttribute("aria-busy") === "true" ||
        btn.querySelector('[data-testid="idea-root-continue-spinner"]') !== null
    ).toBe(true);
  });

  it("does not invoke onContinue when the button is disabled (loading)", () => {
    const onContinue = vi.fn();
    render(
      <IdeaRootNode
        prompt="修仙对抗外星"
        genre="xianxia"
        onContinue={onContinue}
        continueLoading
      />,
    );
    fireEvent.click(screen.getByTestId("idea-root-continue"));
    expect(onContinue).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/creative-canvas/IdeaRootNode.test.tsx 2>&1 | tail -30`

Expected: Tests fail with "Cannot find module '@/components/creative-canvas/IdeaRootNode.test'" or similar — file does not exist yet. The test file may also be detected as passing trivially if the module resolution skips; verify the assertion `screen.queryByTestId("idea-root-continue")` actually runs against the IdeaRootNode component (not a stub). If the test file errors with "no test found" or import error, that's the expected failure.

- [ ] **Step 3: Add props + button to IdeaRootNode**

Modify `frontend/src/components/creative-canvas/IdeaRootNode.tsx`. Replace the entire file content with:

```typescript
interface Props {
  prompt: string;
  /**
   * Genre ID (e.g., "xianxia"). Surfaced as a small badge below the
   * prompt so users see "this is my 仙侠 idea" at a glance after init.
   * Mirrors PRD §11.2's empty-state contract (Idea + 类型). Hidden when
   * empty/undefined to avoid rendering an empty chip.
   */
  genre?: string;
  /**
   * Click handler for the "继续" button. When undefined, no button is
   * rendered — IdeaRootNode stays a pure-display card. The parent
   * (CreativeCanvasPage) provides this callback only when Step 1 is in
   * the "available" state (i.e., /init has run but /next-step has not),
   * so the button doubles as a Step 1 "advance" affordance.
   */
  onContinue?: () => void;
  /**
   * When true, the 继续 button shows a spinner and is disabled. Wired
   * to useCreativeCanvasV2.loadingStep so users see that the LLM call
   * is in flight. Defaults to false.
   */
  continueLoading?: boolean;
}

// Map of backend genre IDs → user-visible zh labels. Kept short and
// aligned with EmptyState's GENRES list so users don't see a Chinese
// label in the empty form and a raw ID ("xianxia") in the root node.
const GENRE_LABELS: Record<string, string> = {
  xianxia: "仙侠",
  scifi: "科幻",
  urban: "都市",
  mystery: "悬疑",
  history: "历史",
  fantasy: "玄幻",
};

export function IdeaRootNode({
  prompt,
  genre,
  onContinue,
  continueLoading = false,
}: Props) {
  const hasPrompt = prompt.trim().length > 0;
  const genreLabel = genre ? GENRE_LABELS[genre] ?? genre : null;

  return (
    <div
      data-testid="idea-root-node"
      className="relative z-10 flex flex-row items-center gap-md bg-surface p-3 rounded-lg w-fit"
    >
      {/* Original column (flag + label + prompt + genre) */}
      <div className="flex flex-col items-center w-[180px]">
        <div className="w-12 h-12 rounded-full bg-surface-container border-2 border-primary flex items-center justify-center mb-sm shrink-0">
          <span className="material-symbols-outlined text-primary text-sm">flag</span>
        </div>
        <span className="font-label-sm text-label-sm text-on-surface-variant text-center uppercase tracking-wider mb-xs">
          原始想法
        </span>
        <p
          data-testid="idea-root-prompt"
          className="text-sm text-on-surface text-center break-words leading-snug max-h-[120px] overflow-y-auto"
          title={hasPrompt ? prompt : ""}
        >
          {hasPrompt ? prompt : <span className="text-on-surface-variant/60">（暂无内容）</span>}
        </p>
        {genreLabel && (
          <span
            data-testid="idea-root-genre"
            className="mt-sm px-2 py-0.5 rounded-full bg-surface-container text-xs text-primary border border-primary/30"
          >
            {genreLabel}
          </span>
        )}
      </div>

      {/* Continue button — only shown when onContinue is provided. The
          testid + aria-label keep this affordance discoverable to
          Playwright / RTL and to screen readers. The visual is a
          right-arrow icon button so it reads as "advance" without
          requiring a long label, but the aria-label carries the full
          "继续" / "推进下一步" semantics. */}
      {onContinue && (
        <button
          type="button"
          data-testid="idea-root-continue"
          aria-label="继续生成下一步"
          aria-busy={continueLoading || undefined}
          disabled={continueLoading}
          onClick={onContinue}
          className="shrink-0 w-12 h-12 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center hover:bg-primary hover:text-on-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {continueLoading ? (
            <span
              data-testid="idea-root-continue-spinner"
              className="material-symbols-outlined animate-spin text-2xl"
              aria-hidden="true"
            >
              progress_activity
            </span>
          ) : (
            <span
              className="material-symbols-outlined text-2xl"
              aria-hidden="true"
            >
              arrow_forward
            </span>
          )}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/creative-canvas/IdeaRootNode.test.tsx 2>&1 | tail -20`

Expected: All 5 tests pass.

- [ ] **Step 5: Run TreeCanvas + CreativeCanvasPage tests to verify no regression**

Run: `cd frontend && npx vitest run src/components/creative-canvas/TreeCanvas.test.tsx src/test/pages/CreativeCanvasPage.test.tsx 2>&1 | tail -20`

Expected: All existing tests still pass. (IdeaRootNode's API change is backward-compatible — `onContinue` and `continueLoading` are optional, so existing call sites that don't pass them continue to render the original column-only layout.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/creative-canvas/IdeaRootNode.tsx \
        frontend/src/components/creative-canvas/IdeaRootNode.test.tsx
git commit -m "$(cat <<'EOF'
feat(canvas): add onContinue + continueLoading props to IdeaRootNode

IdeaRootNode grows two optional props so the wizard/canvas can surface
a "继续" affordance next to the raw-idea card. The button only
renders when onContinue is provided (no behavior change for existing
callers). Loading state shows a spinner + disables the button.

Used by Task 3 to wire the canvas Step 1 "available → active"
transition to a discoverable button next to the idea, instead of
the buried TreeCanvas 中央 advance button (still kept as a redundant
entry per spec §3.3).

Spec: docs/superpowers/specs/2026-09-04-canvas-init-next-step-design.md §3.1, §4.1
Task 1 of 4.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: CanvasPreStepHint — 新组件

**Files:**
- Create: `frontend/src/components/creative-canvas/CanvasPreStepHint.tsx`
- Create: `frontend/src/components/creative-canvas/CanvasPreStepHint.test.tsx`

- [ ] **Step 1: Write the failing test for CanvasPreStepHint**

Create `frontend/src/components/creative-canvas/CanvasPreStepHint.test.tsx`:

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CanvasPreStepHint } from "@/components/creative-canvas/CanvasPreStepHint";

describe("CanvasPreStepHint", () => {
  it("renders the step number dynamically (default step=1)", () => {
    render(<CanvasPreStepHint />);
    // The "第 1 步" text must appear; exact wording is UI-polish, the
    // semantic invariant is that the step number is interpolated.
    expect(screen.getByText(/第\s*1\s*步/)).toBeInTheDocument();
  });

  it("honors the step prop (step=3 → 第 3 步)", () => {
    render(<CanvasPreStepHint step={3} />);
    expect(screen.getByText(/第\s*3\s*步/)).toBeInTheDocument();
  });

  it("mentions 继续 / 推进 / 上方 to point users at the continue button", () => {
    render(<CanvasPreStepHint />);
    // The hint is pointless if it doesn't direct the user to click
    // 继续. Assert that the body text contains at least one such
    // cue word. Wording is intentionally flexible.
    const body = screen.getByTestId("canvas-pre-step-hint");
    expect(body.textContent).toMatch(/继续|推进|上方|旁边/);
  });

  it("mentions AI / 创意操作 / 推演 to explain what's being generated", () => {
    render(<CanvasPreStepHint />);
    const body = screen.getByTestId("canvas-pre-step-hint");
    expect(body.textContent).toMatch(/AI|创意|推演|操作|方向/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/creative-canvas/CanvasPreStepHint.test.tsx 2>&1 | tail -20`

Expected: Tests fail with import error (module not found).

- [ ] **Step 3: Create CanvasPreStepHint component**

Create `frontend/src/components/creative-canvas/CanvasPreStepHint.tsx`:

```typescript
interface Props {
  /**
   * 1-indexed step number. Surfaces in the body copy as "第 N 步" so
   * the user knows which step is about to be generated. Defaults to 1
   * (the only step where this hint is rendered per spec §3.3).
   */
  step?: number;
}

/**
 * Active-step area placeholder shown when the canvas is in the
 * "Step N is available, AI has not generated the 3 options yet" state.
 *
 * The hint serves two purposes:
 *   1. Tell the user that the canvas is waiting on them (not stuck).
 *   2. Direct them to the "继续" affordance on the IdeaRootNode card.
 *
 * Per spec §3.3, this is rendered only for Step 1 — Step 2-5 cascade
 * from /select and never enter the "available" state in actual flow.
 */
export function CanvasPreStepHint({ step = 1 }: Props) {
  return (
    <div
      data-testid="canvas-pre-step-hint"
      className="flex flex-col items-center gap-2 max-w-xl mx-auto p-md border border-dashed border-primary/30 rounded-lg bg-primary-container/5"
    >
      <span className="material-symbols-outlined text-primary text-3xl" aria-hidden="true">
        auto_awesome
      </span>
      <p className="text-sm text-on-surface text-center leading-relaxed">
        等待 AI 生成第 <span className="font-bold text-primary">{step}</span> 步的推演方向。
      </p>
      <p className="text-xs text-on-surface-variant text-center">
        点击上方「继续」,让 AI 决定这一步用什么创意操作。
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/creative-canvas/CanvasPreStepHint.test.tsx 2>&1 | tail -20`

Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/creative-canvas/CanvasPreStepHint.tsx \
        frontend/src/components/creative-canvas/CanvasPreStepHint.test.tsx
git commit -m "$(cat <<'EOF'
feat(canvas): add CanvasPreStepHint placeholder for Step 1 available

CanvasPreStepHint is the active-step-area card shown when /init has
run but the user has not yet clicked "继续" to populate Step 1. It
replaces the previous blank state with a discoverable cue pointing
at the IdeaRootNode "继续" button.

Renders only for Step 1 per spec §3.3 — Step 2-5 cascade from /select
and never enter the "available" state in actual flow, so the hint is
a Step 1-only concept.

Spec: docs/superpowers/specs/2026-09-04-canvas-init-next-step-design.md §3.1, §4.2
Task 2 of 4.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: CreativeCanvasPage — wire IdeaRootNode onContinue + render CanvasPreStepHint

**Files:**
- Modify: `frontend/src/pages/CreativeCanvasPage.tsx`
- Modify: `frontend/src/test/pages/CreativeCanvasPage.test.tsx`

- [ ] **Step 1: Inspect the existing page + test for the right insertion points**

Read `frontend/src/pages/CreativeCanvasPage.tsx` and find:
- Where `IdeaRootNode` is rendered (search for `idea-root-node` testid reference, or `<IdeaRootNode`).
- Where the active-step panel is rendered (the `activeStep && (...)` block around line 191).
- Note the existing imports — the file already imports `TreeCanvas` from `@/components/creative-canvas/TreeCanvas`; we'll add `IdeaRootNode` and `CanvasPreStepHint` from the same path.

Read `frontend/src/test/pages/CreativeCanvasPage.test.tsx` to find:
- The `mockUseCreativeCanvasV2` setup pattern.
- The base `CanvasV4State` builder (likely `makeBaseCanvas()` or similar).
- A test that mocks an "after init, Step 1 available" canvas state — if none, we'll add one.

- [ ] **Step 2: Write the failing tests for the new wiring**

Append to `frontend/src/test/pages/CreativeCanvasPage.test.tsx` (inside the existing top-level `describe`):

```typescript
describe("CreativeCanvasPage Step 1 available wiring", () => {
  const baseAfterInit: CanvasV4State = {
    schema_version: 4,
    session_id: "s1",
    _etag: "e1",
    root_idea: {
      prompt: "修仙对抗外星",
      genre: "xianxia",
      premise: "修仙对抗外星",
      extracted: { seed: null, entities: [], emotional_tone: null, themes: [] },
    },
    raw_intent: { prompt: "修仙对抗外星", genre: "xianxia" },
    creative_session: { current_step: 1, max_steps: 5, status: "active" },
    creative_path: [
      {
        step: 1,
        operation: null,
        operation_reason: null,
        options: [],
        selected_option_id: null,
        created_at: "2026-09-04T00:00:00",
        selected_at: null,
        regenerated_count: 0,
        state: "available",
      },
    ],
    current_concept: { one_line: "", expanded: "", core_tension: "", tone: "" },
    final_concept: null,
    committed: false,
    committed_at: null,
    scores: { novelty: 0, depth: 0, conflict: 0, market: 0, composite: 0 },
    session_metadata: {},
  };

  function setupAfterInit() {
    mockUseCreativeCanvasV2.mockReturnValue({
      status: "active",
      canvas: baseAfterInit,
      error: null,
      loadingStep: false,
      committedAt: null,
      canCommit: false,
      loadCanvas: vi.fn(),
      initSession: vi.fn(),
      nextStep: vi.fn().mockResolvedValue({}),
      selectOption: vi.fn(),
      commitCanvas: vi.fn(),
      showResetDialog: false,
      onReset: vi.fn(),
      closeResetDialog: vi.fn(),
      confirmReset: vi.fn(),
      showPreCommit: false,
      onCommitClick: vi.fn(),
      closePreCommit: vi.fn(),
      confirmCommit: vi.fn(),
    });
  }

  it("renders IdeaRootNode 继续 button after init (Step 1 available)", () => {
    setupAfterInit();
    renderWithProviders(
      <MemoryRouter initialEntries={["/project/p1/stage1/canvas"]}>
        <Routes>
          <Route
            path="/project/:projectId/stage1/canvas"
            element={<CreativeCanvasPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("idea-root-continue")).toBeInTheDocument();
  });

  it("renders CanvasPreStepHint in the active-step area when Step 1 is available and no active step", () => {
    setupAfterInit();
    renderWithProviders(
      <MemoryRouter initialEntries={["/project/p1/stage1/canvas"]}>
        <Routes>
          <Route
            path="/project/:projectId/stage1/canvas"
            element={<CreativeCanvasPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("canvas-pre-step-hint")).toBeInTheDocument();
  });

  it("clicking IdeaRootNode 继续 calls nextStep(1)", async () => {
    const nextStep = vi.fn().mockResolvedValue({});
    setupAfterInit();
    mockUseCreativeCanvasV2.mockReturnValue({
      ...mockUseCreativeCanvasV2.mock.results[0]?.value,
      nextStep,
    });
    renderWithProviders(
      <MemoryRouter initialEntries={["/project/p1/stage1/canvas"]}>
        <Routes>
          <Route
            path="/project/:projectId/stage1/canvas"
            element={<CreativeCanvasPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("idea-root-continue"));
    await waitFor(() => expect(nextStep).toHaveBeenCalledWith(1));
  });

  it("does not show 继续 button on Step 2 (which never enters available in actual flow)", () => {
    // Defensive test: even if some bug or future state-machine change
    // makes Step 2 land in "available", the IdeaRootNode button is
    // Step 1 only. Step 2 onward rely on TreeCanvas 中央 advance button.
    mockUseCreativeCanvasV2.mockReturnValue({
      status: "active",
      canvas: {
        ...baseAfterInit,
        creative_path: [
          {
            step: 1,
            operation: "twist",
            operation_reason: "...",
            options: [
              { id: "opt_1_a", title: "A", premise: "a", logic: "", scores: {} },
              { id: "opt_1_b", title: "B", premise: "b", logic: "", scores: {} },
              { id: "opt_1_c", title: "C", premise: "c", logic: "", scores: {} },
            ],
            selected_option_id: "opt_1_b",
            created_at: "2026-09-04T00:00:00",
            selected_at: "2026-09-04T00:01:00",
            regenerated_count: 0,
            state: "completed",
          },
          {
            step: 2,
            operation: null,
            operation_reason: null,
            options: [],
            selected_option_id: null,
            created_at: "2026-09-04T00:00:00",
            selected_at: null,
            regenerated_count: 0,
            state: "available",
          },
        ],
      },
      error: null,
      loadingStep: false,
      committedAt: null,
      canCommit: false,
      loadCanvas: vi.fn(),
      initSession: vi.fn(),
      nextStep: vi.fn(),
      selectOption: vi.fn(),
      commitCanvas: vi.fn(),
      showResetDialog: false,
      onReset: vi.fn(),
      closeResetDialog: vi.fn(),
      confirmReset: vi.fn(),
      showPreCommit: false,
      onCommitClick: vi.fn(),
      closePreCommit: vi.fn(),
      confirmCommit: vi.fn(),
    });
    renderWithProviders(
      <MemoryRouter initialEntries={["/project/p1/stage1/canvas"]}>
        <Routes>
          <Route
            path="/project/:projectId/stage1/canvas"
            element={<CreativeCanvasPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByTestId("idea-root-continue")).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify the new tests fail**

Run: `cd frontend && npx vitest run src/test/pages/CreativeCanvasPage.test.tsx 2>&1 | tail -40`

Expected: The 4 new tests fail. `idea-root-continue` is not yet rendered by the page, and `canvas-pre-step-hint` doesn't exist. Existing tests should still pass.

- [ ] **Step 4: Wire onContinue + render PreStepHint in the page**

In `frontend/src/pages/CreativeCanvasPage.tsx`:

1. Add imports near the top (next to the other `creative-canvas` component imports around line 5-11):

```typescript
import { IdeaRootNode } from "@/components/creative-canvas/IdeaRootNode";
import { CanvasPreStepHint } from "@/components/creative-canvas/CanvasPreStepHint";
```

2. Inside `CreativeCanvasPage`, after the `completedCount` line (around line 124) and before the `headerOperation` line, add the step-1-availability computation:

```typescript
  // Step 1 "available" check — drives both the IdeaRootNode 继续
  // button (new, this task) and the CanvasPreStepHint placeholder.
  // Step 2-5 never enter "available" in actual flow (the backend
  // /select cascade flips them straight to "active"), so this flag
  // is effectively Step-1-only. We still guard on `step === 1` to
  // keep the contract explicit (spec §3.3).
  const step1 = canvas.creative_path?.[0];
  const isStep1Available =
    step1?.state === "available" && step1?.step === 1;
```

3. Find the `<TreeCanvas ... />` render in the JSX (around line 158). The `TreeCanvas` is rendered as a self-closing tag. The `IdeaRootNode` is rendered *inside* the TreeCanvas (search the codebase to confirm — based on the v2 spec, the IdeaRootNode appears as the first column of the tree visualization). If `IdeaRootNode` is inside `TreeCanvas` (rendered by TreeCanvas itself), we need to either:
   - (a) Add an `onAdvance` / `onContinue` prop to TreeCanvas and pass it through, OR
   - (b) Lift IdeaRootNode out of TreeCanvas and render it as a sibling.

   **(a) is the smaller-blast-radius change.** Read `TreeCanvas.tsx` to see how `IdeaRootNode` is currently used; if `TreeCanvas` instantiates it directly, add a pass-through prop.

   For the page-level wiring, this means the page passes `onContinue` down to `TreeCanvas`, which forwards to `IdeaRootNode`. The page itself does not render `IdeaRootNode` directly.

   **Inspect first:** Open `TreeCanvas.tsx` and find the `IdeaRootNode` instantiation. If the existing import is something like:
   ```typescript
   import { IdeaRootNode } from "./IdeaRootNode";
   ...
   <IdeaRootNode prompt={...} genre={...} />
   ```
   Then add an optional `ideaOnContinue?: () => void` + `ideaContinueLoading?: boolean` prop to `TreeCanvas`, and forward them to `IdeaRootNode`. Update `TreeCanvas.test.tsx` if any existing tests assert on IdeaRootNode's button (Task 1's test covers this; TreeCanvas tests should still pass since both new props are optional).

   If `TreeCanvas` does NOT render `IdeaRootNode` and the page renders it as a sibling, then the page-side change is simpler — just add the props directly.

4. After the `<TreeCanvas ... />` JSX and before the active-step panel (`{activeStep && (...)}`), add the PreStepHint render:

```typescript
      {!activeStep && isStep1Available && (
        <div className="mt-6" data-testid="active-step-panel">
          <CanvasPreStepHint step={1} />
        </div>
      )}
```

   The `data-testid="active-step-panel"` mirrors the existing wrapper (line 192) so downstream tests / selectors that key off it keep working. The panel block is empty (no `activeStep`) but the PreStepHint fills it with the discovery cue.

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `cd frontend && npx vitest run src/test/pages/CreativeCanvasPage.test.tsx 2>&1 | tail -40`

Expected: All tests pass (existing + 4 new).

If `TreeCanvas` requires a pass-through prop (option 4a), also run:

Run: `cd frontend && npx vitest run src/components/creative-canvas/TreeCanvas.test.tsx 2>&1 | tail -20`

Expected: All TreeCanvas tests still pass. (Adding optional pass-through props is backward-compatible.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/CreativeCanvasPage.tsx \
        frontend/src/test/pages/CreativeCanvasPage.test.tsx
# Add TreeCanvas changes only if Step 4 needed option 4a
git add frontend/src/components/creative-canvas/TreeCanvas.tsx \
        frontend/src/components/creative-canvas/TreeCanvas.test.tsx 2>/dev/null || true
git commit -m "$(cat <<'EOF'
feat(canvas): wire Step 1 continue button + PreStepHint in canvas page

CreativeCanvasPage computes isStep1Available from creative_path[0]
and passes onContinue={() => nextStep(1)} + continueLoading to
IdeaRootNode (via TreeCanvas pass-through if needed). The active-step
area renders CanvasPreStepHint when no active step exists but Step 1
is available — closing the "blank active area after init" gap.

Step 2-5 do not get the IdeaRootNode 继续 button (their cascade from
/select keeps them at "active" with options already populated). The
TreeCanvas 中央 advance button is kept as-is for Step 1 redundancy
and any future state where a step lands in "available".

Spec: docs/superpowers/specs/2026-09-04-canvas-init-next-step-design.md §3.2, §3.3
Task 3 of 4.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 全量回归 + 手动 smoke

**Files:** none (verification only)

- [ ] **Step 1: Run the full canvas-related test set**

Run: `cd frontend && npx vitest run src/components/creative-canvas/ src/test/pages/CreativeCanvasPage.test.tsx src/test/WizardContext.test.tsx 2>&1 | tail -20`

Expected: All tests pass. If anything fails, treat as a Task 3 bug (regression in the page or TreeCanvas), fix and re-run.

- [ ] **Step 2: Run the full frontend test set (excluding known-broken autopilot SSE tests)**

Run: `cd frontend && npx vitest run --exclude='**/Workspace.test.tsx' --exclude='**/pages.test.tsx' 2>&1 | tail -20`

Expected: All tests pass except possibly the 13 pre-existing autopilot SSE failures in `Workspace.test.tsx` + `pages.test.tsx` (per memory `project_canvas_wizard_integration.md` and the canvas-wizard plan §Pre-existing test failure count — unrelated to this work, do not attempt to fix).

- [ ] **Step 3: Backend regression — verify v2 canvas endpoints still respond**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest tests/test_v2_canvas_endpoints.py -v 2>&1 | tail -20`

Expected: All tests pass. (This plan does not change backend code; running the backend tests is a smoke check to confirm we didn't accidentally introduce a frontend contract change that the tests would catch.)

- [ ] **Step 4: Manual smoke via dev server**

1. Start backend (if not running): `cd /Users/longsa/Codes/nebula && source venv/bin/activate && uvicorn backend.main:app --port 8000`
2. Start frontend: `cd /Users/longsa/Codes/nebula/frontend && npm run dev`
3. Navigate to a project's `/project/:id/stage1/canvas` (or use the workspace wizard → 创意画布).
4. If canvas is fresh, type an idea + genre → click 「开始创意推演」.
5. After the canvas loads, verify:
   - The IdeaRootNode card now has a 「继续」 arrow icon on the right.
   - The active-step area shows the PreStepHint placeholder ("等待 AI 生成第 1 步的推演方向。点击上方「继续」…").
   - The TreeCanvas 中央 advance-step-1 button is still there (redundant entry).
6. Click IdeaRootNode 「继续」:
   - Button shows spinner briefly.
   - PreStepHint disappears.
   - 3 OptionCard appear (the existing active-step panel).
7. Select any A/B/C option:
   - Step 1 marked completed.
   - Step 2 appears immediately (cascade).
   - IdeaRootNode 「继续」 button disappears (Step 2-5 never enter available in flow).
   - TreeCanvas 中央 advance-step-2 button does NOT appear (because Step 2 is active, not available).
8. Continue selecting through Step 5 → canCommit flips true → commit flow works as before.

If any step fails, debug and fix before marking Task 4 complete.

- [ ] **Step 5: Commit the spec cross-reference (no code changes expected)**

```bash
git status
```

Expected: No uncommitted changes. If something is left over, add and commit it with an appropriate message.

```bash
git log --oneline -5
```

Expected: 4 new commits on top of the spec commit (`e7daf15` or similar):
1. `feat(canvas): add onContinue + continueLoading props to IdeaRootNode`
2. `feat(canvas): add CanvasPreStepHint placeholder for Step 1 available`
3. `feat(canvas): wire Step 1 continue button + PreStepHint in canvas page`
4. (None — Task 4 is verification only.)

---

## Self-Review

**1. Spec coverage:**

| Spec section | Task |
|---|---|
| §1.1 current gap | (Reference only) |
| §1.2 mockup vs implementation deviation | (Reference only) |
| §1.3 goals: continue-button placement | Task 1 (props) + Task 3 (wiring) |
| §1.3 goals: Step 1 pre-active guidance | Task 2 (component) + Task 3 (render) |
| §1.3 goals: Step 1 after-active panel works | Task 3 (activeStep panel still rendered when state=active) |
| §1.3 goals: Step 2-5 trigger logic unchanged | Task 3 (`isStep1Available` guards) |
| §1.3 goals: backend zero changes | Tasks 1-3 are frontend-only |
| §1.3 goals: state machine zero changes | Tasks 1-3 don't touch state machine |
| §1.4 out of scope: /init, /next-step, /select cascade, state machine, removing TreeCanvas button, early-finalize, mockup "always-visible cards" | Tasks 1-3 don't touch any of these |
| §2 user journey (Step 1 init → 继续 → active → select → cascade) | Tasks 1-3 implement each arrow |
| §3.1 file changes | Tasks 1, 2, 3 each match |
| §3.2 data flow diagram | Task 3 implements the onContinue wiring + PreStepHint render |
| §3.3 invariants: onContinue only when Step 1+available | Task 3 `isStep1Available` guard + Task 3 test "Step 2 available → no 继续" |
| §3.3 invariants: continueLoading wired to loadingStep | Task 3 wires `loadingStep` to `continueLoading` |
| §3.3 invariants: PreStepHint only when !activeStep + Step 1 + available | Task 3 JSX `{!activeStep && isStep1Available && ...}` |
| §3.3 invariants: TreeCanvas button preserved | Task 3 doesn't touch the TreeCanvas button render |
| §3.3 invariants: backend zero changes | Tasks 1-3 are frontend-only |
| §3.4 error handling: hook error → toast (existing) | (Reference only — not changed) |
| §3.4 error handling: rapid double-click guarded by disabled | Task 1 test "disabled state doesn't fire onContinue" |
| §4.1 IdeaRootNode API | Task 1 Step 3 implements exact prop names + types |
| §4.2 CanvasPreStepHint API | Task 2 Step 3 implements `step?: number` prop |
| §5.1 unit tests: IdeaRootNode (5 cases) | Task 1 Step 1 covers all 5 |
| §5.1 unit tests: CanvasPreStepHint (2 cases) | Task 2 Step 1 covers 4 (default step, custom step, mentions 继续, mentions AI) |
| §5.1 unit tests: CreativeCanvasPage (4 cases) | Task 3 Step 2 covers 4 (continue button, PreStepHint, click→nextStep, Step 2 no button) |
| §5.2/5.3 integration/E2E | Task 4 step 1-3 (existing tests) + Task 4 step 4 (manual) |
| §6 risks | Addressed by Task 4 manual smoke (Step 4 covers the "两种 continue 入口" risk) |
| §7 acceptance checklist | Task 4 is the run-through |

No gaps found.

**2. Placeholder scan:** No `TBD` / `TODO` / `implement later` / `fill in details` / `add appropriate error handling` / `similar to Task N` in any task. The test code blocks are complete and runnable.

**3. Type consistency:**

- `onContinue?: () => void` — defined in Task 1 (IdeaRootNode props), passed through Task 3 (CreativeCanvasPage). ✓
- `continueLoading?: boolean` — same. ✓
- `step?: number` — defined in Task 2 (CanvasPreStepHint), passed `step={1}` in Task 3. ✓
- `nextStep(currentStep: number)` — hook's existing signature, used as `nextStep(1)` in Task 3. ✓
- `isStep1Available` — defined in Task 3, used in Task 3 JSX. ✓
- `data-testid="idea-root-continue"` — defined in Task 1, asserted in Tasks 1 + 3. ✓
- `data-testid="canvas-pre-step-hint"` — defined in Task 2, asserted in Tasks 2 + 3. ✓
- `data-testid="active-step-panel"` — exists in current code (`CreativeCanvasPage.tsx:192`); re-used in Task 3 for the PreStepHint wrapper. ✓
- TreeCanvas pass-through props (`ideaOnContinue` / `ideaContinueLoading`) — only added if Step 4 of Task 3 goes option 4a; names are consistent within Task 3.

All consistent.

**4. Edge case check:**

- **User refreshes mid-Step-1-available**: IdeaRootNode re-renders with onContinue (because `isStep1Available` is derived from `canvas.creative_path[0].state`). PreStepHint re-renders. ✓
- **User on Step 1 active, refreshes**: `isStep1Available=false` (state is "active"), IdeaRootNode button doesn't render, active-step panel shows 3 OptionCards. ✓
- **User mid-`nextStep` LLM call, clicks 继续 twice rapidly**: button disabled while `continueLoading=true` (Task 1 test covers this). ✓
- **LLM call fails**: hook's `error` state + toast (existing). Button un-disables when `loadingStep` flips false. ✓
- **User in wizard embedded mode**: IdeaRootNode onContinue still works (CreativeCanvasPage is the same component; embedded just hides the page-shell header). ✓

No issues found.

---

## Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-04-canvas-init-next-step.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
