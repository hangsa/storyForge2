# core_rules 散乱问题修订 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `world.core_rules[]` 从无分类的 `list[str]` 升级为 `list[CoreRule{ category, text }]`,4 个 category (physical / social / narrative / protagonist) 对应 4 个 S2 拆解维度;同步把 `PowerSystem.source` 标注、world_generation prompt、API 拆细粒度、WorldStep UI、writer 上下文、character_generation prompt 全部按 category 化契约升级。

**Architecture:** 自底向上 5 层同步升级 — schema 先行(后端读所有 world.json 的入口),然后 prompt 引导 LLM 按新契约写,API 拆细粒度支持按 category 单独 regenerate,前端 UI 按折叠 group 渲染,writer 下游按 category 分块注入。

**Tech Stack:** Python 3.11 (FastAPI + Pydantic v2) / React 18 + TypeScript + Tailwind / YAML prompts / pytest + vitest

---

## 文件改动范围

| 文件 | 改动 | 任务 |
|---|---|---|
| `docs/design/S2拆解到世界观推演映射.md` | 自检表 + 新增"按维度分组的语义与契约"章节 | Task 1 |
| `backend/models/world.py` | 加 `CoreRuleCategory` / `CoreRule` / `PowerSystemSource` + World 字段迁移 | Task 2, Task 3 |
| `backend/prompts/world_generation.yaml` | system_prompt 加 4 类硬规则引导 + 示例输出改 category + 联合推演字段 | Task 4 |
| `backend/api/stage2_world_char.py` | `RegenerateWorldSectionPayload` 加 `category` / `system_source` 字段 + 分支逻辑 | Task 5, Task 6 |
| `frontend/src/components/wizard/WorldStep.tsx` | `CoreRulesPanel` 重构 + 新增 `CategoryGroup`;`PowerSystemsPanel` 加 source 徽章 | Task 7 |
| `frontend/src/test/WorldStep.tabs.test.tsx` | 加 category group 测试 + source badge 测试 | Task 7 |
| `backend/agents/writer.py` | 新增 `_format_core_rules_grouped`,替换旧 flat 渲染 | Task 8 |
| `backend/prompts/character_generation.yaml` | 加 `{protagonist_engine_units}` 占位符 + "不得重复定义"约束 | Task 9 |

不删除任何现有文件(读者场景: 老 `list[str]` world.json 自动迁移, 老调用方不受影响)。

---

## Task 1: 修订 A — 文档自检表修正

**Files:**
- Modify: `docs/design/S2拆解到世界观推演映射.md` (line 128 + 新增章节)

- [ ] **Step 1: 改 line 128 自检表条目**

打开 `docs/design/S2拆解到世界观推演映射.md`,定位到 line 128 附近:

```
| `world.core_rules` 世界规则 | ontology / narrative_physics | |
```

替换为:

```
| `world.core_rules` 世界规则 | ontology / power_structure / narrative_physics / protagonist_engine (is_irreducible=true) | 4 维度各自贡献性质不同的硬规则,详见 [§"core_rules 按维度分组的语义与契约"](#core_rules-按维度-分组的语义与契约) |
```

- [ ] **Step 2: 新增章节 "core_rules 按维度分组的语义与契约"**

定位到 "反向校验" 章节结束、"跨维度整体上下文" 章节开始的位置。在两章之间插入新章节(锚点用连字符化的中文以匹配 GitHub 自动锚点规则):

```markdown
## core_rules 按维度-分组的语义与契约

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

### PowerSystem 与 core_rules 的来源标注

`world.power_systems[]` 每张卡也带 `source` 字段,标识其产出维度:

| source | 含义 | 典型命名 |
|---|---|---|
| `energetics` | 来自 energetics 维度的通用资源体系 | "灵力""真气""斗气" |
| `protagonist_engine` | 来自 protagonist_engine 维度的非常规主角能力 | "血脉觉醒""天道系统" |

(注: 在 WorldStep 中,`source="protagonist_engine"` 的 power_system 卡片会显示
"主角能力" 徽章以便区分。)
```

- [ ] **Step 3: 跑 frontend 测试确认文档改动未破坏任何东西**

(文档改动无运行时影响,但跑一次 baseline 确认 frontend / backend 测试均无新增失败。)

```bash
cd /Users/longsa/Codes/nebula/backend && pytest tests/test_world_power_systems_migration.py -q 2>&1 | tail -5
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/WorldStep.tabs.test.tsx 2>&1 | tail -5
```

预期: 全部 PASS。

- [ ] **Step 4: 提交**

```bash
cd /Users/longsa/Codes/nebula && git add docs/design/S2拆解到世界观推演映射.md
git commit -m "$(cat <<'EOF'
docs(design): core_rules 自检表 + 按维度分组的语义与契约

修正文档自相矛盾(line 128 自检表只承认 ontology/narrative_physics,
实际 4 维度都在贡献),新增章节锁定 4 类硬规则的语义、来源、契约,
作为 schema / prompt / API / UI 4 层修订的设计依据。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 修订 B — CoreRule schema (CoreRuleCategory + 旧数据迁移)

**Files:**
- Modify: `backend/models/world.py`
- Create: `backend/tests/test_world_core_rules_migration.py`

- [ ] **Step 1: 写失败测试 — 旧 list[str] 迁移为 list[CoreRule] (默认 category=physical)**

创建 `backend/tests/test_world_core_rules_migration.py`:

```python
"""World.core_rules migration: list[str] → list[CoreRule{category, text}]."""

from backend.models.world import World, CoreRuleCategory, CoreRule


def test_legacy_string_list_migrates_to_structured_with_physical_default():
    """Old world.json had `core_rules: ["灵气存在", "王朝垄断灵脉"]` —
    a flat list of strings. Default category=physical (ontology) since
    ontology is the largest contributor to core_rules."""
    world = World.model_validate({
        "era": "古代",
        "core_rules": ["灵气存在", "王朝垄断灵脉"],
    })
    assert len(world.core_rules) == 2
    assert all(isinstance(r, CoreRule) for r in world.core_rules)
    assert world.core_rules[0].category == CoreRuleCategory.PHYSICAL
    assert world.core_rules[0].text == "灵气存在"
    assert world.core_rules[1].text == "王朝垄断灵脉"


def test_structured_list_with_categories_passes_through():
    """New shape `core_rules: [{category, text}, ...]` should validate
    with categories preserved."""
    world = World.model_validate({
        "core_rules": [
            {"category": "physical", "text": "灵气有限"},
            {"category": "social", "text": "灵脉开采权被朝廷垄断"},
            {"category": "narrative", "text": "强者不可干预弱者命运"},
            {"category": "protagonist", "text": "寄体觉醒后必死"},
        ]
    })
    assert [r.category for r in world.core_rules] == [
        CoreRuleCategory.PHYSICAL,
        CoreRuleCategory.SOCIAL,
        CoreRuleCategory.NARRATIVE,
        CoreRuleCategory.PROTAGONIST,
    ]
    assert world.core_rules[3].text == "寄体觉醒后必死"


