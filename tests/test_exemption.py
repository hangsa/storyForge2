"""Tests for Creative Exemption — ExemptionManager + dataclasses."""
import json
import re
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


def test_progress_file_includes_exemptions_field():
    """ProgressFile must accept an exemptions list (default empty)."""
    from backend.models.progress import ProgressFile

    pf = ProgressFile(
        project_id="test_proj",
        current_stage="STAGE4",
        current_chapter=1,
        total_chapters=10,
    )
    assert pf.exemptions == []
    assert isinstance(pf.exemptions, list)


def test_api_submit_endpoint_creates_exemption(tmp_path, monkeypatch):
    """POST /api/.../exemptions must persist the request via ExemptionManager."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    # Seed a project directory
    proj = tmp_path / "test_proj"
    proj.mkdir()
    (proj / "progress.json").write_text(json.dumps({
        "project_id": "test_proj",
        "exemptions": [],
    }), encoding="utf-8")

    # Patch settings.projects_dir to point at tmp_path
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)

    # Import the router and create a test app
    from backend.api.stage4_writing import router
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    payload = {
        "id": "ex_api_001",
        "scene_id": "ch01_scene_001",
        "rule_to_break": {
            "layer": "fact_guard",
            "rule_id": "timeline_continuity",
            "rule_description": "时间线连续性",
            "constraint_type": "hard",
        },
        "creative_intent": "API 测试创意意图",
        "expected_effect": "API 测试预期效果",
    }
    resp = client.post("/api/v1/projects/test_proj/exemptions", json=payload)
    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == "ex_api_001"

    data = json.loads((proj / "progress.json").read_text(encoding="utf-8"))
    assert any(ex["id"] == "ex_api_001" for ex in data["exemptions"])


def test_writer_submit_exemption_if_conflict_creates_request(tmp_path):
    """Writer's submit_exemption_if_conflict must persist a request when conflicts exist."""
    from backend.agents.writer import WriterAgent

    proj = tmp_path / "test_proj"
    proj.mkdir()
    (proj / "progress.json").write_text(json.dumps({"exemptions": []}), encoding="utf-8")

    writer = WriterAgent("test_proj")
    rule_conflict = {
        "layer": "fact_guard",
        "rule_id": "timeline_continuity",
        "rule_description": "时间线连续性",
        "constraint_type": "hard",
    }
    result = writer.submit_exemption_if_conflict(
        scene_id="ch01_scene_001",
        rule_conflict=rule_conflict,
        creative_intent="主角在回忆中回到童年",
        expected_effect="情感锚点强化",
        project_dir=proj,
    )
    assert result is not None
    assert result["id"].startswith("ex_")
    assert result["status"] == "pending"

    data = json.loads((proj / "progress.json").read_text(encoding="utf-8"))
    assert len(data["exemptions"]) == 1
    assert data["exemptions"][0]["rule_to_break"]["rule_id"] == "timeline_continuity"


def test_reviewer_assembles_exemption_approval_data(tmp_path):
    """Reviewer.assemble_exemption_approval_data must group pending requests with their antipatterns."""
    import re
    from backend.agents.reviewer import ReviewerAgent

    proj = tmp_path / "test_proj"
    proj.mkdir()
    (proj / "progress.json").write_text(json.dumps({"exemptions": []}), encoding="utf-8")
    (proj / "creative_os").mkdir()
    (proj / "creative_os" / "exemption_antipatterns.json").write_text(
        json.dumps([{
            "rule_id": "timeline_continuity",
            "creative_intent_pattern": re.escape("回忆到童年"),
            "count": 5,
            "representative_case": "上一章请求类似意图被拒绝",
        }]),
        encoding="utf-8",
    )

    agent = ReviewerAgent.__new__(ReviewerAgent)
    # Seed a pending exemption
    from backend.models.exemption import ExemptionManager, ExemptionRequest
    mgr = ExemptionManager(proj)
    mgr.submit(ExemptionRequest(
        id="ex_ui_001",
        scene_id="ch01_scene_001",
        rule_to_break={"layer": "fact_guard", "rule_id": "timeline_continuity", "rule_description": "时间线", "constraint_type": "hard"},
        creative_intent="回忆到童年片段",
        expected_effect="情感强化",
    ))

    data = agent.assemble_exemption_approval_data(project_dir=proj)
    assert len(data) == 1
    item = data[0]
    assert item["id"] == "ex_ui_001"
    assert item["status"] == "pending"
    # Antipatterns should surface for the matching rule
    assert len(item["antipatterns"]) >= 1
    assert item["antipatterns"][0]["count"] == 5


