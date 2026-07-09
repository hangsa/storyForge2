"""Tests for WhatIfEngine ancestor chain (path_context) accumulation."""
import asyncio
from unittest.mock import AsyncMock

import pytest

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
async def test_expand_node_includes_ancestor_chain_in_prompt():
    response = '[{"content": "C", "dimension": "角色动机", "novelty_score": 70, "trope_tags": []}]'
    router = MockRouter(response)
    engine = WhatIfEngine(model_router=router)

    parent = WhatIfNode(
        id="wi_001_00", depth=1, parent_id="wi_000_00",
        content="Parent", branch_status="active",
    )
    children = await engine.expand_node(parent, ancestor_contents=["Root content"])

    assert len(children) == 1
    assert "祖先路径" in router.last_user_prompt
    assert "Root content" in router.last_user_prompt


@pytest.mark.asyncio
async def test_expand_node_omits_ancestor_section_when_empty():
    response = '[{"content": "C", "dimension": "角色动机", "novelty_score": 70, "trope_tags": []}]'
    router = MockRouter(response)
    engine = WhatIfEngine(model_router=router)

    root = WhatIfNode(
        id="wi_000_00", depth=0, parent_id=None,
        content="Root", branch_status="active",
    )
    await engine.expand_node(root, ancestor_contents=[])

    assert "祖先路径" not in router.last_user_prompt