"""STAGE 3 growth curve binding — matches trigger_event_type to scene registry_changes."""
import logging

logger = logging.getLogger(__name__)

# Keyword mapping for GrowthEventType → Chinese trigger keywords
TRIGGER_KEYWORDS: dict[str, list[str]] = {
    "betrayal_experienced": ["背叛", "出卖", "叛变", "背弃", "倒戈"],
    "death_of_loved_one": ["死亡", "牺牲", "离世", "去世", "死去", "阵亡"],
    "world_truth_revealed": ["真相", "揭露", "揭晓", "秘密浮出", "水落石出", "发现真相"],
    "personal_identity_crisis": ["身份危机", "认同危机", "我是谁", "自我怀疑", "身份动摇", "身世"],
    "irreversible_loss": ["失去", "丧失", "不可逆转", "无法挽回", "永远失去", "化为乌有"],
    "moral_awakening": ["道德觉醒", "良知", "顿悟", "醒悟", "幡然", "悔悟"],
    "accumulated_evidence": ["证据", "线索汇集", "拼图完整", "查出", "查明"],
    "relationship_transformation": ["关系转变", "关系变化", "感情升级", "情感转折", "和解"],
}


def _match_trigger_in_registry_changes(event_type: str, registry_changes: dict) -> bool:
    """Check if any registry_changes item matches the trigger event type."""
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


def bind_growth_curve_to_outline(characters: list[dict], outline: dict) -> list[dict]:
    """Match each unbound GrowthStage to a chapter via scene registry_changes.

    Args:
        characters: List of character dicts with optional growth_curve field
        outline: Outline dict with chapters list, each with scene_plan

    Returns:
        The character list (mutated in-place, returned for clarity)
    """
    chapters = outline.get("chapters", [])
    if not chapters:
        return characters

    for char in characters:
        gc = char.get("growth_curve")
        if gc is None:
            continue

        for stage in gc.get("stages", []):
            if stage.get("bound_chapter") is not None:
                continue  # already bound

            event_type = stage.get("trigger_event_type", "")
            for chapter in chapters:
                for scene in chapter.get("scene_plan", []):
                    registry_changes = scene.get("registry_changes", {})
                    if _match_trigger_in_registry_changes(event_type, registry_changes):
                        stage["bound_chapter"] = chapter.get("chapter_number")
                        logger.debug(
                            "Bound stage '%s' of '%s' to chapter %d via '%s'",
                            stage.get("stage_name"), char.get("name"),
                            stage["bound_chapter"], event_type,
                        )
                        break
                if stage.get("bound_chapter") is not None:
                    break

    return characters
