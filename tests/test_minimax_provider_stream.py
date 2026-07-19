"""Tests for MiniMaxProvider.generate_stream().

MiniMax uses the OpenAI SDK (same wire-protocol as DeepSeek). Tests mirror the
DeepSeek tests but exercise the MiniMax class to confirm both providers implement
the streaming contract independently — refactoring one shouldn't silently break
the other.
"""

import asyncio
import pytest
from types import SimpleNamespace

from backend.llm.minimax_provider import MiniMaxProvider
from backend.llm.base_provider import LLMConfig, StreamChunk


def _make_chunk(text="", finish_reason=None):
    choice = SimpleNamespace(
        delta=SimpleNamespace(content=text),
        finish_reason=finish_reason,
    )
    return SimpleNamespace(choices=[choice])


class FakeStream:
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
        # async def to match real openai>=1.x AsyncCompletions.create (coroutine)
        self.last_kwargs = kwargs
        return self._fake_stream


class FakeMiniMaxClient:
    def __init__(self, stream):
        self.chat = SimpleNamespace(completions=FakeCompletionsAPI(stream))


def _build_provider(stream_chunks):
    fake_stream = FakeStream(stream_chunks)
    fake_client = FakeMiniMaxClient(fake_stream)
    config = LLMConfig(provider="minimax", model="minimax-test", api_key="x")
    provider = MiniMaxProvider(config)
    provider.client = fake_client
    return provider, fake_client


@pytest.fixture
def provider_with_chunks():
    chunks = [
        _make_chunk(text="林"),
        _make_chunk(text="峰"),
        _make_chunk(text="。"),
        _make_chunk(text="", finish_reason="stop"),
    ]
    return _build_provider(chunks)


def test_generate_stream_yields_deltas_and_final_chunk(provider_with_chunks):
    provider, _ = provider_with_chunks

    async def _collect():
        return [c async for c in provider.generate_stream("sys", "user")]

    out = asyncio.run(_collect())
    assert [c.text for c in out] == ["林", "峰", "。", ""]
    assert out[-1].finish_reason == "stop"


def test_generate_stream_skips_none_content():
    chunks = [
        _make_chunk(text=None),
        _make_chunk(text="夜"),
        _make_chunk(text=None),
        _make_chunk(text="风"),
        _make_chunk(text="", finish_reason="stop"),
    ]
    provider, _ = _build_provider(chunks)

    async def _collect():
        return [c async for c in provider.generate_stream("sys", "user")]

    out = asyncio.run(_collect())
    assert [c.text for c in out] == ["夜", "风", ""]


def test_generate_stream_terminates_after_first_finish_reason():
    chunks = [
        _make_chunk(text="x"),
        _make_chunk(text="", finish_reason="stop"),
        _make_chunk(text="should-not-appear"),
    ]
    provider, _ = _build_provider(chunks)

    async def _collect():
        return [c async for c in provider.generate_stream("sys", "user")]

    out = asyncio.run(_collect())
    assert [c.text for c in out] == ["x", ""]


def test_generate_stream_passes_model_and_messages():
    chunks = [_make_chunk(text=""), _make_chunk(text="", finish_reason="stop")]
    provider, client = _build_provider(chunks)

    async def _call():
        async for _ in provider.generate_stream("system-x", "user-x"):
            pass

    asyncio.run(_call())
    kw = client.chat.completions.last_kwargs
    assert kw["model"] == "minimax-test"
    assert kw["messages"][0] == {"role": "system", "content": "system-x"}
    assert kw["messages"][1] == {"role": "user", "content": "user-x"}
    assert kw["stream"] is True
