# 世界观 Tab 化改造 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `frontend/src/components/wizard/WorldStep.tsx` 从 4-section 垂直堆叠改为 sticky 横条 tab + 下方 panel 的布局,完全对齐 S2 维度 tab 的视觉与交互。

**Architecture:** 在 WorldStep.tsx 文件内部新增 5 个子组件 (`WorldTabs` + `EraPanel` / `PowerSystemsPanel` / `CoreRulesPanel` / `FactionsPanel`),主组件瘦身到只持有状态与业务函数。Tab strip 用 sticky 顶部 + active panel 用 `hidden` 隐藏非激活 panel (与 S2 一致)。Section 级 regenerate 图标内嵌到 tab 按钮内 (用 `span role="button"` 避免嵌套 `<button>`),"添加体系/添加势力"按钮从 section header 移到 panel 底部。键盘 ← → 切换 tab。

**Tech Stack:** React 18 + TypeScript + Tailwind (Material 3 tokens via `frontend/src/components/ds/`)

---

## 文件改动范围

| 文件 | 改动 | 任务 |
|---|---|---|
| `frontend/src/components/wizard/WorldStep.tsx` | 重构: 抽 5 个内部子组件 + tab 状态 + keyboard handler + 重排 render | Task 1, Task 2 |
| `frontend/src/test/InitWizardModal.test.tsx` | 5 处 testid 断言改为新 testid | Task 1 |
| `frontend/src/test/WorldStep.test.tsx` | 1 处 testid 断言改为新 testid | Task 1 |
| `frontend/src/test/WorldStep.tabs.test.tsx` (新建) | 新增 3 个测试: tab strip 渲染、keyboard ← → 切换、keyboard ← → 焦点跟随 | Task 1, Task 2 |

不删除任何文件,不修改任何其它组件 (SectionRegenerateButton 组件本身保留供 CharacterStep / OutlineStep 使用)。

---

## Task 1: Tab strip + panels + 新 testid

**Files:**
- Modify: `frontend/src/components/wizard/WorldStep.tsx`
- Modify: `frontend/src/test/InitWizardModal.test.tsx` (第 518, 530, 752, 774, 793 行附近)
- Modify: `frontend/src/test/WorldStep.test.tsx` (第 473 行)
- Create: `frontend/src/test/WorldStep.tabs.test.tsx`

### Step 1: 写失败测试 — tab strip 渲染 4 个 tab

创建 `frontend/src/test/WorldStep.tabs.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../hooks/useToast";

vi.mock("../api/client", () => ({
  default: {
    generateWorld: vi.fn(),
    updateWorld: vi.fn(),
    getConcept: vi.fn(),
    getWorld: vi.fn(),
    getCharacter: vi.fn(),
    getNovelOutline: vi.fn(),
    getOutline: vi.fn(),
    regenerateWorldSection: vi.fn(),
    regeneratePowerSystemItem: vi.fn(),
  },
}));

import api from "../api/client";
import InitWizardModal from "../components/wizard/InitWizardModal";
import { getSessionKey } from "../components/wizard/WizardContext";

const PROJECT = "proj_x";
const KEY = getSessionKey(PROJECT);

beforeEach(() => {
  (api.generateWorld as ReturnType<typeof vi.fn>).mockReset();
  (api.updateWorld as ReturnType<typeof vi.fn>).mockReset();
  (api.getConcept as ReturnType<typeof vi.fn>).mockReset();
  (api.getWorld as ReturnType<typeof vi.fn>).mockReset();
  (api.getCharacter as ReturnType<typeof vi.fn>).mockReset();
  (api.getNovelOutline as ReturnType<typeof vi.fn>).mockReset();
  (api.getOutline as ReturnType<typeof vi.fn>).mockReset();
  (api.regenerateWorldSection as ReturnType<typeof vi.fn>).mockReset();
  (api.regeneratePowerSystemItem as ReturnType<typeof vi.fn>).mockReset();
  sessionStorage.clear();
});

function setup() {
  sessionStorage.setItem(
    KEY,
    JSON.stringify({
      currentStep: 2,
      completedSteps: [1],
      status: "idle",
      data: {
        concept: { title: "T", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
        story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
        world: null, characters: null, novel_outline: null, chapter1_outline: null,
      },
      errorMessage: null,
    }),
  );
  return render(
    <ToastProvider><MemoryRouter>
      <InitWizardModal projectId={PROJECT} onDismiss={vi.fn()} />
    </MemoryRouter></ToastProvider>,
  );
}

describe("WorldStep tab strip", () => {
  it("renders 4 tabs with icon, label, count, regenerate icon", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代", geography: "中原",
      power_systems: [{ name: "灵力", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [], core_rules: [],
    });
    setup();
    await screen.findByTestId("world-form");
    expect(screen.getByTestId("world-tabs")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-era")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-power_system")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-core_rules")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-factions")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-era-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-power_system-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-core_rules-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-factions-regenerate")).toBeInTheDocument();
  });
});
```

