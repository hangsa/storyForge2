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

def test_check_7_geo_no_implicit_teleport_returns_blocker_when_no_route():
    from backend.agents.reviewer import ReviewerAgent
    agent = ReviewerAgent(project_id="proj_x")
    map_data = {
        "schema_version": "1.0",
        "project_id": "proj_x",
        "locations": [
            {"id": "loc_a", "name": "A", "type": "inn",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
             "enter_conditions": [], "factions": []},
            {"id": "loc_b", "name": "B", "type": "inn",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
             "enter_conditions": [], "factions": []},
        ],
        "routes": [],
    }
    scene_ctx = {"routes": [{"from": "loc_a", "to": "loc_b"}]}
    r = agent.check_7_geo_no_implicit_teleport(map_data, scene_ctx)
    assert r.check_id == 7
    assert r.kind == "blocker"
    assert r.passed is False
    assert "geo.no_implicit_teleport" in r.detail or "geo.no_implicit_teleport" in r.name


def test_check_7_geo_no_implicit_teleport_returns_info_when_map_ctx_empty():
    """map_ctx={} 时,9 条 check 全部 passed=True + kind=对应值(向后兼容)。"""
    from backend.agents.reviewer import ReviewerAgent
    agent = ReviewerAgent(project_id="proj_x")
    # map_data 是必要的(avoid TypeError),scene_ctx={} → 跳过
    map_data = {"schema_version": "1.0", "project_id": "x",
                "locations": [], "routes": [], "location_states": []}
    r = agent.check_7_geo_no_implicit_teleport(map_data, {})
    assert r.passed is True
    assert r.kind == "blocker"   # 即使通过也保留 kind="blocker" 元信息


def test_all_nine_check_7_geo_methods_exist():
    """ReviewerAgent 必须有 check_7_geo_* 全部 9 个方法。"""
    from backend.agents.reviewer import ReviewerAgent
    agent = ReviewerAgent(project_id="proj_x")
    expected = [
        "check_7_geo_no_implicit_teleport",
        "check_7_geo_forbidden_access",
        "check_7_geo_time_budget_exceeded",
        "check_7_geo_distance_unrealistic",
        "check_7_geo_climate_mismatch",
        "check_7_geo_density_high",
        "check_7_geo_alias_added",
        "check_7_geo_faction_attitude_shift",
        "check_7_geo_poi_discovered",
    ]
    for name in expected:
        assert hasattr(agent, name), f"Missing method: {name}"


def test_each_check_7_method_returns_checkresult_with_kind():
    """9 个方法在 empty map_ctx={} 时都返回 CheckResult(kind=对应值, passed=True)。"""
    from backend.agents.reviewer import ReviewerAgent
    agent = ReviewerAgent(project_id="proj_x")
    map_data = {"schema_version": "1.0", "project_id": "x",
                "locations": [], "routes": [], "location_states": [],
                "regions": [], "settings": {}}
    pairs = [
        ("check_7_geo_no_implicit_teleport", "blocker"),
        ("check_7_geo_forbidden_access", "blocker"),
        ("check_7_geo_time_budget_exceeded", "blocker"),
        ("check_7_geo_distance_unrealistic", "warning"),
        ("check_7_geo_climate_mismatch", "warning"),
        ("check_7_geo_density_high", "warning"),
        ("check_7_geo_alias_added", "info"),
        ("check_7_geo_faction_attitude_shift", "info"),
        ("check_7_geo_poi_discovered", "info"),
    ]
    for method_name, expected_kind in pairs:
        method = getattr(agent, method_name)
        r = method(map_data, {})
        assert r.kind == expected_kind, f"{method_name}: expected kind={expected_kind}, got {r.kind}"
        assert r.passed is True


