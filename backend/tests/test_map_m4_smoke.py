"""Plan 2 M4 端到端冒烟测试 — 验证 map_card 注入 + footprint 抽取全链路。"""
import json

import pytest


@pytest.fixture
def _projects_dir(tmp_path, monkeypatch):
    from backend.config import settings
    from backend.api import stage2_map  # noqa
    from backend.api import stage4_writing

    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    stage4_writing.fm = type(stage4_writing.fm)(tmp_path)
    yield tmp_path


def _seed_full_m4_project(proj_dir, project_id: str) -> None:
    """Seed a project with: stage4 progress, map.json with 2 locations
    + 1 route, outline.json, characters.json, world.json.

    Fixture deviations from the plan literal (documented):
      - The plan specified `novel_outline.json`, but stage4_writing._load_context
        reads `outline.json`. Using `outline.json` here.
      - The plan specified a bare list for `characters.json`, but
        `_load_context` calls `characters_data.get("characters", [])` which
        raises AttributeError on a list. Wrap as `{"characters": [...]}`.
    These are fixture/path corrections, NOT assertion changes.
    """
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "project.json").write_text(
        json.dumps(
            {
                "id": project_id,
                "title": "M4 smoke",
                "genre": "玄幻",
                "current_stage": "STAGE4",
                "concept_and_dna": {"core_contradiction": {"statement": "凡人修仙"}},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (proj_dir / "outline.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "volumes": [{"name": "第一卷", "start_chapter": 1, "end_chapter": 10}],
                "chapters": [
                    {
                        "chapter_number": 1,
                        "title": "黑水镇夜谈",
                        "theme": "人际",
                        "scene_plan": [
                            {
                                "scene_number": 1,
                                "goal": "林峰抵达北门",
                                "conflict": "",
                                "location": "黑水镇",
                                "required_logs": [],
                            }
                        ],
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (proj_dir / "characters.json").write_text(
        json.dumps(
            {"characters": [{"id": "char_linfeng", "name": "林峰",
                             "voice_signature": {"forbidden_behaviors": []},
                             "current_state": {"location": "黑水镇"}}]},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (proj_dir / "world.json").write_text(json.dumps({"core_rules": [], "ceilings": []}, ensure_ascii=False), encoding="utf-8")
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
                    },
                    {
                        "id": "loc_north_gate",
                        "name": "黑水镇北门",
                        "type": "city",
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


@pytest.mark.asyncio
async def test_m4_end_to_end_injects_card_and_writes_footprint(_projects_dir, monkeypatch):
    """plan 2 全链路:
       1. _write_scene_chapter 调用 → writer.write_scene 收到 map_card kwarg
       2. SF_LOG character_location_change → footprint 写入 Map.footprints
       3. mention extraction (mock) → 第二条 footprint 写入"""
    proj_dir = _projects_dir / "proj_smoke"
    _seed_full_m4_project(proj_dir, "proj_smoke")

    # Add SF_LOG character_location_change to draft text
    draft_text = (
        "林峰踏入黑水镇北门,夜色已深。\n"
        '<!-- SF_LOG character_location_change char="林峰" from="城门外官道" to="黑水镇" -->\n'
        "北门外又传来马蹄声。"
    )

    from backend.api import stage4_writing
    from backend.map_system.storage import load_map
    from backend.map_system import extraction as extraction_mod

    async def fake_extract(project_id, chapter, text, model_router=None):
        return {"北门": "loc_north_gate"}

    monkeypatch.setattr(extraction_mod, "extract_mentions_with_llm", fake_extract)

    class _FakeWriter:
        def __init__(self, *a, **kw):
            pass

        async def write_scene(self, **kwargs):
            assert "map_card" in kwargs
            assert "## 地图卡" in kwargs["map_card"]
            return ({"text": draft_text}, None)

        async def write_scene_stream(self, *a, **kw):
            raise RuntimeError

        async def rewrite_scene(self, **kwargs):
            return ({"text": "rewrite"}, None)

        def log_usage(self, *a, **kw):
            pass

    class _FakeReviewer:
        def __init__(self, *a, **kw):
            pass

        def run_fact_guard(self, **kwargs):
            from backend.agents.reviewer import FactGuardResult
            return FactGuardResult(all_passed=True, checks=[], coherence_score=100)

        async def run_style_guard(self, **kwargs):
            return []

    mp = pytest.MonkeyPatch()
    mp.setattr(stage4_writing, "WriterAgent", _FakeWriter)
    mp.setattr(stage4_writing, "ReviewerAgent", _FakeReviewer)
    try:
        # NOTE: NO draft_factory — _write_scene_chapter must invoke
        # _FakeWriter.write_scene so the map_card kwarg assertion in the
        # fake actually runs and the SF_LOG extraction has real text to
        # parse (otherwise `current_draft` stays empty).
        result = await stage4_writing._write_scene_chapter(
            project_id="proj_smoke",
            chapter_number=1,
            scene_number=1,
            breaker_result_override="passed",
        )
    finally:
        mp.undo()

    assert result["error"] is False

    # Verify footprint writes
    data = load_map("proj_smoke")
    fps = data.get("footprints", [])
    # 至少 2 条:一条 SF_LOG (林峰→黑水镇) + 一条 mention (北门→loc_north_gate)
    assert len(fps) >= 2, f"expected ≥2 footprints, got {fps}"
    sf_log_fp = next((f for f in fps if f["character_id"] == "林峰" and f["location_id"] == "loc_heishui"), None)
    assert sf_log_fp is not None, f"expected SF_LOG footprint for 林峰→黑水镇, got {fps}"
    mention_fp = next((f for f in fps if f["location_id"] == "loc_north_gate"), None)
    assert mention_fp is not None, f"expected mention footprint for 北门→北门 location, got {fps}"