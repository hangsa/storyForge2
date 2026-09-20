# WorldStep 二级 Tab 系统 设计文档

**Date**: 2026-09-20
**Status**: Draft (待用户审阅)
**Scope**: WorldStep 4 个顶级 tab 内部分别新增二级 tab 系统 + 后端两个 ↻ 端点扩展

## 1. 背景

`WorldStep` 于 2026-09-20 完成顶层 tab 化重构（见 `2026-09-20-worldview-tab-refactor-design.md`），把 4 节内容（时代与地理 / 力量体系 / 世界规则 / 势力分布）拆为顶级 sticky 横条 tab + panel 的布局。每个 panel 内部：

- **时代与地理**：4 个固定字段（时代背景 / 地理环境 / 社会结构 / 历史文化）纵向堆叠。
- **力量体系 / 势力分布**：N 张卡片纵向堆叠。
- **世界规则**：按 4 个 category（物理公理 / 结构性瓶颈 / 解决路径封闭性 / 主角机制硬约束）折叠 group 渲染（见 `2026-09-20-core-rules-categorization-revision-design.md` F1 节）。

随着项目规模上升（实际项目 power_systems / factions / core_rules 经常有 4-8 条），单一 panel 内的纵向堆叠让长内容（如 `core_rules` 8 条 + `power_systems` 3 张 + `factions` 6 张）需要大量滚动，**跨子维度跳转不便、定位慢**。S2 拆解页已于 2026-09-15 完成 5 维度横条 tab 化，跨维度体验显著优于 WorldStep。

本次改造在已有顶层 tab 基础上，**给每个 panel 内部按各自的内容维度再嵌一层二级 tab**，让用户在一个项目里跨子维度跳转不必滚动，直接点 sub-tab。

## 2. 目标

- 时代与地理 panel 顶部追加 4 个固定二级 tab：时代背景 / 地理环境 / 社会结构 / 历史文化，点击 ↻ 只重生成当前字段
- 力量体系 panel 顶部追加按 `power_systems.length` 数量的二级 tab，标题 = `name` 去掉中文括号后缀；点击 ↻ 只重生成当前体系（沿用 `/regenerate-power-system-item?system_index=N`）
- 世界规则 panel 顶部追加按已出现 category 数量的二级 tab，标题 = 中文标签（物理公理 / 结构性瓶颈 / 解决路径封闭性 / 主角机制硬约束）；点击 ↻ 只重生成当前 category（沿用 `/regenerate-world-section?section=core_rules&category=X`）
- 势力分布 panel 顶部追加按 `factions.length` 数量的二级 tab，标题 = `name` 去掉中文括号后缀；点击 ↻ 只重生成当前 faction（**新增** `/regenerate-faction?faction_index=N`）
- 每个顶级 tab 各自记忆 active sub-tab；切换顶级 tab 后切回，active sub-tab 不重置
- 子项数量为 0 时隐藏二级 tab 条，显示空态 CTA 按钮（"✨ 生成首个体系 / 添加" 等）

## 3. 非目标

- 不重构顶级 tab 行为（沿用 `2026-09-20-worldview-tab-refactor-design.md` 既有实现）
- 不改后端 schema（power_systems / factions / core_rules 结构不变）
- 不改 LLM prompt（生成粒度仅在后端路由层拆细，不动 prompt）
- 不引入新的依赖库
- 不抽离 `SubTabStrip` 到 `components/ds/`（本改动范围限定 WorldStep 内部，后续若有第二处使用再抽）
- 不为 sub-tab ↻ 加批量/并发控制，沿用 `useSectionRegenerate` 单飞逻辑
- 不动 Stage 2 之后的阶段（章节大纲、写作等）

## 4. 修订总览

| 编号 | 内容 | 范围 | 优先级 |
|---|---|---|---|
| **A** | `SubTabStrip` 内部可复用组件 | frontend/src/components/wizard/WorldStep.tsx | P0 |
| **B** | `EraPanel` 增加 4 个固定 sub-tab + per-field ↻ | frontend/src/components/wizard/WorldStep.tsx | P0 |
| **C** | `PowerSystemsPanel` 改为 sub-tab 模式 + 沿用 `/regenerate-power-system-item` | frontend/src/components/wizard/WorldStep.tsx | P0 |
| **D** | `CoreRulesPanel` 改为 sub-tab 模式（保留 `<details>` 折叠能力在 sub-tab 内） | frontend/src/components/wizard/WorldStep.tsx | P0 |
| **E** | `FactionsPanel` 改为 sub-tab 模式 + 沿用新增的 `/regenerate-faction` | frontend/src/components/wizard/WorldStep.tsx | P0 |
| **F** | 后端扩展 `/regenerate-world-section` 增加 `field` 参数（era 4 字段） | backend/api/stage2_world_char.py | P0 |
| **G** | 后端新增 `/regenerate-faction?faction_index=N` | backend/api/stage2_world_char.py | P0 |
| **H** | WorldStep 主组件新增 `subTab: Record<WorldTabKey, string>` state + per-top-level-tab 记忆 | frontend/src/components/wizard/WorldStep.tsx | P0 |
| **I** | 空态 CTA 组件（render 状态从"暂无"改为可点击生成） | frontend/src/components/wizard/WorldStep.tsx | P1 |
| **J** | WorldStep 测试：sub-tab 渲染 / active 记忆 / 空态 / ↻ 触发 | frontend/src/test/WorldStep.test.tsx | P1 |
| **K** | 后端测试：`era field` 单字段重生成保留其他 3 个 + `/regenerate-faction` 单条重生成保留其他 | backend/tests/test_regenerate_world_section_field.py + backend/tests/test_regenerate_faction.py | P1 |

