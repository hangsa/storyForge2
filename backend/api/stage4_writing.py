import json
from fastapi import APIRouter, HTTPException

from backend.config import settings
from backend.utils.file_manager import FileManager
from backend.conductor.state_machine import StageStateMachine, Stage
from backend.conductor.circuit_breaker import CircuitBreaker
from backend.conductor.checkpoint import CheckpointManager
from backend.agents.writer import WriterAgent
from backend.agents.reviewer import ReviewerAgent
from backend.agents.storyos_agent import StoryOSAgent
from backend.memory_os.l0_runtime import L0Runtime
from backend.memory_os.l1_hot import L1Hot

router = APIRouter(prefix="/api/stage4", tags=["stage4"])
fm = FileManager(settings.projects_dir)


def _load_context(project_id: str) -> dict:
    project = fm.read_json(project_id, "project.json")
    concept_and_dna = fm.read_json(project_id, "concept_and_dna.json")
    world = fm.read_json(project_id, "world.json")
    characters_data = fm.read_json(project_id, "characters.json")
    outline = fm.read_json(project_id, "outline.json") or {}

    # Normalize old-format outline (single chapter without chapters wrapper)
    if "chapters" not in outline and "scene_plan" in outline:
        outline = {"chapters": [outline]}

    characters = characters_data.get("characters", []) if characters_data else []
    character = characters[0] if characters else {}
    chapters = outline.get("chapters", [])
    chapter = chapters[0] if chapters else {}

    return {
        "project": project or {},
        "genre": project.get("genre", "cool_novel") if project else "cool_novel",
        "concept": concept_and_dna or {},
        "world": world or {},
        "character": character,
        "outline": outline or {},
        "chapter": chapter,
    }


@router.get("/scene-plan/{scene_num}")
async def get_scene_plan(scene_num: int, project_id: str):
    ctx = _load_context(project_id)
    scenes = ctx["chapter"].get("scene_plan", [])
    for scene in scenes:
        if scene.get("scene_number") == scene_num:
            return {
                "error": False,
                "code": "OK",
                "message": "",
                "detail": scene,
            }
    raise HTTPException(
        status_code=404,
        detail={"error": True, "code": "SCENE_NOT_FOUND", "message": f"Scene {scene_num} 不存在", "detail": {}},
    )


