"""STAGE 4 growth context rendering — per-character growth stage for Writer prompts."""
import logging

logger = logging.getLogger(__name__)


def _parse_target_range(range_str: str) -> tuple[int, int]:
    """Parse '3-5' into (3, 5). Returns (0, 999) on failure."""
    try:
        parts = range_str.split("-")
        if len(parts) == 2:
            return int(parts[0].strip()), int(parts[1].strip())
    except (ValueError, AttributeError):
        pass
    return 0, 999


def compute_character_growth_context(characters: list[dict], chapter_number: int) -> str:
    """Build per-character growth context string for the current chapter.

    Args:
        characters: List of character dicts with optional growth_curve
        chapter_number: Current chapter being written

    Returns:
        Formatted context string, or "" if no characters have growth_curves
    """
    has_growth_curves = any(c.get("growth_curve") for c in characters)
    if not has_growth_curves:
        return ""

    lines = []
    for char in characters:
        gc = char.get("growth_curve")
        if gc is None:
            continue

        name = char.get("name", "未知角色")

        active_stages = []
        upcoming_stage = None

        for stage in gc.get("stages", []):
            target_range = stage.get("target_chapter_range", "")
            start, end = _parse_target_range(target_range)

            if start <= chapter_number <= end:
                active_stages.append(stage)
            elif chapter_number < start:
                if upcoming_stage is None:
                    upcoming_stage = stage
                else:
                    us_start, _ = _parse_target_range(upcoming_stage.get("target_chapter_range", ""))
                    if start < us_start:
                        upcoming_stage = stage

        for stage in active_stages:
            triggered = (
                stage.get("bound_chapter") is not None
                and stage["bound_chapter"] <= chapter_number
            )
            tag = "【已触发】" if triggered else "【待触发】"
            lines.append(f"- {name}: {stage['stage_name']} {tag}")
            lines.append(f"  阶段变化: {stage['character_change']}")
            if stage.get("bound_chapter"):
                lines.append(f"  触发章节: 第{stage['bound_chapter']}章")
            lines.append(f"  触发事件: {stage['trigger_event_description']}")

        if not active_stages and upcoming_stage:
            lines.append(
                f"- {name}: 即将进入「{upcoming_stage['stage_name']}」阶段"
                f"（第{upcoming_stage.get('target_chapter_range', '?')}章）"
            )
            lines.append(f"  前置变化: {upcoming_stage['character_change']}")

    if not lines:
        return ""

    return "【角色成长态势（第" + str(chapter_number) + "章）】\n" + "\n".join(lines)
