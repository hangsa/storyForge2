"""
Fact Guard 5 deterministic checks — unit tests.
Covers AC-3, AC-9, AC-10.
"""

import pytest
from backend.agents.reviewer import ReviewerAgent, CheckResult, FactGuardResult


@pytest.fixture
def reviewer():
    return ReviewerAgent("test_project")


@pytest.fixture
def sample_character():
    return {
        "name": "林峰",
        "current_state": {"location": "星辰宗-外门练功场"},
        "voice_signature": {"taboos": ["背叛宗门", "欺凌弱小"]},
        "unknown_to_character": ["师父的秘密身份", "上古魔器的真相"],
    }


@pytest.fixture
def sample_world_rules():
    return {
        "power_system": {
            "name": "星辰之力",
            "ceilings": ["星辰领域", "星核破碎"],
            "cost_system": "每次使用需消耗精神力",
        }
    }


@pytest.fixture
def sample_scene_plan():
    return {
        "required_logs": [
            "character_location_change",
            "conflict_escalate",
            "knowledge_gain",
        ]
    }


class TestCheck1Timeline:
    """AC-3: Timeline continuity check."""

    def test_passes_with_location_change_log(self, reviewer, sample_character):
        text = '<!-- SF_LOG character_location_change char="林峰" from="星辰宗-外门练功场" to="星辰宗-藏书阁" -->'
        result = reviewer.check_1_timeline(text, sample_character)
        assert result.passed
        assert "1 次位置变化" in result.detail

    def test_fails_duplicate_location(self, reviewer, sample_character):
        text = (
            '<!-- SF_LOG character_location_change char="林峰" from="星辰宗-外门练功场" to="星辰宗-藏书阁" -->\n'
            '<!-- SF_LOG character_location_change char="林峰" from="星辰宗-藏书阁" to="星辰宗-藏书阁" -->'
        )
        result = reviewer.check_1_timeline(text, sample_character)
        assert not result.passed
        assert "重复" in result.detail

    def test_fails_no_location_info(self, reviewer):
        character = {"name": "无名"}
        text = "这是一段没有任何位置信息的文本。"
        result = reviewer.check_1_timeline(text, character)
        assert not result.passed
        assert "未能提取到位置信息" in result.detail

    def test_passes_multiple_locations_different(self, reviewer, sample_character):
        text = (
            '<!-- SF_LOG character_location_change char="林峰" from="星辰宗-外门练功场" to="星辰宗-藏书阁" -->\n'
            '<!-- SF_LOG character_location_change char="林峰" from="星辰宗-藏书阁" to="坊市" -->'
        )
        result = reviewer.check_1_timeline(text, sample_character)
        assert result.passed


class TestCheck2CharacterState:
    """AC-3: Character state consistency check."""

    def test_passes_no_violations(self, reviewer, sample_character):
        text = "林峰在练功场修炼，突破到了新境界。"
        result = reviewer.check_2_character_state(text, sample_character)
        assert result.passed

    def test_fails_knowledge_leak(self, reviewer, sample_character):
        text = "林峰突然明白了，师父的秘密身份其实是魔教卧底。"
        result = reviewer.check_2_character_state(text, sample_character)
        assert not result.passed
        assert "师父的秘密身份" in result.detail

    def test_fails_taboo_violation(self, reviewer, sample_character):
        text = "林峰冷笑一声，毫不犹豫地背叛宗门。"
        result = reviewer.check_2_character_state(text, sample_character)
        assert not result.passed
        assert "背叛宗门" in result.detail

    def test_passes_with_empty_unknowns_and_taboos(self, reviewer):
        character = {"name": "测试角色", "unknown_to_character": [], "voice_signature": {"taboos": []}}
        text = "测试角色做了很多事情。"
        result = reviewer.check_2_character_state(text, character)
        assert result.passed

    def test_passes_with_empty_secret_strings(self, reviewer):
        character = {
            "name": "测试角色",
            "unknown_to_character": ["  ", ""],
            "voice_signature": {"taboos": ["  "]},
        }
        text = "测试角色做了很多事情。"
        result = reviewer.check_2_character_state(text, character)
        assert result.passed


