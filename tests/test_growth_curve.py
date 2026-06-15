"""Tests for TRD 4.1 character growth curve (models, binder, context)."""
import pytest
from backend.models.character import (
    Character,
    GrowthEventType,
    GrowthStage,
    GrowthCurve,
)


class TestGrowthStageModel:
    def test_growth_stage_defaults(self):
        stage = GrowthStage()
        assert stage.stage_number == 1
        assert stage.stage_name == ""
        assert stage.bound_chapter is None

    def test_growth_stage_serialization(self):
        stage = GrowthStage(
            stage_number=2,
            stage_name="觉醒",
            trigger_event_type=GrowthEventType.WORLD_TRUTH_REVEALED,
            trigger_event_description="发现世界真相",
            character_change="信念动摇",
            target_chapter_range="4-6",
            bound_chapter=5,
        )
        d = stage.model_dump()
        assert d["stage_name"] == "觉醒"
        assert d["trigger_event_type"] == "world_truth_revealed"
        assert d["bound_chapter"] == 5

    def test_growth_event_type_invalid_rejected(self):
        with pytest.raises(ValueError):
            GrowthStage(trigger_event_type="invalid_type")  # type: ignore


class TestGrowthCurveModel:
    def test_curve_defaults(self):
        curve = GrowthCurve()
        assert curve.curve_description == ""
        assert curve.stages == []

    def test_curve_with_stages(self):
        curve = GrowthCurve(
            curve_description="从弱到强",
            stages=[
                GrowthStage(stage_number=1, stage_name="起点"),
                GrowthStage(stage_number=2, stage_name="转折"),
            ],
        )
        assert len(curve.stages) == 2

    def test_character_null_growth_curve(self):
        c = Character(id="c1", name="测试")
        assert c.growth_curve is None

    def test_character_with_growth_curve(self):
        c = Character(
            id="c1",
            name="主角",
            growth_curve=GrowthCurve(
                curve_description="成长弧线",
                stages=[GrowthStage(stage_number=1, stage_name="起点")],
            ),
        )
        assert c.growth_curve is not None
        assert len(c.growth_curve.stages) == 1

    def test_old_character_data_no_growth_curve_key(self):
        """Backward compat: old JSON without growth_curve key loads as None."""
        data = {"id": "c1", "name": "老角色"}
        c = Character.model_validate(data)
        assert c.growth_curve is None


class TestGrowthCurveBinder:
    def test_bind_by_created_asset_description(self):
        characters = [
            {
                "name": "林峰",
                "growth_curve": {
                    "curve_description": "觉醒弧线",
                    "stages": [
                        {
                            "stage_number": 1,
                            "stage_name": "觉醒",
                            "trigger_event_type": "world_truth_revealed",
                            "trigger_event_description": "发现真相",
                            "character_change": "",
                            "target_chapter_range": "1-3",
                            "bound_chapter": None,
                        }
                    ],
                },
            }
        ]
        outline = {
            "chapters": [
                {
                    "chapter_number": 2,
                    "scene_plan": [
                        {
                            "scene_number": 1,
                            "registry_changes": {
                                "created": [
                                    {
                                        "type": "reveal",
                                        "id_pattern": "rev_001",
                                        "description": "揭示世界真相",
                                    }
                                ],
                                "updated": [],
                            },
                        }
                    ],
                }
            ]
        }
        from backend.growth_curve.binder import bind_growth_curve_to_outline
        result = bind_growth_curve_to_outline(characters, outline)
        assert result[0]["growth_curve"]["stages"][0]["bound_chapter"] == 2

    def test_bind_by_updated_field(self):
        characters = [
            {
                "name": "林峰",
                "growth_curve": {
                    "curve_description": "",
                    "stages": [
                        {
                            "stage_number": 1,
                            "stage_name": "失去",
                            "trigger_event_type": "irreversible_loss",
                            "trigger_event_description": "",
                            "character_change": "",
                            "target_chapter_range": "",
                            "bound_chapter": None,
                        }
                    ],
                },
            }
        ]
        outline = {
            "chapters": [
                {
                    "chapter_number": 3,
                    "scene_plan": [
                        {
                            "scene_number": 1,
                            "registry_changes": {
                                "created": [],
                                "updated": [
                                    {"asset_id": "c1", "field": "status", "new_value": "永远失去一切"}
                                ],
                            },
                        }
                    ],
                }
            ]
        }
        from backend.growth_curve.binder import bind_growth_curve_to_outline
        result = bind_growth_curve_to_outline(characters, outline)
        assert result[0]["growth_curve"]["stages"][0]["bound_chapter"] == 3

    def test_skip_already_bound_stages(self):
        characters = [
            {
                "name": "林峰",
                "growth_curve": {
                    "curve_description": "",
                    "stages": [
                        {
                            "stage_number": 1,
                            "stage_name": "已绑定阶段",
                            "trigger_event_type": "betrayal_experienced",
                            "bound_chapter": 1,
                        }
                    ],
                },
            }
        ]
        outline = {
            "chapters": [
                {
                    "chapter_number": 5,
                    "scene_plan": [
                        {
                            "scene_number": 1,
                            "registry_changes": {
                                "created": [
                                    {"type": "conflict", "id_pattern": "c2", "description": "遭遇背叛"}
                                ],
                                "updated": [],
                            },
                        }
                    ],
                }
            ]
        }
        from backend.growth_curve.binder import bind_growth_curve_to_outline
        result = bind_growth_curve_to_outline(characters, outline)
        assert result[0]["growth_curve"]["stages"][0]["bound_chapter"] == 1

    def test_null_growth_curve_skipped(self):
        characters = [{"name": "配角", "growth_curve": None}]
        outline = {"chapters": []}
        from backend.growth_curve.binder import bind_growth_curve_to_outline
        result = bind_growth_curve_to_outline(characters, outline)
        assert result[0]["growth_curve"] is None

    def test_no_ambiguous_keywords_across_trigger_types(self):
        """Each Chinese keyword should belong to exactly one trigger type."""
        from backend.growth_curve.binder import TRIGGER_KEYWORDS
        seen: dict[str, str] = {}
        for event_type, keywords in TRIGGER_KEYWORDS.items():
            for kw in keywords:
                assert kw not in seen, (
                    f"Ambiguous keyword '{kw}' found in both"
                    f" '{seen[kw]}' and '{event_type}'"
                )
                seen[kw] = event_type


