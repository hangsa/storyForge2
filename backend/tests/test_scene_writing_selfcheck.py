"""scene_writing.yaml §9.4 自查清单测试 — 9 个 rule ID 必须全部出现在 system_prompt。"""
import re
from pathlib import Path


EXPECTED_RULE_IDS = [
    "geo.no_implicit_teleport",
    "geo.forbidden_access",
    "geo.time_budget_exceeded",
    "geo.distance_unrealistic",
    "geo.climate_mismatch",
    "geo.density_high",
    "geo.alias_added",
    "geo.faction_attitude_shift",
    "geo.poi_discovered",
]


def _load_scene_writing_prompt() -> str:
    """直读 backend/prompts/scene_writing.yaml,提取 system_prompt 段。

    不走 BaseAgent.load_prompt 因为需要 3-tier override chain 在测试中不方便 mock。
    """
    path = Path(__file__).parent.parent / "prompts" / "scene_writing.yaml"
    data = _load_yaml(path)
    return data.get("system_prompt", "")


def test_system_prompt_contains_all_nine_geo_rule_ids():
    """PRD §9.4 要求:Writer 端看到所有 9 个 rule code。"""
    system_prompt = _load_scene_writing_prompt()
    for code in EXPECTED_RULE_IDS:
        assert code in system_prompt, f"Missing rule code: {code}"


def test_system_prompt_contains_self_check_section():
    """§9.4 段必须以「【地理自查清单】」开头(Marker,便于运行时解析)。"""
    system_prompt = _load_scene_writing_prompt()
    assert "【地理自查清单" in system_prompt


def test_yaml_does_not_break_format_template():
    """新增段含示例 rule code(如 「geo.no_implicit_teleport」)— 任何 { 不能未配对,
    否则 str.format() 会 KeyError(参见 feedback_prompt_yaml_brace_escape 内存)。

    简化检查:扫 system_prompt 中的 { 与 } 配对,数量必须偶数。
    """
    system_prompt = _load_scene_writing_prompt()
    n_open = system_prompt.count("{")
    n_close = system_prompt.count("}")
    assert n_open == n_close, (
        f"Unbalanced braces: {n_open} open vs {n_close} close — "
        "literal {{...}} example JSON must be escaped per brace-escape rule"
    )


def test_yaml_user_prompt_template_still_has_map_card_placeholder():
    """Plan 2 加的 {map_card} 占位必须存在 — Plan 3 不应误删。"""
    path = Path(__file__).parent.parent / "prompts" / "scene_writing.yaml"
    data = _load_yaml(path)
    user_template = data.get("user_prompt_template", "")
    assert "{map_card}" in user_template


def _load_yaml(path: Path) -> dict:
    import yaml
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)