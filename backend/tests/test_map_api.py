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