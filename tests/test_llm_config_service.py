import shutil
from pathlib import Path

import pytest

from backend.services.llm_config import read_yaml, write_yaml_atomic

REAL_CONFIG = Path("config/model_tiers.yaml")


@pytest.fixture
def isolated_config(tmp_path, monkeypatch):
    """Point CONFIG_PATH at a tmp copy of the real file."""
    target = tmp_path / "model_tiers.yaml"
    shutil.copy(REAL_CONFIG, target)
    import backend.services.llm_config as mod
    monkeypatch.setattr(mod, "CONFIG_PATH", target)
    return target


def _v2_base():
    """Inline v2 fixture scoped to the tests in this file (pytest does not
    expose tests/ as a package so we can't import from test_llm_config_providers)."""
    return {
        "providers": {
            "anthropic": {
                "type": "anthropic",
                "display_name": "Anthropic",
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


@pytest.fixture
def isolated_v2_config(tmp_path, monkeypatch):
    """Point CONFIG_PATH at a tmp v2-shaped YAML file."""
    import yaml as yaml_mod
    target = tmp_path / "model_tiers.yaml"
    target.write_text(yaml_mod.safe_dump(_v2_base(), allow_unicode=True, sort_keys=False), encoding="utf-8")
    import backend.services.llm_config as mod
    monkeypatch.setattr(mod, "CONFIG_PATH", target)
    return target


def test_read_yaml_returns_parseable_dict(isolated_config):
    data = read_yaml()
    assert isinstance(data, dict)
    assert "tiers" in data
    assert "agent_mapping" in data
    assert "tier_1" in data["tiers"]


def test_write_yaml_atomic_creates_equivalent_file(isolated_config):
    import yaml as yaml_mod
    from backend.services.llm_config import read_yaml, write_yaml_atomic
    original = read_yaml()
    write_yaml_atomic(original)
    written = yaml_mod.safe_load(isolated_config.read_text(encoding="utf-8"))
    assert written == original


def test_write_yaml_atomic_cleans_tmp_on_failure(isolated_config, monkeypatch):
    from backend.services.llm_config import write_yaml_atomic
    monkeypatch.setattr("yaml.safe_dump", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("boom")))
    data = read_yaml()
    with pytest.raises(RuntimeError):
        write_yaml_atomic(data)
    leftover = [p.name for p in isolated_config.parent.glob(".model_tiers.*.tmp")]
    assert leftover == []


def test_validate_happy_path_against_v2_config():
    from backend.services.llm_config import validate
    validate(_v2_base())  # must not raise


def test_validate_rejects_unknown_default():
    from backend.services.llm_config import LLMConfigError, validate
    bad = _v2_base()
    bad["tiers"]["tier_1"]["default"] = "ghost-model"
    with pytest.raises(LLMConfigError) as exc:
        validate(bad)
    assert any(p.endswith("tier_1.default") for p in exc.value.invalid_paths)


def test_validate_rejects_empty_agent_mapping_entry():
    from backend.services.llm_config import LLMConfigError, validate
    bad = _v2_base()
    bad["agent_mapping"]["writer"]["" ] = {"tier": "tier_1"}
    with pytest.raises(LLMConfigError) as exc:
        validate(bad)
    assert any(p == "agent_mapping.writer.<empty>" for p in exc.value.invalid_paths)


def test_validate_rejects_missing_tier0():
    from backend.services.llm_config import LLMConfigError, validate
    bad = _v2_base()
    bad["tiers"].pop("tier_0")
    with pytest.raises(LLMConfigError) as exc:
        validate(bad)
    assert "tier_0" in exc.value.invalid_paths


def test_validate_rejects_agent_mapping_to_unknown_tier():
    from backend.services.llm_config import LLMConfigError, validate
    bad = _v2_base()
    bad["agent_mapping"]["writer"]["scene_writing"]["tier"] = "tier_9"
    with pytest.raises(LLMConfigError) as exc:
        validate(bad)
    assert any("scene_writing.tier" in p for p in exc.value.invalid_paths)


def test_validate_rejects_max_tokens_bool():
    from backend.services.llm_config import LLMConfigError, validate
    bad = _v2_base()
    # set a provider model's max_tokens to True (passes naive isinstance(int))
    bad["providers"]["anthropic"]["models"]["claude-opus-4"]["max_tokens"] = True
    with pytest.raises(LLMConfigError) as exc:
        validate(bad)
    assert any("max_tokens" in p for p in exc.value.invalid_paths)


def test_validate_reports_duplicate_model_ids_with_id():
    from backend.services.llm_config import LLMConfigError, validate
    bad = _v2_base()
    # define a cross-provider duplicate model id (v2 deduplicates globally)
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
    paths = exc.value.invalid_paths
    assert any("providers." in p and ".models" in p for p in paths)


def test_reload_router_swaps_in_disk(monkeypatch, isolated_v2_config):
    from backend.services import llm_config as mod
    from backend.services.llm_config import reload_router

    class StubRouter:
        def __init__(self):
            self._tiers = {"tier_1": object()}
            self._mappings = {"writer": {"scene_writing": object()}}

        def reload_config(self):
            # sentinel: do not actually re-read the disk; tests below cover disk behavior.
            return None

    monkeypatch.setattr(mod, "get_model_router", lambda: StubRouter())
    summary = reload_router()
    assert summary == {"tiers": 1, "agents": 1}


V2_FIXTURE_FOR_STATUS = {
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
            "models": {},
        },
    },
    "tiers": {"tier_0": {"description": "", "default": "none", "fallback": None}},
    "agent_mapping": {},
}


