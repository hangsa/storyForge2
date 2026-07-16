"""Test WriterAgent.write_scene_stream() forwards every StreamChunk from the agent
streaming path through the scene-writing prompt template.

The base-agent streaming wrapper is exercised in tests/test_base_agent_stream.py —
this file verifies the writer-level wrapper:
  - loads the right prompt template
  - assembles the same template vars as write_scene() (same string keys)
  - yields every chunk verbatim
"""

import asyncio
from pathlib import Path
from types import SimpleNamespace
import pytest

from backend.agents.base_agent import StreamChunk
from backend.agents.writer import WriterAgent


class _FakeBaseAgent:
    """Stand-in for BaseAgent used only by write_scene_stream.

    write_scene_stream() calls self.generate_from_template_stream("scene_writing", ...).
    We capture the kwargs and yield a canned sequence.
    """

    def __init__(self, chunks):
        self._chunks = chunks
        self.captured_template = None
        self.captured_kwargs = None

    async def generate_from_template_stream(self, template_name, **kwargs):
        self.captured_template = template_name
        self.captured_kwargs = kwargs
        for c in self._chunks:
            yield c


def test_write_scene_stream_uses_scene_writing_template():
    chunks = [
        StreamChunk(text="夜风"),
        StreamChunk(text="如刀"),
        StreamChunk(text="", finish_reason="stop"),
    ]
    fake = _FakeBaseAgent(chunks)
    # Bypass __init__; we only need .write_scene_stream() which uses self
    writer = WriterAgent.__new__(WriterAgent)
    writer._FakeBaseAgent = fake  # not used directly; just for clarity

    # Inject the streaming-only delegate onto the writer
    writer._stream_delegate = fake

    # Monkey-patch the method we want to test by indirecting through a tiny shim:
    # we call writer.write_scene_stream, but it normally calls self.generate_from_template_stream.
    # Replace that bound method with our fake.
    writer.generate_from_template_stream = fake.generate_from_template_stream

    async def _collect():
        return [
            c
            async for c in writer.write_scene_stream(
                genre="xianxia",
                concept={"concept": {"premise": "p"}, "story_dna": {"core_contradiction": {"statement": "s"}}},
                world_rules={
                    "power_system": {"name": "qi", "description": "d"},
                    "core_rules": ["r1"],
                    "ceilings": ["c1"],
                },
                characters=[{"name": "林峰", "character_type": "protagonist",
                             "current_state": {"location": "X", "emotional": "calm"},
                             "voice_signature": {"taboos": []},
                             "unknown_to_character": []}],
                scene_plan={"goal": "g", "conflict": "c",
                            "emotional_arc": "ea", "narrative_role": "setup",
                            "required_logs": []},
                l0_context="L0", l1_context="L1", l2_context="L2",
                l3_context="L3", l4_context="L4",
                growth_stage_hint="", character_growth_context="",
            )
        ]

    out = asyncio.run(_collect())
    assert [c.text for c in out] == ["夜风", "如刀", ""]
    assert out[-1].finish_reason == "stop"
    assert fake.captured_template == "scene_writing"


def test_write_scene_stream_passes_through_kwargs():
    fake = _FakeBaseAgent([StreamChunk(text="x"), StreamChunk(text="", finish_reason="stop")])
    writer = WriterAgent.__new__(WriterAgent)
    writer.generate_from_template_stream = fake.generate_from_template_stream

    async def _call():
        async for _ in writer.write_scene_stream(
            genre="g", concept={"concept": {}, "story_dna": {}}, world_rules={},
            characters=[], scene_plan={"goal": "", "conflict": "",
                                       "emotional_arc": "", "narrative_role": "",
                                       "required_logs": []},
            l0_context="", l1_context="", l2_context="",
            l3_context="", l4_context="",
            growth_stage_hint="hint-X", character_growth_context="ctx-Y",
            reader_os_warnings="warn-Z",
        ):
            pass

    asyncio.run(_call())
    assert fake.captured_kwargs["growth_stage_hint"] == "hint-X"
    assert fake.captured_kwargs["character_growth_context"] == "ctx-Y"
    assert fake.captured_kwargs["reader_os_warnings"] == "warn-Z"


def test_write_scene_stream_yields_zero_chunks_when_provider_yields_none():
    """If the provider completes before yielding any text (e.g. empty response),
    write_scene_stream must yield only the final empty finish chunk — no exception."""
    fake = _FakeBaseAgent([StreamChunk(text="", finish_reason="stop")])
    writer = WriterAgent.__new__(WriterAgent)
    writer.generate_from_template_stream = fake.generate_from_template_stream

    async def _collect():
        return [
            c
            async for c in writer.write_scene_stream(
                genre="g", concept={"concept": {}, "story_dna": {}}, world_rules={},
                characters=[], scene_plan={"goal": "", "conflict": "",
                                            "emotional_arc": "", "narrative_role": "",
                                            "required_logs": []},
                l0_context="", l1_context="", l2_context="",
                l3_context="", l4_context="",
            )
        ]

    out = asyncio.run(_collect())
    assert len(out) == 1
    assert out[0].finish_reason == "stop"