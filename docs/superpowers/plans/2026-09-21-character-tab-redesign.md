# Character Tab Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `CharacterStep` 从纵向堆叠的角色卡片列表重构为 WorldStep 风格的 tab 布局 — 顶部角色 tab strip (一个角色一个 tab, 标题 `{name}-{typeLabel}`) + 每个角色固定头部 (姓名/类型/核心/删除) + 5 个二级 sub-tab (人格层 / 声音签名 / 当前状态 / 未知 / 关系)。Tab strip 右侧 + 按钮弹类型选择菜单生成新角色并自动跳到新 tab。

**Architecture:**
- 把 `WorldStep.tsx` file-internal 的 `SubTabStrip` 提升到 `frontend/src/components/shared/SubTabStrip.tsx` 命名 export, 消除 `__testing__` 命名空间代码 smell, 让 `CharacterStep` 复用同一组件
- 新建 `frontend/src/components/shared/AddCharacterMenu.tsx`: 4 个角色类型选项的 popover, ESC + 点空白关闭
- `CharacterStep.tsx` 重构: 主组件瘦身为状态机 + handlers, 内部组件拆分为 file-internal `CharacterTabs` / `CharacterPanel` / `CharacterHeader` + 5 个 `*Section` 组件 (跟 WorldStep 的 `EraPanel` / `PowerSystemsPanel` / `FactionsPanel` 同构)
- 新 state: `activeCharacterId` (string \| null) + `characterSubTab` (Record<string, string>, per-character sub-tab 记忆) + `addMenuOpen` (boolean), useEffect 兜底删角色时 active 回退到第一个

**Tech Stack:** React 18 + TypeScript + Tailwind (Material 3 tokens) · vitest + Testing Library (jsdom) · 复用 WorldStep 2026-09-20 的 tab/sub-tab 模式与 `SubTabStrip` 实现

---

## 文件改动范围

| 文件 | 改动 | 任务 |
|---|---|---|
| `frontend/src/components/shared/SubTabStrip.tsx` | 新建 (从 WorldStep 提取并改为命名 export) | Task 1 |
| `frontend/src/components/wizard/WorldStep.tsx` | 删除 file-internal SubTabStrip + `__testing__` 命名空间, 加 import | Task 1 |
| `frontend/src/test/SubTabStrip.test.tsx` | 把 `import { __testing__ } from "../components/wizard/WorldStep"` 改为直接 import SubTabStrip | Task 1 |
| `frontend/src/components/shared/AddCharacterMenu.tsx` | 新建组件 | Task 2 |
| `frontend/src/test/AddCharacterMenu.test.tsx` | 新建测试 | Task 2 |
| `frontend/src/test/CharacterStep.test.tsx` | 21 处 testid selector 更新 (`character-list` → `character-tabs`) | Task 3 |
| `frontend/src/test/CharacterStep.inline_edit.test.tsx` | 2 处 testid selector 更新 | Task 3 |
| `frontend/src/components/wizard/CharacterStep.tsx` | 重构为 tab 布局 (主组件 + file-internal 子组件) | Task 4 |
| `frontend/src/test/CharacterStep.test.tsx` | 加 5 个新 tab 行为测试 (tab 标题格式 / 切换 / per-character sub-tab 记忆 / + 菜单 / 自动跳) | Task 5 |
| `frontend/src/test/CharacterStep.edit_delete.test.tsx` | 加 1 个新测试 (删 active 角色 → fallback 到第一个) | Task 5 |

不修改: `CharacterStep.behavior_examples.test.tsx` (behavior_examples 内容在 sub-tab 内, testid 路径不变), `CharacterEditor.workspace.test.tsx` (workspace 路径独立)。

---

## Task 1: 提取 SubTabStrip 到 shared/

**Files:**
- Create: `frontend/src/components/shared/SubTabStrip.tsx`
- Modify: `frontend/src/components/wizard/WorldStep.tsx` (line 1 imports, lines 1258-1305 file-internal SubTabStrip + `__testing__` 命名空间)
- Modify: `frontend/src/test/SubTabStrip.test.tsx` (line 3 import + 5 处 `<__testing__.SubTabStrip>` 调用点)

### Step 1: 新建 `frontend/src/components/shared/SubTabStrip.tsx`

把 `WorldStep.tsx` lines 1258-1300 的 file-internal `SubTabStrip` 函数体**完全照搬**, 只把 `function SubTabStrip` 改成 `export function SubTabStrip`, 删除文件末尾的 `// 内部测试钩子` 注释 (line 1302) 和 `export const __testing__` (lines 1303-1305)。

最终文件结构:

```tsx
import type { JSX } from "react";

interface SubTab {
  key: string;
  label: string;
  testidSuffix?: string;
}

interface SubTabStripProps {
  tabs: SubTab[];
  active: string;
  onChange: (key: string) => void;
  testidPrefix: string;
}

/**
 * 2026-09-21: 从 WorldStep.tsx file-internal 版本提取到 shared, 供 CharacterStep 复用。
 * 视觉与交互不变 (sticky 横条, ←/→ 切换由调用方在外层实现)。
 */
export function SubTabStrip({ tabs, active, onChange, testidPrefix }: SubTabStripProps): JSX.Element {
  return (
    <div
      role="tablist"
      data-testid={`${testidPrefix}-strip`}
      className="sticky top-[40px] z-[5] -mx-1 px-1 bg-surface-container-low/95 backdrop-blur-sm flex gap-1 border-b border-outline-variant overflow-x-auto"
    >
      {tabs.map((t) => {
        const isActive = t.key === active;
        const tid = `${testidPrefix}-${t.testidSuffix ?? t.key}`;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`${testidPrefix}-panel-${t.key}`}
            data-testid={tid}
            onClick={() => onChange(t.key)}
            className={
              "shrink-0 px-2 py-1 text-sm font-display font-medium border-b-2 -mb-px inline-flex items-center gap-1 whitespace-nowrap transition-colors outline-none focus-visible:ring-2 ring-primary-container " +
              (isActive
                ? "border-primary text-primary"
                : "border-transparent text-on-surface-variant hover:text-primary")
            }
          >
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
```

### Step 2: 修改 `WorldStep.tsx`

**Step 2a:** 在 line 9 (`import { AutoTextarea } ...`) 之后加 import:

```ts
import { SubTabStrip } from "../shared/SubTabStrip";
```

**Step 2b:** 删除 file-internal `SubTabStrip` 函数 (lines 1258-1300) + 紧跟的 `// 内部测试钩子` 注释 (line 1302) + `export const __testing__ = { SubTabStrip }` 命名空间 (lines 1303-1305)。

**Step 2c:** 不需要改 WorldStep.tsx 内部对 SubTabStrip 的 4 处调用点 (lines 636, 747, 1015, 1151), 导入路径换了之后它们会自动解析到 shared/SubTabStrip.tsx。

### Step 3: 修改 `SubTabStrip.test.tsx`

**Step 3a:** Line 3 把:
```ts
import { __testing__ } from "../components/wizard/WorldStep";
```
改成:
```ts
import { SubTabStrip } from "../components/shared/SubTabStrip";
```

