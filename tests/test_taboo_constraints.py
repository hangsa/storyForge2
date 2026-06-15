"""Tests for TabooConstraintChecker (Phase 4b)."""
import pytest
from backend.style_engine.taboo_constraints import (
    TabooViolation,
    TabooConstraintChecker,
)


class TestLayer1GlobalTaboos:
    @pytest.fixture
    def checker(self):
        return TabooConstraintChecker()

    def test_metaref_author_said(self, checker):
        violations = checker._check_global_taboos(
            "主角看着远方，作者说这段剧情太精彩了。"
        )
        assert any(v.pattern_name == "全局-元引用" for v in violations)
        assert all(v.layer == "global" for v in violations)
        assert all(v.severity == "error" for v in violations)

    def test_metaref_end_of_chapter(self, checker):
        violations = checker._check_global_taboos(
            "战斗结束，本章完。"
        )
        assert any(v.pattern_name == "全局-元引用" for v in violations)

    def test_metaref_aside(self, checker):
        violations = checker._check_global_taboos(
            "暂且不提这边的情况，看看另一边的战场。"
        )
        assert any(v.pattern_name == "全局-元引用" for v in violations)
        assert all(v.severity == "warning" for v in violations if v.pattern_name == "全局-元引用")

    def test_real_brand_china(self, checker):
        violations = checker._check_global_taboos(
            "他掏出手机，打开支付宝扫码支付。"
        )
        assert any(v.pattern_name == "全局-真实品牌" for v in violations)
        assert all(v.severity == "error" for v in violations)

    def test_real_brand_platform(self, checker):
        violations = checker._check_global_taboos(
            "这情节比起点的小说还精彩。"
        )
        assert any(v.pattern_name == "全局-真实平台" for v in violations)

    def test_no_violations_clean_text(self, checker):
        violations = checker._check_global_taboos(
            "主角深吸一口气，缓缓推开石门。门后是一条幽深的甬道。"
        )
        assert len(violations) == 0

    def test_violation_fields_populated(self, checker):
        violations = checker._check_global_taboos(
            "作者说这段很有意思。"
        )
        for v in violations:
            assert isinstance(v.pattern_name, str) and len(v.pattern_name) > 0
            assert v.layer == "global"
            assert v.severity in ("error", "warning")
            assert len(v.matched_text) > 0
            assert len(v.context) > 0

    def test_multiple_global_violations(self, checker):
        text = "作者说得对，他用微信付了钱，心想这情节够好看的。"
        violations = checker._check_global_taboos(text)
        assert len(violations) >= 2


class TestLayer2GenreTaboos:
    @pytest.fixture
    def checker(self):
        return TabooConstraintChecker()

    @pytest.fixture
    def genre_taboos(self):
        return [
            {
                "name": "虐主",
                "type": "sliding_window",
                "keywords": ["受伤", "吐血", "被击飞", "惨叫", "虐待", "折磨", "碾压", "断臂"],
                "max_chars": 300,
                "severity": "error",
            },
            {
                "name": "连续失败",
                "type": "consecutive_match",
                "failure_keywords": ["失败", "输了", "不敌", "落败", "被击败", "无力", "败退"],
                "max_consecutive": 2,
                "severity": "error",
            },
            {
                "name": "禁用语",
                "type": "keyword",
                "words": ["无能为力", "绝望", "放弃", "认命", "恐怖如斯", "倒吸一口凉气", "此子不可留"],
                "severity": "warning",
            },
        ]

    # --- keyword type ---

    def test_keyword_type_flat_match(self, checker, genre_taboos):
        keyword_taboo = [t for t in genre_taboos if t["name"] == "禁用语"]
        violations = checker._check_genre_taboos(
            "主角感到绝望，但这不能让他放弃。", keyword_taboo
        )
        assert any(v.pattern_name == "禁用语" for v in violations)
        assert all(v.severity == "warning" for v in violations if v.pattern_name == "禁用语")
        assert all(v.layer == "genre" for v in violations)

    def test_keyword_type_no_match(self, checker, genre_taboos):
        keyword_taboo = [t for t in genre_taboos if t["name"] == "禁用语"]
        violations = checker._check_genre_taboos(
            "主角充满希望，勇往直前。", keyword_taboo
        )
        assert len(violations) == 0

    # --- sliding_window type ---

    def test_sliding_window_below_threshold(self, checker, genre_taboos):
        sliding_taboo = [t for t in genre_taboos if t["name"] == "虐主"]
        # 2 keywords in 300 chars → below threshold of 3
        text = "主角受伤了，" + "正文填充" * 10 + "但没有惨叫。"
        violations = checker._check_genre_taboos(text, sliding_taboo)
        assert len(violations) == 0

    def test_sliding_window_above_threshold(self, checker, genre_taboos):
        sliding_taboo = [t for t in genre_taboos if t["name"] == "虐主"]
        # 4 keywords in close proximity (< 300 chars)
        text = "主角受伤了，被人虐待，他吐血惨叫，遭到碾压。"
        violations = checker._check_genre_taboos(text, sliding_taboo)
        assert any(v.pattern_name == "虐主" for v in violations)
        assert all(v.severity == "error" for v in violations)

    def test_sliding_window_dedup_overlapping(self, checker, genre_taboos):
        """Multiple overlapping windows hitting same cluster → only 1 violation."""
        sliding_taboo = [t for t in genre_taboos if t["name"] == "虐主"]
        filler = "正文填充" * 15  # ~60 chars
        text = "主角受伤吐血惨叫" + filler + "遭到虐待碾压" + filler
        violations = checker._check_genre_taboos(text, sliding_taboo)
        count = sum(1 for v in violations if v.pattern_name == "虐主")
        assert count == 1, f"Expected 1 violation, got {count}"

    # --- consecutive_match type ---

    def test_consecutive_match_below_threshold(self, checker, genre_taboos):
        consecutive_taboo = [t for t in genre_taboos if t["name"] == "连续失败"]
        text = "主角失败了。\n\n但是他没有放弃。\n\n继续战斗。"
        violations = checker._check_genre_taboos(text, consecutive_taboo)
        assert len(violations) == 0

    def test_consecutive_match_above_threshold(self, checker, genre_taboos):
        consecutive_taboo = [t for t in genre_taboos if t["name"] == "连续失败"]
        text = "第一战输了。\n\n第二战也落败。\n\n第三战不敌对手。"
        violations = checker._check_genre_taboos(text, consecutive_taboo)
        assert any(v.pattern_name == "连续失败" for v in violations)

    # --- edge cases ---

    def test_empty_genre_taboos(self, checker):
        violations = checker._check_genre_taboos("任意文本。", [])
        assert len(violations) == 0

    def test_unknown_taboo_type(self, checker):
        unknown = [{"name": "未知类型", "type": "unknown_type", "severity": "error"}]
        violations = checker._check_genre_taboos("任意文本。", unknown)
        assert len(violations) == 0

    def test_genre_taboo_layer_field(self, checker, genre_taboos):
        keyword_taboo = [t for t in genre_taboos if t["name"] == "禁用语"]
        violations = checker._check_genre_taboos("绝望地倒吸一口凉气。", keyword_taboo)
        assert all(v.layer == "genre" for v in violations)


