"""Tests for the 6 canvas invariants enforced before write."""
import pytest

from backend.api.creative_canvas import (
    _validate_canvas_invariants,
    CanvasInvariantError,
)


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


def test_invariant_1_branch_choices_for_expanded_nodes():
    canvas = {
        "root_node_id": "a",
        "nodes": {
            "a": _node("a", children=["b", "c"], expanded=True),
            "b": _node("b", parent="a"),
            "c": _node("c", parent="a"),
        },
        "branch_choices": {},  # missing
        "selected_path": ["a"],
    }
    with pytest.raises(CanvasInvariantError, match="expanded"):
        _validate_canvas_invariants(canvas)


def test_invariant_2_selected_path_is_linear_chain():
    canvas = {
        "root_node_id": "a",
        "nodes": {
            "a": _node("a", children=["b"]),
            "b": _node("b", parent="a", children=["c"]),
            "c": _node("c", parent="b"),
            "x": _node("x"),  # unrelated
        },
        "branch_choices": {"a": "b", "b": "c"},
        "selected_path": ["a", "b", "x"],  # x not in b's children
    }
    with pytest.raises(CanvasInvariantError, match="linear"):
        _validate_canvas_invariants(canvas)


def test_invariant_3_selected_path_nodes_all_active():
    canvas = {
        "root_node_id": "a",
        "nodes": {
            "a": _node("a", children=["b"], expanded=True),
            "b": _node("b", parent="a", status="dimmed"),
        },
        "branch_choices": {"a": "b"},
        "selected_path": ["a", "b"],
    }
    with pytest.raises(CanvasInvariantError, match="active"):
        _validate_canvas_invariants(canvas)


def test_invariant_4_branch_choices_point_to_real_children():
    canvas = {
        "root_node_id": "a",
        "nodes": {
            "a": _node("a", children=["b"], expanded=True),
            "b": _node("b", parent="a"),
        },
        "branch_choices": {"a": "ghost"},  # not in children_ids
        "selected_path": ["a"],
    }
    with pytest.raises(CanvasInvariantError, match="child"):
        _validate_canvas_invariants(canvas)


def test_invariant_5_dimmed_node_children_all_dimmed():
    canvas = {
        "root_node_id": "a",
        "nodes": {
            "a": _node("a", children=["b", "c"], expanded=True),
            "b": _node("b", parent="a", status="dimmed", children=["d"]),
            "c": _node("c", parent="a"),
            "d": _node("d", parent="b", status="active"),  # violation
        },
        "branch_choices": {"a": "c"},
        "selected_path": ["a", "c"],
    }
    with pytest.raises(CanvasInvariantError, match="dimmed"):
        _validate_canvas_invariants(canvas)


def test_invariant_6_root_is_active():
    canvas = {
        "root_node_id": "a",
        "nodes": {
            "a": _node("a", children=[], status="dimmed"),
        },
        "branch_choices": {},
        "selected_path": ["a"],
    }
    with pytest.raises(CanvasInvariantError, match="root"):
        _validate_canvas_invariants(canvas)


def test_valid_canvas_passes_validation():
    canvas = {
        "root_node_id": "a",
        "nodes": {
            "a": _node("a", children=["b"], expanded=True),
            "b": _node("b", parent="a", status="active"),
        },
        "branch_choices": {"a": "b"},
        "selected_path": ["a", "b"],
    }
    _validate_canvas_invariants(canvas)  # should not raise


def test_dimmed_expanded_node_exempt_from_invariant_1():
    """A dimmed+expanded node doesn't need branch_choices — it's off the
    active path and its children are all dimmed (invariant 5)."""
    canvas = {
        "root_node_id": "a",
        "nodes": {
            "a": _node("a", children=["b", "c"], expanded=True),
            "b": _node("b", parent="a", status="active", expanded=True),
            "c": _node("c", parent="a", status="dimmed", expanded=True),
            "d": _node("d", parent="c", status="dimmed"),
        },
        "branch_choices": {"a": "b"},  # c is dimmed, no entry needed
        "selected_path": ["a", "b"],
    }
    _validate_canvas_invariants(canvas)  # should not raise