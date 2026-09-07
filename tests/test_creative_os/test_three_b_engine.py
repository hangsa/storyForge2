"""ThreeBEngine v2 dataclass + 8 方法测试。"""
from __future__ import annotations

import json
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


def test_migrate_deletes_file_without_schema_version(tmp_path, monkeypatch):
    """A file with no schema_version key is treated as v1 and deleted."""
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    state_path = tmp_path / "proj_test" / "creative_os" / "three_b_state.json"
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps({"raw_intent": {"prompt": "x", "genre_primary": "y"}}), encoding="utf-8")
    result = migrate_state_on_load("proj_test")
    assert result is None
    assert not state_path.exists()


def test_migrate_passes_v2_state_through(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    state = ThreeBState(project_id="proj_test", schema_version=2)
    atomic_write_state("proj_test", state)
    result = migrate_state_on_load("proj_test")
    assert result is not None
    assert result.schema_version == 2


# ---- decompose ----

@pytest.mark.asyncio
async def test_decompose_returns_5_dimensions_with_insight_and_summary(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    mock_router.execute.return_value = {"content": json.dumps({
        "dimensions": [
            {"dimension": "ontology", "insight": "本土 vs 异域天道",
             "units": [{"unit_name": "灵窍", "description": "能量接口"}, {"unit_name": "本源", "description": "底层储备"}]},
            {"dimension": "energetics", "insight": "能量调谐",
             "units": [{"unit_name": "修行", "description": "能量通道"}]},
            {"dimension": "power_structure", "insight": "三要素",
             "units": [{"unit_name": "资源控制", "description": "统治基础"}]},
            {"dimension": "protagonist_engine", "insight": "跨世界信息",
             "units": [{"unit_name": "穿越", "description": "跨世界迁移"}]},
            {"dimension": "narrative_physics", "insight": "底层冲突",
             "units": [{"unit_name": "核心矛盾", "description": "不可调和"}]},
        ],
        "causal_map": "ontology → energetics → power_structure → protagonist_engine → narrative_physics",
        "top_level_summary": "这是一个穿越者在双规则天道下的觉醒与变革故事。",
    }, ensure_ascii=False)}

    intent = RawIntent(prompt="修仙", genre_primary="修仙")
    result = await engine.decompose("proj_test", intent)
    dimensions, causal_map, summary = result
    assert len(dimensions) == 5
    assert dimensions[0].dimension == DimLabel.ONTOLOGY
    assert dimensions[0].insight == "本土 vs 异域天道"
    assert dimensions[0].units[0].unit_name == "灵窍"
    assert causal_map.startswith("ontology")
    assert "觉醒与变革" in summary

    # State should be persisted
    state = load_state("proj_test")
    assert state is not None
    assert state.dimensions[0].insight == "本土 vs 异域天道"
    assert state.causal_map.startswith("ontology")
    # started_at must be captured before LLM call so duration is non-zero
    assert state.decompose_started_at != ""
    assert state.decompose_completed_at != ""
    assert state.decompose_started_at <= state.decompose_completed_at


@pytest.mark.asyncio
async def test_decompose_clears_downstream_state(tmp_path, monkeypatch, mock_router):
    """Re-decomposing should clear candidates + committed_concept from prior runs."""
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    # Seed prior state
    state = ThreeBState(
        project_id="proj_test",
        dimensions=[DimensionDecomposition(
            dimension=DimLabel.ONTOLOGY, insight="旧",
            units=[Unit(id="unit_old", dimension=DimLabel.ONTOLOGY, unit_name="旧", description="旧")],
            candidates=[UnitCandidate(id="cand_old", unit_id="unit_old", unit_name="旧", description="x", chain_reaction="y", main_operator="distort")],
            dimension_status="diverged",
        )],
        committed_concept={"one_line": "old"},
    )
    atomic_write_state("proj_test", state)

    mock_router.execute.return_value = {"content": json.dumps({
        "dimensions": [
            {"dimension": "ontology", "insight": "新", "units": [{"unit_name": "新u", "description": "新d"}]},
            {"dimension": "energetics", "insight": "新2", "units": []},
            {"dimension": "power_structure", "insight": "新3", "units": []},
            {"dimension": "protagonist_engine", "insight": "新4", "units": []},
            {"dimension": "narrative_physics", "insight": "新5", "units": []},
        ],
        "causal_map": "new", "top_level_summary": "新总结",
    }, ensure_ascii=False)}

    await engine.decompose("proj_test", RawIntent(prompt="新", genre_primary="修仙"))
    loaded = load_state("proj_test")
    assert loaded.dimensions[0].insight == "新"
    assert loaded.dimensions[0].candidates == []  # downstream cleared
    assert loaded.committed_concept is None  # downstream cleared


@pytest.mark.asyncio
async def test_decompose_raises_on_invalid_json(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    mock_router.execute.return_value = {"content": "not json"}
    with pytest.raises(Exception):
        await engine.decompose("proj_test", RawIntent(prompt="x", genre_primary="y"))


@pytest.mark.asyncio
async def test_decompose_raises_when_less_than_5_dimensions(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    mock_router.execute.return_value = {"content": json.dumps({
        "dimensions": [{"dimension": "ontology", "insight": "x", "units": []}],
        "causal_map": "y", "top_level_summary": "z",
    }, ensure_ascii=False)}
    with pytest.raises(ValueError, match=r"维度"):
        await engine.decompose("proj_test", RawIntent(prompt="x", genre_primary="y"))