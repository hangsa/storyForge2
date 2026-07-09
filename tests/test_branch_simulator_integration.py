"""End-to-end test: API simulate endpoint reaches LLM and returns inferences."""
import json
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def temp_dir():
    d = tempfile.mkdtemp()
    yield Path(d)
    import shutil
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def client(temp_dir):
    from backend.config import settings
    original = settings.projects_dir
    settings.projects_dir = temp_dir

    project_dir = temp_dir / "test_project"
    project_dir.mkdir(parents=True)
    (project_dir / "project.json").write_text(
        json.dumps({"id": "test_project"}), encoding="utf-8",
    )
    (project_dir / "outline.json").write_text(
        json.dumps({"chapters": [{"chapter_number": 1, "title": "第一章"}]}),
        encoding="utf-8",
    )

    from backend.api.stage3_outline import branch_router
    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(branch_router)
    yield TestClient(app)
    settings.projects_dir = original


@pytest.fixture
def mock_router():
    router = MagicMock()
    router.execute = AsyncMock(return_value={
        "content": json.dumps({
            "tension_curve": {"content": "张力预测", "confidence": "high"},
            "foreshadowing_risk": {"content": "风险评估", "confidence": "medium"},
            "alternative_suggestions": {"content": "替代方案", "confidence": "low"},
        }, ensure_ascii=False),
        "usage": {"input": 1000, "output": 400},
        "model": "claude-sonnet-4",
        "tier": "tier_1",
        "cost": 0.01,
    })
    return router


def test_simulate_endpoint_invokes_llm_via_router(client, mock_router):
    """The simulate endpoint must call model_router.execute, not bypass it."""
    with patch("backend.api.stage3_outline.get_model_router", return_value=mock_router):
        response = client.post(
            "/api/v1/projects/test_project/branches/simulate",
            json={"description": "改变主角的职业"},
        )
    assert response.status_code == 200
    data = response.json()
    detail = data["detail"]
    assert detail["tension_curve_projection"] is not None
    assert detail["tension_curve_projection"]["confidence"] == "high"
    assert detail["foreshadowing_risk_assessment"] is not None
    assert detail["alternative_suggestions"] is not None
    mock_router.execute.assert_awaited_once()
    call_kwargs = mock_router.execute.await_args.kwargs
    assert call_kwargs["agent_name"] == "creative_director"
    assert call_kwargs["task_name"] == "fusion_analysis"
    assert call_kwargs["json_mode"] is True


def test_simulate_endpoint_survives_router_unavailable(client):
    """When get_model_router() raises, endpoint still returns deterministic fields."""
    def boom():
        raise RuntimeError("router offline")
    with patch("backend.api.stage3_outline.get_model_router", side_effect=boom):
        response = client.post(
            "/api/v1/projects/test_project/branches/simulate",
            json={"description": "分支变更"},
        )
    assert response.status_code == 200
    detail = response.json()["detail"]
    assert detail["tension_curve_projection"] is None
    assert detail["affected_chapter_range"] == [1, 1]
    assert detail["tokens_used_total"] == 0