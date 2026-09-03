# 创意画布 与 工作台-项目设定 有机融合 Spec

> 上游 PRD:[`/docs/design/creative-canvas-reconstruction.md`](../design/creative-canvas-reconstruction.md)
> 范围:把 `/project/:id/stage1/canvas`(v4 创意画布)融合进 `/project/:id/workspace?tab=settings` 的向导侧边栏,作为 step 1 的并行 surface;画布在主区域就地渲染,而非跳转独立路由。
> 不在范围:关闭 创意发散(用户后续可能做,但本次不做 — 设计留出挂载点);画布内部的 v4 流程改动(已经在 `2026-09-02-creative-canvas-v2-design.md` 落地);后端 v3/v4 双 schema 合并(本 spec 不动后端)。

---

## 1. 背景与目标

### 1.1 当前 gap

`/project/:id/workspace?tab=settings` 的设置向导有 7 个 step,step 1「创意发散」(`CreativeDivergenceStep.tsx`)是用户从 prompt 出发生成概念的入口。

`/project/:id/stage1/canvas` 路由是 v4 创意画布(`CreativeCanvasPage.tsx`),同样从 prompt 出发、同样 commit 后写 `creative_divergence.json`,但是是一套独立的 UI 树(`EmptyState` / `TreeCanvas` / `OptionCard` / v2 `StepIndicator`)+ 独立后端(`backend/api/v2_canvas.py` + `creative_canvas_v4.json`)。

今天 commit `dc9197c` 在 `WizardSidebar` 加了一个 "modules" 槽位,把 创意画布 作为 创意发散 之后的独立模块入口,但:

| 问题 | 用户表现 |
|---|---|
| 槽位视觉隔离 | dashed border + `open_in_new` 图标让画布看起来像「去往别处」的链接,而不是 step 1 的另一种 surface |
| 路由跳转 | 点击会 `navigate()` 到 `/stage1/canvas`,用户离开 wizard;返回时丢失 wizard footer / 当前 sub-stage 状态 |
| 状态脱钩 | 画布不参与 wizard 的 `completedSteps`,完成画布不会让 step 2「概念 DNA」解锁 |
| 并列感缺失 | 侧边栏把画布放在 创意发散「下面」,暗示是 step 1 的 sub-page,而不是 step 1 的另一个面 |

### 1.2 目标

| 目标 | 验收标准 |
|---|---|
| **画布作为 step 1 的并行 surface** | 侧边栏 step 1 位置显示两个并列条目:创意发散 + 创意画布,样式一致,无 prefix / separator |
| **就地渲染** | 点击画布后,wizard 主区域切换为画布组件;`?tab=settings` 框架(侧边栏 + footer)保留;无路由跳转 |
| **独立完成追踪** | 两个 surface 各自追踪「完成」状态;互不污染 |
| **step 2 解锁 = 任一 surface 完成** | 创意发散 OR 创意画布 任意一个完成,概念 DNA 就解锁;sidebar gating 用 OR 语义 |
| **可扩展关闭任一 surface** | 状态架构允许未来加 flag / 配置项,只展示其中一个 surface(用户后期可能做,本 spec 不实现该 flag,但留挂载点)|

### 1.3 不在范围

- **关闭 创意发散** — 用户后续可能做,但本 spec 不实现 flag,只确保架构留出挂载点(参见 §6 风险)
- **画布 v4 流程改动** — `2026-09-02-creative-canvas-v2-design.md` 已落地;本 spec 不动
- **后端 schema 合并** — v3 (`creative_diverge.py`) / v4 (`v2_canvas.py`) 的双写兼容不在本 spec 范围
- **画布完成后的下游联动** — 当前画布 commit 已经写 `creative_divergence.json`,step 2 (ConceptStep) 读这份文件,逻辑天然兼容;本 spec 不动 step 2 的消费侧
- **侧边栏 visual polish** — 沿用现有 `WizardSidebar` 的样式系统(行高、icon、current/completed 配色);不引入新视觉 token

