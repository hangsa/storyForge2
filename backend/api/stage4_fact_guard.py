"""POST /api/stage4/fact-guard — read-only fact-guard check on user-supplied
draft text. Does not invoke the Writer LLM and does not write to disk.

Used by the manual-mode "Fact Guard" button in the workspace to validate
the user's hand-edited draft without overwriting it.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from backend.api.stage4_writing import _load_context, _run_semantic_precheck
from backend.agents.reviewer import ReviewerAgent
from backend.services.agent_prompt_stores import (
    project_override_store,
    global_override_store,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/stage4", tags=["stage4-fact-guard"])

# FileManager is bound at module-import time, the same way stage4_writing
# does it. Tests can rebind fm.projects_dir to point at a tmp dir.
from backend.utils.file_manager import FileManager
from backend.config import settings

fm = FileManager(settings.projects_dir)


@router.post("/fact-guard")
async def fact_guard(data: dict):
    """Run fact-guard on draft_text without regenerating or saving.

    Body: {project_id, chapter_number, scene_number, draft_text}
    Returns the same {all_passed, checks, coherence_score} shape that
    /write-scene returns inline.
    """
    project_id = data.get("project_id", "")
    chapter_number = int(data.get("chapter_number", 1))
    scene_number = int(data.get("scene_number", 1))
    draft_text = data.get("draft_text", "")

    if not project_id:
        raise HTTPException(
            status_code=400,
            detail={"error": True, "code": "VALIDATION_ERROR",
                    "message": "project_id 不能为空", "detail": {}},
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

    char_names = [c.get("name", "") for c in ctx.get("characters", []) if c.get("name")]
    precheck_result = await _run_semantic_precheck(
        scene_text=draft_text,
        scene_plan=scene_plan,
        character_names=char_names,
    )

    reviewer = ReviewerAgent(
        project_id,
        override_store=project_override_store(),
        global_override_store=global_override_store(),
    )
    fg_result = reviewer.run_fact_guard(
        draft_text=draft_text,
        characters=ctx["characters"],
        world_rules=ctx["world"],
        scene_plan=scene_plan,
        precheck_result=precheck_result,
    )

    checks_payload = [
        {"name": c.name, "passed": c.passed, "detail": c.detail}
        for c in getattr(fg_result, "checks", [])
    ]

    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": {
            "all_passed": bool(getattr(fg_result, "all_passed", False)),
            "checks": checks_payload,
            "coherence_score": int(getattr(fg_result, "coherence_score", 0)),
        },
    }
