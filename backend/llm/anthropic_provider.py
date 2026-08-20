import json
import time
from typing import AsyncIterator
import httpx
from anthropic import AsyncAnthropic
from backend.llm.base_provider import (
    BaseLLMProvider,
    LLMConfig,
    LLMResponse,
    ProbeResult,
    StreamChunk,
    _normalize_anthropic_probe_error,
    make_no_proxy_async_client,
)


class AnthropicProvider(BaseLLMProvider):
    def __init__(self, config: LLMConfig):
        super().__init__(config)
        client_kwargs = {"api_key": self.api_key, "http_client": make_no_proxy_async_client()}
        if self.base_url:
            client_kwargs["base_url"] = self.base_url
        self.client = AsyncAnthropic(**client_kwargs)

    async def probe(self) -> ProbeResult:
        """Probe connection + try to list models.

        Connection check: send a 1-token messages.create — fast and exercises
        both auth and the chat endpoint. Model listing: best-effort GET on
        /v1/models; if it 404s (older API versions or endpoint-disabled keys)
        the probe still returns success=True with models=[].
        """
        start = time.monotonic()
        try:
            # Anthropic requires a real model id for messages.create; fall back
            # to claude-haiku-4-5 if the config didn't set one.
            model = self.model if self.model and self.model != "probe" else "claude-haiku-4-5"
            await self.client.messages.create(
                model=model,
                max_tokens=1,
                messages=[{"role": "user", "content": "ping"}],
            )
            latency_ms = int((time.monotonic() - start) * 1000)
            models = await self._list_models_via_http()
            return ProbeResult(success=True, latency_ms=latency_ms, models=models)
        except Exception as e:
            return _normalize_anthropic_probe_error(start, e)

    async def _list_models_via_http(self) -> list[dict]:
        """Best-effort GET /v1/models. Returns [] on any error."""
        try:
            base = str(self.client.base_url).rstrip("/")
            headers = {
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
            }
            async with httpx.AsyncClient(timeout=10, trust_env=False) as http:
                resp = await http.get(f"{base}/v1/models", headers=headers)
                if resp.status_code != 200:
                    return []
                data = resp.json()
                out = []
                for m in (data.get("data") or []):
                    mid = m.get("id")
                    if not mid:
                        continue
                    out.append({
                        "id": mid,
                        "display_name": m.get("display_name", mid),
                    })
                return out
        except Exception:
            return []

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