def test_run_fact_guard_accepts_map_context_kwarg():
    """Plan 3:run_fact_guard 新增 map_context=None 关键字参数(默认向后兼容)。"""
    from backend.agents.reviewer import ReviewerAgent
    agent = ReviewerAgent(project_id="proj_x")
    result = agent.run_fact_guard(
        draft_text="",
        characters=[],
        world_rules={},
        scene_plan={},
        map_context=None,
    )
    # 默认 None → 9 条 geo check 不运行,checks 列表只含现有 6 条
    assert len(result.checks) == 6


def test_run_fact_guard_empty_map_context_dict_runs_geo_checks():
    """map_context={} 也视为「跳过 geo checks」(向后兼容 Plan 1 caller)。"""
    from backend.agents.reviewer import ReviewerAgent
    agent = ReviewerAgent(project_id="proj_x")
    result = agent.run_fact_guard(
        draft_text="",
        characters=[],
        world_rules={},
        scene_plan={},
        map_context={},
    )
    assert len(result.checks) == 6


def test_run_fact_guard_with_map_context_appends_nine_geo_checks():
    """map_context 包含 map_data + scene_context → checks 列表扩到 6+9=15。"""
    from backend.agents.reviewer import ReviewerAgent
    agent = ReviewerAgent(project_id="proj_x")
    map_data = {
        "schema_version": "1.0", "project_id": "proj_x",
        "locations": [
            {"id": "loc_a", "name": "A", "type": "inn",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
             "enter_conditions": [], "factions": []},
            {"id": "loc_b", "name": "B", "type": "inn",
             "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
             "enter_conditions": [], "factions": []},
        ],
        "routes": [],
        "regions": [], "settings": {}, "location_states": [],
    }
    scene_ctx = {"routes": [{"from": "loc_a", "to": "loc_b"}]}
    result = agent.run_fact_guard(
        draft_text="",
        characters=[],
        world_rules={},
        scene_plan={},
        map_context={"map_data": map_data, "scene_context": scene_ctx},
    )
    assert len(result.checks) == 15
    # 6 existing checks all kind="info" (default)
    for c in result.checks[:6]:
        assert c.kind == "info"
    # 9 new checks: at least one is blocker
    geo_checks = result.checks[6:]
    kinds = {c.kind for c in geo_checks}
    assert "blocker" in kinds
    # all_passed should be False because blocker failed
    assert result.all_passed is False


def test_run_fact_guard_blocker_only_marks_all_passed_false():
    """Warning / Info 失败不阻断 all_passed;只有 Blocker 失败才阻断。"""
    from backend.agents.reviewer import ReviewerAgent
    agent = ReviewerAgent(project_id="proj_x")
    map_data = {
        "schema_version": "1.0", "project_id": "proj_x",
        "locations": [], "routes": [],
        "regions": [
            {"id": "region_x", "name": "X", "climate": "严寒, 长冬",
             "aliases": [], "tags": []},
        ],
        "settings": {
            "chapter_new_location_cap": 5,
            "reuse_rate_target": 0.6, "strict_geo": False,
        },
        "location_states": [],
    }
    # 只有 climate warning(无 blocker)
    scene_ctx = {"climate": [{"region_id": "region_x", "scene_weather": "烈日"}]}
    result = agent.run_fact_guard(
        draft_text="",
        characters=[],
        world_rules={},
        scene_plan={},
        map_context={"map_data": map_data, "scene_context": scene_ctx},
    )
    # all_passed stays True (Warning 不阻断 circuit breaker)
    assert result.all_passed is True


def test_run_fact_guard_legacy_signature_without_map_context_still_works():
    """现有 caller(stage4_writing.py 等)不传 map_context 时也跑通。"""
    from backend.agents.reviewer import ReviewerAgent
    agent = ReviewerAgent(project_id="proj_x")
    result = agent.run_fact_guard(
        draft_text="一些文本",
        characters=[{"name": "X"}],
        world_rules={},
        scene_plan={"required_logs": []},
    )
    assert len(result.checks) == 6
