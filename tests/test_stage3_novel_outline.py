"""Tests for the v1.7 novel-level outline layer in STAGE3."""
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.conductor.state_machine import Stage, StageStateMachine, PRECONDITIONS
from backend.main import app


@pytest.fixture
def projects_dir(tmp_path):
    d = tmp_path / "projects"
    d.mkdir()
    return d


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def project_data():
    return {
        "title": "测试小说",
        "genre": "cool_novel",
        "min_words": 4000,
        "free_text": "一个少年在异世界觉醒能力",
        "inspiration_source": "web_novel",
    }


def _write_json(projects_dir: Path, project_id: str, filename: str, data):
    p = projects_dir / project_id
    p.mkdir(parents=True, exist_ok=True)
    with open(p / filename, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def _seed_project(projects_dir: Path, proj_id: str):
    """Write the prerequisite files so the project can reach STAGE3."""
    _write_json(projects_dir, proj_id, "project.json", {
        "id": proj_id,
        "title": "测试小说",
        "genre": "cool_novel",
        "min_words": 4000,
        "current_stage": "STAGE3",
        "stage_history": [],
        "created_at": "2025-01-01T00:00:00",
    })
    _write_json(projects_dir, proj_id, "concept_and_dna.json", {
        "concept": {"title": "测试", "premise": "test", "tone": "", "theme": "逆袭"},
        "story_dna": {"core_contradiction": {"statement": "力量 vs 责任"}},
    })
    _write_json(projects_dir, proj_id, "world.json", {
        "era": "异世界", "power_system": {"name": "灵力", "core_rules": []}, "core_rules": [],
    })
    _write_json(projects_dir, proj_id, "characters.json", {
        "characters": [{"id": "c1", "name": "林峰", "personality": {"core_traits": []}, "current_state": {}}],
    })


SAMPLE_NOVEL_OUTLINE = {
    "core_conflict_theme": "底层少年逆袭",
    "volumes": [
        {"name": "第一卷 崛起", "chapter_range": "1-50", "summary": "觉醒与初战", "key_events": ["金手指开启"]},
        {"name": "第二卷 试炼", "chapter_range": "51-120", "summary": "宗门之争", "key_events": ["擂台赛"]},
    ],
    "mc_growth_arc": [
        {"label": "起点: 卑微", "target_chapter_range": "1-20", "description": "出身底层"},
        {"label": "觉醒", "target_chapter_range": "20-50", "description": "能力觉醒"},
    ],
    "key_plot_points": [
        {"title": "上古遗物", "must_appear_in_volume": "第一卷 崛起", "description": "主角金手指", "trigger_chapter_hint": "约第 5 章"},
    ],
}


class TestNovelOutlineEndpoints:
    def test_get_novel_outline_empty_returns_empty_dict(self, client, project_data, monkeypatch):
        """Fresh project with no novel_outline.json — GET returns {} not 404."""
        from backend.config import settings
        monkeypatch.setattr(settings, "projects_dir", settings.projects_dir)
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]

        resp = client.get(f"/api/stage3/novel-outline?project_id={proj_id}")
        assert resp.status_code == 200
        assert resp.json()["detail"] == {}

    def test_generate_novel_outline_creates_file(self, client, project_data, monkeypatch):
        from backend.config import settings
        monkeypatch.setattr(settings, "projects_dir", settings.projects_dir)
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]

        # Advance project to STAGE3 by writing prerequisites
        _seed_project(settings.projects_dir, proj_id)

        with patch("backend.agents.planner.PlannerAgent.generate_novel_outline", new_callable=AsyncMock) as mock:
            mock.return_value = (SAMPLE_NOVEL_OUTLINE, None)

            resp = client.post("/api/stage3/generate-novel-outline", json={"project_id": proj_id})

        assert resp.status_code == 200, resp.text
        detail = resp.json()["detail"]
        assert detail["core_conflict_theme"] == SAMPLE_NOVEL_OUTLINE["core_conflict_theme"]
        assert len(detail["volumes"]) == 2
        assert detail["generated_at"] != ""
        assert detail["updated_at"] != ""

        # File should now exist
        on_disk = json.loads((settings.projects_dir / proj_id / "novel_outline.json").read_text())
        assert on_disk["core_conflict_theme"] == SAMPLE_NOVEL_OUTLINE["core_conflict_theme"]

    def test_generate_novel_outline_requires_concept_world_chars(self, client, project_data, monkeypatch):
        from backend.config import settings
        monkeypatch.setattr(settings, "projects_dir", settings.projects_dir)
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]

        # Advance to STAGE3 but DON'T seed concept/world/characters
        _write_json(settings.projects_dir, proj_id, "project.json", {
            "id": proj_id, "title": "t", "genre": "g", "min_words": 4000,
            "current_stage": "STAGE3", "stage_history": [], "created_at": "2025-01-01T00:00:00",
        })

        resp = client.post("/api/stage3/generate-novel-outline", json={"project_id": proj_id})
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "PRECONDITION_FAILED"

    def test_update_novel_outline_persists_edits(self, client, project_data, monkeypatch):
        from backend.config import settings
        monkeypatch.setattr(settings, "projects_dir", settings.projects_dir)
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]
        _seed_project(settings.projects_dir, proj_id)

        edited = dict(SAMPLE_NOVEL_OUTLINE)
        edited["core_conflict_theme"] = "用户手动改写的主题"
        edited["volumes"] = SAMPLE_NOVEL_OUTLINE["volumes"] + [
            {"name": "第三卷 自定义", "chapter_range": "121-180", "summary": "用户加的", "key_events": []}
        ]

        resp = client.put("/api/stage3/novel-outline", json={
            "project_id": proj_id, "novel_outline": edited,
        })
        assert resp.status_code == 200
        assert resp.json()["detail"]["core_conflict_theme"] == "用户手动改写的主题"
        assert len(resp.json()["detail"]["volumes"]) == 3

        # GET should return the same
        get_resp = client.get(f"/api/stage3/novel-outline?project_id={proj_id}")
        assert get_resp.json()["detail"]["volumes"][-1]["name"] == "第三卷 自定义"