def test_invalid_category_value_is_rejected():
    """An unknown category string should raise a validation error."""
    import pytest
    with pytest.raises(Exception):
        World.model_validate({
            "core_rules": [{"category": "magic", "text": "x"}]
        })


def test_missing_core_rules_key_yields_empty_list():
    world = World.model_validate({"era": "古代"})
    assert world.core_rules == []


def test_world_rules_summary_flattens_across_categories():
    """WorldRulesSummary.from_world() must continue to flatten
    core_rules text across all 4 categories."""
    from backend.models.world import WorldRulesSummary
    world = World.model_validate({
        "core_rules": [
            {"category": "physical", "text": "灵气有限"},
            {"category": "social", "text": "灵脉被垄断"},
            {"category": "narrative", "text": "强者受限"},
            {"category": "protagonist", "text": "寄体必死"},
        ]
    })
    summary = WorldRulesSummary.from_world(world)
    assert summary.core_rules == [
        "灵气有限", "灵脉被垄断", "强者受限", "寄体必死",
    ]
```

- [ ] **Step 2: 跑测试验证失败**

```bash
cd /Users/longsa/Codes/nebula/backend && pytest tests/test_world_core_rules_migration.py -q 2>&1 | tail -10
```

预期: 全部 FAIL (CoreRule / CoreRuleCategory 未定义, World.core_rules 还是 list[str])。

- [ ] **Step 3: 实现 CoreRuleCategory + CoreRule + World 字段**

修改 `backend/models/world.py`。在文件顶部 import 区域添加:

```python
from enum import Enum
```

在 `class WorldRulesSummary` 之前添加新类型:

```python
class CoreRuleCategory(str, Enum):
    PHYSICAL = "physical"        # ontology
    SOCIAL = "social"            # power_structure
    NARRATIVE = "narrative"      # narrative_physics
    PROTAGONIST = "protagonist"  # protagonist_engine (is_irreducible=true)


class CoreRule(BaseModel):
    category: CoreRuleCategory
    text: str
```

修改 `class World`:

```python
class World(BaseModel):
    era: str = ""
    geography: str = ""
    era_social_structure: Optional[str] = None
    era_cultural_history: Optional[str] = None
    power_systems: list[PowerSystem] = Field(default_factory=list)
    factions: list[Faction] = []
    core_rules: list[CoreRule] = Field(default_factory=list)
