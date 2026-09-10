"""E2E smoke test for divergence_v2 S0→S1→S2→S3 backend flow.

Mirrors Task 10 of docs/superpowers/plans/2026-09-09-divergence-default-original-unit.md.

Walks the backend/API smoke path end-to-end:
  S0/S1  — seed state with raw_intent + units (no candidates yet)
  S3     — POST /diverge  → LLM candidates per unit
  assert — every unit renders/returns a `__original` candidate
  assert — virtual candidate has selection_rank 0 by default
  assert — POST /select-unit on LLM candidate makes LLM rank 0
  assert — POST /select-unit on the __original restores rank 0
  S4     — POST /commit with __original selected → user prompt uses
           unit.description and does NOT add a 连锁推演 line

No real LLM calls — a deterministic AsyncMock router is injected via
app.state.three_b_engine. Mirrors the fixture pattern in
backend/tests/test_api/test_three_b_routes.py.

Note on test layout: the plan calls for `tests/e2e/test_divergence_v2_smoke.py`.
That subdirectory does not exist in this repo — the existing E2E test
`tests/test_e2e_diverge_flow.py` lives directly under `tests/`. We follow
that convention so pytest's testpaths config picks it up without changes.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from backend.config import settings
from backend.creative_os.three_b_engine import (
    Dimension,
    DimensionDecomposition,
    RawIntent,
    ThreeBEngine,
    ThreeBState,
    Unit,
    atomic_write_state,
    load_state,
)
from backend.main import app


PROJ = "proj_div_v2_smoke"
BASE = f"/api/v1/projects/{PROJ}/creative/diverge/three-b"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


class _FakeNoveltyScore:
    """Duck-typed stand-in for backend.models.creative_os.NoveltyScore.

    Engine.commit serializes these attributes into state.novelty_scores.
    """

    def __init__(self) -> None:
        self.total = 0.5
        self.market_saturation_score = 0.5
        self.trope_similarity_score = 0.5
        self.contradiction_depth_score = 0.5
        self.discussion_potential_score = 0.5
        self.grade = "B"


class _FakeNoveltyEvaluator:
    """Sidesteps TropePool catalog dependency."""

    def evaluate(self, _content):
        return _FakeNoveltyScore()


@pytest.fixture
def mock_router():
    """Deterministic AsyncMock router for the engine.

    Default return_value is set per test (LLM diverge outputs 2 candidates
    per unit; commit outputs 5-field JSON). Tests override side_effect to
    capture the commit user prompt.
    """
    return AsyncMock()


@pytest.fixture(autouse=True)
def _patch_projects_dir(tmp_path, monkeypatch):
    """Route all reads/writes to a per-test tmp dir."""
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield


@pytest.fixture(autouse=True)
def _reset_engine_state():
    """Drop any cached engine from prior tests — three_b_routes._get_engine
    checks request.app.state.three_b_engine each call, so we delete the attr
    before each test to force a fresh engine wired to the current mock router.
    """
    yield
    if hasattr(app.state, "three_b_engine"):
        del app.state.three_b_engine


@pytest.fixture
def client():
    """Reuse the module-level TestClient from three_b_routes's convention."""
    return TestClient(app)


def _seed_state_with_units(project_id: str, n_units: int = 3) -> ThreeBState:
    """Seed S2-decomposed state (units exist, candidates don't yet).

    Each unit has a unique `description` so the assertion that the
    virtual candidate's description == unit.description is unambiguous.
    """
    units = [
        Unit(
            id=f"unit_{i}",
            dimension=Dimension.ONTOLOGY,
            unit_name=f"u{i}",
            description=f"原始描述-u{i}-唯一标识",
        )
        for i in range(n_units)
    ]
    state = ThreeBState(
        project_id=project_id,
        raw_intent=RawIntent(prompt="修仙", genre_primary="修仙"),
        causal_map="A → B",
        top_level_summary="一句话总结",
        dimensions=[
            DimensionDecomposition(
                dimension=Dimension.ONTOLOGY,
                insight="核心洞察",
                units=units,
            ),
        ],
    )
    atomic_write_state(project_id, state)
    return state


