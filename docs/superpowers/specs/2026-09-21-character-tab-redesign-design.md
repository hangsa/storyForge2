# 角色设计 Tab 化改造 设计文档

**Date**: 2026-09-21
**Status**: Draft (待用户确认)
**Scope**: `frontend/src/components/wizard/CharacterStep.tsx` UI 重构 + `SubTabStrip` 提升到 shared

## 背景

CharacterStep 当前把所有角色作为纵向堆叠的卡片 `<ul>` 渲染在同一个面板里 (6 节内容: 基础信息 / 人格层 / 声音签名 / 当前状态 / 角色不知道的事 / 角色关系),所有字段始终可见,通过滚动浏览。

当角色数量从 6 (默认 batch) 增长到 15+ 时,纵向卡片列表会出现两个问题:
1. 用户需要大量滚动才能在两个角色之间切换
2. 角色越多,顶部 "已生成 N 个角色" 提示越弱

WorldStep 在 2026-09-20 完成了 tab 化改造 (顶层 4 个 tab + 内嵌 sub-tab 条),用 tab strip + panel 替代纵向堆叠。本次改造**复用 WorldStep 的 tab 模式**重做 CharacterStep。

## 目标

- CharacterStep 顶部改为角色 tab 横条 (一个角色一个 tab,标题 = `{name}-{character_type_label}`)
- 每个角色 tab 内 = 固定头部 (姓名/类型/核心/删除) + 二级 sub-tab 条 (5 个: 人格层 / 声音签名 / 当前状态 / 未知 / 关系)
- sub-tab ↻ 保持现有 `SectionRegenerateButton` 行为 (弹 RegenerateModal 让用户输入修改意见)
- Tab strip 右侧 `+` 按钮 → 弹出 AddCharacterMenu → 选类型生成,生成完自动跳到新 tab
- sub-tab per-character 记忆 (从 李玄阳-声音签名 切到 苏晓晓 时停在人格层,再切回 李玄阳 仍停在声音签名)
- 提取 `SubTabStrip` 到 `frontend/src/components/shared/SubTabStrip.tsx`,消除 `WorldStep.tsx` 的 `__testing__` 命名空间

## 非目标

- 不改任何状态管理 / API 调用 / 校验 / 持久化逻辑
- 不改行为例示 (`BehaviorExamplesSection`) 的内部结构,只调整它所在位置到 声音签名 sub-tab 内
- 不改 `CharacterRelationsEditor` 的内部结构 (它继续展示所有角色作为关系目标)
- 不改删除确认弹窗的 UI / 文案 / 行为,只调整删除按钮位置到角色头部
- 不改初次进入时自动生成 6 个角色的行为
- 不引入新的依赖库

## 设计

### 1. 整体布局

```
┌─ CharacterStep ────────────────────────────────────────────────────┐
│ ┌─ 角色 tab strip (sticky top-0) ────────────────────────────────┐ │
│ │ [林峰-主角] [苏晓晓-主角] [师父-导师] [反派1-反派] [反派2-反派] │ │
│ │                          [+ 添加新角色]                       │ │
│ ├───────────────────────────────────────────────────────────────┤ │
│ │ ┌─ CharacterPanel (active) ─────────────────────────────────┐ │ │
│ │ │  姓名 [林峰]  类型[主角▾]  ☐ 核心角色    🗑️                │ │ │ ← 固定头部
│ │ ├─ sub-tab strip ──────────────────────────────────────────┤ │ │
│ │ │ [人格层] [声音签名] [当前状态] [未知] [关系]              │ │ │
│ │ ├──────────────────────────────────────────────────────────┤ │ │
│ │ │  当前 sub-tab 的内容                                     │ │ │
│ │ │  (只渲染 active sub-tab,其他 unmount)                    │ │ │
│ │ └──────────────────────────────────────────────────────────┘ │ │
│ └───────────────────────────────────────────────────────────────┘ │
│ 外层 WorkspaceWizardPanel footer (上一步/保存/下一步/重新生成) 不变│
└────────────────────────────────────────────────────────────────────┘
```

外层 `WorkspaceWizardPanel` 的全局 footer **保持不变**。每个 sub-tab 内的 ↻ `SectionRegenerateButton` 也保持不变 (弹 RegenerateModal)。

### 2. 文件结构

