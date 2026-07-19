from abc import ABC, abstractmethod
from dataclasses import dataclass
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
    max_tokens: int = 8192
    temperature: float = 0.7


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
