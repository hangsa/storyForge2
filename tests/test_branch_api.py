"""Tests for Branch Simulation API endpoints."""
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
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": "test_project"}),
        encoding="utf-8",
    )
    project_dir.joinpath("outline.json").write_text(
        json.dumps({"chapters": [
            {"chapter_number": 1, "title": "第一章"},
            {"chapter_number": 2, "title": "第二章"},
        ]}),
        encoding="utf-8",
    )

    from backend.api.stage3_outline import router as s3_router
    from backend.api.stage3_outline import branch_router
    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(s3_router)
    app.include_router(branch_router)

    client = TestClient(app)
    yield client
    settings.projects_dir = original


class TestBranchSimulateEndpoint:

    def test_simulate_no_project(self, client):
        response = client.post(
            "/api/v1/projects/nonexistent/branches/simulate",
            json={"description": "test"},
        )
        assert response.status_code == 404

    @patch("backend.api.stage3_outline.BranchSimulator")
    def test_simulate_returns_report(self, mock_sim, client):
        from backend.models.branch_simulation import (
            BranchSimulationReport, LLMInference,
        )
        mock_instance = MagicMock()
        mock_instance.simulate = AsyncMock(return_value=BranchSimulationReport(
            branch_point_description="test",
            affected_chapter_range=(1, 2),
            affected_characters=["林峰"],
            affected_foreshadowings=["mys_001"],
            growth_curve_shifts={},
            reader_metrics_projection={"tension": "↑5"},
            tension_curve_projection=LLMInference(
                content="预测", confidence="medium", model="sonnet"
            ),
            foreshadowing_risk_assessment=LLMInference(
                content="风险", confidence="medium", model="sonnet"
            ),
            alternative_suggestions=LLMInference(
                content="替代", confidence="low", model="sonnet"
            ),
            created_at="2026-06-18T00:00:00",
            tokens_used_total=1000,
        ))
        mock_sim.return_value = mock_instance

        response = client.post(
            "/api/v1/projects/test_project/branches/simulate",
            json={"description": "改变主角的职业选择"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["error"] is False
        assert "affected_chapter_range" in data["detail"]
