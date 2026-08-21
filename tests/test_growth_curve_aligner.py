"""Tests for backend/growth_curve/aligner.py — volume-authoritative growth ranges."""
import copy

import pytest

from backend.growth_curve.aligner import align_growth_curves

NOVEL_OUTLINE = {
    "volumes": [
        {"name": "第一卷", "chapter_range": "1-50", "summary": "", "key_events": []},
        {"name": "第二卷", "chapter_range": "51-120", "summary": "", "key_events": []},
    ],
    "mc_growth_arc": [
        {"label": "起点", "target_chapter_range": "1-20", "description": "出身底层"},
        {"label": "觉醒", "target_chapter_range": "21-60", "description": "能力觉醒"},
        {"label": "背叛", "target_chapter_range": "61-100", "description": "遭师门背叛"},
        {"label": "登顶", "target_chapter_range": "101-120", "description": "问鼎"},
    ],
}


def _stage(number, name="阶段", event_type="moral_awakening", rng="9-9"):
    return {
        "stage_number": number,
        "stage_name": name,
        "trigger_event_type": event_type,
        "trigger_event_description": "描述",
        "character_change": "变化",
        "target_chapter_range": rng,
        "bound_chapter": None,
    }


def _char(name, stages=None, character_type="supporting", with_curve=True):
    char = {"id": name, "name": name, "character_type": character_type,
            "is_core_character": character_type == "protagonist"}
    if with_curve:
        char["growth_curve"] = {"curve_description": "", "stages": stages or []}
    return char


class TestRangeMapping:
    def test_equal_counts_map_one_to_one(self):
        chars = [_char("甲", [_stage(i) for i in range(1, 5)])]
        align_growth_curves(chars, NOVEL_OUTLINE)
        ranges = [s["target_chapter_range"] for s in chars[0]["growth_curve"]["stages"]]
        assert ranges == ["1-20", "21-60", "61-100", "101-120"]

    def test_fewer_stages_than_milestones_spread_across_arc(self):
        chars = [_char("甲", [_stage(i) for i in range(1, 3)])]
        align_growth_curves(chars, NOVEL_OUTLINE)
        ranges = [s["target_chapter_range"] for s in chars[0]["growth_curve"]["stages"]]
        assert ranges == ["1-20", "101-120"]

    def test_more_stages_than_milestones_is_monotonic(self):
        chars = [_char("甲", [_stage(i) for i in range(1, 7)])]
        align_growth_curves(chars, NOVEL_OUTLINE)
        starts = [
            int(s["target_chapter_range"].split("-")[0])
            for s in chars[0]["growth_curve"]["stages"]
        ]
        assert starts == sorted(starts)

    def test_single_stage_takes_first_milestone(self):
        chars = [_char("甲", [_stage(1)])]
        align_growth_curves(chars, NOVEL_OUTLINE)
        assert chars[0]["growth_curve"]["stages"][0]["target_chapter_range"] == "1-20"

    def test_stages_sorted_by_stage_number_before_mapping(self):
        chars = [_char("甲", [_stage(2, "第二"), _stage(1, "第一")])]
        align_growth_curves(chars, NOVEL_OUTLINE)
        by_name = {s["stage_name"]: s["target_chapter_range"]
                   for s in chars[0]["growth_curve"]["stages"]}
        assert by_name["第一"] == "1-20"
        assert by_name["第二"] == "101-120"

    def test_bare_number_milestone_range_accepted(self):
        outline = {"volumes": NOVEL_OUTLINE["volumes"],
                   "mc_growth_arc": [{"label": "x", "target_chapter_range": "7"}]}
        chars = [_char("甲", [_stage(1)])]
        align_growth_curves(chars, outline)
        assert chars[0]["growth_curve"]["stages"][0]["target_chapter_range"] == "7-7"

    def test_ranges_clamped_to_planned_total(self):
        outline = {"volumes": [{"name": "一", "chapter_range": "1-30"}],
                   "mc_growth_arc": [{"label": "x", "target_chapter_range": "1-999"}]}
        chars = [_char("甲", [_stage(1)])]
        align_growth_curves(chars, outline)
        assert chars[0]["growth_curve"]["stages"][0]["target_chapter_range"] == "1-30"


