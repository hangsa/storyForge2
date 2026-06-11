from fastapi import APIRouter, HTTPException

from backend.config import settings
from backend.conductor.state_machine import StageStateMachine, Stage

router = APIRouter(prefix="/api/conductor", tags=["conductor"])
sm = StageStateMachine(settings.projects_dir)


@router.post("/advance")
async def advance_stage(data: dict):
    project_id = data.get("project_id", "")
    target_stage_str = data.get("target_stage", "")

    if not project_id or not target_stage_str:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "VALIDATION_ERROR",
                "message": "project_id 和 target_stage 不能为空",
                "detail": {},
            },
        )

    try:
        target_stage = Stage(target_stage_str)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "STAGE_TRANSITION_INVALID",
                "message": f"无效的阶段: {target_stage_str}",
                "detail": {"valid_stages": [s.value for s in Stage]},
            },
        )

    current = sm.get_current_stage(project_id)
    if current == Stage.INIT and not sm._project_dir(project_id).exists():
        raise HTTPException(
            status_code=404,
            detail={
                "error": True,
                "code": "PROJECT_NOT_FOUND",
                "message": f"项目 {project_id} 不存在",
                "detail": {},
            },
        )

    result = sm.advance(project_id, target_stage)

    if not result.allowed:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "STAGE_NOT_READY",
                "message": result.message,
                "detail": {
                    "from_stage": result.from_stage.value,
                    "to_stage": result.to_stage.value,
                    "missing_files": result.missing_files,
                    "failed_checks": result.failed_checks,
                },
            },
        )

    return {
        "error": False,
        "code": "OK",
        "message": result.message,
        "detail": {
            "from_stage": result.from_stage.value,
            "to_stage": result.to_stage.value,
        },
    }
