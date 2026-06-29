from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.style_engine.sandbox_models import SandboxParams
from backend.style_engine.sandbox_renderer import compute_avg_length, render_preview


def test_compute_avg_length_chinese():
    # Three Chinese sentences of 10/20/30 characters (excluding punctuation)
    text = "你好世界。今天天气非常的好像要下雨但是又晴朗了。"
    avg = compute_avg_length(text)
    # Should be > 0 and < 50
    assert 0 < avg < 50


def test_compute_avg_length_empty():
    assert compute_avg_length("") == 0.0


def test_compute_avg_length_single_sentence():
    assert compute_avg_length("只有一句。") > 0


@pytest.mark.asyncio
async def test_render_preview_success_returns_response():
    fake_router = MagicMock()
    fake_router.execute = AsyncMock(return_value={
        "content": "渲染后的文本内容，节奏更快。",
        "usage": {"input": 800, "output": 600},
        "model": "claude-haiku", "tier": "tier_3", "cost": 0.001,
    })
    params = SandboxParams()
    params.sentence.avg_length_range = [10, 20]
    resp = await render_preview(
        model_router=fake_router,
        source_text="原文文本" * 30,
        params=params,
        genre="cool_novel",
    )
    assert resp.rendered_text == "渲染后的文本内容，节奏更快。"
    assert resp.tokens_used == 1400
    assert resp.source_avg_length > 0
    assert resp.rendered_avg_length > 0


@pytest.mark.asyncio
async def test_render_preview_skipped_when_router_unavailable():
    fake_router = MagicMock()
    fake_router.execute = AsyncMock(return_value={
        "content": "", "usage": {"input": 0, "output": 0},
        "model": "none", "tier": "tier_3", "cost": 0.0,
    })
    resp = await render_preview(
        model_router=fake_router,
        source_text="x" * 200,
        params=SandboxParams(),
        genre="cool_novel",
    )
    assert resp.rendered_text == ""
    assert resp.skipped_reason == "no LLM response"


@pytest.mark.asyncio
async def test_render_preview_skipped_when_router_raises():
    fake_router = MagicMock()
    fake_router.execute = AsyncMock(side_effect=Exception("offline"))
    resp = await render_preview(
        model_router=fake_router,
        source_text="x" * 200,
        params=SandboxParams(),
        genre="cool_novel",
    )
    assert resp.skipped_reason
    assert resp.rendered_text == ""
