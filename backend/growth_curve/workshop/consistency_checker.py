# backend/growth_curve/workshop/consistency_checker.py
from datetime import datetime, timezone
from backend.growth_curve.binder import TRIGGER_KEYWORDS
from backend.growth_curve.workshop.models import ConsistencyWarning, WorkshopCheckResult
from backend.models.character import GrowthStage


_VALID_EVENT_TYPES = set(TRIGGER_KEYWORDS.keys())


def _event_type_value(stage: GrowthStage) -> str:
    """Extract string value from trigger_event_type (handles Enum and raw string)."""
    tet = stage.trigger_event_type
    return tet.value if hasattr(tet, "value") else str(tet)


def check_growth_consistency(
    *,
    character_id: str,
    stages: list[GrowthStage],
    total_chapters: int,
    conflicts: list[dict],
    outline_chapters: list[dict],
) -> WorkshopCheckResult:
    warnings: list[ConsistencyWarning] = []

    for idx, stage in enumerate(stages):
        ch = stage.bound_chapter
        if ch is not None and ch > total_chapters:
            warnings.append(ConsistencyWarning(
                rule_id="out_of_range", severity="error",
                stage_index=idx, chapter_number=ch,
                message=f"第 {ch} 章超出大纲范围（共 {total_chapters} 章）",
                suggestion=f"调整到 ≤ {total_chapters}",
            ))
        if _event_type_value(stage) not in _VALID_EVENT_TYPES:
            warnings.append(ConsistencyWarning(
                rule_id="invalid_event_type", severity="error",
                stage_index=idx,
                message=f"事件类型 {_event_type_value(stage)!r} 不在 8 类白名单内",
            ))

    # Subsequent rules will be added in Tasks 3, 4, 5.

    return WorkshopCheckResult(
        character_id=character_id,
        warnings=warnings,
        checked_at=datetime.now(timezone.utc).isoformat(),
    )