---

## 2. 顶层架构

```
                            /project/:id/workspace?tab=settings
                                          │
                                          ▼
                            ┌─────────────────────────┐
                            │ WorkspaceWizardPanel    │
                            │  ┌───────┐ ┌──────────┐ │
                            │  │Sidebar│ │ Main area│ │
                            │  │       │ │          │ │
                            │  │ 1.创意│ │ <Active  │ │
                            │  │  发散 │ │  surface>│ │
                            │  │   画布│ │          │ │
                            │  │ 2.概念│ │          │ │
                            │  │  DNA  │ │          │ │
                            │  │ ...   │ │          │ │
                            │  └───────┘ └──────────┘ │
                            │  ┌─────────────────────┐ │
                            │  │ Footer (上一步/下一步)│ │
                            │  └─────────────────────┘ │
                            └─────────────────────────┘
                                          │
                  ┌───────────────────────┼───────────────────────┐
                  │                       │                       │
                  ▼                       ▼                       ▼
        ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
        │ activeStep1Surface│   │   currentStep    │   │ completedSurfaces│
        │  "divergence"    │   │    : number      │   │  Set<SurfaceId>  │
        │  | "canvas"       │   │   (1..7)         │   │                  │
        └──────────────────┘   └──────────────────┘   └──────────────────┘
                │                       │                       │
                ▼                       ▼                       ▼
        step 1 active 时,            step 2..7 时,        "step 1 完成"
        主区域渲染:                  主区域渲染:          = divergenceDone
        divergence 组件或            对应 step 组件       || canvasDone
        canvas 组件
```

### 2.1 关键抽象

| 抽象 | 作用 |
|---|---|
| **Surface** | 一个独立的 step-1 实现入口。当前有 2 个:`divergence`、`canvas`。每个 surface 有自己的 UI 组件 + 自己的「完成」判定。 |
| **`activeStep1Surface`** | 当 `currentStep === 1` 时,主区域渲染哪个 surface 的组件。`(currentStep !== 1)` 时该字段休眠,但仍保留值,用户返回 step 1 时回到上次用的 surface。 |
| **`completedSurfaces`** | `Set<"divergence" \| "canvas">`。互不污染。`step 1` 的 effective 完成 = `completedSurfaces.size >= 1`(或更严格:`hasAnySurface1Completed`,见 §4.2)。 |

### 2.2 状态归属

- `activeStep1Surface` 和 `completedSurfaces` **都属于 `WizardContext`**(不是 `CreativeDivergenceStep` 局部),因为 sidebar 也需要读 — sidebar 要把两个 surface 的「当前/已完成」状态可视化。
- 与现有 `completedSteps: number[]` 共存:`completedSteps` 仍以 step 位置为粒度(1-7),由 `completedSurfaces` 派生 — `1 ∈ completedSteps ⇔ completedSurfaces.size >= 1`。
- sessionStorage 持久化:`activeStep1Surface` 写入 sessionStorage,跨刷新存活;`completedSurfaces` 也写入,但会被 `HYDRATE_FROM_FILES` 用磁盘状态覆盖(见 §4.3)。

---

## 3. 数据模型

### 3.1 WizardContext 新增字段

```typescript
// 在 WizardState 上加:
export type Step1SurfaceId = "divergence" | "canvas";

interface WizardState {
  // ... 现有字段 ...
  /**
   * Step 1 的 active surface。仅当 currentStep === 1 时影响主区域渲染。
   * 用户从 step 2..7 返回 step 1 时,该字段决定落到哪个 surface。
   * 默认 "divergence" — 保持现有行为,降低破坏面。
   */
  activeStep1Surface: Step1SurfaceId;

  /**
   * Step 1 的已完成 surface 集合。互不污染:
   *   - divergence 完成 → add "divergence" 不影响 canvas
   *   - canvas 完成     → add "canvas" 不影响 divergence
   * step 1 (effective) 完成 ⇔ completedStep1Surfaces.size >= 1
   * 持久化到 sessionStorage;磁盘 prefill (HYDRATE_FROM_FILES) 会用
   * creative_divergence.json / creative_canvas_v4.json 的实际状态覆盖。
   */
  completedStep1Surfaces: Step1SurfaceId[];
}
```

