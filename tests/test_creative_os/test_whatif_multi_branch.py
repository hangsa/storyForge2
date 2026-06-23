"""Tests for WhatIfEngine 3-branch (no-dimension) generation."""
import pytest
from unittest.mock import AsyncMock

from backend.creative_os.whatif_engine import WhatIfEngine
from backend.models.creative_os import WhatIfNode


class MockRouter:
    def __init__(self, response):
        self.response = response
        self.last_user_prompt = None

    async def execute(self, **kwargs):
        self.last_user_prompt = kwargs["messages"][1]["content"]
        return {"content": self.response}


@pytest.mark.asyncio
async def test_expand_node_returns_3_children_not_4():
    response = '[' + ",".join(
        f'{{"content": "C{i}", "novelty_score": 70, "trope_tags": []}}'
        for i in range(4)
    ) + ']'
    router = MockRouter(response)
    engine = WhatIfEngine(model_router=router)

    root = WhatIfNode(
        id="wi_000_00", depth=0, parent_id=None,
        content="Root",
    )
    children = await engine.expand_node(root, ancestor_contents=[])

    assert len(children) == 3, "engine should cap at BRANCHES_PER_NODE=3"


@pytest.mark.asyncio
async def test_expand_node_all_children_start_active():
    response = (
        '[{"content": "A", "novelty_score": 70, "trope_tags": []},'
        '{"content": "B", "novelty_score": 80, "trope_tags": []},'
        '{"content": "C", "novelty_score": 60, "trope_tags": []}]'
    )
    router = MockRouter(response)
    engine = WhatIfEngine(model_router=router)

    root = WhatIfNode(
        id="wi_000_00", depth=0, parent_id=None,
        content="Root",
    )
    children = await engine.expand_node(root, ancestor_contents=[])

    assert all(c.branch_status == "active" for c in children)


@pytest.mark.asyncio
async def test_expand_node_prompt_no_longer_mentions_4_dimensions():
    response = (
        '[{"content": "A", "novelty_score": 70, "trope_tags": []},'
        '{"content": "B", "novelty_score": 80, "trope_tags": []},'
        '{"content": "C", "novelty_score": 60, "trope_tags": []}]'
    )
    router = MockRouter(response)
    engine = WhatIfEngine(model_router=router)

    root = WhatIfNode(
        id="wi_000_00", depth=0, parent_id=None,
        content="Root",
    )
    await engine.expand_node(root, ancestor_contents=[])

    prompt = router.last_user_prompt
    assert "四个叙事维度" not in prompt
    assert "角色动机" not in prompt
    assert "读者体验" not in prompt
    assert "3 条" in prompt or "3个" in prompt or "三条" in prompt
