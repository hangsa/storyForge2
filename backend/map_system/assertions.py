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