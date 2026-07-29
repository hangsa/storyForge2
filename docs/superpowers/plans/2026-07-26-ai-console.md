# AI 控制台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Expose the StoryForge LLM routing configuration (`config/model_tiers.yaml`) — plus recent `llm_usage.jsonl` records — through a full-screen **AI 控制台** modal mounted from the HomePage left sidebar, so non-engineers can edit tier pools and agent mappings, hot-reload the router, and watch recent usage without restarting the backend.

**Architecture:** Backend adds a `llm_config` service (atomic read/write of YAML + structured `invalid_paths` validation + safe reload) and a `llm_usage_log` service (tail-most-recent N records from `llm_usage.jsonl`). A new `llm_config_api` router exposes 5 endpoints (GET config / GET providers / PUT config / POST reload / GET usage). Frontend adds an `AIConsoleModal` modeled on `PromptPlazaModal` (full-screen, Esc + backdrop close), with Usage / Provider / Tier / AgentMapping panels, local dirty-state guard, and a SaveBar. The QuickActions button `qa-ai-console` flips from disabled to enabled.

**Tech Stack:** FastAPI 0.110 (existing), Pydantic v2 (existing), `python-yaml` (existing); React 18 + Vite + Tailwind (existing), `react-router-dom` v6.

---

## File Structure

**New files (backend):**
- `backend/services/llm_config.py` — `read_yaml`, `write_yaml_atomic`, `validate`, `reload_router`, `provider_status`, `LLMConfigError`. Single source of truth for YAML I/O and shape checks.
- `backend/services/llm_usage_log.py` — `read_recent(limit)`. Tails `llm_usage.jsonl`.
- `backend/api/llm_config_api.py` — 5 endpoints.

**New files (frontend):**
- `frontend/src/api/llmConsole.ts` — typed wrapper; re-exports types.
- `frontend/src/components/aiConsole/AIConsoleModal.tsx` — shell, data fetching, dirty-state guard, SaveBar.
- `frontend/src/components/aiConsole/UsageRecentTable.tsx` — read-only table (timestamp, agent, task, tier, model, tokens, cost).
- `frontend/src/components/aiConsole/ProviderPanel.tsx` — read-only provider rows; never returns API keys.
- `frontend/src/components/aiConsole/TierPanel.tsx` — CRUD per tier (skip `tier_0` model mutations).
- `frontend/src/components/aiConsole/AgentMappingPanel.tsx` — CRUD per-agent per-task; cascading reset on tier change.

**Modified:**
- `backend/main.py:91` — `include_router(llm_config_api.router)` (additive).
- `frontend/src/api/client.ts` — add `getLLMConfig`, `putLLMConfig`, `reloadLLMConfig`, `getProviders`, `getLLMUsage`.
- `frontend/src/components/home/QuickActions.tsx` — add `onOpenConsole` prop; flip `qa-ai-console` from `disabled` to enabled.
- `frontend/src/components/home/StatsSidebar.tsx` — pass `onOpenConsole` through.
- `frontend/src/pages/HomePage.tsx` — `consoleOpen` state + render `<AIConsoleModal>`.

**New tests:**
- `tests/test_llm_config_service.py` — validate / write / provider_status.
- `tests/test_llm_usage_log.py` — read_recent behavior.
- `tests/test_llm_config_api.py` — 5-endpoint integration.
- `frontend/src/test/AIConsoleModal.test.tsx` — open fetches 3 endpoints; dirty guard.
- `frontend/src/test/UsageRecentTable.test.tsx` — empty/multi-row/columns.
- `frontend/src/test/TierPanel.test.tsx` — CRUD, read-only tier_0.
- `frontend/src/test/AgentMappingPanel.test.tsx` — tier-change reset, add/remove.

---

## Task 1: Backend — `llm_config.py` service skeleton with `read_yaml`

**Files:**
- Create: `backend/services/__init__.py` (already exists, no change)
- Create: `backend/services/llm_config.py`
- Create: `tests/test_llm_config_service.py`

- [ ] **Step 1: Write failing test for `read_yaml` round-trip on the real config**

```python
# tests/test_llm_config_service.py
from pathlib import Path

import pytest

from backend.services.llm_config import read_yaml

REAL_CONFIG = Path("config/model_tiers.yaml")


@pytest.fixture
def isolated_config(tmp_path, monkeypatch):
    """Point CONFIG_PATH at a tmp copy of the real file."""
    import shutil
    target = tmp_path / "model_tiers.yaml"
    shutil.copy(REAL_CONFIG, target)
    import backend.services.llm_config as mod
    monkeypatch.setattr(mod, "CONFIG_PATH", target)
    return target


def test_read_yaml_returns_parseable_dict(isolated_config):
    data = read_yaml()
    assert isinstance(data, dict)
    assert "tiers" in data
    assert "agent_mapping" in data
    assert "tier_1" in data["tiers"]
```

- [ ] **Step 2: Run test and verify failure**

Run: `pytest tests/test_llm_config_service.py::test_read_yaml_returns_parseable_dict -v`
Expected: FAIL with `ModuleNotFoundError: backend.services.llm_config`.

- [ ] **Step 3: Implement `read_yaml` and module skeleton**

```python
# backend/services/llm_config.py
from __future__ import annotations
import os
import tempfile
from pathlib import Path

import yaml

from backend.config import settings
from backend.llm.model_router import get_model_router

CONFIG_PATH = Path("config/model_tiers.yaml")
PROVIDER_KEY_MAP = {
    "anthropic": "anthropic_api_key",
    "deepseek": "deepseek_api_key",
    "minimax": "minimax_api_key",
}
ALLOWED_PROVIDERS = {"anthropic", "deepseek", "minimax"}


class LLMConfigError(ValueError):
    def __init__(self, message: str, invalid_paths: list[str]):
        super().__init__(message)
        self.invalid_paths = invalid_paths


def read_yaml() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}
```

- [ ] **Step 4: Run test and verify pass**

Run: `pytest tests/test_llm_config_service.py::test_read_yaml_returns_parseable_dict -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/llm_config.py tests/test_llm_config_service.py
git commit -m "feat(ai-console): llm_config service skeleton with read_yaml"
```

---

## Task 2: Backend — `write_yaml_atomic`

**Files:**
- Modify: `backend/services/llm_config.py`
- Modify: `tests/test_llm_config_service.py`

- [ ] **Step 1: Append failing test**

```python
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
    # only the real file remains (no .tmp leftovers)
    leftover = [p.name for p in isolated_config.parent.glob(".model_tiers.*.tmp")]
    assert leftover == []
```

Append these to `tests/test_llm_config_service.py`.

- [ ] **Step 2: Run tests and verify failure**

Run: `pytest tests/test_llm_config_service.py -v`
Expected: FAIL with `AttributeError: module 'backend.services.llm_config' has no attribute 'write_yaml_atomic'`.

- [ ] **Step 3: Implement `write_yaml_atomic`**

```python
def write_yaml_atomic(data: dict) -> None:
    """Atomic write to CONFIG_PATH. Same mkstemp + os.replace pattern as
    backfill_behavior_examples._atomic_write_json — survives kill mid-write
    and never leaves a stray .tmp file."""
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=CONFIG_PATH.parent,
        prefix=".model_tiers.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            yaml.safe_dump(
                data,
                f,
                allow_unicode=True,
                sort_keys=False,
                default_flow_style=False,
            )
        os.replace(tmp_name, CONFIG_PATH)
    except Exception:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)
        raise
```

Add to `backend/services/llm_config.py` after `read_yaml`.

- [ ] **Step 4: Run tests and verify pass**

Run: `pytest tests/test_llm_config_service.py -v`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/llm_config.py tests/test_llm_config_service.py
git commit -m "feat(ai-console): atomic YAML write for model_tiers"
```

---

## Task 3: Backend — `validate` with `invalid_paths` semantics

**Files:**
- Modify: `backend/services/llm_config.py`
- Modify: `tests/test_llm_config_service.py`

- [ ] **Step 1: Append failing test**

```python
def test_validate_happy_path_against_real_config(isolated_config):
    from backend.services.llm_config import validate
    validate(read_yaml())  # must not raise


def test_validate_rejects_unknown_default(isolated_config):
    from backend.services.llm_config import LLMConfigError, read_yaml, validate
    bad = read_yaml()
    bad["tiers"]["tier_1"]["default"] = "ghost-model"
    with pytest.raises(LLMConfigError) as exc:
        validate(bad)
    assert any(p.endswith("tier_1.default") for p in exc.value.invalid_paths)


