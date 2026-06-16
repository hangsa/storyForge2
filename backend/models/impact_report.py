from typing import Optional
from pydantic import BaseModel, Field


class ImpactEntry(BaseModel):
    chapter_number: int
    scene_numbers: list[int] = []
    priority: str = ""          # "P0" | "P1" | "P2"
    reason: str = ""
    affected_assets: list[str] = []


class ImpactReport(BaseModel):
    project_id: str = ""
    modified_files: list[str] = []
    entries: list[ImpactEntry] = []
    summary: dict[str, int] = Field(default_factory=dict)
