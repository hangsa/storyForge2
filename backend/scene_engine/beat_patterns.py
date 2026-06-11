"""Scene beat patterns — expanded definitions for each beat type."""

from enum import Enum
from typing import Optional

from backend.scene_engine.schema import BeatType, NarrativeRole


class IntensityLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class BeatPattern:
    """A beat pattern describes the structural flow within a scene."""

    def __init__(
        self,
        name: str,
        description: str,
        beats: list[str],
        min_words: int = 500,
        max_words: int = 2000,
        intensity: IntensityLevel = IntensityLevel.MEDIUM,
        sf_log_density: float = 0.5,
    ):
        self.name = name
        self.description = description
        self.beats = beats
        self.min_words = min_words
        self.max_words = max_words
        self.intensity = intensity
        self.sf_log_density = sf_log_density  # expected SF_LOG count per 500 words


EXPANDED_BEAT_PATTERNS = {
    BeatType.SETUP: BeatPattern(
        name="布局",
        description="建立场景环境、引入角色位置和初始状态，埋下冲突伏笔",
        beats=["环境描写", "角色定位", "冲突线索引入", "情绪基调确立"],
        min_words=500,
        max_words=1500,
        intensity=IntensityLevel.LOW,
        sf_log_density=0.3,
    ),
    BeatType.TENSION_BUILD: BeatPattern(
        name="张力升级",
        description="逐步提升冲突强度，推动角色进入压力区",
        beats=["障碍出现", "角色反应", "压力升级", "小转折"],
        min_words=600,
        max_words=1800,
        intensity=IntensityLevel.MEDIUM,
        sf_log_density=0.6,
    ),
    BeatType.MINI_PAYOFF: BeatPattern(
        name="小高潮",
        description="局部冲突解决，释放部分压力，同时开启新的疑问",
        beats=["铺垫兑现", "情感节拍", "新问题抛出", "状态转换"],
        min_words=600,
        max_words=1600,
        intensity=IntensityLevel.HIGH,
        sf_log_density=0.7,
    ),
    BeatType.MAJOR_PAYOFF: BeatPattern(
        name="大高潮",
        description="核心冲突爆发与解决，推动主线剧情的重大进展",
        beats=["张力累积", "冲突爆发", "高潮", "后果揭示"],
        min_words=800,
        max_words=2000,
        intensity=IntensityLevel.CRITICAL,
        sf_log_density=1.0,
    ),
    BeatType.CLIFFHANGER: BeatPattern(
        name="悬念结尾",
        description="在关键点切断叙事，制造强烈的好奇心钩子",
        beats=["部分解决", "新威胁揭示", "钩子抛出", "情绪悬停"],
        min_words=400,
        max_words=1200,
        intensity=IntensityLevel.HIGH,
        sf_log_density=0.5,
    ),
    BeatType.TRANSITION: BeatPattern(
        name="过渡",
        description="连接前后场景的桥梁，用于时间/空间切换和节奏调节",
        beats=["场景桥接", "角色反思", "下一幕铺垫", "信息传递"],
        min_words=300,
        max_words=800,
        intensity=IntensityLevel.LOW,
        sf_log_density=0.2,
    ),
}


def recommend_sf_logs(
    beat_type: BeatType, narrative_role: NarrativeRole
) -> list[str]:
    """Recommend SF_LOG types for a given beat and narrative role combination."""
    base_logs = {
        BeatType.SETUP: ["character_location_change"],
        BeatType.TENSION_BUILD: ["conflict_escalate", "character_emotion"],
        BeatType.MINI_PAYOFF: ["goal_milestone", "character_emotion", "knowledge_gain"],
        BeatType.MAJOR_PAYOFF: [
            "conflict_escalate", "mystery_clue", "character_relation_change",
            "twist_reveal", "goal_milestone",
        ],
        BeatType.CLIFFHANGER: ["conflict_escalate", "mystery_clue", "expectation_fulfill"],
        BeatType.TRANSITION: ["character_location_change", "knowledge_gain"],
    }

    role_bonus = {
        NarrativeRole.SETUP: [],
        NarrativeRole.MINI_PAYOFF: ["goal_milestone"],
        NarrativeRole.CLIFFHANGER: ["twist_reveal", "expectation_fulfill"],
        NarrativeRole.MAJOR_REVEAL: ["twist_reveal", "knowledge_gain", "character_relation_change"],
    }

    logs = list(set(base_logs.get(beat_type, []) + role_bonus.get(narrative_role, [])))
    return logs


def get_beat_pattern(beat_type: BeatType) -> Optional[BeatPattern]:
    """Get the expanded beat pattern for a given beat type."""
    return EXPANDED_BEAT_PATTERNS.get(beat_type)