class TestCheck3WorldRules:
    """AC-3: World rules compliance check."""

    def test_passes_normal_power_usage(self, reviewer):
        world = {"power_system": {"ceilings": ["星辰领域"], "cost_system": None}}
        text = "林峰释放了星辰剑气。\n<!-- SF_LOG registry_create type=\"cost\" data='{\"ability\":\"星辰剑气\"}' -->"
        result = reviewer.check_3_world_rules(text, world)
        assert result.passed

    def test_fails_ceiling_breach(self, reviewer, sample_world_rules):
        text = "林峰发动星辰领域，天地为之变色。"
        result = reviewer.check_3_world_rules(text, sample_world_rules)
        assert not result.passed
        assert "星辰领域" in result.detail

    def test_fails_no_cost_declaration(self, reviewer, sample_world_rules):
        text = "林峰释放了星辰剑气，击退了敌人。"
        result = reviewer.check_3_world_rules(text, sample_world_rules)
        assert not result.passed
        assert "代价" in result.detail

    def test_passes_with_cost_sf_log(self, reviewer, sample_world_rules):
        text = (
            "林峰释放了星辰剑气。\n"
            "<!-- SF_LOG registry_create type=\"cost\" data='{\"ability\":\"星辰剑气\"}' -->"
        )
        result = reviewer.check_3_world_rules(text, sample_world_rules)
        assert result.passed

    def test_passes_no_ceilings_configured(self, reviewer):
        world = {"power_system": {"ceilings": []}}
        text = "林峰发动了任意能力。"
        result = reviewer.check_3_world_rules(text, world)
        assert result.passed
        assert "跳过检查" in result.detail


class TestCheck4AssetCompliance:
    """AC-3: Registry asset compliance check."""

    def test_passes_no_asset_refs(self, reviewer):
        text = "普通文本，没有引用任何注册表资产。"
        result = reviewer.check_4_asset_compliance(text, {})
        assert result.passed

    def test_passes_valid_asset_refs(self, reviewer):
        text = "引用了冲突 cf_001 和线索 mys_002。"
        storyos = {
            "conflicts": {"cf_001": {"id": "cf_001", "status": "active"}},
            "mysteries": {"mys_002": {"id": "mys_002", "status": "active"}},
        }
        result = reviewer.check_4_asset_compliance(text, storyos)
        assert result.passed

    def test_fails_unknown_asset_ref(self, reviewer):
        text = "引用了不存在的资产 cf_999。"
        result = reviewer.check_4_asset_compliance(text, {})
        assert not result.passed
        assert "不存在" in result.detail

    def test_fails_resolved_asset_referenced(self, reviewer):
        text = "引用了已解决的冲突 cf_001。"
        storyos = {"conflicts": {"cf_001": {"id": "cf_001", "status": "resolved"}}}
        result = reviewer.check_4_asset_compliance(text, storyos)
        assert not result.passed
        assert "已解决" in result.detail

    def test_passes_asset_from_list_format(self, reviewer):
        text = "引用了 cf_001。"
        storyos = {"conflicts": [{"id": "cf_001", "status": "active"}]}
        result = reviewer.check_4_asset_compliance(text, storyos)
        assert result.passed


