"""Tests for MemoryCoordinator (Phase 2.5)."""

import pytest
from backend.memory_os.memory_coordinator import MemoryCoordinator, MemoryContext


class TestMemoryCoordinator:
    @pytest.fixture
    def mc(self, tmp_path):
        projects_dir = tmp_path / "projects"
        proj_dir = projects_dir / "test_proj"
        (proj_dir / "memory" / "l2" / "chapter_summaries").mkdir(parents=True)
        (proj_dir / "memory" / "l4").mkdir(parents=True)
        (proj_dir / "storyos").mkdir(parents=True)
        (proj_dir / "chapters").mkdir(parents=True)
        return MemoryCoordinator("test_proj", projects_dir=projects_dir)

    def test_assemble_returns_memory_context(self, mc):
        ctx = mc.assemble_for_scene(
            scene_number=1,
            scene_goal="测试目标",
            scene_conflict="测试冲突",
            character_names=["林峰", "苏晓晓"],
            chapter_number=3,
        )
        assert isinstance(ctx, MemoryContext)
        # L0 should always have content
        assert "测试目标" in ctx.l0_context
        # L1 may be empty if no drafts on disk
        assert isinstance(ctx.l1_context, str)
        # L2/L4 may be empty if no data persisted
        assert isinstance(ctx.l2_context, str)
        assert isinstance(ctx.l4_context, str)
        # L3 may be empty if Qdrant unavailable
        assert isinstance(ctx.l3_context, str)
        # Growth stage should be set
        assert isinstance(ctx.growth_stage_hint, str)
        assert len(ctx.growth_stage_hint) > 0

    def test_growth_stage_setup(self, mc):
        hint = mc._compute_growth_stage(1)
        assert "开篇" in hint

    def test_growth_stage_development(self, mc):
        hint = mc._compute_growth_stage(5)
        assert "发展" in hint

    def test_growth_stage_escalation(self, mc):
        hint = mc._compute_growth_stage(8)
        assert "转折" in hint

    def test_growth_stage_climax(self, mc):
        hint = mc._compute_growth_stage(12)
        assert "高潮" in hint

    def test_growth_stage_resolution(self, mc):
        hint = mc._compute_growth_stage(18)
        assert "收尾" in hint

    def test_growth_stage_beyond_20(self, mc):
        hint = mc._compute_growth_stage(25)
        assert "终章" in hint

    def test_l3_query_built_from_params(self, mc):
        query = mc._build_l3_query(
            scene_goal="发现秘密",
            scene_conflict="师徒对抗",
            character_names=["林峰", "师父"],
        )
        assert "发现秘密" in query
        assert "师徒对抗" in query
        assert "林峰" in query
        assert "师父" in query

    def test_l3_query_handles_empty_params(self, mc):
        query = mc._build_l3_query("", "", [])
        assert query == ""

    def test_safe_get_returns_default_on_exception(self):
        def fail():
            raise RuntimeError("test error")

        result = MemoryCoordinator._safe_get("TEST", fail)
        assert result == ""

    def test_safe_get_returns_value(self):
        def succeed():
            return "ok"

        result = MemoryCoordinator._safe_get("TEST", succeed)
        assert result == "ok"

    def test_assemble_for_chapter_advance_does_not_crash(self, mc):
        # Should not raise even with no data
        mc.assemble_for_chapter_advance(
            chapter_number=1,
            scene_drafts=["测试场景文本。" * 10],
        )
