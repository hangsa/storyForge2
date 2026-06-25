from fastapi import APIRouter, HTTPException, Query

from backend.config import settings
from backend.utils.file_manager import FileManager
from backend.conductor.state_machine import StageStateMachine, Stage, STAGE_ORDER
from backend.conductor.branch_simulator import BranchSimulator
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
    if STAGE_ORDER.index(current) < STAGE_ORDER.index(Stage.STAGE3):
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

    novel_outline = fm.read_json(project_id, "novel_outline.json") or None

    agent = PlannerAgent(project_id)
    try:
        result, response = await agent.generate_outline(
            concept=concept_and_dna.get("concept", {}),
            story_dna=concept_and_dna.get("story_dna", {}),
            world=world,
            character=character,
            chapter_number=data.get("chapter_number", 1),
            min_words=project.get("min_words", 4000) if project else 4000,
            novel_outline=novel_outline,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": True, "code": "LLM_GENERATION_FAILED", "message": str(e), "detail": {}},
        )

    # Accumulate chapters: merge new chapter with existing outline
    existing_outline = fm.read_json(project_id, "outline.json") or {}
    # Migrate old single-chapter format (no "chapters" key) to list format
    if "chapters" not in existing_outline:
        existing_outline = {"chapters": [existing_outline]} if existing_outline else {"chapters": []}
    existing_chapters = existing_outline.get("chapters", [])
    existing_chapters = [ch for ch in existing_chapters
                         if ch.get("chapter_number") != result.get("chapter_number")]
    existing_chapters.append(result)
    existing_chapters.sort(key=lambda ch: ch.get("chapter_number", 0))
    merged_outline = {"chapters": existing_chapters}
    fm.write_json(project_id, "outline.json", merged_outline)

    # Auto-generate growth curves for characters without them, then bind to outline
    from backend.growth_curve.auto_generator import auto_generate_growth_curves
    from backend.growth_curve.binder import bind_growth_curve_to_outline
    characters = characters_data.get("characters", [])
    characters = auto_generate_growth_curves(characters, merged_outline)
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


# --- Novel-Level Outline Endpoints (v1.7 Phase 3) ---


@router.get("/novel-outline")
async def get_novel_outline(project_id: str = Query(...)):
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )
    data = fm.read_json(project_id, "novel_outline.json") or {}
    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": data,
    }


@router.post("/generate-novel-outline")
async def generate_novel_outline(data: dict):
    project_id = data.get("project_id", "")
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    sm = StageStateMachine(settings.projects_dir)
    current = sm.get_current_stage(project_id)
    if STAGE_ORDER.index(current) < STAGE_ORDER.index(Stage.STAGE3):
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "STAGE_NOT_READY",
                "message": f"当前阶段为 {current.value}，无法生成全书大纲",
                "detail": {},
            },
        )

    concept_and_dna = fm.read_json(project_id, "concept_and_dna.json")
    world = fm.read_json(project_id, "world.json")
    characters_data = fm.read_json(project_id, "characters.json")

    if not all([concept_and_dna, world, characters_data]):
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "PRECONDITION_FAILED",
                "message": "缺少前置数据：需先生成概念 (STAGE1)、世界观与角色 (STAGE2)",
                "detail": {},
            },
        )

    characters = characters_data.get("characters", [])
    character = characters[0] if characters else {}

    project = fm.read_json(project_id, "project.json")
    min_words = project.get("min_words", 4000) if project else 4000

    agent = PlannerAgent(project_id)
    try:
        result, response = await agent.generate_novel_outline(
            concept=concept_and_dna.get("concept", {}),
            story_dna=concept_and_dna.get("story_dna", {}),
            world=world,
            character=character,
            min_words=min_words,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": True, "code": "LLM_GENERATION_FAILED", "message": str(e), "detail": {}},
        )

    from datetime import datetime
    now = datetime.utcnow().isoformat()
    existing = fm.read_json(project_id, "novel_outline.json") or {}
    result["generated_at"] = existing.get("generated_at", now) if existing.get("generated_at") else now
    result["updated_at"] = now

    fm.write_json(project_id, "novel_outline.json", result)

    return {
        "error": False,
        "code": "OK",
        "message": "全书大纲生成成功",
        "detail": result,
    }