### 3.2 WizardContextValue 新增方法

```typescript
interface WizardContextValue {
  // ... 现有方法 ...
  /**
   * 切换 step 1 的 active surface。如果 currentStep !== 1,
   * 先 jumpToStep(1) 再切换。返回 Promise<void> 因为将来可能
   * 需要等待 canvas 异步加载(本 spec 暂不实现)。
   */
  setActiveStep1Surface: (id: Step1SurfaceId) => void;

  /**
   * 标记某个 surface 完成。Surface 互不污染,所以 add 一个不影响另一个。
   * 与现有 STEP_COMPLETED 流程的关系:
   *   - divergence 完成 → saveStep(1, {creative_divergence: ...}) + addSurface("divergence")
   *   - canvas 完成     → 直接调 addSurface("canvas"),不调 saveStep
   *     (因为 v2_canvas.py 已经写了 creative_divergence.json 兼容层;
   *      不需要再触发 wizard.saveStep 的 STEP_COMPLETED 副作用)
   */
  markStep1SurfaceCompleted: (id: Step1SurfaceId) => void;
}
```

### 3.3 新增 reducer action

```typescript
type WizardAction =
  // ... 现有 actions ...
  | { type: "SET_ACTIVE_STEP1_SURFACE"; surface: Step1SurfaceId }
  | { type: "MARK_STEP1_SURFACE_COMPLETED"; surface: Step1SurfaceId };
```

reducer 处理:

```typescript
case "SET_ACTIVE_STEP1_SURFACE": {
  // 切换 surface 时,如果当前不在 step 1,自动跳到 step 1。
  // 否则只更新 activeStep1Surface,不动 currentStep。
  return {
    ...state,
    currentStep: 1,  // 总是 step 1;如果已经在 1,这是 no-op
    activeStep1Surface: action.surface,
  };
}

case "MARK_STEP1_SURFACE_COMPLETED": {
  if (state.completedStep1Surfaces.includes(action.surface)) return state;
  // 同时把 step 1 加进 completedSteps,保持向后兼容:
  // 现有 sidebar / step 2 reachability 逻辑用 completedSteps.includes(1)
  // 判定 step 1 是否完成;不更新的话,画布 / 发散 commit 后 step 2
  // 仍然 disabled,要等 prefill 重跑才解锁。
  const nextCompletedSteps = state.completedSteps.includes(1)
    ? state.completedSteps
    : [...state.completedSteps, 1].sort((a, b) => a - b);
  return {
    ...state,
    completedStep1Surfaces: [...state.completedStep1Surfaces, action.surface],
    completedSteps: nextCompletedSteps,
  };
}
```

### 3.4 派生:step 1 的 effective 完成

不要修改 `completedSteps: number[]` 的语义(它是历史 invariant,大量代码依赖)。改用派生函数:

```typescript
// 新增工具函数,与现有 STEP_DATA_KEY_TO_STEP 同文件:
export function isStep1EffectivelyCompleted(state: WizardState): boolean {
  return state.completedStep1Surfaces.length >= 1;
}
```

调用方:
- `WizardSidebar` 在渲染 step 2..7 的 completed 标记时,如果对应 `position === 1`(只对 step 2 适用,因为 step 2 是 step 1 的下游),改用 `isStep1EffectivelyCompleted`;其他 step 仍用 `completedSteps.includes(item.position)`。
- 实际简化:`MARK_STEP1_SURFACE_COMPLETED` reducer 同时 push 1 到 `completedSteps`(见 §3.3),所以 sidebar 沿用现有 `completedSteps.includes(item.position)` 即可,不需要每个 sidebar item 单独 special-case。`isStep1EffectivelyCompleted` 保留作为导出工具,供未来扩展(例如加 step 1.5 之类的位置)使用。

