"""Contradiction Engine — 矛盾设定生成器 (LLM 展开 + 确定性评分)."""

import logging

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
        if self._router is None:
            raise NotImplementedError(
                "LLM expansion requires model_router — pass it in constructor"
            )

        import json

        template_structures = {
            ContradictionTemplate.ABILITY_VS_LIMIT: "第一极：能力（主角拥有什么力量/能力）→ 第二极：限制（这个能力有什么代价/副作用/使用条件）",
            ContradictionTemplate.ETERNAL_VS_FLEETING: "第一极：永恒（不朽、长生、永久存在）→ 第二极：消逝（短暂、衰老、终将逝去）",
            ContradictionTemplate.IDENTITY_VS_SECRET: "第一极：身份（公开的社会角色/自我认知）→ 第二极：秘密（隐藏的真实身份/过去）",
            ContradictionTemplate.GOAL_VS_COST: "第一极：目标（想要达成的终极目的）→ 第二极：代价（为达成目标必须牺牲的）",
            ContradictionTemplate.POWER_AS_WEAKNESS: "第一极：力量（最强的能力/武器/依仗）→ 第二极：弱点（力量本身成为最大的弱点）",
        }

        system_prompt = (
            "你是一位资深的故事架构师，擅长从矛盾设定中发掘叙事深度。\n"
            "你的任务是：给定一个矛盾模板和上下文，展开两极端之间的核心张力，\n"
            "并推导其对角色和情节的影响。\n\n"
            "要求：\n"
            "1. 核心张力要具体可感，不说空话\n"
            "2. 角色影响要落到具体的内在冲突和行为选择上\n"
            "3. 情节影响要落在可写的情节节点上\n"
            "4. 主题深度要提炼矛盾背后的哲学含义\n"
            "5. 只输出JSON"
        )

        user_prompt = (
            f"矛盾模板：{template.value}\n"
            f"模板结构：{template_structures.get(template, '')}\n\n"
            f"上下文：\n{context or '（无额外上下文）'}\n\n"
            "请展开这个矛盾设定，输出JSON格式：\n"
            '{"element_a": "矛盾的第一极", '
            '"element_b": "矛盾的第二极", '
            '"core_tension": "两极之间的核心张力描述（100-200字）", '
            '"character_implications": ["对主角的具体影响1", "影响2", "影响3"], '
            '"plot_implications": ["可写的情节节点1", "情节节点2", "情节节点3"], '
            '"thematic_depth": "矛盾背后的哲学主题（50-100字）"}'
        )

        result = await self._router.execute(
            agent_name="creative_director",
            task_name="mutation",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            json_mode=True,
            temperature=0.7,
            max_tokens=2048,
        )

        content = result.get("content", "")
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            raise ValueError(f"Failed to parse contradiction LLM response: {content[:200]}")

        tokens = result.get("usage", {})
        return ContradictionExpansion(
            template=template,
            element_a=parsed.get("element_a", ""),
            element_b=parsed.get("element_b", ""),
            core_tension=parsed.get("core_tension", ""),
            character_implications=parsed.get("character_implications", []),
            plot_implications=parsed.get("plot_implications", []),
            thematic_depth=parsed.get("thematic_depth", ""),
            tokens_used=tokens.get("input", 0) + tokens.get("output", 0),
        )
