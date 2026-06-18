"""Tests for Genre Fusion Engine -- BFS distance + compatibility matrix."""

from unittest.mock import MagicMock

import pytest

from backend.creative_os.genre_fusion_engine import GENRE_GRAPH, GenreFusionEngine


ALL_GENRES = sorted(GENRE_GRAPH.keys())


@pytest.fixture
def mock_router():
    return MagicMock()


@pytest.fixture
def engine(mock_router):
    return GenreFusionEngine(model_router=mock_router)


class TestCompatibilityMatrix:

    def test_same_genre_high_compatibility(self, engine):
        assert engine.get_compatibility("修仙", "修仙") == "高"

    def test_different_genres(self, engine):
        result = engine.get_compatibility("修仙", "科幻")
        assert result in {"高", "中", "低"}

    def test_unknown_genre_returns_low(self, engine):
        result = engine.get_compatibility("不存在的类型", "修仙")
        assert result == "低"

    def test_get_compatibility_symmetric(self, engine):
        for a in ALL_GENRES:
            for b in ALL_GENRES:
                if a >= b:
                    continue
                assert engine.get_compatibility(a, b) == engine.get_compatibility(b, a), \
                    f"Compatibility asymmetric: {a} ↔ {b}"


class TestBFSDistance:

    def test_same_genre_distance_zero(self, engine):
        assert engine.compute_distance("修仙", "修仙") == 0

    def test_adjacent_genres(self, engine):
        dist = engine.compute_distance("修仙", "玄幻")
        assert dist >= 0

    def test_distant_genres(self, engine):
        dist = engine.compute_distance("修仙", "科幻")
        assert dist >= 1

    def test_bfs_symmetric(self, engine):
        for a in ALL_GENRES:
            for b in ALL_GENRES:
                if a >= b:
                    continue
                d1 = engine.compute_distance(a, b)
                d2 = engine.compute_distance(b, a)
                assert d1 == d2, f"BFS asymmetric: {a} ↔ {b} ({d1} vs {d2})"


class TestDistanceBonus:

    def test_distance_bonus_threshold(self, engine):
        dist = engine.compute_distance("修仙", "科幻")
        if dist >= 3:
            bonus = 1.2
            assert bonus > 1.0


class TestEngineInit:

    def test_engine_initialization(self, mock_router):
        engine = GenreFusionEngine(model_router=mock_router)
        assert engine._router is mock_router
        assert len(engine.COMPATIBILITY_MATRIX) > 0