class TestGrowthContext:
    def test_empty_when_no_growth_curves(self):
        from backend.growth_curve.context import compute_character_growth_context
        result = compute_character_growth_context(
            [{"name": "林峰", "growth_curve": None}], 3
        )
        assert result == ""

    def test_active_stage_with_trigger(self):
        from backend.growth_curve.context import compute_character_growth_context
        characters = [
            {
                "name": "林峰",
                "growth_curve": {
                    "curve_description": "",
                    "stages": [
                        {
                            "stage_number": 1,
                            "stage_name": "觉醒",
                            "trigger_event_type": "world_truth_revealed",
                            "trigger_event_description": "发现世界真相",
                            "character_change": "从无知到觉醒",
                            "target_chapter_range": "1-3",
                            "bound_chapter": 2,
                        }
                    ],
                },
            }
        ]
        result = compute_character_growth_context(characters, 3)
        assert "林峰" in result
        assert "觉醒" in result
        assert "【已触发】" in result
        assert "发现世界真相" in result

    def test_pending_stage_not_yet_triggered(self):
        from backend.growth_curve.context import compute_character_growth_context
        characters = [
            {
                "name": "苏晓晓",
                "growth_curve": {
                    "curve_description": "",
                    "stages": [
                        {
                            "stage_number": 1,
                            "stage_name": "转折",
                            "trigger_event_type": "betrayal_experienced",
                            "trigger_event_description": "被同伴背叛",
                            "character_change": "信任崩塌",
                            "target_chapter_range": "3-5",
                            "bound_chapter": None,
                        }
                    ],
                },
            }
        ]
        result = compute_character_growth_context(characters, 3)
        assert "苏晓晓" in result
        assert "转折" in result
        assert "【待触发】" in result

    def test_upcoming_stage_before_any_range(self):
        from backend.growth_curve.context import compute_character_growth_context
        characters = [
            {
                "name": "路人",
                "growth_curve": {
                    "curve_description": "",
                    "stages": [
                        {
                            "stage_number": 1,
                            "stage_name": "觉醒",
                            "target_chapter_range": "10-12",
                            "trigger_event_type": "moral_awakening",
                            "trigger_event_description": "幡然醒悟",
                            "character_change": "改变",
                        }
                    ],
                },
            }
        ]
        result = compute_character_growth_context(characters, 3)
        assert "即将进入" in result
        assert "觉醒" in result

    def test_multiple_characters_context(self):
        from backend.growth_curve.context import compute_character_growth_context
        characters = [
            {
                "name": "林峰",
                "growth_curve": {
                    "curve_description": "",
                    "stages": [
                        {
                            "stage_number": 1,
                            "stage_name": "成长",
                            "target_chapter_range": "1-3",
                            "trigger_event_type": "betrayal_experienced",
                            "trigger_event_description": "",
                            "character_change": "",
                        }
                    ],
                },
            },
            {
                "name": "苏晓晓",
                "growth_curve": {
                    "curve_description": "",
                    "stages": [
                        {
                            "stage_number": 1,
                            "stage_name": "独立",
                            "target_chapter_range": "2-4",
                            "trigger_event_type": "personal_identity_crisis",
                            "trigger_event_description": "",
                            "character_change": "",
                        }
                    ],
                },
            },
        ]
        result = compute_character_growth_context(characters, 2)
        assert "林峰" in result
        assert "苏晓晓" in result

    def test_parse_target_range_empty_string_returns_sentinel(self):
        from backend.growth_curve.context import _parse_target_range, _RANGE_SENTINEL
        assert _parse_target_range("") == _RANGE_SENTINEL

    def test_parse_target_range_malformed_returns_sentinel(self):
        from backend.growth_curve.context import _parse_target_range, _RANGE_SENTINEL
        assert _parse_target_range("not-a-range") == _RANGE_SENTINEL
        assert _parse_target_range("abc-def") == _RANGE_SENTINEL

    def test_malformed_range_skipped_in_context(self):
        from backend.growth_curve.context import compute_character_growth_context
        characters = [
            {
                "name": "测试角色",
                "growth_curve": {
                    "curve_description": "",
                    "stages": [
                        {
                            "stage_number": 1,
                            "stage_name": "无效阶段",
                            "target_chapter_range": "",
                            "trigger_event_type": "betrayal_experienced",
                            "trigger_event_description": "不会出现",
                            "character_change": "不应该显示",
                        }
                    ],
                },
            }
        ]
        result = compute_character_growth_context(characters, 3)
        assert "无效阶段" not in result
