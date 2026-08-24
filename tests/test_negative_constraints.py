"""Tests for the negative_constraints render helper.

render_negative_block is a pure-string utility that BaseAgent.load_prompt
calls to turn a user's free-text list into the `【禁止事项】` block
substituted into {negative_constraints}.
"""

from backend.services.prompt_override_store import render_negative_block


def test_empty_string_returns_empty():
    assert render_negative_block("") == ""


def test_whitespace_only_returns_empty():
    assert render_negative_block("   ") == ""
    assert render_negative_block("\n\n") == ""
    assert render_negative_block("  \n  \n  ") == ""


def test_single_line_renders_with_header_and_bullet():
    assert render_negative_block("不要使用回合制战斗描写") == (
        "\n\n【禁止事项】\n- 不要使用回合制战斗描写"
    )


def test_multi_line_trims_drops_blanks_and_bullets():
    assert render_negative_block(
        "  不要使用回合制战斗描写  \n"
        "不要出现现代品牌名\n"
        "\n"
        "禁止元婴/金丹/筑基"
    ) == (
        "\n\n【禁止事项】\n"
        "- 不要使用回合制战斗描写\n"
        "- 不要出现现代品牌名\n"
        "- 禁止元婴/金丹/筑基"
    )