A → F → G 为后端依赖，A → H 为前端 state 准备，A + F → B 为 era sub-tab 通路，A + (复用) → C / D，A + G → E，I 并行于 A-H，J / K 在 A-I 完成后补齐。

## 5. 详细方案

### 修订 A: `SubTabStrip` 可复用组件

文件: `frontend/src/components/wizard/WorldStep.tsx`（新增内部组件，不导出）

```tsx
function SubTabStrip({
  tabs,             // { key: string, label: string, testidSuffix?: string }[]
  active,           // 当前 active key
  onChange,         // (key) => void
  onRegenerate,     // 可选 (key) => void  ← 没传就不渲染 ↻
  testidPrefix,     // 例 "world-tab-era-subtab"
  disabled,         // busy 时禁用 ↻
}: {
  tabs: { key: string; label: string; testidSuffix?: string }[];
  active: string;
  onChange: (key: string) => void;
  onRegenerate?: (key: string) => void;
  testidPrefix: string;
  disabled?: boolean;
}) {
  return (
    <div
      role="tablist"
      data-testid={`${testidPrefix}-strip`}
      className="sticky top-[var(--world-tabs-h,40px)] z-[5] -mx-1 px-1 bg-surface-container-low/95 backdrop-blur-sm flex gap-1 border-b border-outline-variant overflow-x-auto"
    >
      {tabs.map((t) => {
        const isActive = t.key === active;
        const tid = `${testidPrefix}-${t.testidSuffix ?? t.key}`;
        return (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={isActive}
            aria-controls={`${testidPrefix}-panel-${t.key}`}
            data-testid={tid}
            onClick={() => onChange(t.key)}
            className={
              "px-2 py-1 text-sm font-medium rounded-t border-b-2 transition flex items-center gap-1 whitespace-nowrap " +
              (isActive
                ? "border-primary text-primary"
                : "border-transparent text-on-surface-variant hover:text-primary")
            }
          >
            <span>{t.label}</span>
            {onRegenerate && (
              <span
                role="button"
                aria-label={`重新生成 ${t.label}`}
                data-testid={`${tid}-regenerate`}
                tabIndex={disabled ? -1 : 0}
                onClick={(e) => { e.stopPropagation(); if (!disabled) onRegenerate(t.key); }}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && !disabled) {
                    e.preventDefault(); e.stopPropagation(); onRegenerate(t.key);
                  }
                }}
                className={
                  "inline-flex items-center justify-center w-4 h-4 rounded text-on-surface-variant hover:text-primary " +
                  (disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:bg-primary-container/15")
                }
              >
                <span className="material-symbols-outlined text-[12px] leading-none">refresh</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

要点：
- 嵌套交互用 `<span role="button">` + `e.stopPropagation()`（沿用 WorldStep 顶级 tab 既有写法，已被用户接受 a11y 取舍）
- `disabled` 时 ↻ 整体置灰（`opacity-40 cursor-not-allowed`）并 `tabIndex={-1}`
- `sticky top-[var(--world-tabs-h,40px)]` 与顶级 tab strip 叠加定位（顶级 tab 真实高度由 CSS 变量传入；初版用常量 40px 占位，后续若抖动再实测调整）

### 修订 B: `EraPanel` 4 个固定 sub-tab

```tsx
const ERA_FIELDS = [
  { key: "era",                    label: "时代背景", testidSuffix: "era" },
  { key: "geography",              label: "地理环境", testidSuffix: "geography" },
  { key: "era_social_structure",   label: "社会结构", testidSuffix: "social-structure" },
  { key: "era_cultural_history",   label: "历史文化", testidSuffix: "cultural-history" },
] as const;

function EraPanel({ world, setWorld, busy, activeSubTab, onSubTabChange }) {
  const field = activeSubTab;  // 4 选 1,默认 "era"
  const value = (world as any)[field] ?? "";

  const setValue = (v: string) => setWorld({ ...world, [field]: v });

  const handleRegen = (key: string) => {
    sectionRegen.handle(key);  // 走 /regenerate-world-section?section=era&field=<key>
  };

  return (
    <div role="tabpanel" id="world-panel-era" aria-labelledby="world-tab-era"
         hidden={activeTop !== "era"} data-testid="world-panel-era">
      <SubTabStrip
        tabs={ERA_FIELDS}
        active={field}
        onChange={onSubTabChange}
        onRegenerate={handleRegen}
        testidPrefix="world-tab-era-subtab"
        disabled={busy}
      />
      <div data-testid={`world-tab-era-subtab-panel-${field}`} className="mt-3 space-y-2">
        <Field label={ERA_FIELDS.find(f => f.key === field)!.label}>
          <AutoTextarea
            testid={`world-era-${field.replace("era_", "")}`}
            value={value}
            onChange={setValue}
            saving={busy}
            rows={6}
          />
        </Field>
      </div>
    </div>
  );
}
```

要点：
- 4 个字段永远都有（schema 兜底空字符串），**不渲染空态 CTA**
- 顶层 `activeTop` 控制 panel 的 `hidden`，**不**影响 sub-tab 是否渲染（panel 内 sub-tab 永远渲染）
- `onRegenerate` 调用 `useSectionRegenerate` 的 handler（项目内已存在的 hook），传 `key` 即 `field` 名

### 修订 C: `PowerSystemsPanel` 按体系数 sub-tab

```tsx
function stripParenthetical(name: string): string {
  // 去掉所有中文括号及其内容
  return name.replace(/（[^）]*）/g, "").trim();
}

