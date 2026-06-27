import json
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException

from backend.config import settings
from backend.utils.file_manager import FileManager
from backend.conductor.state_machine import StageStateMachine, Stage, STAGE_ORDER
from backend.conductor.circuit_breaker import CircuitBreaker
from backend.conductor.checkpoint import CheckpointManager
from backend.agents.writer import WriterAgent
from backend.agents.reviewer import ReviewerAgent
from backend.agents.storyos_agent import StoryOSAgent
from backend.agents.summary_archiver import SummaryArchiver
from backend.memory_os.l0_runtime import L0Runtime
from backend.memory_os.l1_hot import L1Hot
from backend.memory_os.l2_warm import L2WarmMemory
from backend.memory_os.memory_coordinator import MemoryCoordinator
from backend.reader_os.calculator import ReaderOS
from backend.semantic_precheck.prechecker import PrecheckResult

stage4_router = APIRouter(prefix="/api/stage4", tags=["stage4"])
fm = FileManager(settings.projects_dir)
logger = logging.getLogger(__name__)

# Top-level router combining stage4 + v1.7 exemptions routes. main.py and tests import `router`.
router = APIRouter()


async def _run_semantic_precheck(
    scene_text: str,
    scene_plan: dict,
    character_names: list[str],
) -> PrecheckResult:
    """Module-level async wrapper so tests can patch it cleanly.

    Returns precheck_passed=True with empty suggestions on any failure.
    Never raises — the precheck is advisory.
    """
    try:
        from backend.llm.model_router import get_model_router
        from backend.semantic_precheck.prechecker import SemanticPrechecker

        router = get_model_router()
        if router is None:
            return PrecheckResult(precheck_passed=True, skipped_reason="no router")
        prechecker = SemanticPrechecker(model_router=router)
        return await prechecker.check(
            scene_text=scene_text,
            scene_plan=scene_plan or {},
            character_names=character_names or [],
        )
    except Exception as e:
        logger.warning("Semantic precheck skipped: %s", e)
        return PrecheckResult(precheck_passed=True, skipped_reason=f"error: {e}")


def _load_context(project_id: str, chapter_number: Optional[int] = None) -> dict:
    project = fm.read_json(project_id, "project.json")
    concept_and_dna = fm.read_json(project_id, "concept_and_dna.json")
    world = fm.read_json(project_id, "world.json")
    characters_data = fm.read_json(project_id, "characters.json")
    outline = fm.read_json(project_id, "outline.json") or {}

    # Normalize old-format outline (single chapter without chapters wrapper)
    if "chapters" not in outline and "scene_plan" in outline:
        outline = {"chapters": [outline]}

    # Migrate old-format characters.json (single object → {characters: [...]})
    if isinstance(characters_data, dict) and "characters" not in characters_data:
        characters_data = {"characters": [characters_data]}
        fm.write_json(project_id, "characters.json", characters_data)

    characters = characters_data.get("characters", []) if characters_data else []
    character = characters[0] if characters else {}
    chapters = outline.get("chapters", [])

    # Select chapter by number, or first chapter
    target_number = chapter_number or 1
    chapter = next(
        (ch for ch in chapters if ch.get("chapter_number") == target_number),
        chapters[0] if chapters else {},
    )

    return {
        "project": project or {},
        "genre": project.get("genre", "cool_novel") if project else "cool_novel",
        "concept": concept_and_dna or {},
        "world": world or {},
        "characters": characters,
        "character": character,
        "outline": outline or {},
        "chapter": chapter,
        "chapter_number": target_number,
    }


@stage4_router.get("/scene-plan/{scene_num}")
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


@stage4_router.get("/scene-draft")
async def get_scene_draft(project_id: str, chapter_number: int = 1, scene_number: int = 1):
    """Load a previously saved scene draft from disk."""
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )
    draft_filename = f"ch{chapter_number:02d}_scene_{scene_number:03d}_draft.md"
    chapters_dir = fm.project_path(project_id, "chapters")
    draft_path = chapters_dir / draft_filename
    if not draft_path.exists():
        return {
            "error": False,
            "code": "OK",
            "message": "草稿不存在",
            "detail": {"draft_text": "", "chapter_number": chapter_number, "scene_number": scene_number,
                       "parsed_logs": [], "fact_guard_results": None, "coherence_score": 0},
        }
    draft_text = draft_path.read_text(encoding="utf-8")

    # Load scene metadata if available
    meta_filename = f"ch{chapter_number:02d}_scene_{scene_number:03d}_meta.json"
    meta = fm.read_json(project_id, f"chapters/{meta_filename}") or {}

    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": {
            "draft_text": draft_text,
            "chapter_number": chapter_number,
            "scene_number": scene_number,
            "parsed_logs": meta.get("parsed_logs", []),
            "fact_guard_results": meta.get("fact_guard_results"),
            "coherence_score": meta.get("coherence_score", 0),
        },
    }


