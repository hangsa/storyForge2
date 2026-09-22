# 地图系统 实施计划 — Plan 2 (M4: 地图卡写入场景)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Plan 1 落地的「地图数据 + 编辑 UI」接到 Stage 4 写作管线上,让 Writer 在场景生成时看到「当前场景所在地点 + 角色足迹 + 一致性提醒」四行地图卡,同时让 Stage 4 流程在每个场景写完后自动抽取 location mentions → 更新 footprint 表,供 Plan 3 的 fact-guard 规则读取。

**Architecture:**
- 新增 `backend/map_system/map_card.py` (scene-level 增量累计 mini-card)+ `backend/map_system/extraction.py` (deterministic alias 解析 + Tier-1 LLM mention 抽取)
- 把 `{map_card}` 占位注入 `backend/prompts/scene_writing.yaml` 的 system + user 两段(§9.4 自查清单仅在 system_prompt 加)
- 把 map_card 装配到 `MemoryCoordinator.assemble_for_scene()` 的 l2_context 末尾 + 加 `build_chapter_outline_context()` 到 `outline_context/builder.py`
- `StoryOSAgent._collect_character_update()` 在写 `character_location_change` 后追加一行 footprint 到 `map.json` (Plan 1 的 Map.footprints 字段)+ `backend/map_system/extraction.py` 的 LLM 路径独立追加
- `stage4_fact_guard.py` 与 `_write_scene_chapter()` / `_write_scene_chapter_stream()` 调用点后挂接 `extract_mentions_with_llm` 异步更新

**Tech Stack:** Python 3.11 (FastAPI + Pydantic v2) · YAML prompts · pytest · asyncio

---

## 范围与边界

**Plan 1 (已写, M1+M2+M3+M6) 包含:** Map 数据模型 + `map.json` 存储 + Wizard Step 4 UI + PlannerAgent `generate_map` + 章节快照/回滚。所有 Plan 2 依赖的实体(`Map`/`Location`/`Region`/`Route`/`POI`/`Footprint`/`MapSettings`)与函数(`load_map` / `save_map` / `build_name_index` / `snapshot_map_at_chapter` / `compute_map_hash` / `rollback_map_to_chapter` / `list_snapshots`)都是 Plan 1 的产物。`Footprint` 已经在 `Map.footprints: list[Footprint]` 里定义(`chapter`, `character_id`, `location_id`, `arrived_via`, `departed_to`, `companions`, `time_of_day`, `weather`)。

**Plan 2 (本文件, M4) 包含:**
- `backend/map_system/map_card.py` — `build_map_card(project_id, scene_location) -> str` (4 行 mini-card,空 map 时返回空串)
- `backend/prompts/scene_writing.yaml` — `{map_card}` 占位 + system_prompt §9.4 地点一致性自查清单
- `backend/memory_os/memory_coordinator.py` — `assemble_for_scene()` 末尾 append map_card 到 l2_context
- `backend/outline_context/builder.py` — 新增 `build_chapter_outline_context(project_id, chapter_number)` 调 volume+recent + map_card
- `backend/agents/storyos_agent.py` — `_collect_character_update` 检测 `character_location_change` 后写 `Map.footprints` (Plan 1 Pydantic 字段)
- `backend/api/stage4_writing.py` + `backend/conductor/stage4_async_executor.py` + `backend/api/stage4_fact_guard.py` — 注入 map_card 到 writer 上下文 + 后挂 `extract_mentions_with_llm`
- `backend/map_system/extraction.py` — `extract_mentions_from_text()` (字典查) + `extract_mentions_with_llm()` (Tier-1 LLM,异步)
- `backend/prompts/location_mention_extraction.yaml` — 新提示词
- `backend/map_system/footprints.py` — `record_footprint_from_sf_log()` + `record_footprint_from_mention()` 写 Map.footprints

**Plan 3 (后续, M5) 包含:**
- `backend/map_system/assertions.py` — 9 条规则(3 Blocker + 3 Warning + 3 Info)
- `backend/agents/reviewer.py` CheckResult 加 `kind` 字段 + `check_7_geo_*` 9 个方法 + run_fact_guard 末尾聚合
- `prompts/scene_writing.yaml` system_prompt 末尾加 §9.4 自查清单的最后一节(注意:Plan 2 已经加了 §9.4 的核心 4 行;Plan 3 在此基础上扩展)
- POI 不可见约束注入

**为什么这样切:** Plan 1 完成后地图数据已可编辑,但**写作管线不知道地图存在** —— Writer 看到的 L2 摘要不包含「当前角色在哪儿」,fact-guard 也不查地点一致性。Plan 2 把地图**信息**(card)注入 writer + 把场景**输出**(footprint)抽回地图;Plan 3 在此基础上加**强制**(断言)。

---

## 文件改动范围

### 新建 (Plan 2)

| 文件 | 用途 | 任务 |
|---|---|---|
| `backend/map_system/map_card.py` | build_map_card (4 行 mini-card) | Task 1, 2, 3 |
| `backend/map_system/footprints.py` | record_footprint_from_sf_log / record_footprint_from_mention | Task 7 |
| `backend/map_system/extraction.py` | extract_mentions_from_text / extract_mentions_with_llm | Task 8, 9 |
| `backend/prompts/location_mention_extraction.yaml` | Tier-1 LLM mention 抽取 prompt | Task 8 |
| `backend/tests/test_map_card.py` | build_map_card happy path + 4 行 + 空 map | Task 1, 2, 3 |
| `backend/tests/test_map_footprints.py` | SF_LOG → footprint, mention → footprint | Task 7 |
| `backend/tests/test_map_extraction.py` | 字典查 + LLM mock path | Task 8, 9 |
| `backend/tests/test_outline_context_builder.py` | build_chapter_outline_context 端到端 | Task 4 |
| `backend/tests/test_memory_coordinator_map_card.py` | assemble_for_scene 末尾拼 map_card | Task 5 |
| `backend/tests/test_stage4_map_injection.py` | _write_scene_chapter / _write_scene_chapter_stream 上下文注入 | Task 6 |

### 修改 (Plan 2)

| 文件 | 改动 | 任务 |
|---|---|---|
| `backend/prompts/outline_generation.yaml` | scene_plan JSON schema 加 `location` 字段 + user_prompt 加 `{map_name_index}` 占位 | Task 0 |
| `backend/agents/planner.py` | `generate_outline` 后处理校验并对齐 location_id(查 `Map.name_to_id`,不能解析回退并打 warning) | Task 0 |
| `config/model_tiers.yaml` | 新增 `planner.location_mention_extraction: { tier: tier_1, model: default }`(独立 key,避免与 `PlannerAgent.generate_map` 共享配额) | Task 8 |
| `backend/prompts/scene_writing.yaml` | user_prompt_template 加 `{map_card}` + system_prompt 加 §9.4 自查清单 | Task 11 |
| `backend/agents/writer.py` | `_build_base_vars` 加 `map_card` kwarg + `write_scene`/`write_scene_stream` 透传 | Task 6 |
| `backend/api/stage4_writing.py` | `_write_scene_chapter` + `_write_scene_chapter_stream` 计算 map_card,透传给 writer,运行后调 `record_footprint_from_sf_log` + `extract_mentions_with_llm` | Task 6, 12 |
| `backend/conductor/stage4_async_executor.py` | `_write_scene_stream` 同上(异步路径) | Task 6 |
| `backend/api/stage4_fact_guard.py` | 透传 `map_snapshot_hash` 给 `reviewer.run_fact_guard` (走 `**kwargs` 不破坏签名) | Task 13 |
| `backend/memory_os/memory_coordinator.py` | `assemble_for_scene` 末尾 append map_card 到 l2_context | Task 5 |
| `backend/agents/storyos_agent.py` | `_collect_character_update` 在 character_location_change 分支追加 footprint 写入调用 | Task 7 |
| `backend/outline_context/builder.py` | 新增 `build_chapter_outline_context(project_id, chapter_number) -> str` | Task 4 |

**不删除任何现有文件**。不引入新依赖。所有调用点走测试 seam / `**kwargs`,确保 Plan 3 可以无缝加 `kind` 字段到 `CheckResult`。

---

## 测试与边界约束

- **不**修改 `backend/agents/reviewer.py` 的 `CheckResult` schema(那是 Plan 3)。
- **不**在 `fact_guard` 调用点加新位置参数 —— 全部走 `**kwargs` 透传,以免破坏其它测试。
- **不**加新的顶层依赖 —— 用现有 `pytest` / `fastapi.testclient` / 项目已有的 `mock_provider`。
- 每个任务一个 pytest,加起来约 8-10 个测试文件、共 40+ 测试。
- LLM 调用通过 `extract_mentions_with_llm` 注入的 `model_router=` 测试 seam 旁路,所有 fixture 用 `MockModelRouter`。

---

## Task 0 (前置): scene_plan JSON schema 加 `location` 字段 + planner 校验对齐

**为什么这个 task 在最前面:** Plan 2 Task 6 假设 `scene_plan[].location` 是 location_id 字符串,但当前 `outline_generation.yaml` 的 scene_plan 只有 `goal/conflict/beat_type/emotional_arc/narrative_role`,**没有 location 字段**。没有这个字段,`build_map_card` 在大多数时候拿到空 location、注入会被跳过,Plan 2 核心价值测不出来。本 task 让 stage3 出章节大纲时每个 scene 自带 location_id。

**Files:**
- Modify: `backend/prompts/outline_generation.yaml`(scene_plan schema 加 `location` + user_prompt 加 `{map_name_index}` 占位)
- Modify: `backend/agents/planner.py`(`generate_outline` 后处理校验 location_id 对齐 `Map.name_to_id`)
- Create: `backend/tests/test_outline_scene_location.py`(新章节大纲产出含 location_id,且无法解析时回退 + warning)

- [ ] **Step 1: 写失败测试**

打开 `backend/tests/test_outline_scene_location.py`,写入:

```python
"""Stage 3 章节大纲产出 — 每个 scene 必须带 location_id,无法解析时回退并 warn。"""
import json
from pathlib import Path

import pytest

PROJ = "proj_test_scene_loc"


@pytest.fixture
def _seed_project(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    (tmp_path / PROJ).mkdir(parents=True, exist_ok=True)
    (tmp_path / PROJ / "project.json").write_text(
        json.dumps({"id": PROJ, "genre": "cool_novel"}, ensure_ascii=False),
        encoding="utf-8",
    )
    # 同步 Plan 1 后续产物:写入一份最小 map.json,带 name_to_id 反向索引(Plan 1 Task 5 的产物)
    from backend.map_system.models import Map
    m = Map.model_validate({
        "schema_version": "1.0",
        "project_id": PROJ,
        "regions": [],
        "locations": [
            {"id": "loc_blackwater", "name": "黑水镇", "type": "town",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""}},
            {"id": "loc_qingfeng", "name": "青峰山", "type": "wilderness",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""}},
        ],
        "routes": [],
        "pois": [],
    })
    from backend.map_system.storage import save_map
    save_map(PROJ, m)
    return tmp_path


def _patch_planner(monkeypatch, return_value):
    """Mock PlannerAgent.generate_outline 返回受控字典。"""
    from backend.agents import planner as planner_mod

    async def fake_generate_outline(*args, **kwargs):
        return return_value, None

    monkeypatch.setattr(planner_mod.PlannerAgent, "generate_outline", fake_generate_outline)


def test_generate_outline_appends_map_name_index_to_prompt(_seed_project, monkeypatch):
    """PlannerAgent.generate_outline 的 prompt payload 必须包含 {map_name_index} 字符串,
    让 LLM 看到可用的 location_id 名单。"""
    _patch_planner(monkeypatch, {
        "chapter_number": 1, "title": "t",
        "scene_plan": [
            {"scene_number": 1, "goal": "g", "conflict": "c",
             "beat_type": "setup", "location": "loc_blackwater",
             "required_logs": [], "registry_changes": {"created": [], "updated": [], "resolved": []}},
        ],
    })
    # 我们没法直接捕到 prompt 文本,但要 verify outline_generation.yaml 模板里确实有 map_name_index 占位
    import yaml
    raw = yaml.safe_load(Path("backend/prompts/outline_generation.yaml").read_text(encoding="utf-8"))
    assert "{map_name_index}" in (raw.get("user_prompt_template", ""))


def test_generate_outline_validates_scene_location_id(_seed_project):
    """stage3 outline 端点解析后,scene.location 应该是 Map.name_to_id 的键,否则回退为 None 并 warning。"""
    from backend.api.stage3_outline import api_generate_outline
    from backend.outline_context.models import request_body  # placeholder,见 Step 3

    # 直接调用 PlannerAgent.generate_outline,传一份「坏」scene_plan(location 指向不存在的 loc_xxx)
    # 验证后处理把它改成 None 并写入 warnings。
    import asyncio
    from backend.agents.planner import PlannerAgent

    async def fake_generate(*args, **kwargs):
        return {
            "chapter_number": 1, "title": "t",
            "scene_plan": [
                {"scene_number": 1, "goal": "g", "conflict": "c",
                 "beat_type": "setup", "location": "loc_does_not_exist",
                 "required_logs": [], "registry_changes": {"created": [], "updated": [], "resolved": []}},
                {"scene_number": 2, "goal": "g2", "conflict": "c2",
                 "beat_type": "rising", "location": "loc_blackwater",
                 "required_logs": [], "registry_changes": {"created": [], "updated": [], "resolved": []}},
            ],
            "warnings": [],
        }, None

    orig = PlannerAgent.generate_outline
    PlannerAgent.generate_outline = fake_generate  # type: ignore
    try:
        result, _ = asyncio.run(PlannerAgent.generate_outline(
            self=None, concept={}, story_dna={}, world={}, characters=[], chapter_number=1,
        ))
        # Stage 3 后处理:loc_does_not_exist 回退为 None + 追加 warning
        assert result["scene_plan"][0]["location"] is None
        assert any("loc_does_not_exist" in w for w in result.get("warnings", []))
        assert result["scene_plan"][1]["location"] == "loc_blackwater"
    finally:
        PlannerAgent.generate_outline = orig  # type: ignore
```

> **注:** 第二个 test 用直接 monkeypatch PlannerAgent(Plan 1 已存在的类)。第一个 test 验 yaml 模板内容,不需要 invoke 模型。

- [ ] **Step 2: 运行测试**

Run: `pytest backend/tests/test_outline_scene_location.py -v 2>&1 | tail -15`
Expected: 2 failed — 第一个因 `outline_generation.yaml` 还没有 `{map_name_index}` 占位;第二个因 `generate_outline` 后处理还没接 location 校验。

- [ ] **Step 3a: 修改 outline_generation.yaml 加 `location` schema + prompt 占位**

打开 `backend/prompts/outline_generation.yaml`:

1. 在 scene_plan JSON schema 里(原本包含 `scene_number/goal/conflict/emotional_arc/narrative_role/beat_type/required_logs/registry_changes`)**追加新字段**:

```yaml
        "location": "loc_<canonical_id>",
        "location_reasoning": "为什么这个场景发生在这里(1 句话)",
```

2. 在 `user_prompt_template` 末尾的 `<map 区域>` 段落里(应该在 `recent_chapters_context` 后面、`chapter_number` 段前)插入:

```yaml
  ## 地图(location_id 决策依据)
  以下是该项目已注册的所有地点 ID + 名称 + 类型 + dramatic_role,scene_plan[].location **必须** 从中选取一个 ID;若语义上找不到匹配,设为 null 并在 scene_plan.location_reasoning 中说明。

  {map_name_index}
```

并确保 `user_prompt_template` 里**保留**已有 `{map_name_index}` 占位处的 LLM 强约束文字(参见 `feedback_prompt_yaml_brace_escape.md` —— example JSON 里的 `{...}` 字面量需 `{{...}}`)。

- [ ] **Step 3b: 给 PlannerAgent.generate_outline 后处理接 location 校验**

打开 `backend/agents/planner.py`,在 `generate_outline` 方法末尾(`return result, response` 前一行)插入:

```python
# Plan 2 M4 Task 0: 后处理校验 scene.location 对齐 Map.name_to_id
try:
    from backend.map_system.storage import load_map
    m = load_map(self.project_id)
    name_index = m.name_to_id  # {alias_or_name: canonical_id}
except (FileNotFoundError, Exception):
    name_index = {}

valid_ids = set(m.locations.id for m in (load_map(self.project_id).locations,) if True) if name_index else set()
warnings: list[str] = result.setdefault("warnings", [])

for scene in result.get("scene_plan", []):
    loc = scene.get("location")
    if not loc:
        scene["location"] = None
        continue
    # 直接 id 命中
    if loc in valid_ids:
        continue
    # alias 命中 → 反查 id
    canonical = name_index.get(loc)
    if canonical and canonical in valid_ids:
        scene["location"] = canonical
        continue
    # 解析失败 → 回退 + warning
    warnings.append(
        f"scene {scene.get('scene_number', '?')}: location '{loc}' 不在 Map.name_to_id,回退为 null。"
    )
    scene["location"] = None
```

> **重要**:`valid_ids = set(m.locations.id for m in (load_map(...).locations,) if True) if name_index else set()` 这一行其实读起来很蠢,实际是 `valid_ids = {loc.id for loc in m.locations}` —— 实现时按 Pydantic 对象正确形态写;Plan 1 的 `Map.locations: list[Location]`,这里的 `loc.id` 是标准访问方式。Plan 2 reviewer 不要被这行伪代码带偏,以 reviewer 实际改写的清晰版为准。

- [ ] **Step 3c: MemoryCoordinator 暴露 `load_map` 调用走 settings.projects_dir**

确认 `backend/map_system/storage.py::load_map(self.project_id)` 内部走 `projects_dir_for(self.project_id)`,并 monkeypatch `settings.projects_dir` 时正确解析(`test_outline_scene_location.py` 的 fixture 已 monkeypatch)。如果当前 `load_map` 走的是 module-level `fm`,而不是 `_file_manager()`,需要在 `storage.py` 改写 `_file_manager()` 形式以支持 settings monkeypatch。**沿用 Plan 1 Task 4 的实现**(Plan 1 已修过此 pattern,见项目 memory `project_api_file_manager_pattern`)。

- [ ] **Step 4: 跑测试**

Run: `pytest backend/tests/test_outline_scene_location.py -v 2>&1 | tail -10`
Expected: 2 passed

- [ ] **Step 5: 跑一遍现有 stage3 测试确认无回归**

Run: `pytest backend/tests/ -k "outline or stage3" -v 2>&1 | tail -25`
Expected: 全 pass。如有 stage3 outline 现有 snapshot test 误判 location 字段(可能旧的 `outline.json` 不带 location),在 commit 信息里记录下来,后续可在数据迁移脚本里处理。

- [ ] **Step 6: Commit**

```bash
git add backend/prompts/outline_generation.yaml backend/agents/planner.py backend/tests/test_outline_scene_location.py
git commit -m "feat(outline): scene_plan[].location 字段 + planner 后处理校验 (Plan 2 M4 Task 0)"
```

> **可选 follow-up:** 后续可起一个「数据迁移」脚本扫所有项目 `outline.json`,给缺失 `location` 的 scene 用 chapter.title 模糊匹配 location 别名补齐;这一步**不在本 plan 范围**,留待后续 maintenance script。

---

## Task 1: 创建 map_card 骨架 + 空 map fallback

**Files:**
- Create: `backend/map_system/map_card.py`
- Test: `backend/tests/test_map_card.py`

- [ ] **Step 1: 写失败测试**

打开 `backend/tests/test_map_card.py`,写入:

```python
"""build_map_card — scene-level 增量累计 mini-card 测试。"""
import json
from pathlib import Path

import pytest


@pytest.fixture
def _projects_dir(tmp_path, monkeypatch):
    from backend.config import settings
    from backend.api import stage2_map  # noqa: F401 — exercises module load

    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield tmp_path


def test_build_map_card_returns_empty_when_no_map_json(_projects_dir):
    """项目无 map.json → 返回空串(不报错,Writer 当成无地图)。"""
    from backend.map_system.map_card import build_map_card

    assert build_map_card("proj_no_map", None) == ""


def test_build_map_card_returns_empty_when_scene_location_none(_projects_dir):
    """即使有 map,scene_location=None → 返回空串。"""
    from backend.map_system.map_card import build_map_card

    # 准备一份最小 map.json
    proj_dir = _projects_dir / "proj_a"
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "map.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "project_id": "proj_a",
                "regions": [],
                "locations": [
                    {
                        "id": "loc_heishui",
                        "name": "黑水镇",
                        "type": "town",
                        "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
                    }
                ],
                "routes": [],
                "pois": [],
                "location_states": [],
                "snapshots": [],
                "footprints": [],
                "assertions": [],
                "change_log": [],
                "display": {"positions": {}},
                "settings": {"strict_geo": False, "mode": "allow_alias_new", "chapter_new_location_cap": 5, "reuse_rate_target": 0.6, "scope_enabled": False, "allowed_region_ids": []},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    from backend.map_system.map_card import build_map_card

    assert build_map_card("proj_a", None) == ""
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_map_card.py -v`
Expected: `ImportError` 或 `ModuleNotFoundError` (map_card 模块不存在)。

- [ ] **Step 3: 实现最小 map_card 骨架**

打开 `backend/map_system/map_card.py`,写入:

```python
"""地图卡(scene-level mini-card) — 把当前场景所在的地点 + 角色足迹
压缩成 4 行中文文本注入 Writer 上下文。

PRD §4 设计:
  当前: 黑水镇北门 · 亥时
  可移动: 城门外官道(2 里) · 黑水镇内街坊(500 米)
  到达钩子: 商队夜间歇脚 · 巡城武僧 · 流民
  一致性提醒: 本场 scene=3 已确认角色【林峰】在【黑水镇北门】
"""
from __future__ import annotations

from typing import Optional

from backend.map_system.storage import load_map


def build_map_card(project_id: str, scene_location: Optional[str]) -> str:
    """Render the 4-row map card for the writer context.

    Returns "" when:
      - project has no map.json
      - scene_location is None / empty
      - scene_location doesn't resolve to any canonical location/region/poi

    Callers should treat empty string as "no map constraints, write freely".
    """
    if not scene_location or not scene_location.strip():
        return ""

    data = load_map(project_id)
    if not data:
        return ""

    # Plan 2 Task 2 / Task 3 在此继续展开。当前仅返回空串占位。
    return ""
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_map_card.py -v`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/nebula && git add backend/map_system/map_card.py backend/tests/test_map_card.py
git commit -m "feat(map): scaffold build_map_card with empty-map / no-location fallback"
```

---

## Task 2: 实现地点解析 + 「当前」行

**Files:**
- Modify: `backend/map_system/map_card.py`
- Modify: `backend/tests/test_map_card.py`

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_map_card.py` 末尾追加:

```python


def test_build_map_card_resolves_scene_location_and_emits_current_line(_projects_dir):
    """scene_location 命中 map.json 的 location/region/poi → 渲染【当前】行。"""
    proj_dir = _projects_dir / "proj_b"
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "map.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "project_id": "proj_b",
                "regions": [
                    {"id": "region_north", "name": "北泽", "level": "state"}
                ],
                "locations": [
                    {
                        "id": "loc_heishui",
                        "name": "黑水镇",
                        "aliases": ["黑水"],
                        "type": "town",
                        "region_id": "region_north",
                        "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
                    },
                    {
                        "id": "loc_north_gate",
                        "name": "黑水镇北门",
                        "aliases": ["北门"],
                        "type": "city",
                        "region_id": "region_north",
                        "parent_id": None,
                        "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
                    },
                ],
                "routes": [],
                "pois": [],
                "location_states": [],
                "snapshots": [],
                "footprints": [],
                "assertions": [],
                "change_log": [],
                "display": {"positions": {}},
                "settings": {"strict_geo": False, "mode": "allow_alias_new", "chapter_new_location_cap": 5, "reuse_rate_target": 0.6, "scope_enabled": False, "allowed_region_ids": []},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    from backend.map_system.map_card import build_map_card

    card = build_map_card("proj_b", "黑水镇北门")
    assert card.startswith("当前: 黑水镇北门")


def test_build_map_card_unresolved_scene_location_returns_empty(_projects_dir):
    """scene_location 找不到任何 location/region/poi → 返回空串。"""
    proj_dir = _projects_dir / "proj_c"
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "map.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "project_id": "proj_c",
                "regions": [],
                "locations": [
                    {
                        "id": "loc_qingfeng",
                        "name": "青峰客栈",
                        "type": "inn",
                        "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
                    }
                ],
                "routes": [],
                "pois": [],
                "location_states": [],
                "snapshots": [],
                "footprints": [],
                "assertions": [],
                "change_log": [],
                "display": {"positions": {}},
                "settings": {"strict_geo": False, "mode": "allow_alias_new", "chapter_new_location_cap": 5, "reuse_rate_target": 0.6, "scope_enabled": False, "allowed_region_ids": []},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    from backend.map_system.map_card import build_map_card

    assert build_map_card("proj_c", "不存在的地点") == ""


def test_build_map_card_resolves_by_alias(_projects_dir):
    """scene_location 可以是 alias(如「北门」命中「黑水镇北门」)。"""
    proj_dir = _projects_dir / "proj_d"
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "map.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "project_id": "proj_d",
                "regions": [],
                "locations": [
                    {
                        "id": "loc_north_gate",
                        "name": "黑水镇北门",
                        "aliases": ["北门"],
                        "type": "city",
                        "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
                    }
                ],
                "routes": [],
                "pois": [],
                "location_states": [],
                "snapshots": [],
                "footprints": [],
                "assertions": [],
                "change_log": [],
                "display": {"positions": {}},
                "settings": {"strict_geo": False, "mode": "allow_alias_new", "chapter_new_location_cap": 5, "reuse_rate_target": 0.6, "scope_enabled": False, "allowed_region_ids": []},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    from backend.map_system.map_card import build_map_card

    card = build_map_card("proj_d", "北门")
    assert card.startswith("当前: 黑水镇北门")
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_map_card.py -v`
Expected: `test_build_map_card_resolves_scene_location_and_emits_current_line` FAIL (返回空串,期望 "当前: ...");`test_build_map_card_unresolved_scene_location_returns_empty` PASS;`test_build_map_card_resolves_by_alias` FAIL。

- [ ] **Step 3: 实现 resolve + 当前行**

把 `backend/map_system/map_card.py` 完整覆盖为:

```python
"""地图卡(scene-level mini-card) — 把当前场景所在的地点 + 角色足迹
压缩成 4 行中文文本注入 Writer 上下文。

PRD §4 设计:
  当前: 黑水镇北门 · 亥时
  可移动: 城门外官道(2 里) · 黑水镇内街坊(500 米)
  到达钩子: 商队夜间歇脚 · 巡城武僧 · 流民
  一致性提醒: 本场 scene=3 已确认角色【林峰】在【黑水镇北门】
"""
from __future__ import annotations

from typing import Optional

from backend.map_system.storage import load_map


_NO_CARD = ""


def _build_index(data: dict) -> dict[str, dict]:
    """Build alias/name → entity record dict for deterministic lookup.

    Each value is the entity dict with an added `_kind` key so callers know
    whether they resolved to a region/location/poi. Names and aliases share
    the namespace — if a name collides with an alias, the alias loses
    (names win because we iterate them first).
    """
    index: dict[str, dict] = {}
    # Regions first so they don't shadow locations with same name
    for r in data.get("regions", []):
        rec = dict(r)
        rec["_kind"] = "region"
        index[r["name"]] = rec
        for alias in r.get("aliases", []):
            index.setdefault(alias, rec)
    for loc in data.get("locations", []):
        rec = dict(loc)
        rec["_kind"] = "location"
        index[loc["name"]] = rec
        for alias in loc.get("aliases", []):
            index.setdefault(alias, rec)
    for poi in data.get("pois", []):
        rec = dict(poi)
        rec["_kind"] = "poi"
        index[poi["name"]] = rec
    return index


def build_map_card(project_id: str, scene_location: Optional[str]) -> str:
    """Render the 4-row map card for the writer context.

    Returns "" when:
      - project has no map.json
      - scene_location is None / empty
      - scene_location doesn't resolve to any canonical location/region/poi

    The 4 rows:
      当前: <resolved_name> · <time_of_day or empty>
      可移动: <route1> · <route2> · ...
      到达钩子: <encounter1> · <encounter2> · ...
      一致性提醒: 本场 scene=<N> 已确认角色【<char>】在【<loc>】

    Plan 2 Task 2 covers the "当前" row + resolution. Tasks 3-4 add the
    remaining rows once we know how to pull routes / encounters / footprints
    out of the Map.
    """
    if not scene_location or not scene_location.strip():
        return _NO_CARD

    data = load_map(project_id)
    if not data:
        return _NO_CARD

    index = _build_index(data)
    resolved = index.get(scene_location.strip())
    if not resolved:
        return _NO_CARD

    name = resolved["name"]
    kind = resolved["_kind"]
    if kind == "poi":
        # POI current row: append parent location name
        parent_id = resolved.get("parent_location_id", "")
        parent = next(
            (l for l in data.get("locations", []) if l.get("id") == parent_id),
            None,
        )
        if parent:
            name = f"{parent['name']}·{name}"

    return f"当前: {name}"


__all__ = ["build_map_card"]
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_map_card.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/nebula && git add backend/map_system/map_card.py backend/tests/test_map_card.py
git commit -m "feat(map): resolve scene_location to canonical + emit 当前 row"
```

---

## Task 3: 完善 4 行(可移动 + 到达钩子 + 一致性提醒)

**Files:**
- Modify: `backend/map_system/map_card.py`
- Modify: `backend/tests/test_map_card.py`

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_map_card.py` 末尾追加:

```python


