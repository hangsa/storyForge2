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


class Character(BaseModel):
    id: str
    name: str = ""
    personality: Personality = Field(default_factory=Personality)
    current_state: CharacterCurrentState = Field(default_factory=CharacterCurrentState)
    voice_signature: VoiceSignature = Field(default_factory=VoiceSignature)
    unknown_to_character: list[str] = []
    is_core_character: bool = True


class CharacterSet(BaseModel):
    characters: list[Character] = []
