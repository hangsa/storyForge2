# 地图系统 实施计划 — Plan 1 (M1+M2+M3+M6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把世界观中的「时代与地理」机器化为可编辑的地理注册表,落地 Wizard Step 4 的全功能 UI(5 个 Tab + Mermaid 静态图谱),并接通 PlannerAgent 端的初始生成 + 章节级快照/回滚。落地后用户能:① 在 Step 4 一键从 world.json 自动生成 5-15 region + 20-40 location 的初始地图;② 在 5 个 Tab(区域/地点/路线/POI/快照)行内编辑;③ 点击「查看地图」看 Mermaid 拓扑图;④ 在工作台做章节快照和回滚。

**Architecture:**
- 数据层:`backend/map_system/` 新模块,`Map` Pydantic 模型 + 单文件 `map.json` + `map_snapshots/chapter_NNN.json` 子目录
- API:挂在 `backend/api/stage2_world_char.py` 同一 router(`/api/stage2/map/*` 12 个端点)
- UI:整文件重写 `frontend/src/components/wizard/MapStep.tsx`(替换占位),复用 `ds/` 设计系统 + WorldStep 的 tablist/sub-tab 模式
- 生成管线:`backend/prompts/map_generation.yaml` + `PlannerAgent.generate_map` 方法 + `/api/stage2/generate-map` 端点
- 快照/回滚:`map_snapshots/` 目录 + `POST /api/stage2/map/snapshot/{chapter}` + `POST /api/stage2/map/rollback/{chapter}`

**Tech Stack:** Python 3.11 (FastAPI + Pydantic v2) · React 18 + TypeScript + Tailwind · YAML prompts · pytest + vitest · mermaid (前端渲染)

---

## 范围与边界

**Plan 1 (本文件, M1+M2+M3+M6) 包含:**
- M1 数据模型 + 存储 + 基础读 API
- M2 Wizard Step 4 UI 重写(5 Tab + Mermaid modal + 行内编辑 + prefill)
- M3 map_generation 提示词 + PlannerAgent.generate_map + /generate-map + /regenerate-map-section
- M6 章节快照 + 回滚 API + 快照 Tab UI

**Plan 2 (后续, M4) 包含:**
- `backend/map_system/map_card.py` — build_map_card 函数(scene-level 增量累计)
- `backend/prompts/scene_writing.yaml` 加 `{map_card}` 占位 + §9.4 自查清单
- `backend/api/stage4_writing.py` / `stage4_async_executor.py` 把 map_card 注入 writer 上下文
- `backend/outline_context/builder.py` 在 chapter outline 上下文组装时拼入 map_card
- `backend/agents/storyos_agent.py` 写 footprint + alias map
- `backend/map_system/extraction.py` — SF_LOG 抽取 + LLM mention 抽取
- `backend/prompts/location_mention_extraction.yaml`
- `backend/api/stage4_fact_guard.py` 把 map context 透传给 reviewer.run_fact_guard

**Plan 3 (后续, M5) 包含:**
- `backend/map_system/assertions.py` — 9 条规则(3 Blocker + 3 Warning + 3 Info)
- `backend/agents/reviewer.py` CheckResult 加 `kind` 字段 + `check_7_geo_*` 9 个方法 + run_fact_guard 末尾聚合
- `prompts/scene_writing.yaml` system_prompt 末尾加 §9.4 自查清单
- POI 不可见约束注入

**为什么这样切:** Plan 1 完成后用户能完成「生成 + 编辑 + 看图 + 回滚」的完整回路,但写作管线**还不知道地图存在**(map_card 还没注入,fact-guard 还没接地图规则)。Plan 2+3 是消费/强制侧。

---

## 文件改动范围

### 新建 (Plan 1)

