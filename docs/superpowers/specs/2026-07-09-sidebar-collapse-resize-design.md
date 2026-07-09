# 左侧导航栏：收起/打开 + 拖拽调宽度 — Spec

> **状态：** 已对齐，待用户复核
> **优先级：** 独立小特性，可在任意阶段插入
> **关联版本：** v1.7+ 前端

---

## 1. 背景与目标

当前 `SideNavBar` 是固定 `w-[280px]` 的常驻侧边栏，写作者在 Stage4（写作中心）等核心页面需要最大化正文区域；同时不同使用者对侧边栏宽度的偏好不一致（长路径 vs 紧凑布局）。

**目标：**
1. 收起态：侧边栏完全隐藏，main 占满整个屏幕；TopHeader 留一个始终可见的汉堡按钮用于恢复
2. 展开态：侧边栏右侧整条边线可拖拽，实时改变宽度；松开后保存
3. 收起/展开状态与宽度持久化到本浏览器（localStorage），刷新与切换项目均保持

**不在范围（YAGNI）：**
- 键盘快捷键（用户明确不要求）
- 响应式特殊处理（用户选择不动）
- 抽屉模式 / 多列布局
- 跨设备同步（需要后端用户表）
- 展开态过渡动画的精细缓动函数（200ms 线性足够）

---

## 2. 已有基础（不重写）

| 资产 | 路径 | 复用方式 |
|---|---|---|
| `MainLayout` | `frontend/src/components/layout/MainLayout.tsx` | 调 hook，把状态透传给子组件 |
| `SideNavBar` | 同上 | 加 `width` / `onLiveWidthChange` / `onCommitWidth` props；collapsed 时返回 null |
| `TopHeader` | `frontend/src/components/layout/TopHeader.tsx` | 加 `collapsed` / `onToggleSidebar` props；最左渲染汉堡按钮 |
| `ToastProvider` | `frontend/src/hooks/useToast.tsx` | 无相关，列在此处仅为说明状态模式（同样使用 hook，不引入全局状态库） |
| `layout.test.tsx` | `frontend/src/test/layout.test.tsx` | 更新现有调用以适配新 props |
| Material Symbols | 全局可用 | `menu` 图标作为汉堡按钮 |

不引入任何第三方库（不用 framer-motion / react-resizable-panels 等）。

---

## 3. 新增 / 修改文件

```
frontend/
├── src/
│   ├── hooks/
│   │   └── useSidebar.ts                         # NEW
│   ├── components/
│   │   └── layout/
│   │       ├── MainLayout.tsx                    # MODIFY
│   │       ├── SideNavBar.tsx                    # MODIFY
│   │       ├── TopHeader.tsx                     # MODIFY
│   │       ├── ResizeHandle.tsx                  # NEW
│   │       └── SidebarToggleButton.tsx           # NEW
│   └── test/
│       ├── hooks/
│       │   └── useSidebar.test.ts                # NEW
│       ├── ResizeHandle.test.tsx                 # NEW
│       ├── SidebarToggleButton.test.tsx          # NEW
│       └── layout.test.tsx                       # MODIFY
```

---

## 4. 数据契约

### `useSidebar()` hook

```ts
interface UseSidebarReturn {
  collapsed: boolean;
  width: number;
  MIN: 200;
  MAX: 480;
  setWidthLive: (w: number) => void;   // 拖拽中：仅更新 React state（实时预览）
  commitWidth: (w: number) => void;    // pointerup：clamp + 写 localStorage
  toggle: () => void;                  // 切换收起 + 写 localStorage
}
```

**持久化格式（localStorage）：**
- key: `storyforge.sidebar`
- value (JSON): `{ "collapsed": boolean, "width": number }`

**初始化逻辑（每次 hook 调用）：**
1. 尝试 `localStorage.getItem("storyforge.sidebar")`
2. `try { JSON.parse(...) } catch { 回落默认 }`
3. 字段缺失 / 类型错 → 回落默认
4. `width` clamp 到 [200, 480]；`collapsed` `Boolean()` 转换
5. 默认值：`{ collapsed: false, width: 280 }`
6. 任意 `getItem` 抛错 → 回落默认

**API 行为：**
- `setWidthLive(w)`：`w` clamp 后 `setState`，**不写 localStorage**（拖拽中可能 60 次/秒）
- `commitWidth(w)`：`w` clamp 后 `setState` + 写 localStorage
- `toggle()`：翻转 `collapsed`，写 localStorage（含当前 `width`，使展开后还原）

---

## 5. 组件契约

### `ResizeHandle`（`frontend/src/components/layout/ResizeHandle.tsx`）

```ts
interface ResizeHandleProps {
  width: number;                       // 当前宽度
  onLiveChange: (w: number) => void;   // pointermove 中调用
  onCommit: (w: number) => void;       // pointerup 时调用
}
```

**实现要点：**
- `absolute right-0 top-0 h-full w-1`（命中区 4px，视觉 1px 竖线）
- `cursor-col-resize`
- `onPointerDown`：记录初始 clientX 与 navRect.left（用于计算宽度），`setPointerCapture`，挂全局 `document.body.style.cursor = 'col-resize'` 与 `userSelect = 'none'`
- `onPointerMove`：计算 `e.clientX - rect.left`，调用 `onLiveChange`
- `onPointerUp`：调用 `onCommit(currentWidth)`，释放 capture，恢复 body 样式
- clamp 在 hook 层完成，handle 只发值

### `SidebarToggleButton`（`frontend/src/components/layout/SidebarToggleButton.tsx`）

