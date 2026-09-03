# Creative Canvas — Idea → Step 1 触发点重构 Spec

> 上游 PRD:[`/docs/design/creative-canvas-reconstruction.md`](../design/creative-canvas-reconstruction.md)
> Mockup:[`/docs/design/canvas-reconstruction/code.html`](../design/canvas-reconstruction/code.html)（`Step 1` 节点列在行 258-282；树形可视化 + 大选项卡在行 247-319）
> 范围:仅修复 init 后「继续」入口的 UX。前端专项,后端 /init 与 /next-step 端点不变。
> 不在范围:状态机重构、Step 2-5 触发逻辑调整、后端 LLM 调整、early-finalize、concept_and_dna.json 升级、wizard 集成逻辑（这些都有 spec 各自负责,本 spec 不动）

---

## 1. 背景与目标

### 1.1 当前 gap

v2.0 画布 init 后,Step 1 的 `state="available"`,操作类型与 3 个选项尚未生成。用户当前需在 TreeCanvas 步骤列中央找到「继续」按钮（`TreeCanvas.tsx:153-177` 的 `advance-step-{n}` 按钮）来触发 `/next-step` 生成 Step 1 的 3 个选项与 operation。

实际 UX 表现:

| 现象 | 根因 |
|---|---|
| 用户看到 3 个选项「无内容」 | TreeCanvas 里的 3 个小圆点是 `OptionNode`,`label` fallback 到 `slot.toUpperCase()`（`TreeCanvas.tsx:147`）。真实选项在 active-step 面板里,但 state=available 时面板不渲染（`CreativeCanvasPage.tsx:191` 的 `activeStep && (...)` 守卫）|
| 未标注「什么方式的推演」 | operation 字段在 init 后是 `null`,要到 `/next-step` 才填 |
| 「无法选择其中一个进行下一步推演」 | 3 个小圆点没有 `onSelect`;可点的「继续」按钮被埋在画布中央,与 Idea 区域没有视觉关联 |

### 1.2 mockup vs 实现偏差

Mockup `code.html:258-282` 假设 init 完成后,Step 1 列的 3 个节点已经带文字标签（"保留灵气"/"剥离灵气设定"/"未知拆解"）;无独立的「继续」按钮——Step 1 的触发应该**与 Idea 区域视觉关联**,而不是埋在树形画布中央。

### 1.3 目标

| 目标 | 验收标准 |
|---|---|
| **Step 1 「继续」入口与 Idea 区域强关联** | 「继续」图标式按钮位于 IdeaRootNode 卡片右侧,与"原始想法"在同一视觉行;点击后调用 `nextStep(1)` |
| **Step 1 之前有引导** | state=available 时,active-step 区域显示「等待 AI 生成第一个推演方向」占位文案,而非空白 |
| **Step 1 之后 active-step 面板正常出现** | 点「继续」→ /next-step → state=active,active-step 面板渲染 3 个 OptionCard（保持现有行为）|
| **Step 2-5 触发逻辑完全不变** | TreeCanvas 里的 `advance-step-{n}` 按钮对 Step 2-5 仍然存在;selectOption 后 Step N+1 进入 available,用户从 TreeCanvas 中央触发 nextStep |
| **后端零改动** | /init 与 /next-step 端点契约不变 |
| **状态机零改动** | 仍 5 态（LOCKED/AVAILABLE/ACTIVE/COMPLETED/STALE）;AVAILABLE→ACTIVE 转换语义保留 |

### 1.4 不在范围

- 后端 /init 端点改造（不变）
- 后端 /next-step 端点改造（不变）
- 后端 /select 端点的 cascade 行为改造（Step 2-5 由后端自动 cascade 到 active,本 spec 不动）
- 状态机 5→4 态简化（v2.1+ 评估）
- 移除 TreeCanvas 中央 `advance-step-{n}` 按钮（本 spec 仅新增 IdeaRootNode 旁入口,不删 TreeCanvas 旧按钮）
- 早收束（v2.1+）
- mockup 里"大选项卡永远在底部"（保留"active 状态才显示"语义,本 spec 不动）

---

## 2. 用户旅程（改后）

