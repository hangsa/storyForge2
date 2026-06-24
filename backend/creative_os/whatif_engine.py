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
            "核心立场——大局观与跨类型优先：\n"
            "你思考的是【文明级冲突、时代命题、阵营命运】三个宏观层面，"
            "不是个人恩怨或场景细节。一条分支的价值在于它代表的世界观可能性"
            "和它能撑起多大的故事宇宙——能撑起一部百万字史诗的方向才有价值。\n\n"
            "发散原则——绝不在同一类型里换皮：\n"
            "1. 极端分化（必备）：三条路径在【类型基调、核心冲突、主角命运、"
            "时间跨度】四个维度上互斥。\n"
            "   - 一条走向要暗到极致（灭世、献祭、不可逆的代价）\n"
            "   - 一条亮到极致（重建、觉醒、超越宿命的英雄之旅）\n"
            "   - 一条在灰色地带游走（颠覆正邪本身、对抗系统而非个人）\n"
            "   - 绝不接受「同一思路的A/B/C变体」或「同一类型的三种结局」\n"
            "2. 逆向破局（必备）：主动颠覆读者预期。\n"
            "   - 背叛类型套路（玄幻主角其实是反派、修仙其实是AI实验）\n"
            "   - 反转主角视角（从救世主变成灾星、从受害者变成加害者）\n"
            "   - 质疑前提本身的隐含假设（血脉反噬其实是恩赐、天才身份是骗局）\n"
            "   - 让「不可能」成为故事核心机制（穿越、轮回、第四面墙）\n"
            "3. 跨类型嫁接（必备，每条都要带异质元素）：\n"
            "   - 强制把至少两个完全不同的类型嫁接在一起：\n"
            "     科幻×江湖、悬疑×日常、史诗×黑色幽默、修仙×职场、"
            "     末世×宫廷、谍战×玄幻、游戏×现实、历史×赛博朋克\n"
            "   - 不要三条都留在原类型里——如果前提是玄幻，"
            "     至少一条要跳到科幻/悬疑/职场/历史等完全不同的领域\n"
            "4. 宏大尺度（必备）：每条路径都要能撑起长篇。\n"
            "   - 时间跨度：十年/百年/千年/轮回\n"
            "   - 空间跨度：一城/一国/一界/多元宇宙\n"
            "   - 冲突规模：个人恩怨 < 阵营对抗 < 文明兴亡 < 维度战争\n"
            "   - 不要停留在「主角一个人怎么打怪升级」\n"
            "5. 主题深度（必备）：每条路径必须触及一个核心命题\n"
            "   （自由vs宿命、爱vs真相、个体vs系统、救赎vs堕落、记忆vs真相、"
            "    人性vs神性、文明vs自然），人物在这个命题上被迫做出不可逆选择。\n"
            "6. 标志性画面（必备）：每个走向要能用一个具体的、震撼的画面概括\n"
            "   （「他在雨夜的十字路口朝三个方向各迈一步」）。\n\n"
            "差异化验收标准（写作前自检）：\n"
            "- 三条路径听起来必须像三部完全不同的类型片的三种开场\n"
            "- 如果你的三条分支可以互换位置而不影响故事，说明还不够分化\n"
            "- 如果三条都在同一类型里，说明你偷懒了——回去重写\n"
            "- 至少两条要包含读者「没想到会这样走」的惊喜元素\n"
            "- 至少一条的时间跨度要达到「百年/轮回/世代」级别\n\n"
            "输出规范：\n"
            "1. 自洽但惊人——内部逻辑完整，同时让读者停顿一下\n"
            "2. 具体可感：描述场景、动作、转折，不用抽象概念词\n"
            "3. novelty_score 合理（0-100），颠覆套路的方向应得高分\n"
            "4. trope_tags 贴切（1-3个网文套路标签），但 branch 内容要跳出标签\n"
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
