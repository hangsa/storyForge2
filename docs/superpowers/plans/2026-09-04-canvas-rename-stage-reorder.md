# 剧情画布重命名 + 阶段重排 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Wizard 流程中的"创意画布"重命名为"剧情画布"，并把它的阶段从 Step 1 (动态 Step 1 表面) 移到 Step 6 (地图系统之后、全文大纲之前)。

**Architecture:** 三块改动按依赖顺序：① 拆掉 WizardContext 中的 step1-surface 抽象（foundation），② 重命名文件 / 标识符 / 路由（feature surface），③ 更新文档与测试（cleanup）。每块内多步可独立 commit / verify。

**Tech Stack:** React 18 + TypeScript + Vite + Vitest（前端）/ FastAPI + pytest（后端）。

**Reference Spec:** `docs/superpowers/specs/2026-09-04-canvas-rename-stage-reorder-design.md`

**测试约定：**
- 前端单测：`cd frontend && npm test -- --run <test_path>`（vitest run）
- 前端 typecheck：`cd frontend && npx tsc --noEmit`
- 后端：`pytest <test_path>`

---

## 文件 / 目录变更总览

### Rename

| 原 | 新 |
|---|---|
| `frontend/src/components/creative-canvas/` | `frontend/src/components/plot-canvas/` |
| `frontend/src/components/creative-canvas/CreativeCanvasMountPoint.tsx` | `frontend/src/components/plot-canvas/PlotCanvasMountPoint.tsx` |
| `frontend/src/components/creative-canvas/CreativeCanvasMountPoint.test.tsx` | `frontend/src/components/plot-canvas/PlotCanvasMountPoint.test.tsx` |
| `frontend/src/pages/CreativeCanvasPage.tsx` | `frontend/src/pages/PlotCanvasPage.tsx` |
| `frontend/src/test/pages/CreativeCanvasPage.test.tsx` | `frontend/src/test/pages/PlotCanvasPage.test.tsx` |
| `frontend/src/hooks/useCreativeCanvasV2.ts` | `frontend/src/hooks/usePlotCanvasV2.ts` |
| `frontend/src/hooks/useCreativeCanvasV2.test.ts` | `frontend/src/hooks/usePlotCanvasV2.test.ts` |
| `frontend/src/test/components/creative-canvas/` | `frontend/src/test/components/plot-canvas/` |

### Modify (with line refs to old code)

- `frontend/src/components/wizard/WizardContext.tsx` — 拆 step1-surface 抽象
- `frontend/src/components/wizard/WizardSidebar.tsx` — 8 项，移除 surface 逻辑
- `frontend/src/components/wizard/WorkspaceWizardPanel.tsx` — render + prefill
- `frontend/src/App.tsx` — 路由 path
- `frontend/src/components/layout/Stage1Layout.tsx` — 检查路由引用
- `frontend/src/components/layout/MainLayout.tsx` — 检查路由引用
- `frontend/src/api/client.ts` — 检查方法名是否含 "Creative"（应当保留）
- `frontend/src/components/plot-canvas/IdeaRootNode.tsx` — 中文文案 + 内部 testid
- `frontend/src/components/plot-canvas/TreeCanvas.tsx` — 同上
- `frontend/src/components/plot-canvas/CanvasPreStepHint.tsx` — 同上
- `frontend/src/components/plot-canvas/OptionCard.tsx` — 同上
- `frontend/src/components/wizard/WizardSidebar.test.tsx` — 断言更新
- `frontend/src/test/WizardContext.test.tsx` — 删 surface 测试
- `frontend/src/components/wizard/WorkspaceWizardPanel.test.tsx` — 断言更新
- `frontend/src/test/pages.test.tsx` — 路由断言更新
- `frontend/src/hooks/usePlotCanvasV2.test.ts` — import / 引用更新
- `tests/test_canvas_wizard_integration.py` — 注释更新
- `docs/design/creative-canvas-reconstruction.md` — 标题 + 路径 + 信息架构

---

## Phase A: 拆 step1-surface 抽象（foundation）

### Task 1: WizardContext.tsx 删 step1-surface

**Files:**
- Modify: `frontend/src/components/wizard/WizardContext.tsx`

**改动清单：**

1. 删 `Step1SurfaceId` 类型（line 46 附近）
2. 从 `WizardState` 删 `activeStep1Surface` 与 `completedStep1Surfaces`（line 156-165）
3. 从 `initialState` 删对应初值（line 239-240）
4. 删三个 reducer action 类型与 case（line 220-222 + line 367-413）
5. 从 `WizardContextValue` interface 删三个方法（line 538-553）
6. 从 `value` 对象中删三个 dispatch 包装（line 643-648）
7. 删 `isStep1EffectivelyCompleted` 导出函数（line 668-676）
8. `loadPersisted` 中删 `activeStep1Surface` 与 `completedStep1Surfaces` 的读取与 default（line 453-460）
9. `useEffect` 中持久化字段中删 `activeStep1Surface` 与 `completedStep1Surfaces`（line 603-604）

- [ ] **Step 1: 删 Step1SurfaceId 类型**

在 `WizardContext.tsx` 第 41-46 行附近：

```ts
/**
 * Within step 1 (Creative Divergence), the current sub-step position. Step 1
 * is broken into 5 sequential screens: A (input), B (mutation), C
 * (contradiction), D (expand), E (commit). The CreativeDivergenceStep
 * component reads this to decide which sub-screen renders, and resets to "A"
 * whenever the user enters step 1 fresh.
 */
export type CreativeDivergenceSubStage = "A" | "B" | "C" | "D" | "E";

/**
 * Step 1 of the wizard has two parallel surfaces:
 *   - "divergence" — the original CreativeDivergenceStep (A→B→C→D→E)
 *   - "canvas"     — the v4 创意画布 (5-step path of 3 options/step)
 * Both are surfaced in the sidebar at position 1; either surface's
 * completion unlocks step 2 (OR semantic). The two are independent —
 * completing one does NOT mark the other.
 */
export type Step1SurfaceId = "divergence" | "canvas";
```

整段替换为：

```ts
/**
 * Within step 1 (Creative Divergence), the current sub-step position. Step 1
 * is broken into 5 sequential screens: A (input), B (mutation), C
 * (contradiction), D (expand), E (commit). The CreativeDivergenceStep
 * component reads this to decide which sub-screen renders, and resets to "A"
 * whenever the user enters step 1 fresh.
 */
export type CreativeDivergenceSubStage = "A" | "B" | "C" | "D" | "E";
```

- [ ] **Step 2: 删 WizardState 字段**

`WizardState` interface 中第 156-165 行附近：

```ts
  /**
   * Which step-1 surface is currently rendered in the wizard's main
   * area. Only meaningful when `currentStep === 1`; the field is
   * preserved (not reset) when the user navigates to step 2+ and
   * back, so they return to the surface they last used.
   * Default: "divergence" (preserves pre-integration behavior).
   */
  activeStep1Surface: Step1SurfaceId;
  /**
   * Set of step-1 surfaces that have completed (independent, OR
   * semantic). Persists to sessionStorage; disk prefill overrides
   * via `hydrateStep1Surfaces`. Sorted on write (alphabetical) for
   * deterministic sidebar `✓` placement.
   */
  completedStep1Surfaces: Step1SurfaceId[];
}
```

整段替换为：

```ts
}
```

- [ ] **Step 3: 删 initialState 字段**

`initialState` 对象（第 239-240 行附近）：

```ts
  activeStep1Surface: "divergence",
  completedStep1Surfaces: [],
```