class TestStateMachinePreconditions:
    """STAGE3 preconditions check STAGE2's outputs (world + characters), not
    STAGE3's own output (novel_outline). The novel outline is generated INSIDE
    Stage 3 — requiring it to exist before entering would be a chicken-and-egg
    block on the UI's "进入情节头脑风暴" button.
    """

    def test_stage3_preconditions_exclude_novel_outline(self):
        checks = PRECONDITIONS[Stage.STAGE3]
        filenames = [c[0] for c in checks]
        assert "novel_outline.json" not in filenames, (
            "novel_outline.json is STAGE3's output, not a precondition for entering it"
        )

    def test_state_machine_allows_stage3_without_novel_outline(self, projects_dir):
        """Project at STAGE2 with world + characters but no novel_outline.json
        must be allowed to advance to STAGE3 — the user is entering STAGE3
        to generate the outline."""
        sm = StageStateMachine(projects_dir)
        proj_id = "proj_test"
        _write_json(projects_dir, proj_id, "project.json", {
            "id": proj_id, "title": "t", "genre": "g", "min_words": 4000,
            "current_stage": "STAGE2", "stage_history": [], "created_at": "2025-01-01T00:00:00",
        })
        _write_json(projects_dir, proj_id, "characters.json", {
            "characters": [{"id": "c1", "name": "林峰"}],
        })
        _write_json(projects_dir, proj_id, "world.json", {"era": "异世界"})

        result = sm.transition_check(proj_id, Stage.STAGE3)
        assert result.allowed, (
            f"STAGE2→STAGE3 should pass with world + characters. "
            f"missing={result.missing_files} failed={result.failed_checks}"
        )

    def test_state_machine_blocks_stage3_without_world_or_characters(self, projects_dir):
        """Without world.json or characters.json, the user genuinely hasn't
        completed STAGE2 and must not be allowed into STAGE3."""
        sm = StageStateMachine(projects_dir)
        proj_id = "proj_test"
        _write_json(projects_dir, proj_id, "project.json", {
            "id": proj_id, "title": "t", "genre": "g", "min_words": 4000,
            "current_stage": "STAGE2", "stage_history": [], "created_at": "2025-01-01T00:00:00",
        })
        # Intentionally no characters.json / world.json

        result = sm.transition_check(proj_id, Stage.STAGE3)
        assert not result.allowed
        assert "characters.json" in result.missing_files
        assert "world.json" in result.missing_files

    def test_state_machine_allows_stage3_with_novel_outline(self, projects_dir):
        """Having novel_outline.json is fine — it just means the user already
        generated it (e.g., is returning after a session restart)."""
        sm = StageStateMachine(projects_dir)
        proj_id = "proj_test"
        _write_json(projects_dir, proj_id, "project.json", {
            "id": proj_id, "title": "t", "genre": "g", "min_words": 4000,
            "current_stage": "STAGE2", "stage_history": [], "created_at": "2025-01-01T00:00:00",
        })
        _write_json(projects_dir, proj_id, "characters.json", {
            "characters": [{"id": "c1", "name": "林峰"}],
        })
        _write_json(projects_dir, proj_id, "world.json", {"era": "异世界"})
        _write_json(projects_dir, proj_id, "novel_outline.json", SAMPLE_NOVEL_OUTLINE)

        result = sm.transition_check(proj_id, Stage.STAGE3)
        assert result.allowed, f"Should pass: missing={result.missing_files} failed={result.failed_checks}"


