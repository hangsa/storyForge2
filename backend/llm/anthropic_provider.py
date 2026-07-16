import json
from typing import AsyncIterator
from anthropic import AsyncAnthropic
from backend.llm.base_provider import BaseLLMProvider, LLMResponse, LLMConfig, StreamChunk


class AnthropicProvider(BaseLLMProvider):
    def __init__(self, config: LLMConfig):
        super().__init__(config)
        self.client = AsyncAnthropic(api_key=self.api_key)

    async def generate(
        self, system_prompt: str, user_prompt: str, **kwargs
    ) -> LLMResponse:
        max_tokens = kwargs.get("max_tokens", self.default_max_tokens)
        temperature = kwargs.get("temperature", self.default_temperature)

        messages = [{"role": "user", "content": user_prompt}]

        if kwargs.get("json_mode"):
            messages.append({
                "role": "assistant",
                "content": "{",
            })

        response = await self.client.messages.create(
            model=self.model,
            system=system_prompt,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )

        text = response.content[0].text
        if kwargs.get("json_mode") and not text.startswith("{"):
            text = "{" + text

        return LLMResponse(
            text=text,
            tokens_in=response.usage.input_tokens,
            tokens_out=response.usage.output_tokens,
            model=self.model,
            provider="anthropic",
            finish_reason=response.stop_reason or "stop",
        )

    async def generate_stream(
        self, system_prompt: str, user_prompt: str, **kwargs
    ) -> AsyncIterator[StreamChunk]:
        """Yield text deltas from the Anthropic SDK's messages.stream().

        The SDK returns an async context manager; inside the `async with` block,
        `text_stream` is an async iterable of delta text strings, and
        `get_final_message()` resolves to the completed Message with stop_reason.

        We yield every delta as a StreamChunk (finish_reason=None), then yield one
        final empty StreamChunk carrying the SDK's stop_reason (defaulting to
        "stop" if missing, matching the existing generate() behavior).
        """
        max_tokens = kwargs.get("max_tokens", self.default_max_tokens)
        temperature = kwargs.get("temperature", self.default_temperature)

        messages = [{"role": "user", "content": user_prompt}]

        async with self.client.messages.stream(
            model=self.model,
            system=system_prompt,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        ) as stream:
            async for text in stream.text_stream:
                yield StreamChunk(text=text)
            final_message = await stream.get_final_message()
            yield StreamChunk(
                text="",
                finish_reason=final_message.stop_reason or "stop",
            )

    def supports_json_mode(self) -> bool:
        return True
