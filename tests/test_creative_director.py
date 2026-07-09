"""Tests for Creative Director agent."""
from unittest.mock import MagicMock, AsyncMock

import pytest

from backend.agents.creative_director import CreativeDirector
from backend.models.creative_os import WhatIfNode


@pytest.fixture
def mock_router():
    router = MagicMock()
    router.execute = AsyncMock(return_value={
        "content": "建议文本",
        "usage": {"input": 300, "output": 100},
        "model": "deepseek-v4-pro",
        "tier": "tier_1",
        "cost": 0.001,
    })
    return router


@pytest.fixture
def agent(mock_router):
    return CreativeDirector("test_project", model_router=mock_router)


@pytest.fixture
def sample_node():
    return WhatIfNode(
        id="wi_001_01",
        depth=1,
        parent_id="wi_001_00",
        content="主角发现自己的功法会加速世界毁灭",
        novelty_score=72.0,
        trope_tags=["废柴逆袭", "末法时代"],
    )


class TestCreativeDirectorInit:

    def test_agent_name(self, agent):
        assert agent.agent_name == "creative_director"

    def test_inherits_base_agent(self, agent):
        from backend.agents.base_agent import BaseAgent
        assert isinstance(agent, BaseAgent)

    def test_project_id_set(self, agent):
        assert agent.project_id == "test_project"


class TestSuggestDirection:

    @pytest.mark.asyncio
    async def test_returns_string(self, agent, sample_node):
        canvas_state = {
            "total_nodes": 5,
            "depth_distribution": {0: 1, 1: 4},
            "dimensions_covered": ["世界观规则", "角色动机"],
            "dimensions_missing": ["情节方向", "读者体验"],
            "max_score": 85,
            "min_score": 60,
        }
        result = await agent.suggest_direction(sample_node, canvas_state)
        assert isinstance(result, str)
        assert len(result) > 0


class TestRecommendMutation:

    @pytest.mark.asyncio
    async def test_returns_string(self, agent, sample_node):
        result = await agent.recommend_mutation(sample_node)
        assert isinstance(result, str)
        assert len(result) > 0


class TestEvaluatePath:

    @pytest.mark.asyncio
    async def test_returns_string(self, agent, sample_node):
        path = [sample_node]
        result = await agent.evaluate_path(path)
        assert isinstance(result, str)
        assert len(result) > 0