```ts
interface SidebarToggleButtonProps {
  collapsed: boolean;
  onToggle: () => void;
}
```

**实现要点：**
- Material Symbols `menu` 图标（始终一致，不随状态切换图标）
- `title` 属性：`collapsed ? "展开侧边栏" : "收起侧边栏"`
- `aria-label` 与 title 同步
- `aria-expanded={!collapsed}`
- 不加 `aria-controls`（YAGNI：collapsed 时 SideNavBar 不在 DOM，指向不存在的 id 无语义价值）

### `SideNavBar` props 变化

新增：
```ts
width: number;
onLiveWidthChange: (w: number) => void;
onCommitWidth: (w: number) => void;
```

行为变化：
- `collapsed=true` → 组件返回 `null`（无 DOM 节点；main 配合 marginLeft=0 占满）
- `collapsed=false` → 原内容 + 末尾挂载 `<ResizeHandle>`
- 根 className 由 `w-[280px]` 改为 `style={{ width }}` 或动态 className

### `TopHeader` props 变化

新增：
```ts
collapsed: boolean;
onToggleSidebar: () => void;
```

行为变化：
- 最左侧（StoryForge 文字之前）渲染 `<SidebarToggleButton>`
- 其余不变

### `MainLayout` 行为变化

```tsx
const { collapsed, width, setWidthLive, commitWidth, toggle } = useSidebar();

<TopHeader
  ...
  collapsed={collapsed}
  onToggleSidebar={toggle}
/>
<SideNavBar
  ...
  width={width}
  onLiveWidthChange={setWidthLive}
  onCommitWidth={commitWidth}
/>
<main style={{ marginLeft: collapsed ? 0 : width }} className="mt-16 p-6 transition-all duration-200">
  <Outlet />
</main>
```

（`SideNavBar` 自身在 collapsed 时返回 null，main 只需 marginLeft=0。）

---

## 6. 拖拽视觉与交互

| 状态 | 视觉 | cursor |
|---|---|---|
| 默认 | 手柄透明 | `cursor-col-resize` |
| hover | `bg-primary-container/30` | 同上 |
| 拖拽中 | `bg-primary-container/50`，body cursor 强制 col-resize | 同上 |

拖拽中：
- `document.body.style.cursor = 'col-resize'`
- `document.body.style.userSelect = 'none'`
- 释放时还原

动画：
- `transition-all duration-200`
- SideNavBar 宽度 / main marginLeft / 汉堡按钮位置 同步过渡

---

## 7. 错误与边界

| 场景 | 处理 |
|---|---|
| localStorage 不可用（隐私模式 / SSR-like） | `try/catch` 包裹；UI 仍可用，仅不持久化 |
| localStorage 值越界 | 读取时 clamp 到 [200, 480] |
| localStorage 值类型错（非对象 / 字段缺失） | 回落默认 |
| 拖出窗口外松开 | `setPointerCapture` 保证 pointerup 仍触发 |
| 多指 / 多 pointer 同时按下 | 只处理第一个；其余忽略 |
| window resize 期间拖拽 | 不处理（罕见） |
| `ResizeHandle` unmount 时 body cursor / userSelect 残留 | `ResizeHandle` 内部 `useEffect` cleanup 还原 |

---

## 8. 测试策略

### `useSidebar.test.ts`（新增，约 8 用例）
- 默认（localStorage 空）
- 从 localStorage 恢复
- 越界 width clamp
- 非对象 / 非法 JSON 回落
- `getItem` 抛错回落
- `toggle` 翻转并写入
- `setWidthLive` 更新 state 不写 localStorage（spy 验证）
- `commitWidth` clamp + 写入

### `ResizeHandle.test.tsx`（新增，约 4 用例）
- 渲染默认样式
- `pointerdown` + `pointermove` → `onLiveChange` 被调
- `pointerup` → `onCommit` 被调
- unmount 后 body cursor / userSelect 还原

### `SidebarToggleButton.test.tsx`（新增，约 3 用例）
- 渲染 menu 图标
- 点击 → `onToggle`
- `title` / `aria-label` / `aria-expanded` 随 collapsed 切换

（`MainLayout` 不写 smoke 测试：现有 `layout.test.tsx` 不测 `MainLayout`，引入 Router wrapper 增加复杂度；hook 与子组件已直接覆盖。）

### `layout.test.tsx`（修改）
- 所有 `SideNavBar` render 补 width / handlers
- 所有 `TopHeader` render 补 collapsed / onToggleSidebar
- 新增：`SideNavBar` `collapsed=true` 返回 null
- 新增：`TopHeader` 汉堡按钮存在并可点击

### 不测试
- e2e / Playwright（项目无此工具链）
- 动画时序
- cursor 视觉样式（仅 DOM 属性断言）

---

## 9. 风险与回滚

- **风险 1**：拖拽 60 次/秒触发 React re-render 可能掉帧
  - 缓解：仅 main + SideNavBar 各一处的 style 重写；React 18 batching 已能扛
  - 回滚：合并前 git revert

- **风险 2**：localStorage 中已有项目相关 key 冲突
  - 缓解：使用专属 key `storyforge.sidebar`，命名空间清晰

- **风险 3**：`layout.test.tsx` 现有用例因 props 新增而编译失败
  - 缓解：测试与组件同步更新（已在第 8 节列出）

---

## 10. 不在本 spec 范围

- 抽屉模式 / 多列布局
- 键盘快捷键（⌘B 等）
- 移动端 / 窄屏特殊处理
- 跨设备同步
- 收起态图标列 / tooltip
- 后端用户偏好持久化
