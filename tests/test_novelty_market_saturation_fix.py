"""Tests for market_saturation async Trope extraction fix (Task 12).

Covers:
1. `_calc_market_saturation` returns 50.0 when tags=[] (regression guard)
2. `_calc_market_saturation` returns 0-100 with real catalog tags
3. `fill_trope_tags_async` populates raw_intent["trope_tags"] and calls save_callback
4. `fill_trope_tags_async` is best-effort: failures don't propagate
5. `fill_trope_tags_async` short-circuits when trope_tags already filled
6. trope_extraction.yaml loads via `load_prompt_effective`
7. `_save_raw_intent_trope_tags` (the save_callback for /init's fire-and-forget
   task): writes raw_intent, preserves committed_at, and no-ops on None
8. `/init` returns 200 even when LLM client builder raises
"""
import asyncio
import json
from pathlib import Path
from typing import Optional
from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.config import settings
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
        Path(__file__).parent.parent
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
        prompts_dir=settings.prompts_dir,
    )

    # Must have the keys our caller uses
    assert "system_prompt" in data
    assert "user_prompt_template" in data
    # user_prompt_template should reference {prompt}
    assert "{prompt}" in data["user_prompt_template"]
    # Should reference trope/tags/套路
    assert "套路" in data["system_prompt"] or "trope" in data["system_prompt"].lower()


# ---------------------------------------------------------------------------
# 4. _save_raw_intent_trope_tags — /init → background-task → /state round-trip
# ---------------------------------------------------------------------------


