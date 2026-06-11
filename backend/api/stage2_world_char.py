from fastapi import APIRouter, HTTPException, Query

from backend.config import settings
from backend.utils.file_manager import FileManager
from backend.conductor.state_machine import StageStateMachine, Stage
from backend.agents.planner import PlannerAgent

router = APIRouter(prefix="/api/stage2", tags=["stage2"])
fm = FileManager(settings.projects_dir)


@router.get("/world")
async def get_world(project_id: str = Query(...)):
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )
    data = fm.read_json(project_id, "world.json")
    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": data or {},
    }


@router.get("/character")
async def get_character(project_id: str = Query(...)):
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )
    data = fm.read_json(project_id, "characters.json")
    characters = (data or {}).get("characters", [])
    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": characters[0] if characters else {},
    }


@router.post("/generate-world")
async def generate_world(data: dict):
    project_id = data.get("project_id", "")
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    sm = StageStateMachine(settings.projects_dir)
    current = sm.get_current_stage(project_id)
    if current != Stage.STAGE2:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "STAGE_NOT_READY",
                "message": f"当前阶段为 {current.value}，无法执行 STAGE2 操作",
                "detail": {},
            },
        )

    concept_and_dna = fm.read_json(project_id, "concept_and_dna.json")
    if concept_and_dna is None:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "PRECONDITION_FAILED", "message": "请先生成概念 (STAGE1)", "detail": {}},
        )

    project = fm.read_json(project_id, "project.json")
    agent = PlannerAgent(project_id)
    try:
        result, response = await agent.generate_world(
            concept=concept_and_dna.get("concept", {}),
            story_dna=concept_and_dna.get("story_dna", {}),
            genre=project.get("genre", "cool_novel") if project else "cool_novel",
        )
    except ValueError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": True, "code": "LLM_GENERATION_FAILED", "message": str(e), "detail": {}},
        )

    fm.write_json(project_id, "world.json", result)

    return {
        "error": False,
        "code": "OK",
        "message": "世界观生成成功",
        "detail": result,
    }


@router.post("/generate-character")
async def generate_character(data: dict):
    project_id = data.get("project_id", "")
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    sm = StageStateMachine(settings.projects_dir)
    current = sm.get_current_stage(project_id)
    if current != Stage.STAGE2:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "STAGE_NOT_READY",
                "message": f"当前阶段为 {current.value}，无法执行 STAGE2 操作",
                "detail": {},
            },
        )

    concept_and_dna = fm.read_json(project_id, "concept_and_dna.json")
    world = fm.read_json(project_id, "world.json")
    if concept_and_dna is None or world is None:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "PRECONDITION_FAILED", "message": "请先生成概念和世界观", "detail": {}},
        )

    agent = PlannerAgent(project_id)
    try:
        result, response = await agent.generate_character(
            concept=concept_and_dna.get("concept", {}),
            world=world,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": True, "code": "LLM_GENERATION_FAILED", "message": str(e), "detail": {}},
        )

    characters = {"characters": [result]}
    fm.write_json(project_id, "characters.json", characters)

    return {
        "error": False,
        "code": "OK",
        "message": "角色生成成功",
        "detail": result,
    }


@router.put("/world")
async def update_world(data: dict):
    project_id = data.get("project_id", "")
    world_data = data.get("world", data)

    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    fm.write_json(project_id, "world.json", world_data)

    return {
        "error": False,
        "code": "OK",
        "message": "世界观已更新",
        "detail": world_data,
    }


@router.put("/character")
async def update_character(data: dict):
    project_id = data.get("project_id", "")
    character_data = data.get("character", data)

    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    fm.write_json(project_id, "characters.json", character_data)

    return {
        "error": False,
        "code": "OK",
        "message": "角色已更新",
        "detail": character_data,
    }
