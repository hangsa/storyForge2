"""End-to-end test of Writer pipeline with mocked LLM.

Verifies that:
  1. write_scene passes `chapter_outline_context` as a template var.
  2. write_scene passes the rewritten `characters_context` (with full
     structured fields + behavior examples) as a template var.
"""
import pytest
from unittest.mock import patch, AsyncMock

from backend.agents.writer import WriterAgent
from backend.agents.base_agent import LLMResponse


@pytest.fixture
def mock_generate():
    with patch.object(WriterAgent, "generate_from_template", new_callable=AsyncMock) as m:
        m.return_value = (
            {"text": "scene text"},
            LLMResponse(text="", tokens_in=0, tokens_out=0, model="", provider=""),
        )
        yield m


@pytest.mark.asyncio
async def test_write_scene_passes_chapter_outline_context(mock_generate):
    chapter = {"chapter_number": 31, "title": "雷劫洞中醒", "theme": "重生", "scene_plan": []}
    await WriterAgent(project_id="test").write_scene(
        genre="xianxia",
        concept={"story_dna": {"core_contradiction": {}}, "concept": {"premise": ""}},
        world_rules={"power_system": {}, "core_rules": [], "ceilings": []},
        characters=[{"id": "pov", "name": "林峰", "character_type": "protagonist",
                     "personality": {"beliefs": [], "desires": [], "fears": [], "values": [], "core_traits": []},
                     "voice_signature": {"speech_style": "s", "thought_patterns": "t", "taboos": []},
                     "current_state": {"location": "", "physical_condition": "normal", "emotional": "neutral", "known_secrets": []},
                     "unknown_to_character": [], "relations": {}}],
        scene_plan={"scene_number": 1, "goal": "苏醒", "conflict": "觉醒", "emotional_arc": "震惊→好奇",
                    "narrative_role": "setup", "beat_type": "opening",
                    "registry_changes": {"created": [], "updated": []}, "required_logs": []},
        outline_chapter=chapter,
    )
    call_kwargs = mock_generate.call_args.kwargs
    assert "chapter_outline_context" in call_kwargs
    assert "标题: 雷劫洞中醒" in call_kwargs["chapter_outline_context"]
    assert "主题: 重生" in call_kwargs["chapter_outline_context"]


@pytest.mark.asyncio
async def test_write_scene_passes_full_structured_characters_context(mock_generate):
    """Verify the new characters_context includes structured fields + behavior examples."""
    pov = {"id": "pov", "name": "林峰", "character_type": "protagonist",
           "personality": {"beliefs": ["正道"], "desires": ["守护"], "fears": ["失去"],
                           "values": ["义"], "core_traits": ["勇敢"]},
           "voice_signature": {"speech_style": "沉稳", "thought_patterns": "三思",
                               "taboos": ["撒谎"],
                               "behavior_examples": [
                                   {"situation": "师父失踪", "action": "暗中调查", "speech_sample": "真相终会大白。"}
                               ]},
           "current_state": {"location": "山洞", "physical_condition": "normal",
                             "emotional": "震惊", "known_secrets": []},
           "unknown_to_character": ["secret_x"], "relations": {}}
    await WriterAgent(project_id="test").write_scene(
        genre="xianxia",
        concept={"story_dna": {"core_contradiction": {}}, "concept": {"premise": ""}},
        world_rules={"power_system": {}, "core_rules": [], "ceilings": []},
        characters=[pov],
        scene_plan={"scene_number": 1, "goal": "苏醒", "conflict": "", "emotional_arc": "",
                    "narrative_role": "setup", "beat_type": "opening",
                    "registry_changes": {"created": [], "updated": []}, "required_logs": []},
        outline_chapter=None,
    )
    call_kwargs = mock_generate.call_args.kwargs
    cc = call_kwargs["characters_context"]
    assert "林峰 (主角 (POV))" in cc
    assert "信念: [正道]" in cc
    assert "行为示例:" in cc
    assert "真相终会大白。" in cc