function PowerSystemsPanel({ world, setWorld, busy, activeSubTab, onSubTabChange }) {
  const items = world.power_systems ?? [];

  if (items.length === 0) {
    return (
      <div role="tabpanel" id="world-panel-power_system" hidden={activeTop !== "power_system"}
           data-testid="world-panel-power_system">
        <div data-testid="world-power-system-empty" className="text-center py-6 space-y-3">
          <p className="text-sm text-on-surface-variant">还没有力量体系</p>
          <button data-testid="world-power-system-generate-first" onClick={addFirstPowerSystem}
                  disabled={busy} className="primary-button-style">
            <span className="material-symbols-outlined text-sm">auto_awesome</span>
            生成首个体系
          </button>
        </div>
      </div>
    );
  }

  const subTabs = items.map((ps, i) => ({
    key: String(i),
    label: stripParenthetical(ps.name) || `体系 ${i + 1}`,
    testidSuffix: String(i),
  }));

  const idx = parseInt(activeSubTab || "0", 10);
  const ps = items[idx];

  const handleRegen = (key: string) => {
    regenPowerSystemItem(parseInt(key, 10));  // /regenerate-power-system-item?system_index=N
  };

  return (
    <div role="tabpanel" id="world-panel-power_system" hidden={activeTop !== "power_system"}
         data-testid="world-panel-power_system">
      <SubTabStrip
        tabs={subTabs}
        active={activeSubTab || "0"}
        onChange={onSubTabChange}
        onRegenerate={handleRegen}
        testidPrefix="world-tab-power-system-subtab"
        disabled={busy}
      />
      <div data-testid={`world-tab-power-system-subtab-panel-${activeSubTab}`} className="mt-3">
        <PowerSystemCard
          index={idx}
          ps={ps}
          onUpdateField={(field, v) => updatePowerSystemField(idx, field, v)}
          onRegenerate={() => handleRegen(String(idx))}   // 卡片右上角 ↻ 保留,与 sub-tab ↻ 同源
          onRemove={() => removePowerSystem(idx)}
          saving={busy}
        />
      </div>
      <div className="flex justify-center pt-3">
        <button data-testid="world-power-system-add" onClick={addPowerSystem} disabled={busy}
                className="secondary-button-style">
          <span className="material-symbols-outlined text-xs">add</span>
          添加体系
        </button>
      </div>
    </div>
  );
}
```

要点：
- `items.length === 0` → 渲染空态 CTA "生成首个体系"，**不渲染** sub-tab 条
- sub-tab 标题用 `stripParenthetical(name)`；若简化后为空字符串（极少见：name 全是括号），fallback 到 `体系 ${i+1}`
- `activeSubTab` 初始为空字符串（state 初值），首次进入 power_system 时由 `onSubTabChange("0")` 兜底为第一个
- `PowerSystemCard` 卡片右上角的 ↻ **保留**（testid `world-power-system-{i}-regenerate`），与 sub-tab ↻ **互为冗余入口**，两者调用同一 handler
- `×` 删除按钮保留（testid `world-power-system-{i}-remove`）；删除后 `activeSubTab` **不自动跳**，由用户手动点其他 sub-tab

### 修订 D: `CoreRulesPanel` 按维度数 sub-tab

```tsx
const CORE_RULE_CATEGORIES = [
  { key: "physical",     label: "物理公理",         source: "ontology" },
  { key: "social",       label: "结构性瓶颈",       source: "power_structure" },
  { key: "narrative",    label: "解决路径封闭性",   source: "narrative_physics" },
  { key: "protagonist",  label: "主角机制硬约束",   source: "protagonist_engine" },
] as const;

