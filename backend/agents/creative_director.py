"""Creative Director Agent — 创意画布引导 Agent (Tier 1/3)."""

import json
import logging
from typing import Optional

from backend.agents.base_agent import BaseAgent
from backend.models.creative_os import WhatIfNode

logger = logging.getLogger(__name__)


class CreativeDirector(BaseAgent):
    agent_name = "creative_director"

    def __init__(
        self,
        project_id: str,
        prompts_dir=None,
        model_router=None,
    ):
        super().__init__(project_id, prompts_dir, model_router)

    async def suggest_direction(
        self, current_node: WhatIfNode, canvas_state: dict
    ) -> str:
        dims_covered = canvas_state.get("dimensions_covered", [])
        all_dims = ["角色动机", "世界观规则", "情节方向", "读者体验"]
        dims_missing = [d for d in all_dims if d not in dims_covered]

        system_prompt = (
            "你是一位创意画布的叙事引导师。你的任务是根据当前画布状态和用户选中的节点，"
            "建议下一步的发散方向。\n\n"
            "引导原则：\n"
            "1. 优先填补未覆盖的叙事维度\n"
            "2. 关注新颖度较低的节点，建议变异方向\n"
            "3. 识别高饱和度套路，建议蓝海方向\n"
            "4. 建议要具体，引用节点内容\n\n"
            "只输出纯文本建议（50-150字），不要JSON。"
        )

        user_prompt = (
            f"当前节点内容：{current_node.content}\n"
            f"当前节点分支状态：{current_node.branch_status}\n"
            f"当前节点新颖度评分：{current_node.novelty_score}\n\n"
            f"画布统计：\n"
            f"- 总节点数：{canvas_state.get('total_nodes', 0)}\n"
            f"- 深度分布：{json.dumps(canvas_state.get('depth_distribution', {}), ensure_ascii=False)}\n"
            f"- 已覆盖维度：{', '.join(dims_covered) or '无'}\n"
            f"- 未覆盖维度：{', '.join(dims_missing) or '无'}\n"
            f"- 最高新颖度：{canvas_state.get('max_score', 0)}\n"
            f"- 最低新颖度：{canvas_state.get('min_score', 0)}\n\n"
            "请给出下一步发散方向建议。"
        )

        try:
            result = await self.router.execute(
                agent_name=self.agent_name,
                task_name="creative_brainstorming",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                json_mode=False,
                temperature=0.7,
                max_tokens=1024,
            )
            return result.get("content", "")
        except Exception as e:
            logger.warning("suggest_direction failed: %s", e)
            return ""

    async def recommend_mutation(self, node: WhatIfNode) -> str:
        system_prompt = (
            "你是一位套路变异分析专家。给定一个包含特定套路的叙事节点，"
            "分析四种变异操作（Inversion反转 / Fusion融合 / Escalation加码 / Subversion颠覆）"
            "中哪一个最适合该节点，并给出具体理由。\n\n"
            "只输出纯文本建议（30-80字），不要JSON。"
        )

        tags_str = ", ".join(node.trope_tags) if node.trope_tags else "无特定套路标签"
        user_prompt = (
            f"节点内容：{node.content}\n"
            f"节点分支状态：{node.branch_status}\n"
            f"套路标签：{tags_str}\n\n"
            "请推荐最适合该节点的变异操作，说明理由。"
        )

        try:
            result = await self.router.execute(
                agent_name=self.agent_name,
                task_name="trope_extraction",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                json_mode=False,
                temperature=0.5,
                max_tokens=512,
            )
            return result.get("content", "")
        except Exception as e:
            logger.warning("recommend_mutation failed: %s", e)
            return ""

    async def evaluate_path(self, path_nodes: list[WhatIfNode]) -> str:
        path_summary_parts = []
        for i, node in enumerate(path_nodes):
            path_summary_parts.append(
                f"节点{i+1}(深度{node.depth}, 状态{node.branch_status}, 新颖度{node.novelty_score}): {node.content}"
            )
        path_summary = "\n".join(path_summary_parts)

        system_prompt = (
            "你是一位故事策划顾问，负责评估一条叙事路径的整体潜力。\n\n"
            "评估维度：\n"
            "1. 逻辑连贯性：路径上各节点的因果关系是否自洽\n"
            "2. 张力曲线：叙事张力是否呈现上升趋势\n"
            "3. 新颖度趋势：整体新颖度是否足够\n"
            "4. 可写性：路径终点是否形成可执行的场景钩子\n\n"
            "只输出纯文本评估（100-200字），不要JSON。"
        )

        user_prompt = (
            f"选定路径节点序列：\n{path_summary}\n\n"
            "请评估该路径的整体叙事潜力。"
        )

        try:
            result = await self.router.execute(
                agent_name=self.agent_name,
                task_name="creative_brainstorming",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                json_mode=False,
                temperature=0.6,
                max_tokens=1024,
            )
            return result.get("content", "")
        except Exception as e:
            logger.warning("evaluate_path failed: %s", e)
            return ""
