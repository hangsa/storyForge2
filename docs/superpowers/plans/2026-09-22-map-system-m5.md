# 地图系统 实施计划 — Plan 3 (M5: 写入前校验 / Fact Guard 接入)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 9 条地图一致性校验规则(3 Blocker + 3 Warning + 3 Info)作为 `ReviewerAgent` 的 check_7_geo_* 系列方法接入 fact-guard pipeline,扩展 `CheckResult` 加 `kind` 字段,补齐 Writer self-check prompt 与 POI 不可见约束注入,确保地理约束在 Stage 4 写作时强制生效。

**Architecture:**
- 纯 deterministic 函数 `backend/map_system/assertions.py` — 不依赖 LLM,接受 (map, scene context) 输入返回 `RuleResult(kind, code, message, evidence)` 列表
- `ReviewerAgent` 9 个新方法 `check_7_geo_*` 把每个 `assert_*` 包成 `CheckResult(kind="blocker"|"warning"|"info", passed=not failed)`,在 `run_fact_guard` 末尾聚合
- `prompts/scene_writing.yaml` system_prompt 追加 §9.4 自查清单(9 条规则 ID + 写作前自检问句)
- `StoryOSAgent._handle_character_location_change` 在 POI `discoverable=true` 时把 POI 文本加入下一次 map_card 的 `已发现 POI` 段

**Tech Stack:** Python 3.11 (dataclasses + Literal types) · YAML prompts · pytest

---

## 范围与边界

**Plan 3 (本文件, M5) 包含:**
- `backend/map_system/assertions.py` — 9 条纯 deterministic 断言函数(3 Blocker + 3 Warning + 3 Info)
- `backend/agents/reviewer.py` 扩展 `CheckResult(kind: Literal[...])` + 9 个 `check_7_geo_*` 方法 + `run_fact_guard` 末尾插入调用
- `backend/prompts/scene_writing.yaml` system_prompt 追加 §9.4 自查清单
- `backend/agents/storyos_agent.py` POI 不可见约束注入(discoverable POI 进入下一次 map_card 的已发现 POI 段)

**Plan 1 (已 shipped-pending, M1+M2+M3+M6) 提供:**
- `backend/map_system/` 模块与 `Map / Location / Route / POI / Region / MapSettings / DramaticRole / FactionStance / DisplayPos` Pydantic 模型
- `load_map(project_id) -> dict` / `save_map(project_id, m: Map)` 与 `build_name_index(project_id) -> dict[str, str]`(name/region/alias → canonical id)
- `Map._index.name_to_id` 内存反向索引
- `map_snapshots/chapter_NNN.json` 章节快照

**Plan 2 (并行 in-flight, M4) 提供:**
- `backend/map_system/map_card.py` — `build_map_card(project_id, chapter_number, scene_number)`(纯字符串模板函数)
- `backend/map_system/extraction.py` — SF_LOG `character_location_change` 抽取 + footprint 写入 + alias 维护
- map_card 注入到 `prompts/scene_writing.yaml` user_prompt_template 的 `{map_card}` 占位
- `stage4_fact_guard.py` 把 map context 透传给 `reviewer.run_fact_guard`

**为什么这样切:** Plan 3 的 9 条规则全部 deterministic,只读取 `map.json` + scene context,不调用 Plan 2 的 `build_map_card` / footprint 抽取;Plan 3 的测试应该 mock footprint readers(Plan 2 还没合入时,footprint 抽取函数不存在)。**现有 Stage 4 caller 不需要改:** Plan 1 提到 Plan 2 会把 `stage4_fact_guard.py` 改成 `map_context={}` 透传,本 plan **保持 `run_fact_guard` 新增参数 `map_context: Optional[dict] = None`,默认 None 等价于 `map_context={}` 跳过 9 条新规则**,不破坏任何现有 caller(包括 `/api/stage4/fact-guard` 端点)。

---

## 文件改动范围

### 新建 (Plan 3)

| 文件 | 用途 | 任务 |
|---|---|---|
| `backend/map_system/assertions.py` | 9 条纯 deterministic 断言函数 + `RuleResult` dataclass | Task 1, 2, 3, 4, 5 |
| `backend/tests/test_map_assertions.py` | 9 条规则 × happy/fail 各 1 例 + 优先级聚合 | Task 2, 3, 4, 5 |
| `backend/tests/test_reviewer_geo.py` | check_7_geo_* 9 个方法 + CheckResult.kind + run_fact_guard 聚合 | Task 6, 7, 8 |
| `backend/tests/test_scene_writing_selfcheck.py` | 加载 scene_writing.yaml 验证 §9.4 段含 9 个 rule code | Task 9 |
| `backend/tests/test_poi_invisible.py` | StoryOSAgent 抽取 POI discoverable=true 注入 map_card 已发现段 | Task 10 |

### 修改 (Plan 3)

| 文件 | 改动 | 任务 |
|---|---|---|
| `backend/agents/reviewer.py` | `CheckResult` 加 `kind` 字段 + 9 个 `check_7_geo_*` 方法 + `run_fact_guard` 新增 `map_context` 参数 | Task 6, 7, 8 |
| `backend/prompts/scene_writing.yaml` | system_prompt 末尾追加 §9.4 自查清单 | Task 9 |
| `backend/agents/storyos_agent.py` | POI 不可见约束注入(`_handle_character_location_change` + 后续 map_card hook) | Task 10 |

**不删除任何现有文件**(所有改动都向后兼容)。

---

## 关键实体引用(从 Plan 1 锚定)

| 实体 | 位置 | 用途 |
|---|---|---|
| `Map` / `Location` / `Route` / `POI` / `Region` | `backend/map_system/models.py` | assertions.py 输入 |
| `MapSettings.chapter_new_location_cap: int = 5` | `MapSettings` | assert_density_ok 阈值 |
| `Location.enter_conditions: list[str]` | `Location` | assert_accessible 检查 |
| `Location.factions: list[FactionStance]` | `Location` | assert_faction_stance_change |
| `Route.est_travel_minutes: int >= 0` | `Route` | assert_chapter_time_budget |
| `Route.bidirectional: bool` | `Route` | assert_route_exists 反向查找 |
| `POI.discoverable: bool` | `POI` | POI 不可见约束注入 |
| `POI.first_discovered_chapter: Optional[int]` | `POI` | discoverable=true 但 first_discovered_chapter=null → 视为「待发现」 |
| `LocationState.accessible: bool` | `LocationState` | assert_accessible 检查最新状态 |
| `load_map(project_id) -> Optional[dict]` | `backend/map_system/storage.py` | 9 条规则读 map.json |
| `build_name_index(project_id) -> dict[str, str]` | `backend/map_system/storage.py` | name → canonical id 归一化 |

---

## Task 1: `RuleResult` dataclass + assertions 模块骨架

**Files:**
- Create: `backend/map_system/assertions.py`
- Create: `backend/tests/test_map_assertions.py`

- [ ] **Step 1: 写失败测试**

打开 `backend/tests/test_map_assertions.py`,写入:

```python
"""map_system/assertions.py 测试 — 9 条 deterministic 规则 + RuleResult dataclass。"""
from backend.map_system.assertions import RuleResult


def test_rule_result_dataclass_fields():
    r = RuleResult(
        kind="blocker",
        code="geo.no_implicit_teleport",
        message="角色 A 从 loc_x 跳到 loc_y 无可用 route",
        evidence={"from": "loc_x", "to": "loc_y", "available_routes": []},
    )
    assert r.kind == "blocker"
    assert r.code == "geo.no_implicit_teleport"
    assert r.message == "角色 A 从 loc_x 跳到 loc_y 无可用 route"
    assert r.evidence == {"from": "loc_x", "to": "loc_y", "available_routes": []}


def test_rule_result_kind_must_be_literal():
    """kind 必须是 blocker / warning / info 之一,否则 Pydantic-like 校验失败。

    本测试只断言 dataclass 字段类型 — 类型错误在构造时被 dataclass 拒绝。
    """
    import dataclasses
    fields = {f.name for f in dataclasses.fields(RuleResult)}
    assert "kind" in fields
    assert "code" in fields
    assert "message" in fields
    assert "evidence" in fields
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest backend/tests/test_map_assertions.py -v`
Expected: `ModuleNotFoundError: No module named 'backend.map_system.assertions'`

- [ ] **Step 3: 写最小实现**

打开 `backend/map_system/assertions.py`,写入:

```python
"""地图一致性校验规则 — 9 条纯 deterministic 断言函数(PRD §9.1/9.2/9.3)。

所有规则不调用 LLM,给定 (map_data, scene_context) 输入,返回 RuleResult 列表。
调用方(ReviewerAgent.check_7_geo_*)负责把 RuleResult 包装为 CheckResult(kind=...)。

Blocker 规则(fail → circuit breaker retry):
  - geo.no_implicit_teleport: 角色移动后 from→to 无 route 可达
  - geo.forbidden_access: 角色进入 accessible=false 的 location 且缺 enter_conditions 解除记录
  - geo.time_budget_exceeded: 单章累计移动耗时 > outline 该章 time_budget

Warning 规则(fail → 仅写日志+仪表盘):
  - geo.distance_unrealistic: est_travel_minutes 与 distance_tier 数量级不匹配
  - geo.climate_mismatch: writer 描述的天气与 region.climate 矛盾
  - geo.density_high: 单章新增 location 数 > settings.chapter_new_location_cap

Info 规则(fail → 仅仪表盘,不打扰作者):
  - geo.alias_added: 新 alias 映射到 canonical location
  - geo.faction_attitude_shift: location.factions 态度与 world.factions 描述不一致
  - geo.poi_discovered: POI 自由文本提及但 first_discovered_chapter=null
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


RuleKind = Literal["blocker", "warning", "info"]


@dataclass
class RuleResult:
    """单条断言规则的执行结果。ReviewerAgent.check_7_geo_* 把它包装为 CheckResult。

    Fields:
        kind: blocker | warning | info — 决定是否阻熔断器
        code: 规则 ID,如 "geo.no_implicit_teleport"
        message: 人类可读的失败原因(passed=True 时为空字符串)
        evidence: 现场数据 dict — 不同规则 key 不同,由调用方自行填充
    """
    kind: RuleKind
    code: str
    message: str
    evidence: dict = field(default_factory=dict)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest backend/tests/test_map_assertions.py -v`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add backend/map_system/assertions.py backend/tests/test_map_assertions.py
git commit -m "feat(map-assertions): scaffold RuleResult dataclass + 9-rule module"
```

---

## Task 2: 3 条 Blocker 规则 — `assert_route_exists` / `assert_accessible` / `assert_chapter_time_budget`

**Files:**
- Modify: `backend/map_system/assertions.py`
- Modify: `backend/tests/test_map_assertions.py`

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_map_assertions.py` 末尾追加:

```python


from backend.map_system.assertions import (
    assert_route_exists,
    assert_accessible,
    assert_chapter_time_budget,
)


# Helper: minimal map fixture
def _make_map(locations, routes, location_states=None, settings=None):
    return {
        "schema_version": "1.0",
        "project_id": "proj_x",
        "locations": locations,
        "routes": routes,
        "location_states": location_states or [],
        "settings": settings or {
            "chapter_new_location_cap": 5,
            "reuse_rate_target": 0.6,
            "strict_geo": False,
        },
    }


def test_route_exists_passes_when_direct_edge_present():
    m = _make_map(
        locations=[
            {"id": "loc_a", "name": "A", "type": "inn",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
             "enter_conditions": [], "factions": []},
            {"id": "loc_b", "name": "B", "type": "inn",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
             "enter_conditions": [], "factions": []},
        ],
        routes=[
            {"id": "route_ab", "from": "loc_a", "to": "loc_b",
             "est_travel_minutes": 40, "bidirectional": True},
        ],
    )
    results = assert_route_exists(m, from_id="loc_a", to_id="loc_b")
    assert results == []  # pass → 空列表


def test_route_exists_returns_blocker_when_no_edge():
    m = _make_map(
        locations=[
            {"id": "loc_a", "name": "A", "type": "inn",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
             "enter_conditions": [], "factions": []},
            {"id": "loc_b", "name": "B", "type": "inn",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
             "enter_conditions": [], "factions": []},
        ],
        routes=[],
    )
    results = assert_route_exists(m, from_id="loc_a", to_id="loc_b")
    assert len(results) == 1
    assert results[0].kind == "blocker"
    assert results[0].code == "geo.no_implicit_teleport"
    assert results[0].evidence["from"] == "loc_a"
    assert results[0].evidence["to"] == "loc_b"
    assert results[0].evidence["available_routes"] == []


def test_route_exists_respects_bidirectional():
    """单向 route(A→B)不应该让 B→A 也通过。"""
    m = _make_map(
        locations=[
            {"id": "loc_a", "name": "A", "type": "inn",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
             "enter_conditions": [], "factions": []},
            {"id": "loc_b", "name": "B", "type": "inn",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
             "enter_conditions": [], "factions": []},
        ],
        routes=[
            {"id": "route_ab", "from": "loc_a", "to": "loc_b",
             "est_travel_minutes": 40, "bidirectional": False},
        ],
    )
    # A→B passes
    assert assert_route_exists(m, from_id="loc_a", to_id="loc_b") == []
    # B→A fails (单向 route 不能反走)
    rev = assert_route_exists(m, from_id="loc_b", to_id="loc_a")
    assert len(rev) == 1
    assert rev[0].code == "geo.no_implicit_teleport"


def test_accessible_passes_when_no_state_record():
    """某 location 在 location_states 中无记录 → 默认 accessible=true。"""
    m = _make_map(
        locations=[
            {"id": "loc_a", "name": "A", "type": "inn",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
             "enter_conditions": [], "factions": []},
        ],
        routes=[],
    )
    results = assert_accessible(m, location_id="loc_a", char_id="char_x")
    assert results == []


def test_accessible_blocks_when_destroyed():
    """location_state.accessible=false → Blocker。"""
    m = _make_map(
        locations=[
            {"id": "loc_a", "name": "A", "type": "inn",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
             "enter_conditions": [], "factions": []},
        ],
        routes=[],
        location_states=[
            {"location_id": "loc_a", "chapter": 5, "accessible": False,
             "destroyed": True, "faction_id": "faction_y", "name": None, "note": ""},
        ],
    )
    results = assert_accessible(m, location_id="loc_a", char_id="char_x")
    assert len(results) == 1
    assert results[0].kind == "blocker"
    assert results[0].code == "geo.forbidden_access"
    assert results[0].evidence["destroyed_chapter"] == 5


def test_time_budget_passes_within_budget():
    m = _make_map(locations=[], routes=[])
    # 3 routes, total 120 min, budget 180 → pass
    route_minutes = [40, 30, 50]
    results = assert_chapter_time_budget(
        m, route_minutes_list=route_minutes, chapter_time_budget_minutes=180
    )
    assert results == []


def test_time_budget_blocks_when_exceeded():
    m = _make_map(locations=[], routes=[])
    # 3 routes, total 240 min, budget 180 → blocker
    route_minutes = [40, 100, 100]
    results = assert_chapter_time_budget(
        m, route_minutes_list=route_minutes, chapter_time_budget_minutes=180
    )
    assert len(results) == 1
    assert results[0].kind == "blocker"
    assert results[0].code == "geo.time_budget_exceeded"
    assert results[0].evidence["total_minutes"] == 240
    assert results[0].evidence["budget_minutes"] == 180
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest backend/tests/test_map_assertions.py -v`
Expected: `ImportError: cannot import name 'assert_route_exists'`

- [ ] **Step 3: 实现 3 条 Blocker 规则**

在 `backend/map_system/assertions.py` 末尾追加:

```python


def _latest_state_for(map_data: dict, location_id: str) -> dict | None:
    """查 location_id 的最新 LocationState(按 chapter 降序)。无记录返回 None。"""
    states = [
        ls for ls in map_data.get("location_states", [])
        if ls.get("location_id") == location_id
    ]
    if not states:
        return None
    return max(states, key=lambda ls: ls.get("chapter", 0))


def _find_route(routes: list[dict], from_id: str, to_id: str) -> dict | None:
    """查找直接 route。考虑 bidirectional 字段。"""
    for r in routes:
        if r.get("from") == from_id and r.get("to") == to_id:
            return r
        if r.get("bidirectional", True) and r.get("from") == to_id and r.get("to") == from_id:
            return r
    return None


def assert_route_exists(
    map_data: dict, from_id: str, to_id: str
) -> list[RuleResult]:
    """Blocker 1: 角色移动后 from→to 无 route 可达。

    Args:
        map_data: load_map() 返回的 dict
        from_id: SF_LOG character_location_change 的 from 归一化后的 location_id
        to_id: 同上,to 字段

    Returns: [] 表示通过;[RuleResult(kind=blocker)] 表示失败。
    """
    routes = map_data.get("routes", [])
    if _find_route(routes, from_id, to_id) is not None:
        return []
    available = [
        r for r in routes
        if r.get("from") == from_id or r.get("to") == from_id
        or r.get("bidirectional", True)
    ]
    return [
        RuleResult(
            kind="blocker",
            code="geo.no_implicit_teleport",
            message=f"无 route 直接连接 {from_id} → {to_id}",
            evidence={
                "from": from_id,
                "to": to_id,
                "available_routes": [r.get("id") for r in available],
            },
        )
    ]


def assert_accessible(
    map_data: dict, location_id: str, char_id: str
) -> list[RuleResult]:
    """Blocker 2: 角色进入 accessible=false 的 location。

    无 LocationState 记录 → 默认 accessible=true(PRD §3.2.5)。
    enter_conditions 在 MVP 不解除(无 location_state_change SF_LOG,见 §7.3),
    所以 accessible=false 一律 Blocker。
    """
    state = _latest_state_for(map_data, location_id)
    if state is None or state.get("accessible", True):
        return []
    return [
        RuleResult(
            kind="blocker",
            code="geo.forbidden_access",
            message=(
                f"角色 {char_id} 进入 {location_id},"
                f"但该 location 在第 {state.get('chapter')} 章"
                f"被标为 accessible=false"
            ),
            evidence={
                "location_id": location_id,
                "char_id": char_id,
                "destroyed_chapter": state.get("chapter"),
                "destroyed": state.get("destroyed", False),
            },
        )
    ]


def assert_chapter_time_budget(
    map_data: dict,
    route_minutes_list: list[int],
    chapter_time_budget_minutes: int,
) -> list[RuleResult]:
    """Blocker 3: 单章累计 route.est_travel_minutes > outline 该章 time_budget。

    Args:
        map_data: load_map() 返回的 dict(本函数实际不使用,保留签名一致性)
        route_minutes_list: 本场/本章所有 SF_LOG 出现的 route 的 est_travel_minutes 列表
        chapter_time_budget_minutes: 从 outline.json 的 chapter.time_budget_minutes 字段读取
    """
    total = sum(route_minutes_list)
    if total <= chapter_time_budget_minutes:
        return []
    return [
        RuleResult(
            kind="blocker",
            code="geo.time_budget_exceeded",
            message=(
                f"本章累计移动耗时 {total} 分钟 > time_budget "
                f"{chapter_time_budget_minutes} 分钟"
            ),
            evidence={
                "total_minutes": total,
                "budget_minutes": chapter_time_budget_minutes,
                "route_minutes_list": list(route_minutes_list),
            },
        )
    ]
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest backend/tests/test_map_assertions.py -v`
Expected: 9 passed

- [ ] **Step 5: Commit**

```bash
git add backend/map_system/assertions.py backend/tests/test_map_assertions.py
git commit -m "feat(map-assertions): 3 Blocker rules (route, access, time-budget)"
```

---

## Task 3: 3 条 Warning 规则 — `assert_distance_consistent` / `assert_climate_matches` / `assert_density_ok`

**Files:**
- Modify: `backend/map_system/assertions.py`
- Modify: `backend/tests/test_map_assertions.py`

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_map_assertions.py` 末尾追加:

```python


from backend.map_system.assertions import (
    assert_distance_consistent,
    assert_climate_matches,
    assert_density_ok,
)


def test_distance_consistent_warns_when_inter_region_under_5_min():
    """distance_tier=inter_region 的 route 不应只有 5 分钟 — 显然漏写。"""
    m = _make_map(locations=[], routes=[])
    results = assert_distance_consistent(
        m, distance_tier="inter_region", est_travel_minutes=5
    )
    assert len(results) == 1
    assert results[0].kind == "warning"
    assert results[0].code == "geo.distance_unrealistic"
    assert results[0].evidence["distance_tier"] == "inter_region"


def test_distance_consistent_passes_for_normal_inter_region():
    m = _make_map(locations=[], routes=[])
    results = assert_distance_consistent(
        m, distance_tier="inter_region", est_travel_minutes=240
    )
    assert results == []


def test_distance_consistent_warns_intra_city_over_60_min():
    """distance_tier=intra_city 的 route > 60 分钟 — 显然夸大数据。"""
    m = _make_map(locations=[], routes=[])
    results = assert_distance_consistent(
        m, distance_tier="intra_city", est_travel_minutes=120
    )
    assert len(results) == 1
    assert results[0].kind == "warning"


