"""PRD §7: operation-aware differentiation axis.

Source: docs/design/creative-canvas-reconstruction.md §7 table.
Mirrored in frontend `frontend/src/components/creative-canvas/axisGuidance.ts`
— keep both sides in sync.

The 6 canvas operations each have a fixed A/B/C axis:
  - A（基础）: the conservative slot — minimal change to current concept.
  - B（变体）: medium change — repositions the same conflict at a new level.
  - C（极端）: maximal change — pivots the foundation itself.

The next-step LLM call uses `format_axis_hint_block(operation)` to inject
this guidance into the user prompt so the three generated options vary
along the operation's axis instead of being three rephrasings.
"""
from __future__ import annotations

from typing import Literal

Operation = Literal["twist", "break", "fuse", "invert", "escalate", "dramaturgy"]

AXIS_GUIDANCE: dict[str, dict[Literal["A", "B", "C"], str]] = {
    "twist":      {"A": "改变单一关键条件",  "B": "改变条件之间的因果", "C": "改变整个设定基础"},
    "break":      {"A": "规则在边界条件下失效", "B": "规则被反噬",     "C": "规则不存在"},
    "fuse":       {"A": "表面元素融合（道具/场景）", "B": "类型规则融合", "C": "世界观融合（物理规则）"},
    "invert":     {"A": "角色立场反转",       "B": "因果反转",       "C": "主题反转"},
    "escalate":   {"A": "个人级别升级",       "B": "社会级别升级",   "C": "文明/宇宙级别升级"},
    "dramaturgy": {"A": "简洁 premise",       "B": "复杂 premise",   "C": "主题化 premise"},
}


def get_axis_hint(operation: str) -> dict[str, str]:
    """Return A/B/C axis description for the operation, falling back to twist."""
    return AXIS_GUIDANCE.get(operation, AXIS_GUIDANCE["twist"])


def format_axis_hint_block(operation: str) -> str:
    """Format the axis hint as a markdown block for injection into LLM prompts."""
    hint = get_axis_hint(operation)
    return (
        f"## 三选项差异轴（{operation} 操作）\n"
        f"- A（基础）：{hint['A']}\n"
        f"- B（变体）：{hint['B']}\n"
        f"- C（极端）：{hint['C']}\n"
        "\n三个选项必须沿此轴变化，禁止仅是措辞不同。"
    )