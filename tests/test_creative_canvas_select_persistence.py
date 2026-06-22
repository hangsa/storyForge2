"""Tests that /select persists evaluations in canvas_state.json."""
import json
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def temp_dir():
    d = tempfile.mkdtemp()
    yield Path(d)
    import shutil
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def client_with_canvas(temp_dir):
    from backend.config import settings
    original = settings.projects_dir
    settings.projects_dir = temp_dir

    project_dir = temp_dir / "proj_test"
    project_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": "proj_test", "initial_intent": {"free_text": "x"}}),
        encoding="utf-8",
    )

    canvas_file = project_dir / "creative_os" / "canvas_state.json"
    canvas_file.parent.mkdir(parents=True, exist_ok=True)
    canvas_file.write_text(json.dumps({
        "root_node_id": "wi_001_00",
        "nodes": {
            "wi_001_00": {
                "id": "wi_001_00", "depth": 0, "parent_id": None,
                "content": "Root", "dimension": "情节方向",
                "novelty_score": 75.0, "trope_tags": [],
                "saturation_warning": None, "children_ids": ["wi_002_00"],
                "is_expanded": True,
            },
            "wi_002_00": {
                "id": "wi_002_00", "depth": 1, "parent_id": "wi_001_00",
                "content": "Leaf", "dimension": "角色动机",
                "novelty_score": 80.0, "trope_tags": [],
                "saturation_warning": None, "children_ids": [],
                "is_expanded": False,
            },
        },
        "edges": [],
        "selected_path": ["wi_001_00"],
    }), encoding="utf-8")

    from backend.main import app
    with TestClient(app) as c:
        yield c, settings.projects_dir

    settings.projects_dir = original


def test_select_persists_evaluation_to_canvas_state(client_with_canvas):
    client, projects_dir = client_with_canvas

    # Mock CreativeDirector.evaluate_path to return a known string
    with patch("backend.agents.creative_director.CreativeDirector") as mock_director_cls:
        mock_director = mock_director_cls.return_value
        mock_director.evaluate_path = AsyncMock(return_value="TEST_EVALUATION_TEXT")

        response = client.post(
            "/api/v1/projects/proj_test/creative/canvas/select",
            json={"path_node_ids": ["wi_001_00", "wi_002_00"]},
        )

    assert response.status_code == 200
    assert response.json()["detail"]["evaluation"] == "TEST_EVALUATION_TEXT"

    # Verify persistence
    canvas_file = projects_dir / "proj_test" / "creative_os" / "canvas_state.json"
    canvas = json.loads(canvas_file.read_text(encoding="utf-8"))
    assert "evaluations" in canvas
    path_hash = "wi_001_00::wi_002_00"
    assert path_hash in canvas["evaluations"]
    assert canvas["evaluations"][path_hash]["evaluation"] == "TEST_EVALUATION_TEXT"
    assert "evaluated_at" in canvas["evaluations"][path_hash]