@router.put("/novel-outline")
async def update_novel_outline(data: dict):
    project_id = data.get("project_id", "")
    novel_outline_data = data.get("novel_outline", data)

    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    from datetime import datetime
    existing = fm.read_json(project_id, "novel_outline.json") or {}
    novel_outline_data["generated_at"] = existing.get("generated_at", "")
    novel_outline_data["updated_at"] = datetime.utcnow().isoformat()
    if not existing.get("generated_at") and not novel_outline_data.get("generated_at"):
        novel_outline_data["generated_at"] = novel_outline_data["updated_at"]

    fm.write_json(project_id, "novel_outline.json", novel_outline_data)

    return {
        "error": False,
        "code": "OK",
        "message": "全书大纲已更新",
        "detail": novel_outline_data,
    }


# --- Branch Simulation Endpoints (v1.7 Phase 2) ---

branch_router = APIRouter(
    prefix="/api/v1/projects/{project_id}/branches",
    tags=["branches"],
)


def _get_fm() -> FileManager:
    """Return a FileManager using the current settings.projects_dir.

    Lazily evaluated so that tests can change settings.projects_dir at
    runtime and the API picks up the new path.
    """
    return FileManager(settings.projects_dir)


@branch_router.post("/simulate")
async def simulate_branch(project_id: str, data: dict):
    description = data.get("description", "")
    if not description:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "VALIDATION_ERROR",
                "message": "description 不能为空",
                "detail": {},
            },
        )

    if not _get_fm().project_exists(project_id):
        raise HTTPException(
            status_code=404,
            detail={
                "error": True,
                "code": "PROJECT_NOT_FOUND",
                "message": f"项目 {project_id} 不存在",
                "detail": {},
            },
        )

    simulator = BranchSimulator(
        projects_dir=settings.projects_dir,
    )

    report = await simulator.simulate(project_id, description)
    simulator.save_report(project_id, report)

    response_data = {
        "branch_point_description": report.branch_point_description,
        "affected_chapter_range": list(report.affected_chapter_range),
        "affected_characters": report.affected_characters,
        "affected_foreshadowings": report.affected_foreshadowings,
        "growth_curve_shifts": report.growth_curve_shifts,
        "reader_metrics_projection": report.reader_metrics_projection,
        "tension_curve_projection": None,
        "foreshadowing_risk_assessment": None,
        "alternative_suggestions": None,
        "created_at": report.created_at,
        "tokens_used_total": report.tokens_used_total,
    }

    if report.tension_curve_projection:
        response_data["tension_curve_projection"] = {
            "content": report.tension_curve_projection.content,
            "confidence": report.tension_curve_projection.confidence,
        }
    if report.foreshadowing_risk_assessment:
        response_data["foreshadowing_risk_assessment"] = {
            "content": report.foreshadowing_risk_assessment.content,
            "confidence": report.foreshadowing_risk_assessment.confidence,
        }
    if report.alternative_suggestions:
        response_data["alternative_suggestions"] = {
            "content": report.alternative_suggestions.content,
            "confidence": report.alternative_suggestions.confidence,
        }

    return {
        "error": False,
        "code": "OK",
        "message": "分支模拟完成",
        "detail": response_data,
    }


@branch_router.get("/history")
async def list_branch_history(project_id: str):
    if not _get_fm().project_exists(project_id):
        raise HTTPException(
            status_code=404,
            detail={
                "error": True,
                "code": "PROJECT_NOT_FOUND",
                "message": f"项目 {project_id} 不存在",
                "detail": {},
            },
        )

    simulator = BranchSimulator(
        projects_dir=settings.projects_dir,
    )
    history = simulator.list_history(project_id)

    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": history,
    }
