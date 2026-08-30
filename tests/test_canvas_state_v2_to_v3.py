"""Tests for canvas_state.json v2 → v3 auto-migration on read.

v3 adds: idea_variants, core_contradiction, novelty_scores, raw_intent,
session_metadata. Existing v2 canvases must transparently upgrade on first
read so the file is rewritten as v3 atomically.
"""
import json

import pytest
from backend.config import settings


@pytest.fixture
def project_v2_canvas(tmp_path):
    """Set up a project with a v2 canvas_state.json on disk."""
    original = settings.projects_dir
    settings.projects_dir = tmp_path

    pid = "proj_v2_test"
    project_dir = tmp_path / pid
    creative_os_dir = project_dir / "creative_os"
    creative_os_dir.mkdir(parents=True)
    canvas_v2 = {
        "schema_version": 2,
        "root_node_id": "wi_001_00",
        "nodes": {
            "wi_001_00": {
                "id": "wi_001_00", "depth": 0, "parent_id": None,
                "content": "测试前提", "dimension": "角色动机",
                "novelty_score": 70, "trope_tags": [],
                "saturation_warning": False,
                "mutation_context": {
                    "mut": "inversion",
                    "logic": "反转为A→非A",
                },
                "children_ids": [],
                "is_expanded": True, "branch_status": "active",
            },
        },
        "edges": [],
        "selected_path": ["wi_001_00"],
        "branch_choices": {},
        "evaluations": {},
        "created_at": "2026-08-30T10:00:00",
        "updated_at": "2026-08-30T10:00:00",
        "committed_at": None,
        "committed_concept_ref": None,
    }
    creative_os_dir.joinpath("canvas_state.json").write_text(
        json.dumps(canvas_v2, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    yield pid
    settings.projects_dir = original


def test_v2_migrates_to_v3_on_read(project_v2_canvas):
    from backend.api.creative_diverge import _read_canvas
    canvas = _read_canvas(project_v2_canvas)
    assert canvas["schema_version"] == 3
    assert canvas["core_contradiction"] is None
    assert canvas["novelty_scores"] is None
    assert canvas["raw_intent"] is None
    assert "session_metadata" in canvas
    assert canvas["session_metadata"]["operation_count"] == 0


def test_v2_idea_variants_extracted_from_mutation_context(project_v2_canvas):
    from backend.api.creative_diverge import _read_canvas
    canvas = _read_canvas(project_v2_canvas)
    assert len(canvas["idea_variants"]) == 1
    iv = canvas["idea_variants"][0]
    assert iv["mutation_type"] == "inversion"
    assert iv["mutation_logic"] == "反转为A→非A"
    assert iv["regenerated_count"] == 0


def test_v2_migration_persists_to_disk(project_v2_canvas):
    from backend.api.creative_diverge import _read_canvas, _get_canvas_path
    _read_canvas(project_v2_canvas)
    path = _get_canvas_path(project_v2_canvas)
    with open(path, "r", encoding="utf-8") as f:
        persisted = json.load(f)
    assert persisted["schema_version"] == 3


def test_empty_nodes_handles_gracefully(tmp_path):
    """v2 canvas with no nodes should still migrate cleanly (no crash)."""
    original = settings.projects_dir
    settings.projects_dir = tmp_path

    pid = "proj_empty_nodes"
    project_dir = tmp_path / pid
    creative_os_dir = project_dir / "creative_os"
    creative_os_dir.mkdir(parents=True)
    canvas_v2 = {
        "schema_version": 2,
        "root_node_id": None,
        "nodes": {},
        "edges": [],
        "selected_path": [],
        "branch_choices": {},
        "evaluations": {},
        "created_at": "2026-08-30T10:00:00",
        "updated_at": "2026-08-30T10:00:00",
    }
    creative_os_dir.joinpath("canvas_state.json").write_text(
        json.dumps(canvas_v2, ensure_ascii=False),
        encoding="utf-8",
    )
    try:
        from backend.api.creative_diverge import _read_canvas
        canvas = _read_canvas(pid)
        assert canvas["schema_version"] == 3
        assert canvas["idea_variants"] == []
    finally:
        settings.projects_dir = original


def test_empty_mutation_context_handles_gracefully(tmp_path):
    """v2 node with empty mutation_context (no `mut` key) should be skipped."""
    original = settings.projects_dir
    settings.projects_dir = tmp_path

    pid = "proj_empty_mc"
    project_dir = tmp_path / pid
    creative_os_dir = project_dir / "creative_os"
    creative_os_dir.mkdir(parents=True)
    canvas_v2 = {
        "schema_version": 2,
        "root_node_id": "wi_001_00",
        "nodes": {
            "wi_001_00": {
                "id": "wi_001_00", "depth": 0, "parent_id": None,
                "content": "Root",
                "novelty_score": 50, "trope_tags": [],
                "mutation_context": {},  # empty — should not crash
                "children_ids": [],
                "is_expanded": False, "branch_status": "active",
            },
        },
        "edges": [],
        "selected_path": ["wi_001_00"],
        "branch_choices": {},
        "evaluations": {},
        "created_at": "x", "updated_at": "x",
    }
    creative_os_dir.joinpath("canvas_state.json").write_text(
        json.dumps(canvas_v2, ensure_ascii=False),
        encoding="utf-8",
    )
    try:
        from backend.api.creative_diverge import _read_canvas
        canvas = _read_canvas(pid)
        assert canvas["schema_version"] == 3
        # node had no `mut` key → no idea_variants generated
        assert canvas["idea_variants"] == []
    finally:
        settings.projects_dir = original


def test_v3_canvas_round_trips_through_migration_idempotent(project_v2_canvas):
    """Reading a v2 canvas once should produce v3; reading the v3 again should
    not re-migrate (idempotent) — schema_version stays 3 and same fields persist."""
    from backend.api.creative_diverge import _read_canvas, _get_canvas_path

    # First read: v2 → v3, persists v3 to disk
    canvas_first = _read_canvas(project_v2_canvas)
    assert canvas_first["schema_version"] == 3

    # Second read: now disk has v3, so no migration runs
    canvas_second = _read_canvas(project_v2_canvas)
    assert canvas_second["schema_version"] == 3
    assert len(canvas_second["idea_variants"]) == 1
    # session_metadata preserved across reads
    assert canvas_second["session_metadata"]["operation_count"] == 0