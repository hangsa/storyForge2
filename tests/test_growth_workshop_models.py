# tests/test_growth_workshop_models.py
from backend.growth_curve.workshop.models import (
    ConsistencyWarning, WorkshopCheckResult, WorkshopAdjustRequest,
    WorkshopDiscussRequest, WorkshopDiscussResponse,
)

def test_consistency_warning_minimal():
    w = ConsistencyWarning(rule_id="out_of_range", severity="error", message="too far")
    assert w.stage_index is None
    assert w.suggestion is None

def test_consistency_warning_full():
    w = ConsistencyWarning(
        rule_id="low_misaligned", severity="warning", stage_index=2,
        chapter_number=12, message="no high conflict", suggestion="add escalation",
    )
    assert w.stage_index == 2

def test_workshop_check_result_roundtrip():
    r = WorkshopCheckResult(
        character_id="c1",
        warnings=[ConsistencyWarning(rule_id="tight_spacing", severity="warning", message="too close")],
        checked_at="2026-06-29T10:00:00Z",
    )
    d = r.model_dump()
    assert d["character_id"] == "c1"
    assert d["warnings"][0]["rule_id"] == "tight_spacing"

def test_workshop_adjust_request_accepts_stages():
    from backend.models.character import GrowthStage
    req = WorkshopAdjustRequest(stages=[GrowthStage(stage_number=1, stage_name="起点")])
    assert len(req.stages) == 1

def test_workshop_discuss_request_and_response():
    req = WorkshopDiscussRequest(question="节奏是否合适？")
    assert req.question == "节奏是否合适？"
    resp = WorkshopDiscussResponse(answer="均衡", suggestions=["减少中段转折"])
    assert len(resp.suggestions) == 1