```

在 `World` 类内部、`_migrate_singular_power_system` validator 之后添加新 validator:

```python
    @model_validator(mode="before")
    @classmethod
    def _migrate_core_rules(cls, data):
        """Old world.json stored core_rules as a flat list[str].
        Fold it forward to list[CoreRule{category: PHYSICAL, text: s}] —
        PHYSICAL (ontology) is the default because ontology is the
        largest contributor. Callers that need a specific category can
        re-call generate_world or regenerate-world-section after upgrade.
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

修改 `WorldRulesSummary.from_world()` (line 50-59):

```python
    @classmethod
    def from_world(cls, world: "World") -> "WorldRulesSummary":
        return cls(
            name=" / ".join(ps.name for ps in world.power_systems if ps.name),
            ceilings=_dedupe(c for ps in world.power_systems for c in ps.ceilings),
            core_rules=_dedupe(r.text for r in world.core_rules),
        )
```

注:`_dedupe` 已经定义在 world.py 内部(在 WorldRulesSummary 之前),无需修改。

- [ ] **Step 4: 跑测试验证通过**

```bash
cd /Users/longsa/Codes/nebula/backend && pytest tests/test_world_core_rules_migration.py -q 2>&1 | tail -10
```

预期: 5/5 PASS。

- [ ] **Step 5: 跑相关已有测试,确认无回归**

```bash
cd /Users/longsa/Codes/nebula/backend && pytest tests/test_world_power_systems_migration.py tests/test_stage2_generate_world.py tests/test_multi_power_system_downstream.py -q 2>&1 | tail -10
```

预期: 全部 PASS (无回归; CoreRule 引入未触碰 power_systems / WorldRulesSummary 的现有契约)。

- [ ] **Step 6: 提交**

```bash
cd /Users/longsa/Codes/nebula && git add backend/models/world.py backend/tests/test_world_core_rules_migration.py
git commit -m "$(cat <<'EOF'
feat(world): core_rules schema 引入 CoreRuleCategory + CoreRule

把 world.core_rules 从 list[str] 升级为 list[CoreRule{category, text}],
4 个枚举值(physical/social/narrative/protagonist)对应 4 个 S2 拆解维度。
旧 world.json (list[str]) 自动迁移,默认归 PHYSICAL (ontology 兜底)。
WorldRulesSummary.from_world() 适配新结构 (扁平化所有 category 的 text)。

测试: 新增 test_world_core_rules_migration.py,5 个 case。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 修订 B2 — PowerSystem.source schema (energetics / protagonist_engine)

**Files:**
- Modify: `backend/models/world.py`
- Modify: `backend/tests/test_world_power_systems_migration.py` (追加新测试)

- [ ] **Step 1: 追加失败测试 — 旧 power_system 默认 source=energetics + 新值可显式设置**

在 `backend/tests/test_world_power_systems_migration.py` 末尾追加:

```python
def test_legacy_power_system_defaults_source_to_energetics():
    """Old world.json power_systems[] entries have no `source` field.
    Default to energetics (the dominant contributor)."""
    world = World.model_validate({
        "power_systems": [{"name": "灵力", "core_rules": ["有限"]}]
    })
    assert world.power_systems[0].source.value == "energetics"


def test_new_power_system_can_explicitly_set_protagonist_engine_source():
    """LLM output for protagonist_engine-derived systems must tag source."""
    world = World.model_validate({
        "power_systems": [
            {"name": "天道寄体系统", "source": "protagonist_engine",
             "core_rules": ["使用即加速死亡"]},
            {"name": "灵力", "source": "energetics"},
        ]
    })
    assert world.power_systems[0].source.value == "protagonist_engine"
    assert world.power_systems[1].source.value == "energetics"


def test_invalid_power_system_source_is_rejected():
    import pytest
    with pytest.raises(Exception):
        World.model_validate({
            "power_systems": [{"name": "x", "source": "magic"}]
        })


def test_filter_power_systems_by_source_helper():
    from backend.models.world import filter_power_systems_by_source, PowerSystemSource
    world_dict = {
        "power_systems": [
            {"name": "灵力"},
            {"name": "天道系统", "source": "protagonist_engine"},
            {"name": "斗气"},
        ]
    }
    protagonist_only = filter_power_systems_by_source(
        world_dict, PowerSystemSource.PROTAGONIST_ENGINE
    )
    assert [ps["name"] for ps in protagonist_only] == ["天道系统"]
```

- [ ] **Step 2: 跑测试验证失败**

```bash
cd /Users/longsa/Codes/nebula/backend && pytest tests/test_world_power_systems_migration.py -q -k "source or filter" 2>&1 | tail -10
```

预期: 4 个新 case FAIL (PowerSystemSource / source 字段 / filter helper 未定义)。

- [ ] **Step 3: 实现 PowerSystemSource + PowerSystem.source + filter helper**

修改 `backend/models/world.py`。在 `class PowerSystem` 之前添加新枚举:

```python
class PowerSystemSource(str, Enum):
    ENERGETICS = "energetics"
    PROTAGONIST_ENGINE = "protagonist_engine"
```

修改 `class PowerSystem`:

```python
class PowerSystem(BaseModel):
    name: str = ""
    description: str = ""
    stages: list[str] = []
    core_rules: list[str] = []
    ceilings: list[str] = []
    cost_system: Optional[str] = None
    source: PowerSystemSource = PowerSystemSource.ENERGETICS

    @model_validator(mode="before")
    @classmethod
    def _migrate_source(cls, data):
        """Old world.json power_systems[] entries have no source field.
        Default to energetics (the historical dominant contributor)."""
        if isinstance(data, dict) and "source" not in data:
            data = {**data, "source": PowerSystemSource.ENERGETICS.value}
        return data

    @field_validator("stages", mode="before")
    @classmethod
    def _coerce_stages(cls, v):
        # ... 已有实现,未改动
```

(保持原有的 `_coerce_stages` validator 不变。)

在文件末尾(`_raw_power_systems_list` 之后)添加 helper:

```python
def filter_power_systems_by_source(
    world: Optional[dict], source: PowerSystemSource
) -> list[dict]:
    """Return the subset of raw power_systems entries whose `source`
    field equals the given value. Entries without `source` are treated
    as `energetics` (the migration default).

    Used by the per-source regenerate endpoint (Task 6).
    """
    if not isinstance(world, dict):
        return []
    raw = _raw_power_systems_list(world)
    target = source.value
    return [ps for ps in raw if ps.get("source", "energetics") == target]
```

- [ ] **Step 4: 跑新测试验证通过**

```bash
cd /Users/longsa/Codes/nebula/backend && pytest tests/test_world_power_systems_migration.py -q -k "source or filter" 2>&1 | tail -10
```

预期: 4 个新 case PASS (与原有 5 个 case 共 9/9 PASS)。

- [ ] **Step 5: 跑相关已有测试,确认无回归**

```bash
cd /Users/longsa/Codes/nebula/backend && pytest tests/test_world_power_systems_migration.py tests/test_world_core_rules_migration.py tests/test_stage2_generate_world.py tests/test_multi_power_system_downstream.py -q 2>&1 | tail -10
```

预期: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
cd /Users/longsa/Codes/nebula && git add backend/models/world.py backend/tests/test_world_power_systems_migration.py
git commit -m "$(cat <<'EOF'
feat(world): PowerSystem.source 标注 (energetics / protagonist_engine)

为 power_systems[] 每张卡加 source 字段,标识产出维度:
- energetics (默认): 来自 energetics 维度 (通用资源体系)
- protagonist_engine: 来自 protagonist_engine 维度 (主角非常规能力)

旧 world.json 中无 source 的卡片自动归 energetics。新增
filter_power_systems_by_source helper 供 per-source regenerate endpoint
(Task 6) 使用。

测试: test_world_power_systems_migration.py 追加 4 个 case。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 修订 C — world_generation prompt 引导

**Files:**
- Modify: `backend/prompts/world_generation.yaml`

(纯 prompt 文本改动, 无单元测试; 验证方式 — 跑现有 world_generation pipeline 测试 + 手动验证 YAML 格式正确。)

- [ ] **Step 1: 修改 system_prompt 增加 category 引导**

打开 `backend/prompts/world_generation.yaml`,定位到 system_prompt 第 7-55 行(在 `user_prompt_template:` 之前)。

定位到现有的第 22-23 行(关于 5 维度 → world.json 落点映射):

```
8. **必须把下方 5 维度拆解的每个单元都映射到 world.json 的具体字段**——
   单元描述里出现的每一条硬规则、资源、权力结构、主角机制、冲突动力都不得丢失。
```

在它**之后**插入 3 段:

```yaml
9. **世界规则按 4 类硬约束分别产出**(2026-09-20 修订):
   - physical(物理公理)来自 ontology 单元
   - social(结构性瓶颈)来自 power_structure 单元
   - narrative(解决路径封闭性)来自 narrative_physics 单元
   - protagonist(主角机制硬约束)来自 protagonist_engine 中 is_irreducible=true 的单元
   每条 core_rule 必须有且仅有一个 category,选最贴切的一类;
   不得遗漏 4 类中由对应单元自然产出的规则。

10. **力量体系区分来源**(2026-09-20 修订):
    - 体系名称以 energetics 来源的通用资源命名(如"灵力""真气""斗气")
    - 体系名称以 protagonist_engine 来源的主角非常规能力命名(如"血脉觉醒""天道系统")
    - 每张 power_system 卡必须带 source 字段:"energetics" 或 "protagonist_engine"

11. **联合推演字段显式指引**(2026-09-20 修订):
    - geography 由 ontology 单元(列举 2-3 条)决定的物理舞台 + narrative_physics 单元(列举 2-3 条)决定的冲突规模联合推演
    - era_cultural_history 由 power_structure 单元(列举 2-3 条)反推的历史成因 + narrative_physics 单元(列举 2-3 条)累积的代价联合推演
    LLM 在生成 era 段时,必须显式参照上述两个 S2 维度的具体单元,不能给空话。
```

(注: 这 3 段标号 9/10/11 是接续现有编号 — 现有已有 1-7 条要求,新增 8 是 5 维度映射表;你直接接续。)

- [ ] **Step 2: 修改示例输出 JSON (core_rules 部分)**

定位到 line 108-142 的示例输出 JSON。把 `core_rules` 部分(line 129-133):

```json
    "core_rules": [
      "世界规则1",
      "世界规则2",
      "世界规则3"
    ],
```

替换为:

```json
    "core_rules": [
      {"category": "physical", "text": "世界存在灵气;浓度因地而异,高浓度区有修炼加成"},
      {"category": "social", "text": "灵脉开采权被大燕王朝垄断,各宗门暗中争夺"},
      {"category": "narrative", "text": "强者不得干预弱者命运,违反者遭天道反噬"},
      {"category": "protagonist", "text": "被天道选中的'寄体'觉醒后必死,且每次使用能力都在加速死亡"}
    ],
```

- [ ] **Step 3: 修改示例输出 JSON (power_systems 部分加 source)**

定位到示例输出的 power_systems 数组(line 113-128)。在最后一张卡的 `ceilings` 数组后添加 `"source"` 字段:

```json
      {{
        "name": "力量体系名称",
        "description": "体系运作原理的简要描述",
        "stages": ["阶段1", "阶段2", "阶段3"],
        "core_rules": [
          "体系规则1:力量体系内部的运作规律与约束",
          "体系规则2:修炼或施展过程中的硬性条件"
        ],
        "cost_system": "使用力量的代价(可选,有则填写)",
        "ceilings": [
          "绝对上限1:具体限制内容",
          "绝对上限2:具体限制内容"
        ],
        "source": "energetics 或 protagonist_engine"
      }}
    ],
```

(注意:示例数组只有 1 张卡但用 `{{` `}}` 双花括号是 YAML 模板转义 — 你直接复制粘贴,保持原 YAML 格式。)

- [ ] **Step 4: YAML 语法验证**

```bash
cd /Users/longsa/Codes/nebula/backend && python -c "import yaml; yaml.safe_load(open('prompts/world_generation.yaml').read().replace('{concept_title}', 'X').replace('{concept_premise}', 'X').replace('{concept_tone}', 'X').replace('{concept_theme}', 'X').replace('{core_contradiction}', 'X').replace('{genre}', 'X').replace('{genre_tone}', 'X').replace('{genre_style_rules}', 'X').replace('{genre_trope_patterns}', 'X').replace('{ontology_units}', 'X').replace('{energetics_units}', 'X').replace('{power_structure_units}', 'X').replace('{protagonist_engine_units}', 'X').replace('{narrative_physics_units}', 'X').replace('{causal_map}', 'X').replace('{user_modifications}', 'X').replace('{negative_constraints}', ''))" && echo "YAML OK"
```

(把 `{...}` 占位符替换为占位字符串后 YAML 解析;若解析成功输出 "YAML OK"。)

预期: `YAML OK` 输出。

- [ ] **Step 5: 跑现有 world_generation pipeline 测试**

```bash
cd /Users/longsa/Codes/nebula/backend && pytest tests/test_stage2_generate_world.py tests/test_world_power_systems_migration.py tests/test_world_core_rules_migration.py -q 2>&1 | tail -10
```

预期: 全部 PASS (prompt 改动无运行时影响; 仅在 LLM 调用时才会生效, pipeline 测试用 mock LLM, 不解析新示例)。

- [ ] **Step 6: 提交**

```bash
cd /Users/longsa/Codes/nebula && git add backend/prompts/world_generation.yaml
git commit -m "$(cat <<'EOF'
feat(prompts): world_generation prompt 按 category 引导 + 联合推演显式化

新增 3 条 system_prompt 约束:
- 世界规则按 4 类硬约束分别产出 (physical/social/narrative/protagonist)
- 力量体系带 source 字段 (energetics/protagonist_engine)
- geography / era_cultural_history 联合推演显式指引

示例输出 JSON 同步更新。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 修订 E — API 按 category 拆细粒度 (独立 category 字段)

**Files:**
- Modify: `backend/api/stage2_world_char.py`
- Modify: `backend/tests/test_stage2_regenerate_world_section.py`

- [ ] **Step 1: 写失败测试 — regenerate core_rules 单 category (其他 category 保留)**

打开 `backend/tests/test_stage2_regenerate_world_section.py`,找到现有"整组 regenerate"测试,追加新测试:

```python
def test_regenerate_core_rules_by_category_preserves_other_categories(
    client_with_world,
):
    """When section='core_rules' and category='physical', only physical
    rules are replaced; social/narrative/protagonist rules in the existing
    world.json are byte-preserved."""
    # Setup: existing world.json with all 4 categories
    existing = {
        "era": "古代",
        "core_rules": [
            {"category": "physical", "text": "旧 physical 规则"},
            {"category": "social", "text": "旧 social 规则(应保留)"},
            {"category": "narrative", "text": "旧 narrative 规则(应保留)"},
            {"category": "protagonist", "text": "旧 protagonist 规则(应保留)"},
        ],
    }
    # Setup: LLM mocked to return ONLY physical
    new_llm_result = {
        "core_rules": [
            {"category": "physical", "text": "新 physical 规则 A"},
            {"category": "physical", "text": "新 physical 规则 B"},
        ],
    }
    # ... (参考现有测试的 mock pattern, 此处省略 mock boilerplate)

    response = client.post(
        "/regenerate-world-section",
        params={"project_id": PROJECT},
        json={"section": "core_rules", "category": "physical"},
    )
    assert response.status_code == 200
    body = response.json()
    merged_rules = body["detail"]["core_rules"]
    # 旧 social/narrative/protagonist 仍在
    categories_kept = {r["category"] for r in merged_rules
                       if r["text"].startswith("旧 ")}
    assert categories_kept == {"social", "narrative", "protagonist"}
    # 新 physical 替换旧 physical
    assert any(r["text"] == "新 physical 规则 A" for r in merged_rules)
    assert not any(r["text"] == "旧 physical 规则" for r in merged_rules)


def test_regenerate_core_rules_without_category_replaces_all(
    client_with_world,
):
    """Backward compat — section='core_rules' with no category field
    keeps the old behavior (replace entire core_rules array)."""
    # ... (类似上面,但不传 category,验证整组替换)
```

(具体 mock pattern 参考现有测试 `test_stage2_regenerate_world_section.py` 里的 fixture — 实际编写时需读文件确认导入和 setup 路径。)

- [ ] **Step 2: 跑测试验证失败**

```bash
cd /Users/longsa/Codes/nebula/backend && pytest tests/test_stage2_regenerate_world_section.py -q -k "category" 2>&1 | tail -10
```

预期: 新测试 FAIL (payload 不接受 `category` 字段, 或 endpoint 不分支处理)。

- [ ] **Step 3: 实现 RegenerateWorldSectionPayload 加 category 字段 + endpoint 分支**

打开 `backend/api/stage2_world_char.py`,定位到 `RegenerateWorldSectionPayload` 类。修改:

```python
class RegenerateWorldSectionPayload(BaseModel):
    section: str
    category: Optional[str] = None  # 仅 section="core_rules" 时生效
    user_modifications: str = Field(default="", max_length=1700)
```

定位到 endpoint 内 `elif payload.section == "core_rules":` 分支(line 619-620 附近)。替换为:

```python
    elif payload.section == "core_rules":
        if payload.category is None:
            # 旧行为: 整组重生成
            merged["core_rules"] = result.get("core_rules", existing.get("core_rules", []))
        else:
            # 新行为: 仅替换目标 category
            target_cat = payload.category
            new_rules = result.get("core_rules", [])
            merged_rules = [
                r for r in existing.get("core_rules", [])
                if r.get("category") != target_cat
            ]
            merged_rules.extend(r for r in new_rules if r.get("category") == target_cat)
            merged["core_rules"] = merged_rules
```

在文件顶部 import 区域添加(若未导入):

```python
from typing import Optional
```

(若 `Optional` 已存在,跳过。)

- [ ] **Step 4: 跑新测试验证通过**

```bash
cd /Users/longsa/Codes/nebula/backend && pytest tests/test_stage2_regenerate_world_section.py -q -k "category" 2>&1 | tail -10
```

预期: 新测试 PASS。

- [ ] **Step 5: 跑相关已有测试,确认无回归**

```bash
cd /Users/longsa/Codes/nebula/backend && pytest tests/test_stage2_regenerate_world_section.py tests/test_stage2_generate_world.py -q 2>&1 | tail -10
```

预期: 全部 PASS (旧调用方 section="core_rules" 不传 category, 走原分支)。

- [ ] **Step 6: 提交**

```bash
cd /Users/longsa/Codes/nebula && git add backend/api/stage2_world_char.py backend/tests/test_stage2_regenerate_world_section.py
git commit -m "$(cat <<'EOF'
feat(api): regenerate-world-section 按 core_rules category 拆细粒度

RegenerateWorldSectionPayload 新增 Optional category 字段;endpoint
在 section="core_rules" 时按 category 分支:
- 不传 category: 整组重生成 (向后兼容旧调用方)
- 传 category=physical|social|narrative|protagonist: 仅替换目标
  category, 其他 3 类 byte-preserve

测试: test_stage2_regenerate_world_section.py 追加 2 个 case。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 修订 E2 — API 按 power_system.source 拆细粒度

**Files:**
- Modify: `backend/api/stage2_world_char.py`
- Modify: `backend/tests/test_stage2_regenerate_world_section.py`

- [ ] **Step 1: 追加失败测试 — regenerate power_system 按 source 过滤**

在 `backend/tests/test_stage2_regenerate_world_section.py` 追加:

```python
def test_regenerate_power_system_by_source_preserves_other_source_cards(
    client_with_world,
):
    """section='power_system' with system_source='protagonist_engine'
    only replaces protagonist_engine cards; energetics cards preserved."""
    # Setup: existing power_systems with both sources
    existing = {
        "era": "古代",
        "power_systems": [
            {"name": "灵力", "source": "energetics", "core_rules": ["有限"]},
            {"name": "天道系统", "source": "protagonist_engine", "core_rules": ["必死"]},
        ],
    }
    # LLM returns ONLY protagonist_engine cards
    new_llm = {
        "power_systems": [
            {"name": "新天道系统", "source": "protagonist_engine"},
        ],
    }
    # ... (mock pattern 同 Task 5)

    response = client.post(
        "/regenerate-world-section",
        params={"project_id": PROJECT},
        json={"section": "power_system", "system_source": "protagonist_engine"},
    )
    assert response.status_code == 200
    merged_ps = response.json()["detail"]["power_systems"]
    names = [ps["name"] for ps in merged_ps]
    assert "灵力" in names  # energetics 保留
    assert "天道系统" not in names  # 旧 protagonist 被替换
    assert "新天道系统" in names


def test_regenerate_power_system_without_source_replaces_all():
    """Backward compat — section='power_system' with no system_source
    keeps old behavior (replace all power_systems)."""
    # ... (类似 Task 5 backward-compat test)
```

- [ ] **Step 2: 跑测试验证失败**

```bash
cd /Users/longsa/Codes/nebula/backend && pytest tests/test_stage2_regenerate_world_section.py -q -k "system_source" 2>&1 | tail -10
```

预期: 新测试 FAIL。

- [ ] **Step 3: 实现 system_source 字段 + endpoint 分支**

修改 `RegenerateWorldSectionPayload`:

```python
class RegenerateWorldSectionPayload(BaseModel):
    section: str
    category: Optional[str] = None
    system_source: Optional[str] = None  # 仅 section="power_system" 时生效
    user_modifications: str = Field(default="", max_length=1700)
```

修改 `elif payload.section == "power_system":` 分支(line 613-618 附近):

```python
    elif payload.section == "power_system":
        if payload.system_source is None:
            # 旧行为: 重生成整组
            merged["power_systems"] = result.get(
                "power_systems", iter_power_systems(existing)
            )
        else:
            # 新行为: 仅替换指定 source
            target_source = payload.system_source
            new_systems = result.get("power_systems", [])
            merged_systems = [
                ps for ps in existing.get("power_systems", [])
                if ps.get("source", "energetics") != target_source
            ]
            merged_systems.extend(
                ps for ps in new_systems
                if ps.get("source") == target_source
            )
            merged["power_systems"] = merged_systems
```

- [ ] **Step 4: 跑新测试验证通过**

```bash
cd /Users/longsa/Codes/nebula/backend && pytest tests/test_stage2_regenerate_world_section.py -q -k "system_source" 2>&1 | tail -10
```

预期: 新测试 PASS。

- [ ] **Step 5: 跑相关已有测试,确认无回归**

```bash
cd /Users/longsa/Codes/nebula/backend && pytest tests/test_stage2_regenerate_world_section.py tests/test_stage2_regenerate_power_system_item.py tests/test_stage2_generate_world.py -q 2>&1 | tail -10
```

预期: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
cd /Users/longsa/Codes/nebula && git add backend/api/stage2_world_char.py backend/tests/test_stage2_regenerate_world_section.py
git commit -m "$(cat <<'EOF'
feat(api): regenerate-world-section 按 power_system.source 拆细粒度

RegenerateWorldSectionPayload 新增 Optional system_source 字段;
endpoint 在 section="power_system" 时按 source 分支:
- 不传 system_source: 整组重生成 (向后兼容)
- 传 system_source=energetics|protagonist_engine: 仅替换指定 source,
  其他 source 的卡片 byte-preserve

测试: test_stage2_regenerate_world_section.py 追加 2 个 case。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 修订 F — 前端 UI (CoreRulesPanel 4 折叠 group + PowerSystemsPanel source 徽章)

**Files:**
- Modify: `frontend/src/components/wizard/WorldStep.tsx`
- Modify: `frontend/src/test/WorldStep.tabs.test.tsx`

- [ ] **Step 1: 写失败测试 — CoreRulesPanel 渲染 4 个 category group + PowerSystemsPanel source 徽章**

打开 `frontend/src/test/WorldStep.tabs.test.tsx`。在文件末尾(最后一个 `it()` 之后、`describe` 闭合 `})` 之前)追加新测试:

```tsx
  it("CoreRulesPanel renders 4 category groups", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代", geography: "中原",
      power_systems: [],
      core_rules: [
        { category: "physical", text: "灵气存在" },
        { category: "social", text: "灵脉被垄断" },
        { category: "narrative", text: "强者受限" },
        { category: "protagonist", text: "寄体必死" },
      ],
      factions: [],
    });
    setup();
    await screen.findByTestId("world-form");
    // 切到 core_rules tab
    const coreRulesTab = screen.getByTestId("world-tab-core_rules");
    fireEvent.click(coreRulesTab);
    // 4 个 category group 都渲染
    expect(screen.getByTestId("world-core-rules-physical")).toBeInTheDocument();
    expect(screen.getByTestId("world-core-rules-social")).toBeInTheDocument();
    expect(screen.getByTestId("world-core-rules-narrative")).toBeInTheDocument();
    expect(screen.getByTestId("world-core-rules-protagonist")).toBeInTheDocument();
  });

  it("PowerSystemsPanel shows source badge on protagonist_engine cards", async () => {
    (api.generateWorld as ReturnType<typeof vi.fn>).mockResolvedValue({
      era: "古代", geography: "中原",
      power_systems: [
        { name: "灵力", source: "energetics", description: "", core_rules: [], ceilings: [], stages: [] },
        { name: "天道系统", source: "protagonist_engine", description: "", core_rules: [], ceilings: [], stages: [] },
      ],
      factions: [],
      core_rules: [],
    });
    setup();
    await screen.findByTestId("world-form");
    const psTab = screen.getByTestId("world-tab-power_system");
    fireEvent.click(psTab);
    // 第 0 张卡 (energetics) 没有徽章
    expect(screen.queryByTestId("world-power-system-0-source-badge")).not.toBeInTheDocument();
    // 第 1 张卡 (protagonist_engine) 有徽章
    expect(screen.getByTestId("world-power-system-1-source-badge")).toBeInTheDocument();
  });
```

需要在文件顶部 import 添加:

```tsx
import { fireEvent } from "@testing-library/react";  // 若已有,跳过
```

- [ ] **Step 2: 跑新测试验证失败**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/WorldStep.tabs.test.tsx -t "category groups" 2>&1 | tail -10
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/WorldStep.tabs.test.tsx -t "source badge" 2>&1 | tail -10
```

预期: 两条新测试都 FAIL — `world-core-rules-physical` / `world-power-system-1-source-badge` 找不到。

- [ ] **Step 3: 重构 CoreRulesPanel — 加 CategoryGroup 子组件**

打开 `frontend/src/components/wizard/WorldStep.tsx`。

在 import 区域添加:

```tsx
import { useMemo, useState } from "react";  // 若 useState 已存在,只需 useMemo
```

在文件末尾(最后一个 panel 组件 `FactionsPanel` 之后)新增 `CategoryGroup` 子组件 + 重写 `CoreRulesPanel`:

```tsx
function CategoryGroup({
  category, label, source, rules, onChange, saving,
}: {
  category: string;
  label: string;
  source: string;
  rules: string[];
  onChange: (texts: string[]) => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <details
      open={open}
      data-testid={`world-core-rules-${category}`}
      className="border border-outline-variant rounded"
    >
      <summary
        onClick={(e) => { e.preventDefault(); setOpen(!open); }}
        className="cursor-pointer px-3 py-2 flex items-center justify-between hover:bg-surface-container/50"
      >
        <span className="flex items-center gap-2">
          <span className="material-symbols-outlined text-sm">
            {open ? "expand_less" : "expand_more"}
          </span>
          <span className="font-medium text-sm">{label}</span>
          <span className="font-mono text-[10px] text-primary-container/70">
            [{source}]
          </span>
        </span>
        <span className="font-mono text-[10px] opacity-70" aria-label={`${rules.length} 条`}>
          {rules.length}
        </span>
      </summary>
      <div className="px-3 pb-3">
        <TagEditor items={rules} onItemsChange={onChange} saving={saving} />
      </div>
    </details>
  );
}

function CoreRulesPanel({ active, world, setWorld, busy }: { active: boolean; world: World; setWorld: (w: World) => void; busy: boolean }) {
  const grouped = useMemo(() => {
    const g: Record<string, string[]> = {
      physical: [], social: [], narrative: [], protagonist: [],
    };
    for (const r of (world.core_rules ?? []) as Array<{ category?: string; text?: string }>) {
      const cat = r.category ?? "physical";
      if (!g[cat]) g[cat] = [];
      g[cat].push(r.text ?? "");
    }
    return g;
  }, [world.core_rules]);

  const setCategory = (cat: string, texts: string[]) => {
    const others = ((world.core_rules ?? []) as Array<{ category?: string; text?: string }>)
      .filter(r => r.category !== cat);
    setWorld({
      ...world,
      core_rules: [
        ...others,
        ...texts.map(t => ({ category: cat, text: t })),
      ],
    });
  };

  return (
    <div
      role="tabpanel"
      id="world-panel-core_rules"
      aria-labelledby="world-tab-core_rules"
      hidden={!active}
      data-testid="world-panel-core_rules"
    >
      <div data-testid="world-core-rules" className="space-y-2">
        <CategoryGroup category="physical" label="物理公理" source="ontology"
          rules={grouped.physical} onChange={t => setCategory("physical", t)} saving={busy} />
        <CategoryGroup category="social" label="结构性瓶颈" source="power_structure"
          rules={grouped.social} onChange={t => setCategory("social", t)} saving={busy} />
        <CategoryGroup category="narrative" label="解决路径封闭性" source="narrative_physics"
          rules={grouped.narrative} onChange={t => setCategory("narrative", t)} saving={busy} />
        <CategoryGroup category="protagonist" label="主角机制硬约束" source="protagonist_engine"
          rules={grouped.protagonist} onChange={t => setCategory("protagonist", t)} saving={busy} />
      </div>
    </div>
  );
}
```

注: `World` 类型需要 `core_rules` 字段类型为 `Array<{ category: string; text: string }>`。若 TypeScript 类型未更新,你需要更新 `World` interface(在 `frontend/src/components/wizard/WorldStep.tsx` 顶部或 shared types 文件)。先继续,跑测试时若类型报错,再调整。

- [ ] **Step 4: 修改 PowerSystemsPanel 加 source 徽章**

定位到 `function PowerSystemsPanel({...})` 中的卡片渲染 JSX(每张卡片的 `<div className="absolute top-2 right-2 ...">` 区段,内含 `SectionRegenerateButton` 和 `× remove` 按钮)。在 `SectionRegenerateButton` 之前添加:

```tsx
            <div className="absolute top-2 right-2 flex items-center gap-1">
              {ps.source === "protagonist_engine" && (
                <span
                  data-testid={`world-power-system-${i}-source-badge`}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary-container/20 text-primary-container"
                >
                  主角能力
                </span>
              )}
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
```

同时修改卡片最外层 `<div>` 的 className,根据 `ps.source` 加 accent 边框:

```tsx
          <div
            key={i}
            data-testid={`world-power-system-${i}`}
            className={
              "border rounded p-3 space-y-2 relative " +
              (ps.source === "protagonist_engine"
                ? "border-primary-container/60 bg-primary-container/5"
                : "border-outline-variant")
            }
          >
```

- [ ] **Step 5: 跑新测试验证通过**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/WorldStep.tabs.test.tsx -t "category groups" 2>&1 | tail -10
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/WorldStep.tabs.test.tsx -t "source badge" 2>&1 | tail -10
```

预期: 两条新测试 PASS。

- [ ] **Step 6: 跑 WorldStep / InitWizardModal 测试,确认无回归**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/WorldStep.tabs.test.tsx src/test/WorldStep.test.tsx src/test/InitWizardModal.test.tsx 2>&1 | tail -10
```

预期: 全部 PASS (旧 core_rules testid `world-core-rules` 仍在外层 div, 向后兼容)。

- [ ] **Step 7: 提交**

```bash
cd /Users/longsa/Codes/nebula && git add frontend/src/components/wizard/WorldStep.tsx frontend/src/test/WorldStep.tabs.test.tsx
git commit -m "$(cat <<'EOF'
feat(world-step): CoreRulesPanel 4 折叠 group + PowerSystemsPanel source 徽章

CoreRulesPanel 重构: 把 list[CoreRule] 按 category (physical/social/
narrative/protagonist) 分成 4 个折叠 group, 每个 group 用 <details>
+ TagEditor 渲染, 默认全部展开。testid 保留 world-core-rules 在外层,
新增 world-core-rules-{category} 4 个。

PowerSystemsPanel: source="protagonist_engine" 的卡片右上角加
"主角能力" 徽章, testid world-power-system-{i}-source-badge;
卡片整体加 accent 边框 + 浅色底色以便视觉区分。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 修订 D — writer 上下文按 category 分块渲染

**Files:**
- Modify: `backend/agents/writer.py`
- Create: `backend/tests/test_writer_core_rules_format.py`

- [ ] **Step 1: 写失败测试 — _format_core_rules_grouped 按 category 输出**

创建 `backend/tests/test_writer_core_rules_format.py`:

```python
"""writer pipeline's core_rules injection format.

