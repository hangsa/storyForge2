from copy import deepcopy

import pytest

from backend.services.llm_config import LLMConfigError, validate


def base_v2():
    """Canonical v2 fixture."""
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
            "minimax": {
                "type": "openai_compatible",
                "display_name": "MiniMax",
                "base_url": "https://api.minimax.chat/v1",
                "api_key_env": "MINIMAX_API_KEY",
                "enabled": True,
                "models": {},
            },
        },
        "tiers": {
            "tier_1": {
                "description": "创意核心",
                "default": "deepseek-v4-pro",
                "fallback": "claude-opus-4",
                "retry_on_failure": True,
                "max_retries": 1,
            },
            "tier_0": {
                "description": "确定性",
                "default": "none",
                "fallback": None,
                "retry_on_failure": False,
                "max_retries": 0,
            },
        },
        "agent_mapping": {
            "writer": {
                "scene_writing": {"tier": "tier_1", "model": "deepseek-v4-pro"},
            }
        },
    }


def test_validate_accepts_v2_schema():
    validate(base_v2())


def test_validate_tier_without_models_key_passes():
    cfg = base_v2()
    # The whitelist is gone; tier_1 should validate without a `models` key.
    cfg["tiers"]["tier_1"].pop("models", None)
    cfg["tiers"]["tier_0"].pop("models", None)
    validate(cfg)  # must not raise


def test_validate_tier_with_stale_models_key_still_loads():
    cfg = base_v2()
    cfg["tiers"]["tier_1"]["models"] = ["ghost-model-not-in-providers"]
    # The whitelist is gone, so a leftover `models` list is silently ignored.
    validate(cfg)  # must not raise


def test_validate_rejects_unknown_model_in_tier_default():
    bad = deepcopy(base_v2())
    bad["tiers"]["tier_1"]["default"] = "ghost-model"
    with pytest.raises(LLMConfigError) as exc:
        validate(bad)
    assert any(p.endswith("tier_1.default") for p in exc.value.invalid_paths)


def test_validate_rejects_agent_mapping_unknown_model():
    bad = deepcopy(base_v2())
    bad["agent_mapping"]["writer"]["scene_writing"]["model"] = "ghost-model"
    with pytest.raises(LLMConfigError) as exc:
        validate(bad)
    assert any("scene_writing.model" in p for p in exc.value.invalid_paths)


def test_validate_rejects_duplicate_global_model_ids():
    bad = deepcopy(base_v2())
    bad["providers"]["anthropic"]["models"]["deepseek-v4-pro"] = {
        "display_name": "dup",
        "cost_per_1k_input": 0,
        "cost_per_1k_output": 0,
        "max_tokens": 1,
        "temperature": 0,
        "json_mode": False,
        "stream": True,
    }
    with pytest.raises(LLMConfigError) as exc:
        validate(bad)
    assert any("providers.anthropic.models" in p for p in exc.value.invalid_paths)


def test_validate_rejects_unknown_provider_type():
    bad = deepcopy(base_v2())
    bad["providers"]["anthropic"]["type"] = "made-up"
    with pytest.raises(LLMConfigError):
        validate(bad)


def test_validate_rejects_missing_api_key_env():
    bad = deepcopy(base_v2())
    del bad["providers"]["anthropic"]["api_key_env"]
    with pytest.raises(LLMConfigError):
        validate(bad)