```text
┌──────────────────────────────────────────────────────────────┐
│ 工作台 → 项目设定 → 创意画布                                  │
└──────────────────────────────────────────────────────────────┘
       ↓
EmptyState 卡片（输入 Idea + 类型）
       ↓ 点击「开始创意推演」
       ↓ POST /init（root_idea + 空 creative_path[0]）
       ↓
切换到「画布进行中」视图:
┌──────────────────────────────────────────────────────────────┐
│ 原始想法                                  ┌────────────┐      │
│ "修仙对抗外星"                            │ 继续 →     │ ← 新 │ ← 1a 新增「继续」按钮
│ 类型:仙侠                                 └────────────┘      │
├──────────────────────────────────────────────────────────────┤
│ TreeCanvas                                                  │
│   IDEA       STEP 1                                         │
│   ┌───┐      · · ·     ← 3 个静态占位小圆点(无 A/B/C 文字)  │ ← 既有:不再展示中央"继续"按钮
│   │   │             (中央"继续"按钮本 spec 范围内 Step 1     │  (隐藏是因为本 spec 把它
│   └───┘              也有,但被 IdeaRootNode 旁的同功能按钮  │   移到 IdeaRootNode 旁)
│                       替代)                                  │
├──────────────────────────────────────────────────────────────┤
│ ╭─ 等待 AI 生成第一个推演方向 ─╮                              │ ← 3 新增引导文案
│ │ 点击上方「继续」让 AI 决定   │                              │
│ │ 第一步用什么创意操作        │                              │
│ ╰────────────────────────────╯                              │
└──────────────────────────────────────────────────────────────┘
       ↓ 用户点「继续」(IdeaRootNode 旁的图标)
       ↓ POST /next-step(current_step=1,生成 operation + options[3])
       ↓ state="active"
       ↓
切换到 active-step 视图:
┌──────────────────────────────────────────────────────────────┐
│ 原始想法                                                     │
│ "修仙对抗外星" / 仙侠                                       │
├──────────────────────────────────────────────────────────────┤
│ TreeCanvas(Step 1 已有 3 个节点 + active 脉冲标记)          │
├──────────────────────────────────────────────────────────────┤
│ STEP 1 / 5 - 扭曲 (Twist)                                    │
│ [ A 选项卡 ]  [ B 选项卡 ✓ ]  [ C 选项卡 ]                  │
│ "为什么是扭曲?AI 推荐理由..."                                │
└──────────────────────────────────────────────────────────────┘
       ↓ 用户选 A/B/C
       ↓ POST /select
       ↓ 后端 cascade 调 _next_step_impl(2) → Step 2 直接进入 active
       ↓(Step 2-5 永远不经历 "available" 态,所以 TreeCanvas 中央"继续"按钮实际不会显示)
       ↓
       ↓ 重复 Step 2-5
       ↓ Step 5 完成后 canCommit → PreCommitSummary → 提交
```

注:本 spec 范围内**仅 Step 1 增加** IdeaRootNode 旁的「继续」按钮。Step 2-5 仍由 TreeCanvas 中央的 `advance-step-{n}` 按钮触发 `/next-step`,**本次不动**。

原因:用户原话"在「原始想法」后增加一个继续的图标"明确指向 Step 1 入口;Step 2-5 的"原始想法"卡片是回顾性展示(用户已走过 Step 1),继续在它旁边放按钮会引起「为什么我选了还要点继续」的认知负担。

后续如需统一 Step 2-5 的入口,作为独立 spec 评估。

---

## 3. 架构

### 3.1 改动文件

| 文件 | 类型 | 责任 |
|---|---|---|
| `frontend/src/components/creative-canvas/IdeaRootNode.tsx` | Modify | 新增可选 `onContinue?: () => void` 与 `continueLoading?: boolean` props;卡片右侧渲染「继续」图标按钮(仅在 `onContinue` 提供时) |
| `frontend/src/components/creative-canvas/IdeaRootNode.test.tsx`(新建) | Create | 单元测试:无 onContinue 时不渲染按钮;有 onContinue 时渲染;loading 态显示 spinner;点击触发 callback |
| `frontend/src/components/creative-canvas/EmptyState.tsx` | 不改 | init 触发保持由父组件处理 |
| `frontend/src/components/creative-canvas/CanvasPreStepHint.tsx`(新建) | Create | active-step 区域在 state=available 时的占位文案卡片("等待 AI 生成第一个推演方向") |
| `frontend/src/components/creative-canvas/CanvasPreStepHint.test.tsx`(新建) | Create | 单元测试:渲染文案 + 不渲染 active-step 面板 |
| `frontend/src/components/creative-canvas/TreeCanvas.tsx` | 不改 | 保留 `advance-step-{n}` 按钮(Step 2-5 仍可用);`onAdvance` 接口不变 |
| `frontend/src/pages/CreativeCanvasPage.tsx` | Modify | 在 IdeaRootNode 旁加 `onContinue={() => nextStep(1)}`(**仅在 Step 1 且 state=available 时提供**);active-step 区域前加 `<CanvasPreStepHint />`(**仅在 Step 1、state=available、activeStep 为空时渲染**);Step 2-5 走既有 TreeCanvas 中央按钮路径(本 spec 不动) |
| `frontend/src/test/pages/CreativeCanvasPage.test.tsx` | Modify | 扩测试:init 后 IdeaRootNode 出现「继续」按钮;点「继续」触发 nextStep 调用;active-step 区域显示 PreStepHint 直到 state=active |