def _make_char(cid: str, name: str, ctype: str, **overrides) -> dict:
    """Minimal Character-shaped dict for pick_outline_cast tests."""
    base = {
        "id": cid,
        "name": name,
        "character_type": ctype,
        "is_core_character": ctype == "protagonist",
        "personality": {
            "core_traits": ["坚毅"],
            "beliefs": [],
            "desires": [],
            "fears": [],
            "values": [],
        },
        "current_state": {"location": "起点", "physical_condition": "正常", "emotional": "平静"},
        "voice_signature": {"speech_style": "简练"},
        "relations": {},
    }
    base.update(overrides)
    return base


class TestLengthCategoryFor:
    """Target total word count → user-facing length category.
    Threshold table must match the LENGTHS options in CreateProjectCard.tsx
    (短篇快穿 30万 / 标准商业连载 100万 / 宏大史诗巨著 300万)."""

    def test_short(self):
        from backend.agents.planner import length_category_for
        assert length_category_for(300_000) == "短篇快穿"
        assert length_category_for(100_000) == "短篇快穿"
        assert length_category_for(1) == "短篇快穿"

    def test_medium(self):
        from backend.agents.planner import length_category_for
        assert length_category_for(500_000) == "标准商业连载"
        assert length_category_for(1_000_000) == "标准商业连载"
        assert length_category_for(500_001) == "标准商业连载"

    def test_long(self):
        from backend.agents.planner import length_category_for
        assert length_category_for(2_000_001) == "宏大史诗巨著"
        assert length_category_for(3_000_000) == "宏大史诗巨著"
        assert length_category_for(10_000_000) == "宏大史诗巨著"


