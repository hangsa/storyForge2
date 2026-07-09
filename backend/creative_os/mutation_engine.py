"""Mutation Engine — 套路变异器 (Tier 1 LLM)."""

import json
import logging

from backend.models.creative_os import MutationOp, MutationResult, Trope

logger = logging.getLogger(__name__)

MUTATION_SYSTEM_PROMPT = """你是一位创意写作顾问，擅长通过变异操作在网络文学套路中创造新鲜感。

四种变异操作：
- inversion（反转）：反转套路的核心前提
- fusion（融合）：融合两个不同套路的元素
- escalation（加码）：将套路的某个维度推到极致
- subversion（颠覆）：颠覆读者对套路的预期

要求：
1. 核心前提必须与原套路形成有意义的差异
2. 核心冲突要体现变异后的新张力
3. 新颖点要具体可感，能抓住读者
4. 自洽性检查要诚实地评估变异的逻辑可行性
5. 只输出JSON"""

FUSION_SYSTEM_PROMPT = """你是一位创意写作顾问，擅长通过融合两个网络文学套路来创造新鲜感。

融合要点：
1. 找出两个套路中最具张力的结合点
2. 核心前提要融合两个套路的精髓
3. 核心冲突要体现融合后的新矛盾
4. 新颖点要让读者感到"熟悉却不同"
5. 自洽性检查要评估融合的逻辑可行性
6. 只输出JSON"""


class MutationEngine:

    def __init__(self, model_router=None) -> None:
        self._router = model_router
        self._agent_name = "creative_director"
        self._task_name = "mutation"

    async def mutate(
        self, trope: Trope, op: MutationOp, context: str = ""
    ) -> MutationResult:
        """Apply a mutation operation to a trope via LLM call."""
        if self._router is None:
            raise NotImplementedError(
                "MutationEngine requires a ModelRouter to perform LLM mutation"
            )

        user_prompt = self._build_mutation_user_prompt(trope, op, context)
        messages = [
            {"role": "system", "content": MUTATION_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ]

        response = await self._router.execute(
            agent_name=self._agent_name,
            task_name=self._task_name,
            messages=messages,
            json_mode=True,
            temperature=0.8,
            max_tokens=2048,
        )

        result_data = self._parse_response(response)
        tokens_used = response.get("usage", {}).get("input", 0) + response.get("usage", {}).get("output", 0)

        return MutationResult(
            operation=op,
            source_trope_id=trope.id,
            source_trope_name=trope.name,
            core_premise=result_data.get("core_premise", ""),
            core_conflict=result_data.get("core_conflict", ""),
            novelty_hook=result_data.get("novelty_hook", ""),
            self_consistency_check=result_data.get("self_consistency_check", ""),
            tokens_used=tokens_used,
        )

    async def fuse(self, trope_a: Trope, trope_b: Trope) -> MutationResult:
        """Fuse two tropes into a new one via LLM call."""
        if self._router is None:
            raise NotImplementedError(
                "MutationEngine requires a ModelRouter to perform LLM fusion"
            )

        user_prompt = self._build_fusion_user_prompt(trope_a, trope_b)
        messages = [
            {"role": "system", "content": FUSION_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ]

        response = await self._router.execute(
            agent_name=self._agent_name,
            task_name=self._task_name,
            messages=messages,
            json_mode=True,
            temperature=0.8,
            max_tokens=2048,
        )

        result_data = self._parse_response(response)
        tokens_used = response.get("usage", {}).get("input", 0) + response.get("usage", {}).get("output", 0)

        return MutationResult(
            operation=MutationOp.FUSION,
            source_trope_id=f"{trope_a.id}+{trope_b.id}",
            source_trope_name=f"{trope_a.name}+{trope_b.name}",
            core_premise=result_data.get("core_premise", ""),
            core_conflict=result_data.get("core_conflict", ""),
            novelty_hook=result_data.get("novelty_hook", ""),
            self_consistency_check=result_data.get("self_consistency_check", ""),
            tokens_used=tokens_used,
        )

    @staticmethod
    def _build_mutation_user_prompt(trope: Trope, op: MutationOp, context: str) -> str:
        op_labels = {
            MutationOp.INVERSION: "反转（Inversion）",
            MutationOp.ESCALATION: "加码（Escalation）",
            MutationOp.SUBVERSION: "颠覆（Subversion）",
        }
        op_label = op_labels.get(op, str(op.value))

        lines = [
            f"套路名称：{trope.name}",
            f"套路分类：{trope.category}",
            f"套路描述：{trope.description}",
            f"市场饱和度：{trope.market_saturation:.0%}",
            f"变异操作：{op_label}",
        ]
        if context:
            lines.append(f"额外上下文：{context}")
        lines.append(
            "\n请基于以上信息，输出应用「"
            + op_label
            + "」后的变异结果JSON，"
            "必须严格使用以下字段（不要输出其它字段）：\n"
            "{\n"
            '  "core_premise": "变异后的核心前提（50-120字）",\n'
            '  "core_conflict": "变异后的核心冲突（30-80字）",\n'
            '  "novelty_hook": "抓住读者的新颖点（30-60字）",\n'
            '  "self_consistency_check": "自洽性评估（30-60字）"\n'
            "}"
        )
        return "\n".join(lines)

    @staticmethod
    def _build_fusion_user_prompt(trope_a: Trope, trope_b: Trope) -> str:
        lines = [
            "请将以下两个套路进行融合：",
            "",
            f"套路A：{trope_a.name}",
            f"  分类：{trope_a.category}",
            f"  描述：{trope_a.description}",
            f"  市场饱和度：{trope_a.market_saturation:.0%}",
            "",
            f"套路B：{trope_b.name}",
            f"  分类：{trope_b.category}",
            f"  描述：{trope_b.description}",
            f"  市场饱和度：{trope_b.market_saturation:.0%}",
            "",
            "请输出融合后的结果JSON：",
        ]
        return "\n".join(lines)

    @staticmethod
    def _parse_response(response: dict) -> dict:
        content = response.get("content", "{}")
        if not content or not content.strip():
            return {}
        # Try direct parse first
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            pass
        # Strip markdown code fences: ```json\n{...}\n``` or ```\n{...}\n```
        stripped = content.strip()
        if stripped.startswith("```"):
            lines = stripped.split("\n")
            # Drop first fence line and last fence line if present
            if lines and lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            stripped = "\n".join(lines).strip()
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            pass
        # Last resort: extract first balanced {...} block
        start = content.find("{")
        if start >= 0:
            depth = 0
            for i in range(start, len(content)):
                if content[i] == "{":
                    depth += 1
                elif content[i] == "}":
                    depth -= 1
                    if depth == 0:
                        candidate = content[start:i + 1]
                        try:
                            return json.loads(candidate)
                        except json.JSONDecodeError:
                            break
        logger.warning(
            "Failed to parse mutation LLM response as JSON: %s", content[:300]
        )
        return {}