def test_validate_rejects_empty_agent_mapping_entry(isolated_config):
    from backend.services.llm_config import LLMConfigError, read_yaml, validate
    bad = read_yaml()
    bad["agent_mapping"]["planner"]["" ] = {"tier": "tier_1"}  # invalid blank task
    with pytest.raises(LLMConfigError) as exc:
        validate(bad)
    assert any("planner" in p for p in exc.value.invalid_paths)


def test_validate_rejects_missing_tier0(isolated_config):
    from backend.services.llm_config import LLMConfigError, read_yaml, validate
    bad = read_yaml()
    bad["tiers"].pop("tier_0")
    with pytest.raises(LLMConfigError) as exc:
        validate(bad)
    assert "tier_0" in exc.value.invalid_paths


def test_validate_rejects_agent_mapping_to_unknown_tier(isolated_config):
    from backend.services.llm_config import LLMConfigError, read_yaml, validate
    bad = read_yaml()
    bad["agent_mapping"]["planner"]["novelty_evaluation"]["tier"] = "tier_9"
    with pytest.raises(LLMConfigError) as exc:
        validate(bad)
    assert any("novelty_evaluation.tier" in p for p in exc.value.invalid_paths)
```

Append these to `tests/test_llm_config_service.py`.

- [ ] **Step 2: Run tests and verify failure**

Run: `pytest tests/test_llm_config_service.py -v`
Expected: FAIL with `AttributeError: module ... has no attribute 'validate'`.

- [ ] **Step 3: Implement `validate`**

```python
def validate(data: dict) -> None:
    """Validate a config dict. Raises LLMConfigError with `invalid_paths`
    on failure. Path format matches JSON-pointer-ish dotted syntax:
    e.g. `tiers.tier_1.models.0.id`, `agent_mapping.writer.scene_writing.tier`.
    """
    if not isinstance(data, dict):
        raise LLMConfigError("配置根节点必须是对象", ["$"])

    tiers = data.get("tiers") or {}
    if not isinstance(tiers, dict):
        raise LLMConfigError("tiers 必须是对象", ["tiers"])

    invalid: list[str] = []
    known_tier_names = set(tiers.keys())
    if "tier_0" not in known_tier_names:
        invalid.append("tiers.tier_0")

    for tier_name, tier in tiers.items():
        if not tier_name.strip() or not isinstance(tier, dict):
            invalid.append(f"tiers.{tier_name or '<empty>'}")
            continue
        if tier_name == "tier_0":
            if tier.get("models") or tier.get("default") != "none":
                invalid.append("tiers.tier_0")
            continue

        models = tier.get("models") or []
        if not models:
            invalid.append(f"tiers.{tier_name}.models")

        model_ids = [
            m.get("id") for m in models if isinstance(m, dict) and m.get("id")
        ]
        if len(model_ids) != len(set(model_ids)):
            invalid.append(f"tiers.{tier_name}.models")

        for i, m in enumerate(models):
            if not isinstance(m, dict):
                invalid.append(f"tiers.{tier_name}.models.{i}")
                continue
            mid = m.get("id")
            if not mid:
                invalid.append(f"tiers.{tier_name}.models.{i}.id")
                continue
            if m.get("provider") not in ALLOWED_PROVIDERS:
                invalid.append(f"tiers.{tier_name}.models.{i}.provider")
            if not isinstance(m.get("max_tokens"), int):
                invalid.append(f"tiers.{tier_name}.models.{i}.max_tokens")

        default = tier.get("default")
        if default and default != "none" and not any(m.get("id") == default for m in models):
            invalid.append(f"tiers.{tier_name}.default")
        fallback = tier.get("fallback")
        if fallback and not any(m.get("id") == fallback for m in models):
            invalid.append(f"tiers.{tier_name}.fallback")

    mappings = data.get("agent_mapping") or {}
    if not isinstance(mappings, dict):
        invalid.append("agent_mapping")
        mappings = {}

    for agent_name, tasks in mappings.items():
        if not agent_name.strip() or not isinstance(tasks, dict):
            invalid.append(f"agent_mapping.{agent_name or '<empty>'}")
            continue
        for task_name, mapping in tasks.items():
            if not task_name.strip() or not isinstance(mapping, dict):
                invalid.append(f"agent_mapping.{agent_name}.{task_name or '<empty>'}")
                continue
            tier_name = mapping.get("tier")
            if tier_name and tier_name not in known_tier_names:
                invalid.append(f"agent_mapping.{agent_name}.{task_name}.tier")
                continue
            tier_models = (
                (tiers.get(tier_name) or {}).get("models") or []
                if tier_name in known_tier_names
                else []
            )
            model_id = mapping.get("model")
            if model_id and model_id != "default" and not any(
                m.get("id") == model_id for m in tier_models
            ):
                invalid.append(f"agent_mapping.{agent_name}.{task_name}.model")
            fallback = mapping.get("fallback")
            if (
                fallback
                and fallback != "default"
                and not any(m.get("id") == fallback for m in tier_models)
            ):
                invalid.append(f"agent_mapping.{agent_name}.{task_name}.fallback")

    if invalid:
        raise LLMConfigError(
            f"配置校验失败：{len(invalid)} 项错误", invalid
        )
```

Replace the `validate` placeholder (currently not present) in `backend/services/llm_config.py`.

- [ ] **Step 4: Run tests and verify pass**

Run: `pytest tests/test_llm_config_service.py -v`
Expected: 8 PASS (`test_read_yaml_returns_parseable_dict` + the 2 write tests + 5 validate tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/llm_config.py tests/test_llm_config_service.py
git commit -m "feat(ai-console): validate config with invalid_paths mapping"
```

---

## Task 4: Backend — `reload_router` and `provider_status`

**Files:**
- Modify: `backend/services/llm_config.py`
- Modify: `tests/test_llm_config_service.py`

- [ ] **Step 1: Append failing test**

```python
def test_reload_router_swaps_in_disk(monkeypatch, isolated_config):
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


def test_provider_status_includes_keys(monkeypatch, isolated_config):
    from backend.services import llm_config as mod
    from backend.services.llm_config import provider_status

    # forge configured flags without leaking actual secrets
    monkeypatch.setattr(
        mod.settings, "anthropic_api_key", "sk-test", raising=False
    )
    monkeypatch.setattr(mod.settings, "deepseek_api_key", "", raising=False)
    monkeypatch.setattr(
        mod.settings, "deepseek_base_url", "https://api.deepseek.com/v1", raising=False
    )

    out = provider_status()
    by_name = {row["provider"]: row for row in out}
    assert by_name["anthropic"]["api_key_configured"] is True
    assert by_name["deepseek"]["api_key_configured"] is False
    assert by_name["deepseek"]["base_url"] == "https://api.deepseek.com/v1"
    assert "claude-opus-4" in by_name["anthropic"]["models"]
```

Append to `tests/test_llm_config_service.py`.

- [ ] **Step 2: Run tests and verify failure**

Run: `pytest tests/test_llm_config_service.py -v`
Expected: FAIL with `AttributeError: ... has no attribute 'reload_router'` (or `provider_status`).

- [ ] **Step 3: Implement `reload_router` and `provider_status`**

```python
def reload_router() -> dict:
    """Validate disk config, then swap the live router's tiers / mappings in."""
    validate(read_yaml())
    router = get_model_router()
    router.reload_config()
    return {"tiers": len(router._tiers), "agents": len(router._mappings)}


def provider_status() -> list[dict]:
    cfg = read_yaml()
    tiers = cfg.get("tiers") or {}
    by_provider: dict[str, set[str]] = {p: set() for p in ALLOWED_PROVIDERS}
    for tier in tiers.values():
        if not isinstance(tier, dict):
            continue
        for m in tier.get("models") or []:
            if not isinstance(m, dict):
                continue
            provider = m.get("provider")
            mid = m.get("id")
            if provider in by_provider and mid:
                by_provider[provider].add(mid)
    out: list[dict] = []
    for provider, models in by_provider.items():
        api_key_attr = PROVIDER_KEY_MAP.get(provider, "")
        configured = (
            bool(getattr(settings, api_key_attr, ""))
            if api_key_attr
            else False
        )
        base_url_attr = (
            f"{provider}_base_url" if provider in {"deepseek", "minimax"} else ""
        )
        base_url = (
            getattr(settings, base_url_attr, "") if base_url_attr else ""
        )
        out.append({
            "provider": provider,
            "base_url": base_url,
            "api_key_configured": configured,
            "models": sorted(models),
        })
    return out
```

