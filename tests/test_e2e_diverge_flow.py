"""End-to-end happy-path test for the creative divergence flow.

Task 26: Walks the full client journey from `/init` through `/commit`,
hitting every reachable endpoint along the way and verifying the
deliverables (`concept_and_dna.json` + `creative_divergence.json`) on disk.

Endpoints covered (in order):
  1. POST /init                  — premise → canvas v3 with root node
  2. GET  /novelty                — 4-dim score (uses fallback until tags extracted)
  3. GET  /state                  — top-level `etag` for optimistic locking
  4. PUT  /contradict             — writes core_contradiction to canvas (If-Match gated)
  5. POST /commit                 — translates canvas → concept_and_dna.json +
                                   dual-writes creative_divergence.json (compat)

Out of scope (LLM-dependent):
  - POST /apply-mutation  — needs Tier 1 LLM for MutationResult text
  - POST /contradict      — needs LLM to expand templates (graceful fallback exists)
  - GET  /novelty with real trope tags — needs Tier 3 LLM extraction

The E2E test stubs `PlannerAgent.generate_concept_from_canvas` (the only
LLM call in the happy path) so the test runs without API keys.
"""
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


PROJECT_ID = "proj_e2e_diverge"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def project_dir(tmp_path, monkeypatch):
    """Create a real project skeleton under tmp_path and point settings at it."""
    from backend.config import settings

    monkeypatch.setattr(settings, "projects_dir", tmp_path)

    proj = tmp_path / PROJECT_ID
    proj.mkdir(parents=True)
    proj.joinpath("project.json").write_text(
        json.dumps({"id": PROJECT_ID, "genre": "cool_novel"}, ensure_ascii=False),
        encoding="utf-8",
    )
    (proj / "creative_os").mkdir(parents=True)
    return proj


@pytest.fixture
def stub_planner():
    """Stub PlannerAgent.generate_concept_from_canvas to avoid any real LLM call.

    Returns a 4-layer value_stack + style_template — passes the server-side
    gate introduced in Task 13 (see test_commit_dual_write.py).

    Pattern mirrors test_commit_dual_write.py: replace the instance method
    with an AsyncMock whose return_value is the (payload, usage) tuple.
    """
    payload = (
        {
            "concept": {
                "title": "废材觉醒",
                "genre": "修仙",
                "premise": "凡人逆袭",
                "tone": "热血",
                "theme": "成长",
                "target_audience": "男频",
            },
            "story_dna": {
                "core_contradiction": {
                    "statement": "永生者 vs 凡人",
                    "side_a": "永生者",
                    "side_b": "凡人",
                },
                "value_stack": [
                    {"value_a": "复仇", "value_b": "宽恕", "level": "personal"},
                    {"value_a": "阶层", "value_b": "平等", "level": "social"},
                    {"value_a": "自由", "value_b": "责任", "level": "philosophical"},
                    {"value_a": "意义", "value_b": "虚无", "level": "existential"},
                ],
                "style_template": "白描克制",
            },
        },
        MagicMock(),
    )

    with patch("backend.agents.planner.PlannerAgent") as mock_agent_cls:
        mock_instance = MagicMock()
        mock_instance.generate_concept_from_canvas = AsyncMock(return_value=payload)
        mock_agent_cls.return_value = mock_instance
        yield mock_agent_cls


