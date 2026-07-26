# AI 控制台 · Provider & Model 重组 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move model metadata out of `tiers` and into a new top-level `providers` block; expose provider / model CRUD in the AI Console; support writing API keys to `backend/.env` with hot-reload; auto-migrate the legacy `model_tiers.yaml` on first read.

**Architecture:** Extend `backend.services.llm_config` with a new Pydantic-validated `providers` schema, `find_references` / `validate_removal` for deletion conflicts, an atomic env writer, and a one-shot `migrate_legacy_yaml`. Extend `ModelRouter` to load `_providers` alongside tiers and dispatch by `provider.type` (anthropic / openai_compatible / mock). Add a new `OpenAICompatibleProvider` and `MockProvider`. Expose new endpoints on `llm_config_api`. Frontend `ProviderPanel` becomes full CRUD; `TierPanel` becomes a whitelist picker from the provider catalog.

**Tech Stack:** FastAPI + Pydantic v2, openai SDK, anthropic SDK; React 18 + Tailwind; existing `react-router-dom` v6.

**Working directory:** `/Users/longsa/Codes/storyForge2` (do NOT create a worktree — see feedback memory `feedback_worktree_v19.md`).

---

## File Structure

### Backend

| File | Responsibility |
| --- | --- |
| `backend/services/llm_config.py` (modify) | YAML read/write, validation, providers schema, `find_references`, `validate_removal`, env atomic write, `migrate_legacy_yaml`. |
| `backend/llm/errors.py` (new) | `ModelNotFoundError` exception. |
| `backend/llm/openai_compatible_provider.py` (new) | Generic OpenAI-compatible provider (uses `openai.AsyncOpenAI` with explicit `base_url`). |
| `backend/llm/mock_provider.py` (new) | Returns fixed text without network calls. |
| `backend/llm/model_router.py` (modify) | Load `_providers`, dispatch `_create_provider_for_model` by `type`, load builtin providers + tiers. |
| `backend/config.py` (modify) | Add `provider_<id>_api_key` fields for anthropic / deepseek / minimax (back-compat). |
| `backend/api/llm_config_api.py` (modify) | Add provider / model CRUD + API key + migrate endpoints. |
| `config/model_tiers.yaml` (modify) | Replace with new schema; preserve existing data. |

### Frontend

| File | Responsibility |
| --- | --- |
| `frontend/src/api/client.ts` (modify) | Add `ProvidersConfig` / `ProviderEntry` / extended `ModelEntry`; add new endpoint wrappers. |
| `frontend/src/api/llmConsole.ts` (modify) | Re-export new methods + types. |
| `frontend/src/components/aiConsole/ProviderPanel.tsx` (rewrite) | Full CRUD for providers and models, API Key modal, delete-conflict toast. |
| `frontend/src/components/aiConsole/TierPanel.tsx` (modify) | Tier `models` becomes a whitelist picker from providers; remove per-model cost/max_tokens inputs. |
| `frontend/src/components/aiConsole/AgentMappingPanel.tsx` (modify) | `modelOptionsForTier` derives from `tier.models` whitelist (already does). |
| `frontend/src/components/aiConsole/AIConsoleModal.tsx` (modify) | Show migrate prompt when YAML lacks `providers`; pass new catalog to ProviderPanel. |

### Tests

| File | Responsibility |
| --- | --- |
| `tests/test_llm_config_service.py` (modify) | New validation, find/validate-removal, migrate cases. |
| `tests/test_llm_config_api.py` (modify) | New endpoint cases. |
| `tests/test_model_router.py` (new) | `_providers` load + MockProvider dispatch. |
| `frontend/src/test/ProviderPanel.test.tsx` (rewrite) | CRUD + delete-conflict + API Key modal + migrate prompt. |
| `frontend/src/test/TierPanel.test.tsx` (modify) | Whitelist picker, tier_0 unchanged. |
| `frontend/src/test/AgentMappingPanel.test.tsx` (modify) | Verify dropdown reflects whitelist. |
| `frontend/src/test/AIConsoleModal.test.tsx` (modify) | Migrate prompt; provider-panel change triggers dirty. |

---

## Task 1: Add `ModelNotFoundError` and extend `errors.py`

**Files:**
- Create: `backend/llm/errors.py`

- [ ] **Step 1: Create the module**

```python
# backend/llm/errors.py
"""Custom exceptions raised by the LLM routing layer."""


class ModelNotFoundError(LookupError):
    """Raised when a model id is referenced but not present in any provider
    catalog. Carries the model id for the caller to surface in error messages
    and the usage log."""

    def __init__(self, model_id: str):
        super().__init__(f"model '{model_id}' is not defined in any provider")
        self.model_id = model_id
```

- [ ] **Step 2: Commit**

```bash
git add backend/llm/errors.py
git commit -m "feat(llm): add ModelNotFoundError"
```

---

## Task 2: Add `OpenAICompatibleProvider`

**Files:**
- Create: `backend/llm/openai_compatible_provider.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_openai_compatible_provider.py
import pytest
from backend.llm.base_provider import LLMConfig
from backend.llm.openai_compatible_provider import OpenAICompatibleProvider


@pytest.fixture
def cfg():
    return LLMConfig(
        provider="custom",
        model="x",
        api_key="k",
        base_url="https://example.com/v1",
        max_tokens=10,
    )


@pytest.mark.asyncio
async def test_init_uses_explicit_base_url(cfg):
    p = OpenAICompatibleProvider(cfg)
    assert str(p.client.base_url).rstrip("/") == "https://example.com/v1"


@pytest.mark.asyncio
async def test_init_raises_when_base_url_missing():
    bad = LLMConfig(provider="custom", model="x", api_key="k", base_url=None)
    with pytest.raises(ValueError):
        OpenAICompatibleProvider(bad)


@pytest.mark.asyncio
async def test_supports_json_mode(cfg):
    assert OpenAICompatibleProvider(cfg).supports_json_mode() is True
```

- [ ] **Step 2: Run to confirm failure**

Run: `pytest tests/test_openai_compatible_provider.py -v`
Expected: `ModuleNotFoundError: No module named 'backend.llm.openai_compatible_provider'`.

- [ ] **Step 3: Implement the provider**

```python
# backend/llm/openai_compatible_provider.py
from typing import AsyncIterator

from openai import AsyncOpenAI
from backend.llm.base_provider import BaseLLMProvider, LLMConfig, LLMResponse, StreamChunk


class OpenAICompatibleProvider(BaseLLMProvider):
    """Generic OpenAI-compatible provider.

    Used when a `providers.*` entry has `type=openai_compatible` and an explicit
    `base_url`. No fallback default URL — the operator MUST configure one.
    """

    def __init__(self, config: LLMConfig):
        if not config.base_url:
            raise ValueError(
                "OpenAICompatibleProvider requires a non-empty base_url"
            )
        super().__init__(config)
        self.client = AsyncOpenAI(api_key=self.api_key, base_url=config.base_url)

    async def generate(
        self, system_prompt: str, user_prompt: str, **kwargs
    ) -> LLMResponse:
        max_tokens = kwargs.get("max_tokens", self.default_max_tokens)
        temperature = kwargs.get("temperature", self.default_temperature)
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        extra = {}
        if kwargs.get("json_mode"):
            extra["response_format"] = {"type": "json_object"}
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
            **extra,
        )
        choice = response.choices[0]
        return LLMResponse(
            text=choice.message.content or "",
            tokens_in=response.usage.prompt_tokens if response.usage else 0,
            tokens_out=response.usage.completion_tokens if response.usage else 0,
            model=self.model,
            provider="openai_compatible",
            finish_reason=choice.finish_reason or "stop",
        )

    async def generate_stream(
        self, system_prompt: str, user_prompt: str, **kwargs
    ) -> AsyncIterator[StreamChunk]:
        max_tokens = kwargs.get("max_tokens", self.default_max_tokens)
        temperature = kwargs.get("temperature", self.default_temperature)
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        stream = await self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            stream=True,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content or ""
            if delta:
                yield StreamChunk(text=delta)
            if chunk.choices[0].finish_reason:
                yield StreamChunk(text="", finish_reason=chunk.choices[0].finish_reason)
                return

    def supports_json_mode(self) -> bool:
        return True
```

- [ ] **Step 4: Run the tests**

Run: `pytest tests/test_openai_compatible_provider.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/llm/openai_compatible_provider.py tests/test_openai_compatible_provider.py
git commit -m "feat(llm): add generic OpenAICompatibleProvider"
```

---

## Task 3: Add `MockProvider`

**Files:**
- Create: `backend/llm/mock_provider.py`
- Create: `tests/test_mock_provider.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_mock_provider.py
import pytest
from backend.llm.base_provider import LLMConfig
from backend.llm.mock_provider import MockProvider


@pytest.fixture
def cfg():
    return LLMConfig(provider="mock", model="mock-m", api_key="k")


@pytest.mark.asyncio
async def test_generate_returns_fixed_text(cfg):
    p = MockProvider(cfg, text="hello world")
    resp = await p.generate("sys", "user")
    assert resp.text == "hello world"
    assert resp.model == "mock-m"
    assert resp.provider == "mock"


@pytest.mark.asyncio
async def test_supports_json_mode(cfg):
    assert MockProvider(cfg).supports_json_mode() is False


@pytest.mark.asyncio
async def test_generate_stream_emits_one_chunk_then_finish(cfg):
    p = MockProvider(cfg, text="payload")
    chunks = []
    async for c in p.generate_stream("sys", "user"):
        chunks.append(c)
    assert chunks[0].text == "payload"
    assert chunks[-1].finish_reason == "stop"
```

- [ ] **Step 2: Run to confirm failure**

Run: `pytest tests/test_mock_provider.py -v`
Expected: `ModuleNotFoundError: No module named 'backend.llm.mock_provider'`.

- [ ] **Step 3: Implement the provider**