### 3.5 sessionStorage 持久化

在 `WizardProvider` 的 effect 中加:

```typescript
sessionStorage.setItem(
  getSessionKey(projectId),
  JSON.stringify({
    // ... 现有字段 ...
    activeStep1Surface: state.activeStep1Surface,
    completedStep1Surfaces: state.completedStep1Surfaces,
  })
);
```

`loadPersisted` 同步加这两个字段的恢复;`prefillComplete: false` 仍然强制 prefill 重跑。

---

## 4. 行为详解

### 4.1 侧边栏渲染(WizardSidebar)

`WizardSidebar` 的 STEPS 数据模型扩展:

```typescript
interface SidebarItem {
  id: string;                    // 唯一 key
  label: string;
  icon: string;
  position: number;              // 1..7,visual row 排序
  /**
   * 标识这是一个 step-1 surface(divergence / canvas)还是普通 step。
   * 普通 step 的 step number 由 position 派生;surface 项没有 step number。
   * 同一 position 可有多个 surface 项(并列渲染)。
   */
  kind?: "step1-surface";
  surfaceId?: Step1SurfaceId;    // 仅 kind === "step1-surface"
}

const SIDEBAR_ITEMS: SidebarItem[] = [
  { id: "divergence", label: "创意发散", icon: "psychology", position: 1, kind: "step1-surface", surfaceId: "divergence" },
  { id: "canvas",     label: "创意画布", icon: "account_tree", position: 1, kind: "step1-surface", surfaceId: "canvas" },
  { id: "concept",    label: "概念 DNA", icon: "biotech",     position: 2 },
  { id: "world",      label: "世界观",   icon: "public",       position: 3 },
  { id: "character",  label: "角色设计", icon: "groups",       position: 4 },
  { id: "map",        label: "地图系统", icon: "map",          position: 5 },
  { id: "outline",    label: "全文大纲", icon: "format_list_numbered", position: 6 },
  { id: "chapter",    label: "章节大纲", icon: "auto_stories", position: 7 },
];
```

渲染规则:
- 按 `position` 升序遍历;同 `position` 的项按 SIDEBAR_ITEMS 数组顺序连续渲染(divergence 在前,canvas 在后)。
- 不画分隔符、不画 sub-section 标题(满足「无 prefix / 无 separator / 同 row 样式」需求)。
- `current` 高亮判定:
  - `position === currentStep` 且没有 surface 项 → 该项为 current
  - `position === 1`(有 surface 项)且 `currentStep === 1` 且 `activeStep1Surface === item.surfaceId` → 该 surface 项为 current(只高亮一个)
- `completed` 判定:
  - surface 项:`completedStep1Surfaces.includes(item.surfaceId)`(surface 独立追踪,互不影响)
  - 普通项(包括 step 2):`completedSteps.includes(item.position)`。step 2 之所以能正确反映 step 1 完成,是因为 `MARK_STEP1_SURFACE_COMPLETED` reducer 会同步把 `1` push 进 `completedSteps`(见 §3.3)。
- `reachable` 判定:
  - surface 项:`completed || current`(所有 step-1 项对用户始终 reachable — 用户随时可在两个 surface 间切换)
  - 普通项:沿用现有 `reachable = completed || current`

### 4.2 侧边栏 reachability 修改

现有的 `reachable = completed || current` 对 step 2 仍然成立(只要 step 1 完成就 reachable)。`completed` 判定需要改:

```typescript
// 之前:
const completed = completedSteps.includes(num);
const current = currentStep === num;
const reachable = completed || current;

// 之后(对 step 1 surface 项,需要 special-case):
const isStep1Surface = item.kind === "step1-surface";
const completed = isStep1Surface
  ? completedStep1Surfaces.includes(item.surfaceId)
  : completedSteps.includes(item.position);
const current = isStep1Surface
  ? currentStep === 1 && activeStep1Surface === item.surfaceId
  : currentStep === item.position;
const reachable = completed || current;
```

