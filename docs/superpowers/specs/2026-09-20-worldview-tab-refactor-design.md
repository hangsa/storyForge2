# 世界观 Tab 化改造 设计文档

**Date**: 2026-09-20
**Status**: Draft (待用户确认)
**Scope**: `frontend/src/components/wizard/WorldStep.tsx` 单一文件 UI 重构

## 背景

WorldStep 当前按 4 个 section (时代与地理 / 力量体系 / 世界规则 / 势力分布) 在同一页面上**纵向堆叠**展示,每节带自己的 SectionRegenerateButton,力量体系 / 势力分布还有 inline「添加体系/添加势力」按钮。

创意发散-拆解 (S2) 页面已在 2026-09-15 把 5 个维度改为 sticky 顶部横条 tab + 下方 panel 的布局,视觉密度更紧凑,跨维度跳转更直接。本次改造**参考 S2 tab 模式**重做 WorldStep。

## 目标

- WorldStep 顶部改为 4 个 tab 横条,各 tab 内容放在对应 panel
- tab 按钮带 icon / label / count badge / 内嵌 regenerate 图标
- panel 内部组织:多卡 section (力量/势力) 卡片堆叠 + 底部「添加」按钮;单字段 section 直接堆字段
- 加载态保留现有 spinner,tab strip 只在有内容时渲染

## 非目标

- 不改任何状态管理 / API 调用 / 校验 / 持久化逻辑
- 不引入新的依赖库
- 不重构其它 wizard step
- 不抽离共享 `<TabStrip>` 组件到 `components/ds/` (本改动范围限定 WorldStep 内部,后续若有第二处使用再抽)

## 设计

### 1. 整体布局

```
┌─ WorldStep ────────────────────────────────────────────────────┐
│ ┌─ tab strip (sticky top-0 z-10) ───────────────────────────┐  │
│ │ [🌐 时代与地理 4 ↻] [⚡ 力量体系 1 ↻] [⚖ 世界规则 5 ↻] │  │
│ │                                              [👥 势力 2 ↻] │  │
│ └──────────────────────────────────────────────────────────┘  │
│ ┌─ active panel (flex-1 overflow-y-auto) ───────────────────┐  │
│ │  era, geography, era_social_structure, era_cultural_history│  │
│ │  ── 或 ──                                                  │  │
│ │  power_system card 1                                       │  │
│ │  power_system card 2                                       │  │
│ │  [+ 添加体系]                                              │  │
│ │  ── 或 ──                                                  │  │
│ │  core_rules TagEditor                                      │  │
│ │  ── 或 ──                                                  │  │
│ │  faction card 1                                            │  │
│ │  faction card 2                                            │  │
│ │  [+ 添加势力]                                              │  │
│ └──────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

外层 `WorkspaceWizardPanel` 的全局 footer (上一步 / 保存 / 下一步 / 重新生成) **保持不变**。

### 2. Tab strip

完全复用 `S2DecomposeStep.tsx:155-193` 的样式与交互:

- 容器: `<div role="tablist" data-testid="world-tabs" className="sticky top-0 z-10 -mx-6 px-6 bg-surface-container-low/95 backdrop-blur-sm flex gap-1 mt-3 border-b border-outline-variant overflow-x-auto">`
- tab 按钮: `role="tab"`,`aria-selected`,`aria-controls`,内含 icon + label + count badge + 内嵌 ↻ 图标
- panel: `role="tabpanel"`,`aria-labelledby`,**所有 4 个 panel 都在 DOM 中,非 active 用 `hidden`** (与 S2 一致 — 保留 testid 可定位,单测零侵入)
- active 态: `border-primary text-primary`
- inactive 态: `border-transparent text-on-surface-variant`

### 3. Tab 配置 (固定 4 个)

```ts
const WORLD_TABS = [
  { key: "era", label: "时代与地理", icon: "landscape" },
  { key: "power_system", label: "力量体系", icon: "bolt" },
  { key: "core_rules", label: "世界规则", icon: "rule" },
  { key: "factions", label: "势力分布", icon: "groups" },
] as const;
type WorldTabKey = (typeof WORLD_TABS)[number]["key"];
```

| Tab key | Label | Icon | Count 来源 |
|---|---|---|---|
| `era` | 时代与地理 | `landscape` | 固定 `4` |
| `power_system` | 力量体系 | `bolt` | `world.power_systems.length` |
| `core_rules` | 世界规则 | `rule` | `world.core_rules.length` |
| `factions` | 势力分布 | `groups` | `world.factions.length` |

顺序固定,无 reorder 需求 (与用户指定顺序一致)。

### 4. Tab 按钮内部结构

```tsx
<button
  role="tab"
  aria-selected={isActive}
  aria-controls={`world-panel-${key}`}
  data-testid={`world-tab-${key}`}
  onClick={() => setActiveKey(key)}
  onKeyDown={handleTabKeyDown}  // ← → 切换
  className={...}
