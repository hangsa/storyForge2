from fastapi import APIRouter, HTTPException, Query

from backend.config import settings
from backend.utils.file_manager import FileManager
from backend.conductor.state_machine import StageStateMachine, Stage
from backend.agents.planner import PlannerAgent

router = APIRouter(prefix="/api/stage3", tags=["stage3"])
fm = FileManager(settings.projects_dir)


@router.get("/outline")
async def get_outline(project_id: str = Query(...)):
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )
    data = fm.read_json(project_id, "outline.json") or {}
    if "chapters" not in data:
        data = {"chapters": [data]} if data else {"chapters": []}
    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": data,
    }


@router.post("/generate")
async def generate_outline(data: dict):
    project_id = data.get("project_id", "")
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    sm = StageStateMachine(settings.projects_dir)
    current = sm.get_current_stage(project_id)
    if current != Stage.STAGE3:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "STAGE_NOT_READY",
                "message": f"当前阶段为 {current.value}，无法执行 STAGE3 操作",
                "detail": {},
            },
        )

    concept_and_dna = fm.read_json(project_id, "concept_and_dna.json")
    world = fm.read_json(project_id, "world.json")
    characters_data = fm.read_json(project_id, "characters.json")

    if not all([concept_and_dna, world, characters_data]):
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "PRECONDITION_FAILED", "message": "缺少前置数据", "detail": {}},
        )

    characters = characters_data.get("characters", [])
    character = characters[0] if characters else {}

    project = fm.read_json(project_id, "project.json")

    agent = PlannerAgent(project_id)
    try:
        result, response = await agent.generate_outline(
            concept=concept_and_dna.get("concept", {}),
            story_dna=concept_and_dna.get("story_dna", {}),
            world=world,
            character=character,
            chapter_number=data.get("chapter_number", 1),
            min_words=project.get("min_words", 4000) if project else 4000,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": True, "code": "LLM_GENERATION_FAILED", "message": str(e), "detail": {}},
        )

    # Accumulate chapters: merge new chapter with existing outline
    existing_outline = fm.read_json(project_id, "outline.json") or {}
    existing_chapters = existing_outline.get("chapters", [])
    existing_chapters = [ch for ch in existing_chapters
                         if ch.get("chapter_number") != result.get("chapter_number")]
    existing_chapters.append(result)
    existing_chapters.sort(key=lambda ch: ch.get("chapter_number", 0))
    merged_outline = {"chapters": existing_chapters}
    fm.write_json(project_id, "outline.json", merged_outline)

    # Bind character growth curves to the accumulated outline
    from backend.growth_curve.binder import bind_growth_curve_to_outline
    characters = characters_data.get("characters", [])
    updated_characters = bind_growth_curve_to_outline(characters, merged_outline)
    fm.write_json(project_id, "characters.json", {"characters": updated_characters})

    return {
        "error": False,
        "code": "OK",
        "message": "大纲生成成功",
        "detail": {"chapters": merged_outline["chapters"]},
    }


@router.put("/outline")
async def update_outline(data: dict):
    project_id = data.get("project_id", "")
    outline_data = data.get("outline", data)

    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    fm.write_json(project_id, "outline.json", outline_data)

    return {
        "error": False,
        "code": "OK",
        "message": "大纲已更新",
        "detail": outline_data,
    }
