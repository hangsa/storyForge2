"""MemoryCoordinator.assemble_for_scene — verify map_card appended to l2_context."""
import json

import pytest


@pytest.fixture
def _projects_dir(tmp_path, monkeypatch):
    from backend.config import settings

    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield tmp_path


def _seed_map(proj_dir, project_id: str, location_name: str) -> None:
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "map.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "project_id": project_id,
                "regions": [],
                "locations": [
                    {
                        "id": "loc_heishui",
                        "name": location_name,
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


def test_assemble_for_scene_appends_map_card_when_scene_location_given(_projects_dir):
    """assemble_for_scene(..., scene_location='黑水镇') → l2_context 末尾包含「当前: 黑水镇」。"""
    proj_dir = _projects_dir / "proj_mc_a"
    _seed_map(proj_dir, "proj_mc_a", "黑水镇")

    from backend.memory_os.memory_coordinator import MemoryCoordinator

    mc = MemoryCoordinator("proj_mc_a", _projects_dir)
    ctx = mc.assemble_for_scene(
        scene_number=1,
        scene_goal="林峰抵达北门",
        scene_conflict="",
        character_names=["林峰"],
        chapter_number=3,
        scene_location="黑水镇",
    )
    assert "## 地图卡" in ctx.l2_context
    assert "当前: 黑水镇" in ctx.l2_context


def test_assemble_for_scene_omits_map_card_when_scene_location_omitted(_projects_dir):
    """assemble_for_scene 不传 scene_location → l2_context 不含「地图卡」。"""
    proj_dir = _projects_dir / "proj_mc_b"
    _seed_map(proj_dir, "proj_mc_b", "黑水镇")

    from backend.memory_os.memory_coordinator import MemoryCoordinator

    mc = MemoryCoordinator("proj_mc_b", _projects_dir)
    ctx = mc.assemble_for_scene(
        scene_number=1,
        scene_goal="林峰抵达北门",
        scene_conflict="",
        character_names=["林峰"],
        chapter_number=3,
    )
    assert "## 地图卡" not in ctx.l2_context


def test_assemble_for_scene_omits_map_card_when_no_map_json(_projects_dir):
    """无 map.json → 即使传 scene_location,也不报错且不输出地图卡。"""
    proj_dir = _projects_dir / "proj_mc_c"
    proj_dir.mkdir(parents=True, exist_ok=True)

    from backend.memory_os.memory_coordinator import MemoryCoordinator

    mc = MemoryCoordinator("proj_mc_c", _projects_dir)
    ctx = mc.assemble_for_scene(
        scene_number=1,
        scene_goal="goal",
        scene_conflict="",
        character_names=["林峰"],
        chapter_number=3,
        scene_location="黑水镇",
    )
    assert "## 地图卡" not in ctx.l2_context