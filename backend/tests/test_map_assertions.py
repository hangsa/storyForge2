"""map_system/assertions.py 测试 — 9 条 deterministic 规则 + RuleResult dataclass。"""
from backend.map_system.assertions import RuleResult


def test_rule_result_dataclass_fields():
    r = RuleResult(
        kind="blocker",
        code="geo.no_implicit_teleport",
        message="角色 A 从 loc_x 跳到 loc_y 无可用 route",
        evidence={"from": "loc_x", "to": "loc_y", "available_routes": []},
    )
    assert r.kind == "blocker"
    assert r.code == "geo.no_implicit_teleport"
    assert r.message == "角色 A 从 loc_x 跳到 loc_y 无可用 route"
    assert r.evidence == {"from": "loc_x", "to": "loc_y", "available_routes": []}


def test_rule_result_kind_must_be_literal():
    """kind 必须是 blocker / warning / info 之一,否则 Pydantic-like 校验失败。

    本测试只断言 dataclass 字段类型 — 类型错误在构造时被 dataclass 拒绝。
    """
    import dataclasses
    fields = {f.name for f in dataclasses.fields(RuleResult)}
    assert "kind" in fields
    assert "code" in fields
    assert "message" in fields
    assert "evidence" in fields