| 文件 | 改动 |
|---|---|
| `frontend/src/components/shared/SubTabStrip.tsx` | **新建**,从 `WorldStep.tsx` 完整搬过来改为命名 export |
| `frontend/src/components/wizard/WorldStep.tsx` | 删除 file-internal `SubTabStrip` + `__testing__` 命名空间,改 import shared |
| `frontend/src/test/SubTabStrip.test.tsx` | 把 `import { __testing__ } from "../components/wizard/WorldStep"` 改为 `import { SubTabStrip } from "../components/shared/SubTabStrip"`,调用点从 `<__testing__.SubTabStrip>` 改为 `<SubTabStrip>` |
| `frontend/src/components/shared/AddCharacterMenu.tsx` | **新建**,4 个角色类型选项的 popover |
| `frontend/src/components/wizard/CharacterStep.tsx` | **大改**,主组件拆分为 file-internal 子组件 |
| `frontend/src/test/CharacterStep.test.tsx` | 更新 testid 选择器,添加 tab 切换 / per-character sub-tab 记忆 / + 菜单测试 |
| `frontend/src/test/CharacterStep.inline_edit.test.tsx` | 同步 testid |
| `frontend/src/test/CharacterStep.edit_delete.test.tsx` | 同步 testid |
| `frontend/src/test/CharacterStep.behavior_examples.test.tsx` | 同步 testid (behavior_examples 现在在 声音签名 sub-tab 内) |
| `frontend/src/test/CharacterEditor.workspace.test.tsx` | 检查是否受影响 (独立路径,可能不动) |

### 3. CharacterStep 内部组件分解

全部 file-internal,跟 WorldStep 一致 (避免污染模块 API surface):

```ts
CharacterStep                    // 主组件 (状态机 + handlers)
├── CharacterTabs               // 角色 tab strip + + 按钮 + AddCharacterMenu
└── CharacterPanel              // 单个角色的内容区
    ├── CharacterHeader         // 固定头部 (姓名/类型/核心/删除)
    └── SubTabStrip (from shared)
        ├── PersonalitySection  // 当前 active sub-tab 的内容
        ├── VoiceSection        // (含 BehaviorExamplesSection)
        ├── CurrentStateSection
        ├── UnknownSection
        └── RelationsSection    // (CharacterRelationsEditor 在这)
```

**职责划分:**
- `CharacterStep`: 状态机 + handlers (复用现有所有 handlers,新增 3 个 state setter 调用)
- `CharacterTabs`: 渲染 N 个 tab + + 按钮 + 触发 `AddCharacterMenu`,键盘 ← → 切换
- `CharacterPanel`: 头部 + sub-tabs + 当前 active sub-tab 内容
- `CharacterHeader`: 姓名 / 类型 / 核心 / 删除 (直接复用现有 input/select/checkbox/button)
- `PersonalitySection` / `VoiceSection` / ...: 各 sub-tab 的纯展示组件,从 `CharacterPanel` 接收当前 `character` 和所有需要的 handlers 作 props

### 4. State 模型

主组件 `CharacterStep` 持有:

| State | 类型 | 用途 |
|---|---|---|
| `characters` | `CharacterSet \| null` | 角色列表 (本地编辑态) |
| `busy` | `boolean` | 任意 API 调用进行中 |
| `activeCharacterId` | `string \| null` | 当前激活的角色 tab ID |
| `characterSubTab` | `Record<string, string>` | 每角色 ID → 当前 sub-tab key (per-character 记忆) |
| `deletingId` | `string \| null` | 删除确认弹窗显隐 |
| `showRegenerateModal` | `boolean` | 全角色「重新生成」弹窗 |
| `regenerateExamplesId` | `string \| null` | 行为例示重新生成弹窗 |
| `regenerateExamplesName` | `string` | 行为例示弹窗标题用 |
| `regeneratingExamplesIds` | `Set<string>` | 行为例示 API in-flight 标记 |
| `addMenuOpen` | `boolean` | + 按钮弹出的 AddCharacterMenu 显隐 |

**新增 useEffect: activeCharacterId 回退**

```ts
useEffect(() => {
  if (!characters || characters.characters.length === 0) {
    if (activeCharacterId !== null) setActiveCharacterId(null);
    return;
  }
  const stillExists = characters.characters.some(c => c.id === activeCharacterId);
  if (!stillExists) {
    setActiveCharacterId(characters.characters[0].id);
  }
  // 初次进入时 activeCharacterId 是 null → 上述 some() 返回 false → 切到第一个
}, [characters]);
```

