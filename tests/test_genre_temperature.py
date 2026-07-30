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


class TestGenreTemperatureResolution:
    def test_genre_temperature_used_when_prompt_has_no_temperature(self):
        agent = _make_agent("planner", genre="xianxia", tier_map={
            "outline_generation": MagicMock(tier_name="tier_1"),
        })
        prompt = _prompt(temp=None)
        assert agent._resolve_temperature(prompt, None) == 0.85  # xianxia

    def test_prompt_temperature_overrides_genre(self):
        agent = _make_agent("planner", genre="xianxia", tier_map={
            "outline_generation": MagicMock(tier_name="tier_1"),
        })
        prompt = _prompt(temp=0.7)
        assert agent._resolve_temperature(prompt, None) == 0.7

    def test_sandbox_temperature_overrides_prompt_and_genre(self):
        from backend.style_engine.sandbox_models import SandboxParams
        agent = _make_agent("writer", genre="xianxia", tier_map={
            "scene_writing": MagicMock(tier_name="tier_1"),
        })
        sandbox = SandboxParams(temperature=0.5, action_ratio=0.4)
        prompt = _prompt(temp=0.7)
        assert agent._resolve_temperature(prompt, sandbox) == 0.5

    def test_fallback_to_settings_when_all_unset(self):
        agent = _make_agent("planner", genre="__unset__", tier_map={
            "outline_generation": MagicMock(tier_name="tier_1"),
        })
        prompt = _prompt(temp=None)
        result = agent._resolve_temperature(prompt, None)
        # __unset__ is unknown genre; catalog falls back to first index entry
        # (cool_novel, model_preferences.temperature=0.9). Verify catalog-fallback path.
        assert result == 0.9

    def test_invalid_genre_falls_back_silently(self):
        agent = _make_agent("planner", genre="__totally_unknown_genre__", tier_map={
            "outline_generation": MagicMock(tier_name="tier_1"),
        })
        prompt = _prompt(temp=None)
        result = agent._resolve_temperature(prompt, None)
        assert isinstance(result, float)
        assert 0.0 <= result <= 2.0
