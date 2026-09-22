"""章节快照端点集成测试 — /snapshot, /snapshots, /rollback。"""
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
            {"id": "loc_blackwater", "name": "黑水镇", "type": "town",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""}},
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
    assert len(restored["locations"]) == 1
    assert restored["locations"][0]["id"] == "loc_blackwater"


def test_rollback_missing_returns_404():
    from backend.map_system.storage import save_map
    save_map(PROJ, _seed_min_map())
    r = client.post(f"/api/stage2/map/rollback/999?project_id={PROJ}")
    assert r.status_code == 404