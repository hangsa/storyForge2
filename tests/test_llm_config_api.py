import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import backend.services.llm_config as cfg_mod
import backend.services.llm_usage_log as log_mod
from backend.main import app

REAL_CONFIG = Path("config/model_tiers.yaml")


def _v2_base():
    """Minimal v2-shaped fixture so the reload endpoint can call
    validate() against a config that matches the new schema (the real
    config/model_tiers.yaml still uses the legacy shape until Task 9).
    """
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
                "models": ["deepseek-v4-pro", "claude-opus-4"],
                "retry_on_failure": True,
                "max_retries": 1,
            },
            "tier_2": {
                "description": "AI 控制台 updated me",
                "default": "claude-opus-4",
                "fallback": "deepseek-v4-pro",
                "models": ["claude-opus-4", "deepseek-v4-pro"],
                "retry_on_failure": True,
                "max_retries": 1,
            },
            "tier_3": {
                "description": "auxiliary",
                "default": "deepseek-v4-pro",
                "fallback": None,
                "models": ["deepseek-v4-pro"],
                "retry_on_failure": False,
                "max_retries": 0,
            },
            "tier_0": {
                "description": "确定性",
                "default": "none",
                "fallback": None,
                "models": [],
                "retry_on_failure": False,
                "max_retries": 0,
            },
        },
        "agent_mapping": {
            "writer": {"scene_writing": {"tier": "tier_1", "model": "deepseek-v4-pro"}},
            "planner": {"outline": {"tier": "tier_1", "model": "deepseek-v4-pro"}},
            "reviewer": {"fact_guard": {"tier": "tier_2", "model": "claude-opus-4"}},
            "storyos_agent": {"registry_update": {"tier": "tier_2", "model": "claude-opus-4"}},
            "summary_archiver": {"compress": {"tier": "tier_3", "model": "deepseek-v4-pro"}},
            "creative_director": {"novelty": {"tier": "tier_2", "model": "claude-opus-4"}},
            "character_designer": {"design": {"tier": "tier_3", "model": "deepseek-v4-pro"}},
        },
    }


@pytest.fixture
def client(monkeypatch, tmp_path):
    import yaml as yaml_mod
    target = tmp_path / "model_tiers.yaml"
    shutil.copy(REAL_CONFIG, target)
    # Overwrite with v2-shaped content so the new validate() succeeds
    # during reload. Other tests that read legacy keys (tiers/agent_mapping)
    # still work because those keys exist in both shapes.
    target.write_text(
        yaml_mod.safe_dump(_v2_base(), allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )
    monkeypatch.setattr(cfg_mod, "CONFIG_PATH", target)
    monkeypatch.setattr(log_mod, "USAGE_PATH", tmp_path / "llm_usage.jsonl")
    return TestClient(app)


def test_get_llm_config(client):
    res = client.get("/api/settings/llm-config")
    assert res.status_code == 200
    detail = res.json()["detail"]
    assert "tiers" in detail and "agent_mapping" in detail


def test_get_llm_providers(client):
    res = client.get("/api/settings/llm-providers")
    assert res.status_code == 200
    rows = res.json()["detail"]
    assert {r["provider"] for r in rows} == {"anthropic", "deepseek", "minimax"}
    for r in rows:
        assert isinstance(r["api_key_configured"], bool)
        assert isinstance(r["models"], list)
        assert "base_url" in r


def test_get_llm_usage_default_limit(client):
    res = client.get("/api/settings/llm-usage")
    assert res.status_code == 200
    assert res.json()["detail"] == []


def test_get_llm_usage_rejects_out_of_range(client):
    assert client.get("/api/settings/llm-usage?limit=0").status_code == 400
    assert client.get("/api/settings/llm-usage?limit=9999").status_code == 400


def test_put_llm_config_round_trip(client):
    res = client.post("/api/settings/llm-config/reload")
    assert res.status_code == 200

    payload = client.get("/api/settings/llm-config").json()["detail"]
    payload["tiers"]["tier_2"]["description"] = "AI 控制台 updated me"

    res = client.put("/api/settings/llm-config", json=payload)
    assert res.status_code == 200
    body = res.json()
    assert body["error"] is False
    assert body["detail"]["tiers"] >= 4

    again = client.get("/api/settings/llm-config").json()["detail"]
    assert again["tiers"]["tier_2"]["description"] == "AI 控制台 updated me"


def test_put_llm_config_rejects_invalid_with_422(client):
    payload = client.get("/api/settings/llm-config").json()["detail"]
    payload["tiers"].pop("tier_0")
    res = client.put("/api/settings/llm-config", json=payload)
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["code"] == "VALIDATION_ERROR"
    assert "tier_0" in detail["detail"]["invalid_paths"]


def test_reload_endpoint_returns_summary(client):
    res = client.post("/api/settings/llm-config/reload")
    assert res.status_code == 200
    summary = res.json()["detail"]
    assert summary["tiers"] >= 4
    assert summary["agents"] >= 7