`world.core_rules[]` is now `list[CoreRule{category, text}]`. The
writer must inject the rules into scene context grouped by category
with subheaders, so the writer LLM sees structure (not a flat dump)."""

from backend.agents.writer import _format_core_rules_grouped
from backend.models.world import CoreRule, CoreRuleCategory


def test_groups_rules_by_category_with_subheaders():
    rules = [
        CoreRule(category=CoreRuleCategory.PHYSICAL, text="灵气有限"),
        CoreRule(category=CoreRuleCategory.SOCIAL, text="灵脉被垄断"),
        CoreRule(category=CoreRuleCategory.NARRATIVE, text="强者受限"),
        CoreRule(category=CoreRuleCategory.PROTAGONIST, text="寄体必死"),
    ]
    out = _format_core_rules_grouped(rules)
    assert "### 物理公理 (ontology)" in out
    assert "### 结构性瓶颈 (power_structure)" in out
    assert "### 解决路径封闭性 (narrative_physics)" in out
    assert "### 主角机制硬约束 (protagonist_engine)" in out
    assert "  - 灵气有限" in out
    assert "  - 灵脉被垄断" in out
    assert "  - 寄体必死" in out


def test_omits_empty_categories():
    rules = [CoreRule(category=CoreRuleCategory.PHYSICAL, text="只有物理规则")]
    out = _format_core_rules_grouped(rules)
    assert "### 物理公理" in out
    assert "### 结构性瓶颈" not in out
    assert "### 解决路径封闭性" not in out
    assert "### 主角机制硬约束" not in out


def test_empty_rules_returns_placeholder():
    out = _format_core_rules_grouped([])
    assert out == "(无世界规则)"
```

- [ ] **Step 2: 跑测试验证失败**

```bash
cd /Users/longsa/Codes/nebula/backend && pytest tests/test_writer_core_rules_format.py -q 2>&1 | tail -10
```

预期: 3 个 case FAIL (函数未导出)。

- [ ] **Step 3: 实现 _format_core_rules_grouped + 替换旧调用**

打开 `backend/agents/writer.py`,定位到现有的 `core_rules_str` 渲染段(line 429-456)。在文件顶部 import 区域添加(若未导入):

```python
from collections import defaultdict
from backend.models.world import CoreRule, CoreRuleCategory
```

(若 `defaultdict` 已存在,跳过。)

在合适位置(类外、函数外,放在现有 helpers 旁边)添加新函数:

```python
_CATEGORY_LABELS = {
    CoreRuleCategory.PHYSICAL: "物理公理 (ontology)",
    CoreRuleCategory.SOCIAL: "结构性瓶颈 (power_structure)",
    CoreRuleCategory.NARRATIVE: "解决路径封闭性 (narrative_physics)",
    CoreRuleCategory.PROTAGONIST: "主角机制硬约束 (protagonist_engine)",
}


def _format_core_rules_grouped(rules: list[CoreRule]) -> str:
    """Format world.core_rules for scene-writing context, grouped by
    category with subheaders. Empty categories are omitted.
    """
    by_cat: dict[CoreRuleCategory, list[str]] = defaultdict(list)
    for r in rules:
        by_cat[r.category].append(r.text)
    parts = []
    for cat in CoreRuleCategory:
        items = by_cat.get(cat, [])
        if not items:
            continue
        parts.append(f"### {_CATEGORY_LABELS[cat]}")
        parts.extend(f"  - {t}" for t in items)
    return "\n".join(parts) if parts else "(无世界规则)"
```

找到现有的 `core_rules_str = "\n".join(f"  - {r}" for r in core_rules)`,替换为:

```python
        core_rules = world_rules.get("core_rules", [])
        core_rules_obj = [
            CoreRule(**c) if isinstance(c, dict) else CoreRule(
                category=CoreRuleCategory.PHYSICAL, text=str(c)
            )
            for c in core_rules
        ]
        core_rules_str = _format_core_rules_grouped(core_rules_obj)
```

(注: 如果 world_rules 来自 WorldRulesSummary.from_world(),那是已展开的 list[str],需要不同的处理。读 writer.py 上下文确认是哪种 — 若已是 list[str] summary,直接拼成 PHYSICAL 单 category 也合理。)

- [ ] **Step 4: 跑测试验证通过**

```bash
cd /Users/longsa/Codes/nebula/backend && pytest tests/test_writer_core_rules_format.py -q 2>&1 | tail -10
```

预期: 3/3 PASS。

- [ ] **Step 5: 跑相关已有测试,确认无回归**

```bash
cd /Users/longsa/Codes/nebula/backend && pytest tests/test_writer_pipeline_integration.py tests/test_multi_power_system_downstream.py -q 2>&1 | tail -10
```

预期: 全部 PASS (新格式仅增加 ### 小标题前缀, LLM 看到的语义未变)。

- [ ] **Step 6: 提交**

```bash
cd /Users/longsa/Codes/nebula && git add backend/agents/writer.py backend/tests/test_writer_core_rules_format.py
git commit -m "$(cat <<'EOF'
feat(writer): core_rules 注入按 category 分块 (### 小标题)

新增 _format_core_rules_grouped helper, 把 world.core_rules 按
4 个 category 分块渲染,每块以 "### 物理公理 (ontology)" 等小标题开头,
空 category 省略。writer 调用点替换原 flat join 逻辑。

scene writing prompt 仍以 {core_rules} 占位符接收,值已带分类结构,
LLM 看到的语义信息更丰富(不再平铺)。

测试: 新增 test_writer_core_rules_format.py,3 个 case。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: 修订 G3 — character_generation prompt 引用 protagonist_engine

**Files:**
- Modify: `backend/prompts/character_generation.yaml`

(纯 prompt 文本改动; 无单元测试。)

- [ ] **Step 1: 在 system_prompt 加 protagonist_engine 引用段**

打开 `backend/prompts/character_generation.yaml`,定位到 system_prompt 末尾(user_prompt_template 之前)。

在现有 system_prompt 段(关于"不要重复生成世界观已有内容")**追加**:

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

具体追加位置: 在 system_prompt 已有内容最后一段(通常是"5. ..."之类)之后,空行,然后追加。

- [ ] **Step 2: 验证 YAML 格式**

```bash
cd /Users/longsa/Codes/nebula/backend && python -c "
import yaml
content = open('prompts/character_generation.yaml').read()
# 简单替换占位符以让 YAML 解析通过
placeholders = ['{protagonist_engine_units}', '{concept_title}', '{concept_premise}']
for p in placeholders:
    content = content.replace(p, 'X')
yaml.safe_load(content)
print('YAML OK')
"
```

预期: `YAML OK` 输出。

- [ ] **Step 3: 跑 character_generation pipeline 测试,确认无回归**

```bash
cd /Users/longsa/Codes/nebula/backend && pytest tests/ -q -k "character" 2>&1 | tail -10
```

预期: 全部 PASS (prompt 改动无运行时影响, 只在 LLM 调用时生效)。

- [ ] **Step 4: 提交**

```bash
cd /Users/longsa/Codes/nebula && git add backend/prompts/character_generation.yaml
git commit -m "$(cat <<'EOF'
feat(prompts): character_generation 引用 protagonist_engine 单元

system_prompt 末尾追加 protagonist_engine 单元参考块, 明确约束角色
卡的"能力机制"应只描述世界层未承载的部分(伪装/限制/输出表象),
不得重新生成世界观层已记录的 power_systems 或 core_rules。

避免 stage 2 (世界观) 与 stage 3 (角色) 在"能力机制"上重复生成。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: 最终验证

**Files:** 无(纯验证)

- [ ] **Step 1: 跑全量 backend 测试**

```bash
cd /Users/longsa/Codes/nebula/backend && pytest -q 2>&1 | tail -20
```

预期: 全过(含已存在的 baseline failures)。本任务允许 pre-existing failures,只要不引入新 failure。

- [ ] **Step 2: 跑全量 frontend 测试**

```bash
cd /Users/longsa/Codes/nebula/frontend && npm test 2>&1 | tail -30
```

预期: 全部 PASS (或与 baseline 一致 — 不引入新 failure)。

- [ ] **Step 3: TypeScript 类型检查**

```bash
cd /Users/longsa/Codes/nebula/frontend && npx tsc --noEmit 2>&1 | grep -E "WorldStep\.tsx|WorldStep\.tabs" | head -10
```

预期: 无错误(若 World 类型缺 core_rules category / source 字段,需更新类型; 这是 plan detail 里的预期 — 修类型, 再 commit)。

- [ ] **Step 4: 跑新建/修改的核心测试文件, 确认全部通过**

```bash
cd /Users/longsa/Codes/nebula/backend && pytest tests/test_world_core_rules_migration.py tests/test_world_power_systems_migration.py tests/test_stage2_regenerate_world_section.py tests/test_writer_core_rules_format.py -v 2>&1 | tail -20
cd /Users/longsa/Codes/nebula/frontend && npx vitest run src/test/WorldStep.tabs.test.tsx -v 2>&1 | tail -15
```

预期: 全部 PASS。

- [ ] **Step 5: 确认 git 工作树干净, commit chain 完整**

```bash
cd /Users/longsa/Codes/nebula && git status
```

预期: 干净工作树, 或只有本任务的 dangling 修改 (若有遗漏,补 commit)。

```bash
cd /Users/longsa/Codes/nebula && git log --oneline -12
```

预期 commit chain:
```
<最新 commit> feat(writer): core_rules 注入按 category 分块
feat(api): regenerate-world-section 按 power_system.source 拆细粒度
feat(world-step): CoreRulesPanel 4 折叠 group + PowerSystemsPanel source 徽章
feat(api): regenerate-world-section 按 core_rules category 拆细粒度
feat(prompts): world_generation prompt 按 category 引导
feat(world): PowerSystem.source 标注
feat(world): core_rules schema 引入 CoreRuleCategory + CoreRule
docs(design): core_rules 自检表 + 按维度分组的语义与契约
docs: spec — core_rules 散乱问题修订方案
docs: spec — self-review fixes (status + 折叠默认值)
```

---

## 注意事项

- **strict typing**: World 类型若前端仍为 `core_rules: list[str]`, UI 渲染 `r.category` 会 TS 报错。Plan Step 7 Step 7 提到的"更新 World interface"必须执行, 不能跳。
- **prompt 改动效果**: 修订 C 和修订 G3 的 prompt 改动只在 LLM 实际调用时生效。Mock-LLM 测试看不出效果, 但 production 调用后会改善生成质量。
- **B2 字段不影响旧测试**: PowerSystem 默认值是 `PowerSystemSource.ENERGETICS`, 旧测试里 mock `{"name": "灵力"}` 自动获得此默认值, 不破坏现有断言。
- **修改范围风险**: 10 个 commit 涉及 docs / models / prompts / api / frontend。需在每次 commit 后跑相关测试, 避免最后才发现问题需要拆 commit。
- **Step 7 (UI) 的 World 类型修复**: 若 `frontend/src/types/world.ts` 独立存在, 直接改它; 若 inline 在 WorldStep.tsx, 改那里。

## 风险与回退

| 风险 | 触发 | 应对 |
|---|---|---|
| LLM 不输出 category 字段 | prompt 升级后仍给旧格式 | model_validator fallback 归 PHYSICAL |
| scene writing 测试断言失败 | 分组小标题改变了注入格式 | 调整对应测试断言, 保持 "### 物理公理" 前缀 |
| WorldStep TypeScript 类型报错 | World.core_rules 类型未更新 | 同步更新前端 World interface |
| 旧 API 调用方兼容 | 无 category / system_source 字段, 走默认分支 | 旧调用方无需改动 |
| 字符"主角能力"翻译 | UI 文案只在中文场景 | 暂无国际化需求, 可接受 |

## 验收标准

- [ ] 文档自检表与 line 32/35/68/103 一致, 且新增"按维度分组的语义与契约"小节
- [ ] 新建项目 world.json 每条 core_rule 带 category, power_systems 带 source
- [ ] 旧项目自动迁移 (list[str] → PHYSICAL, 无 source → energetics)
- [ ] API 支持 core_rules category 拆分 + power_system.source 拆分
- [ ] WorldStep CoreRulesPanel 4 折叠 group + PowerSystemsPanel 主角能力徽章
- [ ] writer 上下文按 category 分块
- [ ] character_generation prompt 引用 protagonist_engine 单元
- [ ] 测试: backend tests 全部 PASS (含本任务新增的), frontend WorldStep 相关测试 PASS
- [ ] commit chain 完整 10 个, 工作树干净