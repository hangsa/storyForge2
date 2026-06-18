"""Genre Fusion Engine -- 体裁融合器 (deterministic matrix + BFS + Tier 1 LLM fusion analysis)."""

import logging
from collections import deque

from backend.models.creative_os import FusionAnalysis

logger = logging.getLogger(__name__)

GENRE_GRAPH: dict[str, set[str]] = {
    "修仙": {"玄幻", "武侠", "仙侠", "神话"},
    "玄幻": {"修仙", "武侠", "奇幻", "神话", "异界"},
    "武侠": {"修仙", "玄幻", "历史", "都市", "仙侠"},
    "奇幻": {"玄幻", "科幻", "都市", "游戏", "恐怖", "异界"},
    "科幻": {"奇幻", "都市", "末世", "游戏", "悬疑", "推理", "战争"},
    "都市": {"武侠", "奇幻", "科幻", "悬疑", "言情", "推理"},
    "悬疑": {"都市", "恐怖", "科幻", "推理", "言情"},
    "恐怖": {"悬疑", "末世", "奇幻"},
    "末世": {"科幻", "恐怖", "游戏", "战争"},
    "历史": {"武侠", "言情", "战争", "神话"},
    "神话": {"修仙", "玄幻", "历史", "仙侠"},
    "游戏": {"奇幻", "科幻", "末世", "异界"},
    "言情": {"都市", "历史", "悬疑"},
    "推理": {"悬疑", "都市", "科幻"},
    "仙侠": {"修仙", "武侠", "神话"},
    "异界": {"玄幻", "奇幻", "游戏"},
    "战争": {"历史", "末世", "科幻"},
}


