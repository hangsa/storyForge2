"""Autopilot REST API — v1.9 §四 F1.9.1.

Stage 1: REST endpoints for session lifecycle.
Stage 2 (Task 2.2): SSE feed at /session/events.
"""
from __future__ import annotations
import asyncio
import json
import time
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
from backend.conductor.scene_chunk_store import SceneChunkStore

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
    ensure_result = await loop.ensure(project_id, mgr, executor, cfg)
    if ensure_result.outcome == "no_work_to_do":
        # Build a short summary so the UI can render a friendly, HONEST
        # message. We used to say "all 33 chapters done" whenever seed_queue
        # returned 0 — that was wrong because seed_queue can also return 0
        # when the user's saved scope (e.g. next_chapter) is too narrow
        # (proj_cc4ca4ae 2026-07-17). Now we distinguish the cases:
        #   - scope was widened → "scope auto-widened, but nothing left"
        #   - everything really is done → "all done"
        # Re-load the session because ensure() called mgr.stop() which
        # wrote a fresh snapshot; the `s` we got from mgr.start() still
        # shows state="running".
        post = mgr.load() or s
        outline_max = max(
            (c.get("chapter_number") for c in (
                json.loads(outline_path.read_text(encoding="utf-8")).get("chapters", [])
            ) if c.get("chapter_number") is not None),
            default=0,
        )
        # current_chapter lives in progress.json (NOT on the session).
        progress_path = settings.projects_dir / project_id / "progress.json"
        current_chapter: Optional[int] = None
        if progress_path.exists():
            try:
                prog = json.loads(progress_path.read_text(encoding="utf-8"))
                cc = prog.get("current_chapter")
                if isinstance(cc, int):
                    current_chapter = cc
            except Exception:
                pass  # best-effort — UI has outline_max as the load-bearing field
        seed_result = ensure_result.seed_result
        repaired = ensure_result.repaired_chapters
        if seed_result and seed_result.fallback_applied:
            message = (
                f"scope=next_chapter 当前章节已完成；"
                f"已自动扩展至 all_planned，但大纲共 {outline_max} 章内"
                f"亦无新章节可推进。"
            )
        else:
            message = (
                f"项目已全部写完（共 {outline_max} 章），无新任务可推进。"
            )
        detail = _session_to_dict(post)
        detail["no_work_to_do"] = True
        detail["outline_max"] = outline_max
        detail["current_chapter"] = current_chapter
        detail["requested_scope"] = cfg.scope
        detail["scope_used"] = (
            seed_result.scope_used if seed_result else cfg.scope
        )
        detail["fallback_applied"] = (
            seed_result.fallback_applied if seed_result else False
        )
        detail["repaired_chapters"] = repaired
        return _envelope(detail, message)
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


# --- GET /chapter-stream (real-time writing stream, v1.10 Direction B) ---

