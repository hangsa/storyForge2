"""FastAPI entry — StoryForge API.

Owns the application-level state for v1.9: AutopilotLoopService and the
stage4 executor live on `app.state` so the autopilot API can spawn/cancel
runner tasks. On startup we recover any sessions that were running when the
previous process died (spec §4E).
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.api import (
    project, stage1_concept, stage2_world_char, stage3_outline, stage4_writing,
    stage5_diagnosis, stage6_export, style_extractor, conductor, storyos,
    settings_api, creative_canvas, growth_workshop, style_sandbox, autopilot,
)
from backend.config import settings
from backend.conductor.autopilot_loop import AutopilotLoopService
from backend.conductor.stage4_async_executor import AsyncStage4Executor
from backend.conductor.autopilot_session import AutopilotSessionManager


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.loop_service = AutopilotLoopService()
    # Single app-wide executor; AsyncStage4Executor is stateless w.r.t. manager
    # (builds a fresh AutopilotSessionManager per execute() call).
    app.state.stage4_executor = AsyncStage4Executor(
        projects_dir=settings.projects_dir,
    )
    # Crash recovery: re-spawn runners for sessions that were 'running' when the
    # previous process exited. Stale sessions (>30s without heartbeat) are
    # downgraded to paused (spec §5 row 9 + spec L287).
    await app.state.loop_service.recover_running_sessions(settings.projects_dir)
    try:
        yield
    finally:
        # On shutdown, cancel any in-flight runners.
        for pid in list(app.state.loop_service._tasks.keys()):
            await app.state.loop_service.cancel(pid)


app = FastAPI(
    title="StoryForge API",
    description="AI-Powered Creative Narrative Operating System",
    version="0.1.0-mvp",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(project.router)
app.include_router(conductor.router)
app.include_router(stage1_concept.router)
app.include_router(stage2_world_char.router)
app.include_router(stage3_outline.router)
app.include_router(stage4_writing.router)
app.include_router(storyos.router)
app.include_router(stage5_diagnosis.router)
app.include_router(stage6_export.router)
app.include_router(style_extractor.router)
app.include_router(settings_api.router)
app.include_router(creative_canvas.router)
app.include_router(growth_workshop.router)
app.include_router(style_sandbox.router)
app.include_router(stage3_outline.branch_router)
app.include_router(autopilot.router)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={
            "error": True,
            "code": "INTERNAL_ERROR",
            "message": str(exc),
            "detail": {},
        },
    )


@app.get("/api/health")
async def health():
    return {"status": "ok"}