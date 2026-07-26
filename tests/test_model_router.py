"""Unit tests for ModelRouter — tier resolution, fallback chain, config reload, execution."""

import asyncio
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import yaml

from backend.llm.model_router import (
    ModelRouter,
    get_model_router,
    reset_model_router,
    ModelUnavailableError,
)


# ── Providers catalog tests (Task 10) ─────────────────────────────────

@pytest.fixture
def cfg_path(tmp_path):
    data = {
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
            "mockprov": {
                "type": "mock",
                "display_name": "Mock",
                "base_url": "",
                "api_key_env": "",
                "enabled": True,
                "models": {
                    "mock-m": {
                        "display_name": "Mock M",
                        "cost_per_1k_input": 0,
                        "cost_per_1k_output": 0,
                        "max_tokens": 8,
                        "temperature": 0,
                        "json_mode": False,
                        "stream": True,
                    }
                },
            },
        },
        "tiers": {
            "tier_1": {
                "description": "",
                "default": "claude-opus-4",
                "fallback": None,
                "models": ["claude-opus-4"],
                "retry_on_failure": True,
                "max_retries": 0,
            },
            "tier_0": {"description": "", "default": "none", "fallback": None, "models": []},
        },
        "agent_mapping": {
            "writer": {"scene_writing": {"tier": "tier_1", "model": "claude-opus-4"}}
        },
    }
    p = tmp_path / "model_tiers.yaml"
    p.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")
    reset_model_router()
    return p


def test_router_loads_providers_block(cfg_path):
    router = ModelRouter(cfg_path)
    assert "anthropic" in router._providers
    assert "mockprov" in router._providers
    assert "claude-opus-4" in router._providers["anthropic"].models


def test_router_resolves_anthropic_provider(cfg_path, monkeypatch):
    router = ModelRouter(cfg_path)
    info = router._find_model_info("claude-opus-4")
    assert info["provider"] == "anthropic"
    assert info["max_tokens"] == 8192


def test_router_dispatches_to_mock_provider(cfg_path):
    from backend.llm.mock_provider import MockProvider
    router = ModelRouter(cfg_path)
    info = router._find_model_info("mock-m")
    provider = router._create_provider_for_model(info)
    assert isinstance(provider, MockProvider)


def test_router_resolve_unknown_model_raises(cfg_path):
    from backend.llm.errors import ModelNotFoundError
    router = ModelRouter(cfg_path)
    with pytest.raises(ModelNotFoundError):
        router._find_model_info_or_raise("does-not-exist")


@pytest.fixture(autouse=True)
def _reset_singleton():
    reset_model_router()
    yield
    reset_model_router()


