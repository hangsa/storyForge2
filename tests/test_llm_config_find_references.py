from copy import deepcopy

import pytest

from backend.services.llm_config import (
    LLMConfigError,
    find_references,
    validate_removal,
)


def _base():
    return {
        "providers": {
            "anthropic": {
                "type": "anthropic",
                "display_name": "Anthropic",
                "base_url": "https://api.anthropic.com",
                "api_key_env": "ANTHROPIC_API_KEY",
                "enabled": True,
                "models": {
                    "claude-opus-4": {
                        "display_name": "Claude Opus 4",
                        "cost_per_1k_input": 0.015,
                        "cost_per_1k_output": 0.075,
                        "max_tokens": 8192,
                        "temperature": 0.7,
                        "json_mode": False,
                        "stream": True,
                    }
                },
            },
            "deepseek": {
                "type": "openai_compatible",
                "display_name": "DeepSeek",
                "base_url": "https://api.deepseek.com/v1",
                "api_key_env": "DEEPSEEK_API_KEY",
                "enabled": True,
                "models": {
                    "deepseek-v4-pro": {
                        "display_name": "DeepSeek V4 Pro",
                        "cost_per_1k_input": 0.002,
                        "cost_per_1k_output": 0.008,
                        "max_tokens": 8192,
                        "temperature": 0.7,
                        "json_mode": True,
                        "stream": True,
                    }
                },
            },
        },
        "tiers": {
            "tier_1": {
                "description": "",
                "default": "deepseek-v4-pro",
                "fallback": "claude-opus-4",
                "models": ["deepseek-v4-pro", "claude-opus-4"],
                "retry_on_failure": True,
                "max_retries": 1,
            },
            "tier_0": {"description": "", "default": "none", "fallback": None, "models": []},
        },
        "agent_mapping": {
            "writer": {"scene_writing": {"tier": "tier_1", "model": "deepseek-v4-pro"}}
        },
    }


def test_find_references_model_used_by_tier_default():
    cfg = _base()
    refs = find_references(cfg, "model:deepseek-v4-pro")
    assert "tiers.tier_1.default" in refs
    assert "tiers.tier_1.fallback" not in refs


def test_find_references_model_used_by_tier_whitelist():
    cfg = _base()
    refs = find_references(cfg, "model:claude-opus-4")
    assert "tiers.tier_1.fallback" in refs


def test_find_references_provider_with_models_used():
    cfg = _base()
    refs = find_references(cfg, "provider:anthropic")
    assert any(r == "tiers.tier_1.fallback" for r in refs)


def test_find_references_unused_returns_empty():
    cfg = _base()
    refs = find_references(cfg, "model:does-not-exist")
    assert refs == []


def test_validate_removal_blocks_model_in_use():
    cfg = _base()
    with pytest.raises(LLMConfigError) as exc:
        validate_removal(cfg, "model:deepseek-v4-pro")
    assert any("tier_1" in p for p in exc.value.invalid_paths)


def test_validate_removal_allows_unused_model():
    cfg = deepcopy(_base())
    cfg["providers"]["anthropic"]["models"]["unused-model"] = {
        "display_name": "x",
        "cost_per_1k_input": 0,
        "cost_per_1k_output": 0,
        "max_tokens": 1,
        "temperature": 0,
        "json_mode": False,
        "stream": True,
    }
    validate_removal(cfg, "model:unused-model")  # should not raise
