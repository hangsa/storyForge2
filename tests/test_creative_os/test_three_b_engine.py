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


class _FakeNoveltyScore:
    """Stand-in for backend.models.creative_os.NoveltyScore — duck-typed to the
    attributes engine.commit serializes into state.novelty_scores."""
    def __init__(self) -> None:
        self.total = 0.0
        self.market_saturation_score = 0.0
        self.trope_similarity_score = 0.0
        self.contradiction_depth_score = 0.0
        self.discussion_potential_score = 0.0
        self.grade = "n/a"


class _FakeNoveltyEvaluator:
    """Stand-in for NoveltyEvaluator; sidesteps TropePool catalog dependency
    that breaks when tests patch settings.projects_dir to tmp_path."""
    def evaluate(self, content):
        return _FakeNoveltyScore()


@pytest.fixture
def fake_novelty_evaluator():
    return _FakeNoveltyEvaluator()


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


# ---- engine.follow_up_unit ----

@pytest.mark.asyncio
async def test_follow_up_unit_replaces_description_in_place(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    state = ThreeBState(
        project_id="proj_test",
        dimensions=[DimensionDecomposition(
            dimension=DimLabel.ONTOLOGY, insight="i",
            units=[Unit(id="unit_abc", dimension=DimLabel.ONTOLOGY, unit_name="灵窍", description="old desc")],
        )],
    )
    atomic_write_state("proj_test", state)

    mock_router.execute.return_value = {"content": json.dumps({
        "unit_name": "灵窍", "description": "new desc",
    }, ensure_ascii=False)}

    unit = await engine.follow_up_unit("proj_test", "unit_abc", user_question="能更具体吗?")
    assert unit.description == "new desc"
    assert unit.follow_up_count == 1

    reloaded = load_state("proj_test")
    assert reloaded.dimensions[0].units[0].description == "new desc"
    assert reloaded.dimensions[0].units[0].follow_up_count == 1


@pytest.mark.asyncio
async def test_follow_up_unit_empty_question_uses_default(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    state = ThreeBState(project_id="proj_test", dimensions=[DimensionDecomposition(
        dimension=DimLabel.ONTOLOGY, insight="i",
        units=[Unit(id="unit_abc", dimension=DimLabel.ONTOLOGY, unit_name="x", description="d")],
    )])
    atomic_write_state("proj_test", state)
    mock_router.execute.return_value = {"content": json.dumps({"unit_name": "x", "description": "d2"})}
    unit = await engine.follow_up_unit("proj_test", "unit_abc", user_question=None)
    assert unit.follow_up_count == 1
    assert unit.description == "d2"


@pytest.mark.asyncio
async def test_follow_up_unit_rejects_irreducible(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    state = ThreeBState(project_id="proj_test", dimensions=[DimensionDecomposition(
        dimension=DimLabel.ONTOLOGY, insight="i",
        units=[Unit(id="unit_abc", dimension=DimLabel.ONTOLOGY, unit_name="x", description="d", is_irreducible=True)],
    )])
    atomic_write_state("proj_test", state)
    with pytest.raises(ValueError, match="不可约化"):
        await engine.follow_up_unit("proj_test", "unit_abc", user_question="x")
    reloaded = load_state("proj_test")
    assert reloaded.dimensions[0].units[0].follow_up_count == 0  # rejected call must not mutate state


@pytest.mark.asyncio
async def test_follow_up_unit_preserves_is_irreducible_flag(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    state = ThreeBState(project_id="proj_test", dimensions=[DimensionDecomposition(
        dimension=DimLabel.ONTOLOGY, insight="i",
        units=[Unit(id="unit_abc", dimension=DimLabel.ONTOLOGY, unit_name="x", description="d")],
    )])
    atomic_write_state("proj_test", state)
    mock_router.execute.return_value = {"content": json.dumps({"unit_name": "x", "description": "d2", "is_irreducible": True})}
    unit = await engine.follow_up_unit("proj_test", "unit_abc", user_question="x")
    assert unit.is_irreducible is True
    reloaded = load_state("proj_test")
    assert reloaded.dimensions[0].units[0].is_irreducible is True  # persisted


@pytest.mark.asyncio
async def test_follow_up_unit_raises_on_invalid_json(tmp_path, monkeypatch, mock_router):
    """Non-JSON LLM response should raise engine-friendly ValueError (not raw json.JSONDecodeError)."""
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    state = ThreeBState(project_id="proj_test", dimensions=[DimensionDecomposition(
        dimension=DimLabel.ONTOLOGY, insight="i",
        units=[Unit(id="unit_abc", dimension=DimLabel.ONTOLOGY, unit_name="x", description="d")],
    )])
    atomic_write_state("proj_test", state)
    mock_router.execute.return_value = {"content": "not json"}
    with pytest.raises(ValueError, match=r"非 JSON"):
        await engine.follow_up_unit("proj_test", "unit_abc", user_question=None)


# ---- engine.diverge ----

@pytest.mark.asyncio
async def test_diverge_runs_one_llm_per_unit_in_parallel(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    units = [
        Unit(id=f"unit_{i}", dimension=DimLabel.ONTOLOGY, unit_name=f"u{i}", description=f"d{i}")
        for i in range(3)
    ]
    state = ThreeBState(
        project_id="proj_test",
        raw_intent=RawIntent(prompt="修仙", genre_primary="修仙"),
        dimensions=[
            DimensionDecomposition(dimension=DimLabel.ONTOLOGY, insight="i", units=units),
        ],
    )
    atomic_write_state("proj_test", state)

    async def fake_execute(*args, **kwargs):
        return {"content": json.dumps({
            "candidates": [
                {"description": f"v{i}", "chain_reaction": f"cr{i}", "main_operator": "distort", "selection_rank": i}
                for i in range(2)
            ],
        }, ensure_ascii=False)}
    mock_router.execute.side_effect = fake_execute

    dims = await engine.diverge("proj_test")
    assert len(dims) == 1
    assert mock_router.execute.call_count == 3  # per-unit LLM 调用
    assert dims[0].dimension_status == "diverged"
    # 每个 unit 2 候选
    for unit in units:
        cands = [c for c in dims[0].candidates if c.unit_id == unit.id]
        assert len(cands) == 2
        assert cands[0].unit_name == unit.unit_name

    reloaded = load_state("proj_test")
    assert len(reloaded.dimensions[0].candidates) == 6
    assert reloaded.diverge_started_at is not None
    assert reloaded.diverge_completed_at is not None
    assert reloaded.diverge_started_at <= reloaded.diverge_completed_at


@pytest.mark.asyncio
async def test_diverge_degrades_per_unit_on_failure(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    units = [Unit(id=f"unit_{i}", dimension=DimLabel.ONTOLOGY, unit_name=f"u{i}", description=f"d{i}") for i in range(3)]
    state = ThreeBState(
        project_id="proj_test",
        raw_intent=RawIntent(prompt="修仙", genre_primary="修仙"),
        dimensions=[DimensionDecomposition(
            dimension=DimLabel.ONTOLOGY, insight="i", units=units,
        )],
    )
    atomic_write_state("proj_test", state)

    async def fake_execute(*args, **kwargs):
        # unit_0 的 unit_name 是 "u0",出现在 user message 里
        user_msg = kwargs.get("messages", [{}, {}])[1].get("content", "")
        if "单元描述: d0" in user_msg:
            raise RuntimeError("LLM 超时")
        return {"content": json.dumps({"candidates": [
            {"description": "v", "chain_reaction": "cr", "main_operator": "distort", "selection_rank": 0},
        ]})}
    mock_router.execute.side_effect = fake_execute

    dims = await engine.diverge("proj_test")
    cands_per_unit = {c.unit_id: c for u in units for c in dims[0].candidates if c.unit_id == u.id}
    assert "unit_0" not in cands_per_unit  # unit_0 失败,candidates 空
    assert "unit_1" in cands_per_unit
    assert "unit_2" in cands_per_unit
    assert dims[0].dimension_status == "diverged"  # 部分成功仍算 diverged


@pytest.mark.asyncio
async def test_diverge_clears_committed_concept(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    state = ThreeBState(
        project_id="proj_test",
        raw_intent=RawIntent(prompt="修仙", genre_primary="修仙"),
        committed_concept={"one_line": "old"},
        novelty_scores={"total": 0.8},
        commit_started_at="2026-09-01T00:00:00+00:00",
        commit_completed_at="2026-09-01T00:01:00+00:00",
        dimensions=[DimensionDecomposition(
            dimension=DimLabel.ONTOLOGY, insight="i",
            units=[Unit(id="unit_1", dimension=DimLabel.ONTOLOGY, unit_name="u", description="d")],
        )],
    )
    atomic_write_state("proj_test", state)
    mock_router.execute.return_value = {"content": json.dumps({"candidates": [{"description": "v", "chain_reaction": "cr", "main_operator": "distort", "selection_rank": 0}]})}
    await engine.diverge("proj_test")
    reloaded = load_state("proj_test")
    assert reloaded.committed_concept is None
    assert reloaded.novelty_scores is None
    assert reloaded.commit_started_at is None
    assert reloaded.commit_completed_at is None


@pytest.mark.asyncio
async def test_diverge_raises_when_all_units_fail(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    units = [Unit(id=f"unit_{i}", dimension=DimLabel.ONTOLOGY, unit_name=f"u{i}", description=f"d{i}") for i in range(2)]
    state = ThreeBState(
        project_id="proj_test",
        raw_intent=RawIntent(prompt="修仙", genre_primary="修仙"),
        dimensions=[DimensionDecomposition(
            dimension=DimLabel.ONTOLOGY, insight="i", units=units,
        )],
    )
    atomic_write_state("proj_test", state)
    mock_router.execute.side_effect = RuntimeError("全部失败")
    with pytest.raises(RuntimeError, match="全部"):
        await engine.diverge("proj_test")
    # 失败不应写盘(committed 之前的状态保持)
    reloaded = load_state("proj_test")
    assert reloaded.dimensions[0].candidates == []
    assert reloaded.diverge_completed_at is None


@pytest.mark.asyncio
async def test_diverge_rerun_replaces_candidates_not_appends(tmp_path, monkeypatch, mock_router):
    """整轮重跑 diverge 应替换 candidates,而非累积。"""
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    state = ThreeBState(
        project_id="proj_test",
        raw_intent=RawIntent(prompt="修仙", genre_primary="修仙"),
        dimensions=[DimensionDecomposition(
            dimension=DimLabel.ONTOLOGY, insight="i",
            units=[Unit(id="unit_1", dimension=DimLabel.ONTOLOGY, unit_name="u", description="d")],
        )],
    )
    atomic_write_state("proj_test", state)
    mock_router.execute.return_value = {"content": json.dumps({"candidates": [
        {"description": "v", "chain_reaction": "cr", "main_operator": "distort", "selection_rank": 0},
        {"description": "v2", "chain_reaction": "cr2", "main_operator": "break", "selection_rank": 1},
    ]})}
    await engine.diverge("proj_test")
    dims = await engine.diverge("proj_test")
    assert len(dims[0].candidates) == 2  # not 4
    assert len(load_state("proj_test").dimensions[0].candidates) == 2


# ---- regenerate_unit ----

@pytest.mark.asyncio
async def test_regenerate_unit_replaces_candidates_for_that_unit_only(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    state = ThreeBState(
        project_id="proj_test",
        raw_intent=RawIntent(prompt="x", genre_primary="y"),
        dimensions=[DimensionDecomposition(
            dimension=DimLabel.ONTOLOGY, insight="i",
            units=[
                Unit(id="unit_a", dimension=DimLabel.ONTOLOGY, unit_name="a", description="da"),
                Unit(id="unit_b", dimension=DimLabel.ONTOLOGY, unit_name="b", description="db"),
            ],
            candidates=[
                UnitCandidate(id="cand_old_a1", unit_id="unit_a", unit_name="a", description="old_a1", chain_reaction="r", main_operator="distort"),
                UnitCandidate(id="cand_old_a2", unit_id="unit_a", unit_name="a", description="old_a2", chain_reaction="r", main_operator="distort"),
                UnitCandidate(id="cand_old_b", unit_id="unit_b", unit_name="b", description="old_b", chain_reaction="r", main_operator="distort"),
            ],
        )],
    )
    atomic_write_state("proj_test", state)

    mock_router.execute.return_value = {"content": json.dumps({"candidates": [
        {"description": "new_a1", "chain_reaction": "r", "main_operator": "break", "selection_rank": 0},
        {"description": "new_a2", "chain_reaction": "r", "main_operator": "break", "selection_rank": 1},
    ]})}

    new_cands = await engine.regenerate_unit("proj_test", "unit_a")
    assert len(new_cands) == 2
    assert all(c.unit_id == "unit_a" for c in new_cands)
    reloaded = load_state("proj_test")
    reloaded_a_cands = [c for c in reloaded.dimensions[0].candidates if c.unit_id == "unit_a"]
    reloaded_b_cands = [c for c in reloaded.dimensions[0].candidates if c.unit_id == "unit_b"]
    assert len(reloaded_a_cands) == 2  # unit_a 重生
    assert all(c.description.startswith("new_a") for c in reloaded_a_cands)
    assert len(reloaded_b_cands) == 1  # unit_b 保留
    assert reloaded_b_cands[0].description == "old_b"


@pytest.mark.asyncio
async def test_regenerate_unit_clears_committed_concept(tmp_path, monkeypatch, mock_router):
    """Regenerating a unit must invalidate any prior committed_concept (mirrors diverge)."""
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    state = ThreeBState(
        project_id="proj_test",
        raw_intent=RawIntent(prompt="x", genre_primary="y"),
        committed_concept={"one_line": "old"},
        novelty_scores={"novelty": 0.7},
        commit_started_at="2026-09-01T00:00:00",
        commit_completed_at="2026-09-01T00:00:05",
        dimensions=[DimensionDecomposition(
            dimension=DimLabel.ONTOLOGY, insight="i",
            units=[Unit(id="unit_a", dimension=DimLabel.ONTOLOGY, unit_name="a", description="da")],
            candidates=[UnitCandidate(id="c1", unit_id="unit_a", unit_name="a", description="old", chain_reaction="r", main_operator="distort")],
        )],
    )
    atomic_write_state("proj_test", state)
    mock_router.execute.return_value = {"content": json.dumps({
        "candidates": [{"description": "new", "chain_reaction": "r", "main_operator": "break", "selection_rank": 0}],
    })}
    await engine.regenerate_unit("proj_test", "unit_a")
    reloaded = load_state("proj_test")
    assert reloaded.committed_concept is None
    assert reloaded.novelty_scores is None
    assert reloaded.commit_started_at is None
    assert reloaded.commit_completed_at is None


def test_select_unit_candidate_swaps_rank(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine()
    state = ThreeBState(project_id="proj_test", dimensions=[DimensionDecomposition(
        dimension=DimLabel.ONTOLOGY, insight="i",
        units=[Unit(id="unit_a", dimension=DimLabel.ONTOLOGY, unit_name="a", description="d")],
        candidates=[
            UnitCandidate(id="c1", unit_id="unit_a", unit_name="a", description="first", chain_reaction="r", main_operator="distort", selection_rank=0),
            UnitCandidate(id="c2", unit_id="unit_a", unit_name="a", description="second", chain_reaction="r", main_operator="distort", selection_rank=1),
        ],
    )])
    atomic_write_state("proj_test", state)
    dim = engine.select_unit_candidate("proj_test", "unit_a", candidate_index=1)
    cands = dim.candidates
    assert cands[1].selection_rank == 0  # 候选 1 提升到 rank 0
    assert cands[0].selection_rank == 1


def test_select_unit_candidate_rejects_out_of_range(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine()
    state = ThreeBState(project_id="proj_test", dimensions=[DimensionDecomposition(
        dimension=DimLabel.ONTOLOGY, insight="i",
        units=[Unit(id="u", dimension=DimLabel.ONTOLOGY, unit_name="u", description="d")],
        candidates=[UnitCandidate(id="c", unit_id="u", unit_name="u", description="d", chain_reaction="r", main_operator="distort")],
    )])
    atomic_write_state("proj_test", state)
    with pytest.raises(ValueError, match="超出范围"):
        engine.select_unit_candidate("proj_test", "u", candidate_index=5)


# ---- engine.commit ----

@pytest.mark.asyncio
async def test_commit_synthesizes_5_fields(tmp_path, monkeypatch, mock_router, fake_novelty_evaluator):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router, novelty_evaluator=fake_novelty_evaluator)
    units = [Unit(id=f"unit_{i}", dimension=DimLabel.ONTOLOGY, unit_name=f"u{i}", description=f"d{i}") for i in range(5)]
    candidates = [
        UnitCandidate(id=f"cand_{i}", unit_id=f"unit_{i}", unit_name=f"u{i}", description=f"cd{i}",
                      chain_reaction=f"cr{i}", main_operator="distort", selection_rank=0)
        for i in range(5)
    ]
    state = ThreeBState(
        project_id="proj_test",
        causal_map="A → B → C",
        top_level_summary="一句话总结",
        raw_intent=RawIntent(prompt="x", genre_primary="y"),
        dimensions=[DimensionDecomposition(dimension=DimLabel.ONTOLOGY, insight="i", units=units, candidates=candidates)],
    )
    atomic_write_state("proj_test", state)

    mock_router.execute.return_value = {"content": json.dumps({
        "one_line": "一句话", "expanded": "100-200字", "core_tension": "50-80字",
        "tone": "暗黑", "logline": "≤80字",
    }, ensure_ascii=False)}

    result = await engine.commit("proj_test")
    assert result["committed_concept"]["one_line"] == "一句话"
    assert result["committed_concept"]["tone"] == "暗黑"
    assert result["committed_concept"]["edited_by_user"] is False
    reloaded = load_state("proj_test")
    assert reloaded.committed_concept["one_line"] == "一句话"


@pytest.mark.asyncio
async def test_commit_rejects_when_too_few_candidates(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    # 20 units,只有 2 个有候选 (< MIN_UNITS_WITH_CANDIDATES_FOR_COMMIT = 3)
    units = [Unit(id=f"unit_{i}", dimension=DimLabel.ONTOLOGY, unit_name=f"u{i}", description=f"d{i}") for i in range(20)]
    candidates = [
        UnitCandidate(id=f"cand_{i}", unit_id=f"unit_{i}", unit_name=f"u{i}", description=f"cd{i}",
                      chain_reaction=f"cr{i}", main_operator="distort", selection_rank=0)
        for i in range(2)
    ]
    state = ThreeBState(
        project_id="proj_test",
        raw_intent=RawIntent(prompt="x", genre_primary="y"),
        dimensions=[DimensionDecomposition(dimension=DimLabel.ONTOLOGY, insight="i", units=units, candidates=candidates)],
    )
    atomic_write_state("proj_test", state)
    with pytest.raises(ValueError, match="候选不足"):
        await engine.commit("proj_test")


@pytest.mark.asyncio
async def test_commit_includes_failed_units_in_prompt(tmp_path, monkeypatch, mock_router, fake_novelty_evaluator):
    """Failed units (no candidates) should be marked in prompt as [unit X 未参与]."""
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router, novelty_evaluator=fake_novelty_evaluator)
    units = [Unit(id=f"unit_{i}", dimension=DimLabel.ONTOLOGY, unit_name=f"u{i}", description=f"d{i}") for i in range(5)]
    candidates = [
        UnitCandidate(id=f"cand_{i}", unit_id=f"unit_{i}", unit_name=f"u{i}", description=f"cd{i}",
                      chain_reaction=f"cr{i}", main_operator="distort", selection_rank=0)
        for i in range(3)  # 只有 3 个有候选
    ]
    state = ThreeBState(
        project_id="proj_test",
        raw_intent=RawIntent(prompt="x", genre_primary="y"),
        dimensions=[DimensionDecomposition(dimension=DimLabel.ONTOLOGY, insight="i", units=units, candidates=candidates)],
    )
    atomic_write_state("proj_test", state)

    captured_messages = []
    async def fake_execute(*args, **kwargs):
        captured_messages.append(kwargs.get("messages"))
        return {"content": json.dumps({"one_line": "x", "expanded": "x", "core_tension": "x", "tone": "x", "logline": "x"})}
    mock_router.execute.side_effect = fake_execute

    await engine.commit("proj_test")
    user_msg = captured_messages[0][1]["content"]
    assert "未参与" in user_msg  # unit_3 和 unit_4 标记为未参与


@pytest.mark.asyncio
async def test_edit_committed_concept_overrides_fields(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine()
    state = ThreeBState(
        project_id="proj_test",
        committed_concept={"one_line": "原", "expanded": "原", "core_tension": "原", "tone": "原", "logline": "原", "edited_by_user": False},
    )
    atomic_write_state("proj_test", state)
    result = await engine.edit_committed_concept("proj_test", {"one_line": "新", "tone": "新调"})
    assert result["committed_concept"]["one_line"] == "新"
    assert result["committed_concept"]["tone"] == "新调"
    assert result["committed_concept"]["expanded"] == "原"  # 未编辑字段保留
    assert result["committed_concept"]["edited_by_user"] is True


@pytest.mark.asyncio
async def test_edit_committed_concept_rejects_unknown_fields(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine()
    state = ThreeBState(project_id="proj_test", committed_concept={"one_line": "x"})
    atomic_write_state("proj_test", state)
    with pytest.raises(ValueError, match="未知字段"):
        await engine.edit_committed_concept("proj_test", {"unknown_field": "y"})


@pytest.mark.asyncio
async def test_edit_committed_concept_rejects_when_no_concept(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine()
    state = ThreeBState(project_id="proj_test")
    atomic_write_state("proj_test", state)
    with pytest.raises(ValueError, match="未提交"):
        await engine.edit_committed_concept("proj_test", {"one_line": "x"})


# ---- Task 9: engine.advance ----

@pytest.mark.asyncio
async def test_advance_writes_concept_and_dna_and_divergence(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    state = ThreeBState(
        project_id="proj_test",
        raw_intent=RawIntent(prompt="修仙", genre_primary="修仙"),
        committed_concept={"one_line": "x", "expanded": "y", "core_tension": "z", "tone": "w", "logline": "v", "edited_by_user": False},
        novelty_scores={"composite": 60, "grade": "B+"},
    )
    atomic_write_state("proj_test", state)
    mock_router.execute.return_value = {"content": json.dumps({"one_line": "x", "expanded": "y", "core_tension": "z", "tone": "w", "logline": "v"})}

    result = await engine.advance("proj_test")
    assert result["written"] is True
    assert "committed_at" in result

    # concept_and_dna.json
    dna_path = tmp_path / "proj_test" / "concept_and_dna.json"
    assert dna_path.exists()
    dna = json.loads(dna_path.read_text(encoding="utf-8"))
    assert dna["concept"]["one_line"] == "x"
    assert dna["story_dna"]["tone"] == "w"
    assert dna["novelty_scores"]["grade"] == "B+"
    assert dna["three_b_snapshot"]["schema_version"] == 2

    # creative_divergence.json
    div_path = tmp_path / "proj_test" / "creative_divergence.json"
    assert div_path.exists()
    div = json.loads(div_path.read_text(encoding="utf-8"))
    assert div["source"] == "creative_divergence"
    assert "修仙" in div["prompt"]


@pytest.mark.asyncio
async def test_advance_calls_commit_when_no_concept(tmp_path, monkeypatch, mock_router, fake_novelty_evaluator):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router, novelty_evaluator=fake_novelty_evaluator)
    # 设 state 但 committed_concept = None + 充分 units 有候选
    units = [Unit(id=f"unit_{i}", dimension=DimLabel.ONTOLOGY, unit_name=f"u{i}", description=f"d{i}") for i in range(5)]
    candidates = [
        UnitCandidate(id=f"cand_{i}", unit_id=f"unit_{i}", unit_name=f"u{i}", description=f"cd{i}",
                      chain_reaction=f"cr{i}", main_operator="distort", selection_rank=0)
        for i in range(5)
    ]
    state = ThreeBState(
        project_id="proj_test",
        raw_intent=RawIntent(prompt="x", genre_primary="y"),
        dimensions=[DimensionDecomposition(dimension=DimLabel.ONTOLOGY, insight="i", units=units, candidates=candidates)],
    )
    atomic_write_state("proj_test", state)
    mock_router.execute.return_value = {"content": json.dumps({"one_line": "auto", "expanded": "auto", "core_tension": "auto", "tone": "auto", "logline": "auto"})}

    await engine.advance("proj_test")
    reloaded = load_state("proj_test")
    assert reloaded.committed_concept["one_line"] == "auto"
    assert (tmp_path / "proj_test" / "concept_and_dna.json").exists()


@pytest.mark.asyncio
async def test_advance_is_idempotent(tmp_path, monkeypatch, mock_router):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    engine = ThreeBEngine(model_router=mock_router)
    state = ThreeBState(project_id="proj_test", committed_concept={"one_line": "x", "expanded": "y", "core_tension": "z", "tone": "w", "logline": "v", "edited_by_user": False})
    atomic_write_state("proj_test", state)
    mock_router.execute.return_value = {"content": json.dumps({"one_line": "x"})}  # 不该被调用
    await engine.advance("proj_test")
    await engine.advance("proj_test")  # 第二次
    # mock_router.execute 应只调用 0 次(committed_concept 已存在)
    assert mock_router.execute.call_count == 0