@pytest.fixture
def client(project_dir, stub_planner):
    """Mount the creative_diverge router on a fresh FastAPI app for testing."""
    from backend.api.creative_diverge import router

    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestE2EDivergeFlow:
    """Walks /init → /commit in one test. Each step asserts one observable
    invariant so a failure points at the exact broken layer.
    """

    def test_full_init_to_commit_happy_path(self, client, project_dir):
        # ------------------------------------------------------------------
        # Step 1: POST /init — premise → canvas v3 with root node
        # ------------------------------------------------------------------
        r = client.post(
            f"/api/v1/projects/{PROJECT_ID}/creative/diverge/init",
            json={"premise": "废材少年觉醒逆袭,背景修仙世界", "genre_primary": "修仙"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        canvas = body["detail"]
        assert canvas["schema_version"] == 3
        root_id = canvas["root_node_id"]
        assert root_id in canvas["nodes"], "root_node must be in nodes dict"
        assert canvas["selected_path"] == [root_id], "selected_path defaults to [root]"
        assert canvas["raw_intent"]["prompt"] == "废材少年觉醒逆袭,背景修仙世界"

        # ------------------------------------------------------------------
        # Step 2: GET /novelty — 4-dim score (uses fallback when no tags yet)
        # ------------------------------------------------------------------
        r = client.get(
            f"/api/v1/projects/{PROJECT_ID}/creative/diverge/novelty"
        )
        assert r.status_code == 200, r.text
        novelty = r.json()
        # All 4 PRD §3.5 dimensions must be present (fallback or real)
        for dim in (
            "market_saturation",
            "trope_similarity",
            "contradiction_depth",
            "discussion_potential",
            "composite",
            "grade",
        ):
            assert dim in novelty, f"missing novelty dim: {dim}"

        # ------------------------------------------------------------------
        # Step 3: GET /state — top-level `etag` for optimistic locking
        # ------------------------------------------------------------------
        r = client.get(
            f"/api/v1/projects/{PROJECT_ID}/creative/diverge/state"
        )
        assert r.status_code == 200, r.text
        state = r.json()
        assert "etag" in state, "etag must be top-level (not nested in detail)"
        assert state["etag"] is not None
        assert state["detail"]["schema_version"] == 3

        # ------------------------------------------------------------------
        # Step 4: PUT /contradict — writes core_contradiction to canvas
        # (If-Match gated; reusing the etag from step 3 keeps the lock happy)
        # ------------------------------------------------------------------
        r = client.put(
            f"/api/v1/projects/{PROJECT_ID}/creative/diverge/contradict",
            json={
                "template_type": "ABILITY_VS_LIMIT",
                "statement": "永生者 vs 凡人",
                "side_a": "永生者",
                "side_b": "凡人",
                "is_custom": False,
            },
            headers={"If-Match": state["etag"]},
        )
        assert r.status_code == 200, r.text
        contradiction = r.json()["core_contradiction"]
        assert contradiction["template_type"] == "ABILITY_VS_LIMIT"
        assert contradiction["side_a"] == "永生者"
        assert contradiction["side_b"] == "凡人"
        assert "confirmed_at" in contradiction

        # ------------------------------------------------------------------
        # Step 5: Expand canvas to 2 nodes so /commit's path-length gate
        # (`len(selected_path) < 2` → 400 INSUFFICIENT_PATH) passes.
        # Cheaper than calling /apply-mutation which needs Tier 1 LLM.
        #
        # Canvas invariants (creative_diverge.py:380-472) require:
        #   - selected_path starts at root
        #   - each consecutive node on selected_path is in parent's children_ids
        #   - root must be active (already true after /init)
        #   - expanded active node with children must have branch_choices entry
        #   - branch_choices values must be in parent's children_ids
        # ------------------------------------------------------------------
        canvas_state_path = project_dir / "creative_os" / "canvas_state.json"
        canvas_state = json.loads(canvas_state_path.read_text(encoding="utf-8"))
        child_id = "node_e2e_synthetic"
        canvas_state["nodes"][child_id] = {
            "id": child_id,
            "depth": 1,
            "parent_id": root_id,
            "content": "人工合成 child: 主角必须做出道德抉择",
            "novelty_score": 0.65,
            "trope_tags": ["修仙"],
            "is_expanded": False,
            "children_ids": [],
            "branch_status": "active",
            "saturation_warning": False,
            "mutation_context": None,
        }
        # Make root the parent of this child on the active chain.
        canvas_state["nodes"][root_id]["children_ids"] = [child_id]
        canvas_state["nodes"][root_id]["is_expanded"] = True
        canvas_state["selected_path"] = [root_id, child_id]
        canvas_state["branch_choices"] = {root_id: child_id}
        canvas_state_path.write_text(
            json.dumps(canvas_state, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        # ------------------------------------------------------------------
        # Step 6: POST /commit — translates canvas → dual-writes both JSONs
        # ------------------------------------------------------------------
        r = client.post(
            f"/api/v1/projects/{PROJECT_ID}/creative/diverge/commit",
            json={"confirmed_path_ids": [root_id, child_id]},
        )
        assert r.status_code == 200, r.text
        detail = r.json()["detail"]

        # Response envelope contract — added by Task 13
        assert detail["source"] == "canvas"
        assert "committed_at" in detail
        assert "concept_preview" in detail, "concept_preview must be inside detail"
        assert "story_dna_preview" in detail, "story_dna_preview must be inside detail"
        assert "novelty_summary" in detail
        assert "next_step_url" in detail
        assert "warnings" in detail
        assert detail["concept_preview"] == detail["concept"]
        assert detail["story_dna_preview"] == detail["story_dna"]

        # ------------------------------------------------------------------
        # Step 7: On-disk deliverable verification — concept_and_dna.json
        # ------------------------------------------------------------------
        cd_path = project_dir / "concept_and_dna.json"
        assert cd_path.exists(), "concept_and_dna.json must be written"
        cd = json.loads(cd_path.read_text(encoding="utf-8"))
        assert cd["source"] == "canvas"
        assert cd["concept"]["title"] == "废材觉醒"
        assert cd["story_dna"]["style_template"] == "白描克制"
        levels = {vs["level"] for vs in cd["story_dna"]["value_stack"]}
        assert levels == {"personal", "social", "philosophical", "existential"}
        assert len(cd["story_dna"]["value_stack"]) == 4

        # ------------------------------------------------------------------
        # Step 8: On-disk deliverable verification — creative_divergence.json
        # (compat file consumed by STAGE1 /concept guard — must include prompt)
        # ------------------------------------------------------------------
        cd_div_path = project_dir / "creative_divergence.json"
        assert cd_div_path.exists(), "creative_divergence.json must be dual-written"
        cd_div = json.loads(cd_div_path.read_text(encoding="utf-8"))
        assert cd_div["source"] == "canvas"
        assert "prompt" in cd_div
        assert cd_div["prompt"] == "废材少年觉醒逆袭,背景修仙世界"
        assert cd_div["variants"] == []
        assert cd_div["selected_id"] is None
        assert "selected_at" in cd_div

    def test_init_validates_empty_premise(self, client, project_dir):
        """Negative path: /init must reject empty premise.

        Premise has min_length=1 in the InitRequest Pydantic model, so
        Pydantic rejects it at the schema layer with 422 (string_too_short)
        before reaching the route handler. This is acceptable — the
        contract is that empty premises are rejected; whether by 422 or
        400 is an implementation detail.
        """
        r = client.post(
            f"/api/v1/projects/{PROJECT_ID}/creative/diverge/init",
            json={"premise": "", "genre_primary": "修仙"},
        )
        assert r.status_code == 422, r.text

    def test_commit_rejects_insufficient_path(self, client, project_dir):
        """Negative path: /commit must reject selected_path length < 2."""
        # Init only — gives us a canvas with selected_path = [root]
        r = client.post(
            f"/api/v1/projects/{PROJECT_ID}/creative/diverge/init",
            json={"premise": "最小路径测试", "genre_primary": "修仙"},
        )
        assert r.status_code == 200, r.text

        r = client.post(
            f"/api/v1/projects/{PROJECT_ID}/creative/diverge/commit",
            json={},  # no override → uses canvas.selected_path = [root]
        )
        assert r.status_code == 400, r.text
        body = r.json()
        assert body["detail"]["code"] == "INSUFFICIENT_PATH"
        assert body["detail"]["detail"]["selected_path_length"] == 1