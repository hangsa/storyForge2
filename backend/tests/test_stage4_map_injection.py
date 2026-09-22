"""Stage4 同步路径:map_card 注入 writer 上下文。

覆盖 _write_scene_chapter 的关键路径,验证 scene_plan.location 透传到
MemoryCoordinator.assemble_for_scene(scene_location=...)。
plan_system v2 P2-T6。
"""
import json

import pytest


@pytest.fixture
def _projects_dir(tmp_path, monkeypatch):
    from backend.config import settings
    from backend.api import stage4_writing

    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    stage4_writing.fm = type(stage4_writing.fm)(tmp_path)
    yield tmp_path


def _seed_minimum_project(proj_dir, project_id: str) -> None:
    """Seed the bare-minimum project files Stage 4 needs to write a scene.

    stage4_writing._load_context reads `outline.json` (not `novel_outline.json`),
    so we seed outline.json. Scene plan includes a `location` field per T0
    (scene_plan[].location 前置字段) so assemble_for_scene gets scene_location.
    """
    proj_dir.mkdir(parents=True, exist_ok=True)
    # project.json with current_stage=STAGE4
    (proj_dir / "project.json").write_text(
        json.dumps(
            {
                "id": project_id,
                "title": "test",
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
                                "conflict": "被人盯上",
                                "beat_type": "setup",
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
            {
                "characters": [
                    {
                        "id": "char_linfeng",
                        "name": "林峰",
                        "voice_signature": {"forbidden_behaviors": []},
                        "current_state": {"location": "黑水镇"},
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (proj_dir / "world.json").write_text(
        json.dumps({"core_rules": [], "ceilings": []}, ensure_ascii=False),
        encoding="utf-8",
    )
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
                        "dramatic_role": {
                            "wanted_by": [],
                            "decisions_unlocked": [],
                            "departure_cost": "",
                        },
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
                "settings": {
                    "strict_geo": False,
                    "mode": "allow_alias_new",
                    "chapter_new_location_cap": 5,
                    "reuse_rate_target": 0.6,
                    "scope_enabled": False,
                    "allowed_region_ids": [],
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


async def test_write_scene_chapter_passes_map_card_to_writer(_projects_dir, monkeypatch):
    """_write_scene_chapter 把 scene_plan.location 透传给 assemble_for_scene。

    验证 stage4_writing._write_scene_chapter 调用
    MemoryCoordinator.assemble_for_scene(scene_location='黑水镇'),
    这样 map_card 会被拼到 l2_context 并最终到达 writer.write_scene。

    设计说明:不能依赖 draft_factory(它会跳过 writer.write_scene),
    也不能让完整 pipeline 跑完(fact_guard 复杂路径容易引出无关失败)。
    因此直接 mock MemoryCoordinator 的 assemble_for_scene 捕获 kwargs,
    配合 test_memory_coordinator_map_card.py 已验证的「assemble_for_scene
    + scene_location → 拼 map_card 到 l2_context」覆盖完整链路。
    """
    proj_dir = _projects_dir / "proj_wri_a"
    _seed_minimum_project(proj_dir, "proj_wri_a")

    from backend.api import stage4_writing
    from backend.memory_os.memory_coordinator import MemoryCoordinator

    captured: dict = {}

    class _FakeCoordinator:
        """Wraps the real MemoryCoordinator and records assemble_for_scene kwargs."""

        def __init__(self, project_id, projects_dir=None):
            self._real = MemoryCoordinator(project_id, projects_dir)
            self.project_id = project_id

        def assemble_for_scene(self, **kwargs):
            captured["kwargs"] = kwargs
            return self._real.assemble_for_scene(**kwargs)

    monkeypatch.setattr(stage4_writing, "MemoryCoordinator", _FakeCoordinator)

    result = await stage4_writing._write_scene_chapter(
        project_id="proj_wri_a",
        chapter_number=1,
        scene_number=1,
        draft_factory=lambda c, s: "<draft>scene 1</draft>",
        breaker_result_override="passed",
    )

    assert result["error"] is False
    assert "scene_location" in captured["kwargs"]
    assert captured["kwargs"]["scene_location"] == "黑水镇"
    # character_id 也透传(目前是空字符串 → None)
    assert captured["kwargs"].get("character_id") in (None, "")


@pytest.mark.asyncio
async def test_write_scene_chapter_invokes_mention_extraction(_projects_dir, monkeypatch):
    """_write_scene_chapter 完成 → 调用 extract_mentions_with_llm 把 mention 写 footprint。"""
    proj_dir = _projects_dir / "proj_wri_me_a"
    _seed_minimum_project(proj_dir, "proj_wri_me_a")

    from backend.map_system import extraction as extraction_mod
    from backend.map_system.storage import load_map

    call_log: list = []

    async def fake_extract(project_id, chapter, text, model_router=None):
        call_log.append({"project_id": project_id, "chapter": chapter, "text_len": len(text)})
        return {"北门": "loc_heishui"}

    async def fake_record(project_id, chapter, character_id, alias, canonical_id):
        from backend.map_system.footprints import record_footprint_from_mention
        return record_footprint_from_mention(
            project_id=project_id,
            chapter=chapter,
            character_id=character_id,
            alias=alias,
            canonical_id=canonical_id,
        )

    monkeypatch.setattr(extraction_mod, "extract_mentions_with_llm", fake_extract)

    from backend.api import stage4_writing

    class _FakeWriter:
        def __init__(self, *a, **kw):
            pass

        async def write_scene(self, **kwargs):
            return ({"text": "林峰踏进黑水镇北门,夜色已深。北门外又传来马蹄声。"}, None)

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

    writer_mp = pytest.MonkeyPatch()
    writer_mp.setattr(stage4_writing, "WriterAgent", _FakeWriter)
    writer_mp.setattr(stage4_writing, "ReviewerAgent", _FakeReviewer)
    try:
        await stage4_writing._write_scene_chapter(
            project_id="proj_wri_me_a",
            chapter_number=1,
            scene_number=1,
            draft_factory=lambda c, s: "林峰踏进黑水镇北门,夜色已深。北门外又传来马蹄声。",
            breaker_result_override="passed",
        )
    finally:
        writer_mp.undo()

    assert len(call_log) == 1
    assert call_log[0]["project_id"] == "proj_wri_me_a"

    data = load_map("proj_wri_me_a")
    # map.footprints 应该有 mention extraction 写入的一行
    fps = data.get("footprints", [])
    assert any(
        fp.get("location_id") == "loc_heishui" and fp.get("chapter") == 1
        for fp in fps
    ), f"expected mention footprint in {fps}"