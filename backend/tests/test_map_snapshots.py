"""章节快照测试。"""
import json
import hashlib
import pytest

from backend.map_system.snapshots import (
    snapshot_map_at_chapter,
    compute_map_hash,
    rollback_map_to_chapter,
    list_snapshots,
)
from backend.map_system.models import Map
from backend.map_system.storage import load_map, save_map

PROJ = "proj_test_snap"


@pytest.fixture(autouse=True)
def _patch_projects_dir(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield


def _seed_map():
    return Map.model_validate({
        "schema_version": "1.0",
        "project_id": PROJ,
        "regions": [
            {"id": "region_south", "name": "南泽", "level": "state"},
        ],
        "locations": [],
        "routes": [],
        "pois": [],
    })


def test_snapshot_creates_file_with_hash():
    """snapshot_map_at_chapter 在 map_snapshots/chapter_NNN.json 落盘,带 hash 前 12 位。"""
    save_map(PROJ, _seed_map())
    path = snapshot_map_at_chapter(PROJ, chapter=5)
    body = json.loads(path.read_text(encoding="utf-8"))
    assert body["chapter"] == 5
    assert body["map"]["project_id"] == PROJ
    assert body["snapshot_hash"] == compute_map_hash(_seed_map())[:12]
    assert body["created_at"]


def test_rollback_replaces_map_json():
    """rollback_map_to_chapter 把 map.json 替换成对应快照内容。"""
    save_map(PROJ, _seed_map())
    snapshot_map_at_chapter(PROJ, chapter=3)

    edited = _seed_map()
    edited.locations.append({"id": "loc_x", "name": "X", "type": "town"})
    save_map(PROJ, edited)

    new_map = rollback_map_to_chapter(PROJ, chapter=3)
    assert len(new_map.locations) == 0  # X 已消失


def test_rollback_missing_snapshot_raises():
    """rollback_map_to_chapter 对不存在的 chapter 抛 FileNotFoundError。"""
    save_map(PROJ, _seed_map())
    with pytest.raises(FileNotFoundError):
        rollback_map_to_chapter(PROJ, chapter=999)


def test_compute_map_hash_deterministic():
    """compute_map_hash 对同内容稳定,改一个 location 后变化。"""
    m1 = _seed_map()
    m2 = _seed_map()
    assert compute_map_hash(m1) == compute_map_hash(m2)
    m2.locations.append({"id": "loc_x", "name": "X", "type": "town"})
    assert compute_map_hash(m1) != compute_map_hash(m2)


def test_list_snapshots_returns_timeline():
    """list_snapshots 列出按 chapter 升序的快照摘要。"""
    save_map(PROJ, _seed_map())
    snapshot_map_at_chapter(PROJ, chapter=7)
    snapshot_map_at_chapter(PROJ, chapter=3)
    items = list_snapshots(PROJ)
    chapters = [s["chapter"] for s in items]
    assert chapters == [3, 7]
    assert all("snapshot_hash" in s and "created_at" in s for s in items)