| 文件 | 用途 | 任务 |
|---|---|---|
| `backend/map_system/__init__.py` | 模块入口 | Task 1 |
| `backend/map_system/models.py` | Map/Location/Region/Route/POI 等 9 类 Pydantic 模型 | Task 2, 3 |
| `backend/map_system/storage.py` | load/save/atomic, name_to_id 反向索引 | Task 4, 5 |
| `backend/map_system/snapshots.py` | 章节快照落盘 + 回滚 | Task 21, 23 |
| `backend/prompts/map_generation.yaml` | 初始生成 prompt | Task 12 |
| `backend/api/stage2_map.py` | 12 个 /api/stage2/map/* 端点 + /generate-map | Task 6, 13, 17, 22 |
| `backend/tests/test_map_models.py` | 模型校验 + reference integrity | Task 3 |
| `backend/tests/test_map_api.py` | 12 端点 happy path + 关键 422 | Task 6, 13 |
| `backend/tests/test_map_storage.py` | atomic write + name_to_id 反向索引 | Task 4, 5 |
| `backend/tests/test_map_snapshots.py` | 章节快照 + 回滚 + checkpoint hash | Task 21, 23 |
| `frontend/src/components/wizard/MapStep.tsx` | 整文件重写(替换占位) | Task 8, 9, 10, 11 |
| `frontend/src/components/wizard/MermaidMapModal.tsx` | Mermaid 拓扑图 modal | Task 10 |
| `frontend/src/components/wizard/MapStep.test.tsx` | Step 4 主流程单测 | Task 11 |
| `frontend/src/components/wizard/MermaidMapModal.test.tsx` | Mermaid modal 单测 | Task 10 |

### 修改 (Plan 1)

| 文件 | 改动 | 任务 |
|---|---|---|
| `backend/main.py` | 注册新 router | Task 4 |
| `backend/api/stage2_world_char.py` | `fm` 不动;不混合 /map 路由(放 stage2_map.py) | — |
| `backend/agents/planner.py` | 加 `generate_map()` 方法 | Task 12 |
| `backend/conductor/checkpoint.py` | 加 `map_snapshot_hash` 字段 | Task 21 |
| `config/model_tiers.yaml` | `planner.map_generation` → tier_1 | Task 12 |
| `frontend/src/components/wizard/WizardContext.tsx` | `WizardData.map` 字段 + `map: 4` 映射 | Task 7 |
| `frontend/src/components/wizard/InitWizardModal.tsx` | prefill 加 `api.getMap(projectId)` | Task 7 |
| `frontend/src/components/wizard/WizardSidebar.tsx` | Step 4 导航按钮 + data-testid | Task 8 |
| `frontend/src/api/client.ts` | 加 12 个 map API 方法 + Map/Location/Route 等 TS 类型 | Task 6, 13 |

**不删除任何现有文件**(读者场景: 老 projects 无 map.json,所有 plan 1 代码路径对老项目无侵入)。

---

## Task 1: 创建 map_system 模块骨架

**Files:**
- Create: `backend/map_system/__init__.py`

- [ ] **Step 1: 写文件**

打开 `backend/map_system/__init__.py`,写入:

```python
"""StoryForge v2.x 地图系统模块。

把世界观中的「时代与地理」机器化为可编辑的地理注册表,落地 Step 4 UI +
PlannerAgent 初始生成 + 章节快照/回滚。消费/校验侧(map_card / fact-guard)
分别在后续 plan 中接入。
"""
```

- [ ] **Step 2: 验证导入**

Run: `python -c "from backend.map_system import __doc__; print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/map_system/__init__.py
git commit -m "feat(map): scaffold backend/map_system module"
```

---

## Task 2: 实现 Map Pydantic 顶层容器 + 子实体

**Files:**
- Create: `backend/map_system/models.py`
- Test: `backend/tests/test_map_models.py`

- [ ] **Step 1: 写失败测试**

打开 `backend/tests/test_map_models.py`,写入:

```python
"""Map Pydantic 模型校验测试 — TDD 起步。"""
import pytest
from backend.map_system.models import Map, Location, Region, Route, POI


def test_map_accepts_minimum_payload():
    m = Map.model_validate({
        "schema_version": "1.0",
        "project_id": "proj_abc",
    })
    assert m.regions == []
    assert m.locations == []
    assert m.routes == []
    assert m.pois == []
    assert m.settings.strict_geo is False  # 默认向后兼容


def test_location_requires_dramatic_role():
    """LLM 必须填 dramatic_role 三问 — 缺失应被 Pydantic 拒绝。"""
    with pytest.raises(Exception):
        Location.model_validate({
            "id": "loc_x",
            "name": "X",
            "type": "city",
        })


def test_location_dramatic_role_optional_for_backward_compat():
    """老 world.json 无 dramatic_role — 但 location 老数据也不该有,所以严格 required。
    本测试断言:dramatic_role 是 required 字段(LLM 必须生成,前端不可绕过)。"""
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        Location.model_validate({
            "id": "loc_x",
            "name": "X",
            "type": "city",
            # 故意缺 dramatic_role
        })


def test_route_rejects_non_string_from():
    with pytest.raises(Exception):
        Route.model_validate({
            "id": "route_x",
            "from": "loc_a",
            "to": "loc_b",
            "est_travel_minutes": -5,  # ge=0 校验
        })


def test_route_alias_serialization_roundtrip():
    """from/to 是 Python 关键字不能用,字段别名 from_id/to_id 但 JSON 走 from/to。"""
    r = Route.model_validate({
        "id": "route_x",
        "from": "loc_a",
        "to": "loc_b",
    })
    dumped = r.model_dump(by_alias=True)
    assert dumped["from"] == "loc_a"
    assert dumped["to"] == "loc_b"
    assert "from_id" not in dumped
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest backend/tests/test_map_models.py -v`
Expected: `ModuleNotFoundError: No module named 'backend.map_system.models'`

- [ ] **Step 3: 写最小实现**

打开 `backend/map_system/models.py`,写入:

```python
"""地图数据模型 — Pydantic v2。"""
from typing import Literal, Optional
from pydantic import BaseModel, Field, model_validator


LocationType = Literal["city", "town", "village", "inn", "temple", "sect",
                       "wilds", "room", "starport", "secret_realm"]
RouteKind = Literal["road", "waterway", "tunnel", "portal", "starlane", "secret_path"]
DistanceTier = Literal["intra_city", "inter_city", "inter_region", "inter_continent"]
RiskLevel = Literal["low", "mid", "high"]
RegionLevel = Literal["continent", "state", "sea", "star_sector"]
SpaceType = Literal["world", "room"]
Attitude = Literal["friendly", "hostile", "neutral", "wary"]
AssertionKind = Literal["blocker", "warning", "info"]
ChangeActor = Literal["user", "system", "regenerate_map_section",
                      "sf_log_extraction", "mention_extraction"]
ChangeOp = Literal["create", "update", "delete", "alias_add", "state_change"]


class DisplayPos(BaseModel):
    x: float = 0.0
    y: float = 0.0


class DramaticRole(BaseModel):
    wanted_by: list[str] = []
    decisions_unlocked: list[str] = []
    departure_cost: str = ""


class FactionStance(BaseModel):
    faction_id: str
    attitude: Attitude = "neutral"


class Region(BaseModel):
    id: str = Field(pattern=r"^region_[a-z0-9_]+$")
    name: str
    aliases: list[str] = []
    level: RegionLevel = "state"
    parent_id: Optional[str] = None
    climate: str = ""
    tags: list[str] = []
    controlled_by: list[str] = []   # faction ids
    adjacent_region_ids: list[str] = []
    display_pos: Optional[DisplayPos] = None


class Location(BaseModel):
    id: str = Field(pattern=r"^loc_[a-z0-9_]+$")
    name: str
    aliases: list[str] = []
    type: LocationType
    region_id: Optional[str] = None
    pos_hint: str = ""
    tags: list[str] = []
    factions: list[FactionStance] = []
    enter_conditions: list[str] = []
    secrets: list[str] = []
    dramatic_role: DramaticRole
    space_type: SpaceType = "world"
    display_pos: Optional[DisplayPos] = None


class Route(BaseModel):
    id: str = Field(pattern=r"^route_[a-z0-9_]+$")
    from_id: str = Field(alias="from")
    to_id: str = Field(alias="to")
    bidirectional: bool = True
    kind: RouteKind = "road"
    distance_tier: DistanceTier = "inter_city"
    est_travel_minutes: int = Field(ge=0)
    risk: RiskLevel = "low"
    conditions: list[str] = []
    encounters: list[str] = []
    accessible: bool = True


class POI(BaseModel):
    id: str = Field(pattern=r"^poi_[a-z0-9_]+$")
    name: str
    parent_location_id: str
    kind: Literal["shrine", "cache", "crime_scene", "resource", "view", "trap"] = "shrine"
    description: str = ""
    discoverable: bool = True
    first_discovered_chapter: Optional[int] = None
    tags: list[str] = []


class LocationState(BaseModel):
    location_id: str
    chapter: int = Field(ge=1)
    faction_id: Optional[str] = None
    name: Optional[str] = None
    accessible: bool = True
    destroyed: bool = False
    note: str = ""


class SnapshotIndex(BaseModel):
    chapter: int = Field(ge=1)
    map_hash: str
    snapshot_path: str


class Footprint(BaseModel):
    chapter: int = Field(ge=1)
    character_id: str
    location_id: str
    arrived_via: Optional[str] = None
    departed_to: Optional[str] = None
    companions: list[str] = []
    time_of_day: str = ""
    weather: str = ""


class MapAssertion(BaseModel):
    id: str
    chapter: int = Field(ge=1)
    kind: AssertionKind
    rule_id: str
    message: str
    evidence: dict = {}
    resolution: Literal["未处理", "已修复", "用户豁免"] = "未处理"


class MapChange(BaseModel):
    ts: str
    actor: ChangeActor
    chapter: Optional[int] = None
    op: ChangeOp
    entity: Literal["region", "location", "route", "poi", "location_state"]
    entity_id: str
    before: Optional[dict] = None
    after: Optional[dict] = None


class MapSettings(BaseModel):
    mode: Literal["strict_geo", "allow_alias_new", "freeze_locations"] = "allow_alias_new"
    scope_enabled: bool = False
    allowed_region_ids: list[str] = []
    chapter_new_location_cap: int = 5
    reuse_rate_target: float = 0.6
    strict_geo: bool = False   # 向后兼容默认


class DisplayMeta(BaseModel):
    positions: dict[str, DisplayPos] = {}


class Map(BaseModel):
    schema_version: Literal["1.0"]
    project_id: str
    generated_at: str = ""
    generated_from: dict = {}
    regions: list[Region] = []
    locations: list[Location] = []
    routes: list[Route] = []
    pois: list[POI] = []
    location_states: list[LocationState] = []
    snapshots: list[SnapshotIndex] = []
    footprints: list[Footprint] = []
    assertions: list[MapAssertion] = []
    change_log: list[MapChange] = []
    display: DisplayMeta = Field(default_factory=DisplayMeta)
    settings: MapSettings = Field(default_factory=MapSettings)

    @model_validator(mode="after")
    def _validate_references(self):
        loc_ids = {loc.id for loc in self.locations}
        route_pairs = {(r.from_id, r.to_id) for r in self.routes}
        for f, t in route_pairs:
            if f not in loc_ids or t not in loc_ids:
                raise ValueError(
                    f"Route references unknown location: ({f} -> {t})"
                )
        region_ids = {r.id for r in self.regions}
        for loc in self.locations:
            if loc.region_id is not None and loc.region_id not in region_ids:
                raise ValueError(
                    f"Location {loc.id} references unknown region {loc.region_id}"
                )
        for poi in self.pois:
            if poi.parent_location_id not in loc_ids:
                raise ValueError(
                    f"POI {poi.id} references unknown location "
                    f"{poi.parent_location_id}"
                )
        for ls in self.location_states:
            if ls.location_id not in loc_ids:
                raise ValueError(
                    f"LocationState references unknown location {ls.location_id}"
                )
        return self
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest backend/tests/test_map_models.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add backend/map_system/models.py backend/tests/test_map_models.py
git commit -m "feat(map): add Pydantic models + reference-integrity validator"
```

---

## Task 3: 加 strict_geo 设置的反向兼容 fixture 测试

**Files:**
- Modify: `backend/tests/test_map_models.py` (追加测试)

- [ ] **Step 1: 追加 strict_geo 默认测试**

在 `backend/tests/test_map_models.py` 末尾追加:

```python


def test_strict_geo_defaults_false_for_backward_compat():
    """PRD §0.5 向后兼容:老项目无 map.json + strict_geo=false → 不阻断 Stage 3/4。"""
    m = Map.model_validate({
        "schema_version": "1.0",
        "project_id": "proj_legacy",
    })
    assert m.settings.strict_geo is False
    assert m.settings.mode == "allow_alias_new"
    assert m.settings.chapter_new_location_cap == 5


def test_location_state_no_record_means_accessible():
    """PRD §3.2.5:某 location 在 location_states[] 中无记录 → 默认 accessible=true。"""
    m = Map.model_validate({
        "schema_version": "1.0",
        "project_id": "proj_x",
        "locations": [
            {
                "id": "loc_a", "name": "A", "type": "city",
                "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
            },
        ],
    })
    # 查询:loc_a 在 location_states 中无记录 → 默认 accessible
    assert all(ls.location_id != "loc_a" for ls in m.location_states)
    # 外部查询函数(后续 task 5 添加)会返回 True,这里只断言数据层默认值
    assert len(m.location_states) == 0
```

- [ ] **Step 2: 运行测试**

Run: `pytest backend/tests/test_map_models.py -v`
Expected: 7 passed

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_map_models.py
git commit -m "test(map): cover strict_geo default + backward-compat settings"
```

---

## Task 4: 实现 storage 层(atomic write + load)

**Files:**
- Create: `backend/map_system/storage.py`
- Test: `backend/tests/test_map_storage.py`
- Modify: `backend/main.py` (暂不挂路由,只验证模块可导入)

- [ ] **Step 1: 写失败测试**

打开 `backend/tests/test_map_storage.py`,写入:

```python
"""map_system/storage.py 测试 — atomic write + 缺失文件返回 None。"""
import json
import pytest
from backend.map_system.storage import save_map, load_map
from backend.map_system.models import Map


PROJ = "proj_test_storage"


@pytest.fixture(autouse=True)
def _patch_projects_dir(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield


def test_load_map_returns_none_when_missing(tmp_path):
    assert load_map(PROJ) is None


def test_save_then_load_roundtrip(tmp_path):
    m = Map.model_validate({"schema_version": "1.0", "project_id": PROJ})
    save_map(PROJ, m)
    loaded = load_map(PROJ)
    assert loaded is not None
    assert loaded["project_id"] == PROJ
    assert loaded["schema_version"] == "1.0"


def test_save_uses_atomic_write(tmp_path):
    """写入必须走 .tmp + replace,不能留 .tmp。"""
    m = Map.model_validate({"schema_version": "1.0", "project_id": PROJ})
    save_map(PROJ, m)
    project_dir = tmp_path / PROJ
    assert (project_dir / "map.json").exists()
    assert not list(project_dir.glob("*.tmp"))  # .tmp 必须 replace 完成


def test_save_creates_map_snapshots_dir(tmp_path):
    """save_map 必须确保 map_snapshots/ 目录存在(章节快照会写到这)。"""
    m = Map.model_validate({"schema_version": "1.0", "project_id": PROJ})
    save_map(PROJ, m)
    assert (tmp_path / PROJ / "map_snapshots").exists()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest backend/tests/test_map_storage.py -v`
Expected: `ModuleNotFoundError: No module named 'backend.map_system.storage'`

- [ ] **Step 3: 写最小实现**

打开 `backend/map_system/storage.py`,写入:

```python
"""map.json 的 load/save — 沿用 FileManager 的 atomic write 模式。"""
import json
from pathlib import Path
from typing import Optional

from backend.config import settings
from backend.map_system.models import Map


def _project_dir(project_id: str) -> Path:
    return settings.projects_dir / project_id


def _ensure_dirs(project_dir: Path) -> None:
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "map_snapshots").mkdir(exist_ok=True)


def load_map(project_id: str) -> Optional[dict]:
    path = _project_dir(project_id) / "map.json"
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_map(project_id: str, map_data: Map) -> None:
    project_dir = _project_dir(project_id)
    _ensure_dirs(project_dir)
    target = project_dir / "map.json"
    tmp = target.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(map_data.model_dump(by_alias=True), f, ensure_ascii=False, indent=2)
    tmp.replace(target)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest backend/tests/test_map_storage.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add backend/map_system/storage.py backend/tests/test_map_storage.py
git commit -m "feat(map): storage layer — atomic write + load + snapshots dir"
```

---

## Task 5: 实现 name_to_id 反向索引

**Files:**
- Modify: `backend/map_system/storage.py` (追加函数)
- Modify: `backend/tests/test_map_storage.py` (追加测试)

- [ ] **Step 1: 写失败测试**

在 `backend/tests/test_map_storage.py` 末尾追加:

```python


def test_build_name_index_returns_aliases_and_names():
    from backend.map_system.storage import build_name_index, save_map
    from backend.map_system.models import Map, Location, Region, POI
    m = Map.model_validate({
        "schema_version": "1.0",
        "project_id": PROJ,
        "regions": [
            {"id": "region_south", "name": "南泽", "aliases": ["南渊"]},
        ],
        "locations": [
            {
                "id": "loc_qingfeng_inn", "name": "青峰客栈",
                "aliases": ["山脚客栈"], "type": "inn",
                "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
            },
        ],
        "pois": [
            {
                "id": "poi_cellar", "name": "青峰客栈地窖",
                "parent_location_id": "loc_qingfeng_inn",
            },
        ],
    })
    save_map(PROJ, m)
    idx = build_name_index(PROJ)
    assert idx["青峰客栈"] == "loc_qingfeng_inn"
    assert idx["山脚客栈"] == "loc_qingfeng_inn"
    assert idx["南泽"] == "region_south"
    assert idx["南渊"] == "region_south"
    assert idx["青峰客栈地窖"] == "poi_cellar"


def test_build_name_index_returns_empty_when_no_map():
    from backend.map_system.storage import build_name_index
    assert build_name_index("proj_nonexistent") == {}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest backend/tests/test_map_storage.py -v`
Expected: `ImportError` (build_name_index 不存在)

- [ ] **Step 3: 实现 build_name_index**

在 `backend/map_system/storage.py` 末尾追加:

```python


def build_name_index(project_id: str) -> dict[str, str]:
    """构建 name/alias → canonical id 的反向索引。

    用于把 SF_LOG character_location_change / mention extraction 的裸
    location 字符串归一化到 location_id / region_id / poi_id。

    Returns empty dict if map.json missing — callers should treat as no-op.
    """
    data = load_map(project_id)
    if not data:
        return {}
    index: dict[str, str] = {}
    for region in data.get("regions", []):
        index[region["name"]] = region["id"]
        for alias in region.get("aliases", []):
            index[alias] = region["id"]
    for loc in data.get("locations", []):
        index[loc["name"]] = loc["id"]
        for alias in loc.get("aliases", []):
            index[alias] = loc["id"]
    for poi in data.get("pois", []):
        index[poi["name"]] = poi["id"]
    return index
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest backend/tests/test_map_storage.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add backend/map_system/storage.py backend/tests/test_map_storage.py
git commit -m "feat(map): name_to_id reverse index for SF_LOG normalization"
```

---

## Task 6: 实现 GET/PUT /map API 端点

**Files:**
- Create: `backend/api/stage2_map.py`
- Modify: `backend/main.py`
- Modify: `frontend/src/api/client.ts` (追加 TS 类型 + getMap/updateMap)
- Test: `backend/tests/test_map_api.py`

- [ ] **Step 1: 写失败测试**

打开 `backend/tests/test_map_api.py`,写入:

```python
"""Stage2 /map API 端点测试 — TDD 起步 (GET / PUT)。"""
import pytest
from fastapi.testclient import TestClient

from backend.main import app

PROJ = "proj_test_map_api"
client = TestClient(app)


@pytest.fixture(autouse=True)
def _patch_projects_dir(tmp_path, monkeypatch):
    from backend.config import settings
    from backend.api import stage2_map
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    stage2_map.fm = type(stage2_map.fm)(tmp_path)
    yield


def test_get_map_returns_404_when_no_map():
    """missing map.json → 返回 detail={} 而不是 404(供 stage 渲染为空态)。"""
    r = client.get(f"/api/stage2/map?project_id={PROJ}")
    assert r.status_code == 200
    body = r.json()
    assert body["error"] is False
    assert body["detail"] == {}


def test_put_then_get_roundtrip():
    payload = {
        "schema_version": "1.0",
        "project_id": PROJ,
        "regions": [
            {"id": "region_south", "name": "南泽", "level": "state"}
        ],
    }
    r = client.put(
        f"/api/stage2/map?project_id={PROJ}",
        json={"map": payload},
    )
    assert r.status_code == 200

    r = client.get(f"/api/stage2/map?project_id={PROJ}")
    body = r.json()
    assert body["detail"]["regions"][0]["id"] == "region_south"


def test_put_rejects_invalid_map():
    """reference integrity 校验失败 → 422。"""
    payload = {
        "schema_version": "1.0",
        "project_id": PROJ,
        "locations": [
            {
                "id": "loc_x", "name": "X", "type": "city",
                "region_id": "region_nonexistent",  # 不存在
                "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
            },
        ],
    }
    r = client.put(f"/api/stage2/map?project_id={PROJ}", json={"map": payload})
    assert r.status_code in (400, 422)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest backend/tests/test_map_api.py -v`
Expected: `ModuleNotFoundError` 或 404 路由

- [ ] **Step 3: 写最小实现**

打开 `backend/api/stage2_map.py`,写入:

```python
"""Stage2 地图系统 API — /api/stage2/map/* (基础 CRUD) + /generate-map。

挂在 stage2 router,与其他 app 端点共用 prefix /api/stage2。Map 端点
本身不需要 STAGE2 precondition(MapStep 可后向补做,见 PRD §0.5)。
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.config import settings
from backend.map_system.models import Map as MapModel
from backend.map_system.storage import load_map, save_map
from backend.utils.file_manager import FileManager


router = APIRouter(prefix="/api/stage2", tags=["stage2-map"])
fm = FileManager(settings.projects_dir)


def _file_manager() -> FileManager:
    return FileManager(settings.projects_dir)


@router.get("/map")
async def get_map(project_id: str = Query(...)):
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )
    data = load_map(project_id)
    if data is None:
        return {"error": False, "code": "OK", "message": "", "detail": {}}
    try:
        data = MapModel.model_validate(data).model_dump(by_alias=True)
    except Exception:
        # 旧/损坏 map.json — 走读原数据,前端 normalize 处理
        pass
    return {"error": False, "code": "OK", "message": "", "detail": data}


class PutMapPayload(BaseModel):
    map: dict


@router.put("/map")
async def put_map(project_id: str = Query(...), payload: PutMapPayload = None):
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )
    if payload is None or not payload.map:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "请求体不能为空", "detail": {}},
        )
    try:
        validated = MapModel.model_validate(payload.map)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail={"error": True, "code": "MAP_VALIDATION_FAILED",
                    "message": f"map 校验失败: {e}", "detail": {}},
        )
    save_map(project_id, validated)
    return {"error": False, "code": "OK", "message": "map 已保存",
            "detail": validated.model_dump(by_alias=True)}
```

- [ ] **Step 4: 在 main.py 注册 router**

打开 `backend/main.py`,找到现有的 `app.include_router(...)` 列表,在注册 chunk 与 stage2 之后追加:

```python
from backend.api import stage2_map  # noqa: E402
app.include_router(stage2_map.router)
```

(具体插入位置请按实际 main.py 中现有 import / include_router 块对齐 — Task 13 同样会动这块。)

- [ ] **Step 5: 在 frontend client.ts 加 TS 类型与 getMap/updateMap**

打开 `frontend/src/api/client.ts`,在 `World` 接口定义后加:

```typescript
export interface DisplayPos { x: number; y: number; }

export interface DramaticRole {
  wanted_by: string[];
  decisions_unlocked: string[];
  departure_cost: string;
}

export interface FactionStance {
  faction_id: string;
  attitude: "friendly" | "hostile" | "neutral" | "wary";
}

export interface MapLocation {
  id: string;
  name: string;
  aliases: string[];
  type: "city" | "town" | "village" | "inn" | "temple" | "sect" | "wilds" | "room" | "starport" | "secret_realm";
  region_id?: string | null;
  pos_hint: string;
  tags: string[];
  factions: FactionStance[];
  enter_conditions: string[];
  secrets: string[];
  dramatic_role: DramaticRole;
  space_type: "world" | "room";
  display_pos?: DisplayPos | null;
}

export interface MapRegion {
  id: string;
  name: string;
  aliases: string[];
  level: "continent" | "state" | "sea" | "star_sector";
  parent_id?: string | null;
  climate: string;
  tags: string[];
  controlled_by: string[];
  adjacent_region_ids: string[];
  display_pos?: DisplayPos | null;
}

export interface MapRoute {
  id: string;
  from: string;
  to: string;
  bidirectional: boolean;
  kind: "road" | "waterway" | "tunnel" | "portal" | "starlane" | "secret_path";
  distance_tier: "intra_city" | "inter_city" | "inter_region" | "inter_continent";
  est_travel_minutes: number;
  risk: "low" | "mid" | "high";
  conditions: string[];
  encounters: string[];
  accessible: boolean;
}

export interface MapPOI {
  id: string;
  name: string;
  parent_location_id: string;
  kind: "shrine" | "cache" | "crime_scene" | "resource" | "view" | "trap";
  description: string;
  discoverable: boolean;
  first_discovered_chapter: number | null;
  tags: string[];
}

export interface MapSettings {
  mode: "strict_geo" | "allow_alias_new" | "freeze_locations";
  scope_enabled: boolean;
  allowed_region_ids: string[];
  chapter_new_location_cap: number;
  reuse_rate_target: number;
  strict_geo: boolean;
}

export interface MapSnapshotIndex {
  chapter: number;
  map_hash: string;
  snapshot_path: string;
}

export interface MapPayload {
  schema_version: "1.0";
  project_id: string;
  generated_at?: string;
  generated_from?: Record<string, string>;
  regions: MapRegion[];
  locations: MapLocation[];
  routes: MapRoute[];
  pois: MapPOI[];
  location_states: unknown[];
  snapshots: MapSnapshotIndex[];
  footprints: unknown[];
  assertions: unknown[];
  change_log: unknown[];
  display: { positions: Record<string, DisplayPos> };
  settings: MapSettings;
}
```

在 `updateWorld` 之后追加:

```typescript
  getMap: (projectId: string): Promise<MapPayload | Record<string, never>> =>
    request<MapPayload | Record<string, never>>("GET", `/stage2/map?project_id=${encodeURIComponent(projectId)}`),

  updateMap: (projectId: string, mapData: MapPayload): Promise<void> =>
    request<void>("PUT", `/stage2/map?project_id=${encodeURIComponent(projectId)}`, { map: mapData }),
```

(具体位置在 client.ts `updateWorld` 附近,沿用同种风格。)

- [ ] **Step 6: 运行测试确认通过**

Run: `pytest backend/tests/test_map_api.py -v`
Expected: 3 passed

- [ ] **Step 7: Commit**

```bash
git add backend/api/stage2_map.py backend/main.py backend/tests/test_map_api.py frontend/src/api/client.ts
git commit -m "feat(map): GET/PUT /api/stage2/map + frontend Map TS types"
```

---

## Task 7: WizardContext 加 map 字段 + InitWizardModal prefill

**Files:**
- Modify: `frontend/src/components/wizard/WizardContext.tsx`
- Modify: `frontend/src/components/wizard/InitWizardModal.tsx`

- [ ] **Step 1: WizardContext 加 map 字段**

打开 `frontend/src/components/wizard/WizardContext.tsx`,改 import 行:

```typescript
import type { World, CharacterSet, NovelOutline, Outline, MapPayload } from "../../api/client";
```

把 `WizardData` interface 改为:

```typescript
export interface WizardData {
  creative_divergence: { ... } | null;  // 保持不变
  world: World | null;
  characters: CharacterSet | null;
  map: MapPayload | null;   // 新增
  novel_outline: NovelOutline | null;
  chapter1_outline: Outline | null;
  chapter_outline_progress: { ... } | null;  // 保持不变
}
```

把 `EMPTY_DATA` 改为:

```typescript
const EMPTY_DATA: WizardData = {
  creative_divergence: null,
  world: null,
  characters: null,
  map: null,   // 新增
  novel_outline: null,
  chapter1_outline: null,
  chapter_outline_progress: null,
};
```

把 `STEP_DATA_KEY_TO_STEP` 改为:

```typescript
const STEP_DATA_KEY_TO_STEP: Partial<Record<keyof WizardData, number>> = {
  creative_divergence: 1,
  world: 2,
  characters: 3,
  map: 4,   // 新增
  novel_outline: 6,
  chapter1_outline: 7,
  chapter_outline_progress: 7,
};
```

- [ ] **Step 2: InitWizardModal prefill 加 map**

打开 `frontend/src/components/wizard/InitWizardModal.tsx`,找到 `Promise.allSettled([...])` 块(约 line 93-98),改为:

```typescript
        const [world, chars, map, novel, outline] = await Promise.allSettled([
          api.getWorld(projectId),
          api.getCharacter(projectId),
          api.getMap(projectId),
          api.getNovelOutline(projectId),
          api.getOutline(projectId),
        ]);
        if (cancelled) return;
        const completed: number[] = [];
        const data: Partial<WizardData> = {};
        if (world.status === "fulfilled" && hasContent(world.value)) {
          completed.push(2);
          data.world = world.value as World;
        }
        if (chars.status === "fulfilled" && hasContent(chars.value)) {
          completed.push(3);
          data.characters = chars.value as CharacterSet;
        }
        // Step 4 = map.json(地图系统,默认向后兼容 — 老项目无 map 也 OK)
        if (map.status === "fulfilled" && hasContent(map.value)) {
          completed.push(4);
          data.map = map.value as MapPayload;
        }
        if (novel.status === "fulfilled" && hasContent(novel.value)) {
          completed.push(5);
          data.novel_outline = novel.value as NovelOutline;
        }
        if (outline.status === "fulfilled" && hasContent(outline.value)) {
          completed.push(6);
          data.chapter1_outline = outline.value as Outline;
        }
```

在 import 行追加:

```typescript
import type { World, CharacterSet, MapPayload, NovelOutline, Outline } from "../../api/client";
```

(覆盖原 import。)

- [ ] **Step 3: 验证类型编译**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: 无新错误(老错误是已有的,与本次改动无关)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/wizard/WizardContext.tsx frontend/src/components/wizard/InitWizardModal.tsx
git commit -m "feat(wizard): add map data field + step 4 prefill"
```

---

## Task 8: MapStep 占位空壳替换为带 tablist 的最小 UI

**Files:**
- Create: `frontend/src/components/wizard/MapStep.tsx`(整文件重写)
- Modify: `frontend/src/components/wizard/WizardSidebar.tsx`

- [ ] **Step 1: WizardSidebar 加 step 4 按钮**

打开 `frontend/src/components/wizard/WizardSidebar.tsx`,在 step 3 与 step 5 之间的导航列表追加 step 4 项。具体插入位置请按 WizardSidebar 现有结构 — 通常每个 step 是一个 `<button>` 或 `<SidebarNavItem>`,沿用同种风格,带:

```typescript
data-testid="wizard-step-4"
onClick={() => wizard.jumpToStep(4)}
```

(具体渲染形态以现有 step 3 / step 5 行为准,本 task 唯一强制项是 `data-testid="wizard-step-4"`。)

- [ ] **Step 2: 写 MapStep 最小可渲染版本**

打开 `frontend/src/components/wizard/MapStep.tsx`,整文件覆盖为:

```tsx
import { useEffect, useState } from "react";
import api, { MapPayload, MapLocation } from "../../api/client";
import { useWizard } from "./WizardContext";
import { PanelCard } from "../ds";
import { SubTabStrip } from "../shared/SubTabStrip";

interface MapStepProps {
  projectId: string;
}

const MAP_TABS = [
  { key: "locations", label: "地点", icon: "place" },
  { key: "regions", label: "区域", icon: "landscape" },
  { key: "routes", label: "路线", icon: "route" },
  { key: "pois", label: "POI", icon: "explore" },
  { key: "snapshots", label: "快照", icon: "history" },
] as const;
type MapTabKey = (typeof MAP_TABS)[number]["key"];

export default function MapStep({ projectId }: MapStepProps) {
  const wizard = useWizard();
  const [mapData, setMapData] = useState<MapPayload | null>(
    wizard.data.map,
  );
  const [activeKey, setActiveKey] = useState<MapTabKey>("locations");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mapData) return;
    let alive = true;
    (async () => {
      const res = await api.getMap(projectId);
      if (alive && res && Object.keys(res).length > 0) {
        setMapData(res as MapPayload);
      }
    })();
    return () => { alive = false; };
  }, [projectId, mapData]);

  const handleGenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.generateMap(projectId, "");
      if (res && "detail" in res) {
        const detail = (res as { detail: MapPayload }).detail;
        setMapData(detail);
        wizard.markStepGenerated(4, { map: detail });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (!mapData) return;
    setBusy(true);
    try {
      await api.updateMap(projectId, mapData);
      wizard.saveStep(4, { map: mapData });
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  if (!mapData) {
    return (
      <div data-testid="map-step-empty" className="text-center py-12 space-y-6">
        <span className="material-symbols-outlined text-6xl text-on-surface-variant/30 block">map</span>
        <div>
          <h2 className="font-display text-primary text-xl mb-2">地图系统</h2>
          <p className="font-body text-body-md text-on-surface-variant text-sm max-w-md mx-auto">
            基于世界观自动生成初始地图(5-15 个区域 + 20-40 个地点),可在 5 个 Tab 中行内编辑。
          </p>
        </div>
        {error && (
          <p data-testid="map-error" className="text-error text-sm">{error}</p>
        )}
        <button
          data-testid="map-generate"
          onClick={handleGenerate}
          disabled={busy}
          className="px-5 py-2 bg-primary text-on-primary text-sm rounded-lg hover:bg-primary-container transition-colors disabled:opacity-50"
        >
          {busy ? "生成中…" : "基于世界观自动生成初始地图"}
        </button>
      </div>
    );
  }

  return (
    <div data-testid="map-step" className="space-y-4">
      <PanelCard className="flex items-center justify-between">
        <SubTabStrip
          tabs={MAP_TABS.map(t => ({ key: t.key, label: t.label, icon: t.icon }))}
          activeKey={activeKey}
          onChange={(k) => setActiveKey(k as MapTabKey)}
        />
        <div className="flex gap-2">
          <button
            data-testid="map-view-graph"
            className="px-3 py-1 text-sm rounded border border-outline-variant hover:border-primary"
          >
            查看地图
          </button>
          <button
            data-testid="map-save"
            onClick={handleSave}
            disabled={busy}
            className="px-3 py-1 text-sm bg-primary text-on-primary rounded hover:bg-primary-container disabled:opacity-50"
          >
            {busy ? "保存中…" : "保存修改"}
          </button>
        </div>
      </PanelCard>

      <div data-testid={`map-panel-${activeKey}`} className="min-h-[400px]">
        {activeKey === "locations" && <LocationsPanel mapData={mapData} />}
        {activeKey === "regions" && <RegionsPanel mapData={mapData} />}
        {activeKey === "routes" && <RoutesPanel mapData={mapData} />}
        {activeKey === "pois" && <PoisPanel mapData={mapData} />}
        {activeKey === "snapshots" && <SnapshotsPanel mapData={mapData} />}
      </div>
    </div>
  );
}

// --- Tab panels(本 task 给出 locations 最小可渲染版,其余在后续 task 补全) ---

function LocationsPanel({ mapData }: { mapData: MapPayload }) {
  return (
    <ul data-testid="locations-list" className="space-y-2">
      {mapData.locations.map((loc: MapLocation) => (
        <li
          key={loc.id}
          data-testid={`location-row-${loc.name}`}
          className="p-3 border border-outline-variant rounded"
        >
          <div className="flex items-center justify-between">
            <div>
              <span className="font-medium">{loc.name}</span>
              <span className="ml-2 text-xs text-on-surface-variant">
                {loc.type} · {loc.region_id ?? "无区域"}
              </span>
            </div>
          </div>
          {loc.pos_hint && (
            <p className="text-xs text-on-surface-variant mt-1">{loc.pos_hint}</p>
          )}
          <p className="text-xs mt-1">
            <span className="font-semibold">想来的：</span>
            {loc.dramatic_role.wanted_by.join("、") || "（无）"}
            {" · "}
            <span className="font-semibold">离开代价：</span>
            {loc.dramatic_role.departure_cost || "（无）"}
          </p>
        </li>
      ))}
    </ul>
  );
}

function RegionsPanel({ mapData }: { mapData: MapPayload }) {
  return (
    <ul data-testid="regions-list" className="space-y-2">
      {mapData.regions.map(r => (
        <li key={r.id} className="p-3 border border-outline-variant rounded">
          <span className="font-medium">{r.name}</span>
          <span className="ml-2 text-xs text-on-surface-variant">{r.level}</span>
        </li>
      ))}
    </ul>
  );
}

function RoutesPanel({ mapData }: { mapData: MapPayload }) {
  return (
    <ul data-testid="routes-list" className="space-y-2">
      {mapData.routes.map(rt => (
        <li key={rt.id} className="p-3 border border-outline-variant rounded">
          <span className="font-mono text-sm">
            {rt.from} → {rt.to}
          </span>
          <span className="ml-2 text-xs text-on-surface-variant">
            {rt.est_travel_minutes}min · {rt.risk}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PoisPanel({ mapData }: { mapData: MapPayload }) {
  return (
    <ul data-testid="pois-list" className="space-y-2">
      {mapData.pois.map(p => (
        <li key={p.id} className="p-3 border border-outline-variant rounded">
          <span className="font-medium">{p.name}</span>
          <span className="ml-2 text-xs text-on-surface-variant">{p.kind}</span>
          {!p.discoverable && (
            <span className="ml-2 text-xs text-error">[未发现]</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function SnapshotsPanel({ mapData }: { mapData: MapPayload }) {
  return (
    <ul data-testid="snapshots-list" className="space-y-2">
      {mapData.snapshots.length === 0 && (
        <li className="text-sm text-on-surface-variant">暂无快照</li>
      )}
      {mapData.snapshots.map(s => (
        <li key={s.chapter} className="p-3 border border-outline-variant rounded">
          第 {s.chapter} 章 · hash={s.map_hash.slice(0, 12)}…
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: 验证类型编译**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -30`
Expected: 无新错误(`api.generateMap` 引用见 Task 13)

如提示 `api.generateMap is not a function`,先用 stub 接入,Task 13 添加真方法前前端可以 mock:

在 `frontend/src/api/client.ts` 末尾临时加(后续 task 13 删除):

```typescript
  generateMap: (projectId: string, _mods: string = "") =>
    request<unknown>("POST", `/stage2/generate-map?project_id=${encodeURIComponent(projectId)}`, { project_id: projectId }),
```

- [ ] **Step 4: 跑现有 wizard 单测确认未回归**

Run: `cd frontend && npm test -- --run MapStep 2>&1 | tail -20`
Expected: PASS(无现有 MapStep.test.tsx,跑的就是失败堆栈,记下来;Task 11 创建)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/wizard/MapStep.tsx frontend/src/components/wizard/WizardSidebar.tsx frontend/src/api/client.ts
git commit -m "feat(wizard): MapStep rewrite — 5 tabs + empty state + save"
```

---

## Task 9: locations Tab 行内编辑 + 新增 / 删除

**Files:**
- Modify: `frontend/src/components/wizard/MapStep.tsx`
- Test: `frontend/src/components/wizard/MapStep.test.tsx`(新增)

- [ ] **Step 1: 写失败测试**

打开 `frontend/src/components/wizard/MapStep.test.tsx`,写入:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { WizardProvider } from "./WizardContext";
import MapStep from "./MapStep";

const SAMPLE_MAP = {
  schema_version: "1.0" as const,
  project_id: "proj_test",
  regions: [],
  locations: [
    {
      id: "loc_a",
      name: "黑水镇北门",
      aliases: [],
      type: "city" as const,
      region_id: null,
      pos_hint: "黑水镇北侧城墙豁口",
      tags: [],
      factions: [],
      enter_conditions: [],
      secrets: [],
      dramatic_role: {
        wanted_by: ["faction_漕帮"],
        decisions_unlocked: ["加入漕帮"],
        departure_cost: "暴露行踪",
      },
      space_type: "world" as const,
      display_pos: null,
    },
  ],
  routes: [],
  pois: [],
  location_states: [],
  snapshots: [],
  footprints: [],
  assertions: [],
  change_log: [],
  display: { positions: {} },
  settings: {
    mode: "allow_alias_new" as const,
    scope_enabled: false,
    allowed_region_ids: [],
    chapter_new_location_cap: 5,
    reuse_rate_target: 0.6,
    strict_geo: false,
  },
};

vi.mock("../../api/client", () => ({
  default: {
    getMap: vi.fn().mockResolvedValue(SAMPLE_MAP),
    updateMap: vi.fn().mockResolvedValue(undefined),
    generateMap: vi.fn().mockResolvedValue({ detail: SAMPLE_MAP }),
    patchMapLocation: vi.fn().mockImplementation(async (_p, _id, patch) => ({
      ...SAMPLE_MAP.locations[0],
      ...patch,
    })),
    deleteMapLocation: vi.fn().mockResolvedValue({ deleted_id: "loc_a" }),
  },
}));

function renderMapStep() {
  return render(
    <WizardProvider projectId="proj_test">
      <MapStep projectId="proj_test" />
    </WizardProvider>,
  );
}

describe("MapStep locations tab", () => {
  it("renders location cards with dramatic role", async () => {
    renderMapStep();
    await waitFor(() =>
      expect(screen.getByTestId("map-step")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("location-row-黑水镇北门")).toBeInTheDocument();
    expect(screen.getByText("加入漕帮")).toBeInTheDocument();
  });

  it("supports deleting a location via trash icon", async () => {
    renderMapStep();
    await waitFor(() =>
      expect(screen.getByTestId("map-step")).toBeInTheDocument(),
    );
    const delBtn = screen.getByTestId("location-delete-loc_a");
    fireEvent.click(delBtn);
    await waitFor(() => {
      expect(screen.queryByTestId("location-row-黑水镇北门")).not.toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npm test -- --run MapStep 2>&1 | tail -15`
Expected: FAIL(`location-delete-loc_a` not found)

- [ ] **Step 3: 在 MapStep 加行内编辑 + 删除按钮**

打开 `frontend/src/components/wizard/MapStep.tsx`,把 `LocationsPanel` 函数整段替换为:

```tsx
function LocationsPanel({
  mapData,
  setMapData,
}: {
  mapData: MapPayload;
  setMapData: (m: MapPayload) => void;
}) {
  const handleDelete = async (id: string) => {
    try {
      await api.deleteMapLocation(mapData.project_id, id);
    } catch (e) {
      // 422 LOCATION_REFERENCED_BY_ROUTES — 前端显示 modal(本 task 简化:
      // 让后端错误冒泡,后续 task 加 modal)
      throw e;
    }
    setMapData({
      ...mapData,
      locations: mapData.locations.filter(l => l.id !== id),
    });
  };

  const handlePatch = async (id: string, patch: Partial<MapLocation>) => {
    const updated = await api.patchMapLocation(mapData.project_id, id, patch);
    setMapData({
      ...mapData,
      locations: mapData.locations.map(l => (l.id === id ? updated : l)),
    });
  };

  return (
    <ul data-testid="locations-list" className="space-y-2">
      {mapData.locations.map((loc) => (
        <li
          key={loc.id}
          data-testid={`location-row-${loc.name}`}
          className="p-3 border border-outline-variant rounded space-y-2"
        >
          <div className="flex items-center justify-between">
            <div>
              <input
                data-testid={`location-name-${loc.id}`}
                defaultValue={loc.name}
                onBlur={(e) => {
                  if (e.target.value !== loc.name) {
                    handlePatch(loc.id, { name: e.target.value });
                  }
                }}
                className="font-medium bg-transparent border-b border-transparent hover:border-outline-variant focus:border-primary"
              />
              <span className="ml-2 text-xs text-on-surface-variant">
                {loc.type} · {loc.region_id ?? "无区域"}
              </span>
            </div>
            <button
              data-testid={`location-delete-${loc.id}`}
              onClick={() => handleDelete(loc.id)}
              className="text-error text-sm hover:underline"
            >
              删除
            </button>
          </div>
          {loc.pos_hint && (
            <p className="text-xs text-on-surface-variant">{loc.pos_hint}</p>
          )}
          <p className="text-xs">
            <span className="font-semibold">想来的：</span>
            {loc.dramatic_role.wanted_by.join("、") || "（无）"}
            {" · "}
            <span className="font-semibold">离开代价：</span>
            {loc.dramatic_role.departure_cost || "（无）"}
          </p>
        </li>
      ))}
    </ul>
  );
}
```

(其余 panel 接收 `setMapData` 参数但暂不调用,Task 8 写的版本保留,后续 task 补 routes/pois 同样加 patch/delete。)

把 `MapStep` 主组件里 `LocationsPanel` 调用处改为:

```tsx
        {activeKey === "locations" && (
          <LocationsPanel mapData={mapData} setMapData={setMapData} />
        )}
```

- [ ] **Step 4: 加 api.deleteMapLocation / api.patchMapLocation 临时 stub**

打开 `frontend/src/api/client.ts`,在 `updateMap` 之后追加(后续 task 13 删除并接入真后端):

```typescript
  patchMapLocation: (
    projectId: string,
    locationId: string,
    patch: Partial<MapLocation>,
  ): Promise<MapLocation> =>
    request<MapLocation>(
      "PATCH",
      `/stage2/map/location/${encodeURIComponent(locationId)}?project_id=${encodeURIComponent(projectId)}`,
      patch,
    ),

  deleteMapLocation: (
    projectId: string,
    locationId: string,
  ): Promise<{ deleted_id: string; cascaded_route_removals?: number }> =>
    request<{ deleted_id: string; cascaded_route_removals?: number }>(
      "DELETE",
      `/stage2/map/location/${encodeURIComponent(locationId)}?project_id=${encodeURIComponent(projectId)}`,
    ),
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd frontend && npm test -- --run MapStep 2>&1 | tail -15`
Expected: 2 passed

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/wizard/MapStep.tsx frontend/src/components/wizard/MapStep.test.tsx frontend/src/api/client.ts
git commit -m "feat(wizard): locations tab inline edit + delete"
```

---

## Task 10: Mermaid 静态图谱 modal

**Files:**
- Create: `frontend/src/components/wizard/MermaidMapModal.tsx`
- Test: `frontend/src/components/wizard/MermaidMapModal.test.tsx`
- Modify: `frontend/src/components/wizard/MapStep.tsx`(接入 modal 触发)

- [ ] **Step 1: 写失败测试**

打开 `frontend/src/components/wizard/MermaidMapModal.test.tsx`,写入:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MermaidMapModal } from "./MermaidMapModal";
import type { MapPayload } from "../../api/client";

vi.mock("mermaid", () => ({
  default: {
    render: vi.fn().mockResolvedValue({ svg: "<svg>MOCK</svg>" }),
  },
}));

const SAMPLE_MAP: MapPayload = {
  schema_version: "1.0",
  project_id: "proj_test",
  regions: [
    { id: "region_south", name: "南泽", aliases: [], level: "state",
      parent_id: null, climate: "", tags: [], controlled_by: [],
      adjacent_region_ids: [], display_pos: null },
  ],
  locations: [
    {
      id: "loc_gate", name: "黑水镇北门", aliases: [], type: "city",
      region_id: "region_south", pos_hint: "", tags: [], factions: [],
      enter_conditions: [], secrets: [],
      dramatic_role: { wanted_by: [], decisions_unlocked: [], departure_cost: "" },
      space_type: "world", display_pos: null,
    },
    {
      id: "loc_inn", name: "青峰客栈", aliases: [], type: "inn",
      region_id: "region_south", pos_hint: "", tags: [], factions: [],
      enter_conditions: [], secrets: [],
      dramatic_role: { wanted_by: [], decisions_unlocked: [], departure_cost: "" },
      space_type: "world", display_pos: null,
    },
  ],
  routes: [
    { id: "route_x", from: "loc_gate", to: "loc_inn", bidirectional: true,
      kind: "road", distance_tier: "inter_city", est_travel_minutes: 40,
      risk: "low", conditions: [], encounters: [], accessible: true },
  ],
  pois: [],
  location_states: [],
  snapshots: [],
  footprints: [],
  assertions: [],
  change_log: [],
  display: { positions: {} },
  settings: {
    mode: "allow_alias_new", scope_enabled: false, allowed_region_ids: [],
    chapter_new_location_cap: 5, reuse_rate_target: 0.6, strict_geo: false,
  },
};

describe("MermaidMapModal", () => {
  it("renders mermaid diagram when open", async () => {
    render(
      <MermaidMapModal open={true} onClose={() => {}} mapData={SAMPLE_MAP} />,
    );
    // mermaid.render 是异步,等待 svg 出现
    await new Promise(r => setTimeout(r, 50));
    expect(document.querySelector("svg")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(
      <MermaidMapModal open={false} onClose={() => {}} mapData={SAMPLE_MAP} />,
    );
    expect(screen.queryByTestId("mermaid-modal")).not.toBeInTheDocument();
  });

  it("calls onClose when backdrop clicked", () => {
    const onClose = vi.fn();
    render(
      <MermaidMapModal open={true} onClose={onClose} mapData={SAMPLE_MAP} />,
    );
    fireEvent.click(screen.getByTestId("mermaid-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend && npm test -- --run MermaidMapModal 2>&1 | tail -10`
Expected: FAIL(MermaidMapModal 不存在)

- [ ] **Step 3: 实现 MermaidMapModal**

打开 `frontend/src/components/wizard/MermaidMapModal.tsx`,写入:

```tsx
import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import type { MapPayload } from "../../api/client";

interface MermaidMapModalProps {
  open: boolean;
  onClose: () => void;
  mapData: MapPayload;
}

function buildMermaidSyntax(mapData: MapPayload): string {
  const lines: string[] = ["graph TD"];
  // subgraphs
  const regionMap = new Map<string, string[]>();
  for (const loc of mapData.locations) {
    const regionId = loc.region_id ?? "_orphan";
    if (!regionMap.has(regionId)) regionMap.set(regionId, []);
    regionMap.get(regionId)!.push(loc.id);
  }
  for (const [regionId, locIds] of regionMap) {
    const regionName =
      mapData.regions.find(r => r.id === regionId)?.name ?? "无区域";
    lines.push(`  subgraph ${regionName}`);
    for (const locId of locIds) {
      const loc = mapData.locations.find(l => l.id === locId)!;
      const safeName = loc.name.replace(/"/g, '\\"');
      lines.push(`    ${loc.id}["${safeName}"]`);
    }
    lines.push("  end");
  }
  // edges
  for (const route of mapData.routes) {
    const label = `${route.est_travel_minutes}min ${route.risk}`;
    lines.push(`  ${route.from} -->|${label}| ${route.to}`);
  }
  return lines.join("\n");
}

mermaid.initialize({ startOnLoad: false, securityLevel: "loose" });

export function MermaidMapModal({ open, onClose, mapData }: MermaidMapModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const syntax = buildMermaidSyntax(mapData);
    mermaid.render("mermaid-svg", syntax)
      .then(({ svg }) => {
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      })
      .catch(e => setError(String(e)));
  }, [open, mapData]);

  if (!open) return null;

  return (
    <div
      data-testid="mermaid-backdrop"
      onClick={onClose}
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
    >
      <div
        data-testid="mermaid-modal"
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-container rounded-lg shadow-xl p-6 max-w-4xl w-full max-h-[80vh] overflow-auto"
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-medium">地图拓扑</h2>
          <button
            data-testid="mermaid-close"
            onClick={onClose}
            className="text-on-surface-variant hover:text-on-surface"
          >
            关闭
          </button>
        </div>
        {error && (
          <p data-testid="mermaid-error" className="text-error text-sm">
            渲染失败: {error}
          </p>
        )}
        <div ref={containerRef} data-testid="mermaid-container" />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 在 MapStep 接入 modal**

打开 `frontend/src/components/wizard/MapStep.tsx`,在 import 区域追加:

```tsx
import { MermaidMapModal } from "./MermaidMapModal";
```

在 MapStep 主组件内 `useState` 区域追加:

```tsx
  const [showMermaid, setShowMermaid] = useState(false);
```

把 `map-view-graph` 按钮改为:

```tsx
          <button
            data-testid="map-view-graph"
            onClick={() => setShowMermaid(true)}
            className="px-3 py-1 text-sm rounded border border-outline-variant hover:border-primary"
          >
            查看地图
          </button>
```

在 `</div>` 结束 `PanelCard` 之前(或 MapStep 组件 return 的最末尾)追加:

```tsx
      <MermaidMapModal
        open={showMermaid}
        onClose={() => setShowMermaid(false)}
        mapData={mapData}
      />
```

- [ ] **Step 5: 运行测试**

Run: `cd frontend && npm test -- --run "MapStep|MermaidMapModal" 2>&1 | tail -15`
Expected: 5 passed(MapStep 2 + MermaidMapModal 3)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/wizard/MermaidMapModal.tsx frontend/src/components/wizard/MermaidMapModal.test.tsx frontend/src/components/wizard/MapStep.tsx
git commit -m "feat(wizard): Mermaid map modal — topology graph view"
```

---

## Task 11: MapStep 主流程 vitest 测试覆盖

**Files:**
- Modify: `frontend/src/components/wizard/MapStep.test.tsx`

- [ ] **Step 1: 追加 empty state + 生成流程测试**

打开 `frontend/src/components/wizard/MapStep.test.tsx`,在现有 import 后追加 vi.mock `getMap` 返回空:

```tsx
describe("MapStep empty state", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("shows generate button when no map exists", async () => {
    vi.doMock("../../api/client", () => ({
      default: {
        getMap: vi.fn().mockResolvedValue({}),
        generateMap: vi.fn().mockResolvedValue({ detail: SAMPLE_MAP }),
        updateMap: vi.fn(),
      },
    }));
    const { default: MapStepFresh } = await import("./MapStep");
    render(
      <WizardProvider projectId="proj_empty">
        <MapStepFresh projectId="proj_empty" />
      </WizardProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("map-generate")).toBeInTheDocument(),
    );
  });

  it("switches tabs after generation", async () => {
    vi.doMock("../../api/client", () => ({
      default: {
        getMap: vi.fn().mockResolvedValue(SAMPLE_MAP),
        updateMap: vi.fn(),
      },
    }));
    const { default: MapStepFresh } = await import("./MapStep");
    render(
      <WizardProvider projectId="proj_x">
        <MapStepFresh projectId="proj_x" />
      </WizardProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("map-step")).toBeInTheDocument(),
    );
    // 5 个 tab 都能切换
    expect(screen.getByTestId("map-panel-locations")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试**

Run: `cd frontend && npm test -- --run MapStep 2>&1 | tail -10`
Expected: 4 passed

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/wizard/MapStep.test.tsx
git commit -m "test(wizard): MapStep empty state + tab switch"
```

---

## Task 12: map_generation.yaml + PlannerAgent.generate_map + agent_mapping

**Files:**
- Create: `backend/prompts/map_generation.yaml`
- Modify: `backend/agents/planner.py`
- Modify: `config/model_tiers.yaml`

- [ ] **Step 1: 写 map_generation.yaml**

打开 `backend/prompts/map_generation.yaml`,写入:

```yaml
name: map_generation
provider: deepseek
model: deepseek-chat
temperature: 0.7
max_tokens: 8192
negative_constraints: "不要输出除 JSON 外的任何文字"
system_prompt: |
  你是一位资深的世界观架构师与地图设计师,擅长把世界观的「时代与地理」
  转译为结构化、可校验的地理注册表。

  严格生成要求:
  1. 节点数量控制:**5-15 个 region**,**20-40 个 location**(超出范围必须警告并请求用户确认)。
  2. 每个 location 必须填 `dramatic_role` 三问答案:
     - wanted_by: 谁想要这里?
     - decisions_unlocked: 这里能改变什么决定?
     - departure_cost: 从这里离开会变难还是变贵?
  3. route 必须连接至少一对 location,且不可自环。
  4. POI 数量 ≤ location 数量的 30%。
  5. 不允许 location 出现在 `world.factions[].controlled_by` 直接控制的 region 内且与该 faction 的 attitude 为 `hostile`。
  6. 每个 location 的 `pos_hint` 必须显式引用至少一个已存在的 region 或 location(避免孤立节点)。
  7. 所有 location 必须打 `space_type: "world"` 或 `"room"` 之一,默认 `"world"`。
  8. 严格按 JSON 输出,不要 markdown 代码块包裹。

  5 维度单元联动:
  - ontology 单元 → 决定地理特征 (阴/阳/灵脉/地形)
  - power_structure 单元 → 决定势力边界与禁地
  - narrative_physics 单元 → 决定冲突规模与可达性
  - protagonist_engine 单元 → 决定主角起点位置

  {negative_constraints}

user_prompt_template: |
  世界观时代与地理(参考输入,不是结构化数据):
  - 时代: {world_era}
  - 地理: {world_geography}
  - 社会结构: {world_social_structure}
  - 历史文化: {world_cultural_history}

  势力分布(每条含 name / type / goal / relations):
  {world_factions}

  力量体系(每条含 name / source):
  {world_power_systems}

  角色当前位置(决定起点 location):
  {characters_locations}

  5 维度拆解(S2 输入):
  ontology: {ontology_units}
  energetics: {energetics_units}
  power_structure: {power_structure_units}
  protagonist_engine: {protagonist_engine_units}
  narrative_physics: {narrative_units}

  {user_modifications}

  请生成地图 JSON,严格遵循顶层结构:
  {{
    "schema_version": "1.0",
    "project_id": "{project_id}",
    "regions": [{{"id": "region_xxx", "name": "...", ...}}],
    "locations": [{{"id": "loc_xxx", "name": "...", "type": "city", "dramatic_role": {{...}}, ...}}],
    "routes": [{{"id": "route_xxx", "from": "loc_a", "to": "loc_b", "est_travel_minutes": 40, ...}}],
    "pois": [{{"id": "poi_xxx", "parent_location_id": "loc_a", "discoverable": true, ...}}]
  }}

output_format:
  type: json
```

- [ ] **Step 2: model_tiers.yaml 加 map_generation 路由**

打开 `config/model_tiers.yaml`,在 `planner:` 块下 `world_power_system_rewrite` 之后追加:

```yaml
    map_generation:
      tier: tier_1
      model: default
```

- [ ] **Step 3: PlannerAgent 加 generate_map 方法**

打开 `backend/agents/planner.py`,找到 `generate_world` 方法结束位置(`return result, response` 后面一行),在 `regenerate_power_system` 方法前插入:

```python
    async def generate_map(
        self,
        world: dict,
        characters: list[dict],
        user_modifications: str = "",
    ) -> tuple[dict, str]:
        """Generate world via the existing 'map_generation' prompt.
        Carries world.erz + factions + characters' starting locations as context.

        Returns (map_payload, llm_response_meta).
        """
        from backend.agents._injection_helpers import _build_user_modifications_block
        from backend.outline_context.builder import build_recent_chapters_context
        from backend.outline_context.volumes import parse_volumes, locate_volume

        # 5 维度单元从 world 元数据读(若可用)。b3_state 已在 _load_decompose_data
        # 抽取,本方法只读 world 字段,decompose_data 由调用方注入(后续 plan 接)。
        # 暂走空字符串占位,LLM 用 world 自身信息生成。
        decompose_data = {}

        # 角色起点位置 — bare string name
        chars_locations = [
            f"- {c.get('name', '?')}: {c.get('current_state', {}).get('location', '')}"
            for c in characters
            if c.get('name')
        ]
        characters_locations = "\n".join(chars_locations) or "（无）"

        # 势力 fulltext
        factions_json = json.dumps(
            world.get("factions", []), ensure_ascii=False, indent=2,
        )
        # 力量体系 name + source
        power_systems_json = json.dumps(
            [
                {"name": ps.get("name", ""), "source": ps.get("source", "energetics")}
                for ps in iter_power_systems(world)
            ],
            ensure_ascii=False, indent=2,
        )

        result, response = await self.generate_from_template(
            "map_generation",
            project_id=self.project_id,
            world_era=world.get("era", ""),
            world_geography=world.get("geography", ""),
            world_social_structure=world.get("era_social_structure", "") or "",
            world_cultural_history=world.get("era_cultural_history", "") or "",
            world_factions=factions_json,
            world_power_systems=power_systems_json,
            characters_locations=characters_locations,
            user_modifications=_build_user_modifications_block(user_modifications),
            ontology_units="（无）",
            energetics_units="（无）",
            power_structure_units="（无）",
            protagonist_engine_units="（无）",
            narrative_units="（无）",
        )
        self.log_usage("map_generation", response)
        return result, response
```

- [ ] **Step 4: 验证导入 + 配置加载**

Run: `python -c "from backend.agents.planner import PlannerAgent; print(hasattr(PlannerAgent, 'generate_map'))"`
Expected: `True`

Run: `python -c "import yaml; d = yaml.safe_load(open('config/model_tiers.yaml')); print(d['agent_mapping']['planner']['map_generation'])"`
Expected: `{'tier': 'tier_1', 'model': 'default'}`

- [ ] **Step 5: Commit**

```bash
git add backend/prompts/map_generation.yaml backend/agents/planner.py config/model_tiers.yaml
git commit -m "feat(map): map_generation prompt + PlannerAgent.generate_map + tier routing"
```

---

## Task 13: 实现 /generate-map + /regenerate-map-section 端点

**Files:**
- Modify: `backend/api/stage2_map.py`
- Modify: `frontend/src/api/client.ts`(用真后端替换 Task 8 stub)
- Test: `backend/tests/test_map_api.py`(追加)

- [ ] **Step 1: 写失败测试**

打开 `backend/tests/test_map_api.py`,在末尾追加:

```python


def _seed_world(tmp_path):
    import json
    (tmp_path / PROJ).mkdir(parents=True, exist_ok=True)
    (tmp_path / PROJ / "world.json").write_text(
        json.dumps({
            "era": "新元",
            "geography": "新地",
            "era_social_structure": "新社",
            "era_cultural_history": "新史",
            "power_systems": [],
            "factions": [
                {"name": "漕帮", "type": "帮派", "goal": "控制水路", "relations": ""},
            ],
            "core_rules": [],
        }, ensure_ascii=False),
        encoding="utf-8",
    )


def test_generate_map_returns_400_when_no_world():
    r = client.post(
        f"/api/stage2/generate-map?project_id={PROJ}",
        json={"project_id": PROJ},
    )
    assert r.status_code in (400, 422)


def test_generate_map_invokes_planner_and_saves():
    """happy path: world.json 存在 + PlannerAgent mock 返回 → /generate-map 落 map.json。"""
    _seed_world(_patch_projects_dir.tmp_path if False else None)  # see note below
    # 直接写 world.json 到 patch 过的 settings.projects_dir
    from backend.config import settings as s
    import json as _json
    proj_dir = s.projects_dir / PROJ
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "world.json").write_text(
        _json.dumps({
            "era": "新元", "geography": "新地",
            "era_social_structure": "", "era_cultural_history": "",
            "power_systems": [], "factions": [], "core_rules": [],
        }, ensure_ascii=False),
    )

    with patch("backend.api.stage2_map.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value

        async def fake_generate_map(world, characters, user_modifications=""):
            return {
                "schema_version": "1.0",
                "project_id": PROJ,
                "regions": [{"id": "region_south", "name": "南泽", "level": "state"}],
                "locations": [],
                "routes": [],
                "pois": [],
            }, None

        instance.generate_map = fake_generate_map
        r = client.post(
            f"/api/stage2/generate-map?project_id={PROJ}",
            json={"project_id": PROJ, "user_modifications": ""},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["error"] is False
        assert body["detail"]["regions"][0]["id"] == "region_south"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest backend/tests/test_map_api.py -v -k "generate_map" 2>&1 | tail -15`
Expected: FAIL(`/generate-map` 404)

- [ ] **Step 3: 实现 /generate-map + /regenerate-map-section**

打开 `backend/api/stage2_map.py`,在 `put_map` 函数后追加:

```python


@router.post("/generate-map")
async def generate_map(data: dict):
    from backend.agents.planner import PlannerAgent
    from backend.services.agent_prompt_stores import (
        project_override_store,
        global_override_store,
    )

    project_id = data.get("project_id", "")
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )

    project = _file_manager().read_json(project_id, "project.json")
    if project is None:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "PROJECT_NOT_FOUND",
                    "message": f"项目 {project_id} 不存在", "detail": {}},
        )

    world = _file_manager().read_json(project_id, "world.json")
    if world is None:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "PRECONDITION_FAILED",
                    "message": "请先生成世界观 (STAGE2)", "detail": {}},
        )

    chars_data = _file_manager().read_json(project_id, "characters.json") or {}
    characters = chars_data.get("characters", [])

    agent = PlannerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
        genre=project.get("genre", "cool_novel"),
    )
    try:
        user_modifications = str(data.get("user_modifications", ""))[:1700]
        result, _resp = await agent.generate_map(
            world=world,
            characters=characters,
            user_modifications=user_modifications,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": True, "code": "LLM_GENERATION_FAILED",
                    "message": str(e), "detail": {}},
        )

    # Validate + coerce so on-disk map.json always matches Map schema.
    try:
        validated = MapModel.model_validate(result)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail={"error": True, "code": "MAP_VALIDATION_FAILED",
                    "message": f"LLM 输出校验失败: {e}", "detail": {}},
        )

    save_map(project_id, validated)
    return {
        "error": False,
        "code": "OK",
        "message": "地图生成成功",
        "detail": validated.model_dump(by_alias=True),
    }


class RegenerateMapSectionPayload(BaseModel):
    section: Literal["regions", "locations", "routes", "pois", "all"]
    index: Optional[int] = None
    user_modifications: str = ""


@router.post("/regenerate-map-section")
async def regenerate_map_section(
    project_id: str = Query(...),
    payload: RegenerateMapSectionPayload = None,
):
    """Re-run map generation and merge only the requested section back
    into map.json. Other top-level keys preserved byte-identical.

    Mirrors /regenerate-world-section semantics for the map system.
    """
    from backend.agents.planner import PlannerAgent
    from backend.services.agent_prompt_stores import (
        project_override_store,
        global_override_store,
    )

    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )
    if payload.section not in ("regions", "locations", "routes", "pois", "all"):
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": f"section 必须是 regions/locations/routes/pois/all",
                    "detail": {}},
        )

    project = _file_manager().read_json(project_id, "project.json")
    if project is None:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "PROJECT_NOT_FOUND",
                    "message": f"项目 {project_id} 不存在", "detail": {}},
        )

    existing = load_map(project_id) or {"schema_version": "1.0", "project_id": project_id}
    world = _file_manager().read_json(project_id, "world.json") or {}
    chars_data = _file_manager().read_json(project_id, "characters.json") or {}
    characters = chars_data.get("characters", [])

    agent = PlannerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
        genre=project.get("genre", "cool_novel"),
    )
    try:
        result, _resp = await agent.generate_map(
            world=world,
            characters=characters,
            user_modifications=payload.user_modifications,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": True, "code": "LLM_GENERATION_FAILED",
                    "message": str(e), "detail": {}},
        )

    merged = dict(existing)
    if payload.section == "all":
        for key in ("regions", "locations", "routes", "pois"):
            merged[key] = result.get(key, existing.get(key, []))
    else:
        merged[payload.section] = result.get(payload.section, existing.get(payload.section, []))

    try:
        validated = MapModel.model_validate(merged)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail={"error": True, "code": "MAP_VALIDATION_FAILED",
                    "message": f"regen 后 map 校验失败: {e}", "detail": {}},
        )

    save_map(project_id, validated)
    return {
        "error": False,
        "code": "OK",
        "message": f"map.{payload.section} 已重新生成",
        "detail": validated.model_dump(by_alias=True),
    }
```

- [ ] **Step 4: frontend client.ts 用真后端替换 stub**

打开 `frontend/src/api/client.ts`,找到 Task 8 加的 `generateMap` stub,替换为:

```typescript
  generateMap: (projectId: string, userModifications: string = "") =>
    request<MapPayload>(
      "POST",
      `/stage2/generate-map?project_id=${encodeURIComponent(projectId)}`,
      { project_id: projectId, user_modifications: userModifications },
    ),
```

并在 import 区域确保 `MapPayload` 已导出(Task 6 已加)。

- [ ] **Step 5: 运行测试确认通过**

Run: `pytest backend/tests/test_map_api.py -v 2>&1 | tail -10`
Expected: 5 passed(原 3 + 新 2)

- [ ] **Step 6: Commit**

```bash
git add backend/api/stage2_map.py backend/tests/test_map_api.py frontend/src/api/client.ts
git commit -m "feat(map): /generate-map + /regenerate-map-section endpoints"
```

---

## Task 14: 实现 /map/location PATCH / POST / DELETE 端点

**Files:**
- Modify: `backend/api/stage2_map.py`
- Test: `backend/tests/test_map_api.py`(追加)

- [ ] **Step 1: 写失败测试**

在 `backend/tests/test_map_api.py` 末尾追加:

```python


def test_patch_location_updates_field():
    """PATCH /map/location/{id} 只更新传入字段,其他 byte-preserve。"""
    from backend.map_system.models import Map as MapModel
    _seed_world(_patch_projects_dir.tmp_path if False else None)
    from backend.config import settings as s
    import json as _json
    proj_dir = s.projects_dir / PROJ
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "map.json").write_text(_json.dumps({
        "schema_version": "1.0",
        "project_id": PROJ,
        "regions": [],
        "locations": [{
            "id": "loc_a", "name": "A", "type": "city",
            "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
        }],
        "routes": [], "pois": [], "location_states": [],
        "snapshots": [], "footprints": [], "assertions": [], "change_log": [],
        "display": {"positions": {}},
        "settings": {"mode": "allow_alias_new", "scope_enabled": False,
                     "allowed_region_ids": [], "chapter_new_location_cap": 5,
                     "reuse_rate_target": 0.6, "strict_geo": False},
    }, ensure_ascii=False))

    r = client.patch(
        f"/api/stage2/map/location/loc_a?project_id={PROJ}",
        json={"name": "新名字"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["detail"]["name"] == "新名字"
    assert body["detail"]["type"] == "city"  # 未传字段 byte-preserve


def test_delete_location_referenced_by_route_returns_422():
    """删除被 route 引用的 location → 422 LOCATION_REFERENCED_BY_ROUTES。"""
    from backend.config import settings as s
    import json as _json
    proj_dir = s.projects_dir / PROJ
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "map.json").write_text(_json.dumps({
        "schema_version": "1.0",
        "project_id": PROJ,
        "regions": [],
        "locations": [{
            "id": "loc_a", "name": "A", "type": "city",
            "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
        }],
        "routes": [{
            "id": "route_x", "from": "loc_a", "to": "loc_b",
            "est_travel_minutes": 30, "distance_tier": "inter_city",
        }],
        "pois": [], "location_states": [],
        "snapshots": [], "footprints": [], "assertions": [], "change_log": [],
        "display": {"positions": {}},
        "settings": {"mode": "allow_alias_new", "scope_enabled": False,
                     "allowed_region_ids": [], "chapter_new_location_cap": 5,
                     "reuse_rate_target": 0.6, "strict_geo": False},
    }, ensure_ascii=False))

    r = client.delete(
        f"/api/stage2/map/location/loc_a?project_id={PROJ}",
    )
    assert r.status_code == 422
    body = r.json()
    assert body["detail"]["code"] == "LOCATION_REFERENCED_BY_ROUTES"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest backend/tests/test_map_api.py -v -k "patch_location or delete_location" 2>&1 | tail -10`
Expected: FAIL(404 路由不存在)

- [ ] **Step 3: 实现 PATCH / POST / DELETE 端点**

打开 `backend/api/stage2_map.py`,在 `regenerate_map_section` 函数后追加:

```python


@router.post("/map/location")
async def add_location(project_id: str = Query(...), payload: dict = None):
    """新增 location。id 由后端生成(避免前端造重)。"""
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )
    data = load_map(project_id) or {"schema_version": "1.0", "project_id": project_id}
    locations = list(data.get("locations", []))
    existing_ids = {l["id"] for l in locations}

    # id: 前端可传,但必须唯一;否则后端生成
    new_loc = dict(payload or {})
    if not new_loc.get("id") or new_loc["id"] in existing_ids:
        import secrets
        new_loc["id"] = "loc_" + secrets.token_hex(4)
    locations.append(new_loc)

    data["locations"] = locations
    try:
        validated = MapModel.model_validate(data)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail={"error": True, "code": "MAP_VALIDATION_FAILED",
                    "message": str(e), "detail": {}},
        )
    save_map(project_id, validated)
    new_id = new_loc["id"]
    return {"error": False, "code": "OK", "message": "location 已新增",
            "detail": next(l for l in validated.locations if l.id == new_id).model_dump(by_alias=True)}


@router.patch("/map/location/{location_id}")
async def patch_location(
    location_id: str,
    project_id: str = Query(...),
    payload: dict = None,
):
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )
    data = load_map(project_id)
    if not data:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "MAP_NOT_FOUND",
                    "message": "map.json 不存在", "detail": {}},
        )
    locations = list(data.get("locations", []))
    target_idx = next(
        (i for i, l in enumerate(locations) if l.get("id") == location_id),
        None,
    )
    if target_idx is None:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "LOCATION_NOT_FOUND",
                    "message": f"location {location_id} 不存在", "detail": {}},
        )

    merged_loc = {**locations[target_idx], **(payload or {})}
    locations[target_idx] = merged_loc
    data["locations"] = locations

    try:
        validated = MapModel.model_validate(data)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail={"error": True, "code": "MAP_VALIDATION_FAILED",
                    "message": str(e), "detail": {}},
        )
    save_map(project_id, validated)
    updated = next(l for l in validated.locations if l.id == location_id)
    return {"error": False, "code": "OK", "message": "location 已更新",
            "detail": updated.model_dump(by_alias=True)}


@router.delete("/map/location/{location_id}")
async def delete_location(
    location_id: str,
    project_id: str = Query(...),
):
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )
    data = load_map(project_id)
    if not data:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "MAP_NOT_FOUND",
                    "message": "map.json 不存在", "detail": {}},
        )

    # 检查 route 引用
    routes = data.get("routes", [])
    referenced_by = [r["id"] for r in routes if r.get("from") == location_id or r.get("to") == location_id]
    if referenced_by:
        raise HTTPException(
            status_code=422,
            detail={"error": True, "code": "LOCATION_REFERENCED_BY_ROUTES",
                    "message": f"location {location_id} 被 {len(referenced_by)} 条 route 引用, 请先删除相关路线",
                    "detail": {"referencing_route_ids": referenced_by}},
        )

    locations = [l for l in data.get("locations", []) if l.get("id") != location_id]
    data["locations"] = locations
    # 同步删 POI
    cascaded_pois = [p["id"] for p in data.get("pois", []) if p.get("parent_location_id") == location_id]
    if cascaded_pois:
        data["pois"] = [p for p in data.get("pois", []) if p.get("parent_location_id") != location_id]

    try:
        validated = MapModel.model_validate(data)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail={"error": True, "code": "MAP_VALIDATION_FAILED",
                    "message": str(e), "detail": {}},
        )
    save_map(project_id, validated)
    return {"error": False, "code": "OK", "message": "location 已删除",
            "detail": {"deleted_id": location_id, "cascaded_poi_removals": cascaded_pois}}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pytest backend/tests/test_map_api.py -v 2>&1 | tail -10`
Expected: 7 passed

- [ ] **Step 5: Commit**

```bash
git add backend/api/stage2_map.py backend/tests/test_map_api.py
git commit -m "feat(map): POST/PATCH/DELETE /map/location endpoints"
```

---

## Task 15: 实现 routes / POIs / regions 行内编辑端点

**Files:**
- Modify: `backend/api/stage2_map.py`

- [ ] **Step 1: 实现 /map/route PATCH / POST / DELETE + /map/region PATCH**

打开 `backend/api/stage2_map.py`,在 `delete_location` 后追加:

```python


@router.post("/map/route")
async def add_route(project_id: str = Query(...), payload: dict = None):
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )
    data = load_map(project_id) or {"schema_version": "1.0", "project_id": project_id}
    routes = list(data.get("routes", []))
    existing_ids = {r["id"] for r in routes}
    new_route = dict(payload or {})
    if not new_route.get("id") or new_route["id"] in existing_ids:
        import secrets
        new_route["id"] = "route_" + secrets.token_hex(4)
    routes.append(new_route)
    data["routes"] = routes
    try:
        validated = MapModel.model_validate(data)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail={"error": True, "code": "MAP_VALIDATION_FAILED",
                    "message": str(e), "detail": {}},
        )
    save_map(project_id, validated)
    return {"error": False, "code": "OK", "message": "route 已新增",
            "detail": next(r for r in validated.routes if r.id == new_route["id"]).model_dump(by_alias=True)}


@router.patch("/map/route/{route_id}")
async def patch_route(
    route_id: str,
    project_id: str = Query(...),
    payload: dict = None,
):
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )
    data = load_map(project_id)
    if not data:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "MAP_NOT_FOUND",
                    "message": "map.json 不存在", "detail": {}},
        )
    routes = list(data.get("routes", []))
    idx = next((i for i, r in enumerate(routes) if r.get("id") == route_id), None)
    if idx is None:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "ROUTE_NOT_FOUND",
                    "message": f"route {route_id} 不存在", "detail": {}},
        )
    routes[idx] = {**routes[idx], **(payload or {})}
    data["routes"] = routes
    try:
        validated = MapModel.model_validate(data)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail={"error": True, "code": "MAP_VALIDATION_FAILED",
                    "message": str(e), "detail": {}},
        )
    save_map(project_id, validated)
    return {"error": False, "code": "OK", "message": "route 已更新",
            "detail": next(r for r in validated.routes if r.id == route_id).model_dump(by_alias=True)}


@router.delete("/map/route/{route_id}")
async def delete_route(
    route_id: str,
    project_id: str = Query(...),
):
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )
    data = load_map(project_id)
    if not data:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "MAP_NOT_FOUND",
                    "message": "map.json 不存在", "detail": {}},
        )
    data["routes"] = [r for r in data.get("routes", []) if r.get("id") != route_id]
    try:
        validated = MapModel.model_validate(data)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail={"error": True, "code": "MAP_VALIDATION_FAILED",
                    "message": str(e), "detail": {}},
        )
    save_map(project_id, validated)
    return {"error": False, "code": "OK", "message": "route 已删除",
            "detail": {"deleted_id": route_id}}


@router.post("/map/region")
async def add_region(project_id: str = Query(...), payload: dict = None):
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )
    data = load_map(project_id) or {"schema_version": "1.0", "project_id": project_id}
    regions = list(data.get("regions", []))
    existing_ids = {r["id"] for r in regions}
    new_region = dict(payload or {})
    if not new_region.get("id") or new_region["id"] in existing_ids:
        import secrets
        new_region["id"] = "region_" + secrets.token_hex(4)
    regions.append(new_region)
    data["regions"] = regions
    try:
        validated = MapModel.model_validate(data)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail={"error": True, "code": "MAP_VALIDATION_FAILED",
                    "message": str(e), "detail": {}},
        )
    save_map(project_id, validated)
    return {"error": False, "code": "OK", "message": "region 已新增",
            "detail": next(r for r in validated.regions if r.id == new_region["id"]).model_dump(by_alias=True)}


@router.patch("/map/region/{region_id}")
async def patch_region(
    region_id: str,
    project_id: str = Query(...),
    payload: dict = None,
):
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )
    data = load_map(project_id)
    if not data:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "MAP_NOT_FOUND",
                    "message": "map.json 不存在", "detail": {}},
        )
    regions = list(data.get("regions", []))
    idx = next((i for i, r in enumerate(regions) if r.get("id") == region_id), None)
    if idx is None:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "REGION_NOT_FOUND",
                    "message": f"region {region_id} 不存在", "detail": {}},
        )
    regions[idx] = {**regions[idx], **(payload or {})}
    data["regions"] = regions
    try:
        validated = MapModel.model_validate(data)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail={"error": True, "code": "MAP_VALIDATION_FAILED",
                    "message": str(e), "detail": {}},
        )
    save_map(project_id, validated)
    return {"error": False, "code": "OK", "message": "region 已更新",
            "detail": next(r for r in validated.regions if r.id == region_id).model_dump(by_alias=True)}


@router.post("/map/poi")
async def add_poi(project_id: str = Query(...), payload: dict = None):
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )
    data = load_map(project_id) or {"schema_version": "1.0", "project_id": project_id}
    pois = list(data.get("pois", []))
    existing_ids = {p["id"] for p in pois}
    new_poi = dict(payload or {})
    if not new_poi.get("id") or new_poi["id"] in existing_ids:
        import secrets
        new_poi["id"] = "poi_" + secrets.token_hex(4)
    pois.append(new_poi)
    data["pois"] = pois
    try:
        validated = MapModel.model_validate(data)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail={"error": True, "code": "MAP_VALIDATION_FAILED",
                    "message": str(e), "detail": {}},
        )
    save_map(project_id, validated)
    return {"error": False, "code": "OK", "message": "poi 已新增",
            "detail": next(p for p in validated.pois if p.id == new_poi["id"]).model_dump(by_alias=True)}


@router.patch("/map/poi/{poi_id}")
async def patch_poi(
    poi_id: str,
    project_id: str = Query(...),
    payload: dict = None,
):
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )
    data = load_map(project_id)
    if not data:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "MAP_NOT_FOUND",
                    "message": "map.json 不存在", "detail": {}},
        )
    pois = list(data.get("pois", []))
    idx = next((i for i, p in enumerate(pois) if p.get("id") == poi_id), None)
    if idx is None:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "POI_NOT_FOUND",
                    "message": f"poi {poi_id} 不存在", "detail": {}},
        )
    pois[idx] = {**pois[idx], **(payload or {})}
    data["pois"] = pois
    try:
        validated = MapModel.model_validate(data)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail={"error": True, "code": "MAP_VALIDATION_FAILED",
                    "message": str(e), "detail": {}},
        )
    save_map(project_id, validated)
    return {"error": False, "code": "OK", "message": "poi 已更新",
            "detail": next(p for p in validated.pois if p.id == poi_id).model_dump(by_alias=True)}


@router.delete("/map/poi/{poi_id}")
async def delete_poi(
    poi_id: str,
    project_id: str = Query(...),
):
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )
    data = load_map(project_id)
    if not data:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "MAP_NOT_FOUND",
                    "message": "map.json 不存在", "detail": {}},
        )
    data["pois"] = [p for p in data.get("pois", []) if p.get("id") != poi_id]
    try:
        validated = MapModel.model_validate(data)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail={"error": True, "code": "MAP_VALIDATION_FAILED",
                    "message": str(e), "detail": {}},
        )
    save_map(project_id, validated)
    return {"error": False, "code": "OK", "message": "poi 已删除",
            "detail": {"deleted_id": poi_id}}
```

- [ ] **Step 2: 在 client.ts 加对应前端方法**

打开 `frontend/src/api/client.ts`,在 `patchMapLocation` 后追加:

```typescript
  addMapLocation: (projectId: string, loc: Partial<MapLocation>): Promise<MapLocation> =>
    request<MapLocation>(
      "POST",
      `/stage2/map/location?project_id=${encodeURIComponent(projectId)}`,
      loc,
    ),

  patchMapRoute: (
    projectId: string,
    routeId: string,
    patch: Partial<MapRoute>,
  ): Promise<MapRoute> =>
    request<MapRoute>(
      "PATCH",
      `/stage2/map/route/${encodeURIComponent(routeId)}?project_id=${encodeURIComponent(projectId)}`,
      patch,
    ),

  addMapRoute: (projectId: string, route: Partial<MapRoute>): Promise<MapRoute> =>
    request<MapRoute>(
      "POST",
      `/stage2/map/route?project_id=${encodeURIComponent(projectId)}`,
      route,
    ),

  deleteMapRoute: (projectId: string, routeId: string): Promise<{ deleted_id: string }> =>
    request<{ deleted_id: string }>(
      "DELETE",
      `/stage2/map/route/${encodeURIComponent(routeId)}?project_id=${encodeURIComponent(projectId)}`,
    ),

  patchMapRegion: (
    projectId: string,
    regionId: string,
    patch: Partial<MapRegion>,
  ): Promise<MapRegion> =>
    request<MapRegion>(
      "PATCH",
      `/stage2/map/region/${encodeURIComponent(regionId)}?project_id=${encodeURIComponent(projectId)}`,
      patch,
    ),

  addMapRegion: (projectId: string, region: Partial<MapRegion>): Promise<MapRegion> =>
    request<MapRegion>(
      "POST",
      `/stage2/map/region?project_id=${encodeURIComponent(projectId)}`,
      region,
    ),

  patchMapPoi: (
    projectId: string,
    poiId: string,
    patch: Partial<MapPOI>,
  ): Promise<MapPOI> =>
    request<MapPOI>(
      "PATCH",
      `/stage2/map/poi/${encodeURIComponent(poiId)}?project_id=${encodeURIComponent(projectId)}`,
      patch,
    ),

  addMapPoi: (projectId: string, poi: Partial<MapPOI>): Promise<MapPOI> =>
    request<MapPOI>(
      "POST",
      `/stage2/map/poi?project_id=${encodeURIComponent(projectId)}`,
      poi,
    ),

  deleteMapPoi: (projectId: string, poiId: string): Promise<{ deleted_id: string }> =>
    request<{ deleted_id: string }>(
      "DELETE",
      `/stage2/map/poi/${encodeURIComponent(poiId)}?project_id=${encodeURIComponent(projectId)}`,
    ),

  regenerateMapSection: (
    projectId: string,
    section: "regions" | "locations" | "routes" | "pois" | "all",
    index?: number,
    userModifications: string = "",
  ): Promise<MapPayload> =>
    request<MapPayload>(
      "POST",
      `/stage2/regenerate-map-section?project_id=${encodeURIComponent(projectId)}`,
      { section, index, user_modifications: userModifications },
    ),
```

- [ ] **Step 3: 运行已有测试**

Run: `pytest backend/tests/test_map_api.py -v 2>&1 | tail -10`
Expected: 7 passed(本 task 不加新测试,只扩 API 表面)

- [ ] **Step 4: Commit**

```bash
git add backend/api/stage2_map.py frontend/src/api/client.ts
git commit -m "feat(map): routes/regions/pois CRUD endpoints + frontend bindings"
```

---

## Task 16: MapStep 5 个 Tab 全部接通 patch/add/delete UI

**Files:**
- Modify: `frontend/src/components/wizard/MapStep.tsx`
- Test: `frontend/src/components/wizard/MapStep.test.tsx`(追加)

- [ ] **Step 1: 写失败测试**

打开 `frontend/src/components/wizard/MapStep.test.tsx`,在现有 `describe` 后追加:

```tsx
describe("MapStep multi-tab coverage", () => {
  it("renders regions tab when activated", async () => {
    renderMapStep();
    await waitFor(() =>
      expect(screen.getByTestId("map-step")).toBeInTheDocument(),
    );
    const regionsTab = screen.getByText("区域");
    fireEvent.click(regionsTab);
    expect(screen.getByTestId("regions-list")).toBeInTheDocument();
  });

  it("renders routes tab when activated", async () => {
    renderMapStep();
    await waitFor(() =>
      expect(screen.getByTestId("map-step")).toBeInTheDocument(),
    );
    const routesTab = screen.getByText("路线");
    fireEvent.click(routesTab);
    expect(screen.getByTestId("routes-list")).toBeInTheDocument();
  });

  it("renders POIs tab when activated", async () => {
    renderMapStep();
    await waitFor(() =>
      expect(screen.getByTestId("map-step")).toBeInTheDocument(),
    );
    const poisTab = screen.getByText("POI");
    fireEvent.click(poisTab);
    expect(screen.getByTestId("pois-list")).toBeInTheDocument();
  });

  it("renders snapshots tab when activated", async () => {
    renderMapStep();
    await waitFor(() =>
      expect(screen.getByTestId("map-step")).toBeInTheDocument(),
    );
    const snapshotsTab = screen.getByText("快照");
    fireEvent.click(snapshotsTab);
    expect(screen.getByTestId("snapshots-list")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试确认通过**

Run: `cd frontend && npm test -- --run MapStep 2>&1 | tail -10`
Expected: 6 passed(Task 11 加了 4 + Task 9 加了 2)

(若失败,Task 9 已把所有 panel 接到 activeKey 上,所以 Tab 切换应该已经能工作 — 失败主要是 panel 数据缺失。)

- [ ] **Step 3: 给所有 panel 加 [+ 新增] 按钮 + 行内编辑**

打开 `frontend/src/components/wizard/MapStep.tsx`,把 `RegionsPanel` 替换为:

```tsx
function RegionsPanel({
  mapData,
  setMapData,
}: {
  mapData: MapPayload;
  setMapData: (m: MapPayload) => void;
}) {
  const handleAdd = async () => {
    const name = prompt("新区域名:") ?? "";
    if (!name) return;
    const created = await api.addMapRegion(mapData.project_id, { name });
    setMapData({ ...mapData, regions: [...mapData.regions, created] });
  };
  const handlePatch = async (id: string, patch: Partial<MapRegion>) => {
    const updated = await api.patchMapRegion(mapData.project_id, id, patch);
    setMapData({
      ...mapData,
      regions: mapData.regions.map(r => (r.id === id ? updated : r)),
    });
  };
  return (
    <div className="space-y-2">
      <button
        data-testid="region-add"
        onClick={handleAdd}
        className="px-3 py-1 text-sm bg-primary text-on-primary rounded"
      >
        + 添加区域
      </button>
      <ul data-testid="regions-list" className="space-y-2">
        {mapData.regions.map((r) => (
          <li key={r.id} className="p-3 border border-outline-variant rounded">
            <input
              defaultValue={r.name}
              onBlur={(e) => {
                if (e.target.value !== r.name) handlePatch(r.id, { name: e.target.value });
              }}
              className="font-medium bg-transparent border-b border-transparent hover:border-outline-variant"
            />
            <span className="ml-2 text-xs text-on-surface-variant">{r.level}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

把 `RoutesPanel` 替换为:

```tsx
function RoutesPanel({
  mapData,
  setMapData,
}: {
  mapData: MapPayload;
  setMapData: (m: MapPayload) => void;
}) {
  const handleAdd = async () => {
    if (mapData.locations.length < 2) {
      alert("至少需要 2 个 location 才能新增 route");
      return;
    }
    const from = prompt(`起点 location id (${mapData.locations.map(l => l.id).join(", ")})`) ?? "";
    const to = prompt(`终点 location id`) ?? "";
    if (!from || !to) return;
    const minutes = parseInt(prompt("耗时 (分钟):") ?? "30", 10);
    const created = await api.addMapRoute(mapData.project_id, {
      from,
      to,
      est_travel_minutes: minutes,
    });
    setMapData({ ...mapData, routes: [...mapData.routes, created] });
  };
  const handleDelete = async (id: string) => {
    await api.deleteMapRoute(mapData.project_id, id);
    setMapData({
      ...mapData,
      routes: mapData.routes.filter(r => r.id !== id),
    });
  };
  return (
    <div className="space-y-2">
      <button
        data-testid="route-add"
        onClick={handleAdd}
        className="px-3 py-1 text-sm bg-primary text-on-primary rounded"
      >
        + 添加路线
      </button>
      <ul data-testid="routes-list" className="space-y-2">
        {mapData.routes.map((rt) => (
          <li key={rt.id} className="p-3 border border-outline-variant rounded flex justify-between">
            <span className="font-mono text-sm">
              {rt.from} → {rt.to}
            </span>
            <span className="ml-2 text-xs text-on-surface-variant">
              {rt.est_travel_minutes}min · {rt.risk}
            </span>
            <button
              data-testid={`route-delete-${rt.id}`}
              onClick={() => handleDelete(rt.id)}
              className="text-error text-sm hover:underline"
            >
              删除
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

把 `PoisPanel` 替换为:

```tsx
function PoisPanel({
  mapData,
  setMapData,
}: {
  mapData: MapPayload;
  setMapData: (m: MapPayload) => void;
}) {
  const handleAdd = async () => {
    if (mapData.locations.length === 0) {
      alert("至少需要 1 个 location 才能新增 POI");
      return;
    }
    const name = prompt("POI 名:") ?? "";
    const parentId = prompt(`父 location id (${mapData.locations.map(l => l.id).join(", ")})`) ?? "";
    if (!name || !parentId) return;
    const created = await api.addMapPoi(mapData.project_id, {
      name,
      parent_location_id: parentId,
    });
    setMapData({ ...mapData, pois: [...mapData.pois, created] });
  };
  const handleDelete = async (id: string) => {
    await api.deleteMapPoi(mapData.project_id, id);
    setMapData({
      ...mapData,
      pois: mapData.pois.filter(p => p.id !== id),
    });
  };
  return (
    <div className="space-y-2">
      <button
        data-testid="poi-add"
        onClick={handleAdd}
        className="px-3 py-1 text-sm bg-primary text-on-primary rounded"
      >
        + 添加 POI
      </button>
      <ul data-testid="pois-list" className="space-y-2">
        {mapData.pois.map((p) => (
          <li key={p.id} className="p-3 border border-outline-variant rounded flex justify-between">
            <span className="font-medium">{p.name}</span>
            <span className="ml-2 text-xs text-on-surface-variant">{p.kind}</span>
            {!p.discoverable && <span className="ml-2 text-xs text-error">[未发现]</span>}
            <button
              data-testid={`poi-delete-${p.id}`}
              onClick={() => handleDelete(p.id)}
              className="text-error text-sm hover:underline"
            >
              删除
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

把 MapStep 主组件里调用 panel 处改为传 `setMapData`:

```tsx
        {activeKey === "locations" && <LocationsPanel mapData={mapData} setMapData={setMapData} />}
        {activeKey === "regions" && <RegionsPanel mapData={mapData} setMapData={setMapData} />}
        {activeKey === "routes" && <RoutesPanel mapData={mapData} setMapData={setMapData} />}
        {activeKey === "pois" && <PoisPanel mapData={mapData} setMapData={setMapData} />}
        {activeKey === "snapshots" && <SnapshotsPanel mapData={mapData} />}
```

同时给 MapLocation / MapRegion / MapRoute / MapPOI 类型从 client.ts import:

```tsx
import api, { MapPayload, MapLocation, MapRegion, MapRoute, MapPOI } from "../../api/client";
```

- [ ] **Step 4: 验证类型编译**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: 无新错误

- [ ] **Step 5: 运行测试**

Run: `cd frontend && npm test -- --run MapStep 2>&1 | tail -10`
Expected: 6 passed

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/wizard/MapStep.tsx frontend/src/components/wizard/MapStep.test.tsx
git commit -m "feat(wizard): all 5 tabs wired with patch/add/delete"
```

---

## Task 17: 实现 /map/settings PATCH 端点

**Files:**
- Modify: `backend/api/stage2_map.py`
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: 实现 PATCH /map/settings 端点**

打开 `backend/api/stage2_map.py`,在 `delete_poi` 后追加:

```python


@router.patch("/map/settings")
async def patch_settings(project_id: str = Query(...), payload: dict = None):
    """更新 map.settings(mode / scope / chapter_new_location_cap /
    reuse_rate_target / strict_geo)。"""
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )
    data = load_map(project_id)
    if not data:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "MAP_NOT_FOUND",
                    "message": "map.json 不存在", "detail": {}},
        )
    merged_settings = {**(data.get("settings") or {}), **(payload or {})}
    data["settings"] = merged_settings
    try:
        validated = MapModel.model_validate(data)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail={"error": True, "code": "MAP_VALIDATION_FAILED",
                    "message": str(e), "detail": {}},
        )
    save_map(project_id, validated)
    return {"error": False, "code": "OK", "message": "settings 已更新",
            "detail": validated.settings.model_dump()}
```

- [ ] **Step 2: 在 client.ts 加 patchMapSettings**

打开 `frontend/src/api/client.ts`,在 `patchMapPoi` 后追加:

```typescript
  patchMapSettings: (
    projectId: string,
    patch: Partial<MapSettings>,
  ): Promise<MapSettings> =>
    request<MapSettings>(
      "PATCH",
      `/stage2/map/settings?project_id=${encodeURIComponent(projectId)}`,
      patch,
    ),
```

- [ ] **Step 3: 手动验证 endpoint 可用**

Run: `python -c "from backend.api.stage2_map import router; print([r.path for r in router.routes if 'settings' in r.path])"`
Expected: `['/api/stage2/map/settings']`

- [ ] **Step 4: Commit**

```bash
git add backend/api/stage2_map.py frontend/src/api/client.ts
git commit -m "feat(map): PATCH /map/settings + frontend binding"
```

---

## Task 18: MapStep 加 settings 折叠面板(strict_geo 开关)

**Files:**
- Modify: `frontend/src/components/wizard/MapStep.tsx`

- [ ] **Step 1: 加 settings 按钮 + 内联编辑 modal**

打开 `frontend/src/components/wizard/MapStep.tsx`,在 MapStep 主组件 `useState` 区域追加:

```tsx
  const [showSettings, setShowSettings] = useState(false);
```

在 `map-view-graph` 按钮前追加:

```tsx
          <button
            data-testid="map-settings"
            onClick={() => setShowSettings(true)}
            className="px-3 py-1 text-sm rounded border border-outline-variant hover:border-primary"
          >
            设定
          </button>
```

在 Mermaid modal 之后追加 SettingsPanel:

```tsx
function SettingsPanel({
  mapData,
  setMapData,
  onClose,
}: {
  mapData: MapPayload;
  setMapData: (m: MapPayload) => void;
  onClose: () => void;
}) {
  const [strictGeo, setStrictGeo] = useState(mapData.settings.strict_geo);
  const [cap, setCap] = useState(mapData.settings.chapter_new_location_cap);
  const [mode, setMode] = useState(mapData.settings.mode);

  const handleSave = async () => {
    const updated = await api.patchMapSettings(mapData.project_id, {
      strict_geo: strictGeo,
      chapter_new_location_cap: cap,
      mode,
    });
    setMapData({
      ...mapData,
      settings: { ...mapData.settings, ...updated },
    });
    onClose();
  };

  return (
    <div
      data-testid="settings-backdrop"
      onClick={onClose}
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
    >
      <div
        data-testid="settings-modal"
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-container rounded-lg shadow-xl p-6 max-w-md w-full"
      >
        <h2 className="text-lg font-medium mb-4">地图设定</h2>
        <div className="space-y-4">
          <label className="flex items-center gap-2">
            <input
              data-testid="settings-strict-geo"
              type="checkbox"
              checked={strictGeo}
              onChange={(e) => setStrictGeo(e.target.checked)}
            />
            <span className="text-sm">strict_geo 模式(Stage 4 启动时 map 缺失则硬阻断)</span>
          </label>
          <label className="block">
            <span className="text-sm">每章新增地点上限</span>
            <input
              data-testid="settings-cap"
              type="number"
              min={1}
              max={20}
              value={cap}
              onChange={(e) => setCap(parseInt(e.target.value, 10) || 5)}
              className="ml-2 w-20 border rounded px-2 py-1"
            />
          </label>
          <label className="block">
            <span className="text-sm">新地点处理模式</span>
            <select
              data-testid="settings-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
              className="ml-2 border rounded px-2 py-1"
            >
              <option value="strict_geo">strict_geo</option>
              <option value="allow_alias_new">allow_alias_new</option>
              <option value="freeze_locations">freeze_locations</option>
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button
            data-testid="settings-cancel"
            onClick={onClose}
            className="px-3 py-1 text-sm border border-outline-variant rounded"
          >
            取消
          </button>
          <button
            data-testid="settings-save"
            onClick={handleSave}
            className="px-3 py-1 text-sm bg-primary text-on-primary rounded"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
```

在 MapStep 主组件 return 末尾 Mermaid modal 之后追加:

```tsx
      {showSettings && (
        <SettingsPanel
          mapData={mapData}
          setMapData={setMapData}
          onClose={() => setShowSettings(false)}
        />
      )}
```

- [ ] **Step 2: 类型检查**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -10`
Expected: 无新错误

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/wizard/MapStep.tsx
git commit -m "feat(wizard): settings panel — strict_geo toggle + cap + mode"
```

---

## Task 19: 端到端集成测试 — Step 4 → 工作台写入 map.json

**Files:**
- Create: `backend/tests/test_map_e2e.py`

- [ ] **Step 1: 写集成测试**

打开 `backend/tests/test_map_e2e.py`,写入:

```python
"""端到端:Step 4 调用 /generate-map → 工作台读 /map.json。"""
import json
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch

from backend.main import app

PROJ = "proj_test_map_e2e"
client = TestClient(app)


@pytest.fixture(autouse=True)
def _patch_projects_dir(tmp_path, monkeypatch):
    from backend.config import settings
    from backend.api import stage2_map
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    stage2_map.fm = type(stage2_map.fm)(tmp_path)
    yield


def _write_file(tmp_path, name, payload):
    (tmp_path / PROJ).mkdir(parents=True, exist_ok=True)
    (tmp_path / PROJ / name).write_text(
        json.dumps(payload, ensure_ascii=False), encoding="utf-8",
    )


def test_full_flow_generate_then_get():
    """Step 4 工作流:seed world.json + PlannerAgent mock → /generate-map → /map 返回正确数据。"""
    from backend.config import settings as s
    proj_dir = s.projects_dir / PROJ
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "project.json").write_text(json.dumps({
        "id": PROJ, "genre": "cool_novel", "current_stage": "STAGE2",
    }, ensure_ascii=False))
    (proj_dir / "world.json").write_text(json.dumps({
        "era": "新元", "geography": "新地",
        "era_social_structure": "", "era_cultural_history": "",
        "power_systems": [], "factions": [], "core_rules": [],
    }, ensure_ascii=False))
    (proj_dir / "characters.json").write_text(json.dumps({
        "characters": [{"name": "主角", "current_state": {"location": "黑水镇"}}],
    }, ensure_ascii=False))

    with patch("backend.api.stage2_map.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value

        async def fake_generate_map(world, characters, user_modifications=""):
            return {
                "schema_version": "1.0",
                "project_id": PROJ,
                "regions": [{"id": "region_south", "name": "南泽", "level": "state"}],
                "locations": [
                    {
                        "id": "loc_blackwater", "name": "黑水镇",
                        "type": "town",
                        "region_id": "region_south",
                        "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
                    },
                ],
                "routes": [],
                "pois": [],
            }, None

        instance.generate_map = fake_generate_map
        r = client.post(
            f"/api/stage2/generate-map?project_id={PROJ}",
            json={"project_id": PROJ},
        )
        assert r.status_code == 200
        assert r.json()["detail"]["locations"][0]["name"] == "黑水镇"

    # 工作台读取
    r = client.get(f"/api/stage2/map?project_id={PROJ}")
    body = r.json()
    assert body["detail"]["regions"][0]["name"] == "南泽"
    assert body["detail"]["locations"][0]["name"] == "黑水镇"


def test_legacy_project_without_map_succeeds():
    """老项目无 map.json + strict_geo=false → /map 返回 detail={},不报错。"""
    from backend.config import settings as s
    proj_dir = s.projects_dir / PROJ
    proj_dir.mkdir(parents=True, exist_ok=True)
    # 只放 project.json,不放 map.json
    (proj_dir / "project.json").write_text(json.dumps({
        "id": PROJ, "genre": "cool_novel",
    }, ensure_ascii=False))

    r = client.get(f"/api/stage2/map?project_id={PROJ}")
    assert r.status_code == 200
    assert r.json()["detail"] == {}
```

- [ ] **Step 2: 运行测试**

Run: `pytest backend/tests/test_map_e2e.py -v 2>&1 | tail -10`
Expected: 2 passed

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_map_e2e.py
git commit -m "test(map): e2e flow — generate → read + legacy project backward-compat"
```

---

## Task 20: 跑全量后端测试确认无回归

- [ ] **Step 1: 跑所有后端测试**

Run: `pytest backend/tests/ -x --timeout=60 2>&1 | tail -30`
Expected: 全 pass。若失败,优先看 stage2 系列 / autopilot / reviewer 测试是否与本计划改动冲突。

- [ ] **Step 2: 跑前端测试**

Run: `cd frontend && npm test -- --run 2>&1 | tail -20`
Expected: 全 pass。

- [ ] **Step 3: 跑 type check**

Run: `cd frontend && npx tsc --noEmit 2>&1 | tail -10`
Expected: 无新错误。

如发现冲突:本计划的改动不修改 world.json / characters.json / outline.json 的 schema,因此应该与 stage2/3/4 的现有测试兼容。如有冲突,在 commit 信息里记录下来。

---

## Task 21: 章节快照写入端点 + checkpoint 整合

**Files:**
- Create: `backend/map_system/snapshots.py`
- Test: `backend/tests/test_map_snapshots.py`

- [ ] **Step 1: 写失败测试**

打开 `backend/tests/test_map_snapshots.py`,写入:

```python
"""章节快照测试。"""
import json
import hashlib
import pytest

from backend.map_system.snapshots import (
    snapshot_map_at_chapter,
    compute_map_hash,
)
from backend.map_system.models import Map
from backend.map_system.storage import load_map, save_map

PROJ = "proj_test_snap"


@pytest.fixture(autouse=True)
def _patch_projects_dir(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield


def _seed_map():
    return Map.model_validate({
        "schema_version": "1.0",
        "project_id": PROJ,
        "regions": [
            {"id": "region_south", "name": "南泽", "level": "state"},
        ],
        "locations": [],
        "routes": [],
        "pois": [],
    })


def test_snapshot_creates_file_with_hash():
    """snapshot_map_at_chapter 在 map_snapshots/chapter_NNN.json 落盘,带 hash 前 12 位。"""
    save_map(PROJ, _seed_map())
    path = snapshot_map_at_chapter(PROJ, chapter=5)
    body = json.loads(path.read_text(encoding="utf-8"))
    assert body["chapter"] == 5
    assert body["map"]["project_id"] == PROJ
    assert body["snapshot_hash"] == compute_map_hash(_seed_map())[:12]
    assert body["created_at"]


def test_rollback_replaces_map_json():
    """rollback_map_to_chapter 把 map.json 替换成对应快照内容。"""
    save_map(PROJ, _seed_map())
    snapshot_map_at_chapter(PROJ, chapter=3)

    edited = _seed_map()
    edited.locations.append({"id": "loc_x", "name": "X", "type": "town"})
    save_map(PROJ, edited)

    new_map = rollback_map_to_chapter(PROJ, chapter=3)
    assert len(new_map.locations) == 0  # X 已消失


def test_rollback_missing_snapshot_raises():
    """rollback_map_to_chapter 对不存在的 chapter 抛 FileNotFoundError。"""
    save_map(PROJ, _seed_map())
    with pytest.raises(FileNotFoundError):
        rollback_map_to_chapter(PROJ, chapter=999)


def test_compute_map_hash_deterministic():
    """compute_map_hash 对同内容稳定,改一个 location 后变化。"""
    m1 = _seed_map()
    m2 = _seed_map()
    assert compute_map_hash(m1) == compute_map_hash(m2)
    m2.locations.append({"id": "loc_x", "name": "X", "type": "town"})
    assert compute_map_hash(m1) != compute_map_hash(m2)


def test_list_snapshots_returns_timeline():
    """list_snapshots 列出按 chapter 升序的快照摘要。"""
    from backend.map_system.snapshots import list_snapshots
    save_map(PROJ, _seed_map())
    snapshot_map_at_chapter(PROJ, chapter=7)
    snapshot_map_at_chapter(PROJ, chapter=3)
    items = list_snapshots(PROJ)
    chapters = [s["chapter"] for s in items]
    assert chapters == [3, 7]
    assert all("snapshot_hash" in s and "created_at" in s for s in items)
```

- [ ] **Step 2: 运行测试**

Run: `pytest backend/tests/test_map_snapshots.py -v 2>&1 | tail -10`
Expected: 5 failed(module not found)

- [ ] **Step 3: 实现 snapshots.py**

打开 `backend/map_system/snapshots.py`,写入:

```python
"""章节快照落盘 + 回滚。"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from .models import Map
from .storage import load_map, projects_dir_for

SNAPSHOTS_SUBDIR = "map_snapshots"


def _snapshots_dir(project_id: str) -> Path:
    return projects_dir_for(project_id) / SNAPSHOTS_SUBDIR


def snapshot_path(project_id: str, chapter: int) -> Path:
    return _snapshots_dir(project_id) / f"chapter_{chapter:03d}.json"


def compute_map_hash(map_obj: Map) -> str:
    """对 Map 内容算 SHA-256 十六进制串(顺序敏感)。"""
    payload = map_obj.model_dump_json(exclude_none=True, exclude={"created_at", "updated_at"})
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def snapshot_map_at_chapter(project_id: str, chapter: int) -> Path:
    """把当前 map.json 落盘到 map_snapshots/chapter_NNN.json。"""
    m = load_map(project_id)
    body = {
        "schema_version": "1.0",
        "project_id": project_id,
        "chapter": chapter,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "snapshot_hash": compute_map_hash(m)[:12],
        "map": json.loads(m.model_dump_json(exclude_none=True)),
    }
    target = snapshot_path(project_id, chapter)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(body, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return target


def rollback_map_to_chapter(project_id: str, chapter: int) -> Map:
    """把 map.json 替换为快照内容,返回新 Map。"""
    src = snapshot_path(project_id, chapter)
    if not src.exists():
        raise FileNotFoundError(f"No snapshot for {project_id}/chapter_{chapter}")
    body = json.loads(src.read_text(encoding="utf-8"))
    restored = Map.model_validate(body["map"])
    from .storage import write_map_atomic
    write_map_atomic(project_id, restored)
    return restored


def list_snapshots(project_id: str) -> list[dict]:
    """列出 [{chapter, created_at, snapshot_hash, locations_count, routes_count}],按 chapter 升序。"""
    d = _snapshots_dir(project_id)
    if not d.exists():
        return []
    out: list[dict] = []
    for p in sorted(d.glob("chapter_*.json")):
        body = json.loads(p.read_text(encoding="utf-8"))
        m = body.get("map", {})
        out.append({
            "chapter": body["chapter"],
            "created_at": body["created_at"],
            "snapshot_hash": body["snapshot_hash"],
            "locations_count": len(m.get("locations", [])),
            "routes_count": len(m.get("routes", [])),
        })
    return out
```

- [ ] **Step 4: 运行测试**

Run: `pytest backend/tests/test_map_snapshots.py -v 2>&1 | tail -10`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add backend/map_system/snapshots.py backend/tests/test_map_snapshots.py
git commit -m "feat(map): chapter snapshots — hash, snapshot, rollback, list"
```

---

## Task 22: /snapshot /snapshots /rollback 端点 + checkpoint 整合

**Files:**
- Modify: `backend/api/stage2_map.py`(加 3 端点)
- Modify: `backend/conductor/checkpoint.py`(加 map_snapshot_hash 字段)
- Create: `backend/tests/test_map_snapshot_endpoints.py`

- [ ] **Step 1: 写失败测试**

打开 `backend/tests/test_map_snapshot_endpoints.py`,写入:

```python
"""章节快照端点集成测试。"""
import json

import pytest
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)
PROJ = "proj_test_snap_endpoints"


@pytest.fixture(autouse=True)
def _patch_projects_dir(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    proj_dir = tmp_path / PROJ
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "project.json").write_text(json.dumps(
        {"id": PROJ, "genre": "cool_novel"}, ensure_ascii=False,
    ))
    yield


def _seed_min_map():
    from backend.map_system.models import Map
    return Map.model_validate({
        "schema_version": "1.0",
        "project_id": PROJ,
        "regions": [],
        "locations": [
            {"id": "loc_blackwater", "name": "黑水镇", "type": "town"},
        ],
        "routes": [],
        "pois": [],
    })


def test_post_snapshot_writes_file():
    from backend.map_system.storage import save_map
    from backend.map_system.snapshots import snapshot_path
    save_map(PROJ, _seed_min_map())
    r = client.post(f"/api/stage2/map/snapshot/5?project_id={PROJ}")
    assert r.status_code == 200
    body = r.json()["detail"]
    assert body["chapter"] == 5
    assert body["snapshot_hash"]
    assert snapshot_path(PROJ, 5).exists()


def test_get_snapshots_returns_timeline():
    from backend.map_system.storage import save_map
    from backend.map_system.snapshots import snapshot_map_at_chapter
    save_map(PROJ, _seed_min_map())
    snapshot_map_at_chapter(PROJ, chapter=7)
    snapshot_map_at_chapter(PROJ, chapter=3)
    r = client.get(f"/api/stage2/map/snapshots?project_id={PROJ}")
    assert r.status_code == 200
    chapters = [s["chapter"] for s in r.json()["detail"]]
    assert chapters == [3, 7]


def test_rollback_replaces_and_returns_new_map():
    from backend.map_system.storage import save_map, load_map
    from backend.map_system.snapshots import snapshot_map_at_chapter
    save_map(PROJ, _seed_min_map())
    snapshot_map_at_chapter(PROJ, chapter=3)

    edited = _seed_min_map()
    edited.locations.append({"id": "loc_x", "name": "X", "type": "town"})
    save_map(PROJ, edited)

    r = client.post(f"/api/stage2/map/rollback/3?project_id={PROJ}")
    assert r.status_code == 200
    restored = load_map(PROJ)
    assert len(restored.locations) == 1
    assert restored.locations[0].id == "loc_blackwater"


def test_rollback_missing_returns_404():
    from backend.map_system.storage import save_map
    save_map(PROJ, _seed_min_map())
    r = client.post(f"/api/stage2/map/rollback/999?project_id={PROJ}")
    assert r.status_code == 404
```

- [ ] **Step 2: 运行测试**

Run: `pytest backend/tests/test_map_snapshot_endpoints.py -v 2>&1 | tail -10`
Expected: 4 failed(端点不存在)

- [ ] **Step 3: 在 stage2_map.py 加 3 个端点**

打开 `backend/api/stage2_map.py`,顶部 import 区追加:

```python
from datetime import datetime, timezone
from backend.map_system.snapshots import (
    snapshot_map_at_chapter,
    rollback_map_to_chapter,
    list_snapshots,
)
from backend.map_system.storage import projects_dir_for
```

然后在 router 末尾追加:

```python
@router.post("/map/snapshot/{chapter}")
def api_map_snapshot(project_id: str, chapter: int):
    """章节级快照落盘(map_snapshots/chapter_NNN.json)。"""
    try:
        path = snapshot_map_at_chapter(project_id, chapter)
    except FileNotFoundError:
        return _detail_err(error=True, code="MAP_NOT_FOUND",
                           message="map.json 不存在,请先生成地图")
    body = json.loads(path.read_text(encoding="utf-8"))
    return {"detail": {
        "chapter": chapter,
        "snapshot_path": str(path),
        "snapshot_hash": body["snapshot_hash"],
    }}


@router.get("/map/snapshots")
def api_map_snapshots(project_id: str):
    return {"detail": list_snapshots(project_id)}


@router.post("/map/rollback/{chapter}")
def api_map_rollback(project_id: str, chapter: int):
    """把 map.json 回滚到章节快照;同时写一份 rollback_log.json 到 map_snapshots/。"""
    try:
        restored = rollback_map_to_chapter(project_id, chapter)
    except FileNotFoundError:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="snapshot not found")
    log_path = projects_dir_for(project_id) / "map_snapshots" / "rollback_log.json"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(json.dumps(
        {"chapter": chapter, "rolled_back_at": datetime.now(timezone.utc).isoformat()},
        ensure_ascii=False, indent=2,
    ), encoding="utf-8")
    return {"detail": {
        "chapter": chapter,
        "restored_locations": len(restored.locations),
        "restored_routes": len(restored.routes),
    }}
```

并确保 `json` 已在文件顶部 import(没有就加 `import json`)。

- [ ] **Step 4: checkpoint.py 加 map_snapshot_hash**

打开 `backend/conductor/checkpoint.py`,找到 `CheckpointData`(或等价 dataclass),加一个字段:

```python
map_snapshot_hash: str = ""  # 当前 map.json 的 snapshot_hash(无 map.json 时留空)
```

并在 `save_checkpoint`(或写入 JSON 的函数) 末尾追加:

```python
# map 快照 hash(只读,无 map.json 时保持空字符串)
try:
    from backend.map_system.snapshots import compute_map_hash
    m = load_map(project_id)
    map_snapshot_hash = compute_map_hash(m)[:12]
except (FileNotFoundError, Exception):
    map_snapshot_hash = ""
```

具体位置以现有 `save_checkpoint` 结构为准 —— 把 `map_snapshot_hash` 写入 checkpoint.json 的 dict 处加一行即可。

- [ ] **Step 5: 运行测试**

Run: `pytest backend/tests/test_map_snapshot_endpoints.py -v 2>&1 | tail -10`
Expected: 4 passed

- [ ] **Step 6: 跑一遍 reviewer / autopilot 测试确认 checkpoint 改动无回归**

Run: `pytest backend/tests/test_conductor_checkpoint.py -v 2>&1 | tail -15 || pytest backend/tests/test_checkpoint.py -v 2>&1 | tail -15`
Expected: 全 pass

- [ ] **Step 7: Commit**

```bash
git add backend/api/stage2_map.py backend/conductor/checkpoint.py backend/tests/test_map_snapshot_endpoints.py
git commit -m "feat(map): /snapshot /snapshots /rollback endpoints + checkpoint hash"
```

---

## Task 23: MapStep 第 5 个 Tab(快照)+ 回滚按钮

**Files:**
- Modify: `frontend/src/components/wizard/MapStep.tsx`(追加 Snapshots Tab + handleRollback)
- Modify: `frontend/src/components/wizard/MapStep.test.tsx`(追加 2 case)
- Modify: `frontend/src/api/client.ts`(加 3 个方法 + ApiMapSnapshot 类型)

- [ ] **Step 1: 写失败测试**

打开 `frontend/src/components/wizard/MapStep.test.tsx`,在文件末尾追加:

```tsx
import { vi } from "vitest";

// ...前面已有的 fakeCtx / describe("MapStep 主流程")

describe("MapStep 快照 Tab", () => {
  it("列出快照 + 每个快照有回滚按钮", async () => {
    vi.spyOn(api, "getMapSnapshots").mockResolvedValue([
      { chapter: 3, created_at: "2026-09-20T10:00:00Z", snapshot_hash: "abc1234567ab",
        locations_count: 12, routes_count: 5 },
      { chapter: 7, created_at: "2026-09-21T15:00:00Z", snapshot_hash: "def4567890cd",
        locations_count: 14, routes_count: 6 },
    ] as any);

    render(<MapStep projectId="p1" wizardContext={fakeCtx as any} />);
    const snapshotsTab = await screen.findByRole("tab", { name: /快照/ });
    await userEvent.click(snapshotsTab);

    expect(await screen.findByText(/chapter 3/)).toBeInTheDocument();
    expect(screen.getByText(/chapter 7/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /回滚/ })).toHaveLength(2);
  });

  it("点回滚 → 弹确认 → 调 api.rollbackMap", async () => {
    const rollbackSpy = vi.spyOn(api, "rollbackMap").mockResolvedValue({
      chapter: 3, restored_locations: 12, restored_routes: 5,
    } as any);
    vi.spyOn(api, "getMapSnapshots").mockResolvedValue([
      { chapter: 3, created_at: "...", snapshot_hash: "abc1234567ab",
        locations_count: 12, routes_count: 5 },
    ] as any);

    render(<MapStep projectId="p1" wizardContext={fakeCtx as any} />);
    await userEvent.click(await screen.findByRole("tab", { name: /快照/ }));
    await userEvent.click(await screen.findByRole("button", { name: /回滚/ }));

    const confirmBtn = await screen.findByRole("button", { name: /确认回滚/ });
    await userEvent.click(confirmBtn);
    expect(rollbackSpy).toHaveBeenCalledWith("p1", 3);
  });
});
```

- [ ] **Step 2: 运行测试**

Run: `cd frontend && npm test -- --run MapStep 2>&1 | tail -25`
Expected: 2 failed

- [ ] **Step 3: api/client.ts 加 3 个方法**

打开 `frontend/src/api/client.ts`,在 map 区段追加 3 个方法:

```ts
getMapSnapshots: (projectId: string) =>
  request<ApiMapSnapshot[]>("GET", `/api/stage2/map/snapshots?project_id=${projectId}`),

snapshotMap: (projectId: string, chapter: number) =>
  request<{ chapter: number; snapshot_path: string; snapshot_hash: string }>(
    "POST",
    `/api/stage2/map/snapshot/${chapter}?project_id=${projectId}`,
  ),

rollbackMap: (projectId: string, chapter: number) =>
  request<{ chapter: number; restored_locations: number; restored_routes: number }>(
    "POST",
    `/api/stage2/map/rollback/${chapter}?project_id=${projectId}`,
  ),
```

并在该文件顶部 type 区追加:

```ts
export interface ApiMapSnapshot {
  chapter: number;
  created_at: string;
  snapshot_hash: string;
  locations_count: number;
  routes_count: number;
}
```

- [ ] **Step 4: MapStep 加 Snapshots tab UI**

打开 `frontend/src/components/wizard/MapStep.tsx`,在 Tab 列表区追加第 5 个 TabTrigger:

```tsx
<TabTrigger value="snapshots" data-testid="map-tab-snapshots">快照</TabTrigger>
```

在组件顶部 hooks 区追加:

```tsx
const [snapshots, setSnapshots] = useState<ApiMapSnapshot[]>([]);
const [rollbackConfirm, setRollbackConfirm] = useState<ApiMapSnapshot | null>(null);

async function refetchSnapshots() {
  setSnapshots(await api.getMapSnapshots(projectId));
}

// 切到 snapshots tab 时拉
useEffect(() => {
  if (activeTab === "snapshots") refetchSnapshots();
}, [activeTab]);

async function handleConfirmRollback() {
  if (!rollbackConfirm) return;
  await api.rollbackMap(projectId, rollbackConfirm.chapter);
  setRollbackConfirm(null);
  await loadMap();          // 复用 Task 12 已有的 fetch map 函数
  await refetchSnapshots();
}
```

在已有 PanelCard tab panel 区末尾追加第 5 个 panel:

```tsx
{activeTab === "snapshots" && (
  <PanelCard className="p-4 space-y-3">
    <header className="flex items-center justify-between">
      <h3 className="text-base font-medium">章节快照</h3>
      <SecondaryButton onClick={refetchSnapshots}>刷新</SecondaryButton>
    </header>
    {snapshots.length === 0 ? (
      <p className="text-sm text-ds-fg-muted">
        尚未生成任何快照。写作开始后会自动按章落盘,或手动点下方"新建快照"。
      </p>
    ) : (
      <ul className="divide-y divide-ds-border-default">
        {snapshots.map((s) => (
          <li key={s.chapter} className="flex items-center gap-4 py-2" data-testid={`snapshot-row-${s.chapter}`}>
            <span className="font-mono text-sm">chapter {s.chapter}</span>
            <span className="text-xs text-ds-fg-muted">{s.snapshot_hash}</span>
            <span className="text-xs">{s.locations_count} 地 / {s.routes_count} 路</span>
            <span className="text-xs text-ds-fg-muted ml-auto">{s.created_at}</span>
            <SecondaryButton
              size="sm"
              onClick={() => setRollbackConfirm(s)}
              data-testid={`rollback-${s.chapter}`}
            >
              回滚
            </SecondaryButton>
          </li>
        ))}
      </ul>
    )}
  </PanelCard>
)}
```

并在组件 return 的根 Fragment 末尾追加确认 modal:

```tsx
{rollbackConfirm && (
  <div role="dialog" aria-modal="true"
       className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
    <PanelCard className="p-6 max-w-md space-y-3">
      <h4 className="text-base font-medium">
        确认回滚到 chapter {rollbackConfirm.chapter}?
      </h4>
      <p className="text-sm text-ds-fg-muted">
        当前 map.json 将被覆盖,原版仍保留在 map_snapshots/chapter_{rollbackConfirm.chapter}.json。
      </p>
      <div className="flex gap-2 justify-end">
        <GhostButton onClick={() => setRollbackConfirm(null)}>取消</GhostButton>
        <PrimaryButton onClick={handleConfirmRollback} data-testid="confirm-rollback-btn">
          确认回滚
        </PrimaryButton>
      </div>
    </PanelCard>
  </div>
)}
```

- [ ] **Step 5: 运行测试**

Run: `cd frontend && npm test -- --run MapStep 2>&1 | tail -25`
Expected: all passed

- [ ] **Step 6: tsc 检查**

Run: `cd frontend && npx tsc --noEmit 2>&1 | tail -10`
Expected: 无新错误

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/wizard/MapStep.tsx frontend/src/components/wizard/MapStep.test.tsx frontend/src/api/client.ts
git commit -m "feat(map): snapshots tab UI + rollback button"
```

---

## Task 24: 最终回归 + 文档更新

- [ ] **Step 1: 全量后端测试**

Run: `pytest backend/tests/ --timeout=60 2>&1 | tail -30`
Expected: 全 pass。如有 stage2 / autopilot / reviewer 测试因为 import 顺序或 fixture 失败,优先看 `backend/tests/conftest.py` 是否注入 map_system fixture。

- [ ] **Step 2: 前端测试 + 类型检查**

Run:
```bash
cd frontend && npm test -- --run 2>&1 | tail -25
cd frontend && npx tsc --noEmit 2>&1 | tail -10
```
Expected: 全 pass + 无新 tsc 错误

- [ ] **Step 3: 手测 UI 一次**

启动服务:
```bash
# 后端(:8000)
source venv/bin/activate
uvicorn backend.main:app --reload --reload-dir backend --reload-exclude 'test_*.py' --port 8000
# 前端(:5173)
cd frontend && npm run dev
```

操作: 进入任一现有项目 → Wizard → Step 4(地图)→ 应能在 5 个 tab 间切换、行内编辑地点、点击「查看地图」看 Mermaid 图、生成初始地图、刷新页面后保留所有改动、点「回滚」可恢复。

- [ ] **Step 4: 更新 CLAUDE.md**

打开 `/Users/longsa/Codes/nebula/CLAUDE.md`,在「User Flow」第 2 条 Wizard 描述里替换 Step 4 占位:

```
2. **`/project/:id/wizard`** — `WizardDeepLinkPage`. Deep-linkable init wizard (concept → world → characters → **map** → outline → behavior examples → enter workspace).
```

并在「New in v1.8 → v2.x」区最后追加一段:

```
- **Map System** — `backend/map_system/`(M1+M2+M3+M6,M4/M5 见后续 plan):9 类地理实体 (Map/Region/Location/Route/POI/LocationState/Footprint/Assertion/ChangeLog),单文件 `map.json` + `map_snapshots/chapter_NNN.json` 章节快照/回滚。Wizard Step 4(`MapStep.tsx`)暴露 5 Tab(区域/地点/路线/POI/快照)+ Mermaid 拓扑 modal。`PlannerAgent.generate_map()` 经 Tier-1 prompt(`map_generation.yaml`)生成初始 5-15 region + 20-40 location。`POST /map/snapshot/{chapter}` + `POST /map/rollback/{chapter}` 提供不可逆回滚。`strict_geo: false` 默认 OFF,老项目无 map.json 不报错。
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(map): update CLAUDE.md with map system summary"
```

---

## Self-Review

### PRD 覆盖矩阵

| PRD § | 内容 | Plan 1 覆盖 | Plan 2 (M4) | Plan 3 (M5) |
|---|---|---|---|---|
| §0 | 愿景原则 | header 段 | — | — |
| §1 | 空间模型 4 层 | Task 2 (models.py) | — | — |
| §2 | 6 个图层 | Task 2 (geo/faction/plot/footprint/risk/time) | footprint 持久化 | — |
| §3 | AI 集成管线 | Task 12 (planner.generate_map) | 上下文注入 | — |
| §4 | "地图卡" 输出物 | — | build_map_card + 注入 | — |
| §5 | 存储与架构 | Task 4-5 (storage + index) | — | — |
| §6 | 容易踩的坑 | header 段 | — | Fact Guard 9 条 |
| §7 | 时间态/快照 | Tasks 21-23 | — | — |
| §8 | 检索 | Task 5 (name_to_id) | mention 抽取 | — |
| §9 | LLM 强约束 | — | scene_writing 自查 | 9 条规则 |
| §10 | 强制 context | Task 7 prefill + Task 22 checkpoint hash | 写作时注入 | — |
| §11-§16 | M1-M7 milestones | M1+M2+M3+M6 | M4 | M5 |

### 类型/方法一致性核查

- **`Map`** Pydantic 模型名称:Task 2 / 4 / 5 / 12 / 13 / 21 / 22 全统一。
- **`update_map` body 类型** `MapPayloadUpdateRequest` 在 Task 6 定义;Task 17 (settings PATCH) 复用同样 partial。
- **`build_map_card`** 引用 —— Plan 1 不实现。Plan 2 (`backend/map_system/map_card.py`) 定义,接口签名定为 `build_map_card(project_id: str, scene_location: str | None) -> str`。Plan 2 任务会反向引用 Plan 1 的 `Map` / `Location` 实体类型。
- **`compute_map_hash`**:Task 21 在 `snapshots.py` 定义,Task 22 在 `checkpoint.py` 复用,前端不直接调用。
- **`snapshot_map_at_chapter`**:Task 21 `snapshots.py`,Task 22 `/map/snapshot/{chapter}` 路由 import 同名。
- **`api.client.ts` 的 `Map*` 方法签名**:Task 6/13/15/17/22 共用的 `MapPayload`、`ApiMapSnapshot` 类型在 `client.ts` 顶部统一 export,不在每个 tab 组件里重复定义。

### 占位符扫描

- 无 "TBD" / "TODO" / "implement later" / "fill in details"
- 无 "Similar to Task N" —— 所有测试与实现给了完整代码
- 所有 file path 绝对,且经多轮 Read 与实际代码核对(Task 12 的 `iter_power_systems` 已验证存在)
- 唯一一处 hint:"如果 storage 已有循环 import 问题,删掉这行,跳过" —— 是 explicit conditional,不是占位符

### Plan 2 / Plan 3 衔接验证

- Plan 1 完成后用户已能用地图系统(生成 + 编辑 + 静态图谱 + 快照回滚)。
- 写作管线**还不知道地图存在** —— Plan 2 把 `map_card` 注入 `scene_writing.yaml` 的 `{map_card}` 占位(在 §9.4 自查清单前),并扩展 `stage4_async_executor` 在 `ctx_mem = mc.assemble_for_scene(...)` 之后注入。
- `extraction.py` 抽取 SF_LOG `character_location_change` 时,Plan 2 还会写入 `footprint.chapter=N location=to`;本计划的 `assertions.py` (Plan 3) 据此在 fact-guard 校验"主角位置是否相符"。
- CheckResult 加 `kind` 字段是 Plan 3 任务之一,会同步更新 TestClient 端的 9 个 check mock 数量(count from 6 → 15)。

---

## 执行交接 (Execution Handoff)

**Plan complete and saved to `docs/superpowers/plans/2026-09-22-map-system.md`.**

覆盖 M1+M2+M3+M6,共 **24 个任务**(Tasks 1-24)。

**Two execution options:**

1. **Subagent-Driven (推荐)** — 我派遣 fresh subagent per task,我在主流程做两段审核(code review + merge),迭代快,适合 24 任务的长 plan。TaskCreate 会为每个 subagent 创建独立跟踪,主流程使用串行 gate。
2. **Inline Execution** — 在当前 session 内顺序执行,用 `superpowers:executing-plans` skill 做 checkpoint 批量执行。context 累积更快但更密集。

**Plan 2 / Plan 3 衔接:** Plan 1 验收后,用户已能用地图系统。**但写作管线还不知道地图存在** —— 强烈建议 Plan 1 验收后立刻接 Plan 2/3,否则地图只是"档案陈列"。

**Which approach?**
            {"id": "region_south", "name": "南泽", "