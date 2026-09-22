"""Stage2 地图系统 API — /api/stage2/map/* (基础 CRUD) + /generate-map。

挂在 stage2 router,与其他 app 端点共用 prefix /api/stage2。Map 端点
本身不需要 STAGE2 precondition(MapStep 可后向补做,见 PRD §0.5)。
"""
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.config import settings
from backend.agents.planner import PlannerAgent
from backend.map_system.models import Map as MapModel
from backend.map_system.storage import load_map, save_map
from backend.services.agent_prompt_stores import (
    global_override_store,
    project_override_store,
)
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


@router.post("/generate-map")
async def generate_map(data: dict):
    project_id = data.get("project_id", "")
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )

    project = _file_manager().read_json(project_id, "project.json")
    if project is None:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "PROJECT_NOT_FOUND",
                    "message": f"项目 {project_id} 不存在", "detail": {}},
        )

    world = _file_manager().read_json(project_id, "world.json")
    if world is None:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "PRECONDITION_FAILED",
                    "message": "请先生成世界观 (STAGE2)", "detail": {}},
        )

    chars_data = _file_manager().read_json(project_id, "characters.json") or {}
    characters = chars_data.get("characters", [])

    agent = PlannerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
        genre=project.get("genre", "cool_novel"),
    )
    try:
        user_modifications = str(data.get("user_modifications", ""))[:1700]
        result, _resp = await agent.generate_map(
            world=world,
            characters=characters,
            user_modifications=user_modifications,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": True, "code": "LLM_GENERATION_FAILED",
                    "message": str(e), "detail": {}},
        )

    # Validate + coerce so on-disk map.json always matches Map schema.
    try:
        validated = MapModel.model_validate(result)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail={"error": True, "code": "MAP_VALIDATION_FAILED",
                    "message": f"LLM 输出校验失败: {e}", "detail": {}},
        )

    save_map(project_id, validated)
    return {
        "error": False,
        "code": "OK",
        "message": "地图生成成功",
        "detail": validated.model_dump(by_alias=True),
    }


class RegenerateMapSectionPayload(BaseModel):
    section: Literal["regions", "locations", "routes", "pois", "all"]
    index: Optional[int] = None
    user_modifications: str = ""


@router.post("/regenerate-map-section")
async def regenerate_map_section(
    project_id: str = Query(...),
    payload: RegenerateMapSectionPayload = None,
):
    """Re-run map generation and merge only the requested section back
    into map.json. Other top-level keys preserved byte-identical.

    Mirrors /regenerate-world-section semantics for the map system.
    """
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )
    if payload.section not in ("regions", "locations", "routes", "pois", "all"):
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "section 必须是 regions/locations/routes/pois/all",
                    "detail": {}},
        )

    project = _file_manager().read_json(project_id, "project.json")
    if project is None:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "PROJECT_NOT_FOUND",
                    "message": f"项目 {project_id} 不存在", "detail": {}},
        )

    existing = load_map(project_id) or {"schema_version": "1.0", "project_id": project_id}
    world = _file_manager().read_json(project_id, "world.json") or {}
    chars_data = _file_manager().read_json(project_id, "characters.json") or {}
    characters = chars_data.get("characters", [])

    agent = PlannerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
        genre=project.get("genre", "cool_novel"),
    )
    try:
        result, _resp = await agent.generate_map(
            world=world,
            characters=characters,
            user_modifications=payload.user_modifications,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": True, "code": "LLM_GENERATION_FAILED",
                    "message": str(e), "detail": {}},
        )

    merged = dict(existing)
    if payload.section == "all":
        for key in ("regions", "locations", "routes", "pois"):
            merged[key] = result.get(key, existing.get(key, []))
    else:
        merged[payload.section] = result.get(payload.section, existing.get(payload.section, []))

    try:
        validated = MapModel.model_validate(merged)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail={"error": True, "code": "MAP_VALIDATION_FAILED",
                    "message": f"regen 后 map 校验失败: {e}", "detail": {}},
        )

    save_map(project_id, validated)
    return {
        "error": False,
        "code": "OK",
        "message": f"map.{payload.section} 已重新生成",
        "detail": validated.model_dump(by_alias=True),
    }


