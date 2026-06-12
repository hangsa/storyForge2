from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.api import project, stage1_concept, stage2_world_char, stage3_outline, stage4_writing, stage5_diagnosis, conductor, storyos

app = FastAPI(
    title="StoryForge API",
    description="AI-Powered Creative Narrative Operating System",
    version="0.1.0-mvp",
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