整段删除。

- [ ] **Step 4: 删三个 reducer action 类型**

`WizardAction` union 类型（第 220-222 行附近）：

```ts
  | { type: "SET_ACTIVE_STEP1_SURFACE"; surface: Step1SurfaceId }
  | { type: "MARK_STEP1_SURFACE_COMPLETED"; surface: Step1SurfaceId }
  | { type: "HYDRATE_STEP1_SURFACES"; surfaces: Step1SurfaceId[] };
```

替换为：

```ts
```

（即删掉这三行）

- [ ] **Step 5: 删三个 reducer case**

在 `reducer` 函数中（第 367-413 行附近），整段删除：

```ts
    case "SET_ACTIVE_STEP1_SURFACE": {
      // Always set currentStep=1 (no-op if already 1) so clicking
      // a surface from a later step lands the user back at step 1.
      // creativeDivergenceSubStage is preserved — switching to canvas
      // and back should restore the user's last divergence sub-step.
      return {
        ...state,
        currentStep: 1,
        activeStep1Surface: action.surface,
      };
    }
    case "MARK_STEP1_SURFACE_COMPLETED": {
      if (state.completedStep1Surfaces.includes(action.surface)) return state;
      // Sync completedSteps so step 2's `reachable = completed ||
      // current` (which reads completedSteps.includes(1)) flips to
      // enabled immediately. Without this, the user has to wait for
      // the next page reload (which forces prefill rerun) before
      // step 2 unlocks.
      const nextCompletedSteps = state.completedSteps.includes(1)
        ? state.completedSteps
        : [...state.completedSteps, 1].sort((a, b) => a - b);
      return {
        ...state,
        completedStep1Surfaces: [
          ...state.completedStep1Surfaces,
          action.surface,
        ].sort(),
        completedSteps: nextCompletedSteps,
      };
    }
    case "HYDRATE_STEP1_SURFACES": {
      // Union with existing — sessionStorage-loaded surfaces stay
      // even if prefill didn't re-confirm them on disk (e.g., user
      // completed a surface but the disk write hasn't landed yet).
      const merged = Array.from(
        new Set([...state.completedStep1Surfaces, ...action.surfaces]),
      ).sort();
      // Same OR-semantic push to completedSteps as the marker reducer
      const nextCompletedSteps = merged.length >= 1 && !state.completedSteps.includes(1)
        ? [...state.completedSteps, 1].sort((a, b) => a - b)
        : state.completedSteps;
      return {
        ...state,
        completedStep1Surfaces: merged,
        completedSteps: nextCompletedSteps,
      };
    }
```

- [ ] **Step 6: 删 WizardContextValue 三个方法**

`WizardContextValue` interface（第 532-553 行附近）：

```ts
  /**
   * Switch the active step-1 surface. If currently on step 2+, also
   * jumps to step 1 (the reducer handles this). Preserves
   * creativeDivergenceSubStage so the user returns to the same
   * divergence sub-stage when toggling back from canvas.
   */
  setActiveStep1Surface: (id: Step1SurfaceId) => void;
  /**
   * Mark a step-1 surface as completed. Idempotent. Also pushes 1
   * into completedSteps so step 2 reachability flips immediately.
   * The canvas and divergence page components call this via the
   * `onCommitSuccess` callback prop they receive — they do NOT call
   * useWizard() directly (the page is standalone-capable).
   */
  markStep1SurfaceCompleted: (id: Step1SurfaceId) => void;
  /**
   * Merge disk-derived surfaces into the completed set. Called from
   * the prefill useEffect in WorkspaceWizardPanel after
   * getCreativeDivergence + getCanvasV2State resolve. Union via Set
   * dedup; existing surfaces stay even if prefill didn't re-confirm.
   */
  hydrateStep1Surfaces: (surfaces: Step1SurfaceId[]) => void;
}
```

替换为：

```ts
}
```

- [ ] **Step 7: 删 value 对象中 dispatch 包装**

`WizardProvider` 内 `value` 对象（第 643-648 行附近）：

```ts
    setActiveStep1Surface: (surface) =>
      dispatch({ type: "SET_ACTIVE_STEP1_SURFACE", surface }),
    markStep1SurfaceCompleted: (surface) =>
      dispatch({ type: "MARK_STEP1_SURFACE_COMPLETED", surface }),
    hydrateStep1Surfaces: (surfaces) =>
      dispatch({ type: "HYDRATE_STEP1_SURFACES", surfaces }),
```

整段删除。

- [ ] **Step 8: 删 isStep1EffectivelyCompleted 导出**

文件末尾（第 668-676 行附近）：

```ts
/**
 * True iff at least one step-1 surface has completed. Used by tests
 * and any external code that wants to know if step 2 should be
 * reachable. Sidebar itself uses `completedSteps.includes(1)` which
 * is kept in sync via the reducer.
 */
export function isStep1EffectivelyCompleted(state: WizardState): boolean {
  return state.completedStep1Surfaces.length >= 1;
}
```

整段删除。

- [ ] **Step 9: 删 loadPersisted 中两字段读取**

`loadPersisted` 函数（第 453-460 行附近）：

```ts
        activeStep1Surface:
          parsed.activeStep1Surface === "canvas" ? "canvas" : "divergence",
        completedStep1Surfaces: Array.isArray(parsed.completedStep1Surfaces)
          ? parsed.completedStep1Surfaces.filter(
              (s: unknown): s is Step1SurfaceId =>
                s === "divergence" || s === "canvas",
            )
          : [],
```

整段删除。

- [ ] **Step 10: 删 useEffect 中两字段写入**

`useEffect` 持久化中（第 603-604 行附近）：

```ts
          activeStep1Surface: state.activeStep1Surface,
          completedStep1Surfaces: state.completedStep1Surfaces,
```

整段删除。

- [ ] **Step 11: typecheck**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx tsc --noEmit 2>&1 | head -30
```

预期：会有若干错误（`Step1SurfaceId` 不存在等）——这些会在 Phase A 的后续 task 里由 WizardSidebar / WorkspaceWizardPanel 修复。本次提交仅 wizard context 模块，先用 `// @ts-expect-error` 临时 marker 标注外部依赖？不会更糟吗？实际上不注释——直接 commit，因为下游 consumer 会在 Task 2-3 修。

- [ ] **Step 12: commit**

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/components/wizard/WizardContext.tsx
git commit -m "refactor(wizard): remove step1-surface abstraction from WizardContext"
```

---

### Task 2: WizardSidebar.tsx 简化为 8 项

**Files:**
- Modify: `frontend/src/components/wizard/WizardSidebar.tsx`

- [ ] **Step 1: 替换整个文件**

`WizardSidebar.tsx` 整文件替换为：

```tsx
export interface SidebarItem {
  id: string;
  label: string;
  icon: string;
  position: number;
}

const SIDEBAR_ITEMS: SidebarItem[] = [
  { id: "divergence", label: "创意发散", icon: "psychology",          position: 1 },
  { id: "concept",    label: "概念 DNA", icon: "biotech",             position: 2 },
  { id: "world",      label: "世界观",   icon: "public",               position: 3 },
  { id: "character",  label: "角色设计", icon: "groups",               position: 4 },
  { id: "map",        label: "地图系统", icon: "map",                  position: 5 },
  { id: "plot",       label: "剧情画布", icon: "account_tree",         position: 6 },
  { id: "outline",    label: "全文大纲", icon: "format_list_numbered", position: 7 },
  { id: "chapter",    label: "章节大纲", icon: "auto_stories",         position: 8 },
];

