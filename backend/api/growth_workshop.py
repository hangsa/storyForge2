# backend/api/growth_workshop.py
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException

from backend.config import settings
from backend.growth_curve.workshop.consistency_checker import check_growth_consistency
from backend.growth_curve.workshop.models import (
    ConsistencyWarning, WorkshopAdjustRequest, WorkshopCheckResult,
)
from backend.models.character import GrowthStage

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


def _coerce_stages(raw_stages: list) -> List[GrowthStage]:
    """Coerce a list of raw dicts (from JSON) into GrowthStage models."""
    coerced: List[GrowthStage] = []
    for s in raw_stages:
        if isinstance(s, GrowthStage):
            coerced.append(s)
        else:
            coerced.append(GrowthStage.model_validate(s))
    return coerced


def _effective_total_for_adjust(outline_chapters: list, stages: List[GrowthStage]) -> int:
    """Total chapter count for /adjust validation. When the outline is
    still sparse (or empty) but the user is authoring stages, allow a
    generous forward window so legitimate near-term stages (e.g. chapter 3)
    aren't blocked, while still rejecting clearly out-of-range values
    (e.g. chapter 99 in a 0-chapter outline)."""
    return len(outline_chapters) + _ADJUST_FORWARD_BUFFER


# Generous forward window so user can author stages ahead of an empty outline.
_ADJUST_FORWARD_BUFFER = 50


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
    return _envelope(result.model_dump())


@router.put("/adjust")
def adjust_endpoint(project_id: str, character_id: str, req: WorkshopAdjustRequest) -> dict:
    inputs = _build_inputs(project_id, character_id)
    if inputs is None:
        raise _err("CHARACTER_NOT_FOUND", f"角色 {character_id} 不存在", status=404)
    _, _, chapters, conflicts = inputs
    total = _effective_total_for_adjust(chapters, req.stages)
    result = check_growth_consistency(
        character_id=character_id, stages=req.stages, total_chapters=total,
        conflicts=conflicts, outline_chapters=chapters,
    )
    blocking = [w for w in result.warnings if w.severity == "error"]
    if blocking:
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
    return _envelope({
        "stages": [s.model_dump() for s in req.stages],
        "warnings": [w.model_dump() for w in result.warnings],
    })