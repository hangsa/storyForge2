"""Tests for canvas_state.json v1 → v2 migration."""
from backend.api.creative_canvas import _migrate_v1_to_v2


def test_v1_with_dimension_field_drops_it():
    v1 = {
        "root_node_id": "wi_001_00",
        "nodes": {
            "wi_001_00": {
                "id": "wi_001_00", "depth": 0, "parent_id": None,
                "content": "Root", "dimension": "情节方向",
                "novelty_score": 0, "trope_tags": [],
                "saturation_warning": None,
                "children_ids": ["wi_001_01", "wi_001_02"],
                "is_expanded": True,
            },
            "wi_001_01": {
                "id": "wi_001_01", "depth": 1, "parent_id": "wi_001_00",
                "content": "A", "dimension": "角色动机",
                "novelty_score": 70, "trope_tags": [],
                "saturation_warning": None,
                "children_ids": [], "is_expanded": False,
            },
            "wi_001_02": {
                "id": "wi_001_02", "depth": 1, "parent_id": "wi_001_00",
                "content": "B", "dimension": "读者体验",
                "novelty_score": 80, "trope_tags": [],
                "saturation_warning": None,
                "children_ids": [], "is_expanded": False,
            },
        },
        "edges": [],
        "selected_path": ["wi_001_00", "wi_001_01"],
        "created_at": "2026-01-01T00:00:00",
        "updated_at": "2026-01-01T00:00:00",
    }

    v2 = _migrate_v1_to_v2(v1)

    assert v2["schema_version"] == 2
    for nid, node in v2["nodes"].items():
        assert "dimension" not in node
        assert node["branch_status"] == "active"
    assert v2["created_at"] == "2026-01-01T00:00:00"


def test_v1_rebuilds_branch_choices_from_selected_path():
    v1 = {
        "root_node_id": "wi_001_00",
        "nodes": {
            "wi_001_00": {
                "id": "wi_001_00", "depth": 0, "parent_id": None,
                "content": "Root", "dimension": "情节方向",
                "novelty_score": 0, "trope_tags": [],
                "saturation_warning": None,
                "children_ids": ["wi_001_01"], "is_expanded": True,
            },
            "wi_001_01": {
                "id": "wi_001_01", "depth": 1, "parent_id": "wi_001_00",
                "content": "A", "dimension": "角色动机",
                "novelty_score": 70, "trope_tags": [],
                "saturation_warning": None,
                "children_ids": [], "is_expanded": False,
            },
        },
        "edges": [],
        "selected_path": ["wi_001_00", "wi_001_01"],
        "created_at": "x", "updated_at": "x",
    }

    v2 = _migrate_v1_to_v2(v1)
    assert v2["branch_choices"] == {"wi_001_00": "wi_001_01"}


def test_v2_canvas_round_trips_through_migration_idempotent():
    v2 = {
        "schema_version": 2,
        "root_node_id": "wi_001_00",
        "nodes": {
            "wi_001_00": {
                "id": "wi_001_00", "depth": 0, "parent_id": None,
                "content": "Root", "novelty_score": 0, "trope_tags": [],
                "saturation_warning": None,
                "children_ids": [], "is_expanded": False,
                "branch_status": "active",
            },
        },
        "edges": [],
        "selected_path": ["wi_001_00"],
        "branch_choices": {},
        "evaluations": {},
        "created_at": "x", "updated_at": "x",
    }

    result = _migrate_v1_to_v2(v2)
    assert result == v2
