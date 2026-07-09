# backend/api/growth_workshop.py
import logging
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from backend.config import settings
from backend.growth_curve.workshop.consistency_checker import check_growth_consistency
from backend.growth_curve.workshop.models import (
    ConsistencyWarning, WorkshopAdjustRequest, WorkshopCheckResult,
    WorkshopDiscussRequest, WorkshopDiscussResponse,
)
from backend.llm.model_router import get_model_router
from backend.models.character import GrowthEventType, GrowthStage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/projects/{project_id}/characters/{character_id}/growth/workshop",
                   tags=["growth-workshop"])


def _envelope(detail: dict, code: str = "OK") -> dict:
    return {"error": False, "code": code, "message": "ok", "detail": detail}


def _err(code: str, message: str, detail: Optional[dict] = None, status: int = 400) -> HTTPException:
    return HTTPException(status_code=status, detail={
        "error": True, "code": code, "message": message,
        "detail": detail or {},
    })


def _load_characters(project_id: str) -> list:
    path = Path(settings.projects_dir) / project_id / "characters.json"
    if not path.exists():
        return []
    import json
    return json.loads(path.read_text()).get("characters", [])


def _find_character(project_id: str, character_id: str):
    for c in _load_characters(project_id):
        if c.get("id") == character_id:
            return c
    return None


def _load_outline(project_id: str) -> dict:
    path = Path(settings.projects_dir) / project_id / "outline.json"
    if not path.exists():
        return {"chapters": []}
    import json
    return json.loads(path.read_text())


def _load_conflicts(project_id: str) -> list:
    path = Path(settings.projects_dir) / project_id / "storyos" / "conflicts.json"
    if not path.exists():
        return []
    import json
    return json.loads(path.read_text()).get("conflicts", [])


def _build_inputs(project_id: str, character_id: str):
    character = _find_character(project_id, character_id)
    if character is None:
        return None
    outline = _load_outline(project_id)
    chapters = outline.get("chapters", [])
    conflicts = _load_conflicts(project_id)
    return character, outline, chapters, conflicts


def _coerce_stage_lenient(s: dict) -> GrowthStage:
    """Coerce one stage dict into a GrowthStage, tolerating invalid enum
    values so they reach check_growth_consistency and fire the
    invalid_event_type warning instead of 500-ing.

    Strategy: try strict model_validate first. If that fails (typically on
    an unknown trigger_event_type from a typo or legacy disk data), fall
    back to model_construct with known-good fields coerced by hand —
    invalid enums are preserved as raw strings (the consistency checker
    already detects them via _event_type_value + _VALID_EVENT_TYPES).
    """
    if isinstance(s, GrowthStage):
        return s
    try:
        return GrowthStage.model_validate(s)
    except ValidationError:
        # Manual coercion: pick the fields GrowthStage declares and
        # tolerate each one rather than letting Pydantic hard-fail.
        kwargs = {}
        for fname in ("stage_number", "stage_name", "trigger_event_type",
                      "trigger_event_description", "character_change",
                      "target_chapter_range"):
            if fname not in s:
                continue
            val = s[fname]
            if fname == "trigger_event_type":
                # Preserve invalid enum strings so check_growth_consistency
                # can flag them. Only coerce to GrowthEventType when valid.
                try:
                    kwargs[fname] = GrowthEventType(val)
                except ValueError:
                    kwargs[fname] = val  # keep as raw str
            else:
                kwargs[fname] = val
        if "bound_chapter" in s:
            bc = s["bound_chapter"]
            kwargs["bound_chapter"] = int(bc) if bc is not None else None
        # model_construct bypasses validation — exactly what we want here.
        return GrowthStage.model_construct(**kwargs)


def _coerce_stages(raw_stages: list) -> List[GrowthStage]:
    """Coerce a list of raw dicts (from JSON) into GrowthStage models."""
    coerced: List[GrowthStage] = []
    for s in raw_stages:
        if isinstance(s, GrowthStage):
            coerced.append(s)
        else:
            coerced.append(_coerce_stage_lenient(s))
    return coerced