def test_exemption_full_lifecycle_submit_approve_reject(tmp_path):
    """submit → approve: status=approved, approved_by populated. reject on another: status=rejected, rejected_reason populated."""
    from backend.models.exemption import ExemptionManager, ExemptionRequest

    proj = tmp_path / "test_proj"
    proj.mkdir()
    (proj / "progress.json").write_text(json.dumps({"exemptions": []}), encoding="utf-8")
    mgr = ExemptionManager(proj)

    # Submit 2 requests
    mgr.submit(ExemptionRequest(
        id="ex_life_1", scene_id="s1",
        rule_to_break={"layer": "x", "rule_id": "r1", "rule_description": "d", "constraint_type": "soft"},
        creative_intent="i1", expected_effect="e1",
    ))
    mgr.submit(ExemptionRequest(
        id="ex_life_2", scene_id="s2",
        rule_to_break={"layer": "x", "rule_id": "r2", "rule_description": "d", "constraint_type": "soft"},
        creative_intent="i2", expected_effect="e2",
    ))

    # Approve the first
    mgr.approve("ex_life_1", approved_by="user_001")
    ex1 = mgr.get("ex_life_1")
    assert ex1.status == "approved"
    assert ex1.approved_by == "user_001"

    # Reject the second
    mgr.reject("ex_life_2", reason="意图不清晰")
    ex2 = mgr.get("ex_life_2")
    assert ex2.status == "rejected"
    assert ex2.rejected_reason == "意图不清晰"


def test_exemption_evaluate_outcome_validates_value(tmp_path):
    """evaluate_outcome must reject invalid outcomes."""
    from backend.models.exemption import ExemptionManager, ExemptionRequest

    proj = tmp_path / "test_proj"
    proj.mkdir()
    (proj / "progress.json").write_text(json.dumps({"exemptions": []}), encoding="utf-8")
    mgr = ExemptionManager(proj)
    mgr.submit(ExemptionRequest(
        id="ex_out_1", scene_id="s1",
        rule_to_break={"layer": "x", "rule_id": "r", "rule_description": "d", "constraint_type": "soft"},
        creative_intent="i", expected_effect="e",
    ))
    mgr.approve("ex_out_1", approved_by="u")
    mgr.evaluate_outcome("ex_out_1", "excellent")
    assert mgr.get("ex_out_1").outcome == "excellent"

    with pytest.raises(ValueError):
        mgr.evaluate_outcome("ex_out_1", "spectacular")


def test_antipatterns_appear_after_repeated_rejections(tmp_path):
    """After ≥1 rejection with similar intent, check_antipatterns surfaces the antipattern."""
    from backend.models.exemption import ExemptionManager, ExemptionRequest

    proj = tmp_path / "test_proj"
    proj.mkdir()
    (proj / "progress.json").write_text(json.dumps({"exemptions": []}), encoding="utf-8")
    mgr = ExemptionManager(proj)
    mgr.submit(ExemptionRequest(
        id="ex_anti_1", scene_id="s1",
        rule_to_break={"layer": "x", "rule_id": "R_same", "rule_description": "d", "constraint_type": "soft"},
        creative_intent="通过角色对话让读者共情", expected_effect="e",
    ))
    mgr.reject("ex_anti_1", reason="之前已拒绝类似意图")

    matches = mgr.check_antipatterns("R_same", "通过角色对话让读者共情")
    assert len(matches) == 1
    assert matches[0].count == 1
    assert "之前已拒绝" in matches[0].representative_case