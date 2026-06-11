from typing import Optional
from pydantic import BaseModel, Field


class SceneProgress(BaseModel):
    scene_number: int
    status: str = "pending"
    retry_count: int = 0
    draft_file: Optional[str] = None
    coherence_score: int = 0


class ChapterProgress(BaseModel):
    chapter_number: int
    status: str = "pending"
    scenes: list[SceneProgress] = []


class CircuitBreakerEvent(BaseModel):
    scene_number: int
    retry_count: int
    timestamp: str = ""
    persistent_failures: list[dict] = []
    resolution: str = ""


class ProgressFile(BaseModel):
    project_id: str
    current_stage: str = "INIT"
    current_chapter: int = 1
    total_chapters: int = 1
    chapters: list[ChapterProgress] = []
    circuit_breaker_events: list[CircuitBreakerEvent] = []