### Step 2: 跑测试验证它失败

```bash
cd frontend && npx vitest run src/test/WorldStep.tabs.test.tsx
```

预期: FAIL — `world-tabs` testid 找不到 (`TestingLibraryElementError: Unable to find an element by: [data-testid="world-tabs"]`)

### Step 3: 在 WorldStep.tsx 顶部加 WORLD_TABS 配置 + activeKey state

修改 `frontend/src/components/wizard/WorldStep.tsx`:

1. 在 import 块之后、组件之前添加:

```tsx
const WORLD_TABS = [
  { key: "era", label: "时代与地理", icon: "landscape" },
  { key: "power_system", label: "力量体系", icon: "bolt" },
  { key: "core_rules", label: "世界规则", icon: "rule" },
  { key: "factions", label: "势力分布", icon: "groups" },
] as const;
type WorldTabKey = (typeof WORLD_TABS)[number]["key"];

const TAB_COUNT: Record<WorldTabKey, (w: World) => number> = {
  era: () => 4,
  power_system: (w) => w.power_systems.length,
  core_rules: (w) => w.core_rules.length,
  factions: (w) => w.factions.length,
};
```

2. 在 `export default function WorldStep` 函数体内 (其他 useState 旁边) 添加:

```tsx
const [activeKey, setActiveKey] = useState<WorldTabKey>("era");
```

### Step 4: 重写 WorldStep 的 render — 用 tab strip + panels

在 `WorldStep.tsx` 的 return JSX 中:

- 删掉 `{(wizard.status === "completed" || wizard.data.world) && (` 包裹的整个 `<div data-testid="world-form" className="space-y-4">` 大块内容。
- 替换为新的 tab + panels 结构 (active panel 通过 `hidden` 隐藏,所有 panel 都渲染):

```tsx
{(wizard.status === "completed" || wizard.data.world) && (
  <div data-testid="world-form" className="space-y-4">
    <WorldTabs
      activeKey={activeKey}
      counts={{
        era: TAB_COUNT.era(world),
        power_system: TAB_COUNT.power_system(world),
        core_rules: TAB_COUNT.core_rules(world),
        factions: TAB_COUNT.factions(world),
      }}
      regenerateDisabled={busy}
      onTabChange={setActiveKey}
      onRegenerate={(key) => {
        if (key === "era") handleSectionRegenerate("era")();
        else if (key === "power_system") handleSectionRegenerate("power_system")();
        else if (key === "core_rules") handleSectionRegenerate("core_rules")();
        else if (key === "factions") handleSectionRegenerate("factions")();
      }}
      onTabKeyDown={handleTabKeyDown}
    />

    <EraPanel active={activeKey === "era"} world={world} setWorld={setWorld} busy={busy} />
    <PowerSystemsPanel
      active={activeKey === "power_system"}
      world={world} setWorld={setWorld} busy={busy}
      onAdd={addPowerSystem}
      onUpdateField={updatePowerSystem}
      onRemove={removePowerSystem}
      onRegenerateItem={(i) => handleItemRegenerate(i)}
    />
    <CoreRulesPanel active={activeKey === "core_rules"} world={world} setWorld={setWorld} busy={busy} />
    <FactionsPanel
      active={activeKey === "factions"}
      world={world} setWorld={setWorld} busy={busy}
      onAdd={addFaction}
      onUpdateField={updateFaction}
      onRemove={removeFaction}
    />
  </div>
)}
```

