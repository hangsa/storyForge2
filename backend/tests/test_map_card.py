"""build_map_card — scene-level 增量累计 mini-card 测试。"""
import json
from pathlib import Path

import pytest


@pytest.fixture
def _projects_dir(tmp_path, monkeypatch):
    from backend.config import settings
    from backend.api import stage2_map  # noqa: F401 — exercises module load

    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield tmp_path


def test_build_map_card_returns_empty_when_no_map_json(_projects_dir):
    """项目无 map.json → 返回空串(不报错,Writer 当成无地图)。"""
    from backend.map_system.map_card import build_map_card

    assert build_map_card("proj_no_map", None) == ""


def test_build_map_card_returns_empty_when_scene_location_none(_projects_dir):
    """即使有 map,scene_location=None → 返回空串。"""
    from backend.map_system.map_card import build_map_card

    # 准备一份最小 map.json
    proj_dir = _projects_dir / "proj_a"
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "map.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "project_id": "proj_a",
                "regions": [],
                "locations": [
                    {
                        "id": "loc_heishui",
                        "name": "黑水镇",
                        "type": "town",
                        "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
                    }
                ],
                "routes": [],
                "pois": [],
                "location_states": [],
                "snapshots": [],
                "footprints": [],
                "assertions": [],
                "change_log": [],
                "display": {"positions": {}},
                "settings": {"strict_geo": False, "mode": "allow_alias_new", "chapter_new_location_cap": 5, "reuse_rate_target": 0.6, "scope_enabled": False, "allowed_region_ids": []},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    from backend.map_system.map_card import build_map_card

    assert build_map_card("proj_a", None) == ""