@stage4_router.put("/scene-draft")
async def update_scene_draft(data: dict):
    """Save manually edited scene draft text to disk."""
    project_id = data.get("project_id", "")
    chapter_number = data.get("chapter_number", 1)
    scene_number = data.get("scene_number", 1)
    draft_text = data.get("draft_text", "")

    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    draft_filename = f"ch{chapter_number:02d}_scene_{scene_number:03d}_draft.md"
    chapters_dir = fm.project_path(project_id, "chapters")
    draft_path = chapters_dir / draft_filename
    draft_path.write_text(draft_text, encoding="utf-8")

    return {
        "error": False,
        "code": "OK",
        "message": "草稿已保存",
        "detail": {"chapter_number": chapter_number, "scene_number": scene_number},
    }


@stage4_router.post("/write-scene")
async def write_scene(data: dict):
    project_id = data.get("project_id", "")
    chapter_number = data.get("chapter_number", 1)
    scene_number = data.get("scene_number", 1)

    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    sm = StageStateMachine(settings.projects_dir)
    current = sm.get_current_stage(project_id)
    if STAGE_ORDER.index(current) < STAGE_ORDER.index(Stage.STAGE4):
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "STAGE_NOT_READY",
                "message": f"当前阶段为 {current.value}，无法执行 STAGE4 操作",
                "detail": {},
            },
        )

    ctx = _load_context(project_id, chapter_number)
    scenes = ctx["chapter"].get("scene_plan", [])
    scene_plan = next(
        (s for s in scenes if s.get("scene_number") == scene_number), None
    )
    if scene_plan is None:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "SCENE_NOT_FOUND", "message": f"Scene {scene_number} 不存在", "detail": {}},
        )

    # Initialize MemoryCoordinator for full L0-L4 context assembly
    mc = MemoryCoordinator(project_id, settings.projects_dir)
    character_names = [c.get("name", "") for c in ctx["characters"]]
    ctx_mem = mc.assemble_for_scene(
        scene_number=scene_number,
        scene_goal=scene_plan.get("goal", ""),
        scene_conflict=scene_plan.get("conflict", ""),
        character_names=character_names,
        chapter_number=chapter_number,
    )

    # Keep L0Runtime reference for later L0 updates after StoryOS parsing
    l0 = L0Runtime()
    l0.set_scene_context(scene_number, scene_plan.get("goal", ""))

    # Compute character growth context (v1.6 TRD 4.1)
    from backend.growth_curve.context import compute_character_growth_context
    character_growth_context = compute_character_growth_context(
        ctx["characters"], chapter_number
    )

    writer = WriterAgent(project_id)
    reviewer = ReviewerAgent(project_id)
    from backend.story_os.registries import RegistryManager
    registry_mgr = RegistryManager(project_id)
    storyos = StoryOSAgent(project_id, registry_manager=registry_mgr)
    breaker = CircuitBreaker()
    reader_os = ReaderOS(project_id)

    # Compute ReaderOS warnings for writer context
    genre = ctx["genre"]
    reader_warnings = reader_os.get_warnings(chapter_number, genre)
    reader_warnings_str = (
        "\n".join(
            f"  - [{w['level'].upper()}] {w['metric']}: {w['hint']}"
            for w in reader_warnings
        )
        if reader_warnings
        else "无预警"
    )

    # --- Write Phase ---
    try:
        result, response = await writer.write_scene(
            genre=genre,
            concept=ctx["concept"],
            world_rules=ctx["world"],
            characters=ctx["characters"],
            scene_plan=scene_plan,
            l0_context=ctx_mem.l0_context,
            l1_context=ctx_mem.l1_context,
            l2_context=ctx_mem.l2_context,
            l3_context=ctx_mem.l3_context,
            l4_context=ctx_mem.l4_context,
            growth_stage_hint=ctx_mem.growth_stage_hint,
            character_growth_context=character_growth_context,
            reader_os_warnings=reader_warnings_str,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": True, "code": "LLM_GENERATION_FAILED", "message": str(e), "detail": {}},
        )

    draft_text = result.get("text", "")
    if not draft_text or not draft_text.strip():
        raise HTTPException(
            status_code=503,
            detail={"error": True, "code": "LLM_GENERATION_FAILED",
                    "message": "LLM 返回了空文本，请重试", "detail": {}},
        )
    writer.log_usage("scene_writing", response)

    # --- Review & Retry Loop ---
    attempt = 1
    current_draft = draft_text

    # --- v1.7: Semantic precheck (advisory, runs once per scene) ---
    char_names = [c.get("name", "") for c in ctx.get("characters", []) if c.get("name")]
    precheck_result = await _run_semantic_precheck(
        scene_text=current_draft,
        scene_plan=scene_plan,
        character_names=char_names,
    )
    if precheck_result.tokens_used:
        try:
            from backend.llm.base_provider import LLMResponse
            synth = LLMResponse(
                text="",
                tokens_in=precheck_result.tokens_used,
                tokens_out=0,
                model="semantic_precheck",
                provider="semantic_precheck",
            )
            writer.log_usage("semantic_precheck_tokens", synth)
        except Exception as e:
            logger.warning("Failed to log semantic precheck tokens (non-blocking): %s", e)

    while True:
        fg_result = reviewer.run_fact_guard(
            draft_text=current_draft,
            characters=ctx["characters"],
            world_rules=ctx["world"],
            scene_plan=scene_plan,
            precheck_result=precheck_result,
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
                    characters=ctx["characters"],
                    scene_plan=scene_plan,
                    retry_hints=hints,
                    previous_draft=current_draft,
                    l0_context=ctx_mem.l0_context,
                    l1_context=ctx_mem.l1_context,
                    l2_context=ctx_mem.l2_context,
                    l3_context=ctx_mem.l3_context,
                    l4_context=ctx_mem.l4_context,
                    growth_stage_hint=ctx_mem.growth_stage_hint,
                    character_growth_context=character_growth_context,
                    reader_os_warnings=reader_warnings_str,
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

    # --- Style Guard (v1.6 Phase 4b) ---
    style_violations = []
    try:
        from backend.style_engine.genre_template import GenreTemplate
        genre_template = GenreTemplate().load(ctx["genre"])
        style_violations = await reviewer.run_style_guard(
            scene_text=current_draft,
            genre_template=genre_template,
            characters=ctx["characters"],
        )
    except Exception as e:
        logger.warning("Style Guard failed (non-blocking): %s", e)

    # Save draft (chapter-aware filename to preserve cross-chapter drafts)
    chapters_dir = fm.project_path(project_id, "chapters")
    chapters_dir.mkdir(parents=True, exist_ok=True)
    draft_filename = f"ch{chapter_number:02d}_scene_{scene_number:03d}_draft.md"
    fm.write_markdown(project_id, f"chapters/{draft_filename}", current_draft)

    # Save scene metadata (SF logs, Fact Guard results) for cross-scene retrieval
    meta_filename = f"ch{chapter_number:02d}_scene_{scene_number:03d}_meta.json"
    scene_meta = {
        "chapter_number": chapter_number,
        "scene_number": scene_number,
        "status": breaker_result,
        "retry_count": attempt - 1,
        "coherence_score": fg_result.coherence_score,
        "parsed_logs": [
            {"type": log.type, "params": log.params} for log in parsed_logs
        ],
        "fact_guard_results": {
            "all_passed": fg_result.all_passed,
            "checks": [
                {"check_id": c.check_id, "name": c.name, "passed": c.passed, "detail": c.detail}
                for c in fg_result.checks
            ],
        },
        "registry_updates": {
            "created": registry_report.created,
            "updated": registry_report.updated,
            "cascade_executed": registry_report.cascade_executed,
        },
        "style_guard_violations": style_violations,
        "precheck_result": {
            "precheck_passed": precheck_result.precheck_passed,
            "suggestions": [
                {
                    "event_type": s.event_type,
                    "location_hint": s.location_hint,
                    "suggested_tag": s.suggested_tag,
                    "reason": s.reason,
                }
                for s in (precheck_result.suggestions or [])
            ],
            "tokens_used": precheck_result.tokens_used,
            "skipped_reason": getattr(precheck_result, "skipped_reason", ""),
        },
    }
    fm.write_json(project_id, f"chapters/{meta_filename}", scene_meta)

    # Save checkpoint
    cpm = CheckpointManager(project_id)
    cpm.save(
        pipeline_stage="scene_written",
        current_chapter=ctx["chapter_number"],
        current_scene=scene_number,
        l0_snapshot={"scene": scene_number, "goal": scene_plan.get("goal", "")},
        character_states=ctx["characters"],
    )

    # Update progress
    outline = ctx["outline"]
    total_chapters = len(outline.get("chapters", [])) if outline else 1
    progress = fm.read_json(project_id, "progress.json") or {
        "project_id": project_id,
        "current_stage": "STAGE4",
        "current_chapter": 1,
        "total_chapters": total_chapters,
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

    # v1.6 Phase 3a: Chapter review trigger
    chapter_review_ready = False
    all_scenes_done = all(
        s.get("status") in ("completed", "force_passed", "skipped")
        for s in chapter_progress.get("scenes", [])
    )
    if all_scenes_done and chapter_progress.get("scenes"):
        try:
            from backend.conductor.chapter_review import ChapterReviewBuilder
            builder = ChapterReviewBuilder(project_id)
            review = await builder.build_review_async(chapter_number)
            builder.save_review(review)
            chapter_review_ready = True
            logger.info(
                "Chapter review generated for project=%s chapter=%d score=%d",
                project_id, chapter_number, review["coherence_score"],
            )
        except Exception as e:
            logger.warning("Chapter review generation failed (non-blocking): %s", e)

    return {
        "error": False,
        "code": "OK",
        "message": f"Scene {scene_number} 写作完成",
        "detail": {
            "scene_number": scene_number,
            "status": breaker_result,
            "retry_count": attempt - 1,
            "draft_text": current_draft,
            "chapter_review_ready": chapter_review_ready,  # v1.6 Phase 3a
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
                "cascade_executed": registry_report.cascade_executed,
            },
            "l0_snapshot": {
                "scene": scene_number,
                "goal": scene_plan.get("goal", ""),
            },
            "precheck_result": {
                "precheck_passed": precheck_result.precheck_passed,
                "suggestions": [
                    {
                        "event_type": s.event_type,
                        "location_hint": s.location_hint,
                        "suggested_tag": s.suggested_tag,
                        "reason": s.reason,
                    }
                    for s in (precheck_result.suggestions or [])
                ],
                "tokens_used": precheck_result.tokens_used,
                "skipped_reason": getattr(precheck_result, "skipped_reason", ""),
            },
        },
    }


@stage4_router.post("/force-pass")
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


@stage4_router.post("/skip-scene")
async def skip_scene(data: dict):
    project_id = data.get("project_id", "")
    scene_number = data.get("scene_number", 1)

    progress = fm.read_json(project_id, "progress.json")
    if progress is None:
        outline = fm.read_json(project_id, "outline.json") or {}
        total_chapters = len(outline.get("chapters", [])) if outline else 1
        progress = {
            "project_id": project_id,
            "current_stage": "STAGE4",
            "current_chapter": 1,
            "total_chapters": total_chapters,
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


@stage4_router.get("/progress")
async def get_progress(project_id: str):
    # v1.6 Phase 3b: ensure baseline manifest exists on first STAGE 4 entry
    from backend.conductor.impact_analyzer import ImpactAnalyzer
    ImpactAnalyzer().ensure_baseline(project_id)

    progress = fm.read_json(project_id, "progress.json")

    # Enrich with outline data (total chapters and scene counts per chapter)
    outline = fm.read_json(project_id, "outline.json") or {}
    outline_chapters = outline.get("chapters", [])
    total_chapters = len(outline_chapters) if outline_chapters else 1
    chapter_scene_counts = {
        ch.get("chapter_number", 0): len(ch.get("scene_plan", []))
        for ch in outline_chapters
    }

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

    # Ensure total_chapters is correct and add scene counts
    progress["total_chapters"] = progress.get("total_chapters", 1) or total_chapters
    for ch in progress.get("chapters", []):
        ch_num = ch.get("chapter_number", 0)
        ch["total_scenes"] = chapter_scene_counts.get(ch_num, ch.get("total_scenes", 0))

    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": progress,
    }


@stage4_router.post("/advance-chapter")
async def advance_chapter(data: dict):
    """推进到下一章：触发 Summary Archiver + ReaderOS + L2 更新"""
    project_id = data.get("project_id", "")

    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR", "message": "project_id 不能为空", "detail": {}},
        )

    sm = StageStateMachine(settings.projects_dir)
    current = sm.get_current_stage(project_id)
    if STAGE_ORDER.index(current) < STAGE_ORDER.index(Stage.STAGE4):
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "STAGE_NOT_READY", "message": f"当前阶段为 {current.value}，无法推进章节", "detail": {}},
        )

    # 1. Verify current chapter scenes are all done
    progress = fm.read_json(project_id, "progress.json") or {}
    current_chapter = progress.get("current_chapter", 1)
    chapters = progress.get("chapters", [])

    ch_progress = next(
        (ch for ch in chapters if ch.get("chapter_number") == current_chapter),
        None,
    )
    if ch_progress is None:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "PRECONDITION_FAILED", "message": f"第{current_chapter}章无进度记录", "detail": {}},
        )

    incomplete = [
        s for s in ch_progress.get("scenes", [])
        if s.get("status") not in ("completed", "force_passed", "skipped")
    ]
    if incomplete:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "CHAPTER_NOT_COMPLETE", "message": f"第{current_chapter}章有 {len(incomplete)} 个 Scene 未完成", "detail": {"incomplete_scenes": incomplete}},
        )

    # 2. Collect scene drafts and SF_LOG results for archiving
    storyos = StoryOSAgent(project_id)
    scene_drafts = []
    all_sf_logs = []
    chapters_dir = fm.project_path(project_id, "chapters")
    if chapters_dir.exists():
        for draft_file in sorted(chapters_dir.glob(f"ch{current_chapter:02d}_scene_*_draft.md")):
            draft_text = draft_file.read_text(encoding="utf-8")
            if draft_text:
                scene_drafts.append(draft_text)
                parsed = storyos.parse_sf_logs(draft_text)
                all_sf_logs.extend([
                    {"type": log.type, "params": log.params}
                    for log in parsed
                ])

    # 3. Trigger Summary Archiver (LLM call)
    ctx = _load_context(project_id, current_chapter)
    archiver = SummaryArchiver(project_id)
    l2 = L2WarmMemory(project_id)

    try:
        summary = await archiver.archive_chapter(
            chapter_number=current_chapter,
            scene_drafts=scene_drafts,
            sf_logs=all_sf_logs,
            character_states={
                c.get("id", ""): {
                    "name": c.get("name", ""),
                    "current_state": c.get("current_state", {}),
                }
                for c in ctx["characters"]
            },
        )
    except ValueError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": True, "code": "LLM_GENERATION_FAILED", "message": f"章摘要生成失败: {str(e)}", "detail": {}},
        )

    # 4. Update L2 memory
    l2.update_from_summary(current_chapter, summary, all_sf_logs)

    # 4b. Trigger L4 sync + L3 indexing (Phase 2: deterministic, tier_0)
    mc = MemoryCoordinator(project_id, settings.projects_dir)
    mc.assemble_for_chapter_advance(
        chapter_number=current_chapter,
        scene_drafts=scene_drafts,
    )

    # 5. Trigger ReaderOS calculation
    reader_os = ReaderOS(project_id)
    genre = ctx["genre"]
    snapshot = reader_os.snapshot(current_chapter, genre)

    # 6. Update progress.json
    ch_progress["status"] = "completed"
    ch_progress["reader_os"] = snapshot

    progress["current_chapter"] = current_chapter + 1

    # Create progress entry for next chapter if needed
    next_ch = next(
        (ch for ch in chapters if ch.get("chapter_number") == current_chapter + 1),
        None,
    )
    if next_ch is None:
        chapters.append({
            "chapter_number": current_chapter + 1,
            "status": "pending",
            "scenes": [],
        })

    fm.write_json(project_id, "progress.json", progress)

    # 7. Write checkpoint (drafts preserved on disk for cross-chapter retrieval)
    cpm = CheckpointManager(project_id)
    cpm.save(
        pipeline_stage="chapter_advanced",
        current_chapter=current_chapter + 1,
        current_scene=1,
        l0_snapshot={"stage": "chapter_advanced", "from_chapter": current_chapter},
        character_states=ctx["characters"],
    )

    return {
        "error": False,
        "code": "OK",
        "message": f"已推进到第{current_chapter + 1}章",
        "detail": {
            "status": "advanced",
            "from_chapter": current_chapter,
            "to_chapter": current_chapter + 1,
            "reader_os_snapshot": snapshot,
            "l2_summary": {
                "summary": summary.get("summary", ""),
                "key_events": summary.get("key_events", []),
            },
        },
    }


