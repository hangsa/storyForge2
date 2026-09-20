# WorldStep 二级 Tab 系统 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `WorldStep` 4 个顶级 tab 内部各嵌一层二级 tab — 时代与地理 4 固定字段；力量体系/势力分布按条目数；世界规则按 category；每个 sub-tab 自带 ↻，只重生成那一项。后端扩 `/regenerate-world-section?field=` + 新增 `/regenerate-faction`。

**Architecture:**
- 后端：扩 `RegenerateWorldSectionPayload` 加 `field` 字段；新增 `/regenerate-faction?faction_index=N`；`PlannerAgent.generate_world` 新增 `faction_only_index` 透传；`world_generation.yaml` 新增 `{faction_only_index}` 占位符。
- 前端：`WorldStep.tsx` 新增 `subTab: Record<WorldTabKey, string>` state（每顶级 tab 记忆）；新增内部 `SubTabStrip` 组件（复用 4 个 panel）；4 个 panel 各自由"内容堆叠"改为"sub-tab + 单项内容"形态；3 个 panel 在 0 条时显示空态 CTA。

**Tech Stack:** React 18 + TypeScript + Tailwind (Material 3 tokens via `frontend/src/components/ds/`) · FastAPI + Pydantic v2 · vitest + Testing Library (jsdom) · pytest + httpx

---

## 文件改动范围

| 文件 | 改动 | 任务 |
|---|---|---|
| `backend/prompts/world_generation.yaml` | 新增 `{faction_only_index}` 占位符 | Task 1 |
| `backend/agents/planner.py` | `generate_world` 加 `faction_only_index` 入参透传给 `format_user` | Task 1 |
| `backend/api/stage2_world_char.py` | 扩 `RegenerateWorldSectionPayload` 加 `field` + validator；handler 加 `field` 分支 | Task 2 |
| `backend/api/stage2_world_char.py` | 新增 `RegenerateFactionPayload` + `/regenerate-faction` endpoint | Task 3 |
| `backend/tests/test_world_generation_prompt_format.py` | `GENERATE_WORLD_KWARGS` 加 `faction_only_index` | Task 1 |
| `backend/tests/test_regenerate_world_section_field.py` | 新增 3 个 era field 测试 | Task 2 |
| `backend/tests/test_regenerate_faction.py` | 新增 3 个 faction index 测试 | Task 3 |
| `frontend/src/components/wizard/WorldStep.tsx` | 新增 `SubTabStrip` + `subTab` state + 4 个 panel 改造 | Task 4-9 |
| `frontend/src/test/WorldStep.subtabs.test.tsx` | 新增 7 个 sub-tab 测试用例 | Task 4-9 (随各 panel) |

不删除任何文件；不修改既有 testid (`world-tab-{key}-regenerate` 仍是顶级 tab ↻，与新增的 sub-tab ↻ `world-tab-{key}-subtab-{...}-regenerate` 并存)。

---

## Task 1: `faction_only_index` prompt 占位符 + Planner 透传

**Files:**
- Modify: `backend/prompts/world_generation.yaml` (新增 1 行)
- Modify: `backend/agents/planner.py` (`generate_world` 签名 + `format_user` 调用)
- Modify: `backend/tests/test_world_generation_prompt_format.py` (`GENERATE_WORLD_KWARGS` 加字段)

### Step 1: 写失败测试 — prompt 必须含 `faction_only_index` 占位符

打开 `backend/tests/test_world_generation_prompt_format.py`,在 `GENERATE_WORLD_KWARGS` 字典末尾追加:

```python
    "user_modifications": "",
    "negative_constraints": "",
    "faction_only_index": "",   # 2026-09-20 新增 (sub-tab 重生单条势力用)
}
```

在 `test_world_generation_user_prompt_template_formats_cleanly` 末尾追加断言:

```python
    # Every placeholder is substituted (no {placeholder} residue).
    assert "{ontology_units}" not in formatted
    assert "{narrative_physics_units}" not in formatted
    assert "{faction_only_index}" not in formatted   # 新增
```

### Step 2: 跑测试验证它失败

```bash
cd /Users/longsa/Codes/nebula
source venv/bin/activate
pytest backend/tests/test_world_generation_prompt_format.py -v
```

预期: `test_world_generation_user_prompt_template_formats_cleanly` FAIL — `KeyError: 'faction_only_index'` (来自 `tmpl.format(**kwargs)`)。**这是预期失败**,因为 `world_generation.yaml` 还没新增占位符。

### Step 3: 在 `world_generation.yaml` 的 `user_prompt_template` 末尾加 `{faction_only_index}` 块

打开 `backend/prompts/world_generation.yaml`,在第 113 行 (`{user_modifications}` 那一行) **之后**,第 115 行 (`请生成世界观设定...`) **之前**,插入:

```yaml
  {faction_only_index}

  请生成世界观设定，包含：
```

(在 `{user_modifications}` 和 `请生成世界观设定` 之间,作为新独立段落。 `{faction_only_index}` 默认填充为空字符串,不破坏现有调用方输出。)

### Step 4: 在 `PlannerAgent.generate_world` 加 `faction_only_index` 透传

打开 `backend/agents/planner.py`,找到 `PlannerAgent.generate_world` 方法签名(line 344 附近)。在现有 `decompose_data: Optional[dict] = None,` 之后**插入**一行:

```python
        decompose_data: Optional[dict] = None,
        faction_only_index: str = "",   # 2026-09-20: /regenerate-faction 透传
```

然后在方法内 `format_user(**kwargs)` / `_format_user_kwargs` 类似的 kwargs 构建处(grep `format_user` 或 `format_kwargs` 找到准确行),在 `user_modifications=user_modifications` 那行附近追加:

```python
            faction_only_index=faction_only_index,
```

> 注:实际 `format_user` 的实现可能叫 `format_user_template` / 直接 `tmpl.format(**kwargs)` / 通过辅助函数 `_build_world_user_kwargs` 之类。**先 grep `user_modifications=`** 找到准确的 kwargs 构造点再加。

> 注:同样需要给 **3 个现有调用方** (`generate_world` 初版 API、`/regenerate-world-section`、`/regenerate-power-system-item`) 加 `faction_only_index=""` 显式传参,否则 Pydantic 不会因默认参数兜底(因为是 `**kwargs` 透传而非显式参数)。这是 Step 5 验证会暴露的。

### Step 5: 跑所有 prompt 测试验证通过

```bash
cd /Users/longsa/Codes/nebula
source venv/bin/activate
pytest backend/tests/test_world_generation_prompt_format.py -v
```

预期: PASS — 2 个测试都通过。如果调用方没传 `faction_only_index` 报 `TypeError` 或 `KeyError`,回去给那个调用方补 `faction_only_index=""`。

再跑全量 prompt 测试,确保没有其他 prompt 文件踩到:

```bash
pytest backend/tests/test_world_generation_prompt_format.py -v
pytest backend/tests/test_*prompt* -v   # grep 出来其他 prompt format 测试
```

预期: 全 PASS。

### Step 6: Commit

```bash
git add backend/prompts/world_generation.yaml backend/agents/planner.py backend/tests/test_world_generation_prompt_format.py
git commit -m "feat(world): prompt 占位符 faction_only_index + Planner 透传

为 /regenerate-faction 端点预留单条势力重生的 prompt 引导位。空字符串默认填充,不破坏现有 3 个调用方。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: 扩展 `/regenerate-world-section` 支持 `field` 参数 (era 单字段)

**Files:**
- Modify: `backend/api/stage2_world_char.py` (扩 payload + 加 validator + handler 分支)
- Create: `backend/tests/test_regenerate_world_section_field.py` (3 个测试)

### Step 1: 写失败测试 — section=era&field=geography 只改 geography

创建 `backend/tests/test_regenerate_world_section_field.py`:

```python
"""Tests for /regenerate-world-section?section=era&field=<era field>.

2026-09-20: WorldStep 二级 tab 需要细粒度 era 字段重生。
"""
from backend.api.stage2_world_char import regenerate_world_section, RegenerateWorldSectionPayload
from backend.models.world import World


class _FakeAgent:
    """LLM agent stub that returns a known result with only geography set."""
    def __init__(self, world_result: dict):
        self.world_result = world_result
    async def generate_world(self, **_kwargs):
        return self.world_result, None


def test_field_geography_only_writes_geography(monkeypatch, tmp_path):
    """section=era&field=geography → 只改 world.geography,其他 3 个 era 字段不变。"""
    # Set up minimal project state
    project_id = "proj_test"
    existing = {
        "era": "古代",
        "geography": "中原",
        "era_social_structure": "分封制",
        "era_cultural_history": "百家争鸣",
        "power_systems": [],
        "factions": [],
        "core_rules": [],
    }
    # ... (实际项目可能需要 mock _file_manager().read_json/write_json + agent)
    # 见下方完整示例
