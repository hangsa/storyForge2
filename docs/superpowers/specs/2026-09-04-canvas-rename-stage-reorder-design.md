# 创意画布 → 剧情画布：重命名 + 阶段重排 设计 Spec

**版本**：v1.0
**日期**：2026-09-04
**作者**：Claude
**范围**：Stage 1 wizard 阶段重排 + 创意画布更名为剧情画布
**状态**：设计待评审

---

## 1. 背景与目标

### 1.1 当前状态

`nebula` 分支已落地创意画布 v2 重构（PRD：`docs/design/creative-canvas-reconstruction.md`）：
- 5 步创意推演引擎（扭曲 / 打破 / 融合 / 反转 / 升级）
- `WizardSidebar` 把创意画布 + 创意发散作为 Step 1 的两个并行 surface
- 接入 `WorkspaceWizardPanel` 的 wizard 流程（位置 1，与 divergence 平行）
- 总步骤数 = 7（surface 共享 position 1）

### 1.2 痛点

产品决策：**剧情画布的语义定位应在地图系统之后、概念 DNA 之后**——它是基于已定世界 / 角色 / 地图的剧情推演，而不是定位在概念之前的"创意发散"。

当前把画布放在 Step 1 与 divergence 并行，导致：
1. **产品语义错位**：剧情画布实质是"已经有人物 / 世界观之后，再深化剧情"，但被摆在 Step 1
2. **下游消费契约混乱**：画布 commit 写 `concept_and_dna.json`，本应是 ConceptStep (Step 2) 的上游，现在却被塞在 Step 1
3. **抽象层过度设计**：Step 1 dual-surface 的 OR 语义只为支持 divergence / canvas 平行而立，已偏离真实产品意图

### 1.3 重构目标

- **阶段重排**：把剧情画布移到 Step 6（地图系统之后、全文大纲之前）。全文大纲与章节大纲阶段数 +1。
- **重命名**：创意画布 → 剧情画布（中文 + JS/TS 标识符；保留后端 API 兼容性）。
- **拆抽象**：完全删除 step1-surface 抽象层，divergence 退化为普通 Step 1。
- **占位数据流**：canvas commit 仍写 `concept_and_dna.json`（被 ConceptStep 读）；完整数据链调整推迟到后续 PR。

---

## 2. Wizard 阶段结构（新）

### 2.1 SIDEBAR_ITEMS 新顺序

| Position | id | label | 子组件 |
|---|---|---|---|
| 1 | `divergence` | 创意发散 | `CreativeDivergenceStep` |
| 2 | `concept` | 概念 DNA | `ConceptStep` |
| 3 | `world` | 世界观 | `WorldStep` |
| 4 | `character` | 角色设计 | `CharacterStep` |
| 5 | `map` | 地图系统 | `MapStep` |
| **6** | **`plot`** | **剧情画布** | **`PlotCanvasMountPoint`** |
| 7 | `outline` | 全文大纲 | `OutlineStep` |
| 8 | `chapter` | 章节大纲 | `ChapterOutlineStep` |

`TOTAL_STEPS` 从 `7` 改为 `8`。

### 2.2 SidebarItem 类型瘦身

`WizardSidebar.tsx` 中：

```ts
export interface SidebarItem {
  id: string;
  label: string;
  icon: string;
  position: number;  // 1..8
  // 删除：kind?: "step1-surface"
  // 删除：surfaceId?: Step1SurfaceId
}
```

Sidebar 渲染逻辑：
- 删除 `isStep1Surface` / `step1Effective` 判断
- 删除 `completedStep1Surfaces.includes(...)` 路径
- 改用纯 `completedSteps.includes(item.position)` 作为 completed 判定
- reachability 简化：`completed || current || (item.position === currentStep + 1 && completedSteps.includes(currentStep))`

注：reachability 的精确实现细节在 implementation plan 中确定，本次 spec 不绑定。

### 2.3 InitWizardModal 不变