class TestCheck5LogCompleteness:
    """AC-9: Required log coverage. AC-10: Malformed SF_LOG detection."""

    def test_passes_all_required_logs_present(self, reviewer, sample_scene_plan):
        text = (
            '<!-- SF_LOG character_location_change char="a" from="x" to="y" -->\n'
            '<!-- SF_LOG conflict_escalate id="cf_001" new_intensity="high" -->\n'
            '<!-- SF_LOG knowledge_gain char="a" content="秘密" -->'
        )
        result = reviewer.check_5_log_completeness(text, sample_scene_plan)
        assert result.passed

    def test_fails_missing_required_log(self, reviewer):
        scene_plan = {"required_logs": ["conflict_escalate", "knowledge_gain"]}
        text = '<!-- SF_LOG conflict_escalate id="cf_001" new_intensity="high" -->'
        result = reviewer.check_5_log_completeness(text, scene_plan)
        assert not result.passed
        assert "knowledge_gain" in result.detail

    def test_fails_unknown_log_type(self, reviewer):
        """AC-10: Malformed SF_LOG blocked."""
        text = '<!-- SF_LOG invalid_type key="value" -->'
        result = reviewer.check_5_log_completeness(text, {})
        assert not result.passed
        assert "未知的SF_LOG类型" in result.detail

    def test_fails_empty_params(self, reviewer):
        """AC-10: Malformed SF_LOG with unquoted params."""
        text = "<!-- SF_LOG conflict_escalate id=cf_001 -->"
        result = reviewer.check_5_log_completeness(text, {})
        assert not result.passed
        assert "缺少有效" in result.detail

    def test_passes_no_required_logs(self, reviewer):
        text = "普通文本，没有任何 SF_LOG。"
        result = reviewer.check_5_log_completeness(text, {"required_logs": []})
        assert result.passed

    def test_passes_single_quoted_params(self, reviewer):
        text = "<!-- SF_LOG conflict_escalate id='cf_001' new_intensity='high' -->"
        result = reviewer.check_5_log_completeness(text, {"required_logs": ["conflict_escalate"]})
        assert result.passed


class TestCoherenceScore:
    """Coherence scoring weights: 30/30/20/10/10."""

    def test_perfect_score(self, reviewer):
        checks = [
            CheckResult(check_id=1, name="t1", passed=True),
            CheckResult(check_id=2, name="t2", passed=True),
            CheckResult(check_id=3, name="t3", passed=True),
            CheckResult(check_id=4, name="t4", passed=True),
            CheckResult(check_id=5, name="t5", passed=True),
        ]
        assert reviewer.compute_coherence_score(checks) == 100

    def test_zero_score(self, reviewer):
        checks = [
            CheckResult(check_id=1, name="t1", passed=False),
            CheckResult(check_id=2, name="t2", passed=False),
            CheckResult(check_id=3, name="t3", passed=False),
            CheckResult(check_id=4, name="t4", passed=False),
            CheckResult(check_id=5, name="t5", passed=False),
        ]
        assert reviewer.compute_coherence_score(checks) == 0

    def test_partial_score(self, reviewer):
        checks = [
            CheckResult(check_id=1, name="t1", passed=True),
            CheckResult(check_id=2, name="t2", passed=False),
            CheckResult(check_id=3, name="t3", passed=True),
            CheckResult(check_id=4, name="t4", passed=False),
            CheckResult(check_id=5, name="t5", passed=False),
        ]
        assert reviewer.compute_coherence_score(checks) == 50  # 30 + 0 + 20 + 0 + 0


class TestFactGuardIntegration:
    """Full run_fact_guard pipeline."""

    def test_all_pass(self, reviewer, sample_character, sample_world_rules, sample_scene_plan):
        text = (
            '<!-- SF_LOG character_location_change char="林峰" from="星辰宗-外门练功场" to="星辰宗-藏书阁" -->\n'
            '<!-- SF_LOG conflict_escalate id="cf_001" new_intensity="medium" -->\n'
            '<!-- SF_LOG knowledge_gain char="林峰" content="古籍内容" -->'
        )
        storyos_state = {"conflicts": {"cf_001": {"id": "cf_001", "status": "active"}}}
        result = reviewer.run_fact_guard(text, [sample_character], sample_world_rules, sample_scene_plan, storyos_state)
        assert result.all_passed
        assert result.coherence_score == 100

    def test_some_fail(self, reviewer, sample_character, sample_world_rules, sample_scene_plan):
        text = "林峰知道了师父的秘密身份，然后背叛了宗门。"
        result = reviewer.run_fact_guard(text, [sample_character], sample_world_rules, sample_scene_plan)
        assert not result.all_passed
        assert result.retry_hints != ""
        assert "请修复以下问题后重写" in result.retry_hints