@pytest.fixture
def temp_config():
    """Create a minimal model_tiers.yaml in a temp dir."""
    with tempfile.TemporaryDirectory() as tmp:
        config_path = Path(tmp) / "model_tiers.yaml"
        config_data = {
            "providers": {
                "anthropic": {
                    "type": "anthropic",
                    "display_name": "Anthropic",
                    "base_url": "https://api.anthropic.com",
                    "api_key_env": "ANTHROPIC_API_KEY",
                    "enabled": True,
                    "models": {
                        "claude-haiku": {"display_name": "Claude Haiku", "cost_per_1k_input": 0.001, "cost_per_1k_output": 0.005, "max_tokens": 4096},
                        "claude-sonnet": {"display_name": "Claude Sonnet", "cost_per_1k_input": 0.003, "cost_per_1k_output": 0.015, "max_tokens": 4096},
                    },
                },
                "deepseek": {
                    "type": "openai_compatible",
                    "display_name": "DeepSeek",
                    "base_url": "https://api.deepseek.com/v1",
                    "api_key_env": "DEEPSEEK_API_KEY",
                    "enabled": True,
                    "models": {
                        "deepseek-chat": {"display_name": "DeepSeek Chat", "cost_per_1k_input": 0.001, "cost_per_1k_output": 0.002, "max_tokens": 8192},
                    },
                },
            },
            "tiers": {
                "tier_1": {
                    "default": "deepseek-chat",
                    "fallback": "claude-haiku",
                    "max_retries": 2,
                    "max_tokens": 8192,
                    "retry_on_failure": True,
                    "models": [
                        {"id": "deepseek-chat", "provider": "deepseek", "cost_per_1k_input": 0.001, "cost_per_1k_output": 0.002, "max_tokens": 8192},
                        {"id": "claude-haiku", "provider": "anthropic", "cost_per_1k_input": 0.001, "cost_per_1k_output": 0.005, "max_tokens": 4096},
                    ],
                },
                "tier_2": {
                    "default": "claude-sonnet",
                    "fallback": None,
                    "max_retries": 1,
                    "max_tokens": 4096,
                    "retry_on_failure": True,
                    "models": [
                        {"id": "claude-sonnet", "provider": "anthropic", "cost_per_1k_input": 0.003, "cost_per_1k_output": 0.015, "max_tokens": 4096},
                    ],
                },
                "tier_3": {
                    "default": "claude-haiku",
                    "fallback": None,
                    "max_retries": 1,
                    "max_tokens": 2048,
                    "retry_on_failure": False,
                    "models": [
                        {"id": "claude-haiku", "provider": "anthropic", "cost_per_1k_input": 0.001, "cost_per_1k_output": 0.005, "max_tokens": 2048},
                    ],
                },
                "tier_0": {
                    "default": "none",
                    "fallback": None,
                    "max_retries": 0,
                    "max_tokens": 0,
                    "retry_on_failure": False,
                    "models": [],
                },
            },
            "agent_mapping": {
                "planner": {"chapter_outline": {"tier": "tier_1"}, "scene_planning": {"tier": "tier_1"}},
                "reviewer": {"narrative_guard": {"tier": "tier_2"}, "fact_guard": {"tier": "tier_0"}},
                "summary_archiver": {"chapter_summary": {"tier": "tier_3"}},
            },
        }
        with open(config_path, "w", encoding="utf-8") as f:
            yaml.safe_dump(config_data, f)
        yield config_path


# ── Helpers ───────────────────────────────────────────────────────────

def _make_response(text="response", tokens_in=100, tokens_out=50):
    resp = MagicMock()
    resp.text = text
    resp.tokens_in = tokens_in
    resp.tokens_out = tokens_out
    return resp


def _mock_provider(text="response", tokens_in=100, tokens_out=50):
    provider = MagicMock()
    provider.generate = AsyncMock(return_value=_make_response(text, tokens_in, tokens_out))
    return provider


async def _async_ok(text="ok"):
    return _make_response(text)


async def _async_fail():
    raise Exception("fail")


# ── Tests ─────────────────────────────────────────────────────────────


class TestConfigLoading:
    def test_loads_from_yaml(self, temp_config):
        router = ModelRouter(temp_config)
        assert len(router._tiers) == 4

    def test_falls_back_to_builtin_when_no_file(self):
        # Use a path that exists but has no YAML file
        with tempfile.TemporaryDirectory() as tmp:
            router = ModelRouter(Path(tmp) / "missing_config.yaml")
            assert len(router._tiers) == 4


def test_router_load_triggers_legacy_migrate(tmp_path, monkeypatch):
    legacy_data = {
        "tiers": {
            "tier_1": {
                "description": "",
                "models": [
                    {"id": "claude-opus-4", "provider": "anthropic", "cost_per_1k_input": 0.015, "cost_per_1k_output": 0.075, "max_tokens": 8192}
                ],
                "default": "claude-opus-4",
                "fallback": None,
                "retry_on_failure": True,
                "max_retries": 1,
            },
            "tier_0": {"description": "", "models": [], "default": "none"},
        },
        "agent_mapping": {},
    }
    p = tmp_path / "model_tiers.yaml"
    p.write_text(yaml.safe_dump(legacy_data, allow_unicode=True, sort_keys=False), encoding="utf-8")
    reset_model_router()
    router = ModelRouter(p)
    # After migration, providers block should exist on disk
    reloaded = yaml.safe_load(p.read_text(encoding="utf-8"))
    assert "providers" in reloaded
    assert "anthropic" in reloaded["providers"]


