"""Tests for Genre Fusion Engine -- BFS distance + compatibility matrix."""

from unittest.mock import MagicMock

import pytest

from backend.creative_os.genre_fusion_engine import GenreFusionEngine
from backend.genres.catalog import get_catalog
from backend.models.creative_os import FusionAnalysis


ALL_GENRES = sorted(e["id"] for e in get_catalog().list())


@pytest.fixture
def mock_router():
    return MagicMock()


@pytest.fixture
def engine(mock_router):
    return GenreFusionEngine(model_router=mock_router)


class TestCompatibilityMatrix:

    def test_same_genre_high_compatibility(self, engine):
        assert engine.get_compatibility("xianxia", "xianxia") == "高"

    def test_different_genres(self, engine):
        result = engine.get_compatibility("xianxia", "kehuan")
        assert result in {"高", "中", "低"}

    def test_unknown_genre_returns_low(self, engine):
        result = engine.get_compatibility("nonexistent_genre", "xianxia")
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
        assert engine.compute_distance("xianxia", "xianxia") == 0

    def test_adjacent_genres(self, engine):
        dist = engine.compute_distance("xianxia", "xuanhuan")
        assert dist >= 0

    def test_distant_genres(self, engine):
        dist = engine.compute_distance("xianxia", "kehuan")
        assert dist >= 1

    def test_bfs_symmetric(self, engine):
        for a in ALL_GENRES:
            for b in ALL_GENRES:
                if a >= b:
                    continue
                d1 = engine.compute_distance(a, b)
                d2 = engine.compute_distance(b, a)
                assert d1 == d2, f"BFS asymmetric: {a} ↔ {b} ({d1} vs {d2})"


class TestEngineInit:

    def test_engine_initialization(self, mock_router):
        engine = GenreFusionEngine(model_router=mock_router)
        assert engine._router is mock_router
        assert len(engine._compatibility) > 0
        assert len(engine._graph) > 0


class TestGenreFusionEngineLLM:

    @pytest.mark.asyncio
    async def test_analyze_fusion_calls_router(self):
        from unittest.mock import AsyncMock
        router = MagicMock()
        router.execute = AsyncMock(return_value={
            "content": '{"narrative_rhythm": "节奏建议", '
                       '"character_archetype": "角色建议", '
                       '"conflict_type": "冲突建议", '
                       '"world_rules": "世界观建议", '
                       '"emotion_curve": "情感建议", '
                       '"caution_areas": ["风险1", "风险2"]}',
            "usage": {"input": 600, "output": 400},
            "model": "deepseek-v4-pro",
            "tier": "tier_1",
        })
        engine = GenreFusionEngine(model_router=router)
        result = await engine.analyze_fusion("xianxia", "kehuan", "测试前提")
        assert isinstance(result, FusionAnalysis)
        assert result.genre_a == "xianxia"
        assert result.genre_b == "kehuan"
        assert len(result.fusion_points) == 5
        assert len(result.caution_areas) == 2

    @pytest.mark.asyncio
    async def test_analyze_fusion_without_router_raises(self):
        engine = GenreFusionEngine(model_router=None)
        with pytest.raises(NotImplementedError):
            await engine.analyze_fusion("xianxia", "kehuan")
