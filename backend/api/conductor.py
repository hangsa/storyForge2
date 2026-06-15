from fastapi import APIRouter, HTTPException

from backend.config import settings
from backend.conductor.state_machine import StageStateMachine, Stage
from backend.conductor.impact_analyzer import ImpactAnalyzer

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
            "current_stage": target_stage.value,
            "from_stage": result.from_stage.value,
            "to_stage": result.to_stage.value,
            "preconditions": {},
        },
    }


# --- v1.6 Phase 3b: Rollback Impact Analysis ---


@router.post("/analyze-impact")
async def analyze_impact(data: dict):
    """
    Analyze impact of STAGE 1-3 setup file changes vs baseline.

    Request: { project_id: string, modified_files?: string[] }
    modified_files is optional; if omitted, auto-detects all 4 monitored files.

    Returns 400 if baseline not found or no changes detected.
    """
    project_id = data.get("project_id", "")
    modified_files = data.get("modified_files")

    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "VALIDATION_ERROR",
                "message": "project_id 不能为空",
                "detail": {},
            },
        )

    analyzer = ImpactAnalyzer(settings.projects_dir)

    if not analyzer.project_exists(project_id):
        raise HTTPException(
            status_code=404,
            detail={
                "error": True,
                "code": "PROJECT_NOT_FOUND",
                "message": f"项目 {project_id} 不存在",
                "detail": {},
            },
        )

    if not analyzer.has_baseline(project_id):
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "BASELINE_NOT_FOUND",
                "message": "尚未建立基线快照，请先进入 STAGE 4 写作阶段",
                "detail": {},
            },
        )

    report = analyzer.analyze(project_id, modified_files=modified_files)

    if not report.modified_files:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "NO_CHANGES_DETECTED",
                "message": "所有文件与基线一致，未检测到变更",
                "detail": {},
            },
        )

    return {
        "error": False,
        "code": "OK",
        "message": f"检测到 {len(report.modified_files)} 个文件变更",
        "detail": {
            "project_id": report.project_id,
            "modified_files": report.modified_files,
            "entries": [
                {
                    "chapter_number": e.chapter_number,
                    "scene_numbers": e.scene_numbers,
                    "priority": e.priority.value,
                    "reason": e.reason,
                    "affected_assets": e.affected_assets,
                }
                for e in report.entries
            ],
            "summary": report.summary,
        },
    }


@router.post("/execute-rollback")
async def execute_rollback(data: dict):
    """
    Execute rollback decision.

    Request: { project_id: string, action: "confirm" | "cancel" }
    confirm → update baseline to current file hashes
    cancel  → return guidance message (no file modification)
    """
    project_id = data.get("project_id", "")
    action = data.get("action", "")

    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "VALIDATION_ERROR",
                "message": "project_id 不能为空",
                "detail": {},
            },
        )

    if action not in ("confirm", "cancel"):
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "INVALID_ACTION",
                "message": "action 必须为 'confirm' 或 'cancel'",
                "detail": {},
            },
        )

    analyzer = ImpactAnalyzer(settings.projects_dir)

    if not analyzer.project_exists(project_id):
        raise HTTPException(
            status_code=404,
            detail={
                "error": True,
                "code": "PROJECT_NOT_FOUND",
                "message": f"项目 {project_id} 不存在",
                "detail": {},
            },
        )

    if action == "confirm":
        analyzer.update_baseline(project_id)
        return {
            "error": False,
            "code": "OK",
            "message": "基线已更新，当前设定已接受",
            "detail": {
                "status": "confirmed",
                "baseline_updated": True,
            },
        }
    else:
        return {
            "error": False,
            "code": "OK",
            "message": "请手动将设定文件恢复为修改前的版本，或重新进入 STAGE 1-3 调整设定",
            "detail": {
                "status": "cancelled",
                "baseline_updated": False,
            },
        }