**派生量:**
- `activeCharacter`: 派生自 `characters?.characters.find(c => c.id === activeCharacterId)` (回退后非 null)
- `tabList`: 派生自 `characters?.characters ?? []` → 映射为 `{id, label, typeLabel}`
- `activeSubTabKey`: 派生自 `characterSubTab[activeCharacterId] || "personality"`

### 5. 角色 tab strip

```tsx
<div role="tablist" data-testid="character-tabs" className="sticky top-0 z-10 -mx-6 px-6 bg-surface-container-low/95 backdrop-blur-sm flex gap-1 border-b border-outline-variant overflow-x-auto">
  {characters.map(c => {
    const typeLabel = CHARACTER_TYPES.find(t => t.value === c.character_type)?.label ?? "其他";
    const name = (c.name || "").trim() || `未命名 ${index + 1}`;
    const isActive = c.id === activeCharacterId;
    return (
      <button
        key={c.id}
        role="tab"
        aria-selected={isActive}
        aria-controls={`character-panel-${c.id}`}
        data-testid={`character-tab-${c.id}`}
        onClick={() => setActiveCharacterId(c.id)}
        onKeyDown={handleTabKeyDown}
        className={`shrink-0 px-3 py-2 text-sm font-display font-medium inline-flex items-center border-b-2 -mb-px gap-1 transition-colors outline-none focus-visible:ring-2 ring-primary-container ${
          isActive ? "border-primary text-primary" : "border-transparent text-on-surface-variant hover:text-primary"
        }`}
      >
        <span>{name}</span>
        <span className="text-on-surface-variant/60 text-xs">-</span>
        <span className="text-xs">{typeLabel}</span>
      </button>
    );
  })}
  {/* + 添加新角色 */}
  <div className="relative">
    <button
      data-testid="character-tab-add"
      onClick={() => setAddMenuOpen(v => !v)}
      aria-label="添加新角色"
      aria-expanded={addMenuOpen}
      className="shrink-0 px-2 py-2 text-sm border-b-2 -mb-px border-transparent text-on-surface-variant hover:text-primary transition-colors"
    >
      <span aria-hidden="true" className="material-symbols-outlined text-base leading-none">add</span>
    </button>
    {addMenuOpen && (
      <AddCharacterMenu
        onPick={handleAddOne}
        onClose={() => setAddMenuOpen(false)}
        disabled={busy}
      />
    )}
  </div>
</div>
```

**键盘 ← →:** 复用 WorldStep 的 `handleTabKeyDown` 模式 (queueMicrotask 等 React 提交 DOM 后 focus 新 tab)。

### 6. tab 标题格式

格式: `{name}-{typeLabel}`

| name | character_type | 显示 |
|---|---|---|
| `"林峰"` | `protagonist` | `林峰-主角` |
| `""` (空) | `protagonist` | `未命名 1-主角` (index = 在列表里的位置 + 1) |
| `"苏晓晓"` | `supporting` | `苏晓晓-配角` |
| `" "` (空白) | `antagonist` | `未命名 3-反派` |

实现:
```ts
const getTabLabel = (c: Character, index: number): string => {
  const typeLabel = CHARACTER_TYPES.find(t => t.value === c.character_type)?.label ?? "其他";
  const name = (c.name ?? "").trim() || `未命名 ${index + 1}`;
  return `${name}-${typeLabel}`;
};
```

### 7. + 按钮 → AddCharacterMenu 流程

**`AddCharacterMenu` 组件** (`shared/AddCharacterMenu.tsx`):

```tsx
interface AddCharacterMenuProps {
  onPick: (type: Character["character_type"]) => void;
  onClose: () => void;
  disabled?: boolean;
}

export function AddCharacterMenu({ onPick, onClose, disabled }: AddCharacterMenuProps) {
  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden="true" />
      <div
        data-testid="character-add-menu"
        role="menu"
        className="absolute right-0 top-full mt-1 z-50 bg-surface-container-high border border-outline-variant rounded-lg shadow-lg py-1 min-w-[120px]"
      >
        {CHARACTER_TYPES.map(({ value, label }) => (
          <button
            key={value}
            data-testid={`character-add-${value}`}
            role="menuitem"
            onClick={() => onPick(value)}
            disabled={disabled}
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-surface-container disabled:opacity-40"
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}
```

**`handleAddOne` 重构 (自动跳到新角色):**

