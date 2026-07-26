# tests/test_llm_config_migrate.py
from pathlib import Path

import pytest
import yaml

from backend.services.llm_config import (
    LLMConfigError,
    migrate_legacy_yaml,
    validate,
)
from backend.services import llm_config as cfg_mod


LEGACY = {
    "tiers": {
        "tier_1": {
            "description": "x",
            "models": [
                {
                    "id": "deepseek-v4-pro",
                    "provider": "deepseek",
                    "cost_per_1k_input": 0.002,
                    "cost_per_1k_output": 0.008,
                    "max_tokens": 8192,
                },
                {
                    "id": "claude-opus-4",
                    "provider": "anthropic",
                    "cost_per_1k_input": 0.015,
                    "cost_per_1k_output": 0.075,
                    "max_tokens": 8192,
                },
            ],
            "default": "deepseek-v4-pro",
            "fallback": "claude-opus-4",
            "retry_on_failure": True,
            "max_retries": 1,
        },
        "tier_0": {
            "description": "deterministic",
            "models": [],
            "default": "none",
        },
    },
    "agent_mapping": {
        "writer": {
            "scene_writing": {"tier": "tier_1", "model": "deepseek-v4-pro", "fallback": "claude-opus-4"}
        }
    },
}


@pytest.fixture
def legacy_yaml(tmp_path):
    p = tmp_path / "model_tiers.yaml"
    p.write_text(yaml.safe_dump(LEGACY, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return p


def test_migrate_produces_providers_block(legacy_yaml):
    result = migrate_legacy_yaml(legacy_yaml)
    new_data = yaml.safe_load(legacy_yaml.read_text(encoding="utf-8"))
    assert "providers" in new_data
    assert {"deepseek", "anthropic"}.issubset(set(new_data["providers"].keys()))
    assert ".bak-" in result["backup_path"]
    validate(new_data)


def test_migrate_writes_env_keys(tmp_path, monkeypatch):
    # Stub settings so every provider in LEGACY has a non-empty API key. The
    # production env on a developer machine rarely configures all three
    # providers, but the migration should still write keys for every
    # provider whose credential is configured.
    from backend.config import Settings

    monkeypatch.setattr(
        cfg_mod,
        "settings",
        Settings(
            anthropic_api_key="sk-ant-stub",
            deepseek_api_key="sk-deepseek-stub",
            minimax_api_key="sk-minimax-stub",
        ),
    )
    monkeypatch.setattr(
        "backend.services.llm_config.write_env_atomic",
        lambda path, updates: path.write_text(
            "\n".join(f"{k}={v}" for k, v in updates.items()), encoding="utf-8"
        ),
    )
    legacy = tmp_path / "model_tiers.yaml"
    legacy.write_text(yaml.safe_dump(LEGACY), encoding="utf-8")
    env = tmp_path / ".env"
    result = migrate_legacy_yaml(legacy, env_path=env)
    text = env.read_text(encoding="utf-8")
    assert "STORYFORGE_PROVIDER_API_KEY_ANTHROPIC" in text
    assert "STORYFORGE_PROVIDER_API_KEY_DEEPSEEK" in text
    # Legacy alias keys are also written so pydantic-settings picks them up.
    assert "ANTHROPIC_API_KEY=" in text
    assert "DEEPSEEK_API_KEY=" in text


def test_migrate_resolves_model_id_collisions(tmp_path):
    yaml_content = {
        "tiers": {
            "tier_1": {
                "description": "",
                "models": [
                    {"id": "shared", "provider": "anthropic", "cost_per_1k_input": 0, "cost_per_1k_output": 0, "max_tokens": 1},
                    {"id": "shared", "provider": "deepseek", "cost_per_1k_input": 0, "cost_per_1k_output": 0, "max_tokens": 1},
                ],
                "default": "shared",
                "fallback": None,
                "retry_on_failure": True,
                "max_retries": 1,
            },
            "tier_0": {"description": "", "models": [], "default": "none"},
        },
        "agent_mapping": {
            "writer": {"scene_writing": {"tier": "tier_1", "model": "shared"}}
        },
    }
    p = tmp_path / "model_tiers.yaml"
    p.write_text(yaml.safe_dump(yaml_content), encoding="utf-8")
    migrate_legacy_yaml(p)
    new_data = yaml.safe_load(p.read_text(encoding="utf-8"))
    model_ids = {
        mid
        for prov in new_data["providers"].values()
        for mid in prov.get("models", {})
    }
    assert model_ids == {"anthropic/shared", "deepseek/shared"}
    assert new_data["tiers"]["tier_1"]["default"] in {"anthropic/shared", "deepseek/shared"}


def test_migrate_raises_when_already_v2(tmp_path):
    p = tmp_path / "model_tiers.yaml"
    p.write_text("providers: {}\n", encoding="utf-8")
    with pytest.raises(LLMConfigError):
        migrate_legacy_yaml(p)