class TestNoMilestones:
    def test_even_split_across_planned_total(self):
        outline = {"volumes": [{"name": "一", "chapter_range": "1-30"}], "mc_growth_arc": []}
        chars = [_char("甲", [_stage(i) for i in range(1, 4)])]
        align_growth_curves(chars, outline)
        ranges = [s["target_chapter_range"] for s in chars[0]["growth_curve"]["stages"]]
        assert ranges == ["1-10", "11-20", "21-30"]

    def test_no_volumes_still_produces_monotonic_ranges(self):
        chars = [_char("甲", [_stage(i) for i in range(1, 4)])]
        align_growth_curves(chars, {})
        ranges = [s["target_chapter_range"] for s in chars[0]["growth_curve"]["stages"]]
        assert ranges == ["1-1", "2-2", "3-3"]


class TestFieldPreservation:
    def test_only_target_chapter_range_is_written(self):
        stage = _stage(1, "背叛经历", "betrayal_experienced")
        stage["bound_chapter"] = 7
        chars = [_char("甲", [stage])]
        align_growth_curves(chars, NOVEL_OUTLINE)
        result = chars[0]["growth_curve"]["stages"][0]
        assert result["bound_chapter"] == 7
        assert result["stage_name"] == "背叛经历"
        assert result["trigger_event_type"] == "betrayal_experienced"
        assert result["character_change"] == "变化"
        assert result["trigger_event_description"] == "描述"

    def test_idempotent(self):
        chars = [_char("甲", [_stage(i) for i in range(1, 4)])]
        align_growth_curves(chars, NOVEL_OUTLINE)
        once = copy.deepcopy(chars)
        align_growth_curves(chars, NOVEL_OUTLINE)
        assert chars == once

    def test_character_without_curve_untouched(self):
        chars = [_char("乙", with_curve=False)]
        align_growth_curves(chars, NOVEL_OUTLINE)
        assert "growth_curve" not in chars[0]

    def test_empty_character_list(self):
        assert align_growth_curves([], NOVEL_OUTLINE) == []


class TestProtagonistSynthesis:
    def test_protagonist_without_curve_gets_one_from_mc_growth_arc(self):
        chars = [_char("主角", character_type="protagonist", with_curve=False)]
        align_growth_curves(chars, NOVEL_OUTLINE)
        stages = chars[0]["growth_curve"]["stages"]
        assert len(stages) == 4
        assert [s["stage_name"] for s in stages] == ["起点", "觉醒", "背叛", "登顶"]
        assert [s["target_chapter_range"] for s in stages] == [
            "1-20", "21-60", "61-100", "101-120",
        ]
        assert all(s["character_change"] == "" for s in stages)
        assert all(s["bound_chapter"] is None for s in stages)

    def test_synthesized_trigger_type_from_keyword_match(self):
        chars = [_char("主角", character_type="protagonist", with_curve=False)]
        align_growth_curves(chars, NOVEL_OUTLINE)
        stages = chars[0]["growth_curve"]["stages"]
        assert stages[2]["trigger_event_type"] == "betrayal_experienced"  # "遭师门背叛"

    def test_synthesized_trigger_type_omitted_when_no_keyword_matches(self):
        """No event type is better than a wrong one: binder reads "" and never
        binds, which is the intended silent degradation."""
        chars = [_char("主角", character_type="protagonist", with_curve=False)]
        align_growth_curves(chars, NOVEL_OUTLINE)
        assert "trigger_event_type" not in chars[0]["growth_curve"]["stages"][3]  # "登顶"

    def test_non_protagonist_without_curve_is_not_synthesized(self):
        """Giving an antagonist the protagonist's growth beats is fabrication."""
        chars = [_char("反派", character_type="antagonist", with_curve=False)]
        align_growth_curves(chars, NOVEL_OUTLINE)
        assert "growth_curve" not in chars[0]

    def test_protagonist_with_existing_stages_is_not_synthesized(self):
        chars = [_char("主角", [_stage(1, "自定义")], character_type="protagonist")]
        align_growth_curves(chars, NOVEL_OUTLINE)
        stages = chars[0]["growth_curve"]["stages"]
        assert len(stages) == 1
        assert stages[0]["stage_name"] == "自定义"

    def test_protagonist_without_mc_growth_arc_is_not_synthesized(self):
        chars = [_char("主角", character_type="protagonist", with_curve=False)]
        align_growth_curves(chars, {"volumes": NOVEL_OUTLINE["volumes"]})
        assert "growth_curve" not in chars[0]