点击行为:

```typescript
onJump(item) {
  if (item.kind === "step1-surface") {
    wizard.setActiveStep1Surface(item.surfaceId);
  } else {
    wizard.jumpToStep(item.position);
  }
}
```

### 4.3 WorkspaceWizardPanel 主区域渲染

`currentStep === 1` 时按 `activeStep1Surface` 分支:

```tsx
{wizard.currentStep === 1 && (
  wizard.activeStep1Surface === "canvas"
    ? <CreativeCanvasMountPoint projectId={projectId} />
    : <CreativeDivergenceStep projectId={projectId} />
)}
{wizard.currentStep === 2 && <ConceptStep projectId={projectId} />}
{/* ... 其他 step 同现状 ... */}
```

`CreativeCanvasMountPoint` 是一个薄包装:

```tsx
function CreativeCanvasMountPoint({ projectId }: { projectId: string }) {
  // 把 CreativeCanvasPage 的内容(原本在 /stage1/canvas 路由下)
  // 在 wizard 主区域就地渲染。
  // 保留 CreativeCanvasPage 自己的 hook / state,只换 container。
  return <CreativeCanvasPage projectId={projectId} embedded />;
}
```

`CreativeCanvasPage` 加一个 `embedded?: boolean` prop;为 true 时:
- 不渲染自己的 `<PageShell>` / header(由 wizard 提供)
- commit 成功后,调 `wizard.markStep1SurfaceCompleted("canvas")` 通知 wizard
- 不做 `navigate()`(用户停留在 settings tab)

`CreativeDivergenceStep` 加 commit hook:commit 成功后调 `wizard.markStep1SurfaceCompleted("divergence")`。

> **为什么不直接调 `wizard.saveStep(1, ...)`?** 因为 saveStep 会触发 STEP_COMPLETED reducer,把 currentStep 推到 2;而 divergence 的 step 1 完成语义由 `markStep1SurfaceCompleted` 处理更干净 — divergence 完成时 currentStep 是否立刻跳到 2 由 footer 的 下一步 按钮决定(沿用现有交互)。画布同理 — 画布的「提交」按钮完成后,只标记 surface 完成,不自动跳到 step 2。

### 4.4 prefill 时的 completedStep1Surfaces 派生

`WorkspaceWizardPanel` 的 `useEffect` 已有 `Promise.allSettled([...])` 拉 6 个文件。在其结果上额外判断:

```typescript
// 在现有 cdPayload 检查旁边:
const divergenceDone = !!cdPayload?.selected_at;            // 现有逻辑
const canvasDone = canvasState !== null && canvasState.committed_at !== null;  // 新增
const completedStep1Surfaces: Step1SurfaceId[] = [];
if (divergenceDone) completedStep1Surfaces.push("divergence");
if (canvasDone) completedStep1Surfaces.push("canvas");

// 调 hydrateFromFiles,把 completedStep1Surfaces 合并进去
const completedSteps: number[] = [...];
if (completedStep1Surfaces.length > 0 && !completedSteps.includes(1)) {
  completedSteps.push(1);
}
wizard.hydrateFromFiles(completedSteps, data);
// 同时新增一个 action 把 completedStep1Surfaces 写进 wizard state:
wizard.hydrateStep1Surfaces(completedStep1Surfaces);
```

需要新增 WizardContext action + 方法:

```typescript
| { type: "HYDRATE_STEP1_SURFACES"; surfaces: Step1SurfaceId[] };

// reducer:
case "HYDRATE_STEP1_SURFACES": {
  const merged = Array.from(
    new Set([...state.completedStep1Surfaces, ...action.surfaces])
  );
  return { ...state, completedStep1Surfaces: merged };
}

// context value:
hydrateStep1Surfaces: (surfaces: Step1SurfaceId[]) => void;
```

需要新增 API 调用:读 v4 canvas state。新增 `api.getCanvasV2State(projectId)`(如果还没有 — commit `dc9197c` 之前已经有 `getCreativeCanvasV2State`,确认一下,如有则直接复用)。

