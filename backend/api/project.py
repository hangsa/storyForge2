import uuid
from datetime import datetime

from fastapi import APIRouter, HTTPException

from backend.config import settings
from backend.models.project import Project, InitialIntent
from backend.utils.file_manager import FileManager

router = APIRouter(prefix="/api/project", tags=["project"])
fm = FileManager(settings.projects_dir)


@router.get("/list")
async def list_projects():
    projects = []
    projects_dir = settings.projects_dir
    if projects_dir.exists():
        for proj_dir in sorted(projects_dir.iterdir(), reverse=True):
            if not proj_dir.is_dir():
                continue
            proj_file = proj_dir / "project.json"
            if not proj_file.exists():
                continue
            try:
                data = fm.read_json(proj_dir.name, "project.json")
                if data:
                    projects.append({
                        "id": data.get("id", proj_dir.name),
                        "title": data.get("title", "未命名"),
                        "genre": data.get("genre", ""),
                        "current_stage": data.get("current_stage", "INIT"),
                        "created_at": data.get("created_at", ""),
                        "min_words": data.get("min_words", 4000),
                    })
            except Exception:
                continue

    return {
        "error": False,
        "code": "OK",
        "message": "",
        "detail": projects,
    }


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


@router.delete("/{project_id}")
async def delete_project(project_id: str):
    if not fm.project_exists(project_id):
        raise HTTPException(
            status_code=404,
            detail={
                "error": True,
                "code": "PROJECT_NOT_FOUND",
                "message": f"项目 {project_id} 不存在",
                "detail": {},
            },
        )
    fm.delete_project(project_id)
    return {
        "error": False,
        "code": "OK",
        "message": "项目已删除",
        "detail": {"project_id": project_id},
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
