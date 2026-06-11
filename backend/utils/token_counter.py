import tiktoken
from typing import Optional


def count_tokens(text: str, model: str = "gpt-4") -> int:
    """Estimate token count using tiktoken.
    Falls back to character-based approximation for non-OpenAI models.
    Prefer API response usage fields for billing accuracy.
    """
    try:
        enc = tiktoken.encoding_for_model(model)
        return len(enc.encode(text))
    except KeyError:
        enc = tiktoken.get_encoding("cl100k_base")
        return len(enc.encode(text))


def count_tokens_approx(text: str) -> int:
    """Character-based fallback: ~2 chars per token for CJK text."""
    return len(text) // 2


def estimate_cost(
    tokens_in: int, tokens_out: int, provider: str, model: str
) -> Optional[float]:
    """Estimate USD cost based on provider pricing (approximate)."""
    rates = {
        "deepseek": {"deepseek-chat": (0.14, 0.28)},       # per 1M tokens
        "anthropic": {"claude-sonnet-4-20250514": (3.0, 15.0)},
        "minimax": {"abab6.5s-chat": (1.0, 2.0)},
    }
    provider_rates = rates.get(provider, {})
    model_rates = provider_rates.get(model, (0, 0))
    cost = (tokens_in * model_rates[0] + tokens_out * model_rates[1]) / 1_000_000
    return round(cost, 6)