@router.post("/write-scene")
async def write_scene(data: dict):
    project_id = data.get("project_id", "")
    scene_number = data.get("scene_number", 1)

    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    sm = StageStateMachine(settings.projects_dir)
    current = sm.get_current_stage(project_id)
    if current != Stage.STAGE4:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "STAGE_NOT_READY",
                "message": f"当前阶段为 {current.value}，无法执行 STAGE4 操作",
                "detail": {},
            },
        )

    ctx = _load_context(project_id)
    scenes = ctx["chapter"].get("scene_plan", [])
    scene_plan = next(
        (s for s in scenes if s.get("scene_number") == scene_number), None
    )
    if scene_plan is None:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "SCENE_NOT_FOUND", "message": f"Scene {scene_number} 不存在", "detail": {}},
        )

    # Initialize per-request components
    l0 = L0Runtime()
    l1 = L1Hot()

    # Load L1 from previous scene drafts in this chapter
    chapters_dir = fm.project_path(project_id, "chapters")
    if chapters_dir.exists():
        for draft_file in sorted(chapters_dir.glob("scene_*_draft.md")):
            text = draft_file.read_text(encoding="utf-8")
            l1.append_scene(0, text)  # summary empty for now

    l0.set_scene_context(scene_number, scene_plan.get("goal", ""))

    writer = WriterAgent(project_id)
    reviewer = ReviewerAgent(project_id)
    storyos = StoryOSAgent(project_id)
    breaker = CircuitBreaker()

    # --- Write Phase ---
    try:
        result, response = await writer.write_scene(
            genre=ctx["genre"],
            concept=ctx["concept"],
            world_rules=ctx["world"],
            character=ctx["character"],
            scene_plan=scene_plan,
            l0_context=l0.get_context_string(),
            l1_context=l1.get_context_string(),
        )
    except ValueError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": True, "code": "LLM_GENERATION_FAILED", "message": str(e), "detail": {}},
        )

    draft_text = result.get("text", "")
    writer.log_usage("scene_writing", response)

    # --- Review & Retry Loop ---
    attempt = 1
    current_draft = draft_text

    while True:
        fg_result = reviewer.run_fact_guard(
            draft_text=current_draft,
            character=ctx["character"],
            world_rules=ctx["world"],
            scene_plan=scene_plan,
        )

        breaker_result = breaker.check(
            scene_number=scene_number,
            fact_guard_passed=fg_result.all_passed,
            attempt=attempt,
            hints=fg_result.retry_hints,
        )

        if breaker_result == "passed":
            break

        if breaker_result == "retry":
            attempt += 1
            hints = breaker.generate_retry_hints(
                scene_number,
                [
                    {"name": c.name, "passed": c.passed, "detail": c.detail}
                    for c in fg_result.checks
                ],
            )
            try:
                rewrite_result, rewrite_response = await writer.rewrite_scene(
                    genre=ctx["genre"],
                    concept=ctx["concept"],
                    world_rules=ctx["world"],
                    character=ctx["character"],
                    scene_plan=scene_plan,
                    retry_hints=hints,
                    previous_draft=current_draft,
                    l0_context=l0.get_context_string(),
                    l1_context=l1.get_context_string(),
                )
            except ValueError as e:
                raise HTTPException(
                    status_code=503,
                    detail={"error": True, "code": "LLM_GENERATION_FAILED", "message": str(e), "detail": {}},
                )
            current_draft = rewrite_result.get("text", "")
            writer.log_usage("scene_rewrite", rewrite_response)
            continue

        # force_pass
        break

    # --- StoryOS Update ---
    parsed_logs = storyos.parse_sf_logs(current_draft)
    registry_report = storyos.update_registries(parsed_logs)

    # Update L0 from character state changes
    l0.update_from_logs(registry_report.character_state_updates)

    # Save draft
    chapters_dir = fm.project_path(project_id, "chapters")
    chapters_dir.mkdir(parents=True, exist_ok=True)
    draft_file = chapters_dir / f"scene_{scene_number:03d}_draft.md"
    fm.write_markdown(project_id, f"chapters/scene_{scene_number:03d}_draft.md", current_draft)

    # Save checkpoint
    cpm = CheckpointManager(project_id)
    cpm.save(
        pipeline_stage="scene_written",
        current_chapter=ctx["chapter"].get("chapter_number", 1),
        current_scene=scene_number,
        l0_snapshot={"scene": scene_number, "goal": scene_plan.get("goal", "")},
        character_states=[ctx["character"]],
    )

    # Update progress
    progress = fm.read_json(project_id, "progress.json") or {
        "project_id": project_id,
        "current_stage": "STAGE4",
        "current_chapter": 1,
        "total_chapters": 1,
        "chapters": [],
        "circuit_breaker_events": [],
    }
    chapter_progress = next(
        (ch for ch in progress.get("chapters", [])
         if ch.get("chapter_number") == ctx["chapter"].get("chapter_number", 1)),
        None,
    )
    if chapter_progress is None:
        chapter_progress = {
            "chapter_number": ctx["chapter"].get("chapter_number", 1),
            "status": "in_progress",
            "scenes": [],
        }
        progress.setdefault("chapters", []).append(chapter_progress)

    scene_progress = next(
        (s for s in chapter_progress.get("scenes", [])
         if s.get("scene_number") == scene_number),
        None,
    )
    if scene_progress is None:
        chapter_progress.setdefault("scenes", []).append({
            "scene_number": scene_number,
            "status": "completed" if breaker_result == "passed" else "force_passed",
            "retry_count": attempt - 1,
            "coherence_score": fg_result.coherence_score,
        })

    breaker_events = [
        {
            "scene_number": e.scene_number,
            "attempt": e.attempt,
            "result": e.result,
            "timestamp": e.timestamp,
        }
        for e in breaker.get_events()
    ]
    progress["circuit_breaker_events"] = breaker_events
    fm.write_json(project_id, "progress.json", progress)

    return {
        "error": False,
        "code": "OK",
        "message": f"Scene {scene_number} 写作完成",
        "detail": {
            "scene_number": scene_number,
            "status": breaker_result,
            "retry_count": attempt - 1,
            "draft_text": current_draft,
            "parsed_logs": [
                {"type": log.type, "params": log.params} for log in parsed_logs
            ],
            "fact_guard_results": {
                "all_passed": fg_result.all_passed,
                "checks": [
                    {"check_id": c.check_id, "name": c.name, "passed": c.passed, "detail": c.detail}
                    for c in fg_result.checks
                ],
                "coherence_score": fg_result.coherence_score,
            },
            "registry_updates": {
                "created": registry_report.created,
                "updated": registry_report.updated,
            },
            "l0_snapshot": {
                "scene": scene_number,
                "goal": scene_plan.get("goal", ""),
            },
        },
    }


@router.post("/force-pass")
async def force_pass(data: dict):
    project_id = data.get("project_id", "")
    scene_number = data.get("scene_number", 1)

    progress = fm.read_json(project_id, "progress.json")
    if progress is None:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "PROJECT_NOT_FOUND", "message": "progress.json 不存在", "detail": {}},
        )

    for ch in progress.get("chapters", []):
        for s in ch.get("scenes", []):
            if s.get("scene_number") == scene_number:
                s["status"] = "force_passed"
                break

    fm.write_json(project_id, "progress.json", progress)

    return {
        "error": False,
        "code": "OK",
        "message": f"Scene {scene_number} 已强制通过",
        "detail": {},
    }


@router.post("/skip-scene")
async def skip_scene(data: dict):
    project_id = data.get("project_id", "")
    scene_number = data.get("scene_number", 1)

    progress = fm.read_json(project_id, "progress.json")
    if progress is None:
        progress = {
            "project_id": project_id,
            "current_stage": "STAGE4",
            "current_chapter": 1,
            "total_chapters": 1,
            "chapters": [],
            "circuit_breaker_events": [],
        }

    chapter_num = data.get("chapter_number", 1)
    chapters = progress.setdefault("chapters", [])
    chapter = next(
        (ch for ch in chapters if ch.get("chapter_number") == chapter_num),
        None,
    )
    if chapter is None:
        chapter = {"chapter_number": chapter_num, "status": "in_progress", "scenes": []}
        chapters.append(chapter)

    chapter.setdefault("scenes", []).append({
        "scene_number": scene_number,
        "status": "skipped",
        "retry_count": 0,
        "coherence_score": 0,
    })

    fm.write_json(project_id, "progress.json", progress)

    return {
        "error": False,
        "code": "OK",
        "message": f"Scene {scene_number} 已跳过",
        "detail": {},
    }


@router.get("/progress")
async def get_progress(project_id: str):
    progress = fm.read_json(project_id, "progress.json")
    if progress is None:
        return {
            "error": False,
            "code": "OK",
            "message": "暂无进度",
            "detail": {
                "project_id": project_id,
                "current_stage": "STAGE4",
                "chapters": [],
            },
        }

    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": progress,
    }