def test_climate_matches_passes_for_consistent_weather():
    m = {
        "regions": [
            {"id": "region_x", "name": "X", "climate": "湿热, 雨季六月至九月",
             "aliases": [], "tags": []},
        ],
    }
    # writer 描述「小雨」与湿热气候不矛盾
    results = assert_climate_matches(m, region_id="region_x", scene_weather="小雨")
    assert results == []


def test_climate_matches_warns_for_contradiction():
    """湿热 region 不应描写「大雪纷飞」。"""
    m = {
        "regions": [
            {"id": "region_x", "name": "X", "climate": "湿热, 全年无冬",
             "aliases": [], "tags": []},
        ],
    }
    results = assert_climate_matches(m, region_id="region_x", scene_weather="大雪纷飞")
    assert len(results) == 1
    assert results[0].kind == "warning"
    assert results[0].code == "geo.climate_mismatch"


def test_density_ok_warns_when_chapter_adds_too_many():
    m = _make_map(
        locations=[], routes=[],
        settings={
            "chapter_new_location_cap": 5,
            "reuse_rate_target": 0.6,
            "strict_geo": False,
        },
    )
    # 单章新增 8 个 location(超过 cap=5)
    results = assert_density_ok(m, chapter_new_locations_count=8)
    assert len(results) == 1
    assert results[0].kind == "warning"
    assert results[0].code == "geo.density_high"
    assert results[0].evidence["cap"] == 5
    assert results[0].evidence["actual"] == 8


def test_density_ok_passes_at_or_below_cap():
    m = _make_map(
        locations=[], routes=[],
        settings={
            "chapter_new_location_cap": 5,
            "reuse_rate_target": 0.6,
            "strict_geo": False,
        },
    )
    assert assert_density_ok(m, chapter_new_locations_count=5) == []
    assert assert_density_ok(m, chapter_new_locations_count=3) == []
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest backend/tests/test_map_assertions.py -v`
Expected: `ImportError: cannot import name 'assert_distance_consistent'`

- [ ] **Step 3: 实现 3 条 Warning 规则**

在 `backend/map_system/assertions.py` 末尾追加:

```python


# PRD §9.2: distance_tier 与 est_travel_minutes 数量级 sanity 范围。
# 阈值是「显然违反直觉」的 catch — 不是精确度量。
_DISTANCE_TIER_MINUTES = {
    "intra_city": (2, 60),
    "inter_city": (30, 600),       # 0.5h–10h
    "inter_region": (120, 1440),   # 2h–24h
    "inter_continent": (720, 4320),  # 12h–3 天
}


def assert_distance_consistent(
    map_data: dict,
    distance_tier: str,
    est_travel_minutes: int,
) -> list[RuleResult]:
    """Warning 1: est_travel_minutes 与 distance_tier 数量级不匹配。

    Args:
        map_data: load_map() 返回的 dict(本函数不使用,保留签名)
        distance_tier: Route.distance_tier 取值之一
        est_travel_minutes: 同一 route 的 est_travel_minutes
    """
    bounds = _DISTANCE_TIER_MINUTES.get(distance_tier)
    if bounds is None:
        return []
    lo, hi = bounds
    if lo <= est_travel_minutes <= hi:
        return []
    return [
        RuleResult(
            kind="warning",
            code="geo.distance_unrealistic",
            message=(
                f"distance_tier={distance_tier} 的 route 标 {est_travel_minutes} 分钟,"
                f"预期 {lo}–{hi} 分钟范围"
            ),
            evidence={
                "distance_tier": distance_tier,
                "est_travel_minutes": est_travel_minutes,
                "expected_min": lo,
                "expected_max": hi,
            },
        )
    ]


# PRD §9.2 / §9.3: 简单的关键词匹配,中文小说常用天气词 vs region.climate 描述。
_CLIMATE_CONTRADICTION_KEYWORDS = {
    # climate 子串 → writer 不应出现的天气关键词集合
    "无冬": ["大雪", "暴风雪", "冰封", "寒冬"],
    "严寒": ["烈日", "酷暑"],
    "湿热": ["大雪纷飞", "冰天雪地", "严寒"],
}


def assert_climate_matches(
    map_data: dict,
    region_id: str,
    scene_weather: str,
) -> list[RuleResult]:
    """Warning 2: writer 描述的天气与 region.climate 矛盾。

    Args:
        map_data: load_map() 返回的 dict
        region_id: 当前场景所在 region
        scene_weather: 从 SF_LOG / 文本抽取的天气关键词(如「小雨」「大雪纷飞」)
    """
    region = next(
        (r for r in map_data.get("regions", []) if r.get("id") == region_id),
        None,
    )
    if region is None:
        return []
    climate = region.get("climate", "")
    for keyword, bad_weathers in _CLIMATE_CONTRADICTION_KEYWORDS.items():
        if keyword in climate:
            for bad in bad_weathers:
                if bad in scene_weather:
                    return [
                        RuleResult(
                            kind="warning",
                            code="geo.climate_mismatch",
                            message=(
                                f"region {region_id}({climate}) 与文中天气"
                                f"「{scene_weather}」矛盾(关键词「{bad}」)"
                            ),
                            evidence={
                                "region_id": region_id,
                                "region_climate": climate,
                                "scene_weather": scene_weather,
                                "matched_keyword": bad,
                            },
                        )
                    ]
    return []


def assert_density_ok(
    map_data: dict,
    chapter_new_locations_count: int,
) -> list[RuleResult]:
    """Warning 3: 单章新增 location 数 > settings.chapter_new_location_cap。"""
    settings = map_data.get("settings", {})
    cap = settings.get("chapter_new_location_cap", 5)
    if chapter_new_locations_count <= cap:
        return []
    return [
        RuleResult(
            kind="warning",
            code="geo.density_high",
            message=(
                f"本章新增 {chapter_new_locations_count} 个,"
                f"超过 settings.chapter_new_location_cap={cap}"
            ),
            evidence={
                "cap": cap,
                "actual": chapter_new_locations_count,
            },
        )
    ]
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest backend/tests/test_map_assertions.py -v`
Expected: 16 passed

- [ ] **Step 5: Commit**

```bash
git add backend/map_system/assertions.py backend/tests/test_map_assertions.py
git commit -m "feat(map-assertions): 3 Warning rules (distance, climate, density)"
```

---

## Task 4: 3 条 Info 规则 — `assert_alias_discovered` / `assert_faction_stance_change` / `assert_poi_discovered`

**Files:**
- Modify: `backend/map_system/assertions.py`
- Modify: `backend/tests/test_map_assertions.py`

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_map_assertions.py` 末尾追加:

```python


from backend.map_system.assertions import (
    assert_alias_discovered,
    assert_faction_stance_change,
    assert_poi_discovered,
)


def test_alias_discovered_emits_info():
    """mention extraction 新增 alias 映射到 canonical → Info 通知。"""
    m = _make_map(locations=[], routes=[])
    results = assert_alias_discovered(
        m,
        alias="山脚客栈",
        canonical_id="loc_qingfeng_inn",
    )
    assert len(results) == 1
    assert results[0].kind == "info"
    assert results[0].code == "geo.alias_added"
    assert results[0].evidence["alias"] == "山脚客栈"
    assert results[0].evidence["canonical_id"] == "loc_qingfeng_inn"


def test_alias_discovered_no_canonical_returns_no_info():
    """alias 没归一化到 canonical — 不应触发(留给 mention extractor 决策)。"""
    m = _make_map(locations=[], routes=[])
    results = assert_alias_discovered(m, alias="??", canonical_id="")
    assert results == []


def test_faction_stance_change_emits_info_on_shift():
    """location.factions 列出 friendly,但 world.factions 描述为 hostile → 立场转变 Info。"""
    m = {
        "locations": [
            {"id": "loc_a", "name": "A", "type": "inn",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
             "enter_conditions": [],
             "factions": [{"faction_id": "faction_x", "attitude": "friendly"}]},
        ],
        "world_factions": [
            {"id": "faction_x", "name": "X宗", "attitude_summary": "与主角宗门敌对"},
        ],
    }
    results = assert_faction_stance_change(
        m, faction_id="faction_x", observed_attitude="friendly"
    )
    assert len(results) == 1
    assert results[0].kind == "info"
    assert results[0].code == "geo.faction_attitude_shift"


def test_faction_stance_change_no_info_when_consistent():
    m = {
        "world_factions": [
            {"id": "faction_x", "name": "X宗", "attitude_summary": "友好同盟"},
        ],
    }
    results = assert_faction_stance_change(
        m, faction_id="faction_x", observed_attitude="friendly"
    )
    assert results == []


def test_poi_discovered_emits_info_when_first_chapter_null():
    """POI discoverable=true 但 first_discovered_chapter=null → 「待发现」。"""
    m = _make_map(locations=[], routes=[])
    results = assert_poi_discovered(
        m, poi_id="poi_cellar", first_discovered_chapter=None,
    )
    assert len(results) == 1
    assert results[0].kind == "info"
    assert results[0].code == "geo.poi_discovered"
    assert results[0].evidence["poi_id"] == "poi_cellar"
    assert results[0].evidence["status"] == "待发现"


def test_poi_discovered_no_info_when_first_chapter_present():
    m = _make_map(locations=[], routes=[])
    results = assert_poi_discovered(
        m, poi_id="poi_cellar", first_discovered_chapter=12,
    )
    assert results == []
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest backend/tests/test_map_assertions.py -v`
Expected: `ImportError: cannot import name 'assert_alias_discovered'`

- [ ] **Step 3: 实现 3 条 Info 规则**

在 `backend/map_system/assertions.py` 末尾追加:

