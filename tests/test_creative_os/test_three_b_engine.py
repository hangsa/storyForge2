"""ThreeBEngine v2 dataclass + 8 方法测试。"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from backend.creative_os.three_b_engine import (
    Dimension,
    DimensionDecomposition,
    RawIntent,
    ThreeBEngine,
    ThreeBState,
    Unit,
    UnitCandidate,
    atomic_write_state,
    load_state,
    migrate_state_on_load,
)
from backend.services.dimension_labels import Dimension as DimLabel


@pytest.fixture
def mock_router():
    """Router mock returning deterministic LLM responses."""
    router = AsyncMock()
    return router


# ---- dataclass round-trip ----

def test_state_round_trip(tmp_path, monkeypatch):
    """State writes + loads preserve all fields."""
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    state = ThreeBState(
        project_id="proj_test",
        raw_intent=RawIntent(prompt="修仙", genre_primary="修仙"),
        causal_map="A → B",
        top_level_summary="一句话总结",
        dimensions=[
            DimensionDecomposition(
                dimension=DimLabel.ONTOLOGY,
                insight="本土 vs 异域",
                units=[Unit(id="unit_abc", dimension=DimLabel.ONTOLOGY, unit_name="灵窍", description="能量接口")],
                candidates=[UnitCandidate(
                    id="cand_xyz", unit_id="unit_abc", unit_name="灵窍",
                    description="变异", chain_reaction="连锁变化",
                    main_operator="distort", aux_operator="break", selection_rank=0,
                )],
                dimension_status="diverged",
            )
        ],
        committed_concept={"one_line": "x"},
    )
    atomic_write_state("proj_test", state)
    loaded = load_state("proj_test")
    assert loaded is not None
    assert loaded.schema_version == 2
    assert loaded.causal_map == "A → B"
    assert loaded.dimensions[0].dimension == DimLabel.ONTOLOGY
    assert loaded.dimensions[0].units[0].unit_name == "灵窍"
    assert loaded.dimensions[0].candidates[0].main_operator == "distort"


def test_state_round_trip_handles_empty_dimensions(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    state = ThreeBState(project_id="proj_test")
    atomic_write_state("proj_test", state)
    loaded = load_state("proj_test")
    assert loaded.dimensions == []


def test_state_file_is_atomic_no_tmp_left(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    state = ThreeBState(project_id="proj_test")
    atomic_write_state("proj_test", state)
    parent = tmp_path / "proj_test" / "creative_os"
    tmp_files = list(parent.glob(".three_b_state.json.*.tmp"))
    assert tmp_files == []


# ---- migrate v1→v2 ----

def test_migrate_deletes_v1_file(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    state_path = tmp_path / "proj_test" / "creative_os" / "three_b_state.json"
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps({"schema_version": 1, "stage1_completed_at": "2026-09-01"}), encoding="utf-8")
    result = migrate_state_on_load("proj_test")
    assert result is None
    assert not state_path.exists()


def test_migrate_returns_none_when_no_file(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    assert migrate_state_on_load("proj_test") is None


def test_migrate_passes_v2_state_through(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    state = ThreeBState(project_id="proj_test", schema_version=2)
    atomic_write_state("proj_test", state)
    result = migrate_state_on_load("proj_test")
    assert result is not None
    assert result.schema_version == 2