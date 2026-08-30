from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class StageTransition(BaseModel):
    from_stage: str
    to_stage: str
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class Project(BaseModel):
    id: str
    title: str = ""
    genre: str = "cool_novel"
    min_words: int = 2000
    # Target novel length picked at create time. The label mirrors the
    # CreateProjectCard LENGTHS options (短篇快穿 / 标准商业连载 / 宏大史诗巨著);
    # chapter count is derived as target_total_words / min_words.
    target_total_words: int = 1_000_000
    target_length_category: str = "标准商业连载"
    current_stage: str = "INIT"
    stage_history: list[StageTransition] = []
    genre_thresholds: Optional[dict] = None
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class Concept(BaseModel):
    title: str = ""
    genre: str = "cool_novel"
    premise: str = ""
    tone: str = ""
    theme: str = ""
    target_audience: str = "男性向"
    style_template: str = "cool_novel"


class StoryDNA(BaseModel):
    core_contradiction: dict = Field(
        default_factory=lambda: {"statement": "", "side_a": "", "side_b": ""}
    )
    value_stack: list[dict] = []


class ConceptAndDNA(BaseModel):
    concept: Concept
    story_dna: StoryDNA