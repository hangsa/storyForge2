import time
from typing import AsyncIterator

from openai import AsyncOpenAI
from backend.llm.base_provider import (
    BaseLLMProvider,
    LLMConfig,
    LLMResponse,
    ProbeResult,
    StreamChunk,
    _normalize_openai_probe_error,
)


class OpenAICompatibleProvider(BaseLLMProvider):
    """Generic OpenAI-compatible provider.

    Used when a `providers.*` entry has `type=openai_compatible` and an explicit
    `base_url`. No fallback default URL — the operator MUST configure one.
    """

    def __init__(self, config: LLMConfig):
        if not config.base_url:
            raise ValueError(
                "OpenAICompatibleProvider requires a non-empty base_url"
            )
        super().__init__(config)
        self.client = AsyncOpenAI(api_key=self.api_key, base_url=config.base_url)

    async def probe(self) -> ProbeResult:
        """Probe via client.models.list() — doubles as connection check and
        model listing for any OpenAI-compatible endpoint that exposes /models.
        """
        start = time.monotonic()
        try:
            page = await self.client.models.list()
            models_raw = list(getattr(page, "data", []) or [])
            latency_ms = int((time.monotonic() - start) * 1000)
            models = []
            for m in models_raw:
                mid = getattr(m, "id", None) or (m.get("id") if isinstance(m, dict) else None)
                if not mid:
                    continue
                display = getattr(m, "display_name", None) or mid
                if not isinstance(display, str):
                    display = mid
                models.append({"id": mid, "display_name": display})
            return ProbeResult(success=True, latency_ms=latency_ms, models=models)
        except Exception as e:
            return _normalize_openai_probe_error(start, e)

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
            provider="openai_compatible",
            finish_reason=choice.finish_reason or "stop",
        )

    async def generate_stream(
        self, system_prompt: str, user_prompt: str, **kwargs
    ) -> AsyncIterator[StreamChunk]:
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

    def supports_json_mode(self) -> bool:
        return True
