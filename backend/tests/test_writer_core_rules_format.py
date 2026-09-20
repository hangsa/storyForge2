"""writer pipeline's core_rules injection format.

`world.core_rules[]` is now `list[CoreRule{category, text}]`. The
writer must inject the rules into scene context grouped by category
with subheaders, so the writer LLM sees structure (not a flat dump)."""

from backend.agents.writer import _format_core_rules_grouped
from backend.models.world import CoreRule, CoreRuleCategory


def test_groups_rules_by_category_with_subheaders():
    rules = [
        CoreRule(category=CoreRuleCategory.PHYSICAL, text="灵气有限"),
        CoreRule(category=CoreRuleCategory.SOCIAL, text="灵脉被垄断"),
        CoreRule(category=CoreRuleCategory.NARRATIVE, text="强者受限"),
        CoreRule(category=CoreRuleCategory.PROTAGONIST, text="寄体必死"),
    ]
    out = _format_core_rules_grouped(rules)
    assert "### 物理公理 (ontology)" in out
    assert "### 结构性瓶颈 (power_structure)" in out
    assert "### 解决路径封闭性 (narrative_physics)" in out
    assert "### 主角机制硬约束 (protagonist_engine)" in out
    assert "  - 灵气有限" in out
    assert "  - 灵脉被垄断" in out
    assert "  - 寄体必死" in out


def test_omits_empty_categories():
    rules = [CoreRule(category=CoreRuleCategory.PHYSICAL, text="只有物理规则")]
    out = _format_core_rules_grouped(rules)
    assert "### 物理公理" in out
    assert "### 结构性瓶颈" not in out
    assert "### 解决路径封闭性" not in out
    assert "### 主角机制硬约束" not in out


def test_empty_rules_returns_placeholder():
    out = _format_core_rules_grouped([])
    assert out == "(无世界规则)"


def test_legacy_string_list_coerces_to_physical_at_call_site():
    """Legacy world.json with `core_rules: ['str1', 'str2']` (flat list[str],
    pre-Task-2 shape) must coerce to CoreRule(PHYSICAL, str) at the writer call
    site so the per-category grouping renders them under the physical subheader.

    This test re-applies the per-item coercion logic from the writer call site
    (`_build_base_vars`, lines ~455-465 of backend/agents/writer.py). The 3
    earlier tests only exercise `_format_core_rules_grouped` with already-
    constructed CoreRule instances, so they don't pin the legacy coercion path
    that touches user data.
    """
    core_rules_raw = ["旧规则A", "旧规则B"]
    core_rules_obj = [
        CoreRule(**c) if isinstance(c, dict) else CoreRule(
            category=CoreRuleCategory.PHYSICAL, text=str(c)
        )
        for c in core_rules_raw
    ]
    rendered = _format_core_rules_grouped(core_rules_obj)
    assert "### 物理公理 (ontology)" in rendered
    assert "  - 旧规则A" in rendered
    assert "  - 旧规则B" in rendered