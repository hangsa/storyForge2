"""WhatIf Engine — 连续发散器 (递归树 + 懒惰加载 + Tier 分档)."""

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
        self, node: WhatIfNode, path_context: str = ""
    ) -> list[WhatIfNode]:
        raise NotImplementedError(
            "LLM expansion requires Prompt YAML files — implement in Task 10"
        )

    async def precompute_leaves(self, node: WhatIfNode) -> list[WhatIfNode]:
        raise NotImplementedError(
            "Tier 3 precompute requires Prompt YAML files — implement in Task 10"
        )

    async def regenerate_node(
        self, node: WhatIfNode, tier: str = "tier_1"
    ) -> WhatIfNode:
        raise NotImplementedError(
            "LLM regeneration requires Prompt YAML files — implement in Task 10"
        )

    def _pick_dimension(self, depth: int) -> str:
        return DIMENSIONS[depth % len(DIMENSIONS)]
