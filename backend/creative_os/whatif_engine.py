"""WhatIf Engine — 连续发散器 (递归树 + 懒惰加载 + Tier 分档)."""

from __future__ import annotations

import logging

from backend.models.creative_os import WhatIfNode

logger = logging.getLogger(__name__)

DIMENSIONS = ["角色动机", "世界观规则", "情节方向", "读者体验"]


class WhatIfEngine:
    MAX_DEPTH = 3
    BREADTH = 4

    def __init__(self, model_router=None, novelty_evaluator=None) -> None:
        self._router = model_router
        self._novelty_evaluator = novelty_evaluator
        self._node_counter: dict[int, int] = {0: 0, 1: 0, 2: 0, 3: 0}

    def generate_root(self, premise: str) -> WhatIfNode:
        self._node_counter[0] += 1
        node_id = f"wi_{self._node_counter[0]:03d}_00"
        return WhatIfNode(
            id=node_id,
            depth=0,
            parent_id=None,
            content=premise,
            dimension=self._pick_dimension(0),
            is_expanded=False,
        )

    async def expand_node(
        self,
        node: WhatIfNode,
        ancestor_contents: list[str] | None = None,
    ) -> list[WhatIfNode]:
        """Expand a WhatIf node into BREADTH children using LLM generation.

        Args:
            node: The node to expand. Must have depth < MAX_DEPTH.
            ancestor_contents: List of content strings from root → parent
                (excluding the node itself). Provides narrative continuity
                for deeper expansions.

        Returns:
            List of child WhatIfNode objects. Empty list if at max depth.
        """
        if self._router is None:
            raise NotImplementedError(
                "LLM expansion requires model_router — pass it in constructor"
            )

        if node.depth >= self.MAX_DEPTH:
            return []

        import json

        system_prompt = (
            "你是一位资深的创意故事构思师，擅长从叙事前提中生发散性分支。\n"
            "你的任务是：给定一个故事前提/创意节点，从4个叙事维度各生成一个分支可能。\n\n"
            "四个叙事维度：\n"
            "1. 角色动机 — 角色的内在驱动力和情感变化\n"
            "2. 世界观规则 — 世界的底层法则和运行逻辑\n"
            "3. 情节方向 — 故事的情节走向和冲突发展\n"
            "4. 读者体验 — 读者的情绪体验和期待\n\n"
            "要求：\n"
            "1. 每个分支要具体可感，不说空话\n"
            "2. 分支之间要有足够的差异性\n"
            "3. novelty_score 要合理（0-100，越高越新颖）\n"
            "4. trope_tags 要贴切（1-3个标签）\n"
            "5. 子分支必须与祖先路径在叙事上连贯，不能前后矛盾\n"
            "6. 只输出JSON数组，不要有任何说明文字"
        )

        user_prompt = (
            f"当前前提：{node.content}\n"
            f"当前深度：第{node.depth}层\n"
            f"当前维度：{node.dimension}\n"
        )
        if ancestor_contents:
            chain = " → ".join(ancestor_contents)
            user_prompt += f"祖先路径（从根到当前）：\n{chain}\n"
        user_prompt += (
            f"\n请生成{self.BREADTH}个分支（分别对应四个叙事维度：角色动机、世界观规则、情节方向、读者体验），"
            "输出JSON数组格式：\n"
            '[{"content": "分支内容（50-150字）", '
            '"dimension": "角色动机/世界观规则/情节方向/读者体验", '
            '"novelty_score": 75, '
            '"trope_tags": ["标签1", "标签2"]}]'
        )

        result = await self._router.execute(
            agent_name="creative_director",
            task_name="whatif_expansion",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            json_mode=True,
            temperature=0.8,
            max_tokens=2048,
        )

        content = result.get("content", "")
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:
            raise ValueError(
                f"Failed to parse WhatIf LLM response: {content[:200]}"
            )

        if not isinstance(parsed, list):
            raise ValueError(
                f"Expected JSON array, got {type(parsed).__name__}: {content[:200]}"
            )

        children = []
        for item in parsed[:self.BREADTH]:
            child_depth = node.depth + 1
            self._node_counter[child_depth] += 1
            child_id = (
                f"wi_{child_depth}_"
                f"{self._node_counter[child_depth]:03d}_"
                f"{len(children):02d}"
            )
            child = WhatIfNode(
                id=child_id,
                depth=child_depth,
                parent_id=node.id,
                content=item.get("content", ""),
                dimension=item.get("dimension", self._pick_dimension(child_depth)),
                novelty_score=item.get("novelty_score", 0.0),
                trope_tags=item.get("trope_tags", []),
            )
            node.children_ids.append(child_id)
            children.append(child)

        node.is_expanded = True
        return children

    async def precompute_leaves(self, node: WhatIfNode) -> list[WhatIfNode]:
        """Precompute leaf-node expansions (e.g. for Tier 3 background generation).

        Currently delegates directly to expand_node.
        """
        return await self.expand_node(node)

    async def regenerate_node(
        self, node: WhatIfNode, tier: str = "tier_1"
    ) -> WhatIfNode:
        """Regenerate a node by re-expanding and returning the first child."""
        children = await self.expand_node(node, ancestor_contents=None)
        if not children:
            raise ValueError(
                f"Regeneration failed: expand_node returned no children "
                f"for node {node.id} at depth {node.depth}"
            )
        return children[0]

    def _pick_dimension(self, depth: int) -> str:
        return DIMENSIONS[depth % len(DIMENSIONS)]