@router.get("/chapter-stream")
async def chapter_stream(
    project_id: str,
    request: Request,
    last_event_id: Optional[int] = Header(None, alias="Last-Event-ID"),
):
    """SSE endpoint that relays the per-chunk `scene_chunk` event stream plus
    `scene_start` / `scene_done` / `scene_failed` / `idle` / `scene_transition`.

    Reconnect补发: browser-managed `Last-Event-ID` HTTP header is read on every
    connect. Server replays all chunks with seq > Last-Event-ID from the
    SceneChunkStore JSONL file (per project + chapter + scene), then attaches
    to the live broadcaster stream. No `?since_seq=` query param is accepted —
    only the header (so client behavior stays consistent).

    Heartbeats (`:hb\\n\\n`) every 30s are forwarded from the broadcaster via
    the existing /session/events wire format.

    The flow re-checks `current_task.kind == "write_scene"` every 5 seconds; if
    the active task is no longer a scene write (e.g. mid-flight switch to
    archival, or the brief moment between scene_done and the next scene_start
    when complete_current_task has cleared the task), the endpoint emits a
    `scene_transition` event but **keeps the stream open** so the next
    scene_start flows through without the browser reconnecting. Subscribers
    no longer thrash on idle+close during routine scene transitions.

    The single-shot `idle: no_active_write_scene` branch at the top of the
    endpoint still fires for the initial connect when there's no session at
    all (or no write_scene task) — that case legitimately has nothing to
    subscribe to, so closing is correct there.

    The 5-second poll interval is exposed as the module-level constant
    `_CHAPTER_STREAM_TASK_CHECK_INTERVAL` so tests can shrink it.
    """
    err = _ensure_project_exists(project_id)
    if err is not None:
        return err

    s = _read_raw_session(project_id)

    # Spec deviation (justified by test contract): the spec text says "no
    # session.json → emit idle event", and test_endpoint_emits_idle_when_no_session
    # asserts status 200 + an idle event in the body. We consolidate the
    # "no session" and "wrong current_task kind" branches into a single one-shot
    # idle stream rather than returning a JSON 404 (which would also work for
    # EventSource but is less useful — clients wouldn't get a structured signal
    # that there's nothing to subscribe to right now).
    if s is None or (s.get("current_task") or {}).get("kind") != "write_scene":
        async def idle_no_session_gen() -> AsyncIterator[bytes]:
            yield _format_sse("idle", {"reason": "no_active_write_scene"}, id_=None)

        return StreamingResponse(idle_no_session_gen(), media_type="text/event-stream")

    current = s.get("current_task") or {}
    chapter = current.get("chapter_number")
    scene_raw = current.get("scene_id") or "0-0"
    try:
        scene = int(scene_raw.split("-")[1])
    except (IndexError, ValueError):
        scene = 0

    chunk_store = SceneChunkStore(
        settings.projects_dir, project_id, chapter, scene,
    )

    last_task_check = time.monotonic()

    async def event_stream() -> AsyncIterator[bytes]:
        nonlocal last_task_check
        # ---- Reconnect补发 from Last-Event-ID
        since_seq = last_event_id or 0
        replayed_any = False
        for record in chunk_store.read_since(since_seq):
            yield _format_sse("scene_chunk", {
                "seq": record.seq,
                "chapter_number": record.chapter_number,
                "scene_number": record.scene_number,
                "text": record.text,
            }, id_=record.seq)
            replayed_any = True

        # Decide whether to attach to the live broadcaster or close immediately.
        # - If we replayed anything AND the broadcaster's in-memory ring buffer
        #   is empty, no scene_chunk is actively streaming right now — close
        #   so the body flushes (tests + disconnected browser tabs that
        #   just want a tail of what already exists in JSONL).
        # - Otherwise (replayed nothing + nothing live → wait on subscriber;
        #   OR live events present → active stream) attach via subscribe().
        if replayed_any and not broadcaster.history:
            return

        # ---- Live subscription
        async for ev in broadcaster.subscribe(last_event_id):
            now = time.monotonic()
            if now - last_task_check > _CHAPTER_STREAM_TASK_CHECK_INTERVAL:
                last_task_check = now
                cur = (_read_raw_session(project_id) or {}).get("current_task") or {}
                if cur.get("kind") != "write_scene":
                    # Notify the cockpit that we're between scenes / doing
                    # archival, but KEEP THE STREAM OPEN so the next
                    # scene_start (or scene_done of an in-flight archive)
                    # flows through without the browser reconnecting. This
                    # is the fix for 2026-07-17 proj_cc4ca4ae where the
                    # cockpit stuck on the previous scene's text between
                    # scene_done and the next scene_start because every
                    # reconnect hit the same no-write_scene state.
                    yield _format_sse("scene_transition", {
                        "reason": "current_task_changed",
                        "chapter_number": cur.get("chapter_number"),
                    }, id_=None)
                    continue
            if ev.event in ("scene_chunk", "scene_done", "scene_failed", "scene_start"):
                yield _format_sse(ev.event, ev.data, id_=ev.id)
            elif ev.event == "heartbeat":
                yield b":hb\n\n"
            await asyncio.sleep(0)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# Seconds between current_task re-checks inside chapter_stream. Exposed at
# module scope so tests can monkey-patch it (see
# test_endpoint_emits_scene_transition_when_current_task_changes_mid_stream).
_CHAPTER_STREAM_TASK_CHECK_INTERVAL = 5.0


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