`frontend/src/components/wizard/InitWizardModal.tsx` 是已 DEPRECATED 的老 wizard（被 WorkspaceWizardPanel 取代）。它未涉及 step1-surface 抽象，且其 `STEP_TITLES` 1-6 编号与剧情画布无关。**本次重构不动 InitWizardModal 主体逻辑。**

但需校验：删除 `Step1SurfaceId` / `setActiveStep1Surface` 等后，InitWizardModal 不依赖它们（已校验：`useWizard()` 调用清单中无 surface 相关方法）。

---

## 3. 重命名清单

### 3.1 中文文案

所有用户可见中文文案 `创意画布` → `剧情画布`：
- `WizardSidebar.tsx:17` — `{ id: "canvas", label: "创意画布", ... }` → `{ id: "plot", label: "剧情画布", ... }`
- `frontend/src/components/creative-canvas/` 目录下所有组件内的中文标题 / 按钮 / 空状态文案
- `frontend/src/pages/CreativeCanvasPage.tsx`（重命名后 `PlotCanvasPage.tsx`）中的页面标题、面包屑等

### 3.2 文件 / 目录重命名（IDE 重命名 → 历史可能丢失，用户已确认接受）

| 原 | 新 |
|---|---|
| `frontend/src/components/creative-canvas/` | `frontend/src/components/plot-canvas/` |
| `frontend/src/components/creative-canvas/CreativeCanvasMountPoint.tsx` | `frontend/src/components/plot-canvas/PlotCanvasMountPoint.tsx` |
| `frontend/src/components/creative-canvas/CreativeCanvasMountPoint.test.tsx` | `frontend/src/components/plot-canvas/PlotCanvasMountPoint.test.tsx` |
| `frontend/src/pages/CreativeCanvasPage.tsx` | `frontend/src/pages/PlotCanvasPage.tsx` |
| `frontend/src/pages/CreativeCanvasPage.test.tsx`（在 `test/pages/`） | `frontend/src/test/pages/PlotCanvasPage.test.tsx` |
| `frontend/src/hooks/useCreativeCanvasV2.ts` | `frontend/src/hooks/usePlotCanvasV2.ts` |
| `frontend/src/hooks/useCreativeCanvasV2.test.ts` | `frontend/src/hooks/usePlotCanvasV2.test.ts` |
| `frontend/src/test/components/creative-canvas/` | `frontend/src/test/components/plot-canvas/` |

注：`creative-canvas/` 目录下其他组件文件名（`TreeCanvas.tsx`, `IdeaRootNode.tsx`, `OptionCard.tsx`, `CanvasEmptyState.tsx`, `CanvasPreStepHint.tsx`, `EmptyState.tsx`, `TreePath.tsx`, `ScoresBar.tsx`, `QualityBar.tsx`, `ResetConfirmDialog.tsx`, `StepIndicator.tsx`, `NoveltyRadar.tsx`, `AIRecommendedBadge.tsx`, `MutationSuggestion.tsx`, `OptionNode.tsx`, `PreCommitSummary.tsx`）保留原名——这些是中性 canvas 概念，不带 "Creative" 前缀，无需调整。

### 3.3 标识符重命名（JS/TS）

| 类别 | 原 | 新 |
|---|---|---|
| 组件导出 | `CreativeCanvasMountPoint` | `PlotCanvasMountPoint` |
| 默认导出（页面）| `CreativeCanvasPage` | `PlotCanvasPage` |
| Hook | `useCreativeCanvasV2` | `usePlotCanvasV2` |
| Test ID | `data-testid="wizard-sidebar-item-canvas"` | `data-testid="wizard-sidebar-item-plot"` |
| SidebarItem id | `canvas` | `plot` |
| Route path | `/project/:id/stage1/canvas` | `/project/:id/stage6/plot` |

