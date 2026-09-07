"""Tests for /api/v1/projects/{id}/creative/diverge/three-b/* routes.

Covers all 10 endpoints + 1 convenience (reset-and-restart):

- GET    /state              — 404 when missing, 200 when present
- DELETE /state              — 404 when missing, 200 + file removed
- POST   /decompose          — 422 on short prompt, happy + ValueError + RuntimeError
- POST   /follow-up          — happy + 422 + 503
- POST   /diverge            — happy + 503
- POST   /regenerate-unit    — happy + 503
- POST   /select-unit        — happy + 422 (out-of-range / unknown unit)
- POST   /commit             — happy + 422 + 503
- POST   /edit-concept       — happy + 422 (unknown field rejected)
- POST   /advance            — happy (writes both concept_and_dna + creative_divergence)
- POST   /reset-and-restart  — idempotent
"""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from backend.config import settings
from backend.creative_os.three_b_engine import (
    ALLOWED_EDIT_FIELDS,
    Dimension,
    DimensionDecomposition,
    RawIntent,
    ThreeBEngine,
    ThreeBState,
    Unit,
    UnitCandidate,
    atomic_write_state,
)
from backend.main import app
from backend.services.dimension_labels import Dimension as DimLabel

client = TestClient(app)

PROJ_PREFIX = "p_3b_"
BASE = "/api/v1/projects/{project_id}/creative/diverge/three-b"


# ---------------------------------------------------------------------------
# Shared fakes / helpers
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_router():
    """AsyncMock router — engine.replace_methods() can still await it.

    Note: the route tests replace engine methods entirely (e.g.
    `engine.decompose = fake_async`), so the router itself rarely gets
    called — kept here for parity with the engine tests and for the
    `/advance` happy path which exercises the real `commit()` → router.
    """
    return AsyncMock()


class _FakeNoveltyScore:
    """Stand-in duck-typed to the attributes engine.commit serializes."""

    def __init__(self) -> None:
        self.total = 0.62
        self.market_saturation_score = 0.7
        self.trope_similarity_score = 0.5
        self.contradiction_depth_score = 0.65
        self.discussion_potential_score = 0.6
        self.grade = "B"


class _FakeNoveltyEvaluator:
    """Sidesteps TropePool catalog dependency."""

    def evaluate(self, content: Any) -> _FakeNoveltyScore:
        return _FakeNoveltyScore()


@pytest.fixture(autouse=True)
def _patch_projects_dir(tmp_path, monkeypatch):
    """Route all reads/writes to a per-test tmp dir."""
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield tmp_path


@pytest.fixture(autouse=True)
def _reset_engine_state():
    """Each test gets a fresh engine wired to a mock router + fake novelty.

    Injecting into `app.state.three_b_engine` lets us avoid any module-level
    state caching the way the old v1 routes had with `_engine`.
    """
    yield
    if hasattr(app.state, "three_b_engine"):
        del app.state.three_b_engine


def _make_engine(
    mock_router: AsyncMock,
    novelty_evaluator: Any = None,
) -> ThreeBEngine:
    return ThreeBEngine(
        model_router=mock_router,
        novelty_evaluator=novelty_evaluator or _FakeNoveltyEvaluator(),
    )


def _inject_engine(engine: ThreeBEngine) -> None:
    app.state.three_b_engine = engine


def _make_unit(
    unit_id: str,
    dim: Dimension,
    name: str = "u",
    description: str = "d",
) -> Unit:
    return Unit(
        id=unit_id,
        dimension=dim,
        unit_name=name,
        description=description,
    )


def _make_dim(
    dim: Dimension,
    units: list[Unit],
    candidates: list[UnitCandidate] | None = None,
    insight: str = "i",
    status: str = "diverged",
) -> DimensionDecomposition:
    return DimensionDecomposition(
        dimension=dim,
        insight=insight,
        units=units,
        candidates=list(candidates or []),
        dimension_status=status,  # type: ignore[arg-type]
    )


