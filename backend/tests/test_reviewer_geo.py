"""ReviewerAgent 9 个 check_7_geo_* 方法 + CheckResult.kind 字段测试。"""
from backend.agents.reviewer import CheckResult


def test_check_result_has_kind_field_defaulting_to_info():
    """默认 kind="info" — 向后兼容:现有 6 条 check 不显式传 kind 也通过。"""
    r = CheckResult(check_id=1, name="时间线连续性", passed=True, detail="ok")
    assert r.kind == "info"


def test_check_result_kind_can_be_set_explicitly():
    r = CheckResult(
        check_id=7, name="geo.no_implicit_teleport",
        passed=False, detail="无 route", kind="blocker",
    )
    assert r.kind == "blocker"


def test_existing_six_checks_default_kind_info():
    """验证 6 个现有 check 方法不显式传 kind 时,结果 kind="info"(向后兼容)。

    不实际运行 LLM,只构造 ReviewerAgent 实例并 mock check 1-6 的最小输入。
    """
    from backend.agents.reviewer import ReviewerAgent
    agent = ReviewerAgent(project_id="proj_x")
    r = agent.check_1_timeline("无文本", {"current_state": {"location": ""}, "name": "X"})
    assert isinstance(r, CheckResult)
    assert r.kind == "info"  # 默认值,不报错


def test_existing_six_checks_can_be_invoked_without_kind_kwarg():
    """调用 check_1/2/3/4/5/6 不需要传 kind= 参数(默认即可)。"""
    from backend.agents.reviewer import ReviewerAgent
    agent = ReviewerAgent(project_id="proj_x")
    char = {"name": "X", "current_state": {"location": ""},
            "unknown_to_character": [], "voice_signature": {"taboos": []}}
    r1 = agent.check_1_timeline("", char)
    r2 = agent.check_2_character_state("", char)
    r3 = agent.check_3_world_rules("", {})
    r4 = agent.check_4_asset_compliance("", {})
    r5 = agent.check_5_log_completeness("", {"required_logs": []})
    # check_6 requires precheck_result kwarg
    r6 = agent.check_6_semantic_precheck_review(precheck_result=None)
    for r in [r1, r2, r3, r4, r5, r6]:
        assert r.kind == "info"