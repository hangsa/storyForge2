"""Stage2 地图系统 API — /api/stage2/map/* (基础 CRUD) + /generate-map。

挂在 stage2 router,与其他 app 端点共用 prefix /api/stage2。Map 端点
本身不需要 STAGE2 precondition(MapStep 可后向补做,见 PRD §0.5)。
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.config import settings
from backend.map_system.models import Map as MapModel
from backend.map_system.storage import load_map, save_map
from backend.utils.file_manager import FileManager


router = APIRouter(prefix="/api/stage2", tags=["stage2-map"])
fm = FileManager(settings.projects_dir)


def _file_manager() -> FileManager:
    return FileManager(settings.projects_dir)


@router.get("/map")
async def get_map(project_id: str = Query(...)):
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )
    data = load_map(project_id)
    if data is None:
        return {"error": False, "code": "OK", "message": "", "detail": {}}
    try:
        data = MapModel.model_validate(data).model_dump(by_alias=True)
    except Exception:
        # 旧/损坏 map.json — 走读原数据,前端 normalize 处理
        pass
    return {"error": False, "code": "OK", "message": "", "detail": data}


class PutMapPayload(BaseModel):
    map: dict


@router.put("/map")
async def put_map(project_id: str = Query(...), payload: PutMapPayload = None):
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )
    if payload is None or not payload.map:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "请求体不能为空", "detail": {}},
        )
    try:
        validated = MapModel.model_validate(payload.map)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail={"error": True, "code": "MAP_VALIDATION_FAILED",
                    "message": f"map 校验失败: {e}", "detail": {}},
        )
    save_map(project_id, validated)
    return {"error": False, "code": "OK", "message": "map 已保存",
            "detail": validated.model_dump(by_alias=True)}