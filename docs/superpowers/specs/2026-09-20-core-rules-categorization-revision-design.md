# 世界规则(core_rules)散乱问题 修订方案 设计文档

**Date**: 2026-09-20
**Status**: Approved (用户已批准方向 + 3 项决策已锁定,等待 writing-plans 出实现 plan)
**Scope**: 文档 / 后端 schema / 后端 prompt / 前端 UI / API 多层协同修订

## 1. 背景

S2 第一性拆解的 5 维度中,有 4 维度向 `world.core_rules[]` 贡献硬规则:

- **ontology** → 世界凭何成立的物理公理
- **power_structure** → 结构性瓶颈(为何无法突破)
- **narrative_physics** → 解决路径封闭性(为何无法正面解决)
- **protagonist_engine** (`is_irreducible=true`) → 主角机制硬约束

文档 `S2拆解到世界观推演映射.md` 自检表 (line 128) 把 `world.core_rules` 来源只写成 `ontology / narrative_physics`,与 line 32 / 35 / 68 / 103 实际映射自相矛盾。当前 schema `core_rules: list[str]` 无分类、无层级、无来源标签,导致 LLM 把 4 类不同性质硬规则按示例 "世界规则1/2/3" 模板并列输出,UI 用 TagEditor 无差别展示,regenerate 一次整组原子化,最终用户感知为"散乱"。

文档 §"实务建议"(line 149-164)还显式列出 3 个相关断层:
- G1: `protagonist_engine` 没有专属重生成按钮
- G2: `world.geography` 与 `world.era_cultural_history` 在 prompt 里缺少显式推演引导
- G3: `character_generation` prompt 未引用 `protagonist_engine` 单元,与世界观重复生成能力机制

## 2. 修订目标

- `core_rules[]` 每条规则带 `category` 标签(4 选 1)
- LLM 按 category 分别产出,不再混杂
- UI 按 4 个 category 分组渲染(折叠 group,默认 active 展开)
- API 按 category 单独 regenerate(独立 category 字段)
- `protagonist_engine` 派生的 power_system 卡片显式标注来源
- geography / era_cultural_history 在 prompt 中给出由哪两个 S2 维度联合推演
- `character_generation` prompt 引用 `protagonist_engine` 单元避免与世界观重复
- 文档自检表与实际契约一致,文档不再自相矛盾

## 3. 非目标

- 不重做 ontology / power_structure / narrative_physics / protagonist_engine 的 S2 拆解 prompt
- 不动 StoryOS / scene writing 算法(只调整 core_rules 的传入格式)
- 不破坏已存在的 world.json 数据(向后兼容迁移)
- 不强制迁移老项目的展示——前端从旧 list[str] 解析时按缺省 PHYSICAL 兜底

## 4. 修订总览(按依赖顺序)

| 编号 | 内容 | 范围 | 优先级 |
|---|---|---|---|
| **A** | 文档自检表修正 + 新增"core_rules 按维度分组的语义与契约"小节 | docs/design/S2拆解到世界观推演映射.md | P0 |
| **B** | schema 引入 category: `list[str]` → `list[CoreRule{ category, text }]` + 旧数据迁移 | backend/models/world.py | P0 |
| **B2** | PowerSystem 引入 source 字段(`energetics` / `protagonist_engine`)+ 旧数据迁移 | backend/models/world.py | P1(G1) |
| **C** | world_generation prompt: core_rules 按 category 引导 + geography / era_cultural_history 显式推演 | backend/prompts/world_generation.yaml | P0 |
| **D** | writer / scene_rewrite 上下文按 category 分块渲染 | backend/agents/writer.py + scene_rewrite.yaml + scene_writing.yaml | P1 |
| **E** | API `regenerate-world-section` 按 category 拆细粒度(独立 `category` 字段) | backend/api/stage2_world_char.py | P1 |
| **E2** | API `regenerate-world-section` 支持按 `power_system.source` 拆细粒度 | backend/api/stage2_world_char.py | P2(G1) |
| **F** | WorldStep `CoreRulesPanel` UI 按 4 个 category 分组(折叠 group) + PowerSystemsPanel 标注 source | frontend/src/components/wizard/WorldStep.tsx | P1 |
| **G3** | character_generation prompt 引用 protagonist_engine 单元 | backend/prompts/character_generation.yaml | P2 |

