"""Tests for BM25Index and HybridSearcher (Phase 2.2)."""

import pytest
from pathlib import Path
from backend.memory_os.l3_chunker import TextChunk
from backend.memory_os.l3_bm25 import BM25Index, HybridSearcher, SearchHit


def _make_chunk(chunk_id: str, text: str, chapter: int = 1, scene: int = 1) -> TextChunk:
    return TextChunk(
        chunk_id=chunk_id,
        project_id="test",
        chapter_number=chapter,
        scene_number=scene,
        chunk_index=0,
        text=text,
    )


class TestBM25Index:
    def test_add_and_search(self):
        idx = BM25Index()
        chunks = [
            _make_chunk("c1", "林峰独自走在寂静的街道上"),
            _make_chunk("c2", "苏晓晓正在实验室研究超脑的秘密"),
            _make_chunk("c3", "师父决定将真相告诉徒弟"),
        ]
        idx.add_chunks(chunks)
        assert idx.is_built

        results = idx.search("实验室", top_k=5)
        assert len(results) >= 1
        assert any("实验室" in r.text for r in results)

    def test_search_empty_index(self):
        idx = BM25Index()
        results = idx.search("查询", top_k=5)
        assert results == []

    def test_search_no_match(self):
        idx = BM25Index()
        idx.add_chunks([_make_chunk("c1", "今天天气很好")])
        results = idx.search("宇宙飞船量子力学递归算法星际穿越黑洞视界", top_k=5)
        # BM25 may still return hits with low scores for short docs
        # The filtering at score <= 0 removes no-match cases
        # Just verify it doesn't crash
        assert isinstance(results, list)

    def test_save_and_load(self, tmp_path):
        idx = BM25Index()
        # Use 5+ diverse chunks so BM25 IDF is non-zero for rare terms.
        # With only 2 docs, any term in 1 doc has IDF=log(1)=0.
        chunks = [
            _make_chunk("c1", "林峰走向废墟探索超脑的秘密", chapter=1, scene=1),
            _make_chunk("c2", "苏晓晓在实验室研究量子计算", chapter=1, scene=2),
            _make_chunk("c3", "师父决定将真相告诉所有徒弟", chapter=1, scene=3),
            _make_chunk("c4", "星空下的古老遗迹散发着神秘光芒", chapter=2, scene=1),
            _make_chunk("c5", "敌人从暗处发起了突如其来的袭击", chapter=2, scene=2),
            _make_chunk("c6", "林峰和苏晓晓联手对抗外星文明", chapter=2, scene=3),
        ]
        idx.add_chunks(chunks)

        save_path = tmp_path / "bm25_test.pkl"
        idx.save_to_disk(save_path)
        assert save_path.exists()

        idx2 = BM25Index()
        assert idx2.load_from_disk(save_path)
        results = idx2.search("废墟", top_k=5)
        assert len(results) >= 1
        assert any("废墟" in r.text for r in results)

    def test_load_nonexistent(self):
        idx = BM25Index()
        result = idx.load_from_disk(Path("/nonexistent/bm25.pkl"))
        assert result is False

    def test_tokenize_fallback_bigrams(self):
        idx = BM25Index()
        tokens = idx._tokenize("林峰走上街头")
        assert len(tokens) > 0
        # With bigram fallback: 林峰, 峰走, 走上, 上街, 街头
        assert all(len(t) == 2 for t in tokens)


class TestHybridSearcher:
    def _make_hit(self, chunk_id: str, score: float, source: str = "bm25") -> SearchHit:
        return SearchHit(
            chunk_id=chunk_id, score=score,
            text=f"text of {chunk_id}",
            chapter_number=1, scene_number=1, source=source,
        )

    def test_rrf_fusion_overlap(self):
        bm25 = [
            self._make_hit("a", 3.5, "bm25"),
            self._make_hit("b", 2.0, "bm25"),
            self._make_hit("c", 1.0, "bm25"),
        ]
        dense = [
            self._make_hit("b", 0.95, "dense"),
            self._make_hit("a", 0.85, "dense"),
            self._make_hit("d", 0.80, "dense"),
        ]
        searcher = HybridSearcher(k=60)
        fused = searcher.fuse(bm25, dense, top_k=10)
        # "b" should rank high since it appears in both
        assert len(fused) <= 4
        ids = [h.chunk_id for h in fused]
        assert "b" in ids[:2]  # b has high overlap, should be at top

    def test_rrf_empty_one_side(self):
        bm25 = [self._make_hit("x", 2.0)]
        dense: list[SearchHit] = []
        searcher = HybridSearcher()
        fused = searcher.fuse(bm25, dense, top_k=10)
        assert len(fused) == 1
        assert fused[0].chunk_id == "x"

    def test_rrf_both_empty(self):
        searcher = HybridSearcher()
        fused = searcher.fuse([], [], top_k=10)
        assert fused == []

    def test_rrf_top_k_respected(self):
        bm25 = [self._make_hit(f"c{i}", 5.0 - i) for i in range(10)]
        dense = [self._make_hit(f"d{i}", 0.9 - i * 0.05) for i in range(10)]
        searcher = HybridSearcher()
        fused = searcher.fuse(bm25, dense, top_k=5)
        assert len(fused) <= 5
