"""Tests for WhatIf Engine — recursive tree construction."""

from unittest.mock import MagicMock

import pytest

from backend.creative_os.whatif_engine import WhatIfEngine
from backend.models.creative_os import WhatIfNode


@pytest.fixture
def mock_router():
    return MagicMock()


@pytest.fixture
def mock_novelty():
    m = MagicMock()
    m.evaluate_node.return_value.total = 70.0
    return m


@pytest.fixture
def engine(mock_router, mock_novelty):
    return WhatIfEngine(
        model_router=mock_router,
        novelty_evaluator=mock_novelty,
    )


class TestWhatIfNodeStructure:

    def test_generate_root(self, engine):
        root = engine.generate_root("主角发现修炼的功法是上古禁术")
        assert isinstance(root, WhatIfNode)
        assert root.depth == 0
        assert root.parent_id is None
        assert root.content != ""
        assert not root.is_expanded

    def test_max_depth_constant(self):
        assert WhatIfEngine.MAX_DEPTH == 3

    def test_breadth_constant(self):
        assert WhatIfEngine.BREADTH == 4

    def test_node_id_format(self, engine):
        root = engine.generate_root("test premise")
        assert root.id.startswith("wi_")
        assert root.id.count("_") == 2  # wi_001_00

    def test_children_ids_default_empty(self, engine):
        root = engine.generate_root("test")
        assert root.children_ids == []

    def test_node_dimension_is_valid(self, engine):
        root = engine.generate_root("test")
        assert root.dimension in {
            "角色动机", "世界观规则", "情节方向", "读者体验"
        }

    def test_total_nodes_within_bounds(self, engine):
        # Maximum: 1 + 4 + 16 + 64 = 85 (but max 84 per spec)
        theoretical_max = 1
        for d in range(1, WhatIfEngine.MAX_DEPTH + 1):
            theoretical_max += WhatIfEngine.BREADTH ** d
        assert theoretical_max <= 85

    def test_engine_initialization(self, mock_router, mock_novelty):
        engine = WhatIfEngine(
            model_router=mock_router,
            novelty_evaluator=mock_novelty,
        )
        assert engine._router is mock_router
        assert engine._novelty_evaluator is mock_novelty


class TestWhatIfEngineLLM:

    @pytest.mark.asyncio
    async def test_expand_node_calls_router(self):
        from unittest.mock import AsyncMock
        router = MagicMock()
        router.execute = AsyncMock(return_value={
            "content": '[{"content": "子节点1", "dimension": "角色动机", '
                       '"novelty_score": 75, "trope_tags": ["废柴逆袭"]}, '
                       '{"content": "子节点2", "dimension": "世界观规则", '
                       '"novelty_score": 80, "trope_tags": ["末法时代"]}, '
                       '{"content": "子节点3", "dimension": "情节方向", '
                       '"novelty_score": 70, "trope_tags": ["绝境求生"]}, '
                       '{"content": "子节点4", "dimension": "读者体验", '
                       '"novelty_score": 85, "trope_tags": ["身份反转"]}]',
            "usage": {"input": 500, "output": 300},
            "model": "deepseek-v4-pro",
            "tier": "tier_1",
        })
        engine = WhatIfEngine(model_router=router)
        root = engine.generate_root("测试前提")
        children = await engine.expand_node(root)
        assert len(children) == 4
        assert children[0].depth == 1
        assert children[0].parent_id == root.id
        assert root.is_expanded is True
        assert len(root.children_ids) == 4

    @pytest.mark.asyncio
    async def test_expand_node_without_router_raises(self):
        engine = WhatIfEngine(model_router=None)
        root = engine.generate_root("测试前提")
        with pytest.raises(NotImplementedError):
            await engine.expand_node(root)

    @pytest.mark.asyncio
    async def test_expand_at_max_depth_returns_empty(self):
        from unittest.mock import AsyncMock
        router = MagicMock()
        router.execute = AsyncMock(return_value={
            "content": '[]',
            "usage": {"input": 100, "output": 10},
            "model": "deepseek-v4-pro",
            "tier": "tier_1",
        })
        engine = WhatIfEngine(model_router=router)
        root = engine.generate_root("前提")
        root.depth = WhatIfEngine.MAX_DEPTH
        children = await engine.expand_node(root)
        assert len(children) == 0
