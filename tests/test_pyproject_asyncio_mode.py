"""Sanity test that pyproject.toml's asyncio_mode=auto is honoured."""
import asyncio


async def test_async_runs_without_decorator():
    await asyncio.sleep(0)
    assert True