>
  <span className="material-symbols-outlined text-base">{icon}</span>
  <span>{label}</span>
  <span className="font-mono text-[10px] opacity-70">{count}</span>
  {/* 内嵌 regenerate — 与 label 之间 ml-1,小一号 */}
  <span
    role="button"
    aria-label={`重新生成${label}`}
    data-testid={`world-tab-${key}-regenerate`}
    onClick={(e) => { e.stopPropagation(); onRegenerate(key); }}
    className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded hover:bg-primary-container/15 text-on-surface-variant hover:text-primary-container"
  >
    <span className="material-symbols-outlined text-[14px] leading-none">refresh</span>
  </span>
</button>
```

注:`span role="button"` 而非嵌套 `<button>`,避免嵌套 button 的 a11y 问题。`onClick` 调 `stopPropagation` 防止冒泡到外层 tab 切换。

### 5. 键盘左右切换

每个 tab button 监听 `onKeyDown`(不是 tab strip 容器监听 — 容器监听需要 tabindex 管理,逐 button 监听更直接,且焦点只在 button 上时触发),按 `ArrowLeft` / `ArrowRight` 时:

```ts
const handleTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  const idx = WORLD_TABS.findIndex(t => t.key === activeKey);
  const nextIdx = e.key === "ArrowRight"
    ? (idx + 1) % WORLD_TABS.length
    : (idx - 1 + WORLD_TABS.length) % WORLD_TABS.length;
  setActiveKey(WORLD_TABS[nextIdx].key);
  // 焦点跟随
  const nextTab = document.querySelector<HTMLButtonElement>(`[data-testid="world-tab-${WORLD_TABS[nextIdx].key}"]`);
  nextTab?.focus();
};
```

焦点指示: tab 按钮 `focus-visible:ring-2 ring-primary-container outline-none` (Tailwind 原生 utility,S2 没做,这次顺手加)。

### 6. Panel 内部组织

#### 6.1 时代与地理 panel (`era`)

直接 4 个字段堆叠,无 header (section 标题由 tab 承担):

```tsx
<div role="tabpanel" id="world-panel-era" aria-labelledby="world-tab-era" hidden={activeKey !== "era"} data-testid="world-panel-era" className="space-y-3">
  <Field label="时代背景"><AutoTextarea ... /></Field>
  <Field label="地理环境"><AutoTextarea ... /></Field>
  <Field label="社会结构"><AutoTextarea testid="world-era-social-structure" ... /></Field>
  <Field label="历史文化"><AutoTextarea testid="world-era-cultural-history" ... /></Field>
</div>
```

#### 6.2 力量体系 panel (`power_system`)

```tsx
<div role="tabpanel" id="world-panel-power_system" hidden={activeKey !== "power_system"} data-testid="world-panel-power_system" className="space-y-3">
  {world.power_systems.length === 0 && (
    <p className="text-xs text-primary-container/40 text-center py-3">暂无力量体系</p>
  )}
  {world.power_systems.map((ps, i) => (
    <PowerSystemCard key={i} index={i} ps={ps} ... />
  ))}
  <div className="flex justify-center pt-2">
    <button data-testid="world-power-system-add" onClick={addPowerSystem} disabled={busy}
            className="... 添加体系 ...">
      <span className="material-symbols-outlined text-xs">add</span>
      添加体系
    </button>
  </div>
