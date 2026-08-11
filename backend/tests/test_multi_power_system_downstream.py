"""Multi power system aggregation in the downstream consumers.

A world can define several power systems. The Writer prompt carries a single
name/description pair and Fact Guard applies a single constraint space, so
both flatten the list. These tests pin how.
"""
import pytest
from unittest.mock import patch, AsyncMock

from backend.agents.writer import WriterAgent
from backend.agents.reviewer import ReviewerAgent
from backend.agents.base_agent import LLMResponse


TWO_SYSTEMS = [
    {
        "name": "灵力",
        "description": "吸纳天地灵气",
        "core_rules": ["灵气有限"],
        "ceilings": ["最高元婴"],
    },
    {
        "name": "武道",
        "description": "锤炼肉身",
        "core_rules": ["气血枯竭则止"],
        "ceilings": ["最高宗师"],
        "cost_system": "折寿",
    },
]

CHARACTER = {
    "id": "pov", "name": "林峰", "character_type": "protagonist",
    "personality": {"beliefs": [], "desires": [], "fears": [], "values": [], "core_traits": []},
    "voice_signature": {"speech_style": "s", "thought_patterns": "t", "taboos": []},
    "current_state": {"location": "", "physical_condition": "normal",
                      "emotional": "neutral", "known_secrets": []},
    "unknown_to_character": [], "relations": {},
}

SCENE_PLAN = {
    "scene_number": 1, "goal": "苏醒", "conflict": "觉醒",
    "emotional_arc": "震惊→好奇", "narrative_role": "setup", "beat_type": "opening",
    "registry_changes": {"created": [], "updated": []}, "required_logs": [],
}


@pytest.fixture
def mock_generate():
    with patch.object(WriterAgent, "generate_from_template", new_callable=AsyncMock) as m:
        m.return_value = (
            {"text": "scene text"},
            LLMResponse(text="", tokens_in=0, tokens_out=0, model="", provider=""),
        )
        yield m


async def _write(world_rules, mock_generate):
    await WriterAgent(project_id="test").write_scene(
        genre="xianxia",
        concept={"story_dna": {"core_contradiction": {}}, "concept": {"premise": ""}},
        world_rules=world_rules,
        characters=[CHARACTER],
        scene_plan=SCENE_PLAN,
        outline_chapter={"chapter_number": 1, "title": "t", "theme": "x", "scene_plan": []},
    )
    return mock_generate.call_args.kwargs


@pytest.mark.asyncio
async def test_writer_prompt_lists_every_power_system(mock_generate):
    kwargs = await _write({"power_systems": TWO_SYSTEMS}, mock_generate)
    assert kwargs["power_system_name"] == "灵力、武道"
    desc = kwargs["power_system_description"]
    assert "【灵力】吸纳天地灵气" in desc
    assert "【武道】锤炼肉身" in desc


@pytest.mark.asyncio
async def test_writer_still_reads_the_legacy_singular_shape(mock_generate):
    # Stage 4 loads world.json as a bare dict, so files that predate the
    # migration reach the writer unconverted.
    kwargs = await _write({"power_system": TWO_SYSTEMS[0]}, mock_generate)
    assert kwargs["power_system_name"] == "灵力"
    assert "【灵力】吸纳天地灵气" in kwargs["power_system_description"]


def test_fact_guard_unions_ceilings_across_systems():
    reviewer = ReviewerAgent(project_id="test")
    # A ceiling from the *second* system must still be enforced.
    result = reviewer.check_3_world_rules(
        "他施展最高宗师之力", {"power_systems": TWO_SYSTEMS}
    )
    assert result.passed is False
    assert "最高宗师" in result.detail


def test_fact_guard_requires_a_cost_log_if_any_system_charges_one():
    reviewer = ReviewerAgent(project_id="test")
    # Only 武道 defines cost_system, but power use anywhere in the scene
    # must declare a cost.
    result = reviewer.check_3_world_rules(
        "他施展最高元婴之力", {"power_systems": TWO_SYSTEMS}
    )
    assert result.passed is False
    assert "代价" in result.detail


def test_fact_guard_skips_when_no_system_defines_a_ceiling():
    reviewer = ReviewerAgent(project_id="test")
    result = reviewer.check_3_world_rules(
        "他施展寻常拳脚",
        {"power_systems": [{"name": "灵力", "ceilings": []}]},
    )
    assert result.passed is True
    assert "跳过" in result.detail
