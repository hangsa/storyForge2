"""Mutation Engine — 套路变异器 (Tier 1 LLM)."""

import logging

from backend.models.creative_os import MutationOp, MutationResult, Trope

logger = logging.getLogger(__name__)


class MutationEngine:

    def __init__(self, model_router=None) -> None:
        self._router = model_router
        self._agent_name = "creative_director"
        self._task_name = "mutation"

    async def mutate(
        self, trope: Trope, op: MutationOp, context: str = ""
    ) -> MutationResult:
        raise NotImplementedError(
            "LLM mutation requires Prompt YAML files — implement in Task 10"
        )

    async def fuse(self, trope_a: Trope, trope_b: Trope) -> MutationResult:
        raise NotImplementedError(
            "LLM fusion requires Prompt YAML files — implement in Task 10"
        )
