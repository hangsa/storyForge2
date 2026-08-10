import logging

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.api._errors import http_error
from backend.config import settings
from backend.utils.file_manager import FileManager
from backend.conductor.state_machine import StageStateMachine, Stage, STAGE_ORDER
from backend.conductor.branch_simulator import BranchSimulator
from backend.agents.planner import PlannerAgent
from backend.llm.model_router import get_model_router
from backend.services.agent_prompt_stores import (
    project_override_store,
    global_override_store,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/stage3", tags=["stage3"])
fm = FileManager(settings.projects_dir)

# Maps the section name in the request payload to (target_key, default_value)
# on the novel_outline.json document. Single source of truth for both the
# validation whitelist and the per-branch merge keys.
NOVEL_OUTLINE_SECTION_TO_KEY = {
    "core_conflict": ("core_conflict_theme", ""),
    "volumes": ("volumes", []),
    "mc_growth": ("mc_growth_arc", []),
    "key_plot": ("key_plot_points", []),
}


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

    agent = PlannerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
        genre=project.get("genre", "cool_novel") if project else "cool_novel",
    )
    try:
        user_modifications = str(data.get("user_modifications", ""))[:1000]
        result, response = await agent.generate_outline(
            concept=concept_and_dna.get("concept", {}),
            story_dna=concept_and_dna.get("story_dna", {}),
            world=world,
            character=character,
            chapter_number=data.get("chapter_number", 1),
            min_words=project.get("min_words", 4000) if project else 4000,
            novel_outline=novel_outline,
            user_modifications=user_modifications,
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

    # Keep progress.json's stored total_chapters in sync — without this,
    # the /stage4/progress endpoint reports a stale denominator ("X / 20")
    # when the user has extended the outline to e.g. 30 via the
    # "+ 新章节" UI. Take max(stored, novel_outline, outline_count).
    progress = fm.read_json(project_id, "progress.json") or {}
    novel_outline = fm.read_json(project_id, "novel_outline.json") or {}
    novel_total = 0
    for volume in (novel_outline.get("volumes", []) or []):
        if not isinstance(volume, dict):
            continue
        rng = volume.get("chapter_range", "")
        if not isinstance(rng, str) or "-" not in rng:
            continue
        try:
            end = int(rng.split("-")[-1])
            novel_total = max(novel_total, end)
        except (ValueError, IndexError):
            continue
    outline_count = len(merged_outline["chapters"])
    stored_total = progress.get("total_chapters") or 0
    refreshed = max(stored_total, novel_total, outline_count)
    if refreshed and refreshed != stored_total:
        progress["total_chapters"] = refreshed
        fm.write_json(project_id, "progress.json", progress)

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

    project = fm.read_json(project_id, "project.json")
    min_words = project.get("min_words", 2000) if project else 2000
    target_total_words = project.get("target_total_words", 1_000_000) if project else 1_000_000

    # Map system is optional — MapStep is a placeholder today. The file may
    # not exist; read_json returns None and the agent skips the section.
    map_data = fm.read_json(project_id, "map.json")

    agent = PlannerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
        genre=project.get("genre", "cool_novel") if project else "cool_novel",
    )
    try:
        user_modifications = str(data.get("user_modifications", ""))[:1000]
        result, response = await agent.generate_novel_outline(
            concept=concept_and_dna.get("concept", {}),
            story_dna=concept_and_dna.get("story_dna", {}),
            world=world,
            characters=characters,
            target_total_words=target_total_words,
            min_words=min_words,
            map_data=map_data,
            user_modifications=user_modifications,
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


class RegenerateNovelOutlineSectionPayload(BaseModel):
    section: str
    user_modifications: str = Field(default="", max_length=1000)


@router.post("/regenerate-novel-outline-section")
async def regenerate_novel_outline_section(
    project_id: str = Query(...),
    payload: RegenerateNovelOutlineSectionPayload = None,
):
    """Re-run novel-outline generation and merge only the requested section
    back into novel_outline.json. Other top-level fields preserved.

    Sections: core_conflict (string), volumes (array), mc_growth (array),
    key_plot (array). Preserve generated_at from the existing file;
    refresh updated_at.
    """
    # Re-resolve at call time so test mocks patch correctly.
    from backend.agents.planner import PlannerAgent
    from datetime import datetime

    if not project_id:
        raise http_error(400, "VALIDATION_ERROR", "project_id 不能为空")

    if payload.section not in NOVEL_OUTLINE_SECTION_TO_KEY:
        raise http_error(
            400,
            "VALIDATION_ERROR",
            f"section 必须是 {', '.join(NOVEL_OUTLINE_SECTION_TO_KEY)}，收到 {payload.section}",
            section=payload.section,
        )

    project = fm.read_json(project_id, "project.json")
    if project is None:
        raise http_error(404, "PROJECT_NOT_FOUND", f"项目 {project_id} 不存在")

    existing = fm.read_json(project_id, "novel_outline.json") or {}
    concept_and_dna = fm.read_json(project_id, "concept_and_dna.json") or {}
    world = fm.read_json(project_id, "world.json") or {}
    characters_data = fm.read_json(project_id, "characters.json") or {}
    map_data = fm.read_json(project_id, "map.json")

    characters = characters_data.get("characters", [])
    min_words = project.get("min_words", 2000)
    target_total_words = project.get("target_total_words", 1_000_000)
    genre = project.get("genre", "cool_novel")

    agent = PlannerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
        genre=genre,
    )
    try:
        result, _resp = await agent.generate_novel_outline(
            concept=concept_and_dna.get("concept", {}),
            story_dna=concept_and_dna.get("story_dna", {}),
            world=world,
            characters=characters,
            target_total_words=target_total_words,
            min_words=min_words,
            map_data=map_data,
            user_modifications=payload.user_modifications,
        )
    except ValueError as e:
        raise http_error(503, "LLM_GENERATION_FAILED", str(e))

    merged = dict(existing)
    key, default = NOVEL_OUTLINE_SECTION_TO_KEY[payload.section]
    merged[key] = result.get(key, existing.get(key, default))

    # Preserve generated_at from the existing file; refresh updated_at only.
    now = datetime.utcnow().isoformat()
    merged["generated_at"] = existing.get("generated_at") or now
    merged["updated_at"] = now

    fm.write_json(project_id, "novel_outline.json", merged)

    return {
        "error": False,
        "code": "OK",
        "message": f"{payload.section} 已重新生成",
        "detail": merged,
    }

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
    if not description or not description.strip():
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "VALIDATION_ERROR",
                "message": "description 不能为空",
                "detail": {},
            },
        )
    if len(description) > 1000:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "VALIDATION_ERROR",
                "message": "description 长度不能超过 1000 字符",
                "detail": {"max_length": 1000, "actual_length": len(description)},
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

    try:
        router = get_model_router()
    except Exception as e:
        logger.warning("Failed to get model router, proceeding with deterministic-only: %s", e)
        router = None

    simulator = BranchSimulator(
        projects_dir=settings.projects_dir,
        model_router=router,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
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
        override_store=project_override_store(),
        global_override_store=global_override_store(),
    )
    history = simulator.list_history(project_id)

    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": history,
    }
