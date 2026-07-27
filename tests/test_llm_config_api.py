import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import backend.services.llm_config as cfg_mod
import backend.services.llm_usage_log as log_mod
from backend.main import app
from backend.services.llm_config import LLMConfigError

REAL_CONFIG = Path("config/model_tiers.yaml")


@pytest.fixture(autouse=True)
def _patch_env_path(monkeypatch, tmp_path):
    monkeypatch.setattr(cfg_mod, "ENV_PATH", tmp_path / ".env")


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
            "tier_2": {
                "description": "AI 控制台 updated me",
                "default": "claude-opus-4",
                "fallback": "deepseek-v4-pro",
                "retry_on_failure": True,
                "max_retries": 1,
            },
            "tier_3": {
                "description": "auxiliary",
                "default": "deepseek-v4-pro",
                "fallback": None,
                "retry_on_failure": False,
                "max_retries": 0,
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


def test_round_trip_strips_models_field_from_all_tiers(client, tmp_path, monkeypatch):
    """Any save through PUT /llm-config must auto-pop the legacy `models` key
    so subsequent loads see a clean schema. write_yaml_atomic handles this
    centrally; this test guards against the per-tier pop ever being removed.
    """
    import yaml as yaml_mod
    import backend.services.llm_config as cfg_mod_local

    target = tmp_path / "model_tiers.yaml"
    data = _v2_base()
    # Add a `models` key to every tier, simulating a stale or imported YAML.
    for t in data["tiers"].values():
        t["models"] = ["claude-opus-4", "deepseek-v4-pro"]
    target.write_text(yaml_mod.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")
    monkeypatch.setattr(cfg_mod_local, "CONFIG_PATH", target)

    res = client.put("/api/settings/llm-config", json=data)
    assert res.status_code == 200, res.text
    after = yaml_mod.safe_load(target.read_text(encoding="utf-8"))
    for tier_name, tier in after["tiers"].items():
        assert "models" not in tier, f"tier {tier_name!r} still has models key: {tier}"


def test_reload_endpoint_returns_summary(client):
    res = client.post("/api/settings/llm-config/reload")
    assert res.status_code == 200
    summary = res.json()["detail"]
    assert summary["tiers"] >= 4
    assert summary["agents"] >= 7


def test_upsert_provider(client):
    payload = {"id": "newprov", "provider": {
        "type": "openai_compatible",
        "display_name": "NewProv",
        "base_url": "https://api.newprov.com/v1",
        "api_key_env": "NEWPROV_API_KEY",
        "enabled": True,
        "models": {},
    }}
    res = client.post("/api/settings/llm-config/providers", json=payload)
    assert res.status_code == 200, res.text

    cfg = client.get("/api/settings/llm-config").json()["detail"]
    assert "newprov" in cfg["providers"]
    assert cfg["providers"]["newprov"]["display_name"] == "NewProv"


def test_upsert_provider_preserves_models_when_not_in_body(client):
    payload = {
        "id": "anthropic",
        "provider": {
            "type": "anthropic",
            "display_name": "Anthropic Renamed",
            "base_url": "https://api.anthropic.com",
            "api_key_env": "ANTHROPIC_API_KEY",
            "enabled": True,
        },
    }
    res = client.post("/api/settings/llm-config/providers", json=payload)
    assert res.status_code == 200, res.text
    cfg = client.get("/api/settings/llm-config").json()["detail"]
    assert cfg["providers"]["anthropic"]["display_name"] == "Anthropic Renamed"
    assert "claude-opus-4" in cfg["providers"]["anthropic"]["models"]


def test_delete_provider_with_references_blocked(client):
    res = client.delete("/api/settings/llm-config/providers/deepseek")
    assert res.status_code == 422
    detail = res.json()["detail"]
    # find_references emits model-id paths (provider references walk through
    # model ownership); we just check invalid_paths is non-empty and the
    # error code matches.
    invalid_paths = detail["detail"]["invalid_paths"]
    assert invalid_paths, "expected at least one reference path"
    assert detail["code"] == "VALIDATION_ERROR"


def test_upsert_model_in_provider(client):
    payload = {"id": "newmodel", "model": {
        "display_name": "New Model",
        "cost_per_1k_input": 0.01,
        "cost_per_1k_output": 0.02,
        "max_tokens": 4096,
        "temperature": 0.7,
        "json_mode": False,
        "stream": True,
    }}
    res = client.post(
        "/api/settings/llm-config/providers/anthropic/models", json=payload
    )
    assert res.status_code == 200, res.text

    cfg = client.get("/api/settings/llm-config").json()["detail"]
    assert "newmodel" in cfg["providers"]["anthropic"]["models"]


def test_delete_model_in_use_blocked(client):
    res = client.delete(
        "/api/settings/llm-config/providers/deepseek/models/deepseek-v4-pro"
    )
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["code"] == "VALIDATION_ERROR"


def test_set_provider_api_key_writes_env(client, monkeypatch, tmp_path):
    env_path = tmp_path / ".env"
    env_path.write_text("ANTHROPIC_API_KEY=old\n", encoding="utf-8")
    monkeypatch.setattr(cfg_mod, "ENV_PATH", env_path)
    res = client.put(
        "/api/settings/llm-config/providers/anthropic/api-key",
        json={"value": "sk-new"},
    )
    assert res.status_code == 200, res.text
    assert "ANTHROPIC_API_KEY=sk-new" in env_path.read_text(encoding="utf-8")


def test_migrate_endpoint_idempotent_when_already_v2(client):
    # POST /migrate is idempotent: legacy YAML → migrate_legacy_yaml();
    # already-v2 YAML that lost a builtin → seed_builtin_providers().
    # Both paths return 200 with a reload summary in detail. The _v2_base
    # fixture already contains all three builtins (anthropic/deepseek/
    # minimax), so seed reports an empty `added` list — that's correct.
    res = client.post("/api/settings/llm-config/migrate")
    assert res.status_code == 200
    body = res.json()
    assert body["error"] is False
    assert "added" in body["detail"]
    assert "summary" in body["detail"]
    assert body["detail"]["added"] == []


def test_migrate_endpoint_409_on_unrelated_already_v2_error(client, monkeypatch):
    # Verify the endpoint still surfaces 409 for genuine migration errors
    # (anything other than "已是新结构"). Force a validate failure to
    # trigger the unrelated-error branch. Patch via the api module's
    # direct import binding, not via cfg_mod (api does
    # `from backend.services.llm_config import migrate_legacy_yaml`).
    import backend.api.llm_config_api as api_mod

    def boom():
        raise LLMConfigError("模拟其它错误", ["$"])

    monkeypatch.setattr(api_mod, "migrate_legacy_yaml", boom)
    res = client.post("/api/settings/llm-config/migrate")
    assert res.status_code == 409


def test_invalid_provider_id_rejected(client):
    # Provider ids still keep the strict a-z0-9_- rule so YAML/env names
    # (`STORYFORGE_PROVIDER_API_KEY_<X>`) and legacy URLs resolve predictably.
    res = client.delete("/api/settings/llm-config/providers/has.dot")
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "VALIDATION_ERROR"


def test_invalid_model_id_rejected(client):
    # Spaces are not allowed in model ids (would break YAML keys / shell escaping),
    # but uppercase letters and dots ARE allowed since model ids round-trip the
    # provider's own naming (e.g. "MiniMax-M3", "gpt-4.1-mini").
    res = client.delete("/api/settings/llm-config/providers/anthropic/models/has%20space")
    assert res.status_code == 422


def test_model_id_with_uppercase_and_dot_round_trips(client):
    # Provider-returned model ids often contain uppercase letters and version
    # dots (e.g. "MiniMax-M3", "gpt-4.1-mini"). Make sure the upsert/delete
    # pipeline accepts them and the YAML round-trip preserves the original id.
    payload = {"id": "MiniMax-M3", "model": {
        "display_name": "MiniMax-M3",
        "cost_per_1k_input": 0.001,
        "cost_per_1k_output": 0.002,
        "max_tokens": 4096,
        "temperature": 0.7,
        "json_mode": False,
        "stream": True,
    }}
    res = client.post(
        "/api/settings/llm-config/providers/minimax/models", json=payload
    )
    assert res.status_code == 200, res.text

    cfg = client.get("/api/settings/llm-config").json()["detail"]
    assert "MiniMax-M3" in cfg["providers"]["minimax"]["models"]
    assert cfg["providers"]["minimax"]["models"]["MiniMax-M3"]["display_name"] == "MiniMax-M3"

    # And it can be deleted by the exact same id (URL-encoded dot).
    res = client.delete(
        "/api/settings/llm-config/providers/minimax/models/MiniMax-M3"
    )
    assert res.status_code == 200, res.text


def test_probe_endpoint_success_returns_models(client, monkeypatch):
    from backend.services import llm_config as cfg_mod_local
    from backend.llm.base_provider import ProbeResult

    async def fake_probe(self):
        return ProbeResult(
            success=True,
            latency_ms=234,
            models=[
                {"id": "claude-opus-4-20250514", "display_name": "Claude Opus 4"},
                {"id": "claude-haiku-4-5", "display_name": "Claude Haiku 4.5"},
            ],
        )

    monkeypatch.setattr(cfg_mod_local._provider_class_for_type("anthropic"), "probe", fake_probe)
    res = client.post("/api/settings/llm-config/providers/anthropic/probe")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["error"] is False
    detail = body["detail"]
    assert detail["success"] is True
    assert detail["latency_ms"] == 234
    assert len(detail["models"]) == 2
    assert detail["models"][0]["id"] == "claude-opus-4-20250514"


def test_probe_endpoint_passes_through_failed_probe(client, monkeypatch):
    # The endpoint just passes through whatever probe() returns. Verify that
    # a failure-shape ProbeResult from a provider surfaces with success=False
    # and the right error_code. (The auth/unreachable/provider_error mapping
    # is unit-tested separately in test_probe_error_normalization.)
    from backend.services import llm_config as cfg_mod_local
    from backend.llm.base_provider import ProbeResult

    async def fake_probe(self):
        return ProbeResult(
            success=False,
            latency_ms=120,
            models=None,
            error="invalid api key",
            error_code="auth_error",
        )

    monkeypatch.setattr(
        cfg_mod_local._provider_class_for_type("anthropic"), "probe", fake_probe
    )
    res = client.post("/api/settings/llm-config/providers/anthropic/probe")
    assert res.status_code == 200, res.text
    detail = res.json()["detail"]
    assert detail["success"] is False
    assert detail["error_code"] == "auth_error"
    assert detail["error"] == "invalid api key"


def test_probe_error_normalization_buckets():
    """Unit-test the shared error normalizer — auth_error / unreachable /
    provider_error buckets. Each branch is one SDK exception class with a
    minimal httpx.Response stub."""
    import time
    import httpx
    from backend.llm.base_provider import _normalize_openai_probe_error

    def _stub(code: int = 401) -> httpx.Response:
        return httpx.Response(
            code,
            request=httpx.Request("POST", "https://api.example.com/v1/models"),
            headers={},
            content=b"",
        )

    from openai import (
        APIConnectionError,
        APITimeoutError,
        AuthenticationError,
        NotFoundError,
        PermissionDeniedError,
    )

    start = time.monotonic()

    # auth_error bucket
    err = AuthenticationError("bad key", response=_stub(401), body=None)
    r = _normalize_openai_probe_error(start, err)
    assert r.success is False and r.error_code == "auth_error"

    err = PermissionDeniedError("nope", response=_stub(403), body=None)
    r = _normalize_openai_probe_error(start, err)
    assert r.success is False and r.error_code == "auth_error"

    # unreachable bucket
    err = APIConnectionError(request=_stub().request)
    r = _normalize_openai_probe_error(start, err)
    assert r.success is False and r.error_code == "unreachable"

    err = NotFoundError("404", response=_stub(404), body=None)
    r = _normalize_openai_probe_error(start, err)
    assert r.success is False and r.error_code == "unreachable"

    err = APITimeoutError(request=_stub().request)
    r = _normalize_openai_probe_error(start, err)
    assert r.success is False and r.error_code == "unreachable"

    # unknown → provider_error
    err = ValueError("something weird")
    r = _normalize_openai_probe_error(start, err)
    assert r.success is False and r.error_code == "provider_error"


def test_probe_endpoint_404_when_provider_missing(client):
    res = client.post("/api/settings/llm-config/providers/nonexistent/probe")
    assert res.status_code == 404
    body = res.json()
    assert body["detail"]["code"] == "NOT_FOUND"


def test_probe_endpoint_reports_missing_api_key(client, monkeypatch, tmp_path):
    # Clear both .env contents AND the cached pydantic-settings value
    # (loaded at import time from the real .env). Settings caches values on
    # the BaseSettings instance, so monkeypatch.setattr is required to
    # force the resolution to return "".
    empty_env = tmp_path / ".env"
    empty_env.write_text("", encoding="utf-8")
    monkeypatch.setattr(cfg_mod, "ENV_PATH", empty_env)
    from backend.config import settings as real_settings
    monkeypatch.setattr(real_settings, "anthropic_api_key", "", raising=False)
    for var in ("ANTHROPIC_API_KEY", "STORYFORGE_PROVIDER_API_KEY_ANTHROPIC"):
        monkeypatch.delenv(var, raising=False)
    res = client.post("/api/settings/llm-config/providers/anthropic/probe")
    assert res.status_code == 200, res.text
    detail = res.json()["detail"]
    assert detail["success"] is False
    assert detail["error_code"] == "auth_error"
    assert "未配置" in (detail.get("error") or "")


def _make_fake_response(status_code: int = 401):
    """Build a minimal stub response object compatible with openai SDK errors.

    The SDK reads `.request` (httpx.Request) and `.status_code` / `.headers`;
    all three must be present on the stub or AuthenticationError.__init__
    raises AttributeError.
    """
    import httpx

    class _Resp:
        def __init__(self, code):
            self.status_code = code
            self.headers = {}
            self.request = httpx.Request("POST", "https://api.example.com/v1/models")

        @property
        def text(self):
            return ""

    return _Resp(status_code)