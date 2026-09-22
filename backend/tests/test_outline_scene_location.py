"""Stage 3 章节大纲产出 — 每个 scene 必须带 location_id,无法解析时回退并 warn。"""
import asyncio
import json
from pathlib import Path

import pytest

PROJ = "proj_test_scene_loc"


@pytest.fixture
def _seed_project(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    (tmp_path / PROJ).mkdir(parents=True, exist_ok=True)
    (tmp_path / PROJ / "project.json").write_text(
        json.dumps({"id": PROJ, "genre": "cool_novel"}, ensure_ascii=False),
        encoding="utf-8",
    )
    # 同步 Plan 1 后续产物:写入一份最小 map.json,带 name_to_id 反向索引(Plan 1 Task 5 的产物)
    from backend.map_system.models import Map
    m = Map.model_validate({
        "schema_version": "1.0",
        "project_id": PROJ,
        "regions": [],
        "locations": [
            {"id": "loc_blackwater", "name": "黑水镇", "type": "town",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""}},
            {"id": "loc_qingfeng", "name": "青峰山", "type": "wilds",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""}},
        ],
        "routes": [],
        "pois": [],
    })
    from backend.map_system.storage import save_map
    save_map(PROJ, m)
    return tmp_path


def test_generate_outline_appends_map_name_index_to_prompt(_seed_project):
    """PlannerAgent.generate_outline 的 prompt payload 必须包含 {map_name_index} 字符串,
    让 LLM 看到可用的 location_id 名单。
    """
    import yaml
    raw = yaml.safe_load(Path("backend/prompts/outline_generation.yaml").read_text(encoding="utf-8"))
    assert "{map_name_index}" in (raw.get("user_prompt_template", ""))


def test_generate_outline_validates_scene_location_id(_seed_project):
    """stage3 outline 端点解析后,scene.location 应该是 Map 的有效 location_id 或 name_to_id 反查命中,
    否则回退为 None 并 warning。
    """
    from backend.agents.planner import PlannerAgent

    # 用真实 PlannerAgent 实例(需要 project_id 才能跑 load_map 后处理)。
    # monkeypatch 内部 LLM 调用 generate_from_template,返回受控的 scene_plan。
    agent = PlannerAgent(project_id=PROJ)

    async def fake_generate_from_template(template_name, **kwargs):
        return (
            {
                "chapter_number": 1,
                "title": "t",
                "scene_plan": [
                    {"scene_number": 1, "goal": "g", "conflict": "c",
                     "beat_type": "setup", "location": "loc_does_not_exist",
                     "required_logs": [], "registry_changes": {"created": [], "updated": [], "resolved": []}},
                    {"scene_number": 2, "goal": "g2", "conflict": "c2",
                     "beat_type": "rising", "location": "loc_blackwater",
                     "required_logs": [], "registry_changes": {"created": [], "updated": [], "resolved": []}},
                    {"scene_number": 3, "goal": "g3", "conflict": "c3",
                     "beat_type": "rising", "location": "黑水镇",
                     "required_logs": [], "registry_changes": {"created": [], "updated": [], "resolved": []}},
                ],
                "warnings": [],
            },
            None,
        )

    agent.generate_from_template = fake_generate_from_template  # type: ignore
    agent.log_usage = lambda *a, **kw: None  # type: ignore

    result, _ = asyncio.run(agent.generate_outline(
        concept={}, story_dna={}, world={}, characters=[], chapter_number=1,
    ))
    # loc_does_not_exist 回退为 None
    assert result["scene_plan"][0]["location"] is None
    # 黑水镇 没在 Map.name_to_id 里也会落进 warning。
    # (该 name 是 Map.locations 的 name,build_name_index 会登记 → 应该 alias 命中,
    # 不是 None。所以这里期待 alias 命中、保持原值或规范化)
    # 直接 id 命中:loc_blackwater
    assert result["scene_plan"][1]["location"] == "loc_blackwater"
    # alias 命中:中文名 黑水镇 → loc_blackwater
    assert result["scene_plan"][2]["location"] == "loc_blackwater"
    # warning 列表包含坏 id
    warnings = result.get("warnings", [])
    assert any("loc_does_not_exist" in str(w) for w in warnings)