> 复用现有 API:`getCreativeCanvasV2State(projectId) -> CanvasStateV4 | null`。已存在,无需新增。

### 4.5 路由清理

`/project/:id/stage1/canvas` 路由(`App.tsx`)是否保留?

- **保留作为 fallback**:侧边栏模块入口之前 navigate 过去;本次移除 wizard sidebar 的 module 入口,改为就地渲染。路由本身保留(防止外部链接 / 旧 sessionStorage 状态把用户送到那里),但 `CreativeCanvasPage` 在 standalone 模式下(无 `embedded` prop)展示一个 deprecation banner:「画布已整合到向导设置页」+ 跳转到 wizard 的链接。
- **实施时机**:本 spec **不实现 deprecation banner**(那是后续清理);路由保留 + CreativeCanvasPage 不被删除,但 wizard sidebar 的 module 入口从 sidebar 中消失。

### 4.6 数据流总览

```
用户操作                       WizardContext 变更                 UI 副作用
─────────────────────────────────────────────────────────────────────────
点击 "创意画布" sidebar      activeStep1Surface="canvas"      主区域渲染
                             currentStep=1                     CreativeCanvasMountPoint

画布提交                      markStep1SurfaceCompleted        主区域不变;
                             ("canvas") 进 completedStep1      sidebar 画布项
                             Surfaces                          显示 ✓
                             completedSteps push 1              step 2 变 reachable

点击 "概念 DNA" sidebar       jumpToStep(2)                    主区域渲染 ConceptStep
                                                              sidebar 高亮 step 2

刷新页面                      sessionStorage 恢复 +             prefill useEffect 跑;
                             prefill 覆盖 completed            磁盘状态决定
                             Step1Surfaces                     surface 完成状态
```

---

## 5. 测试计划

### 5.1 单元测试(frontend)

| 文件 | 测试 |
|---|---|
| `WizardSidebar.test.tsx` | (1) 渲染 8 个 sidebar item(divergence + canvas + 6 个 step),按 position 排序,无前缀。(2) canvas 与 divergence 同 row,样式 className 相同(都是 baseCls)。(3) 点击 canvas → 触发 setActiveStep1Surface("canvas")。(4) canvas 在 completedStep1Surfaces 时显示 ✓。(5) 两个 surface 都未完成时,step 2 disabled(reachability 走 OR 语义)。 |
| `WizardContext.test.tsx`(新)| reducer: SET_ACTIVE_STEP1_SURFACE 切换字段;MARK_STEP1_SURFACE_COMPLETED 添加 surface 不重复;HYDRATE_STEP1_SURFACES merge 去重。|
| `WorkspaceWizardPanel.test.tsx` | (1) `currentStep === 1` 且 `activeStep1Surface === "canvas"` 时渲染 CreativeCanvasMountPoint,不渲染 CreativeDivergenceStep。(2) prefill 拉到 canvas.committed_at → completedStep1Surfaces 包含 "canvas"。(3) prefill 同时拉到 divergence 和 canvas 都 done → completedStep1Surfaces 两个都有。|
| `CreativeCanvasPage.test.tsx` | 新增 `embedded` prop:为 true 时不渲染 page-shell header;commit 后调 `markStep1SurfaceCompleted("canvas")` mock(用 mock wizard context)。|

### 5.2 集成测试

| 场景 | 期望 |
|---|---|
| 进入 wizard settings → sidebar 显示 8 项 | 顺序:创意发散 / 创意画布 / 概念 DNA / 世界观 / 角色设计 / 地图系统 / 全文大纲 / 章节大纲 |
| 点 创意画布 | 主区域显示 EmptyState 或已加载的画布树(取决于 canvas state 是否已存在)|
| 画布完成 5 步 + commit | sidebar 创意画布 显示 ✓;创意发散仍 unchecked(独立);step 2 概念 DNA 变可点 |
| 点 概念 DNA | 主区域切到 ConceptStep;sidebar 概念 DNA 高亮 |
| 返回 step 1 | 默认回到上次 active 的 surface(假设上一步画布 → 画布;上一步 divergence → divergence)|
| 两个 surface 都完成 | 概念 DNA 仍 reachable(OR 语义);两个 sidebar 项都显示 ✓ |

