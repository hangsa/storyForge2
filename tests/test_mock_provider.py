import pytest
from backend.llm.base_provider import LLMConfig
from backend.llm.mock_provider import MockProvider


@pytest.fixture
def cfg():
    return LLMConfig(provider="mock", model="mock-m", api_key="k")


@pytest.mark.asyncio
async def test_generate_returns_fixed_text(cfg):
    p = MockProvider(cfg, text="hello world")
    resp = await p.generate("sys", "user")
    assert resp.text == "hello world"
    assert resp.model == "mock-m"
    assert resp.provider == "mock"


@pytest.mark.asyncio
async def test_supports_json_mode(cfg):
    assert MockProvider(cfg).supports_json_mode() is False


@pytest.mark.asyncio
async def test_generate_stream_emits_one_chunk_then_finish(cfg):
    p = MockProvider(cfg, text="payload")
    chunks = []
    async for c in p.generate_stream("sys", "user"):
        chunks.append(c)
    assert chunks[0].text == "payload"
    assert chunks[-1].finish_reason == "stop"
