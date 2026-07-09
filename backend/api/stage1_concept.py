from fastapi import APIRouter, HTTPException, Query

from backend.config import settings
from backend.utils.file_manager import FileManager
from backend.conductor.state_machine import StageStateMachine, Stage, STAGE_ORDER
from backend.agents.planner import PlannerAgent

router = APIRouter(prefix="/api/stage1", tags=["stage1"])
fm = FileManager(settings.projects_dir)


@router.get("/concept")
async def get_concept(project_id: str = Query(...)):
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )
    data = fm.read_json(project_id, "concept_and_dna.json")
    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": data or {},
    }


@router.post("/generate")
async def generate_concept(data: dict):
    project_id = data.get("project_id", "")
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    sm = StageStateMachine(settings.projects_dir)
    current = sm.get_current_stage(project_id)
    if STAGE_ORDER.index(current) < STAGE_ORDER.index(Stage.STAGE1):
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "STAGE_NOT_READY",
                "message": f"当前阶段为 {current.value}，无法执行 STAGE1 操作",
                "detail": {},
            },
        )

    project = fm.read_json(project_id, "project.json")
    if project is None:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "PROJECT_NOT_FOUND", "message": f"项目 {project_id} 不存在", "detail": {}},
        )

    agent = PlannerAgent(project_id)
    try:
        result, response = await agent.generate_concept_and_dna(
            initial_intent=project.get("initial_intent", {}).get("free_text", ""),
            genre=project.get("genre", "cool_novel"),
        )
    except ValueError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": True, "code": "LLM_GENERATION_FAILED", "message": str(e), "detail": {}},
        )

    fm.write_json(project_id, "concept_and_dna.json", result)

    return {
        "error": False,
        "code": "OK",
        "message": "概念和 Story DNA 生成成功",
        "detail": result,
    }


@router.put("/concept")
async def update_concept(data: dict):
    project_id = data.get("project_id", "")
    concept = data.get("concept") or {}
    story_dna = data.get("story_dna") or {}

    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    if not fm.project_exists(project_id):
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "PROJECT_NOT_FOUND", "message": f"项目 {project_id} 不存在", "detail": {}},
        )

    concept_and_dna = {"concept": concept, "story_dna": story_dna}
    fm.write_json(project_id, "concept_and_dna.json", concept_and_dna)

    return {
        "error": False,
        "code": "OK",
        "message": "概念已更新",
        "detail": concept_and_dna,
    }
