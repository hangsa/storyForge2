from typing import Literal, Optional
from pydantic import BaseModel, Field, field_validator


class SandboxSentenceParams(BaseModel):
    avg_length_range: list[int] = Field(default=[15, 45], min_length=2, max_length=2)
    short_sentence_ratio: float = Field(default=0.3, ge=0.0, le=1.0)
    paragraph_length_range: list[int] = Field(default=[80, 200], min_length=2, max_length=2)

    @field_validator("avg_length_range", "paragraph_length_range")
    @classmethod
    def _ascending(cls, v: list[int]) -> list[int]:
        if v[0] > v[1]:
            raise ValueError("range must be [min, max] ascending")
        return v


class SandboxDialogueParams(BaseModel):
    ratio: float = Field(default=0.35, ge=0.0, le=1.0)
    max_consecutive_lines: int = Field(default=6, ge=1, le=20)


class SandboxRhythmParams(BaseModel):
    pacing_bpm: int = Field(default=300, ge=60, le=600)
    scene_change_frequency: float = Field(default=0.5, ge=0.0, le=1.0)


class SandboxDensityParams(BaseModel):
    description_ratio: float = Field(default=0.4, ge=0.0, le=1.0)
    action_ratio: float = Field(default=0.3, ge=0.0, le=1.0)


class SandboxSatisfactionParams(BaseModel):
    satisfaction_beat_count: int = Field(default=5, ge=0, le=50)
    suspense_hook_required: bool = True


class SandboxParams(BaseModel):
    sentence: SandboxSentenceParams = Field(default_factory=SandboxSentenceParams)
    dialogue: SandboxDialogueParams = Field(default_factory=SandboxDialogueParams)
    rhythm: SandboxRhythmParams = Field(default_factory=SandboxRhythmParams)
    density: SandboxDensityParams = Field(default_factory=SandboxDensityParams)
    satisfaction: SandboxSatisfactionParams = Field(default_factory=SandboxSatisfactionParams)


class PreviewRequest(BaseModel):
    source_text: str = Field(..., min_length=50, max_length=2000)
    params: SandboxParams
    genre: Literal["cool_novel", "dushi", "kehuan", "xianxia", "xuanhuan", "xuanyi", "yanqing"] = "cool_novel"


class PreviewResponse(BaseModel):
    rendered_text: str
    source_avg_length: float
    rendered_avg_length: float
    tokens_used: int
    skipped_reason: Optional[str] = None


class SaveStyleRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    params: SandboxParams


class SavedStyleConfig(BaseModel):
    name: str
    path: str
    params: SandboxParams
    created_at: str