### Step 5: 在 WorldStep.tsx 文件底部添加 5 个内部子组件

加在文件末尾 (最后一个 `}` 之后):

```tsx
function WorldTabs({
  activeKey, counts, regenerateDisabled, onTabChange, onRegenerate, onTabKeyDown,
}: {
  activeKey: WorldTabKey;
  counts: Record<WorldTabKey, number>;
  regenerateDisabled: boolean;
  onTabChange: (key: WorldTabKey) => void;
  onRegenerate: (key: WorldTabKey) => void;
  onTabKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="世界观分区"
      data-testid="world-tabs"
      className="sticky top-0 z-10 -mx-6 px-6 bg-surface-container-low/95 backdrop-blur-sm flex gap-1 border-b border-outline-variant overflow-x-auto"
    >
      {WORLD_TABS.map(({ key, label, icon }) => {
        const isActive = activeKey === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`world-panel-${key}`}
            data-testid={`world-tab-${key}`}
            onClick={() => onTabChange(key)}
            onKeyDown={onTabKeyDown}
            className={
              "shrink-0 px-3 py-2 text-sm font-display font-medium border-b-2 -mb-px flex items-center gap-2 transition-colors outline-none focus-visible:ring-2 ring-primary-container " +
              (isActive
                ? "border-primary text-primary"
                : "border-transparent text-on-surface-variant hover:text-primary hover:border-outline-variant")
            }
          >
            <span aria-hidden="true" className="material-symbols-outlined text-base leading-none">{icon}</span>
            <span>{label}</span>
            <span className="font-mono text-[10px] opacity-70" aria-label={`${counts[key]} 个`}>
              {counts[key]}
            </span>
            <span
              role="button"
              tabIndex={regenerateDisabled ? -1 : 0}
              aria-label={`重新生成${label}`}
              data-testid={`world-tab-${key}-regenerate`}
              onClick={(e) => { e.stopPropagation(); if (!regenerateDisabled) onRegenerate(key); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); if (!regenerateDisabled) onRegenerate(key); } }}
              className={
                "ml-1 inline-flex items-center justify-center w-5 h-5 rounded text-on-surface-variant hover:text-primary-container hover:bg-primary-container/15 " +
                (regenerateDisabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer")
              }
            >
              <span aria-hidden="true" className="material-symbols-outlined text-[14px] leading-none">refresh</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function EraPanel({ active, world, setWorld, busy }: { active: boolean; world: World; setWorld: (w: World) => void; busy: boolean }) {
  return (
    <div
      role="tabpanel"
      id="world-panel-era"
      aria-labelledby="world-tab-era"
      hidden={!active}
      data-testid="world-panel-era"
      className="space-y-3"
    >
      <div>
        <label className="block font-mono text-primary-container mb-1 text-xs">时代背景</label>
        <AutoTextarea
          value={world.era}
          onChange={(e) => setWorld({ ...world, era: e.target.value })}
          rows={2}
          disabled={busy}
          className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
        />
      </div>
      <div>
        <label className="block font-mono text-primary-container mb-1 text-xs">地理环境</label>
        <AutoTextarea
          value={world.geography}
          onChange={(e) => setWorld({ ...world, geography: e.target.value })}
          rows={2}
          disabled={busy}
          className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
        />
      </div>
      <div>
        <label className="block font-mono text-primary-container mb-1 text-xs">
          社会结构 <span className="ml-1 text-[10px] text-primary-container/70">[新增]</span>
        </label>
        <AutoTextarea
          data-testid="world-era-social-structure"
          value={world.era_social_structure ?? ""}
          onChange={(e) => setWorld({ ...world, era_social_structure: e.target.value })}
          rows={2}
          disabled={busy}
          className="w-full bg-surface-container border border-primary-container/40 rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
        />
      </div>
      <div>
        <label className="block font-mono text-primary-container mb-1 text-xs">
          历史文化 <span className="ml-1 text-[10px] text-primary-container/70">[新增]</span>
        </label>
        <AutoTextarea
          data-testid="world-era-cultural-history"
          value={world.era_cultural_history ?? ""}
          onChange={(e) => setWorld({ ...world, era_cultural_history: e.target.value })}
          rows={2}
          disabled={busy}
          className="w-full bg-surface-container border border-primary-container/40 rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
        />
      </div>
    </div>
  );
}

function PowerSystemsPanel({
  active, world, setWorld, busy, onAdd, onUpdateField, onRemove, onRegenerateItem,
}: {
  active: boolean; world: World; setWorld: (w: World) => void; busy: boolean;
  onAdd: () => void;
  onUpdateField: <K extends keyof PowerSystem>(index: number, key: K, value: PowerSystem[K]) => void;
  onRemove: (index: number) => void;
  onRegenerateItem: (index: number) => (mods: string) => Promise<void>;
}) {
  return (
    <div
      role="tabpanel"
      id="world-panel-power_system"
      aria-labelledby="world-tab-power_system"
      hidden={!active}
      data-testid="world-panel-power_system"
      className="space-y-3"
    >
      {world.power_systems.length === 0 && (
        <p className="font-body text-body-md text-primary-container/40 text-xs text-center py-3">暂无力量体系</p>
      )}
      <div data-testid="world-power-systems" className="space-y-3">
        {world.power_systems.map((ps, i) => (
          <div
            key={i}
            data-testid={`world-power-system-${i}`}
            className="border border-outline-variant rounded p-3 space-y-2 relative"
          >
            <div className="absolute top-2 right-2 flex items-center gap-1">
              <SectionRegenerateButton
                target={`力量体系: ${ps.name || `#${i + 1}`}`}
                onRegenerate={onRegenerateItem(i)}
                testId={`world-power-system-${i}-regenerate`}
              />
              <button
                type="button"
                data-testid={`world-power-system-${i}-remove`}
                onClick={() => onRemove(i)}
                disabled={busy}
                aria-label="删除力量体系"
                className="text-primary-container/40 hover:text-error transition-colors disabled:opacity-30"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
            <div className="pr-6">
              <label className="block font-mono text-primary-container mb-1 text-[10px]">体系名称</label>
              <input
                data-testid={`world-power-system-${i}-name`}
                value={ps.name}
                onChange={(e) => onUpdateField(i, "name", e.target.value)}
                className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container"
              />
            </div>
            <div>
              <label className="block font-mono text-primary-container mb-1 text-[10px]">描述</label>
              <AutoTextarea
                data-testid={`world-power-system-${i}-description`}
                value={ps.description}
                onChange={(e) => onUpdateField(i, "description", e.target.value)}
                rows={2}
                className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container resize-y"
              />
            </div>
            <div>
              <label className="block font-mono text-primary-container mb-1 text-[10px]">阶段划分</label>
              <div data-testid={`world-power-system-${i}-stages`}>
                <TagEditor items={ps.stages ?? []} onItemsChange={(items) => onUpdateField(i, "stages", items)} saving={busy} />
              </div>
            </div>
            <div>
              <label className="block font-mono text-primary-container mb-1 text-[10px]">体系规则</label>
              <div data-testid={`world-power-system-${i}-rules`}>
                <TagEditor items={ps.core_rules ?? []} onItemsChange={(items) => onUpdateField(i, "core_rules", items)} saving={busy} />
              </div>
            </div>
            <div>
              <label className="block font-mono text-primary-container mb-1 text-[10px]">力量上限</label>
              <div data-testid={`world-power-system-${i}-ceilings`}>
                <TagEditor items={ps.ceilings ?? []} onItemsChange={(items) => onUpdateField(i, "ceilings", items)} saving={busy} />
              </div>
            </div>
            <div>
              <label className="block font-mono text-primary-container mb-1 text-[10px]">代价系统</label>
              <input
                data-testid={`world-power-system-${i}-cost`}
                value={ps.cost_system ?? ""}
                onChange={(e) => onUpdateField(i, "cost_system", e.target.value)}
                className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container"
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-center pt-2">
        <button
          type="button"
          data-testid="world-power-system-add"
          onClick={onAdd}
          disabled={busy}
          className="flex items-center gap-1 px-3 py-1.5 text-xs border border-dashed border-system-log/30 rounded text-primary-container/60 hover:text-primary-container hover:border-primary-container/50 transition-colors disabled:opacity-30"
        >
          <span className="material-symbols-outlined text-xs">add</span>
          添加体系
        </button>
      </div>
    </div>
  );
}

function CoreRulesPanel({ active, world, setWorld, busy }: { active: boolean; world: World; setWorld: (w: World) => void; busy: boolean }) {
  return (
    <div
      role="tabpanel"
      id="world-panel-core_rules"
      aria-labelledby="world-tab-core_rules"
      hidden={!active}
      data-testid="world-panel-core_rules"
    >
      <div data-testid="world-core-rules">
        <TagEditor items={world.core_rules ?? []} onItemsChange={(items) => setWorld({ ...world, core_rules: items })} saving={busy} />
      </div>
    </div>
  );
}

function FactionsPanel({
  active, world, setWorld, busy, onAdd, onUpdateField, onRemove,
}: {
  active: boolean; world: World; setWorld: (w: World) => void; busy: boolean;
  onAdd: () => void;
  onUpdateField: (index: number, field: "name" | "type" | "goal" | "relations", value: string) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div
      role="tabpanel"
      id="world-panel-factions"
      aria-labelledby="world-tab-factions"
      hidden={!active}
      data-testid="world-panel-factions"
      className="space-y-3"
    >
      <div data-testid="world-factions" className="space-y-3">
        {world.factions.length === 0 && (
          <p className="font-body text-body-md text-primary-container/40 text-xs text-center py-3">暂无势力</p>
        )}
        {world.factions.map((f, i) => (
          <div
            key={i}
            data-testid={`world-faction-${i}`}
            className="border border-outline-variant rounded p-3 space-y-2 relative"
          >
            <button
              type="button"
              data-testid={`world-faction-${i}-remove`}
              onClick={() => onRemove(i)}
              disabled={busy}
              aria-label="删除势力"
              className="absolute top-2 right-2 text-primary-container/40 hover:text-error transition-colors disabled:opacity-30"
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
            <div className="grid grid-cols-2 gap-2 pr-6">
              <div>
                <label className="block font-mono text-primary-container mb-1 text-[10px]">名称</label>
                <input
                  data-testid={`world-faction-${i}-name`}
                  value={f.name}
                  onChange={(e) => onUpdateField(i, "name", e.target.value)}
                  className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container"
                />
              </div>
              <div>
                <label className="block font-mono text-primary-container mb-1 text-[10px]">类型</label>
                <input
                  data-testid={`world-faction-${i}-type`}
                  value={f.type}
                  onChange={(e) => onUpdateField(i, "type", e.target.value)}
                  className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container"
                />
              </div>
            </div>
            <div>
              <label className="block font-mono text-primary-container mb-1 text-[10px]">目标</label>
              <AutoTextarea
                data-testid={`world-faction-${i}-goal`}
                value={f.goal}
                onChange={(e) => onUpdateField(i, "goal", e.target.value)}
                rows={2}
                className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container resize-y"
              />
            </div>
            <div>
              <label className="block font-mono text-primary-container mb-1 text-[10px]">关系</label>
              <input
                data-testid={`world-faction-${i}-relations`}
                value={f.relations}
                onChange={(e) => onUpdateField(i, "relations", e.target.value)}
                className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1.5 text-xs text-primary focus:outline-none focus:border-primary-container"
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-center pt-2">
        <button
          type="button"
          data-testid="world-faction-add"
          onClick={onAdd}
          disabled={busy}
          className="flex items-center gap-1 px-3 py-1.5 text-xs border border-dashed border-system-log/30 rounded text-primary-container/60 hover:text-primary-container hover:border-primary-container/50 transition-colors disabled:opacity-30"
        >
          <span className="material-symbols-outlined text-xs">add</span>
          添加势力
        </button>
      </div>
    </div>
  );
}
```