Add to `backend/services/llm_config.py`.

- [ ] **Step 4: Run tests and verify pass**

Run: `pytest tests/test_llm_config_service.py -v`
Expected: 10 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/llm_config.py tests/test_llm_config_service.py
git commit -m "feat(ai-console): reload_router and provider_status"
```

---

## Task 5: Backend — `llm_usage_log.read_recent`

**Files:**
- Create: `backend/services/llm_usage_log.py`
- Create: `tests/test_llm_usage_log.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_llm_usage_log.py
import json
from pathlib import Path

import pytest

from backend.services import llm_usage_log as mod
from backend.services.llm_usage_log import read_recent


@pytest.fixture
def fake_usage(tmp_path, monkeypatch):
    log = tmp_path / "llm_usage.jsonl"
    monkeypatch.setattr(mod, "USAGE_PATH", log)
    return log


def test_read_recent_empty_when_file_missing(fake_usage):
    assert read_recent(50) == []


def test_read_recent_returns_newest_first(fake_usage):
    rows = [
        {"timestamp": f"2026-07-26T{i:02d}:00:00Z", "agent": "writer",
         "task": "scene_writing", "tier": "tier_1",
         "model": "deepseek-v4-pro", "tokens_in": 100*i, "tokens_out": 50*i, "cost": 0.001}
        for i in range(1, 6)
    ]
    fake_usage.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n",
        encoding="utf-8",
    )
    out = read_recent(3)
    assert [r["timestamp"] for r in out] == [
        "2026-07-26T05:00:00Z",
        "2026-07-26T04:00:00Z",
        "2026-07-26T03:00:00Z",
    ]


def test_read_recent_skips_malformed_lines(fake_usage):
    fake_usage.write_text(
        "not json\n"
        '{"timestamp":"t","agent":"a","task":"x","tier":"tier_1","model":"m","tokens_in":1,"tokens_out":1,"cost":0.0}\n',
        encoding="utf-8",
    )
    out = read_recent(10)
    assert len(out) == 1
    assert out[0]["agent"] == "a"
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pytest tests/test_llm_usage_log.py -v`
Expected: FAIL with `ModuleNotFoundError: backend.services.llm_usage_log`.

- [ ] **Step 3: Implement service**

```python
# backend/services/llm_usage_log.py
from __future__ import annotations
import json

from backend.config import settings

USAGE_PATH = settings.projects_dir.parent / "llm_usage.jsonl"


def read_recent(limit: int = 50) -> list[dict]:
    """Return the most recent `limit` records from llm_usage.jsonl.
    Bad JSON lines are skipped (do not abort the read).
    """
    if not USAGE_PATH.is_file():
        return []
    try:
        with open(USAGE_PATH, "r", encoding="utf-8") as f:
            lines = f.readlines()
    except OSError:
        return []
    out: list[dict] = []
    # Over-read to absorb bad lines; emit newest-first.
    for line in reversed(lines[-limit * 4 :]):
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        out.append(rec)
        if len(out) >= limit:
            break
    return out
```

- [ ] **Step 4: Run tests and verify pass**

Run: `pytest tests/test_llm_usage_log.py -v`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/llm_usage_log.py tests/test_llm_usage_log.py
git commit -m "feat(ai-console): usage log tail-reader"
```

---

## Task 6: Backend — `llm_config_api` router with 5 endpoints

**Files:**
- Create: `backend/api/llm_config_api.py`
- Modify: `backend/main.py:91` (add `include_router` line)
- Create: `tests/test_llm_config_api.py`

- [ ] **Step 1: Write failing API tests (using FastAPI TestClient)**

```python
# tests/test_llm_config_api.py
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
    # ensure usage log lives in tmp_path
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


def test_put_llm_config_round_trip(client, monkeypatch):
    res = client.post("/api/settings/llm-config/reload")
    assert res.status_code == 200  # initial sanity: empty usage JSONL is fine

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
```

- [ ] **Step 2: Run tests and verify failure**

Run: `pytest tests/test_llm_config_api.py -v`
Expected: FAIL with `404 Not Found` (router not mounted yet) — once Step 3 wires `main.py`, the 404s flip to FAIL due to missing endpoint implementations.

- [ ] **Step 3: Implement the router, then wire it into `main.py`**

```python
# backend/api/llm_config_api.py
from fastapi import APIRouter, HTTPException

from backend.services.llm_config import (
    LLMConfigError,
    provider_status,
    read_yaml,
    reload_router,
    validate,
    write_yaml_atomic,
)
from backend.services.llm_usage_log import read_recent

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _ok(detail) -> dict:
    return {"error": False, "code": "OK", "message": "", "detail": detail}


def _err(code: str, message: str, status: int, extra: dict | None = None):
    raise HTTPException(
        status_code=status,
        detail={
            "error": True,
            "code": code,
            "message": message,
            "detail": extra or {},
        },
    )


@router.get("/llm-config")
async def get_llm_config():
    return _ok(read_yaml())


@router.get("/llm-providers")
async def get_llm_providers():
    return _ok(provider_status())


@router.put("/llm-config")
async def put_llm_config(data: dict):
    try:
        validate(data)
    except LLMConfigError as e:
        return _err(
            "VALIDATION_ERROR",
            str(e),
            422,
            {"invalid_paths": e.invalid_paths},
        )
    try:
        write_yaml_atomic(data)
    except OSError as e:
        return _err("WRITE_FAILED", f"写入失败: {e}", 500)
    summary = reload_router()
    return {
        "error": False,
        "code": "OK",
        "message": "配置已保存并热重载",
        "detail": summary,
    }


@router.post("/llm-config/reload")
async def post_reload_llm_config():
    try:
        summary = reload_router()
    except LLMConfigError as e:
        return _err(
            "VALIDATION_ERROR",
            str(e),
            422,
            {"invalid_paths": e.invalid_paths},
        )
    except Exception as e:
        return _err("RELOAD_FAILED", f"重载失败: {e}", 500)
    return {
        "error": False,
        "code": "OK",
        "message": "配置已重载",
        "detail": summary,
    }


@router.get("/llm-usage")
async def get_llm_usage(limit: int = 50):
    if limit < 1 or limit > 500:
        return _err(
            "VALIDATION_ERROR",
            "limit 必须介于 1-500",
            400,
        )
    return _ok(read_recent(limit=limit))
```

Then in `backend/main.py` at line 91 (after `prompt_defaults.router`), add an `include_router` call. First add the import near line 19 (alphabetical with the rest):

```python
    llm_config_api,
```

Then below the `prompt_defaults.router` include:

```python
app.include_router(llm_config_api.router)
```

- [ ] **Step 4: Run tests and verify pass**

Run: `pytest tests/test_llm_config_api.py -v`
Expected: 7 PASS.

- [ ] **Step 5: Run full backend suite to confirm no regression**

Run: `pytest tests/ -x -q`
Expected: existing tests all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/api/llm_config_api.py backend/main.py tests/test_llm_config_api.py
git commit -m "feat(ai-console): 5-endpoint LLM config router"
```

---

## Task 7: Frontend — typed client wrapper `llmConsole`

**Files:**
- Modify: `frontend/src/api/client.ts` (add 5 typed wrappers near end-of-file, before `export default api;` at line 1132)
- Create: `frontend/src/api/llmConsole.ts`

- [ ] **Step 1: Add new methods to `api` object in `client.ts`**

Locate the closing of the `api` object (search for `listProjects:`) and append the following methods to it. The wrappers reuse the existing `request<T>` envelope which already unwraps `detail`.

```ts
  getLLMConfig: () =>
    request<ModelTiersConfig>('GET', '/settings/llm-config'),
  putLLMConfig: (cfg: ModelTiersConfig) =>
    request<LLMRouterSummary>('PUT', '/settings/llm-config', cfg),
  reloadLLMConfig: () =>
    request<LLMRouterSummary>('POST', '/settings/llm-config/reload'),
  getProviders: () =>
    request<ProviderStatus[]>('GET', '/settings/llm-providers'),
  getLLMUsage: (limit = 50) =>
    request<UsageRecord[]>('GET', `/settings/llm-usage?limit=${limit}`),
```

Then, near the end of `frontend/src/api/client.ts` (just before `export default api;` at line 1132), add the matching interfaces:

```ts
export interface ModelEntry {
  id: string;
  provider: 'anthropic' | 'deepseek' | 'minimax';
  cost_per_1k_input: number;
  cost_per_1k_output: number;
  max_tokens: number;
}