```ts
const handleAddOne = async (type: Character["character_type"]) => {
  setAddMenuOpen(false);
  setBusy(true);
  try {
    const result = await api.generateCharacter(projectId, type);
    const fresh = pickNewlyCreated(result);
    if (!fresh) throw new Error("生成结果为空");
    setCharacters(prev => {
      const existing = prev?.characters ?? [];
      const current = prev?.current ?? fresh;
      return { characters: [...existing, fresh], current };
    });
    // 自动跳到新角色
    setActiveCharacterId(fresh.id);
  } catch (e) {
    wizard.setStatus("error", e instanceof Error ? e.message : "角色添加失败");
  } finally {
    setBusy(false);
  }
};
```

### 8. CharacterPanel 结构

```tsx
function CharacterPanel({ character, busy, ...handlers }: CharacterPanelProps) {
  const personality = character.personality ?? { beliefs: [], ... };
  const voice = character.voice_signature ?? { speech_style: "", ... };
  const state = character.current_state ?? { location: "", ... };

  return (
    <div data-testid={`character-panel-${character.id}`} className="space-y-3 pt-3">
      {/* 固定头部 */}
      <CharacterHeader character={character} busy={busy} onUpdate={...} onDelete={...} />

      {/* 二级 sub-tab */}
      <SubTabStrip
        tabs={SUB_TABS}
        active={activeSubTabKey}
        onChange={handleSubTabChange}
        testidPrefix="character-subtab"
      />

      {/* 只渲染当前 active sub-tab (其他 unmount,节省性能) */}
      {activeSubTabKey === "personality" && (
        <PersonalitySection character={character} personality={personality} ... />
      )}
      {activeSubTabKey === "voice_signature" && (
        <VoiceSection character={character} voice={voice} ... />
      )}
      {activeSubTabKey === "current_state" && (
        <CurrentStateSection character={character} state={state} ... />
      )}
      {activeSubTabKey === "unknown" && (
        <UnknownSection character={character} ... />
      )}
      {activeSubTabKey === "relations" && (
        <RelationsSection character={character} ... />
      )}
    </div>
  );
}
```

**5 个 Section 组件:** 把现有 `<li>` 内的 5 段内容 (`{c.id}-personality` / `{c.id}-voice` / `{c.id}-current-state` / `{c.id}-unknown` / `{c.id}-relations`) 拆出来,各自接收 character + 所需 handlers 作 props,**保持现有 testid 不变**。

### 9. testid 规划

**保留不变 (向后兼容现有测试):**

| testid | 用途 |
|---|---|
| `character-step` | 顶层容器 |
| `character-form` | 顶层表单容器 |
| `character-{id}-name` | 头部姓名 input |
| `character-{id}-type` | 头部类型 select |
| `character-{id}-core` | 头部核心角色 checkbox |
| `character-delete-{id}` | 头部删除按钮 |
| `character-{id}-personality` | 人格层 sub-tab 内容容器 |
| `character-{id}-personality-regenerate` | 人格层 ↻ |
| `character-{id}-voice` | 声音签名 sub-tab 内容容器 |
| `character-{id}-voice-regenerate` | 声音签名 ↻ |
| `character-{id}-speech-style` | 说话风格 textarea |
| `character-{id}-thought-patterns` | 思维模式 textarea |
| `character-{id}-current-state-regenerate` | 当前状态 ↻ |
| `character-{id}-location` | 位置 input |
| `character-{id}-physical-condition` | 身体状况 input |
| `character-{id}-emotional` | 情绪 input |
| `character-{id}-unknown-regenerate` | 未知 ↻ |
| `character-{id}-relations` | 关系 sub-tab 内容容器 |
| `character-{id}-relations-regenerate` | 关系 ↻ |
| `character-add-{type}` | AddCharacterMenu 4 个选项 |
| `delete-confirm-modal` | 删除确认弹窗 |
| `delete-cancel-button` | 删除取消 |
| `delete-confirm-button` | 删除确认 |

**新增:**

| testid | 用途 |
|---|---|
| `character-tabs` | 角色 tab strip 容器 |
| `character-tab-{id}` | 单个角色 tab |
| `character-tab-add` | Tab strip 右侧 + 按钮 |
| `character-add-menu` | AddCharacterMenu popover 容器 |
| `character-panel-{id}` | 单个角色内容区 |
| `character-subtabs` | sub-tab strip 容器 |
| `character-subtab-{key}` | 单个 sub-tab (5 个) |