### Step 6: 在 WorldStep 主组件里加 keyboard handler (临时存根,Task 2 完善)

在 WorldStep 函数体内 (activeKey useState 旁) 添加:

```tsx
const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
  // 完整实现在 Task 2
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  const idx = WORLD_TABS.findIndex((t) => t.key === activeKey);
  const nextIdx = e.key === "ArrowRight"
    ? (idx + 1) % WORLD_TABS.length
    : (idx - 1 + WORLD_TABS.length) % WORLD_TABS.length;
  setActiveKey(WORLD_TABS[nextIdx].key);
};
```

### Step 7: 跑新测试验证通过

```bash
cd frontend && npx vitest run src/test/WorldStep.tabs.test.tsx
```

预期: PASS — `world-tabs` / 4 个 `world-tab-{key}` / 4 个 `world-tab-{key}-regenerate` 都找到

### Step 8: 跑现有 WorldStep + InitWizardModal 测试,看哪些失败

```bash
cd frontend && npx vitest run src/test/WorldStep.test.tsx src/test/InitWizardModal.test.tsx
```

预期: 多处 FAIL — 旧 testid `world-era-regenerate` 等找不到 (因为这些 SectionRegenerateButton 已被移除)

### Step 9: 更新 InitWizardModal.test.tsx 第 518–528 行