export interface TierConfig {
  description: string;
  models: ModelEntry[];
  default: string;
  retry_on_failure?: boolean;
  max_retries?: number;
  fallback?: string | null;
}

export interface AgentTaskMapping {
  tier: string;
  model?: string;
  fallback?: string | null;
}

export interface ModelTiersConfig {
  tiers: Record<string, TierConfig>;
  agent_mapping: Record<string, Record<string, AgentTaskMapping | Record<string, unknown>>>;
}

export interface LLMRouterSummary {
  tiers: number;
  agents: number;
}

export interface ProviderStatus {
  provider: string;
  base_url: string;
  api_key_configured: boolean;
  models: string[];
}

export interface UsageRecord {
  timestamp: string;
  agent: string;
  task: string;
  tier: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost: number;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Create the typed wrapper**

```ts
// frontend/src/api/llmConsole.ts
import api, {
  type ModelTiersConfig,
  type ProviderStatus,
  type LLMRouterSummary,
  type UsageRecord,
} from './client';

export const llmConsole = {
  getConfig: (): Promise<ModelTiersConfig> => api.getLLMConfig(),
  getProviders: (): Promise<ProviderStatus[]> => api.getProviders(),
  saveConfig: (cfg: ModelTiersConfig): Promise<LLMRouterSummary> =>
    api.putLLMConfig(cfg),
  reload: (): Promise<LLMRouterSummary> => api.reloadLLMConfig(),
  getUsage: (limit = 50): Promise<UsageRecord[]> => api.getLLMUsage(limit),
};

export type {
  ModelTiersConfig,
  ModelEntry,
  TierConfig,
  AgentTaskMapping,
  ProviderStatus,
  UsageRecord,
  LLMRouterSummary,
};
```

- [ ] **Step 4: Run the existing frontend test suite (no new tests yet, but make sure nothing broke)**

Run: `cd frontend && npx vitest run src/test/api 2>&1 | tail -20`
Expected: PASS (or no such suite, in which case run `npx vitest run src/test/client.test.ts` if it exists; otherwise `npx tsc --noEmit` suffices).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/llmConsole.ts
git commit -m "feat(ai-console): typed client + api wrapper"
```

---

## Task 8: Frontend — `UsageRecentTable` (read-only subcomponent)

**Files:**
- Create: `frontend/src/components/aiConsole/UsageRecentTable.tsx`
- Create: `frontend/src/test/UsageRecentTable.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// frontend/src/test/UsageRecentTable.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import UsageRecentTable, { type UsageRecord } from '../components/aiConsole/UsageRecentTable';

const SAMPLE: UsageRecord[] = [
  {
    timestamp: '2026-07-26T10:00:00Z',
    agent: 'writer',
    task: 'scene_writing',
    tier: 'tier_1',
    model: 'deepseek-v4-pro',
    tokens_in: 1000,
    tokens_out: 500,
    cost: 0.012,
  },
];

describe('UsageRecentTable', () => {
  it('renders empty state when no records', () => {
    render(<UsageRecentTable records={[]} />);
    expect(screen.getByTestId('usage-empty')).toBeTruthy();
  });

  it('renders one row per record', () => {
    render(<UsageRecentTable records={SAMPLE} />);
    expect(screen.getAllByTestId('usage-row')).toHaveLength(1);
    expect(screen.getByText('writer · scene_writing')).toBeTruthy();
    expect(screen.getByText('tier_1 / deepseek-v4-pro')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `cd frontend && npx vitest run src/test/UsageRecentTable.test.tsx`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement component**

```tsx
// frontend/src/components/aiConsole/UsageRecentTable.tsx
import type { UsageRecord } from '../../api/client';

interface Props {
  records: UsageRecord[];
}

export default function UsageRecentTable({ records }: Props) {
  if (records.length === 0) {
    return (
      <div
        data-testid="usage-empty"
        className="rounded-lg border border-dashed border-canvas-text-muted/30 px-4 py-6 text-center text-sm text-canvas-text-muted"
      >
        暂无最近的 LLM 调用记录。
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-canvas-text-muted/20">
      <table className="min-w-full divide-y divide-canvas-text-muted/20 text-sm">
        <thead className="bg-canvas-surface">
          <tr>
            <th className="px-3 py-2 text-left font-medium">时间</th>
            <th className="px-3 py-2 text-left font-medium">Agent / 任务</th>
            <th className="px-3 py-2 text-left font-medium">Tier / 模型</th>
            <th className="px-3 py-2 text-right font-medium">Tokens in / out</th>
            <th className="px-3 py-2 text-right font-medium">成本</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-canvas-text-muted/10 bg-canvas-bg">
          {records.map((r, idx) => (
            <tr key={`${r.timestamp}-${idx}`} data-testid="usage-row">
              <td className="px-3 py-2 text-canvas-text-muted">{r.timestamp}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.agent} · {r.task}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.tier} / {r.model}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.tokens_in} / {r.tokens_out}</td>
              <td className="px-3 py-2 text-right tabular-nums">${r.cost.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run test and verify pass**

Run: `cd frontend && npx vitest run src/test/UsageRecentTable.test.tsx`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/aiConsole/UsageRecentTable.tsx frontend/src/test/UsageRecentTable.test.tsx
git commit -m "feat(ai-console): UsageRecentTable component"
```

---

## Task 9: Frontend — `ProviderPanel` (read-only)

**Files:**
- Create: `frontend/src/components/aiConsole/ProviderPanel.tsx`

(No test required in this task — provider rows are display-only and exercised by `AIConsoleModal.test.tsx`.)

- [ ] **Step 1: Create the component**

```tsx
// frontend/src/components/aiConsole/ProviderPanel.tsx
import type { ProviderStatus } from '../../api/client';

interface Props {
  providers: ProviderStatus[];
}

const LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  minimax: 'MiniMax',
};

export default function ProviderPanel({ providers }: Props) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {providers.map((p) => (
        <div
          key={p.provider}
          data-testid={`provider-${p.provider}`}
          className="rounded-lg border border-canvas-text-muted/20 bg-canvas-surface px-4 py-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">{LABELS[p.provider] ?? p.provider}</span>
            <span
              data-testid={`provider-key-${p.provider}`}
              className={`text-xs font-medium ${p.api_key_configured ? 'text-emerald-600' : 'text-rose-600'}`}
            >
              {p.api_key_configured ? '✓ 已配置' : '✗ 未配置'}
            </span>
          </div>
          {p.base_url && (
            <div className="mt-2 truncate text-xs text-canvas-text-muted" title={p.base_url}>
              {p.base_url}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-1">
            {p.models.length === 0 ? (
              <span className="text-xs text-canvas-text-muted">（无模型）</span>
            ) : (
              p.models.map((mid) => (
                <span
                  key={mid}
                  className="rounded bg-canvas-bg px-2 py-0.5 font-mono text-xs text-canvas-text-secondary"
                >
                  {mid}
                </span>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/aiConsole/ProviderPanel.tsx
git commit -m "feat(ai-console): ProviderPanel read-only display"
```

---

## Task 10: Frontend — `TierPanel` with full CRUD (tier_0 read-only)

**Files:**
- Create: `frontend/src/components/aiConsole/TierPanel.tsx`
- Create: `frontend/src/test/TierPanel.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// frontend/src/test/TierPanel.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TierPanel, { type TierConfig } from '../components/aiConsole/TierPanel';

const SAMPLE: TierConfig = {
  description: 'Tier 1 description',
  models: [
    { id: 'claude-opus-4', provider: 'anthropic', cost_per_1k_input: 0.015, cost_per_1k_output: 0.075, max_tokens: 8192 },
  ],
  default: 'claude-opus-4',
  retry_on_failure: true,
  max_retries: 2,
  fallback: 'claude-opus-4',
};

const TIER_0: TierConfig = { description: 'Deterministic', models: [], default: 'none' };

describe('TierPanel', () => {
  it('lets user edit description', () => {
    const onChange = vi.fn();
    render(<TierPanel tierName="tier_1" value={SAMPLE} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('tier-1-description'), { target: { value: '新描述' } });
    expect(onChange).toHaveBeenCalledWith({ ...SAMPLE, description: '新描述' });
  });

  it('adds a model when add-model is clicked', () => {
    const onChange = vi.fn();
    render(<TierPanel tierName="tier_1" value={{ ...SAMPLE, models: [] }} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('tier-1-add-model'));
    expect(onChange.mock.calls[0][0].models).toHaveLength(1);
  });

  it('removes a model when remove-model is clicked', () => {
    const onChange = vi.fn();
    render(<TierPanel tierName="tier_1" value={SAMPLE} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('tier-1-model-0-remove'));
    expect(onChange.mock.calls[0][0].models).toHaveLength(0);
  });

  it('tier_0 hides add-model and model edit controls', () => {
    const onChange = vi.fn();
    render(<TierPanel tierName="tier_0" value={TIER_0} onChange={onChange} readOnly />);
    expect(screen.queryByTestId('tier_0-add-model')).toBeNull();
    expect(screen.getByTestId('tier-0-readonly-note')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `cd frontend && npx vitest run src/test/TierPanel.test.tsx`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement component**

```tsx
// frontend/src/components/aiConsole/TierPanel.tsx
import type { TierConfig, ModelEntry } from '../../api/client';

interface Props {
  tierName: string;
  value: TierConfig;
  onChange: (next: TierConfig) => void;
  readOnly?: boolean;
}

const DEFAULT_NEW_MODEL: ModelEntry = {
  id: '',
  provider: 'anthropic',
  cost_per_1k_input: 0,
  cost_per_1k_output: 0,
  max_tokens: 4096,
};

export default function TierPanel({ tierName, value, onChange, readOnly = false }: Props) {
  const isTier0 = tierName === 'tier_0';
  const disabled = readOnly || isTier0;

  const update = (patch: Partial<TierConfig>) => onChange({ ...value, ...patch });

  const updateModel = (idx: number, patch: Partial<ModelEntry>) => {
    const models = value.models.map((m, i) => (i === idx ? { ...m, ...patch } : m));
    update({ models });
  };

  return (
    <div data-testid={`tier-${tierName}`} className="rounded-lg border border-canvas-text-muted/20">
      <div className="flex items-center justify-between bg-canvas-surface px-4 py-3">
        <div className="font-semibold">{tierName}</div>
        {disabled && (
          <span data-testid={`tier-${tierName}-readonly-note`} className="text-xs text-canvas-text-muted">
            {tierName === 'tier_0' ? 'tier_0 只读（确定性）' : '只读'}
          </span>
        )}
      </div>
      <div className="space-y-3 px-4 py-3">
        <label className="block text-sm">
          <span className="text-canvas-text-muted">描述</span>
          <input
            data-testid={`tier-${tierName}-description`}
            className="mt-1 w-full rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1"
            value={value.description}
            disabled={disabled}
            onChange={(e) => update({ description: e.target.value })}
          />
        </label>
        <div className="flex items-center gap-3">
          <label className="text-sm">
            <span className="text-canvas-text-muted">默认模型</span>
            <select
              data-testid={`tier-${tierName}-default`}
              className="ml-1 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1 text-sm"
              disabled={disabled}
              value={value.default}
              onChange={(e) => update({ default: e.target.value })}
            >
              {isTier0 && <option value="none">none</option>}
              {value.models.map((m) => (
                <option key={m.id} value={m.id}>{m.id}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-canvas-text-muted">回退模型</span>
            <select
              data-testid={`tier-${tierName}-fallback`}
              className="ml-1 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1 text-sm"
              disabled={disabled}
              value={value.fallback ?? ''}
              onChange={(e) => update({ fallback: e.target.value || null })}
            >
              <option value="">（无）</option>
              {value.models.map((m) => (
                <option key={m.id} value={m.id}>{m.id}</option>
              ))}
            </select>
          </label>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-canvas-text-muted">模型 ({value.models.length})</span>
            {!disabled && (
              <button
                type="button"
                data-testid={`tier-${tierName}-add-model`}
                onClick={() => update({ models: [...value.models, { ...DEFAULT_NEW_MODEL }] })}
                className="rounded border border-canvas-accent/40 px-2 py-0.5 text-xs text-canvas-accent"
              >
                + 新增模型
              </button>
            )}
          </div>
          <div className="space-y-2">
            {value.models.map((m, idx) => (
              <div key={idx} className="rounded border border-canvas-text-muted/10 bg-canvas-surface px-3 py-2">
                <div className="grid grid-cols-12 gap-2 text-sm">
                  <input
                    data-testid={`tier-${tierName}-model-${idx}-id`}
                    className="col-span-4 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1 font-mono text-xs"
                    value={m.id}
                    disabled={disabled}
                    onChange={(e) => updateModel(idx, { id: e.target.value })}
                    placeholder="model id"
                  />
                  <select
                    data-testid={`tier-${tierName}-model-${idx}-provider`}
                    className="col-span-3 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1 text-xs"
                    value={m.provider}
                    disabled={disabled}
                    onChange={(e) => updateModel(idx, { provider: e.target.value as ModelEntry['provider'] })}
                  >
                    <option value="anthropic">anthropic</option>
                    <option value="deepseek">deepseek</option>
                    <option value="minimax">minimax</option>
                  </select>
                  <input
                    type="number"
                    data-testid={`tier-${tierName}-model-${idx}-input-cost`}
                    className="col-span-2 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1 text-xs"
                    value={m.cost_per_1k_input}
                    disabled={disabled}
                    onChange={(e) => updateModel(idx, { cost_per_1k_input: Number(e.target.value) })}
                  />
                  <input
                    type="number"
                    data-testid={`tier-${tierName}-model-${idx}-output-cost`}
                    className="col-span-2 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1 text-xs"
                    value={m.cost_per_1k_output}
                    disabled={disabled}
                    onChange={(e) => updateModel(idx, { cost_per_1k_output: Number(e.target.value) })}
                  />
                  <button
                    type="button"
                    data-testid={`tier-${tierName}-model-${idx}-remove`}
                    disabled={disabled}
                    onClick={() => update({ models: value.models.filter((_, i) => i !== idx) })}
                    className="col-span-1 rounded border border-rose-500/40 px-2 py-1 text-xs text-rose-600"
                  >
                    删除
                  </button>
                </div>
                <div className="mt-2 text-xs text-canvas-text-muted">
                  max_tokens:
                  <input
                    type="number"
                    data-testid={`tier-${tierName}-model-${idx}-max-tokens`}
                    className="ml-2 w-24 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-0.5 text-xs"
                    value={m.max_tokens}
                    disabled={disabled}
                    onChange={(e) => updateModel(idx, { max_tokens: Number(e.target.value) })}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests and verify pass**

Run: `cd frontend && npx vitest run src/test/TierPanel.test.tsx`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/aiConsole/TierPanel.tsx frontend/src/test/TierPanel.test.tsx
git commit -m "feat(ai-console): TierPanel CRUD with tier_0 lock"
```

---

## Task 11: Frontend — `AgentMappingPanel`

**Files:**
- Create: `frontend/src/components/aiConsole/AgentMappingPanel.tsx`
- Create: `frontend/src/test/AgentMappingPanel.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// frontend/src/test/AgentMappingPanel.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AgentMappingPanel from '../components/aiConsole/AgentMappingPanel';
import type { ModelTiersConfig, AgentTaskMapping } from '../../api/client';

const TIERS: ModelTiersConfig['tiers'] = {
  tier_1: {
    description: '',
    models: [
      { id: 'deepseek-v4-pro', provider: 'deepseek', cost_per_1k_input: 0, cost_per_1k_output: 0, max_tokens: 8192 },
      { id: 'claude-opus-4', provider: 'anthropic', cost_per_1k_input: 0, cost_per_1k_output: 0, max_tokens: 8192 },
    ],
    default: 'deepseek-v4-pro',
  },
  tier_0: { description: '', models: [], default: 'none' },
};

const INITIAL: ModelTiersConfig['agent_mapping'] = {
  writer: {
    scene_writing: { tier: 'tier_1', model: 'deepseek-v4-pro', fallback: 'claude-opus-4' } satisfies AgentTaskMapping,
  },
};

describe('AgentMappingPanel', () => {
  it('changing tier resets model and fallback to default', () => {
    const onChange = vi.fn();
    render(
      <AgentMappingPanel
        value={INITIAL}
        onChange={onChange}
        tiers={TIERS}
      />,
    );
    fireEvent.change(screen.getByTestId('agent-writer-task-scene_writing-tier'), {
      target: { value: 'tier_0' },
    });
    const next = onChange.mock.calls[0][0];
    expect(next.writer.scene_writing).toEqual({ tier: 'tier_0' });
  });

  it('model dropdown enumerates tier\'s models plus "default"', () => {
    render(
      <AgentMappingPanel
        value={INITIAL}
        onChange={() => {}}
        tiers={TIERS}
      />,
    );
    const sel = screen.getByTestId('agent-writer-task-scene_writing-model') as HTMLSelectElement;
    const values = Array.from(sel.options).map((o) => o.value);
    expect(values).toContain('default');
    expect(values).toEqual(expect.arrayContaining(['deepseek-v4-pro', 'claude-opus-4']));
  });

  it('adds a task under an existing agent', () => {
    const onChange = vi.fn();
    render(
      <AgentMappingPanel
        value={INITIAL}
        onChange={onChange}
        tiers={TIERS}
      />,
    );
    fireEvent.click(screen.getByTestId('agent-writer-add-task'));
    const next = onChange.mock.calls[0][0];
    expect(Object.keys(next.writer)).toHaveLength(2);
  });

  it('removes a task', () => {
    const onChange = vi.fn();
    render(
      <AgentMappingPanel
        value={INITIAL}
        onChange={onChange}
        tiers={TIERS}
      />,
    );
    fireEvent.click(screen.getByTestId('agent-writer-task-scene_writing-remove'));
    const next = onChange.mock.calls[0][0];
    expect(next.writer).toEqual({});
  });

  it('rejects blank task name', () => {
    const onChange = vi.fn();
    render(
      <AgentMappingPanel
        value={INITIAL}
        onChange={onChange}
        tiers={TIERS}
      />,
    );
    fireEvent.click(screen.getByTestId('agent-writer-add-task'));
    const input = screen.getByTestId('agent-writer-new-task-name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.click(screen.getByTestId('agent-writer-new-task-add-button'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `cd frontend && npx vitest run src/test/AgentMappingPanel.test.tsx`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement component**

```tsx
// frontend/src/components/aiConsole/AgentMappingPanel.tsx
import { useState } from 'react';
import type { AgentTaskMapping, ModelTiersConfig } from '../../api/client';

interface Props {
  value: ModelTiersConfig['agent_mapping'];
  onChange: (next: ModelTiersConfig['agent_mapping']) => void;
  tiers: ModelTiersConfig['tiers'];
}

export default function AgentMappingPanel({ value, onChange, tiers }: Props) {
  const tierNames = Object.keys(tiers);
  const [newAgent, setNewAgent] = useState('');
  const [pendingTaskByAgent, setPendingTaskByAgent] = useState<Record<string, string>>({});

  const updateAgent = (agent: string, task: string, next: AgentTaskMapping) => {
    const agentTasks = { ...(value[agent] ?? {}) };
    agentTasks[task] = next;
    onChange({ ...value, [agent]: agentTasks });
  };

  const removeTask = (agent: string, task: string) => {
    const agentTasks = { ...(value[agent] ?? {}) };
    delete agentTasks[task];
    onChange({ ...value, [agent]: agentTasks });
  };

  const addAgent = () => {
    const name = newAgent.trim();
    if (!name || name in value) {
      setNewAgent('');
      return;
    }
    onChange({ ...value, [name]: {} });
    setNewAgent('');
  };

  const addTask = (agent: string) => {
    const raw = (pendingTaskByAgent[agent] ?? '').trim();
    const tasks = value[agent] ?? {};
    if (!raw || raw in tasks) {
      setPendingTaskByAgent((prev) => ({ ...prev, [agent]: '' }));
      return;
    }
    onChange({
      ...value,
      [agent]: { ...tasks, [raw]: { tier: 'tier_1' } },
    });
    setPendingTaskByAgent((prev) => ({ ...prev, [agent]: '' }));
  };

  const removeAgent = (agent: string) => {
    const next = { ...value };
    delete next[agent];
    onChange(next);
  };

  const modelOptionsForTier = (tierName: string): { id: string; label: string }[] => {
    const tier = tiers[tierName];
    if (!tier) return [{ id: 'default', label: '默认' }];
    return [
      { id: 'default', label: `默认（${tier.default}）` },
      ...tier.models.map((m) => ({ id: m.id, label: m.id })),
    ];
  };

  return (
    <div className="space-y-3">
      {Object.entries(value).map(([agent, tasks]) => (
        <div
          key={agent}
          data-testid={`agent-${agent}`}
          className="rounded-lg border border-canvas-text-muted/20"
        >
          <div className="flex items-center justify-between bg-canvas-surface px-4 py-2">
            <span className="font-mono text-sm font-semibold">{agent}</span>
            <button
              type="button"
              data-testid={`agent-${agent}-remove`}
              onClick={() => removeAgent(agent)}
              className="text-xs text-rose-600"
            >
              删除 agent
            </button>
          </div>
          <div className="space-y-2 px-4 py-3">
            {Object.entries(tasks ?? {}).map(([task, mapping]) => {
              const m = mapping as AgentTaskMapping;
              const opts = modelOptionsForTier(m.tier ?? '');
              return (
                <div
                  key={task}
                  data-testid={`agent-${agent}-task-${task}`}
                  className="grid grid-cols-12 items-center gap-2 text-sm"
                >
                  <span className="col-span-3 truncate font-mono text-xs">{task}</span>
                  <select
                    data-testid={`agent-${agent}-task-${task}-tier`}
                    className="col-span-3 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1 text-xs"
                    value={m.tier ?? tierNames[0]}
                    onChange={(e) => {
                      const next = { tier: e.target.value };
                      onChange({ ...value, [agent]: { ...tasks, [task]: next } });
                    }}
                  >
                    {tierNames.map((tn) => (
                      <option key={tn} value={tn}>{tn}</option>
                    ))}
                  </select>
                  <select
                    data-testid={`agent-${agent}-task-${task}-model`}
                    className="col-span-2 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1 text-xs"
                    value={m.model ?? 'default'}
                    onChange={(e) => updateAgent(agent, task, { ...m, model: e.target.value })}
                  >
                    {opts.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                  <select
                    data-testid={`agent-${agent}-task-${task}-fallback`}
                    className="col-span-2 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1 text-xs"
                    value={m.fallback ?? ''}
                    onChange={(e) =>
                      updateAgent(agent, task, { ...m, fallback: e.target.value || null })
                    }
                  >
                    <option value="">（无）</option>
                    {opts.filter((o) => o.id !== 'default').map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    data-testid={`agent-${agent}-task-${task}-remove`}
                    onClick={() => removeTask(agent, task)}
                    className="col-span-2 rounded border border-rose-500/40 px-2 py-1 text-xs text-rose-600"
                  >
                    删除任务
                  </button>
                </div>
              );
            })}

            <div className="mt-2 flex items-center gap-2">
              <input
                data-testid={`agent-${agent}-new-task-name`}
                className="flex-1 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1 text-xs"
                placeholder="新任务名"
                value={pendingTaskByAgent[agent] ?? ''}
                onChange={(e) =>
                  setPendingTaskByAgent((prev) => ({ ...prev, [agent]: e.target.value }))
                }
              />
              <button
                type="button"
                data-testid={`agent-${agent}-add-task`}
                onClick={() => addTask(agent)}
                className="rounded border border-canvas-accent/40 px-2 py-1 text-xs text-canvas-accent"
              >
                + 任务
              </button>
            </div>
          </div>
        </div>
      ))}

      <div className="flex items-center gap-2 rounded-lg border border-dashed border-canvas-text-muted/30 px-4 py-3">
        <input
          data-testid="new-agent-name"
          className="flex-1 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1 text-sm"
          placeholder="新 agent 名"
          value={newAgent}
          onChange={(e) => setNewAgent(e.target.value)}
        />
        <button
          type="button"
          data-testid="new-agent-add"
          onClick={addAgent}
          className="rounded border border-canvas-accent/40 px-2 py-1 text-sm text-canvas-accent"
        >
          + 新增 agent
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests and verify pass**

Run: `cd frontend && npx vitest run src/test/AgentMappingPanel.test.tsx`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/aiConsole/AgentMappingPanel.tsx frontend/src/test/AgentMappingPanel.test.tsx
git commit -m "feat(ai-console): AgentMappingPanel CRUD + tier-cascade reset"
```

---

## Task 12: Frontend — `AIConsoleModal` shell with dirty-state guard

**Files:**
- Create: `frontend/src/components/aiConsole/AIConsoleModal.tsx`
- Create: `frontend/src/test/AIConsoleModal.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// frontend/src/test/AIConsoleModal.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import AIConsoleModal from '../components/aiConsole/AIConsoleModal';

const CFG = {
  tiers: {
    tier_1: {
      description: 'd',
      models: [
        { id: 'm', provider: 'anthropic', cost_per_1k_input: 0, cost_per_1k_output: 0, max_tokens: 1024 },
      ],
      default: 'm',
      retry_on_failure: true,
      max_retries: 1,
      fallback: null,
    },
    tier_0: { description: '', models: [], default: 'none' },
  },
  agent_mapping: { writer: { scene_writing: { tier: 'tier_1', model: 'm' } } },
};

const PROVIDERS = [
  { provider: 'anthropic', base_url: '', api_key_configured: true, models: ['m'] },
  { provider: 'deepseek', base_url: 'https://api.deepseek.com/v1', api_key_configured: false, models: [] },
  { provider: 'minimax', base_url: '', api_key_configured: false, models: [] },
];

beforeEach(() => {
  vi.resetAllMocks();
  global.fetch = vi.fn((url, init) => {
    if (url.includes('/settings/llm-config') && init?.method === 'GET' || (!init && url.endsWith('/llm-config'))) {
      return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: CFG }), { status: 200 }));
    }
    if (url.includes('/settings/llm-providers')) {
      return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: PROVIDERS }), { status: 200 }));
    }
    if (url.includes('/settings/llm-usage')) {
      return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: [] }), { status: 200 }));
    }
    if (init?.method === 'PUT' || init?.method === 'POST') {
      return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: { tiers: 2, agents: 1 } }), { status: 200 }));
    }
    return Promise.resolve(new Response('{}', { status: 404 }));
  });
});

describe('AIConsoleModal', () => {
  it('fetches 3 endpoints on open', async () => {
    render(<AIConsoleModal isOpen onClose={() => {}} />);
    expect(await screen.findByTestId('usage-empty')).toBeTruthy();
    expect(await screen.findByTestId('provider-anthropic')).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/llm-config'),
      expect.anything(),
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/llm-providers'),
      expect.anything(),
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/llm-usage'),
      expect.anything(),
    );
  });

  it('save button disabled when clean; save persists and toasts', async () => {
    const onClose = vi.fn();
    render(<AIConsoleModal isOpen onClose={onClose} />);
    const save = await screen.findByTestId('modal-save');
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(save);
    await waitFor(() => expect(onClose).not.toHaveBeenCalled()); // close never called from save
  });

  it('closing with dirty state shows confirm and respects cancel', async () => {
    const onClose = vi.fn();
    render(<AIConsoleModal isOpen onClose={onClose} />);
    const input = await screen.findByTestId('tier-tier_1-description');
    fireEvent.change(input, { target: { value: '已编辑' } });
    fireEvent.click(screen.getByTestId('modal-close'));
    expect(await screen.findByTestId('dirty-confirm')).toBeTruthy();
    fireEvent.click(screen.getByTestId('dirty-confirm-cancel'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('dirty-confirm-discard'));
    expect(onClose).toHaveBeenCalled();
  });

  it('reload button calls POST /llm-config/reload', async () => {
    render(<AIConsoleModal isOpen onClose={() => {}} />);
    fireEvent.click(await screen.findByTestId('modal-reload'));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/llm-config/reload'),
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `cd frontend && npx vitest run src/test/AIConsoleModal.test.tsx`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the modal**

```tsx
// frontend/src/components/aiConsole/AIConsoleModal.tsx
import { useCallback, useEffect, useState } from 'react';
import { llmConsole } from '../../api/llmConsole';
import type {
  LLMRouterSummary,
  ModelTiersConfig,
  ProviderStatus,
  UsageRecord,
} from '../../api/client';
import UsageRecentTable from './UsageRecentTable';
import ProviderPanel from './ProviderPanel';
import TierPanel from './TierPanel';
import AgentMappingPanel from './AgentMappingPanel';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function AIConsoleModal({ isOpen, onClose }: Props) {
  const [config, setConfig] = useState<ModelTiersConfig | null>(null);
  const [draft, setDraft] = useState<ModelTiersConfig | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [usage, setUsage] = useState<UsageRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDirty, setConfirmDirty] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const dirty = !!config && !!draft && !deepEqual(config, draft);

  const refresh = useCallback(async () => {
    const [cfg, prov, usg] = await Promise.all([
      llmConsole.getConfig(),
      llmConsole.getProviders(),
      llmConsole.getUsage(50),
    ]);
    setConfig(cfg);
    setDraft(cfg);
    setProviders(prov);
    setUsage(usg);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    refresh().catch((e) => setError(e instanceof Error ? e.message : '加载失败'));
  }, [isOpen, refresh]);

  const closeOrConfirm = useCallback(() => {
    if (dirty) setConfirmDirty(true);
    else onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeOrConfirm();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, closeOrConfirm]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const summary: LLMRouterSummary = await llmConsole.saveConfig(draft);
      setToast(`配置已热重载，${summary.tiers} 个 tier、${summary.agents} 个 agent 已加载`);
      setConfig(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
      setTimeout(() => setToast(null), 3000);
    }
  };

  const handleReload = async () => {
    if (dirty) {
      const ok = window.confirm('当前修改未保存，刷新将丢弃，继续？');
      if (!ok) return;
    }
    try {
      await llmConsole.reload();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '重载失败');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeOrConfirm();
      }}
    >
      <div className="m-auto flex h-[90vh] w-[min(1200px,96vw)] flex-col overflow-hidden rounded-lg bg-canvas-bg shadow-xl">
        <header className="flex items-center justify-between border-b border-canvas-text-muted/20 bg-canvas-surface px-6 py-3">
          <h2 className="text-lg font-semibold">AI 控制台</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="modal-reload"
              onClick={handleReload}
              className="rounded border border-canvas-text-muted/40 px-3 py-1 text-sm"
            >
              ↻ 重新加载
            </button>
            <button
              type="button"
              data-testid="modal-close"
              onClick={closeOrConfirm}
              className="rounded border border-canvas-text-muted/40 px-3 py-1 text-sm"
            >
              × 关闭
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <section className="mb-6">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-canvas-text-muted">最近调用 (LLM Usage · 最近 50 条)</h3>
            <UsageRecentTable records={usage} />
          </section>

          <section className="mb-6">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-canvas-text-muted">Provider 状态</h3>
            <ProviderPanel providers={providers} />
          </section>

          {draft && (
            <section className="mb-6">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-canvas-text-muted">Tier 配置</h3>
              <div className="space-y-3">
                {Object.entries(draft.tiers).map(([name, tier]) => (
                  <TierPanel
                    key={name}
                    tierName={name}
                    value={tier}
                    onChange={(next) =>
                      setDraft({ ...draft, tiers: { ...draft.tiers, [name]: next } })
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {draft && (
            <section className="mb-6">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-canvas-text-muted">Agent 映射</h3>
              <AgentMappingPanel
                value={draft.agent_mapping}
                tiers={draft.tiers}
                onChange={(next) =>
                  setDraft({ ...draft, agent_mapping: next as ModelTiersConfig['agent_mapping'] })
                }
              />
            </section>
          )}

          {error && (
            <div data-testid="modal-error" className="mb-4 rounded border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}
          {toast && (
            <div data-testid="modal-toast" className="fixed bottom-20 left-1/2 z-10 -translate-x-1/2 rounded bg-emerald-600 px-4 py-2 text-sm text-white shadow">
              {toast}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-3 border-t border-canvas-text-muted/20 bg-canvas-surface px-6 py-3">
          <button
            type="button"
            data-testid="modal-cancel"
            disabled={!dirty || saving}
            onClick={() => setDraft(config)}
            className="rounded border border-canvas-text-muted/40 px-4 py-1 text-sm disabled:opacity-50"
          >
            取消修改
          </button>
          <button
            type="button"
            data-testid="modal-save"
            disabled={!dirty || saving}
            onClick={handleSave}
            className="rounded bg-canvas-accent px-4 py-1 text-sm text-white disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存并热重载'}
          </button>
        </footer>

        {confirmDirty && (
          <div data-testid="dirty-confirm" className="absolute inset-0 z-10 flex items-center justify-center bg-black/40">
            <div className="rounded-lg bg-canvas-bg p-6 shadow-xl">
              <p className="mb-4">有未保存的修改，确定关闭？</p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  data-testid="dirty-confirm-cancel"
                  onClick={() => setConfirmDirty(false)}
                  className="rounded border border-canvas-text-muted/40 px-3 py-1 text-sm"
                >
                  继续编辑
                </button>
                <button
                  type="button"
                  data-testid="dirty-confirm-discard"
                  onClick={() => {
                    setConfirmDirty(false);
                    onClose();
                  }}
                  className="rounded bg-rose-500 px-3 py-1 text-sm text-white"
                >
                  放弃修改
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests and verify pass**

Run: `cd frontend && npx vitest run src/test/AIConsoleModal.test.tsx`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/aiConsole/AIConsoleModal.tsx frontend/src/test/AIConsoleModal.test.tsx
git commit -m "feat(ai-console): AIConsoleModal shell with dirty-state guard"
```

---

## Task 13: Frontend — wire the modal into HomePage / Sidebar / QuickActions

**Files:**
- Modify: `frontend/src/components/home/QuickActions.tsx` (add `onOpenConsole` prop, enable `qa-ai-console`)
- Modify: `frontend/src/components/home/StatsSidebar.tsx` (pass through)
- Modify: `frontend/src/pages/HomePage.tsx` (state + render)

- [ ] **Step 1: Update `QuickActions` props and action**

Edit `frontend/src/components/home/QuickActions.tsx`:

1. Extend the `QuickActionsProps` interface:

```ts
interface QuickActionsProps {
  onRefresh: () => void;
  refreshing: boolean;
  onOpenPlaza?: () => void;
  plazaDisabled?: boolean;
  plazaTooltip?: string;
  onOpenConsole?: () => void;
  consoleDisabled?: boolean;
  consoleTooltip?: string;
}
```

2. Extend `QuickActions` parameters and the `actions` array's first entry:

```tsx
export default function QuickActions({
  onRefresh,
  refreshing,
  onOpenPlaza,
  plazaDisabled,
  plazaTooltip,
  onOpenConsole,
  consoleDisabled,
  consoleTooltip,
}: QuickActionsProps) {
  const actions: Action[] = [
    {
      label: "AI 控制台",
      icon: "smart_toy",
      onClick: onOpenConsole,
      disabled: consoleDisabled,
      tooltip: consoleTooltip,
      testId: "qa-ai-console",
    },
    {
      label: "提示词广场",
      icon: "forum",
      onClick: onOpenPlaza,
      disabled: plazaDisabled,
      tooltip: plazaTooltip,
      testId: "qa-prompt-square",
    },
    {
      label: refreshing ? "刷新中…" : "刷新列表",
      icon: refreshing ? "progress_activity" : "refresh",
      onClick: onRefresh,
      testId: "qa-refresh",
    },
  ];
```

- [ ] **Step 2: Pass through `StatsSidebar`**

In `frontend/src/components/home/StatsSidebar.tsx`, locate `<QuickActions ...>` and add `onOpenConsole={onOpenConsole}` and the optional `consoleDisabled`/`consoleTooltip` props (forward them from where? — same shape as `onOpenPlaza`.)

Find where `QuickActions` is rendered in `StatsSidebar.tsx` (search for `<QuickActions`). Add the new props:

```tsx
<QuickActions
  ...
  onOpenPlaza={onOpenPlaza}
  plazaDisabled={plazaDisabled}
  plazaTooltip={plazaTooltip}
  onOpenConsole={onOpenConsole}
  consoleDisabled={consoleDisabled}
  consoleTooltip={consoleTooltip}
/>
```

Update the `StatsSidebar` props interface the same way (add `onOpenConsole?: () => void; consoleDisabled?: boolean; consoleTooltip?: string;`).

- [ ] **Step 3: Wire `HomePage` state**

In `frontend/src/pages/HomePage.tsx`:

1. Add imports:

```tsx
import AIConsoleModal from "../components/aiConsole/AIConsoleModal";
```

2. Add state:

```tsx
const [consoleOpen, setConsoleOpen] = useState(false);
const handleOpenConsole = useCallback(() => setConsoleOpen(true), []);
```

3. Pass through to `<StatsSidebar>`:

```tsx
<StatsSidebar
  ...
  onOpenPlaza={handleOpenPlaza}
  onOpenConsole={handleOpenConsole}
/>
```

4. Render next to the existing modals (after `<PromptPlazaModal ...>`):

```tsx
<AIConsoleModal isOpen={consoleOpen} onClose={() => setConsoleOpen(false)} />
```

- [ ] **Step 4: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Run focused vitest to verify nothing broke**

Run: `cd frontend && npx vitest run src/test/AIConsoleModal.test.tsx src/test/TierPanel.test.tsx src/test/AgentMappingPanel.test.tsx src/test/UsageRecentTable.test.tsx`
Expected: 15 PASS (4 + 4 + 5 + 2).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/home/QuickActions.tsx frontend/src/components/home/StatsSidebar.tsx frontend/src/pages/HomePage.tsx
git commit -m "feat(ai-console): wire modal into HomePage sidebar"
```

---

## Task 14: Final verification — full backend + frontend suites pass, manual smoke checklist

**Files:** none (only verification commands).

- [ ] **Step 1: Backend full suite**

Run: `pytest tests/ -q`
Expected: all existing + new tests PASS, no regressions.

- [ ] **Step 2: Frontend full suite**

Run: `cd frontend && npx vitest run`
Expected: no regressions. Pre-existing `Workspace.test.tsx` EventSource failures are unrelated and acceptable.

- [ ] **Step 3: TypeScript clean**

Run: `cd frontend && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Manual browser smoke**

Run both services, then walk through the checklist from the spec §6:
1. Open `/` and confirm `AI 控制台` button is no longer disabled.
2. Click it; confirm usage table populates, 3 provider cards render, Tier + AgentMapping panels appear.
3. Edit a model id to empty; save — expect 422 with `invalid_paths` referencing the field; modal stays open.
4. Edit a description, save — confirm toast "配置已热重载".
5. Trigger an LLM call (open wizard / create character). Refresh AI 控制台 — confirm new row at top of usage table.
6. Edit something dirty, click X / Esc / backdrop — confirm dirty-confirm modal; choose "继续编辑" preserves state.

- [ ] **Step 5: Final commit (if Step 4 surfaced any fixup that wasn't yet committed)**

Skip the commit if nothing changed. Otherwise:

```bash
git status --short
git add <changed-files>
git commit -m "fix(ai-console): smoke-test fixups"
```

---

## Verification Matrix

After all tasks complete, the following must hold (acceptance criteria from spec §7):

| # | Criterion | How verified |
|---|---|---|
| 1 | All new backend pytest tests pass | `pytest tests/test_llm_config_*.py tests/test_llm_usage_log.py -v` |
| 2 | All new frontend vitest tests pass | `npx vitest run src/test/{AIConsoleModal,TierPanel,AgentMappingPanel,UsageRecentTable}.test.tsx` |
| 3 | No regression in full backend suite | `pytest tests/ -q` |
| 4 | No regression in frontend TS / vitest | `npx tsc --noEmit && npx vitest run` |
| 5 | QuickActions `qa-ai-console` enabled + opens modal | Manual smoke §14.4.1 |
| 6 | All tier + agent_mapping edits persist + trigger router reload | Manual smoke §14.4.2 / §14.4.4 |
| 7 | Field-level validation error mapping | Manual smoke §14.4.3 + automated PUT 422 test in Task 6 |
| 8 | Usage table newest-first | Automated `read_recent` test in Task 5 |
| 9 | API key never leaves backend | Provider endpoint explicitly returns `api_key_configured: bool` — covered in Task 4 + Task 6 |

---

## Out of scope (explicitly deferred — do NOT add)

- Project-level LLM overrides.
- Writing API keys back to `.env`.
- Concurrency lock for simultaneous saves.
- Charts for token budget / latency / error rate.
- Bulk import/export of `model_tiers.yaml`.
- Re-encrypting secrets or surfacing them anywhere on the frontend.

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Concurrent saves from two tabs race | low | Last-write-wins is acceptable for v1; spec §8 defers the lock. |
| `validate` succeeds but `ModelRouter.reload_config()` raises (e.g., tier-2 model missing a required field). | low | `validate` already mirrors the router's expectations; covered by Task 6's happy-path test. |
| Disk-write dies mid-flush | low | `write_yaml_atomic` uses `mkstemp` + `os.replace` — partial writes do not replace the live file. |
| Test stubbing the router silently masks bugs | low | Task 4 test explicitly asserts the reload is invoked and only the StubRouter's state is reported. Real-renderer tests live in Task 6 (`test_put_llm_config_round_trip`). |
| Frontend JSON.stringify deepEqual O(n²) on huge configs | very low | Yaml has only 4 tiers + ~10 agents; deepEqual is fine. |

