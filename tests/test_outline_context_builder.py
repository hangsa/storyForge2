"""Tests for backend/outline_context/builder.py — prompt text rendering."""
import json

import pytest

from backend.outline_context.builder import (
    build_recent_chapters_context,
    build_volume_context,
)
from backend.outline_context.volumes import locate_volume, parse_volumes

NOVEL_OUTLINE = {
    "core_conflict_theme": "底层少年逆袭",
    "volumes": [
        {"name": "第一卷 崛起", "chapter_range": "1-50",
         "summary": "觉醒与初战", "key_events": ["金手指开启", "首次杀人"]},
        {"name": "第二卷 试炼", "chapter_range": "51-120",
         "summary": "宗门之争", "key_events": ["擂台赛"]},
        {"name": "第三卷 归墟", "chapter_range": "121-200",
         "summary": "直面真相", "key_events": ["师父身死"]},
    ],
    "mc_growth_arc": [
        {"label": "起点", "target_chapter_range": "1-20", "description": "出身底层"},
    ],
    "key_plot_points": [
        {"title": "上古遗物", "must_appear_in_volume": "第一卷 崛起",
         "description": "主角金手指来源", "trigger_chapter_hint": "约第 5 章"},
        {"title": "宗门覆灭", "must_appear_in_volume": "第二卷 试炼",
         "description": "全宗被屠", "trigger_chapter_hint": "约第 110 章"},
    ],
}


class TestBuildVolumeContext:
    def test_first_volume_has_no_previous_section(self):
        text = build_volume_context(NOVEL_OUTLINE, 10)
        assert "【上一卷" not in text
        assert "【当前卷·第一卷 崛起】" in text
        assert "【下一卷·第二卷 试炼】" in text

    def test_last_volume_has_no_next_section(self):
        text = build_volume_context(NOVEL_OUTLINE, 150)
        assert "【上一卷·第二卷 试炼】" in text
        assert "【当前卷·第三卷 归墟】" in text
        assert "【下一卷" not in text

    def test_middle_volume_has_both_neighbours(self):
        text = build_volume_context(NOVEL_OUTLINE, 75)
        assert "【上一卷·第一卷 崛起】" in text
        assert "【当前卷·第二卷 试炼】" in text
        assert "【下一卷·第三卷 归墟】" in text

    def test_core_conflict_always_injected(self):
        assert "底层少年逆袭" in build_volume_context(NOVEL_OUTLINE, 150)

    def test_current_volume_gets_key_events_neighbours_do_not(self):
        text = build_volume_context(NOVEL_OUTLINE, 75)
        assert "擂台赛" in text          # current volume's key_events
        assert "金手指开启" not in text  # previous volume gets summary only
        assert "师父身死" not in text    # next volume gets summary only

    def test_current_chapter_position_is_stated(self):
        text = build_volume_context(NOVEL_OUTLINE, 75)
        assert "第 51-120 章" in text
        assert "本章为第 75 章" in text

    def test_plot_points_filtered_to_current_volume(self):
        text = build_volume_context(NOVEL_OUTLINE, 10)
        assert "上古遗物" in text
        assert "宗门覆灭" not in text

    def test_plot_point_matches_short_volume_name(self):
        """must_appear_in_volume may be an abbreviation of the volume name."""
        outline = dict(NOVEL_OUTLINE, key_plot_points=[
            {"title": "上古遗物", "must_appear_in_volume": "第一卷",
             "description": "", "trigger_chapter_hint": ""},
        ])
        assert "上古遗物" in build_volume_context(outline, 10)

    def test_all_plot_points_injected_when_none_match_any_volume(self):
        """Systematically unusable must_appear_in_volume → inject everything
        rather than silently dropping the plot points."""
        outline = dict(NOVEL_OUTLINE, key_plot_points=[
            {"title": "甲", "must_appear_in_volume": "无法对应的卷名",
             "description": "", "trigger_chapter_hint": ""},
            {"title": "乙", "must_appear_in_volume": "",
             "description": "", "trigger_chapter_hint": ""},
        ])
        text = build_volume_context(outline, 10)
        assert "甲" in text and "乙" in text

    def test_empty_when_matching_works_but_current_volume_has_none(self):
        """Matching mechanism works (第二卷 matches) but chapter 10 is in
        第一卷, which owns no plot point → inject none."""
        outline = dict(NOVEL_OUTLINE, key_plot_points=[
            {"title": "宗门覆灭", "must_appear_in_volume": "第二卷 试炼",
             "description": "", "trigger_chapter_hint": ""},
        ])
        text = build_volume_context(outline, 10)
        assert "宗门覆灭" not in text
        assert "关键情节点" not in text

    def test_no_novel_outline_returns_placeholder(self):
        assert "暂无全书大纲" in build_volume_context(None, 1)
        assert "暂无全书大纲" in build_volume_context({}, 1)

    def test_unparseable_volumes_fall_back_to_full_dump(self):
        outline = {"core_conflict_theme": "主题", "volumes": [{"name": "x", "chapter_range": "坏"}]}
        text = build_volume_context(outline, 1)
        assert json.loads(text) == outline


class TestBuildRecentChaptersContext:
    @pytest.fixture
    def outline(self):
        return {"chapters": [
            {"chapter_number": n, "title": f"第{n}章标题", "theme": f"主题{n}",
             "scene_plan": [
                 {"scene_number": 1, "goal": "开场", "beat_type": "setup"},
                 {"scene_number": 2, "goal": f"悬念{n}", "beat_type": "cliffhanger"},
             ]}
            for n in range(1, 61)
        ]}

    @pytest.fixture
    def volumes(self):
        return parse_volumes(NOVEL_OUTLINE)

    def test_window_is_three_previous_chapters(self, outline, volumes):
        text = build_recent_chapters_context(outline, 40, locate_volume(40, volumes))
        assert "第 37-39 章" in text
        assert "第37章" in text and "第39章" in text
        assert "第36章" not in text
        assert "第40章" not in text

    def test_renders_title_theme_and_closing_scene(self, outline, volumes):
        text = build_recent_chapters_context(outline, 40, locate_volume(40, volumes))
        assert "《第39章标题》" in text
        assert "主题39" in text
        assert "悬念39" in text
        assert "cliffhanger" in text

    def test_window_clipped_at_volume_start(self, outline, volumes):
        """Chapter 52 is the second chapter of 第二卷 (51-120); looking back
        into 第一卷 duplicates the previous-volume summary."""
        text = build_recent_chapters_context(outline, 52, locate_volume(52, volumes))
        assert "第 51-51 章" in text
        assert "第50章" not in text

    def test_first_chapter_of_volume_has_no_previous_text(self, outline, volumes):
        text = build_recent_chapters_context(outline, 51, locate_volume(51, volumes))
        assert text == "（本卷起始章，无前文）"

    def test_chapter_one_has_no_previous_text(self, outline, volumes):
        text = build_recent_chapters_context(outline, 1, locate_volume(1, volumes))
        assert text == "（本卷起始章，无前文）"

    def test_missing_chapters_in_outline_degrade_gracefully(self, volumes):
        text = build_recent_chapters_context({"chapters": []}, 40, locate_volume(40, volumes))
        assert text == "（本卷起始章，无前文）"

    def test_volume_none_degrades_to_plain_window(self, outline):
        text = build_recent_chapters_context(outline, 40, None)
        assert "第 37-39 章" in text

    @pytest.mark.parametrize("outline", [None, {}, {"chapters": None}])
    def test_degenerate_outline_returns_placeholder(self, outline):
        assert build_recent_chapters_context(outline, 40, None) == "（本卷起始章，无前文）"