在 `frontend/src/test/InitWizardModal.test.tsx`:

找到:
```ts
  it("world-step renders 4 section regenerate icons (era, power_system, core_rules, factions)", async () => {
    seedFiles({ world: WORLD_FIXTURE });
    seedStep(2, [1]);

    renderModal();
    await waitFor(() => screen.getByTestId("world-form"));
    expect(screen.getByTestId("world-era-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("world-power-system-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("world-core-rules-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("world-factions-regenerate")).toBeInTheDocument();
  });
```

替换为:
```ts
  it("world-step renders 4 tab regenerate icons (era, power_system, core_rules, factions)", async () => {
    seedFiles({ world: WORLD_FIXTURE });
    seedStep(2, [1]);

    renderModal();
    await waitFor(() => screen.getByTestId("world-form"));
    expect(screen.getByTestId("world-tab-era-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-power_system-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-core_rules-regenerate")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-factions-regenerate")).toBeInTheDocument();
  });
```

### Step 10: 更新 InitWizardModal.test.tsx 第 530–550 行

找到 `it("clicking world-power-system-regenerate + confirm calls regenerateWorldSection"...)` 中的:

```ts
    const psBtn = await screen.findByTestId("world-power-system-regenerate");
```

替换为:

```ts
    const psBtn = await screen.findByTestId("world-tab-power_system-regenerate");
```

