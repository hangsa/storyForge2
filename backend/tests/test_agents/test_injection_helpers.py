"""Unit tests for backend.agents._injection_helpers.

锁定 _format_dimension_units / _build_user_modifications_block 的输出契约 —
world_generation prompt 的 6 个占位符({ontology_units}, {energetics_units},
{power_structure_units}, {protagonist_engine_units}, {narrative_physics_units},
{causal_map})都依赖这些 helper 的格式稳定。若格式漂移,LLM 端会把列表 dict
原样塞进 prompt,导致解析失败或语义混乱。
"""
from __future__ import annotations

from backend.agents._injection_helpers import (
    _build_user_modifications_block,
    _format_dimension_units,
)


# --- _format_dimension_units --------------------------------------------------


class TestFormatDimensionUnits:
    def test_none_returns_placeholder(self):
        assert _format_dimension_units(None) == "（无）"

    def test_empty_list_returns_placeholder(self):
        assert _format_dimension_units([]) == "（无）"

    def test_single_unit_renders_name_and_description(self):
        out = _format_dimension_units([
            {"unit_name": "灵窍", "description": "是接口的具象化"},
        ])
        assert out == "- **灵窍**: 是接口的具象化"

    def test_multiple_units_separated_by_newline(self):
        out = _format_dimension_units([
            {"unit_name": "A", "description": "desc A"},
            {"unit_name": "B", "description": "desc B"},
        ])
        assert out == "- **A**: desc A\n- **B**: desc B"

    def test_description_truncated_to_300_chars(self):
        long_desc = "x" * 500
        out = _format_dimension_units([
            {"unit_name": "X", "description": long_desc},
        ])
        # 截断后应该是 300 个 x
        assert out.endswith("x" * 300)
        # 没有 301 个 x
        assert "x" * 301 not in out

    def test_description_strips_whitespace_before_truncation(self):
        out = _format_dimension_units([
            {"unit_name": "Y", "description": "  hello  "},
        ])
        assert out == "- **Y**: hello"

    def test_missing_unit_name_falls_back_to_placeholder(self):
        out = _format_dimension_units([
            {"description": "no name here"},
        ])
        assert out == "- **未命名**: no name here"

    def test_empty_unit_name_falls_back_to_placeholder(self):
        out = _format_dimension_units([
            {"unit_name": "", "description": "empty name"},
        ])
        assert out == "- **未命名**: empty name"

    def test_missing_description_treated_as_empty(self):
        out = _format_dimension_units([
            {"unit_name": "Z"},
        ])
        assert out == "- **Z**: "

    def test_non_dict_elements_skipped(self):
        # LLM 端偶尔会产出混入字符串/None 的 units 数组,这里要能优雅跳过
        out = _format_dimension_units([
            "string-element",
            None,
            {"unit_name": "OK", "description": "good"},
            42,
        ])
        assert out == "- **OK**: good"

    def test_all_invalid_returns_placeholder(self):
        # 全部都是非 dict → 渲染后行列表为空,应 fallback 到占位符
        out = _format_dimension_units(["a", None, 42])
        assert out == "（无）"


# --- _build_user_modifications_block -----------------------------------------


class TestBuildUserModificationsBlock:
    def test_empty_string_returns_empty(self):
        assert _build_user_modifications_block("") == ""

    def test_whitespace_only_returns_empty(self):
        # 纯空白也算"无修改意见",prompt 端按 "没有用户意见" 处理
        assert _build_user_modifications_block("   \n\t  ") == ""

    def test_none_returns_empty(self):
        assert _build_user_modifications_block(None) == ""

    def test_normal_text_wrapped_in_block(self):
        out = _build_user_modifications_block("加入门派争议")
        assert out == "\n【用户修改意见】\n加入门派争议"

    def test_surrounding_whitespace_stripped(self):
        out = _build_user_modifications_block("  加入门派争议  \n")
        # 内部空白保留,两侧空白 strip — prompt 端不再添加换行
        assert out == "\n【用户修改意见】\n加入门派争议"