function CoreRulesPanel({ world, setWorld, busy, activeSubTab, onSubTabChange }) {
  const grouped = useMemo(() => {
    const g: Record<string, string[]> = { physical: [], social: [], narrative: [], protagonist: [] };
    for (const r of world.core_rules ?? []) {
      const cat = (r as any).category ?? "physical";
      if (!g[cat]) g[cat] = [];
      g[cat].push((r as any).text ?? "");
    }
    return g;
  }, [world.core_rules]);

  // 仅渲染出现过的 category（与现状对齐 — 实际项目通常不全 4 类）
  const presentCategories = CORE_RULE_CATEGORIES.filter(c => grouped[c.key].length > 0);

  if (presentCategories.length === 0) {
    return (
      <div role="tabpanel" id="world-panel-core_rules" hidden={activeTop !== "core_rules"}
           data-testid="world-panel-core_rules">
        <div data-testid="world-core-rules-empty" className="text-center py-6 space-y-3">
          <p className="text-sm text-on-surface-variant">还没有核心规则</p>
          <button data-testid="world-core-rules-generate-first" onClick={generateFirstCoreRules}
                  disabled={busy} className="primary-button-style">
            <span className="material-symbols-outlined text-sm">auto_awesome</span>
            生成核心规则
          </button>
        </div>
      </div>
    );
  }

  const subTabs = presentCategories.map(c => ({
    key: c.key,
    label: c.label,
    testidSuffix: c.key,
  }));

  const cat = activeSubTab && presentCategories.find(c => c.key === activeSubTab)
    ? activeSubTab
    : presentCategories[0].key;

  const handleRegen = (key: string) => {
    regenCoreRuleCategory(key);  // /regenerate-world-section?section=core_rules&category=<key>
  };

  return (
    <div role="tabpanel" id="world-panel-core_rules" hidden={activeTop !== "core_rules"}
         data-testid="world-panel-core_rules">
      <SubTabStrip
        tabs={subTabs}
        active={cat}
        onChange={onSubTabChange}
        onRegenerate={handleRegen}
        testidPrefix="world-tab-core-rules-subtab"
        disabled={busy}
      />
      <div data-testid={`world-tab-core-rules-subtab-panel-${cat}`} className="mt-3 space-y-2">
        <CategoryGroup
          category={cat}
          label={CORE_RULE_CATEGORIES.find(c => c.key === cat)!.label}
          source={CORE_RULE_CATEGORIES.find(c => c.key === cat)!.source}
          rules={grouped[cat]}
          onChange={(t) => setCategoryRules(cat, t)}
          saving={busy}
        />
      </div>
    </div>
  );
}
```

要点：
- **保留现状的 `<details>` 折叠逻辑**（`CategoryGroup` 不变），只是把它放进 sub-tab panel 内
- sub-tab 仅显示**实际出现过规则**的 category（与现状一致 — 4 个 category 不全 4 类都有）
- `activeSubTab` 默认 fallback 到 `presentCategories[0].key`（保证 active 永远指向有效 category）
- 当用户删除某 category 最后一条规则使该 category 从 presentCategories 移除时，`activeSubTab` 可能指向已不存在的 category → fallback 到第一个存在的 category
- 空态 CTA "生成核心规则" 调用 `generateWorldSection("core_rules")`（现有 API，无需新端点）

### 修订 E: `FactionsPanel` 按势力数 sub-tab

```tsx
function FactionsPanel({ world, setWorld, busy, activeSubTab, onSubTabChange }) {
  const items = world.factions ?? [];

  if (items.length === 0) {
    return (
      <div role="tabpanel" id="world-panel-factions" hidden={activeTop !== "factions"}
           data-testid="world-panel-factions">
        <div data-testid="world-faction-empty" className="text-center py-6 space-y-3">
          <p className="text-sm text-on-surface-variant">还没有势力</p>
          <button data-testid="world-faction-generate-first" onClick={addFirstFaction}
                  disabled={busy} className="primary-button-style">
            <span className="material-symbols-outlined text-sm">auto_awesome</span>
            生成首个势力
          </button>
        </div>
      </div>
    );
  }

  const subTabs = items.map((f, i) => ({
    key: String(i),
    label: stripParenthetical(f.name) || `势力 ${i + 1}`,
    testidSuffix: String(i),
  }));

  const idx = parseInt(activeSubTab || "0", 10);
  const faction = items[idx];

  const handleRegen = (key: string) => {
    regenFaction(parseInt(key, 10));  // /regenerate-faction?faction_index=N (新增)
  };

  return (
    <div role="tabpanel" id="world-panel-factions" hidden={activeTop !== "factions"}
         data-testid="world-panel-factions">
      <SubTabStrip
        tabs={subTabs}
        active={activeSubTab || "0"}
        onChange={onSubTabChange}
        onRegenerate={handleRegen}
        testidPrefix="world-tab-factions-subtab"
        disabled={busy}
      />
      <div data-testid={`world-tab-factions-subtab-panel-${activeSubTab}`} className="mt-3">
        <FactionCard
          index={idx}
          faction={faction}
          onUpdateField={(field, v) => updateFactionField(idx, field, v)}
          onRegenerate={() => handleRegen(String(idx))}   // 卡片右上角 ↻ 保留
          onRemove={() => removeFaction(idx)}
          saving={busy}
        />
      </div>
      <div className="flex justify-center pt-3">
        <button data-testid="world-faction-add" onClick={addFaction} disabled={busy}
                className="secondary-button-style">
          <span className="material-symbols-outlined text-xs">add</span>
          添加势力
        </button>
      </div>
    </div>
  );
}
```

要点：
- 形态与 `PowerSystemsPanel` 完全对称
- 沿用现状 `FactionCard` 组件，卡片右上角的 ↻ 与 sub-tab ↻ 互为冗余入口
- `regenFaction(idx)` 调用**新增**的 `/regenerate-faction?faction_index=N`（见修订 G）

### 修订 F: 后端扩展 `/regenerate-world-section`

文件: `backend/api/stage2_world_char.py`

```python
class RegenerateWorldSectionPayload(BaseModel):  # 命名沿用现状,扩展字段
    section: Literal["era", "power_system", "core_rules", "factions"]
    field: Optional[Literal["era", "geography",
                            "era_social_structure", "era_cultural_history"]] = None
    category: Optional[CoreRuleCategory] = None
    system_source: Optional[PowerSystemSource] = None
    user_modifications: str = Field(default="", max_length=1700)

    @model_validator(mode="after")
    def _check_dimensions_mutually_exclusive(self):
        # field / system_source / category 三选一(或全空 = 整组旧行为)
        non_null = sum(1 for x in (self.field, self.category, self.system_source) if x is not None)
        if non_null > 1:
            raise ValueError("field / category / system_source 互斥, 同时只能传一个")
        # field 仅在 section=="era" 时生效
        if self.field is not None and self.section != "era":
            raise ValueError("field 参数仅在 section='era' 时生效")
        # category 仅在 section=="core_rules" 时生效
        if self.category is not None and self.section != "core_rules":
            raise ValueError("category 参数仅在 section='core_rules' 时生效")
        # system_source 仅在 section=="power_system" 时生效
        if self.system_source is not None and self.section != "power_system":
            raise ValueError("system_source 参数仅在 section='power_system' 时生效")
        return self