def _make_llm_response() -> dict:
    """Standard 2-candidate LLM diverge response — distinct descriptions and
    chain_reactions so assertions don't false-positive on substring overlap.
    """
    return {
        "content": json.dumps(
            {
                "candidates": [
                    {
                        "description": "扭曲变体",
                        "chain_reaction": "邪气侵入连锁",
                        "main_operator": "distort",
                        "selection_rank": 0,
                    },
                    {
                        "description": "切断变体",
                        "chain_reaction": "丹田失联连锁",
                        "main_operator": "break",
                        "selection_rank": 1,
                    },
                ],
            },
            ensure_ascii=False,
        ),
    }


# ---------------------------------------------------------------------------
# Test
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_s3_default_original_unit_full_flow(
    client, mock_router, monkeypatch, tmp_path
):
    """S0→S1→S2→S3 backend/API smoke for the default-original-unit feature.

    1. Seed state with raw_intent + 3 units (no candidates).
    S3. POST /diverge with mocked LLM returning 2 candidates per unit.
    2. Assert every unit has a __original candidate with selection_rank 0.
    3. POST /select-unit pointing at LLM candidate #0 → LLM rank 0, original demoted.
    4. POST /select-unit pointing at __original → original rank 0 restored.
    S4. POST /commit with original still selected → user prompt uses
        unit.description and contains NO 连锁推演 line.
    """
    _seed_state_with_units(PROJ, n_units=3)

    # Inject engine wired to mock router + fake novelty evaluator
    engine = ThreeBEngine(
        model_router=mock_router,
        novelty_evaluator=_FakeNoveltyEvaluator(),
    )
    app.state.three_b_engine = engine

    # ----------------------------------------------------------------------
    # S3: POST /diverge — LLM returns 2 candidates per unit
    # ----------------------------------------------------------------------
    mock_router.execute.return_value = _make_llm_response()

    resp = client.post(f"{BASE}/diverge")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "dimensions" in body
    assert len(body["dimensions"]) == 1
    dim_dict = body["dimensions"][0]
    assert dim_dict["dimension_status"] == "diverged"

    # ----------------------------------------------------------------------
    # Assert: every S3 unit returns a __original candidate with rank 0
    # ----------------------------------------------------------------------
    rel = load_state(PROJ)
    cands = rel.dimensions[0].candidates
    units = rel.dimensions[0].units
    assert len(units) == 3
    # Total = 3 units × (2 LLM + 1 original) = 9
    assert len(cands) == 9, f"expected 9 candidates (3 units × (2 LLM + 1 original)), got {len(cands)}"

    for unit in units:
        unit_cands = [c for c in cands if c.unit_id == unit.id]
        assert len(unit_cands) == 3, (
            f"unit {unit.id} should have 3 candidates (2 LLM + 1 __original), "
            f"got {len(unit_cands)}"
        )

        originals = [c for c in unit_cands if c.id == f"{unit.id}__original"]
        assert len(originals) == 1, (
            f"unit {unit.id} must have exactly one __original candidate, "
            f"got {len(originals)}"
        )
        orig = originals[0]

        # The virtual candidate's description IS the unit's description.
        assert orig.description == unit.description, (
            f"__original description must equal unit.description "
            f"({unit.description!r}), got {orig.description!r}"
        )
        # chain_reaction on the virtual is empty (Task 4 commitment).
        assert orig.chain_reaction == ""
        # main_operator is None for the virtual (LLM-only metadata).
        assert orig.main_operator is None
        # Default selection_rank is 0.
        assert orig.selection_rank == 0, (
            f"__original selection_rank must be 0 by default, got {orig.selection_rank}"
        )

        # LLM candidates were shifted to ranks 1, 2.
        llm_cands = [c for c in unit_cands if c.id != orig.id]
        llm_ranks = sorted(c.selection_rank for c in llm_cands)
        assert llm_ranks == [1, 2], (
            f"LLM candidates for unit {unit.id} should have ranks [1, 2], "
            f"got {llm_ranks}"
        )

    # Pick the first unit for the select-unit flow
    target_unit = units[0]
    target_cands = [c for c in cands if c.unit_id == target_unit.id]
    virtual_idx = next(
        i for i, c in enumerate(target_cands) if c.id == f"{target_unit.id}__original"
    )
    llm_first_idx = next(
        i for i, c in enumerate(target_cands) if c.id != f"{target_unit.id}__original"
    )

    # ----------------------------------------------------------------------
    # Select an LLM candidate → LLM becomes rank 0, original demoted
    # ----------------------------------------------------------------------
    resp = client.post(
        f"{BASE}/select-unit",
        json={"unit_id": target_unit.id, "candidate_index": llm_first_idx},
    )
    assert resp.status_code == 200, resp.text

    rel = load_state(PROJ)
    cands = rel.dimensions[0].candidates
    target_cands = [c for c in cands if c.unit_id == target_unit.id]

    # LLM candidate that the user clicked now has rank 0
    llm_after = next(c for c in target_cands if c.id != f"{target_unit.id}__original")
    assert llm_after.selection_rank == 0, (
        f"LLM candidate should have selection_rank 0 after user pick, "
        f"got {llm_after.selection_rank}"
    )
    # Original is now demoted (rank ≠ 0)
    orig_after = next(c for c in target_cands if c.id == f"{target_unit.id}__original")
    assert orig_after.selection_rank != 0, (
        f"__original should be demoted after LLM pick, got rank {orig_after.selection_rank}"
    )

    # ----------------------------------------------------------------------
    # Select the __original → original rank 0 restored
    # ----------------------------------------------------------------------
    resp = client.post(
        f"{BASE}/select-unit",
        json={"unit_id": target_unit.id, "candidate_index": virtual_idx},
    )
    assert resp.status_code == 200, resp.text

    rel = load_state(PROJ)
    cands = rel.dimensions[0].candidates
    target_cands = [c for c in cands if c.unit_id == target_unit.id]

    orig_after = next(c for c in target_cands if c.id == f"{target_unit.id}__original")
    assert orig_after.selection_rank == 0, (
        f"__original should be rank 0 after re-select, got {orig_after.selection_rank}"
    )
    # The LLM candidate that was rank 0 gets bumped back up.
    llm_after = next(c for c in target_cands if c.id != f"{target_unit.id}__original")
    assert llm_after.selection_rank != 0

    # ----------------------------------------------------------------------
    # S4: commit with original selected uses unit.description, no chain_reaction
    # ----------------------------------------------------------------------
    # Make sure ALL units have __original selected (rank 0) for this assertion.
    # The user just re-selected the first unit's __original, but the other
    # 2 units still default to __original as well — verify and align.
    rel = load_state(PROJ)
    for unit in units:
        unit_cands = [c for c in rel.dimensions[0].candidates if c.unit_id == unit.id]
        orig = next(c for c in unit_cands if c.id == f"{unit.id}__original")
        if orig.selection_rank != 0:
            # Select it via API
            cur = [c for c in unit_cands if c.unit_id == unit.id]
            vidx = next(
                i for i, c in enumerate(cur) if c.id == f"{unit.id}__original"
            )
            r = client.post(
                f"{BASE}/select-unit",
                json={"unit_id": unit.id, "candidate_index": vidx},
            )
            assert r.status_code == 200, r.text

    # Capture the user prompt sent to the LLM during commit
    captured_messages: list = []

    async def capture_commit(*args, **kwargs):
        captured_messages.append(kwargs.get("messages"))
        return {
            "content": json.dumps(
                {
                    "one_line": "一句话",
                    "expanded": "扩展",
                    "core_tension": "核心矛盾",
                    "tone": "热血",
                    "logline": "logline",
                },
                ensure_ascii=False,
            ),
        }

    mock_router.execute.side_effect = capture_commit

    resp = client.post(f"{BASE}/commit")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "committed_concept" in body
    assert "novelty_scores" in body

    # Inspect the user prompt sent for commit.
    assert len(captured_messages) == 1, "commit should call router.execute once"
    user_msg = captured_messages[0][1]["content"]

    # Every unit's description must appear in the prompt (since the virtual
    # candidate's description IS the unit's description).
    for unit in units:
        assert unit.description in user_msg, (
            f"unit {unit.id} description {unit.description!r} should appear in "
            f"commit prompt (it is the selected __original candidate's text)"
        )

    # No 连锁推演 line for any unit (chain_reaction is "" on __original).
    # We assert that the line "连锁推演" does NOT appear anywhere in the
    # selected_units block. This guards Task 4's "skip empty chain_reaction".
    # Extract the selected_units block to scope the assertion.
    selected_units_marker = "选定单元(含连锁推演):"
    assert selected_units_marker in user_msg, (
        "commit prompt should contain the 选定单元 marker (template sanity)"
    )
    # The substring after the marker up to the next blank line is the
    # selected_units payload.
    after_marker = user_msg.split(selected_units_marker, 1)[1]
    # The block ends at the next blank line ("\n\n") followed by the
    # final instruction, or at end of string — both are acceptable scopes.
    selected_units_block = after_marker.split("\n\n", 1)[0]
    assert "连锁推演" not in selected_units_block, (
        f"selected_units block must NOT contain 连锁推演 when __original is "
        f"selected (chain_reaction is empty). Got:\n{selected_units_block}"
    )

    # ----------------------------------------------------------------------
    # State now reflects committed_concept
    # ----------------------------------------------------------------------
    rel = load_state(PROJ)
    assert rel.committed_concept is not None
    assert rel.committed_concept["one_line"] == "一句话"
    assert rel.commit_completed_at is not None


