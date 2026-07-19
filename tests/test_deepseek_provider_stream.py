"""Tests for DeepSeekProvider.generate_stream().

The OpenAI SDK chat.completions.create(stream=True) returns an async iterator of
ChatCompletionChunk objects. We mock the SDK and verify that generate_stream() yields
one StreamChunk per non-empty delta plus a final empty StreamChunk carrying finish_reason.
"""

import asyncio
import pytest
from types import SimpleNamespace

from backend.llm.deepseek_provider import DeepSeekProvider
from backend.llm.base_provider import LLMConfig, StreamChunk


def _make_chunk(text="", finish_reason=None):
    """Build a fake ChatCompletionChunk with one choice."""
    choice = SimpleNamespace(
        delta=SimpleNamespace(content=text),
        finish_reason=finish_reason,
    )
    return SimpleNamespace(choices=[choice])


class FakeStream:
    """Async iterable that yields the given chunks then stops."""

    def __init__(self, chunks):
        self._chunks = chunks

    def __aiter__(self):
        self._iter = iter(self._chunks)
        return self

    async def __anext__(self):
        try:
            return next(self._iter)
        except StopIteration as exc:
            raise StopAsyncIteration from exc


class FakeCompletionsAPI:
    def __init__(self, fake_stream):
        self._fake_stream = fake_stream
        self.last_kwargs = None

    async def create(self, **kwargs):
        self.last_kwargs = kwargs
        return self._fake_stream


class FakeDeepSeekClient:
    def __init__(self, stream):
        self.chat = SimpleNamespace(completions=FakeCompletionsAPI(stream))


@pytest.fixture
def provider_with_chunks(texts=("沈", "渡", "靠在", "墙上"), finish_reason="stop"):
    chunks = [_make_chunk(t) for t in texts]
    chunks.append(_make_chunk(text="", finish_reason=finish_reason))
    fake_stream = FakeStream(chunks)
    fake_client = FakeDeepSeekClient(fake_stream)
    config = LLMConfig(provider="deepseek", model="deepseek-test", api_key="x")
    provider = DeepSeekProvider(config)
    provider.client = fake_client
    return provider, fake_client


def test_generate_stream_yields_text_deltas_and_final_chunk(provider_with_chunks):
    provider, _ = provider_with_chunks

    async def _collect():
        return [c async for c in provider.generate_stream("sys", "user")]

    chunks = asyncio.run(_collect())
    assert [c.text for c in chunks] == ["沈", "渡", "靠在", "墙上", ""]
    assert chunks[-1].finish_reason == "stop"
    # All non-final chunks have finish_reason None
    assert all(c.finish_reason is None for c in chunks[:-1])


def test_generate_stream_skips_empty_delta_content():
    """Some OpenAI streaming chunks have content=None (e.g. role-only first chunk).
    Those must be skipped — no StreamChunk yielded."""
    chunks = [
        _make_chunk(text=None),  # role-only first chunk
        _make_chunk(text="夜"),
        _make_chunk(text=None),  # sometimes between deltas
        _make_chunk(text="风"),
        _make_chunk(text="", finish_reason="stop"),
    ]
    fake_stream = FakeStream(chunks)
    fake_client = FakeDeepSeekClient(fake_stream)
    config = LLMConfig(provider="deepseek", model="deepseek-test", api_key="x")
    provider = DeepSeekProvider(config)
    provider.client = fake_client

    async def _collect():
        return [c async for c in provider.generate_stream("sys", "user")]

    chunks_out = asyncio.run(_collect())
    assert [c.text for c in chunks_out] == ["夜", "风", ""]


def test_generate_stream_terminates_after_finish_reason():
    """A second finish_reason chunk should not be re-yielded."""
    chunks = [
        _make_chunk(text="text"),
        _make_chunk(text="", finish_reason="stop"),
        _make_chunk(text="more"),  # OpenAI sometimes yields after — must NOT reach UI
    ]
    fake_stream = FakeStream(chunks)
    fake_client = FakeDeepSeekClient(fake_stream)
    config = LLMConfig(provider="deepseek", model="deepseek-test", api_key="x")
    provider = DeepSeekProvider(config)
    provider.client = fake_client

    async def _collect():
        return [c async for c in provider.generate_stream("sys", "user")]

    chunks_out = asyncio.run(_collect())
    assert [c.text for c in chunks_out] == ["text", ""]
    assert len(chunks_out) == 2


def test_generate_stream_passes_system_message(provider_with_chunks):
    provider, client = provider_with_chunks

    async def _call():
        async for _ in provider.generate_stream("sys-prompt", "user-prompt"):
            pass

    asyncio.run(_call())
    kw = client.chat.completions.last_kwargs
    assert kw["model"] == "deepseek-test"
    assert kw["messages"] == [
        {"role": "system", "content": "sys-prompt"},
        {"role": "user", "content": "user-prompt"},
    ]
    assert kw["stream"] is True
