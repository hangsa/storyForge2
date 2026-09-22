"""map_system.extraction — alias/canonical resolution + LLM mention extraction."""
import json

import pytest


@pytest.fixture
def _projects_dir(tmp_path, monkeypatch):
    from backend.config import settings
    from backend.api import stage2_map  # noqa

    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield tmp_path


def _seed_map_with_two_locations(proj_dir, project_id: str) -> None:
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "map.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "project_id": project_id,
                "regions": [{"id": "region_north", "name": "北泽"}],
                "locations": [
                    {
                        "id": "loc_heishui",
                        "name": "黑水镇",
                        "aliases": ["黑水"],
                        "type": "town",
                        "region_id": "region_north",
                        "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
                    },
                    {
                        "id": "loc_north_gate",
                        "name": "黑水镇北门",
                        "aliases": ["北门"],
                        "type": "city",
                        "region_id": "region_north",
                        "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
                    },
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


def test_extract_mentions_from_text_resolves_name_alias_and_unknown(_projects_dir):
    """extract_mentions_from_text: dict 查 → 命中 name/alias,未命中丢弃。"""
    proj_dir = _projects_dir / "proj_ext_a"
    _seed_map_with_two_locations(proj_dir, "proj_ext_a")

    from backend.map_system.extraction import extract_mentions_from_text

    text = "林峰踏进黑水镇北门时,夜色已深。北门外又传来马蹄声。"
    mentions = extract_mentions_from_text("proj_ext_a", 3, text)
    assert mentions["黑水镇北门"] == "loc_north_gate"
    assert mentions["北门"] == "loc_north_gate"
    assert "黑水镇" not in mentions or mentions.get("黑水镇") == "loc_heishui"
    assert "夜色" not in mentions  # not a map entity


def test_extract_mentions_from_text_no_map_returns_empty(_projects_dir):
    """无 map.json → 返回空 dict,不抛异常。"""
    from backend.map_system.extraction import extract_mentions_from_text

    assert extract_mentions_from_text("proj_no_map", 1, "随便") == {}


@pytest.mark.asyncio
async def test_extract_mentions_with_llm_uses_mock_router(_projects_dir):
    """extract_mentions_with_llm(model_router=mock) — mock 返回 JSON → 解析为 mentions。"""
    proj_dir = _projects_dir / "proj_ext_b"
    _seed_map_with_two_locations(proj_dir, "proj_ext_b")

    from backend.map_system.extraction import extract_mentions_with_llm

    # Mock router that returns a canned dict (matching ModelRouter.execute shape).
    class _MockRouter:
        async def execute(self, agent_name: str, task_name: str, messages, **kw):
            return {
                "content": '{"mentions": {"那座北门的城": "loc_north_gate", "黑水": "loc_heishui"}}',
                "usage": {"input": 0, "output": 0},
                "model": "mock",
                "tier": "tier_1",
                "cost": 0.0,
            }

    mentions = await extract_mentions_with_llm(
        "proj_ext_b", 3, "林峰望见那座北门的城,暮色四合。黑水在远处静默。",
        model_router=_MockRouter(),
    )
    assert mentions["那座北门的城"] == "loc_north_gate"
    assert mentions["黑水"] == "loc_heishui"


@pytest.mark.asyncio
async def test_extract_mentions_with_llm_filters_canonical_ids_not_in_map(_projects_dir):
    """LLM 返回的 canonical_id 不在 map.json 中 → 丢弃(避免 hallucinated ID)。"""
    proj_dir = _projects_dir / "proj_ext_c"
    _seed_map_with_two_locations(proj_dir, "proj_ext_c")

    from backend.map_system.extraction import extract_mentions_with_llm

    class _MockRouter:
        async def execute(self, agent_name: str, task_name: str, messages, **kw):
            return {
                "content": '{"mentions": {"某处": "loc_doesnt_exist", "北门": "loc_north_gate"}}',
                "usage": {"input": 0, "output": 0},
                "model": "mock",
                "tier": "tier_1",
                "cost": 0.0,
            }

    mentions = await extract_mentions_with_llm(
        "proj_ext_c", 3, "某处 北门", model_router=_MockRouter(),
    )
    assert "某处" not in mentions
    assert mentions["北门"] == "loc_north_gate"