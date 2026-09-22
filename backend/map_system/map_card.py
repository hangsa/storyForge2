"""地图卡(scene-level mini-card) — 把当前场景所在的地点 + 角色足迹
压缩成 4 行中文文本注入 Writer 上下文。

PRD §4 设计:
  当前: 黑水镇北门 · 亥时
  可移动: 城门外官道(2 里) · 黑水镇内街坊(500 米)
  到达钩子: 商队夜间歇脚 · 巡城武僧 · 流民
  一致性提醒: 本场 scene=3 已确认角色【林峰】在【黑水镇北门】
"""
from __future__ import annotations

from typing import Optional

from backend.map_system.storage import load_map


def build_map_card(project_id: str, scene_location: Optional[str]) -> str:
    """Render the 4-row map card for the writer context.

    Returns "" when:
      - project has no map.json
      - scene_location is None / empty
      - scene_location doesn't resolve to any canonical location/region/poi

    Callers should treat empty string as "no map constraints, write freely".
    """
    if not scene_location or not scene_location.strip():
        return ""

    data = load_map(project_id)
    if not data:
        return ""

    # Plan 2 Task 2 / Task 3 在此继续展开。当前仅返回空串占位。
    return ""