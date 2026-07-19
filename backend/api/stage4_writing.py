import json
import logging
import re
import time
from dataclasses import asdict
from typing import Any, AsyncIterator, Dict, Optional
from fastapi import APIRouter, HTTPException

from backend.config import settings
from backend.utils.file_manager import FileManager
from backend.conductor.state_machine import StageStateMachine, Stage, STAGE_ORDER
from backend.growth_curve.context import compute_character_growth_context
from backend.story_os.registries import RegistryManager
from backend.conductor.circuit_breaker import CircuitBreaker
from backend.conductor.checkpoint import CheckpointManager
from backend.agents.writer import WriterAgent
from backend.agents.reviewer import ReviewerAgent
from backend.agents.storyos_agent import StoryOSAgent
from backend.agents.summary_archiver import SummaryArchiver
from backend.services.agent_prompt_stores import (
    project_override_store,
    global_override_store,
)
from backend.memory_os.l0_runtime import L0Runtime
from backend.memory_os.l1_hot import L1Hot
from backend.memory_os.l2_warm import L2WarmMemory
from backend.memory_os.memory_coordinator import MemoryCoordinator
from backend.reader_os.calculator import ReaderOS
from backend.semantic_precheck.prechecker import PrecheckResult

stage4_router = APIRouter(prefix="/api/stage4", tags=["stage4"])
fm = FileManager(settings.projects_dir)
logger = logging.getLogger(__name__)

