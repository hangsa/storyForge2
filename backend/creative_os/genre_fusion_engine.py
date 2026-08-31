"""Genre Fusion Engine -- 体裁融合器 (deterministic matrix + BFS + Tier 1 LLM fusion analysis)."""

import logging
from collections import deque

from backend.models.creative_os import FusionAnalysis

logger = logging.getLogger(__name__)


class GenreFusionEngine:

    def __init__(self, model_router=None) -> None:
        self._router = model_router
        self._build_graph()

    def _build_graph(self) -> None:
        """Build internal genre graph and compatibility map from GenreCatalog.

        Self-edges are excluded. _graph stores bare genre ids as BFS-traversable
        lists; the float weight is preserved separately in _compatibility.
        Threshold 0.3 marks a "knows-about" relationship for BFS purposes.
        """
        from backend.genres.catalog import get_catalog

        catalog = get_catalog()
        entries = catalog.list()
        if not entries:
            raise ValueError("GenreCatalog returned an empty genre list")

        catalog_genre_ids = {e["id"] for e in entries}
        self._compatibility = {}
        self._graph = {}
        for genre in catalog_genre_ids:
            self._compatibility[genre] = {}
            self._graph[genre] = []
            for other in catalog_genre_ids:
                if other == genre:
                    continue
                compat = catalog.get_compatibility(genre, other)
                self._compatibility[genre][other] = compat
                if compat >= 0.3:
                    self._graph[genre].append(other)

    def get_compatibility(self, genre_a: str, genre_b: str) -> str:
        if genre_a == genre_b:
            return "高"
        row = self._compatibility.get(genre_a, {})
        value = row.get(genre_b, 0.0)
        if value >= 0.7:
            return "高"
        if value >= 0.4:
            return "中"
        return "低"

    def compute_distance(self, genre_a: str, genre_b: str) -> int:
        if genre_a == genre_b:
            return 0
        if genre_a not in self._graph or genre_b not in self._graph:
            return 3
        visited = {genre_a}
        queue = deque([(genre_a, 0)])
        while queue:
            current, dist = queue.popleft()
            for neighbor in self._graph.get(current, []):
                if neighbor == genre_b:
                    return dist + 1
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append((neighbor, dist + 1))
        return 3

    @staticmethod
    def get_risk_level(distance: int) -> str:
        """Map BFS distance (0-3) to risk_level.

        Bands (per PRD §3.4):
          - 0 (same genre)     → low
          - 1 (near-related)   → low
          - 2 (medium)         → medium
          - 3+ (far/unrelated) → high
        """
        if distance <= 1:
            return "low"
        if distance == 2:
            return "medium"
        return "high"

    def calculate_distance(self, genre_a: str, genre_b: str) -> dict:
        """Wraps compute_distance; returns dict with distance + risk + explanation.

        The existing compute_distance (returns int) is preserved for
        backward compatibility — Task 7 (/fuse) uses it directly.
        """
        distance = self.compute_distance(genre_a, genre_b)
        risk_level = self.get_risk_level(distance)
        if genre_a == genre_b:
            explanation = f"{genre_a} 与 {genre_b} 是同一类型,距离 0 跳,融合风险低"
        elif distance == 1:
            explanation = f"{genre_a} 与 {genre_b} 紧邻,1 跳可达,融合风险低"
        elif distance == 2:
            explanation = f"{genre_a} 与 {genre_b} 中等距离,2 跳可达,融合风险中等"
        else:
            explanation = f"{genre_a} 与 {genre_b} 距离遥远(>=3 跳)或不可达,融合风险高"
        return {
            "distance": distance,
            "genre_a": genre_a,
            "genre_b": genre_b,
            "risk_level": risk_level,
            "explanation": explanation,
        }

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