A → B → C → E → F → D 是核心修订链;B2 / E2 / G3 是 G workstream 衍生项,与核心链并行/延后。

## 5. 详细方案

### 修订 A: 文档自检表修正

文件: `docs/design/S2拆解到世界观推演映射.md`

**改动 1**: line 128 自检表条目改为:

> `world.core_rules` 世界规则 → ontology / power_structure / narrative_physics / protagonist_engine (is_irreducible=true)
> 说明: 4 维度各自贡献性质不同的硬规则,详见 §X "core_rules 按维度分组的语义与契约"

**改动 2**: 新增章节(放在"反向校验"之后、"跨维度整体上下文"之前):

```markdown
## core_rules 按维度分组的语义与契约

`world.core_rules[]` 接收 4 个维度的硬规则,每条规则带 category 标签,
语义与来源一一对应:

| category | 语义角色 | 来源维度 | LLM 期望产出重点 |
|---|---|---|---|
| `physical` | 世界凭何成立的物理公理 | ontology | 系统边界/天道/根本算法/底层约束 |
| `social` | 社会结构性瓶颈(为何无法突破) | power_structure | 替代方案规模化瓶颈/阶层固化机制 |
| `narrative` | 解决路径封闭性(为何无法正面解决) | narrative_physics | 高阶压迫/核心矛盾的元规则 |
| `protagonist` | 主角机制硬约束 | protagonist_engine (is_irreducible=true) | 主角特殊性的硬规则,违反必有代价 |

契约:

1. 每条 core_rule 必须有且仅有一个 category
2. 不允许"同时属于多类"——LLM 选最贴切的一类
3. 若 ontology / power_structure / narrative_physics 单元未产生对应 category 的规则,
   可以为空数组,但不能整组缺失
4. protagonist category 仅在 protagonist_engine 含 is_irreducible=true 单元时出现
```

### 修订 B: schema 引入 category

文件: `backend/models/world.py`

```python
from enum import Enum

class CoreRuleCategory(str, Enum):
    PHYSICAL = "physical"       # ontology
    SOCIAL = "social"           # power_structure
    NARRATIVE = "narrative"     # narrative_physics
    PROTAGONIST = "protagonist" # protagonist_engine (is_irreducible=true)

class CoreRule(BaseModel):
    category: CoreRuleCategory
    text: str

class World(BaseModel):
    era: str = ""
    geography: str = ""
    era_social_structure: Optional[str] = None
    era_cultural_history: Optional[str] = None
    power_systems: list[PowerSystem] = Field(default_factory=list)
    factions: list[Faction] = []
    core_rules: list[CoreRule] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _migrate_core_rules(cls, data):
        """旧格式 list[str] 自动迁移为 [CoreRule(category=PHYSICAL, text=s)]。
        兜底选 PHYSICAL 因为 ontology 是 core_rules 最大贡献源。
        """
        if not isinstance(data, dict):
            return data
        rules = data.get("core_rules")
        if isinstance(rules, list) and rules and isinstance(rules[0], str):
            data["core_rules"] = [
                {"category": CoreRuleCategory.PHYSICAL.value, "text": r}
                for r in rules if isinstance(r, str)
            ]
        elif rules is None:
            data["core_rules"] = []
        return data
```

**WorldRulesSummary.from_world()** 保留,但内部改用 `r.text for r in world.core_rules`(旧 `core_rules[i]` 字符串访问 → 新 `core_rules[i].text`)。

### 修订 B2: PowerSystem.source 标注

文件: `backend/models/world.py`