def _seed_basic_state(project_id: str, base: Path) -> ThreeBState:
    """Seed a v2 state with 5 dimensions × 1 unit each, the first 3 units
    having candidates (so /commit won't reject as too few)."""
    u1 = _make_unit("unit_aaa", DimLabel.ONTOLOGY, name="灵窍", description="能量接口")
    u2 = _make_unit("unit_bbb", DimLabel.ENERGETICS, name="灵力", description="灵力流")
    u3 = _make_unit("unit_ccc", DimLabel.POWER_STRUCTURE, name="朝廷", description="权力结构")
    u4 = _make_unit("unit_ddd", DimLabel.PROTAGONIST_ENGINE, name="主角", description="金手指")
    u5 = _make_unit("unit_eee", DimLabel.NARRATIVE_PHYSICS, name="节奏", description="节奏")
    candidates = [
        UnitCandidate(
            id="cand_x1",
            unit_id="unit_aaa",
            unit_name="灵窍",
            description="变异灵窍",
            chain_reaction="连锁",
            main_operator="distort",
            selection_rank=0,
        ),
        UnitCandidate(
            id="cand_x2",
            unit_id="unit_bbb",
            unit_name="灵力",
            description="逆向灵力",
            chain_reaction="连锁",
            main_operator="break",
            selection_rank=0,
        ),
        UnitCandidate(
            id="cand_x3",
            unit_id="unit_ccc",
            unit_name="朝廷",
            description="双面朝廷",
            chain_reaction="连锁",
            main_operator="blend",
            selection_rank=0,
        ),
    ]
    state = ThreeBState(
        project_id=project_id,
        raw_intent=RawIntent(
            prompt="一个少年在废墟里觉醒",
            genre_primary="玄幻",
            genre_secondary="科幻",
        ),
        causal_map="A → B",
        top_level_summary="一句话",
        dimensions=[
            _make_dim(DimLabel.ONTOLOGY, [u1], candidates=[candidates[0]]),
            _make_dim(DimLabel.ENERGETICS, [u2], candidates=[candidates[1]]),
            _make_dim(DimLabel.POWER_STRUCTURE, [u3], candidates=[candidates[2]]),
            _make_dim(DimLabel.PROTAGONIST_ENGINE, [u4]),
            _make_dim(DimLabel.NARRATIVE_PHYSICS, [u5]),
        ],
        committed_concept={
            "one_line": "x",
            "expanded": "y",
            "core_tension": "z",
            "tone": "t",
            "logline": "l",
            "edited_by_user": False,
        },
        novelty_scores={"total": 0.5},
    )
    atomic_write_state(project_id, state)
    proj_dir = base / project_id
    proj_dir.mkdir(parents=True, exist_ok=True)
    return state


def _route(path: str, project_id: str) -> str:
    return BASE.format(project_id=project_id) + path


# ---------------------------------------------------------------------------
# GET /state
# ---------------------------------------------------------------------------


def test_state_404_when_no_file():
    resp = client.get(_route("/state", f"{PROJ_PREFIX}none"))
    assert resp.status_code == 404
    assert "state 不存在" in resp.json()["detail"]


def test_state_returns_existing(tmp_path):
    _seed_basic_state(f"{PROJ_PREFIX}get", tmp_path)
    resp = client.get(_route("/state", f"{PROJ_PREFIX}get"))
    assert resp.status_code == 200
    data = resp.json()
    assert data["schema_version"] == 2
    assert data["raw_intent"]["prompt"] == "一个少年在废墟里觉醒"
    assert len(data["dimensions"]) == 5
    assert data["dimensions"][0]["units"][0]["unit_name"] == "灵窍"


