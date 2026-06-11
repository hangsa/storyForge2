from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field

from backend.models.sf_log import ParsedLog


class Checkpoint(BaseModel):
    project_id: str
    pipeline_stage: str
    current_chapter: int
    current_scene: int
    l0_snapshot: dict = {}
    registry_snapshots: dict[str, list[dict]] = {}
    character_states: list[dict] = []
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class RecoveryState(BaseModel):
    checkpoint: Optional[Checkpoint] = None
    recovery_instructions: list[str] = []
    missing_files: list[str] = []


class SceneDraft(BaseModel):
    scene_number: int
    text: str = ""
    parsed_logs: list[ParsedLog] = []