```python
class PowerSystemSource(str, Enum):
    ENERGETICS = "energetics"
    PROTAGONIST_ENGINE = "protagonist_engine"

class PowerSystem(BaseModel):
    name: str = ""
    description: str = ""
    stages: list[str] = []
    core_rules: list[str] = []
    ceilings: list[str] = []
    cost_system: Optional[str] = None
    source: PowerSystemSource = PowerSystemSource.ENERGETICS  # 默认 energetics

    @model_validator(mode="before")
    @classmethod
    def _migrate_power_system_source(cls, data):
        """旧 world.json 中 power_systems[] 没有 source 字段,
        默认全部归 energetics(主角非常规体系是 S2 引入后才有的概念)。
        """
        if isinstance(data, dict) and "source" not in data:
            data["source"] = PowerSystemSource.ENERGETICS.value
        return data
```

`_raw_power_systems_list` 保留原行为,但加一个过滤函数 `filter_power_systems_by_source(world, source)` 供后续 E2 使用。

### 修订 C: world_generation prompt 引导

文件: `backend/prompts/world_generation.yaml`

**改动 1**: system_prompt 第 22-23 行后新增一段:

```yaml
8. **世界规则按 4 类硬约束分别产出**(2026-09-20 修订):
   - physical(物理公理)来自 ontology 单元
   - social(结构性瓶颈)来自 power_structure 单元
   - narrative(解决路径封闭性)来自 narrative_physics 单元
   - protagonist(主角机制硬约束)来自 protagonist_engine 中 is_irreducible=true 的单元
   每条 core_rule 必须有且仅有一个 category,选最贴切的一类;
   不得遗漏 4 类中由对应单元自然产出的规则。

9. **力量体系区分来源**(2026-09-20 修订):
   - 体系名称以 dominate(energetics)来源的通用资源命名(如"灵力""真气""斗气")
   - 体系名称以 protagonist_engine 来源的主角非常规能力命名(如"血脉觉醒""天道系统")
   - 每张 power_system 卡必须带 source 字段:"energetics" 或 "protagonist_engine"

10. **联合推演字段显式指引**(2026-09-20 修订):
    - geography 由 ontology [列举 2-3 条单元] + narrative_physics [列举 2-3 条单元] 联合推演
    - era_cultural_history 由 power_structure [列举 2-3 条单元] + narrative_physics [列举 2-3 条单元] 联合推演
    LLM 在生成 era 段时,必须显式参照上述两个 S2 维度的具体单元,不能给空话。
```

**改动 2**: 示例输出 JSON 改为:

```json
"core_rules": [
  {"category": "physical", "text": "世界存在灵气;浓度因地而异,高浓度区有修炼加成"},
  {"category": "social", "text": "灵脉开采权被大燕王朝垄断,各宗门暗中争夺灵脉开采权"},
  {"category": "narrative", "text": "强者不得干预弱者命运,违反者遭天道反噬"},
  {"category": "protagonist", "text": "被天道选中的'寄体'觉醒后必死,且每次使用能力都在加速死亡"}
],
"power_systems": [
  {
    "name": "灵力修炼",
    "description": "吸纳天地灵气强化己身的传统修真体系",
    "stages": ["炼气","筑基","金丹","元婴"],
    "core_rules": ["灵气需经丹田运转方可施展","高阶修士可压制低阶"],
    "cost_system": "每次施法永久损耗寿元",
    "ceilings": ["凡人最多修至金丹","渡劫失败必亡"],
    "source": "energetics"
  },
  {
    "name": "天道寄体系统",
    "description": "主角独有的能力觉醒与代价绑定机制",
    "stages": ["初醒","共鸣","夺权","献祭"],
    "core_rules": ["寄体使用能力即加速死亡","能力不可转让"],
    "cost_system": "寿元消耗与能力强度成正比",
    "ceilings": ["寄体不可突破天道设定的阈值"],
    "source": "protagonist_engine"
  }
],
"era_cultural_history": "...",
"geography": "...",
```

### 修订 D: writer 上下文按 category 分块

文件: `backend/agents/writer.py` (line 429-456)

