import pytest
from backend.llm.base_provider import LLMConfig
from backend.llm.openai_compatible_provider import OpenAICompatibleProvider


@pytest.fixture
def cfg():
    return LLMConfig(
        provider="custom",
        model="x",
        api_key="k",
        base_url="https://example.com/v1",
        max_tokens=10,
    )


@pytest.mark.asyncio
async def test_init_uses_explicit_base_url(cfg):
    p = OpenAICompatibleProvider(cfg)
    assert str(p.client.base_url).rstrip("/") == "https://example.com/v1"


@pytest.mark.asyncio
async def test_init_raises_when_base_url_missing():
    bad = LLMConfig(provider="custom", model="x", api_key="k", base_url=None)
    with pytest.raises(ValueError):
        OpenAICompatibleProvider(bad)


@pytest.mark.asyncio
async def test_supports_json_mode(cfg):
    assert OpenAICompatibleProvider(cfg).supports_json_mode() is True
