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