```python
CATEGORY_LABELS = {
    CoreRuleCategory.PHYSICAL: "物理公理 (ontology)",
    CoreRuleCategory.SOCIAL: "结构性瓶颈 (power_structure)",
    CoreRuleCategory.NARRATIVE: "解决路径封闭性 (narrative_physics)",
    CoreRuleCategory.PROTAGONIST: "主角机制硬约束 (protagonist_engine)",
}

def _format_core_rules_grouped(rules: list[CoreRule]) -> str:
    by_cat: dict[CoreRuleCategory, list[str]] = defaultdict(list)
    for r in rules:
        by_cat[r.category].append(r.text)
    parts = []
    for cat in CoreRuleCategory:
        items = by_cat.get(cat, [])
        if not items:
            continue
        parts.append(f"### {CATEGORY_LABELS[cat]}")
        parts.extend(f"  - {t}" for t in items)
    return "\n".join(parts) if parts else "(无世界规则)"

# writer.py:558-560 调用 _format_core_rules_grouped 替换旧的 "\n".join(...)
```

`scene_writing.yaml` / `scene_rewrite.yaml` 中的 `{core_rules}` 占位符不变,值传入时已经按 category 分块。

### 修订 E: API 按 category 拆细粒度(独立 category 字段)

文件: `backend/api/stage2_world_char.py`

```python
class RegenerateWorldSectionPayload(BaseModel):
    section: str  # era | power_system | core_rules | factions
    category: Optional[CoreRuleCategory] = None  # 仅 section=="core_rules" 时生效
    user_modifications: str = Field(default="", max_length=1700)

# endpoint 内:
if payload.section == "core_rules":
    if payload.category is None:
        # 旧行为:整组重生成
        merged["core_rules"] = result.get("core_rules", existing.get("core_rules", []))
    else:
        # 新行为:仅替换目标 category
        target_cat = payload.category.value
        new_rules = result.get("core_rules", [])
        merged_rules = [
            r for r in existing.get("core_rules", [])
            if r.get("category") != target_cat
        ]
        merged_rules.extend(r for r in new_rules if r.get("category") == target_cat)
        merged["core_rules"] = merged_rules
```

### 修订 E2: API 按 power_system.source 拆细粒度

文件: `backend/api/stage2_world_char.py`

```python
class RegenerateWorldSectionPayload(BaseModel):
    section: str  # era | power_system | core_rules | factions
    category: Optional[CoreRuleCategory] = None
    system_source: Optional[PowerSystemSource] = None  # 仅 section=="power_system" 时生效
    user_modifications: str = Field(default="", max_length=1700)

# endpoint 内:
elif payload.section == "power_system":
    if payload.system_source is None:
        # 旧行为:重生成整组
        merged["power_systems"] = result.get("power_systems", iter_power_systems(existing))
    else:
        # 新行为:仅替换指定 source
        new_systems = result.get("power_systems", [])
        merged_systems = [
            ps for ps in existing.get("power_systems", [])
            if ps.get("source") != payload.system_source.value
        ]
        merged_systems.extend(
            ps for ps in new_systems if ps.get("source") == payload.system_source.value
        )
        merged["power_systems"] = merged_systems
```

### 修订 F: WorldStep UI

文件: `frontend/src/components/wizard/WorldStep.tsx`

**F1. CoreRulesPanel 重构为 4 个折叠 group**