# --- v1.6 Phase 3a: Chapter Review API ---


@stage4_router.get("/chapter-reviews")
async def list_chapter_reviews(project_id: str):
    """List all available chapter reviews for a project."""
    from pathlib import Path

    reviews_dir = Path(settings.projects_dir) / project_id / "chapter_reviews"
    if not reviews_dir.exists():
        return {
            "error": False, "code": "OK", "message": "",
            "detail": {"chapters": []},
        }

    chapter_numbers = []
    for review_file in sorted(reviews_dir.glob("ch*_review.json")):
        try:
            stem = review_file.stem
            num_str = stem.replace("ch", "").replace("_review", "")
            chapter_numbers.append(int(num_str))
        except ValueError:
            continue

    return {
        "error": False, "code": "OK", "message": "",
        "detail": {"chapters": sorted(chapter_numbers)},
    }


@stage4_router.get("/chapter-review")
async def get_chapter_review(project_id: str, chapter: int):
    """Get chapter review data. Returns 404 if not yet generated."""
    from backend.conductor.chapter_review import ChapterReviewBuilder

    builder = ChapterReviewBuilder(project_id)
    review = builder.get_review_data(chapter)
    if review is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": True,
                "code": "REVIEW_NOT_FOUND",
                "message": f"Chapter {chapter} review not found",
                "detail": {},
            },
        )

    return {
        "error": False,
        "code": "OK",
        "message": f"Chapter {chapter} review loaded",
        "detail": review,
    }


