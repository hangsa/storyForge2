from enum import Enum
from pydantic import BaseModel, Field


class NarrativeRole(str, Enum):
    SETUP = "setup"
    MINI_PAYOFF = "mini_payoff"
    CLIFFHANGER = "cliffhanger"
    MAJOR_REVEAL = "major_reveal"


class BeatType(str, Enum):
    SETUP = "setup"
    TENSION_BUILD = "tension_build"
    MINI_PAYOFF = "mini_payoff"
    MAJOR_PAYOFF = "major_payoff"
    CLIFFHANGER = "cliffhanger"
    TRANSITION = "transition"


class AssetCreation(BaseModel):
    type: str = ""
    id_pattern: str = ""
    description: str = ""


class AssetUpdate(BaseModel):
    asset_id: str = ""
    field: str = ""
    new_value: str = ""


class RegistryChanges(BaseModel):
    created: list[AssetCreation] = []
    updated: list[AssetUpdate] = []


class ScenePlan(BaseModel):
    scene_number: int
    goal: str = ""
    conflict: str = ""
    emotional_arc: str = ""
    narrative_role: NarrativeRole = NarrativeRole.SETUP
    beat_type: BeatType = BeatType.SETUP
    registry_changes: RegistryChanges = Field(default_factory=RegistryChanges)
    required_logs: list[str] = []


class Chapter(BaseModel):
    chapter_number: int
    title: str = ""
    scene_plan: list[ScenePlan] = []


class Outline(BaseModel):
    chapters: list[Chapter] = []


class Stage1To3Context(BaseModel):
    concept: dict = {}
    story_dna: dict = {}
    world: dict = {}
    characters: list[dict] = []
    chapter_number: int = 1
    min_words: int = 4000


class VolumeDivision(BaseModel):
    name: str = ""
    chapter_range: str = ""
    summary: str = ""
    key_events: list[str] = []


class GrowthMilestone(BaseModel):
    label: str = ""
    target_chapter_range: str = ""
    description: str = ""


class KeyPlotPoint(BaseModel):
    title: str = ""
    must_appear_in_volume: str = ""
    description: str = ""
    trigger_chapter_hint: str = ""


class NovelOutline(BaseModel):
    core_conflict_theme: str = ""
    volumes: list[VolumeDivision] = []
    mc_growth_arc: list[GrowthMilestone] = []
    key_plot_points: list[KeyPlotPoint] = []
    generated_at: str = ""
    updated_at: str = ""


class WritingContext(BaseModel):
    l0_runtime: dict = {}
    character: dict = {}
    world_rules: dict = {}
    scene_plan: ScenePlan = Field(default_factory=lambda: ScenePlan(scene_number=0))
    style_template: dict = {}
    l1_previous_scenes: list[str] = []
    storyos_state: dict = {}
