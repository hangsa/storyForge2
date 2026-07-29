from abc import ABC, abstractmethod
from dataclasses import dataclass
import time
from typing import AsyncIterator, Optional


@dataclass
class LLMResponse:
    text: str
    tokens_in: int
    tokens_out: int
    model: str
    provider: str
    finish_reason: str = "stop"


@dataclass
class StreamChunk:
    """A single text delta from an LLM stream.

    The LLM provider yields one StreamChunk per logical token update. The final
    chunk of a stream has finish_reason set to the provider-reported reason
    ("stop" / "length" / "end_turn" / ...); all earlier chunks have it as None.
    """
    text: str
    finish_reason: Optional[str] = None


@dataclass
class LLMConfig:
    provider: str
    model: str
    api_key: str
    base_url: Optional[str] = None
    max_tokens: int = 200000
    temperature: float = 0.7


@dataclass
class ProbeResult:
    """Result of probing a provider — connection check + model listing.

    `success=False` means the connection/api key check failed; `error` carries
    the raw exception message and `error_code` is a coarse bucket:
    - `auth_error`: 401/403 (bad api key, wrong scope)
    - `unreachable`: 404/connection refused/timeout (bad base_url, network)
    - `provider_error`: 5xx or any other upstream failure
    `models` is always populated when `success=True`; for `success=False` it
    is `None`.
    """
    success: bool
    latency_ms: int
    models: Optional[list[dict]] = None
    error: Optional[str] = None
    error_code: Optional[str] = None


class BaseLLMProvider(ABC):
    def __init__(self, config: LLMConfig):
        self.config = config
        self.api_key = config.api_key
        self.model = config.model
        self.base_url = config.base_url
        self.default_max_tokens = config.max_tokens
        self.default_temperature = config.temperature

    @abstractmethod
    async def generate(
        self, system_prompt: str, user_prompt: str, **kwargs
    ) -> LLMResponse:
        ...

    @abstractmethod
    def generate_stream(
        self, system_prompt: str, user_prompt: str, **kwargs
    ):
        """Yield StreamChunk deltas as the LLM produces them.

        Returns an async generator (call with `async for chunk in provider.generate_stream(...)`).
        Marked abstract so every concrete provider MUST implement it; ABC machinery
        raises TypeError on instantiation otherwise.

        Last yielded chunk MUST have finish_reason set to the provider's reported
        stop reason ("stop" / "length" / "end_turn" / None).
        """
        raise NotImplementedError

    @abstractmethod
    def supports_json_mode(self) -> bool:
        ...

    async def probe(self) -> ProbeResult:
        """Default probe = base class raises NotImplementedError.

        Each concrete provider implements probe() with its SDK-specific call.
        See AnthropicProvider.probe / OpenAICompatibleProvider.probe / etc.
        """
        raise NotImplementedError


def _normalize_openai_probe_error(start: float, e: Exception) -> ProbeResult:
    """Shared error normalization for OpenAI-compatible providers (deepseek,
    minimax, generic openai_compatible). Catches the OpenAI SDK exception
    hierarchy and maps to the ProbeResult error_code buckets.
    """
    from openai import (
        APIConnectionError,
        APIStatusError,
        APITimeoutError,
        AuthenticationError,
        NotFoundError,
        PermissionDeniedError,
    )

    latency_ms = int((time.monotonic() - start) * 1000)
    if isinstance(e, (AuthenticationError, PermissionDeniedError)):
        return ProbeResult(success=False, latency_ms=latency_ms, error=str(e), error_code="auth_error")
    if isinstance(e, (APIConnectionError, NotFoundError, APITimeoutError)):
        return ProbeResult(success=False, latency_ms=latency_ms, error=str(e), error_code="unreachable")
    if isinstance(e, APIStatusError):
        return ProbeResult(success=False, latency_ms=latency_ms, error=str(e), error_code="provider_error")
    return ProbeResult(success=False, latency_ms=latency_ms, error=f"{type(e).__name__}: {e}", error_code="provider_error")


def _normalize_anthropic_probe_error(start: float, e: Exception) -> ProbeResult:
    """Shared error normalization for Anthropic provider."""
    from anthropic import (
        APIConnectionError,
        APIStatusError,
        APITimeoutError,
        AuthenticationError,
        NotFoundError,
        PermissionDeniedError,
    )

    latency_ms = int((time.monotonic() - start) * 1000)
    if isinstance(e, (AuthenticationError, PermissionDeniedError)):
        return ProbeResult(success=False, latency_ms=latency_ms, error=str(e), error_code="auth_error")
    if isinstance(e, (APIConnectionError, NotFoundError, APITimeoutError)):
        return ProbeResult(success=False, latency_ms=latency_ms, error=str(e), error_code="unreachable")
    if isinstance(e, APIStatusError):
        return ProbeResult(success=False, latency_ms=latency_ms, error=str(e), error_code="provider_error")
    return ProbeResult(success=False, latency_ms=latency_ms, error=f"{type(e).__name__}: {e}", error_code="provider_error")
