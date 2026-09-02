"""Verify _read_canvas performs v3 → v4 lazy migration correctly.

Key invariant: committed v3 canvases must NOT be written back to disk
(v3 schema is the historical record for committed projects).
"""
import json
import pytest
from fastapi import HTTPException
from backend.api import creative_diverge
from backend.config import settings


@pytest.fixture
def tmp_projects_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    return tmp_path


def _setup_project(tmp_path, pid, canvas_data):
    project_dir = tmp_path / pid
    cos_dir = project_dir / "creative_os"
    cos_dir.mkdir(parents=True)
    (project_dir / "project.json").write_text(
        json.dumps({"id": pid, "genre": "xianxia"}),
        encoding="utf-8",
    )
    (cos_dir / "canvas_state.json").write_text(
        json.dumps(canvas_data), encoding="utf-8",
    )


def test_read_canvas_v4_returns_as_is(tmp_projects_dir):
    pid = "p_v4"
    v4_data = {"schema_version": 4, "session_id": "s1", "creative_path": []}
    _setup_project(tmp_projects_dir, pid, v4_data)
    result = creative_diverge._read_canvas(pid)
    assert result["schema_version"] == 4
    # File unchanged
    file_data = json.loads(
        (tmp_projects_dir / pid / "creative_os" / "canvas_state.json").read_text()
    )
    assert file_data == v4_data


def test_read_canvas_v3_uncommitted_migrates_and_writes_back(tmp_projects_dir):
    pid = "p_v3_active"
    v3 = {
        "schema_version": 3, "root_node_id": "wi_001_00",
        "nodes": {"wi_001_00": {"id": "wi_001_00", "content": "root",
                                 "novelty_score": 70, "children_ids": [],
                                 "depth": 0, "parent_id": None,
                                 "trope_tags": [], "saturation_warning": False,
                                 "mutation_context": None, "is_expanded": True,
                                 "branch_status": "active"}},
        "edges": [], "selected_path": ["wi_001_00"],
        "branch_choices": {}, "evaluations": {},
        "created_at": "2026-08-30T10:00:00",
        "updated_at": "2026-08-30T10:00:00",
        "committed_at": None, "committed_concept_ref": None,
        "idea_variants": [], "core_contradiction": None,
        "novelty_scores": None,
        "raw_intent": {"prompt": "p", "genre_primary": "xianxia",
                       "trope_tags": []},
        "session_metadata": {},
    }
    _setup_project(tmp_projects_dir, pid, v3)

    result = creative_diverge._read_canvas(pid)

    assert result["schema_version"] == 4
    # Disk now contains v4
    disk_data = json.loads(
        (tmp_projects_dir / pid / "creative_os" / "canvas_state.json").read_text()
    )
    # v3 fields dropped
    assert "nodes" not in disk_data
    assert "selected_path" not in disk_data
    assert "root_node_id" not in disk_data


def test_read_canvas_v3_committed_does_NOT_write_back(tmp_projects_dir):
    pid = "p_v3_committed"
    v3 = {
        "schema_version": 3, "root_node_id": "wi_001_00",
        "nodes": {"wi_001_00": {"id": "wi_001_00", "content": "root",
                                 "novelty_score": 70, "children_ids": [],
                                 "depth": 0, "parent_id": None,
                                 "trope_tags": [], "saturation_warning": False,
                                 "mutation_context": None, "is_expanded": True,
                                 "branch_status": "active"}},
        "edges": [], "selected_path": ["wi_001_00"],
        "branch_choices": {}, "evaluations": {},
        "created_at": "2026-08-30T10:00:00",
        "updated_at": "2026-08-30T10:00:00",
        "committed_at": "2026-09-01T10:00:00",
        "committed_concept_ref": "concept_and_dna.json",
        "idea_variants": [], "core_contradiction": None,
        "novelty_scores": None,
        "raw_intent": {"prompt": "p", "genre_primary": "xianxia",
                       "trope_tags": []},
        "session_metadata": {},
    }
    _setup_project(tmp_projects_dir, pid, v3)
    original_disk = json.dumps(v3, sort_keys=True)

    result = creative_diverge._read_canvas(pid)

    # Disk unchanged — v3 is the historical record
    disk_after = json.loads(
        (tmp_projects_dir / pid / "creative_os" / "canvas_state.json").read_text()
    )
    disk_after_str = json.dumps(disk_after, sort_keys=True)
    assert disk_after_str == original_disk, "committed v3 must not be overwritten"
    # But returned object is v4 (in-memory migration for read-only callers)
    assert result["schema_version"] == 4
    assert result["committed"] is True


def test_read_canvas_returns_none_for_missing_project(tmp_projects_dir):
    result = creative_diverge._read_canvas("p_nonexistent")
    assert result is None


def test_read_canvas_raises_for_unknown_schema(tmp_projects_dir):
    pid = "p_unknown"
    _setup_project(tmp_projects_dir, pid, {"schema_version": 2})
    with pytest.raises(HTTPException) as exc_info:
        creative_diverge._read_canvas(pid)
    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "UNKNOWN_SCHEMA_VERSION"