### 3.2 数据流

```text
                ┌─────────────────────────────────┐
                │ useCreativeCanvasV2             │
                │   canvas: CanvasV4State         │
                │   nextStep(currentStep)         │
                │   loadingStep: boolean          │
                └────────────┬────────────────────┘
                             │
                ┌────────────┴────────────────────┐
                │ CreativeCanvasPage              │
                │                                 │
                │  const step1 =                  │
                │    canvas.creative_path?.[0]    │
                │  const isStep1Available =       │
                │    step1?.state === 'available' │
                │    && step1?.step === 1         │
                │                                 │
                │  <IdeaRootNode                  │
                │    prompt={...}                 │
                │    genre={...}                  │
                │    onContinue={                 │
                │      isStep1Available           │ ← 仅 Step 1 + available
                │        ? () => nextStep(1)      │   时提供
                │        : undefined              │
                │    }                            │
                │    continueLoading={            │
                │      loadingStep                │
                │    }                            │
                │  />                             │
                │                                 │
                │  {!activeStep &&                │
                │   isStep1Available && (         │ ← 仅 Step 1 显示
                │    <CanvasPreStepHint step={1}  │ ← 新组件
                │    />                           │
                │  )}                             │
                │                                 │
                │  {activeStep && (               │ ← 既有
                │    <active-step 面板>           │
                │  )}                             │
                │                                 │
                │  (Step 2-5 走 TreeCanvas        │
                │   advance-step-{n} 按钮,        │
                │   本 spec 不动)                 │
                └─────────────────────────────────┘
```

### 3.3 关键不变量

- **`onContinue` 仅在 Step 1 且 state=available 时提供**——其他步骤(Step 1 COMPLETED 后、Step 2-5 的 available 态)不显示「继续」,由 TreeCanvas 中央按钮负责
- **`continueLoading` 与 hook 的 `loadingStep` 同步**——后端生成期间,「继续」按钮变 spinner 并禁用
- **`CanvasPreStepHint` 仅在 `!activeStep && currentStep === 1 && isAvailable` 时渲染**——state=active 时让位给大选项卡;Step 2-5 走 TreeCanvas 路径,active-step 区域不显示引导(保持现状空白)
- **TreeCanvas 的 `advance-step-{n}` 按钮保留**——Step 2-5 在实际流程中不会进入 `available` 态(后端 `/select` cascade 直接把下一步写成 `active`),所以这个按钮**仅在 Step 1 真正可见**;Step 1 的 TreeCanvas 中央按钮保留(冗余入口,本 spec 不删,与 IdeaRootNode 旁的按钮功能等价)
- **后端零改动**——/init 仍写 `creative_path[0] = { state: "available", options: [] }`

### 3.4 错误处理

| 失败模式 | 表现 | 兜底 |
|---|---|---|
| `/next-step` LLM 失败 | 已有:hook 的 `error` state + toast `画布操作失败:...` | 保留 |
| `/next-step` 返回 503 | 同上 | 保留 |
| 加载期间用户再次点「继续」 | `continueLoading=true` 时按钮 disabled,`onClick` 不会触发 | 由 `disabled` 守卫 |
| 网络中断,canvas 状态半新半旧 | 下次进入时 `loadCanvas` 读最新状态,根据 state 决定渲染 | 既有行为 |

---

## 4. 组件 API

### 4.1 `IdeaRootNode` 新增 props

```typescript
interface Props {
  prompt: string;
  genre?: string;
  /**
   * 点击「继续」时触发。父组件应在 state=available 时提供,
   * 步骤 COMPLETED 后改为 undefined 以隐藏按钮(此时画布中央
   * 仍可触发,但 Idea 区域按钮消失——避免"已完成还能继续"的歧义)。
   * undefined 时不渲染按钮。
   */
  onContinue?: () => void;
  /**
   * 后端生成中显示 spinner 并禁用按钮。父组件从
   * useCreativeCanvasV2.loadingStep 传入。
   */
  continueLoading?: boolean;
}
```

### 4.2 `CanvasPreStepHint` 新组件

```typescript
interface Props {
  /** 步骤号(用于文案"第 1 步"显示);默认 1。 */
  step?: number;
}

/**
 * Active-step 区域在 state=available 时的占位卡片。
 * 引导用户去 Idea 区域点「继续」,而不是干等。
 */
export function CanvasPreStepHint({ step = 1 }: Props) { ... }
```

