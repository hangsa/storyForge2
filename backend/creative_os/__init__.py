"""CreativeOS v1.7 — 创意操作系统引擎.

7 引擎：
- IdeaPool — 灵感种子库 (确定性)
- TropePool — 套路模式库 (确定性)
- MutationEngine — 套路变异器 (Tier 1 LLM)
- ContradictionEngine — 矛盾设定生成器 (LLM + 确定性评分)
- WhatIfEngine — 连续发散器 (递归树 + Tier 1/3 LLM)
- GenreFusionEngine — 体裁融合器 (BFS + Tier 1 LLM)
- NoveltyEvaluator — 新颖度评估器 (4 维, 75% 确定性)
"""

from backend.creative_os.idea_pool import IdeaPool
from backend.creative_os.trope_pool import TropePool
from backend.creative_os.mutation_engine import MutationEngine
from backend.creative_os.contradiction_engine import ContradictionEngine
from backend.creative_os.whatif_engine import WhatIfEngine
from backend.creative_os.genre_fusion_engine import GenreFusionEngine
from backend.creative_os.novelty_evaluator import NoveltyEvaluator

__all__ = [
    "IdeaPool",
    "TropePool",
    "MutationEngine",
    "ContradictionEngine",
    "WhatIfEngine",
    "GenreFusionEngine",
    "NoveltyEvaluator",
]