@router.post("/regenerate-world-section")
async def regenerate_world_section(project_id: str, payload: RegenerateWorldSectionPayload) -> dict:
    # 现状已有分支: section=="core_rules" & category / section=="power_systems" & system_source
    # 新增分支:
    if payload.section == "era":
        if payload.field is not None:
            # 新行为: 仅替换目标 era 字段,其他 3 个 era 字段 byte-preserve
            merged = dict(existing)
            merged[payload.field] = result.get(payload.field, existing.get(payload.field, ""))
        else:
            # 旧行为: era 整组 (4 个字段一起重生)
            for key in ERA_BLOCK_KEYS:
                merged[key] = result.get(key, existing.get(key, ""))
    # 其余分支不变
```

要点：
- `section="era"` 时:
  - `field=X` → 只改 `world[X]`，其他 3 个 era 字段保留
  - `field=None` → 旧行为（4 个字段一起重生，沿用 `ERA_BLOCK_KEYS`）
- `field` / `category` / `system_source` 互斥（payload validator 显式声明），且每个 dim 仅在对应 section 下生效（防止误传）
- `section` 取值与现状完全一致（4 个），不变更
- 路由签名不变（仍是 `/regenerate-world-section`），前端调用方式不变

### 修订 G: 后端新增 `/regenerate-faction`

文件: `backend/api/stage2_world_char.py`

```python
class RegenerateFactionPayload(BaseModel):
    faction_index: int = Field(ge=0)
    user_modifications: str = Field(default="", max_length=1700)


@router.post("/regenerate-faction")
def regenerate_faction(project_id: str, payload: RegenerateFactionPayload) -> dict:
    """Mirror of regenerate-power-system-item: 只重写 factions[faction_index], 其余不动。

    行为契约:
    - faction_index 越界 → 422
    - factions[] 现有条数 = N → 重生后仍是 N 条, 第 i 个被替换
    - 调用 user_modifications 时与 power-system-item 一致
    """
    factions = existing.get("factions", [])
    if payload.faction_index >= len(factions):
        raise HTTPException(422, f"faction_index {payload.faction_index} 越界 (现有 {len(factions)} 条)")
    # 调用 LLM, prompt 给出"只重生第 N 条势力,其他势力原样保留"的指令
    ...
    new_faction = result["factions"][0]  # 期望 LLM 返回单条
    merged_factions = list(factions)
    merged_factions[payload.faction_index] = new_faction
    save_world(project_id, {"factions": merged_factions})
    return {"factions": merged_factions}
