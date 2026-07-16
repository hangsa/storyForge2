"""Tests for AnthropicProvider.generate_stream().

The real Anthropic SDK is mocked so no API key is required and no network call happens.
We verify that generate_stream() yields one StreamChunk per text delta and one final
StreamChunk carrying finish_reason from the SDK's stop_reason.
"""

import asyncio
import pytest
from types import SimpleNamespace
from unittest.mock import MagicMock

from backend.llm.anthropic_provider import AnthropicProvider
from backend.llm.base_provider import LLMConfig, StreamChunk


class FakeFinalMessage:
    """Stand-in for anthropic.AsyncAnthropic.messages.Message returned by get_final_message."""
    stop_reason = "end_turn"


class FakeTextStream:
    """Async iterable that yields each element of `texts` on iteration."""

    def __init__(self, texts):
        self._texts = texts

    def __aiter__(self):
        self._iter = iter(self._texts)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration as exc:
            raise StopAsyncIteration from exc


class FakeStreamContext:
    """Stand-in for the async-context-manager returned by client.messages.stream()."""

    def __init__(self, texts, stop_reason="end_turn"):
        self.text_stream = FakeTextStream(texts)
        self._final = FakeFinalMessage()
        self._final.stop_reason = stop_reason

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get_final_message(self):
        return self._final


class FakeMessagesAPI:
    """Stand-in for the bound `client.messages` object."""

    def __init__(self, stream_ctx):
        self._stream_ctx = stream_ctx
        self.last_kwargs = None

    def stream(self, **kwargs):
        self.last_kwargs = kwargs
        return self._stream_ctx


class FakeAnthropicClient:
    def __init__(self, stream_ctx):
        self.messages = FakeMessagesAPI(stream_ctx)


@pytest.fixture
def provider_with_chunks(texts=("夜风", "如刀", "。"), stop_reason="end_turn"):
    """Build an AnthropicProvider whose internal client is a fake that yields the
    given text deltas followed by a final StreamChunk carrying stop_reason."""
    stream_ctx = FakeStreamContext(list(texts), stop_reason=stop_reason)
    fake_client = FakeAnthropicClient(stream_ctx)
    config = LLMConfig(provider="anthropic", model="claude-test", api_key="x")
    provider = AnthropicProvider(config)
    provider.client = fake_client  # ← override real SDK client
    return provider, fake_client


def test_generate_stream_yields_text_deltas(provider_with_chunks):
    provider, _ = provider_with_chunks

    async def _collect():
        return [c async for c in provider.generate_stream("sys", "user")]

    chunks = asyncio.run(_collect())
    # One delta per text + one final empty chunk carrying finish_reason
    assert len(chunks) == 4
    assert [c.text for c in chunks] == ["夜风", "如刀", "。", ""]
    assert [c.finish_reason for c in chunks] == [None, None, None, "end_turn"]


def test_generate_stream_passes_kwargs_to_sdk(provider_with_chunks):
    provider, client = provider_with_chunks

    async def _call():
        async for _ in provider.generate_stream(
            "sys", "user", max_tokens=512, temperature=0.3
        ):
            pass

    asyncio.run(_call())
    kw = client.messages.last_kwargs
    assert kw["model"] == "claude-test"
    assert kw["system"] == "sys"
    assert kw["messages"] == [{"role": "user", "content": "user"}]
    assert kw["max_tokens"] == 512
    assert kw["temperature"] == 0.3


def test_generate_stream_uses_default_max_tokens_when_not_overridden():
    stream_ctx = FakeStreamContext(["only"])
    fake_client = FakeAnthropicClient(stream_ctx)
    config = LLMConfig(
        provider="anthropic",
        model="claude-test",
        api_key="x",
        max_tokens=2048,
        temperature=0.9,
    )
    provider = AnthropicProvider(config)
    provider.client = fake_client

    async def _call():
        async for _ in provider.generate_stream("sys", "user"):
            pass

    asyncio.run(_call())
    assert fake_client.messages.last_kwargs["max_tokens"] == 2048
    assert fake_client.messages.last_kwargs["temperature"] == 0.9


def test_generate_stream_length_stop_propagates():
    stream_ctx = FakeStreamContext(["short"], stop_reason="length")
    fake_client = FakeAnthropicClient(stream_ctx)
    config = LLMConfig(provider="anthropic", model="claude-test", api_key="x")
    provider = AnthropicProvider(config)
    provider.client = fake_client

    async def _collect():
        return [c async for c in provider.generate_stream("sys", "user")]

    chunks = asyncio.run(_collect())
    assert chunks[-1].finish_reason == "length"


def test_generate_stream_does_not_mutate_existing_generate(provider_with_chunks):
    """Sanity: the existing non-streaming generate() is unchanged."""
    provider, _ = provider_with_chunks
    assert hasattr(provider, "generate")
    # generate() still uses self.client.messages.create, not stream
    import inspect
    src = inspect.getsource(provider.generate)
    assert "messages.create" in src
    assert "messages.stream" not in src