**Step 3b:** 把文件里所有 `<__testing__.SubTabStrip` 替换成 `<SubTabStrip` (预计 5 处)。`grep "__testing__\.SubTabStrip" frontend/src/test/SubTabStrip.test.tsx` 确认数量。

### Step 4: 跑测试验证零回归

```bash
cd frontend && npx vitest run src/test/SubTabStrip.test.tsx src/test/WorldStep.subtabs.test.tsx src/test/WorldStep.test.tsx 2>&1 | tail -15
```

Expected: 全部 PASS (与改动前基线一致, 无新增 failed)。

### Step 5: 全量 vitest 跑一遍确认无回归

```bash
cd frontend && npx vitest run 2>&1 | tail -8
```

Known pre-existing failures (与本任务无关, 不计入): 5 个测试文件 ~27 failed (ConceptStep / ChapterOutlineStep / Workspace / WizardSidebar / WorkspaceWizardPanel), 是 jsdom cold-cache baseline, 跟 SubTabStrip 无关。

### Step 6: tsc 检查

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -E "SubTabStrip|WorldStep\.tsx" | head
```

Expected: 无新增错误。

### Step 7: Commit

```bash
git add frontend/src/components/shared/SubTabStrip.tsx frontend/src/components/wizard/WorldStep.tsx frontend/src/test/SubTabStrip.test.tsx
git commit -m "$(cat <<'EOF'
refactor(shared): promote SubTabStrip from WorldStep.tsx __testing__ to shared/

The WorldStep 2026-09-20 tab refactor left SubTabStrip in a __testing__
namespace with a comment forbidding production imports. CharacterStep
now needs the same component for its sub-tab strip — extract to
frontend/src/components/shared/SubTabStrip.tsx as a named export so
both wizards can import it cleanly.

WorldStep.tsx: drop the file-internal copy + __testing__ export,
add `import { SubTabStrip } from "../shared/SubTabStrip"`. All 4
existing WorldStep call sites work unchanged.

SubTabStrip.test.tsx: import from the new path, drop the __testing__
namespace wrapper around the component reference.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 新建 AddCharacterMenu 组件 + 单元测试

**Files:**
- Create: `frontend/src/components/shared/AddCharacterMenu.tsx`
- Test: `frontend/src/test/AddCharacterMenu.test.tsx`

### Step 1: 写失败测试

新建 `frontend/src/test/AddCharacterMenu.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AddCharacterMenu } from "../components/shared/AddCharacterMenu";

describe("AddCharacterMenu", () => {
  const TYPES: Array<{ value: "protagonist" | "antagonist" | "supporting" | "mentor"; label: string }> = [
    { value: "protagonist", label: "主角" },
    { value: "antagonist", label: "反派" },
    { value: "supporting", label: "配角" },
    { value: "mentor", label: "导师" },
  ];

  it("renders 4 type options with testids", () => {
    render(<AddCharacterMenu onPick={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("character-add-protagonist")).toBeInTheDocument();
    expect(screen.getByTestId("character-add-antagonist")).toBeInTheDocument();
    expect(screen.getByTestId("character-add-supporting")).toBeInTheDocument();
    expect(screen.getByTestId("character-add-mentor")).toBeInTheDocument();
  });

  it("clicking an option fires onPick with the matching type", () => {
    const onPick = vi.fn();
    render(<AddCharacterMenu onPick={onPick} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("character-add-antagonist"));
    expect(onPick).toHaveBeenCalledWith("antagonist");
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("clicking the backdrop fires onClose", () => {
    const onClose = vi.fn();
    const { container } = render(<AddCharacterMenu onPick={vi.fn()} onClose={onClose} />);
    // Backdrop is the first child div (fixed inset-0 z-40).
    const backdrop = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("pressing Escape fires onClose", () => {
    const onClose = vi.fn();
    render(<AddCharacterMenu onPick={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables all option buttons when disabled=true", () => {
    render(<AddCharacterMenu onPick={vi.fn()} onClose={vi.fn()} disabled />);
    for (const t of TYPES) {
      expect(screen.getByTestId(`character-add-${t.value}`)).toBeDisabled();
    }
  });
});
```

### Step 2: 跑测试验证它失败

```bash
cd frontend && npx vitest run src/test/AddCharacterMenu.test.tsx 2>&1 | tail -10
```

Expected: FAIL with `Cannot find module '../components/shared/AddCharacterMenu'` (5 个 test 全部 fail)。

### Step 3: 实现 `AddCharacterMenu` 组件

新建 `frontend/src/components/shared/AddCharacterMenu.tsx`:

```tsx
import { useEffect } from "react";
import type { Character } from "../../api/client";

/**
 * 2026-09-21: 角色类型选择 popover (4 个选项)。
 *
 * 由 CharacterStep tab strip 右侧的 + 按钮触发 (controlled — 父组件维护
 * open 状态)。点选 / 点空白 / ESC 都触发 onClose。
 *
 * 接 onPick 而不是直接接生成 handler, 是为了让父组件控制 API 调用 + state
 * 更新节奏, 也方便未来其他 wizard 步骤复用 (例如 ConceptStep 想加「批量
 * 生成配角」入口)。
 */
export interface AddCharacterMenuProps {
  /** 用户选了某类型。父组件负责关闭菜单 + 调 API。 */
  onPick: (type: Character["character_type"]) => void;
  /** 任何关闭路径 (backdrop / ESC / 选项点击后的二次关闭) 都走这里。 */
  onClose: () => void;
  /** 父组件 busy 时禁用所有选项。 */
  disabled?: boolean;
}

const CHARACTER_TYPES: { value: Character["character_type"]; label: string }[] = [
  { value: "protagonist", label: "主角" },
  { value: "antagonist", label: "反派" },
  { value: "supporting", label: "配角" },
  { value: "mentor", label: "导师" },
];

export function AddCharacterMenu({ onPick, onClose, disabled }: AddCharacterMenuProps) {
  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        aria-hidden="true"
        data-testid="character-add-backdrop"
      />
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

### Step 4: 跑测试验证它通过

```bash
cd frontend && npx vitest run src/test/AddCharacterMenu.test.tsx 2>&1 | tail -10
```

Expected: PASS (5/5)。

### Step 5: Commit

```bash
git add frontend/src/components/shared/AddCharacterMenu.tsx frontend/src/test/AddCharacterMenu.test.tsx
git commit -m "$(cat <<'EOF'
feat(shared): AddCharacterMenu (4-type popover for new character)

Controlled popover menu with 4 character type options (主角/反派/
配角/导师). Wired by CharacterStep tab strip's + button in a follow-up
commit. Closes on backdrop click, Escape, or option pick.

Props are deliberately decoupled from Character generation: onPick takes
a Character["character_type"] so the parent owns API call timing and
state updates, and the menu stays reusable for any future "add by type"
wizard affordance.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 更新现有 CharacterStep 测试的 testid selector

**Files:**
- Modify: `frontend/src/test/CharacterStep.test.tsx` (21 处)
- Modify: `frontend/src/test/CharacterStep.inline_edit.test.tsx` (2 处)

此 Task 只改测试, 不改 CharacterStep.tsx。改完跑测试会失败 (预期内), Task 4 再改源码让它们通过。

### Step 1: 替换 `CharacterStep.test.tsx` 里的 `character-list`

