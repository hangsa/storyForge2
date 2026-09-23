"""Stage2 /map API 端点测试 — TDD 起步 (GET / PUT)。"""
import json
from unittest.mock import patch

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


def test_generate_map_returns_400_when_no_world():
    """POST with project.json but without world.json → 400/422 (precondition)."""
    from backend.config import settings as s

    proj_dir = s.projects_dir / PROJ
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "project.json").write_text(
        json.dumps({"project_id": PROJ, "genre": "cool_novel"}, ensure_ascii=False),
        encoding="utf-8",
    )
    r = client.post(
        f"/api/stage2/generate-map?project_id={PROJ}",
        json={"project_id": PROJ},
    )
    assert r.status_code in (400, 422)


def test_patch_location_updates_field():
    """PATCH /map/location/{id} 只更新传入字段,其他 byte-preserve。"""
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
    }, ensure_ascii=False), encoding="utf-8")

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
    }, ensure_ascii=False), encoding="utf-8")

    r = client.delete(
        f"/api/stage2/map/location/loc_a?project_id={PROJ}",
    )
    assert r.status_code == 422
    body = r.json()
    assert body["detail"]["code"] == "LOCATION_REFERENCED_BY_ROUTES"


def test_generate_map_invokes_planner_and_saves():
    """happy path: world.json exists + PlannerAgent mock returns → /generate-map writes map.json."""
    from backend.config import settings as s

    proj_dir = s.projects_dir / PROJ
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "project.json").write_text(
        json.dumps({"project_id": PROJ, "genre": "cool_novel"}, ensure_ascii=False),
        encoding="utf-8",
    )
    (proj_dir / "world.json").write_text(
        json.dumps({
            "era": "新元", "geography": "新地",
            "era_social_structure": "", "era_cultural_history": "",
            "power_systems": [], "factions": [], "core_rules": [],
        }, ensure_ascii=False),
        encoding="utf-8",
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


# ===========================================================================
# Defensive coerce tests (TDD: written first, helper added in stage2_map.py)
# proj_47738f64 (2026-09-22): LLM returned 32 locations with type values
# outside LocationType Literal AND dramatic_role.wanted_by /
# decisions_unlocked as Chinese free-text strings instead of list[str].
# ===========================================================================

from backend.api.stage2_map import _coerce_map_payload  # noqa: E402


def _wrap(loc):
    """Build a minimal valid-looking map dict containing one location."""
    return {
        "schema_version": "1.0",
        "project_id": PROJ,
        "regions": [],
        "locations": [loc],
        "routes": [],
        "pois": [],
    }


def test_coerce_unknown_location_type_to_room():
    """Unknown type strings default to 'room' (safest indoor default)."""
    loc = {
        "id": "loc_x", "name": "x", "type": "classroom",
        "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
    }
    out = _coerce_map_payload(_wrap(loc))
    assert out["locations"][0]["type"] == "room"


def test_coerce_uppercase_location_type():
    """Uppercase 'Room' → lowercased to 'room'."""
    loc = {
        "id": "loc_x", "name": "x", "type": "Room",
        "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
    }
    out = _coerce_map_payload(_wrap(loc))
    assert out["locations"][0]["type"] == "room"


def test_coerce_valid_location_type_passes_through():
    """Valid lowercase type passes through unchanged."""
    loc = {
        "id": "loc_x", "name": "x", "type": "city",
        "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
    }
    out = _coerce_map_payload(_wrap(loc))
    assert out["locations"][0]["type"] == "city"


def test_coerce_string_wanted_by_split_on_dun_hao():
    """Chinese 、 separator → split into list."""
    loc = {
        "id": "loc_x", "name": "x", "type": "city",
        "dramatic_role": {
            "wanted_by": "江也、孟槐、残页会",
            "decisions_unlocked": [],
            "departure_cost": "",
        },
    }
    out = _coerce_map_payload(_wrap(loc))
    assert out["locations"][0]["dramatic_role"]["wanted_by"] == ["江也", "孟槐", "残页会"]


def test_coerce_string_wanted_by_split_on_comma():
    """English comma separator → split into list."""
    loc = {
        "id": "loc_x", "name": "x", "type": "city",
        "dramatic_role": {
            "wanted_by": "alice, bob, carol",
            "decisions_unlocked": [],
            "departure_cost": "",
        },
    }
    out = _coerce_map_payload(_wrap(loc))
    assert out["locations"][0]["dramatic_role"]["wanted_by"] == ["alice", "bob", "carol"]


def test_coerce_string_wanted_by_split_on_semicolon():
    """English semicolon ; separator → split into list."""
    loc = {
        "id": "loc_x", "name": "x", "type": "city",
        "dramatic_role": {
            "wanted_by": "alice; bob",
            "decisions_unlocked": [],
            "departure_cost": "",
        },
    }
    out = _coerce_map_payload(_wrap(loc))
    assert out["locations"][0]["dramatic_role"]["wanted_by"] == ["alice", "bob"]


def test_coerce_list_wanted_by_unchanged():
    """Already-list values pass through."""
    loc = {
        "id": "loc_x", "name": "x", "type": "city",
        "dramatic_role": {
            "wanted_by": ["a", "b"],
            "decisions_unlocked": [],
            "departure_cost": "",
        },
    }
    out = _coerce_map_payload(_wrap(loc))
    assert out["locations"][0]["dramatic_role"]["wanted_by"] == ["a", "b"]


def test_coerce_empty_string_wanted_by_to_empty_list():
    """Empty string → empty list."""
    loc = {
        "id": "loc_x", "name": "x", "type": "city",
        "dramatic_role": {
            "wanted_by": "",
            "decisions_unlocked": "",
            "departure_cost": "",
        },
    }
    out = _coerce_map_payload(_wrap(loc))
    assert out["locations"][0]["dramatic_role"]["wanted_by"] == []
    assert out["locations"][0]["dramatic_role"]["decisions_unlocked"] == []


def test_coerce_drops_empty_items_after_split():
    """Whitespace and empty items dropped after split."""
    loc = {
        "id": "loc_x", "name": "x", "type": "city",
        "dramatic_role": {
            "wanted_by": "a, , b,",
            "decisions_unlocked": [],
            "departure_cost": "",
        },
    }
    out = _coerce_map_payload(_wrap(loc))
    assert out["locations"][0]["dramatic_role"]["wanted_by"] == ["a", "b"]


def test_coerce_departure_cost_string_unchanged():
    """departure_cost is a str field — not touched."""
    loc = {
        "id": "loc_x", "name": "x", "type": "city",
        "dramatic_role": {
            "wanted_by": [],
            "decisions_unlocked": [],
            "departure_cost": "leaving costs you",
        },
    }
    out = _coerce_map_payload(_wrap(loc))
    assert out["locations"][0]["dramatic_role"]["departure_cost"] == "leaving costs you"


def test_generate_map_endpoint_succeeds_with_dirty_llm_output():
    """End-to-end: synthesize a DeepSeek-style dirty payload (unknown types +
    string wanted_by/decisions_unlocked), mock LLM, hit /generate-map → 200."""
    from backend.config import settings as s

    proj_dir = s.projects_dir / PROJ
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "project.json").write_text(
        json.dumps({"project_id": PROJ, "genre": "cool_novel"}, ensure_ascii=False),
        encoding="utf-8",
    )
    (proj_dir / "world.json").write_text(
        json.dumps({
            "era": "新元", "geography": "新地",
            "era_social_structure": "", "era_cultural_history": "",
            "power_systems": [], "factions": [], "core_rules": [],
        }, ensure_ascii=False),
        encoding="utf-8",
    )

    dirty_locations = []
    for i in range(3):
        dirty_locations.append({
            "id": f"loc_{i:04x}", "name": f"loc_{i}", "type": "classroom",
            "dramatic_role": {
                "wanted_by": "江也、孟槐、残页会成员",
                "decisions_unlocked": "决定苏迟是否把窗帘缝起来",
                "departure_cost": "leaving is costly",
            },
        })

    with patch("backend.api.stage2_map.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value

        async def fake_generate_map(world, characters, user_modifications=""):
            return {
                "schema_version": "1.0",
                "project_id": PROJ,
                "regions": [],
                "locations": dirty_locations,
                "routes": [],
                "pois": [],
            }, None

        instance.generate_map = fake_generate_map
        r = client.post(
            f"/api/stage2/generate-map?project_id={PROJ}",
            json={"project_id": PROJ, "user_modifications": ""},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["error"] is False
        # All dirty types coerced to 'room'
        for loc in body["detail"]["locations"]:
            assert loc["type"] == "room"
        # wanted_by split into list
        assert body["detail"]["locations"][0]["dramatic_role"]["wanted_by"] == ["江也", "孟槐", "残页会成员"]
        # decisions_unlocked split into list
        assert body["detail"]["locations"][0]["dramatic_role"]["decisions_unlocked"] == ["决定苏迟是否把窗帘缝起来"]
        # departure_cost untouched
        assert body["detail"]["locations"][0]["dramatic_role"]["departure_cost"] == "leaving is costly"


def test_regenerate_map_section_coerces_dirty_llm_output():
    """End-to-end: /regenerate-map-section must also coerce LLM drift before
    validating the merged map. Otherwise the same proj_47738f64 422 recurs."""
    from backend.config import settings as s

    proj_dir = s.projects_dir / PROJ
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "project.json").write_text(
        json.dumps({"project_id": PROJ, "genre": "cool_novel"}, ensure_ascii=False),
        encoding="utf-8",
    )
    (proj_dir / "world.json").write_text(
        json.dumps({
            "era": "新元", "geography": "新地",
            "era_social_structure": "", "era_cultural_history": "",
            "power_systems": [], "factions": [], "core_rules": [],
        }, ensure_ascii=False),
        encoding="utf-8",
    )
    # Seed an existing map so regenerate has something to merge with.
    (proj_dir / "map.json").write_text(
        json.dumps({
            "schema_version": "1.0",
            "project_id": PROJ,
            "regions": [],
            "locations": [{
                "id": "loc_seed", "name": "seed", "type": "city",
                "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
            }],
            "routes": [], "pois": [],
        }, ensure_ascii=False),
        encoding="utf-8",
    )

    dirty_locations = [{
        "id": "loc_dirty", "name": "dirty", "type": "classroom",
        "dramatic_role": {
            "wanted_by": "alice, bob",
            "decisions_unlocked": "decide X",
            "departure_cost": "high",
        },
    }]

    with patch("backend.api.stage2_map.PlannerAgent") as MockPlanner:
        instance = MockPlanner.return_value

        async def fake_generate_map(world, characters, user_modifications=""):
            return {
                "schema_version": "1.0",
                "project_id": PROJ,
                "regions": [],
                "locations": dirty_locations,
                "routes": [],
                "pois": [],
            }, None

        instance.generate_map = fake_generate_map
        r = client.post(
            f"/api/stage2/regenerate-map-section?project_id={PROJ}",
            json={"section": "locations", "user_modifications": ""},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["error"] is False
        # /regenerate-map-section replaces the chosen section with LLM output;
        # the dirty entry must be coerced (room + split lists)
        types_by_id = {loc["id"]: loc["type"] for loc in body["detail"]["locations"]}
        assert types_by_id["loc_dirty"] == "room"
        dirty = next(l for l in body["detail"]["locations"] if l["id"] == "loc_dirty")
        assert dirty["dramatic_role"]["wanted_by"] == ["alice", "bob"]
        assert dirty["dramatic_role"]["decisions_unlocked"] == ["decide X"]