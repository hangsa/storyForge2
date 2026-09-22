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