### Step 11: 更新 InitWizardModal.test.tsx 第 752、774、793 行的 3 处 `world-era-regenerate`

每个 `screen.getByTestId("world-era-regenerate").click();` 替换为 `screen.getByTestId("world-tab-era-regenerate").click();`

(共 3 处,分布在 section regenerate footer status badge describe 块的 3 个 it 用例内。)

### Step 12: 更新 WorldStep.test.tsx 第 473 行

找到:
```ts
    // The section-level regenerate button still exists for full-array regen.
    expect(screen.getByTestId("world-power-system-regenerate")).toBeInTheDocument();
```

替换为:
```ts
    // The section-level regenerate button now lives in the tab strip.
    expect(screen.getByTestId("world-tab-power_system-regenerate")).toBeInTheDocument();
```

### Step 13: 跑所有 WorldStep / InitWizardModal 测试,验证全部通过

```bash
cd frontend && npx vitest run src/test/WorldStep.test.tsx src/test/WorldStep.tabs.test.tsx src/test/InitWizardModal.test.tsx
```

预期: PASS — 全部通过

### Step 14: 跑全量前端测试,确认无回归

```bash
cd frontend && npm test
```

预期: PASS — 仅 WorldStep / InitWizardModal 相关测试改动,其它测试不受影响 (SectionRegenerateButton.test.tsx 测的是组件本身,不受 WorldStep 改动影响)