@router.post("/check")
def check_endpoint(project_id: str, character_id: str) -> dict:
    inputs = _build_inputs(project_id, character_id)
    if inputs is None:
        raise _err("CHARACTER_NOT_FOUND", f"角色 {character_id} 不存在", status=404)
    character, _, chapters, conflicts = inputs
    raw_stages = (character.get("growth_curve") or {}).get("stages", [])
    stages = _coerce_stages(raw_stages)
    total = len(chapters)
    result: WorkshopCheckResult = check_growth_consistency(
        character_id=character_id, stages=stages, total_chapters=total,
        conflicts=conflicts, outline_chapters=chapters,
    )
    logger.info(
        "growth_workshop.check character_id=%s warnings=%d",
        character_id, len(result.warnings),
    )
    return _envelope(result.model_dump())


@router.put("/adjust")
def adjust_endpoint(project_id: str, character_id: str, req: WorkshopAdjustRequest) -> dict:
    inputs = _build_inputs(project_id, character_id)
    if inputs is None:
        raise _err("CHARACTER_NOT_FOUND", f"角色 {character_id} 不存在", status=404)
    _, _, chapters, conflicts = inputs
    total = len(chapters)
    result = check_growth_consistency(
        character_id=character_id, stages=req.stages, total_chapters=total,
        conflicts=conflicts, outline_chapters=chapters,
    )
    blocking = [w for w in result.warnings if w.severity == "error"]
    if blocking:
        logger.warning(
            "growth_workshop.adjust validation_failed character_id=%s blocking=%d",
            character_id, len(blocking),
        )
        raise _err(
            "CONSISTENCY_ERRORS", "存在错误级一致性问题，禁止保存",
            detail={"warnings": [w.model_dump() for w in blocking]}, status=422,
        )
    import json
    chars = _load_characters(project_id)
    for c in chars:
        if c.get("id") == character_id:
            c.setdefault("growth_curve", {})["stages"] = [s.model_dump() for s in req.stages]
            break
    out_path = Path(settings.projects_dir) / project_id / "characters.json"
    out_path.write_text(json.dumps({"characters": chars}, ensure_ascii=False))
    logger.info(
        "growth_workshop.adjust character_id=%s saved=%d warnings=%d",
        character_id, len(req.stages), len(result.warnings),
    )
    return _envelope({
        "stages": [s.model_dump() for s in req.stages],
        "warnings": [w.model_dump() for w in result.warnings],
    })


@router.post("/discuss")
async def discuss_endpoint(
    project_id: str, character_id: str, req: WorkshopDiscussRequest
) -> dict:
    """Free-form Q&A about the character's growth curve.

    Delegates to CharacterDesigner (Tier 1 LLM). When no router is
    configured or the underlying LLM call fails (e.g. test env without
    API keys), the endpoint degrades gracefully — the caller still
    receives a valid envelope with `skipped_reason` set so the frontend
    can render a useful "暂时无法回答" placeholder rather than crashing.
    """
    inputs = _build_inputs(project_id, character_id)
    if inputs is None:
        raise _err("CHARACTER_NOT_FOUND", f"角色 {character_id} 不存在", status=404)
    character, outline, _, _ = inputs
    router_instance = get_model_router()
    if router_instance is None:
        return _envelope(WorkshopDiscussResponse(
            answer="", suggestions=[], skipped_reason="no router",
        ).model_dump())
    # Import lazily so the endpoint module loads even if the agents
    # package has optional dependencies missing in some environments.
    from backend.agents.character_designer import CharacterDesigner

    agent = CharacterDesigner(project_id=project_id, model_router=router_instance)
    try:
        resp: WorkshopDiscussResponse = await agent.discuss(
            character=character, outline=outline, question=req.question,
        )
    except Exception as exc:
        # Tier 1 has no silent-degrade path — guard so the endpoint
        # never 500s. The frontend reads `skipped_reason` to render.
        logger.warning(
            "growth_workshop.discuss failed character_id=%s err=%s",
            character_id, exc,
        )
        resp = WorkshopDiscussResponse(
            answer="", suggestions=[],
            skipped_reason=f"llm error: {type(exc).__name__}",
        )
    logger.info(
        "growth_workshop.discuss character_id=%s skipped=%s",
        character_id, bool(resp.skipped_reason),
    )
    return _envelope(resp.model_dump())