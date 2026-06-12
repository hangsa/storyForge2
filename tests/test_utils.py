"""
Unit tests for token_counter.py and regex_patterns.py utilities.
"""
import re
import pytest

from backend.utils.token_counter import count_tokens, count_tokens_approx, estimate_cost
from backend.utils import regex_patterns as rp


# ── Token Counter ──────────────────────────────────────────────────────


class TestTokenCounter:
    def test_count_tokens_english(self):
        n = count_tokens("Hello world", model="gpt-4")
        assert n > 0

    def test_count_tokens_chinese(self):
        n = count_tokens("林峰站在废墟上", model="gpt-4")
        assert n > 0

    def test_count_tokens_empty(self):
        n = count_tokens("", model="gpt-4")
        assert n == 0

    def test_count_tokens_unknown_model_fallback(self):
        """Unknown model falls back to cl100k_base."""
        n = count_tokens("Hello world", model="unknown-model-xyz")
        assert n > 0

    def test_count_tokens_approx_chinese(self):
        n = count_tokens_approx("林峰站在废墟上冷风吹过")
        assert n == len("林峰站在废墟上冷风吹过") // 2

    def test_count_tokens_approx_short(self):
        assert count_tokens_approx("ab") == 1


class TestCostEstimation:
    def test_deepseek_cost(self):
        cost = estimate_cost(1000, 500, "deepseek", "deepseek-chat")
        assert cost is not None
        assert cost > 0

    def test_anthropic_cost(self):
        cost = estimate_cost(1000, 500, "anthropic", "claude-sonnet-4-20250514")
        assert cost is not None
        assert cost > 0

    def test_unknown_provider_cost_zero(self):
        cost = estimate_cost(1000, 500, "unknown", "unknown-model")
        assert cost == 0.0

    def test_zero_tokens_cost(self):
        cost = estimate_cost(0, 0, "deepseek", "deepseek-chat")
        assert cost == 0.0


# ── Regex Patterns ─────────────────────────────────────────────────────


class TestSFLogPatterns:
    def test_sf_log_pattern_match(self):
        matches = rp.SF_LOG_PATTERN.findall(
            '<!-- SF_LOG character_emotion char="林峰" emotion="愤怒" -->'
        )
        assert len(matches) == 1
        assert matches[0][0] == "character_emotion"

    def test_sf_log_pattern_multi_line(self):
        matches = rp.SF_LOG_PATTERN.findall(
            '<!-- SF_LOG registry_create type="conflict"\n'
            '  data=\'{"key":"value"}\' -->'
        )
        assert len(matches) == 1
        assert matches[0][0] == "registry_create"

    def test_sf_log_pattern_no_match_plain_comment(self):
        matches = rp.SF_LOG_PATTERN.findall("<!-- regular comment -->")
        assert len(matches) == 0

    def test_param_pattern_single(self):
        params = rp.PARAM_PATTERN.findall('char="林峰" emotion="愤怒"')
        assert len(params) == 2

    def test_param_pattern_single_quotes(self):
        params = rp.PARAM_PATTERN.findall("char='林峰' from='未知'")
        assert len(params) == 2

    def test_format_check_valid(self):
        assert rp.FORMAT_CHECK_PATTERN.match(
            '<!-- SF_LOG character_emotion char="林峰" emotion="愤怒" -->'
        )

    def test_format_check_invalid_no_type(self):
        assert not rp.FORMAT_CHECK_PATTERN.match(
            "<!-- SF_LOG  -->"
        )


class TestFactGuardPatterns:
    def test_location_change_pattern(self):
        match = rp.LOCATION_CHANGE_PATTERN.search(
            '<!-- SF_LOG character_location_change char="林峰" from="废墟" to="工厂" -->'
        )
        assert match
        assert match.group(1) == "林峰"
        assert match.group(2) == "废墟"
        assert match.group(3) == "工厂"

    def test_location_mention_pattern(self):
        matches = rp.LOCATION_MENTION_PATTERN.findall("林峰站在废墟上")
        assert len(matches) > 0

    def test_power_usage_pattern(self):
        match = rp.POWER_USAGE_PATTERN.search("林峰发动了焚天诀")
        assert match

    def test_cost_declaration_pattern(self):
        match = rp.COST_DECLARATION_PATTERN.search(
            "<!-- SF_LOG registry_create type=\"cost\" data='{\"amount\":\"50\"}' -->"
        )
        assert match
        assert "amount" in match.group(1)

    def test_asset_ref_pattern(self):
        refs = rp.ASSET_REF_PATTERN.findall("cf_001 and mys_002 and tw_003 and goal_004")
        assert len(refs) == 4


class TestValidLogTypes:
    def test_has_11_types(self):
        assert len(rp.VALID_LOG_TYPES) == 11

    def test_includes_new_v15_types(self):
        assert "expectation_fulfill" in rp.VALID_LOG_TYPES
        assert "character_physical_change" in rp.VALID_LOG_TYPES

    def test_includes_all_core_types(self):
        core = [
            "character_emotion", "character_relation_change",
            "character_location_change", "knowledge_gain",
            "conflict_escalate", "mystery_clue", "twist_reveal",
            "goal_milestone", "registry_create",
        ]
        for t in core:
            assert t in rp.VALID_LOG_TYPES