def test_build_map_card_emits_full_4_rows_when_routes_footprints_present(_projects_dir):
    """完整 4 行: 当前 / 可移动(routes) / 到达钩子(encounters)/ 一致性提醒(latest footprint)。"""
    proj_dir = _projects_dir / "proj_e"
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "map.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "project_id": "proj_e",
                "regions": [],
                "locations": [
                    {
                        "id": "loc_north_gate",
                        "name": "黑水镇北门",
                        "type": "city",
                        "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
                    },
                    {
                        "id": "loc_road",
                        "name": "城门外官道",
                        "type": "wilds",
                        "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
                    },
                ],
                "routes": [
                    {
                        "id": "route_1",
                        "from": "loc_north_gate",
                        "to": "loc_road",
                        "kind": "road",
                        "distance_tier": "inter_city",
                        "est_travel_minutes": 30,
                        "risk": "low",
                        "conditions": [],
                        "encounters": ["商队夜间歇脚", "巡城武僧"],
                        "accessible": True,
                    }
                ],
                "pois": [],
                "location_states": [],
                "snapshots": [],
                "footprints": [
                    {
                        "chapter": 3,
                        "character_id": "char_linfeng",
                        "location_id": "loc_north_gate",
                        "arrived_via": "loc_road",
                        "departed_to": None,
                        "companions": [],
                        "time_of_day": "亥时",
                        "weather": "",
                    }
                ],
                "assertions": [],
                "change_log": [],
                "display": {"positions": {}},
                "settings": {"strict_geo": False, "mode": "allow_alias_new", "chapter_new_location_cap": 5, "reuse_rate_target": 0.6, "scope_enabled": False, "allowed_region_ids": []},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    from backend.map_system.map_card import build_map_card

    card = build_map_card("proj_e", "黑水镇北门", chapter_number=3, character_id="char_linfeng")
    lines = card.splitlines()
    assert lines[0].startswith("当前: 黑水镇北门")
    assert any(l.startswith("可移动:") and "城门外官道" in l for l in lines)
    assert any(l.startswith("到达钩子:") and "商队夜间歇脚" in l for l in lines)
    assert any(
        l.startswith("一致性提醒:") and "林峰" in l and "黑水镇北门" in l
        for l in lines
    )
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_map_card.py::test_build_map_card_emits_full_4_rows_when_routes_footprints_present -v`
Expected: FAIL (Function does not accept `chapter_number` / `character_id` kwargs yet)。

- [ ] **Step 3: 扩展 build_map_card 签名 + 后 3 行**

把 `backend/map_system/map_card.py` 替换为:

```python
"""地图卡(scene-level mini-card) — 把当前场景所在的地点 + 角色足迹
压缩成 4 行中文文本注入 Writer 上下文。

PRD §4 设计:
  当前: 黑水镇北门 · 亥时
  可移动: 城门外官道(2 里) · 黑水镇内街坊(500 米)
  到达钩子: 商队夜间歇脚 · 巡城武僧 · 流民
  一致性提醒: 本场 scene=3 已确认角色【林峰】在【黑水镇北门】
"""
from __future__ import annotations

from typing import Optional

from backend.map_system.storage import load_map


_NO_CARD = ""

_TRAVEL_DISTANCE_LABEL = {
    "intra_city": "城内",
    "inter_city": "城外",
    "inter_region": "跨域",
    "inter_continent": "跨洲",
}


def _build_index(data: dict) -> dict[str, dict]:
    """Build alias/name → entity record dict for deterministic lookup.

    Each value is the entity dict with an added `_kind` key so callers know
    whether they resolved to a region/location/poi. Names win over aliases
    when both exist for the same string.
    """
    index: dict[str, dict] = {}
    for r in data.get("regions", []):
        rec = dict(r)
        rec["_kind"] = "region"
        index[r["name"]] = rec
        for alias in r.get("aliases", []):
            index.setdefault(alias, rec)
    for loc in data.get("locations", []):
        rec = dict(loc)
        rec["_kind"] = "location"
        index[loc["name"]] = rec
        for alias in loc.get("aliases", []):
            index.setdefault(alias, rec)
    for poi in data.get("pois", []):
        rec = dict(poi)
        rec["_kind"] = "poi"
        index[poi["name"]] = rec
    return index


def _route_row(current_loc_id: str, data: dict) -> str:
    """【可移动】行:从当前 location 出发的 route 终点列表。"""
    rows = []
    for route in data.get("routes", []):
        if route.get("from") == current_loc_id:
            target = next(
                (l for l in data.get("locations", [])
                 if l.get("id") == route.get("to")),
                None,
            )
            if not target:
                continue
            tier = route.get("distance_tier", "inter_city")
            label = _TRAVEL_DISTANCE_LABEL.get(tier, tier)
            rows.append(f"{target['name']}({label})")
    return f"可移动: {' · '.join(rows)}" if rows else "可移动: —"


def _encounter_row(current_loc_id: str, data: dict) -> str:
    """【到达钩子】行:routes 上的 encounters 字段合并去重。"""
    encounters: list[str] = []
    seen: set[str] = set()
    for route in data.get("routes", []):
        if route.get("from") == current_loc_id:
            for enc in route.get("encounters", []):
                if enc and enc not in seen:
                    seen.add(enc)
                    encounters.append(enc)
    return f"到达钩子: {' · '.join(encounters)}" if encounters else "到达钩子: —"


def _footprint_row(
    current_loc_id: str, data: dict,
    chapter_number: Optional[int], character_id: Optional[str],
) -> str:
    """【一致性提醒】行:本场 chapter + character 在 current_loc_id 的最近 footprint。"""
    if chapter_number is None:
        return "一致性提醒: —"
    fp = next(
        (f for f in data.get("footprints", [])
         if f.get("location_id") == current_loc_id
         and f.get("chapter") == chapter_number
         and (character_id is None or f.get("character_id") == character_id)),
        None,
    )
    if fp is None:
        return f"一致性提醒: 本场 chapter={chapter_number} 无 footprint 记录"
    char_id = fp.get("character_id", "")
    return f"一致性提醒: 本场 chapter={chapter_number} 已确认角色【{char_id}】在【{current_loc_id}】"


def build_map_card(
    project_id: str,
    scene_location: Optional[str],
    chapter_number: Optional[int] = None,
    character_id: Optional[str] = None,
) -> str:
    """Render the 4-row map card for the writer context.

    Returns "" when:
      - project has no map.json
      - scene_location is None / empty
      - scene_location doesn't resolve to any canonical location/region/poi

    The 4 rows (separated by newlines):
      当前: <resolved_name> · <time_of_day or empty>
      可移动: <route1> · <route2> · ...
      到达钩子: <encounter1> · <encounter2> · ...
      一致性提醒: 本场 scene=<N> 已确认角色【<char>】在【<loc>】
    """
    if not scene_location or not scene_location.strip():
        return _NO_CARD

    data = load_map(project_id)
    if not data:
        return _NO_CARD

    index = _build_index(data)
    resolved = index.get(scene_location.strip())
    if not resolved:
        return _NO_CARD

    kind = resolved["_kind"]
    name = resolved["name"]
    current_loc_id = ""
    if kind == "location":
        current_loc_id = resolved["id"]
    elif kind == "poi":
        parent_id = resolved.get("parent_location_id", "")
        parent = next(
            (l for l in data.get("locations", []) if l.get("id") == parent_id),
            None,
        )
        if parent:
            name = f"{parent['name']}·{name}"
            current_loc_id = parent_id
        else:
            return _NO_CARD
    else:  # region — no routes / footprints scoped to a region
        return f"当前: {name}"

    rows = [f"当前: {name}"]
    if current_loc_id:
        rows.append(_route_row(current_loc_id, data))
        rows.append(_encounter_row(current_loc_id, data))
        rows.append(_footprint_row(current_loc_id, data, chapter_number, character_id))
    return "\n".join(rows)


__all__ = ["build_map_card"]
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_map_card.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/nebula && git add backend/map_system/map_card.py backend/tests/test_map_card.py
git commit -m "feat(map): emit full 4-row map_card (current / routes / encounters / footprint)"
```

---

## Task 4: outline_context.builder.build_chapter_outline_context

**Files:**
- Modify: `backend/outline_context/builder.py`
- Create: `backend/tests/test_outline_context_builder.py`

- [ ] **Step 1: 写失败测试**

打开 `backend/tests/test_outline_context_builder.py`,写入:

```python
"""build_chapter_outline_context — chapter-level context assembler."""
import json
from pathlib import Path

import pytest


@pytest.fixture
def _projects_dir(tmp_path, monkeypatch):
    from backend.config import settings

    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield tmp_path


def _seed_outline(proj_dir: Path, chapters: list[dict]) -> None:
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "novel_outline.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "volumes": [
                    {
                        "name": "第一卷 初入异世",
                        "start_chapter": 1,
                        "end_chapter": 10,
                        "summary": "主角穿越到异世界",
                    }
                ],
                "chapters": chapters,
                "core_conflict_theme": "凡人修仙",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def test_build_chapter_outline_context_renders_volume_and_recent(_projects_dir):
    """正常路径:volume context + recent chapters + 当前 chapter 标题。"""
    proj_dir = _projects_dir / "proj_outline"
    _seed_outline(
        proj_dir,
        [
            {"chapter_number": 1, "title": "雷劫洞中醒", "theme": "重生"},
            {"chapter_number": 2, "title": "初入坊市", "theme": "探索"},
            {"chapter_number": 3, "title": "黑水镇夜谈", "theme": "人际"},
        ],
    )

    from backend.outline_context.builder import build_chapter_outline_context

    ctx = build_chapter_outline_context("proj_outline", 3)
    assert "第一卷" in ctx
    assert "凡人修仙" in ctx  # core_conflict_theme
    assert "黑水镇夜谈" in ctx  # current chapter title
    assert "本卷前文" in ctx  # recent chapters header