```

> **简化**:实际写测试时直接参照 `backend/tests/test_regenerate_world_section.py` 既有 fixture (`monkeypatch _file_manager` + mock agent) 复用同模式。把 payload 改为 `RegenerateWorldSectionPayload(section="era", field="geography", user_modifications="")`,验证 `world.json` 写入后:
> - `geography` 变成 mock agent 返回值
> - `era` / `era_social_structure` / `era_cultural_history` 与 existing 完全一致

```python
    # 断言:其他 3 个字段 byte-identical
    assert result["detail"]["era"] == existing["era"]
    assert result["detail"]["era_social_structure"] == existing["era_social_structure"]
    assert result["detail"]["era_cultural_history"] == existing["era_cultural_history"]
    # 断言:目标字段已替换
    assert result["detail"]["geography"] != existing["geography"]
```

### Step 2: 跑测试验证它失败

```bash
cd /Users/longsa/Codes/nebula
source venv/bin/activate
pytest backend/tests/test_regenerate_world_section_field.py -v
```

预期: FAIL — `TypeError: RegenerateWorldSectionPayload.__init__() got an unexpected keyword argument 'field'` (payload 还没接 field)。

### Step 3: 扩 `RegenerateWorldSectionPayload` 加 `field` + validator

打开 `backend/api/stage2_world_char.py` line 567 附近的 `RegenerateWorldSectionPayload`:

```python
from pydantic import model_validator
from typing import Literal

class RegenerateWorldSectionPayload(BaseModel):
    section: Literal["era", "power_system", "core_rules", "factions"]
    field: Optional[Literal["era", "geography",
                            "era_social_structure", "era_cultural_history"]] = None
    category: Optional[CoreRuleCategory] = None
    system_source: Optional[PowerSystemSource] = None
    user_modifications: str = Field(default="", max_length=1700)

    @model_validator(mode="after")
    def _check_dims_mutually_exclusive(self):
        non_null = sum(1 for x in (self.field, self.category, self.system_source) if x is not None)
        if non_null > 1:
            raise ValueError("field / category / system_source 互斥, 同时只能传一个")
        if self.field is not None and self.section != "era":
            raise ValueError("field 参数仅在 section='era' 时生效")
        if self.category is not None and self.section != "core_rules":
            raise ValueError("category 参数仅在 section='core_rules' 时生效")
        if self.system_source is not None and self.section != "power_system":
            raise ValueError("system_source 参数仅在 section='power_system' 时生效")
        return self
```

### Step 4: handler 加 `field` 分支

在 `regenerate_world_section` 函数内,line 632 的 `if payload.section == "era":` 分支,替换为:

```python
    if payload.section == "era":
        if payload.field is not None:
            # 2026-09-20: 新行为 — 仅替换目标 era 字段,其他 3 个 era 字段 byte-preserve
            merged = dict(existing)
            merged[payload.field] = result.get(payload.field, existing.get(payload.field, ""))
        else:
            # 旧行为: era 整组 (4 个字段一起重生)
            for key in ERA_BLOCK_KEYS:
                merged[key] = result.get(key, existing.get(key, ""))
```

### Step 5: 跑测试验证通过 + 全量回归

```bash
pytest backend/tests/test_regenerate_world_section_field.py -v
pytest backend/tests/test_regenerate_world_section.py -v   # 既有测试不能挂
pytest backend/tests/test_world_generation_prompt_format.py -v
```

预期: 全部 PASS。

### Step 6: Commit

```bash
git add backend/api/stage2_world_char.py backend/tests/test_regenerate_world_section_field.py
git commit -m "feat(api): /regenerate-world-section 支持 section=era&field=<field>

WorldStep 二级 tab 时代背景/地理环境/社会结构/历史文化 各自 ↻ 的后端通路。field / category / system_source 互斥,Pydantic validator 强制。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: 新增 `/regenerate-faction` 端点

**Files:**
- Modify: `backend/api/stage2_world_char.py` (新增 payload + endpoint)
- Create: `backend/tests/test_regenerate_faction.py` (3 个测试)

### Step 1: 写失败测试 — faction_index=1 只改 factions[1]

创建 `backend/tests/test_regenerate_faction.py`:

```python
"""Tests for /regenerate-faction?faction_index=N.

2026-09-20: WorldStep 二级 tab 势力分布 per-subtab ↻。
"""
import pytest
from backend.api.stage2_world_char import RegenerateFactionPayload, regenerate_faction


class _FakeAgent:
    def __init__(self, factions_result):
        self.factions_result = factions_result
    async def generate_world(self, **_kwargs):
        return {"factions": self.factions_result}, None


def test_faction_index_only_writes_target_index(monkeypatch, tmp_path):
    """faction_index=1 时, factions[1] 改变, factions[0] / factions[2] byte-identical。"""
    # 参照 test_regenerate_power_system_item.py 既有 fixture 模式
    # mock _file_manager + mock agent
    # 验证:
    #   - factions[0] == existing_factions[0]
    #   - factions[1] != existing_factions[1]   (新生成)
    #   - factions[2] == existing_factions[2]
    #   - factions.length 仍是 3


def test_faction_index_out_of_range_raises_422():
    """faction_index >= len(factions) → HTTPException 422。"""
    # 验证 raise HTTPException(422, ...)
    # 用 pytest.raises(HTTPException, match="越界")


def test_faction_only_index_kwarg_passed_to_agent(monkeypatch):
    """验证 generate_world 收到 faction_only_index 非空字符串。"""
    captured_kwargs = {}
    class _CaptureAgent:
        async def generate_world(self, **kwargs):
            captured_kwargs.update(kwargs)
            return {"factions": [{"name": "新势力"}]}, None
    # 替换 PlannerAgent 实例化路径,用 _CaptureAgent
    # 调用 regenerate_faction 后,断言 captured_kwargs["faction_only_index"] == "仅修改第 1 条"
```

> **实现细节**:参照既有 `test_regenerate_power_system_item.py` 的 fixture pattern (`monkeypatch _file_manager` + `monkeypatch PlannerAgent`),复用同模式写这 3 个测试。

### Step 2: 跑测试验证它失败

```bash
cd /Users/longsa/Codes/nebula
source venv/bin/activate
pytest backend/tests/test_regenerate_faction.py -v
```

预期: FAIL — `ImportError: cannot import name 'RegenerateFactionPayload' from 'backend.api.stage2_world_char'`。

### Step 3: 实现 payload + endpoint + 扩前端 API 客户端

打开 `backend/api/stage2_world_char.py`,在 `RegeneratePowerSystemItemPayload` 后面(line 722 附近)新增:

```python
class RegenerateFactionPayload(BaseModel):
    faction_index: int = Field(ge=0)
    user_modifications: str = Field(default="", max_length=1700)


@router.post("/regenerate-faction")
async def regenerate_faction(
    project_id: str = Query(...),
    payload: RegenerateFactionPayload = None,
):
    """Re-generate a single faction at factions[faction_index]. Other factions
    byte-preserved. Mirrors /regenerate-power-system-item semantics.

    2026-09-20: WorldStep 二级 tab 势力分布 per-subtab ↻ 后端通路。
    """
    from backend.agents.planner import PlannerAgent

    if not project_id:
        raise http_error(400, "VALIDATION_ERROR", "project_id 不能为空")

    project = _file_manager().read_json(project_id, "project.json")
    if project is None:
        raise http_error(404, "PROJECT_NOT_FOUND", f"项目 {project_id} 不存在")

    existing = _file_manager().read_json(project_id, "world.json") or {}
    concept_and_dna = _file_manager().read_json(project_id, "concept_and_dna.json") or {}
    genre = project.get("genre", "cool_novel")

    existing_factions = existing.get("factions", [])
    if payload.faction_index >= len(existing_factions):
        raise http_error(
            422,
            "FACTION_INDEX_OUT_OF_RANGE",
            f"faction_index {payload.faction_index} 越界 (现有 {len(existing_factions)} 条)",
        )

    agent = PlannerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
        genre=genre,
    )

    # 附加单条重生提示语到 user_modifications
    extra = (
        f"【单条重生】仅重生 factions[{payload.faction_index}],"
        f"其余 {len(existing_factions) - 1} 条势力原样保留。"
        f"返回 JSON 时只包含一条新的 faction 对象。"
    )
    full_mods = (payload.user_modifications + "\n" + extra).strip()

    try:
        decompose_data = _load_decompose_data(project_id)
        result, _resp = await agent.generate_world(
            concept=concept_and_dna.get("concept", {}),
            story_dna=concept_and_dna.get("story_dna", {}),
            genre=genre,
            user_modifications=full_mods,
            decompose_data=decompose_data,
            faction_only_index=f"仅修改第 {payload.faction_index} 条",
        )
    except ValueError as e:
        raise http_error(503, "LLM_GENERATION_FAILED", str(e))

    new_factions = result.get("factions", [])
    if not new_factions:
        raise http_error(503, "LLM_GENERATION_FAILED", "LLM 未返回任何 faction")

    # Defensive: 防御性过滤,只接受新 faction[0]
    merged_factions = list(existing_factions)
    merged_factions[payload.faction_index] = new_factions[0]

    merged = dict(existing)
    merged["factions"] = merged_factions

    try:
        merged = World.model_validate(merged).model_dump()
    except Exception:
        pass

    _file_manager().write_json(project_id, "world.json", merged)

    return {
        "error": False,
        "code": "OK",
        "message": f"factions[{payload.faction_index}] 已重新生成",
        "detail": merged,
    }
```

