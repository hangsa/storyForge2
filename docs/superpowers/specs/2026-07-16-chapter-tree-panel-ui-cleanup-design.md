# v1.10 — ChapterTreePanel UI 清理 设计

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-07-16
**Branch:** v1.9
**Status:** 设计已批准,待落地 plan

---

## 一、目标与非目标

### 1.1 Goal

`ChapterTreePanel` 做两个 UI 清理:

1. **去掉"扁平 / 树形 / 按幕"视图切换 tab。** 该 tab 实际上是 dead code —— `viewMode` state 被设置但从未用来切换渲染,三种模式渲染出的 DOM 完全相同(`ChapterTreePanel.tsx:64, 146-162`)。用户报告不需要它,直接移除。
2. **冻结 header 行(`章节 / 刷新 / +新章节`)不随章节列表滚动而隐藏。** 当章节列表很长(例如 150 章)时,用户滚到中间就找不到 刷新 按钮和 +新章节 按钮了。采用 `position: sticky; top: 0` 让 header 在章节列表滚动时保持可见。

### 1.2 Non-goals

- 不重构 `WorkspaceLayout` 的滚动容器 —— 当前 `left-column` 的 `h-full overflow-y-auto` 配合 sticky 已经工作良好,无需改动
- 不实现真正的"扁平 / 树形 / 按幕"模式区别(本次是删 dead code,不是补功能)
- 不改章节列表本身的渲染顺序或结构
- 不改 ManagedDashboard(只在 manual 模式显示 ChapterTreePanel;managed 模式由 ManagedDashboard 渲染,不受影响)
- 不新增防御性反向断言测试(用户已确认最小改动原则)

---

## 二、数据/接口现状(不改)

- `ChapterTreePanel.tsx:38` 定义 `type ViewMode = "flat" | "tree" | "act"` —— **删除**
- `ChapterTreePanel.tsx:54-58` 定义 `const VIEW_MODES: ...` —— **删除**
- `ChapterTreePanel.tsx:64` 持有 `viewMode` state —— **删除**
- `ChapterTreePanel.tsx:146-162` 渲染三个 tab button —— **删除**
- `ChapterTreePanel.tsx:128-144` 渲染 header(章节 + 刷新 + 新章节)—— **改为 sticky**
- `ChapterTreePanel.test.tsx:105-138` 两个 view-mode 测试 —— **删除**
- 其它所有章节/场景 testid 不变

`WorkspaceLayout.tsx:221` 的 `left-column` 容器 `h-full overflow-y-auto` 保持不变 —— sticky 元素在 overflow 容器内正常工作。

---

## 三、实现要点

### 3.1 `ChapterTreePanel.tsx` 改动清单

**删除项(精确行号以当前文件为准):**

```ts
// Line 38: 整行删除
type ViewMode = "flat" | "tree" | "act";

// Lines 54-58: 整段删除
const VIEW_MODES: { value: ViewMode; label: string }[] = [
  { value: "flat", label: "扁平" },
  { value: "tree", label: "树形" },
  { value: "act", label: "按幕" },
];

// Line 64: 整行删除
const [viewMode, setViewMode] = useState<ViewMode>("flat");

// Lines 146-162: 整段 JSX 删除(原来三个 tab button 的容器 div)
<div className="flex rounded border border-outline-variant overflow-hidden text-xs">
  {VIEW_MODES.map((m) => (
    <button ...>{m.label}</button>
  ))}
</div>
```

**修改项:**

将现有的 header `<div className="flex items-center justify-between">` (line 128) 改为:

```tsx
<div className="sticky top-0 z-10 bg-canvas-bg border-b border-outline-variant -mx-3 px-3 pt-3 pb-2 flex items-center justify-between">
```

样式说明:

- `sticky top-0 z-10`:滚动时钉在视窗顶部,高于普通滚动内容
- `bg-canvas-bg`:章节列表滚到 header 下方时,header 背景色遮住下面的内容(色值取自 `tailwind.config.ts:43-45`,与父容器 `p-3` 同色)
- `border-b border-outline-variant`:header 与列表内容之间的视觉分隔线
- `-mx-3 px-3`:抵消外层 `<div className="p-3 ...">` 的水平 padding,让 sticky header 横跨整个列宽,看起来更像一个独立 band
- `pt-3 pb-2 pt-3` 恢复被 `-mx-3` 抵消的顶部 padding,`pb-2` 让 header 内部更紧凑一点(原来的按钮是垂直居中,不需要很大的下边距)

### 3.2 `ChapterTreePanel.test.tsx` 改动清单

删除以下两个 `it(...)` 测试块(精确行号以当前文件为准):

