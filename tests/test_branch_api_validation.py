"""Tests for /api/v1/projects/{id}/branches/simulate input validation."""
import json
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    d = Path(tempfile.mkdtemp())
    project_dir = d / "test_project"
    project_dir.mkdir(parents=True)
    (project_dir / "project.json").write_text(
        json.dumps({"id": "test_project"}), encoding="utf-8",
    )
    (project_dir / "outline.json").write_text(
        json.dumps({"chapters": [{"chapter_number": 1, "title": "第一章"}]}),
        encoding="utf-8",
    )

    from backend.config import settings
    original = settings.projects_dir
    settings.projects_dir = d

    from backend.api.stage3_outline import branch_router
    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(branch_router)
    yield TestClient(app)

    settings.projects_dir = original
    import shutil
    shutil.rmtree(d, ignore_errors=True)


def test_simulate_rejects_empty_description(client):
    response = client.post(
        "/api/v1/projects/test_project/branches/simulate",
        json={"description": ""},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "VALIDATION_ERROR"


def test_simulate_rejects_whitespace_only_description(client):
    response = client.post(
        "/api/v1/projects/test_project/branches/simulate",
        json={"description": "   \n\t  "},
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "VALIDATION_ERROR"


def test_simulate_rejects_description_over_1000_chars(client):
    long_desc = "a" * 1001
    response = client.post(
        "/api/v1/projects/test_project/branches/simulate",
        json={"description": long_desc},
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["code"] == "VALIDATION_ERROR"
    assert "1000" in detail["message"]
    assert detail["detail"]["max_length"] == 1000
    assert detail["detail"]["actual_length"] == 1001


def test_simulate_accepts_description_at_1000_chars(client):
    boundary_desc = "a" * 1000
    mock_router = MagicMock()
    mock_router.execute = AsyncMock(return_value={"content": "", "usage": {"input": 0, "output": 0}})
    with patch("backend.api.stage3_outline.get_model_router", return_value=mock_router):
        response = client.post(
            "/api/v1/projects/test_project/branches/simulate",
            json={"description": boundary_desc},
        )
    assert response.status_code == 200