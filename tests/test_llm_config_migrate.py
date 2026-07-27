# tests/test_llm_config_migrate.py
from pathlib import Path

import pytest
import yaml

from backend.services.llm_config import (
    LLMConfigError,
    _ensure_builtin_providers,
    migrate_legacy_yaml,
    seed_builtin_providers,
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
    assert model_ids == {"anthropic__shared", "deepseek__shared"}
    assert new_data["tiers"]["tier_1"]["default"] in {"anthropic__shared", "deepseek__shared"}


def test_migrate_raises_when_already_v2(tmp_path):
    p = tmp_path / "model_tiers.yaml"
    p.write_text("providers: {}\n", encoding="utf-8")
    with pytest.raises(LLMConfigError):
        migrate_legacy_yaml(p)


def test_migrate_seeds_unreferenced_builtins(tmp_path, monkeypatch):
    # Legacy YAML references only anthropic models but the user's .env has
    # minimax/deepseek keys configured — migration must seed those builtins
    # anyway so .env-side configuration isn't silently dropped.
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
        lambda path, updates: None,
    )
    legacy = {
        "tiers": {
            "tier_1": {
                "description": "x",
                "models": [
                    {
                        "id": "claude-opus-4",
                        "provider": "anthropic",
                        "cost_per_1k_input": 0.015,
                        "cost_per_1k_output": 0.075,
                        "max_tokens": 8192,
                    },
                ],
                "default": "claude-opus-4",
                "fallback": None,
                "retry_on_failure": True,
                "max_retries": 1,
            },
            "tier_0": {"description": "", "models": [], "default": "none"},
        },
        "agent_mapping": {
            "writer": {"scene_writing": {"tier": "tier_1", "model": "claude-opus-4"}}
        },
    }
    p = tmp_path / "model_tiers.yaml"
    p.write_text(yaml.safe_dump(legacy, allow_unicode=True, sort_keys=False), encoding="utf-8")
    migrate_legacy_yaml(p)
    new_data = yaml.safe_load(p.read_text(encoding="utf-8"))
    pids = set(new_data["providers"].keys())
    assert {"anthropic", "deepseek", "minimax"} <= pids
    # Unreferenced builtins have empty models — user fills them via AI Console.
    assert new_data["providers"]["deepseek"]["models"] == {}
    assert new_data["providers"]["minimax"]["models"] == {}
    validate(new_data)


def test_ensure_builtin_providers_is_idempotent():
    providers = {
        "anthropic": {"type": "anthropic", "display_name": "Anthropic", "models": {"x": {}}},
        "deepseek": {"type": "openai_compatible", "display_name": "DeepSeek", "models": {}},
    }
    before = yaml.safe_dump(providers, sort_keys=True)
    added = _ensure_builtin_providers(providers)
    assert added == ["minimax"]
    # idempotent: running again does nothing
    added_again = _ensure_builtin_providers(providers)
    assert added_again == []
    # anthropic entry was NOT mutated
    assert providers["anthropic"]["models"] == {"x": {}}


def test_ensure_builtin_providers_skips_when_env_key_missing(tmp_path):
    """Builtins without a non-empty API key in `.env` must NOT be seeded."""
    from backend.services.llm_config import _ensure_builtin_providers

    providers: dict = {}
    env_path = tmp_path / ".env"
    # Only deepseek has a real key; anthropic + minimax have empty/missing.
    env_path.write_text(
        "DEEPSEEK_API_KEY=sk-ds-test\n"
        "ANTHROPIC_API_KEY=\n",
        encoding="utf-8",
    )
    added = _ensure_builtin_providers(providers, env_path=env_path)
    assert added == ["deepseek"]
    assert set(providers.keys()) == {"deepseek"}


def test_env_has_api_key_returns_false_for_missing_file(tmp_path):
    from backend.services.llm_config import _env_has_api_key

    missing = tmp_path / "does-not-exist.env"
    assert _env_has_api_key(missing, "DEEPSEEK_API_KEY") is False


def test_seed_builtin_providers_adds_missing(tmp_path, monkeypatch):
    from backend.config import Settings

    monkeypatch.setattr(cfg_mod, "settings", Settings(minimax_api_key="sk-minimax-stub"))
    monkeypatch.setattr(
        "backend.services.llm_config.write_env_atomic",
        lambda path, updates: None,
    )
    p = tmp_path / "model_tiers.yaml"
    p.write_text(
        yaml.safe_dump(
            {
                "providers": {
                    "anthropic": {
                        "type": "anthropic",
                        "display_name": "Anthropic",
                        "base_url": "",
                        "api_key_env": "ANTHROPIC_API_KEY",
                        "enabled": True,
                        "models": {},
                    },
                },
                "tiers": {"tier_0": {"description": "", "models": [], "default": "none"}},
                "agent_mapping": {},
            },
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    # Provide an env file with non-empty keys for deepseek + minimax so the
    # builtin-seeder considers them activated. Anthropic intentionally has
    # only an empty key — it should NOT be re-seeded (it's already present
    # in the YAML, but the env check still gates *new* seedings).
    env_path = tmp_path / ".env"
    env_path.write_text(
        "DEEPSEEK_API_KEY=sk-ds-test\n"
        "MINIMAX_API_KEY=sk-mm-test\n"
        "ANTHROPIC_API_KEY=\n",
        encoding="utf-8",
    )
    result = seed_builtin_providers(p, env_path=env_path)
    assert sorted(result["added"]) == ["deepseek", "minimax"]
    new_data = yaml.safe_load(p.read_text(encoding="utf-8"))
    assert {"anthropic", "deepseek", "minimax"} <= set(new_data["providers"].keys())
    validate(new_data)


def test_seed_builtin_providers_idempotent(tmp_path, monkeypatch):
    from backend.config import Settings

    monkeypatch.setattr(cfg_mod, "settings", Settings(anthropic_api_key="x"))
    monkeypatch.setattr(
        "backend.services.llm_config.write_env_atomic",
        lambda path, updates: None,
    )
    # Already-full builtin set.
    full = {
        pid: {
            "type": "anthropic" if pid == "anthropic" else "openai_compatible",
            "display_name": pid,
            "base_url": f"https://{pid}.example/v1",
            "api_key_env": f"{pid.upper()}_API_KEY",
            "enabled": True,
            "models": {},
        }
        for pid in ("anthropic", "deepseek", "minimax")
    }
    p = tmp_path / "model_tiers.yaml"
    p.write_text(
        yaml.safe_dump(
            {
                "providers": full,
                "tiers": {"tier_0": {"description": "", "default": "none", "fallback": None}},
                "agent_mapping": {},
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    before = p.read_text(encoding="utf-8")
    env_path = tmp_path / ".env"
    env_path.write_text(
        "ANTHROPIC_API_KEY=sk-ant-test\n"
        "DEEPSEEK_API_KEY=sk-ds-test\n"
        "MINIMAX_API_KEY=sk-mm-test\n",
        encoding="utf-8",
    )
    result = seed_builtin_providers(p, env_path=env_path)
    assert result["added"] == []
    # No-write idempotent
    assert p.read_text(encoding="utf-8") == before