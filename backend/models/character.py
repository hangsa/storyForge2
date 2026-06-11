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


class CharacterSet(BaseModel):
    characters: list[Character] = []
