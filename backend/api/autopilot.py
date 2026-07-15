"""Autopilot REST API — v1.9 §四 F1.9.1.

Stage 1: REST endpoints for session lifecycle.
Stage 2 (Task 2.2): SSE feed at /session/events.
"""
from __future__ import annotations
import asyncio
import json
from typing import AsyncIterator, Optional
from dataclasses import asdict

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse

from backend.config import settings
from backend.conductor.autopilot_loop import AutopilotLoopService
from backend.conductor.autopilot_session import (
    AutopilotSessionManager, _session_to_dict,
)
from backend.models.autopilot_session import (
    CurrentTask, ManagedStartConfig, QueueItem, SessionState,
)
from backend.utils.sse_broadcaster import SSEBroadcaster

# Module-level seam — tests monkeypatch this.
broadcaster = SSEBroadcaster()

router = APIRouter(
    prefix="/api/v1/projects/{project_id}/autopilot",
    tags=["autopilot"],
)


def _mgr(project_id: str) -> AutopilotSessionManager:
    return AutopilotSessionManager(settings.projects_dir, project_id, broadcaster=broadcaster)


def _loop_svc(request: Request) -> AutopilotLoopService:
    return request.app.state.loop_service


def _executor_for(request: Request, project_id: str):
    """The single app-wide executor. Tests override via app.state too."""
    return request.app.state.stage4_executor


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
async def start_session(project_id: str, data: dict, request: Request):
    err = _ensure_project_exists(project_id)
    if err is not None:
        return err
    cfg = ManagedStartConfig(
        scope=data.get("scope", "all_planned"),
        cadence=data.get("cadence", "balanced"),
        policy=data.get("policy", "auto"),
        notify=data.get("notify", "milestones"),
    )
    # outline missing → 400 BEFORE we start the session (spec §5 row 9).
    outline_path = settings.projects_dir / project_id / "outline.json"
    if not outline_path.exists():
        return JSONResponse(
            status_code=400,
            content={"error": True, "code": "OUTLINE_NOT_FOUND",
                     "message": "项目缺少 outline.json，无法启动托管", "detail": {}},
        )
    mgr = _mgr(project_id)
    s = mgr.start(cfg)
    # Spawn the runner.
    loop = _loop_svc(request)
    executor = _executor_for(request, project_id)
    await loop.ensure(project_id, mgr, executor, cfg)
    return _envelope(_session_to_dict(s), "session started")


# --- POST /session/{stop,pause,resume} ---

@router.post("/session/stop")
async def stop_session(project_id: str, request: Request):
    err = _ensure_project_exists(project_id)
    if err is not None:
        return err
    s = _mgr(project_id).stop()
    await _loop_svc(request).cancel(project_id)
    return _envelope(_session_to_dict(s), "session stopped")


@router.post("/session/pause")
async def pause_session(project_id: str, request: Request):
    err = _ensure_project_exists(project_id)
    if err is not None:
        return err
    s = _mgr(project_id).pause()
    await _loop_svc(request).cancel(project_id)
    return _envelope(_session_to_dict(s), "session paused")


@router.post("/session/resume")
async def resume_session(project_id: str, request: Request):
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
    cfg = s.config if s is not None else ManagedStartConfig()
    await _loop_svc(request).ensure(project_id, mgr, _executor_for(request, project_id), cfg)
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


# --- GET /session/events (SSE) ---

@router.get("/session/events")
async def session_events(
    project_id: str,
    request: Request,
    last_event_id: Optional[int] = Header(None, alias="Last-Event-ID"),
):
    err = _ensure_project_exists(project_id)
    if err is not None:
        return err
    snapshot = _read_raw_session(project_id) or _session_to_dict(_mgr(project_id).ensure_idle_session())

    async def event_stream() -> AsyncIterator[bytes]:
        yield _format_sse("snapshot", snapshot, id_=None)
        async for ev in broadcaster.subscribe(last_event_id):
            if ev.event == "heartbeat":
                yield b":hb\n\n"
                continue
            yield _format_sse(ev.event, ev.data, id_=ev.id)
            await asyncio.sleep(0)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


def _format_sse(event: str, data: dict, id_: Optional[int]) -> bytes:
    payload = json.dumps(data, ensure_ascii=False)
    chunks = []
    if id_ is not None:
        chunks.append(f"id: {id_}")
    chunks.append(f"event: {event}")
    chunks.append(f"data: {payload}")
    chunks.append("")
    chunks.append("")
    return ("\n".join(chunks) + "\n").encode("utf-8")


def _read_raw_session(project_id: str) -> Optional[dict]:
    """Read session.json as raw JSON without going through the strict
    AutopilotSession dataclass deserializer. Returns None if the file
    doesn't exist or is unreadable."""
    path = settings.projects_dir / project_id / "autopilot" / "session.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
