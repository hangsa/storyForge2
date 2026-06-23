"""Tests for Creative Canvas API endpoints."""
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

    # Create test project
    project_dir = temp_dir / "test_project"
    project_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": "test_project", "initial_intent": {"free_text": "测试"}}),
        encoding="utf-8",
    )
    creative_os_dir = project_dir / "creative_os"
    creative_os_dir.mkdir(parents=True)
    creative_os_dir.joinpath("canvas_state.json").write_text(
        json.dumps({
            "root_node_id": "wi_001_00",
            "nodes": {
                "wi_001_00": {
                    "id": "wi_001_00", "depth": 0, "parent_id": None,
                    "content": "测试前提", "dimension": "角色动机",
                    "novelty_score": 70, "trope_tags": [], "is_expanded": False,
                    "children_ids": [],
                },
            },
            "edges": [],
            "selected_path": ["wi_001_00"],
            "created_at": "2026-06-18T00:00:00",
            "updated_at": "2026-06-18T00:00:00",
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    from backend.api.creative_canvas import router
    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    yield client
    settings.projects_dir = original


class TestCanvasStateEndpoint:

    def test_get_state(self, client):
        response = client.get(
            "/api/v1/projects/test_project/creative/canvas/state"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["error"] is False
        assert "nodes" in data["detail"]
        assert data["detail"]["root_node_id"] == "wi_001_00"

    def test_get_state_no_project(self, client):
        response = client.get(
            "/api/v1/projects/nonexistent/creative/canvas/state"
        )
        assert response.status_code == 404


class TestCanvasInitEndpoint:

    def test_init_canvas(self, client):
        with patch(
            "backend.creative_os.whatif_engine.WhatIfEngine"
        ) as mock_engine:
            mock_instance = MagicMock()
            mock_instance.generate_root.return_value = MagicMock(
                id="wi_001_00", depth=0, parent_id=None,
                content="new root",
                branch_status="active",
                novelty_score=0, trope_tags=[], is_expanded=False,
                children_ids=[], saturation_warning=None,
            )
            mock_engine.return_value = mock_instance

            response = client.post(
                "/api/v1/projects/test_project/creative/canvas/init",
                json={"premise": "测试前提"},
            )
            assert response.status_code == 200
            data = response.json()
            assert data["error"] is False
            assert data["code"] == "OK"
