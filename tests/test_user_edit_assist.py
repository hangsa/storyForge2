"""Tests for SFLogSuggestionEngine — Tier 3 user edit assist."""
import re
from unittest.mock import AsyncMock, MagicMock

import pytest


def test_sf_log_suggestion_and_diff_report_defaults():
    """SFLogSuggestion defaults + SFLogDiffReport shape."""
    from backend.agents.storyos_agent import SFLogSuggestion, SFLogDiffReport

    s = SFLogSuggestion(
        type="missing",
        severity="suggestion",
        event_type="twist_reveal",
        suggested_tag='<!-- SF_LOG twist_reveal id="tw_001" -->',
        location_hint="第三章末尾",
        reason="用户改写后隐含反转但无标记",
    )
    assert s.type == "missing"
    assert s.severity == "suggestion"

    rep = SFLogDiffReport(
        original_text="old",
        modified_text="new",
        deleted_logs=[],
        suggestions=[s],
        tokens_used=120,
    )
    assert rep.tokens_used == 120
    assert len(rep.suggestions) == 1


@pytest.mark.asyncio
async def test_engine_with_no_router_returns_empty_suggestions():
    """When no model_router is supplied, the engine must return zero LLM suggestions gracefully."""
    from backend.agents.storyos_agent import SFLogSuggestionEngine

    engine = SFLogSuggestionEngine(model_router=None)
    report = await engine.analyze_diff(
        original_text="原文内容",
        modified_text="修改后内容",
        existing_sf_logs=[],
        character_names=["林峰"],
    )
    assert report.suggestions == []
    assert report.tokens_used == 0
    # Deleted logs should still be detected (deterministic)
    assert isinstance(report.deleted_logs, list)


@pytest.mark.asyncio
async def test_engine_detects_deleted_sf_log_tags_deterministically():
    """When an SF_LOG tag is removed from the text, deleted_logs must include it. Zero LLM."""
    from backend.agents.storyos_agent import SFLogSuggestionEngine

    engine = SFLogSuggestionEngine(model_router=None)
    original = '林峰发现了证据。\n<!-- SF_LOG mystery_clue id="mys_001" -->'
    modified = "林峰发现了证据。"  # tag removed
    report = await engine.analyze_diff(
        original_text=original,
        modified_text=modified,
        existing_sf_logs=[],
        character_names=["林峰"],
    )
    assert len(report.deleted_logs) == 1
    assert "mystery_clue" in report.deleted_logs[0]["raw_text"]
    assert report.deleted_logs[0]["id"] == "mys_001"


