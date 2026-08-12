from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.api._errors import http_error
from backend.config import settings
from backend.utils.file_manager import FileManager
from backend.conductor.state_machine import StageStateMachine, Stage, STAGE_ORDER
from backend.agents.planner import PlannerAgent
from backend.services.agent_prompt_stores import (
    project_override_store,
    global_override_store,
)

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

    agent = PlannerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
        genre=project.get("genre", "cool_novel"),
    )
    try:
        user_modifications = str(data.get("user_modifications", ""))[:1700]
        result, response = await agent.generate_concept_and_dna(
            initial_intent=project.get("initial_intent", {}).get("free_text", ""),
            genre=project.get("genre", "cool_novel"),
            user_modifications=user_modifications,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": True, "code": "LLM_GENERATION_FAILED", "message": str(e), "detail": {}},
        )

    # Warnings are runtime-only (e.g. tone-alignment mismatch). Pop them
    # BEFORE writing to concept_and_dna.json so they don't pollute the
    # persisted data file. Surface them in the API response so the frontend
    # can flag them; the next /stage1/generate call re-evaluates.
    warnings = result.pop("warnings", [])

    fm.write_json(project_id, "concept_and_dna.json", result)

    return {
        "error": False,
        "code": "OK",
        "message": "概念和 Story DNA 生成成功",
        "detail": result,
        "warnings": warnings,
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


class RegenerateConceptSectionPayload(BaseModel):
    section: str = Field(...)
    user_modifications: str = Field(default="", max_length=1700)


@router.post("/regenerate-section")
async def regenerate_concept_section(
    project_id: str = Query(...),
    payload: RegenerateConceptSectionPayload = None,
):
    """Re-run concept generation and merge only the requested section
    (`concept` or `story_dna`) back into `concept_and_dna.json`.
    Other fields are preserved byte-identical."""
    # Re-resolve at call time so test mocks patch correctly.
    from backend.agents.planner import PlannerAgent

    if not project_id:
        raise http_error(400, "VALIDATION_ERROR", "project_id 不能为空")

    if payload.section not in ("concept", "dna"):
        raise http_error(
            400,
            "VALIDATION_ERROR",
            f"section 必须是 concept 或 dna，收到 {payload.section}",
            section=payload.section,
        )

    project = fm.read_json(project_id, "project.json")
    if project is None:
        raise http_error(404, "PROJECT_NOT_FOUND", f"项目 {project_id} 不存在")

    existing = fm.read_json(project_id, "concept_and_dna.json") or {}

    agent = PlannerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
        genre=project.get("genre", "cool_novel"),
    )
    try:
        result, _resp = await agent.generate_concept_and_dna(
            initial_intent=project.get("initial_intent", {}).get("free_text", ""),
            genre=project.get("genre", "cool_novel"),
            user_modifications=payload.user_modifications,
        )
    except ValueError as e:
        raise http_error(503, "LLM_GENERATION_FAILED", str(e))

    new_concept = result.get("concept", {})
    new_dna = result.get("story_dna", {})

    merged = dict(existing)
    if payload.section == "concept":
        merged["concept"] = new_concept
    else:  # "dna"
        merged["story_dna"] = new_dna

    # Drop any runtime warnings from the LLM result — they live in `result`
    # but we never merge the full result, so they don't pollute storage.
    fm.write_json(project_id, "concept_and_dna.json", merged)

    return {
        "error": False,
        "code": "OK",
        "message": f"{payload.section} 已重新生成",
        "detail": merged,
    }
