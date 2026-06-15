from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class Personality(BaseModel):
    beliefs: list[str] = []
    desires: list[str] = []
    fears: list[str] = []
    values: list[str] = []
    core_traits: list[str] = []


class VoiceSignature(BaseModel):
    speech_style: str = ""
    thought_patterns: str = ""
    taboos: list[str] = []


class CharacterCurrentState(BaseModel):
    location: str = ""
    physical_condition: str = "normal"
    emotional: str = "neutral"
    known_secrets: list[str] = []


class RelationChangeEvent(BaseModel):
    chapter: int = 0
    from_status: str = "neutral"
    to_status: str = "neutral"
    trigger: str = ""


class RelationStatus(BaseModel):
    status: str = "neutral"
    history: list[RelationChangeEvent] = []
    last_update_chapter: int = 0


# --- v1.6 TRD 4.1: Character Growth Curve ---


class GrowthEventType(str, Enum):
    """8-class belief change trigger whitelist."""
    BETRAYAL_EXPERIENCED = "betrayal_experienced"
    DEATH_OF_LOVED_ONE = "death_of_loved_one"
    WORLD_TRUTH_REVEALED = "world_truth_revealed"
    PERSONAL_IDENTITY_CRISIS = "personal_identity_crisis"
    IRREVERSIBLE_LOSS = "irreversible_loss"
    MORAL_AWAKENING = "moral_awakening"
    ACCUMULATED_EVIDENCE = "accumulated_evidence"
    RELATIONSHIP_TRANSFORMATION = "relationship_transformation"


class GrowthStage(BaseModel):
    """One stage in a character's growth curve."""
    stage_number: int = 1
    stage_name: str = ""
    trigger_event_type: GrowthEventType = GrowthEventType.BETRAYAL_EXPERIENCED
    trigger_event_description: str = ""
    character_change: str = ""
    target_chapter_range: str = ""  # e.g. "3-5" — LLM-authored estimate
    bound_chapter: Optional[int] = None  # set during STAGE 3 binding


class GrowthCurve(BaseModel):
    """Character growth arc through the story."""
    curve_description: str = ""
    stages: list[GrowthStage] = Field(default_factory=list)


class Character(BaseModel):
    id: str
    name: str = ""
    personality: Personality = Field(default_factory=Personality)
    current_state: CharacterCurrentState = Field(default_factory=CharacterCurrentState)
    voice_signature: VoiceSignature = Field(default_factory=VoiceSignature)
    unknown_to_character: list[str] = []
    is_core_character: bool = True
    character_type: str = "protagonist"
    relations: dict[str, RelationStatus] = Field(default_factory=dict)
    growth_curve: Optional[GrowthCurve] = None


class CharacterSet(BaseModel):
    characters: list[Character] = []