### 5.3 E2E(live backend smoke)

新增 `tests/test_canvas_wizard_integration.py`:

- POST `/creative/canvas/:id/init` → 设 activeStep1Surface canvas → 走完 5 步 → POST `/commit` → GET creative_divergence.json → 校验 selected_at 有值 → GET /stage1/concept guard 通过(说明 step 2 解锁链路 OK)。

---

## 6. 风险与权衡

### 6.1 留出「关闭创意发散」的挂载点

用户说后期可能关闭 创意发散(只留 画布)。本 spec 不实现该 flag,但确保未来加 flag 时改动小:

- `SIDEBAR_ITEMS` 改成函数 `getSidebarItems(): SidebarItem[]`,接收一个可选的 `enabledSurfaces` 参数,过滤掉 `surfaceId` 不在白名单的项。
- `activeStep1Surface` 默认值改成读 `enabledSurfaces[0]`(如果 divergence 被关闭,默认就是 canvas)。
- `completedStep1Surfaces` 不变 — 即使 divergence 被关闭,旧的 divergence 完成记录仍然可以保留(只是 sidebar 不再显示)。

### 6.2 CreativeDivergenceStep 现有 sub-stage 状态丢失

现在 `creativeDivergenceSubStage: "A" | "B" | "C" | "D" | "E"` 是 wizard state。如果用户在 divergence sub-stage B 时点击 sidebar「创意画布」,sub-stage 会丢失吗?

答:不会丢失。`SET_ACTIVE_STEP1_SURFACE` 只切 `activeStep1Surface`,不动 `creativeDivergenceSubStage`。用户切回「创意发散」时,sub-stage B 仍然保留。

### 6.3 footer 行为

- `上一步` 在 currentStep===1 时 disable — 沿用现状。
- `下一步` 在 currentStep===1 时不显示 — 沿用现状(CreativeDivergenceStep 自己有 internal sub-stage buttons,画布有自己的「提交」按钮)。

无需改 footer 逻辑。

### 6.4 与 `creative_divergence.json` 写入的并发

画布 commit 通过 v2_canvas.py 写 `creative_divergence.json`(dual-write 在 commit_canvas,见 `creative_diverge.py:2153`)。如果 divergence 也走 `saveStep(1, ...)`,两边都写同一文件,但 divergence 不走 `saveStep`(本 spec §4.3 决定)→ 只有画布 commit 写文件,divergence commit 由 v3 写。**两者不会并发**,因为同一时间只有 activeStep1Surface 一个是 active。

### 6.5 不删除 `CreativeCanvasPage` 路由

保留 `/stage1/canvas` 路由 + `CreativeCanvasPage` 作为 standalone 入口,防止外部链接 break。Standalone 模式不展示 wizard footer;如果未来要正式关闭,把 CreativeCanvasPage 改成 redirect 到 workspace settings 即可。

---

## 7. 文件变更清单

