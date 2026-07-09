"""Tests for DELETE /creative/canvas/state endpoint."""
import json
import tempfile
from pathlib import Path

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

    project_dir = temp_dir / "proj_test"
    project_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": "proj_test", "initial_intent": {"free_text": "x"}}),
        encoding="utf-8",
    )

    canvas_file = project_dir / "creative_os" / "canvas_state.json"
    canvas_file.parent.mkdir(parents=True, exist_ok=True)
    canvas_file.write_text(
        json.dumps({
            "root_node_id": "wi_001_00",
            "nodes": {"wi_001_00": {"id": "wi_001_00", "depth": 0}},
            "edges": [],
            "selected_path": ["wi_001_00"],
        }),
        encoding="utf-8",
    )

    from backend.main import app
    with TestClient(app) as c:
        yield c

    settings.projects_dir = original


def test_delete_canvas_removes_state_file(client):
    response = client.delete("/api/v1/projects/proj_test/creative/canvas/state")
    assert response.status_code == 200
    data = response.json()
    assert data["error"] is False
    assert data["code"] == "OK"
    assert data["detail"]["root_node_id"] is None
    assert data["detail"]["nodes"] == {}


def test_delete_canvas_on_uninitialized_project_is_idempotent(client):
    import shutil
    from backend.config import settings

    canvas_file = settings.projects_dir / "proj_test" / "creative_os" / "canvas_state.json"
    if canvas_file.exists():
        canvas_file.unlink()

    response = client.delete("/api/v1/projects/proj_test/creative/canvas/state")
    assert response.status_code == 200
    assert response.json()["code"] == "OK"


def test_delete_canvas_on_unknown_project_returns_404():
    with tempfile.TemporaryDirectory() as td:
        from backend.config import settings
        original = settings.projects_dir
        settings.projects_dir = Path(td)

        from backend.main import app
        with TestClient(app) as c:
            response = c.delete("/api/v1/projects/proj_unknown/creative/canvas/state")
            assert response.status_code == 404

        settings.projects_dir = original