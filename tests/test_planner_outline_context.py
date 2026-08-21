"""Tests for planner.generate_outline's context assembly (v2.1 volume slicing)."""
from unittest.mock import patch

import pytest

from backend.agents.planner import PlannerAgent

NOVEL_OUTLINE = {
    "core_conflict_theme": "底层少年逆袭",
    "volumes": [
        {"name": "第一卷 崛起", "chapter_range": "1-50",
         "summary": "觉醒与初战", "key_events": ["金手指开启"]},
        {"name": "第二卷 试炼", "chapter_range": "51-120",
         "summary": "宗门之争", "key_events": ["擂台赛"]},
    ],
    "mc_growth_arc": [
        {"label": "起点", "target_chapter_range": "1-20", "description": "出身底层"},
    ],
    "key_plot_points": [
        {"title": "上古遗物", "must_appear_in_volume": "第一卷 崛起",
         "description": "金手指来源", "trigger_chapter_hint": "约第 5 章"},
    ],
}

CHARACTERS = [
    {"id": "mc", "name": "林峰", "character_type": "protagonist",
     "is_core_character": True, "personality": {"core_traits": ["坚韧"]},
     "current_state": {}, "relations": {},
     "growth_curve": {"curve_description": "", "stages": [
         {"stage_number": 1, "stage_name": "觉醒", "trigger_event_type": "moral_awakening",
          "trigger_event_description": "顿悟", "character_change": "由怯懦转为果决",
          "target_chapter_range": "1-20", "bound_chapter": None},
     ]}},
    {"id": "bad", "name": "黑袍人", "character_type": "antagonist",
     "is_core_character": False, "personality": {"core_traits": ["阴狠"]},
     "current_state": {}, "relations": {}},
]

OUTLINE = {"chapters": [
    {"chapter_number": 8, "title": "夜袭", "theme": "反击",
     "scene_plan": [{"scene_number": 1, "goal": "反杀追兵", "beat_type": "cliffhanger"}]},
]}


class _Resp:
    prompt_tokens = 0
    completion_tokens = 0
    total_tokens = 0
    model = "test"
    provider = "test"
    content = "{}"
    latency_ms = 0
    tokens_in = 0
    tokens_out = 0
    finish_reason = "stop"
    text = "{}"


async def _render(**overrides) -> str:
    """Run generate_outline with the LLM stubbed and return the user prompt."""
    captured = {}

    async def fake_tier(self, task_name, system_prompt, user_prompt, **kwargs):
        captured["user"] = user_prompt
        captured["system"] = system_prompt
        return {"chapter_number": 1, "scene_plan": []}, _Resp()

    kwargs = dict(
        concept={"title": "测试"},
        story_dna={},
        world={"era": "异世界", "core_rules": []},
        characters=CHARACTERS,
        chapter_number=9,
        min_words=2000,
        novel_outline=NOVEL_OUTLINE,
        outline=OUTLINE,
    )
    kwargs.update(overrides)

    planner = PlannerAgent(project_id="test")
    with patch.object(PlannerAgent, "generate_with_tier", new=fake_tier):
        await planner.generate_outline(**kwargs)
    return captured["user"]


class TestVolumeSlicing:
    @pytest.mark.asyncio
    async def test_only_current_volume_key_events_injected(self):
        rendered = await _render()
        assert "【当前卷·第一卷 崛起】" in rendered
        assert "金手指开启" in rendered
        assert "擂台赛" not in rendered

    @pytest.mark.asyncio
    async def test_adjacent_volume_summary_injected(self):
        rendered = await _render()
        assert "【下一卷·第二卷 试炼】" in rendered
        assert "宗门之争" in rendered

    @pytest.mark.asyncio
    async def test_current_volume_plot_points_injected(self):
        rendered = await _render()
        assert "上古遗物" in rendered

    @pytest.mark.asyncio
    async def test_no_novel_outline_degrades(self):
        rendered = await _render(novel_outline=None)
        assert "暂无全书大纲" in rendered


class TestGrowthAndCast:
    @pytest.mark.asyncio
    async def test_growth_context_injected(self):
        rendered = await _render()
        assert "角色成长态势" in rendered
        assert "由怯懦转为果决" in rendered

    @pytest.mark.asyncio
    async def test_no_growth_curves_degrades(self):
        rendered = await _render(characters=[
            {"id": "x", "name": "路人", "character_type": "supporting",
             "personality": {}, "current_state": {}, "relations": {}},
        ])
        assert "暂无角色成长曲线" in rendered

    @pytest.mark.asyncio
    async def test_cast_includes_antagonist_not_just_first_character(self):
        rendered = await _render()
        assert "林峰" in rendered
        assert "黑袍人" in rendered


class TestRecentChapters:
    @pytest.mark.asyncio
    async def test_previous_chapter_injected(self):
        rendered = await _render()
        assert "【本卷前文" in rendered
        assert "《夜袭》" in rendered
        assert "反杀追兵" in rendered

    @pytest.mark.asyncio
    async def test_volume_first_chapter_has_no_previous_text(self):
        rendered = await _render(chapter_number=1)
        assert "本卷起始章，无前文" in rendered


class TestPromptOverrideCompatibility:
    @pytest.mark.asyncio
    async def test_pre_change_template_still_renders(self):
        """Prompt Plaza overrides store the full template text. A user override
        saved before this change still contains only the old slots; rendering
        must not raise KeyError."""
        old_template = (
            "故事概念：\n{concept_context}\n\n"
            "Story DNA：\n{story_dna_context}\n\n"
            "世界观：\n{world_context}\n\n"
            "角色设定：\n{character_context}\n\n"
            "全书大纲：\n{novel_outline_context}\n\n"
            "目标章节：第 {chapter_number} 章\n"
            "最低字数：{min_words} 字\n\n"
            "{genre_beat_patterns}\n\n{genre_focus_vocabulary}\n\n"
            "{genre_pacing}\n\n{user_modifications}\n"
        )

        captured = {}

        async def fake_tier(self, task_name, system_prompt, user_prompt, **kwargs):
            captured["user"] = user_prompt
            return {"chapter_number": 1, "scene_plan": []}, _Resp()

        planner = PlannerAgent(project_id="test")
        original_load = PlannerAgent.load_prompt

        def load_with_override(self, template_name, project_id=None):
            prompt = original_load(self, template_name, project_id=project_id)
            if template_name == "outline_generation":
                prompt.user_prompt_template = old_template
            return prompt

        with patch.object(PlannerAgent, "generate_with_tier", new=fake_tier), \
             patch.object(PlannerAgent, "load_prompt", new=load_with_override):
            await planner.generate_outline(
                concept={"title": "测试"}, story_dna={},
                world={"era": "异世界", "core_rules": []},
                characters=CHARACTERS, chapter_number=9, min_words=2000,
                novel_outline=NOVEL_OUTLINE, outline=OUTLINE,
            )

        assert "【当前卷·第一卷 崛起】" in captured["user"]