**扩前端 API 客户端**(`frontend/src/api/client.ts` line 1241 附近):

把现有签名:

```ts
  regenerateWorldSection: (
    projectId: string,
    section: "era" | "power_system" | "core_rules" | "factions",
    userModifications: string = "",
  ): Promise<World> =>
    request<World>(
      "POST",
      `/stage2/regenerate-world-section?project_id=${encodeURIComponent(projectId)}`,
      { section, user_modifications: userModifications },
    ),
```

替换为 (加可选 4th `options` 参,向后兼容既有 3 参调用方):

```ts
  regenerateWorldSection: (
    projectId: string,
    section: "era" | "power_system" | "core_rules" | "factions",
    userModifications: string = "",
    options: {
      field?: "era" | "geography" | "era_social_structure" | "era_cultural_history";
      category?: CoreRuleCategory;
      systemSource?: PowerSystemSource;
    } = {},
  ): Promise<World> =>
    request<World>(
      "POST",
      `/stage2/regenerate-world-section?project_id=${encodeURIComponent(projectId)}`,
      {
        section,
        user_modifications: userModifications,
        ...(options.field ? { field: options.field } : {}),
        ...(options.category ? { category: options.category } : {}),
        ...(options.systemSource ? { system_source: options.systemSource } : {}),
      },
    ),

  regenerateFaction: (
    projectId: string,
    factionIndex: number,
    userModifications: string = "",
  ): Promise<{ faction_index: number; faction: World["factions"][number]; world: World }> =>
    request<{ faction_index: number; faction: World["factions"][number]; world: World }>(
      "POST",
      `/stage2/regenerate-faction?project_id=${encodeURIComponent(projectId)}`,
      { faction_index: factionIndex, user_modifications: userModifications },
    ),
```

> **向后兼容**:`options` 默认 `{}`,既有 3-参调用方 (`WorldStep.tsx` 的 `handleSectionRegenerate`,`WorldEditor.workspace.test.tsx`,`WorldStep.tabs.test.tsx`) **不需要任何改动**。后端 Pydantic model 接受 Optional 字段,缺省走旧行为。
>
> **类型来源**: `CoreRuleCategory` / `PowerSystemSource` 这两个 TS enum 应该已经在 `frontend/src/api/client.ts` 文件顶部 import 过(在 World 类型附近)。grep 一下确认,如果没找到,需要在文件顶部补 import。

### Step 4: 跑测试验证通过

```bash
pytest backend/tests/test_regenerate_faction.py -v
pytest backend/tests/test_regenerate_power_system_item.py -v   # 既有不能挂
pytest backend/tests/test_regenerate_world_section.py -v
pytest backend/tests/test_regenerate_world_section_field.py -v
pytest backend/tests/test_world_generation_prompt_format.py -v
```

预期: 全 PASS。

### Step 5: Commit

```bash
git add backend/api/stage2_world_char.py backend/tests/test_regenerate_faction.py
git commit -m "feat(api): 新增 /regenerate-faction?faction_index=N

WorldStep 二级 tab 势力分布 per-subtab ↻ 的后端通路。Mirror /regenerate-power-system-item 语义:faction_index 越界返回 422,只替换目标条目,其他 byte-preserve。Prompt 拼接单条重生引导语并透传 faction_only_index。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: 前端基础 — `SubTabStrip` 内部组件 + 单元测试

**Files:**
- Modify: `frontend/src/components/wizard/WorldStep.tsx` (新增 `SubTabStrip` 内部组件)
- Create: `frontend/src/test/SubTabStrip.test.tsx` (单元测试 — 单独测组件本身)

> **设计说明**:`SubTabStrip` 是 WorldStep 文件内的私有组件,**不导出**。但为了独立测试它,任务 4 暂时把组件改成**也通过 named export 导出**(顶层 export 一个 `__testing__` 命名空间,内含 SubTabStrip)。任务 5 在 WorldStep 集成时,**也用文件内部 local 版本**,不要 import testing 版本(避免运行时多份代码)。测试通过后再决定是否保留 export — 简单做法是保留,但仅 `*.test.tsx` import。

### Step 1: 写失败测试 — `SubTabStrip` 渲染 N 个 tab + ↻

创建 `frontend/src/test/SubTabStrip.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { __testing__ } from "../components/wizard/WorldStep";

describe("SubTabStrip", () => {
  it("renders one tab button per tabs[] entry", () => {
    render(
      <__testing__.SubTabStrip
        tabs={[
          { key: "a", label: "Tab A" },
          { key: "b", label: "Tab B" },
          { key: "c", label: "Tab C" },
        ]}
        active="b"
        onChange={() => {}}
        testidPrefix="test-strip"
      />,
    );
    expect(screen.getByTestId("test-strip-a")).toBeInTheDocument();
    expect(screen.getByTestId("test-strip-b")).toBeInTheDocument();
    expect(screen.getByTestId("test-strip-c")).toBeInTheDocument();
    // active 标记
    expect(screen.getByTestId("test-strip-a").getAttribute("aria-selected")).toBe("false");
    expect(screen.getByTestId("test-strip-b").getAttribute("aria-selected")).toBe("true");
  });

  it("calls onChange with the tab key on click", () => {
    const onChange = vi.fn();
    render(
      <__testing__.SubTabStrip
        tabs={[{ key: "x", label: "X" }, { key: "y", label: "Y" }]}
        active="x"
        onChange={onChange}
        testidPrefix="t"
      />,
    );
    fireEvent.click(screen.getByTestId("t-y"));
    expect(onChange).toHaveBeenCalledWith("y");
  });

  it("renders ↻ button per tab when onRegenerate is provided", () => {
    const onRegen = vi.fn();
    render(
      <__testing__.SubTabStrip
        tabs={[{ key: "1", label: "Item 1" }]}
        active="1"
        onChange={() => {}}
        onRegenerate={onRegen}
        testidPrefix="r"
      />,
    );
    const regen = screen.getByTestId("r-1-regenerate");
    expect(regen).toBeInTheDocument();
    fireEvent.click(regen);
    expect(onRegen).toHaveBeenCalledWith("1");
  });

  it("does not render ↻ when onRegenerate is undefined", () => {
    render(
      <__testing__.SubTabStrip
        tabs={[{ key: "1", label: "Item 1" }]}
        active="1"
        onChange={() => {}}
        testidPrefix="r"
      />,
    );
    expect(screen.queryByTestId("r-1-regenerate")).not.toBeInTheDocument();
  });

  it("disables ↻ when disabled=true", () => {
    render(
      <__testing__.SubTabStrip
        tabs={[{ key: "1", label: "Item 1" }]}
        active="1"
        onChange={() => {}}
        onRegenerate={() => {}}
        testidPrefix="r"
        disabled
      />,
    );
    const regen = screen.getByTestId("r-1-regenerate");
    expect(regen.getAttribute("aria-disabled")).toBe("true");
    expect(regen.getAttribute("tabindex")).toBe("-1");
  });

  it("uses testidSuffix when provided", () => {
    render(
      <__testing__.SubTabStrip
        tabs={[{ key: "era_social_structure", label: "社会结构", testidSuffix: "social-structure" }]}
        active="era_social_structure"
        onChange={() => {}}
        testidPrefix="era"
      />,
    );
    expect(screen.getByTestId("era-social-structure")).toBeInTheDocument();
  });
});
```

### Step 2: 跑测试验证它失败

```bash
cd /Users/longsa/Codes/nebula/frontend
npx vitest run src/test/SubTabStrip.test.tsx
```

预期: FAIL — `import { __testing__ } from "../components/wizard/WorldStep"` 解析失败 (没有 `__testing__` export)。

### Step 3: 在 WorldStep.tsx 实现 `SubTabStrip` + `__testing__` export

打开 `frontend/src/components/wizard/WorldStep.tsx`,在文件底部 (`export default WorldStep;` 之后) 添加:

```tsx
// 内部测试钩子 — 仅 *.test.tsx 引用,生产代码不要 import 这个 namespace。
export const __testing__ = {
  SubTabStrip,
};

