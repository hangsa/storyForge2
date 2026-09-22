"""StoryOSAgent POI discoverable=true 注入测试 — 让 map_card 能拿到「已发现 POI」列表。"""
import json
from pathlib import Path

import pytest


@pytest.fixture
def project_with_pois(tmp_path):
    """构建最小项目,含 1 个 discoverable=true 的 POI。"""
    proj = tmp_path / "proj_x"
    proj.mkdir()
    storyos_dir = proj / "storyos"
    storyos_dir.mkdir()
    # 写 map.json(Plan 1 schema)
    map_data = {
        "schema_version": "1.0",
        "project_id": "proj_x",
        "locations": [
            {"id": "loc_inn", "name": "青峰客栈", "type": "inn",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
             "enter_conditions": [], "factions": []},
        ],
        "pois": [
            {"id": "poi_cellar", "name": "青峰客栈地窖", "parent_location_id": "loc_inn",
             "kind": "shrine", "description": "通向废弃古寺的暗道入口",
             "discoverable": True, "first_discovered_chapter": None, "tags": ["密道"]},
        ],
    }
    with open(proj / "map.json", "w", encoding="utf-8") as f:
        json.dump(map_data, f)
    return proj


def test_list_discoverable_pois_returns_pending_first(monkeypatch, project_with_pois):
    """first_discovered_chapter=None 的 POI 视为「待发现」,应出现在 list 中。"""
    from backend.config import settings
    from backend.agents.storyos_agent import StoryOSAgent

    monkeypatch.setattr(settings, "projects_dir", project_with_pois.parent)
    agent = StoryOSAgent("proj_x")

    pois = agent.list_discoverable_pois_for_card()
    assert len(pois) == 1
    assert pois[0]["poi_id"] == "poi_cellar"
    assert pois[0]["name"] == "青峰客栈地窖"
    assert pois[0]["status"] == "待发现"


def test_list_discoverable_pois_returns_empty_when_no_pois(monkeypatch, tmp_path):
    proj = tmp_path / "proj_y"
    proj.mkdir()
    map_data = {"schema_version": "1.0", "project_id": "proj_y", "locations": [], "pois": []}
    with open(proj / "map.json", "w", encoding="utf-8") as f:
        json.dump(map_data, f)

    from backend.config import settings
    from backend.agents.storyos_agent import StoryOSAgent
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    agent = StoryOSAgent("proj_y")
    assert agent.list_discoverable_pois_for_card() == []


def test_list_discoverable_pois_skips_non_discoverable(monkeypatch, tmp_path):
    """discoverable=false 的 POI 不进入 list(PRD §3.2.4 不可见约束)。"""
    proj = tmp_path / "proj_z"
    proj.mkdir()
    map_data = {
        "schema_version": "1.0", "project_id": "proj_z",
        "locations": [
            {"id": "loc_a", "name": "A", "type": "inn",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
             "enter_conditions": [], "factions": []},
        ],
        "pois": [
            {"id": "poi_secret", "name": "隐藏地窖", "parent_location_id": "loc_a",
             "kind": "shrine", "discoverable": False, "first_discovered_chapter": None, "tags": []},
        ],
    }
    with open(proj / "map.json", "w", encoding="utf-8") as f:
        json.dump(map_data, f)

    from backend.config import settings
    from backend.agents.storyos_agent import StoryOSAgent
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    agent = StoryOSAgent("proj_z")
    assert agent.list_discoverable_pois_for_card() == []


def test_list_discoverable_pois_returns_already_discovered(monkeypatch, project_with_pois):
    """first_discovered_chapter 已有值的 POI 仍出现在 list,status=「已发现」。

    map_card 「已发现 POI」段需要两类:已发现的(供回溯引用)+ 待发现的(供伏笔铺垫)。
    """
    # 修改 first_discovered_chapter=12
    map_path = project_with_pois / "map.json"
    data = json.loads(map_path.read_text())
    data["pois"][0]["first_discovered_chapter"] = 12
    map_path.write_text(json.dumps(data, ensure_ascii=False))

    from backend.config import settings
    from backend.agents.storyos_agent import StoryOSAgent
    monkeypatch.setattr(settings, "projects_dir", project_with_pois.parent)
    agent = StoryOSAgent("proj_x")

    pois = agent.list_discoverable_pois_for_card()
    assert len(pois) == 1
    assert pois[0]["status"] == "已发现"
    assert pois[0]["first_discovered_chapter"] == 12


def test_list_discoverable_pois_returns_empty_when_no_map(monkeypatch, tmp_path):
    """老项目无 map.json(Plan 1 旧路径)— list 返回 [],不报错。"""
    proj = tmp_path / "proj_legacy"
    proj.mkdir()
    # 没有 map.json
    from backend.config import settings
    from backend.agents.storyos_agent import StoryOSAgent
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    agent = StoryOSAgent("proj_legacy")
    assert agent.list_discoverable_pois_for_card() == []