def test_state_returns_404_for_v1_state_migrated_to_null(tmp_path):
    """A v1 state file on disk triggers migration → deletion → None."""
    proj_dir = tmp_path / f"{PROJ_PREFIX}v1"
    proj_dir.mkdir(parents=True)
    (proj_dir / "creative_os").mkdir()
    (proj_dir / "creative_os" / "three_b_state.json").write_text(
        json.dumps({"schema_version": 1, "project_id": "p_3b_v1", "stage2_candidates": []}),
        encoding="utf-8",
    )
    resp = client.get(_route("/state", f"{PROJ_PREFIX}v1"))
    assert resp.status_code == 404
    # Migration deleted the v1 file
    assert not (proj_dir / "creative_os" / "three_b_state.json").exists()


# ---------------------------------------------------------------------------
# DELETE /state
# ---------------------------------------------------------------------------


def test_state_delete_404_when_no_file():
    resp = client.delete(_route("/state", f"{PROJ_PREFIX}del_none"))
    assert resp.status_code == 404


def test_state_delete_removes_file(tmp_path):
    _seed_basic_state(f"{PROJ_PREFIX}del", tmp_path)
    resp = client.delete(_route("/state", f"{PROJ_PREFIX}del"))
    assert resp.status_code == 200
    assert resp.json() == {"deleted": True}
    state_path = (
        tmp_path
        / f"{PROJ_PREFIX}del"
        / "creative_os"
        / "three_b_state.json"
    )
    assert not state_path.exists()


# ---------------------------------------------------------------------------
# POST /decompose
# ---------------------------------------------------------------------------


def test_decompose_422_on_too_short_prompt():
    resp = client.post(
        _route("/decompose", f"{PROJ_PREFIX}dec_short"),
        json={"prompt": "短", "genre_primary": "玄幻"},
    )
    # Pydantic min_length=10 → 422 validation error
    assert resp.status_code == 422


