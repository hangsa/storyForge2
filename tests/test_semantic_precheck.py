"""Tests for semantic_precheck.prechecker — Tier 3 SF_LOG miss detector."""
import json
from unittest.mock import AsyncMock, MagicMock

import pytest


@pytest.mark.asyncio
async def test_prechecker_with_no_router_returns_passed_empty_suggestions():
    """When no model_router is supplied, prechecker must return precheck_passed=True with empty suggestions (graceful skip)."""
    from backend.semantic_precheck.prechecker import SemanticPrechecker

    prechecker = SemanticPrechecker(model_router=None)
    result = await prechecker.check(
        scene_text="林峰走进了实验室。",
        scene_plan={"required_logs": []},
        character_names=["林峰"],
    )
    assert result.precheck_passed is True
    assert result.suggestions == []
    assert result.tokens_used == 0
