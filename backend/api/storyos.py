from fastapi import APIRouter, HTTPException

from backend.config import settings
from backend.story_os.registries import RegistryManager

router = APIRouter(prefix="/api/storyos", tags=["storyos"])

VALID_TYPES = {"conflict", "mystery", "twist", "goal"}

PLURAL_TO_SINGULAR = {
    "conflicts": "conflict",
    "mysteries": "mystery",
    "twists": "twist",
    "goals": "goal",
}


@router.get("/{registry_type}")
async def get_registry(registry_type: str, project_id: str):
    normalized = PLURAL_TO_SINGULAR.get(registry_type, registry_type)
    if normalized not in VALID_TYPES:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "INVALID_TYPE",
                "message": f"无效的注册表类型: {registry_type}",
                "detail": {"valid_types": sorted(list(VALID_TYPES) + list(PLURAL_TO_SINGULAR.keys()))},
            },
        )

    rm = RegistryManager(project_id, settings.projects_dir)
    items = rm.get_all(normalized)

    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": {
            "type": registry_type,
            "count": len(items),
            "items": items,
        },
    }
