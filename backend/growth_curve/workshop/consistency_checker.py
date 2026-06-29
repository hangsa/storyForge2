# backend/growth_curve/workshop/consistency_checker.py
from datetime import datetime, timezone
from backend.growth_curve.binder import TRIGGER_KEYWORDS, _match_trigger_in_registry_changes
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

    for i in range(len(stages) - 1):
        curr, nxt = stages[i], stages[i + 1]
        if curr.bound_chapter is None or nxt.bound_chapter is None:
            continue
        gap = nxt.bound_chapter - curr.bound_chapter
        if gap < 2:
            warnings.append(ConsistencyWarning(
                rule_id="tight_spacing", severity="warning",
                stage_index=i + 1, chapter_number=nxt.bound_chapter,
                message=f"第 {curr.bound_chapter} → {nxt.bound_chapter} 章间隔仅 {gap} 章",
                suggestion="拉大到 ≥ 2 章",
            ))

    for idx, stage in enumerate(stages):
        if stage.bound_chapter is None or not _event_type_value(stage):
            continue
        matching = [
            ch for ch in outline_chapters
            if ch.get("chapter_number") == stage.bound_chapter
        ]
        if not matching:
            continue
        registry_changes = matching[0].get("registry_changes", {})
        if not _match_trigger_in_registry_changes(_event_type_value(stage), registry_changes):
            warnings.append(ConsistencyWarning(
                rule_id="missing_event", severity="warning",
                stage_index=idx, chapter_number=stage.bound_chapter,
                message=f"第 {stage.bound_chapter} 章 outline 中无匹配的 {_event_type_value(stage)} 事件",
                suggestion="在大纲该章补一个对应 registry_create 日志",
            ))

    return WorkshopCheckResult(
        character_id=character_id,
        warnings=warnings,
        checked_at=datetime.now(timezone.utc).isoformat(),
    )