注：
- `api.getCanvasV2State` / `api.commitCanvasV2` 等 client.ts 中的 API 方法名**保持不变**（与后端路由 `/api/creative/canvas/{project_id}/session/*` 一致；用户已确认不动后端）
- `source="canvas"` 在后端 / 前端的字符串字面量保持不变（用户已确认不动后端）
- `creative_canvas` 在后端字段名保持不变
- `data-testid="creative-canvas-..."` 类前缀统一改为 `data-testid="plot-canvas-..."`（仅前端）

### 3.4 Backend 不动

`backend/api/v2_canvas.py`、`backend/main.py`、`backend/agents/creative_director.py`、`backend/api/creative_diverge.py`、`backend/creative_os/migration.py`、`backend/creative_os/option_generator.py` 等所有 backend 文件**完全不动**。

后端路由 `/api/creative/canvas/{project_id}/session/*`、JSON 文件 `canvas_state.json`、`concept_and_dna.json` 命名都不动。

---

## 4. WizardContext.tsx 拆抽象

### 4.1 删除内容

#### 4.1.1 类型

```ts
// 删除
export type Step1SurfaceId = "divergence" | "canvas";
```

#### 4.1.2 状态字段

从 `WizardState` 中删除：
- `activeStep1Surface: Step1SurfaceId`
- `completedStep1Surfaces: Step1SurfaceId[]`

从 `initialState` 删除对应初值。

#### 4.1.3 Reducer action

```ts
// 删除
| { type: "SET_ACTIVE_STEP1_SURFACE"; surface: Step1SurfaceId }
| { type: "MARK_STEP1_SURFACE_COMPLETED"; surface: Step1SurfaceId }
| { type: "HYDRATE_STEP1_SURFACES"; surfaces: Step1SurfaceId[] };
```

并删除对应 `case` 分支。

#### 4.1.4 Context value 方法

从 `WizardContextValue` 中删除：
- `setActiveStep1Surface: (id: Step1SurfaceId) => void`
- `markStep1SurfaceCompleted: (id: Step1SurfaceId) => void`
- `hydrateStep1Surfaces: (surfaces: Step1SurfaceId[]) => void`

并从 `value` 对象中删除对应 dispatch 包装。

#### 4.1.5 工具函数

```ts
// 删除
export function isStep1EffectivelyCompleted(state: WizardState): boolean
```

#### 4.1.6 sessionStorage 持久化

在 `useEffect` 中持久化字段中删除：
- `activeStep1Surface`
- `completedStep1Surfaces`

在 `loadPersisted` 中删除对应字段的读取与 default。

### 4.2 保留内容

- `creativeDivergenceSubStage`（divergence 的 A/B/C/D/E 子阶段机制不动）
- `CreativeDivergenceSubStage` 类型
- `SET_DIVERGENCE_SUBSTAGE` / `JUMP_TO_CREATIVE_DIVERGENCE` reducer
- divergence commit 的语义仍然把 1 push 到 `completedSteps`（与原 divergence 完成 = step 1 完成的语义一致）

---

## 5. WorkspaceWizardPanel.tsx 调整

### 5.1 prefill effect

`completedStep1Surfaces: Step1SurfaceId[]` 局部变量删除。

`canvasPayload.committed` 检测：

```ts
// 原
if (canvasPayload?.committed === true && canvasPayload.committed_at !== null) {
  if (!completed.includes(1)) completed.push(1);
  completedStep1Surfaces.push("canvas");
}

// 新
if (canvasPayload?.committed === true && canvasPayload.committed_at !== null) {
  if (!completed.includes(6)) completed.push(6);
}
```

`divergence` 检测不变：仍 `completed.push(1)`。

底部 `hydrateStep1Surfaces` 调用整段删除。

### 5.2 渲染分支

