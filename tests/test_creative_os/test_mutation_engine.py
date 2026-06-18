"""Tests for Mutation Engine — LLM Prompt template validation."""

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.creative_os.mutation_engine import MutationEngine
from backend.models.creative_os import MutationOp, MutationResult, Trope


@pytest.fixture
def mock_router():
    return MagicMock()


@pytest.fixture
def sample_trope():
    return Trope(
        id="trope_001",
        name="废柴逆袭",
        category="成长",
        description="主角从底层起步，通过机遇或努力逐步成长为强者",
        market_saturation=0.85,
    )


class TestMutationEngine:

    def test_engine_initialization(self, mock_router):
        engine = MutationEngine(model_router=mock_router)
        assert engine is not None
        assert engine._router is mock_router

    def test_mutation_ops_enum(self):
        assert MutationOp.INVERSION == "inversion"
        assert MutationOp.FUSION == "fusion"
        assert MutationOp.ESCALATION == "escalation"
        assert MutationOp.SUBVERSION == "subversion"

    def test_mutate_requires_router(self, mock_router, sample_trope):
        engine = MutationEngine(model_router=mock_router)
        assert engine is not None


class TestMutationPromptLoading:

    def test_prompt_template_exists(self):
        prompt_path = Path("backend/prompts/creative/mutation_operation.yaml")
        assert prompt_path.exists(), f"Expected prompt at {prompt_path}"


class TestMutationEngineLLM:

    @pytest.mark.asyncio
    async def test_mutate_calls_router(self, mock_router, sample_trope):
        mock_router.execute = AsyncMock(return_value={
            "content": '{"core_premise": "反转后的前提", "core_conflict": "新冲突", '
                       '"novelty_hook": "新颖点", "self_consistency_check": "自洽"}',
            "usage": {"input": 500, "output": 200},
            "model": "deepseek-v4-pro",
            "tier": "tier_1",
        })
        engine = MutationEngine(model_router=mock_router)
        engine._agent_name = "creative_director"
        engine._task_name = "mutation"
        result = await engine.mutate(sample_trope, MutationOp.INVERSION)
        assert isinstance(result, MutationResult)
        assert result.operation == MutationOp.INVERSION
        assert result.core_premise == "反转后的前提"
        assert result.tokens_used == 700
        mock_router.execute.assert_called_once()

    @pytest.mark.asyncio
    async def test_fuse_calls_router(self, mock_router, sample_trope):
        mock_router.execute = AsyncMock(return_value={
            "content": '{"core_premise": "融合前提", "core_conflict": "融合冲突", '
                       '"novelty_hook": "融合新颖点", "self_consistency_check": "自洽"}',
            "usage": {"input": 600, "output": 250},
            "model": "deepseek-v4-pro",
            "tier": "tier_1",
        })
        engine = MutationEngine(model_router=mock_router)
        engine._agent_name = "creative_director"
        engine._task_name = "mutation"
        result = await engine.fuse(sample_trope, sample_trope)
        assert result.operation == MutationOp.FUSION
        assert result.tokens_used == 850
        mock_router.execute.assert_called_once()

    @pytest.mark.asyncio
    async def test_mutate_without_router_raises(self, sample_trope):
        engine = MutationEngine(model_router=None)
        with pytest.raises(NotImplementedError):
            await engine.mutate(sample_trope, MutationOp.INVERSION)
