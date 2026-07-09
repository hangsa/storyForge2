from typing import Optional

from fastapi import APIRouter, HTTPException

from backend.llm.model_router import get_model_router
from backend.style_engine.sandbox_models import (
    PreviewRequest, PreviewResponse, SaveStyleRequest,
    SavedStyleConfig,
)
from backend.style_engine.sandbox_renderer import (
    list_sandbox_configs, load_sandbox_config, render_preview,
    save_sandbox_config, _sanitize_name,
)

router = APIRouter(prefix="/api/v1/projects/{project_id}/style/sandbox", tags=["style-sandbox"])


def _envelope(detail: dict, code: str = "OK") -> dict:
    return {"error": False, "code": code, "message": "ok", "detail": detail}


def _err(code: str, message: str, status: int = 400, detail: Optional[dict] = None) -> HTTPException:
    return HTTPException(status_code=status, detail={
        "error": True, "code": code, "message": message,
        "detail": detail or {},
    })


@router.post("/preview")
async def preview_endpoint(project_id: str, req: PreviewRequest) -> dict:
    mr = get_model_router()
    if mr is None:
        resp = PreviewResponse(
            rendered_text="", source_avg_length=0.0, rendered_avg_length=0.0,
            tokens_used=0, skipped_reason="no router",
        )
        return _envelope(resp.model_dump())
    resp = await render_preview(
        model_router=mr, source_text=req.source_text,
        params=req.params, genre=req.genre,
    )
    return _envelope(resp.model_dump())


@router.post("/save")
def save_endpoint(project_id: str, req: SaveStyleRequest) -> dict:
    safe = _sanitize_name(req.name)
    try:
        path = save_sandbox_config(project_id=project_id, name=safe, params=req.params)
    except FileExistsError:
        raise _err("CONFIG_EXISTS", f"已存在同名配置：{safe}", status=422)
    return _envelope({"name": safe, "path": str(path)})


@router.get("/configs")
def list_endpoint(project_id: str) -> dict:
    configs = list_sandbox_configs(project_id)
    return _envelope({"configs": [c.model_dump() for c in configs]})


@router.get("/configs/{name}")
def load_endpoint(project_id: str, name: str) -> dict:
    safe = _sanitize_name(name)
    try:
        cfg = load_sandbox_config(project_id=project_id, name=safe)
    except FileNotFoundError:
        raise _err("CONFIG_NOT_FOUND", f"配置不存在：{safe}", status=404)
    return _envelope(cfg.model_dump())