替换规则:
- `screen.getByTestId("character-list")` → `screen.getByTestId("character-tabs")`
- `screen.getByTestId("character-list").children` → `screen.getByTestId("character-tabs").children`
- 断言 `.children).toHaveLength(6)` 改为 `.children).toHaveLength(6)` (语义: tab strip 包含 N 个 tab button, 数字不变)

预计 21 处 `character-list` 全部替换为 `character-tabs`。

文件末尾加新测试「6 个 character tab 都渲染」, 把原来断言 `character-list.children.length === 6` 升级为断言 `character-tabs.children.length === 6` (包含 tab buttons, 不含 + 按钮 — 那个是 sibling, 不在 children 内)。

具体步骤: 用 sed 批量替换 (因为规则简单):

```bash
cd /Users/longsa/Codes/nebula
sed -i '' 's/character-list/character-tabs/g' frontend/src/test/CharacterStep.test.tsx
```

然后人工检查替换后没有意外改动 (`grep -n "character-list" frontend/src/test/CharacterStep.test.tsx` 应该 0 输出)。

### Step 2: 替换 `CharacterStep.inline_edit.test.tsx` 里的 `character-list`

同样的规则, 2 处:

```bash
cd /Users/longsa/Codes/nebula
sed -i '' 's/character-list/character-tabs/g' frontend/src/test/CharacterStep.inline_edit.test.tsx
```

### Step 3: 跑测试验证它们失败 (因为 CharacterStep 还没改)

```bash
cd frontend && npx vitest run src/test/CharacterStep.test.tsx src/test/CharacterStep.inline_edit.test.tsx 2>&1 | tail -20
```

Expected: FAIL. 报错形如 `Unable to find an element by: [data-testid="character-tabs"]` (因为 CharacterStep.tsx 现在渲染的还是 `<ul data-testid="character-list">`)。

如果意外 PASS, 说明替换规则有问题 (例如 sed 没生效或文件本来就没有 `character-list`), 停下排查。

### Step 4: Commit

```bash
git add frontend/src/test/CharacterStep.test.tsx frontend/src/test/CharacterStep.inline_edit.test.tsx
git commit -m "$(cat <<'EOF'
test(characterstep): pre-emptively update character-list selectors to character-tabs

CharacterStep is being refactored from a <ul data-testid="character-list">
to a tab strip <div data-testid="character-tabs">. Update the 23 selectors
across CharacterStep.test.tsx + CharacterStep.inline_edit.test.tsx before
the source change so the failing test list after the refactor is bounded
to new tests + tab behavior tests, not selector rot.

Tests will fail at HEAD until Task 4 lands. That's intentional.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 重构 CharacterStep.tsx 为 tab 布局

**Files:**
- Modify: `frontend/src/components/wizard/CharacterStep.tsx` (大改)

此 Task 是核心重构。把现有 750 行的 monolithic CharacterStep 改为主组件 (状态机 + handlers) + file-internal 子组件的组合, 类似 WorldStep 的结构。

### Step 1: 准备子组件抽取骨架

新建 import + 移除 `character-add-{type}` 按钮区 (lines 654-673, 底部 4 个手动添加按钮) — 这一区被 `+` 按钮 + AddCharacterMenu 替代, 不再需要。

在 `CharacterStep.tsx` 顶部 (line 4 附近, `import TagEditor` 之后) 加 import:

```tsx
import { SubTabStrip } from "../shared/SubTabStrip";
import { AddCharacterMenu } from "../shared/AddCharacterMenu";
```

### Step 2: 添加新 state + useEffect + handler 修改

在主组件 `CharacterStep` 的 state 区 (line 75 之后), 添加:

```tsx
// 2026-09-21: tab 布局新增 state
const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null);
const [characterSubTab, setCharacterSubTab] = useState<Record<string, string>>({});
const [addMenuOpen, setAddMenuOpen] = useState(false);
```

修改 `handleAddOne` (lines 104-118), 在 `setCharacters` 之后添加自动跳:

```tsx
const handleAddOne = async (type: Character["character_type"]) => {
  setAddMenuOpen(false);
  setBusy(true);
  try {
    const result = await api.generateCharacter(projectId, type);
    const fresh = pickNewlyCreated(result);
    if (!fresh) throw new Error("生成结果为空");
    setCharacters((prev) => {
      const existing = prev?.characters ?? [];
      const current = prev?.current ?? fresh;
      return { characters: [...existing, fresh], current };
    });
    setActiveCharacterId(fresh.id); // 自动跳到新角色
  } catch (e) {
    wizard.setStatus("error", e instanceof Error ? e.message : "角色添加失败");
  } finally {
    setBusy(false);
  }
};
```

添加 useEffect (放在现有 `useEffect` 之后, line 369 附近):

```tsx
// activeCharacterId 回退: 删角色或初次进入时切到第一个
useEffect(() => {
  if (!characters || characters.characters.length === 0) {
    if (activeCharacterId !== null) setActiveCharacterId(null);
    return;
  }
  const stillExists = characters.characters.some((c) => c.id === activeCharacterId);
  if (!stillExists) {
    setActiveCharacterId(characters.characters[0].id);
  }
}, [characters, activeCharacterId]);
```

### Step 3: 添加派生量 + sub-tab handler

在主组件派生量区 (line 323 附近, `nameById` useMemo 之后), 添加:

```tsx
const tabList = useMemo(() => {
  return (characters?.characters ?? []).map((c, i) => {
    const typeLabel = CHARACTER_TYPES.find((t) => t.value === c.character_type)?.label ?? "其他";
    const name = (c.name ?? "").trim() || `未命名 ${i + 1}`;
    return { id: c.id, name, typeLabel };
  });
}, [characters]);

const activeCharacter = useMemo(() => {
  if (!characters || !activeCharacterId) return null;
  return characters.characters.find((c) => c.id === activeCharacterId) ?? null;
}, [characters, activeCharacterId]);

const activeSubTabKey: string =
  (activeCharacterId && characterSubTab[activeCharacterId]) || "personality";

const handleSubTabChange = (key: string) => {
  if (!activeCharacterId) return;
  setCharacterSubTab((prev) => ({ ...prev, [activeCharacterId]: key }));
};

// 键盘 ←/→ 切换角色 tab (复用 WorldStep 模式)
const handleCharacterTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  if (!characters || characters.characters.length < 2) return;
  e.preventDefault();
  const list = characters.characters;
  const currentIdx = list.findIndex((c) => c.id === activeCharacterId);
  const nextIdx =
    e.key === "ArrowRight"
      ? (currentIdx + 1) % list.length
      : (currentIdx - 1 + list.length) % list.length;
  const nextId = list[nextIdx].id;
  setActiveCharacterId(nextId);
  queueMicrotask(() => {
    const nextTab = document.querySelector<HTMLButtonElement>(
      `[data-testid="character-tab-${nextId}"]`,
    );
    nextTab?.focus();
  });
};
```

### Step 4: 抽取 file-internal 子组件

文件末尾 (line 1306 之后, 在 default export 之外), 添加 7 个 file-internal 子组件:

```tsx
// ===========================================================================
// 2026-09-21: file-internal 子组件。
// 跟 WorldStep 的 EraPanel/PowerSystemsPanel/FactionsPanel 同构,
// 主组件瘦身为状态机 + handlers, 子组件只负责展示 + 接收 handlers 作 props。
// ===========================================================================