### Step 15: 提交

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/components/wizard/WorldStep.tsx frontend/src/test/WorldStep.tabs.test.tsx frontend/src/test/WorldStep.test.tsx frontend/src/test/InitWizardModal.test.tsx
git commit -m "$(cat <<'EOF'
refactor(world-step): 4-section 改为 sticky tab + panel,与 S2 对齐

WorldStep 重构:
- 顶部 sticky 横条 tab (era/power_system/core_rules/factions)
- 各 panel 用 hidden 隐藏非激活,testid 全部在 DOM
- section 级 regenerate 图标内嵌到 tab 按钮 (span role=button)
- 「添加体系/添加势力」按钮移到 panel 底部
- 抽 5 个内部子组件 (WorldTabs + 4 个 panel),主组件瘦身

testid 迁移:
- 新增 world-tabs / world-tab-{key} / world-tab-{key}-regenerate / world-panel-{key}
- 废弃 world-era-regenerate / world-power-system-regenerate /
  world-core-rules-regenerate / world-factions-regenerate (section header 上)
- 卡片级 world-power-system-{i}-regenerate 保留 (与 tab 级 ↻ 并存)

测试改动:
- 新建 WorldStep.tabs.test.tsx
- InitWizardModal.test.tsx 5 处 testid 断言更新
- WorldStep.test.tsx 1 处 testid 断言更新

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 键盘 ← → 切换 tab + 焦点跟随

**Files:**
- Modify: `frontend/src/components/wizard/WorldStep.tsx` (`handleTabKeyDown` 实现补全 + 焦点跟随)
- Modify: `frontend/src/test/WorldStep.tabs.test.tsx` (追加 2 个测试)

### Step 1: 写失败测试 — ArrowRight 切到下一个 tab + 焦点跟随

在 `frontend/src/test/WorldStep.tabs.test.tsx` 的 `describe("WorldStep tab strip", ...)` 内追加:

```tsx
  it("ArrowRight on active tab switches to next tab and moves focus", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代", geography: "中原",
      power_systems: [{ name: "灵力", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [], core_rules: [],
    });
    setup();
    const eraTab = await screen.findByTestId("world-tab-era");
    eraTab.focus();
    await act(async () => {
      fireEvent.keyDown(eraTab, { key: "ArrowRight" });
    });
    expect(screen.getByTestId("world-tab-power_system")).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(screen.getByTestId("world-tab-power_system"));
  });

  it("ArrowLeft on first tab wraps to last tab", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代", geography: "中原",
      power_systems: [{ name: "灵力", description: "", stages: [], core_rules: [], ceilings: [] }],
      factions: [], core_rules: [],
    });
    setup();
    const eraTab = await screen.findByTestId("world-tab-era");
    eraTab.focus();
    await act(async () => {
      fireEvent.keyDown(eraTab, { key: "ArrowLeft" });
    });
    expect(screen.getByTestId("world-tab-factions")).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(screen.getByTestId("world-tab-factions"));
  });
```

需要在该文件顶部 import 加上 `import { render, screen, act, fireEvent } from "@testing-library/react";`(覆盖原 `act` import)。

(注:`fireEvent` 已在 Task 1 step 1 顶部 import,本步骤无需修改 import。)

### Step 2: 跑测试验证失败

```bash
cd frontend && npx vitest run src/test/WorldStep.tabs.test.tsx -t "ArrowRight"
```

预期: FAIL — `aria-selected` 仍是 era tab (因为 `handleTabKeyDown` 当前只 `setActiveKey`,没把焦点切过去;测试中 `document.activeElement` 仍是 eraTab)

### Step 3: 完善 `handleTabKeyDown` 加焦点跟随

替换 `WorldStep.tsx` 中 Task 1 Step 6 写的存根:

