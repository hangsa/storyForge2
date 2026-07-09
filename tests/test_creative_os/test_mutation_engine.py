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


class TestParseResponseRobustness:
    """Regression: LLM output formats vary. Parser must accept:
    - pure JSON
    - markdown code-fenced JSON
    - prose wrapped around JSON
    - empty / malformed → empty dict (not crash)
    """

    def test_pure_json(self, mock_router):
        engine = MutationEngine(model_router=mock_router)
        result = engine._parse_response({
            "content": '{"core_premise": "abc"}'
        })
        assert result == {"core_premise": "abc"}

    def test_markdown_fenced_json(self, mock_router):
        engine = MutationEngine(model_router=mock_router)
        result = engine._parse_response({
            "content": '```json\n{"core_premise": "abc"}\n```'
        })
        assert result == {"core_premise": "abc"}

    def test_markdown_fenced_no_language(self, mock_router):
        engine = MutationEngine(model_router=mock_router)
        result = engine._parse_response({
            "content": '```\n{"core_premise": "abc"}\n```'
        })
        assert result == {"core_premise": "abc"}

    def test_prose_wrapped_json(self, mock_router):
        engine = MutationEngine(model_router=mock_router)
        result = engine._parse_response({
            "content": '以下是结果：\n{"core_premise": "abc", "core_conflict": "def"}'
        })
        assert result["core_premise"] == "abc"
        assert result["core_conflict"] == "def"

    def test_empty_content(self, mock_router):
        engine = MutationEngine(model_router=mock_router)
        assert engine._parse_response({"content": ""}) == {}

    def test_completely_garbage(self, mock_router):
        engine = MutationEngine(model_router=mock_router)
        assert engine._parse_response({"content": "hello world no json"}) == {}

    def test_nested_braces_in_json(self, mock_router):
        engine = MutationEngine(model_router=mock_router)
        content = '前缀 {"a": 1, "b": {"c": 2}} 后缀'
        result = engine._parse_response({"content": content})
        assert result == {"a": 1, "b": {"c": 2}}


class TestBuildMutationUserPrompt:
    """The prompt must explicitly request the 4 output fields, otherwise
    the LLM echoes back the input fields as a JSON object."""

    def test_prompt_lists_all_four_output_fields(self, sample_trope):
        prompt = MutationEngine._build_mutation_user_prompt(
            sample_trope, MutationOp.INVERSION, context=""
        )
        assert "core_premise" in prompt
        assert "core_conflict" in prompt
        assert "novelty_hook" in prompt
        assert "self_consistency_check" in prompt

    def test_prompt_includes_operation_label(self, sample_trope):
        prompt = MutationEngine._build_mutation_user_prompt(
            sample_trope, MutationOp.ESCALATION, context=""
        )
        assert "加码" in prompt

    def test_prompt_includes_context_when_provided(self, sample_trope):
        prompt = MutationEngine._build_mutation_user_prompt(
            sample_trope, MutationOp.SUBVERSION, context="主角在末世觉醒"
        )
        assert "主角在末世觉醒" in prompt

    def test_fusion_prompt_unchanged(self, sample_trope):
        """Fusion has its own prompt builder — verify it still works."""
        prompt = MutationEngine._build_fusion_user_prompt(
            sample_trope, sample_trope
        )
        assert "废柴逆袭" in prompt
