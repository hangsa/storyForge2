"""Tests for POST /api/v1/projects/{id}/creative/canvas/choose-branch."""
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


def _seed_canvas(temp_dir, project_id="proj_test", nodes=None,
                 branch_choices=None, selected_path=None):
    project_dir = temp_dir / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "project.json").write_text(
        json.dumps({"id": project_id, "initial_intent": {"free_text": "x"}}),
        encoding="utf-8",
    )
    canvas = {
        "schema_version": 2,
        "root_node_id": "a",
        "nodes": nodes,
        "edges": [],
        "selected_path": selected_path or ["a"],
        "branch_choices": branch_choices or {},
        "evaluations": {},
        "created_at": "2026-01-01T00:00:00",
        "updated_at": "2026-01-01T00:00:00",
    }
    canvas_file = project_dir / "creative_os" / "canvas_state.json"
    canvas_file.parent.mkdir(parents=True, exist_ok=True)
    canvas_file.write_text(json.dumps(canvas), encoding="utf-8")
    return canvas_file


def _node(id, *, parent=None, children=(), status="active", expanded=False):
    return {
        "id": id, "depth": 0 if parent is None else 1,
        "parent_id": parent, "content": id,
        "novelty_score": 0, "trope_tags": [],
        "saturation_warning": None,
        "children_ids": list(children),
        "is_expanded": expanded,
        "branch_status": status,
    }


@pytest.fixture
def client(temp_dir):
    from backend.config import settings
    original = settings.projects_dir
    settings.projects_dir = temp_dir

    # Ensure the default test project exists so uninitialized-canvas tests
    # see PROJECT_NOT_FOUND only when an explicit nonexistent project is used.
    project_dir = temp_dir / "proj_test"
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "project.json").write_text(
        json.dumps({"id": "proj_test", "initial_intent": {"free_text": "x"}}),
        encoding="utf-8",
    )

    from backend.main import app
    with TestClient(app) as c:
        yield c
    settings.projects_dir = original


def _setup_with_expanded_root(temp_dir):
    """Root a is expanded with 3 children: b (active), c, d (both dimmed)."""
    return _seed_canvas(
        temp_dir,
        nodes={
            "a": _node("a", children=["b", "c", "d"], expanded=True),
            "b": _node("b", parent="a", status="active"),
            "c": _node("c", parent="a", status="dimmed"),
            "d": _node("d", parent="a", status="dimmed"),
        },
        branch_choices={"a": "b"},
        selected_path=["a", "b"],
    )


def test_choose_branch_switches_active_path(client, temp_dir):
    _setup_with_expanded_root(temp_dir)

    with patch("backend.agents.creative_director.CreativeDirector") as mock_dir:
        mock_dir.return_value.evaluate_path = AsyncMock(return_value="OK")

        resp = client.post(
            "/api/v1/projects/proj_test/creative/canvas/choose-branch",
            json={"parent_node_id": "a", "chosen_child_id": "c"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["error"] is False
    assert body["detail"]["selected_path"] == ["a", "c"]

    canvas = json.loads(
        (temp_dir / "proj_test" / "creative_os" / "canvas_state.json").read_text()
    )
    assert canvas["branch_choices"]["a"] == "c"
    assert canvas["nodes"]["b"]["branch_status"] == "dimmed"
    assert canvas["nodes"]["c"]["branch_status"] == "active"
    assert canvas["nodes"]["d"]["branch_status"] == "dimmed"
    assert canvas["selected_path"] == ["a", "c"]


def test_choose_branch_validates_child_in_parent_children(client, temp_dir):
    _setup_with_expanded_root(temp_dir)

    resp = client.post(
        "/api/v1/projects/proj_test/creative/canvas/choose-branch",
        json={"parent_node_id": "a", "chosen_child_id": "ghost"},
    )

    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "INVALID_CHILD"


def test_choose_branch_rejects_unexpanded_parent(client, temp_dir):
    _seed_canvas(
        temp_dir,
        nodes={
            "a": _node("a", children=["b"], expanded=False),
            "b": _node("b", parent="a"),
        },
        branch_choices={},
        selected_path=["a"],
    )

    resp = client.post(
        "/api/v1/projects/proj_test/creative/canvas/choose-branch",
        json={"parent_node_id": "a", "chosen_child_id": "b"},
    )

    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "PARENT_NOT_EXPANDED"


def test_choose_branch_clears_descendant_choices_below_new_active(
    client, temp_dir
):
    """When switching to a previously-dimmed child, drop any branch_choices
    below the new active that pointed to the OLD active's descendants."""
    _seed_canvas(
        temp_dir,
        nodes={
            "a": _node("a", children=["b", "c"], expanded=True),
            "b": _node("b", parent="a", status="active", children=["e"], expanded=True),
            "c": _node("c", parent="a", status="dimmed"),
            "e": _node("e", parent="b", status="active"),
        },
        branch_choices={"a": "b", "b": "e"},
        selected_path=["a", "b", "e"],
    )

    with patch("backend.agents.creative_director.CreativeDirector") as mock_dir:
        mock_dir.return_value.evaluate_path = AsyncMock(return_value="OK")
        resp = client.post(
            "/api/v1/projects/proj_test/creative/canvas/choose-branch",
            json={"parent_node_id": "a", "chosen_child_id": "c"},
        )

    assert resp.status_code == 200

    canvas = json.loads(
        (temp_dir / "proj_test" / "creative_os" / "canvas_state.json").read_text()
    )
    assert "b" not in canvas["branch_choices"]
    assert canvas["branch_choices"]["a"] == "c"
    assert canvas["nodes"]["b"]["branch_status"] == "dimmed"
    assert canvas["nodes"]["e"]["branch_status"] == "dimmed"


def test_choose_branch_404_on_unknown_parent(client, temp_dir):
    _setup_with_expanded_root(temp_dir)

    resp = client.post(
        "/api/v1/projects/proj_test/creative/canvas/choose-branch",
        json={"parent_node_id": "ghost", "chosen_child_id": "b"},
    )

    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "NODE_NOT_FOUND"


def test_choose_branch_400_when_canvas_uninitialized(client, temp_dir):
    resp = client.post(
        "/api/v1/projects/proj_test/creative/canvas/choose-branch",
        json={"parent_node_id": "a", "chosen_child_id": "b"},
    )

    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "CANVAS_NOT_INITIALIZED"