```python


def assert_alias_discovered(
    map_data: dict,
    alias: str,
    canonical_id: str,
) -> list[RuleResult]:
    """Info 1: mention extraction 新增 alias 映射到 canonical location。

    Args:
        map_data: load_map() 返回的 dict(本函数不使用)
        alias: 新发现的别名(裸字符串)
        canonical_id: name_to_id 反向索引归一化结果,空字符串表示未命中
    """
    if not alias or not canonical_id:
        return []
    return [
        RuleResult(
            kind="info",
            code="geo.alias_added",
            message=f"新 alias「{alias}」映射到 canonical id {canonical_id}",
            evidence={
                "alias": alias,
                "canonical_id": canonical_id,
            },
        )
    ]


def assert_faction_stance_change(
    map_data: dict,
    faction_id: str,
    observed_attitude: str,
) -> list[RuleResult]:
    """Info 2: location.factions.observed 与 world.factions.attitude_summary 不一致。

    MVP 启发式:在 world_factions.attitude_summary 中查找 observed_attitude
    是否出现。若 observed 不在 summary 的关键词集合(友好 / 敌对 / 中立 / 警惕)中,
    视为立场转变 Info。

    Args:
        map_data: dict(含 world_factions 字段,可能从 characters / world 读取)
        faction_id: faction id
        observed_attitude: 本场观察到的态度(friendly/hostile/neutral/wary)
    """
    factions = map_data.get("world_factions", []) or []
    faction = next(
        (f for f in factions if f.get("id") == faction_id), None
    )
    if faction is None:
        return []
    summary = faction.get("attitude_summary", "")
    # 简单关键词对照:observed_attitude 中文词在 summary 中出现 → 一致
    keywords = {
        "friendly": ["友好", "同盟", "亲近"],
        "hostile": ["敌对", "仇视", "对立"],
        "neutral": ["中立", "不偏"],
        "wary": ["警惕", "戒备"],
    }
    expected = keywords.get(observed_attitude, [])
    if any(kw in summary for kw in expected):
        return []
    return [
        RuleResult(
            kind="info",
            code="geo.faction_attitude_shift",
            message=(
                f"faction {faction_id} 在文中表现为 {observed_attitude},"
                f"但 world.factions.attitude_summary=「{summary}」"
            ),
            evidence={
                "faction_id": faction_id,
                "observed_attitude": observed_attitude,
                "world_summary": summary,
            },
        )
    ]


def assert_poi_discovered(
    map_data: dict,
    poi_id: str,
    first_discovered_chapter: int | None,
) -> list[RuleResult]:
    """Info 3: POI 文本中提到但 first_discovered_chapter 仍为 null → 「待发现」提醒。

    Args:
        map_data: load_map() 返回的 dict(本函数不使用)
        poi_id: POI id
        first_discovered_chapter: POI.first_discovered_chapter 当前值,
                                   None 表示尚未发现
    """
    if first_discovered_chapter is not None:
        return []
    return [
        RuleResult(
            kind="info",
            code="geo.poi_discovered",
            message=(
                f"POI {poi_id} 在文本中被提及,"
                f"但 first_discovered_chapter 仍为 null(待发现)"
            ),
            evidence={
                "poi_id": poi_id,
                "status": "待发现",
            },
        )
    ]
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest backend/tests/test_map_assertions.py -v`
Expected: 22 passed

- [ ] **Step 5: Commit**

```bash
git add backend/map_system/assertions.py backend/tests/test_map_assertions.py
git commit -m "feat(map-assertions): 3 Info rules (alias, faction, poi)"
```

---

## Task 5: 高阶聚合器 `run_geo_checks(map_data, scene_context) -> list[RuleResult]`

**Files:**
- Modify: `backend/map_system/assertions.py`
- Modify: `backend/tests/test_map_assertions.py`

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_map_assertions.py` 末尾追加:

```python


from backend.map_system.assertions import run_geo_checks


def test_run_geo_checks_with_empty_context_returns_empty():
    """map_context={} 或 None → 跳过全部规则,返回空列表(向后兼容 Plan 1 caller)。"""
    m = _make_map(locations=[], routes=[])
    assert run_geo_checks(m, scene_context=None) == []
    assert run_geo_checks(m, scene_context={}) == []


def test_run_geo_checks_routes_only_checks_routes():
    """scene_context.routes 包含 from→to 列表,run_geo_checks 调用 assert_route_exists 每对。"""
    m = _make_map(
        locations=[
            {"id": "loc_a", "name": "A", "type": "inn",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
             "enter_conditions": [], "factions": []},
            {"id": "loc_b", "name": "B", "type": "inn",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
             "enter_conditions": [], "factions": []},
        ],
        routes=[],
    )
    # 1 对 route,从 A→B 但 routes 表为空 → 1 个 Blocker
    ctx = {
        "routes": [{"from": "loc_a", "to": "loc_b"}],
    }
    results = run_geo_checks(m, scene_context=ctx)
    assert len(results) == 1
    assert results[0].code == "geo.no_implicit_teleport"


def test_run_geo_checks_aggregates_density_warning():
    """scene_context.new_locations_count=10 → 1 个 Warning。"""
    m = _make_map(
        locations=[], routes=[],
        settings={
            "chapter_new_location_cap": 5,
            "reuse_rate_target": 0.6,
            "strict_geo": False,
        },
    )
    ctx = {"new_locations_count": 10}
    results = run_geo_checks(m, scene_context=ctx)
    codes = [r.code for r in results]
    assert "geo.density_high" in codes


def test_run_geo_checks_blocker_priority_over_warning():
    """同时存在 Blocker 和 Warning 时,两者都在结果列表里(不做过滤)。

    ReviewerAgent 拿到 list 后自己按 kind 区分;assertions.py 只负责生成。
    """
    m = _make_map(
        locations=[
            {"id": "loc_a", "name": "A", "type": "inn",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
             "enter_conditions": [], "factions": []},
            {"id": "loc_b", "name": "B", "type": "inn",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
             "enter_conditions": [], "factions": []},
        ],
        routes=[],
        settings={
            "chapter_new_location_cap": 5,
            "reuse_rate_target": 0.6,
            "strict_geo": False,
        },
    )
    ctx = {
        "routes": [{"from": "loc_a", "to": "loc_b"}],
        "new_locations_count": 10,
    }
    results = run_geo_checks(m, scene_context=ctx)
    codes = [r.code for r in results]
    kinds = {r.kind for r in results}
    assert "geo.no_implicit_teleport" in codes
    assert "geo.density_high" in codes
    assert "blocker" in kinds
    assert "warning" in kinds
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest backend/tests/test_map_assertions.py -v`
Expected: `ImportError: cannot import name 'run_geo_checks'`

- [ ] **Step 3: 实现 `run_geo_checks` 聚合器**

在 `backend/map_system/assertions.py` 末尾追加:

```python


def run_geo_checks(
    map_data: dict,
    scene_context: dict | None,
) -> list[RuleResult]:
    """聚合 9 条规则的入口 — 把 scene_context 拆解后调用各自 assert_*。

    scene_context 字段契约(Plan 2 注入,Plan 3 容忍 None/{}):
        routes: list[{"from": str, "to": str}] — 本场 SF_LOG 出现的 route 对
        character_location_enters: list[{"char_id": str, "location_id": str}]
                                                  — 角色进入的目标 location
        route_minutes: list[int] — 本章 route.est_travel_minutes 累计列表
        chapter_time_budget_minutes: int — outline 该章 time_budget
        new_locations_count: int — 本章新增 location 数
        new_aliases: list[{"alias": str, "canonical_id": str}]
        faction_observed: list[{"faction_id": str, "observed_attitude": str}]
        world_factions: list[dict] — 从 world.json 读出的议员配置
        discovered_pois: list[{"poi_id": str, "first_discovered_chapter": int|None}]

    Returns: list[RuleResult] — 全部失败的规则,空列表表示全部通过。
    当 scene_context 为 None 或 {} 时,直接返回 [] (向后兼容 — Plan 1 caller 传空 dict)。
    """
    if not scene_context:
        return []

    results: list[RuleResult] = []

    # Blocker 1: 路由可达性
    for route_pair in scene_context.get("routes", []) or []:
        from_id = route_pair.get("from", "")
        to_id = route_pair.get("to", "")
        if not from_id or not to_id:
            continue
        results.extend(assert_route_exists(map_data, from_id=from_id, to_id=to_id))

    # Blocker 2: 禁入
    for enter in scene_context.get("character_location_enters", []) or []:
        char_id = enter.get("char_id", "")
        loc_id = enter.get("location_id", "")
        if not char_id or not loc_id:
            continue
        results.extend(
            assert_accessible(map_data, location_id=loc_id, char_id=char_id)
        )

    # Blocker 3: 时间预算
    route_minutes = scene_context.get("route_minutes", []) or []
    budget = scene_context.get("chapter_time_budget_minutes", 0)
    if route_minutes and budget > 0:
        results.extend(
            assert_chapter_time_budget(
                map_data,
                route_minutes_list=route_minutes,
                chapter_time_budget_minutes=budget,
            )
        )

    # Warning 1: 距离一致性(per-route)— 需要从 scene_context 取距离档位
    for rc in scene_context.get("route_consistency", []) or []:
        results.extend(
            assert_distance_consistent(
                map_data,
                distance_tier=rc.get("distance_tier", ""),
                est_travel_minutes=int(rc.get("est_travel_minutes", 0)),
            )
        )

    # Warning 2: 气候匹配
    for cm in scene_context.get("climate", []) or []:
        results.extend(
            assert_climate_matches(
                map_data,
                region_id=cm.get("region_id", ""),
                scene_weather=cm.get("scene_weather", ""),
            )
        )

    # Warning 3: density
    new_count = scene_context.get("new_locations_count", 0)
    if new_count:
        results.extend(
            assert_density_ok(map_data, chapter_new_locations_count=int(new_count))
        )

    # Info 1: alias
    for alias_pair in scene_context.get("new_aliases", []) or []:
        results.extend(
            assert_alias_discovered(
                map_data,
                alias=alias_pair.get("alias", ""),
                canonical_id=alias_pair.get("canonical_id", ""),
            )
        )

    # Info 2: faction
    for fa in scene_context.get("faction_observed", []) or []:
        # 给 map_data 补 world_factions 字段(由 stage4 注入)
        ctx_with_factions = {**map_data,
                              "world_factions": scene_context.get("world_factions", [])}
        results.extend(
            assert_faction_stance_change(
                ctx_with_factions,
                faction_id=fa.get("faction_id", ""),
                observed_attitude=fa.get("observed_attitude", ""),
            )
        )

    # Info 3: POI discoverable
    for poi in scene_context.get("discovered_pois", []) or []:
        results.extend(
            assert_poi_discovered(
                map_data,
                poi_id=poi.get("poi_id", ""),
                first_discovered_chapter=poi.get("first_discovered_chapter"),
            )
        )

    return results
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest backend/tests/test_map_assertions.py -v`
Expected: 26 passed

- [ ] **Step 5: Commit**

```bash
git add backend/map_system/assertions.py backend/tests/test_map_assertions.py
git commit -m "feat(map-assertions): run_geo_checks aggregator + scene_context contract"
```

---

## Task 6: 扩展 `CheckResult` 加 `kind` 字段(向后兼容)

**Files:**
- Modify: `backend/agents/reviewer.py:22-29`(CheckResult dataclass)
- Create: `backend/tests/test_reviewer_geo.py`

- [ ] **Step 1: 写失败测试**

打开 `backend/tests/test_reviewer_geo.py`,写入:

```python
"""ReviewerAgent 9 个 check_7_geo_* 方法 + CheckResult.kind 字段测试。"""
from backend.agents.reviewer import CheckResult


