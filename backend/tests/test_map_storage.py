"""map_system/storage.py 测试 — atomic write + 缺失文件返回 None。"""
import json
import pytest
from backend.map_system.storage import save_map, load_map
from backend.map_system.models import Map


PROJ = "proj_test_storage"


@pytest.fixture(autouse=True)
def _patch_projects_dir(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield


def test_load_map_returns_none_when_missing(tmp_path):
    assert load_map(PROJ) is None


def test_save_then_load_roundtrip(tmp_path):
    m = Map.model_validate({"schema_version": "1.0", "project_id": PROJ})
    save_map(PROJ, m)
    loaded = load_map(PROJ)
    assert loaded is not None
    assert loaded["project_id"] == PROJ
    assert loaded["schema_version"] == "1.0"


def test_save_uses_atomic_write(tmp_path):
    """写入必须走 .tmp + replace,不能留 .tmp。"""
    m = Map.model_validate({"schema_version": "1.0", "project_id": PROJ})
    save_map(PROJ, m)
    project_dir = tmp_path / PROJ
    assert (project_dir / "map.json").exists()
    assert not list(project_dir.glob("*.tmp"))  # .tmp 必须 replace 完成


def test_save_creates_map_snapshots_dir(tmp_path):
    """save_map 必须确保 map_snapshots/ 目录存在(章节快照会写到这)。"""
    m = Map.model_validate({"schema_version": "1.0", "project_id": PROJ})
    save_map(PROJ, m)
    assert (tmp_path / PROJ / "map_snapshots").exists()


def test_build_name_index_returns_aliases_and_names():
    from backend.map_system.storage import build_name_index, save_map
    from backend.map_system.models import Map, Location, Region, POI
    m = Map.model_validate({
        "schema_version": "1.0",
        "project_id": PROJ,
        "regions": [
            {"id": "region_south", "name": "南泽", "aliases": ["南渊"]},
        ],
        "locations": [
            {
                "id": "loc_qingfeng_inn", "name": "青峰客栈",
                "aliases": ["山脚客栈"], "type": "inn",
                "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
            },
        ],
        "pois": [
            {
                "id": "poi_cellar", "name": "青峰客栈地窖",
                "parent_location_id": "loc_qingfeng_inn",
            },
        ],
    })
    save_map(PROJ, m)
    idx = build_name_index(PROJ)
    assert idx["青峰客栈"] == "loc_qingfeng_inn"
    assert idx["山脚客栈"] == "loc_qingfeng_inn"
    assert idx["南泽"] == "region_south"
    assert idx["南渊"] == "region_south"
    assert idx["青峰客栈地窖"] == "poi_cellar"


def test_build_name_index_returns_empty_when_no_map():
    from backend.map_system.storage import build_name_index
    assert build_name_index("proj_nonexistent") == {}
