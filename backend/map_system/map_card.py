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

_TRAVEL_DISTANCE_LABEL = {
    "intra_city": "城内",
    "inter_city": "城外",
    "inter_region": "跨域",
    "inter_continent": "跨洲",
}


def _build_index(data: dict) -> dict[str, dict]:
    """Build alias/name → entity record dict for deterministic lookup.

    Each value is the entity dict with an added `_kind` key so callers know
    whether they resolved to a region/location/poi. Names win over aliases
    when both exist for the same string.
    """
    index: dict[str, dict] = {}
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


def _route_row(current_loc_id: str, data: dict) -> str:
    """【可移动】行:从当前 location 出发的 route 终点列表。"""
    rows = []
    for route in data.get("routes", []):
        if route.get("from") == current_loc_id:
            target = next(
                (l for l in data.get("locations", [])
                 if l.get("id") == route.get("to")),
                None,
            )
            if not target:
                continue
            tier = route.get("distance_tier", "inter_city")
            label = _TRAVEL_DISTANCE_LABEL.get(tier, tier)
            rows.append(f"{target['name']}({label})")
    return f"可移动: {' · '.join(rows)}" if rows else "可移动: —"


def _encounter_row(current_loc_id: str, data: dict) -> str:
    """【到达钩子】行:routes 上的 encounters 字段合并去重。"""
    encounters: list[str] = []
    seen: set[str] = set()
    for route in data.get("routes", []):
        if route.get("from") == current_loc_id:
            for enc in route.get("encounters", []):
                if enc and enc not in seen:
                    seen.add(enc)
                    encounters.append(enc)
    return f"到达钩子: {' · '.join(encounters)}" if encounters else "到达钩子: —"


def _footprint_row(
    current_loc_id: str, data: dict,
    chapter_number: Optional[int], character_id: Optional[str],
) -> str:
    """【一致性提醒】行:本场 chapter + character 在 current_loc_id 的最近 footprint。"""
    if chapter_number is None:
        return "一致性提醒: —"
    fp = next(
        (f for f in data.get("footprints", [])
         if f.get("location_id") == current_loc_id
         and f.get("chapter") == chapter_number
         and (character_id is None or f.get("character_id") == character_id)),
        None,
    )
    if fp is None:
        return f"一致性提醒: 本场 chapter={chapter_number} 无 footprint 记录"
    char_id = fp.get("character_id", "")
    return f"一致性提醒: 本场 chapter={chapter_number} 已确认角色【{char_id}】在【{current_loc_id}】"


def build_map_card(
    project_id: str,
    scene_location: Optional[str],
    chapter_number: Optional[int] = None,
    character_id: Optional[str] = None,
) -> str:
    """Render the 4-row map card for the writer context.

    Returns "" when:
      - project has no map.json
      - scene_location is None / empty
      - scene_location doesn't resolve to any canonical location/region/poi

    The 4 rows (separated by newlines):
      当前: <resolved_name> · <time_of_day or empty>
      可移动: <route1> · <route2> · ...
      到达钩子: <encounter1> · <encounter2> · ...
      一致性提醒: 本场 scene=<N> 已确认角色【<char>】在【<loc>】
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

    kind = resolved["_kind"]
    name = resolved["name"]
    current_loc_id = ""
    if kind == "location":
        current_loc_id = resolved["id"]
    elif kind == "poi":
        parent_id = resolved.get("parent_location_id", "")
        parent = next(
            (l for l in data.get("locations", []) if l.get("id") == parent_id),
            None,
        )
        if parent:
            name = f"{parent['name']}·{name}"
            current_loc_id = parent_id
        else:
            return _NO_CARD
    else:  # region — no routes / footprints scoped to a region
        return f"当前: {name}"

    rows = [f"当前: {name}"]
    if current_loc_id:
        rows.append(_route_row(current_loc_id, data))
        rows.append(_encounter_row(current_loc_id, data))
        rows.append(_footprint_row(current_loc_id, data, chapter_number, character_id))
    return "\n".join(rows)


__all__ = ["build_map_card"]