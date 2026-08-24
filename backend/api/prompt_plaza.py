"""Prompt Plaza API — browse and edit per-project prompt overrides.

Routes are mounted at /api/projects/{project_id}/prompts/*.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from backend.config import settings
from backend.services.global_prompt_override_store import GlobalPromptOverrideStore
from backend.services.prompt_override_store import (
    PromptOverrideStore,
    load_prompt_effective,
)


router = APIRouter(prefix="/api/projects/{project_id}/prompts", tags=["prompts"])


# ----------------------------------------------------------------------
# Pydantic models
# ----------------------------------------------------------------------


class PromptOverridePayload(BaseModel):
    """Fields a user can override. extra='forbid' rejects _modified_at etc."""

    system_prompt: Optional[str] = None
    user_prompt_template: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    output_format: Optional[Dict[str, Any]] = None
    negative_constraints: Optional[str] = None

    model_config = ConfigDict(extra="forbid")


# ----------------------------------------------------------------------
# Store singletons (one per settings path)
# ----------------------------------------------------------------------


def _store() -> PromptOverrideStore:
    return PromptOverrideStore(
        projects_dir=Path(settings.projects_dir),
        prompts_dir=Path(settings.prompts_dir),
    )


def _global_store() -> GlobalPromptOverrideStore:
    return GlobalPromptOverrideStore(
        global_overrides_path=Path(settings.global_prompt_overrides_path),
        prompts_dir=Path(settings.prompts_dir),
    )


def _bad_project_id(project_id: str) -> None:
    """Translate store-level ValueError into our 400 envelope.

    The store validates project_id defensively (path traversal, etc.).
    FastAPI would otherwise turn ValueError into a 500 — but bad IDs are
    client input errors and should return 400 with our standard envelope.
    """
    try:
        _store().validate_project_id(project_id)
    except ValueError:
        raise HTTPException(status_code=400, detail={
            "error": True, "code": "VALIDATION_ERROR",
            "message": f"Invalid project_id: {project_id!r}",
        })


# ----------------------------------------------------------------------
# Routes — register list/export before {name} to avoid path collision
# ----------------------------------------------------------------------


@router.get("/list")
async def list_prompts(project_id: str):
    _bad_project_id(project_id)
    proj_store = _store()
    glob_store = _global_store()
    proj_overrides = proj_store._read_overrides(project_id)
    glob_overrides = glob_store._read_overrides()
    prompts = proj_store.list_available(project_id)
    # has_override / modified_at must reflect BOTH layers: a project that
    # inherits only the global default should still show the override badge
    # so the user knows something is customizing the YAML above the factory.
    for row in prompts:
        proj_entry = proj_overrides.get(row["name"]) or {}
        glob_entry = glob_overrides.get(row["name"]) or {}
        proj_has = bool(proj_entry)
        glob_has = bool(glob_entry)
        row["has_override"] = proj_has or glob_has
        # New field: explicit "which layer is in play" so the UI can show
        # a different badge or tooltip for "inheriting global" vs "own
        # project override". Kept simple: 'project' | 'global' | 'none'.
        if proj_has:
            row["override_source"] = "project"
        elif glob_has:
            row["override_source"] = "global"
        else:
            row["override_source"] = "none"
        # Take the more recent of the two layers as the displayed timestamp.
        ts = proj_entry.get("_modified_at") or glob_entry.get("_modified_at")
        row["modified_at"] = ts
    return {"error": False, "prompts": prompts}


@router.get("/{name}")
async def get_prompt(project_id: str, name: str):
    _bad_project_id(project_id)
    store = _store()
    global_store = _global_store()
    try:
        # get_override_only validates name exists (via _load_yaml internally);
        # if it raises FileNotFoundError, we still get the same 404 shape.
        override = store.get_override_only(project_id, name)
        # 3-tier merge so the UI shows what the LLM actually receives:
        # YAML default + Global override + this project's override. The
        # `override` field stays project-only — that's what the user
        # edits, and the source of truth for "my project's customization".
        global_override = global_store.get_override_only(name)
        effective = load_prompt_effective(
            name,
            project_id=project_id,
            override_store=store,
            global_override_store=global_store,
        )
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
        "global_override": global_override,
        "effective": effective,
    }


@router.put("/{name}")
async def update_prompt(project_id: str, name: str, payload: PromptOverridePayload):
    _bad_project_id(project_id)
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
        override = _store().set_override(project_id, name, payload.model_dump(exclude_none=True))
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
async def reset_prompt(project_id: str, name: str):
    _bad_project_id(project_id)
    _store().delete_override(project_id, name)
    return {
        "error": False,
        "detail": {"name": name, "status": "reset"},
        "message": "已重置为默认值",
    }