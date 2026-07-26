from __future__ import annotations

from typing import Optional

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