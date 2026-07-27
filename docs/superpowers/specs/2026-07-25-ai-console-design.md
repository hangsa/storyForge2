# AI 控制台 — Implementation Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Expose StoryForge's LLM routing configuration (provider credentials, tier model pools, agent→task→tier mapping) through an in-app AI Console modal so non-engineers can edit `config/model_tiers.yaml` safely, see recent usage, and hot-reload the router without touching the backend or restarting uvicorn.

**Architecture:** Backend adds a small `llm_config` service + 5 endpoints that wrap the existing `config/model_tiers.yaml` (validation + atomic write + `ModelRouter.reload_config()`). A new `llm_usage_log` service tails `llm_usage.jsonl` for the recent-N table. Frontend adds an `AIConsoleModal` mounted from `HomePage` (entered via the QuickActions "AI 控制台" button), modeled on `PromptPlazaModal` (full-screen, Esc-to-close, backdrop click). Three panels: Provider (read-only), Tier (full CRUD), Agent Mapping (full CRUD). Local dirty-state with confirm-on-close. No project-level overrides in v1.

**Tech Stack:** FastAPI + Pydantic v2 (existing) for backend; React 18 + Tailwind (existing) for frontend; existing `react-router-dom` v6.

---

## 1. User-facing surface

### Entry point

- Left sidebar QuickActions button: `AI 控制台` (`qa-ai-console`). Currently `disabled=true` with tooltip "即将推出" — flip to enabled.
- Click opens full-screen modal `AIConsoleModal`. Closes via X / Esc / backdrop click. Unsaved edits prompt confirm.

### Layout (top → bottom)

```
┌──────────────────────────────────────────────────────────┐
│ Header:  AI 控制台               [↻ 重新加载] [× 关闭]   │
├──────────────────────────────────────────────────────────┤
│ 最近调用 (LLM Usage · 最近 50 条)                         │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ time | agent | task | tier | model | tok_in tok_out │ │
│ │ ... 50 rows, newest first                            │ │
│ └──────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────┤
│ Provider 面板 (只读)                                       │
│  • Anthropic: 已配置 / 未配置, base_url=…                 │
│  • DeepSeek:  …                                            │
│  • MiniMax:   …                                            │
├──────────────────────────────────────────────────────────┤
│ Tier 面板                                                  │
│  ▾ tier_1  (创意核心)            [+ 模型] [删除 tier]      │
│    description: [_______] default: [v] fallback: [v]       │
│    retry_on_failure [✓]  max_retries [2]                    │
│    models:                                                │
│     ┌─ id: claude-opus-4 provider: anthropic  [编辑] [×]┐│
│     └─ cost_per_1k_input [_] cost_per_1k_output [_]      │
│     ┌─ id: ...                                            ┐│
│  ▸ tier_2 ...                                              │
│  ▸ tier_3 ...                                              │
│  ▸ tier_0  (只读 · 确定性)                                  │
├──────────────────────────────────────────────────────────┤
│ Agent Mapping 面板                                         │
│  ▾ planner                                                 │
│     concept_generation       tier [v: tier_1] model [v]    │
│     world_generation         tier [v: tier_1] model [v]    │
│     ...                                                     │
│  ▾ writer                                                   │
│     scene_writing            tier [v: tier_1] model [v]    │
│     scene_rewrite            tier [v: tier_1] model [v]    │
│  ▸ reviewer, storyos_agent, ...                             │
├──────────────────────────────────────────────────────────┤
│ SaveBar:  [取消修改]  [保存并热重载]                       │
│ (Disabled when not dirty; save performs one PUT)           │
└──────────────────────────────────────────────────────────┘
```

### Behavior contract