```python
# backend/llm/mock_provider.py
from typing import AsyncIterator

from backend.llm.base_provider import BaseLLMProvider, LLMConfig, LLMResponse, StreamChunk


class MockProvider(BaseLLMProvider):
    """Returns a fixed string without any network call.

    Used by tests (and by an opt-in `type=mock` provider entry) to keep the
    LLM call path deterministic.
    """

    def __init__(self, config: LLMConfig, text: str = "(mock response)"):
        super().__init__(config)
        self._text = text

    async def generate(
        self, system_prompt: str, user_prompt: str, **kwargs
    ) -> LLMResponse:
        return LLMResponse(
            text=self._text,
            tokens_in=0,
            tokens_out=0,
            model=self.model,
            provider="mock",
            finish_reason="stop",
        )

    async def generate_stream(
        self, system_prompt: str, user_prompt: str, **kwargs
    ) -> AsyncIterator[StreamChunk]:
        yield StreamChunk(text=self._text)
        yield StreamChunk(text="", finish_reason="stop")

    def supports_json_mode(self) -> bool:
        return False
```

- [ ] **Step 4: Run the tests**

Run: `pytest tests/test_mock_provider.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/llm/mock_provider.py tests/test_mock_provider.py
git commit -m "feat(llm): add MockProvider for deterministic testing"
```

---

## Task 4: Migrate legacy YAML — service helpers (atomic env writer + schema data class)

**Files:**
- Modify: `backend/services/llm_config.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_llm_config_env_writer.py
from pathlib import Path

import pytest

from backend.services.llm_config import write_env_atomic


@pytest.fixture
def env_path(tmp_path):
    p = tmp_path / ".env"
    p.write_text("A=1\nB=two\n# comment\nC=3\n", encoding="utf-8")
    return p


def test_write_env_atomic_updates_existing_key(env_path):
    write_env_atomic(env_path, {"B": "two-new"})
    text = env_path.read_text(encoding="utf-8")
    lines = text.splitlines()
    assert lines[0] == "A=1"
    assert lines[1] == "B=two-new"
    assert lines[2] == "# comment"
    assert lines[3] == "C=3"


def test_write_env_atomic_appends_new_key(env_path):
    write_env_atomic(env_path, {"D": "four"})
    text = env_path.read_text(encoding="utf-8")
    assert text.endswith("D=four\n")


def test_write_env_atomic_cleans_tmp_on_failure(env_path, monkeypatch):
    from backend.services import llm_config as mod
    monkeypatch.setattr(mod, "_env_replace", lambda _src, _dst: (_ for _ in ()).throw(RuntimeError("boom")))
    with pytest.raises(RuntimeError):
        write_env_atomic(env_path, {"B": "x"})
    leftover = [p.name for p in env_path.parent.glob(".env.*.tmp")]
    assert leftover == []


def test_write_env_atomic_quotes_value_with_spaces(env_path):
    write_env_atomic(env_path, {"E": "has space"})
    text = env_path.read_text(encoding="utf-8")
    assert 'E="has space"' in text
```

- [ ] **Step 2: Run to confirm failure**

Run: `pytest tests/test_llm_config_env_writer.py -v`
Expected: `AttributeError: module 'backend.services.llm_config' has no attribute 'write_env_atomic'`.

- [ ] **Step 3: Implement `write_env_atomic`**

Add at the top of `backend/services/llm_config.py`:

```python
import re
```

Add (between `write_yaml_atomic` and `validate`):

```python
_ENV_LINE_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$")


def _env_replace(src: str, dst: Path) -> None:
    """Wrapper around os.replace to allow monkeypatching in tests."""
    os.replace(src, dst)


def _parse_env(text: str) -> tuple[list[str], dict[str, str]]:
    """Return (raw_lines, key->value). Lines that are not assignments are kept
    verbatim in raw_lines so comments and blanks survive untouched."""
    raw = text.splitlines(keepends=False) if text else []
    values: dict[str, str] = {}
    for line in raw:
        stripped = line.lstrip()
        if not stripped or stripped.startswith("#"):
            continue
        match = _ENV_LINE_RE.match(line)
        if match:
            values[match.group(1)] = match.group(2)
    return raw, values


def _format_env_value(value: str) -> str:
    if any(ch.isspace() for ch in value) or any(ch in value for ch in ['"', "'", "#"]):
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return value


def write_env_atomic(env_path: Path, updates: dict[str, str]) -> None:
    """Atomic update of a `.env` file. Preserves key order, comments, and
    blank lines. Adds new keys at the end (after a blank line if missing).
    """
    env_path.parent.mkdir(parents=True, exist_ok=True)
    text = env_path.read_text(encoding="utf-8") if env_path.exists() else ""
    raw, existing = _parse_env(text)

    new_raw: list[str] = []
    seen_keys: set[str] = set()
    for line in raw:
        stripped = line.lstrip()
        if not stripped or stripped.startswith("#"):
            new_raw.append(line)
            continue
        match = _ENV_LINE_RE.match(line)
        if not match:
            new_raw.append(line)
            continue
        key = match.group(1)
        if key in updates:
            new_raw.append(f"{key}={_format_env_value(updates[key])}")
            seen_keys.add(key)
        else:
            new_raw.append(line)

    appended = False
    for key, value in updates.items():
        if key in seen_keys:
            continue
        if not appended and new_raw and new_raw[-1].strip() != "":
            new_raw.append("")
            appended = True
        elif not new_raw:
            appended = True
        new_raw.append(f"{key}={_format_env_value(value)}")

    payload = "\n".join(new_raw) + "\n"

    fd, tmp_name = tempfile.mkstemp(
        dir=env_path.parent,
        prefix=".env.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(payload)
        _env_replace(tmp_name, env_path)
    except Exception:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)
        raise
```

- [ ] **Step 4: Run the tests**

Run: `pytest tests/test_llm_config_env_writer.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/llm_config.py tests/test_llm_config_env_writer.py
git commit -m "feat(llm-config): atomic .env writer preserving comments/order"
```

---

## Task 5: Add provider schema and validation for the new schema

**Files:**
- Modify: `backend/services/llm_config.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_llm_config_providers.py
from copy import deepcopy

import pytest

from backend.services.llm_config import LLMConfigError, validate


def base_v2():
    """Canonical v2 fixture. Exported as a module-level helper so other test
    files in this package can `from .test_llm_config_providers import base_v2`
    by importing the symbol explicitly (see note in test_llm_config_find_references)."""
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
                "models": ["deepseek-v4-pro", "claude-opus-4"],
                "retry_on_failure": True,
                "max_retries": 1,
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
            "writer": {
                "scene_writing": {"tier": "tier_1", "model": "deepseek-v4-pro"},
            }
        },
    }


def test_validate_accepts_v2_schema():
    validate(base_v2())


def test_validate_rejects_unknown_model_in_tier_default():
    bad = deepcopy(base_v2())
    bad["tiers"]["tier_1"]["default"] = "ghost-model"
    with pytest.raises(LLMConfigError) as exc:
        validate(bad)
    assert any(p.endswith("tier_1.default") for p in exc.value.invalid_paths)


def test_validate_rejects_unknown_model_in_tier_whitelist():
    bad = deepcopy(base_v2())
    bad["tiers"]["tier_1"]["models"].append("ghost-model")
    with pytest.raises(LLMConfigError) as exc:
        validate(bad)
    assert any(p.startswith("tiers.tier_1.models") for p in exc.value.invalid_paths)


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
```

- [ ] **Step 2: Run to confirm failure**

Run: `pytest tests/test_llm_config_providers.py -v`
Expected: FAIL with `LLMConfigError` because the existing validator does not know about `providers`.

- [ ] **Step 3: Extend `validate()` to understand the new schema**

Replace the body of `validate()` in `backend/services/llm_config.py` with the version below. (Keep the helper functions used below at module scope.)