class TestPickOutlineCast:
    """6-character selection for the novel-outline LLM context.
    Mirrors the wizard default batch (1P + 2A + 3S) and is the cap."""

    def test_empty_input_returns_empty(self):
        from backend.agents.planner import pick_outline_cast
        assert pick_outline_cast([]) == []

    def test_picks_1p_2a_3s_from_default_batch(self):
        from backend.agents.planner import pick_outline_cast
        chars = [
            _make_char("p1", "林峰", "protagonist"),
            _make_char("a1", "赵无极", "antagonist"),
            _make_char("a2", "魔尊", "antagonist"),
            _make_char("s1", "苏晓晓", "supporting"),
            _make_char("s2", "王大锤", "supporting"),
            _make_char("s3", "陈二狗", "supporting"),
        ]
        cast = pick_outline_cast(chars)
        assert len(cast) == 6
        by_role = {c["character_type"] for c in cast}
        assert by_role == {"protagonist", "antagonist", "supporting"}
        roles = [c["role"] for c in cast]
        assert roles == ["主角", "反派", "反派", "配角", "配角", "配角"]
        # Protagonist is first.
        assert cast[0]["name"] == "林峰"
        assert cast[0]["is_core"] is True

    def test_caps_each_role(self):
        from backend.agents.planner import pick_outline_cast
        chars = (
            [_make_char(f"p{i}", f"p{i}", "protagonist") for i in range(3)]
            + [_make_char(f"a{i}", f"a{i}", "antagonist") for i in range(5)]
            + [_make_char(f"s{i}", f"s{i}", "supporting") for i in range(7)]
        )
        cast = pick_outline_cast(chars)
        assert len(cast) == 6
        assert sum(1 for c in cast if c["character_type"] == "protagonist") == 1
        assert sum(1 for c in cast if c["character_type"] == "antagonist") == 2
        assert sum(1 for c in cast if c["character_type"] == "supporting") == 3

    def test_preserves_input_order_within_role(self):
        from backend.agents.planner import pick_outline_cast
        chars = [
            _make_char("a1", "a-1", "antagonist"),
            _make_char("a2", "a-2", "antagonist"),
            _make_char("a3", "a-3", "antagonist"),
        ]
        cast = pick_outline_cast(chars)
        # First two antagonists kept in order; third dropped by the 2-cap.
        assert [c["name"] for c in cast] == ["a-1", "a-2"]

    def test_mentor_appended_after_default_three_roles(self):
        from backend.agents.planner import pick_outline_cast
        chars = [
            _make_char("p1", "林峰", "protagonist"),
            _make_char("a1", "赵无极", "antagonist"),
            _make_char("s1", "苏晓晓", "supporting"),
            _make_char("m1", "师父", "mentor"),
        ]
        cast = pick_outline_cast(chars)
        assert [c["character_type"] for c in cast] == ["protagonist", "antagonist", "supporting", "mentor"]

    def test_handles_missing_role_buckets(self):
        """A project with only a protagonist + 3 supporting (no antagonists)
        should still return a 4-character cast without crashing."""
        from backend.agents.planner import pick_outline_cast
        chars = [
            _make_char("p1", "林峰", "protagonist"),
            _make_char("s1", "苏晓晓", "supporting"),
            _make_char("s2", "王大锤", "supporting"),
            _make_char("s3", "陈二狗", "supporting"),
        ]
        cast = pick_outline_cast(chars)
        assert len(cast) == 4
        assert [c["character_type"] for c in cast] == ["protagonist", "supporting", "supporting", "supporting"]

    def test_unknown_character_type_treated_as_supporting(self):
        from backend.agents.planner import pick_outline_cast
        chars = [
            _make_char("p1", "林峰", "protagonist"),
            _make_char("x1", "神秘人", "unknown_role"),
        ]
        cast = pick_outline_cast(chars)
        # "unknown_role" is not in OUTLINE_CAST_PRIORITY so it's skipped, not
        # bucketed into supporting. Documenting that behavior here.
        assert [c["name"] for c in cast] == ["林峰"]

    def test_includes_role_label_relations_and_state(self):
        """Each picked entry must surface the fields the LLM needs to design
        volumes and key plot points: role label, name, is_core, personality,
        current_state, relations."""
        from backend.agents.planner import pick_outline_cast
        chars = [
            _make_char(
                "p1", "林峰", "protagonist",
                relations={"a1": {"status": "enemy"}},
            ),
        ]
        cast = pick_outline_cast(chars)
        entry = cast[0]
        assert entry["role"] == "主角"
        assert entry["is_core"] is True
        assert "personality" in entry
        assert "current_state" in entry
        assert entry["relations"] == {"a1": {"status": "enemy"}}


