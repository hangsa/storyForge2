from __future__ import annotations

import logging
import re
from typing import Optional

from fastapi import APIRouter, HTTPException

log = logging.getLogger(__name__)

from backend.services import llm_config as llm_config_mod
from backend.services.llm_config import (
    LLMConfigError,
    find_references,
    migrate_legacy_yaml,
    probe_provider,
    provider_status,
    read_yaml,
    reload_router,
    seed_builtin_providers,
    validate,
    validate_removal,
    write_env_atomic,
    write_yaml_atomic,
)
from backend.services.llm_usage_log import read_recent

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _ok(detail: object) -> dict:
    return {"error": False, "code": "OK", "message": "", "detail": detail}


def _err(code: str, message: str, status: int, extra: Optional[dict] = None):
    raise HTTPException(
        status_code=status,
        detail={
            "error": True,
            "code": code,
            "message": message,
            "detail": extra or {},
        },
    )


_ID_RE = re.compile(r"^[a-z0-9_-]+$")
# Model ids round-trip the provider's own naming (e.g. "MiniMax-M3",
# "claude-opus-4-20250514", "deepseek-v4-pro") — uppercase letters and
# dots are accepted, but we still forbid characters that would break the
# YAML structure or shell escaping (spaces, quotes, colons, brackets).
_MODEL_ID_RE = re.compile(r"^[A-Za-z0-9_.\-]+$")


def _validate_id(value: str, label: str) -> None:
    if not isinstance(value, str) or not _ID_RE.match(value):
        _err("VALIDATION_ERROR", f"{label} 格式无效：仅允许 a-z、0-9、_、-", 422, {"invalid_paths": [label]})


def _validate_model_id(value: str, label: str) -> None:
    if not isinstance(value, str) or not _MODEL_ID_RE.match(value):
        _err(
            "VALIDATION_ERROR",
            f"{label} 格式无效：仅允许字母、数字、_、-、.",
            422,
            {"invalid_paths": [label]},
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
        _err(
            "VALIDATION_ERROR",
            str(e),
            422,
            {"invalid_paths": e.invalid_paths},
        )
    try:
        write_yaml_atomic(data)
    except OSError as e:
        _err("WRITE_FAILED", f"写入失败: {e}", 500)
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
        _err(
            "VALIDATION_ERROR",
            str(e),
            422,
            {"invalid_paths": e.invalid_paths},
        )
    except Exception as e:
        _err("RELOAD_FAILED", f"重载失败: {e}", 500)
    return {
        "error": False,
        "code": "OK",
        "message": "配置已重载",
        "detail": summary,
    }


@router.get("/llm-usage")
async def get_llm_usage(limit: int = 50):
    if limit < 1 or limit > 500:
        _err(
            "VALIDATION_ERROR",
            "limit 必须介于 1-500",
            400,
        )
    return _ok(read_recent(limit=limit))


@router.post("/llm-config/providers")
async def upsert_provider(payload: dict):
    pid = payload.get("id")
    body = payload.get("provider")
    if not pid or not isinstance(body, dict):
        _err("VALIDATION_ERROR", "缺少 id 或 provider", 422, {"invalid_paths": ["$"]})
    _validate_id(pid, "id")
    data = read_yaml()
    providers = data.setdefault("providers", {})
    existing = providers.get(pid)
    if isinstance(existing, dict) and "models" not in body:
        merged = {**existing, **body, "models": existing.get("models", {})}
    else:
        merged = {**(existing if isinstance(existing, dict) else {}), **body}
    providers[pid] = merged
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
    _validate_id(provider_id, "provider_id")
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
    _validate_id(provider_id, "provider_id")
    mid = payload.get("id")
    body = payload.get("model")
    if not mid or not isinstance(body, dict):
        _err("VALIDATION_ERROR", "缺少 id 或 model", 422, {"invalid_paths": ["$"]})
    _validate_model_id(mid, "id")
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
    _validate_id(provider_id, "provider_id")
    _validate_model_id(model_id, "model_id")
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
    _validate_id(provider_id, "provider_id")
    value = payload.get("value")
    if not isinstance(value, str):
        _err("VALIDATION_ERROR", "value 必须是字符串", 422, {"invalid_paths": ["value"]})
    updates = {
        f"STORYFORGE_PROVIDER_API_KEY_{provider_id.upper()}": value,
        f"{provider_id.upper()}_API_KEY": value,  # legacy alias for pydantic-settings
    }
    try:
        write_env_atomic(llm_config_mod.ENV_PATH, updates)
    except OSError as e:
        _err("WRITE_FAILED", f".env 写入失败: {e}", 500)
    summary = reload_router()
    return {"error": False, "code": "OK", "message": "API Key 已写入并热重载", "detail": summary}


@router.post("/llm-config/providers/{provider_id}/probe")
async def post_probe_provider(provider_id: str):
    """Probe the saved provider — connection check + model listing.

    Returns 200 always for known providers; the success/failure of the probe
    itself is in the payload (`success`, `error_code`). 404 only when the
    provider id doesn't exist in the config.
    """
    _validate_id(provider_id, "provider_id")
    try:
        result = await probe_provider(provider_id)
    except LLMConfigError as e:
        _err("NOT_FOUND", str(e), 404, {"invalid_paths": e.invalid_paths})
    return _ok(result)


@router.post("/llm-config/migrate")
async def post_migrate():
    try:
        result = migrate_legacy_yaml()
        message = "已迁移"
    except LLMConfigError as e:
        # Already v2 but a builtin (anthropic/deepseek/minimax) may have
        # been silently dropped at first migration — recover it instead.
        if "providers" in (e.invalid_paths or []) and "新结构" in str(e):
            added_result = seed_builtin_providers()
            added = added_result.get("added") or []
            result = {"backup_path": None, **added_result}
            message = (
                f"已补种 {len(added)} 个内置 provider：{', '.join(added)}"
                if added
                else "无需补种（已全部存在）"
            )
        else:
            _err("VALIDATION_ERROR", str(e), 409, {"invalid_paths": e.invalid_paths})
    return {"error": False, "code": "OK", "message": message, "detail": result}
