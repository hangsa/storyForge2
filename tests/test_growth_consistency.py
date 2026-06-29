# tests/test_growth_consistency.py
from backend.growth_curve.workshop.consistency_checker import check_growth_consistency
from backend.models.character import GrowthStage, GrowthEventType


def _stages_with_chapters(chapters):
    return [
        GrowthStage(stage_number=i + 1, stage_name="阶段", bound_chapter=ch,
                    trigger_event_type=GrowthEventType.BETRAYAL_EXPERIENCED)
        for i, ch in enumerate(chapters)
    ]


def test_out_of_range_triggers_error():
    stages = _stages_with_chapters([3, 5, 50])
    result = check_growth_consistency(
        character_id="c1", stages=stages, total_chapters=20, conflicts=[], outline_chapters=[],
    )
    out_of_range = [w for w in result.warnings if w.rule_id == "out_of_range"]
    assert len(out_of_range) == 1
    assert out_of_range[0].severity == "error"
    assert out_of_range[0].chapter_number == 50


def test_invalid_event_type_triggers_error():
    # Use model_construct to inject a non-enum value (defends against legacy
    # JSON files containing stale enum values from a future schema change).
    stale_stage = GrowthStage.model_construct(
        stage_number=1, stage_name="阶段", bound_chapter=3,
        trigger_event_type="unknown_event",
    )
    result = check_growth_consistency(
        character_id="c1", stages=[stale_stage], total_chapters=20,
        conflicts=[], outline_chapters=[],
    )
    invalid = [w for w in result.warnings if w.rule_id == "invalid_event_type"]
    assert len(invalid) == 1
    assert invalid[0].severity == "error"
    assert invalid[0].stage_index == 0