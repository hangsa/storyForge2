"""footprint helper — write a single Footprint row to Map.footprints.

Plan 1's Map model already has `footprints: list[Footprint]` with fields:
    chapter, character_id, location_id, arrived_via (Optional),
    departed_to (Optional), companions (list), time_of_day, weather.

Two entry points:
  - record_footprint_from_sf_log: 解析 SF_LOG character_location_change
    (calls to via character name; resolves to_location via name_to_id)
  - record_footprint_from_mention: 解析 LLM mention extraction 输出
    (alias → canonical_id 已经由 caller 提供)

Both write atomically via load_map / save_map. Unresolvable to_location
yields a Footprint with empty location_id (don't drop the row — Plan 3
assertions will read it and may flag it).
"""
from __future__ import annotations

import logging
from typing import Optional

from backend.map_system.models import Footprint, Map
from backend.map_system.storage import load_map, save_map

logger = logging.getLogger(__name__)


def _resolve_location_id(project_id: str, to_location: str) -> str:
    """Resolve a free-text location string to its canonical id via the
    Plan 1 `build_name_index` reverse index. Returns "" if unresolvable."""
    if not to_location or not to_location.strip():
        return ""
    from backend.map_system.storage import build_name_index
    idx = build_name_index(project_id)
    return idx.get(to_location.strip(), "")


def _resolve_via(project_id: str, via: str) -> str:
    """arrived_via 是 location_id 而不是自由文本 → 同样查 index。
    Empty string passed through."""
    if not via or not via.strip():
        return ""
    return _resolve_location_id(project_id, via)


def record_footprint_from_sf_log(
    project_id: str,
    chapter: int,
    character_id: str,
    to_location: str,
    via: str = "",
) -> Optional[Footprint]:
    """Append a footprint row from a SF_LOG character_location_change.

    Returns the new Footprint (or None if no map.json).
    """
    data = load_map(project_id)
    if not data:
        return None

    location_id = _resolve_location_id(project_id, to_location)
    arrived_via = _resolve_via(project_id, via) if via else None

    fp = Footprint(
        chapter=chapter,
        character_id=character_id,
        location_id=location_id,
        arrived_via=arrived_via,
        departed_to=None,
        companions=[],
        time_of_day="",
        weather="",
    )

    m = Map.model_validate(data)
    m.footprints.append(fp)
    save_map(project_id, m)
    logger.info(
        "[map] recorded footprint proj=%s ch=%d char=%s loc=%s (resolved=%s)",
        project_id, chapter, character_id, to_location, location_id or "<unresolved>",
    )
    return fp


def record_footprint_from_mention(
    project_id: str,
    chapter: int,
    character_id: str,
    alias: str,
    canonical_id: str,
) -> Optional[Footprint]:
    """Append a footprint row from LLM mention extraction output.

    canonical_id is already resolved by the caller (so we skip the
    name_to_id lookup); we still need to write the Map.
    """
    data = load_map(project_id)
    if not data:
        return None

    fp = Footprint(
        chapter=chapter,
        character_id=character_id,
        location_id=canonical_id,
        arrived_via=None,
        departed_to=None,
        companions=[],
        time_of_day="",
        weather="",
    )

    m = Map.model_validate(data)
    m.footprints.append(fp)
    save_map(project_id, m)
    logger.info(
        "[map] mention-extracted footprint proj=%s ch=%d char=%s alias=%s -> %s",
        project_id, chapter, character_id, alias, canonical_id,
    )
    return fp


__all__ = ["record_footprint_from_sf_log", "record_footprint_from_mention"]