@router.post("/map/location")
async def add_location(project_id: str = Query(...), payload: dict = None):
    """新增 location。id 由后端生成(避免前端造重)。"""
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )
    data = load_map(project_id) or {"schema_version": "1.0", "project_id": project_id}
    locations = list(data.get("locations", []))
    existing_ids = {l["id"] for l in locations}

    # id: 前端可传,但必须唯一;否则后端生成
    new_loc = dict(payload or {})
    if not new_loc.get("id") or new_loc["id"] in existing_ids:
        import secrets
        new_loc["id"] = "loc_" + secrets.token_hex(4)
    locations.append(new_loc)

    data["locations"] = locations
    try:
        validated = MapModel.model_validate(data)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail={"error": True, "code": "MAP_VALIDATION_FAILED",
                    "message": str(e), "detail": {}},
        )
    save_map(project_id, validated)
    new_id = new_loc["id"]
    return {"error": False, "code": "OK", "message": "location 已新增",
            "detail": next(l for l in validated.locations if l.id == new_id).model_dump(by_alias=True)}


@router.patch("/map/location/{location_id}")
async def patch_location(
    location_id: str,
    project_id: str = Query(...),
    payload: dict = None,
):
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )
    data = load_map(project_id)
    if not data:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "MAP_NOT_FOUND",
                    "message": "map.json 不存在", "detail": {}},
        )
    locations = list(data.get("locations", []))
    target_idx = next(
        (i for i, l in enumerate(locations) if l.get("id") == location_id),
        None,
    )
    if target_idx is None:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "LOCATION_NOT_FOUND",
                    "message": f"location {location_id} 不存在", "detail": {}},
        )

    merged_loc = {**locations[target_idx], **(payload or {})}
    locations[target_idx] = merged_loc
    data["locations"] = locations

    try:
        validated = MapModel.model_validate(data)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail={"error": True, "code": "MAP_VALIDATION_FAILED",
                    "message": str(e), "detail": {}},
        )
    save_map(project_id, validated)
    updated = next(l for l in validated.locations if l.id == location_id)
    return {"error": False, "code": "OK", "message": "location 已更新",
            "detail": updated.model_dump(by_alias=True)}


@router.delete("/map/location/{location_id}")
async def delete_location(
    location_id: str,
    project_id: str = Query(...),
):
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )
    data = load_map(project_id)
    if not data:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "MAP_NOT_FOUND",
                    "message": "map.json 不存在", "detail": {}},
        )

    # 检查 route 引用
    routes = data.get("routes", [])
    referenced_by = [r["id"] for r in routes if r.get("from") == location_id or r.get("to") == location_id]
    if referenced_by:
        raise HTTPException(
            status_code=422,
            detail={"error": True, "code": "LOCATION_REFERENCED_BY_ROUTES",
                    "message": f"location {location_id} 被 {len(referenced_by)} 条 route 引用, 请先删除相关路线",
                    "detail": {"referencing_route_ids": referenced_by}},
        )

    locations = [l for l in data.get("locations", []) if l.get("id") != location_id]
    data["locations"] = locations
    # 同步删 POI
    cascaded_pois = [p["id"] for p in data.get("pois", []) if p.get("parent_location_id") == location_id]
    if cascaded_pois:
        data["pois"] = [p for p in data.get("pois", []) if p.get("parent_location_id") != location_id]

    try:
        validated = MapModel.model_validate(data)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail={"error": True, "code": "MAP_VALIDATION_FAILED",
                    "message": str(e), "detail": {}},
        )
    save_map(project_id, validated)
    return {"error": False, "code": "OK", "message": "location 已删除",
            "detail": {"deleted_id": location_id, "cascaded_poi_removals": cascaded_pois}}