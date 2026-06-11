from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional


@dataclass
class LLMResponse:
    text: str
    tokens_in: int
    tokens_out: int
    model: str
    provider: str
    finish_reason: str = "stop"


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
    def supports_json_mode(self) -> bool:
        ...
