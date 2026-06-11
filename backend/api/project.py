import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException

from backend.config import settings
from backend.models.project import Project, InitialIntent
from backend.utils.file_manager import FileManager

router = APIRouter(prefix="/api/project", tags=["project"])
fm = FileManager(settings.projects_dir)


@router.post("/create")
async def create_project(data: dict):
    intent = data.get("intent", "")
    title = data.get("title", "") or (intent[:30] + "..." if len(intent) > 30 else intent)
    genre = data.get("genre", "cool_novel")
    min_words = data.get("min_words", 4000)
    free_text = data.get("free_text", "") or intent
    inspiration_source = data.get("inspiration_source")

    if not free_text:
        raise HTTPException(
            status_code=400,
            detail={
                "error": True,
                "code": "VALIDATION_ERROR",
                "message": "intent 或 free_text 不能为空",
                "detail": {},
            },
        )

    project_id = f"proj_{uuid.uuid4().hex[:8]}"
    project = Project(
        id=project_id,
        title=title,
        genre=genre,
        min_words=min_words,
        initial_intent=InitialIntent(
            free_text=free_text,
            inspiration_source=inspiration_source,
        ),
        current_stage="INIT",
        created_at=datetime.utcnow().isoformat(),
    )

    fm.write_json(project_id, "project.json", project.model_dump())

    return {
        "error": False,
        "code": "OK",
        "message": "项目创建成功",
        "detail": project.model_dump(),
    }


@router.get("/{project_id}/status")
async def get_project_status(project_id: str):
    data = fm.read_json(project_id, "project.json")
    if data is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": True,
                "code": "PROJECT_NOT_FOUND",
                "message": f"项目 {project_id} 不存在",
                "detail": {},
            },
        )

    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": {
            "project_id": project_id,
            "current_stage": data.get("current_stage", "INIT"),
            "title": data.get("title", ""),
            "created_at": data.get("created_at", ""),
        },
    }