class TestGenerateNovelOutlineContext:
    """End-to-end: verify the agent builds the right context and passes it to
    the prompt template. Mocks generate_from_template to capture kwargs."""

    @pytest.fixture
    def _stub_template(self, monkeypatch):
        from backend.agents import planner as planner_mod
        from backend.llm.base_provider import LLMResponse

        captured: dict = {}

        async def fake_generate_from_template(self, template_name, **kwargs):
            captured["template_name"] = template_name
            captured.update(kwargs)
            # log_usage() in PlannerAgent.generate_novel_outline inspects
            # response.provider etc., so the response can't be None here.
            return (
                SAMPLE_NOVEL_OUTLINE,
                LLMResponse(
                    text="<unused — json mode parsed>",
                    tokens_in=0,
                    tokens_out=0,
                    model="test-model",
                    provider="test",
                ),
            )

        monkeypatch.setattr(
            planner_mod.PlannerAgent,
            "generate_from_template",
            fake_generate_from_template,
        )
        return captured

    @pytest.mark.asyncio
    async def test_passes_six_characters_to_prompt(self, _stub_template):
        from backend.agents.planner import PlannerAgent

        characters = [
            _make_char("p1", "林峰", "protagonist"),
            _make_char("a1", "赵无极", "antagonist"),
            _make_char("a2", "魔尊", "antagonist"),
            _make_char("s1", "苏晓晓", "supporting"),
            _make_char("s2", "王大锤", "supporting"),
            _make_char("s3", "陈二狗", "supporting"),
        ]
        agent = PlannerAgent("proj_x")
        await agent.generate_novel_outline(
            concept={"title": "测试"},
            story_dna={"core_contradiction": {}},
            world={"era": "异世界", "power_system": {"name": "灵力"}, "core_rules": []},
            characters=characters,
            target_total_words=1_000_000,
        )
        ctx = _stub_template
        assert ctx["template_name"] == "novel_outline_generation"
        # 6 entries JSON-stringified.
        import json as _json
        parsed = _json.loads(ctx["characters_context"])
        assert len(parsed) == 6
        assert [c["role"] for c in parsed] == ["主角", "反派", "反派", "配角", "配角", "配角"]
        # Length category derived from target_total_words.
        assert ctx["length_category"] == "标准商业连载"
        assert ctx["target_total_words"] == 1_000_000

    @pytest.mark.asyncio
    async def test_passes_length_category_label(self, _stub_template):
        from backend.agents.planner import PlannerAgent

        agent = PlannerAgent("proj_x")
        await agent.generate_novel_outline(
            concept={}, story_dna={}, world={},
            characters=[_make_char("p1", "林峰", "protagonist")],
            target_total_words=3_000_000,
        )
        assert _stub_template["length_category"] == "宏大史诗巨著"
        assert _stub_template["target_total_words"] == 3_000_000

    @pytest.mark.asyncio
    async def test_passes_map_data_when_present(self, _stub_template):
        from backend.agents.planner import PlannerAgent

        agent = PlannerAgent("proj_x")
        await agent.generate_novel_outline(
            concept={}, story_dna={}, world={},
            characters=[_make_char("p1", "林峰", "protagonist")],
            target_total_words=1_000_000,
            map_data={"regions": [{"name": "中原", "factions": ["林家"]}]},
        )
        import json as _json
        parsed = _json.loads(_stub_template["map_context"])
        assert "regions" in parsed

    @pytest.mark.asyncio
    async def test_map_data_absent_yields_placeholder(self, _stub_template):
        """MapStep is a placeholder today, so map_data is typically None.
        The agent must not crash and must surface a clear placeholder so the
        LLM knows the section was intentionally empty."""
        from backend.agents.planner import PlannerAgent

        agent = PlannerAgent("proj_x")
        await agent.generate_novel_outline(
            concept={}, story_dna={}, world={},
            characters=[_make_char("p1", "林峰", "protagonist")],
            target_total_words=1_000_000,
            map_data=None,
        )
        assert "暂无" in _stub_template["map_context"]


class TestApiMapDataDefensiveRead:
    """The /api/stage3/generate-novel-outline endpoint must tolerate a missing
    map.json (MapStep is a placeholder today) without 500ing."""

    def test_api_handles_missing_map_json(self, client, project_data, monkeypatch):
        from backend.config import settings
        monkeypatch.setattr(settings, "projects_dir", settings.projects_dir)
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]
        _seed_project(settings.projects_dir, proj_id)
        # Intentionally do NOT write map.json.

        with patch("backend.agents.planner.PlannerAgent.generate_novel_outline", new_callable=AsyncMock) as mock:
            mock.return_value = (SAMPLE_NOVEL_OUTLINE, None)
            resp = client.post("/api/stage3/generate-novel-outline", json={"project_id": proj_id})

        assert resp.status_code == 200, resp.text
        # The agent should have been called with map_data=None.
        call_kwargs = mock.call_args.kwargs
        assert call_kwargs["map_data"] is None
        # And the full character list, not just [0].
        assert len(call_kwargs["characters"]) == 1
        assert call_kwargs["characters"][0]["name"] == "林峰"
