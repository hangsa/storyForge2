"""footprints helper + storyos_agent SF_LOG → footprint 路径测试。"""
import json

import pytest


@pytest.fixture
def _projects_dir(tmp_path, monkeypatch):
    from backend.config import settings
    from backend.api import stage2_map  # noqa

    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield tmp_path


def _seed_map_with_location(proj_dir, project_id: str) -> None:
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


def test_record_footprint_from_sf_log_appends_to_map_json(_projects_dir):
    """record_footprint_from_sf_log 调 save_map 后,Map.footprints 多一行。"""
    from backend.map_system.storage import load_map, save_map
    from backend.map_system.models import Map
    from backend.map_system.footprints import record_footprint_from_sf_log

    proj_dir = _projects_dir / "proj_fp_a"
    _seed_map_with_location(proj_dir, "proj_fp_a")

    record_footprint_from_sf_log(
        project_id="proj_fp_a",
        chapter=3,
        character_id="char_linfeng",
        to_location="黑水镇",
        via="城门外官道",
    )

    data = load_map("proj_fp_a")
    fps = data["footprints"]
    assert len(fps) == 1
    assert fps[0]["chapter"] == 3
    assert fps[0]["character_id"] == "char_linfeng"
    assert fps[0]["location_id"] == "loc_heishui"
    assert fps[0]["arrived_via"] is None or fps[0]["arrived_via"] == "" or fps[0]["arrived_via"] == "城门外官道"
    # to_location 没匹配到 → 仍要写入(用空字符串而不是丢)
    assert fps[0]["location_id"] != ""


def test_record_footprint_unresolved_to_location_still_writes_with_empty_id(_projects_dir):
    """to_location 在 map.json 找不到时,仍然写一行(把 location_id 留空)。"""
    from backend.map_system.storage import load_map
    from backend.map_system.footprints import record_footprint_from_sf_log

    proj_dir = _projects_dir / "proj_fp_b"
    _seed_map_with_location(proj_dir, "proj_fp_b")

    record_footprint_from_sf_log(
        project_id="proj_fp_b",
        chapter=5,
        character_id="char_a",
        to_location="不存在的地点",
        via="",
    )

    data = load_map("proj_fp_b")
    assert len(data["footprints"]) == 1
    assert data["footprints"][0]["location_id"] == ""
    assert data["footprints"][0]["character_id"] == "char_a"


def test_storyos_update_registries_writes_footprint_for_location_change_log(_projects_dir):
    """StoryOSAgent.update_registries 处理 character_location_change 时,stashes 一条 footprint_events;
    调用方后续调用 report.write_footprints_to_map(project_id, chapter) 真正写盘。

    之所以分成两步:StoryOSAgent 不知道当前 chapter,需要 caller 提供上下文。
    """
    proj_dir = _projects_dir / "proj_fp_c"
    _seed_map_with_location(proj_dir, "proj_fp_c")

    # Need a storyos/ registries dir so update_registries can run cleanly
    (proj_dir / "storyos").mkdir(exist_ok=True)

    from backend.agents.storyos_agent import StoryOSAgent, ParsedLog
    from backend.map_system.storage import load_map

    agent = StoryOSAgent("proj_fp_c")
    log = ParsedLog(
        type="character_location_change",
        params={"char": "林峰", "from": "城门外", "to": "黑水镇"},
    )
    report = agent.update_registries([log])

    # Step 3b: update_registries 只 stash 事件,不直接写盘
    assert len(report.footprint_events) == 1
    assert report.footprint_events[0]["character_id"] == "林峰"
    assert report.footprint_events[0]["to_location"] == "黑水镇"

    # 调用方提供 chapter context 触发实际写入
    report.write_footprints_to_map("proj_fp_c", chapter=1)

    data = load_map("proj_fp_c")
    assert len(data["footprints"]) == 1
    assert data["footprints"][0]["character_id"] == "林峰"
    assert data["footprints"][0]["location_id"] == "loc_heishui"
    assert data["footprints"][0]["arrived_via"] in (None, "", "城门外")
