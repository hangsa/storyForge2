"""STAGE 3 growth curve auto-generation — creates GrowthStage entries for characters without curves."""

import logging

from backend.growth_curve.binder import TRIGGER_KEYWORDS

logger = logging.getLogger(__name__)

EVENT_TYPE_STAGE_NAMES: dict[str, str] = {
    "betrayal_experienced": "背叛经历",
    "death_of_loved_one": "至亲之死",
    "world_truth_revealed": "真相揭示",
    "personal_identity_crisis": "身份危机",
    "irreversible_loss": "不可逆损失",
    "moral_awakening": "道德觉醒",
    "accumulated_evidence": "证据积累",
    "relationship_transformation": "关系转变",
}


def _match_event_in_changes(event_type: str, registry_changes: dict) -> bool:
    keywords = TRIGGER_KEYWORDS.get(event_type, [])
    if not keywords:
        return False
    for item in registry_changes.get("created", []):
        desc = item.get("description", "")
        if any(kw in desc for kw in keywords):
            return True
    for item in registry_changes.get("updated", []):
        text = f"{item.get('field', '')} {item.get('new_value', '')}"
        if any(kw in text for kw in keywords):
            return True
    return False


def _extract_description(registry_changes: dict, event_type: str) -> str:
    keywords = TRIGGER_KEYWORDS.get(event_type, [])
    for item in registry_changes.get("created", []):
        desc = item.get("description", "")
        if any(kw in desc for kw in keywords):
            return desc
    for item in registry_changes.get("updated", []):
        text = f"{item.get('field', '')} {item.get('new_value', '')}"
        if any(kw in text for kw in keywords):
            return text
    return ""


def _select_narrative_events(
    sorted_events: list[str],
    event_index: dict[str, list[tuple[int, int, str]]],
    max_stages: int = 5,
    min_stages: int = 3,
) -> list[str]:
    """Select event types spread across early/mid/late chapters for a balanced arc."""
    if len(sorted_events) <= min_stages:
        return sorted_events
    if len(sorted_events) <= max_stages:
        return sorted_events

    total_chapters = max(event_index[et][-1][0] for et in sorted_events)
    if total_chapters <= 1:
        return sorted_events[:max_stages]

    early_threshold = max(1, total_chapters // 3)
    late_threshold = max(early_threshold + 1, 2 * total_chapters // 3)

    early_events = [et for et in sorted_events if event_index[et][0][0] <= early_threshold]
    mid_events = [
        et for et in sorted_events
        if early_threshold < event_index[et][0][0] <= late_threshold
    ]
    late_events = [et for et in sorted_events if event_index[et][0][0] > late_threshold]

    selected: list[str] = []
    selected.extend(early_events[:2])
    selected.extend(mid_events[:2])
    selected.extend(late_events[:1])

    remaining = [et for et in sorted_events if et not in selected]
    while len(selected) < min_stages and remaining:
        selected.append(remaining.pop(0))

    return selected[:max_stages]


def auto_generate_growth_curves(characters: list[dict], outline: dict) -> list[dict]:
    """Generate GrowthStage entries for core characters without growth_curve.

    Analyzes outline scene_plan registry_changes to find narrative events
    matching the 8 GrowthEventTypes. For each core character lacking a
    growth_curve, generates 3-5 stages spread across the narrative arc.

    Characters with existing growth_curve are left unchanged.
    """
    chapters = outline.get("chapters", [])
    if not chapters:
        return characters

    # Build event-type → [(chapter, scene, description)] index
    event_index: dict[str, list[tuple[int, int, str]]] = {}
    for chapter in chapters:
        cn = chapter.get("chapter_number", 0)
        for scene in chapter.get("scene_plan", []):
            sn = scene.get("scene_number", 0)
            rc = scene.get("registry_changes", {})
            for event_type in TRIGGER_KEYWORDS:
                if _match_event_in_changes(event_type, rc):
                    desc = _extract_description(rc, event_type)
                    event_index.setdefault(event_type, []).append((cn, sn, desc))

    if not event_index:
        return characters

    sorted_events = sorted(event_index.keys(), key=lambda et: event_index[et][0][0])

    for char in characters:
        if not char.get("is_core_character", False):
            continue
        if char.get("growth_curve"):
            continue

        selected = _select_narrative_events(sorted_events, event_index)
        if not selected:
            continue

        stages = []
        for i, event_type in enumerate(selected):
            occurrences = event_index[event_type]
            first_chapter = occurrences[0][0]
            last_chapter = max(oc[0] for oc in occurrences)

            stages.append({
                "stage_number": i + 1,
                "stage_name": EVENT_TYPE_STAGE_NAMES.get(event_type, event_type),
                "trigger_event_type": event_type,
                "trigger_event_description": occurrences[0][2],
                "character_change": "",
                "target_chapter_range": (
                    f"{first_chapter}-{last_chapter}"
                    if last_chapter > first_chapter
                    else str(first_chapter)
                ),
                "bound_chapter": None,
            })

        char["growth_curve"] = {
            "curve_description": "",
            "stages": stages,
        }
        logger.info(
            "Auto-generated growth curve for '%s': %d stages",
            char.get("name", "unknown"), len(stages),
        )

    return characters