- **Provider 面板（只读）**：每行显示 `provider name`、`base_url`（从 `backend.config.settings` 读取）、`api_key 已配置 / 未配置`（不返回原文）。Model 列表聚合自各 tier 的 `models[]`，分 provider 显示。
- **Tier 面板**：可编辑字段 = `description`、`default`、`fallback`、`retry_on_failure`、`max_retries`、每个 model 的所有字段（包括 model-level `max_tokens`）。可增删 model。可增删 tier 本身（除 `tier_0`，因它是无 LLM 的占位）。
- **Agent Mapping 面板**：可编辑字段 = `tier`、`model`、`fallback`，并可新增/删除 agent 与 task 条目（`tier_0` mapping 只显示 tier，不要求 model）。`model` 下拉自动包含 "默认（tier.default）" + 该 tier 的 `models[].id`。`fallback` 同步。agent 名和 task 名必须非空，且在各自层级唯一。
- **SaveBar**：本地 `dirty` flag；保存时 PUT 整个 config；PUT 成功响应已代表写盘和热重载全部完成，直接 toast「配置已热重载，N 个 tier、M 个 agent 已加载」，不得再额外调用 reload endpoint。
- **Dirty 离开守卫**：Esc / X / backdrop click 触发 `beforeunload`-like 拦截；若未保存弹二次确认。
- **Reload 按钮**：右上角 `[↻ 重新加载]` — 若有未保存修改，先确认是否丢弃；确认后触发 `POST /llm-config/reload`（不写入），再重新获取 config / providers / usage，使表单与磁盘内容一致。

---

## 2. Backend

### 2.1 New file: `backend/services/llm_config.py`

```python
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
    """Raised on validation failure. detail() returns machine-readable info."""

    def __init__(self, message: str, invalid_paths: list[str]):
        super().__init__(message)
        self.invalid_paths = invalid_paths


def read_yaml() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def write_yaml_atomic(data: dict) -> None:
    """Atomic write to config_path. Uses mkstemp + os.replace to survive
    kill mid-write. Same pattern as backfill_behavior_examples._atomic_write_json.
    """
    fd, tmp_name = tempfile.mkstemp(dir=CONFIG_PATH.parent, prefix=".model_tiers.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            yaml.safe_dump(data, f, allow_unicode=True, sort_keys=False, default_flow_style=False)
        os.replace(tmp_name, CONFIG_PATH)
    except Exception:
        if os.path.exists(tmp_name):
            os.unlink(tmp_name)
        raise


def validate(data: dict) -> None:
    """Validate a config dict. Raises LLMConfigError with invalid_paths on
    failure. invalid_paths is a list of dotted paths the frontend can map to
    specific fields (e.g. ["tiers.tier_1.models.0.id", "agent_mapping.writer.scene_writing.tier"]).
    """
    invalid: list[str] = []
    if not isinstance(data, dict):
        raise LLMConfigError("配置根节点必须是对象", ["$"])
    tiers = data.get("tiers") or {}
    if not isinstance(tiers, dict):
        raise LLMConfigError("tiers 必须是对象", ["tiers"])
    known_tier_names = set(tiers.keys())
    if "tier_0" not in known_tier_names:
        invalid.append("tiers.tier_0")

    # Per-tier validation
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
        model_ids = [m.get("id") for m in models if isinstance(m, dict) and m.get("id")]
        if len(model_ids) != len(set(model_ids)):
            invalid.append(f"tiers.{tier_name}.models")
        default = tier.get("default")
        if default and default != "none" and not any(m.get("id") == default for m in models):
            invalid.append(f"tiers.{tier_name}.default")
        for i, m in enumerate(models):
            if not isinstance(m, dict):
                invalid.append(f"tiers.{tier_name}.models.{i}")
                continue
            mid = m.get("id")
            if not mid:
                invalid.append(f"tiers.{tier_name}.models.{i}.id")
                continue
            provider = m.get("provider")
            if provider not in ALLOWED_PROVIDERS:
                invalid.append(f"tiers.{tier_name}.models.{i}.provider")
            if not isinstance(m.get("max_tokens"), int):
                invalid.append(f"tiers.{tier_name}.models.{i}.max_tokens")
        fallback = tier.get("fallback")
        if fallback and not any(m.get("id") == fallback for m in models):
            invalid.append(f"tiers.{tier_name}.fallback")
        # Note: tier_0 models intentionally empty

    # Agent mapping validation
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
                invalid.append(
                    f"agent_mapping.{agent_name}.{task_name or '<empty>'}"
                )
                continue
            tier_name = mapping.get("tier")
            if tier_name and tier_name not in known_tier_names:
                invalid.append(f"agent_mapping.{agent_name}.{task_name}.tier")
                continue
            model_id = mapping.get("model")
            if model_id and model_id != "default" and tier_name:
                tier_models = (tiers.get(tier_name) or {}).get("models") or []
                if not any(m.get("id") == model_id for m in tier_models):
                    invalid.append(f"agent_mapping.{agent_name}.{task_name}.model")
            fallback = mapping.get("fallback")
            if fallback and fallback != "default" and tier_name:
                tier_models = (tiers.get(tier_name) or {}).get("models") or []
                if not any(m.get("id") == fallback for m in tier_models):
                    invalid.append(f"agent_mapping.{agent_name}.{task_name}.fallback")

    if invalid:
        raise LLMConfigError(
            f"配置校验失败：{len(invalid)} 项错误", invalid
        )


def reload_router() -> dict:
    """Validate disk config before replacing the live router state."""
    validate(read_yaml())
    router = get_model_router()
    router.reload_config()
    return {
        "tiers": len(router._tiers),
        "agents": len(router._mappings),
    }


def provider_status() -> list[dict]:
    """Return per-provider: name, base_url, api_key_configured (bool), models.
    models is the union of model ids across all tiers for this provider.
    """
    cfg = read_yaml()
    tiers = cfg.get("tiers") or {}
    by_provider: dict[str, set[str]] = {p: set() for p in ALLOWED_PROVIDERS}
    for tier in tiers.values():
        for m in (tier.get("models") or []):
            provider = m.get("provider")
            mid = m.get("id")
            if provider in by_provider and mid:
                by_provider[provider].add(mid)
    out = []
    for provider, models in by_provider.items():
        api_key_attr = PROVIDER_KEY_MAP.get(provider, "")
        configured = bool(getattr(settings, api_key_attr, "")) if api_key_attr else False
        base_url_attr = f"{provider}_base_url" if provider in {"deepseek", "minimax"} else ""
        base_url = getattr(settings, base_url_attr, "") if base_url_attr else ""
        out.append({
            "provider": provider,
            "base_url": base_url,
            "api_key_configured": configured,
            "models": sorted(models),
        })
    return out
```