def test_provider_status_reads_providers_block(monkeypatch, tmp_path):
    import yaml as yaml_mod
    from backend.services import llm_config as mod
    from backend.services.llm_config import provider_status

    target = tmp_path / "model_tiers.yaml"
    target.write_text(
        yaml_mod.safe_dump(V2_FIXTURE_FOR_STATUS, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )
    monkeypatch.setattr(mod, "CONFIG_PATH", target)

    monkeypatch.setattr(mod.settings, "anthropic_api_key", "sk-test", raising=False)
    monkeypatch.setattr(mod.settings, "deepseek_api_key", "", raising=False)
    monkeypatch.setattr(
        mod.settings, "deepseek_base_url", "https://api.deepseek.com/v1", raising=False
    )

    out = provider_status()
    by_name = {row["provider"]: row for row in out}
    assert by_name["anthropic"]["api_key_configured"] is True
    assert by_name["anthropic"]["type"] == "anthropic"
    assert by_name["deepseek"]["api_key_configured"] is False
    assert by_name["deepseek"]["base_url"] == "https://api.deepseek.com/v1"
    assert by_name["deepseek"]["type"] == "openai_compatible"
    assert "claude-opus-4" in {m["id"] for m in by_name["anthropic"]["models"]}


def test_provider_status_recognizes_prefix_env_var(monkeypatch, tmp_path):
    """Custom (non-builtin) provider whose key is only set via the new
    `STORYFORGE_PROVIDER_API_KEY_<ID>` prefix env var — provider_status must
    report api_key_configured=True without relying on Settings or the legacy
    declared api_key_env.
    """
    import yaml as yaml_mod
    from backend.services import llm_config as mod
    from backend.services.llm_config import provider_status

    data = {
        "providers": {
            "testopenai": {
                "type": "openai_compatible",
                "display_name": "TestOpenAI",
                "base_url": "https://api.testopenai.com/v1",
                "api_key_env": "TESTOPENAI_API_KEY",
                "enabled": True,
                "models": {},
            },
        },
        "tiers": {"tier_0": {"description": "", "default": "none", "fallback": None, "models": []}},
        "agent_mapping": {},
    }
    target = tmp_path / "model_tiers.yaml"
    target.write_text(yaml_mod.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")
    monkeypatch.setattr(mod, "CONFIG_PATH", target)

    monkeypatch.setenv("STORYFORGE_PROVIDER_API_KEY_TESTOPENAI", "sk-prefix-key")
    monkeypatch.delenv("TESTOPENAI_API_KEY", raising=False)

    out = provider_status()
    by_name = {row["provider"]: row for row in out}
    assert by_name["testopenai"]["api_key_configured"] is True
