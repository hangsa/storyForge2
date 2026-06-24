"""CreativeOS v1.7 — 创意引擎数据模型."""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class IdeaCategory(str, Enum):
    SETTING = "设定灵感"
    PLOT = "剧情想法"
    CHARACTER = "角色灵感"
    STYLE = "风格偏好"
    WRITING = "写作灵感"


@dataclass
class Idea:
    id: str
    content: str
    category: IdeaCategory
    source_stage: str
    source_context: str
    related_elements: list[str] = field(default_factory=list)
    confidence: float = 0.0
    status: str = "active"
    created_at: str = ""
    updated_at: str = ""


@dataclass
class Trope:
    id: str
    name: str
    category: str
    description: str
    market_saturation: float
    sub_tropes: list[str] = field(default_factory=list)
    common_combinations: list[str] = field(default_factory=list)
    novelty_penalty_weight: float = 1.0  # TODO(Phase 2): apply in NoveltyEvaluator scoring


class MutationOp(str, Enum):
    INVERSION = "inversion"
    FUSION = "fusion"
    ESCALATION = "escalation"
    SUBVERSION = "subversion"


@dataclass
class MutationResult:
    operation: MutationOp
    source_trope_id: str
    source_trope_name: str
    core_premise: str
    core_conflict: str
    novelty_hook: str
    self_consistency_check: str
    tokens_used: int = 0


class ContradictionTemplate(str, Enum):
    ABILITY_VS_LIMIT = "能力×限制"
    ETERNAL_VS_FLEETING = "永恒×消逝"
    IDENTITY_VS_SECRET = "身份×秘密"
    GOAL_VS_COST = "目标×代价"
    POWER_AS_WEAKNESS = "力量即弱点"


@dataclass
class ContradictionExpansion:
    template: ContradictionTemplate
    element_a: str
    element_b: str
    core_tension: str
    character_implications: list[str] = field(default_factory=list)
    plot_implications: list[str] = field(default_factory=list)
    thematic_depth: str = ""
    tokens_used: int = 0


@dataclass
class NoveltyScore:
    total: float = 0.0
    market_saturation_score: float = 0.0
    trope_similarity_score: float = 0.0
    contradiction_depth_score: float = 0.0
    discussion_potential_score: float = 0.0
    grade: str = "中等"
    saturation_warnings: list[str] = field(default_factory=list)
    blue_ocean_tags: list[str] = field(default_factory=list)


BRANCH_STATUS_ACTIVE = "active"
BRANCH_STATUS_DIMMED = "dimmed"
BRANCH_STATUSES = {BRANCH_STATUS_ACTIVE, BRANCH_STATUS_DIMMED}


@dataclass
class WhatIfNode:
    id: str
    depth: int
    parent_id: Optional[str]
    content: str
    novelty_score: float = 0.0
    trope_tags: list[str] = field(default_factory=list)
    saturation_warning: Optional[str] = None
    children_ids: list[str] = field(default_factory=list)
    is_expanded: bool = False
    branch_status: str = BRANCH_STATUS_ACTIVE
    # Populated by /apply-mutation; consumed by /commit when LLM-extracting
    # the canvas into concept_and_dna.json. None for non-mutated nodes.
    mutation_context: Optional[dict] = None


@dataclass
class FusionAnalysis:
    genre_a: str
    genre_b: str
    compatibility: str
    genre_distance: int
    fusion_points: dict[str, str] = field(default_factory=dict)
    caution_areas: list[str] = field(default_factory=list)
    tokens_used: int = 0