### 2.2 New file: `backend/services/llm_usage_log.py`

```python
from __future__ import annotations
import json

from backend.config import settings

# llm_usage.jsonl lives at <projects_dir.parent>/llm_usage.jsonl per model_router.record_usage
USAGE_PATH = settings.projects_dir.parent / "llm_usage.jsonl"


def read_recent(limit: int = 50) -> list[dict]:
    """Return the most recent `limit` records from llm_usage.jsonl.
    Lines that fail JSON parse are skipped (do not abort the read).
    """
    if not USAGE_PATH.is_file():
        return []
    out: list[dict] = []
    try:
        # File may be large; tail by reading last ~64KB then full last lines.
        # Simpler: read all, slice.
        with open(USAGE_PATH, "r", encoding="utf-8") as f:
            lines = f.readlines()
    except OSError:
        return []
    for line in reversed(lines[-limit * 4:]):  # over-read in case of bad lines
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

### 2.3 New file: `backend/api/llm_config_api.py`

```python
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


@router.get("/llm-config")
async def get_llm_config():
    return {
        "error": False, "code": "OK", "message": "",
        "detail": read_yaml(),
    }


@router.get("/llm-providers")
async def get_providers():
    return {
        "error": False, "code": "OK", "message": "",
        "detail": provider_status(),
    }


@router.put("/llm-config")
async def put_llm_config(data: dict):
    """Validate the entire config, atomically write it, then hot-reload.
    On validation failure returns 422 with `detail.invalid_paths`.
    """
    try:
        validate(data)
    except LLMConfigError as e:
        raise HTTPException(
            status_code=422,
            detail={
                "error": True, "code": "VALIDATION_ERROR",
                "message": str(e), "detail": {"invalid_paths": e.invalid_paths},
            },
        )
    try:
        write_yaml_atomic(data)
    except OSError as e:
        raise HTTPException(
            status_code=500,
            detail={"error": True, "code": "WRITE_FAILED",
                    "message": f"写入失败: {e}", "detail": {}},
        )
    summary = reload_router()
    return {
        "error": False, "code": "OK", "message": "配置已保存并热重载",
        "detail": summary,
    }


@router.post("/llm-config/reload")
async def reload_llm_config():
    """Reload config from disk without writing. Used by the toolbar button."""
    try:
        summary = reload_router()
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={"error": True, "code": "RELOAD_FAILED",
                    "message": str(e), "detail": {}},
        )
    return {
        "error": False, "code": "OK", "message": "配置已重载",
        "detail": summary,
    }


