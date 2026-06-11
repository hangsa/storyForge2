from dataclasses import dataclass, field
from enum import Enum


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


@dataclass
class SceneSchema:
    """Scene Schema — structural blueprint for a scene."""

    scene_number: int
    goal: str = ""
    conflict: str = ""
    emotional_arc: str = ""
    narrative_role: NarrativeRole = NarrativeRole.SETUP
    beat_type: BeatType = BeatType.SETUP
    required_logs: list[str] = field(default_factory=list)
    registry_changes: dict = field(default_factory=dict)


BEAT_PATTERNS = {
    BeatType.SETUP: {
        "description": "建立场景、引入冲突线索",
        "expected_beats": ["scene_description", "character_intro", "conflict_hint"],
    },
    BeatType.TENSION_BUILD: {
        "description": "逐步升级紧张感",
        "expected_beats": ["obstacle", "reaction", "escalation"],
    },
    BeatType.MINI_PAYOFF: {
        "description": "小型回报，推进支线",
        "expected_beats": ["setup_payoff", "emotion_beat", "new_question"],
    },
    BeatType.MAJOR_PAYOFF: {
        "description": "大型回报，核心剧情推进",
        "expected_beats": ["build_up", "climax", "resolution", "consequence"],
    },
    BeatType.CLIFFHANGER: {
        "description": "悬念结尾，引导下一幕",
        "expected_beats": ["partial_resolution", "new_threat", "hook"],
    },
    BeatType.TRANSITION: {
        "description": "过渡场景，连接前后",
        "expected_beats": ["bridge", "reflection", "setup_next"],
    },
}