文案内容（初稿,实施时可微调）:

```text
╭─ 等待 AI 生成第一个推演方向 ────────╮
│                                     │
│  创意路径将从这里开始。              │
│  点击上方的「继续」,让 AI 决定       │
│  第 {step} 步用什么创意操作。        │
│                                     │
╰─────────────────────────────────────╯
```

最终文案在 implementation plan 阶段由 UI 微调决定;语义约束是(1)指向 Idea 区域的「继续」按钮,(2)说明生成的是"创意操作 + 3 个方向",(3)步骤号动态显示。

---

## 5. 测试

### 5.1 单元测试

| 文件 | 用例 |
|---|---|
| `IdeaRootNode.test.tsx`(新建) | (1) 不传 onContinue → 不渲染按钮;(2) 传 onContinue → 渲染「继续」图标;(3) 传 onContinue + continueLoading=true → 显示 spinner + 按钮 disabled;(4) 点击触发 onContinue 一次;(5) 禁用状态下点击不触发 |
| `CanvasPreStepHint.test.tsx`(新建) | (1) 默认 step=1 → 文案含"第 1 步";(2) step=3 → 文案含"第 3 步" |
| `CreativeCanvasPage.test.tsx`(扩展) | (1) init 后(cstate.creative_path[0].state=available)IdeaRootNode 显示「继续」按钮;(2) 点「继续」触发 hook.nextStep(1) 调用;(3) state=available 时 active-step 区域显示 `<CanvasPreStepHint />`,不显示 3 个 OptionCard;(4) state=active 时不显示 PreStepHint,显示 OptionCard |

### 5.2 集成测试

无新增。`tests/test_v2_canvas_endpoints.py` 已覆盖 /init 与 /next-step 契约,本 spec 不动后端。

### 5.3 E2E

无新增。画布的端到端流程在 `docs/superpowers/specs/2026-09-03-canvas-wizard-integration-design.md` Task 6 已有覆盖,本 spec 范围内不影响该 E2E 行为。

---

## 6. 风险与权衡

| 风险 | 缓解 |
|---|---|
| 「继续」按钮位置在 IdeaRootNode 内部可能让卡片变挤 | mockup 视觉验证:IdeaRootNode 当前宽度 180px,按钮宽度 36px,按钮在卡片右侧(absolute 或 flex 横向布局)。最终 UI 在写 plan 时定 |
| Step 2-5 双重入口(TreeCanvas 中央 + Idea 旁)可能让用户困惑 | 文案 + tooltip 提示两者等价;在 plan 阶段决定是否对 Step 2-5 仅保留 TreeCanvas 中央按钮(避免冗余) |
| `loadingStep` 命名误导 | hook 当前用 `loadingStep` 覆盖整个画布的 loading 态(包括 select/nextStep)。沿用即可,不重命名 |
| PRD §10 Happy Path 未提及 AVAILABLE→ACTIVE 过渡 | 后续在 PRD 中补一句。本 spec 范围内不动 PRD,但在 commit message 引用此点作为未来 PRD 改进项 |
| 与 wizard 集成 spec 冲突? | 画布的 state machine 与 wizard 集成正交(后者只读 canvas.committed / creative_divergence.json)。本 spec 不影响 wizard 集成 spec 的所有约定 |

---

## 7. 验收清单

- [ ] EmptyState 点「开始创意推演」后,UI 切换到画布视图,IdeaRootNode 右侧出现「继续」图标
- [ ] active-step 区域显示 `CanvasPreStepHint`(等待 AI 文案),不显示 OptionCard
- [ ] 点击 IdeaRootNode 旁「继续」→ 调用 hook.nextStep(1) → state=active
- [ ] state=active 后 active-step 区域显示 3 个 OptionCard + AI 推荐理由;`CanvasPreStepHint` 消失
- [ ] Step 2-5 仍可从 TreeCanvas 中央的 `advance-step-{n}` 按钮触发 nextStep(向后兼容)
- [ ] 所有现有 `CreativeCanvasPage.test.tsx`、`TreeCanvas.test.tsx` 测试通过
- [ ] 新增 `IdeaRootNode.test.tsx` 与 `CanvasPreStepHint.test.tsx` 单测全通过
- [ ] 后端 `pytest tests/test_v2_canvas_endpoints.py` 全通过(本 spec 不改后端,做兜底验证)
- [ ] 手工:在 dev server 走完"输入 Idea → 点继续 → 选 A → Step 2 → 选 B → ... → commit"完整路径无回归
