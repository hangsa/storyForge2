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


class Promise(BaseModel):
    id: str = ""
    content: str = ""
    to_character: str = ""
    status: str = "pending"  # pending | fulfilled | broken
    created_chapter: int = 1
    fulfilled_chapter: Optional[int] = None
    fulfilled_scene: int = 0


class Reveal(BaseModel):
    id: str = ""
    content: str = ""
    about: str = ""  # 角色/世界观/事件
    status: str = "hidden"  # hidden | revealed
    created_chapter: int = 1
    revealed_chapter: Optional[int] = None
    reveal_method: str = ""  # 如何揭示


class Expectation(BaseModel):
    id: str = ""
    content: str = ""
    intensity: int = 50  # 0-100
    status: str = "accumulating"  # accumulating | fulfilled
    created_chapter: int = 1
    fulfilled_chapter: Optional[int] = None
    linked_assets: list[str] = []  # 关联的叙事资产 ID


class ForeshadowingClue(BaseModel):
    text: str = ""
    source: str = ""
    discovered_in_chapter: int = 0


class Foreshadowing(BaseModel):
    id: str = ""
    description: str = ""
    status: str = "planted"  # planted | developing | revealed | dead
    created_chapter: int = 1
    planted_chapter: int = 1
    clues: list[ForeshadowingClue] = []
    revealed_chapter: Optional[int] = None
    reveal_detail: str = ""


class StoryOSSummary(BaseModel):
    active_conflicts: list[str] = []
    open_mysteries: list[str] = []
    pending_twists: list[str] = []
    active_goals: list[str] = []
    pending_promises: list[str] = []
    hidden_reveals: list[str] = []
    accumulating_expectations: list[str] = []
    active_foreshadowings: list[str] = []
