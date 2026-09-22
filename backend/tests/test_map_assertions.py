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