def test_api_sf_log_suggestions_endpoint_returns_report(tmp_path, monkeypatch):
    """POST /scenes/{id}/sf-log-suggestions must return a SFLogDiffReport."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.api import stage4_writing
    from backend.llm import model_router as mr

    # Force get_model_router to return None for graceful skip
    monkeypatch.setattr(mr, "get_model_router", lambda: None)
    # Settings.projects_dir → tmp_path (irrelevant for this endpoint, but consistent)
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)

    app = FastAPI()
    app.include_router(stage4_writing.router)
    client = TestClient(app)

    resp = client.post(
        "/api/v1/projects/test_proj/scenes/ch01_scene_001/sf-log-suggestions",
        json={
            "original_text": '原文。\n<!-- SF_LOG mystery_clue id="mys_001" -->',
            "modified_text": "修改后。",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["original_text"].startswith("原文")
    assert len(body["deleted_logs"]) == 1
    assert body["deleted_logs"][0]["id"] == "mys_001"
    assert body["suggestions"] == []


@pytest.mark.asyncio
async def test_engine_routes_to_llm_and_parses_suggestions():
    """When router is provided and LLM returns JSON, suggestions are parsed correctly."""
    from backend.agents.storyos_agent import SFLogSuggestionEngine
    import json

    router = MagicMock()
    router.execute = AsyncMock(return_value={
        "content": json.dumps({
            "suggestions": [
                {
                    "type": "missing",
                    "severity": "suggestion",
                    "event_type": "twist_reveal",
                    "suggested_tag": '<!-- SF_LOG twist_reveal id="tw_new" -->',
                    "location_hint": "改写段",
                    "reason": "用户改写后角色发现真相",
                }
            ]
        }, ensure_ascii=False),
        "usage": {"input": 200, "output": 80},
        "model": "claude-haiku",
    })
    engine = SFLogSuggestionEngine(model_router=router)
    report = await engine.analyze_diff(
        original_text="原文",
        modified_text="修改后，角色发现真相",
        existing_sf_logs=[],
        character_names=["角色"],
    )
    assert len(report.suggestions) == 1
    assert report.suggestions[0].event_type == "twist_reveal"
    assert report.tokens_used == 280


def test_apply_suggestions_inserts_tags_and_is_idempotent():
    """apply_suggestions must insert new tags and skip tags already present."""
    from backend.agents.storyos_agent import SFLogSuggestion, SFLogSuggestionEngine

    text = "原始文本。"
    suggestions = [
        SFLogSuggestion(
            type="missing", severity="suggestion", event_type="twist_reveal",
            suggested_tag='<!-- SF_LOG twist_reveal id="tw_001" -->',
            location_hint="", reason="",
        ),
        SFLogSuggestion(
            type="missing", severity="suggestion", event_type="mystery_clue",
            suggested_tag='<!-- SF_LOG mystery_clue id="mys_001" -->',
            location_hint="", reason="",
        ),
    ]
    engine = SFLogSuggestionEngine(model_router=None)
    once = engine.apply_suggestions(text, suggestions)
    assert "twist_reveal" in once
    assert "mystery_clue" in once

    # Re-applying the same suggestions is a no-op (idempotent)
    twice = engine.apply_suggestions(once, suggestions)
    assert twice == once


@pytest.mark.asyncio
async def test_detect_deleted_logs_ignores_unchanged_tags():
    """Tags that appear in both original and modified must NOT be in deleted_logs."""
    from backend.agents.storyos_agent import SFLogSuggestionEngine

    engine = SFLogSuggestionEngine(model_router=None)
    common_tag = '<!-- SF_LOG mystery_clue id="mys_keep" -->'
    original = f"第一段。\n{common_tag}\n第二段。"
    modified = f"第一段修改。\n{common_tag}\n第二段修改。"
    report = await await_run(engine, original, modified)
    assert report.deleted_logs == []


@pytest.mark.asyncio
async def test_engine_filters_unsanctioned_event_types():
    """LLM may suggest any type; we filter to VALID_LOG_TYPES only."""
    from backend.agents.storyos_agent import SFLogSuggestionEngine
    import json

    router = MagicMock()
    router.execute = AsyncMock(return_value={
        "content": json.dumps({"suggestions": [
            {"type": "missing", "event_type": "evil_hacker_log", "suggested_tag": "x", "reason": "y"},
            {"type": "missing", "event_type": "twist_reveal", "suggested_tag": "ok", "reason": "kept"},
        ]}),
        "usage": {"input": 1, "output": 1},
        "model": "claude-haiku",
    })
    engine = SFLogSuggestionEngine(model_router=router)
    report = await engine.analyze_diff("a", "b", [], [])
    assert len(report.suggestions) == 1
    assert report.suggestions[0].event_type == "twist_reveal"


@pytest.mark.asyncio
async def test_engine_handles_top_level_json_list_gracefully():
    """LLM may return a top-level JSON list (e.g. '["x"]') instead of an object — must not crash."""
    from backend.agents.storyos_agent import SFLogSuggestionEngine
    import json

    router = MagicMock()
    router.execute = AsyncMock(return_value={
        "content": json.dumps(["not", "an", "object"]),
        "usage": {"input": 1, "output": 1},
        "model": "claude-haiku",
    })
    engine = SFLogSuggestionEngine(model_router=router)
    report = await engine.analyze_diff("a", "b", [], [])
    assert report.suggestions == []
    assert report.tokens_used == 0


# --- helper for the sync-via-asyncio test ---

async def await_run(engine, original, modified):
    return await engine.analyze_diff(
        original_text=original, modified_text=modified,
        existing_sf_logs=[], character_names=[],
    )

