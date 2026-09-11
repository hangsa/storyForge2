"""4 阶段创意发散 API 路由。

Mounted at /api/v1/projects/{project_id}/creative/diverge/three-b/*.

端点(共 10):
- GET    /state              — 读 state(走 migrate)
- DELETE /state              — 删 state
- POST   /decompose          — Stage 2 拆解
- POST   /follow-up          — Stage 2 追问单 unit
- POST   /diverge            — Stage 3 per-unit 自适应发散
- POST   /regenerate-unit    — Stage 3 单 unit 重生
- POST   /select-unit        — Stage 3 切换候选
- POST   /commit             — Stage 4 LLM 合成 5 字段
- POST   /edit-concept       — Stage 4 用户编辑
- POST   /advance            — Stage 4 写盘(commit-and-advance)
"""

from __future__ import annotations

import logging
from dataclasses import asdict
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from backend.config import settings
from backend.creative_os.three_b_engine import (
    RawIntent,
    ThreeBEngine,
    migrate_state_on_load,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/projects/{project_id}/creative/diverge/three-b",
    tags=["three_b"],
)


def _get_engine(request: Request) -> ThreeBEngine:
    """Get ThreeBEngine singleton (created in app lifespan or on-demand)."""
    engine = getattr(request.app.state, "three_b_engine", None)
    if engine is None:
        from backend.llm.model_router import ModelRouter
        engine = ThreeBEngine(model_router=ModelRouter())
        request.app.state.three_b_engine = engine
    return engine


def _state_path(project_id: str) -> Path:
    return (
        Path(settings.projects_dir)
        / project_id
        / "creative_os"
        / "three_b_state.json"
    )


def _serialize_state(state) -> dict:
    """Convert ThreeBState dataclass to JSON-friendly dict."""
    return asdict(state)


def _serialize_dimensions(dims) -> list[dict]:
    return [asdict(d) for d in dims]


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class DecomposeRequest(BaseModel):
    prompt: str = Field(..., min_length=10)
    genre_primary: str
    tone: str = ""
    style: str = ""
    user_modifications: Optional[str] = Field(default=None, max_length=1700)


class FollowUpRequest(BaseModel):
    unit_id: str
    user_question: Optional[str] = None


class RegenerateUnitRequest(BaseModel):
    unit_id: str


class SelectUnitRequest(BaseModel):
    unit_id: str
    candidate_index: int = Field(..., ge=0)


class EditConceptRequest(BaseModel):
    one_line: Optional[str] = None
    expanded: Optional[str] = None
    core_tension: Optional[str] = None
    tone: Optional[str] = None
    logline: Optional[str] = None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/state")
async def get_state(project_id: str) -> dict:
    state = migrate_state_on_load(project_id)
    if state is None:
        raise HTTPException(
            status_code=404,
            detail="state 不存在(项目未启动创意发散或已迁移)",
        )
    return _serialize_state(state)


@router.delete("/state")
async def delete_state(project_id: str) -> dict:
    p = _state_path(project_id)
    if not p.exists():
        raise HTTPException(status_code=404, detail="state 不存在")
    p.unlink()
    return {"deleted": True}


@router.post("/decompose")
async def decompose(project_id: str, body: DecomposeRequest, request: Request) -> dict:
    engine = _get_engine(request)
    try:
        dimensions, causal_map, summary = await engine.decompose(
            project_id,
            RawIntent(
                prompt=body.prompt,
                genre_primary=body.genre_primary,
                tone=body.tone,
                style=body.style,
            ),
            user_modifications=body.user_modifications or "",
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception("decompose failed")
        raise HTTPException(status_code=503, detail=f"DECOMPOSE_FAILED: {e}")
    return {
        "dimensions": _serialize_dimensions(dimensions),
        "causal_map": causal_map,
        "top_level_summary": summary,
    }


@router.post("/follow-up")
async def follow_up(project_id: str, body: FollowUpRequest, request: Request) -> dict:
    engine = _get_engine(request)
    try:
        unit = await engine.follow_up_unit(project_id, body.unit_id, body.user_question)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception("follow_up failed")
        raise HTTPException(status_code=503, detail=f"FOLLOW_UP_FAILED: {e}")
    return {"unit": asdict(unit)}


@router.post("/diverge")
async def diverge(project_id: str, request: Request) -> dict:
    engine = _get_engine(request)
    try:
        dims = await engine.diverge(project_id)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception("diverge failed")
        raise HTTPException(status_code=503, detail=f"DIVERGE_FAILED: {e}")
    return {"dimensions": _serialize_dimensions(dims)}


@router.post("/regenerate-unit")
async def regenerate_unit(project_id: str, body: RegenerateUnitRequest, request: Request) -> dict:
    engine = _get_engine(request)
    try:
        cands = await engine.regenerate_unit(project_id, body.unit_id)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception("regenerate_unit failed")
        raise HTTPException(status_code=503, detail=f"REGENERATE_FAILED: {e}")
    return {"candidates": [asdict(c) for c in cands]}


@router.post("/select-unit")
async def select_unit(project_id: str, body: SelectUnitRequest, request: Request) -> dict:
    engine = _get_engine(request)
    try:
        dim = engine.select_unit_candidate(project_id, body.unit_id, body.candidate_index)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return {"dimension": asdict(dim)}


@router.post("/commit")
async def commit(project_id: str, request: Request) -> dict:
    engine = _get_engine(request)
    try:
        result = await engine.commit(project_id)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception("commit failed")
        raise HTTPException(status_code=503, detail=f"COMMIT_FAILED: {e}")
    return result


@router.post("/edit-concept")
async def edit_concept(project_id: str, body: EditConceptRequest, request: Request) -> dict:
    engine = _get_engine(request)
    edited = {
        k: v
        for k, v in body.model_dump(exclude_none=True).items()
        if v is not None
    }
    try:
        result = await engine.edit_committed_concept(project_id, edited)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception("edit_concept failed")
        raise HTTPException(status_code=503, detail=f"EDIT_CONCEPT_FAILED: {e}")
    return result


@router.post("/advance")
async def advance(project_id: str, request: Request) -> dict:
    engine = _get_engine(request)
    try:
        result = await engine.advance(project_id)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.exception("advance failed")
        raise HTTPException(status_code=503, detail=f"ADVANCE_FAILED: {e}")
    return result


@router.post("/reset-and-restart")
async def reset_and_restart(project_id: str) -> dict:
    """Convenience endpoint: delete state file (idempotent — 404 vs success).

    Unlike DELETE /state, this returns {"deleted": True} regardless of whether
    a file existed, so the frontend can call it unconditionally when starting
    a fresh 4-stage flow.
    """
    p = _state_path(project_id)
    if p.exists():
        p.unlink()
    return {"deleted": True}