```

要点：
- 端点命名与 `/regenerate-power-system-item` 对称
- 行为契约：`faction_index` 越界返回 422；不传 `faction_index` 也返回 422（必填）
- prompt 处理：在现有 `world_generation.yaml` 已有 `user_modifications` 拼接逻辑基础上，加一个 `faction_only_index` 引导语（见下）

**配套 prompt 改动**：`backend/prompts/world_generation.yaml` 在 `user_modifications` 拼接段后加一段（仅在调用 `/regenerate-faction` 时附加）:

```yaml
{faction_only_index}  # 留空 = 全量;非空 = "只重生第 N 条势力,其余不变"
```

调用端处理：

```python
# /regenerate-faction handler 内
extra = f"【单条重生】仅重生 factions[{payload.faction_index}],其余 {N-1} 条势力原样保留。返回 JSON 时只包含一条新的 faction 对象。"
user_modifications = (payload.user_modifications + "\n" + extra).strip()
result, _resp = await agent.generate_world(
    ...,
    user_modifications=user_modifications,
    decompose_data=decompose_data,
    faction_only_index=f"仅修改第 {payload.faction_index} 条",
)
```

**调用方签名改动**：

- `PlannerAgent.generate_world(...)` 需新增 `faction_only_index: str = ""` 入参并透传给 `format_user(**kwargs)`
- 3 个现有调用方（`generate_world` 初版 API、`/regenerate-world-section`、`/regenerate-power-system-item`）必须显式传 `faction_only_index=""`（避免 TypeError — Pydantic 不会因此默认值兜底，因为 `format_user` 走的是 `**kwargs` 透传）
- `/regenerate-faction` 是唯一传非空 `faction_only_index` 的调用方

> 备注：`faction_only_index` 是新增占位符，**必须在 `test_world_generation_prompt_format.py` 的 `GENERATE_WORLD_KWARGS` 中补上**，避免再次触发 2026-09-20 那次 KeyError 教训（见 `feedback_prompt_yaml_brace_escape.md`）。

### 修订 H: `WorldStep` 主组件 state

```tsx
function WorldStep({ ... }: WorldStepProps) {
  const [activeTop, setActiveTop] = useState<WorldTabKey>("era");

  // 每顶级 tab 各自记忆 active sub-tab
  // 初值:
  //   era: "era"                   (默认第一字段)
  //   power_system: ""             (空 → 渲染空态 CTA)
  //   core_rules: ""               (空 → 渲染空态 CTA)
  //   factions: ""                 (空 → 渲染空态 CTA)
  const [subTab, setSubTab] = useState<Record<WorldTabKey, string>>({
    era: "era",
    power_system: "",
    core_rules: "",
    factions: "",
  });

  const handleSubTabChange = (topKey: WorldTabKey) => (key: string) => {
    setSubTab(prev => ({ ...prev, [topKey]: key }));
  };

  const renderActivePanel = () => {
    switch (activeTop) {
      case "era":
        return <EraPanel
          world={world} setWorld={setWorld} busy={busy}
          activeSubTab={subTab.era}
          onSubTabChange={handleSubTabChange("era")}
        />;
      case "power_system":
        return <PowerSystemsPanel
          world={world} setWorld={setWorld} busy={busy}
          activeSubTab={subTab.power_system}
          onSubTabChange={handleSubTabChange("power_system")}
        />;
      case "core_rules":
        return <CoreRulesPanel
          world={world} setWorld={setWorld} busy={busy}
          activeSubTab={subTab.core_rules}
          onSubTabChange={handleSubTabChange("core_rules")}
        />;
      case "factions":
        return <FactionsPanel
          world={world} setWorld={setWorld} busy={busy}
          activeSubTab={subTab.factions}
          onSubTabChange={handleSubTabChange("factions")}
        />;
    }
  };

  return (
    <div data-testid="world-step">
      <WorldTabs activeKey={activeTop} ... />
      {/* 4 个 panel 全部渲染在 DOM,非 active 用 `hidden` 隐藏 (沿用
         `2026-09-20-worldview-tab-refactor-design.md` 第 60-63 行的约束 — 保留
         testid 可定位,单测零侵入);仅 sub-tab 内的内容由 `activeTop` 联动隐藏 */}
      <EraPanel ... hidden={activeTop !== "era"} />
      <PowerSystemsPanel ... hidden={activeTop !== "power_system"} />
      <CoreRulesPanel ... hidden={activeTop !== "core_rules"} />
      <FactionsPanel ... hidden={activeTop !== "factions"} />
    </div>
  );
}
```

要点：
- 切换 `activeTop` 时**不重置 `subTab`**（React state 跨 setState 自然保留），实现"每顶级 tab 各自记忆 active sub-tab"
- 新增 / 删除条目时**不主动调** `setSubTab`，用户停留在原 active sub-tab（即使其内容变空）
- 4 个 panel **都**渲染在 DOM（沿用 `hidden` 属性模式），与 `2026-09-20-worldview-tab-refactor-design.md` 顶级 tab 模式一致 — 不渲染会破坏现有 testid 可定位性

### 修订 I: 空态 CTA 按钮

文件: `frontend/src/components/wizard/WorldStep.tsx`

3 个空态 CTA 行为（`PowerSystemsPanel` / `CoreRulesPanel` / `FactionsPanel` 各一个）:

| CTA testid | 调用 |
|---|---|
| `world-power-system-generate-first` | 复用 `regenerateWorldSection("power_systems")`（LLM 会生成 1~3 个体系）；生成成功后 `setSubTab` 把 `power_system` 设为 `"0"`，让用户立即看到结果 |
| `world-core-rules-generate-first` | 复用 `regenerateWorldSection("core_rules")`；同上 |
| `world-faction-generate-first` | 复用 `regenerateWorldSection("factions")`；同上 |

**注**：CTA 触发后**主动调** `setSubTab`（与"增删不自动跳"原则相悖，但此处是用户显式点 CTA 期望看到结果的合理例外）。

### 修订 J: 前端测试更新

文件: `frontend/src/test/WorldStep.test.tsx` + `frontend/src/test/InitWizardModal.test.tsx`

新增用例（不动旧用例）：
1. `it("renders 4 era sub-tabs")` — 验证 `world-tab-era-subtab-{era|geography|social-structure|cultural-history}` 全部存在
2. `it("renders N power-system sub-tabs based on length")` — 验证 N=0 → 空态 CTA；N=3 → 3 个 sub-tab 标题 = `stripParenthetical(ps.name)`
3. `it("renders core-rule sub-tabs only for present categories")` — 验证只有 `physical` 有规则时只渲染 `物理公理` 一个 sub-tab
4. `it("renders N faction sub-tabs based on length")` — 对称 power-system
5. `it("remembers sub-tab active across top-level tab switch")` — 切换 `era → power_system → era`，验证 `world-tab-era-subtab` 的 `aria-selected` 仍指向切换前的 key
6. `it("clicking sub-tab regenerate fires section regenerate with correct key")` — mock `api.regenerateWorldSection`，验证 era 字段 / core_rules category / power_system item / faction 都传对了 key
7. `it("does not auto-jump sub-tab on add or remove")` — 删 sub-tab 当前 active 项，验证 active sub-tab 不变

更新用例（旧 section regenerate testid 已废）：
- 沿用 `2026-09-20-worldview-tab-refactor-design.md` 第 252-263 行的清单；本轮不改这部分 testid（顶级 tab ↻ 仍是 `world-tab-{key}-regenerate`，与 sub-tab ↻ 是不同 testid）

### 修订 K: 后端测试

文件: `backend/tests/test_regenerate_world_section_field.py`（新增）

```python
def test_regenerate_era_field_only_writes_target_field():
    """section=era&field=geography 时, world[geography] 改变, 其他 3 个字段 (era / era_social_structure / era_cultural_history) 不变。"""

