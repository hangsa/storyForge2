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