@stage4_router.post("/chapter-review/decide")
async def decide_chapter_review(data: dict):
    """Author decision on chapter review.
    Request: {project_id, chapter_number, decision: "approved"|"revise", feedback?: string}
    """
    project_id = data.get("project_id", "")
    chapter_number = data.get("chapter_number", 0)
    decision = data.get("decision", "")
    feedback = data.get("feedback", "")

    if decision not in ("approved", "revise"):
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "INVALID_DECISION",
                "message": "decision must be 'approved' or 'revise'",
                "detail": {},
            },
        )

    from backend.conductor.chapter_review import ChapterReviewBuilder

    builder = ChapterReviewBuilder(project_id)
    ok = builder.set_decision(chapter_number, decision, feedback)
    if not ok:
        raise HTTPException(
            status_code=404,
            detail={
                "error": True,
                "code": "REVIEW_NOT_FOUND",
                "message": f"Chapter {chapter_number} review not found, cannot set decision",
                "detail": {},
            },
        )

    return {
        "error": False,
        "code": "OK",
        "message": f"Decision '{decision}' recorded for chapter {chapter_number}",
        "detail": {"status": "ok"},
    }


# --- v1.7: Creative Exemption API (T3.8) ---

from backend.models.exemption import ExemptionRequest, ExemptionManager