@router.get("/llm-usage")
async def get_llm_usage(limit: int = 50):
    if limit < 1 or limit > 500:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "limit 必须介于 1-500", "detail": {}},
        )
    return {
        "error": False, "code": "OK", "message": "",
        "detail": read_recent(limit=limit),
    }
```

### 2.4 Wire-up

- Edit `backend/main.py` (or wherever routers are mounted) to `include_router(llm_config_api.router)`. Existing `settings_api.router` stays; the new endpoints live under the same `/api/settings` prefix.

---

## 3. Frontend

### 3.1 New: `frontend/src/api/llmConsole.ts`

Typed wrapper for the five endpoints.

```ts
export interface ModelEntry {
  id: string;
  provider: "anthropic" | "deepseek" | "minimax";
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

export interface LLMConfig {
  tiers: Record<string, TierConfig>;
  agent_mapping: Record<string, Record<string, AgentTaskMapping | unknown>>;
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

import api from "./client";
// reuse api's base + envelope handling
export const llmConsole = {
  getConfig: () => api.getLLMConfig(),
  getProviders: () => api.getProviders(),
  saveConfig: (cfg: LLMConfig) => api.putLLMConfig(cfg),
  reload: () => api.reloadLLMConfig(),
  getUsage: (limit = 50) => api.getLLMUsage(limit),
};
```

### 3.2 New: `frontend/src/components/aiConsole/AIConsoleModal.tsx`

Modal shell:

- Props: `isOpen`, `onClose`.
- State: `config: LLMConfig | null`, `dirtyConfig: LLMConfig | null`, `providers: ProviderStatus[]`, `usage: UsageRecord[]`, `error: string | null`, `saving: boolean`, `dirty: boolean`, `validationErrors: string[]`.
- Effects:
  - Open: fetch `getConfig` + `getProviders` + `getUsage(50)` in parallel; reset dirty=false.
  - Esc handler: if `dirty`, show confirm modal; else onClose.
  - Backdrop click: same.
  - Close on unmount.
- Layout: header bar (title + reload + close) / usage panel (read-only) / 3-column scrollable body (Provider / Tier / Agent Mapping) / save bar (sticky bottom).

### 3.3 Subcomponents

- `UsageRecentTable.tsx` — read-only table.
- `ProviderPanel.tsx` — read-only list; "api_key_configured" renders as ✓ 已配置 / ✗ 未配置.
- `TierPanel.tsx` — collapsible; props: `tierName`, `value`, `onChange(value)`, `isReadOnly`. Add / remove model buttons. Model sub-rows editable inline.
- `AgentMappingPanel.tsx` — collapsible per-agent; per-task dropdowns plus add/remove agent and task controls. When `tier` changes, reset `model` and `fallback` to `"default"` to avoid stale references.

### 3.4 Wire-up

- `HomePage.tsx`: add `consoleOpen` state and `handleOpenConsole` callback; pass through `StatsSidebar → QuickActions`. Render `<AIConsoleModal isOpen={consoleOpen} onClose={...} />` next to existing modals.
- `QuickActions.tsx`: remove `disabled`/`tooltip` for `qa-ai-console`; add `onClick: onOpenConsole`.

### 3.5 Per-field validation

Mirror server-side rules client-side for fast feedback (only enforce the subset that affects UI correctness, e.g. tier is known). Server remains the source of truth.

---

## 4. Critical files

**Created:**
- `backend/services/llm_config.py`
- `backend/services/llm_usage_log.py`
- `backend/api/llm_config_api.py`
- `frontend/src/api/llmConsole.ts`
- `frontend/src/components/aiConsole/AIConsoleModal.tsx`
- `frontend/src/components/aiConsole/UsageRecentTable.tsx`
- `frontend/src/components/aiConsole/ProviderPanel.tsx`
- `frontend/src/components/aiConsole/TierPanel.tsx`
- `frontend/src/components/aiConsole/AgentMappingPanel.tsx`
- `tests/test_llm_config_api.py`
- `tests/test_llm_config_service.py`
- `tests/test_llm_usage_log.py`
- `frontend/src/test/AIConsoleModal.test.tsx`
- `frontend/src/test/TierPanel.test.tsx`
- `frontend/src/test/AgentMappingPanel.test.tsx`
- `frontend/src/test/UsageRecentTable.test.tsx`

**Modified:**
- `backend/main.py` — mount new router.
- `frontend/src/api/client.ts` — add `getLLMConfig`, `putLLMConfig`, `reloadLLMConfig`, `getLLMUsage`, `getProviders`.
- `frontend/src/components/home/QuickActions.tsx` — enable `qa-ai-console`; add `onOpenConsole` prop.
- `frontend/src/components/home/StatsSidebar.tsx` — pass `onOpenConsole` through.
- `frontend/src/pages/HomePage.tsx` — `consoleOpen` state; render `AIConsoleModal`.
- `.gitignore` — already covers `.superpowers/`.

---

## 5. Testing

### Backend
- `test_llm_config_service.py`:
  - `validate` happy path (current `config/model_tiers.yaml`).
  - `validate` rejects: empty tier.models, default not in models, model.provider invalid, fallback not in models, agent_mapping.tier unknown, agent_mapping.model not in tier.models.
  - `read_yaml` parses the current file; malformed YAML raises and leaves the file untouched.
  - `write_yaml_atomic` writes a replacement file with the same content and leaves no temp file.
  - `provider_status` aggregates correctly per provider; counts key configured.
- `test_llm_usage_log.py`:
  - empty file → `[]`.
  - non-JSON lines skipped.
  - returns up to `limit` newest first.
- `test_llm_config_api.py`:
  - GET returns parsed yaml.
  - PUT success path returns summary.
  - PUT validation failure returns 422 with `detail.invalid_paths`.
  - PUT write failure → 500 (mock tempfile failure).
  - POST reload → summary returned.
  - GET providers → list shape.
  - GET usage with limit out of range → 400.

### Frontend
- `AIConsoleModal.test.tsx`:
  - opens → fetches 3 endpoints; renders UsageRecentTable rows.
  - closing with dirty state shows confirm.
  - closing with clean state closes immediately.
- `TierPanel.test.tsx`:
  - add model, remove model, edit field, change default, change fallback.
  - read-only tier (tier_0) has no add/remove buttons.
- `AgentMappingPanel.test.tsx`:
  - changing tier resets model/fallback to "default".
  - dropdown shows tier's model list.
  - add/remove agent and task entries; reject blank or duplicate names.
- `UsageRecentTable.test.tsx`:
  - empty state, multi-row, columns.

Run full backend suite + frontend suite before merge. The existing Workspace EventSource failures are pre-existing and unrelated.

---

## 6. Verification

1. Backend pytest: `pytest tests/test_llm_config_*.py tests/test_llm_usage_log.py -v` — all new tests pass; full backend suite remains green.
2. Frontend vitest: focused suites pass.
3. Manual smoke:
   - Open `/`, click `AI 控制台` in left sidebar → modal opens.
   - Verify Usage table shows non-empty recent rows.
   - Add a model to `tier_1` (or change a description), click `保存并热重载` → toast confirms reload.
   - Trigger an LLM call (e.g. create a project, advance to STAGE2, generate a character) → `llm_usage.jsonl` records the new line; refresh modal → new row at top.
   - Edit a model id to an invalid value (e.g. empty), save → 422 with `invalid_paths`; UI shows inline error and does not close.
   - Make a change, click X with unsaved → confirm dialog.

---

## 7. Acceptance criteria

- [ ] All new backend pytest tests pass.
- [ ] All new frontend vitest tests pass.
- [ ] Full backend suite still green (no regression).
- [ ] Full focused frontend suite still green.
- [ ] QuickActions `AI 控制台` no longer disabled; clicking opens the full-screen modal.
- [ ] Modal can edit every supported field of non-`tier_0` tiers, add/remove tiers and models, and add/remove/edit agent_mapping entries; save persists to `config/model_tiers.yaml` and triggers router reload.
- [ ] Modal rejects invalid configs with field-level error mapping.
- [ ] Usage table shows recent rows newest-first from `llm_usage.jsonl`.
- [ ] Provider rows show api_key `已配置 / 未配置` (no raw secret surfaced).
- [ ] Manual smoke checklist above passes.

---

## 8. Out of scope (deferred)

- Project-level overrides of agent_mapping (would extend the 3-tier prompt override to LLM routing).
- Writing api_key back to disk (`.env` encryption, secret redaction).
- Concurrency lock when multiple browser tabs save simultaneously.
- Per-tier token budget dashboard, latency p95, error-rate charts.
- Tier-0 prompt-style config (no LLM; not relevant for this surface).
- Bulk import / export of `model_tiers.yaml`.