def test_regenerate_era_field_422_on_unknown_field():
    """section=era 但 field 缺失 / 非法 → 422."""

def test_regenerate_era_field_keeps_user_modifications():
    """user_modifications 仍透传, 与 power-system-item 行为一致."""
```

文件: `backend/tests/test_regenerate_faction.py`（新增）

```python
def test_regenerate_faction_only_writes_target_index():
    """faction_index=1 时, factions[1] 改变, factions[0] / factions[2] 不变."""

def test_regenerate_faction_422_on_out_of_range_index():
    """faction_index >= len(factions) → 422."""

def test_regenerate_faction_prompt_includes_only_index_hint():
    """验证 prompt 拼接的 faction_only_index 占位符正确填充."""
```

文件: `backend/tests/test_world_generation_prompt_format.py`（更新）

```python
GENERATE_WORLD_KWARGS = {
    ...,
    "faction_only_index": "",  # 新增占位符 — 必须随每次新增 prompt 占位符同步追加
}
```

> 备注：该测试文件是 prompt 占位符完整性的"防漏网"基线。每次 `world_generation.yaml` 新增 `{xxx}` 占位符,都要同步更新 `GENERATE_WORLD_KWARGS` + 必要时新增断言。详见 `feedback_prompt_yaml_brace_escape.md`。

## 6. 实施顺序

```
A SubTabStrip 内部组件                   ~半天
 ↓
F 后端扩展 /regenerate-world-section      ~半天
 ↓
G 后端新增 /regenerate-faction            ~半天
 ↓
H WorldStep state + 子组件参数透传        ~半天
 ↓
B EraPanel 4 字段 sub-tab                 ~半天
 ↓
C PowerSystemsPanel sub-tab 模式          ~半天
 ↓
D CoreRulesPanel sub-tab 模式             ~半天
 ↓
E FactionsPanel sub-tab 模式              ~半天
 ↓
I 空态 CTA 按钮 (3 个)                   ~半天
 ↓
J 前端测试用例                            ~1 天
 ↓