```tsx
// 原
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

// 新
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

注：原 `markStep1SurfaceCompleted("divergence")` 语义是「push 1 到 completedSteps + 不推进 currentStep」。现有等价 API 是 `wizard.markStepGenerated(1, {})`（MARK_STEP_GENERATED reducer：加 1 到 completedSteps + status=completed，但 currentStep 不变）。**不要用 `wizard.saveStep(1, {})`**——后者会推进 currentStep 到 2，破坏 divergence commit 后的当前页停留语义。

### 5.3 onJump

```tsx
// 原
onJump={(item) => {
  if (item.kind === "step1-surface") {
    wizard.setActiveStep1Surface(item.surfaceId!);
  } else {
    wizard.jumpToStep(item.position);
  }
}}

// 新
onJump={(item) => {
  wizard.jumpToStep(item.position);
}}
```

### 5.4 Props 传给 WizardSidebar

```tsx
// 原
<WizardSidebar
  currentStep={wizard.currentStep}
  completedSteps={wizard.completedSteps}
  activeStep1Surface={wizard.activeStep1Surface}
  completedStep1Surfaces={wizard.completedStep1Surfaces}
  onJump={...}
/>

// 新
<WizardSidebar
  currentStep={wizard.currentStep}
  completedSteps={wizard.completedSteps}
  onJump={...}
/>
```

`WizardSidebar` 的 props 同步删除 `activeStep1Surface` / `completedStep1Surfaces`。

---

## 6. 数据流（占位说明）

### 6.1 当前数据契约

```
canvas commit
  → canvas_state.json (committed=true, committed_at=...)
  → concept_and_dna.json (concept + story_dna)
  → creative_divergence.json dual-write (source="canvas", selected_at=...)