```tsx
function CoreRulesPanel({ active, world, setWorld, busy }) {
  const grouped = useMemo(() => {
    const g: Record<string, string[]> = { physical: [], social: [], narrative: [], protagonist: [] };
    for (const r of world.core_rules ?? []) {
      const cat = (r as any).category ?? "physical";
      if (!g[cat]) g[cat] = [];
      g[cat].push((r as any).text ?? "");
    }
    return g;
  }, [world.core_rules]);

  const setCategory = (cat: string, texts: string[]) => {
    const others = (world.core_rules ?? []).filter(r => (r as any).category !== cat);
    setWorld({
      ...world,
      core_rules: [
        ...others,
        ...texts.map(t => ({ category: cat, text: t })),
      ],
    });
  };

  return (
    <div role="tabpanel" id="world-panel-core_rules" ... hidden={!active}>
      <div data-testid="world-core-rules" className="space-y-2">
        <CategoryGroup category="physical" label="物理公理" source="ontology"
          rules={grouped.physical}
          onChange={t => setCategory("physical", t)} saving={busy} />
        <CategoryGroup category="social" label="结构性瓶颈" source="power_structure"
          rules={grouped.social}
          onChange={t => setCategory("social", t)} saving={busy} />
        <CategoryGroup category="narrative" label="解决路径封闭性" source="narrative_physics"
          rules={grouped.narrative}
          onChange={t => setCategory("narrative", t)} saving={busy} />
        <CategoryGroup category="protagonist" label="主角机制硬约束" source="protagonist_engine"
          rules={grouped.protagonist}
          onChange={t => setCategory("protagonist", t)} saving={busy} />
      </div>
    </div>
  );
}

function CategoryGroup({ category, label, source, rules, onChange, saving }) {
  const [open, setOpen] = useState(true);  // 默认展开, 视觉密度高的项目再选择性折叠
  return (
    <details open={open} data-testid={`world-core-rules-${category}`} className="border border-outline-variant rounded">
      <summary onClick={(e) => { e.preventDefault(); setOpen(!open); }}
        className="cursor-pointer px-3 py-2 flex items-center justify-between hover:bg-surface-container/50">
        <span className="flex items-center gap-2">
          <span className="material-symbols-outlined text-sm">{open ? "expand_less" : "expand_more"}</span>
          <span className="font-medium text-sm">{label}</span>
          <span className="font-mono text-[10px] text-primary-container/70">[{source}]</span>
        </span>
        <span className="font-mono text-[10px] opacity-70" aria-label={`${rules.length} 条`}>{rules.length}</span>
      </summary>
      <div className="px-3 pb-3">
        <TagEditor items={rules} onItemsChange={onChange} saving={saving} />
      </div>
    </details>
  );
}
```

`world-core-rules` 保留(向后兼容);新增 `world-core-rules-{category}`。

**F2. PowerSystemsPanel 卡片标注 source**

```tsx
function PowerSystemsPanel({ ... }) {
  return (
    <div ...>
      <div data-testid="world-power-systems" className="space-y-3">
        {world.power_systems.map((ps, i) => (
          <div
            data-testid={`world-power-system-${i}`}
            className={
              "border rounded p-3 space-y-2 relative " +
              (ps.source === "protagonist_engine"
                ? "border-primary-container/60 bg-primary-container/5"
                : "border-outline-variant")
            }
          >
            <div className="absolute top-2 right-2 flex items-center gap-1">
              {ps.source === "protagonist_engine" && (
                <span data-testid={`world-power-system-${i}-source-badge`}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary-container/20 text-primary-container">
                  主角能力
                </span>
              )}
              <SectionRegenerateButton ... />
              <button ...>×</button>
            </div>
            ...
          </div>
        ))}
      </div>
    </div>
  );
}
```

`WorldTabs.onRegenerate` 中 `key="power_system"` 不变(整组重生成走旧行为);新增 `onRegenerateBySource(source)` 供 per-source regenerate UI hook 后续添加(本期不暴露给 wizard footer,仅 API 端支持)。

### 修订 G3: character_generation prompt 引用 protagonist_engine

文件: `backend/prompts/character_generation.yaml`

system_prompt 加一段:

```yaml
【protagonist_engine 单元参考】(避免与世界观重复生成能力机制):
{protagonist_engine_units}

角色卡的"能力机制"应只描述:
1. 主角对外伪装/限制机制(不在世界层)
2. 输出表象(如何使用能力,不在世界层)
3. 能力的输入触发条件在主角身上的具体表现(可与世界观规则一致,作为引用)

不得重新定义:
- 世界观层已经记录的 power_systems[] 体系内部规则
- core_rules[].protagonist category 中已经存在的硬约束
```

## 6. 实施顺序

```
A 文档修正(零代码,~30 分钟)
 ↓
B schema 改造 + 旧数据迁移测试(后端核心,~1 天)
 ↓
B2 PowerSystem.source + 迁移测试(G1,~半天)
 ↓
C world_generation prompt 改造(LLM 输出契约,~半天)
 ↓
E API 拆细粒度(独立 category 字段,~半天)
 ↓
E2 API 按 power_system.source 拆细粒度(G1,~半天)
 ↓
F 前端 UI 重构 + 测试(WorldStep CoreRulesPanel + PowerSystemsPanel,~1 天)
 ↓
D writer 上下文渲染调整(下游消费者适配,~半天)
 ↓
G3 character_generation prompt 引用 protagonist_engine(G3,~半天)
```