# Separate sub-router so the URL prefix doesn't collide with the existing /api/stage4 prefix.
exemptions_router = APIRouter(prefix="/api/v1/projects/{project_id}/exemptions", tags=["exemptions"])


@exemptions_router.post("")
def submit_exemption(project_id: str, request: ExemptionRequest) -> dict:
    """Writer submits a creative exemption request. Persists to progress.json."""
    project_dir = settings.projects_dir / project_id
    mgr = ExemptionManager(project_dir)
    mgr.submit(request)
    return {"id": request.id, "status": request.status}


@exemptions_router.put("/{exemption_id}/approve")
def approve_exemption(project_id: str, exemption_id: str, approved_by: str) -> dict:
    project_dir = settings.projects_dir / project_id
    mgr = ExemptionManager(project_dir)
    mgr.approve(exemption_id, approved_by=approved_by)
    return {"id": exemption_id, "status": "approved"}


@exemptions_router.put("/{exemption_id}/reject")
def reject_exemption(project_id: str, exemption_id: str, reason: str) -> dict:
    project_dir = settings.projects_dir / project_id
    mgr = ExemptionManager(project_dir)
    mgr.reject(exemption_id, reason=reason)
    return {"id": exemption_id, "status": "rejected"}


@exemptions_router.put("/{exemption_id}/outcome")
def set_exemption_outcome(project_id: str, exemption_id: str, outcome: str) -> dict:
    project_dir = settings.projects_dir / project_id
    mgr = ExemptionManager(project_dir)
    mgr.evaluate_outcome(exemption_id, outcome)
    return {"id": exemption_id, "status": "evaluated", "outcome": outcome}


