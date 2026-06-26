"""Tests for Creative Exemption — ExemptionManager + dataclasses."""
import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import pytest


def test_exemption_request_defaults():
    """ExemptionRequest must have safe defaults: status=pending, requested_by=writer."""
    from backend.models.exemption import ExemptionRequest

    req = ExemptionRequest(
        id="ex_test_001",
        scene_id="ch01_scene_001",
        rule_to_break={"layer": "fact_guard", "rule_id": "timeline_continuity", "rule_description": "时间线连续性", "constraint_type": "hard"},
        creative_intent="主角在回忆中回到童年，强化情感锚点",
        expected_effect="提升第 1 章情感张力 20%",
    )
    assert req.status == "pending"
    assert req.requested_by == "writer"
    assert req.outcome is None
    assert req.approved_by is None
    assert req.requested_at  # ISO timestamp populated


def test_exemption_manager_submit_appends_to_progress_json(tmp_path):
    """submit() must persist the request to progress.json's exemptions array."""
    from backend.models.exemption import ExemptionRequest, ExemptionManager

    # Seed an empty progress.json
    (tmp_path / "progress.json").write_text(json.dumps({
        "project_id": "test_proj",
        "current_stage": "STAGE4",
        "current_chapter": 1,
        "total_chapters": 10,
        "chapters": [],
        "circuit_breaker_events": [],
        "exemptions": [],
    }), encoding="utf-8")

    mgr = ExemptionManager(tmp_path)
    req = ExemptionRequest(
        id="ex_001",
        scene_id="ch01_scene_001",
        rule_to_break={"layer": "style_guard", "rule_id": "dialogue_length", "rule_description": "对白长度", "constraint_type": "soft"},
        creative_intent="长对白强化人物",
        expected_effect="人物对话张力",
    )
    mgr.submit(req)

    data = json.loads((tmp_path / "progress.json").read_text(encoding="utf-8"))
    assert len(data["exemptions"]) == 1
    assert data["exemptions"][0]["id"] == "ex_001"
    assert data["exemptions"][0]["status"] == "pending"