- **Lines 105-120:** `renders all three view-mode buttons (扁平 / 树形 / 按幕)` —— 验证 view-mode 按钮存在,功能被删除后无意义
- **Lines 122-138:** `clicking a view-mode button highlights it (v1.8: label-only, no filter)` —— 验证点击切换样式,功能被删除后无意义

其它测试(`renders volume headers`、`renders chapter rows with status badge`、`does not render a status badge for chapters missing from progress.json` 等)不受影响,继续验证章节/场景渲染逻辑。

---

## 四、错误处理

无新错误路径。本次是纯 UI 删除 + CSS 调整,没有引入新的运行时行为或接口。

| 场景 | 行为 |
|---|---|
| 章节列表为空 | 现有行为:不渲染任何章节,header 仍然 sticky 在顶部 |
| 章节列表极长(>视窗高度) | 新行为:header 留在顶部,列表内容在 header 下方滚动 |
| 用户切换 managed 模式 | 不受影响:`ManagedDashboard` 不使用 `ChapterTreePanel`,本次改动只影响 manual 模式 |
| 浏览器禁用 sticky(`position: sticky` 兼容到 IE11+;主流浏览器全支持) | 退化行为:header 随列表一起滚动(等同改动前) —— 是 graceful degradation,无需兜底 |

---

## 五、测试策略

**无新增测试。**

现有测试套件保持:
- `ChapterTreePanel.test.tsx` 删除 2 个 obsolete 测试后,剩余 12 个测试应当全部 pass(同 baseline)
- `Workspace.test.tsx` 完全不受影响
- 不引入新的 vitest case(用户选择最小改动)

**手动视觉验证(开发自测):**

```bash
cd /Users/longsa/Codes/storyForge2/frontend && npm run dev
```

打开 `http://localhost:5173/project/proj_cc4ca4ae/workspace`,观察:
1. 左栏 header(章节 / 刷新 / +新章节)出现在最顶部 ✓
2. 章节列表很长时,滚动列表 → header 留在视窗顶部不消失 ✓
3. header 与滚动内容之间有一条清晰的分隔线(border-b)✓
4. 视图模式 tab 已不存在 ✓

---

## 六、文件清单

### 6.1 修改

| 文件 | 改动 |
|---|---|
| `frontend/src/components/workspace/ChapterTreePanel.tsx` | 删除 `ViewMode` 类型、`VIEW_MODES` 常量、`viewMode` state、视图模式 JSX block;header `<div>` 改为 sticky + 加 bg + border-b |
| `frontend/src/test/ChapterTreePanel.test.tsx` | 删除 2 个 view-mode 相关测试块 |

### 6.2 新建

无。

---

## 七、范围与一致性自评

### 7.1 Spec coverage check

- 视图模式 tab 完全移除 → ✅ §3.1 删除清单全部 4 项
- header 滚动时保持可见 → ✅ §3.1 sticky 样式 + bg-canvas-bg 遮挡 + border-b 分隔
- 不改 WorkspaceLayout → ✅ §3.1 限定改动范围
- 不改 ManagedDashboard → ✅ §1.2 explicit non-goal

### 7.2 Placeholder scan

通篇搜 "TBD" / "TODO" / "appropriate" / "类似": 无。

### 7.3 Internal consistency

- 删除清单的 4 项彼此独立(类型 / 常量 / state / JSX),无遗漏
- sticky 样式 5 个 class(`sticky top-0 z-10 bg-canvas-bg border-b -mx-3 px-3 pt-3 pb-2`)语义互不冲突
- `tailwind.config.ts:43-45` 的 `canvas.bg` 已在 `ChapterTreePanel` 现有样式中作为父容器背景使用(`p-3 space-y-3 ...`),bg-canvas-bg 是已有 token

### 7.4 Scope check

1 组件文件 + 1 测试文件,纯 CSS/JSX/类型清理,单 plan 即可落地。

### 7.5 Ambiguity scan

- "冻结 header 是否需要过渡动画?" → 不需要。Tailwind 默认无 transition,sticky 是即时跟随,符合用户"不滚动消失"的字面需求。如要动画可后续追加,本次不做。
- "border-b 在 header 与内容滚动交界处会不会太抢眼?" → 用项目既有 `border-outline-variant` token,与现有 outline 系颜色一致,不抢眼。
- "managed 模式会不会受影响?" → §1.2 显式排除。ManagedDashboard 是另一个组件,不渲染 ChapterTreePanel。

---

## 八、待办

- 等用户对本 spec 复核 → 进入 superpowers:writing-plans 写出实现 plan → 进入 subagent-driven-development 落地
- 落地后: 现有 ChapterTreePanel 12 测试 pass,Workspace 现有测试 pass,baseline 失败保持现状