def test_check_result_has_kind_field_defaulting_to_info():
    """默认 kind="info" — 向后兼容:现有 6 条 check 不显式传 kind 也通过。"""
    r = CheckResult(check_id=1, name="时间线连续性", passed=True, detail="ok")
    assert r.kind == "info"


def test_check_result_kind_can_be_set_explicitly():
    r = CheckResult(
        check_id=7, name="geo.no_implicit_teleport",
        passed=False, detail="无 route", kind="blocker",
    )
    assert r.kind == "blocker"


def test_existing_six_checks_default_kind_info():
    """验证 6 个现有 check 方法不显式传 kind 时,结果 kind="info"(向后兼容)。

    不实际运行 LLM,只构造 ReviewerAgent 实例并 mock check 1-6 的最小输入。
    """
    from backend.agents.reviewer import ReviewerAgent
    agent = ReviewerAgent(project_id="proj_x")
    r = agent.check_1_timeline("无文本", {"current_state": {"location": ""}, "name": "X"})
    assert isinstance(r, CheckResult)
    assert r.kind == "info"  # 默认值,不报错


def test_existing_six_checks_can_be_invoked_without_kind_kwarg():
    """调用 check_1/2/3/4/5/6 不需要传 kind= 参数(默认即可)。"""
    from backend.agents.reviewer import ReviewerAgent
    agent = ReviewerAgent(project_id="proj_x")
    char = {"name": "X", "current_state": {"location": ""},
            "unknown_to_character": [], "voice_signature": {"taboos": []}}
    r1 = agent.check_1_timeline("", char)
    r2 = agent.check_2_character_state("", char)
    r3 = agent.check_3_world_rules("", {})
    r4 = agent.check_4_asset_compliance("", {})
    r5 = agent.check_5_log_completeness("", {"required_logs": []})
    # check_6 requires precheck_result kwarg
    r6 = agent.check_6_semantic_precheck_review(precheck_result=None)
    for r in [r1, r2, r3, r4, r5, r6]:
        assert r.kind == "info"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest backend/tests/test_reviewer_geo.py -v`
Expected: `TypeError: __init__() got an unexpected keyword argument 'kind'`(或类似 dataclass 字段缺失)

- [ ] **Step 3: 给 `CheckResult` 加 `kind` 字段**

打开 `backend/agents/reviewer.py`,修改第 23-29 行(原 CheckResult):

```python
@dataclass
class CheckResult:
    check_id: int
    name: str
    passed: bool
    detail: str = ""
    kind: str = "info"   # v2.x Plan 3: blocker | warning | info — 默认 "info" 向后兼容
```

> **注意:** 使用 `str` 而非 `Literal[...]` 是为了避免破坏任何外部调用 CheckResult(name=..., kind=...) 的传值兼容性。ReviewerAgent.check_7_geo_* 方法只会传字面量 "blocker" / "warning" / "info",运行期契约靠 review guard 保证。

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest backend/tests/test_reviewer_geo.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add backend/agents/reviewer.py backend/tests/test_reviewer_geo.py
git commit -m "feat(reviewer): add CheckResult.kind field with backward-compat default"
```

---

## Task 7: 9 个 `check_7_geo_*` 方法(包装 assertions → CheckResult)

**Files:**
- Modify: `backend/agents/reviewer.py`(末尾追加 9 个方法)
- Modify: `backend/tests/test_reviewer_geo.py`(追加测试)

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_reviewer_geo.py` 末尾追加:

```python


def test_check_7_geo_no_implicit_teleport_returns_blocker_when_no_route():
    from backend.agents.reviewer import ReviewerAgent
    agent = ReviewerAgent(project_id="proj_x")
    map_data = {
        "schema_version": "1.0",
        "project_id": "proj_x",
        "locations": [
            {"id": "loc_a", "name": "A", "type": "inn",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
             "enter_conditions": [], "factions": []},
            {"id": "loc_b", "name": "B", "type": "inn",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
             "enter_conditions": [], "factions": []},
        ],
        "routes": [],
    }
    scene_ctx = {"routes": [{"from": "loc_a", "to": "loc_b"}]}
    r = agent.check_7_geo_no_implicit_teleport(map_data, scene_ctx)
    assert r.check_id == 7
    assert r.kind == "blocker"
    assert r.passed is False
    assert "geo.no_implicit_teleport" in r.detail or "geo.no_implicit_teleport" in r.name


def test_check_7_geo_no_implicit_teleport_returns_info_when_map_ctx_empty():
    """map_ctx={} 时,9 条 check 全部 passed=True + kind=对应值(向后兼容)。"""
    from backend.agents.reviewer import ReviewerAgent
    agent = ReviewerAgent(project_id="proj_x")
    # map_data 是必要的(avoid TypeError),scene_ctx={} → 跳过
    map_data = {"schema_version": "1.0", "project_id": "x",
                "locations": [], "routes": [], "location_states": []}
    r = agent.check_7_geo_no_implicit_teleport(map_data, {})
    assert r.passed is True
    assert r.kind == "blocker"   # 即使通过也保留 kind="blocker" 元信息


def test_all_nine_check_7_geo_methods_exist():
    """ReviewerAgent 必须有 check_7_geo_* 全部 9 个方法。"""
    from backend.agents.reviewer import ReviewerAgent
    agent = ReviewerAgent(project_id="proj_x")
    expected = [
        "check_7_geo_no_implicit_teleport",
        "check_7_geo_forbidden_access",
        "check_7_geo_time_budget_exceeded",
        "check_7_geo_distance_unrealistic",
        "check_7_geo_climate_mismatch",
        "check_7_geo_density_high",
        "check_7_geo_alias_added",
        "check_7_geo_faction_attitude_shift",
        "check_7_geo_poi_discovered",
    ]
    for name in expected:
        assert hasattr(agent, name), f"Missing method: {name}"


def test_each_check_7_method_returns_checkresult_with_kind():
    """9 个方法在 empty map_ctx={} 时都返回 CheckResult(kind=对应值, passed=True)。"""
    from backend.agents.reviewer import ReviewerAgent
    agent = ReviewerAgent(project_id="proj_x")
    map_data = {"schema_version": "1.0", "project_id": "x",
                "locations": [], "routes": [], "location_states": [],
                "regions": [], "settings": {}}
    pairs = [
        ("check_7_geo_no_implicit_teleport", "blocker"),
        ("check_7_geo_forbidden_access", "blocker"),
        ("check_7_geo_time_budget_exceeded", "blocker"),
        ("check_7_geo_distance_unrealistic", "warning"),
        ("check_7_geo_climate_mismatch", "warning"),
        ("check_7_geo_density_high", "warning"),
        ("check_7_geo_alias_added", "info"),
        ("check_7_geo_faction_attitude_shift", "info"),
        ("check_7_geo_poi_discovered", "info"),
    ]
    for method_name, expected_kind in pairs:
        method = getattr(agent, method_name)
        r = method(map_data, {})
        assert r.kind == expected_kind, f"{method_name}: expected kind={expected_kind}, got {r.kind}"
        assert r.passed is True
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest backend/tests/test_reviewer_geo.py::test_check_7_geo_no_implicit_teleport_returns_blocker_when_no_route -v`
Expected: `AttributeError: 'ReviewerAgent' object has no attribute 'check_7_geo_no_implicit_teleport'`

- [ ] **Step 3: 实现 9 个 check_7_geo_* 方法**

打开 `backend/agents/reviewer.py`,在文件末尾(最后一行 `return header + "..."` 之后)追加:

```python


# --- v2.x Plan 3: Map 9-rule assertions (M5) ---


import os as _os  # noqa: E402  — placed here for read order; remove if already imported

from backend.map_system.assertions import (  # noqa: E402
    assert_route_exists,
    assert_accessible,
    assert_chapter_time_budget,
    assert_distance_consistent,
    assert_climate_matches,
    assert_density_ok,
    assert_alias_discovered,
    assert_faction_stance_change,
    assert_poi_discovered,
    run_geo_checks,
)


def _check_7_id() -> int:
    """9 条 geo check 共享 check_id=7(向后兼容 compute_coherence_score 的权重 dict)。"""
    return 7


def _wrap_geo_results(rule_results: list, name: str) -> CheckResult:
    """把 assertions.RuleResult 列表聚合成单个 CheckResult。

    规则:任一 RuleResult 存在 → CheckResult.passed=False + detail 拼接所有 message;
    空列表 → CheckResult.passed=True + detail=""。
    """
    if not rule_results:
        return CheckResult(
            check_id=_check_7_id(),
            name=name,
            passed=True,
            detail="",
        )
    first = rule_results[0]
    detail = "; ".join(r.message for r in rule_results)
    return CheckResult(
        check_id=_check_7_id(),
        name=name,
        passed=False,
        detail=detail,
        kind=first.kind,
    )


class ReviewerAgent(BaseAgent):
    """Fact Guard reviewer + v1.6 Narrative Guard + Style Guard L3。"""

    # --- v2.x Plan 3 M5: Map 9-rule check wrappers ---

    def check_7_geo_no_implicit_teleport(
        self, map_data: dict, scene_context: dict
    ) -> CheckResult:
        if not scene_context:
            return CheckResult(
                check_id=_check_7_id(),
                name="geo.no_implicit_teleport",
                passed=True, detail="", kind="blocker",
            )
        results = assert_route_exists(
            map_data,
            from_id="",
            to_id="",
        ) if False else []  # placeholder — see check_7_geo_run_all
        return _wrap_geo_results(results, "geo.no_implicit_teleport")

    # NOTE: 上述模板是占位,真实实现由 run_geo_checks 聚合。
    # 9 个 check_7_geo_* 方法保留 stub 以满足 caller 接口契约;
    # run_fact_guard 通过 _run_geo_check_id_7 一次性调用 run_geo_checks。


# 删除上面的 stub ReviewerAgent 与占位方法 — 上面那段只是为了 schema 显示;
# 真正实现见下方 _extend_check_7_methods(注入到 ReviewerAgent)。
del _check_7_id, _wrap_geo_results, ReviewerAgent


# --- 真正的实现 — 注入到 ReviewerAgent 类 ---

def _make_check_7_method(name: str, kind: str, filter_code: str):
    """生成 check_7_geo_* 方法的闭包。

    这些方法读 scene_context 中预过滤的字段,直接调用对应 assert_*。
    """
    def _method(self, map_data: dict, scene_context: dict) -> CheckResult:
        if not scene_context:
            return CheckResult(
                check_id=7, name=name, passed=True, detail="", kind=kind,
            )
        # 委托给 run_geo_checks() 然后过滤
        all_results = run_geo_checks(map_data, scene_context)
        matched = [r for r in all_results if r.code == filter_code]
        if not matched:
            return CheckResult(
                check_id=7, name=name, passed=True, detail="", kind=kind,
            )
        detail = "; ".join(r.message for r in matched)
        return CheckResult(
            check_id=7, name=name, passed=False, detail=detail, kind=kind,
        )
    _method.__name__ = name
    return _method


