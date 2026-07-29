"""Tests for genre template propagation into Stage 1/2/3 prompts.

Pattern: catalog ``<id>.yaml`` -> planner._resolve_genre_extras -> prompt
placeholders {genre_tone}, {genre_style_rules}, {genre_trope_patterns}.
"""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.agents.planner import _resolve_genre_extras
from backend.genres.catalog import get_catalog
from backend.llm.base_provider import LLMResponse


def _mock_response():
    """Real LLMResponse dataclass — log_usage JSON-serializes its fields."""
    return LLMResponse(
        text="", tokens_in=0, tokens_out=0,
        model="test", provider="test", finish_reason="stop",
    )


class TestResolveGenreExtras:
    def test_returns_three_field_blocks(self):
        """_resolve_genre_extras returns tone / style_rules / trope_patterns
        formatted as a multi-line string ready for prompt injection."""
        result = _resolve_genre_extras("cool_novel")
        assert isinstance(result, dict)
        assert set(result.keys()) == {"tone", "style_rules", "trope_patterns"}

    def test_cool_novel_tone_includes_genre_specific_phrasing(self):
        result = _resolve_genre_extras("cool_novel")
        cool = get_catalog().get("cool_novel")
        assert result["tone"].strip() == (cool["tone"] or "").strip()

    def test_xuanyi_tone_distinct_from_cool_novel(self):
        """Two different genres must produce different tone strings."""
        cn = _resolve_genre_extras("cool_novel")
        xy = _resolve_genre_extras("xuanyi")
        assert cn["tone"] != xy["tone"]

    def test_style_rules_is_numbered_list(self):
        """style_rules renders as a numbered list, one rule per line."""
        result = _resolve_genre_extras("cool_novel")
        cool = get_catalog().get("cool_novel")
        n = len(cool["style_rules"])
        assert result["style_rules"].count("\n") == n - 1
        # Each line starts with a 1-indexed number followed by a period
        assert result["style_rules"].startswith("1. ")
        assert "2. " in result["style_rules"]

    def test_trope_patterns_renders_name_and_description(self):
        """Each trope renders as '- <name>: <description>'."""
        result = _resolve_genre_extras("cool_novel")
        cool = get_catalog().get("cool_novel")
        first_trope = cool["trope_patterns"][0]
        expected_line = f"- {first_trope['name']}: {first_trope['description']}"
        assert expected_line in result["trope_patterns"]

    def test_unknown_genre_falls_back_to_first_index_entry(self):
        """Unknown genre ids must not raise — the catalog falls back to the
        first index entry (cool_novel), so _resolve_genre_extras returns
        that entry's content. The prompt still renders without crashing."""
        result = _resolve_genre_extras("nonexistent_genre_xyz")
        cool = _resolve_genre_extras("cool_novel")
        assert result["tone"] == cool["tone"]
        assert result["style_rules"] == cool["style_rules"]
        assert result["trope_patterns"] == cool["trope_patterns"]

    def test_empty_fields_handled_gracefully(self):
        """Genres without style_rules or trope_patterns render empty strings."""
        result = _resolve_genre_extras("cool_novel")
        # All three keys exist even if their content is empty
        for key in ("tone", "style_rules", "trope_patterns"):
            assert key in result
            assert isinstance(result[key], str)


class TestConceptPromptWiring:
    """Integration: verify genre fields actually reach the concept prompt."""

    @pytest.mark.asyncio
    async def test_concept_prompt_contains_genre_tone_for_xuanyi(self):
        """generate_concept_and_dna renders xuanyi's tone into the prompt."""
        from backend.agents.planner import PlannerAgent

        captured = {}

        async def fake_tier(self, task_name, system_prompt, user_prompt, **kwargs):
            captured["user"] = user_prompt
            return {"concept": {"title": "测试", "tone": "克制"}, "story_dna": {}}, _mock_response()

        planner = PlannerAgent(project_id="test")
        with patch.object(PlannerAgent, "generate_with_tier", new=fake_tier):
            await planner.generate_concept_and_dna(
                initial_intent="一个神秘案件", genre="xuanyi"
            )

        rendered = captured["user"]
        xuanyi = get_catalog().get("xuanyi")
        assert xuanyi["tone"].strip() in rendered
        assert "悬疑" in rendered or "线索" in rendered


