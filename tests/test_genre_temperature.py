"""Tests for BaseAgent._resolve_temperature + genre-aware temperature routing."""
from __future__ import annotations

from typing import Optional
from unittest.mock import MagicMock

import pytest


def _make_agent(agent_name: str, genre: str = "cool_novel", tier_map: Optional[dict] = None):
    """Build a BaseAgent-like object for unit tests of _resolve_temperature."""
    from backend.agents.base_agent import BaseAgent

    agent = BaseAgent.__new__(BaseAgent)
    agent.agent_name = agent_name
    agent.genre = genre
    # Stub router._mappings so _is_tier_1_agent has something to inspect
    mock_router = MagicMock()
    mock_router._mappings = {agent_name: tier_map or {}}
    agent._router = mock_router
    return agent


def _prompt(temp=None) -> MagicMock:
    p = MagicMock()
    p.temperature = temp
    return p


class TestTierFiltering:
    def test_tier_1_agent_returns_true(self):
        # planner is all tier_1 per config/model_tiers.yaml
        agent = _make_agent("planner", tier_map={
            "concept_generation": MagicMock(tier_name="tier_1"),
            "outline_generation": MagicMock(tier_name="tier_1"),
        })
        assert agent._is_tier_1_agent() is True

    def test_tier_2_agent_returns_false(self):
        agent = _make_agent("reviewer", tier_map={
            "fact_guard": MagicMock(tier_name="tier_0"),
        })
        assert agent._is_tier_1_agent() is False

    def test_unknown_agent_returns_false(self):
        agent = _make_agent("nonexistent_agent", tier_map={})
        assert agent._is_tier_1_agent() is False