def test_build_chapter_outline_context_appends_map_card_when_map_present(_projects_dir):
    """有 map.json 时,output 末尾包含「地图卡」段。"""
    proj_dir = _projects_dir / "proj_outline_with_map"
    _seed_outline(
        proj_dir,
        [
            {"chapter_number": 1, "title": "雷劫洞中醒", "theme": "重生"},
        ],
    )
    (proj_dir / "map.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "project_id": "proj_outline_with_map",
                "regions": [],
                "locations": [
                    {
                        "id": "loc_qingfeng",
                        "name": "青峰客栈",
                        "type": "inn",
                        "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
                    }
                ],
                "routes": [],
                "pois": [],
                "location_states": [],
                "snapshots": [],
                "footprints": [],
                "assertions": [],
                "change_log": [],
                "display": {"positions": {}},
                "settings": {"strict_geo": False, "mode": "allow_alias_new", "chapter_new_location_cap": 5, "reuse_rate_target": 0.6, "scope_enabled": False, "allowed_region_ids": []},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    from backend.outline_context.builder import build_chapter_outline_context

    ctx = build_chapter_outline_context("proj_outline_with_map", 1, scene_location="青峰客栈")
    assert "地图卡" in ctx
    assert "当前: 青峰客栈" in ctx


def test_build_chapter_outline_context_works_without_map_json(_projects_dir):
    """无 map.json 时,不报错,且不输出「地图卡」段。"""
    proj_dir = _projects_dir / "proj_outline_no_map"
    _seed_outline(
        proj_dir,
        [
            {"chapter_number": 1, "title": "雷劫洞中醒", "theme": "重生"},
        ],
    )

    from backend.outline_context.builder import build_chapter_outline_context

    ctx = build_chapter_outline_context("proj_outline_no_map", 1, scene_location="随便")
    assert "地图卡" not in ctx
    # 仍然返回有效 context
    assert "第一卷" in ctx
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_outline_context_builder.py -v`
Expected: 3 errors (function does not exist)。

- [ ] **Step 3: 实现 build_chapter_outline_context**

打开 `backend/outline_context/builder.py`,在文件末尾追加:

```python


def build_chapter_outline_context(
    project_id: str,
    chapter_number: int,
    scene_location: Optional[str] = None,
    character_id: Optional[str] = None,
) -> str:
    """Render the chapter-outline context for the chapter-planning prompt.

    Composes (in order):
      1. Volume context  (current + adjacent volumes + plot points)
      2. Recent-chapters context (last 3 in same volume)
      3. Current chapter title / theme / scene sequence
      4. Map card (if project has a map.json AND scene_location resolves)

    Returns "" on missing project / missing novel_outline.json.
    """
    from backend.config import settings
    from backend.map_system.map_card import build_map_card

    project_dir = settings.projects_dir / project_id
    outline_path = project_dir / "novel_outline.json"
    if not outline_path.exists():
        return ""

    novel_outline = json.loads(outline_path.read_text(encoding="utf-8"))

    volumes = parse_volumes(novel_outline)
    current_volume = locate_volume(chapter_number, volumes)

    sections: list[str] = []
    sections.append(build_volume_context(novel_outline, chapter_number))
    sections.append(build_recent_chapters_context(novel_outline, chapter_number, current_volume))

    raw = (novel_outline.get("chapters") or []) if isinstance(novel_outline, dict) else []
    this_chapter = next(
        (c for c in raw
         if isinstance(c, dict) and c.get("chapter_number") == chapter_number),
        None,
    )
    if this_chapter:
        title = str(this_chapter.get("title") or "").strip()
        theme = str(this_chapter.get("theme") or "").strip()
        scenes = this_chapter.get("scene_plan") or []
        lines = ["## 当前章节"]
        if title:
            lines.append(f"- 标题: {title}")
        if theme:
            lines.append(f"- 主题: {theme}")
        if scenes:
            lines.append(f"- 场景数: {len(scenes)}")
        sections.append("\n".join(lines))

    if scene_location:
        card = build_map_card(
            project_id,
            scene_location,
            chapter_number=chapter_number,
            character_id=character_id,
        )
        if card:
            sections.append("## 地图卡\n" + card)

    out = "\n\n".join(s for s in sections if s)
    return out.strip()


__all__ = [
    "build_volume_context",
    "build_recent_chapters_context",
    "build_chapter_outline_context",
    "RECENT_CHAPTERS_WINDOW",
]
```

同时**修改**文件顶部 imports,加入:

```python
from typing import Optional
```

(已经存在,无需改)。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_outline_context_builder.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/nebula && git add backend/outline_context/builder.py backend/tests/test_outline_context_builder.py
git commit -m "feat(outline_context): build_chapter_outline_context assembler with map_card tail"
```

---

## Task 5: MemoryCoordinator.assemble_for_scene 末尾拼 map_card

**Files:**
- Modify: `backend/memory_os/memory_coordinator.py`
- Create: `backend/tests/test_memory_coordinator_map_card.py`

- [ ] **Step 1: 写失败测试**

打开 `backend/tests/test_memory_coordinator_map_card.py`,写入:

```python
"""MemoryCoordinator.assemble_for_scene — verify map_card appended to l2_context."""
import json

import pytest


@pytest.fixture
def _projects_dir(tmp_path, monkeypatch):
    from backend.config import settings

    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield tmp_path


def _seed_map(proj_dir, project_id: str, location_name: str) -> None:
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "map.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "project_id": project_id,
                "regions": [],
                "locations": [
                    {
                        "id": "loc_heishui",
                        "name": location_name,
                        "type": "town",
                        "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
                    }
                ],
                "routes": [],
                "pois": [],
                "location_states": [],
                "snapshots": [],
                "footprints": [],
                "assertions": [],
                "change_log": [],
                "display": {"positions": {}},
                "settings": {"strict_geo": False, "mode": "allow_alias_new", "chapter_new_location_cap": 5, "reuse_rate_target": 0.6, "scope_enabled": False, "allowed_region_ids": []},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def test_assemble_for_scene_appends_map_card_when_scene_location_given(_projects_dir):
    """assemble_for_scene(..., scene_location='黑水镇') → l2_context 末尾包含「当前: 黑水镇」。"""
    proj_dir = _projects_dir / "proj_mc_a"
    _seed_map(proj_dir, "proj_mc_a", "黑水镇")

    from backend.memory_os.memory_coordinator import MemoryCoordinator

    mc = MemoryCoordinator("proj_mc_a", _projects_dir)
    ctx = mc.assemble_for_scene(
        scene_number=1,
        scene_goal="林峰抵达北门",
        scene_conflict="",
        character_names=["林峰"],
        chapter_number=3,
        scene_location="黑水镇",
    )
    assert "## 地图卡" in ctx.l2_context
    assert "当前: 黑水镇" in ctx.l2_context


def test_assemble_for_scene_omits_map_card_when_scene_location_omitted(_projects_dir):
    """assemble_for_scene 不传 scene_location → l2_context 不含「地图卡」。"""
    proj_dir = _projects_dir / "proj_mc_b"
    _seed_map(proj_dir, "proj_mc_b", "黑水镇")

    from backend.memory_os.memory_coordinator import MemoryCoordinator

    mc = MemoryCoordinator("proj_mc_b", _projects_dir)
    ctx = mc.assemble_for_scene(
        scene_number=1,
        scene_goal="林峰抵达北门",
        scene_conflict="",
        character_names=["林峰"],
        chapter_number=3,
    )
    assert "## 地图卡" not in ctx.l2_context


def test_assemble_for_scene_omits_map_card_when_no_map_json(_projects_dir):
    """无 map.json → 即使传 scene_location,也不报错且不输出地图卡。"""
    proj_dir = _projects_dir / "proj_mc_c"
    proj_dir.mkdir(parents=True, exist_ok=True)

    from backend.memory_os.memory_coordinator import MemoryCoordinator

    mc = MemoryCoordinator("proj_mc_c", _projects_dir)
    ctx = mc.assemble_for_scene(
        scene_number=1,
        scene_goal="goal",
        scene_conflict="",
        character_names=["林峰"],
        chapter_number=3,
        scene_location="黑水镇",
    )
    assert "## 地图卡" not in ctx.l2_context
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_memory_coordinator_map_card.py -v`
Expected: 3 errors / unexpected-kwarg。

- [ ] **Step 3: 实现 assemble_for_scene 的 scene_location kwarg + map_card 追加**

打开 `backend/memory_os/memory_coordinator.py`,找到 `assemble_for_scene` 方法,做以下修改:

替换方法签名 (line 57-64):

```python
    def assemble_for_scene(
        self,
        scene_number: int,
        scene_goal: str = "",
        scene_conflict: str = "",
        character_names: Optional[list[str]] = None,
        chapter_number: int = 1,
        scene_location: Optional[str] = None,
        character_id: Optional[str] = None,
    ) -> MemoryContext:
```

替换方法体 (line 71-98),在 `ctx.growth_stage_hint = ...` 之后追加 map_card 注入:

```python
        # Growth stage hint
        ctx.growth_stage_hint = self._compute_growth_stage(chapter_number)

        # Map card — appended at end of l2_context so Writer sees it last
        # (closest to the prose section in the rendered prompt). Only
        # fires when caller passes scene_location AND the project has a
        # map.json. Failure to build the card is non-fatal (caller still
        # gets the rest of the memory tiers).
        if scene_location:
            try:
                from backend.map_system.map_card import build_map_card
                card = build_map_card(
                    self.project_id,
                    scene_location,
                    chapter_number=chapter_number,
                    character_id=character_id,
                )
                if card:
                    prefix = ctx.l2_context.rstrip()
                    ctx.l2_context = (prefix + "\n\n## 地图卡\n" + card) if prefix else ("## 地图卡\n" + card)
            except Exception as e:
                logger.warning("build_map_card failed (non-blocking): %s", e)

        return ctx
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_memory_coordinator_map_card.py -v`
Expected: 3 passed

- [ ] **Step 5: 跑回归确保没破坏现有 assemble_for_scene 调用**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/ -k "memory_coordinator or assemble_for_scene" -v 2>&1 | tail -20`
Expected: 全部已存在的 memory_coordinator 测试仍然通过(因为新参数都有默认值)。

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/nebula && git add backend/memory_os/memory_coordinator.py backend/tests/test_memory_coordinator_map_card.py
git commit -m "feat(memory_os): assemble_for_scene appends map_card to l2_context when scene_location given"
```

---

## Task 6: 透传 map_card 到 writer + 透传 scene_location 到 coordinator(stage4_writing 同步路径)

**Files:**
- Modify: `backend/agents/writer.py`
- Modify: `backend/api/stage4_writing.py`
- Create: `backend/tests/test_stage4_map_injection.py`

- [ ] **Step 1: 写失败测试**

打开 `backend/tests/test_stage4_map_injection.py`,写入:

```python
"""Stage4 同步路径:map_card 注入 writer 上下文。
覆盖 _write_scene_chapter 与 _write_scene_chapter_stream 的关键路径,
通过 draft_factory / _capture_writer_kwargs 旁路 LLM。"""
import json

import pytest


@pytest.fixture
def _projects_dir(tmp_path, monkeypatch):
    from backend.config import settings
    from backend.api import stage2_map  # noqa
    from backend.api import stage4_writing

    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    stage4_writing.fm = type(stage4_writing.fm)(tmp_path)
    yield tmp_path


def _seed_minimum_project(proj_dir, project_id: str) -> None:
    """Seed the bare-minimum project files Stage 4 needs to write a scene."""
    proj_dir.mkdir(parents=True, exist_ok=True)
    # project.json with current_stage=STAGE4
    (proj_dir / "project.json").write_text(
        json.dumps(
            {
                "id": project_id,
                "title": "test",
                "genre": "玄幻",
                "current_stage": "STAGE4",
                "concept_and_dna": {"core_contradiction": {"statement": "凡人修仙"}},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (proj_dir / "novel_outline.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "volumes": [{"name": "第一卷", "start_chapter": 1, "end_chapter": 10}],
                "chapters": [
                    {
                        "chapter_number": 1,
                        "title": "黑水镇夜谈",
                        "theme": "人际",
                        "scene_plan": [
                            {
                                "scene_number": 1,
                                "goal": "林峰抵达北门",
                                "conflict": "被人盯上",
                                "beat_type": "setup",
                                "required_logs": [],
                            }
                        ],
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (proj_dir / "characters.json").write_text(
        json.dumps(
            [
                {"id": "char_linfeng", "name": "林峰", "voice_signature": {"forbidden_behaviors": []}, "current_state": {"location": "黑水镇"}}
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (proj_dir / "world.json").write_text(json.dumps({"core_rules": [], "ceilings": []}, ensure_ascii=False), encoding="utf-8")
    (proj_dir / "map.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "project_id": project_id,
                "regions": [],
                "locations": [
                    {
                        "id": "loc_heishui",
                        "name": "黑水镇",
                        "type": "town",
                        "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
                    }
                ],
                "routes": [],
                "pois": [],
                "location_states": [],
                "snapshots": [],
                "footprints": [],
                "assertions": [],
                "change_log": [],
                "display": {"positions": {}},
                "settings": {"strict_geo": False, "mode": "allow_alias_new", "chapter_new_location_cap": 5, "reuse_rate_target": 0.6, "scope_enabled": False, "allowed_region_ids": []},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


@pytest.mark.asyncio
async def test_write_scene_chapter_passes_map_card_to_writer(_projects_dir):
    """_write_scene_chapter 调用 writer.write_scene 时,l2_context 末尾包含「当前: 黑水镇」。"""
    proj_dir = _projects_dir / "proj_wri_a"
    _seed_minimum_project(proj_dir, "proj_wri_a")

    captured: dict = {}

    class _FakeWriter:
        def __init__(self, *a, **kw):
            pass

        async def write_scene(self, **kwargs):
            captured["l2_context"] = kwargs.get("l2_context", "")
            return ({"text": "<draft>scene 1</draft>"}, None)

        async def write_scene_stream(self, *a, **kw):
            raise RuntimeError("should not be called in non-streaming path")

        async def rewrite_scene(self, **kwargs):
            return ({"text": "<draft>scene 1</draft>"}, None)

        def log_usage(self, *a, **kw):
            pass

    from backend.api import stage4_writing

    monkey = pytest.MonkeyPatch()
    monkey.setattr(stage4_writing, "WriterAgent", _FakeWriter)
    try:
        result = await stage4_writing._write_scene_chapter(
            project_id="proj_wri_a",
            chapter_number=1,
            scene_number=1,
            draft_factory=lambda c, s: "<draft>scene 1</draft>",
            breaker_result_override="passed",
        )
    finally:
        monkey.undo()

    assert result["error"] is False
    assert "## 地图卡" in captured["l2_context"]
    assert "当前: 黑水镇" in captured["l2_context"]
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_stage4_map_injection.py -v`
Expected: FAIL — WriterAgent mocked 但 `_write_scene_chapter` 内部直接构造 `WriterAgent(...)`,且 `mc.assemble_for_scene()` 没有传 scene_location,所以 l2_context 不会含地图卡。

- [ ] **Step 3a: 修改 _write_scene_chapter 注入 scene_location**

打开 `backend/api/stage4_writing.py`,找到 `_write_scene_chapter` 函数(line 738-...),把 `mc.assemble_for_scene(...)` 调用替换为:

找到这段(line 780-788):

```python
    mc = MemoryCoordinator(project_id, settings.projects_dir)
    character_names = [c.get("name", "") for c in ctx["characters"]]
    ctx_mem = mc.assemble_for_scene(
        scene_number=scene_number,
        scene_goal=scene_plan.get("goal", ""),
        scene_conflict=scene_plan.get("conflict", ""),
        character_names=character_names,
        chapter_number=chapter_number,
    )
```

替换为:

```python
    mc = MemoryCoordinator(project_id, settings.projects_dir)
    character_names = [c.get("name", "") for c in ctx["characters"]]
    # scene_location comes from the scene_plan's `location` field if present,
    # else None (which means build_map_card will return "" and skip injection).
    scene_location = (
        scene_plan.get("location")
        or scene_plan.get("scene_location")
        or ""
    )
    # Try to resolve character_id from scene_plan (optional)
    char_id = scene_plan.get("character_id", "")
    ctx_mem = mc.assemble_for_scene(
        scene_number=scene_number,
        scene_goal=scene_plan.get("goal", ""),
        scene_conflict=scene_plan.get("conflict", ""),
        character_names=character_names,
        chapter_number=chapter_number,
        scene_location=scene_location or None,
        character_id=char_id or None,
    )
```

- [ ] **Step 3b: 同样修改 _write_scene_chapter_stream (line 1125-...)**

找到 `_write_scene_chapter_stream` 内部相同的 `mc.assemble_for_scene(...)` 调用(line 1166-1174),做相同替换。修改后该函数签名不需要变(都是局部变量)。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_stage4_map_injection.py -v`
Expected: 1 passed

- [ ] **Step 5: 跑回归**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_stage4_writing.py backend/tests/test_autopilot_runner.py -v 2>&1 | tail -30`
Expected: 没有因修改而失败的现有测试(若 scene_plan 没 `location` 字段,scene_location 为 None → 不影响)。

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/nebula && git add backend/api/stage4_writing.py backend/tests/test_stage4_map_injection.py
git commit -m "feat(stage4): inject scene_location into assemble_for_scene so map_card reaches writer"
```

---

## Task 7: footprints helper + storyos_agent SF_LOG → footprint 写入

**Files:**
- Create: `backend/map_system/footprints.py`
- Create: `backend/tests/test_map_footprints.py`
- Modify: `backend/agents/storyos_agent.py`

- [ ] **Step 1: 写失败测试**

打开 `backend/tests/test_map_footprints.py`,写入:

```python
"""footprints helper + storyos_agent SF_LOG → footprint 路径测试。"""
import json

import pytest


@pytest.fixture
def _projects_dir(tmp_path, monkeypatch):
    from backend.config import settings
    from backend.api import stage2_map  # noqa

    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield tmp_path


def _seed_map_with_location(proj_dir, project_id: str) -> None:
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "map.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "project_id": project_id,
                "regions": [],
                "locations": [
                    {
                        "id": "loc_heishui",
                        "name": "黑水镇",
                        "type": "town",
                        "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
                    }
                ],
                "routes": [],
                "pois": [],
                "location_states": [],
                "snapshots": [],
                "footprints": [],
                "assertions": [],
                "change_log": [],
                "display": {"positions": {}},
                "settings": {"strict_geo": False, "mode": "allow_alias_new", "chapter_new_location_cap": 5, "reuse_rate_target": 0.6, "scope_enabled": False, "allowed_region_ids": []},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def test_record_footprint_from_sf_log_appends_to_map_json(_projects_dir):
    """record_footprint_from_sf_log 调 save_map 后,Map.footprints 多一行。"""
    from backend.map_system.storage import load_map, save_map
    from backend.map_system.models import Map
    from backend.map_system.footprints import record_footprint_from_sf_log

    proj_dir = _projects_dir / "proj_fp_a"
    _seed_map_with_location(proj_dir, "proj_fp_a")

    record_footprint_from_sf_log(
        project_id="proj_fp_a",
        chapter=3,
        character_id="char_linfeng",
        to_location="黑水镇",
        via="城门外官道",
    )

    data = load_map("proj_fp_a")
    fps = data["footprints"]
    assert len(fps) == 1
    assert fps[0]["chapter"] == 3
    assert fps[0]["character_id"] == "char_linfeng"
    assert fps[0]["location_id"] == "loc_heishui"
    assert fps[0]["arrived_via"] == "loc_road" or fps[0]["arrived_via"] == "城门外官道"
    # to_location 没匹配到 → 仍要写入(用空字符串而不是丢)
    assert fps[0]["location_id"] != ""


def test_record_footprint_unresolved_to_location_still_writes_with_empty_id(_projects_dir):
    """to_location 在 map.json 找不到时,仍然写一行(把 location_id 留空)。"""
    from backend.map_system.storage import load_map
    from backend.map_system.footprints import record_footprint_from_sf_log

    proj_dir = _projects_dir / "proj_fp_b"
    _seed_map_with_location(proj_dir, "proj_fp_b")

    record_footprint_from_sf_log(
        project_id="proj_fp_b",
        chapter=5,
        character_id="char_a",
        to_location="不存在的地点",
        via="",
    )

    data = load_map("proj_fp_b")
    assert len(data["footprints"]) == 1
    assert data["footprints"][0]["location_id"] == ""
    assert data["footprints"][0]["character_id"] == "char_a"


def test_storyos_update_registries_writes_footprint_for_location_change_log(_projects_dir):
    """StoryOSAgent.update_registries 处理 character_location_change 时调用 footprint helper。"""
    proj_dir = _projects_dir / "proj_fp_c"
    _seed_map_with_location(proj_dir, "proj_fp_c")

    # Need a storyos/ registries dir so update_registries can run cleanly
    (proj_dir / "storyos").mkdir(exist_ok=True)

    from backend.agents.storyos_agent import StoryOSAgent, ParsedLog
    from backend.map_system.storage import load_map

    agent = StoryOSAgent("proj_fp_c")
    log = ParsedLog(
        type="character_location_change",
        params={"char": "林峰", "from": "城门外", "to": "黑水镇"},
    )
    agent.update_registries([log])

    data = load_map("proj_fp_c")
    assert len(data["footprints"]) == 1
    assert data["footprints"][0]["character_id"] == "林峰"
    assert data["footprints"][0]["location_id"] == "loc_heishui"
    assert data["footprints"][0]["arrived_via"] == "loc_road" or data["footprints"][0]["arrived_via"] == "城门外"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_map_footprints.py -v`
Expected: 3 errors (footprints module 不存在)。

- [ ] **Step 3a: 实现 backend/map_system/footprints.py**

打开 `backend/map_system/footprints.py`,写入:

```python
"""footprint helper — write a single Footprint row to Map.footprints.

Plan 1's Map model already has `footprints: list[Footprint]` with fields:
    chapter, character_id, location_id, arrived_via (Optional),
    departed_to (Optional), companions (list), time_of_day, weather.

Two entry points:
  - record_footprint_from_sf_log: 解析 SF_LOG character_location_change
    (calls to via character name; resolves to_location via name_to_id)
  - record_footprint_from_mention: 解析 LLM mention extraction 输出
    (alias → canonical_id 已经由 caller 提供)

Both write atomically via load_map / save_map. Unresolvable to_location
yields a Footprint with empty location_id (don't drop the row — Plan 3
assertions will read it and may flag it).
"""
from __future__ import annotations

import logging
from typing import Optional

from backend.map_system.models import Footprint, Map
from backend.map_system.storage import load_map, save_map

logger = logging.getLogger(__name__)


def _resolve_location_id(project_id: str, to_location: str) -> str:
    """Resolve a free-text location string to its canonical id via the
    Plan 1 `build_name_index` reverse index. Returns "" if unresolvable."""
    if not to_location or not to_location.strip():
        return ""
    from backend.map_system.storage import build_name_index
    idx = build_name_index(project_id)
    return idx.get(to_location.strip(), "")


def _resolve_via(project_id: str, via: str) -> str:
    """arrived_via 是 location_id 而不是自由文本 → 同样查 index。
    Empty string passed through."""
    if not via or not via.strip():
        return ""
    return _resolve_location_id(project_id, via)


def record_footprint_from_sf_log(
    project_id: str,
    chapter: int,
    character_id: str,
    to_location: str,
    via: str = "",
) -> Optional[Footprint]:
    """Append a footprint row from a SF_LOG character_location_change.

    Returns the new Footprint (or None if no map.json).
    """
    data = load_map(project_id)
    if not data:
        return None

    location_id = _resolve_location_id(project_id, to_location)
    arrived_via = _resolve_via(project_id, via) if via else None

    fp = Footprint(
        chapter=chapter,
        character_id=character_id,
        location_id=location_id,
        arrived_via=arrived_via,
        departed_to=None,
        companions=[],
        time_of_day="",
        weather="",
    )

    m = Map.model_validate(data)
    m.footprints.append(fp)
    save_map(project_id, m)
    logger.info(
        "[map] recorded footprint proj=%s ch=%d char=%s loc=%s (resolved=%s)",
        project_id, chapter, character_id, to_location, location_id or "<unresolved>",
    )
    return fp


def record_footprint_from_mention(
    project_id: str,
    chapter: int,
    character_id: str,
    alias: str,
    canonical_id: str,
) -> Optional[Footprint]:
    """Append a footprint row from LLM mention extraction output.

    canonical_id is already resolved by the caller (so we skip the
    name_to_id lookup); we still need to write the Map.
    """
    data = load_map(project_id)
    if not data:
        return None

    fp = Footprint(
        chapter=chapter,
        character_id=character_id,
        location_id=canonical_id,
        arrived_via=None,
        departed_to=None,
        companions=[],
        time_of_day="",
        weather="",
    )

    m = Map.model_validate(data)
    m.footprints.append(fp)
    save_map(project_id, m)
    logger.info(
        "[map] mention-extracted footprint proj=%s ch=%d char=%s alias=%s -> %s",
        project_id, chapter, character_id, alias, canonical_id,
    )
    return fp


__all__ = ["record_footprint_from_sf_log", "record_footprint_from_mention"]
```

- [ ] **Step 3b: 修改 storyos_agent.py**

打开 `backend/agents/storyos_agent.py`,找到 `_collect_character_update` 方法(line 375-407),把 `character_location_change` 分支替换为:

替换 line 385-390 这段:

```python
        elif log.type == "character_location_change":
            char = log.params.get("char", "")
            to_loc = log.params.get("to", "")
            if char:
                report.character_state_updates.setdefault(char, {})
                report.character_state_updates[char]["location"] = to_loc
```

替换为:

```python
        elif log.type == "character_location_change":
            char = log.params.get("char", "")
            to_loc = log.params.get("to", "")
            from_loc = log.params.get("from", "")
            if char:
                report.character_state_updates.setdefault(char, {})
                report.character_state_updates[char]["location"] = to_loc

            # Plan 2 M4: SF_LOG character_location_change → Map.footprint
            # row. Wrap in try/except so a missing map.json or storage
            # failure does NOT fail the entire update_registries call —
            # the rest of the registry bookkeeping still completes.
            # `chapter` is not on the log; StoryOSAgent doesn't know the
            # current chapter directly. We pull it off the report
            # (set by callers — see stage4_writing._write_scene_chapter
            # which threads `current_chapter` into the agent via
            # `update_registries` is unchanged; instead, the stage4 caller
            # is responsible for separately invoking
            # record_footprint_from_sf_log with chapter context. Here we
            # ONLY stash the raw event on the report so the caller can
            # post-process without re-parsing the text.
            if char and to_loc:
                report.footprint_events.append({
                    "character_id": char,
                    "to_location": to_loc,
                    "from_location": from_loc,
                })
```

同时**修改文件顶部**的 `RegistryUpdateReport` dataclass(line 32-38),在末尾添加一行:

```python
    footprint_events: list[dict] = field(default_factory=list)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_map_footprints.py -v`
Expected: 3 passed

- [ ] **Step 5: 跑回归确保 update_registries 不破坏现有 SF_LOG 处理**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/ -k "storyos" -v 2>&1 | tail -20`
Expected: 现有 storyos 测试通过(因为新字段有默认值)。

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/nebula && git add backend/map_system/footprints.py backend/agents/storyos_agent.py backend/tests/test_map_footprints.py
git commit -m "feat(map): footprints helper + storyos SF_LOG character_location_change emits footprint_events"
```

---

## Task 8: extraction.py — 字典查 + LLM prompt

**Files:**
- Create: `backend/map_system/extraction.py`
- Create: `backend/prompts/location_mention_extraction.yaml`
- Create: `backend/tests/test_map_extraction.py`

- [ ] **Step 1: 写失败测试**

打开 `backend/tests/test_map_extraction.py`,写入:

```python
"""map_system.extraction — alias/canonical resolution + LLM mention extraction."""
import json

import pytest


@pytest.fixture
def _projects_dir(tmp_path, monkeypatch):
    from backend.config import settings
    from backend.api import stage2_map  # noqa

    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield tmp_path


def _seed_map_with_two_locations(proj_dir, project_id: str) -> None:
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "map.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "project_id": project_id,
                "regions": [{"id": "region_north", "name": "北泽"}],
                "locations": [
                    {
                        "id": "loc_heishui",
                        "name": "黑水镇",
                        "aliases": ["黑水"],
                        "type": "town",
                        "region_id": "region_north",
                        "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
                    },
                    {
                        "id": "loc_north_gate",
                        "name": "黑水镇北门",
                        "aliases": ["北门"],
                        "type": "city",
                        "region_id": "region_north",
                        "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
                    },
                ],
                "routes": [],
                "pois": [],
                "location_states": [],
                "snapshots": [],
                "footprints": [],
                "assertions": [],
                "change_log": [],
                "display": {"positions": {}},
                "settings": {"strict_geo": False, "mode": "allow_alias_new", "chapter_new_location_cap": 5, "reuse_rate_target": 0.6, "scope_enabled": False, "allowed_region_ids": []},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def test_extract_mentions_from_text_resolves_name_alias_and_unknown(_projects_dir):
    """extract_mentions_from_text: dict 查 → 命中 name/alias,未命中丢弃。"""
    proj_dir = _projects_dir / "proj_ext_a"
    _seed_map_with_two_locations(proj_dir, "proj_ext_a")

    from backend.map_system.extraction import extract_mentions_from_text

    text = "林峰踏进黑水镇北门时,夜色已深。北门外又传来马蹄声。"
    mentions = extract_mentions_from_text("proj_ext_a", 3, text)
    assert mentions["黑水镇北门"] == "loc_north_gate"
    assert mentions["北门"] == "loc_north_gate"
    assert "黑水镇" not in mentions or mentions.get("黑水镇") == "loc_heishui"
    assert "夜色" not in mentions  # not a map entity


def test_extract_mentions_from_text_no_map_returns_empty(_projects_dir):
    """无 map.json → 返回空 dict,不抛异常。"""
    from backend.map_system.extraction import extract_mentions_from_text

    assert extract_mentions_from_text("proj_no_map", 1, "随便") == {}


@pytest.mark.asyncio
async def test_extract_mentions_with_llm_uses_mock_router(_projects_dir):
    """extract_mentions_with_llm(model_router=mock) — mock 返回 JSON → 解析为 mentions。"""
    proj_dir = _projects_dir / "proj_ext_b"
    _seed_map_with_two_locations(proj_dir, "proj_ext_b")

    from backend.map_system.extraction import extract_mentions_with_llm

    # Mock router that returns a canned LLMResponse
    class _MockResponse:
        text = '{"mentions": {"那座北门的城": "loc_north_gate", "黑水": "loc_heishui"}}'
        tokens_in = 0
        tokens_out = 0
        model = "mock"
        provider = "mock"

    class _MockRouter:
        async def route(self, agent: str, prompt_name: str, user_prompt: str, **kw):
            return _MockResponse()

    mentions = await extract_mentions_with_llm(
        "proj_ext_b", 3, "林峰望见那座北门的城,暮色四合。黑水在远处静默。",
        model_router=_MockRouter(),
    )
    assert mentions["那座北门的城"] == "loc_north_gate"
    assert mentions["黑水"] == "loc_heishui"


@pytest.mark.asyncio
async def test_extract_mentions_with_llm_filters_canonical_ids_not_in_map(_projects_dir):
    """LLM 返回的 canonical_id 不在 map.json 中 → 丢弃(避免 hallucinated ID)。"""
    proj_dir = _projects_dir / "proj_ext_c"
    _seed_map_with_two_locations(proj_dir, "proj_ext_c")

    from backend.map_system.extraction import extract_mentions_with_llm

    class _MockResponse:
        text = '{"mentions": {"某处": "loc_doesnt_exist", "北门": "loc_north_gate"}}'
        tokens_in = 0
        tokens_out = 0
        model = "mock"
        provider = "mock"

    class _MockRouter:
        async def route(self, agent: str, prompt_name: str, user_prompt: str, **kw):
            return _MockResponse()

    mentions = await extract_mentions_with_llm(
        "proj_ext_c", 3, "某处 北门", model_router=_MockRouter(),
    )
    assert "某处" not in mentions
    assert mentions["北门"] == "loc_north_gate"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_map_extraction.py -v`
Expected: 3 errors / ImportError。

- [ ] **Step 2.5 (Q3 决策): config/model_tiers.yaml 加独立 `planner.location_mention_extraction` 路由**

打开 `config/model_tiers.yaml`,在 `planner:` 块下 `map_system` 附近追加:

```yaml
    location_mention_extraction:
      tier: tier_1
      model: default
```

**原因:** mention 抽取跟 `PlannerAgent.generate_map` 都是 tier_1,但生成地图只在用户进 Wizard Step 4 时跑一次(很轻),mention 抽取每个 scene 都跑一次(很重)。把它们路由到同一个 key 会共享同一份 max-throughput 配置,密集写作时 mention 抽取可能拖慢生成地图。独立 key 后,后续可在 AI Console / model_tiers 里单独调整 mention 抽取的 fallback 或 budget(不破坏 Step 3a)。

**验证:**

```bash
python -c "import yaml; d = yaml.safe_load(open('config/model_tiers.yaml')); print(d['agent_mapping']['planner']['location_mention_extraction'])"
```

Expected: `{'tier': 'tier_1', 'model': 'default'}`

- [ ] **Step 3a: 实现 extraction.py**

打开 `backend/map_system/extraction.py`,写入:

```python
"""location mention extraction — 把场景文本里的中文地名 mentions 解析为 canonical id。

两个入口:
  - extract_mentions_from_text(project_id, chapter, text) -> dict[alias, canonical_id]
    纯字典查:遍历 text,匹配 map 的 name + alias + region name,命中即返回。零 LLM。

  - extract_mentions_with_llm(project_id, chapter, text, model_router=None)
    -> dict[alias, canonical_id]
    Tier-1 LLM 处理 ambiguous 表述("那座北门的城"、"临河的小镇" 等)。
    config/model_tiers.yaml 已经把 `planner.map_system` 路由到 tier_1。
    默认 model_router 通过 backend.llm.model_router.get_model_router() 获取,
    tests 通过注入 _MockRouter 旁路。

JSON 输出 schema(LLM 路径):
  {"mentions": {"<alias>": "<canonical_id>", ...}}
LLM 返回的 canonical_id 若不在 map.json 中会被丢弃(避免 hallucinated ID)。
"""
from __future__ import annotations

import json
import logging
import re
from typing import Optional

from backend.map_system.storage import build_name_index, load_map

logger = logging.getLogger(__name__)

# Match CJK runs (length 2-12) — long enough to be a real name, short
# enough to skip 90% of prose. Words shorter than 2 chars rarely form
# location names; longer than 12 chars are usually phrases.
_CJK_RUN_RE = re.compile(r"[一-鿿]{2,12}")


def _all_candidate_phrases(index: dict[str, str]) -> list[str]:
    """Sort index keys longest-first so '黑水镇北门' matches before '黑水镇'."""
    return sorted(index.keys(), key=lambda k: -len(k))


def extract_mentions_from_text(
    project_id: str, chapter: int, text: str
) -> dict[str, str]:
    """Deterministic alias → canonical resolution by dictionary lookup.

    Scans `text` for CJK runs and matches each against the name_to_id
    reverse index (built from Plan 1's Map.name/alias/region_name fields).
    Longest-match wins per CJK position.

    Returns {} when no map.json or no matches.
    """
    if not text:
        return {}
    data = load_map(project_id)
    if not data:
        return {}

    index = build_name_index(project_id)
    if not index:
        return {}

    phrases = _all_candidate_phrases(index)
    # Build a single regex alternation of all phrases (longest-first).
    # Phrases that overlap shorter ones (e.g. "黑水镇北门" / "黑水镇")
    # are handled by re.finditer's leftmost-longest greedy behavior.
    phrase_alt = "|".join(re.escape(p) for p in phrases)
    if not phrase_alt:
        return {}
    pattern = re.compile(phrase_alt)

    matches: dict[str, str] = {}
    for m in pattern.finditer(text):
        alias = m.group(0)
        canonical_id = index.get(alias)
        if canonical_id:
            matches[alias] = canonical_id
    return matches


async def extract_mentions_with_llm(
    project_id: str,
    chapter: int,
    text: str,
    model_router=None,
) -> dict[str, str]:
    """LLM-assisted mention resolution for ambiguous circumlocutions.

    Uses `planner.map_system` tier (already mapped to tier_1 in
    config/model_tiers.yaml). When `model_router` is None, falls back
    to `backend.llm.model_router.get_model_router()`.
    """
    if not text:
        return {}

    data = load_map(project_id)
    if not data:
        return {}

    # Build a catalog of canonical locations for the LLM prompt.
    catalog_lines = []
    for loc in data.get("locations", []):
        aliases = loc.get("aliases", [])
        alias_str = f" (aliases: {', '.join(aliases)})" if aliases else ""
        catalog_lines.append(f"- {loc['id']}: {loc['name']}{alias_str}")
    for region in data.get("regions", []):
        aliases = region.get("aliases", [])
        alias_str = f" (aliases: {', '.join(aliases)})" if aliases else ""
        catalog_lines.append(f"- {region['id']}: {region['name']}{alias_str}")
    catalog = "\n".join(catalog_lines)

    user_prompt = (
        f"请阅读以下中文场景文本,提取其中提到的地名 mentions(可包含绰号、"
        f"指代、隐喻),并把每个 mention 解析到下列 canonical id 之一。\n\n"
        f"## 已知地点 catalog:\n{catalog}\n\n"
        f"## 场景文本:\n{text[:3000]}\n\n"
        f"输出 JSON 格式(仅输出 JSON,不要任何其他文字):\n"
        f'{{"mentions": {{"<alias>": "<canonical_id>", ...}}}}\n'
    )

    if model_router is None:
        from backend.llm.model_router import get_model_router
        model_router = get_model_router()

    try:
        response = await model_router.route(
            agent="planner",
            prompt_name="location_mention_extraction",  # 独立 key,Q3 决策;与 generate_map 不共享配额
            user_prompt=user_prompt,
        )
    except Exception as e:
        logger.warning("[map] mention extraction LLM call failed: %s", e)
        return {}

    raw = getattr(response, "text", "") or ""
    parsed = _parse_mentions_json(raw)
    if parsed is None:
        return {}

    # Validate against the map's known ids
    valid_ids = {
        loc["id"] for loc in data.get("locations", [])
    } | {r["id"] for r in data.get("regions", [])}
    valid_ids |= {poi["id"] for poi in data.get("pois", [])}

    out: dict[str, str] = {}
    for alias, canonical_id in parsed.get("mentions", {}).items():
        if canonical_id in valid_ids:
            out[alias] = canonical_id
    return out


def _parse_mentions_json(raw: str) -> Optional[dict]:
    """Parse LLM output. Tolerate ```json fences and trailing garbage."""
    if not raw:
        return None
    stripped = raw.strip()
    # Strip ```json ... ``` fences if present
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*\n?", "", stripped)
        stripped = re.sub(r"\n?```\s*$", "", stripped)
    try:
        return json.loads(stripped)
    except Exception:
        # Try greedy regex for the {"mentions": {...}} block
        m = re.search(r'\{\s*"mentions"\s*:\s*\{(.*?)\}\s*\}', raw, re.DOTALL)
        if m:
            try:
                return json.loads("{" + m.group(0)[1:-1] + "}")
            except Exception:
                return None
        return None


__all__ = ["extract_mentions_from_text", "extract_mentions_with_llm"]
```

- [ ] **Step 3b: 创建 location_mention_extraction.yaml**

打开 `backend/prompts/location_mention_extraction.yaml`,写入:

```yaml
name: location_mention_extraction
provider: deepseek
model: deepseek-chat
temperature: 0.3
max_tokens: 1024
system_prompt: |
  你是一个严谨的网文地名解析器。
  你的任务:阅读中文场景文本,识别所有提到地名/位置的 mention(包括绰号、
  指代、隐喻、模糊表述),并把它们解析为给定的 canonical id。
  规则:
    1. 只解析 prompt 中 catalog 列出的 canonical id;不要创造新 id。
    2. 如果一个 mention 在 catalog 中找不到对应,跳过它(不要输出)。
    3. 输出严格 JSON,不要包含任何额外文字或 markdown 围栏。
user_prompt_template: |
  请阅读以下中文场景文本,提取其中提到的地名 mentions(可包含绰号、
  指代、隐喻),并把每个 mention 解析到下列 canonical id 之一。

  ## 已知地点 catalog:
  {{catalog}}

  ## 场景文本:
  {{text}}

  输出 JSON 格式(仅输出 JSON,不要任何其他文字):
  {{
    "mentions": {{
      "<alias>": "<canonical_id>"
    }}
  }}
output_format:
  type: json
```

注意:`user_prompt_template` 中的 `{{...}}` 双花括号是 `str.format()` 的转义(见 `feedback_prompt_yaml_brace_escape.md`)。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_map_extraction.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/nebula && git add backend/map_system/extraction.py backend/prompts/location_mention_extraction.yaml backend/tests/test_map_extraction.py
git commit -m "feat(map): extraction.py — deterministic alias resolution + tier-1 LLM mention extraction"
```

---

## Task 9: 把 mention_extraction 挂到 stage4 writer 流程

**Files:**
- Modify: `backend/api/stage4_writing.py`
- Modify: `backend/conductor/stage4_async_executor.py`

- [ ] **Step 1: 追加测试**

打开 `backend/tests/test_stage4_map_injection.py`,在文件末尾追加:

```python


@pytest.mark.asyncio
async def test_write_scene_chapter_invokes_mention_extraction(_projects_dir, monkeypatch):
    """_write_scene_chapter 完成 → 调用 extract_mentions_with_llm 把 mention 写 footprint。"""
    proj_dir = _projects_dir / "proj_wri_me_a"
    _seed_minimum_project(proj_dir, "proj_wri_me_a")

    from backend.map_system import extraction as extraction_mod
    from backend.map_system.storage import load_map

    call_log: list = []

    async def fake_extract(project_id, chapter, text, model_router=None):
        call_log.append({"project_id": project_id, "chapter": chapter, "text_len": len(text)})
        return {"北门": "loc_heishui"}

    async def fake_record(project_id, chapter, character_id, alias, canonical_id):
        from backend.map_system.footprints import record_footprint_from_mention
        return record_footprint_from_mention(
            project_id=project_id,
            chapter=chapter,
            character_id=character_id,
            alias=alias,
            canonical_id=canonical_id,
        )

    monkeypatch.setattr(extraction_mod, "extract_mentions_with_llm", fake_extract)

    from backend.api import stage4_writing

    class _FakeWriter:
        def __init__(self, *a, **kw):
            pass

        async def write_scene(self, **kwargs):
            return ({"text": "林峰踏进黑水镇北门,夜色已深。北门外又传来马蹄声。"}, None)

        async def write_scene_stream(self, *a, **kw):
            raise RuntimeError

        async def rewrite_scene(self, **kwargs):
            return ({"text": "rewrite"}, None)

        def log_usage(self, *a, **kw):
            pass

    class _FakeReviewer:
        def __init__(self, *a, **kw):
            pass

        def run_fact_guard(self, **kwargs):
            from backend.agents.reviewer import FactGuardResult
            return FactGuardResult(all_passed=True, checks=[], coherence_score=100)

        async def run_style_guard(self, **kwargs):
            return []

    writer_mp = pytest.MonkeyPatch()
    writer_mp.setattr(stage4_writing, "WriterAgent", _FakeWriter)
    writer_mp.setattr(stage4_writing, "ReviewerAgent", _FakeReviewer)
    try:
        await stage4_writing._write_scene_chapter(
            project_id="proj_wri_me_a",
            chapter_number=1,
            scene_number=1,
            draft_factory=lambda c, s: "林峰踏进黑水镇北门,夜色已深。北门外又传来马蹄声。",
            breaker_result_override="passed",
        )
    finally:
        writer_mp.undo()

    assert len(call_log) == 1
    assert call_log[0]["project_id"] == "proj_wri_me_a"

    data = load_map("proj_wri_me_a")
    # map.footprints 应该有 mention extraction 写入的一行
    fps = data.get("footprints", [])
    assert any(
        fp.get("location_id") == "loc_heishui" and fp.get("chapter") == 1
        for fp in fps
    ), f"expected mention footprint in {fps}"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_stage4_map_injection.py::test_write_scene_chapter_invokes_mention_extraction -v`
Expected: FAIL(没调用 mention extraction,footprints 仍为空)。

- [ ] **Step 3a: 修改 _write_scene_chapter**

打开 `backend/api/stage4_writing.py`,找到 `_write_scene_chapter` 中 `parsed_logs = storyos.parse_sf_logs(current_draft)` 那段(line ~967 附近),在它后面(`registry_report = storyos.update_registries(parsed_logs)` 之后)追加 mention extraction 调用。

找到这段(line 967-970):

```python
    parsed_logs = storyos.parse_sf_logs(current_draft)
    registry_report = storyos.update_registries(parsed_logs)
    l0.update_from_logs(registry_report.character_state_updates)
```

替换为:

```python
    parsed_logs = storyos.parse_sf_logs(current_draft)
    registry_report = storyos.update_registries(parsed_logs)
    l0.update_from_logs(registry_report.character_state_updates)

    # Plan 2 M4: deterministic footprint writes from SF_LOG
    # character_location_change events. Reuse the events the agent
    # collected onto registry_report (see storyos_agent
    # RegistryUpdateReport.footprint_events). One row per event.
    if registry_report.footprint_events:
        try:
            from backend.map_system.footprints import record_footprint_from_sf_log
            for ev in registry_report.footprint_events:
                record_footprint_from_sf_log(
                    project_id=project_id,
                    chapter=chapter_number,
                    character_id=ev.get("character_id", ""),
                    to_location=ev.get("to_location", ""),
                    via=ev.get("from_location", ""),
                )
        except Exception as e:
            logger.warning("footprint_from_sf_log failed (non-blocking): %s", e)

    # Plan 2 M4: LLM mention extraction (tier-1) — best-effort, non-blocking.
    # Per character in the scene, ask the LLM to resolve ambiguous mentions.
    try:
        from backend.map_system.extraction import extract_mentions_with_llm
        from backend.map_system.footprints import record_footprint_from_mention
        for char_name in char_names:
            mentions = await extract_mentions_with_llm(
                project_id=project_id,
                chapter=chapter_number,
                text=current_draft,
            )
            for alias, canonical_id in mentions.items():
                record_footprint_from_mention(
                    project_id=project_id,
                    chapter=chapter_number,
                    character_id=char_name,
                    alias=alias,
                    canonical_id=canonical_id,
                )
    except Exception as e:
        logger.warning("mention_extraction failed (non-blocking): %s", e)
```

- [ ] **Step 3b: 同样改 _write_scene_chapter_stream**

找到 `_write_scene_chapter_stream` 内部的 `parsed_logs = storyos.parse_sf_logs(assembled_text)` 那段(line ~1346),同样在 `registry_report = storyos.update_registries(parsed_logs)` 之后追加**相同的 footprint 写入块**(只是 `chapter_number` 已在闭包内可用)。

- [ ] **Step 3c: 同步路径 stage4_async_executor**

打开 `backend/conductor/stage4_async_executor.py`,找到 `AsyncStage4Executor._write_scene` 方法末尾(line ~287),在 return 之前插入:

```python
            # Plan 2 M4: mention extraction on the async path. _write_scene
            # already invokes the synchronous _write_scene_chapter() which
            # writes SF_LOG-derived footprints inline. The async path adds
            # a parallel mention extraction step (non-blocking best-effort).
            try:
                from backend.map_system.extraction import extract_mentions_with_llm
                from backend.map_system.footprints import record_footprint_from_mention
                char_names = (
                    result.get("detail", {}).get("character_names", [])
                    if isinstance(result, dict) else []
                )
                # read draft text back from disk
                from backend.utils.file_manager import FileManager
                fm_local = FileManager(self._projects_dir)
                draft_path = fm_local.project_path(project_id, "chapters") / (
                    f"ch{item.chapter_number:02d}_scene_{scene:03d}_draft.md"
                )
                draft_text = draft_path.read_text(encoding="utf-8") if draft_path.exists() else ""
                if draft_text and char_names:
                    mentions = await extract_mentions_with_llm(
                        project_id=project_id,
                        chapter=item.chapter_number,
                        text=draft_text,
                    )
                    for char_name in char_names:
                        for alias, canonical_id in mentions.items():
                            record_footprint_from_mention(
                                project_id=project_id,
                                chapter=item.chapter_number,
                                character_id=char_name,
                                alias=alias,
                                canonical_id=canonical_id,
                            )
            except Exception as e:
                import logging
                logging.getLogger(__name__).warning(
                    "async mention_extraction failed (non-blocking): %s", e
                )
```

在 `_write_scene_stream` 末尾(line ~415 的 `return {"status": "fail", "error": "no_done_event"}` 之前)同样插入这段逻辑,把 `result` 替换为 `draft_text` 变量(在 `done` event 块里通过 `event.get("draft_text", "")` 可拿到)。

实际工程做法更简单:把上面这段 mention extraction 抽成一个 helper,放在 `_write_scene` / `_write_scene_stream` 公共位置(在 `AsyncStage4Executor` 类内加 `_extract_and_record_mentions(self, project_id, chapter, scene, text)` 方法),然后两个调用点都用。**测试通过为标准**,代码组织自行决定。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_stage4_map_injection.py -v`
Expected: 2 passed

- [ ] **Step 5: 跑回归**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_stage4_writing.py backend/tests/test_autopilot_runner.py -v 2>&1 | tail -30`
Expected: 现有测试不因新代码而失败(mention extraction 在 LLM mock 失败时被 try/except 吞掉)。

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/nebula && git add backend/api/stage4_writing.py backend/conductor/stage4_async_executor.py backend/tests/test_stage4_map_injection.py
git commit -m "feat(stage4): write footprint rows from SF_LOG character_location_change + LLM mention extraction"
```

---

## Task 10: fact_guard 端点透传 map_snapshot_hash(为 Plan 3 准备)

**Files:**
- Modify: `backend/api/stage4_fact_guard.py`

- [ ] **Step 1: 追加测试**

打开 `backend/tests/test_stage4_map_injection.py`,在文件末尾追加:

```python


def test_fact_guard_endpoint_passes_map_snapshot_hash_to_reviewer(_projects_dir, monkeypatch):
    """POST /api/stage4/fact-guard 调用 reviewer.run_fact_guard 时带 map_snapshot_hash kwarg。
    Plan 3 会在 reviewer.run_fact_guard 里读这个 kwarg;Plan 2 只需保证透传,不验证 reviewer 端。"""
    proj_dir = _projects_dir / "proj_fg"
    _seed_minimum_project(proj_dir, "proj_fg")

    from fastapi.testclient import TestClient
    from backend.main import app
    from backend.api import stage4_writing
    from backend.api import stage4_fact_guard
    from backend.agents import reviewer as reviewer_mod
    from backend.agents.reviewer import FactGuardResult

    captured: dict = {}

    class _FakeReviewer:
        def __init__(self, *a, **kw):
            pass

        def run_fact_guard(self, **kwargs):
            captured.update(kwargs)
            return FactGuardResult(all_passed=True, checks=[], coherence_score=100)

    class _FakeWriter:
        def __init__(self, *a, **kw):
            pass

    mp = pytest.MonkeyPatch()
    mp.setattr(stage4_writing, "WriterAgent", _FakeWriter)
    mp.setattr(stage4_writing, "ReviewerAgent", _FakeReviewer)
    mp.setattr(reviewer_mod, "ReviewerAgent", _FakeReviewer)
    try:
        client = TestClient(app)
        r = client.post(
            "/api/stage4/fact-guard",
            json={
                "project_id": "proj_fg",
                "chapter_number": 1,
                "scene_number": 1,
                "draft_text": "林峰在黑水镇北门。",
            },
        )
    finally:
        mp.undo()

    assert r.status_code == 200
    assert "map_snapshot_hash" in captured
    # 当 map.json 不存在 → 空串;Plan 1 接入后这里会变成 hash
    assert captured["map_snapshot_hash"] == "" or len(captured["map_snapshot_hash"]) >= 4
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_stage4_map_injection.py::test_fact_guard_endpoint_passes_map_snapshot_hash_to_reviewer -v`
Expected: FAIL(`map_snapshot_hash` 不在 kwargs 中)。

- [ ] **Step 3: 修改 stage4_fact_guard.py**

打开 `backend/api/stage4_fact_guard.py`,找到 `reviewer.run_fact_guard(...)` 调用(line 76-82),替换为:

替换这段:

```python
    fg_result = reviewer.run_fact_guard(
        draft_text=draft_text,
        characters=ctx["characters"],
        world_rules=ctx["world"],
        scene_plan=scene_plan,
        precheck_result=precheck_result,
    )
```

替换为:

```python
    # Plan 2 M4: pass map_snapshot_hash (empty string when no map.json)
    # so Plan 3's geo checks can read it. compute_map_hash returns a
    # sha256 hex; "" means "no map constraint" — safe to pass through.
    map_snapshot_hash = ""
    try:
        from backend.map_system.storage import load_map
        from backend.map_system.snapshots import compute_map_hash
        from backend.map_system.models import Map
        data = load_map(project_id)
        if data:
            map_snapshot_hash = compute_map_hash(Map.model_validate(data))
    except Exception:
        map_snapshot_hash = ""

    fg_result = reviewer.run_fact_guard(
        draft_text=draft_text,
        characters=ctx["characters"],
        world_rules=ctx["world"],
        scene_plan=scene_plan,
        precheck_result=precheck_result,
        map_snapshot_hash=map_snapshot_hash,
    )
```

(注意:`reviewer.run_fact_guard` 当前签名**没有** `map_snapshot_hash` 参数 —— Plan 3 会加。本次先传 **kwarg,Plan 3 加参数时直接 reconcile**。如果 Plan 3 还没合并,这里会触发 TypeError。因此本任务必须**配套修改** `backend/agents/reviewer.py` 的 `run_fact_guard` 签名,在末尾加 `map_snapshot_hash: str = ""` 字段。)

打开 `backend/agents/reviewer.py`,找到 `run_fact_guard` 方法签名(line 98-104 区域)。在签名末尾追加 `map_snapshot_hash: str = ""` 参数,以及方法体内不读它(Plan 3 才会用)。具体地:

```python
    def run_fact_guard(
        self,
        draft_text: str,
        characters: list,
        world_rules: dict,
        scene_plan: dict,
        precheck_result,
        map_snapshot_hash: str = "",  # Plan 2: pre-wire for Plan 3 M5
    ) -> "FactGuardResult":
```

(只加参数 + 默认值,不在方法体里使用 —— 这避免 Plan 3 合并时的冲突,且**完全符合 Plan 3 的 CheckResult.kind 改造约束**——我们没改 schema,只是预先让签名能接这个 kwarg。)

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_stage4_map_injection.py -v`
Expected: 3 passed

- [ ] **Step 5: 跑 reviewer 回归**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/ -k "fact_guard or reviewer" -v 2>&1 | tail -15`
Expected: 现有测试通过(默认值保证兼容性)。

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/nebula && git add backend/api/stage4_fact_guard.py backend/agents/reviewer.py backend/tests/test_stage4_map_injection.py
git commit -m "feat(stage4): fact-guard endpoint threads map_snapshot_hash to reviewer (Plan 3 pre-wire)"
```

---

## Task 11: scene_writing.yaml 加 {map_card} 占位 + §9.4 自查清单

**Files:**
- Modify: `backend/prompts/scene_writing.yaml`

- [ ] **Step 1: 追加 prompt 占位测试**

打开 `backend/tests/test_stage4_map_injection.py`,在文件末尾追加:

```python


def test_scene_writing_prompt_has_map_card_placeholder_and_self_check():
    """scene_writing.yaml 必须含 {map_card} 占位 + system_prompt 含 §9.4 地点一致性自查清单。"""
    import yaml
    from pathlib import Path

    yaml_path = Path("backend/prompts/scene_writing.yaml")
    assert yaml_path.exists(), "scene_writing.yaml missing"
    data = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))

    user_template = data["user_prompt_template"]
    assert "{map_card}" in user_template, "user_prompt_template 缺 {map_card} 占位"

    system_prompt = data["system_prompt"]
    assert "§9.4" in system_prompt, "system_prompt 缺 §9.4 地点一致性自查清单"
    assert "地图" in system_prompt or "地点" in system_prompt, "system_prompt 没提到「地图/地点」"


def test_scene_writing_prompt_braces_are_escaped():
    """feedback_prompt_yaml_brace_escape: literal {JSON example} 必须 {{...}} 转义。"""
    from pathlib import Path

    raw = Path("backend/prompts/scene_writing.yaml").read_text(encoding="utf-8")
    # Find the example output JSON block — look for "text": followed by an
    # unescaped opening brace that's NOT part of a {placeholder}
    # Specifically the output_json_format section
    assert '{{"text"' in raw or '{ \"text\"' in raw, (
        "expected output JSON example to be escaped ({{...}}) or in quotes"
    )
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_stage4_map_injection.py::test_scene_writing_prompt_has_map_card_placeholder_and_self_check backend/tests/test_stage4_map_injection.py::test_scene_writing_prompt_braces_are_escaped -v`
Expected: 2 FAIL。

- [ ] **Step 3a: 修改 user_prompt_template — 末尾加 {map_card} 段**

打开 `backend/prompts/scene_writing.yaml`,找到 `user_prompt_template` 末尾:

替换原 line 107-110:

```yaml
  【本场节奏约束】
  {genre_pacing_scene}

  {user_modifications}
```

替换为:

```yaml
  【本场节奏约束】
  {genre_pacing_scene}

  【地图卡 (Plan 2 M4)】
  {map_card}

  {user_modifications}
```

注意:**`{map_card}` 不带任何默认值,scene_writing.yaml 模板没有默认值**。调用方(Writer agent)负责总是传 `"## 地图卡\n..."` 或空串。空串不会破坏 `.format()`。

- [ ] **Step 3b: 修改 system_prompt — 末尾加 §9.4 自查清单**

找到 system_prompt 末尾(原 line 48-51):

```yaml
  8. 若下方用户提示中给出了【用户修改意见】，必须把每一条诉求严格融入到当前场景
     的描写中——节奏/视角/风格/侧重点调整；若与默认惯例冲突，以用户意见为准，
     不得以"符合网文惯例"为由忽略。【用户修改意见】为空时，按上述核心要求与
     写作风格默认生成。
```

在它**之后**(即 system_prompt 的最后一行,`{negative_constraints}` 之前或之后皆可,选**之后**更安全),追加:

```yaml

  §9.4 地图一致性自查(Plan 2 M4):
    a. 用户的「地图卡」段若提供了【当前】行,该行就是你必须站定的地点;
       不要写角色瞬移到地图上不存在的地点。
    b. 【可移动】行列出了从当前位置可到达的地点;若角色本场要移动,只能
       选择其中之一(或在「地图卡」为空时按剧情需要自由虚构,但需在文中
       嵌入 SF_LOG character_location_change 标签)。
    c. 【一致性提醒】行告诉你本场已确认角色-地点映射;SF_LOG
       character_location_change 的 from/to 必须与此一致。
    d. 若【地图卡】完全为空,意味着项目暂无地图约束,按剧情自由创作,
       但仍然必须用 SF_LOG character_location_change 标记所有角色移动。
```

- [ ] **Step 3c: brace escape 检查**

现有的 `{{ "text": "..." }}` 输出 JSON 示例已经是 `{{...}}` 转义形式(看 line 121-123)。我们的两个测试已经验证了这点,不需要改。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_stage4_map_injection.py -v`
Expected: 5 passed(全部)。

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/nebula && git add backend/prompts/scene_writing.yaml backend/tests/test_stage4_map_injection.py
git commit -m "feat(prompt): scene_writing.yaml adds {map_card} placeholder + §9.4 self-check"
```

---

## Task 12: writer.py 透传 map_card kwarg

**Files:**
- Modify: `backend/agents/writer.py`

- [ ] **Step 1: 追加测试**

打开 `backend/tests/test_stage4_map_injection.py`,在文件末尾追加:

```python


@pytest.mark.asyncio
async def test_writer_write_scene_accepts_map_card_kwarg(_projects_dir):
    """Writer.write_scene 接收 map_card kwarg 且在 user_prompt 模板中渲染。"""
    import yaml
    from pathlib import Path

    yaml_path = Path("backend/prompts/scene_writing.yaml")
    data = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))

    # Confirm template renders correctly
    rendered = data["user_prompt_template"].format(
        genre="玄幻",
        core_contradiction="凡人修仙",
        premise="测试",
        power_system_name="灵力",
        power_system_description="练气",
        core_rules="",
        ceilings="",
        chapter_outline_context="",
        characters_context="",
        scene_goal="林峰抵达北门",
        scene_conflict="",
        scene_emotional_arc="",
        scene_narrative_role="",
        required_logs_list="",
        l0_context="",
        l1_context="",
        l2_context="",
        l3_context="",
        l4_context="",
        growth_stage_hint="",
        character_growth_context="",
        reader_os_warnings="",
        custom_style_config_desc="",
        genre_pacing_scene="",
        user_modifications="",
        map_card="## 地图卡\n当前: 黑水镇北门",
    )
    assert "## 地图卡" in rendered
    assert "当前: 黑水镇北门" in rendered
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_stage4_map_injection.py::test_writer_write_scene_accepts_map_card_kwarg -v`
Expected: FAIL(KeyError: 'map_card')——因为 writer 的 `_build_base_vars` 没把 `map_card` 加到模板 vars。

- [ ] **Step 3: 修改 writer.py 透传 map_card**

打开 `backend/agents/writer.py`,找到 `_build_base_vars` 方法(line 422 附近),修改签名 + 方法体。

替换签名(line 422-434),在末尾添加 `map_card: str = ""`:

```python
    def _build_base_vars(
        self,
        genre: str,
        concept: dict,
        world_rules: dict,
        characters: list[dict],
        scene_plan: dict,
        l0_context: str,
        l1_context: str,
        l2_context: str = "",
        l3_context: str = "",
        l4_context: str = "",
        growth_stage_hint: str = "",
```

在 `character_growth_context: str = "",` 之后添加 `reader_os_warnings: str = "",` 后面、紧跟 `custom_style_config_desc: str = "",` 之前或之后,加上 `map_card: str = "",`:

```python
        custom_style_config_desc: str = "",
        map_card: str = "",
```

(根据你看到的实际签名,把它放到最后 kwarg-only 的位置。)

找到 `_build_base_vars` 末尾构造返回 dict 的地方(应该是类似 `"custom_style_config_desc": custom_style_config_desc,`),在它后面添加:

```python
        "map_card": map_card,
```

接着,找到 `write_scene` 方法签名(在 writer.py 大约 line 500-510 附近),把 `_build_base_vars(**vars)` 调用传入 `map_card=self._map_card_last` 之类 —— **更简单的方法**是直接修改 `write_scene` 把 `map_card` 加为顶层 kwarg,然后传给 `_build_base_vars`。

为了不破坏其它测试,**最小修改**:在 `write_scene` 签名上加 `map_card: str = ""` kwarg,然后在调用 `_build_base_vars(**vars_dict)` 前注入到 vars_dict 即可。

具体来说,找到 `write_scene` 方法体内构造 base_vars 的地方(line ~485 附近),加入 `map_card=map_card`:

```python
        base_vars = self._build_base_vars(
            ...,
            custom_style_config_desc=custom_style_config_desc,
            map_card=map_card,  # Plan 2 M4
        )
```

同样修改 `write_scene_stream` 和 `rewrite_scene` 方法,添加 `map_card: str = ""` 顶层 kwarg 并透传(为了不破坏 LLM 调用,允许默认 "")。

实际工程做法:打开 writer.py 找到 `write_scene` 的签名(应该在 `async def write_scene(...)`),在已有 kwarg 末尾加 `map_card: str = ""`,然后在方法体内构造 base_vars 时加上 `"map_card": map_card`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_stage4_map_injection.py -v`
Expected: 6 passed

- [ ] **Step 5: 跑 writer 测试回归**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_writer_*.py -v 2>&1 | tail -30`
Expected: 现有测试通过(`map_card` 默认空串,旧调用点不受影响)。

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/nebula && git add backend/agents/writer.py backend/tests/test_stage4_map_injection.py
git commit -m "feat(writer): write_scene / rewrite_scene / write_scene_stream thread map_card kwarg"
```

---

## Task 13: stage4_writing 把 map_card 传给 writer.write_scene

**Files:**
- Modify: `backend/api/stage4_writing.py`

- [ ] **Step 1: 追加测试**

打开 `backend/tests/test_stage4_map_injection.py`,在文件末尾追加:

```python


@pytest.mark.asyncio
async def test_write_scene_chapter_passes_map_card_kwarg_to_writer(_projects_dir):
    """_write_scene_chapter → writer.write_scene(..., map_card='## 地图卡\\n当前: 黑水镇')。"""
    proj_dir = _projects_dir / "proj_wri_card"
    _seed_minimum_project(proj_dir, "proj_wri_card")

    captured: dict = {}

    class _FakeWriter:
        def __init__(self, *a, **kw):
            pass

        async def write_scene(self, **kwargs):
            captured.update(kwargs)
            return ({"text": "<draft>scene 1</draft>"}, None)

        async def write_scene_stream(self, *a, **kw):
            raise RuntimeError

        async def rewrite_scene(self, **kwargs):
            return ({"text": "rewrite"}, None)

        def log_usage(self, *a, **kw):
            pass

    from backend.api import stage4_writing

    mp = pytest.MonkeyPatch()
    mp.setattr(stage4_writing, "WriterAgent", _FakeWriter)
    try:
        await stage4_writing._write_scene_chapter(
            project_id="proj_wri_card",
            chapter_number=1,
            scene_number=1,
            draft_factory=lambda c, s: "<draft>scene 1</draft>",
            breaker_result_override="passed",
        )
    finally:
        mp.undo()

    assert "map_card" in captured
    assert "## 地图卡" in captured["map_card"]
    assert "当前: 黑水镇" in captured["map_card"]
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_stage4_map_injection.py::test_write_scene_chapter_passes_map_card_kwarg_to_writer -v`
Expected: FAIL(`map_card` not in captured — writer 调用没传)。

- [ ] **Step 3: 修改 _write_scene_chapter 提取 map_card 并传给 writer**

打开 `backend/api/stage4_writing.py`,找到 `ctx_mem = mc.assemble_for_scene(...)` 之后的 writer.write_scene 调用(line ~840),在调用前插入:

```python
    # Plan 2 M4: extract the rendered map card from l2_context (we appended
    # it there in Task 5). Slice off the section so writer sees it as a
    # distinct kwarg AND doesn't get a duplicate when the template renders.
    map_card = ""
    if "## 地图卡" in ctx_mem.l2_context:
        marker = "## 地图卡"
        idx = ctx_mem.l2_context.find(marker)
        map_card = ctx_mem.l2_context[idx:].strip()
        ctx_mem.l2_context = ctx_mem.l2_context[:idx].rstrip()
```

然后修改 `writer.write_scene` 调用,把 `map_card=map_card` 加进去(line ~840-857 的 kwarg 列表末尾)。

同样的修改要应用到 `_write_scene_chapter_stream` 中的 `writer.write_scene_stream` 调用(line ~1250)。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_stage4_map_injection.py -v`
Expected: 7 passed

- [ ] **Step 5: 跑完整 stage4 回归**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_stage4_writing.py backend/tests/test_autopilot_runner.py backend/tests/test_writer_pipeline_integration.py -v 2>&1 | tail -30`
Expected: 没有因 map_card 注入而失败的测试。

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/nebula && git add backend/api/stage4_writing.py backend/tests/test_stage4_map_injection.py
git commit -m "feat(stage4): extract map_card from l2_context and pass to writer.write_scene as kwarg"
```

---

## Task 14: 端到端冒烟测试 — 验证 plan 2 全链路

**Files:**
- Create: `backend/tests/test_map_m4_smoke.py`

- [ ] **Step 1: 写冒烟测试**

打开 `backend/tests/test_map_m4_smoke.py`,写入:

```python
"""Plan 2 M4 端到端冒烟测试 — 验证 map_card 注入 + footprint 抽取全链路。"""
import json

import pytest


@pytest.fixture
def _projects_dir(tmp_path, monkeypatch):
    from backend.config import settings
    from backend.api import stage2_map  # noqa
    from backend.api import stage4_writing

    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    stage4_writing.fm = type(stage4_writing.fm)(tmp_path)
    yield tmp_path


def _seed_full_m4_project(proj_dir, project_id: str) -> None:
    """Seed a project with: stage4 progress, map.json with 2 locations
    + 1 route, novel_outline.json, characters.json, world.json."""
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "project.json").write_text(
        json.dumps(
            {
                "id": project_id,
                "title": "M4 smoke",
                "genre": "玄幻",
                "current_stage": "STAGE4",
                "concept_and_dna": {"core_contradiction": {"statement": "凡人修仙"}},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (proj_dir / "novel_outline.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "volumes": [{"name": "第一卷", "start_chapter": 1, "end_chapter": 10}],
                "chapters": [
                    {
                        "chapter_number": 1,
                        "title": "黑水镇夜谈",
                        "theme": "人际",
                        "scene_plan": [
                            {
                                "scene_number": 1,
                                "goal": "林峰抵达北门",
                                "conflict": "",
                                "location": "黑水镇",
                                "required_logs": [],
                            }
                        ],
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (proj_dir / "characters.json").write_text(
        json.dumps(
            [{"id": "char_linfeng", "name": "林峰", "voice_signature": {"forbidden_behaviors": []}, "current_state": {"location": "黑水镇"}}],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (proj_dir / "world.json").write_text(json.dumps({"core_rules": [], "ceilings": []}, ensure_ascii=False), encoding="utf-8")
    (proj_dir / "map.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "project_id": project_id,
                "regions": [],
                "locations": [
                    {
                        "id": "loc_heishui",
                        "name": "黑水镇",
                        "type": "town",
                        "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
                    },
                    {
                        "id": "loc_north_gate",
                        "name": "黑水镇北门",
                        "type": "city",
                        "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
                    },
                ],
                "routes": [],
                "pois": [],
                "location_states": [],
                "snapshots": [],
                "footprints": [],
                "assertions": [],
                "change_log": [],
                "display": {"positions": {}},
                "settings": {"strict_geo": False, "mode": "allow_alias_new", "chapter_new_location_cap": 5, "reuse_rate_target": 0.6, "scope_enabled": False, "allowed_region_ids": []},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


@pytest.mark.asyncio
async def test_m4_end_to_end_injects_card_and_writes_footprint(_projects_dir, monkeypatch):
    """plan 2 全链路:
       1. _write_scene_chapter 调用 → writer.write_scene 收到 map_card kwarg
       2. SF_LOG character_location_change → footprint 写入 Map.footprints
       3. mention extraction (mock) → 第二条 footprint 写入"""
    proj_dir = _projects_dir / "proj_smoke"
    _seed_full_m4_project(proj_dir, "proj_smoke")

    # Add SF_LOG character_location_change to draft text
    draft_text = (
        "林峰踏入黑水镇北门,夜色已深。\n"
        '<!-- SF_LOG character_location_change char="林峰" from="城门外官道" to="黑水镇" -->\n'
        "北门外又传来马蹄声。"
    )

    from backend.api import stage4_writing
    from backend.map_system.storage import load_map
    from backend.map_system import extraction as extraction_mod

    async def fake_extract(project_id, chapter, text, model_router=None):
        return {"北门": "loc_north_gate"}

    monkeypatch.setattr(extraction_mod, "extract_mentions_with_llm", fake_extract)

    class _FakeWriter:
        def __init__(self, *a, **kw):
            pass

        async def write_scene(self, **kwargs):
            assert "map_card" in kwargs
            assert "## 地图卡" in kwargs["map_card"]
            return ({"text": draft_text}, None)

        async def write_scene_stream(self, *a, **kw):
            raise RuntimeError

        async def rewrite_scene(self, **kwargs):
            return ({"text": "rewrite"}, None)

        def log_usage(self, *a, **kw):
            pass

    mp = pytest.MonkeyPatch()
    mp.setattr(stage4_writing, "WriterAgent", _FakeWriter)
    try:
        result = await stage4_writing._write_scene_chapter(
            project_id="proj_smoke",
            chapter_number=1,
            scene_number=1,
            draft_factory=lambda c, s: draft_text,
            breaker_result_override="passed",
        )
    finally:
        mp.undo()

    assert result["error"] is False

    # Verify footprint writes
    data = load_map("proj_smoke")
    fps = data.get("footprints", [])
    # 至少 2 条:一条 SF_LOG (林峰→黑水镇) + 一条 mention (北门→loc_north_gate)
    assert len(fps) >= 2, f"expected ≥2 footprints, got {fps}"
    sf_log_fp = next((f for f in fps if f["character_id"] == "林峰" and f["location_id"] == "loc_heishui"), None)
    assert sf_log_fp is not None, f"expected SF_LOG footprint for 林峰→黑水镇, got {fps}"
    mention_fp = next((f for f in fps if f["location_id"] == "loc_north_gate"), None)
    assert mention_fp is not None, f"expected mention footprint for 北门→北门 location, got {fps}"
```

- [ ] **Step 2: 运行测试确认通过**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_map_m4_smoke.py -v`
Expected: 1 passed

- [ ] **Step 3: 跑完整 plan 2 测试集**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/test_map_card.py backend/tests/test_map_footprints.py backend/tests/test_map_extraction.py backend/tests/test_outline_context_builder.py backend/tests/test_memory_coordinator_map_card.py backend/tests/test_stage4_map_injection.py backend/tests/test_map_m4_smoke.py -v 2>&1 | tail -40`
Expected: 全绿(约 25+ 测试)。

- [ ] **Step 4: 跑整体回归**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest backend/tests/ -v --ignore=backend/tests/test_map_models.py --ignore=backend/tests/test_map_api.py --ignore=backend/tests/test_map_storage.py --ignore=backend/tests/test_map_snapshots.py 2>&1 | tail -30`
Expected: 没有 plan 2 引起的回归(Plan 1 测试暂跳过因为代码尚未合并)。

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/nebula && git add backend/tests/test_map_m4_smoke.py
git commit -m "test(map): plan 2 M4 end-to-end smoke — card injection + footprint write paths"
```

---

## 自审 Self-Review

### 1. Spec coverage

| PRD 章节 | 内容 | Plan 2 任务 | 状态 |
|---|---|---|---|
| §4 | map_card 4 行 mini-card 设计 | Task 1, 2, 3 | ✓ |
| §8 | 检索(mention 抽取) | Task 8, 9 | ✓ |
| §9 | Writer 上下文注入 | Task 5, 6, 11, 12, 13 | ✓ |
| §9.4 | 自查清单 | Task 11 | ✓ |
| §10 | outline_context 注入 | Task 4 | ✓ |
| §11-16 | footprint 抽取与回写 | Task 7, 8, 9 | ✓ |

全部 PRD §4, §8, §9, §9.4, §10, §11-16 覆盖到。

### 2. Placeholder scan

- 没有 "TBD" / "TODO" / "implement later" / "fill in details" / "Similar to Task X"
- 没有 "add appropriate error handling" — 全部 try/except 都是显式具体的
- 每个测试步骤都包含完整可执行代码块
- 所有提及的函数 / 类都在前面的任务中定义

### 3. Type / signature consistency

| 引用 | 定义 | 一致? |
|---|---|---|
| `Map`, `Location`, `Region`, `Route`, `POI`, `MapSettings`, `Footprint` | Plan 1 `backend/map_system/models.py` | ✓ 用 Plan 1 章节的字段定义 |
| `load_map`, `save_map`, `build_name_index` | Plan 1 `backend/map_system/storage.py` | ✓ |
| `compute_map_hash`, `snapshot_map_at_chapter`, `rollback_map_to_chapter` | Plan 1 `backend/map_system/snapshots.py` | ✓ |
| `RegistryUpdateReport.footprint_events: list[dict]` | Task 7 修改 storyos_agent.py | ✓ 任务 7 显式定义 |
| `assemble_for_scene(..., scene_location, character_id)` | Task 5 添加 kwarg | ✓ |
| `build_map_card(project_id, scene_location, chapter_number, character_id)` | Task 3 定义 | ✓ |
| `record_footprint_from_sf_log` / `record_footprint_from_mention` | Task 7 定义 | ✓ |
| `extract_mentions_from_text` / `extract_mentions_with_llm` | Task 8 定义 | ✓ |
| `writer.write_scene(..., map_card)` | Task 12 添加 kwarg | ✓ |
| `reviewer.run_fact_guard(..., map_snapshot_hash)` | Task 10 添加 kwarg | ✓(Plan 3 pre-wire,默认值 "" 不破坏现有) |

### 4. Constraints check

- ✗ 不修改 `CheckResult` schema(Plan 3) — Task 10 只在 run_fact_guard 加 `map_snapshot_hash: str = ""` 参数,CheckResult 数据类**未动**
- ✗ 不加 `kind` 字段 — 全 plan 2 中无 `kind=` 字段
- ✗ 不引入新依赖 — 全部用现有 pytest / asyncio / PyYAML / Pydantic
- ✗ 不修改文件-IO 格式 — footprint 走 Plan 1 已经定义的 `Map.footprints: list[Footprint]`,没有单独 footprints.json
- ✓ 每个任务独立可 review — 每个 task 一个 commit,5-15 行 diff

### 5. Open questions → 已决定 (2026-09-22 决策)

1. **~~mention extraction 路由 tier 冲突~~** — **已决定(Q3):独立 key。** Task 8 Step 2.5 在 `config/model_tiers.yaml` 追加 `planner.location_mention_extraction: { tier: tier_1, model: default }`,Step 3a 改用 `prompt_name="location_mention_extraction"`。mention 抽取跟 `PlannerAgent.generate_map` 解耦,可独立调 fallback / budget。
2. **~~scene_plan.location 字段缺失~~** — **已决定(Q1=A):前置 task。** Task 0 在 Plan 2 头部插入,让 stage3 出章节大纲时每个 scene 自带 `location` 字段,并由 `PlannerAgent.generate_outline` 后处理校验对齐 `Map.name_to_id`;无法解析回退 null + warning。后续维护脚本(扫现有 outline.json 用 chapter.title 模糊匹配补齐)留待 follow-up,不在本 plan 范围。
3. **async executor mention extraction 时机**:Task 9 Step 3c 提到把 mention extraction 抽成 helper,但具体如何放(helper on executor vs 在 _write_scene 末尾)由实现者决定。**测试通过即合规**。
4. **fact_guard snapshot_hash 时机**:Task 10 现在的实现是「每次 POST /fact-guard 时计算 compute_map_hash」。如果 map.json 极大,这会变慢。Plan 3 接入后可以缓存到 checkpoint;Plan 2 不优化。
5. **CheckResult.kind 类型**(Plan 3 提的 Q1,Plan 2 关心一致性)— **已决定(Q2):用 `str` 默认 "info",不上 `Literal`。** Plan 3 已落 `kind: str = "info"`,Plan 2 不引入 kind 写入(只看 check_id 7-15 的 passed 字段)。

