"""Tests for CharacterDesigner agent (Growth Workshop discuss)."""
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.agents.character_designer import CharacterDesigner


@pytest.mark.asyncio
async def test_discuss_returns_answer_on_success():
    fake_router = MagicMock()
    fake_router.execute = AsyncMock(return_value={
        "content": "节奏过快，建议 Ch5→Ch12 拉长",
        "usage": {"input": 200, "output": 80},
        "model": "deepseek-v4-pro",
        "tier": "tier_1",
        "cost": 0.01,
    })
    agent = CharacterDesigner(project_id="p1", model_router=fake_router)
    out = await agent.discuss(
        character={"id": "c1", "name": "林峰", "growth_curve": {"stages": []}},
        outline={"chapters": []},
        question="节奏是否合适？",
    )
    assert out.answer.startswith("节奏过快")
    assert fake_router.execute.await_count == 1
    call = fake_router.execute.await_args
    assert call.kwargs["agent_name"] == "character_designer"
    assert call.kwargs["task_name"] == "growth_discuss"


@pytest.mark.asyncio
async def test_discuss_returns_skipped_reason_when_router_unavailable():
    fake_router = MagicMock()
    fake_router.execute = AsyncMock(side_effect=Exception("router offline"))
    agent = CharacterDesigner(project_id="p1", model_router=fake_router)
    out = await agent.discuss(
        character={"id": "c1", "name": "林峰", "growth_curve": {"stages": []}},
        outline={"chapters": []},
        question="节奏？",
    )
    assert out.skipped_reason
    assert out.answer == ""