@exemptions_router.get("/{exemption_id}/antipatterns")
def get_exemption_antipatterns(
    project_id: str, exemption_id: str
) -> list[dict]:
    project_dir = settings.projects_dir / project_id
    mgr = ExemptionManager(project_dir)
    ex = mgr.get(exemption_id)
    if ex is None:
        return []
    rule_id = ex.rule_to_break.get("rule_id", "")
    matches = mgr.check_antipatterns(rule_id, ex.creative_intent)
    return [
        {
            "rule_id": m.rule_id,
            "creative_intent_pattern": m.creative_intent_pattern,
            "count": m.count,
            "representative_case": m.representative_case,
        }
        for m in matches
    ]


# Mount both sub-routers into the top-level `router` so main.py and tests get all routes.
router.include_router(stage4_router)
router.include_router(exemptions_router)


# --- v1.7: User Edit Assist API (T3.10) ---

from backend.agents.storyos_agent import SFLogSuggestionEngine


sf_logs_router = APIRouter(prefix="/api/v1/projects/{project_id}/scenes/{scene_id}")


@sf_logs_router.post("/sf-log-suggestions")
async def analyze_sf_log_diff(
    project_id: str,
    scene_id: str,
    payload: dict,
) -> dict:
    """Analyze user edits to a Scene and propose SF_LOG changes.

    Body: { original_text: str, modified_text: str }
    Returns: SFLogDiffReport as dict
    """
    original = payload.get("original_text", "")
    modified = payload.get("modified_text", "")

    try:
        from backend.llm.model_router import get_model_router
        router = get_model_router()
    except Exception:
        router = None

    engine = SFLogSuggestionEngine(model_router=router)
    report = await engine.analyze_diff(
        original_text=original,
        modified_text=modified,
        existing_sf_logs=[],
        character_names=[],
    )
    return {
        "scene_id": scene_id,
        "original_text": report.original_text,
        "modified_text": report.modified_text,
        "deleted_logs": report.deleted_logs,
        "suggestions": [
            {
                "type": s.type,
                "severity": s.severity,
                "event_type": s.event_type,
                "suggested_tag": s.suggested_tag,
                "location_hint": s.location_hint,
                "reason": s.reason,
            }
            for s in report.suggestions
        ],
        "tokens_used": report.tokens_used,
    }


