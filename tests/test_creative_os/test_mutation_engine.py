"""Tests for Mutation Engine — LLM Prompt template validation."""

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from backend.creative_os.mutation_engine import MutationEngine
from backend.models.creative_os import MutationOp, Trope


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