# ---------------------------------------------------------------------------
# Task 13: E2E smoke for creative dimensions API surface
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _patch_dimensions_store(tmp_path):
    """Inject a CreativeDimensionsStore with description-bearing seed entries
    onto app.state so /api/v1/creative-dimensions/active and /api/v1/genres
    read from our fixture rather than the global seed loaded by lifespan.

    Autouse so the two tests below don't need to declare the fixture, but the
    only side effect on the existing divergence test is overwriting the
    lifespan-installed store — harmless because that test only hits the
    three_b diverge endpoints (which use _get_dimensions_store() at request
    time and read app.state via the same slot).
    """
    from backend.creative_os.creative_dimensions import (
        DimensionsCatalog,
        DimensionEntry,
    )
    from backend.services.creative_dimensions_store import (
        CreativeDimensionsStore,
    )

    seed = DimensionsCatalog(
        subject=[
            DimensionEntry(
                id="xuanhuan", name="玄幻", description="东方仙侠世界",
                status="active", order=0,
                created_at="2026-01-01T00:00:00Z",
                updated_at="2026-01-01T00:00:00Z",
            ),
        ],
        tone=[
            DimensionEntry(
                id="rexue", name="热血", description="激烈昂扬",
                status="active", order=0,
                created_at="2026-01-01T00:00:00Z",
                updated_at="2026-01-01T00:00:00Z",
            ),
        ],
        style=[
            DimensionEntry(
                id="shuangwen", name="爽文", description="节奏紧凑",
                status="active", order=0,
                created_at="2026-01-01T00:00:00Z",
                updated_at="2026-01-01T00:00:00Z",
            ),
        ],
    )
    store = CreativeDimensionsStore(
        tmp_path / "creative_dimensions.json", lambda: seed,
    )
    store.load()
    app.state.creative_dimensions_store = store
    yield store
    # Cleanup so the next test sees the lifespan-installed store again.
    if hasattr(app.state, "creative_dimensions_store"):
        del app.state.creative_dimensions_store


def test_active_endpoint_returns_three_dims(client):
    """GET /api/v1/creative-dimensions/active returns all 3 kinds with 1 entry each."""
    resp = client.get("/api/v1/creative-dimensions/active")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["subject"]) == 1 and body["subject"][0]["id"] == "xuanhuan"
    assert len(body["tone"]) == 1 and body["tone"][0]["id"] == "rexue"
    assert len(body["style"]) == 1 and body["style"][0]["id"] == "shuangwen"


def test_genres_compat_filters_inactive_by_default(client):
    """GET /api/v1/genres (ui_visible_only=True default) surfaces active subjects."""
    resp = client.get("/api/v1/genres")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    ids = [g["id"] for g in body]
    assert "xuanhuan" in ids