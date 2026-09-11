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
            tone="热血",
            style="爽文",
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


def test_state_loads_legacy_raw_intent_with_genre_secondary(tmp_path):
    """Disk state written before Round 1 included ``genre_secondary`` on
    raw_intent and lacked ``tone`` / ``style``. ``load_state`` must strip
    the legacy field and apply defaults instead of crashing HYDRATE with
    TypeError (the "S2 page empty after first decompose" bug).

    Regression for the proj_47007ffa "页面为空" report on 2026-09-10.
    """
    proj_id = f"{PROJ_PREFIX}legacy_intent"
    proj_dir = tmp_path / proj_id
    proj_dir.mkdir(parents=True)
    (proj_dir / "creative_os").mkdir()
    # Mirror the exact legacy shape that crashed proj_47007ffa:
    #   - raw_intent has "genre_secondary": null (legacy field)
    #   - raw_intent lacks "tone" and "style" (Round 1 added them)
    legacy = {
        "schema_version": 2,
        "project_id": proj_id,
        "raw_intent": {
            "prompt": "一个少年大病一场后获得了阴阳眼",
            "genre_primary": "xuanyi",
            "genre_secondary": None,
        },
        "causal_map": "ontology → energetics",
        "top_level_summary": "总览",
        "dimensions": [],
    }
    (proj_dir / "creative_os" / "three_b_state.json").write_text(
        json.dumps(legacy, ensure_ascii=False),
        encoding="utf-8",
    )

    resp = client.get(_route("/state", proj_id))
    assert resp.status_code == 200, resp.text
    data = resp.json()
    # Legacy field stripped, Round-1 fields defaulted — no crash.
    assert data["raw_intent"]["prompt"] == "一个少年大病一场后获得了阴阳眼"
    assert data["raw_intent"]["genre_primary"] == "xuanyi"
    assert "genre_secondary" not in data["raw_intent"]
    assert data["raw_intent"]["tone"] == ""
    assert data["raw_intent"]["style"] == ""


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

    captured: dict = {}

    # Patch decompose to return our pre-built dims deterministically and
    # capture the raw_intent + user_modifications the route forwarded.
    async def fake_decompose(project_id, raw_intent, user_modifications=""):
        captured["raw_intent"] = raw_intent
        captured["user_modifications"] = user_modifications
        return dims, "cmap", "summary"

    engine.decompose = fake_decompose  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(
        _route("/decompose", f"{PROJ_PREFIX}dec_ok"),
        json={
            "prompt": "足够长的原始灵感 text",
            "genre_primary": "玄幻",
            "tone": "热血",
            "style": "爽文",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["dimensions"]) == 5
    assert data["causal_map"] == "cmap"
    assert data["top_level_summary"] == "summary"
    assert data["dimensions"][0]["dimension"] == "ontology"
    # Route forwards tone/style to engine and defaults user_modifications="".
    assert captured["raw_intent"].tone == "热血"
    assert captured["raw_intent"].style == "爽文"
    assert captured["raw_intent"].genre_primary == "玄幻"
    assert captured["user_modifications"] == ""


def test_decompose_forwards_user_modifications(mock_router):
    """Round 1 of the v2 wizard 6-item optimization: S2 「重新生成」 opens a
    RegenerateModal that calls /decompose again with user-supplied feedback.
    The route must pass that through to engine.decompose(..., user_modifications=...)
    so the prompt YAML can render a 「用户修改意见」 block.
    """
    mock_router.execute = AsyncMock(return_value={"content": "{}"})

    dims = [_make_dim(DimLabel.ONTOLOGY, [])]
    engine = _make_engine(mock_router)

    captured: dict = {}

    async def fake_decompose(project_id, raw_intent, user_modifications=""):
        captured["user_modifications"] = user_modifications
        return dims, "cm", "sum"

    engine.decompose = fake_decompose  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(
        _route("/decompose", f"{PROJ_PREFIX}dec_mods"),
        json={
            "prompt": "足够长的原始灵感 text",
            "genre_primary": "玄幻",
            "user_modifications": "聚焦东方玄幻,不要科幻",
        },
    )
    assert resp.status_code == 200
    assert captured["user_modifications"] == "聚焦东方玄幻,不要科幻"


def test_decompose_rejects_oversize_user_modifications():
    """user_modifications has max_length=1700 — Pydantic rejects before engine call."""
    resp = client.post(
        _route("/decompose", f"{PROJ_PREFIX}dec_too_long"),
        json={
            "prompt": "足够长的原始灵感 text",
            "genre_primary": "玄幻",
            "user_modifications": "x" * 2000,
        },
    )
    assert resp.status_code == 422


def test_decompose_omitted_tone_style_default_to_empty_string(mock_router):
    """Old clients that only send prompt + genre_primary still work — tone
    and style default to '' on the RawIntent dataclass so the prompt YAML
    renders '(无)' placeholders rather than crashing.
    """
    mock_router.execute = AsyncMock(return_value={"content": "{}"})
    engine = _make_engine(mock_router)
    captured: dict = {}

    async def fake_decompose(project_id, raw_intent, user_modifications=""):
        captured["raw_intent"] = raw_intent
        return [], "cm", "sum"

    engine.decompose = fake_decompose  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(
        _route("/decompose", f"{PROJ_PREFIX}dec_min"),
        json={"prompt": "足够长的原始灵感 text", "genre_primary": "玄幻"},
    )
    assert resp.status_code == 200
    assert captured["raw_intent"].tone == ""
    assert captured["raw_intent"].style == ""


def test_decompose_503_on_runtime_error(mock_router):
    engine = _make_engine(mock_router)

    async def fake_decompose(project_id, raw_intent, user_modifications=""):
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

    async def fake_decompose(project_id, raw_intent, user_modifications=""):
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


def test_diverge_route_serializes_per_unit_original_candidate(mock_router):
    """Every unit in the response must have exactly one candidate whose id ends
    with '__original', whose description equals the unit's description, and
    whose selection_rank is 0. This pins the route serialization shape (not
    only the helper) so future refactors can't silently drop the
    default-original-unit fallback from the API contract.

    Mirrors what the real `engine.diverge()` does: for each unit, runs the
    helper `_append_original_candidate` to inject the virtual candidate, then
    the route serializes the dimensions via `asdict()`. We replace
    `engine.diverge` so we don't touch the LLM.
    """
    from backend.creative_os.three_b_engine import _append_original_candidate

    # 3 units across 2 dimensions (real-world case: per-unit + multi-dim)
    u_a = _make_unit("unit_alpha", DimLabel.ONTOLOGY, name="灵窍", description="能量接口")
    u_b = _make_unit("unit_beta", DimLabel.ONTOLOGY, name="空间", description="位面层级")
    u_c = _make_unit("unit_gamma", DimLabel.ENERGETICS, name="灵力", description="灵力流")

    # LLM-side candidates — 2 per unit, mirrors real engine output.
    # Keyed by unit_id since @dataclass Unit isn't hashable by default.
    llm_per_unit: dict[str, list[UnitCandidate]] = {
        u_a.id: [
            UnitCandidate(
                id="cand_a1", unit_id=u_a.id, unit_name=u_a.unit_name,
                description="变异灵窍", chain_reaction="连锁",
                main_operator="distort", selection_rank=0,
            ),
            UnitCandidate(
                id="cand_a2", unit_id=u_a.id, unit_name=u_a.unit_name,
                description="多核灵窍", chain_reaction="联",
                main_operator="blend", selection_rank=1,
            ),
        ],
        u_b.id: [
            UnitCandidate(
                id="cand_b1", unit_id=u_b.id, unit_name=u_b.unit_name,
                description="折叠空间", chain_reaction="cr", main_operator="break",
                selection_rank=0,
            ),
        ],
        u_c.id: [],  # edge case: LLM returned nothing — should still get __original
    }

    async def fake_diverge(project_id):
        # Replicate the real engine's wiring: build DimensionDecomposition
        # with candidates = llm_candidates + [__original]. Identical to what
        # `diverge()` returns after `asyncio.gather` + `_append_original_candidate`.
        dim_alpha = _make_dim(
            DimLabel.ONTOLOGY, [u_a, u_b],
            candidates=_append_original_candidate(u_a, list(llm_per_unit[u_a.id]))
            + _append_original_candidate(u_b, list(llm_per_unit[u_b.id])),
        )
        dim_gamma = _make_dim(
            DimLabel.ENERGETICS, [u_c],
            candidates=_append_original_candidate(u_c, list(llm_per_unit[u_c.id])),
        )
        return [dim_alpha, dim_gamma]

    engine = _make_engine(mock_router)
    engine.diverge = fake_diverge  # type: ignore[assignment]
    _inject_engine(engine)

    resp = client.post(_route("/diverge", f"{PROJ_PREFIX}div_orig"))
    assert resp.status_code == 200

    # ---- Shape assertions on the serialized response ----
    data = resp.json()
    assert set(data.keys()) == {"dimensions"}, (
        "Route response should only have a 'dimensions' key — "
        "no leakage of other fields from the engine state."
    )
    assert isinstance(data["dimensions"], list)
    assert len(data["dimensions"]) == 2

    # Re-collect the units we put in, by id, to assert per-unit behavior
    # without depending on dimension ordering.
    units_by_id: dict[str, Unit] = {u.id: u for u in (u_a, u_b, u_c)}
    # Parallel map of unit_id -> expected LLM count (for the totals assertion below).
    llm_count_per_unit = {uid: len(llm_per_unit[uid]) for uid in units_by_id}
    seen_unit_ids: set[str] = set()
    # Track which dimensions we observed so we can also assert unit expansion.
    expected_dimensions = {DimLabel.ONTOLOGY.value, DimLabel.ENERGETICS.value}
    observed_dimensions: set[str] = set()

    for dim_dict in data["dimensions"]:
        observed_dimensions.add(dim_dict["dimension"])
        # Each dimension must have at least 1 unit + its candidates list
        assert isinstance(dim_dict["units"], list)
        assert isinstance(dim_dict["candidates"], list)
        assert len(dim_dict["units"]) >= 1

        for unit_dict in dim_dict["units"]:
            uid = unit_dict["id"]
            assert uid in units_by_id, f"Unexpected unit id {uid!r} in response"
            seen_unit_ids.add(uid)
            unit = units_by_id[uid]

            # Filter candidates belonging to THIS unit (route flattens all
            # units' candidates under the dimension, like the real engine).
            unit_cands = [c for c in dim_dict["candidates"] if c["unit_id"] == uid]

            # ---- The contract under test ----
            originals = [c for c in unit_cands if c["id"].endswith("__original")]
            assert len(originals) == 1, (
                f"Unit {uid!r} should have exactly 1 __original candidate, "
                f"got {len(originals)} (candidates: {[c['id'] for c in unit_cands]})"
            )
            orig = originals[0]
            assert orig["id"] == f"{uid}__original", (
                f"Original candidate id should be '{uid}__original', got {orig['id']!r}"
            )
            assert orig["unit_id"] == uid
            assert orig["unit_name"] == unit.unit_name
            assert orig["description"] == unit.description, (
                f"Original candidate description must equal the unit's description "
                f"({unit.description!r}), got {orig['description']!r}"
            )
            assert orig["selection_rank"] == 0, (
                f"Original candidate selection_rank must be 0, "
                f"got {orig['selection_rank']}"
            )

    # Every unit we put in must have appeared in some dimension.
    assert seen_unit_ids == set(units_by_id.keys()), (
        f"Units missing from response: {set(units_by_id.keys()) - seen_unit_ids}"
    )
    # All dimensions observed match what we put in.
    assert observed_dimensions == expected_dimensions

    # Sanity: total candidates per dim equals sum of (llm + 1 original) per unit.
    for dim_dict in data["dimensions"]:
        dim_unit_ids = [u["id"] for u in dim_dict["units"]]
        expected_total = sum(
            (llm_count_per_unit[uid] + 1) for uid in dim_unit_ids
        )
        assert len(dim_dict["candidates"]) == expected_total, (
            f"Dimension {dim_dict['dimension']!r} candidates total mismatch: "
            f"expected {expected_total}, got {len(dim_dict['candidates'])}"
        )


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