interface WizardSidebarProps {
  currentStep: number;
  completedSteps: number[];
  onJump: (item: SidebarItem) => void;
}

export default function WizardSidebar({
  currentStep,
  completedSteps,
  onJump,
}: WizardSidebarProps) {
  return (
    <nav data-testid="wizard-sidebar"
         className="bg-surface-container dark:bg-surface-container sticky top-16 self-start h-[calc(100vh-64px)] w-[200px] shrink-0 border-r border-outline-variant dark:border-outline-variant flex flex-col py-6 px-3 z-20">
      <div className="flex-1 flex flex-col items-center gap-2 overflow-y-auto pr-0 custom-scrollbar">
        {SIDEBAR_ITEMS.map((item) => {
          const completed = completedSteps.includes(item.position);
          const current = currentStep === item.position;
          // Step N is reachable when completed, current, or (N is the
          // next step and the previous step is completed).
          const reachable =
            completed ||
            current ||
            (item.position === currentStep + 1 && completedSteps.includes(currentStep));
          const baseCls = "flex items-center justify-start gap-2 px-3 py-2 rounded-lg transition-colors w-[160px]";
          const stateCls = current
            ? "bg-secondary-container text-on-secondary-container font-bold scale-[0.98] transition-transform duration-150"
            : "text-on-surface-variant hover:bg-surface-variant dark:hover:bg-surface-variant";
          return (
            <div key={item.id} className="flex flex-col items-center gap-2">
              <button
                type="button"
                data-testid={`wizard-sidebar-item-${item.id}`}
                data-state={completed ? "completed" : current ? "current" : "pending"}
                disabled={!reachable}
                onClick={() => reachable && onJump(item)}
                className={`${baseCls} ${stateCls} ${!reachable ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
              >
                <span
                  className="material-symbols-outlined text-[20px] leading-none"
                  style={{ fontVariationSettings: current ? '"FILL" 1' : '"FILL" 0' }}
                >
                  {item.icon}
                </span>
                <span className="font-body-md text-sm whitespace-nowrap">{item.label}</span>
                {completed && !current && (
                  <span aria-hidden="true" className="material-symbols-outlined text-[14px] leading-none text-primary ml-auto">
                    check
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: typecheck**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx tsc --noEmit 2>&1 | head -30
```

预期：仍可能有 WorkspaceWizardPanel 调用 `activeStep1Surface` 等 prop 的错误——会在 Task 3 修。

- [ ] **Step 3: commit**

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/components/wizard/WizardSidebar.tsx
git commit -m "refactor(wizard): simplify WizardSidebar to 8 plain steps"
```

---

### Task 3: WorkspaceWizardPanel.tsx render + prefill

**Files:**
- Modify: `frontend/src/components/wizard/WorkspaceWizardPanel.tsx`

- [ ] **Step 1: 删 Step1SurfaceId import**

文件第 3 行：

```ts
import { WizardProvider, useWizard, type WizardData, type Step1SurfaceId } from "./WizardContext";
```

替换为：

```ts
import { WizardProvider, useWizard, type WizardData } from "./WizardContext";
```

- [ ] **Step 2: 改 prefill effect — 删 completedStep1Surfaces 局部变量**

`Inner` 函数内 prefill useEffect（第 53 行附近）：

```ts
        const completed: number[] = [];
        const completedStep1Surfaces: Step1SurfaceId[] = [];
        const data: Partial<WizardData> = {};
```

替换为：

```ts
        const completed: number[] = [];
        const data: Partial<WizardData> = {};
```

- [ ] **Step 3: 改 divergence prefill 不动**

第 56-63 行 divergence 检测块保持原状：

```ts
        // Divergence surface completion: selected_at is the single
        // source of truth (both source="canvas" and source="creative_divergence"
        // dual-write at /commit). proj_f0721bdc 2026-08-31 regression.
        const cdPayload = cd.status === "fulfilled" ? cd.value : null;
        if (cdPayload && cdPayload.selected_at) {
          completed.push(1);
        }
```

注：`completedStep1Surfaces.push("divergence")` 这一行删除。注释里 "Divergence surface completion" 改为 "Divergence completion"。

- [ ] **Step 4: 改 canvas prefill — push 6 不再 push 1**

第 65-73 行附近：

```ts
        // Canvas surface completion: committed is the semantic signal;
        // committed_at !== null is a defensive backstop ensuring both
        // flags agree on read (the backend stamps both atomically today,
        // but defense-in-depth for disk-derived signals).
        const canvasPayload = canvasState.status === "fulfilled" ? canvasState.value : null;
        if (canvasPayload?.committed === true && canvasPayload.committed_at !== null) {
          if (!completed.includes(1)) completed.push(1);
          completedStep1Surfaces.push("canvas");
        }
```

替换为：

```ts
        // Plot canvas completion: committed is the semantic signal;
        // committed_at !== null is a defensive backstop ensuring both
        // flags agree on read (the backend stamps both atomically today,
        // but defense-in-depth for disk-derived signals). Marks step 6
        // (剧情画布) as completed; divergence and canvas are now
        // independent steps.
        const canvasPayload = canvasState.status === "fulfilled" ? canvasState.value : null;
        if (canvasPayload?.committed === true && canvasPayload.committed_at !== null) {
          completed.push(6);
        }
```

- [ ] **Step 5: 删 hydrateStep1Surfaces 调用**

文件末尾（第 95-99 行附近）：

```ts
        if (completedStep1Surfaces.length > 0) {
          wizard.hydrateStep1Surfaces(completedStep1Surfaces);
        }
```

替换为：

```ts
```

（即整段删除）

- [ ] **Step 6: 更新注释里 step 6/7 编号**

第 75 行注释 `// Existing prefill for steps 2..7` 改为 `// Existing prefill for steps 2..8`。

第 86 行 `completed.push(6); data.novel_outline = ...` 不变（因为 `outline` 在新模型下也是 step 6 — 等等让我重算）。

**等等**：新模型下 outline 是 step 7，chapter 是 step 8。原来 outline 是 6，chapter 是 7。所以 `completed.push(6)` 对应 outline（"全文大纲"），应改为 `completed.push(7)`；`completed.push(7)` 对应 chapter（"章节大纲"），应改为 `completed.push(8)`。

第 86 行：

```ts
        if (novel.status === "fulfilled" && hasContent(novel.value)) { completed.push(6); data.novel_outline = novel.value as NovelOutline; }
        if (outline.status === "fulfilled" && hasContent(outline.value)) { completed.push(7); data.chapter1_outline = outline.value as Outline; }
```

替换为：

```ts
        // Step mappings — must stay in sync with SIDEBAR_ITEMS in WizardSidebar:
        //   7 = novel_outline.json (全文大纲)
        //   8 = outline.json     (章节大纲 / chapter1_outline)
        if (novel.status === "fulfilled" && hasContent(novel.value)) { completed.push(7); data.novel_outline = novel.value as NovelOutline; }
        if (outline.status === "fulfilled" && hasContent(outline.value)) { completed.push(8); data.chapter1_outline = outline.value as Outline; }
```

- [ ] **Step 7: 改 WizardSidebar props**

第 110-122 行附近：

```tsx
      <WizardSidebar
        currentStep={wizard.currentStep}
        completedSteps={wizard.completedSteps}
        activeStep1Surface={wizard.activeStep1Surface}
        completedStep1Surfaces={wizard.completedStep1Surfaces}
        onJump={(item) => {
          if (item.kind === "step1-surface") {
            wizard.setActiveStep1Surface(item.surfaceId!);
          } else {
            wizard.jumpToStep(item.position);
          }
        }}
      />
```

替换为：

```tsx
      <WizardSidebar
        currentStep={wizard.currentStep}
        completedSteps={wizard.completedSteps}
        onJump={(item) => {
          wizard.jumpToStep(item.position);
        }}
      />
```

- [ ] **Step 8: 改渲染分支 — 拆分 currentStep===1 三元，移 PlotCanvasMountPoint 到 step 6**

第 127-142 行附近：

```tsx
            {wizard.currentStep === 1 && (
              wizard.activeStep1Surface === "canvas"
                ? <CreativeCanvasMountPoint projectId={projectId} />
                : <CreativeDivergenceStep
                    projectId={projectId}
                    onCommitSuccess={() => wizard.markStep1SurfaceCompleted("divergence")}
                  />
            )}
            {wizard.currentStep === 2 && <ConceptStep projectId={projectId} />}
            {wizard.currentStep === 3 && <WorldStep projectId={projectId} />}
            {wizard.currentStep === 4 && <CharacterStep projectId={projectId} />}
            {wizard.currentStep === 5 && <MapStep />}
            {wizard.currentStep === 6 && <OutlineStep projectId={projectId} />}
            {wizard.currentStep === 7 && (
              <ChapterOutlineStep projectId={projectId} onFinish={() => { /* WorkspacePage handles tab switch */ }} />
            )}
```

替换为：

```tsx
            {wizard.currentStep === 1 && (
              <CreativeDivergenceStep
                projectId={projectId}
                onCommitSuccess={() => wizard.markStepGenerated(1, {})}
              />
            )}
            {wizard.currentStep === 2 && <ConceptStep projectId={projectId} />}
            {wizard.currentStep === 3 && <WorldStep projectId={projectId} />}
            {wizard.currentStep === 4 && <CharacterStep projectId={projectId} />}
            {wizard.currentStep === 5 && <MapStep />}
            {wizard.currentStep === 6 && <PlotCanvasMountPoint projectId={projectId} />}
            {wizard.currentStep === 7 && <OutlineStep projectId={projectId} />}
            {wizard.currentStep === 8 && (
              <ChapterOutlineStep projectId={projectId} onFinish={() => { /* WorkspacePage handles tab switch */ }} />
            )}
```

注：
- divergence commit 用 `markStepGenerated(1, {})`（MARK_STEP_GENERATED：加 1 到 completedSteps，不推进 currentStep）
- 不要用 `saveStep(1, {})`（那会推进 currentStep 到 2，破坏 divergence commit 后的当前页停留）

- [ ] **Step 9: typecheck**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx tsc --noEmit 2>&1 | head -30
```

预期：编译通过（PlotCanvasMountPoint 还在原路径 creative-canvas/，渲染时 TS 会因 import 路径找不到而报错——但 Task 4-5 会 rename 文件，先用相对路径占位不引入 PlotCanvasMountPoint 实际 import —— 不行，运行时崩溃）。

实际上 Task 8 步骤必须先 rename 才能运行。**本 Task 3 完成后应该 commit，但运行测试需等 Phase B 完成。**

- [ ] **Step 10: commit**

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/components/wizard/WorkspaceWizardPanel.tsx
git commit -m "refactor(wizard): route step 6 to PlotCanvasMountPoint, decouple surfaces"
```

---

## Phase B: 文件 / 目录重命名

### Task 4: rename `creative-canvas/` 目录 + 内部组件文件名

**Files:**
- Rename: `frontend/src/components/creative-canvas/CreativeCanvasMountPoint.tsx` → `frontend/src/components/plot-canvas/PlotCanvasMountPoint.tsx`
- Rename: `frontend/src/components/creative-canvas/CreativeCanvasMountPoint.test.tsx` → `frontend/src/components/plot-canvas/PlotCanvasMountPoint.test.tsx`

- [ ] **Step 1: rename 目录与两个文件**

```bash
cd /Users/longsa/Codes/nebula
git mv frontend/src/components/creative-canvas frontend/src/components/plot-canvas
git mv frontend/src/components/plot-canvas/CreativeCanvasMountPoint.tsx frontend/src/components/plot-canvas/PlotCanvasMountPoint.tsx
git mv frontend/src/components/plot-canvas/CreativeCanvasMountPoint.test.tsx frontend/src/components/plot-canvas/PlotCanvasMountPoint.test.tsx
git status
```

预期：`frontend/src/components/plot-canvas/` 目录存在，且两个新文件名。

- [ ] **Step 2: 更新 PlotCanvasMountPoint.tsx 内部导出名**

`frontend/src/components/plot-canvas/PlotCanvasMountPoint.tsx` 中找到 `export default function CreativeCanvasMountPoint`（预计是 line 30 附近），改为：

```ts
export default function PlotCanvasMountPoint
```

- [ ] **Step 3: 更新 test 文件中的 import 与测试描述**

`frontend/src/components/plot-canvas/PlotCanvasMountPoint.test.tsx` 中：
- `import CreativeCanvasMountPoint from ...` → `import PlotCanvasMountPoint from ...`
- `describe("CreativeCanvasMountPoint", ...)` → `describe("PlotCanvasMountPoint", ...)`
- `<CreativeCanvasMountPoint ...>` → `<PlotCanvasMountPoint ...>`

用 sed 全文件替换：

```bash
cd /Users/longsa/Codes/nebula
sed -i '' 's/CreativeCanvasMountPoint/PlotCanvasMountPoint/g' frontend/src/components/plot-canvas/PlotCanvasMountPoint.test.tsx
grep -n "CreativeCanvasMountPoint\|PlotCanvasMountPoint" frontend/src/components/plot-canvas/PlotCanvasMountPoint.test.tsx | head -10
```

预期：所有匹配都变成 `PlotCanvasMountPoint`。

- [ ] **Step 4: 更新 WorkspaceWizardPanel.tsx 的 import 路径与组件名**

```bash
cd /Users/longsa/Codes/nebula
sed -i '' 's|"\.\./creative-canvas/CreativeCanvasMountPoint"|"../plot-canvas/PlotCanvasMountPoint"|g' frontend/src/components/wizard/WorkspaceWizardPanel.tsx
sed -i '' 's/<CreativeCanvasMountPoint/<PlotCanvasMountPoint/g' frontend/src/components/wizard/WorkspaceWizardPanel.tsx
grep -n "CreativeCanvasMountPoint\|PlotCanvasMountPoint" frontend/src/components/wizard/WorkspaceWizardPanel.tsx | head -5
```

预期：`import PlotCanvasMountPoint from "../plot-canvas/PlotCanvasMountPoint"`；`<PlotCanvasMountPoint ... />`。

- [ ] **Step 5: 搜索其它引用并修复**

```bash
cd /Users/longsa/Codes/nebula
grep -rn "CreativeCanvasMountPoint\|creative-canvas/CreativeCanvasMountPoint" frontend/ --include="*.ts" --include="*.tsx" | head -20
```

预期：仅剩 `PlotCanvasMountPoint` 命中。如果还有 `CreativeCanvasMountPoint` 残留，逐个修。

- [ ] **Step 6: typecheck**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx tsc --noEmit 2>&1 | head -30
```

预期：无错误（剩余错误是 CreativeCanvasPage 等未 rename，会在 Task 5 修）。

- [ ] **Step 7: 跑 mount-point 测试**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- --run src/components/plot-canvas/PlotCanvasMountPoint.test.tsx 2>&1 | tail -30
```

预期：PASS（视具体 mock 情况）。

- [ ] **Step 8: commit**

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/components/creative-canvas frontend/src/components/plot-canvas frontend/src/components/wizard/WorkspaceWizardPanel.tsx
git commit -m "refactor(canvas): rename creative-canvas/ → plot-canvas/, mount-point renamed"
```

---

### Task 5: rename CanvasPage 文件

**Files:**
- Rename: `frontend/src/pages/CreativeCanvasPage.tsx` → `frontend/src/pages/PlotCanvasPage.tsx`
- Rename: `frontend/src/test/pages/CreativeCanvasPage.test.tsx` → `frontend/src/test/pages/PlotCanvasPage.test.tsx`

- [ ] **Step 1: rename 文件**

```bash
cd /Users/longsa/Codes/nebula
git mv frontend/src/pages/CreativeCanvasPage.tsx frontend/src/pages/PlotCanvasPage.tsx
git mv frontend/src/test/pages/CreativeCanvasPage.test.tsx frontend/src/test/pages/PlotCanvasPage.test.tsx
```

- [ ] **Step 2: 更新文件内部导出名**

```bash
cd /Users/longsa/Codes/nebula
sed -i '' 's/CreativeCanvasPage/PlotCanvasPage/g' frontend/src/pages/PlotCanvasPage.tsx frontend/src/test/pages/PlotCanvasPage.test.tsx
grep -n "CreativeCanvasPage\|PlotCanvasPage" frontend/src/pages/PlotCanvasPage.tsx frontend/src/test/pages/PlotCanvasPage.test.tsx | head -10
```

预期：所有匹配都变成 `PlotCanvasPage`。

- [ ] **Step 3: 搜索并修其它引用**

```bash
cd /Users/longsa/Codes/nebula
grep -rn "CreativeCanvasPage\|pages/CreativeCanvasPage" frontend/ --include="*.ts" --include="*.tsx" | head -20
```

预期：仅剩 `PlotCanvasPage` 命中。如果有残留，逐个改（一般 App.tsx 与 test/pages.test.tsx 引用此页面）。

- [ ] **Step 4: typecheck**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: 跑 page 测试**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- --run src/test/pages/PlotCanvasPage.test.tsx 2>&1 | tail -30
```

预期：可能仍 FAIL（路由 path 还是 stage1/canvas），需 Task 7-8 修了才能 PASS。

- [ ] **Step 6: commit**

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/pages/PlotCanvasPage.tsx frontend/src/test/pages/PlotCanvasPage.test.tsx
git commit -m "refactor(canvas): rename CreativeCanvasPage → PlotCanvasPage"
```

---

### Task 6: rename hook + test 文件

**Files:**
- Rename: `frontend/src/hooks/useCreativeCanvasV2.ts` → `frontend/src/hooks/usePlotCanvasV2.ts`
- Rename: `frontend/src/hooks/useCreativeCanvasV2.test.ts` → `frontend/src/hooks/usePlotCanvasV2.test.ts`

- [ ] **Step 1: rename 文件**

```bash
cd /Users/longsa/Codes/nebula
git mv frontend/src/hooks/useCreativeCanvasV2.ts frontend/src/hooks/usePlotCanvasV2.ts
git mv frontend/src/hooks/useCreativeCanvasV2.test.ts frontend/src/hooks/usePlotCanvasV2.test.ts
```

- [ ] **Step 2: 改 hook 内部导出**

```bash
cd /Users/longsa/Codes/nebula
sed -i '' 's/useCreativeCanvasV2/usePlotCanvasV2/g' frontend/src/hooks/usePlotCanvasV2.ts frontend/src/hooks/usePlotCanvasV2.test.ts
```

- [ ] **Step 3: 搜索并修其它引用**

```bash
cd /Users/longsa/Codes/nebula
grep -rn "useCreativeCanvasV2" frontend/ --include="*.ts" --include="*.tsx" | head -20
```

预期：仅剩 `usePlotCanvasV2`。改残留：

```bash
sed -i '' 's/useCreativeCanvasV2/usePlotCanvasV2/g' $(grep -rl "useCreativeCanvasV2" frontend/ --include="*.ts" --include="*.tsx")
```

- [ ] **Step 4: typecheck + 跑 hook 测试**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx tsc --noEmit 2>&1 | head -30 && npm test -- --run src/hooks/usePlotCanvasV2.test.ts 2>&1 | tail -20
```

- [ ] **Step 5: commit**

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/hooks/ frontend/src/
git commit -m "refactor(canvas): rename useCreativeCanvasV2 → usePlotCanvasV2"
```

---

### Task 7: rename test/components/creative-canvas/

**Files:**
- Rename: `frontend/src/test/components/creative-canvas/` → `frontend/src/test/components/plot-canvas/`

- [ ] **Step 1: rename 目录**

```bash
cd /Users/longsa/Codes/nebula
git mv frontend/src/test/components/creative-canvas frontend/src/test/components/plot-canvas
git status
```

- [ ] **Step 2: 更新文件内部 import 路径**

```bash
cd /Users/longsa/Codes/nebula
grep -rn "test/components/creative-canvas\|creative-canvas/" frontend/src/test/ --include="*.ts" --include="*.tsx" | head -20
```

预期：会有几处 import 引用了 creative-canvas 组件或路径。逐个改：

```bash
# 注意：以下 pattern 要小心 — 改 test 引用，但 plot-canvas/ 是另一个不同的目录（src/components/plot-canvas/）
# test/components/plot-canvas/* 是测试目录
# src/components/plot-canvas/* 是源码目录 — 测试通常会从源码目录 import
# 改的是 src/components/creative-canvas/ → src/components/plot-canvas/

grep -rln "components/creative-canvas" frontend/src/test/ | xargs sed -i '' 's|components/creative-canvas|components/plot-canvas|g'
grep -rln "creative-canvas/" frontend/src/test/ | xargs sed -i '' 's|creative-canvas/|plot-canvas/|g'
```

- [ ] **Step 3: 跑这些测试**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- --run src/test/components/plot-canvas/ 2>&1 | tail -40
```

预期：PASS 或 FAIL with import errors（取决于具体 mock 内容）。

- [ ] **Step 4: commit**

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/test/
git commit -m "refactor(canvas): rename test/components/creative-canvas/ → plot-canvas/"
```

---

## Phase C: 路由 + 标识符更新

### Task 8: 更新 App.tsx 路由 path

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: 找到 canvas 路由定义**

```bash
cd /Users/longsa/Codes/nebula
grep -n "stage1/canvas\|CreativeCanvasPage\|PlotCanvasPage" frontend/src/App.tsx | head -10
```

预期：找到类似：

```tsx
<Route path="/project/:projectId/stage1/canvas" element={<CreativeCanvasPage />} />
```

- [ ] **Step 2: 改 path 与组件名**

如有：

```tsx
<Route path="/project/:projectId/stage1/canvas" element={<CreativeCanvasPage />} />
```

改为：

```tsx
<Route path="/project/:projectId/stage6/plot" element={<PlotCanvasPage />} />
```

并更新文件顶部的 import：

```ts
import PlotCanvasPage from "./pages/PlotCanvasPage";
```

- [ ] **Step 3: typecheck**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: commit**

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/App.tsx
git commit -m "refactor(canvas): route /stage1/canvas → /stage6/plot"
```

---

### Task 9: 检查 Stage1Layout / MainLayout 等是否引用旧 path

**Files:**
- Check & modify: `frontend/src/components/layout/Stage1Layout.tsx`, `frontend/src/components/layout/MainLayout.tsx`

- [ ] **Step 1: 搜索引用**

```bash
cd /Users/longsa/Codes/nebula
grep -rn "stage1/canvas\|stage1\\\\/canvas\|stage6/plot" frontend/src/components/layout/ 2>/dev/null | head -20
```

- [ ] **Step 2: 如有命中，逐个改**

把 `stage1/canvas` → `stage6/plot`。如果是字符串字面量或导航函数调用：

```bash
grep -rln "stage1/canvas" frontend/src/components/layout/ | xargs sed -i '' 's|stage1/canvas|stage6/plot|g'
```

- [ ] **Step 3: 再次搜索确认**

```bash
cd /Users/longsa/Codes/nebula
grep -rn "stage1/canvas" frontend/ --include="*.ts" --include="*.tsx" | head -10
```

预期：仅剩文档 / 注释中说明"原 path"。

- [ ] **Step 4: commit（如有改动）**

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/components/layout/
git diff --cached --quiet || git commit -m "refactor(canvas): update stage1/canvas → stage6/plot in layout"
```

（如无改动则跳过本步）

---

## Phase D: 中文 + 内部标识符更新

### Task 10: 中文文案 `创意画布` → `剧情画布`

**Files:**
- Modify: 所有 `frontend/src/components/plot-canvas/*.tsx` 与 `frontend/src/pages/PlotCanvasPage.tsx`

- [ ] **Step 1: 搜索 "创意画布" 残留**

```bash
cd /Users/longsa/Codes/nebula
grep -rn "创意画布" frontend/src/ --include="*.tsx" --include="*.ts" | head -30
```

预期：列出所有用户可见中文。

- [ ] **Step 2: 替换**

```bash
cd /Users/longsa/Codes/nebula
grep -rln "创意画布" frontend/src/components/plot-canvas/ frontend/src/pages/PlotCanvasPage.tsx 2>/dev/null | xargs sed -i '' 's/创意画布/剧情画布/g'
grep -rn "创意画布" frontend/src/ --include="*.tsx" --include="*.ts" | head -10
```

预期：仅剩注释里"原 X"或文档说明。

- [ ] **Step 3: typecheck**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: 跑 plot-canvas 全测试**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- --run src/components/plot-canvas/ src/pages/PlotCanvasPage.tsx src/test/pages/PlotCanvasPage.test.tsx 2>&1 | tail -40
```

预期：PASS（或者极少数 mock-related 失败，留给后续 Task 11+）。

- [ ] **Step 5: commit**

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/components/plot-canvas/ frontend/src/pages/PlotCanvasPage.tsx
git commit -m "refactor(canvas): rename 创意画布 → 剧情画布 in user-facing strings"
```

---

### Task 11: 内部 data-testid 前缀 `creative-canvas-*` → `plot-canvas-*`

**Files:**
- Modify: `frontend/src/components/plot-canvas/*.tsx` (尤其是 CanvasPreStepHint, TreeCanvas, IdeaRootNode, OptionCard, EmptyState 等)

- [ ] **Step 1: 搜索**

```bash
cd /Users/longsa/Codes/nebula
grep -rn '"creative-canvas\|"canvas-\|"canvas-' frontend/src/components/plot-canvas/ frontend/src/pages/PlotCanvasPage.tsx --include="*.tsx" | head -30
```

预期：列出所有 `data-testid="creative-canvas-..."` 等。

- [ ] **Step 2: 替换**

注意：替换时要避免误伤 PlotCanvas 自身的 prop / state 名（这些不该改）。只改 data-testid 字符串值。

逐文件查看 grep 结果，对每个 `data-testid="creative-canvas-xxx"` 改为 `data-testid="plot-canvas-xxx"`。推荐对每个文件单独 sed：

```bash
# 例：替换 plot-canvas 内 IdeaRootNode.tsx 中所有 testid
sed -i '' 's|data-testid="creative-canvas-|data-testid="plot-canvas-|g' frontend/src/components/plot-canvas/IdeaRootNode.tsx
```

或者：

```bash
# 批量（小心误伤）
grep -rln 'data-testid="creative-canvas-' frontend/src/components/plot-canvas/ | xargs sed -i '' 's|data-testid="creative-canvas-|data-testid="plot-canvas-|g'
```

- [ ] **Step 3: 搜索确认**

```bash
cd /Users/longsa/Codes/nebula
grep -rn 'data-testid="creative-canvas' frontend/src/ --include="*.tsx" --include="*.ts" | head -10
```

预期：无命中。

- [ ] **Step 4: 跑测试，验证 testid 改名后测试断言匹配**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- --run src/components/plot-canvas/ 2>&1 | tail -40
```

预期：PASS（如果测试断言也用 plot-canvas- 前缀）；如 FAIL，错误信息会指出哪个 testid 找不到。

- [ ] **Step 5: commit**

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/components/plot-canvas/ frontend/src/pages/PlotCanvasPage.tsx
git commit -m "refactor(canvas): rename data-testid creative-canvas-* → plot-canvas-*"
```

---

## Phase E: 测试更新

### Task 12: 更新 WizardSidebar.test.tsx

**Files:**
- Modify: `frontend/src/components/wizard/WizardSidebar.test.tsx`

- [ ] **Step 1: 跑当前测试看 baseline**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- --run src/components/wizard/WizardSidebar.test.tsx 2>&1 | tail -40
```

预期：FAIL（断言包含 "创意画布" 与 kind: "step1-surface" 等）。

- [ ] **Step 2: 改断言**

主要改动：
- 期望的 SIDEBAR_ITEMS 长度：7 → 8（已实际）
- 删除所有 `kind: "step1-surface"` 断言
- 删除所有 `surfaceId` 断言
- 删除 `completedStep1Surfaces` 相关 props
- label 中 "创意画布" → "剧情画布"
- testid 中 `wizard-sidebar-item-canvas` → `wizard-sidebar-item-plot`
- sidebar item id 中 `canvas` → `plot`
- position 6 的项：原 canvas → 现 plot；position 6（原 outline）→ 7；position 7（原 chapter）→ 8

打开文件 review，按需修改断言。例如：

```tsx
// 原
const items = screen.getAllByTestId(/wizard-sidebar-item-/);
expect(items.find(i => i.getAttribute("data-testid") === "wizard-sidebar-item-canvas")).toHaveTextContent("创意画布");

// 新
const items = screen.getAllByTestId(/wizard-sidebar-item-/);
expect(items.find(i => i.getAttribute("data-testid") === "wizard-sidebar-item-plot")).toHaveTextContent("剧情画布");
```

- [ ] **Step 3: 跑测试**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- --run src/components/wizard/WizardSidebar.test.tsx 2>&1 | tail -20
```

预期：PASS。

- [ ] **Step 4: commit**

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/components/wizard/WizardSidebar.test.tsx
git commit -m "test(wizard): update WizardSidebar test for 8 items + plot step"
```

---

### Task 13: 更新 WizardContext.test.tsx

**Files:**
- Modify: `frontend/src/test/WizardContext.test.tsx`

- [ ] **Step 1: 跑当前测试**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- --run src/test/WizardContext.test.tsx 2>&1 | tail -50
```

预期：FAIL（surface 相关测试编译错误）。

- [ ] **Step 2: 删以下测试用例**

删除：
- `setActiveStep1Surface updates activeStep1Surface and sets currentStep=1`
- `markStep1SurfaceCompleted adds surface and pushes 1 into completedSteps`
- `markStep1SurfaceCompleted is idempotent per surface`
- `hydrateStep1Surfaces merges with existing via Set dedup`
- `persists activeStep1Surface and completedStep1Surfaces to sessionStorage`
- `restores activeStep1Surface and completedStep1Surfaces from sessionStorage`
- `isStep1EffectivelyCompleted returns true when any surface done`

并：
- 移除 `isStep1EffectivelyCompleted` 的 import
- 移除 `Step1SurfaceId` 的 import

- [ ] **Step 3: 跑测试**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- --run src/test/WizardContext.test.tsx 2>&1 | tail -20
```

预期：PASS。

- [ ] **Step 4: commit**

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/test/WizardContext.test.tsx
git commit -m "test(wizard): drop step1-surface tests from WizardContext"
```

---

### Task 14: 更新 WorkspaceWizardPanel.test.tsx

**Files:**
- Modify: `frontend/src/components/wizard/WorkspaceWizardPanel.test.tsx`

- [ ] **Step 1: 跑当前测试**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- --run src/components/wizard/WorkspaceWizardPanel.test.tsx 2>&1 | tail -40
```

预期：FAIL。

- [ ] **Step 2: 改测试断言**

主要改动：
- 删除 `markStep1SurfaceCompleted` mock / 引用
- canvas commit 后的 completedSteps 断言：`expect(completed).toContain(1)` → `expect(completed).toContain(6)`
- divergence commit 后的 completedSteps 断言：仍 `toContain(1)`（不变）
- 删除 `hydrateStep1Surfaces` mock 调用

- [ ] **Step 3: 跑测试**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- --run src/components/wizard/WorkspaceWizardPanel.test.tsx 2>&1 | tail -20
```

预期：PASS。

- [ ] **Step 4: commit**

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/components/wizard/WorkspaceWizardPanel.test.tsx
git commit -m "test(wizard): update WorkspaceWizardPanel test for new step 6 signal"
```

---

### Task 15: 更新 test/pages.test.tsx

**Files:**
- Modify: `frontend/src/test/pages.test.tsx`

- [ ] **Step 1: 搜索引用**

```bash
cd /Users/longsa/Codes/nebula
grep -n "CreativeCanvasPage\|stage1/canvas\|stage6/plot" frontend/src/test/pages.test.tsx | head -10
```

- [ ] **Step 2: 替换**

```bash
cd /Users/longsa/Codes/nebula
sed -i '' 's|CreativeCanvasPage|PlotCanvasPage|g' frontend/src/test/pages.test.tsx
sed -i '' 's|stage1/canvas|stage6/plot|g' frontend/src/test/pages.test.tsx
```

- [ ] **Step 3: 跑测试**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- --run src/test/pages.test.tsx 2>&1 | tail -20
```

预期：PASS。

- [ ] **Step 4: commit**

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/test/pages.test.tsx
git commit -m "test(pages): update route + import refs for plot-canvas rename"
```

---

## Phase F: 后端注释更新

### Task 16: 更新 test_canvas_wizard_integration.py 注释

**Files:**
- Modify: `tests/test_canvas_wizard_integration.py`

- [ ] **Step 1: 找注释里提到 surface / step 1 编号的地方**

```bash
cd /Users/longsa/Codes/nebula
grep -n "completedStep1Surfaces\|step 1\|step 6\|canvas surface" tests/test_canvas_wizard_integration.py | head -20
```

- [ ] **Step 2: 改注释（不改断言）**

第 156-165 行附近的 docstring：

```python
"""End-to-end: init -> 5x(next-step+select) -> commit.

Asserts creative_divergence.json exists with selected_at set
(the wizard's prefill signal — completedSteps.includes(1) and
completedStep1Surfaces contains both "canvas" and "divergence"
via different code paths).
"""
```

改为：

```python
"""End-to-end: init -> 5x(next-step+select) -> commit.

Asserts creative_divergence.json exists with selected_at set
(the wizard's prefill signal — WorkspaceWizardPanel reads
selected_at to push 1 into completedSteps for step 1
(divergence). After the 2026-09-04 canvas rename + step
reorder, the canvas-side signal lives on canvas_state.json's
committed + committed_at, which pushes 6 into completedSteps.
Both signals are independent).
"""
```

第 187-188 行附近注释保持不变（断言的是后端文件，与 wizard 步骤编号无关）。

- [ ] **Step 3: 跑后端测试确认**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest tests/test_canvas_wizard_integration.py -v 2>&1 | tail -30
```

预期：PASS（断言不变）。

- [ ] **Step 4: commit**

```bash
cd /Users/longsa/Codes/nebula && git add tests/test_canvas_wizard_integration.py
git commit -m "test(canvas): update docstring for step-6 signal split"
```

---

### Task 17: 更新 test_v2_canvas_endpoints.py 注释

**Files:**
- Modify: `tests/test_v2_canvas_endpoints.py`

- [ ] **Step 1: 搜索注释**

```bash
cd /Users/longsa/Codes/nebula
grep -n "completedStep1Surfaces\|step 1\|step 6\|wizard step" tests/test_v2_canvas_endpoints.py | head -20
```

- [ ] **Step 2: 改注释（不改断言）**

按需更新 docstring 提到的 wizard 步骤编号。

- [ ] **Step 3: 跑测试**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest tests/test_v2_canvas_endpoints.py -v 2>&1 | tail -20
```

- [ ] **Step 4: commit**

```bash
cd /Users/longsa/Codes/nebula && git add tests/test_v2_canvas_endpoints.py
git commit -m "test(canvas): update v2 endpoints test docstring for step-6 signal"
```

---

## Phase G: 文档更新

### Task 18: 更新 creative-canvas-reconstruction.md

**Files:**
- Modify: `docs/design/creative-canvas-reconstruction.md`

- [ ] **Step 1: 改文档标题**

```bash
cd /Users/longsa/Codes/nebula
sed -i '' 's|# Creative Canvas 创意画布模块重构 PRD|# Plot Canvas 剧情画布模块重构 PRD|g' docs/design/creative-canvas-reconstruction.md
sed -i '' 's|**模块**：Creative Canvas / 创意画布|**模块**：Plot Canvas / 剧情画布|g' docs/design/creative-canvas-reconstruction.md
```

- [ ] **Step 2: 改 §11.1 路由段**

第 354-358 行附近：

```markdown
### 11.1 路由

`/project/:projectId/stage0/canvas`（与 Stage 0 其他 tab 同级）。
```

改为：

```markdown
### 11.1 路由

`/project/:projectId/stage6/plot`（与 Stage 6 其他 step 同级）。

> 历史：v1.x 时 canvas 在 Stage 0；v1.8.1 提升到 Stage 1（作为 Step 1 surface 与 divergence 平行）；2026-09-04 改造把 canvas 移到 Step 6 (地图系统之后、全文大纲之前)，更名为剧情画布。
```

- [ ] **Step 3: 改 §26.1 ADR 中 v2 namespace 段落（保持后端 API path）**

不改。验证：

```bash
grep -n "v1.8.1 改造把 canvas 从 Stage 0 提升到 Stage 1" docs/design/creative-canvas-reconstruction.md
```

- [ ] **Step 4: 改 §31 信息架构图**

第 1267-1276 行附近：

```text
   ConceptStep (wizard Step 2)
   ↓
   Stage 2 World
   ↓
   Stage 3 Character
   ↓
   Stage 3 Map
   ↓
   Stage 3 Outline
```

改为：

```text
   ConceptStep (wizard Step 2)
   ↓
   Stage 2 World
   ↓
   Stage 3 Character
   ↓
   Stage 3 Map
   ↓
   剧情画布 (Step 6)
   ↓
   Stage 3 Outline
```

- [ ] **Step 5: 改 §35 commit 后跳转**

第 1326-1338 行附近：

```text
canvas commit 成功
       ↓
写入 concept_and_dna.json + creative_divergence.json
       ↓
navigate(/project/:id/stage0)  // 落在 Stage 0 Tab
       ↓
用户点 Concept Tab
       ↓
GET /stage1/concept → ConceptStep.tsx 渲染
```

改为：

```text
canvas commit 成功
       ↓
写入 concept_and_dna.json + creative_divergence.json
       ↓
navigate(/project/:id/stage6/plot)  // 落在 Step 6 Tab（占位：canvas 仍写 concept_and_dna.json，但 wizard 位置已移到 step 6）
       ↓
用户点 Concept Tab
       ↓
GET /stage1/concept → ConceptStep.tsx 渲染
```

- [ ] **Step 6: 全局替换中文 "创意画布" → "剧情画布"（文档）**

```bash
cd /Users/longsa/Codes/nebula
sed -i '' 's/创意画布/剧情画布/g' docs/design/creative-canvas-reconstruction.md
grep -n "创意画布" docs/design/creative-canvas-reconstruction.md | head -10
```

预期：仅剩注释里"原 X"或显式标注。

- [ ] **Step 7: commit**

```bash
cd /Users/longsa/Codes/nebula && git add docs/design/creative-canvas-reconstruction.md
git commit -m "docs(canvas): update reconstruction PRD for plot rename + step 6"
```

---

### Task 19: 更新其他文档（ARCHITECTURE / creative-canvas-module）

**Files:**
- Modify: `docs/ARCHITECTURE.md`, `docs/design/creative-canvas-module.md`

- [ ] **Step 1: 搜索**

```bash
cd /Users/longsa/Codes/nebula
grep -rn "创意画布" docs/ 2>/dev/null | head -20
grep -rn "stage1/canvas" docs/ 2>/dev/null | head -10
```

- [ ] **Step 2: 替换**

```bash
cd /Users/longsa/Codes/nebula
grep -rln "创意画布" docs/ | xargs sed -i '' 's/创意画布/剧情画布/g'
grep -rln "stage1/canvas" docs/ | xargs sed -i '' 's/stage1\/canvas/stage6\/plot/g'
```

- [ ] **Step 3: commit**

```bash
cd /Users/longsa/Codes/nebula && git add docs/
git commit -m "docs: rename 创意画布 → 剧情画布 + update stage path in docs"
```

---

## Phase H: 最终验收

### Task 20: 全量验证

**Files:**
- 无文件改动

- [ ] **Step 1: 前端 typecheck**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx tsc --noEmit 2>&1 | tail -20
```

预期：无错误。

- [ ] **Step 2: 前端全测试**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test -- --run 2>&1 | tail -50
```

预期：全 PASS。如有失败，逐个 fix（不应有逻辑错误，主要是遗漏 import / 字符串）。

- [ ] **Step 3: 后端 canvas 相关测试**

```bash
cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest tests/test_canvas_wizard_integration.py tests/test_v2_canvas_endpoints.py -v 2>&1 | tail -30
```

预期：全 PASS。

- [ ] **Step 4: 验收清单**

按 spec §11 验收标准勾选：

- [ ] `WizardSidebar` 显示 8 项，divergence 在 position 1，剧情画布在 position 6
- [ ] `WizardContext` 不再含 `Step1SurfaceId` / `activeStep1Surface` / `completedStep1Surfaces` 类型与字段
- [ ] `WorkspaceWizardPanel` 渲染分支：`currentStep===1` 仅渲染 `CreativeDivergenceStep`；`currentStep===6` 渲染 `PlotCanvasMountPoint`
- [ ] 前端代码搜索 `CreativeCanvasMountPoint` / `CreativeCanvasPage` / `useCreativeCanvasV2` / `creative-canvas/` / `stage1/canvas` / `创意画布` 全部无残留
- [ ] 后端代码搜索 `v2_canvas` / `/api/creative/canvas/` / `canvas_state.json` 全部保持原状
- [ ] `frontend/src/components/creative-canvas/` 目录已删除

```bash
cd /Users/longsa/Codes/nebula
echo "--- 前端残留检查 ---"
echo "CreativeCanvasMountPoint:"
grep -rn "CreativeCanvasMountPoint" frontend/ --include="*.ts" --include="*.tsx" 2>/dev/null | head -5 || echo "  (clean)"
echo "CreativeCanvasPage:"
grep -rn "CreativeCanvasPage" frontend/ --include="*.ts" --include="*.tsx" 2>/dev/null | head -5 || echo "  (clean)"
echo "useCreativeCanvasV2:"
grep -rn "useCreativeCanvasV2" frontend/ --include="*.ts" --include="*.tsx" 2>/dev/null | head -5 || echo "  (clean)"
echo "creative-canvas/:"
ls frontend/src/components/creative-canvas/ 2>/dev/null || echo "  (directory removed)"
echo "stage1/canvas:"
grep -rn "stage1/canvas" frontend/ --include="*.ts" --include="*.tsx" 2>/dev/null | head -5 || echo "  (clean)"
echo "创意画布:"
grep -rn "创意画布" frontend/ --include="*.ts" --include="*.tsx" 2>/dev/null | head -5 || echo "  (clean)"
echo ""
echo "--- 后端保持不变检查 ---"
echo "v2_canvas.py:"
ls backend/api/v2_canvas.py 2>/dev/null && echo "  OK"
echo "/api/creative/canvas/ route:"
grep -rn "/api/creative/canvas/" backend/api/v2_canvas.py 2>/dev/null | head -3
```

- [ ] **Step 5: manual E2E（手动验证）**

```bash
# 起后端
cd /Users/longsa/Codes/nebula && source venv/bin/activate && uvicorn backend.main:app --reload --port 8000 &
# 起前端
cd /Users/longsa/Codes/nebula/frontend && npm run dev &
```

打开 http://localhost:5173，创建项目 → 走 wizard：
1. Step 1 (创意发散) → 完成
2. Step 2 (概念 DNA) → 完成
3. Step 3 (世界观) → 完成
4. Step 4 (角色设计) → 完成
5. Step 5 (地图系统) → 完成
6. Step 6 (剧情画布) → 完成
7. Step 7 (全文大纲) → 完成
8. Step 8 (章节大纲) → 完成

验证 sidebar 中位置 6 显示"剧情画布"，位置 1 显示"创意发散"。

访问 `/project/{id}/stage6/plot` → 渲染剧情画布页。访问 `/project/{id}/stage1/canvas` → 404。

- [ ] **Step 6: 最终 commit（如有遗漏修正）**

```bash
cd /Users/longsa/Codes/nebula && git status
# 如有未提交的 fix：
git add -A && git commit -m "chore(canvas): post-validation cleanup"
```

---

## 验收总结

任务数：20
预计 commit 数：~17（Phase A 拆 3 commit，Phase B 拆 4 commit，Phase C 拆 1-2，Phase D 拆 2，Phase E 拆 4，Phase F 拆 2，Phase G 拆 2，最终验证可能 0-1 commit）

每个任务完成后：
1. 跑对应测试
2. 提交（提交信息按各 task 给出的样板）
3. 进下一个 task

中途若发现 spec 漏掉的情况，回 spec 修订，再继续 plan。