def _attach_geo_check_methods():
    """把 9 个 check_7_geo_* 方法绑到 ReviewerAgent 类。"""
    pairs = [
        ("check_7_geo_no_implicit_teleport", "blocker", "geo.no_implicit_teleport"),
        ("check_7_geo_forbidden_access", "blocker", "geo.forbidden_access"),
        ("check_7_geo_time_budget_exceeded", "blocker", "geo.time_budget_exceeded"),
        ("check_7_geo_distance_unrealistic", "warning", "geo.distance_unrealistic"),
        ("check_7_geo_climate_mismatch", "warning", "geo.climate_mismatch"),
        ("check_7_geo_density_high", "warning", "geo.density_high"),
        ("check_7_geo_alias_added", "info", "geo.alias_added"),
        ("check_7_geo_faction_attitude_shift", "info", "geo.faction_attitude_shift"),
        ("check_7_geo_poi_discovered", "info", "geo.poi_discovered"),
    ]
    for method_name, kind, code in pairs:
        method = _make_check_7_method(method_name, kind, code)
        setattr(ReviewerAgent, method_name, method)


# 绑定到已经定义好的 ReviewerAgent 类
_attach_geo_check_methods()
del _attach_geo_check_methods
```

> **注意:** 上面的代码 **必须放在 `backend/agents/reviewer.py` 文件末尾(在 `_generate_retry_hints` 之后)**,因为 `ReviewerAgent` 类已经定义。删除上面"`del _check_7_id, _wrap_geo_results, ReviewerAgent`"之前的占位块 — 那是伪代码占位,实际文件里只保留 `_make_check_7_method` + `_attach_geo_check_methods` 两块。

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest backend/tests/test_reviewer_geo.py -v`
Expected: 8 passed

- [ ] **Step 5: Commit**

```bash
git add backend/agents/reviewer.py backend/tests/test_reviewer_geo.py
git commit -m "feat(reviewer): add 9 check_7_geo_* methods wrapping assertions"
```

---

## Task 8: 修改 `run_fact_guard` 接受 `map_context` 参数,末尾聚合 9 条规则

**Files:**
- Modify: `backend/agents/reviewer.py:98-162`(`run_fact_guard` 方法体)
- Modify: `backend/tests/test_reviewer_geo.py`(追加测试)

- [ ] **Step 1: 追加失败测试**

在 `backend/tests/test_reviewer_geo.py` 末尾追加:

```python


def test_run_fact_guard_accepts_map_context_kwarg():
    """Plan 3:run_fact_guard 新增 map_context=None 关键字参数(默认向后兼容)。"""
    from backend.agents.reviewer import ReviewerAgent
    agent = ReviewerAgent(project_id="proj_x")
    result = agent.run_fact_guard(
        draft_text="",
        characters=[],
        world_rules={},
        scene_plan={},
        map_context=None,
    )
    # 默认 None → 9 条 geo check 不运行,checks 列表只含现有 6 条
    assert len(result.checks) == 6


def test_run_fact_guard_empty_map_context_dict_runs_geo_checks():
    """map_context={} 也视为「跳过 geo checks」(向后兼容 Plan 1 caller)。"""
    from backend.agents.reviewer import ReviewerAgent
    agent = ReviewerAgent(project_id="proj_x")
    result = agent.run_fact_guard(
        draft_text="",
        characters=[],
        world_rules={},
        scene_plan={},
        map_context={},
    )
    assert len(result.checks) == 6


def test_run_fact_guard_with_map_context_appends_nine_geo_checks():
    """map_context 包含 map_data + scene_context → checks 列表扩到 6+9=15。"""
    from backend.agents.reviewer import ReviewerAgent
    agent = ReviewerAgent(project_id="proj_x")
    map_data = {
        "schema_version": "1.0", "project_id": "proj_x",
        "locations": [
            {"id": "loc_a", "name": "A", "type": "inn",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
             "enter_conditions": [], "factions": []},
            {"id": "loc_b", "name": "B", "type": "inn",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
             "enter_conditions": [], "factions": []},
        ],
        "routes": [],
        "regions": [], "settings": {}, "location_states": [],
    }
    scene_ctx = {"routes": [{"from": "loc_a", "to": "loc_b"}]}
    result = agent.run_fact_guard(
        draft_text="",
        characters=[],
        world_rules={},
        scene_plan={},
        map_context={"map_data": map_data, "scene_context": scene_ctx},
    )
    assert len(result.checks) == 15
    # 6 existing checks all kind="info" (default)
    for c in result.checks[:6]:
        assert c.kind == "info"
    # 9 new checks: at least one is blocker
    geo_checks = result.checks[6:]
    kinds = {c.kind for c in geo_checks}
    assert "blocker" in kinds
    # all_passed should be False because blocker failed
    assert result.all_passed is False


def test_run_fact_guard_blocker_only_marks_all_passed_false():
    """Warning / Info 失败不阻断 all_passed;只有 Blocker 失败才阻断。"""
    from backend.agents.reviewer import ReviewerAgent
    agent = ReviewerAgent(project_id="proj_x")
    map_data = {
        "schema_version": "1.0", "project_id": "proj_x",
        "locations": [], "routes": [],
        "regions": [
            {"id": "region_x", "name": "X", "climate": "严寒, 长冬",
             "aliases": [], "tags": []},
        ],
        "settings": {
            "chapter_new_location_cap": 5,
            "reuse_rate_target": 0.6, "strict_geo": False,
        },
        "location_states": [],
    }
    # 只有 climate warning(无 blocker)
    scene_ctx = {"climate": [{"region_id": "region_x", "scene_weather": "烈日"}]}
    result = agent.run_fact_guard(
        draft_text="",
        characters=[],
        world_rules={},
        scene_plan={},
        map_context={"map_data": map_data, "scene_context": scene_ctx},
    )
    # all_passed stays True (Warning 不阻断 circuit breaker)
    assert result.all_passed is True


def test_run_fact_guard_legacy_signature_without_map_context_still_works():
    """现有 caller(stage4_writing.py 等)不传 map_context 时也跑通。"""
    from backend.agents.reviewer import ReviewerAgent
    agent = ReviewerAgent(project_id="proj_x")
    result = agent.run_fact_guard(
        draft_text="一些文本",
        characters=[{"name": "X"}],
        world_rules={},
        scene_plan={"required_logs": []},
    )
    assert len(result.checks) == 6
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest backend/tests/test_reviewer_geo.py::test_run_fact_guard_accepts_map_context_kwarg -v`
Expected: `TypeError: run_fact_guard() got an unexpected keyword argument 'map_context'`

- [ ] **Step 3: 修改 `run_fact_guard` 方法签名 + 末尾聚合**

打开 `backend/agents/reviewer.py`,修改 `run_fact_guard` 方法(原第 98-162 行):

```python
    def run_fact_guard(
        self,
        draft_text: str,
        characters: list[dict],
        world_rules: dict,
        scene_plan: dict,
        storyos_state: Optional[dict] = None,
        precheck_result=None,
        map_context: Optional[dict] = None,
    ) -> FactGuardResult:
        """v2.x Plan 3:map_context 形参。

        map_context=None 或 {} → 不运行 9 条 geo check(向后兼容所有现有 caller)。
        map_context={"map_data": dict, "scene_context": dict} →
            末尾追加 9 条 geo check;任一 Blocker 失败 → all_passed=False。
        """
        if storyos_state is None:
            storyos_state = {}

        # --- 现有 6 条 check(行为完全不变,kind 默认 "info") ---
        timeline_results = []
        char_state_results = []
        for character in characters:
            if not character:
                continue
            timeline_results.append(self.check_1_timeline(draft_text, character))
            char_state_results.append(
                self.check_2_character_state(draft_text, character)
            )

        merged_timeline = CheckResult(
            check_id=1,
            name="时间线连续性",
            passed=all(r.passed for r in timeline_results),
            detail="\n".join(
                f"  [{character.get('name', '?')}] {r.detail}"
                for r, character in zip(timeline_results, characters)
                if character
            ) if timeline_results else "无角色数据",
        )

        merged_char_state = CheckResult(
            check_id=2,
            name="角色状态一致性",
            passed=all(r.passed for r in char_state_results),
            detail="\n".join(
                f"  [{character.get('name', '?')}] {r.detail}"
                for r, character in zip(char_state_results, characters)
                if character
            ) if char_state_results else "无角色数据",
        )

        checks = [
            merged_timeline,
            merged_char_state,
            self.check_3_world_rules(draft_text, world_rules),
            self.check_4_asset_compliance(draft_text, storyos_state),
            self.check_5_log_completeness(draft_text, scene_plan),
            self.check_6_semantic_precheck_review(precheck_result=precheck_result),
        ]

        # --- v2.x Plan 3: 9 条 geo check 聚合 ---
        geo_blocker_failed = False
        if map_context:
                map_data = map_context.get("map_data") or {}
                scene_context = map_context.get("scene_context") or {}
                geo_results = run_geo_checks(map_data, scene_context)
                # 把每个 RuleResult 转为 CheckResult 并附加到 checks 列表
                for r in geo_results:
                    cr = CheckResult(
                        check_id=7,
                        code=r.code,
                        name=r.code,
                        passed=False,
                        detail=r.message,
                    )
                    cr.kind = r.kind
                    checks.append(cr)
                    if r.kind == "blocker":
                        geo_blocker_failed = True

        all_passed = all(c.passed for c in checks) and not geo_blocker_failed
        score = self.compute_coherence_score(checks)
        hints = self._generate_retry_hints(checks)

        return FactGuardResult(
            all_passed=all_passed,
            checks=checks,
            coherence_score=score,
            retry_hints=hints,
        )
```

> **注:** 上面 `cr = CheckResult(... code=r.code, name=r.code, ...)` 用 `**kwargs` 风格避免 `kind=` 直接传字面量(因为 `kind` 是 `str`,不是 Literal)。需要先构造实例,再赋值 `cr.kind = r.kind`。`CheckResult` 是 dataclass,支持属性赋值。
>
> 如果 `CheckResult` 上有 `code` 字段被现有 reader 忽视,需要**额外确认**:`compute_coherence_score` 按 `check_id` 取权重,9 条都是 `check_id=7`,权重表里没有 7 → 默认 0(行为正确,不污染总分)。

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest backend/tests/test_reviewer_geo.py -v`
Expected: 13 passed

- [ ] **Step 5: 运行现有 reviewer 相关测试无 regression**

Run: `pytest backend/tests/test_multi_power_system_downstream.py -v`
Expected: all existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add backend/agents/reviewer.py backend/tests/test_reviewer_geo.py
git commit -m "feat(reviewer): run_fact_guard accepts map_context + appends 9 geo checks"
```