```python
ALLOWED_PROVIDER_TYPES = {"anthropic", "openai_compatible", "mock"}


def _collect_global_models(data: dict) -> dict[str, str]:
    """Map model id -> provider key for every provider's models dict."""
    out: dict[str, str] = {}
    providers = data.get("providers") or {}
    if not isinstance(providers, dict):
        return out
    for pid, provider in providers.items():
        if not isinstance(provider, dict):
            continue
        models = provider.get("models") or {}
        if not isinstance(models, dict):
            continue
        for mid in models:
            out[mid] = pid
    return out


def validate(data: dict) -> None:
    """Validate a config dict. Raises LLMConfigError with `invalid_paths`
    on failure. Path format: dotted, e.g.
    `tiers.tier_1.models.0.id`, `providers.anthropic.models.claude-opus-4`.
    """
    if not isinstance(data, dict):
        raise LLMConfigError("配置根节点必须是对象", ["$"])

    invalid: list[str] = []

    providers = data.get("providers") or {}
    if not isinstance(providers, dict):
        raise LLMConfigError("providers 必须是对象", ["providers"])

    global_models = _collect_global_models(data)
    seen_ids: set[str] = set()
    for pid, provider in providers.items():
        path = f"providers.{pid}"
        if not isinstance(provider, dict):
            invalid.append(path)
            continue
        ptype = provider.get("type")
        if ptype not in ALLOWED_PROVIDER_TYPES:
            invalid.append(f"{path}.type")
        if not provider.get("api_key_env"):
            invalid.append(f"{path}.api_key_env")
        base_url = provider.get("base_url")
        if ptype == "openai_compatible" and not base_url:
            invalid.append(f"{path}.base_url")
        models = provider.get("models") or {}
        if not isinstance(models, dict):
            invalid.append(f"{path}.models")
            continue
        for mid, model in models.items():
            mpath = f"{path}.models.{mid}"
            if not isinstance(model, dict):
                invalid.append(mpath)
                continue
            if mid in seen_ids:
                invalid.append(f"providers.{pid}.models[duplicate_id={mid}]")
            seen_ids.add(mid)
            max_tokens = model.get("max_tokens")
            if (
                not isinstance(max_tokens, int)
                or isinstance(max_tokens, bool)
            ):
                invalid.append(f"{mpath}.max_tokens")
            cost_in = model.get("cost_per_1k_input")
            cost_out = model.get("cost_per_1k_output")
            if not isinstance(cost_in, (int, float)) or isinstance(cost_in, bool):
                invalid.append(f"{mpath}.cost_per_1k_input")
            if not isinstance(cost_out, (int, float)) or isinstance(cost_out, bool):
                invalid.append(f"{mpath}.cost_per_1k_output")
            temperature = model.get("temperature")
            if not isinstance(temperature, (int, float)) or isinstance(temperature, bool):
                invalid.append(f"{mpath}.temperature")

    tiers = data.get("tiers") or {}
    if not isinstance(tiers, dict):
        raise LLMConfigError("tiers 必须是对象", ["tiers"])

    known_tier_names = set(tiers.keys())
    if "tier_0" not in known_tier_names:
        invalid.append("tier_0")

    for tier_name, tier in tiers.items():
        if not tier_name.strip() or not isinstance(tier, dict):
            invalid.append(f"tiers.{tier_name or '<empty>'}")
            continue
        if tier_name == "tier_0":
            if tier.get("models") or tier.get("default") != "none":
                invalid.append("tiers.tier_0")
            continue

        whitelisted = tier.get("models") or []
        if not isinstance(whitelisted, list) or not whitelisted:
            invalid.append(f"tiers.{tier_name}.models")
            whitelisted = []
        for i, mid in enumerate(whitelisted):
            if not isinstance(mid, str) or mid not in global_models:
                invalid.append(f"tiers.{tier_name}.models.{i}")

        default = tier.get("default")
        if default and default != "none" and default not in global_models:
            invalid.append(f"tiers.{tier_name}.default")
        elif default and default != "none" and default not in whitelisted:
            invalid.append(f"tiers.{tier_name}.default")
        fallback = tier.get("fallback")
        if fallback and fallback not in global_models:
            invalid.append(f"tiers.{tier_name}.fallback")
        elif fallback and fallback not in whitelisted:
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
            if model_id and model_id != "default" and model_id not in global_models:
                invalid.append(f"agent_mapping.{agent_name}.{task_name}.model")
            elif model_id and model_id != "default" and model_id not in tier_models:
                invalid.append(f"agent_mapping.{agent_name}.{task_name}.model")
            fallback = mapping.get("fallback")
            if fallback and fallback != "default" and fallback not in global_models:
                invalid.append(f"agent_mapping.{agent_name}.{task_name}.fallback")
            elif fallback and fallback != "default" and fallback not in tier_models:
                invalid.append(f"agent_mapping.{agent_name}.{task_name}.fallback")

    if invalid:
        raise LLMConfigError(
            f"配置校验失败：{len(invalid)} 项错误", invalid
        )
```

- [ ] **Step 4: Update `test_validate_happy_path_against_real_config`**

The real `config/model_tiers.yaml` does not yet match the v2 schema. Update the test to call `validate` against the in-memory v2 fixture so it still passes:

```python
# tests/test_llm_config_service.py (modify existing test)
def test_validate_happy_path_against_v2_config():
    from backend.services.llm_config import validate
    validate(_base_v2())  # helper imported from test_llm_config_providers
```

Add this import at the top of the file:

```python
from tests.test_llm_config_providers import _base_v2  # noqa: E402
```

(If pytest complains about cross-import, copy `_base_v2` inline instead.)

- [ ] **Step 5: Run the new tests**

Run: `pytest tests/test_llm_config_providers.py tests/test_llm_config_service.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/services/llm_config.py tests/test_llm_config_providers.py tests/test_llm_config_service.py
git commit -m "feat(llm-config): validate v2 providers schema"
```

---

## Task 6: Add `find_references` and `validate_removal`

**Files:**
- Modify: `backend/services/llm_config.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_llm_config_find_references.py
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
```

- [ ] **Step 2: Run to confirm failure**

Run: `pytest tests/test_llm_config_find_references.py -v`
Expected: `AttributeError: module 'backend.services.llm_config' has no attribute 'find_references'`.

- [ ] **Step 3: Implement the helpers**

Append to `backend/services/llm_config.py`:

```python
def find_references(data: dict, target: str) -> list[str]:
    """Return dotted paths referencing the given target.

    `target` forms:
      `provider:<id>` — finds any tier/agent_mapping entry that references a
        model owned by that provider.
      `model:<id>` — finds any tier/agent_mapping entry that references that
        model id directly.
    """
    if ":" not in target:
        raise ValueError(f"target must be 'provider:<id>' or 'model:<id>', got {target!r}")
    kind, value = target.split(":", 1)
    paths: list[str] = []
    tiers = data.get("tiers") or {}
    provider_map = _collect_global_models(data)

    if kind == "model":
        target_id = value
        target_provider = provider_map.get(target_id)
    elif kind == "provider":
        target_id = None
        target_provider = value
    else:
        raise ValueError(f"unknown target kind {kind!r}")

    for tier_name, tier in tiers.items():
        if not isinstance(tier, dict):
            continue
        whitelist = tier.get("models") or []
        if isinstance(whitelist, list):
            for i, mid in enumerate(whitelist):
                if kind == "model" and mid == target_id:
                    paths.append(f"tiers.{tier_name}.models.{i}")
                elif kind == "provider" and provider_map.get(mid) == target_provider:
                    paths.append(f"tiers.{tier_name}.models.{i}")
        default = tier.get("default")
        if isinstance(default, str):
            if kind == "model" and default == target_id:
                paths.append(f"tiers.{tier_name}.default")
            elif kind == "provider" and provider_map.get(default) == target_provider:
                paths.append(f"tiers.{tier_name}.default")
        fallback = tier.get("fallback")
        if isinstance(fallback, str):
            if kind == "model" and fallback == target_id:
                paths.append(f"tiers.{tier_name}.fallback")
            elif kind == "provider" and provider_map.get(fallback) == target_provider:
                paths.append(f"tiers.{tier_name}.fallback")

    mappings = data.get("agent_mapping") or {}
    for agent_name, tasks in mappings.items():
        if not isinstance(tasks, dict):
            continue
        for task_name, mapping in tasks.items():
            if not isinstance(mapping, dict):
                continue
            for field in ("model", "fallback"):
                value = mapping.get(field)
                if not isinstance(value, str):
                    continue
                if kind == "model" and value == target_id:
                    paths.append(f"agent_mapping.{agent_name}.{task_name}.{field}")
                elif kind == "provider" and provider_map.get(value) == target_provider:
                    paths.append(f"agent_mapping.{agent_name}.{task_name}.{field}")
    return paths


def validate_removal(data: dict, target: str) -> None:
    paths = find_references(data, target)
    if paths:
        raise LLMConfigError(
            f"无法删除 {target}，仍有 {len(paths)} 处引用",
            paths,
        )
```

- [ ] **Step 4: Run the tests**

Run: `pytest tests/test_llm_config_find_references.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/llm_config.py tests/test_llm_config_find_references.py
git commit -m "feat(llm-config): find_references + validate_removal"
```

---

## Task 7: Update `provider_status` to use the new schema

**Files:**
- Modify: `backend/services/llm_config.py`

- [ ] **Step 1: Update the failing test**

Replace the existing `test_provider_status_includes_keys` test in `tests/test_llm_config_service.py`:

```python
def test_provider_status_reads_providers_block(monkeypatch, isolated_config):
    from backend.services import llm_config as mod
    from backend.services.llm_config import provider_status

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
```

- [ ] **Step 2: Run to confirm failure**

Run: `pytest tests/test_llm_config_service.py::test_provider_status_reads_providers_block -v`
Expected: FAIL (no `providers` block in current YAML).

- [ ] **Step 3: Rewrite `provider_status`**

Replace the body of `provider_status` with:

```python
def provider_status() -> list[dict]:
    """Return one record per entry in `providers`.

    Each record carries: `provider`, `type`, `base_url`, `api_key_env`,
    `api_key_configured`, `enabled`, and `models` (list of {id, display_name}).
    Secrets are NEVER serialized.
    """
    cfg = read_yaml()
    providers = cfg.get("providers") or {}
    out: list[dict] = []
    for pid, provider in providers.items():
        if not isinstance(provider, dict):
            continue
        api_key_env = provider.get("api_key_env", "")
        configured = (
            bool(getattr(settings, _setting_for_env(api_key_env), ""))
            if api_key_env
            else False
        )
        models_out = []
        for mid, model in (provider.get("models") or {}).items():
            if not isinstance(model, dict):
                continue
            models_out.append({
                "id": mid,
                "display_name": model.get("display_name", mid),
                "cost_per_1k_input": model.get("cost_per_1k_input", 0),
                "cost_per_1k_output": model.get("cost_per_1k_output", 0),
                "max_tokens": model.get("max_tokens", 8192),
                "temperature": model.get("temperature", 0.7),
                "json_mode": bool(model.get("json_mode", False)),
                "stream": bool(model.get("stream", True)),
            })
        out.append({
            "provider": pid,
            "type": provider.get("type", "openai_compatible"),
            "display_name": provider.get("display_name", pid),
            "base_url": provider.get("base_url", ""),
            "api_key_env": api_key_env,
            "api_key_configured": configured,
            "enabled": bool(provider.get("enabled", True)),
            "models": models_out,
        })
    return out


def _setting_for_env(env_name: str) -> str:
    """Map an API key env name (e.g. ANTHROPIC_API_KEY) to the matching
    Settings attribute (`anthropic_api_key`). Falls back to the env name
    so unknown keys just return empty (no API key configured)."""
    mapping = {
        "ANTHROPIC_API_KEY": "anthropic_api_key",
        "DEEPSEEK_API_KEY": "deepseek_api_key",
        "MINIMAX_API_KEY": "minimax_api_key",
    }
    return mapping.get(env_name, env_name.lower())
```

- [ ] **Step 4: Run the tests**

Run: `pytest tests/test_llm_config_service.py -v`
Expected: PASS once the real YAML is migrated in Task 9 (intermediate: the test reads the v2 schema after migration).

- [ ] **Step 5: Commit**

```bash
git add backend/services/llm_config.py tests/test_llm_config_service.py
git commit -m "feat(llm-config): provider_status reads providers block"
```