class TestResolve:
    def test_resolves_tier_1_model(self, temp_config):
        router = ModelRouter(temp_config)
        decision = router.resolve("planner", "chapter_outline")
        assert decision.tier_name == "tier_1"
        assert decision.model_id == "deepseek-chat"
        assert decision.provider_name == "deepseek"

    def test_respects_force_model(self, temp_config):
        router = ModelRouter(temp_config)
        # Force model must exist in the tier's models
        decision = router.resolve("planner", "chapter_outline", force_model="claude-haiku")
        assert decision.model_id == "claude-haiku"
        assert decision.provider_name == "anthropic"

    def test_raises_for_unknown_agent(self, temp_config):
        router = ModelRouter(temp_config)
        with pytest.raises(KeyError):
            router.resolve("nonexistent", "some_task")

    def test_tier_0_raises_no_model(self, temp_config):
        router = ModelRouter(temp_config)
        # tier_0 has no models — resolve raises ModelUnavailableError
        with pytest.raises(ModelUnavailableError):
            router.resolve("reviewer", "fact_guard")


class TestFallbackChain:
    def test_builds_fallback_chain(self, temp_config):
        router = ModelRouter(temp_config)
        mapping = router._mappings["planner"]["chapter_outline"]
        tier = router._tiers["tier_1"]
        chain = router._build_fallback_chain(mapping, tier, "deepseek-chat")
        assert "claude-haiku" in chain

    def test_excludes_current_model(self, temp_config):
        router = ModelRouter(temp_config)
        mapping = router._mappings["planner"]["chapter_outline"]
        tier = router._tiers["tier_1"]
        chain = router._build_fallback_chain(mapping, tier, "deepseek-chat")
        assert "deepseek-chat" not in chain


class TestExecute:
    def test_execute_success(self, temp_config):
        router = ModelRouter(temp_config)
        mock = _mock_provider()
        with patch.object(router, "_create_provider_for_model", return_value=mock), \
             patch.object(router, "record_usage"):
            result = asyncio.run(router.execute("planner", "chapter_outline", [
                {"role": "user", "content": "test"}
            ]))
        assert result["content"] == "response"

    def test_retries_on_failure(self, temp_config):
        router = ModelRouter(temp_config)
        provider = MagicMock()
        provider.generate = AsyncMock()
        provider.generate.side_effect = [
            _async_fail(),
            _async_fail(),
            _make_response("ok"),
        ]
        with patch.object(router, "_create_provider_for_model", return_value=provider), \
             patch.object(router, "record_usage"):
            result = asyncio.run(router.execute("planner", "chapter_outline", [
                {"role": "user", "content": "test"}
            ]))
        assert result["content"] == "ok"

    def test_tier_2_silent_degradation(self, temp_config):
        router = ModelRouter(temp_config)
        provider = MagicMock()
        provider.generate = AsyncMock(side_effect=Exception("fail"))
        with patch.object(router, "_create_provider_for_model", return_value=provider), \
             patch.object(router, "record_usage"):
            result = asyncio.run(router.execute("reviewer", "narrative_guard", [
                {"role": "user", "content": "test"}
            ]))
        assert result["content"] == ""
        assert result["model"] == "none"

    def test_tier_3_silent_degradation(self, temp_config):
        router = ModelRouter(temp_config)
        provider = MagicMock()
        provider.generate = AsyncMock(side_effect=Exception("fail"))
        with patch.object(router, "_create_provider_for_model", return_value=provider), \
             patch.object(router, "record_usage"):
            result = asyncio.run(router.execute("summary_archiver", "chapter_summary", [
                {"role": "user", "content": "test"}
            ]))
        assert result["content"] == ""
        assert result["model"] == "none"


class TestReloadConfig:
    def test_clears_and_reparses(self, temp_config):
        router = ModelRouter(temp_config)
        assert len(router._tiers) == 4
        router._tiers.clear()
        router._mappings.clear()
        router.reload_config()
        assert len(router._tiers) == 4

    def test_preserves_config_path(self, temp_config):
        router = ModelRouter(temp_config)
        router.reload_config()
        assert len(router._tiers) > 0
        assert len(router._mappings) > 0
