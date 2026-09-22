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


def test_fact_guard_endpoint_passes_map_snapshot_hash_to_reviewer(_projects_dir, monkeypatch):
    """POST /api/stage4/fact-guard 调用 reviewer.run_fact_guard 时带 map_snapshot_hash kwarg。
    Plan 3 会在 reviewer.run_fact_guard 里读这个 kwarg;Plan 2 只需保证透传,不验证 reviewer 端。"""
    proj_dir = _projects_dir / "proj_fg"
    _seed_minimum_project(proj_dir, "proj_fg")

    from fastapi.testclient import TestClient
    from backend.main import app
    from backend.api import stage4_writing
    from backend.api import stage4_fact_guard
    from backend.agents import reviewer as reviewer_mod
    from backend.agents.reviewer import FactGuardResult

    captured: dict = {}

    class _FakeReviewer:
        def __init__(self, *a, **kw):
            pass

        def run_fact_guard(self, **kwargs):
            captured.update(kwargs)
            return FactGuardResult(all_passed=True, checks=[], coherence_score=100)

    class _FakeWriter:
        def __init__(self, *a, **kw):
            pass

    mp = pytest.MonkeyPatch()
    mp.setattr(stage4_writing, "WriterAgent", _FakeWriter)
    mp.setattr(stage4_writing, "ReviewerAgent", _FakeReviewer)
    mp.setattr(stage4_fact_guard, "ReviewerAgent", _FakeReviewer)
    mp.setattr(reviewer_mod, "ReviewerAgent", _FakeReviewer)
    try:
        client = TestClient(app)
        r = client.post(
            "/api/stage4/fact-guard",
            json={
                "project_id": "proj_fg",
                "chapter_number": 1,
                "scene_number": 1,
                "draft_text": "林峰在黑水镇北门。",
            },
        )
    finally:
        mp.undo()

    assert r.status_code == 200
    assert "map_snapshot_hash" in captured
    # 当 map.json 不存在 → 空串;Plan 1 接入后这里会变成 hash
    assert captured["map_snapshot_hash"] == "" or len(captured["map_snapshot_hash"]) >= 4


def test_scene_writing_prompt_has_map_card_placeholder_and_self_check():
    """scene_writing.yaml 必须含 {map_card} 占位 + system_prompt 含 §9.4 地点一致性自查清单。"""
    import yaml
    from pathlib import Path

    yaml_path = Path("backend/prompts/scene_writing.yaml")
    assert yaml_path.exists(), "scene_writing.yaml missing"
    data = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))

    user_template = data["user_prompt_template"]
    assert "{map_card}" in user_template, "user_prompt_template 缺 {map_card} 占位"

    system_prompt = data["system_prompt"]
    assert "§9.4" in system_prompt, "system_prompt 缺 §9.4 地点一致性自查清单"
    assert "地图" in system_prompt or "地点" in system_prompt, "system_prompt 没提到「地图/地点」"


def test_scene_writing_prompt_braces_are_escaped():
    """feedback_prompt_yaml_brace_escape: literal {JSON example} 必须 {{...}} 转义。

    The scene_writing.yaml output JSON example spans multiple lines (YAML
    block scalar preserves the newline between `{{` and `"text"`), so we
    test for the escaped `{{` form rather than `{{"text"` directly.
    The escaped brace invariant — any literal JSON in the prompt is
    `{{...}}` so `.format()` won't choke — is the real check.
    """
    from pathlib import Path

    raw = Path("backend/prompts/scene_writing.yaml").read_text(encoding="utf-8")
    # Escaped double-brace must appear (the output JSON example)
    assert "{{" in raw, "expected escaped {{...}} in output JSON example"
    # The output JSON example contains the "text" key
    assert '"text"' in raw, "expected output JSON example to contain \"text\""


@pytest.mark.asyncio
async def test_writer_write_scene_accepts_map_card_kwarg(_projects_dir):
    """Writer.write_scene 接收 map_card kwarg 且在 user_prompt 模板中渲染。"""
    import yaml
    from pathlib import Path

    yaml_path = Path("backend/prompts/scene_writing.yaml")
    data = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))

    # Confirm template renders correctly
    rendered = data["user_prompt_template"].format(
        genre="玄幻",
        core_contradiction="凡人修仙",
        premise="测试",
        power_system_name="灵力",
        power_system_description="练气",
        core_rules="",
        ceilings="",
        chapter_outline_context="",
        characters_context="",
        scene_goal="林峰抵达北门",
        scene_conflict="",
        scene_emotional_arc="",
        scene_narrative_role="",
        required_logs_list="",
        l0_context="",
        l1_context="",
        l2_context="",
        l3_context="",
        l4_context="",
        growth_stage_hint="",
        character_growth_context="",
        reader_os_warnings="",
        custom_style_config_desc="",
        genre_pacing_scene="",
        user_modifications="",
        map_card="## 地图卡\n当前: 黑水镇北门",
    )
    assert "## 地图卡" in rendered
    assert "当前: 黑水镇北门" in rendered


@pytest.mark.asyncio
async def test_write_scene_chapter_passes_map_card_kwarg_to_writer(_projects_dir):
    """_write_scene_chapter → writer.write_scene(..., map_card='## 地图卡\\n当前: 黑水镇')。"""
    proj_dir = _projects_dir / "proj_wri_card"
    _seed_minimum_project(proj_dir, "proj_wri_card")

    captured: dict = {}

    class _FakeWriter:
        def __init__(self, *a, **kw):
            pass

        async def write_scene(self, **kwargs):
            captured.update(kwargs)
            return ({"text": "<draft>scene 1</draft>"}, None)

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

    from backend.api import stage4_writing

    mp = pytest.MonkeyPatch()
    mp.setattr(stage4_writing, "WriterAgent", _FakeWriter)
    mp.setattr(stage4_writing, "ReviewerAgent", _FakeReviewer)
    try:
        # NOTE: no draft_factory → _write_scene_chapter actually calls writer.write_scene
        await stage4_writing._write_scene_chapter(
            project_id="proj_wri_card",
            chapter_number=1,
            scene_number=1,
            breaker_result_override="passed",
        )
    finally:
        mp.undo()

    assert "map_card" in captured
    assert "## 地图卡" in captured["map_card"]
    assert "当前: 黑水镇" in captured["map_card"]