```tsx
const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  e.preventDefault();
  const idx = WORLD_TABS.findIndex((t) => t.key === activeKey);
  const nextIdx = e.key === "ArrowRight"
    ? (idx + 1) % WORLD_TABS.length
    : (idx - 1 + WORLD_TABS.length) % WORLD_TABS.length;
  const nextKey = WORLD_TABS[nextIdx].key;
  setActiveKey(nextKey);
  // 焦点跟随: 用 rAF 等 React 提交 DOM 更新后再 focus,避免丢失
  requestAnimationFrame(() => {
    const nextTab = document.querySelector<HTMLButtonElement>(
      `[data-testid="world-tab-${nextKey}"]`,
    );
    nextTab?.focus();
  });
};
```

### Step 4: 跑测试验证通过

```bash
cd frontend && npx vitest run src/test/WorldStep.tabs.test.tsx
```

预期: PASS — 全部 3 个测试通过 (1 个 tab strip 渲染 + 2 个 keyboard 切换)

### Step 5: 提交

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/components/wizard/WorldStep.tsx frontend/src/test/WorldStep.tabs.test.tsx
git commit -m "$(cat <<'EOF'
feat(world-step): 键盘 ← → 切换 tab + 焦点跟随

ArrowLeft / ArrowRight 在 tab 上触发切换:
- 阻止默认滚动 (e.preventDefault)
- 边界环绕 (← 从第 1 个绕到最后, → 从最后绕到第 1 个)
- requestAnimationFrame 等 React commit 后再 focus 新 tab,保证
  document.activeElement 同步

测试: WorldStep.tabs.test.tsx 追加 ArrowRight / ArrowLeft 两个用例

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 最终验证 + lint

**Files:**
- 无文件改动 (仅验证)

### Step 1: 跑全量前端测试

```bash
cd frontend && npm test
```

预期: PASS — 所有测试通过 (SectionRegenerateButton 自身的测试不受影响,因为该组件仍被 CharacterStep / OutlineStep 使用)

### Step 2: 跑 TypeScript 类型检查

```bash
cd frontend && npx tsc --noEmit
```

预期: 无错误

### Step 3: 跑 ESLint

```bash
cd frontend && npx eslint src/components/wizard/WorldStep.tsx src/test/WorldStep.tabs.test.tsx src/test/WorldStep.test.tsx src/test/InitWizardModal.test.tsx
```

预期: 无 error (warn 可接受,但 WorldStep 改造应无新 warn)

### Step 4: 手动 dev server smoke test (可选)

```bash
cd frontend && npm run dev
```

浏览器打开 http://localhost:5173,新建项目 → 完成 S1 输入 → 完成 S2 拆解 → 进入 step 2 世界观,目视验证:
- 顶部 4 个 tab 横条,默认 era active
- 切换 tab 各 panel 内容正确
- tab 内 ↻ 图标可点击 → 弹出 modal
- 「+ 添加体系」/「+ 添加势力」按钮在 panel 底部
- 键盘 ← → 切 tab,焦点跟随

如果 dev server 不可用,跳过此步。

### Step 5: 确认无未提交改动

```bash
cd /Users/longsa/Codes/nebula && git status
```

预期: 干净 (或仅有 Task 1 / Task 2 已提交的 commit,无 dangling 修改)

如果发现遗漏,补 commit;否则收工。

---

## 注意事项

- **StrictMode 双挂载**: Task 1 完成后,在 dev 模式下 `world-tabs` 和 panel 会渲染两次 (无害 — React 复用 DOM)。无需特别处理。
- **WorldStep.tsx 行数**: 改造后预计从 ~600 行降到 ~250 行 (主组件) + 5 个子组件各 50–150 行。文件总长 ~700 行,与改造前相当。
- **`SectionRegenerateButton` 组件本身不动**: 它仍被 CharacterStep / OutlineStep 使用,WorldStep 不再 import 它。如果后续两个 step 也想 tab 化,再决定是否保留该组件。
- **hidden 与 space-y**: panel 用 `hidden` HTML 属性,从 layout tree 移除,不影响布局计算。active panel 的 `space-y-3` 只在 active 时生效。
- **`world-tab-{key}-regenerate` 点击时**: `e.stopPropagation()` 阻止冒泡到外层 tab button 的 `onClick` (否则会同时切 tab + 弹 modal)。
