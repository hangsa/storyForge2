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


@pytest.mark.asyncio
async def test_prechecker_routes_to_llm_and_parses_suggestions():
    """When router is provided and LLM returns JSON, suggestions are parsed correctly."""
    from backend.semantic_precheck.prechecker import SemanticPrechecker

    router = MagicMock()
    router.execute = AsyncMock(return_value={
        "content": json.dumps({
            "suggestions": [
                {
                    "event_type": "twist_reveal",
                    "location_hint": "结尾",
                    "suggested_tag": "<!-- SF_LOG twist_reveal id=\"tw_99\" -->",
                    "reason": "师父身份暴露但无标记",
                }
            ]
        }, ensure_ascii=False),
        "usage": {"input": 300, "output": 80},
        "model": "claude-haiku",
    })
    prechecker = SemanticPrechecker(model_router=router)
    result = await prechecker.check(
        scene_text="林峰看着屏幕，瞳孔猛然收缩。",
        scene_plan={"required_logs": []},
        character_names=["林峰"],
    )
    assert result.precheck_passed is False
    assert len(result.suggestions) == 1
    assert result.suggestions[0].event_type == "twist_reveal"
    assert result.tokens_used == 380


@pytest.mark.asyncio
async def test_prechecker_graceful_skip_on_non_json_response():
    """Bad JSON from LLM → empty suggestions, precheck_passed=True."""
    from backend.semantic_precheck.prechecker import SemanticPrechecker

    router = MagicMock()
    router.execute = AsyncMock(return_value={
        "content": "not json at all",
        "usage": {"input": 100, "output": 50},
        "model": "claude-haiku",
    })
    prechecker = SemanticPrechecker(model_router=router)
    result = await prechecker.check(
        scene_text="text",
        scene_plan={},
        character_names=["x"],
    )
    assert result.precheck_passed is True
    assert result.suggestions == []
    assert "non-JSON" in result.skipped_reason


@pytest.mark.asyncio
async def test_prechecker_filters_out_unsanctioned_event_types():
    """Only the 3 TARGET_EVENT_TYPES are surfaced. Others are silently dropped."""
    from backend.semantic_precheck.prechecker import SemanticPrechecker

    router = MagicMock()
    router.execute = AsyncMock(return_value={
        "content": json.dumps({
            "suggestions": [
                {"event_type": "character_emotion", "reason": "should be filtered"},
                {"event_type": "knowledge_gain", "reason": "should be filtered"},
                {"event_type": "character_location_change", "reason": "should be filtered"},
                {"event_type": "twist_reveal", "reason": "kept", "location_hint": "x", "suggested_tag": "y"},
            ]
        }),
        "usage": {"input": 1, "output": 1},
        "model": "claude-haiku",
    })
    prechecker = SemanticPrechecker(model_router=router)
    result = await prechecker.check(
        scene_text="x",
        scene_plan={},
        character_names=["x"],
    )
    assert len(result.suggestions) == 1
    assert result.suggestions[0].event_type == "twist_reveal"


@pytest.mark.asyncio
async def test_prechecker_never_blocks_even_with_suggestions():
    """precheck_passed is False when suggestions exist, but downstream check_6 still passes=True."""
    from backend.semantic_precheck.prechecker import SemanticPrechecker

    router = MagicMock()
    router.execute = AsyncMock(return_value={
        "content": json.dumps({"suggestions": [
            {"event_type": "registry_create", "reason": "x", "location_hint": "y", "suggested_tag": "z"}
        ]}),
        "usage": {"input": 1, "output": 1},
        "model": "claude-haiku",
    })
    prechecker = SemanticPrechecker(model_router=router)
    result = await prechecker.check(scene_text="x", scene_plan={}, character_names=["x"])
    # precheck_passed reflects "any suggestions?" — but the check_6 handler never blocks
    assert result.precheck_passed is False
    assert len(result.suggestions) == 1