总计 ~4-5 工作日(单人,顺序)。

## 7. 风险与回退

| 风险 | 触发条件 | 应对 |
|---|---|---|
| LLM 不遵循 category 输出 | prompt 升级后仍输出 `{"text": "..."}` 无 category | system_prompt 强化要求;若仍缺失,model_validator fallback 归 PHYSICAL |
| 旧 world.json 迁移后语义丢失 | 旧 list[str] 一律归 PHYSICAL 不准确 | 可接受轻度信息丢失;老项目重新 regenerate 即可重分 |
| scene writing 测试断言失败 | core_rules 渲染格式变(分组小标题) | 调整对应测试断言;保持小标题"### 物理公理 (ontology)" 等明确格式 |
| 前端 UI 改动破坏现有 WorldStep 测试 | WorldStep.test.tsx + InitWizardModal.test.tsx 涉及 core_rules 断言 | 保留外层 `world-core-rules` testid;新增 `world-core-rules-{category}` |
| regenerate-power-system-item API 与新 source 字段冲突 | 用户已传 `system_source` 但旧调用没传 | payload.system_source Optional,旧调用不受影响 |
| WorldStep 主组件变大 | CategoryGroup + 新折叠 state 拉长文件 | 控制在 +150 行内,与 CoreRulesPanel 总长 < 250 行 |
| character_generation prompt 注入 protagonist_engine units 后行数变长 | 影响 token 预算 | units 截断到前 3 条 (is_irreducible 优先);< 600 tokens |

## 8. 验收标准

- [ ] 文档 `S2拆解到世界观推演映射.md` 自检表与 line 32/35/68/103 一致,且新增"core_rules 按维度分组的语义与契约"章节
- [ ] 新建项目生成的 world.json 中,每条 core_rule 都有 category 字段
- [ ] 老项目 world.json 加载后,core_rules 全部归 PHYSICAL,power_systems 全部 source="energetics",不报错
- [ ] regenerate-world-section 支持 `section=core_rules & category=physical|social|narrative|protagonist` 4 个细粒度值
- [ ] regenerate-world-section 支持 `section=power_system & system_source=energetics|protagonist_engine` 2 个细粒度值
- [ ] WorldStep CoreRulesPanel 按 4 个 category 折叠 group 渲染,testid `world-core-rules-{category}` 全部存在
- [ ] WorldStep PowerSystemsPanel 主角来源卡片有"主角能力"徽章,testid `world-power-system-{i}-source-badge` 在 source=="protagonist_engine" 时存在
- [ ] writer 上下文注入的 core_rules 含分类小标题,scene writing 行为不变
- [ ] character_generation prompt 含 `{protagonist_engine_units}` 占位符与"不得重复定义"约束
- [ ] 测试: `pytest tests/test_world*.py` 全过; `cd frontend && npx vitest run src/test/WorldStep*.test.tsx src/test/InitWizardModal.test.tsx` 全过

## 9. 决策记录

用户在 2026-09-20 brainstorming 阶段确认以下决策:

| 决策 | 选择 | 理由 |
|---|---|---|
| G workstream 是否纳入 | **全部纳入** | 用户希望一次性解决所有相关断层,避免后续回炉 |
| regenerate 端点 category 形态 | **独立 category 字段** | payload model 显式声明,前端传值无歧义;字符串拼接需要 parser 容错 |
| UI 形态 | **4 个折叠 group** | 视觉密度可控,用户主动折叠不需要的 category;4 个 group 默认全部展开 (单一物理公理折叠后, 4 个 category 总高度合理) |

## 10. 不在本期范围

- Stage 3 (outline) / Stage 4 (scene) 的 core_rules 二次消费侧优化(只动 D,其它读 core_rules 的模块需要 grep + 适配,但属于"调用方代码"自保证)
- Prompt Plaza 暴露 `world_generation.yaml` 给用户自定义(目前未暴露)
- 旧 list[str] world.json 的"语义无损迁移"——已接受"全部归 PHYSICAL"为迁移策略