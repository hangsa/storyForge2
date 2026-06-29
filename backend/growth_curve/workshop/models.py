# backend/growth_curve/workshop/models.py
from typing import Literal, Optional
from pydantic import BaseModel, Field
from backend.models.character import GrowthStage


class ConsistencyWarning(BaseModel):
    rule_id: Literal[
        "out_of_range", "invalid_event_type", "missing_event",
        "low_misaligned", "tight_spacing",
    ]
    severity: Literal["error", "warning"]
    stage_index: Optional[int] = None
    chapter_number: Optional[int] = None
    message: str
    suggestion: Optional[str] = None


class WorkshopCheckResult(BaseModel):
    character_id: str
    warnings: list[ConsistencyWarning] = Field(default_factory=list)
    checked_at: str


class WorkshopAdjustRequest(BaseModel):
    stages: list[GrowthStage]


class WorkshopDiscussRequest(BaseModel):
    question: str


class WorkshopDiscussResponse(BaseModel):
    answer: str
    suggestions: list[str] = Field(default_factory=list)
    skipped_reason: Optional[str] = None