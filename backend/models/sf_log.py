from typing import Optional
from pydantic import BaseModel, Field


class ParsedLog(BaseModel):
    type: str
    params: dict[str, str] = {}
    raw_text: str = ""


class FormatError(BaseModel):
    line_number: int
    raw_text: str
    error: str


# --- 7 specific log type models ---

class CharacterEmotionLog(BaseModel):
    char: str
    emotion: str
    trigger: Optional[str] = None


class CharacterRelationChangeLog(BaseModel):
    char_a: str
    char_b: str
    status: str
    trigger: Optional[str] = None


class CharacterLocationChangeLog(BaseModel):
    char: str
    from_location: str = Field(alias="from")
    to_location: str = Field(alias="to")


class KnowledgeGainLog(BaseModel):
    char: str
    content: str
    source: Optional[str] = None


class ConflictEscalateLog(BaseModel):
    id: str
    new_intensity: str
    trigger: Optional[str] = None


class MysteryClueLog(BaseModel):
    id: str
    clue: str


class RegistryCreateLog(BaseModel):
    type: str
    data: dict = {}


class SFLogEntry(BaseModel):
    """Union type for all SF_LOG entries."""
    log_type: str
    raw_params: str
    parsed: Optional[ParsedLog] = None
