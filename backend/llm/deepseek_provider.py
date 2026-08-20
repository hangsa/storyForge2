from typing import AsyncIterator

from openai import AsyncOpenAI
from backend.llm.base_provider import BaseLLMProvider, LLMResponse, LLMConfig, StreamChunk, make_no_proxy_async_client


class DeepSeekProvider(BaseLLMProvider):
    def __init__(self, config: LLMConfig):
        super().__init__(config)
        self.client = AsyncOpenAI(
            api_key=self.api_key,
            base_url=config.base_url or "https://api.deepseek.com/v1",
            http_client=make_no_proxy_async_client(),
        )

    async def generate(
        self, system_prompt: str, user_prompt: str, **kwargs
    ) -> LLMResponse:
        max_tokens = kwargs.get("max_tokens", self.default_max_tokens)
        temperature = kwargs.get("temperature", self.default_temperature)

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        extra = {}
        if kwargs.get("json_mode"):
            extra["response_format"] = {"type": "json_object"}

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            **extra,
        )

        choice = response.choices[0]

        return LLMResponse(
            text=choice.message.content or "",
            tokens_in=response.usage.prompt_tokens if response.usage else 0,
            tokens_out=response.usage.completion_tokens if response.usage else 0,
            model=self.model,
            provider="deepseek",
            finish_reason=choice.finish_reason or "stop",
        )

    def supports_json_mode(self) -> bool:
        return True

    async def generate_stream(
        self, system_prompt: str, user_prompt: str, **kwargs
    ) -> AsyncIterator[StreamChunk]:
        """Yield text deltas from the OpenAI SDK's chat.completions.create(stream=True).

        Each streamed ChatCompletionChunk has delta.content (may be None for role-only
        or interim chunks — skip those) and finish_reason. Stop iterating after the
        first non-None finish_reason so the SDK's occasional post-finish chunks don't
        reach the consumer.

        json_mode is intentionally NOT threaded through: streaming + JSON is a
        separate AC (the partial-JSON case can't be validated). The non-streaming
        generate() supports json_mode.
        """
        max_tokens = kwargs.get("max_tokens", self.default_max_tokens)
        temperature = kwargs.get("temperature", self.default_temperature)

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        stream = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            stream=True,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content or ""
            if delta:
                yield StreamChunk(text=delta)
            if chunk.choices[0].finish_reason:
                yield StreamChunk(text="", finish_reason=chunk.choices[0].finish_reason)
                return
