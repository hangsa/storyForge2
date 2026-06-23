"""WhatIf Engine — 连续发散器 (递归树 + 懒惰加载 + Tier 分档)."""

from __future__ import annotations

import logging

from backend.models.creative_os import WhatIfNode

logger = logging.getLogger(__name__)

DIMENSIONS: list[str] = []  # kept as no-op for backward-compat; not used in prompts


class WhatIfEngine:
    MAX_DEPTH = 3
    BRANCHES_PER_NODE = 3
    BREADTH = 3  # backward-compat alias

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
            "你是一位具有破局思维的创意架构师，专精于从单一叙事种子中生发出"
            "宏大、互斥且令人意外的剧情走向。\n\n"
            "核心立场——大局观优先：\n"
            "你思考的是【世界观张力、主题立场、人物命运走向】三个宏观层面，"
            "而不是具体设定或情节细节。一条分支的价值在于它代表的世界观可能性，"
            "不在于场景多华丽。\n\n"
            "发散原则：\n"
            "1. 极端分化：三条路径在【类型基调、核心冲突、主角命运】三个维度上互斥。"
            "一条走向要暗到极致、一条亮到极致、一条在灰色地带游走——"
            "绝不接受「同一思路的A/B/C变体」。\n"
            "2. 逆向破局：主动颠覆读者预期。背叛类型套路、反转主角视角、"
            "质疑前提本身的隐含假设、让「不可能」成为故事核心机制。\n"
            "3. 跨类型嫁接：大胆引入异质类型元素（科幻×江湖、悬疑×日常、"
            "史诗×黑色幽默、修仙×职场），碰撞出类型间未见的化学反应。\n"
            "4. 主题深度：每条路径必须触及一个核心命题"
            "（自由vs宿命、爱vs真相、个体vs系统、救赎vs堕落），"
            "不是空泛的情节，而是人物在这个命题上被迫选择。\n"
            "5. 标志性画面：每个走向要能用一个具体的画面或瞬间概括"
            "（「他在雨夜的十字路口朝三个方向各迈一步」）。\n\n"
            "差异化验收标准：\n"
            "- 三条路径听起来必须像三部不同类型片的三种开场\n"
            "- 如果你的三条分支可以互换位置而不影响故事，说明还不够分化\n"
            "- 至少有一条要包含读者「没想到会这样走」的惊喜元素\n\n"
            "输出规范：\n"
            "1. 自洽但惊人——内部逻辑完整，同时让读者停顿一下\n"
            "2. 具体可感：描述场景、动作、转折，不用抽象概念词\n"
            "3. novelty_score 合理（0-100），颠覆套路的方向应得高分\n"
            "4. trope_tags 贴切（1-3个网文套路标签）\n"
            "5. 子分支与祖先路径连贯，不前后矛盾\n"
            "6. 只输出JSON数组，不要任何说明文字"
        )

        user_prompt = (
            f"当前前提：{node.content}\n"
            f"当前深度：第{node.depth}层\n"
        )
        if ancestor_contents:
            chain = " → ".join(ancestor_contents)
            user_prompt += f"祖先路径（从根到当前）：\n{chain}\n"
        user_prompt += (
            f"\n请生成 {self.BRANCHES_PER_NODE} 条互斥的剧情走向选项，"
            "输出JSON数组格式：\n"
            '[{"content": "走向内容（50-150字）", '
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
        for item in parsed[:self.BRANCHES_PER_NODE]:
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
        """Deprecated — kept as a no-op for backward compat. Returns empty string."""
        return ""
