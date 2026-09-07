"""5 维度中英标签映射(前后端共用)。

后端在 ThreeBEngine + 错误信息中引用;前端在 StepIndicator / S2 header 中引用。
未来 i18n 时,本文件可改为读 i18n catalog。
"""

from __future__ import annotations

from enum import Enum


class Dimension(str, Enum):
    ONTOLOGY = "ontology"
    ENERGETICS = "energetics"
    POWER_STRUCTURE = "power_structure"
    PROTAGONIST_ENGINE = "protagonist_engine"
    NARRATIVE_PHYSICS = "narrative_physics"


DIMENSION_LABELS_ZH: dict[str, str] = {
    Dimension.ONTOLOGY.value: "世界构成",
    Dimension.ENERGETICS.value: "能量体系",
    Dimension.POWER_STRUCTURE.value: "社会控制",
    Dimension.PROTAGONIST_ENGINE.value: "主角机制",
    Dimension.NARRATIVE_PHYSICS.value: "叙事动力",
}

DIMENSION_LABELS_EN: dict[str, str] = {
    Dimension.ONTOLOGY.value: "Ontology",
    Dimension.ENERGETICS.value: "Energetics",
    Dimension.POWER_STRUCTURE.value: "Power Structure",
    Dimension.PROTAGONIST_ENGINE.value: "Protagonist Engine",
    Dimension.NARRATIVE_PHYSICS.value: "Narrative Physics",
}


def label_zh(dimension: str) -> str:
    return DIMENSION_LABELS_ZH.get(dimension, dimension)


def label_en(dimension: str) -> str:
    return DIMENSION_LABELS_EN.get(dimension, dimension)