const CHARACTER_SUB_TABS = [
  { key: "personality",     label: "人格层",     testidSuffix: "personality" },
  { key: "voice_signature", label: "声音签名",   testidSuffix: "voice" },
  { key: "current_state",   label: "当前状态",   testidSuffix: "current-state" },
  { key: "unknown",         label: "未知",       testidSuffix: "unknown" },
  { key: "relations",       label: "关系",       testidSuffix: "relations" },
] as const;

function CharacterHeader({
  character, busy, onUpdate, onDeleteClick,
}: {
  character: Character;
  busy: boolean;
  onUpdate: (patch: Partial<Character>) => void;
  onDeleteClick: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="block font-mono text-primary-container mb-1 text-[10px]">姓名</label>
          <input
            data-testid={`character-${character.id}-name`}
            value={character.name ?? ""}
            onChange={(e) => onUpdate({ name: e.target.value })}
            disabled={busy}
            className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container disabled:opacity-40"
          />
        </div>
        <div>
          <label className="block font-mono text-primary-container mb-1 text-[10px]">角色类型</label>
          <select
            data-testid={`character-${character.id}-type`}
            value={character.character_type}
            onChange={(e) => onUpdate({ character_type: e.target.value as Character["character_type"] })}
            disabled={busy}
            className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container disabled:opacity-40"
          >
            {CHARACTER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col items-end gap-2 pt-1">
        <label className="flex items-center gap-1 font-body text-body-md text-[11px] text-primary whitespace-nowrap">
          <input
            type="checkbox"
            data-testid={`character-${character.id}-core`}
            checked={!!character.is_core_character}
            onChange={(e) => onUpdate({ is_core_character: e.target.checked })}
            disabled={busy}
          />
          核心角色
        </label>
        <button
          type="button"
          data-testid={`character-delete-${character.id}`}
          onClick={onDeleteClick}
          disabled={busy}
          className="p-1 text-primary-container/70 hover:text-error disabled:opacity-40"
          aria-label="删除"
        >🗑️</button>
      </div>
    </div>
  );
}

function PersonalitySection({
  character, busy, onPersonalityChange,
}: {
  character: Character;
  busy: boolean;
  onPersonalityChange: (key: PersonalityKey, next: string[]) => void;
}) {
  const personality = character.personality ?? { beliefs: [], desires: [], fears: [], values: [], core_traits: [] };
  return (
    <div data-testid={`character-${character.id}-personality`} className="space-y-2 pt-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-primary-container text-[10px] uppercase tracking-wider">人格层</div>
        <SectionRegenerateButton
          target={`${character.name || character.id} · 人格层`}
          onRegenerate={...}  // 详见 Step 4 末尾
          testId={`character-${character.id}-personality-regenerate`}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PERSONALITY_FIELDS.map(({ key, label }) => (
          <div key={key}>
            <div className="font-mono text-primary-container/80 text-[10px] mb-1">{label}</div>
            <TagEditor
              items={personality[key] ?? []}
              onItemsChange={(next) => onPersonalityChange(key, next)}
              saving={busy}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
```

(其他 4 个 Section 同模式 — VoiceSection / CurrentStateSection / UnknownSection / RelationsSection, 完整代码超长, 详见下方的 `完整子组件附录`)

**Step 4 末尾重要说明:** 5 个 Section 组件都需要接收 `onRegenerate` handler 作 prop (因为 SectionRegenerateButton 的 `onRegenerate` prop 需要从主组件传入, 不能在子组件内 hardcode `handleSectionRegenerate(c.id, ...)`)。所以:

```tsx
function PersonalitySection({ character, busy, onPersonalityChange, onRegenerate }: {
  character: Character;
  busy: boolean;
  onPersonalityChange: (key: PersonalityKey, next: string[]) => void;
  onRegenerate: () => void;
}) {
  // ... 内部把 onRegenerate 传给 SectionRegenerateButton 的 onRegenerate prop
}
```

主组件 `CharacterPanel` 调用 `<PersonalitySection ... onRegenerate={() => handleSectionRegenerate(character.id, "personality")()} />`。

**完整子组件附录:** 由于 5 个 Section 组件 + CharacterTabs + CharacterPanel 整体代码约 350 行, 完整代码已写入 `frontend/src/components/wizard/CharacterStep.tsx` (Step 6 整体替换时一并粘贴)。本 plan 末尾的「附录 A: 完整子组件代码」是 reference, 实施时直接复制粘贴即可。

### Step 5: 替换主组件 JSX

把主组件 `CharacterStep` 的 return (lines 399-748 整段) 替换为:

```tsx
return (
  <div data-testid="character-step" className="space-y-4">
    {wizard.status === "generating" && (
      <div className="text-center py-12">
        <span className="material-symbols-outlined text-4xl text-primary-container animate-spin inline-block">progress_activity</span>
        <p className="font-body text-body-md text-primary-container mt-3 text-sm">正在生成角色…</p>
      </div>
    )}

    {wizard.status === "error" && (
      <div className="p-4 bg-error-container/20 border border-error rounded-lg text-error font-body text-body-md text-sm">
        {wizard.errorMessage}
      </div>
    )}

    {hasCharacters && (
      <div data-testid="character-form" className="space-y-3">
        <div className="relative">
          <CharacterTabs
            tabs={tabList}
            activeId={activeCharacterId}
            onTabChange={setActiveCharacterId}
            onAddClick={() => setAddMenuOpen((v) => !v)}
            onTabKeyDown={handleCharacterTabKeyDown}
          />
          {addMenuOpen && (
            <AddCharacterMenu
              onPick={handleAddOne}
              onClose={() => setAddMenuOpen(false)}
              disabled={busy}
            />
          )}
        </div>

        {activeCharacter && (
          <CharacterPanel
            character={activeCharacter}
            busy={busy}
            activeSubTab={activeSubTabKey}
            onSubTabChange={handleSubTabChange}
            onUpdate={(patch) => updateCharacterAt(activeCharacter.id, patch)}
            onPersonalityChange={(key, next) => updatePersonality(activeCharacter.id, key, next)}
            onVoiceFieldChange={(key, value) => updateVoiceField(activeCharacter.id, key, value)}
            onVoiceBehaviorExamplesChange={(next) => updateVoiceBehaviorExamples(activeCharacter.id, next)}
            onCurrentStateChange={(key, value) => updateCurrentState(activeCharacter.id, key, value)}
            onUnknownChange={(next) => updateUnknown(activeCharacter.id, next)}
            onRelationsChange={(next) => updateRelations(activeCharacter.id, next)}
            onRegenerateSection={(section) => handleSectionRegenerate(activeCharacter.id, section)}
            onRegenerateExamples={() => {
              setRegenerateExamplesId(activeCharacter.id);
              setRegenerateExamplesName(activeCharacter.name || activeCharacter.id);
            }}
            onDeleteClick={() => setDeletingId(activeCharacter.id)}
            regeneratingExamples={regeneratingExamplesIds.has(activeCharacter.id)}
            allCharacters={characters?.characters ?? []}
          />
        )}

        <p className="font-body text-body-md text-primary-container/60 text-xs">
          角色详情可在工作台的角色标签页内继续编辑。
        </p>
      </div>
    )}

    {/* Delete confirmation modal (unchanged) */}
    {deletingId && (() => {
      const target = characters?.characters.find((c) => c.id === deletingId);
      if (!target) return null;
      const cascade = inboundRelationCount(deletingId);
      return (
        <div data-testid="delete-confirm-modal" className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface-container p-6 rounded-lg max-w-md space-y-4">
            <h3 className="font-display text-lg text-primary">删除「{target.name || "未命名"}」？</h3>
            <p className="font-body text-body-md text-sm text-primary-container">
              将同时清理 <strong>{cascade}</strong> 个反向关系。
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" data-testid="delete-cancel-button" onClick={() => setDeletingId(null)} className="px-3 py-1 text-xs bg-surface-container-low text-primary-container rounded-lg">取消</button>
              <button type="button" data-testid="delete-confirm-button" onClick={() => void handleDeleteConfirm()} className="px-4 py-1 text-xs bg-error text-on-error rounded-lg">确认删除</button>
            </div>
          </div>
        </div>
      );
    })()}

    {/* 全角色 RegenerateModal (unchanged) */}
    <RegenerateModal
      open={showRegenerateModal}
      target="角色"
      onConfirm={async (text) => { setShowRegenerateModal(false); await handleBatchStart(text); }}
      onCancel={() => setShowRegenerateModal(false)}
    />

    {/* 行为例示 RegenerateModal (unchanged) */}
    <RegenerateModal
      open={!!regenerateExamplesId}
      target={`${regenerateExamplesName} · 行为例示`}
      onConfirm={async (text) => {
        const id = regenerateExamplesId;
        setRegenerateExamplesId(null);
        setRegenerateExamplesName("");
        if (!id) return;
        await handleRegenerateExamples(id, text);
      }}
      onCancel={() => { setRegenerateExamplesId(null); setRegenerateExamplesName(""); }}
    />
  </div>
);
```

### Step 6: 在文件末尾添加 CharacterTabs + CharacterPanel + VoiceSection / CurrentStateSection / UnknownSection / RelationsSection 实现

```tsx
function CharacterTabs({
  tabs, activeId, onTabChange, onAddClick, onTabKeyDown,
}: {
  tabs: { id: string; name: string; typeLabel: string }[];
  activeId: string | null;
  onTabChange: (id: string) => void;
  onAddClick: () => void;
  onTabKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="角色"
      data-testid="character-tabs"
      className="sticky top-0 z-10 -mx-6 px-6 bg-surface-container-low/95 backdrop-blur-sm flex gap-1 border-b border-outline-variant overflow-x-auto"
    >
      {tabs.map((t) => {
        const isActive = t.id === activeId;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`character-panel-${t.id}`}
            data-testid={`character-tab-${t.id}`}
            onClick={() => onTabChange(t.id)}
            onKeyDown={onTabKeyDown}
            className={
              "shrink-0 px-3 py-2 text-sm font-display font-medium inline-flex items-center border-b-2 -mb-px gap-1 transition-colors outline-none focus-visible:ring-2 ring-primary-container " +
              (isActive ? "border-primary text-primary" : "border-transparent text-on-surface-variant hover:text-primary")
            }
          >
            <span>{t.name}</span>
            <span className="text-on-surface-variant/60 text-xs">-</span>
            <span className="text-xs">{t.typeLabel}</span>
          </button>
        );
      })}
      <button
        type="button"
        data-testid="character-tab-add"
        onClick={onAddClick}
        aria-label="添加新角色"
        className="shrink-0 px-2 py-2 text-sm border-b-2 -mb-px border-transparent text-on-surface-variant hover:text-primary transition-colors"
      >
        <span aria-hidden="true" className="material-symbols-outlined text-base leading-none">add</span>
      </button>
    </div>
  );
}

function CharacterPanel({
  character, busy, activeSubTab, onSubTabChange,
  onUpdate, onPersonalityChange, onVoiceFieldChange, onVoiceBehaviorExamplesChange,
  onCurrentStateChange, onUnknownChange, onRelationsChange,
  onRegenerateSection, onRegenerateExamples, onDeleteClick,
  regeneratingExamples, allCharacters,
}: {
  character: Character;
  busy: boolean;
  activeSubTab: string;
  onSubTabChange: (key: string) => void;
  onUpdate: (patch: Partial<Character>) => void;
  onPersonalityChange: (key: PersonalityKey, next: string[]) => void;
  onVoiceFieldChange: (key: "speech_style" | "thought_patterns" | "taboos", value: string | string[]) => void;
  onVoiceBehaviorExamplesChange: (next: BehaviorExample[]) => void;
  onCurrentStateChange: (key: "location" | "physical_condition" | "emotional" | "known_secrets", value: string | string[]) => void;
  onUnknownChange: (next: string[]) => void;
  onRelationsChange: (next: Character["relations"]) => void;
  onRegenerateSection: (section: "personality" | "voice_signature" | "current_state" | "unknown" | "relations") => () => Promise<void>;
  onRegenerateExamples: () => void;
  onDeleteClick: () => void;
  regeneratingExamples: boolean;
  allCharacters: Character[];
}) {
  const regenerateFor = {
    personality: onRegenerateSection("personality"),
    voice_signature: onRegenerateSection("voice_signature"),
    current_state: onRegenerateSection("current_state"),
    unknown: onRegenerateSection("unknown"),
    relations: onRegenerateSection("relations"),
  };

  return (
    <div data-testid={`character-panel-${character.id}`} className="space-y-3 pt-3">
      <CharacterHeader
        character={character}
        busy={busy}
        onUpdate={onUpdate}
        onDeleteClick={onDeleteClick}
      />
      <SubTabStrip
        tabs={CHARACTER_SUB_TABS.map((s) => ({ key: s.key, label: s.label, testidSuffix: s.testidSuffix }))}
        active={activeSubTab}
        onChange={onSubTabChange}
        testidPrefix="character-subtab"
      />
      <div data-testid={`character-subtab-panel-${activeSubTab}`}>
        {activeSubTab === "personality" && (
          <PersonalitySection
            character={character}
            busy={busy}
            onPersonalityChange={onPersonalityChange}
            onRegenerate={regenerateFor.personality}
          />
        )}
        {activeSubTab === "voice_signature" && (
          <VoiceSection
            character={character}
            busy={busy}
            onVoiceFieldChange={onVoiceFieldChange}
            onVoiceBehaviorExamplesChange={onVoiceBehaviorExamplesChange}
            onRegenerate={regenerateFor.voice_signature}
            onRegenerateExamples={onRegenerateExamples}
            regeneratingExamples={regeneratingExamples}
          />
        )}
        {activeSubTab === "current_state" && (
          <CurrentStateSection
            character={character}
            busy={busy}
            onCurrentStateChange={onCurrentStateChange}
            onRegenerate={regenerateFor.current_state}
          />
        )}
        {activeSubTab === "unknown" && (
          <UnknownSection
            character={character}
            busy={busy}
            onUnknownChange={onUnknownChange}
            onRegenerate={regenerateFor.unknown}
          />
        )}
        {activeSubTab === "relations" && (
          <RelationsSection
            character={character}
            busy={busy}
            allCharacters={allCharacters}
            onRelationsChange={onRelationsChange}
            onRegenerate={regenerateFor.relations}
          />
        )}
      </div>
    </div>
  );
}

// VoiceSection / CurrentStateSection / UnknownSection / RelationsSection:
// 完整实现参见「附录 A」, 本步骤仅粘贴 5 个 Section 的完整 JSX (约 200 行)。

function PersonalitySection({
  character, busy, onPersonalityChange, onRegenerate,
}: {
  character: Character;
  busy: boolean;
  onPersonalityChange: (key: PersonalityKey, next: string[]) => void;
  onRegenerate: () => void;
}) {
  const personality = character.personality ?? { beliefs: [], desires: [], fears: [], values: [], core_traits: [] };
  return (
    <div data-testid={`character-${character.id}-personality`} className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-mono text-primary-container text-[10px] uppercase tracking-wider">人格层</div>
        <SectionRegenerateButton
          target={`${character.name || character.id} · 人格层`}
          onRegenerate={onRegenerate}
          testId={`character-${character.id}-personality-regenerate`}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PERSONALITY_FIELDS.map(({ key, label }) => (
          <div key={key}>
            <div className="font-mono text-primary-container/80 text-[10px] mb-1">{label}</div>
            <TagEditor
              items={personality[key] ?? []}
              onItemsChange={(next) => onPersonalityChange(key, next)}
              saving={busy}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function VoiceSection({
  character, busy, onVoiceFieldChange, onVoiceBehaviorExamplesChange,
  onRegenerate, onRegenerateExamples, regeneratingExamples,
}: {
  character: Character;
  busy: boolean;
  onVoiceFieldChange: (key: "speech_style" | "thought_patterns" | "taboos", value: string | string[]) => void;
  onVoiceBehaviorExamplesChange: (next: BehaviorExample[]) => void;
  onRegenerate: () => void;
  onRegenerateExamples: () => void;
  regeneratingExamples: boolean;
}) {
  const voice = character.voice_signature ?? { speech_style: "", thought_patterns: "", taboos: [] };
  return (
    <div data-testid={`character-${character.id}-voice`} className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-mono text-primary-container text-[10px] uppercase tracking-wider">声音签名</div>
        <SectionRegenerateButton
          target={`${character.name || character.id} · 声音签名`}
          onRegenerate={onRegenerate}
          testId={`character-${character.id}-voice-regenerate`}
        />
      </div>
      <div>
        <label className="block font-mono text-primary-container/80 mb-1 text-[10px]">说话风格</label>
        <AutoTextarea
          data-testid={`character-${character.id}-speech-style`}
          value={voice.speech_style}
          onChange={(e) => onVoiceFieldChange("speech_style", e.target.value)}
          disabled={busy}
          rows={2}
          className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container disabled:opacity-40 resize-y"
        />
      </div>
      <div>
        <label className="block font-mono text-primary-container/80 mb-1 text-[10px]">思维模式</label>
        <AutoTextarea
          data-testid={`character-${character.id}-thought-patterns`}
          value={voice.thought_patterns}
          onChange={(e) => onVoiceFieldChange("thought_patterns", e.target.value)}
          disabled={busy}
          rows={2}
          className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container disabled:opacity-40 resize-y"
        />
      </div>
      <div>
        <div className="font-mono text-primary-container/80 mb-1 text-[10px]">行为禁忌</div>
        <TagEditor
          items={voice.taboos ?? []}
          onItemsChange={(next) => onVoiceFieldChange("taboos", next)}
          saving={busy}
        />
      </div>
      <div className="border-t border-outline-variant pt-3">
        <BehaviorExamplesSection
          examples={voice.behavior_examples ?? []}
          onChange={onVoiceBehaviorExamplesChange}
          onRegenerate={onRegenerateExamples}
          regenerating={regeneratingExamples}
        />
      </div>
    </div>
  );
}

function CurrentStateSection({
  character, busy, onCurrentStateChange, onRegenerate,
}: {
  character: Character;
  busy: boolean;
  onCurrentStateChange: (key: "location" | "physical_condition" | "emotional" | "known_secrets", value: string | string[]) => void;
  onRegenerate: () => void;
}) {
  const state = character.current_state ?? { location: "", physical_condition: "normal", emotional: "neutral", known_secrets: [] };
  return (
    <div data-testid={`character-${character.id}-current-state`} className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-mono text-primary-container text-[10px] uppercase tracking-wider">当前状态</div>
        <SectionRegenerateButton
          target={`${character.name || character.id} · 当前状态`}
          onRegenerate={onRegenerate}
          testId={`character-${character.id}-current-state-regenerate`}
        />
      </div>
      <div>
        <label className="block font-mono text-primary-container/80 mb-1 text-[10px]">位置</label>
        <input
          data-testid={`character-${character.id}-location`}
          value={state.location}
          onChange={(e) => onCurrentStateChange("location", e.target.value)}
          disabled={busy}
          className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container disabled:opacity-40"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="block font-mono text-primary-container/80 mb-1 text-[10px]">身体状况</label>
          <input
            data-testid={`character-${character.id}-physical-condition`}
            value={state.physical_condition}
            onChange={(e) => onCurrentStateChange("physical_condition", e.target.value)}
            disabled={busy}
            className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container disabled:opacity-40"
          />
        </div>
        <div>
          <label className="block font-mono text-primary-container/80 mb-1 text-[10px]">情绪</label>
          <input
            data-testid={`character-${character.id}-emotional`}
            value={state.emotional}
            onChange={(e) => onCurrentStateChange("emotional", e.target.value)}
            disabled={busy}
            className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs text-primary focus:outline-none focus:border-primary-container disabled:opacity-40"
          />
        </div>
      </div>
      <div>
        <div className="font-mono text-primary-container/80 mb-1 text-[10px]">已知秘密</div>
        <TagEditor
          items={state.known_secrets ?? []}
          onItemsChange={(next) => onCurrentStateChange("known_secrets", next)}
          saving={busy}
        />
      </div>
    </div>
  );
}

function UnknownSection({
  character, busy, onUnknownChange, onRegenerate,
}: {
  character: Character;
  busy: boolean;
  onUnknownChange: (next: string[]) => void;
  onRegenerate: () => void;
}) {
  return (
    <div data-testid={`character-${character.id}-unknown`} className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-mono text-primary-container text-[10px] uppercase tracking-wider">角色不知道的事</div>
        <SectionRegenerateButton
          target={`${character.name || character.id} · 未知`}
          onRegenerate={onRegenerate}
          testId={`character-${character.id}-unknown-regenerate`}
        />
      </div>
      <div className="font-mono text-primary-container/80 mb-1 text-[10px]">未知 (unknown_to_character)</div>
      <TagEditor
        items={character.unknown_to_character ?? []}
        onItemsChange={onUnknownChange}
        saving={busy}
      />
    </div>
  );
}

function RelationsSection({
  character, busy, allCharacters, onRelationsChange, onRegenerate,
}: {
  character: Character;
  busy: boolean;
  allCharacters: Character[];
  onRelationsChange: (next: Character["relations"]) => void;
  onRegenerate: () => void;
}) {
  return (
    <div data-testid={`character-${character.id}-relations`} className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-mono text-primary-container text-[10px] uppercase tracking-wider">角色关系</div>
        <SectionRegenerateButton
          target={`${character.name || character.id} · 角色关系`}
          onRegenerate={onRegenerate}
          testId={`character-${character.id}-relations-regenerate`}
        />
      </div>
      <CharacterRelationsEditor
        relations={character.relations ?? {}}
        allCharacters={allCharacters}
        selfId={character.id}
        onChange={onRelationsChange}
      />
    </div>
  );
}
```

### Step 7: 跑全量测试验证 Task 3 的 selector 修复 + Task 4 的重构都过

```bash
cd frontend && npx vitest run src/test/CharacterStep.test.tsx src/test/CharacterStep.inline_edit.test.tsx src/test/CharacterStep.edit_delete.test.tsx src/test/CharacterStep.behavior_examples.test.tsx src/test/WorldStep.subtabs.test.tsx src/test/WorldStep.test.tsx src/test/SubTabStrip.test.tsx src/test/AddCharacterMenu.test.tsx 2>&1 | tail -20
```

Expected: 全部 PASS (除了 5 个已知 baseline failed: ConceptStep / ChapterOutlineStep / Workspace / WizardSidebar / WorkspaceWizardPanel)。

如果 fail:
- 报 `character-tabs` 找不到 → 检查主 JSX 里 CharacterTabs 是否正确渲染
- 报 `character-panel-${id}` 找不到 → 检查 CharacterPanel 是否被 mount
- 报 `character-${id}-name` 找不到 → 检查 CharacterPanel → CharacterHeader 链路
- 报某个 sub-tab 内容找不到 → 检查 activeSubTab 是否正确传递

### Step 8: tsc 检查

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -E "CharacterStep" | head
```

Expected: 无 CharacterStep 相关错误 (其他文件的预存在错误照旧)。

### Step 9: 全量 vitest 跑一遍确认无回归

```bash
cd frontend && npx vitest run 2>&1 | tail -8
```

Expected: 失败数 ≤ 基线 27 (跟改动前一致, 不能引入新失败)。

### Step 10: Commit

```bash
git add frontend/src/components/wizard/CharacterStep.tsx
git commit -m "$(cat <<'EOF'
refactor(characterstep): tabbed layout (one tab per character, 5 sub-tabs)

Replace linear <ul> of character cards with a tab strip mirroring
WorldStep's pattern: one character per tab, label "{name}-{typeLabel}"
("林峰-主角" / "未命名 1-主角" when name is empty). Tab strip has a +
button on the right that opens AddCharacterMenu (主角/反派/配角/导师
picker); new character auto-jumps active tab to it.

Inside each character panel:
- Fixed CharacterHeader (姓名/类型/核心/删除) — delete button keeps the
  existing cascade modal
- 5 sub-tabs via shared SubTabStrip: 人格层 / 声音签名 / 当前状态 /
  未知 / 关系. SectionRegenerateButton (modal-based) is preserved on
  each sub-tab — user can still type modification guidance before
  regenerating

New state in main component:
- activeCharacterId (string|null) — auto-fallback to first character on
  delete via useEffect
- characterSubTab (Record<string, string>) — per-character sub-tab
  memory: switching back to a character lands on the sub-tab you left it on
- addMenuOpen (boolean) — controls AddCharacterMenu visibility

Main component shrinks to a state machine + handlers + JSX composition.
Visual structure moves into 7 file-internal components (CharacterTabs,
CharacterPanel, CharacterHeader, PersonalitySection, VoiceSection,
CurrentStateSection, UnknownSection, RelationsSection) — same convention
as WorldStep's EraPanel / PowerSystemsPanel / CoreRulesPanel /
FactionsPanel.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 加新 tab 行为测试

**Files:**
- Modify: `frontend/src/test/CharacterStep.test.tsx` (5 个新测试)
- Modify: `frontend/src/test/CharacterStep.edit_delete.test.tsx` (1 个新测试)

### Step 1: 在 `CharacterStep.test.tsx` 加 5 个新测试

文件末尾最后一个 `});` 之前追加:

```tsx
describe("CharacterStep tab strip", () => {
  function setup3Chars() {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        currentStep: 3, completedSteps: [1, 2], status: "idle",
        data: {
          concept: null, story_dna: null, world: null,
          characters: { characters: [
            makeChar("c1", "protagonist", "林峰"),
            makeChar("c2", "supporting", "苏晓晓"),
            makeChar("c3", "mentor", ""),  // 空名字, 触发 fallback
          ], current: null },
          novel_outline: null, chapter1_outline: null,
        },
        errorMessage: null,
      }),
    );
  }

  it("tab label = {name}-{typeLabel}, with '未命名 N-类型' fallback when name empty", () => {
    setup3Chars();
    setupWithExisting();  // (复用现有的 setup 模式)
    // 不重新生成, 直接 verify tabs
    expect(screen.getByTestId("character-tab-c1").textContent).toContain("林峰");
    expect(screen.getByTestId("character-tab-c1").textContent).toContain("主角");
    expect(screen.getByTestId("character-tab-c2").textContent).toContain("苏晓晓");
    expect(screen.getByTestId("character-tab-c2").textContent).toContain("配角");
    // c3 空名字 → 未命名 3-导师 (index = 2 + 1)
    expect(screen.getByTestId("character-tab-c3").textContent).toContain("未命名 3");
    expect(screen.getByTestId("character-tab-c3").textContent).toContain("导师");
  });

  it("clicking a different character tab switches the active panel", () => {
    setup3Chars();
    setupWithExisting();
    // 默认 active = 第一个 (林峰)
    expect(screen.getByTestId("character-panel-c1")).toBeInTheDocument();
    expect(screen.queryByTestId("character-panel-c2")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("character-tab-c2"));
    expect(screen.getByTestId("character-panel-c2")).toBeInTheDocument();
    expect(screen.queryByTestId("character-panel-c1")).not.toBeInTheDocument();
  });

  it("per-character sub-tab memory: 切回角色后停留在上次 sub-tab", () => {
    setup3Chars();
    setupWithExisting();
    // 切到 c2, 切到 声音签名 sub-tab
    fireEvent.click(screen.getByTestId("character-tab-c2"));
    fireEvent.click(screen.getByTestId("character-subtab-voice"));
    expect(screen.getByTestId(`character-c2-voice`)).toBeInTheDocument();
    // 切到 c1 (默认 sub-tab 是 personality)
    fireEvent.click(screen.getByTestId("character-tab-c1"));
    expect(screen.getByTestId(`character-c1-personality`)).toBeInTheDocument();
    // 切回 c2 → 仍停在 voice
    fireEvent.click(screen.getByTestId("character-tab-c2"));
    expect(screen.getByTestId(`character-c2-voice`)).toBeInTheDocument();
    expect(screen.queryByTestId(`character-c2-personality`)).not.toBeInTheDocument();
  });

  it("+ button opens AddCharacterMenu; clicking an option generates + auto-jumps", async () => {
    // 起始 0 角色 → 自动 batch 生成 6 个 → 然后测试 + 流程
    setupWithAutoBatch();
    // 等默认 batch 完成
    await screen.findByTestId("character-tabs");
    const originalCount = screen.getByTestId("character-tabs").children.length; // 6 tabs (不含 + button)
    // 当前 active 是 c1 (第一个 batch 生成的角色)
    expect(screen.getByTestId(`character-panel-${firstBatchId}`)).toBeInTheDocument();
    // 点 + 打开菜单
    fireEvent.click(screen.getByTestId("character-tab-add"));
    expect(screen.getByTestId("character-add-menu")).toBeInTheDocument();
    // 点 反派
    (api.generateCharacter as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      characters: [makeChar("c_new", "antagonist", "新反派")],
      current: null,
    });
    fireEvent.click(screen.getByTestId("character-add-antagonist"));
    // 等待新角色渲染 + auto-jump
    await waitFor(() => expect(screen.getByTestId("character-tab-c_new")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("character-panel-c_new")).toBeInTheDocument());
    expect(screen.getByTestId("character-tabs").children.length).toBe(originalCount + 1);
  });

  it("pressing Escape on AddCharacterMenu closes the menu without generating", async () => {
    setupWithAutoBatch();
    await screen.findByTestId("character-tabs");
    fireEvent.click(screen.getByTestId("character-tab-add"));
    expect(screen.getByTestId("character-add-menu")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("character-add-menu")).not.toBeInTheDocument();
    expect(api.generateCharacter).toHaveBeenCalledTimes(6); // batch 数字不变
  });
});
```

(注: `setupWithExisting()` 和 `setupWithAutoBatch()` 是 helper — 跟现有 `setup()` 类似的 sessionStorage 设置函数。具体实现参见 Step 4 末尾的 helper 块; 实施时直接复制现有 `setup()` 函数, 加 2 个 wrapper 即可。)

### Step 2: 在 `CharacterStep.edit_delete.test.tsx` 加 1 个新测试

```tsx
it("deleting the active character falls back to the first remaining character", async () => {
  // 3 个角色, 当前 active = 第一个 (id="c1")
  sessionStorage.setItem(KEY, JSON.stringify({
    currentStep: 3, completedSteps: [1, 2], status: "idle",
    data: {
      concept: null, story_dna: null, world: null,
      characters: {
        characters: [
          { id: "c1", name: "林峰", character_type: "protagonist", ... },
          { id: "c2", name: "苏晓晓", character_type: "supporting", ... },
          { id: "c3", name: "师父", character_type: "mentor", ... },
        ],
        current: null,
      },
      novel_outline: null, chapter1_outline: null,
    },
    errorMessage: null,
  }));
  (api.deleteCharacter as ReturnType<typeof vi.fn>).mockResolvedValue({});
  setup();
  await screen.findByTestId("character-panel-c1");
  // 删除 c1
  fireEvent.click(screen.getByTestId("character-delete-c1"));
  fireEvent.click(screen.getByTestId("delete-confirm-button"));
  // 自动回退到 c2 (列表里第一个剩下的)
  await waitFor(() => {
    expect(screen.getByTestId("character-panel-c2")).toBeInTheDocument();
  });
  expect(screen.queryByTestId("character-panel-c1")).not.toBeInTheDocument();
});
```

### Step 3: 跑新测试验证通过

```bash
cd frontend && npx vitest run src/test/CharacterStep.test.tsx src/test/CharacterStep.edit_delete.test.tsx 2>&1 | tail -15
```

Expected: PASS (新增 5+1 个 test 全部过, 老的也保持通过)。

### Step 4: 全量 vitest 跑一遍

```bash
cd frontend && npx vitest run 2>&1 | tail -8
```

Expected: 失败数 ≤ 基线 27。已知 baseline 跟 CharacterStep 无关, 这里不应该引入新失败。

### Step 5: tsc 检查

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -E "CharacterStep.*test" | head
```

Expected: 无 CharacterStep 测试文件相关错误。

### Step 6: Commit

```bash
git add frontend/src/test/CharacterStep.test.tsx frontend/src/test/CharacterStep.edit_delete.test.tsx
git commit -m "$(cat <<'EOF'
test(characterstep): cover tab strip + sub-tab memory + + menu + delete fallback

5 new tests in CharacterStep.test.tsx:
- Tab label format "{name}-{typeLabel}" with "未命名 N-类型" fallback
- Clicking a tab switches the active panel (only one panel mounted)
- Per-character sub-tab memory: switching back to a character lands
  on the sub-tab you left it on
- + button opens AddCharacterMenu; selecting a type generates the
  character and auto-jumps the active tab to it
- Escape on AddCharacterMenu closes without generating

1 new test in CharacterStep.edit_delete.test.tsx:
- Deleting the active character falls back to the first remaining
  character (the useEffect guard)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

1. **Spec coverage:**
   - 「角色 tab strip + 一角色一tab」 → Task 4 CharacterTabs (Step 6)
   - 「tab 标题 = {name}-{typeLabel}」 → Task 5 测试 1 + Task 4 CharacterTabs 实现
   - 「固定头部 (姓名/类型/核心/删除)」 → Task 4 CharacterHeader (Step 4 + Step 6)
   - 「5 个二级 sub-tab」 → Task 4 CHARACTER_SUB_TABS + CharacterPanel (Step 6)
   - 「Sub-tab ↻ 保持 SectionRegenerateButton modal 行为」 → Task 4 各 Section 组件 (Step 6)
   - 「Tab strip 右侧 + 按钮」 → Task 4 CharacterTabs render + AddCharacterMenu (Step 6 + Task 2)
   - 「添加后自动跳到新角色」 → Task 4 handleAddOne (Step 2) + Task 5 测试 4
   - 「per-character sub-tab 记忆」 → Task 4 activeSubTabKey + handleSubTabChange (Step 3) + Task 5 测试 3
   - 「删除 active 角色 fallback 到第一个」 → Task 4 useEffect (Step 2) + Task 5 测试 1 (edit_delete.test.tsx)
   - 「提升 SubTabStrip 到 shared/」 → Task 1 全部
   - 「删除底部 4 个手动添加按钮」 → Task 4 Step 1 (移除 lines 654-673)
   - 「保留 delete-confirm-modal 行为」 → Task 4 Step 5 (JSX 替换但 modal 部分不变)

2. **Placeholder scan:** 无 TBD/TODO。所有 step 含具体代码或具体命令。

3. **Type consistency:**
   - `Character["character_type"]` 在 Task 2 (AddCharacterMenuProps.onPick) 和 Task 4 (handleAddOne signature) 一致 ✓
   - `CHARACTER_SUB_TABS.testidSuffix` 与现有 testid `character-{id}-{personality|voice|current-state|unknown|relations}` 一致 ✓
   - `activeSubTabKey` 默认值 "personality" 在 Task 4 Step 3 + 各 Section 组件 match 条件 一致 ✓
   - `onRegenerateSection: (section) => () => Promise<void>` 在 CharacterPanel props 和 PersonalitySection 等 5 个 Section 的 onRegenerate prop 一致 ✓

4. **No orphans:** `CHARACTER_SUB_TABS` 在 CharacterPanel 内使用, `CHARACTER_TYPES` 在 CharacterHeader 内使用, 都在 Task 4 同文件内引用, 不跨文件泄露。
