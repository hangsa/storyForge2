from typing import Optional
from pydantic import BaseModel, Field


class EscalationEvent(BaseModel):
    from_intensity: str
    to_intensity: str
    trigger: str
    scene_number: int


class Conflict(BaseModel):
    id: str = ""
    owner: str = ""
    target: str = ""
    type: str = "personal"
    intensity: str = "low"
    status: str = "active"
    description: str = ""
    created_chapter: int = 1
    escalation_history: list[EscalationEvent] = []


class Clue(BaseModel):
    text: str = ""
    source: str = ""
    discovered_in_scene: int = 0


class Mystery(BaseModel):
    id: str = ""
    question: str = ""
    clues: list[Clue] = []
    status: str = "open"
    created_chapter: int = 1
    linked_characters: list[str] = []


class Twist(BaseModel):
    id: str = ""
    description: str = ""
    status: str = "foreshadowing"
    created_chapter: int = 1
    planned_reveal_chapter: Optional[int] = None


class Goal(BaseModel):
    id: str = ""
    owner: str = ""
    content: str = ""
    progress: str = "T0"
    status: str = "active"
    created_chapter: int = 1


class StoryOSSummary(BaseModel):
    active_conflicts: list[str] = []
    open_mysteries: list[str] = []
    pending_twists: list[str] = []
    active_goals: list[str] = []