---

## Task 8: Add `migrate_legacy_yaml`

**Files:**
- Modify: `backend/services/llm_config.py`
- Create: `tests/test_llm_config_migrate.py`

- [ ] **Step 1: Write the failing test**

```python
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
    assert result["backup_path"].endswith(".bak-")
    validate(new_data)


def test_migrate_writes_env_keys(tmp_path, monkeypatch):
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
```

- [ ] **Step 2: Run to confirm failure**

Run: `pytest tests/test_llm_config_migrate.py -v`
Expected: `AttributeError: module 'backend.services.llm_config' has no attribute 'migrate_legacy_yaml'`.

- [ ] **Step 3: Implement `migrate_legacy_yaml`**

Append to `backend/services/llm_config.py`:

```python
from datetime import datetime, timezone


def _legacy_default_base_url(provider_id: str) -> str:
    if provider_id == "deepseek":
        return "https://api.deepseek.com/v1"
    if provider_id == "minimax":
        return "https://api.minimax.chat/v1"
    if provider_id == "anthropic":
        return "https://api.anthropic.com"
    return ""


def _legacy_provider_type(provider_id: str) -> str:
    return "anthropic" if provider_id == "anthropic" else "openai_compatible"


def migrate_legacy_yaml(
    config_path: Path = CONFIG_PATH,
    env_path: Optional[Path] = None,
) -> dict:
    """Convert the legacy `tiers.*.models[*].{provider,cost_*,max_tokens}`
    layout into the v2 schema with a top-level `providers` block.

    Returns a summary dict: `{backup_path, summary}`.

    Raises LLMConfigError when the YAML already uses v2 (i.e. has a
    `providers` key) or the structure cannot be interpreted.
    """
    if not config_path.exists():
        raise LLMConfigError("配置文件不存在", ["$"])
    raw_text = config_path.read_text(encoding="utf-8")
    raw = yaml.safe_load(raw_text) or {}
    if not isinstance(raw, dict):
        raise LLMConfigError("配置文件根节点必须是对象", ["$"])
    if "providers" in raw:
        raise LLMConfigError("已是新结构，无需迁移", ["providers"])

    tiers = raw.get("tiers") or {}
    providers: dict[str, dict] = {}
    global_ids: dict[str, str] = {}
    for tier in tiers.values():
        if not isinstance(tier, dict):
            continue
        for m in tier.get("models") or []:
            if not isinstance(m, dict):
                continue
            pid = m.get("provider")
            mid = m.get("id")
            if not pid or not mid:
                continue
            providers.setdefault(
                pid,
                {
                    "type": _legacy_provider_type(pid),
                    "display_name": pid,
                    "base_url": _legacy_default_base_url(pid),
                    "api_key_env": f"{pid.upper()}_API_KEY",
                    "enabled": True,
                    "models": {},
                },
            )
            models = providers[pid]["models"]
            if mid in models:
                continue
            models[mid] = {
                "display_name": mid,
                "cost_per_1k_input": m.get("cost_per_1k_input", 0),
                "cost_per_1k_output": m.get("cost_per_1k_output", 0),
                "max_tokens": m.get("max_tokens", 8192),
                "temperature": 0.7,
                "json_mode": pid in {"deepseek", "minimax"},
                "stream": True,
            }

    # Detect global id collisions; rename by prefixing provider id.
    collisions: dict[str, list[str]] = {}
    for pid, provider in providers.items():
        for mid in list(provider["models"].keys()):
            collisions.setdefault(mid, []).append(pid)
    renamed = False
    for mid, providers_sharing in collisions.items():
        if len(providers_sharing) <= 1:
            continue
        renamed = True
        for pid in providers_sharing:
            old = providers[pid]["models"].pop(mid)
            new_mid = f"{pid}/{mid}"
            providers[pid]["models"][new_mid] = old
    if renamed:
        # rewrite references in tiers + agent_mapping
        new_global = {
            mid: pid
            for pid, provider in providers.items()
            for mid in provider["models"]
        }
        for tier in tiers.values():
            if not isinstance(tier, dict):
                continue
            new_models = []
            for m in tier.get("models") or []:
                if not isinstance(m, dict):
                    new_models.append(m)
                    continue
                pid = m.get("provider")
                mid = m.get("id")
                if pid and mid and mid in collisions and pid in collisions[mid]:
                    new_models.append(f"{pid}/{mid}")
                else:
                    new_models.append(mid or "")
            tier["models"] = new_models
            for key in ("default", "fallback"):
                val = tier.get(key)
                if isinstance(val, str) and val in collisions:
                    owner = collisions[val][0]
                    tier[key] = f"{owner}/{val}"
        mappings = raw.get("agent_mapping") or {}
        for agent, tasks in mappings.items():
            if not isinstance(tasks, dict):
                continue
            for task, mapping in tasks.items():
                if not isinstance(mapping, dict):
                    continue
                for key in ("model", "fallback"):
                    val = mapping.get(key)
                    if isinstance(val, str) and val in collisions:
                        mapping[key] = f"{collisions[val][0]}/{val}"

    # Persist backup.
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = config_path.with_suffix(config_path.suffix + f".bak-{ts}")
    backup_path.write_text(raw_text, encoding="utf-8")

    raw["providers"] = providers

    # Sync .env (best-effort).
    if env_path is None:
        env_path = Path("backend/.env")
    env_updates: dict[str, str] = {}
    for pid in providers:
        key = getattr(settings, f"{pid}_api_key", "")
        if not key:
            continue
        # Write BOTH the new prefixed name and the legacy alias so
        # pydantic-settings picks the value up on the next reload without
        # requiring a process restart.
        env_updates[f"STORYFORGE_PROVIDER_API_KEY_{pid.upper()}"] = key
        env_updates[f"{pid.upper()}_API_KEY"] = key
    if env_updates:
        write_env_atomic(env_path, env_updates)

    # Atomic write YAML.
    config_path.parent.mkdir(parents=True, exist_ok=True)
    write_yaml_atomic(raw)
    validate(raw)
    return {
        "backup_path": str(backup_path),
        "summary": {
            "providers": list(providers.keys()),
            "renamed_ids": renamed,
        },
    }
```

Add the import at the top of the file:

```python
from datetime import datetime, timezone
```

- [ ] **Step 4: Run the tests**

Run: `pytest tests/test_llm_config_migrate.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/llm_config.py tests/test_llm_config_migrate.py
git commit -m "feat(llm-config): one-shot migrate_legacy_yaml"
```

---

## Task 9: Migrate the existing `config/model_tiers.yaml`

**Files:**
- Modify: `config/model_tiers.yaml`

- [ ] **Step 1: Run the migration script**

```bash
python -c "from backend.services.llm_config import migrate_legacy_yaml; print(migrate_legacy_yaml())"
```

- [ ] **Step 2: Inspect the new YAML**

Run: `head -120 config/model_tiers.yaml`
Expected: top-level `providers:` block present, with `anthropic`, `deepseek`, `minimax`.

- [ ] **Step 3: Validate the migrated YAML**

Run: `python -c "from backend.services.llm_config import validate, read_yaml; validate(read_yaml())"`
Expected: no output (success).

- [ ] **Step 4: Re-run all service tests**

Run: `pytest tests/test_llm_config_service.py tests/test_llm_config_providers.py tests/test_llm_config_find_references.py tests/test_llm_config_migrate.py tests/test_llm_config_env_writer.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add config/model_tiers.yaml
git commit -m "chore(config): migrate model_tiers.yaml to providers schema"
```

---

## Task 10: Update `ModelRouter` to load `_providers` and dispatch by `type`

**Files:**
- Modify: `backend/llm/model_router.py`
- Create: `tests/test_model_router.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_model_router.py
from pathlib import Path

import pytest
import yaml

from backend.llm.model_router import ModelRouter, reset_model_router


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
    assert "claude-opus-4" in router._providers["anthropic"]["models"]


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
```

- [ ] **Step 2: Run to confirm failure**

Run: `pytest tests/test_model_router.py -v`
Expected: AttributeError on `router._providers` (current router uses `tier.models`).

- [ ] **Step 3: Replace `_load_config`, `_find_model_info`, and `_create_provider_for_model`**

Add a `ProviderEntry`-like dataclass at the top of `backend/llm/model_router.py` (right after the existing dataclasses):

```python
@dataclass
class ProviderEntry:
    provider_id: str
    type: str
    display_name: str
    base_url: str
    api_key_env: str
    enabled: bool
    models: dict[str, dict]  # model id -> raw dict from YAML


@dataclass
class TierConfig:
    description: str
    models: list[str]               # model ids in whitelist
    default: str
    retry_on_failure: bool = True
    max_retries: int = 1
    fallback: Optional[str] = None
```

Replace the old `TierConfig` definition with the one above. Then add to `ModelRouter`:

```python
class ModelRouter:
    def __init__(self, config_path=None):
        if config_path is None:
            config_path = Path("config/model_tiers.yaml")
        self._config_path = Path(config_path)
        self._tiers: dict[str, TierConfig] = {}
        self._mappings: dict[str, dict[str, AgentTaskMapping]] = {}
        self._providers: dict[str, ProviderEntry] = {}
        self._provider_status: dict[str, bool] = {}
        self._load_config()
```

Replace `_load_config`, `_parse_tiers`, `_find_model_info`, `_create_provider_for_model`, and `reload_config` with:

```python
def _load_config(self) -> None:
    if not self._config_path.exists():
        logger.warning(
            "model_tiers.yaml not found at %s, using builtin defaults",
            self._config_path,
        )
        data = {"providers": self.BUILTIN_PROVIDERS, "tiers": self.BUILTIN_TIERS, "agent_mapping": {}}
        self._write_config(data)
    else:
        with open(self._config_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
    self._parse_providers(data.get("providers") or {})
    self._parse_tiers(data.get("tiers") or {})
    self._parse_mappings(data.get("agent_mapping") or {})


def _parse_providers(self, providers_data: dict) -> None:
    self._providers.clear()
    for pid, raw in providers_data.items():
        if not isinstance(raw, dict):
            continue
        models_raw = raw.get("models") or {}
        models_dict: dict[str, dict] = {}
        if isinstance(models_raw, dict):
            for mid, mbody in models_raw.items():
                if isinstance(mbody, dict):
                    models_dict[mid] = {**mbody, "provider": pid, "id": mid}
        self._providers[pid] = ProviderEntry(
            provider_id=pid,
            type=raw.get("type", "openai_compatible"),
            display_name=raw.get("display_name", pid),
            base_url=raw.get("base_url", ""),
            api_key_env=raw.get("api_key_env", ""),
            enabled=bool(raw.get("enabled", True)),
            models=models_dict,
        )


def _parse_tiers(self, tiers_data: dict) -> None:
    self._tiers.clear()
    for name, cfg in tiers_data.items():
        self._tiers[name] = TierConfig(
            description=cfg.get("description", ""),
            models=[m for m in (cfg.get("models") or []) if isinstance(m, str)],
            default=cfg.get("default", ""),
            retry_on_failure=cfg.get("retry_on_failure", True),
            max_retries=cfg.get("max_retries", 1),
            fallback=cfg.get("fallback"),
        )


def _find_model_info(self, model_id: str) -> Optional[dict]:
    for provider in self._providers.values():
        if model_id in provider.models:
            return provider.models[model_id]
    return None


def _find_model_info_or_raise(self, model_id: str) -> dict:
    info = self._find_model_info(model_id)
    if info is None:
        from backend.llm.errors import ModelNotFoundError
        raise ModelNotFoundError(model_id)
    return info


def _create_provider_for_model(self, model_info: dict) -> BaseLLMProvider:
    from backend.llm.anthropic_provider import AnthropicProvider
    from backend.llm.deepseek_provider import DeepSeekProvider
    from backend.llm.minimax_provider import MiniMaxProvider
    from backend.llm.openai_compatible_provider import OpenAICompatibleProvider
    from backend.llm.mock_provider import MockProvider

    provider_id = model_info["provider"]
    provider = self._providers.get(provider_id)
    if provider is None:
        raise ValueError(f"Unknown provider '{provider_id}'")
    api_key = ""
    if provider.api_key_env:
        env_to_attr = {
            "ANTHROPIC_API_KEY": "anthropic_api_key",
            "DEEPSEEK_API_KEY": "deepseek_api_key",
            "MINIMAX_API_KEY": "minimax_api_key",
        }
        attr = env_to_attr.get(provider.api_key_env)
        if attr:
            api_key = getattr(settings, attr, "")
        if not api_key:
            api_key = os.environ.get(provider.api_key_env, "")
    base_url = provider.base_url
    if provider.type == "anthropic":
        adapter_cls = AnthropicProvider
    elif provider.type == "mock":
        adapter_cls = MockProvider
    elif provider_id == "deepseek":
        adapter_cls = DeepSeekProvider
        if not base_url:
            base_url = settings.deepseek_base_url
    elif provider_id == "minimax":
        adapter_cls = MiniMaxProvider
        if not base_url:
            base_url = settings.minimax_base_url
    else:
        adapter_cls = OpenAICompatibleProvider
    config = LLMConfig(
        provider=provider_id,
        model=model_info["id"],
        api_key=api_key,
        base_url=base_url,
        max_tokens=model_info.get("max_tokens", 8192),
        temperature=model_info.get("temperature", settings.llm_temperature),
    )
    if provider.type == "mock":
        return adapter_cls(config)
    if not api_key:
        raise ValueError(
            f"API key for provider '{provider_id}' is not configured."
        )
    return adapter_cls(config)


def reload_config(self) -> None:
    self._tiers.clear()
    self._mappings.clear()
    self._providers.clear()
    self._load_config()
```

Add at top of file:

```python
import os
```

Add `BUILTIN_PROVIDERS` as a sibling to `BUILTIN_TIERS`:

```python
BUILTIN_PROVIDERS: dict[str, dict] = {
    "anthropic": {
        "type": "anthropic",
        "display_name": "Anthropic",
        "base_url": "https://api.anthropic.com",
        "api_key_env": "ANTHROPIC_API_KEY",
        "enabled": True,
        "models": {
            "claude-opus-4": {"display_name": "Claude Opus 4", "cost_per_1k_input": 0.015, "cost_per_1k_output": 0.075, "max_tokens": 8192, "temperature": 0.7, "json_mode": False, "stream": True},
            "claude-sonnet-4": {"display_name": "Claude Sonnet 4", "cost_per_1k_input": 0.003, "cost_per_1k_output": 0.015, "max_tokens": 4096, "temperature": 0.7, "json_mode": False, "stream": True},
            "claude-haiku": {"display_name": "Claude Haiku", "cost_per_1k_input": 0.00025, "cost_per_1k_output": 0.00125, "max_tokens": 2048, "temperature": 0.7, "json_mode": False, "stream": True},
        },
    },
    "deepseek": {
        "type": "openai_compatible",
        "display_name": "DeepSeek",
        "base_url": "https://api.deepseek.com/v1",
        "api_key_env": "DEEPSEEK_API_KEY",
        "enabled": True,
        "models": {
            "deepseek-v4-pro": {"display_name": "DeepSeek V4 Pro", "cost_per_1k_input": 0.002, "cost_per_1k_output": 0.008, "max_tokens": 8192, "temperature": 0.7, "json_mode": True, "stream": True},
        },
    },
    "minimax": {
        "type": "openai_compatible",
        "display_name": "MiniMax",
        "base_url": "https://api.minimax.chat/v1",
        "api_key_env": "MINIMAX_API_KEY",
        "enabled": True,
        "models": {
            "MiniMax-M3": {"display_name": "MiniMax M3", "cost_per_1k_input": 0.001, "cost_per_1k_output": 0.001, "max_tokens": 4096, "temperature": 0.7, "json_mode": True, "stream": True},
        },
    },
}
```

Update `BUILTIN_TIERS` so the `models` field is a list of strings (model ids), not dicts:

```python
BUILTIN_TIERS: dict[str, dict] = {
    "tier_1": {
        "description": "Scene 写作、STAGE 1-3 内容生成",
        "models": ["deepseek-v4-pro", "claude-opus-4"],
        "default": "deepseek-v4-pro",
        "retry_on_failure": True,
        "max_retries": 2,
        "fallback": "claude-opus-4",
    },
    "tier_2": {
        "description": "Narrative Guard 状态漂移检测",
        "models": ["claude-sonnet-4"],
        "default": "claude-sonnet-4",
        "retry_on_failure": True,
        "max_retries": 1,
        "fallback": None,
    },
    "tier_3": {
        "description": "L1 细节重提取、章摘要生成、风格分类",
        "models": ["claude-haiku", "MiniMax-M3"],
        "default": "claude-haiku",
        "retry_on_failure": True,
        "max_retries": 1,
        "fallback": None,
    },
    "tier_0": {
        "description": "Fact Guard、StoryOS SF_LOG 解析、ReaderOS 计算",
        "models": [],
        "default": "none",
    },
}
```

- [ ] **Step 4: Run the tests**

Run: `pytest tests/test_model_router.py -v`
Expected: PASS.

- [ ] **Step 5: Re-run the full backend test suite**

Run: `pytest tests/test_llm_config_service.py tests/test_llm_config_providers.py tests/test_llm_config_find_references.py tests/test_llm_config_migrate.py tests/test_llm_config_env_writer.py tests/test_openai_compatible_provider.py tests/test_mock_provider.py tests/test_model_router.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/llm/model_router.py tests/test_model_router.py
git commit -m "refactor(llm): ModelRouter loads providers catalog"
```

---

## Task 11: Add CRUD endpoints in `llm_config_api`

**Files:**
- Modify: `backend/api/llm_config_api.py`
- Modify: `tests/test_llm_config_api.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_llm_config_api.py`:

```python
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


def test_delete_provider_with_references_blocked(client):
    res = client.delete("/api/settings/llm-config/providers/deepseek")
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert "deepseek" in detail["detail"]["invalid_paths"][0]


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


def test_migrate_endpoint_409_when_already_v2(client):
    res = client.post("/api/settings/llm-config/migrate")
    assert res.status_code == 409
```

Add at the top of `tests/test_llm_config_api.py`:

```python
@pytest.fixture(autouse=True)
def _patch_env_path(monkeypatch, tmp_path):
    monkeypatch.setattr(cfg_mod, "ENV_PATH", tmp_path / ".env")
```

- [ ] **Step 2: Run to confirm failure**

Run: `pytest tests/test_llm_config_api.py -v`
Expected: 404 on the new endpoints.

- [ ] **Step 3: Add `ENV_PATH` constant and new endpoints**

In `backend/services/llm_config.py`, add at module top:

```python
ENV_PATH = Path("backend/.env")
```

In `backend/api/llm_config_api.py`, add new imports and helpers:

```python
from backend.services.llm_config import (
    ENV_PATH,
    LLMConfigError,
    find_references,
    migrate_legacy_yaml,
    provider_status,
    read_yaml,
    reload_router,
    update_provider_api_key,
    validate,
    validate_removal,
    write_env_atomic,
    write_yaml_atomic,
)
```

Append at the bottom of the file:

```python
@router.post("/llm-config/providers")
async def upsert_provider(payload: dict):
    pid = payload.get("id")
    body = payload.get("provider")
    if not pid or not isinstance(body, dict):
        _err("VALIDATION_ERROR", "缺少 id 或 provider", 422, {"invalid_paths": ["$"]})
    data = read_yaml()
    providers = data.setdefault("providers", {})
    providers[pid] = body
    try:
        validate(data)
    except LLMConfigError as e:
        _err("VALIDATION_ERROR", str(e), 422, {"invalid_paths": e.invalid_paths})
    try:
        write_yaml_atomic(data)
    except OSError as e:
        _err("WRITE_FAILED", f"写入失败: {e}", 500)
    summary = reload_router()
    return {"error": False, "code": "OK", "message": "provider 已保存", "detail": summary}


@router.delete("/llm-config/providers/{provider_id}")
async def delete_provider(provider_id: str):
    data = read_yaml()
    if "providers" not in data or provider_id not in data["providers"]:
        _err("NOT_FOUND", f"provider '{provider_id}' 不存在", 404)
    try:
        validate_removal(data, f"provider:{provider_id}")
    except LLMConfigError as e:
        _err("VALIDATION_ERROR", str(e), 422, {"invalid_paths": e.invalid_paths})
    data["providers"].pop(provider_id)
    write_yaml_atomic(data)
    summary = reload_router()
    return {"error": False, "code": "OK", "message": "provider 已删除", "detail": summary}


@router.post("/llm-config/providers/{provider_id}/models")
async def upsert_model(provider_id: str, payload: dict):
    mid = payload.get("id")
    body = payload.get("model")
    if not mid or not isinstance(body, dict):
        _err("VALIDATION_ERROR", "缺少 id 或 model", 422, {"invalid_paths": ["$"]})
    data = read_yaml()
    provider = (data.get("providers") or {}).get(provider_id)
    if not isinstance(provider, dict):
        _err("NOT_FOUND", f"provider '{provider_id}' 不存在", 404)
    provider.setdefault("models", {})[mid] = body
    try:
        validate(data)
    except LLMConfigError as e:
        _err("VALIDATION_ERROR", str(e), 422, {"invalid_paths": e.invalid_paths})
    write_yaml_atomic(data)
    summary = reload_router()
    return {"error": False, "code": "OK", "message": "model 已保存", "detail": summary}


@router.delete("/llm-config/providers/{provider_id}/models/{model_id}")
async def delete_model(provider_id: str, model_id: str):
    data = read_yaml()
    provider = (data.get("providers") or {}).get(provider_id)
    if not isinstance(provider, dict):
        _err("NOT_FOUND", f"provider '{provider_id}' 不存在", 404)
    try:
        validate_removal(data, f"model:{model_id}")
    except LLMConfigError as e:
        _err("VALIDATION_ERROR", str(e), 422, {"invalid_paths": e.invalid_paths})
    provider.get("models", {}).pop(model_id, None)
    write_yaml_atomic(data)
    summary = reload_router()
    return {"error": False, "code": "OK", "message": "model 已删除", "detail": summary}


@router.put("/llm-config/providers/{provider_id}/api-key")
async def put_provider_api_key(provider_id: str, payload: dict):
    value = payload.get("value")
    if not isinstance(value, str):
        _err("VALIDATION_ERROR", "value 必须是字符串", 422, {"invalid_paths": ["value"]})
    updates = {
        f"STORYFORGE_PROVIDER_API_KEY_{provider_id.upper()}": value,
        f"{provider_id.upper()}_API_KEY": value,  # legacy alias for pydantic-settings
    }
    try:
        write_env_atomic(ENV_PATH, updates)
    except OSError as e:
        _err("WRITE_FAILED", f".env 写入失败: {e}", 500)
    summary = reload_router()
    return {"error": False, "code": "OK", "message": "API Key 已写入并热重载", "detail": summary}


@router.post("/llm-config/migrate")
async def post_migrate():
    try:
        result = migrate_legacy_yaml()
    except LLMConfigError as e:
        _err("VALIDATION_ERROR", str(e), 409, {"invalid_paths": e.invalid_paths})
    return {"error": False, "code": "OK", "message": "已迁移", "detail": result}
```

Add at module top of `backend/services/llm_config.py` (only if not already present):

```python
def update_provider_api_key(provider_id: str, value: str) -> None:
    write_env_atomic(ENV_PATH, {f"STORYFORGE_PROVIDER_API_KEY_{provider_id.upper()}": value})
```

