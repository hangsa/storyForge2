from typing import AsyncIterator

from backend.llm.base_provider import BaseLLMProvider, LLMConfig, LLMResponse, StreamChunk


class MockProvider(BaseLLMProvider):
    """Returns a fixed string without any network call.

    Used by tests (and by an opt-in `type=mock` provider entry) to keep the
    LLM call path deterministic.
    """

    def __init__(self, config: LLMConfig, text: str = "(mock response)"):
        super().__init__(config)
        self._text = text

    async def generate(
        self, system_prompt: str, user_prompt: str, **kwargs
    ) -> LLMResponse:
        return LLMResponse(
            text=self._text,
            tokens_in=0,
            tokens_out=0,
            model=self.model,
            provider="mock",
            finish_reason="stop",
        )

    async def generate_stream(
        self, system_prompt: str, user_prompt: str, **kwargs
    ) -> AsyncIterator[StreamChunk]:
        yield StreamChunk(text=self._text)
        yield StreamChunk(text="", finish_reason="stop")

    def supports_json_mode(self) -> bool:
        return False