_THINK_BLOCK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
_DANGLING_THINK_RE = re.compile(r"<think>.*\Z", re.DOTALL | re.IGNORECASE)
_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*\n|\n```\s*$", re.MULTILINE)
# Fallback for invalid {"text":"..."} wrappers (unescaped inner quotes break
# json.loads). Greedy .* grabs the whole body up to the final closing quote.
_JSON_TEXT_WRAPPER_RE = re.compile(r'^\{\s*"text"\s*:\s*"(.*)"\s*\}$', re.DOTALL)
_JSON_ESCAPE_RE = re.compile(r"\\(.)")
_JSON_ESCAPE_MAP = {"n": "\n", "t": "\t", "r": "\r", '"': '"', "\\": "\\", "/": "/"}

def _normalize_scene_text(text: str) -> str:
    """Strip reasoning-model artifacts from raw LLM scene output before it is
    fact-guarded and persisted to draft.md.

    MiniMax-M3 (and other reasoning models) emit artifacts that break the
    deterministic SF_LOG parser and pollute the saved draft:

      1. A think-block chain-of-thought preamble. Left in place it
         becomes part of the reader-facing draft AND its stray "SF_LOG tags:
         character_location_change" style planning text confuses log parsing.
      2. JSON-escaped quotes inside SF_LOG tags, e.g. `char=\"沈渡\"` instead
         of `char="沈渡"`. PARAM_PATTERN only matches real quote characters,
         so every escaped tag reports "缺少有效的参数", the circuit breaker
         returns "retry", the scene never reaches a DONE status, and
         seed_queue() re-enqueues it forever (the proj_cc4ca4ae "writes one
         scene then stops" symptom, 2026-07-17).
      3. A `{"text":"..."}` JSON wrapper plus a markdown ```json fence. The
         scene_writing prompt declares output_format.type=json, so even on the
         streaming path (which sets json_mode=False) MiniMax-M3 still emits
         the wrapper. Left in place, the literal wrapper / code fence /
         ASCII-escaped \\n\\n sequences land in draft.md and the cockpit
         live stream -- observed 2026-07-17 on proj_cc4ca4ae ch28-ch30 (the
         ch28 draft opens with a think-block followed by ` ```json ` and
         a 14 KB JSON object whose text value contains literal \\n\\n). Fix
         sequence:
           - strip markdown ```json / ``` fences
           - if the result parses as a JSON object with a string `text` field,
             use that field (json.loads already unescapes \\n / \" / \\t)
           - then apply the existing think-strip + quote-unescape passes

    Backslash-quote sequences (and bare think markers) never occur
    intentionally in Chinese web-novel prose, so the unescape is safe to
    apply globally as a defense-in-depth pass after the JSON extraction.
    """
    if not text:
        return text

    cleaned = text

    # 1. Strip think-block chain-of-thought first so the JSON-extraction
    #    pass below sees bare JSON without a leading prose preamble (real
    #    runs on proj_cc4ca4ae ch28+ emit think-block + json fence in that
    #    order -- the think-block must be removed before trying to parse).
    cleaned = _THINK_BLOCK_RE.sub("", cleaned)
    if "<think>" in cleaned.lower():
        cleaned = _DANGLING_THINK_RE.sub("", cleaned)

    # 2. Strip a leading/trailing markdown code fence (` ```json ` or ` ``` `).
    cleaned = _FENCE_RE.sub("", cleaned)

    # 3. If the (de-fenced) content is a single JSON object with a string
    #    `text` field, use that field. json.loads also unescapes the JSON
    #    escape sequences (\n / \" / \t) so we do not need a manual
    #    replacement after this point.
    extracted = None
    stripped = cleaned.strip()
    if stripped.startswith("{") and stripped.endswith("}"):
        try:
            parsed = json.loads(stripped)
        except Exception:
            parsed = None
        if isinstance(parsed, dict):
            value = parsed.get("text")
            if isinstance(value, str):
                extracted = value

        # Fallback: the model frequently emits a {"text":"..."} wrapper whose
        # prose contains UNESCAPED ASCII double quotes (Chinese dialogue like
        # `"沈哥"`), which makes json.loads fail ("Expecting ',' delimiter").
        # Without this, the literal wrapper — braces, `"text":`, and
        # ASCII-escaped \\n\\n — lands in draft.md verbatim (proj_cc4ca4ae
        # ch31_scene_001, 2026-07-17). Pull the text body out with a greedy
        # regex and manually unescape the JSON escapes json.loads would have
        # handled. `\\(.)` matches each escape atomically left-to-right so a
        # literal `\\\\` is consumed as one unit.
        if extracted is None:
            m = _JSON_TEXT_WRAPPER_RE.match(stripped)
            if m:
                extracted = _JSON_ESCAPE_RE.sub(
                    lambda mm: _JSON_ESCAPE_MAP.get(mm.group(1), mm.group(1)),
                    m.group(1),
                )

    if extracted is not None:
        cleaned = extracted

    # 4. Backslash-quote unescape (defense in depth - covers any model that
    #    emits escaped quotes outside the JSON wrapper as well).
    cleaned = cleaned.replace('\\"', '"')

    return cleaned.strip()


class OutlineExhaustedError(Exception):
    """Raised by _advance_chapter when current_chapter is at or past
    the outline's maximum chapter_number. Domain-level signal — the
    /advance-chapter HTTP wrapper translates it to HTTPException(400).

    Attributes:
        project_id: project id
        current_chapter: the chapter the caller tried to advance past
        outline_max: the maximum chapter_number in the project's outline
    """

    def __init__(self, *, project_id: str, current_chapter: int, outline_max: int):
        self.project_id = project_id
        self.current_chapter = current_chapter
        self.outline_max = outline_max
        super().__init__(
            f"outline exhausted: project={project_id} "
            f"current_chapter={current_chapter} outline_max={outline_max}"
        )


def _outline_max_chapter(project_id: str) -> Optional[int]:
    """Return the maximum chapter_number in the project's outline.json,
    or None if the outline is missing / malformed (no cap applies)."""
    try:
        outline = fm.read_json(project_id, "outline.json")
    except Exception:
        return None
    if not isinstance(outline, dict):
        return None
    chapters = outline.get("chapters")
    if not isinstance(chapters, list) or not chapters:
        return None
    nums = [
        c.get("chapter_number") for c in chapters
        if isinstance(c, dict) and isinstance(c.get("chapter_number"), int)
    ]
    if not nums:
        return None
    return max(nums)

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
        prechecker = SemanticPrechecker(
            model_router=router,
            project_id=project_id,
            override_store=project_override_store(),
            global_override_store=global_override_store(),
        )
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


@stage4_router.get("/scene-drafts")
async def list_scene_drafts(project_id: str, chapter_number: int = 1):
    """List draft-availability for every scene in `outline.json` `scene_plan`
    for the given chapter. `has_draft=true` iff `ch{NN}_scene_{NNN}_draft.md`
    exists and is non-empty after stripping. Read-only, no side effects.
    """
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )

    # Project existence check.
    project_dir = fm.projects_dir / project_id
    if not project_dir.exists():
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "PROJECT_NOT_FOUND",
                    "message": f"项目 {project_id} 不存在", "detail": {}},
        )

    outline = fm.read_json(project_id, "outline.json")
    scenes_out: list[dict] = []
    if outline is not None:
        chapter = next(
            (c for c in outline.get("chapters", [])
             if c.get("chapter_number") == chapter_number),
            None,
        )
        if chapter is not None:
            scene_plan = chapter.get("scene_plan", [])
            chapters_dir = fm.project_path(project_id, "chapters")
            for sp in scene_plan:
                scene_number = sp.get("scene_number")
                if scene_number is None:
                    continue
                fname = f"ch{chapter_number:02d}_scene_{scene_number:03d}_draft.md"
                draft_path = chapters_dir / fname
                has_draft = bool(draft_path.read_text(encoding="utf-8").strip()) if draft_path.is_file() else False
                scenes_out.append({
                    "scene_number": scene_number,
                    "has_draft": has_draft,
                })

    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": {"chapter_number": chapter_number, "scenes": scenes_out},
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


async def _write_scene_chapter(
    project_id: str,
    chapter_number: int,
    scene_number: int,
    custom_style_config=None,
    *,
    # Test seam: when set, skip LLM calls and use these instead.
    draft_factory=None,           # Callable[[int, int], str] | None
    breaker_result_override=None,  # "passed" | "force_pass" | "skipped" | None
) -> dict:
    """In-process chapter scene writer used by BOTH the HTTP handler and the
    autopilot executor. Returns the same dict shape as the old HTTP body so
    neither caller has to special-case it.

    When `draft_factory` is None, performs the real LLM-backed write. When
    provided, calls `draft_factory(chapter, scene)` to obtain canned draft text
    and `breaker_result_override` controls the circuit-breaker outcome (so
    integration tests can simulate `force_pass`).
    """
    sm = StageStateMachine(settings.projects_dir)
    current = sm.get_current_stage(project_id)
    if STAGE_ORDER.index(current) < STAGE_ORDER.index(Stage.STAGE4):
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "STAGE_NOT_READY",
                    "message": f"当前阶段为 {current.value}，无法执行 STAGE4 操作",
                    "detail": {}},
        )

    ctx = _load_context(project_id, chapter_number)
    scenes = ctx["chapter"].get("scene_plan", [])
    scene_plan = next(
        (s for s in scenes if s.get("scene_number") == scene_number), None
    )
    if scene_plan is None:
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "SCENE_NOT_FOUND",
                    "message": f"Scene {scene_number} 不存在", "detail": {}},
        )

    mc = MemoryCoordinator(project_id, settings.projects_dir)
    character_names = [c.get("name", "") for c in ctx["characters"]]
    ctx_mem = mc.assemble_for_scene(
        scene_number=scene_number,
        scene_goal=scene_plan.get("goal", ""),
        scene_conflict=scene_plan.get("conflict", ""),
        character_names=character_names,
        chapter_number=chapter_number,
    )

    l0 = L0Runtime()
    l0.set_scene_context(scene_number, scene_plan.get("goal", ""))

    character_growth_context = compute_character_growth_context(
        ctx["characters"], chapter_number
    )

    writer = WriterAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
    )
    reviewer = ReviewerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
    )
    registry_mgr = RegistryManager(project_id)
    storyos = StoryOSAgent(project_id, registry_manager=registry_mgr)
    breaker = CircuitBreaker()
    reader_os = ReaderOS(project_id)

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

    if draft_factory is not None:
        # Test seam: skip LLM call entirely.
        draft_text = draft_factory(chapter_number, scene_number)
        response = None
    else:
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
                custom_style_config=custom_style_config,
            )
        except ValueError as e:
            raise HTTPException(
                status_code=503,
                detail={"error": True, "code": "LLM_GENERATION_FAILED",
                        "message": str(e), "detail": {}},
            )
        draft_text = result.get("text", "")
        draft_text = _normalize_scene_text(draft_text)

    if not draft_text or not draft_text.strip():
        raise HTTPException(
            status_code=503,
            detail={"error": True, "code": "LLM_GENERATION_FAILED",
                    "message": "LLM 返回了空文本，请重试", "detail": {}},
        )
    if response is not None:
        writer.log_usage("scene_writing", response)

    attempt = 1
    current_draft = draft_text

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

    if breaker_result_override is not None:
        # Test seam: skip the loop entirely.
        fg_result = reviewer.run_fact_guard(
            draft_text=current_draft,
            characters=ctx["characters"],
            world_rules=ctx["world"],
            scene_plan=scene_plan,
            precheck_result=precheck_result,
        )
        breaker_result = breaker_result_override
        attempt = 3 if breaker_result_override == "force_pass" else 1
    else:
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
                    [{"name": c.name, "passed": c.passed, "detail": c.detail}
                     for c in fg_result.checks],
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
                        custom_style_config=custom_style_config,
                    )
                except ValueError as e:
                    raise HTTPException(
                        status_code=503,
                        detail={"error": True, "code": "LLM_GENERATION_FAILED",
                                "message": str(e), "detail": {}},
                    )
                current_draft = rewrite_result.get("text", "")
                writer.log_usage("scene_rewrite", rewrite_response)
                continue
            break  # force_pass

    parsed_logs = storyos.parse_sf_logs(current_draft)
    registry_report = storyos.update_registries(parsed_logs)
    l0.update_from_logs(registry_report.character_state_updates)

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

    chapters_dir = fm.project_path(project_id, "chapters")
    chapters_dir.mkdir(parents=True, exist_ok=True)
    draft_filename = f"ch{chapter_number:02d}_scene_{scene_number:03d}_draft.md"
    fm.write_markdown(project_id, f"chapters/{draft_filename}", current_draft)

    meta_filename = f"ch{chapter_number:02d}_scene_{scene_number:03d}_meta.json"
    scene_meta = {
        "chapter_number": chapter_number,
        "scene_number": scene_number,
        "status": breaker_result,
        "retry_count": attempt - 1,
        "coherence_score": fg_result.coherence_score,
        "parsed_logs": [{"type": log.type, "params": log.params} for log in parsed_logs],
        "fact_guard_results": {
            "all_passed": fg_result.all_passed,
            "checks": [{"check_id": c.check_id, "name": c.name, "passed": c.passed,
                        "detail": c.detail} for c in fg_result.checks],
        },
        "registry_updates": {
            "created": registry_report.created,
            "updated": registry_report.updated,
            "cascade_executed": registry_report.cascade_executed,
        },
        "style_guard_violations": style_violations,
        "precheck_result": {
            "precheck_passed": precheck_result.precheck_passed,
            "suggestions": [{
                "event_type": s.event_type, "location_hint": s.location_hint,
                "suggested_tag": s.suggested_tag, "reason": s.reason,
            } for s in (precheck_result.suggestions or [])],
            "tokens_used": precheck_result.tokens_used,
            "skipped_reason": getattr(precheck_result, "skipped_reason", ""),
        },
    }
    fm.write_json(project_id, f"chapters/{meta_filename}", scene_meta)

    cpm = CheckpointManager(project_id)
    cpm.save(
        pipeline_stage="scene_written",
        current_chapter=ctx["chapter_number"],
        current_scene=scene_number,
        l0_snapshot={"scene": scene_number, "goal": scene_plan.get("goal", "")},
        character_states=ctx["characters"],
    )

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
            "status": "in_progress", "scenes": [],
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
        {"scene_number": e.scene_number, "attempt": e.attempt,
         "result": e.result, "timestamp": e.timestamp}
        for e in breaker.get_events()
    ]
    progress["circuit_breaker_events"] = breaker_events
    fm.write_json(project_id, "progress.json", progress)

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
        "error": False, "code": "OK",
        "message": f"Scene {scene_number} 写作完成",
        "detail": {
            "scene_number": scene_number,
            "status": breaker_result,
            "retry_count": attempt - 1,
            "draft_text": current_draft,
            "chapter_review_ready": chapter_review_ready,
            "parsed_logs": [{"type": log.type, "params": log.params} for log in parsed_logs],
            "fact_guard_results": {
                "all_passed": fg_result.all_passed,
                "checks": [{"check_id": c.check_id, "name": c.name, "passed": c.passed,
                            "detail": c.detail} for c in fg_result.checks],
                "coherence_score": fg_result.coherence_score,
            },
            "registry_updates": {
                "created": registry_report.created,
                "updated": registry_report.updated,
                "cascade_executed": registry_report.cascade_executed,
            },
            "l0_snapshot": {"scene": scene_number, "goal": scene_plan.get("goal", "")},
            "precheck_result": {
                "precheck_passed": precheck_result.precheck_passed,
                "suggestions": [{
                    "event_type": s.event_type, "location_hint": s.location_hint,
                    "suggested_tag": s.suggested_tag, "reason": s.reason,
                } for s in (precheck_result.suggestions or [])],
                "tokens_used": precheck_result.tokens_used,
                "skipped_reason": getattr(precheck_result, "skipped_reason", ""),
            },
        },
    }


async def _write_scene_chapter_stream(
    *,
    project_id: str,
    chapter_number: int,
    scene_number: int,
    custom_style_config=None,
    chunk_flush_chars: int = 50,
    chunk_flush_ms: int = 80,
) -> AsyncIterator[Dict[str, Any]]:
    """Streaming twin of _write_scene_chapter. Yields dicts:

      {"event": "chunk", "text": <flushed substring>}
      {"event": "done",  "draft_text": <full>, "status": <breaker_result>}
      {"event": "failed","error": <str>, "partial_text": <so-far>}

    The flush policy is: every chunk_flush_chars chars OR every chunk_flush_ms
    milliseconds, whichever happens first. Fixed thresholds; spec §3.2 names
    them. The final StreamChunk (with finish_reason set) forces a flush.

    Fact Guard / StoryOS / MemoryOS / chapters/.../draft.md write all run on
    the assembled text exactly once, at the end — same code path as the
    non-streaming version. LLM-call retries stay on the non-streaming path:
    `_write_scene_chapter` is preserved for that use-case (manual reviewer,
    archival pipeline, existing tests that exercise the breaker loop).
    """
    # ---- shared L0/L1/L2/L3/L4 / scene-plan setup ----------------------
    sm = StageStateMachine(settings.projects_dir)
    current = sm.get_current_stage(project_id)
    if STAGE_ORDER.index(current) < STAGE_ORDER.index(Stage.STAGE4):
        raise ValueError(
            f"项目阶段为 {current.value}，无法执行 STAGE4 操作"
        )

    ctx = _load_context(project_id, chapter_number)
    scenes = ctx["chapter"].get("scene_plan", [])
    scene_plan = next(
        (s for s in scenes if s.get("scene_number") == scene_number), None
    )
    if scene_plan is None:
        raise ValueError(f"Scene {scene_number} 不存在")

    mc = MemoryCoordinator(project_id, settings.projects_dir)
    character_names = [c.get("name", "") for c in ctx["characters"]]
    ctx_mem = mc.assemble_for_scene(
        scene_number=scene_number,
        scene_goal=scene_plan.get("goal", ""),
        scene_conflict=scene_plan.get("conflict", ""),
        character_names=character_names,
        chapter_number=chapter_number,
    )
    l0 = L0Runtime()
    l0.set_scene_context(scene_number, scene_plan.get("goal", ""))

    character_growth_context = compute_character_growth_context(
        ctx["characters"], chapter_number
    )

    writer = WriterAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
    )
    reviewer = ReviewerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
    )
    registry_mgr = RegistryManager(project_id)
    storyos = StoryOSAgent(project_id, registry_manager=registry_mgr)
    breaker = CircuitBreaker()
    reader_os = ReaderOS(project_id)

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

    # ---- streaming flush infrastructure ---------------------------------
    buffer = ""
    last_flush = time.time()
    assembled_text = ""

    async def try_flush(force: bool = False):
        """Return a 'chunk' event dict if a flush happened, else None.

        Side-effects: invokes nothing external — chunk persistence + publishing
        happen in the executor (per spec §4.3.2, the executor owns the
        broadcaster-side coupling; this function is content-only). This
        keeps the streaming layer testable in isolation.
        """
        nonlocal buffer, last_flush, assembled_text
        if not (force or
                len(buffer) >= chunk_flush_chars or
                (time.time() - last_flush) * 1000 >= chunk_flush_ms):
            return None
        ev = {"event": "chunk", "text": buffer}
        assembled_text += buffer
        buffer = ""
        last_flush = time.time()
        return ev

    # ---- stream from writer ---------------------------------------------
    final_breaker_result = "passed"
    final_attempt = 1
    try:
        async for stream_chunk in writer.write_scene_stream(
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
            custom_style_config=custom_style_config,
        ):
            buffer += stream_chunk.text
            force = stream_chunk.finish_reason is not None
            ev = await try_flush(force=force)
            if ev is not None:
                yield ev

        # Drain any remaining buffered text (defense in depth: try_flush above
        # should have handled the final chunk's force=True, but a trailing
        # space/punctuation may have slipped under the threshold).
        ev = await try_flush(force=True)
        if ev is not None:
            yield ev

        # Strip reasoning-model artifacts (<think> block, escaped quotes) from
        # the assembled text BEFORE fact guard / StoryOS parsing / draft.md
        # write. See _normalize_scene_text() for why. The live chunks already
        # streamed to the cockpit may still contain the raw <think> preamble;
        # only the persisted draft and the deterministic parsers see the
        # cleaned form.
        assembled_text = _normalize_scene_text(assembled_text)

        if not assembled_text.strip():
            yield {"event": "failed",
                   "error": "LLM 返回了空文本",
                   "partial_text": assembled_text}
            return

        # ---- Fact Guard + breaker (single pass — no rewrite loop) ---------
        precheck_result = await _run_semantic_precheck(
            scene_text=assembled_text,
            scene_plan=scene_plan,
            character_names=character_names,
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
                logger.warning("Failed to log semantic precheck tokens: %s", e)

        fg_result = reviewer.run_fact_guard(
            draft_text=assembled_text,
            characters=ctx["characters"],
            world_rules=ctx["world"],
            scene_plan=scene_plan,
            precheck_result=precheck_result,
        )
        breaker_result = breaker.check(
            scene_number=scene_number,
            fact_guard_passed=fg_result.all_passed,
            attempt=1,
            hints=fg_result.retry_hints,
        )
        # Map breaker raw → canonical scene status (same table as executor).
        from backend.conductor.stage4_async_executor import _canonical_scene_status
        final_breaker_result = _canonical_scene_status(breaker_result)
        final_attempt = 1

        # ---- StoryOS / MemoryOS update ---------------------------------
        parsed_logs = storyos.parse_sf_logs(assembled_text)
        registry_report = storyos.update_registries(parsed_logs)
        l0.update_from_logs(registry_report.character_state_updates)

        # ---- Style Guard (best-effort, non-blocking) --------------------
        try:
            from backend.style_engine.genre_template import GenreTemplate
            genre_template = GenreTemplate().load(ctx["genre"])
            await reviewer.run_style_guard(
                scene_text=assembled_text,
                genre_template=genre_template,
                characters=ctx["characters"],
            )
        except Exception as e:
            logger.warning("Style Guard failed (non-blocking): %s", e)

        # ---- write final draft.md + meta.json + progress + checkpoint ----
        chapters_dir = fm.project_path(project_id, "chapters")
        chapters_dir.mkdir(parents=True, exist_ok=True)
        draft_filename = f"ch{chapter_number:02d}_scene_{scene_number:03d}_draft.md"
        fm.write_markdown(project_id, f"chapters/{draft_filename}", assembled_text)

        # NOTE: progress.json + checkpoint writes are intentionally
        # OUT OF SCOPE for this function — the executor (Task 3) updates
        # progress + checkpoint alongside this function's "done" event.
        # That keeps streaming's contract narrow (only "chunk"/"done"/
        # "failed" yields) and lets the executor own the cross-file
        # bookkeeping exactly like the existing _write_scene() does.

        yield {
            "event": "done",
            "draft_text": assembled_text,
            "status": final_breaker_result,
            "attempt": final_attempt,
        }

    except Exception as e:
        # Flush any unflushed buffer so partial_text reflects *all* text the
        # writer produced before raising (the 50-char / 80-ms threshold may
        # not have fired yet).
        if buffer:
            assembled_text += buffer
            buffer = ""
        yield {
            "event": "failed",
            "error": str(e),
            "partial_text": assembled_text,
        }


async def _advance_chapter(
    project_id: str,
    *,
    fake: bool = False,
) -> dict:
    """In-process chapter advancement. Returns the same dict shape as the
    existing /api/stage4/advance-chapter handler.

    When `fake=True`, skip the real SummaryArchiver LLM call (used by
    FakeStage4Executor in tests).
    """
    sm = StageStateMachine(settings.projects_dir)
    current = sm.get_current_stage(project_id)
    if STAGE_ORDER.index(current) < STAGE_ORDER.index(Stage.STAGE4):
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "STAGE_NOT_READY",
                    "message": f"当前阶段为 {current.value}，无法推进章节", "detail": {}},
        )

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
            detail={"error": True, "code": "PRECONDITION_FAILED",
                    "message": f"第{current_chapter}章无进度记录", "detail": {}},
        )

    incomplete = [
        s for s in ch_progress.get("scenes", [])
        if s.get("status") not in ("completed", "force_passed", "skipped")
    ]
    if incomplete:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "CHAPTER_NOT_COMPLETE",
                    "message": f"第{current_chapter}章有 {len(incomplete)} 个 Scene 未完成",
                    "detail": {"incomplete_scenes": incomplete}},
        )

    # Cap at outline max — no cap if outline is missing.
    outline_max = _outline_max_chapter(project_id)
    if outline_max is not None and current_chapter >= outline_max:
        raise OutlineExhaustedError(
            project_id=project_id,
            current_chapter=current_chapter,
            outline_max=outline_max,
        )

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
                all_sf_logs.extend([{"type": log.type, "params": log.params}
                                    for log in parsed])

    ctx = _load_context(project_id, current_chapter)
    archiver = SummaryArchiver(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
    )
    l2 = L2WarmMemory(project_id)

    if fake:
        summary = {"summary": f"<fake summary for ch{current_chapter}>",
                   "key_events": []}
    else:
        try:
            summary = await archiver.archive_chapter(
                chapter_number=current_chapter,
                scene_drafts=scene_drafts,
                sf_logs=all_sf_logs,
                character_states={
                    c.get("id", ""): {
                        "name": c.get("name", ""),
                        "current_state": c.get("current_state", {}),
                    } for c in ctx["characters"]
                },
            )
        except ValueError as e:
            raise HTTPException(
                status_code=503,
                detail={"error": True, "code": "LLM_GENERATION_FAILED",
                        "message": f"章摘要生成失败: {str(e)}", "detail": {}},
            )

    l2.update_from_summary(current_chapter, summary, all_sf_logs)

    mc = MemoryCoordinator(project_id, settings.projects_dir)
    mc.assemble_for_chapter_advance(
        chapter_number=current_chapter,
        scene_drafts=scene_drafts,
    )

    reader_os = ReaderOS(project_id)
    genre = ctx["genre"]
    snapshot = reader_os.snapshot(current_chapter, genre)

    ch_progress["status"] = "completed"
    ch_progress["reader_os"] = snapshot
    progress["current_chapter"] = current_chapter + 1

    next_ch = next((ch for ch in chapters if ch.get("chapter_number") == current_chapter + 1), None)
    if next_ch is None:
        chapters.append({"chapter_number": current_chapter + 1, "status": "pending", "scenes": []})

    fm.write_json(project_id, "progress.json", progress)

    cpm = CheckpointManager(project_id)
    cpm.save(
        pipeline_stage="chapter_advanced",
        current_chapter=current_chapter + 1,
        current_scene=1,
        l0_snapshot={"stage": "chapter_advanced", "from_chapter": current_chapter},
        character_states=ctx["characters"],
    )

    return {
        "error": False, "code": "OK",
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


@stage4_router.post("/write-scene")
async def write_scene(data: dict):
    project_id = data.get("project_id", "")
    chapter_number = data.get("chapter_number", 1)
    scene_number = data.get("scene_number", 1)
    custom_style_config = data.get("custom_style_config") or None
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )
    return await _write_scene_chapter(
        project_id=project_id,
        chapter_number=chapter_number,
        scene_number=scene_number,
        custom_style_config=custom_style_config,
    )


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


_CHAPTER_RANGE_RE = re.compile(r"^\s*(\d+)\s*-\s*(\d+)\s*$")


def _planned_chapter_total_from_novel_outline(novel_outline: Optional[dict]) -> int:
    """Parse `novel_outline.json` volumes' `chapter_range` strings to derive
    the user's planned total chapter count.

    Each volume's `chapter_range` is a string like "1-50" (start-end).
    Volumes are sequential, so the planned total is the max end across
    all volumes. Returns 0 if the file is missing or unparseable — the
    caller is expected to fall back to `outline.json`'s chapter count
    in that case.
    """
    if not novel_outline or not isinstance(novel_outline, dict):
        return 0
    max_end = 0
    for volume in novel_outline.get("volumes", []) or []:
        if not isinstance(volume, dict):
            continue
        rng = volume.get("chapter_range", "")
        if not isinstance(rng, str):
            continue
        m = _CHAPTER_RANGE_RE.match(rng)
        if not m:
            continue
        start, end = int(m.group(1)), int(m.group(2))
        # Reject start < 1 (1-indexed chapters) and inverted ranges
        # (e.g. "50-1"). Persisted project data can be hand-edited or
        # generated by older versions; malformed input must not produce
        # a misleading TopBar total.
        if start < 1 or end < start:
            continue
        if end > max_end:
            max_end = end
    return max_end


@stage4_router.get("/progress")
async def get_progress(project_id: str):
    # v1.6 Phase 3b: ensure baseline manifest exists on first STAGE 4 entry
    from backend.conductor.impact_analyzer import ImpactAnalyzer
    ImpactAnalyzer().ensure_baseline(project_id)

    progress = fm.read_json(project_id, "progress.json")

    # Enrich with outline data (scene counts per chapter for cells that exist)
    outline = fm.read_json(project_id, "outline.json") or {}
    outline_chapters = outline.get("chapters", [])
    outline_total = len(outline_chapters) if outline_chapters else 1
    chapter_scene_counts = {
        ch.get("chapter_number", 0): len(ch.get("scene_plan", []))
        for ch in outline_chapters
    }

    # novel_outline.json is the user's planned total (e.g., 3 volumes × 50 chapters
    # = 150). When progress.json is empty, prefer this over outline.json's
    # detailed chapter count, which is usually just chapter 1.
    novel_outline = fm.read_json(project_id, "novel_outline.json") or {}
    novel_total = _planned_chapter_total_from_novel_outline(novel_outline)

    if progress is None:
        return {
            "error": False,
            "code": "OK",
            "message": "暂无进度",
            "detail": {
                "project_id": project_id,
                "current_stage": "STAGE4",
                "chapters": [],
                # Pre-step: surface the user's plan from novel_outline.json
                # so the TopBar progress ring can show "0 / 150" instead of
                # "0 / 1" (or nothing) for a brand-new project.
                "total_chapters": novel_total or outline_total,
            },
        }

    # Priority when progress.json exists: explicit total_chapters in progress >
    # novel_outline planned total > outline.json detailed count > 1.
    progress["total_chapters"] = (
        progress.get("total_chapters") or novel_total or outline_total or 1
    )
    for ch in progress.get("chapters", []):
        ch_num = ch.get("chapter_number", 0)
        ch["total_scenes"] = chapter_scene_counts.get(
            ch_num, ch.get("total_scenes", 0)
        )

    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": progress,
    }


@stage4_router.post("/advance-chapter")
async def advance_chapter(data: dict):
    project_id = data.get("project_id", "")
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )
    try:
        return await _advance_chapter(project_id=project_id)
    except OutlineExhaustedError as e:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "OUTLINE_EXHAUSTED",
                    "message": (
                        f"大纲已结束：当前第{e.current_chapter}章，"
                        f"已无新章节可推进（大纲共 {e.outline_max} 章）"
                    ),
                    "detail": {
                        "current_chapter": e.current_chapter,
                        "outline_max": e.outline_max,
                    }},
        )


@stage4_router.post("/repair-progress")
async def repair_progress(data: dict):
    """Scan progress.json for chapters stuck at status=in_progress despite
    all outline scenes having terminal status; flip them to completed and
    advance current_chapter forward. Pure state-machine repair — no LLM,
    no L2 update, no checkpoint. Idempotent.

    Also scrubs empty scaffold chapters past the outline's maximum chapter
    number and caps current_chapter at outline_max+1 (the chapter that
    follows the last planned one is the natural "ready to write" slot).
    Refuses to run when an autopilot session is in the running state —
    the runner owns the in-memory session state and concurrent repair
    could clobber its progress.json writes.

    Request: {project_id: string}
    Response detail: {
      repaired_chapters: number[],   // sorted ascending
      current_chapter: number,       // may equal old value if no advance needed
      dropped_scaffolds: int,        // empty chapters past outline max that were removed
    }
    """
    project_id = data.get("project_id", "")
    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
        )

    project_dir = fm.projects_dir / project_id
    if not project_dir.exists():
        raise HTTPException(
            status_code=404,
            detail={"error": True, "code": "PROJECT_NOT_FOUND",
                    "message": f"项目 {project_id} 不存在", "detail": {}},
        )

    # Guard: do not repair while an autopilot session is running. The runner
    # owns progress.json and concurrent repair could clobber its writes.
    try:
        from backend.conductor.autopilot_session import AutopilotSessionManager
        from backend.models.autopilot_session import SessionState
        ap_mgr = AutopilotSessionManager(fm.projects_dir, project_id)
        ap_session = ap_mgr.load()
        if ap_session is not None and ap_session.state == SessionState.RUNNING:
            raise HTTPException(
                status_code=409,
                detail={"error": True, "code": "AUTOPILOT_ACTIVE",
                        "message": "Autopilot 正在运行，无法执行修复",
                        "detail": {"current_state": "running"}},
            )
    except HTTPException:
        raise
    except Exception as e:
        # A corrupt session.json should not block the repair — log and continue.
        logger.warning("repair-progress: autopilot guard skipped for %s: %s",
                       project_id, e)

    progress = fm.read_json(project_id, "progress.json")
    if progress is None:
        # No progress yet — nothing to repair
        return {
            "error": False, "code": "OK", "message": "",
            "detail": {"repaired_chapters": [], "current_chapter": 1,
                       "dropped_scaffolds": 0},
        }

    outline = fm.read_json(project_id, "outline.json") or {}
    outline_chs = {
        c.get("chapter_number"): c
        for c in outline.get("chapters", [])
    }

    DONE_STATUSES = {"completed", "force_passed", "skipped"}
    repaired: list[int] = []
    for ch_progress in progress.get("chapters", []):
        if ch_progress.get("status") != "in_progress":
            continue
        ch_num = ch_progress.get("chapter_number")
        outline_ch = outline_chs.get(ch_num)
        if outline_ch is None:
            continue  # no ground truth — skip defensively
        planned = outline_ch.get("scene_plan", [])
        if not planned:
            continue
        progress_by_num = {
            s.get("scene_number"): s.get("status")
            for s in ch_progress.get("scenes", [])
        }
        all_done = all(
            progress_by_num.get(s.get("scene_number")) in DONE_STATUSES
            for s in planned
        )
        if all_done:
            ch_progress["status"] = "completed"
            repaired.append(ch_num)

    # Scaffold scrub + current_chapter cap.
    # outline_max is the highest chapter_number in outline.json. Anything
    # past it with no scenes is an empty placeholder created in error; drop
    # it. current_chapter is then capped to outline_max+1 — the slot
    # immediately after the last planned chapter, which is the natural
    # "ready to write" target.
    outline_max = _outline_max_chapter(project_id)
    dropped_scaffolds = 0
    cap_applied = False
    if outline_max is not None:
        kept: list[dict] = []
        for ch in progress.get("chapters", []):
            ch_num = ch.get("chapter_number")
            scenes = ch.get("scenes", [])
            if (
                isinstance(ch_num, int)
                and ch_num > outline_max
                and not scenes
            ):
                dropped_scaffolds += 1
                continue
            kept.append(ch)
        if dropped_scaffolds:
            progress["chapters"] = kept
        old_current = progress.get("current_chapter", 1) or 1
        new_current = min(old_current, outline_max + 1)
        if new_current != old_current:
            progress["current_chapter"] = new_current
            cap_applied = True

    if repaired or dropped_scaffolds or cap_applied:
        # current_chapter only moves forward from repairs — never regresses
        if repaired:
            old_current = progress.get("current_chapter", 1)
            new_current = max(old_current, max(repaired) + 1)
            if new_current != old_current:
                progress["current_chapter"] = new_current
        fm.write_json(project_id, "progress.json", progress)

    # Refresh total_chapters from live sources. The stored value can become
    # stale when the user extends outline.json via /stage3/generate (the
    # "+ 新章节" button writes only to outline.json, leaving progress.json's
    # snapshot behind). Take the max so we never regress the denominator.
    live_novel_outline = fm.read_json(project_id, "novel_outline.json") or {}
    live_novel_total = _planned_chapter_total_from_novel_outline(live_novel_outline)
    live_outline_total = outline_max or 0
    stored_total = progress.get("total_chapters") or 0
    refreshed_total = max(stored_total, live_novel_total, live_outline_total)
    if refreshed_total and refreshed_total != stored_total:
        progress["total_chapters"] = refreshed_total
        # Persist even when nothing else changed so the refresh survives
        # subsequent GETs. This is a deliberate side effect of repair-progress.
        if not (repaired or dropped_scaffolds or cap_applied):
            fm.write_json(project_id, "progress.json", progress)

    return {
        "error": False, "code": "OK",
        "message": f"已修复 {len(repaired)} 个章节",
        "detail": {
            "repaired_chapters": sorted(repaired),
            "current_chapter": progress.get("current_chapter", 1),
            "dropped_scaffolds": dropped_scaffolds,
            "total_chapters": progress.get("total_chapters"),
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


@exemptions_router.get("")
def list_exemptions(project_id: str, status: str = "pending") -> list[dict]:
    """List exemption requests for a project, filtered by status."""
    proj_dir = settings.projects_dir / project_id
    mgr = ExemptionManager(proj_dir)
    items = mgr.list_all()
    out = [asdict(e) for e in items if e.status == status]
    return out


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

    engine = SFLogSuggestionEngine(
        model_router=router,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
    )
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
    engine = SFLogSuggestionEngine(
        model_router=None,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
    )
    updated = engine.apply_suggestions(text, suggestions)
    return {"scene_id": scene_id, "updated_text": updated}


router.include_router(sf_logs_router)
