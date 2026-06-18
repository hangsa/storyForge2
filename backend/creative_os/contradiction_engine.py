"""Contradiction Engine — 矛盾设定生成器 (LLM 展开 + 确定性评分)."""

import logging
from typing import Optional

from backend.models.creative_os import ContradictionTemplate, ContradictionExpansion

logger = logging.getLogger(__name__)

TEMPLATE_KEYWORDS: dict[ContradictionTemplate, list[str]] = {
    ContradictionTemplate.ABILITY_VS_LIMIT: [
        "能力", "限制", "代价", "副作用", "反噬", "消耗", "寿命",
        "使用次数", "冷却", "封印",
    ],
    ContradictionTemplate.ETERNAL_VS_FLEETING: [
        "永恒", "消逝", "不朽", "短暂", "时光", "衰老", "死亡",
        "轮回", "刹那", "岁月",
    ],
    ContradictionTemplate.IDENTITY_VS_SECRET: [
        "身份", "秘密", "隐藏", "揭露", "伪装", "真面目", "双重身份",
        "隐瞒", "面具", "真实的自己",
    ],
    ContradictionTemplate.GOAL_VS_COST: [
        "目标", "代价", "牺牲", "取舍", "交换", "放弃", "失去",
        "两难", "选择", "得到的同时",
    ],
    ContradictionTemplate.POWER_AS_WEAKNESS: [
        "力量即弱点", "力量成为弱", "越强越", "力量反噬", "最强的弱点",
        "弱点就是力量", "力量本身是", "成也萧何", "双刃剑",
    ],
}

DEPTH_KEYWORDS: dict[str, int] = {
    "矛盾": 3, "冲突": 2, "悖论": 5, "两难": 4, "困境": 3,
    "挣扎": 3, "纠结": 3, "拉扯": 2, "取舍": 3, "代价": 3,
    "牺牲": 3, "选择": 2, "不可兼得": 5, "鱼与熊掌": 5,
    "对立": 3, "矛盾体": 5, "张力": 3, "撕裂": 4, "煎熬": 3,
}


class ContradictionEngine:
    def __init__(self, model_router=None) -> None:
        self._router = model_router

    def score_depth(self, text: str) -> int:
        if not text or not text.strip():
            return 0

        total = 0
        template_matches: set[ContradictionTemplate] = set()

        for template, keywords in TEMPLATE_KEYWORDS.items():
            template_score = 0
            for kw in keywords:
                count = text.count(kw)
                if count > 0:
                    template_score += min(count, 3) * 2
            if template_score > 0:
                template_matches.add(template)
                total += min(template_score, 15)

        for kw, weight in DEPTH_KEYWORDS.items():
            count = text.count(kw)
            if count > 0:
                total += min(count, 5) * weight

        if len(template_matches) >= 2:
            total = int(total * 1.3)

        return min(total, 100)

    def detect_templates(self, text: str) -> list[tuple[ContradictionTemplate, float]]:
        results: list[tuple[ContradictionTemplate, float]] = []

        for template, keywords in TEMPLATE_KEYWORDS.items():
            hit_count = sum(1 for kw in keywords if kw in text)
            if hit_count > 0:
                confidence = min(hit_count / max(len(keywords), 1) * 2.0, 1.0)
                results.append((template, round(confidence, 2)))

        return sorted(results, key=lambda x: x[1], reverse=True)

    async def expand(
        self, template: ContradictionTemplate, context: str = ""
    ) -> ContradictionExpansion:
        raise NotImplementedError(
            "LLM expansion requires model_router and Prompt YAML — implement in Task 10"
        )
