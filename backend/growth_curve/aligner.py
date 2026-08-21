"""STAGE 3 growth curve alignment — the volume outline is the authority for
when each growth stage happens.

Replaces the old reverse-inference in auto_generator.py, which derived stage
ranges from already-generated chapters and froze them at a degenerate
one-chapter state on the first call of the batch loop.

Tier 0: zero LLM calls, deterministic, idempotent.
"""
import logging
from typing import Optional

from backend.growth_curve.binder import TRIGGER_KEYWORDS
from backend.outline_context.volumes import CHAPTER_RANGE_RE, planned_total

logger = logging.getLogger(__name__)


def _parse_range(value) -> Optional[tuple[int, int]]:
    """Accept both "3-5" and a bare "7" (which becomes (7, 7))."""
    if not isinstance(value, str):
        return None
    match = CHAPTER_RANGE_RE.match(value)
    if match:
        start, end = int(match.group(1)), int(match.group(2))
        if start >= 1 and end >= start:
            return start, end
        return None
    stripped = value.strip()
    if stripped.isdigit() and int(stripped) >= 1:
        return int(stripped), int(stripped)
    return None


def _mc_arc(novel_outline: Optional[dict]) -> list[dict]:
    if not isinstance(novel_outline, dict):
        return []
    return [m for m in (novel_outline.get("mc_growth_arc") or []) if isinstance(m, dict)]


def _milestone_ranges(arc: list[dict]) -> list[tuple[int, int]]:
    parsed = [_parse_range(m.get("target_chapter_range")) for m in arc]
    return [r for r in parsed if r is not None]


def _even_split(count: int, total: int) -> list[tuple[int, int]]:
    """Split [1, total] into `count` contiguous buckets."""
    if count <= 0:
        return []
    total = max(total, count)
    size = total / count
    buckets = []
    for i in range(count):
        start = int(i * size) + 1
        end = total if i == count - 1 else int((i + 1) * size)
        buckets.append((start, max(end, start)))
    return buckets


def _map_stage_ranges(
    stage_count: int, milestones: list[tuple[int, int]], total: int
) -> list[tuple[int, int]]:
    if stage_count <= 0:
        return []
    if not milestones:
        return _even_split(stage_count, total)

    span = len(milestones) - 1
    if stage_count == 1:
        picked = [milestones[0]]
    else:
        picked = [
            milestones[round(i * span / (stage_count - 1))] for i in range(stage_count)
        ]

    if total > 0:
        clamped = []
        for start, end in picked:
            start = min(max(start, 1), total)
            end = min(max(end, 1), total)
            clamped.append((start, max(end, start)))
        return clamped
    return picked


def _event_type_for(text: str) -> Optional[str]:
    for event_type, keywords in TRIGGER_KEYWORDS.items():
        if any(keyword in text for keyword in keywords):
            return event_type
    return None


def _synthesize_protagonist_stages(arc: list[dict]) -> list[dict]:
    """Build stages straight from mc_growth_arc.

    This is a faithful mapping, not invention: mc_growth_arc IS the main
    character's growth arc. Doing the same for other characters would be
    fabrication, so callers must restrict this to the protagonist.
    """
    stages = []
    for i, milestone in enumerate(arc):
        label = str(milestone.get("label") or "").strip()
        description = str(milestone.get("description") or "").strip()
        stage = {
            "stage_number": i + 1,
            "stage_name": label or f"阶段{i + 1}",
            "trigger_event_description": description,
            "character_change": "",
            "target_chapter_range": "",
            "bound_chapter": None,
        }
        event_type = _event_type_for(f"{label} {description}")
        if event_type:
            stage["trigger_event_type"] = event_type
        # No keyword match → leave the field absent. binder.py reads "" from
        # the missing key, gets an empty keyword list, and never binds. A
        # wrong event type would instead produce a wrong bound_chapter.
        stages.append(stage)
    return stages


def align_growth_curves(
    characters: list[dict], novel_outline: Optional[dict]
) -> list[dict]:
    """Re-derive every growth stage's target_chapter_range from the volume
    outline. Mutates in place and returns the list for clarity.

    Only target_chapter_range is written. bound_chapter is left alone — it
    means "actually triggered in chapter N" and remains binder.py's job.
    """
    if not characters:
        return characters

    total = planned_total(novel_outline)
    arc = _mc_arc(novel_outline)
    milestones = _milestone_ranges(arc)

    for char in characters:
        curve = char.get("growth_curve") or {}
        stages = [s for s in (curve.get("stages") or []) if isinstance(s, dict)]

        if not stages and char.get("character_type") == "protagonist" and arc:
            stages = _synthesize_protagonist_stages(arc)
            char["growth_curve"] = {
                "curve_description": curve.get("curve_description", ""),
                "stages": stages,
            }
            logger.info(
                "Synthesized growth curve for protagonist '%s' from mc_growth_arc: "
                "%d stages", char.get("name", "unknown"), len(stages),
            )

        if not stages:
            continue

        ordered = sorted(stages, key=lambda s: s.get("stage_number", 0))
        for stage, (start, end) in zip(
            ordered, _map_stage_ranges(len(ordered), milestones, total)
        ):
            stage["target_chapter_range"] = f"{start}-{end}"

    return characters