def _make_canvas_v3_with_raw_intent(
    pid: str,
    raw_intent: dict,
    committed_at: Optional[str] = None,
) -> None:
    """Write a v3 canvas_state.json with the given raw_intent + optional committed_at.

    A minimal valid canvas: one root node with no children, no branch_choices,
    empty edges/idea_variants. Passes all 6 invariants.

    Caller is responsible for ensuring settings.projects_dir points at the
    desired tmp_path before invoking this helper (use the `canvas_project`
    fixture, or call `monkeypatch.setattr(settings, "projects_dir", tmp_path)`).
    """
    project_dir = Path(settings.projects_dir) / pid
    creative_os_dir = project_dir / "creative_os"
    creative_os_dir.mkdir(parents=True, exist_ok=True)
    canvas = {
        "schema_version": 3,
        "root_node_id": "wi_001_00",
        "nodes": {
            "wi_001_00": {
                "id": "wi_001_00",
                "depth": 0,
                "parent_id": None,
                "content": "root premise",
                "trope_tags": [],
                "saturation_warning": False,
                "novelty_score": None,
                "mutation_context": None,
                "children_ids": [],
                "is_expanded": False,
                "branch_status": "active",
            },
        },
        "edges": [],
        "selected_path": ["wi_001_00"],
        "branch_choices": {},
        "evaluations": {},
        "created_at": "2026-08-31T09:00:00+00:00",
        "updated_at": "2026-08-31T09:00:00+00:00",
        "committed_at": committed_at,
        "committed_concept_ref": "concept.json" if committed_at else None,
        "idea_variants": [],
        "core_contradiction": None,
        "novelty_scores": None,
        "raw_intent": raw_intent,
        "session_metadata": {
            "created_at": "2026-08-31T09:00:00+00:00",
            "last_modified_at": "2026-08-31T09:00:00+00:00",
            "elapsed_seconds": 0,
            "operation_count": 0,
            "ab_test_bucket": "control",
        },
    }
    creative_os_dir.joinpath("canvas_state.json").write_text(
        json.dumps(canvas, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


@pytest.fixture
def canvas_project(tmp_path, monkeypatch):
    """A v3 canvas project with a stub raw_intent.

    Yields the project id; cleans up settings.projects_dir after the test.
    """
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    pid = "proj_trope_save"
    project_dir = tmp_path / pid
    project_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": pid, "name": "trope save test"}),
        encoding="utf-8",
    )
    yield pid


def test_save_raw_intent_trope_tags_writes_only_raw_intent(canvas_project):
    """Test A: _save_raw_intent_trope_tags writes the new raw_intent and leaves
    every other canvas field (nodes, branch_choices, selected_path, etc.)
    exactly as it was on disk."""
    from backend.api.creative_diverge import _save_raw_intent_trope_tags, _read_canvas

    pid = canvas_project
    _make_canvas_v3_with_raw_intent(
        pid, raw_intent={"prompt": "一个修仙故事", "trope_tags": []}
    )

    new_raw_intent = {"prompt": "一个修仙故事", "trope_tags": ["废柴逆袭"]}
    _save_raw_intent_trope_tags(pid, raw_intent=new_raw_intent)

    canvas = _read_canvas(pid)
    assert canvas["raw_intent"] == new_raw_intent
    # Other fields preserved
    assert "wi_001_00" in canvas["nodes"]
    assert canvas["branch_choices"] == {}
    assert canvas["selected_path"] == ["wi_001_00"]
    assert canvas["schema_version"] == 3


def test_save_raw_intent_trope_tags_preserves_committed_at(canvas_project):
    """Test B (regression): when the background save_callback fires AFTER
    /commit has stamped committed_at, the marker must survive. This was the
    CRITICAL bug in the 2569bee review — _write_canvas without
    preserve_committed=True would silently erase committed_at.
    """
    from backend.api.creative_diverge import _save_raw_intent_trope_tags, _read_canvas

    pid = canvas_project
    committed_at = "2026-08-31T10:00:00+00:00"
    _make_canvas_v3_with_raw_intent(
        pid,
        raw_intent={"prompt": "x", "trope_tags": []},
        committed_at=committed_at,
    )

    # Simulate the race: background task completes after /commit stamped the
    # canvas. Without preserve_committed=True this would erase committed_at.
    _save_raw_intent_trope_tags(
        pid, raw_intent={"prompt": "x", "trope_tags": ["废柴逆袭"]}
    )

    canvas = _read_canvas(pid)
    assert canvas["committed_at"] == committed_at, (
        "REGRESSION: committed_at was erased by the background trope save "
        "callback. The 2569bee review fix is broken."
    )
    assert canvas["committed_concept_ref"] == "concept.json"
    # And the raw_intent was actually updated
    assert canvas["raw_intent"]["trope_tags"] == ["废柴逆袭"]


def test_save_raw_intent_trope_tags_is_noop_when_raw_intent_is_none(canvas_project):
    """Test C: callback can fire without an arg (defensive). Must not error
    and must not touch the canvas."""
    from backend.api.creative_diverge import _save_raw_intent_trope_tags, _read_canvas

    pid = canvas_project
    original_raw_intent = {"prompt": "x", "trope_tags": ["existing"]}
    _make_canvas_v3_with_raw_intent(pid, raw_intent=original_raw_intent)

    _save_raw_intent_trope_tags(pid, raw_intent=None)

    canvas = _read_canvas(pid)
    assert canvas["raw_intent"] == original_raw_intent


def test_init_returns_200_when_trope_llm_client_builder_raises(tmp_path, monkeypatch):
    """Test D (optional): /init must never propagate exceptions from
    _build_trope_extraction_llm_client(). The endpoint is best-effort by
    contract — a missing/broken LLM must not break the user's init flow.
    """
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.api import creative_diverge as cd_module
    from backend.api.creative_diverge import router as diverge_router

    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    pid = "proj_init_no_llm"
    project_dir = tmp_path / pid
    project_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": pid, "name": "no-llm init test"}),
        encoding="utf-8",
    )

    def _boom():
        raise RuntimeError("simulated LLM router crash")

    monkeypatch.setattr(cd_module, "_build_trope_extraction_llm_client", _boom)

    app = FastAPI()
    app.include_router(diverge_router)
    client = TestClient(app)

    # /init must still return 200
    response = client.post(
        f"/api/v1/projects/{pid}/creative/diverge/init",
        json={"premise": "测试前提"},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["error"] is False
    # raw_intent must be present but trope_tags must remain empty (no LLM = no tags)
    assert data["detail"]["raw_intent"]["prompt"] == "测试前提"
    assert data["detail"]["raw_intent"]["trope_tags"] == []
