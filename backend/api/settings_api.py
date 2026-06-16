from pathlib import Path

import yaml
from fastapi import APIRouter, HTTPException, Query

from backend.config import settings
from backend.llm.model_router import get_model_router
from backend.reader_os.thresholds import load_genre_thresholds
from backend.utils.file_manager import FileManager

router = APIRouter(prefix="/api/settings", tags=["settings"])
fm = FileManager(settings.projects_dir)


@router.get("/thresholds")
async def get_thresholds(project_id: str = Query(...)):
    if not project_id:
        raise HTTPException(status_code=400, detail={
            "error": True, "code": "VALIDATION_ERROR",
            "message": "project_id 不能为空", "detail": {},
        })

    project = fm.read_json(project_id, "project.json") or {}
    genre = project.get("genre", "cool_novel")
    all_defaults = load_genre_thresholds()

    defaults = all_defaults.get(genre)
    fallback_genre = None
    if defaults is None:
        fallback_genre = "cool_novel"
        defaults = all_defaults.get("generic", all_defaults.get("cool_novel", {}))

    overrides = project.get("genre_thresholds") or {}

    response = {
        "error": False, "code": "OK", "message": "",
        "detail": {
            "genre": genre,
            "defaults": defaults,
            "overrides": overrides,
        },
    }
    if fallback_genre:
        response["detail"]["fallback_genre"] = fallback_genre
    return response


@router.put("/thresholds")
async def update_thresholds(data: dict):
    project_id = data.get("project_id", "")
    if not project_id:
        raise HTTPException(status_code=400, detail={
            "error": True, "code": "VALIDATION_ERROR",
            "message": "project_id 不能为空", "detail": {},
        })

    overrides = data.get("overrides", {})
    project = fm.read_json(project_id, "project.json") or {}
    genre = project.get("genre", "cool_novel")
    all_defaults = load_genre_thresholds()
    valid_keys = all_defaults.get(genre, all_defaults.get("cool_novel", {})).keys()
    invalid = set(overrides.keys()) - set(valid_keys)
    if invalid:
        raise HTTPException(status_code=400, detail={
            "error": True, "code": "VALIDATION_ERROR",
            "message": f"无效的阈值键: {', '.join(sorted(invalid))}",
            "detail": {"valid_keys": sorted(valid_keys)},
        })

    project["genre_thresholds"] = overrides
    fm.write_json(project_id, "project.json", project)

    return {
        "error": False, "code": "OK", "message": "阈值已更新",
        "detail": {"status": "updated"},
    }


@router.get("/model-config")
async def get_model_config():
    config_path = Path("config/model_tiers.yaml")
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = yaml.safe_load(f)
        return {
            "error": False, "code": "OK", "message": "",
            "detail": config,
        }
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail={
            "error": True, "code": "CONFIG_NOT_FOUND",
            "message": "model_tiers.yaml 不存在", "detail": {},
        })


@router.post("/reload-config")
async def reload_config():
    try:
        router = get_model_router()
        router.reload_config()
        return {
            "error": False, "code": "OK", "message": "配置已重载",
            "detail": {"status": "reloaded"},
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail={
            "error": True, "code": "RELOAD_FAILED",
            "message": f"重载失败: {str(e)}", "detail": {},
        })
