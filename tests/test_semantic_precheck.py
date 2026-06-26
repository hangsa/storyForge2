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


def test_reviewer_run_fact_guard_accepts_precheck_result_parameter():
    """run_fact_guard must accept precheck_result and pass it to check_6."""
    from backend.agents.reviewer import ReviewerAgent
    from backend.semantic_precheck.prechecker import PrecheckResult, PrecheckSuggestion

    pre = PrecheckResult(
        precheck_passed=False,
        suggestions=[PrecheckSuggestion(
            event_type="twist_reveal",
            location_hint="第三章末尾",
            suggested_tag='<!-- SF_LOG twist_reveal id="tw_001" -->',
            reason="林峰发现师父是幕后黑手，但无对应标记",
        )],
        tokens_used=200,
    )

    agent = ReviewerAgent.__new__(ReviewerAgent)  # bypass __init__
    result = agent.run_fact_guard(
        draft_text="林峰在实验室里翻找文件时，意外发现师父的通讯记录...",
        characters=[],
        world_rules={},
        scene_plan={"required_logs": []},
        precheck_result=pre,
    )
    checks = {c.name: c for c in result.checks}
    assert "语义预检结果复核" in checks
    sem = checks["语义预检结果复核"]
    assert sem.passed is True  # never blocks
    assert "1 项" in sem.detail or "未通过" in sem.detail


@pytest.mark.asyncio
async def test_run_semantic_precheck_helper_returns_passed_when_no_router(monkeypatch):
    """Module-level helper degrades to passed=True when no router is available."""
    from backend.api import stage4_writing
    from backend.semantic_precheck.prechecker import PrecheckResult

    # Force get_model_router to return None
    monkeypatch.setattr(
        "backend.llm.model_router.get_model_router",
        lambda: None,
    )

    result = await stage4_writing._run_semantic_precheck(
        scene_text="test",
        scene_plan={},
        character_names=["x"],
    )
    assert result.precheck_passed is True
    assert "no router" in result.skipped_reason
