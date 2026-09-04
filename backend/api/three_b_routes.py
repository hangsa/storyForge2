"""3B 创造力法则 API routes (Wizard 「创意发散」3 阶段流程).

Mounted at /api/v1/projects/{project_id}/creative/diverge/three-b/*.

Endpoints:
- GET    /state              — Read three_b_state.json (or skeleton)
- DELETE /state              — Delete three_b_state.json
- POST   /diverge            — Stage 1→2 parallel 3-operator divergence
- POST   /deepen             — Stage 2→3 single-candidate secondary operator
- POST   /commit             — Stage 3 commit (synthesize concept + novelty)
- POST   /regenerate-candidate — Re-run one operator LLM call, replace in place
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from backend.config import settings
from backend.creative_os.three_b_engine import (
    OPERATORS,
    MAX_DEEPENED_IDS,
    MIN_DEEPENED_IDS,
    RawIntent,
    ThreeBEngine,
    ThreeBState,
    atomic_write_state,
    load_state,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/v1/projects/{project_id}/creative/diverge/three-b",
    tags=["three_b"],
)

# Module-level engine instance (LLM router wired lazily on first call)
_engine: Optional[ThreeBEngine] = None


def _get_engine() -> ThreeBEngine:
    """Lazily instantiate the 3B engine with a real ModelRouter."""
    global _engine
    if _engine is None:
        from backend.llm.model_router import ModelRouter
        _engine = ThreeBEngine(model_router=ModelRouter())
    return _engine


def _ensure_project(project_id: str) -> None:
    """Raise 404 with PROJECT_NOT_FOUND if project dir is missing."""
    proj_dir = Path(settings.projects_dir) / project_id
    if not proj_dir.exists():
        raise HTTPException(
            status_code=404,
            detail={
                "error": True,
                "code": "PROJECT_NOT_FOUND",
                "message": f"项目 {project_id} 不存在",
                "detail": {},
            },
        )


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class DivergeRequest(BaseModel):
    prompt: str = Field(min_length=10, description="原始创意点子 ≥10 字")
    genre_primary: str
    genre_secondary: Optional[str] = None


class DeepenRequest(BaseModel):
    candidate_id: str
    applied_operator: str

    @field_validator("applied_operator")
    @classmethod
    def _check_op(cls, v: str) -> str:
        if v not in OPERATORS:
            raise ValueError(f"applied_operator 必须是 {OPERATORS} 之一")
        return v


class CommitRequest(BaseModel):
    deepened_ids: list[str] = Field(
        min_length=MIN_DEEPENED_IDS,
        max_length=MAX_DEEPENED_IDS,
    )


class RegenerateCandidateRequest(BaseModel):
    candidate_id: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/state")
async def get_state(project_id: str) -> dict:
    _ensure_project(project_id)
    state = load_state(project_id)
    if state is None:
        return {
            "schema_version": 1,
            "project_id": project_id,
            "raw_intent": None,
            "stage1_completed_at": None,
            "stage2_started_at": None,
            "stage2_completed_at": None,
            "stage2_candidates": [],
            "stage3_deepened": [],
            "committed": False,
            "committed_at": None,
        }
    from dataclasses import asdict
    return asdict(state)


@router.delete("/state")
async def delete_state(project_id: str) -> dict:
    _ensure_project(project_id)
    path = (
        Path(settings.projects_dir)
        / project_id
        / "creative_os"
        / "three_b_state.json"
    )
    if path.exists():
        path.unlink()
    return {"deleted": True, "project_id": project_id}


@router.post("/diverge")
async def post_diverge(project_id: str, body: DivergeRequest) -> dict:
    _ensure_project(project_id)
    raw_intent = RawIntent(
        prompt=body.prompt,
        genre_primary=body.genre_primary,
        genre_secondary=body.genre_secondary,
    )
    try:
        return await _get_engine().diverge(project_id, raw_intent)
    except Exception as exc:
        logger.exception("three-b diverge failed")
        raise HTTPException(
            status_code=503,
            detail={
                "error": True,
                "code": "DIVERGE_FAILED",
                "message": f"3B 并行发散失败: {exc}",
                "detail": {},
            },
        ) from exc


@router.post("/deepen")
async def post_deepen(project_id: str, body: DeepenRequest) -> dict:
    _ensure_project(project_id)
    try:
        result = await _get_engine().deepen(
            project_id, body.candidate_id, body.applied_operator,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "error": True,
                "code": "DEEPEN_VALIDATION",
                "message": str(exc),
                "detail": {},
            },
        ) from exc
    from dataclasses import asdict
    return {"deepened": asdict(result)}


@router.post("/commit")
async def post_commit(project_id: str, body: CommitRequest) -> dict:
    _ensure_project(project_id)
    try:
        return await _get_engine().commit(project_id, body.deepened_ids)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "error": True,
                "code": "COMMIT_VALIDATION",
                "message": str(exc),
                "detail": {},
            },
        ) from exc
    except Exception as exc:
        logger.exception("three-b commit failed")
        raise HTTPException(
            status_code=503,
            detail={
                "error": True,
                "code": "COMMIT_FAILED",
                "message": f"3B 概念合成失败: {exc}",
                "detail": {},
            },
        ) from exc


@router.post("/regenerate-candidate")
async def post_regenerate(
    project_id: str, body: RegenerateCandidateRequest,
) -> dict:
    """Re-run a single operator LLM call for one candidate (regenerated_count++)."""
    _ensure_project(project_id)
    try:
        fresh = await _get_engine().regenerate_candidate(
            project_id, body.candidate_id,
        )
    except ValueError as exc:
        # Missing state OR missing source candidate both surface as 404
        # with CANDIDATE_NOT_FOUND — the existing route contract (preserved).
        raise HTTPException(
            status_code=404,
            detail={
                "error": True,
                "code": "CANDIDATE_NOT_FOUND",
                "message": str(exc),
                "detail": {},
            },
        ) from exc
    from dataclasses import asdict
    return {"candidate": asdict(fresh)}