class GenreFusionEngine:

    COMPATIBILITY_MATRIX: dict[str, dict[str, str]] = {
        "修仙": {"玄幻": "高", "武侠": "高", "仙侠": "高", "神话": "中", "历史": "中", "奇幻": "中",
                 "科幻": "低", "都市": "低", "悬疑": "低", "恐怖": "低", "末世": "低", "游戏": "低",
                 "言情": "低", "推理": "低", "异界": "中", "战争": "低"},
        "玄幻": {"修仙": "高", "武侠": "中", "仙侠": "中", "神话": "中", "历史": "中", "奇幻": "高",
                 "科幻": "低", "都市": "低", "悬疑": "低", "恐怖": "低", "末世": "低", "游戏": "中",
                 "言情": "低", "推理": "低", "异界": "中", "战争": "低"},
        "科幻": {"奇幻": "中", "都市": "中", "末世": "高", "游戏": "中", "修仙": "低", "玄幻": "低",
                 "武侠": "低", "仙侠": "低", "神话": "低", "历史": "低", "悬疑": "中", "恐怖": "低",
                 "言情": "低", "推理": "中", "异界": "低", "战争": "中"},
        "都市": {"言情": "高", "悬疑": "中", "武侠": "低", "奇幻": "中", "科幻": "中", "历史": "中",
                 "推理": "中", "修仙": "低", "玄幻": "低", "仙侠": "低", "神话": "低", "恐怖": "低",
                 "末世": "低", "游戏": "低", "异界": "低", "战争": "低"},
        "推理": {"悬疑": "高", "都市": "中", "科幻": "中", "恐怖": "中", "修仙": "低", "玄幻": "低",
                 "武侠": "低", "仙侠": "低", "神话": "低", "奇幻": "低", "末世": "低", "游戏": "低",
                 "言情": "低", "历史": "低", "异界": "低", "战争": "低"},
        "末世": {"科幻": "高", "恐怖": "中", "游戏": "中", "战争": "中", "修仙": "低", "玄幻": "低",
                 "武侠": "低", "仙侠": "低", "神话": "低", "奇幻": "低", "都市": "低", "悬疑": "低",
                 "言情": "低", "推理": "低", "历史": "低", "异界": "低"},
        "游戏": {"奇幻": "高", "科幻": "中", "末世": "中", "修仙": "低", "玄幻": "中", "武侠": "低",
                 "仙侠": "低", "神话": "低", "都市": "低", "悬疑": "低", "恐怖": "低", "言情": "低",
                 "推理": "低", "历史": "低", "异界": "中", "战争": "低"},
        "悬疑": {"推理": "高", "恐怖": "中", "都市": "中", "科幻": "中", "修仙": "低", "玄幻": "低",
                 "武侠": "低", "仙侠": "低", "神话": "低", "奇幻": "低", "末世": "低", "游戏": "低",
                 "言情": "中", "历史": "低", "异界": "低", "战争": "低"},
        "恐怖": {"悬疑": "中", "末世": "中", "推理": "中", "修仙": "低", "玄幻": "低", "武侠": "低",
                 "仙侠": "低", "神话": "低", "奇幻": "中", "科幻": "低", "都市": "低", "游戏": "低",
                 "言情": "低", "历史": "低", "异界": "低", "战争": "低"},
        "武侠": {"修仙": "高", "玄幻": "中", "仙侠": "高", "历史": "高", "神话": "中", "奇幻": "低",
                 "科幻": "低", "都市": "低", "悬疑": "低", "恐怖": "低", "末世": "低", "游戏": "低",
                 "言情": "低", "推理": "低", "异界": "低", "战争": "中"},
        "仙侠": {"修仙": "高", "玄幻": "中", "武侠": "高", "神话": "中", "历史": "中", "奇幻": "中",
                 "科幻": "低", "都市": "低", "悬疑": "低", "恐怖": "低", "末世": "低", "游戏": "低",
                 "言情": "低", "推理": "低", "异界": "中", "战争": "低"},
        "历史": {"修仙": "中", "玄幻": "中", "武侠": "高", "仙侠": "中", "神话": "中", "奇幻": "中",
                 "科幻": "低", "都市": "中", "悬疑": "低", "恐怖": "低", "末世": "低", "游戏": "低",
                 "言情": "高", "推理": "低", "异界": "低", "战争": "高"},
        "奇幻": {"修仙": "中", "玄幻": "高", "武侠": "低", "仙侠": "中", "神话": "中", "历史": "中",
                 "科幻": "中", "都市": "中", "悬疑": "低", "恐怖": "中", "末世": "低", "游戏": "高",
                 "言情": "低", "推理": "低", "异界": "高", "战争": "低"},
        "异界": {"修仙": "中", "玄幻": "中", "武侠": "低", "仙侠": "中", "神话": "低", "历史": "低",
                 "奇幻": "高", "科幻": "低", "都市": "低", "悬疑": "低", "恐怖": "低", "末世": "低",
                 "游戏": "中", "言情": "低", "推理": "低", "战争": "低"},
        "战争": {"修仙": "低", "玄幻": "低", "武侠": "中", "仙侠": "低", "神话": "低", "历史": "高",
                 "奇幻": "低", "科幻": "中", "都市": "低", "悬疑": "低", "恐怖": "低", "末世": "中",
                 "游戏": "低", "言情": "低", "推理": "低", "异界": "低"},
        "神话": {"修仙": "中", "玄幻": "中", "武侠": "中", "仙侠": "中", "历史": "中", "奇幻": "中",
                 "科幻": "低", "都市": "低", "悬疑": "低", "恐怖": "低", "末世": "低", "游戏": "低",
                 "言情": "低", "推理": "低", "异界": "低", "战争": "低"},
        "言情": {"修仙": "低", "玄幻": "低", "武侠": "低", "仙侠": "低", "神话": "低", "历史": "高",
                 "奇幻": "低", "科幻": "低", "都市": "高", "悬疑": "中", "恐怖": "低", "末世": "低",
                 "游戏": "低", "推理": "低", "异界": "低", "战争": "低"},
    }

    def __init__(self, model_router=None) -> None:
        self._router = model_router

    def get_compatibility(self, genre_a: str, genre_b: str) -> str:
        if genre_a == genre_b:
            return "高"
        row = self.COMPATIBILITY_MATRIX.get(genre_a, {})
        return row.get(genre_b, "低")

    def compute_distance(self, genre_a: str, genre_b: str) -> int:
        if genre_a == genre_b:
            return 0
        if genre_a not in GENRE_GRAPH or genre_b not in GENRE_GRAPH:
            return 3
        visited = {genre_a}
        queue = deque([(genre_a, 0)])
        while queue:
            current, dist = queue.popleft()
            for neighbor in GENRE_GRAPH.get(current, set()):
                if neighbor == genre_b:
                    return dist + 1
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append((neighbor, dist + 1))
        return 3

    async def analyze_fusion(
        self, genre_a: str, genre_b: str, premise: str = ""
    ) -> FusionAnalysis:
        if self._router is None:
            raise NotImplementedError(
                "LLM fusion analysis requires model_router — pass it in constructor"
            )

        import json

        compatibility = self.get_compatibility(genre_a, genre_b)
        distance = self.compute_distance(genre_a, genre_b)

        system_prompt = (
            "你是一位跨类型故事策划师，擅长分析不同体裁之间的融合可能性。\n\n"
            "分析维度：\n"
            "1. 叙事节奏（narrative_rhythm）：两者的节奏特点如何融合\n"
            "2. 角色原型（character_archetype）：典型角色如何跨类型转化\n"
            "3. 冲突类型（conflict_type）：各自的核心冲突如何结合\n"
            "4. 世界观规则（world_rules）：两个世界的规则如何共存\n"
            "5. 情感曲线（emotion_curve）：各自的情感调度如何叠加\n\n"
            "只输出JSON。"
        )

        user_prompt = (
            f"体裁A：{genre_a}\n"
            f"体裁B：{genre_b}\n"
            f"兼容性评分：{compatibility}\n"
            f"体裁BFS距离：{distance}\n\n"
            f"故事前提：{premise or '（无特定前提）'}\n\n"
            "请分析这两个体裁在5个维度的融合可能性，输出JSON格式：\n"
            '{"narrative_rhythm": "节奏融合建议（50-100字）", '
            '"character_archetype": "角色跨类型转化建议（50-100字）", '
            '"conflict_type": "冲突类型结合建议（50-100字）", '
            '"world_rules": "世界观共存方案（50-100字）", '
            '"emotion_curve": "情感曲线叠加方案（50-100字）", '
            '"caution_areas": ["融合风险1", "风险2"]}'
        )

        result = await self._router.execute(
            agent_name="creative_director",
            task_name="fusion_analysis",
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
            raise ValueError(f"Failed to parse genre fusion LLM response: {content[:200]}")

        tokens = result.get("usage", {})
        return FusionAnalysis(
            genre_a=genre_a,
            genre_b=genre_b,
            compatibility=compatibility,
            genre_distance=distance,
            fusion_points={
                "narrative_rhythm": parsed.get("narrative_rhythm", ""),
                "character_archetype": parsed.get("character_archetype", ""),
                "conflict_type": parsed.get("conflict_type", ""),
                "world_rules": parsed.get("world_rules", ""),
                "emotion_curve": parsed.get("emotion_curve", ""),
            },
            caution_areas=parsed.get("caution_areas", []),
            tokens_used=tokens.get("input", 0) + tokens.get("output", 0),
        )
