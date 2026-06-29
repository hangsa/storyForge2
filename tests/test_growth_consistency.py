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


def test_tight_spacing_triggers_warning():
    stages = _stages_with_chapters([3, 4, 10])
    result = check_growth_consistency(
        character_id="c1", stages=stages, total_chapters=20, conflicts=[], outline_chapters=[],
    )
    tight = [w for w in result.warnings if w.rule_id == "tight_spacing"]
    assert len(tight) == 1
    assert tight[0].stage_index == 1
    assert tight[0].severity == "warning"
    assert tight[0].chapter_number == 4


def test_tight_spacing_ignores_none_chapters():
    stages = [
        GrowthStage(stage_number=1, stage_name="a", bound_chapter=3,
                    trigger_event_type=GrowthEventType.BETRAYAL_EXPERIENCED),
        GrowthStage(stage_number=2, stage_name="b", bound_chapter=None,
                    trigger_event_type=GrowthEventType.BETRAYAL_EXPERIENCED),
    ]
    result = check_growth_consistency(
        character_id="c1", stages=stages, total_chapters=20, conflicts=[], outline_chapters=[],
    )
    tight = [w for w in result.warnings if w.rule_id == "tight_spacing"]
    assert tight == []


def test_missing_event_triggers_warning_when_no_chapter_match():
    stages = [
        GrowthStage(stage_number=1, stage_name="转折", bound_chapter=5,
                    trigger_event_type=GrowthEventType.BETRAYAL_EXPERIENCED),
    ]
    outline = [{"chapter_number": 5, "registry_changes": {"created": [], "updated": []}}]
    result = check_growth_consistency(
        character_id="c1", stages=stages, total_chapters=20,
        conflicts=[], outline_chapters=outline,
    )
    missing = [w for w in result.warnings if w.rule_id == "missing_event"]
    assert len(missing) == 1
    assert missing[0].stage_index == 0
    assert missing[0].severity == "warning"


def test_missing_event_passes_when_binder_matches():
    outline = [{
        "chapter_number": 5,
        "registry_changes": {"created": [{"type": "conflict", "description": "主角遭遇背叛"}]},
    }]
    # Sanity: confirm the binder would match
    from backend.growth_curve.binder import _match_trigger_in_registry_changes
    assert _match_trigger_in_registry_changes(
        GrowthEventType.BETRAYAL_EXPERIENCED.value, outline[0]["registry_changes"]
    )
    stages = [
        GrowthStage(stage_number=1, stage_name="转折", bound_chapter=5,
                    trigger_event_type=GrowthEventType.BETRAYAL_EXPERIENCED),
    ]
    result = check_growth_consistency(
        character_id="c1", stages=stages, total_chapters=20,
        conflicts=[], outline_chapters=outline,
    )
    missing = [w for w in result.warnings if w.rule_id == "missing_event"]
    assert missing == []


def test_low_misaligned_triggers_when_low_has_no_high_conflict():
    stages = [
        GrowthStage(stage_number=1, stage_name="低谷", bound_chapter=12,
                    trigger_event_type=GrowthEventType.IRREVERSIBLE_LOSS),
    ]
    conflicts = [
        {"created_chapter": 12, "intensity": "low"},
        {"created_chapter": 12, "intensity": "medium"},
    ]
    result = check_growth_consistency(
        character_id="c1", stages=stages, total_chapters=20,
        conflicts=conflicts, outline_chapters=[],
    )
    misaligned = [w for w in result.warnings if w.rule_id == "low_misaligned"]
    assert len(misaligned) == 1
    assert misaligned[0].severity == "warning"


def test_low_misaligned_passes_with_critical_conflict():
    stages = [
        GrowthStage(stage_number=1, stage_name="低谷", bound_chapter=12,
                    trigger_event_type=GrowthEventType.IRREVERSIBLE_LOSS),
    ]
    conflicts = [{"created_chapter": 12, "intensity": "critical"}]
    result = check_growth_consistency(
        character_id="c1", stages=stages, total_chapters=20,
        conflicts=conflicts, outline_chapters=[],
    )
    misaligned = [w for w in result.warnings if w.rule_id == "low_misaligned"]
    assert misaligned == []


def test_low_misaligned_ignores_non_low_stages():
    stages = [
        GrowthStage(stage_number=1, stage_name="起点", bound_chapter=12,
                    trigger_event_type=GrowthEventType.BETRAYAL_EXPERIENCED),
    ]
    conflicts = []
    result = check_growth_consistency(
        character_id="c1", stages=stages, total_chapters=20,
        conflicts=conflicts, outline_chapters=[],
    )
    misaligned = [w for w in result.warnings if w.rule_id == "low_misaligned"]
    assert misaligned == []
