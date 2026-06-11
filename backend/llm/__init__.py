from backend.config import settings
from backend.llm.base_provider import BaseLLMProvider, LLMResponse, LLMConfig
from backend.llm.anthropic_provider import AnthropicProvider
from backend.llm.deepseek_provider import DeepSeekProvider
from backend.llm.minimax_provider import MiniMaxProvider


def create_provider() -> BaseLLMProvider:
    provider_name = settings.llm_provider

    api_keys = {
        "anthropic": settings.anthropic_api_key,
        "deepseek": settings.deepseek_api_key,
        "minimax": settings.minimax_api_key,
    }

    base_urls = {
        "deepseek": settings.deepseek_base_url,
        "minimax": settings.minimax_base_url,
    }

    api_key = api_keys.get(provider_name, "")
    if not api_key:
        raise ValueError(
            f"API key for provider '{provider_name}' is not configured. "
            f"Set the appropriate environment variable."
        )

    config = LLMConfig(
        provider=provider_name,
        model=settings.llm_model,
        api_key=api_key,
        base_url=base_urls.get(provider_name),
        max_tokens=settings.llm_max_tokens,
        temperature=settings.llm_temperature,
    )

    providers = {
        "anthropic": AnthropicProvider,
        "deepseek": DeepSeekProvider,
        "minimax": MiniMaxProvider,
    }

    provider_class = providers.get(provider_name)
    if provider_class is None:
        raise ValueError(
            f"Unsupported LLM provider: '{provider_name}'. "
            f"Must be one of: {list(providers.keys())}"
        )

    return provider_class(config)


__all__ = [
    "BaseLLMProvider", "LLMResponse", "LLMConfig",
    "AnthropicProvider", "DeepSeekProvider", "MiniMaxProvider",
    "create_provider",
]