function SubTabStrip({
  tabs,
  active,
  onChange,
  onRegenerate,
  testidPrefix,
  disabled,
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
      className="sticky top-[40px] z-[5] -mx-1 px-1 bg-surface-container-low/95 backdrop-blur-sm flex gap-1 border-b border-outline-variant overflow-x-auto"
    >
      {tabs.map((t) => {
        const isActive = t.key === active;
        const tid = `${testidPrefix}-${t.testidSuffix ?? t.key}`;
        const isDisabled = !!disabled;
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
            {onRegenerate && (
              <span
                role="button"
                aria-label={`重新生成 ${t.label}`}
                aria-disabled={isDisabled}
                tabIndex={isDisabled ? -1 : 0}
                data-testid={`${tid}-regenerate`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isDisabled) onRegenerate(t.key);
                }}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && !isDisabled) {
                    e.preventDefault();
                    e.stopPropagation();
                    onRegenerate(t.key);
                  }
                }}
                className={
                  "ml-1 inline-flex items-center justify-center w-4 h-4 rounded text-on-surface-variant hover:text-primary hover:bg-primary-container/15 " +
                  (isDisabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer")
                }
              >
                <span aria-hidden="true" className="material-symbols-outlined text-[12px] leading-none">refresh</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

### Step 4: 跑测试验证通过

```bash
cd /Users/longsa/Codes/nebula/frontend
npx vitest run src/test/SubTabStrip.test.tsx
```

预期: PASS — 6 个测试全过。

### Step 5: Commit

```bash
git add frontend/src/components/wizard/WorldStep.tsx frontend/src/test/SubTabStrip.test.tsx
git commit -m "feat(worldstep): 内部 SubTabStrip 组件 + __testing__ export

可复用 sub-tab 条:tabs[] + active + onChange + 可选 onRegenerate。↻ 用 span role=button 模式(避免嵌套 button)。disabled 时 aria-disabled + tabIndex=-1。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: 前端基础 — `WorldStep` 加 `subTab` state + per-top-level-tab 记忆

**Files:**
- Modify: `frontend/src/components/wizard/WorldStep.tsx` (新增 `subTab` state + 透传 props 给 4 个 panel)
- Create: `frontend/src/test/WorldStep.subtabs.test.tsx` (新增初始测试,后续 task 扩展)

### Step 1: 写失败测试 — 跨顶级 tab 切换保留 active sub-tab

在 `frontend/src/test/WorldStep.subtabs.test.tsx` 末尾添加:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
    regenerateFaction: vi.fn(),   // 新增
  },
}));

import api from "../api/client";
import InitWizardModal from "../components/wizard/InitWizardModal";
import { getSessionKey } from "../components/wizard/WizardContext";

const PROJECT = "proj_x";
const KEY = getSessionKey(PROJECT);

beforeEach(() => {
  Object.values(api).forEach((fn) => (fn as ReturnType<typeof vi.fn>).mockReset?.());
  sessionStorage.clear();
});

function setupWithWorld(world: object) {
  sessionStorage.setItem(
    KEY,
    JSON.stringify({
      currentStep: 2,
      completedSteps: [1],
      status: "idle",
      data: {
        concept: { title: "T", genre: "cool_novel", premise: "", tone: "", theme: "", target_audience: "", style_template: "" },
        story_dna: { core_contradiction: { statement: "", side_a: "", side_b: "" }, value_stack: [] },
        world, characters: null, novel_outline: null, chapter1_outline: null,
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

describe("WorldStep sub-tab state memory", () => {
  it("remembers active sub-tab across top-level tab switch", async () => {
    setupWithWorld({
      era: "古代",
      geography: "中原",
      era_social_structure: "分封制",
      era_cultural_history: "百家争鸣",
      power_systems: [
        { name: "灵力", source: "energetics", description: "", stages: [], core_rules: [], ceilings: [] },
        { name: "武道", source: "energetics", description: "", stages: [], core_rules: [], ceilings: [] },
      ],
      factions: [
        { name: "天机阁", type: "", goal: "", relations: "" },
      ],
      core_rules: [{ category: "physical", text: "灵气存在" }],
    });

    // 默认 active 顶级 tab = era, active sub-tab = era (第一个字段)
    expect(await screen.findByTestId("world-tab-era-subtab-era").getAttribute("aria-selected")).toBe("true");

    // 切到 era 第 2 个 sub-tab (geography)
    fireEvent.click(screen.getByTestId("world-tab-era-subtab-geography"));
    expect(screen.getByTestId("world-tab-era-subtab-geography").getAttribute("aria-selected")).toBe("true");

    // 切到顶级 tab power_system
    fireEvent.click(screen.getByTestId("world-tab-power_system"));
    expect(screen.getByTestId("world-tab-power_system").getAttribute("aria-selected")).toBe("true");

    // 切回顶级 tab era
    fireEvent.click(screen.getByTestId("world-tab-era"));
    // active sub-tab 应仍是 geography (记忆)
    expect(screen.getByTestId("world-tab-era-subtab-geography").getAttribute("aria-selected")).toBe("true");
  });
});
```

### Step 2: 跑测试验证它失败

```bash
cd /Users/longsa/Codes/nebula/frontend
npx vitest run src/test/WorldStep.subtabs.test.tsx
```

预期: FAIL — `TestingLibraryElementError: Unable to find an element by: [data-testid="world-tab-era-subtab-era"]` (sub-tab testid 还没渲染)。

### Step 3: 在 WorldStep.tsx 加 `subTab` state + 透传 props 给 panel

打开 `frontend/src/components/wizard/WorldStep.tsx`,在 `WorldStep` 函数体内 (`const [activeKey, setActiveKey] = useState<WorldTabKey>("era");` 附近) **添加**:

```tsx
  // 2026-09-20: 每顶级 tab 各自记忆 active sub-tab
  const [subTab, setSubTab] = useState<Record<WorldTabKey, string>>({
    era: "era",
    power_system: "",
    core_rules: "",
    factions: "",
  });
  const updateSubTab = (key: WorldTabKey) => (subKey: string) => {
    setSubTab((prev) => ({ ...prev, [key]: subKey }));
  };
```

修改 4 个 panel 的 props (在 WorldStep render 中):

```tsx
    <EraPanel
      active={activeKey === "era"}
      projectId={projectId}
      world={world} setWorld={setWorld} busy={busy}
      activeSubTab={subTab.era}
      onSubTabChange={updateSubTab("era")}
    />
    <PowerSystemsPanel
      active={activeKey === "power_system"}
      projectId={projectId}
      world={world} setWorld={setWorld} busy={busy}
      activeSubTab={subTab.power_system}
      onSubTabChange={updateSubTab("power_system")}
      onAdd={addPowerSystem}
      onUpdateField={updatePowerSystem}
      onRemove={removePowerSystem}
      onRegenerateItem={(i) => handleItemRegenerate(i)}
    />
    <CoreRulesPanel
      active={activeKey === "core_rules"}
      projectId={projectId}
      world={world} setWorld={setWorld} busy={busy}
      activeSubTab={subTab.core_rules}
      onSubTabChange={updateSubTab("core_rules")}
    />
    <FactionsPanel
      active={activeKey === "factions"}
      projectId={projectId}
      world={world} setWorld={setWorld} busy={busy}
      activeSubTab={subTab.factions}
      onSubTabChange={updateSubTab("factions")}
      onAdd={addFaction}
      onUpdateField={updateFaction}
      onRemove={removeFaction}
    />
```

> **注意**:`projectId` 已在 WorldStep 函数签名 `WorldStepProps { projectId: string }` 内可用,**不需要从 useWizard() 重新取**。直接透传即可。

### Step 4: 改 4 个 panel 函数签名接收新 props (这步会让现有 panel 在没有 sub-tab 实现时报 TypeScript 错)

为 `EraPanel` 加 `activeSubTab` / `onSubTabChange` props:

```tsx
function EraPanel({
  active, world, setWorld, busy, activeSubTab, onSubTabChange,
}: {
  active: boolean;
  world: World;
  setWorld: (w: World) => void;
  busy: boolean;
  activeSubTab: string;
  onSubTabChange: (key: string) => void;
}) {
  // 临时: 把 props 接进来但暂不渲染 sub-tab,避免 TS 报错
  void activeSubTab; void onSubTabChange;
  return (
    <div ... 既有内容不变 ... />
  );
}
```

同样模式给 `PowerSystemsPanel` / `CoreRulesPanel` / `FactionsPanel` 加 props。**Task 6-9 会实际渲染 SubTabStrip**。

### Step 5: 跑测试验证通过

```bash
cd /Users/longsa/Codes/nebula/frontend
npx vitest run src/test/WorldStep.subtabs.test.tsx src/test/WorldStep.test.tsx src/test/InitWizardModal.test.tsx
```

预期: 第一个测试 (`WorldStep.subtabs.test.tsx`) 仍 FAIL (sub-tab 还没渲染)。其他现有测试 PASS。**这一阶段允许 sub-tab 渲染测试继续 FAIL,直到 Task 6 完成。**

### Step 6: Commit

```bash
git add frontend/src/components/wizard/WorldStep.tsx frontend/src/test/WorldStep.subtabs.test.tsx
git commit -m "feat(worldstep): subTab state + 4 个 panel 接收 activeSubTab props

state 按顶级 tab key 各自记录 active sub-tab。Task 6-9 在各 panel 内部实际渲染 SubTabStrip。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: `EraPanel` 4 个固定 sub-tab

**Files:**
- Modify: `frontend/src/components/wizard/WorldStep.tsx` (`EraPanel` 函数体改写)
- Modify: `frontend/src/test/WorldStep.subtabs.test.tsx` (新增 era 测试)

### Step 1: 追加失败测试 — EraPanel 渲染 4 个 sub-tab

在 `frontend/src/test/WorldStep.subtabs.test.tsx` 的 `describe("WorldStep sub-tab state memory")` 之后新增:

```tsx
describe("WorldStep EraPanel sub-tabs", () => {
  it("renders 4 fixed sub-tabs with correct labels and testids", async () => {
    setupWithWorld({
      era: "", geography: "", era_social_structure: "", era_cultural_history: "",
      power_systems: [], factions: [], core_rules: [],
    });
    await screen.findByTestId("world-tab-era-subtab-era");
    expect(screen.getByTestId("world-tab-era-subtab-era")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-era-subtab-geography")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-era-subtab-social-structure")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-era-subtab-cultural-history")).toBeInTheDocument();
  });

  it("era sub-tab ↻ calls /regenerate-world-section with field", async () => {
    setupWithWorld({
      era: "古代", geography: "中原", era_social_structure: "", era_cultural_history: "",
      power_systems: [], factions: [], core_rules: [],
    });
    await screen.findByTestId("world-tab-era-subtab-era");

    // mock regenerate modal 自动确认
    (api.regenerateWorldSection as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: false, code: "OK", message: "", detail: {
        era: "新古代", geography: "新中原", era_social_structure: "", era_cultural_history: "",
        power_systems: [], factions: [], core_rules: [],
      },
    });

    fireEvent.click(screen.getByTestId("world-tab-era-subtab-era-regenerate"));
    // 弹 modal 后确认(查找 modal 内的确认按钮,具体 testid 视 RegenerateModal 实现而定)
    // 简化: 直接断言 regenerateWorldSection 被以正确参数调用
    await vi.waitFor(() => {
      expect(api.regenerateWorldSection).toHaveBeenCalledWith(
        expect.any(String),
        "era",
        "",
        { field: "era" },
      );
    });
  });
});
```

### Step 2: 跑测试验证它失败

```bash
cd /Users/longsa/Codes/nebula/frontend
npx vitest run src/test/WorldStep.subtabs.test.tsx
```

预期: FAIL — `world-tab-era-subtab-era` 找不到 (EraPanel 还没渲染 sub-tab)。

### Step 3: 重写 EraPanel — 加 4 个 sub-tab + per-field ↻

在 WorldStep.tsx,找到 `function EraPanel(...) {`,**完全替换**整个函数:

```tsx
const ERA_FIELDS = [
  { key: "era",                    label: "时代背景",        testidSuffix: "era" },
  { key: "geography",              label: "地理环境",        testidSuffix: "geography" },
  { key: "era_social_structure",   label: "社会结构",        testidSuffix: "social-structure" },
  { key: "era_cultural_history",   label: "历史文化",        testidSuffix: "cultural-history" },
] as const;

function EraPanel({
  active, projectId, world, setWorld, busy, activeSubTab, onSubTabChange,
}: {
  active: boolean;
  projectId: string;
  world: World;
  setWorld: (w: World) => void;
  busy: boolean;
  activeSubTab: string;
  onSubTabChange: (key: string) => void;
}) {
  const field = activeSubTab && ERA_FIELDS.find((f) => f.key === activeSubTab)
    ? activeSubTab
    : "era";
  const fieldDef = ERA_FIELDS.find((f) => f.key === field)!;
  const value = (world as any)[field] ?? "";

  const setValue = (v: string) => setWorld({ ...world, [field]: v });

  return (
    <div
      role="tabpanel"
      id="world-panel-era"
      aria-labelledby="world-tab-era"
      hidden={!active}
      data-testid="world-panel-era"
      className="space-y-3"
    >
      <SubTabStrip
        tabs={ERA_FIELDS.map((f) => ({ key: f.key, label: f.label, testidSuffix: f.testidSuffix }))}
        active={field}
        onChange={onSubTabChange}
        onRegenerate={(k) => {
          // 直接调 API,跳过 RegenerateModal 二次确认弹窗
          // (sub-tab ↻ 设计意图是即时生效,与顶级 tab ↻ 走 modal 不同)
          api.regenerateWorldSection(projectId, "era", "", { field: k as any }).then((result: any) => {
            if (result?.error === false && result.detail) {
              setWorld(result.detail as World);
            }
          });
        }}
        testidPrefix="world-tab-era-subtab"
        disabled={busy}
      />
      <div data-testid={`world-tab-era-subtab-panel-${field}`}>
        <div>
          <label className="block font-mono text-primary-container mb-1 text-xs">{fieldDef.label}</label>
          <AutoTextarea
            data-testid={`world-era-${field.replace("era_", "")}`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={2}
            disabled={busy}
            className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
          />
        </div>
      </div>
    </div>
  );
}
```

> **实现细节 — 不用 `useSectionRegenerate`**:spec 决定 sub-tab ↻ **跳过 RegenerateModal 弹窗**(即时生效),所以不调 `useSectionRegenerate`。这是与顶级 tab ↻ 的有意差异 — 顶级 tab ↻ 走 modal 是因为它的"整组重生"成本高,需要用户二次确认;sub-tab ↻ 只改一项,即时生效更符合用户预期。如果后续产品觉得 sub-tab 也需要二次确认,把 onRegenerate 包到 `useSectionRegenerate` 即可。

### Step 4: 跑测试验证通过

```bash
cd /Users/longsa/Codes/nebula/frontend
npx vitest run src/test/WorldStep.subtabs.test.tsx
```

预期: 全部 PASS — 4 个 sub-tab 渲染 + ↻ 触发正确 API 调用 + 跨顶级 tab 记忆 (Task 5 的测试)。

### Step 5: Commit

```bash
git add frontend/src/components/wizard/WorldStep.tsx frontend/src/test/WorldStep.subtabs.test.tsx
git commit -m "feat(worldstep): EraPanel 4 个固定 sub-tab + per-field ↻

时代背景/地理环境/社会结构/历史文化 各自独立 sub-tab。点击 ↻ 调 /regenerate-world-section?section=era&field=X,只重生成那一项。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: `PowerSystemsPanel` N sub-tab + 空态 CTA

**Files:**
- Modify: `frontend/src/components/wizard/WorldStep.tsx` (`PowerSystemsPanel` 函数体重写 + 新增 `stripParenthetical` 工具)
- Modify: `frontend/src/test/WorldStep.subtabs.test.tsx` (新增 power-system 测试)

### Step 1: 追加失败测试

```tsx
describe("WorldStep PowerSystemsPanel sub-tabs", () => {
  it("renders empty-state CTA when power_systems is empty", async () => {
    setupWithWorld({
      era: "", geography: "", era_social_structure: "", era_cultural_history: "",
      power_systems: [], factions: [], core_rules: [],
    });
    await screen.findByTestId("world-tab-power_system");
    fireEvent.click(screen.getByTestId("world-tab-power_system"));
    expect(screen.getByTestId("world-power-system-empty")).toBeInTheDocument();
    expect(screen.getByTestId("world-power-system-generate-first")).toBeInTheDocument();
    expect(screen.queryByTestId("world-tab-power-system-subtab-0")).not.toBeInTheDocument();
  });

  it("renders N sub-tabs by length, title = stripParenthetical(name)", async () => {
    setupWithWorld({
      era: "", geography: "", era_social_structure: "", era_cultural_history: "",
      power_systems: [
        { name: "阴阳眼·双视观测（非常规主角能力体系）", source: "protagonist_engine", description: "", stages: [], core_rules: [], ceilings: [] },
        { name: "灵力", source: "energetics", description: "", stages: [], core_rules: [], ceilings: [] },
      ],
      factions: [], core_rules: [],
    });
    await screen.findByTestId("world-tab-power_system");
    fireEvent.click(screen.getByTestId("world-tab-power_system"));
    expect(screen.getByTestId("world-tab-power-system-subtab-0")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-power-system-subtab-1")).toBeInTheDocument();
    // stripParenthetical 把"（非常规主角能力体系）"去掉了
    expect(screen.getByTestId("world-tab-power-system-subtab-0").textContent).toContain("阴阳眼·双视观测");
    expect(screen.getByTestId("world-tab-power-system-subtab-0").textContent).not.toContain("（");
    // 第二个 name 没有括号,保持原样
    expect(screen.getByTestId("world-tab-power-system-subtab-1").textContent).toContain("灵力");
  });

  it("sub-tab ↻ calls regeneratePowerSystemItem with system_index", async () => {
    setupWithWorld({
      era: "", geography: "", era_social_structure: "", era_cultural_history: "",
      power_systems: [
        { name: "A", source: "energetics", description: "", stages: [], core_rules: [], ceilings: [] },
        { name: "B", source: "energetics", description: "", stages: [], core_rules: [], ceilings: [] },
      ],
      factions: [], core_rules: [],
    });
    await screen.findByTestId("world-tab-power_system");
    fireEvent.click(screen.getByTestId("world-tab-power_system"));
    fireEvent.click(screen.getByTestId("world-tab-power-system-subtab-1-regenerate"));
    await vi.waitFor(() => {
      expect(api.regeneratePowerSystemItem).toHaveBeenCalledWith(
        expect.any(String),
        1,
        "",
      );
    });
  });

  it("does not auto-jump active sub-tab on remove", async () => {
    setupWithWorld({
      era: "", geography: "", era_social_structure: "", era_cultural_history: "",
      power_systems: [
        { name: "A", source: "energetics", description: "", stages: [], core_rules: [], ceilings: [] },
        { name: "B", source: "energetics", description: "", stages: [], core_rules: [], ceilings: [] },
      ],
      factions: [], core_rules: [],
    });
    await screen.findByTestId("world-tab-power_system");
    fireEvent.click(screen.getByTestId("world-tab-power_system"));
    // active 默认是 0 (subTab.power_system = "" → fallback 到 "0")
    // 删第 0 个
    fireEvent.click(screen.getByTestId("world-power-system-0-remove"));
    // active sub-tab 仍是 "0"(虽然索引 0 现在指向原 B)
    expect(screen.getByTestId("world-tab-power-system-subtab-0").getAttribute("aria-selected")).toBe("true");
  });
});
```

### Step 2: 跑测试验证它失败

```bash
cd /Users/longsa/Codes/nebula/frontend
npx vitest run src/test/WorldStep.subtabs.test.tsx
```

预期: FAIL — `world-power-system-empty` 找不到 + `world-tab-power-system-subtab-0` 找不到。

### Step 3: 在 WorldStep.tsx 添加 `stripParenthetical` + 重写 `PowerSystemsPanel`

在 WorldStep.tsx 文件顶部 (import 之后) 添加:

```tsx
function stripParenthetical(name: string): string {
  return name.replace(/（[^）]*）/g, "").trim();
}
```

找到 `function PowerSystemsPanel(...)`,**完全替换**整个函数:

```tsx
function PowerSystemsPanel({
  active, world, setWorld, busy, activeSubTab, onSubTabChange,
  onAdd, onUpdateField, onRemove, onRegenerateItem,
}: {
  active: boolean;
  world: World;
  setWorld: (w: World) => void;
  busy: boolean;
  activeSubTab: string;
  onSubTabChange: (key: string) => void;
  onAdd: () => void;
  onUpdateField: <K extends keyof PowerSystem>(index: number, key: K, value: PowerSystem[K]) => void;
  onRemove: (index: number) => void;
  onRegenerateItem: (index: number) => (mods: string) => Promise<void>;
}) {
  const items = world.power_systems;

  if (items.length === 0) {
    return (
      <div
        role="tabpanel"
        id="world-panel-power_system"
        aria-labelledby="world-tab-power_system"
        hidden={!active}
        data-testid="world-panel-power_system"
      >
        <div data-testid="world-power-system-empty" className="text-center py-6 space-y-3">
          <p className="text-sm text-on-surface-variant">还没有力量体系</p>
          <button
            data-testid="world-power-system-generate-first"
            onClick={() => onRegenerateItem(0)("")}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-container text-on-primary-container hover:opacity-90 disabled:opacity-50"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-sm">auto_awesome</span>
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

  return (
    <div
      role="tabpanel"
      id="world-panel-power_system"
      aria-labelledby="world-tab-power_system"
      hidden={!active}
      data-testid="world-panel-power_system"
      className="space-y-3"
    >
      <SubTabStrip
        tabs={subTabs}
        active={activeSubTab || "0"}
        onChange={onSubTabChange}
        onRegenerate={(k) => {
          // 直接调 API,跳过 modal
          const i = parseInt(k, 10);
          api.regeneratePowerSystemItem(projectId, i, "")
            .then((result: any) => {
              if (result?.error === false && result.detail) {
                setWorld(result.detail as World);
              }
            });
        }}
        testidPrefix="world-tab-power-system-subtab"
        disabled={busy}
      />
      <div data-testid={`world-tab-power-system-subtab-panel-${activeSubTab || "0"}`}>
        <PowerSystemCard
          index={idx}
          ps={ps}
          onUpdateField={(field, v) => onUpdateField(idx, field, v)}
          onRegenerate={() => onRegenerateItem(idx)("")}
          onRemove={() => onRemove(idx)}
          saving={busy}
        />
      </div>
      <div className="flex justify-center pt-2">
        <button
          data-testid="world-power-system-add"
          onClick={onAdd}
          disabled={busy}
          className="secondary-button-style"
        >
          <span className="material-symbols-outlined text-xs">add</span>
          添加体系
        </button>
      </div>
    </div>
  );
}
```

> **实现细节**:
> 1. 既有 `PowerSystemCard` 组件保持不变,只把 cards 列表替换为"active sub-tab 对应单卡片"。
> 2. `PROJECT_ID_PLACEHOLDER` 需要替换为实际 `projectId` — WorldStepProps 已经传入 `projectId`,把它透传到 panel props。**Step 4 修正**。
> 3. `secondary-button-style` 是项目内已有的 utility class,找不到就 fallback 到 Tailwind 的具体 class (`px-3 py-1 border rounded text-sm ...`)。

### Step 4: 修正 projectId 透传

把 `PowerSystemsPanel` 的 props 列表加上 `projectId: string`,在 WorldStep render 处把 `projectId={projectId}` 传给 panel。在 panel 内部所有 `PROJECT_ID_PLACEHOLDER` 替换为 `projectId`。

### Step 5: 跑测试验证通过

```bash
cd /Users/longsa/Codes/nebula/frontend
npx vitest run src/test/WorldStep.subtabs.test.tsx
npx vitest run src/test/WorldStep.test.tsx
npx vitest run src/test/InitWizardModal.test.tsx
```

预期: sub-tabs 4 个测试全 PASS + 既有 WorldStep / InitWizardModal 测试不挂。

### Step 6: Commit

```bash
git add frontend/src/components/wizard/WorldStep.tsx frontend/src/test/WorldStep.subtabs.test.tsx
git commit -m "feat(worldstep): PowerSystemsPanel N sub-tab + 空态 CTA

按 power_systems.length 渲染 sub-tab,标题 = stripParenthetical(name)。N=0 时显示 '生成首个体系' CTA,不渲染 sub-tab 条。点击 ↻ 调 /regenerate-power-system-item?system_index=N。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: `CoreRulesPanel` category sub-tab

**Files:**
- Modify: `frontend/src/components/wizard/WorldStep.tsx` (`CoreRulesPanel` 函数体重写)
- Modify: `frontend/src/test/WorldStep.subtabs.test.tsx` (新增 core_rules 测试)

### Step 1: 追加失败测试

```tsx
describe("WorldStep CoreRulesPanel sub-tabs", () => {
  it("renders sub-tabs only for present categories", async () => {
    setupWithWorld({
      era: "", geography: "", era_social_structure: "", era_cultural_history: "",
      power_systems: [], factions: [],
      core_rules: [
        { category: "physical", text: "规则 1" },
        { category: "narrative", text: "规则 2" },
      ],
    });
    await screen.findByTestId("world-tab-core_rules");
    fireEvent.click(screen.getByTestId("world-tab-core_rules"));
    expect(screen.getByTestId("world-tab-core-rules-subtab-physical")).toBeInTheDocument();
    expect(screen.getByTestId("world-tab-core-rules-subtab-narrative")).toBeInTheDocument();
    expect(screen.queryByTestId("world-tab-core-rules-subtab-social")).not.toBeInTheDocument();
    expect(screen.queryByTestId("world-tab-core-rules-subtab-protagonist")).not.toBeInTheDocument();
  });

  it("sub-tab title uses Chinese label (物理公理 / 结构性瓶颈 / 解决路径封闭性 / 主角机制硬约束)", async () => {
    setupWithWorld({
      era: "", geography: "", era_social_structure: "", era_cultural_history: "",
      power_systems: [], factions: [],
      core_rules: [
        { category: "physical", text: "x" },
        { category: "social", text: "y" },
        { category: "narrative", text: "z" },
        { category: "protagonist", text: "w" },
      ],
    });
    await screen.findByTestId("world-tab-core_rules");
    fireEvent.click(screen.getByTestId("world-tab-core_rules"));
    expect(screen.getByTestId("world-tab-core-rules-subtab-physical").textContent).toContain("物理公理");
    expect(screen.getByTestId("world-tab-core-rules-subtab-social").textContent).toContain("结构性瓶颈");
    expect(screen.getByTestId("world-tab-core-rules-subtab-narrative").textContent).toContain("解决路径封闭性");
    expect(screen.getByTestId("world-tab-core-rules-subtab-protagonist").textContent).toContain("主角机制硬约束");
  });

  it("sub-tab ↻ calls /regenerate-world-section with category", async () => {
    setupWithWorld({
      era: "", geography: "", era_social_structure: "", era_cultural_history: "",
      power_systems: [], factions: [],
      core_rules: [
        { category: "physical", text: "x" },
        { category: "narrative", text: "z" },
      ],
    });
    await screen.findByTestId("world-tab-core_rules");
    fireEvent.click(screen.getByTestId("world-tab-core_rules"));
    fireEvent.click(screen.getByTestId("world-tab-core-rules-subtab-physical-regenerate"));
    await vi.waitFor(() => {
      expect(api.regenerateWorldSection).toHaveBeenCalledWith(
        expect.any(String),
        "core_rules",
        "",
        { category: "physical" },
      );
    });
  });
});
```

### Step 2: 跑测试验证它失败

```bash
cd /Users/longsa/Codes/nebula/frontend
npx vitest run src/test/WorldStep.subtabs.test.tsx
```

预期: FAIL — sub-tab testid 找不到。

### Step 3: 重写 CoreRulesPanel

找到 `function CoreRulesPanel(...)`,**完全替换**:

```tsx
const CORE_RULE_CATEGORIES = [
  { key: "physical",     label: "物理公理",         testidSuffix: "physical" },
  { key: "social",       label: "结构性瓶颈",       testidSuffix: "social" },
  { key: "narrative",    label: "解决路径封闭性",   testidSuffix: "narrative" },
  { key: "protagonist",  label: "主角机制硬约束",   testidSuffix: "protagonist" },
] as const;

function CoreRulesPanel({
  active, world, setWorld, busy, activeSubTab, onSubTabChange,
}: {
  active: boolean;
  world: World;
  setWorld: (w: World) => void;
  busy: boolean;
  activeSubTab: string;
  onSubTabChange: (key: string) => void;
}) {
  const grouped = useMemo(() => {
    const g: Record<string, string[]> = { physical: [], social: [], narrative: [], protagonist: [] };
    for (const r of world.core_rules ?? []) {
      const cat = (r as any).category ?? "physical";
      if (!g[cat]) g[cat] = [];
      g[cat].push((r as any).text ?? "");
    }
    return g;
  }, [world.core_rules]);

  const presentCategories = CORE_RULE_CATEGORIES.filter((c) => grouped[c.key].length > 0);

  if (presentCategories.length === 0) {
    return (
      <div
        role="tabpanel"
        id="world-panel-core_rules"
        aria-labelledby="world-tab-core_rules"
        hidden={!active}
        data-testid="world-panel-core_rules"
      >
        <div data-testid="world-core-rules-empty" className="text-center py-6 space-y-3">
          <p className="text-sm text-on-surface-variant">还没有核心规则</p>
          <button
            data-testid="world-core-rules-generate-first"
            onClick={() => {
              api.regenerateWorldSection(projectId, "core_rules", "").then((result: any) => {
                if (result?.error === false && result.detail) {
                  setWorld(result.detail as World);
                }
              });
            }}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-container text-on-primary-container hover:opacity-90 disabled:opacity-50"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-sm">auto_awesome</span>
            生成核心规则
          </button>
        </div>
      </div>
    );
  }

  const cat = activeSubTab && presentCategories.find((c) => c.key === activeSubTab)
    ? activeSubTab
    : presentCategories[0].key;

  const subTabs = presentCategories.map((c) => ({
    key: c.key,
    label: c.label,
    testidSuffix: c.testidSuffix,
  }));

  return (
    <div
      role="tabpanel"
      id="world-panel-core_rules"
      aria-labelledby="world-tab-core_rules"
      hidden={!active}
      data-testid="world-panel-core_rules"
    >
      <SubTabStrip
        tabs={subTabs}
        active={cat}
        onChange={onSubTabChange}
        onRegenerate={(k) => {
          api.regenerateWorldSection(projectId, "core_rules", "", { category: k as any }).then((result: any) => {
            if (result?.error === false && result.detail) {
              setWorld(result.detail as World);
            }
          });
        }}
        testidPrefix="world-tab-core-rules-subtab"
        disabled={busy}
      />
      <div data-testid={`world-tab-core-rules-subtab-panel-${cat}`} className="mt-3 space-y-2">
        <CategoryGroup
          category={cat}
          label={CORE_RULE_CATEGORIES.find((c) => c.key === cat)!.label}
          source={CORE_RULE_CATEGORIES.find((c) => c.key === cat)!.key}
          rules={grouped[cat]}
          onChange={(t) => {
            const others = (world.core_rules ?? []).filter((r: any) => r.category !== cat);
            setWorld({
              ...world,
              core_rules: [...others, ...t.map((text) => ({ category: cat, text }))],
            });
          }}
          saving={busy}
        />
      </div>
    </div>
  );
}
```

> **实现细节**:`CategoryGroup` 是 WorldStep 文件内既有的折叠子组件,**保持不变**,只把它放进 sub-tab panel 内。
> 同 Task 7,`PROJECT_ID_PLACEHOLDER` 在 Step 4 替换。

### Step 4: 修正 projectId 透传

把 `CoreRulesPanel` 的 props 列表加上 `projectId: string`,WorldStep render 处传 `projectId={projectId}` 给 panel。

### Step 5: 跑测试验证通过

```bash
cd /Users/longsa/Codes/nebula/frontend
npx vitest run src/test/WorldStep.subtabs.test.tsx
npx vitest run src/test/WorldStep.test.tsx
npx vitest run src/test/InitWizardModal.test.tsx
```

预期: 全部 PASS。

### Step 6: Commit

```bash
git add frontend/src/components/wizard/WorldStep.tsx frontend/src/test/WorldStep.subtabs.test.tsx
git commit -m "feat(worldstep): CoreRulesPanel category sub-tab (4 中文标签)

按已出现 category 渲染 sub-tab,标题用中文标签(物理公理 / 结构性瓶颈 / 解决路径封闭性 / 主角机制硬约束)。CategoryGroup 折叠逻辑保留在 sub-tab panel 内。空态显示 '生成核心规则' CTA。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: `FactionsPanel` N sub-tab + 空态 CTA

**Files:**
- Modify: `frontend/src/components/wizard/WorldStep.tsx` (`FactionsPanel` 函数体重写)
- Modify: `frontend/src/test/WorldStep.subtabs.test.tsx` (新增 faction 测试)

### Step 1: 追加失败测试

```tsx
describe("WorldStep FactionsPanel sub-tabs", () => {
  it("renders empty-state CTA when factions is empty", async () => {
    setupWithWorld({
      era: "", geography: "", era_social_structure: "", era_cultural_history: "",
      power_systems: [], factions: [], core_rules: [],
    });
    await screen.findByTestId("world-tab-factions");
    fireEvent.click(screen.getByTestId("world-tab-factions"));
    expect(screen.getByTestId("world-faction-empty")).toBeInTheDocument();
    expect(screen.getByTestId("world-faction-generate-first")).toBeInTheDocument();
    expect(screen.queryByTestId("world-tab-factions-subtab-0")).not.toBeInTheDocument();
  });

  it("renders N sub-tabs by length, title = stripParenthetical(name)", async () => {
    setupWithWorld({
      era: "", geography: "", era_social_structure: "", era_cultural_history: "",
      power_systems: [], core_rules: [],
      factions: [
        { name: "天机阁（正派联盟之首）", type: "", goal: "", relations: "" },
        { name: "血月楼", type: "", goal: "", relations: "" },
      ],
    });
    await screen.findByTestId("world-tab-factions");
    fireEvent.click(screen.getByTestId("world-tab-factions"));
    expect(screen.getByTestId("world-tab-factions-subtab-0").textContent).toContain("天机阁");
    expect(screen.getByTestId("world-tab-factions-subtab-0").textContent).not.toContain("（");
    expect(screen.getByTestId("world-tab-factions-subtab-1").textContent).toContain("血月楼");
  });

  it("sub-tab ↻ calls /regenerate-faction with faction_index", async () => {
    setupWithWorld({
      era: "", geography: "", era_social_structure: "", era_cultural_history: "",
      power_systems: [], core_rules: [],
      factions: [
        { name: "A", type: "", goal: "", relations: "" },
        { name: "B", type: "", goal: "", relations: "" },
      ],
    });
    await screen.findByTestId("world-tab-factions");
    fireEvent.click(screen.getByTestId("world-tab-factions"));
    fireEvent.click(screen.getByTestId("world-tab-factions-subtab-1-regenerate"));
    await vi.waitFor(() => {
      expect(api.regenerateFaction).toHaveBeenCalledWith(
        expect.any(String),
        1,
        "",
      );
    });
  });
});
```

### Step 2: 跑测试验证它失败

```bash
cd /Users/longsa/Codes/nebula/frontend
npx vitest run src/test/WorldStep.subtabs.test.tsx
```

预期: FAIL — sub-tab testid 找不到 + `api.regenerateFaction` mock 不存在(需在前置 vi.mock 加)。

### Step 3: 在 test 文件加 `regenerateFaction` mock

修改 `frontend/src/test/WorldStep.subtabs.test.tsx` 顶部的 `vi.mock("../api/client", ...)`,在 mock 对象里追加:

```ts
    regenerateFaction: vi.fn(),   // 新增
```

### Step 4: 重写 FactionsPanel

找到 `function FactionsPanel(...)`,**完全替换**:

```tsx
function FactionsPanel({
  active, world, setWorld, busy, activeSubTab, onSubTabChange,
  onAdd, onUpdateField, onRemove,
}: {
  active: boolean;
  world: World;
  setWorld: (w: World) => void;
  busy: boolean;
  activeSubTab: string;
  onSubTabChange: (key: string) => void;
  onAdd: () => void;
  onUpdateField: <K extends keyof World["factions"][number]>(index: number, key: K, value: World["factions"][number][K]) => void;
  onRemove: (index: number) => void;
}) {
  const items = world.factions;

  if (items.length === 0) {
    return (
      <div
        role="tabpanel"
        id="world-panel-factions"
        aria-labelledby="world-tab-factions"
        hidden={!active}
        data-testid="world-panel-factions"
      >
        <div data-testid="world-faction-empty" className="text-center py-6 space-y-3">
          <p className="text-sm text-on-surface-variant">还没有势力</p>
          <button
            data-testid="world-faction-generate-first"
            onClick={() => {
              api.regenerateWorldSection(projectId, "factions", "").then((result: any) => {
                if (result?.error === false && result.detail) {
                  setWorld(result.detail as World);
                }
                // 跳到第一个新势力
                onSubTabChange("0");
              });
            }}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-container text-on-primary-container hover:opacity-90 disabled:opacity-50"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-sm">auto_awesome</span>
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

  return (
    <div
      role="tabpanel"
      id="world-panel-factions"
      aria-labelledby="world-tab-factions"
      hidden={!active}
      data-testid="world-panel-factions"
      className="space-y-3"
    >
      <SubTabStrip
        tabs={subTabs}
        active={activeSubTab || "0"}
        onChange={onSubTabChange}
        onRegenerate={(k) => {
          const i = parseInt(k, 10);
          api.regenerateFaction(projectId, i, "").then((result: any) => {
            if (result?.error === false && result.detail) {
              setWorld(result.detail as World);
            }
          });
        }}
        testidPrefix="world-tab-factions-subtab"
        disabled={busy}
      />
      <div data-testid={`world-tab-factions-subtab-panel-${activeSubTab || "0"}`}>
        <FactionCard
          index={idx}
          faction={faction}
          onUpdateField={(field, v) => onUpdateField(idx, field, v)}
          onRegenerate={() => {
            api.regenerateFaction(projectId, idx, "").then((result: any) => {
              if (result?.error === false && result.detail) {
                setWorld(result.detail as World);
              }
            });
          }}
          onRemove={() => onRemove(idx)}
          saving={busy}
        />
      </div>
      <div className="flex justify-center pt-2">
        <button
          data-testid="world-faction-add"
          onClick={onAdd}
          disabled={busy}
          className="secondary-button-style"
        >
          <span className="material-symbols-outlined text-xs">add</span>
          添加势力
        </button>
      </div>
    </div>
  );
}
```

> **同前**:`PROJECT_ID_PLACEHOLDER` 在 Step 5 替换为 `projectId`,需要给 `FactionsPanel` props 加 `projectId: string`。

### Step 5: 修正 projectId 透传

修改 `FactionsPanel` props 列表加 `projectId: string`,WorldStep render 处传 `projectId={projectId}`。Panel 内所有 `PROJECT_ID_PLACEHOLDER` 替换为 `projectId`。

### Step 6: 跑测试验证通过

```bash
cd /Users/longsa/Codes/nebula/frontend
npx vitest run src/test/WorldStep.subtabs.test.tsx
npx vitest run src/test/WorldStep.test.tsx
npx vitest run src/test/InitWizardModal.test.tsx
```

预期: 全部 PASS。

### Step 7: Commit

```bash
git add frontend/src/components/wizard/WorldStep.tsx frontend/src/test/WorldStep.subtabs.test.tsx
git commit -m "feat(worldstep): FactionsPanel N sub-tab + 空态 CTA

按 factions.length 渲染 sub-tab,标题 = stripParenthetical(name)。N=0 时显示 '生成首个势力' CTA。点击 ↻ 调 /regenerate-faction?faction_index=N(新增端点)。

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: 全量回归 + 浏览器手工验证

**Files:** (无新代码改动)

### Step 1: 后端全量回归

```bash
cd /Users/longsa/Codes/nebula
source venv/bin/activate
pytest backend/tests/test_regenerate_world_section_field.py backend/tests/test_regenerate_faction.py backend/tests/test_regenerate_world_section.py backend/tests/test_regenerate_power_system_item.py backend/tests/test_world_generation_prompt_format.py -v
pytest backend/tests/ -v   # 全量 backend 测试,确保没有意外回归
```

预期: 全 PASS。如果任何测试 FAIL,回去对应 task 修。

### Step 2: 前端全量回归

```bash
cd /Users/longsa/Codes/nebula/frontend
npx vitest run
```

预期: 全 PASS。`WorldStep.subtabs.test.tsx` (7+ 用例) + 既有 `WorldStep.test.tsx` + `InitWizardModal.test.tsx` + 全项目其他测试都过。

> **警告**:vitest jsdom 冷缓存可能导致 `ReferenceError: document is not defined`(项目已知坑)。第一次 FAIL 时重跑,或加 `DEBUG="vitest:*"` 看细节。**不要改** `vitest.config.ts` 来绕过 — 见项目 memory `project_vitest_jsdom_cold_cache.md`。

### Step 3: 启动 dev 服务 + 浏览器手工验证

```bash
# Backend
cd /Users/longsa/Codes/nebula
source venv/bin/activate
unset MINIMAX_API_KEY   # 防止环境变量覆盖 .env
uvicorn backend.main:app --reload --reload-dir backend --reload-exclude 'test_*.py' --port 8000 &

# Frontend
cd /Users/longsa/Codes/nebula/frontend
npm run dev &
```

打开 http://localhost:5173,进入任一项目的世界观 wizard,验证:

1. **时代与地理 tab**: 4 个 sub-tab 渲染;切换 sub-tab 显示对应字段;点击 ↻ 触发 regenerate modal(若保留)/直接调 API。
2. **力量体系 tab**: N≥1 时显示 sub-tab,标题去括号;N=0 时显示空态 CTA;点击 ↻ 触发对应体系重生。
3. **世界规则 tab**: 只显示有规则的 category sub-tab,中文标签正确;点击 ↻ 只重生成该 category。
4. **势力分布 tab**: N≥1 时显示 sub-tab,标题去括号;N=0 时显示空态 CTA;点击 ↻ 调用新端点 `/regenerate-faction`。
5. **跨顶级 tab 切换**: 切换 era → power_system → era,era 的 active sub-tab 不重置。
6. **增删不自动跳**: 在力量体系删除当前 active 的卡片,active sub-tab 不变;删除后 UI 显示"空指针"内容(用户需手动切其他 sub-tab)。

如发现 UI bug,停下来修代码,**不要**绕过测试去 fix 视觉效果。

### Step 4: Commit (无改动则跳过;若 Step 3 发现 bug 修了代码,提交 fix)

```bash
# 如果没改动:
echo "No changes needed"

# 如果改了:
git status
git add <modified-files>
git commit -m "fix(worldstep): <具体描述>

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 实施顺序小结

```
Task 1  prompt 占位符 + planner 透传           [独立,可最早开始]
Task 2  /regenerate-world-section 加 field     [依赖 Task 1 的 planner 透传,顺序]
Task 3  /regenerate-faction 新端点             [依赖 Task 1 + 2]
Task 4  SubTabStrip 内部组件 + 单元测试        [独立,与后端并行]
Task 5  WorldStep subTab state                 [依赖 Task 4]
Task 6  EraPanel 4 sub-tab                     [依赖 Task 5 + 后端 Task 2]
Task 7  PowerSystemsPanel N sub-tab + CTA      [依赖 Task 5]
Task 8  CoreRulesPanel category sub-tab + CTA  [依赖 Task 5]
Task 9  FactionsPanel N sub-tab + CTA          [依赖 Task 5 + 后端 Task 3]
Task 10 全量回归 + 手工验证                     [依赖所有前置 task]
```

**可并行**:Task 1-3 (后端) 与 Task 4-5 (前端基础) 无依赖,可同步推进。Task 6-9 (4 个 panel) 之间互相独立,但都依赖 Task 5。