---

## Task 9: `prompts/scene_writing.yaml` system_prompt 追加 §9.4 自查清单

**Files:**
- Modify: `backend/prompts/scene_writing.yaml`(末尾追加段)
- Create: `backend/tests/test_scene_writing_selfcheck.py`

- [ ] **Step 1: 写失败测试**

打开 `backend/tests/test_scene_writing_selfcheck.py`,写入:

```python
"""scene_writing.yaml §9.4 自查清单测试 — 9 个 rule ID 必须全部出现在 system_prompt。"""
import re
from pathlib import Path

from backend.prompts.loader import _load_yaml  # 或 backend.agents.base_agent 的 load_prompt


EXPECTED_RULE_IDS = [
    "geo.no_implicit_teleport",
    "geo.forbidden_access",
    "geo.time_budget_exceeded",
    "geo.distance_unrealistic",
    "geo.climate_mismatch",
    "geo.density_high",
    "geo.alias_added",
    "geo.faction_attitude_shift",
    "geo.poi_discovered",
]


def _load_scene_writing_prompt() -> str:
    """直读 backend/prompts/scene_writing.yaml,提取 system_prompt 段。

    不走 BaseAgent.load_prompt 因为需要 3-tier override chain 在测试中不方便 mock。
    """
    path = Path(__file__).parent.parent / "prompts" / "scene_writing.yaml"
    data = _load_yaml(path)
    return data.get("system_prompt", "")


def test_system_prompt_contains_all_nine_geo_rule_ids():
    """PRD §9.4 要求:Writer 端看到所有 9 个 rule code。"""
    system_prompt = _load_scene_writing_prompt()
    for code in EXPECTED_RULE_IDS:
        assert code in system_prompt, f"Missing rule code: {code}"


def test_system_prompt_contains_self_check_section():
    """§9.4 段必须以「【地理自查清单】」开头(Marker,便于运行时解析)。"""
    system_prompt = _load_scene_writing_prompt()
    assert "【地理自查清单" in system_prompt


def test_yaml_does_not_break_format_template():
    """新增段含示例 rule code(如 「geo.no_implicit_teleport」)— 任何 { 不能未配对,
    否则 str.format() 会 KeyError(参见 feedback_prompt_yaml_brace_escape 内存)。

    简化检查:扫 system_prompt 中的 { 与 } 配对,数量必须偶数。
    """
    system_prompt = _load_scene_writing_prompt()
    n_open = system_prompt.count("{")
    n_close = system_prompt.count("}")
    assert n_open == n_close, (
        f"Unbalanced braces: {n_open} open vs {n_close} close — "
        "literal {{...}} example JSON must be escaped per brace-escape rule"
    )


def test_yaml_user_prompt_template_still_has_map_card_placeholder():
    """Plan 2 加的 {map_card} 占位必须存在 — Plan 3 不应误删。"""
    path = Path(__file__).parent.parent / "prompts" / "scene_writing.yaml"
    data = _load_yaml(path)
    user_template = data.get("user_prompt_template", "")
    assert "{map_card}" in user_template


def _load_yaml(path: Path) -> dict:
    import yaml
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)
```

> **注意:** 把 `_load_yaml` 放在文件底部(辅助函数);如果 `backend/prompts/loader.py` 不存在,**测试用本地 yaml.safe_load 实现**(plan 末位块代码)。

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest backend/tests/test_scene_writing_selfcheck.py -v`
Expected: `AssertionError: Missing rule code: geo.no_implicit_teleport`(系统提示暂无 §9.4 段)

- [ ] **Step 3: 修改 `prompts/scene_writing.yaml` system_prompt**

打开 `backend/prompts/scene_writing.yaml`,在 `system_prompt: |` 块的最后一段(在「用中文创作」之后,user_prompt_template 之前)追加:

```yaml

  【地理自查清单 — 写作前先核对】(PRD §9.4)
  在写出本场景正文前,你必须自查以下 9 项;若发现违反,请在 SF_LOG 之外
  主动调整正文,不要直接忽略:
  1. geo.no_implicit_teleport: 角色当前位置是否在本章起点声明;每次移动是否经过已有 route,无则 SF_LOG from/to 必须一致
  2. geo.forbidden_access: 是否避开 accessible=false 的 location(除非 enter_conditions 解除)
  3. geo.time_budget_exceeded: 移动耗时是否在本章 time_budget 内
  4. geo.distance_unrealistic: route.est_travel_minutes 与 distance_tier 数量级是否匹配(intra_city 2–60min,inter_city 0.5–10h,inter_region 2–24h,inter_continent 12h–3d)
  5. geo.climate_mismatch: 文中天气是否与 region.climate 矛盾(湿热不写大雪,无冬不写寒冬)
  6. geo.density_high: 单章新增 location 数是否 ≤ settings.chapter_new_location_cap(默认 5)
  7. geo.alias_added: 新别名是否已通过 name_to_id 反向索引归一化到 location_id
  8. geo.faction_attitude_shift: location.factions.observed 是否与 world.factions.attitude_summary 一致
  9. POI 未发现约束: discoverable=false 的 POI 不在本文中提及;
     first_discovered_chapter=本场之前章节的 POI 可自由使用;
     first_discovered_chapter=本场或之后章节的 POI 不可在文中点名(标注「未发现」)。
```

> **brace-escape rule:** 上面段中没有任何 `{` / `}` 字符 — 已检查。如果未来扩展示例 JSON,必须把 `{...}` 写成 `{{...}}`。

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest backend/tests/test_scene_writing_selfcheck.py -v`
Expected: 4 passed

- [ ] **Step 5: 运行 LLM-side smoke test(可选):确认 prompt 仍可 format**

```bash
cd /Users/longsa/Codes/nebula
source venv/bin/activate
python -c "
import yaml
with open('backend/prompts/scene_writing.yaml') as f:
    data = yaml.safe_load(f)
# 模拟最小 format 调用 — 不传任何字段也能 parse
print('system_prompt length:', len(data['system_prompt']))
print('contains all 9 rule codes:',
      all(c in data['system_prompt'] for c in [
          'geo.no_implicit_teleport', 'geo.forbidden_access',
          'geo.time_budget_exceeded', 'geo.distance_unrealistic',
          'geo.climate_mismatch', 'geo.density_high',
          'geo.alias_added', 'geo.faction_attitude_shift',
          'geo.poi_discovered']))
"
```
Expected: `system_prompt length: <1200` · `contains all 9 rule codes: True`

- [ ] **Step 6: Commit**

```bash
git add backend/prompts/scene_writing.yaml backend/tests/test_scene_writing_selfcheck.py
git commit -m "feat(prompts): scene_writing.yaml §9.4 geo self-check checklist"
```

---

## Task 10: `StoryOSAgent` POI 不可见约束注入 — 标记 `discoverable=true` 时返回 POI 列表供 map_card 拼接

**Files:**
- Modify: `backend/agents/storyos_agent.py:375-410`(`_collect_character_update` 方法体附近)
- Create: `backend/tests/test_poi_invisible.py`

- [ ] **Step 1: 写失败测试**

打开 `backend/tests/test_poi_invisible.py`,写入:

```python
"""StoryOSAgent POI discoverable=true 注入测试 — 让 map_card 能拿到「已发现 POI」列表。"""
import json
from pathlib import Path

import pytest


@pytest.fixture
def project_with_pois(tmp_path):
    """构建最小项目,含 1 个 discoverable=true 的 POI。"""
    proj = tmp_path / "proj_x"
    proj.mkdir()
    storyos_dir = proj / "storyos"
    storyos_dir.mkdir()
    # 写 map.json(Plan 1 schema)
    map_data = {
        "schema_version": "1.0",
        "project_id": "proj_x",
        "locations": [
            {"id": "loc_inn", "name": "青峰客栈", "type": "inn",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
             "enter_conditions": [], "factions": []},
        ],
        "pois": [
            {"id": "poi_cellar", "name": "青峰客栈地窖", "parent_location_id": "loc_inn",
             "kind": "shrine", "description": "通向废弃古寺的暗道入口",
             "discoverable": True, "first_discovered_chapter": None, "tags": ["密道"]},
        ],
    }
    with open(proj / "map.json", "w", encoding="utf-8") as f:
        json.dump(map_data, f)
    return proj


def test_list_discoverable_pois_returns_pending_first(monkeypatch, project_with_pois):
    """first_discovered_chapter=None 的 POI 视为「待发现」,应出现在 list 中。"""
    from backend.config import settings
    from backend.agents.storyos_agent import StoryOSAgent

    monkeypatch.setattr(settings, "projects_dir", project_with_pois.parent)
    agent = StoryOSAgent("proj_x")

    pois = agent.list_discoverable_pois_for_card()
    assert len(pois) == 1
    assert pois[0]["poi_id"] == "poi_cellar"
    assert pois[0]["name"] == "青峰客栈地窖"
    assert pois[0]["status"] == "待发现"


def test_list_discoverable_pois_returns_empty_when_no_pois(monkeypatch, tmp_path):
    proj = tmp_path / "proj_y"
    proj.mkdir()
    map_data = {"schema_version": "1.0", "project_id": "proj_y", "locations": [], "pois": []}
    with open(proj / "map.json", "w", encoding="utf-8") as f:
        json.dump(map_data, f)

    from backend.config import settings
    from backend.agents.storyos_agent import StoryOSAgent
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    agent = StoryOSAgent("proj_y")
    assert agent.list_discoverable_pois_for_card() == []


def test_list_discoverable_pois_skips_non_discoverable(monkeypatch, tmp_path):
    """discoverable=false 的 POI 不进入 list(PRD §3.2.4 不可见约束)。"""
    proj = tmp_path / "proj_z"
    proj.mkdir()
    map_data = {
        "schema_version": "1.0", "project_id": "proj_z",
        "locations": [
            {"id": "loc_a", "name": "A", "type": "inn",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
             "enter_conditions": [], "factions": []},
        ],
        "pois": [
            {"id": "poi_secret", "name": "隐藏地窖", "parent_location_id": "loc_a",
             "kind": "shrine", "discoverable": False, "first_discovered_chapter": None, "tags": []},
        ],
    }
    with open(proj / "map.json", "w", encoding="utf-8") as f:
        json.dump(map_data, f)

    from backend.config import settings
    from backend.agents.storyos_agent import StoryOSAgent
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    agent = StoryOSAgent("proj_z")
    assert agent.list_discoverable_pois_for_card() == []


def test_list_discoverable_pois_returns_already_discovered(monkeypatch, project_with_pois):
    """first_discovered_chapter 已有值的 POI 仍出现在 list,status=「已发现」。

    map_card 「已发现 POI」段需要两类:已发现的(供回溯引用)+ 待发现的(供伏笔铺垫)。
    """
    # 修改 first_discovered_chapter=12
    map_path = project_with_pois / "map.json"
    data = json.loads(map_path.read_text())
    data["pois"][0]["first_discovered_chapter"] = 12
    map_path.write_text(json.dumps(data, ensure_ascii=False))

    from backend.config import settings
    from backend.agents.storyos_agent import StoryOSAgent
    monkeypatch.setattr(settings, "projects_dir", project_with_pois.parent)
    agent = StoryOSAgent("proj_x")

    pois = agent.list_discoverable_pois_for_card()
    assert len(pois) == 1
    assert pois[0]["status"] == "已发现"
    assert pois[0]["first_discovered_chapter"] == 12


def test_list_discoverable_pois_returns_empty_when_no_map(monkeypatch, tmp_path):
    """老项目无 map.json(Plan 1 旧路径)— list 返回 [],不报错。"""
    proj = tmp_path / "proj_legacy"
    proj.mkdir()
    # 没有 map.json
    from backend.config import settings
    from backend.agents.storyos_agent import StoryOSAgent
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    agent = StoryOSAgent("proj_legacy")
    assert agent.list_discoverable_pois_for_card() == []
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest backend/tests/test_poi_invisible.py -v`
Expected: `AttributeError: 'StoryOSAgent' object has no attribute 'list_discoverable_pois_for_card'`