(Verify that the import order matches what's used by the api.)

- [ ] **Step 4: Run the tests**

Run: `pytest tests/test_llm_config_api.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/llm_config.py backend/api/llm_config_api.py tests/test_llm_config_api.py
git commit -m "feat(llm-config-api): provider/model CRUD + API key + migrate endpoints"
```

---

## Task 12: Extend frontend client types and wrappers

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/llmConsole.ts`

- [ ] **Step 1: Add types in `client.ts`**

Replace the `ModelEntry` block and add new types. Final shape:

```ts
export interface ModelEntry {
  id: string;
  display_name?: string;
  provider: string;
  cost_per_1k_input: number;
  cost_per_1k_output: number;
  max_tokens: number;
  temperature?: number;
  json_mode?: boolean;
  stream?: boolean;
}

export interface TierConfig {
  description: string;
  models: string[];           // whitelist of model ids from providers catalog
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

export interface ProvidersConfig {
  [providerId: string]: ProviderEntry;
}

export interface ProviderEntry {
  type: "anthropic" | "openai_compatible" | "mock";
  display_name: string;
  base_url: string;
  api_key_env: string;
  enabled: boolean;
  models: Record<string, ModelEntry>;
}

export interface ModelTiersConfig {
  providers?: ProvidersConfig;
  tiers: Record<string, TierConfig>;
  agent_mapping: Record<string, Record<string, AgentTaskMapping>>;
}

export interface ProviderStatus {
  provider: string;
  type: ProviderEntry["type"];
  display_name: string;
  base_url: string;
  api_key_env: string;
  api_key_configured: boolean;
  enabled: boolean;
  models: ModelEntry[];
}
```

- [ ] **Step 2: Add endpoint wrappers**

Append to `client.ts` inside the same `api` object:

```ts
upsertProvider: (id: string, provider: ProviderEntry) =>
  request<LLMRouterSummary>("POST", "/settings/llm-config/providers", { id, provider }),
deleteProvider: (id: string) =>
  request<LLMRouterSummary>("DELETE", `/settings/llm-config/providers/${id}`),
upsertModel: (providerId: string, modelId: string, model: ModelEntry) =>
  request<LLMRouterSummary>(
    "POST",
    `/settings/llm-config/providers/${providerId}/models`,
    { id: modelId, model },
  ),
deleteModel: (providerId: string, modelId: string) =>
  request<LLMRouterSummary>(
    "DELETE",
    `/settings/llm-config/providers/${providerId}/models/${modelId}`,
  ),
setProviderApiKey: (providerId: string, value: string) =>
  request<LLMRouterSummary>(
    "PUT",
    `/settings/llm-config/providers/${providerId}/api-key`,
    { value },
  ),
migrateConfig: () =>
  request<{ backup_path: string; summary: object }>(
    "POST",
    "/settings/llm-config/migrate",
  ),
```

- [ ] **Step 3: Re-export in `llmConsole.ts`**

```ts
import api, {
  type AgentTaskMapping,
  type LLMRouterSummary,
  type ModelEntry,
  type ModelTiersConfig,
  type ProviderEntry,
  type ProviderStatus,
  type TierConfig,
  type UsageRecord,
} from './client';

export const llmConsole = {
  getConfig: (): Promise<ModelTiersConfig> => api.getLLMConfig(),
  getProviders: (): Promise<ProviderStatus[]> => api.getProviders(),
  saveConfig: (cfg: ModelTiersConfig): Promise<LLMRouterSummary> => api.putLLMConfig(cfg),
  reload: (): Promise<LLMRouterSummary> => api.reloadLLMConfig(),
  getUsage: (limit = 50): Promise<UsageRecord[]> => api.getLLMUsage(limit),
  upsertProvider: (id: string, provider: ProviderEntry): Promise<LLMRouterSummary> =>
    api.upsertProvider(id, provider),
  deleteProvider: (id: string): Promise<LLMRouterSummary> => api.deleteProvider(id),
  upsertModel: (providerId: string, modelId: string, model: ModelEntry): Promise<LLMRouterSummary> =>
    api.upsertModel(providerId, modelId, model),
  deleteModel: (providerId: string, modelId: string): Promise<LLMRouterSummary> =>
    api.deleteModel(providerId, modelId),
  setProviderApiKey: (providerId: string, value: string): Promise<LLMRouterSummary> =>
    api.setProviderApiKey(providerId, value),
  migrateConfig: (): Promise<{ backup_path: string; summary: object }> =>
    api.migrateConfig(),
};

export type {
  ModelTiersConfig,
  ModelEntry,
  TierConfig,
  AgentTaskMapping,
  ProviderEntry,
  ProviderStatus,
  UsageRecord,
  LLMRouterSummary,
};
```

- [ ] **Step 4: Run frontend type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/llmConsole.ts
git commit -m "feat(ai-console-api): provider/model CRUD wrappers + types"
```

---

## Task 13: Rewrite `ProviderPanel` for full CRUD

**Files:**
- Rewrite: `frontend/src/components/aiConsole/ProviderPanel.tsx`
- Rewrite: `frontend/src/test/ProviderPanel.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/test/ProviderPanel.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ProviderPanel from '../components/aiConsole/ProviderPanel';
import type { ProviderStatus } from '../api/client';

const PROVIDERS: ProviderStatus[] = [
  {
    provider: 'anthropic',
    type: 'anthropic',
    display_name: 'Anthropic',
    base_url: 'https://api.anthropic.com',
    api_key_env: 'ANTHROPIC_API_KEY',
    api_key_configured: true,
    enabled: true,
    models: [{ id: 'claude-opus-4', provider: 'anthropic', cost_per_1k_input: 0.015, cost_per_1k_output: 0.075, max_tokens: 8192 }],
  },
];

beforeEach(() => {
  vi.restoreAllMocks();
  global.fetch = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: { tiers: 4, agents: 7 } }), { status: 200 })),
  );
});

describe('ProviderPanel', () => {
  it('renders provider cards with model chips', () => {
    render(<ProviderPanel providers={PROVIDERS} dirty onChange={() => {}} onReload={() => {}} />);
    expect(screen.getByTestId('provider-anthropic')).toBeTruthy();
    expect(screen.getByText('claude-opus-4')).toBeTruthy();
  });

  it('opens API Key modal and submits to PUT endpoint', async () => {
    const onReload = vi.fn();
    render(<ProviderPanel providers={PROVIDERS} dirty onChange={() => {}} onReload={onReload} />);
    fireEvent.click(screen.getByTestId('provider-anthropic-apikey'));
    const input = await screen.findByTestId('provider-apikey-input');
    fireEvent.change(input, { target: { value: 'sk-new' } });
    fireEvent.click(screen.getByTestId('provider-apikey-save'));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/settings/llm-config/providers/anthropic/api-key'),
        expect.objectContaining({ method: 'PUT' }),
      ),
    );
    expect(onReload).toHaveBeenCalled();
  });

  it('delete model button calls DELETE endpoint', async () => {
    render(<ProviderPanel providers={PROVIDERS} dirty onChange={() => {}} onReload={() => {}} />);
    fireEvent.click(screen.getByTestId('provider-anthropic-model-claude-opus-4-delete'));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/settings/llm-config/providers/anthropic/models/claude-opus-4'),
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
  });

  it('shows toast when delete returns 422', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: true, code: 'VALIDATION_ERROR', message: 'in use', detail: { invalid_paths: ['tiers.tier_1.fallback'] } }),
          { status: 422 },
        ),
      ),
    );
    render(<ProviderPanel providers={PROVIDERS} dirty onChange={() => {}} onReload={() => {}} />);
    fireEvent.click(screen.getByTestId('provider-anthropic-model-claude-opus-4-delete'));
    expect(await screen.findByTestId('provider-error-toast')).toBeTruthy();
    expect(screen.getByText(/tier_1\.fallback/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd frontend && npm test -- ProviderPanel`
Expected: failures because `dirty`, `onChange`, `onReload` props don't exist yet.

- [ ] **Step 3: Implement the panel**

`frontend/src/components/aiConsole/ProviderPanel.tsx`:

```tsx
import { useState } from 'react';
import { llmConsole, type ModelEntry, type ProviderEntry, type ProviderStatus } from '../../api/llmConsole';

interface Props {
  providers: ProviderStatus[];
  dirty: boolean;
  onChange: () => void;
  onReload: () => Promise<void> | void;
}

interface ErrorState {
  message: string;
  paths?: string[];
}

function ApiKeyModal({ providerId, onClose, onSaved }: { providerId: string; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <div data-testid="provider-apikey-modal" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
      <div className="rounded bg-canvas-bg p-6 shadow-xl">
        <h4 className="mb-3 text-sm font-semibold">设置 {providerId} API Key</h4>
        <input
          data-testid="provider-apikey-input"
          type="password"
          className="w-80 rounded border border-canvas-text-muted/40 bg-canvas-surface px-2 py-1 text-sm"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1 text-sm" onClick={onClose}>取消</button>
          <button
            type="button"
            data-testid="provider-apikey-save"
            disabled={!value || saving}
            className="rounded bg-canvas-accent px-3 py-1 text-sm text-white disabled:opacity-50"
            onClick={async () => {
              setSaving(true);
              try {
                await llmConsole.setProviderApiKey(providerId, value);
                onSaved();
                onClose();
              } finally {
                setSaving(false);
              }
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProviderPanel({ providers, dirty, onChange, onReload }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [apikeyFor, setApikeyFor] = useState<string | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);

  const handleApiKeySaved = async () => {
    await onReload();
    onChange();
  };

  const handleDelete = async (providerId: string) => {
    if (!window.confirm(`删除 provider '${providerId}' 及其全部模型？`)) return;
    try {
      await llmConsole.deleteProvider(providerId);
      await onReload();
      onChange();
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : '删除失败' });
    }
  };

  const handleDeleteModel = async (providerId: string, modelId: string) => {
    try {
      await llmConsole.deleteModel(providerId, modelId);
      await onReload();
      onChange();
    } catch (e) {
      const paths = (e as any)?.detail?.invalid_paths;
      setError({ message: '无法删除 — 仍有引用', paths });
    }
  };

  return (
    <div data-testid="provider-panel" className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-canvas-text-muted">Provider ({providers.length})</span>
        <button
          type="button"
          data-testid="provider-add"
          className="rounded border border-canvas-accent/40 px-2 py-0.5 text-xs text-canvas-accent"
        >
          + 新增 Provider
        </button>
      </div>
      <div className={`grid gap-3 ${providers.length > 6 ? '' : 'sm:grid-cols-3'}`}>
        {providers.map((p) => (
          <div
            key={p.provider}
            data-testid={`provider-${p.provider}`}
            className="rounded-lg border border-canvas-text-muted/20 bg-canvas-surface px-4 py-3"
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-semibold">{p.display_name}</span>
                <span className="ml-2 text-xs text-canvas-text-muted">{p.type}</span>
              </div>
              <span className={`text-xs ${p.api_key_configured ? 'text-emerald-600' : 'text-rose-600'}`}>
                {p.api_key_configured ? '✓ 已配置' : '✗ 未配置'}
              </span>
            </div>
            <div className="mt-2 truncate text-xs text-canvas-text-muted" title={p.base_url}>
              {p.base_url || '(无 base_url)'}
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              <button type="button" data-testid={`provider-${p.provider}-edit`} className="rounded border px-2 py-0.5 text-xs" onClick={() => setEditing(p.provider)}>编辑</button>
              <button type="button" data-testid={`provider-${p.provider}-apikey`} className="rounded border px-2 py-0.5 text-xs" onClick={() => setApikeyFor(p.provider)}>API Key</button>
              <button type="button" data-testid={`provider-${p.provider}-delete`} className="rounded border border-rose-500/40 px-2 py-0.5 text-xs text-rose-600" onClick={() => handleDelete(p.provider)}>删除</button>
            </div>
            <div className="mt-3 space-y-1">
              {p.models.length === 0 && <span className="text-xs text-canvas-text-muted">（无模型）</span>}
              {p.models.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded bg-canvas-bg px-2 py-1 text-xs">
                  <span className="font-mono">{m.id}</span>
                  <button type="button" data-testid={`provider-${p.provider}-model-${m.id}-delete`} className="text-rose-600" onClick={() => handleDeleteModel(p.provider, m.id)}>删除</button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {error && (
        <div data-testid="provider-error-toast" className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700">
          {error.message}
          {error.paths && (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {error.paths.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
        </div>
      )}
      {apikeyFor && <ApiKeyModal providerId={apikeyFor} onClose={() => setApikeyFor(null)} onSaved={handleApiKeySaved} />}
      {editing && <span data-testid={`provider-${editing}-editing`} className="sr-only" />}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npm test -- ProviderPanel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/aiConsole/ProviderPanel.tsx frontend/src/test/ProviderPanel.test.tsx
git commit -m "feat(ai-console): ProviderPanel supports CRUD + API Key"
```

---

## Task 14: Update `TierPanel` to pick from provider catalog

**Files:**
- Modify: `frontend/src/components/aiConsole/TierPanel.tsx`
- Modify: `frontend/src/test/TierPanel.test.tsx`

- [ ] **Step 1: Update failing tests**

```tsx
// frontend/src/test/TierPanel.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TierPanel, { type TierConfig } from '../components/aiConsole/TierPanel';

const CATALOG = [
  { id: 'deepseek-v4-pro', display_name: 'DeepSeek V4 Pro', provider: 'deepseek', cost_per_1k_input: 0.002, cost_per_1k_output: 0.008, max_tokens: 8192 },
  { id: 'claude-opus-4', display_name: 'Claude Opus 4', provider: 'anthropic', cost_per_1k_input: 0.015, cost_per_1k_output: 0.075, max_tokens: 8192 },
];

const SAMPLE: TierConfig = {
  description: 'Tier 1 description',
  models: ['claude-opus-4'],
  default: 'claude-opus-4',
  retry_on_failure: true,
  max_retries: 2,
  fallback: 'claude-opus-4',
};

const TIER_0: TierConfig = { description: 'Deterministic', models: [], default: 'none' };

describe('TierPanel', () => {
  it('lets user edit description', () => {
    const onChange = vi.fn();
    render(<TierPanel tierName="tier_1" value={SAMPLE} onChange={onChange} catalog={CATALOG} />);
    fireEvent.change(screen.getByTestId('tier-1-description'), { target: { value: '新描述' } });
    expect(onChange).toHaveBeenCalledWith({ ...SAMPLE, description: '新描述' });
  });

  it('default dropdown shows catalog entries plus whitelist items', () => {
    render(<TierPanel tierName="tier_1" value={SAMPLE} onChange={() => {}} catalog={CATALOG} />);
    const sel = screen.getByTestId('tier-1-default') as HTMLSelectElement;
    const values = Array.from(sel.options).map((o) => o.value);
    expect(values).toEqual(expect.arrayContaining(['deepseek-v4-pro', 'claude-opus-4']));
  });

  it('adding a model picks from catalog', () => {
    const onChange = vi.fn();
    render(<TierPanel tierName="tier_1" value={{ ...SAMPLE, models: [] }} onChange={onChange} catalog={CATALOG} />);
    fireEvent.click(screen.getByTestId('tier-1-add-model'));
    const sel = screen.getByTestId('tier-1-new-model-select') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: 'deepseek-v4-pro' } });
    fireEvent.click(screen.getByTestId('tier-1-new-model-add'));
    const last = onChange.mock.calls.at(-1)![0];
    expect(last.models).toContain('deepseek-v4-pro');
  });

  it('removing a model emits updated whitelist', () => {
    const onChange = vi.fn();
    render(<TierPanel tierName="tier_1" value={SAMPLE} onChange={onChange} catalog={CATALOG} />);
    fireEvent.click(screen.getByTestId('tier-1-model-0-remove'));
    const last = onChange.mock.calls.at(-1)![0];
    expect(last.models).toEqual([]);
  });

  it('tier_0 hides add-model', () => {
    const onChange = vi.fn();
    render(<TierPanel tierName="tier_0" value={TIER_0} onChange={onChange} catalog={CATALOG} readOnly />);
    expect(screen.queryByTestId('tier-0-add-model')).toBeNull();
    expect(screen.getByTestId('tier-0-readonly-note')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd frontend && npm test -- TierPanel`
Expected: FAIL because the new `catalog` prop and test ids don't exist.

- [ ] **Step 3: Rewrite `TierPanel`**

```tsx
import type { ModelEntry, TierConfig } from '../../api/client';

export type { TierConfig };

interface Props {
  tierName: string;
  value: TierConfig;
  onChange: (next: TierConfig) => void;
  catalog: ModelEntry[];
  readOnly?: boolean;
}

export default function TierPanel({ tierName, value, onChange, catalog, readOnly = false }: Props) {
  const isTier0 = tierName === 'tier_0';
  const disabled = readOnly || isTier0;
  const tid = tierName === 'tier_0' ? '0' : tierName.replace(/^tier_/, '');
  const update = (patch: Partial<TierConfig>) => onChange({ ...value, ...patch });
  const [pendingModel, setPendingModel] = useState('');

  return (
    <div data-testid={`tier-${tid}`} className="rounded-lg border border-canvas-text-muted/20">
      <div className="flex items-center justify-between bg-canvas-surface px-4 py-3">
        <div className="font-semibold">{tierName}</div>
        {disabled && (
          <span data-testid={`tier-${tid}-readonly-note`} className="text-xs text-canvas-text-muted">
            {tierName === 'tier_0' ? 'tier_0 只读（确定性）' : '只读'}
          </span>
        )}
      </div>
      <div className="space-y-3 px-4 py-3">
        <label className="block text-sm">
          <span className="text-canvas-text-muted">描述</span>
          <input
            data-testid={`tier-${tid}-description`}
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
              data-testid={`tier-${tid}-default`}
              className="ml-1 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1 text-sm"
              disabled={disabled}
              value={value.default}
              onChange={(e) => update({ default: e.target.value })}
            >
              {isTier0 && <option value="none">none</option>}
              {value.models.map((mid) => (
                <option key={mid} value={mid}>{mid}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-canvas-text-muted">回退模型</span>
            <select
              data-testid={`tier-${tid}-fallback`}
              className="ml-1 rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-1 text-sm"
              disabled={disabled}
              value={value.fallback ?? ''}
              onChange={(e) => update({ fallback: e.target.value || null })}
            >
              <option value="">（无）</option>
              {value.models.map((mid) => (
                <option key={mid} value={mid}>{mid}</option>
              ))}
            </select>
          </label>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-canvas-text-muted">模型 ({value.models.length})</span>
            {!disabled && (
              <div className="flex items-center gap-2">
                <select
                  data-testid={`tier-${tid}-new-model-select`}
                  className="rounded border border-canvas-text-muted/30 bg-canvas-bg px-2 py-0.5 text-xs"
                  value={pendingModel}
                  onChange={(e) => setPendingModel(e.target.value)}
                >
                  <option value="">选择模型…</option>
                  {catalog
                    .filter((m) => !value.models.includes(m.id))
                    .map((m) => (
                      <option key={m.id} value={m.id}>{m.id} ({m.display_name ?? m.id})</option>
                    ))}
                </select>
                <button
                  type="button"
                  data-testid={`tier-${tid}-new-model-add`}
                  disabled={!pendingModel}
                  onClick={() => {
                    update({ models: [...value.models, pendingModel] });
                    setPendingModel('');
                  }}
                  className="rounded border border-canvas-accent/40 px-2 py-0.5 text-xs text-canvas-accent disabled:opacity-50"
                >
                  + 加入
                </button>
              </div>
            )}
          </div>
          <div className="space-y-2">
            {value.models.map((mid, idx) => (
              <div key={mid} className="flex items-center justify-between rounded border border-canvas-text-muted/10 bg-canvas-surface px-3 py-2 text-sm">
                <span className="font-mono text-xs">{mid}</span>
                {!disabled && (
                  <button
                    type="button"
                    data-testid={`tier-${tid}-model-${idx}-remove`}
                    onClick={() => update({ models: value.models.filter((_, i) => i !== idx) })}
                    className="rounded border border-rose-500/40 px-2 py-0.5 text-xs text-rose-600"
                  >
                    删除
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

Add the import:

```tsx
import { useState } from 'react';
```

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npm test -- TierPanel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/aiConsole/TierPanel.tsx frontend/src/test/TierPanel.test.tsx
git commit -m "feat(ai-console): TierPanel picks from provider catalog"
```

---

## Task 15: Update `AgentMappingPanel` for the new whitelist data shape

**Files:**
- Modify: `frontend/src/components/aiConsole/AgentMappingPanel.tsx`
- Modify: `frontend/src/test/AgentMappingPanel.test.tsx`

- [ ] **Step 1: Update failing tests**

```tsx
// frontend/src/test/AgentMappingPanel.test.tsx
const TIERS: ModelTiersConfig['tiers'] = {
  tier_1: {
    description: '',
    models: ['deepseek-v4-pro', 'claude-opus-4'],
    default: 'deepseek-v4-pro',
  },
  tier_0: { description: '', models: [], default: 'none' },
};
```

(Top-level helper. Drop the old `provider:`/`cost_*/max_tokens` keys.)

- [ ] **Step 2: Run to confirm failure**

Run: `cd frontend && npm test -- AgentMappingPanel`
Expected: FAIL because `models` is now `string[]`.

- [ ] **Step 3: Adjust `modelOptionsForTier`**

Replace `modelOptionsForTier` in `AgentMappingPanel.tsx` so it treats `m` as a string:

```tsx
const modelOptionsForTier = (tierName: string): { id: string; label: string }[] => {
  const tier = tiers[tierName];
  if (!tier) return [{ id: 'default', label: '默认' }];
  return [
    { id: 'default', label: `默认（${tier.default}）` },
    ...tier.models.map((mid) => ({ id: mid, label: mid })),
  ];
};
```

(No structural changes elsewhere.)

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npm test -- AgentMappingPanel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/aiConsole/AgentMappingPanel.tsx frontend/src/test/AgentMappingPanel.test.tsx
git commit -m "refactor(ai-console): AgentMappingPanel whitelist of model ids"
```

---

## Task 16: Update `AIConsoleModal` for migrate prompt and ProviderPanel wiring

**Files:**
- Modify: `frontend/src/components/aiConsole/AIConsoleModal.tsx`
- Modify: `frontend/src/test/AIConsoleModal.test.tsx`

- [ ] **Step 1: Write a failing test**

Append to `frontend/src/test/AIConsoleModal.test.tsx`:

```tsx
it('shows migrate banner when YAML lacks providers', async () => {
  global.fetch = vi.fn((url) => {
    if (url.includes('/llm-config') && (!url.includes('reload') && !url.includes('migrate'))) {
      return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: { tiers: { tier_0: { default: 'none' } }, agent_mapping: {} } }), { status: 200 }));
    }
    if (url.includes('/llm-config/migrate')) {
      return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: { backup_path: '/tmp/x' } }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ error: false, code: 'OK', message: '', detail: [] }), { status: 200 }));
  });
  render(<AIConsoleModal isOpen onClose={() => {}} />);
  const btn = await screen.findByTestId('modal-migrate');
  fireEvent.click(btn);
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/llm-config/migrate'),
      expect.objectContaining({ method: 'POST' }),
    ),
  );
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `cd frontend && npm test -- AIConsoleModal`
Expected: FAIL (no migrate banner).