| 文件 | 类型 | 改动 |
|---|---|---|
| `frontend/src/components/wizard/WizardContext.tsx` | 修改 | 加 `activeStep1Surface`、`completedStep1Surfaces` state;加 `SET_ACTIVE_STEP1_SURFACE`、`MARK_STEP1_SURFACE_COMPLETED`、`HYDRATE_STEP1_SURFACES` actions;加 `setActiveStep1Surface`、`markStep1SurfaceCompleted`、`hydrateStep1Surfaces` methods;加 `isStep1EffectivelyCompleted` 工具函数;sessionStorage 持久化加两个字段 |
| `frontend/src/components/wizard/WizardSidebar.tsx` | 修改 | `STEPS` → `SIDEBAR_ITEMS`(8 项,含 2 个 surface);移除 `modules` / `insertModulesAfter` / `onModuleNavigate` props;渲染逻辑按 §4.1 |
| `frontend/src/components/wizard/WizardSidebar.test.tsx` | 修改 | 移除 modules 相关 test;加 §5.1 表格中的测试 |
| `frontend/src/components/wizard/WorkspaceWizardPanel.tsx` | 修改 | `useEffect` prefill 拉 canvas state + 派生 completedStep1Surfaces;主区域渲染分支(§4.3);移除 `<WizardSidebar modules onModuleNavigate>` props(commit `dc9197c` 引入)|
| `frontend/src/components/wizard/WorkspaceWizardPanel.test.tsx` | 修改 | prefill canvas 完成 → completedStep1Surfaces;canvas surface 渲染分支 |
| `frontend/src/components/wizard/CreativeDivergenceStep.tsx` | 修改 | commit 成功后调 `wizard.markStep1SurfaceCompleted("divergence")`(具体哪个 callback 钩子需要在实施时确认 — 也许是 `onCanvasMutated`、也许是新增 prop)|
| `frontend/src/pages/CreativeCanvasPage.tsx` | 修改 | 加 `embedded?: boolean` prop;`embedded` 为 true 时不渲染 page-shell header;commit 后调 `wizard.markStep1SurfaceCompleted("canvas")`(通过 context 或 prop 注入)|
| `frontend/src/components/creative-canvas/CreativeCanvasMountPoint.tsx`(新)| 新增 | 薄包装,forward projectId + embedded=true 到 CreativeCanvasPage |
| `tests/test_canvas_wizard_integration.py`(新)| 新增 | E2E smoke |

无后端改动;无 design token 改动;无第三方依赖改动。

---

## 8. 实施顺序(高层)

> 详细 plan 见后续 writing-plans skill 输出。本节给实施者一个粗略顺序。

1. **WizardContext 加字段 + reducer + sessionStorage**(单独一个 commit,带 reducer 单测)
2. **WizardSidebar 重构 SIDEBAR_ITEMS + 移除 modules**(单独一个 commit,带 sidebar 单测)
3. **WorkspaceWizardPanel prefill 拉 canvas state + 派生 completedStep1Surfaces**(单独一个 commit,带 panel 单测)
4. **主区域渲染分支 + CreativeCanvasMountPoint + CreativeCanvasPage embedded prop**(单独一个 commit,带 page 单测)
5. **CreativeDivergenceStep commit hook 调 markStep1SurfaceCompleted**(单独一个 commit,带 divergence 单测)
6. **E2E smoke 测试 + 清理旧的模块入口测试**

每步完成后跑 `frontend/ npx vitest run` 确认无 regression(已知有 13 个 pre-existing autopilot SSE 失败,跟本 spec 无关)。

---

## 9. 成功标准

- [ ] WizardSidebar 渲染 8 项,顺序:创意发散 / 创意画布 / 概念 DNA / ... / 章节大纲;无 prefix,无 separator,样式一致
- [ ] 点击 创意画布 → 主区域就地显示画布组件,wizard footer / sidebar 不变
- [ ] 画布 commit → sidebar 创意画布 显示 ✓,step 2 概念 DNA 变 reachable
- [ ] 创意发散 commit → sidebar 创意发散 显示 ✓,step 2 概念 DNA 变 reachable(独立)
- [ ] 两个 surface 都未完成 → step 2 disabled;任一完成 → step 2 enabled
- [ ] sessionStorage 持久化 activeStep1Surface + completedStep1Surfaces;刷新后恢复
- [ ] prefill 拉到磁盘 canvas state / divergence state → 正确派生 completedStep1Surfaces
- [ ] `/project/:id/stage1/canvas` 路由仍可用(standalone 模式)
- [ ] 所有现有 frontend test 通过(已知 13 个 autopilot SSE 失败除外)
- [ ] E2E smoke 测试通过
