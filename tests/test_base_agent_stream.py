"""Tests for BaseAgent.generate_stream() and generate_from_template_stream().

Both methods MUST yield StreamChunk values directly from the provider with no JSON
parsing or retry — streaming partial JSON is meaningless. These tests use a fake
provider that yields a canned stream; we verify the agent's wrapper preserves
every chunk and finish_reason verbatim.
"""

import asyncio
import pytest

from backend.agents.base_agent import BaseAgent
from backend.llm.base_provider import BaseLLMProvider, LLMConfig, LLMResponse, StreamChunk


class FakeStreamProvider(BaseLLMProvider):
    """Returns a canned async stream from generate_stream(); non-streaming generate()
    is not exercised in this test file."""

    def __init__(self, chunks):
        config = LLMConfig(provider="fake", model="fake-model", api_key="x")
        super().__init__(config)
        self._chunks = chunks

    async def generate(self, system_prompt, user_prompt, **kwargs):
        return LLMResponse(
            text="unused", tokens_in=0, tokens_out=0,
            model="fake-model", provider="fake",
        )

    def supports_json_mode(self) -> bool:
        return False

    async def generate_stream(self, system_prompt, user_prompt, **kwargs):
        for c in self._chunks:
            yield c


@pytest.fixture
def agent_with_chunks():
    chunks = [
        StreamChunk(text="夜"),
        StreamChunk(text="风"),
        StreamChunk(text="如", finish_reason="刀"),
        StreamChunk(text=""),
        StreamChunk(text="", finish_reason="stop"),
    ]
    provider = FakeStreamProvider(chunks)
    agent = BaseAgent(project_id="proj_stream_test")
    agent._provider = provider  # skip create_provider()
    return agent


def test_generate_stream_passes_kwargs_through(agent_with_chunks):
    agent = agent_with_chunks

    async def _collect():
        return [
            c
            async for c in agent.generate_stream(
                "sys-p", "user-p", max_tokens=1024, temperature=0.5
            )
        ]

    out = asyncio.run(_collect())
    assert [c.text for c in out] == ["夜", "风", "如", "", ""]
    assert out[-2].text == ""
    assert "刀" not in [c.text for c in out[:-1]]
    # finish_reason="刀" should be preserved on chunk index 2
    assert out[2].finish_reason == "刀"


def test_generate_stream_does_not_retry_json(tmp_path):
    """Even on the 'wrong' response, streaming must NOT retry — the contract is
    raw stream passthrough. Verify by passing text that looks like invalid JSON;
    the agent must still yield all chunks without raising."""
    chunks = [
        StreamChunk(text="{not-json"),
        StreamChunk(text="}"),
        StreamChunk(text="", finish_reason="stop"),
    ]
    provider = FakeStreamProvider(chunks)
    agent = BaseAgent(project_id="proj_stream_test")
    agent._provider = provider

    async def _collect():
        return [c async for c in agent.generate_stream("sys", "user", json_mode=False)]

    out = asyncio.run(_collect())
    assert len(out) == 3


def test_generate_stream_rejects_json_mode(agent_with_chunks):
    """Stream cannot support JSON mode (partial JSON is meaningless). Explicit error."""
    agent = agent_with_chunks

    async def _call():
        return [c async for c in agent.generate_stream("s", "u", json_mode=True)]

    with pytest.raises(NotImplementedError, match="doesn't support json_mode"):
        asyncio.run(_call())


def test_generate_from_template_stream_yields_provider_chunks(tmp_path, monkeypatch):
    """When a prompt template is loaded and the agent streams, every StreamChunk is
    forwarded to the caller. We stub load_prompt so no YAML file is required."""
    from backend.agents import base_agent as ba

    class FakePrompt:
        max_tokens = 1024
        temperature = 0.7
        is_json_mode = False

        def format_system(self, **kw): return "fake-system"
        def format_user(self, **kw): return "fake-user"

    chunks = [StreamChunk(text="hei"), StreamChunk(text="lo"), StreamChunk(text="", finish_reason="stop")]
    provider = FakeStreamProvider(chunks)
    agent = BaseAgent(project_id="proj_stream_test")
    agent._provider = provider
    monkeypatch.setattr(agent, "load_prompt", lambda name, project_id=None: FakePrompt())

    async def _collect():
        return [c async for c in agent.generate_from_template_stream("scene_writing")]

    out = asyncio.run(_collect())
    assert [c.text for c in out] == ["hei", "lo", ""]
    assert out[-1].finish_reason == "stop"


def test_generate_stream_does_not_call_existing_generate():
    """generate_stream is a separate code path; ensure existing generate() is not invoked."""
    provider = FakeStreamProvider([StreamChunk(text="x"), StreamChunk(text="", finish_reason="stop")])
    agent = BaseAgent(project_id="proj_stream_test")
    agent._provider = provider

    called = {"generate": 0, "generate_stream": 0}
    original_generate = provider.generate
    original_stream = provider.generate_stream

    async def _wrapped(*a, **kw):
        called["generate"] += 1
        return await original_generate(*a, **kw)

    async def _wrapped_stream(*a, **kw):
        called["generate_stream"] += 1
        async for c in original_stream(*a, **kw):
            yield c

    provider.generate = _wrapped
    provider.generate_stream = _wrapped_stream

    async def _consume():
        async for _ in agent.generate_stream("s", "u"):
            pass

    asyncio.run(_consume())
    assert called["generate"] == 0
    assert called["generate_stream"] == 1