def test_decompose_happy_path(mock_router):
    dims = [
        _make_dim(
            DimLabel.ONTOLOGY,
            [_make_unit("unit_aaa", DimLabel.ONTOLOGY)],
            insight="i1",
        ),
        _make_dim(
            DimLabel.ENERGETICS,
            [_make_unit("unit_bbb", DimLabel.ENERGETICS)],
            insight="i2",
        ),
        _make_dim(
            DimLabel.POWER_STRUCTURE,
            [_make_unit("unit_ccc", DimLabel.POWER_STRUCTURE)],
            insight="i3",
        ),
        _make_dim(
            DimLabel.PROTAGONIST_ENGINE,
            [_make_unit("unit_ddd", DimLabel.PROTAGONIST_ENGINE)],
            insight="i4",
        ),
        _make_dim(
            DimLabel.NARRATIVE_PHYSICS,
            [_make_unit("unit_eee", DimLabel.NARRATIVE_PHYSICS)],
            insight="i5",
        ),
    ]
    mock_router.execute = AsyncMock(return_value={"content": "{}"})
    engine = _make_engine(mock_router)

    # Patch decompose to return our pre-built dims deterministically.
    async def fake_decompose(project_id, raw_intent):
        return dims, "cmap", "summary"

    engine.decompose = fake_decompose  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(
        _route("/decompose", f"{PROJ_PREFIX}dec_ok"),
        json={
            "prompt": "足够长的原始灵感 text",
            "genre_primary": "玄幻",
            "genre_secondary": "科幻",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["dimensions"]) == 5
    assert data["causal_map"] == "cmap"
    assert data["top_level_summary"] == "summary"
    assert data["dimensions"][0]["dimension"] == "ontology"


def test_decompose_503_on_runtime_error(mock_router):
    engine = _make_engine(mock_router)

    async def fake_decompose(project_id, raw_intent):
        raise RuntimeError("LLM boom")

    engine.decompose = fake_decompose  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(
        _route("/decompose", f"{PROJ_PREFIX}dec_503"),
        json={"prompt": "足够长的原始灵感 text", "genre_primary": "玄幻"},
    )
    assert resp.status_code == 503
    assert "DECOMPOSE_FAILED" in resp.json()["detail"]


def test_decompose_422_on_value_error(mock_router):
    engine = _make_engine(mock_router)

    async def fake_decompose(project_id, raw_intent):
        raise ValueError("bad input")

    engine.decompose = fake_decompose  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(
        _route("/decompose", f"{PROJ_PREFIX}dec_422"),
        json={"prompt": "足够长的原始灵感 text", "genre_primary": "玄幻"},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# POST /follow-up
# ---------------------------------------------------------------------------


def test_follow_up_happy_path(mock_router):
    engine = _make_engine(mock_router)
    expected = Unit(
        id="unit_aaa",
        dimension=DimLabel.ONTOLOGY,
        unit_name="新名",
        description="新描述",
        follow_up_count=1,
    )

    async def fake_follow_up(project_id, unit_id, user_question):
        return expected

    engine.follow_up_unit = fake_follow_up  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(
        _route("/follow-up", f"{PROJ_PREFIX}fu_ok"),
        json={"unit_id": "unit_aaa", "user_question": "为什么"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["unit"]["id"] == "unit_aaa"
    assert data["unit"]["description"] == "新描述"


def test_follow_up_422_on_value_error(mock_router):
    engine = _make_engine(mock_router)

    async def fake_follow_up(project_id, unit_id, user_question):
        raise ValueError("unit 不可约化")

    engine.follow_up_unit = fake_follow_up  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(
        _route("/follow-up", f"{PROJ_PREFIX}fu_422"),
        json={"unit_id": "unit_aaa"},
    )
    assert resp.status_code == 422
    assert "不可约化" in resp.json()["detail"]


def test_follow_up_503_on_runtime_error(mock_router):
    engine = _make_engine(mock_router)

    async def fake_follow_up(project_id, unit_id, user_question):
        raise RuntimeError("LLM down")

    engine.follow_up_unit = fake_follow_up  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(
        _route("/follow-up", f"{PROJ_PREFIX}fu_503"),
        json={"unit_id": "unit_aaa"},
    )
    assert resp.status_code == 503


# ---------------------------------------------------------------------------
# POST /diverge
# ---------------------------------------------------------------------------


def test_diverge_happy_path(mock_router):
    dims = [
        _make_dim(
            DimLabel.ONTOLOGY,
            [_make_unit("unit_aaa", DimLabel.ONTOLOGY)],
            candidates=[
                UnitCandidate(
                    id="cand_z1",
                    unit_id="unit_aaa",
                    unit_name="灵窍",
                    description="变",
                    chain_reaction="连锁",
                    main_operator="distort",
                    selection_rank=0,
                )
            ],
        ),
    ]
    engine = _make_engine(mock_router)

    async def fake_diverge(project_id):
        return dims

    engine.diverge = fake_diverge  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(_route("/diverge", f"{PROJ_PREFIX}div_ok"))
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["dimensions"]) == 1
    assert data["dimensions"][0]["candidates"][0]["main_operator"] == "distort"


def test_diverge_503_on_runtime_error(mock_router):
    engine = _make_engine(mock_router)

    async def fake_diverge(project_id):
        raise RuntimeError("all units failed")

    engine.diverge = fake_diverge  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(_route("/diverge", f"{PROJ_PREFIX}div_503"))
    assert resp.status_code == 503
    assert "DIVERGE_FAILED" in resp.json()["detail"]


def test_diverge_422_on_value_error(mock_router):
    engine = _make_engine(mock_router)

    async def fake_diverge(project_id):
        raise ValueError("未拆解")

    engine.diverge = fake_diverge  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(_route("/diverge", f"{PROJ_PREFIX}div_422"))
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# POST /regenerate-unit
# ---------------------------------------------------------------------------


def test_regenerate_unit_happy_path(mock_router):
    engine = _make_engine(mock_router)
    cands = [
        UnitCandidate(
            id="cand_new1",
            unit_id="unit_aaa",
            unit_name="灵窍",
            description="新候选",
            chain_reaction="连锁",
            main_operator="break",
            selection_rank=0,
        ),
        UnitCandidate(
            id="cand_new2",
            unit_id="unit_aaa",
            unit_name="灵窍",
            description="新候选 2",
            chain_reaction="连锁",
            main_operator="blend",
            selection_rank=1,
        ),
    ]

    async def fake_regen(project_id, unit_id):
        return cands

    engine.regenerate_unit = fake_regen  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(
        _route("/regenerate-unit", f"{PROJ_PREFIX}regen_ok"),
        json={"unit_id": "unit_aaa"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["candidates"]) == 2
    assert data["candidates"][0]["main_operator"] == "break"


def test_regenerate_unit_503(mock_router):
    engine = _make_engine(mock_router)

    async def fake_regen(project_id, unit_id):
        raise RuntimeError("LLM 失败")

    engine.regenerate_unit = fake_regen  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(
        _route("/regenerate-unit", f"{PROJ_PREFIX}regen_503"),
        json={"unit_id": "unit_aaa"},
    )
    assert resp.status_code == 503


# ---------------------------------------------------------------------------
# POST /select-unit
# ---------------------------------------------------------------------------


def test_select_unit_happy_path(mock_router):
    engine = _make_engine(mock_router)
    dim = _make_dim(
        DimLabel.ONTOLOGY,
        [_make_unit("unit_aaa", DimLabel.ONTOLOGY)],
        candidates=[
            UnitCandidate(
                id="cand_a", unit_id="unit_aaa", unit_name="u",
                description="a", chain_reaction="c",
                main_operator="distort", selection_rank=0,
            ),
            UnitCandidate(
                id="cand_b", unit_id="unit_aaa", unit_name="u",
                description="b", chain_reaction="c",
                main_operator="break", selection_rank=1,
            ),
        ],
    )

    def fake_select(project_id, unit_id, candidate_index):
        return dim

    engine.select_unit_candidate = fake_select  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(
        _route("/select-unit", f"{PROJ_PREFIX}sel_ok"),
        json={"unit_id": "unit_aaa", "candidate_index": 1},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["dimension"]["candidates"]) == 2


def test_select_unit_out_of_range(mock_router):
    engine = _make_engine(mock_router)

    def fake_select(project_id, unit_id, candidate_index):
        raise ValueError("candidate_index 5 超出范围 (该 unit 有 2 候选)")

    engine.select_unit_candidate = fake_select  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(
        _route("/select-unit", f"{PROJ_PREFIX}sel_oor"),
        json={"unit_id": "unit_aaa", "candidate_index": 5},
    )
    assert resp.status_code == 422


def test_select_unit_rejects_negative_index_via_pydantic():
    """candidate_index has ge=0 — Pydantic rejects before we hit the engine."""
    resp = client.post(
        _route("/select-unit", f"{PROJ_PREFIX}sel_neg"),
        json={"unit_id": "unit_aaa", "candidate_index": -1},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# POST /commit
# ---------------------------------------------------------------------------


def test_commit_happy_path(mock_router):
    engine = _make_engine(mock_router)
    concept = {
        "one_line": "一句话",
        "expanded": "扩展",
        "core_tension": "核心矛盾",
        "tone": "热血",
        "logline": "logline",
        "edited_by_user": False,
    }
    novelty = {
        "composite": 0.62,
        "market_saturation": 0.7,
        "trope_similarity": 0.5,
        "contradiction_depth": 0.65,
        "discussion_potential": 0.6,
        "grade": "B",
    }

    async def fake_commit(project_id):
        return {"committed_concept": concept, "novelty_scores": novelty}

    engine.commit = fake_commit  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(_route("/commit", f"{PROJ_PREFIX}commit_ok"))
    assert resp.status_code == 200
    data = resp.json()
    assert data["committed_concept"]["one_line"] == "一句话"
    assert data["novelty_scores"]["composite"] == 0.62


def test_commit_422_on_value_error(mock_router):
    engine = _make_engine(mock_router)

    async def fake_commit(project_id):
        raise ValueError("候选不足:2 units 有候选 (< 3),无法合成")

    engine.commit = fake_commit  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(_route("/commit", f"{PROJ_PREFIX}commit_422"))
    assert resp.status_code == 422


def test_commit_503_on_runtime_error(mock_router):
    engine = _make_engine(mock_router)

    async def fake_commit(project_id):
        raise RuntimeError("LLM timeout")

    engine.commit = fake_commit  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(_route("/commit", f"{PROJ_PREFIX}commit_503"))
    assert resp.status_code == 503


# ---------------------------------------------------------------------------
# POST /edit-concept
# ---------------------------------------------------------------------------


def test_edit_concept_happy_path(mock_router, tmp_path):
    """Edit-concept does not need a mocked engine — it uses the real one,
    but reads from the seeded state."""
    _seed_basic_state(f"{PROJ_PREFIX}edit_ok", tmp_path)
    engine = _make_engine(mock_router)
    _inject_engine(engine)

    resp = client.post(
        _route("/edit-concept", f"{PROJ_PREFIX}edit_ok"),
        json={"one_line": "改写后的一句话"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["committed_concept"]["one_line"] == "改写后的一句话"
    assert data["committed_concept"]["edited_by_user"] is True
    # Untouched field preserved
    assert data["committed_concept"]["tone"] == "t"


def test_edit_concept_rejects_unknown_field(mock_router, tmp_path):
    """Defense-in-depth: the engine's ALLOWED_EDIT_FIELDS whitelist rejects
    any field name that bypassed Pydantic (e.g. via a direct engine call
    bypassing the API surface). Pydantic itself drops unknown fields by
    default, so the route returns 200 — but the engine contract still
    enforces the whitelist for non-route callers."""
    _seed_basic_state(f"{PROJ_PREFIX}edit_bad", tmp_path)
    engine = _make_engine(mock_router)
    _inject_engine(engine)

    # Route layer: unknown fields are silently dropped (Pydantic default).
    resp = client.post(
        _route("/edit-concept", f"{PROJ_PREFIX}edit_bad"),
        json={"bogus_field": "x"},
    )
    assert resp.status_code == 200
    assert "bogus_field" not in resp.json()["committed_concept"]

    # Engine layer: defense-in-depth — calling engine directly with a
    # non-whitelisted field surfaces a ValueError → 422.
    import asyncio
    with pytest.raises(ValueError, match="未知字段"):
        asyncio.run(engine.edit_committed_concept(
            f"{PROJ_PREFIX}edit_bad",
            {"bogus_field": "x"},
        ))


def test_edit_concept_422_when_no_concept(mock_router, tmp_path):
    """State exists but committed_concept is None → 422."""
    state = ThreeBState(
        project_id=f"{PROJ_PREFIX}edit_nocon",
        raw_intent=RawIntent(prompt="x", genre_primary="玄幻"),
    )
    atomic_write_state(f"{PROJ_PREFIX}edit_nocon", state)
    engine = _make_engine(mock_router)
    _inject_engine(engine)

    resp = client.post(
        _route("/edit-concept", f"{PROJ_PREFIX}edit_nocon"),
        json={"one_line": "x"},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# POST /advance
# ---------------------------------------------------------------------------


def test_advance_happy_path_writes_both_files(mock_router, tmp_path):
    """Advance with no committed_concept → calls engine.commit() first, then
    writes both concept_and_dna.json + creative_divergence.json."""
    _seed_basic_state(f"{PROJ_PREFIX}adv_ok", tmp_path)
    # Make committed_concept None so advance triggers the auto-commit branch
    state = ThreeBState(
        project_id=f"{PROJ_PREFIX}adv_ok",
        raw_intent=RawIntent(prompt="足够长的原始灵感 text", genre_primary="玄幻"),
        dimensions=[
            _make_dim(
                DimLabel.ONTOLOGY,
                [_make_unit("unit_aaa", DimLabel.ONTOLOGY)],
                candidates=[
                    UnitCandidate(
                        id="cand_x1",
                        unit_id="unit_aaa",
                        unit_name="灵窍",
                        description="d",
                        chain_reaction="c",
                        main_operator="distort",
                        selection_rank=0,
                    )
                ],
            ),
            _make_dim(
                DimLabel.ENERGETICS,
                [_make_unit("unit_bbb", DimLabel.ENERGETICS)],
                candidates=[
                    UnitCandidate(
                        id="cand_x2",
                        unit_id="unit_bbb",
                        unit_name="灵力",
                        description="d",
                        chain_reaction="c",
                        main_operator="break",
                        selection_rank=0,
                    )
                ],
            ),
            _make_dim(
                DimLabel.POWER_STRUCTURE,
                [_make_unit("unit_ccc", DimLabel.POWER_STRUCTURE)],
                candidates=[
                    UnitCandidate(
                        id="cand_x3",
                        unit_id="unit_ccc",
                        unit_name="朝廷",
                        description="d",
                        chain_reaction="c",
                        main_operator="blend",
                        selection_rank=0,
                    )
                ],
            ),
        ],
    )
    atomic_write_state(f"{PROJ_PREFIX}adv_ok", state)

    # Mock the router's execute() so /commit's LLM call returns valid JSON
    mock_router.execute = AsyncMock(
        return_value={
            "content": json.dumps(
                {
                    "one_line": "o",
                    "expanded": "e",
                    "core_tension": "c",
                    "tone": "t",
                    "logline": "l",
                },
                ensure_ascii=False,
            ),
        }
    )
    engine = _make_engine(mock_router, _FakeNoveltyEvaluator())
    _inject_engine(engine)

    resp = client.post(_route("/advance", f"{PROJ_PREFIX}adv_ok"))
    assert resp.status_code == 200
    data = resp.json()
    assert data["written"] is True
    assert "committed_at" in data

    proj_dir = tmp_path / f"{PROJ_PREFIX}adv_ok"
    dna = json.loads((proj_dir / "concept_and_dna.json").read_text(encoding="utf-8"))
    div = json.loads(
        (proj_dir / "creative_divergence.json").read_text(encoding="utf-8")
    )
    assert dna["source"] == "creative_divergence"
    assert dna["concept"]["one_line"] == "o"
    assert dna["three_b_snapshot"]["schema_version"] == 2
    assert div["source"] == "creative_divergence"


def test_advance_422_when_no_state(mock_router):
    engine = _make_engine(mock_router)

    async def fake_advance(project_id):
        raise ValueError("项目 p_3b_adv_no 无 state")

    engine.advance = fake_advance  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(_route("/advance", f"{PROJ_PREFIX}adv_no"))
    assert resp.status_code == 422


def test_advance_503_on_runtime_error(mock_router):
    engine = _make_engine(mock_router)

    async def fake_advance(project_id):
        raise RuntimeError("write failed")

    engine.advance = fake_advance  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(_route("/advance", f"{PROJ_PREFIX}adv_503"))
    assert resp.status_code == 503


# ---------------------------------------------------------------------------
# POST /reset-and-restart (convenience)
# ---------------------------------------------------------------------------


def test_reset_and_restart_deletes_file(tmp_path):
    _seed_basic_state(f"{PROJ_PREFIX}rr_del", tmp_path)
    resp = client.post(_route("/reset-and-restart", f"{PROJ_PREFIX}rr_del"))
    assert resp.status_code == 200
    assert resp.json() == {"deleted": True}
    state_path = (
        tmp_path
        / f"{PROJ_PREFIX}rr_del"
        / "creative_os"
        / "three_b_state.json"
    )
    assert not state_path.exists()


def test_reset_and_restart_idempotent_when_no_file():
    """Unlike DELETE /state, reset-and-restart returns 200 even when nothing
    to delete — the frontend can call it unconditionally when starting fresh."""
    resp = client.post(_route("/reset-and-restart", f"{PROJ_PREFIX}rr_none"))
    assert resp.status_code == 200
    assert resp.json() == {"deleted": True}