"""Verify the base LLM provider contract: StreamChunk shape + generate_stream() abstract.

Concrete providers (Anthropic, DeepSeek, MiniMax) must subclass BaseLLMProvider and
implement generate_stream() to yield StreamChunk dataclasses. These tests verify only
the abstract contract at the base class level — concrete provider tests live in their
own files.
"""

import pytest
from backend.llm.base_provider import (
    BaseLLMProvider,
    LLMConfig,
    StreamChunk,
)


class _ConcreteProvider(BaseLLMProvider):
    """Minimal subclass used only for verifying the abstract contract compiles."""

    async def generate(self, system_prompt, user_prompt, **kwargs):
        # Not exercised in this test file; just satisfies ABC.
        raise NotImplementedError

    def supports_json_mode(self) -> bool:
        return False

    async def generate_stream(self, system_prompt, user_prompt, **kwargs):
        yield StreamChunk(text="alpha")
        yield StreamChunk(text="beta", finish_reason="stop")


def _make_provider() -> _ConcreteProvider:
    return _ConcreteProvider(LLMConfig(provider="test", model="test-model", api_key="x"))


def test_stream_chunk_carries_text_and_optional_finish_reason():
    chunk = StreamChunk(text="hello", finish_reason="stop")
    assert chunk.text == "hello"
    assert chunk.finish_reason == "stop"


def test_stream_chunk_finish_reason_defaults_to_none():
    chunk = StreamChunk(text="partial")
    assert chunk.text == "partial"
    assert chunk.finish_reason is None


def test_generate_stream_is_abstract():
    """A subclass that fails to implement generate_stream() cannot be instantiated."""
    class Incomplete(BaseLLMProvider):
        async def generate(self, system_prompt, user_prompt, **kwargs):
            raise NotImplementedError

        def supports_json_mode(self) -> bool:
            return False

    config = LLMConfig(provider="x", model="y", api_key="z")
    with pytest.raises(TypeError):
        Incomplete(config)  # type: ignore[abstract]


def test_concrete_provider_yields_stream_chunks():
    """Async-generator contract: provider can yield multiple StreamChunk values."""
    import asyncio

    async def _collect():
        out = []
        async for c in _make_provider().generate_stream("s", "u"):
            out.append(c)
        return out

    chunks = asyncio.run(_collect())
    assert [c.text for c in chunks] == ["alpha", "beta"]
    assert chunks[0].finish_reason is None
    assert chunks[1].finish_reason == "stop"