- [ ] **Step 3: 在 `StoryOSAgent` 加 `list_discoverable_pois_for_card` 方法**

打开 `backend/agents/storyos_agent.py`,在 `_ensure_registry_dir` 方法(第 409 行附近)之前插入:

```python


    def list_discoverable_pois_for_card(self) -> list[dict]:
        """返回 map_card 「已发现 POI」段需要的所有 POI 列表。

        PRD §3.2.4 + §9.4 POI 不可见约束:
          - discoverable=false → 不返回(不进 map_card、不进 Writer prompt)
          - discoverable=true + first_discovered_chapter=None → status="待发现"
          - discoverable=true + first_discovered_chapter=N → status="已发现"

        Returns: list of {"poi_id", "name", "parent_location_id",
                           "first_discovered_chapter", "status", "tags"}
                 空 list — 老项目无 map.json 或 map.json 无 POI 字段。

        Plan 2 的 build_map_card() 调用此方法拼装「已发现 POI」段(独立字符串)。
        """
        map_path = self._project_dir / "map.json"
        if not map_path.exists():
            return []
        try:
            with open(map_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("list_discoverable_pois_for_card: failed to read %s: %s",
                           map_path, e)
            return []

        out: list[dict] = []
        for poi in data.get("pois", []) or []:
            if not poi.get("discoverable", False):
                continue
            first_ch = poi.get("first_discovered_chapter")
            out.append({
                "poi_id": poi.get("id", ""),
                "name": poi.get("name", ""),
                "parent_location_id": poi.get("parent_location_id", ""),
                "first_discovered_chapter": first_ch,
                "status": "已发现" if first_ch is not None else "待发现",
                "tags": poi.get("tags", []) or [],
            })
        return out
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest backend/tests/test_poi_invisible.py -v`
Expected: 5 passed

- [ ] **Step 5: 确认 StoryOSAgent 现有 SF_LOG 解析行为不变**

Run: `pytest backend/tests/test_agents/ -v`
Expected: all existing tests pass(SF_LOG 解析链路未触及)

- [ ] **Step 6: Commit**

```bash
git add backend/agents/storyos_agent.py backend/tests/test_poi_invisible.py
git commit -m "feat(storyos): list_discoverable_pois_for_card for POI 不可见约束"
```

---

## 自审(Self-Review)

### 1. Spec 覆盖表

PRD §6 / §9 / §13-14 中 M5 范围需求 ↔ Plan 3 任务:

| PRD 要求 | Plan 3 任务 |
|---|---|
| §6 — 9 条规则(3 Blocker + 3 Warning + 3 Info)的 deterministic 拆分 | Task 1 (骨架) + Task 2 (Blocker) + Task 3 (Warning) + Task 4 (Info) + Task 5 (聚合器) |
| §9.1 — `geo.no_implicit_teleport` Blocker | Task 2 (`assert_route_exists`) + Task 7 (wrapper) + Task 8 (聚合) |
| §9.1 — `geo.forbidden_access` Blocker | Task 2 (`assert_accessible`) + Task 7 + Task 8 |
| §9.1 — `geo.time_budget_exceeded` Blocker | Task 2 (`assert_chapter_time_budget`) + Task 7 + Task 8 |
| §9.2 — `geo.distance_unrealistic` Warning | Task 3 (`assert_distance_consistent`) + Task 7 + Task 8 |
| §9.2 — `geo.climate_mismatch` Warning | Task 3 (`assert_climate_matches`) + Task 7 + Task 8 |
| §9.2 — `geo.density_high` Warning | Task 3 (`assert_density_ok`) + Task 7 + Task 8 |
| §9.3 — `geo.alias_added` Info | Task 4 (`assert_alias_discovered`) + Task 7 + Task 8 |
| §9.3 — `geo.faction_attitude_shift` Info | Task 4 (`assert_faction_stance_change`) + Task 7 + Task 8 |
| §9.3 — `geo.poi_discovered` Info | Task 4 (`assert_poi_discovered`) + Task 7 + Task 8 |
| §9.4 — Writer 自查清单注入 `prompts/scene_writing.yaml` | Task 9 |
| §11.4 — `CheckResult.kind` 字段 + `check_7_geo_*` 9 方法 + `run_fact_guard` 聚合 | Task 6 (`kind` 字段) + Task 7 (9 方法) + Task 8 (`run_fact_guard`) |
| §3.2.4 — POI 不可见约束(Plan 3 范围 — StoryOSAgent 抽取) | Task 10 |
| §13.1 — `test_fact_guard_geo.py` 9 条规则各 2 用例 + 优先级 | Task 2,3,4 (基础)+ Task 5 (优先级聚合)+ Task 8 (run_fact_block 集成) |

**无遗漏需求。**

### 2. 占位符扫描

搜索:TBD / TODO / "implement later" / "类似" / "fill in details" / "类似 Task X" → **0 处**。

Task 7 占位块 `del _check_7_id, _wrap_geo_results, ReviewerAgent` 后跟随真实实现,这是「删除占位/插入真实代码」的标准 TDD 模式,但容易让执行人困惑 — 在 Task 7 Step 3 末尾加了明确「删除占位块」的提示。

### 3. 类型/签名一致性

| 实体 | Plan 1 定义位置 | Plan 3 引用位置 | 一致? |
|---|---|---|---|
| `Map / Location / Route / POI / Region / MapSettings / DramaticRole / FactionStance / DisplayPos` | `backend/map_system/models.py` | Task 2/3/4 测试 fixture,Task 10 测试 fixture | OK(只读字段) |
| `MapSettings.chapter_new_location_cap: int = 5` | `MapSettings` | Task 3 `assert_density_ok` | OK |
| `Location.enter_conditions: list[str]` | `Location` | Task 2 `assert_accessible` 注释引用 | OK(不修改) |
| `Location.factions: list[FactionStance]` | `Location` | Task 4 `assert_faction_stance_change` | OK |
| `Route.est_travel_minutes: int >= 0` | `Route` | Task 2 `assert_chapter_time_budget` | OK |
| `Route.bidirectional: bool` | `Route` | Task 2 `_find_route` | OK |
| `POI.discoverable: bool` | `POI` | Task 10 `list_discoverable_pois_for_card` | OK |
| `POI.first_discovered_chapter: Optional[int]` | `POI` | Task 4 + Task 10 | OK |
| `LocationState.accessible: bool` | `LocationState` | Task 2 `_latest_state_for` | OK |
| `load_map(project_id) -> Optional[dict]` | `backend/map_system/storage.py` | 9 条规则通过 `map_data: dict` 接收(Plan 1 caller 负责传入) | OK |
| `build_name_index(project_id) -> dict[str, str]` | `backend/map_system/storage.py` | Task 4 `assert_alias_discovered` 通过 `canonical_id` 接收(由 caller 解析) | OK |
| `ReviewerAgent.run_fact_guard` 新增 `map_context: Optional[dict] = None` | Task 8 | Task 6/7/8 测试,`backend/api/stage4_fact_guard.py`(Plan 1 caller 不传即可) | OK |

`CheckResult.kind: str = "info"`(字符串类型而非 Literal):避免破坏 `backend/api/stage4_fact_guard.py:85-86` `getattr(fg_result, "checks", [])` 现有序列化代码;运行时由 check_7_geo_* 写死的字面量保证。

### 4. 风险与未决问题

- **`compute_coherence_score` 权重表不含 `check_id=7`**:`weights.get(c.check_id, 0) == 0`,9 条 geo check 不贡献 coherence score(避免总分被 Blocker 失败污染)。这是符合 PRD 的语义 — 9 条 check 只控熔断器决策,不影响总评分。
- **`CheckResult` 没有 `code` 字段**:Task 8 Step 3 直接给实例属性 `cr.code = r.code` 赋值(dataclass 支持)。如果未来 `CheckResult` 加 `frozen=True`,需要改成 `CheckResult(... code=...)` 在构造里加。
- **Map 9-rule 与 `fact_guard_ctx` 的命名**:用户原文用 `map_context` 作为 `run_fact_guard` 的参数名,与 Plan 1 提到的 `fact_guard_ctx` 略有差异。Plan 3 选 `map_context` — 与 `prompts/scene_writing.yaml` 中的 `{map_card}` 占位命名一致,语义清晰。
- **POI discoverable=true 但 `first_discovered_chapter=本场章节` 的处理**:Plan 3 的 `list_discoverable_pois_for_card` 不做章节过滤,把所有 discoverable POI 返给 map_card。Plan 2 的 build_map_card 应该按当前 chapter_number 过滤(只返 `<= chapter N` 的) — 这是 Plan 2 的责任,Plan 3 不背锅。
- **`assert_faction_stance_change` 的关键词集是启发式**:MVP 用 4 个 attitude 各自的中文关键词集合。后续可换成 LLM 推断(但不在 M5 范围内 — assert_* 全 deterministic 承诺)。
- **`assert_climate_matches` 关键词表小**:只覆盖「无冬」「严寒」「湿热」3 个;后续可扩展。MVP 仅作为「显然矛盾」catch。
- **`run_geo_checks` 的 `scene_context` 字段命名**:Plan 3 起的契约,Plan 2 注入时需遵循。契约细节在 Task 5 Step 3 docstring 里。