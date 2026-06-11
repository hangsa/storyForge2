"""
MemoryOS L0 Runtime and L1 Hot memory unit tests.
"""

import pytest

from backend.memory_os.l0_runtime import L0Runtime
from backend.memory_os.l1_hot import L1Hot


class TestL0Runtime:
    def test_empty_context(self):
        l0 = L0Runtime()
        ctx = l0.get_context_string()
        assert ctx == ""

    def test_update_from_logs(self):
        l0 = L0Runtime()
        l0.update_from_logs({"林峰": {"location": "星辰宗", "emotion": "愤怒"}})
        ctx = l0.get_context_string()
        assert "林峰" in ctx
        assert "星辰宗" in ctx
        assert "愤怒" in ctx

    def test_scene_context(self):
        l0 = L0Runtime()
        l0.set_scene_context(3, "揭露真相")
        ctx = l0.get_context_string()
        assert "第3幕" in ctx
        assert "揭露真相" in ctx

    def test_context_truncation(self):
        l0 = L0Runtime()
        long_text = "长文本" * 1000
        l0.update_from_logs({"角色": {"location": long_text, "emotion": "平静"}})
        ctx = l0.get_context_string()
        assert len(ctx) <= 1000  # MAX_TOKENS * 2 character limit

    def test_reset_clears_entries(self):
        l0 = L0Runtime()
        l0.update_from_logs({"林峰": {"location": "星辰宗"}})
        l0.reset()
        assert l0.get_context_string() == ""

    def test_multiple_character_updates(self):
        l0 = L0Runtime()
        l0.update_from_logs({"林峰": {"location": "星辰宗", "emotion": "愤怒"}})
        l0.update_from_logs({"苏晓晓": {"location": "坊市", "emotion": "担忧"}})
        ctx = l0.get_context_string()
        assert "苏晓晓" in ctx


class TestL1Hot:
    def test_empty_context(self):
        l1 = L1Hot()
        ctx = l1.get_context_string()
        assert "第一章的第一幕" in ctx

    def test_append_scene(self):
        l1 = L1Hot()
        l1.append_scene(1, "场景文本内容...", summary="关键事件")
        ctx = l1.get_context_string()
        assert "前文回顾" in ctx
        assert "关键事件" in ctx

    def test_context_without_summary(self):
        l1 = L1Hot()
        l1.append_scene(1, "A" * 300)
        ctx = l1.get_context_string()
        assert "A" * 200 in ctx
        assert "..." in ctx

    def test_max_scenes_cap(self):
        l1 = L1Hot()
        for i in range(10):
            l1.append_scene(i, f"场景{i}")
        assert len(l1._scenes) == 6
        assert l1._scenes[0]["scene_number"] == 4  # 10 - 6 = 4, first kept
        assert l1._scenes[-1]["scene_number"] == 9

    def test_get_previous_scenes_text(self):
        l1 = L1Hot()
        l1.append_scene(1, "场景1文本")
        l1.append_scene(2, "场景2文本")
        texts = l1.get_previous_scenes_text()
        assert len(texts) == 2
        assert texts[0] == "场景1文本"

    def test_reset(self):
        l1 = L1Hot()
        l1.append_scene(1, "内容")
        l1.reset()
        assert len(l1._scenes) == 0
