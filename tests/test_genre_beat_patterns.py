"""Tests for genre beat pattern injection into Stage 3 outline prompts.

Pattern: config/genre_focus_vocabulary.yaml -> planner._resolve_genre_focus_vocabulary
       : catalog.<filename> -> planner._resolve_genre_beat_patterns -> prompt placeholders
       : {genre_beat_patterns}, {genre_focus_vocabulary}
"""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest


class TestFocusVocabulary:
    def test_returns_legend_with_all_six_focus_words_and_header(self):
        """_resolve_genre_focus_vocabulary returns the full legend, prefixed by
        the 【focus 字段图例】 header. All 6 focus words must appear in the output."""
        from backend.agents.planner import _resolve_genre_focus_vocabulary

        result = _resolve_genre_focus_vocabulary()

        assert "【focus 字段图例】" in result
        for word in ("sensory", "action", "dialogue", "emotion", "suspense", "reveal"):
            assert word in result


class TestSchemaValidation:
    """Catalog must reject malformed beat_patterns at load time."""

    def _write_genre_yaml(self, tmp_path, genre_id, beat_patterns_block):
        """Helper: write a minimal valid genre YAML into tmp_path."""
        import yaml
        (tmp_path / "index.yaml").write_text(
            yaml.safe_dump({"genres": [{"id": genre_id, "label_zh": "测试", "label_en": "Test", "family": "test"}]}, allow_unicode=True),
            encoding="utf-8",
        )
        (tmp_path / "compatibility.yaml").write_text(
            yaml.safe_dump({"matrix": {genre_id: {}}}, allow_unicode=True),
            encoding="utf-8",
        )
        (tmp_path / "families.yaml").write_text(
            yaml.safe_dump({"families": {"test": [genre_id]}}, allow_unicode=True),
            encoding="utf-8",
        )
        # All required fields EXCEPT beat_patterns — we'll inject beat_patterns separately.
        valid_entry = {
            "id": genre_id, "label_zh": "测试", "label_en": "Test", "family": "test",
            "pacing": {"min_beats_per_1k": 1.0, "escalation_interval": 5, "action_ratio": 0.3,
                       "max_consecutive_non_action": 3, "chapter_words": {"min": 2000, "max": 5000},
                       "scene_words": {"min": 400, "max": 1800}},
            "tone": "测试",
            "style_rules": ["rule1"],
            "writing_formula": {"sentence": {}, "dialogue": {}, "paragraph": {}},
            "taboo_words": [],
            "taboos": [],
            "trope_patterns": [],
            "thresholds": {},
            "model_preferences": {"creative_core": "deepseek-chat", "temperature": 0.8},
            "fusion_meta": {"distances": {}},  # Will fail distance validation, but beat_patterns is checked first
        }
        valid_entry["beat_patterns"] = beat_patterns_block
        (tmp_path / f"{genre_id}.yaml").write_text(
            yaml.safe_dump(valid_entry, allow_unicode=True),
            encoding="utf-8",
        )

    def test_all_7_genres_have_beat_patterns_field(self):
        """The production catalog loads with all 7 genres declaring beat_patterns."""
        from backend.genres.catalog import get_catalog
        catalog = get_catalog()
        for gid in ("cool_novel", "xianxia", "xuanhuan", "dushi", "kehuan", "xuanyi", "yanqing"):
            entry = catalog.get(gid)
            assert "beat_patterns" in entry, f"{gid} missing beat_patterns"
            assert isinstance(entry["beat_patterns"], list)
            assert len(entry["beat_patterns"]) >= 1

    def test_beat_pattern_with_empty_keywords_raises_on_load(self, tmp_path):
        """A beat_pattern with keywords=[] is invalid."""
        from backend.genres.catalog import GenreCatalog, CatalogLoadError
        self._write_genre_yaml(tmp_path, "test_genre", [
            {"keywords": [], "priority": 80, "beats": [{"description": "x", "words": 100, "focus": "sensory"}]}
        ])
        with pytest.raises(CatalogLoadError, match="beat_patterns invalid"):
            GenreCatalog(genres_dir=tmp_path).get("test_genre")

    def test_beat_with_unknown_focus_raises_on_load(self, tmp_path):
        """A beat with focus='random_word' (not in vocabulary) is invalid."""
        from backend.genres.catalog import GenreCatalog, CatalogLoadError
        self._write_genre_yaml(tmp_path, "test_genre", [
            {"keywords": ["测试"], "priority": 80, "beats": [{"description": "x", "words": 100, "focus": "random_word"}]}
        ])
        with pytest.raises(CatalogLoadError, match="beat_patterns invalid"):
            GenreCatalog(genres_dir=tmp_path).get("test_genre")

    def test_beat_with_single_char_keyword_raises_on_load(self, tmp_path):
        """A keyword of length 1 (e.g., '脸') is too noisy — min 2 chars required."""
        from backend.genres.catalog import GenreCatalog, CatalogLoadError
        self._write_genre_yaml(tmp_path, "test_genre", [
            {"keywords": ["脸"], "priority": 80, "beats": [{"description": "x", "words": 100, "focus": "sensory"}]}
        ])
        with pytest.raises(CatalogLoadError, match="beat_patterns invalid"):
            GenreCatalog(genres_dir=tmp_path).get("test_genre")