**删除:**
- `character-list` (顶层 `<ul>` 改成 tab strip,语义不再适用)

**现有测试需要更新:**
- 所有 `screen.getByTestId("character-list")` 改为不查这个 (改成查 `character-tabs` 替代)
- 所有 `character-list > li` selector 改为 `character-panel-{id}`
- 现有针对单个角色的断言保持不变

### 10. SubTabStrip 提取到 shared

**改动:**
- 新建 `frontend/src/components/shared/SubTabStrip.tsx`,代码完全照搬 `WorldStep.tsx` 当前 file-internal 版本,只是 `export function SubTabStrip(...)` 而不是 file-internal
- `WorldStep.tsx`:
  - 删除 file-internal `SubTabStrip` 函数 (lines 1258-1300)
  - 删除 `export const __testing__ = { SubTabStrip }` (lines 1302-1305)
  - 顶部 `import` 添加 `import { SubTabStrip } from "../shared/SubTabStrip"`
  - `WorldStep.tsx` 内部对 SubTabStrip 的 4 处调用 (lines 636, 747, 1015, 1151) 不变

**测试改动:**
- `frontend/src/test/SubTabStrip.test.tsx` 第 3 行:
  ```diff
  - import { __testing__ } from "../components/wizard/WorldStep";
  + import { SubTabStrip } from "../components/shared/SubTabStrip";
  ```
- 5 处 `<__testing__.SubTabStrip ...>` 改为 `<SubTabStrip ...>`

### 11. 风险与回归

| 风险 | 缓解 |
|---|---|
| 4 个现有测试文件里的 `character-list` / `character-list > li` selector 失效 | Task 3 末跑全量测试,逐文件替换 selector |
| 删除角色时 `activeCharacterId` 指向已删除 ID → render crash | Section 4 的 useEffect 回退逻辑必须落到测试 (新加 1 个测试) |
| `characters.current` 字段与 tab active 概念混淆 | 现有 `characters.current` 字段保留 (跟 wizard.data 兼容),tab active 独立维护 `activeCharacterId` |
| 初次进入时 activeCharacterId 是 null → 渲染空 panel | useEffect 首次执行时切到第一个角色 |
| BehaviorExamplesSection 行为例示 ↻ (regenerateExamplesId) 跨角色 ID 错乱 | 现有逻辑已 capture 角色名 + ID 时机,行为不变 |
| Sub-tab 切换时面板内容 unmount/remount → 编辑中的 input 失焦 | 接受此 trade-off: 编辑中的内容已 commit 到 React state,切回来值还在;若用户测试发现反馈问题再改为全部 hidden 模式 |
| 5 个 sub-panel 同时挂载性能负担 | 只渲染 active sub-tab (Section 8) |
| `WorldStep.subtabs.test.tsx` 依赖 WorldStep 的 `__testing__.SubTabStrip` | 已确认: 依赖只在 `SubTabStrip.test.tsx` 一个文件,改动可控 |

### 12. Task 拆分

按依赖顺序 3 个 task:

**Task 1: 提取 SubTabStrip 到 shared/** (独立)
- 新建 `frontend/src/components/shared/SubTabStrip.tsx`
- WorldStep.tsx 删除 file-internal 版本 + `__testing__` 命名空间
- 更新 `SubTabStrip.test.tsx` import
- 跑 vitest 确认 WorldStep 测试零回归

**Task 2: 新建 AddCharacterMenu 组件 + 单元测试** (独立)
- 新建 `frontend/src/components/shared/AddCharacterMenu.tsx`
- 新建 `frontend/src/test/AddCharacterMenu.test.tsx`: 点击选项触发 onPick / 点空白关闭 / ESC 关闭 / disabled 状态

**Task 3: CharacterStep 重构为 tab 布局** (大改,依赖 Task 1)
- 拆分主组件为 file-internal 子组件 (CharacterTabs / CharacterPanel / CharacterHeader / 5 个 Section)
- 引入新 state (activeCharacterId / characterSubTab / addMenuOpen) 和 useEffect
- 重构 handlers (handleAddOne 自动跳)
- 替换 JSX: linear `<ul>` → tab strip + panel
- 更新所有现有 CharacterStep 测试 (testid selector 调整、新加 tab 切换 / per-character sub-tab 记忆 / + 菜单 / 自动跳转测试)

每 task 跑 vitest 全量 + tsc 检查。
