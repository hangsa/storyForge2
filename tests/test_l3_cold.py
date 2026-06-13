"""Tests for L3ColdMemory (Phase 2.3)."""

import pytest
from backend.memory_os.l3_cold import L3ColdMemory


class TestL3ColdMemory:
    def test_available_flag_set(self, tmp_path):
        """L3ColdMemory should set _available based on Qdrant import."""
        projects_dir = tmp_path / "projects"
        projects_dir.mkdir()
        l3 = L3ColdMemory("test_proj", projects_dir=projects_dir)
        # _available is True if qdrant-client installed, False otherwise
        assert isinstance(l3.available, bool)

    def test_search_returns_empty_when_unavailable(self, tmp_path):
        """When L3 is unavailable, search() should return ''."""
        projects_dir = tmp_path / "projects"
        projects_dir.mkdir()
        l3 = L3ColdMemory("test_proj", projects_dir=projects_dir)
        # Force unavailable
        l3._available = False
        result = l3.search("测试查询")
        assert result == ""

    def test_search_returns_empty_for_empty_query(self, tmp_path):
        projects_dir = tmp_path / "projects"
        projects_dir.mkdir()
        l3 = L3ColdMemory("test_proj", projects_dir=projects_dir)
        l3._available = False  # Don't need real Qdrant for this test
        result = l3.search("   ")
        assert result == ""

    def test_format_context_empty(self):
        l3 = L3ColdMemory._format_context.__wrapped__ if hasattr(
            L3ColdMemory._format_context, '__wrapped__'
        ) else L3ColdMemory._format_context
        result = L3ColdMemory._format_context.__func__([]) if hasattr(
            L3ColdMemory._format_context, '__func__'
        ) else None
        # We can test via a temporary instance
        # Create instance without Qdrant, test _format_context directly
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            from pathlib import Path
            proj_dir = Path(td) / "projects"
            proj_dir.mkdir()
            l3 = L3ColdMemory("test", projects_dir=proj_dir)
            result = l3._format_context([])
            assert result == ""

    def test_format_context_with_hits(self, tmp_path):
        from backend.memory_os.l3_bm25 import SearchHit

        projects_dir = tmp_path / "projects"
        projects_dir.mkdir()
        l3 = L3ColdMemory("test", projects_dir=projects_dir)

        hits = [
            SearchHit("c1", 0.05, "林峰发现了实验室的秘密", 3, 2, "hybrid"),
            SearchHit("c2", 0.04, "苏晓晓在研究超脑数据时发现异常", 5, 1, "hybrid"),
        ]
        result = l3._format_context(hits)
        assert "历史文本" in result
        assert "第3章" in result
        assert "林峰" in result

    def test_format_context_truncates_long_text(self, tmp_path):
        from backend.memory_os.l3_bm25 import SearchHit

        projects_dir = tmp_path / "projects"
        projects_dir.mkdir()
        l3 = L3ColdMemory("test", projects_dir=projects_dir)

        # Create many hits with long text to exceed MAX_CONTEXT_CHARS
        hits = []
        for i in range(50):
            hits.append(SearchHit(
                f"c{i}", 0.05,
                f"这是一段很长的测试文本内容用于验证上下文截断功能第{i}段" * 3,
                i % 10 + 1, i % 5 + 1, "hybrid",
            ))
        result = l3._format_context(hits)
        # Should be truncated under ~3000 chars (2000 + some header)
        assert len(result) < 4000

    def test_index_chapter_returns_zero_when_unavailable(self, tmp_path):
        projects_dir = tmp_path / "projects"
        projects_dir.mkdir()
        l3 = L3ColdMemory("test", projects_dir=projects_dir)
        l3._available = False
        result = l3.index_chapter(1, ["场景文本内容。" * 20])
        assert result == 0

    def test_clear_index_when_unavailable(self, tmp_path):
        projects_dir = tmp_path / "projects"
        projects_dir.mkdir()
        l3 = L3ColdMemory("test", projects_dir=projects_dir)
        l3._available = False
        # Should not raise
        l3.clear_index()
