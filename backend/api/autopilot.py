"""Autopilot REST API — v1.9 §四 F1.9.1.

Note: SSE endpoint ships in Stage 2 (see backend/utils/sse_broadcaster.py + Task 2.1).
"""
from __future__ import annotations
from typing import Optional
from dataclasses import asdict

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from backend.config import settings
from backend.conductor.autopilot_session import (
    AutopilotSessionManager, _session_to_dict,
)
from backend.models.autopilot_session import (
    CurrentTask, ManagedStartConfig, QueueItem, SessionState,
)

router = APIRouter(
    prefix="/api/v1/projects/{project_id}/autopilot",
    tags=["autopilot"],
)


def _mgr(project_id: str) -> AutopilotSessionManager:
    return AutopilotSessionManager(settings.projects_dir, project_id)


def _ensure_project_exists(project_id: str):
    proj_dir = settings.projects_dir / project_id
    if not (proj_dir.exists() and (proj_dir / "project.json").exists()):
        return JSONResponse(
            status_code=404,
            content={"error": True, "code": "PROJECT_NOT_FOUND",
                     "message": f"项目 {project_id} 不存在", "detail": {}},
        )
    return None


def _envelope(detail: dict, message: str = "") -> dict:
    return {"error": False, "code": "OK", "message": message, "detail": detail}


# --- GET /session ---

@router.get("/session")
async def get_session(project_id: str):
    err = _ensure_project_exists(project_id)
    if err is not None:
        return err
    mgr = _mgr(project_id)
    s = mgr.load()
    if s is None:
        # UX-friendly: 200 + idle state (see Risk Note 3 in plan footer)
        s = mgr.ensure_idle_session()
    return _envelope(_session_to_dict(s))


# --- POST /session/start ---

@router.post("/session/start")
async def start_session(project_id: str, data: dict):
    err = _ensure_project_exists(project_id)
    if err is not None:
        return err
    cfg = ManagedStartConfig(
        scope=data.get("scope", "all_planned"),
        cadence=data.get("cadence", "balanced"),
        policy=data.get("policy", "auto"),
        notify=data.get("notify", "milestones"),
    )
    s = _mgr(project_id).start(cfg)
    return _envelope(_session_to_dict(s), "session started")


# --- POST /session/{stop,pause,resume} ---

@router.post("/session/stop")
async def stop_session(project_id: str):
    err = _ensure_project_exists(project_id)
    if err is not None:
        return err
    s = _mgr(project_id).stop()
    return _envelope(_session_to_dict(s), "session stopped")


@router.post("/session/pause")
async def pause_session(project_id: str):
    err = _ensure_project_exists(project_id)
    if err is not None:
        return err
    s = _mgr(project_id).pause()
    return _envelope(_session_to_dict(s), "session paused")


@router.post("/session/resume")
async def resume_session(project_id: str):
    err = _ensure_project_exists(project_id)
    if err is not None:
        return err
    mgr = _mgr(project_id)
    current = mgr.load()
    if current is not None and current.state != SessionState.PAUSED:
        return JSONResponse(
            status_code=409,
            content={"error": True, "code": "INVALID_STATE",
                     "message": f"resume requires state=paused, got {current.state.value}",
                     "detail": {"current_state": current.state.value}},
        )
    s = mgr.resume()
    return _envelope(_session_to_dict(s), "session resumed")


# --- POST /session/intervene ---

@router.post("/session/intervene")
async def intervene(project_id: str, data: dict):
    err = _ensure_project_exists(project_id)
    if err is not None:
        return err
    action = data.get("action", "")
    if action not in ("pause_immediate", "stop_current_task", "rollback_checkpoint"):
        return JSONResponse(
            status_code=400,
            content={"error": True, "code": "INVALID_ACTION",
                     "message": f"unknown intervention action: {action!r}",
                     "detail": {"valid": ["pause_immediate", "stop_current_task", "rollback_checkpoint"]}},
        )
    s = _mgr(project_id).intervene(action)
    return _envelope(_session_to_dict(s), f"intervened: {action}")


# --- GET /session/history ---

@router.get("/session/history")
async def get_history(project_id: str, cursor: Optional[str] = Query(None)):
    err = _ensure_project_exists(project_id)
    if err is not None:
        return err
    s = _mgr(project_id).load()
    if s is None:
        return _envelope({"events": [], "next_cursor": None})
    events = [asdict(e) for e in s.history]
    if cursor:
        idx = next((i for i, e in enumerate(events) if e["id"] == cursor), -1)
        events = events[idx + 1:] if idx >= 0 else events
    next_cursor = events[-1]["id"] if events else None
    return _envelope({"events": events, "next_cursor": next_cursor})


# --- (Stage 2: GET /session/events for SSE) ---
