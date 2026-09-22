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


def test_route_to_unknown_location_raises_references_error():
    """Map._validate_references 必须捕获 route 引用未知 location。"""
    from pydantic import ValidationError
    with pytest.raises(ValidationError, match="Route references unknown location"):
        Map.model_validate({
            "schema_version": "1.0",
            "project_id": "p",
            "regions": [],
            "locations": [{"id": "loc_a", "name": "A", "type": "town",
                           "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""}}],
            "routes": [{"id": "route_x", "from": "loc_missing", "to": "loc_a", "est_travel_minutes": 10}],
        })


def test_location_referencing_unknown_region_raises():
    from pydantic import ValidationError
    with pytest.raises(ValidationError, match="references unknown region"):
        Map.model_validate({
            "schema_version": "1.0",
            "project_id": "p",
            "regions": [{"id": "region_a", "name": "A", "level": "state"}],
            "locations": [{"id": "loc_a", "name": "A", "type": "town",
                           "region_id": "region_missing",
                           "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""}}],
        })


def test_poi_referencing_unknown_location_raises():
    from pydantic import ValidationError
    with pytest.raises(ValidationError, match="references unknown location"):
        Map.model_validate({
            "schema_version": "1.0",
            "project_id": "p",
            "regions": [],
            "locations": [{"id": "loc_a", "name": "A", "type": "town",
                           "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""}}],
            "pois": [{"id": "poi_x", "name": "X", "parent_location_id": "loc_missing"}],
        })


def test_region_parent_id_references_unknown_region_raises():
    """Region.parent_id 必须交叉校验到 region_ids(否则 region 之间悬挂)。"""
    from pydantic import ValidationError
    with pytest.raises(ValidationError, match="Region.*parent_id.*unknown"):
        Map.model_validate({
            "schema_version": "1.0",
            "project_id": "p",
            "regions": [
                {"id": "region_a", "name": "A", "level": "state"},
                {"id": "region_b", "name": "B", "level": "state", "parent_id": "region_missing"},
            ],
        })
