"""Tests for Writer._build_chapter_outline_context."""
from backend.agents.writer import WriterAgent


def _ch(**kw):
    base = {
        "chapter_number": 31,
        "title": "雷劫洞中醒，禁术暗藏",
        "theme": "穿越重生，发现金手指，兄弟情深暗藏分歧",
        "scene_plan": [
            {"scene_number": 1, "goal": "主角苏醒", "conflict": "金手指觉醒", "emotional_arc": "震惊→好奇"},
            {"scene_number": 2, "goal": "与师兄对峙", "conflict": "理念冲突", "emotional_arc": "隐忍→爆发"},
            {"scene_number": 3, "goal": "发现禁术", "conflict": "内心抉择", "emotional_arc": "挣扎→决断"},
        ],
    }
    base.update(kw)
    return base


def test_outputs_title_and_theme():
    out = WriterAgent._build_chapter_outline_context(_ch())
    assert "标题: 雷劫洞中醒，禁术暗藏" in out
    assert "主题: 穿越重生" in out


def test_outputs_all_scenes_with_goal_conflict_emotional_arc():
    out = WriterAgent._build_chapter_outline_context(_ch())
    assert "场景序列:" in out
    assert "1. 主角苏醒" in out
    assert "冲突: 金手指觉醒" in out
    assert "情感弧线: 震惊→好奇" in out
    assert "2. 与师兄对峙" in out
    assert "3. 发现禁术" in out


def test_handles_empty_scene_plan():
    out = WriterAgent._build_chapter_outline_context(_ch(scene_plan=[]))
    assert "标题:" in out
    assert "主题:" in out
    # Should still have "场景序列:" header but no entries.
    assert "场景序列:" in out


def test_handles_missing_theme():
    out = WriterAgent._build_chapter_outline_context(_ch(theme=None))
    # Falls back gracefully — title still present.
    assert "标题:" in out


def test_returns_empty_string_for_none():
    assert WriterAgent._build_chapter_outline_context(None) == ""


def test_returns_empty_string_for_empty_dict():
    assert WriterAgent._build_chapter_outline_context({}) == ""