K 后端测试用例                            ~1 天
```

总计 ~5-6 工作日（单人，顺序）。A → F / G 解耦后 F / G 可与 A 并行；J / K 必须等 J 完成 B-E 才能跑（依赖组件存在）。

## 7. 风险与回退

| 风险 | 触发条件 | 应对 |
|---|---|---|
| WorldStep 主组件行数继续膨胀 | 加 SubTabStrip + 4 个 panel 改造后行数可能从 ~950 → ~1300 | 控制在 +400 行内（SubTabStrip 80 行 + 各 panel ~50 行净增）；若超界，下一轮再考虑拆 WorldStep.tsx 为 WorldStep/index.ts + sub-files |
| `stripParenthetical` 处理不规范的体系名 | name 含英文括号 `(...)` 或嵌套括号时规则不覆盖 | 仅处理 `（[^）]*）` 中文括号；其他形式 fallback 到原 name（用户可手动改） |
| `faction_only_index` 占位符拼写遗漏 | 新占位符未加入 `GENERATE_WORLD_KWARGS` 测试 → str.format() KeyError | 修订 K 显式列出新增占位符 + `test_world_generation_prompt_format.py` 同步更新 |
| 切换顶级 tab 时 sub-tab stale | state 跨 setState 自然保留是 feature，但用户期待"切回时默认第一项"时不符合预期 | 通过 J 用例 5 锁定行为；用户调研后再调整 |
| 删除当前 active sub-tab 对应条目后 UI 显示空白 | 增删不自动跳原则 | J 用例 7 锁定；用户点其他 sub-tab 或点空态 CTA 解决 |
| 空态 CTA 调用 `regenerateWorldSection` 后 LLM 返回 0 条 | LLM 不稳定 | 沿用现状 `regenerateWorldSection` 已有的 fallback 逻辑（不新增处理） |
| 嵌套 `<span role="button">` a11y 警告 | 沿用顶级 tab 既有写法，已被用户接受 | 风险同 `2026-09-20-worldview-tab-refactor-design.md` 第 289 行 |
| sticky top 高度计算偏差 | `--world-tabs-h` CSS 变量估算 40px 不准 | 初版允许偏差；用 Chrome DevTools 实测调整后再固化 |
| `useSectionRegenerate` hook 不支持 4 个 sub-tab 并发 | busy 状态锁住整个 WorldStep | 沿用 hook 现有"single-flight"行为，不在本轮优化 |

## 8. 验收标准

- [ ] `WorldStep.tsx` 文件存在内部 `SubTabStrip` 组件
- [ ] `EraPanel` 顶部渲染 4 个 sub-tab（时代背景 / 地理环境 / 社会结构 / 历史文化），testid `world-tab-era-subtab-{era|geography|social-structure|cultural-history}` 全部存在
- [ ] `EraPanel` sub-tab ↻ 调用 `/regenerate-world-section?section=era&field=<key>`，仅改对应字段
- [ ] `PowerSystemsPanel` 在 `power_systems.length === 0` 时渲染 `world-power-system-empty` CTA "生成首个体系"，不渲染 sub-tab 条
- [ ] `PowerSystemsPanel` 在 `power_systems.length >= 1` 时按数量渲染 sub-tab，标题 = `stripParenthetical(ps.name)`；testid `world-tab-power-system-subtab-{i}` 全部存在
- [ ] `CoreRulesPanel` 仅渲染出现过的 category sub-tab（最多 4 个）；testid `world-tab-core-rules-subtab-{physical|social|narrative|protagonist}` 只在对应 category 有规则时存在
- [ ] `FactionsPanel` 与 PowerSystems对称，sub-tab 标题用 `stripParenthetical`
- [ ] 切换顶级 tab 后切回，active sub-tab 不重置
- [ ] 新增 / 删除 power_system / faction，active sub-tab **不**自动跳
- [ ] 后端 `/regenerate-world-section` 支持 `section=era&field=<era|geography|era_social_structure|era_cultural_history>` 4 个细粒度值
- [ ] 后端 `/regenerate-faction?faction_index=N` 端点存在，`faction_index` 越界返回 422
- [ ] `test_world_generation_prompt_format.py` 更新包含 `faction_only_index` 占位符，全过
- [ ] `pytest backend/tests/test_regenerate_world_section_field.py backend/tests/test_regenerate_faction.py` 全过
- [ ] `cd frontend && npm test` 全过（含 J 新增 7 个用例）

## 9. 决策记录

用户在 2026-09-20 brainstorming 阶段确认以下决策:

| 决策 | 选择 | 理由 |
|---|---|---|
| 命名简化规则 | **去掉中文括号后缀** | 实测 power_system 名常带"（非常规主角能力体系）"20+ 字;strip 中文括号最简单,视觉一致性最高 |
| 世界规则维度名 | **中文标签** (物理公理 / 结构性瓶颈 / 解决路径封闭性 / 主角机制硬约束) | 与 system_prompt 一致;网文用户不读英文 category stem |
| 空态表现 | **隐藏 sub-tab 条,显示空态 CTA** | n=0 时不可能有「单个子项」,诚实表达;避免出现「(无)」空 tab 视觉噪音 |
| active 状态 | **每顶级 tab 各自记忆;增删不自动跳** | 切换顶级 tab 体验连贯;新增/删除不抢占用户当前焦点 |
| 后端端点 | **扩 + 加** | 复用 `/regenerate-world-section` 加 field;新增 `/regenerate-faction` 对称 power-system-item;总表面最小 |
| sub-tab ↻ 粒度 | **per-subtab** | 每个 sub-tab 各自独立重生成;core_rules/power_systems 已支持,era 需新增 field,faction 需新增端点 |

## 10. 不在本期范围

- Stage 3 (outline) / Stage 4 (scene) 任何使用 `world.power_systems` / `world.factions` / `world.core_rules` 的下游消费侧优化
- SubTabStrip 抽离到 `frontend/src/components/ds/`（等第二处使用再抽）
- sub-tab ↻ 批量重生成（一次重生成所有 sub-tab）或并发控制（沿用 `useSectionRegenerate` single-flight）
- 把 PowerSystemCard / FactionCard 的 ↻ 移除（保留卡片级 ↻,与 sub-tab ↻ 互为冗余入口,降低用户学习成本）
- 势力合并 / 拆分（项目结构允许多条独立势力,本期仅展示与编辑）
- core_rules sub-tab 显示当前 category 条数 badge（4 个 category 全开,信息冗余）
- 对 Prompt Plaza 暴露 `world_generation.yaml`（与本次 UI 改造解耦）