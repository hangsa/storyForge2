"""Tests for market_saturation async Trope extraction fix (Task 12).

Covers:
1. `_calc_market_saturation` returns 50.0 when tags=[] (regression guard)
2. `_calc_market_saturation` returns 0-100 with real catalog tags
3. `fill_trope_tags_async` populates raw_intent["trope_tags"] and calls save_callback
4. `fill_trope_tags_async` is best-effort: failures don't propagate
5. `fill_trope_tags_async` short-circuits when trope_tags already filled
6. trope_extraction.yaml loads via `load_prompt_effective`
"""
import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.creative_os.contradiction_engine import ContradictionEngine
from backend.creative_os.novelty_evaluator import NoveltyEvaluator
from backend.creative_os.trope_pool import TropePool


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_trope_pool(tmp_path) -> TropePool:
    """Build a TropePool from the project's config/trope_catalog.yaml."""
    project_dir = tmp_path / "proj_fixture"
    project_dir.mkdir(parents=True, exist_ok=True)
    catalog_path = (
        __import__("pathlib").Path(__file__).parent.parent
        / "config"
        / "trope_catalog.yaml"
    )
    return TropePool(project_dir=project_dir, catalog_path=catalog_path)


def _make_evaluator(tmp_path) -> NoveltyEvaluator:
    """Construct a fully-wired NoveltyEvaluator per Correction 5 (4 args)."""
    return NoveltyEvaluator(
        trope_pool=_make_trope_pool(tmp_path),
        contradiction_engine=ContradictionEngine(),
        model_router=None,
        embedder=None,
    )


# ---------------------------------------------------------------------------
# 1. _calc_market_saturation — regression guard (already passes)
# ---------------------------------------------------------------------------


def test_calc_market_saturation_returns_50_when_no_tags(tmp_path):
    """Empty tags → 50.0 fallback (current behavior is correct)."""
    evaluator = _make_evaluator(tmp_path)
    assert evaluator._calc_market_saturation([]) == 50.0


def test_calc_market_saturation_with_real_catalog_tags(tmp_path):
    """Real trope names from trope_catalog.yaml produce a 0-100 score < 100.

    Uses names that exist verbatim in the catalog (e.g. 废柴逆袭, 天才流) so
    TropePool.get_saturation returns the catalog value, not the 0.5 fallback.
    """
    evaluator = _make_evaluator(tmp_path)
    score = evaluator._calc_market_saturation(["废柴逆袭", "天才流"])
    assert isinstance(score, float)
    assert 0.0 <= score <= 100.0, f"expected 0-100, got {score}"
    # Tags from catalog with non-zero saturation → must differ from 50.0 fallback.
    assert score != 50.0, (
        "Real catalog tags should produce a non-default score; got 50.0 "
        "which means the fallback path is still being taken"
    )


# ---------------------------------------------------------------------------
# 2. fill_trope_tags_async — the new method (currently fails with AttributeError)
# ---------------------------------------------------------------------------


def test_fill_trope_tags_async_method_exists(tmp_path):
    """Sanity: the method must exist on NoveltyEvaluator."""
    evaluator = _make_evaluator(tmp_path)
    assert hasattr(evaluator, "fill_trope_tags_async"), (
        "NoveltyEvaluator.fill_trope_tags_async is missing — "
        "Task 12 has not been implemented yet"
    )
    assert callable(evaluator.fill_trope_tags_async)


def test_fill_trope_tags_async_populates_tags_and_calls_callback(tmp_path):
    """Stubbed LLM client returns comma-separated tags; verify they are parsed,
    written to raw_intent, and save_callback fires."""
    evaluator = _make_evaluator(tmp_path)

    # Fake LLM client — only needs .generate()
    llm_client = MagicMock()
    llm_client.generate = AsyncMock(
        return_value=MagicMock(text="修仙, 逆袭, 系统, 重生")
    )

    raw_intent: dict = {"prompt": "主角修仙逆袭的故事"}
    saved: list = []

    def save_callback(ri: dict) -> None:
        saved.append(dict(ri))

    asyncio.run(
        evaluator.fill_trope_tags_async(raw_intent, llm_client, save_callback)
    )

    # Tags parsed & whitespace stripped
    assert raw_intent["trope_tags"] == ["修仙", "逆袭", "系统", "重生"]
    # Callback fired once with the populated dict
    assert len(saved) == 1
    assert saved[0]["trope_tags"] == ["修仙", "逆袭", "系统", "重生"]
    # LLM was called exactly once
    assert llm_client.generate.await_count == 1