@sf_logs_router.put("/sf-logs")
def apply_sf_log_suggestions(
    project_id: str,
    scene_id: str,
    payload: dict,
) -> dict:
    """Batch-apply suggested SF_LOG tags to the modified text.

    Body: { text: str, suggestions: [SFLogSuggestion] }
    Returns: { updated_text: str }
    """
    from backend.agents.storyos_agent import SFLogSuggestion

    text = payload.get("text", "")
    raw_suggestions = payload.get("suggestions", []) or []
    from backend.utils.regex_patterns import SF_LOG_PATTERN, VALID_LOG_TYPES
    suggestions = []
    for s in raw_suggestions:
        if not isinstance(s, dict):
            continue
        event_type = s.get("event_type", "")
        if event_type not in VALID_LOG_TYPES:
            continue  # silently drop unknown types
        suggested_tag = s.get("suggested_tag", "")
        if not SF_LOG_PATTERN.search(suggested_tag):
            continue  # silently drop malformed tags
        suggestions.append(SFLogSuggestion(
            type=s.get("type", "missing"),
            severity=s.get("severity", "suggestion"),
            event_type=event_type,
            suggested_tag=suggested_tag,
            location_hint=s.get("location_hint", ""),
            reason=s.get("reason", ""),
        ))
    engine = SFLogSuggestionEngine(model_router=None)
    updated = engine.apply_suggestions(text, suggestions)
    return {"scene_id": scene_id, "updated_text": updated}


router.include_router(sf_logs_router)