</div>
```

`PowerSystemCard` 内部保留:
- 卡片右上角: `↻ regenerate` (testid `world-power-system-{i}-regenerate`) + `× remove` (testid `world-power-system-{i}-remove`)
- 字段 testid 全部保留:`world-power-system-{i}-name/description/stages/rules/ceilings/cost`

#### 6.3 世界规则 panel (`core_rules`)

```tsx
<div role="tabpanel" id="world-panel-core_rules" hidden={activeKey !== "core_rules"} data-testid="world-panel-core_rules">
  <TagEditor items={world.core_rules ?? []} onItemsChange={...} saving={busy} />
</div>
```

注: 现有 `<div data-testid="world-core-rules">` 包 TagEditor 保留 — 防止依赖该 testid 的旧测试断。

#### 6.4 势力分布 panel (`factions`)

与力量体系对称,testid 全部保留 (`world-faction-add`, `world-faction-{i}-*`)。

### 7. 加载态与空态

- `wizard.status === "generating"`: 只渲染 spinner,**不渲染 tab strip 与 panels** (避免空 tab strip + 0 count 的视觉噪音)。
- `wizard.status === "error"`: 渲染错误条 + **不渲染 tab strip**。
- `wizard.status === "completed"` 或 `wizard.data.world` 已存在:
  - tab strip 渲染,默认 `activeKey = "era"` (沿用 `useState` 初始值)
  - 各 panel 按 active 状态渲染

### 8. 内部组件提取

在 WorldStep.tsx 文件内部新增 5 个组件 (不导出,仅文件内使用):

```tsx
function WorldTabs({ activeKey, counts, regenerateDisabled, onTabChange, onRegenerate, onTabKeyDown }) { ... }
function EraPanel({ world, setWorld, busy }) { ... }
function PowerSystemsPanel({ world, setWorld, busy, onAdd, onRegenerateItem, onRemoveItem }) { ... }
function CoreRulesPanel({ world, setWorld, busy }) { ... }
function FactionsPanel({ world, setWorld, busy, onAdd, onUpdateField, onRemove }) { ... }
```

主组件 `WorldStep` 只持有 `world` / `busy` / `wizard` 等 hook 状态,把对应 props 透传给 panel 组件。这样:
- WorldStep 主函数从 ~600 行降到 ~200 行 (状态 + 业务函数)
- 每个 panel 组件 ≤ 100 行,易读易测
- 不增加新文件,避免改动前端 import 树

### 9. testid 改动清单

#### 新增

| testid | 位置 |
|---|---|
| `world-tabs` | tab strip 容器 |
| `world-tab-era` / `world-tab-power_system` / `world-tab-core_rules` / `world-tab-factions` | 4 个 tab 按钮 |
| `world-tab-era-regenerate` / `world-tab-power_system-regenerate` / `world-tab-core_rules-regenerate` / `world-tab-factions-regenerate` | tab 内嵌 ↻ |
| `world-panel-era` / `world-panel-power_system` / `world-panel-core_rules` / `world-panel-factions` | 4 个 panel |

#### 废弃

| 旧 testid | 新位置 |
|---|---|
| `world-era-regenerate` | 移到 `world-tab-era-regenerate` |
| `world-power-system-regenerate` | 移到 `world-tab-power_system-regenerate` |
| `world-core-rules-regenerate` | 移到 `world-tab-core_rules-regenerate` |
| `world-factions-regenerate` | 移到 `world-tab-factions-regenerate` |

#### 保留 (位置可能变,但 testid 不变)

- `world-step` (root) / `world-form`
- `world-era-social-structure` / `world-era-cultural-history` (字段)
- `world-power-system-add` / `world-faction-add` (移到 panel 底部)
- `world-power-systems` / `world-power-system-{i}` / `world-power-system-{i}-name/description/stages/rules/ceilings/cost/regenerate/remove`
- `world-core-rules`
- `world-factions` / `world-faction-{i}` / `world-faction-{i}-name/type/goal/relations/remove`

### 10. 测试改动

WorldStep 现有两条 regenerate 触发链路:
- **section 级**(本 spec 改动目标):tab 内嵌 ↻ → `handleSectionRegenerate(key)` → 弹 modal → `api.regenerateWorldSection`
- **整页级**(本 spec 不动):wizard footer「重新生成」→ `setShowRegenerateModal(true)` → 弹 modal(target="世界观") → `api.generateWorld`

#### 需更新的测试 (使用旧 section regenerate testid 的所有位置)

`frontend/src/test/InitWizardModal.test.tsx`:
- 第 518 行 `it("world-step renders 4 section regenerate icons...")`:把 524–527 行的 4 个 `getByTestId("world-{section}-regenerate")` 改为新 testid (`world-tab-era-regenerate` 等)
- 第 530 行 `it("clicking world-power-system-regenerate + confirm...")`:第 535 行 `findByTestId("world-power-system-regenerate")` 改为 `world-tab-power_system-regenerate`
- 第 745 行附近 `describe("section regenerate footer status badge", ...)` 下的 3 个用例 (第 752、774、793 行均调 `screen.getByTestId("world-era-regenerate").click()`):改为 `world-tab-era-regenerate`

`frontend/src/test/WorldStep.test.tsx`:
- 第 473 行 `expect(screen.getByTestId("world-power-system-regenerate")).toBeInTheDocument()`:改为 `world-tab-power_system-regenerate`

`frontend/src/test/SectionRegenerateButton.test.tsx`:**不动**。该文件测的是 `SectionRegenerateButton` 组件本身,testId 是作为 prop 传入,跟 WorldStep 实际用什么 testid 无关 — 即使 WorldStep 改完不再调用 `SectionRegenerateButton`,该组件仍被 CharacterStep / OutlineStep 使用,该测试集不受影响。

#### 不动的测试

- 字段级 testid (`world-era-social-structure` / `world-era-cultural-history` 等) 测试不变
- 卡片级 testid (`world-power-system-{i}-name/description/.../regenerate/remove`) 测试不变 — `world-power-system-{i}-regenerate` 是**卡片级** (每个 power_system 卡片右上角),与 tab 级的 `world-tab-power_system-regenerate` 是两个不同的 testid,**两者并存**
- `world-step` / `world-form` / `world-power-system-add` / `world-faction-add` 测试不变 (testid 保留)

### 11. 文件改动范围

| 文件 | 改动 |
|---|---|
| `frontend/src/components/wizard/WorldStep.tsx` | 重构: 主组件瘦身 + 抽 5 个内部子组件 + 新增 tab 状态 + 新增 keyboard handler |
| `frontend/src/test/InitWizardModal.test.tsx` | 更新 ~518 行的 "4 section regenerate icons" 测试断言 |

不新增文件,不删除文件。

## 实施顺序 (高层)

1. 在 WorldStep.tsx 顶部加 `WORLD_TABS` 配置 + `activeKey` state
2. 提取 5 个内部子组件 (EraPanel / PowerSystemsPanel / CoreRulesPanel / FactionsPanel / WorldTabs),保留所有原逻辑
3. 主 WorldStep 重组 render: 加载态/错误态/有内容态三分支
4. 加上 `keydown` 键盘左右切换 + focus-visible ring
5. 更新 `InitWizardModal.test.tsx` 第 518 行测试
6. 跑 `npm test` 验证所有测试通过

## 风险与注意

- **键盘切换 a11y**: 必须 `e.preventDefault()` 防止浏览器原生 ← → 滚动页面;焦点跟随 `nextTab?.focus()` 后,用户按 Tab 会从新 tab 出发。
- **嵌套 button 警告**: tab 按钮已是 `<button>`,内部 ↻ 必须用 `span role="button"` 而非 `<button>`,否则 React 会抛 hydration warning。已知 a11y 取舍:屏幕阅读器对内嵌 `role="button"` 朗读可能不完美 — 用户在 Q1 决策里明确选了「tab 按钮内嵌」,此 tradeoff 是知情接受的。
- **`hidden` 与 `space-y-3`**: panel 用 `hidden` 属性,不影响布局计算 (不参与 layout tree)。active panel 内的 `space-y-3` 在非 active panel 不会生效,符合预期。
- **StrictMode 双挂载**: 不变,本改动不影响 useEffect 行为。
- **empty world.json 恢复**: 4 个 panel 的 count 都是 0,UI 显示空态文案 — 现状已有,无回归。
- **`world-power-systems` testid**: 当前是 power_system 卡片列表容器,改造后位置在 panel 内,但 testid 保留。
