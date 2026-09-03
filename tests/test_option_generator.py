"""PRD §7: operation-aware differentiation axis."""
from backend.creative_os.option_generator import AXIS_GUIDANCE, get_axis_hint, format_axis_hint_block


def test_all_six_operations_have_axis_guidance():
    for op in ("twist", "break", "fuse", "invert", "escalate", "dramaturgy"):
        assert op in AXIS_GUIDANCE
        for slot in ("A", "B", "C"):
            assert slot in AXIS_GUIDANCE[op]


def test_axis_hint_per_operation_matches_prd_section_7():
    assert "条件" in get_axis_hint("twist")["A"]
    assert "规则" in get_axis_hint("break")["A"]
    assert "元素" in get_axis_hint("fuse")["A"]
    assert "立场" in get_axis_hint("invert")["A"]
    assert "个人" in get_axis_hint("escalate")["A"]
    assert "简洁" in get_axis_hint("dramaturgy")["A"]


def test_unknown_operation_falls_back_to_twist():
    assert get_axis_hint("unknown") == get_axis_hint("twist")


def test_format_axis_hint_block_includes_slot_markers():
    block = format_axis_hint_block("fuse")
    assert "A（基础）" in block
    assert "B（变体）" in block
    assert "C（极端）" in block
    assert "fuse" in block