- [ ] **Step 3: Add migrate banner and pass `catalog` to TierPanel**

In `AIConsoleModal.tsx`:

- Replace `setProviders` with `setProviders(prov)` is unchanged. Add `const [showMigrate, setShowMigrate] = useState(false)` and `const [providerDirty, setProviderDirty] = useState(false)`. After fetching, set `setShowMigrate(!cfg.providers)` and `setProviderDirty(false)`.
- Update `dirty` computation: `const dirty = (!!config && !!draft && !deepEqual(config, draft)) || providerDirty`.
- Add a button `data-testid="modal-migrate"` next to the reload button (visible when `showMigrate`). On click: `await llmConsole.migrateConfig(); await refresh(); setShowMigrate(false); setToast('迁移完成');`.
- Derive a flat catalog `const catalog = (draft?.providers ? Object.values(draft.providers).flatMap(p => Object.values(p.models)) : providers.flatMap(p => p.models))` and pass it to `<TierPanel catalog={catalog} ...>`.
- Replace `<ProviderPanel providers={providers} />` with `<ProviderPanel providers={providers} dirty={dirty} onChange={() => setProviderDirty(true)} onReload={refresh} />`. Provider CRUD persists to server immediately, so we mark a separate dirty flag instead of merging into the YAML diff.
- After successful save (existing `handleSave`) and after reload, call `setProviderDirty(false)`.

Update imports to add `ProviderEntry`/`ModelEntry` from `../../api/llmConsole`.

- [ ] **Step 4: Run the tests**

Run: `cd frontend && npm test`
Expected: PASS (full vitest suite).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/aiConsole/AIConsoleModal.tsx frontend/src/test/AIConsoleModal.test.tsx
git commit -m "feat(ai-console): migrate prompt + ProviderPanel wiring"
```

---

## Task 17: End-to-end smoke test

**Files:**
- (no file changes; manual verification)

- [ ] **Step 1: Restart the backend**

Run: `source venv/bin/activate && uvicorn backend.main:app --reload --port 8000`
Expected: server boots without errors; `GET /api/settings/llm-config` returns the v2 schema.

- [ ] **Step 2: Trigger the migrate endpoint against a legacy fixture**

```bash
cp config/model_tiers.yaml /tmp/legacy.yaml
python -c "
import shutil, yaml
from pathlib import Path
src = Path('/tmp/legacy.yaml')
shutil.copy('config/model_tiers.bak-*', '/tmp/keep') if False else None
"
pytest tests/test_llm_config_migrate.py -v
```

Expected: PASS.

- [ ] **Step 3: Run the full backend test suite**

Run: `pytest`
Expected: PASS.

- [ ] **Step 4: Run the frontend test suite**

Run: `cd frontend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit any final adjustments**

```bash
git status
git add -u   # only if there are minor tweaks
git commit -m "chore(ai-console): post-smoke adjustments"
```

(Only commit if Step 1–4 surfaced tweaks; otherwise skip.)