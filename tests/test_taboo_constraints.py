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
