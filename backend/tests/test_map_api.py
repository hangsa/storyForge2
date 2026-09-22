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