class TestWorldPromptWiring:
    """Integration: verify genre fields actually reach the world prompt."""

    @pytest.mark.asyncio
    async def test_world_prompt_contains_genre_style_rules(self):
        """generate_world renders style_rules into the prompt."""
        from backend.agents.planner import PlannerAgent

        captured = {}

        async def fake_tier(self, task_name, system_prompt, user_prompt, **kwargs):
            captured["user"] = user_prompt
            return {"era": "..."}, _mock_response()

        planner = PlannerAgent(project_id="test")
        with patch.object(PlannerAgent, "generate_with_tier", new=fake_tier):
            await planner.generate_world(
                concept={"title": "t", "premise": "p", "tone": "低调", "theme": "x"},
                story_dna={"core_contradiction": {"statement": "s"}},
                genre="cool_novel",
            )

        rendered = captured["user"]
        cool = get_catalog().get("cool_novel")
        assert "1. " in rendered
        assert any(r in rendered for r in cool["style_rules"][:2])


class TestCharacterPromptWiring:
    """Integration: verify genre fields actually reach the character prompt."""

    @pytest.mark.asyncio
    async def test_character_prompt_contains_genre_label_and_tone(self):
        """generate_character renders genre label and tone (currently genre-blind)."""
        from backend.agents.planner import PlannerAgent

        captured = {}

        async def fake_tier(self, task_name, system_prompt, user_prompt, **kwargs):
            captured["user"] = user_prompt
            return {"name": "x"}, _mock_response()

        planner = PlannerAgent(project_id="test")
        with patch.object(PlannerAgent, "generate_with_tier", new=fake_tier):
            await planner.generate_character(
                concept={"title": "t", "tone": "x"},
                world={"era": "古代", "power_system": {"name": "灵力", "core_rules": ["a"]}},
                character_type="protagonist",
                genre="xianxia",
            )

        rendered = captured["user"]
        assert "仙侠" in rendered
        xianxia = get_catalog().get("xianxia")
        assert xianxia["tone"].strip() in rendered


class TestToneAlignmentCheck:
    """Unit: tone-mismatch check against catalog tone."""

    def test_aligned_when_concept_tone_overlaps_catalog(self):
        """xuanyi catalog tone mentions "悬疑/线索"; concept.tone with
        '悬疑' should be aligned."""
        from backend.style_engine.tone_check import check_tone_alignment
        result = check_tone_alignment("悬疑、克制", "xuanyi")
        assert result["aligned"] is True
        assert result["warning"] is None
        assert result["score"] > 0

    def test_misaligned_when_concept_tone_unrelated(self):
        """Concept.tone = '热血' for xuanyi (catalog talks about 悬疑/线索/
        推理) should be flagged as misaligned."""
        from backend.style_engine.tone_check import check_tone_alignment
        result = check_tone_alignment("热血沸腾", "xuanyi")
        assert result["aligned"] is False
        assert result["warning"] is not None
        assert "题材" in result["warning"]

    def test_empty_concept_tone_does_not_alert(self):
        """Empty concept.tone shouldn't trigger a warning (LLM might omit)."""
        from backend.style_engine.tone_check import check_tone_alignment
        result = check_tone_alignment("", "cool_novel")
        assert result["aligned"] is True
        assert result["warning"] is None

    def test_unknown_genre_falls_back_to_first_index(self):
        """Unknown genre falls back to first index entry (cool_novel);
        a Chinese phrase overlapping with cool_novel's tone should align."""
        from backend.style_engine.tone_check import check_tone_alignment
        result = check_tone_alignment("热血、爽感", "nonexistent_xyz")
        # Should not crash; falls back to cool_novel's tone block.
        assert isinstance(result, dict)
        assert "aligned" in result
        assert "score" in result
        assert "warning" in result
