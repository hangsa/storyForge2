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
# 注:backend.map_system.models 已定义同字面量 AssertionKind,这里保留 RuleKind
# 是为了 RuleResult 在断言模块内自包含(types.py 拆分在后续 refactor 处理)。


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