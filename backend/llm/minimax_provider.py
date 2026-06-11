from openai import AsyncOpenAI
from backend.llm.base_provider import BaseLLMProvider, LLMResponse, LLMConfig


class MiniMaxProvider(BaseLLMProvider):
    def __init__(self, config: LLMConfig):
        super().__init__(config)
        self.client = AsyncOpenAI(
            api_key=self.api_key,
            base_url=config.base_url or "https://api.minimax.chat/v1",
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
            provider="minimax",
            finish_reason=choice.finish_reason or "stop",
        )

    def supports_json_mode(self) -> bool:
        return True