class TestKeywordMatching:
    """_resolve_genre_beat_patterns filters templates by outline keywords."""

    def test_substring_match_returns_matching_template_only(self):
        """outline_text='主角打脸反派' → only the 打脸 template appears."""
        from backend.agents.planner import _resolve_genre_beat_patterns
        result = _resolve_genre_beat_patterns("cool_novel", "主角打脸反派")
        assert "【题材节拍模板】" in result
        assert "打脸" in result
        # The cool_novel 突破 template should NOT appear (no 突破 keyword in outline)
        assert "升级契机" not in result

    def test_multiple_keyword_match_sorts_by_priority_desc(self):
        """outline containing both '打脸' and '突破' keywords → 2 templates, priority desc."""
        from backend.agents.planner import _resolve_genre_beat_patterns
        result = _resolve_genre_beat_patterns("cool_novel", "打脸突破升级")
        # 打脸 is priority 90, 突破 is priority 70; 打脸 should appear first
        idx_face = result.find("打脸")
        idx_break = result.find("升级契机")
        assert idx_face != -1 and idx_break != -1
        assert idx_face < idx_break

    def test_empty_outline_returns_all_templates_unfiltered(self):
        """outline_text='' → all templates returned, sorted by priority desc."""
        from backend.agents.planner import _resolve_genre_beat_patterns
        result = _resolve_genre_beat_patterns("cool_novel", "")
        # cool_novel has 4 templates; all keywords should appear
        assert "打脸" in result
        assert "越级" in result
        assert "突破" in result
        assert "身份" in result

    def test_no_keyword_match_returns_empty_string(self):
        """outline_text with no matching keywords → empty string (no section header)."""
        from backend.agents.planner import _resolve_genre_beat_patterns
        # '天气预报' has no overlap with cool_novel's keywords
        result = _resolve_genre_beat_patterns("cool_novel", "今天的天气预报说明天有雨")
        assert result == ""
        assert "【题材节拍模板】" not in result


class TestPromptWiring:
    """Verify beat_patterns + focus_vocabulary reach the outline prompt."""

    @pytest.mark.asyncio
    async def test_novel_outline_prompt_contains_beat_patterns_section(self):
        """generate_novel_outline with outline_text='打脸' → prompt contains the section."""
        from backend.agents.planner import PlannerAgent

        captured = {}

        async def fake_tier(self, task_name, system_prompt, user_prompt, **kwargs):
            captured["user"] = user_prompt
            return {"volumes": []}, _mock_response()

        planner = PlannerAgent(project_id="test")
        with patch.object(PlannerAgent, "generate_with_tier", new=fake_tier):
            await planner.generate_novel_outline(
                concept={"title": "测试", "premise": "x", "tone": "x", "theme": "x"},
                story_dna={"core_contradiction": {"statement": "x"}},
                world={"era": "x", "power_system": {"name": "x", "core_rules": []}, "core_rules": []},
                characters=[],
                target_total_words=1_000_000,
                min_words=2000,
                outline_text="主角在擂台上打脸反派，震惊全场",
            )

        rendered = captured["user"]
        assert "【题材节拍模板】" in rendered
        assert "打脸" in rendered
        assert "【focus 字段图例】" in rendered
        assert "sensory" in rendered

    @pytest.mark.asyncio
    async def test_novel_outline_prompt_omits_beat_section_when_no_match(self):
        """generate_novel_outline with no-keyword outline → no beat section, but vocab still appears."""
        from backend.agents.planner import PlannerAgent

        captured = {}

        async def fake_tier(self, task_name, system_prompt, user_prompt, **kwargs):
            captured["user"] = user_prompt
            return {"volumes": []}, _mock_response()

        planner = PlannerAgent(project_id="test")
        with patch.object(PlannerAgent, "generate_with_tier", new=fake_tier):
            await planner.generate_novel_outline(
                concept={"title": "测试", "premise": "x", "tone": "x", "theme": "x"},
                story_dna={"core_contradiction": {"statement": "x"}},
                world={"era": "x", "power_system": {"name": "x", "core_rules": []}, "core_rules": []},
                characters=[],
                target_total_words=1_000_000,
                min_words=2000,
                outline_text="今天的天气预报说明天有雨",  # no matching keywords
            )

        rendered = captured["user"]
        assert "【题材节拍模板】" not in rendered  # section disappears entirely
        assert "【focus 字段图例】" in rendered  # vocab always present


def _mock_response():
    """Real LLMResponse dataclass — log_usage JSON-serializes its fields."""
    from backend.llm.base_provider import LLMResponse
    return LLMResponse(
        text="", tokens_in=0, tokens_out=0,
        model="test", provider="test", finish_reason="stop",
    )
