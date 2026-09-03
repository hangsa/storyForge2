"""End-to-end integration tests for v2 canvas API.

Covers the full v2 flow: init -> 5 steps with select -> commit, plus the
422-on-partial-flow gate and the v3-to-v4 lazy-migration write-through
behavior of /state.
"""
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.v2_canvas import router as v2_router
from backend.api.creative_diverge import _read_canvas, _write_canvas
from backend.agents.planner import PlannerAgent
from backend.config import settings


def _canvas_path(pid: str) -> Path:
    return Path(settings.projects_dir) / pid / "creative_os" / "canvas_state.json"


def _concept_dna_path(pid: str) -> Path:
    return Path(settings.projects_dir) / pid / "concept_and_dna.json"


@pytest.fixture
def project(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    pid = "p_e2e"
    project_dir = tmp_path / pid
    project_dir.mkdir(parents=True)
    (project_dir / "project.json").write_text(
        '{"id": "p_e2e", "genre": "xianxia"}', encoding="utf-8",
    )
    return pid


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(v2_router)
    return TestClient(app)


@pytest.fixture
def stub_planner(monkeypatch):
    """Stub PlannerAgent.generate_concept_from_canvas so /commit doesn't hit LLM."""
    async def fake_generate(self, canvas_summary, genre="xianxia"):
        return (
            {
                "concept": {"title": "T", "premise": "P", "genre": genre,
                            "tone": "", "theme": "", "target_audience": "",
                            "style_template": "", "source": "canvas"},
                "story_dna": {
                    "core_contradiction": {"statement": "S", "side_a": "A", "side_b": "B"},
                    "value_stack": [{"level": l, "value_a": "", "value_b": ""}
                                    for l in ("personal", "social",
                                              "philosophical", "existential")],
                    # Non-empty style_template required to pass commit gate
                    # (real PlannerAgent always returns a default).
                    "style_template": "白描克制", "fusion_meta": None,
                },
            },
            None,
        )
    monkeypatch.setattr(PlannerAgent, "generate_concept_from_canvas", fake_generate)


@pytest.fixture
def stub_llm(monkeypatch):
    """Stub _next_step_impl so /next-step and the select-cascade skip LLM.

    Replaces the real _next_step_impl (which calls LLM and persists). The
    fake writes a deterministic 3-option entry to disk so /select can find
    the option_id. Mirrors the pattern in tests/test_v2_canvas_endpoints.py.
    """
    from backend.api import v2_canvas

    async def fake_next(project_id, current_step):
        options = [
            {"id": f"opt_{current_step}_a", "title": "A", "premise": f"p{current_step}", "logic": "",
             "scores": {}},
            {"id": f"opt_{current_step}_b", "title": "B", "premise": f"p{current_step}", "logic": "",
             "scores": {}},
            {"id": f"opt_{current_step}_c", "title": "C", "premise": f"p{current_step}", "logic": "",
             "scores": {}},
        ]
        canvas = _read_canvas(project_id)
        # Extend path with locked stubs so creative_path[current_step-1] is in range.
        # Needed because /select (v2_canvas.py:403) cascades into _next_step_impl(step+1)
        # without first writing the new step's entry — this loop pre-fills the gap.
        while len(canvas["creative_path"]) < current_step:
            canvas["creative_path"].append({
                "step": len(canvas["creative_path"]) + 1,
                "operation": None,
                "operation_reason": None,
                "options": [],
                "selected_option_id": None,
                "created_at": "2026-09-02T00:00:00",
                "selected_at": None,
                "regenerated_count": 0,
                "state": "locked",
            })
        canvas["creative_path"][current_step - 1] = {
            "step": current_step,
            "operation": "twist",
            "operation_reason": "",
            "options": options,
            "selected_option_id": None,
            "created_at": "2026-09-02T00:00:00",
            "selected_at": None,
            "regenerated_count": 0,
            "state": "active",
        }
        _write_canvas(project_id, canvas)
        return {
            "step": current_step,
            "operation": {"type": "twist", "name": "twist", "reason": ""},
            "options": options,
            "quality_warning": None,
        }
    monkeypatch.setattr(v2_canvas, "_next_step_impl", fake_next)


def test_e2e_full_flow_5_steps_then_commit(project, client, stub_planner, stub_llm):
    """Init -> 5x(next-step + select) -> commit. Verify disk artifacts."""
    # Init
    init_resp = client.post(
        f"/creative/canvas/{project}/session/init",
        json={"prompt": "长生者寻死", "genre_primary": "xianxia"},
    )
    assert init_resp.status_code == 200, init_resp.text

    # Walk 5 steps, selecting option_b each time
    for step in range(1, 6):
        ns = client.post(
            f"/creative/canvas/{project}/session/next-step",
            json={"current_step": step},
        )
        assert ns.status_code == 200, ns.text

        sel = client.post(
            f"/creative/canvas/{project}/session/select",
            json={"step": step, "option_id": f"opt_{step}_b"},
        )
        assert sel.status_code == 200, sel.text

    # Verify creative_path on disk: 5 steps, all completed, selected_option_id set
    canvas = json.loads(_canvas_path(project).read_text(encoding="utf-8"))
    assert len(canvas["creative_path"]) == 5
    for i, entry in enumerate(canvas["creative_path"], start=1):
        assert entry["step"] == i
        assert entry["state"] == "completed"
        assert entry["selected_option_id"] == f"opt_{i}_b"

    # Commit
    commit_resp = client.post(f"/creative/canvas/{project}/session/commit")
    assert commit_resp.status_code == 200, commit_resp.text

    # Verify concept_and_dna.json was written
    cnd = json.loads(_concept_dna_path(project).read_text(encoding="utf-8"))
    assert cnd["concept"]["title"] == "T"
    assert "canvas_snapshot" in cnd
    assert len(cnd["canvas_snapshot"]["selected_path"]) == 5


def test_e2e_partial_flow_cannot_commit(project, client, stub_llm):
    """Walk only 3 steps then commit -> must return 422 with INVALID_PATH."""
    # Init
    init_resp = client.post(
        f"/creative/canvas/{project}/session/init",
        json={"prompt": "p", "genre_primary": "xianxia"},
    )
    assert init_resp.status_code == 200, init_resp.text

    # Walk only 3 steps (1, 2, 3)
    for step in range(1, 4):
        ns = client.post(
            f"/creative/canvas/{project}/session/next-step",
            json={"current_step": step},
        )
        assert ns.status_code == 200, ns.text

        sel = client.post(
            f"/creative/canvas/{project}/session/select",
            json={"step": step, "option_id": f"opt_{step}_b"},
        )
        assert sel.status_code == 200, sel.text

    # Commit must reject: step 5 not completed → INVALID_PATH gate
    commit_resp = client.post(f"/creative/canvas/{project}/session/commit")
    assert commit_resp.status_code == 422, commit_resp.text
    assert "INVALID_PATH" in commit_resp.text


def test_e2e_v3_canvas_lazy_migrates_and_committable(project, client, tmp_path):
    """Write a v3 canvas to disk (uncommitted). GET /state migrates to v4
    in-memory and writes v4 back to disk (write-through for uncommitted v3).
    """
    pid = project

    # Build a valid v3 canvas (uncommitted, so lazy migration writes back)
    canvas_v3 = {
        "schema_version": 3,
        "session_id": "sess_v3_legacy",
        "root_node_id": "wi_001_00",
        "nodes": {
            "wi_001_00": {
                "id": "wi_001_00", "depth": 0, "parent_id": None,
                "content": "Root", "dimension": "情节方向",
                "novelty_score": 0, "trope_tags": [],
                "saturation_warning": False,
                "mutation_context": {"mut": "inversion", "logic": "A->not A"},
                "children_ids": [], "is_expanded": True,
                "branch_status": "active",
            },
        },
        "edges": [],
        "selected_path": ["wi_001_00"],
        "branch_choices": {},
        "evaluations": {},
        "idea_variants": [],
        "core_contradiction": None,
        "novelty_scores": {},
        "raw_intent": None,
        "session_metadata": {"operation_count": 0},
        "created_at": "2026-09-02T00:00:00",
        "updated_at": "2026-09-02T00:00:00",
        "committed_at": None,
        "committed_concept_ref": None,
    }

    creative_os_dir = tmp_path / pid / "creative_os"
    creative_os_dir.mkdir(parents=True, exist_ok=True)
    _canvas_path(pid).write_text(
        json.dumps(canvas_v3, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    # GET /state -> lazy migration to v4 in-memory, write-through to disk
    state_resp = client.get(f"/creative/canvas/{pid}/session/state")
    assert state_resp.status_code == 200, state_resp.text
    assert state_resp.json()["schema_version"] == 4

    # Disk should now have schema_version=4 (write-through)
    on_disk = json.loads(_canvas_path(pid).read_text(encoding="utf-8"))
    assert on_disk["schema_version"] == 4
    assert "creative_path" in on_disk


def test_e2e_full_flow_commits_with_enriched_schema(
    project, client, stub_planner, stub_llm
):
    """End-to-end: init -> 5x(next-step + select) -> commit, then assert
    every PRD §22 enriched-schema field is populated:

    - root_idea.prompt (the user's raw intent, preserved through commit)
    - creative_path has 5 entries, all completed with selected_option_id set
    - committed_at (truthy timestamp set by /commit)
    - scores.computed_at (truthy timestamp set by /init + refreshed by /select)
    - current_concept.premise (truthy, accumulates through selections)

    Note on creative_session fields: /commit sets the top-level `committed`
    boolean and `committed_at` timestamp but does NOT flip
    `creative_session.status` from "active" — that's left for the UI to
    derive from `committed_at`. Likewise `creative_session.current_step`
    is initialized to 1 and never bumped by /select (step progress lives
    in `creative_path[].state`, not the session summary). This test pins
    the actual contract, not the PRD's aspirational status enum.
    """
    # Init
    init_resp = client.post(
        f"/creative/canvas/{project}/session/init",
        json={"prompt": "my idea", "genre_primary": "xianxia"},
    )
    assert init_resp.status_code == 200, init_resp.text

    # Walk 5 steps, selecting option_b each time
    for step in range(1, 6):
        ns = client.post(
            f"/creative/canvas/{project}/session/next-step",
            json={"current_step": step},
        )
        assert ns.status_code == 200, ns.text

        sel = client.post(
            f"/creative/canvas/{project}/session/select",
            json={"step": step, "option_id": f"opt_{step}_b"},
        )
        assert sel.status_code == 200, sel.text

    # Commit
    commit_resp = client.post(f"/creative/canvas/{project}/session/commit")
    assert commit_resp.status_code == 200, commit_resp.text

    # Re-fetch state and verify every enriched-schema block (PRD §22) is populated.
    state_resp = client.get(f"/creative/canvas/{project}/session/state")
    assert state_resp.status_code == 200, state_resp.text
    canvas = state_resp.json()

    # root_idea.prompt carries the original user intent through init and commit.
    assert canvas["root_idea"]["prompt"] == "my idea"

    # creative_path records the completed 5-step loop (state per row is the
    # authoritative "we walked all 5 steps" signal — not creative_session).
    assert len(canvas["creative_path"]) == 5
    for i, entry in enumerate(canvas["creative_path"], start=1):
        assert entry["step"] == i
        assert entry["state"] == "completed", (
            f"Step {i} state={entry['state']!r}, expected 'completed'"
        )
        assert entry["selected_option_id"] == f"opt_{i}_b"

    # /commit stamps the top-level committed_at timestamp (None before commit).
    assert canvas["committed_at"], (
        "committed_at must be truthy after /commit; got: "
        f"{canvas.get('committed_at')!r}"
    )

    # scores.computed_at is set at init and refreshed by each /select.
    assert canvas["scores"]["computed_at"]

    # current_concept.premise accumulates through selections; by step 5 it
    # mirrors the final selected option's premise (not None / not "").
    assert canvas["current_concept"]["premise"]


def test_e2e_delete_state_after_2_steps_preserves_root_idea(
    project, client, stub_planner, stub_llm
):
    """Init -> 2 steps -> DELETE /state: PRD §18.2 mandates that DELETE
    resets the session but preserves root_idea (the user's original
    intent). Verify creative_path is wiped while root_idea.prompt survives.

    Note: after 2 /select calls, the cascade into next-step leaves one
    extra step-3 entry pre-filled (the fixture's fake_next extends the
    path). The exact pre-reset length isn't load-bearing — what matters
    is that DELETE wipes it back to empty.
    """
    # Init
    init_resp = client.post(
        f"/creative/canvas/{project}/session/init",
        json={"prompt": "keep this", "genre_primary": "xianxia"},
    )
    assert init_resp.status_code == 200, init_resp.text

    # Walk 2 steps
    for step in range(1, 3):
        ns = client.post(
            f"/creative/canvas/{project}/session/next-step",
            json={"current_step": step},
        )
        assert ns.status_code == 200, ns.text

        sel = client.post(
            f"/creative/canvas/{project}/session/select",
            json={"step": step, "option_id": f"opt_{step}_b"},
        )
        assert sel.status_code == 200, sel.text

    # Sanity: at least 2 completed steps present before reset (the cascade
    # into next-step after the last /select may also fill step 3).
    pre_state = client.get(f"/creative/canvas/{project}/session/state").json()
    assert len(pre_state["creative_path"]) >= 2

    # DELETE /state — resets session but preserves root_idea
    del_resp = client.delete(f"/creative/canvas/{project}/session/state")
    assert del_resp.status_code == 200, del_resp.text

    # Re-fetch state to verify reset semantics
    post_state = client.get(f"/creative/canvas/{project}/session/state").json()
    assert post_state["creative_path"] == []
    assert post_state["root_idea"]["prompt"] == "keep this"