def test_fill_trope_tags_async_short_circuits_when_already_filled(tmp_path):
    """If raw_intent already has trope_tags, skip LLM call entirely."""
    evaluator = _make_evaluator(tmp_path)
    llm_client = MagicMock()
    llm_client.generate = AsyncMock(return_value=MagicMock(text="应该被忽略"))

    raw_intent = {"prompt": "...", "trope_tags": ["existing"]}
    save_callback = MagicMock()

    asyncio.run(
        evaluator.fill_trope_tags_async(raw_intent, llm_client, save_callback)
    )

    # Tags unchanged, no LLM call, no save
    assert raw_intent["trope_tags"] == ["existing"]
    assert llm_client.generate.await_count == 0
    assert save_callback.call_count == 0


def test_fill_trope_tags_async_swallows_llm_errors(tmp_path):
    """If the LLM call fails, the exception must be caught and swallowed
    (best-effort: don't crash the caller)."""
    evaluator = _make_evaluator(tmp_path)
    llm_client = MagicMock()
    llm_client.generate = AsyncMock(side_effect=RuntimeError("LLM down"))

    raw_intent: dict = {"prompt": "主角修仙"}
    save_callback = MagicMock()

    # Must not raise
    asyncio.run(
        evaluator.fill_trope_tags_async(raw_intent, llm_client, save_callback)
    )

    # Failure path leaves tags empty and does not call save_callback
    assert "trope_tags" not in raw_intent or raw_intent.get("trope_tags") == []
    assert save_callback.call_count == 0


def test_fill_trope_tags_async_handles_empty_response(tmp_path):
    """If LLM returns empty text, no tags added and no save callback fired."""
    evaluator = _make_evaluator(tmp_path)
    llm_client = MagicMock()
    llm_client.generate = AsyncMock(return_value=MagicMock(text=""))

    raw_intent: dict = {"prompt": "..."}
    save_callback = MagicMock()

    asyncio.run(
        evaluator.fill_trope_tags_async(raw_intent, llm_client, save_callback)
    )

    assert raw_intent.get("trope_tags", []) == []
    assert save_callback.call_count == 0


def test_fill_trope_tags_async_strips_empty_segments(tmp_path):
    """Tags separated by ', , ,' should drop empty segments, not produce blanks."""
    evaluator = _make_evaluator(tmp_path)
    llm_client = MagicMock()
    llm_client.generate = AsyncMock(
        return_value=MagicMock(text="修仙, , , 逆袭, ")
    )

    raw_intent: dict = {"prompt": "..."}

    asyncio.run(
        evaluator.fill_trope_tags_async(raw_intent, llm_client, lambda ri: None)
    )

    assert raw_intent["trope_tags"] == ["修仙", "逆袭"]


# ---------------------------------------------------------------------------
# 3. trope_extraction.yaml loads via load_prompt_effective
# ---------------------------------------------------------------------------


def test_trope_extraction_prompt_loadable(tmp_path):
    """The trope_extraction.yaml prompt file exists and is loadable via
    the 3-tier override loader."""
    from backend.services.prompt_override_store import load_prompt_effective

    data = load_prompt_effective(
        "trope_extraction",
        prompts_dir=__import__("backend.config", fromlist=["settings"]).settings.prompts_dir,
    )

    # Must have the keys our caller uses
    assert "system_prompt" in data
    assert "user_prompt_template" in data
    # user_prompt_template should reference {prompt}
    assert "{prompt}" in data["user_prompt_template"]
    # Should reference trope/tags/套路
    assert "套路" in data["system_prompt"] or "trope" in data["system_prompt"].lower()
