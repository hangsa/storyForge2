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


_NO_CARD = ""


def _build_index(data: dict) -> dict[str, dict]:
    """Build alias/name → entity record dict for deterministic lookup.

    Each value is the entity dict with an added `_kind` key so callers know
    whether they resolved to a region/location/poi. Names and aliases share
    the namespace — if a name collides with an alias, the alias loses
    (names win because we iterate them first).
    """
    index: dict[str, dict] = {}
    # Regions first so they don't shadow locations with same name
    for r in data.get("regions", []):
        rec = dict(r)
        rec["_kind"] = "region"
        index[r["name"]] = rec
        for alias in r.get("aliases", []):
            index.setdefault(alias, rec)
    for loc in data.get("locations", []):
        rec = dict(loc)
        rec["_kind"] = "location"
        index[loc["name"]] = rec
        for alias in loc.get("aliases", []):
            index.setdefault(alias, rec)
    for poi in data.get("pois", []):
        rec = dict(poi)
        rec["_kind"] = "poi"
        index[poi["name"]] = rec
    return index


def build_map_card(project_id: str, scene_location: Optional[str]) -> str:
    """Render the 4-row map card for the writer context.

    Returns "" when:
      - project has no map.json
      - scene_location is None / empty
      - scene_location doesn't resolve to any canonical location/region/poi

    The 4 rows:
      当前: <resolved_name> · <time_of_day or empty>
      可移动: <route1> · <route2> · ...
      到达钩子: <encounter1> · <encounter2> · ...
      一致性提醒: 本场 scene=<N> 已确认角色【<char>】在【<loc>】

    Plan 2 Task 2 covers the "当前" row + resolution. Tasks 3-4 add the
    remaining rows once we know how to pull routes / encounters / footprints
    out of the Map.
    """
    if not scene_location or not scene_location.strip():
        return _NO_CARD

    data = load_map(project_id)
    if not data:
        return _NO_CARD

    index = _build_index(data)
    resolved = index.get(scene_location.strip())
    if not resolved:
        return _NO_CARD

    name = resolved["name"]
    kind = resolved["_kind"]
    if kind == "poi":
        # POI current row: append parent location name
        parent_id = resolved.get("parent_location_id", "")
        parent = next(
            (l for l in data.get("locations", []) if l.get("id") == parent_id),
            None,
        )
        if parent:
            name = f"{parent['name']}·{name}"

    return f"当前: {name}"


__all__ = ["build_map_card"]