"""Volume parsing for novel_outline.json — chapter-to-volume mapping.

Pure parsing: no rendering, no IO. Mirrors the frontend's
`frontend/src/utils/outline.ts` (parseVolumes / computePlannedTotal) — the
two implementations must agree, since autopilot never goes through the
browser and would otherwise get different behaviour.
"""
import re
from dataclasses import dataclass
from typing import Optional

CHAPTER_RANGE_RE = re.compile(r"^\s*(\d+)\s*-\s*(\d+)\s*$")


@dataclass(frozen=True)
class ParsedVolume:
    index: int
    name: str
    chapter_range: str
    summary: str
    key_events: list[str]
    start: int
    end: int


def parse_volumes(novel_outline: Optional[dict]) -> list[ParsedVolume]:
    """Parse and validate `novel_outline["volumes"]`, sorted by start chapter.

    Drops volumes whose range is malformed, starts below chapter 1, or is
    inverted. `index` is assigned after sorting so callers can address
    neighbours positionally.
    """
    if not isinstance(novel_outline, dict):
        return []
    raw = novel_outline.get("volumes")
    if not isinstance(raw, list):
        return []

    staged: list[tuple[int, int, dict]] = []
    for vol in raw:
        if not isinstance(vol, dict):
            continue
        rng = vol.get("chapter_range")
        if not isinstance(rng, str):
            continue
        match = CHAPTER_RANGE_RE.match(rng)
        if not match:
            continue
        start, end = int(match.group(1)), int(match.group(2))
        if start < 1 or end < start:
            continue
        staged.append((start, end, vol))

    staged.sort(key=lambda item: item[0])

    return [
        ParsedVolume(
            index=i,
            name=str(vol.get("name") or ""),
            chapter_range=str(vol.get("chapter_range") or ""),
            summary=str(vol.get("summary") or ""),
            key_events=[e for e in (vol.get("key_events") or []) if isinstance(e, str)],
            start=start,
            end=end,
        )
        for i, (start, end, vol) in enumerate(staged)
    ]


def planned_total(novel_outline: Optional[dict]) -> int:
    """The user's planned total chapter count — max end across valid volumes.

    Returns 0 when the outline is missing or has no parseable volume; callers
    fall back to `outline.json`'s chapter count in that case.
    """
    return max((v.end for v in parse_volumes(novel_outline)), default=0)


def locate_volume(
    chapter_number: int, volumes: list[ParsedVolume]
) -> Optional[ParsedVolume]:
    """Find the volume owning `chapter_number`, clamping to the nearest volume.

    Out-of-range chapters happen for real: the workspace's "+ 新章节" lets the
    user write past the planned total. Such a chapter is narratively a
    continuation of the last volume, so giving it the last volume's context
    beats giving it the whole book. Returns None only when there is no
    parseable volume at all.
    """
    if not volumes:
        return None
    if chapter_number < volumes[0].start:
        return volumes[0]
    for volume in volumes:
        if volume.start <= chapter_number <= volume.end:
            return volume
    prior = [v for v in volumes if v.start <= chapter_number]
    return prior[-1] if prior else volumes[0]