class TestLayer3CharacterTaboos:
    @pytest.fixture
    def checker(self):
        return TabooConstraintChecker()

    @pytest.fixture
    def character_taboos(self):
        return [
            {"name": "林峰", "taboos": ["禁止说脏话", "禁止主动求助"]},
            {"name": "苏晓晓", "taboos": ["禁止示弱"]},
        ]

    def test_keyword_match_dirty_words(self, checker, character_taboos):
        violations = checker._check_character_taboos(
            "林峰骂道：'你他妈就是个混蛋，真是废物！'",
            character_taboos,
        )
        assert len(violations) > 0, "Should match '他妈' and '混蛋' and '废物'"
        pattern_names = {v.pattern_name for v in violations}
        assert "角色-林峰-禁止说脏话" in pattern_names

    def test_keyword_match_help_request(self, checker, character_taboos):
        violations = checker._check_character_taboos(
            "帮帮我！救命！求求你了！",
            character_taboos,
        )
        pattern_names = {v.pattern_name for v in violations}
        assert "角色-林峰-禁止主动求助" in pattern_names

    def test_keyword_match_weakness(self, checker, character_taboos):
        violations = checker._check_character_taboos(
            "苏晓晓低声道：'我不行，放过我吧。'",
            character_taboos,
        )
        pattern_names = {v.pattern_name for v in violations}
        assert "角色-苏晓晓-禁止示弱" in pattern_names

    def test_no_match_clean_speech(self, checker, character_taboos):
        violations = checker._check_character_taboos(
            "林峰说道：'我们走吧。'苏晓晓点了点头。",
            character_taboos,
        )
        assert len(violations) == 0

    def test_unknown_taboo_phrase_skipped(self, checker):
        taboos = [{"name": "路人", "taboos": ["禁止飞行"]}]
        violations = checker._check_character_taboos(
            "路人飞了起来。",
            taboos,
        )
        assert len(violations) == 0  # "禁止飞行" not in TABOO_KEYWORD_MAP → skip

    def test_empty_character_taboos(self, checker):
        violations = checker._check_character_taboos("任意文本。", [])
        assert len(violations) == 0

    def test_character_taboo_has_layer_and_severity(self, checker, character_taboos):
        violations = checker._check_character_taboos(
            "林峰：'他妈的，救救我！'",
            character_taboos,
        )
        for v in violations:
            assert v.layer == "character"
            assert v.severity in ("error", "warning")

    @pytest.mark.asyncio
    async def test_check_async_llm_unavailable(self, checker, character_taboos):
        """When LLM is unavailable, all keyword candidates pass through."""
        violations = await checker._check_character_taboos_async(
            "林峰：'他妈的！'",
            character_taboos,
        )
        assert len(violations) > 0  # candidate passes through

    @pytest.mark.asyncio
    async def test_check_async_integrates_results(self, checker, character_taboos):
        violations = await checker.check_async(
            "作者说林峰骂道：'他妈的都是废物！'",
            [],  # no genre taboos
            character_taboos,
        )
        # L1: meta-reference from "作者说"
        # L3: character taboo from "他妈"
        layers = {v.layer for v in violations}
        assert "global" in layers
        assert "character" in layers


class TestCheckSyncIntegration:
    @pytest.fixture
    def checker(self):
        return TabooConstraintChecker()

    @pytest.fixture
    def genre_taboos(self):
        return [
            {"name": "禁用语", "type": "keyword", "words": ["绝望", "放弃"], "severity": "warning"},
        ]

    def test_check_sync_combines_l1_l2(self, checker, genre_taboos):
        text = "作者说主角绝望地放弃了战斗。"
        violations = checker.check_sync(text, genre_taboos, [])
        # L1: "作者说" meta-reference
        # L2: "绝望", "放弃" from keyword taboo
        assert any(v.layer == "global" for v in violations), "Should have L1 violations"
        assert any(v.layer == "genre" for v in violations), "Should have L2 violations"

    def test_check_sync_empty_text(self, checker, genre_taboos):
        violations = checker.check_sync("", genre_taboos, [])
        assert len(violations) == 0

    def test_check_sync_no_taboos(self, checker):
        violations = checker.check_sync("任意文本。", [], [])
        # L1 may still fire (global patterns)
        assert all(v.layer == "global" for v in violations)
