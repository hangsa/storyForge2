import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import backend.services.llm_config as cfg_mod
import backend.services.llm_usage_log as log_mod
from backend.main import app

REAL_CONFIG = Path("config/model_tiers.yaml")


@pytest.fixture
def client(monkeypatch, tmp_path):
    target = tmp_path / "model_tiers.yaml"
    shutil.copy(REAL_CONFIG, target)
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