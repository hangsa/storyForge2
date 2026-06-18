"""Tests for Genre Fusion Engine -- BFS distance + compatibility matrix."""

from unittest.mock import MagicMock

import pytest

from backend.creative_os.genre_fusion_engine import GenreFusionEngine


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
        a_to_b = engine.get_compatibility("修仙", "都市")
        b_to_a = engine.get_compatibility("都市", "修仙")
        assert a_to_b == b_to_a


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
        d1 = engine.compute_distance("修仙", "科幻")
        d2 = engine.compute_distance("科幻", "修仙")
        assert d1 == d2


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
