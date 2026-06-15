from typing import Optional
from pydantic import BaseModel, Field


class SceneProgress(BaseModel):
    scene_number: int
    status: str = "pending"  # "pending" | "writing" | "completed" | "force_passed" | "skipped"
    retry_count: int = 0
    draft_file: Optional[str] = None
    coherence_score: int = 0


class ReaderOSSnapshot(BaseModel):
    addiction: float = 0.0
    fatigue: float = 0.0
    warnings: list[dict] = []


class CharacterAppearance(BaseModel):
    scene_count: int = 0
    pov: bool = False


class ChapterProgress(BaseModel):
    chapter_number: int
    status: str = "pending"  # "pending" | "in_progress" | "completed"
    scenes: list[SceneProgress] = []
    reader_os: Optional[ReaderOSSnapshot] = None
    character_appearances: dict[str, CharacterAppearance] = Field(default_factory=dict)


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


class NarrativeGuardWarning(BaseModel):
    drift_type: str = ""           # "emotion_surge" / "relation_shift" / etc.
    character: str = ""
    severity: str = ""             # "high" / "medium" / "low"
    description: str = ""


class FactGuardSummary(BaseModel):
    passed: int = 0
    failed: int = 0
    total: int = 0
    pass_rate: float = 0.0


class ChapterReviewData(BaseModel):
    chapter_number: int
    timestamp: str = ""
    coherence_score: int = 0       # 0-100
    coherence_comment: str = ""    # LLM one-liner review
    reader_os: dict[str, float] = {}
    narrative_assets: dict[str, int] = {}
    narrative_guard_warnings: list[NarrativeGuardWarning] = []
    fact_guard_summary: FactGuardSummary = FactGuardSummary()
    writing_formula_compliance: list = []   # Placeholder for Phase 4.3
    discussion_topics: list[str] = []       # Placeholder, to be backfilled
    decision: Optional[str] = None          # null / "approved" / "revise"
    decision_feedback: Optional[str] = None