```

### 6.2 重构后保留的行为

canvas commit 仍写 `concept_and_dna.json`。ConceptStep (Step 2) 仍读 `concept_and_dna.json` 作为其 prefill 源与数据源。

### 6.3 已知语义不一致（用户接受的占位行为）

- **画布在 Step 6**，但仍写 `concept_and_dna.json`（被 Step 2 读）
- **画布不再消费上游**（world/character/map 数据）——它的输入仍然是 root idea，与 Stage 3 输出的内容无关

**TODO**：完整的上下游数据链路调整后续再做（单独 spec）。本次重构仅做阶段重排 + 重命名 + 拆抽象。

### 6.4 现有项目 sessionStorage 旧字段

sessionStorage 中残留的 `activeStep1Surface` 与 `completedStep1Surfaces` 字段：
- 本次不写迁移逻辑（用户决定：丢弃旧字段，靠预填重检测）
- `loadPersisted` 中不读取这两个字段
- 旧字段保留在 sessionStorage JSON 里也无害（无害的脏数据，下次清理时一起清）

预填 effect 中：
- divergence `selected_at` 检测 → push 1 到 completedSteps
- canvas `committed + committed_at` 检测 → push 6 到 completedSteps

旧项目重载后：divergence 与 canvas 的完成态分别独立检测，分别推到正确的 step 位置（1 或 6）。

---

## 7. 测试调整

### 7.1 文件级重命名

| 原 | 新 |
|---|---|
| `frontend/src/components/creative-canvas/CreativeCanvasMountPoint.test.tsx` | `frontend/src/components/plot-canvas/PlotCanvasMountPoint.test.tsx` |
| `frontend/src/pages/CreativeCanvasPage.test.tsx`（路径 `frontend/src/test/pages/`）| `frontend/src/test/pages/PlotCanvasPage.test.tsx` |
| `frontend/src/hooks/useCreativeCanvasV2.test.ts` | `frontend/src/hooks/usePlotCanvasV2.test.ts` |
| `frontend/src/test/components/creative-canvas/*` 全目录 | `frontend/src/test/components/plot-canvas/*` |

### 7.2 测试断言更新

#### `frontend/src/components/wizard/WizardSidebar.test.tsx`

- 期望的 SIDEBAR_ITEMS 长度从 7（实际 7，含 2 surface）改为 8
- 删除 surface 相关的测试用例（kind === "step1-surface"）
- 期望的 sidebar item id 中 "canvas" → "plot"
- 期望的 label 中 "创意画布" → "剧情画布"
- 期望的 testid `wizard-sidebar-item-canvas` → `wizard-sidebar-item-plot`

#### `frontend/src/test/WizardContext.test.tsx`

删除以下测试用例：
- `setActiveStep1Surface updates activeStep1Surface and sets currentStep=1`
- `markStep1SurfaceCompleted adds surface and pushes 1 into completedSteps`
- `markStep1SurfaceCompleted is idempotent per surface`
- `hydrateStep1Surfaces merges with existing via Set dedup`
- `persists activeStep1Surface and completedStep1Surfaces to sessionStorage`
- `restores activeStep1Surface and completedStep1Surfaces from sessionStorage`
- `isStep1EffectivelyCompleted returns true when any surface done`

#### `frontend/src/components/wizard/WorkspaceWizardPanel.test.tsx`

- 删除 `markStep1SurfaceCompleted` 相关的 mock / 调用
- canvas commit 后的 completedSteps 断言从 `expect(completed).toContain(1)` 改为 `expect(completed).toContain(6)`
- divergence commit 后的 completedSteps 断言仍为 `toContain(1)`

#### `frontend/src/test/pages.test.tsx`

- 路径 `/stage1/canvas` 相关断言 → `/stage6/plot`
- `CreativeCanvasPage` import → `PlotCanvasPage`

#### `frontend/src/test/pages/CreativeCanvasPage.test.tsx` → `PlotCanvasPage.test.tsx`

- 文件内所有 "CreativeCanvasPage" / "stage1/canvas" 字符串替换

#### `frontend/src/hooks/useCreativeCanvasV2.test.ts` → `usePlotCanvasV2.test.ts`

- 文件内所有 import / 引用更新

### 7.3 Backend 测试

`tests/test_canvas_wizard_integration.py`：
- 后端 API 行为不变，测试主体保持不变
- 更新 docstring 与内联注释：
  - `completedStep1Surfaces` 描述 → "完成态现在写到 step 6，而不是 step 1"
  - 行 163 注释：`completedStep1Surfaces contains both "canvas" and "divergence"` → 改为对应 step 6 / step 1 的说明
- 不修改断言（断言的是后端文件 / 状态字段，与 wizard 步骤编号无关）

`tests/test_v2_canvas_endpoints.py`：
- 后端 API 行为不变，测试主体保持不变
- 仅更新 docstring / 注释中提到 wizard 步骤编号的地方

---

## 8. 文档更新

### 8.1 `docs/design/creative-canvas-reconstruction.md`

需更新：
- 文档标题：`# Creative Canvas 创意画布模块重构 PRD` → `# Plot Canvas 剧情画布模块重构 PRD`
- §11.1 路由：`/project/:projectId/stage0/canvas` → `/project/:projectId/stage6/plot`（同时把 "v1.8.1 改造把 canvas 从 Stage 0 提升到 Stage 1" 改写为 "v2.x 改造把剧情画布从 Step 1 surface 移到 Step 6"）
- §31 信息架构图：调整顺序，从 `ConceptStep (wizard Step 2) → ... → Stage 3 Map → Stage 3 Outline` 改为 `... → Stage 3 Map → 剧情画布 (Step 6) → 全文大纲 (Step 7)`
- §35 与 wizard 流程集成：调整 `navigate(/project/:id/stage0)` → `navigate(/project/:id/stage6/plot)`（commit 后跳转目标）

§26（API 端点表格）保持原状（用户决定：后端不动），§26.1 ADR 中关于 v2 namespace 的描述保持。

### 8.2 `docs/design/canvas-reconstruction/` 目录

未追踪的目录，本次 spec 不明确要求改动。**遵循最小改动原则**：除非某个文件阻碍重构完成，否则不主动改。如 implementation 时发现该目录下文件必须改，按需更新。

### 8.3 `docs/superpowers/plans/2026-09-03-canvas-wizard-integration.md`

历史 plan，已 ship。本次不改。如需要，新增一份本次重构的 plan：`docs/superpowers/plans/2026-09-04-canvas-rename-stage-reorder.md`。

### 8.4 `docs/superpowers/specs/2026-09-03-canvas-wizard-integration-design.md`

历史 spec，已 ship。本次不改。后续 spec `2026-09-04-canvas-rename-stage-reorder-design.md` 即本文件。

### 8.5 `docs/ARCHITECTURE.md` / `docs/design/creative-canvas-module.md`

按需更新"创意画布" → "剧情画布" 中文表述。这些是高层文档，技术细节少。

---

## 9. 错误处理

### 9.1 已知风险

1. **现有项目预填**：旧项目 sessionStorage 含 surface 字段。删除读取逻辑后，无害（不读就不影响）。预填 effect 重新检测 divergence + canvas，分别推到 step 1 / step 6。
2. **路由 path 变更**：旧 URL `/stage1/canvas` 直接 404（用户决定不加 redirect）。
3. **Canvas API 兼容性**：前端调用 `api.getCanvasV2State` 等保持原方法名，但前端组件名 / hook 名变了。任何地方如果有硬编码 `useCreativeCanvasV2` 调用需更新。
4. **IDE 重命名丢历史**：`git log --follow` 不能跨重命名追踪。用户已接受。

### 9.2 验证步骤

1. 单元测试：`cd frontend && npm test` 全绿
2. 后端测试：`pytest tests/test_canvas_wizard_integration.py tests/test_v2_canvas_endpoints.py` 全绿
3. 手动 E2E：起 dev server，创建项目，走完 wizard：divergence → concept → world → character → map → 剧情画布 → outline → chapter
4. 路径验证：访问 `/project/{id}/stage6/plot` 正常；访问 `/project/{id}/stage1/canvas` 返回 404
5. sessionStorage 验证：清空旧项目 sessionStorage 后走 wizard，divergence 完成 → step 1 + step 2 reachable；canvas 完成 → step 6 reachable

---

## 10. 不在本 spec 范围

明确推迟：
- **数据流调整**：canvas commit 写什么 / 读什么，与上下游 ConceptStep / World / Character / Map 的契约重塑
- **Skill 重命名**：`backend/agents/creative_director.py` 等中的 "Creative Canvas" 提及
- **后端命名**：`backend/api/v2_canvas.py` 重命名为 `backend/api/v2_plot_canvas.py`
- **后端路由命名**：`/api/creative/canvas/{project_id}/session/*` → `/api/plot_canvas/...`
- **历史 plan / spec 文件清理**：`docs/superpowers/plans/2026-09-03-*.md` 等

---

## 11. 验收标准

- [ ] `WizardSidebar` 显示 8 项，divergence 在 position 1，剧情画布在 position 6
- [ ] `WizardContext` 不再含 `Step1SurfaceId` / `activeStep1Surface` / `completedStep1Surfaces` 类型与字段
- [ ] `WorkspaceWizardPanel` 渲染分支：`currentStep===1` 仅渲染 `CreativeDivergenceStep`；`currentStep===6` 渲染 `PlotCanvasMountPoint`
- [ ] 前端代码搜索 `CreativeCanvasMountPoint` / `CreativeCanvasPage` / `useCreativeCanvasV2` / `creative-canvas/` / `stage1/canvas` / `创意画布` 全部无残留（除了注释中说明"原 X"）
- [ ] 后端代码搜索 `v2_canvas` / `/api/creative/canvas/` / `canvas_state.json` 全部保持原状
- [ ] `frontend/src/components/creative-canvas/` 目录已删除，文件迁到 `frontend/src/components/plot-canvas/`
- [ ] 后端测试 + 前端测试全绿
- [ ] 手动 E2E：用户能完成 divergence → concept → world → character → map → 剧情画布 → outline → chapter 完整流程
