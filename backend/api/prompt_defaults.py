"""Prompt Defaults API — browse and edit project-independent global prompt overrides.

Routes are mounted at /api/prompts/defaults/*.

These are Layer 1 in the 3-tier prompt architecture: fallback prompts that apply
to ALL projects when no per-project override exists. No project_id is involved.
Mirrors the per-project Prompt Plaza API shape (envelope-style responses).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from backend.config import settings
from backend.services.global_prompt_override_store import GlobalPromptOverrideStore


router = APIRouter(prefix="/api/prompts/defaults", tags=["prompts"])


# ----------------------------------------------------------------------
# Pydantic models
# ----------------------------------------------------------------------


class PromptOverridePayload(BaseModel):
    """Fields a user can override. extra='forbid' rejects _modified_at etc."""

    system_prompt: Optional[str] = None
    user_prompt_template: Optional[str] = None
    model: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    output_format: Optional[Dict[str, Any]] = None

    model_config = ConfigDict(extra="forbid")


# ----------------------------------------------------------------------
# Store singleton (one per settings path)
# ----------------------------------------------------------------------


def _store() -> GlobalPromptOverrideStore:
    return GlobalPromptOverrideStore(
        global_overrides_path=Path(settings.global_prompt_overrides_path),
        prompts_dir=Path(settings.prompts_dir),
    )


# ----------------------------------------------------------------------
# Routes — register list before {name} to avoid path collision
# ----------------------------------------------------------------------


@router.get("/list")
async def list_prompts():
    return {"error": False, "prompts": _store().list_available()}


@router.get("/{name}")
async def get_prompt(name: str):
    store = _store()
    try:
        # get_override_only validates name exists (via _load_yaml internally);
        # if it raises FileNotFoundError, we still get the same 404 shape.
        override = store.get_override_only(name)
        effective = store.get_effective(name)
        builtin = store._load_yaml(name)  # safe — existence already proven above
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "NOT_FOUND",
            "message": f"Prompt template not found: {name}",
        })
    return {
        "error": False,
        "name": name,
        "builtin_yaml": builtin,
        "override": override,
        "effective": effective,
    }


@router.put("/{name}")
async def update_prompt(name: str, payload: PromptOverridePayload):
    # Manual range validation so 400 returns our envelope, not FastAPI's 422.
    if payload.temperature is not None and not (0.0 <= payload.temperature <= 2.0):
        raise HTTPException(status_code=400, detail={
            "error": True, "code": "VALIDATION_ERROR",
            "message": "temperature 必须在 [0.0, 2.0] 范围内",
        })
    if payload.max_tokens is not None and not (1 <= payload.max_tokens <= 32768):
        raise HTTPException(status_code=400, detail={
            "error": True, "code": "VALIDATION_ERROR",
            "message": "max_tokens 必须在 [1, 32768] 范围内",
        })
    try:
        override = _store().set_override(name, payload.model_dump(exclude_none=True))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail={
            "error": True, "code": "NOT_FOUND",
            "message": f"Prompt template not found: {name}",
        })
    return {
        "error": False,
        "detail": {
            "name": name,
            "override": override,
            "modified_at": override.get("_modified_at") if override else None,
        },
        "message": "已保存",
    }


@router.delete("/{name}")
async def reset_prompt(name: str):
    _store().delete_override(name)
    return {
        "error": False,
        "detail": {"name": name, "status": "reset"},
        "message": "已重置为默认值",
    }
